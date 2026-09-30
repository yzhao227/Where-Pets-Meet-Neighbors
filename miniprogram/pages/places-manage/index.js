const s = require('../_shared');
const places = require('../../services/places');
const policyChoices = [{ id: 'unknown', name: '待核实' }, { id: 'allowed', name: '允许携宠' }, { id: 'conditional', name: '有条件携宠' }, { id: 'not_allowed', name: '不可携宠' }];
function emptyForm() { return { id: '', title: '', address: '', city: '上海', area: '', description: '', officialUrl: '', petPolicyText: '', policyIndex: 0, latitude: '', longitude: '', pointConfirmed: false, active: true }; }
function formFor(place) { return { id: place.id, title: place.title || '', address: place.address || '', city: place.city || '上海', area: place.area || '', description: place.description || place.summary || '', officialUrl: place.officialUrl || (place.sources || []).find(source => source.url)?.url || '', petPolicyText: place.petPolicy && place.petPolicy.text || '', policyIndex: Math.max(0, policyChoices.findIndex(item => item.id === (place.petPolicy && place.petPolicy.status))), latitude: place.point ? String(place.point.latitude) : '', longitude: place.point ? String(place.point.longitude) : '', pointConfirmed: !!place.point, active: place.active !== false }; }
s.register({
  data: { loading: true, error: '', isAdmin: false, items: [], corrections: [], correctionCursor: null, correctionsBusy: false, correctionsError: '', form: null, policyChoices, query: '', busy: false, resolution: '', selectedCorrection: '', published: '' },
  onLoad(options) { this.requestedId = options.id; return this.refresh(); },
  refresh() {
    this._correctionRequest = (this._correctionRequest || 0) + 1;
    s.safe(this, { correctionsBusy: false, correctionsError: '' });
    return s.load(this, async () => {
      const boot = await s.api.call('bootstrap');
      if (!boot.user.isAdmin) return { isAdmin: false, items: [], corrections: [], correctionCursor: null, form: null };
      const [items, reports] = await Promise.all([places.listAll({ includeInactive: true, query: this.data.query }), s.api.call('listPlaceCorrections', { status: 'pending', limit: 50 })]);
      let form = this.data.form;
      if (this.requestedId) { const item = items.find(item => item.id === this.requestedId); if (item) form = formFor(item); this.requestedId = ''; }
      return { isAdmin: true, items, corrections: reports.items, correctionCursor: reports.nextCursor || null, form };
    });
  },
  async loadMoreCorrections() {
    if (!this.data.isAdmin || this.data.loading || this.data.correctionsBusy || !this.data.correctionCursor) return;
    const cursor = this.data.correctionCursor;
    const request = this._correctionRequest = (this._correctionRequest || 0) + 1;
    s.safe(this, { correctionsBusy: true, correctionsError: '' });
    try {
      const result = await s.api.call('listPlaceCorrections', { status: 'pending', limit: 50, cursor });
      if (this._closed || request !== this._correctionRequest) return;
      const records = new Map(this.data.corrections.map(item => [item.id, item]));
      result.items.forEach(item => records.set(item.id, item));
      s.safe(this, { corrections: Array.from(records.values()), correctionCursor: result.nextCursor && result.nextCursor !== cursor ? result.nextCursor : null });
    } catch (error) {
      if (request === this._correctionRequest) s.safe(this, { correctionsError: error.message || '纠错记录暂未读到，请重试' });
    } finally {
      if (request === this._correctionRequest) s.safe(this, { correctionsBusy: false });
    }
  },
  create() { if (this.data.isAdmin) s.safe(this, { form: emptyForm() }); },
  edit(e) { const item = this.data.items.find(item => item.id === e.currentTarget.dataset.id); if (item && this.data.isAdmin) s.safe(this, { form: formFor(item) }); },
  closeForm() { s.safe(this, { form: null }); },
  input(e) { const field = e.currentTarget.dataset.field; if (!this.data.form || !['title', 'address', 'city', 'area', 'description', 'officialUrl', 'petPolicyText', 'latitude', 'longitude'].includes(field)) return; s.safe(this, { form: { ...this.data.form, [field]: e.detail.value, ...(['latitude', 'longitude'].includes(field) ? { pointConfirmed: false } : {}) } }); },
  policy(e) { s.safe(this, { form: { ...this.data.form, policyIndex: Number(e.detail.value) } }); },
  confirmPoint(e) { s.safe(this, { form: { ...this.data.form, pointConfirmed: e.detail.value } }); },
  active(e) { s.safe(this, { form: { ...this.data.form, active: e.detail.value } }); },
  save() { return s.action(this, async () => { if (!this.data.isAdmin || !this.data.form) return; const form = this.data.form; const point = form.latitude || form.longitude ? { latitude: Number(form.latitude), longitude: Number(form.longitude), coordinateSystem: 'gcj02' } : null; await s.api.call('savePlace', { id: form.id || undefined, title: form.title, address: form.address, city: form.city, area: form.area, description: form.description, officialUrl: form.officialUrl, petPolicyText: form.petPolicyText, petPolicyStatus: policyChoices[form.policyIndex].id, point, pointConfirmed: form.pointConfirmed, active: form.active }); s.safe(this, { form: null }); await this.refresh(); s.toast('地点资料已保存'); }); },
  query(e) { s.safe(this, { query: e.detail.value }); },
  publishCatalogue() { return s.action(this, async () => { let cursor; let added = 0; do { const result = await s.api.call('publishPlaceCatalogue', { cursor }); added += result.added; cursor = result.nextCursor; } while (cursor && !this._closed); if (!this._closed) { s.safe(this, { published: '已补入 ' + added + ' 条目录记录，原有运营修改保留。' }); await this.refresh(); } }); },
  selectCorrection(e) { s.safe(this, { selectedCorrection: e.currentTarget.dataset.id, resolution: '' }); },
  resolution(e) { s.safe(this, { resolution: e.detail.value }); },
  resolve(e) { return s.action(this, async () => { await s.api.call('resolvePlaceCorrection', { id: this.data.selectedCorrection, status: e.currentTarget.dataset.status, note: this.data.resolution }); s.safe(this, { selectedCorrection: '', resolution: '' }); await this.refresh(); }); },
  open(e) { s.go('/pages/local-detail/index?id=' + e.currentTarget.dataset.id); }
});
