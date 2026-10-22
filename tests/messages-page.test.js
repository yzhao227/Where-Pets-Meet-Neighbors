'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../miniprogram/services/api');

const categories = ['interactions', 'comments', 'follows', 'system'];
function fixture(t) {
  const messages = [
    { id: 'fixture-like', category: 'interactions', kind: 'like', targetType: 'post', targetId: 'post?a&b=1', title: '赞了你的分享', text: '仅内存测试标题', actor: { nickname: '测试甲', avatar: 'https://example.invalid/avatar.jpg' }, cover: 'https://example.invalid/cover.jpg' },
    { id: 'fixture-comment', category: 'comments', kind: 'comment', targetType: 'post', targetId: 'post-2', title: '评论了你的分享', text: '仅内存测试回应', actor: { nickname: '测试乙', avatar: 'javascript:alert(1)' } },
    { id: 'fixture-follow', category: 'follows', kind: 'follow', targetType: 'user', targetId: 'user?x=1&y=2', title: '开始关注你', text: '仅内存测试关注', actor: { nickname: '测试丙', avatar: '/assets/avatar-1.png' } },
    { id: 'fixture-event', category: 'system', kind: 'event', targetType: 'event', targetId: 'event-1', title: '活动安排有更新', text: '仅内存测试活动通知' },
    { id: 'fixture-system', category: 'system', kind: 'system', targetType: 'system', title: '系统提醒', text: '仅内存测试系统正文' }
  ].map(item => ({ createdAt: Date.now(), isRead: false, ...item }));
  const state = { calls: [], navigations: [], toasts: [], modals: [], navigationFail: false, writesAfterUnload: 0, viewWrites: [] };
  const saved = { wx: global.wx, Page: global.Page, call: api.call };
  const unread = () => {
    const categoryUnread = Object.fromEntries(categories.map(category => [category, messages.filter(item => item.category === category && !item.isRead).length]));
    return { unreadCount: messages.filter(item => !item.isRead).length, categoryUnread };
  };
  const handlers = {
    bootstrap: () => ({ mode: 'demo', user: { id: 'memory-inbox-owner' } }),
    listConversations: () => ({ items: [], unreadCount: 0 }),
    listMessages: payload => ({ items: messages.filter(item => (payload.category === 'all' || !payload.category || item.category === payload.category) && (!payload.query || [item.title, item.text, item.actor && item.actor.nickname].some(value => (value || '').includes(payload.query)))).map(item => structuredClone(item)), ...unread() }),
    readMessage: payload => { messages.forEach(item => { if (payload.all || item.id === payload.id) item.isRead = true; }); return { success: true, ...unread() }; },
    getPost: () => ({ post: {} }), getEvent: () => ({ event: {} }), getUserProfile: () => ({ user: {} })
  };
  global.wx = {
    stopPullDownRefresh() {}, showToast: options => state.toasts.push(options.title),
    showModal: options => state.modals.push(options),
    navigateTo: options => { if (state.navigationFail) options.fail(); else state.navigations.push(options.url); }
  };
  api.call = async (action, payload = {}) => { state.calls.push({ action, payload }); if (!handlers[action]) throw Error('Unexpected action ' + action); return handlers[action](payload); };
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/messages/index');
  delete require.cache[file]; require(file);
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { if (this._closed) state.writesAfterUnload += 1; state.viewWrites.push(structuredClone(value)); Object.assign(this.data, value); } };
  t.after(() => { global.wx = saved.wx; global.Page = saved.Page; api.call = saved.call; });
  return { page, state, handlers, messages };
}
const event = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });

test('message search keeps global unread counts and restores the complete inbox on cancel', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.openSearch();
  assert.equal(page.data.searchFocused, true);
  page.inputSearch({ detail: { value: '  测试乙  ' } });
  await page.search();
  assert.equal(page.data.query, '测试乙');
  assert.equal(page.data.searchText, '测试乙');
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-comment']);
  assert.equal(page.data.unreadCount, 5);
  assert.equal(state.calls.filter(call => call.action === 'readMessage').length, 0);
  assert.deepEqual(state.calls.filter(call => call.action === 'listMessages').at(-1).payload, { category: 'all', query: '测试乙' });
  await page.cancelSearch();
  assert.equal(page.data.query, '');
  assert.equal(page.data.searchOpen, false);
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-like', 'fixture-comment', 'fixture-follow', 'fixture-event', 'fixture-system']);
});

test('message search carries keywords into pagination and drops late results after clearing', async t => {
  const { page, handlers, state, messages } = fixture(t);
  let resolveMore;
  handlers.listMessages = payload => {
    if (payload.cursor) return new Promise(resolve => { resolveMore = resolve; });
    return { items: payload.query ? [messages[0]] : messages, nextCursor: payload.query ? 'query-page-two' : null };
  };
  await page.onLoad();
  page.openSearch();
  page.inputSearch({ detail: { value: '测试' } });
  await page.search();
  const more = page.loadMore();
  assert.deepEqual(state.calls.filter(call => call.action === 'listMessages').at(-1).payload, { category: 'all', query: '测试', cursor: 'query-page-two' });
  await page.clearSearch();
  resolveMore({ items: [{ ...messages[0], id: 'stale-search' }], nextCursor: 'stale-cursor' });
  await more;
  assert.equal(page.data.items.length, 5);
  assert.equal(page.data.nextCursor, null);
  assert.equal(page.data.query, '');
  assert.equal(page.data.searchFocused, true);
});

test('private conversation navigation has no group action and ignores busy, hidden or closed page actions', async t => {
  const { page, state, handlers } = fixture(t);
  handlers.listConversations = () => ({ items: [{ id: 'private-chat', kind: 'direct', name: '宠友' }], unreadCount: 0 });
  await page.onLoad();
  const reads = state.calls.length;
  page.openConversation(event('private-chat'));
  assert.deepEqual(state.navigations, ['/social/pages/chat/index?id=private-chat']);
  assert.equal(state.calls.length, reads, 'opening a private chat does not mark it read before it is displayed');
  for (const method of ['createGroup', 'toggleMenu', 'selectMenu', 'openFriends']) assert.equal(typeof page[method], 'undefined');
  page.data.busy = true; page.openConversation(event('private-chat')); page.data.busy = false;
  page.onHide(); page.openConversation(event('private-chat'));
  assert.equal(state.navigations.length, 1);
  await page.onShow();
  state.navigationFail = true; page.openConversation(event('private-chat'));
  assert.match(state.toasts.at(-1), /无法打开/);
  state.navigationFail = false; page.onUnload(); page.openConversation(event('private-chat'));
  assert.equal(state.navigations.length, 1);
});

test('inbox search includes chat content while preserving independent unread counts without friend requests', async t => {
  const { page, handlers, state } = fixture(t);
  handlers.listConversations = payload => ({ items: payload.query === '毛孩子' ? [{ id: 'direct?x=1&y=2', kind: 'direct', name: '一起遛狗', lastText: '毛孩子今天真开心', unreadCount: 2 }] : [], unreadCount: 2 });
  await page.onLoad();
  page.openSearch(); page.inputSearch({ detail: { value: '毛孩子' } }); await page.search();
  assert.equal(page.data.conversations.length, 1);
  assert.equal(page.data.chatUnreadCount, 2);
  assert.equal(page.data.unreadCount, 5);
  assert.equal(state.calls.some(call => call.action === 'getFriendHub'), false);
  assert.equal(Object.hasOwn(page.data, 'friendRequestCount'), false);
  page.openConversation(event('direct?x=1&y=2'));
  assert.equal(state.navigations.at(-1), '/social/pages/chat/index?id=direct%3Fx%3D1%26y%3D2');
  assert.equal(state.calls.some(call => call.action === 'readConversation'), false);
  handlers.listConversations = () => { throw Error('聊天读取失败'); };
  await page.refresh();
  assert.equal(page.data.socialError, '聊天读取失败');
  assert.equal(page.data.error, '');
  assert.equal(page.data.unreadCount, 5);
});

