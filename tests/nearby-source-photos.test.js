'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const shared = require('../miniprogram/pages/_shared');
const utils = require('../miniprogram/data/nearby-utils');
const controls = require('../miniprogram/data/nearby-controls');
const catalogue = require('../miniprogram/data/nearby-catalogue');
const withSourcePhoto = require('../miniprogram/data/nearby-source-photos');

const NOW = Date.parse('2026-09-30T12:00:00+08:00');
const clone = value => JSON.parse(JSON.stringify(value));
const withoutPhoto = ({ photo, ...record }) => record;

function load(relativePath, dependencies = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const requireFromFile = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: request => Object.hasOwn(dependencies, request) ? dependencies[request] : requireFromFile(request),
    ...globals
  }, { filename });
  return module.exports;
}

// Read the same catalogue before its new photo overlay; URLs and record copy
// remain owned by the catalogue instead of being duplicated in this fixture.
const oldRecords = clone(load('miniprogram/data/nearby-catalogue.js', {
  './nearby-source-photos': record => record
}).records);
const reviewed = oldRecords.filter(record => withSourcePhoto(record) !== record);

function pageFixture(pageName, records = catalogue.records) {
  let definition;
  class Clock extends Date { static now() { return NOW; } }
  load('miniprogram/pages/' + pageName + '/index.js', {
    '../_shared': { ...shared, register: value => { definition = value; } },
    '../../data/nearby-catalogue': { ...catalogue, records },
    '../../data/nearby-utils': { ...utils,
      selectNearbyRecords: (items, options) => utils.selectNearbyRecords(items, { ...options, now: NOW }),
      selectAnnouncements: (items, options) => utils.selectAnnouncements(items, { ...options, now: NOW })
    },
    '../../data/nearby-controls': { ...controls,
      filterCards: (items, filters) => controls.filterCards(items, filters, NOW)
    },
    '../../services/nearby-location': { getReference: () => null, distanceFor: () => null, cancelPending() {} },
    '../../services/public-links': { canOpen: url => !!shared.httpsUrl(url) }
  }, { Date: Clock, wx: { setNavigationBarTitle() {}, stopPullDownRefresh() {} } });
  return {
    ...definition, data: clone(definition.data),
    _placeRecords: records, _failedPhotos: Object.create(null), _failedPhotoUrls: new Set(),
    setData(values) { Object.assign(this.data, values); }
  };
}

