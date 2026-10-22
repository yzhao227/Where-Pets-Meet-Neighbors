'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../miniprogram/services/api');
const preferences = require('../miniprogram/data/feed-preferences');

// All API results, image events and storage below are synthetic and in memory.
// This suite never opens a browser or connects to the user's local data service.
function post(id, overrides = {}) {
  return Object.assign({
    id, title: '测试小动物 ' + id, text: '用于发现页行为测试。',
    author: { id: 'author-' + id, nickname: '测试邻居' },
    images: ['https://example.invalid/' + id + '.jpg'], animalTypes: ['cat'],
    topics: ['陪伴日常'], kind: 'daily', createdAt: 0, likeCount: 0, isLiked: false
  }, overrides);
}

function fixture(t, handler, excludedAnimalTypes = []) {
  const previous = { wx: global.wx, Page: global.Page, call: api.call, getFeedVersion: api.getFeedVersion };
  const stored = new Map([[preferences.KEY, { version: 1, excludedAnimalTypes }]]);
  const effects = { calls: [], storageWrites: [], storageReads: [], toasts: [], navigations: [], feedVersion: 0 };
  global.wx = {
    getStorageSync(key) { effects.storageReads.push(key); return structuredClone(stored.get(key)); },
    setStorageSync(key, value) {
      effects.storageWrites.push({ key, value: structuredClone(value) });
      stored.set(key, structuredClone(value));
    },
    showToast(options) { effects.toasts.push(options.title); },
    navigateTo(options) { effects.navigations.push(options.url); },
    stopPullDownRefresh() {}
  };
  api.call = async (action, payload = {}) => {
    effects.calls.push({ action, payload: structuredClone(payload) });
    if (action === 'bootstrap') return { mode: 'demo', user: { id: 'test-user' }, circles: [] };
    return structuredClone(await handler(action, payload));
  };
  api.getFeedVersion = () => effects.feedVersion;
  t.after(() => { global.wx = previous.wx; global.Page = previous.Page; api.call = previous.call; api.getFeedVersion = previous.getFeedVersion; });
  return { effects, stored };
}

async function mount(t) {
  let definition;
  global.Page = value => { definition = value; };
  const source = require.resolve('../miniprogram/pages/community/index');
  delete require.cache[source];
  require(source);
  assert.ok(definition, 'community page registers');
  const page = Object.assign({}, definition, {
    data: structuredClone(definition.data), writesAfterUnload: 0,
    setData(values) {
      if (this._closed) this.writesAfterUnload += 1;
      Object.assign(this.data, values);
    }
  });
  t.after(() => page.onUnload());
  await page.onLoad();
  assert.equal(page.data.error, '');
  assert.equal(page.data.loading, false);
  return page;
}

