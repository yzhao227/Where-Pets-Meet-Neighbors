'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const media = require('../miniprogram/pages/post/_media');

const photoLoad = (items, index, width, height, dataset = {}) => media.photoEvent(items, {
  currentTarget: { dataset: { index: String(index), src: items[index].src, attempt: String(items[index].attempt), ...dataset } },
  detail: { width, height }
}, 'ready');

test('gallery keeps image order and only retries the failed current attempt', () => {
  const post = Object.freeze({ images: Object.freeze(['one.jpg', 'two.jpg', 'three.jpg']) });
  const items = media.photos(post);
  assert.deepEqual(items.map(item => item.src), post.images);
  const event = { currentTarget: { dataset: { index: '1', src: 'two.jpg', attempt: '0' } } };
  const failed = media.photoEvent(items, event, 'error');
  assert.equal(failed[1].status, 'error');
  assert.equal(failed[0], items[0]);
  assert.equal(failed[2], items[2]);
  const retry = failed.map((item, i) => i === 1 ? { ...item, attempt: 1, status: 'loading' } : item);
  assert.equal(media.photoEvent(retry, event, 'ready'), retry, 'old request cannot complete a new retry');
  assert.equal(media.photos(post, retry)[1], retry[1], 'refresh and interactions retain gallery state');
  assert.equal(media.photos({ images: ['replacement.jpg'] }, retry)[0].status, 'loading');
  assert.deepEqual(media.photos({ images: [] }, retry), []);
});

test('gallery height follows the selected photo while background loads leave its height unchanged', () => {
  const post = { images: ['landscape.jpg', 'portrait.jpg', 'tall.jpg'] };
  const initial = Object.freeze(media.photos(post).map(Object.freeze));
  assert.equal(media.photoHeight(initial, 0), 75, 'an unknown photo reserves a 4:3 frame');

  const portraitLoaded = photoLoad(initial, 1, 800, 1000);
  assert.equal(media.photoHeight(portraitLoaded, 0), 75, 'loading an off-screen portrait must not resize the selected landscape');
  assert.equal(media.photoHeight(portraitLoaded, 1), 125, 'selecting the loaded portrait uses its own ratio');
  assert.deepEqual([portraitLoaded[1].width, portraitLoaded[1].height], [800, 1000]);
  assert.equal(initial[1].width, undefined, 'load events do not mutate the previous gallery state');

  const landscapeLoaded = photoLoad(portraitLoaded, 0, 1600, 900);
  assert.equal(media.photoHeight(landscapeLoaded, 0), 56.25, 'a 16:9 landscape must not retain the tall placeholder frame');
  const allLoaded = photoLoad(landscapeLoaded, 2, 800, 2000);
  assert.equal(media.photoHeight(allLoaded, 0), 56.25, 'another background load cannot change the selected landscape');
  assert.equal(media.photoHeight(allLoaded, 1), 125);
  assert.equal(media.photoHeight(allLoaded, 2), 150, 'very tall photos are capped at one and a half frame widths');
  assert.deepEqual([allLoaded[2].width, allLoaded[2].height], [800, 2000], 'the display cap must not corrupt the original dimensions');

  const refreshed = media.photos(post, allLoaded);
  assert.equal(refreshed[0], allLoaded[0]);
  assert.equal(refreshed[1], allLoaded[1]);
  assert.equal(refreshed[2], allLoaded[2]);
  assert.deepEqual(refreshed.map((_, index) => media.photoHeight(refreshed, index)), [56.25, 125, 150]);
  const replaced = media.photos({ images: ['replacement.jpg', 'portrait.jpg', 'tall.jpg'] }, refreshed);
  assert.equal(media.photoHeight(replaced, 0), 75, 'a different source cannot inherit the retired image ratio');
  assert.equal(media.photoHeight(replaced, 1), 125);
});

test('stale photo events cannot overwrite a retry ratio or apply another image dimensions', () => {
  const loaded = photoLoad(media.photos({ images: ['one.jpg', 'two.jpg'] }), 0, 1600, 900);
  const retry = loaded.map((item, index) => index === 0 ? { ...item, status: 'loading', attempt: 1 } : item);
  for (const dataset of [
    { attempt: '0' },
    { src: 'retired.jpg' },
    { index: '-1' },
    { index: '1', src: 'one.jpg' }
  ]) {
    assert.equal(photoLoad(retry, 0, 800, 2000, dataset), retry, 'an event outside the current source/index/attempt must be ignored');
    assert.equal(media.photoHeight(retry, 0), 56.25);
  }
  const current = photoLoad(retry, 0, 1200, 1200);
  assert.equal(media.photoHeight(current, 0), 100, 'the active retry can replace the measured ratio');
  assert.equal(current[1], retry[1], 'measuring one image must not rewrite another image state');
});

test('invalid photo dimensions retain a known ratio and otherwise use the loading fallback', () => {
  const invalid = [
    [undefined, undefined], [0, 900], [1600, 0], [-1, 900],
    [1600, -1], [NaN, 900], [1600, Infinity], ['invalid', 900], [1600, 'invalid']
  ];
  for (const [width, height] of invalid) {
    const unknown = photoLoad(media.photos({ images: ['one.jpg'] }), 0, width, height);
    assert.equal(unknown[0].status, 'ready', 'missing metadata must not hide an otherwise loaded image');
    assert.equal(media.photoHeight(unknown, 0), 75, 'invalid dimensions cannot produce a collapsed or unbounded frame');

    const measured = photoLoad(media.photos({ images: ['one.jpg'] }), 0, 1600, 900);
    const retry = [{ ...measured[0], status: 'loading', attempt: 1 }];
    const recovered = photoLoad(retry, 0, width, height);
    assert.equal(media.photoHeight(recovered, 0), 56.25, 'invalid retry metadata cannot discard a valid prior measurement');
    assert.deepEqual([recovered[0].width, recovered[0].height], [1600, 900]);
  }
  assert.equal(media.photoHeight([], 0), 75);
  assert.equal(media.photoHeight(media.photos({ images: ['one.jpg'] }), 3), 75);
});

test('packaged videos keep old IDs but route to their own package instead of crossing package boundaries', async () => {
  const platform = { loadSubpackage() { assert.fail('preloading does not permit cross-package asset access'); } };
  assert.equal(media.videoPath('/assets/curated-video/112285953.mp4'), '/media/clips/112285953.mp4');
  assert.equal(media.playerPath('/assets/curated-video/112285953.mp4', 'catalog-video-commons-112285953'), '/media/pages/index?id=catalog-video-commons-112285953');
  assert.equal(media.playerPath('/media3/clips/123.mp4', 'video-123'), '/media3/pages/index?id=video-123');
  for (const url of ['/media/clips/../123.mp4', '/media2/clips/not-reviewed.mp4', '/media10/clips/123.mp4', 'https://example.com/media/clips/123.mp4']) assert.equal(media.playerPath(url, '123'), '');
  await assert.rejects(media.videoSource(platform, '/media/clips/112285953.mp4'), /播放页/);
  assert.equal(await media.videoSource(platform, 'cloud://approved-video.mp4'), 'cloud://approved-video.mp4');
  assert.equal(await media.videoSource(platform, 'https://example.com/video.mp4'), 'https://example.com/video.mp4');
});
