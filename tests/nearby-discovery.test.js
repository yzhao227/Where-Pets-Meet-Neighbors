'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shared = require('../miniprogram/pages/_shared');
const utils = require('../miniprogram/data/nearby-utils');
const controls = require('../miniprogram/data/nearby-controls');
const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/nearby/index.js'), 'utf8');
const now = Date.parse('2026-09-29T12:00:00+08:00');

function fixture(t) {
  const records = [
    { id: 'fixture-far', type: 'place', title: '仅测试草地', district: '闵行', area: '莘庄', playTags: ['walk', 'lawn'], petPlayTags: ['walk', 'lawn'], petPolicy: { status: 'conditional', text: '仅测试牵绳准入规则' }, placeKind: 'park', feeType: 'free', point: { latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' }, photo: { url: 'https://example.invalid/park.jpg' } },
    { id: 'fixture-near', type: 'place', title: '仅测试商场', district: '徐汇', area: '西岸', playTags: ['hangout'], petPlayTags: ['hangout'], petPolicy: { status: 'allowed', text: '仅测试允许携宠规则' }, placeKind: 'commercial', feeType: 'paid', point: { latitude: 31.2, longitude: 121.4, coordinateSystem: 'gcj02' } },
    { id: 'fixture-unknown', type: 'place', title: '仅测试无坐标', district: '闵行', area: '梅陇', playTags: ['walk'], petPlayTags: [], placeKind: 'waterside' },
    { id: 'fixture-show', type: 'exhibition', title: '仅测试定期展', district: '徐汇', area: '西岸', playTags: ['exhibition'], petPlayTags: [], feeType: 'paid', startsAt: '2026-10-01T09:00:00+08:00', endsAt: '2026-10-01T17:00:00+08:00' },
    { id: 'fixture-notice', type: 'exhibition', title: '仅测试月预告', district: '闵行', area: '莘庄', playTags: ['exhibition'], petPlayTags: [], announcementMonth: '2027-04' }
  ].map(record => ({ city: '仅测试城市', summary: '仅内存测试内容', petPolicy: { status: 'unknown', text: '待确认' }, feeType: 'unknown', noPetRequired: true, ...record }));
  const state = { reference: null, locationCalls: 0, toasts: [], modals: [], choice: 1, cancelled: 0, writes: 0, calls: [] };
  const previous = { wx: global.wx, Page: global.Page, call: shared.api.call };
  global.wx = {
    showToast: options => state.toasts.push(options.title), showModal: options => state.modals.push(options), stopPullDownRefresh() {},
    showActionSheet: options => options.success({ tapIndex: state.choice })
  };
  shared.api.call = async action => { state.calls.push(action); throw new Error('仅测试后端不可用'); };
  const location = {
    getReference: () => state.reference,
    distanceFor: point => state.reference && point ? { meters: point.latitude === 31.1 ? 2000 : 800, label: point.latitude === 31.1 ? '约 2.0 km' : '约 800 m', referenceLabel: state.reference.label } : null,
    locate: async () => { state.locationCalls += 1; state.reference = { source: 'gps', label: '当前位置' }; },
    chooseReference: async () => {},
    setManualReference: (point, label) => { state.reference = { ...point, source: 'manual', label }; },
    clearReference: () => { state.reference = null; },
    cancelPending: () => { state.cancelled += 1; }
  };
  let definition;
  global.Page = value => { definition = value; };
  vm.runInNewContext(source, { wx: global.wx, require(request) {
    if (request === '../_shared') return shared;
    if (request === './presentation') return require('../miniprogram/pages/nearby/presentation');
    if (request === './discovery-quality') return require('../miniprogram/pages/nearby/discovery-quality');
    if (request === '../../services/nearby-location') return location;
    if (request === '../../services/places') return { listAll: async () => { state.calls.push('listPlaces'); if (!state.directory) throw new Error('仅测试地点服务不可用'); return structuredClone(state.directory); } };
    if (request === '../../data/nearby-catalogue') return { records, region: '仅测试区域', checkedAt: '2026-09-29' };
    if (request === '../../data/neighbor-areas') return require('../miniprogram/data/neighbor-areas');
    if (request === '../../data/nearby-controls') return { ...controls,
      filterCards: (items, settings) => controls.filterCards(items, settings, now)
    };
    if (request === '../../data/nearby-utils') return { ...utils,
      selectNearbyRecords: (items, options) => utils.selectNearbyRecords(items, { ...options, now }),
      selectAnnouncements: (items, options) => utils.selectAnnouncements(items, { ...options, now })
    };
    throw Error('Unexpected dependency: ' + request);
  } });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { if (this._closed) state.writes += 1; Object.assign(this.data, value); } };
  t.after(() => { global.wx = previous.wx; global.Page = previous.Page; shared.api.call = previous.call; });
  return { page, state, location, records };
}
const event = id => ({ currentTarget: { dataset: { id } } });
const choice = value => ({ detail: { value } });
const draftChoice = (key, value) => ({ currentTarget: { dataset: { key, value } } });
const removeChoice = key => ({ currentTarget: { dataset: { key } } });
const menu = value => ({ currentTarget: { dataset: { menu: value } } });
const itemNamed = (items, label) => event(items.find(item => item.label === label).id);

test('the online directory replaces edited and withdrawn local entries without registering attendance or locating', async t => {
  const { page, state, records } = fixture(t);
  state.directory = records.filter(item => item.id !== 'fixture-far').map(item => item.id === 'fixture-near' ? { ...item, title: '运营者已更新的公开地点' } : item);
  await page.onLoad();
  assert.equal(page.data.places.some(item => item.id === 'fixture-far'), false, 'a withdrawn server entry cannot reappear from the fallback catalogue');
  assert.equal(page.data.places.find(item => item.id === 'fixture-near').title, '运营者已更新的公开地点');
  assert.equal(state.locationCalls, 0);
  assert.ok(state.calls.every(action => ['bootstrap', 'listEvents', 'listPlaces'].includes(action)), 'directory reads cannot register attendance or publish a visit');
  state.directory = null;
  await page.refresh();
  assert.equal(page.data.places.some(item => item.id === 'fixture-far'), false, 'a later service outage preserves the last accepted directory');
  assert.ok(page.data.placeServiceError);
});

test('directory updates preserve valid scopes, clear removed scopes and refresh map choices without moving the chosen origin', async t => {
  const { page, records, state, location } = fixture(t);
  state.directory = structuredClone(records);
  await page.onLoad();
  page.selectDistrict(choice(page.data.districts.indexOf('闵行')));
  page.selectArea(choice(page.data.areas.indexOf('莘庄')));
  location.setManualReference(records[0].point, '仅测试手选出发点');
  const origin = structuredClone(state.reference);
  page.selectTab(event('activities'));
  page.selectDistrict(choice(page.data.districts.indexOf('徐汇')));
  page.selectTab(event('places'));
  const added = { ...structuredClone(records[0]), id: 'fixture-new-map', title: '新增已核实地点', point: { latitude: 31.3, longitude: 121.5, coordinateSystem: 'gcj02', precision: 'venue', sourceUrl: 'https://example.invalid/new-map' } };
  state.directory = records.filter(item => item.id !== 'fixture-near').map(item => item.id === 'fixture-far'
    ? { ...item, title: '已更名的公开地点', point: { ...item.point, latitude: 31.15 } } : item).concat(added);
  await page.refresh();
  assert.equal(page.data.selectedDistrict, '闵行');
  assert.equal(page.data.selectedArea, '莘庄', 'an online refresh preserves a still valid neighbourhood');
  assert.equal(page.data.areas[page.data.areaIndex], '莘庄');
  assert.equal(page.data.districtSelections.activities, '徐汇');
  assert.equal(page.data.referenceOptions.find(item => item.id === 'fixture-far').title, '已更名的公开地点');
  assert.equal(page.data.referenceOptions.some(item => item.id === 'fixture-near'), false, 'withdrawn choices cannot remain selectable');
  assert.equal(page.data.referenceOptions.some(item => item.id === added.id), true, 'new verified coordinates become available without reloading the page');
  assert.deepEqual(state.reference, origin, 'editing a venue cannot silently move the user-selected origin');

  state.directory = [{ ...added, district: '长宁', area: '虹桥' }, { ...records[3], district: '静安', area: '北站' }];
  await page.refresh();
  assert.deepEqual(structuredClone(page.data.districtSelections), { places: '', activities: '' });
  assert.equal(page.data.selectedDistrict, '');
  assert.equal(page.data.districtIndex, 0);
  assert.equal(page.data.selectedArea, '');
  assert.equal(page.data.areaIndex, 0);
  assert.deepEqual(Array.from(page.data.areas), ['全部片区', '虹桥']);
  assert.deepEqual(Array.from(page.data.places, item => item.id), [added.id], 'an invisible withdrawn region cannot keep the list empty');
  assert.deepEqual(Array.from(page.data.referenceOptions, item => item.id), ['', added.id]);
  assert.deepEqual(state.reference, origin, 'removing the original venue updates choices without clearing the saved origin');
  page.selectTab(event('activities'));
  assert.equal(page.data.selectedDistrict, '');
  assert.deepEqual(Array.from(page.data.districts), ['全上海', '静安']);
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-show']);
  assert.equal(state.locationCalls, 0);
});

test('default place discovery expands losslessly, bypasses curation during search and repartitions when a cover fails', async t => {
  const { page, records, state } = fixture(t);
  records[0].photo = { ...records[0].photo, sourceUrl: 'https://example.invalid/public-photo', credit: '仅测试摄影署名', license: '仅测试图片使用许可' };
  delete records[0].point; // This card qualifies through its real photo only.
  records[1].point = { ...records[1].point, precision: 'venue', sourceUrl: 'https://example.invalid/verified-map' };
  await page.onLoad();
  const shown = () => Array.from(page.data.displayPlaces, item => item.id);
  const all = () => Array.from(page.data.places, item => item.id);
  const originalIds = ['fixture-far', 'fixture-near', 'fixture-unknown'];
  assert.deepEqual(all(), originalIds, 'the canonical list is never reduced to the featured cards');
  assert.equal(page.data.discoveryCurated, true);
  assert.equal(page.data.morePlaceCount, 1);
  assert.deepEqual(shown(), ['fixture-far', 'fixture-near']);
  page.toggleMorePlaces();
  assert.equal(page.data.showMorePlaces, true);
  assert.deepEqual(shown(), originalIds);
  assert.equal(new Set(shown()).size, all().length, 'expanding neither drops nor duplicates a place');
  page.toggleMorePlaces();
  assert.deepEqual(shown(), ['fixture-far', 'fixture-near']);

  page.openSearch(); page.inputSearch(choice('仅测试')); await page.search();
  assert.equal(page.data.discoveryCurated, false);
  assert.equal(page.data.morePlaceCount, 0);
  assert.deepEqual(shown(), originalIds, 'an unfeatured place remains discoverable in search');
  page.clearSearch();
  assert.equal(page.data.discoveryCurated, true);
  assert.deepEqual(shown(), ['fixture-far', 'fixture-near']);
  const rawPhoto = { ...records[0].photo };
  page.photoFailed(event('fixture-far'));
  assert.equal(page.data.places.find(item => item.id === 'fixture-far').photoUrl, '');
  assert.deepEqual(shown(), ['fixture-near'], 'a failed photographic-only recommendation leaves the featured list');
  assert.equal(page.data.morePlaceCount, 2);
  assert.deepEqual(all(), originalIds);
  assert.deepEqual(records[0].photo, rawPhoto, 'presentation failure cannot erase the original photo evidence');
  page.toggleMorePlaces();
  assert.deepEqual(shown(), ['fixture-near', 'fixture-far', 'fixture-unknown']);
  assert.equal(new Set(shown()).size, originalIds.length);
  assert.equal(state.locationCalls, 0, 'recommendation, search and expanding the directory do not request GPS');
  assert.ok(state.calls.every(action => ['bootstrap', 'listEvents', 'listPlaces'].includes(action)));
});

test('two place columns remain in sync after expansion, search, distance order, image failure and directory replacement', async t => {
  const { page, records, state, location } = fixture(t);
  const rendered = () => {
    const columns = Array.from(page.data.placeColumns, column => Array.from(column.items));
    assert.equal(columns.length, 2);
    const result = [];
    for (let row = 0; row < Math.max(...columns.map(column => column.length)); row += 1) {
      columns.forEach(column => { if (column[row]) result.push(column[row]); });
    }
    assert.deepEqual(result.map(item => item.id), Array.from(page.data.displayPlaces, item => item.id), 'reading across both columns preserves the displayed order');
    assert.equal(new Set(result.map(item => item.id)).size, result.length);
    for (const item of result) {
      const original = page.data.displayPlaces.find(value => value.id === item.id);
      assert.equal(item.photoUrl, original.photoUrl, 'rendered cover state is current');
      assert.equal(item.petText, original.petText, 'full admission rules remain available');
      assert.equal(item.distance && item.distance.label, original.distance && original.distance.label);
    }
    return result;
  };
  await page.onLoad(); rendered();
  page.toggleMorePlaces(); rendered();
  page.toggleMorePlaces(); rendered();
  location.setManualReference(records[0].point, '仅测试距离参照');
  page.selectSort(event('distance'));
  assert.equal(rendered()[0].id, 'fixture-near');
  page.photoFailed(event('fixture-far'));
  const failed = rendered().find(item => item.id === 'fixture-far');
  assert.equal(failed.photoUrl, '');
  assert.equal(failed.cardSceneIcon, '/assets/nearby/icons/scene-park.svg');
  page.openSearch(); page.inputSearch(choice('没有匹配的场所')); await page.search();
  assert.deepEqual(rendered(), [], 'a zero-result search clears both columns');
  page.clearSearch(); rendered();
  state.directory = [{ ...structuredClone(records[1]), title: '在线更新后的场所', photo: { url: 'https://example.invalid/updated.jpg' } }];
  await page.refresh();
  assert.deepEqual(rendered().map(item => item.id), ['fixture-near']);
  assert.equal(rendered()[0].title, '在线更新后的场所');
  assert.equal(rendered()[0].photoUrl, 'https://example.invalid/updated.jpg');
  assert.equal(state.locationCalls, 0, 'laying out cards never requests a new position');
});

test('compact place cards never crop long admission rules into an unconditional pet invitation', async t => {
  const { page, records, state } = fixture(t);
  const policy = '仅入口外广场指定区域可携宠；禁止大型犬及有攻击倾向的犬只，室内一律不可通行，出发前需另向管理方确认。';
  records[1].petPolicy = { status: 'conditional', text: policy };
  await page.onLoad();
  page.openSearch(); page.inputSearch(choice('仅测试')); await page.search();
  const all = page.data.placeColumns.flatMap(column => column.items);
  const restricted = all.find(item => item.id === records[1].id);
  assert.equal(restricted.petText, policy);
  assert.equal(restricted.petHint, policy);
  assert.match(restricted.cardPetHint, /限制.*详情/);
  assert.doesNotMatch(restricted.cardPetHint, /可携宠|欢迎|…/);
  assert.equal(restricted.cardSceneIcon, '/assets/nearby/icons/scene-commercial.svg');
  for (const item of all) assert.ok(fs.existsSync(path.join(__dirname, '../miniprogram', item.cardSceneIcon)));
  assert.equal(state.locationCalls, 0);
});

test('district, neighbourhood and real play tags filter places and external notices without locating', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  assert.equal(page.data.places.length, 3);
  assert.equal(state.locationCalls, 0);
  assert.equal(page.data.eventsError, '仅测试后端不可用');
  assert.deepEqual(Array.from(page.data.playChoices, tag => tag.id), ['walk', 'lawn', 'hangout']);
  page.selectDistrict(choice(page.data.districts.indexOf('闵行')));
  assert.deepEqual(Array.from(page.data.areas), ['全部片区', '莘庄', '梅陇']);
  page.selectPlayTag(event('lawn'));
  assert.deepEqual(Array.from(page.data.places, item => item.id), ['fixture-far']);
  page.selectTab(event('activities'));
  assert.equal(page.data.playTag, 'all');
  assert.equal(page.data.selectedDistrict, '', 'activities start across Shanghai instead of inheriting the place district');
  assert.equal(page.data.districts[0], '全上海');
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-show']);
  assert.deepEqual(Array.from(page.data.announcements, item => item.id), ['fixture-notice']);
  assert.deepEqual(Array.from(page.data.playChoices), [], 'an exhibition category does not imply a pet activity');
  page.selectDistrict(choice(page.data.districts.indexOf('徐汇')));
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-show']);
  assert.equal(page.data.announcements.length, 0);
});