test('new searches invalidate pending chat pages and custom navigation fits the system capsule', async t => {
  const { page, handlers } = fixture(t); let finish;
  global.wx.getWindowInfo = () => ({ statusBarHeight: 47 });
  global.wx.getMenuButtonBoundingClientRect = () => ({ top: 55, height: 32 });
  handlers.listConversations = payload => payload.cursor ? new Promise(resolve => { finish = resolve; }) : { items: [], nextCursor: payload.query ? null : 'older-chats', unreadCount: 0 };
  await page.onLoad();
  assert.equal(page.data.statusBarHeight, 47); assert.equal(page.data.navigationHeight, 48);
  const more = page.loadMoreConversations();
  page.inputSearch({ detail: { value: '新搜索' } }); await page.search();
  finish({ items: [{ id: 'stale' }], nextCursor: 'stale-next', unreadCount: 99 }); await more;
  assert.deepEqual(page.data.conversations, []);
  assert.equal(page.data.conversationCursor, null);
  assert.equal(page.data.chatUnreadCount, 0);
});

test('inbox filters retired groups from initial and subsequent pages without changing notification state', async t => {
  const { page, handlers, state } = fixture(t);
  handlers.listConversations = payload => ({ items: payload.cursor
    ? [{ id: 'older-group', kind: 'group', name: '旧群' }, { id: 'private-second', kind: 'direct', name: '宠友乙', unreadCount: 1 }]
    : [{ id: 'old-group', kind: 'group', name: '旧群' }, { id: 'private-first', kind: 'direct', name: '宠友甲', unreadCount: 1 }],
    unreadCount: 2, ...(payload.cursor ? {} : { nextCursor: 'second' }) });
  await page.onLoad();
  assert.deepEqual(page.data.conversations.map(item => item.id), ['private-first']);
  await page.loadMoreConversations();
  assert.deepEqual(page.data.conversations.map(item => item.id), ['private-first', 'private-second']);
  page.openConversation(event('old-group')); page.openConversation(event('older-group'));
  assert.deepEqual(state.navigations, []);
  assert.equal(page.data.chatUnreadCount, 2); assert.equal(page.data.unreadCount, 5);
  assert.ok(state.calls.filter(call => call.action === 'listConversations').every(call => !Object.hasOwn(call.payload, 'kind')));
});

test('all notifications retain every kind in a title-first list with notification categories and no friend or group controls', async t => {
  const { page, state, messages } = fixture(t);
  await page.onLoad();
  assert.equal(page.data.unreadCount, 5);
  assert.equal(page.data.countsReady, true);
  assert.deepEqual(page.data.items.map(item => item.id), messages.map(item => item.id));
  assert.deepEqual(new Set(page.data.items.map(item => item.category)), new Set(categories));
  assert.equal(page.data.items[0].displayTitle, '赞了你的分享');
  assert.equal(page.data.items[0].summaryText, '测试甲 · 仅内存测试标题');
  assert.equal(page.data.items[4].displayTitle, '系统提醒');
  assert.equal(page.data.items[4].summaryText, '仅内存测试系统正文');
  assert.equal(state.calls.filter(call => call.action === 'readMessage').length, 0);
  assert.ok(state.calls.filter(call => call.action === 'listMessages').every(call => call.payload.category === 'all'));
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/messages/index.wxml'), 'utf8');
  assert.match(markup, /wx:for="{{inboxItems}}" wx:key="rowKey"/);
  assert.doesNotMatch(markup, /class="conversation-section"/);
  assert.doesNotMatch(markup, /私聊|聊天/);
  assert.doesNotMatch(markup, /createGroup|group-avatar|群聊/);
  assert.match(markup, /item\.displayTitle/); assert.match(markup, /item\.summaryText/);
  assert.match(markup, /bindtap="selectCategory"/);
  assert.doesNotMatch(markup, /selectMenu|openFriends|message-entries|message-menu|friend-request-banner|消息仅对你可见/);
  assert.doesNotMatch(markup, /<image\b/, 'compact notices use a consistent icon, not actor avatars or covers');
  assert.ok(markup.lastIndexOf('message-mode') > markup.lastIndexOf('message-list'), 'the local experience note stays at the bottom');
  for (const match of markup.matchAll(/\b(?:bind|catch)(?:tap|input|change|confirm|error)="([^"]+)"/g)) assert.equal(typeof page[match[1]], 'function', match[1]);
});

test('message paging rejects stale search results and merges overlaps without duplicate requests', async t => {
  const { page, handlers, state, messages } = fixture(t);
  let resolveOld;
  const totals = value => ({ unreadCount: value, categoryUnread: { interactions: 1, comments: value - 1, follows: 0, system: 0 } });
  handlers.listMessages = payload => {
    if (payload.cursor === 'all-2') return new Promise(resolve => { resolveOld = resolve; });
    if (payload.cursor === 'comments-2') return { items: [{ ...messages[1], title: '更新的评论' }, { ...messages[1], id: 'fixture-comment-two' }], ...totals(7) };
    if (payload.query === 'comments') return { items: [messages[1]], nextCursor: 'comments-2', ...totals(9) };
    return { items: [messages[0]], nextCursor: 'all-2', ...totals(8) };
  };
  await page.onLoad();
  const old = page.loadMore();
  page.inputSearch({ detail: { value: 'comments' } }); await page.search();
  resolveOld({ items: [messages[0]], nextCursor: 'all-3', ...totals(99) });
  await old;
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-comment']);
  assert.equal(page.data.unreadCount, 9);
  assert.equal(page.data.nextCursor, 'comments-2');
  await Promise.all([page.loadMore(), page.loadMore()]);
  assert.equal(page.data.items.length, 2);
  assert.equal(page.data.items[0].title, '更新的评论');
  assert.equal(page.data.unreadCount, 7);
  assert.equal(state.calls.filter(call => call.payload.cursor === 'comments-2').length, 1);
});

test('failed or incomplete reads preserve unknown counters instead of fabricating zero', async t => {
  const { page, state, handlers } = fixture(t);
  handlers.listMessages = () => ({ items: [] });
  await page.onLoad();
  assert.equal(page.data.unreadCount, null);
  assert.equal(page.data.countsReady, false);
  await page.readAll();
  assert.equal(state.calls.filter(call => call.action === 'readMessage').length, 0);
  handlers.listMessages = () => { throw new Error('仅测试读取失败'); };
  await page.refresh();
  assert.equal(page.data.error, ''); assert.match(page.data.inboxError, /仅测试读取失败/);
  assert.equal(page.data.unreadCount, null);
  assert.equal(page.data.countsReady, false);
});

