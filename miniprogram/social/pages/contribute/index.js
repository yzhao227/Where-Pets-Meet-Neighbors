const s = require('../../../pages/_shared');
const social = require('../../shared');
const formTools = require('../../submission-form');

s.register({
  data: { tab: 'form', mode: '', loading: true, error: '', busy: false, items: [], nextCursor: null, moreBusy: false,
    statuses: formTools.statuses, statusIndex: 0, form: formTools.empty(), policyChoices: formTools.policyChoices,
    formError: '', attemptLocked: false, notice: '', expandedId: '' },
  onLoad(options) { if (options.tab === 'mine') s.safe(this, { tab: 'mine' }); return this.refresh(); },
  onShow() { if (this._loaded && this.data.tab === 'mine') return this.refresh(); },
  onPullDownRefresh() { return this.refresh(); },
  refresh() {
    const status = formTools.statuses[this.data.statusIndex].id;
    return s.load(this, async () => {
      const [result, boot] = await Promise.all([s.api.call('listNearbySubmissions', { mine: true, status }), s.api.call('bootstrap').catch(() => null)]);
      return { items: (result.items || []).map(formTools.decorate), nextCursor: result.nextCursor || null, mode: boot ? boot.mode : this.data.mode };
    });
  },
  loadMore() {
    const status = formTools.statuses[this.data.statusIndex].id;
    return s.more(this, { key: 'items', request: cursor => s.api.call('listNearbySubmissions', { mine: true, status, cursor }), decorate: formTools.decorate });
  },
  selectTab(e) {
    if (this.data.busy) return;
    const tab = e.currentTarget.dataset.id;
    if (!['form', 'mine'].includes(tab) || tab === this.data.tab) return;
    s.safe(this, { tab });
    if (tab === 'mine') return this.refresh();
  },
  changeStatus(e) {
    const index = Number(e.detail.value);
    if (!formTools.statuses[index] || this.data.busy) return;
    s.safe(this, { statusIndex: index, expandedId: '' });
    return this.refresh();
  },
  input(e) {
    const field = e.currentTarget.dataset.field;
    if (this.data.busy || this.data.attemptLocked || !formTools.textFields.includes(field)) return;
    this._dirty = true;
    s.safe(this, { form: { ...this.data.form, [field]: e.detail.value || '' }, formError: '' });
  },
  selectType(e) {
    const type = e.currentTarget.dataset.id;
    if (this.data.busy || this.data.attemptLocked || !['place', 'event'].includes(type)) return;
    this._dirty = true;
    s.safe(this, { form: { ...this.data.form, type, ...(type === 'place' ? { startDate: '', endDate: '' } : {}) }, formError: '' });
  },
  selectPolicy(e) {
    const index = Number(e.detail.value);
    if (this.data.busy || this.data.attemptLocked || !formTools.policyChoices[index]) return;
    this._dirty = true;
    s.safe(this, { form: { ...this.data.form, policyIndex: index, petPolicyStatus: formTools.policyChoices[index].id }, formError: '' });
  },
  async submit() {
    if (this.data.busy) return;
    if (!this._attempt) {
      const fields = formTools.fields(this.data.form);
      const error = formTools.validate(fields);
      if (error) { s.safe(this, { formError: error }); return; }
      this._requestId = this._requestId || social.requestId('submission');
      this._attempt = { ...fields, requestId: this._requestId };
    }
    s.safe(this, { busy: true, attemptLocked: true, formError: '', notice: '' });
    try {
      const result = await s.api.call('submitNearbySubmission', this._attempt);
      if (!result || !result.submission || !result.submission.id) throw new Error('尚未确认投稿结果，请重试');
      if (this._closed) return;
      this._attempt = null; this._requestId = null; this._dirty = false;
      s.safe(this, { form: formTools.empty(), tab: 'mine', statusIndex: 0, expandedId: result.submission.id, attemptLocked: false,
        notice: this.data.mode === 'demo' ? '投稿已保存在本机，等待本机运营审核。' : '投稿已提交，等待运营核实。' });
      await this.refresh();
    } catch (error) {
      if (this._closed) return;
      const editable = formTools.editableFailures.includes(error.code);
      if (editable) this._attempt = null;
      s.safe(this, { attemptLocked: !editable, formError: error.message || '投稿暂未完成，填写的内容已保留，请重试。' });
      if (error.code === 'VERIFICATION_REQUIRED') s.openVerification();
    } finally { s.safe(this, { busy: false }); }
  },
  toggleDetails(e) { const id = e.currentTarget.dataset.id; s.safe(this, { expandedId: this.data.expandedId === id ? '' : id }); },
  withdraw(e) {
    const item = this.data.items.find(row => row.id === e.currentTarget.dataset.id);
    if (!item || item.status !== 'pending') return;
    return s.action(this, async () => {
      if (!await s.confirm('撤回这条投稿？', '撤回后不会进入审核发布。你可以修改内容后重新投稿。', '撤回投稿') || this._closed) return;
      const result = await s.api.call('withdrawNearbySubmission', { id: item.id });
      if (!result || !result.submission || result.submission.status !== 'withdrawn') throw new Error('尚未确认撤回结果，请刷新后重试');
      if (!this._closed) { s.safe(this, { notice: '投稿已撤回，可修改后重新投稿。' }); await this.refresh(); }
    });
  },
  async copyDraft(e) {
    if (this.data.busy) return;
    const item = this.data.items.find(row => row.id === e.currentTarget.dataset.id);
    if (!item || !['rejected', 'withdrawn'].includes(item.status)) return;
    if (this.data.attemptLocked) return s.toast('请先重试当前投稿，确认提交结果');
    if (this._dirty && !await s.confirm('替换正在填写的草稿？', '将用这条投稿的内容替换当前表单，原记录会保留。', '替换草稿')) return;
    if (this._closed) return;
    this._attempt = null; this._requestId = null; this._dirty = true;
    s.safe(this, { form: formTools.formFor(item), tab: 'form', formError: '', notice: '内容已放入新草稿，修改后提交会重新审核。' });
  },
  openPublished(e) {
    const item = this.data.items.find(row => row.id === e.currentTarget.dataset.id);
    if (item && item.status === 'approved' && item.publishedId) s.go('/pages/local-detail/index?id=' + encodeURIComponent(item.publishedId));
  },
  copySource(e) {
    const item = this.data.items.find(row => row.id === e.currentTarget.dataset.id);
    if (item && s.httpsUrl(item.sourceUrl)) wx.setClipboardData({ data: item.sourceUrl });
  }
});
