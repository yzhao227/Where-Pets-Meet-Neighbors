'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const exportedApi = require('../miniprogram/services/api');
const drafts = require('../miniprogram/pages/_drafts');

const QUEUE = 'youchong.uploadQueue.v1';
const flush = () => new Promise(resolve => setImmediate(resolve));
const event = (index, value) => ({ currentTarget: { dataset: { index } }, detail: { value } });
const canonical = (id, video = false) => 'cloud://memory.bucket/community/published/' + id + (video ? '.mp4' : '.jpg');

async function fixture(t) {
  const store = new Map(), files = new Set(), pages = [], tickets = new Map();
  const effects = { calls: [], previews: [], removed: [], toasts: [], picks: 0, writesAfterUnload: 0 };
  const state = { owner: 'memory-owner', serial: 0, images: 3, postFails: false, resumeFails: false };
  const previous = { wx: global.wx, Page: global.Page, api: { ...exportedApi } };
  const ok = data => ({ result: { ok: true, data } });
  global.wx = {
    getStorageSync(key) { return store.has(key) ? structuredClone(store.get(key)) : ''; },
    setStorageSync(key, value) { store.set(key, structuredClone(value)); },
    removeStorageSync(key) { store.delete(key); },
    chooseMedia(options) {
      effects.picks += 1;
      assert.deepEqual(options.mediaType, ['image'], 'only the image picker may be opened');
      options.success({ tempFiles: Array.from({ length: Math.min(state.images, options.count) }, (_, index) => ({ tempFilePath: '/memory/selected-' + index + '.jpg', size: 1200, width: 400, height: 300 })) });
    },
    compressVideo(options) { options.success({ tempFilePath: '/memory/compressed.mp4' }); },
    getVideoInfo(options) { options.success({ duration: 8, width: 400, height: 300 }); },
    getFileInfo(options) { options.success({ size: 1200 }); },
    saveFile(options) {
      const savedFilePath = 'wxfile://memory-saved-' + (++state.serial) + (/\.mp4$/.test(options.tempFilePath) ? '.mp4' : '.jpg');
      files.add(savedFilePath); options.success({ savedFilePath });
    },
    removeSavedFile(options) { files.delete(options.filePath); effects.removed.push(options.filePath); options.success({}); },
    showToast(options) { effects.toasts.push(options.title); }, showModal(options) { options.success({ confirm: true }); },
    previewImage(options) { effects.previews.push(structuredClone(options)); },
    navigateBack() {}, switchTab() {}, stopPullDownRefresh() {},
    cloud: {
      async callFunction({ data: { action, payload } }) {
        effects.calls.push({ action, payload: structuredClone(payload) });
        if (action === 'bootstrap') return ok({ mode: 'cloud', user: { id: state.owner, verification: { status: 'phone_verified' } }, circles: [{ id: 'memory-circle', name: '仅内存圈子', isJoined: true }] });
        if (action === 'listPlaces' || action === 'listEvents') return ok({ items: [] });
        if (action === 'createUploadTicket') {
          const ticketId = 'ticket-' + state.serial;
          tickets.set(ticketId, payload.mediaType === 'video');
          return ok({ ticketId, cloudPath: 'community/incoming/' + ticketId });
        }
        if (action === 'completeUpload' || action === 'getUploadStatus') {
          const video = tickets.get(payload.ticketId), fileId = canonical(payload.ticketId, video);
          return ok({ status: 'complete', fileId, ...(video ? { video: { url: 'https://example.invalid/temporary-authorized-video', durationSeconds: 8, width: 400, height: 300 } } : {}) });
        }
        if (action === 'createPost') {
          if (state.postFails) throw Error('仅内存发布网络失败');
          return ok({ post: { id: 'memory-post' } });
        }
        throw Error('Unexpected cloud action ' + action);
      },
      uploadFile(options) { return Promise.resolve({ fileID: 'cloud://memory.bucket/' + options.cloudPath }); },
      getTempFileURL() { assert.fail('draft previews must not request direct cloud file reads'); },
      downloadFile() { assert.fail('draft previews must not download protected cloud files'); }
    }
  };
  const create = () => exportedApi.createApi(global.wx, { mode: 'cloud', cloudEnv: 'memory' }, { mediaPollAttempts: 0 });
  const api = create();
  for (const name of ['call', 'uploadImages', 'uploadVideo', 'discardUploads', 'clearLocalUploads', 'getFeedVersion']) exportedApi[name] = api[name];
  exportedApi.resumeUploads = () => state.resumeFails ? Promise.reject(Error('仅内存同步失败')) : api.resumeUploads();
  async function mount() {
    let definition; global.Page = value => { definition = value; };
    const file = require.resolve('../miniprogram/pages/compose/index'); delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data), setData(values) { if (this._closed) effects.writesAfterUnload += 1; Object.assign(this.data, values); } };
    pages.push(page); page.onLoad({ circleId: 'memory-circle' });
    for (let index = 0; index < 30 && (page.data.loading || page.data.uploadsBusy); index += 1) await flush();
    await flush(); assert.equal(page.data.error, ''); return page;
  }
  t.after(async () => {
    for (const page of pages) if (!page._closed) page.onUnload();
    await flush(); global.wx = previous.wx; global.Page = previous.Page; Object.assign(exportedApi, previous.api);
  });
  return { api, create, mount, store, files, effects, state };
}

