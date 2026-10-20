const s = require('../_shared');
const types = s.personalMode ? ['posts', 'bookmarks'] : ['posts', 'bookmarks', 'following', 'circles', 'events'];
function request(type, cursor) { if (s.personalMode && !types.includes(type)) type = 'posts'; if (type === 'following') return s.api.call('listFollowing', { cursor }); if (type === 'events') return s.api.call('listEvents', { mine: true, cursor }); return s.api.call('listPosts', type === 'bookmarks' ? { bookmarked: true, cursor } : { mine: true, cursor }); }
function decorate(type) { return type === 'following' ? s.person : type === 'events' ? s.event : s.post; }
s.register({
  data: { loading: true, error: '', mode: '', type: 'posts', items: [], nextCursor: null, moreBusy: false, busy: false, tabs: s.personalMode ? [{ id: 'posts', name: '我的记录' }, { id: 'bookmarks', name: '我的收藏' }] : [{ id: 'posts', name: '我的分享' }, { id: 'bookmarks', name: '我的收藏' }, { id: 'following', name: '我的关注' }, { id: 'circles', name: '我的圈子' }, { id: 'events', name: '活动报名' }] },
  onLoad(options) { s.safe(this, { type: options && types.includes(options.type) ? options.type : 'posts' }); this.refresh(); }, onShow() { if (this._loaded) this.refresh(); }, onPullDownRefresh() { this.refresh(); },
  refresh() { const type = types.includes(this.data.type) ? this.data.type : 'posts'; s.safe(this, { type }); return s.load(this, async () => { const boot = await s.api.call('bootstrap'); if (type === 'circles') return { mode: boot.mode, items: boot.circles.filter(circle => circle.isJoined), nextCursor: null }; const result = await request(type); return { mode: boot.mode, items: result.items.map(decorate(type)), nextCursor: result.nextCursor || null }; }); },
  selectType(e) { if (this.data.busy || !types.includes(e.currentTarget.dataset.id)) return; s.safe(this, { type: e.currentTarget.dataset.id, items: [] }); this.refresh(); },
  open(e) { if (!types.includes(this.data.type)) return; const id = e.currentTarget.dataset.id; if (this.data.type === 'following') return s.go('/pages/author/index?userId=' + id); const page = this.data.type === 'circles' ? 'circle' : this.data.type === 'events' ? 'event' : 'post'; s.go('/pages/' + page + '/index?id=' + id); },
  openAuthor(e) { if (s.personalMode) return; s.go('/pages/author/index?userId=' + e.currentTarget.dataset.id); },
  unbookmark(e) { return s.action(this, async () => { await s.api.call('bookmarkPost', { id: e.currentTarget.dataset.id, bookmark: false }); await this.refresh(); if (!this._closed) s.toast('已取消收藏'); }); },
  unfollow(e) { if (s.personalMode) return; return s.action(this, async () => { const account = this.data.items.find(item => item.id === e.currentTarget.dataset.id); if (!account) return; if (!await s.confirm('取消关注「' + account.nickname + '」？', '取消后，该账号的内容将不再出现在你的关注列表中。', '取消关注')) return; await s.api.call('followUser', { userId: account.id, follow: false }); await this.refresh(); if (!this._closed) s.toast('已取消关注'); }); },
  compose() { if (s.personalMode) s.go('/pages/compose/index'); },
  explore() { if (s.personalMode && this.data.type === 'posts') return this.compose(); wx.switchTab({ url: this.data.type === 'events' ? '/pages/nearby/index' : '/pages/community/index' }); },
  loadMore() { const type = this.data.type; if (type === 'circles') return; return s.more(this, { key: 'items', request: cursor => request(type, cursor), decorate: decorate(type) }); }
});
