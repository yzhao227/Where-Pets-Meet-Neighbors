'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const exportedApi = require('../miniprogram/services/api');
const drafts = require('../miniprogram/pages/_drafts');
const { STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed } = require('./helpers/community-fixture');

const flush = () => new Promise(resolve => setImmediate(resolve));
const event = value => ({ detail: { value }, currentTarget: { dataset: {} } });
const consent = { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' };

// Actual controllers and the demo API run only against this in-memory platform.
async function fixture(t) {
  const store = new Map([[STORAGE_KEY, createSeed(Date.now())]]);
  const effects = { calls: [], toasts: [], navigations: [], sheets: [], selections: [], shares: [], confirm: true, writesAfterUnload: 0 };
  const handlers = {}, pages = [];
  const apiKeys = ['call', 'uploadImages', 'resumeUploads', 'discardUploads', 'clearLocalUploads', 'getFeedVersion'];
  const previous = { wx: global.wx, Page: global.Page, api: Object.fromEntries(apiKeys.map(key => [key, exportedApi[key]])) };
  global.wx = {
    getStorageSync(key) { return store.has(key) ? structuredClone(store.get(key)) : ''; },
    setStorageSync(key, value) { store.set(key, structuredClone(value)); },
    removeStorageSync(key) { store.delete(key); },
    showToast(options) { effects.toasts.push(options.title); },
    showModal(options) { if (options.success) options.success({ confirm: effects.confirm }); },
    showActionSheet(options) {
      effects.sheets.push(options.itemList);
      const tapIndex = effects.selections.shift();
      if (Number.isInteger(tapIndex) && tapIndex >= 0) options.success({ tapIndex });
      else if (options.fail) options.fail({ errMsg: 'showActionSheet:fail cancel' });
    },
    showShareMenu(options) { effects.shares.push({ method: 'show', ...options }); },
    hideShareMenu(options) { effects.shares.push({ method: 'hide', ...options }); },
    navigateTo(options) { effects.navigations.push(options.url); },
    navigateBack() { effects.navigations.push('back'); },
    switchTab(options) { effects.navigations.push(options.url); },
    stopPullDownRefresh() {}, hideKeyboard() {}, previewImage() {}, nextTick(callback) { queueMicrotask(callback); }
  };
  const api = exportedApi.createApi(global.wx, { mode: 'demo' });
  apiKeys.forEach(key => { exportedApi[key] = api[key]; });
  exportedApi.call = async (action, payload) => {
    effects.calls.push({ action, payload: payload && structuredClone(payload) });
    return handlers[action] ? handlers[action](payload) : api.call(action, payload);
  };
  await api.call('demoVerifyIdentity', { consent });
  async function mount(name, options = {}) {
    let definition;
    global.Page = value => { definition = value; };
    const file = require.resolve('../miniprogram/pages/' + name + '/index');
    delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data), setData(values, callback) {
      if (this._closed) effects.writesAfterUnload += 1;
      Object.assign(this.data, values);
      if (callback) queueMicrotask(callback);
    } };
    pages.push(page); page.onLoad(options);
    for (let index = 0; index < 30 && page.data.loading; index += 1) await flush();
    await flush();
    assert.equal(page.data.loading, false, name + ' completes initial load');
    return page;
  }
  t.after(async () => {
    for (const page of pages) if (!page._closed) page.onUnload();
    await flush();
    global.wx = previous.wx; global.Page = previous.Page;
    Object.assign(exportedApi, previous.api);
  });
  return {
    api, mount, effects, handlers, store,
    state: () => structuredClone(store.get(STORAGE_KEY)),
    async as(id) {
      const state = structuredClone(store.get(STORAGE_KEY)); state.currentUserId = id; store.set(STORAGE_KEY, state);
      await api.call('demoVerifyIdentity', { consent });
    },
    async post(visibility = 'public', extra = {}) {
      return (await api.call('createPost', { circleId: 'circle-neighbors', title: 'PRIVATE_TEST_TITLE', text: 'PRIVATE_TEST_BODY', images: [], visibility, ...extra })).post;
    }
  };
}

