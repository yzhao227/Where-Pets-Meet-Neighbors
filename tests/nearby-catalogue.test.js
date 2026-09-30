const test = require('node:test');
const assert = require('node:assert/strict');
const catalogue = require('../miniprogram/data/nearby-catalogue');
const { getTimeStatus, selectNearbyRecords, selectAnnouncements, PLAY_TAGS, isLocalScenePhoto } = require('../miniprogram/data/nearby-utils');
const { httpsUrl } = require('../miniprogram/pages/_shared');
const now = Date.parse('2026-09-29T12:00:00+08:00');

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

// Validate the entire changing directory, without pinning inventory counts or
// assuming that regular collection can never find a new dated event.
test('nearby catalogue retains valid public evidence and never creates platform capacity or user distance', () => {
  assert.ok(Array.isArray(catalogue.records) && catalogue.records.length > 0);
  assert.equal(new Set(catalogue.records.map(item => item.id)).size, catalogue.records.length);
  for (const item of catalogue.records) {
    assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(['place', 'event', 'exhibition'].includes(item.type), item.id + ' has a supported type');
    for (const key of ['title', 'address', 'summary', 'city', 'area', 'categoryLabel']) {
      assert.ok(typeof item[key] === 'string' && item[key].trim(), item.id + ' missing ' + key);
    }
    assert.equal(typeof item.noPetRequired, 'boolean', item.id);
    assert.ok(item.petPolicy && ['allowed', 'conditional', 'not_allowed', 'unknown'].includes(item.petPolicy.status), item.id);
    assert.ok(typeof item.petPolicy.text === 'string' && item.petPolicy.text.trim(), item.id);
    assert.ok(Array.isArray(item.sources) && item.sources.length, item.id);
    for (const source of item.sources) {
      assert.ok(source.title && source.publisher && httpsUrl(source.url) && isCalendarDate(source.checkedAt), item.id + ' source');
      if (source.publishedAt) assert.ok(isCalendarDate(source.publishedAt), item.id + ' publication date');
    }
    for (const key of ['attendeeCount', 'attendeeIds', 'capacity', 'distance']) {
      assert.equal(item[key], undefined, item.id + ' must not invent ' + key);
    }
    // Coordinates and authorized covers may legitimately be added later.
    if (item.latitude !== undefined || item.longitude !== undefined) {
      assert.ok(Number.isFinite(item.latitude) && Math.abs(item.latitude) <= 90, item.id + ' latitude');
      assert.ok(Number.isFinite(item.longitude) && Math.abs(item.longitude) <= 180, item.id + ' longitude');
    }
    if (item.cover !== undefined) {
      assert.ok(httpsUrl(item.cover) || /^\/assets\/[a-zA-Z0-9_./-]+$/.test(item.cover), item.id + ' cover URL');
    }
    if (item.district !== undefined) assert.ok(typeof item.district === 'string' && item.district.trim(), item.id + ' district');
    if (item.playTags !== undefined) {
      assert.ok(Array.isArray(item.playTags) && item.playTags.every(id => PLAY_TAGS.some(tag => tag.id === id)), item.id + ' supported play tags');
      assert.equal(new Set(item.playTags).size, item.playTags.length, item.id + ' unique play tags');
    }
    if (item.point !== undefined) {
      assert.equal(item.point.coordinateSystem, 'gcj02', item.id + ' coordinate system');
      assert.ok(Number.isFinite(item.point.latitude) && Math.abs(item.point.latitude) <= 90, item.id + ' map latitude');
      assert.ok(Number.isFinite(item.point.longitude) && Math.abs(item.point.longitude) <= 180, item.id + ' map longitude');
      assert.ok(['venue', 'entrance'].includes(item.point.precision), item.id + ' map precision');
      if (item.point.sourceUrl) assert.ok(httpsUrl(item.point.sourceUrl), item.id + ' coordinate source');
    }
    if (item.photos !== undefined) assert.ok(Array.isArray(item.photos), item.id + ' gallery is a list');
    const photos = [item.photo].concat(item.photos || []).filter(Boolean);
    assert.equal(new Set(photos.map(photo => photo.url)).size, photos.length, item.id + ' gallery avoids duplicate images');
    for (const photo of photos) {
      assert.ok((httpsUrl(photo.url) || isLocalScenePhoto(photo.url)) && httpsUrl(photo.sourceUrl), item.id + ' scene photo and source');
      if (isLocalScenePhoto(photo.url)) assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '../miniprogram', photo.url)), item.id + ' packaged scene photo exists');
      assert.ok(photo.credit && photo.license, item.id + ' photo credit and usage license');
      if (photo.licenseUrl) assert.ok(httpsUrl(photo.licenseUrl), item.id + ' image license link');
    }
    if (item.type !== 'place') {
      if (item.startsAt || item.endsAt) {
        assert.notEqual(getTimeStatus({ ...item, status: undefined }, now), 'undated', item.id + ' complete zoned interval');
      } else {
        assert.match(item.announcementMonth || '', /^\d{4}-(?:0[1-9]|1[0-2])$/, item.id + ' undated announcement month');
      }
    }
  }
  const withPet = selectNearbyRecords(catalogue.records, { kind: 'place', petFilter: 'with', now });
  assert.ok(withPet.every(item => ['allowed', 'conditional'].includes(item.petPolicy.status)));
});

