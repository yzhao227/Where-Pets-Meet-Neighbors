const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed } = require('./helpers/community-fixture');

const EPOCH = Date.UTC(2026, 8, 29, 2);
const CONSENT = { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' };
const clone = value => JSON.parse(JSON.stringify(value));

// Deliberately leaves the account unverified. Interaction fixtures in the older
// suites go through the real simulated-consent action before exercising writes.
function fixture(initialState) {
  let time = EPOCH;
  const data = new Map([[STORAGE_KEY, clone(initialState || createSeed(EPOCH))]]);
  const platform = {
    getStorageSync(key) { return data.has(key) ? clone(data.get(key)) : ''; },
    setStorageSync(key, value) { data.set(key, clone(value)); }
  };
  const service = () => createDemoService(platform, { now: () => time });
  return {
    api: service(), service,
    state() { return platform.getStorageSync(STORAGE_KEY); },
    edit(change) { const state = this.state(); change(state); platform.setStorageSync(STORAGE_KEY, state); },
    tick() { time += 1000; },
    async verify() { return this.api.call('demoVerifyIdentity', { consent: CONSENT }); }
  };
}

const PROFILE = { nickname: '本机邻居', area: '示例·梧桐里', bio: '自己的介绍', pet: { name: '小橘', type: 'cat' } };

test('isolated demo accounts disclose simulated capability and remain unverified while browsing', async () => {
  const f = fixture();
  const boot = await f.api.call('bootstrap');
  assert.deepEqual(boot.registration, { termsVersion: '2026-09-29', privacyVersion: '2026-09-29', phoneEnabled: false, policyConfigured: false });
  assert.deepEqual(boot.user.verification, { status: 'unverified' });
  assert.equal(boot.user.showPet, false);
  assert.equal(boot.user.publicProfile, false);
  assert.equal(boot.user.nickname, '新来的邻居');
  assert.equal((await f.api.call('listPosts')).items.length, 8);
  assert.equal((await f.api.call('getUserProfile', { userId: 'demo-lin' })).user.nickname, '示例·小林');
  assert.equal((await f.service().call('bootstrap')).user.verification.status, 'unverified');
  assert.ok(!JSON.stringify(boot.user).includes('phone'));
});

test('all new publishing and social writes are gated while unverified, with no side effects', async () => {
  const f = fixture();
  await f.api.call('bootstrap');
  const before = f.state();
  const writes = [
    ['createPost', { circleId: 'circle-neighbors', text: '发布前核验', images: [] }],
    ['addComment', { targetType: 'post', targetId: 'demo-post-1', text: '新增评论' }],
    ['createEvent', {}], ['updateEvent', { id: 'demo-event-coffee' }],
    ['joinCircle', { id: 'circle-cats', join: true }], ['joinEvent', { id: 'demo-event-coffee', join: true }],
    ['followUser', { userId: 'demo-lin', follow: true }], ['likePost', { id: 'demo-post-1', like: true }],
    ['bookmarkPost', { id: 'demo-post-1', bookmark: true }], ['createUploadTicket', { extension: 'png' }],
    ['completeUpload', { ticketId: 'pending', fileId: 'wxfile://pending.png' }]
  ];
  for (const [action, payload] of writes) await assert.rejects(f.api.call(action, payload), { code: 'VERIFICATION_REQUIRED' }, action);
  assert.deepEqual(f.state(), before);
});

test('consent cannot be skipped or spoofed, and repeated simulated verification is stable', async () => {
  const f = fixture();
  await f.api.call('bootstrap');
  for (const consent of [undefined, null, { ...CONSENT, accepted: false }, { ...CONSENT, termsVersion: 'old' }, { ...CONSENT, privacyVersion: 'old' }]) {
    await assert.rejects(f.api.call('demoVerifyIdentity', { consent }), { code: 'CONSENT_REQUIRED' });
  }
  const unexpected = [
    { consent: CONSENT, phone: 'not-a-real-phone' }, { consent: CONSENT, code: 'not-a-wechat-code' },
    { consent: CONSENT, verified: true }, { consent: CONSENT, verification: { status: 'phone_verified' } },
    { consent: { ...CONSENT, phone: 'not-a-real-phone' } }
  ];
  for (const payload of unexpected) await assert.rejects(f.api.call('demoVerifyIdentity', payload), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('verifyPhone', { code: 'not-a-wechat-code', phone: 'not-a-real-phone', consent: CONSENT }), { code: 'PHONE_UNAVAILABLE' });
  assert.equal((await f.api.call('bootstrap')).user.verification.status, 'unverified');
  assert.equal(f.state().users.find(user => user.id === 'demo-self').demoConsent, undefined);
  const first = await f.verify();
  assert.deepEqual(first.user.verification, { status: 'demo_verified' });
  assert.equal('demoConsent' in first.user, false);
  const saved = f.state();
  f.tick();
  assert.deepEqual(await f.service().call('demoVerifyIdentity', { consent: CONSENT }), first);
  assert.deepEqual(f.state(), saved);
  assert.ok(!JSON.stringify(f.state()).includes('not-a-real-phone'));
  assert.ok(!JSON.stringify(f.state()).includes('not-a-wechat-code'));
});

test('profile editing cannot forge verification and genuine simulated consent unlocks writes', async () => {
  const f = fixture();
  const profile = await f.api.call('updateProfile', { ...PROFILE, verification: { status: 'phone_verified' }, verified: true });
  assert.equal(profile.user.verification.status, 'unverified');
  await assert.rejects(f.api.call('createPost', { circleId: 'circle-neighbors', text: '还没核验', images: [] }), { code: 'VERIFICATION_REQUIRED' });
  await f.verify();
  const { post } = await f.api.call('createPost', { circleId: 'circle-neighbors', text: '现在可以发布', images: [] });
  assert.equal(post.author.nickname, PROFILE.nickname);
  assert.equal((await f.api.call('addComment', { targetType: 'post', targetId: post.id, text: '可以评论' })).comment.isMine, true);
  assert.equal((await f.api.call('joinCircle', { id: 'circle-cats', join: true })).circle.isJoined, true);
});

test('upgrading an existing account preserves content and home consent without assuming verification or card consent', async () => {
  const old = createSeed(EPOCH - 86400000);
  old.users.forEach(user => { delete user.verification; delete user.showPet; });
  const me = old.users.find(user => user.id === 'demo-self');
  Object.assign(me, PROFILE, { publicProfile: true });
  old.posts.push({ ...clone(old.posts[0]), id: 'old-personal-post', authorId: me.id, text: '升级前自己写的内容' });
  old.follows.push({ userId: me.id, targetUserId: 'demo-lin', createdAt: EPOCH - 1 });
  old.likes.push({ userId: me.id, postId: 'demo-post-1', createdAt: EPOCH - 1 });
  old.bookmarks.push({ userId: me.id, postId: 'demo-post-1', createdAt: EPOCH - 1 });
  old.posts = old.posts.filter(post => post.id !== 'demo-post-4');
  const f = fixture(old);
  const boot = await f.api.call('bootstrap');
  assert.equal(boot.user.verification.status, 'unverified');
  assert.equal(boot.user.publicProfile, true);
  assert.equal(boot.user.showPet, false);
  assert.deepEqual(boot.user.pet, PROFILE.pet);
  assert.equal(f.state().seedAt, old.seedAt);
  assert.equal(f.state().version, 1);
  assert.equal(f.state().follows.length, 1);
  assert.equal(f.state().bookmarks.length, 1);
  assert.ok(!f.state().posts.some(post => post.id === 'demo-post-4'));
  const ownPost = (await f.api.call('getPost', { id: 'old-personal-post' })).post;
  assert.equal(ownPost.text, '升级前自己写的内容');
  assert.equal('pet' in ownPost.author, false);
  const after = f.state();
  await f.service().call('bootstrap');
  assert.deepEqual(f.state(), after);
});

test('unverified accounts may undo past interactions, report, block, edit and delete; cancellation still requires admin', async () => {
  const f = fixture();
  await f.verify();
  const { post } = await f.api.call('createPost', { circleId: 'circle-neighbors', text: '待删除', images: [] });
  const { comment } = await f.api.call('addComment', { targetType: 'post', targetId: 'demo-post-1', text: '待删除评论' });
  await f.api.call('joinCircle', { id: 'circle-cats', join: true });
  await f.api.call('joinEvent', { id: 'demo-event-coffee', join: true });
  await f.api.call('followUser', { userId: 'demo-lin', follow: true });
  await f.api.call('likePost', { id: 'demo-post-1', like: true });
  await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: true });
  f.edit(state => { state.users.find(user => user.id === 'demo-self').verification = { status: 'unverified' }; });
  assert.equal((await f.api.call('joinCircle', { id: 'circle-cats', join: false })).circle.isJoined, false);
  assert.equal((await f.api.call('joinEvent', { id: 'demo-event-coffee', join: false })).event.isJoined, false);
  assert.equal((await f.api.call('followUser', { userId: 'demo-lin', follow: false })).isFollowing, false);
  assert.equal((await f.api.call('likePost', { id: 'demo-post-1', like: false })).post.isLiked, false);
  assert.equal((await f.api.call('bookmarkPost', { id: 'demo-post-1', bookmark: false })).post.isBookmarked, false);
  await f.api.call('deleteComment', { id: comment.id });
  await f.api.call('deletePost', { id: post.id });
  await f.api.call('report', { targetType: 'post', targetId: 'demo-post-1', reason: '本地演示报告' });
  await f.api.call('blockUser', { userId: 'demo-an', block: true });
  await f.api.call('updateProfile', PROFILE);
  await f.api.call('readMessage', { all: true });
  assert.equal((await f.api.call('cancelEvent', { id: 'demo-event-coffee', reason: '管理员补救取消' })).event.status, 'cancelled');
  f.edit(state => { state.users.find(user => user.id === 'demo-self').isAdmin = false; });
  await assert.rejects(f.api.call('cancelEvent', { id: 'demo-event-walk', reason: '不该允许' }), { code: 'FORBIDDEN' });
  await f.api.call('deleteAccount');
  const restart = await f.service().call('bootstrap');
  assert.equal(restart.user.verification.status, 'unverified');
  assert.equal(restart.user.showPet, false);
  assert.equal(f.state().users.find(user => user.id === 'demo-self').demoConsent, undefined);
});

