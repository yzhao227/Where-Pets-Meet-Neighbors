'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getTimeStatus, selectNearbyRecords } = require('../miniprogram/data/nearby-utils');

test('local scene photo whitelist stays within packaged nearby JPEG or WebP files', () => {
  const { isLocalScenePhoto } = require('../miniprogram/data/nearby-utils');
  for (const value of ['/assets/nearby/xinzhuang-park.jpg', '/assets/nearby/park_1.jpeg', '/assets/nearby/venue.webp']) assert.equal(isLocalScenePhoto(value), true, value);
  for (const value of [undefined, null, {}, '', '/assets/avatar.jpg', '/assets/nearby/../avatar.jpg', '/assets/nearby/sub/park.jpg', '/assets/nearby/%2e%2e-park.jpg', '/assets/nearby/park.jpg?x=1', '/assets/nearby/park.svg', '/assets/nearby/park.png', 'wxfile://park.jpg', 'https://example.invalid/park.jpg']) assert.equal(isLocalScenePhoto(value), false, String(value));
});

const NOW = '2026-09-29T12:00:00+08:00';
function event(id, startsAt = '2026-10-01T09:00:00+08:00', endsAt = '2026-10-01T17:00:00+08:00', extra = {}) {
  return { id, type: 'event', title: '仅测试活动', area: '莘庄', city: '上海', startsAt, endsAt, ...extra };
}
function place(id, status = 'unknown', extra = {}) {
  return { id, type: 'place', title: '仅测试地点', area: '莘庄', city: '上海', petPolicy: { status, text: '仅测试规则' }, ...extra };
}
function ids(records, options = {}) {
  return selectNearbyRecords(records, { now: NOW, ...options }).map(record => record.id);
}

test('event status uses the explicit time zone and exact start/end boundaries', () => {
  const item = event('time');
  assert.equal(getTimeStatus(item, '2026-10-01T08:59:59+08:00'), 'upcoming');
  assert.equal(getTimeStatus(item, '2026-10-01T01:00:00Z'), 'ongoing');
  assert.equal(getTimeStatus(item, '2026-10-01T16:59:59+08:00'), 'ongoing');
  assert.equal(getTimeStatus(item, '2026-10-01T17:00:00+08:00'), 'ended');
  assert.equal(getTimeStatus(item, new Date('2026-10-01T09:00:00+08:00')), 'ongoing');
  assert.equal(getTimeStatus(item, Date.parse('2026-10-01T09:00:00+08:00')), 'ongoing');
});

test('invalid, incomplete, reversed, or timezone-less dates are never treated as current events', () => {
  const invalid = [
    event('missing', undefined, null),
    event('date-only', '2026-10-01', '2026-10-02'),
    event('local-zone', '2026-10-01T09:00:00', '2026-10-01T17:00:00'),
    event('bad-day', '2026-02-30T09:00:00+08:00', '2026-03-01T17:00:00+08:00'),
    event('bad-leap', '2026-02-29T09:00:00+08:00', '2026-03-01T17:00:00+08:00'),
    event('reversed', '2026-10-02T09:00:00+08:00', '2026-10-01T17:00:00+08:00'),
    event('zero', '2026-10-01T09:00:00+08:00', '2026-10-01T09:00:00+08:00'),
    event('bad-zone', '2026-10-01T09:00:00+15:00'),
    event('bad-hour', '2026-10-01T24:00:00+08:00')
  ];
  assert.ok(invalid.every(item => getTimeStatus(item, NOW) === 'undated'));
  assert.deepEqual(ids(invalid), []);
  assert.deepEqual(ids(invalid, { history: true }), []);
  assert.equal(getTimeStatus(event('valid-leap', '2028-02-29T09:00:00+08:00', '2028-02-29T17:00:00+08:00'), NOW), 'upcoming');
  assert.equal(getTimeStatus(event('invalid-now'), '2026-09-29'), 'undated');
});

test('the default event list excludes old, undated, and cancelled listings', () => {
  const records = [
    event('future'),
    event('ongoing', '2026-09-28T09:00:00+08:00', '2026-09-30T17:00:00+08:00'),
    event('old', '2026-08-01T09:00:00+08:00', '2026-08-01T17:00:00+08:00'),
    event('undated', null, null),
    event('cancelled', undefined, undefined, { status: 'cancelled' })
  ];
  assert.deepEqual(ids(records), ['future', 'ongoing']);
  assert.deepEqual(ids(records, { history: true }), ['old']);
  assert.deepEqual(ids(records, { includeCancelled: true }), ['future', 'ongoing', 'cancelled']);
  assert.equal(getTimeStatus(records[4], NOW), 'cancelled');
});

test('a cancelled entry remains cancelled even when its published date is old or missing', () => {
  const item = event('cancelled', null, null, { status: 'cancelled' });
  assert.equal(getTimeStatus(item, NOW), 'cancelled');
  assert.deepEqual(ids([item], { history: true }), []);
  assert.deepEqual(ids([item], { history: true, includeCancelled: true }), ['cancelled']);
});

test('places have no event clock and cannot disappear just because their dates are missing', () => {
  const records = [place('park'), place('cancelled', 'unknown', { status: 'cancelled' })];
  assert.equal(getTimeStatus(records[0], NOW), null);
  assert.deepEqual(ids(records, { kind: 'place' }), ['park']);
  assert.deepEqual(ids(records, { kind: 'place', history: true }), ['park']);
});

