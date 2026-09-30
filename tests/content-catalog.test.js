'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeed } = require('../miniprogram/data/seed');
const { createSeed: createLegacyFixture } = require('./helpers/community-fixture');
const { CURATED_POSTS, CATALOG_VERSION } = require('../miniprogram/data/curated');
const { syncCatalogue } = require('../miniprogram/data/catalogue');
const { EDITORS } = require('../miniprogram/data/editors');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const shared = require('../miniprogram/pages/_shared');
const EPOCH = Date.UTC(2026, 8, 29);

function fixture(initial) {
  const values = new Map(initial ? [[STORAGE_KEY, structuredClone(initial)]] : []);
  const platform = {
    getStorageSync(key) { return values.has(key) ? structuredClone(values.get(key)) : ''; },
    setStorageSync(key, value) { values.set(key, structuredClone(value)); },
    removeStorageSync(key) { values.delete(key); }
  };
  return { values, platform, api: createDemoService(platform, { now: () => EPOCH }), state: () => platform.getStorageSync(STORAGE_KEY) };
}

test('a fresh install contains no invented people, posts, comments or bookable meetups', async () => {
  const seed = createSeed(EPOCH);
  assert.equal(seed.contentCatalogVersion, CATALOG_VERSION);
  assert.deepEqual(seed.users.filter(user => !user.isEditorial).map(user => user.id), ['demo-self']);
  assert.deepEqual(seed.users.filter(user => user.isEditorial).map(user => user.id), EDITORS.map(user => user.id));
  assert.equal(seed.posts.length, CURATED_POSTS.length);
  assert.deepEqual(seed.events, []);
  assert.deepEqual(seed.comments, []);
  assert.deepEqual(seed.likes, []);
  assert.deepEqual(seed.follows, []);
  assert.equal(seed.settings.city, '');
  assert.deepEqual(seed.settings.areas, []);
  const f = fixture();
  const boot = await f.api.call('bootstrap');
  assert.equal(boot.stats.postCount, 0);
  assert.equal(boot.circles.length, 8);
  assert.ok(boot.circles.every(circle => circle.memberCount === (circle.id === 'circle-neighbors' ? 1 : 0)));
  assert.equal((await f.api.call('listEvents')).items.length, 0);
  assert.equal((await f.api.call('listMessages')).items.length, 1, 'only the factual welcome notice is supplied');
});

