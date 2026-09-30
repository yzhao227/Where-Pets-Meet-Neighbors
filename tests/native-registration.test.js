const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../miniprogram/services/api');
const shared = require('../miniprogram/pages/_shared');
const { demoPolicies } = require('../miniprogram/data/seed');

const version = '2026-09-29';
const acceptedConsent = { accepted: true, termsVersion: version, privacyVersion: version };
const verificationRequired = () => Object.assign(new Error('请先核验手机号'), { code: 'VERIFICATION_REQUIRED' });
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });

function setup(options = {}) {
  const calls = [];
  const storage = new Map();
  const effects = { toasts: [], navigations: [], clipboard: [] };
  const boot = {
    mode: options.mode || 'demo',
    user: { id: 'self', nickname: '新来的同好', isAdmin: options.isAdmin === true, publicProfile: false, showPet: false, pet: null, verification: { status: 'unverified' } },
    registration: { termsVersion: version, privacyVersion: version, phoneEnabled: options.phoneEnabled === true, policyConfigured: options.policyConfigured !== false },
    settings: { areas: ['公园片区'], contact: '' },
    circles: [{ id: 'circle', name: '一起慢慢走', isJoined: true }]
  };
  const handlers = {
    bootstrap: () => structuredClone(boot),
    getPolicies: () => Object.assign(demoPolicies(boot.settings.contact), { mode: boot.mode, termsVersion: boot.registration.termsVersion, privacyVersion: boot.registration.privacyVersion }),
    listEvents: () => ({ items: [] }),
    getPost: () => ({ post: { id: 'post', author: { id: 'friend', nickname: '同好' }, circle: boot.circles[0], text: '日常', images: [], createdAt: Date.now() }, comments: [] }),
    demoVerifyIdentity: () => { boot.user.verification = { status: 'demo_verified' }; return { user: structuredClone(boot.user) }; },
    verifyPhone: () => { boot.user.verification = { status: 'phone_verified', maskedPhone: '138****0000' }; return { user: structuredClone(boot.user) }; }
  };
  global.wx = {
    getStorageSync: key => storage.has(key) ? structuredClone(storage.get(key)) : '',
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
    showToast: options => effects.toasts.push(options.title),
    showModal: options => options.success({ confirm: true }),
    navigateTo: options => effects.navigations.push(options.url),
    navigateBack: () => effects.navigations.push('back'),
    switchTab: options => effects.navigations.push(options.url),
    setClipboardData: options => effects.clipboard.push(options.data),
    stopPullDownRefresh() {}
  };
  shared.verificationLeft();
  api.resumeUploads = async () => ({ images: [], completed: [], pending: [], failures: [] });
  api.discardUploads = async () => {};
  api.call = async (action, payload) => {
    calls.push({ action, payload: payload === undefined ? undefined : structuredClone(payload) });
    if (!handlers[action]) throw new Error('Unexpected action: ' + action);
    return handlers[action](payload);
  };
  return { boot, handlers, calls, effects };
}

function instantiate(name) {
  let definition;
  global.Page = value => { definition = value; };
  const source = require.resolve('../miniprogram/pages/' + name + '/index');
  delete require.cache[source];
  require(source);
  return Object.assign({}, definition, { data: structuredClone(definition.data), _closed: false, setData(values) { Object.assign(this.data, values); } });
}

async function settle(page) {
  for (let i = 0; i < 30 && (page.data.loading || page.data.eventsBusy); i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '');
}

async function mount(name, options = {}) {
  const page = instantiate(name);
  page.onLoad(options);
  await settle(page);
  return page;
}