test('approved snapshots carry persistent native previews separately from canonical cloud identifiers', async t => {
  const f = await fixture(t);
  const result = await f.api.uploadImages(3);
  assert.equal(result.images.length, 3);
  for (const completed of result.completed) {
    assert.match(completed.fileId, /^cloud:\/\//); assert.ok(f.files.has(completed.previewPath));
    assert.equal(completed.previewPath, f.store.get(QUEUE).items.find(item => item.fileId === completed.fileId).localPath);
  }
  const restored = await f.create().resumeUploads();
  assert.deepEqual(restored.completed, result.completed);
  assert.deepEqual(restored.images, result.images); assert.equal(f.effects.picks, 1);
});

test('three-image preview, cover selection and removal keep local display paths aligned with upload IDs', async t => {
  const f = await fixture(t); const page = await f.mount(); await page.upload();
  const canonicalImages = page.data.images.slice(), localImages = page.data.imagePreviewSources.slice();
  assert.equal(canonicalImages.length, 3); assert.ok(localImages.every(path => f.files.has(path)));
  assert.ok(canonicalImages.every(path => path.startsWith('cloud://')));
  page.preview(event(2));
  assert.deepEqual(f.effects.previews.at(-1), { urls: localImages, current: localImages[2] });
  page.chooseCover(event(2)); await page.removeImage(event(0));
  assert.deepEqual(page.data.images, canonicalImages.slice(1)); assert.deepEqual(page.data.imagePreviewSources, localImages.slice(1));
  assert.equal(page.data.coverIndex, 1); assert.equal(page.data.images[page.data.coverIndex], canonicalImages[2]);
  page.preview(event(1)); assert.equal(f.effects.previews.at(-1).current, localImages[2]);
  page.chooseVisibility(event(undefined, 2)); page.input(event(undefined, '仅内存私密图片'));
  f.state.postFails = true; await page.submit();
  assert.deepEqual(page.data.imagePreviewSources, localImages.slice(1));
  f.state.postFails = false; await page.submit();
  const payload = f.effects.calls.filter(call => call.action === 'createPost').at(-1).payload;
  assert.deepEqual(payload.images, canonicalImages.slice(1)); assert.equal(payload.coverIndex, 1); assert.equal(payload.visibility, 'private');
  assert.doesNotMatch(JSON.stringify(payload), /wxfile:|previewPath|imagePreviewSources|videoPreviewSource/);
  assert.deepEqual(page.data.imagePreviewSources, []); assert.equal(page.data.videoPreviewSource, '');
});

test('draft preview metadata survives reopening and temporary queue failure without a cloud read', async t => {
  const f = await fixture(t); const first = await f.mount(); await first.upload();
  first.chooseCover(event(1)); first.input(event(undefined, '仅本机恢复图片'));
  const localImages = first.data.imagePreviewSources.slice(), canonicalImages = first.data.images.slice();
  first.onUnload(); f.state.resumeFails = true;
  const restored = await f.mount();
  assert.equal(restored.data.draftRestored, true); assert.deepEqual(restored.data.images, canonicalImages);
  assert.deepEqual(restored.data.imagePreviewSources, localImages); assert.equal(restored.data.coverIndex, 1);
  const draft = f.store.get(drafts.KEY)['cloud:memory-owner'];
  assert.deepEqual(draft.completedUploads.map(item => item.previewPath), localImages);
  assert.equal(draft.imagePreviewSources, undefined, 'derived source arrays are not separately persisted');
  f.state.resumeFails = false; await restored.checkUploads(true);
  assert.deepEqual(restored.data.imagePreviewSources, localImages); assert.equal(f.effects.picks, 1);
  f.state.owner = 'different-memory-owner'; await restored.refresh();
  assert.deepEqual(restored.data.images, []); assert.deepEqual(restored.data.imagePreviewSources, []); assert.equal(restored.data.videoPreviewSource, '');
});

test('legacy private video drafts never play or upload again and can continue as image posts after explicit removal', async t => {
  const f = await fixture(t);
  const video = { url: canonical('legacy-video', true), durationSeconds: 8 };
  const local = 'wxfile://legacy-private-video.mp4', ticketId = 'legacy-video';
  f.files.add(local);
  f.store.set(QUEUE, { version: 1, items: [{ localId: ticketId, ticketId, ownerId: f.state.owner, scope: 'cloud:memory', mediaType: 'video', extension: 'mp4', status: 'complete', localPath: local, fileId: video.url, video }] });
  f.store.set(drafts.KEY, { 'cloud:memory-owner': { version: 1, visibility: 'private', text: '仅内存私密视频草稿的正文', title: '旧草稿', video, images: [], completedUploads: [{ ticketId, fileId: video.url, previewPath: local, mediaType: 'video' }], pendingUploads: [], failedUploads: [] } });
  const restored = await f.mount();
  assert.deepEqual(restored.data.video, video);
  assert.equal(restored.data.videoPreviewSource, '');
  assert.equal(restored.uploadVideo, undefined);
  assert.equal(restored.data.visibility, 'private');
  assert.equal(restored.data.failedUploads[0].code, 'VIDEO_DISABLED');
  assert.equal(restored.data.completedUploads[0].previewPath, local, 'legacy metadata remains available only for cleanup');
  assert.ok(f.files.has(local), 'opening the editor does not delete the private draft file');
  assert.equal(f.effects.picks, 0);
  assert.equal(f.effects.calls.some(call => ['createUploadTicket', 'completeUpload', 'getUploadStatus'].includes(call.action)), false);
  await restored.submit();
  assert.equal(f.effects.calls.some(call => call.action === 'createPost'), false);
  assert.match(f.effects.toasts.at(-1), /仅支持文字和图片/);
  await restored.removeVideo();
  assert.equal(restored.data.video, null);
  assert.equal(restored.data.hasVideoAttachment, false);
  assert.deepEqual(restored.data.failedUploads, []);
  assert.ok(!f.files.has(local));
  assert.equal(restored.data.text, '仅内存私密视频草稿的正文');
  await restored.upload();
  await restored.submit();
  const payload = f.effects.calls.filter(call => call.action === 'createPost').at(-1).payload;
  assert.equal(payload.video, undefined); assert.equal(payload.visibility, 'private');
  assert.equal(payload.text, '仅内存私密视频草稿的正文'); assert.equal(payload.images.length, 3);
  assert.doesNotMatch(JSON.stringify(payload), /wxfile:|previewPath|videoPreviewSource/);
});

test('legacy mixed attachments preserve the photo preview without exposing video playback', async t => {
  const f = await fixture(t); const page = await f.mount();
  const image = canonical('old-image'), video = { url: canonical('new-video', true), durationSeconds: 8 };
  page.change({ images: [image], completedUploads: [{ ticketId: 'old-image', fileId: image, previewPath: 'wxfile://old-image.jpg', recoveredFromDraft: true }] });
  page.applyUploads({ images: [], video, completed: [{ ticketId: 'new-video', fileId: video.url, previewPath: 'wxfile://new-video.mp4', mediaType: 'video' }], pending: [], failures: [] });
  assert.equal(page.data.mediaConflict, true);
  assert.deepEqual(page.data.imagePreviewSources, ['wxfile://old-image.jpg']); assert.equal(page.data.videoPreviewSource, '');
  await page.submit(); assert.equal(f.effects.calls.some(call => call.action === 'createPost'), false);
  await page.removeVideo();
  assert.equal(page.data.videoPreviewSource, ''); assert.deepEqual(page.data.imagePreviewSources, ['wxfile://old-image.jpg']);
  assert.equal(page.data.mediaConflict, false);
  await page.clearDraft(); assert.deepEqual(page.data.imagePreviewSources, []); assert.equal(page.data.videoPreviewSource, '');
});

test('legacy cloud drafts without local copies show unavailable previews instead of reading protected files', async t => {
  const f = await fixture(t); f.state.resumeFails = true;
  f.store.set(drafts.KEY, { 'cloud:memory-owner': { version: 1, images: [canonical('no-local-copy')], video: { url: canonical('no-local-video', true), durationSeconds: 8 }, completedUploads: [], text: '保留旧草稿供移除' } });
  const page = await f.mount();
  assert.deepEqual(page.data.imagePreviewSources, ['']); assert.equal(page.data.videoPreviewSource, '');
  assert.equal(page.data.images.length, 1); assert.ok(page.data.video);
  page.preview(event(0)); assert.deepEqual(f.effects.previews, []);
  const markup = fs.readFileSync(require.resolve('../miniprogram/pages/compose/index.wxml'), 'utf8');
  assert.match(markup, /src="\{\{imagePreviewSources\[index\]\}\}"/);
  assert.doesNotMatch(markup, /<video\b|videoPreviewSource|uploadVideo/);
  assert.doesNotMatch(markup, /src="\{\{video\.url\}\}"|poster="\{\{video\.poster/);
  assert.match(markup, /本机照片预览暂不可用/); assert.match(markup, /不支持的旧附件/);
});
