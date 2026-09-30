'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const shared = require('../miniprogram/pages/_shared');

const tap = id => ({ currentTarget: { dataset: { id } } });
const meetup = (id, values = {}) => ({ id, title: '小聚 ' + id, startAt: Date.now() + 86400000, endAt: Date.now() + 90000000, capacity: 8, attendeeCount: 1, petPolicy: 'optional', status: 'published', isJoined: false, ...values });
const neighbor = (id, values = {}) => ({ id, nickname: '宠友 ' + id, pet: { name: '宠物 ' + id, type: 'cat' }, isFollowing: false, ...values });
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { resolve, promise }; };
const ids = items => Array.from(items, item => item.id);

function fixture(t) {
  const previous = { wx: global.wx, Page: global.Page, call: shared.api.call };
  const state = { user: { id: 'viewer-a', isAdmin: true, neighborVisible: true }, mode: 'demo', calls: [], writes: [], toasts: [], directories: 0, reference: null };
  const records = require('../miniprogram/data/nearby-catalogue').records.slice(0, 2);
  const handlers = {
    listEvents: payload => payload.cursor ? { items: [meetup('event-b')], nextCursor: 'events-next-2' } : { items: [meetup('event-a')], nextCursor: 'events-next-1' },
    listNeighbors: payload => payload.cursor ? { items: [neighbor('neighbor-b')], nextCursor: 'neighbors-next-2' } : { items: [neighbor('neighbor-a')], nextCursor: 'neighbors-next-1' },
    bootstrap: () => ({ mode: state.mode, user: { ...state.user }, settings: { city: '上海' } })
  };
  global.wx = { stopPullDownRefresh() {}, showToast({ title }) { state.toasts.push(title); } };
  shared.api.call = async (action, payload = {}) => { state.calls.push({ action, payload: structuredClone(payload) }); return handlers[action](payload); };
  let definition; global.Page = value => { definition = value; };
  const filename = path.resolve(__dirname, '../miniprogram/pages/nearby/index.js');
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { wx: global.wx, require(name) {
    if (name === '../_shared') return shared;
    if (name === '../../services/places') return { listAll: async () => { state.directories++; return structuredClone(records); } };
    if (name === '../../services/nearby-location') return { getReference: () => state.reference, distanceFor: () => null, cancelPending() {} };
    if (name === '../../data/nearby-catalogue') return { records, region: '上海', checkedAt: '2026-09-30' };
    return localRequire(name);
  } }, { filename });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { state.writes.push(structuredClone(value)); Object.assign(this.data, value); } };
  t.after(() => { global.wx = previous.wx; global.Page = previous.Page; shared.api.call = previous.call; });
  return { page, state, handlers };
}

test('returning to nearby preserves loaded meetup pages, order, cursor and expansion while updating their current state', async t => {
  const { page, state, handlers } = fixture(t);
  await page.onLoad(); await page.loadMore();
  page.data.showMorePlaces = true; page.data.neighboursOpen = true;
  handlers.listEvents = payload => payload.cursor
    ? { items: [meetup('event-b', { isJoined: true, attendeeCount: 3 })], nextCursor: 'different-latest-cursor' }
    : { items: [meetup('new-event'), meetup('event-a', { title: '更新标题' })], nextCursor: 'new-first-cursor' };
  page.onHide(); state.writes = []; state.calls = [];
  state.reference = { source: 'manual', label: '返回时的距离参照' };
  await page.onShow();
  assert.deepEqual(ids(page.data.items), ['event-a', 'event-b']);
  assert.equal(page.data.items[0].title, '更新标题');
  assert.equal(page.data.items[1].isJoined, true);
  assert.equal(page.data.items[1].attendeeCount, 3);
  assert.equal(page.data.nextCursor, 'events-next-2');
  assert.equal(page.data.showMorePlaces, true);
  assert.equal(page.data.neighboursOpen, true);
  assert.equal(page.data.referenceText, '手选参照：返回时的距离参照');
  assert.equal(state.directories, 2, 'online place updates still run on return');
  assert.equal(state.writes.some(value => value.loading === true || value.items && value.items.length === 0), false, 'the visible list is never replaced by a loading screen or an empty first page');
  assert.deepEqual(state.calls.filter(call => call.action === 'listEvents').map(call => call.payload.cursor || null), [null, 'events-next-1']);
});

