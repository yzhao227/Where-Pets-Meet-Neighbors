'use strict';

// Run after the final catalogue build. All application storage is an isolated
// Map; this never attaches to WeChat, cloud storage, or the developer tools.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const MINI = path.join(ROOT, 'miniprogram');
const OUTPUT = path.join(ROOT, 'output/content-review/runtime-final-check.json');
const { CURATED_POSTS, CATALOG_VERSION } = require('../miniprogram/data/curated');
const manifest = require('../content/batch-001/approved.json');
const baseline = require('../content/batch-003/baseline-runtime-250.json');
const { CIRCLES } = require('../miniprogram/data/circles');
const { EDITORS } = require('../miniprogram/data/editors');
const TOPICS = require('../miniprogram/data/topics');
const animals = require('../miniprogram/data/animal-types');
const preferences = require('../miniprogram/data/feed-preferences');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const { inspectVideo } = require('../cloudfunctions/community/video-file');
const exportedApi = require('../miniprogram/services/api');
const shared = require('../miniprogram/pages/_shared');

function tally(items, key) {
  const counts = {};
  for (const item of items) for (const value of [].concat(key(item))) counts[value] = (counts[value] || 0) + 1;
  return counts;
}
function sameIds(actual, expected, label) {
  assert.equal(new Set(actual.map(item => item.id)).size, actual.length, label + ': duplicate IDs');
  assert.deepEqual(actual.map(item => item.id).sort(), expected.map(item => item.id).sort(), label);
}
function isolatedService() {
  const storage = new Map();
  const platform = {
    getStorageSync(key) { return storage.has(key) ? structuredClone(storage.get(key)) : ''; },
    setStorageSync(key, value) { storage.set(key, structuredClone(value)); },
    removeStorageSync(key) { storage.delete(key); }
  };
  return { platform, service: createDemoService(platform, { now: () => Date.now() }) };
}
async function collect(service, action = 'listPosts', payload = {}) {
  const items = [], pageSizes = [], seenCursors = new Set();
  let cursor;
  do {
    const result = await service.call(action, { ...payload, ...(cursor ? { cursor } : {}) });
    const page = result.items || result.posts;
    assert.ok(Array.isArray(page), action + ': missing page');
    items.push(...page);
    pageSizes.push(page.length);
    cursor = result.nextCursor;
    if (cursor) {
      assert.ok(!seenCursors.has(cursor), action + ': repeated cursor');
      seenCursors.add(cursor);
    }
    assert.ok(pageSizes.length < 100, action + ': excessive pages');
  } while (cursor);
  assert.equal(new Set(items.map(item => item.id)).size, items.length, action + ': duplicate records across pages');
  return { items, pageSizes };
}
function instantiatePage(name, options) {
  let definition;
  global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/' + name + '/index');
  delete require.cache[file];
  require(file);
  assert.ok(definition, name + ': no page registered');
  const page = { ...definition, data: structuredClone(definition.data), _closed: false,
    setData(values) { assert.equal(this._closed, false, 'setData after unload'); Object.assign(this.data, values); } };
  const refresh = page.refresh;
  page.refresh = function () { this.pendingRefresh = refresh.apply(this, arguments); return this.pendingRefresh; };
  page.onLoad(options);
  return page;
}
async function readPage(name, options) {
  const page = instantiatePage(name, options);
  await page.pendingRefresh;
  assert.equal(page.data.error, '', name + ': initial load failed');
  let pages = 1;
  while (page.data.nextCursor) {
    const before = page.data.nextCursor;
    await page.loadMore();
    assert.notEqual(page.data.nextCursor, before, name + ': pagination stalled');
    assert.ok(++pages < 100, name + ': excessive pagination');
  }
  return { page, pages };
}

