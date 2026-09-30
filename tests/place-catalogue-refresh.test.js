'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createApi } = require('../miniprogram/services/api');
const { createNearbyLocation } = require('../miniprogram/services/nearby-location');
const { normalizePoint } = require('../miniprogram/utils/geo');
const { createSeed } = require('../miniprogram/data/seed');
const { STORAGE_KEY } = require('../miniprogram/services/demo');
const catalogue = require('../miniprogram/data/nearby-catalogue');
const legacy = require('./fixtures/nearby-legacy-imports.json');
const epoch = Date.parse('2026-09-30T08:00:00Z');
const clone = value => structuredClone(value);

function nativeDetailPage(api, platform) {
  const root = path.resolve(__dirname, '../miniprogram');
  const detailFile = path.join(root, 'pages/local-detail/index.js');
  const sharedFile = path.join(root, 'pages/_shared.js');
  const apiFile = path.join(root, 'services/api.js');
  const locationFile = path.join(root, 'services/nearby-location.js');
  const location = createNearbyLocation(platform, { now: () => epoch });
  let definition;
  const overrides = new Map([[apiFile, api], [locationFile, location]]);
  function evaluate(file) {
    const module = { exports: {} };
    const nodeRequire = createRequire(file);
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      module, exports: module.exports, wx: platform,
      Page: page => { definition = page; },
      require: name => overrides.get(nodeRequire.resolve(name)) || nodeRequire(name)
    }, { filename: file });
    return module.exports;
  }
  // Run the actual page lifecycle, shared action wrapper and native location
  // service; only the host platform and backing device storage are simulated.
  overrides.set(sharedFile, evaluate(sharedFile));
  evaluate(detailFile);
  return { ...definition, data: clone(definition.data), setData(values) { Object.assign(this.data, values); } };
}

for (const oldCache of [false, true]) {
  test('native detail: ' + (oldCache ? 'full real legacy imports' : 'fresh device data') + ' navigate every reviewed bundled point after getPlace settles', async () => {
    const values = new Map();
    const effects = { writes: 0, removals: 0, gps: 0, choose: 0, cloud: 0, maps: [], toasts: [] };
    const platform = {
      getStorageSync: key => clone(values.get(key) || ''),
      setStorageSync: (key, value) => { effects.writes += 1; values.set(key, clone(value)); },
      removeStorageSync: key => { effects.removals += 1; values.delete(key); },
      clearStorageSync() { effects.removals += 1; values.clear(); },
      getLocation() { effects.gps += 1; throw new Error('Destination navigation must not request GPS'); },
      chooseLocation() { effects.choose += 1; throw new Error('Destination navigation must not choose a viewer location'); },
      openLocation(options) {
        effects.maps.push({ latitude: options.latitude, longitude: options.longitude, name: options.name, address: options.address, scale: options.scale });
        queueMicrotask(() => options.success({ errMsg: 'openLocation:ok' }));
      },
      showToast: options => effects.toasts.push(options.title),
      setNavigationBarTitle() {}, stopPullDownRefresh() {},
      cloud: { callFunction() { effects.cloud += 1; throw new Error('Native demo cannot depend on a cloud environment'); } }
    };
    const api = createApi(platform, { mode: 'demo', cloudEnv: '' }, { now: () => epoch });
    await api.call('bootstrap');
    if (oldCache) values.get(STORAGE_KEY).place_records = clone(require('./fixtures/nearby-legacy-imports-full.json').records);
    // Let normal missing-table initialization finish before measuring reads.
    await api.call('bootstrap');
    values.set('youchong.privateDrafts.v1', { text: '仅内存测试草稿，必须保留' });
    values.set('unrelated-device-data', { untouched: true });
    const before = clone(values); const writesBefore = effects.writes;
    const reviewed = catalogue.records.filter(record => record.active !== false && normalizePoint(record.point));
    assert.ok(reviewed.length > 0);
    for (const record of reviewed) {
      const page = nativeDetailPage(api, platform);
      await page.onLoad({ id: record.id });
      assert.equal(page._remoteRecord.id, record.id, 'getPlace has completed for ' + record.id);
      assert.equal(page.data.placeServiceError, '', record.id);
      assert.equal(page.data.item.navigationLabel, '地图导航', record.id);
      assert.equal(page.data.item.canNavigate, true, record.id);
      assert.deepEqual([page.data.item.point.latitude, page.data.item.point.longitude], [record.point.latitude, record.point.longitude], record.id);
      const count = effects.maps.length;
      await page.navigate();
      assert.equal(effects.maps.length, count + 1, record.id + ' calls wx.openLocation exactly once');
      assert.deepEqual([effects.maps[count].latitude, effects.maps[count].longitude], [record.point.latitude, record.point.longitude], record.id + ' uses reviewed destination coordinates');
      assert.equal(effects.maps[count].address, record.address, record.id + ' preserves the public address');
      assert.equal(effects.maps[count].scale, 16);
      page.onUnload();
    }
    assert.equal(effects.maps.length, reviewed.length);
    assert.equal(effects.gps, 0); assert.equal(effects.choose, 0); assert.equal(effects.cloud, 0);
    assert.equal(effects.removals, 0); assert.equal(effects.writes, writesBefore);
    assert.deepEqual(values, before, 'navigation neither clears caches nor rewrites accounts, drafts or imported records');
    assert.deepEqual(effects.toasts, []);
  });
}

