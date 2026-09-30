'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createService, idFor, TERMS_VERSION, PRIVACY_VERSION } = require('../cloudfunctions/community/service');
const { contentType, createStorage } = require('../cloudfunctions/community/storage');
const { createPhoneVerifier } = require('../cloudfunctions/community/phone');
const { createRuntimeConfig, normalizeRuntimeConfig } = require('../cloudfunctions/community/runtime-config');
const { authorizeMaintenance } = require('../cloudfunctions/community/maintenance');
const consent = { accepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };
const phoneKeyFor = value => `ph_${crypto.createHash('sha256').update(value).digest('hex')}`;
const operatorConfig = { name: '有宠运营团队', contact: 'support@example.test', retention: '账号注销后删除个人资料，必要运行记录按已确认的保留规则清理。',
  policyApproved: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };

// A serializable, rollback-capable adapter models the domain contract without SDK/network.
// Real CloudBase transaction conflicts/permissions must additionally be checked after deployment.
function memoryRepository() {
  let tables = new Map(); let lock = Promise.resolve();
  const table = (state, name) => { if (!state.has(name)) state.set(name, new Map()); return state.get(name); };
  const access = state => ({
    async get(name, id) { return structuredClone(table(state, name).get(id) || null); },
    async set(name, id, value) { table(state, name).set(id, structuredClone({ ...value, _id: id })); },
    async remove(name, id) { table(state, name).delete(id); }
  });
  const compare = (actual, expected) => {
    if (!expected || typeof expected !== 'object') return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
    return Object.entries(expected).every(([op, value]) => ({
      lt: () => actual < value, lte: () => actual <= value, gt: () => actual > value,
      gte: () => actual >= value, neq: () => actual !== value, in: () => value.includes(actual)
    })[op]());
  };
  return {
    get: (...args) => access(tables).get(...args),
    set: (...args) => access(tables).set(...args),
    remove: (...args) => access(tables).remove(...args),
    async find(name, filters = {}, options = {}) {
      const rows = [...table(tables, name).values()].filter(row => Object.entries(filters).every(([key, value]) => compare(row[key], value)));
      if (options.orderBy) rows.sort((a, b) => a[options.orderBy] < b[options.orderBy] ? -1 : a[options.orderBy] > b[options.orderBy] ? 1 : 0);
      if (options.direction === 'desc') rows.reverse();
      return structuredClone(rows.slice(0, options.limit || 20));
    },
    transaction(fn) {
      const job = lock.then(async () => {
        const copy = structuredClone(tables);
        const result = await fn(access(copy)); tables = copy; return result;
      });
      lock = job.catch(() => {}); return job;
    }
  };
}

async function fixture(options = {}) {
  const { verifyUsers = true, ...serviceOptions } = options;
  const repository = memoryRepository(); let serial = 0; let time = 1_800_000_000_000;
  const published = []; const removed = [];
  const storage = { enabled: true,
    isExpectedFile: (file, path) => file === `cloud://test.bucket/${path}`,
    fileIdForPath: path => `cloud://test.bucket/${path}`,
    async verifyAndPublish({ cloudPath }) { const file = `cloud://test.bucket/${cloudPath}`; published.push(file); return file; },
    async remove(files) { removed.push(...files); }
  };
  const phoneVerifier = { enabled: true,
    async verifyCode(code) {
      if (!code.startsWith('trusted-code-')) throw new Error('Not a trusted test verifier code');
      return { phoneKey: phoneKeyFor(code), maskedPhone: '+86 138****1234' };
    }
  };
  const service = createService({ repository, now: () => time, randomId: () => String(++serial).padStart(24, '0'),
    adminOpenids: ['operator'], storage, phoneVerifier, runtimeConfig: operatorConfig, ...serviceOptions });
  const call = (who, action, payload = {}) => service.handle(action, payload, { openid: who });
  await call('operator', 'initialize', { city: '测试城市', areas: ['公园片区'], contact: '运营者' });
  for (const who of ['alice', 'bob', 'charlie']) await call(who, 'bootstrap');
  if (verifyUsers) for (const who of ['operator', 'alice', 'bob', 'charlie']) await call(who, 'verifyPhone', { code: `trusted-code-${who}`, consent });
  const eventData = { title: '一起认识附近的爱宠朋友', description: '在公园公共区域散步交流', location: '公园南门',
    startAt: time + 3600_000, endAt: time + 7200_000, capacity: 2, petPolicy: 'optional', circleId: 'neighbors' };
  return { repository, service, call, eventData, published, removed, storage: serviceOptions.storage || storage, now: () => time, advance: ms => { time += ms; } };
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test('neighbors require independent verified opt-in and never infer public areas or expose private pet fields', async () => {
  const f = await fixture();
  await f.call('bob', 'updateProfile', { nickname: '可见昵称', area: '公园片区', bio: '不该用于搜索的秘密', pet: { name: '秘密宠物', type: 'cat' } });
  assert.deepEqual((await f.call('alice', 'listNeighbors', { kind: 'all' })).items, []);
  await rejects(f.call('bob', 'updateProfile', { neighborVisible: true }), 'INVALID_INPUT');
  await f.call('bob', 'updateProfile', { neighborVisible: true, neighborAreaId: 'sh-minhang-xinzhuang' });
  assert.deepEqual((await f.call('alice', 'listNeighbors')).items, []);
  let result = await f.call('alice', 'listNeighbors', { kind: 'people' });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].pet, null); assert.equal(result.items[0].bio, '');
  assert.equal(result.items[0].neighborArea.id, 'sh-minhang-xinzhuang');
  assert.equal(result.items[0].area, undefined); assert.equal(result.items[0].verification, undefined);
  assert.deepEqual((await f.call('alice', 'listNeighbors', { kind: 'all', query: '秘密' })).items, []);
  await f.call('bob', 'updateProfile', { showPet: true });
  result = await f.call('alice', 'listNeighbors', { petType: 'cat' });
  assert.deepEqual(result.items[0].pet, { name: '秘密宠物', type: 'cat' });
  for (const query of ['莘庄', '闵行']) assert.deepEqual((await f.call('alice', 'listNeighbors', { query })).items.map(item => item.id), [idFor('bob')]);
  assert.deepEqual((await f.call('alice', 'listNeighbors', { query: '公园片区' })).items, []);
  assert.deepEqual((await f.call('alice', 'listNeighbors', { kind: 'people' })).items, []);
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: true });
  assert.equal((await f.call('alice', 'listNeighbors')).items[0].isFollowing, true);
  const visibleUser = await f.repository.get('users', idFor('bob'));
  await f.repository.set('users', idFor('bob'), { ...visibleUser, isEditorial: true });
  assert.deepEqual((await f.call('alice', 'listNeighbors', { kind: 'all' })).items, []);
  await rejects(f.call('alice', 'listNeighbors', { petType: 'none' }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'updateProfile', { pet: { name: '宠物', type: 'cat', photo: 'https://example.invalid/photo.jpg' } }), 'INVALID_INPUT');
  const unverified = await fixture({ verifyUsers: false });
  await rejects(unverified.call('bob', 'updateProfile', { neighborVisible: true, neighborAreaId: 'sh-xuhui' }), 'VERIFICATION_REQUIRED');
  assert.equal((await unverified.call('bob', 'updateProfile', { neighborVisible: false })).user.neighborVisible, false);
});

test('residence distance is mutual opt-in, coarse-only, rate-limited across disable/re-enable, and cleared on exit', async () => {
  const f = await fixture(); const grid = require('../miniprogram/data/neighbor-location');
  const cell = grid.toCell({ latitude: 31.1, longitude: 121.38, coordinateSystem: 'gcj02' });
  for (const who of ['alice', 'bob']) await f.call(who, 'updateProfile', { neighborVisible: true, neighborAreaId: 'sh-minhang-xinzhuang', pet: { name: '测试宠物', type: 'dog' }, showPet: true });
  await f.call('bob', 'updateProfile', { residenceSharing: true, residenceCell: { ...cell, x: cell.x + 2 } });
  assert.equal((await f.call('alice', 'listNeighbors')).items[0].distanceBand, undefined);
  await f.call('alice', 'updateProfile', { residenceSharing: true, residenceCell: cell });
  const neighbor = (await f.call('alice', 'listNeighbors')).items[0];
  assert.equal(neighbor.distanceBand, '约1–3km');
  for (const key of ['residenceCell', 'residenceUpdatedAt', 'latitude', 'longitude', 'homeAddress', 'area', 'openid']) assert.equal(neighbor[key], undefined);
  assert.deepEqual((await f.call('alice', 'bootstrap')).user.residenceCell, cell);
  await rejects(f.call('alice', 'updateProfile', { residenceCell: { ...cell, latitude: 31.1 } }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'updateProfile', { latitude: 31.1 }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'updateProfile', { residenceCell: { ...cell, x: cell.x + 1 } }), 'RESIDENCE_CHANGE_LIMIT');
  await f.call('alice', 'updateProfile', { residenceSharing: false });
  assert.equal((await f.call('alice', 'bootstrap')).user.residenceCell, null);
  await rejects(f.call('alice', 'updateProfile', { residenceSharing: true, residenceCell: cell }), 'RESIDENCE_CHANGE_LIMIT');
  f.advance(grid.CHANGE_INTERVAL_MS);
  await f.call('alice', 'updateProfile', { residenceSharing: true, residenceCell: cell });
  await f.call('alice', 'updateProfile', { neighborVisible: false });
  const self = (await f.call('alice', 'bootstrap')).user;
  assert.equal(self.residenceSharing, false); assert.equal(self.residenceCell, null);
  assert.equal((await f.call('bob', 'listNeighbors')).items.length, 0);
  await f.call('bob', 'deleteAccount');
  const deleted = await f.repository.get('users', idFor('bob'));
  assert.equal(deleted.residenceCell, undefined); assert.equal(deleted.neighborVisible, undefined);
});

test('neighbor scans filter before pagination, advance through hidden pages, and honor bilateral blocks', async () => {
  const f = await fixture(); const expected = [];
  for (let index = 0; index < 85; index += 1) {
    const id = 'z_neighbor_' + String(index).padStart(3, '0'); const phoneKey = 'neighbor_phone_' + index;
    await f.repository.set('users', id, { status: 'active', nickname: '测试邻居' + index, neighborVisible: index % 3 === 0, neighborAreaId: 'sh-xuhui', pet: { name: '测试毛孩子', type: index % 2 === 0 ? 'dog' : 'cat' }, showPet: true });
    await f.repository.set('identities', id, { status: 'phone_verified', phoneKey });
    await f.repository.set('phone_claims', phoneKey, { userId: id });
    if (index % 6 === 0) expected.push(id);
  }
  const seen = []; let cursor;
  do {
    const page = await f.call('alice', 'listNeighbors', { areaId: 'sh-xuhui', petType: 'dog', limit: 2, cursor });
    seen.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(new Set(seen), new Set(expected)); assert.equal(seen.length, expected.length);
  await f.call('bob', 'updateProfile', { neighborVisible: true, neighborAreaId: 'sh-xuhui', pet: { name: '测试猫', type: 'cat' }, showPet: true });
  await f.call('bob', 'blockUser', { userId: idFor('alice'), block: true });
  let page = await f.call('alice', 'listNeighbors', { kind: 'all', limit: 50 });
  assert.ok(page.items.every(item => item.id !== idFor('bob')));
  await f.call('bob', 'blockUser', { userId: idFor('alice'), block: false });
  await f.call('alice', 'blockUser', { userId: idFor('bob'), block: true });
  page = await f.call('alice', 'listNeighbors', { kind: 'all', limit: 50 });
  assert.ok(page.items.every(item => item.id !== idFor('bob')));
});

test('message reactions notify only the recipient once and retain read state after undo/redo', async () => {
  const f = await fixture(); const post = await postFor(f, 'bob');
  const storedPost = await f.repository.get('posts', post.id);
  await f.repository.set('posts', post.id, { ...storedPost, images: ['cloud://test.bucket/first.jpg', 'cloud://test.bucket/cover.jpg'], coverIndex: 1 });
  await f.call('alice', 'updateProfile', { nickname: '测试互动者', area: '公园片区', bio: '私密测试简介', pet: { name: '测试宠物', type: 'cat' }, publicProfile: false, showPet: false });
  for (const [action, field] of [['likePost', 'like'], ['bookmarkPost', 'bookmark']]) {
    await f.call('alice', action, { id: post.id, [field]: true });
    await f.call('alice', action, { id: post.id, [field]: true });
  }
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: true });
  const first = await f.call('bob', 'listMessages');
  assert.equal(first.items.length, 3);
  assert.deepEqual(first.categoryUnread, { interactions: 2, comments: 0, follows: 1, system: 0 });
  assert.equal(first.unreadCount, 3);
  const liked = first.items.find(message => message.kind === 'like');
  assert.deepEqual(Object.keys(liked.actor).sort(), ['avatar', 'id', 'nickname']);
  assert.equal(liked.actor.nickname, '测试互动者');
  assert.equal(liked.cover, 'cloud://test.bucket/cover.jpg');
  await f.call('alice', 'updateProfile', { showPet: true });
  const publicActor = (await f.call('bob', 'listMessages')).items.find(message => message.kind === 'like').actor;
  assert.deepEqual(publicActor.pet, { name: '测试宠物', type: 'cat' });
  assert.equal(publicActor.area, undefined); assert.equal(publicActor.bio, undefined); assert.equal(publicActor.verification, undefined);
  assert.equal(first.items.find(message => message.kind === 'follow').targetId, idFor('alice'));
  const read = await f.call('bob', 'readMessage', { all: true });
  assert.equal(read.unreadCount, 0);
  f.advance(5000);
  for (const [action, field] of [['likePost', 'like'], ['bookmarkPost', 'bookmark']]) {
    await f.call('alice', action, { id: post.id, [field]: false });
    await f.call('alice', action, { id: post.id, [field]: true });
  }
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: false });
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: true });
  const again = await f.call('bob', 'listMessages');
  assert.equal(again.items.length, 3); assert.equal(again.unreadCount, 0);
  assert.deepEqual(again.items.map(message => [message.id, message.createdAt]), first.items.map(message => [message.id, message.createdAt]));
  await f.call('bob', 'likePost', { id: post.id, like: true });
  await f.call('bob', 'bookmarkPost', { id: post.id, bookmark: true });
  assert.equal((await f.call('bob', 'listMessages')).items.length, 3);
  assert.deepEqual((await f.call('charlie', 'listMessages')).categoryUnread, { interactions: 0, comments: 0, follows: 0, system: 0 });
});

