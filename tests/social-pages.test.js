'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shared = require('../miniprogram/pages/_shared');
const social = require('../miniprogram/social/shared');

const input = value => ({ detail: { value } });
const event = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
const flush = () => new Promise(resolve => setImmediate(resolve));
const person = (id, extra = {}) => ({ id, nickname: '仅内存测试 ' + id, avatar: '', friendStatus: 'friends', ...extra });
const message = (seq, extra = {}) => ({ id: 'test-message-' + seq, seq, text: '仅内存测试消息 ' + seq, createdAt: 1700000000000, sender: person('other'), isMine: false, ...extra });

function fixture(t, name) {
  const effects = { calls: [], routes: [], toasts: [], clipboard: [], timers: new Map(), writesAfterUnload: 0, confirm: true };
  let timerId = 0;
  const platform = {
    stopPullDownRefresh() {}, hideKeyboard() {}, showToast: options => effects.toasts.push(options.title),
    showModal: options => options.success({ confirm: effects.confirm }), setClipboardData: options => effects.clipboard.push(options.data),
    navigateTo: options => effects.routes.push(options.url), redirectTo: options => effects.routes.push(options.url),
    switchTab: options => effects.routes.push(options.url)
  };
  const handlers = {
    bootstrap: () => ({ mode: 'demo', user: { id: 'test-self' } }),
    getFriendHub: () => ({ friends: [], incoming: [], outgoing: [] }), searchPeople: () => ({ items: [] }),
    readConversation: () => ({ success: true })
  };
  const saved = { wx: global.wx, Page: global.Page, call: shared.api.call };
  global.wx = platform;
  shared.api.call = async (action, payload = {}) => {
    effects.calls.push({ action, payload: structuredClone(payload) });
    if (!handlers[action]) throw new Error('Unexpected API: ' + action);
    return handlers[action](payload);
  };
  let definition;
  global.Page = value => { definition = value; };
  const file = path.join(__dirname, '../miniprogram/social/pages/' + name + '/index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    wx: platform, setInterval: (callback, delay) => { const id = ++timerId; effects.timers.set(id, { callback, delay }); return id; },
    clearInterval: id => effects.timers.delete(id),
    require: name => { if (name === '../../../pages/_shared') return shared; if (name === '../../shared') return social; throw new Error('Unexpected module: ' + name); }
  }, { filename: file });
  const page = { ...definition, data: structuredClone(definition.data), setData(values) { if (this._closed) effects.writesAfterUnload += 1; Object.assign(this.data, values); } };
  t.after(() => { if (!page._closed) page.onUnload(); global.wx = saved.wx; global.Page = saved.Page; shared.api.call = saved.call; });
  return { page, effects, handlers, platform };
}

test('friend hub has honest empty states, shares the real own ID and strips non-public fields from people', async t => {
  const { page, handlers, effects } = fixture(t, 'friends');
  await page.onLoad();
  assert.equal(page.data.friends.length, 0);
  assert.equal(page.data.ownId, 'test-self');
  page.copyId();
  assert.deepEqual(effects.clipboard, ['test-self']);
  handlers.searchPeople = () => ({ items: [person('search-result', { avatar: 'javascript:alert(1)', phone: 'private-phone', area: 'private-area', friendStatus: 'none' })] });
  page.inputSearch(input('  仅测试  ')); await page.search();
  assert.deepEqual(effects.calls.at(-1).payload, { query: '仅测试' });
  assert.equal(page.data.results[0].avatarUrl, '');
  assert.equal(page.data.results[0].initial, '仅');
  assert.doesNotMatch(JSON.stringify(page.data.results), /private-phone|private-area/);
});

test('friend search rejects stale clear/pagination results and merges overlapping pages by ID', async t => {
  const { page, handlers, effects } = fixture(t, 'friends');
  await page.onLoad();
  let finish;
  handlers.searchPeople = () => new Promise(resolve => { finish = resolve; });
  page.inputSearch(input('first')); const stale = page.search(); page.clearSearch();
  finish({ items: [person('stale')] }); await stale;
  assert.equal(page.data.results.length, 0);
  handlers.searchPeople = payload => payload.cursor ? { items: [person('one'), person('two')] } : { items: [person('one')], nextCursor: 'next' };
  page.inputSearch(input('next')); await page.search(); await Promise.all([page.loadMore(), page.loadMore()]);
  assert.deepEqual(Array.from(page.data.results, item => item.id), ['one', 'two']);
  assert.equal(effects.calls.filter(call => call.payload.cursor === 'next').length, 1);
  assert.equal(page.data.query, 'next');
});

