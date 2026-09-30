'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createPublicLinks, canUseWebView } = require('../miniprogram/services/public-links');

function native(overrides = {}) {
  const calls = [];
  const platform = {
    navigateTo(options) { calls.push(['page', options]); options.success({}); },
    openOfficialAccountArticle(options) { calls.push(['article', options]); options.success({}); },
    __openExternal(options) { calls.push(['browser', options]); options.success({}); },
    setClipboardData() { throw Error('Links must not copy'); },
    showModal() { throw Error('Direct link does not open a confirmation dialog'); },
    ...overrides
  };
  return { platform, calls };
}

function webPage(settings) {
  const effects = { hiddenShareMenus: 0, titles: [], backs: 0 };
  let definition;
  const shared = {
    register(value) { definition = value; },
    safe(page, value) { page.setData(value); },
    back() { effects.backs += 1; }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/web/index.js'), 'utf8'), {
    wx: { hideShareMenu() { effects.hiddenShareMenus += 1; }, setNavigationBarTitle({ title }) { effects.titles.push(title); } },
    require(name) {
      if (name === '../_shared') return shared;
      if (name === '../../config') return settings;
      if (name === '../../services/public-links') return { canUseWebView };
      throw Error('Unexpected web-page dependency: ' + name);
    }
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  return { page, effects };
}

test('browser preview opens the exact safe URL immediately, without copying or an intermediate page', async () => {
  const { platform, calls } = native({ __preview: true });
  const links = createPublicLinks(platform);
  const url = 'https://example.org/show?a=1&name=%E5%AE%A0%E7%89%A9#rules';
  assert.equal(links.canOpen(url), true);
  await links.open(url, '公开活动');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'browser');
  assert.equal(calls[0][1].url, url);
});

test('WeChat article links use the article API and arbitrary sites never masquerade as supported', async () => {
  const { platform, calls } = native();
  const links = createPublicLinks(platform);
  const article = 'https://mp.weixin.qq.com/s/test-public-article';
  assert.equal(links.canOpen(article), true);
  await links.open(article);
  assert.equal(calls[0][0], 'article');
  assert.equal(calls[0][1].url, article);
  for (const url of ['https://example.org/event', 'https://mp.weixin.qq.com/admin', 'https://mp.weixin.qq.com.evil.invalid/s/foo']) {
    assert.equal(links.canOpen(url), false);
    await assert.rejects(links.open(url), { code: 'LINK_UNAVAILABLE' });
  }
  assert.equal(calls.length, 1);
  assert.equal(createPublicLinks({ ...platform, openOfficialAccountArticle: undefined }).canOpen(article), false);
});

test('native web views require explicit enablement and an exact verified business domain', async () => {
  const settings = { publicWeb: { enabled: true, businessDomains: ['approved.example.org'] } };
  const { platform, calls } = native();
  const links = createPublicLinks(platform, settings);
  const url = 'https://approved.example.org/article?note=a%26b#details';
  await links.open(url, '宠物 & 旅行');
  const route = new URL(calls[0][1].url, 'https://mini.invalid');
  assert.equal(route.pathname, '/pages/web/index');
  assert.equal(route.searchParams.get('url'), url);
  assert.equal(route.searchParams.get('title'), '宠物 & 旅行');
  for (const invalid of ['https://approved.example.org.evil.invalid/a', 'https://sub.approved.example.org/a', 'https://approved.example.org:8443/a', 'https://approved.example.org@evil.invalid/a', 'http://approved.example.org/a']) assert.equal(links.canOpen(invalid), false, invalid);
  assert.equal(canUseWebView(url, { publicWeb: { ...settings.publicWeb, enabled: false } }), false);
  assert.equal(canUseWebView(url, { publicWeb: { enabled: true, businessDomains: ['*.example.org'] } }), false);
});

