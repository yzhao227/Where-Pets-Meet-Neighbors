'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const geo = require('../miniprogram/utils/geo');
const { createNearbyLocation, STORAGE_KEY, GPS_TTL_MS } = require('../miniprogram/services/nearby-location');

const origin = { latitude: 31.1, longitude: 121.38, coordinateSystem: 'gcj02' };
const destination = { latitude: 31.107, longitude: 121.38, coordinateSystem: 'gcj02' };
function fixture(existing, options = {}) {
  const storage = existing || new Map();
  const effects = { now: 1_790_680_000_000, requests: [], calls: [], navigations: [], copied: [] };
  const platform = {
    getStorageSync(key) { effects.calls.push(['read', key]); return storage.get(key); },
    setStorageSync(key, value) { effects.calls.push(['write', key]); storage.set(key, structuredClone(value)); },
    removeStorageSync(key) { effects.calls.push(['remove', key]); storage.delete(key); },
    getLocation(options) { effects.requests.push(options); },
    chooseLocation(options) { effects.requests.push(options); },
    setClipboardData(options) { effects.copied.push(options.data); options.success({}); },
    openLocation(options) { effects.navigations.push(options); options.success({}); }
  };
  const service = createNearbyLocation(platform, { now: () => effects.now, ...options });
  return { service, platform, effects, storage };
}

test('distance requires valid GCJ-02 points and rounds to usable approximate display values', () => {
  assert.equal(geo.distanceMeters(origin, origin), 0);
  assert.ok(Math.abs(geo.distanceMeters(origin, destination) - 778.36556) < 0.01);
  assert.equal(geo.distanceMeters(origin, { ...destination, coordinateSystem: 'wgs84' }), null);
  for (const invalid of [null, {}, { ...origin, latitude: '31.1' }, { ...origin, latitude: NaN }, { ...origin, longitude: Infinity }, { ...origin, latitude: 91 }, { ...origin, longitude: -181 }]) {
    assert.equal(geo.normalizePoint(invalid), null);
    assert.equal(geo.distanceMeters(invalid, origin), null);
  }
  assert.equal(geo.distanceLabel(0), '100 m 内');
  assert.equal(geo.distanceLabel(778), '约 800 m');
  assert.equal(geo.distanceLabel(950), '约 1.0 km');
  assert.equal(geo.distanceLabel(2312), '约 2.3 km');
  assert.equal(geo.distanceLabel(-1), '');
  assert.equal(geo.distanceLabel(NaN), '');
  assert.ok(Number.isFinite(geo.distanceMeters({ latitude: 0, longitude: 0, coordinateSystem: 'gcj02' }, { latitude: 0, longitude: 180, coordinateSystem: 'gcj02' })));
});

test('loading or reading preferences never requests GPS and GPS coordinates are never persisted', async () => {
  const f = fixture();
  assert.equal(f.service.getReference(), null);
  assert.equal(f.service.distanceFor(destination), null);
  assert.equal(f.effects.requests.length, 0);
  const request = f.service.locate();
  assert.equal(f.effects.requests[0].type, 'gcj02');
  f.effects.requests[0].success({ ...origin, accuracy: 25 });
  const reference = await request;
  assert.equal(reference.source, 'gps');
  assert.equal(reference.label, '当前位置');
  assert.equal(reference.acquiredAt, f.effects.now);
  assert.equal(f.storage.size, 0);
  assert.equal(f.service.distanceFor(destination).label, '约 800 m');
  reference.latitude = 50;
  assert.equal(f.service.getReference().latitude, origin.latitude, 'the caller cannot mutate the stored reference');
  f.effects.now += GPS_TTL_MS - 1;
  assert.ok(f.service.getReference());
  f.effects.now += 1;
  assert.equal(f.service.getReference(), null);
  assert.equal(f.service.distanceFor(destination), null);
  assert.equal(f.effects.requests.length, 1, 'expiry must not prompt for location again');
});