test('verification gating preserves post and comment drafts, deduplicates navigation and never replays a write', async () => {
  const { boot, handlers, calls, effects } = setup();
  handlers.createPost = () => { if (boot.user.verification.status === 'unverified') throw verificationRequired(); return {}; };
  handlers.addComment = () => { throw verificationRequired(); };
  const compose = await mount('compose');
  compose.inputTitle(event({}, '周末想去走走'));
  compose.input(event({}, '有人一起去公园吗？'));
  compose.setData({ images: ['/saved-photo.png'], selectedTopics: ['公园偶遇'] });
  await Promise.all([compose.submit(), compose.submit()]);
  assert.equal(calls.filter(item => item.action === 'createPost').length, 1);
  assert.equal(compose.data.busy, false);
  assert.equal(compose.data.text, '有人一起去公园吗？');
  assert.equal(compose.data.title, '周末想去走走');
  assert.deepEqual(compose.data.images, ['/saved-photo.png']);

  const post = await mount('post', { id: 'post' });
  post.input(event({}, '我也喜欢公园里的小狗。'));
  post.setData({ replyId: 'reply', replyName: '同好' });
  await post.send();
  assert.deepEqual(effects.navigations, ['/pages/register/index?from=action']);
  assert.equal(post.data.text, '我也喜欢公园里的小狗。');
  assert.equal(post.data.replyId, 'reply');
  assert.equal(post.data.busy, false);

  const registration = await mount('register', { from: 'action' });
  assert.equal(registration.data.fromAction, true);
  registration.toggleConsent();
  await registration.demoVerify();
  registration.onUnload();
  post.onShow();
  await settle(post);
  await compose.refresh();
  assert.equal(calls.filter(item => item.action === 'createPost').length, 1, 'registration and page refresh do not publish');
  assert.equal(calls.filter(item => item.action === 'addComment').length, 1, 'registration and page refresh do not post a comment');
  assert.equal(post.data.text, '我也喜欢公园里的小狗。');
  assert.equal(post.data.replyId, 'reply');
  assert.deepEqual(compose.data.images, ['/saved-photo.png']);
  await compose.submit();
  assert.equal(calls.filter(item => item.action === 'createPost').length, 2, 'the user explicitly submits again');
  assert.equal(compose.data.text, '');
});

test('registration navigation recovers after a failed navigation or after leaving registration', async () => {
  const { effects } = setup();
  global.wx.navigateTo = options => { effects.navigations.push(options.url); options.fail(); };
  shared.openVerification('me');
  shared.openVerification('me');
  assert.equal(effects.navigations.length, 2, 'failed navigation can be tried again');
  global.wx.navigateTo = options => effects.navigations.push(options.url);
  shared.openVerification('me');
  shared.openVerification('me');
  assert.equal(effects.navigations.length, 3, 'an open registration page is not duplicated');
  const registration = await mount('register');
  registration.onUnload();
  shared.openVerification();
  assert.equal(effects.navigations.at(-1), '/pages/register/index?from=action');
});

test('reading policies does not consent, unchanged refresh preserves a choice and new policy versions reset it', async () => {
  const { boot, calls, effects } = setup();
  const page = await mount('register');
  assert.equal(page.data.consentAccepted, false);
  page.policy(event({ type: 'privacy' }));
  assert.equal(page.data.consentAccepted, false);
  assert.equal(effects.navigations.at(-1), '/pages/policy/index?type=privacy');
  await page.demoVerify();
  assert.equal(calls.some(item => item.action === 'demoVerifyIdentity'), false);
  page.toggleConsent();
  await page.refresh();
  assert.equal(page.data.consentAccepted, true);
  boot.registration.privacyVersion = '2026-10-01';
  await page.refresh();
  assert.equal(page.data.consentAccepted, false);
  page.toggleConsent();
  boot.registration.termsVersion = '';
  await page.refresh();
  page.toggleConsent();
  await page.demoVerify();
  assert.equal(page.data.versionsReady, false);
  assert.equal(calls.some(item => item.action === 'demoVerifyIdentity'), false);
  page.onUnload();
});

test('demo verification sends explicit versioned consent without a phone or a fabricated authorization code', async () => {
  const { calls, effects } = setup();
  const page = await mount('register');
  page.toggleConsent();
  await page.phoneNumber({ detail: { code: 'irrelevant-in-demo', errMsg: 'getPhoneNumber:ok' } });
  await Promise.all([page.demoVerify(), page.demoVerify()]);
  assert.deepEqual(calls.filter(item => ['verifyPhone', 'demoVerifyIdentity'].includes(item.action)), [
    { action: 'demoVerifyIdentity', payload: { consent: acceptedConsent } }
  ]);
  assert.deepEqual(effects.navigations, ['back']);
  assert.equal(page.data.maskedPhone, '');
  page.onUnload();
});

