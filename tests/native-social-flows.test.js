'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const exportedApi = require('../miniprogram/services/api');
const { STORAGE_KEY } = require('../miniprogram/services/demo');
const { createSeed } = require('./helpers/community-fixture');

// Only an in-memory store is used: these checks never attach to the user's
// Developer Tools session or touch its existing demo data.
async function fixture() {
  const values = new Map([[STORAGE_KEY, createSeed(Date.now())]]);
  const effects = { toasts: [], navigations: [], previews: [], modals: [], confirm: true };
  global.wx = {
    getStorageSync: key => values.has(key) ? structuredClone(values.get(key)) : '',
    setStorageSync: (key, value) => values.set(key, structuredClone(value)),
    showToast: options => effects.toasts.push(options.title),
    showModal: options => { effects.modals.push(options); if (options.success) options.success({ confirm: effects.confirm }); },
    navigateTo: options => effects.navigations.push(options.url),
    switchTab: options => effects.navigations.push(options.url),
    navigateBack: () => effects.navigations.push('back'),
    setNavigationBarTitle() {}, stopPullDownRefresh() {},
    previewImage: options => effects.previews.push(options)
  };
  const api = exportedApi.createApi(global.wx, { mode: 'demo' });
  exportedApi.call = api.call;
  const verify = () => api.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  await verify();
  return {
    api, effects, verify,
    switchUser(id) { const state = structuredClone(values.get(STORAGE_KEY)); state.currentUserId = id; values.set(STORAGE_KEY, state); }
  };
}

function event(dataset) { return { currentTarget: { dataset } }; }

async function mount(name, options = {}) {
  let definition;
  global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/' + name + '/index');
  delete require.cache[file];
  require(file);
  const page = Object.assign({}, definition, {
    data: structuredClone(definition.data),
    setData(values) { assert.notEqual(this._closed, true, 'a closed page must not be updated'); Object.assign(this.data, values); }
  });
  page.onLoad(options);
  for (let tries = 0; tries < 30 && page.data.loading; tries += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '');
  return page;
}

test('circle joining unlocks publishing, leaving is cancelable and updates personal records', async () => {
  const { api, effects } = await fixture();
  const circle = await mount('circle', { id: 'circle-cats' });
  const members = circle.data.circle.memberCount;
  circle.compose();
  assert.equal(effects.navigations.length, 0);
  assert.match(effects.toasts.at(-1), /先加入/);
  await Promise.all([circle.join(), circle.join()]);
  assert.equal(circle.data.circle.isJoined, true);
  assert.equal(circle.data.circle.memberCount, members + 1);
  circle.compose();
  assert.equal(effects.navigations.at(-1), '/pages/compose/index?circleId=circle-cats');
  const records = await mount('records', { type: 'circles' });
  assert.ok(records.data.items.some(item => item.id === 'circle-cats'));
  effects.confirm = false;
  await circle.join();
  assert.equal((await api.call('getCircle', { id: 'circle-cats' })).circle.isJoined, true);
  effects.confirm = true;
  await circle.join();
  await records.refresh();
  assert.equal(circle.data.circle.memberCount, members);
  assert.equal(records.data.items.some(item => item.id === 'circle-cats'), false);
  circle.onUnload(); records.onUnload();
});

test('real demo notifications open the right post or event and read state round-trips', async () => {
  const f = await fixture();
  const { post } = await f.api.call('createPost', { circleId: 'circle-neighbors', text: '自动回归测试帖子，仅存在内存中。', images: [] });
  f.switchUser('demo-lin');
  await f.verify();
  await f.api.call('addComment', { targetType: 'post', targetId: post.id, text: '自动回归测试回应。' });
  f.switchUser('demo-self');
  await f.api.call('joinEvent', { id: 'demo-event-coffee', join: true });
  const page = await mount('messages');
  const postMessage = page.data.items.find(item => item.targetType === 'post' && item.targetId === post.id);
  const eventMessage = page.data.items.find(item => item.targetType === 'event' && item.targetId === 'demo-event-coffee');
  assert.ok(postMessage); assert.ok(eventMessage);
  await Promise.all([page.openMessage(event({ id: postMessage.id })), page.openMessage(event({ id: postMessage.id }))]);
  assert.deepEqual(f.effects.navigations, ['/pages/post/index?id=' + post.id]);
  assert.equal((await f.api.call('listMessages')).items.find(item => item.id === postMessage.id).isRead, true);
  await page.openMessage(event({ id: eventMessage.id }));
  assert.equal(f.effects.navigations.at(-1), '/pages/event/index?id=demo-event-coffee');
  await page.refresh();
  assert.equal(page.data.items.find(item => item.id === postMessage.id).isRead, true);
  const welcome = page.data.items.find(item => item.targetType === 'system');
  await page.openMessage(event({ id: welcome.id }));
  assert.equal(f.effects.modals.at(-1).content, welcome.text);
  await page.readAll();
  assert.equal(page.data.unreadCount, 0);
  assert.ok(page.data.items.every(item => item.isRead));
  page.onUnload();
});

test('message write failures remain retryable without losing unread state or opening a target', async () => {
  const { api, effects } = await fixture();
  await api.call('joinEvent', { id: 'demo-event-coffee', join: true });
  const page = await mount('messages');
  const item = page.data.items.find(value => value.targetType === 'event');
  const unread = page.data.unreadCount;
  exportedApi.call = async (action, payload) => {
    if (action === 'readMessage') throw new Error('测试：本机存储空间不足');
    return api.call(action, payload);
  };
  await page.openMessage(event({ id: item.id }));
  assert.equal(effects.navigations.length, 0);
  assert.equal(page.data.busy, false);
  assert.equal(page.data.unreadCount, unread);
  assert.equal(page.data.items.find(value => value.id === item.id).isRead, false);
  assert.match(effects.toasts.at(-1), /存储空间不足/);
  exportedApi.call = api.call;
  await page.openMessage(event({ id: item.id }));
  assert.equal(effects.navigations.at(-1), '/pages/event/index?id=demo-event-coffee');
  page.onUnload();
});

test('detail share payloads preserve the target and photo preview opens the selected image', async () => {
  const { effects } = await fixture();
  const post = await mount('post', { id: 'demo-post-1' });
  post.preview(event({ src: post.data.post.images[0] }));
  assert.deepEqual(effects.previews.at(-1), { urls: post.data.post.images, current: post.data.post.images[0] });
  assert.equal(post.onShareAppMessage().path, '/pages/post/index?id=demo-post-1');
  assert.ok(post.onShareAppMessage().title.includes('示例'));
  const circle = await mount('circle', { id: 'circle-cats' });
  const activity = await mount('event', { id: 'demo-event-coffee' });
  const author = await mount('author', { userId: 'demo-lin' });
  assert.equal(circle.onShareAppMessage().path, '/pages/circle/index?id=circle-cats');
  assert.equal(activity.onShareAppMessage().path, '/pages/event/index?id=demo-event-coffee');
  assert.equal(author.onShareAppMessage().path, '/pages/author/index?userId=demo-lin');
  for (const page of [post, circle, activity, author]) page.onUnload();
});
