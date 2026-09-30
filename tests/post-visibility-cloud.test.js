'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, idFor } = require('../cloudfunctions/community/service');
const { createSqliteRepository } = require('./helpers/sqlite-repository');
const catalogue = require('../cloudfunctions/community/place-catalogue');
const reject = (promise, code) => assert.rejects(promise, error => error.code === code);
const ids = items => items.map(item => item.id).sort();
const signed = file => 'https://media.example.invalid/' + encodeURIComponent(file) + '?expires=60';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(t) {
  const repository = createSqliteRepository(':memory:'); t.after(() => repository.close());
  let serial = 0;
  const effects = { signed: [], signing: null };
  const storage = { enabled: true, privateMediaEnabled: true, async remove() {}, async resolvePostMedia(files) {
    effects.signed.push(files.slice());
    if (effects.signing) await effects.signing(files);
    return Object.fromEntries(files.map(file => [file, signed(file)]));
  } };
  const service = createService({ repository, storage, now: () => 1_800_000_000_000, randomId: () => String(++serial).padStart(24, '0'), adminOpenids: ['operator'],
    runtimeConfig: { rateLimits: { createPost: { limit: 1000, windowMs: 60000 }, addComment: { limit: 1000, windowMs: 60000 } } } });
  const call = (who, action, payload = {}) => service.handle(action, payload, { openid: who });
  await call('operator', 'initialize', { city: '内存测试', areas: ['测试片区'], contact: '不连接真实服务' });
  for (const who of ['owner', 'friend', 'follower', 'stranger', 'operator']) {
    await call(who, 'bootstrap');
    await repository.set('identities', idFor(who), { status: 'phone_verified', phoneKey: 'test-' + who });
    await repository.set('phone_claims', 'test-' + who, { userId: idFor(who) });
    await call(who, 'joinCircle', { id: 'neighbors', join: true });
  }
  const create = async (visibility, extra = {}, who = 'owner') => (await call(who, 'createPost', {
    circleId: 'neighbors', text: 'VIS_SECRET_BODY', title: 'VIS_MARKER', images: [], topics: ['陪伴日常'], animalTypes: ['cat'],
    ...(visibility === undefined ? {} : { visibility }), ...extra
  })).post;
  const befriend = async (from = 'owner', to = 'friend') => {
    await call(from, 'sendFriendRequest', { targetId: idFor(to) });
    const request = (await call(to, 'getFriendHub')).incoming.find(item => item.from.id === idFor(from));
    await call(to, 'respondFriendRequest', { requestId: request.id, accept: true });
    return request.id;
  };
  const upload = async (name, video) => {
    const fileId = 'cloud://test.bucket/community/published/' + name;
    await repository.set('uploads', 'upload_' + (++serial), { ownerId: idFor('owner'), status: 'complete', fileId,
      ...(video ? { mediaType: 'video', video: { url: fileId, durationSeconds: 4, width: 300, height: 400 } } : {}) });
    return fileId;
  };
  return { repository, service, storage, call, create, befriend, upload, effects };
}

test('post visibility defaults to public, validates writes and permits only the author to change existing scope', async t => {
  const f = await fixture(t);
  const original = await f.create();
  assert.equal(original.visibility, 'public');
  assert.equal((await f.repository.get('posts', original.id)).visibility, 'public');
  for (const visibility of [null, '', 'PUBLIC', 'followers', 'circle', true, 1, {}, []]) {
    await reject(f.create(visibility), 'INVALID_INPUT');
    await reject(f.call('owner', 'setPostVisibility', { id: original.id, visibility }), 'INVALID_INPUT');
  }
  await reject(f.call('owner', 'setPostVisibility', { id: original.id }), 'INVALID_INPUT');
  await reject(f.call('owner', 'setPostVisibility', { id: original.id, visibility: 'private', title: 'cannot edit' }), 'INVALID_INPUT');
  for (const who of ['friend', 'operator']) await reject(f.call(who, 'setPostVisibility', { id: original.id, visibility: 'private' }), 'FORBIDDEN');
  const changed = await f.call('owner', 'setPostVisibility', { id: original.id, visibility: 'private' });
  assert.equal(changed.post.visibility, 'private');
  assert.equal(changed.post.text, original.text);
  await reject(f.call('operator', 'getPost', { id: original.id }), 'NOT_FOUND');
  const stored = await f.repository.get('posts', original.id);
  delete stored.visibility;
  await f.repository.set('posts', original.id, stored);
  assert.equal((await f.call('stranger', 'getPost', { id: original.id })).post.visibility, 'public');
  await f.repository.set('posts', original.id, { ...stored, visibility: 'broken-value' });
  await reject(f.call('stranger', 'getPost', { id: original.id }), 'NOT_FOUND');
  assert.equal((await f.call('owner', 'getPost', { id: original.id })).post.visibility, 'private');
});

