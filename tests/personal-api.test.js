'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../miniprogram/services/api');
const { createPersonalService, STORAGE_KEY } = require('../miniprogram/services/personal');
const { createPetPhotos } = require('../miniprogram/services/pet-photos');
const { CURATED_POSTS } = require('../miniprogram/data/curated');
const { records: places } = require('../miniprogram/data/nearby-catalogue');

const legacyKey = 'youban.demo.v1';
const queueKey = 'youchong.personalUploadQueue.v1';
const petQueueKey = 'youchong.personalPetPhotoQueue.v1';
const draftKey = 'youchong.privateDrafts.v1';
const config = { productMode: 'personal', mode: 'cloud', cloudEnv: 'must-not-connect' };
const time = Date.parse('2026-10-14T10:00:00+08:00');

function fixture() {
  const data = new Map(), files = new Set(), removed = [], cloudCalls = [];
  const state = { failWrite: false, failRemove: false, removeHook: null, selectedVideo: false };
  const user = { id: 'owner-a', nickname: '自己的昵称', avatar: '/assets/avatar-6.png', publicProfile: true, showPet: true,
    neighborVisible: true, residenceSharing: true, residenceCell: { x: 1, y: 1 }, isAdmin: true, pet: { name: '小花', type: 'cat' } };
  const legacy = { version: 1, currentUserId: user.id, users: [user, { id: 'owner-b', nickname: '另一个本机账号' }], posts: [
    { id: 'old-own', authorId: user.id, visibility: 'public', circleId: 'circle-cats', eventId: 'old-event', topics: ['问问大家'], title: '旧本人记录', text: '只在本人日记可见', images: [], createdAt: 5 },
    { id: 'other-post', authorId: 'owner-b', visibility: 'public', title: '其他用户', text: '不能显示', images: [], createdAt: 4 },
    { id: 'spoof-editor', authorId: 'fake', isEditorial: true, catalogManaged: true, text: '伪装精选', images: [], createdAt: 3 },
    { id: CURATED_POSTS[0].id, authorId: 'fake', text: '覆盖可信精选', images: ['https://bad.invalid/photo.jpg'], catalogManaged: true }
  ], bookmarks: [{ userId: user.id, postId: CURATED_POSTS[0].id }, { userId: 'owner-b', postId: CURATED_POSTS[1].id }],
  place_bookmarks: [], place_visits: [], uploads: [], settings: { areas: ['莘庄'] }, messages: [{ text: '旧消息' }] };
  data.set(legacyKey, structuredClone(legacy));
  const platform = {
    getStorageSync(key) { return data.has(key) ? structuredClone(data.get(key)) : ''; },
    setStorageSync(key, value) { if (state.failWrite) throw new Error('disk full'); data.set(key, structuredClone(value)); },
    removeStorageSync(key) { if (state.failWrite) throw new Error('disk full'); data.delete(key); },
    chooseMedia(options) { state.selectedVideo = options.mediaType.includes('video'); options.success({ tempFiles: [{ tempFilePath: state.selectedVideo ? '/tmp/pet.mp4' : '/tmp/pet.png', size: 300, duration: 8, width: 640, height: 480 }] }); },
    saveFile(options) { const savedFilePath = 'wxfile://saved-' + files.size + '-' + options.tempFilePath.split('/').pop(); files.add(savedFilePath); options.success({ savedFilePath }); },
    getSavedFileList(options) { options.success({ fileList: [...files].map(filePath => ({ filePath })) }); },
    getFileInfo(options) { options.success({ size: 1024 }); },
    getVideoInfo(options) { options.success({ duration: 8, width: 640, height: 480 }); },
    removeSavedFile(options) {
      if (state.removeHook) state.removeHook(options.filePath);
      if (state.failRemove) return options.fail({ errMsg: 'disk busy' });
      files.delete(options.filePath); removed.push(options.filePath); options.success({});
    },
    cloud: {
      init() { cloudCalls.push('init'); throw new Error('cloud forbidden'); },
      async callFunction() { cloudCalls.push('call'); throw new Error('cloud forbidden'); },
      async uploadFile() { cloudCalls.push('upload'); throw new Error('cloud forbidden'); }
    }
  };
  const api = () => createApi(platform, config, { now: () => time });
  return { data, files, removed, cloudCalls, state, user, legacy, platform, api };
}

