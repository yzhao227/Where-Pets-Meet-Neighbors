'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../miniprogram/pages/_shared');
const drafts = require('../miniprogram/pages/_drafts');
const { STORAGE_KEY } = require('../miniprogram/services/personal');

const flush = () => new Promise(resolve => setImmediate(resolve));
const input = value => ({ detail: { value } });
const tap = id => ({ currentTarget: { dataset: { id } } });

// Exercise the shipped personal controllers with the real personal service.
// Storage, native navigation and uploads exist only in this in-memory platform.
async function fixture(t) {
  assert.equal(shared.personalMode, true, 'this suite validates the active personal product');
  const store = new Map();
  const files = new Set(), controls = { failDraftWrite: false }; let fileSequence = 0;
  const effects = { calls: [], navigations: [], shares: [], toasts: [] };
  const pages = [];
  const apiKeys = ['call', 'getFeedVersion', 'uploadImages', 'uploadVideo', 'resumeUploads', 'discardUploads', 'clearLocalUploads'];
  const previous = { wx: global.wx, Page: global.Page, api: Object.fromEntries(apiKeys.map(key => [key, shared.api[key]])) };
  global.wx = {
    getStorageSync(key) { return structuredClone(store.get(key) || ''); },
    setStorageSync(key, value) { if (key === drafts.KEY && controls.failDraftWrite) throw new Error('draft disk full'); store.set(key, structuredClone(value)); },
    removeStorageSync(key) { store.delete(key); },
    showToast(options) { effects.toasts.push(options.title); },
    hideShareMenu(options) { effects.shares.push({ type: 'hide', ...options }); },
    showShareMenu(options) { effects.shares.push({ type: 'show', ...options }); },
    showModal(options) { options.success({ confirm: true }); },
    navigateTo(options) { effects.navigations.push(options.url); },
    navigateBack() { effects.navigations.push('back'); },
    switchTab(options) { effects.navigations.push(options.url); },
    hideKeyboard() {}, stopPullDownRefresh() {},
    chooseMedia(options) { const video = options.mediaType.includes('video'); options.success({ tempFiles: [{ tempFilePath: '/memory/pet.' + (video ? 'mp4' : 'png'), size: 1000, duration: 8, width: 640, height: 480 }] }); },
    saveFile(options) { const savedFilePath = 'wxfile://memory-' + (++fileSequence) + '-' + options.tempFilePath.split('/').pop(); files.add(savedFilePath); options.success({ savedFilePath }); },
    getSavedFileList(options) { options.success({ fileList: [...files].map(filePath => ({ filePath })) }); },
    getFileInfo(options) { options.success({ size: 1000 }); },
    getVideoInfo(options) { options.success({ duration: 8, width: 640, height: 480 }); },
    removeSavedFile(options) { files.delete(options.filePath); options.success({}); }
  };
  const api = shared.api.createApi(global.wx, { productMode: 'personal', mode: 'demo' });
  apiKeys.forEach(key => { shared.api[key] = api[key]; });
  shared.api.call = async (action, payload) => {
    effects.calls.push({ action, payload: structuredClone(payload) });
    return api.call(action, payload);
  };
  async function mount(name, options = {}) {
    let definition;
    global.Page = value => { definition = value; };
    const source = require.resolve('../miniprogram/pages/' + name + '/index');
    delete require.cache[source]; require(source);
    const page = { ...definition, data: structuredClone(definition.data), setData(values, callback) {
      assert.equal(!!this._closed, false, 'no state writes after unloading');
      Object.assign(this.data, values); if (callback) callback();
    } };
    pages.push(page); page.onLoad(options);
    for (let count = 0; count < 60; count++) {
      await flush();
      if (!page.data.loading && !page.data.uploadsBusy && !page.data.placesBusy) break;
    }
    assert.equal(page.data.loading, false, name + ' finishes loading');
    assert.equal(page.data.error, '', name + ' loads without unavailable social fields');
    assert.equal(page.data.personalMode, true);
    assert.equal(page.onShareAppMessage, undefined, name + ' does not expose sharing');
    return page;
  }
  t.after(async () => {
    for (const page of pages) if (!page._closed) page.onUnload();
    await flush();
    global.wx = previous.wx; global.Page = previous.Page;
    Object.assign(shared.api, previous.api);
  });
  return { api, mount, store, effects, files, controls };
}

