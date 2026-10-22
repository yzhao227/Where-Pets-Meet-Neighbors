'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDemoService } = require('../miniprogram/services/demo');
const { createPersonalService } = require('../miniprogram/services/personal');
const { CURATED_POSTS } = require('../miniprogram/data/curated');
const retired = require('../content/batch-001/retired-video-20261022.json').items;
const product = require('../miniprogram/product');
const { handleRequest } = require('../scripts/preview-server');
const { createBundle, verifyBundle } = require('../scripts/lib/deployment');

const ROOT = path.resolve(__dirname, '..');
const STORE = 'youban.demo.v1';
const PRIVATE = 'youchong.personal.v1';
const DRAFTS = 'youchong.privateDrafts.v1';
const retiredIds = new Set(retired.map(row => row.id));
const canonicalIds = CURATED_POSTS.map(row => row.id).sort();
const now = () => Date.parse('2026-10-22T12:00:00+08:00');

function fixture() {
  const data = new Map();
  const platform = {
    getStorageSync: key => structuredClone(data.get(key) || ''),
    setStorageSync: (key, value) => data.set(key, structuredClone(value)),
    removeStorageSync: key => data.delete(key)
  };
  return { data, platform };
}
async function demo(f) {
  const service = createDemoService(f.platform, { now });
  await service.call('bootstrap');
  await service.call('bootstrap'); // Finish seed schema defaults before preservation snapshots.
  return service;
}
function assertTextAndImages(rows) {
  for (const row of rows) {
    assert.equal(retiredIds.has(row.id), false, row.id);
    assert.equal(!!row.video || row.contentType === 'video', false, row.id);
    assert.doesNotMatch(JSON.stringify(row), /(?:\.mp4|\.webm)(?:[?"/]|$)|\/(?:media\d*\/clips|assets\/curated-(?:video|poster))\//i, row.id);
  }
}
async function everyPage(service, action = 'listPosts', payload = {}, field = 'items') {
  const rows = [], cursors = new Set();
  let cursor, pages = 0;
  do {
    const result = await service.call(action, { ...payload, ...(cursor ? { cursor } : {}) });
    assert.ok(Array.isArray(result[field]), action);
    assertTextAndImages(result[field]);
    rows.push(...result[field]);
    cursor = result.nextCursor;
    pages += 1;
    assert.ok(pages <= 100, 'pagination must terminate');
    if (cursor) {
      assert.equal(cursors.has(cursor), false, 'must not repeat a pagination cursor');
      cursors.add(cursor);
    }
  } while (cursor);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'no duplicate rows across pages');
  return { rows, pages };
}
const ids = rows => rows.map(row => row.id).sort();
function legacyPost(id, extra = {}) {
  return { id, authorId: 'demo-self', circleId: 'circle-neighbors', title: '旧附件审计', text: '保留用户原文',
    images: [], topics: [], animalTypes: [], kind: 'daily', coverIndex: 0, eventId: '', visibility: 'public',
    createdAt: now(), video: { url: 'wxfile://kept-' + id + '.mp4', poster: 'wxfile://kept-cover.png', durationSeconds: 8 }, ...extra };
}

test('every catalogue page and each circle/author/following/bookmark intersection contains only the retained text and photos', async t => {
  const f = fixture(), service = await demo(f);
  const state = f.data.get(STORE);
  const editors = state.users.filter(user => user.isEditorial);
  state.follows.push(...editors.map(user => ({ userId: 'demo-self', targetUserId: user.id, createdAt: now() })));
  state.bookmarks.push(...state.posts.map(post => ({ userId: 'demo-self', postId: post.id, createdAt: now() })));
  state.circles.forEach(circle => { if (!circle.memberIds.includes('demo-self')) circle.memberIds.push('demo-self'); });
  f.data.set(STORE, state);
  let pageCount = 0, detailCount = 0;
  for (const payload of [{}, { feed: 'following' }, { feed: 'circles' }, { bookmarked: true }]) {
    const result = await everyPage(service, 'listPosts', payload);
    assert.deepEqual(ids(result.rows), canonicalIds); pageCount += result.pages;
  }
  for (const editor of editors) {
    const result = await everyPage(service, 'getUserProfile', { userId: editor.id }, 'posts');
    assert.deepEqual(ids(result.rows), ids(state.posts.filter(post => post.authorId === editor.id))); pageCount += result.pages;
  }
  for (const circle of state.circles) {
    const result = await everyPage(service, 'getCircle', { id: circle.id }, 'posts');
    assert.deepEqual(ids(result.rows), ids(state.posts.filter(post => post.circleId === circle.id))); pageCount += result.pages;
  }
  for (const post of CURATED_POSTS) {
    const result = await service.call('getPost', { id: post.id });
    assertTextAndImages([result.post]); detailCount += 1;
  }
  for (const post of retired) {
    assert.deepEqual((await service.call('listPosts', { query: post.title })).items, []);
    await assert.rejects(service.call('getPost', { id: post.id }), { code: 'NOT_FOUND' });
  }
  const personal = createPersonalService(f.platform, { now });
  await personal.call('bootstrap');
  for (const payload of [{}, { bookmarked: true }]) {
    const result = await everyPage(personal, 'listPosts', payload);
    assert.deepEqual(ids(result.rows), canonicalIds); pageCount += result.pages;
  }
  for (const post of retired) {
    assert.deepEqual((await personal.call('listPosts', { query: post.title })).items, []);
    await assert.rejects(personal.call('getPost', { id: post.id }), { code: 'NOT_FOUND' });
  }
  t.diagnostic(`${CURATED_POSTS.length} retained records, ${pageCount} feed/profile/circle pages, ${detailCount} live details, ${retired.length * 2} retired title/detail pairs`);
});

test('legacy user attachments stay stored while all mine/bookmark/author/circle pages and private-library reads omit their posts', async () => {
  const f = fixture(), service = await demo(f);
  const state = f.data.get(STORE);
  const hidden = [legacyPost('audit-old-object'), legacyPost('audit-old-type', { video: null, contentType: 'video', visibility: 'private' })];
  const retained = Array.from({ length: 23 }, (_, index) => legacyPost('audit-text-' + index, { video: null, text: '本人的图文 ' + index, createdAt: now() - index }));
  state.posts.push(...hidden, ...retained);
  state.bookmarks.push(...hidden.concat(retained).map(post => ({ userId: 'demo-self', postId: post.id })));
  state.follows.push({ userId: 'demo-self', targetUserId: 'demo-self', createdAt: now() });
  const drafts = {
    'demo:demo-self': { version: 1, title: '原草稿', text: '尚未保存的原文', visibility: 'friends', video: hidden[0].video },
    'personal:personal:demo-self': { version: 1, title: '私人草稿', text: '私人原文', visibility: 'private', video: hidden[0].video },
    'demo:other-account': { version: 1, text: '另一个账号不变', video: hidden[0].video }
  };
  f.data.set(STORE, state); f.data.set(DRAFTS, drafts);
  const original = structuredClone(state);
  for (const payload of [{ mine: true }, { bookmarked: true }, { authorId: 'demo-self' }, { feed: 'following' }]) {
    assert.deepEqual(ids((await everyPage(service, 'listPosts', payload)).rows), ids(retained));
  }
  const ownProfile = await everyPage(service, 'getUserProfile', { userId: 'demo-self' }, 'posts');
  assert.deepEqual(ids(ownProfile.rows), ids(retained));
  const circle = await everyPage(service, 'getCircle', { id: 'circle-neighbors' }, 'posts');
  assert.deepEqual(ids(circle.rows.filter(post => post.author.id === 'demo-self')), ids(retained));
  for (const post of hidden) await assert.rejects(service.call('getPost', { id: post.id }), { code: 'NOT_FOUND' });
  const personal = createPersonalService(f.platform, { now });
  await personal.call('bootstrap');
  const privateState = f.data.get(PRIVATE);
  privateState.accounts[0].posts.push(legacyPost('audit-overlay-video', { video: null, contentType: 'video' }));
  f.data.set(PRIVATE, privateState);
  assert.deepEqual(ids((await everyPage(personal, 'listPosts', { mine: true })).rows), ids(retained));
  const library = await personal.readLibrary('demo-self');
  assert.deepEqual(ids(library.posts), ids(retained));
  assertTextAndImages(library.posts);
  assert.equal(library.drafts[0].text, drafts['personal:personal:demo-self'].text);
  assert.deepEqual(f.data.get(STORE), original, 'reader filtering must not delete or edit user records');
  assert.deepEqual(f.data.get(PRIVATE), privateState, 'private overlay remains intact');
  assert.deepEqual(f.data.get(DRAFTS), drafts, 'all account drafts remain intact');
});

test('old reactions to removed editorial videos disappear from messages and unread counts without deleting their records', async () => {
  const f = fixture(), service = await demo(f);
  const state = f.data.get(STORE);
  state.contentCatalogVersion = 'before-video-retirement';
  const messages = retired.map((post, index) => ({ id: 'audit-retired-message-' + index, userId: 'demo-self', actorId: 'catalog-photo',
    title: post.title, text: '收藏了你的视频', targetType: 'post', targetId: post.id, kind: 'bookmark', isRead: false, createdAt: now() + index }));
  state.posts.push(...retired.map(post => ({ ...structuredClone(post), authorId: 'catalog-photo', catalogManaged: true, images: [], createdAt: 0 })));
  state.messages.push(...messages);
  const userVideo = legacyPost('audit-user-notification');
  state.posts.push(userVideo);
  state.messages.push({ ...messages[0], id: 'audit-user-message', targetId: userVideo.id });
  f.data.set(STORE, state);
  const visible = await service.call('listMessages');
  assert.equal(visible.items.some(message => message.id.startsWith('audit-')), false);
  assert.equal(visible.categoryUnread.interactions, 0);
  assert.equal(visible.unreadCount, 1, 'only the welcome message remains unread');
  for (const message of messages) {
    assert.deepEqual((await service.call('listMessages', { query: message.title })).items, []);
    await assert.rejects(service.call('readMessage', { id: message.id }), { code: 'NOT_FOUND' });
  }
  for (const message of messages) assert.deepEqual(f.data.get(STORE).messages.find(row => row.id === message.id), message);
  assert.deepEqual(f.data.get(STORE).posts.find(row => row.id === userVideo.id), userVideo);
});

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
function request(url, method = 'GET', headers = {}) {
  const result = {};
  handleRequest({ url, method, headers }, {
    writeHead(status, values) { result.status = status; result.headers = values; },
    end(body) { result.body = body === undefined ? '' : String(body); }
  });
  return result;
}

test('preview rejects archived video and poster URLs including HEAD and range requests while retaining current photos and pages', t => {
  const files = ['media', 'media2', 'media3', 'assets/curated-video', 'assets/curated-poster']
    .flatMap(folder => walk(path.join(ROOT, 'miniprogram', folder)))
    .filter(file => /\.(?:mp4|webm|mov|m4v|png|jpe?g|webp)$/i.test(file));
  let checks = 0;
  for (const file of files) {
    const relative = path.relative(path.join(ROOT, 'miniprogram'), file).split(path.sep).join('/');
    for (const url of ['/' + relative, '/miniprogram/' + relative]) {
      for (const [method, headers] of [['GET', {}], ['HEAD', {}], ['GET', { range: 'bytes=0-1' }]]) {
        assert.equal(request(url, method, headers).status, 404, `${method} ${url}`); checks += 1;
      }
    }
  }
  for (const route of ['media/pages/index', 'media2/pages/index', 'media3/pages/index']) {
    assert.equal(product.allowsNavigation('/' + route + '?id=' + retired[0].id), false);
  }
  const manifest = request('/__manifest.json');
  assert.equal(manifest.status, 200);
  const pages = JSON.parse(manifest.body).pages;
  for (const [route, page] of Object.entries(pages)) {
    assert.doesNotMatch(route, /^media\d*\//);
    assert.doesNotMatch(page.template, /<video\b|视频|(?:bindtap|catchtap)="(?:uploadVideo|openVideo|retryVideo)"/i, route);
  }
  const bundle = request('/__bundle.js');
  assert.equal(bundle.status, 200);
  assert.doesNotMatch(bundle.body, /"(?:media\d*\/pages\/index|pages\/post\/_player)\.js":\s*function/);
  assert.equal(request('/assets/tab-community.png').status, 200);
  assert.match(request('/assets/tab-community.png').headers['Content-Type'], /^image\/png/);
  assert.equal(request('/').status, 200);
  t.diagnostic(`${files.length} archived asset files, ${checks} rejected HTTP variants, ${Object.keys(pages).length} page templates`);
});

test('an actual standalone candidate contains no retired video bytes, player pages or poster assets', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youchong-video-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { appName: '有宠有邻', version: '0.5.0',
    wechat: { appid: 'wx1234567890abcdef', cloudEnv: 'local-audit-only', cloudFilePrefix: 'cloud://local-audit.bucket/' },
    operator: { name: '本机回归检查', contact: 'audit@example.invalid', retention: '仅用于本机测试，不上传或部署。', policyApproved: false, termsVersion: '2026-10-22', privacyVersion: '2026-10-22' },
    community: { city: '上海', areas: ['本机测试'], contact: 'audit@example.invalid' }, features: { phoneVerification: false, imageReviewMode: 'disabled' } };
  const result = createBundle(config, { output: path.join(directory, 'candidate') });
  const manifest = verifyBundle(result.directory);
  const runtime = manifest.files.filter(row => row.path.startsWith('miniprogram/'));
  assert.ok(runtime.length > 100, 'audit the actual project rather than a reduced package fixture');
  for (const file of runtime) {
    assert.doesNotMatch(file.path, /\.(?:mp4|webm|mov|m4v)$|\/media\d*\/|\/assets\/curated-(?:video|poster)\/|\/_player\.js$/i);
    if (file.path.endsWith('.wxml')) assert.doesNotMatch(fs.readFileSync(path.join(result.directory, file.path), 'utf8'), /<video\b|视频/i, file.path);
  }
  const candidateCatalogue = require(path.join(result.directory, 'miniprogram/data/curated')).CURATED_POSTS;
  assert.deepEqual(ids(candidateCatalogue), canonicalIds);
  assertTextAndImages(candidateCatalogue);
  assert.ok(runtime.some(file => file.path === 'miniprogram/assets/tab-community.png'));
  assert.ok(fs.existsSync(path.join(ROOT, 'content/batch-001/retired-video-20261022.json')), 'local provenance archive stays available');
  t.diagnostic(`${runtime.length} runtime files in a freshly generated and integrity-verified candidate; no upload performed`);
});