test('personal mode forces local owner identity and denies every social or unknown action before dispatch', async () => {
  const f = fixture(), api = f.api();
  const boot = await api.call('bootstrap');
  assert.equal(boot.mode, 'personal'); assert.equal(boot.user.nickname, f.user.nickname);
  assert.equal(boot.user.verification.status, 'not_required'); assert.equal(boot.user.publicProfile, false);
  assert.equal(boot.user.residenceCell, null); assert.equal(boot.user.isAdmin, false);
  for (const field of ['circles', 'messages', 'unreadCount']) assert.equal(boot[field], undefined);
  assert.deepEqual(Object.keys(boot.stats).sort(), ['bookmarkCount', 'diaryCount', 'petCount', 'placeBookmarkCount', 'postCount', 'visitCount'].sort());
  for (const action of ['verifyPhone', 'demoVerifyIdentity', 'listCircles', 'joinCircle', 'listNeighbors', 'getUserProfile', 'followUser', 'listFollowing',
    'addComment', 'likePost', 'setPostVisibility', 'listEvents', 'getEvent', 'joinEvent', 'createEvent', 'listMessages', 'sendMessage', 'createGroup',
    'submitNearbySubmission', 'listNearbySubmissions', 'reviewNearbySubmission', 'submitPlaceCorrection', 'savePlace', 'initialize', 'deleteAll', '__proto__']) {
    await assert.rejects(api.call(action, {}), { code: 'PERSONAL_MODE_ONLY' }, action);
  }
  assert.deepEqual(f.cloudCalls, []); assert.deepEqual(f.data.get(legacyKey), f.legacy);
});

test('editorial reads use canonical contents and never user-writable editorial flags or same-ID cached rows', async () => {
  const f = fixture(), api = f.api();
  const result = await api.call('listPosts');
  assert.ok(result.items.length > 0); assert.ok(result.items.every(post => post.isEditorial && !post.isMine));
  assert.ok(result.items.every(post => !['old-own', 'other-post', 'spoof-editor'].includes(post.id)));
  const actual = (await api.call('getPost', { id: CURATED_POSTS[0].id })).post;
  assert.equal(actual.text, CURATED_POSTS[0].text); assert.deepEqual(actual.images, CURATED_POSTS[0].images || []);
  assert.equal(actual.canShare, false); assert.equal(actual.author.id, '');
  assert.deepEqual(actual.source, CURATED_POSTS[0].source);
  assert.deepEqual(actual.imageCredits, CURATED_POSTS[0].imageCredits || []);
  for (const id of ['other-post', 'spoof-editor']) await assert.rejects(api.call('getPost', { id }), { code: 'NOT_FOUND' });
  await assert.rejects(api.call('listPosts', { authorId: 'owner-b' }), { code: 'PERSONAL_MODE_ONLY' });
  const mine = (await api.call('listPosts', { mine: true })).items;
  assert.equal(mine.length, 1); assert.equal(mine[0].visibility, 'private'); assert.equal(mine[0].circle, null); assert.equal(mine[0].event, null);
  assert.deepEqual((await api.call('getPost', { id: 'old-own' })).comments, []);
  assert.deepEqual(f.data.get(legacyKey), f.legacy);
});

