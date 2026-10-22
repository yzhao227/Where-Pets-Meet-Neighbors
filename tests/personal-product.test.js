'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const product = require('../miniprogram/product');

test('retained personal mode only allows its private tools and rejects social routes', () => {
  assert.equal(product.personalMode, true);
  for (const retired of ['pages/messages', 'pages/author', 'pages/circle', 'pages/event', 'pages/register', 'social']) {
    assert.equal(product.allowsNavigation('/' + retired + '/index?id=old'), false);
  }
  assert.equal(product.allowsNavigation('/pages/post/index?id=old'), true, 'post data authorization remains in the service');
  assert.equal(product.allowsNavigation('/pages/compose/index?visibility=public'), true, 'the personal editor and service reject public visibility');
  assert.equal(product.allowsNavigation('https://example.invalid/pages/post/index'), false);
});

test('personal app does not initialize cloud even if an old runtime config names a cloud environment', () => {
  let definition, cloudCalls = 0, fallback;
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8');
  vm.runInNewContext(source, {
    App(value) { definition = value; },
    require(name) {
      if (name === './config') return { productMode: 'personal', mode: 'cloud', cloudEnv: 'stale-environment' };
      if (name === './product') return product;
      throw new Error('Unexpected module ' + name);
    },
    wx: { cloud: { init() { cloudCalls++; } }, switchTab(options) { fallback = options.url; } }
  });
  definition.onLaunch();
  assert.equal(cloudCalls, 0);
  assert.equal(definition.globalData.isDemo, true);
  definition.onPageNotFound();
  assert.equal(fallback, '/pages/community/index');
});

test('personal page lifecycle removes platform share callbacks and blocks stale social navigation', () => {
  const oldWx = global.wx, oldPage = global.Page;
  const hidden = [], visited = [], toast = [];
  let registered, loaded = false, shown = false;
  global.wx = { hideShareMenu(options) { hidden.push(options); }, navigateTo(options) { visited.push(options.url); }, showToast(options) { toast.push(options.title); } };
  global.Page = value => { registered = value; };
  try {
    const shared = require('../miniprogram/pages/_shared');
    shared.register({ data: { personalMode: false }, onLoad() { loaded = true; }, onShow() { shown = true; }, onShareAppMessage() {}, onShareTimeline() {} });
    registered.onLoad.call({}); registered.onShow.call({});
    assert.equal(registered.data.personalMode, true);
    assert.equal(registered.onShareAppMessage, undefined);
    assert.equal(registered.onShareTimeline, undefined);
    assert.ok(loaded && shown);
    assert.equal(hidden.length, 2);
    shared.go('/social/pages/chat/index?id=old');
    shared.go('/pages/author/index?userId=old');
    shared.go('/pages/records/index?type=posts');
    assert.deepEqual(visited, ['/pages/records/index?type=posts']);
    assert.equal(toast.length, 2);
  } finally { global.wx = oldWx; global.Page = oldPage; }
});

test('packaging preserves the personal scope even when given an old cloud deployment configuration', () => {
  const deployment = require('../scripts/lib/deployment');
  const config = require('../infra/deployment.example.json');
  const client = deployment.clientConfiguration(config, require('../miniprogram/config'));
  assert.equal(client.productMode, 'personal');
  assert.equal(client.mode, 'demo');
  assert.equal(client.cloudEnv, '');
  assert.equal(client.publicWeb.enabled, false);
});
