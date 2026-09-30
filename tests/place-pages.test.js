'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../miniprogram/pages/_shared');
const drafts = require('../miniprogram/pages/_drafts');
const location = require('../miniprogram/services/nearby-location');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed, newUser } = require('./helpers/community-fixture');
const catalogue = require('../miniprogram/data/nearby-catalogue');
const evt = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, prepare) {
  const seed = createSeed(Date.now());
  if (prepare) prepare(seed);
  const storage = new Map([[STORAGE_KEY, seed]]);
  const effects = { calls: [], routes: [], toasts: [], copied: [], locationRequests: 0 };
  const platform = {
    getStorageSync: key => structuredClone(storage.get(key) || ''),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
    showToast: value => effects.toasts.push(value.title),
    showModal: value => value.success({ confirm: true }),
    navigateTo: value => effects.routes.push(value.url),
    switchTab: value => effects.routes.push(value.url),
    navigateBack: () => effects.routes.push('back'),
    setClipboardData: value => { effects.copied.push(value.data); value.success({}); },
    stopPullDownRefresh() {}, setNavigationBarTitle() {},
    getLocation() { effects.locationRequests += 1; throw new Error('Unexpected location request'); },
    chooseLocation() { effects.locationRequests += 1; throw new Error('Unexpected location request'); }
  };
  const previous = { wx: global.wx, Page: global.Page, call: shared.api.call, resumeUploads: shared.api.resumeUploads };
  global.wx = platform;
  const service = createDemoService(platform);
  const overrides = {};
  shared.api.call = async (action, payload = {}) => {
    effects.calls.push({ action, payload: structuredClone(payload) });
    return overrides[action] ? overrides[action](payload) : service.call(action, payload);
  };
  shared.api.resumeUploads = async () => ({ images: [], completed: [], pending: [], failures: [] });
  t.after(() => { global.wx = previous.wx; global.Page = previous.Page; shared.api.call = previous.call; shared.api.resumeUploads = previous.resumeUploads; });
  await service.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  function instantiate(name) {
    let definition; global.Page = value => { definition = value; };
    const source = require.resolve('../miniprogram/pages/' + name + '/index');
    delete require.cache[source]; require(source);
    assert.ok(definition);
    return { ...definition, data: structuredClone(definition.data), _closed: false, writesAfterUnload: 0,
      setData(values) { if (this._closed) this.writesAfterUnload += 1; Object.assign(this.data, values); } };
  }
  async function mount(name, options = {}) {
    const page = instantiate(name); page.onLoad(options);
    for (let count = 0; count < 20; count += 1) {
      await flush();
      if (!page.data.loading && !page.data.placesBusy && !page.data.uploadsBusy) break;
    }
    assert.equal(page.data.loading, false, name + ' completes loading');
    assert.equal(page.data.error, '', name + ' loads without an error');
    return page;
  }
  return { service, effects, storage, overrides, instantiate, mount };
}

test('a saved public place and private visit flow into a post without copying the private note or requesting location', async t => {
  const f = await fixture(t);
  const place = catalogue.records.find(item => item.type === 'place');
  const detail = await f.mount('local-detail', { id: place.id });
  await detail.bookmark();
  const saved = await f.mount('places');
  assert.ok(saved.data.items.some(item => item.id === place.id));
  detail.openVisitForm(); detail.visitDate(evt({}, '2026-09-29'));
  detail.visitInput(evt({}, '仅自己看的到访备注，不会公开'));
  await detail.saveVisit();
  detail.shareVisit();
  const options = Object.fromEntries(new URLSearchParams(f.effects.routes.at(-1).split('?')[1]));
  assert.equal(options.placeId, place.id); assert.ok(options.visitId);
  const compose = await f.mount('compose', options);
  assert.equal(compose.data.selectedPlaceId, place.id);
  assert.equal(compose.data.selectedVisitId, options.visitId);
  compose.input(evt({}, '真实到访后的公开分享'));
  await compose.submit();
  const payload = f.effects.calls.find(call => call.action === 'createPost').payload;
  assert.doesNotMatch(JSON.stringify(payload), /仅自己看的|latitude|longitude|residenceCell/);
  assert.equal(payload.placeId, place.id); assert.equal(payload.visitId, options.visitId);
  const visits = await f.mount('places', { type: 'visits' });
  assert.equal(visits.data.items[0].note, '仅自己看的到访备注，不会公开');
  assert.ok(visits.data.items[0].postId);
  visits.data.items[0].place.active = false;
  visits.shareVisit(evt({ id: options.visitId }));
  assert.equal(f.effects.routes.at(-1), '/pages/post/index?id=' + visits.data.items[0].postId, 'an existing share remains reachable after its venue is withdrawn');
  assert.equal(f.effects.locationRequests, 0);
});