test('retiring fictional samples preserves own content, settings, drafts and old interactions in an archive', async () => {
  const old = createLegacyFixture(EPOCH - 1000);
  delete old.contentCatalogVersion;
  const own = old.users.find(user => user.id === 'demo-self');
  Object.assign(own, { nickname: '保留我的昵称', bio: '我自己写的介绍', area: '示例·梧桐里' });
  old.posts.push({ id: 'local-kept', authorId: own.id, circleId: 'circle-neighbors', text: '我自己发的照片', images: ['wxfile://saved-mine.png'], createdAt: EPOCH - 500 });
  old.comments.push({ id: 'own-comment', authorId: own.id, targetType: 'post', targetId: 'local-kept', text: '我自己的回应', createdAt: EPOCH });
  old.comments.push({ id: 'old-sample-reply', authorId: own.id, targetType: 'post', targetId: 'demo-post-1', text: '曾经回复过示例帖', createdAt: EPOCH });
  old.likes.push({ userId: own.id, postId: 'local-kept' }, { userId: own.id, postId: 'demo-post-1' });
  old.bookmarks.push({ userId: own.id, postId: 'demo-post-1' });
  old.events[0].title = '我曾经编辑过示例活动的标题';
  old.events[0].attendeeIds.push(own.id);
  old.settings.city = '用户设置的城市';
  old.settings.areas.push('用户设置的片区', '示例·用户新增片区');
  const f = fixture(old);
  f.values.set('youchong.privateDrafts.v1', { text: '尚未发布的草稿' });
  f.values.set('youchong.uploadQueue.v1', { version: 1, items: [{ localPath: 'wxfile://my-draft.png' }] });
  const boot = await f.api.call('bootstrap');
  assert.equal(boot.user.nickname, own.nickname);
  assert.equal(boot.user.bio, own.bio);
  assert.equal(boot.user.area, own.area);
  assert.equal(boot.settings.city, old.settings.city);
  assert.deepEqual(boot.settings.areas, ['用户设置的片区', '示例·用户新增片区']);
  assert.equal(boot.stats.postCount, 1);
  assert.equal(boot.stats.bookmarkCount, 0);
  assert.equal(boot.stats.joinedEventCount, 0);
  const post = (await f.api.call('getPost', { id: 'local-kept' })).post;
  assert.deepEqual(post.images, ['wxfile://saved-mine.png']);
  assert.equal(post.likeCount, 1);
  assert.equal(post.commentCount, 1);
  assert.equal((await f.api.call('listEvents')).items.length, 0);
  await assert.rejects(f.api.call('getPost', { id: 'demo-post-1' }), { code: 'NOT_FOUND' });
  const archive = f.state().legacySampleArchive;
  assert.equal(archive.posts.length, 8);
  assert.ok(archive.comments.some(item => item.id === 'old-sample-reply'));
  assert.ok(archive.bookmarks.some(item => item.userId === own.id));
  assert.equal(archive.events[0].title, '我曾经编辑过示例活动的标题');
  assert.deepEqual(f.values.get('youchong.privateDrafts.v1'), { text: '尚未发布的草稿' });
  assert.deepEqual(f.values.get('youchong.uploadQueue.v1').items, [{ localPath: 'wxfile://my-draft.png' }]);
  await f.api.call('updateProfile', { nickname: own.nickname, area: own.area });
  const before = f.state();
  const restart = createDemoService(f.platform, { now: () => EPOCH + 5000 });
  await restart.call('bootstrap');
  assert.deepEqual(f.state(), before, 'relaunch neither duplicates the archive nor restores removed samples');
  await f.api.call('deleteAccount');
  assert.equal(f.state().legacySampleArchive, undefined, 'account removal also clears archived private replies');
});

test('attributed editorial material keeps its source and does not pretend to be a recently published user story', async () => {
  const seed = createSeed(EPOCH);
  const source = { publisher: '测试来源机构', title: '仅测试用文章', url: 'https://example.invalid/test-only', checkedAt: '2026-09-29' };
  seed.posts.push({ id: 'test-guide', authorId: 'demo-self', circleId: 'circle-neighbors', title: '仅测试的资料整理', text: '仅存在测试内存。', images: [], createdAt: 0, source });
  const f = fixture(seed);
  const item = (await f.api.call('getPost', { id: 'test-guide' })).post;
  assert.deepEqual(item.source, source);
  assert.equal(shared.post(item).timeText, '');
  assert.equal(shared.post(item).kindText, '养宠知识');
  item.source.publisher = '外部修改';
  assert.deepEqual((await f.api.call('getPost', { id: 'test-guide' })).post.source, source);
});

function testPost(id, contentType = 'photo') {
  const imageUrl = 'https://example.invalid/test-fixtures/' + id + '.jpg';
  return {
    id, contentType, editorId: contentType === 'photo' ? 'catalog-photo' : 'catalog-pet-care',
    circleId: 'circle-neighbors', title: '仅内存测试 ' + id, text: '测试专用，不是采集的真实资料。',
    kind: 'daily', topics: [], images: contentType === 'photo' ? [imageUrl] : [], coverIndex: 0,
    source: { title: '测试来源', publisher: '测试机构', author: '测试作者', url: 'https://example.invalid/test', checkedAt: '2026-09-29' },
    imageCredits: contentType === 'photo' ? [{ imageUrl, sourceUrl: 'https://example.invalid/test', author: '测试摄影作者', attribution: '仅测试署名', licenseName: '仅测试许可', licenseUrl: 'https://example.invalid/license', modifiedDescription: '仅测试裁切' }] : []
  };
}