test('stable follow notices are recreated after either account is deleted and re-registered', async () => {
  const f = await fixture();
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: true });
  const first = (await f.call('bob', 'listMessages')).items[0];
  await f.call('bob', 'readMessage', { all: true });
  await f.call('alice', 'deleteAccount');
  assert.deepEqual((await f.call('bob', 'listMessages')).items, []);
  f.advance(1000);
  await f.call('alice', 'bootstrap');
  await f.call('alice', 'verifyPhone', { code: 'trusted-code-alice', consent });
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: true });
  const afterSender = await f.call('bob', 'listMessages');
  assert.equal(afterSender.items.length, 1);
  assert.equal(afterSender.categoryUnread.follows, 1);
  assert.ok(afterSender.items[0].createdAt > first.createdAt);
  await f.call('bob', 'readMessage', { all: true });

  await f.call('bob', 'deleteAccount');
  f.advance(1000);
  await f.call('bob', 'bootstrap');
  await f.call('bob', 'verifyPhone', { code: 'trusted-code-bob', consent });
  assert.deepEqual((await f.call('bob', 'listMessages')).items, []);
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: true });
  const afterReceiver = await f.call('bob', 'listMessages');
  assert.equal(afterReceiver.items.length, 1);
  assert.equal(afterReceiver.categoryUnread.follows, 1);
  assert.ok(afterReceiver.items[0].createdAt > afterSender.items[0].createdAt);
});

test('message categories filter before pagination and every page retains exact global unread counts', async () => {
  const f = await fixture(); const expected = [];
  for (let index = 0; index < 137; index += 1) {
    const kind = index % 7 === 0 ? 'like' : index % 5 === 0 ? 'follow' : 'system';
    const id = 'inbox_fixture_' + String(index).padStart(3, '0');
    await f.repository.set('messages', id, { toId: idFor('alice'), actorId: '', kind, title: '仅测试通知', text: '仅内存测试', targetType: kind === 'follow' ? 'user' : 'system', targetId: '', createdAt: f.now() + Math.floor(index / 3), isRead: index % 2 === 0 });
    if (kind === 'like') expected.push(id);
  }
  await f.repository.set('messages', 'legacy_post_notice', { toId: idFor('alice'), title: '旧帖子留言', text: '', targetType: 'post', targetId: 'deleted_post', createdAt: f.now() - 1, isRead: false });
  await f.repository.set('messages', 'legacy_event_notice', { toId: idFor('alice'), title: '旧活动消息', text: '', targetType: 'event', targetId: 'deleted_event', createdAt: f.now() - 2, isRead: false });
  await f.repository.set('messages', 'other_account_notice', { toId: idFor('bob'), title: '其他账号私信', text: '', targetType: 'system', createdAt: f.now() + 100, isRead: false });
  const all = await f.call('alice', 'listMessages');
  assert.equal(all.items.length, 20); assert.equal(all.unreadCount, 70);
  assert.equal(Object.values(all.categoryUnread).reduce((a, b) => a + b, 0), 70);
  const received = []; let cursor;
  do {
    const page = await f.call('alice', 'listMessages', { category: 'interactions', limit: 3, cursor });
    assert.equal(page.unreadCount, all.unreadCount); assert.deepEqual(page.categoryUnread, all.categoryUnread);
    assert.ok(page.items.every(message => message.category === 'interactions'));
    received.push(...page.items.map(message => message.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(new Set(received), new Set(expected)); assert.equal(received.length, expected.length);
  const comments = await f.call('alice', 'listMessages', { category: 'comments' });
  assert.deepEqual(comments.items.map(message => message.id), ['legacy_post_notice']);
  assert.equal(comments.items[0].actor, undefined); assert.equal(comments.items[0].cover, undefined);
  const readOne = await f.call('alice', 'readMessage', { id: 'legacy_post_notice' });
  assert.equal(readOne.unreadCount, 69); assert.equal(readOne.categoryUnread.comments, 0);
  await f.call('alice', 'readMessage', { all: true });
  assert.equal((await f.call('alice', 'listMessages', { category: 'follows' })).unreadCount, 0);
  assert.equal((await f.call('bob', 'listMessages')).unreadCount, 1);
  await rejects(f.call('alice', 'listMessages', { category: 'unexpected' }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'listMessages', { cursor: 'bad cursor' }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'listMessages', { cursor: false }), 'INVALID_INPUT');
});

test('messages hide blocked actors and blocked target owners without leaking covers or unread counts', async () => {
  const f = await fixture(); const post = await postFor(f, 'bob');
  await f.call('alice', 'likePost', { id: post.id, like: true });
  const notice = (await f.call('bob', 'listMessages')).items[0];
  await f.call('alice', 'blockUser', { userId: idFor('bob'), block: true });
  assert.deepEqual((await f.call('bob', 'listMessages')).items, []);
  assert.equal((await f.call('bob', 'listMessages')).unreadCount, 0);
  await rejects(f.call('bob', 'readMessage', { id: notice.id }), 'NOT_FOUND');
  const other = await postFor(f, 'charlie');
  const comment = (await f.call('bob', 'addComment', { targetType: 'post', targetId: other.id, text: '测试留言' })).comment;
  await f.call('operator', 'addComment', { targetType: 'post', targetId: other.id, text: '测试回复', replyToId: comment.id });
  assert.equal((await f.call('bob', 'listMessages', { category: 'comments' })).items[0].kind, 'reply');
  await f.call('charlie', 'blockUser', { userId: idFor('bob'), block: true });
  const hidden = await f.call('bob', 'listMessages');
  assert.deepEqual(hidden.items, []); assert.equal(hidden.unreadCount, 0);
});

test('message search filters titles, text and active public nicknames before paging while preserving privacy and global unread totals', async () => {
  const f = await fixture(); const hiddenPost = await postFor(f, 'charlie');
  await f.call('bob', 'updateProfile', { nickname: 'CATBuddy', bio: 'PRIVATE_BIO', pet: { name: 'PRIVATE_PET', type: 'cat' } });
  for (let index = 0; index < 26; index += 1) await f.repository.set('messages', 'search-' + String(index).padStart(2, '0'), {
    toId: idFor('alice'), actorId: index === 2 ? idFor('bob') : '',
    title: index === 0 ? 'CAT [日常]' : '通知', text: index === 1 ? 'cAt 正文' : '普通正文',
    kind: index === 2 ? 'follow' : index < 2 ? 'like' : 'system', targetType: 'system', targetId: '',
    createdAt: f.now() + Math.floor(index / 2), isRead: index === 1
  });
  const template = { title: 'CAT隐藏通知', text: '', kind: 'system', createdAt: f.now() + 100, isRead: false, targetType: 'system', targetId: '' };
  await f.repository.set('messages', 'search-other', { ...template, toId: idFor('bob') });
  await f.repository.set('messages', 'search-blocked', { ...template, toId: idFor('alice'), actorId: idFor('charlie') });
  await f.repository.set('messages', 'search-blocked-owner', { ...template, toId: idFor('alice'), targetType: 'post', targetId: hiddenPost.id });
  await f.call('charlie', 'blockUser', { userId: idFor('alice'), block: true });
  await f.repository.set('users', 'retired-actor', { nickname: 'CAT已注销', status: 'deleted' });
  await f.repository.set('messages', 'search-retired', { ...template, title: '旧通知', toId: idFor('alice'), actorId: 'retired-actor' });
  const before = await f.repository.find('messages', {}, { limit: 100 });
  const all = await f.call('alice', 'listMessages');
  assert.equal(all.items.length, 20); assert.equal(all.unreadCount, 26);
  const ids = []; let cursor;
  do {
    const page = await f.call('alice', 'listMessages', { query: '  CaT  ', limit: 1, cursor });
    assert.equal(page.items.length, 1);
    assert.equal(page.unreadCount, all.unreadCount); assert.deepEqual(page.categoryUnread, all.categoryUnread);
    ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, ['search-02', 'search-01', 'search-00']);
  const category = await f.call('alice', 'listMessages', { query: 'cat', category: 'interactions' });
  assert.deepEqual(category.items.map(item => item.id), ['search-01', 'search-00']);
  assert.deepEqual(category.categoryUnread, all.categoryUnread);
  assert.deepEqual((await f.call('alice', 'listMessages', { query: 'buddy' })).items.map(item => item.id), ['search-02']);
  assert.deepEqual((await f.call('alice', 'listMessages', { query: '[' })).items.map(item => item.id), ['search-00']);
  for (const query of ['PRIVATE_BIO', 'PRIVATE_PET', '没有匹配', '🐱'.repeat(60)]) {
    const page = await f.call('alice', 'listMessages', { query });
    assert.deepEqual(page.items, []); assert.equal(page.unreadCount, all.unreadCount);
  }
  assert.deepEqual(await f.call('alice', 'listMessages', { query: ' \n ' }), all);
  assert.deepEqual((await f.call('alice', 'listMessages', { query: 'cat', cursor: 'search-25' })).items.map(item => item.id), ids);
  for (const query of [null, 1, {}, '🐱'.repeat(61)]) await rejects(f.call('alice', 'listMessages', { query }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'listMessages', { query: '没有匹配', cursor: false }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'listMessages', { query: '没有匹配', cursor: 'search-other' }), 'INVALID_INPUT');
  assert.deepEqual(await f.repository.find('messages', {}, { limit: 100 }), before);
});

test('event comments are conversation notices while activity updates remain system notices', async () => {
  const f = await fixture(); const { event } = await f.call('operator', 'createEvent', f.eventData);
  await f.call('alice', 'joinEvent', { id: event.id, join: true });
  await f.call('alice', 'addComment', { targetType: 'event', targetId: event.id, text: '测试活动留言' });
  const conversations = await f.call('operator', 'listMessages', { category: 'comments' });
  assert.equal(conversations.items.length, 1); assert.equal(conversations.items[0].kind, 'comment');
  assert.equal((await f.call('operator', 'listMessages', { category: 'system' })).items.length, 1);
  await f.call('operator', 'updateEvent', { id: event.id, ...f.eventData, description: '更新后的测试活动安排' });
  const updates = await f.call('alice', 'listMessages', { category: 'system' });
  assert.equal(updates.items.length, 1); assert.equal(updates.items[0].kind, 'system');
});
async function postFor(f, who = 'alice', text = '今天遇到一只可爱的猫') {
  await f.call(who, 'joinCircle', { id: 'neighbors', join: true });
  return (await f.call(who, 'createPost', { circleId: 'neighbors', text, images: [] })).post;
}

test('authentication uses trusted context; forged privileges fail and initial data is real/empty', async () => {
  const f = await fixture();
  await rejects(f.service.handle('bootstrap', {}, {}), 'UNAUTHENTICATED');
  await rejects(f.call('alice', 'createEvent', { ...f.eventData, isAdmin: true }), 'INVALID_INPUT');
  await rejects(f.service.handle('createEvent', f.eventData, { openid: 'alice', isAdmin: true }), 'FORBIDDEN');
  await rejects(f.call('alice', 'initialize', { city: 'x', areas: ['x'], contact: 'x' }), 'FORBIDDEN');
  assert.deepEqual((await f.call('alice', 'listPosts')).items, []);
  assert.deepEqual((await f.call('alice', 'listEvents')).items, []);
  assert.equal((await f.call('alice', 'listCircles')).items.length, 8);
  const state = await f.call('alice', 'bootstrap');
  assert.equal(state.user.isAdmin, false);
  assert.equal(JSON.stringify(state).includes('openid'), false);
  await rejects(f.call('alice', 'toString'), 'UNKNOWN_ACTION');
});

test('circle membership and its count are idempotent under concurrent joins/leaves', async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 15 }, () => f.call('alice', 'joinCircle', { id: 'neighbors', join: true })));
  assert.equal((await f.call('bob', 'getCircle', { id: 'neighbors' })).circle.memberCount, 1);
  await Promise.all(Array.from({ length: 15 }, () => f.call('alice', 'joinCircle', { id: 'neighbors', join: false })));
  assert.equal((await f.call('bob', 'getCircle', { id: 'neighbors' })).circle.memberCount, 0);
  await rejects(f.call('alice', 'createPost', { circleId: 'neighbors', text: '你好', images: [] }), 'NOT_MEMBER');
});

test('post/comment ownership and administrator moderation enforce permissions', async () => {
  const f = await fixture(); const post = await postFor(f);
  const { comment } = await f.call('bob', 'addComment', { targetType: 'post', targetId: post.id, text: '我也很喜欢' });
  assert.equal((await f.call('alice', 'getPost', { id: post.id })).post.commentCount, 1);
  await rejects(f.call('bob', 'deletePost', { id: post.id }), 'FORBIDDEN');
  await rejects(f.call('alice', 'deleteComment', { id: comment.id }), 'FORBIDDEN');
  await f.call('operator', 'deleteComment', { id: comment.id });
  assert.equal((await f.call('alice', 'getPost', { id: post.id })).post.commentCount, 0);
  await f.call('operator', 'deletePost', { id: post.id });
  await rejects(f.call('alice', 'getPost', { id: post.id }), 'NOT_FOUND');
});

test('blocking is bilateral and cannot be bypassed through detail/reply APIs', async () => {
  const f = await fixture(); const alicePost = await postFor(f); const bobPost = await postFor(f, 'bob');
  const { comment } = await f.call('bob', 'addComment', { targetType: 'post', targetId: alicePost.id, text: '你好' });
  await f.call('alice', 'blockUser', { userId: idFor('bob'), block: true });
  assert.equal((await f.call('alice', 'listPosts')).items.some(post => post.id === bobPost.id), false);
  assert.equal((await f.call('bob', 'listPosts')).items.some(post => post.id === alicePost.id), false);
  await rejects(f.call('alice', 'getPost', { id: bobPost.id }), 'NOT_FOUND');
  await rejects(f.call('bob', 'getPost', { id: alicePost.id }), 'NOT_FOUND');
  assert.deepEqual((await f.call('alice', 'getPost', { id: alicePost.id })).comments, []);
  await rejects(f.call('alice', 'addComment', { targetType: 'post', targetId: alicePost.id, text: '继续', replyToId: comment.id }), 'NOT_FOUND');
  assert.equal((await f.call('alice', 'listBlocked')).items[0].id, idFor('bob'));
  await f.call('alice', 'blockUser', { userId: idFor('bob'), block: false });
  assert.equal((await f.call('alice', 'getPost', { id: bobPost.id })).post.id, bobPost.id);
});

test('private messages cannot be read or marked by another user', async () => {
  const f = await fixture(); const post = await postFor(f);
  await f.call('bob', 'addComment', { targetType: 'post', targetId: post.id, text: '很可爱' });
  const inbox = await f.call('alice', 'listMessages');
  assert.equal(inbox.unreadCount, 1);
  assert.deepEqual((await f.call('charlie', 'listMessages')).items, []);
  await rejects(f.call('charlie', 'readMessage', { id: inbox.items[0].id }), 'NOT_FOUND');
  assert.equal((await f.call('alice', 'listMessages')).unreadCount, 1);
  await f.call('alice', 'readMessage', { all: true });
  assert.equal((await f.call('alice', 'listMessages')).unreadCount, 0);
});

