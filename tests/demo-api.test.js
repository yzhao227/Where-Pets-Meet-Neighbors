const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../miniprogram/services/api');

function localPlatform(extra) {
  const data = new Map();
  return Object.assign({
    getStorageSync(key) { return data.get(key) || ''; },
    setStorageSync(key, value) { data.set(key, JSON.parse(JSON.stringify(value))); },
    removeStorageSync(key) { data.delete(key); },
    removeSavedFile(options) { options.success({}); }
  }, extra);
}

async function onboard(api) {
  await api.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
}

test('browser preview always uses demo even with cloud configuration', async () => {
  let cloudCalls = 0;
  const platform = localPlatform({ __preview: true, cloud: { callFunction() { cloudCalls += 1; throw new Error('must not run'); } } });
  const api = createApi(platform, { mode: 'cloud', cloudEnv: 'some-env' });
  assert.equal((await api.call('bootstrap')).mode, 'demo');
  await onboard(api);
  await api.call('createPost', { circleId: 'circle-neighbors', text: '本地', images: [] });
  assert.equal(cloudCalls, 0);
});

test('local image selection saves durable files and registers ownership for posting', async () => {
  const saved = [];
  const platform = localPlatform({
    chooseMedia(options) {
      assert.equal(options.count, 2);
      options.success({ tempFiles: [{ tempFilePath: '/tmp/cat.png', size: 123 }, { tempFilePath: '/tmp/dog.jpg', size: 456 }] });
    },
    saveFile(options) {
      const path = 'wxfile://saved-' + options.tempFilePath.split('/').pop();
      saved.push(path);
      options.success({ savedFilePath: path });
    }
  });
  const api = createApi(platform, { mode: 'demo' });
  await onboard(api);
  const { images } = await api.uploadImages(2);
  assert.deepEqual(images, saved);
  const result = await api.call('createPost', { circleId: 'circle-neighbors', text: '', images });
  const restarted = createApi(platform, { mode: 'demo' });
  assert.deepEqual((await restarted.call('getPost', { id: result.post.id })).post.images, saved);
});

test('chooseImage fallback supports data URLs and cancellation preserves the existing selection', async () => {
  const platform = localPlatform({
    chooseImage(options) { options.success({ tempFilePaths: ['data:image/png;base64,YQ=='] }); },
    saveFile(options) { options.success({ savedFilePath: options.tempFilePath }); }
  });
  const api = createApi(platform, { mode: 'demo' });
  await onboard(api);
  assert.deepEqual((await api.uploadImages(1)).images, ['data:image/png;base64,YQ==']);
  platform.chooseImage = options => options.fail({ errMsg: 'chooseImage:fail cancel' });
  assert.deepEqual((await api.uploadImages(3)).images, ['data:image/png;base64,YQ==']);
  assert.deepEqual((await api.uploadImages(0)).images, ['data:image/png;base64,YQ==']);
});

test('developer tools HTTP local files can be selected, published and restored from device storage', async () => {
  const saved = ['http://store_cat.png', 'http://usr/dog.jpg'];
  let index = 0;
  const platform = localPlatform({
    chooseMedia(options) { options.success({ tempFiles: [{ tempFilePath: 'http://tmp/cat.png', size: 123 }, { tempFilePath: 'http://tmp/dog.jpg', size: 456 }] }); },
    saveFile(options) { options.success({ savedFilePath: saved[index++] }); },
    getSavedFileList(options) { options.success({ fileList: saved.slice(0, index).map(filePath => ({ filePath })) }); }
  });
  const api = createApi(platform, { mode: 'demo' });
  await onboard(api);
  const uploaded = await api.uploadImages(2);
  assert.deepEqual(uploaded.failures, []);
  assert.deepEqual(uploaded.images, saved);
  const { post } = await api.call('createPost', { circleId: 'circle-neighbors', text: '', images: uploaded.images });
  const restarted = createApi(platform, { mode: 'demo' });
  assert.deepEqual((await restarted.call('getPost', { id: post.id })).post.images, saved);
  assert.deepEqual((await restarted.resumeUploads()).images, [], 'published photos do not return as a new draft');
});