test('removing personal photos, videos and entire drafts deletes unreferenced saved files', async t => {
  const f = await fixture(t);
  for (const operation of ['image', 'video', 'draft']) {
    const page = await f.mount('compose');
    if (operation === 'video') await page.uploadVideo(); else await page.upload();
    const file = operation === 'video' ? page.data.video.url : page.data.images[0];
    assert.ok(f.files.has(file));
    page.input(input('保留的正文'));
    if (operation === 'image') await page.removeImage({ currentTarget: { dataset: { index: 0 } } });
    else if (operation === 'video') await page.removeVideo();
    else await page.clearDraft();
    assert.ok(!f.files.has(file), operation + ' clears its local file after updating the draft');
    assert.equal(page.data.attachmentCount, 0);
    assert.deepEqual((await f.api.resumeUploads()).images, []);
    assert.equal((await f.api.resumeUploads()).video, null);
    if (operation !== 'draft') assert.equal(drafts.read(page._draftOwner).value.text, '保留的正文');
    page.onUnload();
  }
});

test('failed personal draft writes retain recoverable text and media until a later successful removal', async t => {
  const f = await fixture(t);
  for (const clearEntireDraft of [false, true]) {
    const page = await f.mount('compose');
    await page.upload(); page.input(input('写入失败也要保留这段正文'));
    const file = page.data.images[0], original = structuredClone(drafts.read(page._draftOwner).value);
    f.controls.failDraftWrite = true;
    if (clearEntireDraft) await page.clearDraft();
    else await page.removeImage({ currentTarget: { dataset: { index: 0 } } });
    assert.ok(page.data.draftError);
    assert.ok(f.files.has(file));
    assert.deepEqual(drafts.read(page._draftOwner).value, original);
    assert.equal(f.store.get('youchong.personalUploadQueue.v1').items[0].status, 'consumed');
    assert.deepEqual((await f.api.resumeUploads()).images, [], 'discarded queue entries do not reappear as new attachments');
    page.onUnload();
    f.controls.failDraftWrite = false;
    const restored = await f.mount('compose');
    assert.equal(restored.data.text, original.text);
    assert.deepEqual(restored.data.images, [file], 'the still-saved draft recovers its original attachment');
    await restored.clearDraft();
    assert.ok(!f.files.has(file));
    restored.onUnload();
  }
});

test('personal editor saves a private diary without verification or circles and preserves the earlier sharing draft', async t => {
  const f = await fixture(t);
  const oldDraft = { version: 1, text: '原分享草稿不可修改', visibility: 'public', circleId: 'legacy-circle' };
  f.store.set(drafts.KEY, { 'demo:demo-self': oldDraft });
  const page = await f.mount('compose', { circleId: 'legacy-circle' });
  assert.equal(page._draftOwner, 'personal:personal:demo-self');
  assert.equal(page._verified, true);
  assert.deepEqual(page.data.circles, []);
  assert.equal(page.data.visibility, 'private');
  assert.equal(page.data.text, '');
  page.chooseVisibility(input(0)); page.chooseCircle(input(0)); page.chooseEvent(input(0));
  assert.equal(page.data.visibility, 'private');
  page.inputTitle(input('今天的可爱')); page.input(input('只属于自己的日记正文'));
  assert.equal(f.store.get(drafts.KEY)[page._draftOwner].text, '只属于自己的日记正文');
  assert.deepEqual(f.store.get(drafts.KEY)['demo:demo-self'], oldDraft);

  // A stale view binding cannot restore the old publication parameters.
  Object.assign(page.data, { visibility: 'public', selectedTopics: ['旧话题'], selectedEventId: 'old-event' });
  await page.submit();
  const payload = f.effects.calls.find(row => row.action === 'createPost').payload;
  assert.equal(payload.visibility, 'private');
  assert.equal(payload.circleId, undefined); assert.equal(payload.eventId, undefined);
  assert.deepEqual(payload.topics, []);
  assert.equal(page.data.submitError, ''); assert.equal(page.data.visibility, 'private');
  assert.deepEqual(f.store.get(drafts.KEY)['demo:demo-self'], oldDraft);
  assert.equal(f.store.get(drafts.KEY)[page._draftOwner], undefined);
  const mine = await f.api.call('listPosts', { mine: true });
  assert.equal(mine.items.length, 1); assert.equal(mine.items[0].visibility, 'private');
  assert.equal(mine.items[0].title, '今天的可爱');
  assert.equal(f.store.has('youban.demo.v1'), false);
  assert.ok(f.store.has(STORAGE_KEY));
  assert.equal(f.effects.calls.some(row => row.action === 'listEvents' || /[Vv]erif/.test(row.action)), false);
});

