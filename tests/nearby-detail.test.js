'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shared = require('../miniprogram/pages/_shared');
const nearby = require('../miniprogram/data/nearby-utils');

const directory = path.resolve(__dirname, '../miniprogram/pages/local-detail');
const source = fs.readFileSync(path.join(directory, 'index.js'), 'utf8');
const initialTime = Date.parse('2026-09-29T12:00:00+08:00');

function records() {
  return [
    {
      id: 'fixture-place', type: 'place', title: '仅测试地点', city: '上海', area: '莘庄',
      address: '仅测试地址，非真实地点', summary: '页面测试专用资料', categoryLabel: '测试空间',
      noPetRequired: true, petPolicy: { status: 'unknown', text: '暂未确认携宠政策' },
      highlights: ['仅内存测试提示'],
      sources: [{ title: '测试用公开资料', publisher: '测试机构', url: 'https://example.invalid/test-place', checkedAt: '2026-09-29' }]
    },
    {
      id: 'fixture-show', type: 'exhibition', title: '仅测试展览', city: '上海', area: '其他片区',
      address: '仅测试展馆地址', venue: '仅测试展馆', hostName: '仅测试主办方', ticketText: '以主办方公告为准',
      startsAt: '2026-10-01T09:00:00+08:00', endsAt: '2026-10-01T17:00:00+08:00',
      petPolicy: { status: 'conditional', text: '仅测试携宠条件' },
      sources: [{ title: '测试展览页面', publisher: '测试主办方', url: 'https://example.invalid/test-show', checkedAt: '2026-09-28' }]
    }
  ];
}

function setup(items = records(), options = {}) {
  const oldWx = global.wx;
  const oldPage = global.Page;
  const effects = { now: initialTime, toasts: [], copied: [], modals: [], opened: [], apiCalls: [], navigation: [], mapNavigation: [], addressNavigation: [], previews: [], reference: null, cancelled: 0, locationRequests: 0 };
  const catalogue = { records: items, checkedAt: '2026-09-29', region: '仅测试范围' };
  const config = { mode: 'demo', cloudEnv: '', ...options.config };
  global.wx = {
    __preview: options.preview !== false,
    openLocation() {},
    showToast(options) { effects.toasts.push(options.title); },
    showModal(options) { effects.modals.push(options); options.success({ confirm: true }); },
    setClipboardData(options) { effects.copied.push(options.data); options.success({}); },
    switchTab(options) { effects.navigation.push(options.url); },
    previewImage(options) { effects.previews.push(options); },
    getLocation() { effects.locationRequests += 1; throw new Error('Details must not request viewer GPS'); },
    chooseLocation() { effects.locationRequests += 1; throw new Error('Details must not request a viewer origin'); },
    setNavigationBarTitle() {}, stopPullDownRefresh() {}
  };
  const location = {
    getReference: () => effects.reference,
    distanceFor: point => point && effects.reference ? { meters: 1200, label: '约 1.2 km', referenceLabel: effects.reference.label } : null,
    locate: async () => { effects.locationRequests += 1; throw new Error('Details must not request viewer GPS'); },
    chooseReference: async () => { effects.locationRequests += 1; throw new Error('Details must not change viewer origin'); },
    setManualReference: (point, label) => { effects.reference = { ...point, source: 'manual', label }; },
    clearReference: () => { effects.reference = null; },
    navigateTo: async (point, details) => { effects.mapNavigation.push({ point, details }); },
    navigateByAddress: async details => { effects.addressNavigation.push(structuredClone(details)); },
    cancelPending: () => { effects.cancelled += 1; }
  };
  const links = {
    canOpen: url => !!shared.httpsUrl(url),
    open: async (url, title) => {
      if (!links.canOpen(url)) throw new Error('仅测试：当前环境无法打开此链接');
      effects.opened.push({ url, title });
    }
  };
  const oldCall = shared.api.call;
  shared.api.call = async (action, value) => { effects.apiCalls.push([action, value]); throw new Error('Synthetic directory offline'); };
  let definition;
  global.Page = value => { definition = value; };
  class Clock extends Date { static now() { return effects.now; } }
  vm.runInNewContext(source, {
    require(request) {
      if (request === '../_shared') return shared;
      if (request === '../../data/nearby-catalogue') return catalogue;
      if (request === '../../data/nearby-source-photos') return require('../miniprogram/data/nearby-source-photos');
      if (request === '../../data/nearby-utils') return nearby;
      if (request === '../../data/nearby-participation') return require('../miniprogram/data/nearby-participation');
      if (request === '../../services/nearby-location') return location;
      if (request === '../../config') return config;
      if (request === '../../services/public-links') return links;
      if (request === '../../services/place-engine') return require('../miniprogram/services/place-engine');
      if (request === '../nearby/presentation') return require('../miniprogram/pages/nearby/presentation');
      throw new Error('Unexpected dependency: ' + request);
    },
    Date: Clock, wx: global.wx
  }, { filename: path.join(directory, 'index.js') });
  const page = Object.assign({}, definition, {
    data: structuredClone(definition.data), writesAfterUnload: 0,
    setData(values) { if (this._closed) this.writesAfterUnload += 1; Object.assign(this.data, values); }
  });
  return { page, effects, catalogue, location, config, links, restore() { shared.api.call = oldCall; global.wx = oldWx; global.Page = oldPage; } };
}

const imageEvent = index => ({ currentTarget: { dataset: { index } } });
const playEvent = id => ({ currentTarget: { dataset: { id } } });
const photoInfoEvent = (index, field) => ({ currentTarget: { dataset: { index, field } } });

test('a newly published remote-only detail waits for its record and retries failed reads', async () => {
  const f = setup();
  try {
    let resolve;
    shared.api.call = () => new Promise(done => { resolve = done; });
    const loading = f.page.onLoad({ id: 'remote-only' });
    assert.equal(f.page.data.loading, true);
    assert.equal(f.page.data.error, '');
    resolve({ place: { ...records()[1], id: 'remote-only', title: '已审核的新活动' }, isBookmarked: false, isAdmin: false });
    await loading;
    assert.equal(f.page.data.item.title, '已审核的新活动');
    assert.equal(f.page.data.error, '');
    f.page._remoteRecord = null;
    shared.api.call = async () => { throw new Error('仅测试连接中断'); };
    await f.page.loadPlaceState();
    assert.match(f.page.data.error, /连接中断/);
    assert.equal(f.page.data.loading, false);
    assert.equal(f.page.data.item, null);
    shared.api.call = async () => ({ place: { ...records()[0], id: 'remote-only', title: '重试后读取成功' } });
    await f.page.loadPlaceState();
    assert.equal(f.page.data.error, '');
    assert.equal(f.page.data.item.title, '重试后读取成功');
  } finally { f.page.onUnload(); f.restore(); }
});

test('an authoritative missing record does not redisplay a stale local fallback on refresh', async () => {
  const f = setup();
  try {
    shared.api.call = async () => { const error = new Error('已下架或不存在'); error.code = 'NOT_FOUND'; throw error; };
    await f.page.onLoad({ id: 'fixture-place' });
    assert.equal(f.page.data.item, null);
    assert.match(f.page.data.error, /已下架/);
    f.page.refresh();
    assert.equal(f.page.data.item, null);
    shared.api.call = async () => ({ place: records()[0] });
    await f.page.loadPlaceState();
    assert.equal(f.page.data.item.id, 'fixture-place');
    assert.equal(f.page.data.error, '');
  } finally { f.page.onUnload(); f.restore(); }
});

