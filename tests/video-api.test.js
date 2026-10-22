'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../miniprogram/services/api');
const { createDemoService } = require('../miniprogram/services/demo');
const { createPersonalService } = require('../miniprogram/services/personal');
const policy = require('../miniprogram/data/content-policy');

const QUEUE = 'youchong.uploadQueue.v1';
const STORE = 'youban.demo.v1';
const DRAFTS = 'youchong.privateDrafts.v1';
function fixture() {
  const data = new Map(), effects = [];
  const platform = {
    getStorageSync(key) { return data.has(key) ? structuredClone(data.get(key)) : ''; },
    setStorageSync(key, value) { data.set(key, structuredClone(value)); },
    removeStorageSync(key) { data.delete(key); },
    chooseMedia(args) { effects.push('choose'); args.success({ tempFiles: [{ tempFilePath: '/tmp/pet.png', size: 100 }] }); },
    chooseVideo() { effects.push('video-picker'); throw new Error('must never choose video'); },
    saveFile(args) { effects.push('save'); args.success({ savedFilePath: 'wxfile://saved-pet.png' }); },
    removeSavedFile(args) { effects.push(['remove', args.filePath]); args.success({}); },
    cloud: { async callFunction() { effects.push('cloud'); throw new Error('unexpected cloud access'); }, async uploadFile() { effects.push('upload'); throw new Error('unexpected upload'); } }
  };
  return { data, effects, platform, api: config => createApi(platform, config || { mode: 'demo' }) };
}
async function demo(f) {
  const service = createDemoService(f.platform);
  await service.call('bootstrap');
  await service.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  return service;
}
const video = (id, extra = {}) => ({ id, authorId: 'demo-self', circleId: 'circle-neighbors', title: '旧记录', text: '历史附件', images: [], topics: [], animalTypes: [], kind: 'daily', coverIndex: 0, eventId: '', visibility: 'public', createdAt: 9999999999999, video: { url: 'wxfile://old-' + id + '.mp4', durationSeconds: 9 }, ...extra });

test('video capability is fixed off for every API product and blocks writes before picker, storage or cloud work', async () => {
  assert.equal(policy.videoEnabled, false); assert.ok(Object.isFrozen(policy));
  for (const config of [{ mode: 'demo' }, { mode: 'cloud', cloudEnv: 'test' }, { mode: 'cloud', productMode: 'personal' }]) {
    const f = fixture(), api = f.api(config);
    for (const run of [() => api.uploadVideo(), () => api.call('createPost', { text: 'test', video: { url: 'wxfile://old.mp4' } }),
      () => api.call('createPost', { text: 'test', contentType: 'video' }), () => api.call('createUploadTicket', { mediaType: 'video', extension: 'mp4' }),
      () => api.call('createUploadTicket', { mediaType: 'image', extension: 'mp4' })]) await assert.rejects(run(), { code: 'VIDEO_DISABLED' });
    assert.deepEqual(f.effects, []); assert.equal(f.data.size, 0);
  }
});

test('direct demo and personal services cannot bypass the disabled write capability', async () => {
  for (const create of [createDemoService, createPersonalService]) {
    const f = fixture(), service = create(f.platform);
    await assert.rejects(service.call('createPost', { text: 'text', video: { url: 'wxfile://old.mp4' } }), { code: 'VIDEO_DISABLED' });
    await assert.rejects(service.call('createUploadTicket', { mediaType: 'video', extension: 'mp4' }), { code: 'VIDEO_DISABLED' });
    assert.equal(f.data.size, 0);
  }
});

test('legacy video queue entries remain intact and removable, never resume or yield a playable URL', async () => {
  for (const productMode of ['community', 'personal']) {
    const f = fixture(); await demo(f);
    const key = productMode === 'personal' ? 'youchong.personalUploadQueue.v1' : QUEUE;
    const scope = productMode === 'personal' ? 'personal' : 'demo';
    const items = ['retry', 'pending', 'complete'].map((status, i) => ({ localId: 'legacy-' + i, ticketId: 'ticket-' + i, ownerId: 'demo-self', scope, mediaType: 'video', status,
      localPath: 'wxfile://old-' + i + '.mp4', fileId: status === 'complete' ? 'wxfile://old-' + i + '.mp4' : '', video: { durationSeconds: 9 } }));
    items.push({ localId: 'someone-else', ownerId: 'someone-else', scope, mediaType: 'video', status: 'pending' });
    f.data.set(key, { version: 1, items });
    f.data.set(DRAFTS, { [scope + ':demo-self']: { version: 1, text: '不可丢失', visibility: 'private', video: items[0].video } });
    const original = structuredClone(f.data.get(key)), draft = structuredClone(f.data.get(DRAFTS));
    const api = f.api({ mode: 'demo', productMode });
    const restored = await api.resumeUploads();
    assert.equal(restored.video, null); assert.deepEqual(restored.completed, []); assert.deepEqual(restored.pending, []);
    assert.equal(restored.failures.length, 3); assert.ok(restored.failures.every(row => row.code === 'VIDEO_DISABLED' && row.retryable === false && row.mediaType === 'video'));
    assert.deepEqual(f.data.get(key), original); assert.deepEqual(f.data.get(DRAFTS), draft); assert.deepEqual(f.effects, []);
    await assert.rejects(api.call('completeUpload', { ticketId: 'ticket-1', fileId: 'wxfile://old-1.mp4' }), { code: 'VIDEO_DISABLED' });
    const removed = await api.discardUploads(['ticket-1']);
    assert.equal(removed.failures.length, 2); assert.ok(f.data.get(key).items.some(row => row.localId === 'someone-else'));
    assert.deepEqual(f.data.get(DRAFTS), draft);
  }
});