test('private diaries persist without verification and legacy deletions only add local tombstones', async () => {
  const f = fixture(), api = f.api();
  for (const visibility of ['public', 'friends']) await assert.rejects(api.call('createPost', { text: '不允许发布', visibility }), { code: 'PERSONAL_MODE_ONLY' });
  const { post } = await api.call('createPost', { text: '我的新日记', visibility: 'private', circleId: 'evil', eventId: 'evil', topics: ['问问大家'], authorId: 'owner-b' });
  assert.equal(post.visibility, 'private'); assert.equal(post.author.id, f.user.id); assert.equal(post.circleId, ''); assert.equal(post.eventId, ''); assert.deepEqual(post.topics, []);
  assert.equal((await f.api().call('getPost', { id: post.id })).post.text, '我的新日记');
  assert.equal((await api.call('listPosts', { mine: true })).items.length, 2);
  assert.ok(!(await api.call('listPosts')).items.some(item => item.id === post.id));
  await api.call('deletePost', { id: 'old-own' });
  await assert.rejects(f.api().call('getPost', { id: 'old-own' }), { code: 'NOT_FOUND' });
  await assert.rejects(api.call('deletePost', { id: CURATED_POSTS[0].id }), { code: 'NOT_FOUND' });
  assert.deepEqual(f.data.get(legacyKey), f.legacy);
});

test('bookmarks are private and own bookmarked diaries remain retrievable without notifications', async () => {
  const f = fixture(), api = f.api();
  await api.call('bookmarkPost', { id: 'old-own', bookmark: true });
  assert.deepEqual(new Set((await api.call('listPosts', { bookmarked: true })).items.map(post => post.id)), new Set(['old-own', CURATED_POSTS[0].id]));
  await assert.rejects(api.call('bookmarkPost', { id: 'other-post', bookmark: true }), { code: 'NOT_FOUND' });
  assert.equal((await api.call('getMe')).stats.bookmarkCount, 2);
  assert.deepEqual(f.data.get(legacyKey), f.legacy);
});

test('pets and pet photos remain local even when the ordinary mode is cloud', async () => {
  const f = fixture(), api = f.api();
  assert.equal((await api.call('listPets')).pets[0].name, '小花');
  const saved = await api.call('savePet', { name: '小狗', type: 'dog' });
  const pet = saved.pets.find(item => item.name === '小狗');
  const photos = createPetPhotos(f.platform, api, config);
  const result = await photos.select(pet.id);
  assert.match(result.pets.find(item => item.id === pet.id).photo, /^wxfile:/);
  assert.deepEqual(f.cloudCalls, []);
  assert.deepEqual(f.data.get(legacyKey), f.legacy);
  await assert.rejects(api.call('updateProfile', { publicProfile: true }), { code: 'PERSONAL_MODE_ONLY' });
});

test('public places ignore legacy user overrides and private visits cannot link back to public posts', async () => {
  const f = fixture(), venue = places.find(place => place.type === 'place' && place.active !== false);
  const old = f.data.get(legacyKey); old.place_records = [{ ...venue, title: '旧用户篡改地点' }, { id: 'nearby-user-entry', type: 'place', title: '用户投稿' }];
  old.place_visits = [{ id: 'old-visit', userId: f.user.id, placeId: venue.id, visitedOn: '2026-10-12', createdAt: 1, note: '私人笔记', postId: 'other-post' }];
  f.data.set(legacyKey, structuredClone(old));
  const api = f.api();
  assert.equal((await api.call('getPlace', { id: venue.id })).place.title, venue.title);
  await assert.rejects(api.call('getPlace', { id: 'nearby-user-entry' }), { code: 'NOT_FOUND' });
  assert.equal((await api.call('listPlaceVisits')).items[0].postId, undefined);
  const { visit } = await api.call('recordPlaceVisit', { placeId: venue.id, visitedOn: '2026-10-14', note: '只给自己看' });
  const { post } = await api.call('createPost', { text: '私人出行日记', placeId: venue.id, visitId: visit.id });
  assert.equal(post.place.title, venue.title); assert.equal(post.visitId, visit.id);
  assert.ok((await api.call('listPlaceVisits')).items.every(row => !row.postId));
  await api.call('bookmarkPlace', { id: venue.id, bookmark: true });
  assert.ok((await api.call('listPlaces', { bookmarked: true })).items.some(row => row.id === venue.id));
  assert.deepEqual(f.data.get(legacyKey), old);
});

