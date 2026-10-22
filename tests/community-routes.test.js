'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const config = require('../miniprogram/config');
const product = require('../miniprogram/product');
const app = require('../miniprogram/app.json');
const project = require('../project.config.json');

const routes = app.pages.concat((app.subPackages || []).flatMap(pkg => pkg.pages.map(page => pkg.root + '/' + page)));

test('the community package restores messages, posting and chat routes without upload exclusions', () => {
  assert.equal(config.productMode, 'community');
  assert.equal(product.personalMode, false);
  assert.equal(new Set(routes).size, routes.length);
  assert.deepEqual(routes.slice().sort(), product.COMMUNITY_PAGES.slice().sort());
  assert.deepEqual(app.tabBar.list.map(item => item.text), ['发现', '出行', '消息', '我的']);
  for (const route of routes) {
    assert.equal(product.allowsNavigation('/' + route + '?id=existing-record'), true, route);
    const excluded = (project.packOptions.ignore || []).some(item => item.type === 'folder'
      ? route === item.value || route.startsWith(item.value + '/')
      : item.type === 'file' && item.value === route + '.js');
    assert.equal(excluded, false, route + ' must remain available in an upload candidate');
  }
  for (const url of ['/pages/removed/index', 'https://example.invalid/pages/post/index', '', null, 123]) {
    assert.equal(product.allowsNavigation(url), false, String(url));
  }
});

test('on-demand detail and editor packages preserve existing URLs while all native tabs stay in the main package', () => {
  const roots = app.subPackages.map(pkg => pkg.root);
  assert.equal(new Set(roots).size, roots.length);
  for (const root of ['pages/local-detail', 'pages/compose']) {
    assert.deepEqual(app.subPackages.find(pkg => pkg.root === root).pages, ['index']);
    assert.equal(app.pages.includes(root + '/index'), false);
    assert.equal(product.allowsNavigation('/' + root + '/index?id=previously-shared'), true);
  }
  const social = app.subPackages.find(pkg => pkg.root === 'social');
  for (const name of ['friends', 'chat', 'contribute', 'submissions-manage', 'private-library']) {
    assert.ok(social.pages.includes('pages/' + name + '/index'), name);
  }
  assert.equal(social.pages.includes('pages/group-create/index'), false);
  assert.equal(product.allowsNavigation('/social/pages/group-create/index'), false);
  for (const tab of app.tabBar.list) {
    assert.ok(app.pages.includes(tab.pagePath));
    assert.equal(roots.some(root => tab.pagePath.startsWith(root + '/')), false);
  }
});

test('restoring community routes keeps startup local until an actual cloud configuration is supplied', () => {
  let definition, initialized = 0, fallback;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8'), {
    App(value) { definition = value; },
    require(name) {
      if (name === './config') return config;
      if (name === './product') return product;
      throw new Error('Unexpected startup dependency ' + name);
    },
    wx: {
      cloud: { init() { initialized++; } },
      switchTab(options) { fallback = options.url; }
    }
  });
  definition.onLaunch();
  assert.equal(definition.globalData.personalMode, false);
  assert.equal(definition.globalData.isDemo, true);
  assert.equal(definition.globalData.mode, 'demo');
  assert.equal(initialized, 0);
  definition.onPageNotFound();
  assert.equal(fallback, '/pages/community/index');
});
