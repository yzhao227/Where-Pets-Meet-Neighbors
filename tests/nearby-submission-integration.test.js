'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoService } = require('../miniprogram/services/demo');
const { createSeed, newUser } = require('../miniprogram/data/seed');
const shared = require('../miniprogram/pages/_shared');
const catalogue = require('../miniprogram/data/nearby-catalogue');

const KEY = 'nearby-submission-page-memory';
const EPOCH = Date.parse('2026-09-30T06:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
const input = value => ({ detail: { value } });
const tap = id => ({ currentTarget: { dataset: { id } } });
const fields = extra => ({ type: 'place', title: '集成测试宠友推荐地点', city: '上海', district: '闵行区', area: '仅测试片区',
  address: '仅内存测试公开地点100号', description: '仅内存测试描述，验证运营审核后的资料进入附近页面。',
  petPolicyStatus: 'unknown', petPolicyText: '', costText: '', sourceUrl: '', ...extra });

async function fixture(t) {
  let saved = createSeed(EPOCH);
  saved.users.push(newUser('contributor', false), newUser('viewer', false), newUser('operator', true));
  const effects = { calls: [], routes: [], locationRequests: 0, writesAfterUnload: 0 };
  const platform = {
    getStorageSync: key => key === KEY ? clone(saved) : '',
    setStorageSync(key, value) { if (key === KEY) saved = clone(value); },
    removeStorageSync() {}, showToast() {}, hideKeyboard() {},
    showModal(value) { if (value.success) value.success({ confirm: true }); },
    navigateTo: value => effects.routes.push(value.url), switchTab: value => effects.routes.push(value.url),
    stopPullDownRefresh() {}, setNavigationBarTitle() {},
    getLocation() { effects.locationRequests++; throw new Error('Unexpected viewer GPS'); },
    chooseLocation() { effects.locationRequests++; throw new Error('Unexpected viewer position'); }
  };
  let service = createDemoService(platform, { storageKey: KEY, now: () => EPOCH });
  const originals = { wx: global.wx, Page: global.Page, call: shared.api.call };
  global.wx = platform;
  let holdNextList = null;
  shared.api.call = async (action, payload = {}) => {
    effects.calls.push({ action, payload: clone(payload) });
    const response = await service.call(action, payload);
    if (action === 'listPlaces' && holdNextList) {
      const hold = holdNextList; holdNextList = null;
      await new Promise(resolve => hold(resolve));
    }
    return response;
  };
  const as = id => { saved.currentUserId = id; };
  const call = (id, action, payload) => { as(id); return shared.api.call(action, payload); };
  for (const id of ['contributor', 'operator']) await call(id, 'demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  const pages = [];
  function instantiate(name) {
    let definition; global.Page = value => { definition = value; };
    const file = require.resolve('../miniprogram/pages/' + name + '/index');
    delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data), setData(value) { if (this._closed) effects.writesAfterUnload++; Object.assign(this.data, value); } };
    pages.push(page); return page;
  }
  const close = () => pages.forEach(page => { if (!page._closed) { if (page.onHide) page.onHide(); page.onUnload(); } });
  t.after(() => { close(); global.wx = originals.wx; global.Page = originals.Page; shared.api.call = originals.call; });
  return { effects, call, as, instantiate, state: () => clone(saved),
    holdList: callback => { holdNextList = callback; },
    restart: () => { close(); saved = clone(saved); service = createDemoService(platform, { storageKey: KEY, now: () => EPOCH }); } };
}

