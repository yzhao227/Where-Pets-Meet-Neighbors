const READS = ['searchPeople', 'getFriendHub', 'listConversations', 'getChatMessages'];
const WRITES = ['sendFriendRequest', 'respondFriendRequest', 'removeFriend', 'openDirectChat', 'sendChatMessage', 'readConversation'];
const RETIRED = ['createGroupChat', 'leaveGroup'];
const TABLES = ['friendships', 'friendRequests', 'conversations', 'chatMessages'];
const handles = action => READS.includes(action) || WRITES.includes(action) || RETIRED.includes(action);
const writes = action => WRITES.includes(action);
const needsVerification = (action, payload) => ['sendFriendRequest', 'openDirectChat'].includes(action) || action === 'respondFriendRequest' && payload.accept === true;

function upgrade(state) {
  let changed = false;
  TABLES.forEach(key => {
    if (state[key] === undefined) { state[key] = []; changed = true; }
    else if (!Array.isArray(state[key])) { const error = new Error('本机社交数据格式无法读取，请保留数据后重试'); error.code = 'STORAGE_INVALID'; throw error; }
  });
  return changed;
}
function removeUser(state, userId) {
  state.friendships = state.friendships.filter(item => !item.userIds.includes(userId));
  state.friendRequests = state.friendRequests.filter(item => item.fromId !== userId && item.toId !== userId);
  state.chatMessages = state.chatMessages.filter(item => item.senderId !== userId);
  state.conversations.forEach(item => {
    item.memberIds = item.memberIds.filter(id => id !== userId);
    item.readBy = item.readBy.filter(read => read.userId !== userId);
    item.leftIds = item.leftIds.filter(id => id !== userId);
    if (item.ownerId === userId) item.ownerId = item.memberIds[0] || '';
    if (item.createdBy === userId) { item.createdBy = ''; item.requestId = ''; }
    if (!item.memberIds.length) item.closed = true;
  });
}
function blockPair(state, left, right) {
  const pair = (a, b) => a === left && b === right || a === right && b === left;
  state.friendships = state.friendships.filter(item => !pair(item.userIds[0], item.userIds[1]));
  state.friendRequests.forEach(item => { if (item.status === 'pending' && pair(item.fromId, item.toId)) item.status = 'cancelled'; });
}