for (const preview of [false, true]) {
  test((preview ? 'browser' : 'native demo') + ': an actual old import gains bundled coordinates without rewriting device data', async () => {
    const state = createSeed(epoch);
    state.place_records = clone(legacy.records);
    state.place_visits = [{ id: 'private-visit', userId: state.currentUserId, placeId: legacy.records[0].id, note: '仅内存私人测试备注' }];
    const values = new Map([[STORAGE_KEY, state], ['youchong.privateDrafts.v1', { text: '仅内存草稿' }]]);
    let writes = 0;
    const platform = {
      __preview: preview,
      getStorageSync: key => clone(values.get(key) || ''),
      setStorageSync: (key, value) => { writes += 1; values.set(key, clone(value)); },
      cloud: { callFunction() { throw new Error('Demo must not consult the cloud'); } }
    };
    // The browser always uses demo storage, even if the public config is cloud.
    const api = createApi(platform, { mode: preview ? 'cloud' : 'demo', cloudEnv: '' }, { now: () => epoch });
    await api.call('bootstrap');
    const before = clone(values); const writesBefore = writes;
    const listed = (await api.call('listPlaces', { type: 'all', limit: 50 })).items;
    for (const old of legacy.records) {
      const current = catalogue.records.find(row => row.id === old.id);
      assert.ok(current.point, old.id + ' has a reviewed bundled point');
      const result = (await api.call('getPlace', { id: old.id })).place;
      assert.deepEqual(result.point, current.point);
      assert.deepEqual(listed.find(row => row.id === old.id).point, current.point);
      const withoutPoint = clone(result); delete withoutPoint.point;
      assert.deepEqual(withoutPoint, old, 'only the missing point is supplied');
    }
    assert.equal(writes, writesBefore);
    assert.deepEqual(values, before, 'profiles, visits, draft and imported records stay byte-equivalent');
  });
}

function fixture(module, original, row) {
  const domain = require(module);
  const stored = row && clone(row); let writes = 0;
  const engine = domain.createPlaceEngine({ catalogue: { records: [clone(original)] }, now: () => epoch, newId: () => 'unused',
    fail: (code, message) => { throw Object.assign(new Error(message), { code }); } });
  const store = {
    get: (table, id) => table === 'place_records' && stored && (stored.id || stored._id) === id ? stored : null,
    all: table => table === 'place_records' && stored ? [stored] : [],
    set() { writes += 1; }, remove() { writes += 1; }
  };
  const call = (action, payload = {}) => domain.driveSync(engine.execute(action, payload, { userId: 'audit-reader', isAdmin: true }), store);
  return { call, state: () => clone(stored), writes: () => writes };
}

