const s = require('../_shared');
const notificationCategories = [
  { id: 'interactions', label: '赞和收藏' },
  { id: 'comments', label: '留言' },
  { id: 'follows', label: '新增关注' }
];
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function counts(result) {
  const unreadCount = count(result.unreadCount);
  const categoryUnread = result.categoryUnread && typeof result.categoryUnread === 'object' && !Array.isArray(result.categoryUnread) ? result.categoryUnread : {};
  return { unreadCount, countsReady: unreadCount !== null,
    categoryUnread: Object.fromEntries(notificationCategories.map(item => [item.id, count(categoryUnread[item.id])])) };
}
function readCounts(result, previous) {
  const next = counts(result);
  // A read acknowledgement is not a fresh visibility check. Only a list
  // response may restore counts hidden by the notification compatibility filter.
  if (count(previous.unreadCount) === null) { next.unreadCount = null; next.countsReady = false; }
  notificationCategories.forEach(item => {
    if (count(previous.categoryUnread[item.id]) === null) next.categoryUnread[item.id] = null;
  });
  return next;
}
function combinedCount(left, right) { return count(left) === null || count(right) === null ? null : count(left + right); }
function timelineTime(item, type) {
  const value = type === 'notification' ? item.createdAt : item.updatedAt === undefined ? item.lastAt : item.updatedAt;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
function timelineCompare(left, right) {
  return right.timelineAt - left.timelineAt || (left.entryType < right.entryType ? -1 : left.entryType > right.entryType ? 1 : 0) ||
    (left.id < right.id ? 1 : left.id > right.id ? -1 : 0);
}
function frontier(result, type) {
  if (!result.nextCursor) return null;
  // Server cursors bound scanned records, including legacy notices filtered by
  // the API adapter. Empty visible pages must retain that real time boundary.
  const prefix = type === 'notification' ? 'm' : 'c';
  const parsed = new RegExp('^' + prefix + '_(\\d{1,16})_([A-Za-z0-9_-]{1,120})$').exec(result.nextCursor);
  if (parsed && Number.isSafeInteger(Number(parsed[1]))) return { id: parsed[2], timelineAt: Number(parsed[1]), entryType: type };
  const rows = (result.items || []).map(item => ({ id: item.id, timelineAt: timelineTime(item, type), entryType: type })).sort(timelineCompare);
  return rows[rows.length - 1] || null;
}
function inboxSources(data) {
  const sources = [{ type: 'notification', cursor: data.nextCursor, frontier: data.notificationFrontier, error: data.notificationError }];
  if (['all', 'comments'].includes(data.category)) sources.push({ type: 'conversation', cursor: data.conversationCursor, frontier: data.conversationFrontier, error: data.socialError });
  return sources;
}
function canPrimeInbox(data) {
  return !data.inboxItems.length && data.hasMoreInbox && inboxSources(data).filter(source => source.cursor && !source.error).every(source => source.frontier);
}
function inboxView(data) {
  const includeNotes = ['all', 'comments'].includes(data.category);
  const rows = (data.items || []).map(item => ({ ...item, rowKey: 'notification:' + item.id, entryType: 'notification', timelineAt: timelineTime(item, 'notification'),
    sourceLabel: ({ comment: '内容评论', reply: '内容回复', like: '点赞', bookmark: '收藏', follow: '新增关注' })[item.kind] || '系统通知' }));
  if (includeNotes) directChats(data.conversations).forEach(item => rows.push({ ...item, rowKey: 'conversation:' + item.id, entryType: 'conversation',
    timelineAt: timelineTime(item, 'conversation'), sourceLabel: '一对一留言', displayTitle: item.name || '宠友留言', summaryText: item.lastText || '暂无留言内容', isRead: !(item.unreadCount > 0) }));
  const sources = inboxSources(data), active = sources.filter(source => source.cursor && !source.error);
  const boundaries = active.map(source => source.frontier).filter(Boolean).sort(timelineCompare);
  const boundary = boundaries[0];
  const unknownBoundary = data.notificationLoading || active.some(source => !source.frontier);
  const combined = rows.sort(timelineCompare);
  return { inboxItems: unknownBoundary ? [] : boundary ? combined.filter(item => timelineCompare(item, boundary) <= 0) : combined,
    inboxUnreadCount: combinedCount(data.unreadCount, data.chatUnreadCount), hasMoreInbox: active.length > 0,
    inboxError: sources.filter(source => source.error).map(source => (source.type === 'notification' ? '通知：' : '一对一留言：') + source.error).join('；'),
    notificationCategories: notificationCategories.map(item => {
      const total = item.id === 'comments' ? combinedCount(data.categoryUnread.comments, data.chatUnreadCount) : count(data.categoryUnread[item.id]);
      return { ...item, unreadCount: total, badge: total > 99 ? '99+' : total > 0 ? String(total) : '' };
    }) };
}
function safe(page, values) { s.safe(page, { ...values, ...inboxView({ ...page.data, ...values }) }); }
function decorate(item) {
  const actor = item.actor && typeof item.actor === 'object' ? item.actor : null;
  const nickname = actor && typeof actor.nickname === 'string' ? actor.nickname.trim() : '';
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  const summary = text === title ? '' : text;
  const hasActor = nickname && (summary.startsWith(nickname + '：') || summary.startsWith(nickname + ':'));
  return { ...s.message(item), actorName: nickname, displayTitle: title || '通知',
    summaryText: nickname && !hasActor ? [nickname, summary].filter(Boolean).join(' · ') : summary,
    timeText: Number.isFinite(item.createdAt) && item.createdAt > 0 ? s.relative(item.createdAt) : ''
  };
}

function chatView(item) {
  return { ...item, initial: Array.from(item.name || '留')[0], timeText: item.lastAt ? s.relative(item.lastAt) : '', badge: item.unreadCount > 99 ? '99+' : String(item.unreadCount || '') };
}
function directChats(items) { return (items || []).filter(item => item && item.kind === 'direct'); }
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
    chatUnreadCount: null, socialError: '', conversationMoreBusy: false, moreBusy: false, notificationLoading: false, notificationError: '',
    notificationFrontier: null, conversationFrontier: null, inboxMoreBusy: false };
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
    ...counts({}), busy: false, mode: '', category: 'all', categoryTitle: '全部通知', notificationLoading: false, notificationError: '',
    searchOpen: false, searchFocused: false, searchText: '', query: '',
    statusBarHeight: 0, navigationHeight: 44, conversations: [], conversationCursor: null, conversationMoreBusy: false,
    chatUnreadCount: null, socialError: '', notificationFrontier: null, conversationFrontier: null,
    inboxItems: [], inboxUnreadCount: null, hasMoreInbox: false, inboxMoreBusy: false, inboxError: '',
    notificationCategories: notificationCategories.map(item => ({ ...item, unreadCount: null, badge: '' }))
  },
  onLoad() { this._hidden = false; safe(this, navigationSize()); return this.refresh(); },
  onShow() { const wasHidden = this._hidden; this._hidden = false; if (this._loaded || wasHidden) return this.refresh({ retain: true }); },
  onHide() { this._hidden = true; this.cancelPendingReads(); safe(this, { searchFocused: false }); },
  onPullDownRefresh() { return this.refresh(); },
  refresh(options = {}) {
    if (this._closed || this._hidden) return;
    const { category, query } = this.data;
    const retain = options.retain === true && this._loaded && !this.data.error && !!this._owner;
    const owner = this._owner;
    const previous = { items: this.data.items, nextCursor: this.data.nextCursor, conversations: directChats(this.data.conversations),
      conversationCursor: this.data.conversationCursor, notificationFrontier: this.data.notificationFrontier, conversationFrontier: this.data.conversationFrontier };
    const messagePages = (this._messagePages || [null]).slice(), conversationPages = (this._conversationPages || [null]).slice();
    this._conversationMoreId = (this._conversationMoreId || 0) + 1;
    this._inboxMoreId = (this._inboxMoreId || 0) + 1;
    safe(this, { ...(retain ? {} : counts({})), conversationMoreBusy: false, inboxMoreBusy: false, notificationLoading: false, notificationError: '' });
    const loading = s.load(this, async () => {
      const id = this._loadId;
      this._refreshing = id;
      const current = () => !this._closed && !this._hidden && id === this._loadId;
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
          safe(this, { ...emptyInbox(), mode: boot ? boot.mode : '', loading: true });
        }
        const [notices, social] = await Promise.all([
          readPages('listMessages', { category, query }, sameOwner ? previous.items : [], messagePages.length, current)
            .then(result => ({ items: sameOwner ? retainRows(previous.items, result.pages.flatMap(page => page.items || []), decorate, result.complete) : (result.pages[0].items || []).map(decorate),
              nextCursor: sameOwner && previous.items.length ? previous.nextCursor : result.pages[0].nextCursor || null,
              notificationFrontier: sameOwner && previous.items.length ? previous.notificationFrontier : frontier(result.pages[0], 'notification'),
              ...counts(result.pages[0]), notificationError: '' }))
            .catch(error => {
              if (accountUnavailable(error)) throw error;
              return { ...(sameOwner ? {} : { items: [], nextCursor: null, notificationFrontier: null, ...counts({}) }), notificationError: error.message || '通知暂时未能加载，请重试' };
            }),
          readPages('listConversations', { query }, sameOwner ? previous.conversations : [], conversationPages.length, current)
            .then(result => ({ conversations: sameOwner ? retainRows(previous.conversations, directChats(result.pages.flatMap(page => page.items || [])), chatView, result.complete) : directChats(result.pages[0].items).map(chatView),
              conversationCursor: sameOwner && previous.conversations.length ? previous.conversationCursor : result.pages[0].nextCursor || null,
              conversationFrontier: sameOwner && previous.conversations.length ? previous.conversationFrontier : frontier(result.pages[0], 'conversation'),
              chatUnreadCount: count(result.pages[0].unreadCount), socialError: '' }))
            .catch(error => {
              if (accountUnavailable(error)) throw error;
              return { ...(sameOwner ? {} : { conversations: [], conversationCursor: null, conversationFrontier: null, chatUnreadCount: null }), socialError: error.message || '留言暂时未能加载，请重试' };
            })
        ]);
        if (!current()) return;
        this._owner = nextOwner;
        this._messagePages = sameOwner ? messagePages : [null];
        this._conversationPages = sameOwner ? conversationPages : [null];
        const values = { mode: boot ? boot.mode : this.data.mode, ...notices, ...social };
        return { ...values, ...inboxView({ ...this.data, ...values }) };
      } catch (error) {
        if (current() && accountUnavailable(error)) {
          this._owner = '';
          safe(this, { ...emptyInbox(), loading: false, error: error.message || '账号暂不可用，请重新进入', errorCode: error.code });
        } else if (current() && retain && !sameOwner) {
          safe(this, { loading: false, error: error.message || '暂时没有连接上，请重试', errorCode: error.code || '' });
        }
        throw error;
      } finally { if (this._refreshing === id) this._refreshing = 0; }
    }, { retain });
    const loadId = this._loadId;
    return loading.then(() => {
      if (!this._closed && !this._hidden && loadId === this._loadId && canPrimeInbox(this.data)) return this.loadMoreInbox();
    });
  },
  openInboxItem(event) {
    const { type, id } = event.currentTarget.dataset;
    if (!this.data.inboxItems.some(item => item.entryType === type && item.id === id)) return;
    if (type === 'notification') return this.openMessage(event);
    if (type === 'conversation') return this.openConversation(event);
  },
  retryInbox() { return this.refresh({ retain: true }); },
  async loadMoreInbox() {
    if (this._closed || this._hidden || this.data.loading || this.data.notificationLoading || this._refreshing || this.data.inboxMoreBusy || this.data.moreBusy || this.data.conversationMoreBusy) return;
    const id = this._inboxMoreId = (this._inboxMoreId || 0) + 1;
    const current = () => !this._closed && !this._hidden && id === this._inboxMoreId;
    const visible = new Set(this.data.inboxItems.map(item => item.rowKey));
    safe(this, { inboxMoreBusy: true });
    try {
      while (current()) {
        const sources = inboxSources(this.data).filter(source => source.cursor && !source.error);
        if (!sources.length) break;
        const unknown = sources.filter(source => !source.frontier);
        const selected = unknown.length ? unknown : [sources.sort((a, b) => timelineCompare(a.frontier, b.frontier))[0]];
        const before = selected.map(source => source.cursor).join('|');
        await Promise.all(selected.map(source => source.type === 'notification' ? this.loadMore() : this.loadMoreConversations()));
        if (!current() || this.data.inboxItems.some(item => !visible.has(item.rowKey))) break;
        const after = selected.map(source => source.type === 'notification' ? this.data.nextCursor : this.data.conversationCursor).join('|');
        if (before === after) break;
      }
    } finally { if (current()) safe(this, { inboxMoreBusy: false }); }
  },
  selectCategory(event) {
    if (this._closed || this._hidden) return;
    const id = event.currentTarget.dataset.id;
    const selected = notificationCategories.find(item => item.id === id);
    if (!selected) return;
    const category = this.data.category === id ? 'all' : id;
    safe(this, { category, categoryTitle: category === 'all' ? '全部通知' : selected.label });
    return this.retryNotifications();
  },
  clearCategory() {
    if (this._closed || this._hidden || this.data.category === 'all') return;
    safe(this, { category: 'all', categoryTitle: '全部通知' });
    return this.retryNotifications();
  },
  async retryNotifications() {
    if (this._closed || this._hidden) return;
    if (!this._loaded || !this._owner || this.data.loading || this.data.error) return this.refresh();
    const id = this._loadId = (this._loadId || 0) + 1;
    this._inboxMoreId = (this._inboxMoreId || 0) + 1;
    this._moreRequestId = (this._moreRequestId || 0) + 1;
    this._refreshing = 0;
    this._messagePages = [null];
    const { category, query } = this.data;
    const owner = this._owner;
    const current = () => !this._closed && !this._hidden && id === this._loadId;
    safe(this, { items: [], nextCursor: null, notificationFrontier: null, moreBusy: false, inboxMoreBusy: false, notificationLoading: true, notificationError: '' });
    try {
      const boot = await s.api.call('bootstrap');
      if (!current()) return;
      if (ownerOf(boot) !== owner) {
        this._owner = '';
        safe(this, { ...emptyInbox(), mode: boot ? boot.mode : '' });
        return this.refresh();
      }
      const result = await s.api.call('listMessages', { category, query });
      if (!current()) return;
      safe(this, { items: (result.items || []).map(decorate), nextCursor: result.nextCursor || null, notificationFrontier: frontier(result, 'notification'), ...counts(result) });
    } catch (error) {
      if (!current()) return;
      if (accountUnavailable(error)) {
        this._owner = '';
        this._conversationMoreId = (this._conversationMoreId || 0) + 1;
        safe(this, { ...emptyInbox(), error: error.message || '账号暂不可用，请重新进入', errorCode: error.code });
      } else safe(this, { notificationError: error.message || '通知暂时未能加载，请重试' });
    } finally {
      if (current()) safe(this, { notificationLoading: false });
      if (!this._closed && wx.stopPullDownRefresh) wx.stopPullDownRefresh();
    }
    if (current() && canPrimeInbox(this.data)) return this.loadMoreInbox();
  },
  loadMore() {
    if (this._closed || this._hidden || this._refreshing || this.data.notificationLoading || this.data.notificationError) return;
    const { category, query } = this.data;
    const cursor = this.data.nextCursor;
    const loadId = this._loadId;
    return s.more(this, { key: 'items', request: async cursor => {
      try {
        const result = await s.api.call('listMessages', { category, query, cursor });
        if (result.nextCursor && (result.nextCursor === cursor || (this._messagePages || []).includes(result.nextCursor))) throw new Error('通知分页暂时不可用，请刷新后重试');
        return result;
      } catch (error) {
        if (!this._closed && !this._hidden && loadId === this._loadId) {
          if (accountUnavailable(error)) {
            this._owner = ''; this.cancelPendingReads();
            safe(this, { ...emptyInbox(), error: error.message || '账号暂不可用，请重新进入', errorCode: error.code });
          } else safe(this, { notificationError: error.message || '通知暂时未能加载，请重试' });
        }
        throw error;
      }
    },
      decorate, extra: result => {
        this._messagePages = Array.from(new Set([...(this._messagePages || [null]), cursor]));
        const items = new Map(this.data.items.map(item => [item.id, item]));
        (result.items || []).forEach(item => items.set(item.id, decorate(item)));
        const values = { ...counts(result), notificationFrontier: frontier(result, 'notification'), notificationError: '' };
        return { ...values, ...inboxView({ ...this.data, ...values, items: Array.from(items.values()), nextCursor: result.nextCursor || null }) };
      } });
  },
  async loadMoreConversations() {
    if (this._closed || this._hidden || this._refreshing || this.data.loading || this.data.conversationMoreBusy || !this.data.conversationCursor) return;
    const id = this._conversationMoreId = (this._conversationMoreId || 0) + 1;
    const cursor = this.data.conversationCursor;
    safe(this, { conversationMoreBusy: true });
    try {
      const result = await s.api.call('listConversations', { query: this.data.query, cursor });
      if (this._closed || this._hidden || id !== this._conversationMoreId) return;
      if (result.nextCursor && (result.nextCursor === cursor || (this._conversationPages || []).includes(result.nextCursor))) throw new Error('留言分页暂时不可用，请刷新后重试');
      const merged = new Map(directChats(this.data.conversations).map(item => [item.id, item]));
      directChats(result.items).forEach(item => merged.set(item.id, chatView(item)));
      this._conversationPages = Array.from(new Set([...(this._conversationPages || [null]), cursor]));
      safe(this, { conversations: Array.from(merged.values()), conversationCursor: result.nextCursor || null, conversationFrontier: frontier(result, 'conversation'), chatUnreadCount: count(result.unreadCount), socialError: '' });
    } catch (error) {
      if (!this._closed && !this._hidden && id === this._conversationMoreId) {
        if (accountUnavailable(error)) {
          this._owner = ''; this.cancelPendingReads();
          safe(this, { ...emptyInbox(), error: error.message || '账号暂不可用，请重新进入', errorCode: error.code });
        } else safe(this, { socialError: error.message || '留言暂时未能加载，请重试' });
      }
    }
    finally { if (id === this._conversationMoreId) safe(this, { conversationMoreBusy: false }); }
  },
  openConversation(event) {
    if (this._closed || this._hidden || this.data.busy) return;
    const item = this.data.conversations.find(value => value.id === event.currentTarget.dataset.id);
    if (item && item.kind === 'direct') this.navigate('/social/pages/chat/index?id=' + encodeURIComponent(item.id));
  },
  discoverContent() {
    if (this._closed || this._hidden || this.data.busy) return;
    wx.switchTab({ url: '/pages/community/index', fail: () => { if (!this._closed && !this._hidden) s.toast('暂时无法打开，请稍后重试'); } });
  },
  navigate(url) {
    if (this._closed || this._hidden) return;
    wx.navigateTo({ url, fail: () => { if (!this._closed && !this._hidden) s.toast('暂时无法打开，请稍后重试'); } });
  },
  openSearch() {
    if (this._closed || this._hidden || this.data.busy) return;
    safe(this, { searchOpen: true, searchFocused: true, searchText: this.data.query });
  },
  focusSearch() { safe(this, { searchFocused: true }); },
  blurSearch() { safe(this, { searchFocused: false }); },
  inputSearch(event) { safe(this, { searchText: event.detail.value || '' }); },
  search() {
    if (this._closed || this._hidden || this.data.busy) return;
    const query = Array.from(this.data.searchText.trim()).slice(0, 60).join('');
    safe(this, { searchText: query, query, searchFocused: false });
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    return this.refresh();
  },
  clearSearch() {
    if (this._closed || this._hidden || this.data.busy) return;
    const hadQuery = !!this.data.query;
    safe(this, { searchText: '', query: '', searchFocused: this.data.searchOpen });
    if (hadQuery) return this.refresh();
  },
  cancelSearch() {
    if (this._closed || this._hidden || this.data.busy) return;
    const hadQuery = !!this.data.query;
    safe(this, { searchOpen: false, searchFocused: false, searchText: '', query: '' });
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    if (hadQuery) return this.refresh();
  },
  readAll() {
    if (this._closed || this._hidden || this.data.loading || this.data.notificationLoading || this.data.unreadCount === null || this.data.unreadCount === 0) return;
    return s.action(this, async () => {
      const id = this._loadId;
      const result = await s.api.call('readMessage', { all: true });
      if (this._closed || this._hidden || id !== this._loadId) return;
      this.cancelPendingReads({ notificationsOnly: true });
      safe(this, { items: this.data.items.map(item => ({ ...item, isRead: true })), ...readCounts(result || {}, this.data) });
    });
  },
  openMessage(event) {
    if (this._closed || this._hidden) return;
    const item = this.data.items.find(value => value.id === event.currentTarget.dataset.id);
    if (!item) return;
    return s.action(this, async () => {
      const loadId = this._loadId;
      const result = await s.api.call('readMessage', { id: item.id });
      if (this._closed || this._hidden || loadId !== this._loadId) return;
      this.cancelPendingReads({ notificationsOnly: true });
      const navigationId = this._loadId;
      safe(this, { items: this.data.items.map(value => value.id === item.id ? { ...value, isRead: true } : value), ...readCounts(result || {}, this.data) });
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
      if (this._closed || this._hidden || navigationId !== this._loadId) return;
      this.navigate(url);
    });
  },
  cancelPendingReads(options = {}) {
    this._loadId = (this._loadId || 0) + 1;
    this._moreRequestId = (this._moreRequestId || 0) + 1;
    this._inboxMoreId = (this._inboxMoreId || 0) + 1;
    if (!options.notificationsOnly) this._conversationMoreId = (this._conversationMoreId || 0) + 1;
    this._refreshing = 0;
    safe(this, { moreBusy: false, inboxMoreBusy: false, notificationLoading: false, ...(options.notificationsOnly ? {} : { conversationMoreBusy: false }) });
  }
});