test('local details retain catalogue content when the optional online directory is unavailable', () => {
  const f = setup();
  try {
    f.page.onLoad({ id: 'fixture-place' });
    assert.equal(f.page.data.error, '');
    assert.equal(f.page.data.loading, false);
    assert.equal(f.page.data.item.title, '仅测试地点');
    assert.equal(f.page.data.item.policyLabel, '携宠规则待确认');
    assert.equal(f.page.data.item.checkedAt, '2026-09-29');
    assert.equal(f.page.data.item.timeStatus, null);
    assert.equal(f.page.data.item.photoUrl, '');
    assert.equal(f.page.data.item.galleryCount, 0);
    assert.deepEqual(Array.from(f.page.data.item.photos), []);
    assert.equal(f.page.data.item.canNavigate, false);
    assert.equal(f.page.data.item.canLocate, true);
    assert.equal(f.page.data.item.navigationLabel, '地图导航');
    assert.equal(f.page.data.item.sceneKind, 'park');
    assert.equal(f.page.data.item.timeLabel, '开放时段待确认');
    assert.equal(f.page.data.item.priceLabel, '具体费用待确认');
    assert.equal(f.page.data.item.areaLabel, '上海 · 莘庄');
    assert.deepEqual(f.effects.apiCalls.map(call => call[0]), ['getPlace'], 'only the optional directory read is performed');
    const markup = fs.readFileSync(path.join(directory, 'index.wxml'), 'utf8');
    assert.doesNotMatch(markup, /bindtap="join"|open-type="getPhoneNumber"/);
    assert.match(markup, /binderror="photoFailed"/);
    for (const match of markup.matchAll(/\b(?:bind|catch):?(?:tap|input|change|confirm|scroll|error)="([^"]+)"/g)) assert.equal(typeof f.page[match[1]], 'function', match[1]);
    JSON.parse(fs.readFileSync(path.join(directory, 'index.json'), 'utf8'));
    assert.ok(fs.statSync(path.join(directory, 'index.wxss')).size > 0);
  } finally { f.restore(); }
});

test('returning to an event detail refreshes its time status and changes the participation action', () => {
  const f = setup();
  try {
    f.page.onLoad({ id: 'fixture-show' });
    assert.equal(f.page.data.item.timeStatus, 'upcoming');
    assert.equal(f.page.data.item.officialButtonText, '查看参与公告');
    assert.match(f.page.data.item.dateLabel, /2026年10月1日 09:00/);
    f.effects.now = Date.parse('2026-10-01T10:00:00+08:00');
    f.page.onShow();
    assert.equal(f.page.data.item.timeStatus, 'ongoing');
    f.effects.now = Date.parse('2026-10-01T17:00:00+08:00');
    f.page.onShow();
    assert.equal(f.page.data.item.timeStatus, 'ended');
    assert.equal(f.page.data.item.officialButtonText, '打开往期原文');
    assert.match(f.page.data.item.stateNotice, /已结束/);
    f.catalogue.records[1].status = 'cancelled';
    f.page.onShow();
    assert.equal(f.page.data.item.officialButtonText, '查看活动公告');
    assert.match(f.page.data.item.stateNotice, /已取消/);
  } finally { f.restore(); }
});

test('month-only announcements stay undated and become stale after the announced month', async () => {
  const items = records();
  Object.assign(items[1], {
    startsAt: undefined, endsAt: undefined, announcementMonth: '2027-04',
    dateLabel: '2027年4月 · 具体日期待公布', needsRecheck: true,
    sources: [{ title: '仅测试官方预告', publisher: '测试主办方', url: 'https://example.invalid/test-announcement', publishedAt: '2026-08-01', checkedAt: '2026-09-29' }]
  });
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-show' });
    assert.equal(f.page.data.item.timeStatus, 'undated');
    assert.deepEqual(Array.from(f.page.data.item.schedule), []);
    assert.equal(f.page.data.item.statusText, '已官宣 · 日期待公布');
    assert.equal(f.page.data.item.officialButtonText, '打开活动预告');
    assert.equal(f.page.data.item.dateLabel, '2027年4月 · 具体日期待公布');
    assert.equal(f.page.data.item.timeLabel, f.page.data.item.dateLabel);
    assert.equal(f.page.data.item.priceLabel, items[1].ticketText);
    assert.equal(f.page.data.item.sources[0].publishedAt, '2026-08-01');
    assert.equal(f.page.data.item.sources[0].checkedAt, '2026-09-29');
    assert.match(f.page.data.item.notice, /需要更新/);
    await f.page.openOfficial();
    assert.match(f.page.data.item.stateNotice, /只|月份/);
    assert.equal(f.effects.opened[0].url, items[1].sources[0].url);
    f.effects.now = Date.parse('2027-04-30T15:59:59Z');
    f.page.onShow();
    assert.equal(f.page.data.item.statusText, '已官宣 · 日期待公布');
    f.effects.now = Date.parse('2027-04-30T16:00:00Z');
    f.page.onShow();
    assert.equal(f.page.data.item.statusText, '预告待更新');
    assert.equal(f.page.data.item.timeStatus, 'undated');
    await f.page.openOfficial();
    assert.match(f.page.data.item.stateNotice, /需要更新/);
    assert.equal(f.page.data.item.officialButtonText, '打开活动预告');
    assert.equal(f.effects.opened[1].url, items[1].sources[0].url);
    assert.deepEqual(f.effects.modals, []);
    assert.deepEqual(f.effects.copied, []);
  } finally { f.restore(); }
});

test('opening an activity source jumps directly without confirmation, clipboard use or registration', async () => {
  const f = setup();
  try {
    f.page.onLoad({ id: 'fixture-show' });
    await f.page.openOfficial();
    assert.equal(f.page.data.item.officialButtonText, '查看参与公告');
    assert.deepEqual(f.effects.opened, [{ url: 'https://example.invalid/test-show', title: '仅测试展览' }]);
    assert.deepEqual(f.effects.modals, []);
    assert.deepEqual(f.effects.copied, []);
    assert.deepEqual(f.effects.apiCalls.map(call => call[0]), ['getPlace'], 'only the optional directory read is performed');
    assert.equal(f.page.data.busy, false);
    f.effects.now = Date.parse('2026-10-02T12:00:00+08:00');
    await f.page.openOfficial();
    assert.equal(f.page.data.item.officialButtonText, '打开往期原文', 'the click also refreshes time, without waiting for onShow');
    assert.match(f.page.data.item.stateNotice, /已结束/);
    assert.equal(f.effects.opened.length, 2);
    assert.equal(f.effects.locationRequests, 0);
  } finally { f.restore(); }
});

test('source capability and navigation failures surface without substituting clipboard or registration actions', async () => {
  const f = setup();
  try {
    f.page.onLoad({ id: 'fixture-show' });
    f.links.canOpen = () => false;
    f.page.refresh();
    assert.equal(f.page.data.item.officialCanOpen, false);
    assert.equal(f.page.data.item.sources[0].canOpen, false);
    await f.page.openOfficial();
    assert.match(f.effects.toasts.at(-1), /无法打开/);
    assert.deepEqual(f.effects.opened, []);
    f.links.canOpen = () => true;
    f.links.open = async () => { throw new Error('仅测试原文跳转失败'); };
    f.page.refresh();
    assert.equal(f.page.data.item.officialCanOpen, true);
    await f.page.openOfficial();
    assert.equal(f.effects.toasts.at(-1), '仅测试原文跳转失败');
    assert.deepEqual(f.effects.copied, []);
    assert.deepEqual(f.effects.modals, []);
    assert.deepEqual(f.effects.apiCalls.map(call => call[0]), ['getPlace']);
    assert.equal(f.page.data.busy, false);
  } finally { f.restore(); }
});

test('source controls use normalized links and preserve the selected source title without writing data', async () => {
  const items = records();
  items[0].sources.unshift({ title: 'invalid test-only link', url: 'javascript:alert(1)', checkedAt: '2026-09-29' });
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    assert.equal(f.page.data.item.sources[0].url, '');
    assert.equal(f.page.data.item.officialUrl, 'https://example.invalid/test-place');
    await f.page.openSource({ currentTarget: { dataset: { index: 0 } } });
    assert.deepEqual(f.effects.opened, []);
    assert.equal(f.page.data.item.sources[0].canOpen, false);
    await f.page.openSource({ currentTarget: { dataset: { index: 1 } } });
    assert.deepEqual(f.effects.opened, [{ url: 'https://example.invalid/test-place', title: '测试用公开资料' }]);
    await f.page.openOfficial();
    assert.equal(f.page.data.item.officialButtonText, '打开地点原文');
    assert.equal(f.effects.opened.at(-1).url, 'https://example.invalid/test-place');
    assert.deepEqual(f.effects.copied, []);
    assert.deepEqual(f.effects.modals, []);
    assert.equal(f.page.data.busy, false);
    assert.deepEqual(f.effects.apiCalls.map(call => call[0]), ['getPlace'], 'only the optional directory read is performed');
  } finally { f.restore(); }
});

