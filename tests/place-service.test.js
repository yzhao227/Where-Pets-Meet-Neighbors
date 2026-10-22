'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed, newUser } = require('./helpers/community-fixture');
const { createService, idFor } = require('../cloudfunctions/community/service');
const { createSqliteRepository } = require('./helpers/sqlite-repository');
const catalogue = require('../miniprogram/data/nearby-catalogue');
const epoch = Date.parse('2026-09-30T06:00:00Z');
const reject = (promise, code) => assert.rejects(promise, error => error.code === code);
const edit = extra => ({ title: '仅测试公开地点', address: '仅测试公开场所地址', city: '上海', area: '莘庄', description: '测试资料，不是真实地点推荐', officialUrl: 'https://example.invalid/official', petPolicyText: '须牵绳并确认当天开放安排', petPolicyStatus: 'conditional', ...extra });

async function fixture(t, mode) {
  if (mode === 'demo') {
    const state = createSeed(epoch); state.users.push(newUser('alice', false), newUser('bob', false), newUser('unverified', false));
    for (const user of state.users) if (user.id !== 'unverified') user.verification = { status: 'demo_verified' };
    const values = new Map([[STORAGE_KEY, state]]);
    const platform = { getStorageSync: key => structuredClone(values.get(key) || ''), setStorageSync: (key, value) => values.set(key, structuredClone(value)), removeStorageSync: key => values.delete(key) };
    const service = createDemoService(platform, { now: () => epoch });
    const who = name => name === 'operator' ? 'demo-self' : name;
    const call = (name, action, payload = {}) => { const current = values.get(STORAGE_KEY); current.currentUserId = who(name); return service.call(action, payload); };
    for (const name of ['operator', 'alice', 'bob']) await call(name, 'demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
    return { call, who, circle: 'circle-neighbors', get: async (table, id) => structuredClone((values.get(STORAGE_KEY)[table] || []).find(row => row.id === id)),
      put: async (table, id, row) => { const current = values.get(STORAGE_KEY); current[table] ||= []; current[table] = current[table].filter(item => item.id !== id).concat({ ...row, id }); },
      rows: async table => structuredClone(values.get(STORAGE_KEY)[table] || []) };
  }
  const repository = createSqliteRepository(':memory:'); t.after(() => repository.close()); let serial = 0;
  const service = createService({ repository, now: () => epoch, randomId: () => String(++serial).padStart(24, '0'), adminOpenids: ['operator'] });
  const call = (name, action, payload = {}) => service.handle(action, payload, { openid: name });
  await call('operator', 'initialize', { city: '上海', areas: ['莘庄'], contact: '仅测试运营' });
  for (const name of ['operator', 'alice', 'bob', 'unverified']) {
    await call(name, 'bootstrap'); const userId = idFor(name);
    if (name !== 'unverified') { await repository.set('identities', userId, { status: 'phone_verified', phoneKey: 'phone-' + name }); await repository.set('phone_claims', 'phone-' + name, { userId }); }
  }
  return { call, who: idFor, circle: 'neighbors', get: (table, id) => repository.get(table, id), put: (table, id, row) => repository.set(table, id, row), rows: table => repository.find(table, {}, { limit: 1000 }) };
}

for (const mode of ['demo', 'cloud']) {
  test(mode + ': public catalogue reads, personal bookmarks and admin changes respect permissions', async t => {
    const f = await fixture(t, mode);
    const original = catalogue.records.find(item => item.type === 'place' && item.petPolicy.status === 'conditional');
    const before = structuredClone(original);
    const loaded = await f.call('alice', 'getPlace', { id: original.id });
    assert.equal(loaded.place.title, original.title);
    await reject(f.call('unverified', 'bookmarkPlace', { id: original.id, bookmark: true }), 'VERIFICATION_REQUIRED');
    await reject(f.call('alice', 'savePlace', edit()), 'FORBIDDEN');
    await reject(f.call('alice', 'listPlaces', { includeInactive: true }), 'FORBIDDEN');
    const externalEvent = catalogue.records.find(item => item.type !== 'place');
    await reject(f.call('operator', 'savePlace', edit({ id: externalEvent.id })), 'INVALID_INPUT');
    await Promise.all([f.call('alice', 'bookmarkPlace', { id: original.id, bookmark: true }), f.call('alice', 'bookmarkPlace', { id: original.id, bookmark: true })]);
    assert.equal((await f.call('alice', 'listPlaces', { bookmarked: true })).items.length, 1);
    assert.equal((await f.call('bob', 'listPlaces', { bookmarked: true })).items.length, 0);
    const updated = await f.call('operator', 'savePlace', edit({ id: original.id, active: false }));
    assert.equal(updated.place.petPolicy.status, 'conditional');
    assert.deepEqual(updated.place.playTags, original.playTags);
    assert.equal(updated.place.district, original.district);
    assert.ok(updated.place.sources.some(source => source.checkedAt));
    assert.deepEqual(original, before, 'static catalogue remains immutable');
    assert.equal((await f.call('alice', 'listPlaces', { query: updated.place.title })).items.some(item => item.id === original.id), false);
    assert.equal((await f.call('alice', 'listPlaces', { bookmarked: true })).items[0].active, false, 'withdrawn saved places remain removable');
    await f.call('alice', 'bookmarkPlace', { id: original.id, bookmark: false });
    let cursor; do { const result = await f.call('operator', 'publishPlaceCatalogue', { cursor }); cursor = result.nextCursor; } while (cursor);
    assert.equal((await f.call('alice', 'getPlace', { id: original.id })).place.active, false, 'catalogue import cannot overwrite an operator change');
  });

  test(mode + ': correction ownership, operator resolution and private visit-to-post links round trip', async t => {
    const f = await fixture(t, mode); const venue = (await f.call('operator', 'savePlace', edit())).place;
    const correction = await f.call('alice', 'submitPlaceCorrection', { placeId: venue.id, category: '携宠规则', text: '请重新核实这个地点的携宠条件。' });
    assert.equal((await f.call('bob', 'listPlaceCorrections', { mine: true })).items.length, 0);
    await reject(f.call('bob', 'listPlaceCorrections'), 'FORBIDDEN');
    await reject(f.call('bob', 'resolvePlaceCorrection', { id: correction.id, status: 'resolved', note: '冒充运营' }), 'FORBIDDEN');
    await f.call('operator', 'resolvePlaceCorrection', { id: correction.id, status: 'resolved', note: '已核实并补充携宠说明。' });
    assert.equal((await f.call('alice', 'listPlaceCorrections', { mine: true })).items[0].status, 'resolved');
    const visit = (await f.call('alice', 'recordPlaceVisit', { placeId: venue.id, visitedOn: '2026-09-29', note: '这段私人备注不会带进公开分享' })).visit;
    const repeatedVisit = (await f.call('alice', 'recordPlaceVisit', { placeId: venue.id, visitedOn: '2026-09-29' })).visit;
    assert.equal(repeatedVisit.id, visit.id, 'same-day recording is idempotent');
    assert.equal(repeatedVisit.note, '这段私人备注不会带进公开分享', 'a retry without a note preserves the existing private note');
    await f.call('alice', 'joinCircle', { id: f.circle, join: true });
    await f.call('bob', 'joinCircle', { id: f.circle, join: true });
    await reject(f.call('bob', 'createPost', { circleId: f.circle, text: '错误使用别人的到访', images: [], placeId: venue.id, visitId: visit.id }), 'INVALID_INPUT');
    const created = (await f.call('alice', 'createPost', { circleId: f.circle, text: '这是一次真实到访分享', images: [], placeId: venue.id, visitId: visit.id })).post;
    assert.equal(created.place.id, venue.id);
    assert.equal(created.visitId, visit.id);
    assert.doesNotMatch(JSON.stringify(created), /私人备注/);
    assert.equal((await f.call('bob', 'getPost', { id: created.id })).post.visitId, '');
    assert.equal((await f.call('bob', 'listPlaceVisits')).items.length, 0);
    await reject(f.call('bob', 'deletePlaceVisit', { id: visit.id }), 'NOT_FOUND');
    await f.call('alice', 'deletePost', { id: created.id });
    assert.equal((await f.call('alice', 'listPlaceVisits')).items[0].postId, '');
    const second = (await f.call('alice', 'createPost', { circleId: f.circle, text: '重新写到访经历', images: [], placeId: venue.id, visitId: visit.id })).post;
    await f.call('alice', 'deletePlaceVisit', { id: visit.id });
    const unlinked = (await f.call('alice', 'getPost', { id: second.id })).post;
    assert.equal(unlinked.visitId, ''); assert.equal(unlinked.place.id, venue.id);
  });

  test(mode + ': long place ids remain usable and coordinate validation prevents guessed personal locations', async t => {
    const f = await fixture(t, mode); const longId = 'p'.repeat(120);
    await f.put('place_records', longId, { id: longId, type: 'place', title: '长编号测试场所', active: true });
    const visit = (await f.call('alice', 'recordPlaceVisit', { placeId: longId, visitedOn: '2026-09-29' })).visit;
    assert.ok(visit.id.length < 120);
    await f.call('alice', 'bookmarkPlace', { id: longId, bookmark: true });
    assert.ok((await f.rows('place_bookmarks')).every(row => (row._id || row.id).length < 120));
    await f.call('alice', 'joinCircle', { id: f.circle, join: true });
    const published = (await f.call('alice', 'createPost', { circleId: f.circle, text: '长编号地点分享', images: [], placeId: longId, visitId: visit.id, latitude: 1, longitude: 2 })).post;
    assert.equal(published.place.point, undefined, 'client-provided coordinates are never made into post location');
    await f.call('alice', 'deletePlaceVisit', { id: visit.id });
    await reject(f.call('operator', 'savePlace', edit({ point: { latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' } })), 'INVALID_INPUT');
    await reject(f.call('operator', 'savePlace', edit({ point: { latitude: 91, longitude: 121.4, coordinateSystem: 'gcj02' }, pointConfirmed: true })), 'INVALID_INPUT');
    const place = (await f.call('operator', 'savePlace', edit({ point: { latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' }, pointConfirmed: true }))).place;
    assert.equal(place.point.precision, 'venue');
  });

  test(mode + ': account cleanup removes personal place records while keeping the public directory', async t => {
    const f = await fixture(t, mode); const venue = (await f.call('operator', 'savePlace', edit())).place;
    await f.call('alice', 'bookmarkPlace', { id: venue.id, bookmark: true });
    await f.call('alice', 'recordPlaceVisit', { placeId: venue.id, visitedOn: '2026-09-29', note: '删除时必须清除的私人备注' });
    await f.call('alice', 'submitPlaceCorrection', { placeId: venue.id, category: '地址或导航', text: '这是删除时也应清除的纠错信息' });
    await f.call('alice', 'deleteAccount');
    for (const table of ['place_bookmarks', 'place_visits', 'place_corrections']) assert.equal((await f.rows(table)).some(row => row.userId === f.who('alice')), false);
    assert.equal((await f.call('bob', 'getPlace', { id: venue.id })).place.title, venue.title);
  });

  test(mode + ': pet-purpose upload tickets cannot be consumed as post images or videos', async t => {
    const f = await fixture(t, mode); await f.call('alice', 'joinCircle', { id: f.circle, join: true });
    for (const mediaType of ['image', 'video']) {
      const fileId = 'cloud://test/' + mediaType;
      await f.put('uploads', 'pet-' + mediaType, { ticketId: 'pet-' + mediaType, ownerId: f.who('alice'), userId: f.who('alice'), fileId, purpose: 'pet', mediaType, status: 'complete', video: { url: fileId, durationSeconds: 5 } });
      const expectedCode = mode === 'demo' ? mediaType === 'video' ? 'VIDEO_DISABLED' : 'UPLOAD_UNAVAILABLE' : 'FORBIDDEN';
      await reject(f.call('alice', 'createPost', { circleId: f.circle, text: '不能把宠物专用票据作为发帖附件', images: mediaType === 'image' ? [fileId] : [], ...(mediaType === 'video' ? { video: { url: fileId } } : {}) }), expectedCode);
    }
  });
}

test('cloud: account cleanup re-reads operator attribution and preserves concurrent venue edits and withdrawals', async t => {
  const repository = createSqliteRepository(':memory:'); t.after(() => repository.close()); let serial = 0;
  const service = createService({ repository, now: () => epoch, randomId: () => String(++serial).padStart(24, '0'), adminOpenids: ['departing', 'keeper'] });
  const call = (name, action, payload = {}) => service.handle(action, payload, { openid: name });
  await call('departing', 'initialize', { city: '上海', areas: ['莘庄'], contact: '仅测试运营' });
  await call('keeper', 'bootstrap');
  const changedOwner = (await call('departing', 'savePlace', edit({ title: '旧标题一' }))).place;
  const sameOwner = (await call('departing', 'savePlace', edit({ title: '旧标题二' }))).place;
  const originalFind = repository.find.bind(repository); let interleaved = false;
  repository.find = async (table, filters, options) => {
    const snapshot = await originalFind(table, filters, options);
    if (!interleaved && table === 'place_records' && filters.updatedBy === idFor('departing')) {
      interleaved = true;
      await call('keeper', 'savePlace', edit({ id: changedOwner.id, title: '接手运营者更新的标题', active: false }));
      const latest = await repository.get('place_records', sameOwner.id);
      await repository.set('place_records', sameOwner.id, { ...latest, title: '同署名最后提交的新版资料', active: false });
    }
    return snapshot;
  };
  await call('departing', 'deleteAccount');
  assert.equal(interleaved, true, 'the edit happens after the cleanup candidate snapshot has been read');
  const transferred = await repository.get('place_records', changedOwner.id);
  assert.equal(transferred.title, '接手运营者更新的标题');
  assert.equal(transferred.active, false);
  assert.equal(transferred.updatedBy, idFor('keeper'), 'cleanup must not clear a different operator’s attribution');
  const unattributed = await repository.get('place_records', sameOwner.id);
  assert.equal(unattributed.title, '同署名最后提交的新版资料');
  assert.equal(unattributed.active, false);
  assert.equal(unattributed.updatedBy, '', 'the departing operator’s attribution is removed from the current record only');
});

test('the cloud deployment uses the same place domain contract as the mini program', () => {
  assert.equal(fs.readFileSync(require.resolve('../miniprogram/services/place-engine'), 'utf8'), fs.readFileSync(require.resolve('../cloudfunctions/community/place-engine'), 'utf8'));
  assert.deepEqual(require('../cloudfunctions/community/place-catalogue'), JSON.parse(JSON.stringify(catalogue)), 'sync-place-catalogue.js must publish the current reviewed baseline for cloud deployment');
});
