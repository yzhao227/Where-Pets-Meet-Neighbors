'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitDiscoveryCards } = require('../miniprogram/pages/nearby/discovery-quality');
const { DEFAULT_FILTERS } = require('../miniprogram/data/nearby-controls');

const ids = items => items.map(item => item.id);
const point = { latitude: 31.2, longitude: 121.4, coordinateSystem: 'gcj02', precision: 'venue', sourceUrl: 'https://example.invalid/map' };
const photo = { url: '/assets/nearby/test-scene.webp', sourceUrl: 'https://example.invalid/photo', credit: 'Test photographer', license: 'Test permission' };
const source = { title: 'Published visitor rules', publisher: 'Test venue', url: 'https://example.invalid/visitor-rules', checkedAt: '2026-09-30' };
function card(id, additions = {}) {
  return { id, type: 'place', petPolicy: { status: 'conditional', text: 'Only the signed outdoor area is open to pets.' }, ...additions };
}
function withPhoto(id, additions = {}) { return card(id, { photo, photoUrl: photo.url, ...additions }); }

test('default discovery prefers real photos and explicit suitability, while retaining every other record', () => {
  const items = [
    card('mapped-with-pet', { point }),
    withPhoto('photo-without-pet', { point, petPolicy: { status: 'not_allowed', text: 'No pets inside.' }, visitWithoutPet: true }),
    withPhoto('photo-with-pet'),
    withPhoto('needs-review', { point, needsRecheck: true }),
    withPhoto('unknown-pet-policy', { point, petPolicy: { status: 'unknown', text: 'Awaiting confirmation.' }, noPetRequired: true }),
    card('documented-illustration', { sources: [source], notice: 'Confirm the signed area before travelling.' })
  ];
  const before = structuredClone(items);
  const result = splitDiscoveryCards(items);
  assert.equal(result.curatedMode, true);
  assert.deepEqual(ids(result.featured), ['photo-with-pet', 'photo-without-pet', 'mapped-with-pet', 'documented-illustration']);
  assert.deepEqual(ids(result.more), ['needs-review', 'unknown-pet-policy']);
  assert.equal(result.featured.at(-1).notice, 'Confirm the signed area before travelling.');
  assert.deepEqual(items, before);
  for (const item of items) assert.equal([...result.featured, ...result.more].filter(value => value === item).length, 1);
});

test('manual search, region, play, every filter and deliberate sorts always preserve all input results in order', () => {
  const items = [card('incomplete'), withPhoto('known')];
  const choices = [
    { query: '公园' }, { district: '闵行区' }, { area: '莘庄' }, { playTag: 'lawn' },
    ...['distance', 'recent', 'photos', 'date', 'free'].map(sort => ({ sort })),
    ...Object.entries({ petFilter: 'without', placeKind: 'culture', eventKind: 'event', feeType: 'unknown', dateRange: 'today', radius: '3', photosOnly: true, period: 'past' })
      .map(([key, value]) => ({ filters: { ...DEFAULT_FILTERS, [key]: value } }))
  ];
  for (const options of choices) {
    const result = splitDiscoveryCards(items, options);
    assert.equal(result.curatedMode, false, JSON.stringify(options));
    assert.deepEqual(result.featured, items, JSON.stringify(options));
    assert.notEqual(result.featured, items, 'the result owns its array');
    assert.deepEqual(result.more, []);
  }
  assert.equal(splitDiscoveryCards(items, { query: '  ', sort: 'recommended', district: '全部区域', area: '全部片区', playTag: 'all', filters: { ...DEFAULT_FILTERS } }).curatedMode, true);
});

test('illustrations, failed photos and unsigned images cannot become photographic recommendations', () => {
  const items = [
    withPhoto('known'),
    withPhoto('failed', { photoUrl: '' }),
    card('illustration', { photoUrl: '/assets/nearby/icons/scene-park.svg' }),
    withPhoto('unmatched', { photoUrl: '/assets/nearby/another.webp' }),
    withPhoto('no-evidence', { photo: { url: photo.url } }),
    withPhoto('unsafe', { photo: { ...photo, url: 'http://example.invalid/photo.jpg' }, photoUrl: 'http://example.invalid/photo.jpg' })
  ];
  const result = splitDiscoveryCards(items);
  assert.deepEqual(ids(result.featured), ['known']);
  assert.equal(result.more.length, 5);
  const remote = 'https://example.invalid/public-photo.jpg';
  assert.equal(splitDiscoveryCards([withPhoto('remote', { photo: { ...photo, url: remote }, photoUrl: remote })]).curatedMode, true);
});

test('navigation qualification requires checked public coordinates, not distance text or a painted map button', () => {
  const invalid = [
    { ...point, coordinateSystem: 'wgs84' }, { ...point, latitude: NaN }, { ...point, longitude: 181 },
    { ...point, latitude: '31.2' }, { ...point, precision: 'district' }, { ...point, sourceUrl: '' }
  ].map((value, index) => card('invalid-' + index, { point: value }));
  const items = [card('valid', { point }), card('distance-only', { distance: { meters: 800, label: '约800 m' }, canNavigate: true }), ...invalid];
  const result = splitDiscoveryCards(items);
  assert.deepEqual(ids(result.featured), ['valid']);
  assert.equal(result.more.length, items.length - 1);
});