test('text and image publishing still works after a disabled legacy video is explicitly removed', async () => {
  const f = fixture(); await demo(f); const api = f.api();
  f.data.set(QUEUE, { version: 1, items: [{ localId: 'old', ownerId: 'demo-self', scope: 'demo', mediaType: 'video', status: 'pending' }] });
  await api.discardUploads(['old']);
  const selected = await api.uploadImages(1);
  assert.equal(selected.images.length, 1);
  const saved = await api.call('createPost', { circleId: 'circle-neighbors', text: '新图文', images: selected.images });
  assert.equal(saved.post.text, '新图文'); assert.equal(saved.post.video, undefined);
  assert.equal((await api.call('getPost', { id: saved.post.id })).post.images[0], selected.images[0]);
  assert.equal((await api.call('createPost', { circleId: 'circle-neighbors', text: '纯文字' })).post.text, '纯文字');
});

test('demo history is filtered before pagination across all feeds, author, circle, mine, bookmarks and detail without deleting records', async () => {
  const f = fixture(), service = await demo(f);
  const state = f.data.get(STORE);
  const hidden = [video('old-object'), video('old-type', { video: null, contentType: 'video' })];
  state.posts.push(...hidden);
  for (let i = 0; i < 22; i++) state.posts.push(video('text-' + i, { video: null, createdAt: 9999999999000 + i, text: '保留图文' }));
  state.bookmarks.push(...hidden.map(post => ({ userId: 'demo-self', postId: post.id })));
  state.follows.push({ userId: 'demo-self', targetUserId: 'demo-self' });
  f.data.set(STORE, state);
  for (const payload of [{}, { mine: true }, { bookmarked: true }, { feed: 'following' }, { feed: 'circles' }, { authorId: 'demo-self' }]) {
    assert.ok((await service.call('listPosts', payload)).items.every(post => !policy.isVideoPost(post)));
  }
  for (const [action, payload] of [['getCircle', { id: 'circle-neighbors' }], ['getUserProfile', { userId: 'demo-self' }]]) assert.ok((await service.call(action, payload)).posts.every(post => !policy.isVideoPost(post)));
  const first = await service.call('listPosts', { mine: true });
  const last = await service.call('listPosts', { mine: true, cursor: first.nextCursor });
  assert.equal(first.items.length, 20); assert.equal(last.items.length, 2); assert.equal(last.nextCursor, undefined);
  assert.equal(new Set(first.items.concat(last.items).map(row => row.id)).size, 22);
  for (const post of hidden) {
    await assert.rejects(service.call('getPost', { id: post.id }), { code: 'NOT_FOUND' });
    await assert.rejects(service.call('bookmarkPost', { id: post.id, bookmark: true }), { code: 'NOT_FOUND' });
    assert.deepEqual(f.data.get(STORE).posts.find(row => row.id === post.id), post);
  }
  assert.equal((await service.call('bootstrap')).stats.postCount, 22);
  assert.equal((await service.call('bootstrap')).stats.bookmarkCount, 0);
});

test('personal history and private library hide legacy and personal video records while keeping their storage', async () => {
  const f = fixture(); await demo(f);
  const state = f.data.get(STORE), hidden = video('old-personal');
  state.posts.push(hidden, video('text-personal', { video: null })); f.data.set(STORE, state);
  const service = createPersonalService(f.platform); await service.call('bootstrap');
  const personal = f.data.get('youchong.personal.v1');
  personal.accounts[0].posts.push(video('overlay-video', { video: null, contentType: 'video' }));
  personal.accounts[0].bookmarks.push({ userId: 'demo-self', postId: hidden.id });
  f.data.set('youchong.personal.v1', personal);
  const original = structuredClone(f.data.get(STORE));
  assert.deepEqual((await service.call('listPosts', { mine: true })).items.map(row => row.id), ['text-personal']);
  assert.deepEqual((await service.readLibrary('demo-self')).posts.map(row => row.id), ['text-personal']);
  for (const id of ['old-personal', 'overlay-video']) await assert.rejects(service.call('getPost', { id }), { code: 'NOT_FOUND' });
  assert.equal((await service.call('bootstrap')).stats.diaryCount, 1);
  assert.deepEqual(f.data.get(STORE), original);
  assert.ok(f.data.get('youchong.personal.v1').accounts[0].posts.some(row => row.id === 'overlay-video'));
});

