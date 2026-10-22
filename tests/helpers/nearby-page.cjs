'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const shared = require('../../miniprogram/pages/_shared');
const tap = id => ({ currentTarget: { dataset: { id } } });
const choice = value => ({ detail: { value } });
const menu = value => ({ currentTarget: { dataset: { menu: value } } });
const ids = items => Array.from(items, item => item.id);
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function directory() {
  const records = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((letter, index) => ({
    id: 'place-' + letter, type: 'place', active: true,
    title: ['河畔绿道', '林间休息点', '花园广场', '城市书院', '第五个地点', '第六个地点', '第七个地点'][index],
    city: '上海', district: index < 2 ? '闵行' : '徐汇', area: index === 0 ? '滨江片区' : index === 1 ? '林下片区' : '西岸片区',
    summary: '仅内存目录测试内容', placeKind: index === 1 ? 'commercial' : 'park', feeType: index === 1 ? 'paid' : 'free',
    petPolicy: { status: 'conditional', text: '仅测试允许携宠的户外区域' }, noPetRequired: true, petPlayTags: ['walk'],
    ...(index < 4 ? { photo: { url: 'https://example.invalid/place-' + letter + '.jpg', sourceUrl: 'https://example.invalid/source-' + letter, credit: '测试署名', license: '测试许可' },
      point: { latitude: 31.1 + index / 100, longitude: 121.4, coordinateSystem: 'gcj02', precision: 'venue', sourceUrl: 'https://example.invalid/map-' + letter } } : {})
  }));
  records.push({ id: 'external-event', type: 'event', title: '公开活动资料', city: '上海', district: '徐汇', area: '活动片区',
    summary: '仅内存活动目录', startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 90000000).toISOString(),
    petPolicy: { status: 'unknown', text: '携宠规则待确认' }, feeType: 'unknown' });
  return records;
}
function guides() {
  return [
    { id: 'guide-river', title: '河畔慢游半日', shortTitle: '河畔半日', summary: '先看绿意，再找歇脚处。', duration: '预计停留 2 小时', petLabel: '仅指定户外区域', notice: '编辑建议，停留时间不含交通。',
      steps: [{ placeId: 'place-a', duration: '建议停留 45 分钟' }, { placeId: 'place-b', duration: '建议停留 60 分钟' }] },
    { id: 'guide-culture', title: '文化小环线', summary: '花园与书香，慢慢看。', duration: '预计停留 3 小时', petLabel: '不带宠安排', notice: '出发前确认当天开放。',
      steps: [{ placeId: 'place-c', duration: '建议停留 30 分钟' }, { placeId: 'place-d', duration: '建议停留 90 分钟' }] }
  ];
}
// All data and platform operations exist only in memory: no user storage,
// network connection, browser or real location is opened by this fixture.
function fixture(t, options = {}) {
  const catalogue = { records: options.records || directory(), guides: options.guides || guides(), region: '上海', checkedAt: '2026-10-22' };
  const previous = { wx: global.wx, Page: global.Page, call: shared.api.call };
  const state = { user: { id: 'viewer-a', isAdmin: true }, mode: 'demo', directory: structuredClone(catalogue.records), calls: [], writes: [], routes: [], toasts: [], reference: null, locationCalls: 0, cancelled: 0 };
  const handlers = {
    bootstrap: () => ({ mode: state.mode, user: { ...state.user }, settings: { city: '上海' } }),
    listPlaces: () => structuredClone(state.directory)
  };
  global.wx = { stopPullDownRefresh() {}, hideKeyboard() {},
    showToast: value => state.toasts.push(value.title), navigateTo: value => state.routes.push(value.url),
    showModal: value => { state.modal = value; }, showActionSheet: value => { state.locationCalls++; value.fail({ errMsg: 'cancel' }); }
  };
  shared.api.call = async (action, payload = {}) => {
    state.calls.push({ action, payload: structuredClone(payload) });
    if (!handlers[action]) throw Error('Unexpected API action: ' + action);
    return handlers[action](payload);
  };
  const location = {
    getReference: () => state.reference,
    distanceFor: point => state.reference && point ? { meters: Math.round((point.latitude - 31) * 10000), label: '测试距离', referenceLabel: state.reference.label } : null,
    cancelPending: () => { state.cancelled++; },
    setManualReference: (point, label) => { state.reference = { ...point, source: 'manual', label }; },
    clearReference: () => { state.reference = null; },
    locate: async () => { state.locationCalls++; }, chooseReference: async () => { state.locationCalls++; }
  };
  let definition; global.Page = value => { definition = value; };
  const filename = path.resolve(__dirname, '../../miniprogram/pages/nearby/index.js');
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { wx: global.wx, require(name) {
    if (name === '../_shared') return shared;
    if (name === '../../data/nearby-catalogue') return catalogue;
    if (name === '../../services/nearby-location') return location;
    if (name === '../../services/places') return { listAll: async payload => {
      state.calls.push({ action: 'listPlaces', payload: structuredClone(payload) }); return handlers.listPlaces(payload);
    } };
    return localRequire(name);
  } }, { filename });
  const page = { ...definition, data: structuredClone(definition.data), setData(values) { state.writes.push(structuredClone(values)); Object.assign(this.data, values); } };
  t.after(() => { global.wx = previous.wx; global.Page = previous.Page; shared.api.call = previous.call; });
  return { page, state, handlers, catalogue, location };
}
module.exports = { fixture, directory, guides, tap, choice, menu, ids, deferred, flush };
