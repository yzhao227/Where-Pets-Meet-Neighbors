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
  const state = { calls: [], navigations: [], toasts: [], modals: [], navigationFail: false, writesAfterUnload: 0 };
  const saved = { wx: global.wx, Page: global.Page, call: api.call };
  const unread = () => {
    const categoryUnread = Object.fromEntries(categories.map(category => [category, messages.filter(item => item.category === category && !item.isRead).length]));
    return { unreadCount: messages.filter(item => !item.isRead).length, categoryUnread };
  };
  const handlers = {
    bootstrap: () => ({ mode: 'demo' }),
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
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { if (this._closed) state.writesAfterUnload += 1; Object.assign(this.data, value); } };
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