test('manual references persist under an independent key and do not expose unrelated point data', () => {
  const f = fixture();
  f.storage.set('unrelated-user-data', { post: 'keep me' });
  const reference = f.service.setManualReference({ ...origin, label: '测试公共参照点', sourceUrl: 'https://example.invalid/test', privateData: 'do not copy' });
  assert.equal(reference.source, 'manual');
  assert.equal(reference.label, '测试公共参照点');
  assert.equal(reference.sourceUrl, undefined);
  assert.equal(reference.privateData, undefined);
  const reopened = fixture(f.storage);
  assert.deepEqual(reopened.service.getReference(), reference);
  reopened.effects.now += GPS_TTL_MS * 10;
  assert.ok(reopened.service.getReference(), 'manual reference is not a claim to live GPS');
  assert.equal(reopened.service.distanceFor(destination).referenceLabel, '测试公共参照点');
  reopened.service.clearReference();
  assert.equal(reopened.service.getReference(), null);
  assert.equal(f.storage.has(STORAGE_KEY), false);
  assert.deepEqual(f.storage.get('unrelated-user-data'), { post: 'keep me' });
});

test('persisted GPS, unsupported coordinate systems, and malformed preferences are ignored', () => {
  for (const reference of [
    { ...origin, source: 'gps', acquiredAt: 1, accuracy: 1 },
    { ...origin, source: 'manual', acquiredAt: -1 },
    { ...origin, source: 'manual', acquiredAt: 1, coordinateSystem: 'wgs84' },
    { ...origin, source: 'manual', acquiredAt: '1' }
  ]) {
    const f = fixture(new Map([[STORAGE_KEY, { version: 1, reference }]]));
    assert.equal(f.service.getReference(), null);
    assert.equal(f.effects.requests.length, 0);
  }
  const f = fixture();
  f.platform.getStorageSync = () => { throw new Error('read failed'); };
  assert.equal(f.service.getReference(), null);
});

test('denied, imprecise, and missing GPS APIs keep manual browsing available without automatic retries', async () => {
  const f = fixture();
  const previous = f.service.setManualReference(origin, '保留参照');
  let request = f.service.locate();
  f.effects.requests.at(-1).fail({ errMsg: 'getLocation:fail auth deny' });
  await assert.rejects(request, { code: 'LOCATION_DENIED' });
  assert.deepEqual(f.service.getReference(), previous);
  for (const accuracy of [undefined, NaN, -1, 201]) {
    request = f.service.locate();
    f.effects.requests.at(-1).success({ ...origin, accuracy });
    await assert.rejects(request, { code: 'LOCATION_IMPRECISE' });
    assert.deepEqual(f.service.getReference(), previous);
  }
  delete f.platform.getLocation;
  await assert.rejects(f.service.locate(), { code: 'LOCATION_UNSUPPORTED' });
  assert.equal(f.effects.requests.length, 5);
});

test('leaving the page, clearing, or choosing another reference prevents late GPS from restoring it', async () => {
  for (const action of ['cancelPending', 'clearReference', 'manual']) {
    const f = fixture();
    const request = f.service.locate();
    const assertion = assert.rejects(request, { code: 'LOCATION_STALE' });
    if (action === 'manual') f.service.setManualReference(destination, '新的手选参照');
    else f.service[action]();
    f.effects.requests[0].success({ ...origin, accuracy: 20 });
    await assertion;
    assert.equal(f.service.getReference() && f.service.getReference().source, action === 'manual' ? 'manual' : null);
    if (action === 'manual') assert.equal(f.service.getReference().latitude, destination.latitude);
  }
});

test('a callback resolved just before clear or a newer request still cannot win the continuation race', async () => {
  const f = fixture();
  const first = f.service.locate();
  f.effects.requests[0].success({ ...origin, accuracy: 20 });
  f.service.clearReference();
  await assert.rejects(first, { code: 'LOCATION_STALE' });
  assert.equal(f.service.getReference(), null);
  const earlier = f.service.locate();
  const earlierAssertion = assert.rejects(earlier, { code: 'LOCATION_STALE' });
  const latest = f.service.locate();
  f.effects.requests[1].success({ ...origin, accuracy: 20 });
  f.effects.requests[2].success({ ...destination, accuracy: 20 });
  await earlierAssertion;
  await latest;
  assert.equal(f.service.getReference().latitude, destination.latitude);
});

test('map selection preserves cancellation semantics and creates a manual reference only on success', async () => {
  const f = fixture();
  f.service.setManualReference(origin, '原来的参照');
  let selection = f.service.chooseReference();
  assert.equal(f.effects.requests[0].latitude, origin.latitude);
  f.effects.requests[0].fail({ errMsg: 'chooseLocation:fail cancel' });
  await assert.rejects(selection, { code: 'LOCATION_CANCELLED' });
  assert.equal(f.service.getReference().label, '原来的参照');
  selection = f.service.chooseReference();
  f.effects.requests[1].success({ latitude: destination.latitude, longitude: destination.longitude, name: '地图手选地点' });
  assert.equal((await selection).source, 'manual');
  assert.equal(f.service.getReference().label, '地图手选地点');
  selection = f.service.chooseReference();
  const assertion = assert.rejects(selection, { code: 'LOCATION_STALE' });
  f.service.cancelPending();
  f.effects.requests[2].success({ ...origin, name: '离页后的旧选择' });
  await assertion;
  assert.equal(f.service.getReference().label, '地图手选地点');
});

