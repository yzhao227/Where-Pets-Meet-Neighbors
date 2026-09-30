const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../miniprogram/services/api');
const shared = require('../miniprogram/pages/_shared');
const drafts = require('../miniprogram/pages/_drafts');
const { createDemoService } = require('../miniprogram/services/demo');
const emptyUploads = () => ({ images: [], completed: [], pending: [], failures: [] });
const evt = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });

function setup() {
  const storage = new Map();
  const state = { snapshot: emptyUploads(), published: [], calls: [], navigations: [], toasts: [], discard: [], resumeError: null };
  const boot = { mode: 'cloud', user: { id: 'self', nickname: '同好', isAdmin: true, verification: { status: 'phone_verified' } }, registration: { termsVersion: '2026-10-01', privacyVersion: '2026-10-01', policyConfigured: true, phoneEnabled: true }, settings: { contact: '' }, circles: [{ id: 'circle', name: '爱宠同好', isJoined: true }] };
  const handlers = {
    bootstrap: () => structuredClone(boot),
    listEvents: () => ({ items: [] }),
    createPost: payload => { state.published.push(structuredClone(payload)); return { post: { id: 'created' } }; },
    verifyPhone: () => ({ user: boot.user }),
    getPolicies: () => ({ mode: 'cloud', isDraft: false, operator: { name: '测试运营主体', contact: '测试联系渠道' }, termsVersion: '2026-10-01', privacyVersion: '2026-10-02', terms: [{ title: '正式用户条款', text: '后台配置的正式用户条款正文。' }], privacy: [{ title: '正式隐私政策', text: '后台配置的保留期限和权利请求说明。' }] }),
    getHealth: () => ({ mode: 'cloud', policyConfigured: true, phoneEnabled: false, uploadsEnabled: true, maintenanceEnabled: false, pendingNotifications: 100, pendingUploads: 2, rateLimitRecords: 100, countsLimited: true, maintenance: { lastRunAt: Date.now(), lastSuccessAt: null, lastErrorCode: 'MAINTENANCE_FAILED' } })
  };
  global.wx = {
    getStorageSync: key => storage.has(key) ? structuredClone(storage.get(key)) : '',
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
    showToast: options => state.toasts.push(options.title),
    showModal: options => options.success({ confirm: true }),
    navigateTo: options => state.navigations.push(options.url),
    navigateBack: () => state.navigations.push('back'),
    switchTab: options => state.navigations.push(options.url),
    stopPullDownRefresh() {}, setClipboardData() {}
  };
  shared.verificationLeft();
  api.call = async (action, payload) => { state.calls.push(action); if (!handlers[action]) throw new Error('Unexpected action: ' + action); return handlers[action](payload); };
  api.uploadImages = async () => structuredClone(state.snapshot);
  api.uploadVideo = async () => structuredClone(state.snapshot);
  api.resumeUploads = async () => { if (state.resumeError) throw state.resumeError; return structuredClone(state.snapshot); };
  api.clearLocalUploads = async () => {};
  api.discardUploads = async ids => {
    state.discard.push(ids.slice());
    const removedFiles = state.snapshot.completed.filter(item => ids.includes(item.ticketId)).map(item => item.fileId);
    state.snapshot.images = state.snapshot.images.filter(item => !removedFiles.includes(item));
    if (state.snapshot.video && removedFiles.includes(state.snapshot.video.url)) state.snapshot.video = null;
    ['completed', 'pending', 'failures'].forEach(key => { state.snapshot[key] = state.snapshot[key].filter(item => !ids.includes(item.ticketId)); });
  };
  return { state, boot, handlers, storage };
}

function instantiate(name) {
  let definition;
  global.Page = value => { definition = value; };
  const source = require.resolve('../miniprogram/pages/' + name + '/index');
  delete require.cache[source]; require(source);
  return Object.assign({}, definition, { data: structuredClone(definition.data), _closed: false, writesAfterUnload: 0, setData(values) { if (this._closed) this.writesAfterUnload += 1; Object.assign(this.data, values); } });
}
async function settle(page) { for (let i = 0; i < 40 && (page.data.loading || page.data.eventsBusy || page.data.uploadsBusy); i += 1) await new Promise(resolve => setImmediate(resolve)); }
async function mount(name, options = {}) { const page = instantiate(name); page.onLoad(options); await settle(page); assert.equal(page.data.loading, false); return page; }

