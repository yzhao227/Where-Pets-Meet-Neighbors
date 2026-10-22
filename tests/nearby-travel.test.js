'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const controls = require('../miniprogram/data/nearby-controls');
const { fixture, tap, choice, menu, ids, deferred, flush } = require('./helpers/nearby-page.cjs');

test('route cards preserve editorial copy and stop order while using the current accepted place names', async t => {
  const { page, state, catalogue } = fixture(t);
  const before = structuredClone(catalogue);
  state.directory = catalogue.records.map(item => item.id === 'place-a' ? { ...item, title: '新名字河畔' } : item);
  await page.onLoad(); page.selectTab(tap('guides'));
  assert.deepEqual(ids(page.data.displayGuides), ['guide-river', 'guide-culture']);
  const guide = page.data.displayGuides[0], original = catalogue.guides[0];
  for (const key of ['id', 'title', 'summary', 'duration', 'petLabel', 'notice']) assert.equal(guide[key], original[key]);
  assert.deepEqual(structuredClone(guide.stops), [
    { id: 'place-a', title: '新名字河畔', duration: '建议停留 45 分钟' },
    { id: 'place-b', title: '林间休息点', duration: '建议停留 60 分钟' }
  ]);
  assert.deepEqual(catalogue, before, 'building a route cannot mutate its source records or reviewed copy');
  assert.equal(state.locationCalls, 0);
});

test('route search matches title, summary, current stop names and areas, with all query words required', async t => {
  const { page, state, catalogue } = fixture(t);
  state.directory = catalogue.records.map(item => item.id === 'place-b' ? { ...item, title: '新名字咖啡处', area: '花影街区' } : item);
  await page.onLoad(); page.selectTab(tap('guides'));
  const calls = state.calls.length;
  const cases = [
    ['慢游', ['guide-river']], ['歇脚', ['guide-river']], ['新名字咖啡处', ['guide-river']],
    ['花影街区', ['guide-river']], ['  河畔   花影街区  ', ['guide-river']],
    ['书香', ['guide-culture']], ['河畔 书香', []], ['林间休息点', []], ['没有这样的路线', []]
  ];
  page.openSearch();
  for (const [query, expected] of cases) {
    page.inputSearch(choice(query)); await page.search();
    assert.deepEqual(ids(page.data.displayGuides), expected, query);
  }
  page.clearSearch();
  assert.deepEqual(ids(page.data.displayGuides), ['guide-river', 'guide-culture']);
  assert.equal(page.data.searchOpen, true);
  page.inputSearch(choice('文化')); await page.search(); page.cancelSearch();
  assert.equal(page.data.searchOpen, false); assert.equal(page.data.query, '');
  assert.deepEqual(ids(page.data.displayGuides), ['guide-river', 'guide-culture']);
  assert.equal(state.calls.length, calls, 'searching the loaded route catalogue does not request people or register activity');
  assert.equal(state.locationCalls, 0);
});

test('place filters and saved distance order do not filter routes, and return intact when leaving the guide tab', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  state.reference = { source: 'manual', label: '原出发点' };
  page.selectDistrict(choice(page.data.districts.indexOf('闵行')));
  page.selectArea(choice(page.data.areas.indexOf('滨江片区')));
  page.commitFilters({ ...controls.DEFAULT_FILTERS, feeType: 'free', radius: '3' });
  page.selectSort(tap('distance'));
  assert.deepEqual(ids(page.data.places), ['place-a']);
  const filters = structuredClone(page.data.filtersByTab), districts = structuredClone(page.data.districtSelections);
  page.selectTab(tap('guides'));
  assert.deepEqual(ids(page.data.displayGuides), ['guide-river', 'guide-culture']);
  assert.deepEqual(Array.from(page.data.activeFilters), []); assert.equal(page.data.filterCount, 0);
  assert.equal(page.data.distanceNote, '');
  page.toggleControls(); page.toggleDropdown(menu('region')); page.toggleFilters(); page.openReferenceMenu();
  page.selectDistrict(choice(0)); page.selectArea(choice(0)); page.selectSort(tap('distance'));
  page.commitFilters({ ...controls.DEFAULT_FILTERS, feeType: 'paid' });
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.dropdown, '');
  assert.equal(page.data.filterOpen, false); assert.equal(page.data.referencePanel, false);
  assert.deepEqual(structuredClone(page.data.filtersByTab), filters);
  assert.deepEqual(structuredClone(page.data.districtSelections), districts);
  assert.deepEqual(ids(page.data.displayGuides), ['guide-river', 'guide-culture']);
  assert.equal(state.locationCalls, 0, 'a route never starts a distance/location picker');
  page.selectTab(tap('places'));
  assert.equal(page.data.sort, 'distance'); assert.equal(page.data.selectedDistrict, '闵行');
  assert.equal(page.data.selectedArea, '滨江片区');
  assert.deepEqual(ids(page.data.places), ['place-a']);
});

