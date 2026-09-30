'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_FILTERS, dateWindow, filterCards, sortCards, groupsFor, activeFilters
} = require('../miniprogram/data/nearby-controls');
const { playTagsFor, selectNearbyRecords, selectAnnouncements } = require('../miniprogram/data/nearby-utils');

const NOW = Date.parse('2026-09-30T12:00:00+08:00');
const ids = items => items.map(item => item.id);
const policy = status => ({ status, text: '仅供内存测试的携宠规则' });
const distance = meters => ({ meters, label: `${meters}m` });
const source = (publishedAt, checkedAt = '2026-09-30') => ({ publishedAt, checkedAt });
function place(id, extra = {}) {
  return { id, type: 'place', title: '仅测试地点', petPolicy: policy('conditional'), placeKind: 'park', feeType: 'unknown', ...extra };
}
function event(id, startsAt, endsAt, extra = {}) {
  return { id, type: 'event', title: '仅测试活动', petPolicy: policy('conditional'), feeType: 'unknown', startsAt, endsAt, ...extra };
}

test('recommended places prioritize evidenced pet admission, then recheck status, distance and publication recency', () => {
  const records = [
    place('forbidden-near', { petPolicy: policy('not_allowed'), distance: distance(1) }),
    place('unknown-near', { petPolicy: policy('unknown'), distance: distance(5) }),
    place('conditional-recheck', { needsRecheck: true, distance: distance(10) }),
    place('conditional-far', { distance: distance(1200), sources: [source('2026-09-29')] }),
    place('same-distance-old', { distance: distance(400), sources: [source('2026-09-01')] }),
    place('same-distance-new', { petPolicy: policy('allowed'), distance: distance(400), sources: [source('2026-09-20')] }),
    place('allowed-no-coordinate', { petPolicy: policy('allowed') })
  ];
  const snapshot = structuredClone(records);
  Object.freeze(records);
  assert.deepEqual(ids(sortCards(records, 'recommended', 'places')), [
    'same-distance-new', 'same-distance-old', 'conditional-far', 'allowed-no-coordinate',
    'conditional-recheck', 'unknown-near', 'forbidden-near'
  ]);
  assert.deepEqual(records, snapshot, 'sorting cannot reorder or rewrite the shared catalogue');
});

test('recommended activities put ongoing events before upcoming events and then use their opening order', () => {
  const records = [
    event('tomorrow', '2026-10-01T09:00:00+08:00', '2026-10-01T18:00:00+08:00'),
    event('ongoing-later-start', '2026-09-30T10:00:00+08:00', '2026-09-30T15:00:00+08:00'),
    event('later-today', '2026-09-30T17:00:00+08:00', '2026-09-30T20:00:00+08:00'),
    event('ongoing-earlier-start', '2026-09-29T09:00:00+08:00', '2026-10-01T18:00:00+08:00'),
    event('same-start-unknown', '2026-09-30T14:00:00+08:00', '2026-09-30T17:00:00+08:00', { petPolicy: policy('unknown') }),
    event('same-start-conditional', '2026-09-30T14:00:00+08:00', '2026-09-30T17:00:00+08:00')
  ];
  const current = selectNearbyRecords(records, { kind: 'event', now: NOW });
  assert.deepEqual(ids(sortCards(current, 'recommended', 'activities')), [
    'ongoing-earlier-start', 'ongoing-later-start', 'same-start-conditional',
    'same-start-unknown', 'later-today', 'tomorrow'
  ]);
  assert.deepEqual(ids(sortCards(current, 'date', 'activities')).slice(0, 2), ['ongoing-earlier-start', 'ongoing-later-start']);
});

test('past activities rank by latest ending rather than latest starting and undated notices stay last', () => {
  const history = selectNearbyRecords([
    event('short-later-start', '2026-09-28T10:00:00+08:00', '2026-09-28T18:00:00+08:00'),
    event('long-latest-end', '2026-09-20T10:00:00+08:00', '2026-09-29T18:00:00+08:00'),
    event('old', '2026-08-01T10:00:00+08:00', '2026-08-01T18:00:00+08:00')
  ], { kind: 'event', history: true, now: NOW });
  const withNotice = [{ id: 'undated', type: 'exhibition', announcementMonth: '2026-10' }, ...history];
  for (const sort of ['recommended', 'date']) {
    assert.deepEqual(ids(sortCards(withNotice, sort, 'activities', true)), ['long-latest-end', 'short-later-start', 'old', 'undated']);
  }
});

