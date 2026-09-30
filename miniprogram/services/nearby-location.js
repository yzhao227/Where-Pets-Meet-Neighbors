'use strict';

const geo = require('../utils/geo');
const STORAGE_KEY = 'youchong.nearbyReference.v1';
const GPS_TTL_MS = 15 * 60 * 1000;
const MAX_GPS_ACCURACY_METERS = 200;

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function label(value, fallback) {
  return typeof value === 'string' && value.trim() ? Array.from(value.trim()).slice(0, 80).join('') : fallback;
}
function deviceFailure(error, method, preview) {
  const message = String(error && (error.errMsg || error.message) || '');
  const mapAction = ['openLocation', '__openExternal'].includes(method);
  if (/cancel/i.test(message)) return failure('LOCATION_CANCELLED', mapAction ? '已取消打开地图' : '已取消选择位置');
  if (preview) return failure('LOCATION_UNSUPPORTED', mapAction ? '未能打开地图，请稍后重试' : '浏览器预览不提供手机定位和地图选点，请选择已核实地点作为参照');
  // Missing app declarations and API capabilities cannot be repaired by asking
  // the user to grant GPS permission. Match them before explicit user refusal.
  if (/requiredPrivateInfos|not\s+declared|undeclared|not support|unsupported|not available|api.*permission|no permission/i.test(message)) {
    return failure('LOCATION_UNSUPPORTED', mapAction ? '当前微信或小程序暂不支持地图导航，请稍后重试' : '当前微信或小程序暂不支持此位置功能，可手选已核实地点浏览');
  }
  if (!mapAction && /auth\s+(?:deny|denied)|user\b.*(?:deny|denied|refus)|permission\s+denied|用户拒绝/i.test(message)) {
    return failure('LOCATION_DENIED', '暂未获得位置权限，仍可手选片区或已核实地点浏览');
  }
  return failure('LOCATION_FAILED', mapAction ? '地图暂时无法打开，请稍后重试' : '暂时无法取得位置，请稍后重试，或手选已核实地点');
}