test('all feed filters, circles and profile counts apply the same owner/friend/public access rules', async t => {
  const f = await fixture(t);
  const publicPost = await f.create('public');
  const friendsPost = await f.create('friends');
  const privatePost = await f.create('private');
  await f.befriend();
  await f.call('follower', 'followUser', { userId: idFor('owner'), follow: true });
  await f.call('friend', 'followUser', { userId: idFor('owner'), follow: true });
  for (const who of ['owner', 'friend', 'follower', 'stranger', 'operator']) {
    const expected = (who === 'owner' ? [publicPost, friendsPost, privatePost] : who === 'friend' ? [publicPost, friendsPost] : [publicPost]).map(item => item.id).sort();
    for (const filters of [{}, { feed: 'circles' }, { authorId: idFor('owner') }, { circleId: 'neighbors' }, { query: 'VIS_MARKER', topic: '陪伴日常', animalType: 'cat' }]) {
      assert.deepEqual(ids((await f.call(who, 'listPosts', filters)).items), expected, who + JSON.stringify(filters));
    }
    const profile = await f.call(who, 'getUserProfile', { userId: idFor('owner') });
    assert.equal(profile.user.postCount, expected.length);
    assert.deepEqual(ids(profile.posts), expected);
    assert.deepEqual(ids((await f.call(who, 'getCircle', { id: 'neighbors' })).posts), expected);
    for (const post of [publicPost, friendsPost, privatePost]) {
      if (expected.includes(post.id)) assert.equal((await f.call(who, 'getPost', { id: post.id })).post.id, post.id);
      else await reject(f.call(who, 'getPost', { id: post.id }), 'NOT_FOUND');
    }
  }
  assert.deepEqual(ids((await f.call('friend', 'listPosts', { feed: 'following' })).items), [publicPost.id, friendsPost.id].sort());
  assert.deepEqual(ids((await f.call('follower', 'listPosts', { feed: 'following' })).items), [publicPost.id]);
  assert.deepEqual(ids((await f.call('stranger', 'listPosts', { mine: true })).items), []);
});