test('concurrent event registration never exceeds capacity and retries/cancellation are idempotent', async () => {
  const f = await fixture(); const { event } = await f.call('operator', 'createEvent', f.eventData);
  const results = await Promise.allSettled(['alice', 'bob', 'charlie'].map(who => f.call(who, 'joinEvent', { id: event.id, join: true })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'EVENT_FULL');
  await Promise.all(Array.from({ length: 8 }, () => f.call('alice', 'joinEvent', { id: event.id, join: true })));
  assert.equal((await f.call('alice', 'getEvent', { id: event.id })).event.attendeeCount, 2);
  await Promise.all(Array.from({ length: 8 }, () => f.call('alice', 'joinEvent', { id: event.id, join: false })));
  assert.equal((await f.call('alice', 'getEvent', { id: event.id })).event.attendeeCount, 1);
  await f.call('charlie', 'joinEvent', { id: event.id, join: true });
  assert.equal((await f.call('charlie', 'listEvents', { mine: true })).items.length, 1);
});

test('event edits preserve registrants, reject too-small capacity, and notify once per committed change', async () => {
  const f = await fixture(); const { event } = await f.call('operator', 'createEvent', { ...f.eventData, capacity: 3 });
  for (const who of ['alice', 'bob', 'charlie']) await f.call(who, 'joinEvent', { id: event.id, join: true });
  await rejects(f.call('operator', 'updateEvent', { id: event.id, ...f.eventData }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'updateEvent', { id: event.id, ...f.eventData }), 'FORBIDDEN');
  const change = { id: event.id, ...f.eventData, capacity: 3, location: '公园北门' };
  await f.call('operator', 'updateEvent', change);
  await f.call('operator', 'updateEvent', change);
  assert.equal((await f.call('alice', 'listMessages')).items.filter(message => message.title === '活动信息已更新').length, 1);
  await f.call('operator', 'cancelEvent', { id: event.id, reason: '下雨改期' });
  await f.call('operator', 'cancelEvent', { id: event.id, reason: '下雨改期' });
  const inbox = await f.call('alice', 'listMessages');
  assert.equal(inbox.items.filter(message => message.title === '活动已取消').length, 1);
  await f.call('alice', 'joinEvent', { id: event.id, join: false });
  await rejects(f.call('alice', 'joinEvent', { id: event.id, join: true }), 'EVENT_CLOSED');
});

test('event start time rejects new registration but allows leaving and post-event conversation', async () => {
  const f = await fixture(); const { event } = await f.call('operator', 'createEvent', f.eventData);
  await f.call('alice', 'joinEvent', { id: event.id, join: true });
  f.advance(8_000_000);
  await rejects(f.call('bob', 'joinEvent', { id: event.id, join: true }), 'EVENT_CLOSED');
  await f.call('alice', 'joinEvent', { id: event.id, join: false });
  await f.call('alice', 'addComment', { targetType: 'event', targetId: event.id, text: '今天聊得很开心' });
  assert.equal((await f.call('alice', 'getEvent', { id: event.id })).comments.length, 1);
});

test('uploads require ticket ownership, exact cloud path, moderation and server-copy identity', async () => {
  const f = await fixture(); const ticket = await f.call('alice', 'createUploadTicket', { extension: 'jpg' });
  await rejects(f.call('bob', 'completeUpload', { ticketId: ticket.ticketId, fileId: `cloud://test.bucket/${ticket.cloudPath}` }), 'FORBIDDEN');
  await rejects(f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: `cloud://other.bucket/${ticket.cloudPath}` }), 'FORBIDDEN');
  const initial = `cloud://test.bucket/${ticket.cloudPath}`;
  const result = await f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: initial });
  assert.notEqual(result.fileId, initial);
  assert.ok(f.removed.includes(initial));
  await f.call('bob', 'joinCircle', { id: 'neighbors', join: true });
  await rejects(f.call('bob', 'createPost', { circleId: 'neighbors', text: '', images: [result.fileId] }), 'FORBIDDEN');
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  await f.call('alice', 'createPost', { circleId: 'neighbors', text: '', images: [result.fileId] });
  await rejects(f.call('alice', 'createPost', { circleId: 'neighbors', text: '', images: [result.fileId] }), 'FORBIDDEN');
  const expired = await f.call('alice', 'createUploadTicket', { extension: 'png' }); f.advance(16 * 60_000);
  await rejects(f.call('alice', 'completeUpload', { ticketId: expired.ticketId, fileId: `cloud://test.bucket/${expired.cloudPath}` }), 'UPLOAD_EXPIRED');
});

test('input validation rejects malformed profile, oversized content, foreign replies, and invalid event fields', async () => {
  const f = await fixture(); const post = await postFor(f); const other = await postFor(f, 'bob');
  await rejects(f.call('alice', 'updateProfile', { nickname: 'a', area: '未开放片区', bio: '', pet: null }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'updateProfile', { nickname: 'a', area: '公园片区', bio: '', pet: { name: '猫', type: 'invalid' } }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'createPost', { circleId: 'neighbors', text: 'a'.repeat(1001), images: [] }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'addComment', { targetType: 'post', targetId: post.id, text: ' ' }), 'INVALID_INPUT');
  await rejects(f.call('operator', 'createEvent', { ...f.eventData, capacity: 2.5 }), 'INVALID_INPUT');
  await rejects(f.call('operator', 'createEvent', { ...f.eventData, endAt: f.eventData.startAt }), 'INVALID_INPUT');
  const { comment } = await f.call('bob', 'addComment', { targetType: 'post', targetId: other.id, text: '你好' });
  await rejects(f.call('alice', 'addComment', { targetType: 'post', targetId: post.id, text: '回复', replyToId: comment.id }), 'INVALID_INPUT');
  const updated = await f.call('alice', 'updateProfile', { nickname: '小树', area: '公园片区', bio: '喜欢小动物', pet: { name: '豆包', type: 'cat' } });
  assert.equal(updated.user.pet.type, 'cat');
  assert.equal((await f.call('alice', 'report', { targetType: 'post', targetId: other.id, reason: '广告' })).id.length > 0, true);
});

test('pagination has stable cursors with no duplicated posts, including hidden pages', async () => {
  const f = await fixture();
  for (let index = 0; index < 7; index++) await postFor(f, 'alice', `第${index}篇`);
  const first = await f.call('charlie', 'listPosts', { limit: 3 });
  const second = await f.call('charlie', 'listPosts', { limit: 3, cursor: first.nextCursor });
  const third = await f.call('charlie', 'listPosts', { limit: 3, cursor: second.nextCursor });
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map(post => post.id)).size, 7);
  assert.equal(third.nextCursor, undefined);
  await f.call('charlie', 'blockUser', { userId: idFor('alice'), block: true });
  assert.deepEqual((await f.call('charlie', 'listPosts', { limit: 3 })).items, []);
});

test('account deletion removes content and private data, releases seats, and permits a clean bootstrap', async () => {
  const f = await fixture(); const post = await postFor(f);
  const other = await postFor(f, 'bob');
  const { comment } = await f.call('alice', 'addComment', { targetType: 'post', targetId: other.id, text: '我的评论' });
  await f.call('bob', 'addComment', { targetType: 'post', targetId: other.id, text: '回复你', replyToId: comment.id });
  await f.call('alice', 'blockUser', { userId: idFor('charlie'), block: true });
  const { event } = await f.call('operator', 'createEvent', f.eventData);
  await f.call('alice', 'joinEvent', { id: event.id, join: true });
  await f.call('alice', 'deleteAccount');
  assert.equal((await f.call('bob', 'getEvent', { id: event.id })).event.attendeeCount, 0);
  await rejects(f.call('bob', 'getPost', { id: post.id }), 'NOT_FOUND');
  const remaining = (await f.call('bob', 'getPost', { id: other.id })).comments;
  assert.equal(remaining.length, 1); assert.equal(remaining[0].replyToName, undefined);
  assert.equal((await f.call('bob', 'getCircle', { id: 'neighbors' })).circle.memberCount, 1);
  const fresh = await f.call('alice', 'bootstrap');
  assert.equal(fresh.user.bio, ''); assert.equal(fresh.user.pet, null); assert.equal(fresh.stats.postCount, 0);
  assert.deepEqual((await f.call('alice', 'listMessages')).items, []);
  assert.deepEqual((await f.call('alice', 'listBlocked')).items, []);
});

test('organizer account deletion cancels activities and retains cancellation notices', async () => {
  const f = await fixture(); const { event } = await f.call('operator', 'createEvent', f.eventData);
  await f.call('alice', 'joinEvent', { id: event.id, join: true });
  await f.call('operator', 'deleteAccount');
  const detail = await f.call('alice', 'getEvent', { id: event.id });
  assert.equal(detail.event.status, 'cancelled'); assert.equal(detail.event.hostName, '已注销用户');
  assert.equal((await f.call('alice', 'listMessages')).items.some(message => message.title === '活动已取消'), true);
  await f.call('operator', 'bootstrap');
  await f.call('operator', 'updateProfile', { nickname: '重新注册的组织者', area: '', bio: '', pet: null });
  assert.equal((await f.call('alice', 'getEvent', { id: event.id })).event.hostName, '已注销用户');
});

test('file sniffing rejects extension spoofing; production uploads default to disabled', () => {
  assert.throws(() => contentType(Buffer.from('this is not an image at all'), 'jpg'), error => error.code === 'INVALID_IMAGE');
  assert.throws(() => contentType(Buffer.alloc(6 * 1024 * 1024), 'png'), error => error.code === 'INVALID_IMAGE');
  assert.equal(contentType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]), 'jpg'), 'image/jpeg');
  assert.equal(createStorage({}, {}).enabled, false);
  assert.equal(createStorage({}, { UPLOADS_ENABLED: 'true', CLOUD_FILE_PREFIX: 'https://invalid/' }).enabled, false);
});

test('blocking an event organizer releases the seat without exposing their hidden event', async () => {
  const f = await fixture(); const { event } = await f.call('operator', 'createEvent', f.eventData);
  await f.call('alice', 'joinEvent', { id: event.id, join: true });
  await f.call('alice', 'blockUser', { userId: idFor('operator'), block: true });
  assert.equal((await f.call('bob', 'getEvent', { id: event.id })).event.attendeeCount, 0);
  await rejects(f.call('alice', 'getEvent', { id: event.id }), 'NOT_FOUND');
  await rejects(f.call('alice', 'joinEvent', { id: event.id, join: true }), 'NOT_FOUND');
  assert.equal((await f.call('alice', 'listEvents', { mine: true })).items.length, 0);
});

test('interrupted account cleanup refuses new activity and can be resumed safely', async () => {
  let first = true;
  const f = await fixture({ storage: { enabled: true, fileIdForPath: path => `cloud://test/${path}`,
    async remove() { if (first) { first = false; throw new Error('temporary storage error'); } } } });
  const post = await postFor(f);
  await f.repository.set('uploads', 'pending_file', { ownerId: idFor('alice'), cloudPath: 'incoming/file.jpg', status: 'pending' });
  await assert.rejects(f.call('alice', 'deleteAccount'), /temporary storage error/);
  await rejects(f.call('alice', 'bootstrap'), 'ACCOUNT_UNAVAILABLE');
  await rejects(f.call('alice', 'createPost', { circleId: 'neighbors', text: '新内容', images: [] }), 'ACCOUNT_UNAVAILABLE');
  await rejects(f.call('bob', 'getPost', { id: post.id }), 'NOT_FOUND');
  await f.call('alice', 'deleteAccount');
  assert.equal((await f.call('alice', 'bootstrap')).stats.joinedCircleCount, 0);
  assert.equal(await f.repository.get('uploads', 'pending_file'), null);
});

test('concurrent account deletion and new writes leave no orphan membership or public content', async () => {
  const f = await fixture(); await postFor(f); const { event } = await f.call('operator', 'createEvent', f.eventData);
  await Promise.allSettled([
    f.call('alice', 'deleteAccount'),
    f.call('alice', 'createPost', { circleId: 'neighbors', text: '并发请求', images: [] }),
    f.call('alice', 'joinEvent', { id: event.id, join: true }),
    f.call('alice', 'joinCircle', { id: 'cat_friends', join: true })
  ]);
  const state = await f.call('alice', 'bootstrap');
  assert.equal(state.stats.postCount, 0); assert.equal(state.stats.joinedCircleCount, 0); assert.equal(state.stats.joinedEventCount, 0);
  assert.equal((await f.call('bob', 'getEvent', { id: event.id })).event.attendeeCount, 0);
});

test('failed notification delivery is durable and retries do not duplicate successful recipients', async () => {
  const f = await fixture(); const { event } = await f.call('operator', 'createEvent', f.eventData);
  await f.call('alice', 'joinEvent', { id: event.id, join: true }); await f.call('bob', 'joinEvent', { id: event.id, join: true });
  const transaction = f.repository.transaction.bind(f.repository); let shouldFail = true;
  f.repository.transaction = fn => transaction(tx => fn({ ...tx,
    async set(name, id, value) {
      if (name === 'messages' && value.title === '活动信息已更新' && value.toId === idFor('bob') && shouldFail) {
        shouldFail = false; throw new Error('transient notification failure');
      }
      return tx.set(name, id, value);
    }
  }));
  const updated = await f.call('operator', 'updateEvent', { ...f.eventData, id: event.id, location: '新地点' });
  assert.equal(updated.event.location, '新地点');
  assert.equal((await f.repository.find('outbox')).length, 1);
  await f.call('operator', 'bootstrap');
  for (const who of ['alice', 'bob']) assert.equal((await f.call(who, 'listMessages')).items.filter(message => message.title === '活动信息已更新').length, 1);
  assert.equal((await f.repository.find('outbox')).length, 0);
});

test('text security failures stop publication, and failed image security never writes a public copy', async () => {
  const f = await fixture({ moderateText: async () => { throw new Error('security unavailable'); } });
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  await assert.rejects(f.call('alice', 'createPost', { circleId: 'neighbors', text: '待检查', images: [] }), /security unavailable/);
  assert.deepEqual((await f.call('alice', 'listPosts')).items, []);
  let uploads = 0;
  const storage = createStorage({
    async downloadFile() { return { fileContent: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]) }; },
    openapi: { security: { async imgSecCheck() { throw { errCode: 87014 }; } } },
    async uploadFile() { uploads++; }
  }, { UPLOADS_ENABLED: 'true', MEDIA_REVIEW_MODE: 'sync', CLOUD_FILE_PREFIX: 'cloud://test.bucket/' });
  await rejects(storage.verifyAndPublish({ fileId: 'cloud://test.bucket/incoming/x.jpg', cloudPath: 'published/y.jpg', extension: 'jpg' }), 'CONTENT_REJECTED');
  assert.equal(uploads, 0);
});

test('report management is admin-only and exposes only the reporter public projection', async () => {
  const f = await fixture(); const post = await postFor(f, 'bob');
  await f.call('alice', 'updateProfile', { nickname: '举报用户', area: '公园片区', bio: '只对本人显示的介绍', pet: { name: '私有宠物名字', type: 'cat' } });
  const report = await f.call('alice', 'report', { targetType: 'post', targetId: post.id, reason: '疑似广告', description: '请帮助核查' });
  await rejects(f.call('alice', 'listReports'), 'FORBIDDEN');
  await rejects(f.call('bob', 'listReports', { status: 'all' }), 'FORBIDDEN');
  await rejects(f.call('alice', 'resolveReport', { id: report.id, status: 'resolved' }), 'FORBIDDEN');
  const queue = await f.call('operator', 'listReports');
  assert.equal(queue.items.length, 1);
  const item = queue.items[0];
  assert.equal(item.status, 'open'); assert.equal(item.targetSummary, post.text);
  assert.equal(item.targetTypeForLink, 'post'); assert.equal(item.targetIdForLink, post.id);
  assert.deepEqual(Object.keys(item.reporter).sort(), ['avatar', 'id', 'nickname']);
  assert.equal(JSON.stringify(item).includes('只对本人显示的介绍'), false);
  assert.equal(JSON.stringify(item).includes('私有宠物名字'), false);
  assert.equal(JSON.stringify(item).includes('openid'), false);
  await rejects(f.call('operator', 'listReports', { status: 'pending' }), 'INVALID_INPUT');
});

