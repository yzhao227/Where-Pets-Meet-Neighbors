const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed } = require('./helpers/community-fixture');
const TOPICS = require('../miniprogram/data/topics');

const EPOCH = Date.UTC(2026, 8, 29, 2);
const clone = value => JSON.parse(JSON.stringify(value));

test('demo neighbors default to private and expose only separately opted-in genuine participants with public pets', async () => {
  const f = await fixture();
  const initial = (await f.api.call('bootstrap')).user;
  assert.equal(initial.neighborVisible, false); assert.equal(initial.residenceSharing, false); assert.equal(initial.neighborAreaId, '');
  f.edit(state => {
    const template = state.users.find(user => user.id === 'demo-self');
    for (let i = 0; i < 25; i += 1) state.users.push({ ...clone(template), id: 'participant-' + String(i).padStart(2, '0'), nickname: '测试参与者' + i, neighborVisible: true, neighborAreaId: 'sh-minhang-xinzhuang', area: '旧私密住址', bio: '私密描述', pet: { name: '私密宠物名', type: i % 2 ? 'cat' : 'dog' }, showPet: i % 3 === 0 });
    const sample = state.users.find(user => user.id === 'demo-lin');
    Object.assign(sample, { neighborVisible: true, neighborAreaId: 'sh-minhang-xinzhuang', showPet: true, verification: clone(template.verification), demoConsent: clone(template.demoConsent) });
  });
  const seen = []; let cursor;
  do {
    const page = await f.api.call('listNeighbors', { limit: 2, cursor });
    seen.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 9); assert.equal(new Set(seen.map(user => user.id)).size, 9);
  assert.ok(seen.every(user => user.id.startsWith('participant-') && user.pet && user.area === undefined && user.bio === ''));
  for (const query of ['莘庄', '闵行']) assert.equal((await f.api.call('listNeighbors', { query, limit: 50 })).items.length, 9);
  assert.deepEqual((await f.api.call('listNeighbors', { query: '旧私密住址' })).items, []);
  assert.deepEqual((await f.api.call('listNeighbors', { query: '私密描述' })).items, []);
  assert.equal((await f.api.call('listNeighbors', { kind: 'people', limit: 50 })).items.length, 16);
  assert.equal((await f.api.call('listNeighbors', { kind: 'all', petType: 'cat', limit: 50 })).items.length, 4);
  await f.api.call('blockUser', { userId: 'participant-00', block: true });
  assert.equal((await f.api.call('listNeighbors', { limit: 50 })).items.length, 8);
  f.edit(state => state.blocks.push({ userId: 'participant-03', blockedUserId: 'demo-self' }));
  assert.equal((await f.api.call('listNeighbors', { limit: 50 })).items.length, 7);
  await assert.rejects(f.api.call('listNeighbors', { petType: 'none' }), { code: 'INVALID_INPUT' });
});

test('demo residence sharing validates opt-in, never publishes cells, and preserves the cooldown after closing', async () => {
  const f = await fixture(); const grid = require('../miniprogram/data/neighbor-location');
  const cell = grid.toCell({ latitude: 31.1, longitude: 121.38, coordinateSystem: 'gcj02' });
  const mine = await f.api.call('updateProfile', { neighborVisible: true, neighborAreaId: 'sh-minhang-xinzhuang', residenceSharing: true, residenceCell: cell });
  assert.deepEqual(mine.user.residenceCell, cell);
  f.edit(state => {
    const template = state.users.find(user => user.id === 'demo-self');
    state.users.push({ ...clone(template), id: 'participant-nearby', nickname: '测试宠友', showPet: true, pet: { name: '测试毛孩子', type: 'cat' }, residenceCell: { ...cell, x: cell.x + 4 } });
  });
  const item = (await f.api.call('listNeighbors')).items[0];
  assert.equal(item.distanceBand, '约3–5km');
  assert.equal(item.residenceCell, undefined); assert.equal(item.residenceUpdatedAt, undefined); assert.equal(item.latitude, undefined);
  await assert.rejects(f.api.call('updateProfile', { residenceCell: { ...cell, longitude: 121.38 } }), { code: 'INVALID_INPUT' });
  await f.api.call('updateProfile', { residenceSharing: false, residenceCell: null });
  assert.equal((await f.api.call('bootstrap')).user.residenceCell, null);
  assert.equal((await f.api.call('listNeighbors')).items[0].distanceBand, undefined);
  await assert.rejects(f.api.call('updateProfile', { residenceSharing: true, residenceCell: cell }), { code: 'RESIDENCE_CHANGE_LIMIT' });
  await f.api.call('updateProfile', { neighborVisible: false });
  assert.equal((await f.api.call('bootstrap')).user.residenceSharing, false);
  await f.api.call('deleteAccount');
  const restarted = (await f.api.call('bootstrap')).user;
  assert.equal(restarted.neighborVisible, false); assert.equal(restarted.residenceCell, null);
});

