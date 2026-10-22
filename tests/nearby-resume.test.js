'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, tap, choice, ids, deferred, flush } = require('./helpers/nearby-page.cjs');

test('nearby refresh reads only the viewer and complete public directory, including an authoritative empty directory', async t => {
  const { page, state, catalogue } = fixture(t);
  state.directory = [{ ...catalogue.records[1], title: '在线更新后的地点' }];
  await page.onLoad();
  assert.deepEqual(state.calls.map(call => call.action).sort(), ['bootstrap', 'listPlaces']);
  assert.deepEqual(state.calls.find(call => call.action === 'listPlaces').payload, { type: 'all' });
  assert.deepEqual(ids(page.data.places), ['place-b']);
  assert.equal(page.data.places[0].title, '在线更新后的地点');
  assert.equal(page.data.loading, false);
  state.directory = [];
  await page.refresh();
  assert.deepEqual(ids(page.data.places), [], 'an empty accepted directory cannot resurrect bundled records');
  assert.deepEqual(ids(page.data.displayGuides), [], 'routes disappear when all of their stops are withdrawn');
  assert.equal(state.locationCalls, 0);
});

test('an initial directory outage leaves the bundled catalogue usable without granting unverified administrator rights', async t => {
  const { page, handlers, catalogue, state } = fixture(t);
  handlers.bootstrap = () => { throw Error('viewer unavailable'); };
  handlers.listPlaces = () => { throw Error('directory unavailable'); };
  await page.onLoad();
  assert.deepEqual(ids(page.data.places), ids(catalogue.records.filter(item => item.type === 'place')));
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '');
  assert.ok(page.data.placeServiceError);
  assert.equal(page.data.isAdmin, false);
  page.managePlaces();
  assert.deepEqual(state.routes, []);
});

test('returning reloads the complete directory while retaining place expansion and the chosen reference without a loading flash', async t => {
  const { page, state, catalogue } = fixture(t);
  await page.onLoad();
  assert.ok(page.data.morePlaceCount > 0);
  page.toggleMorePlaces();
  assert.equal(page.data.showMorePlaces, true);
  state.directory = catalogue.records.filter(item => item.id !== 'place-a').map(item => item.id === 'place-b' ? { ...item, title: '返回后的新标题' } : item);
  state.reference = { source: 'manual', label: '返回时的距离参照' };
  page.onHide(); state.writes = []; state.calls = [];
  await page.onShow();
  assert.equal(page.data.showMorePlaces, true);
  assert.equal(page.data.places.find(item => item.id === 'place-b').title, '返回后的新标题');
  assert.equal(page.data.displayPlaces.some(item => item.id === 'place-a'), false);
  assert.deepEqual(new Set(ids(page.data.displayPlaces)), new Set(ids(page.data.places)));
  assert.equal(new Set(ids(page.data.displayPlaces)).size, page.data.places.length);
  assert.equal(page.data.referenceText, '手选参照：返回时的距离参照');
  assert.equal(state.writes.some(value => value.loading === true || value.places && value.places.length === 0), false);
  assert.deepEqual(state.calls.map(call => call.action).sort(), ['bootstrap', 'listPlaces']);
  assert.equal(state.locationCalls, 0);
});

test('a failed return keeps the latest accepted records and expansion rather than reviving withdrawn fallback entries', async t => {
  const { page, state, handlers, catalogue } = fixture(t);
  state.directory = catalogue.records.filter(item => item.id !== 'place-a');
  await page.onLoad(); page.toggleMorePlaces();
  const before = structuredClone(page.data.displayPlaces);
  handlers.listPlaces = () => { throw Error('offline'); };
  page.onHide(); state.writes = [];
  await page.onShow();
  assert.deepEqual(structuredClone(page.data.displayPlaces), before);
  assert.equal(page.data.showMorePlaces, true);
  assert.ok(page.data.placeServiceError);
  assert.equal(page.data.error, '');
  assert.equal(state.writes.some(value => value.loading === true), false);
  handlers.listPlaces = () => [{ ...catalogue.records[2], title: '连接恢复后的地点' }];
  await page.refresh({ retain: true });
  assert.deepEqual(ids(page.data.places), ['place-c']);
  assert.equal(page.data.placeServiceError, '');
});

test('pull refresh replaces directory records and retains only region and area choices that still exist', async t => {
  const { page, state, catalogue } = fixture(t);
  await page.onLoad();
  page.selectDistrict(choice(page.data.districts.indexOf('闵行')));
  page.selectArea(choice(page.data.areas.indexOf('滨江片区')));
  state.directory = catalogue.records.map(item => item.id === 'place-a' ? { ...item, title: '更新后的河畔' } : item);
  state.writes = [];
  await page.onPullDownRefresh();
  assert.equal(state.writes.some(value => value.loading === true), true);
  assert.deepEqual(ids(page.data.places), ['place-a']);
  assert.equal(page.data.places[0].title, '更新后的河畔');
  assert.equal(page.data.selectedDistrict, '闵行');
  assert.equal(page.data.selectedArea, '滨江片区');
  state.directory = [catalogue.records[2]];
  await page.onPullDownRefresh();
  assert.equal(page.data.selectedDistrict, '');
  assert.equal(page.data.selectedArea, '');
  assert.deepEqual(ids(page.data.places), ['place-c']);
});