test('comment reports retain their parent link after deletion and report lists paginate', async () => {
  const f = await fixture(); const post = await postFor(f, 'bob');
  const { comment } = await f.call('bob', 'addComment', { targetType: 'post', targetId: post.id, text: '待核查评论' });
  const commentReport = await f.call('alice', 'report', { targetType: 'comment', targetId: comment.id, reason: '广告' });
  const { event } = await f.call('operator', 'createEvent', f.eventData);
  const { comment: eventComment } = await f.call('bob', 'addComment', { targetType: 'event', targetId: event.id, text: '活动留言' });
  await f.call('alice', 'report', { targetType: 'comment', targetId: eventComment.id, reason: '请核查' });
  await f.call('alice', 'report', { targetType: 'user', targetId: idFor('bob'), reason: '资料问题' });
  await f.repository.remove('comments', comment.id);
  const first = await f.call('operator', 'listReports', { limit: 2 });
  const second = await f.call('operator', 'listReports', { limit: 2, cursor: first.nextCursor });
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 3);
  assert.equal(first.items.find(item => item.targetId === eventComment.id).targetTypeForLink, 'event');
  const removed = second.items.find(item => item.id === commentReport.id);
  assert.equal(removed.targetSummary, '内容已删除'); assert.equal(removed.targetIdForLink, post.id);
});

test('report resolution is transactional/idempotent and sends exactly one private system notice', async () => {
  const f = await fixture(); const post = await postFor(f, 'bob');
  const { id } = await f.call('alice', 'report', { targetType: 'post', targetId: post.id, reason: '广告' });
  await rejects(f.call('operator', 'resolveReport', { id, status: 'open' }), 'INVALID_INPUT');
  await rejects(f.call('operator', 'resolveReport', { id, status: 'resolved', note: 'a'.repeat(301) }), 'INVALID_INPUT');
  await Promise.all(Array.from({ length: 8 }, () => f.call('operator', 'resolveReport', { id, status: 'resolved', note: '已提醒作者调整内容' })));
  await f.call('operator', 'resolveReport', { id, status: 'dismissed', note: '重复请求不会改变结果' });
  assert.equal((await f.call('operator', 'listReports')).items.length, 0);
  const all = await f.call('operator', 'listReports', { status: 'all' });
  assert.equal(all.items[0].status, 'resolved');
  const notices = (await f.call('alice', 'listMessages')).items;
  assert.equal(notices.length, 1); assert.equal(notices[0].targetType, 'system'); assert.equal(notices[0].targetId, id);
  assert.ok(notices[0].text.includes('已提醒作者调整内容'));
  assert.equal((await f.call('bob', 'listMessages')).items.length, 0);
  assert.equal((await f.call('charlie', 'listMessages')).items.length, 0);
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.id, post.id);
});

test('legacy pending reports remain actionable and dismissed reports notify their own reporter', async () => {
  const f = await fixture(); const post = await postFor(f, 'alice');
  const { id } = await f.call('bob', 'report', { targetType: 'post', targetId: post.id, reason: '请核查' });
  const record = await f.repository.get('reports', id);
  await f.repository.set('reports', id, { ...record, status: 'pending' });
  assert.equal((await f.call('operator', 'listReports')).items[0].status, 'open');
  await f.call('operator', 'resolveReport', { id, status: 'dismissed' });
  assert.equal((await f.call('operator', 'listReports', { status: 'all' })).items[0].status, 'dismissed');
  assert.equal((await f.call('bob', 'listMessages')).items[0].title, '举报处理结果');
});

test('richer posts validate fields, moderate title/topics and safely project their event/cover', async () => {
  const checked = []; const f = await fixture({ moderateText: async text => { checked.push(text); } });
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  const base = { circleId: 'neighbors', text: '正文', images: [] };
  const { post: oldCompatible } = await f.call('alice', 'createPost', base);
  assert.equal(oldCompatible.title, ''); assert.equal(oldCompatible.kind, 'daily');
  assert.deepEqual(oldCompatible.topics, []); assert.equal(oldCompatible.cover, ''); assert.equal(oldCompatible.event, null);
  for (const change of [{ title: '长'.repeat(41) }, { kind: 'ad' }, { topics: ['自定义广告'] }, { topics: Array(4).fill('新手养宠') }, { coverIndex: 1 }]) {
    await rejects(f.call('alice', 'createPost', { ...base, ...change }), 'INVALID_INPUT');
  }
  await rejects(f.call('alice', 'createPost', { ...base, eventId: 'missing_event' }), 'NOT_FOUND');
  const { event } = await f.call('operator', 'createEvent', f.eventData);
  const files = [];
  for (let index = 0; index < 2; index++) {
    const ticket = await f.call('alice', 'createUploadTicket', { extension: 'jpg' });
    files.push((await f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: `cloud://test.bucket/${ticket.cloudPath}` })).fileId);
  }
  const { post } = await f.call('alice', 'createPost', { ...base, title: '带宠出门前准备什么', kind: 'question', topics: ['新手养宠', '一起散步'],
    eventId: event.id, images: files, coverIndex: 1 });
  assert.equal(post.cover, files[1]); assert.equal(post.coverIndex, 1); assert.equal(post.kind, 'question');
  assert.equal(post.event.id, event.id); assert.equal(post.event.location, event.location);
  assert.deepEqual(post.topics, ['健康护理', '户外出行']);
  assert.ok(checked.some(text => text.includes('带宠出门前准备什么') && text.includes('健康护理') && text.includes('正文')));
  await f.call('bob', 'blockUser', { userId: idFor('operator'), block: true });
  const hidden = (await f.call('bob', 'getPost', { id: post.id })).post;
  assert.equal(hidden.event, null); assert.equal(hidden.eventId, '');
  await f.call('bob', 'joinCircle', { id: 'neighbors', join: true });
  await rejects(f.call('bob', 'createPost', { ...base, eventId: event.id }), 'NOT_FOUND');
});

test('likes and private bookmarks are idempotent under concurrency and never trust client identity', async () => {
  const f = await fixture(); const post = await postFor(f, 'bob');
  await Promise.all(['alice', 'charlie'].flatMap(who => Array.from({ length: 10 }, () => f.call(who, 'likePost', { id: post.id, like: true }))));
  let detail = (await f.call('alice', 'getPost', { id: post.id })).post;
  assert.equal(detail.likeCount, 2); assert.equal(detail.isLiked, true);
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.isLiked, false);
  await Promise.all(Array.from({ length: 10 }, () => f.call('alice', 'likePost', { id: post.id, like: false })));
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.likeCount, 1);
  await Promise.all(Array.from({ length: 10 }, () => f.call('alice', 'bookmarkPost', { id: post.id, bookmark: true })));
  assert.equal((await f.call('alice', 'bootstrap')).stats.bookmarkCount, 1);
  assert.equal((await f.call('alice', 'listPosts', { bookmarked: true })).items.length, 1);
  assert.deepEqual((await f.call('charlie', 'listPosts', { bookmarked: true })).items, []);
  assert.equal((await f.call('charlie', 'getPost', { id: post.id })).post.isBookmarked, false);
  await rejects(f.call('charlie', 'bookmarkPost', { id: post.id, bookmark: true, userId: idFor('alice') }), 'INVALID_INPUT');
  await rejects(f.call('charlie', 'likePost', { id: post.id, like: 'true' }), 'INVALID_INPUT');
  const notices = (await f.call('bob', 'listMessages')).items;
  assert.equal(notices.filter(message => message.kind === 'like').length, 2);
  assert.equal(notices.filter(message => message.kind === 'bookmark').length, 1);
});

test('following counters and list privacy stay correct across concurrent repeated changes', async () => {
  const f = await fixture();
  await Promise.all(['alice', 'charlie'].flatMap(who => Array.from({ length: 10 }, () => f.call(who, 'followUser', { userId: idFor('bob'), follow: true }))));
  assert.equal((await f.call('alice', 'getUserProfile', { userId: idFor('bob') })).user.followerCount, 2);
  assert.equal((await f.call('alice', 'getUserProfile', { userId: idFor('alice') })).user.followingCount, 1);
  assert.equal((await f.call('alice', 'bootstrap')).stats.followingCount, 1);
  const following = (await f.call('alice', 'listFollowing')).items;
  assert.equal(following.length, 1); assert.deepEqual(Object.keys(following[0]).sort(), ['avatar', 'id', 'nickname']);
  await Promise.all(Array.from({ length: 10 }, () => f.call('alice', 'followUser', { userId: idFor('bob'), follow: false })));
  assert.equal((await f.call('alice', 'getUserProfile', { userId: idFor('bob') })).user.followerCount, 1);
  assert.equal((await f.call('alice', 'getUserProfile', { userId: idFor('alice') })).user.followingCount, 0);
  await rejects(f.call('alice', 'followUser', { userId: idFor('alice'), follow: true }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'followUser', { userId: idFor('bob'), follow: true, isAdmin: true }), 'INVALID_INPUT');
  const notices = (await f.call('bob', 'listMessages')).items;
  assert.equal(notices.length, 2);
  assert.ok(notices.every(message => message.kind === 'follow' && message.targetType === 'user'));
});

test('public-profile opt-in hides old personal data by default and never exposes area', async () => {
  const f = await fixture(); const post = await postFor(f, 'bob');
  const profile = { nickname: '小林', area: '公园片区', bio: '我的介绍', pet: { name: '豆豆', type: 'dog' } };
  await f.call('bob', 'updateProfile', profile);
  const raw = await f.repository.get('users', idFor('bob')); delete raw.publicProfile;
  await f.repository.set('users', idFor('bob'), raw);
  let page = await f.call('alice', 'getUserProfile', { userId: idFor('bob') });
  assert.equal(page.user.publicProfile, false); assert.equal(page.user.bio, ''); assert.equal(page.user.pet, null);
  assert.equal('area' in page.user, false); assert.equal(page.posts[0].id, post.id);
  assert.equal((await f.call('bob', 'getUserProfile', { userId: idFor('bob') })).user.bio, profile.bio);
  assert.equal((await f.call('bob', 'bootstrap')).user.publicProfile, false);
  await f.call('bob', 'updateProfile', { ...profile, publicProfile: true });
  await f.call('bob', 'updateProfile', { ...profile, nickname: '新昵称' });
  page = await f.call('alice', 'getUserProfile', { userId: idFor('bob') });
  assert.equal(page.user.publicProfile, true); assert.equal(page.user.bio, profile.bio); assert.deepEqual(page.user.pet, profile.pet);
  assert.equal('area' in page.user, false); assert.equal('isAdmin' in page.user, false);
  await f.call('bob', 'updateProfile', { ...profile, publicProfile: false });
  assert.equal((await f.call('alice', 'getUserProfile', { userId: idFor('bob') })).user.pet, null);
  await rejects(f.call('bob', 'updateProfile', { ...profile, publicProfile: 'true' }), 'INVALID_INPUT');
});

test('feed, query, topic, circle, author and bookmark filters compose as intersections', async () => {
  const f = await fixture();
  for (const who of ['alice', 'bob', 'charlie']) for (const circleId of ['neighbors', 'cat_friends']) await f.call(who, 'joinCircle', { id: circleId, join: true });
  const create = (who, circleId, title, text, topics) => f.call(who, 'createPost', { circleId, title, text, topics, images: [] });
  const { post: dog } = await create('bob', 'neighbors', '一起DOG Walk', '今天在公园', ['一起散步']);
  const { post: cat } = await create('bob', 'cat_friends', '养宠经验', '字面符号 .* 放在这里', ['新手养宠']);
  await create('charlie', 'neighbors', '一起DOG Walk', '另一位作者', ['一起散步']);
  await f.call('alice', 'joinCircle', { id: 'cat_friends', join: false });
  assert.deepEqual((await f.call('alice', 'listPosts', { feed: 'following' })).items, []);
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: true });
  await f.call('alice', 'bookmarkPost', { id: dog.id, bookmark: true });
  const combined = await f.call('alice', 'listPosts', { feed: 'following', topic: '一起散步', query: 'dog walk', circleId: 'neighbors', authorId: idFor('bob'), bookmarked: true });
  assert.deepEqual(combined.items.map(post => post.id), [dog.id]);
  assert.equal((await f.call('alice', 'listPosts', { feed: 'circles' })).items.some(post => post.id === cat.id), false);
  assert.deepEqual((await f.call('alice', 'listPosts', { query: '.*' })).items.map(post => post.id), [cat.id]);
  assert.deepEqual((await f.call('alice', 'listPosts', { query: '新手养宠' })).items.map(post => post.id), [cat.id]);
  assert.deepEqual((await f.call('alice', 'listPosts', { mine: true, authorId: idFor('bob') })).items, []);
  assert.deepEqual((await f.call('alice', 'listPosts', { bookmarked: true, topic: '新手养宠' })).items, []);
  await rejects(f.call('alice', 'listPosts', { query: '长'.repeat(61) }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'listPosts', { feed: 'unknown' }), 'INVALID_INPUT');
});

test('bounded sparse search yields advancing cursors without missing or duplicating matches', async () => {
  const f = await fixture();
  for (let index = 0; index < 85; index++) {
    const id = `1800000000000_${String(index).padStart(24, '0')}`;
    await f.repository.set('posts', id, { authorId: idFor('bob'), circleId: 'neighbors', text: index < 3 ? '稀疏匹配' : '无关内容',
      title: '', topics: [], images: [], deleted: false, createdAt: 1_800_000_000_000 + index });
  }
  const first = await f.call('alice', 'listPosts', { query: '稀疏匹配', limit: 2 });
  assert.equal(first.items.length, 0); assert.ok(first.nextCursor);
  const seen = []; const cursors = new Set(); let next = first.nextCursor;
  for (let pages = 0; next && pages < 10; pages++) {
    assert.equal(cursors.has(next), false); cursors.add(next);
    const page = await f.call('alice', 'listPosts', { query: '稀疏匹配', limit: 2, cursor: next });
    seen.push(...page.items.map(post => post.id)); next = page.nextCursor;
  }
  assert.equal(next, undefined); assert.equal(seen.length, 3); assert.equal(new Set(seen).size, 3);
});

