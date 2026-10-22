const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const exportedApi = require('../miniprogram/services/api');
const shared = require('../miniprogram/pages/_shared');
const { STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed } = require('./helpers/community-fixture');

const pages = ['community', 'nearby', 'messages', 'me', 'circle', 'post', 'event', 'compose', 'profile', 'records', 'blocked', 'manage', 'moderation', 'author', 'register', 'policy', 'petstats', 'operations', 'local-detail'];

async function setup() {
  const storage = new Map([[STORAGE_KEY, createSeed(Date.now())]]);
  const effects = { toasts: [], navigations: [], setDataAfterUnload: 0, selection: 0 };
  global.wx = {
    getStorageSync: key => storage.get(key) || '',
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    showToast: options => effects.toasts.push(options.title),
    showModal: options => options.success && options.success({ confirm: true }),
    showActionSheet: options => options.success({ tapIndex: effects.selection }),
    navigateTo: options => effects.navigations.push(options.url),
    switchTab: options => effects.navigations.push(options.url),
    navigateBack: () => effects.navigations.push('back'),
    setNavigationBarTitle() {}, stopPullDownRefresh() {}, previewImage() {}, setClipboardData() {},
    chooseImage: options => options.success({ tempFilePaths: ['data:image/png;base64,YQ=='] }),
    saveFile: options => options.success({ savedFilePath: options.tempFilePath })
  };
  const api = exportedApi.createApi(global.wx, { mode: 'demo' });
  exportedApi.call = api.call;
  exportedApi.uploadImages = api.uploadImages;
  exportedApi.resumeUploads = api.resumeUploads;
  exportedApi.discardUploads = api.discardUploads;
  exportedApi.clearLocalUploads = api.clearLocalUploads;
  await api.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  return { api, effects };
}

function instantiate(name) {
  let definition;
  global.Page = value => { definition = value; };
  const source = require.resolve('../miniprogram/pages/' + name + '/index');
  delete require.cache[source];
  require(source);
  assert.ok(definition, name + ' registers a page');
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), _closed: false, writesAfterUnload: 0, setData(values) { if (this._closed) this.writesAfterUnload += 1; Object.assign(this.data, values); } });
  return page;
}

async function mount(name, options = {}) {
  const page = instantiate(name);
  page.onLoad(options);
  for (let i = 0; i < 20 && page.data.loading; i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.loading, false, name + ' completes initial load');
  return page;
}
function evt(dataset, value) { return { currentTarget: { dataset: dataset || {} }, detail: { value } }; }

test('all nineteen native pages have complete files, valid bindings and a working first load', async () => {
  const { api } = await setup();
  const circles = (await api.call('listCircles')).items;
  const posts = (await api.call('listPosts')).items;
  const events = (await api.call('listEvents')).items;
  const localRecord = require('../miniprogram/data/nearby-catalogue').records[0];
  for (const name of pages) {
    const options = { circle: { id: circles[0].id }, post: { id: posts[0].id }, event: { id: events[0].id }, author: { userId: posts[0].author.id }, 'local-detail': { id: localRecord.id } }[name] || {};
    const page = await mount(name, options);
    assert.equal(page.data.error, '', name + ' loads without errors');
    const directory = path.resolve(__dirname, '../miniprogram/pages/' + name);
    const markup = fs.readFileSync(path.join(directory, 'index.wxml'), 'utf8');
    JSON.parse(fs.readFileSync(path.join(directory, 'index.json'), 'utf8'));
    assert.ok(fs.statSync(path.join(directory, 'index.wxss')).size > 0);
    for (const match of markup.matchAll(/\b(?:bind|catch)(?:tap|input|change|confirm|getphonenumber)="([^"]+)"/g)) assert.equal(typeof page[match[1]], 'function', name + ' handler ' + match[1]);
    for (const match of markup.matchAll(/\bwx:(?:if|elif|for)="([^"]+)"/g)) assert.ok(match[1].startsWith('{{') && match[1].endsWith('}}'), name + ' directive uses data interpolation');
    page.onUnload();
  }
});

