'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the shipped navigation methods and the real native-back binding.
// The real render function uses a tiny scroll-clamping DOM fixture; no network,
// browser history reconstruction or persisted application state is needed.
function runtime() {
  const source = fs.readFileSync(path.resolve(__dirname, '../preview/runtime.js'), 'utf8');
  const resultStart = source.indexOf('  function result(');
  const adapterStart = source.indexOf('  window.wx={');
  const navigationStart = source.indexOf('  function invoke(');
  const navigationEnd = source.indexOf('  const expressionCache=', navigationStart);
  const renderStart = source.indexOf('  function render(){');
  const renderEnd = source.indexOf('  function fatal(', renderStart);
  const schedulerStart = source.indexOf('  function flushRender(){');
  const schedulerEnd = source.indexOf('  function installInputClickGuard(){', schedulerStart);
  const backBinding = source.split('\n').find(line => line.includes("document.getElementById('native-back').onclick="));
  assert.ok(resultStart >= 0 && adapterStart > resultStart && navigationStart > adapterStart && navigationEnd > navigationStart && backBinding);
  const effects = { lifecycle: [], renders: [], history: [], outbound: [], failures: [], storageCalls: [] };
  const routeNames = ['community', 'nearby', 'messages', 'me', 'local-detail', 'places', 'places-manage', 'event', 'web', 'post', 'compose', 'profile'];
  const tabRoutes = routeNames.slice(0, 4).map(name => 'pages/' + name + '/index');
  const pages = {}, definitions = {};
  for (const name of routeNames) {
    const route = 'pages/' + name + '/index';
    pages[route] = { template: 'fixture', style: '', config: { navigationBarTitleText: name, navigationStyle: name === 'nearby' ? 'custom' : 'default' } };
    definitions[route] = { data: { draft: 'Only an in-memory fixture', contentHeight: 5000, loading: false },
      onLoad() { effects.lifecycle.push([route, 'load']); }, onReady() { effects.lifecycle.push([route, 'ready']); }, onShow() { effects.lifecycle.push([route, 'show']); },
      onHide() { effects.lifecycle.push([route, 'hide']); }, onUnload() { effects.lifecycle.push([route, 'unload']); } };
  }
  const elements = {
    'native-back': { hidden: true, onclick: null }, 'native-title': { textContent: '' },
    'mini-page-style': { textContent: '' },
    device: { classList: { toggle() {} } }
  };
  const window = { location: { hash: '', assign(url) { effects.outbound.push(url); } } };
  let scrollTop = 0;
  const pageRoot = { maxScroll: 4600, clientHeight: 400, contains() { return false; }, querySelectorAll() { return []; },
    get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = Math.max(0, Math.min(this.maxScroll, Number(value) || 0)); } };
  const context = {
    window, URL, URLSearchParams, definitions, tabs: {}, badges: {},
    manifest: { pages, app: { tabBar: { list: tabRoutes.map(pagePath => ({ pagePath })) } } },
    document: { activeElement: null, createDocumentFragment() { return {}; }, getElementById(id) { if (!elements[id]) throw Error('Unexpected navigation element: ' + id); return elements[id]; } },
    history: { replaceState(value, title, hash) { effects.history.push({ value: structuredClone(value), hash }); window.location.hash = hash; } },
    localStorage: Object.fromEntries(['getItem', 'setItem', 'removeItem'].map(name => [name, () => { effects.storageCalls.push(name); throw Error('Navigation must not persist or replay state'); }])),
    pageRoot, clone: value => structuredClone(value), requireModule() {},
    notifyFailure(error) { effects.failures.push(error); },
    modal() {}, actionSheet() {}, previewImage() {}, toast() {},
    queueMicrotask, setTimeout, clearTimeout,
    nativeCss() { return ''; }, makeTemplate() { return { childNodes: [] }; }, renderChildren() {}, restoreInputFocus() {}, renderTabs() {},
    replacePageContent() { const data = context.testApi.current.data; pageRoot.maxScroll = Math.max(0, (data.loading ? 100 : data.contentHeight) - pageRoot.clientHeight); pageRoot.scrollTop = pageRoot.scrollTop; },
    render() { effects.renders.push(context.testApi.current && context.testApi.current.route); context.renderFrame(); }
  };
  vm.createContext(context);
  const resultCode = source.slice(resultStart, source.indexOf('  function toast(', resultStart));
  vm.runInContext('let stack=[],current=null,renderQueued=false,pointerRenderHeld=false;\n' + resultCode + source.slice(adapterStart, navigationStart) + source.slice(navigationStart, navigationEnd) +
    source.slice(schedulerStart, schedulerEnd) + source.slice(renderStart, renderEnd).replace('function render()', 'function renderFrame()') + '\n' + backBinding +
    '\nglobalThis.testApi={navigate,get current(){return current;},get stack(){return stack.slice();}};', context);
  return { api: context.testApi, wx: window.wx, window, elements, effects, definitions, pageRoot };
}

