const s = require('../_shared');
const policies = [{ id: 'none', name: '无需带宠' }, { id: 'optional', name: '可带宠物' }, { id: 'dog', name: '需要带犬' }];
function datePart(time) { const d = new Date(time); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function timePart(time) { const d = new Date(time); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function timestamp(date, time) { const d = date.split('-').map(Number); const t = time.split(':').map(Number); return new Date(d[0], d[1] - 1, d[2], t[0], t[1]).getTime(); }
function draft(event, circles) {
  const tomorrow = Date.now() + 86400000;
  return { formOpen: true, editingId: event ? event.id : '', existingCount: event ? event.attendeeCount : 0, title: event ? event.title : '', description: event ? event.description : '', location: event ? event.location : '', startDate: datePart(event ? event.startAt : tomorrow), startTime: event ? timePart(event.startAt) : '10:00', endDate: datePart(event ? event.endAt : tomorrow), endTime: event ? timePart(event.endAt) : '11:30', capacity: String(event ? event.capacity : 8), policyIndex: event ? Math.max(0, policies.findIndex(p => p.id === event.petPolicy)) : 0, circleIndex: event ? Math.max(0, circles.findIndex(c => c.id === event.circleId)) : 0, cancelReason: '', editingCancelled: !!event && event.status === 'cancelled', editingStarted: !!event && event.startAt <= Date.now(), editingEnded: !!event && event.endAt <= Date.now(), editingLocked: !!event && (event.status === 'cancelled' || event.startAt <= Date.now()) };
}
s.register({
  data: { loading: true, error: '', isAdmin: false, mode: '', events: [], nextCursor: null, moreBusy: false, circles: [], formOpen: false, editingId: '', title: '', description: '', location: '', capacity: '8', startDate: '', startTime: '10:00', endDate: '', endTime: '11:30', policies, policyIndex: 0, circleIndex: 0, busy: false, cancelReason: '', setupNeeded: false, setupCity: '', setupAreas: '', setupContact: '' },
  onLoad(options) { this.requestedId = options.id; this.refresh(); },
  onShow() { if (this._loaded && !this.data.formOpen) this.refresh(); },
  refresh() { return s.load(this, async () => {
    const boot = await s.api.call('bootstrap');
    if (!boot.user.isAdmin) return { isAdmin: false, mode: boot.mode };
    const events = await s.api.call('listEvents', { filter: 'all' });
    const result = { isAdmin: true, mode: boot.mode, circles: boot.circles, events: events.items.map(s.event), nextCursor: events.nextCursor || null, setupNeeded: boot.circles.length === 0, setupCity: boot.settings.city || '', setupAreas: (boot.settings.areas || []).join('\n'), setupContact: boot.settings.contact || '' };
    if (this.requestedId) { const event = await s.api.call('getEvent', { id: this.requestedId }); Object.assign(result, draft(event.event, boot.circles)); this.requestedId = ''; }
    return result;
  }); },
  loadMore() { if (!this.data.isAdmin || this.data.formOpen) return; return s.more(this, { key: 'events', request: cursor => s.api.call('listEvents', { filter: 'all', cursor }), decorate: s.event }); },
  input(e) { const key = e.currentTarget.dataset.field; if (['title', 'description', 'location', 'capacity', 'cancelReason', 'setupCity', 'setupAreas', 'setupContact'].includes(key)) s.safe(this, { [key]: e.detail.value }); },
  pick(e) { const key = e.currentTarget.dataset.field; if (['startDate', 'startTime', 'endDate', 'endTime'].includes(key)) s.safe(this, { [key]: e.detail.value }); else if (['circleIndex', 'policyIndex'].includes(key)) s.safe(this, { [key]: Number(e.detail.value) }); },
  create() { if (this.data.setupNeeded) return s.toast('请先完成本地社区设置'); s.safe(this, draft(null, this.data.circles)); },
  edit(e) { const event = this.data.events.find(item => item.id === e.currentTarget.dataset.id); if (event) s.safe(this, draft(event, this.data.circles)); },
  closeForm() { return s.action(this, async () => { if (!await s.confirm('离开活动编辑？', '尚未保存的修改不会保留。', '离开编辑')) return; s.safe(this, { formOpen: false, editingId: '' }); }); },
  initialize() { return s.action(this, async () => { const city = this.data.setupCity.trim(); const areas = this.data.setupAreas.split(/[\n,，、]/).map(v => v.trim()).filter(Boolean); const contact = this.data.setupContact.trim(); if (!city || !areas.length || !contact) return s.toast('请填写城市、片区和运营联系方式'); if (areas.length > 20 || areas.some(area => Array.from(area).length > 40)) return s.toast('片区最多 20 个，每个不超过 40 字'); if (!await s.confirm('初始化本地社区？', '将建立真实的基础圈子，不会创建示例用户、帖子或活动。', '确认设置')) return; await s.api.call('initialize', { city, areas, contact }); await this.refresh(); if (!this._closed) s.toast('社区已准备好'); }); },
  save() { return s.action(this, async () => {
    if (this.data.editingLocked) return;
    const title = this.data.title.trim(); const description = this.data.description.trim(); const location = this.data.location.trim();
    const startAt = timestamp(this.data.startDate, this.data.startTime); const endAt = timestamp(this.data.endDate, this.data.endTime); const capacity = Number(this.data.capacity);
    if (!title || !description || !location) return s.toast('请填写标题、介绍和集合地点');
    if (Array.from(description).length > 1000) return s.toast('活动介绍最多 1000 字');
    if (!Number.isFinite(startAt) || startAt <= Date.now()) return s.toast('请选择未来的开始时间');
    if (!Number.isFinite(endAt) || endAt <= startAt) return s.toast('结束时间需要晚于开始时间');
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 100) return s.toast('活动人数请填写 2–100 的整数');
    if (capacity < this.data.existingCount) return s.toast('人数上限不能少于已报名人数');
    const circle = this.data.circles[this.data.circleIndex]; if (!circle) return s.toast('请先建立圈子');
    if (this.data.editingId && this.data.existingCount && !await s.confirm('保存活动变更？', '已有 ' + this.data.existingCount + ' 人报名。变更信息会通知报名者，请确认安排准确。', '保存并通知')) return;
    const payload = { title, description, location, startAt, endAt, capacity, petPolicy: policies[this.data.policyIndex].id, circleId: circle.id };
    if (this.data.editingId) payload.id = this.data.editingId;
    await s.api.call(this.data.editingId ? 'updateEvent' : 'createEvent', payload);
    s.safe(this, { formOpen: false, editingId: '' }); await this.refresh(); if (!this._closed) s.toast(this.data.mode === 'demo' ? '活动已保存在本机演示' : '活动已保存');
  }); },
  cancelEvent() { return s.action(this, async () => { if (this.data.editingCancelled || this.data.editingEnded) return; const reason = this.data.cancelReason.trim(); if (!reason) return s.toast('请填写取消原因，方便报名者了解'); if (Array.from(reason).length > 80) return s.toast('取消原因最多 80 字'); if (!await s.confirm('取消这次活动？', '取消后停止报名，取消原因会通知已报名用户。此操作不能撤销。', '取消活动')) return; await s.api.call('cancelEvent', { id: this.data.editingId, reason }); s.safe(this, { formOpen: false, editingId: '' }); await this.refresh(); if (!this._closed) s.toast('活动已取消'); }); }
});
