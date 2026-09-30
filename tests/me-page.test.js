'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../miniprogram/services/api');
const drafts = require('../miniprogram/pages/_drafts');

// Every account, draft and API response in this suite exists only in memory.
// No browser or real local/backend account is opened by these tests.
function fixture(t) {
  const storage = new Map([
    ['unrelated-privacy', { publicProfile: false, showPet: false }],
    ['unrelated-location', { label: '仅内存测试参照点' }]
  ]);
  const effects = { calls: [], reads: [], writes: [], removals: [], navigations: [], toasts: [], uploadClears: 0, readFails: false };
  const state = {
    boot: {
      mode: 'demo',
      user: {
        id: 'memory-user-a', nickname: '仅内存测试用户', bio: '仅内存测试介绍',
        publicProfile: false, showPet: false, pet: { name: '仅内存宠物', type: 'cat' },
        verification: { status: 'unverified' }
      },
      stats: { postCount: 7, joinedCircleCount: 2, joinedEventCount: 3, bookmarkCount: 11, followingCount: 0 },
      circles: [
        { id: 'memory-circle-a', name: '仅内存已加入圈子甲', isJoined: true, memberCount: 17 },
        { id: 'memory-circle-b', name: '仅内存未加入圈子', isJoined: false, memberCount: 31 },
        { id: 'memory-circle-c', name: '仅内存已加入圈子乙', isJoined: true, memberCount: 6 }
      ],
      settings: { contact: '仅内存测试联系信息' }
    }
  };
  const previous = { wx: global.wx, Page: global.Page, call: api.call, clearLocalUploads: api.clearLocalUploads };
  global.wx = {
    getStorageSync(key) {
      effects.reads.push(key);
      if (effects.readFails) throw new Error('仅测试存储读取失败');
      return structuredClone(storage.get(key));
    },
    setStorageSync(key, value) { effects.writes.push({ key, value: structuredClone(value) }); storage.set(key, structuredClone(value)); },
    removeStorageSync(key) { effects.removals.push(key); storage.delete(key); },
    navigateTo(options) { effects.navigations.push(options.url); },
    stopPullDownRefresh() {},
    showToast(options) { effects.toasts.push(options.title); }
  };
  api.call = async (action, payload = {}) => {
    effects.calls.push({ action, payload: structuredClone(payload) });
    assert.equal(action, 'bootstrap', 'refresh and navigation never perform API writes');
    state.response = structuredClone(state.boot);
    return state.response;
  };
  api.clearLocalUploads = async () => { effects.uploadClears += 1; };
  let definition;
  global.Page = value => { definition = value; };
  const source = require.resolve('../miniprogram/pages/me/index');
  delete require.cache[source];
  require(source);
  assert.ok(definition, 'the me page registers');
  const page = { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
  t.after(() => {
    page.onUnload();
    global.wx = previous.wx;
    global.Page = previous.Page;
    api.call = previous.call;
    api.clearLocalUploads = previous.clearLocalUploads;
  });
  return { page, state, effects, storage };
}

function saveMemoryDraft(storage, owner, value) {
  storage.set(drafts.KEY, { ...(storage.get(drafts.KEY) || {}), [owner]: { version: 1, savedAt: 1, ...value } });
}

function assertReadOnly(effects) {
  assert.deepEqual(effects.writes, [], 'passive page actions never save a draft or privacy setting');
  assert.deepEqual(effects.removals, [], 'passive page actions never clear storage');
  assert.equal(effects.uploadClears, 0, 'passive page actions never remove local uploads');
  assert.deepEqual(effects.toasts, [], 'passive page actions never show a mutation result');
  assert.ok(effects.calls.every(call => call.action === 'bootstrap'));
}

test('my page reads only the current account and mode draft and clears a previous account preview', async t => {
  const { page, state, storage, effects } = fixture(t);
  saveMemoryDraft(storage, 'demo:memory-user-a', { text: '本机甲的草稿内容' });
  saveMemoryDraft(storage, 'demo:memory-user-b', { text: '本机乙的草稿内容' });
  saveMemoryDraft(storage, 'cloud:memory-user-a', { text: '云端甲的草稿内容' });
  saveMemoryDraft(storage, 'memory-user-a', { text: '不得读取的未隔离旧草稿' });
  const before = structuredClone(storage);
  await page.refresh();
  assert.equal(page.data.hasDraft, true);
  assert.match(page.data.draftPreview, /本机甲/);
  assert.doesNotMatch(page.data.draftPreview, /本机乙|云端甲|未隔离/);
  state.boot.user.id = 'memory-user-b';
  await page.refresh();
  assert.equal(page.data.hasDraft, true);
  assert.match(page.data.draftPreview, /本机乙/);
  state.boot.user.id = 'memory-user-a';
  state.boot.mode = 'cloud';
  await page.refresh();
  assert.equal(page.data.hasDraft, true);
  assert.match(page.data.draftPreview, /云端甲/);
  state.boot.user.id = 'memory-user-without-draft';
  await page.refresh();
  assert.equal(page.data.hasDraft, false);
  assert.doesNotMatch(page.data.draftPreview || '', /本机甲|本机乙|云端甲|未隔离/);
  assert.equal(page.data.error, '');
  assert.deepEqual(storage, before, 'all account drafts remain intact');
  assert.deepEqual(effects.reads, [drafts.KEY, drafts.KEY, drafts.KEY, drafts.KEY]);
  assertReadOnly(effects);
});

test('my page distinguishes an empty compose snapshot from text, media, upload and editing drafts', async t => {
  const { page, storage, effects } = fixture(t);
  const empty = {
    text: ' \n ', title: ' \t ', kind: 'daily', circleId: 'memory-circle-a',
    images: [], video: null, completedUploads: [], pendingUploads: [], failedUploads: [],
    selectedTopics: [], animalTypes: [], selectedEventId: '', coverIndex: 0
  };
  const cases = [
    ['empty editor snapshot', {}, false],
    ['text only', { text: '还没发布的正文' }, true],
    ['title only', { title: '还没发布的标题' }, true],
    ['image only', { images: ['https://example.invalid/memory-image.jpg'] }, true],
    ['video only', { video: { url: 'https://example.invalid/memory-video.mp4' } }, true],
    ['completed upload', { completedUploads: [{ ticketId: 'memory-complete', mediaType: 'image' }] }, true],
    ['pending image', { pendingUploads: [{ ticketId: 'memory-pending-image', mediaType: 'image' }] }, true],
    ['pending video', { pendingUploads: [{ ticketId: 'memory-pending-video', mediaType: 'video' }] }, true],
    ['failed upload', { failedUploads: [{ ticketId: 'memory-failed', mediaType: 'image' }] }, true],
    ['selected topic', { selectedTopics: ['陪伴日常'] }, true],
    ['selected animal', { animalTypes: ['cat'] }, true],
    ['linked event', { selectedEventId: 'memory-event' }, true],
    ['question editor', { kind: 'question' }, true],
    ['meetup editor', { kind: 'meetup' }, true]
  ];
  for (const [label, change, hasDraft] of cases) {
    saveMemoryDraft(storage, 'demo:memory-user-a', { ...empty, ...change });
    const before = structuredClone(storage);
    await page.refresh();
    assert.equal(page.data.hasDraft, hasDraft, label);
    assert.equal(page.data.draftError, '', label);
    assert.equal(page.data.error, '', label);
    if (hasDraft) assert.ok(typeof page.data.draftPreview === 'string' && page.data.draftPreview.trim(), label + ' has a useful summary');
    assert.deepEqual(storage, before, label + ' remains recoverable by the editor');
  }
  assertReadOnly(effects);
});

test('missing or unsupported drafts do not interrupt profile and account statistics', async t => {
  const { page, state, storage, effects } = fixture(t);
  for (const stored of [undefined, {}, { 'demo:memory-user-a': { version: 9, text: '无法恢复的版本' } }]) {
    if (stored === undefined) storage.delete(drafts.KEY);
    else storage.set(drafts.KEY, stored);
    await page.refresh();
    assert.equal(page.data.hasDraft, false);
    assert.equal(page.data.draftError, '');
    assert.equal(page.data.error, '');
    assert.equal(page.data.loading, false);
    assert.deepEqual(page.data.user, state.boot.user);
    assert.deepEqual(page.data.stats, state.boot.stats);
  }
  assertReadOnly(effects);
});

test('draft read failure stays local to the draft entry and a successful refresh recovers it', async t => {
  const { page, state, storage, effects } = fixture(t);
  saveMemoryDraft(storage, 'demo:memory-user-a', { title: '读取恢复后仍在的标题' });
  const before = structuredClone(storage);
  await page.refresh();
  assert.equal(page.data.hasDraft, true);
  effects.readFails = true;
  await page.refresh();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '', 'storage trouble does not replace the entire me page');
  assert.ok(page.data.draftError, 'the draft entry reports unavailable local storage');
  assert.equal(page.data.hasDraft, false, 'an unreadable draft is not represented by a stale summary');
  assert.deepEqual(page.data.user, state.boot.user);
  assert.deepEqual(page.data.stats, state.boot.stats);
  effects.readFails = false;
  await page.refresh();
  assert.equal(page.data.draftError, '');
  assert.equal(page.data.hasDraft, true);
  assert.match(page.data.draftPreview, /读取恢复/);
  assert.deepEqual(storage, before);
  assertReadOnly(effects);
});

