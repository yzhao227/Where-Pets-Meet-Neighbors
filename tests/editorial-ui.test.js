'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const exportedApi = require('../miniprogram/services/api');
const shared = require('../miniprogram/pages/_shared');
const { EDITORS } = require('../miniprogram/data/editors');

// Synthetic data is confined to this test file. These tests never seed posts or
// attach to the user's Developer Tools storage, clipboard or login session.
function fixture(t) {
  const previousWx = global.wx;
  const previousPage = global.Page;
  const previousCall = exportedApi.call;
  const effects = { clipboard: [], toasts: [], modals: [], calls: [], clipboardFails: false };
  global.wx = {
    showToast(options) { effects.toasts.push(options.title); },
    setClipboardData(options) {
      effects.clipboard.push(options.data);
      if (effects.clipboardFails) options.fail(); else options.success();
    },
    showModal(options) { effects.modals.push(options); options.success({ confirm: true }); },
    setNavigationBarTitle() {}, stopPullDownRefresh() {}
  };
  t.after(() => { global.wx = previousWx; global.Page = previousPage; exportedApi.call = previousCall; });
  return effects;
}

function instantiate(name) {
  let definition;
  global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/' + name + '/index');
  delete require.cache[file];
  require(file);
  return Object.assign({}, definition, {
    data: structuredClone(definition.data), _closed: false,
    setData(values) { assert.notEqual(this._closed, true); Object.assign(this.data, values); }
  });
}

function event(index) { return { currentTarget: { dataset: { index } } }; }
function testPost(contentType = 'photo') {
  return {
    id: 'test-editorial', contentType, kind: 'daily', title: '测试用资料', text: '仅用于自动测试。',
    author: EDITORS[5], createdAt: 0, images: ['https://example.invalid/1.jpg', 'https://example.invalid/2.jpg'],
    source: { publisher: '测试来源', title: '测试原文', author: '测试原作者', url: 'https://example.invalid/article', checkedAt: '2026-09-29', permissionRef: 'private-source-evidence' },
    imageCredits: [1, 2].map(index => ({
      imageUrl: 'https://example.invalid/' + index + '.jpg',
      originalUrl: 'https://example.invalid/original/' + index,
      sourceUrl: 'https://example.invalid/photo/' + index,
      author: '测试图片作者 ' + index, licenseName: 'CC BY 4.0',
      licenseUrl: 'https://example.invalid/license/' + index,
      attribution: '测试署名 ' + index,
      modifiedDescription: '仅测试缩放说明 ' + index,
      permissionRef: 'private-evidence-' + index,
      agreement: 'private agreement must never reach the page'
    }))
  };
}

test('editorial identities retain their nickname and cannot inherit a member pet biography', () => {
  assert.equal(EDITORS.length, 6);
  for (const editor of EDITORS) {
    const person = shared.person({ ...editor, pet: { type: 'cat', name: '不应显示的宠物' } });
    assert.equal(person.isEditorial, true);
    assert.equal(person.nickname, editor.nickname);
    assert.equal(person.pet, null);
    assert.equal(person.petLabel, '');
  }
  const member = shared.person({ nickname: '测试成员', pet: { type: 'dog', name: '测试犬' } });
  assert.equal(member.accountLabel, '');
  assert.equal(member.petLabel, '测试犬 · 狗');
});

