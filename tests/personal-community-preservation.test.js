'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createApi } = require('../miniprogram/services/api');
const { createPersonalService, personalFileReferenced, STORAGE_KEY } = require('../miniprogram/services/personal');
const { clearLocalPetPhotos, createPetPhotos } = require('../miniprogram/services/pet-photos');
const LEGACY = 'youban.demo.v1';
const DRAFTS = 'youchong.privateDrafts.v1';
const QUEUE = 'youchong.uploadQueue.v1';

async function fixture() {
  const data = new Map(), removed = [], cloudCalls = [], controls = { failRead: false };
  const platform = {
    getStorageSync(key) { if (controls.failRead && key === STORAGE_KEY) throw new Error('disk unavailable'); return structuredClone(data.get(key) || ''); },
    setStorageSync(key, value) { data.set(key, structuredClone(value)); },
    removeStorageSync(key) { data.delete(key); },
    removeSavedFile(options) { removed.push(options.filePath); if (options.success) options.success({}); },
    cloud: { async callFunction(request) { cloudCalls.push(request); throw new Error('cloud forbidden in this fixture'); } }
  };
  const community = createApi(platform, { productMode: 'community', mode: 'demo' });
  await community.call('bootstrap');
  const personal = createApi(platform, { productMode: 'personal', mode: 'demo' });
  await personal.call('bootstrap');
  const post = (await personal.call('createPost', { visibility: 'private', title: '旧私人日记', text: '不能自动发布的正文' })).post;
  await personal.call('savePet', { name: '私人小猫', type: 'cat', breed: '家猫' });
  data.set(DRAFTS, { 'personal:personal:demo-self': { version: 1, text: '原来的私人草稿', visibility: 'private', images: ['wxfile://draft'] },
    'demo:demo-self': { version: 1, text: '当前社区草稿' }, 'demo:other': { version: 1, text: '其他账号草稿' } });
  return { data, removed, platform, community, personal, post, cloudCalls, controls };
}

test('community reads existing private library without migrating or publishing and isolates local accounts', async () => {
  const f = await fixture();
  const stored = f.data.get(STORAGE_KEY), posts = stored.accounts[0].posts;
  posts[0].images = ['wxfile://private-photo.png'];
  posts.push({ ...structuredClone(posts[0]), id: 'retired-video-object', video: { url: 'wxfile://private-video.mp4', durationSeconds: 9 } },
    { ...structuredClone(posts[0]), id: 'retired-video-type', contentType: 'video' });
  f.data.set(STORAGE_KEY, stored);
  const original = structuredClone(f.data.get(STORAGE_KEY)), draft = structuredClone(f.data.get(DRAFTS));
  const library = await f.community.getPrivateLibrary();
  assert.equal(library.ownerId, 'demo-self'); assert.equal(library.available, true);
  assert.equal(library.posts[0].id, f.post.id); assert.equal(library.posts[0].visibility, 'private');
  assert.deepEqual(library.posts.map(post => post.id), [f.post.id], 'historical videos are not exposed through the private library');
  assert.deepEqual(library.posts[0].images, ['wxfile://private-photo.png']);
  assert.equal(library.posts[0].canShare, false); assert.equal(library.pets[0].name, '私人小猫');
  assert.equal(library.drafts[0].text, '原来的私人草稿');
  assert.deepEqual(f.data.get(STORAGE_KEY), original); assert.deepEqual(f.data.get(DRAFTS), draft);
  assert.ok(!(await f.community.call('listPosts', { mine: true })).items.some(post => post.id === f.post.id));
  assert.equal((await f.community.call('listPets')).pets.length, 0);
  const legacy = f.data.get(LEGACY); legacy.currentUserId = 'other'; f.data.set(LEGACY, legacy);
  const other = await f.community.getPrivateLibrary();
  assert.equal(other.ownerId, 'other'); assert.equal(other.available, false);
  assert.deepEqual(other.posts, []); assert.deepEqual(other.pets, []); assert.deepEqual(other.drafts, []);
  await assert.rejects(createPersonalService(f.platform).readLibrary('demo-self'), { code: 'UPLOAD_OWNER_CHANGED' });
  assert.deepEqual(f.data.get(STORAGE_KEY), original);
});

