'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed } = require('./helpers/community-fixture');

// Run the real page controllers and shared lifecycle independently of which
// product is being packaged. All state and platform effects stay in memory.
function fixture({ personal = false } = {}) {
  const store = new Map([[STORAGE_KEY, createSeed(Date.now())]]);
  const effects = { menus: [], navigations: [], calls: [], confirmations: [], confirm: false };
  const platform = {
    getStorageSync(key) { return store.has(key) ? structuredClone(store.get(key)) : ''; },
    setStorageSync(key, value) { store.set(key, structuredClone(value)); },
    showShareMenu(options) { effects.menus.push({ method: 'show', ...options }); },
    hideShareMenu(options) { effects.menus.push({ method: 'hide', ...options }); },
    showModal(options) { effects.confirmations.push(options); options.success({ confirm: effects.confirm }); },
    showToast() {}, navigateTo(options) { effects.navigations.push(options.url); },
    stopPullDownRefresh() {}
  };
  const demo = createDemoService(platform);
  const api = { async call(action, payload) { effects.calls.push({ action, payload }); return demo.call(action, payload); } };
  const sharedFile = require.resolve('../miniprogram/pages/_shared');
  const actualRequire = createRequire(sharedFile);
  let definition;
  const sharedModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(sharedFile, 'utf8'), {
    module: sharedModule, wx: platform, Page(value) { definition = value; },
    require(name) {
      if (name === '../product') return { personalMode: personal, allowsNavigation: () => true };
      if (name === '../services/api') return api;
      return actualRequire(name);
    }
  }, { filename: sharedFile });
  const shared = sharedModule.exports;
  function page(name, values = {}) {
    const filename = require.resolve('../miniprogram/pages/' + name + '/index');
    const localRequire = createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      wx: platform, console, setTimeout, clearTimeout,
      require(name) { return name === '../_shared' ? shared : localRequire(name); }
    }, { filename });
    return { ...definition, data: { ...structuredClone(definition.data), loading: false, error: '', ...values }, setData(values, callback) { Object.assign(this.data, values); if (callback) callback(); } };
  }
  return { shared, page, effects, store, demo, api, platform, registered: () => definition };
}

const asPlain = value => JSON.parse(JSON.stringify(value));
const cover = '/assets/event-walk.png';

test('friend and timeline sharing use only public routes and an explicit public cover', () => {
  const f = fixture();
  const id = 'public-id';
  const cases = [
    ['community', {}, {}, '/pages/community/index', ''],
    ['nearby', { reference: { label: 'PRIVATE_HOME' } }, {}, '/pages/nearby/index', ''],
    ['local-detail', { item: { id, title: '公共地点' }, visitNote: 'PRIVATE_VISIT_NOTE' }, {}, '/pages/local-detail/index?id=' + id, 'id=' + id],
    ['local-detail', { guide: { id, title: '公共路线' } }, {}, '/pages/local-detail/index?guideId=' + id, 'guideId=' + id],
    ['post', { post: { id, title: '公开文章', visibility: 'public' }, text: 'PRIVATE_COMMENT_DRAFT' }, { id }, '/pages/post/index?id=' + id, 'id=' + id],
    ['author', { user: { id, nickname: '公开昵称', bio: 'PRIVATE_BIO', pets: [{ birthDate: 'PRIVATE_BIRTHDAY' }] }, posts: [{ text: 'PRIVATE_DIARY' }] }, { userId: id }, '/pages/author/index?userId=' + id, 'userId=' + id],
    ['event', { event: { title: '公开活动' }, text: 'PRIVATE_COMMENT_DRAFT' }, { id }, '/pages/event/index?id=' + id, 'id=' + id],
    ['circle', { circle: { name: '公开圈子' }, posts: [{ text: 'PRIVATE_DIARY' }] }, { id }, '/pages/circle/index?id=' + id, 'id=' + id]
  ];
  for (const [name, values, props, path, query] of cases) {
    const page = Object.assign(f.page(name, values), props);
    const friend = page.onShareAppMessage(), timeline = page.onShareTimeline();
    assert.equal(friend.path, path, name); assert.equal(timeline.query, query, name);
    assert.equal(friend.imageUrl, cover, name); assert.equal(timeline.imageUrl, cover, name);
    assert.equal('path' in timeline, false, 'timeline uses its current page, not a redirected friend-share path');
    assert.doesNotMatch(JSON.stringify([friend, timeline]), /PRIVATE_/, name);
  }
});

test('shared lifecycle enables public sharing but keeps editing pages and personal product private', () => {
  for (const personal of [false, true]) {
    const f = fixture({ personal });
    f.shared.register({ data: {}, onShareAppMessage() {}, onShareTimeline() {} });
    const page = f.registered(); page.onLoad({}); page.onShow();
    assert.equal(f.effects.menus.at(-1).method, personal ? 'hide' : 'show');
    assert.equal(typeof page.onShareTimeline, personal ? 'undefined' : 'function');
    f.shared.register({ data: {} }); f.registered().onShow();
    assert.equal(f.effects.menus.at(-1).method, 'hide', 'editors, chat and private archive have no share menu');
  }
});

