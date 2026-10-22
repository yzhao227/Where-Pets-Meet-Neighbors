'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../miniprogram/pages/_shared');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed } = require('./helpers/community-fixture');
const topics = require('../miniprogram/data/topics');
const preferences = require('../miniprogram/data/feed-preferences');
const tap = id => ({ currentTarget: { dataset: { id } } });
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const post = (id, extra = {}) => ({ id, title: id, text: '仅内存测试内容', images: [], topics: ['饮食喂养'], author: { id: 'author-a', nickname: '记录作者' }, ...extra });

function fixture(t) {
  const previous = { wx: global.wx, Page: global.Page, call: shared.api.call, personalMode: shared.personalMode };
  const storage = new Map([[STORAGE_KEY, createSeed(Date.now())]]);
  const effects = { calls: [], navigations: [], titles: [], writes: [], toasts: [] };
  global.wx = {
    getStorageSync: key => structuredClone(storage.get(key) || ''),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    stopPullDownRefresh() {}, showToast: value => effects.toasts.push(value.title),
    setNavigationBarTitle: value => effects.titles.push(value.title), navigateTo: value => effects.navigations.push(value.url)
  };
  const service = createDemoService(global.wx);
  const control = { call: service.call };
  shared.api.call = async (action, payload = {}) => { effects.calls.push({ action, payload: structuredClone(payload) }); return control.call(action, payload); };
  function pageAt(name) {
    let definition; global.Page = value => { definition = value; };
    const file = require.resolve('../miniprogram/pages/' + name + '/index'); delete require.cache[file]; require(file);
    return { ...definition, data: structuredClone(definition.data), setData(values) { effects.writes.push(structuredClone(values)); Object.assign(this.data, values); } };
  }
  t.after(() => { global.wx = previous.wx; global.Page = previous.Page; shared.api.call = previous.call; shared.personalMode = previous.personalMode; });
  return { effects, storage, service, control, pageAt };
}

test('the guide opens existing topic content without verification, membership requests or membership changes', async t => {
  const { pageAt, effects, service } = fixture(t);
  const before = (await service.call('listCircles')).items;
  const square = pageAt('circle-square'); await square.onLoad();
  assert.deepEqual(square.data.topics.map(item => item.id), Array.from(topics));
  assert.deepEqual(effects.calls, [], 'the topic directory uses the existing static taxonomy');
  square.openTopic(tap('健康护理'));
  assert.equal(effects.navigations.at(-1), '/pages/circle/index?topic=' + encodeURIComponent('健康护理'));
  const detail = pageAt('circle'); await detail.onLoad({ topic: '健康护理' });
  assert.equal(detail.data.error, ''); assert.ok(detail.data.posts.length);
  assert.ok(detail.data.posts.every(item => item.topics.includes('健康护理')));
  assert.deepEqual(effects.calls.map(item => item.action), ['listPosts']);
  assert.equal(effects.calls[0].payload.feed, 'discover');
  assert.equal(effects.calls[0].payload.circleId, undefined);
  detail.openPost(tap(detail.data.posts[0].id));
  assert.equal(effects.navigations.at(-1), '/pages/post/index?id=' + encodeURIComponent(detail.data.posts[0].id));
  assert.deepEqual((await service.call('listCircles')).items, before);
  assert.equal(typeof detail.join, 'undefined'); assert.equal(typeof detail.compose, 'undefined');
  assert.match(detail.onShareAppMessage().path, /\?topic=/);
  assert.doesNotMatch(detail.onShareAppMessage().title, /加入|圈子/);
});

test('old collection links remain readable without exposing or changing joined state', async t => {
  const { pageAt, effects, service } = fixture(t);
  const before = (await service.call('listCircles')).items;
  const source = before.find(item => !item.isJoined);
  assert.ok(source);
  const detail = pageAt('circle'); await detail.onLoad({ id: source.id });
  assert.equal(detail.data.error, '');
  assert.equal(detail.data.circle.id, source.id);
  assert.equal(detail.data.circle.name, source.name);
  for (const key of ['memberCount', 'isJoined', 'members', 'memberIds']) assert.equal(detail.data.circle[key], undefined);
  assert.deepEqual(effects.calls.map(item => item.action), ['getCircle']);
  assert.deepEqual((await service.call('listCircles')).items, before);
  assert.equal(detail.onShareAppMessage().path, '/pages/circle/index?id=' + encodeURIComponent(source.id));
});

test('content cards distinguish the supplied source from author contributions', async t => {
  const { pageAt, control } = fixture(t);
  control.call = async () => ({ items: [
    post('sourced', { source: { publisher: '原始出版方', title: '原文标题', url: 'https://example.invalid/article' } }),
    post('personal'), post('editorial', { author: { id: 'editor', nickname: '整理账号', isEditorial: true } })
  ] });
  const page = pageAt('circle'); await page.onLoad({ topic: '健康护理' });
  assert.deepEqual(page.data.posts.map(item => [item.sourceLabel, item.sourceText]), [
    ['资料整理', '来源：原始出版方'], ['作者分享', '作者：记录作者'], ['内容整理', '作者：整理账号']
  ]);
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/circle/index.wxml'), 'utf8');
  assert.match(wxml, /item\.sourceText/);
  assert.doesNotMatch(wxml, /memberCount|isJoined|bindtap="(?:join|compose)"|成员列表|官方知识|运营审核/);
});