test('route sources open their original article and ignore actions after hiding or unloading the guide', async () => {
  const f = setup();
  f.catalogue.guides = [{ id: 'fixture-route', title: '仅测试路线', steps: [{ placeId: 'fixture-place', action: '仅测试停留建议' }] }];
  try {
    f.page.onLoad({ guideId: 'fixture-route' });
    const sourceEvent = { currentTarget: { dataset: { index: 0 } } };
    assert.equal(f.page.data.guide.sources[0].canOpen, true);
    await f.page.openGuideSource(sourceEvent);
    assert.deepEqual(f.effects.opened, [{ url: 'https://example.invalid/test-place', title: '测试用公开资料' }]);
    f.page.onHide();
    const hiddenGuide = structuredClone(f.page.data.guide);
    await f.page.openGuideSource(sourceEvent);
    assert.equal(f.effects.opened.length, 1);
    assert.deepEqual(structuredClone(f.page.data.guide), hiddenGuide);
    f.page.onShow();
    await f.page.openGuideSource(sourceEvent);
    assert.equal(f.effects.opened.length, 2, 'returning to the guide restores its source action');
    f.page.onUnload();
    await f.page.openGuideSource(sourceEvent);
    assert.equal(f.effects.opened.length, 2);
    assert.equal(f.page.writesAfterUnload, 0);
    assert.deepEqual(f.effects.copied, []);
    assert.deepEqual(f.effects.modals, []);
    assert.ok(f.effects.apiCalls.every(call => call[0] === 'getPlace'));
    assert.equal(f.effects.locationRequests, 0);
  } finally { f.restore(); }
});

test('missing and withdrawn records expose a nearby fallback and never share an undefined id', () => {
  const f = setup();
  try {
    f.page.onLoad({});
    assert.match(f.page.data.error, /不存在/);
    assert.equal(f.page.data.item, null);
    assert.equal(f.page.onShareAppMessage().path, '/pages/nearby/index');
    f.page.backToNearby();
    assert.deepEqual(f.effects.navigation, ['/pages/nearby/index']);
    f.page.onLoad({ id: 'fixture-show' });
    assert.equal(f.page.onShareAppMessage().path, '/pages/local-detail/index?id=fixture-show');
    f.catalogue.records.splice(1, 1);
    f.page.onShow();
    assert.equal(f.page.data.item, null);
    assert.equal(f.page.onShareAppMessage().path, '/pages/nearby/index');
  } finally { f.restore(); }
});

test('closing after a source jump begins prevents late writes and additional source actions', async () => {
  const f = setup();
  try {
    f.page.onLoad({ id: 'fixture-show' });
    let finish;
    f.links.open = (url, title) => { f.effects.opened.push({ url, title }); return new Promise(resolve => { finish = resolve; }); };
    const pending = f.page.openOfficial();
    assert.equal(f.effects.opened.length, 1, 'the external action has already been issued');
    f.page.onUnload();
    await f.page.openOfficial();
    await f.page.openSource({ currentTarget: { dataset: { index: 0 } } });
    await f.page.openPointSource();
    finish();
    await pending;
    assert.equal(f.page.writesAfterUnload, 0);
    assert.equal(f.effects.opened.length, 1, 'closing does not retract the first jump or issue another');
    assert.deepEqual(f.effects.copied, []);
    assert.deepEqual(f.effects.modals, []);
  } finally { f.restore(); }
});

test('verified scene photos, play tags, manual-reference distances and map navigation remain distinct', async () => {
  const items = records();
  items[0].district = '仅测试区域';
  items[0].playTags = ['walk', 'hangout', 'unrecognized'];
  items[0].petPlayTags = ['walk', 'hangout', 'unrecognized'];
  items[0].petPolicy = { status: 'conditional', text: '仅内存测试携宠条件' };
  items[0].point = { latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02', precision: 'venue', label: '仅测试场所参照（非入口）', sourceUrl: 'https://example.invalid/map-source' };
  items[0].photo = { url: 'https://example.invalid/venue.jpg', caption: '仅测试场所画面', credit: '仅测试作者', license: 'CC BY 4.0', sourceUrl: 'https://example.invalid/photo', licenseUrl: 'https://example.invalid/license' };
  const f = setup(items);
  try {
    f.effects.reference = { source: 'manual', label: '仅测试出发点' };
    f.page.onLoad({ id: 'fixture-place' });
    assert.equal(f.page.data.item.photoUrl, items[0].photo.url);
    assert.deepEqual(f.page.data.item.playLabels.map(tag => tag.id), ['walk', 'hangout']);
    assert.equal(f.page.data.item.distance.label, '约 1.2 km');
    assert.equal(f.page.data.item.referenceText, '手选参照：仅测试出发点');
    assert.equal(f.page.data.referencesOpen, false);
    f.page.toggleReferences();
    assert.equal(f.page.data.referencesOpen, true);
    assert.equal(f.page.data.item.photo.credit, '仅测试作者');
    f.page.previewPhoto();
    assert.equal(f.effects.previews[0].current, items[0].photo.url);
    await f.page.openPhotoInfo({ currentTarget: { dataset: { field: 'licenseUrl' } } });
    assert.equal(f.effects.opened.at(-1).url, items[0].photo.licenseUrl);
    assert.equal(f.effects.opened.at(-1).title, '图片许可');
    assert.equal(f.page.data.item.pointSourceUrl, items[0].point.sourceUrl);
    await f.page.openPointSource();
    assert.equal(f.effects.opened.at(-1).url, items[0].point.sourceUrl);
    assert.equal(f.effects.opened.at(-1).title, '地图位置来源');
    await f.page.navigate();
    assert.equal(f.effects.mapNavigation.length, 1);
    assert.deepEqual(f.effects.mapNavigation[0].point, items[0].point);
    assert.equal(f.effects.mapNavigation[0].details.name, '仅测试场所参照', 'navigation names the verified landmark rather than a nearby itinerary or entrance');
    f.page.photoFailed();
    assert.equal(f.page.data.item.photoUrl, '', 'a broken image leaves the compact heading without an empty photo frame');
    assert.equal(f.page.data.item.title, items[0].title);
    f.page.onHide();
    assert.equal(f.effects.cancelled, 1);
  } finally { f.restore(); }
});

test('detail scene photos allow the packaged nearby directory and retain failure fallback', () => {
  const items = records();
  items[0].photo = { url: '/assets/nearby/fixture-place.jpeg', credit: '仅测试作者', license: 'CC BY 4.0', sourceUrl: 'https://example.invalid/photo' };
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    assert.equal(f.page.data.item.photoUrl, items[0].photo.url);
    f.page.previewPhoto();
    assert.equal(f.effects.previews[0].current, items[0].photo.url);
    f.page.photoFailed();
    assert.equal(f.page.data.item.photoUrl, '');
    items[0].photo.url = '/assets/nearby/../avatar.jpg';
    f.page.refresh();
    assert.equal(f.page.data.item.photoUrl, '');
  } finally { f.restore(); }
});

test('details without a valid map point delegate the public address to map navigation', async () => {
  const items = records();
  items[0].point = { latitude: 31.1, longitude: 121.4, coordinateSystem: 'wgs84', sourceUrl: 'javascript:alert(1)' };
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    assert.equal(f.page.data.item.canNavigate, false);
    assert.equal(f.page.data.item.navigationLabel, '地图导航');
    assert.equal(f.page.data.item.canLocate, true);
    assert.equal(f.page.data.item.pointSourceUrl, '');
    await f.page.openPointSource();
    assert.deepEqual(f.effects.opened, []);
    await f.page.navigate();
    assert.deepEqual(f.effects.mapNavigation, []);
    assert.deepEqual(f.effects.addressNavigation, [{ id: items[0].id, name: items[0].title, address: items[0].address, city: items[0].city }]);
    assert.deepEqual(f.effects.copied, []);
    assert.equal(f.effects.locationRequests, 0);
  } finally { f.restore(); }
});