test('storage failures do not silently claim a persistent preference was saved or removed', () => {
  const f = fixture();
  f.service.setManualReference(origin, '原参照');
  f.platform.setStorageSync = () => { throw new Error('quota'); };
  assert.throws(() => f.service.setManualReference(destination, '新参照'), { code: 'LOCATION_STORAGE_FAILED' });
  assert.equal(f.service.getReference().label, '原参照');
  f.platform.removeStorageSync = () => { throw new Error('unavailable'); };
  assert.throws(() => f.service.clearReference(), { code: 'LOCATION_STORAGE_FAILED' });
  assert.equal(f.service.getReference(), null);
});

test('navigation needs only a valid destination and never requests or persists user location', async () => {
  const f = fixture();
  await f.service.navigateTo(destination, { name: '测试地点', address: '测试地址' });
  assert.equal(f.effects.navigations.length, 1);
  assert.equal(f.effects.navigations[0].name, '测试地点');
  assert.equal(f.effects.navigations[0].latitude, destination.latitude);
  assert.equal(f.effects.requests.length, 0);
  assert.equal(f.storage.size, 0);
  await assert.rejects(f.service.navigateTo({ ...destination, coordinateSystem: 'wgs84' }), { code: 'LOCATION_INVALID' });
  assert.equal(f.effects.navigations.length, 1);
});

test('native address navigation sends only the record ID and uses the server-returned destination', async () => {
  const resolutions = [];
  const resolved = { point: { ...destination, unrelated: 'not forwarded' }, name: '服务端核实的地点', address: '服务端核实的地址' };
  const f = fixture(undefined, { resolveNavigation: async (...args) => { resolutions.push(args); return resolved; } });
  const info = { id: '  fixture-place  ', name: '不可信客户端名称', address: '不可信客户端地址', city: '客户端城市', point: origin, privateOrigin: 'not forwarded' };
  const original = structuredClone(info);
  await f.service.navigateByAddress(info);
  assert.deepEqual(resolutions, [['fixture-place']], 'the resolver receives one trimmed ID, never a client address or origin');
  assert.equal(f.effects.navigations.length, 1);
  const navigation = f.effects.navigations[0];
  assert.deepEqual(Object.fromEntries(Object.entries(navigation).filter(([, value]) => typeof value !== 'function')), {
    latitude: destination.latitude, longitude: destination.longitude, name: resolved.name, address: resolved.address, scale: 16
  });
  assert.deepEqual(info, original);
  assert.deepEqual(f.effects.requests, []);
  assert.deepEqual(f.effects.calls, [], 'destination navigation neither reads nor writes the stored viewer reference');
  assert.deepEqual(f.effects.copied, []);
  assert.equal(f.storage.size, 0);
});

test('address navigation rejects missing inputs and invalid resolved coordinates without opening a map', async () => {
  const resolutions = [];
  let answer;
  const f = fixture(undefined, { resolveNavigation: async id => { resolutions.push(id); return answer; } });
  for (const details of [undefined, {}, { id: '', address: '测试地址' }, { id: 1, address: '测试地址' }, { id: 'place', address: '  ' }, { id: 'place', address: null }]) {
    await assert.rejects(f.service.navigateByAddress(details), { code: 'LOCATION_INVALID' });
  }
  assert.deepEqual(resolutions, []);
  for (const response of [undefined, null, {}, { point: {} }, { point: { ...destination, coordinateSystem: 'wgs84' } }, { point: { ...destination, latitude: NaN } }, { point: { ...destination, longitude: 181 } }, { point: { ...destination, latitude: '31.107' } }]) {
    answer = response;
    await assert.rejects(f.service.navigateByAddress({ id: 'fixture-place', address: '公开地址' }), { code: 'LOCATION_INVALID' });
  }
  assert.equal(resolutions.length, 8);
  assert.deepEqual(f.effects.navigations, []);
  assert.deepEqual(f.effects.requests, []);
  assert.deepEqual(f.effects.calls, []);
  assert.deepEqual(f.effects.copied, []);
});