test('reading succeeds before encoded post, event, or author navigation and system notices open their body', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  await Promise.all([page.openMessage(event('fixture-like')), page.openMessage(event('fixture-like'))]);
  assert.deepEqual(state.navigations, ['/pages/post/index?id=post%3Fa%26b%3D1']);
  assert.equal(page.data.items.find(item => item.id === 'fixture-like').isRead, true);
  const firstWrite = state.calls.findIndex(call => call.action === 'readMessage');
  const targetRead = state.calls.findIndex(call => call.action === 'getPost');
  assert.ok(firstWrite < targetRead);
  await page.openMessage(event('fixture-follow'));
  assert.equal(state.navigations.at(-1), '/pages/author/index?userId=user%3Fx%3D1%26y%3D2');
  await page.openMessage(event('fixture-event'));
  assert.equal(state.navigations.at(-1), '/pages/event/index?id=event-1');
  await page.openMessage(event('fixture-system'));
  assert.equal(state.modals.at(-1).content, '仅内存测试系统正文');
  await page.readAll();
  assert.equal(page.data.unreadCount, 0);
  assert.ok(page.data.items.every(item => item.isRead));
});

test('write failures do not mark or navigate; unavailable targets remain read with a useful toast', async t => {
  const { page, state, handlers } = fixture(t);
  await page.onLoad();
  const write = handlers.readMessage;
  handlers.readMessage = () => { throw new Error('仅测试保存失败'); };
  await page.openMessage(event('fixture-like'));
  assert.equal(page.data.unreadCount, 5);
  assert.equal(page.data.items[0].isRead, false);
  assert.equal(state.navigations.length, 0);
  assert.match(state.toasts.at(-1), /保存失败/);
  handlers.readMessage = write;
  handlers.getPost = () => { throw new Error('这篇分享已删除或不可见'); };
  await page.openMessage(event('fixture-like'));
  assert.equal(page.data.items[0].isRead, true);
  assert.equal(state.navigations.length, 0);
  assert.match(state.toasts.at(-1), /已删除/);
});

test('notification text preserves attribution without loading unsafe images and late reads never navigate', async t => {
  const { page, state, handlers, messages } = fixture(t);
  messages[0].cover = 'javascript:alert(1)';
  messages[1].text = '测试乙：仅内存测试回应';
  await page.onLoad();
  const first = page.data.items[0];
  assert.equal(first.displayTitle, messages[0].title);
  assert.equal(first.summaryText, '测试甲 · 仅内存测试标题');
  assert.equal(page.data.items[1].summaryText, '测试乙：仅内存测试回应', 'a body already naming its author does not repeat the name');
  assert.equal(page.data.items[4].actorName, '');
  assert.equal(Object.hasOwn(first, 'avatarUrl'), false);
  assert.equal(Object.hasOwn(first, 'coverUrl'), false);
  let finish;
  handlers.readMessage = () => new Promise(resolve => { finish = resolve; });
  const pending = page.openMessage(event(first.id));
  page.onUnload(); finish({ success: true }); await pending;
  assert.equal(state.writesAfterUnload, 0);
  assert.equal(state.navigations.length, 0);
});

test('returning to messages refreshes loaded pages in place without a loading collapse', async t => {
  const { page, handlers, messages, state } = fixture(t);
  let returned = false;
  const chat = (id, unreadCount) => ({ id, kind: 'direct', name: id, lastText: '仅内存会话', unreadCount });
  handlers.listMessages = payload => ({ items: payload.cursor ? [{ ...messages[1], isRead: returned }] : returned ? [{ ...messages[0], id: 'new-notification' }, messages[0]] : [messages[0]], nextCursor: payload.cursor ? 'messages-third' : 'messages-second', unreadCount: returned ? 3 : 4 });
  handlers.listConversations = payload => ({ items: payload.cursor ? [chat('chat-second', returned ? 0 : 2)] : returned ? [chat('chat-new', 1), chat('chat-first', 1)] : [chat('chat-first', 1)], nextCursor: payload.cursor ? 'chats-third' : 'chats-second', unreadCount: returned ? 2 : 3 });
  await page.onLoad();
  await page.loadMore(); await page.loadMoreConversations();
  const originalMessages = page.data.items.map(item => item.id), originalChats = page.data.conversations.map(item => item.id);
  state.viewWrites.length = 0; state.calls.length = 0; returned = true;
  await page.onShow();
  assert.deepEqual(page.data.items.map(item => item.id), originalMessages);
  assert.deepEqual(page.data.conversations.map(item => item.id), originalChats);
  assert.equal(page.data.items[1].isRead, true);
  assert.equal(page.data.conversations[1].unreadCount, 0);
  assert.equal(page.data.unreadCount, 3); assert.equal(page.data.chatUnreadCount, 2);
  assert.equal(page.data.nextCursor, 'messages-third'); assert.equal(page.data.conversationCursor, 'chats-third');
  assert.deepEqual(state.calls.filter(call => call.action === 'listMessages').map(call => call.payload.cursor || null), [null, 'messages-second']);
  assert.deepEqual(state.calls.filter(call => call.action === 'listConversations').map(call => call.payload.cursor || null), [null, 'chats-second']);
  assert.ok(state.viewWrites.every(value => value.loading !== true && (!value.items || value.items.length === 2) && (!value.conversations || value.conversations.length === 2)));
  await page.onPullDownRefresh();
  assert.deepEqual(page.data.items.map(item => item.id), ['new-notification', messages[0].id]);
  assert.deepEqual(page.data.conversations.map(item => item.id), ['chat-new', 'chat-first']);
  assert.equal(page.data.nextCursor, 'messages-second'); assert.equal(page.data.conversationCursor, 'chats-second');
});

test('reading a notification and reading all apply returned counts without refetching or dropping pages', async t => {
  const { page, handlers, messages, state } = fixture(t);
  handlers.listMessages = payload => ({ items: payload.cursor ? messages.slice(1) : [messages[0]], nextCursor: payload.cursor ? 'third' : 'second', unreadCount: 5 });
  await page.onLoad(); await page.loadMore();
  state.calls.length = 0; state.viewWrites.length = 0;
  await page.openMessage(event(messages[1].id));
  assert.equal(page.data.items.length, 5); assert.equal(page.data.nextCursor, 'third');
  assert.equal(page.data.items[1].isRead, true); assert.equal(page.data.unreadCount, 4);
  assert.deepEqual(state.calls.map(call => call.action), ['readMessage', 'getPost']);
  assert.equal(state.navigations.at(-1), '/pages/post/index?id=post-2');
  await page.readAll();
  assert.equal(page.data.unreadCount, 0); assert.ok(page.data.items.every(item => item.isRead));
  assert.equal(page.data.nextCursor, 'third'); assert.equal(page.data.items.length, 5);
  assert.ok(state.viewWrites.every(value => value.loading !== true));
  assert.equal(state.calls.filter(call => call.action === 'listMessages').length, 0);
});

test('temporary return refresh failures preserve loaded notification and chat content', async t => {
  const { page, handlers, state } = fixture(t);
  handlers.listConversations = () => ({ items: [{ id: 'cached-chat', kind: 'direct', name: '仅内存会话', unreadCount: 2 }], unreadCount: 2, nextCursor: 'older-chat' });
  await page.onLoad();
  const before = structuredClone(page.data);
  state.viewWrites.length = 0;
  const listMessages = handlers.listMessages;
  handlers.listMessages = () => { throw Error('仅内存网络故障'); };
  await page.onShow();
  assert.deepEqual(page.data.items, before.items); assert.deepEqual(page.data.conversations, before.conversations);
  assert.equal(page.data.error, ''); assert.equal(page.data.unreadCount, before.unreadCount);
  handlers.listMessages = listMessages;
  handlers.listConversations = () => { throw Error('仅内存聊天网络故障'); };
  await page.onShow();
  assert.deepEqual(page.data.conversations, before.conversations);
  assert.equal(page.data.socialError, '仅内存聊天网络故障'); assert.equal(page.data.conversationCursor, 'older-chat');
  assert.equal(page.data.chatUnreadCount, 2);
  assert.ok(state.viewWrites.every(value => value.loading !== true));
  assert.deepEqual(state.toasts, []);
});

