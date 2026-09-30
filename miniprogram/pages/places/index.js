const s = require('../_shared');
const location = require('../../services/nearby-location');
const tabs = [{ id: 'saved', name: '地点收藏' }, { id: 'visits', name: '到访记录' }];
function request(type, cursor) { return s.api.call(type === 'visits' ? 'listPlaceVisits' : 'listPlaces', { ...(type === 'visits' ? {} : { bookmarked: true, type: 'all' }), cursor }); }
function decorate(type, item) { const place = type === 'saved' ? item : item.place; const distance = place && place.active !== false && location.distanceFor(place.point); return { ...item, distanceText: distance ? '距' + distance.referenceLabel + '直线 ' + distance.label : '' }; }
s.register({
  data: { loading: true, error: '', type: 'saved', tabs, items: [], nextCursor: null, moreBusy: false, busy: false },
  onLoad(options = {}) { this.data.type = options.type === 'visits' ? 'visits' : 'saved'; return this.refresh(); },
  onShow() { if (this._loaded) return this.refresh(); }, onPullDownRefresh() { return this.refresh(); },
  refresh() { const type = this.data.type; return s.load(this, async () => { const result = await request(type); return { items: result.items.map(item => decorate(type, item)), nextCursor: result.nextCursor || null }; }); },
  selectTab(e) { const type = e.currentTarget.dataset.id; if (tabs.some(item => item.id === type)) { s.safe(this, { type }); return this.refresh(); } },
  open(e) { s.go('/pages/local-detail/index?id=' + encodeURIComponent(e.currentTarget.dataset.id)); },
  remove(e) { const type = this.data.type; return s.action(this, async () => { const id = e.currentTarget.dataset.id; if (type === 'visits') { if (!await s.confirm('删除这条记录？', '到访记录和私人备注会删除。已经发布的分享仍保留公开地点。', '删除')) return; await s.api.call('deletePlaceVisit', { id }); } else await s.api.call('bookmarkPlace', { id, bookmark: false }); await this.refresh(); }); },
  shareVisit(e) { const visit = this.data.items.find(item => item.id === e.currentTarget.dataset.id); if (visit && visit.postId) return s.go('/pages/post/index?id=' + encodeURIComponent(visit.postId)); if (!visit || !visit.place || visit.place.active === false) return s.toast('关联地点已下架，请先重新选择'); s.go('/pages/compose/index?placeId=' + encodeURIComponent(visit.placeId) + '&visitId=' + encodeURIComponent(visit.id)); },
  explore() { wx.switchTab({ url: '/pages/nearby/index' }); },
  onReachBottom() { return this.loadMore(); },
  loadMore() { const type = this.data.type; return s.more(this, { key: 'items', request: cursor => request(type, cursor), decorate: item => decorate(type, item) }); }
});