test('a detail reloaded after a same-tab article jump still has a back button and exits to nearby', async () => {
  const first = runtime();
  await first.api.navigate('/pages/nearby/index');
  await first.api.navigate('/pages/local-detail/index?guideId=fixture-route');
  const returnHash = first.window.location.hash;
  await first.wx.__openExternal({ url: 'https://example.invalid/public-article' });
  assert.deepEqual(first.effects.outbound, ['https://example.invalid/public-article']);
  const returned = runtime(); // Browser Back recreated the runtime, not its old stack.
  await returned.api.navigate(returnHash.slice(1));
  assert.equal(returned.api.stack.length, 1);
  assert.equal(returned.elements['native-back'].hidden, false);
  await returned.elements['native-back'].onclick();
  assert.equal(returned.api.current.route, 'pages/nearby/index');
  assert.equal(returned.api.stack.length, 1);
  assert.equal(returned.elements['native-back'].hidden, true);
  assert.equal(returned.window.location.hash, '#/pages/nearby/index');
  assert.deepEqual(returned.effects.storageCalls, []);
  assert.ok(returned.effects.history.every(entry => Object.keys(entry.value).length === 0), 'history entries carry no stored page stack or user data');
  assert.deepEqual(returned.effects.failures, []);
});

test('fresh nearby detail, saved-place, event and source routes fall back to nearby while other details fall back to discovery', async () => {
  for (const name of ['local-detail', 'places', 'places-manage', 'event', 'web', 'post', 'compose', 'profile']) {
    const f = runtime();
    const route = 'pages/' + name + '/index';
    await f.api.navigate('/' + route + '?id=fixture-record');
    assert.equal(f.elements['native-back'].hidden, false, name);
    await f.elements['native-back'].onclick();
    const target = ['post', 'compose', 'profile'].includes(name) ? 'pages/community/index' : 'pages/nearby/index';
    assert.equal(f.api.current.route, target, name);
    assert.equal(f.api.stack.length, 1);
    assert.equal(f.elements['native-back'].hidden, true);
    assert.equal(f.effects.lifecycle.filter(([page, event]) => page === route && event === 'unload').length, 1);
    assert.deepEqual(f.effects.storageCalls, []);
    assert.deepEqual(f.effects.failures, []);
  }
});

test('a real preview page stack returns to its previous page with in-memory state before using any fallback', async () => {
  const f = runtime();
  await f.api.navigate('/pages/community/index');
  await f.api.navigate('/pages/local-detail/index?id=fixture-place');
  const previous = f.api.current;
  previous.data.draft = 'Existing in-memory state';
  await f.api.navigate('/pages/places/index?type=visits');
  await f.elements['native-back'].onclick();
  assert.equal(f.api.current, previous);
  assert.equal(f.api.current.data.draft, 'Existing in-memory state');
  assert.equal(f.window.location.hash, '#/pages/local-detail/index?id=fixture-place');
  assert.equal(f.elements['native-back'].hidden, false);
  assert.equal(f.api.stack.length, 2);
  await f.elements['native-back'].onclick();
  assert.equal(f.api.current.route, 'pages/community/index', 'normal history wins even when the detail would otherwise fall back to nearby');
  assert.equal(f.elements['native-back'].hidden, true);
  assert.equal(f.api.stack.length, 1);
  assert.equal(f.effects.lifecycle.some(([route]) => route === 'pages/nearby/index'), false);
  assert.deepEqual(f.effects.storageCalls, []);
});

test('native-back remains hidden on every main tab even after navigating from a detail', async () => {
  const f = runtime();
  for (const name of ['community', 'nearby', 'messages', 'me']) {
    await f.api.navigate('/pages/post/index?id=fixture-post');
    assert.equal(f.elements['native-back'].hidden, false);
    await f.wx.switchTab({ url: '/pages/' + name + '/index' });
    assert.equal(f.elements['native-back'].hidden, true, name);
    assert.equal(f.api.stack.length, 1);
    assert.equal(f.api.current.route, 'pages/' + name + '/index');
  }
  assert.deepEqual(f.effects.storageCalls, []);
  assert.deepEqual(f.effects.failures, []);
});

test('first render delivers onReady after load and show, without firing it again on tab return or back', async () => {
  const f = runtime();
  await f.api.navigate('/pages/community/index');
  const community = f.api.current;
  assert.deepEqual(f.effects.lifecycle, [
    ['pages/community/index', 'load'], ['pages/community/index', 'show'], ['pages/community/index', 'ready']
  ]);
  await f.api.navigate('/pages/post/index?id=fixture');
  await f.elements['native-back'].onclick();
  await f.api.navigate('/pages/nearby/index');
  await f.api.navigate('/pages/community/index');
  assert.equal(f.api.current, community);
  assert.equal(f.effects.lifecycle.filter(([route, phase]) => route === 'pages/community/index' && phase === 'ready').length, 1);
  assert.equal(f.effects.lifecycle.filter(([route, phase]) => route === 'pages/post/index' && phase === 'ready').length, 1);
  assert.deepEqual(f.effects.failures, []);
});