test('places and citywide activities retain independent district selections and never invent uncovered districts', async t => {
  const { page, records, state } = fixture(t);
  records.push({ ...records[0], id: 'fixture-place-only', district: '长宁', area: '虹桥' });
  records.push({ ...records[3], id: 'fixture-city-event', district: '奉贤', area: '南桥' });
  records.push({ ...records[3], id: 'fixture-city-past', district: '奉贤', startsAt: '2026-09-01T09:00:00+08:00', endsAt: '2026-09-01T17:00:00+08:00' });
  await page.onLoad();
  assert.equal(page.data.districts.includes('奉贤'), false, 'place choices contain only recorded place districts');
  page.selectDistrict(choice(page.data.districts.indexOf('闵行')));
  page.selectArea(choice(page.data.areas.indexOf('莘庄')));
  page.selectTab(event('activities'));
  assert.equal(page.data.districts[0], '全上海');
  assert.equal(page.data.districtIndex, 0);
  assert.equal(page.data.selectedDistrict, '');
  assert.equal(page.data.districts.includes('长宁'), false, 'a place alone does not claim an activity in its district');
  assert.equal(page.data.districts.includes('奉贤'), true);
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-show', 'fixture-city-event']);
  page.selectDistrict(choice(page.data.districts.indexOf('奉贤')));
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-city-event']);
  page.selectPeriod(event('past'));
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-city-past']);
  page.selectTab(event('places'));
  assert.equal(page.data.selectedDistrict, '闵行');
  assert.equal(page.data.selectedArea, '莘庄');
  assert.equal(page.data.areas[page.data.areaIndex], '莘庄');
  assert.deepEqual(Array.from(page.data.places, item => item.id), ['fixture-far']);
  page.resetPlaces();
  page.selectTab(event('activities'));
  assert.equal(page.data.selectedDistrict, '奉贤', 'resetting places cannot reset a deliberate activity choice');
  assert.equal(page.data.districts[page.data.districtIndex], '奉贤');
  assert.equal(page.data.period, 'past');
  page.selectDistrict(choice(0));
  page.selectPeriod(event('upcoming'));
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-show', 'fixture-city-event']);
  assert.deepEqual(Array.from(page.data.announcements, item => item.id), ['fixture-notice']);
  assert.equal(state.locationCalls, 0);
});

