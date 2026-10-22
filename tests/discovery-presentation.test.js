'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const presentation = require('../miniprogram/pages/community/_presentation');

function post(overrides) {
  return Object.assign({ id: 'post-1', cover: 'https://example.com/pet.jpg', kind: 'daily', images: ['https://example.com/pet.jpg'], title: '一起看小动物', displayTitle: '一起看小动物', topics: [] }, overrides);
}
function event(state, overrides) {
  return Object.assign({ id: state.id, src: state.src, attempt: state.attempt, type: 'load', width: 900, height: 1200 }, overrides);
}
const catalogueCover = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Blue_cat.jpg/960px-Blue_cat.jpg?utm_source=commons.wikimedia.org';

test('card labels reflect knowledge, questions and invitations while retired attachments cannot be decorated', () => {
  assert.equal(presentation.decorate(post({ contentType: 'knowledge' })).cardLabelType, 'knowledge');
  assert.equal(presentation.decorate(post({ kind: 'question', contentType: 'photo' })).cardLabelType, 'question');
  assert.equal(presentation.decorate(post({ kind: 'meetup' })).cardLabelType, 'meetup');
  const video = post({ video: { url: '/assets/clip.mp4' }, videoDurationText: '0:08', contentType: 'knowledge' });
  assert.throws(() => presentation.decorate(video), { code: 'NOT_FOUND', message: '内容已下架' });
  assert.throws(() => presentation.createCoverState(video), { code: 'NOT_FOUND' });
  for (const value of [post(), post({ contentType: 'photo', isEditorialContent: true })]) assert.equal(presentation.decorate(value).cardLabel, '');
});

test('decoration preserves content, user interactions and image arrays without mutating the post', () => {
  const original = Object.freeze(post({ images: Object.freeze(['one', 'two', 'three']), likeCount: 14, isLiked: true, text: '原文', author: Object.freeze({ nickname: '真实用户', petLabel: '小猫' }) }));
  const view = presentation.decorate(original);
  assert.notEqual(view, original);
  for (const key of Object.keys(original)) assert.equal(view[key], original[key]);
  assert.equal(view.coverSrc, original.cover);
  assert.equal(view.coverState, 'loading');
  assert.equal(original.coverState, undefined);
});

test('only verified editorial Wikimedia thumbnail URLs receive a smaller list source', () => {
  const original = Object.freeze(post({ cover: catalogueCover, isEditorialContent: true, images: Object.freeze([catalogueCover]), imageCredits: Object.freeze([{ imageUrl: catalogueCover }]) }));
  const state = presentation.createCoverState(original, 12);
  assert.equal(state.sourceSrc, catalogueCover);
  assert.equal(state.src, catalogueCover.replace('/960px-', '/500px-'));
  const decorated = presentation.decorate(original, state);
  assert.equal(decorated.coverSrc, state.src);
  assert.equal(decorated.cover, catalogueCover);
  assert.equal(decorated.images, original.images);
  assert.equal(decorated.imageCredits, original.imageCredits);
  for (const width of ['640', '960', '1280', '1920']) {
    const source = catalogueCover.replace('/960px-', '/' + width + 'px-');
    assert.equal(presentation.createCoverState(post({ cover: source, isEditorialContent: true }), 0).src, catalogueCover.replace('/960px-', '/500px-'));
  }
  const untouched = [
    catalogueCover.replace('/960px-', '/500px-'), catalogueCover.replace('/960px-', '/320px-'),
    catalogueCover.replace('https:', 'http:'), catalogueCover.replace('thumb.wikimedia.org', 'example.com'),
    catalogueCover.replace('thumb.wikimedia.org', 'thumb.wikimedia.org.example.com'),
    catalogueCover.replace('/commons/thumb/', '/en/thumb/'), catalogueCover.replace('/7/77/', '/wrong/hash/'),
    'https://upload.wikimedia.org/wikipedia/commons/7/77/Blue_cat.jpg', '/assets/pet.png', 'wxfile://local-pet.jpg'
  ];
  for (const source of untouched) assert.equal(presentation.createCoverState(post({ cover: source, isEditorialContent: true }), 0).src, source);
  assert.equal(presentation.createCoverState(post({ cover: catalogueCover }), 0).src, catalogueCover);
});