test('demo message notifications reflect real local actions and repeated toggles retain read state', async () => {
  const f = await fixture();
  await f.api.call('likePost', { id: 'demo-post-1', like: true });
  await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: true });
  await f.api.call('followUser', { userId: 'demo-lin', follow: true });
  await f.as('demo-lin');
  const first = await f.api.call('listMessages');
  assert.equal(first.items.length, 3);
  assert.deepEqual(first.categoryUnread, { interactions: 2, comments: 0, follows: 1, system: 0 });
  assert.equal(first.items.find(item => item.kind === 'follow').targetId, 'demo-self');
  assert.equal(first.items.find(item => item.kind === 'like').cover, '/assets/story-cat.png');
  assert.deepEqual(Object.keys(first.items[0].actor).sort(), ['avatar', 'id', 'nickname']);
  assert.equal((await f.api.call('readMessage', { all: true })).unreadCount, 0);
  await f.as('demo-self'); f.tick();
  for (const [action, key] of [['likePost', 'like'], ['bookmarkPost', 'bookmark']]) {
    await f.api.call(action, { id: 'demo-post-1', [key]: false });
    await f.api.call(action, { id: 'demo-post-1', [key]: true });
  }
  await f.api.call('followUser', { userId: 'demo-lin', follow: false });
  await f.api.call('followUser', { userId: 'demo-lin', follow: true });
  await f.as('demo-lin');
  const again = await f.api.call('listMessages');
  assert.equal(again.items.length, 3); assert.equal(again.unreadCount, 0);
  assert.deepEqual(again.items.map(item => [item.id, item.createdAt]), first.items.map(item => [item.id, item.createdAt]));
  await f.api.call('likePost', { id: 'demo-post-1', like: true });
  await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: true });
  assert.equal((await f.api.call('listMessages')).items.length, 3);
});