test('collapsed region and filter controls are mutually exclusive and opening search preserves the selected results', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.selectDistrict(choice(page.data.districts.indexOf('闵行')));
  page.selectArea(choice(page.data.areas.indexOf('莘庄')));
  page.selectPlayTag(event('lawn'));
  state.reference = { source: 'manual', label: '仅测试公共参照点' };
  await page.selectSort(event('distance'));
  const selection = () => ({ district: page.data.selectedDistrict, area: page.data.selectedArea, petFilter: page.data.petFilter,
    playTag: page.data.playTag, period: page.data.period, sort: page.data.sort, reference: page.data.reference,
    placeIds: Array.from(page.data.places, item => item.id) });
  const before = structuredClone(selection());
  const callsBefore = state.calls.length;
  assert.equal(page.data.regionOpen, false);
  assert.equal(page.data.filterOpen, false);
  page.toggleRegion();
  assert.equal(page.data.regionOpen, true);
  assert.equal(page.data.filterOpen, false);
  page.toggleFilters();
  assert.equal(page.data.regionOpen, false);
  assert.equal(page.data.filterOpen, true);
  page.toggleFilters();
  assert.equal(page.data.filterOpen, false);
  page.toggleFilters(); page.toggleRegion();
  assert.equal(page.data.filterOpen, false);
  assert.equal(page.data.regionOpen, true);
  page.openSearch();
  assert.equal(page.data.regionOpen, false);
  assert.equal(page.data.filterOpen, false);
  assert.equal(page.data.searchOpen, true);
  assert.deepEqual(selection(), before, 'layout controls do not apply or clear filters');
  assert.equal(state.calls.length, callsBefore, 'opening controls never requests or clears results');
  assert.equal(state.locationCalls, 0, 'moving location controls never asks for GPS');
  page.toggleRegion(); page.selectTab(event('activities'));
  assert.equal(page.data.regionOpen, false);
  assert.equal(page.data.filterOpen, false);
  page.toggleFilters(); page.selectTab(event('places'));
  assert.equal(page.data.filterOpen, false);
  assert.equal(page.data.selectedDistrict, '闵行');
  assert.equal(page.data.selectedArea, '莘庄');
});

