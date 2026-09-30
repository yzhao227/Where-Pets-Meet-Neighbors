const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoService, STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed } = require('./helpers/community-fixture');

const EPOCH = Date.UTC(2026, 8, 29, 2);
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture() {
  let currentTime = EPOCH;
  const values = new Map([[STORAGE_KEY, createSeed(EPOCH)]]);
  const platform = {
    getStorageSync(key) { return values.has(key) ? clone(values.get(key)) : ''; },
    setStorageSync(key, value) { values.set(key, clone(value)); }
  };
  const service = () => createDemoService(platform, { now: () => currentTime });
  const api = service();
  await api.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  return {
    platform, service, api,
    advance(ms) { currentTime += ms; },
    state() { return platform.getStorageSync(STORAGE_KEY); },
    edit(edit) { const state = this.state(); edit(state); platform.setStorageSync(STORAGE_KEY, state); }
  };
}

function eventPayload(extra) {
  return Object.assign({ title: '邻里照片分享', description: '没有养宠物也可以参加。', location: '示例邻里空间', startAt: EPOCH + 86400000, endAt: EPOCH + 90000000, capacity: 6, petPolicy: 'none', circleId: 'circle-neighbors' }, extra);
}

test('isolated test community is clearly fictional; dates and writes survive restart', async () => {
  const f = await fixture();
  const first = await f.api.call('bootstrap');
  assert.equal(first.mode, 'demo');
  assert.equal(first.user.nickname, '新来的邻居');
  assert.equal(first.user.pet, null);
  assert.equal(first.user.isAdmin, true);
  assert.equal(first.circles.length, 8);
  const posts = await f.api.call('listPosts');
  assert.equal(posts.items.length, 8);
  assert.ok(posts.items.every(post => post.author.nickname.includes('示例') && post.text.includes('示例')));
  const events = await f.api.call('listEvents');
  assert.equal(events.items.length, 4);
  assert.ok(events.items.every(event => event.startAt > EPOCH && event.description.includes('虚构')));
  await f.api.call('joinCircle', { id: 'circle-cats', join: true });
  f.advance(86400000);
  const restarted = f.service();
  assert.deepEqual((await restarted.call('listEvents')).items.map(event => event.startAt), events.items.map(event => event.startAt));
  assert.equal((await restarted.call('getCircle', { id: 'circle-cats' })).circle.isJoined, true);
  first.user.nickname = '不能改动存储';
  assert.equal((await restarted.call('bootstrap')).user.nickname, '新来的邻居');
});