test('recommendation never interprets fee, pet hints, visitor tags or popularity as access evidence', () => {
  const items = [
    withPhoto('known-unknown-fee', { feeType: 'unknown' }),
    withPhoto('without-pet-unknown-policy', { petPolicy: { status: 'unknown', text: 'No current pet rule.' }, visitWithoutPet: true }),
    withPhoto('marketing-only', { petPolicy: { status: 'unknown', text: 'No current pet rule.' }, petHint: '随便带宠', sceneKind: 'park', playTags: ['lawn'], noPetRequired: true, feeType: 'free', likes: 999999 }),
    withPhoto('status-without-conditions', { petPolicy: { status: 'conditional', text: '' } })
  ];
  const result = splitDiscoveryCards(items);
  assert.deepEqual(ids(result.featured), ['known-unknown-fee', 'without-pet-unknown-policy']);
  assert.deepEqual(ids(result.more), ['marketing-only', 'status-without-conditions']);
});

test('six-card discovery cap is stable and lossless even with repeated IDs', () => {
  const items = Array.from({ length: 8 }, (_, index) => withPhoto(index === 7 ? 'same-id' : 'photo-' + index));
  items.unshift(card('same-id', { point }));
  const result = splitDiscoveryCards(Object.freeze(items));
  assert.equal(result.featured.length, 6);
  assert.deepEqual(ids(result.featured), ['photo-0', 'photo-1', 'photo-2', 'photo-3', 'photo-4', 'photo-5']);
  assert.equal(result.more[0], items[0]);
  assert.equal(result.more[2], items[8]);
  assert.equal(new Set([...result.featured, ...result.more]).size, items.length);
});

test('documented illustrated places complete four- or six-card rows after stronger photo and map candidates', () => {
  const supplements = Array.from({ length: 4 }, (_, index) => card('illustrated-' + index, { sources: [source] }));
  for (const [strongCount, expectedCount] of [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 6], [6, 6]]) {
    const strong = Array.from({ length: strongCount }, (_, index) => withPhoto('photo-' + index));
    const items = strong.concat(supplements);
    const before = structuredClone(items);
    const result = splitDiscoveryCards(items);
    assert.equal(result.featured.length, expectedCount);
    assert.deepEqual(ids(result.featured).slice(0, strongCount), ids(strong));
    assert.deepEqual(ids(result.featured).slice(strongCount), ids(supplements).slice(0, expectedCount - strongCount));
    assert.equal(new Set([...result.featured, ...result.more]).size, items.length);
    assert.deepEqual(items, before, 'filling rows never changes photo evidence or admission rules');
  }
});

test('illustrated supplements require named public evidence and never bypass unresolved admission review', () => {
  const pending = card('review-needed', { sources: [source], needsRecheck: true, notice: 'Pilot permission needs a current check.' });
  const invalid = [
    card('no-source'), card('empty-source', { sources: [] }),
    card('no-publisher', { sources: [{ ...source, publisher: '' }] }),
    card('unsafe-source', { sources: [{ ...source, url: 'http://example.invalid/rules' }] }),
    card('unknown-policy', { sources: [source], noPetRequired: true, petPolicy: { status: 'unknown', text: 'Please ask the venue.' } }),
    card('empty-policy', { sources: [source], petPolicy: { status: 'conditional', text: '' } }),
    card('inactive-illustration', { sources: [source], active: false }), pending
  ];
  const known = [withPhoto('first'), withPhoto('second'), withPhoto('third')];
  const result = splitDiscoveryCards(known.concat(invalid));
  assert.deepEqual(ids(result.featured), ['first', 'second'], 'prefer a complete row when a third card has no evidenced companion');
  assert.deepEqual(result.more, [known[2], ...invalid]);
  assert.equal(result.more.at(-1), pending);
  assert.equal(pending.needsRecheck, true);
  assert.equal(pending.notice, 'Pilot permission needs a current check.');
});

test('small complete odd-sized catalogues keep their real records without padding, duplicates or invented places', () => {
  for (const count of [1, 3, 5]) {
    const items = Array.from({ length: count }, (_, index) => withPhoto('real-' + index));
    const result = splitDiscoveryCards(items);
    assert.deepEqual(result.featured, items);
    assert.deepEqual(result.more, []);
  }
});

test('navigation breaks equal photo/access ties without reading location or popularity', () => {
  const items = [withPhoto('first'), withPhoto('mapped', { point }), withPhoto('third')];
  for (const item of items) {
    Object.defineProperty(item, 'distance', { get() { throw Error('User distance is outside the partition contract'); } });
    Object.defineProperty(item, 'likes', { get() { throw Error('Do not rank by fake popularity'); } });
  }
  assert.deepEqual(ids(splitDiscoveryCards(items).featured), ['mapped', 'first', 'third']);
});

test('no eligible recommendations fall back to the full original list instead of producing an empty page', () => {
  const items = [card('incomplete'), withPhoto('review-pending', { needsRecheck: true }), withPhoto('inactive', { active: false }), withPhoto('event', { type: 'event' })];
  assert.deepEqual(splitDiscoveryCards(items), { featured: items, more: [], curatedMode: false });
  assert.deepEqual(splitDiscoveryCards([]), { featured: [], more: [], curatedMode: false });
});