test('draft and circle discovery entries only navigate and preserve saved profile and storage', async t => {
  const { page, state, storage, effects } = fixture(t);
  saveMemoryDraft(storage, 'demo:memory-user-a', { text: '入口不得写入或清除的正文', pendingUploads: [{ ticketId: 'memory-pending' }] });
  const beforeStorage = structuredClone(storage);
  const beforeUser = structuredClone(state.boot.user);
  await page.refresh();
  const beforeCalls = structuredClone(effects.calls);
  page.openDraft();
  page.exploreCircles();
  assert.deepEqual(effects.navigations, ['/pages/compose/index', '/pages/circle-square/index']);
  assert.deepEqual(effects.calls, beforeCalls, 'opening an entry never writes API state');
  assert.deepEqual(storage, beforeStorage);
  assert.deepEqual(page.data.user, beforeUser);
  assert.deepEqual(state.response.user, beforeUser);
  assertReadOnly(effects);
});

test('successful local cleanup immediately removes the old draft summary without deleting the account', async t => {
  const { page, state, storage, effects } = fixture(t);
  saveMemoryDraft(storage, 'demo:memory-user-a', { text: '清理后不得滞留的草稿正文', pendingUploads: [{ ticketId: 'memory-pending' }] });
  const beforeUser = structuredClone(state.boot.user);
  const beforePrivacy = structuredClone(storage.get('unrelated-privacy'));
  await page.refresh();
  assert.equal(page.data.hasDraft, true);
  assert.match(page.data.draftPreview, /不得滞留/);
  const beforeCalls = structuredClone(effects.calls);
  page.setData({ localCleanupPending: true });
  await page.clearLocalDrafts();
  assert.equal(page.data.hasDraft, false);
  assert.doesNotMatch(page.data.draftPreview || '', /清理后不得滞留的草稿正文/);
  assert.equal(page.data.draftError, '');
  assert.equal(page.data.localCleanupPending, false);
  assert.equal(page.data.busy, false);
  assert.equal(storage.has(drafts.KEY), false, 'the editor cannot restore the cleared draft');
  assert.equal(effects.uploadClears, 1);
  assert.equal(effects.calls.some(call => call.action === 'deleteAccount'), false);
  assert.deepEqual(effects.calls, beforeCalls, 'local cleanup needs no account mutation or bootstrap refresh');
  assert.deepEqual(page.data.user, beforeUser);
  assert.deepEqual(state.response.user, beforeUser);
  assert.deepEqual(storage.get('unrelated-privacy'), beforePrivacy);
  assert.deepEqual(effects.writes, [], 'cleanup does not rewrite user privacy or an empty draft');
  assert.equal(effects.toasts.length, 1);
});

