const s = require('../_shared');
s.register({
  data: { loading: true, error: '', items: [], nextCursor: null, moreBusy: false, busy: false },
  onLoad() { this.refresh(); }, onPullDownRefresh() { this.refresh(); },
  refresh() { return s.load(this, async () => { const result = await s.api.call('listBlocked'); return { items: result.items.map(s.person), nextCursor: result.nextCursor || null }; }); },
  loadMore() { return s.more(this, { key: 'items', request: cursor => s.api.call('listBlocked', { cursor }), decorate: s.person }); },
  unblock(e) { return s.action(this, async () => { if (!await s.confirm('取消屏蔽？', '取消后，你会重新看到对方公开的帖子和评论。', '取消屏蔽')) return; await s.api.call('blockUser', { userId: e.currentTarget.dataset.id, block: false }); await this.refresh(); if (!this._closed) s.toast('已取消屏蔽'); }); }
});
