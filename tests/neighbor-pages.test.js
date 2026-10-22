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

// The neighbor service and opted-in profile remain supported independently.
// Nearby itself now exposes public travel catalogues, so its retired people
// pagination/control cases are covered by nearby-resume and nearby-travel.
test('nearby never loads opted-in people or community meetups when browsing any public travel tab', async t => {
  const { page, effects, user } = fixture(t, 'nearby');
  user.neighborVisible = true; user.neighborAreaId = areas[0].id;
  user.residenceSharing = true; user.residenceCell = { grid: 'private-grid', x: 1, y: 2 };
  await page.onLoad();
  for (const tab of ['places', 'activities', 'guides']) {
    page.selectTab(event(tab));
    assert.equal(page.data.tab, tab);
    page.openSearch(); page.inputSearch(choice('仅测试搜索')); await page.search();
    await page.clearSearch();
    page.onHide(); await page.onShow();
  }
  assert.ok(effects.calls.length > 0);
  assert.ok(effects.calls.every(call => call.action === 'bootstrap'));
  assert.equal(effects.chooseCalls, 0);
  assert.doesNotMatch(JSON.stringify(page.data), /private-grid|仅测试私人片区|仅测试昵称|仅测试猫/);
  assert.deepEqual(effects.routes, []);
});

test('nearby rejects obsolete social tab events without restoring social controls, state or requests', async t => {
  const { page, effects } = fixture(t, 'nearby');
  await page.onLoad(); page.selectTab(event('guides'));
  const calls = effects.calls.length;
  for (const id of ['neighbors', 'meetups', 'people', 'pets', '', 'unknown']) page.selectTab(event(id));
  assert.equal(page.data.tab, 'guides');
  assert.equal(effects.calls.length, calls);
  for (const name of ['refreshNeighbors', 'loadMoreNeighbors', 'openNeighbor', 'followNeighbor', 'openEvent']) {
    assert.equal(typeof page[name], 'undefined', name + ' is no longer a nearby page action');
  }
  for (const field of ['neighbors', 'neighborNextCursor', 'selfNeighborVisible', 'neighbourItems']) {
    assert.equal(Object.hasOwn(page.data, field), false, field + ' is no longer nearby page state');
  }
  assert.deepEqual(effects.routes, []);
});
