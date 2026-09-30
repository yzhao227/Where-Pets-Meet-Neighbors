'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const areas = require('../miniprogram/data/neighbor-areas');
const grid = require('../miniprogram/data/neighbor-location');
const profiles = require('../miniprogram/data/neighbor-profile');
const reject = (code, message) => { throw Object.assign(new Error(message), { code }); };

test('neighbor helper contracts are identical in the mini-program and independently deployed cloud function', () => {
  for (const name of ['neighbor-areas', 'neighbor-location', 'neighbor-profile']) assert.equal(
    fs.readFileSync(path.join(__dirname, '../miniprogram/data', name + '.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../cloudfunctions/community', name + '.js'), 'utf8'));
  assert.equal(areas.length, 21); assert.equal(new Set(areas.map(area => area.id)).size, 21);
  assert.equal(new Set(areas.map(area => area.district)).size, 16);
  assert.equal(areas.filter(area => area.district === '闵行区').length, 6);
  assert.ok(areas.filter(area => area.district !== '闵行区').every(area => area.area === ''));
});

test('residence quantization retains only valid one-kilometer cells and no raw coordinate or address', () => {
  const cell = grid.toCell({ latitude: 31.1, longitude: 121.38, coordinateSystem: 'gcj02', name: '不要保存的测试门牌' });
  assert.deepEqual(Object.keys(cell).sort(), ['grid', 'x', 'y']);
  assert.equal(grid.toCell({ latitude: 31.1, longitude: 121.38, coordinateSystem: 'wgs84' }), null);
  assert.equal(grid.toCell({ latitude: 39.9, longitude: 116.4, coordinateSystem: 'gcj02' }), null);
  for (const invalid of [null, { ...cell, latitude: 31.1 }, { ...cell, x: cell.x + 0.5 }, { ...cell, y: NaN }, { ...cell, x: 1e9 }, { ...cell, grid: 'unsupported' }]) assert.equal(grid.normalizeCell(invalid), null);
  assert.equal(grid.distanceBand(cell, cell), '约1km内');
  assert.equal(grid.distanceBand(cell, { ...cell, x: cell.x + 2 }), '约1–3km');
  assert.equal(grid.distanceBand(cell, { ...cell, x: cell.x + 3 }), '约3–5km');
  assert.equal(grid.distanceBand(cell, { ...cell, x: cell.x + 6 }), '约5–10km');
  assert.equal(grid.distanceBand(cell, { ...cell, x: cell.x + 11 }), '约10km以上');
  assert.equal(grid.distanceBand(cell, null), '');
});

test('closing residence sharing clears the cell immediately and reopening cannot bypass the 24-hour limit', () => {
  const now = 1_800_000_000_000;
  const cell = grid.toCell({ latitude: 31.1, longitude: 121.38, coordinateSystem: 'gcj02' });
  const opened = profiles.update({}, { neighborVisible: true, neighborAreaId: areas[0].id, residenceSharing: true, residenceCell: cell }, now, reject);
  assert.equal(opened.residenceUpdatedAt, now);
  const repeated = profiles.update(opened, { residenceSharing: true, residenceCell: cell }, now + 1, reject);
  assert.deepEqual(repeated, opened);
  assert.throws(() => profiles.update(opened, { residenceCell: { ...cell, x: cell.x + 1 } }, now + 1000, reject), { code: 'RESIDENCE_CHANGE_LIMIT' });
  const closed = profiles.update(opened, { residenceSharing: false, residenceCell: null }, now + 1000, reject);
  assert.equal(closed.residenceCell, null); assert.equal(closed.residenceUpdatedAt, now);
  assert.throws(() => profiles.update(closed, { residenceSharing: true, residenceCell: cell }, now + 2000, reject), { code: 'RESIDENCE_CHANGE_LIMIT' });
  const reopened = profiles.update(closed, { residenceSharing: true, residenceCell: cell }, now + grid.CHANGE_INTERVAL_MS, reject);
  assert.ok(reopened.residenceCell);
  const hidden = profiles.update(opened, { neighborVisible: false }, now + 3000, reject);
  assert.equal(hidden.residenceCell, null); assert.equal(hidden.residenceSharing, false);
});

test('private pet fields never participate in public matching or become a claim of no pets', () => {
  const user = { nickname: '测试邻居', neighborVisible: true, neighborAreaId: areas[0].id, area: '旧私密片区', pet: { name: '秘密宠物名', type: 'cat' }, bio: '秘密简介' };
  assert.equal(profiles.publicPet(user), null);
  assert.equal(profiles.matches(user, profiles.filters({ petType: 'cat' }, reject)), false);
  assert.equal(profiles.matches(user, profiles.filters({ kind: 'all', query: '秘密' }, reject)), false);
  assert.equal(profiles.matches(user, profiles.filters({ kind: 'people' }, reject)), true);
  assert.throws(() => profiles.filters({ petType: 'none' }, reject), { code: 'INVALID_INPUT' });
  assert.throws(() => profiles.filters({ residenceCell: {} }, reject), { code: 'INVALID_INPUT' });
  assert.equal(profiles.publicFields(user, {}).petLabel, '');
  assert.equal(profiles.publicFields(user, {}).bio, '');
});

test('neighbor search includes only the separately chosen public city, district and area', () => {
  const user = { nickname: '测试宠友', neighborVisible: true, neighborAreaId: 'sh-minhang-xinzhuang', area: '保密小区甲', showPet: true, pet: { name: '测试毛孩子', type: 'cat' } };
  for (const query of ['上海', '闵行', '闵行区', '莘庄', '闵行 · 莘庄']) assert.equal(profiles.matches(user, profiles.filters({ query }, reject)), true, query);
  assert.equal(profiles.matches(user, profiles.filters({ query: '保密小区甲' }, reject)), false);
  assert.equal(profiles.matches({ ...user, neighborAreaId: 'sh-xuhui' }, profiles.filters({ query: '莘庄' }, reject)), false);
});