test('personal draft text is restored only from its own namespace', async t => {
  const f = await fixture(t);
  const first = await f.mount('compose');
  first.inputTitle(input('尚未保存')); first.input(input('日记草稿'));
  first.onHide(); first.onUnload();
  const reopened = await f.mount('compose');
  assert.equal(reopened.data.draftRestored, true);
  assert.equal(reopened.data.title, '尚未保存'); assert.equal(reopened.data.text, '日记草稿');
  assert.equal(reopened.data.visibility, 'private');
  assert.deepEqual(reopened.data.selectedTopics, []); assert.equal(reopened.data.selectedEventId, '');
});

test('personal details disable all social mutations while keeping reading, private bookmarks and deletion', async t => {
  const f = await fixture(t);
  const created = await f.api.call('createPost', { text: '私人记录', visibility: 'private', images: [] });
  const page = await f.mount('post', { id: created.post.id });
  assert.equal(page.data.post.isMine, true);
  assert.deepEqual(page.data.comments, []); assert.equal(page.data.nextCursor, null);
  const before = f.effects.calls.length;
  for (const method of ['openComment', 'send', 'like', 'openAuthor', 'openEvent', 'openCircle', 'changeVisibility', 'editVisibility', 'commentMenu', 'loadMore']) await page[method]();
  assert.equal(f.effects.calls.length, before);
  assert.equal(page.data.commentOpen, false);
  await page.bookmark(); assert.equal(page.data.post.isBookmarked, true);
  const saved = await f.mount('records', { type: 'bookmarks' });
  assert.equal(saved.data.items.length, 1); assert.equal(saved.data.items[0].id, page.id);
  await page.more();
  assert.deepEqual((await f.api.call('listPosts', { mine: true })).items, []);
  assert.deepEqual((await f.api.call('listPosts', { bookmarked: true })).items, []);
  assert.equal(f.effects.shares.some(row => row.type === 'show'), false);
});

test('curated waterfall and records reject retired social navigation and legacy parameters', async t => {
  const f = await fixture(t);
  const page = await f.mount('community');
  assert.equal(page.data.mode, 'personal'); assert.deepEqual(page.data.circles, []);
  assert.deepEqual(page.data.feeds.map(item => item.id), ['discover']);
  assert.equal(page.data.postColumns.length, 2); assert.ok(page.data.posts.length);
  assert.ok(page.data.posts.every(post => post.author.isEditorial && !post.isMine));
  const beforeCalls = f.effects.calls.length, beforeNav = f.effects.navigations.length;
  for (const method of ['compose', 'openAuthor', 'openCircle', 'openEvent', 'like', 'selectFeed', 'selectCircle']) await page[method]();
  assert.equal(f.effects.calls.length, beforeCalls); assert.equal(f.effects.navigations.length, beforeNav);
  assert.equal(page.data.feed, 'discover'); assert.equal(page.data.topic, '');
  await page.resume(); assert.equal(page.data.error, '');
  const reading = await f.mount('post', { id: page.data.posts[0].id });
  assert.equal(reading.data.post.isEditorialContent, true); assert.equal(reading.data.post.isMine, false);
  const records = await f.mount('records', { type: 'following' });
  assert.equal(records.data.type, 'posts');
  assert.deepEqual(records.data.tabs.map(item => item.id), ['posts', 'bookmarks']);
  for (const type of ['following', 'circles', 'events']) records.selectType(tap(type));
  assert.equal(records.data.type, 'posts');
  assert.equal(f.effects.calls.some(row => ['listFollowing', 'listEvents', 'listCircles'].includes(row.action)), false);
  assert.equal(f.effects.shares.some(row => row.type === 'show'), false);
});

