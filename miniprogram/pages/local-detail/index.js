'use strict';

const s = require('../_shared');
const catalogue = require('../../data/nearby-catalogue');
const withSourcePhoto = require('../../data/nearby-source-photos');
const { CATEGORIES } = require('../../services/place-engine');
const { getTimeStatus, playTagsFor, isLocalScenePhoto } = require('../../data/nearby-utils');
const location = require('../../services/nearby-location');
const config = require('../../config');
const presentation = require('../nearby/presentation');
const links = require('../../services/public-links');
const participationFor = require('../../data/nearby-participation');

const STATUS_LABELS = { upcoming: '即将开始', ongoing: '进行中', ended: '已结束', cancelled: '已取消', undated: '日期待确认' };
const POLICY_LABELS = { allowed: '可带宠', conditional: '有条件携宠', not_allowed: '不可携宠', unknown: '携宠规则待确认' };

function displayDate(iso) {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return '';
  const local = new Date(value + 8 * 60 * 60 * 1000);
  return local.getUTCFullYear() + '年' + (local.getUTCMonth() + 1) + '月' + local.getUTCDate() + '日 ' + String(local.getUTCHours()).padStart(2, '0') + ':' + String(local.getUTCMinutes()).padStart(2, '0');
}

function photosFor(record, failed) {
  const seen = new Set();
  return [record.photo].concat(Array.isArray(record.photos) ? record.photos : []).filter(photo => photo && typeof photo === 'object').reduce((photos, raw) => {
    const url = isLocalScenePhoto(raw.url) ? raw.url : s.httpsUrl(raw.url);
    if (!url || seen.has(url)) return photos;
    seen.add(url);
    photos.push({ ...raw, index: photos.length, originalUrl: url, url: failed && failed.has(url) ? '' : url,
      sourceUrl: s.httpsUrl(raw.sourceUrl), licenseUrl: s.httpsUrl(raw.licenseUrl), sourceCanOpen: links.canOpen(raw.sourceUrl), licenseCanOpen: links.canOpen(raw.licenseUrl) });
    return photos;
  }, []);
}

// Turn only explicitly dated programme copy into a timeline. Publication dates,
// midnight date boundaries and month-only notices never become opening hours.
function programmeFor(record) {
  const schedule = [], used = new Set();
  if (record.type === 'place' || getTimeStatus({ ...record, status: '' }) === 'undated') return { schedule, used };
  (Array.isArray(record.highlights) ? record.highlights : []).forEach((text, index) => {
    if (typeof text !== 'string') return;
    const dated = /^(\d{1,2}月\d{1,2}日)[：:]\s*(.+)$/.exec(text);
    if (dated) {
      schedule.push({ time: dated[1], title: '', text: dated[2] }); used.add(index);
    } else if (/^日程预告[：:]/.test(text)) {
      const parts = text.replace(/^日程预告[：:]/, '').split('；');
      const entries = parts[0].split('，').map(value => /^(\d{1,2}月\d{1,2}(?:[—–-]\d{1,2})?日)(.+)$/.exec(value));
      if (entries.length && entries.every(Boolean)) {
        const note = parts.slice(1).join('；');
        entries.forEach(entry => schedule.push({ time: entry[1], title: entry[2], text: note })); used.add(index);
      }
    }
  });
  return { schedule, used };
}

