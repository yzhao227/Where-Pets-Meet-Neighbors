const s = require('../_shared');

s.register({
  data: { loading: true, error: '', circles: [] },
  onLoad() { return this.refresh(); },
  onShow() { if (this._loaded) return this.refresh(); },
  onPullDownRefresh() { return this.refresh(); },
  refresh() {
    return s.load(this, async () => {
      const result = await s.api.call('listCircles');
      return { circles: result.items };
    });
  },
  openCircle(e) {
    const id = e.currentTarget.dataset.id;
    if (id) s.go('/pages/circle/index?id=' + encodeURIComponent(id));
  }
});