test('display accounts are labeled, have no pets or verification, and never inflate real member statistics', async () => {
  const f = fixture();
  assert.deepEqual(await f.api.call('getPetStats'), {
    totalUsers: 1, profilesWithPet: 0, profilesWithoutPet: 1, publicPetProfiles: 0,
    byType: { cat: 0, dog: 0, other: 0 }, scope: '按每个账号的首只宠物统计类型；可登记多只，未填写不代表没有宠物'
  });
  for (const editor of EDITORS) {
    const profile = (await f.api.call('getUserProfile', { userId: editor.id })).user;
    assert.equal(profile.accountLabel, undefined);
    assert.equal(profile.isEditorial, true);
    assert.equal(profile.pet, null);
    assert.equal(profile.postCount, CURATED_POSTS.filter(post => post.editorId === editor.id).length);
    assert.equal(profile.followerCount, 0);
    const raw = f.state().users.find(user => user.id === editor.id);
    assert.equal(raw.isAdmin, false);
    assert.equal(raw.verification.status, 'unverified');
  }
});

test('seed and upgrade retain catalogue photos and public credits without exposing permission evidence', async () => {
  const post = testPost('photo-test-preserve');
  post.imageCredits[0].permissionRef = 'TEST-PRIVATE-PERMISSION';
  const original = CURATED_POSTS.slice();
  try {
    CURATED_POSTS.splice(0, CURATED_POSTS.length, post);
    for (const initial of [undefined, { ...createSeed(EPOCH - 1), contentCatalogVersion: 'test-old-version' }]) {
      const f = fixture(initial);
      const view = (await f.api.call('getPost', { id: post.id })).post;
      assert.deepEqual(view.images, post.images);
      assert.equal(view.cover, post.images[0]);
      assert.equal(view.imageCredits[0].author, '测试摄影作者');
      assert.equal(view.imageCredits[0].modifiedDescription, '仅测试裁切');
      assert.equal(view.imageCredits[0].permissionRef, undefined);
      assert.equal(view.contentType, 'photo');
      assert.equal(view.author.id, 'catalog-photo');
      assert.equal(view.author.accountLabel, undefined);
      assert.equal(view.createdAt, 0);
    }
  } finally { CURATED_POSTS.splice(0, CURATED_POSTS.length, ...original); }
});

test('catalogue revisions update same IDs, withdraw removed items, and preserve user records and moderation deletions', async () => {
  const state = createSeed(EPOCH);
  const own = { id: 'local-kept', authorId: 'demo-self', circleId: 'circle-neighbors', text: '真实用户自行输入', title: '', kind: 'daily', coverIndex: 0, eventId: '', images: ['wxfile://mine'], topics: [], createdAt: EPOCH };
  state.posts.push(own);
  const first = testPost('photo-first');
  const withdrawn = testPost('photo-withdrawn');
  syncCatalogue(state, EPOCH, { posts: [first, withdrawn], version: CATALOG_VERSION });
  state.likes.push({ postId: first.id, userId: 'demo-self' });
  state.comments.push({ id: 'local-reply', targetType: 'post', targetId: first.id, authorId: 'demo-self', text: '自行回复', createdAt: EPOCH });
  const revision = { ...first, title: '修订后的资料标题' };
  syncCatalogue(state, EPOCH + 1000, { posts: [revision], version: CATALOG_VERSION });
  assert.deepEqual(state.posts.find(post => post.id === own.id), own);
  assert.equal(state.posts.some(post => post.id === withdrawn.id), false);
  assert.equal(state.posts.find(post => post.id === first.id).title, revision.title);
  assert.equal(state.posts.find(post => post.id === first.id).importedAt, EPOCH);
  const f = fixture(state);
  const view = (await f.api.call('getPost', { id: first.id })).post;
  assert.equal(view.likeCount, 1);
  assert.equal(view.commentCount, 1);
  await f.api.call('deletePost', { id: first.id });
  const after = f.state();
  assert.ok(after.catalogDeletedIds.includes(first.id));
  syncCatalogue(after, EPOCH + 2000, { posts: [revision], version: 'test-next-version' });
  assert.equal(after.posts.some(post => post.id === first.id), false, 'admin-deleted content is never resurrected');
  assert.deepEqual(after.posts.find(post => post.id === own.id), own);
});

test('duplicate catalogue IDs and collisions with real posts or accounts fail without mutation', () => {
  const post = testPost('photo-duplicate');
  for (const setup of [
    state => ({ posts: [post, post] }),
    state => { state.posts.push({ ...post, authorId: 'demo-self' }); return { posts: [post] }; },
    state => { state.users.push({ id: 'test-real-user' }); return { posts: [], editors: [{ id: 'test-real-user' }] }; }
  ]) {
    const state = createSeed(EPOCH);
    const options = setup(state);
    const before = structuredClone(state);
    assert.throws(() => syncCatalogue(state, EPOCH, options), /重复|冲突/);
    assert.deepEqual(state, before);
  }
});