test('demo filters message categories before stable pagination with legacy records and global unread totals', async () => {
  const f = await fixture();
  f.edit(state => {
    state.messages = [];
    for (let index = 0; index < 65; index += 1) state.messages.push({ id: 'msg-fixture-' + String(index).padStart(3, '0'), userId: 'demo-self', kind: index % 5 === 0 ? 'like' : 'system', targetType: 'system', targetId: '', title: '测试通知', text: '', createdAt: EPOCH + index, isRead: false });
    state.messages.push({ id: 'old-post-notice', userId: 'demo-self', targetType: 'post', targetId: 'deleted-post', title: '旧留言', text: '', createdAt: EPOCH - 1, isRead: false });
    state.messages.push({ id: 'private-other-notice', userId: 'demo-lin', targetType: 'system', title: '其他账号的通知', text: '', createdAt: EPOCH + 1000, isRead: false });
  });
  let cursor; const ids = [];
  do {
    const page = await f.api.call('listMessages', { category: 'interactions', limit: 4, cursor });
    assert.equal(page.unreadCount, 65);
    assert.deepEqual(page.categoryUnread, { interactions: 13, comments: 0, follows: 0, system: 52 });
    assert.ok(page.items.every(message => message.kind === 'like'));
    ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 13); assert.equal(new Set(ids).size, 13);
  const comments = await f.api.call('listMessages', { category: 'comments' });
  assert.deepEqual(comments.items, [], 'notifications of unavailable posts are hidden');
  await assert.rejects(f.api.call('readMessage', { id: 'private-other-notice' }), { code: 'NOT_FOUND' });
  await assert.rejects(f.api.call('readMessage', { id: 'old-post-notice' }), { code: 'NOT_FOUND' });
  await f.api.call('readMessage', { all: true });
  assert.equal((await f.api.call('listMessages')).unreadCount, 0);
  await f.as('demo-lin'); assert.equal((await f.api.call('listMessages')).unreadCount, 1);
  await assert.rejects(f.api.call('listMessages', { category: 'unexpected' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('listMessages', { cursor: false }), { code: 'INVALID_INPUT' });
});

test('demo blocked notifications disappear from all categories, unread totals, and direct reads', async () => {
  const f = await fixture();
  await f.api.call('likePost', { id: 'demo-post-1', like: true });
  await f.as('demo-lin');
  const message = (await f.api.call('listMessages')).items[0];
  await f.as('demo-self');
  await f.api.call('blockUser', { userId: 'demo-lin', block: true });
  await f.as('demo-lin');
  assert.equal((await f.api.call('listMessages')).unreadCount, 0);
  assert.deepEqual((await f.api.call('listMessages', { category: 'interactions' })).items, []);
  await assert.rejects(f.api.call('readMessage', { id: message.id }), { code: 'NOT_FOUND' });
});

test('demo message search filters titles, text and public nicknames before paging without changing unread totals or records', async () => {
  const f = await fixture();
  f.edit(state => {
    Object.assign(state.users.find(user => user.id === 'demo-lin'), { nickname: 'CATBuddy', bio: 'PRIVATE_BIO', pet: { name: 'PRIVATE_PET', type: 'cat' } });
    state.messages = Array.from({ length: 26 }, (_, index) => ({
      id: 'search-' + String(index).padStart(2, '0'), userId: 'demo-self', actorId: index === 2 ? 'demo-lin' : '',
      title: index === 0 ? 'CAT [日常]' : '通知', text: index === 1 ? 'cAt 正文' : '普通正文',
      kind: index === 2 ? 'follow' : index < 2 ? 'like' : 'system', targetType: 'system', targetId: '',
      createdAt: EPOCH + Math.floor(index / 2), isRead: index === 1
    }));
    const template = { title: 'CAT隐藏通知', text: '', kind: 'system', createdAt: EPOCH + 100, isRead: false, targetType: 'system', targetId: '' };
    state.messages.push({ ...template, id: 'search-other', userId: 'demo-qiao' },
      { ...template, id: 'search-blocked', userId: 'demo-self', actorId: 'demo-qiao' },
      { ...template, id: 'search-blocked-owner', userId: 'demo-self', targetType: 'post', targetId: 'demo-post-2' });
    state.blocks.push({ userId: 'demo-qiao', blockedUserId: 'demo-self' });
  });
  const before = f.state().messages;
  const all = await f.api.call('listMessages');
  assert.equal(all.items.length, 20); assert.equal(all.unreadCount, 25);
  const ids = []; let cursor;
  do {
    const page = await f.api.call('listMessages', { query: '  CaT  ', limit: 1, cursor });
    assert.equal(page.items.length, 1);
    assert.equal(page.unreadCount, all.unreadCount); assert.deepEqual(page.categoryUnread, all.categoryUnread);
    ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, ['search-02', 'search-01', 'search-00']);
  const category = await f.api.call('listMessages', { query: 'cat', category: 'interactions' });
  assert.deepEqual(category.items.map(item => item.id), ['search-01', 'search-00']);
  assert.deepEqual(category.categoryUnread, all.categoryUnread);
  assert.deepEqual((await f.api.call('listMessages', { query: 'buddy' })).items.map(item => item.id), ['search-02']);
  assert.deepEqual((await f.api.call('listMessages', { query: '[' })).items.map(item => item.id), ['search-00']);
  for (const query of ['PRIVATE_BIO', 'PRIVATE_PET', '没有匹配', '🐱'.repeat(60)]) {
    const page = await f.api.call('listMessages', { query });
    assert.deepEqual(page.items, []); assert.equal(page.unreadCount, all.unreadCount);
  }
  assert.deepEqual(await f.api.call('listMessages', { query: ' \n ' }), all);
  for (const query of [null, 1, {}, '🐱'.repeat(61)]) await assert.rejects(f.api.call('listMessages', { query }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('listMessages', { query: '没有匹配', cursor: false }), { code: 'INVALID_INPUT' });
  assert.deepEqual(f.state().messages, before);
});

test('demo deletion removes copied actor notices and a new account lifecycle gets a fresh follow notice', async () => {
  const f = await fixture();
  await f.api.call('updateProfile', { nickname: '旧测试账号', area: '示例·梧桐里', bio: '', pet: null });
  await f.api.call('followUser', { userId: 'demo-lin', follow: true });
  await f.api.call('addComment', { targetType: 'post', targetId: 'demo-post-1', text: '注销时清理的测试留言' });
  await f.as('demo-lin');
  const before = await f.api.call('listMessages');
  const oldFollow = before.items.find(message => message.kind === 'follow');
  assert.ok(before.items.some(message => message.text.includes('旧测试账号')));
  await f.api.call('readMessage', { all: true });

  await f.as('demo-self');
  await f.api.call('deleteAccount');
  assert.ok(!f.state().messages.some(message => message.actorId === 'demo-self' || message.userId === 'demo-self'));
  await f.as('demo-lin');
  assert.deepEqual((await f.api.call('listMessages')).items, []);

  f.tick();
  f.edit(state => { state.currentUserId = 'demo-self'; });
  await f.api.call('bootstrap');
  await f.as('demo-self');
  await f.api.call('followUser', { userId: 'demo-lin', follow: true });
  await f.as('demo-lin');
  const after = await f.api.call('listMessages');
  assert.equal(after.items.length, 1);
  assert.equal(after.categoryUnread.follows, 1);
  assert.notEqual(after.items[0].id, oldFollow.id);
  assert.ok(after.items[0].createdAt > oldFollow.createdAt);
  assert.equal(after.items[0].actor.nickname, '新来的邻居');
});

async function fixture(initialState) {
  let time = EPOCH;
  const savedFiles = new Set();
  const values = new Map([[STORAGE_KEY, clone(initialState || createSeed(EPOCH))]]);
  const platform = {
    getStorageSync(key) { return values.has(key) ? clone(values.get(key)) : ''; },
    setStorageSync(key, value) { values.set(key, clone(value)); },
    getSavedFileList({ success }) { success({ fileList: [...savedFiles].map(filePath => ({ filePath })) }); }
  };
  const service = () => createDemoService(platform, { now: () => time });
  const api = service();
  await api.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  return {
    api, service,
    state() { return platform.getStorageSync(STORAGE_KEY); },
    edit(change) { const state = this.state(); change(state); platform.setStorageSync(STORAGE_KEY, state); },
    async as(userId) { this.edit(state => { state.currentUserId = userId; }); await api.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } }); },
    tick() { time += 1; },
    save(fileId) { savedFiles.add(fileId); }
  };
}