test('blocking clears both follows and reactions, rejects every social detail bypass, and unblock does not restore', async () => {
  const f = await fixture(); const alicePost = await postFor(f); const bobPost = await postFor(f, 'bob');
  for (const [who, target, post] of [['alice', 'bob', bobPost], ['bob', 'alice', alicePost]]) {
    await f.call(who, 'followUser', { userId: idFor(target), follow: true });
    await f.call(who, 'likePost', { id: post.id, like: true });
    await f.call(who, 'bookmarkPost', { id: post.id, bookmark: true });
  }
  await f.call('alice', 'blockUser', { userId: idFor('bob'), block: true });
  for (const [who, target, post] of [['alice', 'bob', bobPost], ['bob', 'alice', alicePost]]) {
    await rejects(f.call(who, 'getUserProfile', { userId: idFor(target) }), 'NOT_FOUND');
    await rejects(f.call(who, 'followUser', { userId: idFor(target), follow: true }), 'NOT_FOUND');
    await rejects(f.call(who, 'likePost', { id: post.id, like: true }), 'NOT_FOUND');
    await rejects(f.call(who, 'bookmarkPost', { id: post.id, bookmark: true }), 'NOT_FOUND');
    assert.equal((await f.call(who, 'bootstrap')).stats.followingCount, 0);
    assert.equal((await f.call(who, 'bootstrap')).stats.bookmarkCount, 0);
    assert.deepEqual((await f.call(who, 'listFollowing')).items, []);
  }
  await f.call('alice', 'blockUser', { userId: idFor('bob'), block: false });
  assert.equal((await f.call('alice', 'getPost', { id: bobPost.id })).post.likeCount, 0);
  assert.equal((await f.call('bob', 'getPost', { id: alicePost.id })).post.isBookmarked, false);
  assert.equal((await f.call('alice', 'getUserProfile', { userId: idFor('bob') })).user.followerCount, 0);
});

test('post and account deletion clear new fields, reactions and incoming/outgoing follow counts', async () => {
  const f = await fixture(); const alicePost = await postFor(f); const bobPost = await postFor(f, 'bob');
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: true });
  await f.call('bob', 'followUser', { userId: idFor('alice'), follow: true });
  await f.call('alice', 'likePost', { id: bobPost.id, like: true }); await f.call('alice', 'bookmarkPost', { id: bobPost.id, bookmark: true });
  await f.call('bob', 'likePost', { id: alicePost.id, like: true }); await f.call('bob', 'bookmarkPost', { id: alicePost.id, bookmark: true });
  await f.call('alice', 'deletePost', { id: alicePost.id });
  assert.equal((await f.call('bob', 'bootstrap')).stats.bookmarkCount, 0);
  await rejects(f.call('bob', 'likePost', { id: alicePost.id, like: true }), 'NOT_FOUND');
  await f.call('alice', 'deleteAccount');
  assert.equal((await f.call('bob', 'getPost', { id: bobPost.id })).post.likeCount, 0);
  const bob = (await f.call('bob', 'getUserProfile', { userId: idFor('bob') })).user;
  assert.equal(bob.followerCount, 0); assert.equal(bob.followingCount, 0);
  assert.deepEqual((await f.call('bob', 'listFollowing')).items, []);
  const fresh = await f.call('alice', 'bootstrap');
  assert.equal(fresh.user.publicProfile, false); assert.equal(fresh.stats.bookmarkCount, 0); assert.equal(fresh.stats.followingCount, 0);
  for (const collection of ['likes', 'bookmarks', 'follows']) assert.deepEqual(await f.repository.find(collection), []);
});

test('deletion racing with new follows/likes/bookmarks leaves no retained social relationship', async () => {
  const f = await fixture(); const post = await postFor(f, 'bob');
  await Promise.allSettled([
    f.call('bob', 'deleteAccount'), f.call('alice', 'followUser', { userId: idFor('bob'), follow: true }),
    f.call('alice', 'likePost', { id: post.id, like: true }), f.call('alice', 'bookmarkPost', { id: post.id, bookmark: true })
  ]);
  assert.equal((await f.call('alice', 'bootstrap')).stats.followingCount, 0);
  assert.equal((await f.call('alice', 'bootstrap')).stats.bookmarkCount, 0);
  for (const collection of ['likes', 'bookmarks', 'follows']) assert.deepEqual(await f.repository.find(collection), []);
});

test('interrupted post reaction cleanup can be retried without resurrecting content or counters', async () => {
  const f = await fixture(); const post = await postFor(f, 'bob');
  await f.call('alice', 'likePost', { id: post.id, like: true });
  await f.call('alice', 'bookmarkPost', { id: post.id, bookmark: true });
  const remove = f.repository.remove.bind(f.repository); let failOnce = true;
  f.repository.remove = async (collection, id) => {
    if (collection === 'likes' && failOnce) { failOnce = false; throw new Error('temporary cleanup failure'); }
    return remove(collection, id);
  };
  await assert.rejects(f.call('bob', 'deletePost', { id: post.id }), /temporary cleanup failure/);
  await rejects(f.call('alice', 'getPost', { id: post.id }), 'NOT_FOUND');
  await f.call('bob', 'deletePost', { id: post.id });
  assert.equal((await f.call('alice', 'bootstrap')).stats.bookmarkCount, 0);
  assert.deepEqual(await f.repository.find('likes'), []); assert.deepEqual(await f.repository.find('bookmarks'), []);
});

test('unverified accounts and administrators cannot create or add interactions, while reads/profile/report stay available', async () => {
  const f = await fixture({ verifyUsers: false });
  const bootstrap = await f.call('alice', 'bootstrap');
  assert.deepEqual(bootstrap.user.verification, { status: 'unverified' });
  assert.deepEqual(bootstrap.registration, { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, phoneEnabled: true, policyConfigured: true });
  const actions = [
    ['createPost', { circleId: 'neighbors', text: '分享', images: [] }], ['addComment', { targetType: 'post', targetId: 'some_post', text: '留言' }],
    ['joinCircle', { id: 'neighbors', join: true }], ['joinEvent', { id: 'some_event', join: true }],
    ['followUser', { userId: idFor('bob'), follow: true }], ['likePost', { id: 'some_post', like: true }],
    ['bookmarkPost', { id: 'some_post', bookmark: true }], ['createUploadTicket', { extension: 'jpg' }],
    ['completeUpload', { ticketId: 'some_ticket', fileId: 'cloud://test/file.jpg' }]
  ];
  for (const [action, payload] of actions) await rejects(f.call('alice', action, payload), 'VERIFICATION_REQUIRED');
  await rejects(f.call('operator', 'createEvent', f.eventData), 'VERIFICATION_REQUIRED');
  await rejects(f.call('operator', 'updateEvent', { ...f.eventData, id: 'some_event' }), 'VERIFICATION_REQUIRED');
  await f.call('alice', 'updateProfile', { nickname: '未核验访客', area: '', bio: '先了解社区', pet: null, verification: { status: 'phone_verified' } });
  assert.equal((await f.call('alice', 'bootstrap')).user.verification.status, 'unverified');
  const raw = await f.repository.get('users', idFor('alice'));
  await f.repository.set('users', idFor('alice'), { ...raw, verification: { status: 'phone_verified' }, phoneVerified: true });
  await rejects(f.call('alice', 'joinCircle', { id: 'neighbors', join: true }), 'VERIFICATION_REQUIRED');
  await f.call('alice', 'report', { targetType: 'user', targetId: idFor('bob'), reason: '请核查资料' });
  await f.call('alice', 'blockUser', { userId: idFor('bob'), block: true });
  assert.deepEqual((await f.call('alice', 'listPosts')).items, []);
});

test('phone verification requires current explicit consent and cannot accept a typed number or proof flag', async () => {
  let calls = 0;
  const f = await fixture({ verifyUsers: false, phoneVerifier: { enabled: true, async verifyCode() { calls++; return { phoneKey: phoneKeyFor('one'), maskedPhone: '+86 138****0001' }; } } });
  for (const bad of [undefined, { ...consent, accepted: false }, { ...consent, termsVersion: 'old' }, { ...consent, privacyVersion: 'old' }]) {
    await rejects(f.call('alice', 'verifyPhone', { code: 'wechat-code', consent: bad }), 'CONSENT_REQUIRED');
  }
  await rejects(f.call('alice', 'verifyPhone', { code: 'wechat-code', consent, phoneNumber: '13812345678' }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'verifyPhone', { code: 'wechat-code', consent, phoneVerified: true }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'verifyPhone', { code: 'wechat-code', consent: { ...consent, phone: '13812345678' } }), 'INVALID_INPUT');
  assert.equal(calls, 0);
  const verified = await f.call('alice', 'verifyPhone', { code: 'wechat-code', consent });
  assert.equal(verified.user.verification.status, 'phone_verified'); assert.equal(calls, 1);
  await f.call('alice', 'verifyPhone', { code: 'same-or-new-one-time-code', consent });
  assert.equal(calls, 1);
  assert.equal((await f.repository.get('identities', idFor('alice'))).method, 'wechat_phone');
});

test('real phone adapter fails closed, persists only HMAC/masked data, and never exposes phone identity publicly', async () => {
  const api = { openapi: { phonenumber: { async getPhoneNumber({ code }) {
    assert.equal(code, 'real-one-time-code');
    return { errCode: 0, phoneInfo: { countryCode: '86', purePhoneNumber: '13812345678', phoneNumber: '8613812345678' } };
  } } } };
  assert.equal(createPhoneVerifier(api, {}).enabled, false);
  assert.equal(createPhoneVerifier(api, { PHONE_VERIFICATION_ENABLED: 'true', PHONE_HASH_SECRET: 'short' }).enabled, false);
  assert.equal(createPhoneVerifier({}, { PHONE_VERIFICATION_ENABLED: 'true', PHONE_HASH_SECRET: 's'.repeat(32) }).enabled, false);
  const unavailable = await fixture({ verifyUsers: false, phoneVerifier: null });
  assert.equal((await unavailable.call('alice', 'bootstrap')).registration.phoneEnabled, false);
  await rejects(unavailable.call('alice', 'verifyPhone', { code: 'real-one-time-code', consent }), 'PHONE_UNAVAILABLE');
  const verifier = createPhoneVerifier(api, { PHONE_VERIFICATION_ENABLED: 'true', PHONE_HASH_SECRET: 's'.repeat(32) });
  const f = await fixture({ verifyUsers: false, phoneVerifier: verifier });
  const result = await f.call('alice', 'verifyPhone', { code: 'real-one-time-code', consent });
  assert.equal(result.user.verification.maskedPhone, '+86 138****5678');
  const identity = await f.repository.get('identities', idFor('alice'));
  assert.match(identity.phoneKey, /^ph_[a-f0-9]{64}$/); assert.equal(identity.termsVersion, TERMS_VERSION);
  const persisted = JSON.stringify([await f.repository.find('users'), await f.repository.find('identities'), await f.repository.find('phone_claims')]);
  assert.equal(persisted.includes('13812345678'), false); assert.equal(persisted.includes('real-one-time-code'), false);
  const post = await postFor(f);
  const publicResults = JSON.stringify([(await f.call('bob', 'getPost', { id: post.id })).post.author,
    (await f.call('bob', 'getUserProfile', { userId: idFor('alice') })).user, await f.call('operator', 'getPetStats')]);
  for (const privateValue of ['verification', 'maskedPhone', 'phoneKey', 'phone_verified', '+86', identity.phoneKey]) assert.equal(publicResults.includes(privateValue), false);
});