test('pet card consent is separate from home visibility across posts, comments, following and profiles', async () => {
  const f = fixture();
  await f.verify();
  await f.api.call('updateProfile', { ...PROFILE, publicProfile: true });
  const { post } = await f.api.call('createPost', { circleId: 'circle-neighbors', text: '公共名片', images: [] });
  assert.equal('pet' in post.author, false);
  f.edit(state => { state.currentUserId = 'demo-lin'; });
  await f.verify();
  await f.api.call('followUser', { userId: 'demo-self', follow: true });
  assert.equal('pet' in (await f.api.call('listFollowing')).items[0], false);
  assert.deepEqual((await f.api.call('getUserProfile', { userId: 'demo-self' })).user.pet, PROFILE.pet);
  f.edit(state => { state.currentUserId = 'demo-self'; });
  await f.api.call('updateProfile', { ...PROFILE, publicProfile: false, showPet: true });
  await f.api.call('updateProfile', { ...PROFILE, publicProfile: false });
  assert.equal((await f.api.call('bootstrap')).user.showPet, true);
  const { comment } = await f.api.call('addComment', { targetType: 'post', targetId: post.id, text: '名片的宠物可见' });
  assert.deepEqual(comment.author.pet, PROFILE.pet);
  f.edit(state => { state.currentUserId = 'demo-lin'; });
  const profile = (await f.api.call('getUserProfile', { userId: 'demo-self' })).user;
  assert.equal(profile.bio, '');
  assert.deepEqual(profile.pet, PROFILE.pet);
  assert.equal('area' in profile, false);
  assert.equal('verification' in profile, false);
  assert.deepEqual((await f.api.call('getPost', { id: post.id })).post.author.pet, PROFILE.pet);
  assert.deepEqual((await f.api.call('listFollowing')).items[0].pet, PROFILE.pet);
  f.edit(state => { state.currentUserId = 'demo-self'; });
  await f.api.call('updateProfile', { ...PROFILE, publicProfile: false, showPet: false });
  f.edit(state => { state.currentUserId = 'demo-lin'; });
  assert.equal('pet' in (await f.api.call('getPost', { id: post.id })).post.author, false);
  assert.equal((await f.api.call('getUserProfile', { userId: 'demo-self' })).user.pet, null);
});