test('topic pagination carries preferences and rejects an old page after they change', async t => {
  const { pageAt, control, effects } = fixture(t);
  preferences.save(global.wx, ['reptile']);
  const pending = deferred(); let defer = true;
  control.call = async (_action, payload) => !payload.cursor ? { items: [], nextCursor: 'scan-next' }
    : defer ? pending.promise : { items: [post('current-visible')] };
  const page = pageAt('circle'); await page.onLoad({ topic: '饮食喂养' });
  assert.deepEqual(effects.calls[0].payload.excludedAnimalTypes, ['reptile']);
  const oldMore = page.loadMore(); await flush();
  preferences.save(global.wx, ['bird']); await page.refresh();
  pending.resolve({ items: [post('stale-hidden')] }); await oldMore;
  assert.deepEqual(page.data.posts, []);
  defer = false; await page.loadMore();
  assert.deepEqual(effects.calls.at(-1).payload, { feed: 'discover', topic: '饮食喂养', excludedAnimalTypes: ['bird'], cursor: 'scan-next' });
  assert.deepEqual(page.data.posts.map(item => item.id), ['current-visible']);
  assert.equal(page.data.nextCursor, null);
});

test('superseded and hidden loads cannot replace content or the navigation title', async t => {
  const { pageAt, control, effects } = fixture(t);
  const pending = deferred(); control.call = () => pending.promise;
  const page = pageAt('circle'); const old = page.onLoad({ id: 'circle-neighbors' }); await flush();
  page.onHide();
  const calls = effects.calls.length; await page.refresh(); await page.loadMore();
  assert.equal(effects.calls.length, calls);
  control.call = async () => ({ circle: { id: 'circle-neighbors', name: '当前内容分类' }, posts: [post('current')] });
  await page.onShow();
  const writes = effects.writes.length;
  pending.resolve({ circle: { id: 'circle-neighbors', name: '过期分类' }, posts: [post('old')] }); await old;
  assert.equal(effects.writes.length, writes);
  assert.deepEqual(page.data.posts.map(item => item.id), ['current']);
  assert.deepEqual(effects.titles, ['当前内容分类']);
  const late = deferred(); control.call = () => late.promise;
  const refresh = page.refresh(); await flush(); page.onUnload();
  const afterUnload = effects.writes.length;
  late.resolve({ circle: { id: 'circle-neighbors', name: '已关闭' }, posts: [post('closed')] }); await refresh;
  page.openPost(tap('current')); await page.loadMore(); await page.refresh();
  assert.equal(effects.writes.length, afterUnload);
  assert.deepEqual(effects.navigations, []);
});

test('failed loads retry, invalid topics do not become an unfiltered feed and stale card taps do not navigate', async t => {
  const { pageAt, control, effects } = fixture(t);
  control.call = async () => { throw Error('暂时断网'); };
  const page = pageAt('circle'); await page.onLoad({ topic: '行为观察' });
  assert.equal(page.data.error, '暂时断网');
  control.call = async () => ({ items: [post('restored')] }); await page.refresh();
  assert.equal(page.data.error, '');
  page.openPost(tap('unknown')); assert.deepEqual(effects.navigations, []);
  page.onHide(); page.openPost(tap('restored')); assert.deepEqual(effects.navigations, []);
  const invalid = pageAt('circle'); const before = effects.calls.length;
  await invalid.onLoad({ topic: '未知主题', id: 'circle-neighbors' });
  assert.match(invalid.data.error, /暂未找到/); assert.equal(effects.calls.length, before);
  const square = pageAt('circle-square'); square.onLoad(); square.openTopic(tap('unknown')); square.onHide(); square.openTopic(tap('健康护理'));
  assert.deepEqual(effects.navigations, []);
});

test('personal-mode guards never request circle data or open the unregistered topic routes', async t => {
  const { pageAt, effects, control } = fixture(t);
  shared.personalMode = true;
  const square = pageAt('circle-square'); square.onLoad(); square.openTopic(tap('健康护理'));
  assert.deepEqual(effects.navigations, []);
  const legacy = pageAt('circle'); await legacy.onLoad({ id: 'circle-neighbors' }); await legacy.loadMore();
  assert.match(legacy.data.error, /当前版本/); assert.deepEqual(effects.calls, []);
  control.call = async (action, payload) => { assert.equal(action, 'listPosts'); assert.equal(payload.circleId, undefined); return { items: [] }; };
  const topic = pageAt('circle'); await topic.onLoad({ topic: '健康护理' });
  assert.equal(topic.data.error, ''); assert.deepEqual(effects.calls.map(item => item.action), ['listPosts']);
});
