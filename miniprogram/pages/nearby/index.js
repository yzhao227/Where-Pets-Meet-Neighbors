const s = require('../_shared');
const catalogue = require('../../data/nearby-catalogue');
const placeService = require('../../services/places');
const { selectNearbyRecords, selectAnnouncements, PLAY_TAGS, playTagsFor, isLocalScenePhoto } = require('../../data/nearby-utils');
const location = require('../../services/nearby-location');
const presentation = require('./presentation');
const { splitDiscoveryCards } = require('./discovery-quality');
const controls = require('../../data/nearby-controls');
const neighborAreas = require('../../data/neighbor-areas');
const neighborAreaChoices = [{ id: '', label: '全部活动片区' }].concat(neighborAreas);
const dropdownId = (tab, menu, value) => tab + ':' + menu + ':' + value;

function refreshedItems(previous, pages, cursors, decorate) {
  const current = new Map();
  pages.forEach(page => (page.items || []).forEach(item => current.set(item.id, decorate(item))));
  // An item absent inside a refreshed cursor range was withdrawn/hidden. An
  // item pushed beyond that range by new head entries still keeps its slot.
  return previous.filter(item => current.has(item.id) || !pages.some((page, index) =>
    (!cursors[index] || item.id < cursors[index]) && (!page.nextCursor || item.id >= page.nextCursor)
  )).map(item => current.get(item.id) || item);
}
function readPages(action, query, cursors) {
  return Promise.all(cursors.map(cursor => s.api.call(action, { ...query, ...(cursor ? { cursor } : {}) })));
}
function settled(promise) { return Promise.resolve(promise).then(value => ({ value }), error => ({ error })); }

function navigationSize() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {};
    const statusBarHeight = Number.isFinite(info.statusBarHeight) ? Math.max(0, Math.min(100, info.statusBarHeight)) : 0;
    const capsule = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null;
    const row = capsule && capsule.top >= statusBarHeight && capsule.height > 0 ? capsule.height + 2 * (capsule.top - statusBarHeight) : 44;
    const inset = capsule && Number.isFinite(info.windowWidth) && capsule.left > info.windowWidth / 2 ? info.windowWidth - capsule.left + 8 : 96;
    return { statusBarHeight, navigationHeight: Math.max(44, Math.min(64, row)), navigationInset: Math.max(80, Math.min(120, inset)) };
  } catch (_) { return { statusBarHeight: 0, navigationHeight: 44, navigationInset: 96 }; }
}

function neighborCard(item, failedAvatars) {
  const pet = item.pet && typeof item.pet.name === 'string' && ['cat', 'dog', 'other'].includes(item.pet.type) ? { name: item.pet.name, type: item.pet.type } : null;
  const avatar = typeof item.avatar === 'string' ? item.avatar : '';
  const avatarUrl = s.httpsUrl(avatar) || (/^\/assets\/avatar-[0-9]+\.png$/.test(avatar) ? avatar : '');
  return { id: item.id, nickname: item.nickname || '爱宠同好', avatarUrl: failedAvatars[item.id] === avatarUrl ? '' : avatarUrl,
    pet, title: pet ? pet.name : item.nickname || '爱宠同好', petTypeText: pet ? { cat: '猫咪', dog: '狗狗', other: '其他宠物' }[pet.type] : '未展示宠物资料',
    petSymbol: pet ? { cat: '猫', dog: '犬', other: '宠' }[pet.type] : '友',
    areaLabel: item.neighborArea && typeof item.neighborArea.label === 'string' ? item.neighborArea.label : '',
    bio: typeof item.bio === 'string' ? item.bio : '', isFollowing: item.isFollowing === true,
    distanceBand: typeof item.distanceBand === 'string' ? item.distanceBand : '' };
}

function cards(records, page) {
  const result = records.map(record => Object.assign({}, record, presentation(record), {
    statusText: record.timeStatus === 'ended' ? '已结束' : record.timeStatus === 'ongoing' ? '进行中' : '即将举办',
    petText: record.petPolicy && record.petPolicy.text || '带宠规则待确认',
    petStatus: record.petPolicy && record.petPolicy.status || 'unknown',
    playLabels: playTagsFor(record), previewPlayLabels: playTagsFor(record).slice(0, 2), distance: location.distanceFor(record.point),
    photoLabel: record.photo && record.photo.kind === 'poster' ? '原文海报' : record.photo && record.photo.kind === 'photo' ? '原文实拍' : '场馆实景',
    photoMode: record.photo && record.photo.kind === 'poster' ? 'aspectFit' : 'aspectFill',
    photoUrl: page._failedPhotos[record.id] === (record.photo && record.photo.url) ? '' : isLocalScenePhoto(record.photo && record.photo.url) ? record.photo.url : s.httpsUrl(record.photo && record.photo.url)
  }));
  return result;
}

function placeColumnsFor(records) {
  const columns = [{ id: 'left', items: [] }, { id: 'right', items: [] }];
  const sceneNames = { park: '公园散步', waterside: '滨水漫步', commercial: '城市漫游', rest: '随行休息', culture: '自然与文化' };
  const policyPrompts = {
    allowed: '可携宠 · 出发前看完整规则', conditional: '携宠有限制 · 请先看详情',
    not_allowed: '不可携宠 · 参观要求见详情', unknown: '携宠规则待确认 · 先看详情'
  };
  records.forEach((record, index) => {
    const scene = Object.prototype.hasOwnProperty.call(sceneNames, record.placeKind) ? record.placeKind : 'park';
    const hint = typeof record.petHint === 'string' ? record.petHint.trim() : '';
    // A narrow card must not crop "allowed" away from the restriction that follows.
    // Keep short reviewed copy intact; long rules point to the complete detail page.
    const cardPetHint = hint && Array.from(hint).length <= 24 ? hint
      : record.visitWithoutPet ? '不带宠参观 · 参观要求见详情' : policyPrompts[record.petStatus] || policyPrompts.unknown;
    columns[index % 2].items.push({ ...record, cardPetHint,
      cardArea: record.district || record.area || record.city || '位置待确认',
      cardScene: scene, cardSceneLabel: record.categoryLabel || sceneNames[scene],
      cardSceneIcon: '/assets/nearby/icons/scene-' + scene + '.svg'
    });
  });
  return columns;
}