test('privacy summary follows existing profile and pet visibility without changing or inferring settings', async t => {
  const { page, state, storage, effects } = fixture(t);
  const beforeStorage = structuredClone(storage);
  const summaries = new Map();
  for (const publicProfile of [false, true]) {
    for (const showPet of [false, true]) {
      Object.assign(state.boot.user, { publicProfile, showPet });
      const beforeUser = structuredClone(state.boot.user);
      await page.refresh();
      assert.ok(typeof page.data.privacySummary === 'string' && page.data.privacySummary.trim());
      summaries.set(publicProfile + ':' + showPet, page.data.privacySummary);
      assert.deepEqual(page.data.user, beforeUser);
      assert.deepEqual(state.response.user, beforeUser, 'summarizing never mutates the bootstrap result');
    }
  }
  assert.notEqual(summaries.get('false:false'), summaries.get('true:false'), 'public profile disclosure follows the saved setting');
  assert.notEqual(summaries.get('false:false'), summaries.get('false:true'), 'pet display disclosure follows the saved setting');
  const existingSummary = page.data.privacySummary;
  Object.assign(state.boot.user, { neighborVisible: true, residenceSharing: true, area: '仅内存片区', verification: { status: 'phone_verified' } });
  await page.refresh();
  assert.equal(page.data.privacySummary, existingSummary, 'nearby discovery and verification never imply a changed profile disclosure');
  state.boot.user.pet = null;
  state.boot.user.showPet = false;
  await page.refresh();
  const withoutPet = page.data.privacySummary;
  state.boot.user.showPet = true;
  await page.refresh();
  assert.equal(page.data.privacySummary, withoutPet, 'without registered pet data, the display flag alone does not claim a displayed pet');
  assert.doesNotMatch(page.data.privacySummary, /没有宠物|未养宠/, 'missing pet data does not assert that the user owns no pet');
  assert.deepEqual(storage, beforeStorage);
  assertReadOnly(effects);
});

test('my page retains all five supplied statistics and the actual joined circles', async t => {
  const { page, state, effects } = fixture(t);
  const before = structuredClone(state.boot);
  await page.refresh();
  assert.deepEqual(page.data.stats, before.stats);
  assert.deepEqual(page.data.circles, [before.circles[0], before.circles[2]]);
  assert.deepEqual(state.response, before, 'displaying circles never edits their stored memberships or counts');
  for (const type of ['posts', 'circles', 'events', 'bookmarks', 'following']) {
    page.records({ currentTarget: { dataset: { type } } });
  }
  assert.deepEqual(effects.navigations, ['posts', 'circles', 'events', 'bookmarks', 'following'].map(type => '/pages/records/index?type=' + type));
  state.boot.stats = {};
  state.boot.circles = [];
  await page.refresh();
  assert.deepEqual(page.data.stats, {}, 'missing statistics are not fabricated');
  assert.deepEqual(page.data.circles, [], 'no sample memberships are inserted');
  assertReadOnly(effects);
});