test('the reviewed hamster original gets a same-photo thumbnail while unknown originals and user URLs stay intact', () => {
  const original = 'https://upload.wikimedia.org/wikipedia/commons/2/28/Orange_Syrian_shorthair_hamster.jpg?utm_content=thumbnail_unscaled';
  const item = post({ cover: original, isEditorialContent: true });
  const state = presentation.createCoverState(item, 2);
  assert.equal(state.src, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/28/Orange_Syrian_shorthair_hamster.jpg/500px-Orange_Syrian_shorthair_hamster.jpg?utm_content=thumbnail_unscaled');
  assert.equal(state.sourceSrc, original);
  assert.equal(presentation.decorate(item, state).cover, original);
  assert.equal(presentation.createCoverState(post({ cover: original }), 2).src, original);
  for (const unknown of [original.replace('Orange_Syrian', 'Other_Syrian'), original.replace('/2/28/', '/2/29/'), original.replace('upload.wikimedia.org', 'upload.wikimedia.org.example.com')]) {
    assert.equal(presentation.createCoverState(post({ cover: unknown, isEditorialContent: true }), 2).src, unknown);
  }
  const fallback = presentation.applyCoverEvent(state, event(state, { type: 'error' }));
  assert.equal(fallback.src, original);
  assert.equal(fallback.attempt, 3);
  assert.equal(presentation.decorate(item, fallback).coverSrc, original);
  assert.equal(presentation.applyCoverEvent(fallback, event(state)), fallback);
  assert.equal(presentation.applyCoverEvent(fallback, event(fallback, { type: 'error' })).status, 'error');
});

test('retained original text and photos keep the reviewed image references after video retirement', () => {
  const { CURATED_POSTS } = require('../miniprogram/data/curated');
  const baseline = require('../content/batch-004/baseline-runtime-260.json');
  assert.equal(baseline.length, 260);
  const byId = new Map(CURATED_POSTS.map(item => [item.id, item]));
  for (const item of baseline) {
    if (item.video || item.contentType === 'video') assert.equal(byId.has(item.id), false);
    else assert.deepEqual(byId.get(item.id).images, item.images, item.id + ' retains its original image references');
  }
  const originals = baseline.flatMap(item => (item.images || []).filter(src => src.startsWith('https://upload.wikimedia.org/')).map(cover => ({ ...item, cover, isEditorialContent: true })));
  assert.equal(originals.length, 14);
  assert.equal(new Set(originals.map(item => item.cover.split('?')[0])).size, 10);
  for (const item of originals) {
    const state = presentation.createCoverState(item, 0);
    assert.match(state.src, /^https:\/\/thumb\.wikimedia\.org\/wikipedia\/commons\/thumb\/[^?]+\/500px-/);
    assert.equal(state.sourceSrc, item.cover);
    assert.equal(presentation.decorate(item, state).cover, item.cover);
  }
});

test('new groups reuse the verified original-image mapping without rewriting unknown originals', () => {
  const { CURATED_POSTS } = require('../miniprogram/data/curated');
  const baseline = require('../content/batch-004/baseline-runtime-260.json');
  const baselineIds = new Set(baseline.map(item => item.id));
  const verified = new Set(baseline.flatMap(item => item.images || []).filter(src => src.startsWith('https://upload.wikimedia.org/')).map(src => src.split('?')[0]));
  for (const item of CURATED_POSTS.filter(item => !baselineIds.has(item.id))) {
    for (const cover of (item.images || []).filter(src => src.startsWith('https://upload.wikimedia.org/'))) {
      const view = { ...item, cover, isEditorialContent: true };
      const state = presentation.createCoverState(view, 0);
      assert.equal(state.sourceSrc, cover, item.id);
      assert.equal(presentation.decorate(view, state).cover, cover, item.id);
      if (verified.has(cover.split('?')[0])) assert.match(state.src, /^https:\/\/thumb\.wikimedia\.org\/wikipedia\/commons\/thumb\/[^?]+\/500px-/, item.id);
      else assert.equal(state.src, cover, item.id + ' keeps an unreviewed original URL intact');
    }
  }
});

test('thumbnail failure falls back once and keeps the fallback through decoration and manual retry', () => {
  const item = post({ cover: catalogueCover, isEditorialContent: true, id: 'knowledge-001' });
  const initial = Object.freeze(presentation.createCoverState(item, 12));
  const fallback = presentation.applyCoverEvent(initial, event(initial, { type: 'error' }));
  assert.equal(fallback.src, catalogueCover);
  assert.equal(fallback.sourceSrc, catalogueCover);
  assert.equal(fallback.attempt, 13);
  assert.equal(fallback.status, 'loading');
  assert.equal(fallback.ratio, initial.ratio);
  assert.equal(initial.mode, 'aspectFill');
  assert.equal(fallback.mode, initial.mode);
  assert.equal(presentation.decorate(item, fallback).coverSrc, catalogueCover);
  assert.equal(presentation.decorate(item, fallback).coverAttempt, 13);
  for (const type of ['load', 'error']) assert.equal(presentation.applyCoverEvent(fallback, event(initial, { type })), fallback);
  const ready = presentation.applyCoverEvent(fallback, event(fallback, { width: 960, height: 640 }));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.mode, 'aspectFill');
  const smallReady = presentation.applyCoverEvent(initial, event(initial, { width: 500, height: 333 }));
  assert.equal(smallReady.mode, ready.mode);
  assert.equal(presentation.decorate(item, ready).coverState, 'ready');
  const failed = presentation.applyCoverEvent(fallback, event(fallback, { type: 'error' }));
  assert.equal(failed.status, 'error');
  assert.equal(failed.attempt, 13);
  assert.equal(presentation.applyCoverEvent(failed, event(fallback, { type: 'error' })), failed);
  assert.equal(presentation.retryCover(failed, 13), failed);
  const retry = presentation.retryCover(failed, 14);
  assert.equal(retry.src, catalogueCover);
  assert.equal(retry.status, 'loading');
  assert.equal(retry.attempt, 14);
  assert.equal(retry.mode, initial.mode);
  assert.equal(presentation.applyCoverEvent(retry, event(fallback)), retry);
  assert.equal(presentation.applyCoverEvent(retry, event(retry, { type: 'error' })).status, 'error');
  assert.equal(initial.src, catalogueCover.replace('/960px-', '/500px-'));
  const exhausted = presentation.createCoverState(item, Number.MAX_SAFE_INTEGER);
  assert.equal(presentation.applyCoverEvent(exhausted, event(exhausted, { type: 'error' })).status, 'error');
});