test('cloud identity never receives an unlinked local private library', async () => {
  const f = await fixture();
  const api = createApi(f.platform, { productMode: 'community', mode: 'cloud', cloudEnv: 'test-env' });
  await assert.rejects(api.getPrivateLibrary(), { code: 'PRIVATE_LIBRARY_UNLINKED' });
  assert.deepEqual(f.cloudCalls, []);
  assert.equal(f.data.get(STORAGE_KEY).accounts[0].posts[0].id, f.post.id);
});

test('community account deletion preserves personal drafts, overlays and their referenced legacy files', async () => {
  const f = await fixture();
  const personal = f.data.get(STORAGE_KEY); personal.accounts[0].posts[0].images = ['wxfile://shared']; f.data.set(STORAGE_KEY, personal);
  const legacy = f.data.get(LEGACY); legacy.uploads.push({ ticketId: 'shared', userId: 'demo-self', fileId: 'wxfile://shared', status: 'complete' }); f.data.set(LEGACY, legacy);
  f.data.set('youchong.personalUploadQueue.v1', { version: 1, items: [{ ownerId: 'demo-self', scope: 'personal', localPath: 'wxfile://draft' }] });
  const original = structuredClone(f.data.get(STORAGE_KEY));
  await f.community.call('deleteAccount');
  assert.deepEqual(f.data.get(STORAGE_KEY), original);
  assert.equal(f.data.get(DRAFTS)['personal:personal:demo-self'].text, '原来的私人草稿');
  assert.equal(f.data.get(DRAFTS)['demo:other'].text, '其他账号草稿');
  assert.equal(f.data.get(DRAFTS)['demo:demo-self'], undefined);
  assert.ok(!f.removed.includes('wxfile://shared')); assert.ok(f.data.has('youchong.personalUploadQueue.v1'));
  assert.equal((await f.community.getPrivateLibrary()).posts[0].id, f.post.id);
});

test('community attachment cleanup is owner and environment scoped and retains personal media bytes', async () => {
  const f = await fixture();
  f.data.set(QUEUE, { version: 1, items: [
    { localId: 'current', ownerId: 'demo-self', scope: 'demo', localPath: 'wxfile://unused' },
    { localId: 'private-reference', ownerId: 'demo-self', scope: 'demo', localPath: 'wxfile://draft' },
    { localId: 'other-owner', ownerId: 'other', scope: 'demo', localPath: 'wxfile://other' },
    { localId: 'cloud', ownerId: 'demo-self', scope: 'cloud:one', localPath: 'wxfile://cloud' }
  ] });
  await f.community.discardUploads([]);
  await f.community.clearLocalUploads();
  assert.deepEqual(f.removed, ['wxfile://unused']);
  assert.deepEqual(f.data.get(QUEUE).items.map(item => item.localId), ['other-owner', 'cloud']);
  assert.equal(f.data.get(DRAFTS)['personal:personal:demo-self'].images[0], 'wxfile://draft');
});

test('pet cleanup protects personal references and leaves other owners and environments alone', async () => {
  const f = await fixture();
  const key = 'youchong.petPhotoQueue.v1';
  f.data.set(key, { version: 1, items: [
    { ownerId: 'demo-self', scope: 'demo', localPath: 'wxfile://draft' },
    { ownerId: 'other', scope: 'demo', localPath: 'wxfile://other' },
    { ownerId: 'demo-self', scope: 'cloud:one', localPath: 'wxfile://cloud' }
  ] });
  await clearLocalPetPhotos(f.platform, { ownerId: 'demo-self', scope: 'demo' });
  assert.deepEqual(f.removed, []); assert.equal(f.data.get(key).items.length, 2);
  await assert.rejects(clearLocalPetPhotos(f.platform), { code: 'AUTH_REQUIRED' });
  f.controls.failRead = true;
  assert.equal(personalFileReferenced(f.platform, 'wxfile://unknown'), true, 'unknown references fail closed');
});