test('native demo details disable unresolved map positions while retaining their published address', async () => {
  const items = records();
  const f = setup(items, { preview: false });
  try {
    await f.page.onLoad({ id: items[0].id });
    assert.equal(f.page.data.item.canNavigate, false);
    assert.equal(f.page.data.item.canLocate, false);
    assert.equal(f.page.data.item.navigationLabel, '位置待核实');
    assert.match(f.page.data.item.navigationHint, /位置尚待核实/);
    assert.doesNotMatch(f.page.data.item.navigationHint, /地址.*未公布|地点待公布/);
    assert.equal(f.page.data.item.address, items[0].address);
    await f.page.navigate();
    assert.deepEqual(f.effects.addressNavigation, []);
    assert.deepEqual(f.effects.mapNavigation, []);
    assert.deepEqual(f.effects.toasts, [], 'an unresolved position does not advertise navigation then throw on tap');
    await f.page.copyAddress();
    assert.deepEqual(f.effects.copied, [items[0].address]);
    const markup = fs.readFileSync(path.join(directory, 'index.wxml'), 'utf8');
    assert.match(markup, /class="bottom-navigate[^\"]*"[^>]*disabled="\{\{busy \|\| !item\.canLocate\}\}"/);
    items[0].point = { latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' };
    f.page.refresh();
    assert.equal(f.page.data.item.canLocate, true); assert.equal(f.page.data.item.navigationLabel, '地图导航');
    await f.page.navigate();
    assert.deepEqual(f.effects.mapNavigation[0].point, items[0].point);
    assert.equal(f.effects.addressNavigation.length, 0); assert.equal(f.effects.locationRequests, 0);
  } finally { f.page.onUnload(); f.restore(); }
});

test('native address navigation is enabled only with a configured cloud environment and map capability', async () => {
  const f = setup(records(), { preview: false, config: { mode: 'cloud', cloudEnv: '' } });
  try {
    await f.page.onLoad({ id: 'fixture-place' });
    assert.equal(f.page.data.item.canLocate, false);
    f.config.cloudEnv = 'synthetic-cloud'; f.page.refresh();
    assert.equal(f.page.data.item.canLocate, true); assert.equal(f.page.data.item.navigationLabel, '地图导航');
    await f.page.navigate();
    assert.equal(f.effects.addressNavigation.length, 1); assert.equal(f.effects.mapNavigation.length, 0);
    delete global.wx.openLocation; f.page.refresh();
    assert.equal(f.page.data.item.canLocate, false);
    await f.page.navigate();
    assert.equal(f.effects.addressNavigation.length, 1); assert.deepEqual(f.effects.toasts, []);
    global.wx.__preview = true; f.config.mode = 'demo'; f.config.cloudEnv = ''; f.page.refresh();
    assert.equal(f.page.data.item.canLocate, true, 'browser address search remains available without cloud configuration');
    await f.page.navigate(); assert.equal(f.effects.addressNavigation.length, 2);
    assert.equal(f.effects.locationRequests, 0);
  } finally { f.page.onUnload(); f.restore(); }
});

test('an operator-updated address without a point never regains the stale packaged map coordinate', async () => {
  const items = records();
  items[0].point = { latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' };
  const f = setup(items, { preview: false });
  try {
    const remote = { ...items[0], title: '运营者更名后的地点', address: '运营者更新后的公开地址', point: null };
    shared.api.call = async () => ({ place: remote });
    await f.page.onLoad({ id: items[0].id });
    assert.equal(f.page.data.item.address, remote.address); assert.equal(f.page.data.item.point, null);
    assert.equal(f.page.data.item.canLocate, false); assert.equal(f.page.data.item.navigationLabel, '位置待核实');
    await f.page.navigate(); assert.deepEqual(f.effects.mapNavigation, []); assert.deepEqual(f.effects.addressNavigation, []);
    shared.api.call = async () => { throw new Error('仅测试暂时离线'); };
    await f.page.loadPlaceState(); f.page.refresh();
    assert.equal(f.page.data.item.address, remote.address); assert.equal(f.page.data.item.point, null);
    f.config.mode = 'cloud'; f.config.cloudEnv = 'synthetic-cloud'; f.page.refresh();
    await f.page.navigate();
    assert.deepEqual(f.effects.addressNavigation, [{ id: remote.id, name: remote.title, address: remote.address, city: remote.city }]);
    assert.deepEqual(f.effects.mapNavigation, [], 'enabling address resolution cannot revive an obsolete packaged point');
    assert.equal(items[0].point.latitude, 31.1, 'the catalogue itself remains unchanged');
    assert.equal(f.effects.locationRequests, 0);
  } finally { f.page.onUnload(); f.restore(); }
});

test('details expose destination navigation without viewer-distance controls or GPS prompts', async () => {
  const items = records();
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    for (const handler of ['openReferenceMenu', 'selectKnownReference', 'closeReferencePanel']) assert.equal(f.page[handler], undefined);
    const markup = fs.readFileSync(path.join(directory, 'index.wxml'), 'utf8');
    assert.doesNotMatch(markup, /openReferenceMenu|selectKnownReference|closeReferencePanel|distance-row|查看距离|更换参照/);
    assert.equal(typeof f.page.copyAddress, 'function');
    assert.match(markup, /<button\b[^>]*bindtap="copyAddress"[^>]*>[\s\S]*?复制地址/);
    assert.match(markup, /<button\b[^>]*class="bottom-navigate[^\"]*"[^>]*bindtap="navigate"/);
    assert.equal(f.page.data.item.navigationLabel, '地图导航');
    await f.page.copyAddress();
    assert.deepEqual(f.effects.copied, [items[0].address], 'copies only the actual public destination address');
    assert.deepEqual(f.effects.addressNavigation, []);
    assert.deepEqual(f.effects.mapNavigation, []);
    assert.deepEqual(f.effects.navigation, []);
    assert.deepEqual(f.effects.opened, []);
    assert.equal(f.effects.locationRequests, 0, 'copying never requests GPS or opens navigation');
    const toastsAfterCopy = [...f.effects.toasts];
    await f.page.navigate();
    assert.deepEqual(f.effects.addressNavigation, [{ id: items[0].id, name: items[0].title, address: items[0].address, city: items[0].city }]);
    assert.equal(f.effects.locationRequests, 0);
    assert.deepEqual(f.effects.toasts, toastsAfterCopy);
    assert.deepEqual(f.effects.copied, [items[0].address], 'bottom navigation does not trigger another copy');
  } finally { f.restore(); }
});

test('the gallery keeps each valid image attribution and previews the selected original index', async () => {
  const items = records();
  const cover = { url: '/assets/nearby/fixture-cover.webp', caption: '仅测试封面', credit: '仅测试作者一', license: 'CC BY 4.0', sourceUrl: 'https://example.invalid/cover', licenseUrl: 'https://example.invalid/license-one' };
  const second = { url: 'https://example.invalid/second.jpg', caption: '仅测试第二张', credit: '仅测试作者二', license: 'CC BY-SA 4.0', sourceUrl: 'javascript:alert(1)', licenseUrl: 'http://example.invalid/insecure-license' };
  const third = { url: '/assets/nearby/fixture-third.jpeg', caption: '仅测试第三张', credit: '仅测试作者三', license: 'CC0', sourceUrl: 'https://example.invalid/third', licenseUrl: 'https://example.invalid/license-three' };
  items[0].photo = cover;
  items[0].photos = [{ ...cover }, second, null, third, { url: '/assets/nearby/../avatar.jpg' }, { url: 'javascript:alert(1)' }];
  const original = structuredClone(items[0]);
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    const photos = f.page.data.item.photos;
    assert.equal(f.page.data.item.galleryCount, 3, 'the repeated cover and unsafe images do not create gallery pages');
    assert.deepEqual(Array.from(photos, photo => photo.index), [0, 1, 2]);
    assert.deepEqual(Array.from(photos, photo => photo.originalUrl), [cover.url, second.url, third.url]);
    assert.deepEqual(Array.from(photos, photo => [photo.credit, photo.license]), [
      [cover.credit, cover.license], [second.credit, second.license], [third.credit, third.license]
    ]);
    assert.equal(photos[1].sourceUrl, '');
    assert.equal(photos[1].licenseUrl, '');
    f.page.previewPhoto(imageEvent('2'));
    assert.equal(f.effects.previews[0].current, third.url);
    assert.deepEqual(Array.from(f.effects.previews[0].urls), [cover.url, second.url, third.url]);
    for (const index of [-1, 3, 1.5, 'not-an-index']) f.page.previewPhoto(imageEvent(index));
    assert.equal(f.effects.previews.length, 1, 'invalid indices cannot preview another photo accidentally');
    await f.page.openPhotoInfo(photoInfoEvent(2, 'sourceUrl'));
    await f.page.openPhotoInfo(photoInfoEvent('2', 'licenseUrl'));
    assert.deepEqual(f.effects.opened.map(item => item.url), [third.sourceUrl, third.licenseUrl]);
    await f.page.openPhotoInfo(photoInfoEvent(1, 'sourceUrl'));
    await f.page.openPhotoInfo(photoInfoEvent(1, 'licenseUrl'));
    await f.page.openPhotoInfo(photoInfoEvent(2, 'originalUrl'));
    await f.page.openPhotoInfo(photoInfoEvent(9, 'sourceUrl'));
    assert.equal(f.effects.opened.length, 2);
    assert.deepEqual(f.effects.copied, []);
    assert.deepEqual(items[0], original, 'gallery normalization never rewrites the sourced catalogue');
  } finally { f.restore(); }
});

