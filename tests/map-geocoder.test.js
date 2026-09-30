'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { createMapGeocoder } = require('../cloudfunctions/community/map-geocoder');
const { AppError } = require('../cloudfunctions/community/service');

const environment = { TENCENT_MAP_KEY: 'test-map-secret-never-return' };
const input = { address: '闵行区测试路 100 号', city: '上海' };
const point = { latitude: 31.11, longitude: 121.38, coordinateSystem: 'gcj02' };
const result = extra => ({ location: { lat: point.latitude, lng: point.longitude }, reliability: 7, level: 9, address_components: { city: '上海市' }, ...extra });
const response = extra => ({ statusCode: 200, body: JSON.stringify({ status: 0, result: result(extra) }) });
const rejectUnavailable = promise => assert.rejects(promise, error => {
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'NAVIGATION_UNAVAILABLE');
  assert.doesNotMatch(error.message + JSON.stringify(error) + error.stack, /test-map-secret|provider-private|apis\.map\.qq/);
  assert.equal(error.cause, undefined);
  return true;
});

test('geocoder uses only the fixed HTTPS endpoint and returns validated GCJ-02 coordinates', async () => {
  let requestUrl; let options;
  const geocoder = createMapGeocoder(environment, { request: async (url, value) => { requestUrl = new URL(url); options = value; return response(); } });
  assert.equal(geocoder.enabled, true);
  assert.deepEqual(await geocoder.geocode(input), point);
  assert.equal(requestUrl.origin, 'https://apis.map.qq.com');
  assert.equal(requestUrl.pathname, '/ws/geocoder/v1/');
  assert.deepEqual(Object.fromEntries(requestUrl.searchParams), { address: '上海闵行区测试路 100 号', key: environment.TENCENT_MAP_KEY, policy: '0', output: 'json' });
  assert.equal(options.timeoutMs, 4500);
  assert.equal(options.maxBytes, 65536);
  assert.ok(options.signal instanceof AbortSignal);
});

test('geocoder requires configuration and bounded city/address strings before any request', async () => {
  let calls = 0; const request = async () => { calls++; return response(); };
  const disabled = createMapGeocoder({}, { request });
  assert.equal(disabled.enabled, false);
  await rejectUnavailable(disabled.geocode(input));
  const enabled = createMapGeocoder(environment, { request });
  for (const invalid of [null, {}, { ...input, address: '' }, { ...input, address: 'x'.repeat(241) }, { ...input, address: '一号\n街道' },
    { ...input, city: '' }, { ...input, city: '市' }, { ...input, city: 'x'.repeat(41) }]) await rejectUnavailable(enabled.geocode(invalid));
  assert.equal(calls, 0);
});

test('geocoder rejects low precision, wrong city, invalid coordinates and provider errors', async t => {
  const invalid = [
    ['reliability', response({ reliability: 6 })], ['fractional reliability', response({ reliability: 7.5 })],
    ['street rather than address', response({ level: 7 })], ['entrance level', response({ level: 8 })], ['string level', response({ level: '9' })],
    ['city mismatch', response({ address_components: { city: '北京市' } })], ['missing city', response({ address_components: {} })],
    ['missing coordinates', response({ location: {} })], ['latitude', response({ location: { lat: 91, lng: 121 } })],
    ['longitude', response({ location: { lat: 31, lng: 181 } })], ['string coordinates', response({ location: { lat: '31', lng: 121 } })],
    ['provider status', { statusCode: 200, body: JSON.stringify({ status: 120, message: 'provider-private ' + environment.TENCENT_MAP_KEY }) }],
    ['redirect', { statusCode: 302, body: '{}' }], ['http failure', { statusCode: 500, body: '{}' }],
    ['malformed JSON', { statusCode: 200, body: 'not-json' }], ['null response', { statusCode: 200, body: 'null' }],
    ['object body', { statusCode: 200, body: { status: 0, result: result() } }], ['oversized body', { statusCode: 200, body: ' '.repeat(65537) }]
  ];
  for (const [name, value] of invalid) await t.test(name, () => rejectUnavailable(createMapGeocoder(environment, { request: async () => value }).geocode(input)));
});

