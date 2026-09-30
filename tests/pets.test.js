'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const pets = require('../miniprogram/data/pets');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const { createApi } = require('../miniprogram/services/api');
const { createPetPhotos, KEY: PHOTO_KEY } = require('../miniprogram/services/pet-photos');
const { createService, idFor, TERMS_VERSION, PRIVACY_VERSION } = require('../cloudfunctions/community/service');
const { createSqliteRepository } = require('./helpers/sqlite-repository');
const consent = { accepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };
const NOW = Date.UTC(2026, 8, 30);
const fields = (name = '离线测试猫', type = 'cat') => ({ name, type, breed: '仅测试品种', birthDate: '2024-03-01', ageMonths: null });
const rejects = (promise, code) => assert.rejects(promise, err => err.code === code);
function demo() {
  const values = new Map(), removed = [];
  const platform = { getStorageSync: key => structuredClone(values.get(key) || ''), setStorageSync: (key, value) => values.set(key, structuredClone(value)), removeStorageSync: key => values.delete(key),
    removeSavedFile({ filePath, success }) { removed.push(filePath); if (success) success({}); },
    chooseImage: options => options.success({ tempFilePaths: ['wxfile://selected-pet.jpg'] }), saveFile: options => options.success({ savedFilePath: options.tempFilePath + '-saved' }) };
  const api = createDemoService(platform, { now: () => NOW });
  return { api, platform, values, removed, state: () => platform.getStorageSync(STORAGE_KEY) };
}
async function cloud(t, options = {}) {
  const repo = createSqliteRepository(':memory:'); t.after(() => repo.close());
  let sequence = 0, time = NOW, decision = 'pending', failRemoval = false, rejectText = false, submitHook;
  const removed = [];
  const storage = { enabled: true, mode: 'async', isExpectedFile: (file, path) => file === 'cloud://test/' + path, fileIdForPath: path => 'cloud://test/' + path,
    async submitReview({ ticketId }) { if (submitHook) await submitHook(); return { traceId: 'trace-' + ticketId, quarantineFileId: 'cloud://test/quarantine/' + ticketId, sha256: 'a'.repeat(64), reviewExpiresAt: time + 3600000 }; },
    async getReviewDecision() { return { status: decision }; }, async finalizeReview({ cloudPath }) { return 'cloud://test/' + cloudPath; },
    async remove(files) { if (failRemoval) throw new Error('offline storage unavailable'); removed.push(...files); }, async removeReview() {} };
  const service = createService({ repository: repo, now: () => time, randomId: () => String(++sequence).padStart(24, '0'), storage,
    phoneVerifier: { enabled: true, async verifyCode(code) { return { phoneKey: 'ph_' + crypto.createHash('sha256').update(code).digest('hex'), maskedPhone: '138****1234' }; } },
    runtimeConfig: { name: '离线测试运营者', contact: 'test@example.invalid', retention: '这些仅用于离线自动测试的资料会在测试结束后清除。', policyApproved: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION },
    async moderateText() { if (rejectText) throw Object.assign(new Error('仅测试审核拒绝'), { code: 'CONTENT_REJECTED' }); }, ...options });
  const call = (who, action, payload = {}) => service.handle(action, payload, { openid: who });
  for (const who of ['alice', 'bob']) { await call(who, 'bootstrap'); await call(who, 'verifyPhone', { code: who, consent }); }
  return { repo, service, call, removed, advance: n => { time += n; }, decide: value => { decision = value; }, failRemoval: value => { failRemoval = value; }, rejectText: value => { rejectText = value; }, holdSubmit: fn => { submitHook = fn; } };
}