test('failed gallery images are isolated, keep attribution and stable indices, and fully fail into the text fallback', async () => {
  const items = records();
  const photos = [0, 1, 2].map(index => ({ url: `https://example.invalid/gallery-${index}.jpg`, credit: `测试作者${index}`, license: 'CC BY 4.0', sourceUrl: `https://example.invalid/source-${index}` }));
  items[0].photos = photos;
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    f.page.galleryScroll({ detail: { scrollWidth: 900, scrollLeft: 600 } });
    assert.equal(f.page.data.galleryIndex, 2);
    for (const detail of [{ scrollWidth: 0, scrollLeft: 100 }, { scrollWidth: 900, scrollLeft: NaN }, { scrollLeft: 30 }, {}]) f.page.galleryScroll({ detail });
    assert.equal(f.page.data.galleryIndex, 2, 'incomplete scroll events cannot reset the current page');
    f.page.photoFailed(imageEvent(1));
    assert.equal(f.page.data.item.galleryCount, 2);
    assert.equal(f.page.data.galleryIndex, 1);
    assert.deepEqual(Array.from(f.page.data.item.photos, photo => photo.index), [0, 1, 2]);
    assert.deepEqual(Array.from(f.page.data.item.photos, photo => photo.url), [photos[0].url, '', photos[2].url]);
    assert.equal(f.page.data.item.photos[1].credit, photos[1].credit);
    await f.page.openPhotoInfo(photoInfoEvent(1, 'sourceUrl'));
    assert.equal(f.effects.opened.at(-1).url, photos[1].sourceUrl, 'failed image loading never removes its source information');
    f.page.previewPhoto(imageEvent(2));
    assert.equal(f.effects.previews.at(-1).current, photos[2].url);
    assert.deepEqual(Array.from(f.effects.previews.at(-1).urls), [photos[0].url, photos[2].url]);
    f.page.previewPhoto(imageEvent(1));
    assert.equal(f.effects.previews.length, 1);
    f.page.photoFailed(imageEvent(0));
    assert.equal(f.page.data.item.photoUrl, photos[2].url, 'the surviving image becomes the cover');
    assert.equal(f.page.data.galleryIndex, 0);
    f.page.refresh();
    assert.equal(f.page.data.item.galleryCount, 1, 'refreshing cannot retry known failed URLs in a loop');
    f.page.photoFailed(imageEvent(2));
    assert.equal(f.page.data.item.galleryCount, 0);
    assert.equal(f.page.data.item.photoUrl, '');
    assert.equal(f.page.data.item.title, items[0].title);
    assert.equal(f.page.data.item.photos.length, 3);
    assert.deepEqual(Array.from(f.page.data.item.photos, photo => photo.credit), photos.map(photo => photo.credit));
    f.page.previewPhoto();
    f.page.galleryScroll({ detail: { scrollWidth: 900, scrollLeft: 600 } });
    for (const index of [-1, 1.5, 99, 'invalid']) f.page.photoFailed(imageEvent(index));
    assert.equal(f.effects.previews.length, 1);
    assert.equal(f.page.data.galleryIndex, 0);
    items[0].photos[0] = { ...photos[0], url: 'https://example.invalid/replaced-cover.jpg' };
    f.page.refresh();
    assert.equal(f.page.data.item.galleryCount, 1, 'a replacement URL can load without resurrecting the failed originals');
    assert.equal(f.page.data.item.photoUrl, items[0].photos[0].url);
  } finally { f.restore(); }
});

test('play and detail disclosures preserve all policy conditions and cannot invent unsupported pet activities', () => {
  const items = records();
  items[0].placeKind = 'waterside';
  items[0].petPolicy = { status: 'conditional', text: '仅室外可携宠；全程牵绳;大型犬须戴嘴套；店内另行询问' };
  items[0].petPlayTags = ['walk', 'lawn', 'exhibition', 'unknown'];
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    assert.equal(f.page.data.item.sceneKind, 'waterside');
    assert.deepEqual(Array.from(f.page.data.item.petFacts, fact => fact.text), ['仅室外可携宠', '全程牵绳', '大型犬须戴嘴套', '店内另行询问']);
    assert.equal(f.page.data.item.policyShort, items[0].petPolicy.text);
    assert.deepEqual(Array.from(f.page.data.item.playLabels, play => play.id), ['walk', 'lawn']);
    assert.equal(f.page.data.activePlayId, '');
    f.page.togglePlay(playEvent('walk'));
    assert.equal(f.page.data.activePlayId, 'walk');
    f.page.togglePlay(playEvent('unknown'));
    f.page.togglePlay(playEvent('exhibition'));
    assert.equal(f.page.data.activePlayId, 'walk');
    f.page.togglePlay(playEvent('lawn'));
    assert.equal(f.page.data.activePlayId, 'lawn');
    f.page.togglePlay(playEvent('lawn'));
    assert.equal(f.page.data.activePlayId, '');
    const itemBefore = structuredClone(f.page.data.item);
    f.page.toggleDetails();
    assert.equal(f.page.data.detailsOpen, true);
    f.page.toggleDetails();
    assert.equal(f.page.data.detailsOpen, false);
    assert.deepEqual(structuredClone(f.page.data.item), itemBefore, 'opening descriptions never changes the underlying facts');
    f.page.togglePlay(playEvent('walk'));
    items[0].petPolicy.status = 'unknown';
    f.page.refresh();
    assert.equal(f.page.data.activePlayId, '');
    assert.deepEqual(Array.from(f.page.data.item.playLabels), []);
    f.page.togglePlay(playEvent('walk'));
    assert.equal(f.page.data.activePlayId, '');
  } finally { f.restore(); }
});

test('one disclosure contains the full detail sections while essential facts, photos and actions remain outside', () => {
  const markup = fs.readFileSync(path.join(directory, 'index.wxml'), 'utf8');
  const nodes = [], stack = [];
  // Track actual WXML ancestry: checking that each string merely exists would
  // miss a section accidentally left visible beside the collapsed container.
  for (const match of markup.matchAll(/<!--[\s\S]*?-->|<\/?[\w-]+\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g)) {
    const tag = match[0];
    if (tag.startsWith('<!--')) continue;
    if (tag.startsWith('</')) {
      assert.equal(stack.pop().tag, /^<\/([\w-]+)/.exec(tag)[1], 'balanced WXML section tags');
      continue;
    }
    const attrs = Object.fromEntries(Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g), value => [value[1], value[2] === undefined ? value[3] : value[2]]));
    const node = { tag: /^<([\w-]+)/.exec(tag)[1], attrs, ancestors: stack.slice() };
    nodes.push(node);
    if (!/\/>$/.test(tag)) stack.push(node);
  }
  assert.equal(stack.length, 0);
  const byClass = name => nodes.filter(node => (node.attrs.class || '').split(/\s+/).includes(name));
  const bodies = byClass('details-body');
  assert.equal(bodies.length, 1, 'there is one full-content disclosure');
  assert.equal(bodies[0].attrs['wx:if'], '{{detailsOpen}}');
  const folded = node => node.ancestors.includes(bodies[0]);
  for (const name of ['play-section', 'pet-facts', 'schedule', 'detail-description', 'booking-section', 'notes-section']) {
    const sections = byClass(name);
    assert.ok(sections.length, name + ' remains available');
    assert.ok(sections.every(folded), name + ' is controlled by the common disclosure');
  }
  for (const name of ['scene-photo', 'photo-zoom', 'policy-short', 'state-banner', 'recheck-note', 'quick-time', 'quick-fee', 'address-card', 'navigation-hint', 'place-tools', 'related-guides', 'participation-card']) {
    const sections = byClass(name);
    assert.ok(sections.length, name + ' remains available');
    assert.ok(sections.every(node => !folded(node)), name + ' does not require expanding full details');
  }
  const toggles = nodes.filter(node => node.attrs.bindtap === 'toggleDetails');
  assert.equal(toggles.length, 1);
  assert.equal(toggles[0].attrs['aria-expanded'], '{{detailsOpen}}');
  assert.equal(folded(toggles[0]), false, 'the expand control cannot be hidden inside its own body');
  for (const handler of ['navigate', 'bookmark', 'openGuide', 'openOfficial']) {
    assert.ok(nodes.some(node => node.attrs.bindtap === handler && !folded(node)), handler + ' has an independent entry point');
  }
  for (const node of byClass('scene-photo').concat(byClass('photo-zoom'))) {
    assert.equal(node.attrs.bindtap, 'previewPhoto');
    assert.equal(node.attrs['data-index'], '{{photo.index}}', 'both photo and zoom button carry the stable original image index');
  }
});