test('account or mode changes discard old inbox pages even when the replacement fetch fails', async t => {
  const { page, handlers, messages } = fixture(t);
  let active = 'old', mode = 'demo', fail = false;
  handlers.bootstrap = () => ({ mode, user: { id: active } });
  handlers.listMessages = payload => {
    if (fail) throw Error('仅内存新账号读取故障');
    return { items: [{ ...messages[0], id: active + ':' + mode + ':' + (payload.cursor || 'first') }], nextCursor: payload.cursor ? null : 'second', unreadCount: 1 };
  };
  handlers.listConversations = () => ({ items: [{ id: active + ':' + mode, kind: 'direct', name: '仅内存会话' }], unreadCount: 0 });
  await page.onLoad(); await page.loadMore();
  active = 'new'; fail = true;
  await page.onShow();
  assert.deepEqual(page.data.items, []); assert.deepEqual(page.data.conversations.map(item => item.id), ['new:demo']);
  assert.equal(page.data.nextCursor, null); assert.equal(page.data.conversationCursor, null);
  assert.match(page.data.inboxError, /新账号读取故障/); assert.equal(page.data.loading, false);
  assert.equal(page.data.inboxUnreadCount, null);
  fail = false; await page.onShow();
  assert.deepEqual(page.data.items.map(item => item.id), ['new:demo:first']);
  await page.loadMore(); mode = 'cloud'; await page.onShow();
  assert.deepEqual(page.data.items.map(item => item.id), ['new:cloud:first']);
  assert.deepEqual(page.data.conversations.map(item => item.id), ['new:cloud']);
});

test('unavailable accounts clear cached private content during retained refresh', async t => {
  const { page, handlers } = fixture(t);
  await page.onLoad();
  handlers.bootstrap = () => { throw Object.assign(Error('仅内存账号已注销'), { code: 'AUTH_REQUIRED' }); };
  await page.onShow();
  assert.deepEqual(page.data.items, []); assert.deepEqual(page.data.conversations, []);
  assert.equal(page.data.errorCode, 'AUTH_REQUIRED'); assert.equal(page.data.unreadCount, null);
  assert.equal(page.data.loading, false);
});

test('late retained inbox requests cannot restore a prior account or search', async t => {
  const { page, handlers, messages } = fixture(t);
  await page.onLoad();
  let resolveOld, started;
  const entered = new Promise(resolve => { started = resolve; });
  handlers.listMessages = () => { started(); return new Promise(resolve => { resolveOld = resolve; }); };
  const old = page.onShow(); await entered;
  handlers.bootstrap = () => ({ mode: 'demo', user: { id: 'new-owner' } });
  handlers.listMessages = () => ({ items: [{ ...messages[1], id: 'new-owner-comment' }], unreadCount: 0 });
  page.inputSearch({ detail: { value: 'comments' } }); await page.search();
  resolveOld({ items: [{ ...messages[0], id: 'stale-private-notification' }], unreadCount: 99, nextCursor: 'stale-cursor' }); await old;
  assert.deepEqual(page.data.items.map(item => item.id), ['new-owner-comment']);
  assert.equal(page.data.query, 'comments'); assert.equal(page.data.unreadCount, 0);
  assert.equal(page.data.nextCursor, null);
});


test('new arrivals do not displace loaded inbox rows and revoked rows disappear on return', async t => {
  const { page, handlers, messages } = fixture(t);
  let notifications = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({ ...messages[0], id, createdAt: 600 - index * 100 }));
  let conversations = notifications.map(item => ({ id: item.id, kind: 'direct', name: item.id, updatedAt: item.createdAt, unreadCount: 1 }));
  const slice = (items, field, payload) => {
    const rows = items.filter(item => !payload.cursor || item[field] < Number(payload.cursor));
    const pageItems = rows.slice(0, 2);
    return { items: pageItems, nextCursor: rows.length > 2 ? String(pageItems.at(-1)[field]) : null, unreadCount: items.length };
  };
  handlers.listMessages = payload => slice(notifications, 'createdAt', payload);
  handlers.listConversations = payload => slice(conversations, 'updatedAt', payload);
  await page.onLoad(); await page.loadMore(); await page.loadMoreConversations();
  const arrivals = [800, 700].map(createdAt => ({ ...messages[0], id: 'new-' + createdAt, createdAt }));
  notifications = [...arrivals, ...notifications];
  conversations = [...arrivals.map(item => ({ id: item.id, kind: 'direct', name: item.id, updatedAt: item.createdAt, unreadCount: 1 })), ...conversations];
  await page.onShow();
  assert.deepEqual(page.data.items.map(item => item.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(page.data.conversations.map(item => item.id), ['a', 'b', 'c', 'd']);
  assert.equal(page.data.nextCursor, '300'); assert.equal(page.data.conversationCursor, '300');
  notifications = notifications.filter(item => item.id !== 'b');
  conversations = conversations.filter(item => item.id !== 'c');
  await page.onShow();
  assert.deepEqual(page.data.items.map(item => item.id), ['a', 'c', 'd']);
  assert.deepEqual(page.data.conversations.map(item => item.id), ['a', 'b', 'd']);
  await page.loadMore(); await page.loadMoreConversations();
  assert.deepEqual(page.data.items.map(item => item.id), ['a', 'c', 'd', 'e', 'f']);
  assert.deepEqual(page.data.conversations.map(item => item.id), ['a', 'b', 'd', 'e', 'f']);
});

test('a read acknowledgement wins over a slower retained inbox snapshot', async t => {
  const { page, handlers, messages } = fixture(t);
  await page.onLoad();
  const staleRows = structuredClone(messages);
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  handlers.listMessages = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
  const pending = page.onShow(); await started;
  await page.openMessage(event(messages[0].id));
  assert.equal(page.data.unreadCount, 4); assert.equal(page.data.items[0].isRead, true);
  finish({ items: staleRows, unreadCount: 5 }); await pending;
  assert.equal(page.data.unreadCount, 4); assert.equal(page.data.items[0].isRead, true);
  assert.equal(page.data.loading, false);
});

test('reading all notifications from a search covers unloaded notices and never consumes chat unread state', async t => {
  const { page, handlers, messages, state } = fixture(t);
  handlers.listMessages = () => ({ items: [messages[0]], nextCursor: 'unloaded-notices', unreadCount: 5 });
  handlers.listConversations = () => ({ items: [{ id: 'chat', kind: 'direct', name: '测试甲', lastText: '聊天正文', unreadCount: 2 }], nextCursor: 'unloaded-chats', unreadCount: 2 });
  await page.onLoad(); page.openSearch(); page.inputSearch({ detail: { value: '测试甲' } }); await page.search();
  assert.equal(page.data.items.length, 1);
  const chats = structuredClone(page.data.conversations);
  state.calls.length = 0;
  await page.readAll();
  assert.deepEqual(state.calls, [{ action: 'readMessage', payload: { all: true } }]);
  assert.ok(messages.every(item => item.isRead), 'the service receives a global write even for records outside the loaded search results');
  assert.equal(page.data.unreadCount, 0);
  assert.equal(page.data.items.length, 1); assert.equal(page.data.items[0].isRead, true);
  assert.equal(page.data.query, '测试甲'); assert.equal(page.data.nextCursor, 'unloaded-notices');
  assert.equal(page.data.chatUnreadCount, 2); assert.equal(page.data.conversationCursor, 'unloaded-chats');
  assert.deepEqual(page.data.conversations, chats);
});

test('initial load, search, refresh and return read conversations and notices without fetching a friend hub', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.openSearch(); page.inputSearch({ detail: { value: '测试' } }); await page.search();
  await page.refresh(); page.onHide(); await page.onShow(); await page.cancelSearch();
  assert.ok(state.calls.length >= 15);
  assert.ok(state.calls.every(call => ['bootstrap', 'listMessages', 'listConversations'].includes(call.action)));
  assert.ok(state.calls.filter(call => call.action === 'listMessages').every(call => call.payload.category === 'all'));
  assert.equal(Object.hasOwn(page.data, 'friendRequestCount'), false);
  assert.equal(Object.hasOwn(page.data, 'entries'), false);
});

