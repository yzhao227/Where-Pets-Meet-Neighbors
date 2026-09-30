const s = require('../../../pages/_shared');
const formTools = require('../../submission-form');

s.register({
  data: { loading: true, error: '', isAdmin: false, mode: '', busy: false, items: [], nextCursor: null, moreBusy: false,
    statuses: formTools.statuses, statusIndex: 1, selected: null, form: null, policyChoices: formTools.policyChoices,
    confirmed: false, note: '', formError: '', reviewLocked: false, notice: '' },
  onLoad() { return this.refresh(); },
  onShow() { if (this._loaded && !this.data.selected) return this.refresh(); },
  onPullDownRefresh() { return this.refresh(); },
  refresh() {
    const status = formTools.statuses[this.data.statusIndex].id;
    return s.load(this, async () => {
      const boot = await s.api.call('bootstrap');
      if (!boot.user || !boot.user.isAdmin) {
        this._reviewAttempt = null;
        return { mode: boot.mode, isAdmin: false, items: [], nextCursor: null, selected: null, form: null, note: '', confirmed: false, reviewLocked: false };
      }
      const result = await s.api.call('listNearbySubmissions', { mine: false, status });
      return { mode: boot.mode, isAdmin: true, items: (result.items || []).map(formTools.decorate), nextCursor: result.nextCursor || null };
    });
  },
  loadMore() {
    if (!this.data.isAdmin) return;
    const status = formTools.statuses[this.data.statusIndex].id;
    return s.more(this, { key: 'items', request: cursor => s.api.call('listNearbySubmissions', { mine: false, status, cursor }), decorate: formTools.decorate });
  },
  changeStatus(e) {
    const index = Number(e.detail.value);
    if (!this.data.isAdmin || this.data.busy || this.data.selected || !formTools.statuses[index]) return;
    s.safe(this, { statusIndex: index });
    return this.refresh();
  },
  selectSubmission(e) {
    if (!this.data.isAdmin || this.data.busy || this.data.reviewLocked) return;
    const item = this.data.items.find(row => row.id === e.currentTarget.dataset.id);
    if (!item) return;
    this._formDirty = false; this._reviewAttempt = null;
    s.safe(this, { selected: item, form: formTools.formFor(item), note: '', confirmed: false, formError: '', reviewLocked: false, notice: '' });
  },
  async closeForm() {
    if (this.data.busy) return;
    if (this.data.reviewLocked) return s.toast('请先重试本次审核，确认处理结果');
    if (this._formDirty && !await s.confirm('放弃本次编辑？', '本次填写的审核修改尚未保存。', '放弃编辑')) return;
    if (this._closed) return;
    this._formDirty = false; this._reviewAttempt = null;
    s.safe(this, { selected: null, form: null, note: '', confirmed: false, formError: '' });
    return this.refresh();
  },
  canEdit() { return this.data.isAdmin && this.data.selected && this.data.selected.status === 'pending' && !this.data.busy && !this.data.reviewLocked; },
  input(e) {
    const field = e.currentTarget.dataset.field;
    if (!this.canEdit() || !formTools.textFields.includes(field)) return;
    this._formDirty = true;
    s.safe(this, { form: { ...this.data.form, [field]: e.detail.value || '' }, confirmed: false, formError: '' });
  },
  selectType(e) {
    const type = e.currentTarget.dataset.id;
    if (!this.canEdit() || !['place', 'event'].includes(type)) return;
    this._formDirty = true;
    s.safe(this, { form: { ...this.data.form, type, ...(type === 'place' ? { startDate: '', endDate: '' } : {}) }, confirmed: false, formError: '' });
  },
  selectPolicy(e) {
    const index = Number(e.detail.value);
    if (!this.canEdit() || !formTools.policyChoices[index]) return;
    this._formDirty = true;
    s.safe(this, { form: { ...this.data.form, policyIndex: index, petPolicyStatus: formTools.policyChoices[index].id }, confirmed: false, formError: '' });
  },
  inputNote(e) {
    if (!this.data.isAdmin || this.data.busy || this.data.reviewLocked || !this.data.selected || !['pending', 'approved'].includes(this.data.selected.status)) return;
    this._formDirty = true;
    s.safe(this, { note: e.detail.value || '', formError: '' });
  },
  confirmReviewed(e) {
    if (!this.canEdit()) return;
    s.safe(this, { confirmed: e.detail.value === true, formError: '' });
  },
  approve() { return this.review('approved'); },
  reject() { return this.review('rejected'); },
  review(decision) {
    if (!this.canEdit()) return;
    const note = this.data.note.trim();
    if (Array.from(note).length > 500 || decision === 'rejected' && !note) { s.safe(this, { formError: decision === 'rejected' && !note ? '请填写未通过的原因，方便投稿人修改' : '审核说明最多 500 个字' }); return; }
    const payload = { id: this.data.selected.id, decision, note, confirmed: decision === 'approved' && this.data.confirmed };
    if (decision === 'approved') {
      payload.fields = formTools.fields(this.data.form);
      const error = formTools.validate(payload.fields);
      if (error) { s.safe(this, { formError: error }); return; }
      if (!this.data.confirmed) { s.safe(this, { formError: '请先确认已核实公共场所、活动日期和携宠信息' }); return; }
    }
    this._reviewAttempt = { action: 'reviewNearbySubmission', payload };
    return this.sendDecision();
  },
  async unpublish() {
    if (!this.data.isAdmin || this.data.busy || this.data.reviewLocked || this._confirmingUnpublish || !this.data.selected || this.data.selected.status !== 'approved') return;
    const note = this.data.note.trim();
    if (!note || Array.from(note).length > 500) { s.safe(this, { formError: '请填写 1–500 个字的下架原因' }); return; }
    const selectedId = this.data.selected.id;
    this._confirmingUnpublish = true;
    let confirmed;
    try { confirmed = await s.confirm('下架这条推荐？', '下架后，这条活动或地点将不再在附近公开展示。', '确认下架'); }
    finally { this._confirmingUnpublish = false; }
    if (!confirmed || this._closed || !this.data.isAdmin || !this.data.selected || this.data.selected.id !== selectedId || this.data.selected.status !== 'approved') return;
    this._reviewAttempt = { action: 'unpublishNearbySubmission', payload: { id: selectedId, note } };
    return this.sendDecision();
  },
  retryDecision() { if (this.data.reviewLocked && this._reviewAttempt) return this.sendDecision(); },
  async sendDecision() {
    if (this.data.busy || !this.data.isAdmin || !this._reviewAttempt) return;
    const attempt = this._reviewAttempt;
    s.safe(this, { busy: true, reviewLocked: true, formError: '' });
    try {
      const result = await s.api.call(attempt.action, attempt.payload);
      const expectedStatus = attempt.action === 'unpublishNearbySubmission' ? 'withdrawn' : attempt.payload.decision;
      if (!result || !result.submission || result.submission.status !== expectedStatus) throw new Error('尚未确认审核结果，请重试');
      if (this._closed) return;
      this._reviewAttempt = null; this._formDirty = false;
      const resultText = expectedStatus === 'approved' ? '审核已通过，内容已发布到附近。' : expectedStatus === 'rejected' ? '已标记未通过，原因会显示在投稿人的记录里。' : '内容已下架，审核记录保留。';
      s.safe(this, { selected: null, form: null, note: '', confirmed: false, reviewLocked: false, notice: this.data.mode === 'demo' ? '本机处理完成：' + resultText : resultText });
      await this.refresh();
    } catch (error) {
      if (this._closed) return;
      const editable = formTools.editableFailures.includes(error.code);
      if (editable) this._reviewAttempt = null;
      s.safe(this, { reviewLocked: !editable, formError: error.message || '审核暂未完成，当前内容已保留，请重试。' });
      if (error.code === 'VERIFICATION_REQUIRED') s.openVerification();
    } finally { s.safe(this, { busy: false }); }
  },
  copySource() { if (this.data.form && s.httpsUrl(this.data.form.sourceUrl)) wx.setClipboardData({ data: this.data.form.sourceUrl }); },
  openPublished() { const item = this.data.selected; if (item && item.status === 'approved' && item.publishedId) s.go('/pages/local-detail/index?id=' + encodeURIComponent(item.publishedId)); }
});