test('concurrent duplicate phone claims admit only one account and same-account retries remain idempotent', async () => {
  const verifier = { enabled: true, async verifyCode() { return { phoneKey: phoneKeyFor('shared-phone'), maskedPhone: '+86 138****2222' }; } };
  const f = await fixture({ verifyUsers: false, phoneVerifier: verifier });
  const results = await Promise.allSettled(['alice', 'bob'].map(who => f.call(who, 'verifyPhone', { code: `valid-${who}`, consent })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PHONE_ALREADY_IN_USE');
  assert.equal((await f.repository.find('phone_claims')).length, 1); assert.equal((await f.repository.find('identities')).length, 1);
  const claims = await f.repository.find('phone_claims'); const winner = claims[0].userId === idFor('alice') ? 'alice' : 'bob';
  await Promise.all(Array.from({ length: 8 }, () => f.call(winner, 'verifyPhone', { code: 'already-redeemed-code', consent })));
  assert.equal((await f.repository.find('phone_claims')).length, 1);
  const g = await fixture({ verifyUsers: false, phoneVerifier: { enabled: true, async verifyCode(code) { return { phoneKey: phoneKeyFor(code), maskedPhone: '+86 138****3333' }; } } });
  await Promise.all(['phone-one', 'phone-two'].map(code => g.call('alice', 'verifyPhone', { code, consent })));
  assert.equal((await g.repository.find('phone_claims')).length, 1); assert.equal((await g.repository.find('identities')).length, 1);
});

test('failed phone provider decisions do not write verification, and lost claims cannot authorize interactions', async () => {
  const failing = createPhoneVerifier({ openapi: { phonenumber: { async getPhoneNumber() { throw new Error('private upstream detail'); } } } },
    { PHONE_VERIFICATION_ENABLED: 'true', PHONE_HASH_SECRET: 's'.repeat(32) });
  const f = await fixture({ verifyUsers: false, phoneVerifier: failing });
  await rejects(f.call('alice', 'verifyPhone', { code: 'some-code', consent }), 'PHONE_VERIFICATION_FAILED');
  assert.deepEqual(await f.repository.find('identities'), []); assert.deepEqual(await f.repository.find('phone_claims'), []);
  const g = await fixture(); const identity = await g.repository.get('identities', idFor('alice'));
  await g.repository.remove('phone_claims', identity.phoneKey);
  assert.equal((await g.call('alice', 'bootstrap')).user.verification.status, 'unverified');
  await rejects(g.call('alice', 'joinCircle', { id: 'neighbors', join: true }), 'VERIFICATION_REQUIRED');
});

test('verification is cleared on deletion, releases the phone, and cannot revive a deleting account', async () => {
  const verifier = { enabled: true, async verifyCode() { return { phoneKey: phoneKeyFor('reusable'), maskedPhone: '+86 138****4444' }; } };
  const f = await fixture({ verifyUsers: false, phoneVerifier: verifier });
  await f.call('alice', 'verifyPhone', { code: 'first-owner', consent }); await f.call('alice', 'deleteAccount');
  assert.equal(await f.repository.get('identities', idFor('alice')), null); assert.deepEqual(await f.repository.find('phone_claims'), []);
  await f.call('bob', 'verifyPhone', { code: 'second-owner', consent });
  assert.equal((await f.call('alice', 'bootstrap')).user.verification.status, 'unverified');
  await rejects(f.call('alice', 'verifyPhone', { code: 'attempt-to-return', consent }), 'PHONE_ALREADY_IN_USE');
  let unlock; let began;
  const started = new Promise(resolve => { began = resolve; }); const paused = new Promise(resolve => { unlock = resolve; });
  const g = await fixture({ verifyUsers: false, phoneVerifier: { enabled: true, async verifyCode() { began(); await paused; return { phoneKey: phoneKeyFor('late-result'), maskedPhone: '+86 138****5555' }; } } });
  const request = g.call('alice', 'verifyPhone', { code: 'in-flight', consent });
  await started; await g.call('alice', 'deleteAccount'); unlock();
  await rejects(request, 'ACCOUNT_UNAVAILABLE');
  assert.deepEqual(await g.repository.find('identities'), []); assert.deepEqual(await g.repository.find('phone_claims'), []);
});

test('interrupted identity cleanup rolls back its phone release and safely resumes', async () => {
  const f = await fixture(); const transaction = f.repository.transaction.bind(f.repository); let failOnce = true;
  f.repository.transaction = fn => transaction(tx => fn({ ...tx, async remove(collection, id) {
    if (collection === 'identities' && failOnce) { failOnce = false; throw new Error('identity cleanup temporarily failed'); }
    return tx.remove(collection, id);
  } }));
  const identity = await f.repository.get('identities', idFor('alice'));
  await assert.rejects(f.call('alice', 'deleteAccount'), /identity cleanup temporarily failed/);
  assert.ok(await f.repository.get('phone_claims', identity.phoneKey));
  await rejects(f.call('alice', 'verifyPhone', { code: 'trusted-code-alice', consent }), 'ACCOUNT_UNAVAILABLE');
  await f.call('alice', 'deleteAccount');
  assert.equal(await f.repository.get('phone_claims', identity.phoneKey), null);
  assert.equal(await f.repository.get('identities', idFor('alice')), null);
});

test('unverified accounts can undo existing actions and an unverified administrator can cancel an event', async () => {
  const f = await fixture(); const own = await postFor(f); const other = await postFor(f, 'bob');
  const { event } = await f.call('operator', 'createEvent', f.eventData);
  const { comment } = await f.call('alice', 'addComment', { targetType: 'post', targetId: other.id, text: '稍后删除' });
  await f.call('alice', 'joinEvent', { id: event.id, join: true }); await f.call('alice', 'followUser', { userId: idFor('bob'), follow: true });
  await f.call('alice', 'likePost', { id: other.id, like: true }); await f.call('alice', 'bookmarkPost', { id: other.id, bookmark: true });
  for (const who of ['alice', 'operator']) { const identity = await f.repository.get('identities', idFor(who)); await f.repository.remove('identities', idFor(who)); await f.repository.remove('phone_claims', identity.phoneKey); }
  await f.call('alice', 'joinEvent', { id: event.id, join: false }); await f.call('alice', 'joinCircle', { id: 'neighbors', join: false });
  await f.call('alice', 'followUser', { userId: idFor('bob'), follow: false }); await f.call('alice', 'likePost', { id: other.id, like: false });
  await f.call('alice', 'bookmarkPost', { id: other.id, bookmark: false }); await f.call('alice', 'deleteComment', { id: comment.id }); await f.call('alice', 'deletePost', { id: own.id });
  await f.call('operator', 'cancelEvent', { id: event.id, reason: '取消安排' });
  assert.equal((await f.call('bob', 'getEvent', { id: event.id })).event.status, 'cancelled');
  await rejects(f.call('alice', 'cancelEvent', { id: event.id, reason: '越权尝试' }), 'FORBIDDEN');
});

test('showPet is a separate opt-in, supports partial edits, and affects author cards without revealing identity', async () => {
  const f = await fixture(); const post = await postFor(f, 'alice');
  const profile = { nickname: '带宠的邻居', area: '公园片区', bio: '介绍', pet: { name: '糯米', type: 'cat' }, publicProfile: true };
  await f.call('alice', 'updateProfile', profile);
  let raw = await f.repository.get('users', idFor('alice')); delete raw.showPet; await f.repository.set('users', idFor('alice'), raw);
  assert.equal((await f.call('alice', 'bootstrap')).user.showPet, false);
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.author.pet, undefined);
  assert.deepEqual((await f.call('bob', 'getUserProfile', { userId: idFor('alice') })).user.pet, profile.pet);
  await f.call('alice', 'updateProfile', { showPet: true, publicProfile: false });
  const me = (await f.call('alice', 'bootstrap')).user;
  assert.equal(me.nickname, profile.nickname); assert.equal(me.area, profile.area); assert.equal(me.bio, profile.bio); assert.deepEqual(me.pet, profile.pet);
  assert.deepEqual((await f.call('bob', 'getPost', { id: post.id })).post.author.pet, profile.pet);
  const publicUser = (await f.call('bob', 'getUserProfile', { userId: idFor('alice') })).user;
  assert.equal(publicUser.showPet, true); assert.deepEqual(publicUser.pet, profile.pet); assert.equal(publicUser.bio, '');
  assert.equal(publicUser.verification, undefined); assert.equal(publicUser.area, undefined);
  await f.call('alice', 'updateProfile', { bio: '改介绍' }); assert.equal((await f.call('alice', 'bootstrap')).user.showPet, true);
  await f.call('alice', 'updateProfile', { showPet: false });
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.author.pet, undefined);
  assert.equal((await f.call('bob', 'getUserProfile', { userId: idFor('alice') })).user.pet, null);
});

test('pet statistics are admin-only aggregates of active accounts with explicit one-pet scope', async () => {
  const f = await fixture({ verifyUsers: false });
  await f.call('alice', 'updateProfile', { pet: { name: '犬犬', type: 'dog' }, publicProfile: true });
  await f.call('bob', 'updateProfile', { pet: { name: '猫猫', type: 'cat' }, showPet: true });
  await f.call('charlie', 'updateProfile', { pet: { name: '小鸟', type: 'other' } });
  await rejects(f.call('alice', 'getPetStats'), 'FORBIDDEN');
  const stats = await f.call('operator', 'getPetStats');
  assert.deepEqual(stats, { totalUsers: 4, profilesWithPet: 3, profilesWithoutPet: 1, publicPetProfiles: 1, byType: { cat: 1, dog: 1, other: 1 },
    scope: '按每个账号的首只宠物统计类型；可登记多只，未填写不代表没有宠物' });
  await f.call('charlie', 'deleteAccount');
  assert.equal((await f.call('operator', 'getPetStats')).totalUsers, 3);
  assert.equal(JSON.stringify(stats).includes('猫猫'), false); assert.equal(JSON.stringify(stats).includes('phone'), false);
});

test('official policies require server-confirmed operator data and cannot be replaced by a client proof', async () => {
  for (const runtimeConfig of [{}, { ...operatorConfig, policyApproved: false }, { ...operatorConfig, retention: '' }]) {
    const f = await fixture({ verifyUsers: false, runtimeConfig });
    assert.equal((await f.call('alice', 'getPolicies')).isDraft, true);
    assert.equal((await f.call('alice', 'bootstrap')).registration.policyConfigured, false);
    await rejects(f.call('alice', 'verifyPhone', { code: 'trusted-code-alice', consent }), 'POLICY_NOT_CONFIGURED');
    await rejects(f.call('alice', 'verifyPhone', { code: 'trusted-code-alice', consent, operator: operatorConfig }), 'INVALID_INPUT');
    assert.deepEqual(await f.repository.find('identities'), []);
  }
  assert.equal(createRuntimeConfig({ OPERATOR_CONFIG: 'not json' }).policyConfigured, false);
  const config = createRuntimeConfig({ OPERATOR_CONFIG: JSON.stringify(operatorConfig), MAINTENANCE_SECRET: 'x'.repeat(32) });
  assert.equal(normalizeRuntimeConfig(config).policyConfigured, true);
  assert.equal(config.maintenanceEnabled, true);
  assert.equal(createRuntimeConfig({ MAINTENANCE_SECRET: ' '.repeat(40) }).maintenanceEnabled, false);
});

test('configured policy versions are served, enforced, and persisted with phone consent', async () => {
  const f = await fixture({ verifyUsers: false, runtimeConfig: { ...operatorConfig, termsVersion: '2026-10-01', privacyVersion: '2026-10-02' } });
  const policies = await f.call('alice', 'getPolicies');
  assert.equal(policies.isDraft, false); assert.deepEqual(policies.operator, { name: operatorConfig.name, contact: operatorConfig.contact });
  await rejects(f.call('alice', 'verifyPhone', { code: 'trusted-code-alice', consent }), 'CONSENT_REQUIRED');
  const currentConsent = { accepted: true, termsVersion: policies.termsVersion, privacyVersion: policies.privacyVersion };
  await f.call('alice', 'verifyPhone', { code: 'trusted-code-alice', consent: currentConsent });
  const identity = await f.repository.get('identities', idFor('alice'));
  assert.equal(identity.termsVersion, '2026-10-01'); assert.equal(identity.privacyVersion, '2026-10-02');
  assert.equal(identity.consentedAt, f.now());
});

test('rate limits are atomic per trusted account and window, and deletion removes its counters', async () => {
  const f = await fixture({ runtimeConfig: { ...operatorConfig, rateLimits: { createPost: { limit: 2, windowMs: 60000 } } } });
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  const payload = { circleId: 'neighbors', text: '测试频次', images: [] };
  const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => f.call('alice', 'createPost', payload)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 2);
  assert.ok(outcomes.filter(result => result.status === 'rejected').every(result => result.reason.code === 'RATE_LIMITED'));
  await rejects(f.call('alice', 'createPost', { ...payload, userId: idFor('bob') }), 'INVALID_INPUT');
  await postFor(f, 'bob');
  const rows = await f.repository.find('rate_limits', { action: 'createPost' });
  assert.equal(rows.find(row => row.userId === idFor('alice')).count, 2);
  assert.equal(rows.find(row => row.userId === idFor('bob')).count, 1);
  assert.ok(rows.every(row => /^rl_[a-f0-9]{64}$/.test(row._id) && row.expiresAt > f.now()));
  f.advance(60000); await f.call('alice', 'createPost', payload);
  await f.call('alice', 'deleteAccount');
  assert.deepEqual(await f.repository.find('rate_limits', { userId: idFor('alice') }), []);
});

test('frequency limits do not stop undo operations or redeem another code for an already verified account', async () => {
  const f = await fixture({ runtimeConfig: { ...operatorConfig, rateLimits: { joinCircle: { limit: 1, windowMs: 60000 }, verifyPhone: { limit: 1, windowMs: 60000 } } } });
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  await rejects(f.call('alice', 'joinCircle', { id: 'neighbors', join: true }), 'RATE_LIMITED');
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: false });
  assert.equal((await f.call('alice', 'getCircle', { id: 'neighbors' })).circle.isJoined, false);
  await f.call('alice', 'verifyPhone', { code: 'already-used-code', consent });
  assert.equal((await f.repository.find('rate_limits', { userId: idFor('alice'), action: 'verifyPhone' }))[0].count, 1);
  const g = await fixture({ verifyUsers: false, runtimeConfig: { ...operatorConfig, rateLimits: { verifyPhone: { limit: 1, windowMs: 60000 } } } });
  await rejects(g.call('alice', 'verifyPhone', { code: 'untrusted', consent }), 'PHONE_VERIFICATION_FAILED');
  await rejects(g.call('alice', 'verifyPhone', { code: 'trusted-code-alice', consent }), 'RATE_LIMITED');
});

test('maintenance requires a separate strong secret and rejects every WeChat client or forged timer context', async () => {
  const secret = 'maintenance-fixture-'.repeat(3); const event = { action: '__maintenance', maintenanceSecret: secret };
  assert.equal(authorizeMaintenance(event, {}, secret), true);
  assert.equal(authorizeMaintenance(event, { OPENID: 'operator' }, secret), false);
  assert.equal(authorizeMaintenance({ ...event, maintenanceSecret: `${secret}x` }, {}, secret), false);
  assert.equal(authorizeMaintenance({ action: '__maintenance', Type: 'Timer', TriggerName: 'maintenance' }, {}, secret), false);
  assert.equal(authorizeMaintenance({ ...event, maintenanceSecret: 'weak' }, {}, 'weak'), false);
  const f = await fixture();
  await rejects(f.call('operator', '__maintenance', { maintenanceSecret: secret }), 'UNKNOWN_ACTION');
  await rejects(f.call('alice', 'acceptReviewResult', { decision: 'pass' }), 'UNKNOWN_ACTION');
  await rejects(f.service.runMaintenance({ limit: 51 }), 'INVALID_INPUT');
});

test('admin health reports bounded queue counts and distinguishes configured maintenance from successful runs', async () => {
  const f = await fixture({ runtimeConfig: { ...operatorConfig, maintenanceEnabled: true } });
  await rejects(f.call('alice', 'getHealth'), 'FORBIDDEN');
  const before = await f.call('operator', 'getHealth');
  assert.equal(before.maintenanceEnabled, true); assert.equal(before.maintenance.lastRunAt, null);
  for (let index = 0; index < 105; index++) await f.repository.set('uploads', `queue_${index}`, { ownerId: idFor('alice'), status: 'pending', expiresAt: f.now() + 60000 });
  const health = await f.call('operator', 'getHealth');
  assert.equal(health.pendingUploads, 100); assert.equal(health.countsLimited, true);
  assert.equal(JSON.stringify(health).includes(idFor('alice')), false); assert.equal(JSON.stringify(health).includes('secret'), false);
  await f.service.runMaintenance({ limit: 2 });
  assert.equal((await f.call('operator', 'getHealth')).maintenance.lastSuccessAt, f.now());
});

test('bounded maintenance cleans expired/unclaimed uploads and counters, while retaining live and legacy referenced images', async () => {
  const f = await fixture(); const ownerId = idFor('alice'); const timestamp = f.now();
  await f.repository.set('uploads', 'a_expired', { ownerId, status: 'pending', cloudPath: 'community/incoming/a.jpg', expiresAt: timestamp - 1 });
  await f.repository.set('uploads', 'b_orphan', { ownerId, status: 'complete', fileId: 'cloud://test.bucket/orphan.jpg', completedAt: timestamp - 86400001 });
  await f.repository.set('uploads', 'c_legacy', { ownerId, status: 'complete', fileId: 'cloud://test.bucket/legacy.jpg', completedAt: timestamp - 86400001 });
  await f.repository.set('posts', 'legacy_post', { authorId: ownerId, deleted: false, images: ['cloud://test.bucket/legacy.jpg'] });
  await f.repository.set('uploads', 'd_live', { ownerId, status: 'complete', postId: 'live_post', fileId: 'cloud://test.bucket/live.jpg',
    sourceFileId: 'cloud://test.bucket/source.jpg', quarantineFileId: 'cloud://test.bucket/quarantine.jpg', completedAt: timestamp - 86400001 });
  await f.repository.set('posts', 'live_post', { authorId: ownerId, deleted: false, images: ['cloud://test.bucket/live.jpg'] });
  await f.repository.set('rate_limits', 'expired_rate', { userId: ownerId, count: 1, expiresAt: timestamp - 1 });
  const first = await f.service.runMaintenance({ limit: 2 });
  assert.equal(first.uploadsScanned, 2); assert.equal(first.uploadsDeleted, 2); assert.equal(first.rateLimitsDeleted, 1);
  const second = await f.service.runMaintenance({ limit: 2 });
  assert.equal(second.uploadsDeleted, 0); assert.ok(await f.repository.get('uploads', 'c_legacy')); assert.ok(await f.repository.get('uploads', 'd_live'));
  assert.ok(f.removed.includes('cloud://test.bucket/orphan.jpg')); assert.ok(f.removed.includes('cloud://test.bucket/source.jpg'));
  assert.ok(f.removed.includes('cloud://test.bucket/quarantine.jpg'));
  assert.equal(f.removed.includes('cloud://test.bucket/legacy.jpg'), false); assert.equal(f.removed.includes('cloud://test.bucket/live.jpg'), false);
});