test('private, friends-only, loading and revoked posts never expose ids or private content through share hooks', () => {
  const f = fixture();
  for (const factory of [(values) => f.page('post', values)]) {
    for (const state of [
      { post: { visibility: 'private', title: 'PRIVATE_TITLE' } },
      { post: { visibility: 'friends', title: 'PRIVATE_TITLE' } },
      { loading: true, post: { visibility: 'public', title: 'PRIVATE_TITLE' } },
      { error: '访问范围已变化', post: { visibility: 'public', title: 'PRIVATE_TITLE' } }
    ]) {
      const page = factory(state); page.id = 'PRIVATE_ID'; page.syncShareMenu();
      assert.equal(f.effects.menus.at(-1).method, 'hide');
      const friend = page.onShareAppMessage(), timeline = page.onShareTimeline();
      assert.equal(friend.path, '/pages/community/index'); assert.equal(timeline.query, '');
      assert.equal(friend.imageUrl, cover); assert.equal(timeline.imageUrl, cover);
      assert.doesNotMatch(JSON.stringify([friend, timeline]), /PRIVATE_/);
    }
  }
  for (const route of ['/media/pages/index', '/media2/pages/index', '/media3/pages/index']) {
    assert.equal(require('../miniprogram/product').allowsNavigation(route + '?id=old-video'), false);
  }
});

test('publishing one private diary requires explicit author confirmation and does not publish other records', async () => {
  const f = fixture();
  await f.demo.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  const create = async text => (await f.demo.call('createPost', { circleId: 'circle-neighbors', visibility: 'private', text, images: [] })).post;
  const post = await create('希望主动分享的一篇'), other = await create('仍然私密的一篇');
  const page = f.page('post', { post: f.shared.post(post), mode: 'demo' }); page.id = post.id;
  await page.publishForSharing();
  assert.equal(f.effects.confirmations.length, 1);
  assert.match(f.effects.confirmations[0].content, /所有人可见/);
  assert.equal(f.effects.calls.some(call => call.action === 'setPostVisibility'), false, 'cancel makes no mutation');
  assert.equal((await f.demo.call('getPost', { id: post.id })).post.visibility, 'private');
  f.effects.confirm = true;
  await page.publishForSharing();
  assert.deepEqual(asPlain(f.effects.calls.filter(call => call.action === 'setPostVisibility')), [{ action: 'setPostVisibility', payload: { id: post.id, visibility: 'public' } }]);
  assert.equal((await f.demo.call('getPost', { id: other.id })).post.visibility, 'private');
  assert.equal(page.data.post.visibility, 'public');
  assert.equal(f.effects.menus.at(-1).method, 'show');
  assert.equal(page.onShareAppMessage().path, '/pages/post/index?id=' + post.id);
  const current = f.store.get(STORAGE_KEY); current.currentUserId = 'demo-lin'; f.store.set(STORAGE_KEY, current);
  assert.equal((await f.demo.call('getPost', { id: post.id })).post.visibility, 'public');
  await assert.rejects(f.demo.call('getPost', { id: other.id }), { code: 'NOT_FOUND' });
  const viewer = f.page('post', { post: { ...page.data.post, isMine: false, visibility: 'private' } }); viewer.id = post.id;
  const before = f.effects.calls.length; await viewer.publishForSharing();
  assert.equal(f.effects.calls.length, before, 'a viewer cannot change author consent');
});

test('profile editor links to the saved public profile without sharing or saving unsaved private fields', () => {
  const f = fixture();
  const page = f.page('profile', { bio: 'PRIVATE_UNSAVED_BIO', publicProfile: true, residenceCell: { lat: 'PRIVATE_LOCATION' } });
  page.userId = 'owner-1';
  assert.equal(page.onShareAppMessage, undefined); assert.equal(page.onShareTimeline, undefined);
  page.openPublicProfile();
  assert.deepEqual(f.effects.navigations, ['/pages/author/index?userId=owner-1']);
  assert.deepEqual(f.effects.calls, [], 'opening the saved profile must not save or publish the current form');
  const markup = fs.readFileSync(require.resolve('../miniprogram/pages/profile/index.wxml'), 'utf8');
  assert.match(markup, /bindtap="openPublicProfile"/); assert.match(markup, /先保存上方的公开范围/);
});

test('failed publication or leaving during confirmation cannot turn a private preview into a public share', async () => {
  const f = fixture();
  const privatePost = { id: 'private-1', isMine: true, visibility: 'private', title: 'PRIVATE_TITLE' };
  const page = f.page('post', { post: privatePost }); page.id = privatePost.id;
  f.effects.confirm = true;
  f.api.call = async () => { throw new Error('保存失败'); };
  page.syncShareMenu(); await page.publishForSharing();
  assert.equal(page.data.post.visibility, 'private'); assert.equal(page.data.busy, false);
  assert.equal(f.effects.menus.at(-1).method, 'hide');
  assert.doesNotMatch(JSON.stringify([page.onShareAppMessage(), page.onShareTimeline()]), /PRIVATE_TITLE|private-1/);

  let confirm;
  const leaving = fixture();
  leaving.platform.showModal = options => { confirm = options.success; };
  const departing = leaving.page('post', { post: privatePost }); departing.id = privatePost.id;
  const pending = departing.publishForSharing();
  departing._closed = true; confirm({ confirm: true }); await pending;
  assert.deepEqual(leaving.effects.calls, [], 'confirmation resolved after leaving makes no write');
  assert.equal(departing.data.post.visibility, 'private');
});
