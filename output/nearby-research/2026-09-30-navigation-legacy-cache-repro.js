'use strict';
// Isolated reproduction: only public code from the initial commit and in-memory storage.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = '/Users/yangzhao/Documents/ChatGPT/宠物app';
const revision = 'd99aaba';
const modules = new Map();
function oldModule(file) {
  file = path.posix.normalize(file);
  if (!file.startsWith('miniprogram/') || file.includes('..')) throw new Error('Unexpected snapshot dependency: ' + file);
  if (!file.endsWith('.js')) file += '.js';
  if (modules.has(file)) return modules.get(file).exports;
  const source = execFileSync('git', ['show', revision + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const module = { exports: {} }; modules.set(file, module);
  const localRequire = name => name.startsWith('.') ? oldModule(path.posix.join(path.posix.dirname(file), name)) : require(name);
  vm.runInThisContext('(function(require, module, exports) {' + source + '\n})', { filename: revision + ':' + file })(localRequire, module, module.exports);
  return module.exports;
}
const clone = value => value === undefined ? undefined : structuredClone(value);
const point = row => !!(row.point && row.point.coordinateSystem === 'gcj02' && Number.isFinite(row.point.latitude) && Number.isFinite(row.point.longitude));
async function detailLabel(catalogue, api, id) {
  let definition;
  const filename = path.join(root, 'miniprogram/pages/local-detail/index.js');
  const shared = { api, register: value => { definition = value; }, safe: (page, values) => Object.assign(page.data, values),
    httpsUrl: value => typeof value === 'string' && /^https:\/\//.test(value) ? value : '' };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => {
      if (name === '../_shared') return shared;
      if (name === '../../data/nearby-catalogue') return catalogue;
      if (name === '../../services/nearby-location') return { getReference: () => null, distanceFor: () => null };
      if (name === '../../config') return { mode: 'demo', cloudEnv: '' };
      if (name === '../../services/public-links') return { canOpen: () => false };
      return require(path.resolve(path.dirname(filename), name));
    }, wx: { openLocation() {}, setNavigationBarTitle() {}, stopPullDownRefresh() {} }, Date
  }, { filename });
  const page = { ...definition, data: clone(definition.data) };
  const pending = page.onLoad({ id });
  const initial = page.data.item.navigationLabel;
  await pending;
  return { initial, afterGetPlace: page.data.item.navigationLabel, canNavigate: page.data.item.canNavigate };
}
async function main() {
  const saved = new Map(); let writes = 0;
  const platform = { getStorageSync: key => clone(saved.get(key) || ''), setStorageSync: (key, value) => { writes += 1; saved.set(key, clone(value)); }, openLocation() {} };
  const options = { now: () => Date.parse('2026-09-30T08:00:00Z') };
  const oldApi = oldModule('miniprogram/services/api').createApi(platform, { mode: 'demo', cloudEnv: '' }, options);
  await oldApi.call('bootstrap');
  let cursor; let imported = 0;
  do { const page = await oldApi.call('publishPlaceCatalogue', { cursor }); cursor = page.nextCursor; imported += page.added; } while (cursor);
  const storageKey = oldModule('miniprogram/services/demo').STORAGE_KEY;
  const legacyRows = clone(saved.get(storageKey).place_records);
  fs.writeFileSync('/tmp/nearby-real-legacy-imports.json', JSON.stringify({ revision, imported, records: legacyRows }, null, 2) + '\n');
  const current = require(path.join(root, 'miniprogram/data/nearby-catalogue'));
  const api = require(path.join(root, 'miniprogram/services/api')).createApi(platform, { mode: 'demo', cloudEnv: '' }, options);
  await api.call('bootstrap');
  const before = clone(saved.get(storageKey)); const writesBefore = writes;
  const rows = [];
  do { const result = await api.call('listPlaces', { type: 'all', limit: 50, cursor }); rows.push(...result.items); cursor = result.nextCursor; } while (cursor);
  const details = [];
  for (const record of current.records) {
    const old = legacyRows.find(item => item.id === record.id);
    const response = await api.call('getPlace', { id: record.id });
    if (point(record) && !point(old)) details.push({ id: record.id, title: record.title, bundledPoint: point(record), legacyPoint: point(old), resultPoint: point(response.place), oldAddress: old && old.address, currentAddress: record.address,
      beforeFixNativeDetail: await detailLabel(current, { call: async () => ({ place: old, isAdmin: true }) }, record.id),
      afterFixNativeDetail: await detailLabel(current, api, record.id) });
  }
  const output = { revision, imported, legacyWithPoint: legacyRows.filter(point).length, currentWithPoint: current.records.filter(point).length,
    resultWithPoint: rows.filter(point).length, total: rows.length, readWrites: writes - writesBefore,
    storageUnchanged: JSON.stringify(before) === JSON.stringify(saved.get(storageKey)), supplementedCandidates: details };
  console.log(JSON.stringify(output, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