test('search commits only on submit, cancel clears only search, and switching categories cannot leave a hidden query', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.selectDistrict(choice(page.data.districts.indexOf('闵行')));
  const originalIds = Array.from(page.data.places, item => item.id);
  const callsBefore = state.calls.length;
  page.openSearch();
  page.inputSearch(choice('  草地  '));
  assert.equal(page.data.query, '');
  assert.deepEqual(Array.from(page.data.places, item => item.id), originalIds);
  assert.equal(state.calls.length, callsBefore);
  await page.search();
  assert.equal(page.data.query, '草地');
  assert.deepEqual(Array.from(page.data.places, item => item.id), ['fixture-far']);
  await page.clearSearch();
  assert.equal(page.data.searchOpen, true);
  assert.equal(page.data.query, '');
  assert.equal(page.data.searchText, '');
  assert.deepEqual(Array.from(page.data.places, item => item.id), originalIds);
  page.inputSearch(choice('草地')); await page.search(); await page.cancelSearch();
  assert.equal(page.data.searchOpen, false);
  assert.equal(page.data.query, '');
  assert.equal(page.data.searchText, '');
  assert.equal(page.data.selectedDistrict, '闵行');
  assert.deepEqual(Array.from(page.data.places, item => item.id), originalIds);
  page.selectTab(event('activities')); page.selectPeriod(event('past'));
  page.openSearch(); page.inputSearch(choice('仅测试')); await page.search();
  page.selectTab(event('activities'));
  assert.equal(page.data.searchOpen, true, 'the same tab does not discard a deliberate query');
  assert.equal(page.data.query, '仅测试');
  page.selectTab(event('places'));
  assert.equal(page.data.searchOpen, false);
  assert.equal(page.data.query, '');
  assert.equal(page.data.searchText, '');
  assert.equal(page.data.period, 'past');
  assert.equal(page.data.selectedDistrict, '闵行');
});

test('sort-menu help explains the current choice without changing order, filters, results or location', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  const selection = () => ({ sort: page.data.sort, index: page.data.sortIndex, selections: { ...page.data.sortSelections },
    filters: structuredClone(page.data.filtersByTab), places: Array.from(page.data.places, item => item.id), reference: page.data.reference });
  page.selectSortChoice(choice(page.data.sortOptions.findIndex(item => item.id === 'photos')));
  const before = selection();
  const calls = state.calls.length;
  assert.equal(page.data.sortMenuOptions.at(-1).id, 'help');
  page.selectSortChoice(choice(page.data.sortMenuOptions.length - 1));
  assert.deepEqual(selection(), before);
  assert.equal(state.modals.at(-1).title, '实景优先');
  assert.match(state.modals.at(-1).content, /图片不代表已确认携宠/);
  assert.equal(state.calls.length, calls);
  assert.equal(state.locationCalls, 0);
  page.selectTab(event('activities'));
  page.selectSortChoice(choice(page.data.sortOptions.findIndex(item => item.id === 'free')));
  const activityChoice = selection();
  page.selectSortChoice(choice(page.data.sortMenuOptions.length - 1));
  assert.deepEqual(selection(), activityChoice);
  assert.equal(state.modals.at(-1).title, '免费优先');
  assert.equal(page.data.sortSelections.places, 'photos');
  page.selectSortChoice(choice(999));
  assert.deepEqual(selection(), activityChoice);
});

test('distance sorting explicitly asks for a reference, marks manual selection and leaves unlocated entries last', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  assert.ok(page.data.places.every(item => item.distance === null));
  await page.selectSort(event('distance'));
  assert.equal(page.data.sort, 'recommended');
  assert.equal(page.data.referencePanel, true);
  assert.equal(state.locationCalls, 0);
  await page.selectKnownReference(choice(1));
  assert.equal(page.data.sort, 'distance');
  assert.equal(page.data.referencePanel, false);
  assert.match(page.data.referenceText, /^手选参照：/);
  assert.deepEqual(Array.from(page.data.places, item => item.id), ['fixture-near', 'fixture-far', 'fixture-unknown']);
  assert.equal(page.data.places[0].distance.label, '约 800 m');
  state.reference = null;
  page.updateCatalogue();
  assert.equal(page.data.sort, 'recommended');
  assert.ok(page.data.places.every(item => item.distance === null), 'expired references never leave stale distance labels');
});