function event(dataset = {}, detail = {}) { return { currentTarget: { dataset }, detail }; }
function coverEvent(card, detail) {
  return event({ id: card.id, src: card.coverSrc, attempt: String(card.coverAttempt) }, detail);
}
function columnPositions(page) {
  return Object.fromEntries(page.data.postColumns.flatMap(column => column.posts.map((item, index) => [item.id, { column: column.id, index }])));
}
function displayedPost(page, id) {
  return page.data.postColumns.flatMap(column => column.posts).find(item => item.id === id);
}
async function settle(page) {
  for (let i = 0; i < 20 && page.data.loading; i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.loading, false, 'refresh completes');
  assert.equal(page.data.error, '');
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('signed cover retry reauthorizes only its card and preserves loaded pages and column positions', async t => {
  const pending = deferred();
  const expired = 'https://example.invalid/signed.jpg?signature=expired', renewed = expired.replace('expired', 'renewed');
  const signed = url => post('signed-card', { mediaSigned: true, images: [url] });
  const { effects } = fixture(t, async (action, payload) => {
    if (action === 'listPosts') return payload.cursor ? { items: [post('third'), post('fourth')], nextCursor: 'page-3' }
      : { items: [signed(expired), post('second')], nextCursor: 'page-2' };
    if (action === 'getPost') { assert.equal(payload.id, 'signed-card'); return pending.promise; }
    throw Error(action);
  });
  const page = await mount(t); await page.loadMore();
  const original = structuredClone(page.data.posts[0]); page.onCoverError(coverEvent(original));
  assert.equal(page.data.posts[0].coverState, 'error');
  const positions = columnPositions(page), untouched = structuredClone(page.data.posts.slice(1));
  const retry = page.retryCover(coverEvent(original));
  await page.retryCover(coverEvent(original));
  assert.equal(effects.calls.filter(call => call.action === 'getPost').length, 1);
  assert.equal(page.data.posts[0].coverState, 'error', 'the expired URL is not mounted for another image attempt');
  assert.equal(page.data.loading, false); assert.equal(page.data.nextCursor, 'page-3');
  pending.resolve({ post: signed(renewed) }); await retry;
  assert.equal(page.data.posts[0].coverSrc, renewed); assert.equal(page.data.posts[0].coverState, 'loading');
  assert.ok(page.data.posts[0].coverAttempt > original.coverAttempt);
  assert.deepEqual(page.data.posts.slice(1), untouched); assert.deepEqual(columnPositions(page), positions);
  assert.equal(page.data.nextCursor, 'page-3');
  assert.equal(effects.calls.filter(call => call.action === 'listPosts').length, 2);
  page.onCoverError(coverEvent(original)); page.onCoverLoad(coverEvent(original, { width: 100, height: 100 }));
  assert.equal(displayedPost(page, 'signed-card').coverSrc, renewed);
  assert.equal(displayedPost(page, 'signed-card').coverState, 'loading');
});

test('signed cover authorization failure stays retryable and revoked access removes only the affected card', async t => {
  let code = 'NETWORK_ERROR';
  const { effects } = fixture(t, async (action, payload) => {
    if (action === 'listPosts') return payload.cursor ? { items: [post('loaded-tail')], nextCursor: 'page-3' }
      : { items: [post('protected', { mediaSigned: true }), post('public')], nextCursor: 'page-2' };
    if (action === 'getPost') throw Object.assign(Error('仅内存授权读取失败'), { code });
    throw Error(action);
  });
  const page = await mount(t); await page.loadMore();
  const card = structuredClone(page.data.posts[0]); page.onCoverError(coverEvent(card));
  await page.retryCover(coverEvent(card));
  assert.deepEqual(page.data.posts.map(item => item.id), ['protected', 'public', 'loaded-tail']);
  assert.equal(page.data.posts[0].coverState, 'error'); assert.equal(page.data.posts[0].coverAttempt, card.coverAttempt);
  assert.equal(page.data.busy, false); assert.ok(effects.toasts.length);
  code = 'NOT_FOUND'; await page.retryCover(coverEvent(card));
  assert.deepEqual(page.data.posts.map(item => item.id), ['public', 'loaded-tail']);
  assert.equal(displayedPost(page, 'protected'), undefined); assert.equal(page.data.nextCursor, 'page-3');
  assert.equal(page.data.error, ''); assert.equal(page.data.loading, false);
  assert.equal(effects.calls.filter(call => call.action === 'listPosts').length, 2);
});

test('late signed-cover reauthorization cannot replace or remove the same card in a newer filter', async t => {
  let pending = deferred();
  const { effects } = fixture(t, async (action, payload) => {
    if (action === 'listPosts') return { items: [post('same-card', { mediaSigned: true, images: ['https://example.invalid/' + (payload.animalType || 'all') + '.jpg?signature=current'] })], nextCursor: 'next-' + (payload.animalType || 'all') };
    if (action === 'getPost') return pending.promise.then(value => { if (value.denied) throw Object.assign(Error('仅内存旧请求撤权'), { code: 'NOT_FOUND' }); return value; });
    throw Error(action);
  });
  const page = await mount(t);
  const original = structuredClone(page.data.posts[0]); page.onCoverError(coverEvent(original));
  const old = page.retryCover(coverEvent(original));
  await page.selectAnimal(event({ id: 'cat' }));
  const filtered = structuredClone(page.data.posts);
  pending.resolve({ post: post('same-card', { mediaSigned: true, images: ['https://example.invalid/obsolete.jpg?signature=late'] }) }); await old;
  assert.deepEqual(page.data.posts, filtered); assert.equal(page.data.nextCursor, 'next-cat');
  pending = deferred();
  const second = structuredClone(page.data.posts[0]); page.onCoverError(coverEvent(second));
  const staleDenied = page.retryCover(coverEvent(second));
  await page.selectAnimal(event({ id: 'dog' }));
  const newest = structuredClone(page.data.posts);
  pending.resolve({ denied: true }); await staleDenied;
  assert.deepEqual(page.data.posts, newest); assert.equal(page.data.animalType, 'dog'); assert.equal(page.data.nextCursor, 'next-dog');
  assert.equal(effects.calls.filter(call => call.action === 'getPost').length, 2);
});
async function settleMore(page) {
  for (let i = 0; i < 20 && (page.data.moreBusy || page._moreTask); i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.moreBusy, false, 'pagination completes');
  assert.ok(!page._moreTask, 'pagination releases its task lock');
}

test('bottom reach waits for all current covers including fallback and consumes one continuation', async t => {
  const pending = deferred();
  const source = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/960px-Example.jpg';
  let continuation = 0;
  const { effects } = fixture(t, async (action, payload) => {
    assert.equal(action, 'listPosts');
    if (!payload.cursor) return { items: [post('editorial', { images: [source], catalogManaged: true }), post('ordinary')], nextCursor: 'page-2' };
    continuation += 1;
    if (continuation === 1) return pending.promise;
    return { items: [post('last')], nextCursor: null };
  });
  const page = await mount(t);
  page.onReachBottom();
  page.onReachBottom();
  assert.equal(page.data.waitingForCovers, true);
  assert.equal(continuation, 0);
  const thumbnail = structuredClone(page.data.posts[0]);
  page.onCoverError(coverEvent(thumbnail));
  assert.equal(page.data.posts[0].coverState, 'loading', 'the original source fallback is still in flight');
  const fallback = structuredClone(page.data.posts[0]);
  page.onCoverLoad(coverEvent(page.data.posts[1], { width: 500, height: 500 }));
  assert.equal(page.data.waitingForCovers, true);
  assert.equal(continuation, 0);
  page.onCoverError(coverEvent(fallback));
  assert.equal(page.data.waitingForCovers, false, 'a final image failure does not block more content');
  assert.equal(page.data.moreBusy, true);
  assert.equal(continuation, 1);
  page.onReachBottom();
  page.onCoverLoad(coverEvent(thumbnail, { width: 500, height: 500 }));
  assert.equal(continuation, 1, 'repeat reach and stale callbacks cannot add concurrent requests');
  pending.resolve({ items: [post('next')], nextCursor: 'page-3' });
  await settleMore(page);
  page.onCoverLoad(coverEvent(page.data.posts.find(item => item.id === 'next'), { width: 500, height: 500 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(continuation, 1, 'settling the newly appended page does not chain another request');
  await page.onReachBottom();
  assert.equal(continuation, 2, 'a fresh bottom reach can continue');
  assert.equal(effects.calls.filter(call => call.action === 'listPosts').length, 3);
});

test('cover waiting has a four-second ceiling without delaying already-ready images', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let continuation = 0;
  fixture(t, async (action, payload) => {
    assert.equal(action, 'listPosts');
    if (!payload.cursor) return { items: [post('first')], nextCursor: 'page-2' };
    continuation += 1;
    return { items: [post('next', { images: [] })], nextCursor: 'page-3' };
  });
  const page = await mount(t);
  page.onReachBottom();
  t.mock.timers.tick(3999);
  assert.equal(continuation, 0);
  assert.equal(page.data.waitingForCovers, true);
  t.mock.timers.tick(1);
  await settleMore(page);
  assert.equal(continuation, 1, 'an unresponsive external image cannot block the feed forever');
  assert.equal(page.data.waitingForCovers, false);
  page.onCoverLoad(coverEvent(page.data.posts[0], { width: 500, height: 500 }));
  assert.equal(continuation, 1);
  await page.onReachBottom();
  assert.equal(continuation, 2, 'ready images continue immediately without another timer');
});

test('refresh, filter changes and unload cancel pending cover continuation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let continuation = 0;
  fixture(t, async (action, payload) => {
    assert.equal(action, 'listPosts');
    if (payload.cursor) { continuation += 1; return { items: [post('unwanted')] }; }
    return { items: [post(payload.topic || 'initial')], nextCursor: 'more-' + (payload.topic || 'initial') };
  });
  const page = await mount(t);
  const old = structuredClone(page.data.posts[0]);
  page.onReachBottom();
  page.selectTopic(event({ topic: '陪伴日常' }));
  await settle(page);
  assert.equal(page.data.waitingForCovers, false);
  page.onCoverLoad(coverEvent(old, { width: 500, height: 500 }));
  t.mock.timers.tick(4000);
  await settleMore(page);
  assert.equal(continuation, 0, 'an old filter wait cannot fetch for the new filter');
  page.onReachBottom();
  assert.equal(page.data.waitingForCovers, true);
  await page.refresh();
  t.mock.timers.tick(4000);
  assert.equal(page.data.waitingForCovers, false);
  assert.equal(continuation, 0);
  page.onReachBottom();
  const current = structuredClone(page.data.posts[0]);
  page.onUnload();
  t.mock.timers.tick(4000);
  page.onCoverError(coverEvent(current));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(continuation, 0);
  assert.equal(page.writesAfterUnload, 0);
});

test('empty scan pages advance automatically until content appears with a bounded request budget', async t => {
  let empty = false;
  let calls = 0;
  fixture(t, async (action, payload) => {
    assert.equal(action, 'listPosts');
    calls += 1;
    const cursor = Number(payload.cursor || 0);
    if (!empty && cursor === 2) return { items: [post('found')], nextCursor: '3' };
    return { items: [], nextCursor: String(cursor + 1) };
  });
  const page = await mount(t);
  assert.equal(calls, 3, 'an initially empty feed advances without a manual load button');
  assert.deepEqual(page.data.posts.map(item => item.id), ['found']);
  assert.equal(page.data.nextCursor, '3');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3, 'visible content ends the automatic scan');
  empty = true;
  calls = 0;
  await page.refresh();
  assert.equal(calls, 5, 'the first page plus at most four empty continuation pages are scanned');
  assert.equal(page.data.nextCursor, '5');
  assert.equal(page.data.moreBusy, false);
  await page.onReachBottom();
  assert.equal(calls, 9, 'another reach grants a new bounded scan');
});

test('each column prioritizes its first two covers and later images remain lazy through loads and pagination', async t => {
  const { effects } = fixture(t, async (action, payload) => {
    assert.equal(action, 'listPosts');
    return payload.cursor
      ? { items: [post('later-a'), post('later-b')] }
      : { items: Array.from({ length: 12 }, (_, index) => post('item-' + index)), nextCursor: 'next' };
  });
  const page = await mount(t);
  const assertPriorities = () => {
    for (const column of page.data.postColumns) {
      column.posts.forEach((item, index) => assert.equal(item.coverLazy, index >= 2));
    }
  };
  assertPriorities();
  const position = columnPositions(page);
  const first = page.data.posts[0];
  page.onCoverLoad(coverEvent(first, { width: 500, height: 500 }));
  await page.loadMore();
  assertPriorities();
  for (const [id, value] of Object.entries(position)) assert.deepEqual(columnPositions(page)[id], value);
  assert.equal(page.data.postColumns.flatMap(column => column.posts).filter(item => !item.coverLazy).length, 4);
  const beforeTopicEntry = columnPositions(page), calls = effects.calls.length;
  page.selectFeed(event({ id: 'circles' }));
  await settle(page);
  assert.equal(effects.navigations.at(-1), '/pages/circle-square/index');
  assert.equal(effects.calls.length, calls, 'opening the topic guide does not replace the loaded feed');
  assert.equal(page.data.postColumns.length, 2);
  assert.deepEqual(columnPositions(page), beforeTopicEntry);
  assertPriorities();
});


test('the topic entry preserves feed filters and loaded cards while retired circle state never reaches listPosts', async t => {
  const { effects, stored } = fixture(t, async action => {
    assert.equal(action, 'listPosts');
    return { items: [post('one'), post('two')], nextCursor: 'next-page' };
  }, ['reptile']);
  const page = await mount(t);
  page.setData({ feed: 'following', query: '饮水', searchInput: '饮水', topic: '健康护理', animalType: 'cat', selectedCircle: 'legacy-circle' });
  await page.refresh();
  const expectedFilters = { feed: 'following', query: '饮水', searchInput: '饮水', topic: '健康护理', animalType: 'cat', excludedAnimalTypes: ['reptile'] };
  const cards = structuredClone(page.data.postColumns), calls = effects.calls.length;
  const savedPreferences = structuredClone(stored.get(preferences.KEY));
  assert.equal(page.data.feeds.find(item => item.id === 'circles').name, '主题');
  assert.equal(typeof page.selectCircle, 'undefined');
  await page.selectFeed(event({ id: 'circles' }));
  assert.deepEqual(effects.navigations, ['/pages/circle-square/index']);
  assert.equal(effects.calls.length, calls);
  for (const [key, value] of Object.entries(expectedFilters)) assert.deepEqual(page.data[key], value, key);
  assert.deepEqual(page.data.postColumns, cards);
  assert.equal(page.data.nextCursor, 'next-page');
  assert.deepEqual(stored.get(preferences.KEY), savedPreferences);
  page.onHide(); await page.onShow();
  assert.equal(effects.calls.filter(call => call.action === 'listPosts').length, 2, 'returning from the guide keeps the previous feed pages');
  for (const [key, value] of Object.entries(expectedFilters)) assert.deepEqual(page.data[key], value, key);
  page.setData({ feed: 'circles', selectedCircle: 'retired-saved-circle' });
  await page.refresh();
  const payload = effects.calls.filter(call => call.action === 'listPosts').at(-1).payload;
  assert.equal(payload.feed, 'discover'); assert.equal(payload.circleId, undefined);
  assert.equal(payload.query, '饮水'); assert.equal(payload.topic, '健康护理');
  assert.equal(payload.animalType, 'cat'); assert.deepEqual(payload.excludedAnimalTypes, ['reptile']);
  assert.ok(effects.calls.every(call => call.action !== 'joinCircle' && (call.action !== 'listPosts' || call.payload.feed !== 'circles' && !call.payload.circleId)));
  assert.equal(page.data.postColumns.length, 2);
  const finalCalls = effects.calls.length, finalNavigations = effects.navigations.length;
  page.selectFeed(event({ id: 'unknown' }));
  assert.equal(effects.calls.length, finalCalls); assert.equal(effects.navigations.length, finalNavigations);
});

test('editorial thumbnails fall back once without losing their original source or accepting old events', async t => {
  const source = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/960px-Example.jpg';
  const item = post('catalog-example', { images: [source], catalogManaged: true });
  fixture(t, async action => {
    assert.equal(action, 'listPosts');
    return { items: [item] };
  });
  const page = await mount(t);
  const first = structuredClone(page.data.posts[0]);
  assert.equal(first.cover, source);
  assert.equal(first.coverSrc, source.replace('960px-', '500px-'));
  page.onCoverError(coverEvent(first));
  const fallback = structuredClone(page.data.posts[0]);
  assert.equal(fallback.coverSrc, source);
  assert.equal(fallback.coverState, 'loading');
  assert.ok(fallback.coverAttempt > first.coverAttempt);
  page.onCoverLoad(coverEvent(first, { width: 500, height: 500 }));
  assert.equal(page.data.posts[0].coverState, 'loading');
  page.onCoverLoad(coverEvent(fallback, { width: 960, height: 960 }));
  await page.refresh();
  assert.equal(page.data.posts[0].coverSrc, source);
  assert.equal(page.data.posts[0].coverState, 'ready');
  assert.equal(page.data.posts[0].coverAttempt, fallback.coverAttempt);
  assert.deepEqual(page.data.posts[0].images, [source]);
});

test('pagination appends new cards once and likes update both the feed and its stable columns', async t => {
  const first = [post('a', { coverWidth: 300, coverHeight: 400 }), post('b'), post('c')];
  const { effects } = fixture(t, async (action, payload) => {
    if (action === 'listPosts') return payload.cursor
      ? { items: [post('b', { title: '分页中的更新标题' }), post('d'), post('d'), post('e')], nextCursor: null }
      : { items: first, nextCursor: 'page-2' };
    if (action === 'likePost') return { post: post(payload.id, { likeCount: 1, isLiked: true }) };
    throw new Error('Unexpected test action: ' + action);
  });
  const page = await mount(t);
  const before = columnPositions(page);
  await Promise.all([page.loadMore(), page.loadMore()]);
  assert.equal(effects.calls.filter(call => call.action === 'listPosts' && call.payload.cursor).length, 1, 'repeated taps issue one page request');
  assert.deepEqual(page.data.posts.map(item => item.id), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(page.data.postColumns.flatMap(column => column.posts).length, 5);
  assert.equal(displayedPost(page, 'b').title, '分页中的更新标题');
  for (const [id, position] of Object.entries(before)) assert.deepEqual(columnPositions(page)[id], position, id + ' remains in place');
  const afterAppend = columnPositions(page);
  await Promise.all([page.like(event({ id: 'b' })), page.like(event({ id: 'b' }))]);
  assert.equal(effects.calls.filter(call => call.action === 'likePost').length, 1);
  for (const item of [page.data.posts.find(item => item.id === 'b'), displayedPost(page, 'b')]) {
    assert.equal(item.isLiked, true);
    assert.equal(item.likeCount, 1);
  }
  assert.deepEqual(columnPositions(page), afterAppend, 'an interaction never moves a card');
});

test('cover error and retry ignore old attempts without moving a card or its reserved frame', async t => {
  fixture(t, async action => {
    assert.equal(action, 'listPosts');
    return { items: [post('a'), post('b'), post('c')] };
  });
  const page = await mount(t);
  const before = columnPositions(page);
  const first = structuredClone(page.data.posts[0]);
  page.onCoverError(coverEvent(first));
  assert.equal(displayedPost(page, 'a').coverState, 'error');
  page.retryCover(coverEvent(first));
  const retry = structuredClone(page.data.posts[0]);
  assert.equal(retry.coverState, 'loading');
  assert.ok(retry.coverAttempt > first.coverAttempt);
  page.onCoverLoad(coverEvent(first, { width: 300, height: 400 }));
  page.onCoverError(coverEvent(first));
  page.retryCover(coverEvent(first));
  assert.equal(displayedPost(page, 'a').coverState, 'loading', 'previous attempt callbacks are ignored');
  assert.equal(displayedPost(page, 'a').coverAttempt, retry.coverAttempt);
  page.onCoverLoad(coverEvent(retry, { width: 300, height: 400 }));
  for (const item of [page.data.posts[0], displayedPost(page, 'a')]) {
    assert.equal(item.coverState, 'ready');
    assert.equal(item.coverRatio, first.coverRatio, 'actual image dimensions do not resize the reserved frame');
    assert.equal(item.coverMode, 'aspectFill', 'a normal portrait fills the reserved square frame');
  }
  page.onCoverError(coverEvent(retry));
  assert.equal(displayedPost(page, 'a').coverState, 'ready', 'late error cannot replace a successful load');
  assert.deepEqual(columnPositions(page), before);
});

test('same-id cover replacements and unloaded pages reject stale image events', async t => {
  let current = post('a');
  fixture(t, async action => {
    assert.equal(action, 'listPosts');
    return { items: [current, post('b')] };
  });
  const page = await mount(t);
  const first = structuredClone(page.data.posts[0]);
  const before = columnPositions(page);
  current = post('a', { images: ['https://example.invalid/replaced.jpg'] });
  await page.refresh();
  const replacement = structuredClone(page.data.posts[0]);
  assert.notEqual(replacement.coverSrc, first.coverSrc);
  assert.ok(replacement.coverAttempt > first.coverAttempt);
  page.onCoverLoad(coverEvent(first, { width: 300, height: 400 }));
  page.onCoverError(coverEvent(first));
  page.retryCover(coverEvent(first));
  assert.equal(displayedPost(page, 'a').coverState, 'loading');
  assert.equal(displayedPost(page, 'a').coverSrc, replacement.coverSrc);
  page.onCoverLoad(coverEvent(replacement, { width: 400, height: 400 }));
  assert.equal(displayedPost(page, 'a').coverState, 'ready');
  current = post('a');
  await page.refresh();
  const restored = structuredClone(page.data.posts[0]);
  assert.equal(restored.coverSrc, first.coverSrc);
  assert.ok(restored.coverAttempt > replacement.coverAttempt, 'returning to an old URL still starts a distinct attempt');
  page.onCoverError(coverEvent(first));
  assert.equal(displayedPost(page, 'a').coverState, 'loading');
  assert.deepEqual(columnPositions(page), before);
  const snapshot = structuredClone(page.data);
  page.onUnload();
  page.onCoverLoad(coverEvent(restored, { width: 400, height: 400 }));
  page.onCoverError(coverEvent(restored));
  page.retryCover(coverEvent(restored));
  assert.equal(page.writesAfterUnload, 0);
  assert.deepEqual(page.data, snapshot);
});

test('animal selection closes the sheet, displays its condition and never writes passive preferences', async t => {
  const { effects } = fixture(t, async action => {
    assert.equal(action, 'listPosts');
    return { items: [] };
  }, ['reptile']);
  const page = await mount(t);
  assert.deepEqual(page.data.excludedAnimalTypes, ['reptile']);
  assert.match(page.data.animalFilterLabel, /隐藏 1 类/);
  page.toggleAnimalFilters();
  assert.equal(page.data.animalFiltersOpen, true);
  await page.selectAnimal(event({ id: 'cat' }));
  assert.equal(page.data.animalFiltersOpen, false);
  assert.equal(page.data.animalType, 'cat');
  assert.match(page.data.animalFilterLabel, /^只看猫/);
  assert.match(page.data.animalFilterLabel, /隐藏 1 类/);
  assert.equal(effects.calls.at(-1).payload.animalType, 'cat');
  page.toggleAnimalFilters();
  await page.selectAnimal(event({ id: 'unclassified' }));
  assert.match(page.data.animalFilterLabel, /^只看未标注/);
  page.toggleAnimalFilters();
  await page.selectAnimal(event({ id: 'reptile' }));
  assert.equal(page.data.animalFiltersOpen, true, 'a hidden species cannot become the active filter');
  assert.equal(page.data.animalType, 'unclassified');
  assert.match(effects.toasts.at(-1), /取消隐藏/);
  page.closeAnimalFilters();
  page.onHide();
  await page.refresh();
  assert.deepEqual(effects.storageReads, [preferences.KEY]);
  assert.deepEqual(effects.storageWrites, [], 'mount, selection, dismissal and refresh leave saved preferences untouched');
});

test('hidden animals support several choices in the open sheet and reset keeps the device preference', async t => {
  const { effects, stored } = fixture(t, async action => {
    assert.equal(action, 'listPosts');
    return { items: [] };
  }, ['reptile']);
  const page = await mount(t);
  await page.selectAnimal(event({ id: 'cat' }));
  page.toggleAnimalFilters();
  await page.toggleHiddenAnimal(event({ id: 'bird' }));
  await page.toggleHiddenAnimal(event({ id: 'cat' }));
  assert.equal(page.data.animalFiltersOpen, true, 'successive hiding choices stay in the same sheet');
  assert.deepEqual(page.data.excludedAnimalTypes, ['reptile', 'bird', 'cat']);
  assert.equal(page.data.animalType, '', 'hiding the active species clears the conflicting filter');
  assert.match(page.data.animalFilterLabel, /^动物筛选.*隐藏 3 类/);
  assert.equal(effects.storageWrites.length, 2);
  assert.deepEqual(stored.get(preferences.KEY).excludedAnimalTypes, ['reptile', 'bird', 'cat']);
  page.inputSearch(event({}, { value: '猫咪' }));
  page.search();
  await settle(page);
  page.selectTopic(event({ topic: '陪伴日常' }));
  await settle(page);
  page.resetFilters();
  await settle(page);
  assert.equal(page.data.query, '');
  assert.equal(page.data.topic, '');
  assert.deepEqual(page.data.excludedAnimalTypes, ['reptile', 'bird', 'cat']);
  assert.match(page.data.animalFilterLabel, /隐藏 3 类/);
  assert.equal(effects.storageWrites.length, 2, 'resetting content filters does not overwrite hidden species');
  const reopened = await mount(t);
  assert.deepEqual(reopened.data.excludedAnimalTypes, ['reptile', 'bird', 'cat'], 'saved device preferences survive a new page instance');
  reopened.toggleAnimalFilters();
  await reopened.clearHiddenAnimals();
  assert.equal(reopened.data.animalFiltersOpen, true);
  assert.deepEqual(reopened.data.excludedAnimalTypes, []);
  assert.deepEqual(stored.get(preferences.KEY).excludedAnimalTypes, []);
  assert.equal(effects.storageWrites.length, 3, 'only explicit hide and clear actions save preferences');
});

test('search and topic continue together through pagination and a stale page cannot enter the new filter', async t => {
  const oldPage = deferred();
  let waitForOldPage = false;
  const { effects } = fixture(t, async (action, payload) => {
    assert.equal(action, 'listPosts');
    if (payload.cursor && waitForOldPage) return oldPage.promise;
    const suffix = payload.topic || 'all';
    return payload.cursor
      ? { items: [post('more-' + suffix)], nextCursor: null }
      : { items: [post('first-' + suffix)], nextCursor: 'next-' + suffix };
  }, ['reptile']);
  const page = await mount(t);
  page.inputSearch(event({}, { value: '  散步  ' }));
  page.search();
  await settle(page);
  page.selectTopic(event({ topic: '户外出行' }));
  await settle(page);
  await page.selectAnimal(event({ id: 'cat' }));
  page.selectFeed(event({ id: 'following' }));
  await settle(page);
  const expected = { feed: 'following', topic: '户外出行', query: '散步', circleId: undefined, animalType: 'cat', excludedAnimalTypes: ['reptile'] };
  const before = columnPositions(page);
  await page.loadMore();
  assert.deepEqual(effects.calls.at(-1).payload, { ...expected, cursor: 'next-户外出行' });
  assert.deepEqual(page.data.posts.map(item => item.id), ['first-户外出行', 'more-户外出行']);
  assert.deepEqual(columnPositions(page)['first-户外出行'], before['first-户外出行']);
  await page.refresh();
  waitForOldPage = true;
  const pending = page.loadMore();
  page.selectTopic(event({ topic: '陪伴日常' }));
  await settle(page);
  oldPage.resolve({ items: [post('stale-page')], nextCursor: null });
  await pending;
  assert.deepEqual(page.data.posts.map(item => item.id), ['first-陪伴日常']);
  assert.deepEqual(page.data.postColumns.flatMap(column => column.posts.map(item => item.id)), ['first-陪伴日常']);
  assert.equal(page.data.nextCursor, 'next-陪伴日常');
  assert.equal(page.data.query, '散步');
  waitForOldPage = false;
  await page.loadMore();
  assert.deepEqual(effects.calls.at(-1).payload, { ...expected, topic: '陪伴日常', cursor: 'next-陪伴日常' });
  page.clearSearch();
  await settle(page);
  assert.equal(page.data.topic, '陪伴日常');
  assert.equal(page.data.query, '');
  assert.equal(effects.calls.at(-1).payload.query, undefined);
});

test('returning from a detail retains all feed pages and updates the opened card in place', async t => {
  const { effects } = fixture(t, async (action, payload) => {
    if (action === 'listPosts') return payload.cursor
      ? { items: [post('c'), post('d')], nextCursor: 'page-3' }
      : { items: [post('a'), post('b')], nextCursor: 'page-2' };
    if (action === 'getPost') return { post: post(payload.id, { likeCount: 2, isLiked: true, commentCount: 3 }) };
    throw new Error(action);
  });
  const page = await mount(t);
  await page.loadMore();
  page.onCoverLoad(coverEvent(page.data.posts[2], { width: 600, height: 800 }));
  const before = structuredClone(page.data.posts);
  const positions = columnPositions(page);
  const writes = [];
  const setData = page.setData;
  page.setData = function (values) { writes.push(values); setData.call(this, values); };
  page.openPost(event({ id: 'c' }));
  page.onHide();
  await page.onShow();
  assert.deepEqual(page.data.posts.map(item => item.id), ['a', 'b', 'c', 'd']);
  assert.equal(page.data.nextCursor, 'page-3');
  assert.deepEqual(columnPositions(page), positions);
  assert.equal(page.data.posts[2].coverState, 'ready');
  assert.equal(page.data.posts[2].coverRatio, before[2].coverRatio);
  assert.equal(page.data.posts[2].coverAttempt, before[2].coverAttempt);
  assert.equal(displayedPost(page, 'c').likeCount, 2);
  assert.equal(displayedPost(page, 'c').commentCount, 3);
  assert.ok(writes.every(value => value.loading !== true), 'the list must never unmount on return');
  assert.equal(effects.calls.filter(call => call.action === 'listPosts').length, 2);
  assert.deepEqual(effects.navigations, ['/pages/post/index?id=c']);
});

test('tab return keeps cached filters and pagination while an explicit refresh loads the first page', async t => {
  const { effects } = fixture(t, async (action, payload) => {
    assert.equal(action, 'listPosts');
    return { items: [post(payload.cursor ? 'second' : 'first')], nextCursor: payload.cursor ? 'page-3' : 'page-2' };
  });
  const page = await mount(t);
  await page.selectAnimal(event({ id: 'cat' }));
  await page.loadMore();
  const snapshot = structuredClone(page.data.posts);
  const calls = effects.calls.filter(call => call.action === 'listPosts').length;
  page.onHide();
  await page.onShow();
  assert.deepEqual(page.data.posts, snapshot);
  assert.equal(page.data.animalType, 'cat');
  assert.equal(page.data.nextCursor, 'page-3');
  assert.equal(effects.calls.filter(call => call.action === 'listPosts').length, calls);
  await page.onPullDownRefresh();
  assert.deepEqual(page.data.posts.map(item => item.id), ['first']);
  assert.equal(page.data.nextCursor, 'page-2');
});

test('failed detail revalidation keeps the cached feed, and deletion removes only that card', async t => {
  let code = 'NETWORK_ERROR';
  fixture(t, async (action, payload) => {
    if (action === 'listPosts') return { items: [post('a'), post('b')], nextCursor: 'page-2' };
    if (action === 'getPost') throw Object.assign(new Error('Synthetic unavailable response'), { code });
    throw new Error(action);
  });
  const page = await mount(t);
  page.openPost(event({ id: 'a' }));
  page.onHide();
  await page.onShow();
  assert.equal(page.data.error, '');
  assert.equal(page.data.loading, false);
  assert.deepEqual(page.data.posts.map(item => item.id), ['a', 'b']);
  assert.equal(page.data.nextCursor, 'page-2');
  code = 'NOT_FOUND';
  page.onHide();
  await page.onShow();
  assert.deepEqual(page.data.posts.map(item => item.id), ['b']);
  assert.equal(page.data.nextCursor, 'page-2');
});

test('late detail revalidation cannot overwrite a changed filter or a newer like action', async t => {
  let pending = deferred();
  fixture(t, async (action, payload) => {
    if (action === 'listPosts') return { items: [post(payload.animalType || 'a')] };
    if (action === 'getPost') return pending.promise;
    if (action === 'likePost') return { post: post('cat', { likeCount: 1, isLiked: true }) };
    throw new Error(action);
  });
  const page = await mount(t);
  page.openPost(event({ id: 'a' }));
  page.onHide();
  const returning = page.onShow();
  await page.selectAnimal(event({ id: 'cat' }));
  pending.resolve({ post: post('a', { likeCount: 20 }) });
  await returning;
  assert.deepEqual(page.data.posts.map(item => item.id), ['cat']);
  pending = deferred();
  page.openPost(event({ id: 'cat' }));
  page.onHide();
  const nextReturn = page.onShow();
  await page.like(event({ id: 'cat' }));
  pending.resolve({ post: post('cat', { likeCount: 0, isLiked: false }) });
  await nextReturn;
  assert.equal(page.data.posts[0].likeCount, 1);
  assert.equal(page.data.posts[0].isLiked, true);
});

test('an account change discards the previous account feed instead of retaining its interaction state', async t => {
  let account = 'test-user';
  fixture(t, async (action, payload) => {
    assert.equal(action, 'listPosts');
    return { items: [post(account + (payload.cursor ? '-tail' : ''))], nextCursor: 'next' };
  });
  const call = api.call;
  api.call = (action, payload) => action === 'bootstrap'
    ? Promise.resolve({ mode: 'demo', user: { id: account }, circles: [] }) : call(action, payload);
  const page = await mount(t);
  await page.loadMore();
  account = 'another-account';
  page.onHide();
  await page.onShow();
  assert.equal(page.data.user.id, account);
  assert.deepEqual(page.data.posts.map(item => item.id), [account]);
});

test('leaving the feed retires pending pagination without overwriting revalidated or deleted cards', async t => {
  for (const deleted of [false, true]) await t.test(deleted ? 'deleted card' : 'updated card', async t => {
    const pending = deferred();
    let continuations = 0;
    fixture(t, async (action, payload) => {
      if (action === 'listPosts') {
        if (!payload.cursor) return { items: [post('a'), post('b')], nextCursor: 'page-2' };
        return ++continuations === 1 ? pending.promise : { items: [post('c')], nextCursor: 'page-3' };
      }
      if (action === 'getPost') {
        if (deleted) throw Object.assign(new Error('Deleted'), { code: 'NOT_FOUND' });
        return { post: post('a', { likeCount: 3, isLiked: true }) };
      }
      throw new Error(action);
    });
    const page = await mount(t);
    const loading = page.loadMore();
    page.openPost(event({ id: 'a' }));
    page.onHide();
    assert.equal(page.data.moreBusy, false);
    assert.equal(page._moreTask, null);
    await page.onShow();
    pending.resolve({ items: [post('a'), post('obsolete')], nextCursor: 'stale-cursor' });
    await loading;
    assert.equal(page.data.nextCursor, 'page-2');
    assert.deepEqual(page.data.posts.map(item => item.id), deleted ? ['b'] : ['a', 'b']);
    if (!deleted) assert.equal(page.data.posts[0].likeCount, 3);
    await page.loadMore();
    assert.equal(page.data.nextCursor, 'page-3');
    assert.deepEqual(page.data.posts.map(item => item.id), deleted ? ['b', 'c'] : ['a', 'b', 'c']);
  });
});

test('an earlier like response cannot overwrite a newer filter or account result', async t => {
  for (const change of ['filter', 'account']) await t.test(change, async t => {
    const pending = deferred();
    let account = 'test-user';
    fixture(t, async action => {
      if (action === 'listPosts' || action === 'getPost') return action === 'listPosts'
        ? { items: [post('a')] } : { post: post('a', { commentCount: 7 }) };
      if (action === 'likePost') return pending.promise;
      throw new Error(action);
    });
    const call = api.call;
    api.call = (action, payload) => action === 'bootstrap'
      ? Promise.resolve({ mode: 'demo', user: { id: account }, circles: [] }) : call(action, payload);
    const page = await mount(t);
    const liking = page.like(event({ id: 'a' }));
    if (change === 'filter') await page.selectAnimal(event({ id: 'cat' }));
    else {
      account = 'another-user';
      page.onHide();
      await page.onShow();
    }
    pending.resolve({ post: post('a', { likeCount: 1, isLiked: true }) });
    await liking;
    assert.equal(page.data.posts[0].isLiked, false);
    assert.equal(page.data.posts[0].likeCount, 0);
    if (change === 'account') assert.equal(page.data.user.id, account);
  });
});

test('a successful pending like survives visiting another card before its response arrives', async t => {
  for (const phase of ['hidden', 'returned']) await t.test(phase, async t => {
    const pending = deferred();
    fixture(t, async (action, payload) => {
      if (action === 'listPosts') return { items: [post('a'), post('b')], nextCursor: 'page-2' };
      if (action === 'getPost') return { post: post(payload.id, { commentCount: 2 }) };
      if (action === 'likePost') return pending.promise;
      throw new Error(action);
    });
    const page = await mount(t);
    const liking = page.like(event({ id: 'a' }));
    page.openPost(event({ id: 'b' }));
    page.onHide();
    if (phase === 'returned') await page.onShow();
    pending.resolve({ post: post('a', { likeCount: 1, isLiked: true }) });
    await liking;
    if (phase === 'hidden') await page.onShow();
    assert.deepEqual(page.data.posts.map(item => item.id), ['a', 'b']);
    assert.equal(page.data.posts[0].isLiked, true);
    assert.equal(page.data.posts[0].likeCount, 1);
    assert.equal(page.data.posts[1].commentCount, 2);
    assert.equal(page.data.nextCursor, 'page-2');
  });
});

test('a mode change refreshes cached posts even when the user ID is unchanged', async t => {
  let mode = 'demo';
  fixture(t, async action => {
    assert.equal(action, 'listPosts');
    return { items: [post(mode)] };
  });
  const call = api.call;
  api.call = (action, payload) => action === 'bootstrap'
    ? Promise.resolve({ mode, user: { id: 'same-user' }, circles: [] }) : call(action, payload);
  const page = await mount(t);
  mode = 'cloud';
  page.onHide();
  await page.onShow();
  assert.equal(page.data.mode, 'cloud');
  assert.deepEqual(page.data.posts.map(item => item.id), ['cloud']);
});

test('a collection change during revalidation or refresh is not marked as already loaded', async t => {
  for (const phase of ['resume', 'refresh']) await t.test(phase, async t => {
    const pending = deferred();
    let requests = 0;
    const { effects } = fixture(t, async action => {
      if (action === 'listPosts') {
        requests += 1;
        if (phase === 'refresh' && requests === 2) return pending.promise;
        return { items: [post(effects.feedVersion ? 'new' : 'old')] };
      }
      if (action === 'getPost') return pending.promise;
      throw new Error(action);
    });
    const page = await mount(t);
    page.openPost(event({ id: 'old' }));
    page.onHide();
    const refreshing = phase === 'resume' ? page.onShow() : page.refresh();
    effects.feedVersion += 1;
    pending.resolve(phase === 'resume' ? { post: post('old') } : { items: [post('old')] });
    await refreshing;
    assert.deepEqual(page.data.posts.map(item => item.id), ['new']);
    assert.equal(page._feedVersion, effects.feedVersion);
  });
});

test('real API visibility changes refresh public content while memberships do not filter topic browsing', async t => {
  fixture(t, async action => { throw new Error(action); });
  const client = api.createApi(global.wx, { mode: 'demo' });
  api.call = client.call;
  api.getFeedVersion = client.getFeedVersion;
  await api.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  const page = await mount(t);
  await page.loadMore();
  assert.ok(page.data.posts.length > 20);
  const first = page.data.posts[0];
  const initialIds = page.data.posts.map(item => item.id);
  const originalVersion = api.getFeedVersion();
  page.openPost(event({ id: first.id }));
  page.onHide();
  await api.call('likePost', { id: first.id, like: true });
  await api.call('addComment', { targetType: 'post', targetId: first.id, text: '发现页返回测试' });
  await page.onShow();
  assert.equal(api.getFeedVersion(), originalVersion);
  assert.deepEqual(page.data.posts.map(item => item.id), initialIds);
  assert.equal(page.data.posts[0].isLiked, true);
  assert.equal(page.data.posts[0].commentCount, 1);

  page.openAuthor(event({ id: first.author.id }));
  page.onHide();
  await api.call('blockUser', { userId: first.author.id, block: true });
  await page.onShow();
  assert.ok(page.data.posts.every(item => item.author.id !== first.author.id));
  await api.call('blockUser', { userId: first.author.id, block: false });
  await api.call('followUser', { userId: first.author.id, follow: true });
  page.setData({ feed: 'following' });
  await page.refresh();
  assert.ok(page.data.posts.some(item => item.author.id === first.author.id));
  page.onHide();
  await api.call('followUser', { userId: first.author.id, follow: false });
  await page.onShow();
  assert.equal(page.data.posts.length, 0);

  await api.call('joinCircle', { id: first.circle.id, join: true });
  page.setData({ feed: 'discover', topic: first.topics[0] || '' });
  await page.refresh();
  assert.ok(page.data.posts.some(item => item.circle.id === first.circle.id));
  const publicTopicIds = page.data.posts.map(item => item.id);
  const joinedVersion = api.getFeedVersion();
  page.onHide();
  await api.call('joinCircle', { id: first.circle.id, join: false });
  assert.ok(api.getFeedVersion() > joinedVersion, 'membership writes still invalidate the shared feed cache');
  await page.onShow();
  assert.deepEqual(page.data.posts.map(item => item.id), publicTopicIds, 'leaving a legacy membership does not remove publicly visible topic content');
  assert.ok(page.data.posts.some(item => item.circle.id === first.circle.id));

  await api.call('joinCircle', { id: 'circle-neighbors', join: true });
  page.setData({ feed: 'discover', topic: '' });
  await page.refresh();
  page.onHide();
  const created = await api.call('createPost', { circleId: 'circle-neighbors', text: '新的邻里分享', images: [] });
  await page.onShow();
  assert.ok(page.data.posts.some(item => item.id === created.post.id));
  page.openPost(event({ id: created.post.id }));
  page.onHide();
  await api.call('deletePost', { id: created.post.id });
  await page.onShow();
  assert.ok(page.data.posts.every(item => item.id !== created.post.id));
});
