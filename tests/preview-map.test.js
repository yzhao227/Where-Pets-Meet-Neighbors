'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Evaluate the real adapter without starting the app, opening a browser or
// creating any stored location. Only the public wx.openLocation method is used.
function runtime() {
  const source = fs.readFileSync(path.resolve(__dirname, '../preview/runtime.js'), 'utf8');
  const effects = { navigations: [], newWindows: [], locationReads: 0, storageReads: 0 };
  const window = {
    location: { assign(url) { effects.navigations.push(url); } },
    open(...args) { effects.newWindows.push(args); }
  };
  const navigator = {
    geolocation: {
      getCurrentPosition() { effects.locationReads += 1; throw new Error('Navigation must not request the viewer location'); },
      watchPosition() { effects.locationReads += 1; throw new Error('Navigation must not watch the viewer location'); }
    }
  };
  const localStorage = {
    getItem() { effects.storageReads += 1; throw new Error('Navigation must not read a stored origin'); }
  };
  vm.runInNewContext(source, {
    window, navigator, localStorage,
    document: { getElementById() { return {}; } },
    console, setTimeout, clearTimeout, queueMicrotask
  }, { filename: 'preview/runtime.js' });
  return { wx: window.wx, effects };
}

test('map navigation opens the current browser tab with the exact destination and safely encoded title and address', async () => {
  const { wx, effects } = runtime();
  const callbacks = [];
  const options = {
    latitude: 31.112345, longitude: 121.398765,
    name: '有宠 & 好朋友 / #1', address: '上海闵行 宠物入口 A+B?x=1&y=2',
    success: result => callbacks.push(['success', result.errMsg]),
    fail: result => callbacks.push(['fail', result.errMsg]),
    complete: result => callbacks.push(['complete', result.errMsg])
  };
  const result = await wx.openLocation(options);
  assert.equal(effects.navigations.length, 1);
  assert.deepEqual(effects.newWindows, [], 'embedded browsers must not rely on an unobservable popup');
  const url = new URL(effects.navigations[0]);
  assert.equal(url.origin, 'https://apis.map.qq.com');
  assert.equal(url.pathname, '/uri/v1/marker');
  assert.equal(url.hash, '', 'the destination title hash character stays inside the marker value');
  assert.equal(url.searchParams.get('marker'), `coord:${options.latitude},${options.longitude};title:${options.name};addr:${options.address}`);
  assert.equal(url.searchParams.get('referer'), '有宠有邻');
  assert.deepEqual(Array.from(url.searchParams.keys()).sort(), ['marker', 'referer'], 'address ampersands cannot create extra query parameters');
  assert.equal(result.preview, true);
  assert.equal(result.errMsg, 'openLocation:ok browser map');
  assert.deepEqual(callbacks, [['success', result.errMsg], ['complete', result.errMsg]]);
  assert.equal(effects.locationReads, 0);
  assert.equal(effects.storageReads, 0);
});

test('invalid or missing map coordinates fail without changing the current page', async () => {
  const { wx, effects } = runtime();
  const cases = [
    {}, { latitude: 31.1 }, { longitude: 121.4 },
    { latitude: NaN, longitude: 121.4 }, { latitude: 31.1, longitude: Infinity },
    { latitude: -90.001, longitude: 121.4 }, { latitude: 90.001, longitude: 121.4 },
    { latitude: 31.1, longitude: -180.001 }, { latitude: 31.1, longitude: 180.001 },
    { latitude: '31.1', longitude: 121.4 }, { latitude: 31.1, longitude: '121.4' },
    { latitude: null, longitude: 121.4 }, { latitude: 31.1, longitude: null }
  ];
  for (const point of cases) {
    const callbacks = [];
    const result = await wx.openLocation({ ...point,
      success: value => callbacks.push(['success', value.errMsg]),
      fail: value => callbacks.push(['fail', value.errMsg]),
      complete: value => callbacks.push(['complete', value.errMsg])
    });
    assert.equal(result.errMsg, 'openLocation:fail invalid coordinates');
    assert.deepEqual(callbacks, [['fail', result.errMsg], ['complete', result.errMsg]]);
  }
  assert.deepEqual(effects.navigations, []);
  assert.deepEqual(effects.newWindows, []);
  assert.equal(effects.locationReads, 0);
  assert.equal(effects.storageReads, 0);
});

test('destination-only map links omit a viewer origin and apply safe defaults for optional labels', async () => {
  const { wx, effects } = runtime();
  await wx.openLocation({
    latitude: 31.2, longitude: 121.5,
    origin: 'private-origin-marker', from: 'private-from-marker',
    sourceLatitude: 30.123456, sourceLongitude: 120.654321,
    reference: { latitude: 32.123456, longitude: 122.654321 }
  });
  const url = new URL(effects.navigations[0]);
  assert.equal(url.searchParams.get('marker'), 'coord:31.2,121.5;title:目的地;addr:');
  assert.deepEqual(Array.from(url.searchParams.keys()).sort(), ['marker', 'referer']);
  assert.doesNotMatch(decodeURIComponent(url.href), /private-origin|private-from|30\.123456|120\.654321|32\.123456|122\.654321/);
  assert.equal(effects.locationReads, 0);
  assert.equal(effects.storageReads, 0);
  assert.deepEqual(effects.newWindows, []);
});
