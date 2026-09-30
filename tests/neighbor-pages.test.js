'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shared = require('../miniprogram/pages/_shared');
const areas = require('../miniprogram/data/neighbor-areas');
const cells = require('../miniprogram/data/neighbor-location');
const utils = require('../miniprogram/data/nearby-utils');

function fixture(t, name) {
  const user = { id: 'self', nickname: '仅测试昵称', area: '仅测试私人片区', pet: { name: '仅测试猫', type: 'cat' }, publicProfile: false, showPet: false };
  const effects = { calls: [], toasts: [], routes: [], chooseCalls: 0, writesAfterUnload: 0, confirm: true };
  const platform = {
    stopPullDownRefresh() {}, showToast: value => effects.toasts.push(value.title),
    showModal: value => value.success({ confirm: effects.confirm }),
    navigateTo: value => effects.routes.push(value.url), navigateBack: () => effects.routes.push('back'),
    chooseLocation: value => { effects.chooseCalls += 1; effects.locationRequest = value; }
  };
  const handlers = {
    bootstrap: () => ({ mode: 'demo', user: structuredClone(user), settings: { areas: [user.area] }, circles: [], stats: {} }),
    listEvents: () => ({ items: [] }), listNeighbors: () => ({ items: [] }),
    updateProfile: () => ({ updated: true }), followUser: () => ({ success: true })
  };
  const old = { wx: global.wx, Page: global.Page, call: shared.api.call };
  global.wx = platform;
  shared.api.call = async (action, payload = {}) => { effects.calls.push({ action, payload: structuredClone(payload) }); if (!handlers[action]) throw new Error('Unexpected call: ' + action); return handlers[action](payload); };
  let definition; global.Page = value => { definition = value; };
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/' + name + '/index.js'), 'utf8');
  vm.runInNewContext(source, { wx: platform, require(request) {
    if (request === '../_shared') return shared;
    if (request === './presentation') return require('../miniprogram/pages/nearby/presentation');
    if (request === './discovery-quality') return require('../miniprogram/pages/nearby/discovery-quality');
    if (request === '../../data/neighbor-areas') return areas;
    if (request === '../../data/neighbor-location') return cells;
    if (request === '../../data/pets') return require('../miniprogram/data/pets');
    if (request === '../../data/nearby-utils') return utils;
    if (request === '../../data/nearby-controls') return require('../miniprogram/data/nearby-controls');
    if (request === '../../data/nearby-catalogue') return { records: [], region: '上海', checkedAt: '2026-09-30' };
    if (request === '../../services/nearby-location') return { getReference: () => null, distanceFor: () => null, cancelPending() {} };
    if (request === '../../services/places') return { listAll: async () => [] };
    throw new Error('Unexpected module: ' + request);
  } });
  const page = { ...definition, _closed: false, data: structuredClone(definition.data), setData(value) { if (this._closed) effects.writesAfterUnload += 1; Object.assign(this.data, value); } };
  t.after(() => { global.wx = old.wx; global.Page = old.Page; shared.api.call = old.call; });
  return { page, user, effects, handlers, platform };
}
const event = (id, value) => ({ currentTarget: { dataset: { id, value } } });
const choice = value => ({ detail: { value } });
const menu = value => ({ currentTarget: { dataset: { menu: value } } });
const itemNamed = (items, label) => event(items.find(item => item.label === label).id);
const flush = () => new Promise(resolve => setImmediate(resolve));
const visiblePet = (id = 'pet-owner') => ({ id, nickname: '仅测试主人', avatar: '/assets/avatar-1.png', pet: { name: '仅测试糯米', type: 'cat' }, neighborArea: areas[0], bio: '仅测试公开简介', isFollowing: false });

