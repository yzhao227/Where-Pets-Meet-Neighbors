'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../miniprogram/services/api');

const queueKey = 'youchong.uploadQueue.v1';
const draftKey = 'youchong.privateDrafts.v1';
const approved = ticketId => 'cloud://test.bucket/community/published/' + ticketId + '.png';
const pending = ticketId => 'cloud://test.bucket/community/incoming/user/' + ticketId + '.png';

function fixture() {
  const data = new Map(); const saved = new Set(); const removed = []; const calls = []; const uploads = [];
  const state = { userId: 'user-1', verified: true, serial: 0, selection: [{ tempFilePath: '/tmp/cat.png', size: 200 }], statuses: new Map(),
    failWrites: false, failRemoves: false, completeHook: null, statusHook: null, postHook: null, deleteHook: null };
  const ok = data => ({ result: { ok: true, data } });
  const platform = {
    getStorageSync(key) { return data.has(key) ? structuredClone(data.get(key)) : ''; },
    setStorageSync(key, value) { if (state.failWrites) throw new Error('storage full'); data.set(key, structuredClone(value)); },
    removeStorageSync(key) { if (state.failWrites) throw new Error('storage unavailable'); data.delete(key); },
    chooseMedia(options) { calls.push(['choose', options.count]); options.success({ tempFiles: state.selection.slice(0, options.count) }); },
    saveFile(options) { const savedFilePath = 'wxfile://saved-' + state.serial + '-' + options.tempFilePath.split('/').pop(); saved.add(savedFilePath); options.success({ savedFilePath }); },
    removeSavedFile(options) {
      if (state.failRemoves) { options.fail({ errMsg: 'disk busy' }); return; }
      saved.delete(options.filePath); removed.push(options.filePath); options.success({});
    },
    cloud: {
      async callFunction({ data: request }) {
        const { action, payload } = request; calls.push([action, payload]);
        if (action === 'bootstrap') return ok({ user: { id: state.userId, verification: { status: state.verified ? 'phone_verified' : 'unverified' } } });
        if (action === 'createUploadTicket') {
          // The durable local image and its owner are recorded before networking.
          const queue = data.get(queueKey).items;
          assert.ok(queue.some(item => item.ownerId === state.userId && saved.has(item.localPath)));
          const ticketId = 'ticket-' + (++state.serial); state.statuses.set(ticketId, { status: 'pending' });
          return ok({ ticketId, cloudPath: 'community/incoming/user/' + ticketId + '.' + payload.extension });
        }
        if (action === 'completeUpload') return ok(state.completeHook ? await state.completeHook(payload) : state.statuses.get(payload.ticketId));
        if (action === 'getUploadStatus') return ok(state.statusHook ? await state.statusHook(payload) : state.statuses.get(payload.ticketId));
        if (action === 'createPost') return ok(state.postHook ? await state.postHook(payload) : { post: { id: 'post-1', images: payload.images } });
        if (action === 'deleteAccount') return ok(state.deleteHook ? await state.deleteHook(payload) : { deleted: true });
        throw new Error('unexpected test action ' + action);
      },
      async uploadFile(input) { uploads.push(input); return { fileID: pending('ticket-' + state.serial) }; }
    }
  };
  const config = { mode: 'cloud', cloudEnv: 'test' };
  const api = options => createApi(platform, config, { mediaPollAttempts: 0, mediaDelay: async () => {}, ...options });
  return { data, saved, removed, calls, uploads, state, platform, config, api };
}

test('pending image survives an API restart and only its approved published file becomes selectable', async () => {
  const f = fixture(); const original = f.api(); const first = await original.uploadImages(1);
  assert.deepEqual(first.images, []); assert.equal(first.pending[0].ticketId, 'ticket-1');
  const record = f.data.get(queueKey).items[0];
  assert.equal(record.serverPending, true); assert.ok(f.saved.has(record.localPath)); assert.equal(record.sourceFileId, pending('ticket-1'));
  f.state.statuses.set('ticket-1', { status: 'complete', fileId: approved('ticket-1') });
  const restored = await f.api().resumeUploads();
  assert.deepEqual(restored.images, [approved('ticket-1')]); assert.deepEqual(restored.pending, []);
  assert.equal(f.uploads.length, 1); assert.equal(f.calls.filter(call => call[0] === 'choose').length, 1);
});

test('network loss during polling keeps the pending ticket for later status checks without reuploading', async () => {
  const f = fixture(); f.state.statusHook = async () => { throw new Error('connection reset'); };
  const result = await f.api({ mediaPollAttempts: 1 }).uploadImages(1);
  assert.deepEqual(result.images, []); assert.equal(result.failures[0].code, 'NETWORK_ERROR'); assert.equal(result.failures[0].retryable, true);
  assert.equal(f.data.get(queueKey).items[0].serverPending, true);
  f.state.statusHook = async ({ ticketId }) => ({ status: 'complete', fileId: approved(ticketId) });
  assert.deepEqual((await f.api().resumeUploads()).images, [approved('ticket-1')]);
  assert.equal(f.uploads.length, 1); assert.equal(f.calls.filter(call => call[0] === 'completeUpload').length, 1);
});