test('hand-edited web-page routes reject executable, credentialed and unapproved-domain URLs before setting web-view src', () => {
  const settings = { publicWeb: { enabled: true, businessDomains: ['approved.example.org'] } };
  const invalid = [
    undefined, null, ['https://approved.example.org/article'], '',
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/page.html',
    '//approved.example.org/article', 'http://approved.example.org/article',
    'https://approved.example.org.evil.invalid/article', 'https://sub.approved.example.org/article',
    'https://approved.example.org:8443/article', 'https://approved.example.org@evil.invalid/article',
    'https://user:pass@approved.example.org/article', 'https://approved.example.org\\@evil.invalid/article',
    'https://evil.invalid/#https://approved.example.org/article', 'https://approved.example.org/\narticle',
    'https%3A%2F%2Fapproved.example.org%2Farticle'
  ];
  for (const url of invalid) {
    const { page, effects } = webPage(settings);
    page.onLoad({ url, title: '不能显示的标题' });
    assert.equal(page.data.url, '', String(url));
    assert.match(page.data.error, /暂不支持/, String(url));
    assert.deepEqual(effects.titles, [], 'rejected routes never set a successful article title');
    assert.equal(effects.hiddenShareMenus, 1);
  }
  for (const publicWeb of [undefined, { enabled: false, businessDomains: ['approved.example.org'] }, { enabled: true, businessDomains: [] }, { enabled: true, businessDomains: ['*.example.org'] }]) {
    const { page } = webPage({ publicWeb });
    page.onLoad({ url: 'https://approved.example.org/article' });
    assert.equal(page.data.url, '', 'the page rechecks deployment capability instead of trusting its route');
    assert.ok(page.data.error);
  }
});

test('an approved web-page route preserves the exact article URL and clears its src on loading failure', () => {
  const settings = { publicWeb: { enabled: true, businessDomains: ['approved.example.org'] } };
  const { page, effects } = webPage(settings);
  const url = 'https://approved.example.org/article?name=%E5%AE%A0%E7%89%A9&note=a%26b#rules';
  page.onLoad({ url, title: '宠物活动原文' });
  assert.equal(page.data.url, url);
  assert.equal(page.data.error, '');
  assert.deepEqual(effects.titles, ['宠物活动原文']);
  assert.equal(effects.hiddenShareMenus, 1);
  const markup = fs.readFileSync(require.resolve('../miniprogram/pages/web/index.wxml'), 'utf8');
  assert.match(markup, /<web-view\b[^>]*wx:if="\{\{url\}\}"[^>]*src="\{\{url\}\}"[^>]*binderror="loadFailed"/);
  page.loadFailed();
  assert.equal(page.data.url, '', 'a failed web view is removed so the fallback is visible');
  assert.match(page.data.error, /未能打开原文/);
  page.back();
  assert.equal(effects.backs, 1);
});

test('invalid URLs and native failures never trigger another navigation or copy', async () => {
  const { platform, calls } = native({ __preview: true });
  const links = createPublicLinks(platform);
  for (const value of [undefined, null, '', 'javascript:alert(1)', 'data:text/html,x', '//example.org', 'https://user:password@example.org', 'https://example.org/\nfoo', 'https://example.org/%zz', 'https://example.org\\@evil.invalid']) {
    assert.equal(links.canOpen(value), false);
    await assert.rejects(links.open(value), { code: 'LINK_INVALID' });
  }
  assert.equal(calls.length, 0);
  const unavailable = createPublicLinks({ openOfficialAccountArticle(options) { options.fail({ errMsg: 'internal:fail secret should not leak' }); } });
  await assert.rejects(unavailable.open('https://mp.weixin.qq.com/s/example'), error => error.code === 'LINK_OPEN_FAILED' && !error.message.includes('secret'));
});

test('the browser bridge performs a same-tab jump and rejects executable or credentialed URLs', async () => {
  const navigations = [], copied = [];
  const context = { window: { location: { assign(url) { navigations.push(url); } } }, document: { getElementById() { return {}; } }, navigator: { clipboard: { writeText(value) { copied.push(value); } } }, URL, console, setTimeout, clearTimeout, queueMicrotask };
  vm.runInNewContext(fs.readFileSync(require.resolve('../preview/runtime.js'), 'utf8'), context);
  const bridge = context.window.wx.__openExternal;
  await bridge({ url: 'https://example.org/show?id=1&name=%E5%AE%A0#info' });
  assert.deepEqual(navigations, ['https://example.org/show?id=1&name=%E5%AE%A0#info']);
  for (const url of ['javascript:alert(1)', 'http://example.org', 'https://user:pass@example.org', 'https://example.org\n/hidden']) {
    let failed = false;
    await bridge({ url, fail() { failed = true; } });
    assert.equal(failed, true);
  }
  assert.equal(navigations.length, 1);
  assert.deepEqual(copied, []);
});
