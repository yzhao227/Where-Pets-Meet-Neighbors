'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createService, idFor, TERMS_VERSION, PRIVACY_VERSION } = require('../cloudfunctions/community/service');
const { COLLECTIONS } = require('../cloudfunctions/community/repository');
const { DEFAULT_RATE_LIMITS } = require('../cloudfunctions/community/runtime-config');
const consent = { accepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };
const runtimeConfig = { name: '社交测试运营团队', contact: 'social@example.invalid', retention: '仅内存测试，结束后不保留任何账号和聊天内容。', policyApproved: true };

function memoryRepository() {
  let tables = new Map(); let lock = Promise.resolve(); let fault;
  const table = (state, name) => { if (!state.has(name)) state.set(name, new Map()); return state.get(name); };
  const access = state => ({
    async get(name, id) { return structuredClone(table(state, name).get(id) || null); },
    async set(name, id, value) {
      if (fault) fault(name, id, value);
      table(state, name).set(id, structuredClone({ ...value, _id: id }));
    },
    async remove(name, id) { if (fault) fault(name, id, null); table(state, name).delete(id); }
  });
  const matches = (actual, expected) => {
    if (!expected || typeof expected !== 'object') return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
    return Object.entries(expected).every(([op, value]) => op === 'gt' ? actual > value : op === 'lt' ? actual < value : op === 'in' ? value.includes(actual) : actual === value);
  };
  return {
    get: (...args) => access(tables).get(...args), set: (...args) => access(tables).set(...args), remove: (...args) => access(tables).remove(...args),
    async find(name, filters = {}, options = {}) {
      const records = [...table(tables, name).values()].filter(record => Object.entries(filters).every(([key, value]) => matches(record[key], value)));
      if (options.orderBy) records.sort((a, b) => a[options.orderBy] < b[options.orderBy] ? -1 : a[options.orderBy] > b[options.orderBy] ? 1 : 0);
      if (options.direction === 'desc') records.reverse();
      return structuredClone(records.slice(0, options.limit || 20));
    },
    transaction(fn) {
      const job = lock.then(async () => { const copy = structuredClone(tables); const result = await fn(access(copy)); tables = copy; return result; });
      lock = job.catch(() => {}); return job;
    },
    fault(callback) { fault = callback; }
  };
}