test('simultaneous notification and chat pagination deduplicates clicks and keeps cursors and counters independent', async t => {
  const { page, handlers, messages, state } = fixture(t);
  let finishNotices, finishChats;
  handlers.listMessages = payload => payload.cursor ? new Promise(resolve => { finishNotices = resolve; }) : { items: [messages[0]], nextCursor: 'notice-second', unreadCount: 5 };
  handlers.listConversations = payload => payload.cursor ? new Promise(resolve => { finishChats = resolve; }) : { items: [{ id: 'chat-first', kind: 'direct', name: '原会话', unreadCount: 1 }], nextCursor: 'chat-second', unreadCount: 1 };
  await page.onLoad();
  const notices = page.loadMore(), repeatedNotices = page.loadMore();
  const chats = page.loadMoreConversations(), repeatedChats = page.loadMoreConversations();
  assert.equal(state.calls.filter(call => call.payload.cursor === 'notice-second').length, 1);
  assert.equal(state.calls.filter(call => call.payload.cursor === 'chat-second').length, 1);
  finishChats({ items: [{ id: 'chat-first', kind: 'direct', name: '更新会话', unreadCount: 0 }, { id: 'chat-second', kind: 'direct', name: '第二会话', unreadCount: 4 }], nextCursor: 'chat-third', unreadCount: 4 });
  await chats; await repeatedChats;
  assert.equal(page.data.chatUnreadCount, 4); assert.equal(page.data.conversationCursor, 'chat-third');
  assert.equal(page.data.nextCursor, 'notice-second'); assert.equal(page.data.unreadCount, 5);
  assert.equal(page.data.moreBusy, true);
  finishNotices({ items: [{ ...messages[0], title: '通知标题已更新' }, messages[1]], nextCursor: 'notice-third', unreadCount: 9 });
  await notices; await repeatedNotices;
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-like', 'fixture-comment']);
  assert.equal(page.data.items[0].displayTitle, '通知标题已更新');
  assert.deepEqual(page.data.conversations.map(item => item.id), ['chat-first', 'chat-second']);
  assert.equal(page.data.conversations[0].name, '更新会话');
  assert.equal(page.data.nextCursor, 'notice-third'); assert.equal(page.data.conversationCursor, 'chat-third');
  assert.equal(page.data.unreadCount, 9); assert.equal(page.data.chatUnreadCount, 4);
  assert.equal(page.data.moreBusy, false); assert.equal(page.data.conversationMoreBusy, false);
});

test('hidden inbox requests cannot publish stale rows and returning restarts an interrupted initial load', async t => {
  const { page, handlers, messages, state } = fixture(t);
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  handlers.listMessages = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
  const initial = page.onLoad(); await started;
  page.onHide(); const calls = state.calls.length;
  await page.refresh(); await page.loadMore(); await page.loadMoreConversations(); page.openConversation(event('hidden'));
  assert.equal(state.calls.length, calls); assert.deepEqual(state.navigations, []);
  handlers.listMessages = () => ({ items: [{ ...messages[1], id: 'current-notice' }], unreadCount: 1 });
  await page.onShow();
  assert.equal(page.data.loading, false);
  finish({ items: [{ ...messages[0], id: 'old-notice' }], unreadCount: 99 }); await initial;
  assert.deepEqual(page.data.items.map(item => item.id), ['current-notice']);
  assert.equal(page.data.unreadCount, 1);
});

test('hiding the page during a read acknowledgement prevents notification and chat navigation', async t => {
  const { page, handlers, state, messages } = fixture(t);
  handlers.listConversations = () => ({ items: [{ id: 'chat', kind: 'direct', name: '会话', unreadCount: 1 }], unreadCount: 1 });
  await page.onLoad();
  let finish;
  handlers.readMessage = () => new Promise(resolve => { finish = resolve; });
  const pending = page.openMessage(event(messages[0].id));
  page.onHide(); page.openConversation(event('chat'));
  finish({ unreadCount: 4 }); await pending;
  assert.deepEqual(state.navigations, []);
  assert.equal(page.data.items[0].isRead, false);
  assert.equal(page.data.unreadCount, 5);
});

test('notification categories toggle independently while preserving expanded notes and their unread state', async t => {
  const { page, handlers, state } = fixture(t);
  handlers.listConversations = payload => ({ items: [{ id: payload.cursor || 'first', kind: 'direct', name: '宠友', unreadCount: 2 }], nextCursor: payload.cursor ? 'third' : 'second', unreadCount: 4 });
  await page.onLoad(); await page.loadMoreConversations();
  const notes = structuredClone(page.data.conversations);
  assert.equal(page.data.category, 'all'); assert.equal(page.data.categoryTitle, '全部通知');
  assert.deepEqual(page.data.notificationCategories.map(item => [item.id, item.label, item.unreadCount, item.badge]), [
    ['interactions', '赞和收藏', 1, '1'], ['comments', '留言', 5, '5'], ['follows', '新增关注', 1, '1']
  ]);
  state.calls.length = 0; state.viewWrites.length = 0;
  await page.selectCategory(event('interactions'));
  assert.equal(page.data.categoryTitle, '赞和收藏');
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-like']);
  await page.selectCategory(event('interactions'));
  assert.equal(page.data.category, 'all'); assert.equal(page.data.items.length, 5);
  await page.selectCategory(event('follows'));
  assert.equal(page.data.categoryTitle, '新增关注');
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-follow']);
  await page.clearCategory();
  const calls = state.calls.length;
  await page.clearCategory(); await page.selectCategory(event('invalid'));
  assert.equal(state.calls.length, calls);
  assert.deepEqual(page.data.conversations, notes);
  assert.equal(page.data.conversationCursor, 'third'); assert.equal(page.data.chatUnreadCount, 4);
  assert.ok(state.calls.every(call => ['bootstrap', 'listMessages'].includes(call.action)));
  assert.ok(state.viewWrites.every(value => value.loading !== true && !Object.hasOwn(value, 'conversations')));
});

test('category filters combine with search and pagination and remain selected on return', async t => {
  const { page, handlers, state, messages } = fixture(t);
  const list = handlers.listMessages;
  handlers.listMessages = payload => payload.category === 'comments'
    ? { ...list(payload), items: [{ ...messages[1], id: payload.cursor ? 'older-comment' : messages[1].id, createdAt: payload.cursor ? 100 : 200 }], nextCursor: payload.cursor ? null : 'comments-next' }
    : list(payload);
  await page.onLoad(); await page.selectCategory(event('comments'));
  page.openSearch(); page.inputSearch({ detail: { value: '  测试乙  ' } }); await page.search();
  await page.loadMore();
  assert.deepEqual(state.calls.filter(call => call.action === 'listMessages').at(-1).payload, { category: 'comments', query: '测试乙', cursor: 'comments-next' });
  assert.equal(page.data.categoryTitle, '留言');
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-comment', 'older-comment']);
  page.onHide(); await page.onShow();
  assert.equal(page.data.category, 'comments'); assert.equal(page.data.query, '测试乙');
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-comment', 'older-comment']);
  await page.cancelSearch();
  assert.equal(page.data.category, 'comments'); assert.equal(page.data.query, '');
  assert.deepEqual(state.calls.filter(call => call.action === 'listMessages').at(-1).payload, { category: 'comments', query: '' });
  assert.ok(state.calls.filter(call => call.action === 'listConversations').every(call => !Object.hasOwn(call.payload, 'category')));
});

