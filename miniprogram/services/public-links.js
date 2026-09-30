'use strict';

const { httpsUrl } = require('../utils/public-url');
const config = require('../config');

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function isArticle(url) { return /^https:\/\/mp\.weixin\.qq\.com\/s(?:[/?#]|$)/i.test(url); }
function canUseWebView(url, settings) {
  const valid = httpsUrl(url);
  const policy = settings && settings.publicWeb;
  if (!valid || !policy || policy.enabled !== true || !Array.isArray(policy.businessDomains)) return false;
  const host = /^https:\/\/([^/?#]+)/i.exec(valid)[1].toLowerCase();
  return policy.businessDomains.some(domain => typeof domain === 'string' && domain.toLowerCase() === host && /^[a-z0-9.-]+$/.test(domain));
}
function invoke(platform, method, options) {
  return new Promise((resolve, reject) => {
    try {
      platform[method](Object.assign({}, options, {
        success: resolve,
        fail: error => reject(failure(/cancel/i.test(String(error && error.errMsg)) ? 'LINK_CANCELLED' : 'LINK_OPEN_FAILED', '暂时未能打开该页面，请稍后重试'))
      }));
    } catch (_) { reject(failure('LINK_OPEN_FAILED', '暂时未能打开该页面，请稍后重试')); }
  });
}
function createPublicLinks(platform, settings = {}) {
  function routeFor(value) {
    const url = httpsUrl(value);
    if (!url || !platform) return '';
    if (platform.__preview === true && typeof platform.__openExternal === 'function') return 'browser';
    if (isArticle(url) && typeof platform.openOfficialAccountArticle === 'function') return 'article';
    if (canUseWebView(url, settings) && typeof platform.navigateTo === 'function') return 'webview';
    return '';
  }
  async function open(value, title) {
    const url = httpsUrl(value);
    if (!url) throw failure('LINK_INVALID', '这条信息暂时没有可打开的链接');
    const route = routeFor(url);
    if (route === 'browser') return invoke(platform, '__openExternal', { url });
    if (route === 'article') return invoke(platform, 'openOfficialAccountArticle', { url });
    if (route === 'webview') return invoke(platform, 'navigateTo', { url: '/pages/web/index?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(typeof title === 'string' ? Array.from(title).slice(0, 60).join('') : '原文') });
    throw failure('LINK_UNAVAILABLE', '该原文暂不支持在小程序内打开，可继续查看已整理的详情');
  }
  return { open, canOpen: value => !!routeFor(value) };
}
function service() { return createPublicLinks(typeof wx === 'undefined' ? null : wx, config); }
module.exports = { createPublicLinks, canUseWebView };
module.exports.open = (url, title) => service().open(url, title);
module.exports.canOpen = url => service().canOpen(url);
