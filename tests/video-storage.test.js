'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStorage, inspectVideo } = require('../cloudfunctions/community/storage');

const original = fs.readFileSync(path.join(__dirname, 'fixtures/video-one-second.mp4'));
const prefix = 'cloud://test.bucket/';
function fixture(overrides = {}) {
  const writes = [], scans = [], files = new Map([['incoming', Buffer.from(original)]]);
  let imageScans = 0;
  const cloud = {
    async downloadFile({ fileID }) { return { fileContent: Buffer.from(files.get(fileID)) }; },
    async uploadFile({ cloudPath, fileContent }) { writes.push(cloudPath); files.set(prefix + cloudPath, Buffer.from(fileContent)); return { fileID: prefix + cloudPath }; },
    async deleteFile() { return { fileList: [] }; },
    openapi: { security: { async imgSecCheck() { imageScans += 1; return { errCode: 0 }; } } }
  };
  const provider = { supportsFullVideo: true, supportsAudio: true, async review(input) { scans.push(input); return { decision: 'pass', sha256: input.sha256 }; } };
  const environment = { CLOUD_FILE_PREFIX: prefix, UPLOADS_ENABLED: 'true', MEDIA_REVIEW_MODE: 'sync', VIDEO_UPLOADS_ENABLED: 'true', VIDEO_REVIEW_MODE: 'provider' };
  const storage = createStorage(cloud, { ...environment, ...overrides.environment }, { videoReviewProvider: overrides.provider === undefined ? provider : overrides.provider });
  const publish = () => storage.verifyAndPublish({ fileId: 'incoming', cloudPath: 'community/published/video.mp4', extension: 'mp4', mediaType: 'video', openid: 'trusted-openid' });
  return { storage, files, writes, scans, provider, cloud, environment, publish, imageScans: () => imageScans };
}

test('MP4 inspection reads real video tracks, dimensions and presentation duration from bytes', () => {
  assert.deepEqual(inspectVideo(original), { contentType: 'video/mp4', bytes: original.length, durationSeconds: 1, width: 64, height: 48 });
  assert.throws(() => inspectVideo(original, 'png'), { code: 'INVALID_VIDEO' });
  assert.throws(() => inspectVideo(Buffer.from('not a video but renamed .mp4')), { code: 'INVALID_VIDEO' });
  assert.throws(() => inspectVideo(original.subarray(0, 64)), { code: 'INVALID_VIDEO' });
  const audioOnly = Buffer.from(original); const videoHandler = audioOnly.indexOf(Buffer.from('vide'));
  audioOnly.write('soun', videoHandler, 'ascii');
  assert.throws(() => inspectVideo(audioOnly), { code: 'INVALID_VIDEO' });
});

test('MP4 inspection rejects oversized files and hidden long sample timing despite short movie metadata', () => {
  assert.throws(() => inspectVideo(Buffer.alloc(20 * 1024 * 1024 + 1)), { code: 'VIDEO_TOO_LARGE' });
  const forged = Buffer.from(original); const stts = forged.indexOf(Buffer.from('stts'));
  forged.writeUInt32BE(1000000, stts + 16);
  assert.throws(() => inspectVideo(forged), { code: 'VIDEO_TOO_LONG' });
  const invalidChunk = Buffer.from(original); const stco = invalidChunk.indexOf(Buffer.from('stco'));
  invalidChunk.writeUInt32BE(4, stco + 12);
  assert.throws(() => inspectVideo(invalidChunk), { code: 'INVALID_VIDEO' });
});

test('image review capability never enables video without a full video/audio provider', async () => {
  for (const changes of [{ provider: null }, { environment: { VIDEO_UPLOADS_ENABLED: 'false' } }, { environment: { VIDEO_REVIEW_MODE: 'sync' } },
    { provider: { supportsFullVideo: true, supportsAudio: false, review: async () => ({ decision: 'pass' }) } }]) {
    const f = fixture(changes); assert.equal(f.storage.enabled, true); assert.equal(f.storage.videoEnabled, false);
    await assert.rejects(f.publish(), { code: 'VIDEO_UNAVAILABLE' });
    assert.equal(f.writes.length, 0); assert.equal(f.imageScans(), 0);
  }
});

test('video publication uses the complete reviewed bytes and authoritative inspected metadata', async () => {
  const f = fixture();
  f.provider.review = async input => { f.scans.push(input); f.files.set('incoming', Buffer.from('replaced')); return { decision: 'pass', sha256: input.sha256 }; };
  const result = await f.publish();
  assert.deepEqual(result, { fileId: prefix + 'community/published/video.mp4', durationSeconds: 1, width: 64, height: 48, bytes: original.length });
  assert.deepEqual(f.scans[0].bytes, original);
  assert.equal(f.scans[0].openid, 'trusted-openid');
  assert.deepEqual(f.files.get(result.fileId), original);
  assert.equal(f.imageScans(), 0);
});

test('ambiguous, failed, rejected or mismatched video review never writes a public file', async () => {
  for (const [decision, code] of [[{ decision: 'reject' }, 'CONTENT_REJECTED'], [{ decision: 'pending' }, 'CONTENT_CHECK_UNAVAILABLE'],
    [{ decision: 'pass', sha256: '0'.repeat(64) }, 'CONTENT_CHECK_UNAVAILABLE'], [null, 'CONTENT_CHECK_UNAVAILABLE']]) {
    const f = fixture(); f.provider.review = async () => decision;
    await assert.rejects(f.publish(), { code }); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.provider.review = async () => { throw new Error('provider offline'); };
  await assert.rejects(f.publish(), { code: 'CONTENT_CHECK_UNAVAILABLE' }); assert.equal(f.writes.length, 0);
});

test('invalid video bytes are rejected before invoking any content provider', async () => {
  const f = fixture(); f.files.set('incoming', Buffer.alloc(300));
  await assert.rejects(f.publish(), { code: 'INVALID_VIDEO' });
  assert.equal(f.scans.length, 0); assert.equal(f.writes.length, 0);
});