test('friend requests require explicit acceptance and confirmed friends open encoded chats or can be removed', async t => {
  const { page, handlers, effects } = fixture(t, 'friends');
  let accepted = false;
  handlers.getFriendHub = () => ({ friends: accepted ? [person('pet-friend')] : [], incoming: accepted ? [] : [{ id: 'incoming-id', from: person('pet-friend'), note: '内存申请', createdAt: Date.now() }], outgoing: [] });
  handlers.searchPeople = () => ({ items: [person('another', { friendStatus: 'none' })] });
  handlers.sendFriendRequest = () => ({ success: true, status: 'pending' });
  handlers.respondFriendRequest = payload => { accepted = payload.accept; return { success: true }; };
  handlers.openDirectChat = () => ({ conversation: { id: 'chat?one&two' } });
  handlers.removeFriend = () => { accepted = false; return { success: true }; };
  await page.onLoad();
  page.inputSearch(input('another')); await page.search(); page.beginRequest(event('another')); page.inputNote(input('  你好  '));
  await Promise.all([page.sendRequest(), page.sendRequest()]);
  assert.equal(effects.calls.filter(call => call.action === 'sendFriendRequest').length, 1);
  assert.equal(effects.calls.find(call => call.action === 'sendFriendRequest').payload.note, '你好');
  assert.equal(page.data.friends.length, 0);
  await page.respond(event('incoming-id', { accept: true }));
  assert.equal(page.data.friends.length, 1);
  await page.chat(event('pet-friend'));
  assert.equal(effects.routes.at(-1), '/social/pages/chat/index?id=chat%3Fone%26two');
  await page.removeFriend(event('pet-friend'));
  assert.equal(page.data.friends.length, 0);
});

test('group creation only selects confirmed friends and retries the identical create attempt without duplicates', async t => {
  const { page, effects, handlers } = fixture(t, 'group-create');
  handlers.getFriendHub = () => ({ friends: [person('one'), person('two')], incoming: [{ id: 'unconfirmed', from: person('three') }] });
  let attempts = 0;
  handlers.createGroupChat = () => { if (++attempts === 1) throw new Error('仅测试保存连接中断'); return { conversation: { id: 'created&group' } }; };
  await page.onLoad();
  page.toggleFriend(event('three'));
  assert.equal(page.data.selectedCount, 0);
  page.inputName(input('测试群')); page.toggleFriend(event('one'));
  await Promise.all([page.createGroup(), page.createGroup()]);
  assert.equal(attempts, 1);
  assert.equal(page.data.attemptLocked, true);
  page.inputName(input('不会改动')); page.toggleFriend(event('two'));
  assert.equal(page.data.name, '测试群');
  assert.equal(page.data.selectedCount, 1);
  await page.createGroup();
  const requests = effects.calls.filter(call => call.action === 'createGroupChat');
  assert.deepEqual(requests[0].payload, requests[1].payload);
  assert.equal(effects.routes.at(-1), '/social/pages/chat/index?id=created%26group');
  await page.createGroup();
  assert.equal(attempts, 2);
});

test('group validation leaves the form editable while retaining its idempotency key until success', async t => {
  const { page, effects, handlers } = fixture(t, 'group-create');
  handlers.getFriendHub = () => ({ friends: [person('one')] });
  handlers.createGroupChat = () => { const error = new Error('仅测试群名不合适'); error.code = 'CONTENT_REJECTED'; throw error; };
  await page.onLoad();
  await page.createGroup();
  assert.equal(effects.calls.some(call => call.action === 'createGroupChat'), false);
  page.inputName(input('测试群')); page.toggleFriend(event('one')); await page.createGroup();
  assert.equal(page.data.attemptLocked, false);
  page.inputName(input('新的测试群')); await page.createGroup();
  const requests = effects.calls.filter(call => call.action === 'createGroupChat');
  assert.equal(requests[0].payload.requestId, requests[1].payload.requestId);
  assert.equal(requests[1].payload.name, '新的测试群');
});