test('changing between place, activity and guide tabs clears only the departing search and performs no social request', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  const calls = state.calls.length;
  for (const [tab, query, next] of [['places', '河畔', 'guides'], ['guides', '文化', 'activities'], ['activities', '公开活动', 'places']]) {
    page.selectTab(tap(tab)); page.openSearch(); page.inputSearch(choice(query)); await page.search();
    assert.equal(page.data.query, query);
    page.selectTab(tap(next));
    assert.equal(page.data.tab, next); assert.equal(page.data.query, ''); assert.equal(page.data.searchText, '');
    assert.equal(page.data.searchOpen, false); assert.equal(page.data.searchFocused, false);
  }
  page.selectTab(tap('activities'));
  assert.deepEqual(ids(page.data.externalItems), ['external-event']);
  page.selectTab(tap('guides'));
  assert.deepEqual(ids(page.data.displayGuides), ['guide-river', 'guide-culture']);
  assert.equal(state.calls.length, calls);
  assert.equal(state.locationCalls, 0);
});

test('a route disappears in full when any stop is withdrawn, cancelled or changed to a different record type', async t => {
  const { page, state, catalogue } = fixture(t);
  await page.onLoad(); page.selectTab(tap('guides'));
  for (const invalidation of [
    rows => rows.filter(item => item.id !== 'place-b'),
    rows => rows.map(item => item.id === 'place-b' ? { ...item, active: false } : item),
    rows => rows.map(item => item.id === 'place-b' ? { ...item, status: 'cancelled' } : item),
    rows => rows.map(item => item.id === 'place-b' ? { ...item, type: 'event' } : item)
  ]) {
    state.directory = invalidation(structuredClone(catalogue.records));
    await page.refresh({ retain: true });
    assert.deepEqual(ids(page.data.displayGuides), ['guide-culture']);
    const routes = state.routes.length;
    page.openGuide(tap('guide-river')); page.openGuide(tap('unknown-guide'));
    assert.equal(state.routes.length, routes, 'retired or forged card events cannot open a partial route');
    page.openGuide(tap('guide-culture'));
    assert.equal(state.routes.at(-1), '/pages/local-detail/index?guideId=guide-culture');
  }
  state.directory = structuredClone(catalogue.records); await page.refresh();
  assert.deepEqual(ids(page.data.displayGuides), ['guide-river', 'guide-culture']);
  page.openGuide(tap('guide-river'));
  assert.equal(state.routes.at(-1), '/pages/local-detail/index?guideId=guide-river');
});

test('empty and incomplete itineraries are not offered as valid routes', async t => {
  const { page } = fixture(t, { guides: [
    { id: 'empty', title: '空路线', steps: [] }, { id: 'absent', title: '无步骤' },
    { id: 'missing', title: '缺少地点', steps: [{ placeId: 'place-a' }, { placeId: 'missing-place' }] }
  ] });
  await page.onLoad(); page.selectTab(tap('guides'));
  assert.deepEqual(ids(page.data.displayGuides), []);
});