test('approved real demo submission records flow through nearby search and remote details while pending/rejected stay private', async t => {
  const f = await fixture(t);
  const sourceBefore = clone(catalogue.records);
  const placeDraft = (await f.call('contributor', 'submitNearbySubmission', { ...fields(), requestId: 'integration-place-1' })).submission;
  const eventDraft = (await f.call('contributor', 'submitNearbySubmission', { ...fields({ type: 'event', title: '集成测试宠友推荐活动', startDate: '2099-01-01', endDate: '2099-01-02',
    sourceUrl: 'https://example.invalid/public-event', costText: '以主办方公告为准' }), requestId: 'integration-event-1' })).submission;
  const rejectedDraft = (await f.call('contributor', 'submitNearbySubmission', { ...fields({ title: '不会公开的集成测试地点' }), requestId: 'integration-rejected-1' })).submission;
  await f.call('operator', 'reviewNearbySubmission', { id: rejectedDraft.id, decision: 'rejected', note: '仅测试：公开地址尚未核实' });
  f.as('viewer'); const nearby = f.instantiate('nearby'); await nearby.onLoad();
  nearby.inputSearch(input('集成测试')); nearby.search();
  assert.equal(nearby.data.places.length, 0); assert.equal(nearby.data.externalItems.length, 0);

  const publishedPlace = (await f.call('operator', 'reviewNearbySubmission', { id: placeDraft.id, decision: 'approved', confirmed: true, note: 'PRIVATE_REVIEW_NOTE' })).submission;
  const publishedEvent = (await f.call('operator', 'reviewNearbySubmission', { id: eventDraft.id, decision: 'approved', confirmed: true })).submission;
  f.as('viewer'); await nearby.refresh();
  assert.ok(f.effects.calls.some(item => item.action === 'listPlaces' && item.payload.type === 'all'));
  assert.deepEqual(nearby.data.places.map(item => item.id), [publishedPlace.publishedId]);
  assert.deepEqual(nearby.data.displayPlaces.map(item => item.id), [publishedPlace.publishedId]);
  assert.equal(nearby.data.places[0].photoUrl, '');
  assert.equal(nearby.data.places[0].point, undefined);
  assert.ok(nearby.data.districts.includes('闵行区'));
  nearby.openLocal(tap(publishedPlace.publishedId));
  assert.equal(f.effects.routes.at(-1), '/pages/local-detail/index?id=' + encodeURIComponent(publishedPlace.publishedId));
  const detail = f.instantiate('local-detail');
  const loading = detail.onLoad({ id: publishedPlace.publishedId });
  assert.equal(detail.data.loading, true); assert.equal(detail.data.error, '');
  await loading;
  assert.equal(detail.data.item.title, fields().title);
  assert.equal(detail.data.item.isPlace, true); assert.equal(detail.data.item.canNavigate, false); assert.equal(detail.data.item.canLocate, true);
  assert.equal(detail.data.item.sources.length, 0); assert.equal(detail.data.item.officialUrl, '');
  assert.equal(detail.data.item.galleryCount, 0); assert.equal(detail.data.item.checkedAt, '2026-09-30');
  assert.doesNotMatch(JSON.stringify(detail.data.item), /PRIVATE_REVIEW_NOTE|userId|lifecycleId|submittedBy/);

  nearby.selectTab(tap('activities')); nearby.inputSearch(input('集成测试宠友推荐活动')); nearby.search();
  assert.deepEqual(nearby.data.externalItems.map(item => item.id), [publishedEvent.publishedId]);
  const eventDetail = f.instantiate('local-detail'); await eventDetail.onLoad({ id: publishedEvent.publishedId });
  assert.equal(eventDetail.data.item.type, 'event'); assert.equal(eventDetail.data.item.timeStatus, 'upcoming');
  assert.match(eventDetail.data.item.timeLabel, /2099年1月1日/);
  assert.equal(eventDetail.data.item.sources[0].url, 'https://example.invalid/public-event');
  assert.equal(eventDetail.data.item.canNavigate, false); assert.equal(eventDetail.data.item.galleryCount, 0);
  assert.equal(f.effects.locationRequests, 0);
  assert.deepEqual(catalogue.records, sourceBefore, 'the static catalogue is never rewritten by submissions');

  await f.call('operator', 'unpublishNearbySubmission', { id: eventDraft.id, note: '仅测试下架活动' });
  f.as('viewer'); await nearby.refresh();
  assert.equal(nearby.data.externalItems.length, 0);
  await eventDetail.loadPlaceState(); assert.equal(eventDetail.data.item.active, false);
  f.restart(); f.as('viewer');
  const restored = f.instantiate('nearby'); await restored.onLoad(); restored.inputSearch(input('集成测试')); restored.search();
  assert.deepEqual(restored.data.places.map(item => item.id), [publishedPlace.publishedId]);
  assert.equal(f.state().nearby_submissions.length, 3); assert.equal(f.state().place_records.length, 2);
  assert.equal(f.effects.writesAfterUnload, 0);
});

test('a late directory response cannot restore a submission removed by a newer nearby refresh', async t => {
  const f = await fixture(t);
  const draft = (await f.call('contributor', 'submitNearbySubmission', { ...fields(), requestId: 'refresh-race-request' })).submission;
  await f.call('operator', 'reviewNearbySubmission', { id: draft.id, decision: 'approved', confirmed: true });
  f.as('viewer'); const nearby = f.instantiate('nearby'); await nearby.onLoad(); nearby.inputSearch(input('集成测试')); nearby.search();
  assert.equal(nearby.data.places.length, 1);
  let release; const held = new Promise(resolve => { f.holdList(done => { release = done; resolve(); }); });
  const earlier = nearby.refresh(); await held;
  await f.call('operator', 'unpublishNearbySubmission', { id: draft.id, note: '仅测试更新期间下架' });
  f.as('viewer'); await nearby.refresh(); assert.equal(nearby.data.places.length, 0);
  release(); await earlier;
  assert.equal(nearby.data.places.length, 0);
  assert.equal(nearby._placeRecords.some(item => item.title === fields().title), false);
});
