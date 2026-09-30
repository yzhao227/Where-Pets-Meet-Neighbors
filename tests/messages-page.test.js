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
    listConversations: () => ({ items: [], unreadCount: 0 }), getFriendHub: () => ({ friends: [], incoming: [], outgoing: [] }),
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

test('message search keeps global unread counts, combines with categories, and restores the inbox on cancel', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.toggleMenu();
  page.openSearch();
  assert.equal(page.data.menuOpen, false);
  assert.equal(page.data.searchFocused, true);
  page.inputSearch({ detail: { value: '  测试乙  ' } });
  await page.search();
  assert.equal(page.data.query, '测试乙');
  assert.equal(page.data.searchText, '测试乙');
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-comment']);
  assert.equal(page.data.unreadCount, 5);
  assert.equal(state.calls.filter(call => call.action === 'readMessage').length, 0);
  await page.selectCategory(event('interactions'));
  assert.deepEqual(state.calls.filter(call => call.action === 'listMessages').at(-1).payload, { category: 'interactions', query: '测试乙' });
  assert.equal(page.data.items.length, 0);
  await page.cancelSearch();
  assert.equal(page.data.query, '');
  assert.equal(page.data.searchOpen, false);
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-like']);
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

test('message add menu routes to working social pages without creating data just by opening', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.toggleMenu();
  assert.equal(page.data.menuOpen, true);
  page.selectMenu(event('group'));
  assert.equal(page.data.menuOpen, false);
  assert.equal(state.navigations.at(-1), '/social/pages/group-create/index');
  page.selectMenu(event('friend'));
  assert.equal(state.navigations.at(-1), '/social/pages/friends/index');
  assert.equal(state.calls.filter(call => !['listMessages', 'bootstrap', 'listConversations', 'getFriendHub'].includes(call.action)).length, 0);
  page.selectMenu(event('circles'));
  assert.equal(state.navigations.at(-1), '/pages/circle-square/index');
  page.selectMenu(event('contribute'));
  assert.equal(state.navigations.at(-1), '/social/pages/contribute/index');
  page.toggleMenu();
  page.onHide();
  assert.equal(page.data.menuOpen, false);
  state.navigationFail = true;
  page.selectMenu(event('circles'));
  assert.match(state.toasts.at(-1), /无法打开/);
});