test('neighbor return refreshes all already opened pages without collapsing them or resetting pagination', async t => {
  const { page, state, handlers } = fixture(t);
  await page.onLoad(); await page.selectTab(tap('neighbors')); await page.loadMoreNeighbors();
  handlers.listNeighbors = payload => payload.cursor
    ? { items: [neighbor('neighbor-b', { isFollowing: true, distanceBand: '约1–3km' })] }
    : { items: [neighbor('new-neighbor'), neighbor('neighbor-a', { nickname: '已更新的昵称' })] };
  page.onHide(); state.writes = []; state.calls = [];
  await page.onShow();
  assert.deepEqual(ids(page.data.neighbors), ['neighbor-a', 'neighbor-b']);
  assert.equal(page.data.neighbors[0].nickname, '已更新的昵称');
  assert.equal(page.data.neighbors[1].isFollowing, true);
  assert.equal(page.data.neighbors[1].distanceBand, '约1–3km');
  assert.equal(page.data.neighborNextCursor, 'neighbors-next-2');
  assert.equal(state.writes.some(value => value.neighborLoading === true || value.neighbors && value.neighbors.length === 0), false);
  assert.deepEqual(state.calls.filter(call => call.action === 'listNeighbors').map(call => call.payload.cursor || null), [null, 'neighbors-next-1']);
  handlers.listNeighbors = () => ({ items: [] });
  page.onHide(); await page.onShow();
  assert.deepEqual(ids(page.data.neighbors), [], 'withdrawn or no longer visible cards do not remain after successful revalidation');
});

test('a background refresh failure preserves already visible meetup and neighbor cards', async t => {
  const { page, handlers, state } = fixture(t);
  await page.onLoad(); await page.loadMore();
  handlers.listEvents = () => { throw Error('offline'); };
  page.onHide(); await page.onShow();
  assert.deepEqual(ids(page.data.items), ['event-a', 'event-b']);
  assert.equal(page.data.nextCursor, 'events-next-2');
  assert.equal(page.data.eventsError, '');
  await page.selectTab(tap('neighbors')); await page.loadMoreNeighbors();
  handlers.listNeighbors = () => { throw Error('offline'); };
  page.onHide(); await page.onShow();
  assert.deepEqual(ids(page.data.neighbors), ['neighbor-a', 'neighbor-b']);
  assert.equal(page.data.neighborNextCursor, 'neighbors-next-2');
  assert.equal(page.data.neighborError, '');
  assert.equal(state.toasts.length, 2);
});

test('manual pull and filter changes still reload page one instead of preserving the old scope', async t => {
  const { page, handlers, state } = fixture(t);
  await page.onLoad(); await page.loadMore();
  handlers.listEvents = () => ({ items: [meetup('fresh-event')], nextCursor: 'fresh-event-next' });
  state.writes = [];
  await page.onPullDownRefresh();
  assert.deepEqual(ids(page.data.items), ['fresh-event']);
  assert.equal(page.data.nextCursor, 'fresh-event-next');
  assert.ok(state.writes.some(value => value.loading === true));
  await page.selectTab(tap('neighbors')); await page.loadMoreNeighbors();
  handlers.listNeighbors = payload => ({ items: [neighbor(payload.petType)], nextCursor: 'filtered-next' });
  await page.selectNeighborPet(tap('dog'));
  assert.deepEqual(ids(page.data.neighbors), ['dog']);
  assert.equal(page.data.neighborNextCursor, 'filtered-next');
  assert.deepEqual(Array.from(page._neighborPageCursors), [null]);
});

test('a different viewer clears both account-dependent lists and rechecks page one before retaining any state', async t => {
  const { page, handlers, state } = fixture(t);
  await page.onLoad(); await page.loadMore();
  await page.selectTab(tap('neighbors')); await page.loadMoreNeighbors();
  state.user = { id: 'viewer-b', isAdmin: false, neighborVisible: false };
  handlers.listNeighbors = () => { throw Error('new account list unavailable'); };
  page.onHide(); await page.onShow();
  assert.deepEqual(ids(page.data.neighbors), []);
  assert.equal(page.data.neighborNextCursor, null);
  assert.deepEqual(ids(page.data.items), []);
  assert.equal(page.data.nextCursor, null);
  assert.equal(page.data.isAdmin, false);
  assert.equal(page.data.selfNeighborVisible, false);
  assert.match(page.data.neighborError, /new account/);
});

test('late retained pages cannot replace a newer explicit neighbor filter', async t => {
  const { page, handlers } = fixture(t);
  await page.onLoad(); await page.selectTab(tap('neighbors')); await page.loadMoreNeighbors();
  const pending = deferred();
  handlers.listNeighbors = () => pending.promise;
  page.onHide(); const refresh = page.onShow();
  handlers.listNeighbors = () => ({ items: [neighbor('current-filter')] });
  await page.selectNeighborPet(tap('dog'));
  pending.resolve({ items: [neighbor('obsolete-page')] }); await refresh;
  assert.deepEqual(ids(page.data.neighbors), ['current-filter']);
  assert.equal(page.data.neighborPetType, 'dog');
});