async function post(f, fields) {
  return (await f.api.call('createPost', Object.assign({ circleId: 'circle-neighbors', text: '一条真实由自己写下的本机日常', images: [] }, fields))).post;
}

async function image(f, name) {
  const ticket = await f.api.call('createUploadTicket', { extension: 'png' });
  return (await f.api.call('completeUpload', { ticketId: ticket.ticketId, fileId: 'wxfile://saved-' + name + '.png' })).fileId;
}

test('isolated v2 fixture exercises fixed topics and all content kinds without seeded social counts', async () => {
  const f = await fixture();
  assert.deepEqual(TOPICS, ['饮食喂养', '行为观察', '健康护理', '居家布置', '户外出行', '成长记录', '治愈瞬间', '陪伴日常']);
  const boot = await f.api.call('bootstrap');
  assert.equal(boot.user.publicProfile, false);
  assert.equal(boot.stats.bookmarkCount, 0);
  assert.equal(boot.stats.followingCount, 0);
  const posts = (await f.api.call('listPosts')).items;
  assert.equal(posts.length, 8);
  assert.deepEqual(new Set(posts.map(item => item.kind)), new Set(['daily', 'question', 'meetup']));
  assert.ok(posts.every(item => item.title && item.topics.length && item.topics.every(topic => TOPICS.includes(topic))));
  assert.ok(posts.every(item => item.likeCount === 0 && !item.isLiked && !item.isBookmarked));
  assert.equal(posts.filter(item => item.event).length, 2);
  assert.ok((await f.api.call('listMessages')).items[0].title.includes('有宠有邻'));
});

test('v1 migration keeps user content, dates, deleted seeds and private profiles intact', async () => {
  const old = createSeed(EPOCH - 86400000);
  delete old.likes; delete old.bookmarks; delete old.follows;
  old.users.forEach(user => { delete user.publicProfile; });
  old.users.find(user => user.id === 'demo-self').nickname = '已经设置的昵称';
  old.users.find(user => user.id === 'demo-self').bio = '并未同意公开的介绍';
  old.posts = old.posts.filter(item => item.id !== 'demo-post-3');
  old.posts.forEach(item => { delete item.title; delete item.kind; delete item.topics; delete item.coverIndex; delete item.eventId; });
  old.posts[0].text = '原有内容不可被升级覆盖';
  old.posts.push({ id: 'old-own-post', authorId: 'demo-self', circleId: 'circle-neighbors', text: '我在旧版写下的日常', images: [], createdAt: EPOCH - 100 });
  old.messages[0].title = '欢迎来到有伴 · 本机演示';
  old.messages[0].text = '有宠欢迎所有爱宠人士，暂时没有宠物也能来。';
  old.messages[0].isRead = true;
  const f = await fixture(old);
  const boot = await f.api.call('bootstrap');
  assert.equal(STORAGE_KEY, 'youban.demo.v1');
  assert.equal(f.state().version, 1);
  assert.equal(f.state().seedAt, old.seedAt);
  assert.equal(boot.user.nickname, '已经设置的昵称');
  assert.equal(boot.user.bio, '并未同意公开的介绍');
  assert.equal(boot.user.publicProfile, false);
  assert.ok(f.state().users.every(user => user.publicProfile === false));
  assert.ok(!f.state().posts.some(item => item.id === 'demo-post-3'));
  const prior = (await f.api.call('getPost', { id: 'old-own-post' })).post;
  assert.equal(prior.text, '我在旧版写下的日常');
  assert.equal(prior.title, '');
  assert.equal(prior.kind, 'daily');
  assert.deepEqual(prior.topics, []);
  assert.equal(prior.coverIndex, 0);
  assert.equal((await f.api.call('getPost', { id: 'demo-post-1' })).post.text, '原有内容不可被升级覆盖');
  assert.equal((await f.api.call('listMessages')).unreadCount, 0);
  assert.ok(f.state().messages[0].title.includes('有宠有邻'));
  assert.equal(f.state().messages[0].text, '有宠有邻欢迎所有爱宠人士，暂时没有宠物也能来。');
  const after = f.state();
  await f.service().call('bootstrap');
  assert.deepEqual(f.state(), after);
});

