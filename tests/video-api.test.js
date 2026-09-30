'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../miniprogram/services/api');

const QUEUE = 'youchong.uploadQueue.v1';
function fixture() {
  const data = new Map(), saved = new Set(), calls = [], progress = [];
  const state = { userId: 'self', duration: 12, bytes: 2048, saveFails: false, cancel: false, uploadCalls: 0, status: 'complete', nextSave: 0 };
  const ok = value => ({ result: { ok: true, data: value } });
  const platform = {
    getStorageSync(key) { return data.has(key) ? structuredClone(data.get(key)) : ''; },
    setStorageSync(key, value) { data.set(key, structuredClone(value)); },
    removeStorageSync(key) { data.delete(key); },
    chooseMedia(args) {
      calls.push(['choose', args.mediaType]);
      if (state.cancel) return args.fail({ errMsg: 'chooseMedia:fail cancel' });
      args.success({ tempFiles: [{ tempFilePath: '/tmp/selected.mp4', duration: state.duration, size: state.bytes, width: 640, height: 360 }] });
    },
    compressVideo(args) { calls.push(['compress', args.src]); if (state.compressHook) state.compressHook(); args.success({ tempFilePath: '/tmp/compressed.mp4' }); },
    getVideoInfo(args) { args.success({ duration: state.duration, width: 640, height: 360 }); },
    getFileInfo(args) { args.success({ size: state.bytes }); },
    saveFile(args) {
      if (state.saveFails) return args.fail({ errMsg: 'saveFile:fail storage full' });
      const savedFilePath = 'wxfile://saved-video-' + (++state.nextSave) + '.mp4'; saved.add(savedFilePath); args.success({ savedFilePath });
    },
    getSavedFileList(args) { args.success({ fileList: [...saved].map(filePath => ({ filePath })) }); },
    removeSavedFile(args) { saved.delete(args.filePath); args.success({}); },
    cloud: {
      callFunction({ data: { action, payload } }) {
        calls.push([action, payload]);
        if (action === 'bootstrap') return Promise.resolve(ok({ user: { id: state.userId, verification: { status: 'phone_verified' } } }));
        if (action === 'createUploadTicket') {
          assert.equal(payload.mediaType, 'video'); assert.equal(payload.extension, 'mp4');
          assert.equal(payload.bytes, state.bytes);
          assert.ok(data.get(QUEUE).items.some(item => item.ownerId === state.userId && saved.has(item.localPath)));
          return Promise.resolve(ok({ ticketId: 'video-ticket', cloudPath: 'community/incoming/self/video-ticket.mp4' }));
        }
        if (action === 'completeUpload' || action === 'getUploadStatus') {
          if (state.reviewFails) return Promise.reject(new Error('offline'));
          return Promise.resolve(ok(state.status === 'complete' ? { status: 'complete', fileId: 'cloud://test/community/published/video.mp4',
            video: { url: 'cloud://test/community/published/video.mp4', durationSeconds: 11.5, width: 320, height: 180 } } : { status: state.status }));
        }
        if (action === 'createPost') return state.postFails ? Promise.reject(new Error('offline')) : Promise.resolve(ok({ post: { id: 'post', video: payload.video } }));
        throw new Error('unexpected action ' + action);
      },
      uploadFile(args) {
        state.uploadCalls += 1;
        queueMicrotask(() => args.success({ fileID: 'cloud://test/community/incoming/self/video-ticket.mp4' }));
        return { onProgressUpdate(callback) { [17, 64, 100].forEach(value => { progress.push(value); callback({ progress: value }); }); } };
      }
    }
  };
  const api = (mode = 'cloud') => createApi(platform, { mode, cloudEnv: 'test' }, { mediaPollAttempts: 0 });
  return { data, saved, calls, progress, state, platform, api };
}

test('video upload compresses and saves once, reports native progress, and uses server metadata', async () => {
  const f = fixture(), updates = [];
  const result = await f.api().uploadVideo(value => updates.push(value));
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.video, { url: 'cloud://test/community/published/video.mp4', durationSeconds: 11.5, width: 320, height: 180 });
  assert.equal(result.completed[0].mediaType, 'video');
  assert.deepEqual(updates, [17, 64, 100]);
  assert.deepEqual((await f.api().resumeUploads()).video, result.video);
  assert.equal(f.calls.filter(call => call[0] === 'compress').length, 1);
  assert.equal(f.state.uploadCalls, 1);
});

test('video save failure retains the selection and can recover without reopening the picker', async () => {
  const f = fixture(); f.state.saveFails = true;
  const first = await f.api().uploadVideo();
  assert.equal(first.video, null); assert.equal(first.failures[0].retryable, true);
  assert.equal(f.data.get(QUEUE).items[0].preparedPath, '/tmp/compressed.mp4');
  f.state.saveFails = false;
  assert.ok((await f.api().resumeUploads()).video);
  assert.equal(f.calls.filter(call => call[0] === 'choose').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'compress').length, 1);
});