test('community attachment cleanup retains a retry record when private references cannot be read', async () => {
  for (const action of ['clear', 'discard']) {
    const f = await fixture();
    const items = [
      { localId: 'unreferenced', ownerId: 'demo-self', scope: 'demo', localPath: 'wxfile://unreferenced', status: 'retry' },
      { localId: 'other', ownerId: 'other', scope: 'demo', localPath: 'wxfile://other', status: 'retry' }
    ];
    f.data.set(QUEUE, { version: 1, items });
    const run = () => action === 'clear' ? f.community.clearLocalUploads() : f.community.discardUploads(['unreferenced']);
    const originalPrivate = structuredClone(f.data.get(STORAGE_KEY)), originalDrafts = structuredClone(f.data.get(DRAFTS));
    f.controls.failRead = true;
    await assert.rejects(run(), { code: 'LOCAL_CLEANUP_FAILED' });
    assert.deepEqual(f.removed, []);
    assert.deepEqual(f.data.get(QUEUE).items, items, 'unknown references must not lose their cleanup record');
    f.controls.failRead = false;
    await run();
    assert.deepEqual(f.removed, ['wxfile://unreferenced']);
    assert.deepEqual(f.data.get(QUEUE).items, [items[1]]);
    assert.deepEqual(f.data.get(STORAGE_KEY), originalPrivate);
    assert.deepEqual(f.data.get(DRAFTS), originalDrafts);
  }
});

test('pet photo cleanup and discard retain unknown files until private storage recovers', async () => {
  for (const action of ['clear', 'discard']) {
    const f = await fixture(), key = 'youchong.petPhotoQueue.v1';
    const items = [
      { localId: 'unreferenced', ownerId: 'demo-self', scope: 'demo', petId: 'pet-unreferenced', localPath: 'wxfile://unreferenced', status: 'retry' },
      { localId: 'other', ownerId: 'other', scope: 'demo', petId: 'pet-other', localPath: 'wxfile://other', status: 'retry' }
    ];
    f.data.set(key, { version: 1, items });
    const photos = createPetPhotos(f.platform, f.community, { productMode: 'community', mode: 'demo' });
    const run = () => action === 'clear' ? clearLocalPetPhotos(f.platform, { ownerId: 'demo-self', scope: 'demo' }) : photos.discard('pet-unreferenced');
    const originalPrivate = structuredClone(f.data.get(STORAGE_KEY)), originalDrafts = structuredClone(f.data.get(DRAFTS));
    f.controls.failRead = true;
    await assert.rejects(run(), { code: 'LOCAL_CLEANUP_FAILED' });
    assert.deepEqual(f.removed, []);
    assert.deepEqual(f.data.get(key).items, items, 'unknown references must not lose their cleanup record');
    f.controls.failRead = false;
    await run();
    assert.deepEqual(f.removed, ['wxfile://unreferenced']);
    assert.deepEqual(f.data.get(key).items, [items[1]]);
    assert.deepEqual(f.data.get(STORAGE_KEY), originalPrivate);
    assert.deepEqual(f.data.get(DRAFTS), originalDrafts);
  }
});

test('retiring a community pet photo cannot remove the same file from the private library', async () => {
  const f = await fixture();
  const legacy = f.data.get(LEGACY), user = legacy.users.find(row => row.id === 'demo-self');
  user.pets = [{ id: 'pet-a', name: '旧社区宠物', type: 'cat', photo: 'wxfile://draft', photoTicketId: 'pet-ticket' }];
  legacy.uploads.push({ ticketId: 'pet-ticket', userId: user.id, purpose: 'pet', petId: 'pet-a', fileId: 'wxfile://draft', status: 'complete', petAttached: true });
  f.data.set(LEGACY, legacy);
  await f.community.call('deletePet', { petId: 'pet-a' });
  assert.deepEqual(f.removed, []);
  assert.equal((await f.community.getPrivateLibrary()).drafts[0].images[0], 'wxfile://draft');
});

