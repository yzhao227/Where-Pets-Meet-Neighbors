'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { CURATED_POSTS } = require('../miniprogram/data/curated');
const manifest = require('../content/batch-001/approved.json');
const retired = require('../content/batch-001/retired-video-20261022.json');
const { hasReviewAsset, isRetiredAsset } = require('./helpers/retired-editorial.cjs');
const originalManifest = require('../content/batch-003/baseline-250.json');
const originalRuntime = require('../content/batch-003/baseline-runtime-250.json');
const additions = require('../content/batch-003/additions.json');
const evidence = require('../content/batch-003/review/evidence.json');
const { inspectVideo } = require('../cloudfunctions/community/video-file');
const ROOT = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('the retained text and images preserve the original extension while video metadata stays archived', () => {
  assert.equal(originalManifest.items.length, 250);
  assert.equal(originalRuntime.length, 250);
  assert.equal(additions.length, 10);
  assert.ok(manifest.items.length >= 260);
  assert.equal(CURATED_POSTS.length, manifest.items.length);
  const originalTypes = [...originalManifest.items, ...additions].reduce((counts, item) => {
    counts[item.contentType] = (counts[item.contentType] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(originalTypes, { knowledge: 58, photo: 197, video: 5 });
  const rawById = new Map(manifest.items.concat(retired.items).map(item => [item.id, item]));
  const runtimeById = new Map(CURATED_POSTS.map(item => [item.id, item]));
  for (const item of originalManifest.items) assert.deepEqual(rawById.get(item.id), item, item.id);
  for (const item of originalRuntime) {
    if (item.contentType === 'video') assert.equal(runtimeById.has(item.id), false);
    else assert.deepEqual(runtimeById.get(item.id), item, item.id);
  }
  for (const item of additions) assert.deepEqual(rawById.get(item.id), item, item.id);
});

test('the eight editorial groups preserve the reviewed picture order and credit each reused photo', () => {
  const groups = additions.filter(item => item.imagePhotoIds);
  const byId = new Map(CURATED_POSTS.map(item => [item.id, item]));
  assert.equal(groups.length, 8);
  assert.equal(groups.reduce((sum, group) => sum + group.imagePhotoIds.length, 0), 22);
  for (const group of groups) {
    assert.ok(group.imagePhotoIds.length >= 2 && group.imagePhotoIds.length <= 3);
    assert.equal(new Set(group.imagePhotoIds).size, group.imagePhotoIds.length);
    const runtime = byId.get(group.id);
    assert.deepEqual(runtime.images, group.imagePhotoIds.map(id => byId.get(id).images[0]));
    assert.deepEqual(runtime.imageCredits, group.imagePhotoIds.map(id => byId.get(id).imageCredits[0]));
    assert.equal(group.sourceEvidence.publicPagesFetchedInThisBatch, false);
  }
  assert.ok(!byId.get('knowledge-observe-guppy-tails').imagePhotoIds.includes('photo-commons-79067216'), 'betta photo is excluded from guppy comparison');
});

test('reviewed inputs, final clips, posters and captions still match the exact offline review record', () => {
  assert.equal(evidence.publicPagesFetchedInThisBatch, false);
  for (const [relative, digest] of Object.entries(evidence.reviewedFileSha256)) {
    if (hasReviewAsset(relative)) assert.equal(hash(fs.readFileSync(path.join(ROOT, relative))), digest, relative);
  }
  const videos = additions.filter(item => item.contentType === 'video');
  assert.equal(videos.length, 2);
  for (const video of videos) {
    assert.match(video.video.url, /^\/media\/clips\/\d+\.mp4$/);
    assert.match(video.video.poster, /^\/assets\/curated-poster\/\d+\.jpg$/);
    const file = 'miniprogram' + video.video.url;
    assert.equal(isRetiredAsset(file), true);
    if (!hasReviewAsset(file)) continue;
    const bytes = fs.readFileSync(path.join(ROOT, file));
    assert.equal(hash(bytes), video.video.contentHash);
    assert.ok(bytes.length <= 300 * 1024);
    assert.ok(Math.abs(inspectVideo(bytes).durationSeconds - 8) < 0.01);
    const poster = fs.readFileSync(path.join(ROOT, 'miniprogram', video.video.poster));
    assert.equal(hash(poster), video.images[0].contentHash);
    assert.ok(poster.length <= 100 * 1024);
    assert.equal(video.images[0].originalUrl, video.video.originalUrl, 'poster was extracted from its own source video');
    assert.equal(video.video.license.name, 'CC0');
  }
  for (const old of originalManifest.items.filter(item => item.contentType === 'video')) {
    const migrated = old.video.url.replace('/assets/curated-video/', '/media/clips/');
    if (hasReviewAsset('miniprogram' + migrated)) assert.equal(hash(fs.readFileSync(path.join(ROOT, 'miniprogram', migrated))), old.video.contentHash, old.id);
  }
});
