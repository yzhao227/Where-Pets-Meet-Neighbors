'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('../cloudfunctions/community/storage');
const policy = require('../infra/storage-policy.json');
const prefix = 'cloud://test.bucket/';
const file = name => prefix + 'community/published/' + name;
const signed = name => 'https://media.example.test/' + encodeURIComponent(name) + '?signature=short-lived';
function fixture() {
  const calls = [];
  const cloud = { async getTempFileURL(input) {
    calls.push(input);
    return { fileList: input.fileList.map(({ fileID }) => ({ fileID, status: 0, tempFileURL: signed(fileID) })) };
  } };
  const environment = { CLOUD_FILE_PREFIX: prefix, PUBLISHED_MEDIA_PRIVATE: 'true' };
  return { calls, cloud, environment, storage: createStorage(cloud, environment) };
}

test('post media signing batches and deduplicates approved photos, clips and covers while requesting maxAge 60', async () => {
  const f = fixture();
  const files = [file('image.jpg'), file('clip.mp4'), file('poster.png'), file('image.jpg'), file('cover.webp')];
  const result = await f.storage.resolvePostMedia(files);
  assert.deepEqual(f.calls, [{ fileList: [...new Set(files)].map(fileID => ({ fileID, maxAge: 60 })) }]);
  assert.deepEqual(result, Object.fromEntries(files.map(fileId => [fileId, signed(fileId)])));
  await f.storage.resolvePostMedia(files);
  assert.equal(f.calls.length, 2, 'a prior viewer URL is never cached and returned without a fresh signing operation');
});

test('media resolver cannot sign another environment, pending uploads, quarantine, remote URLs or arbitrary package paths', async () => {
  const f = fixture();
  const bad = ['cloud://other.bucket/community/published/image.jpg', prefix + 'community/incoming/owner/image.jpg',
    prefix + 'community/quarantine/image.jpg', file('../private.jpg'), file('%2e%2e.jpg'), file('image.jpg?download=1'),
    file('image.svg'), 'https://public.example.test/photo.jpg', '/media/clips/123.mp4', '', null, {}];
  for (const value of bad) await assert.rejects(f.storage.resolvePostMedia([file('ok.jpg'), value]), { code: 'MEDIA_UNAVAILABLE' });
  await assert.rejects(f.storage.resolvePostMedia('not-an-array'), { code: 'MEDIA_UNAVAILABLE' });
  await assert.rejects(f.storage.resolvePostMedia(Array(51).fill(file('image.jpg'))), { code: 'MEDIA_UNAVAILABLE' });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await f.storage.resolvePostMedia([]), {});
});

test('missing, ambiguous, rejected or unsafe signing results fail closed without raw-file fallback', async () => {
  const f = fixture(), id = file('photo.jpg');
  const valid = { fileID: id, status: 0, tempFileURL: signed(id) };
  const results = [null, {}, { fileList: [] }, { fileList: [{ ...valid, fileID: file('other.jpg') }] },
    { fileList: [valid, valid] }, { fileList: [{ ...valid, status: -1 }] },
    ...['http://media.example.test/image.jpg', id, '/assets/photo.jpg', 'https://user:secret@media.example.test/x',
      'https://media.example.test/x\n', 'https://media.example.test/has space'].map(tempFileURL => ({ fileList: [{ ...valid, tempFileURL }] }))];
  for (const result of results) {
    f.cloud.getTempFileURL = async () => result;
    await assert.rejects(f.storage.resolvePostMedia([id]), { code: 'MEDIA_UNAVAILABLE' });
  }
  f.cloud.getTempFileURL = async () => { throw Error('provider secret must not escape'); };
  await assert.rejects(f.storage.resolvePostMedia([id]), error => error.code === 'MEDIA_UNAVAILABLE' && !error.message.includes('secret'));
  await assert.rejects(createStorage({}, f.environment).resolvePostMedia([id]), { code: 'MEDIA_UNAVAILABLE' });
  await assert.rejects(createStorage(f.cloud, {}).resolvePostMedia([id]), { code: 'MEDIA_UNAVAILABLE' });
});

test('private attachments require an explicit deployment confirmation as well as a usable signing provider', () => {
  const f = fixture();
  assert.equal(f.storage.privateMediaEnabled, true);
  for (const PUBLISHED_MEDIA_PRIVATE of [undefined, '', 'false', true, 'TRUE']) {
    assert.equal(createStorage(f.cloud, { ...f.environment, PUBLISHED_MEDIA_PRIVATE }).privateMediaEnabled, false);
  }
  assert.equal(createStorage({}, f.environment).privateMediaEnabled, false);
  assert.equal(createStorage(f.cloud, { ...f.environment, CLOUD_FILE_PREFIX: '' }).privateMediaEnabled, false);
});

test('the deployment contract denies direct published reads and requires verification of the provider expiry', () => {
  const published = policy.prefixes.find(rule => rule.path === 'community/published/');
  assert.equal(published.clientRead, false);
  assert.equal(published.clientWrite, false);
  assert.deepEqual(policy.publishedMediaAccess.clientRules, { read: false, write: false });
  assert.equal(policy.publishedMediaAccess.requestedMaxAgeSeconds, 60);
  assert.equal(policy.publishedMediaAccess.temporaryUrlMaxAgeSeconds, undefined);
  assert.match(policy.publishedMediaAccess.providerTTL.verification, /neither that request nor unit tests prove the deployed expiry/);
  assert.ok(policy.requiredChecks.some(check => check.includes('PUBLISHED_MEDIA_PRIVATE=true') && check.includes('getTempFileURL')));
  assert.match(policy.publishedMediaAccess.revocation, /expiry/);
});