test('category badges validate each global count and preserve unknown values from incomplete cloud responses', async t => {
  const { page, handlers } = fixture(t);
  handlers.listMessages = () => ({ items: [], unreadCount: 150, categoryUnread: { interactions: 125, comments: 0, follows: '2' } });
  await page.onLoad();
  assert.deepEqual(page.data.notificationCategories.map(item => [item.unreadCount, item.badge]), [[125, '99+'], [0, ''], [null, '']]);
  handlers.listMessages = () => ({ items: [], unreadCount: 0, categoryUnread: null });
  await page.selectCategory(event('interactions'));
  assert.equal(page.data.unreadCount, 0);
  assert.deepEqual(page.data.notificationCategories.map(item => [item.unreadCount, item.badge]), [[null, ''], [null, ''], [null, '']]);
  handlers.listMessages = () => ({ items: [], categoryUnread: { interactions: -1, comments: 1.5, follows: Number.MAX_SAFE_INTEGER + 1 } });
  await page.retryNotifications();
  assert.equal(page.data.unreadCount, null); assert.equal(page.data.countsReady, false);
  assert.ok(page.data.notificationCategories.every(item => item.unreadCount === null && item.badge === ''));
});

test('switching notification categories rejects old notification pages without cancelling a pending notes page', async t => {
  const { page, handlers, messages } = fixture(t);
  let finishNotices, finishNotes;
  const list = handlers.listMessages;
  handlers.listMessages = payload => payload.cursor ? new Promise(resolve => { finishNotices = resolve; }) : { ...list(payload), nextCursor: payload.category === 'all' ? 'old-notices' : null };
  handlers.listConversations = payload => payload.cursor ? new Promise(resolve => { finishNotes = resolve; }) : { items: [{ id: 'first', kind: 'direct', name: '宠友甲' }], nextCursor: 'notes-next', unreadCount: 2 };
  await page.onLoad();
  const notices = page.loadMore(), notes = page.loadMoreConversations();
  await page.selectCategory(event('comments'));
  finishNotices({ items: [messages[0]], nextCursor: 'stale', unreadCount: 999, categoryUnread: { interactions: 999, comments: 999, follows: 999 } }); await notices;
  finishNotes({ items: [{ id: 'second', kind: 'direct', name: '宠友乙' }], nextCursor: 'notes-third', unreadCount: 3 }); await notes;
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-comment']);
  assert.equal(page.data.category, 'comments'); assert.equal(page.data.nextCursor, null); assert.equal(page.data.unreadCount, 5);
  assert.deepEqual(page.data.notificationCategories.map(item => item.unreadCount), [1, 4, 1]);
  assert.deepEqual(page.data.conversations.map(item => item.id), ['first', 'second']);
  assert.equal(page.data.conversationCursor, 'notes-third'); assert.equal(page.data.chatUnreadCount, 3);
});

test('rapid category changes and local failures never publish old categories and retry leaves notes in place', async t => {
  const { page, handlers, messages, state } = fixture(t);
  const list = handlers.listMessages;
  handlers.listConversations = () => ({ items: [{ id: 'note', kind: 'direct', name: '宠友' }], unreadCount: 1 });
  await page.onLoad();
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  handlers.listMessages = payload => payload.category === 'interactions' ? (entered(), new Promise(resolve => { finish = resolve; })) : list(payload);
  const old = page.selectCategory(event('interactions')); await started;
  assert.equal(page.data.notificationLoading, true); assert.equal(page.data.loading, false);
  await page.selectCategory(event('follows'));
  finish({ items: [messages[0]], unreadCount: 999 }); await old;
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-follow']);
  assert.equal(page.data.category, 'follows'); assert.equal(page.data.notificationLoading, false); assert.equal(page.data.unreadCount, 5);
  handlers.listMessages = () => { throw Error('通知临时断开'); };
  await page.selectCategory(event('comments'));
  assert.equal(page.data.notificationError, '通知临时断开'); assert.equal(page.data.error, '');
  assert.equal(page.data.items.length, 0); assert.equal(page.data.conversations[0].id, 'note');
  state.calls.length = 0;
  handlers.listMessages = list; await page.retryNotifications();
  assert.equal(page.data.notificationError, ''); assert.equal(page.data.categoryTitle, '留言');
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-comment']);
  assert.deepEqual(state.calls.map(call => call.action), ['bootstrap', 'listMessages']);
});

test('a read acknowledgement from a previous category cannot mark, count or navigate the replacement category', async t => {
  const { page, handlers, state } = fixture(t);
  await page.onLoad(); await page.selectCategory(event('interactions'));
  let finish;
  handlers.readMessage = () => new Promise(resolve => { finish = resolve; });
  const read = page.openMessage(event('fixture-like'));
  await page.selectCategory(event('follows'));
  finish({ unreadCount: 0, categoryUnread: { interactions: 0, comments: 0, follows: 0 } }); await read;
  assert.equal(page.data.category, 'follows'); assert.equal(page.data.items[0].id, 'fixture-follow'); assert.equal(page.data.items[0].isRead, false);
  assert.equal(page.data.unreadCount, 5); assert.equal(page.data.notificationCategories[2].unreadCount, 1);
  assert.deepEqual(state.navigations, []); assert.equal(page.data.busy, false);
});

test('reading all from a selected category covers every notification and updates badges without consuming notes', async t => {
  const { page, handlers, state, messages } = fixture(t);
  handlers.listConversations = () => ({ items: [{ id: 'note', kind: 'direct', name: '宠友' }], nextCursor: 'more-notes', unreadCount: 3 });
  await page.onLoad(); await page.selectCategory(event('comments'));
  page.openSearch(); page.inputSearch({ detail: { value: '测试乙' } }); await page.search();
  const notes = structuredClone(page.data.conversations);
  state.calls.length = 0;
  await page.readAll();
  assert.deepEqual(state.calls, [{ action: 'readMessage', payload: { all: true } }]);
  assert.ok(messages.every(item => item.isRead)); assert.ok(page.data.items.every(item => item.isRead));
  assert.equal(page.data.category, 'comments'); assert.equal(page.data.query, '测试乙');
  assert.equal(page.data.unreadCount, 0);
  assert.deepEqual(page.data.notificationCategories.map(item => [item.unreadCount, item.badge]), [[0, ''], [3, '3'], [0, '']]);
  assert.equal(page.data.inboxUnreadCount, 3);
  assert.deepEqual(page.data.conversations, notes); assert.equal(page.data.chatUnreadCount, 3); assert.equal(page.data.conversationCursor, 'more-notes');
});

