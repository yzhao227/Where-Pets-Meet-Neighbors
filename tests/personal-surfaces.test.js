'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSeed } = require('./helpers/community-fixture');
const shared = require('../miniprogram/pages/_shared');
const { createApi } = require('../miniprogram/services/api');
const config = require('../miniprogram/config');
const catalogue = require('../miniprogram/data/nearby-catalogue');
const drafts = require('../miniprogram/pages/_drafts');
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });

// Every account, file path, draft and platform operation below exists only in
// memory. No real local storage, browser, files or backend account is opened.
function fixture(t) {
  assert.equal(shared.personalMode, true, 'exercise the shipped personal product');
  const legacy = createSeed(Date.now());
  const originalLegacy = structuredClone(legacy);
  const storage = new Map([['youban.demo.v1', legacy]]);
  const effects = { calls: [], routes: [], toasts: [], location: 0 };
  const platform = {
    getStorageSync: key => structuredClone(storage.get(key) || ''),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
    navigateTo: opts => effects.routes.push(opts.url),
    switchTab: opts => effects.routes.push(opts.url),
    navigateBack: () => effects.routes.push('back'),
    showToast: opts => effects.toasts.push(opts.title),
    showModal: opts => opts.success({ confirm: true }),
    setNavigationBarTitle() {}, stopPullDownRefresh() {}, hideShareMenu() {},
    chooseMedia: opts => opts.success({ tempFiles: [{ tempFilePath: '/memory/private-pet.jpg', size: 1000 }] }),
    saveFile: opts => opts.success({ savedFilePath: '/memory/private-pet-saved.jpg' }),
    getSavedFileList: opts => opts.success({ fileList: [{ filePath: '/memory/private-pet-saved.jpg' }] }),
    removeSavedFile: opts => opts.success({}),
    getLocation() { effects.location++; throw new Error('Unexpected GPS request'); },
    chooseLocation() { effects.location++; throw new Error('Unexpected location picker'); }
  };
  const previous = { wx: global.wx, Page: global.Page, call: shared.api.call, clear: shared.api.clearLocalUploads };
  global.wx = platform;
  const api = createApi(platform, config);
  shared.api.call = async (action, payload) => {
    effects.calls.push({ action, payload: structuredClone(payload) });
    return api.call(action, payload);
  };
  shared.api.clearLocalUploads = () => api.clearLocalUploads();
  const pages = [];
  t.after(() => {
    pages.forEach(page => page.onUnload());
    global.wx = previous.wx; global.Page = previous.Page;
    shared.api.call = previous.call; shared.api.clearLocalUploads = previous.clear;
  });
  async function mount(name, options = {}) {
    let definition; global.Page = value => { definition = value; };
    const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
    delete require.cache[require.resolve(file)]; require(file);
    const page = { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
    pages.push(page);
    await page.onLoad(options);
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setImmediate(resolve));
      if (!page.data.loading) break;
    }
    assert.equal(page.data.error, '', name + ' loads');
    assert.equal(page.data.loading, false, name + ' finishes loading');
    assert.equal(page.data.personalMode, true);
    assert.equal(page.onShareAppMessage, undefined, name + ' has no system share hook');
    return page;
  }
  const assertLegacyPreserved = () => assert.deepEqual(storage.get('youban.demo.v1'), originalLegacy, 'legacy community data stays untouched');
  return { api, effects, storage, mount, assertLegacyPreserved };
}

test('personal nearby pages browse official places and preserve private bookmarks and visits without social requests', async t => {
  const f = fixture(t);
  const nearby = await f.mount('nearby');
  assert.ok(nearby.data.places.length > 0);
  for (const tab of ['activities', 'guides', 'places']) {
    nearby.selectTab(event({ id: tab }));
    assert.equal(nearby.data.tab, tab, 'personal browsing includes each public travel catalogue');
  }
  nearby.selectTab(event({ id: 'neighbors' }));
  assert.equal(nearby.data.tab, 'places');
  nearby.contribute();
  assert.ok(!f.effects.calls.some(call => ['listEvents', 'listNeighbors', 'getFriendHub', 'followUser', 'submitNearbySubmission'].includes(call.action)));
  assert.deepEqual(f.effects.routes, []);

  const detail = await f.mount('local-detail', { id: catalogue.records.find(item => item.type === 'place').id });
  await detail.bookmark();
  assert.equal(detail.data.isBookmarked, true);
  detail.openVisitForm(); detail.visitInput(event({}, '仅本机到访备注'));
  await detail.saveVisit();
  assert.ok(detail.data.visit);
  detail.shareVisit(); await detail.sendCorrection();
  assert.ok(!f.effects.calls.some(call => call.action === 'submitPlaceCorrection'));
  assert.deepEqual(f.effects.routes, []);

  const visits = await f.mount('places', { type: 'visits' });
  assert.ok(visits.data.items.some(item => item.note === '仅本机到访备注'));
  visits.shareVisit(event({ id: visits.data.items[0].id }));
  assert.deepEqual(f.effects.routes, []);
  const saved = await f.mount('places');
  assert.ok(saved.data.items.some(item => item.id === detail.id));
  assert.equal(f.effects.location, 0, 'reading and saving never request viewer location');
  f.assertLegacyPreserved();
});