test('image and video queues use persistent local media with no phone or cloud service', async () => {
  const f = fixture(), api = f.api();
  const image = await api.uploadImages(1); assert.equal(image.images.length, 1);
  assert.deepEqual((await f.api().resumeUploads()).images, image.images);
  assert.equal(f.data.get(queueKey).items[0].scope, 'personal');
  assert.equal(f.data.has('youchong.uploadQueue.v1'), false);
  const photoPost = await api.call('createPost', { images: image.images, visibility: 'private' });
  assert.equal(photoPost.post.images[0], image.images[0]); assert.ok(f.files.has(image.images[0]));
  const clip = await api.uploadVideo(); assert.ok(clip.video); assert.equal(clip.video.durationSeconds, 8);
  assert.equal((await f.api().resumeUploads()).video.url, clip.video.url);
  const { post } = await api.call('createPost', { video: clip.video, visibility: 'private' });
  assert.equal(post.video.url, clip.video.url);
  assert.deepEqual(f.cloudCalls, []);
  const ticket = await api.call('createUploadTicket', { extension: 'png' });
  await assert.rejects(api.call('completeUpload', { ticketId: ticket.ticketId, fileId: 'cloud://secret/image.png' }), { code: 'UPLOAD_UNAVAILABLE' });
  await assert.rejects(api.call('completeUpload', { ticketId: ticket.ticketId, fileId: 'https://unknown.invalid/image.png' }), { code: 'UPLOAD_UNAVAILABLE' });
});

test('unavailable storage fails without network fallback or a phantom diary', async () => {
  const f = fixture(), api = f.api(); await api.call('bootstrap');
  f.state.failWrite = true;
  await assert.rejects(api.call('createPost', { text: '不能假装保存成功' }), { code: 'STORAGE_UNAVAILABLE' });
  f.state.failWrite = false;
  assert.equal((await api.call('listPosts', { mine: true })).items.length, 1);
  const service = createPersonalService({ getStorageSync() { throw new Error('disk failed'); } });
  await assert.rejects(service.call('getMe'), { code: 'STORAGE_UNAVAILABLE' });
  await assert.rejects(service.call('addComment'), { code: 'PERSONAL_MODE_ONLY' });
  assert.deepEqual(f.cloudCalls, []);
});

test('deleting personal data preserves old community content, drafts, queues and files', async () => {
  const f = fixture(), api = f.api();
  const oldQueue = { version: 1, items: [{ ownerId: f.user.id, scope: 'demo', localPath: 'wxfile://legacy-attachment', status: 'complete' }] };
  f.data.set('youchong.uploadQueue.v1', structuredClone(oldQueue)); f.data.set('youchong.petPhotoQueue.v1', structuredClone(oldQueue));
  f.data.set(draftKey, { 'demo:owner-a': { text: '旧草稿' }, 'personal:personal:owner-a': { text: '本人新草稿' }, 'personal:personal:owner-b': { text: '其他账号草稿' } });
  const image = await api.uploadImages(1); await api.call('createPost', { text: '新日记', images: image.images });
  const result = await api.call('deleteAccount'); assert.equal(result.deleted, true); assert.equal(result.localCleanup, undefined);
  assert.equal((await f.api().call('listPosts', { mine: true })).items.length, 0);
  assert.equal((await api.call('listPets')).pets.length, 0);
  assert.deepEqual(f.data.get(legacyKey), f.legacy);
  assert.deepEqual(f.data.get('youchong.uploadQueue.v1'), oldQueue); assert.deepEqual(f.data.get('youchong.petPhotoQueue.v1'), oldQueue);
  assert.deepEqual(f.data.get(draftKey), { 'demo:owner-a': { text: '旧草稿' }, 'personal:personal:owner-b': { text: '其他账号草稿' } });
  assert.ok(!f.removed.includes('wxfile://legacy-attachment')); assert.ok(!f.files.has(image.images[0]));
});