test('collapsed details still preview selected photos and preserve every event fact through expand and collapse', () => {
  const items = records();
  items[1].type = 'event';
  items[1].summary = '仅测试完整活动介绍';
  items[1].petPolicy = { status: 'conditional', text: '仅室外可携宠；全程牵绳；大型犬须戴嘴套' };
  items[1].petPlayTags = ['walk', 'training'];
  items[1].feeType = 'paid';
  items[1].ticketText = '门票30元，报名与余量以主办方为准';
  items[1].notice = '出发前确认现场入口与天气安排';
  items[1].highlights = ['10月1日：13:00签到；14:00训犬指导。', '仅测试补充信息，不代表现场余量。'];
  items[1].photos = [0, 1, 2].map(index => ({ url: 'https://example.invalid/detail-photo-' + index + '.jpg', sourceUrl: 'https://example.invalid/detail-source-' + index, credit: '仅测试摄影署名', license: '仅测试许可' }));
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-show' });
    assert.equal(f.page.data.detailsOpen, false);
    assert.equal(f.page.data.item.galleryCount, 3);
    const facts = structuredClone(f.page.data.item);
    const callsBefore = f.effects.apiCalls.length;
    f.page.previewPhoto(imageEvent(2));
    assert.equal(f.effects.previews.at(-1).current, items[1].photos[2].url);
    assert.equal(f.page.data.detailsOpen, false, 'viewing the large image does not expand the article');
    f.page.toggleDetails();
    assert.equal(f.page.data.detailsOpen, true);
    assert.deepEqual(Array.from(f.page.data.item.petFacts, fact => fact.text), ['仅室外可携宠', '全程牵绳', '大型犬须戴嘴套']);
    assert.equal(f.page.data.item.schedule[0].text, '13:00签到；14:00训犬指导。');
    assert.deepEqual(Array.from(f.page.data.item.detailNotes), [items[1].highlights[1]]);
    assert.equal(f.page.data.item.description, items[1].summary);
    assert.equal(f.page.data.item.quickPrice, items[1].ticketText);
    f.page.toggleDetails();
    assert.equal(f.page.data.detailsOpen, false);
    assert.deepEqual(structuredClone(f.page.data.item), facts, 'collapse changes visibility only, never the source facts');
    f.page.photoFailed(imageEvent(0));
    f.page.previewPhoto(imageEvent(2));
    assert.deepEqual(Array.from(f.effects.previews.at(-1).urls), items[1].photos.slice(1).map(photo => photo.url));
    assert.equal(f.effects.previews.at(-1).current, items[1].photos[2].url, 'the zoom index still identifies the correct photo after an earlier image fails');
    assert.equal(f.page.data.detailsOpen, false);
    f.effects.now = Date.parse('2026-10-02T09:00:00+08:00');
    f.page.onShow();
    assert.equal(f.page.data.detailsOpen, false);
    assert.match(f.page.data.item.stateNotice, /已结束/);
    assert.equal(f.page.data.item.officialButtonText, '打开往期原文');
    assert.equal(f.page.data.item.notice, items[1].notice);
    assert.ok(f.effects.apiCalls.slice(callsBefore).every(call => call[0] === 'getPlace'), 'disclosure and image interactions never register participation or write data');
    assert.equal(f.effects.reference, null);
    assert.deepEqual(f.effects.mapNavigation, []);
    assert.deepEqual(f.effects.copied, []);
  } finally { f.restore(); }
});

test('destination navigation uses a checked point, falls back to public address and stops when the destination is missing', async () => {
  const items = records();
  items[0].point = { latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' };
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    assert.equal(f.page.data.item.reference, null);
    assert.equal(f.page.data.item.distance, null);
    assert.equal(f.page.data.item.navigationLabel, '地图导航');
    await f.page.navigate();
    assert.equal(f.effects.mapNavigation.length, 1);
    assert.deepEqual(f.effects.mapNavigation[0].point, items[0].point);
    assert.equal(f.effects.mapNavigation[0].details.address, items[0].address);
    assert.equal(f.effects.locationRequests, 0);
    assert.deepEqual(f.effects.copied, []);
    items[0].point.coordinateSystem = 'wgs84';
    items[0].venue = '仅测试实际场馆';
    f.page.refresh();
    assert.equal(f.page.data.item.navigationLabel, '地图导航');
    assert.equal(f.page.data.item.canLocate, true);
    await f.page.navigate();
    assert.equal(f.effects.mapNavigation.length, 1);
    assert.deepEqual(f.effects.addressNavigation, [{ id: items[0].id, name: items[0].venue, address: items[0].address, city: items[0].city }]);
    items[0].address = '';
    f.page.refresh();
    assert.equal(f.page.data.item.canLocate, false);
    await f.page.navigate();
    assert.match(f.effects.toasts.at(-1), /具体地点尚未公布/);
    assert.deepEqual(f.effects.modals, []);
    assert.deepEqual(f.effects.copied, []);
    assert.deepEqual(f.effects.opened, [], 'missing destination cannot silently open an unrelated source');
    assert.equal(f.effects.addressNavigation.length, 1);
    assert.equal(f.effects.mapNavigation.length, 1);
    assert.equal(f.effects.locationRequests, 0);
    assert.deepEqual(f.effects.apiCalls.map(call => call[0]), ['getPlace'], 'only the optional directory read is performed');
  } finally { f.restore(); }
});

test('event timelines retain only explicitly dated programmes and move no unrelated notes into invented sessions', () => {
  const items = records();
  Object.assign(items[1], {
    type: 'event', startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-08T00:00:00+08:00', datePrecision: 'day',
    dateLabel: '10月1日—7日 · 具体场次见日程',
    highlights: [
      '10月1日：13:00签到；14:00训犬指导。',
      '10月2日:9:00课堂；报名截止以公告为准。',
      '日程预告：10月3日草地游戏，10月4—6日障碍体验，10月7日收官；每日16:00—17:00，天气变化可能调整。',
      '具体名额与入场条件需向主办方确认。',
      '2026年9月29日发布，没有公布新的场次。',
      '日程预告：具体场次待公布', '', null
    ]
  });
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-show' });
    const schedule = f.page.data.item.schedule;
    assert.equal(f.page.data.item.sceneKind, 'event');
    assert.deepEqual(Array.from(schedule, row => row.time), ['10月1日', '10月2日', '10月3日', '10月4—6日', '10月7日']);
    assert.equal(schedule[0].text, '13:00签到；14:00训犬指导。');
    assert.equal(schedule[1].text, '9:00课堂；报名截止以公告为准。');
    assert.equal(schedule[3].title, '障碍体验');
    assert.equal(schedule[3].text, '每日16:00—17:00，天气变化可能调整。');
    assert.deepEqual(Array.from(f.page.data.item.detailNotes), items[1].highlights.slice(3, 6));
    assert.doesNotMatch(JSON.stringify(schedule), /00:00|9月29日|具体场次待公布/);
    assert.equal(f.page.data.item.quickTime, items[1].dateLabel);
    assert.equal(f.page.data.item.quickPrice, items[1].ticketText);
    f.effects.now = Date.parse('2026-10-08T00:00:00+08:00');
    f.page.onShow();
    assert.equal(f.page.data.item.timeStatus, 'ended');
    assert.equal(f.page.data.item.schedule.length, 5, 'historical programmes remain facts while the action changes to a review');
    assert.equal(f.page.data.item.officialButtonText, '打开往期原文');
    items[1].status = 'cancelled';
    f.page.onShow();
    assert.equal(f.page.data.item.timeStatus, 'cancelled');
    assert.match(f.page.data.item.stateNotice, /已取消/);
    assert.equal(f.page.data.item.officialButtonText, '查看活动公告');
  } finally { f.restore(); }
});