test('broken photos fall back to text cards and leaving the page cancels pending location work', async t => {
  const { page, state, location, records } = fixture(t);
  await page.onLoad();
  assert.equal(page.data.places[0].photoUrl, records[0].photo.url);
  page.photoFailed(event(records[0].id));
  assert.equal(page.data.places[0].photoUrl, '');
  assert.equal(page.data.places[0].title, records[0].title);
  state.choice = 0;
  location.locate = async () => { state.locationCalls += 1; throw Object.assign(new Error('用户取消'), { code: 'LOCATION_CANCELLED' }); };
  await page.openReferenceMenu();
  assert.equal(state.locationCalls, 1);
  assert.deepEqual(state.toasts, []);
  page.onHide(); page.onUnload(); page.updateCatalogue();
  assert.equal(state.cancelled, 2);
  assert.equal(state.writes, 0);
});

test('packaged scene images display and fail safely while other local paths stay hidden', async t => {
  const { page, records } = fixture(t);
  records[0].photo.url = '/assets/nearby/fixture-park.webp';
  records[1].photo = { url: '/assets/nearby/../avatar.jpg' };
  await page.onLoad();
  assert.equal(page.data.places[0].photoUrl, records[0].photo.url);
  assert.equal(page.data.places[1].photoUrl, '');
  page.photoFailed(event(records[0].id));
  assert.equal(page.data.places[0].photoUrl, '');
});

test('draft facets preview contextual counts, close without applying, and reset without losing region or search', async t => {
  const { page, records, state } = fixture(t);
  records.push({ ...records[1], id: 'fixture-local-shop', district: '闵行', area: '莘庄' });
  records.push({ ...records[0], id: 'fixture-unrelated-park', title: '无关公园', city: '上海', summary: '无关内容', petPolicy: { status: 'conditional', text: '牵绳开放' } });
  await page.onLoad();
  page.selectDistrict(choice(page.data.districts.indexOf('闵行')));
  page.selectArea(choice(page.data.areas.indexOf('莘庄')));
  page.openSearch(); page.inputSearch(choice('仅测试')); await page.search();
  const resultIds = () => Array.from(page.data.places, item => item.id);
  const selectedLocation = () => ({ district: page.data.selectedDistrict, area: page.data.selectedArea, query: page.data.query, searchText: page.data.searchText });
  const selection = selectedLocation();
  const initialIds = ['fixture-far', 'fixture-local-shop'];
  const callsBefore = state.calls.length;
  assert.deepEqual(resultIds(), initialIds);
  page.toggleFilters();
  const option = (key, value) => page.data.draftGroups.find(group => group.key === key).choices.find(item => item.id === value);
  assert.equal(page.data.draftCount, 2);
  assert.equal(option('placeKind', 'park').count, 1);
  assert.equal(option('placeKind', 'commercial').count, 1);
  page.selectDraftFilter(draftChoice('placeKind', 'park'));
  assert.equal(page.data.draftCount, 1);
  assert.equal(option('feeType', 'free').count, 1);
  assert.equal(option('feeType', 'paid').count, 0);
  page.selectDraftFilter(draftChoice('feeType', 'paid'));
  assert.equal(page.data.draftCount, 0);
  assert.deepEqual(resultIds(), initialIds, 'editing even a zero-result draft does not change the visible list');
  assert.equal(page.data.filterCount, 0);
  assert.equal(page.currentFilters().placeKind, 'all');
  page.toggleFilters();
  assert.equal(page.data.filterOpen, false);
  page.toggleFilters();
  assert.equal(page.data.draftFilters.placeKind, 'all', 'reopening restores committed filters, not the abandoned draft');
  assert.equal(page.data.draftFilters.feeType, 'all');
  assert.equal(page.data.draftCount, 2);
  page.selectDraftFilter(draftChoice('placeKind', 'park'));
  page.selectDraftFilter(draftChoice('photosOnly', 'true'));
  assert.equal(page.data.draftFilters.photosOnly, true, 'dataset values are normalized to the declared boolean choice');
  page.applyFilters();
  assert.equal(page.data.filterOpen, false);
  assert.deepEqual(resultIds(), ['fixture-far']);
  assert.equal(page.data.filterCount, 2);
  assert.deepEqual(Array.from(page.data.activeFilters, item => item.key), ['placeKind', 'photosOnly']);
  page.toggleFilters(); page.resetDraftFilters();
  assert.equal(page.data.draftCount, 2);
  assert.equal(page.data.filterCount, 2, 'resetting the draft alone cannot clear applied chips');
  assert.deepEqual(resultIds(), ['fixture-far']);
  assert.deepEqual(selectedLocation(), selection);
  page.applyFilters();
  assert.deepEqual(resultIds(), initialIds);
  assert.equal(page.data.filterCount, 0);
  assert.deepEqual(selectedLocation(), selection, 'resetting facets preserves district, neighbourhood and search');
  page.toggleFilters();
  page.selectDraftFilter(draftChoice('placeKind', 'park'));
  page.selectDraftFilter(draftChoice('feeType', 'paid'));
  page.applyFilters();
  assert.deepEqual(resultIds(), []);
  page.removeFilter(removeChoice('feeType'));
  assert.deepEqual(resultIds(), ['fixture-far']);
  assert.equal(page.currentFilters().placeKind, 'park', 'removing one chip keeps the other condition');
  assert.equal(page.data.filterCount, 1);
  assert.deepEqual(selectedLocation(), selection);
  assert.equal(state.calls.length, callsBefore, 'local facet drafts and commits do not issue backend requests');
  assert.equal(state.locationCalls, 0);
});