test('a member can publish an image post, reply, remove the reply and delete the post', async () => {
  const { api, effects } = await setup();
  const compose = await mount('compose');
  compose.input(evt({}, '初版联动测试：今天在公园遇到了新朋友。'));
  await compose.upload();
  assert.equal(compose.data.images.length, 1);
  await compose.submit();
  const created = (await api.call('listPosts', { mine: true })).items.find(p => p.text.startsWith('初版联动测试'));
  assert.ok(created);
  assert.equal(created.images.length, 1);
  const post = await mount('post', { id: created.id });
  post.input(evt({}, '给今天留一句回应。'));
  await Promise.all([post.send(), post.send()]);
  assert.equal(post.data.comments.length, 1, 'busy prevents duplicate replies');
  const replyId = post.data.comments[0].id;
  await post.commentMenu(evt({ id: replyId }));
  assert.equal(post.data.comments.length, 0);
  effects.selection = 1;
  await post.more();
  await assert.rejects(api.call('getPost', { id: created.id }));
});

test('event registration and cancellation update capacity and cannot double-submit', async () => {
  const { api } = await setup();
  const event = (await api.call('listEvents')).items.find(item => !item.isJoined && item.status === 'active' && item.startAt > Date.now());
  assert.ok(event);
  const page = await mount('event', { id: event.id });
  const before = page.data.event.attendeeCount;
  await Promise.all([page.join(), page.join()]);
  assert.equal(page.data.event.isJoined, true);
  assert.equal(page.data.event.attendeeCount, before + 1);
  await page.join();
  assert.equal(page.data.event.isJoined, false);
  assert.equal(page.data.event.attendeeCount, before);
});

test('profile accepts a pet-free user and an optional area, then round-trips cat details', async () => {
  const { api } = await setup();
  const profile = await mount('profile');
  profile.input(evt({ field: 'nickname' }, '附近的爱猫人'));
  profile.petState(evt({ value: 'no' }));
  profile.selectArea(evt({}, '0'));
  await profile.save();
  let user = (await api.call('bootstrap')).user;
  assert.equal(user.pet, null);
  assert.equal(user.area, '');
  profile.petState(evt({ value: 'yes' }));
  profile.input(evt({ field: 'petName' }, '糯米'));
  profile.selectType(evt({}, '0'));
  await profile.save();
  user = (await api.call('bootstrap')).user;
  assert.deepEqual(user.pet, { name: '糯米', type: 'cat' });
  const me = await mount('me');
  assert.equal(me.data.petLabel, '猫');
});

test('profile retains explicit neighbor consent in the demo service while nearby remains a public travel directory', async () => {
  const { api } = await setup();
  const profile = await mount('profile');
  assert.equal(profile.data.neighborVisible, false);
  profile.petState(evt({ value: 'yes' }));
  profile.input(evt({ field: 'petName' }, '仅测试邻居小猫'));
  profile.selectType(evt({}, '0'));
  profile.petDisplayState(evt({ value: 'yes' }));
  profile.neighborState(evt({ value: 'yes' }));
  profile.selectNeighborArea(evt({}, '1'));
  profile.residenceState(evt({ value: 'yes' }));
  global.wx.chooseLocation = options => options.success({ latitude: 31.12, longitude: 121.38, name: '仅测试选点', address: '不应保存的测试地址' });
  await profile.chooseResidence();
  await profile.save();
  let user = (await api.call('bootstrap')).user;
  assert.equal(user.neighborVisible, true);
  assert.equal(user.neighborAreaId, profile.data.neighborAreaChoices[1].id);
  assert.equal(user.residenceSharing, true);
  assert.deepEqual(Object.keys(user.residenceCell).sort(), ['grid', 'x', 'y']);
  const neighbors = await api.call('listNeighbors', { areaId: '', kind: 'pets', petType: 'all', query: '' });
  assert.equal(neighbors.items.some(item => item.id === user.id), false, 'the retained neighbor service never presents the current viewer as another person');
  const requested = [];
  exportedApi.call = async (action, payload) => { requested.push(action); return api.call(action, payload); };
  const nearby = await mount('nearby');
  await nearby.selectTab(evt({ id: 'neighbors' }));
  assert.equal(nearby.data.tab, 'places');
  assert.ok(requested.every(action => ['bootstrap', 'listPlaces'].includes(action)));
  assert.equal(Object.hasOwn(nearby.data, 'selfNeighborVisible'), false);
  assert.doesNotMatch(JSON.stringify(nearby.data), /仅测试邻居小猫|residenceCell|不应保存的测试地址/);
  profile.neighborState(evt({ value: 'no' }));
  await profile.save();
  user = (await api.call('bootstrap')).user;
  assert.equal(user.neighborVisible, false);
  assert.equal(user.residenceSharing, false);
  assert.equal(user.residenceCell, null);
});