async function fixture(options = {}) {
  const repository = memoryRepository(); let serial = 0; let time = 1_800_000_000_000;
  const checks = [];
  const service = createService({ repository, now: () => time, randomId: () => String(++serial).padStart(24, '0'), adminOpenids: ['alice'], runtimeConfig: { ...runtimeConfig, ...options.runtimeConfig },
    phoneVerifier: { enabled: true, async verifyCode(code) { return { phoneKey: 'ph_' + crypto.createHash('sha256').update(code).digest('hex'), maskedPhone: '+86 138****0000' }; } },
    moderateText: async (text, openid) => { checks.push({ text, openid }); if (options.moderateText) await options.moderateText(text, openid); }
  });
  const call = (who, action, payload = {}) => service.handle(action, payload, { openid: who });
  await call('alice', 'initialize', { city: '内存测试城市', areas: ['内部片区'], contact: 'social@example.invalid' });
  for (const who of ['alice', 'bob', 'charlie', 'diana']) {
    await call(who, 'bootstrap');
    if (options.verified !== false) await call(who, 'verifyPhone', { code: 'test-' + who, consent });
    await call(who, 'updateProfile', { nickname: who === 'bob' ? 'CATBuddy' : who, publicProfile: who !== 'diana', bio: 'PRIVATE_BIO', area: '内部片区' });
  }
  return { repository, service, call, checks, advance(ms = 1) { time += ms; } };
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
async function friend(f, from = 'alice', to = 'bob') {
  await f.call(from, 'sendFriendRequest', { targetId: idFor(to), note: '一起聊宠物' });
  const request = (await f.call(to, 'getFriendHub')).incoming.find(item => item.from.id === idFor(from));
  assert.ok(request);
  await f.call(to, 'respondFriendRequest', { requestId: request.id, accept: true });
  return request.id;
}
async function direct(f, from = 'alice', to = 'bob') {
  await friend(f, from, to);
  return (await f.call(from, 'openDirectChat', { targetId: idFor(to) })).conversation;
}
const send = (f, who, conversationId, text, requestId) => f.call(who, 'sendChatMessage', { conversationId, text, requestId });

test('cloud friend discovery respects public profiles, exact IDs, pending relations and privacy; friendship needs receiver consent', async () => {
  const f = await fixture();
  assert.deepEqual(await f.call('alice', 'getFriendHub'), { friends: [], incoming: [], outgoing: [] });
  assert.deepEqual(await f.call('alice', 'listConversations'), { items: [], unreadCount: 0 });
  const results = (await f.call('alice', 'searchPeople', { query: '  catBUDDY  ' })).items;
  assert.equal(results.length, 1); assert.deepEqual(Object.keys(results[0]).sort(), ['avatar', 'friendStatus', 'id', 'nickname']);
  assert.deepEqual((await f.call('alice', 'searchPeople', { query: 'diana' })).items, []);
  assert.equal((await f.call('alice', 'searchPeople', { query: idFor('diana') })).items[0].id, idFor('diana'));
  assert.deepEqual((await f.call('alice', 'searchPeople', { query: 'PRIVATE_BIO' })).items, []);
  await f.call('alice', 'followUser', { userId: idFor('diana'), follow: true });
  assert.deepEqual((await f.call('alice', 'searchPeople', { query: 'diana' })).items, [], 'follow does not grant friendship or private discovery');
  await rejects(f.call('alice', 'openDirectChat', { targetId: idFor('bob') }), 'FRIEND_REQUIRED');
  const first = await f.call('alice', 'sendFriendRequest', { targetId: idFor('diana'), note: '你好' });
  assert.equal(first.status, 'pending');
  assert.equal((await f.call('alice', 'sendFriendRequest', { targetId: idFor('diana'), note: '重复不会覆盖' })).status, 'pending');
  assert.equal((await f.call('diana', 'sendFriendRequest', { targetId: idFor('alice') })).status, 'incoming');
  const hub = await f.call('diana', 'getFriendHub');
  assert.equal(hub.incoming.length, 1); assert.equal(hub.incoming[0].note, '你好');
  assert.equal((await f.call('alice', 'searchPeople', { query: 'diana' })).items[0].friendStatus, 'outgoing');
  const requestId = hub.incoming[0].id;
  await rejects(f.call('charlie', 'respondFriendRequest', { requestId, accept: true }), 'NOT_FOUND');
  await rejects(f.call('alice', 'respondFriendRequest', { requestId, accept: true }), 'NOT_FOUND');
  await f.call('diana', 'respondFriendRequest', { requestId, accept: true });
  await f.call('diana', 'respondFriendRequest', { requestId, accept: false });
  assert.equal((await f.call('alice', 'getFriendHub')).friends[0].id, idFor('diana'));
  assert.equal((await f.call('diana', 'getFriendHub')).friends[0].id, idFor('alice'));
  await f.call('alice', 'removeFriend', { targetId: idFor('diana') });
  await f.call('diana', 'respondFriendRequest', { requestId, accept: true });
  assert.equal((await f.call('alice', 'getFriendHub')).friends.length, 0, 'retrying an old acceptance cannot re-add a removed friend');
  await f.call('alice', 'sendFriendRequest', { targetId: idFor('diana') });
  const renewed = (await f.call('diana', 'getFriendHub')).incoming[0];
  assert.notEqual(renewed.id, requestId);
  await f.call('diana', 'respondFriendRequest', { requestId: renewed.id, accept: false });
  assert.deepEqual((await f.call('alice', 'searchPeople', { query: 'diana' })).items, []);
  await rejects(f.call('alice', 'searchPeople', { query: '  ' }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'sendFriendRequest', { targetId: idFor('alice') }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'sendFriendRequest', { targetId: idFor('bob'), note: '字'.repeat(101) }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'getFriendHub', { userId: idFor('bob') }), 'INVALID_INPUT');
});

test('cloud direct chats share one stable conversation, atomically allocate sequences and keep precise unread boundaries under retries', async () => {
  const f = await fixture(); await friend(f);
  const opened = await Promise.all([f.call('alice', 'openDirectChat', { targetId: idFor('bob') }), f.call('bob', 'openDirectChat', { targetId: idFor('alice') })]);
  const id = opened[0].conversation.id; assert.equal(opened[1].conversation.id, id);
  const repeated = await Promise.all([send(f, 'alice', id, '猫咪今天很好', 'one'), send(f, 'alice', id, '猫咪今天很好', 'one')]);
  assert.deepEqual(repeated[0], repeated[1]); assert.equal(repeated[0].message.seq, 1);
  await rejects(send(f, 'alice', id, '同键不同内容', 'one'), 'IDEMPOTENCY_CONFLICT');
  const newer = await send(f, 'bob', id, '收到，明天再聊', 'two');
  assert.equal(newer.message.seq, 2); assert.equal(newer.message.createdAt, repeated[0].message.createdAt);
  const bob = await f.call('bob', 'getChatMessages', { conversationId: id, limit: 1 });
  assert.deepEqual(bob.items.map(message => message.seq), [2]); assert.equal(bob.nextCursor, '2');
  assert.equal(bob.conversation.unreadCount, 1);
  const older = await f.call('bob', 'getChatMessages', { conversationId: id, cursor: bob.nextCursor });
  assert.deepEqual(older.items.map(message => message.seq), [1]);
  await send(f, 'alice', id, '同时刚来的新消息', 'three');
  await f.call('bob', 'readConversation', { conversationId: id, throughSeq: 2 });
  assert.equal((await f.call('bob', 'listConversations')).unreadCount, 1);
  await f.call('bob', 'readConversation', { conversationId: id, throughSeq: 1 });
  assert.equal((await f.call('bob', 'listConversations')).unreadCount, 1);
  await rejects(f.call('bob', 'readConversation', { conversationId: id, throughSeq: 4 }), 'INVALID_INPUT');
  for (const action of ['getChatMessages', 'readConversation', 'sendChatMessage']) await rejects(f.call('charlie', action, { conversationId: id, throughSeq: 1, text: '越权', requestId: 'attacker' }), 'NOT_FOUND');
  assert.deepEqual((await f.call('charlie', 'listConversations', { query: '猫咪' })).items, []);
  await f.call('alice', 'removeFriend', { targetId: idFor('bob') });
  const history = await f.call('bob', 'getChatMessages', { conversationId: id });
  assert.equal(history.items.length, 3); assert.equal(history.conversation.canSend, false);
  await rejects(send(f, 'bob', id, '不能继续发送', 'four'), 'FRIEND_REQUIRED');
  for (const query of [null, '字'.repeat(61)]) await rejects(f.call('bob', 'listConversations', { query }), 'INVALID_INPUT');
  await rejects(f.call('bob', 'getChatMessages', { conversationId: id, cursor: false }), 'INVALID_INPUT');
  await rejects(f.call('bob', 'listConversations', { cursor: 'bad-cursor' }), 'INVALID_INPUT');
});

test('cloud groups validate confirmed friends and every blocked pair, creation retries are stable, and departing owners lose access', async () => {
  const f = await fixture(); await friend(f); await friend(f, 'alice', 'charlie');
  for (const memberIds of [[], [idFor('alice')], [idFor('bob'), idFor('bob')], Array.from({ length: 20 }, (_, index) => 'member' + index)]) {
    await rejects(f.call('alice', 'createGroupChat', { name: '猫咪小队', memberIds, requestId: 'invalid' }), 'INVALID_INPUT');
  }
  await rejects(f.call('alice', 'createGroupChat', { name: '猫咪小队', memberIds: [idFor('diana')], requestId: 'nonfriend' }), 'FRIEND_REQUIRED');
  await f.call('bob', 'blockUser', { userId: idFor('charlie'), block: true });
  await rejects(f.call('alice', 'createGroupChat', { name: '猫咪小队', memberIds: [idFor('bob'), idFor('charlie')], requestId: 'blocked' }), 'MEMBER_UNAVAILABLE');
  await f.call('bob', 'blockUser', { userId: idFor('charlie'), block: false });
  const payload = { name: '猫咪小队', memberIds: [idFor('bob'), idFor('charlie')], requestId: 'group-one' };
  const created = await Promise.all([f.call('alice', 'createGroupChat', payload), f.call('alice', 'createGroupChat', payload)]);
  const id = created[0].conversation.id; assert.equal(created[1].conversation.id, id); assert.equal(created[0].conversation.memberCount, 3);
  await rejects(f.call('alice', 'createGroupChat', { ...payload, name: '变更名称' }), 'IDEMPOTENCY_CONFLICT');
  await send(f, 'bob', id, '大家好', 'hello');
  assert.equal((await f.call('charlie', 'getChatMessages', { conversationId: id })).items[0].sender.id, idFor('bob'));
  await rejects(send(f, 'diana', id, '猜到编号', 'not-member'), 'NOT_FOUND');
  await f.call('alice', 'leaveGroup', { conversationId: id });
  await f.call('alice', 'leaveGroup', { conversationId: id });
  const continued = await f.call('bob', 'getChatMessages', { conversationId: id });
  assert.equal(continued.conversation.ownerId, idFor('bob')); assert.equal(continued.conversation.memberCount, 2);
  await rejects(f.call('alice', 'getChatMessages', { conversationId: id }), 'NOT_FOUND');
  await rejects(f.call('alice', 'createGroupChat', payload), 'NOT_FOUND');
  await f.call('bob', 'leaveGroup', { conversationId: id });
  await f.call('charlie', 'leaveGroup', { conversationId: id });
  assert.equal((await f.repository.get('conversations', id)).status, 'closed');
  assert.deepEqual((await f.call('charlie', 'listConversations')).items, []);
});

test('cloud conversation search and previews filter blocked senders and preserve global visible unread totals across pages', async () => {
  const f = await fixture(); const directChat = await direct(f); await friend(f, 'alice', 'charlie');
  const group = (await f.call('alice', 'createGroupChat', { name: '狗狗邻居', memberIds: [idFor('bob'), idFor('charlie')], requestId: 'group' })).conversation;
  const quiet = (await f.call('alice', 'createGroupChat', { name: '安静的小组', memberIds: [idFor('charlie')], requestId: 'quiet' })).conversation;
  await send(f, 'bob', directChat.id, 'ONLY_BLOCKED_DIRECT', 'direct');
  await send(f, 'charlie', group.id, 'TaRgEt 可见文字', 'visible');
  f.advance(); await send(f, 'bob', group.id, 'ONLY_BLOCKED_GROUP', 'hidden');
  await send(f, 'charlie', quiet.id, '另一个 target', 'quiet');
  const totalBefore = (await f.call('alice', 'listConversations')).unreadCount; assert.equal(totalBefore, 4);
  await f.call('bob', 'blockUser', { userId: idFor('alice'), block: true });
  const visible = await f.call('alice', 'listConversations');
  assert.equal(visible.items.length, 2); assert.equal(visible.unreadCount, 2);
  const groupView = visible.items.find(item => item.id === group.id);
  assert.equal(groupView.lastText, 'TaRgEt 可见文字'); assert.equal(groupView.memberCount, 3);
  assert.equal(groupView.members.some(member => member.id === idFor('bob')), false);
  assert.equal(groupView.canSend, true);
  assert.deepEqual((await f.call('alice', 'getChatMessages', { conversationId: group.id })).items.map(item => item.sender.id), [idFor('charlie')]);
  await rejects(f.call('alice', 'getChatMessages', { conversationId: directChat.id }), 'NOT_FOUND');
  for (const query of ['ONLY_BLOCKED', 'catbuddy', 'PRIVATE_BIO']) {
    const page = await f.call('alice', 'listConversations', { query }); assert.deepEqual(page.items, []); assert.equal(page.unreadCount, 2);
  }
  const first = await f.call('alice', 'listConversations', { query: ' target ', limit: 1 });
  const second = await f.call('alice', 'listConversations', { query: ' TARGET ', limit: 1, cursor: first.nextCursor });
  assert.equal(first.unreadCount, 2); assert.equal(second.unreadCount, 2);
  assert.notEqual(first.items[0].id, second.items[0].id); assert.equal(second.nextCursor, undefined);
  await send(f, 'alice', group.id, '群内仍然可以交流', 'after-block');
  assert.equal((await f.call('bob', 'getChatMessages', { conversationId: group.id })).items.some(item => item.sender.id === idFor('alice')), false);
  await f.call('bob', 'blockUser', { userId: idFor('alice'), block: false });
  assert.equal((await f.call('alice', 'getFriendHub')).friends.some(person => person.id === idFor('bob')), false);
  assert.equal((await f.call('alice', 'getChatMessages', { conversationId: directChat.id })).conversation.canSend, false);
});

test('cloud social writes require verification and moderation; existing reads, rejection, removal and leaving stay available', async () => {
  const f = await fixture({ moderateText: async text => { if (text.includes('REJECT')) throw Object.assign(new Error('内容未通过审核'), { code: 'CONTENT_REJECTED' }); } });
  await rejects(f.call('alice', 'sendFriendRequest', { targetId: idFor('bob'), note: 'REJECT申请' }), 'CONTENT_REJECTED');
  assert.equal((await f.call('bob', 'getFriendHub')).incoming.length, 0);
  const chat = await direct(f);
  await rejects(f.call('alice', 'createGroupChat', { name: 'REJECT群名', memberIds: [idFor('bob')], requestId: 'reject' }), 'CONTENT_REJECTED');
  await rejects(send(f, 'alice', chat.id, 'REJECT正文', 'reject'), 'CONTENT_REJECTED');
  assert.equal((await f.call('alice', 'getChatMessages', { conversationId: chat.id })).items.length, 0);
  const group = (await f.call('alice', 'createGroupChat', { name: '可用群聊', memberIds: [idFor('bob')], requestId: 'allowed' })).conversation;
  await f.call('charlie', 'sendFriendRequest', { targetId: idFor('alice') });
  const incoming = (await f.call('alice', 'getFriendHub')).incoming[0];
  await f.repository.remove('identities', idFor('alice'));
  for (const [action, payload] of [
    ['sendFriendRequest', { targetId: idFor('diana') }], ['respondFriendRequest', { requestId: incoming.id, accept: true }],
    ['openDirectChat', { targetId: idFor('bob') }], ['createGroupChat', { name: '新群', memberIds: [idFor('bob')], requestId: 'unverified' }],
    ['sendChatMessage', { conversationId: chat.id, text: '未核验消息', requestId: 'unverified' }]
  ]) await rejects(f.call('alice', action, payload), 'VERIFICATION_REQUIRED');
  await f.call('alice', 'getChatMessages', { conversationId: chat.id });
  await f.call('alice', 'readConversation', { conversationId: chat.id, throughSeq: 0 });
  await f.call('alice', 'respondFriendRequest', { requestId: incoming.id, accept: false });
  await f.call('alice', 'removeFriend', { targetId: idFor('bob') });
  await f.call('alice', 'leaveGroup', { conversationId: group.id });
  assert.ok(f.checks.some(check => check.text === '可用群聊' && check.openid === 'alice'));
  await rejects(send(f, 'bob', chat.id, '字'.repeat(1001), 'long'), 'INVALID_INPUT');
});

test('cloud account deletion clears social data and cannot transfer old chat membership or an in-flight write to a new lifecycle', async () => {
  let release, reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const f = await fixture({ moderateText: async text => { if (text === 'DELAYED_OLD_ACCOUNT') { reached(); await new Promise(resolve => { release = resolve; }); } } });
  const chat = await direct(f); await friend(f, 'alice', 'charlie');
  const group = (await f.call('alice', 'createGroupChat', { name: '继续聊宠物', memberIds: [idFor('bob'), idFor('charlie')], requestId: 'delete-group' })).conversation;
  await send(f, 'alice', chat.id, '注销时清除本人私聊文字', 'own-direct');
  await send(f, 'bob', chat.id, '其他成员保留的历史', 'other-direct');
  await send(f, 'alice', group.id, '注销时清除本人群聊文字', 'own-group');
  await f.call('alice', 'readConversation', { conversationId: chat.id, throughSeq: 2 });
  await f.call('diana', 'sendFriendRequest', { targetId: idFor('alice') });
  const pending = send(f, 'alice', group.id, 'DELAYED_OLD_ACCOUNT', 'delayed');
  await entered;
  await f.call('alice', 'deleteAccount');
  await f.call('alice', 'bootstrap');
  await f.call('alice', 'verifyPhone', { code: 'test-alice', consent });
  release(); await rejects(pending, 'ACCOUNT_UNAVAILABLE');
  assert.deepEqual(await f.call('alice', 'getFriendHub'), { friends: [], incoming: [], outgoing: [] });
  assert.deepEqual((await f.call('alice', 'listConversations')).items, []);
  await rejects(f.call('alice', 'getChatMessages', { conversationId: chat.id }), 'NOT_FOUND');
  await rejects(f.call('alice', 'getChatMessages', { conversationId: group.id }), 'NOT_FOUND');
  const history = await f.call('bob', 'getChatMessages', { conversationId: chat.id });
  assert.deepEqual(history.items.map(item => item.text), ['其他成员保留的历史']); assert.equal(history.conversation.canSend, false);
  assert.equal((await f.call('bob', 'getChatMessages', { conversationId: group.id })).conversation.ownerId, idFor('bob'));
  for (const table of ['friend_requests', 'friendships', 'chat_reads']) {
    const rows = await f.repository.find(table, {}, { limit: 100 });
    assert.ok(rows.every(row => row.userId !== idFor('alice') && row.fromId !== idFor('alice') && row.toId !== idFor('alice') && !(row.memberIds || []).includes(idFor('alice'))));
  }
  assert.deepEqual(await f.repository.find('chat_messages', { senderId: idFor('alice') }), []);
  const replacement = await direct(f);
  assert.notEqual(replacement.id, chat.id); assert.equal(replacement.lastSeq, 0);
});

test('cloud social transaction failures preserve existing sequences and do not leave partial requests or memberships', async () => {
  const f = await fixture();
  let failRelation = true;
  f.repository.fault(name => { if (name === 'friendships' && failRelation) { failRelation = false; throw new Error('transaction failure'); } });
  await assert.rejects(f.call('alice', 'sendFriendRequest', { targetId: idFor('bob') }), /transaction failure/);
  assert.deepEqual((await f.call('bob', 'getFriendHub')).incoming, []);
  assert.deepEqual(await f.repository.find('friend_requests'), []);
  f.repository.fault(null);
  const chat = await direct(f);
  let failSequence = true;
  f.repository.fault((name, id, value) => { if (name === 'conversations' && value && value.lastSeq === 1 && failSequence) { failSequence = false; throw new Error('sequence failure'); } });
  await assert.rejects(send(f, 'alice', chat.id, '必须完整提交', 'retry'), /sequence failure/);
  assert.deepEqual((await f.call('bob', 'getChatMessages', { conversationId: chat.id })).items, []);
  assert.equal((await f.repository.get('conversations', chat.id)).lastSeq, 0);
  f.repository.fault(null);
  assert.equal((await send(f, 'alice', chat.id, '必须完整提交', 'retry')).message.seq, 1);
  assert.equal((await f.call('bob', 'listConversations')).unreadCount, 1);
});

test('social database requirements and mutation rate limits are registered consistently', () => {
  const schema = require('../infra/database.schema.json');
  assert.deepEqual(require('../cloudfunctions/setup/schema.json'), schema);
  for (const name of ['friend_requests', 'friendships', 'conversations', 'chat_messages', 'chat_reads']) {
    assert.ok(COLLECTIONS.includes(name));
    const collection = schema.collections.find(item => item.name === 'yb_' + name);
    assert.deepEqual(collection.rules, { read: false, write: false }); assert.ok(collection.indexes.length);
  }
  for (const action of ['sendFriendRequest', 'respondFriendRequest', 'createGroupChat', 'openDirectChat', 'sendChatMessage']) assert.ok(DEFAULT_RATE_LIMITS[action]);
});
