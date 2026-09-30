const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../miniprogram/services/api');
const { createDemoService } = require('../miniprogram/services/demo');

function pageAt(name) {
  let definition; global.Page = value => { definition = value; };
  const file = require.resolve('../miniprogram/pages/' + name + '/index'); delete require.cache[file]; require(file);
  return { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
}

test('circle square opens existing circles, preserves membership and refreshes after joining or leaving', async t => {
  const saved = { wx: global.wx, Page: global.Page, call: api.call };
  t.after(() => { global.wx = saved.wx; global.Page = saved.Page; api.call = saved.call; });
  const storage = new Map(), navigations = [];
  global.wx = {
    getStorageSync: key => structuredClone(storage.get(key) || ''), setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    stopPullDownRefresh() {}, showToast() {}, setNavigationBarTitle() {},
    showModal: options => options.success({ confirm: true }), navigateTo: options => navigations.push(options.url)
  };
  const service = createDemoService(global.wx); api.call = service.call;
  await api.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  const square = pageAt('circle-square'); await square.onLoad();
  const circle = square.data.circles.find(item => !item.isJoined);
  assert.ok(circle, 'uses real circle catalogue in an isolated account');
  square.openCircle({ currentTarget: { dataset: { id: circle.id } } });
  assert.equal(navigations.at(-1), '/pages/circle/index?id=' + encodeURIComponent(circle.id));
  const detail = pageAt('circle'); detail.id = circle.id; await detail.refresh();
  assert.equal(detail.data.circle.isJoined, false);
  await detail.join(); await square.onShow();
  let joined = square.data.circles.find(item => item.id === circle.id);
  assert.equal(joined.isJoined, true); assert.equal(joined.memberCount, circle.memberCount + 1);
  const restarted = createDemoService(global.wx);
  assert.equal((await restarted.call('getCircle', { id: circle.id })).circle.isJoined, true);
  await detail.join(); await square.onPullDownRefresh();
  joined = square.data.circles.find(item => item.id === circle.id);
  assert.equal(joined.isJoined, false); assert.equal(joined.memberCount, circle.memberCount);
  api.call = async () => { throw Error('暂时断网'); };
  await square.refresh(); assert.equal(square.data.error, '暂时断网');
  api.call = service.call; await square.refresh(); assert.equal(square.data.error, '');
  detail.onUnload(); square.onUnload();
});
