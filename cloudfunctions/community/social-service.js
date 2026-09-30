'use strict';

const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 48);
const personFields = user => ({ id: user._id || user.id, nickname: user.nickname || '爱宠邻居', avatar: user.avatar || '' });

// All mutations use deterministic document reads inside the transaction. User
// lifecycles are part of relation keys and membership so re-registration cannot
// inherit old requests, friendships, conversations or in-flight writes.
function createSocialService({ repository: repo, now, fail, requireUser, requireVerifiedUser, verificationFor, moderateText, allRecords }) {
  function text(value, label, min, max) {
    if (typeof value !== 'string') fail('INVALID_INPUT', `${label}格式不正确`);
    const result = value.trim();
    if (Array.from(result).length < min || Array.from(result).length > max) fail('INVALID_INPUT', `${label}需要 ${min}–${max} 个字`);
    return result;
  }
  function identifier(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) fail('INVALID_INPUT', '记录编号不正确');
    return value;
  }
  function limitFor(payload) {
    const limit = payload.limit === undefined ? 20 : payload.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID_INPUT', '每页数量需要为 1–50');
    return limit;
  }
  const present = value => value !== undefined && value !== null && value !== '';
  const life = user => user.lifecycleId || '';
  const keyFor = (left, right) => 'friend_' + digest([left, right].map(user => [user._id || user.id, life(user)]).sort((a, b) => a[0].localeCompare(b[0])));
  const requestKey = (kind, ctx, requestId, extra = '') => kind + '_' + digest([ctx.userId, ctx.lifecycleId, requestId, extra]);
  const readKey = (conversationId, ctx) => 'read_' + digest([conversationId, ctx.userId, ctx.lifecycleId]);
  const matchesLife = (record, user) => record.memberIds.includes(user._id || user.id) && record.memberLifecycles[user._id || user.id] === life(user);

  async function blocked(access, left, right) {
    return left !== right && !!(await access.get('blocks', left + '__' + right) || await access.get('blocks', right + '__' + left));
  }
  async function targetUser(access, id) {
    const user = await access.get('users', id);
    if (!user || user.status !== 'active' || user.isEditorial) fail('NOT_FOUND', '这位邻居暂不可添加');
    return user;
  }
  async function pairUsers(access, ctx, targetId, verified = false) {
    if (targetId === ctx.userId) fail('INVALID_INPUT', '不能选择自己');
    const me = await (verified ? requireVerifiedUser(access, ctx.userId, ctx.lifecycleId) : requireUser(access, ctx.userId, ctx.lifecycleId));
    const other = await targetUser(access, targetId);
    if (await blocked(access, ctx.userId, targetId)) fail('NOT_FOUND', '这位邻居不存在或不可见');
    return { me, other, key: keyFor(me, other) };
  }
  async function friendStatus(access, me, other) {
    const relation = await access.get('friendships', keyFor(me, other));
    if (relation && relation.status === 'friends') return 'friends';
    if (relation && relation.status === 'pending') {
      const request = await access.get('friend_requests', relation.pendingRequestId);
      if (request && request.status === 'pending') return request.fromId === (me._id || me.id) ? 'outgoing' : 'incoming';
    }
    return 'none';
  }
  async function person(access, me, other) {
    return { ...personFields(other), friendStatus: await friendStatus(access, me, other) };
  }
  async function visiblePerson(access, me, id, expectedLife) {
    const user = await access.get('users', id);
    if (!user || user.status !== 'active' || user.isEditorial || expectedLife !== undefined && life(user) !== expectedLife || await blocked(access, me._id || me.id, id)) return null;
    return user;
  }
  async function conversationFor(access, ctx, id, verified = false) {
    const me = await (verified ? requireVerifiedUser(access, ctx.userId, ctx.lifecycleId) : requireUser(access, ctx.userId, ctx.lifecycleId));
    const conversation = await access.get('conversations', id);
    if (!conversation || conversation.status !== 'active' || !matchesLife(conversation, me)) fail('NOT_FOUND', '会话不存在或你已退出');
    if (conversation.kind === 'direct') for (const memberId of conversation.memberIds) {
      if (memberId !== ctx.userId && await blocked(access, ctx.userId, memberId)) fail('NOT_FOUND', '会话不存在或不可见');
    }
    return { me, conversation };
  }
  async function canSend(access, ctx, conversation) {
    if ((await verificationFor(access, ctx.userId)).status !== 'phone_verified') return false;
    if (conversation.kind === 'group') return true;
    if (conversation.memberIds.length !== 2) return false;
    const otherId = conversation.memberIds.find(id => id !== ctx.userId);
    const me = await access.get('users', ctx.userId);
    const other = await visiblePerson(access, me, otherId, conversation.memberLifecycles[otherId]);
    return !!other && await friendStatus(access, me, other) === 'friends';
  }
  async function chatSnapshot(ctx, id) {
    const { me, conversation } = await conversationFor(repo, ctx, id);
    const users = new Map();
    const visibleUser = async (userId, expectedLife) => {
      const key = userId + ':' + expectedLife;
      if (!users.has(key)) users.set(key, await visiblePerson(repo, me, userId, expectedLife));
      return users.get(key);
    };
    const members = [];
    for (const memberId of conversation.memberIds) {
      const user = await visibleUser(memberId, conversation.memberLifecycles[memberId]);
      if (user) members.push(await person(repo, me, user));
    }
    const messages = [];
    for (const record of await allRecords('chat_messages', { conversationId: id })) {
      const sender = await visibleUser(record.senderId, record.senderLifecycleId);
      if (sender) messages.push({ id: record._id, seq: record.seq, text: record.text, createdAt: record.createdAt, sender: personFields(sender), isMine: record.senderId === ctx.userId });
    }
    messages.sort((a, b) => b.seq - a.seq);
    const read = await repo.get('chat_reads', readKey(id, ctx));
    const latest = messages[0];
    const view = { id, kind: conversation.kind,
      name: conversation.kind === 'direct' ? (members.find(member => member.id !== ctx.userId) || {}).nickname || '已注销用户' : conversation.name,
      ownerId: conversation.ownerId, memberCount: conversation.memberIds.length,
      updatedAt: latest ? latest.createdAt : conversation.createdAt, lastText: latest ? latest.text : '', lastAt: latest ? latest.createdAt : null,
      lastSeq: conversation.lastSeq, unreadCount: messages.filter(message => !message.isMine && message.seq > (read && read.throughSeq || 0)).length,
      canSend: await canSend(repo, ctx, conversation), members };
    // Long inbox scans must not return content after membership was revoked.
    await conversationFor(repo, ctx, id);
    return { conversation: view, items: messages };
  }
  function conversationPage(items, payload) {
    const limit = limitFor(payload); let anchor;
    if (present(payload.cursor)) {
      const match = typeof payload.cursor === 'string' && /^c_(\d{1,16})_([A-Za-z0-9_-]{1,120})$/.exec(payload.cursor);
      if (!match || !Number.isSafeInteger(Number(match[1]))) fail('INVALID_INPUT', '会话分页位置无效');
      anchor = { updatedAt: Number(match[1]), id: match[2] };
    }
    const records = items.filter(item => !anchor || item.updatedAt < anchor.updatedAt || item.updatedAt === anchor.updatedAt && item.id < anchor.id)
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const page = records.slice(0, limit); const last = page[page.length - 1];
    return { items: page, ...(records.length > limit ? { nextCursor: 'c_' + last.updatedAt + '_' + last.id } : {}) };
  }

  const handlers = {
    async searchPeople(payload, ctx) {
      const query = text(payload.query, '搜索内容', 1, 60); const folded = query.toLowerCase();
      const limit = limitFor(payload); const after = present(payload.cursor) ? identifier(payload.cursor) : '';
      const me = await requireUser(repo, ctx.userId, ctx.lifecycleId); const found = [];
      for (const candidate of await allRecords('users', { status: 'active' })) {
        if (candidate._id === ctx.userId || candidate.isEditorial || after && candidate._id <= after || await blocked(repo, ctx.userId, candidate._id)) continue;
        const status = await friendStatus(repo, me, candidate); const exactId = candidate._id === query;
        if (!exactId && !candidate.publicProfile && status === 'none') continue;
        if (exactId || (candidate.nickname || '').toLowerCase().includes(folded)) found.push({ ...personFields(candidate), friendStatus: status });
      }
      found.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const items = found.slice(0, limit);
      return { items, ...(found.length > limit ? { nextCursor: items[items.length - 1].id } : {}) };
    },
    async getFriendHub(payload, ctx) {
      const me = await requireUser(repo, ctx.userId, ctx.lifecycleId);
      const friends = [], incoming = [], outgoing = [];
      for (const relation of await allRecords('friendships', { memberIds: ctx.userId })) {
        if (relation.status !== 'friends' || !matchesLife(relation, me)) continue;
        const otherId = relation.memberIds.find(id => id !== ctx.userId);
        const other = await visiblePerson(repo, me, otherId, relation.memberLifecycles[otherId]);
        if (other) friends.push({ ...personFields(other), friendStatus: 'friends' });
      }
      for (const [field, output] of [['toId', incoming], ['fromId', outgoing]]) {
        for (const request of await allRecords('friend_requests', { [field]: ctx.userId })) {
          if (request.status !== 'pending' || request[field === 'toId' ? 'toLifecycleId' : 'fromLifecycleId'] !== ctx.lifecycleId) continue;
          const otherId = field === 'toId' ? request.fromId : request.toId;
          const other = await visiblePerson(repo, me, otherId, request[field === 'toId' ? 'fromLifecycleId' : 'toLifecycleId']);
          if (other) output.push({ id: request._id, [field === 'toId' ? 'from' : 'to']: await person(repo, me, other), note: request.note, createdAt: request.createdAt });
        }
        output.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      }
      friends.sort((a, b) => a.nickname.localeCompare(b.nickname) || a.id.localeCompare(b.id));
      return { friends, incoming, outgoing };
    },
    async sendFriendRequest(payload, ctx) {
      const targetId = identifier(payload.targetId); const note = text(payload.note === undefined ? '' : payload.note, '申请说明', 0, 100);
      await pairUsers(repo, ctx, targetId, true);
      if (note) await moderateText(note, ctx.openid);
      return repo.transaction(async tx => {
        const { me, other, key } = await pairUsers(tx, ctx, targetId, true);
        const previous = await tx.get('friendships', key);
        if (previous && previous.status === 'friends') return { success: true, status: 'friends' };
        if (previous && previous.status === 'pending') return { success: true, status: previous.fromId === ctx.userId ? 'pending' : 'incoming' };
        const serial = (previous && previous.requestSerial || 0) + 1;
        const id = 'request_' + digest([key, serial]);
        await tx.set('friend_requests', id, { relationId: key, fromId: ctx.userId, toId: targetId, fromLifecycleId: life(me), toLifecycleId: life(other), note, status: 'pending', createdAt: now() });
        await tx.set('friendships', key, { memberIds: [ctx.userId, targetId].sort(), memberLifecycles: { [ctx.userId]: life(me), [targetId]: life(other) },
          status: 'pending', fromId: ctx.userId, pendingRequestId: id, requestSerial: serial, createdAt: previous ? previous.createdAt : now(), updatedAt: now() });
        return { success: true, status: 'pending' };
      });
    },
    async respondFriendRequest(payload, ctx) {
      const id = identifier(payload.requestId);
      if (typeof payload.accept !== 'boolean') fail('INVALID_INPUT', '请选择同意或拒绝');
      return repo.transaction(async tx => {
        await (payload.accept ? requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId) : requireUser(tx, ctx.userId, ctx.lifecycleId));
        const request = await tx.get('friend_requests', id);
        if (!request || request.toId !== ctx.userId || request.toLifecycleId !== ctx.lifecycleId) fail('NOT_FOUND', '好友申请不存在');
        if (request.status !== 'pending') return { success: true };
        const relation = await tx.get('friendships', request.relationId);
        if (!relation || relation.pendingRequestId !== id || relation.status !== 'pending') fail('NOT_FOUND', '好友申请已失效');
        if (payload.accept) {
          const { other } = await pairUsers(tx, ctx, request.fromId, true);
          if (life(other) !== request.fromLifecycleId) fail('NOT_FOUND', '好友申请已失效');
        }
        await tx.set('friend_requests', id, { ...request, status: payload.accept ? 'accepted' : 'rejected', respondedAt: now() });
        await tx.set('friendships', request.relationId, { ...relation, status: payload.accept ? 'friends' : 'none', pendingRequestId: '', updatedAt: now() });
        return { success: true };
      });
    },
    async removeFriend(payload, ctx) {
      const targetId = identifier(payload.targetId);
      await repo.transaction(async tx => {
        const me = await requireUser(tx, ctx.userId, ctx.lifecycleId);
        if (targetId === ctx.userId) fail('INVALID_INPUT', '不能选择自己');
        const other = await tx.get('users', targetId);
        if (!other) return;
        const key = keyFor(me, other); const relation = await tx.get('friendships', key);
        if (relation && relation.status === 'friends') await tx.set('friendships', key, { ...relation, status: 'none', updatedAt: now() });
      });
      return { success: true };
    },
    async openDirectChat(payload, ctx) {
      const targetId = identifier(payload.targetId);
      const id = await repo.transaction(async tx => {
        const { me, other, key } = await pairUsers(tx, ctx, targetId, true);
        if (await friendStatus(tx, me, other) !== 'friends') fail('FRIEND_REQUIRED', '双方成为好友后即可聊天');
        const conversationId = 'direct_' + digest(key);
        const existing = await tx.get('conversations', conversationId);
        if (!existing) await tx.set('conversations', conversationId, { kind: 'direct', name: '', ownerId: '', memberIds: [ctx.userId, targetId].sort(),
          memberLifecycles: { [ctx.userId]: life(me), [targetId]: life(other) }, createdAt: now(), updatedAt: now(), lastSeq: 0, status: 'active' });
        return conversationId;
      });
      return { conversation: (await chatSnapshot(ctx, id)).conversation };
    },
    async createGroupChat(payload, ctx) {
      const name = text(payload.name, '群聊名称', 1, 30); const requestId = identifier(payload.requestId);
      if (!Array.isArray(payload.memberIds) || payload.memberIds.length < 1 || payload.memberIds.length > 19) fail('INVALID_INPUT', '请选择 1–19 位好友');
      const memberIds = payload.memberIds.map(identifier);
      if (memberIds.includes(ctx.userId) || new Set(memberIds).size !== memberIds.length) fail('INVALID_INPUT', '群成员不能重复或包含自己');
      const fingerprint = digest([name, [...memberIds].sort()]);
      const id = requestKey('group', ctx, requestId);
      await requireVerifiedUser(repo, ctx.userId, ctx.lifecycleId);
      await moderateText(name, ctx.openid);
      await repo.transaction(async tx => {
        const me = await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId);
        const existing = await tx.get('conversations', id);
        if (existing) {
          if (existing.creationFingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', '这次建群请求已使用，请重新发起');
          await conversationFor(tx, ctx, id);
          return;
        }
        const users = [me];
        for (const memberId of memberIds) {
          const { other } = await pairUsers(tx, ctx, memberId);
          if (await friendStatus(tx, me, other) !== 'friends') fail('FRIEND_REQUIRED', '只能邀请已确认的好友');
          users.push(other);
        }
        for (let left = 0; left < users.length; left++) for (let right = left + 1; right < users.length; right++) {
          if (await blocked(tx, users[left]._id, users[right]._id)) fail('MEMBER_UNAVAILABLE', '所选成员之间暂不适合加入同一群聊');
        }
        await tx.set('conversations', id, { kind: 'group', name, ownerId: ctx.userId, memberIds: [ctx.userId, ...memberIds],
          memberLifecycles: Object.fromEntries(users.map(user => [user._id, life(user)])), creationFingerprint: fingerprint,
          createdAt: now(), updatedAt: now(), lastSeq: 0, status: 'active' });
      });
      return { conversation: (await chatSnapshot(ctx, id)).conversation };
    },
    async listConversations(payload, ctx) {
      const query = text(payload.query === undefined ? '' : payload.query, '搜索内容', 0, 60).toLowerCase();
      const snapshots = [];
      for (const record of await allRecords('conversations', { memberIds: ctx.userId })) {
        try { snapshots.push(await chatSnapshot(ctx, record._id)); }
        catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
      }
      const items = snapshots.filter(snapshot => !query || [snapshot.conversation.name, ...snapshot.conversation.members.map(member => member.nickname), ...snapshot.items.map(item => item.text)].join(' ').toLowerCase().includes(query))
        .map(snapshot => snapshot.conversation);
      return { ...conversationPage(items, payload), unreadCount: snapshots.reduce((total, snapshot) => total + snapshot.conversation.unreadCount, 0) };
    },
    async getChatMessages(payload, ctx) {
      const id = identifier(payload.conversationId); const limit = limitFor(payload); let before = Infinity;
      if (present(payload.cursor)) {
        if (typeof payload.cursor !== 'string' || !/^[1-9]\d{0,15}$/.test(payload.cursor) || !Number.isSafeInteger(Number(payload.cursor))) fail('INVALID_INPUT', '聊天分页位置无效');
        before = Number(payload.cursor);
      }
      const snapshot = await chatSnapshot(ctx, id);
      const records = snapshot.items.filter(item => item.seq < before); const items = records.slice(0, limit);
      return { conversation: snapshot.conversation, items, ...(records.length > limit ? { nextCursor: String(items[items.length - 1].seq) } : {}) };
    },
    async sendChatMessage(payload, ctx) {
      const conversationId = identifier(payload.conversationId); const body = text(payload.text, '消息', 1, 1000); const requestId = identifier(payload.requestId);
      await conversationFor(repo, ctx, conversationId, true);
      await moderateText(body, ctx.openid);
      const id = requestKey('chat', ctx, requestId, conversationId);
      const message = await repo.transaction(async tx => {
        const { me, conversation } = await conversationFor(tx, ctx, conversationId, true);
        if (!await canSend(tx, ctx, conversation)) fail('FRIEND_REQUIRED', '重新成为好友后才能继续聊天');
        const existing = await tx.get('chat_messages', id);
        if (existing) {
          if (existing.text !== body) fail('IDEMPOTENCY_CONFLICT', '这次发送请求已使用，请重新发送');
          return { id, seq: existing.seq, text: existing.text, createdAt: existing.createdAt, sender: personFields(me), isMine: true };
        }
        const seq = conversation.lastSeq + 1;
        if (!Number.isSafeInteger(seq)) fail('CHAT_FULL', '会话消息已达上限，请新建群聊');
        const record = { conversationId, senderId: ctx.userId, senderLifecycleId: ctx.lifecycleId, seq, text: body, createdAt: now() };
        await tx.set('chat_messages', id, record);
        await tx.set('conversations', conversationId, { ...conversation, lastSeq: seq, updatedAt: now() });
        return { id, seq, text: body, createdAt: record.createdAt, sender: personFields(me), isMine: true };
      });
      return { message };
    },
    async readConversation(payload, ctx) {
      const id = identifier(payload.conversationId); const seq = payload.throughSeq;
      if (!Number.isSafeInteger(seq) || seq < 0) fail('INVALID_INPUT', '已读位置无效');
      await repo.transaction(async tx => {
        const { conversation } = await conversationFor(tx, ctx, id);
        if (seq > conversation.lastSeq) fail('INVALID_INPUT', '已读位置超出当前消息');
        const key = readKey(id, ctx); const previous = await tx.get('chat_reads', key);
        await tx.set('chat_reads', key, { conversationId: id, userId: ctx.userId, lifecycleId: ctx.lifecycleId, throughSeq: Math.max(previous && previous.throughSeq || 0, seq), updatedAt: now() });
      });
      return { success: true };
    },
    async leaveGroup(payload, ctx) {
      const id = identifier(payload.conversationId);
      await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId);
        const existing = await tx.get('conversations', id);
        if (existing && existing.kind === 'group' && (existing.leftMemberLifecycles || {})[ctx.userId] === ctx.lifecycleId) return;
        const { conversation } = await conversationFor(tx, ctx, id);
        if (conversation.kind !== 'group') fail('INVALID_INPUT', '这不是群聊');
        const memberIds = conversation.memberIds.filter(memberId => memberId !== ctx.userId);
        const memberLifecycles = { ...conversation.memberLifecycles }; delete memberLifecycles[ctx.userId];
        await tx.set('conversations', id, { ...conversation, memberIds, memberLifecycles,
          leftMemberIds: [...new Set([...(conversation.leftMemberIds || []), ctx.userId])], leftMemberLifecycles: { ...conversation.leftMemberLifecycles, [ctx.userId]: ctx.lifecycleId },
          ownerId: conversation.ownerId === ctx.userId ? memberIds[0] || '' : conversation.ownerId,
          status: memberIds.length ? 'active' : 'closed', updatedAt: now() });
        const key = readKey(id, ctx);
        if (await tx.get('chat_reads', key)) await tx.remove('chat_reads', key);
      });
      return { success: true };
    }
  };

  async function blockPair(tx, leftId, rightId) {
    const left = await tx.get('users', leftId), right = await tx.get('users', rightId);
    if (!left || !right) return;
    const key = keyFor(left, right); const relation = await tx.get('friendships', key);
    if (!relation) return;
    if (relation.pendingRequestId) {
      const request = await tx.get('friend_requests', relation.pendingRequestId);
      if (request && request.status === 'pending') await tx.set('friend_requests', request._id, { ...request, status: 'cancelled', respondedAt: now() });
    }
    await tx.set('friendships', key, { ...relation, status: 'none', pendingRequestId: '', updatedAt: now() });
  }
  async function deleteAccount(ctx) {
    for (const field of ['fromId', 'toId']) for (const request of await allRecords('friend_requests', { [field]: ctx.userId })) await repo.remove('friend_requests', request._id);
    for (const relation of await allRecords('friendships', { memberIds: ctx.userId })) await repo.remove('friendships', relation._id);
    const conversations = new Map();
    for (const field of ['memberIds', 'leftMemberIds']) for (const record of await allRecords('conversations', { [field]: ctx.userId })) conversations.set(record._id, record);
    for (const record of conversations.values()) await repo.transaction(async tx => {
      const current = await tx.get('conversations', record._id);
      if (!current) return;
      const memberIds = current.memberIds.filter(id => id !== ctx.userId); const memberLifecycles = { ...current.memberLifecycles }; delete memberLifecycles[ctx.userId];
      const leftMemberIds = (current.leftMemberIds || []).filter(id => id !== ctx.userId); const leftMemberLifecycles = { ...current.leftMemberLifecycles }; delete leftMemberLifecycles[ctx.userId];
      await tx.set('conversations', record._id, { ...current, memberIds, memberLifecycles, leftMemberIds, leftMemberLifecycles,
        ownerId: current.ownerId === ctx.userId ? memberIds[0] || '' : current.ownerId, status: memberIds.length ? 'active' : 'closed', updatedAt: now() });
    });
    for (const message of await allRecords('chat_messages', { senderId: ctx.userId })) await repo.remove('chat_messages', message._id);
    for (const read of await allRecords('chat_reads', { userId: ctx.userId })) await repo.remove('chat_reads', read._id);
  }
  async function areFriends(access, leftId, rightId) {
    const left = await access.get('users', leftId); const right = await access.get('users', rightId);
    if (!left || !right || left.status !== 'active' || right.status !== 'active' || await blocked(access, leftId, rightId)) return false;
    const relation = await access.get('friendships', keyFor(left, right));
    return !!(relation && relation.status === 'friends' && Array.isArray(relation.memberIds) && relation.memberLifecycles && matchesLife(relation, left) && matchesLife(relation, right));
  }
  return { handlers, blockPair, deleteAccount, areFriends };
}

module.exports = { createSocialService };
