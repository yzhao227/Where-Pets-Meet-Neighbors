'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const shared = require('../miniprogram/pages/_shared');

function fixture(t, values = {}) {
  const effects = { calls: [], routes: [], toasts: [] };
  const previous = { wx: global.wx, Page: global.Page, call: shared.api.call };
  global.wx = { getStorageSync() {}, hideShareMenu() {}, showShareMenu() {}, stopPullDownRefresh() {},
    navigateTo: ({ url }) => effects.routes.push(url), showToast: ({ title }) => effects.toasts.push(title) };
  const handlers = {
    bootstrap: () => ({ mode: 'demo', user: { id: 'self' } }),
    getUserProfile: () => ({ user: { id: 'other', nickname: '内存测试作者', isMine: false, ...values }, posts: [] }),
    openDirectChat: () => ({ conversation: { id: 'direct&fixture' } })
  };
  shared.api.call = async (action, payload) => { effects.calls.push({ action, payload }); return handlers[action](payload); };
  let definition;
  global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/author/index.js');
  delete require.cache[require.resolve(file)]; require(file);
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  t.after(() => { page.onUnload(); global.wx = previous.wx; global.Page = previous.Page; shared.api.call = previous.call; });
  return { page, effects, handlers };
}

test('the author message button opens a direct chat without following, adding friends or sending a message', async t => {
  const { page, effects } = fixture(t);
  await page.onLoad({ userId: 'other' });
  assert.equal(page.data.canChat, true);
  await page.startChat();
  assert.deepEqual(effects.calls.at(-1), { action: 'openDirectChat', payload: { targetId: 'other' } });
  assert.deepEqual(effects.routes, ['/social/pages/chat/index?id=direct%26fixture']);
  assert.ok(!effects.calls.some(call => ['followUser', 'sendFriendRequest', 'sendChatMessage'].includes(call.action)));
});

test('editorial profiles explain why private messaging is unavailable without calling the direct-chat API', async t => {
  for (const user of [{ isEditorial: true }, { isMine: true }]) {
    const { page, effects } = fixture(t, user);
    await page.onLoad({ userId: 'other' });
    assert.equal(page.data.canChat, false);
    await page.startChat();
    assert.equal(effects.calls.some(call => call.action === 'openDirectChat'), false);
    assert.deepEqual(effects.routes, []);
    assert.deepEqual(effects.toasts, user.isEditorial ? ['内容整理账号暂不接收私信'] : []);
  }
});

test('opening a private conversation is single-flight and late results cannot navigate a hidden author page', async t => {
  const { page, effects, handlers } = fixture(t);
  await page.onLoad({ userId: 'other' });
  let resolve;
  handlers.openDirectChat = () => new Promise(done => { resolve = done; });
  const first = page.startChat();
  await page.startChat();
  assert.equal(effects.calls.filter(call => call.action === 'openDirectChat').length, 1);
  page.onHide();
  resolve({ conversation: { id: 'late' } }); await first;
  assert.deepEqual(effects.routes, []);
  await page.startChat();
  assert.equal(effects.calls.filter(call => call.action === 'openDirectChat').length, 1);
  await page.onShow();
  handlers.openDirectChat = () => ({ conversation: { id: 'current' } });
  await page.startChat();
  assert.deepEqual(effects.routes, ['/social/pages/chat/index?id=current']);
});

test('failed or malformed private-chat responses are retryable and never navigate to an undefined conversation', async t => {
  const { page, effects, handlers } = fixture(t);
  await page.onLoad({ userId: 'other' });
  handlers.openDirectChat = () => { throw new Error('仅内存断网'); };
  await page.startChat();
  assert.deepEqual(effects.toasts, ['仅内存断网']);
  assert.equal(page.data.busy, false);
  handlers.openDirectChat = () => ({});
  await page.startChat();
  assert.deepEqual(effects.routes, []);
  assert.match(effects.toasts.at(-1), /会话暂时无法打开/);
  page.onUnload(); await page.startChat();
  assert.equal(effects.calls.filter(call => call.action === 'openDirectChat').length, 2);
});

test('returning before the initial author load finishes refreshes the profile and ignores stale results', async t => {
  const { page, effects, handlers } = fixture(t);
  let resolve;
  handlers.getUserProfile = () => new Promise(done => { resolve = done; });
  const initialLoad = page.onLoad({ userId: 'other' });
  page.onHide();
  handlers.getUserProfile = () => ({ user: { id: 'other', nickname: '当前作者', isMine: false }, posts: [] });
  await page.onShow();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.user.nickname, '当前作者');
  assert.equal(page.data.canChat, true);
  resolve({ user: { id: 'other', nickname: '过期作者', isEditorial: true }, posts: [] });
  await initialLoad;
  assert.equal(page.data.user.nickname, '当前作者');
  assert.equal(page.data.canChat, true);
  await page.startChat();
  assert.deepEqual(effects.routes, ['/social/pages/chat/index?id=direct%26fixture']);
});