test('admin creates, changes and cancels an event through the actual demo service', async () => {
  const { api } = await setup();
  const page = await mount('manage');
  page.create();
  page.input(evt({ field: 'title' }, '周末爱宠邻居小聚'));
  page.input(evt({ field: 'description' }, '在公共公园入口集合，带一张喜欢的动物照片，聊聊各自的日常。遇雨取消并通知大家。'));
  page.input(evt({ field: 'location' }, '社区公园南门公告栏旁'));
  await page.save();
  let event = (await api.call('listEvents')).items.find(e => e.title === '周末爱宠邻居小聚');
  assert.ok(event);
  page.edit(evt({ id: event.id }));
  page.input(evt({ field: 'title' }, '周末爱宠邻居咖啡小聚'));
  await page.save();
  event = (await api.call('getEvent', { id: event.id })).event;
  assert.equal(event.title, '周末爱宠邻居咖啡小聚');
  page.edit(evt({ id: event.id }));
  page.input(evt({ field: 'cancelReason' }, '场地临时维护，这次活动取消。'));
  await page.cancelEvent();
  assert.equal((await api.call('getEvent', { id: event.id })).event.status, 'cancelled');
});

test('blocked authors disappear from the feed and can be restored through block management', async () => {
  const { api, effects } = await setup();
  const post = (await api.call('listPosts')).items.find(p => !p.isMine);
  const detail = await mount('post', { id: post.id });
  effects.selection = 1;
  await detail.more();
  assert.equal((await api.call('listPosts')).items.some(p => p.author.id === post.author.id), false);
  const blocked = await mount('blocked');
  assert.equal(blocked.data.items.some(u => u.id === post.author.id), true);
  await blocked.unblock(evt({ id: post.author.id }));
  assert.equal((await api.call('listPosts')).items.some(p => p.author.id === post.author.id), true);
});

test('failed detail loads expose retry state and late requests cannot write after page unload', async () => {
  await setup();
  const missing = await mount('post', { id: 'missing-post' });
  assert.ok(missing.data.error);
  assert.equal(missing.data.loading, false);
  let resolve;
  const page = instantiate('community');
  const request = shared.load(page, () => new Promise(done => { resolve = done; }));
  page.onUnload();
  resolve({ posts: [{ id: 'late-result' }] });
  await request;
  assert.equal(page.writesAfterUnload, 0);
  assert.deepEqual(page.data.posts, []);
});

test('administrator controls stay unavailable when bootstrap returns an ordinary user', async () => {
  const { api } = await setup();
  exportedApi.call = async (action, payload) => {
    const result = await api.call(action, payload);
    if (action === 'bootstrap') result.user.isAdmin = false;
    return result;
  };
  const page = await mount('manage');
  assert.equal(page.data.isAdmin, false);
  assert.equal(page.data.formOpen, false);
  assert.deepEqual(page.data.events, []);
});

