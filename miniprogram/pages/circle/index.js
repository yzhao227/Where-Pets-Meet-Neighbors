const s = require('../_shared');
const preferences = require('../../data/feed-preferences');
s.register({
  data: { loading: true, error: '', mode: '', circle: null, posts: [], excludedAnimalTypes: [], preferenceError: '', nextCursor: null, moreBusy: false, busy: false },
  onLoad(options) { this.id = options.id; this.refresh(); }, onShow() { if (this._loaded) this.refresh(); }, onPullDownRefresh() { this.refresh(); },
  refresh() { const saved = preferences.read(wx); s.safe(this, { excludedAnimalTypes: saved.excludedAnimalTypes, preferenceError: saved.error }); return s.load(this, async () => { if (!this.id) throw new Error('找不到这个圈子'); const [boot, result] = await Promise.all([s.api.call('bootstrap'), s.api.call('getCircle', { id: this.id, excludedAnimalTypes: saved.excludedAnimalTypes })]); if (!this._closed) wx.setNavigationBarTitle({ title: result.circle.name }); return { mode: boot.mode, circle: result.circle, posts: result.posts.map(s.post), nextCursor: result.nextCursor || null }; }); },
  openAuthor(e) { s.go('/pages/author/index?userId=' + e.currentTarget.dataset.id); },
  loadMore() { return s.more(this, { key: 'posts', request: cursor => s.api.call('getCircle', { id: this.id, cursor, excludedAnimalTypes: this.data.excludedAnimalTypes }), select: result => result.posts, decorate: s.post }); },
  join() { return s.action(this, async () => { const join = !this.data.circle.isJoined; if (!join && !await s.confirm('退出这个小圈子？', '退出后仍可浏览日常，再次加入后可以继续分享。', '退出圈子')) return; const result = await s.api.call('joinCircle', { id: this.id, join }); s.safe(this, { circle: result.circle }); if (!this._closed) s.toast(join ? '已加入，欢迎来到小圈子' : '已退出圈子'); }); },
  compose() { if (!this.data.circle.isJoined) return s.toast('先加入圈子，就可以分享日常'); s.go('/pages/compose/index?circleId=' + this.id); },
  openPost(e) { s.go('/pages/post/index?id=' + e.currentTarget.dataset.id); },
  onShareAppMessage() { return { title: '一起加入「' + (this.data.circle ? this.data.circle.name : '爱宠小圈子') + '」', path: '/pages/circle/index?id=' + this.id }; }
});
