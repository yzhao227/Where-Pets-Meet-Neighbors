'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, idFor } = require('../cloudfunctions/community/service');
const { createSqliteRepository } = require('./helpers/sqlite-repository');
const catalogue = require('../cloudfunctions/community/place-catalogue');

const point = { latitude: 31.11, longitude: 121.38, coordinateSystem: 'gcj02' };
const place = { id: 'navigation-test', type: 'place', title: '测试公开场所', address: '闵行区测试路 100 号', city: '上海', active: true };
const rejectCode = (promise, code) => assert.rejects(promise, error => error.code === code);
async function fixture(t, geocode, options = {}) {
  const repository = createSqliteRepository(':memory:'); t.after(() => repository.close()); let serial = 0;
  const service = createService({ repository, now: () => Date.parse('2026-09-30T06:00:00Z'), randomId: () => String(++serial).padStart(24, '0'),
    ...(geocode ? { mapGeocoder: { enabled: true, geocode } } : {}), ...options });
  const call = (payload = { id: place.id }, openid = 'alice') => service.handle('getPlaceNavigation', payload, { openid });
  await service.handle('bootstrap', {}, { openid: 'alice' });
  await repository.set('place_records', place.id, place);
  return { repository, service, call };
}

test('known public coordinates work without map configuration and have the exact navigation contract', async t => {
  const f = await fixture(t);
  const original = { ...place, point: { ...point, sourceUrl: 'https://example.invalid', precision: 'venue' } };
  await f.repository.set('place_records', place.id, original);
  const before = await f.repository.get('place_records', place.id);
  assert.deepEqual(await f.call(), { point, name: place.title, address: place.address, resolvedFrom: 'catalogue' });
  assert.deepEqual(await f.repository.get('place_records', place.id), before);
  assert.deepEqual(await f.repository.find('rate_limits'), [], 'catalogue coordinates consume no geocoding quota');
});

test('address resolution uses only authoritative public address/city and never persists the result', async t => {
  const inputs = [];
  const f = await fixture(t, async input => { inputs.push(input); return { ...point, secret: 'not returned' }; });
  const user = await f.repository.get('users', idFor('alice'));
  await f.repository.set('users', user._id, { ...user, residenceCell: { latitude: 31.2, longitude: 121.5 }, area: '私人地址' });
  const before = await f.repository.get('place_records', place.id);
  assert.deepEqual(await f.call(), { point, name: place.title, address: place.address, resolvedFrom: 'address' });
  assert.deepEqual(inputs, [{ address: place.address, city: place.city }]);
  assert.deepEqual(await f.repository.get('place_records', place.id), before);
  assert.doesNotMatch(JSON.stringify(inputs), /residence|私人地址|userId|openid/);
});

test('navigation rejects arbitrary payload addresses, coordinates and identities before upstream calls', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return point; });
  for (const extra of [{ address: '用户指定地址' }, { latitude: 31.2 }, { longitude: 121.5 }, { point }, { city: '北京' }, { openid: 'bob' }, { userId: 'bob' }, { url: 'https://example.invalid' }]) {
    await rejectCode(f.call({ id: place.id, ...extra }), 'INVALID_INPUT');
  }
  for (const id of ['', '../other', 'x'.repeat(121), 1]) await rejectCode(f.call({ id }), 'INVALID_INPUT');
  await rejectCode(f.call({}), 'INVALID_INPUT');
  await rejectCode(f.service.handle('getPlaceNavigation', { id: place.id }), 'UNAUTHENTICATED');
  assert.equal(calls, 0);
});

test('unknown, inactive, unpublished and non-public records never resolve', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return point; });
  await rejectCode(f.call({ id: 'does-not-exist' }), 'NOT_FOUND');
  for (const extra of [{ active: false }, { published: false }, { deleted: true }, { public: false }, { visibility: 'private' },
    ...['draft', 'unpublished', 'withdrawn', 'deleted', 'private', 'hidden', 'inactive'].map(status => ({ status })), { type: 'user' }]) {
    await f.repository.set('place_records', place.id, { ...place, point, ...extra });
    await rejectCode(f.call(), 'NOT_FOUND');
  }
  const existing = catalogue.records.find(row => row.type === 'place');
  await f.repository.set('place_records', existing.id, { ...existing, active: false });
  await rejectCode(f.call({ id: existing.id }), 'NOT_FOUND');
  assert.equal(calls, 0, 'an inactive override does not fall back to the static catalogue');
});