test('cloud account cleanup retains the owner captured before a successful deletion', async () => {
  const f = await fixture(); let owner = 'before';
  f.platform.cloud.callFunction = async ({ data }) => ({ result: { ok: true, data: data.action === 'bootstrap'
    ? { mode: 'cloud', user: { id: owner } } : (owner = 'after', { deleted: true }) } });
  f.data.set(QUEUE, { version: 1, items: [
    { localId: 'old', ownerId: 'before', scope: 'cloud:one', localPath: 'wxfile://old' },
    { localId: 'new', ownerId: 'after', scope: 'cloud:one', localPath: 'wxfile://new' }
  ] });
  const api = createApi(f.platform, { productMode: 'community', mode: 'cloud', cloudEnv: 'one' });
  await api.call('deleteAccount');
  assert.deepEqual(f.removed, ['wxfile://old']); assert.equal(f.data.get(QUEUE).items[0].ownerId, 'after');
  assert.ok(f.data.get(DRAFTS)['personal:personal:demo-self']);
});

test('private library page clears hidden data, rejects stale owners and exposes no share callbacks', async () => {
  let definition, readError, current = { ownerId: 'a', user: { nickname: '甲' }, posts: [{ id: 'private-a', text: '甲的私人日记', images: ['wxfile://private-a.png'] }], pets: [], drafts: [] };
  const hidden = [];
  const shared = { register(value) { definition = value; }, api: { async getPrivateLibrary() { if (readError) throw readError; return structuredClone(current); } },
    safe(page, values) { if (!page._closed) Object.assign(page.data, values); }, dateText: () => '', toast() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/social/pages/private-library/index'), 'utf8'), {
    require(name) { return name.includes('_shared') ? shared : name.includes('content-policy') ? require('../miniprogram/data/content-policy') : require('../miniprogram/data/pets'); },
    wx: { hideShareMenu(value) { hidden.push(value); }, stopPullDownRefresh() {} }
  });
  const page = { ...definition, data: structuredClone(definition.data) };
  await page.onLoad();
  assert.equal(page.data.posts[0].id, 'private-a');
  await page.showEntry({ currentTarget: { dataset: { id: 'private-a' } } });
  assert.equal(page.data.selected.text, '甲的私人日记');
  assert.deepEqual(Array.from(page.data.selected.images), ['wxfile://private-a.png']);
  page.onHide(); assert.equal(page.data.selected, null); assert.equal(page.data.posts.length, 0);
  current = { ...current, ownerId: 'b', posts: [] };
  await page.onShow(); assert.equal(page.data.posts.length, 0);
  current = { ...current, ownerId: 'a', posts: [{ id: 'private-a', text: '甲的私人日记' }] };
  await page.showEntry({ currentTarget: { dataset: { id: 'private-a' } } });
  assert.equal(page.data.selected, null); assert.match(page.data.error, /账号已切换/);
  await page.refresh();
  await page.showEntry({ currentTarget: { dataset: { id: 'private-a' } } });
  assert.equal(page.data.selected.text, '甲的私人日记');
  readError = Object.assign(new Error('本机账号已切换'), { code: 'UPLOAD_OWNER_CHANGED' });
  await page.loadMore();
  assert.equal(page.data.posts.length, 0); assert.equal(page.data.selected, null); assert.equal(page._library, null);
  assert.match(page.data.error, /账号已切换/);
  assert.equal(page.onShareAppMessage, undefined); assert.equal(page.onShareTimeline, undefined); assert.ok(hidden.length >= 2);
});