test('photo and knowledge cards keep provenance separate from the display identity', () => {
  const raw = testPost();
  const photo = shared.post(raw);
  assert.equal(photo.kindText, '图片分享');
  assert.equal(photo.timeText, '');
  assert.equal(photo.hasRequiredCredits, true);
  assert.equal(photo.source.author, '测试原作者');
  assert.equal(photo.author.nickname, EDITORS[5].nickname);
  assert.equal(photo.imageCredits.length, 2);
  assert.equal(photo.imageCredits[1].author, '测试图片作者 2');
  assert.equal(photo.imageCredits[1].attribution, '测试署名 2');
  assert.equal(photo.imageCredits[1].licenseName, 'CC BY 4.0');
  assert.equal(photo.imageCredits[1].modifiedDescription, '仅测试缩放说明 2');
  assert.equal('permissionRef' in photo.source, false);
  assert.ok(photo.imageCredits.every(credit => !('permissionRef' in credit) && !('agreement' in credit)));
  assert.equal(raw.imageCredits[0].permissionRef, 'private-evidence-1', 'decorating does not mutate editorial evidence');
  const knowledge = shared.post(testPost('knowledge'));
  assert.equal(knowledge.kindText, '养宠知识');
  assert.equal(knowledge.timeText, '');
  const legacy = testPost();
  delete legacy.imageCredits[0].modifiedDescription;
  legacy.imageCredits[0].changes = '测试旧版裁切说明';
  assert.equal(shared.post(legacy).imageCredits[0].modifiedDescription, '测试旧版裁切说明');
  for (const licenseName of ['CC0', 'CC0 1.0 Universal', 'Public domain', 'Public Domain Mark 1.0', 'PD']) {
    const unrestricted = testPost();
    unrestricted.imageCredits.forEach(credit => { credit.licenseName = licenseName; });
    const view = shared.post(unrestricted);
    assert.equal(view.hasRequiredCredits, false, licenseName + ' does not require front-end attribution');
    assert.equal(view.imageCredits[1].author, '测试图片作者 2', 'internal metadata is retained');
  }
});

test('source and license copying selects the requested image index', t => {
  const effects = fixture(t);
  const page = instantiate('post');
  const raw = testPost();
  raw.imageCredits[0].licenseName = 'CC0';
  page.data.post = shared.post(raw);
  assert.equal(page.data.post.imageCredits[0].requiresAttribution, false);
  assert.equal(page.data.post.imageCredits[1].requiresAttribution, true);
  page.copyImageSource(event('1'));
  page.copyImageLicense(event(1));
  page.copyImageSource(event(0));
  page.copySource();
  assert.deepEqual(effects.clipboard, [
    'https://example.invalid/photo/2', 'https://example.invalid/license/2',
    'https://example.invalid/photo/1', 'https://example.invalid/article'
  ]);
  for (const index of [undefined, -1, 0.5, '1x', '', 9]) page.copyImageSource(event(index));
  assert.equal(effects.clipboard.length, 4, 'invalid indices must not fall back to the first picture');
  assert.match(effects.toasts.at(-1), /链接暂不可用/);
});

test('only valid HTTPS links reach the clipboard and write failures are visible', t => {
  const effects = fixture(t);
  const page = instantiate('post');
  page.data.post = shared.post(testPost());
  for (const url of [
    'http://example.invalid/a', 'javascript:alert(1)', '//example.invalid/a',
    'https://', 'https://bad host/a', 'https://user:secret@example.invalid/a',
    'https://example.invalid\\@evil.invalid/a', 'https://example.invalid\n/a',
    'https://-bad.invalid/a', 'https://example.invalid:65536/a', 'https://example.invalid/%ZZ'
  ]) {
    page.data.post.source.url = url;
    page.copySource();
  }
  assert.equal(effects.clipboard.length, 0);
  assert.ok(effects.toasts.every(value => /链接暂不可用/.test(value)));
  assert.equal(shared.httpsUrl('https://example.invalid:443/a?b=%E7%8C%AB#c'), 'https://example.invalid:443/a?b=%E7%8C%AB#c');
  effects.clipboardFails = true;
  page.data.post.source.url = 'https://example.invalid/article';
  page.copySource();
  assert.match(effects.toasts.at(-1), /未能复制/);
  global.wx.setClipboardData = () => { throw new Error('test clipboard unavailable'); };
  page.copySource();
  assert.match(effects.toasts.at(-1), /未能复制/);
});

test('late clipboard callbacks do not toast over another page', t => {
  const effects = fixture(t);
  const page = instantiate('post');
  page.data.post = shared.post(testPost());
  let callbacks;
  global.wx.setClipboardData = options => { callbacks = options; };
  page.copyImageLicense(event(1));
  page.onUnload();
  callbacks.success(); callbacks.fail();
  assert.deepEqual(effects.toasts, []);
});