test('category refresh discards previous-account notes and ignores a hidden category response', async t => {
  const { page, handlers, messages } = fixture(t);
  handlers.listConversations = () => ({ items: [{ id: 'old-note', kind: 'direct', name: '旧账号宠友' }], unreadCount: 1 });
  await page.onLoad();
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  handlers.listMessages = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
  const old = page.selectCategory(event('interactions')); await started; page.onHide();
  finish({ items: [messages[0]], unreadCount: 999 }); await old;
  assert.equal(page.data.items.length, 0); assert.equal(page.data.notificationLoading, false);
  handlers.listMessages = () => ({ items: [messages[0]], unreadCount: 1 });
  await page.onShow();
  assert.equal(page.data.category, 'interactions');
  handlers.bootstrap = () => ({ mode: 'cloud', user: { id: 'replacement-owner' } });
  handlers.listMessages = () => { throw Error('新账号通知不可读'); };
  handlers.listConversations = () => { throw Error('新账号留言不可读'); };
  await page.selectCategory(event('comments'));
  assert.deepEqual(page.data.items, []); assert.deepEqual(page.data.conversations, []);
  assert.equal(page.data.unreadCount, null); assert.equal(page.data.chatUnreadCount, null);
  assert.ok(page.data.notificationCategories.every(item => item.unreadCount === null));
  assert.equal(page.data.error, ''); assert.match(page.data.inboxError, /新账号通知不可读/);
});

test('read receipts cannot restore unverified totals or ghost category badges removed by a list visibility check', async t => {
  const { page, handlers, messages } = fixture(t);
  handlers.listMessages = () => ({ items: [messages[1]], unreadCount: null, categoryUnread: null });
  handlers.readMessage = () => ({ success: true, unreadCount: 2, categoryUnread: { interactions: 2, comments: 0, follows: 0 } });
  await page.onLoad(); await page.openMessage(event('fixture-comment'));
  assert.equal(page.data.items[0].isRead, true);
  assert.equal(page.data.unreadCount, null); assert.equal(page.data.countsReady, false);
  assert.ok(page.data.notificationCategories.every(item => item.unreadCount === null && item.badge === ''));
  handlers.listMessages = () => ({ items: [messages[1]], unreadCount: 3, categoryUnread: { interactions: null, comments: 2, follows: 1 } });
  await page.retryNotifications();
  assert.equal(page.data.unreadCount, 3); assert.equal(page.data.countsReady, true);
  handlers.readMessage = () => ({ success: true, unreadCount: 2, categoryUnread: { interactions: 2, comments: 1, follows: 1 } });
  await page.openMessage(event('fixture-comment'));
  assert.equal(page.data.unreadCount, 2);
  assert.deepEqual(page.data.notificationCategories.map(item => [item.unreadCount, item.badge]), [[null, ''], [1, '1'], [1, '1']]);
  handlers.readMessage = () => ({ success: true, unreadCount: 0, categoryUnread: { interactions: 0, comments: 0, follows: 0 } });
  await page.readAll();
  assert.deepEqual(page.data.notificationCategories.map(item => [item.unreadCount, item.badge]), [[null, ''], [0, ''], [0, '']]);
  handlers.listMessages = () => ({ items: [], unreadCount: 0, categoryUnread: { interactions: 0, comments: 0, follows: 0 } });
  await page.retryNotifications();
  assert.ok(page.data.notificationCategories.every(item => item.unreadCount === 0));
});

test('one inbox merges comment, reply and direct-note entries with collision-safe identities and counts', async t => {
  const { page, handlers, messages, state } = fixture(t);
  handlers.listMessages = () => ({ items: [{ ...messages[1], id: 'same', createdAt: 300 }, { ...messages[1], id: 'reply', kind: 'reply', createdAt: 100 }], unreadCount: 3, categoryUnread: { interactions: 1, comments: 2, follows: 0 } });
  handlers.listConversations = () => ({ items: [{ id: 'same', kind: 'direct', name: '宠友留言', updatedAt: 200, unreadCount: 4 }], unreadCount: 4 });
  await page.onLoad();
  assert.deepEqual(page.data.inboxItems.map(item => [item.rowKey, item.sourceLabel]), [['notification:same', '内容评论'], ['conversation:same', '一对一留言'], ['notification:reply', '内容回复']]);
  assert.equal(page.data.inboxUnreadCount, 7); assert.equal(page.data.notificationCategories[1].label, '留言'); assert.equal(page.data.notificationCategories[1].unreadCount, 6);
  await page.selectCategory(event('comments'));
  assert.equal(page.data.inboxItems.length, 3); assert.equal(page.data.categoryTitle, '留言'); assert.equal(page.data.notificationCategories[1].unreadCount, 6);
  handlers.readMessage = () => ({ unreadCount: 2, categoryUnread: { interactions: 1, comments: 1, follows: 0 } });
  await page.openInboxItem(event('same', { type: 'notification' }));
  assert.equal(page.data.inboxItems.find(item => item.rowKey === 'notification:same').isRead, true);
  assert.equal(page.data.notificationCategories[1].unreadCount, 5); assert.equal(page.data.inboxUnreadCount, 6);
  page.openInboxItem(event('same', { type: 'conversation' }));
  assert.equal(state.navigations.at(-1), '/social/pages/chat/index?id=same');
  assert.equal(state.calls.some(call => call.action === 'readConversation'), false);
});

test('unified pagination buffers old rows until both sources cover their time range', async t => {
  const { page, handlers, messages, state } = fixture(t);
  handlers.listMessages = payload => ({ items: (payload.cursor ? [80, 20] : [100, 90]).map(createdAt => ({ ...messages[1], id: 'notice-' + createdAt, createdAt })), nextCursor: payload.cursor ? null : 'notice-next', unreadCount: 4, categoryUnread: { interactions: 0, comments: 4, follows: 0 } });
  handlers.listConversations = () => ({ items: [95, 10].map(updatedAt => ({ id: 'note-' + updatedAt, kind: 'direct', name: '宠友', updatedAt, unreadCount: 1 })), unreadCount: 2 });
  await page.onLoad();
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['notice-100', 'note-95', 'notice-90']);
  assert.equal(page.data.conversations.length, 2, 'the older direct note is buffered in raw state');
  assert.equal(page.data.hasMoreInbox, true);
  const before = state.calls.length;
  await Promise.all([page.loadMoreInbox(), page.loadMoreInbox()]);
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['notice-100', 'note-95', 'notice-90', 'notice-80', 'notice-20', 'note-10']);
  assert.equal(page.data.hasMoreInbox, false); assert.equal(page.data.inboxMoreBusy, false);
  assert.deepEqual(state.calls.slice(before).map(call => call.action), ['listMessages']);
});

test('unified pagination advances direct notes when their boundary is newer and never leaks notes into other categories', async t => {
  const { page, handlers, messages } = fixture(t);
  handlers.listMessages = payload => ({ items: payload.category === 'interactions' ? [{ ...messages[0], createdAt: 500 }] : [95, 10].map(createdAt => ({ ...messages[1], id: 'notice-' + createdAt, createdAt })), unreadCount: 3, categoryUnread: { interactions: 1, comments: 2, follows: 0 } });
  handlers.listConversations = payload => ({ items: (payload.cursor ? [80, 20] : [100, 90]).map(updatedAt => ({ id: 'note-' + updatedAt, kind: 'direct', name: '宠友', updatedAt, unreadCount: 1 })), nextCursor: payload.cursor ? null : 'notes-next', unreadCount: 4 });
  await page.onLoad();
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['note-100', 'notice-95', 'note-90']);
  await page.loadMoreInbox();
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['note-100', 'notice-95', 'note-90', 'note-80', 'note-20', 'notice-10']);
  await page.selectCategory(event('interactions'));
  assert.deepEqual(page.data.inboxItems.map(item => item.entryType), ['notification']);
  assert.equal(page.data.notificationCategories[1].unreadCount, 6);
});