test('chat orders same-timestamp messages by sequence and marks only the messages actually obtained as read', async t => {
  const { page, handlers, effects } = fixture(t, 'chat');
  handlers.getChatMessages = () => ({ conversation: { id: 'chat-one', kind: 'direct', canSend: true, lastSeq: 99, members: [person('other')] }, items: [message(3), message(2), message(1)] });
  await page.onLoad({ id: 'chat-one' });
  assert.deepEqual(Array.from(page.data.messages, item => item.seq), [1, 2, 3]);
  assert.deepEqual(effects.calls.find(call => call.action === 'readConversation').payload, { conversationId: 'chat-one', throughSeq: 3 });
  page.onShow();
  assert.equal(effects.timers.size, 1);
  assert.equal([...effects.timers.values()][0].delay, 5000);
  page.onHide();
  assert.equal(effects.timers.size, 0);
});

test('chat sends preserve a newer draft, reuse a failed message request ID, and retain acknowledged sends during stale refresh', async t => {
  const { page, handlers, effects } = fixture(t, 'chat');
  const conversation = { id: 'chat-one', kind: 'direct', canSend: true, members: [] };
  handlers.getChatMessages = () => ({ conversation, items: [message(1)] });
  await page.onLoad({ id: 'chat-one' });
  let sendAttempts = 0;
  handlers.sendChatMessage = () => { if (++sendAttempts === 1) throw new Error('仅测试发送超时'); return { message: message(2, { isMine: true }) }; };
  page.inputDraft(input('  第一条  ')); await page.send();
  assert.equal(page.data.pending[0].state, 'failed');
  page.inputDraft(input('下一条尚未发送'));
  let finishRefresh;
  handlers.getChatMessages = () => new Promise(resolve => { finishRefresh = resolve; });
  const refresh = page.refresh(true);
  await Promise.all([page.retryMessage(event(page.data.pending[0].id)), page.retryMessage(event(page.data.pending[0].id))]);
  finishRefresh({ conversation, items: [message(1)] }); await refresh;
  const sends = effects.calls.filter(call => call.action === 'sendChatMessage');
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0].payload, sends[1].payload);
  assert.equal(sends[0].payload.text, '第一条');
  assert.equal(page.data.draft, '下一条尚未发送');
  assert.equal(page.data.pending.length, 0);
  assert.deepEqual(Array.from(page.data.messages, item => item.seq), [1, 2]);
  assert.equal(effects.calls.filter(call => call.action === 'readConversation').at(-1).payload.throughSeq, 1);
});

test('chat polling refreshes loaded history to remove hidden records and keeps older pages deduplicated', async t => {
  const { page, handlers, effects } = fixture(t, 'chat');
  const conversation = { id: 'group', kind: 'group', name: '测试群', canSend: true, memberCount: 2, members: [person('one'), person('two')] };
  let hidden = false;
  handlers.getChatMessages = payload => payload.cursor ? { conversation, items: [message(8), message(7)] } : { conversation, items: hidden ? [message(10)] : [message(10), message(9)], nextCursor: 'older' };
  handlers.leaveGroup = () => ({ success: true });
  await page.onLoad({ id: 'group' }); await page.loadEarlier();
  assert.deepEqual(Array.from(page.data.messages, item => item.seq), [7, 8, 9, 10]);
  hidden = true; await page.refresh(true);
  assert.deepEqual(Array.from(page.data.messages, item => item.seq), [7, 8, 10]);
  page.toggleMembers(); assert.equal(page.data.membersOpen, true); assert.equal(page.data.members.length, 2);
  await page.leaveGroup();
  assert.equal(effects.routes.at(-1), '/pages/messages/index');
  assert.equal(page._active, false);
});

