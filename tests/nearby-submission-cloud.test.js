'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, idFor } = require('../cloudfunctions/community/service');
const { createSqliteRepository } = require('./helpers/sqlite-repository');
const { COLLECTIONS } = require('../cloudfunctions/community/repository');
const epoch = Date.parse('2026-09-30T06:00:00Z');
const fields = extra => ({ type: 'place', title: '测试宠友推荐地点', city: '上海', district: '闵行区', area: '莘庄', address: '测试公共场所地址100号',
  description: '仅用于内存测试的公开地点资料，不是真实地点推荐。', sourceUrl: '', petPolicyStatus: 'unknown', petPolicyText: '', costText: '', ...extra });
const reject = (promise, code) => assert.rejects(promise, error => error.code === code);

async function fixture(t, options = {}) {
  const repository = createSqliteRepository(':memory:'); t.after(() => repository.close()); let serial = 0;
  const checked = [];
  const service = createService({ repository, now: () => epoch, randomId: () => String(++serial).padStart(24, '0'), adminOpenids: ['operator'],
    runtimeConfig: { rateLimits: { submitNearbySubmission: { limit: 1000, windowMs: 60000 }, reviewNearbySubmission: { limit: 1000, windowMs: 60000 } } },
    moderateText: async (body, openid) => { checked.push({ body, openid }); if (options.moderateText) await options.moderateText(body, openid); }
  });
  const call = (who, action, payload = {}) => service.handle(action, payload, { openid: who });
  for (const who of ['operator', 'alice', 'bob', 'unverified']) {
    await call(who, 'bootstrap');
    if (who !== 'unverified') {
      const userId = idFor(who);
      await repository.set('identities', userId, { status: 'phone_verified', phoneKey: 'test-phone-' + who });
      await repository.set('phone_claims', 'test-phone-' + who, { userId });
    }
  }
  const submit = (who = 'alice', extra = {}, requestId = 'request-one') => call(who, 'submitNearbySubmission', { ...fields(extra), requestId });
  const review = (id, extra = {}) => call('operator', 'reviewNearbySubmission', { id, decision: 'approved', confirmed: true, ...extra });
  return { repository, call, checked, submit, review, rows: (table, filters = {}) => repository.find(table, filters, { limit: 1000 }) };
}

