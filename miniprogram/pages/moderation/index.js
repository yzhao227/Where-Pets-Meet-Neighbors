const s = require('../_shared');

function decorate(item) {
  const typeLabels = { post: '内容举报', comment: '回应举报', event: '活动举报', user: '用户举报' };
  const statusLabels = { open: '待处理', resolved: '已处理', dismissed: '无需处理' };
  return Object.assign({}, item, {
    timeText: s.relative(item.createdAt),
    typeText: typeLabels[item.targetType] || '内容举报',
    statusText: statusLabels[item.status] || '待处理',
    reporter: s.person(item.reporter || { nickname: '社区成员', avatar: '/assets/avatar-1.png' }),
    canOpen: !!item.targetIdForLink && ['post', 'event'].includes(item.targetTypeForLink)
  });
}

s.register({
  data: { loading: true, error: '', mode: '', isAdmin: false, status: 'open', items: [], nextCursor: null, moreBusy: false, busy: false, selectedId: '', notes: {} },
  onLoad() { this.refresh(); },
  onShow() { if (this._loaded) this.refresh(); },
  onPullDownRefresh() { this.refresh(); },
  refresh() {
    return s.load(this, async () => {
      const boot = await s.api.call('bootstrap');
      if (!boot.user.isAdmin) return { mode: boot.mode, isAdmin: false, items: [], nextCursor: null };
      const result = await s.api.call('listReports', { status: this.data.status });
      return { mode: boot.mode, isAdmin: true, items: result.items.map(decorate), nextCursor: result.nextCursor || null };
    });
  },
  selectStatus(e) {
    if (this.data.busy) return;
    s.safe(this, { status: e.currentTarget.dataset.status, selectedId: '' });
    this.refresh();
  },
  openTarget(e) {
    const item = this.data.items.find(value => value.id === e.currentTarget.dataset.id);
    if (item && item.canOpen) s.go('/pages/' + item.targetTypeForLink + '/index?id=' + encodeURIComponent(item.targetIdForLink));
  },
  expand(e) { if (!this.data.busy) s.safe(this, { selectedId: this.data.selectedId === e.currentTarget.dataset.id ? '' : e.currentTarget.dataset.id }); },
  inputNote(e) {
    const notes = Object.assign({}, this.data.notes, { [e.currentTarget.dataset.id]: e.detail.value });
    s.safe(this, { notes });
  },
  resolve(e) {
    return s.action(this, async () => {
      if (!this.data.isAdmin) return;
      const id = e.currentTarget.dataset.id;
      const status = e.currentTarget.dataset.status;
      const item = this.data.items.find(value => value.id === id);
      if (!item || item.status !== 'open' || !['resolved', 'dismissed'].includes(status)) return;
      const note = (this.data.notes[id] || '').trim();
      const confirmed = await s.confirm(
        status === 'resolved' ? '标记为已处理？' : '标记为无需处理？',
        status === 'resolved' ? '请确认已核查内容并完成必要处置。处理结果及说明会通知举报者，提交后不能修改结论。' : '请确认核查后无需进一步处置。处理结果及说明会通知举报者，提交后不能修改结论。',
        '确认记录'
      );
      if (!confirmed || this._closed) return;
      await s.api.call('resolveReport', { id, status, note });
      s.safe(this, { selectedId: '' });
      await this.refresh();
      if (!this._closed) s.toast(this.data.mode === 'demo' ? '处理结果已保存在本机' : '处理结果已记录');
    });
  },
  loadMore() { if (!this.data.isAdmin) return; return s.more(this, { key: 'items', request: cursor => s.api.call('listReports', { status: this.data.status, cursor }), decorate }); }
});