test('post metadata validates title, topics, content kind, cover and activity visibility', async () => {
  const f = await fixture();
  const images = [await image(f, 'one'), await image(f, 'two')];
  const item = await post(f, { title: '窗边的治愈时刻', kind: 'daily', topics: ['宠物治愈时刻', '养宠经验'], images, coverIndex: 1, eventId: 'demo-event-coffee' });
  assert.equal(item.cover, images[1]);
  assert.equal(item.coverIndex, 1);
  assert.equal(item.event.id, 'demo-event-coffee');
  assert.deepEqual(Object.keys(item.event).sort(), ['id', 'location', 'petPolicy', 'startAt', 'status', 'title']);
  assert.equal((await f.service().call('getPost', { id: item.id })).post.title, '窗边的治愈时刻');
  for (const invalid of [
    { title: '字'.repeat(41) }, { kind: 'unsupported' }, { topics: ['不存在的话题'] },
    { topics: TOPICS.slice(0, 4) }, { coverIndex: 1 }, { images, coverIndex: 2 },
    { images, coverIndex: -1 }, { images, coverIndex: 0.5 }, { topics: '新手养宠' }
  ]) await assert.rejects(post(f, invalid), { code: 'INVALID_INPUT' });
  await assert.rejects(post(f, { title: '只有标题', text: '', images: [] }), { code: 'INVALID_INPUT' });
  await assert.rejects(post(f, { eventId: 'missing-event' }), { code: 'NOT_FOUND' });
  const deduplicated = await post(f, { topics: ['新手养宠', '新手养宠'] });
  assert.deepEqual(deduplicated.topics, ['健康护理']);
  await f.api.call('blockUser', { userId: 'demo-he', block: true });
  const hiddenEvent = (await f.api.call('getPost', { id: item.id })).post;
  assert.equal(hiddenEvent.event, null);
  assert.equal(hiddenEvent.eventId, '');
  assert.equal(f.state().posts.find(post => post.id === item.id).eventId, 'demo-event-coffee');
  await assert.rejects(post(f, { eventId: 'demo-event-coffee' }), { code: 'NOT_FOUND' });
});

test('linked events reflect cancellation and safely become null when removed', async () => {
  const f = await fixture();
  await f.api.call('cancelEvent', { id: 'demo-event-coffee', reason: '本机演示取消' });
  const item = await post(f, { kind: 'meetup', eventId: 'demo-event-coffee' });
  assert.equal(item.event.status, 'cancelled');
  f.edit(state => { state.events = state.events.filter(event => event.id !== 'demo-event-coffee'); });
  const removedEvent = (await f.api.call('getPost', { id: item.id })).post;
  assert.equal(removedEvent.event, null);
  assert.equal(removedEvent.eventId, '');
  assert.equal(f.state().posts.find(post => post.id === item.id).eventId, 'demo-event-coffee');
});

test('null cursors are equivalent to omitted cursors across paged demo actions', async () => {
  const f = await fixture();
  await f.api.call('followUser', { userId: 'demo-lin', follow: true });
  for (const action of ['listPosts', 'listFollowing', 'listReports']) {
    assert.deepEqual(await f.api.call(action, { cursor: null }), await f.api.call(action));
  }
  assert.deepEqual(await f.api.call('getUserProfile', { userId: 'demo-lin', cursor: null }), await f.api.call('getUserProfile', { userId: 'demo-lin' }));
});

test('like and bookmark retries are idempotent and persist without invented notifications', async () => {
  const f = await fixture();
  const before = (await f.api.call('listMessages')).items.length;
  const liked = await f.api.call('likePost', { id: 'demo-post-1', like: true });
  assert.equal(liked.post.likeCount, 1);
  assert.equal(liked.post.isLiked, true);
  await f.api.call('likePost', { id: 'demo-post-1', like: true });
  await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: true });
  await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: true });
  const restarted = (await f.service().call('getPost', { id: 'demo-post-1' })).post;
  assert.equal(restarted.likeCount, 1);
  assert.equal(restarted.isBookmarked, true);
  assert.equal((await f.api.call('bootstrap')).stats.bookmarkCount, 1);
  assert.deepEqual((await f.api.call('listPosts', { bookmarked: true })).items.map(item => item.id), ['demo-post-1']);
  assert.equal((await f.api.call('listMessages')).items.length, before);
  await f.api.call('likePost', { id: 'demo-post-1', like: false });
  await f.api.call('likePost', { id: 'demo-post-1', like: false });
  await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: false });
  assert.equal((await f.api.call('getPost', { id: 'demo-post-1' })).post.likeCount, 0);
  assert.equal((await f.api.call('bootstrap')).stats.bookmarkCount, 0);
  await assert.rejects(f.api.call('likePost', { id: 'demo-post-1', like: 'true' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('bookmarkPost', { id: 'demo-post-1' }), { code: 'INVALID_INPUT' });
});