test('formal policy pages show server content and identity, while incomplete and failed responses stay visibly unavailable', async () => {
  const { state, handlers } = setup();
  const page = await mount('policy', { type: 'privacy' });
  assert.equal(page.data.isDraft, false);
  assert.equal(page.data.operatorName, '测试运营主体');
  assert.equal(page.data.contact, '测试联系渠道');
  assert.equal(page.data.version, '2026-10-02');
  assert.equal(page.data.sections[0].text, '后台配置的保留期限和权利请求说明。');
  assert.deepEqual(state.calls, ['getPolicies'], 'policy content is never reconstructed from public client settings');
  handlers.getPolicies = () => ({ mode: 'cloud', isDraft: true, operator: {}, terms: [], privacy: [] });
  await page.refresh();
  assert.equal(page.data.isDraft, true);
  assert.equal(page.data.contentMissing, true);
  assert.equal(page.data.operatorName, '');
  handlers.getPolicies = () => { throw Object.assign(new Error('政策接口尚未部署'), { code: 'UNKNOWN_ACTION' }); };
  await page.refresh();
  assert.equal(page.data.error, '政策接口尚未部署');
});

test('formal registration cannot proceed without configured policy and a configuration change requires a fresh consent choice', async () => {
  const { boot, state } = setup();
  boot.user.verification.status = 'unverified';
  boot.registration.policyConfigured = false;
  const page = await mount('register');
  page.toggleConsent();
  await page.phoneNumber({ detail: { code: 'native', errMsg: 'getPhoneNumber:ok' } });
  assert.equal(state.calls.includes('verifyPhone'), false);
  assert.match(page.data.verificationError, /政策配置/);
  boot.registration.policyConfigured = true;
  await page.refresh();
  assert.equal(page.data.consentAccepted, false);
  await page.phoneNumber({ detail: { code: 'native', errMsg: 'getPhoneNumber:ok' } });
  assert.equal(state.calls.includes('verifyPhone'), false);
  page.toggleConsent();
  await page.phoneNumber({ detail: { errMsg: 'getPhoneNumber:fail user deny' } });
  assert.equal(state.calls.includes('verifyPhone'), false);
  assert.match(page.data.verificationError, /没有取得手机号授权/);
  page.onUnload();
});

test('operations are administrator-only, preserve limited counts and display maintenance failure without claiming readiness', async () => {
  const { boot, handlers, state } = setup();
  boot.user.isAdmin = false;
  const page = await mount('operations');
  assert.equal(state.calls.includes('getHealth'), false);
  assert.equal(page.data.isAdmin, false);
  boot.user.isAdmin = true;
  await page.refresh();
  assert.deepEqual(page.data.queues.map(item => item.value), ['至少 100', '2', '至少 100']);
  assert.deepEqual(page.data.configurations.map(item => item.ready), [true, false, true, false]);
  assert.equal(page.data.maintenance.failed, true);
  assert.equal(page.data.maintenance.lastSuccess, '尚无记录');
  assert.match(page.data.maintenance.result, /未完成/);
  handlers.getHealth = () => ({ mode: 'demo', policyConfigured: true, maintenance: {} });
  await page.refresh();
  assert.ok(page.data.configurations.every(item => !item.ready && item.label === '未连接云端'));
  assert.equal(page.data.queues[0].value, '未取得', 'missing data is never converted to a healthy zero');
  handlers.getHealth = () => { throw new Error('没有运维查看权限'); };
  await page.refresh();
  assert.equal(page.data.error, '没有运维查看权限');
});

test('pending image tickets and the full draft survive leaving the page and an offline retry without publishing', async () => {
  const { state, storage } = setup();
  const page = await mount('compose');
  page.inputTitle(evt({}, '想和大家分享的一天'));
  page.input(evt({}, '今天遇到了一只可爱的小狗。'));
  page.selectKind(evt({ kind: 'question' }));
  page.selectTopic(evt({ topic: '户外出行' }));
  state.snapshot.pending = [{ ticketId: 'ticket-pending', status: 'pending', message: '正在审核' }];
  await page.upload();
  assert.deepEqual(page.data.images, []);
  assert.equal(page.data.pendingUploads.length, 1);
  await page.submit();
  assert.equal(state.published.length, 0);
  page.onUnload();
  assert.equal(storage.get(drafts.KEY)['cloud:self'].pendingUploads[0].ticketId, 'ticket-pending');
  state.resumeError = new Error('网络连接中断');
  const restored = await mount('compose');
  assert.equal(restored.data.draftRestored, true);
  assert.equal(restored.data.title, '想和大家分享的一天');
  assert.equal(restored.data.text, '今天遇到了一只可爱的小狗。');
  assert.equal(restored.data.kind, 'question');
  assert.deepEqual(restored.data.selectedTopics, ['户外出行']);
  assert.equal(restored.data.pendingUploads[0].ticketId, 'ticket-pending');
  assert.match(restored.data.submitError, /网络连接中断/);
  await restored.submit();
  assert.equal(state.published.length, 0);
  state.resumeError = null;
  state.snapshot = { images: ['cloud://approved/image'], completed: [{ ticketId: 'ticket-pending', fileId: 'cloud://approved/image' }], pending: [], failures: [] };
  await restored.retryUploads();
  assert.deepEqual(restored.data.images, ['cloud://approved/image']);
  assert.equal(restored.data.pendingUploads.length, 0);
  assert.equal(state.published.length, 0, 'approval never submits automatically');
  await restored.submit();
  assert.equal(state.published.length, 1);
  assert.deepEqual(state.published[0].images, ['cloud://approved/image']);
  assert.deepEqual(state.discard, [['ticket-pending']]);
  restored.onUnload();
  assert.equal(storage.get(drafts.KEY)['cloud:self'], undefined);
});