test('cloud verification requires capability, consent and a successful native authorization code', async () => {
  const { boot, calls, effects } = setup({ mode: 'cloud' });
  const page = await mount('register');
  const authorized = { detail: { code: 'native-once-code', errMsg: 'getPhoneNumber:ok' } };
  await page.phoneNumber(authorized);
  page.toggleConsent();
  await page.phoneNumber(authorized);
  assert.equal(calls.some(item => item.action === 'verifyPhone'), false, 'unconfigured capability cannot be bypassed');
  boot.registration.phoneEnabled = true;
  await page.refresh();
  await page.phoneNumber({ detail: { errMsg: 'getPhoneNumber:fail user deny' } });
  await page.phoneNumber({ detail: { errMsg: 'getPhoneNumber:ok' } });
  await page.phoneNumber({ detail: { code: 'denied-code', errMsg: 'getPhoneNumber:fail user deny' } });
  await page.demoVerify();
  assert.equal(calls.some(item => ['verifyPhone', 'demoVerifyIdentity'].includes(item.action)), false);
  await Promise.all([page.phoneNumber(authorized), page.phoneNumber(authorized)]);
  assert.deepEqual(calls.filter(item => item.action === 'verifyPhone'), [
    { action: 'verifyPhone', payload: { code: 'native-once-code', consent: acceptedConsent } }
  ]);
  assert.deepEqual(effects.navigations, ['back']);
  page.onUnload();
});

test('a failed phone request leaves registration retryable and an unloaded page does not navigate', async () => {
  const { handlers, effects } = setup({ mode: 'cloud', phoneEnabled: true });
  const page = await mount('register');
  page.toggleConsent();
  handlers.verifyPhone = () => { throw new Error('网络暂时中断'); };
  await page.phoneNumber({ detail: { code: 'first', errMsg: 'getPhoneNumber:ok' } });
  assert.equal(page.data.busy, false);
  assert.equal(page.data.consentAccepted, true);
  assert.ok(effects.toasts.includes('网络暂时中断'));
  assert.deepEqual(effects.navigations, []);
  let finish;
  handlers.verifyPhone = () => new Promise(resolve => { finish = resolve; });
  const pending = page.phoneNumber({ detail: { code: 'retry', errMsg: 'getPhoneNumber:ok' } });
  page.onUnload();
  finish({ user: {} });
  await pending;
  assert.deepEqual(effects.navigations, []);
});

test('pet byline publication is independent from biography publication and clears when no pet is registered', async () => {
  const { boot, handlers, calls } = setup();
  boot.user.pet = { name: '糯米', type: 'cat' };
  handlers.updateProfile = () => ({});
  const page = await mount('profile');
  assert.equal(page.data.showPet, false);
  assert.equal(page.data.publicProfile, false);
  page.petDisplayState(event({ value: 'yes' }));
  await page.save();
  let payload = calls.filter(item => item.action === 'updateProfile').at(-1).payload;
  assert.equal(payload.showPet, true);
  assert.equal(payload.publicProfile, false);
  assert.equal('pet' in payload, false, 'changing public consent must not resubmit or replace separately saved pet records');
  assert.equal(page.data.pets[0].name, '糯米');
  page.privacyState(event({ value: 'public' }));
  page.petDisplayState(event({ value: 'no' }));
  await page.save();
  payload = calls.filter(item => item.action === 'updateProfile').at(-1).payload;
  assert.equal(payload.publicProfile, true);
  assert.equal(payload.showPet, false);
  page.petDisplayState(event({ value: 'yes' }));
  page.petState(event({ value: 'no' }));
  page.petDisplayState(event({ value: 'yes' }));
  await page.save();
  payload = calls.filter(item => item.action === 'updateProfile').at(-1).payload;
  assert.equal(payload.pet, null);
  assert.equal(payload.showPet, false);
  assert.equal(payload.publicProfile, true);
});