test('latest news uses the newest explicit source publication date, never the checked date or event date', () => {
  const records = [
    place('checked-today', { sources: [source('2026-05-01', '2026-09-30')] }),
    place('no-publication', { checkedAt: '2026-10-01', sources: [source('', '2026-10-01')], startsAt: '2027-04-01T09:00:00+08:00' }),
    place('new-source-added', { sources: [source('2026-01-01'), source('2026-09-28', '2026-09-28')] }),
    place('newly-published', { sources: [source('2026-09-20', '2026-09-21')] }),
    place('month-only-publication', { sources: [source('2026-10')] })
  ];
  assert.deepEqual(ids(sortCards(records, 'recent', 'places')), [
    'new-source-added', 'newly-published', 'checked-today', 'no-publication', 'month-only-publication'
  ]);
});

test('distance sorting puts absent coordinates last and accepts a location exactly at the reference point', () => {
  const records = [place('missing'), place('far', { distance: distance(5100) }),
    place('null-distance', { distance: null }), place('near', { distance: distance(500) }),
    place('at-reference', { distance: distance(0) })];
  const originalIds = ids(records);
  assert.deepEqual(ids(sortCards(records, 'distance', 'places')), ['at-reference', 'near', 'far', 'missing', 'null-distance']);
  assert.deepEqual(ids(records), originalIds);
});

test('a radius includes its boundary and excludes records whose distance is unknown', () => {
  const records = [place('missing'), place('at-reference', { distance: distance(0) }),
    place('inside', { distance: distance(2999) }), place('boundary', { distance: distance(3000) }),
    place('outside', { distance: distance(3001) })];
  assert.deepEqual(ids(filterCards(records, { radius: '3' })), ['at-reference', 'inside', 'boundary']);
  assert.deepEqual(ids(filterCards(records, { radius: 'all' })), ids(records));
});

test('free priority advances only confirmed free participation, independent of pet requirements or points', () => {
  const records = [
    place('price-unknown', { noPetRequired: true }),
    place('points-required', { ticketText: '需要300积分预约', noPetRequired: true }),
    place('paid-human-visit', { feeType: 'paid', noPetRequired: true }),
    place('free-with-pet', { feeType: 'free', noPetRequired: false }),
    place('fee-field-missing', { feeType: undefined, noPetRequired: true }),
    place('free-human-visit', { feeType: 'free', noPetRequired: true })
  ];
  assert.deepEqual(ids(sortCards(records, 'free', 'activities')), [
    'free-with-pet', 'free-human-visit', 'price-unknown', 'points-required', 'paid-human-visit', 'fee-field-missing'
  ]);
  assert.deepEqual(ids(filterCards(records, { feeType: 'free' })), ['free-with-pet', 'free-human-visit']);
  assert.deepEqual(ids(filterCards(records, { feeType: 'unknown' })), ['price-unknown', 'points-required', 'fee-field-missing']);
});

test('Shanghai Sunday still belongs to this weekend, including while UTC is Saturday', () => {
  const expected = [Date.parse('2026-10-03T00:00:00+08:00'), Date.parse('2026-10-05T00:00:00+08:00')];
  for (const now of ['2026-10-03T12:00:00+08:00', '2026-10-04T00:30:00+08:00', '2026-10-04T23:59:59+08:00']) {
    assert.deepEqual(dateWindow('weekend', Date.parse(now)), expected, now);
  }
  assert.deepEqual(dateWindow('weekend', Date.parse('2026-10-05T00:00:00+08:00')), [
    Date.parse('2026-10-10T00:00:00+08:00'), Date.parse('2026-10-12T00:00:00+08:00')
  ]);
});

test('today uses Shanghai midnight and keeps cross-midnight events that overlap the day', () => {
  const now = Date.parse('2026-09-30T00:30:00+08:00');
  assert.deepEqual(dateWindow('today', now), [Date.parse('2026-09-29T16:00:00Z'), Date.parse('2026-09-30T16:00:00Z')]);
  const records = [
    event('ends-at-midnight', '2026-09-29T20:00:00+08:00', '2026-09-30T00:00:00+08:00'),
    event('overnight', '2026-09-29T23:00:00+08:00', '2026-09-30T01:00:00+08:00'),
    event('starts-at-midnight', '2026-09-29T16:00:00Z', '2026-09-29T17:00:00Z'),
    event('spans-day', '2026-09-29T10:00:00+08:00', '2026-10-02T10:00:00+08:00'),
    event('next-midnight', '2026-10-01T00:00:00+08:00', '2026-10-01T01:00:00+08:00')
  ];
  assert.deepEqual(ids(filterCards(records, { dateRange: 'today' }, now)), ['overnight', 'starts-at-midnight', 'spans-day']);
});