test('failed cleanup stays retryable, records sanitized failures, and a maintenance lease excludes concurrent runs', async () => {
  const f = await fixture(); const ticket = await f.call('alice', 'createUploadTicket', { extension: 'jpg' }); f.advance(16 * 60000);
  const remove = f.storage.remove; let failOnce = true;
  f.storage.remove = async files => { if (failOnce) { failOnce = false; throw Object.assign(new Error('private details'), { code: 'private secret in error code' }); } return remove(files); };
  const first = await f.service.runMaintenance();
  assert.equal(first.failures, 1); assert.equal((await f.repository.get('uploads', ticket.ticketId)).status, 'cleanup');
  let state = await f.repository.get('settings', 'maintenance');
  assert.equal(state.lastSuccessAt, null); assert.equal(state.lastErrorCode, 'UPLOAD_CLEANUP_RETRY');
  const second = await f.service.runMaintenance(); assert.equal(second.uploadsDeleted, 1); assert.equal(second.failures, 0);
  assert.equal(await f.repository.get('uploads', ticket.ticketId), null);
  state = await f.repository.get('settings', 'maintenance');
  await f.repository.set('settings', 'maintenance', { ...state, lockUntil: f.now() + 60000 });
  await rejects(f.service.runMaintenance(), 'MAINTENANCE_BUSY');
});

test('maintenance retries durable activity notices without visitor traffic or duplicate recipients', async () => {
  const f = await fixture(); const { event } = await f.call('operator', 'createEvent', f.eventData);
  await f.call('alice', 'joinEvent', { id: event.id, join: true }); await f.call('bob', 'joinEvent', { id: event.id, join: true });
  const transaction = f.repository.transaction.bind(f.repository); let shouldFail = true;
  f.repository.transaction = fn => transaction(tx => fn({ ...tx, async set(name, id, value) {
    if (name === 'messages' && value.title === '活动信息已更新' && value.toId === idFor('bob') && shouldFail) { shouldFail = false; throw new Error('transient'); }
    return tx.set(name, id, value);
  } }));
  await f.call('operator', 'updateEvent', { ...f.eventData, id: event.id, location: '公园西门' });
  assert.equal((await f.repository.find('outbox')).length, 1);
  assert.equal((await f.service.runMaintenance()).notificationsProcessed, 1);
  assert.deepEqual(await f.repository.find('outbox'), []);
  for (const userId of [idFor('alice'), idFor('bob')]) assert.equal((await f.repository.find('messages', { toId: userId })).filter(message => message.title === '活动信息已更新').length, 1);
});

async function asyncFixture() {
  let f; let decision = 'pending'; let finalizer; const files = []; const removed = []; let finalized = 0;
  const storage = { enabled: true, mode: 'async', isExpectedFile: (file, path) => file === `cloud://test.bucket/${path}`,
    fileIdForPath: path => `cloud://test.bucket/${path}`,
    async submitReview({ ticketId, ownerId, openid }) {
      assert.equal(ownerId, idFor(openid));
      const review = { traceId: `trace_${ticketId}`, quarantineFileId: `cloud://test.bucket/community/quarantine/${ticketId}.jpg`, sha256: 'a'.repeat(64), reviewExpiresAt: f.now() + 1800000 };
      await f.repository.set('media_reviews', review.traceId, { ...review, ticketId, ownerId, createdAt: f.now() }); return review;
    },
    async getReviewDecision({ ownerId, ticketId, traceId }) {
      const review = await f.repository.get('media_reviews', traceId); assert.equal(review.ownerId, ownerId); assert.equal(review.ticketId, ticketId);
      return { status: decision };
    },
    async finalizeReview(input) { finalized++; if (finalizer) await finalizer(input); const file = `cloud://test.bucket/${input.cloudPath}`; files.push(file); return file; },
    async remove(fileIds) { removed.push(...fileIds); },
    async removeReview({ traceId }) { await f.repository.remove('media_reviews', traceId); }
  };
  f = await fixture({ storage });
  return { ...f, files, removed, setDecision: value => { decision = value; }, setFinalizer: value => { finalizer = value; }, finalized: () => finalized };
}
async function pendingImage(f) {
  const ticket = await f.call('alice', 'createUploadTicket', { extension: 'jpg' });
  assert.deepEqual(await f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: `cloud://test.bucket/${ticket.cloudPath}` }), { status: 'pending', ticketId: ticket.ticketId });
  return ticket;
}

test('pending async images cannot be published, polled by another account, or passed with a client result', async () => {
  const f = await asyncFixture(); const ticket = await pendingImage(f);
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  await rejects(f.call('bob', 'getUploadStatus', { ticketId: ticket.ticketId }), 'FORBIDDEN');
  const upload = await f.repository.get('uploads', ticket.ticketId);
  await rejects(f.call('alice', 'createPost', { circleId: 'neighbors', text: '', images: [upload.quarantineFileId] }), 'FORBIDDEN');
  assert.equal((await f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId, decision: 'pass' })).status, 'pending');
  assert.equal(f.finalized(), 0); assert.deepEqual(f.files, []);
});

test('trusted async approval finalizes once under concurrent polling and preserves only its public image', async () => {
  const f = await asyncFixture(); const ticket = await pendingImage(f); f.setDecision('pass');
  const outcomes = await Promise.all(Array.from({ length: 10 }, () => f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId })));
  assert.equal(f.finalized(), 1); assert.ok(outcomes.every(result => ['pending', 'complete'].includes(result.status)));
  const complete = await f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId });
  assert.equal(complete.status, 'complete'); assert.equal(complete.fileId, f.files[0]);
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  const { post } = await f.call('alice', 'createPost', { circleId: 'neighbors', text: '审核通过', images: [complete.fileId] });
  await f.service.runMaintenance();
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.images[0], complete.fileId);
  assert.equal(f.removed.includes(complete.fileId), false); assert.deepEqual(await f.repository.find('media_reviews'), []);
});

test('async rejection, expiry, and changed image bytes are terminal and never create public copies', async () => {
  for (const decision of ['reject', 'expired']) {
    const f = await asyncFixture(); const ticket = await pendingImage(f); f.setDecision(decision);
    assert.equal((await f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId })).status, decision === 'reject' ? 'rejected' : 'expired');
    assert.equal(f.finalized(), 0); assert.deepEqual(f.files, []);
    assert.equal((await f.service.runMaintenance()).uploadsDeleted, 1);
  }
  const f = await asyncFixture(); const ticket = await pendingImage(f); f.setDecision('pass');
  f.setFinalizer(async () => { throw Object.assign(new Error('changed bytes'), { code: 'MEDIA_CONTENT_CHANGED' }); });
  await rejects(f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId }), 'MEDIA_CONTENT_CHANGED');
  assert.equal((await f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId })).status, 'rejected'); assert.equal(f.finalized(), 1);
});

test('cleanup during an expired async finalizer cannot resurrect its ticket or return a usable image', async () => {
  const f = await asyncFixture(); const ticket = await pendingImage(f); f.setDecision('pass');
  let started; let release; const began = new Promise(resolve => { started = resolve; }); const paused = new Promise(resolve => { release = resolve; });
  f.setFinalizer(async () => { started(); await paused; });
  const inFlight = f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId });
  await began; f.advance(31 * 60000); await f.service.runMaintenance(); release();
  await assert.rejects(inFlight, error => ['NOT_FOUND', 'UPLOAD_EXPIRED'].includes(error.code));
  assert.equal(await f.repository.get('uploads', ticket.ticketId), null);
  assert.equal(f.files.length, 1); assert.ok(f.removed.includes(f.files[0])); assert.deepEqual(await f.repository.find('posts'), []);
});

test('publication rechecks its image ticket after a concurrent maintenance cleanup', async () => {
  const f = await fixture(); const ticket = await f.call('alice', 'createUploadTicket', { extension: 'jpg' });
  const uploaded = await f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: `cloud://test.bucket/${ticket.cloudPath}` });
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true }); f.advance(86400001);
  const find = f.repository.find.bind(f.repository); let started; let release;
  const began = new Promise(resolve => { started = resolve; }); const paused = new Promise(resolve => { release = resolve; });
  f.repository.find = async (collection, filters, options) => {
    const rows = await find(collection, filters, options);
    if (collection === 'uploads' && filters.fileId === uploaded.fileId) { started(); await paused; }
    return rows;
  };
  const publishing = f.call('alice', 'createPost', { circleId: 'neighbors', text: '准备发布', images: [uploaded.fileId] });
  await began; await f.service.runMaintenance(); release();
  await rejects(publishing, 'FORBIDDEN'); assert.deepEqual(await f.repository.find('posts'), []); assert.ok(f.removed.includes(uploaded.fileId));
});

test('orphan media-review cleanup is bounded, expires interrupted tickets, and protects live finalization leases', async () => {
  const f = await fixture(); const expired = f.now() - 1; const quarantine = 'cloud://test.bucket/community/quarantine/orphan.jpg';
  await f.repository.set('media_reviews', 'a_unbound', { createdAt: f.now() - 86400001, decision: 'pass' });
  await f.repository.set('media_reviews', 'b_orphan', { createdAt: f.now() - 2000000, reviewExpiresAt: expired, ticketId: 'interrupted_ticket', quarantineFileId: quarantine });
  await f.repository.set('uploads', 'interrupted_ticket', { status: 'processing', phase: 'submitting', expiresAt: expired, leaseUntil: expired });
  await f.repository.set('media_reviews', 'c_active', { reviewExpiresAt: expired, ticketId: 'live_ticket', quarantineFileId: 'cloud://test.bucket/keep.jpg' });
  await f.repository.set('uploads', 'live_ticket', { status: 'processing', phase: 'finalizing', expiresAt: expired, leaseUntil: f.now() + 60000 });
  const first = await f.service.runMaintenance({ limit: 2 });
  assert.equal(first.mediaReviewsScanned, 2); assert.equal(first.mediaReviewsDeleted, 2); assert.ok(f.removed.includes(quarantine));
  const second = await f.service.runMaintenance({ limit: 2 });
  assert.equal(second.mediaReviewsDeleted, 0); assert.ok(await f.repository.get('media_reviews', 'c_active'));
  assert.equal(f.removed.includes('cloud://test.bucket/keep.jpg'), false);
});

test('an old phone exchange cannot verify a recreated account even when both lifetimes share a timestamp', async () => {
  let started; let release; const began = new Promise(resolve => { started = resolve; }); const paused = new Promise(resolve => { release = resolve; });
  const f = await fixture({ verifyUsers: false, phoneVerifier: { enabled: true, async verifyCode() {
    started(); await paused; return { phoneKey: phoneKeyFor('old-lifetime-phone'), maskedPhone: '+86 138****6666' };
  } } });
  const oldUser = await f.repository.get('users', idFor('alice'));
  const oldRequest = f.call('alice', 'verifyPhone', { code: 'old-exchange', consent });
  await began; await f.call('alice', 'deleteAccount'); const fresh = await f.call('alice', 'bootstrap'); release();
  await rejects(oldRequest, 'ACCOUNT_UNAVAILABLE');
  const newUser = await f.repository.get('users', idFor('alice'));
  assert.equal(newUser.createdAt, oldUser.createdAt); assert.notEqual(newUser.lifecycleId, oldUser.lifecycleId);
  assert.equal(fresh.user.verification.status, 'unverified'); assert.equal(JSON.stringify(fresh).includes('lifecycleId'), false);
  assert.deepEqual(await f.repository.find('identities'), []); assert.deepEqual(await f.repository.find('phone_claims'), []);
});

test('an old moderated profile request cannot overwrite a new account and parallel deletion cannot clear it later', async () => {
  let started; let release; const began = new Promise(resolve => { started = resolve; }); const paused = new Promise(resolve => { release = resolve; });
  const f = await fixture({ moderateText: async () => { started(); await paused; } });
  const oldRequest = f.call('alice', 'updateProfile', { nickname: '旧资料' });
  await began; await f.call('alice', 'deleteAccount'); await f.call('alice', 'bootstrap'); release();
  await rejects(oldRequest, 'ACCOUNT_UNAVAILABLE');
  assert.equal((await f.call('alice', 'bootstrap')).user.nickname, '爱宠邻居');
  const g = await fixture(); await g.call('alice', 'createUploadTicket', { extension: 'jpg' });
  let cleanupStarted; let cleanupRelease; const deleting = new Promise(resolve => { cleanupStarted = resolve; }); const held = new Promise(resolve => { cleanupRelease = resolve; });
  g.storage.remove = async () => { cleanupStarted(); await held; };
  const first = g.call('alice', 'deleteAccount'); await deleting;
  await rejects(g.call('alice', 'deleteAccount'), 'ACCOUNT_UNAVAILABLE'); await rejects(g.call('alice', 'bootstrap'), 'ACCOUNT_UNAVAILABLE');
  cleanupRelease(); await first; assert.equal((await g.call('alice', 'bootstrap')).user.verification.status, 'unverified');
});

test('a failed image removal after deleting a post is retried by maintenance and does not remain claimed forever', async () => {
  const f = await fixture(); const ticket = await f.call('alice', 'createUploadTicket', { extension: 'jpg' });
  const image = await f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: `cloud://test.bucket/${ticket.cloudPath}` });
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  const { post } = await f.call('alice', 'createPost', { circleId: 'neighbors', text: '稍后删除', images: [image.fileId] });
  const remove = f.storage.remove; let shouldFail = true;
  f.storage.remove = async files => { if (shouldFail) { shouldFail = false; throw new Error('temporary file failure'); } return remove(files); };
  assert.deepEqual(await f.call('alice', 'deletePost', { id: post.id }), { deleted: true });
  assert.equal(f.removed.includes(image.fileId), false);
  assert.equal((await f.service.runMaintenance()).uploadsDeleted, 1);
  assert.ok(f.removed.includes(image.fileId)); assert.equal(await f.repository.get('uploads', ticket.ticketId), null);
});

test('a publisher failure after a server copy was written retains its pre-recorded path for maintenance', async () => {
  const f = await asyncFixture(); const ticket = await pendingImage(f); f.setDecision('pass');
  let writtenPath;
  f.setFinalizer(async ({ cloudPath }) => { writtenPath = `cloud://test.bucket/${cloudPath}`; throw new Error('response lost after write'); });
  await assert.rejects(f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId }), /response lost/);
  assert.equal((await f.repository.get('uploads', ticket.ticketId)).publishingFileId, writtenPath);
  f.advance(31 * 60000); await f.service.runMaintenance();
  assert.ok(f.removed.includes(writtenPath)); assert.equal(await f.repository.get('uploads', ticket.ticketId), null);
});