test('place and activity facets, periods and sort orders remain independent across tab switches and resets', async t => {
  const { page, records } = fixture(t);
  records.push({ ...records[3], id: 'fixture-free-event', type: 'event', feeType: 'free', petPlayTags: ['social'], petPolicy: { status: 'conditional', text: '仅测试携宠活动' } });
  records.push({ ...records.at(-1), id: 'fixture-past-event', startsAt: '2026-09-01T09:00:00+08:00', endsAt: '2026-09-01T17:00:00+08:00' });
  await page.onLoad();
  page.selectDistrict(choice(page.data.districts.indexOf('闵行')));
  page.toggleFilters();
  page.selectDraftFilter(draftChoice('feeType', 'free'));
  page.selectDraftFilter(draftChoice('photosOnly', true));
  page.applyFilters();
  await page.selectSort(event('photos'));
  const placeFilters = structuredClone(page.currentFilters());
  assert.deepEqual(Array.from(page.data.places, item => item.id), ['fixture-far']);
  page.toggleFilters(); page.selectDraftFilter(draftChoice('feeType', 'paid'));
  page.selectTab(event('activities'));
  assert.equal(page.data.filterOpen, false);
  assert.equal(page.data.sort, 'recommended', 'activities cannot inherit a place-only sort');
  assert.equal(page.currentFilters().feeType, 'all');
  assert.equal(page.currentFilters().photosOnly, false);
  page.selectDistrict(choice(page.data.districts.indexOf('徐汇')));
  page.toggleFilters();
  page.selectDraftFilter(draftChoice('period', 'past'));
  page.selectDraftFilter(draftChoice('eventKind', 'event'));
  page.selectDraftFilter(draftChoice('feeType', 'free'));
  page.applyFilters();
  await page.selectSort(event('free'));
  const activityFilters = structuredClone(page.currentFilters());
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-past-event']);
  assert.deepEqual(Array.from(page.data.announcements), []);
  assert.equal(page.data.filterCount, 3);
  page.selectTab(event('places'));
  assert.equal(page.data.sort, 'photos');
  assert.equal(page.data.selectedDistrict, '闵行');
  assert.deepEqual(structuredClone(page.currentFilters()), placeFilters);
  assert.equal(page.data.filterCount, 2);
  page.toggleFilters();
  assert.equal(page.data.draftFilters.feeType, 'free', 'switching away discarded the unfinished paid-place draft');
  page.toggleFilters();
  page.resetCatalogueFilters();
  assert.equal(page.data.sort, 'photos', 'resetting conditions preserves the selected sort');
  assert.equal(page.data.selectedDistrict, '闵行');
  assert.equal(page.data.filterCount, 0);
  page.selectTab(event('activities'));
  assert.equal(page.data.sort, 'free');
  assert.equal(page.data.selectedDistrict, '徐汇');
  assert.deepEqual(structuredClone(page.currentFilters()), activityFilters, 'resetting places cannot clear activity conditions');
  assert.equal(page.data.period, 'past');
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-past-event']);
});

test('radius facets require an explicit reference and expiration clears draft and committed radii on both tabs', async t => {
  const { page, state, records } = fixture(t);
  records[3].point = { ...records[1].point };
  await page.onLoad();
  page.toggleFilters();
  const radiusChoices = () => page.data.draftGroups.find(group => group.key === 'radius').choices;
  assert.equal(radiusChoices().find(item => item.id === 'all').disabled, false);
  assert.ok(radiusChoices().filter(item => item.id !== 'all').every(item => item.disabled && item.count === null));
  page.selectDraftFilter(draftChoice('radius', '1'));
  assert.equal(page.data.draftFilters.radius, 'all');
  assert.equal(page.currentFilters().radius, 'all');
  assert.equal(state.locationCalls, 0, 'a disabled radius never triggers an implicit GPS prompt');
  page.selectDraftFilter(draftChoice('petFilter', 'with'));
  await page.openReferenceMenu();
  assert.equal(page.data.referencePanel, true);
  assert.equal(page.data.filterOpen, false);
  await page.selectKnownReference(choice(1));
  assert.equal(page.data.filterOpen, true, 'choosing a reference returns to the existing draft');
  assert.equal(page.data.draftFilters.petFilter, 'with');
  assert.ok(radiusChoices().every(item => !item.disabled));
  page.selectDraftFilter(draftChoice('radius', '1'));
  assert.equal(page.data.draftCount, 1);
  page.applyFilters();
  assert.equal(page.currentFilters().radius, '1');
  assert.deepEqual(Array.from(page.data.places, item => item.id), ['fixture-near']);
  await page.selectSort(event('distance'));
  page.selectTab(event('activities'));
  page.toggleFilters(); page.selectDraftFilter(draftChoice('radius', '3')); page.applyFilters();
  await page.selectSort(event('distance'));
  assert.equal(page.currentFilters().radius, '3');
  assert.deepEqual(Array.from(page.data.externalItems, item => item.id), ['fixture-show']);
  assert.deepEqual(Array.from(page.data.announcements), [], 'month-only entries without distance cannot match a radius');
  page.selectTab(event('places'));
  assert.equal(page.currentFilters().radius, '1');
  page.toggleFilters(); page.selectDraftFilter(draftChoice('radius', '3'));
  state.reference = null;
  page.applyFilters();
  assert.equal(page.currentFilters().radius, 'all', 'a reference expiring before apply cannot commit a stale radius');
  assert.equal(page.data.filtersByTab.activities.radius, 'all');
  assert.equal(page.data.draftFilters.radius, 'all');
  assert.equal(page.currentFilters().petFilter, 'with', 'expiry does not discard unrelated filters');
  assert.equal(page.data.sort, 'recommended');
  assert.equal(page.data.sortSelections.places, 'recommended');
  assert.equal(page.data.sortSelections.activities, 'recommended');
  assert.equal(page.data.reference, null);
  assert.ok(page.data.places.every(item => item.distance === null));
  assert.equal(page.data.filterCount, 1);
  page.toggleFilters();
  assert.ok(radiusChoices().filter(item => item.id !== 'all').every(item => item.disabled && item.count === null));
  page.selectTab(event('activities'));
  assert.equal(page.currentFilters().radius, 'all');
  assert.equal(page.data.sort, 'recommended');
  assert.equal(page.data.filterCount, 0);
  assert.deepEqual(Array.from(page.data.announcements, item => item.id), ['fixture-notice']);
  assert.ok(page.data.externalItems.every(item => item.distance === null));
  assert.equal(state.locationCalls, 0);
});