test('geocoder sanitizes thrown provider errors and aborts even a transport that ignores its signal', async () => {
  await rejectUnavailable(createMapGeocoder(environment, { request: async () => { throw new Error('provider-private key=' + environment.TENCENT_MAP_KEY); } }).geocode(input));
  let signal;
  const geocoder = createMapGeocoder(environment, { timeoutMs: 10, request: (_, options) => { signal = options.signal; return new Promise(() => {}); } });
  await rejectUnavailable(geocoder.geocode(input));
  assert.equal(signal.aborted, true);
});

test('geocoder coalesces requests and caches only successful results with isolated return values', async () => {
  let calls = 0; let release; let clock = 100;
  const geocoder = createMapGeocoder(environment, { now: () => clock, cacheMs: 100,
    request: async () => { calls++; await new Promise(resolve => { release = resolve; }); return response(); } });
  const first = geocoder.geocode(input); const second = geocoder.geocode(input);
  await Promise.resolve(); assert.equal(calls, 1); release();
  const [a, b] = await Promise.all([first, second]);
  a.latitude = 88;
  assert.deepEqual(b, point);
  assert.deepEqual(await geocoder.geocode(input), point);
  assert.equal(calls, 1);
  clock = 200;
  const expired = geocoder.geocode(input); await Promise.resolve(); assert.equal(calls, 2); release();
  assert.deepEqual(await expired, point);
});

test('geocoder cache is bounded and address/city changes require fresh validation', async () => {
  let calls = 0;
  const geocoder = createMapGeocoder(environment, { maxCacheEntries: 1, request: async () => { calls++; return response(); } });
  await geocoder.geocode(input);
  await geocoder.geocode({ ...input, address: '测试路 101 号' });
  assert.equal(calls, 2);
  await geocoder.geocode(input);
  assert.equal(calls, 3, 'the older entry was evicted');
  await rejectUnavailable(geocoder.geocode({ ...input, city: '北京' }));
  assert.equal(calls, 4);
  await rejectUnavailable(geocoder.geocode({ ...input, city: '北京' }));
  assert.equal(calls, 5, 'failed responses are not cached');
});

test('geocoder bounds in-flight work separately from the successful cache', async () => {
  let release;
  const geocoder = createMapGeocoder(environment, { maxCacheEntries: 1, request: () => new Promise(resolve => { release = () => resolve(response()); }) });
  const first = geocoder.geocode(input); await Promise.resolve();
  await rejectUnavailable(geocoder.geocode({ ...input, address: '另一个地址' }));
  release(); assert.deepEqual(await first, point);
});

test('default HTTP transport handles stream failures and enforces response limits without network access', async t => {
  let scenario; let destroyed = false;
  t.mock.method(https, 'get', (_url, _options, onResponse) => {
    const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = error => request.emit('error', error);
    queueMicrotask(() => {
      const stream = new EventEmitter(); stream.statusCode = scenario === 'redirect' ? 302 : 200;
      stream.resume = () => {};
      stream.destroy = error => { destroyed = true; stream.emit('error', error); };
      onResponse(stream);
      if (scenario === 'oversized') stream.emit('data', Buffer.alloc(65537));
      else if (scenario === 'aborted') stream.emit('aborted');
      else if (scenario === 'error' || scenario === 'redirect') stream.emit('error', new Error('provider-private ' + environment.TENCENT_MAP_KEY));
      else { stream.emit('data', Buffer.from(response().body)); stream.emit('end'); }
    });
    return request;
  });
  for (scenario of ['oversized', 'aborted', 'error', 'redirect']) await rejectUnavailable(createMapGeocoder(environment).geocode(input));
  assert.equal(destroyed, true);
  scenario = 'valid';
  assert.deepEqual(await createMapGeocoder(environment).geocode(input), point);
});