test('feeds and search combine literal matching with topic, circle, author and bookmark filters', async () => {
  const f = await fixture();
  assert.equal((await f.api.call('listPosts', { feed: 'following' })).items.length, 0);
  const circles = (await f.api.call('listPosts', { feed: 'circles' })).items;
  assert.ok(circles.length > 0 && circles.every(item => item.circle.id === 'circle-neighbors'));
  await f.api.call('followUser', { userId: 'demo-lin', follow: true });
  await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: true });
  const filtered = await f.api.call('listPosts', { feed: 'following', authorId: 'demo-lin', circleId: 'circle-cats', topic: '宠物治愈时刻', query: '晒太阳', bookmarked: true });
  assert.deepEqual(filtered.items.map(item => item.id), ['demo-post-1']);
  assert.equal((await f.api.call('listPosts', { feed: 'following', mine: true })).items.length, 0);
  const custom = await post(f, { title: 'ABC [cat].*', topics: ['新手养宠'] });
  assert.deepEqual((await f.api.call('listPosts', { query: 'abc [CAT].*', authorId: 'demo-self' })).items.map(item => item.id), [custom.id]);
  assert.equal((await f.api.call('listPosts', { query: '^ABC' })).items.length, 0);
  assert.ok((await f.api.call('listPosts', { query: '新手养宠' })).items.some(item => item.id === custom.id));
  await assert.rejects(f.api.call('listPosts', { query: '字'.repeat(61) }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('listPosts', { topic: '随机话题' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('listPosts', { feed: 'popular' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('listPosts', { bookmarked: 'true' }), { code: 'INVALID_INPUT' });
});

test('following and profiles paginate, follow retries keep counts stable', async () => {
  const f = await fixture();
  await f.api.call('bootstrap');
  f.edit(state => {
    for (let index = 0; index < 23; index += 1) state.users.push({ id: 'test-person-' + index, nickname: '测试人物' + index, avatar: '', area: 'private area', bio: '', pet: null, publicProfile: false, isAdmin: false });
  });
  for (let index = 0; index < 23; index += 1) {
    await f.api.call('followUser', { userId: 'test-person-' + index, follow: true });
    f.tick();
  }
  await f.api.call('followUser', { userId: 'test-person-0', follow: true });
  assert.equal((await f.api.call('bootstrap')).stats.followingCount, 23);
  const first = await f.api.call('listFollowing');
  const second = await f.service().call('listFollowing', { cursor: first.nextCursor });
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 3);
  assert.ok(first.items.every(user => Object.keys(user).sort().join(',') === 'avatar,id,nickname'));
  assert.equal((await f.api.call('getUserProfile', { userId: 'test-person-0' })).user.followerCount, 1);
  await f.api.call('followUser', { userId: 'test-person-0', follow: false });
  assert.equal((await f.api.call('getUserProfile', { userId: 'test-person-0' })).user.followerCount, 0);
  assert.equal((await f.api.call('bootstrap')).stats.followingCount, 22);
  await assert.rejects(f.api.call('followUser', { userId: 'demo-self', follow: true }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('followUser', { userId: 'missing-user', follow: true }), { code: 'NOT_FOUND' });
  for (let index = 0; index < 23; index += 1) { await post(f, { text: '分页日常 ' + index }); f.tick(); }
  const profile = await f.api.call('getUserProfile', { userId: 'demo-self' });
  assert.equal(profile.user.postCount, 23);
  assert.equal(profile.posts.length, 20);
  const more = await f.api.call('getUserProfile', { userId: 'demo-self', cursor: profile.nextCursor });
  assert.equal(more.posts.length, 3);
  assert.equal(new Set(profile.posts.concat(more.posts).map(item => item.id)).size, 23);
});

test('private profiles expose public posts but never area, and omitted setting retains consent', async () => {
  const f = await fixture();
  const fields = { nickname: '我的昵称', area: '示例·梧桐里', bio: '仅在主动公开时展示', pet: { name: '小猫', type: 'cat' } };
  await f.api.call('updateProfile', fields);
  await post(f);
  const self = (await f.api.call('getUserProfile', { userId: 'demo-self' })).user;
  assert.equal(self.bio, fields.bio);
  assert.deepEqual(self.pet, fields.pet);
  assert.equal(self.isMine, true);
  assert.equal('area' in self, false);
  await f.as('demo-lin');
  const privateProfile = await f.api.call('getUserProfile', { userId: 'demo-self' });
  assert.equal(privateProfile.user.bio, '');
  assert.equal(privateProfile.user.pet, null);
  assert.equal(privateProfile.user.publicProfile, false);
  assert.equal(privateProfile.posts.length, 1);
  assert.equal('area' in privateProfile.user, false);
  await f.as('demo-self');
  await f.api.call('updateProfile', Object.assign({}, fields, { publicProfile: true }));
  await f.api.call('updateProfile', Object.assign({}, fields, { nickname: '只改名字不改变同意' }));
  assert.equal((await f.service().call('bootstrap')).user.publicProfile, true);
  await f.as('demo-lin');
  const publicProfile = (await f.api.call('getUserProfile', { userId: 'demo-self' })).user;
  assert.equal(publicProfile.bio, fields.bio);
  assert.deepEqual(publicProfile.pet, fields.pet);
  assert.equal('area' in publicProfile, false);
  await f.as('demo-self');
  await assert.rejects(f.api.call('updateProfile', Object.assign({}, fields, { publicProfile: 'yes' })), { code: 'INVALID_INPUT' });
});

test('blocking clears reciprocal follows, likes and bookmarks, including reverse visibility', async () => {
  const f = await fixture();
  const mine = await post(f);
  await f.api.call('followUser', { userId: 'demo-lin', follow: true });
  await f.api.call('likePost', { id: 'demo-post-1', like: true });
  await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: true });
  await f.as('demo-lin');
  await f.api.call('followUser', { userId: 'demo-self', follow: true });
  await f.api.call('likePost', { id: mine.id, like: true });
  await f.api.call('bookmarkPost', { id: mine.id, bookmark: true });
  await f.as('demo-self');
  await f.api.call('blockUser', { userId: 'demo-lin', block: true });
  assert.equal(f.state().follows.length, 0);
  assert.equal(f.state().likes.length, 0);
  assert.equal(f.state().bookmarks.length, 0);
  assert.equal((await f.api.call('bootstrap')).stats.bookmarkCount, 0);
  await assert.rejects(f.api.call('getUserProfile', { userId: 'demo-lin' }), { code: 'NOT_FOUND' });
  await assert.rejects(f.api.call('followUser', { userId: 'demo-lin', follow: true }), { code: 'NOT_FOUND' });
  await assert.rejects(f.api.call('likePost', { id: 'demo-post-1', like: true }), { code: 'NOT_FOUND' });
  assert.equal((await f.api.call('listPosts', { authorId: 'demo-lin' })).items.length, 0);
  await f.as('demo-lin');
  await assert.rejects(f.api.call('getUserProfile', { userId: 'demo-self' }), { code: 'NOT_FOUND' });
  await assert.rejects(f.api.call('followUser', { userId: 'demo-self', follow: true }), { code: 'NOT_FOUND' });
  assert.equal((await f.api.call('listPosts', { authorId: 'demo-self' })).items.length, 0);
  await f.as('demo-self');
  await f.api.call('blockUser', { userId: 'demo-lin', block: false });
  assert.equal((await f.api.call('getUserProfile', { userId: 'demo-lin' })).user.isFollowing, false);
  assert.equal((await f.api.call('getPost', { id: 'demo-post-1' })).post.isBookmarked, false);
});

test('deleting posts and accounts cleans relationship counts across users and restarts', async () => {
  const f = await fixture();
  const mine = await post(f);
  await f.api.call('likePost', { id: mine.id, like: true });
  await f.api.call('bookmarkPost', { id: mine.id, bookmark: true });
  await f.as('demo-lin');
  await f.api.call('bookmarkPost', { id: mine.id, bookmark: true });
  await f.as('demo-self');
  await f.api.call('deletePost', { id: mine.id });
  assert.equal(f.state().likes.length, 0);
  assert.equal(f.state().bookmarks.length, 0);
  const next = await post(f);
  await f.api.call('followUser', { userId: 'demo-lin', follow: true });
  await f.api.call('likePost', { id: 'demo-post-1', like: true });
  await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: true });
  await f.as('demo-lin');
  await f.api.call('followUser', { userId: 'demo-self', follow: true });
  await f.api.call('likePost', { id: next.id, like: true });
  await f.api.call('bookmarkPost', { id: next.id, bookmark: true });
  await f.as('demo-self');
  await f.api.call('deleteAccount');
  assert.equal(f.state().follows.length, 0);
  assert.equal(f.state().likes.length, 0);
  assert.equal(f.state().bookmarks.length, 0);
  const restarted = await f.service().call('bootstrap');
  assert.equal(restarted.user.publicProfile, false);
  assert.equal(restarted.stats.bookmarkCount, 0);
  assert.equal(restarted.stats.followingCount, 0);
  assert.equal((await f.api.call('getUserProfile', { userId: 'demo-self' })).user.followerCount, 0);
});