test('only HTTP paths in the native saved file list are accepted, and a failed photo check can be retried', async () => {
  const savedPath = 'http://store_cat.png';
  let choices = 0;
  let saves = 0;
  let listingFails = true;
  const platform = localPlatform({
    chooseImage(options) { choices += 1; options.success({ tempFilePaths: ['http://tmp/cat.png'] }); },
    saveFile(options) { saves += 1; options.success({ savedFilePath: savedPath }); },
    getSavedFileList(options) {
      if (listingFails) options.fail({ errMsg: 'getSavedFileList:fail temporarily unavailable' });
      else options.success({ fileList: [{ filePath: savedPath }] });
    }
  });
  const api = createApi(platform, { mode: 'demo' });
  await onboard(api);
  const failed = await api.uploadImages(1);
  assert.equal(failed.images.length, 0);
  assert.equal(failed.failures.length, 1);
  listingFails = false;
  const restarted = createApi(platform, { mode: 'demo' });
  const recovered = await restarted.resumeUploads();
  assert.deepEqual(recovered.images, [savedPath]);
  assert.deepEqual(recovered.failures, []);
  assert.equal(choices, 1, 'retry reuses the photo already selected');
  assert.equal(saves, 1, 'retry reuses the saved copy');
  const ticket = await restarted.call('createUploadTicket', { extension: 'png' });
  for (const fileId of ['https://example.com/cat.png', 'http://usr.example.com/cat.png', 'http://store_cat.png/other', 'cloud://unreviewed/cat.png']) {
    await assert.rejects(restarted.call('completeUpload', { ticketId: ticket.ticketId, fileId }), { code: 'UPLOAD_UNAVAILABLE' });
  }
});

test('asynchronous saved-file validation snapshots the upload request and preserves concurrent writes', async () => {
  const savedPath = 'http://store_cat.png';
  let finishList;
  let signalListRequested;
  const listRequested = new Promise(resolve => { signalListRequested = resolve; });
  const platform = localPlatform({
    getSavedFileList(options) { finishList = options.success; signalListRequested(); }
  });
  const api = createApi(platform, { mode: 'demo' });
  await onboard(api);
  const original = await api.call('createUploadTicket', { extension: 'png' });
  const other = await api.call('createUploadTicket', { extension: 'png' });
  const payload = { ticketId: original.ticketId, fileId: savedPath };
  const pending = api.call('completeUpload', payload);
  await listRequested;
  payload.fileId = 'https://example.com/unlisted.png';
  payload.ticketId = other.ticketId;
  await api.call('updateProfile', { nickname: '检查照片期间保存的昵称' });
  await api.call('joinCircle', { id: 'circle-cats', join: true });
  finishList({ fileList: [{ filePath: savedPath }] });
  const result = await pending;
  assert.equal(result.fileId, savedPath, 'only the path actually checked may be accepted');
  assert.equal(result.ticketId, original.ticketId, 'a pending check cannot be redirected to another ticket');
  assert.equal((await api.call('getUploadStatus', { ticketId: other.ticketId })).status, 'pending');
  assert.equal((await api.call('bootstrap')).user.nickname, '检查照片期间保存的昵称');
  assert.equal((await api.call('getCircle', { id: 'circle-cats' })).circle.isJoined, true);
});

test('cloud envelope and errors are unwrapped without passing a client identity', async () => {
  const calls = [];
  const platform = { cloud: { async callFunction(input) {
    calls.push(input);
    return input.data.action === 'bootstrap' ? { result: { ok: true, data: { mode: 'cloud', user: { nickname: '真实账号' } } } } : { result: { ok: false, error: { code: 'FORBIDDEN', message: '只有管理员可以操作' } } };
  } } };
  const api = createApi(platform, { mode: 'cloud' });
  assert.equal((await api.call('bootstrap')).mode, 'cloud');
  assert.deepEqual(calls[0], { name: 'community', data: { action: 'bootstrap', payload: {} } });
  await assert.rejects(api.call('createEvent', { title: 'x' }), { code: 'FORBIDDEN', message: '只有管理员可以操作' });
});

