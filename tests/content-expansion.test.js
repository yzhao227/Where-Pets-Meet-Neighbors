'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const manifest = require('../content/batch-001/approved.json');
const baseline = require('../content/batch-004/baseline-260.json');
const baselineRuntime = require('../content/batch-004/baseline-runtime-260.json');
const additions = require('../content/batch-004/additions.json');
const selected = require('../content/batch-004/photo-sources/selected.json');
const evidence = require('../content/batch-004/review-evidence.json');
const packages = require('../content/batch-004/media-packages.json');
const { CURATED_POSTS } = require('../miniprogram/data/curated');
const { inspectVideo } = require('../cloudfunctions/community/video-file');
const { validateManifest } = require('../scripts/lib/content-catalog');
const ROOT = path.resolve(__dirname, '..');
const hash = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');

test('the requested expansion adds exactly 100 non-knowledge items and preserves all original 260 objects', () => {
  assert.equal(baseline.items.length, 260);
  assert.equal(baselineRuntime.length, 260);
  assert.equal(additions.length, 100);
  assert.equal(manifest.items.length, 360);
  assert.equal(CURATED_POSTS.length, 360);
  assert.deepEqual(manifest.targets, { knowledge: 58, photo: 289, video: 13 });
  assert.equal(additions.filter(item => item.contentType === 'photo').length, 92);
  assert.equal(additions.filter(item => item.contentType === 'video').length, 8);
  const current = new Map(manifest.items.map(item => [item.id, item]));
  const runtime = new Map(CURATED_POSTS.map(item => [item.id, item]));
  for (const item of baseline.items) assert.deepEqual(current.get(item.id), item, item.id);
  for (const item of baselineRuntime) assert.deepEqual(runtime.get(item.id), item, item.id);
  for (const item of additions) assert.deepEqual(current.get(item.id), item, item.id);
  assert.equal(validateManifest(manifest).valid, true);
});

test('every new gallery contains original new media, two or three credited images and diverse animals', () => {
  const baselineIds = new Set(baseline.items.map(item => item.id));
  const baselinePageids = new Set(baseline.items.map(item => item.sourceEvidence && item.sourceEvidence.pageid).filter(Boolean));
  const runtime = new Map(CURATED_POSTS.map(item => [item.id, item]));
  const newIds = [];
  for (const item of additions.filter(item => item.contentType === 'photo')) {
    const row = runtime.get(item.id);
    assert.ok(item.images.length >= 1, item.id + ' must own new original media');
    assert.ok(row.images.length >= 2 && row.images.length <= 3);
    assert.equal(row.images.length, row.imageCredits.length);
    for (const id of item.additionalPhotoIds || []) assert.ok(baselineIds.has(id));
    assert.deepEqual(row.images, [...item.images.map(image => image.url), ...(item.additionalPhotoIds || []).map(id => runtime.get(id).images[0])]);
    for (const id of item.sourceEvidence.newOriginalPageids) {
      assert.ok(!baselinePageids.has(id), 'existing photo counted as a new original: ' + id);
      newIds.push(id);
    }
  }
  assert.equal(newIds.length, 150);
  assert.equal(new Set(newIds).size, 150);
  assert.ok(!newIds.includes(108862724), 'a crop of an existing gecko image was rejected');
  assert.ok(!newIds.includes(85686692), 'the original of an existing cropped guppy image is not counted again');
  assert.ok(additions.filter(item => item.animalTypes.some(type => type === 'cat' || type === 'dog')).length <= 20);
  assert.deepEqual([...new Set(additions.flatMap(item => item.animalTypes))].sort(),
    ['amphibian', 'bird', 'cat', 'dog', 'fish', 'invertebrate', 'rabbit', 'reptile', 'small-mammal']);
});

test('new photo copies match the retained source metadata, licence and exact reviewed bytes', () => {
  assert.equal(selected.length, 150);
  const metadataCache = new Map();
  for (const picture of selected) {
    assert.equal(hash(picture.localFile), picture.sha256, picture.pageid);
    assert.ok(['CC0', 'Public domain'].includes(picture.license));
    if (!metadataCache.has(picture.metadataFile)) metadataCache.set(picture.metadataFile, JSON.parse(fs.readFileSync(path.join(ROOT, picture.metadataFile))));
    const record = metadataCache.get(picture.metadataFile).find(item => item.pageid === picture.pageid);
    assert.ok(record, 'source record missing: ' + picture.pageid);
    const info = record.imageinfo[0];
    assert.equal(picture.sourceUrl, info.descriptionurl);
    assert.equal(picture.originalUrl, info.url);
    assert.equal(picture.license, info.extmetadata.LicenseShortName.value);
  }
  for (const [file, expected] of Object.entries(evidence.reviewedFileSha256)) assert.equal(hash(file), expected, file);
});

test('new video files and feed posters fit their packages and preserve the reviewed encoded media', () => {
  const byId = new Map(additions.map(item => [item.id, item]));
  assert.deepEqual(packages.packages.map(item => item.name), ['media2', 'media3']);
  for (const pack of packages.packages) {
    assert.ok(pack.videoBytes < 1800 * 1024);
    assert.equal(pack.items.reduce((sum, item) => sum + item.bytes, 0), pack.videoBytes);
    for (const entry of pack.items) {
      const item = byId.get(entry.id);
      assert.equal(item.video.url, entry.path);
      const file = 'miniprogram' + item.video.url;
      assert.equal(hash(file), item.video.contentHash);
      const bytes = fs.readFileSync(path.join(ROOT, file));
      assert.equal(bytes.length, entry.bytes);
      assert.ok(bytes.length <= 300 * 1024);
      assert.ok(Math.abs(inspectVideo(bytes).durationSeconds - 8) < 0.01);
      assert.equal(hash('miniprogram' + item.video.poster), item.images[0].contentHash);
    }
  }
  assert.ok(packages.posterBytes < 50 * 1024);
});
