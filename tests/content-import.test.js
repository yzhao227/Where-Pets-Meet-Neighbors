'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const catalog = require('../scripts/lib/content-catalog');
const { main } = require('../scripts/content-batch');

// These are deliberately artificial test fixtures in memory/temp directories.
// They do not claim that any source, image or permission has been retrieved.
function asset(index) {
  return {
    url: 'https://cdn.example.org/pets/' + index + '.jpg',
    originalUrl: 'https://images.example.org/original/' + index + '.jpg',
    sourceUrl: 'https://sources.example.org/photos/' + index,
    author: '仅用于离线测试的作者',
    license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    attribution: '离线测试作者 / 测试照片 ' + index + ' / CC BY 4.0；并非已获取的真实素材。',
    changes: '仅测试缩放说明',
    contentHash: createHash('sha256').update('test-image-' + index).digest('hex')
  };
}
function item(type, index, reviewStatus = 'approved') {
  return {
    id: (type === 'knowledge' ? 'guide-' : 'photo-') + String(index).padStart(3, '0'),
    type, title: (type === 'knowledge' ? '知识' : '图片') + '测试条目 ' + index,
    text: type === 'knowledge' ? '这是仅存在自动测试内存中的说明文字，不代表已经核实的宠物知识，也不是从任何网站获取的文章。它用于验证批次校验、字段保留、去重和原子写入是否正常工作。测试编号：' + index : '这是一张用于验证外部地址与许可元数据的测试图片说明，图片编号为 ' + index + '。',
    topics: ['养宠经验'], circleId: type === 'knowledge' ? 'circle-cats' : 'circle-neighbors',
    source: { title: '离线测试来源 ' + type + ' ' + index, publisher: '仅用于离线测试', url: 'https://sources.example.org/' + type + '/' + index, author: '仅用于离线测试的作者', checkedAt: '2026-09-29' },
    review: reviewStatus === 'approved' ? { status: 'approved', reviewer: '自动测试用审核字段', reviewedAt: '2026-09-29T12:00:00+08:00' } : { status: reviewStatus },
    assets: type === 'photo' ? [asset(index)] : []
  };
}
function fullManifest() {
  return { batchId: 'batch-001', items: [...Array.from({ length: 100 }, (_, index) => item('knowledge', index + 1)), ...Array.from({ length: 200 }, (_, index) => item('photo', index + 1))] };
}
function partial(...items) { return { batchId: 'batch-001', items }; }
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youchong-content-import-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, output: path.join(directory, 'curated.js'), input: path.join(directory, 'approved.json') };
}
function evaluate(file) {
  const context = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return JSON.parse(JSON.stringify(context.module.exports));
}