test('default address resolution is unavailable in demo mode or without a cloud environment and never calls the API', async () => {
  const source = fs.readFileSync(require.resolve('../miniprogram/services/nearby-location'), 'utf8');
  for (const config of [{ mode: 'demo', cloudEnv: 'ignored-test-env' }, { mode: 'cloud', cloudEnv: '' }]) {
    const f = fixture();
    const context = { module: { exports: {} }, require(name) {
      if (name === '../utils/geo') return geo;
      if (name === '../config') return config;
      throw Error('Unconfigured navigation must not load another dependency: ' + name);
    } };
    vm.runInNewContext(source, context);
    const service = context.module.exports.createNearbyLocation(f.platform);
    await assert.rejects(service.navigateByAddress({ id: 'fixture-place', name: '仅测试', address: '公开地址' }), error => error.code === 'NAVIGATION_UNAVAILABLE');
    assert.deepEqual(f.effects.navigations, []);
    assert.deepEqual(f.effects.requests, []);
    assert.deepEqual(f.effects.calls, []);
    assert.deepEqual(f.effects.copied, []);
  }
});

test('cancelled and superseded address lookups ignore both late destinations and late resolver errors', async () => {
  for (const action of ['cancel', 'newer']) {
    for (const completion of ['resolve', 'reject']) {
      const pending = [];
      const f = fixture(undefined, { resolveNavigation: id => new Promise((resolve, reject) => { pending.push({ id, resolve, reject }); }) });
      const earlier = f.service.navigateByAddress({ id: 'old-place', address: '旧公开地址' });
      const stale = assert.rejects(earlier, { code: 'LOCATION_STALE' });
      let latest;
      if (action === 'cancel') f.service.cancelPending(); // Page hide/unload uses this invalidation.
      else {
        latest = f.service.navigateByAddress({ id: 'new-place', address: '新公开地址' });
        pending[1].resolve({ point: destination, name: '最新地点', address: '最新公开地址' });
      }
      if (completion === 'resolve') pending[0].resolve({ point: origin, name: '过期地点', address: '过期公开地址' });
      else pending[0].reject(new Error('An old resolver failure must not replace the cancellation result'));
      await stale;
      if (latest) await latest;
      assert.equal(f.effects.navigations.length, action === 'newer' ? 1 : 0);
      if (latest) assert.equal(f.effects.navigations[0].name, '最新地点');
      assert.deepEqual(f.effects.requests, []);
      assert.deepEqual(f.effects.calls, []);
      assert.deepEqual(f.effects.copied, []);
      await f.service.navigateTo(destination, { name: '随后主动打开的有效地点' });
      assert.equal(f.effects.navigations.at(-1).name, '随后主动打开的有效地点', 'cancellation does not disable a later valid navigation');
    }
  }
});

test('an address result resolved just before cancellation cannot win the async continuation race', async () => {
  let finish;
  const f = fixture(undefined, { resolveNavigation: () => new Promise(resolve => { finish = resolve; }) });
  const request = f.service.navigateByAddress({ id: 'fixture-place', address: '公开地址' });
  finish({ point: destination, name: '已过期结果', address: '公开地址' });
  f.service.cancelPending();
  await assert.rejects(request, { code: 'LOCATION_STALE' });
  assert.deepEqual(f.effects.navigations, []);
  assert.deepEqual(f.effects.calls, []);
});

test('native results with invalid or explicitly mismatched coordinates never establish a reference', async () => {
  const f = fixture();
  for (const invalid of [{ latitude: NaN, longitude: origin.longitude }, { ...origin, coordinateSystem: 'wgs84' }]) {
    const request = f.service.locate();
    f.effects.requests.at(-1).success({ ...invalid, accuracy: 20 });
    await assert.rejects(request, { code: 'LOCATION_INVALID' });
    assert.equal(f.service.getReference(), null);
  }
  const selection = f.service.chooseReference();
  f.effects.requests.at(-1).success({ ...origin, coordinateSystem: 'wgs84' });
  await assert.rejects(selection, { code: 'LOCATION_INVALID' });
  assert.equal(f.storage.size, 0);
});

function previewPlatform() {
  const source = fs.readFileSync(path.resolve(__dirname, '../preview/runtime.js'), 'utf8');
  const start = source.indexOf('  window.wx={');
  const end = source.indexOf('\n  function invoke(', start);
  const effects = { urls: [], navigationFails: false, newWindows: 0 };
  const window = {
    location: { assign(url) { if (effects.navigationFails) throw new Error('test-only navigation unavailable'); effects.urls.push(url); } },
    open() { effects.newWindows += 1; throw new Error('Preview navigation must remain in the current tab'); }
  };
  vm.runInNewContext(source.slice(start, end), { window, URL, modal() {}, actionSheet() {}, previewImage() {}, result(options, value, success = true) { const fn = success ? options.success : options.fail; if (fn) fn(value); return value; } });
  return { platform: window.wx, effects };
}

