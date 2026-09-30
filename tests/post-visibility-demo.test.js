'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoService } = require('../miniprogram/services/demo');
const { createSeed, newUser } = require('./helpers/community-fixture');

// These clients share only this test's in-memory snapshot, never app storage.
const KEY = 'post-visibility-memory';
const consent = { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' };
async function fixture() {
  let time = Date.UTC(2026, 8, 30), saved = createSeed(time), failWrites = false;
  const clients = {};
  for (const who of ['alice', 'bob', 'charlie', 'admin']) {
    saved.users.push({ ...newUser(who, who === 'admin'), nickname: '仅内存测试-' + who });
    clients[who] = createDemoService({
      getStorageSync(key) { assert.equal(key, KEY); return { ...structuredClone(saved), currentUserId: who }; },
      setStorageSync(key, value) { assert.equal(key, KEY); if (failWrites) throw Error('仅内存保存失败'); saved = structuredClone(value); }
    }, { storageKey: KEY, now: () => time });
  }
  const call = (who, action, payload) => clients[who].call(action, payload);
  for (const who of Object.keys(clients)) {
    await call(who, 'demoVerifyIdentity', { consent });
    await call(who, 'joinCircle', { id: 'circle-neighbors', join: true });
  }
  return {
    call, state: () => structuredClone(saved), edit: change => change(saved), failWrites: value => { failWrites = value; },
    async post(visibility, extra = {}) {
      time += 1;
      return (await call('alice', 'createPost', { circleId: 'circle-neighbors', title: '仅内存范围测试', text: '仅内存范围正文', topics: ['一起散步'], images: [], ...(visibility === undefined ? {} : { visibility }), ...extra })).post;
    },
    async befriend(left = 'alice', right = 'bob') {
      await call(left, 'sendFriendRequest', { targetId: right });
      const request = (await call(right, 'getFriendHub')).incoming.find(item => item.from.id === left);
      await call(right, 'respondFriendRequest', { requestId: request.id, accept: true });
    }
  };
}
const ids = rows => rows.map(row => row.id).sort();
const reject = (promise, code = 'NOT_FOUND') => assert.rejects(promise, { code });

test('old posts and omitted input remain public; invalid visibility is rejected without writes', async () => {
  const f = await fixture();
  assert.equal((await f.call('bob', 'getPost', { id: 'demo-post-1' })).post.visibility, 'public');
  const post = await f.post();
  assert.equal(post.visibility, 'public');
  assert.equal(f.state().posts.find(item => item.id === post.id).visibility, 'public');
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.id, post.id);
  const before = f.state();
  for (const visibility of [null, '', 'followers', 'PUBLIC', false, 1, [], {}]) {
    await reject(f.call('alice', 'createPost', { circleId: 'circle-neighbors', text: '仅内存', images: [], visibility }), 'INVALID_INPUT');
    await reject(f.call('alice', 'setPostVisibility', { id: post.id, visibility }), 'INVALID_INPUT');
  }
  await reject(f.call('alice', 'setPostVisibility', { id: post.id }), 'INVALID_INPUT');
  await reject(f.call('alice', 'setPostVisibility', { id: post.id, visibility: 'private', authorId: 'bob' }), 'INVALID_INPUT');
  assert.deepEqual(f.state(), before);
  f.edit(state => { state.posts.find(item => item.id === post.id).visibility = 'damaged-value'; });
  assert.equal((await f.call('alice', 'getPost', { id: post.id })).post.visibility, 'private');
  await reject(f.call('bob', 'getPost', { id: post.id }));
});

test('only accepted friends can read friends posts; following and pending requests grant no access', async () => {
  const f = await fixture();
  const publicPost = await f.post('public'), friendsPost = await f.post('friends'), privatePost = await f.post('private');
  await f.call('bob', 'followUser', { userId: 'alice', follow: true });
  await f.call('bob', 'sendFriendRequest', { targetId: 'alice' });
  await reject(f.call('bob', 'getPost', { id: friendsPost.id }));
  assert.deepEqual(ids((await f.call('bob', 'getUserProfile', { userId: 'alice' })).posts), [publicPost.id]);
  const request = (await f.call('alice', 'getFriendHub')).incoming[0];
  await f.call('alice', 'respondFriendRequest', { requestId: request.id, accept: true });
  assert.equal((await f.call('bob', 'getPost', { id: friendsPost.id })).post.visibility, 'friends');
  await reject(f.call('bob', 'getPost', { id: privatePost.id }));
  await f.call('charlie', 'followUser', { userId: 'alice', follow: true });
  for (const viewer of ['charlie', 'admin']) {
    await reject(f.call(viewer, 'getPost', { id: friendsPost.id }));
    await reject(f.call(viewer, 'getPost', { id: privatePost.id }));
  }
  const own = await f.call('alice', 'getUserProfile', { userId: 'alice' });
  assert.deepEqual(ids(own.posts), ids([publicPost, friendsPost, privatePost]));
  assert.equal(own.user.postCount, 3);
  assert.equal((await f.call('bob', 'getUserProfile', { userId: 'alice' })).user.postCount, 2);
  assert.equal((await f.call('charlie', 'getUserProfile', { userId: 'alice' })).user.postCount, 1);
});