test('places, invalid date ranges and month-only announcements never acquire an event timeline from loose copy', () => {
  const items = records();
  const programmeCopy = '10月1日：13:00活动体验。';
  items[0].highlights = [programmeCopy];
  items[1].highlights = [programmeCopy, '资料查阅于2026年9月29日。'];
  items[1].startsAt = '2026-10-03T09:00:00+08:00';
  items[1].endsAt = '2026-10-01T17:00:00+08:00';
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    assert.deepEqual(Array.from(f.page.data.item.schedule), []);
    assert.deepEqual(Array.from(f.page.data.item.detailNotes), [programmeCopy]);
    f.page.onLoad({ id: 'fixture-show' });
    assert.equal(f.page.data.item.timeStatus, 'undated');
    assert.deepEqual(Array.from(f.page.data.item.schedule), []);
    assert.deepEqual(Array.from(f.page.data.item.detailNotes), items[1].highlights);
    Object.assign(items[1], { startsAt: undefined, endsAt: undefined, announcementMonth: '2027-04', dateLabel: '2027年4月 · 日期待公布' });
    f.page.refresh();
    assert.equal(f.page.data.item.isAnnouncement, true);
    assert.deepEqual(Array.from(f.page.data.item.schedule), []);
    assert.equal(f.page.data.item.quickTime, items[1].dateLabel);
    assert.deepEqual(Array.from(f.page.data.item.detailNotes), items[1].highlights);
    assert.equal(f.page.data.item.officialButtonText, '打开活动预告');
  } finally { f.restore(); }
});

test('backgrounded or closed details ignore residual image, source and navigation events after an issued jump', async () => {
  const items = records();
  items[0].photo = { url: 'https://example.invalid/cover.jpg', sourceUrl: 'https://example.invalid/photo-source' };
  items[0].photos = [{ url: 'https://example.invalid/second.jpg' }];
  items[0].petPolicy = { status: 'conditional', text: '仅测试规则' };
  items[0].petPlayTags = ['walk'];
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    let finish;
    f.links.open = (url, title) => { f.effects.opened.push({ url, title }); return new Promise(resolve => { finish = resolve; }); };
    const pending = f.page.openOfficial();
    assert.equal(f.effects.opened.length, 1);
    f.page.onHide();
    const hidden = structuredClone(f.page.data.item);
    f.page.previewPhoto(imageEvent(0));
    f.page.photoFailed(imageEvent(0));
    f.page.galleryScroll({ detail: { scrollWidth: 600, scrollLeft: 300 } });
    f.page.togglePlay(playEvent('walk'));
    f.page.toggleDetails();
    await f.page.navigate();
    await f.page.openPhotoInfo(photoInfoEvent(0, 'sourceUrl'));
    await f.page.openSource({ currentTarget: { dataset: { index: 0 } } });
    await f.page.openPointSource();
    finish();
    await pending;
    assert.deepEqual(structuredClone(f.page.data.item), hidden);
    assert.equal(f.page.data.galleryIndex, 0);
    assert.equal(f.page.data.activePlayId, '');
    assert.equal(f.page.data.detailsOpen, false);
    assert.deepEqual(f.effects.previews, []);
    assert.deepEqual(f.effects.copied, []);
    assert.deepEqual(f.effects.mapNavigation, []);
    assert.deepEqual(f.effects.addressNavigation, []);
    assert.equal(f.effects.opened.length, 1, 'the already issued jump is retained, with no hidden-page follow-up');
    f.page.onShow();
    f.page.previewPhoto(imageEvent(1));
    assert.equal(f.effects.previews.length, 1, 'returning to the page restores normal interaction');
    const shown = structuredClone(f.page.data.item);
    f.page.onUnload();
    f.page.previewPhoto(imageEvent(0));
    f.page.photoFailed(imageEvent(1));
    f.page.galleryScroll({ detail: { scrollWidth: 600, scrollLeft: 300 } });
    f.page.togglePlay(playEvent('walk'));
    f.page.toggleDetails();
    await f.page.openOfficial();
    await f.page.openPhotoInfo(photoInfoEvent(0, 'sourceUrl'));
    await f.page.openSource({ currentTarget: { dataset: { index: 0 } } });
    await f.page.openPointSource();
    await f.page.navigate();
    assert.equal(f.effects.previews.length, 1);
    assert.equal(f.effects.opened.length, 1);
    assert.deepEqual(f.effects.modals, []);
    assert.deepEqual(structuredClone(f.page.data.item), shown);
    assert.equal(f.page.writesAfterUnload, 0);
    assert.deepEqual(f.effects.copied, []);
    assert.equal(f.effects.locationRequests, 0);
  } finally { f.restore(); }
});

test('cancelled or stale navigation is quiet and closing during a pending navigation never writes afterward', async () => {
  const items = records();
  items[0].point = { latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' };
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'fixture-place' });
    for (const code of ['LOCATION_CANCELLED', 'LOCATION_STALE']) {
      f.location.navigateTo = async () => { throw Object.assign(new Error('仅测试导航中断'), { code }); };
      await f.page.navigate();
      assert.equal(f.page.data.busy, false);
    }
    assert.deepEqual(f.effects.toasts, []);
    let finish;
    f.location.navigateTo = () => new Promise(resolve => { finish = resolve; });
    const pending = f.page.navigate();
    f.page.onUnload();
    finish();
    await pending;
    assert.equal(f.page.writesAfterUnload, 0);
    assert.deepEqual(f.effects.copied, []);
    assert.deepEqual(f.effects.toasts, []);
  } finally { f.restore(); }
});

test('known registration steps are visible without claiming a platform booking or applying a partial deadline to the whole festival', async () => {
  const items = structuredClone(require('../miniprogram/data/nearby-catalogue').records.filter(item => item.type !== 'place'));
  const f = setup(items);
  try {
    f.page.onLoad({ id: 'event-dingfeng-pets-2026' });
    const guide = f.page.data.item.participation;
    assert.equal(f.page.data.detailsOpen, false);
    assert.equal(f.page.data.referencesOpen, false);
    assert.equal(guide.state, 'guide');
    assert.equal(guide.label, '公众号报名');
    assert.match(guide.steps[0].text, /鼎丰酱园/);
    assert.match(guide.steps[1].text, /酱子好玩.*萌爪派对/);
    assert.match(guide.fee, /活动免费.*市集消费另计/);
    assert.match(guide.note, /小课堂、摊主及志愿者.*9月30日前报名/);
    assert.match(guide.note, /不是整个生活节的统一截止时间/);
    assert.equal(f.page.data.item.officialButtonText, '查看报名指引');
    await f.page.openOfficial();
    assert.equal(f.effects.opened.at(-1).url, guide.sourceUrl);
    assert.deepEqual(f.effects.copied, []);
    assert.ok(f.effects.apiCalls.every(call => call[0] === 'getPlace'));
    // Passing the local recruiting deadline must not close the three-day event.
    f.effects.now = Date.parse('2026-10-01T10:00:00+08:00');
    f.page.onShow();
    assert.equal(f.page.data.item.participation.state, 'guide');
    assert.equal(f.page.data.item.participation.steps.length, 3);
    f.effects.now = Date.parse('2026-10-04T00:00:00+08:00');
    f.page.onShow();
    assert.equal(f.page.data.item.participation.state, 'closed');
    assert.equal(f.page.data.item.participation.steps.length, 0);
    assert.equal(f.page.data.item.participation.contact, '');
    assert.equal(f.page.data.item.officialButtonText, '打开往期原文');
  } finally { f.restore(); }
});