test('types, area, and search combine without leaking other record types', () => {
  const records = [
    place('one', 'allowed', { title: '试用 PAW 空间', address: '测试路 1 号', summary: '仅测试室内空间' }),
    place('other-area', 'allowed', { area: '七宝', title: '试用 PAW 空间' }),
    event('show', undefined, undefined, { type: 'exhibition', title: '试用 PAW 展览' }),
    event('party', undefined, undefined, { title: '试用 PAW 聚会' }),
    { id: 'invalid', type: 'post', title: '试用 PAW 内容' }
  ];
  assert.deepEqual(ids(records, { kind: 'place', area: ' 莘庄 ', query: '  PAw  测试路  ' }), ['one']);
  assert.deepEqual(ids(records, { kind: ['exhibition', 'event'], query: 'paw' }), ['show', 'party']);
  assert.deepEqual(ids(records, { kind: 'place', area: '全部' }), ['one', 'other-area']);
  assert.deepEqual(ids(records, { kind: 'place', area: '莘' }), []);
  assert.deepEqual(ids(records, { query: '找不到的词' }), []);
  assert.deepEqual(ids(records, { kind: 'post' }), []);
});

test('with-pet filter never presents unknown or forbidden venues as pet friendly', () => {
  const records = [place('allowed', 'allowed'), place('conditional', 'conditional'), place('forbidden', 'not_allowed'), place('unknown'), { id: 'missing', type: 'place' }];
  assert.deepEqual(ids(records, { petFilter: 'with' }), ['allowed', 'conditional']);
  assert.deepEqual(ids(records, { petFilter: 'all' }), records.map(item => item.id));
});

test('no-pet-required describes visitors, independently of the venue admission policy', () => {
  const records = [
    place('can-bring-or-not', 'allowed', { noPetRequired: true }),
    place('no-pets', 'not_allowed', { noPetRequired: true }),
    place('human-visit-policy-unknown', 'not_allowed'),
    event('bring-pet-required', undefined, undefined, { noPetRequired: false, petPolicy: { status: 'allowed' } })
  ];
  assert.deepEqual(ids(records, { petFilter: 'without' }), ['can-bring-or-not', 'no-pets']);
  assert.deepEqual(ids(records, { petFilter: 'with' }), ['can-bring-or-not', 'bring-pet-required']);
});

test('selection preserves editorial order and input data while exposing derived status', () => {
  const records = [event('b'), place('a', 'conditional'), event('c')];
  const snapshot = structuredClone(records);
  records.forEach(Object.freeze);
  Object.freeze(records);
  const selected = selectNearbyRecords(records, { now: NOW });
  assert.deepEqual(selected.map(item => item.id), ['b', 'a', 'c']);
  assert.deepEqual(selected.map(item => item.timeStatus), ['upcoming', null, 'upcoming']);
  assert.deepEqual(records, snapshot);
  assert.notEqual(selected[0], records[0]);
});

test('invalid input produces an empty list rather than breaking the nearby page', () => {
  assert.deepEqual(selectNearbyRecords(null), []);
  assert.deepEqual(selectNearbyRecords({}), []);
  assert.deepEqual(selectNearbyRecords([null, false, 3, {}, { type: 'unknown' }]), []);
  assert.deepEqual(selectNearbyRecords([place('valid')], null).map(item => item.id), ['valid']);
  assert.deepEqual(ids([event('clock-unavailable')], { now: NaN }), []);
});

test('district and play filters compose with area while unknown play labels never become choices', () => {
  const records = [
    place('walk-minhang', 'conditional', { district: '闵行', playTags: ['walk', 'lawn'], petPlayTags: ['walk', 'lawn'] }),
    place('hangout-minhang', 'unknown', { district: '闵行', playTags: ['hangout'], petPlayTags: ['hangout'] }),
    place('walk-xuhui', 'allowed', { district: '徐汇', area: '西岸', playTags: ['walk'], petPlayTags: ['walk'] }),
    place('legacy-only', 'allowed', { district: '闵行', playTags: ['walk', 'hangout'] })
  ];
  assert.deepEqual(ids(records, { district: '闵行', playTag: 'walk' }), ['walk-minhang']);
  assert.deepEqual(ids(records, { district: '徐汇', area: '西岸', query: '牵绳散步' }), ['walk-xuhui']);
  assert.deepEqual(ids(records, { district: '闵行', petFilter: 'with', playTag: 'hangout' }), []);
  assert.deepEqual(ids(records, { playTag: 'made-up' }), []);
  const { playTagsFor, selectAnnouncements } = require('../miniprogram/data/nearby-utils');
  assert.deepEqual(playTagsFor({ petPolicy: { status: 'conditional' }, petPlayTags: ['walk', 'made-up', 'walk'] }).map(tag => tag.id), ['walk']);
  assert.deepEqual(playTagsFor({ petPolicy: { status: 'allowed' }, playTags: ['walk', 'made-up', 'walk'] }), []);
  const notices = [{ id: 'notice', type: 'exhibition', district: '徐汇', playTags: ['exhibition'], announcementMonth: '2027-04' }];
  assert.equal(selectAnnouncements(notices, { now: NOW, district: '闵行' }).length, 0);
  assert.equal(selectAnnouncements(notices, { now: NOW, district: '徐汇', playTag: 'walk' }).length, 0);
  assert.equal(selectAnnouncements(notices, { now: NOW, district: '徐汇' }).length, 1);
  assert.equal(selectAnnouncements(notices, { now: NOW, district: '徐汇', playTag: 'exhibition' }).length, 0);
});