test('inbox search includes chat content and friend requests while preserving independent unread counts', async t => {
  const { page, handlers, state } = fixture(t);
  handlers.listConversations = payload => ({ items: payload.query === '毛孩子' ? [{ id: 'group?x=1&y=2', name: '一起遛狗', kind: 'group', lastText: '毛孩子今天真开心', unreadCount: 2 }] : [], unreadCount: 2 });
  handlers.getFriendHub = () => ({ incoming: [{ id: 'request-1' }] });
  await page.onLoad();
  page.openSearch(); page.inputSearch({ detail: { value: '毛孩子' } }); await page.search();
  assert.equal(page.data.conversations.length, 1);
  assert.equal(page.data.chatUnreadCount, 2);
  assert.equal(page.data.unreadCount, 5);
  assert.equal(page.data.friendRequestCount, 1);
  page.openConversation(event('group?x=1&y=2'));
  assert.equal(state.navigations.at(-1), '/social/pages/chat/index?id=group%3Fx%3D1%26y%3D2');
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

test('message entries use global category unread counts, filter at the service, and never auto-read', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  assert.equal(page.data.unreadCount, 5);
  assert.equal(page.data.countsReady, true);
  assert.deepEqual(page.data.entries.map(item => item.unread), [1, 1, 1]);
  assert.equal(page.data.categoryUnread.system, 2);
  assert.equal(state.calls.filter(call => call.action === 'readMessage').length, 0);
  await page.selectCategory(event('comments'));
  assert.equal(page.data.categoryLabel, '评论与回复');
  assert.deepEqual(page.data.items.map(item => item.id), ['fixture-comment']);
  assert.equal(page.data.unreadCount, 5, 'the total is not replaced by the selected page size');
  assert.equal(state.calls.filter(call => call.action === 'listMessages').at(-1).payload.category, 'comments');
  await page.selectCategory(event('comments'));
  assert.equal(page.data.category, 'all');
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/messages/index.wxml'), 'utf8');
  for (const match of markup.matchAll(/\b(?:bind|catch)(?:tap|input|change|confirm|error)="([^"]+)"/g)) assert.equal(typeof page[match[1]], 'function', match[1]);
});

test('message paging rejects stale category results and merges overlaps without duplicate requests', async t => {
  const { page, handlers, state, messages } = fixture(t);
  let resolveOld;
  const totals = value => ({ unreadCount: value, categoryUnread: { interactions: 1, comments: value - 1, follows: 0, system: 0 } });
  handlers.listMessages = payload => {
    if (payload.cursor === 'all-2') return new Promise(resolve => { resolveOld = resolve; });
    if (payload.cursor === 'comments-2') return { items: [{ ...messages[1], title: '更新的评论' }, { ...messages[1], id: 'fixture-comment-two' }], ...totals(7) };
    if (payload.category === 'comments') return { items: [messages[1]], nextCursor: 'comments-2', ...totals(9) };
    return { items: [messages[0]], nextCursor: 'all-2', ...totals(8) };
  };
  await page.onLoad();
  const old = page.loadMore();
  await page.selectCategory(event('comments'));
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
  assert.ok(page.data.entries.every(item => item.unread === null));
  await page.readAll();
  assert.equal(state.calls.filter(call => call.action === 'readMessage').length, 0);
  handlers.listMessages = () => { throw new Error('仅测试读取失败'); };
  await page.refresh();
  assert.equal(page.data.error, '仅测试读取失败');
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

test('unsafe or broken images fall back without inventing an actor and late reads never navigate', async t => {
  const { page, state, handlers, messages } = fixture(t);
  messages[0].cover = 'javascript:alert(1)';
  await page.onLoad();
  const first = page.data.items[0];
  assert.equal(first.coverUrl, '');
  const second = page.data.items[1];
  assert.equal(second.avatarUrl, '');
  assert.equal(second.initial, '测');
  assert.equal(page.data.items[4].actorName, '');
  page.imageFailed(event(first.id, { field: 'avatar', src: first.avatarUrl }));
  assert.equal(page.data.items[0].avatarUrl, '');
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
  const chat = (id, unreadCount) => ({ id, name: id, lastText: '仅内存会话', unreadCount });
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
  handlers.listConversations = () => ({ items: [{ id: 'cached-chat', name: '仅内存会话', unreadCount: 2 }], unreadCount: 2, nextCursor: 'older-chat' });
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
  assert.equal(page.data.socialError, ''); assert.equal(page.data.conversationCursor, 'older-chat');
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
  handlers.listConversations = () => ({ items: [{ id: active + ':' + mode, name: '仅内存会话' }], unreadCount: 0 });
  await page.onLoad(); await page.loadMore();
  active = 'new'; fail = true;
  await page.onShow();
  assert.deepEqual(page.data.items, []); assert.deepEqual(page.data.conversations, []);
  assert.equal(page.data.nextCursor, null); assert.equal(page.data.conversationCursor, null);
  assert.match(page.data.error, /新账号读取故障/); assert.equal(page.data.loading, false);
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

test('late retained inbox requests cannot restore a prior account or category', async t => {
  const { page, handlers, messages } = fixture(t);
  await page.onLoad();
  let resolveOld, started;
  const entered = new Promise(resolve => { started = resolve; });
  handlers.listMessages = () => { started(); return new Promise(resolve => { resolveOld = resolve; }); };
  const old = page.onShow(); await entered;
  handlers.bootstrap = () => ({ mode: 'demo', user: { id: 'new-owner' } });
  handlers.listMessages = () => ({ items: [{ ...messages[1], id: 'new-owner-comment' }], unreadCount: 0 });
  await page.selectCategory(event('comments'));
  resolveOld({ items: [{ ...messages[0], id: 'stale-private-notification' }], unreadCount: 99, nextCursor: 'stale-cursor' }); await old;
  assert.deepEqual(page.data.items.map(item => item.id), ['new-owner-comment']);
  assert.equal(page.data.category, 'comments'); assert.equal(page.data.unreadCount, 0);
  assert.equal(page.data.nextCursor, null);
});


test('new arrivals do not displace loaded inbox rows and revoked rows disappear on return', async t => {
  const { page, handlers, messages } = fixture(t);
  let notifications = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({ ...messages[0], id, createdAt: 600 - index * 100 }));
  let conversations = notifications.map(item => ({ id: item.id, name: item.id, updatedAt: item.createdAt, unreadCount: 1 }));
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
  conversations = [...arrivals.map(item => ({ id: item.id, name: item.id, updatedAt: item.createdAt, unreadCount: 1 })), ...conversations];
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