test('a delayed directory uses the latest visible tab and search instead of replaying the scope at request start', async t => {
  const { page, handlers, catalogue } = fixture(t);
  await page.onLoad();
  const pending = deferred(); handlers.listPlaces = () => pending.promise;
  const refresh = page.refresh({ retain: true }); await flush();
  page.selectTab(tap('guides')); page.openSearch(); page.inputSearch(choice('文化')); await page.search();
  pending.resolve(structuredClone(catalogue.records)); await refresh;
  assert.equal(page.data.tab, 'guides');
  assert.equal(page.data.query, '文化');
  assert.deepEqual(ids(page.data.displayGuides), ['guide-culture']);
});

test('a superseded refresh cannot replace a newer directory or restore the previous viewer administrator rights', async t => {
  const { page, handlers, catalogue, state } = fixture(t);
  await page.onLoad();
  const oldDirectory = deferred(), oldViewer = deferred();
  handlers.listPlaces = () => oldDirectory.promise; handlers.bootstrap = () => oldViewer.promise;
  const old = page.refresh({ retain: true }); await flush();
  const currentDirectory = deferred(), currentViewer = deferred();
  handlers.listPlaces = () => currentDirectory.promise; handlers.bootstrap = () => currentViewer.promise;
  const current = page.refresh({ retain: true }); await flush();
  currentDirectory.resolve([{ ...catalogue.records[2], title: '当前目录' }]);
  currentViewer.resolve({ mode: 'demo', user: { id: 'viewer-b', isAdmin: false }, settings: { city: '当前城市' } });
  await current;
  const writes = state.writes.length;
  oldDirectory.resolve([{ ...catalogue.records[0], title: '过期目录' }]);
  oldViewer.resolve({ mode: 'demo', user: { id: 'viewer-a', isAdmin: true }, settings: { city: '过期城市' } });
  await old;
  assert.equal(state.writes.length, writes);
  assert.deepEqual(ids(page.data.places), ['place-c']);
  assert.equal(page.data.city, '当前城市');
  assert.equal(page.data.isAdmin, false);
  page.managePlaces(); assert.deepEqual(state.routes, []);
});

test('viewer changes and failed bootstrap revoke the previously visible administrator entry', async t => {
  const { page, state, handlers } = fixture(t);
  await page.onLoad(); assert.equal(page.data.isAdmin, true);
  state.user = { id: 'viewer-b', isAdmin: false };
  page.onHide(); await page.onShow();
  assert.equal(page.data.isAdmin, false);
  page.managePlaces(); assert.deepEqual(state.routes, []);
  state.user = { id: 'viewer-a', isAdmin: true }; await page.refresh();
  assert.equal(page.data.isAdmin, true);
  handlers.bootstrap = () => { throw Object.assign(Error('account unavailable'), { code: 'ACCOUNT_UNAVAILABLE' }); };
  await page.refresh({ retain: true });
  assert.equal(page.data.isAdmin, false);
  assert.ok(page.data.places.length > 0, 'public catalogue access remains usable');
  page.managePlaces(); assert.deepEqual(state.routes, []);
});

test('hiding invalidates an in-flight refresh and hidden refresh calls do not read or write', async t => {
  const { page, state, handlers, catalogue } = fixture(t);
  await page.onLoad();
  const before = ids(page.data.places), pending = deferred();
  handlers.listPlaces = () => pending.promise;
  const refresh = page.refresh({ retain: true }); await flush();
  page.onHide(); const writes = state.writes.length, calls = state.calls.length;
  await page.refresh(); await page.onPullDownRefresh();
  pending.resolve([{ ...catalogue.records[0], title: '隐藏后的过期标题' }]); await refresh;
  assert.equal(state.calls.length, calls);
  assert.equal(state.writes.length, writes);
  assert.deepEqual(ids(page.data.places), before);
  assert.equal(page.data.places.some(item => item.title === '隐藏后的过期标题'), false);
  assert.ok(state.cancelled > 0);
});

test('returning after hiding the initial request starts a fresh load without waiting for the retired request', async t => {
  const { page, handlers, catalogue } = fixture(t);
  const pending = deferred(); handlers.listPlaces = () => pending.promise;
  const initial = page.onLoad(); await flush(); page.onHide();
  handlers.listPlaces = () => [{ ...catalogue.records[1], title: '当前初次加载' }];
  await page.onShow();
  assert.deepEqual(ids(page.data.places), ['place-b']); assert.equal(page.data.loading, false);
  pending.resolve([catalogue.records[0]]); await initial;
  assert.deepEqual(ids(page.data.places), ['place-b']);
  assert.equal(page.data.places[0].title, '当前初次加载');
});

test('unloading suppresses late directory writes and any subsequent refresh', async t => {
  const { page, state, handlers, catalogue } = fixture(t);
  await page.onLoad();
  const pending = deferred(); handlers.listPlaces = () => pending.promise;
  const refresh = page.refresh({ retain: true }); await flush(); page.onUnload();
  const writes = state.writes.length, calls = state.calls.length;
  pending.resolve([catalogue.records[0]]); await refresh; await page.refresh();
  assert.equal(state.writes.length, writes);
  assert.equal(state.calls.length, calls);
});