test('compose publishes all three selected scopes through the actual API and resets the next draft', async t => {
  const f = await fixture(t);
  for (const [index, scope] of ['public', 'friends', 'private'].entries()) {
    const page = await f.mount('compose', { circleId: 'circle-neighbors' });
    assert.equal(page.data.error, ''); assert.equal(page.data.visibility, 'public');
    page.chooseVisibility(event(String(index)));
    page.inputTitle(event('仅内存三档发布-' + scope)); page.input(event('仅内存的发布正文'));
    assert.equal(page.data.visibility, scope); assert.equal(page.data.visibilityIndex, index);
    assert.equal(f.store.get(drafts.KEY)['demo:demo-self'].visibility, scope);
    await page.submit();
    const payload = f.effects.calls.filter(call => call.action === 'createPost').at(-1).payload;
    assert.equal(payload.visibility, scope);
    const published = f.state().posts.find(item => item.title === '仅内存三档发布-' + scope);
    assert.ok(published); assert.equal(published.visibility, scope);
    assert.equal(page.data.visibility, 'public'); assert.equal(page.data.visibilityIndex, 0);
    assert.equal(page.data.text, ''); assert.equal(page.data.submitError, '');
    assert.equal(f.store.get(drafts.KEY)['demo:demo-self'], undefined);
    page.onUnload();
  }
  assert.equal(f.effects.calls.filter(call => call.action === 'createPost').length, 3);
  assert.equal(f.effects.writesAfterUnload, 0);
});

test('a private draft survives reopening, stays isolated across accounts, and clears back to public', async t => {
  const f = await fixture(t);
  const original = await f.mount('compose', { circleId: 'circle-neighbors' });
  original.chooseVisibility(event(2)); original.inputTitle(event('仅作者账户的草稿')); original.input(event('尚未发布的私密正文'));
  original.onHide(); original.onUnload();
  const page = await f.mount('compose');
  assert.equal(page.data.draftRestored, true); assert.equal(page.data.visibility, 'private');
  assert.equal(page.data.visibilityIndex, 2); assert.equal(page.data.title, '仅作者账户的草稿');
  await f.as('demo-lin'); await page.refresh();
  assert.equal(page.data.visibility, 'public'); assert.equal(page.data.text, ''); assert.equal(page.data.title, '');
  page.chooseVisibility(event(1)); page.input(event('另一账号的好友草稿'));
  await f.as('demo-self'); await page.refresh();
  assert.equal(page.data.visibility, 'private'); assert.equal(page.data.title, '仅作者账户的草稿');
  f.effects.confirm = false; await page.clearDraft();
  assert.equal(page.data.visibility, 'private'); assert.ok(f.store.get(drafts.KEY)['demo:demo-self']);
  f.effects.confirm = true; await page.clearDraft();
  assert.equal(page.data.visibility, 'public'); assert.equal(page.data.visibilityIndex, 0);
  assert.equal(page.data.title, ''); assert.equal(f.store.get(drafts.KEY)['demo:demo-self'], undefined);
  assert.equal(f.store.get(drafts.KEY)['demo:demo-lin'].visibility, 'friends');
  assert.equal(f.effects.calls.some(call => call.action === 'createPost'), false);
});

test('old drafts default to public while malformed saved scopes cannot silently become public', async t => {
  const f = await fixture(t);
  for (const [stored, expected] of [[undefined, 'public'], [null, 'private'], ['unknown', 'private'], ['friends', 'friends']]) {
    f.store.set(drafts.KEY, { 'demo:demo-self': { version: 1, savedAt: 1, text: '仅内存兼容草稿', ...(stored === undefined ? {} : { visibility: stored }) } });
    const page = await f.mount('compose');
    assert.equal(page.data.visibility, expected);
    assert.equal(page.data.visibilityChoices[page.data.visibilityIndex].id, expected);
    page.onUnload();
  }
});

test('failed publication retains the selected private scope, body and saved draft for retry', async t => {
  const f = await fixture(t); const page = await f.mount('compose', { circleId: 'circle-neighbors' });
  page.chooseVisibility(event(2)); page.input(event('失败后仍应保留的正文'));
  f.handlers.createPost = () => { throw Error('仅内存模拟保存失败'); };
  await page.submit();
  assert.equal(page.data.visibility, 'private'); assert.equal(page.data.text, '失败后仍应保留的正文');
  assert.match(page.data.submitError, /保存失败/); assert.equal(page.data.busy, false);
  assert.equal(f.store.get(drafts.KEY)['demo:demo-self'].visibility, 'private');
  assert.equal(f.effects.navigations.length, 0);
  delete f.handlers.createPost;
  await page.submit();
  assert.ok(f.state().posts.some(item => item.text === '失败后仍应保留的正文' && item.visibility === 'private'));
});