test('anchored place regions draft the district and apply only a right-hand choice, with independent activity scope', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.selectTab(event('activities')); page.selectDistrict(choice(page.data.districts.indexOf('徐汇'))); page.selectTab(event('places'));
  const before = Array.from(page.data.places, item => item.id);
  const reads = state.calls.length;
  page.toggleDropdown(menu('region'));
  assert.equal(page.data.dropdown, 'region'); assert.equal(page.data.regionOpen, true);
  assert.deepEqual(Array.from(page.data.regionGroups, item => item.label), ['全上海', '闵行', '徐汇']);
  page.selectRegionGroup(itemNamed(page.data.regionGroups, '闵行'));
  assert.equal(page.data.regionGroup, '闵行');
  assert.equal(page.data.selectedDistrict, '', 'changing the left column does not commit a district');
  assert.deepEqual(Array.from(page.data.places, item => item.id), before);
  assert.equal(state.calls.length, reads);
  assert.deepEqual(Array.from(page.data.regionItems, item => item.label), ['整个闵行', '莘庄', '梅陇']);
  page.selectRegionItem(itemNamed(page.data.regionItems, '莘庄'));
  assert.equal(page.data.dropdown, ''); assert.equal(page.data.regionOpen, false);
  assert.equal(page.data.selectedDistrict, '闵行'); assert.equal(page.data.selectedArea, '莘庄');
  assert.deepEqual(Array.from(page.data.places, item => item.id), ['fixture-far']);
  page.toggleDropdown(menu('region'));
  assert.equal(page.data.regionItems.find(item => item.label === '莘庄').selected, true);
  page.selectRegionGroup(itemNamed(page.data.regionGroups, '徐汇')); page.closeDropdown();
  assert.equal(page.data.selectedDistrict, '闵行'); assert.equal(page.data.selectedArea, '莘庄');
  page.toggleDropdown(menu('region'));
  assert.equal(page.data.regionGroup, '闵行', 'dismissal discards the draft district');
  page.selectRegionItem(itemNamed(page.data.regionItems, '整个闵行'));
  assert.equal(page.data.selectedArea, '');
  assert.deepEqual(Array.from(page.data.places, item => item.id), ['fixture-far', 'fixture-unknown']);
  page.toggleDropdown(menu('region')); page.selectRegionGroup(itemNamed(page.data.regionGroups, '全上海'));
  page.selectRegionItem(itemNamed(page.data.regionItems, '全上海'));
  assert.equal(page.data.selectedDistrict, ''); assert.equal(page.data.selectedArea, '');
  assert.equal(page.data.districtSelections.activities, '徐汇', 'clearing places keeps the activity scope');
  assert.equal(state.locationCalls, 0);
});

test('activity region dropdown uses only current event districts and ignores clicks from an older tab', async t => {
  const { page, records, state } = fixture(t);
  records.push({ ...records[0], id: 'only-place', district: '长宁', area: '虹桥' });
  await page.onLoad(); page.toggleDropdown(menu('region'));
  const staleAll = itemNamed(page.data.regionItems, '全上海');
  const staleGroup = itemNamed(page.data.regionGroups, '闵行');
  page.selectTab(event('activities')); page.toggleDropdown(menu('region'));
  assert.deepEqual(Array.from(page.data.dropdownItems, item => item.label), ['全上海', '徐汇', '闵行']);
  assert.deepEqual(Array.from(page.data.regionGroups), []);
  page.selectRegionGroup(staleGroup); page.selectRegionItem(staleAll); page.selectDropdownItem(staleAll);
  assert.equal(page.data.dropdown, 'region', 'stale place events cannot close or select an activity menu');
  page.selectDropdownItem(itemNamed(page.data.dropdownItems, '闵行'));
  assert.equal(page.data.dropdown, ''); assert.equal(page.data.selectedDistrict, '闵行');
  assert.deepEqual(Array.from(page.data.externalItems), []);
  assert.deepEqual(Array.from(page.data.announcements, item => item.id), ['fixture-notice']);
  page.toggleDropdown(menu('region')); page.selectDropdownItem(itemNamed(page.data.dropdownItems, '全上海'));
  assert.equal(page.data.selectedDistrict, ''); assert.equal(page.data.externalItems.length, 1);
  assert.equal(state.locationCalls, 0);
});

test('anchored sort and play menus preserve help and explicit distance-reference selection', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  const original = Array.from(page.data.places, item => item.id);
  page.toggleDropdown(menu('sort'));
  assert.equal(page.data.dropdownItems.find(item => item.label === '综合推荐').selected, true);
  assert.match(page.data.dropdownItems.find(item => item.label === '距离最近').hint, /参照/);
  await page.selectDropdownItem(itemNamed(page.data.dropdownItems, '排序说明'));
  assert.equal(page.data.dropdown, ''); assert.equal(state.modals.length, 1); assert.equal(page.data.sort, 'recommended');
  assert.deepEqual(Array.from(page.data.places, item => item.id), original);
  page.toggleDropdown(menu('sort')); await page.selectDropdownItem(itemNamed(page.data.dropdownItems, '距离最近'));
  assert.equal(page.data.dropdown, ''); assert.equal(page.data.referencePanel, true); assert.equal(page.data.sort, 'recommended');
  assert.equal(state.locationCalls, 0, 'distance opens a reference choice, not an implicit GPS request');
  await page.selectKnownReference(choice(1));
  assert.equal(page.data.sort, 'distance'); assert.equal(page.data.referencePanel, false);
  page.toggleDropdown(menu('play'));
  const lawn = page.data.playOptions.find(item => item.id === 'lawn');
  page.selectDropdownItem(itemNamed(page.data.dropdownItems, lawn.name));
  assert.equal(page.data.dropdown, ''); assert.equal(page.data.playTag, 'lawn');
  assert.deepEqual(Array.from(page.data.places, item => item.id), ['fixture-far']);
  page.toggleDropdown(menu('play')); page.selectDropdownItem(itemNamed(page.data.dropdownItems, '全部玩法'));
  assert.equal(page.data.playTag, 'all'); assert.equal(page.data.places.length, 3); assert.equal(state.locationCalls, 0);
});

test('dropdown lifecycle excludes other panels and invalidates changed-directory and hidden-page clicks', async t => {
  const { page, state, records } = fixture(t);
  await page.onLoad(); page.toggleFilters(); page.toggleDropdown(menu('sort'));
  assert.equal(page.data.filterOpen, false);
  page.openSearch(); assert.equal(page.data.dropdown, '');
  page.inputSearch(choice('未提交')); page.toggleDropdown(menu('play'));
  assert.equal(page.data.searchOpen, false); assert.equal(page.data.searchFocused, false);
  assert.equal(page.data.query, ''); assert.equal(page.data.searchText, '');
  page.toggleFilters(); assert.equal(page.data.dropdown, '');
  page.toggleDropdown(menu('sort')); await page.openReferenceMenu();
  assert.equal(page.data.dropdown, ''); assert.equal(page.data.referencePanel, true);
  page.toggleDropdown(menu('region')); assert.equal(page.data.referencePanel, false);
  page.selectRegionGroup(itemNamed(page.data.regionGroups, '闵行'));
  const withdrawnChoice = itemNamed(page.data.regionItems, '莘庄');
  state.directory = [records[1], records[3]]; await page.refresh();
  assert.equal(page.data.dropdown, '', 'a changed authoritative directory invalidates the open menu');
  page.selectRegionItem(withdrawnChoice); assert.equal(page.data.selectedDistrict, '');
  page.toggleDropdown(menu('sort')); const oldSort = itemNamed(page.data.dropdownItems, '消息最新');
  page.onResize(); page.selectDropdownItem(oldSort);
  assert.equal(page.data.dropdown, ''); assert.equal(page.data.sort, 'recommended');
  page.toggleDropdown(menu('sort')); page.onHide(); page.selectDropdownItem(oldSort); page.toggleDropdown(menu('region'));
  assert.equal(page.data.dropdown, ''); assert.equal(page.data.sort, 'recommended');
  page._hidden = false; page.toggleDropdown(menu('sort')); page.onUnload(); page.selectDropdownItem(oldSort);
  assert.equal(state.writes, 0); assert.equal(state.locationCalls, 0);
});