// Dispatch is synchronous over the caller's private snapshot. The demo service
// commits it once only after success, so failed validation/storage cannot leave
// half a friendship or consume a chat sequence number.
function dispatch(state, me, action, payload, helpers) {
  const { now, id: nextId, failure, textField, isBlockedPair } = helpers;
  const fail = (code, message) => { throw failure(code, message); };
  if (RETIRED.includes(action)) fail('FEATURE_UNAVAILABLE', '群聊功能已下线，请从作者主页给对方留言');
  const identifier = value => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) fail('INVALID_INPUT', '记录编号格式不正确');
    return value;
  };
  const active = user => user && !user.isEditorial && (!user.status || user.status === 'active');
  const user = userId => state.users.find(item => item.id === userId && active(item));
  const blocked = (a, b) => isBlockedPair(state, a, b);
  const friends = (a, b) => a !== b && state.friendships.some(item => item.userIds.includes(a) && item.userIds.includes(b));
  const request = (a, b) => state.friendRequests.find(item => item.fromId === a && item.toId === b && item.status === 'pending');
  const status = userId => friends(me.id, userId) ? 'friends' : request(me.id, userId) ? 'outgoing' : request(userId, me.id) ? 'incoming' : 'none';
  const person = value => ({ id: value.id, nickname: value.nickname, avatar: value.avatar || '', friendStatus: status(value.id) });
  const target = value => {
    const userId = identifier(value), found = user(userId);
    if (userId === me.id) fail('INVALID_INPUT', '请选择另一位宠友');
    if (!found || blocked(me.id, userId)) fail('NOT_FOUND', '这位宠友不存在或不可见');
    return found;
  };
  const limit = () => {
    const value = payload.limit === undefined ? 20 : payload.limit;
    if (!Number.isSafeInteger(value) || value < 1 || value > 50) fail('INVALID_INPUT', '每页数量需为 1–50');
    return value;
  };
  const hasCursor = () => payload.cursor !== undefined && payload.cursor !== null && payload.cursor !== '';
  const sequence = value => {
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_INPUT', '消息位置无效，请刷新后重试');
    return value;
  };
  const conversation = value => {
    const conversationId = identifier(value);
    const item = state.conversations.find(row => row.id === conversationId && !row.closed && row.memberIds.includes(me.id));
    if (!item || item.kind === 'direct' && item.memberIds.some(memberId => blocked(me.id, memberId))) fail('NOT_FOUND', '会话不存在或不可见');
    if (item.kind !== 'direct') fail('FEATURE_UNAVAILABLE', '群聊功能已下线，请从作者主页给对方留言');
    return item;
  };
  const messages = item => state.chatMessages.filter(row => row.conversationId === item.id && user(row.senderId) && !blocked(me.id, row.senderId)).sort((a, b) => b.seq - a.seq);
  const canSend = item => active(me) && me.verification && me.verification.status === 'demo_verified' &&
    item.kind === 'direct' && item.memberIds.length === 2 && item.memberIds.every(memberId => user(memberId) && !blocked(me.id, memberId));
  const project = (item, includeMembers) => {
    const visible = messages(item), last = visible[0];
    const read = item.readBy.find(row => row.userId === me.id);
    const other = item.memberIds.map(user).find(value => value && value.id !== me.id);
    return { id: item.id, kind: item.kind, name: item.kind === 'direct' ? other ? other.nickname : '已注销用户' : item.name,
      ownerId: item.ownerId, memberCount: item.memberIds.length, updatedAt: last ? last.createdAt : item.createdAt,
      lastText: last ? last.text : '', lastAt: last ? last.createdAt : 0, lastSeq: item.lastSeq,
      unreadCount: visible.filter(row => row.senderId !== me.id && row.seq > (read ? read.seq : 0)).length, canSend: !!canSend(item),
      ...(includeMembers ? { members: item.memberIds.map(user).filter(value => value && !blocked(me.id, value.id)).map(person) } : {}) };
  };
  const message = item => {
    const sender = user(item.senderId);
    return { id: item.id, seq: item.seq, text: item.text, createdAt: item.createdAt,
      sender: { id: sender.id, nickname: sender.nickname, avatar: sender.avatar || '' }, isMine: item.senderId === me.id };
  };
  const makeConversation = (kind, name, memberIds, requestId) => {
    const item = { id: nextId(state, 'chat'), kind, name, memberIds, ownerId: kind === 'group' ? me.id : '',
      createdBy: me.id, requestId, createdAt: now(), lastSeq: 0, readBy: [], leftIds: [], closed: false };
    state.conversations.push(item);
    return item;
  };
  if (!active(me)) fail('AUTH_REQUIRED', '请使用有效的宠友账号');
  switch (action) {
    case 'searchPeople': {
      const query = textField(payload.query, '搜索内容', 1, 60), lower = query.toLowerCase(), size = limit();
      const cursor = hasCursor() ? identifier(payload.cursor) : '';
      const rows = state.users.filter(value => active(value) && value.id !== me.id && !blocked(me.id, value.id) &&
        (value.id === query || (value.publicProfile === true || status(value.id) !== 'none') && (value.nickname || '').toLowerCase().includes(lower)) && (!cursor || value.id < cursor))
        .sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
      const page = rows.slice(0, size);
      return { items: page.map(person), ...(rows.length > size ? { nextCursor: page[page.length - 1].id } : {}) };
    }
    case 'getFriendHub': {
      const visible = userId => user(userId) && !blocked(me.id, userId);
      const pending = state.friendRequests.filter(item => item.status === 'pending').sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      return { friends: state.users.filter(value => active(value) && value.id !== me.id && friends(me.id, value.id) && visible(value.id)).map(person),
        incoming: pending.filter(item => item.toId === me.id && visible(item.fromId)).map(item => ({ id: item.id, from: person(user(item.fromId)), note: item.note, createdAt: item.createdAt })),
        outgoing: pending.filter(item => item.fromId === me.id && visible(item.toId)).map(item => ({ id: item.id, to: person(user(item.toId)), note: item.note, createdAt: item.createdAt })) };
    }
    case 'sendFriendRequest': {
      const other = target(payload.targetId), note = textField(payload.note === undefined ? '' : payload.note, '申请说明', 0, 100);
      if (friends(me.id, other.id)) return { success: true, status: 'friends' };
      if (request(other.id, me.id)) return { success: true, status: 'incoming' };
      if (!request(me.id, other.id)) state.friendRequests.push({ id: nextId(state, 'friend'), fromId: me.id, toId: other.id, note, status: 'pending', createdAt: now() });
      return { success: true, status: 'pending' };
    }
    case 'respondFriendRequest': {
      const requestId = identifier(payload.requestId);
      if (typeof payload.accept !== 'boolean') fail('INVALID_INPUT', '请选择同意或拒绝');
      const item = state.friendRequests.find(row => row.id === requestId && row.toId === me.id);
      if (!item) fail('NOT_FOUND', '好友申请不存在');
      if (item.status !== 'pending') return { success: true };
      if (payload.accept) {
        target(item.fromId);
        if (!friends(me.id, item.fromId)) state.friendships.push({ id: nextId(state, 'friends'), userIds: [me.id, item.fromId].sort(), createdAt: now() });
      }
      item.status = payload.accept ? 'accepted' : 'rejected';
      return { success: true };
    }
    case 'removeFriend': {
      const targetId = identifier(payload.targetId);
      if (targetId === me.id) fail('INVALID_INPUT', '请选择另一位宠友');
      state.friendships = state.friendships.filter(item => !(item.userIds.includes(me.id) && item.userIds.includes(targetId)));
      return { success: true };
    }
    case 'openDirectChat': {
      const other = target(payload.targetId);
      const existing = state.conversations.find(item => item.kind === 'direct' && !item.closed && item.memberIds.length === 2 && item.memberIds.includes(me.id) && item.memberIds.includes(other.id));
      return { conversation: project(existing || makeConversation('direct', '', [me.id, other.id], ''), true) };
    }
    case 'listConversations': {
      const query = textField(payload.query === undefined ? '' : payload.query, '搜索内容', 0, 60).toLowerCase(), size = limit();
      let anchor;
      if (hasCursor()) {
        const match = typeof payload.cursor === 'string' && /^c_(\d{1,16})_([A-Za-z0-9_-]{1,120})$/.exec(payload.cursor);
        if (!match || !Number.isSafeInteger(Number(match[1]))) fail('INVALID_INPUT', '会话分页位置无效');
        anchor = { updatedAt: Number(match[1]), id: match[2] };
      }
      const visible = state.conversations.filter(item => item.kind === 'direct' && !item.closed && item.memberIds.includes(me.id) && !(item.kind === 'direct' && item.memberIds.some(memberId => blocked(me.id, memberId))));
      const projected = visible.map(item => ({ raw: item, view: project(item, false) }));
      const unreadCount = projected.reduce((sum, item) => sum + item.view.unreadCount, 0);
      const rows = projected.filter(({ raw, view }) => (!query || [view.name, ...raw.memberIds.map(user).filter(value => value && !blocked(me.id, value.id)).map(value => value.nickname), ...messages(raw).map(value => value.text)].join(' ').toLowerCase().includes(query)) &&
        (!anchor || view.updatedAt < anchor.updatedAt || view.updatedAt === anchor.updatedAt && view.id < anchor.id)).map(item => item.view)
        .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const items = rows.slice(0, size), last = items[items.length - 1];
      return { items, unreadCount, ...(rows.length > size ? { nextCursor: 'c_' + last.updatedAt + '_' + last.id } : {}) };
    }
    case 'getChatMessages': {
      const item = conversation(payload.conversationId), size = limit();
      let cursor;
      if (hasCursor()) {
        if (typeof payload.cursor !== 'string' || !/^[1-9]\d*$/.test(payload.cursor)) fail('INVALID_INPUT', '消息分页位置无效');
        cursor = sequence(Number(payload.cursor));
      }
      const rows = messages(item).filter(row => cursor === undefined || row.seq < cursor), page = rows.slice(0, size);
      return { conversation: project(item, true), items: page.map(message), ...(rows.length > size ? { nextCursor: String(page[page.length - 1].seq) } : {}) };
    }
    case 'sendChatMessage': {
      const item = conversation(payload.conversationId), text = textField(payload.text, '消息', 1, 1000), requestId = identifier(payload.requestId);
      if (!me.verification || me.verification.status !== 'demo_verified') fail('VERIFICATION_REQUIRED', '请先完成本机模拟核验，再发送消息');
      if (!canSend(item)) fail('CHAT_UNAVAILABLE', '当前会话暂时无法发送消息，请刷新后重试');
      const previous = state.chatMessages.find(row => row.conversationId === item.id && row.senderId === me.id && row.requestId === requestId);
      if (previous) {
        if (previous.text !== text) fail('IDEMPOTENCY_CONFLICT', '本次发送编号已用于其他消息，请重试');
        return { message: message(previous) };
      }
      if (!Number.isSafeInteger(item.lastSeq + 1)) fail('LIMIT_REACHED', '当前会话消息数量已达上限');
      const row = { id: nextId(state, 'text'), conversationId: item.id, senderId: me.id, seq: item.lastSeq + 1, text, requestId, createdAt: now() };
      item.lastSeq = row.seq;
      state.chatMessages.push(row);
      return { message: message(row) };
    }
    case 'readConversation': {
      const item = conversation(payload.conversationId), through = sequence(payload.throughSeq);
      if (through > item.lastSeq) fail('INVALID_INPUT', '已读位置不能超过已发送的消息');
      const read = item.readBy.find(row => row.userId === me.id);
      if (read) read.seq = Math.max(read.seq, through);
      else item.readBy.push({ userId: me.id, seq: through });
      return { success: true };
    }
    default: fail('UNKNOWN_ACTION', '暂不支持这个操作');
  }
}

module.exports = { handles, writes, needsVerification, upgrade, removeUser, blockPair, dispatch };