test('author controls update published visibility and share-menu state; cancellation and failure keep the old scope', async t => {
  const f = await fixture(t); const post = await f.post();
  const page = await f.mount('post', { id: post.id });
  assert.equal(page.data.post.visibilityText, '公开'); assert.equal(f.effects.shares.at(-1).method, 'show');
  const version = f.api.getFeedVersion();
  f.effects.selections.push(2); await page.changeVisibility();
  assert.equal(page.data.post.visibility, 'private'); assert.equal(page.data.post.visibilityText, '仅自己可见');
  assert.equal(f.effects.shares.at(-1).method, 'hide'); assert.ok(f.api.getFeedVersion() > version);
  assert.equal((await f.api.call('getPost', { id: post.id })).post.visibility, 'private');
  const writes = f.effects.calls.filter(call => call.action === 'setPostVisibility').length;
  f.effects.selections.push(-1); await page.changeVisibility();
  f.effects.selections.push(2); await page.changeVisibility();
  assert.equal(f.effects.calls.filter(call => call.action === 'setPostVisibility').length, writes);
  const unchangedVersion = f.api.getFeedVersion();
  f.handlers.setPostVisibility = () => { throw Error('仅内存范围保存失败'); };
  f.effects.selections.push(0); await page.changeVisibility();
  assert.equal(page.data.post.visibility, 'private'); assert.equal(f.effects.shares.at(-1).method, 'hide');
  assert.equal(f.api.getFeedVersion(), unchangedVersion); assert.match(f.effects.toasts.at(-1), /范围保存失败/);
  delete f.handlers.setPostVisibility;
  f.effects.selections.push(0, 1); await page.more();
  assert.deepEqual(f.effects.sheets.at(-2), ['设置可见范围', '删除这篇日常']);
  assert.equal(page.data.post.visibility, 'friends'); assert.equal(f.effects.shares.at(-1).method, 'hide');
  f.effects.selections.push(0); await page.changeVisibility();
  assert.equal(page.data.post.visibility, 'public'); assert.equal(f.effects.shares.at(-1).method, 'show');
  const records = await f.mount('records', { type: 'posts' });
  assert.equal(records.data.items.find(item => item.id === post.id).visibilityText, '公开');
});

test('a viewer cannot open visibility settings or issue a scope mutation', async t => {
  const f = await fixture(t); const post = await f.post(); await f.as('demo-lin');
  const page = await f.mount('post', { id: post.id });
  assert.equal(page.data.post.isMine, false);
  f.effects.sheets.length = 0; f.effects.calls.length = 0;
  await page.changeVisibility(); await page.editVisibility();
  assert.deepEqual(f.effects.sheets, []);
  assert.equal(f.effects.calls.some(call => call.action === 'setPostVisibility'), false);
  f.effects.selections.push(-1); await page.more();
  assert.ok(f.effects.sheets.every(items => !items.some(item => /可见范围/.test(item))));
  assert.equal((await f.api.call('getPost', { id: post.id })).post.visibility, 'public');
});

test('nonpublic, loading and failed details never return private titles, text or post IDs in share payloads', async t => {
  const f = await fixture(t);
  for (const scope of ['friends', 'private']) {
    const post = await f.post(scope); const page = await f.mount('post', { id: post.id });
    const shared = page.onShareAppMessage();
    assert.equal(shared.path, '/pages/community/index');
    assert.equal(shared.imageUrl, '/assets/event-walk.png', 'a restricted share must not use a screenshot of the private page');
    assert.doesNotMatch(JSON.stringify(shared), /PRIVATE_TEST_TITLE|PRIVATE_TEST_BODY/);
    assert.equal(JSON.stringify(shared).includes(post.id), false);
    assert.equal(f.effects.shares.at(-1).method, 'hide');
  }
  const post = await f.post('public'); const page = await f.mount('post', { id: post.id });
  assert.equal(page.onShareAppMessage().title, 'PRIVATE_TEST_TITLE');
  assert.equal(page.onShareAppMessage().path, '/pages/post/index?id=' + post.id);
  for (const state of [{ loading: true, error: '' }, { loading: false, error: '仅内存内容不可见' }]) {
    Object.assign(page.data, state); page.syncShareMenu();
    assert.equal(page.onShareAppMessage().path, '/pages/community/index');
    assert.doesNotMatch(JSON.stringify(page.onShareAppMessage()), /PRIVATE_TEST_TITLE|PRIVATE_TEST_BODY/);
    assert.equal(f.effects.shares.at(-1).method, 'hide');
  }
});