test('opening compose from another place keeps the existing draft until its explicit replace action', async t => {
  const f = await fixture(t);
  const [before, requested] = catalogue.records.filter(item => item.type === 'place');
  const oldVisit = (await f.service.call('recordPlaceVisit', { placeId: before.id, visitedOn: '2026-09-29' })).visit;
  const newVisit = (await f.service.call('recordPlaceVisit', { placeId: requested.id, visitedOn: '2026-09-29' })).visit;
  const boot = await f.service.call('bootstrap');
  drafts.save('demo:' + boot.user.id, { text: '原来写了一半的草稿', title: '原有标题', images: [], circleId: boot.circles.find(item => item.isJoined).id, selectedPlaceId: before.id, selectedVisitId: oldVisit.id });
  const compose = await f.mount('compose', { placeId: requested.id, visitId: newVisit.id });
  assert.equal(compose.data.text, '原来写了一半的草稿');
  assert.equal(compose.data.selectedPlaceId, before.id);
  assert.equal(compose.data.selectedVisitId, oldVisit.id);
  assert.equal(compose.data.pendingPlaceId, requested.id);
  compose.applyRequestedPlace();
  assert.equal(compose.data.selectedPlaceId, requested.id);
  assert.equal(compose.data.selectedVisitId, newVisit.id);
  assert.equal(compose.data.text, '原来写了一半的草稿');
  assert.equal(compose.data.title, '原有标题');
  assert.equal(compose.data.pendingPlaceId, '');
  const persisted = drafts.read('demo:' + boot.user.id).value;
  assert.equal(persisted.selectedPlaceId, requested.id);
  assert.equal(persisted.text, '原来写了一半的草稿');
  compose.choosePlace(evt({}, 0));
  assert.equal(compose.data.selectedVisitId, '', 'removing a venue also removes its private visit association');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/compose/index.wxml'), 'utf8'), /改用刚才到访/);
});

test('saved catalogue events remain visible and an ordinary member cannot load the place operator interface', async t => {
  const f = await fixture(t, seed => { seed.users.push(newUser('member', false)); });
  const event = catalogue.records.find(item => item.type !== 'place');
  await f.service.call('bookmarkPlace', { id: event.id, bookmark: true });
  const saved = await f.mount('places');
  assert.ok(saved.data.items.some(item => item.id === event.id));
  const state = f.storage.get(STORAGE_KEY); state.currentUserId = 'member';
  const before = f.effects.calls.length;
  const management = await f.mount('places-manage');
  assert.equal(management.data.isAdmin, false);
  assert.deepEqual(management.data.items, []);
  assert.deepEqual(management.data.corrections, []);
  assert.deepEqual(f.effects.calls.slice(before).map(call => call.action), ['bootstrap']);
  management.create(); assert.equal(management.data.form, null);
});