test('hidden rows are filtered before pagination and bounded scans still advance', async t => {
  const f = await fixture(t); const expected = [];
  for (let index = 0; index < 30; index += 1) {
    const id = 'z_visibility_' + String(index).padStart(3, '0');
    await f.repository.set('posts', id, { authorId: idFor('owner'), circleId: 'neighbors', text: '分页', title: '', images: [], topics: [], animalTypes: [], visibility: index % 8 ? 'private' : 'public', deleted: false });
    if (index % 8 === 0) expected.unshift(id);
  }
  const found = []; let cursor;
  do {
    const page = await f.call('stranger', 'listPosts', { limit: 1, cursor });
    found.push(...page.items.map(item => item.id));
    assert.notEqual(page.nextCursor, cursor || 'never-the-first-empty-cursor');
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(found, expected);
});

test('changing scope revokes details, interactions, bookmarked lists, copied notices and report summaries', async t => {
  const f = await fixture(t); await f.befriend();
  const fileId = await f.upload('revoke.jpg');
  const post = await f.create('public', { images: [fileId] });
  for (const who of ['friend', 'follower']) {
    await f.call(who, 'likePost', { id: post.id, like: true });
    await f.call(who, 'bookmarkPost', { id: post.id, bookmark: true });
  }
  const comment = (await f.call('follower', 'addComment', { targetType: 'post', targetId: post.id, text: 'OLD_COMMENT_SECRET' })).comment;
  await f.call('owner', 'addComment', { targetType: 'post', targetId: post.id, replyToId: comment.id, text: 'REPLY_SECRET' });
  await f.call('follower', 'report', { targetType: 'comment', targetId: comment.id, reason: 'REPORTED_SECRET', description: 'QUOTED_SECRET' });
  const notice = (await f.call('follower', 'listMessages')).items.find(item => item.targetId === post.id);
  assert.ok(notice.text.includes('REPLY_SECRET'));
  assert.equal(notice.cover, signed(fileId));
  await f.call('owner', 'setPostVisibility', { id: post.id, visibility: 'friends' });
  const signingBefore = f.effects.signed.length;
  for (const [action, payload] of [
    ['getPost', { id: post.id }], ['likePost', { id: post.id, like: true }], ['likePost', { id: post.id, like: false }],
    ['bookmarkPost', { id: post.id, bookmark: true }], ['bookmarkPost', { id: post.id, bookmark: false }],
    ['addComment', { targetType: 'post', targetId: post.id, text: '不能再评论' }],
    ['report', { targetType: 'post', targetId: post.id, reason: '不可见' }],
    ['report', { targetType: 'comment', targetId: comment.id, reason: '不可见' }]
  ]) await reject(f.call('follower', action, payload), 'NOT_FOUND');
  assert.equal(f.effects.signed.length, signingBefore, 'unauthorized requests must never mint media URLs');
  assert.deepEqual((await f.call('follower', 'listPosts', { bookmarked: true })).items, []);
  assert.equal((await f.call('follower', 'bootstrap')).stats.bookmarkCount, 0);
  const inbox = await f.call('follower', 'listMessages', { query: 'SECRET' });
  assert.deepEqual(inbox.items, []); assert.equal(inbox.unreadCount, 0);
  await reject(f.call('follower', 'readMessage', { id: notice.id }), 'NOT_FOUND');
  assert.doesNotMatch(JSON.stringify(await f.call('operator', 'listReports')), /OLD_COMMENT_SECRET|REPORTED_SECRET|QUOTED_SECRET|cloud:\/\//);
  await f.repository.remove('comments', comment.id);
  assert.doesNotMatch(JSON.stringify(await f.call('operator', 'listReports')), /REPORTED_SECRET|QUOTED_SECRET/);
  assert.equal((await f.call('friend', 'getPost', { id: post.id })).post.isLiked, true);
  await f.call('owner', 'setPostVisibility', { id: post.id, visibility: 'private' });
  await reject(f.call('friend', 'getPost', { id: post.id }), 'NOT_FOUND');
  await f.call('owner', 'setPostVisibility', { id: post.id, visibility: 'public' });
  assert.equal((await f.call('follower', 'getPost', { id: post.id })).post.isBookmarked, true, 'changing scope retains existing reactions');
});

test('pending requests and followers are not friends, and removal, blocking or a new account lifecycle revoke friendship access', async t => {
  const f = await fixture(t); const post = await f.create('friends');
  await f.call('friend', 'followUser', { userId: idFor('owner'), follow: true });
  await f.call('owner', 'sendFriendRequest', { targetId: idFor('friend') });
  await reject(f.call('friend', 'getPost', { id: post.id }), 'NOT_FOUND');
  await f.befriend();
  assert.equal((await f.call('friend', 'getPost', { id: post.id })).post.visibility, 'friends');
  await f.call('friend', 'removeFriend', { targetId: idFor('owner') });
  await reject(f.call('friend', 'getPost', { id: post.id }), 'NOT_FOUND');
  await f.befriend();
  await f.call('owner', 'blockUser', { userId: idFor('friend'), block: true });
  await reject(f.call('friend', 'getPost', { id: post.id }), 'NOT_FOUND');
  await f.call('owner', 'blockUser', { userId: idFor('friend'), block: false });
  await reject(f.call('friend', 'getPost', { id: post.id }), 'NOT_FOUND');
  await f.befriend();
  const previous = await f.repository.get('users', idFor('friend'));
  await f.repository.set('users', previous._id, { ...previous, lifecycleId: 'new-lifecycle' });
  await reject(f.call('friend', 'getPost', { id: post.id }), 'NOT_FOUND');
});

test('authorized image and video responses sign every cloud attachment while preserving stored ownership IDs', async t => {
  const f = await fixture(t);
  const image = await f.upload('private.jpg');
  const photo = await f.create('private', { images: [image] });
  assert.equal(photo.mediaSigned, true);
  assert.deepEqual(photo.images, [signed(image)]); assert.equal(photo.cover, signed(image));
  assert.deepEqual((await f.repository.get('posts', photo.id)).images, [image]);
  const video = await f.upload('friends.mp4', true);
  const movie = await f.create('friends', { video: { url: video } });
  const stored = await f.repository.get('posts', movie.id);
  const poster = 'cloud://test.bucket/community/published/poster.jpg';
  await f.repository.set('posts', movie.id, { ...stored, video: { ...stored.video, poster } });
  await f.befriend();
  const result = (await f.call('friend', 'getPost', { id: movie.id })).post;
  assert.equal(result.mediaSigned, true);
  assert.equal(result.video.url, signed(video)); assert.equal(result.video.poster, signed(poster)); assert.equal(result.cover, signed(poster));
  assert.doesNotMatch(JSON.stringify(result), /cloud:\/\//);
  const before = f.effects.signed.length;
  await reject(f.call('stranger', 'getPost', { id: movie.id }), 'NOT_FOUND');
  assert.equal(f.effects.signed.length, before);
  const external = ['https://example.invalid/existing.jpg', '/assets/existing.png'];
  await f.repository.set('posts', photo.id, { ...await f.repository.get('posts', photo.id), images: external });
  const externalPost = (await f.call('owner', 'getPost', { id: photo.id })).post;
  assert.deepEqual(externalPost.images, external); assert.equal(externalPost.mediaSigned, undefined);
  assert.equal(f.effects.signed.length, before, 'existing external and packaged images do not request cloud signatures');
});

test('an in-flight media response rechecks a narrowed scope or revoked friendship before release', async t => {
  for (const change of ['scope', 'friendship']) await t.test(change, async t => {
    const f = await fixture(t); await f.befriend();
    const fileId = await f.upload('race.jpg');
    const post = await f.create(change === 'scope' ? 'public' : 'friends', { images: [fileId] });
    const waiting = deferred(); const started = deferred(); let held = false;
    f.effects.signing = async () => { if (!held) { held = true; started.resolve(); await waiting.promise; } };
    const request = f.call('friend', 'getPost', { id: post.id });
    await started.promise;
    if (change === 'scope') await f.call('owner', 'setPostVisibility', { id: post.id, visibility: 'private' });
    else await f.call('owner', 'removeFriend', { targetId: idFor('friend') });
    waiting.resolve();
    await reject(request, 'NOT_FOUND');
  });
});

test('signing outages fail closed on reads without reporting already committed publication or scope changes as failures', async t => {
  const f = await fixture(t); const fileId = await f.upload('outage.jpg');
  f.effects.signing = async () => { throw Object.assign(new Error('Signing unavailable'), { code: 'MEDIA_UNAVAILABLE' }); };
  const post = await f.create('private', { images: [fileId] });
  assert.equal(post.mediaUnavailable, true); assert.deepEqual(post.images, []); assert.equal(post.cover, '');
  assert.equal(post.mediaSigned, undefined);
  assert.doesNotMatch(JSON.stringify(post), /cloud:\/\//);
  assert.equal((await f.repository.find('posts', { authorId: idFor('owner') })).length, 1);
  await reject(f.call('owner', 'getPost', { id: post.id }), 'MEDIA_UNAVAILABLE');
  const changed = await f.call('owner', 'setPostVisibility', { id: post.id, visibility: 'friends' });
  assert.equal(changed.post.visibility, 'friends'); assert.equal(changed.post.mediaUnavailable, true);
  await reject(f.call('stranger', 'getPost', { id: post.id }), 'NOT_FOUND');
  f.effects.signing = null;
  assert.deepEqual((await f.call('owner', 'getPost', { id: post.id })).post.images, [signed(fileId)]);
});

test('nonpublic media cannot be committed until the deployment confirms private storage rules', async t => {
  const f = await fixture(t); const fileId = await f.upload('guard.jpg'); const videoId = await f.upload('guard.mp4', true);
  f.storage.privateMediaEnabled = false;
  for (const visibility of ['friends', 'private']) {
    await reject(f.create(visibility, { images: [fileId] }), 'PRIVATE_MEDIA_UNAVAILABLE');
    await reject(f.create(visibility, { video: { url: videoId } }), 'PRIVATE_MEDIA_UNAVAILABLE');
  }
  assert.deepEqual(await f.repository.find('posts'), []);
  assert.equal((await f.create('private')).visibility, 'private', 'private text works independently of cloud media configuration');
  const publicPost = await f.create('public', { images: [fileId] });
  await reject(f.call('owner', 'setPostVisibility', { id: publicPost.id, visibility: 'private' }), 'PRIVATE_MEDIA_UNAVAILABLE');
  assert.equal((await f.repository.get('posts', publicPost.id)).visibility, 'public');
  f.storage.privateMediaEnabled = true;
  assert.equal((await f.call('owner', 'setPostVisibility', { id: publicPost.id, visibility: 'private' })).post.visibility, 'private');
});

test('private posts linked to a public place do not expose the post or its private visit through place APIs', async t => {
  const f = await fixture(t); const place = catalogue.records.find(item => item.type === 'place');
  const visit = (await f.call('owner', 'recordPlaceVisit', { placeId: place.id, visitedOn: '2026-09-30', note: 'PRIVATE_VISIT_NOTE' })).visit;
  const post = await f.create('private', { placeId: place.id, visitId: visit.id });
  const own = (await f.call('owner', 'getPost', { id: post.id })).post;
  assert.equal(own.visitId, visit.id); assert.equal(own.place.id, place.id);
  assert.deepEqual((await f.call('stranger', 'listPlaceVisits')).items, []);
  const publicPlace = await f.call('stranger', 'getPlace', { id: place.id });
  assert.doesNotMatch(JSON.stringify(publicPlace), /PRIVATE_VISIT_NOTE|VIS_SECRET_BODY/);
  await reject(f.call('stranger', 'getPost', { id: post.id }), 'NOT_FOUND');
});

test('deleting a restricted post removes copied notifications so missing targets cannot reveal them later', async t => {
  const f = await fixture(t); const post = await f.create('public');
  const comment = (await f.call('follower', 'addComment', { targetType: 'post', targetId: post.id, text: '评论' })).comment;
  await f.call('owner', 'addComment', { targetType: 'post', targetId: post.id, replyToId: comment.id, text: 'DELETE_SECRET' });
  await f.call('owner', 'setPostVisibility', { id: post.id, visibility: 'private' });
  assert.deepEqual((await f.call('follower', 'listMessages')).items, []);
  await f.call('owner', 'deletePost', { id: post.id });
  assert.deepEqual(await f.repository.find('messages', { targetType: 'post', targetId: post.id }), []);
  await f.repository.remove('posts', post.id);
  assert.deepEqual((await f.call('follower', 'listMessages')).items, []);
});