test('a guide directory outage keeps the latest accepted routes, reports the outage and never revives a withdrawn itinerary', async t => {
  const { page, state, handlers, catalogue } = fixture(t);
  await page.onLoad(); page.selectTab(tap('guides'));
  state.directory = catalogue.records.filter(item => item.id !== 'place-a');
  await page.refresh({ retain: true });
  assert.deepEqual(ids(page.data.displayGuides), ['guide-culture']);
  const before = structuredClone(page.data.displayGuides);
  handlers.listPlaces = () => { throw Error('offline after a stop was withdrawn'); };
  page.onHide(); await page.onShow();
  assert.equal(page.data.tab, 'guides');
  assert.deepEqual(structuredClone(page.data.displayGuides), before);
  assert.ok(page.data.placeServiceError);
  assert.equal(page.data.error, ''); assert.equal(page.data.loading, false);
  page.openGuide(tap('guide-river')); assert.deepEqual(state.routes, []);
  page.openGuide(tap('guide-culture'));
  assert.equal(state.routes.at(-1), '/pages/local-detail/index?guideId=guide-culture');
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/nearby/index.wxml'), 'utf8');
  assert.match(markup, /<view\b[^>]*wx:if="\{\{placeServiceError\}\}"[^>]*>\{\{placeServiceError\}\}/, 'directory failures remain visible on the guide tab');
});

test('latest route validation wins when concurrent refreshes disagree about a withdrawn stop', async t => {
  const { page, handlers, state, catalogue } = fixture(t);
  await page.onLoad(); page.selectTab(tap('guides'));
  const pending = deferred(); handlers.listPlaces = () => pending.promise;
  const old = page.refresh({ retain: true }); await flush();
  handlers.listPlaces = () => catalogue.records.filter(item => item.id !== 'place-a');
  await page.refresh({ retain: true });
  pending.resolve(structuredClone(catalogue.records)); await old;
  assert.deepEqual(ids(page.data.displayGuides), ['guide-culture']);
  page.openGuide(tap('guide-river')); assert.deepEqual(state.routes, []);
});

test('guide and contribution navigation require a live, idle page and resolve to their intended destinations', async t => {
  const { page, state } = fixture(t);
  await page.onLoad();
  page.toggleControls(); page.contribute();
  assert.equal(page.data.controlsOpen, false);
  assert.deepEqual(state.routes, ['/social/pages/contribute/index']);
  page.openGuide(tap('guide-river'));
  assert.equal(state.routes.at(-1), '/pages/local-detail/index?guideId=guide-river');
  const count = state.routes.length;
  page.data.busy = true; page.contribute(); page.openGuide(tap('guide-river')); page.selectTab(tap('guides'));
  assert.equal(page.data.tab, 'places'); assert.equal(state.routes.length, count);
  page.data.busy = false; page.onHide();
  page.contribute(); page.openGuide(tap('guide-river')); page.selectTab(tap('guides'));
  assert.equal(page.data.tab, 'places'); assert.equal(state.routes.length, count);
  await page.onShow(); page.selectTab(tap('guides')); page.openGuide(tap('guide-river'));
  assert.equal(state.routes.length, count + 1);
  page.onUnload(); page.contribute(); page.openGuide(tap('guide-river'));
  assert.equal(state.routes.length, count + 1);
});

test('the travel surface binds all three catalogue tabs, complete route cards and the guarded recommendation entry', () => {
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/nearby/index.wxml'), 'utf8');
  const tabs = Array.from(markup.matchAll(/<button\b[^>]*data-id="([^"]+)"[^>]*bindtap="selectTab"[^>]*>/g), match => match[1]);
  assert.deepEqual(tabs, ['places', 'activities', 'guides']);
  assert.match(markup, /wx:for="\{\{displayGuides\}\}"/);
  assert.match(markup, /bindtap="openGuide"/);
  assert.match(markup, /guide\.stops/);
  assert.match(markup, /<button\b[^>]*wx:if="\{\{!personalMode\}\}"[^>]*bindtap="contribute"/);
  assert.match(markup, /推荐好去处/);
  assert.doesNotMatch(markup, /bindtap="(?:openNeighbor|followNeighbor|openEvent|loadMoreNeighbors)"|附近宠友|邻居小聚|创建群聊|加好友/);
});