for (const module of ['../miniprogram/services/place-engine', '../cloudfunctions/community/place-engine']) {
  const label = module.includes('cloudfunctions') ? 'cloud domain' : 'demo domain';
  const old = clone(legacy.records.find(row => row.type === 'event'));
  const current = clone(catalogue.records.find(row => row.id === old.id));

  test(label + ': detail and list preserve manual removals, edits, venue changes and inactive records', () => {
    const manualPoint = { ...current.point, latitude: current.point.latitude + 0.001 };
    const cases = [
      ['cleared point', { point: null }], ['present point', { point: manualPoint }], ['invalid present point', { point: {} }],
      ['operator edit', { updatedBy: 'operator' }], ['removed attribution', { updatedBy: '', updatedAt: 0 }],
      ['creation attribution', { createdBy: 'operator' }], ['creation time', { createdAt: 0 }],
      ['submission', { submissionId: 'submission-1' }], ['submitted author', { submittedBy: 'operator' }],
      ['hidden', { active: false }], ['unmarked record', { active: undefined }],
      ['renamed', { title: old.title + '新版本' }], ['address changed', { address: '新场馆地址' }],
      ['venue changed', { venue: '新场馆' }], ['city changed', { city: '其他城市' }],
      ['district changed', { district: '其他区' }], ['area changed', { area: '其他片区' }],
      ['host changed', { hostName: '新主办方' }], ['rescheduled start', { startsAt: '2027-01-01T00:00:00+08:00' }],
      ['rescheduled end', { endsAt: '2027-01-02T00:00:00+08:00' }], ['cancelled', { status: 'cancelled' }],
      ['different type', { type: 'place' }]
    ];
    for (const [reason, changes] of cases) {
      const row = { ...clone(old), ...changes };
      const f = fixture(module, current, row); const before = f.state();
      const detail = f.call('getPlace', { id: old.id }).place;
      assert.deepEqual(detail.point, row.point, reason);
      const list = f.call('listPlaces', { type: 'all', includeInactive: true }).items;
      assert.deepEqual(list[0].point, row.point, reason + ' in list');
      assert.equal(f.writes(), 0); assert.deepEqual(f.state(), before, reason + ' did not alter storage');
    }
  });

  test(label + ': only valid sourced venue points supplement an unchanged import', () => {
    const changes = [
      null, { ...current.point, coordinateSystem: 'wgs84' }, { ...current.point, precision: 'residence' },
      { ...current.point, latitude: 91 }, { ...current.point, longitude: -181 },
      { ...current.point, latitude: NaN }, { ...current.point, longitude: '121.0' },
      { ...current.point, sourceUrl: '' }, { ...current.point, sourceUrl: 'http://example.invalid/map' }
    ];
    for (const point of changes) {
      const f = fixture(module, { ...current, point }, old);
      assert.equal(f.call('getPlace', { id: old.id }).place.point, undefined);
    }
    const removed = fixture(module, { ...current, active: false }, old);
    assert.equal(removed.call('getPlace', { id: old.id }).place.point, undefined);
    const unknown = fixture(module, current, { ...old, id: 'operator-created-record' });
    assert.equal(unknown.call('getPlace', { id: 'operator-created-record' }).place.point, undefined);
    // Cloud repositories can identify an otherwise untouched import by _id.
    const cloudRow = { ...old, _id: old.id }; delete cloudRow.id;
    const f = fixture(module, current, cloudRow);
    const detail = f.call('getPlace', { id: old.id }).place;
    assert.deepEqual(detail.point, current.point);
    detail.point.latitude += 1;
    assert.deepEqual(f.call('getPlace', { id: old.id }).place.point, current.point, 'responses do not share mutable points');
    assert.equal(f.writes(), 0);
  });
}