test('pet field contract is identical in both deployments and legacy reads do not mutate user data', () => {
  assert.equal(fs.readFileSync(require.resolve('../miniprogram/data/pets'), 'utf8'), fs.readFileSync(require.resolve('../cloudfunctions/community/pets'), 'utf8'));
  const user = { pet: { name: '原有名字', type: 'other' } }, before = structuredClone(user);
  assert.equal(pets.list(user)[0].id, 'legacy'); assert.deepEqual(user, before);
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  for (const birthDate of ['2026-02-30', '2027-01-01', 'not-a-date']) assert.throws(() => pets.validate({ ...fields(), birthDate }, NOW, fail), { code: 'INVALID_INPUT' });
  assert.throws(() => pets.validate({ ...fields(), ageMonths: 3 }, NOW, fail), { code: 'INVALID_INPUT' });
  assert.throws(() => pets.validate({ ...fields(), photo: 'https://arbitrary.invalid/a.jpg' }, NOW, fail), { code: 'INVALID_INPUT' });
  assert.equal(pets.ageLabel({ birthDate: '2024-03-01' }, NOW), '2 岁 6 个月');
  const shanghaiMidnight = Date.parse('2026-09-30T16:30:00Z');
  assert.equal(pets.today(shanghaiMidnight), '2026-10-01');
  assert.equal(pets.validate({ ...fields(), birthDate: '2026-10-01' }, shanghaiMidnight, fail).birthDate, '2026-10-01');
  assert.throws(() => pets.validate({ ...fields(), birthDate: '2026-10-02' }, shanghaiMidnight, fail), { code: 'INVALID_INPUT' });
  assert.equal(pets.ageLabel({ birthDate: '2024-10-01' }, shanghaiMidnight), '2 岁');
});

test('demo preserves multiple pets, legacy primary projection and independent public consent', async () => {
  const f = demo(); await f.api.call('bootstrap');
  const first = (await f.api.call('savePet', fields())).pets[0];
  const second = (await f.api.call('savePet', { ...fields('离线测试鸟', 'bird'), birthDate: '', ageMonths: 8 })).pets[1];
  assert.deepEqual((await f.api.call('bootstrap')).user.pet, { name: first.name, type: 'cat' });
  await f.api.call('updateProfile', { nickname: '只改昵称' });
  assert.equal((await f.api.call('listPets')).pets.length, 2);
  const state = f.state(), owner = state.currentUserId;
  state.users.push({ ...state.users.find(user => user.id === owner), id: 'other-owner', pet: null, pets: [] }); state.currentUserId = 'other-owner'; f.platform.setStorageSync(STORAGE_KEY, state);
  let view = (await f.api.call('getUserProfile', { userId: owner })).user;
  assert.equal(view.pet, null); assert.deepEqual(view.pets, []);
  await rejects(f.api.call('savePet', { id: first.id, ...fields('非法修改') }), 'NOT_FOUND');
  const changeOwner = value => { const next = f.state(); next.currentUserId = value; f.platform.setStorageSync(STORAGE_KEY, next); };
  changeOwner(owner); await f.api.call('updateProfile', { showPet: true }); changeOwner('other-owner');
  view = (await f.api.call('getUserProfile', { userId: owner })).user;
  assert.deepEqual(view.pet, { name: first.name, type: first.type }); assert.deepEqual(view.pets, []);
  changeOwner(owner); await f.api.call('updateProfile', { publicProfile: true }); changeOwner('other-owner');
  view = (await f.api.call('getUserProfile', { userId: owner })).user;
  assert.equal(view.pets.length, 2); assert.equal(view.pets[1].type, 'bird'); assert.equal('birthDate' in view.pets[0], false); assert.equal('photoTicketId' in view.pets[0], false);
  changeOwner(owner); await f.api.call('deletePet', { petId: first.id });
  assert.deepEqual((await f.api.call('bootstrap')).user.pet, { name: second.name, type: second.type });
});