test('legacy correction links open saved places while the two remaining tabs preserve private visits and existing correction data', async t => {
  const f = await fixture(t, seed => {
    seed.place_corrections = [{ id: 'retained-correction', userId: 'demo-self', placeId: catalogue.records[0].id, placeTitle: '仅测试地点', category: '其他信息', text: '既有纠错资料继续由运营者审核', status: 'pending', createdAt: 1 }];
  });
  const place = catalogue.records.find(item => item.type === 'place');
  await f.service.call('bookmarkPlace', { id: place.id, bookmark: true });
  const visit = (await f.service.call('recordPlaceVisit', { placeId: place.id, visitedOn: '2026-09-29', note: '仅自己可见的到访备注' })).visit;
  const correctionsBefore = structuredClone(f.storage.get(STORAGE_KEY).place_corrections);
  const before = f.effects.calls.length;
  const page = await f.mount('places', { type: 'corrections' });
  assert.equal(page.data.type, 'saved', 'an old correction URL falls back to bookmarks');
  assert.deepEqual(page.data.tabs.map(tab => tab.id), ['saved', 'visits']);
  assert.ok(page.data.items.some(item => item.id === place.id));
  assert.deepEqual(f.effects.calls.slice(before).map(call => call.action), ['listPlaces']);
  assert.equal(f.effects.calls.at(-1).payload.bookmarked, true);
  const callsBeforeInvalidTab = f.effects.calls.length;
  await page.selectTab(evt({ id: 'corrections' }));
  assert.equal(page.data.type, 'saved');
  assert.equal(f.effects.calls.length, callsBeforeInvalidTab, 'removed tabs cannot load a hidden correction list');
  await page.selectTab(evt({ id: 'visits' }));
  assert.equal(page.data.type, 'visits');
  assert.equal(page.data.items[0].id, visit.id);
  assert.equal(page.data.items[0].note, '仅自己可见的到访备注');
  await page.remove(evt({ id: visit.id }));
  assert.equal(page.data.items.length, 0);
  await page.selectTab(evt({ id: 'saved' }));
  assert.ok(page.data.items.some(item => item.id === place.id), 'removing a private visit does not remove its bookmark');
  await page.remove(evt({ id: place.id }));
  assert.equal(page.data.items.length, 0);
  assert.ok(f.effects.calls.slice(before).every(call => !/PlaceCorrection/.test(call.action)));
  assert.deepEqual(f.storage.get(STORAGE_KEY).place_corrections, correctionsBefore, 'removing the user-facing tab cannot delete or alter existing correction records');
  const operatorQueue = await f.service.call('listPlaceCorrections', { status: 'pending' });
  assert.ok(operatorQueue.items.some(item => item.id === 'retained-correction'), 'operators still receive the pending correction');
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/places/index.wxml'), 'utf8');
  assert.doesNotMatch(markup, /item\.resolution|item\.category|item\.statusText|我的纠错/);
  assert.equal(f.effects.locationRequests, 0);
});

test('operators can reach every pending correction and old pagination cannot overwrite a refresh', async t => {
  const f = await fixture(t, seed => {
    seed.place_corrections = Array.from({ length: 53 }, (_, index) => ({ id: 'correction-' + index, userId: 'demo-self', placeId: catalogue.records[0].id, placeTitle: '仅测试地点', category: '其他信息', text: '仅测试待核实信息', status: 'pending', createdAt: index }));
  });
  const page = await f.mount('places-manage');
  assert.equal(page.data.corrections.length, 50); assert.equal(page.data.correctionCursor, '50');
  await Promise.all([page.loadMoreCorrections(), page.loadMoreCorrections()]);
  assert.equal(page.data.corrections.length, 53); assert.equal(page.data.correctionCursor, null);
  assert.equal(f.effects.calls.filter(call => call.action === 'listPlaceCorrections' && call.payload.cursor).length, 1);
  await page.refresh();
  let resolve;
  f.overrides.listPlaceCorrections = payload => payload.cursor ? new Promise(done => { resolve = done; }) : f.service.call('listPlaceCorrections', payload);
  const old = page.loadMoreCorrections();
  await page.refresh();
  resolve({ items: [{ id: 'stale' }], nextCursor: 'stale' }); await old;
  assert.equal(page.data.corrections.length, 50);
  assert.equal(page.data.correctionCursor, '50');
  f.overrides.listPlaceCorrections = () => { throw new Error('仅测试网络中断'); };
  await page.loadMoreCorrections();
  assert.equal(page.data.correctionsError, '仅测试网络中断');
  delete f.overrides.listPlaceCorrections;
  await page.loadMoreCorrections();
  assert.equal(page.data.corrections.length, 53); assert.equal(page.data.correctionsError, '');
  for (const name of ['places', 'places-manage']) {
    const instance = f.instantiate(name);
    const directory = path.join(__dirname, '../miniprogram/pages', name);
    JSON.parse(fs.readFileSync(path.join(directory, 'index.json'), 'utf8'));
    const markup = fs.readFileSync(path.join(directory, 'index.wxml'), 'utf8');
    for (const binding of markup.matchAll(/\b(?:bind|catch)(?:tap|input|change|confirm)="([^"]+)"/g)) assert.equal(typeof instance[binding[1]], 'function', name + ': ' + binding[1]);
  }
});