test('hidden or unloaded chat requests never render or mark unseen messages as read and can resume after first-load interruption', async t => {
  const { page, handlers, effects } = fixture(t, 'chat');
  let finish;
  const conversation = { id: 'chat', kind: 'direct', canSend: true };
  handlers.getChatMessages = () => new Promise(resolve => { finish = resolve; });
  const first = page.onLoad({ id: 'chat' });
  page.onHide(); finish({ conversation, items: [message(5)] }); await first;
  assert.equal(page.data.messages.length, 0);
  assert.equal(effects.calls.some(call => call.action === 'readConversation'), false);
  handlers.getChatMessages = () => ({ conversation, items: [message(6)] });
  await page.onShow();
  assert.equal(page.data.messages[0].seq, 6);
  handlers.getChatMessages = () => new Promise(resolve => { finish = resolve; });
  const next = page.refresh(true); page.onUnload(); finish({ conversation, items: [message(7)] }); await next; await flush();
  assert.equal(effects.writesAfterUnload, 0);
  assert.equal(effects.timers.size, 0);
  assert.equal(effects.calls.filter(call => call.action === 'readConversation').at(-1).payload.throughSeq, 6);
});

test('chat permissions and sync errors preserve a recoverable UI without leaving revoked history visible', async t => {
  const { page, handlers } = fixture(t, 'chat');
  handlers.getChatMessages = () => ({ conversation: { id: 'chat', kind: 'direct', canSend: false }, items: [message(1)] });
  handlers.readConversation = () => { throw new Error('仅测试已读保存失败'); };
  await page.onLoad({ id: 'chat' });
  assert.match(page.data.readError, /已读状态暂未保存/);
  handlers.getChatMessages = () => { throw new Error('仅测试连接中断'); };
  await page.refresh(true);
  assert.equal(page.data.messages.length, 1);
  assert.match(page.data.syncError, /连接中断/);
  handlers.getChatMessages = () => { const error = new Error('已退出群聊'); error.code = 'NOT_MEMBER'; throw error; };
  await page.refresh(true);
  assert.equal(page.data.messages.length, 0);
  assert.equal(page.data.conversation, null);
});

test('a pending send completed in the background does not mark anything read or navigate to verification', async t => {
  const { page, handlers, effects } = fixture(t, 'chat');
  handlers.getChatMessages = () => ({ conversation: { id: 'chat', kind: 'direct', canSend: true }, items: [] });
  await page.onLoad({ id: 'chat' });
  let finish;
  handlers.sendChatMessage = () => new Promise(resolve => { finish = resolve; });
  page.inputDraft(input('内存后台发送')); const sending = page.send();
  page.onHide(); finish({ message: message(1, { isMine: true }) }); await sending;
  assert.equal(effects.calls.some(call => call.action === 'readConversation'), false);
  assert.equal(effects.routes.length, 0);
  await page.onShow();
  let fail;
  handlers.sendChatMessage = () => new Promise((_, reject) => { fail = reject; });
  page.inputDraft(input('内存后台核验')); const failed = page.send();
  page.onHide(); const error = new Error('请完成核验'); error.code = 'VERIFICATION_REQUIRED'; fail(error); await failed;
  assert.equal(effects.routes.length, 0);
  assert.equal(page.data.pending[0].state, 'failed');
});

test('a sent-message acknowledgement interleaved with a refresh cannot preserve blocked old messages', async t => {
  const { page, handlers } = fixture(t, 'chat');
  const conversation = { id: 'group', kind: 'group', canSend: true, members: [] };
  handlers.getChatMessages = () => ({ conversation, items: [message(1, { sender: person('now-blocked') })] });
  await page.onLoad({ id: 'group' });
  let finish;
  handlers.getChatMessages = () => new Promise(resolve => { finish = resolve; });
  const refreshing = page.refresh(true);
  handlers.sendChatMessage = () => ({ message: message(2, { isMine: true, sender: person('self') }) });
  page.inputDraft(input('内存消息')); await page.send();
  finish({ conversation, items: [] }); await refreshing;
  assert.deepEqual(Array.from(page.data.messages, item => item.seq), [2]);
  assert.equal(page.data.messages.some(item => item.sender.id === 'now-blocked'), false);
});

test('all social page WXML handlers exist and no sample avatars are used as fallback', async t => {
  for (const name of ['friends', 'group-create', 'chat']) {
    const { page } = fixture(t, name);
    const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/social/pages/' + name + '/index.wxml'), 'utf8');
    for (const binding of markup.matchAll(/\b(?:bind|catch)(?:tap|input|change|confirm|error|scroll|scrolltolower)="([^"]+)"/g)) assert.equal(typeof page[binding[1]], 'function', name + ':' + binding[1]);
    assert.doesNotMatch(markup, /assets\/avatar-\d/);
  }
});