test('replacing the source discards a fallback without accepting its late events', () => {
  const item = post({ cover: catalogueCover, isEditorialContent: true });
  const initial = presentation.createCoverState(item, 3);
  const fallback = presentation.applyCoverEvent(initial, event(initial, { type: 'error' }));
  const replacement = post({ cover: catalogueCover.replace('Blue_cat', 'Orange_cat'), isEditorialContent: true });
  const next = presentation.createCoverState(replacement, 5);
  const view = presentation.decorate(replacement, fallback);
  assert.equal(view.coverSrc, next.src);
  assert.equal(view.coverState, 'loading');
  assert.notEqual(view.coverSrc, fallback.src);
  assert.equal(presentation.applyCoverEvent(next, event(fallback, { type: 'load' })), next);
  assert.equal(presentation.applyCoverEvent(next, event(fallback, { type: 'error' })), next);
});

test('known and explicit dimensions reserve portrait, landscape or square frames before the image loads', () => {
  const portrait = presentation.createCoverState(post({ id: 'photo-commons-148465188' }), 4);
  assert.equal(portrait.ratio, 'portrait');
  assert.equal(portrait.mode, 'aspectFill');
  const veryTall = presentation.createCoverState(post({ id: 'photo-commons-164819779' }), 4);
  assert.equal(veryTall.ratio, 'portrait');
  assert.equal(veryTall.mode, 'aspectFill');
  const wide = presentation.createCoverState(post({ coverWidth: 2400, coverHeight: 900 }), 1);
  assert.equal(wide.ratio, 'landscape');
  assert.equal(wide.mode, 'aspectFit');
  const landscape = presentation.createCoverState(post({ id: 'photo-commons-92201445' }), 1);
  assert.equal(landscape.ratio, 'landscape');
  assert.equal(landscape.mode, 'aspectFill');
  const exactPortrait = presentation.createCoverState(post({ coverWidth: 900, coverHeight: 1200 }), 1);
  assert.equal(exactPortrait.ratio, 'portrait');
  assert.equal(exactPortrait.mode, 'aspectFill');
});