test('controls overview preserves committed conditions and returning from a region discards only its draft', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.selectDistrict(choice(page.data.districts.indexOf('闵行'))); page.selectArea(choice(page.data.areas.indexOf('莘庄')));
  page.selectPlayTag(event('lawn')); page.selectSort(event('recent'));
  page.toggleFilters(); page.selectDraftFilter(draftChoice('petFilter', 'with')); page.applyFilters();
  page.openSearch(); page.inputSearch(choice('草地')); await page.search();
  const snapshot = () => ({ district: page.data.selectedDistrict, area: page.data.selectedArea, play: page.data.playTag, sort: page.data.sort,
    filters: structuredClone(page.currentFilters()), query: page.data.query, items: Array.from(page.data.places, item => item.id) });
  const committed = snapshot(); const reads = state.calls.length;
  page.toggleControls();
  assert.equal(page.data.controlsOpen, true); assert.equal(page.data.searchOpen, false);
  assert.equal(page.data.dropdown, ''); assert.equal(page.data.filterOpen, false); assert.equal(page.data.referencePanel, false);
  page.openControl(menu('region')); page.selectRegionGroup(itemNamed(page.data.regionGroups, '徐汇'));
  const staleRegion = itemNamed(page.data.regionItems, '西岸');
  page.backToControls();
  assert.equal(page.data.controlsOpen, true); assert.equal(page.data.dropdown, '');
  assert.deepEqual(snapshot(), committed);
  page.chooseControlRegion(staleRegion); assert.deepEqual(snapshot(), committed);
  page.openControl(menu('not-a-menu')); assert.equal(page.data.dropdown, '');
  page.toggleControls();
  assert.equal(page.data.controlsOpen, false);
  page.openControl(menu('sort')); page.backToControls();
  assert.equal(page.data.dropdown, ''); assert.deepEqual(snapshot(), committed);
  assert.equal(state.calls.length, reads); assert.equal(state.locationCalls, 0);
});

test('controls choices close immediately while preserving explicit reference and advanced draft behavior', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.toggleControls(); page.openControl(menu('region')); page.selectRegionGroup(itemNamed(page.data.regionGroups, '闵行'));
  page.chooseControlRegion(itemNamed(page.data.regionItems, '莘庄'));
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.dropdown, '');
  assert.equal(page.data.selectedArea, '莘庄');
  page.toggleControls(); page.openControl(menu('sort'));
  await page.chooseControlItem(itemNamed(page.data.dropdownItems, '排序说明'));
  assert.equal(page.data.controlsOpen, false); assert.equal(state.modals.length, 1); assert.equal(page.data.sort, 'recommended');
  page.toggleControls(); page.openControl(menu('sort'));
  page.chooseControlItem(event('no-such-sort'));
  assert.equal(page.data.controlsOpen, true); assert.equal(page.data.dropdown, 'sort');
  await page.chooseControlItem(itemNamed(page.data.dropdownItems, '距离最近'));
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.referencePanel, true);
  assert.equal(page.data.sort, 'recommended'); assert.equal(state.locationCalls, 0);
  await page.selectKnownReference(choice(1));
  assert.equal(page.data.sort, 'distance'); assert.equal(page.data.controlsOpen, false);
  page.toggleControls(); page.openControl(menu('play'));
  page.chooseControlItem(itemNamed(page.data.dropdownItems, page.data.playOptions.find(item => item.id === 'lawn').name));
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.playTag, 'lawn');

  page.toggleFilters(); page.selectDraftFilter(draftChoice('petFilter', 'with')); page.applyFilters();
  page.openSearch(); page.inputSearch(choice('草地')); await page.search();
  page.toggleControls(); page.openAdvancedFilters();
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.dropdown, ''); assert.equal(page.data.filterOpen, true);
  assert.equal(page.data.draftFilters.petFilter, 'with'); assert.equal(page.data.query, '草地');
  assert.equal(page.data.selectedArea, '莘庄'); assert.equal(page.data.playTag, 'lawn'); assert.equal(page.data.sort, 'distance');
  page.selectDraftFilter(draftChoice('feeType', 'free'));
  assert.equal(page.currentFilters().feeType, 'all', 'advanced selections still require apply');
  page.applyFilters(); assert.equal(page.currentFilters().feeType, 'free');
  page.openAdvancedFilters(); assert.equal(page.data.filterOpen, false, 'a hidden overview action cannot reopen advanced filters');
  assert.equal(state.locationCalls, 0);
});

test('controls are closed by search, resize, refresh and tab lifecycle and reject obsolete wrapper clicks', async t => {
  const { page, state, records } = fixture(t);
  await page.onLoad();
  const openSort = () => { page.toggleControls(); page.openControl(menu('sort')); return itemNamed(page.data.dropdownItems, '消息最新'); };
  let stale = openSort(); page.openSearch(); await page.chooseControlItem(stale);
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.sort, 'recommended');
  stale = openSort(); page.onResize(); await page.chooseControlItem(stale);
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.sort, 'recommended');
  stale = openSort(); state.directory = records; await page.refresh(); await page.chooseControlItem(stale);
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.sort, 'recommended');
  stale = openSort(); page.selectTab(event('activities')); page.toggleControls(); page.openControl(menu('sort'));
  await page.chooseControlItem(stale);
  assert.equal(page.data.controlsOpen, true); assert.equal(page.data.dropdown, 'sort'); assert.equal(page.data.sort, 'recommended');
  page.onHide(); page.openControl(menu('region')); page.toggleControls(); await page.chooseControlItem(stale);
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.dropdown, '');
  page._hidden = false; stale = openSort(); page.onUnload(); page.toggleControls(); await page.chooseControlItem(stale);
  assert.equal(state.writes, 0); assert.equal(state.locationCalls, 0);
});
