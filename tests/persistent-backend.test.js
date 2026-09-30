'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createService, idFor } = require('../cloudfunctions/community/service');
const { createSqliteRepository } = require('./helpers/sqlite-repository');

const runtimeConfig = { name: '有宠本地联调团队', contact: 'integration@example.invalid', retention: '此内容仅用于自动测试，测试结束后清理所有临时资料。', policyApproved: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' };
const consent = { accepted: true, termsVersion: runtimeConfig.termsVersion, privacyVersion: runtimeConfig.privacyVersion };
function serviceFor(repository) {
  return createService({ repository, runtimeConfig, adminOpenids: ['local-operator'],
    phoneVerifier: { enabled: true, async verifyCode(code) {
      assert.ok(code.startsWith('test-proof:'), 'tests require an injected trusted verification adapter');
      return { phoneKey: 'ph_' + crypto.createHash('sha256').update(code).digest('hex'), maskedPhone: '+86 138****0000' };
    } }
  });
}

test('the same cloud business service supports independent accounts and survives a real SQLite database restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youchong-persistence-'));
  const filename = path.join(directory, 'community.sqlite');
  let repository = createSqliteRepository(filename);
  let service = serviceFor(repository);
  const call = (openid, action, payload = {}) => service.handle(action, payload, { openid });
  try {
    await call('local-operator', 'initialize', { city: '联调城市', areas: ['联调公园'], contact: 'integration@example.invalid' });
    for (const user of ['local-operator', 'alice', 'bob', 'carol']) await call(user, 'verifyPhone', { code: 'test-proof:' + user, consent });
    await call('alice', 'updateProfile', { nickname: '爱猫的同好', pet: { name: '糯米', type: 'cat' }, showPet: true, publicProfile: false });
    await call('alice', 'joinCircle', { id: 'neighbors', join: true });
    const { post } = await call('alice', 'createPost', { circleId: 'neighbors', text: '持久化联调中的一条宠物日常', images: [] });
    assert.ok((await call('bob', 'listPosts')).items.some(item => item.id === post.id));
    await call('bob', 'addComment', { targetType: 'post', targetId: post.id, text: '另一账号可以真实读取这条记录并回应。' });
    await call('bob', 'likePost', { id: post.id, like: true });
    const { event } = await call('local-operator', 'createEvent', { title: '联调活动', description: '仅用于自动测试', location: '联调公园', startAt: Date.now() + 3600000, endAt: Date.now() + 7200000, capacity: 2, petPolicy: 'optional', circleId: 'neighbors' });
    await call('alice', 'joinEvent', { id: event.id, join: true });
    const race = await Promise.allSettled(['bob', 'carol'].map(user => call(user, 'joinEvent', { id: event.id, join: true })));
    assert.equal(race.filter(item => item.status === 'fulfilled').length, 1);
    await repository.close();
    assert.ok(fs.statSync(filename).size > 0);
    repository = createSqliteRepository(filename);
    service = serviceFor(repository);
    const loaded = await call('bob', 'getPost', { id: post.id });
    assert.equal(loaded.post.likeCount, 1);
    assert.equal(loaded.comments.length, 1);
    assert.equal(loaded.post.author.pet.name, '糯米');
    assert.equal(JSON.stringify(loaded).includes('maskedPhone'), false);
    assert.equal((await call('alice', 'listMessages')).items.some(item => item.targetId === post.id), true);
    assert.equal((await call('alice', 'getEvent', { id: event.id })).event.attendeeCount, 2);
    assert.equal((await call('local-operator', 'getPetStats')).profilesWithPet, 1);
    await call('alice', 'deleteAccount');
    assert.equal((await repository.get('users', idFor('alice'))).status, 'deleted');
    assert.equal(await repository.get('identities', idFor('alice')), null);
    assert.equal((await call('bob', 'listPosts')).items.some(item => item.id === post.id), false);
  } finally { await repository.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('failed persistent transactions neither leak partial writes to readers nor survive reopening', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youchong-rollback-'));
  const filename = path.join(directory, 'community.sqlite');
  let repository = createSqliteRepository(filename);
  try {
    await assert.rejects(repository.transaction(async tx => {
      await tx.set('users', 'uncommitted', { nickname: 'should not be stored' });
      assert.equal(await repository.get('users', 'uncommitted'), null);
      throw new Error('abort');
    }), /abort/);
    await repository.close(); repository = createSqliteRepository(filename);
    assert.equal(await repository.get('users', 'uncommitted'), null);
  } finally { await repository.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