function licensedVideo(index = 1) {
  const value = item('photo', 500 + index);
  value.id = 'video-' + index;
  value.type = 'video';
  value.assets[0].license = { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' };
  value.video = {
    url: 'https://cdn.example.org/video/' + index + '.mp4', poster: value.assets[0].url, durationSeconds: 12.5,
    originalUrl: 'https://images.example.org/original/video-' + index + '.mp4', sourceUrl: value.source.url,
    author: '离线测试视频作者', license: { name: 'Public Domain', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
    attribution: '测试元数据，不代表已获取的视频', contentHash: createHash('sha256').update('video-' + index).digest('hex')
  };
  return value;
}

test('empty and partial manifests validate without claiming the 100/200 targets are met', () => {
  const empty = partial();
  assert.equal(catalog.validateManifest(empty).valid, true);
  assert.deepEqual(catalog.status(empty).approved, { knowledge: 0, photo: 0 });
  assert.deepEqual(catalog.status(empty).targets, { knowledge: 100, photo: 200 });
  assert.equal(catalog.status(empty).readyToBuild, false);
  assert.equal(catalog.status(empty).readyToBuildPartial, false);
  const pending = partial(item('knowledge', 1, 'pending'), item('photo', 1));
  assert.equal(catalog.validateManifest(pending).valid, true);
  assert.deepEqual(catalog.status(pending).counts, { knowledge: 1, photo: 1 });
  assert.deepEqual(catalog.status(pending).approved, { knowledge: 0, photo: 1 });
  assert.equal(catalog.status(pending).readyToBuildPartial, false);
  assert.match(catalog.status(pending).verification, /metadata-only/);
});

test('custom targets govern full, partial and status counts without changing legacy defaults', t => {
  const { output } = temporary(t);
  for (const photo of [100, 200]) {
    const manifest = fullManifest();
    manifest.targets = { knowledge: 50, photo };
    manifest.items = manifest.items.filter(value => Number(value.id.slice(-3)) <= manifest.targets[value.type]);
    assert.equal(catalog.status(manifest).readyToBuild, true);
    const result = catalog.buildCatalog(manifest, { output });
    assert.equal(result.writtenCount, 50 + photo);
    assert.equal(result.isPartial, false);
    assert.deepEqual(result.targets, manifest.targets);
    manifest.items.pop();
    assert.equal(catalog.status(manifest).readyToBuild, false);
    assert.equal(catalog.status(manifest).readyToBuildPartial, true);
    assert.equal(catalog.buildCatalog(manifest, { output, partial: true }).isPartial, true);
  }
  const over = { ...partial(item('knowledge', 1), item('knowledge', 2)), targets: { knowledge: 1, photo: 0 } };
  assert.equal(catalog.status(over).readyToBuildPartial, false);
  assert.throws(() => catalog.buildCatalog(over, { output, partial: true }), /不能超过/);
  assert.deepEqual(catalog.status(partial()).targets, { knowledge: 100, photo: 200 });
});

test('targets reject invalid counts, unknown keys and a zero total', () => {
  for (const targets of [null, [], {}, { knowledge: 0, photo: 0 }, { knowledge: 101, photo: 1 },
    { knowledge: 1, photo: 401 }, { knowledge: -1, photo: 1 }, { knowledge: 1.5, photo: 1 },
    { knowledge: '1', photo: 1 }, { knowledge: 1, photo: 1, unused: 1 },
    { knowledge: 1, photo: 1, video: 41 }, { knowledge: 0, photo: 0, video: -1 }]) {
    assert.equal(catalog.validateManifest({ ...partial(), targets }).valid, false, JSON.stringify(targets));
  }
});

test('knowledge cover references reuse a verified photo without changing counts or source authorship', t => {
  const { output } = temporary(t);
  const first = item('knowledge', 1), second = item('knowledge', 2), photo = item('photo', 1);
  first.coverPhotoId = photo.id; second.coverPhotoId = photo.id;
  const manifest = { ...partial(first, second, photo), targets: { knowledge: 2, photo: 1 } };
  const result = catalog.buildCatalog(manifest, { output });
  const generated = evaluate(output).CURATED_POSTS;
  assert.equal(result.writtenCount, 3);
  assert.deepEqual(result.counts, { knowledge: 2, photo: 1 });
  assert.deepEqual(generated[0].source, first.source);
  assert.deepEqual(generated[0].images, generated[2].images);
  assert.deepEqual(generated[0].imageCredits, generated[2].imageCredits);
  manifest.items.reverse();
  assert.equal(catalog.buildCatalog(manifest, { output }).changed, false);
  photo.assets[0].url = 'https://cdn.example.org/rehosted/one.jpg';
  assert.notEqual(catalog.buildCatalog(manifest, { output }).version, result.version);
  assert.equal(evaluate(output).CURATED_POSTS[0].images[0], photo.assets[0].url);
});

test('cover references cannot point outside the manifest, back to themselves, or to non-photo content', t => {
  const { output } = temporary(t);
  for (const target of ['photo-missing', 'guide-001', 'guide-002', 'video-1']) {
    const knowledge = item('knowledge', 1); knowledge.coverPhotoId = target;
    const checked = catalog.validateManifest(partial(knowledge, item('knowledge', 2), licensedVideo()));
    assert.equal(checked.valid, false, target);
    assert.ok(checked.errors.some(error => error.includes('coverPhotoId')), target);
  }
  const knowledge = item('knowledge', 1), photo = item('photo', 1);
  knowledge.coverPhotoId = photo.id; knowledge.assets = [asset(2)];
  assert.equal(catalog.validateManifest(partial(knowledge, photo)).valid, false);
  delete knowledge.assets;
  photo.coverPhotoId = knowledge.id;
  assert.equal(catalog.validateManifest(partial(knowledge, photo)).valid, false);
  delete photo.coverPhotoId; photo.review = { status: 'pending' };
  assert.throws(() => catalog.buildCatalog(partial(knowledge, photo), { output, partial: true }), /每条内容.*approved/);
});

test('omitting public attribution accepts only CC0 or public-domain assets and still retains internal credits', t => {
  const { output } = temporary(t);
  for (const name of ['CC BY 4.0', 'CC BY-SA 4.0', 'Pexels', 'Unsplash', 'permission']) {
    const photo = item('photo', 1); photo.assets[0].license.name = name;
    photo.assets[0].permissionRef = 'test-permission-evidence';
    const knowledge = item('knowledge', 1); knowledge.coverPhotoId = photo.id;
    assert.equal(catalog.validateManifest({ ...partial(knowledge, photo), omitPublicAttribution: true }).valid, false, name);
    assert.equal(catalog.validateManifest({ ...partial(knowledge, photo), omitPublicAttribution: false }).valid, true, name);
  }
  const photo = item('photo', 1); photo.assets[0].license.name = 'CC0 1.0';
  const knowledge = item('knowledge', 1); knowledge.coverPhotoId = photo.id;
  const manifest = { ...partial(knowledge, photo), omitPublicAttribution: true };
  const first = catalog.buildCatalog(manifest, { output, partial: true });
  const posts = evaluate(output).CURATED_POSTS;
  assert.ok(posts.every(post => post.omitPublicAttribution));
  assert.equal(posts[0].imageCredits[0].author, photo.assets[0].author);
  assert.deepEqual(posts[0].source, knowledge.source);
  manifest.omitPublicAttribution = false;
  assert.notEqual(catalog.buildCatalog(manifest, { output, partial: true }).version, first.version);
  assert.equal(catalog.validateManifest({ ...manifest, omitPublicAttribution: 'true' }).valid, false);
});

test('animal tags use the shared ten-species vocabulary and extended circles, deduplicate and propagate', t => {
  const { output } = temporary(t);
  assert.deepEqual(catalog.ANIMAL_TYPES, require('../miniprogram/data/animal-types').IDS);
  const value = item('photo', 1); value.animalTypes = ['amphibian', 'invertebrate', 'amphibian']; value.circleId = 'circle-exotics';
  catalog.buildCatalog(partial(value), { output, partial: true });
  assert.deepEqual(evaluate(output).CURATED_POSTS[0].animalTypes, ['amphibian', 'invertebrate']);
  for (const animalTypes of ['cat', null, ['unclassified'], ['dragon'], ['cat', 'dog', 'bird', 'fish']]) {
    assert.equal(catalog.validateManifest(partial({ ...value, animalTypes })).valid, false);
  }
});

test('video imports count independently, retain reviewed poster metadata and emit only public video fields', t => {
  const { output } = temporary(t);
  const video = licensedVideo();
  const manifest = { ...partial(video), targets: { knowledge: 0, photo: 0, video: 1 }, omitPublicAttribution: true };
  assert.equal(catalog.status(manifest).readyToBuild, true);
  const result = catalog.buildCatalog(manifest, { output });
  assert.deepEqual(result.counts, { knowledge: 0, photo: 0, video: 1 });
  assert.equal(catalog.status(manifest).total, 1);
  const generated = evaluate(output).CURATED_POSTS[0];
  assert.deepEqual(generated.video, { url: video.video.url, poster: video.video.poster, durationSeconds: 12.5 });
  assert.equal(generated.images[0], video.video.poster);
  assert.equal(generated.imageCredits[0].licenseName, 'CC0 1.0');
  assert.equal(generated.editorId, 'catalog-photo');
  assert.equal('contentHash' in generated.video, false);
  assert.throws(() => catalog.buildCatalog(partial(video), { output, partial: true }), /不能超过/);
});

test('video imports reject invalid duration, missing or mismatched poster, unsafe URLs, duplicate originals and disallowed licenses', () => {
  for (const change of [value => { value.video.durationSeconds = 61; }, value => { value.video.durationSeconds = 0; },
    value => { value.video.durationSeconds = '12'; }, value => { value.assets = []; }, value => { delete value.video; },
    value => { value.video.poster = 'https://cdn.example.org/unreviewed.jpg'; }, value => { value.video.url = 'http://cdn.example.org/movie.mp4'; },
    value => { value.video.originalUrl = 'https://127.0.0.1/movie.mp4'; }, value => { value.video.license.name = 'CC BY 4.0'; },
    value => { value.video.contentHash = 'invalid'; }]) {
    const value = licensedVideo(); change(value);
    assert.equal(catalog.validateManifest({ ...partial(value), omitPublicAttribution: true }).valid, false);
  }
  const first = licensedVideo(1), second = licensedVideo(2);
  second.video.originalUrl = first.video.originalUrl + '?download=1'; second.video.contentHash = first.video.contentHash;
  const checked = catalog.validateManifest(partial(first, second));
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some(error => error.includes('video.originalUrl') && error.includes('重复')));
  assert.ok(checked.errors.some(error => error.includes('video.contentHash') && error.includes('重复')));
  const photo = item('photo', 1); photo.video = first.video;
  assert.equal(catalog.validateManifest(partial(photo)).valid, false);
});

test('build refuses insufficient, excessive or unapproved batches without changing existing output', t => {
  const { directory, output } = temporary(t);
  fs.writeFileSync(output, 'keep the current catalogue\n');
  const unapproved = fullManifest();
  unapproved.items.at(-1).review = { status: 'pending' };
  const excessive = fullManifest(); excessive.items.push(item('photo', 201));
  for (const [manifest, pattern] of [[partial(), /100 条知识卡和 200 条/], [partial(item('knowledge', 1)), /100 条知识卡和 200 条/], [excessive, /100 条知识卡和 200 条/], [unapproved, /全部 300 条.*approved/]]) {
    assert.throws(() => catalog.buildCatalog(manifest, { output }), pattern);
    assert.equal(fs.readFileSync(output, 'utf8'), 'keep the current catalogue\n');
    assert.deepEqual(fs.readdirSync(directory), ['curated.js']);
  }
});

test('approved status requires reviewer, valid review date and checked source metadata', () => {
  const value = item('knowledge', 1);
  value.review = { status: 'approved', reviewer: '', reviewedAt: '2026-02-30' };
  delete value.source.author;
  value.source.checkedAt = 'yesterday';
  const result = catalog.validateManifest(partial(value));
  assert.equal(result.valid, false);
  for (const key of ['review.reviewer', 'review.reviewedAt', 'source.author', 'source.checkedAt']) assert.ok(result.errors.some(error => error.includes(key)), key);
  assert.equal(catalog.status(partial(value)).readyToBuild, false);
});

test('normalised duplicate body and duplicate IDs are rejected across a batch', () => {
  const first = item('knowledge', 1);
  const second = item('knowledge', 2);
  first.text += ' ABC １２３';
  second.text = first.text.normalize('NFKC').toLowerCase().replace(/。/g, '。\n  ');
  second.id = first.id;
  const result = catalog.validateManifest(partial(first, second));
  assert.ok(result.errors.some(error => error.includes('items[1].id') && error.includes('重复')));
  assert.ok(result.errors.some(error => error.includes('items[1].text') && error.includes('重复')));
});

test('resized/query-string versions and duplicate hashes cannot inflate image counts', () => {
  const first = item('photo', 1), second = item('photo', 2);
  first.assets[0].originalUrl = 'https://images.example.org/original/%70et.jpg?width=300';
  second.assets[0].originalUrl = 'https://IMAGES.example.org/original/pet.jpg?width=1000#preview';
  second.assets[0].contentHash = 'sha256:' + first.assets[0].contentHash.toUpperCase();
  const result = catalog.validateManifest(partial(first, second));
  assert.ok(result.errors.some(error => error.includes('originalUrl') && error.includes('重复')));
  assert.ok(result.errors.some(error => error.includes('contentHash') && error.includes('重复')));
});

test('field constraints reject missing long-form text, unrecognised topics, invented accounts and invalid types', () => {
  const cases = [
    ['text', value => { value.text = '短知识'; }],
    ['text', value => { value.text = '前面' + ' '.repeat(80) + '后面'; }],
    ['title', value => { value.title = '标'.repeat(41); }],
    ['topics', value => { value.topics = ['不存在的话题']; }],
    ['topics', value => { value.topics = ['宠物治愈时刻', '新手养宠', '一起散步', '养宠经验']; }],
    ['editorId', value => { value.editorId = 'invented-pet-owner'; }],
    ['circleId', value => { value.circleId = 'private-circle'; }],
    ['id', value => { value.id = 'photo-wrong-type'; }],
    ['contentType', value => { value.type = ['knowledge']; }]
  ];
  for (const [field, change] of cases) {
    const value = item('knowledge', 1); change(value);
    const result = catalog.validateManifest(partial(value));
    assert.equal(result.valid, false, field);
    assert.ok(result.errors.some(error => error.includes('.' + field)), field);
  }
});

test('source addresses reject local/private/reserved hosts, credentials and non-HTTPS URLs', () => {
  const blocked = ['http://sources.example.org/article', '/assets/photo.png', 'data:image/png;base64,YQ==',
    'https://user:password@sources.example.org/article', 'https://localhost/article', 'https://api.internal/article', 'https://127.0.0.1/article',
    'https://2130706433/article', 'https://10.1.1.2/article', 'https://172.20.1.1/article', 'https://192.168.1.1/article', 'https://100.64.0.1/article',
    'https://169.254.169.254/article', 'https://192.0.2.1/article', 'https://[::1]/article', 'https://[::ffff:192.168.1.1]/article', 'https://[fc00::1]/article', 'https://sources.example.invalid/article'];
  for (const url of blocked) {
    const value = item('knowledge', 1); value.source.url = url;
    assert.equal(catalog.validateManifest(partial(value)).valid, false, url);
  }
  for (const url of ['https://sources.example.org/article', 'https://8.8.8.8/article', 'https://[2606:4700:4700::1111]/article']) {
    const value = item('knowledge', 1); value.source.url = url;
    assert.equal(catalog.validateManifest(partial(value)).valid, true, url);
  }
});

test('hosted images accept external HTTPS/cloud files but reject local paths and embedded data', () => {
  for (const url of ['https://cdn.example.org/one.jpg', 'cloud://environment.bucket/photos/one.jpg']) {
    const value = item('photo', 1); value.assets[0].url = url;
    assert.equal(catalog.validateManifest(partial(value)).valid, true, url);
  }
  for (const url of ['file:///tmp/one.jpg', 'wxfile://one.jpg', '/assets/one.png', 'data:image/png;base64,YQ==', 'http://cdn.example.org/one.jpg', 'cloud://environment.bucket/', 'cloud://account:secret@environment.bucket/file.jpg', 'cloud://environment.bucket/file.jpg?token=secret']) {
    const value = item('photo', 1); value.assets[0].url = url;
    assert.equal(catalog.validateManifest(partial(value)).valid, false, url);
  }
});

test('photo items require one to three individually credited, licensed assets', () => {
  for (const assets of [undefined, [], [asset(1), asset(2), asset(3), asset(4)]]) {
    const value = item('photo', 1); value.assets = assets;
    assert.equal(catalog.validateManifest(partial(value)).valid, false);
  }
  for (const field of ['author', 'sourceUrl', 'originalUrl', 'attribution']) {
    const value = item('photo', 1); delete value.assets[0][field];
    assert.equal(catalog.validateManifest(partial(value)).valid, false, field);
  }
  for (const license of [{ name: 'CC BY 4.0' }, { url: 'https://creativecommons.org/licenses/by/4.0/' }, { name: 'All rights reserved', url: 'https://sources.example.org/rights' }]) {
    const value = item('photo', 1); value.assets[0].license = license;
    assert.equal(catalog.validateManifest(partial(value)).valid, false);
  }
});

test('supported license declarations and explicit permission evidence remain metadata-only checks', () => {
  for (const name of ['CC0 1.0', 'Public Domain', 'CC BY 2.5', 'CC BY 4.0', 'CC BY-SA 4.0', 'Pexels', 'Unsplash']) {
    const value = item('photo', 1); value.assets[0].license.name = name;
    assert.equal(catalog.validateManifest(partial(value)).valid, true, name);
  }
  const value = item('photo', 1);
  value.assets[0].license = { name: 'permission', url: 'https://sources.example.org/permission-statement' };
  assert.equal(catalog.validateManifest(partial(value)).valid, false);
  value.assets[0].permissionRef = 'permission-register-2026-test-001';
  assert.equal(catalog.validateManifest(partial(value)).valid, true);
});

test('complete approved batch generates 300 attributed posts with 200 external images and no fictional activity', t => {
  const { output, directory } = temporary(t);
  const manifest = fullManifest();
  manifest.items[0].editorId = 'catalog-cat-behavior';
  manifest.items.at(-1).assets[0].url = 'cloud://environment.bucket/pets/200.jpg';
  manifest.items.at(-1).assets[0].license = { name: 'permission', url: 'https://sources.example.org/permission-statement' };
  manifest.items.at(-1).assets[0].permissionRef = 'permission-register-2026-test-200';
  assert.equal(catalog.status(manifest).readyToBuild, true);
  const result = catalog.buildCatalog(manifest, { output });
  assert.equal(result.changed, true);
  const generated = evaluate(output);
  assert.equal(generated.CURATED_POSTS.length, 300);
  assert.equal(generated.CURATED_POSTS.filter(post => post.contentType === 'knowledge').length, 100);
  assert.equal(generated.CURATED_POSTS.flatMap(post => post.images).length, 200);
  assert.ok(generated.CURATED_POSTS.flatMap(post => post.images).every(url => /^(https|cloud):\/\//.test(url)));
  assert.deepEqual(generated.CURATED_POSTS[0].source, manifest.items[0].source);
  assert.equal(generated.CURATED_POSTS[0].editorId, 'catalog-cat-behavior');
  const last = generated.CURATED_POSTS.at(-1);
  assert.equal(last.editorId, 'catalog-photo');
  assert.equal(last.imageCredits[0].author, manifest.items.at(-1).assets[0].author);
  assert.equal(last.imageCredits[0].licenseName, 'permission');
  assert.equal(last.imageCredits[0].modifiedDescription, '仅测试缩放说明');
  assert.equal('permissionRef' in last.imageCredits[0], false);
  assert.equal(fs.readFileSync(output, 'utf8').includes('permission-register-2026-test-200'), false);
  assert.ok(generated.CURATED_POSTS.every(post => !('likes' in post) && !('likeCount' in post) && !('comments' in post) && !('authorId' in post) && !('createdAt' in post)));
  assert.deepEqual(fs.readdirSync(directory), ['curated.js']);
});

test('build is byte-stable and does not rewrite unchanged output, even when input ordering changes', t => {
  const { output } = temporary(t);
  const manifest = fullManifest();
  const first = catalog.buildCatalog(manifest, { output });
  const before = fs.readFileSync(output);
  fs.utimesSync(output, new Date(1000), new Date(1000));
  const modifiedAt = fs.statSync(output).mtimeMs;
  manifest.items.reverse();
  const second = catalog.buildCatalog(manifest, { output });
  assert.equal(second.changed, false);
  assert.equal(second.version, first.version);
  assert.equal(second.hash, first.hash);
  assert.deepEqual(fs.readFileSync(output), before);
  assert.equal(fs.statSync(output).mtimeMs, modifiedAt);
  manifest.items[0].text += ' 测试修订内容。';
  const revised = catalog.buildCatalog(manifest, { output });
  assert.equal(revised.changed, true);
  assert.notEqual(revised.version, first.version);
});

test('canonical manifest fields and stable knowledge IDs work while conflicting aliases are rejected', t => {
  const { output } = temporary(t);
  const manifest = fullManifest();
  for (const value of manifest.items) {
    value.id = value.id.replace(/^guide-/, 'knowledge-');
    value.contentType = value.type;
    value.images = value.assets;
    delete value.type;
    delete value.assets;
    for (const image of value.images) {
      image.modifiedDescription = image.changes;
      delete image.changes;
    }
  }
  const checked = catalog.validateManifest(manifest);
  assert.equal(checked.valid, true);
  assert.equal(checked.items[0].contentType, 'knowledge');
  assert.equal(checked.items[0].id, 'knowledge-001');
  assert.ok(Array.isArray(checked.items[0].images));
  catalog.buildCatalog(manifest, { output });
  const posts = evaluate(output).CURATED_POSTS;
  assert.equal(posts[0].id, 'knowledge-001');
  assert.equal(posts.at(-1).imageCredits[0].modifiedDescription, '仅测试缩放说明');
  const conflicted = JSON.parse(JSON.stringify(manifest));
  conflicted.items[0].type = 'photo';
  conflicted.items.at(-1).assets = [];
  conflicted.items.at(-1).images[0].changes = '与规范字段不同的修改说明';
  const rejected = catalog.validateManifest(conflicted);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.errors.filter(error => error.includes('冲突')).length, 3);
});

test('failed metadata validation leaves an existing catalogue byte-for-byte intact and creates no temporary file', t => {
  const { output, directory } = temporary(t);
  fs.writeFileSync(output, 'old catalogue bytes');
  const invalid = fullManifest(); invalid.items.at(-1).assets[0].license.url = '';
  assert.throws(() => catalog.buildCatalog(invalid, { output }), /元数据校验失败/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'old catalogue bytes');
  assert.deepEqual(fs.readdirSync(directory), ['curated.js']);
});

test('CLI status and validate print counts, while malformed/unapproved build input fails without output changes', t => {
  const { input, output } = temporary(t);
  fs.writeFileSync(input, JSON.stringify(partial(item('knowledge', 1, 'pending'))));
  let printed = '';
  const result = main(['status', input], { write: value => { printed += value; } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(printed).approved, { knowledge: 0, photo: 0 });
  fs.writeFileSync(output, 'retained');
  assert.throws(() => main(['build', input], { output, write() {} }), /100 条知识卡/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'retained');
  const invalid = partial(item('photo', 1)); delete invalid.items[0].assets[0].license;
  fs.writeFileSync(input, JSON.stringify(invalid));
  const child = spawnSync(process.execPath, [path.join(catalog.ROOT, 'scripts/content-batch.js'), 'validate', input], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(JSON.parse(child.stdout).metadataValid, false);
  fs.writeFileSync(input, '{not-json');
  assert.throws(() => main(['build', input], { output, write() {} }), /无法读取内容清单/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'retained');
});

test('CLI build can be exercised against a temporary target without importing or touching production data', t => {
  const { input, output } = temporary(t);
  fs.writeFileSync(input, JSON.stringify(fullManifest()));
  let printed = '';
  const result = main(['build', input], { output, write: value => { printed += value; } });
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(printed).output, output);
  assert.equal(evaluate(output).CURATED_POSTS.length, 300);
  assert.throws(() => main(['download', input], { write() {} }), /用法/);
});

test('explicit partial build can publish a small approved snapshot and reports target coverage', t => {
  const { output } = temporary(t);
  const manifest = partial(item('knowledge', 1), item('photo', 1));
  assert.equal(catalog.status(manifest).readyToBuild, false);
  assert.equal(catalog.status(manifest).readyToBuildPartial, true);
  assert.throws(() => catalog.buildCatalog(manifest, { output }), /100 条知识卡和 200 条/);
  const result = catalog.buildCatalog(manifest, { output, partial: true });
  assert.equal(result.writtenCount, 2);
  assert.equal(result.isPartial, true);
  assert.equal(result.buildMode, 'partial');
  assert.equal(result.snapshotMode, 'replace');
  assert.match(result.snapshotNotice, /完整快照.*未列出的旧条目将撤下/);
  assert.deepEqual(result.coverage, { knowledge: { count: 1, approved: 1, target: 100 }, photo: { count: 1, approved: 1, target: 200 } });
  assert.deepEqual(evaluate(output).CURATED_POSTS.map(post => post.id), ['guide-001', 'photo-001']);
});

test('partial build refuses empty, unapproved, invalid and over-target snapshots without altering a current catalogue', t => {
  const { output, directory } = temporary(t);
  const original = partial(item('knowledge', 1), item('photo', 1));
  catalog.buildCatalog(original, { output, partial: true });
  const previous = fs.readFileSync(output);
  const invalid = partial(item('photo', 2)); delete invalid.items[0].assets[0].license;
  const tooManyKnowledge = partial(...Array.from({ length: 101 }, (_, index) => item('knowledge', index + 1)));
  const tooManyPhotos = partial(...Array.from({ length: 201 }, (_, index) => item('photo', index + 1)));
  for (const [manifest, expected] of [[partial(), /不能用空清单清空目录/], [partial(item('knowledge', 1, 'pending')), /每条内容.*approved/], [partial(item('photo', 1, 'rejected')), /每条内容.*approved/], [invalid, /元数据校验失败/], [tooManyKnowledge, /不能超过/], [tooManyPhotos, /不能超过/]]) {
    assert.throws(() => catalog.buildCatalog(manifest, { output, partial: true }), expected);
    assert.deepEqual(fs.readFileSync(output), previous);
    assert.deepEqual(fs.readdirSync(directory), ['curated.js']);
  }
  assert.throws(() => catalog.buildCatalog(original, { output, partial: 'true' }), /布尔值/);
  assert.deepEqual(fs.readFileSync(output), previous);
});

test('partial builds manage complete snapshots, preserving listed content and withdrawing omitted entries', t => {
  const { output } = temporary(t);
  const first = partial(item('knowledge', 1), item('photo', 1));
  catalog.buildCatalog(first, { output, partial: true });
  // A later snapshot includes previously collected content that must remain.
  const expanded = partial(...first.items, item('knowledge', 2));
  catalog.buildCatalog(expanded, { output, partial: true });
  assert.deepEqual(evaluate(output).CURATED_POSTS.map(post => post.id), ['guide-001', 'guide-002', 'photo-001']);
  // An explicitly supplied subset is the replacement snapshot, not a delta.
  const replacement = partial(item('knowledge', 2));
  const result = catalog.buildCatalog(replacement, { output, partial: true });
  assert.equal(result.snapshotMode, 'replace');
  assert.equal(result.writtenCount, 1);
  assert.deepEqual(evaluate(output).CURATED_POSTS.map(post => post.id), ['guide-002']);
});

test('partial mode keeps the same deterministic hash rules and does not rewrite identical snapshots', t => {
  const { output } = temporary(t);
  const manifest = partial(item('photo', 1), item('knowledge', 1));
  const first = catalog.buildCatalog(manifest, { output, partial: true });
  const previous = fs.readFileSync(output);
  fs.utimesSync(output, new Date(1000), new Date(1000));
  const modifiedAt = fs.statSync(output).mtimeMs;
  manifest.items.reverse();
  const repeat = catalog.buildCatalog(manifest, { output, partial: true });
  assert.equal(repeat.changed, false);
  assert.equal(repeat.version, first.version);
  assert.deepEqual(fs.readFileSync(output), previous);
  assert.equal(fs.statSync(output).mtimeMs, modifiedAt);
  const complete = fullManifest();
  const full = catalog.buildCatalog(complete, { output });
  const partialFlagAtTarget = catalog.buildCatalog(complete, { output, partial: true });
  assert.equal(partialFlagAtTarget.version, full.version);
  assert.equal(partialFlagAtTarget.changed, false);
  assert.equal(partialFlagAtTarget.isPartial, false, 'coverage is complete even when the optional partial mode is used');
  assert.equal(partialFlagAtTarget.buildMode, 'partial');
});

test('CLI explicitly enables small snapshot builds and explains replacement semantics', t => {
  const { input, output } = temporary(t);
  fs.writeFileSync(input, JSON.stringify(partial(item('photo', 1))));
  let printed = '';
  const result = main(['build', '--partial', input], { output, write: value => { printed += value; } });
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(printed);
  assert.equal(parsed.isPartial, true);
  assert.equal(parsed.writtenCount, 1);
  assert.equal(parsed.snapshotMode, 'replace');
  assert.match(parsed.snapshotNotice, /完整快照/);
  assert.equal(evaluate(output).CURATED_POSTS.length, 1);
  let help = '';
  assert.equal(main(['--help'], { write: value => { help += value; } }).exitCode, 0);
  assert.match(help, /build \[--partial\]/);
  assert.match(help, /此前已采集且仍需发布/);
  for (const args of [['status', '--partial', input], ['validate', '--partial', input], ['build', '--partial', '--partial', input], ['build', '--unknown', input]]) assert.throws(() => main(args, { output, write() {} }), /用法/);
  fs.writeFileSync(input, JSON.stringify(partial()));
  assert.throws(() => main(['build', '--partial', input], { output, write() {} }), /不能用空清单清空目录/);
  assert.equal(evaluate(output).CURATED_POSTS.length, 1);
});

test('bundled editorial videos require a numeric MP4 path, real bounded bytes and a matching hash', t => {
  const { directory, output } = temporary(t);
  const assetsRoot = path.join(directory, 'mini');
  const videoDirectory = path.join(assetsRoot, 'assets/curated-video');
  fs.mkdirSync(videoDirectory, { recursive: true });
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/video-one-second.mp4'));
  const file = path.join(videoDirectory, '123.mp4'); fs.writeFileSync(file, bytes);
  const video = licensedVideo(); video.video.url = '/assets/curated-video/123.mp4';
  video.video.contentHash = createHash('sha256').update(bytes).digest('hex');
  const manifest = { ...partial(video), targets: { knowledge: 0, photo: 0, video: 1 }, omitPublicAttribution: true };
  assert.equal(catalog.validateManifest(manifest, { assetsRoot }).valid, true);
  assert.equal(catalog.status(manifest, { assetsRoot }).readyToBuild, true);
  catalog.buildCatalog(manifest, { assetsRoot, output });
  assert.equal(evaluate(output).CURATED_POSTS[0].video.url, video.video.url);
  for (const url of ['/assets/curated-video/word.mp4', '/assets/curated-video/123.mov', '/assets/other/123.mp4',
    '/assets/curated-video/../123.mp4', '/assets/curated-video/123.mp4?token=x', '/assets/curated-video/%31.mp4', '/assets/curated-video/456.mp4']) {
    const copy = structuredClone(manifest); copy.items[0].video.url = url;
    assert.equal(catalog.validateManifest(copy, { assetsRoot }).valid, false, url);
  }
  const missingHash = structuredClone(manifest); delete missingHash.items[0].video.contentHash;
  assert.equal(catalog.validateManifest(missingHash, { assetsRoot }).valid, false);
  fs.appendFileSync(file, 'changed');
  assert.equal(catalog.validateManifest(manifest, { assetsRoot }).valid, false);
  fs.writeFileSync(file, Buffer.alloc(300 * 1024 + 1));
  video.video.contentHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(catalog.validateManifest(manifest, { assetsRoot }).valid, false);
  fs.rmSync(file); fs.writeFileSync(path.join(directory, 'outside.mp4'), bytes);
  fs.symlinkSync(path.join(directory, 'outside.mp4'), file);
  video.video.contentHash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(catalog.validateManifest(manifest, { assetsRoot }).valid, false, 'a symlink must not escape the bundled video directory');
});

test('the bundled-video exception does not admit MP4 image, poster or original-source paths', t => {
  const { directory } = temporary(t);
  const assetsRoot = path.join(directory, 'mini');
  fs.mkdirSync(path.join(assetsRoot, 'assets/curated-video'), { recursive: true });
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/video-one-second.mp4'));
  fs.writeFileSync(path.join(assetsRoot, 'assets/curated-video/1.mp4'), bytes);
  const local = '/assets/curated-video/1.mp4';
  const value = licensedVideo(); value.video.url = local;
  value.video.contentHash = createHash('sha256').update(bytes).digest('hex');
  for (const change of [copy => { copy.assets[0].url = local; }, copy => { copy.video.poster = local; }, copy => { copy.video.originalUrl = local; }]) {
    const copy = structuredClone(value); change(copy);
    assert.equal(catalog.validateManifest(partial(copy), { assetsRoot }).valid, false);
  }
});

test('editorial image groups reuse two or three reviewed photos in order with complete credits', t => {
  const { output } = temporary(t);
  const group = item('knowledge', 1);
  const photos = [item('photo', 1), item('photo', 2), item('photo', 3)];
  group.imagePhotoIds = [photos[2].id, photos[0].id, photos[1].id];
  const manifest = { ...partial(group, ...photos), targets: { knowledge: 1, photo: 3 } };
  assert.equal(catalog.validateManifest(manifest).valid, true);
  catalog.buildCatalog(manifest, { output });
  const result = evaluate(output).CURATED_POSTS;
  const generated = result.find(post => post.id === group.id);
  assert.deepEqual(generated.imagePhotoIds, group.imagePhotoIds);
  assert.deepEqual(generated.images, [photos[2], photos[0], photos[1]].map(photo => photo.assets[0].url));
  assert.deepEqual(generated.imageCredits, group.imagePhotoIds.map(id => result.find(post => post.id === id).imageCredits[0]));
  assert.deepEqual(generated.source, group.source);
  assert.deepEqual(catalog.status(manifest).counts, { knowledge: 1, photo: 3 });
});

test('editorial image references reject duplicates, missing or non-photo targets, unreviewed photos and conflicting covers', t => {
  const { output } = temporary(t);
  const group = item('knowledge', 1), photos = [item('photo', 1), item('photo', 2)];
  group.imagePhotoIds = photos.map(photo => photo.id);
  const initial = partial(group, ...photos);
  for (const change of [
    value => { value.items[0].imagePhotoIds = 'photo-001'; },
    value => { value.items[0].imagePhotoIds = ['photo-001']; },
    value => { value.items[0].imagePhotoIds = ['photo-001', 'photo-001']; },
    value => { value.items[0].imagePhotoIds = ['photo-001', 'photo-002', 'photo-003', 'photo-004']; },
    value => { value.items[0].imagePhotoIds[1] = 'photo-missing'; },
    value => { value.items[0].imagePhotoIds[1] = group.id; },
    value => { value.items[0].coverPhotoId = photos[0].id; },
    value => { value.items[0].assets = [asset(8)]; },
    value => { value.items[1].imagePhotoIds = [photos[0].id, photos[1].id]; }
  ]) {
    const manifest = structuredClone(initial); change(manifest);
    assert.equal(catalog.validateManifest(manifest).valid, false);
  }
  const pending = structuredClone(initial); pending.items[1].review = { status: 'pending' };
  assert.throws(() => catalog.buildCatalog(pending, { output, partial: true }), /每条内容.*approved/);
});

test('media subpackage supports new paths and resolves old URLs without changing their catalogue values', t => {
  const { directory, output } = temporary(t);
  const assetsRoot = path.join(directory, 'mini');
  fs.mkdirSync(path.join(assetsRoot, 'media/clips'), { recursive: true });
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/video-one-second.mp4'));
  fs.writeFileSync(path.join(assetsRoot, 'media/clips/123.mp4'), bytes);
  for (const name of ['media2', 'media9']) {
    fs.mkdirSync(path.join(assetsRoot, name, 'clips'), { recursive: true });
    fs.writeFileSync(path.join(assetsRoot, name, 'clips/123.mp4'), bytes);
  }
  const video = licensedVideo();
  video.video.contentHash = createHash('sha256').update(bytes).digest('hex');
  for (const url of ['/media/clips/123.mp4', '/media2/clips/123.mp4', '/media9/clips/123.mp4', '/assets/curated-video/123.mp4']) {
    video.video.url = url;
    const manifest = { ...partial(video), targets: { knowledge: 0, photo: 0, video: 1 } };
    assert.equal(catalog.validateManifest(manifest, { assetsRoot }).valid, true);
    catalog.buildCatalog(manifest, { assetsRoot, output });
    assert.equal(evaluate(output).CURATED_POSTS[0].video.url, url);
  }
  for (const url of ['/media/clips/../123.mp4', '/media/clips/word.mp4', '/media/clips/123.mp4?x=1', '/media1/clips/123.mp4', '/media10/clips/123.mp4', '/media2/other/123.mp4']) {
    video.video.url = url;
    assert.equal(catalog.validateManifest(partial(video), { assetsRoot }).valid, false);
  }
});

test('new photo groups may append credited existing images but must include a unique new original', t => {
  const { output } = temporary(t);
  const old = item('photo', 1), fresh = item('photo', 2);
  fresh.additionalPhotoIds = [old.id];
  const manifest = { ...partial(old, fresh), targets: { knowledge: 0, photo: 2 } };
  catalog.buildCatalog(manifest, { output });
  const rows = evaluate(output).CURATED_POSTS;
  assert.deepEqual(rows[1].images, [fresh.assets[0].url, old.assets[0].url]);
  assert.equal(rows[1].imageCredits[1].attribution, old.assets[0].attribution);
  for (const change of [
    value => { value.items[1].assets = []; },
    value => { value.items[1].assets = structuredClone(value.items[0].assets); },
    value => { value.items[1].additionalPhotoIds = [value.items[1].id]; },
    value => { value.items[1].additionalPhotoIds = ['photo-missing']; },
    value => { value.items[0].review = { status: 'pending' }; },
    value => { value.items[1].additionalPhotoIds = [old.id, old.id]; },
    value => { value.items[0].assets.push(asset(7)); }
  ]) {
    const invalid = structuredClone(manifest); change(invalid);
    assert.equal(catalog.validateManifest(invalid).valid, false);
  }
});

test('bundled JPEG video frames require exact paths, bounded bytes and hashes without bypassing original-video deduplication', t => {
  const { directory, output } = temporary(t);
  const assetsRoot = path.join(directory, 'mini');
  const posterDirectory = path.join(assetsRoot, 'assets/curated-poster');
  fs.mkdirSync(posterDirectory, { recursive: true });
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/poster-small.jpg'));
  const file = path.join(posterDirectory, '123.jpg'); fs.writeFileSync(file, bytes);
  const video = licensedVideo();
  video.assets[0].url = video.video.poster = '/assets/curated-poster/123.jpg';
  video.assets[0].contentHash = createHash('sha256').update(bytes).digest('hex');
  video.assets[0].originalUrl = video.video.originalUrl;
  const manifest = { ...partial(video), targets: { knowledge: 0, photo: 0, video: 1 }, omitPublicAttribution: true };
  assert.equal(catalog.validateManifest(manifest, { assetsRoot }).valid, true);
  catalog.buildCatalog(manifest, { assetsRoot, output });
  assert.equal(evaluate(output).CURATED_POSTS[0].images[0], video.video.poster);
  for (const url of ['/assets/curated-poster/word.jpg', '/assets/curated-poster/123.png', '/assets/curated-poster/123.jpg?x=1',
    '/assets/curated-poster/../123.jpg', '/media/123.jpg', '/assets/curated-poster/456.jpg']) {
    const copy = structuredClone(manifest); copy.items[0].assets[0].url = copy.items[0].video.poster = url;
    assert.equal(catalog.validateManifest(copy, { assetsRoot }).valid, false, url);
  }
  const missing = structuredClone(manifest); delete missing.items[0].assets[0].contentHash;
  assert.equal(catalog.validateManifest(missing, { assetsRoot }).valid, false);
  const duplicate = licensedVideo(2); duplicate.video.originalUrl = video.video.originalUrl;
  assert.equal(catalog.validateManifest(partial(video, duplicate), { assetsRoot }).valid, false);
  const photo = item('photo', 1); photo.assets[0] = structuredClone(video.assets[0]);
  assert.equal(catalog.validateManifest(partial(photo), { assetsRoot }).valid, false, 'local poster exception is video-only');
  fs.writeFileSync(file, Buffer.alloc(100 * 1024 + 1));
  assert.equal(catalog.validateManifest(manifest, { assetsRoot }).valid, false);
  fs.writeFileSync(file, Buffer.from('not a JPEG'));
  video.assets[0].contentHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(catalog.validateManifest(manifest, { assetsRoot }).valid, false);
  fs.rmSync(file); fs.writeFileSync(path.join(directory, 'outside.jpg'), bytes);
  fs.symlinkSync(path.join(directory, 'outside.jpg'), file);
  video.assets[0].contentHash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(catalog.validateManifest(manifest, { assetsRoot }).valid, false, 'symlink cannot escape poster directory');
});