test('pet statistics are administrator-only aggregates of declared profiles and explicit card visibility', async () => {
  const f = fixture();
  const initial = await f.api.call('getPetStats');
  assert.deepEqual(initial, { totalUsers: 7, profilesWithPet: 4, profilesWithoutPet: 3, publicPetProfiles: 0, byType: { cat: 2, dog: 2, other: 0 }, scope: '按每个账号的首只宠物统计类型；可登记多只，未填写不代表没有宠物' });
  await f.api.call('updateProfile', { ...PROFILE, publicProfile: true, showPet: false });
  assert.equal((await f.api.call('getPetStats')).publicPetProfiles, 0);
  await f.api.call('updateProfile', { ...PROFILE, showPet: true, pet: { name: '小兔', type: 'other' } });
  const stats = await f.service().call('getPetStats');
  assert.equal(stats.profilesWithPet, 5);
  assert.equal(stats.publicPetProfiles, 1);
  assert.deepEqual(stats.byType, { cat: 2, dog: 2, other: 1 });
  assert.equal(stats.profilesWithPet + stats.profilesWithoutPet, stats.totalUsers);
  assert.ok(!JSON.stringify(stats).includes('小兔'));
  assert.ok(!JSON.stringify(stats).includes('nickname'));
  await assert.rejects(f.api.call('updateProfile', { ...PROFILE, showPet: 'true' }), { code: 'INVALID_INPUT' });
  f.edit(state => { state.users.find(user => user.id === 'demo-self').isAdmin = false; });
  await assert.rejects(f.api.call('getPetStats'), { code: 'FORBIDDEN' });
});

test('partial profile updates retain omitted fields and explicit empty values clear optional details', async () => {
  const f = fixture();
  await f.api.call('updateProfile', { ...PROFILE, publicProfile: true, showPet: false });
  const partial = (await f.api.call('updateProfile', { showPet: true })).user;
  assert.equal(partial.nickname, PROFILE.nickname);
  assert.equal(partial.area, PROFILE.area);
  assert.equal(partial.bio, PROFILE.bio);
  assert.deepEqual(partial.pet, PROFILE.pet);
  assert.equal(partial.publicProfile, true);
  assert.equal(partial.showPet, true);
  f.edit(state => { state.settings.areas = ['示例·新的开放片区']; });
  assert.deepEqual((await f.api.call('updateProfile', {})).user, partial);
  const cleared = (await f.api.call('updateProfile', { area: '', bio: '', pet: null })).user;
  assert.equal(cleared.nickname, PROFILE.nickname);
  assert.equal(cleared.area, '');
  assert.equal(cleared.bio, '');
  assert.equal(cleared.pet, null);
  assert.equal(cleared.showPet, true);
  assert.equal(cleared.publicProfile, true);
  await assert.rejects(f.api.call('updateProfile', { nickname: '' }), { code: 'INVALID_INPUT' });
});