test('ordinary image ratios fill their fixed frame while extreme crops remain contained', () => {
  for (const size of [{ width: 1500, height: 1000 }, { width: 900, height: 1200 }, { width: 1100, height: 1000 }, { width: 450, height: 1000 }]) {
    assert.equal(presentation.createCoverState(post({ coverWidth: size.width, coverHeight: size.height }), 1).mode, 'aspectFill');
  }
  for (const size of [{ width: 3000, height: 700 }, { width: 200, height: 1200 }, { width: 260, height: 1000 }]) {
    assert.equal(presentation.createCoverState(post({ coverWidth: size.width, coverHeight: size.height }), 1).mode, 'aspectFit');
  }
  const unknown = presentation.createCoverState(post(), 2);
  assert.equal(unknown.mode, 'aspectFit');
  const ordinary = presentation.applyCoverEvent(unknown, event(unknown, { width: 1400, height: 1000 }));
  assert.equal(ordinary.mode, 'aspectFill');
  assert.equal(ordinary.ratio, 'square');
  const extreme = presentation.applyCoverEvent(unknown, event(unknown, { width: 2400, height: 600 }));
  assert.equal(extreme.mode, 'aspectFit');
  assert.equal(extreme.ratio, 'square');
});

test('all current media and knowledge cover hints agree with the existing source dimensions', () => {
  const approved = require('../content/batch-001/approved.json');
  const sources = new Map(), metadata = new Map();
  for (const item of approved.items) {
    const source = item.sourceEvidence;
    const evidence = source && (source.imageSources && source.imageSources[0] || source);
    if (!evidence || !evidence.metadataFile) continue;
    if (!metadata.has(evidence.metadataFile)) metadata.set(evidence.metadataFile, JSON.parse(fs.readFileSync(path.join(__dirname, '..', evidence.metadataFile), 'utf8')));
    const record = metadata.get(evidence.metadataFile).find(row => row.pageid === evidence.pageid);
    const size = record && (record.imageinfo || record.videoinfo || [])[0];
    assert.ok(size && size.width > 0 && size.height > 0, item.id);
    sources.set(item.id, size);
  }
  let knowledgeCount = 0, mediaCount = 0;
  for (const item of approved.items) {
    const sourceId = item.imagePhotoIds && item.imagePhotoIds[0] || item.coverPhotoId || item.id;
    const size = item.video && item.video.width && item.video.height ? item.video : sources.get(sourceId);
    assert.ok(size, item.id);
    if (item.contentType === 'knowledge') knowledgeCount++; else mediaCount++;
    const sourceRatio = size.width / size.height;
    const ratio = sourceRatio < 0.9 ? 'portrait' : sourceRatio >= 1.2 ? 'landscape' : 'square';
    const frame = ratio === 'portrait' ? 2 / 3 : 5 / 7;
    const relative = sourceRatio / frame;
    const mode = Math.min(relative, 1 / relative) >= 0.4 ? 'aspectFill' : 'aspectFit';
    const state = presentation.createCoverState(post({ id: item.id }), 1);
    assert.equal(state.ratio, ratio, item.id);
    assert.equal(presentation.applyCoverEvent(state, event(state, { width: size.width, height: size.height })).mode, mode, item.id);
  }
  assert.equal(knowledgeCount, approved.targets.knowledge);
  assert.equal(mediaCount, approved.targets.photo + approved.targets.video);
  assert.equal(presentation.createCoverState(post({ id: 'knowledge-001' }), 1).ratio, 'landscape');
  assert.equal(presentation.createCoverState(post({ id: 'knowledge-007' }), 1).ratio, 'portrait');
  assert.equal(presentation.createCoverState(post({ id: 'knowledge-008' }), 1).ratio, 'square');
});

