'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoService } = require('../miniprogram/services/demo');
const { createSeed, newUser } = require('../miniprogram/data/seed');

const KEY = 'nearby-submission-memory';
const EPOCH = Date.parse('2026-09-30T06:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
const fields = extra => ({ type: 'place', title: '仅内存测试宠友地点', city: '上海', district: '闵行区', area: '莘庄',
  address: '仅内存测试公开场所地址100号', description: '这是内存测试专用的公开场所描述，不是真实推荐。',
  sourceUrl: '', petPolicyStatus: 'unknown', petPolicyText: '', costText: '', ...extra });

async function fixture() {
  let saved = createSeed(EPOCH), failWrites = false;
  for (const name of ['alice', 'bob', 'operator', 'unverified']) saved.users.push({ ...newUser(name, name === 'operator'), nickname: '内存测试' + name });
  const platform = { getStorageSync: key => { assert.equal(key, KEY); return clone(saved); },
    setStorageSync(key, value) { if (key !== KEY) return; if (failWrites) throw new Error('memory full'); saved = clone(value); },
    removeStorageSync() {} };
  let service = createDemoService(platform, { storageKey: KEY, now: () => EPOCH });
  const as = name => { saved.currentUserId = name; };
  const call = (name, action, payload = {}) => { as(name); return service.call(action, payload); };
  for (const name of ['alice', 'bob', 'operator']) await call(name, 'demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  return { call, as, state: () => clone(saved), edit: fn => fn(saved), failWrites: value => { failWrites = value; },
    restart: () => { saved = clone(saved); service = createDemoService(platform, { storageKey: KEY, now: () => EPOCH }); } };
}

test('demo submissions stay private until approved, require verification and cannot forge public fields', async () => {
  const f = await fixture();
  await assert.rejects(f.call('unverified', 'submitNearbySubmission', { ...fields(), requestId: 'unverified-1' }), { code: 'VERIFICATION_REQUIRED' });
  assert.equal(f.state().nearby_submissions.length, 0);
  await assert.rejects(f.call('alice', 'submitNearbySubmission', { ...fields(), requestId: 'submit-private-1', userId: 'operator', isAdmin: true, active: true, photos: ['https://example.invalid/fake.jpg'], point: { latitude: 1, longitude: 2 } }), { code: 'INVALID_INPUT' });
  assert.equal(f.state().nearby_submissions.length, 0);
  const submitted = await f.call('alice', 'submitNearbySubmission', { ...fields(), requestId: 'submit-private-1' });
  assert.equal(submitted.submission.status, 'pending');
  assert.equal((await f.call('bob', 'listNearbySubmissions', { mine: true, status: 'all' })).items.length, 0);
  assert.equal((await f.call('alice', 'listNearbySubmissions', { status: 'pending' })).items.length, 1);
  await assert.rejects(f.call('bob', 'listNearbySubmissions', { mine: false }), { code: 'FORBIDDEN' });
  await assert.rejects(f.call('alice', 'reviewNearbySubmission', { id: submitted.submission.id, decision: 'approved', confirmed: true, isAdmin: true }), { code: 'FORBIDDEN' });
  assert.equal((await f.call('bob', 'listPlaces', { type: 'all', query: '仅内存测试宠友地点' })).items.length, 0);
  await assert.rejects(f.call('bob', 'getPlace', { id: submitted.submission.id }), { code: 'NOT_FOUND' });
  const review = await f.call('operator', 'reviewNearbySubmission', { id: submitted.submission.id, decision: 'approved', confirmed: true, note: 'PRIVATE_REVIEW_NOTE' });
  const publicRecord = (await f.call('bob', 'getPlace', { id: review.submission.publishedId })).place;
  assert.equal(publicRecord.title, fields().title);
  assert.equal(publicRecord.type, 'place');
  assert.equal(publicRecord.active, true);
  assert.equal(publicRecord.categoryLabel, '宠友推荐地点');
  assert.equal(publicRecord.photo, undefined); assert.equal(publicRecord.photos, undefined); assert.equal(publicRecord.point, undefined);
  assert.equal(publicRecord.officialUrl, undefined); assert.ok(!publicRecord.sources || publicRecord.sources.length === 0);
  assert.doesNotMatch(JSON.stringify(publicRecord), /PRIVATE_REVIEW_NOTE|userId|lifecycleId|isAdmin|fake\.jpg|submittedBy/);
});

test('demo submission validation leaves no lifecycle, private draft or public record behind on failure', async () => {
  const f = await fixture(); f.as('alice');
  const before = f.state();
  for (const invalid of [
    { title: '一' }, { description: '短' }, { type: 'exhibition' }, { sourceUrl: 'javascript:alert(1)' },
    { petPolicyStatus: 'allowed', petPolicyText: '' }, { type: 'event', startDate: '2026-02-30', endDate: '2026-03-01' },
    { type: 'event', startDate: '2026-10-02', endDate: '2026-10-01' }, { requestId: 'short' }
  ]) await assert.rejects(f.call('alice', 'submitNearbySubmission', { ...fields(invalid), requestId: invalid.requestId || 'invalid-request-1' }), { code: 'INVALID_INPUT' });
  assert.deepEqual(f.state(), before);
});

test('demo retries preserve one submission/publication and terminal reviews never reverse previous decisions', async () => {
  const f = await fixture();
  const payload = { ...fields(), requestId: 'duplicate-request-1' };
  const first = await f.call('alice', 'submitNearbySubmission', payload);
  const retry = await f.call('alice', 'submitNearbySubmission', payload);
  assert.equal(retry.submission.id, first.submission.id);
  assert.equal(f.state().nearby_submissions.length, 1);
  await assert.rejects(f.call('alice', 'submitNearbySubmission', { ...payload, title: '不同的内存测试名称' }));
  const approved = await f.call('operator', 'reviewNearbySubmission', { id: first.submission.id, decision: 'approved', confirmed: true, fields: fields({ title: '运营核实后的内存地点' }) });
  const repeated = await f.call('operator', 'reviewNearbySubmission', { id: first.submission.id, decision: 'approved', confirmed: true });
  assert.equal(repeated.submission.publishedId, approved.submission.publishedId);
  assert.equal(f.state().place_records.length, 1);
  assert.equal(f.state().place_records[0].title, '运营核实后的内存地点');
  await assert.rejects(f.call('operator', 'reviewNearbySubmission', { id: first.submission.id, decision: 'rejected', note: '不能反转已完成审核' }));
  const rejected = await f.call('alice', 'submitNearbySubmission', { ...fields(), requestId: 'rejected-request-1' });
  await assert.rejects(f.call('operator', 'reviewNearbySubmission', { id: rejected.submission.id, decision: 'rejected', note: '' }), { code: 'INVALID_INPUT' });
  await f.call('operator', 'reviewNearbySubmission', { id: rejected.submission.id, decision: 'rejected', note: '需要进一步核实公开地址' });
  await f.call('operator', 'reviewNearbySubmission', { id: rejected.submission.id, decision: 'rejected', note: '重复处理' });
  await assert.rejects(f.call('operator', 'reviewNearbySubmission', { id: rejected.submission.id, decision: 'approved', confirmed: true }));
  assert.equal(f.state().place_records.length, 1);
});

test('demo event approval maps dates, reference and price without importing caller-only properties', async () => {
  const f = await fixture();
  const submission = (await f.call('alice', 'submitNearbySubmission', { ...fields({ type: 'event', title: '内存测试宠友活动', sourceUrl: 'https://example.invalid/public-event',
    startDate: '2099-01-01', endDate: '2099-01-02', costText: '费用待现场确认', petPolicyStatus: 'conditional', petPolicyText: '需全程牵绳' }), requestId: 'event-request-1' })).submission;
  await assert.rejects(f.call('operator', 'reviewNearbySubmission', { id: submission.id, decision: 'approved' }), { code: 'INVALID_INPUT' });
  const approved = (await f.call('operator', 'reviewNearbySubmission', { id: submission.id, decision: 'approved', confirmed: true })).submission;
  const record = (await f.call('bob', 'getPlace', { id: approved.publishedId })).place;
  assert.equal(record.type, 'event'); assert.equal(record.startsAt, '2099-01-01T00:00:00+08:00'); assert.equal(record.endsAt, '2099-01-02T23:59:59+08:00');
  assert.equal(record.ticketText, '费用待现场确认'); assert.equal(record.petPolicy.status, 'conditional');
  assert.equal(record.officialUrl, 'https://example.invalid/public-event');
  assert.equal(record.sources[0].url, 'https://example.invalid/public-event');
  assert.equal((await f.call('bob', 'listPlaces', { type: 'all', query: record.title })).items.length, 1);
  assert.equal((await f.call('bob', 'listPlaces', { query: record.title })).items.length, 0);
});

test('demo owner withdrawal and operator unpublish have distinct authorization and atomic public results', async () => {
  const f = await fixture();
  const pending = (await f.call('alice', 'submitNearbySubmission', { ...fields(), requestId: 'withdraw-request-1' })).submission;
  await assert.rejects(f.call('bob', 'withdrawNearbySubmission', { id: pending.id }), { code: 'NOT_FOUND' });
  await f.call('alice', 'withdrawNearbySubmission', { id: pending.id });
  await f.call('alice', 'withdrawNearbySubmission', { id: pending.id });
  await assert.rejects(f.call('operator', 'reviewNearbySubmission', { id: pending.id, decision: 'approved', confirmed: true }));
  const candidate = (await f.call('alice', 'submitNearbySubmission', { ...fields(), requestId: 'unpublish-request-1' })).submission;
  const approved = (await f.call('operator', 'reviewNearbySubmission', { id: candidate.id, decision: 'approved', confirmed: true })).submission;
  await assert.rejects(f.call('alice', 'withdrawNearbySubmission', { id: candidate.id }));
  await assert.rejects(f.call('alice', 'unpublishNearbySubmission', { id: candidate.id, note: '我不能直接下架' }), { code: 'FORBIDDEN' });
  await f.call('operator', 'unpublishNearbySubmission', { id: candidate.id, note: '内存测试下架' });
  await f.call('operator', 'unpublishNearbySubmission', { id: candidate.id, note: '内存测试重复下架' });
  assert.equal((await f.call('bob', 'getPlace', { id: approved.publishedId })).place.active, false);
  assert.equal((await f.call('bob', 'listPlaces', { type: 'all', query: fields().title })).items.length, 0);
});

test('demo same-time submission pagination is private, stable and survives service recreation', async () => {
  const f = await fixture();
  const owned = [];
  for (let i = 0; i < 5; i++) owned.push((await f.call('alice', 'submitNearbySubmission', { ...fields({ title: '内存测试分页地点' + i }), requestId: 'paging-request-' + i })).submission.id);
  await f.call('bob', 'submitNearbySubmission', { ...fields(), requestId: 'bob-paging-request' });
  let cursor; const seen = [];
  do {
    const result = await f.call('alice', 'listNearbySubmissions', { mine: true, status: 'all', cursor, limit: 2 });
    seen.push(...result.items.map(item => item.id)); cursor = result.nextCursor;
  } while (cursor);
  assert.deepEqual(seen.slice().sort(), owned.slice().sort()); assert.equal(new Set(seen).size, 5);
  f.restart();
  assert.equal((await f.call('operator', 'listNearbySubmissions', { mine: false, status: 'pending' })).items.length, 6);
  assert.equal((await f.call('bob', 'listNearbySubmissions', { mine: true })).items.length, 1);
});

test('demo submission and review storage failures preserve the complete prior snapshot', async () => {
  const f = await fixture(); f.as('alice');
  const original = f.state(); f.failWrites(true);
  const payload = { ...fields(), requestId: 'storage-request-1' };
  await assert.rejects(f.call('alice', 'submitNearbySubmission', payload), { code: 'STORAGE_UNAVAILABLE' });
  assert.deepEqual(f.state(), original);
  f.failWrites(false); const submitted = (await f.call('alice', 'submitNearbySubmission', payload)).submission;
  f.as('operator'); const pending = f.state(); f.failWrites(true);
  await assert.rejects(f.call('operator', 'reviewNearbySubmission', { id: submitted.id, decision: 'approved', confirmed: true }), { code: 'STORAGE_UNAVAILABLE' });
  assert.deepEqual(f.state(), pending);
  f.failWrites(false); await f.call('operator', 'reviewNearbySubmission', { id: submitted.id, decision: 'approved', confirmed: true });
  f.as('operator'); const published = f.state(); f.failWrites(true);
  await assert.rejects(f.call('operator', 'unpublishNearbySubmission', { id: submitted.id, note: '内存测试撤回' }), { code: 'STORAGE_UNAVAILABLE' });
  assert.deepEqual(f.state(), published);
});

test('demo deletion removes private submissions and changes lifecycle without resurrecting approved records', async () => {
  const f = await fixture();
  const payload = { ...fields(), requestId: 'lifecycle-request-1' };
  const approvedDraft = (await f.call('alice', 'submitNearbySubmission', payload)).submission;
  const approved = (await f.call('operator', 'reviewNearbySubmission', { id: approvedDraft.id, decision: 'approved', confirmed: true })).submission;
  const pending = (await f.call('alice', 'submitNearbySubmission', { ...fields(), requestId: 'pending-before-delete' })).submission;
  const lifecycle = f.state().users.find(user => user.id === 'alice').nearbySubmissionLifecycleId;
  assert.ok(lifecycle);
  await f.call('alice', 'deleteAccount');
  const retained = f.state().nearby_submissions;
  assert.equal(retained.length, 1);
  assert.equal(retained[0].id, approvedDraft.id);
  assert.equal(retained[0].publishedId, approved.publishedId);
  assert.equal(retained[0].status, 'approved');
  for (const key of ['userId', 'lifecycleId', 'requestId', 'submittedFields', 'reviewNote']) assert.equal(Object.hasOwn(retained[0], key), false, key);
  await assert.rejects(f.call('operator', 'reviewNearbySubmission', { id: pending.id, decision: 'approved', confirmed: true }), { code: 'NOT_FOUND' });
  assert.equal((await f.call('bob', 'getPlace', { id: approved.publishedId })).place.active, true);
  await f.call('alice', 'bootstrap');
  await f.call('alice', 'demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  const fresh = (await f.call('alice', 'submitNearbySubmission', payload)).submission;
  assert.notEqual(fresh.id, approvedDraft.id);
  assert.notEqual(f.state().users.find(user => user.id === 'alice').nearbySubmissionLifecycleId, lifecycle);
  assert.equal(fresh.status, 'pending');
  assert.equal(f.state().place_records.length, 1);
});

test('demo operators can unpublish anonymous events after their contributors delete and recreate accounts', async () => {
  const f = await fixture();
  const eventFields = fields({ type: 'event', title: '内存测试删号后的公开活动', startDate: '2099-01-01', endDate: '2099-01-02' });
  const event = (await f.call('alice', 'submitNearbySubmission', { ...eventFields, requestId: 'event-before-delete' })).submission;
  const reviewedFields = { ...eventFields, title: '运营核实后保留的内存活动' };
  const approved = (await f.call('operator', 'reviewNearbySubmission', { id: event.id, decision: 'approved', confirmed: true,
    fields: reviewedFields, note: 'PRIVATE_CONTRIBUTOR_REVIEW_NOTE' })).submission;
  await f.call('alice', 'submitNearbySubmission', { ...fields(), requestId: 'private-pending-before-delete' });
  const rejected = (await f.call('alice', 'submitNearbySubmission', { ...fields(), requestId: 'private-rejected-before-delete' })).submission;
  await f.call('operator', 'reviewNearbySubmission', { id: rejected.id, decision: 'rejected', note: 'PRIVATE_REJECTION_NOTE' });

  await f.call('alice', 'deleteAccount');
  const retained = f.state().nearby_submissions;
  assert.equal(retained.length, 1);
  assert.equal(retained[0].id, event.id);
  assert.equal(retained[0].title, reviewedFields.title);
  assert.equal(retained[0].publishedId, approved.publishedId);
  for (const key of ['userId', 'lifecycleId', 'requestId', 'submittedFields', 'reviewNote']) assert.equal(Object.hasOwn(retained[0], key), false, key);
  assert.doesNotMatch(JSON.stringify(retained), /PRIVATE_CONTRIBUTOR_REVIEW_NOTE|PRIVATE_REJECTION_NOTE|event-before-delete/);
  assert.equal((await f.call('bob', 'getPlace', { id: approved.publishedId })).place.active, true);

  await f.call('alice', 'bootstrap');
  // Local-demo bootstrap grants operator tools; this fixture represents a
  // recreated ordinary contributor when checking submission ownership.
  f.edit(state => { state.users.find(user => user.id === 'alice').isAdmin = false; });
  await f.call('alice', 'demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  assert.deepEqual((await f.call('alice', 'listNearbySubmissions', { mine: true, status: 'all' })).items, []);
  await assert.rejects(f.call('alice', 'withdrawNearbySubmission', { id: event.id }), { code: 'NOT_FOUND' });
  await assert.rejects(f.call('alice', 'unpublishNearbySubmission', { id: event.id, note: '原投稿者没有运营权限' }), { code: 'FORBIDDEN' });
  const managed = (await f.call('operator', 'listNearbySubmissions', { mine: false, status: 'approved' })).items;
  assert.deepEqual(managed.map(item => item.id), [event.id]);
  assert.equal(managed[0].title, reviewedFields.title);
  f.restart();
  await f.call('operator', 'unpublishNearbySubmission', { id: event.id, note: '运营下架匿名保留的公开活动' });
  await f.call('operator', 'unpublishNearbySubmission', { id: event.id, note: '重复下架保持相同结果' });
  assert.equal((await f.call('bob', 'getPlace', { id: approved.publishedId })).place.active, false);
  assert.deepEqual((await f.call('bob', 'listPlaces', { type: 'all', query: reviewedFields.title })).items, []);
  assert.deepEqual((await f.call('alice', 'listNearbySubmissions', { mine: true, status: 'all' })).items, []);
});