test('a failed inbox source leaves the other source visible and counts unknown until retry succeeds', async t => {
  const { page, handlers, messages } = fixture(t);
  handlers.listMessages = () => { throw Error('通知连接失败'); };
  handlers.listConversations = () => ({ items: [{ id: 'available-note', kind: 'direct', name: '宠友', updatedAt: 50, unreadCount: 2 }], unreadCount: 2 });
  await page.onLoad();
  assert.equal(page.data.error, ''); assert.match(page.data.inboxError, /通知连接失败/);
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['available-note']);
  assert.equal(page.data.inboxUnreadCount, null); assert.equal(page.data.notificationCategories[1].unreadCount, null);
  handlers.listMessages = () => ({ items: [{ ...messages[1], createdAt: 100 }], unreadCount: 1, categoryUnread: { interactions: 0, comments: 1, follows: 0 } });
  await page.retryInbox();
  assert.equal(page.data.inboxError, ''); assert.equal(page.data.inboxUnreadCount, 3);
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['fixture-comment', 'available-note']);
  handlers.listConversations = () => { throw Error('留言连接失败'); };
  await page.refresh();
  assert.equal(page.data.error, ''); assert.match(page.data.inboxError, /留言连接失败/);
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['fixture-comment']);
  assert.equal(page.data.inboxUnreadCount, null); assert.equal(page.data.notificationCategories[1].unreadCount, null);
});

test('equal-time pages keep a deterministic source and ID boundary before releasing buffered rows', async t => {
  const { page, handlers, messages } = fixture(t);
  handlers.listMessages = () => ({ items: [{ ...messages[1], id: 'zz', createdAt: 100 }], unreadCount: 1, categoryUnread: { interactions: 0, comments: 1, follows: 0 } });
  handlers.listConversations = payload => ({ items: (payload.cursor ? [{ id: 'a', updatedAt: 100 }, { id: 'old', updatedAt: 90 }] : [{ id: 'z', updatedAt: 100 }]).map(item => ({ ...item, kind: 'direct', name: '宠友', unreadCount: 1 })), nextCursor: payload.cursor ? null : 'c_100_z', unreadCount: 3 });
  await page.onLoad();
  assert.deepEqual(page.data.inboxItems.map(item => item.rowKey), ['conversation:z']);
  await page.loadMoreInbox();
  assert.deepEqual(page.data.inboxItems.map(item => item.rowKey), ['conversation:z', 'conversation:a', 'notification:zz', 'conversation:old']);
  assert.deepEqual(page.data.inboxItems.map(item => item.timelineAt), [100, 100, 100, 90]);
});

test('empty filtered pages retain the server time boundary and repeated cursors stop with a retryable error', async t => {
  const { page, handlers, messages, state } = fixture(t);
  handlers.listMessages = payload => payload.cursor
    ? { items: [{ ...messages[1], id: 'visible', createdAt: 70 }], unreadCount: null, categoryUnread: null }
    : { items: [], nextCursor: 'm_90_removed', unreadCount: null, categoryUnread: null };
  handlers.listConversations = () => ({ items: [{ id: 'older-note', kind: 'direct', name: '宠友', updatedAt: 50, unreadCount: 1 }], unreadCount: 1 });
  await page.onLoad();
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['visible', 'older-note']);
  assert.equal(state.calls.filter(call => call.action === 'listMessages').length, 2);
  assert.equal(page.data.inboxUnreadCount, null);
  handlers.listMessages = payload => ({ items: payload.cursor ? [] : [{ ...messages[1], id: 'first', createdAt: 100 }], nextCursor: 'm_100_first', unreadCount: null, categoryUnread: null });
  await page.refresh(); await page.loadMoreInbox();
  assert.match(page.data.inboxError, /分页暂时不可用/);
  assert.equal(page.data.hasMoreInbox, false); assert.equal(page.data.inboxMoreBusy, false);
  assert.equal(page.data.inboxItems.some(item => item.id === 'older-note'), true, 'the other source stays usable while the failed source is identified');
});

test('a stale unified page cannot restore rows after a query change and merged notes follow the current search', async t => {
  const { page, handlers, messages } = fixture(t);
  let finish;
  handlers.listMessages = payload => payload.cursor ? new Promise(resolve => { finish = resolve; }) : { items: [{ ...messages[1], id: payload.query ? 'current-comment' : 'old-comment', createdAt: payload.query ? 200 : 100 }], nextCursor: payload.query ? null : 'old-next', unreadCount: 1, categoryUnread: { interactions: 0, comments: 1, follows: 0 } };
  handlers.listConversations = payload => ({ items: [{ id: payload.query ? 'current-note' : 'old-note', kind: 'direct', name: '宠友', updatedAt: payload.query ? 150 : 10, unreadCount: 2 }], unreadCount: 2 });
  await page.onLoad();
  const old = page.loadMoreInbox();
  page.inputSearch({ detail: { value: '新内容' } }); await page.search();
  finish({ items: [{ ...messages[0], id: 'stale', createdAt: 90 }], unreadCount: 99 }); await old;
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['current-comment', 'current-note']);
  assert.equal(page.data.query, '新内容'); assert.equal(page.data.inboxUnreadCount, 3); assert.equal(page.data.inboxMoreBusy, false);
  await page.selectCategory(event('comments'));
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['current-comment', 'current-note']);
});

test('unified pagination detects an A-to-B-to-A cursor cycle without new rows', async t => {
  const { page, handlers, messages, state } = fixture(t);
  handlers.listMessages = payload => ({ items: payload.cursor ? [] : [{ ...messages[1], id: 'first', createdAt: 100 }], nextCursor: payload.cursor === 'm_100_first' ? 'm_90_removed' : 'm_100_first', unreadCount: 1, categoryUnread: { interactions: 0, comments: 1, follows: 0 } });
  handlers.listConversations = () => ({ items: [{ id: 'available-note', kind: 'direct', name: '宠友', updatedAt: 5, unreadCount: 1 }], unreadCount: 1 });
  await page.onLoad();
  state.calls.length = 0;
  await page.loadMoreInbox();
  assert.deepEqual(state.calls.map(call => call.payload.cursor), ['m_100_first', 'm_90_removed']);
  assert.match(page.data.inboxError, /分页暂时不可用/); assert.equal(page.data.inboxMoreBusy, false);
  assert.deepEqual(page.data.inboxItems.map(item => item.id), ['first', 'available-note']);
});

test('account rejection during unified pagination clears both raw sources and their derived entries', async t => {
  const { page, handlers, messages } = fixture(t);
  handlers.listMessages = payload => {
    if (payload.cursor) throw Object.assign(Error('账号已不可用'), { code: 'ACCOUNT_UNAVAILABLE' });
    return { items: [{ ...messages[1], createdAt: 100 }], nextCursor: 'm_100_anchor', unreadCount: 1, categoryUnread: { interactions: 0, comments: 1, follows: 0 } };
  };
  handlers.listConversations = () => ({ items: [{ id: 'note', kind: 'direct', name: '宠友', updatedAt: 50, unreadCount: 1 }], unreadCount: 1 });
  await page.onLoad(); await page.loadMoreInbox();
  assert.equal(page.data.errorCode, 'ACCOUNT_UNAVAILABLE');
  assert.deepEqual(page.data.items, []); assert.deepEqual(page.data.conversations, []); assert.deepEqual(page.data.inboxItems, []);
  assert.equal(page.data.inboxUnreadCount, null); assert.equal(page.data.inboxMoreBusy, false);
});