test('account switch during deletion cannot redirect cleanup to the new owner', async () => {
  const f = fixture(), api = f.api(); await api.call('bootstrap');
  const personal = f.data.get(STORAGE_KEY); personal.accounts.push({ ...structuredClone(personal.accounts[0]), userId: 'owner-b', user: { id: 'owner-b', nickname: 'B' } });
  f.data.set(STORAGE_KEY, personal);
  f.data.set(queueKey, { version: 1, items: [{ localId: 'a', ownerId: 'owner-a', scope: 'personal', localPath: 'wxfile://a' }] });
  f.data.set(petQueueKey, { version: 1, items: [{ localId: 'b', ownerId: 'owner-b', scope: 'personal', localPath: 'wxfile://b' }] });
  f.data.set(draftKey, { 'personal:personal:owner-a': { text: 'A' }, 'personal:personal:owner-b': { text: 'B' } });
  f.state.removeHook = () => { const old = f.data.get(legacyKey); old.currentUserId = 'owner-b'; f.data.set(legacyKey, old); };
  await api.call('deleteAccount');
  assert.deepEqual(f.removed, ['wxfile://a']);
  assert.equal(f.data.get(petQueueKey).items[0].ownerId, 'owner-b');
  assert.deepEqual(f.data.get(draftKey), { 'personal:personal:owner-b': { text: 'B' } });
});

test('consuming an attached local image does not consume another owner queue with the same path', async () => {
  const f = fixture(), api = f.api(); const selected = await api.uploadImages(1);
  const queue = f.data.get(queueKey); queue.items.push({ ...queue.items[0], localId: 'other-owner', ownerId: 'owner-b' }); f.data.set(queueKey, queue);
  await api.call('createPost', { images: selected.images });
  assert.deepEqual(f.data.get(queueKey).items.map(row => row.ownerId), ['owner-b']);
});

test('failed personal file cleanup is retryable without reviving cleared legacy data', async () => {
  const f = fixture(), api = f.api(); const selected = await api.uploadImages(1); await api.call('createPost', { images: selected.images });
  f.state.failRemove = true;
  const result = await api.call('deleteAccount'); assert.equal(result.localCleanup.status, 'failed');
  assert.equal((await api.call('listPosts', { mine: true })).items.length, 0);
  f.state.failRemove = false; await api.clearLocalUploads();
  assert.ok(!f.files.has(selected.images[0])); assert.deepEqual(f.data.get(legacyKey), f.legacy);
});

test('discarding a stale queue after successful diary commit cannot delete its attached file', async () => {
  const f = fixture(), api = f.api(); const selected = await api.uploadImages(1);
  const write = f.platform.setStorageSync; let failQueueOnce = true;
  f.platform.setStorageSync = (key, value) => {
    if (key === queueKey && failQueueOnce) { failQueueOnce = false; throw new Error('one interrupted queue write'); }
    write(key, value);
  };
  const saved = await api.call('createPost', { text: '已成功保存的日记', images: selected.images });
  assert.equal(saved.localCleanup.status, 'failed');
  await api.discardUploads(selected.completed.map(item => item.ticketId));
  await api.clearLocalUploads();
  assert.ok(f.files.has(selected.images[0]));
  assert.equal((await api.call('getPost', { id: saved.post.id })).post.images[0], selected.images[0]);
  assert.ok(!f.removed.includes(selected.images[0]));
});