test('browser preview never substitutes sample GPS and opens only the destination map in the current tab', async () => {
  const f = previewPlatform();
  const service = createNearbyLocation(f.platform);
  await assert.rejects(service.locate(), error => error.code === 'LOCATION_UNSUPPORTED' && /已核实地点/.test(error.message));
  await assert.rejects(service.chooseReference(), { code: 'LOCATION_UNSUPPORTED' });
  assert.equal(service.getReference(), null);
  await service.navigateTo(destination, { name: '测试地点 & 路口', address: '仅测试地址' });
  assert.equal(f.effects.urls.length, 1);
  const url = new URL(f.effects.urls[0]);
  assert.equal(url.origin, 'https://apis.map.qq.com');
  assert.equal(url.searchParams.get('marker'), 'coord:31.107,121.38;title:测试地点 & 路口;addr:仅测试地址');
  assert.deepEqual(Array.from(url.searchParams.keys()).sort(), ['marker', 'referer'], 'the map URL contains no viewer origin or route-start parameter');
  assert.equal(f.effects.newWindows, 0);
  assert.equal(service.getReference(), null, 'opening a destination never establishes a sample user location');
  f.effects.navigationFails = true;
  await assert.rejects(service.navigateTo(destination), error => error.code === 'LOCATION_UNSUPPORTED' && /未能打开地图/.test(error.message) && !/新页面/.test(error.message));
  assert.equal(f.effects.urls.length, 1);
  assert.equal(f.effects.newWindows, 0);
  assert.equal(service.getReference(), null);
});

test('preview address searches encode only the public keyword and region, retaining dots inside a venue name', async () => {
  const f = previewPlatform();
  const forbidden = [];
  for (const name of ['getLocation', 'chooseLocation', 'getStorageSync', 'setStorageSync', 'removeStorageSync', 'setClipboardData']) {
    f.platform[name] = () => { forbidden.push(name); throw Error('Address search must not call ' + name); };
  }
  const service = createNearbyLocation(f.platform, { resolveNavigation() { throw Error('Preview search must not call the native resolver'); } });
  const cases = [
    { name: ' C·PARK & 猫咪#1 · 周末宠物活动（活动说明） ', city: ' 上海 & 周边 ', address: '不应替代场馆名的地址', keyword: 'C·PARK & 猫咪#1', region: '上海 & 周边' },
    { name: '上海动物园（仅供测试）', city: '上海', address: '公开地址', keyword: '上海动物园', region: '上海' },
    { name: '', city: '', address: ' 上海闵行 A+B?x=1&y=2 ', keyword: '上海闵行 A+B?x=1&y=2', region: '上海' }
  ];
  for (const item of cases) {
    await service.navigateByAddress({ id: 'fixture-place', name: item.name, city: item.city, address: item.address, viewerLatitude: 30.123456, privateOrigin: 'do-not-forward' });
    const actual = f.effects.urls.at(-1);
    const expected = 'https://apis.map.qq.com/uri/v1/search?keyword=' + encodeURIComponent(item.keyword) + '&region=' + encodeURIComponent(item.region) + '&referer=' + encodeURIComponent('有宠有邻');
    assert.equal(actual, expected);
    const parsed = new URL(actual);
    assert.deepEqual(Array.from(parsed.searchParams.keys()).sort(), ['keyword', 'referer', 'region']);
    assert.equal(parsed.searchParams.get('keyword'), item.keyword);
    assert.equal(parsed.searchParams.get('region'), item.region);
    assert.equal(parsed.hash, '');
    assert.doesNotMatch(actual, /30\.123456|do-not-forward/);
  }
  assert.deepEqual(forbidden, []);
  assert.equal(f.effects.newWindows, 0);
  f.effects.navigationFails = true;
  await assert.rejects(service.navigateByAddress({ id: 'fixture-place', name: '公开地点', address: '公开地址' }), error => error.code === 'LOCATION_UNSUPPORTED' && /未能打开地图/.test(error.message));
  assert.equal(f.effects.urls.length, cases.length);
  assert.deepEqual(forbidden, []);
});