test('a mixed batch retains approved photos but rejected photos must be removed or retried before submission', async () => {
  const { state } = setup();
  const page = await mount('compose');
  page.input(evt({}, '分享今天的小事。'));
  state.snapshot = { images: ['cloud://approved/a'], completed: [{ ticketId: 'approved', fileId: 'cloud://approved/a' }], pending: [], failures: [{ ticketId: 'rejected', code: 'CONTENT_REJECTED', message: '这张图片未通过审核，请重新选择。' }] };
  await page.upload();
  assert.equal(page.data.attachmentCount, 2);
  assert.equal(page.data.failedUploads.length, 1);
  await page.submit();
  assert.equal(state.published.length, 0);
  await page.removeUpload(evt({ id: 'rejected' }));
  assert.equal(page.data.attachmentCount, 1);
  assert.equal(page.data.failedUploads.length, 0);
  assert.deepEqual(page.data.images, ['cloud://approved/a']);
  await page.submit();
  assert.equal(state.published.length, 1);
  assert.deepEqual(state.discard, [['rejected'], ['approved']]);
});

test('text moderation and photo permission errors preserve the draft for editing and retry', async () => {
  const { handlers, state } = setup();
  const page = await mount('compose');
  page.inputTitle(evt({}, '我的分享'));
  page.input(evt({}, '准备发布的正文。'));
  api.uploadImages = async () => { throw Object.assign(new Error('没有相册访问权限，请到微信设置中开启后重试'), { code: 'IMAGE_SELECTION_FAILED' }); };
  await page.upload();
  assert.match(page.data.submitError, /相册访问权限/);
  assert.equal(page.data.text, '准备发布的正文。');
  handlers.createPost = () => { throw Object.assign(new Error('文字未通过审核，请修改后重试'), { code: 'CONTENT_REJECTED' }); };
  await page.submit();
  assert.match(page.data.submitError, /文字未通过审核/);
  assert.equal(page.data.busy, false);
  page.onUnload();
  const restored = await mount('compose');
  assert.equal(restored.data.title, '我的分享');
  assert.equal(restored.data.text, '准备发布的正文。');
  assert.equal(state.published.length, 0);
});

test('an expired previously approved image leaves the publishable image list when its status is refreshed', async () => {
  const { state } = setup();
  const page = await mount('compose');
  page.input(evt({}, '等图片恢复后再分享。'));
  state.snapshot = { images: ['cloud://old/image'], completed: [{ ticketId: 'expired', fileId: 'cloud://old/image' }], pending: [], failures: [] };
  await page.upload();
  page.onUnload();
  state.snapshot = { images: [], completed: [], pending: [], failures: [{ ticketId: 'expired', code: 'UPLOAD_EXPIRED', message: '图片已过期，请重新选择。' }] };
  const restored = await mount('compose');
  assert.deepEqual(restored.data.images, []);
  assert.equal(restored.data.failedUploads.length, 1);
  await restored.removeUpload(evt({ id: 'expired' }));
  await restored.submit();
  assert.deepEqual(state.published[0].images, [], 'an old unapproved file identifier never leaks into the submitted images');
});

test('an upload finishing after page unload does not write into the closed page and is recovered through its ticket', async () => {
  const { state } = setup();
  const page = await mount('compose');
  page.input(evt({}, '离开以后也要保留的正文。'));
  let finish;
  api.uploadImages = () => new Promise(resolve => { finish = resolve; });
  const upload = page.upload();
  page.onUnload();
  state.snapshot = { images: [], completed: [], pending: [{ ticketId: 'late-ticket', status: 'pending' }], failures: [] };
  finish(state.snapshot);
  await upload;
  assert.equal(page.writesAfterUnload, 0);
  const restored = await mount('compose');
  assert.equal(restored.data.text, '离开以后也要保留的正文。');
  assert.equal(restored.data.pendingUploads[0].ticketId, 'late-ticket');
});

