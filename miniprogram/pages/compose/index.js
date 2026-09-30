const s = require('../_shared');
const drafts = require('../_drafts');
const topics = require('../../data/topics');
const animals = require('../../data/animal-types');
const placesService = require('../../services/places');
const unique = values => [...new Set(values)];
const list = value => Array.isArray(value) ? value : [];
const tickets = value => list(value).filter(item => item && typeof item.ticketId === 'string');
function attachmentState(value) {
  const result = Array.isArray(value) ? { images: value } : value || {};
  return { video: result.video && typeof result.video.url === 'string' ? result.video : null, images: list(result.images).filter(item => typeof item === 'string'), completed: tickets(result.completed), pending: tickets(result.pending), failures: tickets(result.failures) };
}
function attachmentFlags(value) {
  const incomplete = list(value.pendingUploads).concat(list(value.failedUploads));
  const hasVideoAttachment = !!value.video || incomplete.some(item => item.mediaType === 'video');
  const hasImageAttachment = list(value.images).length > 0 || incomplete.some(item => item.mediaType !== 'video');
  return { hasVideoAttachment, mediaConflict: hasVideoAttachment && hasImageAttachment,
    attachmentCount: list(value.images).length + (value.video ? 1 : 0) + incomplete.length };
}
function text(value) { return typeof value === 'string' ? value : ''; }
s.register({
  data: { places: [{ id: '', title: '不关联地点' }], placeIndex: 0, selectedPlaceId: '', selectedVisitId: '', pendingPlaceId: '', pendingVisitId: '', placesBusy: false, placesError: '', loading: true, error: '', mode: '', circles: [], circleIndex: 0, text: '', title: '', kind: 'daily', kinds: [{ id: 'daily', name: '日常分享', icon: '✦' }, { id: 'question', name: '问问大家', icon: '?' }, { id: 'meetup', name: '一起活动', icon: '↗' }], animalTypes: [], animalChoices: animals.choices([]), topicsOpen: false, selectedTopics: [], topicChoices: topics.map(name => ({ name, selected: false })), video: null, hasVideoAttachment: false, mediaConflict: false, videoUploading: false, videoProgress: null, images: [], completedUploads: [], pendingUploads: [], failedUploads: [], uploadsBusy: false, attachmentCount: 0, coverIndex: 0, busy: false, events: [{ id: '', pickerLabel: '不关联活动' }], eventIndex: 0, selectedEventId: '', eventCursor: null, eventsBusy: false, eventError: '', eventsLoaded: false, draftRestored: false, draftError: '', submitError: '' },
  onLoad(options) { this.requestedCircle = options.circleId; this.requestedPlace = options.placeId || ''; this.requestedVisit = options.visitId || ''; this.refresh().then(() => { if (this._closed || this.data.error) return; this.loadEvents(); this.loadPlaces(); if (this._verified) this.checkUploads(true); }); },
  onShow() { if (this._loaded) this.refresh().then(() => { if (!this._closed && !this.data.error && this._verified) this.checkUploads(true); }); },
  onHide() { this.saveDraft(); },
  onUnload() { this.saveDraft(); },
  refresh() { return s.load(this, async () => {
    const boot = await s.api.call('bootstrap');
    this._verified = boot.user.verification && boot.user.verification.status === (boot.mode === 'demo' ? 'demo_verified' : 'phone_verified');
    const circles = boot.circles.filter(circle => circle.isJoined);
    const previousCircle = this.data.circles[this.data.circleIndex];
    let circleId = previousCircle && previousCircle.id || this.requestedCircle;
    let restored = {};
    if (this._draftOwner !== boot.mode + ':' + boot.user.id) {
      this._draftOwner = boot.mode + ':' + boot.user.id;
      this._skipSave = false;
      circleId = this.requestedCircle;
      restored = { text: '', title: '', kind: 'daily', animalTypes: [], animalChoices: animals.choices([]), topicsOpen: false, selectedTopics: [], topicChoices: topics.map(name => ({ name, selected: false })), video: null, hasVideoAttachment: false, mediaConflict: false, videoUploading: false, videoProgress: null, images: [], completedUploads: [], pendingUploads: [], failedUploads: [], coverIndex: 0, attachmentCount: 0, selectedEventId: '', eventIndex: 0, selectedPlaceId: this.requestedPlace || '', selectedVisitId: this.requestedVisit || '', placeIndex: 0, draftRestored: false, submitError: '' };
      const result = drafts.read(this._draftOwner);
      const draft = result.value;
      if (draft) {
        const selectedTopics = topics.normalize(draft.selectedTopics).slice(0, 3);
        const animalTypes = animals.normalize(draft.animalTypes).slice(0, 3);
        const video = draft.video && typeof draft.video.url === 'string' ? draft.video : null;
        const images = list(draft.images).filter(image => typeof image === 'string').slice(0, 3);
        restored = { text: text(draft.text), title: text(draft.title), kind: ['daily', 'question', 'meetup'].includes(draft.kind) ? draft.kind : 'daily', animalTypes, animalChoices: animals.choices(animalTypes), video, selectedTopics, topicChoices: topics.map(name => ({ name, selected: selectedTopics.includes(name) })), images, coverIndex: draft.coverIndex >= 0 && draft.coverIndex < images.length ? draft.coverIndex : 0, selectedEventId: text(draft.selectedEventId), completedUploads: tickets(draft.completedUploads), pendingUploads: tickets(draft.pendingUploads), failedUploads: tickets(draft.failedUploads), draftRestored: true };
        Object.assign(restored, attachmentFlags(restored));
        restored.selectedPlaceId = text(draft.selectedPlaceId);
        restored.selectedVisitId = text(draft.selectedVisitId);
        restored.pendingPlaceId = this.requestedPlace && (this.requestedPlace !== restored.selectedPlaceId || this.requestedVisit && this.requestedVisit !== restored.selectedVisitId) ? this.requestedPlace : '';
        restored.pendingVisitId = this.requestedVisit || '';
        circleId = draft.circleId || circleId;
      }
      restored.draftError = result.error || '';
    }
    return Object.assign({ mode: boot.mode, circles, circleIndex: Math.max(0, circles.findIndex(circle => circle.id === circleId)) }, restored);
  }); },
  change(values) { this._skipSave = false; s.safe(this, Object.assign({ submitError: '' }, values, attachmentFlags(Object.assign({}, this.data, values)))); this.saveDraft(); },
  saveDraft() {
    if (!this._draftOwner || this._skipSave) return;
    const circle = this.data.circles[this.data.circleIndex];
    const keys = ['text', 'title', 'kind', 'selectedTopics', 'animalTypes', 'video', 'images', 'coverIndex', 'completedUploads', 'pendingUploads', 'failedUploads', 'selectedEventId', 'selectedPlaceId', 'selectedVisitId'];
    const value = { circleId: circle && circle.id || '' };
    keys.forEach(key => { value[key] = this.data[key]; });
    const error = drafts.save(this._draftOwner, value);
    s.safe(this, { draftError: error });
  },
  input(e) { this.change({ text: e.detail.value }); },
  inputTitle(e) { this.change({ title: e.detail.value }); },
  chooseCircle(e) { this.change({ circleIndex: Number(e.detail.value) }); },
  async loadPlaces() {
    if (this.data.placesBusy) return;
    s.safe(this, { placesBusy: true, placesError: '' });
    try {
      const records = await placesService.listAll();
      const places = [{ id: '', title: '不关联地点' }].concat(records);
      s.safe(this, { places, placeIndex: Math.max(0, places.findIndex(item => item.id === this.data.selectedPlaceId)) });
    } catch (error) { s.safe(this, { placesError: error.message || '地点暂未读取，可重试或不关联地点发布' }); }
    finally { s.safe(this, { placesBusy: false }); }
  },
  choosePlace(e) { const placeIndex = Number(e.detail.value); const place = (this.data.places || [])[placeIndex]; if (place) this.change({ placeIndex, selectedPlaceId: place.id, selectedVisitId: '', pendingPlaceId: '', pendingVisitId: '' }); },
  applyRequestedPlace() { const place = (this.data.places || []).find(item => item.id === this.data.pendingPlaceId); if (!place) return s.toast('请先重试读取地点'); this.change({ selectedPlaceId: place.id, selectedVisitId: this.data.pendingVisitId || '', placeIndex: this.data.places.indexOf(place), pendingPlaceId: '', pendingVisitId: '' }); },
  clearVisit() { this.change({ selectedVisitId: '' }); },
  selectKind(e) { if (!this.data.busy && ['daily', 'question', 'meetup'].includes(e.currentTarget.dataset.kind)) this.change({ kind: e.currentTarget.dataset.kind }); },
  selectTopic(e) { if (this.data.busy) return; const topic = e.currentTarget.dataset.topic; if (!topics.includes(topic)) return; let selectedTopics = this.data.selectedTopics.slice(); if (selectedTopics.includes(topic)) selectedTopics = selectedTopics.filter(value => value !== topic); else { if (selectedTopics.length >= 3) return s.toast('最多选择 3 个话题'); selectedTopics.push(topic); } this.change({ selectedTopics, topicChoices: topics.map(name => ({ name, selected: selectedTopics.includes(name) })) }); },
  toggleTopics() { s.safe(this, { topicsOpen: !this.data.topicsOpen }); },
  selectAnimal(e) { if (this.data.busy) return; const id = e.currentTarget.dataset.id; if (!animals.IDS.includes(id)) return; let animalTypes = this.data.animalTypes.slice(); if (animalTypes.includes(id)) animalTypes = animalTypes.filter(value => value !== id); else { if (animalTypes.length >= 3) return s.toast('最多选择 3 种动物'); animalTypes.push(id); } this.change({ animalTypes, animalChoices: animals.choices(animalTypes) }); },
  applyUploads(value) {
    if (this._closed) return;
    const result = attachmentState(value);
    const cover = this.data.images[this.data.coverIndex];
    const previouslyTracked = this.data.completedUploads.filter(item => !item.recoveredFromDraft).map(item => item.fileId);
    const untracked = this.data.images.filter(image => !previouslyTracked.includes(image));
    const oldFlags = attachmentFlags(this.data);
    const incomingFlags = attachmentFlags({ images: result.images, video: result.video, pendingUploads: result.pending, failedUploads: result.failures });
    // A restored draft and the durable upload queue can disagree after an
    // interrupted save. Keep conflicting attachments visible for removal.
    const preserveConflict = oldFlags.mediaConflict ||
      oldFlags.hasVideoAttachment && incomingFlags.attachmentCount && !incomingFlags.hasVideoAttachment ||
      incomingFlags.hasVideoAttachment && (this.data.images.length || this.data.pendingUploads.concat(this.data.failedUploads).some(item => item.mediaType !== 'video'));
    const images = unique((preserveConflict ? this.data.images : untracked).concat(result.images));
    const video = result.video || (this.data.video && (preserveConflict || !previouslyTracked.includes(this.data.video.url)) ? this.data.video : null);
    const incomingIds = new Set(result.completed.concat(result.pending, result.failures).map(item => item.ticketId));
    const retained = items => items.filter(item => !incomingIds.has(item.ticketId) && (preserveConflict || item.recoveredFromDraft)).map(item => Object.assign({}, item, { recoveredFromDraft: true }));
    const visibleFiles = images.concat(video ? [video.url] : []);
    const completedUploads = result.completed.concat(retained(this.data.completedUploads).filter(item => visibleFiles.includes(item.fileId)));
    const pendingUploads = result.pending.concat(retained(this.data.pendingUploads));
    const failedUploads = result.failures.concat(retained(this.data.failedUploads));
    this.change({ video, images, completedUploads, pendingUploads: pendingUploads.map(item => ({ ticketId: item.ticketId, mediaType: item.mediaType || 'image', recoveredFromDraft: !!item.recoveredFromDraft, status: item.status, message: item.message || '附件正在等待审核，稍后可以重新检查。' })), failedUploads: failedUploads.map(item => ({ ticketId: item.ticketId, mediaType: item.mediaType || 'image', recoveredFromDraft: !!item.recoveredFromDraft, code: item.code || '', message: item.message || '附件处理未完成，请重试。' })), coverIndex: cover && images.includes(cover) ? images.indexOf(cover) : 0 });
  },
  upload() { return s.action(this, async () => {
    if (this.data.hasVideoAttachment) return s.toast('每条分享请选择照片或一个视频');
    const remaining = 3 - this.data.attachmentCount;
    if (remaining <= 0 || this.data.uploadsBusy) return;
    try { const result = await s.api.uploadImages(remaining); this.applyUploads(result); }
    catch (error) { s.safe(this, { submitError: error.message || '图片未能添加，正文已保留，请重试。' }); this.saveDraft(); throw error; }
  }); },
  uploadVideo() { return s.action(this, async () => {
    if (this.data.attachmentCount || this.data.uploadsBusy) return s.toast('请先移除当前照片或视频，再选择视频');
    s.safe(this, { videoUploading: true, videoProgress: null });
    try { this.applyUploads(await s.api.uploadVideo(progress => s.safe(this, { videoProgress: progress }))); }
    catch (error) { s.safe(this, { submitError: error.message || '视频未能添加，正文已保留。' }); this.saveDraft(); throw error; }
    finally { s.safe(this, { videoUploading: false, videoProgress: null }); }
  }); },
  removeVideo() { return s.action(this, async () => {
    if (this.data.uploadsBusy || !this.data.video) return;
    const url = this.data.video.url;
    const ids = this.data.completedUploads.filter(item => item.fileId === url || item.mediaType === 'video').map(item => item.ticketId);
    if (ids.length && s.api.discardUploads) await s.api.discardUploads(ids);
    this.change({ video: null, hasVideoAttachment: this.data.pendingUploads.concat(this.data.failedUploads).some(item => item.mediaType === 'video'), completedUploads: this.data.completedUploads.filter(item => !ids.includes(item.ticketId)), attachmentCount: this.data.images.length + this.data.pendingUploads.length + this.data.failedUploads.length });
  }); },
  async checkUploads(automatic) {
    if (this._closed || this.data.uploadsBusy || this.data.busy || typeof s.api.resumeUploads !== 'function') return;
    s.safe(this, { uploadsBusy: true });
    try { this.applyUploads(await s.api.resumeUploads()); }
    catch (error) { if (!this._closed) { s.safe(this, { submitError: (error.message || '图片状态未能读取') + '。草稿已保留，可以稍后重试。' }); if (!automatic && error.code === 'VERIFICATION_REQUIRED') s.openVerification(); } }
    finally { s.safe(this, { uploadsBusy: false }); }
  },
  retryUploads() { return this.checkUploads(false); },
  removeImage(e) { return s.action(this, async () => {
    if (this.data.uploadsBusy) return;
    const removed = Number(e.currentTarget.dataset.index);
    const fileId = this.data.images[removed];
    if (!fileId) return;
    const ids = this.data.completedUploads.filter(item => item.fileId === fileId).map(item => item.ticketId);
    if (ids.length && s.api.discardUploads) await s.api.discardUploads(ids);
    const images = this.data.images.filter((_, index) => index !== removed);
    const cover = this.data.images[this.data.coverIndex];
    this.change({ images, coverIndex: images.includes(cover) ? images.indexOf(cover) : 0, completedUploads: this.data.completedUploads.filter(item => item.fileId !== fileId), attachmentCount: images.length + this.data.pendingUploads.length + this.data.failedUploads.length });
  }); },
  removeUpload(e) { return s.action(this, async () => {
    if (this.data.uploadsBusy) return;
    const id = e.currentTarget.dataset.id;
    if (s.api.discardUploads) await s.api.discardUploads([id]);
    const pendingUploads = this.data.pendingUploads.filter(item => item.ticketId !== id);
    const failedUploads = this.data.failedUploads.filter(item => item.ticketId !== id);
    this.change({ pendingUploads, failedUploads, hasVideoAttachment: !!this.data.video || pendingUploads.concat(failedUploads).some(item => item.mediaType === 'video'), attachmentCount: this.data.images.length + (this.data.video ? 1 : 0) + pendingUploads.length + failedUploads.length });
  }); },
  chooseCover(e) { if (this.data.busy) return; const index = Number(e.currentTarget.dataset.index); if (index >= 0 && index < this.data.images.length) this.change({ coverIndex: index }); },
  preview(e) { s.preview(this.data.images, e.currentTarget.dataset.src); },
  chooseEvent(e) { const eventIndex = Number(e.detail.value); const event = this.data.events[eventIndex]; this.change({ eventIndex, selectedEventId: event && event.id || '' }); },
  async loadEvents() { if (this.data.eventsBusy || (this.data.eventsLoaded && !this.data.eventCursor)) return; s.safe(this, { eventsBusy: true, eventError: '' }); try { const result = await s.api.call('listEvents', { filter: 'all', cursor: this.data.eventCursor || undefined }); const available = result.items.filter(event => event.status === 'active' && event.startAt > Date.now()); const events = this.data.events.slice(); const ids = new Set(events.map(event => event.id)); available.forEach(event => { if (!ids.has(event.id)) { events.push(Object.assign({}, event, { pickerLabel: event.title + ' · ' + s.dateText(event.startAt) })); ids.add(event.id); } }); s.safe(this, { events, eventIndex: Math.max(0, events.findIndex(event => event.id === this.data.selectedEventId)), eventCursor: result.nextCursor || null, eventsLoaded: true }); } catch (error) { s.safe(this, { eventError: error.message || '暂时没有读到活动，请重试' }); } finally { s.safe(this, { eventsBusy: false }); } },
  explore() { wx.switchTab({ url: '/pages/community/index' }); },
  clearDraft() { return s.action(this, async () => {
    if (this.data.uploadsBusy || !await s.confirm('清除这份本机草稿？', '会清除尚未发布的正文和所选照片，不影响已经发布的分享。', '清除草稿')) return;
    const ids = unique(this.data.completedUploads.concat(this.data.pendingUploads, this.data.failedUploads).map(item => item.ticketId).concat(this._consumedUploadIds || []).filter(Boolean));
    if (ids.length && s.api.discardUploads) await s.api.discardUploads(ids);
    this._skipSave = true;
    const cleared = drafts.clear(this._draftOwner);
    this._consumedUploadIds = [];
    s.safe(this, { text: '', title: '', video: null, hasVideoAttachment: false, mediaConflict: false, videoUploading: false, videoProgress: null, images: [], completedUploads: [], pendingUploads: [], failedUploads: [], attachmentCount: 0, coverIndex: 0, animalTypes: [], animalChoices: animals.choices([]), topicsOpen: false, selectedTopics: [], topicChoices: topics.map(name => ({ name, selected: false })), selectedEventId: '', eventIndex: 0, selectedPlaceId: '', selectedVisitId: '', placeIndex: 0, pendingPlaceId: '', pendingVisitId: '', kind: 'daily', draftRestored: false, submitError: '', draftError: cleared ? '' : '本机草稿未能清除，请检查存储空间后重试。' });
  }); },
  submit() { return s.action(this, async () => {
    if (attachmentFlags(this.data).mediaConflict) return s.toast('照片与视频不能一起发布，请移除其中一类附件');
    if (this.data.images.length > 3) return s.toast('最多发布 3 张照片，请移除多余照片');
    if (this.data.uploadsBusy || this.data.pendingUploads.length || this.data.failedUploads.length) return s.toast('请先完成附件处理，或移除未完成的附件');
    const text = this.data.text.trim(); const title = this.data.title.trim();
    if (!text && !this.data.images.length && !this.data.video) return s.toast('写一点正文，或分享照片与视频');
    if (Array.from(title).length > 40) return s.toast('标题最多 40 字');
    const circle = this.data.circles[this.data.circleIndex]; if (!circle) return s.toast('先加入一个小圈子');
    if (this.data.selectedEventId && !this.data.events.some(event => event.id === this.data.selectedEventId)) return s.toast('草稿关联的活动尚未读取，请重新选择活动');
    if (this.data.selectedPlaceId && !(this.data.places || []).some(place => place.id === this.data.selectedPlaceId)) return s.toast('关联地点尚未读取或已下架，请重试或选择不关联地点');
    this.saveDraft();
    let posted;
    try { posted = await s.api.call('createPost', { circleId: circle.id, text, images: this.data.images, title, kind: this.data.kind, topics: this.data.selectedTopics, animalTypes: this.data.animalTypes, video: this.data.video || undefined, coverIndex: this.data.coverIndex, eventId: this.data.selectedEventId || undefined, placeId: this.data.selectedPlaceId || undefined, visitId: this.data.selectedVisitId || undefined }); }
    catch (error) { s.safe(this, { submitError: (error.message || '分享未完成') + '。内容已保留，请调整后重试。' }); throw error; }
    this._skipSave = true;
    const cleared = drafts.clear(this._draftOwner);
    const ids = this.data.completedUploads.map(item => item.ticketId);
    let cleanupFailed = !cleared || !!(posted && posted.localCleanup && posted.localCleanup.status === 'failed');
    try { if (ids.length && s.api.discardUploads) await s.api.discardUploads(ids); } catch (error) { cleanupFailed = true; this._consumedUploadIds = ids; }
    if (this._closed) return;
    s.safe(this, { text: '', title: '', video: null, hasVideoAttachment: false, mediaConflict: false, videoUploading: false, videoProgress: null, images: [], completedUploads: [], pendingUploads: [], failedUploads: [], attachmentCount: 0, coverIndex: 0, submitError: '', draftRestored: false, draftError: cleanupFailed ? '分享已发布，但本机草稿或照片记录未能清理。请点清除本机草稿，不要重复发布。' : '' });
    if (cleanupFailed) { s.toast('分享已发布，请清理本机草稿'); return; }
    s.toast(this.data.mode === 'demo' ? '分享已保存到本机演示' : '已分享，让同好慢慢认识你'); s.back();
  }); }
});