test('invalid stored coordinates fall back to geocoding and injected results are validated again', async t => {
  let calls = 0; let resolved = point;
  const f = await fixture(t, async () => { calls++; return resolved; });
  await f.repository.set('place_records', place.id, { ...place, point: { ...point, coordinateSystem: 'wgs84' } });
  assert.equal((await f.call()).resolvedFrom, 'address');
  for (const invalid of [null, { ...point, latitude: 91 }, { ...point, longitude: '121' }, { ...point, coordinateSystem: 'wgs84' }]) {
    resolved = invalid;
    await rejectCode(f.call(), 'NAVIGATION_UNAVAILABLE');
  }
  assert.equal(calls, 5);
});

test('missing configuration and provider failures are safely reported', async t => {
  const missing = await fixture(t);
  await rejectCode(missing.call(), 'NAVIGATION_UNAVAILABLE');
  const broken = await fixture(t, async () => { throw new Error('secret-api-key-and-request-url'); });
  await assert.rejects(broken.call(), error => error.code === 'NAVIGATION_UNAVAILABLE' && !error.message.includes('secret') && !error.cause);
});

test('public event and exhibition records can resolve their authoritative venue address', async t => {
  const f = await fixture(t, async () => point);
  for (const type of ['event', 'exhibition']) {
    await f.repository.set('place_records', place.id, { ...place, type });
    assert.equal((await f.call()).resolvedFrom, 'address');
  }
});

test('public event availability statuses preserve navigation and prefer the venue name', async t => {
  const f = await fixture(t, async () => point);
  for (const type of ['event', 'exhibition']) {
    for (const status of ['upcoming', 'ongoing', 'ended', 'cancelled']) {
      const venue = '测试活动场馆';
      await f.repository.set('place_records', place.id, { ...place, type, status, venue });
      assert.deepEqual(await f.call(), { point, name: venue, address: place.address, resolvedFrom: 'address' });
      await f.repository.set('place_records', place.id, { ...place, type, status, venue, point });
      assert.deepEqual(await f.call(), { point, name: venue, address: place.address, resolvedFrom: 'catalogue' });
    }
  }
});

test('in-flight event navigation refuses a changed venue name even if its address was not yet corrected', async t => {
  let finish; let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, () => new Promise(resolve => { finish = resolve; started(); }));
  const event = { ...place, type: 'event', status: 'upcoming', venue: '原活动场馆' };
  await f.repository.set('place_records', place.id, event);
  const navigation = f.call(); await ready;
  await f.repository.set('place_records', place.id, { ...event, venue: '新活动场馆' });
  finish(point);
  await rejectCode(navigation, 'NAVIGATION_UNAVAILABLE');
});

for (const change of [
  { label: 'address moved', value: { address: '闵行区另一个地址' }, code: 'NAVIGATION_UNAVAILABLE' },
  { label: 'city changed', value: { city: '北京' }, code: 'NAVIGATION_UNAVAILABLE' },
  { label: 'title changed', value: { title: '另一个场所' }, code: 'NAVIGATION_UNAVAILABLE' },
  { label: 'coordinates corrected', value: { point: { ...point, latitude: 31.4 } }, code: 'NAVIGATION_UNAVAILABLE' },
  { label: 'withdrawn', value: { active: false }, code: 'NOT_FOUND' },
  { label: 'unpublished', value: { published: false }, code: 'NOT_FOUND' }
]) test('in-flight resolution refuses a destination that was ' + change.label, async t => {
  let finish; let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, () => new Promise(resolve => { finish = resolve; started(); }));
  const navigation = f.call(); await ready;
  await f.repository.set('place_records', place.id, { ...place, ...change.value });
  finish(point);
  await rejectCode(navigation, change.code);
});

for (const state of ['deleting', 'deleted', 'recreated']) test('navigation rechecks the account after geocoding: ' + state, async t => {
  let finish; let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, () => new Promise(resolve => { finish = resolve; started(); }));
  const navigation = f.call(); await ready;
  const user = await f.repository.get('users', idFor('alice'));
  await f.repository.set('users', user._id, { ...user, status: state === 'recreated' ? 'active' : state, ...(state === 'recreated' ? { lifecycleId: 'new-lifecycle' } : {}) });
  finish(point);
  await rejectCode(navigation, 'ACCOUNT_UNAVAILABLE');
});

test('deleted and deleting accounts cannot request existing coordinates', async t => {
  const f = await fixture(t);
  await f.repository.set('place_records', place.id, { ...place, point });
  const user = await f.repository.get('users', idFor('alice'));
  for (const status of ['deleting', 'deleted']) {
    await f.repository.set('users', user._id, { ...user, status });
    await rejectCode(f.call(), 'ACCOUNT_UNAVAILABLE');
  }
});

test('address resolution is rate limited per account, while known destinations remain usable', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return point; });
  for (let index = 0; index < 20; index++) await f.call();
  await rejectCode(f.call(), 'RATE_LIMITED');
  assert.equal(calls, 20);
  await f.repository.set('place_records', place.id, { ...place, point });
  assert.equal((await f.call()).resolvedFrom, 'catalogue');
});