test('additional cover hints independently match first-image metadata and reserve the correct crop before loading', () => {
  const approved = require('../content/batch-001/approved.json');
  const baseline = require('../content/batch-004/baseline-260.json');
  const shapes = require('../miniprogram/data/curated-shapes');
  const baselineIds = new Set(baseline.items.map(item => item.id));
  const additions = approved.items.filter(item => !baselineIds.has(item.id));
  assert.deepEqual(Object.keys(shapes).sort(), additions.map(item => item.id).sort(), 'regenerate shape hints after every content build');
  const metadata = new Map();
  for (const item of additions) {
    const evidence = item.sourceEvidence.imageSources && item.sourceEvidence.imageSources[0] || item.sourceEvidence;
    if (!metadata.has(evidence.metadataFile)) metadata.set(evidence.metadataFile, JSON.parse(fs.readFileSync(path.join(__dirname, '..', evidence.metadataFile), 'utf8')));
    const record = metadata.get(evidence.metadataFile).find(row => String(row.pageid) === String(evidence.pageid));
    const info = record && (record.imageinfo || record.videoinfo || [])[0];
    assert.ok(info && info.width > 0 && info.height > 0, item.id + ' has source dimensions');
    const size = item.video ? item.video : info;
    assert.deepEqual(shapes[item.id], [size.width, size.height], item.id + ' preserves independently read dimensions');
    if (!item.video) assert.equal(item.images[0].sourceUrl, evidence.sourceUrl, item.id + ' uses the first image evidence');
    const sourceRatio = size.width / size.height;
    const ratio = sourceRatio < 0.9 ? 'portrait' : sourceRatio >= 1.2 ? 'landscape' : 'square';
    const frame = ratio === 'portrait' ? 2 / 3 : 5 / 7;
    const relative = sourceRatio / frame;
    const mode = Math.min(relative, 1 / relative) >= 0.4 ? 'aspectFill' : 'aspectFit';
    for (const id of [item.id, 'catalog-' + item.id]) {
      const state = presentation.createCoverState(post({ id }), 0);
      assert.equal(state.ratio, ratio, id);
      assert.equal(state.mode, mode, id + ' does not wait for onload to choose the crop');
    }
  }
});

test('all eight retained named groups reserve their reviewed shapes before loading', () => {
  const additions = require('../content/batch-003/additions.json');
  const { CURATED_POSTS } = require('../miniprogram/data/curated');
  const byId = new Map(CURATED_POSTS.map(item => [item.id, item]));
  const expected = {
    'knowledge-observe-rabbit-routine': 'portrait',
    'knowledge-observe-bird-framing': 'square',
    'knowledge-observe-guppy-tails': 'landscape',
    'knowledge-observe-axolotl-colors': 'square',
    'knowledge-observe-shrimp-scenes': 'landscape',
    'knowledge-observe-gecko-details': 'square',
    'knowledge-observe-chinchilla-features': 'landscape',
    'knowledge-observe-guinea-pig-coats': 'square',
    'video-commons-101613615': 'landscape',
    'video-commons-134636343': 'portrait'
  };
  assert.equal(additions.length, Object.keys(expected).length);
  for (const addition of additions) {
    if (addition.video || addition.contentType === 'video') { assert.equal(byId.has(addition.id), false); continue; }
    const item = byId.get(addition.id);
    const cover = item.video && item.video.poster || item.images[0];
    for (const id of [item.id, 'catalog-' + item.id]) {
      const state = presentation.createCoverState(post({ ...item, id, cover }), 1);
      assert.equal(state.ratio, expected[item.id], id);
      assert.equal(state.mode, 'aspectFill', id);
      if (item.video) assert.equal(state.src, item.video.poster, 'bundled JPEG posters keep their local path');
    }
  }
});

