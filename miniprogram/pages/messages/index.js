const s = require('../_shared');
const CATEGORIES = ['all', 'interactions', 'comments', 'follows', 'system'];
const LABELS = { all: '全部通知', interactions: '赞与收藏', comments: '评论与回复', follows: '新增关注', system: '系统与活动' };
const ENTRIES = [
  { id: 'interactions', name: '赞与收藏', icon: 'heart' },
  { id: 'comments', name: '评论与回复', icon: 'comment' },
  { id: 'follows', name: '新增关注', icon: 'person' }
];
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function counts(result) {
  const unreadCount = count(result.unreadCount);
  const categoryUnread = {};
  ['interactions', 'comments', 'follows', 'system'].forEach(category => {
    categoryUnread[category] = count(result.categoryUnread && result.categoryUnread[category]);
  });
  return { unreadCount, categoryUnread, countsReady: unreadCount !== null && Object.values(categoryUnread).every(value => value !== null),
    entries: ENTRIES.map(entry => ({ ...entry, unread: categoryUnread[entry.id], badge: categoryUnread[entry.id] > 99 ? '99+' : String(categoryUnread[entry.id] || '') })) };
}
function safeImage(value) {
  if (s.httpsUrl(value)) return value;
  if (typeof value !== 'string' || /[\s\\<>"\u0000-\u001f\u007f]/.test(value)) return '';
  if (/^\/assets\/[a-zA-Z0-9_./-]+$/.test(value) && !value.split('/').includes('..')) return value;
  return /^cloud:\/\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_./%()-]+$/.test(value) && !value.split('/').includes('..') ? value : '';
}
function categoryOf(item) {
  if (CATEGORIES.includes(item.category) && item.category !== 'all') return item.category;
  if (['like', 'bookmark', 'favorite', 'collect'].includes(item.kind)) return 'interactions';
  if (item.kind === 'follow' || item.targetType === 'user') return 'follows';
  return item.targetType === 'post' ? 'comments' : 'system';
}
function decorate(item, failedImages) {
  const actor = item.actor && typeof item.actor === 'object' ? item.actor : null;
  const nickname = actor && typeof actor.nickname === 'string' ? actor.nickname.trim() : '';
  const category = categoryOf(item);
  const avatar = safeImage(actor && actor.avatar), cover = safeImage(item.cover);
  return { ...s.message(item), category, actorName: nickname,
    displayTitle: nickname || item.title || LABELS[category],
    actionText: nickname ? item.title || '' : '',
    initial: nickname ? Array.from(nickname)[0] : '',
    avatarUrl: failedImages[item.id + ':avatar'] === avatar ? '' : avatar,
    coverUrl: failedImages[item.id + ':cover'] === cover ? '' : cover,
    symbol: category === 'interactions' ? '♡' : category === 'comments' ? '↩' : category === 'follows' ? '+' : item.targetType === 'event' ? '◷' : '✦',
    timeText: Number.isFinite(item.createdAt) && item.createdAt > 0 ? s.relative(item.createdAt) : ''
  };
}

function chatView(item) {
  return { ...item, initial: Array.from(item.name || '聊')[0], timeText: item.lastAt ? s.relative(item.lastAt) : '', badge: item.unreadCount > 99 ? '99+' : String(item.unreadCount || '') };
}
function ownerOf(boot) { return boot && boot.user && boot.user.id ? boot.mode + ':' + boot.user.id : ''; }
function accountUnavailable(error) { return ['AUTH_REQUIRED', 'ACCOUNT_UNAVAILABLE'].includes(error.code); }
function retainRows(previous, incoming, decorateRow, complete) {
  const rows = new Map(incoming.map(item => [item.id, decorateRow(item)]));
  // New entries arrive on an explicit refresh; returning updates rows in place.
  return previous.length ? previous.filter(item => !complete || rows.has(item.id)).map(item => rows.get(item.id) || item) : Array.from(rows.values());
}
async function readPages(action, payload, previous, depth, current) {
  const field = action === 'listMessages' ? 'createdAt' : 'updatedAt';
  const before = (a, b) => a[field] < b[field] || a[field] === b[field] && a.id <= b.id;
  const oldest = previous.length && previous.every(item => Number.isFinite(item[field]))
    ? previous.reduce((a, b) => before(a, b) ? a : b) : null;
  const missing = new Set(previous.map(item => item.id)), seen = new Set(), pages = [];
  let cursor = null, complete = false;
  do {
    seen.add(cursor);
    const result = await s.api.call(action, { ...payload, ...(cursor ? { cursor } : {}) });
    pages.push(result);
    const items = result.items || [];
    items.forEach(item => missing.delete(item.id));
    const last = items[items.length - 1];
    cursor = result.nextCursor || null;
    complete = !missing.size || !cursor || !!(oldest && last && before(last, oldest));
    // Read through the old visible range so new rows cannot displace it and
    // revoked conversations or notifications can be removed from the cache.
    if (complete || !current() || !oldest && pages.length >= depth) break;
  } while (cursor && !seen.has(cursor));
  return { pages, complete };
}
function emptyInbox() {
  return { items: [], nextCursor: null, conversations: [], conversationCursor: null, ...counts({}),
    chatUnreadCount: null, friendRequestCount: 0, socialError: '', conversationMoreBusy: false, moreBusy: false };
}
function navigationSize() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {};
    const statusBarHeight = Number.isFinite(info.statusBarHeight) ? Math.max(0, Math.min(100, info.statusBarHeight)) : 0;
    const capsule = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null;
    const row = capsule && capsule.top >= statusBarHeight && capsule.height > 0 ? capsule.height + 2 * (capsule.top - statusBarHeight) : 44;
    return { statusBarHeight, navigationHeight: Math.max(44, Math.min(64, row)) };
  } catch (_) { return { statusBarHeight: 0, navigationHeight: 44 }; }
}
s.register({
  data: {
    loading: true, error: '', items: [], nextCursor: null, moreBusy: false,
    unreadCount: null, categoryUnread: { interactions: null, comments: null, follows: null, system: null },
    countsReady: false, entries: ENTRIES.map(entry => ({ ...entry, unread: null, badge: '' })),
    category: 'all', categoryLabel: LABELS.all, busy: false, mode: '',
    searchOpen: false, searchFocused: false, searchText: '', query: '', menuOpen: false,
    statusBarHeight: 0, navigationHeight: 44, conversations: [], conversationCursor: null, conversationMoreBusy: false,
    chatUnreadCount: null, friendRequestCount: 0, socialError: ''
  },
  onLoad() { this._failedImages = Object.create(null); s.safe(this, navigationSize()); return this.refresh(); },
  onShow() { if (this._loaded) return this.refresh({ retain: true }); },
  onHide() { s.safe(this, { menuOpen: false, searchFocused: false }); },
  onPullDownRefresh() { return this.refresh(); },
  refresh(options = {}) {
    const { category, query } = this.data;
    const retain = options.retain === true && this._loaded && !this.data.error && !!this._owner;
    const owner = this._owner;
    const previous = { items: this.data.items, nextCursor: this.data.nextCursor, conversations: this.data.conversations,
      conversationCursor: this.data.conversationCursor };
    const messagePages = (this._messagePages || [null]).slice(), conversationPages = (this._conversationPages || [null]).slice();
    this._conversationMoreId = (this._conversationMoreId || 0) + 1;
    s.safe(this, { ...(retain ? {} : counts({})), conversationMoreBusy: false });
    return s.load(this, async () => {
      const id = this._loadId;
      this._refreshing = id;
      const current = () => !this._closed && id === this._loadId;
      let sameOwner = retain;
      try {
        let boot;
        try { boot = await s.api.call('bootstrap'); }
        catch (error) { if (retain || accountUnavailable(error)) throw error; boot = null; }
        if (!current()) return;
        const nextOwner = ownerOf(boot);
        sameOwner = retain && !!nextOwner && nextOwner === owner;
        if (owner && nextOwner !== owner) {
          this._owner = '';
          this._failedImages = Object.create(null);
          s.safe(this, { ...emptyInbox(), mode: boot ? boot.mode : '', loading: true });
        }
        const [results, social] = await Promise.all([
          readPages('listMessages', { category, query }, sameOwner ? previous.items : [], messagePages.length, current),
          Promise.all([readPages('listConversations', { query }, sameOwner ? previous.conversations : [], conversationPages.length, current), s.api.call('getFriendHub')])
            .then(([result, hub]) => ({ conversations: sameOwner ? retainRows(previous.conversations, result.pages.flatMap(page => page.items || []), chatView, result.complete) : (result.pages[0].items || []).map(chatView),
              conversationCursor: sameOwner && previous.conversations.length ? previous.conversationCursor : result.pages[0].nextCursor || null,
              chatUnreadCount: count(result.pages[0].unreadCount), friendRequestCount: (hub.incoming || []).length, socialError: '' }))
            .catch(error => {
              if (accountUnavailable(error)) throw error;
              return sameOwner ? {} : { conversations: [], conversationCursor: null, chatUnreadCount: null, friendRequestCount: 0, socialError: error.message || '聊天暂时未能加载，请重试' };
            })
        ]);
        if (!current()) return;
        this._owner = nextOwner;
        this._messagePages = sameOwner ? messagePages : [null];
        this._conversationPages = sameOwner ? conversationPages : [null];
        return { mode: boot ? boot.mode : this.data.mode,
          items: sameOwner ? retainRows(previous.items, results.pages.flatMap(page => page.items || []), item => decorate(item, this._failedImages), results.complete) : (results.pages[0].items || []).map(item => decorate(item, this._failedImages)),
          nextCursor: sameOwner && previous.items.length ? previous.nextCursor : results.pages[0].nextCursor || null, ...counts(results.pages[0]), ...social };
      } catch (error) {
        if (current() && accountUnavailable(error)) {
          this._owner = '';
          s.safe(this, { ...emptyInbox(), loading: false, error: error.message || '账号暂不可用，请重新进入', errorCode: error.code });
        } else if (current() && retain && !sameOwner) {
          s.safe(this, { loading: false, error: error.message || '暂时没有连接上，请重试', errorCode: error.code || '' });
        }
        throw error;
      } finally { if (this._refreshing === id) this._refreshing = 0; }
    }, { retain });
  },
  loadMore() {
    if (this._refreshing) return;
    const { category, query } = this.data;
    const cursor = this.data.nextCursor;
    return s.more(this, { key: 'items', request: cursor => s.api.call('listMessages', { category, query, cursor }),
      decorate: item => decorate(item, this._failedImages), extra: result => {
        this._messagePages = Array.from(new Set([...(this._messagePages || [null]), cursor]));
        return counts(result);
      } });
  },
  async loadMoreConversations() {
    if (this._refreshing || this.data.loading || this.data.conversationMoreBusy || !this.data.conversationCursor) return;
    const id = this._conversationMoreId = (this._conversationMoreId || 0) + 1;
    const loadId = this._loadId;
    const cursor = this.data.conversationCursor;
    s.safe(this, { conversationMoreBusy: true });
    try {
      const result = await s.api.call('listConversations', { query: this.data.query, cursor });
      if (this._closed || id !== this._conversationMoreId || loadId !== this._loadId) return;
      const merged = new Map(this.data.conversations.map(item => [item.id, item]));
      (result.items || []).forEach(item => merged.set(item.id, chatView(item)));
      this._conversationPages = Array.from(new Set([...(this._conversationPages || [null]), cursor]));
      s.safe(this, { conversations: Array.from(merged.values()), conversationCursor: result.nextCursor || null, chatUnreadCount: count(result.unreadCount) });
    } catch (error) { if (!this._closed && id === this._conversationMoreId) s.toast(error.message || '聊天暂时未能加载，请重试'); }
    finally { if (id === this._conversationMoreId) s.safe(this, { conversationMoreBusy: false }); }
  },
  openConversation(event) {
    const item = this.data.conversations.find(value => value.id === event.currentTarget.dataset.id);
    if (item) this.navigate('/social/pages/chat/index?id=' + encodeURIComponent(item.id));
  },
  openFriends() { this.navigate('/social/pages/friends/index'); },
  navigate(url) {
    wx.navigateTo({ url, fail: () => { if (!this._closed) s.toast('暂时无法打开，请稍后重试'); } });
  },
  openSearch() {
    if (this.data.busy) return;
    s.safe(this, { searchOpen: true, searchFocused: true, searchText: this.data.query, menuOpen: false });
  },
  focusSearch() { s.safe(this, { searchFocused: true }); },
  blurSearch() { s.safe(this, { searchFocused: false }); },
  inputSearch(event) { s.safe(this, { searchText: event.detail.value || '' }); },
  search() {
    if (this.data.busy) return;
    const query = Array.from(this.data.searchText.trim()).slice(0, 60).join('');
    s.safe(this, { searchText: query, query, searchFocused: false });
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    return this.refresh();
  },
  clearSearch() {
    if (this.data.busy) return;
    const hadQuery = !!this.data.query;
    s.safe(this, { searchText: '', query: '', searchFocused: this.data.searchOpen });
    if (hadQuery) return this.refresh();
  },
  cancelSearch() {
    if (this.data.busy) return;
    const hadQuery = !!this.data.query;
    s.safe(this, { searchOpen: false, searchFocused: false, searchText: '', query: '' });
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    if (hadQuery) return this.refresh();
  },
  toggleMenu() {
    if (!this.data.busy) s.safe(this, { menuOpen: !this.data.menuOpen, searchFocused: false });
  },
  closeMenu() { s.safe(this, { menuOpen: false }); },
  stopTouch() {},
  selectMenu(event) {
    if (this.data.busy) return;
    this.closeMenu();
    const id = event.currentTarget.dataset.id;
    const routes = { circles: '/pages/circle-square/index', group: '/social/pages/group-create/index', friend: '/social/pages/friends/index', contribute: '/social/pages/contribute/index' };
    if (routes[id]) this.navigate(routes[id]);
  },
  selectCategory(event) {
    if (this.data.busy) return;
    let category = event.currentTarget.dataset.id;
    if (!CATEGORIES.includes(category)) return;
    if (category !== 'all' && category === this.data.category) category = 'all';
    s.safe(this, { category, categoryLabel: LABELS[category] });
    return this.refresh();
  },
  readAll() {
    if (this.data.loading || this.data.unreadCount === null || this.data.unreadCount === 0) return;
    return s.action(this, async () => {
      const id = this._loadId;
      const result = await s.api.call('readMessage', { all: true });
      if (this._closed || id !== this._loadId) return;
      this.cancelPendingReads();
      s.safe(this, { items: this.data.items.map(item => ({ ...item, isRead: true })), ...counts(result || {}) });
    });
  },
  openMessage(event) {
    const item = this.data.items.find(value => value.id === event.currentTarget.dataset.id);
    if (!item) return;
    return s.action(this, async () => {
      const loadId = this._loadId;
      const result = await s.api.call('readMessage', { id: item.id });
      if (this._closed || loadId !== this._loadId) return;
      this.cancelPendingReads();
      const navigationId = this._loadId;
      s.safe(this, { items: this.data.items.map(value => value.id === item.id ? { ...value, isRead: true } : value), ...counts(result || {}) });
      if (item.targetType === 'system' || !['post', 'event', 'user'].includes(item.targetType)) {
        wx.showModal({ title: item.title || '系统通知', content: item.text || '暂无更多内容', showCancel: false, confirmText: '知道了' });
        return;
      }
      const id = typeof item.targetId === 'string' ? item.targetId.trim() : '';
      if (!id) return s.toast('这条消息关联的内容暂不可用');
      let url, target;
      if (item.targetType === 'post') {
        target = await s.api.call('getPost', { id });
        if (!target || !target.post) return s.toast('这篇分享已不可用');
        url = '/pages/post/index?id=' + encodeURIComponent(id);
      } else if (item.targetType === 'event') {
        target = await s.api.call('getEvent', { id });
        if (!target || !target.event) return s.toast('这场活动已不可用');
        url = '/pages/event/index?id=' + encodeURIComponent(id);
      } else {
        target = await s.api.call('getUserProfile', { userId: id });
        if (!target || !target.user) return s.toast('这个账号暂不可用');
        url = '/pages/author/index?userId=' + encodeURIComponent(id);
      }
      if (this._closed || navigationId !== this._loadId) return;
      wx.navigateTo({ url, fail: () => { if (!this._closed) s.toast('暂时无法打开，请稍后重试'); } });
    });
  },
  cancelPendingReads() {
    this._loadId = (this._loadId || 0) + 1;
    this._moreRequestId = (this._moreRequestId || 0) + 1;
    this._conversationMoreId = (this._conversationMoreId || 0) + 1;
    this._refreshing = 0;
    s.safe(this, { moreBusy: false, conversationMoreBusy: false });
  },
  imageFailed(event) {
    const { id, field, src } = event.currentTarget.dataset;
    if (!['avatar', 'cover'].includes(field)) return;
    const item = this.data.items.find(value => value.id === id);
    if (!item || item[field + 'Url'] !== src) return;
    this._failedImages[id + ':' + field] = src;
    s.safe(this, { items: this.data.items.map(value => value.id === id ? { ...value, [field + 'Url']: '' } : value) });
  }
});