async function main() {
  const report = {
    schemaVersion: 1, checkedAt: new Date().toISOString(), catalogueVersion: CATALOG_VERSION,
    catalogueSha256: createHash('sha256').update(fs.readFileSync(path.join(MINI, 'data/curated.js'))).digest('hex'),
    environment: 'Node.js; isolated Map storage; native page definitions run with in-memory wx stubs',
    actualWeChatStorageAccessed: false, networkRequested: false, guiAutomationUsed: false,
    scope: 'Final bundled catalogue data, local MP4 structure and native page data flow; not a device playback or remote availability test.',
    checks: []
  };
  const check = async (name, task) => {
    try { report.checks.push({ name, status: 'passed', details: await task() }); }
    catch (error) { report.checks.push({ name, status: 'failed', error: error.message }); }
  };
  const { platform, service } = isolatedService();
  const boot = await service.call('bootstrap');
  const feed = await collect(service);
  const all = feed.items;
  report.inventory = {
    total: all.length, contentTypes: tally(all, item => item.contentType),
    circles: tally(all, item => item.circle.id), topics: tally(all, item => item.topics),
    animalTypes: tally(all, item => item.animalTypes), pageSizes: feed.pageSizes
  };

  await check('all current records survive full pagination and refresh; original 250 remain unchanged', async () => {
    assert.equal(CURATED_POSTS.length, manifest.items.length);
    sameIds(all, CURATED_POSTS, 'runtime versus bundled catalogue');
    assert.deepEqual(tally(all, item => item.contentType), manifest.targets);
    const current = new Map(CURATED_POSTS.map(item => [item.id, item]));
    assert.equal(baseline.length, 250);
    for (const item of baseline) assert.deepEqual(current.get(item.id), item, 'preserve ' + item.id);
    assert.deepEqual(feed.pageSizes, Array.from({ length: Math.ceil(all.length / 20) }, (_, index) => Math.min(20, all.length - index * 20)));
    assert.deepEqual((await collect(service)).items.map(item => item.id), all.map(item => item.id));
    assert.ok(all.every(item => item.createdAt === 0 && item.likeCount === 0 && item.commentCount === 0));
    return { count: all.length, pages: feed.pageSizes.length, refreshedOrderStable: true, inventedDatesOrEngagement: false };
  });

  await check('eight populated circles and eight populated topics return exactly matching content', async () => {
    assert.equal(CIRCLES.length, 8); assert.equal(TOPICS.length, 8);
    assert.deepEqual(boot.circles.map(circle => circle.id), CIRCLES.map(circle => circle.id));
    assert.deepEqual(Object.keys(report.inventory.circles).sort(), CIRCLES.map(circle => circle.id).sort());
    assert.deepEqual(Object.keys(report.inventory.topics).sort(), TOPICS.slice().sort());
    for (const circle of CIRCLES) sameIds((await collect(service, 'getCircle', { id: circle.id })).items,
      all.filter(item => item.circle.id === circle.id), 'circle ' + circle.id);
    for (const topic of TOPICS) sameIds((await collect(service, 'listPosts', { topic })).items,
      all.filter(item => item.topics.includes(topic)), 'topic ' + topic);
    return { circles: report.inventory.circles, topics: report.inventory.topics };
  });

  await check('all knowledge cards have reviewed photo covers and all eight new groups retain their image order', async () => {
    const knowledge = all.filter(item => item.contentType === 'knowledge');
    const photoImages = new Set(all.filter(item => item.contentType === 'photo').flatMap(item => item.images));
    assert.equal(knowledge.length, manifest.targets.knowledge);
    assert.ok(knowledge.every(item => item.images.length >= 1 && item.images.length <= 3 && item.cover === item.images[0] && item.images.every(image => photoImages.has(image))));
    assert.ok(knowledge.every(item => shared.post(item).cover === item.cover));
    const groups = CURATED_POSTS.filter(item => item.imagePhotoIds);
    assert.equal(groups.length, 8);
    for (const group of groups) assert.deepEqual(knowledge.find(item => item.id === group.id).images, group.images);
    return { count: knowledge.length, allHaveSelectedPhotoCover: true, multiImageGroups: groups.length };
  });

  await check('all readable bundled MP4 files are present and the first five feed pages include videos', async () => {
    const videos = all.filter(item => item.contentType === 'video');
    assert.equal(videos.length, manifest.targets.video);
    const rows = [];
    for (const item of videos) {
      assert.match(item.video.url, /^\/(?:assets\/curated-video|media[2-9]?\/clips)\/\d+\.mp4$/);
      const mediaPath = item.video.url.replace('/assets/curated-video/', '/media/clips/');
      const file = fs.realpathSync(path.join(MINI, mediaPath.slice(1)));
      const packageDirectory = /^\/(media[2-9]?\/clips)\//.exec(mediaPath)[1];
      assert.ok(file.startsWith(fs.realpathSync(path.join(MINI, packageDirectory)) + path.sep));
      const bytes = fs.readFileSync(file);
      assert.ok(bytes.length <= 300 * 1024);
      const metadata = inspectVideo(bytes);
      assert.ok(Math.abs(metadata.durationSeconds - item.video.durationSeconds) <= 0.25);
      assert.ok(item.video.poster && item.video.poster === item.images[0]);
      const position = all.findIndex(post => post.id === item.id) + 1;
      rows.push({ id: item.id, path: item.video.url, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), position, page: Math.ceil(position / 20), ...metadata });
    }
    assert.ok(rows.filter(row => row.page <= 5).length >= Math.min(5, videos.length));
    assert.ok(new Set(rows.map(row => row.page)).size >= 3);
    return rows;
  });

  await check('all ten animal selectors and exclusions work across pagination, including mixed cat/dog cards', async () => {
    assert.equal(animals.IDS.length, 10);
    assert.ok(all.every(item => item.animalTypes.length > 0 && item.animalTypes.every(id => animals.IDS.includes(id))));
    const matrix = [];
    for (const id of animals.IDS) {
      const selected = await collect(service, 'listPosts', { animalType: id });
      const excluded = await collect(service, 'listPosts', { excludedAnimalTypes: [id] });
      sameIds(selected.items, all.filter(item => item.animalTypes.includes(id)), 'select ' + id);
      sameIds(excluded.items, all.filter(item => !item.animalTypes.includes(id)), 'exclude ' + id);
      matrix.push({ animalType: id, included: selected.items.length, remainingAfterExclusion: excluded.items.length,
        includePages: selected.pageSizes.length, excludePages: excluded.pageSizes.length });
    }
    const mixed = all.filter(item => item.animalTypes.includes('cat') && item.animalTypes.includes('dog'));
    assert.ok(mixed.length > 0, 'expected mixed-species knowledge cards');
    const catsWithoutDogs = (await collect(service, 'listPosts', { animalType: 'cat', excludedAnimalTypes: ['dog'] })).items;
    sameIds(catsWithoutDogs, all.filter(item => item.animalTypes.includes('cat') && !item.animalTypes.includes('dog')), 'cat excluding dog');
    const withoutCatsOrDogs = (await collect(service, 'listPosts', { excludedAnimalTypes: ['cat', 'dog'] })).items;
    sameIds(withoutCatsOrDogs, all.filter(item => !item.animalTypes.some(id => ['cat', 'dog'].includes(id))), 'exclude cats and dogs');
    assert.equal((await collect(service, 'listPosts', { excludedAnimalTypes: animals.IDS })).items.length, 0);
    assert.equal((await collect(service, 'listPosts', { animalType: 'unclassified' })).items.length, 0);
    return { matrix, mixedCatDogIds: mixed.map(item => item.id), catsWithoutDogs: catsWithoutDogs.length,
      remainingWithoutCatsOrDogs: withoutCatsOrDogs.length, allExcluded: 0, unclassified: 0 };
  });

  const previousWx = global.wx, previousPage = global.Page, previousCall = exportedApi.call;
  const calls = [];
  global.wx = { ...platform, setNavigationBarTitle() {}, stopPullDownRefresh() {},
    showToast(options) { throw new Error('Unexpected page toast: ' + options.title); } };
  exportedApi.call = async (action, payload = {}) => { calls.push({ action, payload: structuredClone(payload) }); return service.call(action, payload); };
  try {
    await check('native circle and author pages apply all ten hidden-animal preferences to initial and subsequent pages', async () => {
      const targets = CIRCLES.map(circle => ({ name: 'circle', action: 'getCircle', options: { id: circle.id }, id: circle.id,
        matches: item => item.circle.id === circle.id }))
        .concat(EDITORS.map(editor => ({ name: 'author', action: 'getUserProfile', options: { userId: editor.id }, id: editor.id,
          matches: item => item.author.id === editor.id })));
      const matrix = [];
      for (const animalType of animals.IDS) {
        assert.equal(preferences.save(global.wx, [animalType]), '');
        for (const target of targets) {
          const callStart = calls.length;
          const { page, pages } = await readPage(target.name, target.options);
          const expected = all.filter(item => target.matches(item) && !item.animalTypes.includes(animalType));
          sameIds(page.data.posts, expected, target.name + ' ' + target.id + ' hiding ' + animalType);
          assert.deepEqual(page.data.excludedAnimalTypes, [animalType]);
          const relevant = calls.slice(callStart).filter(call => call.action === target.action);
          assert.equal(relevant.length, pages);
          assert.ok(relevant.every(call => JSON.stringify(call.payload.excludedAnimalTypes) === JSON.stringify([animalType])));
          assert.ok(page.data.posts.every(item => !item.animalTypes.includes(animalType)));
          matrix.push({ page: target.name, id: target.id, excluded: animalType, visible: expected.length, pages });
          page.onUnload();
        }
      }
      return { scenarios: matrix.length, includesPagination: matrix.some(row => row.pages > 1), matrix };
    });

    await check('native video detail pages receive playable source and do not show invented times', async () => {
      const rows = [];
      for (const item of all.filter(post => post.contentType === 'video')) {
        const { page } = await readPage('post', { id: item.id });
        assert.equal(page.data.post.video.url, item.video.url);
        assert.equal(page.data.post.timeText, '');
        assert.equal(page.data.post.hasRequiredCredits, false);
        rows.push({ id: item.id, source: page.data.post.video.url, durationText: page.data.post.videoDurationText });
        page.onUnload();
      }
      return rows;
    });
  } finally {
    exportedApi.call = previousCall;
    if (previousWx === undefined) delete global.wx; else global.wx = previousWx;
    if (previousPage === undefined) delete global.Page; else global.Page = previousPage;
  }

  await check('current public views display no attribution or licence panel while retaining internal source records', async () => {
    const views = all.map(shared.post);
    assert.ok(views.every(item => !item.hasRequiredCredits));
    assert.ok(views.every(item => item.imageCredits.every(credit => !credit.requiresAttribution)));
    assert.ok(views.every(item => item.author.accountLabel === '' && item.timeText === ''));
    assert.ok(CURATED_POSTS.every(item => item.source && item.imageCredits.length > 0));
    assert.ok(views.every(item => !/Wikimedia|Creative Commons|CC0|CC BY|Public domain|图片来源|资料来源/i.test(item.title + '\n' + item.text)));
    const detail = fs.readFileSync(path.join(MINI, 'pages/post/index.wxml'), 'utf8');
    assert.match(detail, /wx:if="{{post\.hasRequiredCredits}}"[^>]*class="image-credits"/);
    assert.match(detail, /wx:if="{{credit\.requiresAttribution}}"/);
    for (const name of ['community', 'circle', 'author', 'post']) {
      const markup = fs.readFileSync(path.join(MINI, 'pages', name, 'index.wxml'), 'utf8');
      assert.doesNotMatch(markup, /{{\s*(?:post|item)\.source(?:\.|\s*}})/);
    }
    return { contentChecked: views.length, visibleCreditPanels: 0, sourceEvidenceRetained: true };
  });

  await check('editorial accounts never inflate real members, pets, follows or activity', async () => {
    const state = platform.getStorageSync(STORAGE_KEY);
    const stats = await service.call('getPetStats');
    assert.equal(stats.totalUsers, 1); assert.equal(stats.profilesWithPet, 0);
    assert.equal(stats.publicPetProfiles, 0);
    assert.equal(state.users.filter(user => user.isEditorial).length, EDITORS.length);
    assert.ok(state.users.filter(user => user.isEditorial).every(user => !user.pet && !user.showPet && !user.isAdmin && user.verification.status === 'unverified'));
    assert.deepEqual(boot.circles.map(circle => circle.memberCount), CIRCLES.map(circle => circle.id === 'circle-neighbors' ? 1 : 0));
    for (const key of ['events', 'comments', 'likes', 'bookmarks', 'follows']) assert.equal(state[key].length, 0, key);
    assert.equal(boot.stats.postCount, 0); assert.equal(boot.stats.followingCount, 0);
    return { editorialAccounts: EDITORS.length, realUsers: stats.totalUsers, profilesWithPet: stats.profilesWithPet,
      ownPosts: boot.stats.postCount, circleMemberCounts: boot.circles.map(circle => ({ id: circle.id, count: circle.memberCount })) };
  });

  report.passed = report.checks.every(result => result.status === 'passed');
  report.summary = { passed: report.checks.filter(result => result.status === 'passed').length,
    failed: report.checks.filter(result => result.status === 'failed').length };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT), ...report.summary, inventory: report.inventory,
    failures: report.checks.filter(result => result.status === 'failed') }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