test('posting enforces membership, content size and owned uploads without inventing replies', async () => {
  const f = await fixture();
  await assert.rejects(f.api.call('createPost', { circleId: 'circle-cats', text: 'hello', images: [] }), { code: 'NOT_MEMBER' });
  await assert.rejects(f.api.call('createPost', { circleId: 'circle-neighbors', text: ' ', images: [] }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('createPost', { circleId: 'circle-neighbors', text: '字'.repeat(1001), images: [] }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('createPost', { circleId: 'circle-neighbors', text: '', images: ['/assets/story-cat.png'] }), { code: 'UPLOAD_UNAVAILABLE' });
  const ticket = await f.api.call('createUploadTicket', { extension: 'png' });
  await f.api.call('completeUpload', { ticketId: ticket.ticketId, fileId: 'wxfile://saved-my-cat.png' });
  const { post } = await f.api.call('createPost', { circleId: 'circle-neighbors', text: '', images: ['wxfile://saved-my-cat.png'] });
  assert.equal(post.isMine, true);
  assert.equal(post.commentCount, 0);
  assert.deepEqual((await f.service().call('getPost', { id: post.id })).comments, []);
  assert.equal((await f.api.call('listMessages')).items.length, 1);
  const owned = await f.api.call('listPosts', { mine: true });
  assert.deepEqual(owned.items.map(item => item.id), [post.id]);
});

test('comments support replies only inside their original target', async () => {
  const f = await fixture();
  const result = await f.api.call('addComment', { targetType: 'post', targetId: 'demo-post-1', text: '阳光很好', replyToId: 'demo-comment-1' });
  assert.equal(result.comment.replyToName, '示例·阿安');
  assert.equal(result.comment.isMine, true);
  assert.equal((await f.api.call('getPost', { id: 'demo-post-1' })).post.commentCount, 2);
  await assert.rejects(f.api.call('addComment', { targetType: 'post', targetId: 'demo-post-2', text: '串帖回复', replyToId: 'demo-comment-1' }), { code: 'NOT_FOUND' });
  await assert.rejects(f.api.call('addComment', { targetType: 'post', targetId: 'demo-post-1', text: '字'.repeat(301) }), { code: 'INVALID_INPUT' });
  await f.api.call('deleteComment', { id: result.comment.id });
  assert.equal((await f.api.call('getPost', { id: 'demo-post-1' })).post.commentCount, 1);
});

test('ordinary users cannot delete others content or manage activities; own deletion works', async () => {
  const f = await fixture();
  await f.api.call('bootstrap');
  f.edit(state => { state.users.find(user => user.id === 'demo-self').isAdmin = false; });
  await assert.rejects(f.api.call('deletePost', { id: 'demo-post-1' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.api.call('deleteComment', { id: 'demo-comment-1' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.api.call('createEvent', eventPayload()), { code: 'FORBIDDEN' });
  const { post } = await f.api.call('createPost', { circleId: 'circle-neighbors', text: '自己的帖子', images: [] });
  const { comment } = await f.api.call('addComment', { targetType: 'post', targetId: post.id, text: '自己的回复' });
  await f.api.call('deletePost', { id: post.id });
  await assert.rejects(f.api.call('getPost', { id: post.id }), { code: 'NOT_FOUND' });
  assert.ok(!f.state().comments.some(item => item.id === comment.id));
});

test('demo administrator can moderate another author’s content', async () => {
  const f = await fixture();
  await f.api.call('deletePost', { id: 'demo-post-1' });
  await assert.rejects(f.api.call('getPost', { id: 'demo-post-1' }), { code: 'NOT_FOUND' });
  assert.ok(!f.state().comments.some(item => item.targetId === 'demo-post-1'));
});

test('join is idempotent at capacity, cancellation frees a place, and full events reject new entrants', async () => {
  const f = await fixture();
  await f.api.call('bootstrap');
  f.edit(state => { state.events.find(event => event.id === 'demo-event-coffee').capacity = 3; });
  const first = await f.api.call('joinEvent', { id: 'demo-event-coffee', join: true });
  assert.equal(first.event.attendeeCount, 3);
  assert.equal(first.event.isJoined, true);
  const again = await f.service().call('joinEvent', { id: 'demo-event-coffee', join: true });
  assert.equal(again.event.attendeeCount, 3);
  assert.equal((await f.api.call('listMessages')).items.length, 2);
  const left = await f.api.call('joinEvent', { id: 'demo-event-coffee', join: false });
  assert.equal(left.event.attendeeCount, 2);
  assert.equal(left.event.isJoined, false);
  f.edit(state => { state.events.find(event => event.id === 'demo-event-coffee').capacity = 2; });
  await assert.rejects(f.api.call('joinEvent', { id: 'demo-event-coffee', join: true }), { code: 'EVENT_FULL' });
  assert.equal((await f.api.call('getEvent', { id: 'demo-event-coffee' })).event.attendeeCount, 2);
});

test('past events cannot accept new attendees or be moved into the future', async () => {
  const f = await fixture();
  await f.api.call('bootstrap');
  f.advance(9 * 86400000);
  await assert.rejects(f.api.call('joinEvent', { id: 'demo-event-coffee', join: true }), { code: 'EVENT_CLOSED' });
  await assert.rejects(f.api.call('updateEvent', { id: 'demo-event-coffee', startAt: EPOCH + 10 * 86400000, endAt: EPOCH + 11 * 86400000 }), { code: 'EVENT_CLOSED' });
  const { comment } = await f.api.call('addComment', { targetType: 'event', targetId: 'demo-event-coffee', text: '活动结束后，也可以继续分享感受' });
  assert.equal(comment.isMine, true);
});

test('event edits preserve attendee capacity and notify attendees once per meaningful edit', async () => {
  const f = await fixture();
  await f.api.call('joinEvent', { id: 'demo-event-coffee', join: true });
  const before = (await f.api.call('listMessages')).items.length;
  const original = (await f.api.call('getEvent', { id: 'demo-event-coffee' })).event;
  await assert.rejects(f.api.call('updateEvent', Object.assign({}, original, { capacity: 2 })), { code: 'INVALID_INPUT' });
  await f.api.call('updateEvent', Object.assign({}, original, { location: '示例·更新后的公共地点' }));
  assert.equal((await f.api.call('listMessages')).items.length, before + 1);
  await f.api.call('updateEvent', Object.assign({}, original, { location: '示例·更新后的公共地点' }));
  assert.equal((await f.api.call('listMessages')).items.length, before + 1);
  const cancelled = await f.api.call('cancelEvent', { id: 'demo-event-coffee', reason: '演示天气变化' });
  assert.equal(cancelled.event.status, 'cancelled');
  assert.equal(cancelled.event.cancelReason, '演示天气变化');
  assert.equal((await f.api.call('listMessages')).items.length, before + 2);
  await f.api.call('cancelEvent', { id: 'demo-event-coffee', reason: '演示天气变化' });
  assert.equal((await f.api.call('listMessages')).items.length, before + 2);
  await assert.rejects(f.api.call('updateEvent', { id: 'demo-event-coffee', title: '试图恢复' }), { code: 'EVENT_CLOSED' });
  const afterLeaving = await f.api.call('joinEvent', { id: 'demo-event-coffee', join: false });
  assert.equal(afterLeaving.event.isJoined, false);
  assert.equal(afterLeaving.event.attendeeCount, 2);
});

test('blocking hides posts and comments in lists and details, while unblock restores them', async () => {
  const f = await fixture();
  await f.api.call('blockUser', { userId: 'demo-an', block: true });
  assert.equal((await f.api.call('getPost', { id: 'demo-post-1' })).comments.length, 0);
  assert.equal((await f.api.call('getPost', { id: 'demo-post-1' })).post.commentCount, 0);
  await assert.rejects(f.api.call('getPost', { id: 'demo-post-4' }), { code: 'NOT_FOUND' });
  assert.ok((await f.service().call('listPosts')).items.every(post => post.author.id !== 'demo-an'));
  assert.ok((await f.api.call('getCircle', { id: 'circle-cats' })).posts.every(post => post.author.id !== 'demo-an'));
  assert.deepEqual((await f.api.call('listBlocked')).items.map(user => user.id), ['demo-an']);
  await f.api.call('blockUser', { userId: 'demo-an', block: false });
  assert.equal((await f.api.call('getPost', { id: 'demo-post-1' })).comments.length, 1);
  await assert.rejects(f.api.call('blockUser', { userId: 'demo-self', block: true }), { code: 'INVALID_INPUT' });
});

test('no-pet profile is valid, persists, and cannot escalate privileges through payload', async () => {
  const f = await fixture();
  await f.api.call('bootstrap');
  f.edit(state => { state.users.find(user => user.id === 'demo-self').isAdmin = false; });
  const updated = await f.api.call('updateProfile', { nickname: '喜欢小动物', area: '示例·梧桐里', bio: '暂时没养宠', pet: null, isAdmin: true });
  assert.equal(updated.user.pet, null);
  assert.equal(updated.user.isAdmin, false);
  assert.equal((await f.service().call('bootstrap')).user.nickname, '喜欢小动物');
  await assert.rejects(f.api.call('updateProfile', { nickname: '喜欢小动物', area: '没有配置的片区', bio: '', pet: null }), { code: 'INVALID_INPUT' });
  const withPet = await f.api.call('updateProfile', { nickname: '小明', area: '示例·梧桐里', bio: '', pet: { name: '小猫', type: 'cat' } });
  assert.deepEqual(withPet.user.pet, { name: '小猫', type: 'cat' });
  const privateProfile = await f.api.call('updateProfile', { nickname: '小明', area: '', bio: '', pet: null });
  assert.equal(privateProfile.user.area, '');
});

test('blocking an organizer leaves hidden events and frees capacity; co-attendees remain', async () => {
  const f = await fixture();
  await f.api.call('joinEvent', { id: 'demo-event-coffee', join: true });
  await f.api.call('blockUser', { userId: 'demo-qiao', block: true });
  assert.equal((await f.api.call('getEvent', { id: 'demo-event-coffee' })).event.isJoined, true);
  await f.api.call('blockUser', { userId: 'demo-he', block: true });
  await assert.rejects(f.api.call('getEvent', { id: 'demo-event-coffee' }), { code: 'NOT_FOUND' });
  assert.ok(!(await f.api.call('listEvents')).items.some(event => event.id === 'demo-event-coffee'));
  assert.ok(!f.state().events.find(event => event.id === 'demo-event-coffee').attendeeIds.includes('demo-self'));
  const own = (await f.api.call('createEvent', eventPayload())).event;
  f.edit(state => state.events.find(event => event.id === own.id).attendeeIds.push('demo-an'));
  await f.api.call('blockUser', { userId: 'demo-an', block: true });
  assert.equal((await f.api.call('getEvent', { id: own.id })).event.attendeeCount, 0);
});

test('read state survives restart and another user’s private messages cannot be read', async () => {
  const f = await fixture();
  await f.api.call('bootstrap');
  f.edit(state => { state.messages.push({ id: 'other-secret', userId: 'demo-lin', title: '其他人的消息', text: '私有', createdAt: EPOCH, isRead: false, targetType: 'system', targetId: '' }); });
  await assert.rejects(f.api.call('readMessage', { id: 'other-secret' }), { code: 'NOT_FOUND' });
  const before = await f.api.call('listMessages');
  assert.equal(before.unreadCount, 1);
  await f.api.call('readMessage', { id: 'demo-welcome' });
  assert.equal((await f.service().call('listMessages')).unreadCount, 0);
  assert.ok((await f.api.call('listMessages')).items.every(message => message.id !== 'other-secret'));
  assert.equal(f.state().messages.find(message => message.id === 'other-secret').isRead, false);
});

test('reports are real local records and acknowledgement does not imply live moderation', async () => {
  const f = await fixture();
  const result = await f.api.call('report', { targetType: 'post', targetId: 'demo-post-1', reason: '内容问题', description: '测试本地反馈' });
  assert.equal(f.state().reports[0].id, result.id);
  const messages = await f.service().call('listMessages');
  assert.ok(messages.items.some(message => message.text.includes('没有发送给真实工作人员')));
  await assert.rejects(f.api.call('report', { targetType: 'invalid', targetId: 'demo-post-1', reason: '问题' }), { code: 'INVALID_INPUT' });
});

test('report administration is private, follows comment origin, and survives deleted content', async () => {
  const f = await fixture();
  const { id } = await f.api.call('report', { targetType: 'comment', targetId: 'demo-comment-1', reason: '需要核查', description: '供管理员查看' });
  const report = (await f.api.call('listReports')).items[0];
  assert.equal(report.id, id);
  assert.equal(report.status, 'open');
  assert.equal(report.targetTypeForLink, 'post');
  assert.equal(report.targetIdForLink, 'demo-post-1');
  assert.equal(report.reporter.id, 'demo-self');
  assert.ok(report.targetSummary.includes('窗边'));
  await f.api.call('deleteComment', { id: 'demo-comment-1' });
  const deletedTarget = (await f.service().call('listReports')).items[0];
  assert.equal(deletedTarget.targetSummary, '内容已删除');
  assert.equal(deletedTarget.targetIdForLink, 'demo-post-1');
  f.edit(state => { state.users.find(user => user.id === 'demo-self').isAdmin = false; });
  await assert.rejects(f.api.call('listReports'), { code: 'FORBIDDEN' });
  await assert.rejects(f.api.call('resolveReport', { id, status: 'resolved' }), { code: 'FORBIDDEN' });
  assert.equal(f.state().reports[0].status, 'open');
});

test('report resolution is durable and idempotent without silently deleting content', async () => {
  const f = await fixture();
  const { id } = await f.api.call('report', { targetType: 'post', targetId: 'demo-post-1', reason: '需要核查' });
  const before = (await f.api.call('listMessages')).items.length;
  await assert.rejects(f.api.call('resolveReport', { id, status: 'resolved', note: '字'.repeat(301) }), { code: 'INVALID_INPUT' });
  await f.api.call('resolveReport', { id, status: 'resolved', note: '已核查演示内容' });
  assert.equal((await f.api.call('listReports')).items.length, 0);
  const all = await f.service().call('listReports', { status: 'all' });
  assert.equal(all.items[0].status, 'resolved');
  assert.equal((await f.api.call('getPost', { id: 'demo-post-1' })).post.id, 'demo-post-1');
  const messages = await f.api.call('listMessages');
  assert.equal(messages.items.length, before + 1);
  const notice = messages.items.find(message => message.targetId === id);
  assert.equal(notice.targetType, 'system');
  assert.ok(notice.text.includes('已核查演示内容'));
  assert.ok(notice.text.includes('没有真实工作人员参与'));
  await f.service().call('resolveReport', { id, status: 'resolved', note: '再点一次' });
  await f.api.call('resolveReport', { id, status: 'dismissed', note: '不能覆盖第一次结果' });
  assert.equal((await f.api.call('listMessages')).items.length, before + 1);
  assert.equal(f.state().reports[0].status, 'resolved');
  assert.equal(f.state().reports[0].note, '已核查演示内容');
});

test('report list paginates, supports dismissed results and reads older pending records', async () => {
  const f = await fixture();
  const first = await f.api.call('report', { targetType: 'user', targetId: 'demo-lin', reason: '演示核查' });
  await f.api.call('resolveReport', { id: first.id, status: 'dismissed' });
  assert.equal((await f.api.call('listReports')).items.length, 0);
  assert.equal((await f.api.call('listReports', { status: 'all' })).items[0].status, 'dismissed');
  for (let index = 0; index < 22; index += 1) {
    f.advance(1);
    await f.api.call('report', { targetType: 'post', targetId: 'demo-post-1', reason: '分页演示 ' + index });
  }
  f.edit(state => { state.reports[1].status = 'pending'; });
  const page = await f.api.call('listReports');
  assert.equal(page.items.length, 20);
  assert.equal(page.nextCursor, '20');
  const rest = await f.api.call('listReports', { cursor: page.nextCursor });
  assert.equal(rest.items.length, 2);
  assert.ok(rest.items.every(report => report.status === 'open'));
  assert.equal(new Set(page.items.concat(rest.items).map(report => report.id)).size, 22);
  await assert.rejects(f.api.call('listReports', { status: 'resolved' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('listReports', { cursor: '-1' }), { code: 'INVALID_INPUT' });
});

test('account deletion removes public content and relationships without reseeding erased data', async () => {
  const f = await fixture();
  const { post } = await f.api.call('createPost', { circleId: 'circle-neighbors', text: '注销时应该清理', images: [] });
  await f.api.call('addComment', { targetType: 'post', targetId: 'demo-post-2', text: '我的留言也要清理' });
  await f.api.call('joinEvent', { id: 'demo-event-coffee', join: true });
  await f.api.call('blockUser', { userId: 'demo-an', block: true });
  await f.api.call('updateProfile', { nickname: '旧名字', area: '示例·梧桐里', bio: '旧简介', pet: { name: '旧宠物', type: 'cat' } });
  const { event } = await f.api.call('createEvent', eventPayload());
  f.edit(state => { state.events.find(item => item.id === event.id).attendeeIds.push('demo-qiao'); });
  await f.api.call('deleteAccount');
  const state = f.state();
  assert.ok(!state.users.some(user => user.id === 'demo-self'));
  assert.ok(!state.posts.some(item => item.id === post.id));
  assert.ok(!state.comments.some(item => item.authorId === 'demo-self'));
  assert.ok(state.circles.every(circle => !circle.memberIds.includes('demo-self')));
  assert.ok(state.events.every(item => !item.attendeeIds.includes('demo-self')));
  assert.ok(!state.messages.some(message => message.userId === 'demo-self'));
  assert.ok(state.messages.some(message => message.userId === 'demo-qiao' && message.targetId === event.id));
  const again = await f.service().call('bootstrap');
  assert.equal(again.user.nickname, '新来的邻居');
  assert.equal(again.user.bio, '');
  assert.equal(again.user.pet, null);
  assert.equal(again.stats.joinedCircleCount, 0);
  assert.equal(again.stats.postCount, 0);
  assert.equal((await f.api.call('getEvent', { id: event.id })).event.status, 'cancelled');
  assert.equal((await f.api.call('listMessages')).items.length, 0);
});

test('storage failure rejects mutation instead of reporting unsaved success', async () => {
  const f = await fixture();
  await f.api.call('bootstrap');
  const before = f.state();
  f.platform.setStorageSync = () => { throw new Error('quota'); };
  await assert.rejects(f.api.call('createPost', { circleId: 'circle-neighbors', text: '不会被保存', images: [] }), { code: 'STORAGE_UNAVAILABLE' });
  assert.deepEqual(f.state(), before);
});

test('input limits, uploads and event policy are validated', async () => {
  const f = await fixture();
  await assert.rejects(f.api.call('createEvent', eventPayload({ capacity: 1 })), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('createEvent', eventPayload({ capacity: 101 })), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('createEvent', eventPayload({ startAt: EPOCH - 1 })), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('createEvent', eventPayload({ petPolicy: 'cats' })), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('createUploadTicket', { extension: 'exe' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('completeUpload', { ticketId: 'other-user-ticket', fileId: 'wxfile://x' }), { code: 'UPLOAD_UNAVAILABLE' });
  await assert.rejects(f.api.call('listPosts', { cursor: '-1' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.api.call('unknown'), { code: 'UNKNOWN_ACTION' });
  const event = (await f.api.call('createEvent', eventPayload())).event;
  assert.equal(event.isMine, true);
  assert.equal(event.capacity, 6);
});