function matchingMeetups(items, query) {
  const words = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (items || []).filter(item => {
    const text = [item.title, item.location, item.hostName, item.petText].join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}

s.register({
  data: {
    loading: true, error: '', mode: '', city: '', isAdmin: false, statusBarHeight: 0, navigationHeight: 44, navigationInset: 96,
    guides: (catalogue.guides || []).map(guide => ({ id: guide.id, title: guide.shortTitle || guide.title, duration: guide.duration, petLabel: guide.petLabel })),
    tab: 'places', region: catalogue.region, checkedAt: catalogue.checkedAt,
    districts: ['全部区域'], districtIndex: 0, selectedDistrict: '', districtSelections: { places: '', activities: '' },
    areas: ['全部片区'], areaIndex: 0, selectedArea: '', playTag: 'all', playChoices: [], sort: 'recommended',
    reference: null, referenceText: '选择距离参照', referencePanel: false, referenceOptions: [],
    searchOpen: false, searchFocused: false, searchText: '', query: '', petFilter: 'all', period: 'upcoming',
    regionOpen: false, filterOpen: false, playOptions: [{ id: 'all', name: '宠物玩法' }], playIndex: 0,
    controlsOpen: false, dropdown: '', dropdownTitle: '', dropdownItems: [], regionGroups: [], regionItems: [], regionGroup: '',
    sortOptions: controls.SORTS.places, sortMenuOptions: controls.SORTS.places.concat({ id: 'help', name: '排序说明' }), sortIndex: 0, sortSelections: { places: 'recommended', activities: 'recommended' },
    filtersByTab: { places: { ...controls.DEFAULT_FILTERS }, activities: { ...controls.DEFAULT_FILTERS } },
    draftFilters: { ...controls.DEFAULT_FILTERS }, draftGroups: [], draftCount: 0, activeFilters: [], filterCount: 0, distanceNote: '',
    kindOptions: ['宠物邻居', '爱宠同好'], neighborPetIndex: 0,
    places: [], displayPlaces: [], placeColumns: [], discoveryCurated: false, showMorePlaces: false, morePlaceCount: 0,
    externalItems: [], announcements: [], hasHistory: false, neighboursOpen: false,
    filter: 'all', items: [], neighbourItems: [], nextCursor: null, moreBusy: false, eventsError: '',
    petFilters: [{ id: 'all', name: '全部' }, { id: 'with', name: '带宠出门' }, { id: 'without', name: '不带宠也能逛' }],
    filters: [{ id: 'all', name: '全部小聚' }, { id: 'none', name: '不用带宠' }, { id: 'dog', name: '可以带狗' }],
    neighborAreaChoices, neighborAreaIndex: 0, neighborKind: 'pets', neighborPetType: 'all',
    neighborPets: [{ id: 'all', name: '全部宠物' }, { id: 'cat', name: '猫咪' }, { id: 'dog', name: '狗狗' }, { id: 'other', name: '其他宠物' }],
    neighbors: [], neighborLoading: false, neighborMoreBusy: false, neighborError: '', neighborNextCursor: null, selfNeighborVisible: false
  },
  onLoad() {
    s.safe(this, navigationSize());
    this._failedPhotos = Object.create(null);
    this._failedNeighborAvatars = Object.create(null);
    this.updateDirectoryOptions();
    this.updateCatalogue();
    return this.refresh();
  },
  onShow() { const wasHidden = this._hidden; this._hidden = false; if (this._loaded || wasHidden) return this.refresh({ retain: true }); },
  onResize() { this.closeControls(); s.safe(this, navigationSize()); },
  onHide() {
    this._hidden = true; this.closeControls(); s.safe(this, { searchFocused: false, filterOpen: false, referencePanel: false });
    this._sortAfterReference = false; this._referenceFromFilters = false; location.cancelPending();
    this._loadId = (this._loadId || 0) + 1; this._moreRequestId = (this._moreRequestId || 0) + 1;
    this._neighborLoadId = (this._neighborLoadId || 0) + 1;
    this._eventRefreshId = 0; this._neighborRefreshId = 0;
  },
  onUnload() { this.closeControls(); location.cancelPending(); this._neighborLoadId = (this._neighborLoadId || 0) + 1; },
  onPullDownRefresh() { return this.refresh(); },
  myPlaces() { this.closeControls(); s.go('/pages/places/index'); },
  openGuide(e) { const id = e.currentTarget.dataset.id; if ((catalogue.guides || []).some(guide => guide.id === id)) s.go('/pages/local-detail/index?guideId=' + encodeURIComponent(id)); },
  managePlaces() { if (this.data.isAdmin) s.go('/pages/places-manage/index'); },
  currentFilters(tab = this.data.tab) {
    const filters = { ...controls.DEFAULT_FILTERS, ...this.data.filtersByTab[tab] };
    if (tab === 'places') filters.petFilter = this.data.petFilter;
    if (tab === 'activities') filters.period = this.data.period;
    return filters;
  },
  candidateCards(tab, filters, includePlay = true) {
    const options = { query: this.data.query, district: this.data.districtSelections[tab], playTag: includePlay ? this.data.playTag : 'all' };
    const records = tab === 'places'
      ? selectNearbyRecords((this._placeRecords || catalogue.records), { ...options, kind: 'place', area: this.data.selectedArea })
      : selectNearbyRecords((this._placeRecords || catalogue.records), { ...options, kind: ['exhibition', 'event'], history: filters.period === 'past' })
        .concat(filters.period === 'upcoming' ? selectAnnouncements((this._placeRecords || catalogue.records), options) : []);
    return cards(records, this);
  },
  updateCatalogue() {
    const reference = location.getReference();
    if (!reference) {
      const filtersByTab = { places: { ...this.data.filtersByTab.places, radius: 'all' }, activities: { ...this.data.filtersByTab.activities, radius: 'all' } };
      const sortSelections = { ...this.data.sortSelections };
      Object.keys(sortSelections).forEach(tab => { if (sortSelections[tab] === 'distance') sortSelections[tab] = 'recommended'; });
      s.safe(this, { filtersByTab, sortSelections, sort: this.data.sort === 'distance' ? 'recommended' : this.data.sort, draftFilters: { ...this.data.draftFilters, radius: 'all' } });
    }
    const placeFilters = this.currentFilters('places'), activityFilters = this.currentFilters('activities');
    const sortFor = tab => tab === this.data.tab ? this.data.sort : this.data.sortSelections[tab];
    const places = controls.sortCards(controls.filterCards(this.candidateCards('places', placeFilters), placeFilters), sortFor('places'), 'places');
    const discovery = splitDiscoveryCards(places, { query: this.data.query, sort: sortFor('places'),
      district: this.data.districtSelections.places, area: this.data.selectedArea, playTag: this.data.playTag, filters: placeFilters });
    const displayPlaces = discovery.featured.concat(discovery.curatedMode && this.data.showMorePlaces ? discovery.more : []);
    const events = controls.sortCards(controls.filterCards(this.candidateCards('activities', activityFilters), activityFilters), sortFor('activities'), 'activities', activityFilters.period === 'past');
    const tab = this.data.tab === 'activities' ? 'activities' : 'places';
    const filters = this.currentFilters(tab);
    const available = this.candidateCards(tab, filters, false);
    const playChoices = PLAY_TAGS.filter(tag => !tag.legacy && available.some(record => playTagsFor(record).some(value => value.id === tag.id)));
    const playOptions = [{ id: 'all', name: '宠物玩法' }].concat(playChoices);
    const activeFilters = controls.activeFilters(tab, filters);
    const shown = tab === 'places' ? places : events;
    const sortOptions = controls.SORTS[tab];
    s.safe(this, {
      reference, referenceText: reference ? (reference.source === 'gps' ? '当前位置' : '手选参照：' + reference.label) : '选择距离参照', playChoices,
      playOptions, playIndex: Math.max(0, playOptions.findIndex(item => item.id === this.data.playTag)),
      sortOptions, sortMenuOptions: sortOptions.concat({ id: 'help', name: '排序说明' }), sortIndex: Math.max(0, sortOptions.findIndex(item => item.id === this.data.sort)),
      activeFilters, filterCount: activeFilters.length,
      distanceNote: this.data.sort === 'distance' && shown.length && !shown.some(item => item.distance) ? '当前结果暂无可计算距离的坐标，先按收录顺序展示。' : '',
      places, discoveryCurated: discovery.curatedMode, morePlaceCount: discovery.more.length,
      displayPlaces, placeColumns: placeColumnsFor(displayPlaces),
      externalItems: events.filter(item => item.timeStatus !== 'undated'), announcements: events.filter(item => item.timeStatus === 'undated'),
      hasHistory: selectNearbyRecords((this._placeRecords || catalogue.records), { kind: ['exhibition', 'event'], district: this.data.districtSelections.activities, history: true }).length > 0,
      neighbourItems: matchingMeetups(this.data.items, this.data.query)
    });
    if (this.data.filterOpen) this.updateFilterPreview();
  },
  updateDistricts() {
    if (this.data.tab === 'neighbors') return;
    const activities = this.data.tab === 'activities';
    const districts = [activities ? '全上海' : '全部区域'].concat(Array.from(new Set((this._placeRecords || catalogue.records)
      .filter(record => activities ? ['event', 'exhibition'].includes(record.type) : record.type === 'place')
      .map(record => record.district).filter(Boolean))));
    const selectedDistrict = this.data.districtSelections[this.data.tab];
    s.safe(this, { districts, selectedDistrict, districtIndex: Math.max(0, districts.indexOf(selectedDistrict)) });
  },
  updateDirectoryOptions() {
    this.closeControls();
    const records = this._placeRecords || catalogue.records;
    const districtSelections = { ...this.data.districtSelections };
    ['places', 'activities'].forEach(tab => {
      const kinds = tab === 'places' ? ['place'] : ['event', 'exhibition'];
      if (!records.some(record => kinds.includes(record.type) && record.district === districtSelections[tab])) districtSelections[tab] = '';
    });
    const preserveArea = districtSelections.places === this.data.districtSelections.places;
    const points = records.filter(record => {
      const point = record.point;
      return point && point.coordinateSystem === 'gcj02' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
    });
    // Synchronize the choices with the accepted directory. A saved origin is a
    // separate user choice and must not move when venue data changes.
    s.safe(this, { districtSelections,
      referenceOptions: [{ id: '', title: '选择一个已核实的地点' }].concat(points.map(record => ({ id: record.id, title: record.title }))) });
    this.updateDistricts();
    this.updateAreas(preserveArea);
  },
  updateAreas(preserveSelection = false) {
    const district = this.data.districtSelections.places;
    const areas = Array.from(new Set((this._placeRecords || catalogue.records).filter(record => record.type === 'place' && (!district || record.district === district)).map(record => record.area).filter(Boolean)));
    const selectedArea = preserveSelection && areas.includes(this.data.selectedArea) ? this.data.selectedArea : '';
    s.safe(this, { areas: ['全部片区'].concat(areas), areaIndex: selectedArea ? areas.indexOf(selectedArea) + 1 : 0, selectedArea });
  },
  acceptViewer(boot, source) {
    const id = boot && boot.user && (boot.user.id || boot.user._id);
    if (typeof id !== 'string' || !id) return false;
    const key = String(boot.mode || '') + ':' + id;
    const changed = !!this._nearbyViewer && this._nearbyViewer !== key;
    this._nearbyViewer = key;
    if (changed) {
      this._eventPageCursors = [null]; this._neighborPageCursors = [null]; this._neighborsLoaded = false;
      if (source === 'neighbors') { this._loadId = (this._loadId || 0) + 1; this._moreRequestId = (this._moreRequestId || 0) + 1; }
      else this._neighborLoadId = (this._neighborLoadId || 0) + 1;
      s.safe(this, { items: [], neighbourItems: [], nextCursor: null, moreBusy: false, neighbors: [], neighborNextCursor: null,
        neighborMoreBusy: false, neighborError: '', selfNeighborVisible: false, isAdmin: false });
    }
    return changed;
  },
  refresh(options) {
    this.closeControls();
    if (this.data.tab === 'neighbors') return this.refreshNeighbors(options);
    this.updateCatalogue();
    const filter = this.data.filter;
    let retain = !!(options && options.retain && this._loaded && this.data.items.length && this._eventFilter === filter);
    const previous = this.data.items.slice(), nextCursor = this.data.nextCursor;
    const cursors = retain ? (this._eventPageCursors || [null]).slice() : [null];
    let refreshId;
    return s.load(this, async () => {
      const request = refreshId = this._loadId;
      this._eventRefreshId = request;
      // Revalidate exactly the pages already opened, without collapsing the
      // visible list to page one or adding new cards above the reading position.
      const [bootResult, initialEvents, directoryResult] = await Promise.all([
        settled(Promise.resolve().then(() => s.api.call('bootstrap'))),
        settled(readPages('listEvents', { filter }, cursors)),
        settled(placeService.listAll({ type: 'all' }))
      ]);
      if (this._closed || request !== this._loadId) return {};
      const boot = bootResult.value;
      const changed = this.acceptViewer(boot, 'events');
      let eventResult = initialEvents;
      if (changed && retain) { retain = false; eventResult = await settled(readPages('listEvents', { filter }, [null])); }
      if (this._closed || request !== this._loadId) return {};
      if (directoryResult.value) { this._placeRecords = directoryResult.value; this.updateDirectoryOptions(); this.updateCatalogue(); }
      const pages = eventResult.value;
      const keepOnError = retain && previous.length > 0;
      const items = pages ? (retain ? refreshedItems(previous, pages, cursors, s.event) : (pages[0].items || []).map(s.event)) : keepOnError ? previous : [];
      if (pages) { this._eventPageCursors = retain ? cursors : [null]; this._eventFilter = filter; }
      if (eventResult.error && keepOnError) s.toast('小聚暂未更新，保留上次浏览内容');
      return {
        mode: boot ? boot.mode : this.data.mode,
        city: boot && boot.settings && boot.settings.city || '',
        isAdmin: boot ? !!(boot.user && boot.user.isAdmin) : this.data.isAdmin,
        selfNeighborVisible: boot ? !!(boot.user && boot.user.neighborVisible) : this.data.selfNeighborVisible,
        items, neighbourItems: matchingMeetups(items, this.data.query),
        nextCursor: retain && (pages || keepOnError) ? nextCursor : pages && pages[0].nextCursor || null,
        placeServiceError: directoryResult.error ? '地点在线更新暂不可用，仍可浏览已保存资料' : '',
        eventsError: eventResult.error && !keepOnError ? eventResult.error.message || '小聚暂时没有连接上，请稍后重试' : ''
      };
    }, { retain }).finally(() => { if (this._eventRefreshId === refreshId) this._eventRefreshId = 0; });
  },
  async loadMore() {
    if (this._closed || this._hidden || this._eventRefreshId && this._eventRefreshId === this._loadId) return;
    const request = this._loadId;
    await s.more(this, { key: 'items', request: async cursor => {
      const result = await s.api.call('listEvents', { filter: this.data.filter, cursor });
      if (!this._closed && request === this._loadId) {
        const cursors = this._eventPageCursors || [null];
        if (!cursors.includes(cursor)) this._eventPageCursors = cursors.concat(cursor);
      }
      return result;
    }, decorate: s.event });
    if (!this._closed && !this._hidden && request === this._loadId) this.updateCatalogue();
  },
  selectFilter(e) {
    const filter = e.currentTarget.dataset.id;
    if (!this.data.filters.some(item => item.id === filter)) return;
    s.safe(this, { filter });
    return this.refresh();
  },
  selectTab(e) {
    const tab = e.currentTarget.dataset.id;
    if (!['places', 'activities', 'neighbors'].includes(tab)) return;
    if (this.data.busy) return;
    this.closeControls();
    const searchState = tab !== this.data.tab ? { searchOpen: false, searchFocused: false, searchText: '', query: '' } : {};
    this._sortAfterReference = false;
    if (tab !== this.data.tab && this.data.searchOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    this._neighborLoadId = (this._neighborLoadId || 0) + 1;
    this._referenceFromFilters = false;
    s.safe(this, { tab, sort: this.data.sortSelections[tab] || 'recommended', playTag: 'all', regionOpen: false, filterOpen: false, referencePanel: false, neighborLoading: false, neighborMoreBusy: false, ...searchState });
    if (tab === 'neighbors') return this.refreshNeighbors();
    this.updateDistricts();
    this.updateCatalogue();
  },
  selectDistrict(e) {
    if (this.data.tab === 'neighbors') return;
    const index = Number(e.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.districts.length) return;
    const selectedDistrict = index ? this.data.districts[index] : '';
    s.safe(this, { districtIndex: index, selectedDistrict, districtSelections: { ...this.data.districtSelections, [this.data.tab]: selectedDistrict }, playTag: 'all' });
    if (this.data.tab === 'places') this.updateAreas();
    this.updateCatalogue();
  },
  selectPlayTag(e) {
    const playTag = e.currentTarget.dataset.id;
    if (playTag !== 'all' && !this.data.playChoices.some(tag => tag.id === playTag)) return;
    s.safe(this, { playTag }); this.updateCatalogue();
  },
  toggleControls() {
    if (this._closed || this._hidden || this.data.busy) return;
    if (this.data.controlsOpen) return this.closeControls();
    this.closeDropdown();
    this._controlsTab = this.data.tab;
    this._sortAfterReference = false;
    this._referenceFromFilters = false;
    if (this.data.searchOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    s.safe(this, { controlsOpen: true, searchOpen: false, searchFocused: false, searchText: this.data.query, filterOpen: false, referencePanel: false });
  },
  closeControls() {
    this._controlsTab = '';
    this.closeDropdown();
    s.safe(this, { controlsOpen: false });
  },
  openControl(e) {
    if (this._closed || this._hidden || this.data.busy || !this.data.controlsOpen || this._controlsTab !== this.data.tab || this.data.dropdown) return;
    return this.toggleDropdown(e);
  },
  backToControls() {
    if (this._closed || this._hidden || this.data.busy || !this.data.controlsOpen || this._controlsTab !== this.data.tab) return;
    this.closeDropdown();
  },
  chooseControlItem(e) {
    if (this._closed || this._hidden || this.data.busy || !this.data.controlsOpen || this._controlsTab !== this.data.tab ||
      this._dropdownTab !== this.data.tab || !this.data.dropdown || !this.data.dropdownItems.some(item => item.id === e.currentTarget.dataset.id)) return;
    const result = this.selectDropdownItem(e);
    this.closeControls();
    return result;
  },
  chooseControlRegion(e) {
    if (this._closed || this._hidden || this.data.busy || !this.data.controlsOpen || this._controlsTab !== this.data.tab ||
      this._dropdownTab !== this.data.tab || this.data.dropdown !== 'region' || !(this._regionChoices || []).some(item => item.id === e.currentTarget.dataset.id)) return;
    const result = this.selectRegionItem(e);
    this.closeControls();
    return result;
  },
  openAdvancedFilters() {
    if (this._closed || this._hidden || this.data.busy || !this.data.controlsOpen || this._controlsTab !== this.data.tab || this.data.dropdown || this.data.tab === 'neighbors') return;
    this.closeControls();
    return this.toggleFilters();
  },
  closeDropdown() {
    this._dropdownTab = '';
    this._regionChoices = [];
    s.safe(this, { dropdown: '', dropdownTitle: '', dropdownItems: [], regionOpen: false, regionGroups: [], regionItems: [], regionGroup: '' });
  },
  toggleDropdown(e) {
    const menu = e.currentTarget.dataset.menu;
    const tab = this.data.tab;
    if (this._closed || this._hidden || this.data.busy || !(tab === 'neighbors' ? ['region', 'kind', 'pet'] : ['region', 'sort', 'play']).includes(menu) ||
      menu === 'pet' && this.data.neighborKind !== 'pets') return;
    if (this.data.dropdown === menu) return this.closeDropdown();
    this.closeDropdown();
    this._sortAfterReference = false;
    this._referenceFromFilters = false;
    this._dropdownTab = tab;
    if (this.data.searchOpen && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    const dropdownTitle = { region: '选择区域', sort: '排序方式', play: '宠物玩法', kind: '发现宠友', pet: '宠物种类' }[menu];
    s.safe(this, { dropdown: menu, dropdownTitle, regionOpen: menu === 'region', filterOpen: false, referencePanel: false,
      searchOpen: false, searchFocused: false, searchText: this.data.query });
    if (menu === 'region') {
      if (tab !== 'neighbors') this.updateDistricts();
      if (tab === 'activities') {
        return s.safe(this, { dropdownItems: this.data.districts.map((label, index) => ({ id: dropdownId(tab, 'region', index ? label : ''),
          label, selected: this.data.districtSelections.activities === (index ? label : '') })) });
      }
      const selected = tab === 'neighbors' ? neighborAreaChoices[this.data.neighborAreaIndex].district || '' : this.data.districtSelections.places;
      return this.updateRegionDropdown(selected);
    }
    const options = menu === 'sort' ? this.data.sortMenuOptions : menu === 'play' ? this.data.playOptions
      : menu === 'kind' ? [{ id: 'pets', name: this.data.kindOptions[0] }, { id: 'people', name: this.data.kindOptions[1] }] : this.data.neighborPets;
    const selected = menu === 'sort' ? this.data.sort : menu === 'play' ? this.data.playTag : menu === 'kind' ? this.data.neighborKind : this.data.neighborPetType;
    s.safe(this, { dropdownItems: options.map(item => ({ id: dropdownId(tab, menu, item.id), label: menu === 'play' && item.id === 'all' ? '全部玩法' : item.name,
      selected: item.id === selected, ...(menu === 'sort' && item.id === 'distance' && !location.getReference() ? { hint: '先选择距离参照' } : {}) })) });
  },
  updateRegionDropdown(district) {
    const tab = this.data.tab;
    if (this.data.dropdown !== 'region' || this._dropdownTab !== tab || tab === 'activities') return;
    const districts = tab === 'neighbors' ? Array.from(new Set(neighborAreas.map(item => item.district))) : this.data.districts.slice(1);
    if (district && !districts.includes(district)) district = '';
    const selectedArea = tab === 'neighbors' ? neighborAreaChoices[this.data.neighborAreaIndex].id : this.data.selectedArea;
    const selectedDistrict = tab === 'neighbors' ? neighborAreaChoices[this.data.neighborAreaIndex].district || '' : this.data.districtSelections.places;
    const choices = !district ? [{ value: '', label: '全上海', district: '', selected: !selectedDistrict && !selectedArea }]
      : tab === 'neighbors' ? neighborAreas.filter(item => item.district === district).map(item => ({ value: item.id,
        label: item.area || '整个' + district, district, selected: selectedArea === item.id }))
      : [{ value: '', label: '整个' + district, district, selected: selectedDistrict === district && !selectedArea }].concat(
        Array.from(new Set((this._placeRecords || catalogue.records).filter(item => item.type === 'place' && item.district === district).map(item => item.area).filter(Boolean)))
          .map(area => ({ value: area, label: area, district, selected: selectedDistrict === district && selectedArea === area })));
    this._regionChoices = choices.map(item => ({ ...item, id: dropdownId(tab, 'area', JSON.stringify([district, item.value])) }));
    s.safe(this, { regionGroup: district,
      regionGroups: [{ id: dropdownId(tab, 'district', ''), label: '全上海', selected: !district }].concat(districts.map(value => ({ id: dropdownId(tab, 'district', value), label: value, selected: value === district }))),
      regionItems: this._regionChoices.map(({ id, label, selected }) => ({ id, label, selected })) });
  },
  selectRegionGroup(e) {
    const tab = this.data.tab;
    const id = e.currentTarget.dataset.id;
    if (this._closed || this._hidden || this.data.busy || this.data.dropdown !== 'region' || this._dropdownTab !== tab ||
      !this.data.regionGroups.some(item => item.id === id)) return;
    const district = id.slice(dropdownId(tab, 'district', '').length);
    this.updateRegionDropdown(district);
  },
  selectRegionItem(e) {
    const tab = this.data.tab;
    const choice = (this._regionChoices || []).find(item => item.id === e.currentTarget.dataset.id);
    if (this._closed || this._hidden || this.data.busy || this.data.dropdown !== 'region' || this._dropdownTab !== tab || !choice) return;
    this.closeDropdown();
    if (tab === 'neighbors') {
      const index = neighborAreaChoices.findIndex(item => item.id === choice.value);
      if (index >= 0) return this.selectNeighborArea({ detail: { value: index } });
      return;
    }
    if (tab !== 'places') return;
    const districtIndex = choice.district ? this.data.districts.indexOf(choice.district) : 0;
    if (districtIndex < 0) return;
    this.selectDistrict({ detail: { value: districtIndex } });
    if (choice.value) {
      const areaIndex = this.data.areas.indexOf(choice.value);
      if (areaIndex > 0) this.selectArea({ detail: { value: areaIndex } });
    }
  },
  selectDropdownItem(e) {
    const tab = this.data.tab;
    const menu = this.data.dropdown;
    const id = e.currentTarget.dataset.id;
    if (this._closed || this._hidden || this.data.busy || this._dropdownTab !== tab || !menu || !this.data.dropdownItems.some(item => item.id === id)) return;
    const value = id.slice(dropdownId(tab, menu, '').length);
    this.closeDropdown();
    if (menu === 'region' && tab === 'activities') {
      const index = value ? this.data.districts.indexOf(value) : 0;
      if (index >= 0) return this.selectDistrict({ detail: { value: index } });
    }
    const itemEvent = { currentTarget: { dataset: { id: value } } };
    if (menu === 'sort') return value === 'help' ? this.showSortHelp() : this.selectSort(itemEvent);
    if (menu === 'play') return this.selectPlayTag(itemEvent);
    if (menu === 'kind') return this.selectNeighborKind(itemEvent);
    if (menu === 'pet') return this.selectNeighborPet(itemEvent);
  },
  toggleRegion() { return this.toggleDropdown({ currentTarget: { dataset: { menu: 'region' } } }); },
  toggleFilters() {
    this.closeControls();
    this._sortAfterReference = false;
    this._referenceFromFilters = false;
    s.safe(this, { filterOpen: !this.data.filterOpen, regionOpen: false, referencePanel: false, draftFilters: this.currentFilters() });
    if (this.data.filterOpen) this.updateFilterPreview();
  },
  updateFilterPreview() {
    const tab = this.data.tab;
    if (tab === 'neighbors') return;
    const filters = this.data.draftFilters;
    const count = values => controls.filterCards(this.candidateCards(tab, values), values).length;
    const draftGroups = controls.groupsFor(tab, filters).map(group => ({ key: group.key, title: group.title,
      choices: group.choices.map(([id, name]) => {
        const candidate = { ...filters, [group.key]: id };
        if (group.key === 'period' && id === 'past') candidate.dateRange = 'all';
        const disabled = group.key === 'radius' && id !== 'all' && !location.getReference();
        return { id, name, selected: filters[group.key] === id, disabled, count: disabled ? null : count(candidate) };
      })
    }));
    s.safe(this, { draftGroups, draftCount: count(filters) });
  },
  selectDraftFilter(e) {
    const { key, value } = e.currentTarget.dataset;
    const group = controls.groupsFor(this.data.tab, this.data.draftFilters).find(item => item.key === key);
    const choice = group && group.choices.find(item => String(item[0]) === String(value));
    if (!choice || (key === 'radius' && choice[0] !== 'all' && !location.getReference())) return;
    const draftFilters = { ...this.data.draftFilters, [key]: choice[0] };
    if (key === 'period' && choice[0] === 'past') draftFilters.dateRange = 'all';
    s.safe(this, { draftFilters }); this.updateFilterPreview();
  },
  resetDraftFilters() { s.safe(this, { draftFilters: { ...controls.DEFAULT_FILTERS } }); this.updateFilterPreview(); },
  applyFilters() { this.commitFilters(this.data.draftFilters); },
  commitFilters(filters) {
    const tab = this.data.tab;
    if (tab === 'neighbors') return;
    const next = { ...filters, radius: location.getReference() ? filters.radius : 'all' };
    s.safe(this, { filtersByTab: { ...this.data.filtersByTab, [tab]: next }, filterOpen: false,
      ...(tab === 'places' ? { petFilter: next.petFilter } : { period: next.period, playTag: next.period !== this.data.period ? 'all' : this.data.playTag }) });
    this.updateCatalogue();
  },
  removeFilter(e) {
    const key = e.currentTarget.dataset.key;
    if (!controls.FILTER_GROUPS.some(group => group.key === key)) return;
    this.commitFilters({ ...this.currentFilters(), [key]: controls.DEFAULT_FILTERS[key] });
  },
  resetCatalogueFilters() { this.commitFilters({ ...controls.DEFAULT_FILTERS }); },
  stopPanelTap() {},
  showSortHelp() { wx.showModal({ title: this.data.sortOptions[this.data.sortIndex].name, content: controls.SORT_HELP[this.data.sort], showCancel: false, confirmText: '知道了' }); },
  selectPlayChoice(e) {
    const choice = this.data.playOptions[Number(e.detail.value)];
    if (choice) this.selectPlayTag({ currentTarget: { dataset: { id: choice.id } } });
  },
  selectSortChoice(e) {
    const index = Number(e.detail.value);
    if (!Number.isInteger(index) || index < 0) return;
    if (index === this.data.sortOptions.length) {
      s.safe(this, { sortIndex: Math.max(0, this.data.sortOptions.findIndex(item => item.id === this.data.sort)) });
      return this.showSortHelp();
    }
    const sort = this.data.sortOptions[index];
    if (sort) return this.selectSort({ currentTarget: { dataset: { id: sort.id } } });
  },
  selectPeriodChoice(e) {
    const period = ['upcoming', 'past'][Number(e.detail.value)];
    if (period) this.selectPeriod({ currentTarget: { dataset: { id: period } } });
  },
  selectSort(e) {
    const sort = e.currentTarget.dataset.id;
    if (!(controls.SORTS[this.data.tab] || []).some(item => item.id === sort)) return;
    this._sortAfterReference = false;
    if (sort === 'distance' && !location.getReference()) { this._sortAfterReference = true; return this.openReferenceMenu(); }
    s.safe(this, { sort, sortSelections: { ...this.data.sortSelections, [this.data.tab]: sort } }); this.updateCatalogue();
  },
  openReferenceMenu() {
    if (this._closed || this._hidden) return;
    this._referenceFromFilters = this.data.filterOpen;
    this.closeControls();
    return s.action(this, async () => {
      const choices = [{ name: '使用当前位置', action: 'gps' }];
      if (typeof wx.chooseLocation === 'function') choices.push({ name: '在地图上选择参照', action: 'map' });
      choices.push({ name: '选择已核实地点作为参照', action: 'known' });
      if (location.getReference()) choices.push({ name: '清除距离参照', action: 'clear' });
      const index = await s.choose(choices.map(item => item.name));
      if (this._closed || this._hidden || !choices[index]) { this._sortAfterReference = false; return; }
      const action = choices[index].action;
      if (action === 'known') return s.safe(this, { referencePanel: true, filterOpen: false });
      if (action === 'clear') { location.clearReference(); this._sortAfterReference = false; this.updateCatalogue(); return; }
      try { await (action === 'gps' ? location.locate() : location.chooseReference()); }
      catch (error) { if (['LOCATION_CANCELLED', 'LOCATION_STALE'].includes(error.code)) { this._sortAfterReference = false; return; } throw error; }
      if (!this._closed && !this._hidden) this.referenceChanged();
    });
  },
  selectKnownReference(e) {
    if (this._closed || this._hidden) return;
    return s.action(this, () => {
      const choice = this.data.referenceOptions[Number(e.detail.value)];
      const record = choice && (this._placeRecords || catalogue.records).find(item => item.id === choice.id);
      if (!record || !record.point) return;
      location.setManualReference(record.point, record.title); this.referenceChanged();
    });
  },
  referenceChanged() {
    this.closeControls();
    const sort = this._sortAfterReference ? 'distance' : this.data.sort;
    s.safe(this, { referencePanel: false, filterOpen: !!this._referenceFromFilters, sort, sortSelections: { ...this.data.sortSelections, [this.data.tab]: sort } });
    this._referenceFromFilters = false;
    this._sortAfterReference = false; this.updateCatalogue();
  },
  closeReferencePanel() { s.safe(this, { referencePanel: false, filterOpen: !!this._referenceFromFilters }); this._referenceFromFilters = false; this._sortAfterReference = false; },
  photoFailed(e) {
    const id = e.currentTarget.dataset.id;
    const record = (this._placeRecords || catalogue.records).find(item => item.id === id);
    if (record && record.photo) { this._failedPhotos[id] = record.photo.url; this.updateCatalogue(); }
  },
  toggleMorePlaces() { s.safe(this, { showMorePlaces: !this.data.showMorePlaces }); this.updateCatalogue(); },
  selectArea(e) {
    const index = Number(e.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.areas.length) return;
    s.safe(this, { areaIndex: index, selectedArea: index === 0 ? '' : this.data.areas[index], playTag: 'all' });
    this.updateCatalogue();
  },
  selectPetFilter(e) {
    const petFilter = e.currentTarget.dataset.id;
    if (!this.data.petFilters.some(item => item.id === petFilter)) return;
    s.safe(this, { petFilter, playTag: 'all', filtersByTab: { ...this.data.filtersByTab, places: { ...this.data.filtersByTab.places, petFilter } } });
    this.updateCatalogue();
  },
  selectPeriod(e) {
    const period = e.currentTarget.dataset.id;
    if (!['upcoming', 'past'].includes(period)) return;
    s.safe(this, { period, playTag: 'all' });
    this.updateCatalogue();
  },
  openSearch() {
    if (this._closed || this._hidden) return;
    this.closeControls();
    this._sortAfterReference = false;
    this._referenceFromFilters = false;
    s.safe(this, { searchOpen: true, searchFocused: true, searchText: this.data.query, referencePanel: false, regionOpen: false, filterOpen: false });
  },
  focusSearch() { s.safe(this, { searchFocused: true }); },
  blurSearch() { s.safe(this, { searchFocused: false }); },
  inputSearch(e) { s.safe(this, { searchText: e.detail.value || '' }); },
  search() {
    const query = this.data.searchText.trim();
    s.safe(this, { searchText: query, query, searchFocused: false });
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    return this.data.tab === 'neighbors' ? this.refreshNeighbors() : this.updateCatalogue();
  },
  clearSearch() {
    s.safe(this, { searchText: '', query: '', searchFocused: this.data.searchOpen });
    return this.data.tab === 'neighbors' ? this.refreshNeighbors() : this.updateCatalogue();
  },
  cancelSearch() {
    const hadQuery = !!this.data.query;
    s.safe(this, { searchOpen: false, searchFocused: false, searchText: '', query: '' });
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    if (hadQuery) return this.data.tab === 'neighbors' ? this.refreshNeighbors() : this.updateCatalogue();
  },
  resetPlaces() {
    s.safe(this, { districtSelections: { ...this.data.districtSelections, places: '' }, filtersByTab: { ...this.data.filtersByTab, places: { ...controls.DEFAULT_FILTERS } }, areaIndex: 0, selectedArea: '', petFilter: 'all', playTag: 'all', searchText: '', query: '' });
    this.updateDistricts();
    this.updateAreas();
    this.updateCatalogue();
  },
  toggleNeighbours() { s.safe(this, { neighboursOpen: !this.data.neighboursOpen }); },
  neighborQuery() { return { areaId: neighborAreaChoices[this.data.neighborAreaIndex].id, kind: this.data.neighborKind, petType: this.data.neighborKind === 'pets' ? this.data.neighborPetType : 'all', query: this.data.query }; },
  async refreshNeighbors(options) {
    const request = this._neighborLoadId = (this._neighborLoadId || 0) + 1;
    this._neighborRefreshId = request;
    const query = this.neighborQuery(), queryKey = JSON.stringify(query);
    let retain = !!(options && options.retain && this._neighborsLoaded && this.data.neighbors.length && this._neighborQueryKey === queryKey);
    const previous = this.data.neighbors.slice(), nextCursor = this.data.neighborNextCursor;
    const cursors = retain ? (this._neighborPageCursors || [null]).slice() : [null];
    s.safe(this, retain ? { neighborLoading: false, neighborMoreBusy: false, neighborError: '' }
      : { neighborLoading: true, neighborMoreBusy: false, neighborError: '', neighborNextCursor: null, neighbors: [] });
    const current = () => !this._closed && !this._hidden && request === this._neighborLoadId && this.data.tab === 'neighbors';
    try {
      const [initial, bootResult] = await Promise.all([settled(readPages('listNeighbors', query, cursors)), settled(Promise.resolve().then(() => s.api.call('bootstrap')))]);
      if (!current()) return;
      const boot = bootResult.value;
      const changed = this.acceptViewer(boot, 'neighbors');
      let result = initial;
      if (changed && retain) { retain = false; s.safe(this, { neighborLoading: true }); result = await settled(readPages('listNeighbors', query, [null])); }
      if (!current()) return;
      if (boot) s.safe(this, { mode: boot.mode, selfNeighborVisible: !!(boot.user && boot.user.neighborVisible), isAdmin: !!(boot.user && boot.user.isAdmin) });
      if (result.error) throw result.error;
      const pages = result.value;
      const decorate = item => neighborCard(item, this._failedNeighborAvatars);
      s.safe(this, { neighbors: retain ? refreshedItems(previous, pages, cursors, decorate) : (pages[0].items || []).map(decorate),
        neighborNextCursor: retain ? nextCursor : pages[0].nextCursor || null });
      this._neighborPageCursors = retain ? cursors : [null]; this._neighborQueryKey = queryKey; this._neighborsLoaded = true;
    } catch (error) {
      if (current()) {
        if (retain && previous.length) s.toast('宠友列表暂未更新，保留上次浏览内容');
        else s.safe(this, { neighborError: error.message || '宠友列表暂时没有连接上，请稍后重试' });
      }
    } finally {
      if (this._neighborRefreshId === request) this._neighborRefreshId = 0;
      if (!this._closed && request === this._neighborLoadId) { s.safe(this, { neighborLoading: false }); if (wx.stopPullDownRefresh) wx.stopPullDownRefresh(); }
    }
  },
  async loadMoreNeighbors() {
    if (this._closed || this._hidden || this._neighborRefreshId && this._neighborRefreshId === this._neighborLoadId) return;
    if (this.data.neighborLoading || this.data.neighborMoreBusy || !this.data.neighborNextCursor || this.data.tab !== 'neighbors') return;
    const request = this._neighborLoadId;
    const query = { ...this.neighborQuery(), cursor: this.data.neighborNextCursor };
    s.safe(this, { neighborMoreBusy: true });
    try {
      const result = await s.api.call('listNeighbors', query);
      if (this._closed || this._hidden || request !== this._neighborLoadId || this.data.tab !== 'neighbors') return;
      const neighbors = this.data.neighbors.slice();
      (result.items || []).map(item => neighborCard(item, this._failedNeighborAvatars)).forEach(item => {
        const index = neighbors.findIndex(value => value.id === item.id);
        if (index >= 0) neighbors[index] = item; else neighbors.push(item);
      });
      const cursors = this._neighborPageCursors || [null];
      if (!cursors.includes(query.cursor)) this._neighborPageCursors = cursors.concat(query.cursor);
      s.safe(this, { neighbors, neighborNextCursor: result.nextCursor || null });
    } catch (error) {
      if (!this._closed && !this._hidden && request === this._neighborLoadId) s.toast(error.message || '加载未完成，请重试');
    } finally { if (!this._closed && request === this._neighborLoadId) s.safe(this, { neighborMoreBusy: false }); }
  },
  selectNeighborArea(e) {
    const index = Number(e.detail.value);
    if (this.data.busy || !Number.isInteger(index) || index < 0 || index >= neighborAreaChoices.length) return;
    s.safe(this, { neighborAreaIndex: index }); return this.refreshNeighbors();
  },
  selectNeighborKind(e) {
    const kind = e.currentTarget.dataset.id;
    if (this.data.busy || !['pets', 'people'].includes(kind)) return;
    s.safe(this, { neighborKind: kind }); return this.refreshNeighbors();
  },
  selectNeighborKindChoice(e) {
    const kind = ['pets', 'people'][Number(e.detail.value)];
    if (kind) return this.selectNeighborKind({ currentTarget: { dataset: { id: kind } } });
  },
  selectNeighborPetChoice(e) {
    const pet = this.data.neighborPets[Number(e.detail.value)];
    if (pet) return this.selectNeighborPet({ currentTarget: { dataset: { id: pet.id } } });
  },
  selectNeighborPet(e) {
    const petType = e.currentTarget.dataset.id;
    if (this.data.busy || !this.data.neighborPets.some(item => item.id === petType)) return;
    s.safe(this, { neighborPetType: petType, neighborPetIndex: this.data.neighborPets.findIndex(item => item.id === petType) }); return this.refreshNeighbors();
  },
  resetNeighborFilters() {
    s.safe(this, { query: '', searchText: '', searchFocused: false, neighborAreaIndex: 0, neighborPetType: 'all', neighborPetIndex: 0 });
    return this.refreshNeighbors();
  },
  neighborEmptyAction() {
    if (this.data.query || this.data.neighborAreaIndex || (this.data.neighborKind === 'pets' && this.data.neighborPetType !== 'all')) return this.resetNeighborFilters();
    return this.data.selfNeighborVisible ? this.refreshNeighbors() : this.editNeighborProfile();
  },
  openNeighbor(e) {
    const item = this.data.neighbors.find(value => value.id === e.currentTarget.dataset.id);
    if (item) s.go('/pages/author/index?userId=' + encodeURIComponent(item.id));
  },
  followNeighbor(e) {
    const item = this.data.neighbors.find(value => value.id === e.currentTarget.dataset.id);
    if (!item) return;
    return s.action(this, async () => {
      const follow = !item.isFollowing;
      if (!follow && !await s.confirm('取消关注「' + item.nickname + '」？', '取消后，该账号的日常将不再出现在关注列表中。', '取消关注')) return;
      await s.api.call('followUser', { userId: item.id, follow });
      if (!this._closed && this.data.tab === 'neighbors') await this.refreshNeighbors();
    });
  },
  neighborAvatarFailed(e) {
    const item = this.data.neighbors.find(value => value.id === e.currentTarget.dataset.id);
    if (!item) return;
    this._failedNeighborAvatars[item.id] = item.avatarUrl;
    s.safe(this, { neighbors: this.data.neighbors.map(value => value.id === item.id ? { ...value, avatarUrl: '' } : value) });
  },
  editNeighborProfile() { this.closeControls(); s.go('/pages/profile/index'); },
  openLocal(e) {
    const id = e.currentTarget.dataset.id;
    if (!(this._placeRecords || catalogue.records).some(record => record.id === id)) return;
    s.go('/pages/local-detail/index?id=' + encodeURIComponent(id));
  },
  openEvent(e) { s.go('/pages/event/index?id=' + encodeURIComponent(e.currentTarget.dataset.id)); },
  manage() { s.go('/pages/manage/index'); },
  onShareAppMessage() { return { title: '有宠有邻｜从莘庄出发，找个喜欢的地方', path: '/pages/nearby/index' }; }
});