test('changing catalogue separates dated current events, history, and month-only notices', () => {
  const snapshot = structuredClone(catalogue.records);
  const settings = { kind: ['exhibition', 'event'], now };
  const current = selectNearbyRecords(catalogue.records, settings);
  const history = selectNearbyRecords(catalogue.records, { ...settings, history: true });
  const announcements = selectAnnouncements(catalogue.records, { now });
  for (const item of current) {
    assert.ok(['event', 'exhibition'].includes(item.type));
    assert.ok(['upcoming', 'ongoing'].includes(item.timeStatus));
    assert.ok(Number.isFinite(Date.parse(item.startsAt)) && Date.parse(item.endsAt) > now, item.id);
  }
  for (const item of history) {
    assert.equal(item.timeStatus, 'ended');
    assert.ok(Date.parse(item.endsAt) <= now, item.id);
  }
  for (const item of announcements) {
    assert.equal(item.timeStatus, 'undated');
    assert.ok(!item.startsAt && !item.endsAt, item.id + ' month-only notice must not fabricate days');
  }
  const ids = [...current, ...history, ...announcements].map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, 'one entry cannot appear as both dated and undated');
  assert.deepEqual(catalogue.records, snapshot, 'selection must not rewrite the imported records');
});

test('isolated month-only announcements expire in Shanghai time without inventing days', () => {
  // Fixed regression inputs remain in memory; they never enter the live directory.
  const notice = { id: 'fixture-april', type: 'exhibition', title: '仅测试西岸预告', announcementMonth: '2027-04' };
  const laterNotice = { id: 'fixture-may', type: 'exhibition', title: '仅测试下月预告', announcementMonth: '2027-05' };
  const records = [notice, laterNotice];
  const ids = options => selectAnnouncements(records, options).map(item => item.id);
  assert.deepEqual(ids({ now: '2027-04-30T23:59:59+08:00' }), ['fixture-april', 'fixture-may']);
  assert.deepEqual(ids({ now: '2027-05-01T00:00:00+08:00' }), ['fixture-may']);
  assert.deepEqual(ids({ now, query: '西岸' }), ['fixture-april']);
  assert.deepEqual(ids({ now, query: '无匹配' }), []);
  assert.deepEqual(selectAnnouncements([{ ...notice, status: 'cancelled' }], { now }), []);
  assert.deepEqual(selectAnnouncements([{ ...notice, announcementMonth: '2027-13' }], { now }), []);
  assert.equal(notice.startsAt, undefined);
  assert.equal(notice.endsAt, undefined);
});

test('new natural-science destinations keep the reviewed admission rules and uncertain opening hours distinct', () => {
  const find = id => catalogue.records.find(item => item.id === id);
  const zoo = find('place-shanghai-zoo');
  const museum = find('place-shanghai-natural-history-museum');
  const aquarium = find('place-changfeng-ocean-world');
  assert.ok(catalogue.records.filter(item => item.type === 'place').length >= 20);
  assert.equal(zoo.petPolicy.status, 'unknown'); assert.match(zoo.ticketText, /40元/);
  assert.equal(museum.petPolicy.status, 'not_allowed');
  assert.match(museum.dateLabel, /周二闭馆/); assert.doesNotMatch(museum.dateLabel, /周一/);
  assert.match(museum.dateLabel, /16:00停止入馆/); assert.match(museum.ticketText, /30元/);
  assert.equal(aquarium.petPolicy.status, 'unknown'); assert.equal(aquarium.feeType, 'unknown');
  assert.equal(aquarium.dateLabel, '开放时段待向场馆确认');
  assert.match(aquarium.notice, /开放时段不一致/);
  assert.deepEqual([museum.point.longitude, museum.point.latitude], [121.46265, 31.234992], 'use the reviewed Beijing West Road museum, not the former museum point');
  const withPet = selectNearbyRecords(catalogue.records, { kind: 'place', petFilter: 'with', now });
  for (const venue of [zoo, museum, aquarium]) {
    if (venue.id === aquarium.id) assert.equal(venue.point, undefined, 'do not substitute the surrounding park point for the aquarium');
    else {
      assert.equal(venue.point.coordinateSystem, 'gcj02');
      assert.equal(venue.point.precision, 'venue');
      assert.match(venue.point.sourceUrl, /^https:\/\/map\.qq\.com\/poi\//);
    }
    assert.deepEqual(venue.petPlayTags, []);
    assert.equal(withPet.some(item => item.id === venue.id), false);
    assert.ok(venue.sources.every(source => source.checkedAt === '2026-09-30'));
    assert.equal(venue.visitWithoutPet, true);
  }
});

test('editorial guides link real places and label estimated stays without inventing an on-site route', () => {
  const ids = new Set(catalogue.records.filter(item => item.type === 'place').map(item => item.id));
  assert.equal(catalogue.guides.length, 3);
  assert.equal(new Set(catalogue.guides.map(guide => guide.id)).size, 3);
  for (const guide of catalogue.guides) {
    assert.ok(guide.steps.length >= 2);
    assert.match(guide.notice, /编辑路线建议.*未实地核验/);
    assert.match(guide.duration, /预计停留/);
    assert.ok(guide.conditions.length);
    for (const step of guide.steps) {
      assert.ok(ids.has(step.placeId), guide.id + ' links a real directory entry');
      assert.match(step.duration, /建议停留/);
      assert.ok(step.action);
      assert.equal(step.latitude, undefined);
      assert.equal(step.longitude, undefined);
    }
  }
});