test('a lost submission response resumes the same ticket through the idempotent complete endpoint', async () => {
  const f = fixture(); let attempts = 0;
  f.state.completeHook = async () => { if (++attempts === 1) throw new Error('response lost after commit'); return { status: 'pending' }; };
  assert.equal((await f.api().uploadImages(1)).failures[0].code, 'NETWORK_ERROR');
  assert.equal((await f.api().resumeUploads()).pending.length, 1);
  f.state.statuses.set('ticket-1', { status: 'complete', fileId: approved('ticket-1') });
  assert.deepEqual((await f.api().resumeUploads()).images, [approved('ticket-1')]);
  assert.equal(f.uploads.length, 1); assert.equal(f.calls.filter(call => call[0] === 'createUploadTicket').length, 1);
});

test('mixed success, pending and rejection retain every image result across retries', async () => {
  const f = fixture(); f.state.selection = ['cat', 'dog', 'bird'].map(name => ({ tempFilePath: '/tmp/' + name + '.png', size: 200 }));
  f.state.completeHook = async ({ ticketId }) => ticketId === 'ticket-1' ? { status: 'complete', fileId: approved(ticketId) }
    : ticketId === 'ticket-2' ? { status: 'pending', fileId: pending(ticketId) } : { status: 'rejected' };
  const first = await f.api().uploadImages(3);
  assert.deepEqual(first.images, [approved('ticket-1')]); assert.equal(first.pending.length, 1); assert.equal(first.failures.length, 1);
  assert.equal(first.failures[0].retryable, false);
  f.state.statuses.set('ticket-2', { status: 'complete', fileId: approved('ticket-2') });
  const retry = await f.api().resumeUploads();
  assert.deepEqual(retry.images, [approved('ticket-1'), approved('ticket-2')]); assert.equal(retry.failures[0].ticketId, 'ticket-3');
  const removed = await f.api().discardUploads(['ticket-3']);
  assert.deepEqual(removed.images, retry.images); assert.deepEqual(removed.failures, []);
  assert.equal(f.uploads.length, 3);
});

test('expired and rejected images never become attachments or retry network work', async () => {
  const f = fixture(); f.state.selection.push({ tempFilePath: '/tmp/dog.png', size: 200 });
  f.state.completeHook = async ({ ticketId }) => ({ status: ticketId === 'ticket-1' ? 'expired' : 'rejected', fileId: approved(ticketId) });
  const result = await f.api().uploadImages(2); const actionsBefore = f.calls.length;
  assert.deepEqual(result.images, []); assert.deepEqual(result.failures.map(item => item.code), ['UPLOAD_EXPIRED', 'CONTENT_REJECTED']);
  const again = await f.api().resumeUploads(); assert.deepEqual(again, result);
  assert.equal(f.calls.length, actionsBefore + 1); // Only ownership/verification bootstrap.
});

test('queues are isolated by account and cloud environment and cannot be discarded by another owner', async () => {
  const f = fixture(); await f.api().uploadImages(1);
  f.state.userId = 'user-2';
  assert.deepEqual((await f.api().resumeUploads()).pending, []);
  await f.api().discardUploads(['ticket-1']); assert.equal(f.data.get(queueKey).items.length, 1);
  f.state.userId = 'user-1';
  const otherEnv = createApi(f.platform, { mode: 'cloud', cloudEnv: 'another' }, { mediaPollAttempts: 0 });
  assert.deepEqual((await otherEnv.resumeUploads()).pending, []);
  assert.equal((await f.api().resumeUploads()).pending[0].ticketId, 'ticket-1');
});

test('unverified accounts cannot pick new images or resume network review work', async () => {
  const f = fixture(); await f.api().uploadImages(1); f.state.verified = false;
  const before = f.calls.length;
  await assert.rejects(f.api().uploadImages(1), { code: 'VERIFICATION_REQUIRED' });
  await assert.rejects(f.api().resumeUploads(), { code: 'VERIFICATION_REQUIRED' });
  assert.ok(f.calls.slice(before).every(call => call[0] === 'bootstrap'));
});

test('successful publishing consumes only the attached approved images and removes their local cloud copies', async () => {
  const f = fixture(); f.state.selection.push({ tempFilePath: '/tmp/dog.png', size: 200 });
  f.state.completeHook = async ({ ticketId }) => ({ status: 'complete', fileId: approved(ticketId) });
  const api = f.api(); const selected = await api.uploadImages(2);
  await api.call('createPost', { images: [selected.images[0]] });
  assert.deepEqual((await f.api().uploadImages(0)).images, [selected.images[1]]);
  assert.equal(f.removed.length, 1); assert.equal(f.saved.size, 1);
});