test('all event records have honest participation guidance and unsupported external links keep the useful local steps', () => {
  const items = structuredClone(require('../miniprogram/data/nearby-catalogue').records.filter(item => item.type !== 'place'));
  const f = setup(items);
  try {
    f.links.canOpen = () => false;
    for (const item of items) {
      f.page.onLoad({ id: item.id });
      assert.ok(f.page.data.item.participation.title, item.id + ' has a clear next step or status');
      assert.equal(f.page.data.item.participation.canOpen, false);
      assert.equal(f.page.data.item.sources.length, item.sources.length);
      assert.doesNotMatch(f.page.data.item.officialButtonText, /立即报名|立即购票/);
    }
    f.page.onLoad({ id: 'event-shenlong-pet-adventure-2026' });
    assert.equal(f.page.data.item.participation.contact, '18930760079');
    assert.match(f.page.data.item.participation.fee, /198元.*3人/);
    assert.match(f.page.data.item.participation.note, /门牌不一致.*实际入口/);
    f.page.onLoad({ id: 'event-baijia-pet-market-2026' });
    assert.equal(f.page.data.item.participation.state, 'pending');
    assert.match(f.page.data.item.participation.note, /摊主招募已截止/);
    f.page.onLoad({ id: 'notice-pfa-boutique-2027' });
    assert.equal(f.page.data.item.participation.steps.length, 0);
    assert.match(f.page.data.item.participation.note, /尚未确认/);
    assert.equal(f.page.data.item.officialButtonText, '打开活动预告');
  } finally { f.restore(); }
});

test('cancellation, withdrawal and changed evidence never retain an actionable stale registration path', () => {
  const event = structuredClone(require('../miniprogram/data/nearby-catalogue').records.find(item => item.id === 'event-dingfeng-pets-2026'));
  const f = setup([event]);
  try {
    f.page.onLoad({ id: event.id });
    event.status = 'cancelled';
    f.page.refresh();
    assert.equal(f.page.data.item.participation.state, 'closed');
    assert.equal(f.page.data.item.participation.steps.length, 0);
    assert.equal(f.page.data.item.participation.contact, '');
    assert.match(f.page.data.item.participation.note, /请勿按原场次报名/);
    assert.equal(f.page.data.item.officialButtonText, '查看活动公告');
    delete event.status;
    event.active = false;
    f.page.refresh();
    assert.equal(f.page.data.item.participation.label, '已下架');
    assert.equal(f.page.data.item.participation.steps.length, 0);
    assert.equal(f.page.data.item.officialButtonText, '查看原有公告');
    event.active = true;
    event.sources = [{ title: '测试用更新公告', url: 'https://example.invalid/new-announcement' }];
    f.page.refresh();
    assert.equal(f.page.data.item.participation.state, 'pending');
    assert.doesNotMatch(JSON.stringify(f.page.data.item.participation), /酱子好玩|萌爪派对|18121343143/);
    assert.equal(f.page.data.item.officialUrl, event.sources[0].url);
  } finally { f.restore(); }
});

test('updated announcements or participation facts retire the pinned guide even while the original evidence remains', () => {
  const base = structuredClone(require('../miniprogram/data/nearby-catalogue').records.find(item => item.id === 'event-dingfeng-pets-2026'));
  const event = structuredClone(base);
  const f = setup([event]);
  try {
    f.page.onLoad({ id: event.id });
    const originalPath = JSON.stringify(f.page.data.item.participation.steps);
    event.sources[0].checkedAt = '2026-10-01';
    event.checkedAt = '2026-10-01';
    f.page.refresh();
    assert.equal(JSON.stringify(f.page.data.item.participation.steps), originalPath, 'a desk-research refresh alone does not invalidate checked participation facts');
    const mutations = [
      record => record.sources.push({ title: '仅测试：报名改期公告', url: 'https://example.invalid/newer-notice', publishedAt: '2026-09-30' }),
      record => { record.sources[0].title = '仅测试：报名办法已更新'; },
      record => { record.sources[0].publishedAt = '2026-09-30'; },
      record => { record.startsAt = '2026-10-02T00:00:00+08:00'; },
      record => { record.ticketText = '仅测试：参与费用已更新'; },
      record => { record.highlights.push('仅测试：报名菜单已改变'); }
    ];
    for (const mutate of mutations) {
      Object.keys(event).forEach(key => delete event[key]);
      Object.assign(event, structuredClone(base));
      mutate(event);
      f.page.refresh();
      const guide = f.page.data.item.participation;
      assert.equal(guide.state, 'pending');
      assert.equal(guide.fee, event.ticketText, 'the latest record, not the pinned guide, supplies the fee');
      assert.equal(guide.contact, '');
      assert.doesNotMatch(JSON.stringify(guide.steps), /酱子好玩|萌爪派对/);
      assert.ok(event.sources.some(source => source.url === base.sources[0].url), 'the original URL still exists in every regression case');
      assert.equal(f.page.data.item.officialUrl, event.sources.at(-1).url);
    }
    // A source appended after a newer notice but published earlier must not win.
    event.sources.push({ title: '仅测试：较新公告', url: 'https://example.invalid/current-notice', publishedAt: '2026-10-01' });
    event.sources.push({ title: '仅测试：补充旧资料', url: 'https://example.invalid/old-reference', publishedAt: '2026-09-01' });
    f.page.refresh();
    assert.equal(f.page.data.item.officialUrl, 'https://example.invalid/current-notice');
  } finally { f.restore(); }
});

test('a cancelled event links to its actual public announcement without calling an old article a cancellation notice', async () => {
  const event = structuredClone(require('../miniprogram/data/nearby-catalogue').records.find(item => item.id === 'event-dingfeng-pets-2026'));
  event.status = 'cancelled';
  const f = setup([event]);
  try {
    f.page.onLoad({ id: event.id });
    assert.equal(f.page.data.item.participation.state, 'closed');
    assert.equal(f.page.data.item.officialButtonText, '查看活动公告');
    assert.equal(f.page.data.item.participation.steps.length, 0);
    assert.equal(f.page.data.item.participation.contact, '');
    await f.page.openOfficial();
    assert.equal(f.effects.opened.at(-1).url, event.sources[0].url);
    assert.deepEqual(f.effects.copied, []);
    assert.ok(f.effects.apiCalls.every(call => call[0] === 'getPlace'));
  } finally { f.restore(); }
});

test('the participation header opens the current safe original or explains unsupported links without copying, and ignores inactive-page actions', async () => {
  const items = records();
  const event = items[1];
  const f = setup(items);
  try {
    f.page.onLoad({ id: event.id });
    await f.page.openParticipationSource();
    assert.equal(f.effects.opened.at(-1).url, event.sources[0].url);
    assert.deepEqual(f.effects.modals, []);
    // Refresh both the current evidence and its platform capability on click.
    event.sources.push({ title: '仅测试：新版参与公告', publisher: '仅测试新来源', url: 'https://example.invalid/current-participation', publishedAt: '2026-09-30' });
    f.links.canOpen = () => false;
    await f.page.openParticipationSource();
    assert.equal(f.effects.opened.length, 1);
    const modal = f.effects.modals.at(-1);
    assert.equal(modal.showCancel, false);
    assert.equal(modal.confirmText, '知道了');
    assert.match(modal.content, /当前微信暂不支持打开此网页/);
    assert.match(modal.content, /来源：仅测试新来源/);
    assert.ok(modal.content.includes(event.sources.at(-1).url));
    assert.equal(f.page.data.busy, false);
    assert.deepEqual(f.effects.copied, []);
    f.page.data.busy = true;
    await f.page.openParticipationSource();
    f.page.data.busy = false;
    f.page.onHide();
    await f.page.openParticipationSource();
    assert.equal(f.effects.modals.length, 1);
    assert.equal(f.effects.opened.length, 1);
    f.page.onShow();
    event.sources = [{ title: '仅测试：不安全链接', url: 'javascript:alert(1)' }];
    await f.page.openParticipationSource();
    assert.equal(f.effects.modals.length, 1);
    assert.equal(f.effects.opened.length, 1);
    event.sources = [{ title: '仅测试：恢复原文', url: 'https://example.invalid/restored' }];
    f.links.canOpen = () => true;
    let finish;
    f.links.open = (url, title) => { f.effects.opened.push({ url, title }); return new Promise(resolve => { finish = resolve; }); };
    const pending = f.page.openParticipationSource();
    assert.equal(f.effects.opened.at(-1).url, event.sources[0].url);
    f.page.onUnload();
    await f.page.openParticipationSource();
    finish();
    await pending;
    assert.equal(f.effects.opened.length, 2);
    assert.equal(f.effects.modals.length, 1);
    assert.equal(f.page.writesAfterUnload, 0);
    assert.deepEqual(f.effects.copied, []);
  } finally { f.restore(); }
});