test('a first-render onReady callback is cancelled if the detail was already unloaded', async () => {
  const f = runtime();
  f.definitions['pages/post/index'].onShow = function () {
    f.wx.switchTab({ url: '/pages/nearby/index' });
  };
  await f.api.navigate('/pages/post/index?id=fixture');
  assert.equal(f.api.current.route, 'pages/nearby/index');
  assert.equal(f.effects.lifecycle.some(([route, phase]) => route === 'pages/post/index' && phase === 'ready'), false);
  assert.equal(f.effects.lifecycle.filter(([route, phase]) => route === 'pages/nearby/index' && phase === 'ready').length, 1);
  assert.deepEqual(f.effects.failures, []);
});

test('new detail pages start at the top and Back restores each previous page position', async () => {
  const f = runtime();
  await f.api.navigate('/pages/community/index');
  f.pageRoot.scrollTop = 2140;
  const list = f.api.current;
  list.data.visibleIds = ['retained-page-two-card'];
  await f.api.navigate('/pages/post/index?id=one');
  assert.equal(f.pageRoot.scrollTop, 0);
  f.pageRoot.scrollTop = 610;
  const firstDetail = f.api.current;
  await f.api.navigate('/pages/post/index?id=two');
  assert.equal(f.pageRoot.scrollTop, 0, 'a new instance of the same route cannot inherit the previous post position');
  f.pageRoot.scrollTop = 320;
  await f.wx.navigateBack();
  assert.equal(f.api.current, firstDetail);
  assert.equal(f.pageRoot.scrollTop, 610);
  await f.wx.navigateBack();
  assert.equal(f.api.current, list);
  assert.equal(f.pageRoot.scrollTop, 2140);
  assert.deepEqual(list.data.visibleIds, ['retained-page-two-card']);
  assert.deepEqual(f.effects.storageCalls, [], 'restoring scroll never reads or rewrites persistent user data');
});

test('main tabs retain independent positions across switching and unrelated asynchronous renders', async () => {
  const f = runtime();
  await f.wx.switchTab({ url: '/pages/community/index' });
  f.pageRoot.scrollTop = 1600;
  const community = f.api.current;
  await f.wx.switchTab({ url: '/pages/nearby/index' });
  assert.equal(f.pageRoot.scrollTop, 0);
  f.pageRoot.scrollTop = 730;
  await f.wx.switchTab({ url: '/pages/me/index' });
  assert.equal(f.pageRoot.scrollTop, 0);
  await f.wx.switchTab({ url: '/pages/community/index' });
  assert.equal(f.pageRoot.scrollTop, 1600);
  community.setData({ draft: 'unrelated update' });
  await Promise.resolve();
  assert.equal(f.pageRoot.scrollTop, 1600);
  f.pageRoot.scrollTop = 1810;
  community.setData({ draft: 'another update' });
  await Promise.resolve();
  assert.equal(f.pageRoot.scrollTop, 1810, 'same-page renders preserve a new user scroll instead of replaying the old saved offset');
  await f.wx.switchTab({ url: '/pages/nearby/index' });
  assert.equal(f.pageRoot.scrollTop, 730);
  await f.wx.switchTab({ url: '/pages/community/index' });
  assert.equal(f.pageRoot.scrollTop, 1810);
});

test('a loading redraw and a late hidden-page update cannot erase the returned list position', async () => {
  const f = runtime();
  await f.api.navigate('/pages/community/index');
  const community = f.api.current;
  f.pageRoot.scrollTop = 1960;
  await f.api.navigate('/pages/post/index?id=one');
  const detail = f.api.current;
  f.pageRoot.scrollTop = 410;
  community.onShow = function () { this.setData({ loading: true }); };
  detail.setData({ draft: 'queued detail update before Back' });
  await f.wx.navigateBack();
  assert.equal(f.api.current, community);
  assert.equal(f.pageRoot.scrollTop, 0, 'the browser clamps a short loading frame while data is unavailable');
  community.setData({ loading: false });
  await Promise.resolve();
  assert.equal(f.pageRoot.scrollTop, 1960, 'the old offset survives the temporary short loading frame');
  const renders = f.effects.renders.length;
  detail.setData({ draft: 'late result from the unloaded detail' });
  await Promise.resolve();
  assert.equal(f.pageRoot.scrollTop, 1960);
  assert.equal(f.effects.renders.length, renders, 'a hidden page result cannot redraw the active list');
});

test('a synchronous onShow redirect cannot apply the abandoned page offset to its destination', async () => {
  const f = runtime();
  await f.wx.switchTab({ url: '/pages/nearby/index' });
  f.pageRoot.scrollTop = 870;
  await f.wx.switchTab({ url: '/pages/community/index' });
  f.pageRoot.scrollTop = 1540;
  f.definitions['pages/post/index'].onShow = function () { f.wx.switchTab({ url: '/pages/nearby/index' }); };
  await f.api.navigate('/pages/post/index?id=redirect');
  assert.equal(f.api.current.route, 'pages/nearby/index');
  assert.equal(f.pageRoot.scrollTop, 870);
  assert.deepEqual(f.effects.failures, []);
});