function createNearbyLocation(platform, options) {
  const settings = options || {};
  const now = settings.now || Date.now;
  let reference = null;
  let loaded = false;
  let pending = null;

  function readStoredReference() {
    if (loaded) return;
    loaded = true;
    try {
      const saved = platform && typeof platform.getStorageSync === 'function' ? platform.getStorageSync(STORAGE_KEY) : null;
      const value = saved && saved.version === 1 && saved.reference;
      const point = geo.normalizePoint(value);
      // Never restore a GPS location, even if storage was created by an older or modified client.
      if (point && value.source === 'manual' && Number.isFinite(value.acquiredAt) && value.acquiredAt >= 0) {
        reference = Object.assign(point, { source: 'manual', label: label(value.label, '所选地点'), acquiredAt: value.acquiredAt });
      }
    } catch (_) { /* A missing or unreadable preference must not block browsing. */ }
  }

  function getReference() {
    readStoredReference();
    if (reference && reference.source === 'gps') {
      const age = now() - reference.acquiredAt;
      if (age < 0 || age >= GPS_TTL_MS || !Number.isFinite(reference.accuracy) || reference.accuracy < 0 || reference.accuracy > MAX_GPS_ACCURACY_METERS) reference = null;
    }
    return reference ? Object.assign({}, reference) : null;
  }

  function cancelPending() {
    if (pending) pending.cancel();
  }

  function nativeRequest(method, args, cancellable) {
    if (cancellable) cancelPending();
    return new Promise((resolve, reject) => {
      if (!platform || typeof platform[method] !== 'function') {
        reject(failure('LOCATION_UNSUPPORTED', '当前环境暂不支持此位置功能，可手选已核实地点浏览'));
        return;
      }
      let settled = false;
      const operation = { cancel: () => finish(false, failure('LOCATION_STALE', '位置操作已结束')) };
      function finish(success, value) {
        if (settled) return;
        settled = true;
        if (pending === operation) pending = null;
        success ? resolve(value) : reject(value);
      }
      const fail = error => finish(false, deviceFailure(error, method, !!platform.__preview));
      if (cancellable) pending = operation;
      try {
        const task = platform[method](Object.assign({}, args, { success: value => finish(true, value), fail }));
        if (task && typeof task.then === 'function') task.then(value => {
          if (value && typeof value.errMsg === 'string' && /:fail/.test(value.errMsg)) fail(value);
          else if (value !== undefined) finish(true, value);
        }, fail);
      } catch (error) { fail(error); }
    });
  }

  // A generation also covers the microtask between a successful native callback and its continuation.
  let generation = 0;
  function invalidate() { generation += 1; cancelPending(); }
  function assertCurrent(value) { if (value !== generation) throw failure('LOCATION_STALE', '位置操作已结束'); }

  async function locate() {
    invalidate(); const requestGeneration = generation;
    const result = await nativeRequest('getLocation', { type: 'gcj02' }, true);
    assertCurrent(requestGeneration);
    if (result && result.coordinateSystem && result.coordinateSystem !== 'gcj02') throw failure('LOCATION_INVALID', '本次位置坐标格式不匹配，请重试或手选已核实地点');
    const point = geo.normalizePoint(result && Object.assign({}, result, { coordinateSystem: 'gcj02' }));
    if (!point) throw failure('LOCATION_INVALID', '本次位置结果无效，请重试或手选已核实地点');
    if (!Number.isFinite(result.accuracy) || result.accuracy < 0 || result.accuracy > MAX_GPS_ACCURACY_METERS) {
      throw failure('LOCATION_IMPRECISE', '本次定位误差较大，请到信号较好的地方重试，或手选已核实地点');
    }
    reference = Object.assign(point, { source: 'gps', label: '当前位置', acquiredAt: now(), accuracy: result.accuracy });
    loaded = true;
    return getReference();
  }

  function setManualReference(point, name) {
    invalidate();
    const valid = geo.normalizePoint(point);
    if (!valid) throw failure('LOCATION_INVALID', '这个地点尚无可靠坐标，请选择其他已核实地点');
    const selected = Object.assign(valid, { source: 'manual', label: label(name, label(point.label, '所选地点')), acquiredAt: now() });
    try {
      if (!platform || typeof platform.setStorageSync !== 'function') throw new Error('storage unavailable');
      platform.setStorageSync(STORAGE_KEY, { version: 1, reference: selected });
    } catch (_) { throw failure('LOCATION_STORAGE_FAILED', '参照地点未能保存，请检查本机存储后重试'); }
    reference = selected; loaded = true;
    return getReference();
  }

  async function chooseReference() {
    invalidate(); const requestGeneration = generation;
    const current = getReference();
    const coordinates = current ? { latitude: current.latitude, longitude: current.longitude } : {};
    const result = await nativeRequest('chooseLocation', coordinates, true);
    assertCurrent(requestGeneration);
    if (!result) throw failure('LOCATION_INVALID', '没有取得所选地点，请重试');
    if (result.coordinateSystem && result.coordinateSystem !== 'gcj02') throw failure('LOCATION_INVALID', '所选地点坐标格式不匹配，请选择其他地点');
    return setManualReference(Object.assign({}, result, { coordinateSystem: 'gcj02' }), label(result.name, '地图所选地点'));
  }

  function clearReference() {
    invalidate(); reference = null; loaded = true;
    try {
      if (!platform || typeof platform.removeStorageSync !== 'function') throw new Error('storage unavailable');
      platform.removeStorageSync(STORAGE_KEY);
    } catch (_) { throw failure('LOCATION_STORAGE_FAILED', '当前参照已停用，但本机保存的参照尚未清除，请重试'); }
  }

  function distanceFor(point) {
    const current = getReference();
    const meters = current ? geo.distanceMeters(current, point) : null;
    return meters === null ? null : { meters, label: geo.distanceLabel(meters), referenceLabel: current.label };
  }

  async function navigateTo(point, details) {
    const valid = geo.normalizePoint(point);
    if (!valid) throw failure('LOCATION_INVALID', '暂未取得可靠的目的地位置，请稍后重试');
    const info = details || {};
    await nativeRequest('openLocation', { latitude: valid.latitude, longitude: valid.longitude, name: label(info.name, label(point.label, '目的地')), address: label(info.address, ''), scale: 16 }, false);
  }

  async function navigateByAddress(details) {
    const info = details || {};
    if (typeof info.id !== 'string' || !info.id.trim() || typeof info.address !== 'string' || !info.address.trim()) {
      throw failure('LOCATION_INVALID', '具体地点尚未公布，请留意后续活动信息');
    }
    invalidate(); const requestGeneration = generation;
    // The browser opens a public place search; it does not invent a coordinate
    // or include the viewer's location. Map users choose the matching entrance.
    if (platform && platform.__preview === true) {
      const name = label(info.name, '').split(/\s+·\s+/)[0].replace(/[（(][^）)]*[）)]/g, '').trim();
      const keyword = name || info.address.trim().slice(0, 200);
      const url = 'https://apis.map.qq.com/uri/v1/search?keyword=' + encodeURIComponent(keyword) + '&region=' + encodeURIComponent(label(info.city, '上海')) + '&referer=' + encodeURIComponent('有宠有邻');
      await nativeRequest('__openExternal', { url }, false);
      return;
    }
    if (!platform || typeof platform.openLocation !== 'function') throw failure('LOCATION_UNSUPPORTED', '当前环境暂不支持地图导航');
    const resolveNavigation = settings.resolveNavigation || (id => {
      const config = require('../config');
      if (config.mode !== 'cloud' || !config.cloudEnv) throw failure('NAVIGATION_UNAVAILABLE', '这个地点的地址导航暂未开通，请稍后再试');
      // Only the public record ID crosses the cloud boundary. The server loads
      // and resolves its current address, never an arbitrary client address.
      return require('./api').call('getPlaceNavigation', { id });
    });
    let result;
    try { result = await resolveNavigation(info.id.trim()); }
    catch (error) { assertCurrent(requestGeneration); throw error; }
    assertCurrent(requestGeneration);
    const point = geo.normalizePoint(result && result.point);
    if (!point) throw failure('LOCATION_INVALID', '暂未取得可靠的目的地位置，请稍后重试');
    return navigateTo(point, { name: result.name, address: result.address });
  }

  return { getReference, locate, chooseReference, setManualReference, clearReference, distanceFor, navigateTo, navigateByAddress, cancelPending: invalidate };
}

let singleton; let singletonPlatform;
function service() {
  const platform = typeof wx === 'undefined' ? null : wx;
  if (!singleton || singletonPlatform !== platform) { singletonPlatform = platform; singleton = createNearbyLocation(platform); }
  return singleton;
}
module.exports = { STORAGE_KEY, GPS_TTL_MS, MAX_GPS_ACCURACY_METERS, createNearbyLocation };
['getReference', 'locate', 'chooseReference', 'setManualReference', 'clearReference', 'distanceFor', 'navigateTo', 'navigateByAddress', 'cancelPending'].forEach(method => {
  module.exports[method] = function () { return service()[method].apply(null, arguments); };
});