test('animal tags validate independently from pet profiles and filter before demo pagination', async () => {
  const f = await fixture();
  const bird = await post(f, { text: '观察羽毛', animalTypes: ['bird', 'bird'] });
  assert.deepEqual(bird.animalTypes, ['bird']);
  assert.deepEqual(f.state().posts.find(item => item.id === bird.id).animalTypes, ['bird']);
  for (const animalTypes of [null, 'cat', ['dragon'], ['unclassified'], ['cat', 'dog', 'fish', 'bird']]) await assert.rejects(post(f, { animalTypes }), { code: 'INVALID_INPUT' });
  const legacy = f.state().posts.find(item => item.authorId === 'demo-lin');
  assert.deepEqual((await f.api.call('getPost', { id: legacy.id })).post.animalTypes, []);
  f.edit(state => {
    state.posts.push(...Array.from({ length: 45 }, (_, index) => ({
      id: 'animal-filter-' + index, authorId: 'demo-self', circleId: 'circle-neighbors', title: '水族观察', text: '测试 ' + index,
      topics: ['行为观察'], animalTypes: index < 23 ? ['fish'] : ['dog'], images: [], createdAt: EPOCH + index + 1
    })));
  });
  const first = await f.api.call('listPosts', { animalType: 'fish', excludedAnimalTypes: ['dog'] });
  assert.equal(first.items.length, 20);
  assert.ok(first.items.every(item => item.animalTypes.includes('fish')));
  const second = await f.api.call('listPosts', { animalType: 'fish', excludedAnimalTypes: ['dog'], cursor: first.nextCursor });
  assert.equal(second.items.length, 3);
  assert.equal(new Set(first.items.concat(second.items).map(item => item.id)).size, 23);
  assert.deepEqual((await f.api.call('listPosts', { animalType: 'fish', excludedAnimalTypes: ['fish'] })).items, []);
  const unknown = await f.api.call('listPosts', { animalType: 'unclassified' });
  assert.ok(unknown.items.some(item => item.id === legacy.id));
  assert.ok(unknown.items.every(item => item.animalTypes.length === 0));
  for (const payload of [{ animalType: 'dragon' }, { animalType: null }, { excludedAnimalTypes: 'cat' }, { excludedAnimalTypes: ['unclassified'] }, { excludedAnimalTypes: Array(11).fill('cat') }]) await assert.rejects(f.api.call('listPosts', payload), { code: 'INVALID_INPUT' });
});