test('report moderation opens the original content, records a confirmed outcome and excludes non-admins', async () => {
  const { api, effects } = await setup();
  const post = (await api.call('listPosts')).items.find(item => !item.isMine);
  const report = await api.call('report', { targetType: 'post', targetId: post.id, reason: '广告或垃圾信息', description: '请核查这篇日常。' });
  const page = await mount('moderation');
  const record = page.data.items.find(item => item.id === report.id);
  assert.ok(record);
  assert.equal(record.canOpen, true);
  page.openTarget(evt({ id: record.id }));
  assert.equal(effects.navigations.at(-1), '/pages/post/index?id=' + post.id);
  page.expand(evt({ id: record.id }));
  page.inputNote(evt({ id: record.id }, '已经查看，目前未发现需要处置的内容。'));
  const before = (await api.call('listMessages')).items.length;
  await Promise.all([
    page.resolve(evt({ id: record.id, status: 'dismissed' })),
    page.resolve(evt({ id: record.id, status: 'dismissed' }))
  ]);
  assert.equal(page.data.items.some(item => item.id === record.id), false);
  assert.equal((await api.call('listReports', { status: 'all' })).items.find(item => item.id === record.id).status, 'dismissed');
  assert.equal((await api.call('listMessages')).items.length, before + 1, 'one outcome notification despite repeated clicks');
  let listCalls = 0;
  exportedApi.call = async (action, payload) => {
    if (action === 'listReports') listCalls += 1;
    const result = await api.call(action, payload);
    if (action === 'bootstrap') result.user.isAdmin = false;
    return result;
  };
  const ordinaryPage = await mount('moderation');
  assert.equal(ordinaryPage.data.isAdmin, false);
  assert.equal(listCalls, 0);
  assert.deepEqual(ordinaryPage.data.items, []);
});

test('management form respects service limits and makes started events read-only', async () => {
  const { api } = await setup();
  const writes = [];
  exportedApi.call = async (action, payload) => {
    if (['createEvent', 'updateEvent', 'cancelEvent', 'initialize'].includes(action)) writes.push(action);
    return api.call(action, payload);
  };
  const page = await mount('manage');
  page.create();
  page.input(evt({ field: 'title' }, '边界校验小聚'));
  page.input(evt({ field: 'description' }, '在公共场所一起交流养宠日常。'));
  page.input(evt({ field: 'location' }, '社区公园入口'));
  page.input(evt({ field: 'capacity' }, '1'));
  await page.save();
  assert.deepEqual(writes, [], 'capacity below the service minimum stays on the form');
  page.input(evt({ field: 'capacity' }, '2'));
  page.input(evt({ field: 'description' }, '长'.repeat(1001)));
  await page.save();
  assert.deepEqual(writes, [], 'overlong descriptions do not submit');
  page.input(evt({ field: 'description' }, '介绍活动安排。'));
  await page.save();
  assert.deepEqual(writes, ['createEvent']);
  const event = page.data.events.find(item => item.title === '边界校验小聚');
  page.edit(evt({ id: event.id }));
  page.input(evt({ field: 'cancelReason' }, '长'.repeat(81)));
  await page.cancelEvent();
  assert.deepEqual(writes, ['createEvent'], 'overlong cancellation reasons do not submit');
  page.setData({ setupCity: '上海', setupAreas: '测试片区', setupContact: '' });
  await page.initialize();
  assert.deepEqual(writes, ['createEvent'], 'community setup requires an operator contact');
  page.setData({ events: [Object.assign({}, event, { startAt: Date.now() - 60000, endAt: Date.now() + 60000 })] });
  page.edit(evt({ id: event.id }));
  assert.equal(page.data.editingLocked, true);
  assert.equal(page.data.editingEnded, false);
  await page.save();
  assert.deepEqual(writes, ['createEvent']);
  page.setData({ events: [Object.assign({}, event, { startAt: Date.now() - 120000, endAt: Date.now() - 60000 })] });
  page.edit(evt({ id: event.id }));
  page.input(evt({ field: 'cancelReason' }, '活动结束后不能再取消。'));
  await page.cancelEvent();
  assert.equal(page.data.editingEnded, true);
  assert.deepEqual(writes, ['createEvent']);
});