test('a 300-item memory fixture paginates circle content without loss, duplication or fake timestamps', async () => {
  const state = createSeed(EPOCH);
  const posts = Array.from({ length: 100 }, (_, i) => testPost('knowledge-test-' + i, 'knowledge'))
    .concat(Array.from({ length: 200 }, (_, i) => testPost('photo-test-' + i)));
  syncCatalogue(state, EPOCH, { posts, version: CATALOG_VERSION });
  const f = fixture(state);
  const collected = [];
  let cursor;
  do {
    const page = await f.api.call('getCircle', { id: 'circle-neighbors', cursor });
    assert.equal(page.posts.length, 20);
    collected.push(...page.posts);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(collected.length, 300);
  assert.equal(new Set(collected.map(post => post.id)).size, 300);
  assert.deepEqual(collected.slice(0, 6).map(post => post.contentType), ['knowledge', 'photo', 'photo', 'knowledge', 'photo', 'photo']);
  assert.ok(collected.every(post => post.createdAt === 0 && post.likeCount === 0 && post.commentCount === 0));
  await assert.rejects(f.api.call('getCircle', { id: 'circle-neighbors', cursor: '-1' }), { code: 'INVALID_INPUT' });
});

test('preset videos appear across the first three feed pages while circles alternate and real posts stay newest first', async () => {
  const state = createSeed(EPOCH);
  const circleIds = state.circles.map(circle => circle.id);
  const posts = Array.from({ length: 50 }, (_, i) => ({ ...testPost('knowledge-test-' + i, 'knowledge'), circleId: circleIds[i % circleIds.length] }))
    .concat(Array.from({ length: 197 }, (_, i) => ({ ...testPost('photo-test-' + i), circleId: circleIds[i % circleIds.length] })))
    .concat(Array.from({ length: 3 }, (_, i) => ({
      ...testPost('video-test-' + i, 'video'), circleId: circleIds[i % circleIds.length],
      video: { url: 'https://example.invalid/test-' + i + '.mp4', durationSeconds: 4 }
    })));
  const realPosts = [2, 1].map(age => ({
    id: 'user-test-' + age, authorId: 'demo-self', createdAt: EPOCH - age,
    circleId: 'circle-neighbors', title: '', text: '用户自己记录的内容', kind: 'daily',
    coverIndex: 0, images: [], eventId: '', topics: []
  }));
  state.posts.push(...realPosts);
  syncCatalogue(state, EPOCH, { posts, version: CATALOG_VERSION });
  const f = fixture(state);
  const pages = [];
  let cursor;
  do {
    const page = await f.api.call('listPosts', { cursor });
    pages.push(page.items);
    cursor = page.nextCursor;
  } while (cursor);
  const all = pages.flat();
  assert.deepEqual(all.slice(0, 2).map(post => post.id), ['user-test-1', 'user-test-2']);
  assert.deepEqual(f.state().posts.filter(post => post.authorId === 'demo-self'), realPosts, 'ranking does not rewrite user records');
  assert.deepEqual(pages.slice(0, 3).map(page => page.filter(post => post.contentType === 'video').length), [1, 1, 1]);
  assert.equal(all.length, 252);
  assert.equal(new Set(all.map(post => post.id)).size, 252);
  const editorial = all.slice(2);
  assert.ok(editorial.every(post => post.createdAt === 0 && post.likeCount === 0 && post.commentCount === 0));
  const media = editorial.filter(post => ['photo', 'video'].includes(post.contentType));
  assert.ok(media.slice(0, 50).every((post, index) => !index || post.circle.id !== media[index - 1].circle.id));
  const before = editorial.map(post => post.id);
  syncCatalogue(state, EPOCH + 1000, { posts, version: CATALOG_VERSION });
  assert.deepEqual(state.posts.filter(post => post.catalogManaged).map(post => post.id), before, 'relaunch keeps the same editorial order');
});