test('cloud upload uses the reviewed fileId returned by completeUpload', async () => {
  const actions = [];
  const uploads = [];
  const platform = localPlatform({
    chooseMedia(options) { options.success({ tempFiles: [{ tempFilePath: '/tmp/cat.png', size: 400 }] }); },
    saveFile(options) { options.success({ savedFilePath: 'wxfile://saved-cat.png' }); },
    cloud: {
      async callFunction(input) {
        actions.push(input.data);
        if (input.data.action === 'bootstrap') return { result: { ok: true, data: { user: { id: 'user-1', verification: { status: 'phone_verified' } } } } };
        if (input.data.action === 'createUploadTicket') return { result: { ok: true, data: { ticketId: 'ticket-1', cloudPath: 'pending/user/cat.png' } } };
        if (input.data.action === 'completeUpload') return { result: { ok: true, data: { fileId: 'cloud://approved/cat.png' } } };
        return { result: { ok: true, data: {} } };
      },
      async uploadFile(input) { uploads.push(input); return { fileID: 'cloud://pending/cat.png' }; }
    }
  });
  const api = createApi(platform, { mode: 'cloud' });
  assert.deepEqual((await api.uploadImages(1)).images, ['cloud://approved/cat.png']);
  assert.deepEqual(uploads, [{ cloudPath: 'pending/user/cat.png', filePath: 'wxfile://saved-cat.png' }]);
  assert.deepEqual(actions, [
    { action: 'bootstrap', payload: {} },
    { action: 'createUploadTicket', payload: { extension: 'png' } },
    { action: 'completeUpload', payload: { ticketId: 'ticket-1', fileId: 'cloud://pending/cat.png' } }
  ]);
});

test('failed image saves and moderation do not report upload success', async () => {
  const platform = localPlatform({
    chooseImage(options) { options.success({ tempFilePaths: ['/tmp/cat.png'] }); },
    saveFile(options) { options.fail({ errMsg: 'out of storage' }); }
  });
  const demo = createApi(platform, { mode: 'demo' });
  await onboard(demo);
  const failedSave = await demo.uploadImages(1);
  assert.deepEqual(failedSave.images, []);
  assert.equal(failedSave.failures[0].code, 'IMAGE_SAVE_FAILED');
  const cloud = localPlatform({
    chooseImage: platform.chooseImage,
    saveFile(options) { options.success({ savedFilePath: 'wxfile://saved-cat.png' }); },
    cloud: {
      async callFunction(input) {
        if (input.data.action === 'bootstrap') return { result: { ok: true, data: { user: { id: 'user-1', verification: { status: 'phone_verified' } } } } };
        return input.data.action === 'createUploadTicket' ? { result: { ok: true, data: { ticketId: 't', cloudPath: 'pending/image.png' } } } : { result: { ok: false, error: { code: 'CONTENT_REJECTED', message: '图片未通过处理' } } };
      },
      async uploadFile() { return { fileID: 'cloud://pending/image.png' }; }
    }
  });
  const rejected = await createApi(cloud, { mode: 'cloud' }).uploadImages(1);
  assert.deepEqual(rejected.images, []);
  assert.equal(rejected.failures[0].code, 'CONTENT_REJECTED');
});

test('cloud transport failures never silently fall back to demo', async () => {
  const api = createApi({ cloud: { async callFunction() { throw new Error('network offline'); } } }, { mode: 'cloud' });
  await assert.rejects(api.call('bootstrap'), { code: 'NETWORK_ERROR' });
  const malformed = createApi({ cloud: { async callFunction() { return { result: 'not an envelope' }; } } }, { mode: 'cloud' });
  await assert.rejects(malformed.call('bootstrap'), { code: 'INVALID_RESPONSE' });
});

test('oversized images are rejected before saving or sending', async () => {
  let writes = 0;
  const platform = localPlatform({
    chooseMedia(options) { options.success({ tempFiles: [{ tempFilePath: '/tmp/large.png', size: 5 * 1024 * 1024 + 1 }] }); },
    saveFile() { writes += 1; }
  });
  const demo = createApi(platform, { mode: 'demo' });
  await onboard(demo);
  const result = await demo.uploadImages(1);
  assert.deepEqual(result.images, []);
  assert.equal(result.failures[0].code, 'IMAGE_TOO_LARGE');
  assert.equal(writes, 0);
});

test('unverified demo cannot open the image picker or save any image', async () => {
  let choices = 0;
  let saves = 0;
  const platform = localPlatform({
    chooseMedia(options) { choices += 1; options.success({ tempFiles: [{ tempFilePath: '/tmp/never-read.png', size: 100 }] }); },
    saveFile(options) { saves += 1; options.success({ savedFilePath: 'wxfile://never-saved.png' }); }
  });
  await assert.rejects(createApi(platform, { mode: 'demo' }).uploadImages(1), { code: 'VERIFICATION_REQUIRED' });
  assert.equal(choices, 0);
  assert.equal(saves, 0);
});