test('new entries ahead of a retained page cannot silently evict older cards outside the refreshed cursor range', async t => {
  const { page, handlers } = fixture(t);
  handlers.listEvents = () => ({ items: [meetup('m-event'), meetup('l-event')], nextCursor: 'l-event' });
  await page.onLoad();
  handlers.listEvents = () => ({ items: [meetup('z-new'), meetup('y-new')], nextCursor: 'y-new' });
  page.onHide(); await page.onShow();
  assert.deepEqual(ids(page.data.items), ['m-event', 'l-event']);
  assert.equal(page.data.nextCursor, 'l-event');
  handlers.listEvents = () => ({ items: [meetup('m-event', { isJoined: true })] });
  page.onHide(); await page.onShow();
  assert.deepEqual(ids(page.data.items), ['m-event'], 'a complete response can confirm that a former card is gone');
  assert.equal(page.data.items[0].isJoined, true);
});

test('retained meetup revalidation blocks overlapping pagination until its snapshot is applied', async t => {
  const { page, handlers, state } = fixture(t);
  await page.onLoad();
  const pending = deferred(); handlers.listEvents = () => pending.promise;
  page.onHide(); const refresh = page.onShow();
  assert.equal(page.data.loading, false, 'retained cards remain displayed');
  const requests = state.calls.filter(call => call.action === 'listEvents').length;
  await page.loadMore();
  assert.equal(state.calls.filter(call => call.action === 'listEvents').length, requests, 'pagination must wait while the retained snapshot is being revalidated');
  pending.resolve({ items: [meetup('event-a', { isJoined: true })], nextCursor: 'events-next-1' }); await refresh;
  handlers.listEvents = () => ({ items: [meetup('event-b')], nextCursor: 'events-next-2' });
  await page.loadMore();
  assert.deepEqual(ids(page.data.items), ['event-a', 'event-b']);
  assert.equal(page.data.items[0].isJoined, true);
  assert.equal(page.data.nextCursor, 'events-next-2');
});

test('neighbor retained refresh blocks pagination, and an older refresh cannot unlock a newer one', async t => {
  const { page, handlers, state } = fixture(t);
  await page.onLoad(); await page.selectTab(tap('neighbors'));
  const old = deferred(); handlers.listNeighbors = () => old.promise;
  page.onHide(); const previous = page.onShow();
  const current = deferred(); handlers.listNeighbors = () => current.promise;
  const refreshing = page.refreshNeighbors({ retain: true });
  old.resolve({ items: [neighbor('obsolete')] }); await previous;
  const requests = state.calls.filter(call => call.action === 'listNeighbors').length;
  await page.loadMoreNeighbors();
  assert.equal(state.calls.filter(call => call.action === 'listNeighbors').length, requests, 'an obsolete finally cannot unblock pagination during a newer refresh');
  assert.equal(page.data.neighborLoading, false);
  current.resolve({ items: [neighbor('neighbor-a', { isFollowing: true })], nextCursor: 'neighbors-next-1' }); await refreshing;
  handlers.listNeighbors = () => ({ items: [neighbor('neighbor-b')], nextCursor: 'neighbors-next-2' });
  await page.loadMoreNeighbors();
  assert.deepEqual(ids(page.data.neighbors), ['neighbor-a', 'neighbor-b']);
  assert.equal(page.data.neighbors[0].isFollowing, true);
  assert.equal(page.data.neighborNextCursor, 'neighbors-next-2');
});

test('hiding invalidates old meetup refreshes and pagination before either can publish late content', async t => {
  const { page, handlers, state } = fixture(t);
  await page.onLoad();
  const refreshing = deferred(); handlers.listEvents = () => refreshing.promise;
  const oldRefresh = page.refresh({ retain: true });
  page.onHide(); const writes = state.writes.length;
  refreshing.resolve({ items: [meetup('hidden-update')] }); await oldRefresh;
  assert.equal(state.writes.length, writes, 'an old refresh cannot write a hidden page');
  assert.deepEqual(ids(page.data.items), ['event-a']);
  handlers.listEvents = () => ({ items: [meetup('event-a')], nextCursor: 'events-next-1' });
  await page.onShow();
  const paging = deferred(); handlers.listEvents = () => paging.promise;
  const oldPage = page.loadMore(); page.onHide();
  const afterHide = state.writes.length;
  paging.resolve({ items: [meetup('hidden-page')], nextCursor: 'obsolete' }); await oldPage;
  assert.equal(state.writes.length, afterHide, 'an old page must not update lists or recompute the directory after hide');
  assert.deepEqual(ids(page.data.items), ['event-a']);
  assert.equal(page.data.nextCursor, 'events-next-1');
  assert.deepEqual(Array.from(page._eventPageCursors), [null]);
});

test('returning after the initial nearby request was hidden starts a fresh load instead of waiting on the invalidated one', async t => {
  const { page, handlers } = fixture(t);
  const pending = deferred(); handlers.listEvents = () => pending.promise;
  const first = page.onLoad(); page.onHide();
  handlers.listEvents = () => ({ items: [meetup('current-initial')] });
  await page.onShow();
  assert.deepEqual(ids(page.data.items), ['current-initial']);
  assert.equal(page.data.loading, false);
  pending.resolve({ items: [meetup('old-initial')] }); await first;
  assert.deepEqual(ids(page.data.items), ['current-initial']);
});