test('new tickets cannot cause physical removal of a file still referenced by legacy records', async () => {
  const f = fixture(), path = 'wxfile://legacy-shared';
  const legacy = f.data.get(legacyKey); legacy.posts[0].images = [path]; f.data.set(legacyKey, legacy); f.files.add(path);
  const api = f.api(), ticket = await api.call('createUploadTicket', { extension: 'png' });
  await api.call('completeUpload', { ticketId: ticket.ticketId, fileId: path });
  await api.call('createPost', { images: [path] });
  await api.call('deleteAccount');
  assert.ok(f.files.has(path)); assert.ok(!f.removed.includes(path)); assert.deepEqual(f.data.get(legacyKey), legacy);
});

test('pet replacement removes unreferenced prior photo only after the new photo is saved', async () => {
  const f = fixture(), api = f.api();
  const petId = (await api.call('listPets')).pets[0].id;
  const photos = createPetPhotos(f.platform, api, config);
  const first = (await photos.select(petId)).pets[0].photo;
  const second = (await photos.select(petId)).pets[0].photo;
  assert.notEqual(first, second); assert.ok(f.removed.includes(first)); assert.ok(f.files.has(second));
  const read = (await api.call('listPets')).pets[0]; assert.equal(read.photo, second);
});

test('complete image queue snapshots cannot be returned to an owner who switched during resume', async () => {
  const f = fixture(), api = f.api(); await api.uploadImages(1);
  const read = f.platform.getStorageSync; let switchOnce = true;
  f.platform.getStorageSync = key => {
    const result = read(key);
    if (key === queueKey && switchOnce) {
      switchOnce = false;
      queueMicrotask(() => { const legacy = f.data.get(legacyKey); legacy.currentUserId = 'owner-b'; f.data.set(legacyKey, legacy); });
    }
    return result;
  };
  await assert.rejects(api.resumeUploads(), { code: 'UPLOAD_OWNER_CHANGED' });
  assert.equal((await api.call('getMe')).user.id, 'owner-b');
  assert.deepEqual((await api.resumeUploads()).images, []);
});

test('discard excludes only selected tickets and preserves other drafts of the same local owner', async () => {
  const f = fixture(), api = f.api(); const selected = await api.uploadImages(1), path = selected.images[0];
  const queue = f.data.get(queueKey);
  queue.items.push({ ...queue.items[0], localId: 'same-owner-other-draft', ticketId: 'other-draft-ticket' }); f.data.set(queueKey, queue);
  await api.discardUploads(selected.completed.map(item => item.ticketId));
  assert.ok(f.files.has(path)); assert.equal(f.data.get(queueKey).items.filter(item => item.status !== 'consumed').length, 1);
  f.data.set(draftKey, { 'personal:personal:owner-a': { images: [path] } });
  await api.discardUploads(['other-draft-ticket']);
  assert.ok(f.files.has(path), 'a separate still-saved private draft retains its file');
  await api.call('deleteAccount');
  assert.ok(!f.files.has(path), 'explicit account clearing also removes that owner draft references');
});

test('discarded attachments remain retryable until the last saved draft releases them', async () => {
  for (const retry of ['clearLocalUploads', 'resumeUploads']) {
    const f = fixture(), api = f.api(), selected = await api.uploadImages(1), path = selected.images[0];
    f.data.set(draftKey, { 'personal:personal:owner-a': { images: [path] } });
    await api.discardUploads(selected.completed.map(item => item.ticketId));
    assert.ok(f.files.has(path));
    assert.equal(f.data.get(queueKey).items[0].status, 'consumed');
    const hidden = await api.resumeUploads();
    assert.deepEqual(hidden.images, []); assert.deepEqual(hidden.failures, []);
    await api.clearLocalUploads();
    assert.ok(f.files.has(path)); assert.equal(f.data.get(queueKey).items.length, 1, 'protected cleanup record survives a cleanup attempt');
    f.data.set(draftKey, {});
    await f.api()[retry]();
    assert.ok(!f.files.has(path), retry + ' removes an orphan after a restart');
    assert.deepEqual((f.data.get(queueKey) || { items: [] }).items, []);
    assert.deepEqual(f.data.get(legacyKey), f.legacy);
  }
});