test('video review interruption retains one ticket and never attaches incoming unreviewed bytes', async () => {
  const f = fixture(); f.state.reviewFails = true;
  const first = await f.api().uploadVideo();
  assert.equal(first.video, null); assert.equal(first.failures[0].mediaType, 'video');
  f.state.reviewFails = false; f.state.status = 'pending';
  assert.equal((await f.api().resumeUploads()).pending[0].mediaType, 'video');
  f.state.status = 'complete';
  assert.ok((await f.api().resumeUploads()).video);
  assert.equal(f.state.uploadCalls, 1);
  assert.equal(f.calls.filter(call => call[0] === 'createUploadTicket').length, 1);
});

test('video limit violations fail before cloud work and keep an explicit removable failed attachment', async () => {
  for (const [key, value, code] of [['duration', 60.1, 'VIDEO_TOO_LONG'], ['bytes', 20 * 1024 * 1024 + 1, 'VIDEO_TOO_LARGE']]) {
    const f = fixture(); f.state[key] = value;
    const result = await f.api().uploadVideo();
    assert.equal(result.video, null); assert.equal(result.failures[0].code, code); assert.equal(result.failures[0].retryable, false);
    assert.equal(f.calls.some(call => call[0] === 'createUploadTicket'), false);
    assert.deepEqual((await f.api().discardUploads([result.failures[0].ticketId])).failures, []);
  }
});

test('cancelling the video picker leaves text drafts intact and creates no upload', async () => {
  const f = fixture(); f.state.cancel = true; f.data.set('youchong.privateDrafts.v1', { text: '我的草稿' });
  assert.equal((await f.api().uploadVideo()).video, null);
  assert.deepEqual(f.data.get('youchong.privateDrafts.v1'), { text: '我的草稿' });
  assert.equal(f.state.uploadCalls, 0);
});

test('an expired temporary video remains a removable failure rather than a false successful retry', async () => {
  const f = fixture(); f.state.saveFails = true;
  await f.api().uploadVideo();
  f.platform.saveFile = args => args.fail({ errMsg: 'saveFile:fail no such file' });
  const result = await f.api().resumeUploads();
  assert.equal(result.video, null);
  assert.equal(result.failures[0].code, 'VIDEO_SOURCE_UNAVAILABLE');
  assert.equal(result.failures[0].retryable, false);
  assert.equal(f.state.uploadCalls, 0);
});

test('chooseVideo fallback uses byte-level file information rather than its kB size field', async () => {
  const f = fixture(); delete f.platform.chooseMedia;
  f.platform.chooseVideo = args => {
    assert.equal(args.maxDuration, 60); assert.equal(args.compressed, true);
    args.success({ tempFilePath: '/tmp/selected.mp4', duration: 12, width: 640, height: 360, size: 2 });
  };
  assert.ok((await f.api().uploadVideo()).video);
  const ticket = f.calls.find(call => call[0] === 'createUploadTicket')[1];
  assert.equal(ticket.bytes, 2048);
});

test('video and image queues are mutually exclusive and video selection remains single', async () => {
  const f = fixture(); const first = await f.api().uploadVideo();
  assert.deepEqual((await f.api().uploadVideo()).video, first.video);
  assert.equal(f.calls.filter(call => call[0] === 'choose').length, 1);
  await assert.rejects(f.api().uploadImages(1), { code: 'MEDIA_CONFLICT' });
  const g = fixture(); g.data.set(QUEUE, { version: 1, items: [{ ownerId: 'self', scope: 'cloud:test', localId: 'image', status: 'complete', fileId: 'photo.png' }] });
  await assert.rejects(g.api().uploadVideo(), { code: 'MEDIA_CONFLICT' });
});

test('account switching during video preparation cannot issue a ticket for the new user', async () => {
  const f = fixture(); f.state.compressHook = () => { f.state.userId = 'someone-else'; };
  await assert.rejects(f.api().uploadVideo(), { code: 'UPLOAD_OWNER_CHANGED' });
  assert.equal(f.calls.some(call => call[0] === 'createUploadTicket'), false);
  assert.equal(f.data.get(QUEUE).items[0].ownerId, 'self');
  assert.equal((await f.api().resumeUploads()).video, null);
});

test('published video consumes its queue only after a successful post', async () => {
  const f = fixture(), api = f.api(); const upload = await api.uploadVideo();
  f.state.postFails = true;
  await assert.rejects(api.call('createPost', { images: [], video: upload.video }), { code: 'NETWORK_ERROR' });
  assert.ok((await api.resumeUploads()).video); assert.equal(f.saved.size, 1);
  f.state.postFails = false;
  await api.call('createPost', { images: [], video: upload.video });
  assert.equal((await f.api().resumeUploads()).video, null); assert.equal(f.saved.size, 0);
});

test('demo video persists for local playback and does not claim cloud moderation', async () => {
  const f = fixture(), api = f.api('demo');
  await api.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  const uploaded = await api.uploadVideo();
  assert.match(uploaded.video.url, /^wxfile:\/\/saved-video-/);
  assert.equal(f.state.uploadCalls, 0);
  const result = await api.call('createPost', { circleId: 'circle-neighbors', text: '散步片段', images: [], video: uploaded.video });
  assert.equal((await f.api('demo').call('getPost', { id: result.post.id })).post.video.url, uploaded.video.url);
  assert.ok(f.saved.has(uploaded.video.url));
  assert.equal((await f.api('demo').resumeUploads()).video, null);
});