test('demo pet photos require owned completed dedicated tickets and retain old photo after a failed replacement', async () => {
  const f = demo(); await f.api.call('bootstrap'); const pet = (await f.api.call('savePet', fields())).pets[0];
  await rejects(f.api.call('createPetUploadTicket', { petId: pet.id, extension: 'jpg' }), 'VERIFICATION_REQUIRED');
  await f.api.call('demoVerifyIdentity', { consent });
  const post = await f.api.call('createUploadTicket', { extension: 'jpg' }); await f.api.call('completeUpload', { ticketId: post.ticketId, fileId: 'wxfile://post-photo.jpg' });
  await rejects(f.api.call('setPetPhoto', { petId: pet.id, ticketId: post.ticketId }), 'FORBIDDEN');
  const ticket = await f.api.call('createPetUploadTicket', { petId: pet.id, extension: 'jpg' });
  await rejects(f.api.call('setPetPhoto', { petId: pet.id, ticketId: ticket.ticketId }), 'FORBIDDEN');
  await f.api.call('completeUpload', { ticketId: ticket.ticketId, fileId: 'wxfile://pet-a.jpg' });
  await f.api.call('setPetPhoto', { petId: pet.id, ticketId: ticket.ticketId });
  const pending = await f.api.call('createPetUploadTicket', { petId: pet.id, extension: 'jpg' });
  await rejects(f.api.call('setPetPhoto', { petId: pet.id, ticketId: pending.ticketId }), 'FORBIDDEN');
  assert.equal((await f.api.call('listPets')).pets[0].photo, 'wxfile://pet-a.jpg'); assert.equal(f.removed.includes('wxfile://pet-a.jpg'), false);
  await f.api.call('setPetPhoto', { petId: pet.id, ticketId: '' });
  assert.ok(f.removed.includes('wxfile://pet-a.jpg'));
  await rejects(f.api.call('completeUpload', { ticketId: ticket.ticketId, fileId: 'wxfile://pet-a.jpg' }), 'UPLOAD_UNAVAILABLE');
  assert.equal((await f.api.call('listPets')).pets[0].photo, '');
});

test('cloud pet photos stay private and cannot be attached before review or moved between pets or owners', async t => {
  const f = await cloud(t), pet = (await f.call('alice', 'savePet', fields())).pets[0];
  const other = (await f.call('alice', 'savePet', fields('第二只', 'rabbit'))).pets[1];
  const ticket = await f.call('alice', 'createPetUploadTicket', { petId: pet.id, extension: 'jpg' });
  await rejects(f.call('bob', 'createPetUploadTicket', { petId: pet.id, extension: 'jpg' }), 'NOT_FOUND');
  await rejects(f.call('alice', 'setPetPhoto', { petId: pet.id, ticketId: ticket.ticketId }), 'FORBIDDEN');
  assert.equal((await f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: 'cloud://test/' + ticket.cloudPath })).status, 'pending');
  await rejects(f.call('alice', 'setPetPhoto', { petId: pet.id, ticketId: ticket.ticketId }), 'FORBIDDEN');
  f.decide('pass'); const approved = await f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId });
  await rejects(f.call('alice', 'setPetPhoto', { petId: other.id, ticketId: ticket.ticketId }), 'FORBIDDEN');
  await f.call('alice', 'setPetPhoto', { petId: pet.id, ticketId: ticket.ticketId });
  await f.call('alice', 'updateProfile', { showPet: true });
  let view = (await f.call('bob', 'getUserProfile', { userId: idFor('alice') })).user;
  assert.deepEqual(view.pets, []); assert.equal('photo' in view.pet, false);
  await f.call('alice', 'updateProfile', { publicProfile: true });
  view = (await f.call('bob', 'getUserProfile', { userId: idFor('alice') })).user;
  assert.equal(view.pets[0].photo, approved.fileId); assert.equal(view.pets[0].ageLabel, '2 岁 6 个月'); assert.equal('birthDate' in view.pets[0], false);
  f.advance(2 * 86400000); await f.service.runMaintenance({ limit: 50 });
  assert.ok(await f.repo.get('uploads', ticket.ticketId)); assert.equal(f.removed.includes(approved.fileId), false);
  f.rejectText(true); await rejects(f.call('alice', 'savePet', { id: pet.id, ...fields('未通过审核') }), 'CONTENT_REJECTED');
  assert.equal((await f.call('alice', 'listPets')).pets[0].name, pet.name);
});