test('post distance is derived only from an existing viewer reference and a live venue with valid coordinates', async t => {
  const f = await fixture(t);
  const point = { latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' };
  const post = { id: 'distance-test', author: { id: 'author', nickname: '仅测试作者' }, text: '仅测试内容', createdAt: Date.now(), place: { id: 'place', title: '公共地点', point } };
  assert.equal(shared.post(post).placeDistanceText, '');
  location.setManualReference({ latitude: 31.101, longitude: 121.401, coordinateSystem: 'gcj02' }, '仅测试参照');
  const decorated = shared.post(post);
  assert.match(decorated.placeDistanceText, /^距仅测试参照直线 /);
  assert.ok(decorated.placeDistance.meters > 0);
  assert.equal(shared.post({ ...post, place: { ...post.place, point: undefined } }).placeDistanceText, '');
  assert.equal(shared.post({ ...post, place: { ...post.place, active: false } }).placeDistanceText, '');
  assert.equal(f.effects.locationRequests, 0);
  assert.equal(f.effects.calls.length, 0, 'decorating distance does not send the local reference to the backend');
});

test('editorial route guides are reachable from nearby and their place details, with sources and usable place links', async t => {
  const links = require('../miniprogram/services/public-links');
  const previousLinks = { open: links.open, canOpen: links.canOpen };
  const opened = [];
  links.canOpen = url => !!shared.httpsUrl(url);
  links.open = async (url, title) => { opened.push({ url, title }); };
  t.after(() => { links.open = previousLinks.open; links.canOpen = previousLinks.canOpen; });
  const f = await fixture(t);
  const nearby = await f.mount('nearby');
  assert.equal(nearby.data.guides.length, 3);
  const raw = catalogue.guides[0];
  nearby.openGuide(evt({ id: raw.id }));
  assert.equal(f.effects.routes.at(-1), '/pages/local-detail/index?guideId=' + raw.id);
  const detail = await f.mount('local-detail', { guideId: raw.id });
  assert.equal(detail.data.item, null);
  assert.match(detail.data.guide.notice, /编辑路线建议.*未实地核验/);
  assert.equal(detail.data.guide.steps.length, raw.steps.length);
  assert.ok(detail.data.guide.sources.length);
  detail.openGuideStop(evt({ id: raw.steps[0].placeId }));
  assert.equal(f.effects.routes.at(-1), '/pages/local-detail/index?id=' + raw.steps[0].placeId);
  await detail.openGuideSource(evt({ index: 0 }));
  assert.deepEqual(opened, [{ url: detail.data.guide.sources[0].url, title: detail.data.guide.sources[0].title }]);
  assert.deepEqual(f.effects.copied, []);
  assert.equal(detail.onShareAppMessage().path, '/pages/local-detail/index?guideId=' + raw.id);
  const stop = await f.mount('local-detail', { id: raw.steps[0].placeId });
  assert.ok(stop.data.item.relatedGuides.some(guide => guide.id === raw.id));
  stop.openGuide(evt({ id: raw.id }));
  assert.equal(f.effects.routes.at(-1), '/pages/local-detail/index?guideId=' + raw.id);
  assert.equal(f.effects.locationRequests, 0);
  assert.ok(f.effects.calls.every(call => ['bootstrap', 'listPlaces', 'listEvents', 'getPlace'].includes(call.action)), 'browsing a guide creates no visits, registrations or user posts');
  for (const name of ['nearby', 'local-detail']) {
    const page = f.instantiate(name);
    const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages', name, 'index.wxml'), 'utf8');
    for (const binding of markup.matchAll(/\b(?:bind|catch)(?:tap|input|change|confirm)="([^"]+)"/g)) assert.equal(typeof page[binding[1]], 'function', name + ': ' + binding[1]);
  }
});

test('route details flag withdrawn stops, reject unavailable links and ignore responses after unload', async t => {
  const f = await fixture(t);
  const raw = catalogue.guides[1]; const firstId = raw.steps[0].placeId;
  f.overrides.getPlace = async payload => {
    const result = await f.service.call('getPlace', payload);
    return payload.id === firstId ? { ...result, place: { ...result.place, active: false } } : result;
  };
  const detail = await f.mount('local-detail', { guideId: raw.id });
  assert.equal(detail.data.guide.needsUpdate, true);
  const before = f.effects.routes.length;
  detail.openGuideStop(evt({ id: firstId }));
  assert.equal(f.effects.routes.length, before);
  let resolve;
  f.overrides.getPlace = payload => payload.id === firstId ? new Promise(done => { resolve = done; }) : f.service.call('getPlace', payload);
  const late = f.instantiate('local-detail'); late.onLoad({ guideId: raw.id }); late.onUnload();
  resolve(await f.service.call('getPlace', { id: firstId })); await flush();
  assert.equal(late.writesAfterUnload, 0);
  const calls = f.effects.calls.length;
  const missing = f.instantiate('local-detail'); missing.onLoad({ guideId: 'missing-guide' });
  assert.equal(missing.data.guide, null);
  assert.match(missing.data.error, /路线攻略不存在/);
  assert.equal(f.effects.calls.length, calls);
});