test('revoked detail access removes cached post, comments, photos and video navigation before sharing', async t => {
  const f = await fixture(t);
  const ticket = await f.api.call('createUploadTicket', { extension: 'jpg' });
  const image = 'wxfile://only-memory-visibility.jpg';
  await f.api.call('completeUpload', { ticketId: ticket.ticketId, fileId: image });
  const post = await f.post('public', { images: [image] });
  await f.as('demo-lin');
  await f.api.call('addComment', { targetType: 'post', targetId: post.id, text: 'PRIVATE_TEST_COMMENT' });
  const page = await f.mount('post', { id: post.id });
  assert.equal(page.data.photoItems.length, 1); assert.equal(page.data.comments.length, 1);
  Object.assign(page.data, { videoSource: 'wxfile://old-memory-video.mp4', videoPlayerPath: '/media/pages/index?id=' + post.id, videoWaiting: true, commentOpen: true });
  await f.as('demo-self'); await f.api.call('setPostVisibility', { id: post.id, visibility: 'private' });
  await f.as('demo-lin'); await page.refresh();
  assert.equal(page.data.post, null); assert.deepEqual(page.data.comments, []); assert.deepEqual(page.data.photoItems, []);
  assert.equal(page.data.videoSource, ''); assert.equal(page.data.videoPlayerPath, ''); assert.equal(page.data.videoWaiting, false);
  assert.equal(page.data.commentOpen, false); assert.ok(page.data.error);
  assert.equal(f.effects.shares.at(-1).method, 'hide');
  assert.equal(page.onShareAppMessage().path, '/pages/community/index');
  assert.doesNotMatch(JSON.stringify(page.onShareAppMessage()), /PRIVATE_TEST_TITLE|PRIVATE_TEST_BODY|PRIVATE_TEST_COMMENT/);
  assert.equal(page.openVideo, undefined, 'video navigation is no longer exposed');
});

test('signed photo retry obtains new authorized URLs and ignores callbacks for the expired signature', async t => {
  const f = await fixture(t); const source = await f.post('friends');
  const expired = ['https://example.invalid/a.jpg?signature=expired', 'https://example.invalid/b.jpg?signature=expired'];
  const renewed = expired.map(url => url.replace('expired', 'renewed'));
  f.handlers.getPost = () => ({ post: { ...source, mediaSigned: true, images: expired }, comments: [] });
  const page = await f.mount('post', { id: source.id });
  page.photoChanged({ detail: { current: 1 } });
  const old = structuredClone(page.data.photoItems[1]);
  const oldEvent = { currentTarget: { dataset: { index: 1, src: old.src, attempt: old.attempt } } };
  page.photoFailed(oldEvent);
  assert.equal(page.data.photoItems[1].status, 'error');
  let finish;
  f.handlers.getPost = () => new Promise(resolve => { finish = resolve; });
  f.effects.calls.length = 0;
  const pending = page.retryPhoto({ currentTarget: { dataset: { index: 1 } } });
  await page.retryPhoto({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(f.effects.calls.filter(call => call.action === 'getPost').length, 1, 'retry requests a fresh authorization once');
  assert.equal(page.data.loading, true);
  finish({ post: { ...source, mediaSigned: true, images: renewed }, comments: [] }); await pending;
  assert.deepEqual(page.data.photoItems.map(item => item.src), renewed);
  assert.equal(page.data.photoIndex, 1); assert.equal(page.data.photoItems[1].status, 'loading');
  page.photoFailed(oldEvent); page.photoLoaded({ ...oldEvent, detail: { width: 100, height: 100 } });
  assert.equal(page.data.photoItems[1].status, 'loading', 'expired callbacks cannot settle the new signature');
  assert.equal(page.data.photoItems[1].src, renewed[1]);
  f.handlers.getPost = () => { throw Object.assign(Error('仅内存范围已撤销'), { code: 'NOT_FOUND' }); };
  const current = page.data.photoItems[1];
  page.photoFailed({ currentTarget: { dataset: { index: 1, src: current.src, attempt: current.attempt } } });
  await page.retryPhoto({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.post, null); assert.deepEqual(page.data.photoItems, []);
  assert.equal(page.onShareAppMessage().path, '/pages/community/index');
});

test('historical video details stay unavailable even if a cached or cloud result returns their source', async t => {
  const f = await fixture(t); const source = await f.post('private');
  for (const extra of [
    { video: { url: 'https://example.invalid/video.mp4?signature=old', durationSeconds: 8 } },
    { video: { url: '/media/clips/112285953.mp4', durationSeconds: 8 } },
    { contentType: 'video' }
  ]) {
    f.handlers.getPost = () => ({ post: { ...source, ...extra, mediaSigned: true }, comments: [] });
    const page = await f.mount('post', { id: source.id });
    assert.equal(page.data.post, null); assert.deepEqual(page.data.photoItems, []);
    assert.match(page.data.error, /已下架/);
    assert.equal(page.data.videoSource, ''); assert.equal(page.data.videoPlayerPath, '');
    assert.equal(page.openVideo, undefined); assert.equal(page.retryVideo, undefined);
    assert.equal(page.onShareAppMessage().path, '/pages/community/index');
    assert.doesNotMatch(JSON.stringify(page.onShareAppMessage()), /PRIVATE_TEST_TITLE|PRIVATE_TEST_BODY/);
    await page.refresh(); assert.equal(page.data.post, null);
  }
});