test('public pet labels only use the pet information returned with a public author', () => {
  setup();
  assert.equal(shared.person({ id: 'private', nickname: '同好' }).petLabel, '');
  assert.equal(shared.person({ id: 'public', pet: { name: '糯米', type: 'cat' } }).petLabel, '糯米 · 猫');
  assert.equal(shared.person({ id: 'invalid', pet: { name: '糯米' } }).petLabel, '');
  assert.equal(shared.comment({ author: { pet: { name: '豆包', type: 'dog' } } }).author.petLabel, '豆包 · 狗');
  assert.equal(shared.post({ author: { nickname: '私密宠物资料' } }).author.petLabel, '');
});

test('author privacy copy describes the separate pet setting without claiming published pet data is private', async () => {
  const { handlers } = setup();
  let author = { id: 'self', nickname: '同好', isMine: true, publicProfile: false, showPet: true, pet: { name: '糯米', type: 'cat' } };
  handlers.getUserProfile = () => ({ user: structuredClone(author), posts: [] });
  const page = await mount('author', { userId: 'self' });
  assert.match(page.data.privacyText, /宠物名字和类型已按头像旁展示设置公开/);
  author.showPet = false;
  await page.refresh();
  assert.match(page.data.privacyText, /简介与宠物资料仅自己可见/);
  author = { ...author, isMine: false, showPet: true };
  await page.refresh();
  assert.match(page.data.privacyText, /公开了宠物名字和类型/);
  delete author.pet;
  await page.refresh();
  assert.match(page.data.privacyText, /暂未公开更多介绍/);
});

test('pet statistics request only aggregates for administrators and handle zero registered pets', async () => {
  const { boot, calls, handlers } = setup();
  const scope = '按每个账号的首只宠物统计类型；可登记多只，未填写不代表没有宠物';
  const stats = { totalUsers: 5, profilesWithPet: 3, profilesWithoutPet: 2, publicPetProfiles: 1, byType: { cat: 2, dog: 1, other: 0 }, scope };
  handlers.getPetStats = () => structuredClone(stats);
  const page = await mount('petstats');
  assert.equal(page.data.isAdmin, false);
  assert.equal(page.data.stats, null);
  assert.equal(calls.some(item => item.action === 'getPetStats'), false);
  boot.user.isAdmin = true;
  await page.refresh();
  assert.equal(page.data.isAdmin, true);
  assert.deepEqual(page.data.stats, stats);
  assert.deepEqual(page.data.types.map(item => item.percent), [67, 33, 0]);
  assert.deepEqual(calls.filter(item => item.action === 'getPetStats'), [{ action: 'getPetStats', payload: undefined }]);
  stats.profilesWithPet = 0;
  stats.byType = { cat: 0, dog: 0, other: 0 };
  await page.refresh();
  assert.deepEqual(page.data.types.map(item => item.percent), [0, 0, 0]);
  boot.user.isAdmin = false;
  await page.refresh();
  assert.equal(page.data.stats, null, 'a role change removes previously loaded aggregates');
});

test('policies are readable with real configured contact information and missing versions are not invented', async () => {
  const { boot, effects, calls } = setup();
  const page = await mount('policy', { type: 'privacy' });
  assert.equal(page.data.version, version);
  assert.equal(page.data.sections.length, 7);
  assert.match(page.data.sections[1].text, /不持久保存完整号码/);
  assert.match(page.data.sections[2].text, /生活片区始终不公开/);
  assert.ok(page.data.sections.some(section => /附近位置与参照地点/.test(section.title) && /不写入个人资料或云端/.test(section.text)));
  assert.ok(page.data.sections.some(section => /附近宠友与住宅距离/.test(section.title) && /分别默认关闭/.test(section.text) && /约1公里网格/.test(section.text)));
  page.copyContact();
  assert.deepEqual(effects.clipboard, []);
  boot.settings.contact = '运营方配置的联系渠道';
  boot.registration.privacyVersion = '';
  await page.refresh();
  assert.equal(page.data.version, '待配置');
  page.copyContact();
  assert.deepEqual(effects.clipboard, ['运营方配置的联系渠道']);
  assert.equal(calls.some(item => ['verifyPhone', 'demoVerifyIdentity'].includes(item.action)), false);
});