test('profile following and sharing use the correct account nickname', async t => {
  const effects = fixture(t);
  let user = { ...EDITORS[0], isFollowing: false, publicProfile: true, pet: { name: '不可展示', type: 'cat' } };
  exportedApi.call = async (action, payload) => {
    effects.calls.push({ action, payload });
    if (action === 'bootstrap') return { mode: 'cloud', user: { isAdmin: false } };
    if (action === 'getUserProfile') return { user, posts: [] };
    if (action === 'followUser') { user = { ...user, isFollowing: payload.follow }; return {}; }
    throw new Error('Unexpected test action: ' + action);
  };
  const page = instantiate('author');
  page.userId = user.id;
  await page.refresh();
  assert.equal(page.data.user.pet, null);
  assert.equal(page.data.petText, '');
  assert.equal(page.data.privacyText, '');
  assert.equal(page.onShareAppMessage().title, '在有宠有邻看看' + user.nickname);
  await page.follow();
  assert.equal(page.data.user.isFollowing, true);
  assert.equal(effects.toasts.at(-1), '已关注');
  await page.follow();
  assert.equal(effects.modals.at(-1).title, '取消关注「' + user.nickname + '」？');
  assert.match(effects.modals.at(-1).content, /该账号的内容/);
  assert.equal(page.data.user.isFollowing, false);
});

test('following records confirm the selected nickname and remove the matching account', async t => {
  const effects = fixture(t);
  let items = [{ ...EDITORS[1] }];
  exportedApi.call = async (action, payload) => {
    effects.calls.push({ action, payload });
    if (action === 'bootstrap') return { mode: 'demo', user: {} };
    if (action === 'listFollowing') return { items };
    if (action === 'followUser') { items = items.filter(item => item.id !== payload.userId); return {}; }
    throw new Error('Unexpected test action: ' + action);
  };
  const page = instantiate('records');
  page.data.type = 'following';
  await page.refresh();
  assert.equal(page.data.items[0].nickname, EDITORS[1].nickname);
  await page.unfollow({ currentTarget: { dataset: { id: EDITORS[1].id } } });
  assert.equal(effects.modals.at(-1).title, '取消关注「' + EDITORS[1].nickname + '」？');
  assert.equal(page.data.items.length, 0);
  assert.deepEqual(effects.calls.find(call => call.action === 'followUser').payload, { userId: EDITORS[1].id, follow: false });
});

test('attribution controls bind each image index and public fields without evidence references', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/post/index.wxml'), 'utf8');
  assert.match(markup, /wx:if="\{\{post\.hasRequiredCredits\}\}"/);
  assert.match(markup, /wx:if="\{\{credit\.requiresAttribution\}\}"/);
  assert.match(markup, /wx:for="\{\{post\.imageCredits\}\}"[^>]*wx:for-index="creditIndex"/);
  for (const handler of ['copyImageSource', 'copyImageLicense']) {
    assert.match(markup, new RegExp('<button[^>]*data-index="\\{\\{creditIndex\\}\\}"[^>]*bindtap="' + handler + '"'));
  }
  for (const field of ['credit.author', 'credit.attribution', 'credit.licenseName', 'credit.modifiedDescription']) assert.ok(markup.includes('{{' + field + '}}'));
  assert.doesNotMatch(markup, /permissionRef|agreement|reviewer/);
});

test('retired member and editorial attachments cannot become a visible post through shared decoration', () => {
  const member = { id: 'member-video', contentType: 'video', images: [], video: { url: 'cloud://test/video.mp4', durationSeconds: 9 },
    text: '刚刚拍下的日常', author: { id: 'member', nickname: '真实会员' }, createdAt: Date.now() };
  assert.throws(() => shared.post(member), { code: 'NOT_FOUND', message: '内容已下架' });
  assert.throws(() => shared.post({ ...member, source: { publisher: '来源', url: 'https://example.org/video' } }), { code: 'NOT_FOUND' });
  const photo = shared.post({ ...member, video: null, contentType: 'photo' });
  assert.equal(photo.isEditorialContent, false); assert.equal(photo.timeText, '刚刚');
  assert.equal(photo.kindText, '图片分享');
});