test('personal discovery opens topics, applies the selected topic and clears it when selected again', async t => {
  const f = await fixture(t), page = await f.mount('community');
  const initialIds = page.data.posts.map(post => post.id);
  assert.ok(page.data.posts.some(post => !post.topics.includes('饮食喂养')));
  assert.equal(page.data.topicsOpen, false);
  page.toggleTopics();
  assert.equal(page.data.topicsOpen, true);

  const event = { currentTarget: { dataset: { topic: '饮食喂养' } } };
  await page.selectTopic(event);
  assert.equal(page.data.topic, '饮食喂养');
  assert.equal(f.effects.calls.filter(row => row.action === 'listPosts').at(-1).payload.topic, '饮食喂养');
  assert.ok(page.data.posts.length > 0);
  assert.ok(page.data.posts.every(post => post.isEditorial && post.topics.includes('饮食喂养')));

  await page.selectTopic(event);
  assert.equal(page.data.topic, '');
  assert.equal(f.effects.calls.filter(row => row.action === 'listPosts').at(-1).payload.topic, undefined);
  assert.deepEqual(page.data.posts.map(post => post.id), initialIds);
  assert.equal(f.effects.calls.some(row => ['listCircles', 'listEvents', 'listFollowing'].includes(row.action)), false);
});

test('personal topic browsing combines animal and search filters across pages without exposing legacy posts or cloud social actions', async t => {
  const f = await fixture(t), cloudCalls = [];
  global.wx.cloud = Object.fromEntries(['init', 'callFunction', 'uploadFile'].map(name => [name, () => {
    cloudCalls.push(name); throw new Error('topic browsing must stay local');
  }]));
  const api = shared.api.createApi(global.wx, { productMode: 'personal', mode: 'cloud', cloudEnv: 'must-not-connect' });
  const legacy = { version: 1, currentUserId: 'demo-self', users: [{ id: 'demo-self', nickname: '本人' }, { id: 'other', nickname: '其他人' }], posts: [
    { id: 'old-own', authorId: 'demo-self' }, { id: 'old-other', authorId: 'other' },
    { id: 'fake-editor', authorId: 'other', isEditorial: true, catalogManaged: true },
    { id: 'knowledge-001', authorId: 'other', isEditorial: true, catalogManaged: true }
  ].map(post => ({ ...post, visibility: 'public', title: '历史猫咪喂养记录', text: '不能进入精选话题', animalTypes: ['cat'], topics: ['饮食喂养'], images: [], createdAt: 1 })),
  bookmarks: [{ userId: 'demo-self', postId: 'old-own' }] };
  f.store.set('youban.demo.v1', structuredClone(legacy));

  const filters = { topic: '饮食喂养', animalType: 'cat', query: '猫', limit: 2 };
  const first = await api.call('listPosts', filters);
  assert.deepEqual(first.items.map(post => post.id), ['knowledge-001', 'knowledge-002']);
  assert.equal(first.nextCursor, '2');
  const second = await api.call('listPosts', { ...filters, cursor: first.nextCursor });
  assert.deepEqual(second.items.map(post => post.id), ['knowledge-089', 'knowledge-091']);
  assert.equal(second.nextCursor, undefined);
  for (const post of first.items.concat(second.items)) {
    assert.ok(post.topics.includes('饮食喂养')); assert.ok(post.animalTypes.includes('cat'));
    assert.equal(post.isEditorial, true); assert.equal(post.isMine, false); assert.equal(post.canShare, false);
    assert.notEqual(post.title, '历史猫咪喂养记录');
  }
  const narrowed = await api.call('listPosts', { ...filters, excludedAnimalTypes: ['dog'] });
  assert.deepEqual(narrowed.items.map(post => post.id), ['knowledge-001', 'knowledge-002']);
  assert.equal(narrowed.nextCursor, undefined);
  const search = await api.call('listPosts', { ...filters, query: '水' });
  assert.deepEqual(search.items.map(post => post.id), ['knowledge-002']);
  assert.deepEqual((await api.call('listPosts', { ...filters, query: '抓' })).items, []);
  assert.deepEqual((await api.call('listPosts', { topic: '饮食喂养', bookmarked: true })).items, []);
  assert.deepEqual((await api.call('listPosts', { mine: true })).items.map(post => post.id), ['old-own']);
  for (const action of ['likePost', 'addComment', 'setPostVisibility', 'sendMessage']) {
    await assert.rejects(api.call(action, { id: first.items[0].id }), { code: 'PERSONAL_MODE_ONLY' });
  }
  assert.deepEqual(cloudCalls, []);
  assert.deepEqual(f.store.get('youban.demo.v1'), legacy);
});