test('weekend filtering includes overlapping events and excludes Monday and the next weekend', () => {
  const records = [
    event('saturday', '2026-10-03T09:00:00+08:00', '2026-10-03T18:00:00+08:00'),
    event('friday-through-sunday', '2026-10-02T09:00:00+08:00', '2026-10-04T18:00:00+08:00'),
    event('sunday-night', '2026-10-04T23:00:00+08:00', '2026-10-05T01:00:00+08:00'),
    event('monday', '2026-10-05T00:00:00+08:00', '2026-10-05T12:00:00+08:00'),
    event('next-saturday', '2026-10-10T09:00:00+08:00', '2026-10-10T18:00:00+08:00')
  ];
  assert.deepEqual(ids(filterCards(records, { dateRange: 'weekend' }, Date.parse('2026-10-04T08:00:00+08:00'))), [
    'saturday', 'friday-through-sunday', 'sunday-night'
  ]);
});

test('7-day and 30-day windows use interval overlap across calendar months, with an exclusive end', () => {
  const records = [
    event('spans-entire-window', '2026-09-01T00:00:00+08:00', '2026-11-01T00:00:00+08:00'),
    event('last-week-day', '2026-10-06T23:00:00+08:00', '2026-10-07T01:00:00+08:00'),
    event('after-week', '2026-10-07T00:00:00+08:00', '2026-10-07T12:00:00+08:00'),
    event('last-month-day', '2026-10-29T23:00:00+08:00', '2026-10-30T01:00:00+08:00'),
    event('after-month', '2026-10-30T00:00:00+08:00', '2026-10-30T12:00:00+08:00')
  ];
  assert.deepEqual(ids(filterCards(records, { dateRange: 'week' }, NOW)), ['spans-entire-window', 'last-week-day']);
  assert.deepEqual(ids(filterCards(records, { dateRange: 'month' }, NOW)), ['spans-entire-window', 'last-week-day', 'after-week', 'last-month-day']);
});

test('month-only announcements remain visible without a date filter but never satisfy a precise date range', () => {
  const announcements = selectAnnouncements([
    { id: 'month-only', type: 'exhibition', announcementMonth: '2026-10', petPolicy: policy('unknown'), feeType: 'unknown' }
  ], { now: NOW });
  assert.deepEqual(ids(filterCards(announcements, { dateRange: 'all' }, NOW)), ['month-only']);
  for (const dateRange of ['today', 'weekend', 'week', 'month']) {
    assert.deepEqual(filterCards(announcements, { dateRange }, NOW), [], dateRange);
  }
});

test('place facets intersect pet admission, place type, known fees, photos and radius', () => {
  const match = place('match', { feeType: 'free', photoUrl: '/assets/nearby/fixture.jpg', distance: distance(2500) });
  const records = [match,
    { ...match, id: 'unknown-admission', petPolicy: policy('unknown') },
    { ...match, id: 'wrong-kind', placeKind: 'commercial' },
    { ...match, id: 'unknown-fee', feeType: 'unknown' },
    { ...match, id: 'no-photo', photoUrl: '' },
    { ...match, id: 'outside-radius', distance: distance(3001) },
    { ...match, id: 'unknown-distance', distance: null }
  ];
  const settings = { ...DEFAULT_FILTERS, petFilter: 'with', placeKind: 'park', feeType: 'free', photosOnly: true, radius: '3' };
  const snapshot = structuredClone(settings);
  assert.deepEqual(ids(filterCards(records, settings, NOW)), ['match']);
  assert.deepEqual(settings, snapshot, 'applying facets does not rewrite the selected controls');
  assert.deepEqual(ids(filterCards(records, DEFAULT_FILTERS, NOW)), ids(records), 'clearing facets restores all candidates');
});