function decorate(record, failed) {
  record = withSourcePhoto(record);
  const sources = (Array.isArray(record.sources) ? record.sources : []).filter(source => source && typeof source === 'object').map(source => ({
    title: source.title || '公开参考信息', publisher: source.publisher || '',
    url: s.httpsUrl(source.url), canOpen: links.canOpen(source.url), publishedAt: source.publishedAt || '', checkedAt: source.checkedAt || ''
  }));
  const now = Date.now();
  const timeStatus = getTimeStatus(record, now);
  const rangeStatus = record.status === 'cancelled' ? getTimeStatus({ ...record, status: '' }, now) : timeStatus;
  const isPlace = record.type === 'place';
  const isAnnouncement = !isPlace && timeStatus === 'undated' && /^\d{4}-(0[1-9]|1[0-2])$/.test(record.announcementMonth || '');
  const shanghaiNow = new Date(now + 8 * 60 * 60 * 1000);
  const currentMonth = shanghaiNow.getUTCFullYear() + '-' + String(shanghaiNow.getUTCMonth() + 1).padStart(2, '0');
  const announcementPast = isAnnouncement && record.announcementMonth < currentMonth;
  const participation = participationFor(record, { timeStatus, isAnnouncement, announcementPast });
  if (participation) {
    const availableSource = sources.find(item => item.url);
    participation.sourceUrl = s.httpsUrl(participation.sourceUrl) || availableSource && availableSource.url || '';
    participation.canOpen = links.canOpen(participation.sourceUrl);
    const participationSource = sources.find(item => item.url === participation.sourceUrl);
    participation.sourceName = participationSource && participationSource.publisher || '活动公开原文';
  }
  const policy = record.petPolicy || {};
  const policyStatus = Object.prototype.hasOwnProperty.call(POLICY_LABELS, policy.status) ? policy.status : 'unknown';
  const source = sources.find(item => item.url);
  const photos = photosFor(record, failed);
  const photo = photos[0] || null;
  const availablePhotos = photos.filter(value => value.url);
  const copy = presentation({ ...record, timeStatus });
  const programme = programmeFor(record);
  const policyText = policy.text || '暂未取得明确的携宠规则，请出发前向场所或主办方确认。';
  const sceneKind = isPlace ? ['park', 'waterside', 'commercial', 'rest', 'culture'].includes(record.placeKind) ? record.placeKind : 'park' : record.type;
  const point = record.point;
  const canNavigate = !!(point && point.coordinateSystem === 'gcj02' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180);
  const hasAddress = typeof record.address === 'string' && !!record.address.trim();
  const canResolveAddress = typeof wx !== 'undefined' && (wx.__preview === true ||
    typeof wx.openLocation === 'function' && config.mode === 'cloud' && typeof config.cloudEnv === 'string' && !!config.cloudEnv.trim());
  const canLocate = canNavigate || hasAddress && canResolveAddress;
  const reference = location.getReference();
  const dateLabel = record.dateLabel || (rangeStatus && rangeStatus !== 'undated' && record.startsAt && record.endsAt
    ? displayDate(record.startsAt) + ' — ' + displayDate(record.endsAt) : '具体时间待主办方公布');
  const stateNotice = timeStatus === 'ended' ? '这是往期活动，已结束。请以主办方新公布的安排为准。'
    : timeStatus === 'cancelled' ? '活动已取消，请查看主办方最新通知。'
      : isAnnouncement ? announcementPast ? '这条月度预告需要更新，请向主办方确认最新安排。' : '目前公布到月份，具体日期请等待主办方后续通知。' : '';
  return {
    ...record, sources, isPlace, timeStatus, isAnnouncement, announcementPast, photo, photos, participation,
    relatedGuides: (catalogue.guides || []).filter(guide => guide.steps.some(step => step.placeId === record.id)).map(guide => ({ id: guide.id, title: guide.title, duration: guide.duration })),
    photoUrl: availablePhotos[0] && availablePhotos[0].url || '', galleryCount: availablePhotos.length,
    playLabels: playTagsFor(record).map(play => ({ ...play, icon: '/assets/nearby/icons/play-' + play.id + '.svg' })), canNavigate,
    sceneKind, ticketTheme: copy.ticketTheme, policyShort: copy.petHint, description: record.description || record.summary || '',
    quickTime: isPlace ? record.dateLabel || '开放时段待确认' : dateLabel,
    quickPrice: record.ticketText ? copy.ticketHint : '费用待确认',
    showQuickTime: !isPlace || !!(record.dateLabel && !/^(?:开放|营业).*待(?:确认|向|公布)/.test(record.dateLabel)),
    showQuickPrice: !!(record.ticketText && !/^(?:现行)?(?:票价|费用|观众票价).*待(?:确认|公布)/.test(record.ticketText)),
    canLocate,
    navigationLabel: canLocate ? '地图导航' : hasAddress ? '位置待核实' : '地点待公布',
    navigationHint: canNavigate ? point.precision === 'venue' ? '导航参照：' + (typeof point.label === 'string' ? point.label : '场所位置').split('（')[0] + '；具体入口请按现场指引' : '打开地图查看路线'
      : canLocate ? '在地图中按地址查找目的地，入园口以现场指引为准' : hasAddress ? '地图位置尚待核实，可复制地址查询。' : '地点待公布',
    petFacts: policyText.split(/[；;]/).filter(Boolean).map((text, index) => ({ id: 'policy-' + index, icon: '', title: index ? '现场要求' : '携宠安排', text })),
    schedule: programme.schedule,
    detailNotes: (Array.isArray(record.highlights) ? record.highlights : []).filter((text, index) => typeof text === 'string' && text.trim() && !programme.used.has(index)),
    pointSourceUrl: s.httpsUrl(point && point.sourceUrl), pointSourceCanOpen: links.canOpen(point && point.sourceUrl), stateNotice,
    areaLabel: [...new Set([record.city, record.district, record.area].filter(Boolean))].join(' · '),
    timeLabel: isPlace ? record.dateLabel || '开放时段待确认' : dateLabel,
    priceLabel: record.ticketText || '具体费用待确认',
    distance: location.distanceFor(point), reference,
    referenceText: reference ? (reference.source === 'gps' ? '当前位置' : '手选参照：' + reference.label) : '未选择距离参照',
    statusText: isAnnouncement ? announcementPast ? '预告待更新' : '已官宣 · 日期待公布' : STATUS_LABELS[timeStatus] || '',
    categoryText: record.categoryLabel || { place: '附近地点', exhibition: '宠物展览', event: '宠物活动' }[record.type],
    policyStatus, policyLabel: POLICY_LABELS[policyStatus],
    policyText,
    highlights: (Array.isArray(record.highlights) ? record.highlights : []).filter(item => typeof item === 'string' && item.trim()),
    notice: record.notice || (record.needsRecheck ? '部分信息需要更新，出发前请向场所或主办方确认。' : ''),
    dateLabel, checkedAt: record.checkedAt || sources.map(item => item.checkedAt).filter(Boolean).sort().pop() || catalogue.checkedAt || '',
    officialUrl: participation ? participation.sourceUrl : source ? source.url : '',
    officialCanOpen: participation ? participation.canOpen : !!source && links.canOpen(source.url),
    officialButtonText: isPlace ? '打开地点原文' : participation.actionLabel
  };
}