test('all feed, circle, search, author and bookmark intersections filter access before pagination', async () => {
  const f = await fixture();
  const publicPost = await f.post('public');
  for (let index = 0; index < 25; index += 1) await f.post(index % 2 ? 'friends' : 'private');
  await f.call('bob', 'followUser', { userId: 'alice', follow: true });
  await f.call('bob', 'bookmarkPost', { id: publicPost.id, bookmark: true });
  for (const filter of [
    { authorId: 'alice' }, { query: '仅内存范围' }, { authorId: 'alice', topic: '一起散步' },
    { authorId: 'alice', circleId: 'circle-neighbors' }, { feed: 'following' },
    { authorId: 'alice', feed: 'circles' }, { bookmarked: true }
  ]) {
    const result = await f.call('bob', 'listPosts', filter);
    assert.deepEqual(ids(result.items), [publicPost.id], JSON.stringify(filter));
    assert.equal(result.nextCursor, undefined);
  }
  const circle = await f.call('bob', 'getCircle', { id: 'circle-neighbors' });
  assert.deepEqual(ids(circle.posts.filter(item => item.author.id === 'alice')), [publicPost.id]);
  const own = await f.call('alice', 'listPosts', { mine: true });
  assert.equal(own.items.length, 20);
  assert.equal((await f.call('alice', 'listPosts', { mine: true, cursor: own.nextCursor })).items.length, 6);
  assert.equal((await f.call('bob', 'bootstrap')).stats.bookmarkCount, 1);
});

test('visibility changes are author-only, persist, and cannot replace content or survive a failed save', async () => {
  const f = await fixture();
  const post = await f.post('public');
  for (const who of ['bob', 'admin']) await reject(f.call(who, 'setPostVisibility', { id: post.id, visibility: 'private' }), 'FORBIDDEN');
  const changed = await f.call('alice', 'setPostVisibility', { id: post.id, visibility: 'private' });
  assert.equal(changed.post.visibility, 'private');
  assert.equal(changed.post.text, post.text); assert.equal(changed.post.createdAt, post.createdAt);
  await reject(f.call('bob', 'getPost', { id: post.id }));
  f.failWrites(true);
  await reject(f.call('alice', 'setPostVisibility', { id: post.id, visibility: 'public' }), 'STORAGE_UNAVAILABLE');
  f.failWrites(false);
  assert.equal((await f.call('alice', 'getPost', { id: post.id })).post.visibility, 'private');
  await f.call('alice', 'setPostVisibility', { id: post.id, visibility: 'public' });
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.visibility, 'public');
});

