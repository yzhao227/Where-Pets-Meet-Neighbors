'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createStorage } = require('../cloudfunctions/community/storage');
const { createMediaReviewStore } = require('../cloudfunctions/community/media-review');
const { createMediaCallback } = require('../cloudfunctions/community/media-callback');
const { callbackEnvironment, memoryRepository, callbackEvent } = require('./helpers/media-fixtures');

const prefix = 'cloud://test.bucket/';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const receipt = (traceId, decision = 'pass') => ({ traceId, decision, callbackDigest: digest(Buffer.from(decision)), errorCode: 0 });

function fixture(options = {}) {
  const repository = memoryRepository(); const files = new Map(); const calls = []; let time = 1800000000000;
  const source = prefix + 'community/incoming/u/ticket-1.png'; files.set(source, Buffer.from(png));
  const cloud = {
    async downloadFile({ fileID }) { if (!files.has(fileID)) throw new Error('file not found'); return { fileContent: Buffer.from(files.get(fileID)) }; },
    async uploadFile({ cloudPath, fileContent }) { files.set(prefix + cloudPath, Buffer.from(fileContent)); calls.push(['write', cloudPath]); return { fileID: prefix + cloudPath }; },
    async deleteFile({ fileList }) { fileList.forEach(id => files.delete(id)); return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) }; },
    async getTempFileURL({ fileList }) { return { fileList: fileList.map(fileID => ({ fileID, status: 0, tempFileURL: 'https://media.example.test/signed-snapshot' })) }; },
    openapi: { security: {
      async imgSecCheck() { return { errCode: 0 }; },
      async mediaCheckAsync(input) { calls.push(['review', input]); if (options.beforeResponse) await options.beforeResponse(storage); return { errCode: 0, traceId: 'trace-test-1' }; }
    } }
  };
  const environment = { ...callbackEnvironment, CLOUD_FILE_PREFIX: prefix, UPLOADS_ENABLED: 'true', MEDIA_REVIEW_MODE: 'async', MEDIA_QUARANTINE_LOCK_CONFIRMED: 'true', ...options.environment };
  const storage = createStorage(cloud, environment, { repository, now: () => time });
  return { repository, files, calls, cloud, environment, storage, source, advance: ms => { time += ms; },
    submit: async () => {
      await repository.set('uploads', 'ticket-1', { ownerId: 'user-1', sourceFileId: source, status: 'processing', phase: 'submitting', operationToken: 'op-1', leaseUntil: time + 120000 });
      return storage.submitReview({ fileId: source, extension: 'png', openid: 'trusted-openid', ticketId: 'ticket-1', ownerId: 'user-1', operationToken: 'op-1' });
    } };
}

test('uploads default to disabled and async mode requires callback secrets and immutable quarantine confirmation', () => {
  const f = fixture();
  assert.equal(f.storage.enabled, true);
  for (const override of [{ MEDIA_REVIEW_MODE: undefined }, { MEDIA_REVIEW_MODE: 'disabled' }, { MEDIA_CALLBACK_TOKEN: '' },
    { MEDIA_CALLBACK_ENCODING_AES_KEY: '' }, { MEDIA_CALLBACK_APP_ID: '' }, { MEDIA_QUARANTINE_LOCK_CONFIRMED: 'false' }]) {
    assert.equal(createStorage(f.cloud, { ...f.environment, ...override }, { repository: f.repository }).enabled, false);
  }
  assert.equal(createStorage(f.cloud, f.environment).enabled, false);
  assert.equal(createStorage({ ...f.cloud, openapi: {} }, f.environment, { repository: f.repository }).enabled, false);
});

test('explicit sync mode retains byte scanning and publishes only a successful review', async () => {
  const f = fixture({ environment: { MEDIA_REVIEW_MODE: 'sync' } });
  const output = await f.storage.verifyAndPublish({ fileId: f.source, extension: 'png', cloudPath: 'community/published/sync.png' });
  assert.equal(output, prefix + 'community/published/sync.png');
  assert.deepEqual(f.files.get(output), png);
  f.cloud.openapi.security.imgSecCheck = async () => ({ errCode: 87014 });
  await assert.rejects(f.storage.verifyAndPublish({ fileId: f.source, extension: 'png', cloudPath: 'community/published/reject.png' }), { code: 'CONTENT_REJECTED' });
  assert.equal(f.files.has(prefix + 'community/published/reject.png'), false);
});