test('neighbor profile starts separately opted out and never copies the private area or registered pet into public consent', async t => {
  const { page, effects } = fixture(t, 'profile');
  await page.refresh();
  assert.equal(page.data.neighborVisible, false);
  assert.equal(page.data.neighborAreaIndex, 0);
  assert.equal(page.data.residenceSharing, false);
  assert.equal(page.data.residenceCell, null);
  assert.equal(page.data.showPet, false);
  assert.equal(effects.chooseCalls, 0);
  page.neighborState(event('', 'yes'));
  await page.save();
  assert.equal(effects.calls.filter(call => call.action === 'updateProfile').length, 0);
  assert.match(effects.toasts.at(-1), /公开的活动片区/);
});

test('explicit home selection stores and submits only the quantized cell, and shutting it off clears the pending cell', async t => {
  const { page, effects } = fixture(t, 'profile');
  await page.refresh();
  page.neighborState(event('', 'yes'));
  page.selectNeighborArea(choice(1));
  page.residenceState(event('', 'yes'));
  const selecting = page.chooseResidence();
  effects.locationRequest.success({ latitude: 31.123456, longitude: 121.412345, name: '绝不保留的地名', address: '绝不保留的门牌地址' });
  await selecting;
  assert.deepEqual(Object.keys(page.data.residenceCell).sort(), ['grid', 'x', 'y']);
  assert.doesNotMatch(JSON.stringify(page.data), /31\.123456|121\.412345|绝不保留/);
  await page.save();
  const payload = effects.calls.filter(call => call.action === 'updateProfile').at(-1).payload;
  assert.equal(payload.neighborVisible, true);
  assert.equal(payload.neighborAreaId, areas[0].id);
  assert.equal(payload.residenceSharing, true);
  assert.deepEqual(payload.residenceCell, cells.toCell({ latitude: 31.123456, longitude: 121.412345, coordinateSystem: 'gcj02' }));
  assert.doesNotMatch(JSON.stringify(payload), /latitude|longitude|绝不保留/);
  page.residenceState(event('', 'no'));
  assert.equal(page.data.residenceCell, null);
  await page.save();
  assert.equal(effects.calls.at(-1).payload.residenceSharing, false);
  assert.equal(effects.calls.at(-1).payload.residenceCell, null);
  page.residenceState(event('', 'yes'));
  page.neighborState(event('', 'no'));
  await page.save();
  assert.equal(effects.calls.at(-1).payload.neighborVisible, false);
  assert.equal(effects.calls.at(-1).payload.residenceSharing, false);
});