test('revoking friendship or narrowing a post revokes details, interactions, bookmarks and notifications', async () => {
  const f = await fixture(); await f.befriend();
  const ticket = await f.call('alice', 'createUploadTicket', { extension: 'jpg' });
  const image = 'wxfile://only-memory-private-cover.jpg';
  await f.call('alice', 'completeUpload', { ticketId: ticket.ticketId, fileId: image });
  const post = await f.post('friends', { images: [image] });
  await f.call('bob', 'bookmarkPost', { id: post.id, bookmark: true });
  await f.call('bob', 'likePost', { id: post.id, like: true });
  const { comment } = await f.call('bob', 'addComment', { targetType: 'post', targetId: post.id, text: '仅内存评论' });
  await f.call('alice', 'addComment', { targetType: 'post', targetId: post.id, replyToId: comment.id, text: 'PRIVATE_REPLY_BODY' });
  const notice = (await f.call('bob', 'listMessages')).items.find(item => item.targetId === post.id);
  assert.ok(notice.text.includes('PRIVATE_REPLY_BODY')); assert.equal(notice.cover, image);
  await f.call('alice', 'removeFriend', { targetId: 'bob' });
  for (const [action, payload] of [
    ['getPost', { id: post.id }], ['likePost', { id: post.id, like: true }],
    ['bookmarkPost', { id: post.id, bookmark: true }], ['addComment', { targetType: 'post', targetId: post.id, text: '拒绝的新评论' }],
    ['report', { targetType: 'post', targetId: post.id, reason: '不可见' }], ['report', { targetType: 'comment', targetId: comment.id, reason: '不可见' }],
    ['readMessage', { id: notice.id }]
  ]) await reject(f.call('bob', action, payload));
  assert.deepEqual((await f.call('bob', 'listPosts', { bookmarked: true })).items, []);
  assert.equal((await f.call('bob', 'bootstrap')).stats.bookmarkCount, 0);
  const hidden = await f.call('bob', 'listMessages', { query: 'PRIVATE_REPLY_BODY' });
  assert.deepEqual(hidden.items, []); assert.equal(hidden.unreadCount, 0);
  assert.equal(JSON.stringify(hidden).includes(image), false);
  await f.call('bob', 'readMessage', { all: true });
  assert.equal(f.state().messages.find(item => item.id === notice.id).isRead, false);
  await f.befriend();
  assert.equal((await f.call('bob', 'bootstrap')).stats.bookmarkCount, 1);
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.isLiked, true);
  await f.call('alice', 'setPostVisibility', { id: post.id, visibility: 'private' });
  await reject(f.call('bob', 'getPost', { id: post.id }));
  assert.equal((await f.call('bob', 'listMessages')).unreadCount, 0);
  await f.call('alice', 'addComment', { targetType: 'post', targetId: post.id, replyToId: comment.id, text: 'NOT_SENT_TO_FORMER_READER' });
  assert.equal(f.state().messages.some(item => item.text.includes('NOT_SENT_TO_FORMER_READER')), false);
  await f.call('alice', 'setPostVisibility', { id: post.id, visibility: 'public' });
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.isBookmarked, true);
});

test('blocking overrides friendship and visibility; removing the block does not recreate friendship', async () => {
  const f = await fixture(); await f.befriend();
  const post = await f.post('friends');
  await f.call('bob', 'blockUser', { userId: 'alice', block: true });
  await reject(f.call('bob', 'getPost', { id: post.id }));
  await f.call('bob', 'blockUser', { userId: 'alice', block: false });
  await reject(f.call('bob', 'getPost', { id: post.id }));
  await f.call('alice', 'setPostVisibility', { id: post.id, visibility: 'public' });
  assert.equal((await f.call('bob', 'getPost', { id: post.id })).post.visibility, 'public');
});

test('moderation summaries do not expose post or comment text after visibility is narrowed', async () => {
  const f = await fixture(); const post = await f.post('public', { text: 'PRIVATE_POST_BODY' });
  const { comment } = await f.call('bob', 'addComment', { targetType: 'post', targetId: post.id, text: 'PRIVATE_COMMENT_BODY' });
  await f.call('bob', 'report', { targetType: 'post', targetId: post.id, reason: '仅内存核查' });
  await f.call('bob', 'report', { targetType: 'comment', targetId: comment.id, reason: '仅内存核查' });
  await f.call('alice', 'setPostVisibility', { id: post.id, visibility: 'private' });
  const reports = await f.call('admin', 'listReports');
  assert.ok(reports.items.every(item => item.targetSummary === '内容已不可见'));
  assert.doesNotMatch(JSON.stringify(reports), /PRIVATE_POST_BODY|PRIVATE_COMMENT_BODY/);
});

test('deleting a hidden post or its owner cannot make old private notification bodies reappear', async () => {
  for (const action of ['deletePost', 'deleteAccount']) {
    const f = await fixture(); const post = await f.post('public');
    const { comment } = await f.call('bob', 'addComment', { targetType: 'post', targetId: post.id, text: '仅内存评论' });
    await f.call('charlie', 'addComment', { targetType: 'post', targetId: post.id, replyToId: comment.id, text: 'PRIVATE_REPLY_AFTER_DELETE' });
    assert.ok((await f.call('bob', 'listMessages')).items.some(item => item.text.includes('PRIVATE_REPLY_AFTER_DELETE')));
    await f.call('alice', 'setPostVisibility', { id: post.id, visibility: 'private' });
    await f.call('alice', action, action === 'deletePost' ? { id: post.id } : {});
    const result = await f.call('bob', 'listMessages');
    assert.equal(result.items.some(item => item.targetId === post.id), false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REPLY_AFTER_DELETE/);
  }
});