test('async review scans an immutable snapshot and cannot publish replacement incoming bytes', async () => {
  const f = fixture(); const submitted = await f.submit();
  assert.match(submitted.quarantineFileId, /^cloud:\/\/test.bucket\/community\/quarantine\/[a-f0-9]{48}\.png$/);
  assert.equal(submitted.sha256, digest(png));
  assert.deepEqual(f.calls.find(call => call[0] === 'review')[1], { mediaUrl: 'https://media.example.test/signed-snapshot', mediaType: 2, version: 2, scene: 2, openid: 'trusted-openid' });
  assert.equal((await f.storage.getReviewDecision({ ...submitted, ticketId: 'ticket-1', ownerId: 'user-1' })).status, 'pending');
  f.files.set(f.source, Buffer.concat([png, Buffer.from('different incoming content')]));
  await f.storage.acceptReviewResult(receipt(submitted.traceId));
  assert.equal((await f.storage.getReviewDecision({ ...submitted, ticketId: 'ticket-1', ownerId: 'user-1' })).status, 'pass');
  const published = await f.storage.finalizeReview({ ...submitted, cloudPath: 'community/published/approved.png' });
  assert.deepEqual(f.files.get(published), png);
});

test('a signed callback arriving before trace binding is retained but publishes nothing on its own', async () => {
  const f = fixture({ beforeResponse: async storage => {
    const callback = createMediaCallback({ environment: callbackEnvironment, onReview: result => storage.acceptReviewResult(result) });
    assert.equal((await callback.handle(callbackEvent())).statusCode, 200);
  } });
  const submitted = await f.submit();
  assert.equal((await f.storage.getReviewDecision({ ...submitted, ticketId: 'ticket-1', ownerId: 'user-1' })).status, 'pass');
  assert.equal([...f.files.keys()].some(id => id.includes('/published/')), false);
});