test('all 19 original-article photos belong to a listed source and change only the photo field', () => {
  assert.equal(reviewed.length, 19);
  for (const original of oldRecords) {
    const updated = withSourcePhoto(original);
    assert.deepEqual(clone(withoutPhoto(updated)), withoutPhoto(original), original.id);
    assert.deepEqual(clone(catalogue.records.find(record => record.id === original.id)), clone(updated), original.id);
    if (updated === original) continue;
    assert.ok(original.sources.some(source => source.url === updated.photo.sourceUrl), original.id);
    assert.match(updated.photo.url, /^https:\/\//, original.id);
    assert.ok(updated.photo.credit && updated.photo.caption && updated.photo.license, original.id);
    assert.ok(['photo', 'poster'].includes(updated.photo.kind), original.id);
  }
  assert.deepEqual(reviewed.filter(record => withSourcePhoto(record).photo.kind === 'poster').map(record => record.id).sort(), [
    'event-baijia-pet-market-2026', 'event-weijing-spartan-2026', 'notice-pfa-boutique-2027'
  ]);
});

test('changed or absent sources and the six records without suitable source photos retain their existing data', () => {
  for (const original of reviewed) {
    for (const sources of [undefined, [], [{ url: 'https://example.invalid/unreviewed-source' }]]) {
      const changed = { ...clone(original), sources, photo: { url: 'https://example.invalid/existing.jpg', caption: '已有配图' } };
      assert.strictEqual(withSourcePhoto(changed), changed, original.id);
      assert.equal(changed.photo.caption, '已有配图');
    }
  }
  const untouchedIds = [
    'place-pujiang-pet-zones', 'place-hanxiang-water-garden', 'place-menghuayuan',
    'event-cpark-lifestyle-2026', 'event-longhua-pet-cruise-2026', 'event-changtan-langhua-market-2026'
  ];
  for (const id of untouchedIds) {
    const original = oldRecords.find(record => record.id === id);
    assert.ok(original, id);
    assert.equal(original.photo, undefined, id);
    assert.strictEqual(withSourcePhoto(original), original, id);
    assert.deepEqual(clone(catalogue.records.find(record => record.id === id)), original, id);
  }
  const unknown = { id: 'unreviewed-place', sources: reviewed[0].sources, summary: '用户新投稿' };
  assert.strictEqual(withSourcePhoto(unknown), unknown, 'a familiar source does not approve a different record');
});

test('paginated saved records and detail refresh gain reviewed photos while retaining editorial and operational fields', async () => {
  const saved = reviewed.map((record, index) => ({
    ...clone(record), title: '已保存标题 ' + index, summary: '运营者已更新的介绍 ' + index,
    petPolicy: { status: 'conditional', text: '已保存的携宠规则 ' + index }, active: index % 2 === 0,
    point: { latitude: 31.12, longitude: 121.41, coordinateSystem: 'gcj02', label: '已保存坐标' },
    operatorMetadata: { revision: 12, note: '保留运营记录' }
  }));
  const before = clone(saved);
  const calls = [];
  const service = load('miniprogram/services/places.js', {
    './api': { call: async (action, parameters) => {
      calls.push({ action, parameters: clone(parameters) });
      return parameters.cursor ? { items: saved.slice(9) } : { items: saved.slice(0, 9), nextCursor: 'saved-page-2' };
    } }
  });
  const result = await service.listAll({ includeInactive: true });
  assert.deepEqual(calls, [
    { action: 'listPlaces', parameters: { includeInactive: true, limit: 50 } },
    { action: 'listPlaces', parameters: { includeInactive: true, limit: 50, cursor: 'saved-page-2' } }
  ]);
  assert.equal(result.length, saved.length);
  const detail = pageFixture('local-detail');
  for (let index = 0; index < saved.length; index += 1) {
    const original = saved[index];
    const expectedPhoto = withSourcePhoto(original).photo;
    assert.deepEqual(clone(result[index].photo), expectedPhoto, original.id);
    assert.deepEqual(clone(withoutPhoto(result[index])), withoutPhoto(original), original.id);
    detail.id = original.id;
    detail._remoteRecord = original;
    detail.refresh();
    assert.equal(detail.data.error, '', original.id);
    assert.equal(detail.data.item.photoUrl, expectedPhoto.url, original.id);
    assert.equal(detail.data.item.photo.sourceUrl, expectedPhoto.sourceUrl, original.id);
    for (const key of ['title', 'summary', 'petPolicy', 'active', 'point', 'operatorMetadata', 'highlights', 'ticketText', 'startsAt', 'endsAt']) {
      assert.deepEqual(detail.data.item[key] === undefined ? undefined : clone(detail.data.item[key]), original[key], original.id + ': ' + key);
    }
  }
  assert.deepEqual(saved, before, 'neither service nor detail rendering mutates saved records');
});

test('photo and poster cards, announcements and detail galleries retain their content when an image fails', () => {
  const page = pageFixture('nearby');
  page.updateCatalogue();
  const fixtures = [
    ['places', 'place-xinzhuang-weijing', 'photo', '原文实拍', 'aspectFill'],
    ['externalItems', 'event-dingfeng-pets-2026', 'photo', '原文实拍', 'aspectFill'],
    ['externalItems', 'event-baijia-pet-market-2026', 'poster', '原文海报', 'aspectFit'],
    ['announcements', 'notice-pfa-boutique-2027', 'poster', '原文海报', 'aspectFit']
  ];
  for (const [collection, id, kind, label, mode] of fixtures) {
    const original = catalogue.records.find(record => record.id === id);
    const card = page.data[collection].find(record => record.id === id);
    assert.ok(card, id);
    assert.equal(card.photoUrl, original.photo.url, id);
    assert.equal(card.photo.kind, kind, id);
    assert.equal(card.photoLabel, label, id);
    assert.equal(card.photoMode, mode, id);
    page.photoFailed({ currentTarget: { dataset: { id } } });
    const fallback = page.data[collection].find(record => record.id === id);
    assert.equal(fallback.photoUrl, '', id);
    assert.equal(fallback.title, card.title, id);
    assert.equal(fallback.dateLabel, card.dateLabel, id);
    assert.equal(original.photo.url, card.photoUrl, 'an image failure must not remove the source evidence');
  }
  page.data.period = 'past';
  page.updateCatalogue();
  const pastPoster = page.data.externalItems.find(record => record.id === 'event-weijing-spartan-2026');
  assert.ok(pastPoster);
  assert.equal(pastPoster.photoMode, 'aspectFit');
  assert.equal(pastPoster.photoLabel, '原文海报');

  const original = oldRecords.find(record => record.id === 'notice-pfa-boutique-2027');
  const detail = pageFixture('local-detail');
  detail.id = original.id;
  detail._remoteRecord = { ...clone(original), photos: [{
    url: 'https://example.invalid/saved-gallery-photo.jpg', kind: 'photo', caption: '保留的第二张配图',
    sourceUrl: original.sources[0].url
  }] };
  const saved = clone(detail._remoteRecord);
  detail.refresh();
  assert.equal(detail.data.item.galleryCount, 2);
  assert.deepEqual(Array.from(detail.data.item.photos, photo => photo.kind), ['poster', 'photo']);
  const posterUrl = detail.data.item.photoUrl;
  detail.photoFailed({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(detail.data.item.galleryCount, 1);
  assert.equal(detail.data.item.photos[0].url, '');
  assert.equal(detail.data.item.photos[0].originalUrl, posterUrl);
  assert.equal(detail.data.item.photoUrl, saved.photos[0].url);
  detail.photoFailed({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(detail.data.item.galleryCount, 0);
  assert.equal(detail.data.item.photoUrl, '');
  assert.equal(detail.data.item.title, original.title);
  assert.equal(detail.data.item.dateLabel, original.dateLabel);
  assert.deepEqual(detail._remoteRecord, saved);

  const cardsMarkup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/nearby/index.wxml'), 'utf8');
  for (const className of ['external-card', 'announcement-card']) {
    const cardMarkup = cardsMarkup.split('class="local-card ' + className)[1]?.split('class="local-card ')[0];
    assert.ok(cardMarkup, className);
    assert.match(cardMarkup, /mode="\{\{item\.photoMode\}\}"[^>]+binderror="photoFailed"/, className);
    assert.match(cardMarkup, /class="event-photo-label">\{\{item\.photoLabel\}\}/, className);
    assert.match(cardMarkup, /wx:else class="date-stamp/, className);
  }
  const detailMarkup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/local-detail/index.wxml'), 'utf8');
  assert.match(detailMarkup, /mode="\{\{photo\.kind === 'poster' \? 'aspectFit' : 'aspectFill'\}\}"[^>]+binderror="photoFailed"/);
});