test('personal travel routes open valid public itineraries while recommendation and stale navigation stay unavailable', async t => {
  const f = fixture(t);
  const nearby = await f.mount('nearby');
  nearby.selectTab(event({ id: 'guides' }));
  assert.ok(nearby.data.displayGuides.length > 0);
  const guide = nearby.data.displayGuides[0];
  nearby.openGuide(event({ id: guide.id }));
  assert.equal(f.effects.routes.pop(), '/pages/local-detail/index?guideId=' + encodeURIComponent(guide.id));
  nearby.openGuide(event({ id: 'unavailable-guide' }));
  nearby.contribute();
  nearby.data.busy = true; nearby.openGuide(event({ id: guide.id })); nearby.contribute();
  nearby.data.busy = false; nearby.onHide(); nearby.openGuide(event({ id: guide.id })); nearby.contribute();
  assert.deepEqual(f.effects.routes, []);
  await nearby.onShow();
  assert.equal(nearby.data.tab, 'guides');
  assert.ok(nearby.data.displayGuides.some(item => item.id === guide.id));
  assert.ok(!f.effects.calls.some(call => ['listEvents', 'listNeighbors', 'submitNearbySubmission'].includes(call.action)));
  assert.equal(f.effects.location, 0);
  f.assertLegacyPreserved();
});

test('private profile, pet photos and isolated drafts work without verification and clearing preserves legacy data', async t => {
  const f = fixture(t);
  const profile = await f.mount('profile');
  profile.data.nickname = '私人档案测试';
  await profile.save();
  assert.equal(f.effects.routes.pop(), 'back');
  const profileWrite = f.effects.calls.find(call => call.action === 'updateProfile');
  assert.ok(profileWrite);
  assert.equal(Object.hasOwn(profileWrite.payload, 'neighborVisible'), false);
  assert.equal(Object.hasOwn(profileWrite.payload, 'publicProfile'), false);
  profile.neighborState(event({ value: 'yes' })); profile.chooseResidence();
  assert.equal(profile.data.neighborVisible, false);

  profile.editPet(event());
  profile.input(event({ field: 'petDraftName' }, '仅内存测试伙伴'));
  await profile.savePet();
  const pet = profile.data.pets.find(item => item.name === '仅内存测试伙伴');
  assert.ok(pet);
  await profile.petPhotoAction(event({ id: pet.id, action: 'select' }));
  assert.equal(profile.data.pets.find(item => item.id === pet.id).photo, '/memory/private-pet-saved.jpg');
  assert.ok(!f.effects.calls.some(call => /VerifyIdentity|registerIdentity/.test(call.action)));

  const boot = await f.api.call('bootstrap');
  drafts.save('demo:' + boot.user.id, { text: '保留旧公开草稿' });
  drafts.save('personal:personal:' + boot.user.id, { text: '独立私人草稿' });
  const me = await f.mount('me');
  assert.equal(me.data.user.nickname, '私人档案测试');
  assert.deepEqual(me.data.circles, []);
  assert.equal(me.data.draftPreview, '独立私人草稿');
  me.records(event({ type: 'following' })); me.openCircle(event({ id: 'circle' }));
  me.registerIdentity(); me.manage();
  assert.deepEqual(f.effects.routes, []);
  assert.equal(f.effects.location, 0);
  f.assertLegacyPreserved();

  await me.deleteAccount();
  assert.equal(drafts.read('personal:personal:' + boot.user.id).value, null);
  assert.equal(drafts.read('demo:' + boot.user.id).value.text, '保留旧公开草稿');
  f.assertLegacyPreserved();
});

test('personal privacy page has the configured contact and current local-storage explanation without registration draft UI', async t => {
  const f = fixture(t);
  const privacy = await f.mount('policy', { type: 'privacy' });
  assert.equal(privacy.data.isDraft, false);
  assert.equal(privacy.data.contact, '13122197119@163.com');
  assert.ok(privacy.data.sections.some(row => /清理小程序存储/.test(row.text)));
  assert.ok(privacy.data.sections.some(row => /公开图片/.test(row.title)));
  assert.ok(privacy.data.sections.some(row => /主动使用距离参照或地图功能/.test(row.text)));
  assert.equal(f.effects.location, 0);
  assert.deepEqual(f.effects.calls.map(call => call.action), ['getPolicies']);
  f.assertLegacyPreserved();
});