test('cancelled, late, unsupported and invalid home selections cannot publish an address or stale location', async t => {
  const { page, user, effects, platform } = fixture(t, 'profile');
  user.neighborVisible = true; user.neighborAreaId = areas[0].id; user.residenceSharing = true;
  user.residenceCell = cells.toCell({ latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' });
  await page.refresh();
  const previousCell = structuredClone(page.data.residenceCell);
  let selecting = page.chooseResidence();
  effects.locationRequest.fail({ errMsg: 'chooseLocation:fail cancel' });
  await selecting;
  assert.deepEqual(page.data.residenceCell, previousCell);
  assert.deepEqual(effects.toasts, []);
  selecting = page.chooseResidence();
  await page.refresh();
  effects.locationRequest.success({ latitude: 31.5, longitude: 121.8 });
  await selecting;
  assert.deepEqual(page.data.residenceCell, previousCell);
  selecting = page.chooseResidence();
  effects.locationRequest.success({ latitude: 39.9, longitude: 116.4 });
  await selecting;
  assert.deepEqual(page.data.residenceCell, previousCell);
  platform.__preview = true;
  const before = effects.chooseCalls;
  await page.chooseResidence();
  assert.equal(effects.chooseCalls, before);
  assert.match(effects.toasts.at(-1), /微信小程序/);
  platform.__preview = false;
  selecting = page.chooseResidence(); page.onUnload();
  effects.locationRequest.success({ latitude: 31.5, longitude: 121.8 });
  await selecting;
  assert.equal(effects.writesAfterUnload, 0);
});

test('nearby pets use server filters, pet-first cards and only explicit public fields without inferring pet ownership', async t => {
  const { page, effects, handlers } = fixture(t, 'nearby');
  handlers.listNeighbors = payload => ({ items: payload.kind === 'people' ? [{ id: 'friend', nickname: '爱宠同好', pet: null }] : [{ ...visiblePet(), residenceCell: { grid: 'never expose' }, latitude: 31.123456, area: 'private area', phone: 'private phone', distanceBand: '约1–3km' }] });
  await page.onLoad(); await page.selectTab(event('neighbors'));
  const query = effects.calls.find(call => call.action === 'listNeighbors').payload;
  assert.deepEqual(query, { areaId: '', kind: 'pets', petType: 'all', query: '' });
  assert.equal(page.data.neighbors[0].title, '仅测试糯米');
  assert.equal(page.data.neighbors[0].nickname, '仅测试主人');
  assert.equal(page.data.neighbors[0].distanceBand, '约1–3km');
  assert.doesNotMatch(JSON.stringify(page.data.neighbors), /residenceCell|latitude|private area|private phone/);
  page.openNeighbor(event('pet-owner'));
  assert.equal(effects.routes.at(-1), '/pages/author/index?userId=pet-owner');
  await page.selectNeighborPet(event('dog'));
  assert.equal(effects.calls.filter(call => call.action === 'listNeighbors').at(-1).payload.petType, 'dog');
  await page.selectNeighborKind(event('people'));
  assert.equal(effects.calls.filter(call => call.action === 'listNeighbors').at(-1).payload.petType, 'all');
  assert.equal(page.data.neighbors[0].petTypeText, '未展示宠物资料');
  assert.equal(page.data.neighbors[0].distanceBand, '');
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/nearby/index.wxml'), 'utf8');
  assert.doesNotMatch(markup, /没养宠|未养宠|私信/);
});

test('neighbor empty actions reset applied filters, refresh an existing participant, or open explicit profile setup', async t => {
  const { page, user, handlers, effects } = fixture(t, 'nearby');
  await page.onLoad(); await page.selectTab(event('neighbors'));
  const countReads = () => effects.calls.filter(call => call.action === 'listNeighbors').length;
  let before = countReads();
  await page.neighborEmptyAction();
  assert.equal(effects.routes.at(-1), '/pages/profile/index');
  assert.equal(countReads(), before, 'setup does not silently enroll or reload the user');
  assert.equal(effects.calls.some(call => call.action === 'updateProfile'), false);
  user.neighborVisible = true;
  await page.refreshNeighbors();
  before = countReads();
  const routesBefore = effects.routes.length;
  await page.neighborEmptyAction();
  assert.equal(countReads(), before + 1, 'an existing participant can retry without reopening their profile');
  assert.equal(effects.routes.length, routesBefore);
  for (const apply of [
    async () => { page.openSearch(); page.inputSearch(choice('仅测试筛选')); await page.search(); },
    async () => page.selectNeighborArea(choice(1)),
    async () => page.selectNeighborPet(event('cat'))
  ]) {
    await apply();
    await page.neighborEmptyAction();
    assert.equal(page.data.query, '');
    assert.equal(page.data.searchText, '');
    assert.equal(page.data.neighborAreaIndex, 0);
    assert.equal(page.data.neighborPetType, 'all');
    assert.equal(effects.routes.length, routesBefore);
    assert.deepEqual(effects.calls.filter(call => call.action === 'listNeighbors').at(-1).payload,
      { areaId: '', kind: 'pets', petType: 'all', query: '' });
  }
  await page.selectNeighborPet(event('dog'));
  await page.selectNeighborKind(event('people'));
  await page.selectNeighborArea(choice(1));
  await page.resetNeighborFilters();
  assert.equal(page.data.neighborKind, 'people', 'resetting conditions preserves the chosen people view');
  assert.equal(page.data.neighborPetType, 'all');
  assert.deepEqual(effects.calls.filter(call => call.action === 'listNeighbors').at(-1).payload,
    { areaId: '', kind: 'people', petType: 'all', query: '' });
  assert.equal(user.neighborVisible, true, 'empty-state actions never change participation');
});

test('clearing or cancelling a neighbor search rejects old searches and pages while preserving other conditions', async t => {
  const { page, handlers, effects } = fixture(t, 'nearby');
  const pending = [];
  handlers.listNeighbors = payload => payload.query || payload.cursor
    ? new Promise(resolve => { pending.push({ payload, resolve }); })
    : { items: [visiblePet('unfiltered')], nextCursor: 'next-unfiltered' };
  await page.onLoad(); await page.selectTab(event('neighbors'));
  await page.selectNeighborArea(choice(1));
  await page.selectNeighborPet(event('cat'));
  const before = effects.calls.filter(call => call.action === 'listNeighbors').length;
  page.openSearch(); page.inputSearch(choice('  旧搜索  '));
  assert.equal(effects.calls.filter(call => call.action === 'listNeighbors').length, before);
  const oldSearch = page.search();
  assert.equal(pending[0].payload.query, '旧搜索');
  await page.clearSearch();
  assert.equal(page.data.searchOpen, true);
  pending.shift().resolve({ items: [visiblePet('stale-search')], nextCursor: 'stale-cursor' });
  await oldSearch;
  assert.deepEqual(Array.from(page.data.neighbors, item => item.id), ['unfiltered']);
  assert.equal(page.data.neighborNextCursor, 'next-unfiltered');
  const oldPage = page.loadMoreNeighbors();
  page.inputSearch(choice('取消搜索'));
  const cancelledSearch = page.search();
  await page.cancelSearch();
  assert.equal(page.data.searchOpen, false);
  assert.equal(page.data.query, '');
  assert.equal(page.data.neighborAreaIndex, 1);
  assert.equal(page.data.neighborPetType, 'cat');
  pending.forEach(request => request.resolve({ items: [visiblePet('stale-after-cancel')], nextCursor: 'stale' }));
  await Promise.all([oldPage, cancelledSearch]);
  assert.deepEqual(Array.from(page.data.neighbors, item => item.id), ['unfiltered']);
  assert.equal(page.data.neighborNextCursor, 'next-unfiltered');
  assert.equal(page.data.neighborLoading, false);
  assert.equal(page.data.neighborMoreBusy, false);
  const last = effects.calls.filter(call => call.action === 'listNeighbors').at(-1).payload;
  assert.deepEqual(last, { areaId: areas[0].id, kind: 'pets', petType: 'cat', query: '' });
});

test('pet pagination rejects stale filters and tab switches, deduplicates pages, and recovers from a failed request', async t => {
  const { page, handlers, effects } = fixture(t, 'nearby');
  let finish;
  handlers.listNeighbors = payload => payload.cursor ? new Promise(resolve => { finish = resolve; }) : { items: [visiblePet()], nextCursor: 'next' };
  await page.onLoad(); await page.selectTab(event('neighbors'));
  let pending = page.loadMoreNeighbors();
  await page.selectNeighborKind(event('people'));
  finish({ items: [visiblePet('stale')], nextCursor: 'old' }); await pending;
  assert.equal(page.data.neighbors.some(item => item.id === 'stale'), false);
  handlers.listNeighbors = payload => payload.cursor ? { items: [visiblePet(), visiblePet('second')] } : { items: [visiblePet()], nextCursor: 'next' };
  await Promise.all([page.loadMoreNeighbors(), page.loadMoreNeighbors()]);
  assert.equal(page.data.neighbors.length, 2);
  handlers.listNeighbors = () => { throw new Error('仅测试后端故障'); };
  await page.refreshNeighbors();
  assert.deepEqual(Array.from(page.data.neighbors), []);
  assert.equal(page.data.neighborError, '仅测试后端故障');
  handlers.listNeighbors = () => new Promise(resolve => { finish = resolve; });
  pending = page.refreshNeighbors();
  page.selectTab(event('places'));
  finish({ items: [visiblePet('stale-switch')] }); await pending;
  assert.equal(page.data.neighbors.length, 0);
  handlers.listNeighbors = () => ({ items: [visiblePet()] });
  await page.selectTab(event('neighbors'));
  await Promise.all([page.followNeighbor(event('pet-owner')), page.followNeighbor(event('pet-owner'))]);
  assert.equal(effects.calls.filter(call => call.action === 'followUser').length, 1);
  assert.deepEqual(effects.calls.find(call => call.action === 'followUser').payload, { userId: 'pet-owner', follow: true });
  handlers.listNeighbors = () => new Promise(resolve => { finish = resolve; });
  pending = page.refreshNeighbors(); page.onUnload(); finish({ items: [visiblePet('closed')] }); await pending;
  assert.equal(effects.writesAfterUnload, 0);
});

test('neighbor region dropdown applies only existing public area ids after an explicit right-column selection', async t => {
  const { page, effects } = fixture(t, 'nearby');
  await page.onLoad(); await page.selectTab(event('neighbors'));
  const reads = () => effects.calls.filter(call => call.action === 'listNeighbors');
  const initialReads = reads().length;
  page.toggleDropdown(menu('region'));
  page.selectRegionGroup(itemNamed(page.data.regionGroups, '闵行区'));
  assert.equal(reads().length, initialReads, 'opening and drafting a district never queries or enrolls anyone');
  assert.equal(page.data.neighborAreaIndex, 0);
  assert.deepEqual(Array.from(page.data.regionItems, item => item.label), areas.filter(area => area.district === '闵行区').map(area => area.area));
  assert.equal(page.data.regionItems.some(item => /整个/.test(item.label)), false, 'no unsupported district id is fabricated');
  await page.selectRegionItem(itemNamed(page.data.regionItems, '莘庄'));
  assert.equal(page.data.dropdown, '');
  assert.equal(reads().length, initialReads + 1);
  assert.equal(reads().at(-1).payload.areaId, 'sh-minhang-xinzhuang');
  page.toggleDropdown(menu('region'));
  assert.equal(page.data.regionGroup, '闵行区');
  assert.equal(page.data.regionItems.find(item => item.label === '莘庄').selected, true);
  page.selectRegionGroup(itemNamed(page.data.regionGroups, '徐汇区'));
  const districtChoice = itemNamed(page.data.regionItems, '整个徐汇区');
  page.closeDropdown();
  assert.equal(page.data.neighborAreaChoices[page.data.neighborAreaIndex].id, 'sh-minhang-xinzhuang');
  page.selectRegionItem(districtChoice);
  assert.equal(reads().length, initialReads + 1, 'dismissed options cannot send a stale request');
  page.toggleDropdown(menu('region')); page.selectRegionGroup(itemNamed(page.data.regionGroups, '徐汇区'));
  await page.selectRegionItem(itemNamed(page.data.regionItems, '整个徐汇区'));
  assert.equal(reads().at(-1).payload.areaId, 'sh-xuhui');
  page.toggleDropdown(menu('region')); page.selectRegionGroup(itemNamed(page.data.regionGroups, '全上海'));
  await page.selectRegionItem(itemNamed(page.data.regionItems, '全上海'));
  assert.equal(reads().at(-1).payload.areaId, '');
  assert.equal(page.data.neighborAreaIndex, 0);
  assert.equal(effects.chooseCalls, 0);
  assert.equal(effects.calls.some(call => call.action === 'updateProfile'), false);
});

test('neighbor kind and pet dropdowns send one filtered request and cannot replay across menus or tabs', async t => {
  const { page, effects } = fixture(t, 'nearby');
  await page.onLoad(); await page.selectTab(event('neighbors'));
  const reads = () => effects.calls.filter(call => call.action === 'listNeighbors');
  let count = reads().length;
  page.toggleDropdown(menu('pet'));
  assert.equal(page.data.dropdownItems.find(item => item.label === '全部宠物').selected, true);
  const cat = itemNamed(page.data.dropdownItems, '猫咪');
  await page.selectDropdownItem(cat);
  assert.equal(reads().length, ++count); assert.equal(reads().at(-1).payload.petType, 'cat');
  assert.equal(page.data.dropdown, '');
  page.toggleDropdown(menu('kind')); await page.selectDropdownItem(cat);
  assert.equal(page.data.dropdown, 'kind'); assert.equal(reads().length, count);
  await page.selectDropdownItem(itemNamed(page.data.dropdownItems, '爱宠同好'));
  assert.equal(reads().length, ++count); assert.equal(reads().at(-1).payload.kind, 'people');
  assert.equal(reads().at(-1).payload.petType, 'all');
  page.toggleDropdown(menu('pet'));
  assert.equal(page.data.dropdown, '', 'people view cannot accidentally commit a hidden pet filter');
  page.toggleDropdown(menu('kind')); await page.selectDropdownItem(itemNamed(page.data.dropdownItems, '宠物邻居'));
  assert.equal(reads().at(-1).payload.petType, 'cat', 'switching back keeps the deliberate pet choice');
  page.toggleDropdown(menu('pet')); const dog = itemNamed(page.data.dropdownItems, '狗狗');
  await page.selectTab(event('places')); page.toggleDropdown(menu('play')); await page.selectDropdownItem(dog);
  assert.equal(page.data.dropdown, 'play'); assert.equal(page.data.playTag, 'all');
  await page.selectTab(event('neighbors')); page.toggleDropdown(menu('pet')); page.onHide(); await page.selectDropdownItem(dog);
  assert.equal(page.data.dropdown, ''); assert.equal(page.data.neighborPetType, 'cat');
  assert.equal(effects.chooseCalls, 0);
});

test('neighbor control wrappers close before a filtered request resolves and ignore repeat or hidden selections', async t => {
  const { page, effects, handlers } = fixture(t, 'nearby');
  await page.onLoad(); await page.selectTab(event('neighbors'));
  const reads = () => effects.calls.filter(call => call.action === 'listNeighbors').length;
  const before = reads();
  page.toggleControls(); page.openAdvancedFilters();
  assert.equal(page.data.controlsOpen, true); assert.equal(page.data.filterOpen, false);
  page.openControl(menu('region')); page.selectRegionGroup(itemNamed(page.data.regionGroups, '闵行区')); page.backToControls();
  assert.equal(reads(), before, 'opening and returning from a district does not query neighbors');
  page.openControl(menu('pet'));
  const cat = itemNamed(page.data.dropdownItems, '猫咪');
  let finish; handlers.listNeighbors = () => new Promise(resolve => { finish = resolve; });
  const loading = page.chooseControlItem(cat);
  assert.equal(page.data.controlsOpen, false); assert.equal(page.data.dropdown, '');
  assert.equal(reads(), before + 1);
  await page.chooseControlItem(cat); await page.chooseControlRegion(cat);
  assert.equal(reads(), before + 1, 'a second click cannot repeat the request');
  finish({ items: [] }); await loading;
  assert.equal(page.data.neighborPetType, 'cat');
  handlers.listNeighbors = () => ({ items: [] });
  page.toggleControls(); page.openControl(menu('region')); page.selectRegionGroup(itemNamed(page.data.regionGroups, '闵行区'));
  await page.chooseControlRegion(itemNamed(page.data.regionItems, '莘庄'));
  assert.equal(page.data.controlsOpen, false);
  assert.equal(effects.calls.filter(call => call.action === 'listNeighbors').at(-1).payload.areaId, 'sh-minhang-xinzhuang');
  page.toggleControls(); page.openControl(menu('kind'));
  await page.chooseControlItem(itemNamed(page.data.dropdownItems, '爱宠同好'));
  assert.equal(page.data.controlsOpen, false);
  assert.equal(effects.calls.filter(call => call.action === 'listNeighbors').at(-1).payload.petType, 'all');
  page.toggleControls(); page.onHide(); const after = reads();
  page.openControl(menu('kind')); await page.chooseControlItem(cat); page.openAdvancedFilters();
  assert.equal(reads(), after); assert.equal(page.data.controlsOpen, false); assert.equal(effects.chooseCalls, 0);
});