function decorateGuide(guide, overrides) {
  const records = new Map(catalogue.records.map(record => [record.id, record]));
  const sources = new Map();
  const steps = guide.steps.map((step, index) => {
    const place = overrides && overrides.get(step.placeId) || records.get(step.placeId);
    (place && place.sources || []).forEach(source => { if (s.httpsUrl(source.url)) sources.set(source.url, source); });
    return { ...step, number: index + 1, title: place && place.title || '地点资料暂不可用', address: place && place.address || '', available: !!place && place.active !== false };
  });
  return { ...guide, steps, sources: Array.from(sources.values()).map(source => ({ ...source, canOpen: links.canOpen(source.url) })), needsUpdate: steps.some(step => !step.available) };
}

s.register({
  data: { loading: true, error: '', busy: false, item: null, guide: null, referencesOpen: false, activePlayId: '', detailsOpen: false, galleryIndex: 0,
    isBookmarked: false, isAdmin: false, placeServiceError: '', visitForm: false, visitedOn: '', visitNote: '', visit: null, correctionForm: false, correctionCategories: CATEGORIES, correctionIndex: 0, correctionText: '' },
  onLoad(options) {
    this.id = typeof options.id === 'string' ? options.id.trim() : '';
    this.guideId = typeof options.guideId === 'string' ? options.guideId.trim() : '';
    this._failedPhotoUrls = new Set();
    this.refresh();
    return this.loadPlaceState();
  },
  onShow() { this._hidden = false; if (this._loaded) { this.refresh(); this.loadPlaceState(); } },
  onHide() { this._hidden = true; location.cancelPending(); },
  onUnload() { location.cancelPending(); },
  onPullDownRefresh() { this.refresh(); return this.loadPlaceState(); },
  refresh() {
    if (this._closed) return;
    if (this.guideId) {
      const guide = (catalogue.guides || []).find(guide => guide.id === this.guideId);
      s.safe(this, { loading: false, item: null, guide: guide ? decorateGuide(guide, this._guidePlaces) : null, error: guide ? '' : '这条路线攻略不存在，或已下架。' });
      if (guide && wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: '路线攻略' });
      this._loaded = true;
      if (wx.stopPullDownRefresh) wx.stopPullDownRefresh();
      return;
    }
    const record = !this._remoteUnavailable && (this._remoteRecord || (Array.isArray(catalogue.records) ? catalogue.records : []).find(item => item.id === this.id));
    if (!this.id || !record || !['place', 'exhibition', 'event'].includes(record.type)) {
      s.safe(this, { loading: false, item: null, error: '这条地点或活动信息不存在，或已下架。' });
    } else {
      const item = decorate(record, this._failedPhotoUrls);
      s.safe(this, { loading: false, error: '', item, galleryIndex: Math.max(0, Math.min(this.data.galleryIndex, item.galleryCount - 1)),
        activePlayId: item.playLabels.some(play => play.id === this.data.activePlayId) ? this.data.activePlayId : '' });
      if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: record.type === 'place' ? '附近地点' : '活动与展览' });
    }
    this._loaded = true;
    if (wx.stopPullDownRefresh) wx.stopPullDownRefresh();
  },
  async loadPlaceState() {
    const request = this._placeRequest = (this._placeRequest || 0) + 1;
    if (this.guideId) {
      const guide = (catalogue.guides || []).find(item => item.id === this.guideId);
      if (!guide) return;
      const ids = [...new Set(guide.steps.map(step => step.placeId))];
      const results = await Promise.all(ids.map(async id => {
        try { const result = await s.api.call('getPlace', { id }); return { id, place: result.place }; }
        catch (error) { return { id, error }; }
      }));
      if (this._closed || this._hidden || request !== this._placeRequest) return;
      this._guidePlaces = this._guidePlaces || new Map();
      results.forEach(result => {
        if (result.place) this._guidePlaces.set(result.id, result.place);
        else if (result.error && result.error.code === 'NOT_FOUND') this._guidePlaces.set(result.id, { id: result.id, active: false, title: '地点已不可用' });
      });
      s.safe(this, { placeServiceError: results.some(result => result.error) ? '部分地点暂未读取最新状态，行前请再次确认。' : '' });
      this.refresh();
      return;
    }
    if (!this.id) return;
    const savedRecord = !this._remoteUnavailable && (this._remoteRecord || catalogue.records.find(item => item.id === this.id));
    if (!savedRecord) s.safe(this, { loading: true, error: '', item: null });
    try {
      const result = await s.api.call('getPlace', { id: this.id });
      if (this._closed || this._hidden || request !== this._placeRequest) return;
      if (!result.place || !['place', 'event', 'exhibition'].includes(result.place.type)) throw new Error('地点或活动资料暂未读取完整，请重试。');
      this._remoteUnavailable = false;
      this._remoteRecord = result.place;
      s.safe(this, { isBookmarked: result.isBookmarked, isAdmin: result.isAdmin, placeServiceError: '' }); this.refresh();
    } catch (error) {
      if (this._closed || this._hidden || request !== this._placeRequest) return;
      if (error.code === 'NOT_FOUND') { this._remoteRecord = null; this._remoteUnavailable = true; }
      if (!savedRecord || this._remoteUnavailable) s.safe(this, { loading: false, item: null, error: error.message || '地点或活动资料暂时无法读取，请重试。', placeServiceError: '' });
      else s.safe(this, { loading: false, placeServiceError: '收藏状态暂未读取，可继续查看已保存的地点资料。' });
    }
  },
  bookmark() { return s.action(this, async () => { const result = await s.api.call('bookmarkPlace', { id: this.id, bookmark: !this.data.isBookmarked }); s.safe(this, { isBookmarked: result.isBookmarked }); }); },
  openVisitForm() { s.safe(this, { visitForm: !this.data.visitForm, visitedOn: this.data.visitedOn || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }); },
  visitDate(e) { s.safe(this, { visitedOn: e.detail.value }); },
  visitInput(e) { s.safe(this, { visitNote: e.detail.value }); },
  saveVisit() { return s.action(this, async () => { const result = await s.api.call('recordPlaceVisit', { placeId: this.id, visitedOn: this.data.visitedOn, note: this.data.visitNote }); s.safe(this, { visit: result.visit, visitForm: false }); s.toast('到访已记录，仅自己可见'); }); },
  shareVisit() { if (s.personalMode) return; s.go('/pages/compose/index?placeId=' + encodeURIComponent(this.id) + (this.data.visit ? '&visitId=' + encodeURIComponent(this.data.visit.id) : '')); },
  toggleCorrection() { if (s.personalMode) return; s.safe(this, { correctionForm: !this.data.correctionForm }); },
  correctionType(e) { s.safe(this, { correctionIndex: Number(e.detail.value) }); },
  correctionInput(e) { s.safe(this, { correctionText: e.detail.value }); },
  sendCorrection() { if (s.personalMode) return; return s.action(this, async () => { await s.api.call('submitPlaceCorrection', { placeId: this.id, category: CATEGORIES[this.data.correctionIndex], text: this.data.correctionText }); s.safe(this, { correctionForm: false, correctionText: '' }); s.toast('已提交给运营者核实'); }); },
  myPlaces() { s.go('/pages/places/index'); },
  openGuide(e) { const id = e.currentTarget.dataset.id; if ((catalogue.guides || []).some(guide => guide.id === id)) s.go('/pages/local-detail/index?guideId=' + encodeURIComponent(id)); },
  openGuideStop(e) { const id = e.currentTarget.dataset.id; if (this.data.guide && this.data.guide.steps.some(step => step.placeId === id && step.available)) s.go('/pages/local-detail/index?id=' + encodeURIComponent(id)); },
  openGuideSource(e) { if (this._closed || this._hidden) return; return s.action(this, () => { const source = this.data.guide && this.data.guide.sources[Number(e.currentTarget.dataset.index)]; return links.open(source && source.url, source && source.title); }); },
  managePlace() { if (!s.personalMode && this.data.isAdmin && this.data.item && this.data.item.isPlace) s.go('/pages/places-manage/index?id=' + encodeURIComponent(this.id)); },
  copyAddress() {
    if (this._closed || this._hidden) return;
    const address = this.data.item && this.data.item.address;
    if (typeof address !== 'string' || !address.trim()) return s.toast('具体地址尚未公布');
    const fail = () => { if (!this._closed && !this._hidden) s.toast('地址未能复制，请稍后重试'); };
    if (typeof wx.setClipboardData !== 'function') return fail();
    try { wx.setClipboardData({ data: address.trim(), success: () => { if (!this._closed && !this._hidden) s.toast('地址已复制'); }, fail }); }
    catch (_) { fail(); }
  },
  navigate() {
    if (this._closed || this._hidden) return;
    this.refresh();
    const destination = this.data.item;
    if (!destination) return;
    if (!destination.canLocate) {
      if (typeof destination.address !== 'string' || !destination.address.trim()) s.toast('具体地点尚未公布，请留意后续活动信息');
      return;
    }
    return s.action(this, async () => {
      const item = this.data.item;
      if (!item || !item.canLocate) return;
      try {
        if (!item.canNavigate) await location.navigateByAddress({ id: item.id, name: item.venue || item.title, address: item.address, city: item.city || '上海' });
        else await location.navigateTo(item.point, { name: typeof item.point.label === 'string' && item.point.label ? item.point.label.split('（')[0] : item.title, address: item.address });
      }
      catch (error) { if (['LOCATION_CANCELLED', 'LOCATION_STALE'].includes(error.code)) return; throw error; }
    });
  },
  toggleReferences() { s.safe(this, { referencesOpen: !this.data.referencesOpen }); },
  togglePlay(event) {
    if (this._closed || this._hidden) return;
    const id = event && event.currentTarget && event.currentTarget.dataset.id;
    if (!this.data.item || !this.data.item.playLabels.some(play => play.id === id)) return;
    s.safe(this, { activePlayId: this.data.activePlayId === id ? '' : id });
  },
  toggleDetails() { if (!this._closed && !this._hidden) s.safe(this, { detailsOpen: !this.data.detailsOpen }); },
  galleryScroll(event) {
    if (this._closed || this._hidden || !this.data.item || this.data.item.galleryCount < 2) return;
    const detail = event && event.detail || {};
    if (!Number.isFinite(detail.scrollWidth) || detail.scrollWidth <= 0 || !Number.isFinite(detail.scrollLeft)) return;
    const count = this.data.item.galleryCount;
    const index = Math.max(0, Math.min(count - 1, Math.round(detail.scrollLeft / (detail.scrollWidth / count))));
    if (index !== this.data.galleryIndex) s.safe(this, { galleryIndex: index });
  },
  photoFailed(event) {
    if (this._closed || this._hidden) return;
    const raw = event && event.currentTarget && event.currentTarget.dataset.index;
    const index = raw === undefined ? 0 : Number(raw);
    const photo = Number.isInteger(index) && this.data.item && this.data.item.photos[index];
    if (!photo || !photo.originalUrl) return;
    this._failedPhotoUrls.add(photo.originalUrl); this.refresh();
  },
  previewPhoto(event) {
    if (this._closed || this._hidden) return;
    const photos = this.data.item && this.data.item.photos || [];
    const raw = event && event.currentTarget && event.currentTarget.dataset.index;
    const index = raw === undefined ? 0 : Number(raw);
    const photo = Number.isInteger(index) && photos[index];
    if (photo && photo.url && typeof wx.previewImage === 'function') wx.previewImage({ urls: photos.filter(value => value.url).map(value => value.url), current: photo.url });
  },
  openPhotoInfo(event) {
    if (this._closed || this._hidden) return;
    return s.action(this, () => {
      const field = event.currentTarget.dataset.field;
      if (!['sourceUrl', 'licenseUrl'].includes(field)) return;
      const raw = event.currentTarget.dataset.index;
      const index = raw === undefined ? 0 : Number(raw);
      const photo = Number.isInteger(index) && this.data.item && this.data.item.photos[index];
      const url = photo && photo[field];
      if (url) return links.open(url, field === 'licenseUrl' ? '图片许可' : '图片来源');
    });
  },
  openOfficial() {
    if (this._closed || this._hidden) return;
    return s.action(this, async () => {
      this.refresh();
      const item = this.data.item;
      if (item) await links.open(item.officialUrl, item.title);
    });
  },
  openParticipationSource() {
    if (this._closed || this._hidden || this.data.busy) return;
    return s.action(this, async () => {
      this.refresh();
      const item = this.data.item;
      const participation = item && item.participation;
      const url = s.httpsUrl(participation && participation.sourceUrl);
      if (!url) return;
      try {
        if (links.canOpen(url)) return await links.open(url, item.title);
        if (typeof wx.showModal !== 'function') throw new Error('当前微信暂不支持打开此网页');
        await new Promise((resolve, reject) => wx.showModal({
          title: '活动原文',
          content: '当前微信暂不支持打开此网页。\n来源：' + (participation.sourceName || '活动公开原文') + '\n' + url,
          showCancel: false, confirmText: '知道了', success: resolve,
          fail: () => reject(new Error('原文信息暂时无法展示，请稍后重试'))
        }));
      } catch (error) {
        if (this._closed || this._hidden) return;
        throw error;
      }
    });
  },
  openSource(event) {
    if (this._closed || this._hidden) return;
    return s.action(this, () => {
      const index = Number(event && event.currentTarget && event.currentTarget.dataset.index);
      const source = Number.isInteger(index) && this.data.item && this.data.item.sources[index];
      return links.open(source && source.url, source && source.title);
    });
  },
  openPointSource() {
    if (this._closed || this._hidden) return;
    return s.action(this, () => links.open(this.data.item && this.data.item.pointSourceUrl, '地图位置来源'));
  },
  backToNearby() {
    wx.switchTab({ url: '/pages/nearby/index', fail: () => { if (!this._closed) s.toast('暂时无法返回，请使用左上角返回'); } });
  },
  onShareAppMessage() {
    if (this.data.guide) return s.shareCard('有宠有邻｜' + this.data.guide.title, '/pages/local-detail/index?guideId=' + encodeURIComponent(this.data.guide.id));
    const item = this.data.item;
    return item ? s.shareCard('有宠有邻｜' + item.title, '/pages/local-detail/index?id=' + encodeURIComponent(item.id))
      : s.shareCard('有宠有邻｜看看附近有什么', '/pages/nearby/index');
  },
  onShareTimeline() {
    const guide = this.data.guide, item = this.data.item;
    if (guide) return s.shareTimeline('有宠有邻｜' + guide.title, 'guideId=' + encodeURIComponent(guide.id));
    return item ? s.shareTimeline('有宠有邻｜' + item.title, 'id=' + encodeURIComponent(item.id)) : s.shareTimeline();
  }
});
