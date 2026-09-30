'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { publication } = require('../miniprogram/pages/post/_metadata');

test('publication dates use Shanghai day and year boundaries rather than the host timezone', () => {
  const now = Date.parse('2026-12-31T17:00:00Z'); // Already January 1, 2027 in Shanghai.
  assert.equal(publication({ createdAt: Date.parse('2026-12-31T16:05:00Z') }, now).publishTimeText, '01-01 00:05');
  assert.equal(publication({ createdAt: Date.parse('2026-12-31T15:59:59Z') }, now).publishTimeText, '2026-12-31 23:59');
  assert.equal(publication({ createdAt: Date.parse('2027-02-02T23:07:00Z') }, now).publishTimeText, '02-03 07:07');
});

test('missing or invalid publication time cannot fall back to import, update or source-review dates', () => {
  const now = Date.parse('2026-09-30T08:00:00Z');
  for (const createdAt of [undefined, null, 0, -1, NaN, Infinity, -Infinity, Number.MAX_VALUE, '1790755200000', new Date(now)]) {
    const item = Object.freeze({ createdAt, updatedAt: now, importedAt: now, source: { checkedAt: '2026-09-30', createdAt: now } });
    assert.equal(publication(item, now).publishTimeText, '时间未标注');
  }
  assert.deepEqual(publication(null, now), { publishTimeText: '时间未标注', publishPlaceText: '地点未标注' });
});

test('publication location uses only the explicitly linked public place title', () => {
  const now = Date.parse('2026-09-30T08:00:00Z');
  const item = Object.freeze({
    createdAt: now, place: Object.freeze({ title: '  宠物友好公园  ', address: '公开地点详细地址' }),
    author: { address: '私人住址', city: '作者城市' },
    viewerLocation: { title: '读者当前位置' }, event: { location: '活动地点' },
    source: { title: '原图来源城市' }, imageCredits: [{ location: '照片拍摄地点' }]
  });
  assert.deepEqual(publication(item, now), { publishTimeText: '09-30 16:00', publishPlaceText: '宠物友好公园' });
  assert.equal(item.place.title, '  宠物友好公园  ', 'formatting must not rewrite the public post');
  for (const place of [undefined, null, '地点字符串', {}, { title: '' }, { title: '   ' }, { title: 42 }, { name: '其它地点字段' }]) {
    assert.equal(publication({ ...item, place }, now).publishPlaceText, '地点未标注');
  }
});

test('legacy catalogue defaults fill missing fields without replacing real publication data', () => {
  const now = Date.parse('2026-09-30T08:00:00Z');
  const legacy = Object.freeze({ catalogManaged: true, createdAt: 0 });
  assert.deepEqual(publication(legacy, now), { publishTimeText: '09-30', publishPlaceText: '莘庄' });
  assert.deepEqual(publication({ createdAt: 0, author: { isEditorial: true } }, now), { publishTimeText: '09-30', publishPlaceText: '莘庄' });
  assert.deepEqual(publication({ ...legacy, createdAt: now }, now), { publishTimeText: '09-30 16:00', publishPlaceText: '莘庄' });
  assert.deepEqual(publication({ ...legacy, place: { title: '  真实公园  ' } }, now), { publishTimeText: '09-30', publishPlaceText: '真实公园' });
  assert.equal(legacy.createdAt, 0, 'display defaults must not rewrite stored or source data');
  assert.deepEqual(publication({ createdAt: now }, now), { publishTimeText: '09-30 16:00', publishPlaceText: '地点未标注' });
});
