'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mediaRange } = require('../scripts/lib/preview-media');
test('video requests support metadata probes, seeking and suffix ranges without serving invalid ranges', () => {
  assert.deepEqual(mediaRange(undefined, 100), { start: 0, end: 99, partial: false });
  assert.deepEqual(mediaRange('bytes=0-1', 100), { start: 0, end: 1, partial: true });
  assert.deepEqual(mediaRange('bytes=40-', 100), { start: 40, end: 99, partial: true });
  assert.deepEqual(mediaRange('bytes=-10', 100), { start: 90, end: 99, partial: true });
  assert.deepEqual(mediaRange('bytes=90-999', 100), { start: 90, end: 99, partial: true });
  for (const value of ['bytes=100-', 'bytes=30-20', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6', 'bytes=-2-4', 'bytes=1.5-4']) assert.equal(mediaRange(value, 100), null);
});