test('unknown, invalid-size and text-only content remain safe to display without inventing a cover', () => {
  for (const invalid of [{}, { coverWidth: NaN, coverHeight: 100 }, { coverWidth: 400, coverHeight: 0 }]) {
    const state = presentation.createCoverState(post(invalid), 1);
    assert.equal(state.ratio, 'square');
    assert.equal(state.mode, 'aspectFit');
  }
  const text = post({ cover: '', images: [], text: '只有文字的问题', kind: 'question' });
  const state = presentation.createCoverState(text, 1);
  assert.equal(state.status, 'none');
  assert.equal(presentation.decorate(text, state).coverSrc, '');
  assert.equal(presentation.applyCoverEvent(state, event(state)), state);
  assert.equal(presentation.retryCover(state, 2), state);
  assert.ok(Number.isFinite(presentation.estimateHeight(text, state)));
});

test('load, failure and retry never change the reserved frame or accept an obsolete request', () => {
  const initial = Object.freeze(presentation.createCoverState(post(), 8));
  for (const overrides of [{ id: 'post-2' }, { src: 'old-image' }, { attempt: 7 }, { attempt: undefined }, { attempt: '' }]) {
    assert.equal(presentation.applyCoverEvent(initial, event(initial, overrides)), initial);
  }
  const failed = presentation.applyCoverEvent(initial, event(initial, { type: 'error' }));
  assert.equal(failed.status, 'error');
  assert.equal(presentation.applyCoverEvent(failed, event(initial)), failed);
  for (const attempt of [8, -1, NaN, undefined]) assert.equal(presentation.retryCover(failed, attempt), failed);
  const retry = presentation.retryCover(failed, 9);
  assert.equal(retry.status, 'loading');
  assert.equal(retry.ratio, initial.ratio);
  assert.equal(retry.src, initial.src);
  assert.equal(presentation.applyCoverEvent(retry, event(initial, { type: 'error' })), retry);
  const ready = presentation.applyCoverEvent(retry, event(retry, { attempt: '9' }));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.ratio, 'square');
  assert.equal(ready.mode, 'aspectFill');
  assert.equal(ready.width, 900);
  assert.equal(presentation.applyCoverEvent(ready, event(retry, { type: 'error' })), ready);
  assert.equal(presentation.retryCover(ready, 10), ready);
  assert.equal(initial.status, 'loading');
});

test('old source state cannot attach to a new cover for the same post', () => {
  const before = presentation.createCoverState(post(), 5);
  const updated = post({ cover: 'https://example.com/new-pet.jpg' });
  const view = presentation.decorate(updated, before);
  assert.equal(view.coverSrc, updated.cover);
  assert.equal(view.coverState, 'loading');
  const current = presentation.createCoverState(updated, 6);
  assert.equal(presentation.applyCoverEvent(current, event(before)), current);
});

test('column height estimates are stable when a cover succeeds or fails', () => {
  const item = post({ id: 'photo-commons-148465188', topics: ['日常'] });
  const initial = presentation.createCoverState(item, 1);
  const ready = presentation.applyCoverEvent(initial, event(initial));
  const failed = presentation.applyCoverEvent(initial, event(initial, { type: 'error' }));
  assert.equal(presentation.estimateHeight(item, initial), presentation.estimateHeight(item, ready));
  assert.equal(presentation.estimateHeight(item, initial), presentation.estimateHeight(item, failed));
  assert.equal(presentation.estimateHeight(presentation.decorate(item, initial)), presentation.estimateHeight(item, initial));
  assert.ok(presentation.estimateHeight(item, initial) > presentation.estimateHeight(post(), presentation.createCoverState(post(), 1)));
  const landscape = post({ id: 'knowledge-001' });
  const landscapeView = presentation.decorate(landscape, presentation.createCoverState(landscape, 1));
  assert.equal(presentation.estimateHeight(presentation.decorate(post())), presentation.estimateHeight(landscapeView));
  const plainHeight = presentation.estimateHeight(presentation.decorate(post()));
  for (const labels of [{ circle: { name: '喵星人' } }, { topics: ['日常'] }, { circle: { name: '喵星人' }, topics: ['日常'] }]) {
    assert.ok(Math.abs(presentation.estimateHeight(presentation.decorate(post(labels))) - plainHeight - 0.11) < 1e-10);
  }
});