test('ticket and owner mismatches cannot read decisions or remove another upload review', async () => {
  const f = fixture(); const submitted = await f.submit(); await f.storage.acceptReviewResult(receipt(submitted.traceId));
  await assert.rejects(f.storage.getReviewDecision({ ...submitted, ticketId: 'ticket-other', ownerId: 'user-1' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.storage.getReviewDecision({ ...submitted, ticketId: 'ticket-1', ownerId: 'user-other' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.storage.removeReview({ traceId: submitted.traceId, ticketId: 'ticket-other' }), { code: 'FORBIDDEN' });
  assert.equal((await f.storage.getReviewDecision({ ...submitted, ticketId: 'ticket-1', ownerId: 'user-1' })).status, 'pass');
});

test('duplicate receipts are idempotent and conflicting receipts stay rejected', async () => {
  const f = fixture(); const submitted = await f.submit();
  await Promise.all([f.storage.acceptReviewResult(receipt(submitted.traceId)), f.storage.acceptReviewResult(receipt(submitted.traceId))]);
  assert.equal((await f.storage.getReviewDecision({ ...submitted, ticketId: 'ticket-1' })).status, 'pass');
  await f.storage.acceptReviewResult(receipt(submitted.traceId, 'reject'));
  await f.storage.acceptReviewResult(receipt(submitted.traceId, 'pass'));
  assert.equal((await f.storage.getReviewDecision({ ...submitted, ticketId: 'ticket-1' })).status, 'reject');
});

test('expired review receipts and missing expired records cannot be used to publish', async () => {
  const f = fixture(); const submitted = await f.submit(); f.advance(31 * 60000);
  await f.storage.acceptReviewResult(receipt(submitted.traceId));
  assert.equal((await f.storage.getReviewDecision({ ...submitted, ticketId: 'ticket-1' })).status, 'expired');
  assert.equal((await f.storage.getReviewDecision({ traceId: 'missing-trace', ticketId: 'ticket-2', reviewExpiresAt: 1 })).status, 'expired');
});

test('the same trace cannot be rebound to a different ticket or snapshot', async () => {
  const f = fixture(); const submitted = await f.submit();
  const store = createMediaReviewStore(f.repository);
  await assert.rejects(store.bind({ ...submitted, ticketId: 'ticket-other', ownerId: 'user-1' }), { code: 'MEDIA_TRACE_CONFLICT' });
  await assert.rejects(store.bind({ ...submitted, ticketId: 'ticket-1', ownerId: 'user-1', sha256: 'f'.repeat(64) }), { code: 'MEDIA_TRACE_CONFLICT' });
});

test('a changed quarantine image fails its digest check and creates no published file', async () => {
  const f = fixture(); const submitted = await f.submit(); await f.storage.acceptReviewResult(receipt(submitted.traceId));
  f.files.set(submitted.quarantineFileId, Buffer.concat([png, Buffer.from('unexpected mutation')]));
  await assert.rejects(f.storage.finalizeReview({ ...submitted, cloudPath: 'community/published/changed.png' }), { code: 'MEDIA_CONTENT_CHANGED' });
  assert.equal(f.files.has(prefix + 'community/published/changed.png'), false);
});

test('failed submission and invalid temporary URLs do not leave an untracked quarantine image', async () => {
  for (const mode of ['api', 'url']) {
    const f = fixture();
    if (mode === 'api') f.cloud.openapi.security.mediaCheckAsync = async () => { throw new Error('account capability unavailable'); };
    else f.cloud.getTempFileURL = async () => ({ fileList: [{ fileID: 'wrong-file', status: 0, tempFileURL: 'https://media.example.test/wrong' }] });
    await assert.rejects(f.submit(), { code: 'CONTENT_CHECK_UNAVAILABLE' });
    assert.deepEqual([...f.files.keys()], [f.source]);
  }
});

test('submission and deletion failures leave a durable ticket path for maintenance to reclaim', async () => {
  const f = fixture();
  f.cloud.openapi.security.mediaCheckAsync = async () => { throw new Error('review submission timed out'); };
  f.cloud.deleteFile = async () => { throw new Error('storage deletion unavailable'); };
  await assert.rejects(f.submit(), { code: 'CONTENT_CHECK_UNAVAILABLE' });
  const ticket = await f.repository.get('uploads', 'ticket-1');
  assert.match(ticket.quarantineFileId, /\/community\/quarantine\//);
  assert.equal(f.files.has(ticket.quarantineFileId), true);
  assert.equal(ticket.sha256, digest(png));
});

test('quarantine ownership is durable before file creation and a stale operation creates no snapshot', async () => {
  const f = fixture(); const originalUpload = f.cloud.uploadFile;
  f.cloud.uploadFile = async input => {
    const ticket = await f.repository.get('uploads', 'ticket-1');
    assert.equal(ticket.quarantineFileId, prefix + input.cloudPath);
    return originalUpload(input);
  };
  await f.submit();
  const ticket = await f.repository.get('uploads', 'ticket-1');
  await f.repository.set('uploads', 'ticket-1', { ...ticket, status: 'cleanup' });
  const before = f.files.size;
  await assert.rejects(f.storage.submitReview({ fileId: f.source, extension: 'png', openid: 'trusted-openid', ticketId: 'ticket-1', ownerId: 'user-1', operationToken: 'op-1' }), { code: 'UPLOAD_EXPIRED' });
  assert.equal(f.files.size, before);
});

test('bound review cleanup is idempotent and leaves other reviews intact', async () => {
  const f = fixture(); const submitted = await f.submit();
  assert.deepEqual(await f.storage.removeReview({ traceId: submitted.traceId, ticketId: 'ticket-1' }), { removed: true });
  assert.deepEqual(await f.storage.removeReview({ traceId: submitted.traceId, ticketId: 'ticket-1' }), { removed: false });
  assert.equal(await f.repository.get('media_reviews', submitted.traceId), null);
});