test('deletion keeps an active quarantine writer registered until its late write and failed cleanup can be retried', async () => {
  const f = await fixture(); const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]);
  const files = new Set(); let started; let release; let deletionFails = true;
  const began = new Promise(resolve => { started = resolve; }); const held = new Promise(resolve => { release = resolve; });
  const adapter = createStorage({
    async downloadFile() { return { fileContent: bytes }; },
    async uploadFile({ cloudPath }) { started(); await held; const fileID = `cloud://test.bucket/${cloudPath}`; files.add(fileID); return { fileID }; },
    async getTempFileURL({ fileList }) { return { fileList: fileList.map(fileID => ({ fileID, tempFileURL: 'https://example.invalid/review.jpg', status: 0 })) }; },
    openapi: { security: { async mediaCheckAsync() { throw new Error('media provider failed after snapshot write'); } } },
    async deleteFile({ fileList }) { return { fileList: fileList.map(fileID => {
      if (files.has(fileID) && deletionFails) return { fileID, status: -1, errMsg: 'temporary deletion failure' };
      files.delete(fileID); return { fileID, status: 0 };
    }) }; }
  }, { UPLOADS_ENABLED: 'true', MEDIA_REVIEW_MODE: 'async', CLOUD_FILE_PREFIX: 'cloud://test.bucket/', MEDIA_QUARANTINE_LOCK_CONFIRMED: 'true',
    MEDIA_CALLBACK_APP_ID: 'wx1234567890abcdef', MEDIA_CALLBACK_TOKEN: 'callback-test-token', MEDIA_CALLBACK_ENCODING_AES_KEY: Buffer.alloc(32, 1).toString('base64').slice(0, -1) },
  { repository: f.repository, now: f.now });
  assert.equal(adapter.enabled, true); Object.assign(f.storage, adapter);
  const ticket = await f.call('alice', 'createUploadTicket', { extension: 'jpg' });
  const uploading = f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: `cloud://test.bucket/${ticket.cloudPath}` });
  await began;
  const registered = await f.repository.get('uploads', ticket.ticketId);
  assert.ok(registered.quarantineFileId); assert.equal(files.has(registered.quarantineFileId), false);
  await rejects(f.call('alice', 'deleteAccount'), 'ACCOUNT_UNAVAILABLE');
  assert.equal((await f.repository.get('users', idFor('alice'))).status, 'deleting');
  assert.ok(await f.repository.get('uploads', ticket.ticketId)); await rejects(f.call('alice', 'bootstrap'), 'ACCOUNT_UNAVAILABLE');
  release(); await rejects(uploading, 'CONTENT_CHECK_UNAVAILABLE');
  assert.ok(files.has(registered.quarantineFileId));
  assert.equal((await f.service.runMaintenance()).failures, 1);
  assert.ok(await f.repository.get('uploads', ticket.ticketId));
  deletionFails = false; await f.call('alice', 'deleteAccount');
  assert.equal(files.size, 0); assert.equal(await f.repository.get('uploads', ticket.ticketId), null);
  assert.equal((await f.call('alice', 'bootstrap')).user.verification.status, 'unverified');
});

test('shared animal and topic contracts stay consistent across independent cloud deployment', () => {
  const service = require('../cloudfunctions/community/service');
  const topics = require('../miniprogram/data/topics');
  assert.deepEqual(service.ANIMAL_TYPES, require('../miniprogram/data/animal-types').IDS);
  assert.deepEqual(service.TOPICS, Array.from(topics));
  assert.deepEqual(service.TOPIC_ALIASES, topics.ALIASES);
});

test('animal tags validate, normalize legacy data and filter sparse pages without deriving tags from profiles', async () => {
  const f = await fixture();
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  const base = { circleId: 'neighbors', text: '宠物观察', images: [] };
  const { post: tagged } = await f.call('alice', 'createPost', { ...base, animalTypes: ['rabbit', 'rabbit', 'small-mammal'] });
  assert.deepEqual(tagged.animalTypes, ['rabbit', 'small-mammal']);
  assert.deepEqual((await f.repository.get('posts', tagged.id)).animalTypes, tagged.animalTypes);
  for (const animalTypes of [null, 'cat', ['dragon'], ['unclassified'], ['cat', 'dog', 'bird', 'fish']]) await rejects(f.call('alice', 'createPost', { ...base, animalTypes }), 'INVALID_INPUT');
  await f.call('bob', 'updateProfile', { pet: { name: '猫咪', type: 'cat' }, showPet: true });
  for (let index = 0; index < 85; index++) {
    const id = `1800000000000_${String(index + 1000).padStart(24, '0')}`;
    await f.repository.set('posts', id, { authorId: idFor('bob'), circleId: 'neighbors', text: '同一检索词',
      title: '', topics: [], ...(index < 3 ? { animalTypes: ['fish', 'unknown'] } : { animalTypes: ['dog'] }), images: [], deleted: false, createdAt: f.now() + index });
  }
  const payload = { animalType: 'fish', excludedAnimalTypes: ['dog'], query: '同一检索词', limit: 2 };
  const first = await f.call('alice', 'listPosts', payload);
  assert.equal(first.items.length, 0); assert.ok(first.nextCursor);
  const all = []; const cursors = new Set(); let cursor = first.nextCursor;
  for (let page = 0; cursor && page < 10; page++) {
    assert.equal(cursors.has(cursor), false); cursors.add(cursor);
    const result = await f.call('alice', 'listPosts', { ...payload, cursor });
    all.push(...result.items); cursor = result.nextCursor;
  }
  assert.equal(cursor, undefined); assert.equal(all.length, 3);
  assert.equal(new Set(all.map(item => item.id)).size, 3);
  assert.ok(all.every(item => JSON.stringify(item.animalTypes) === '["fish"]'));
  const legacy = await postFor(f, 'bob');
  assert.deepEqual(legacy.animalTypes, []);
  const unclassified = await f.call('alice', 'listPosts', { animalType: 'unclassified', authorId: idFor('bob'), limit: 50 });
  assert.ok(unclassified.items.some(item => item.id === legacy.id));
  assert.ok(unclassified.items.every(item => item.animalTypes.length === 0));
  for (const params of [{ animalType: 'dragon' }, { animalType: false }, { excludedAnimalTypes: 'cat' }, { excludedAnimalTypes: ['unclassified'] }, { excludedAnimalTypes: Array(11).fill('dog') }]) await rejects(f.call('alice', 'listPosts', params), 'INVALID_INPUT');
});

test('cloud circle initialization expands an old installation and preserves existing memberships and custom metadata', async () => {
  const f = await fixture();
  await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  const circle = await f.repository.get('circles', 'neighbors');
  await f.repository.set('circles', 'neighbors', { ...circle, name: '运营者已自定义的圈子' });
  for (const id of ['small_pets', 'birds', 'aquatics', 'exotics', 'beginners']) await f.repository.remove('circles', id);
  await f.call('operator', 'initialize', { city: '原来的城市', areas: ['公园片区'], contact: '运营者' });
  const circles = (await f.call('alice', 'listCircles')).items;
  assert.equal(circles.length, 8);
  const preserved = circles.find(item => item.id === 'neighbors');
  assert.equal(preserved.name, '运营者已自定义的圈子'); assert.equal(preserved.isJoined, true); assert.equal(preserved.memberCount, 1);
});

test('topic aliases are normalized on create and read, searched compatibly, and reject inherited keys', async () => {
  const f = await fixture(); await f.call('alice', 'joinCircle', { id: 'neighbors', join: true });
  const base = { circleId: 'neighbors', text: '话题测试', images: [] };
  const { post } = await f.call('alice', 'createPost', { ...base, topics: ['一起散步', '宠物友好去处', '户外出行'] });
  assert.deepEqual(post.topics, ['户外出行']);
  assert.deepEqual((await f.repository.get('posts', post.id)).topics, ['户外出行']);
  for (const topic of ['一起散步', '户外出行']) assert.ok((await f.call('alice', 'listPosts', { topic })).items.some(item => item.id === post.id));
  const raw = await f.repository.get('posts', post.id); raw.topics = ['宠物治愈时刻'];
  await f.repository.set('posts', post.id, raw);
  assert.deepEqual((await f.call('bob', 'getPost', { id: post.id })).post.topics, ['治愈瞬间']);
  assert.deepEqual((await f.repository.get('posts', post.id)).topics, ['宠物治愈时刻']);
  for (const topics of [['toString'], ['__proto__'], [{}]]) await rejects(f.call('alice', 'createPost', { ...base, topics }), 'INVALID_INPUT');
});

async function enableTestVideo(f, overrides = {}) {
  f.storage.videoEnabled = true;
  f.storage.mode = 'async'; // Video must not use the image async-review path.
  f.storage.submitReview = async () => { throw new Error('Images review must not receive videos'); };
  f.storage.verifyAndPublish = async ({ cloudPath, mediaType }) => {
    assert.equal(mediaType, 'video');
    const fileId = `cloud://test.bucket/${cloudPath}`; f.published.push(fileId);
    return { fileId, durationSeconds: 12, width: 640, height: 360, bytes: 4096, ...overrides };
  };
  const ticket = await f.call('alice', 'createUploadTicket', { mediaType: 'video', extension: 'mp4', bytes: 1000, durationSeconds: 10, width: 320, height: 180 });
  return { ticket, fileId: `cloud://test.bucket/${ticket.cloudPath}` };
}

test('cloud video publication uses an owned approved ticket and server metadata, with image/video separation and cleanup', async () => {
  const f = await fixture(); const { ticket, fileId } = await enableTestVideo(f);
  const base = { circleId: 'neighbors', images: [], text: '' };
  for (const who of ['alice', 'bob']) await f.call(who, 'joinCircle', { id: 'neighbors', join: true });
  await rejects(f.call('bob', 'completeUpload', { ticketId: ticket.ticketId, fileId }), 'FORBIDDEN');
  await rejects(f.call('alice', 'createPost', { ...base, video: { url: fileId } }), 'FORBIDDEN');
  const uploaded = await f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId });
  assert.equal(uploaded.mediaType, 'video');
  assert.deepEqual(uploaded.video, { url: uploaded.fileId, durationSeconds: 12, width: 640, height: 360 });
  assert.deepEqual(await f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId }), uploaded);
  assert.equal(f.published.length, 1);
  await rejects(f.call('bob', 'createPost', { ...base, video: uploaded.video }), 'FORBIDDEN');
  await rejects(f.call('alice', 'createPost', { ...base, images: [uploaded.fileId] }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'createPost', { ...base, images: ['anything'], video: uploaded.video }), 'INVALID_INPUT');
  await rejects(f.call('alice', 'createPost', { ...base, video: { ...uploaded.video, poster: 'https://cdn.example.org/foreign.jpg' } }), 'INVALID_INPUT');
  const { post } = await f.call('alice', 'createPost', { ...base, video: { ...uploaded.video, durationSeconds: 999, width: 1 } });
  assert.deepEqual(post.video, uploaded.video); assert.deepEqual(post.images, []); assert.equal(post.contentType, 'video');
  await rejects(f.call('alice', 'createPost', { ...base, video: uploaded.video }), 'FORBIDDEN');
  f.advance(2 * 86400000); await f.service.runMaintenance();
  assert.ok(await f.repository.get('uploads', ticket.ticketId));
  assert.equal(f.removed.includes(uploaded.fileId), false);
  await f.call('alice', 'deletePost', { id: post.id });
  assert.ok(f.removed.includes(uploaded.fileId));
  assert.equal((await f.repository.get('posts', post.id)).video, null);
});

test('video capability fails closed and rejected server validation leaves no usable upload', async () => {
  const f = await fixture();
  const input = { mediaType: 'video', extension: 'mp4', bytes: 1000, durationSeconds: 10 };
  await rejects(f.call('alice', 'createUploadTicket', input), 'VIDEO_UNAVAILABLE');
  f.storage.videoEnabled = true;
  for (const change of [{ bytes: 0 }, { bytes: 20 * 1024 * 1024 + 1 }, { durationSeconds: 61 }, { durationSeconds: 0 }]) await rejects(f.call('alice', 'createUploadTicket', { ...input, ...change }), 'INVALID_VIDEO');
  await rejects(f.call('alice', 'createUploadTicket', { ...input, extension: 'mov' }), 'INVALID_INPUT');
  const { ticket, fileId } = await enableTestVideo(f, { durationSeconds: 61 });
  await rejects(f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId }), 'INVALID_VIDEO');
  assert.equal((await f.call('alice', 'getUploadStatus', { ticketId: ticket.ticketId })).status, 'rejected');
  assert.ok(f.removed.includes(f.published[0]));
  const other = await enableTestVideo(f);
  f.storage.verifyAndPublish = async () => { throw Object.assign(new Error('review unavailable'), { code: 'VIDEO_UNAVAILABLE' }); };
  await rejects(f.call('alice', 'completeUpload', { ticketId: other.ticket.ticketId, fileId: other.fileId }), 'VIDEO_UNAVAILABLE');
  assert.equal((await f.call('alice', 'getUploadStatus', { ticketId: other.ticket.ticketId })).status, 'pending');
  f.storage.verifyAndPublish = async ({ cloudPath }) => ({ fileId: `cloud://test.bucket/${cloudPath}`, durationSeconds: 10, bytes: 1000 });
  assert.equal((await f.call('alice', 'completeUpload', { ticketId: other.ticket.ticketId, fileId: other.fileId })).status, 'complete');
});

test('circle and author exclusions retain sparse cursor progress and do not limit direct or bookmarked access', async () => {
  const f = await fixture();
  for (let index = 0; index < 85; index++) {
    const id = `1800000000000_${String(index + 1000).padStart(24, '0')}`;
    await f.repository.set('posts', id, { authorId: idFor('bob'), circleId: 'neighbors', text: '浏览过滤测试 ' + index,
      topics: [], images: [], animalTypes: index < 3 ? ['bird'] : ['reptile'], createdAt: f.now() + index, deleted: false });
  }
  for (const [action, base] of [['getCircle', { id: 'neighbors' }], ['getUserProfile', { userId: idFor('bob') }]]) {
    let cursor; const all = []; const cursors = new Set();
    for (let page = 0; page < 12; page++) {
      const response = await f.call('alice', action, { ...base, limit: 2, excludedAnimalTypes: ['reptile'], cursor });
      if (page === 0) { assert.equal(response.posts.length, 0); assert.ok(response.nextCursor); }
      all.push(...response.posts); cursor = response.nextCursor;
      if (!cursor) break;
      assert.equal(cursors.has(cursor), false); cursors.add(cursor);
    }
    assert.equal(cursor, undefined); assert.equal(all.length, 3);
    assert.equal(new Set(all.map(post => post.id)).size, 3); assert.ok(all.every(post => post.animalTypes.includes('bird')));
    await rejects(f.call('alice', action, { ...base, excludedAnimalTypes: ['unknown'] }), 'INVALID_INPUT');
  }
  const hiddenId = '1800000000000_' + String(1084).padStart(24, '0');
  await f.call('alice', 'bookmarkPost', { id: hiddenId, bookmark: true });
  assert.equal((await f.call('alice', 'listPosts', { bookmarked: true })).items[0].id, hiddenId);
  assert.ok((await f.call('bob', 'listPosts', { mine: true })).items.some(post => post.id === hiddenId));
  assert.equal((await f.call('alice', 'getPost', { id: hiddenId })).post.text, '浏览过滤测试 84');
});

module.exports = { memoryRepository };
