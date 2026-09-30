'use strict';

const https = require('node:https');
const { AppError } = require('./service');

const unavailable = () => new AppError('NAVIGATION_UNAVAILABLE', '暂时无法获取该地点的导航位置，请稍后重试');
const normalizeCity = value => typeof value === 'string' ? value.replace(/\s/g, '').replace(/市$/, '') : '';
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= max && !/[\u0000-\u001f\u007f]/.test(value);

// The URL is constructed below from a fixed provider endpoint. Redirects are
// never followed, and only a small JSON response is kept in memory.
function requestJson(url, { signal, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal, headers: { Accept: 'application/json' } }, response => {
      response.once('error', reject);
      response.once('aborted', () => reject(unavailable()));
      if (response.statusCode !== 200) {
        response.resume();
        reject(unavailable());
        return;
      }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.destroy(unavailable()); return; }
        chunks.push(chunk);
      });
      response.once('end', () => resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(unavailable()));
    request.once('error', reject);
  });
}

function createMapGeocoder(environment = {}, { request = requestJson, now = Date.now, timeoutMs = 4500,
  maxBytes = 64 * 1024, cacheMs = 5 * 60 * 1000, maxCacheEntries = 100 } = {}) {
  const key = typeof environment.TENCENT_MAP_KEY === 'string' ? environment.TENCENT_MAP_KEY.trim() : '';
  const enabled = key.length > 0;
  const cache = new Map(); const pending = new Map();
  const capacity = Math.max(1, Math.min(1000, Number.isSafeInteger(maxCacheEntries) ? maxCacheEntries : 100));
  const deadline = Math.max(1, Math.min(10000, Number.isSafeInteger(timeoutMs) ? timeoutMs : 4500));
  const byteLimit = Math.max(1, Math.min(256 * 1024, Number.isSafeInteger(maxBytes) ? maxBytes : 64 * 1024));
  const lifetime = Math.max(0, Math.min(60 * 60 * 1000, Number.isFinite(cacheMs) ? cacheMs : 5 * 60 * 1000));

  async function resolveAddress(address, city) {
    const url = new URL('https://apis.map.qq.com/ws/geocoder/v1/');
    url.searchParams.set('address', address);
    url.searchParams.set('key', key);
    url.searchParams.set('policy', '0');
    url.searchParams.set('output', 'json');
    const controller = new AbortController(); let timer;
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => request(url.toString(), { signal: controller.signal, timeoutMs: deadline, maxBytes: byteLimit })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, deadline); })
      ]);
      if (!response || response.statusCode !== 200 || !(typeof response.body === 'string' || Buffer.isBuffer(response.body)) || Buffer.byteLength(response.body) > byteLimit) throw unavailable();
      const data = JSON.parse(Buffer.isBuffer(response.body) ? response.body.toString('utf8') : response.body);
      const result = data && data.result;
      const location = result && result.location;
      if (!data || data.status !== 0 || !result || !Number.isSafeInteger(result.reliability) || result.reliability < 7 ||
        !Number.isSafeInteger(result.level) || result.level < 9 || !location ||
        !Number.isFinite(location.lat) || !Number.isFinite(location.lng) || location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180 ||
        !result.address_components || normalizeCity(result.address_components.city) !== city) throw unavailable();
      return { latitude: location.lat, longitude: location.lng, coordinateSystem: 'gcj02' };
    } catch (_) {
      // Provider messages and network errors may contain the key or request URL.
      // Never pass their text, cause, or stack through the cloud API.
      throw unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  return {
    enabled,
    async geocode(input) {
      if (!enabled || !input || !validText(input.address, 240) || !validText(input.city, 40)) throw unavailable();
      const city = normalizeCity(input.city);
      if (!city) throw unavailable();
      const rawAddress = input.address.trim();
      const address = rawAddress.includes(city) ? rawAddress : input.city.trim() + rawAddress;
      const cacheKey = JSON.stringify([city, address]);
      for (const [storedKey, value] of cache) if (value.expiresAt <= now()) cache.delete(storedKey);
      if (cache.has(cacheKey)) return { ...cache.get(cacheKey).point };
      if (pending.has(cacheKey)) return { ...await pending.get(cacheKey) };
      if (pending.size >= capacity) throw unavailable();
      const job = resolveAddress(address, city).then(point => {
        if (cache.size >= capacity) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { point, expiresAt: now() + lifetime });
        return point;
      });
      pending.set(cacheKey, job);
      try { return { ...await job }; }
      finally { pending.delete(cacheKey); }
    }
  };
}

module.exports = { createMapGeocoder };