test('post comments follow returned cursors, merge overlapping pages and ignore duplicate clicks', async () => {
  const { api } = await setup();
  const post = (await api.call('listPosts')).items[0];
  const original = await api.call('getPost', { id: post.id });
  const make = (id, text) => ({ id, text, author: { id: 'reader', nickname: '爱宠邻居', avatar: '' }, createdAt: Date.now(), isMine: false });
  const cursors = [];
  exportedApi.call = async (action, payload = {}) => {
    if (action !== 'getPost') return api.call(action, payload);
    cursors.push(payload.cursor || 'first');
    if (payload.cursor === 'page-2') return { post: original.post, comments: [make('c2', '更新的回应'), make('c3', '第三条')], nextCursor: 'page-3' };
    if (payload.cursor === 'page-3') return { post: original.post, comments: [make('c4', '第四条')] };
    return { post: original.post, comments: [make('c1', '第一条'), make('c2', '第二条')], nextCursor: 'page-2' };
  };
  const page = await mount('post', { id: post.id });
  assert.equal(page.data.comments[0].author.avatar, '/assets/avatar-1.png', 'empty cloud avatars use the bundled default');
  await Promise.all([page.loadMore(), page.loadMore()]);
  assert.deepEqual(page.data.comments.map(item => item.id), ['c1', 'c2', 'c3']);
  assert.equal(page.data.comments[1].text, '更新的回应');
  assert.equal(page.data.nextCursor, 'page-3');
  await page.loadMore();
  await page.loadMore();
  assert.deepEqual(page.data.comments.map(item => item.id), ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(cursors, ['first', 'page-2', 'page-3']);
  assert.equal(page.data.nextCursor, null);
});

test('nearby loads all public directory pages and rejects late pages from a superseded directory refresh', async () => {
  const { api } = await setup();
  const sample = require('../miniprogram/data/nearby-catalogue').records.find(item => item.type === 'place');
  const place = id => ({ ...sample, id, title: id });
  const calls = [];
  let resolveOld, phase = 'initial';
  exportedApi.call = async (action, payload = {}) => {
    if (action !== 'listPlaces') return api.call(action, payload);
    calls.push(structuredClone(payload));
    if (phase === 'retained' && payload.cursor === 'old-page-two') return new Promise(resolve => { resolveOld = resolve; });
    if (phase === 'new') return payload.cursor ? { items: [place('new-2')] } : { items: [place('new-1')], nextCursor: 'new-page-two' };
    return payload.cursor ? { items: [place('old-2')] } : { items: [place('old-1')], nextCursor: 'old-page-two' };
  };
  const page = await mount('nearby');
  assert.deepEqual(page.data.places.map(item => item.id), ['old-1', 'old-2']);
  assert.deepEqual(calls.map(payload => payload.cursor || null), [null, 'old-page-two']);
  assert.ok(calls.every(payload => payload.type === 'all' && payload.limit === 50));
  phase = 'retained'; const oldRequest = page.refresh({ retain: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveOld, 'function');
  assert.equal(page.data.loading, false);
  phase = 'new'; await page.refresh({ retain: true });
  assert.deepEqual(page.data.places.map(item => item.id), ['new-1', 'new-2']);
  resolveOld({ items: [place('retired-late-place')] });
  await oldRequest;
  assert.deepEqual(page.data.places.map(item => item.id), ['new-1', 'new-2']);
  assert.equal(calls.filter(payload => payload.cursor === 'new-page-two').length, 1);
  page.onUnload();
});

test('nearby public places survive cloud failure and local filters never require location permission', async t => {
  await setup();
  exportedApi.call = async () => { throw new Error('后台暂时不可用'); };
  const cataloguePath = require.resolve('../miniprogram/data/nearby-catalogue');
  const originalCatalogue = require(cataloguePath);
  // This fixture only replaces the current test process's module export. It
  // never edits the real directory, user storage, or Developer Tools session.
  const places = [
    ['fixture-park', '仅测试绿园', '测试外圈', 'conditional'],
    ['fixture-open', '仅测试开放地点', '测试外圈', 'allowed'],
    ['fixture-conditional', '仅测试有限开放地点', '测试外圈', 'conditional'],
    ['fixture-unknown-one', '仅测试未知地点一', '测试莘庄片区', 'unknown'],
    ['fixture-unknown-two', '仅测试未知地点二', '测试莘庄片区', 'unknown'],
    ['fixture-not-allowed', '仅测试不可携宠地点', '测试莘庄片区', 'not_allowed']
  ].map(([id, title, area, status]) => ({ id, title, area, type: 'place', city: '仅测试城市', noPetRequired: true,
    summary: '仅供内存回归测试', petPolicy: { status, text: '仅测试规则' } }));
  require.cache[cataloguePath].exports = { ...originalCatalogue, records: places };
  t.after(() => { require.cache[cataloguePath].exports = originalCatalogue; });
  const page = await mount('nearby');
  assert.equal(page.data.error, '');
  assert.equal(page.data.places.length, 6);
  assert.ok(page.data.placeServiceError);
  assert.equal(page.data.isAdmin, false, 'failed identity reads cannot retain administrator controls');
  page.selectPetFilter(evt({ id: 'with' }));
  assert.equal(page.data.places.length, 3);
  assert.ok(page.data.places.every(place => ['conditional', 'allowed'].includes(place.petStatus)));
  page.inputSearch(evt({}, '绿园'));
  page.search();
  assert.deepEqual(page.data.places.map(place => place.id), ['fixture-park']);
  page.clearSearch();
  page.selectArea(evt({}, String(page.data.areas.indexOf('测试莘庄片区'))));
  assert.equal(page.data.places.length, 0, 'unknown and prohibited policies must not be advertised as pet-friendly');
  page.resetPlaces();
  assert.equal(page.data.places.length, 6);
  page.onUnload();
});

test('rich publishing preserves title, kind, selected topics, cover and a linked activity', async () => {
  const { api, effects } = await setup();
  global.wx.chooseImage = options => options.success({ tempFilePaths: ['data:image/png;base64,YQ==', 'data:image/png;base64,Yg==', 'data:image/png;base64,Yw=='] });
  const page = await mount('compose');
  page.inputTitle(evt({}, '第一次带狗参加活动，想问问大家'));
  page.input(evt({}, '除了牵引绳，还需要为小狗准备什么？'));
  page.selectKind(evt({ kind: 'question' }));
  page.data.topicChoices.slice(0, 4).forEach(item => page.selectTopic(evt({ topic: item.name })));
  assert.equal(page.data.selectedTopics.length, 3);
  await page.upload();
  page.chooseCover(evt({ index: 1 }));
  const expectedCover = page.data.images[1];
  await page.removeImage(evt({ index: 0 }));
  assert.equal(page.data.coverIndex, 0, 'removing a preceding photo preserves the selected cover');
  assert.equal(page.data.images[0], expectedCover);
  assert.ok(page.data.events.length > 1);
  page.chooseEvent(evt({}, '1'));
  const eventId = page.data.events[1].id;
  await page.submit();
  const created = (await api.call('listPosts', { mine: true })).items.find(post => post.title === '第一次带狗参加活动，想问问大家');
  assert.ok(created);
  assert.equal(created.kind, 'question');
  assert.equal(created.topics.length, 3);
  assert.equal(created.cover, expectedCover);
  assert.equal(created.eventId, eventId);
  const detail = await mount('post', { id: created.id });
  assert.equal(detail.data.post.event.id, eventId);
  detail.openEvent();
  assert.equal(effects.navigations.at(-1), '/pages/event/index?id=' + eventId);
});

test('likes and bookmarks update once per click and bookmarked posts can be removed from records', async () => {
  const { api, effects } = await setup();
  const source = (await api.call('listPosts')).items.find(post => !post.isMine);
  const detail = await mount('post', { id: source.id });
  await Promise.all([detail.like(), detail.like()]);
  assert.equal(detail.data.post.isLiked, true);
  assert.equal(detail.data.post.likeCount, source.likeCount + 1);
  await detail.like();
  assert.equal(detail.data.post.likeCount, source.likeCount);
  await detail.bookmark();
  assert.equal(detail.data.post.isBookmarked, true);
  assert.equal((await api.call('bootstrap')).stats.bookmarkCount, 1);
  detail.openAuthor(evt({ id: source.author.id }));
  assert.equal(effects.navigations.at(-1), '/pages/author/index?userId=' + source.author.id);
  const records = await mount('records', { type: 'bookmarks' });
  assert.equal(records.data.items.some(post => post.id === source.id), true);
  await records.unbookmark(evt({ id: source.id }));
  assert.equal(records.data.items.length, 0);
  assert.equal((await api.call('bootstrap')).stats.bookmarkCount, 0);
});

test('following an author populates the following feed and can be reversed from the following list', async () => {
  const { api } = await setup();
  const source = (await api.call('listPosts')).items.find(post => !post.isMine);
  const author = await mount('author', { userId: source.author.id });
  assert.equal(author.data.user.isFollowing, false);
  await author.follow();
  assert.equal(author.data.user.isFollowing, true);
  const community = await mount('community');
  community.selectFeed(evt({ id: 'following' }));
  await community.refresh();
  assert.ok(community.data.posts.length > 0);
  assert.equal(community.data.posts.every(post => post.author.id === source.author.id), true);
  const records = await mount('records', { type: 'following' });
  assert.equal(records.data.items.some(user => user.id === source.author.id), true);
  await records.unfollow(evt({ id: source.author.id }));
  assert.equal(records.data.items.length, 0);
  assert.equal((await api.call('bootstrap')).stats.followingCount, 0);
  await community.refresh();
  assert.equal(community.data.posts.length, 0);
});

test('profile sharing starts private and only changes through an explicit saved choice', async () => {
  const { api } = await setup();
  const profile = await mount('profile');
  assert.equal(profile.data.publicProfile, false);
  profile.input(evt({ field: 'bio' }, '喜欢和动物有关的一切小事。'));
  profile.privacyState(evt({ value: 'public' }));
  assert.equal((await api.call('bootstrap')).user.publicProfile, false, 'changing the control alone does not publish a profile');
  await profile.save();
  const user = (await api.call('bootstrap')).user;
  assert.equal(user.publicProfile, true);
  const author = await mount('author', { userId: user.id });
  assert.equal(author.data.user.bio, '喜欢和动物有关的一切小事。');
  assert.equal(Object.hasOwn(author.data.user, 'area'), false);
  profile.privacyState(evt({ value: 'private' }));
  await profile.save();
  assert.equal((await api.call('bootstrap')).user.publicProfile, false);
});

test('discovery preserves combined filters and automatically continues after an empty scanned page', async () => {
  const { api } = await setup();
  const source = (await api.call('listPosts')).items[0];
  const received = [];
  exportedApi.call = async (action, payload = {}) => {
    if (action !== 'listPosts') return api.call(action, payload);
    received.push(payload);
    return payload.cursor ? { items: [source] } : { items: [], nextCursor: 'more-visible-content' };
  };
  const page = await mount('community');
  page.inputSearch(evt({}, '  散步  '));
  page.search();
  await page.refresh();
  page.selectTopic(evt({ topic: page.data.topics[0] }));
  await page.refresh();
  page.selectFeed(evt({ id: 'following' }));
  await page.refresh();
  assert.equal(page.data.nextCursor, null);
  const parameters = received.at(-1);
  assert.equal(parameters.feed, 'following');
  assert.equal(parameters.query, '散步');
  assert.equal(parameters.topic, page.data.topics[0]);
  assert.equal(parameters.cursor, 'more-visible-content');
  assert.equal(page.data.posts.length, 1);
  page.clearSearch();
  await page.refresh();
  assert.equal(page.data.query, '');
  assert.equal(page.data.topic, page.data.topics[0]);
});

test('interrupted account cleanup stays recoverable from the me error state and still requires confirmation', async () => {
  const { api } = await setup();
  let cleanupPending = true;
  const deletionPayloads = [];
  exportedApi.call = async (action, payload) => {
    if (action === 'bootstrap' && cleanupPending) {
      const error = new Error('账号清理尚未完成，请重试注销');
      error.code = 'ACCOUNT_UNAVAILABLE';
      throw error;
    }
    if (action === 'deleteAccount') {
      deletionPayloads.push(payload || {});
      if (deletionPayloads.length === 1) throw new Error('连接中断，请再次尝试');
      cleanupPending = false;
      return { deleted: true };
    }
    return api.call(action, payload);
  };
  const page = await mount('me');
  assert.equal(page.data.user, null);
  assert.equal(page.data.errorCode, 'ACCOUNT_UNAVAILABLE');
  assert.deepEqual(deletionPayloads, [], 'opening the page never automatically deletes an account');
  global.wx.showModal = options => options.success({ confirm: false });
  await page.deleteAccount();
  assert.deepEqual(deletionPayloads, [], 'declining confirmation does not retry deletion');
  global.wx.showModal = options => options.success({ confirm: true });
  await page.deleteAccount();
  assert.equal(page.data.errorCode, 'ACCOUNT_UNAVAILABLE');
  assert.equal(page.data.busy, false, 'an interrupted retry leaves its button usable');
  await page.deleteAccount();
  assert.deepEqual(deletionPayloads, [{}, {}], 'cleanup retries never submit an identity');
  assert.equal(page.data.error, '');
  assert.equal(page.data.errorCode, '');
  assert.ok(page.data.user);
  exportedApi.call = async () => { const error = new Error('请检查网络'); error.code = 'NETWORK_ERROR'; throw error; };
  const refresh = page.refresh();
  assert.equal(page.data.errorCode, '', 'a fresh load clears the previous error code immediately');
  await refresh;
  assert.equal(page.data.errorCode, 'NETWORK_ERROR');
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/me/index.wxml'), 'utf8');
  assert.match(markup, /wx:if="{{errorCode === 'ACCOUNT_UNAVAILABLE'}}"[^>]*bindtap="deleteAccount"/);
});

test('circle and author pages carry hidden-animal preferences through pagination and ignore stale pages after a preference change', async () => {
  const preferences = require('../miniprogram/data/feed-preferences');
  for (const [name, action, options] of [['circle', 'getCircle', { id: 'circle-neighbors' }], ['author', 'getUserProfile', { userId: 'demo-lin' }]]) {
    const { api } = await setup();
    const source = (await api.call('listPosts')).items[0];
    preferences.save(global.wx, ['reptile']);
    const received = []; let finishOldPage; let defer = true;
    const response = (items, cursor) => ({ ...(name === 'circle' ? { circle: { id: options.id, name: '圈子', isJoined: true } } : { user: { id: options.userId, nickname: '作者', postCount: 2 } }), posts: items, ...(cursor ? { nextCursor: cursor } : {}) });
    exportedApi.call = async (requested, payload = {}) => {
      if (requested !== action) return api.call(requested, payload);
      received.push(structuredClone(payload));
      if (!payload.cursor) return response([], 'scan-next');
      if (defer) return new Promise(resolve => { finishOldPage = resolve; });
      return response([{ ...source, id: 'current-visible' }]);
    };
    const page = await mount(name, options);
    assert.deepEqual(received[0].excludedAnimalTypes, ['reptile']);
    assert.equal(page.data.posts.length, 0); assert.equal(page.data.nextCursor, 'scan-next');
    const stale = page.loadMore();
    preferences.save(global.wx, ['bird']); await page.refresh();
    finishOldPage(response([{ ...source, id: 'stale-hidden' }])); await stale;
    assert.deepEqual(page.data.posts, []);
    assert.deepEqual(page.data.excludedAnimalTypes, ['bird']);
    defer = false; await page.loadMore();
    assert.deepEqual(received.at(-1).excludedAnimalTypes, ['bird']);
    assert.equal(received.at(-1).cursor, 'scan-next');
    assert.deepEqual(page.data.posts.map(post => post.id), ['current-visible']);
    page.onUnload();
  }
});

test('hidden animals remain available from my published and bookmarked records and their original detail', async () => {
  const { api } = await setup();
  const { post } = await api.call('createPost', { circleId: 'circle-neighbors', text: '我的爬宠原文', images: [], animalTypes: ['reptile'] });
  await api.call('bookmarkPost', { id: post.id, bookmark: true });
  require('../miniprogram/data/feed-preferences').save(global.wx, ['reptile']);
  const circle = await mount('circle', { id: 'circle-neighbors' });
  assert.equal(circle.data.posts.some(item => item.id === post.id), false);
  for (const type of ['posts', 'bookmarks']) {
    const records = await mount('records', { type });
    assert.ok(records.data.items.some(item => item.id === post.id), type);
    records.onUnload();
  }
  const detail = await mount('post', { id: post.id });
  assert.equal(detail.data.post.text, '我的爬宠原文');
  circle.onUnload(); detail.onUnload();
});