test('cloud submissions are private, verified, isolated by owner and idempotent without changing the public directory', async t => {
  const f = await fixture(t);
  const before = await f.rows('place_records');
  await reject(f.submit('unverified'), 'VERIFICATION_REQUIRED');
  const attempts = await Promise.all([f.submit(), f.submit()]);
  assert.deepEqual(attempts[0], attempts[1]);
  const row = attempts[0].submission;
  assert.equal(row.status, 'pending'); assert.equal(row.publishedId, undefined);
  assert.deepEqual(await f.rows('place_records'), before);
  assert.equal((await f.call('alice', 'listPlaces', { type: 'all', query: row.title })).items.length, 0);
  assert.equal((await f.call('bob', 'listNearbySubmissions')).items.length, 0);
  assert.equal((await f.call('alice', 'listNearbySubmissions')).items[0].id, row.id);
  for (const key of ['userId', 'lifecycleId', 'requestId', 'submittedFields', '_id']) assert.equal(row[key], undefined);
  await reject(f.call('bob', 'listNearbySubmissions', { mine: false }), 'FORBIDDEN');
  await reject(f.call('bob', 'withdrawNearbySubmission', { id: row.id }), 'NOT_FOUND');
  await reject(f.call('bob', 'reviewNearbySubmission', { id: row.id, decision: 'approved', confirmed: true }), 'FORBIDDEN');
  await reject(f.call('alice', 'submitNearbySubmission', { ...fields(), requestId: 'new-request', userId: idFor('operator') }), 'INVALID_INPUT');
  await reject(f.submit('alice', { title: '同请求编号的另一份资料' }), 'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.rows('nearby_submissions')).length, 1);
  assert.ok(f.checked.some(check => check.openid === 'alice' && check.body.includes(row.description)));
});

test('approval publishes exactly one whitelisted event with reviewed edits and preserves original submission retry semantics', async t => {
  const f = await fixture(t);
  const submitted = (await f.submit()).submission;
  const approvedFields = fields({ type: 'event', title: '已核实的测试宠友活动', sourceUrl: 'https://example.invalid/reference?event=1', petPolicyStatus: 'conditional',
    petPolicyText: '仅测试牵引与健康要求', costText: '费用请向主办方确认', startDate: '2024-02-29', endDate: '2024-03-01' });
  const payload = { fields: approvedFields, note: 'PRIVATE_REVIEW_NOTE' };
  const approvals = await Promise.all([f.review(submitted.id, payload), f.review(submitted.id, payload)]);
  assert.deepEqual(approvals[0], approvals[1]);
  const approved = approvals[0].submission;
  assert.equal(approved.status, 'approved'); assert.equal(approved.title, approvedFields.title);
  assert.equal((await f.rows('place_records')).length, 1);
  const result = (await f.call('bob', 'getPlace', { id: approved.publishedId })).place;
  assert.equal(result.type, 'event'); assert.equal(result.startsAt, '2024-02-29T00:00:00+08:00'); assert.equal(result.endsAt, '2024-03-01T23:59:59+08:00');
  assert.equal(result.ticketText, approvedFields.costText); assert.equal(result.categoryLabel, '宠友推荐活动');
  assert.equal(result.sources[0].url, approvedFields.sourceUrl); assert.equal(result.officialUrl, approvedFields.sourceUrl);
  assert.equal(result.point, undefined); assert.equal(result.photo, undefined); assert.equal(result.ownerId, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REVIEW_NOTE|request-one|lifecycle|submittedFields|reviewedAt|userId|updatedBy|createdBy/);
  assert.equal(JSON.stringify(result).includes(idFor('alice')), false); assert.equal(JSON.stringify(result).includes(idFor('operator')), false);
  const listed = await f.call('bob', 'listPlaces', { type: 'all', query: result.title });
  assert.equal(listed.items[0].id, approved.publishedId);
  assert.deepEqual((await f.submit()).submission, approved, 'retrying the original request returns its edited terminal result');
  await reject(f.review(submitted.id, { decision: 'rejected', note: '相反决定' }), 'CONFLICT');
  await reject(f.call('alice', 'withdrawNearbySubmission', { id: submitted.id }), 'CONFLICT');
  assert.ok(f.checked.some(check => check.openid === 'operator' && check.body.includes(approvedFields.title) && check.body.includes(approvedFields.petPolicyText)));
});

test('optional sources are not invented and input validation rejects unsafe extras, invalid dates and partial review fields', async t => {
  const f = await fixture(t);
  const submitted = (await f.submit()).submission;
  await reject(f.review(submitted.id, { confirmed: false }), 'INVALID_INPUT');
  await reject(f.review(submitted.id, { fields: { title: '不完整审核表单' } }), 'INVALID_INPUT');
  await reject(f.review(submitted.id, { decision: 'rejected', note: '' }), 'INVALID_INPUT');
  for (const extra of [
    { title: '短' }, { city: '' }, { description: '不足十字' }, { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'https://example.invalid/<script>' },
    { petPolicyStatus: 'allowed', petPolicyText: '' }, { petPolicyStatus: 'invented' }, { point: { latitude: 31, longitude: 121 } }, { photos: ['test.png'] }, { status: 'approved' },
    { type: 'event', startDate: '2025-02-29', endDate: '2025-03-01' }, { type: 'event', startDate: '2026-10-02', endDate: '2026-10-01' }, { type: 'event', startDate: '2026-02-31', endDate: '2026-03-01' }
  ]) await reject(f.submit('alice', extra, 'invalid-request'), 'INVALID_INPUT');
  for (const requestId of ['short', 'x'.repeat(101), 'invalid request']) await reject(f.submit('alice', {}, requestId), 'INVALID_INPUT');
  assert.equal((await f.rows('nearby_submissions')).length, 1); assert.equal((await f.rows('place_records')).length, 0);
  const approved = (await f.review(submitted.id)).submission;
  const record = (await f.call('bob', 'getPlace', { id: approved.publishedId })).place;
  for (const key of ['sources', 'officialUrl', 'photo', 'photos', 'point', 'startsAt', 'endsAt']) assert.equal(record[key], undefined);
  assert.equal(record.ticketText, ''); assert.equal(record.petPolicy.status, 'unknown');
});

test('withdrawal wins safely against delayed approval and rejected or withdrawn records never become public', async t => {
  let release, arrived;
  const entered = new Promise(resolve => { arrived = resolve; });
  const f = await fixture(t, { moderateText: async (body, who) => { if (who === 'operator' && body.includes('DELAY_APPROVAL')) { arrived(); await new Promise(resolve => { release = resolve; }); } } });
  const pending = (await f.submit('alice', { description: 'DELAY_APPROVAL 仅用于审核与撤回并发检查。' })).submission;
  const approval = f.review(pending.id); await entered;
  const withdrawn = await f.call('alice', 'withdrawNearbySubmission', { id: pending.id });
  assert.equal(withdrawn.submission.status, 'withdrawn');
  release(); await reject(approval, 'CONFLICT');
  assert.deepEqual(await f.call('alice', 'withdrawNearbySubmission', { id: pending.id }), withdrawn);
  const second = (await f.submit('alice', {}, 'second-request')).submission;
  const rejected = await f.review(second.id, { decision: 'rejected', note: '缺少可核实的场所资料' });
  assert.equal(rejected.submission.status, 'rejected');
  assert.deepEqual(await f.review(second.id, { decision: 'rejected', note: '重复操作' }), rejected);
  await reject(f.review(second.id), 'CONFLICT');
  assert.equal((await f.rows('place_records')).length, 0);
  assert.equal((await f.call('operator', 'listNearbySubmissions', { mine: false, status: 'pending' })).items.length, 0);
});

test('approval and unpublishing roll back public and private state together when persistence fails', async t => {
  const f = await fixture(t); const row = (await f.submit()).submission;
  const transaction = f.repository.transaction.bind(f.repository); let failedStatus = 'approved';
  f.repository.transaction = operation => transaction(tx => operation({ ...tx, set: async (table, id, value) => {
    if (table === 'nearby_submissions' && value.status === failedStatus) throw new Error('simulated write failure');
    return tx.set(table, id, value);
  } }));
  await assert.rejects(f.review(row.id), /simulated write failure/);
  assert.equal((await f.rows('place_records')).length, 0); assert.equal((await f.rows('nearby_submissions'))[0].status, 'pending');
  failedStatus = ''; const approved = (await f.review(row.id)).submission;
  await reject(f.call('alice', 'unpublishNearbySubmission', { id: row.id, note: '冒充运营下架' }), 'FORBIDDEN');
  failedStatus = 'withdrawn';
  await assert.rejects(f.call('operator', 'unpublishNearbySubmission', { id: row.id, note: '测试下架' }), /simulated write failure/);
  assert.equal((await f.rows('nearby_submissions'))[0].status, 'approved');
  assert.equal((await f.call('bob', 'getPlace', { id: approved.publishedId })).place.active, true);
  failedStatus = '';
  const withdrawn = await f.call('operator', 'unpublishNearbySubmission', { id: row.id, note: 'PRIVATE_UNPUBLISH_NOTE' });
  assert.equal(withdrawn.submission.status, 'withdrawn'); assert.equal(withdrawn.submission.publishedId, approved.publishedId);
  assert.deepEqual(await f.call('operator', 'unpublishNearbySubmission', { id: row.id, note: '重复下架' }), withdrawn);
  assert.equal((await f.call('bob', 'listPlaces', { type: 'all', query: approved.title })).items.length, 0);
  const record = (await f.call('bob', 'getPlace', { id: approved.publishedId })).place;
  assert.equal(record.active, false); assert.equal(JSON.stringify(record).includes('PRIVATE_UNPUBLISH_NOTE'), false);
});

test('approval rechecks author and operator lifecycles after moderation, and account cleanup retains approved directory facts', async t => {
  const waits = []; let signal;
  const entered = () => new Promise(resolve => { signal = resolve; });
  const f = await fixture(t, { moderateText: async (body, who) => { if (who === 'operator' && body.includes('LIFECYCLE_RACE')) { signal(); await new Promise(resolve => waits.push(resolve)); } } });
  const published = (await f.review((await f.submit('alice', { type: 'event', startDate: '2026-10-01', endDate: '2026-10-02' })).submission.id)).submission;
  const pending = (await f.submit('alice', { description: 'LIFECYCLE_RACE 这是一条待审核资料。' }, 'author-race')).submission;
  let started = entered(); const first = f.review(pending.id); await started;
  await f.call('alice', 'deleteAccount'); await f.call('alice', 'bootstrap');
  waits.shift()(); await reject(first, 'NOT_FOUND');
  assert.equal((await f.call('alice', 'listNearbySubmissions')).items.length, 0);
  assert.equal((await f.call('bob', 'getPlace', { id: published.publishedId })).place.active, true);
  assert.equal((await f.rows('nearby_submissions', { userId: idFor('alice') })).length, 0);
  const anonymous = await f.repository.get('nearby_submissions', published.id);
  assert.equal(anonymous.status, 'approved'); assert.equal(anonymous.publishedId, published.publishedId);
  for (const key of ['userId', 'lifecycleId', 'requestId', 'submittedFields', 'reviewNote']) assert.equal(anonymous[key], undefined);
  assert.ok((await f.call('operator', 'listNearbySubmissions', { mine: false })).items.some(item => item.id === published.id));
  const other = (await f.submit('bob', { description: 'LIFECYCLE_RACE 这是另一条待审核资料。' }, 'operator-race')).submission;
  started = entered(); const second = f.review(other.id); await started;
  await f.call('operator', 'deleteAccount'); await f.call('operator', 'bootstrap');
  waits.shift()(); await reject(second, 'ACCOUNT_UNAVAILABLE');
  assert.equal((await f.repository.get('nearby_submissions', other.id)).status, 'pending');
  assert.equal((await f.call('bob', 'getPlace', { id: published.publishedId })).place.active, true);
  assert.equal((await f.repository.get('place_records', published.publishedId)).updatedBy, '');
  const user = await f.repository.get('users', idFor('bob'));
  await f.repository.set('users', idFor('bob'), { ...user, lifecycleId: 'replacement-lifecycle' });
  await reject(f.review(other.id, { fields: fields() }), 'AUTHOR_UNAVAILABLE');
  await f.call('operator', 'unpublishNearbySubmission', { id: published.id, note: '原作者注销后运营仍能下架' });
  assert.equal((await f.call('bob', 'getPlace', { id: published.publishedId })).place.active, false);
});

test('anonymous submission cleanup re-reads concurrent operator withdrawals instead of restoring an approved snapshot', async t => {
  const f = await fixture(t);
  const row = (await f.review((await f.submit('alice', { type: 'event', startDate: '2026-10-01', endDate: '2026-10-02' })).submission.id, { note: '作者注销应清掉此说明' })).submission;
  const find = f.repository.find.bind(f.repository); let interleaved = false;
  f.repository.find = async (table, filters, options) => {
    const snapshot = await find(table, filters, options);
    if (!interleaved && table === 'nearby_submissions' && filters.userId === idFor('alice')) {
      interleaved = true;
      await f.call('operator', 'unpublishNearbySubmission', { id: row.id, note: '并发运营下架，状态不得恢复' });
    }
    return snapshot;
  };
  await f.call('alice', 'deleteAccount');
  assert.equal(interleaved, true);
  const anonymous = await f.repository.get('nearby_submissions', row.id);
  assert.equal(anonymous.status, 'withdrawn'); assert.equal(anonymous.publishedId, row.publishedId);
  assert.equal(anonymous.userId, undefined); assert.equal(anonymous.reviewNote, undefined);
  assert.equal((await f.call('bob', 'getPlace', { id: row.publishedId })).place.active, false);
  assert.equal((await f.call('operator', 'listNearbySubmissions', { mine: false, status: 'withdrawn' })).items[0].id, row.id);
});

test('cloud moderation failures leave submission drafts and approval state unchanged', async t => {
  const f = await fixture(t, { moderateText: async body => { if (body.includes('REJECTED_CONTENT')) throw Object.assign(new Error('content rejected'), { code: 'CONTENT_REJECTED' }); } });
  await reject(f.submit('alice', { description: 'REJECTED_CONTENT 这段投稿未通过内容检查。' }), 'CONTENT_REJECTED');
  assert.equal((await f.rows('nearby_submissions')).length, 0);
  const row = (await f.submit()).submission;
  await reject(f.review(row.id, { fields: fields({ description: 'REJECTED_CONTENT 这段编辑未通过内容检查。' }) }), 'CONTENT_REJECTED');
  assert.equal((await f.rows('nearby_submissions'))[0].status, 'pending'); assert.equal((await f.rows('place_records')).length, 0);
});

test('private submission paging filters before stable timestamp/ID order and schema requirements include the private table', async t => {
  const f = await fixture(t); const expected = [];
  for (let index = 0; index < 27; index += 1) {
    const row = (await f.submit(index % 5 === 0 ? 'bob' : 'alice', { title: '测试投稿' + index }, 'paging-request-' + index)).submission;
    if (index % 5 !== 0) expected.push(row.id);
  }
  let cursor; const seen = [];
  do {
    const page = await f.call('alice', 'listNearbySubmissions', { status: 'pending', limit: 3, cursor });
    seen.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, expected.sort().reverse()); assert.equal(new Set(seen).size, expected.length);
  const admin = await f.call('operator', 'listNearbySubmissions', { mine: false, limit: 50 }); assert.equal(admin.items.length, 27);
  for (const payload of [{ status: 'invalid' }, { mine: 'false' }, { cursor: false }, { cursor: '2' }, { limit: 51 }]) await reject(f.call('alice', 'listNearbySubmissions', payload), 'INVALID_INPUT');
  const schema = require('../infra/database.schema.json'); assert.deepEqual(require('../cloudfunctions/setup/schema.json'), schema);
  assert.ok(COLLECTIONS.includes('nearby_submissions'));
  assert.deepEqual(schema.collections.find(collection => collection.name === 'yb_nearby_submissions').rules, { read: false, write: false });
});