test('cloud read filtering follows original cursors across all-video pages and preserves the next partial-page cursor', async () => {
  for (const [action, field] of [['listPosts', 'items'], ['getCircle', 'posts'], ['getUserProfile', 'posts']]) {
    const f = fixture(), calls = [];
    f.platform.cloud.callFunction = async ({ data: { payload } }) => {
      calls.push(payload);
      const data = !payload.cursor ? { [field]: [video('one')], nextCursor: 'opaque-a', user: { id: 'author' } }
        : payload.cursor === 'opaque-a' ? { [field]: [video('two', { video: null, contentType: 'video' })], nextCursor: 'opaque-b' }
        : payload.cursor === 'opaque-b' ? { [field]: [{ id: 'visible-a', images: [] }, video('three')], nextCursor: 'opaque-c' }
        : { [field]: [{ id: 'visible-b', images: [] }] };
      return { result: { ok: true, data } };
    };
    const api = f.api({ mode: 'cloud', cloudEnv: 'test' });
    const first = await api.call(action, { id: 'circle', userId: 'author', query: 'cat' });
    assert.deepEqual(first[field].map(row => row.id), ['visible-a']); assert.equal(first.nextCursor, 'opaque-c');
    assert.deepEqual(calls.map(row => row.cursor), [undefined, 'opaque-a', 'opaque-b']);
    assert.ok(calls.every(row => row.id === 'circle' && row.userId === 'author' && row.query === 'cat'));
    const second = await api.call(action, { cursor: first.nextCursor });
    assert.deepEqual(second[field].map(row => row.id), ['visible-b']); assert.equal(second.nextCursor, undefined);
  }
});

test('cloud video details and repeated opaque cursors are rejected', async () => {
  const f = fixture();
  f.platform.cloud.callFunction = async ({ data: { action } }) => ({ result: { ok: true, data: action === 'getPost' ? { post: video('old-cloud') } : { items: [video('old-cloud')], nextCursor: 'same' } } });
  const api = f.api({ mode: 'cloud' });
  await assert.rejects(api.call('getPost', { id: 'old-cloud' }), { code: 'NOT_FOUND' });
  await assert.rejects(api.call('listPosts'), { code: 'INVALID_RESPONSE' });
});

test('cloud notifications verify post targets before exposing old summaries or covers and preserve paging', async () => {
  const f = fixture(), checked = [];
  const notice = (id, targetId) => ({ id, targetType: 'post', targetId, title: '旧摘要', text: '旧附件', cover: '/assets/old-poster.jpg' });
  f.platform.cloud.callFunction = async ({ data: { action, payload } }) => {
    if (action === 'getPost') {
      checked.push(payload.id);
      if (payload.id === 'missing') return { result: { ok: false, error: { code: 'NOT_FOUND', message: '内容已下架' } } };
      return { result: { ok: true, data: { post: payload.id === 'old-video' ? video('old-video') : { id: payload.id, images: [] } } } };
    }
    const items = !payload.cursor ? [notice('old-a', 'old-video'), notice('old-b', 'missing'), notice('old-c', 'old-video')]
      : [notice('visible', 'picture'), { id: 'system', targetType: 'system', text: '正常提醒' }];
    return { result: { ok: true, data: { items, nextCursor: payload.cursor ? undefined : 'next-page', unreadCount: 5, categoryUnread: { comments: 4, system: 1, interactions: 0, follows: 0 } } } };
  };
  const api = f.api({ mode: 'cloud' });
  const result = await api.call('listMessages');
  assert.deepEqual(result.items.map(item => item.id), ['visible', 'system']);
  assert.deepEqual(checked.sort(), ['missing', 'old-video', 'picture']);
  assert.equal(result.nextCursor, undefined);
  assert.equal(result.unreadCount, null, 'legacy totals cannot be presented as verified after targets are removed');
  assert.equal(result.categoryUnread, null);
});

test('cloud target verification fails closed when the target cannot be checked', async () => {
  const f = fixture();
  f.platform.cloud.callFunction = async ({ data: { action } }) => {
    if (action === 'getPost') throw new Error('offline');
    return { result: { ok: true, data: { items: [{ id: 'old', targetType: 'post', targetId: 'unknown', text: 'potential old summary' }] } } };
  };
  await assert.rejects(f.api({ mode: 'cloud' }).call('listMessages'), { code: 'NETWORK_ERROR' });
});
