const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoService } = require('../miniprogram/services/demo');
const { createSeed, newUser } = require('../miniprogram/data/seed');

const EPOCH = Date.UTC(2026, 8, 30, 8);
const KEY = 'social-test-memory';
const clone = value => JSON.parse(JSON.stringify(value));
const consent = { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' };

async function fixture() {
  let saved = createSeed(EPOCH), time = EPOCH, rejectWrites = false;
  for (const [id, nickname, publicProfile] of [['alice', '测试猫友甲', true], ['bob', '测试Cat乙', false], ['charlie', '测试Cat丙', true], ['dana', '测试Cat丁', true], ['unverified', '未核验测试宠友', false]]) {
    saved.users.push({ ...newUser(id, false), nickname, publicProfile, bio: 'PRIVATE_BIO', area: 'PRIVATE_AREA', phone: 'PRIVATE_PHONE' });
  }
  saved.users.push({ ...newUser('editor', false), nickname: '测试Cat编辑', publicProfile: true, isEditorial: true });
  const clients = {};
  for (const who of ['alice', 'bob', 'charlie', 'dana', 'unverified', 'editor']) clients[who] = createDemoService({
    getStorageSync(key) { assert.equal(key, KEY); return { ...clone(saved), currentUserId: who }; },
    setStorageSync(key, state) { if (key !== KEY) return; if (rejectWrites) throw new Error('memory disk full'); saved = clone(state); }
  }, { storageKey: KEY, now: () => time });
  for (const who of ['alice', 'bob', 'charlie', 'dana']) await clients[who].call('demoVerifyIdentity', { consent });
  const call = (who, action, payload) => clients[who].call(action, payload);
  const befriend = async (a, b) => {
    await call(a, 'sendFriendRequest', { targetId: b });
    const incoming = (await call(b, 'getFriendHub')).incoming.find(item => item.from.id === a);
    await call(b, 'respondFriendRequest', { requestId: incoming.id, accept: true });
  };
  return { call, befriend, state: () => clone(saved), edit: fn => fn(saved), tick: () => { time += 1000; }, failWrites: value => { rejectWrites = value; } };
}

function legacyGroup(f) {
  const id = 'legacy-group';
  f.edit(state => {
    state.conversations.push({ id, kind: 'group', name: 'LEGACY_GROUP_ONLY', memberIds: ['alice', 'bob', 'charlie', 'unverified'], ownerId: 'alice',
      createdBy: 'alice', requestId: 'legacy', createdAt: EPOCH, lastSeq: 2, readBy: [], leftIds: [], closed: false });
    for (const [index, senderId] of ['alice', 'bob'].entries()) state.chatMessages.push({ id: 'legacy-message-' + index, conversationId: id,
      senderId, seq: index + 1, text: 'LEGACY_GROUP_ONLY', requestId: 'legacy-' + index, createdAt: EPOCH });
  });
  return id;
}

test('social upgrade preserves existing data and a new device has no fabricated social activity', async () => {
  let saved;
  const api = createDemoService({ getStorageSync: () => saved, setStorageSync: (key, value) => { saved = clone(value); } }, { now: () => EPOCH, storageKey: KEY });
  assert.deepEqual(await api.call('getFriendHub'), { friends: [], incoming: [], outgoing: [] });
  assert.deepEqual(await api.call('listConversations'), { items: [], unreadCount: 0 });
  assert.deepEqual((await api.call('searchPeople', { query: '猫' })).items, []);
  assert.equal(saved.users.filter(item => !item.isEditorial).length, 1);
  const f = await fixture();
  const before = f.state();
  f.edit(state => { for (const key of ['friendships', 'friendRequests', 'conversations', 'chatMessages']) delete state[key]; });
  await f.call('alice', 'getFriendHub');
  for (const key of ['users', 'posts', 'comments', 'follows', 'messages', 'circles']) assert.deepEqual(f.state()[key], before[key]);
  f.edit(state => { state.conversations = { broken: true }; });
  const broken = f.state();
  await assert.rejects(f.call('alice', 'getFriendHub'), { code: 'STORAGE_INVALID' });
  assert.deepEqual(f.state(), broken);
});

test('people discovery exposes only allowed public fields and handles exact IDs, pending relations and paging', async () => {
  const f = await fixture();
  const first = await f.call('alice', 'searchPeople', { query: '  CAT  ', limit: 1 });
  const second = await f.call('alice', 'searchPeople', { query: 'cat', limit: 1, cursor: first.nextCursor });
  assert.deepEqual([first.items[0].id, second.items[0].id].sort(), ['charlie', 'dana']);
  assert.equal(second.nextCursor, undefined);
  assert.deepEqual(Object.keys(first.items[0]).sort(), ['avatar', 'friendStatus', 'id', 'nickname']);
  assert.deepEqual((await f.call('alice', 'searchPeople', { query: 'PRIVATE' })).items, []);
  assert.deepEqual((await f.call('alice', 'searchPeople', { query: 'BOB' })).items, []);
  assert.equal((await f.call('alice', 'searchPeople', { query: 'bob' })).items[0].id, 'bob');
  await f.call('alice', 'followUser', { userId: 'bob', follow: true });
  assert.deepEqual((await f.call('alice', 'searchPeople', { query: '测试Cat乙' })).items, []);
  await f.call('alice', 'sendFriendRequest', { targetId: 'bob', note: '一起聊猫吧', userId: 'charlie' });
  assert.equal((await f.call('alice', 'searchPeople', { query: '测试Cat乙' })).items[0].friendStatus, 'outgoing');
  const incoming = (await f.call('bob', 'getFriendHub')).incoming[0];
  assert.equal(incoming.from.id, 'alice');
  assert.equal(incoming.note, '一起聊猫吧');
  assert.equal(JSON.stringify(incoming).includes('PRIVATE'), false);
  for (const query of ['', ' ', null, 2, '猫'.repeat(61)]) await assert.rejects(f.call('alice', 'searchPeople', { query }), { code: 'INVALID_INPUT' });
  for (const targetId of ['alice', 'editor', 'missing']) await assert.rejects(f.call('alice', 'sendFriendRequest', { targetId }));
});

test('friend requests require recipient confirmation, remain independent of follow, and retry safely', async () => {
  const f = await fixture();
  await Promise.all([f.call('alice', 'sendFriendRequest', { targetId: 'bob' }), f.call('alice', 'sendFriendRequest', { targetId: 'bob' })]);
  assert.equal(f.state().friendRequests.length, 1);
  assert.deepEqual(await f.call('bob', 'sendFriendRequest', { targetId: 'alice' }), { success: true, status: 'incoming' });
  const requestId = (await f.call('bob', 'getFriendHub')).incoming[0].id;
  await assert.rejects(f.call('charlie', 'respondFriendRequest', { requestId, accept: true, userId: 'bob' }), { code: 'NOT_FOUND' });
  await f.call('bob', 'respondFriendRequest', { requestId, accept: false });
  await f.call('bob', 'respondFriendRequest', { requestId, accept: true });
  assert.equal(f.state().friendships.length, 0);
  assert.equal((await f.call('alice', 'searchPeople', { query: '测试Cat乙' })).items.length, 0);
  await f.befriend('alice', 'bob');
  assert.equal((await f.call('alice', 'getFriendHub')).friends[0].id, 'bob');
  assert.equal((await f.call('bob', 'getFriendHub')).friends[0].id, 'alice');
  assert.equal(f.state().follows.length, 0);
  assert.deepEqual(await f.call('alice', 'sendFriendRequest', { targetId: 'bob' }), { success: true, status: 'friends' });
  const accepted = f.state().friendRequests.find(item => item.status === 'accepted');
  await f.call('alice', 'removeFriend', { targetId: 'bob' });
  await f.call('bob', 'respondFriendRequest', { requestId: accepted.id, accept: true });
  assert.equal(f.state().friendships.length, 0, 'retrying an old acceptance cannot restore a removed friendship');
});

test('social writes use existing verification while declines and private history remain available', async () => {
  const f = await fixture();
  for (const [action, payload] of [['sendFriendRequest', { targetId: 'alice' }], ['openDirectChat', { targetId: 'alice' }]]) {
    await assert.rejects(f.call('unverified', action, payload), { code: 'VERIFICATION_REQUIRED' });
  }
  await f.call('alice', 'sendFriendRequest', { targetId: 'unverified' });
  const requestId = (await f.call('unverified', 'getFriendHub')).incoming[0].id;
  await assert.rejects(f.call('unverified', 'respondFriendRequest', { requestId, accept: true }), { code: 'VERIFICATION_REQUIRED' });
  await f.call('unverified', 'respondFriendRequest', { requestId, accept: false });
  await f.befriend('alice', 'bob');
  const { conversation } = await f.call('alice', 'openDirectChat', { targetId: 'bob' });
  await f.call('alice', 'sendChatMessage', { conversationId: conversation.id, text: '已保存的测试文字', requestId: 'first' });
  f.edit(state => { const bob = state.users.find(item => item.id === 'bob'); bob.verification = { status: 'unverified' }; delete bob.demoConsent; });
  const history = await f.call('bob', 'getChatMessages', { conversationId: conversation.id });
  assert.equal(history.items.length, 1); assert.equal(history.conversation.canSend, false);
  await assert.rejects(f.call('bob', 'sendChatMessage', { conversationId: conversation.id, text: '需核验', requestId: 'unverified' }), { code: 'VERIFICATION_REQUIRED' });
  await f.call('bob', 'readConversation', { conversationId: conversation.id, throughSeq: 1 });
  await f.call('bob', 'removeFriend', { targetId: 'alice' });
  assert.equal((await f.call('alice', 'getChatMessages', { conversationId: conversation.id })).conversation.canSend, true, 'removing friendship does not disable direct chat');
});

test('direct chat is shared, authorized, idempotent and ordered with concurrent same-millisecond sends', async () => {
  const f = await fixture();
  const opened = await Promise.all([f.call('alice', 'openDirectChat', { targetId: 'bob' }), f.call('bob', 'openDirectChat', { targetId: 'alice' })]);
  const conversationId = opened[0].conversation.id;
  assert.equal(opened[1].conversation.id, conversationId);
  assert.equal(f.state().conversations.length, 1);
  for (const action of ['getChatMessages', 'sendChatMessage', 'readConversation']) await assert.rejects(f.call('charlie', action, { conversationId, userId: 'alice', text: '越权', requestId: 'bad', throughSeq: 0 }), { code: 'NOT_FOUND' });
  const results = await Promise.all([
    f.call('alice', 'sendChatMessage', { conversationId, text: '文字一', requestId: 'a1' }),
    f.call('bob', 'sendChatMessage', { conversationId, text: '文字二', requestId: 'b1' }),
    f.call('alice', 'sendChatMessage', { conversationId, text: '文字一', requestId: 'a1' })
  ]);
  assert.equal(results[0].message.id, results[2].message.id);
  assert.deepEqual(f.state().chatMessages.map(item => item.seq), [1, 2]);
  assert.equal(results[0].message.createdAt, results[1].message.createdAt);
  await assert.rejects(f.call('alice', 'sendChatMessage', { conversationId, text: '不同内容', requestId: 'a1' }), { code: 'IDEMPOTENCY_CONFLICT' });
  const first = await f.call('alice', 'getChatMessages', { conversationId, limit: 1 });
  const second = await f.call('alice', 'getChatMessages', { conversationId, limit: 1, cursor: first.nextCursor });
  assert.deepEqual([first.items[0].seq, second.items[0].seq], [2, 1]);
  assert.equal(first.items[0].isMine, false); assert.equal(second.items[0].isMine, true);
  assert.deepEqual(Object.keys(first.items[0].sender).sort(), ['avatar', 'id', 'nickname']);
  assert.equal((await f.call('alice', 'listConversations')).unreadCount, 1, 'fetching does not read');
  await f.call('alice', 'removeFriend', { targetId: 'bob' });
  assert.equal((await f.call('alice', 'getChatMessages', { conversationId })).items.length, 2);
  assert.equal((await f.call('alice', 'sendChatMessage', { conversationId, text: '仍可交流', requestId: 'a2' })).message.seq, 3);
  assert.equal((await f.call('bob', 'openDirectChat', { targetId: 'alice' })).conversation.id, conversationId);
  assert.deepEqual(f.state().friendships, [], 'direct messages never grant friendship');
});

test('private chats exclude editorial and inactive users, and account recreation cannot inherit old chats', async () => {
  const f = await fixture();
  for (const targetId of ['editor', 'missing']) await assert.rejects(f.call('alice', 'openDirectChat', { targetId }), { code: 'NOT_FOUND' });
  await assert.rejects(f.call('alice', 'openDirectChat', { targetId: 'alice' }), { code: 'INVALID_INPUT' });
  const chat = (await f.call('alice', 'openDirectChat', { targetId: 'bob' })).conversation.id;
  await f.call('alice', 'sendChatMessage', { conversationId: chat, text: '你好', requestId: 'first' });
  await f.call('bob', 'sendChatMessage', { conversationId: chat, text: '回复', requestId: 'reply' });
  f.edit(state => { state.users.find(item => item.id === 'bob').status = 'suspended'; });
  assert.equal((await f.call('alice', 'getChatMessages', { conversationId: chat })).conversation.canSend, false);
  await assert.rejects(f.call('alice', 'sendChatMessage', { conversationId: chat, text: '不可发', requestId: 'inactive' }), { code: 'CHAT_UNAVAILABLE' });
  f.edit(state => { state.users.find(item => item.id === 'bob').status = 'active'; });
  await f.call('bob', 'deleteAccount');
  await f.call('bob', 'bootstrap');
  await f.call('bob', 'demoVerifyIdentity', { consent });
  await assert.rejects(f.call('bob', 'getChatMessages', { conversationId: chat }), { code: 'NOT_FOUND' });
  assert.notEqual((await f.call('alice', 'openDirectChat', { targetId: 'bob' })).conversation.id, chat);
});

test('read cursors only cover fetched sequence and never consume a later message or move backwards', async () => {
  const f = await fixture(); await f.befriend('alice', 'bob');
  const conversationId = (await f.call('alice', 'openDirectChat', { targetId: 'bob' })).conversation.id;
  await f.call('alice', 'sendChatMessage', { conversationId, text: '已取得', requestId: '1' });
  const history = await f.call('bob', 'getChatMessages', { conversationId });
  await f.call('alice', 'sendChatMessage', { conversationId, text: '稍后到达', requestId: '2' });
  await f.call('bob', 'readConversation', { conversationId, throughSeq: history.items[0].seq });
  assert.equal((await f.call('bob', 'listConversations')).unreadCount, 1);
  await f.call('bob', 'readConversation', { conversationId, throughSeq: 0 });
  assert.equal((await f.call('bob', 'listConversations')).unreadCount, 1);
  for (const throughSeq of [-1, 1.1, 3, '2']) await assert.rejects(f.call('bob', 'readConversation', { conversationId, throughSeq }), { code: 'INVALID_INPUT' });
  await f.call('bob', 'readConversation', { conversationId, throughSeq: 2 });
  assert.equal((await f.call('bob', 'listConversations')).unreadCount, 0);
});

test('group APIs are retired without deleting legacy groups or exposing group messages and unread counts', async () => {
  const f = await fixture(); await f.befriend('alice', 'bob');
  const group = legacyGroup(f);
  const chat = (await f.call('alice', 'openDirectChat', { targetId: 'bob' })).conversation.id;
  await f.call('bob', 'sendChatMessage', { conversationId: chat, text: '可见私聊', requestId: 'direct' });
  const before = f.state();
  for (const who of ['alice', 'unverified']) {
    await assert.rejects(f.call(who, 'createGroupChat', { name: '已下线群聊', memberIds: ['bob'], requestId: 'new-group' }), { code: 'FEATURE_UNAVAILABLE' });
    for (const action of ['getChatMessages', 'readConversation', 'sendChatMessage', 'leaveGroup']) {
      await assert.rejects(f.call(who, action, { conversationId: group, text: '不能发送', requestId: 'disabled', throughSeq: 2 }), { code: 'FEATURE_UNAVAILABLE' });
    }
  }
  const list = await f.call('alice', 'listConversations', { limit: 1 });
  assert.deepEqual(list.items.map(item => item.id), [chat]); assert.equal(list.unreadCount, 1); assert.equal(list.nextCursor, undefined);
  const search = await f.call('alice', 'listConversations', { query: 'LEGACY_GROUP_ONLY' });
  assert.deepEqual(search.items, []); assert.equal(search.unreadCount, 1);
  assert.deepEqual(f.state(), before, 'retiring group functionality preserves its stored records and friendship data');
  await assert.rejects(f.call('alice', 'listChatContacts'), { code: 'UNKNOWN_ACTION' });
});

test('blocking hides direct previews, history, search and unread totals in both directions', async () => {
  const f = await fixture(); await f.befriend('alice', 'bob');
  const direct = (await f.call('alice', 'openDirectChat', { targetId: 'bob' })).conversation.id;
  const visible = (await f.call('alice', 'openDirectChat', { targetId: 'charlie' })).conversation.id;
  await f.call('charlie', 'sendChatMessage', { conversationId: visible, text: '仍可见的消息', requestId: 'c1' });
  f.tick(); await f.call('bob', 'sendChatMessage', { conversationId: direct, text: 'BLOCKED_DIRECT', requestId: 'b2' });
  assert.equal((await f.call('alice', 'listConversations')).unreadCount, 2);
  await f.call('bob', 'blockUser', { userId: 'alice', block: true });
  const list = await f.call('alice', 'listConversations');
  assert.equal(list.items.length, 1); assert.equal(list.unreadCount, 1); assert.equal(list.items[0].id, visible);
  assert.equal(list.items[0].lastText, '仍可见的消息'); assert.equal(list.items[0].updatedAt, EPOCH);
  assert.equal((await f.call('alice', 'listConversations', { query: 'BLOCKED' })).items.length, 0);
  assert.equal((await f.call('alice', 'listConversations', { query: '测试Cat乙' })).items.length, 0);
  assert.equal((await f.call('alice', 'getFriendHub')).friends.some(item => item.id === 'bob'), false);
  assert.deepEqual((await f.call('alice', 'searchPeople', { query: 'bob' })).items, []);
  for (const who of ['alice', 'bob']) for (const action of ['getChatMessages', 'readConversation', 'sendChatMessage']) {
    await assert.rejects(f.call(who, action, { conversationId: direct, text: '不可发', requestId: 'blocked', throughSeq: 1 }), { code: 'NOT_FOUND' });
  }
  await assert.rejects(f.call('alice', 'openDirectChat', { targetId: 'bob' }), { code: 'NOT_FOUND' });
  await f.call('bob', 'blockUser', { userId: 'alice', block: false });
  assert.equal((await f.call('alice', 'getFriendHub')).friends.some(item => item.id === 'bob'), false);
  assert.equal((await f.call('alice', 'getChatMessages', { conversationId: direct })).conversation.canSend, true);
  await f.call('dana', 'sendFriendRequest', { targetId: 'alice' });
  const requestId = (await f.call('alice', 'getFriendHub')).incoming[0].id;
  await f.call('alice', 'blockUser', { userId: 'dana', block: true });
  await f.call('alice', 'blockUser', { userId: 'dana', block: false });
  await f.call('alice', 'respondFriendRequest', { requestId, accept: true });
  assert.equal((await f.call('alice', 'getFriendHub')).incoming.length, 0);
  assert.equal((await f.call('alice', 'getFriendHub')).friends.some(item => item.id === 'dana'), false);
});

test('conversation search runs before pagination and unread totals remain global across filters', async () => {
  const f = await fixture(); await f.befriend('alice', 'bob');
  const ids = [];
  legacyGroup(f);
  for (const [i, who] of ['bob', 'charlie', 'dana'].entries()) {
    const conversationId = (await f.call('alice', 'openDirectChat', { targetId: who })).conversation.id;
    ids.push(conversationId);
    await f.call(who, 'sendChatMessage', { conversationId, text: i % 2 ? 'needle [CAT]' : '普通文字', requestId: 'b1' });
  }
  const all = await f.call('alice', 'listConversations');
  assert.equal(all.unreadCount, 3);
  let cursor; const seen = [];
  do {
    const page = await f.call('alice', 'listConversations', { query: 'cat', limit: 1, cursor });
    assert.equal(page.unreadCount, 3); seen.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 3, 'public member nickname also matches CAT');
  const textMatches = await f.call('alice', 'listConversations', { query: 'needle [' });
  assert.deepEqual(textMatches.items.map(item => item.id).sort(), [ids[1]].sort());
  assert.equal((await f.call('alice', 'listConversations', { query: 'PRIVATE' })).items.length, 0);
  for (const cursor of [false, 'broken', 'c_9999999999999999_chat']) await assert.rejects(f.call('alice', 'listConversations', { cursor }), { code: 'INVALID_INPUT' });
});

test('storage failures leave friendship and chat sequence unchanged and retries commit only once', async () => {
  const f = await fixture();
  await f.call('alice', 'sendFriendRequest', { targetId: 'bob' });
  const requestId = (await f.call('bob', 'getFriendHub')).incoming[0].id;
  const pending = f.state(); f.failWrites(true);
  await assert.rejects(f.call('bob', 'respondFriendRequest', { requestId, accept: true }), { code: 'STORAGE_UNAVAILABLE' });
  assert.deepEqual(f.state(), pending);
  f.failWrites(false); await f.call('bob', 'respondFriendRequest', { requestId, accept: true });
  const conversationId = (await f.call('alice', 'openDirectChat', { targetId: 'bob' })).conversation.id;
  const before = f.state(); f.failWrites(true);
  await assert.rejects(f.call('alice', 'sendChatMessage', { conversationId, text: '稍后重试', requestId: 'retry' }), { code: 'STORAGE_UNAVAILABLE' });
  assert.deepEqual(f.state(), before);
  f.failWrites(false);
  const sent = await f.call('alice', 'sendChatMessage', { conversationId, text: '稍后重试', requestId: 'retry' });
  assert.equal(sent.message.seq, 1); assert.equal(f.state().chatMessages.length, 1);
  const stored = f.state(); f.failWrites(true);
  await assert.rejects(f.call('alice', 'deleteAccount'), { code: 'STORAGE_UNAVAILABLE' });
  assert.deepEqual(f.state(), stored);
});

test('account deletion removes social membership, relations, authored text and read cursors without revival', async () => {
  const f = await fixture(); await f.befriend('alice', 'bob'); await f.befriend('alice', 'charlie');
  const direct = (await f.call('alice', 'openDirectChat', { targetId: 'bob' })).conversation.id;
  const group = legacyGroup(f);
  for (const conversationId of [direct]) {
    await f.call('alice', 'sendChatMessage', { conversationId, text: 'TO_BE_DELETED', requestId: 'a1' });
    await f.call('bob', 'sendChatMessage', { conversationId, text: '其他成员的文字', requestId: 'b1' });
    await f.call('alice', 'readConversation', { conversationId, throughSeq: 2 });
  }
  await f.call('dana', 'sendFriendRequest', { targetId: 'alice' });
  await f.call('alice', 'deleteAccount');
  const state = f.state();
  assert.equal(state.friendships.some(item => item.userIds.includes('alice')), false);
  assert.equal(state.friendRequests.some(item => item.fromId === 'alice' || item.toId === 'alice'), false);
  assert.equal(state.chatMessages.some(item => item.senderId === 'alice'), false);
  assert.equal(state.conversations.some(item => item.memberIds.includes('alice') || item.readBy.some(read => read.userId === 'alice')), false);
  assert.equal(state.conversations.find(item => item.id === group).ownerId, 'bob');
  assert.equal(state.chatMessages.filter(item => item.conversationId === group).length, 1);
  await assert.rejects(f.call('bob', 'getChatMessages', { conversationId: group }), { code: 'FEATURE_UNAVAILABLE' });
  assert.equal(JSON.stringify(await f.call('bob', 'listConversations')).includes('TO_BE_DELETED'), false);
  await f.call('alice', 'bootstrap');
  assert.deepEqual(await f.call('alice', 'getFriendHub'), { friends: [], incoming: [], outgoing: [] });
  assert.deepEqual((await f.call('alice', 'listConversations')).items, []);
  await assert.rejects(f.call('alice', 'getChatMessages', { conversationId: group }), { code: 'NOT_FOUND' });
  await f.call('alice', 'demoVerifyIdentity', { consent }); await f.befriend('alice', 'bob');
  assert.notEqual((await f.call('alice', 'openDirectChat', { targetId: 'bob' })).conversation.id, direct);
});