test('event-kind and fee facets compose while no-pet-required remains independent from admission and price', () => {
  const records = [
    event('paid-exhibition', '2026-10-01T09:00:00+08:00', '2026-10-03T18:00:00+08:00', { type: 'exhibition', feeType: 'paid', petPolicy: policy('not_allowed'), noPetRequired: true }),
    event('paid-event', '2026-10-01T09:00:00+08:00', '2026-10-03T18:00:00+08:00', { feeType: 'paid', noPetRequired: true }),
    event('unknown-exhibition', '2026-10-01T09:00:00+08:00', '2026-10-03T18:00:00+08:00', { type: 'exhibition', feeType: undefined, petPolicy: undefined, noPetRequired: true }),
    event('pet-required', '2026-10-01T09:00:00+08:00', '2026-10-03T18:00:00+08:00', { noPetRequired: false })
  ];
  assert.deepEqual(ids(filterCards(records, { eventKind: 'exhibition', feeType: 'paid', petFilter: 'without', dateRange: 'week' }, NOW)), ['paid-exhibition']);
  assert.deepEqual(ids(filterCards(records, { eventKind: 'exhibition', feeType: 'unknown', petFilter: 'unknown' }, NOW)), ['unknown-exhibition']);
  assert.deepEqual(ids(filterCards(records, { petFilter: 'without' })), ['paid-exhibition', 'paid-event', 'unknown-exhibition']);
});

test('active filter summaries follow the current tab and hide date ranges for historical activities', () => {
  const filters = { ...DEFAULT_FILTERS, placeKind: 'park', eventKind: 'exhibition', feeType: 'paid', dateRange: 'week', photosOnly: true };
  assert.deepEqual(activeFilters('places', filters).map(item => item.key), ['placeKind', 'feeType', 'photosOnly']);
  assert.deepEqual(activeFilters('activities', filters).map(item => item.key), ['eventKind', 'dateRange', 'feeType', 'photosOnly']);
  const historical = { ...filters, period: 'past' };
  assert.equal(groupsFor('activities', historical).some(group => group.key === 'dateRange'), false);
  assert.deepEqual(activeFilters('activities', historical).map(item => item.key), ['period', 'eventKind', 'feeType', 'photosOnly']);
  assert.deepEqual(activeFilters('places', DEFAULT_FILTERS), []);
});

test('pet play tags require both explicit pet-specific evidence and allowed or conditional admission', () => {
  for (const status of ['allowed', 'conditional']) {
    const tags = playTagsFor(place('eligible', { petPolicy: policy(status), playTags: ['hangout'], petPlayTags: ['walk', 'lawn', 'walk', 'made-up', 'exhibition', 'animals'] }));
    assert.deepEqual(tags.map(tag => tag.id), ['walk', 'lawn'], status);
    assert.ok(tags.every(tag => tag.name && tag.description));
  }
  for (const status of ['unknown', 'not_allowed', undefined]) {
    assert.deepEqual(playTagsFor(place('unconfirmed', { petPolicy: status ? policy(status) : undefined, petPlayTags: ['walk', 'lawn'] })), [], String(status));
  }
  assert.deepEqual(playTagsFor(place('legacy-only', { petPolicy: policy('allowed'), playTags: ['walk', 'social'] })), []);
  assert.deepEqual(playTagsFor(place('explicitly-empty', { playTags: ['walk'], petPlayTags: [] })), []);
  assert.deepEqual(playTagsFor(place('malformed-tags', { petPlayTags: 'walk' })), []);
  assert.deepEqual(playTagsFor(null), []);
});

test('pet-play discovery and search cannot resurrect visitor categories or unconfirmed pet activities', () => {
  const records = [
    place('evidenced', { district: '闵行区', petPlayTags: ['walk'] }),
    place('legacy-only', { district: '闵行区', playTags: ['walk'] }),
    place('unconfirmed', { district: '闵行区', petPlayTags: ['walk'], petPolicy: policy('unknown') }),
    place('other-district', { district: '徐汇区', petPlayTags: ['walk'] })
  ];
  assert.deepEqual(ids(selectNearbyRecords(records, { district: '闵行区', playTag: 'walk', now: NOW })), ['evidenced']);
  assert.deepEqual(ids(selectNearbyRecords(records, { district: '闵行区', query: '牵绳散步', now: NOW })), ['evidenced']);
  const notices = [{ id: 'theme-exhibition', type: 'exhibition', announcementMonth: '2026-10', playTags: ['exhibition'], petPolicy: policy('unknown') }];
  assert.deepEqual(selectAnnouncements(notices, { playTag: 'exhibition', now: NOW }), []);
});
