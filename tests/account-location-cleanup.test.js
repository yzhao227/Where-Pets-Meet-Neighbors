'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../miniprogram/services/api');
const nearbyLocation = require('../miniprogram/services/nearby-location');
const drafts = require('../miniprogram/pages/_drafts');

function fixture(t) {
  const storage = new Map();
  const effects = { confirm: true, toasts: [], deletions: 0, writesAfterUnload: 0, removeFails: false };
  const saved = { wx: global.wx, Page: global.Page, call: api.call, clearLocalUploads: api.clearLocalUploads };
  global.wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => {
      if (effects.removeFails && key === nearbyLocation.STORAGE_KEY) throw new Error('仅测试存储失败');
      storage.delete(key);
    },
    showModal: options => options.success({ confirm: effects.confirm }),
    showToast: options => effects.toasts.push(options.title),
    stopPullDownRefresh() {}
  };
  const handlers = { deleteAccount: () => ({ deleted: true }) };
  api.call = async action => {
    if (action === 'deleteAccount') { effects.deletions += 1; return handlers.deleteAccount(); }
    if (action === 'bootstrap') return { mode: 'demo', user: { id: 'test-user', nickname: '测试昵称' }, stats: {}, circles: [], settings: {} };
    throw new Error('Unexpected action: ' + action);
  };
  api.clearLocalUploads = async () => {};
  let definition;
  global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/me/index');
  delete require.cache[file];
  require(file);
  const page = { ...definition, _closed: false, data: structuredClone(definition.data), setData(value) {
    if (this._closed) effects.writesAfterUnload += 1;
    Object.assign(this.data, value);
  } };
  nearbyLocation.setManualReference({ latitude: 31.1, longitude: 121.4, coordinateSystem: 'gcj02' }, '测试公共参照点');
  drafts.save('demo:test-user', { text: '只存在于测试内存的草稿' });
  t.after(() => { global.wx = saved.wx; global.Page = saved.Page; api.call = saved.call; api.clearLocalUploads = saved.clearLocalUploads; });
  return { page, storage, effects, handlers };
}

test('account deletion keeps the selected location and draft until deletion is explicitly confirmed successful', async t => {
  const { page, storage, effects, handlers } = fixture(t);
  await page.refresh();
  effects.confirm = false;
  await page.deleteAccount();
  assert.equal(effects.deletions, 0);
  assert.ok(nearbyLocation.getReference());
  assert.ok(storage.has(nearbyLocation.STORAGE_KEY));
  effects.confirm = true;
  handlers.deleteAccount = () => { throw new Error('仅测试断网'); };
  await page.deleteAccount();
  assert.ok(nearbyLocation.getReference());
  assert.ok(storage.has(drafts.KEY));
  handlers.deleteAccount = () => ({ deleted: false });
  await page.deleteAccount();
  assert.ok(nearbyLocation.getReference());
  assert.ok(storage.has(nearbyLocation.STORAGE_KEY));
  assert.match(effects.toasts.at(-1), /尚未确认/);
  handlers.deleteAccount = () => ({ deleted: true });
  await page.deleteAccount();
  assert.equal(nearbyLocation.getReference(), null);
  assert.equal(storage.has(nearbyLocation.STORAGE_KEY), false);
  assert.equal(storage.has(drafts.KEY), false);
  assert.equal(page.data.localCleanupPending, false);
});

test('failed location removal after account deletion disables the reference and offers a local retry without deleting again', async t => {
  const { page, storage, effects } = fixture(t);
  await page.refresh();
  effects.removeFails = true;
  await page.deleteAccount();
  assert.equal(effects.deletions, 1);
  assert.equal(nearbyLocation.getReference(), null, 'memory location cannot be reused after deletion');
  assert.equal(storage.has(nearbyLocation.STORAGE_KEY), true, 'failed device removal remains recoverable');
  assert.equal(page.data.localCleanupPending, true);
  assert.match(effects.toasts.at(-1), /资料已清除/);
  await page.clearLocalDrafts();
  assert.equal(page.data.localCleanupPending, true);
  effects.removeFails = false;
  await page.clearLocalDrafts();
  assert.equal(storage.has(nearbyLocation.STORAGE_KEY), false);
  assert.equal(page.data.localCleanupPending, false);
  assert.equal(effects.deletions, 1, 'retry performs only device cleanup');
});

test('deletion completed after leaving the page still clears location without writing to a closed page', async t => {
  const { page, storage, effects, handlers } = fixture(t);
  await page.refresh();
  let finish;
  handlers.deleteAccount = () => new Promise(resolve => { finish = resolve; });
  const pending = page.deleteAccount();
  await new Promise(resolve => setImmediate(resolve));
  page.onUnload();
  finish({ deleted: true });
  await pending;
  assert.equal(nearbyLocation.getReference(), null);
  assert.equal(storage.has(nearbyLocation.STORAGE_KEY), false);
  assert.equal(effects.writesAfterUnload, 0);
  assert.deepEqual(effects.toasts, []);
});