test('discarded cleanup protects saved diaries, pet photos and historical community references', async () => {
  const f = fixture(), api = f.api(), selected = await api.uploadImages(3);
  // The fixture selects one file at a time; each is independently retained.
  const first = selected.images[0];
  const second = (await api.uploadImages(1)).images[1];
  const third = (await api.uploadImages(1)).images[2];
  const queue = f.data.get(queueKey);
  await api.call('createPost', { images: [first] });
  const state = f.data.get(STORAGE_KEY);
  state.accounts[0].user.pets[0].photo = second; f.data.set(STORAGE_KEY, state);
  const legacy = f.data.get(legacyKey); legacy.posts[0].images = [third]; f.data.set(legacyKey, legacy);
  f.data.set(queueKey, queue); // Interrupted post-commit queue cleanup.
  await api.discardUploads(queue.items.map(item => item.ticketId));
  await api.clearLocalUploads(); await api.resumeUploads();
  assert.ok([first, second, third].every(path => f.files.has(path)));
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.data.get(legacyKey), legacy);
});

test('interrupted discarded-file cleanup stays hidden and can be retried by resuming uploads', async () => {
  const f = fixture(), api = f.api(), selected = await api.uploadImages(1), path = selected.images[0];
  f.state.failRemove = true;
  await assert.rejects(api.discardUploads(selected.completed.map(item => item.ticketId)), { code: 'LOCAL_CLEANUP_FAILED' });
  assert.ok(f.files.has(path));
  assert.deepEqual(await api.resumeUploads(), { images: [], video: null, completed: [], pending: [], failures: [] });
  f.state.failRemove = false;
  await f.api().resumeUploads();
  assert.ok(!f.files.has(path));
});

test('saving a recovered draft transfers its deferred attachment to the diary without leaking a cleanup reference', async () => {
  const f = fixture(), api = f.api(), selected = await api.uploadImages(1), path = selected.images[0];
  f.data.set(draftKey, { 'personal:personal:owner-a': { images: [path] } });
  await api.discardUploads(selected.completed.map(item => item.ticketId));
  const { post } = await api.call('createPost', { images: [path] });
  f.data.set(draftKey, {});
  assert.deepEqual(f.data.get(queueKey).items, []);
  assert.ok(f.files.has(path));
  await api.call('deletePost', { id: post.id });
  assert.ok(!f.files.has(path));
});

test('clearing personal data hides protected queued attachments while retaining legacy media bytes', async () => {
  const f = fixture(), api = f.api(), selected = await api.uploadImages(1), path = selected.images[0];
  const legacy = f.data.get(legacyKey); legacy.posts[0].images = [path]; f.data.set(legacyKey, legacy);
  await api.call('deleteAccount');
  assert.ok(f.files.has(path));
  assert.equal(f.data.get(queueKey).items[0].status, 'consumed');
  assert.deepEqual((await api.resumeUploads()).images, []);
  assert.deepEqual(f.data.get(legacyKey), legacy);
});

test('discarding a pet-photo ticket cannot remove the same owner diary attachment', async () => {
  const f = fixture(), api = f.api(); const selected = await api.uploadImages(1), path = selected.images[0];
  const petId = (await api.call('listPets')).pets[0].id;
  const ticket = await api.call('createPetUploadTicket', { petId, extension: 'png' });
  await api.call('completeUpload', { ticketId: ticket.ticketId, fileId: path });
  f.data.set(petQueueKey, { version: 1, items: [{ localId: 'pet-selection', ownerId: 'owner-a', scope: 'personal', petId, ticketId: ticket.ticketId, localPath: path, status: 'retry' }] });
  await createPetPhotos(f.platform, api, config).discard(petId);
  assert.ok(f.files.has(path)); assert.equal(f.data.get(queueKey).items.length, 1);
  await api.discardUploads(selected.completed.map(item => item.ticketId));
  assert.ok(!f.files.has(path));
});