test('private drafts do not cross accounts, storage errors are visible and clearing a draft removes its upload tickets', async () => {
  const { state, boot, storage } = setup();
  const page = await mount('compose');
  page.input(evt({}, '第一个账号的私密草稿。'));
  boot.user.id = 'second';
  await page.refresh();
  assert.equal(page.data.text, '');
  assert.deepEqual(page.data.images, []);
  const save = global.wx.setStorageSync;
  global.wx.setStorageSync = () => { throw new Error('quota exceeded'); };
  page.input(evt({}, '第二个账号的草稿。'));
  assert.match(page.data.draftError, /保存失败/);
  assert.equal(page.data.text, '第二个账号的草稿。');
  global.wx.setStorageSync = save;
  page.saveDraft();
  assert.equal(page.data.draftError, '');
  assert.equal(storage.get(drafts.KEY)['cloud:self'].text, '第一个账号的私密草稿。');
  state.snapshot.pending = [{ ticketId: 'second-ticket', status: 'pending' }];
  await page.upload();
  await page.clearDraft();
  assert.deepEqual(state.discard, [['second-ticket']]);
  assert.equal(storage.get(drafts.KEY)['cloud:second'], undefined);
  assert.equal(page.data.text, '');
});

test('successful publishing is never retried when local upload cleanup fails', async () => {
  const { state } = setup();
  const page = await mount('compose');
  page.input(evt({}, '只发送一次。'));
  state.snapshot = { images: ['cloud://approved/a'], completed: [{ ticketId: 'completed', fileId: 'cloud://approved/a' }], pending: [], failures: [] };
  await page.upload();
  api.discardUploads = async () => { throw new Error('local storage unavailable'); };
  await page.submit();
  assert.equal(state.published.length, 1);
  assert.match(page.data.draftError, /分享已发布/);
  assert.deepEqual(state.navigations, []);
  await page.submit();
  assert.equal(state.published.length, 1);
});

test('account deletion succeeds separately from retryable local cleanup without replaying deletion', async () => {
  const { handlers, state } = setup();
  handlers.deleteAccount = () => ({ deleted: true, localCleanup: { status: 'failed', message: '本机照片还需清理' } });
  let cleanupBlocked = true;
  let localAttempts = 0;
  api.clearLocalUploads = async () => { localAttempts += 1; if (cleanupBlocked) throw new Error('本机文件暂时不能删除'); };
  const page = await mount('me');
  await page.deleteAccount();
  assert.equal(page.data.localCleanupPending, true);
  await page.clearLocalDrafts();
  assert.equal(page.data.localCleanupPending, true);
  cleanupBlocked = false;
  await page.clearLocalDrafts();
  assert.equal(page.data.localCleanupPending, false);
  assert.equal(localAttempts, 2);
  assert.equal(state.calls.filter(action => action === 'deleteAccount').length, 1);
});

test('demo policies and health remain explicitly simulated, with owned upload reads and local draft deletion', async () => {
  const { storage } = setup();
  const demo = createDemoService(global.wx);
  const boot = await demo.call('bootstrap');
  assert.equal(boot.registration.policyConfigured, false);
  const policy = await demo.call('getPolicies');
  assert.equal(policy.mode, 'demo');
  assert.equal(policy.isDraft, true);
  assert.match(policy.operator.name, /未配置真实运营主体/);
  const health = await demo.call('getHealth');
  assert.equal(health.mode, 'demo');
  assert.equal(health.phoneEnabled, false);
  assert.equal(health.maintenance.lastSuccessAt, null);
  await demo.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: boot.registration.termsVersion, privacyVersion: boot.registration.privacyVersion } });
  const upload = await demo.call('createUploadTicket', { extension: 'png' });
  assert.equal((await demo.call('getUploadStatus', { ticketId: upload.ticketId })).status, 'pending');
  await demo.call('completeUpload', { ticketId: upload.ticketId, fileId: 'wxfile://saved.png' });
  assert.equal((await demo.call('getUploadStatus', { ticketId: upload.ticketId })).status, 'complete');
  const state = storage.get('youban.demo.v1');
  state.users.find(user => user.id === state.currentUserId).isAdmin = false;
  storage.set('youban.demo.v1', state);
  await assert.rejects(demo.call('getHealth'), { code: 'FORBIDDEN' });
  await assert.rejects(demo.call('getUploadStatus', { ticketId: 'unknown' }), { code: 'UPLOAD_UNAVAILABLE' });
  storage.set(drafts.KEY, { 'demo:demo-self': { version: 1, text: '私密正文' } });
  await demo.call('deleteAccount');
  assert.equal(storage.has(drafts.KEY), false);
});