test('circle migration adds missing circles without losing existing memberships, posts or custom circles', async () => {
  const old = createSeed(EPOCH);
  const originalMemberIds = old.circles.map(circle => [circle.id, clone(circle.memberIds)]);
  old.circles.push({ id: 'custom-circle', name: '自己的圈子', memberIds: ['demo-self'] });
  const originalPostIds = old.posts.map(post => post.id);
  const f = await fixture(old);
  assert.equal(f.state().circles.length, 9);
  for (const [id, members] of originalMemberIds) assert.deepEqual(f.state().circles.find(circle => circle.id === id).memberIds, members);
  assert.deepEqual(f.state().posts.map(post => post.id), originalPostIds);
  assert.equal(f.state().circles.find(circle => circle.id === 'custom-circle').name, '自己的圈子');
  assert.ok(f.state().circles.filter(circle => ['circle-small-pets', 'circle-birds', 'circle-aquatics', 'circle-exotics', 'circle-beginners'].includes(circle.id)).every(circle => circle.memberIds.length === 0));
});

test('legacy topic inputs map to canonical labels while original stored posts remain intact', async () => {
  const f = await fixture();
  const legacyId = f.state().posts[0].id;
  const storedBefore = clone(f.state().posts[0].topics);
  const created = await post(f, { topics: ['一起散步', '宠物友好去处', '户外出行'] });
  assert.deepEqual(created.topics, ['户外出行']);
  assert.deepEqual(f.state().posts.find(item => item.id === created.id).topics, ['户外出行']);
  assert.deepEqual((await f.api.call('getPost', { id: legacyId })).post.topics, TOPICS.normalize(storedBefore));
  assert.deepEqual(f.state().posts.find(item => item.id === legacyId).topics, storedBefore);
  for (const topic of ['一起散步', '户外出行']) assert.ok((await f.api.call('listPosts', { topic })).items.some(item => item.id === created.id));
  for (const topics of [['toString'], ['__proto__'], [{}]]) await assert.rejects(post(f, { topics }), { code: 'INVALID_INPUT' });
});

test('demo video publishing is disabled even for saved device files and legacy tickets', async () => {
  const f = await fixture();
  await assert.rejects(f.api.call('createUploadTicket', { mediaType: 'video', extension: 'mp4' }), { code: 'VIDEO_DISABLED' });
  const fileId = 'wxfile://saved-video.mp4'; f.save(fileId);
  f.edit(state => state.uploads.push({ ticketId: 'legacy-video', fileId, userId: 'demo-self', mediaType: 'video', status: 'complete', video: { url: fileId, durationSeconds: 9 } }));
  const before = clone(f.state().uploads);
  await assert.rejects(f.api.call('completeUpload', { ticketId: 'legacy-video', fileId }), { code: 'VIDEO_DISABLED' });
  await assert.rejects(f.api.call('getUploadStatus', { ticketId: 'legacy-video' }), { code: 'VIDEO_DISABLED' });
  await assert.rejects(post(f, { video: { url: fileId } }), { code: 'VIDEO_DISABLED' });
  await assert.rejects(post(f, { contentType: 'video' }), { code: 'VIDEO_DISABLED' });
  assert.deepEqual(f.state().uploads, before);
});

test('circle and author browsing apply exclusions before pagination while personal records and details remain accessible', async () => {
  const f = await fixture();
  f.edit(state => {
    state.posts = Array.from({ length: 45 }, (_, index) => ({ id: 'hidden-demo-' + index, authorId: 'demo-self', circleId: 'circle-neighbors',
      title: '', text: '独立的测试内容 ' + index, topics: [], images: [], animalTypes: index < 23 ? ['bird'] : ['reptile'], createdAt: EPOCH + index }));
  });
  for (const [action, base] of [['getCircle', { id: 'circle-neighbors' }], ['getUserProfile', { userId: 'demo-self' }]]) {
    const first = await f.api.call(action, { ...base, excludedAnimalTypes: ['reptile'] });
    assert.equal(first.posts.length, 20); assert.ok(first.posts.every(post => !post.animalTypes.includes('reptile')));
    const second = await f.api.call(action, { ...base, excludedAnimalTypes: ['reptile'], cursor: first.nextCursor });
    assert.equal(second.posts.length, 3); assert.equal(new Set(first.posts.concat(second.posts).map(post => post.id)).size, 23);
    await assert.rejects(f.api.call(action, { ...base, excludedAnimalTypes: ['unknown'] }), { code: 'INVALID_INPUT' });
  }
  await f.api.call('bookmarkPost', { id: 'hidden-demo-44', bookmark: true });
  assert.ok((await f.api.call('listPosts', { mine: true })).items.some(post => post.id === 'hidden-demo-44'));
  assert.ok((await f.api.call('listPosts', { bookmarked: true })).items.some(post => post.id === 'hidden-demo-44'));
  assert.equal((await f.api.call('getPost', { id: 'hidden-demo-44' })).post.text, '独立的测试内容 44');
});