test('cloud replacement commits the new photo before cleanup and account deletion clears retained photo bytes', async t => {
  const f = await cloud(t), pet = (await f.call('alice', 'savePet', fields())).pets[0];
  async function upload() { const ticket = await f.call('alice', 'createPetUploadTicket', { petId: pet.id, extension: 'jpg' }); await f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: 'cloud://test/' + ticket.cloudPath }); f.decide('pass'); const result = await f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId }); return { ...ticket, ...result }; }
  const first = await upload(); await f.call('alice', 'setPetPhoto', { petId: pet.id, ticketId: first.ticketId });
  const next = await upload(); f.failRemoval(true);
  const changed = await f.call('alice', 'setPetPhoto', { petId: pet.id, ticketId: next.ticketId });
  assert.equal(changed.pets[0].photo, next.fileId); assert.equal(changed.cleanupPending, true); assert.equal((await f.repo.get('uploads', first.ticketId)).status, 'cleanup');
  await rejects(f.call('alice', 'setPetPhoto', { petId: pet.id, ticketId: first.ticketId }), 'FORBIDDEN');
  f.failRemoval(false); await f.service.runMaintenance({ limit: 50 });
  assert.ok(f.removed.includes(first.fileId)); assert.equal(f.removed.includes(next.fileId), false);
  await f.call('alice', 'deleteAccount');
  assert.ok(f.removed.includes(next.fileId)); assert.equal((await f.repo.get('users', idFor('alice'))).pets, undefined);
  assert.equal((await f.repo.find('uploads', { ownerId: idFor('alice') }, { limit: 100 })).length, 0);
});

test('deleting a pet during a quarantine write retains the ticket until the writer settles and cleanup can retry', async t => {
  const f = await cloud(t), pet = (await f.call('alice', 'savePet', fields())).pets[0];
  const ticket = await f.call('alice', 'createPetUploadTicket', { petId: pet.id, extension: 'jpg' });
  let started, release;
  const ready = new Promise(resolve => { started = resolve; }), wait = new Promise(resolve => { release = resolve; });
  f.holdSubmit(async () => { started(); await wait; });
  const completing = f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: 'cloud://test/' + ticket.cloudPath });
  await ready;
  const removed = await f.call('alice', 'deletePet', { petId: pet.id });
  assert.equal(removed.cleanupPending, true); assert.deepEqual(removed.pets, []);
  await f.service.runMaintenance({ limit: 50 });
  assert.equal((await f.repo.get('uploads', ticket.ticketId)).petRetired, true);
  release(); await completing;
  await f.service.runMaintenance({ limit: 50 });
  assert.equal(await f.repo.get('uploads', ticket.ticketId), null);
  assert.ok(f.removed.includes('cloud://test/quarantine/' + ticket.ticketId));
});

test('pet photo retry owns a separate durable queue and never consumes a post draft or its attachments', async () => {
  const f = demo(), api = createApi(f.platform, { mode: 'demo' }, { now: () => NOW });
  await api.call('bootstrap'); await api.call('demoVerifyIdentity', { consent });
  const pet = (await api.call('savePet', fields())).pets[0];
  const postDraft = { 'demo:demo-self': { version: 1, text: '尚未发布的私人草稿' } }, postQueue = { version: 1, items: [{ ownerId: 'demo-self', localPath: 'wxfile://post-draft.jpg', status: 'retry' }] };
  f.platform.setStorageSync('youchong.privateDrafts.v1', postDraft); f.platform.setStorageSync('youchong.uploadQueue.v1', postQueue);
  let failOnce = true;
  const isolated = { async call(action, payload) { if (action === 'completeUpload' && failOnce) { failOnce = false; throw Object.assign(new Error('离线测试网络失败'), { code: 'NETWORK_ERROR' }); } return api.call(action, payload); } };
  const client = createPetPhotos(f.platform, isolated, { mode: 'demo' });
  await rejects(client.select(pet.id), 'NETWORK_ERROR');
  assert.equal((await client.pending())[0].status, 'retry');
  assert.deepEqual(f.platform.getStorageSync('youchong.privateDrafts.v1'), postDraft); assert.deepEqual(f.platform.getStorageSync('youchong.uploadQueue.v1'), postQueue);
  const resumed = createPetPhotos(f.platform, api, { mode: 'demo' }); await resumed.retry(pet.id);
  assert.equal((await api.call('listPets')).pets[0].photo, 'wxfile://selected-pet.jpg-saved');
  assert.equal((await resumed.pending()).length, 0); assert.equal(f.removed.includes('wxfile://post-draft.jpg'), false);
  await api.call('deleteAccount'); assert.equal(f.platform.getStorageSync(PHOTO_KEY), '');
});