test('restoring a mixed photo/video draft retains both removal choices and the body, then publishes only the chosen media', async () => {
  const { state, storage } = setup();
  const video = { url: 'cloud://approved/video.mp4', durationSeconds: 10 };
  const photo = 'cloud://approved/photo.png';
  storage.set(drafts.KEY, { 'cloud:self': { version: 1, text: '不能丢失的正文', title: '我的选择', circleId: 'circle', images: [photo], video,
    completedUploads: [{ ticketId: 'photo-ticket', fileId: photo }, { ticketId: 'video-ticket', fileId: video.url, mediaType: 'video' }], pendingUploads: [], failedUploads: [] } });
  const page = await mount('compose');
  assert.equal(page.data.mediaConflict, true);
  assert.deepEqual(page.data.images, [photo]); assert.deepEqual(page.data.video, video);
  assert.equal(page.data.attachmentCount, 2);
  await page.submit(); assert.equal(state.published.length, 0);
  assert.match(state.toasts.at(-1), /照片与视频不能一起发布/);
  await page.removeImage(evt({ index: 0 }));
  assert.equal(page.data.mediaConflict, false); assert.equal(page.data.attachmentCount, 1);
  await page.retryUploads();
  assert.deepEqual(page.data.video, video, 'the chosen restored video does not disappear when its local queue snapshot is missing');
  assert.equal(page.data.text, '不能丢失的正文');
  await page.submit();
  assert.equal(state.published.length, 1); assert.deepEqual(state.published[0].images, []);
  assert.deepEqual(state.published[0].video, video); assert.equal(state.published[0].text, '不能丢失的正文');
});

test('a recovered video queue cannot hide a draft photo; removing the video keeps the photo across later retries', async () => {
  const { state, storage } = setup();
  const photo = 'cloud://approved/retained-photo.png';
  storage.set(drafts.KEY, { 'cloud:self': { version: 1, text: '保留照片和正文', circleId: 'circle', images: [photo],
    completedUploads: [{ ticketId: 'old-photo', fileId: photo }], pendingUploads: [], failedUploads: [] } });
  state.snapshot = { images: [], video: { url: 'cloud://approved/new-video.mp4', durationSeconds: 8 }, completed: [{ ticketId: 'new-video', fileId: 'cloud://approved/new-video.mp4', mediaType: 'video' }], pending: [], failures: [] };
  const page = await mount('compose');
  assert.equal(page.data.mediaConflict, true); assert.deepEqual(page.data.images, [photo]);
  await page.removeVideo(); await page.retryUploads();
  assert.equal(page.data.video, null); assert.equal(page.data.mediaConflict, false);
  assert.deepEqual(page.data.images, [photo]); assert.equal(page.data.text, '保留照片和正文');
  assert.ok(state.discard.some(ids => ids.includes('new-video')));
  await page.submit(); assert.deepEqual(state.published[0].images, [photo]); assert.equal(state.published[0].video, undefined);
});

test('conflicting unfinished media stays removable and the native template exposes both image and video controls', async () => {
  const { state, storage } = setup();
  storage.set(drafts.KEY, { 'cloud:self': { version: 1, text: '附件处理期间的正文', circleId: 'circle', images: ['cloud://approved/photo'],
    pendingUploads: [{ ticketId: 'waiting-video', mediaType: 'video', status: 'pending' }], failedUploads: [], completedUploads: [] } });
  const page = await mount('compose');
  assert.equal(page.data.mediaConflict, true); assert.equal(page.data.pendingUploads.length, 1);
  await page.removeUpload(evt({ id: 'waiting-video' }));
  assert.equal(page.data.mediaConflict, false); assert.deepEqual(page.data.images, ['cloud://approved/photo']);
  assert.equal(page.data.text, '附件处理期间的正文');
  const markup = require('node:fs').readFileSync(require('node:path').join(__dirname, '../miniprogram/pages/compose/index.wxml'), 'utf8');
  assert.match(markup, /wx:if="\{\{images\.length \|\| !hasVideoAttachment\}\}" class="image-grid"/);
  assert.match(markup, /bindtap="removeVideo"/); assert.match(markup, /catchtap="removeImage"/);
  assert.match(markup, /草稿里同时保留了照片和视频/);
});