test('a failed post leaves approved image drafts intact for a deliberate retry', async () => {
  const f = fixture(); f.state.completeHook = async ({ ticketId }) => ({ status: 'complete', fileId: approved(ticketId) });
  const api = f.api(); const selected = await api.uploadImages(1);
  f.state.postHook = async () => { throw new Error('offline'); };
  await assert.rejects(api.call('createPost', { images: selected.images }), { code: 'NETWORK_ERROR' });
  assert.deepEqual((await api.uploadImages(0)).images, selected.images); assert.equal(f.removed.length, 0);
});

test('local storage failure after committed publishing reports local cleanup separately and never replays the post', async () => {
  const f = fixture(); f.state.completeHook = async ({ ticketId }) => ({ status: 'complete', fileId: approved(ticketId) });
  const api = f.api(); const selected = await api.uploadImages(1);
  f.state.postHook = async () => { f.state.failWrites = true; return { post: { id: 'committed-post' } }; };
  const result = await api.call('createPost', { images: selected.images });
  assert.equal(result.post.id, 'committed-post'); assert.equal(result.localCleanup.status, 'failed');
  assert.equal(f.calls.filter(call => call[0] === 'createPost').length, 1);
});

test('failed disk cleanup after publishing preserves cleanup records without resurfacing consumed images', async () => {
  const f = fixture(); f.state.completeHook = async ({ ticketId }) => ({ status: 'complete', fileId: approved(ticketId) });
  const api = f.api(); const selected = await api.uploadImages(1); f.state.failRemoves = true;
  const result = await api.call('createPost', { images: selected.images });
  assert.equal(result.post.id, 'post-1'); assert.equal(result.localCleanup.status, 'failed');
  assert.equal(f.data.get(queueKey).items[0].status, 'consumed');
  assert.deepEqual((await f.api().resumeUploads()).images, []);
  f.state.failRemoves = false; await f.api().clearLocalUploads();
  assert.equal(f.saved.size, 0); assert.equal(f.data.has(queueKey), false);
});

test('failed explicit image removal retains its queue record so cleanup can be retried', async () => {
  const f = fixture(); const api = f.api(); await api.uploadImages(1); f.state.failRemoves = true;
  await assert.rejects(api.discardUploads(['ticket-1']), { code: 'LOCAL_CLEANUP_FAILED' });
  assert.equal(f.data.get(queueKey).items.length, 1);
  f.state.failRemoves = false;
  assert.deepEqual((await api.discardUploads(['ticket-1'])).pending, []);
  assert.equal(f.saved.size, 0);
});

test('account deletion clears text and photo drafts without needing a fresh verified identity', async () => {
  const f = fixture(); const api = f.api(); await api.uploadImages(1); f.data.set(draftKey, { private: 'draft text' });
  f.state.deleteHook = async () => { f.state.verified = false; return { deleted: true }; };
  const result = await api.call('deleteAccount');
  assert.equal(result.deleted, true); assert.equal(result.localCleanup, undefined);
  assert.equal(f.data.has(queueKey), false); assert.equal(f.data.has(draftKey), false); assert.equal(f.saved.size, 0);
});

test('local file cleanup can be retried after successful account deletion without deleting the account twice', async () => {
  const f = fixture(); const api = f.api(); await api.uploadImages(1); f.data.set(draftKey, { private: 'draft text' }); f.state.failRemoves = true;
  const result = await api.call('deleteAccount');
  assert.equal(result.deleted, true); assert.equal(result.localCleanup.status, 'failed');
  assert.equal(f.data.get(queueKey).items.length, 1); assert.equal(f.data.has(draftKey), false);
  f.state.failRemoves = false; f.state.verified = false;
  assert.deepEqual(await f.api().clearLocalUploads(), { success: true });
  assert.equal(f.data.has(queueKey), false); assert.equal(f.saved.size, 0);
  assert.equal(f.calls.filter(call => call[0] === 'deleteAccount').length, 1);
});

test('polling is bounded and returns pending instead of holding the draft indefinitely', async () => {
  const f = fixture(); const result = await f.api({ mediaPollAttempts: 50 }).uploadImages(1);
  assert.equal(result.pending.length, 1); assert.equal(f.calls.filter(call => call[0] === 'getUploadStatus').length, 5);
});

test('concurrent selection requests serialize and enforce the three-image draft limit', async () => {
  const f = fixture(); f.state.selection.push({ tempFilePath: '/tmp/dog.png', size: 200 }); const api = f.api();
  const results = await Promise.all([api.uploadImages(2), api.uploadImages(2)]);
  assert.equal(results[0].pending.length, 2); assert.equal(results[1].pending.length, 3);
  assert.equal(f.data.get(queueKey).items.length, 3); assert.deepEqual(f.calls.filter(call => call[0] === 'choose').map(call => call[1]), [2, 1]);
});

test('corrupt review results are recoverable failures and never leak unapproved attachments', async () => {
  const f = fixture(); f.state.completeHook = async () => ({ status: 'complete', fileId: { unexpected: true } });
  const result = await f.api().uploadImages(1);
  assert.deepEqual(result.images, []); assert.equal(result.failures[0].code, 'INVALID_RESPONSE');
});
