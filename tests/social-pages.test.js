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

test('the retired group page has no actions, API calls or editable member controls', async t => {
  const { page, effects } = fixture(t, 'group-create');
  await page.onLoad(); await page.onShow();
  assert.deepEqual(effects.calls, []); assert.deepEqual(effects.routes, []);
  assert.equal(page.createGroup, undefined); assert.equal(page.toggleContact, undefined); assert.equal(page.addFriends, undefined);
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/social/pages/group-create/index.wxml'), 'utf8');
  assert.match(markup, /群聊功能已下线/); assert.match(markup, /作者主页/);
  assert.doesNotMatch(markup, /<button|<input|<textarea|bindtap|加好友/);
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
  const conversation = { id: 'direct', kind: 'direct', name: '测试宠友', canSend: true, members: [person('one'), person('two')] };
  let hidden = false;
  handlers.getChatMessages = payload => payload.cursor ? { conversation, items: [message(8), message(7)] } : { conversation, items: hidden ? [message(10)] : [message(10), message(9)], nextCursor: 'older' };
  await page.onLoad({ id: 'direct' }); await page.loadEarlier();
  assert.deepEqual(Array.from(page.data.messages, item => item.seq), [7, 8, 9, 10]);
  hidden = true; await page.refresh(true);
  assert.deepEqual(Array.from(page.data.messages, item => item.seq), [7, 8, 10]);
  assert.equal(page.data.conversation.name, '测试宠友');
  assert.equal(typeof page.toggleMembers, 'undefined'); assert.equal(typeof page.leaveGroup, 'undefined');
  assert.deepEqual(effects.routes, []);
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
  handlers.getChatMessages = () => { const error = new Error('会话已不可见'); error.code = 'NOT_FOUND'; throw error; };
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
  const conversation = { id: 'direct', kind: 'direct', canSend: true, members: [] };
  handlers.getChatMessages = () => ({ conversation, items: [message(1, { sender: person('now-blocked') })] });
  await page.onLoad({ id: 'direct' });
  let finish;
  handlers.getChatMessages = () => new Promise(resolve => { finish = resolve; });
  const refreshing = page.refresh(true);
  handlers.sendChatMessage = () => ({ message: message(2, { isMine: true, sender: person('self') }) });
  page.inputDraft(input('内存消息')); await page.send();
  finish({ conversation, items: [] }); await refreshing;
  assert.deepEqual(Array.from(page.data.messages, item => item.seq), [2]);
  assert.equal(page.data.messages.some(item => item.sender.id === 'now-blocked'), false);
});

test('old group deep links show an unavailable state without displaying, reading or sending group messages', async t => {
  const { page, handlers, effects } = fixture(t, 'chat');
  handlers.getChatMessages = () => ({ conversation: { id: 'old-group', kind: 'group', name: '旧群', canSend: true }, items: [message(1)], nextCursor: 'older' });
  await page.onLoad({ id: 'old-group' });
  assert.match(page.data.error, /停用.*留言/);
  assert.equal(page.data.conversation, null); assert.equal(page.data.messages.length, 0); assert.equal(page.data.nextCursor, null);
  page.inputDraft(input('不应发送')); await page.send(); await page.loadEarlier(); await page.markRead(1);
  assert.equal(effects.calls.some(call => ['readConversation', 'sendChatMessage', 'leaveGroup'].includes(call.action)), false);
  handlers.getChatMessages = () => { throw Object.assign(new Error('群聊已停用，请查看留言'), { code: 'FEATURE_UNAVAILABLE' }); };
  await page.refresh(true);
  assert.match(page.data.error, /停用/); assert.equal(page.data.draft, '');
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/social/pages/chat/index.wxml'), 'utf8');
  assert.match(markup, /class="chat-subtitle">留言<\/view>/);
  assert.doesNotMatch(markup, /toggleMembers|leaveGroup|membersOpen|私聊|聊天|群聊/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/social/pages/chat/index.json'), 'utf8')).navigationBarTitleText, '留言');
});

test('a non-direct history page clears the conversation and a late send acknowledgement cannot restore it', async t => {
  const { page, handlers, effects } = fixture(t, 'chat');
  handlers.getChatMessages = payload => ({ conversation: { id: 'chat', kind: payload.cursor ? 'group' : 'direct', canSend: true }, items: [message(payload.cursor ? 1 : 2)], nextCursor: payload.cursor ? null : 'older' });
  await page.onLoad({ id: 'chat' });
  let finish;
  handlers.sendChatMessage = () => new Promise(resolve => { finish = resolve; });
  page.inputDraft(input('发送中')); const sending = page.send();
  await page.loadEarlier();
  assert.match(page.data.error, /停用/); assert.equal(page.data.conversation, null);
  finish({ message: message(3, { isMine: true }) }); await sending;
  assert.equal(page.data.messages.length, 0); assert.equal(page.data.pending.length, 0);
  assert.equal(effects.calls.filter(call => call.action === 'readConversation').length, 1);
  assert.equal(effects.calls.filter(call => call.action === 'readConversation')[0].payload.throughSeq, 2);
});

test('hidden private chats cannot start a new send or retry a failed message', async t => {
  const { page, handlers, effects } = fixture(t, 'chat');
  handlers.getChatMessages = () => ({ conversation: { id: 'chat', kind: 'direct', canSend: true }, items: [] });
  handlers.sendChatMessage = () => { throw new Error('测试超时'); };
  await page.onLoad({ id: 'chat' }); page.inputDraft(input('第一次发送')); await page.send();
  const pendingId = page.data.pending[0].id;
  page.onHide(); page.inputDraft(input('隐藏期间输入')); await page.send(); await page.retryMessage(event(pendingId));
  assert.equal(effects.calls.filter(call => call.action === 'sendChatMessage').length, 1);
  assert.equal(page.data.pending.length, 1);
});

test('a retired-conversation send rejection also invalidates a history refresh already in flight', async t => {
  const { page, handlers, effects } = fixture(t, 'chat');
  const conversation = { id: 'chat', kind: 'direct', canSend: true };
  handlers.getChatMessages = () => ({ conversation, items: [message(1)] });
  await page.onLoad({ id: 'chat' });
  let finish;
  handlers.getChatMessages = () => new Promise(resolve => { finish = resolve; });
  const refreshing = page.refresh(true);
  handlers.sendChatMessage = () => { throw Object.assign(new Error('会话已停用'), { code: 'FEATURE_UNAVAILABLE' }); };
  page.inputDraft(input('不会恢复的消息')); await page.send();
  finish({ conversation, items: [message(1), message(2)] }); await refreshing;
  assert.match(page.data.error, /停用/); assert.equal(page.data.conversation, null); assert.equal(page.data.messages.length, 0);
  assert.equal(page._fetching, false);
  assert.equal(effects.calls.filter(call => call.action === 'readConversation').length, 1);
});

test('all social page WXML handlers exist and no sample avatars are used as fallback', async t => {
  for (const name of ['friends', 'group-create', 'chat']) {
    const { page } = fixture(t, name);
    const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/social/pages/' + name + '/index.wxml'), 'utf8');
    for (const binding of markup.matchAll(/\b(?:bind|catch)(?:tap|input|change|confirm|error|scroll|scrolltolower)="([^"]+)"/g)) assert.equal(typeof page[binding[1]], 'function', name + ':' + binding[1]);
    assert.doesNotMatch(markup, /assets\/avatar-\d/);
  }
});
