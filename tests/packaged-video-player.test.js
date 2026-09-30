'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const shared = require('../miniprogram/pages/_shared');
const createPlayer = require('../miniprogram/pages/post/_player');

const rawPost = (url = '/assets/curated-video/112285953.mp4') => ({ id: 'video-commons-112285953', title: '寄居蟹观察', images: [], video: { url, durationSeconds: 8 }, author: { nickname: '内容编辑' } });
const event = (page, values = {}, detail = { currentTime: .25 }) => ({ detail, currentTarget: { dataset: { src: page.data.videoSource, attempt: page.data.videoAttempt, ...values } } });
function mp4Bytes(length = 32) { const bytes = new Uint8Array(length); bytes.set([0, 0, 0, 32, 102, 116, 121, 112]); return bytes.buffer; }
const turn = () => new Promise(resolve => setImmediate(resolve));
const cachedSource = (page, root, id) => assert.match(page.data.videoSource, new RegExp('^wxfile://usr/pet-video-v1-' + root + '-' + id + '-[a-z0-9]+-\\d+-\\d+\\.mp4$'));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function fixture(t, root = 'media') {
  const previous = { wx: global.wx, call: shared.api.call, warn: console.warn };
  const effects = { calls: [], pauses: [], plays: [], writes: [], callbacks: [], copies: [], reads: [], fileWrites: [], unlinks: [], diagnostics: [] };
  const files = {
    copyFile(options) { effects.copies.push({ srcPath: options.srcPath, destPath: options.destPath }); options.success({}); },
    readFile(options) { effects.reads.push(options.filePath); options.success({ data: mp4Bytes() }); },
    writeFile(options) { effects.fileWrites.push({ filePath: options.filePath, data: options.data }); options.success({}); },
    unlink(options) { effects.unlinks.push(options.filePath); options.success({}); }
  };
  console.warn = (...args) => effects.diagnostics.push(args);
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getFileSystemManager() { return files; },
    createVideoContext(id, page) { assert.equal(id, 'post-video'); return { pause() { effects.pauses.push(page); }, play() { effects.plays.push(page); } }; },
    loadSubpackage() { assert.fail('a package page must not request or play resources in another package'); }
  };
  let reply = async () => ({ post: rawPost() });
  shared.api.call = async (name, input) => {
    assert.equal(name, 'getPost'); effects.calls.push(input); return reply(input);
  };
  t.after(() => { page.onUnload(); global.wx = previous.wx; shared.api.call = previous.call; console.warn = previous.warn; });
  const page = createPlayer(root);
  page.data = structuredClone(page.data);
  page.setData = function (values, callback) {
    assert.notEqual(this._closed, true, 'unloaded pages must never write their view');
    effects.writes.push(structuredClone(values));
    Object.assign(this.data, values);
    if (callback) effects.callbacks.push(callback);
  };
  async function commitView() { for (const callback of effects.callbacks.splice(0)) callback(); await turn(); }
  async function load(options = { id: rawPost().id }) { const pending = page.onLoad(options); await commitView(); await pending; page.onReady(); await commitView(); return page; }
  return { page, effects, files, load, commitView, reply(fn) { reply = fn; } };
}

test('a package player uses public post data and its own package, while shares retain the original detail link', async t => {
  const f = fixture(t);
  await f.load();
  assert.deepEqual(f.effects.calls, [{ id: rawPost().id }]);
  cachedSource(f.page, 'media', '112285953');
  assert.equal(f.effects.copies[0].srcPath, 'media/clips/112285953.mp4');
  assert.equal(f.effects.copies[0].destPath, f.page.data.videoSource);
  assert.equal(f.page.data.post.author.nickname, '内容编辑');
  assert.equal(f.page.data.loading, false);
  assert.equal(f.page.data.videoWaiting, true);
  f.page.videoProgress(event(f.page));
  assert.equal(f.page.data.videoWaiting, false);
  assert.equal(f.page.onShareAppMessage().path, '/pages/post/index?id=' + rawPost().id);
  assert.equal(f.page.onShareAppMessage().title, '寄居蟹观察');
  const second = createPlayer('media');
  assert.notEqual(second.data, f.page.data, 'page definitions do not share mutable state');
});

test('wrong-package, traversal, remote and missing-video inputs cannot become native player sources', async t => {
  const f = fixture(t, 'media2');
  for (const source of ['/media/clips/123.mp4', '/media2/clips/../123.mp4', '/media2/clips/%2e%2e/123.mp4', '/media2/clips/123.mp4?next=1', '/media2/clips/123.mp4#tail', '/media2/clips/name.mp4', 'https://example.com/123.mp4', 'cloud://123.mp4', '/media2/clips/123.mp4\n']) {
    f.reply(async () => ({ post: rawPost(source) }));
    await f.load();
    assert.equal(f.page.data.videoSource, '', source);
    assert.match(f.page.data.error, /不匹配/, source);
  }
  f.reply(async () => ({ post: { ...rawPost(), video: null } }));
  await f.load();
  assert.match(f.page.data.error, /没有可播放/);
  f.reply(async () => ({ post: rawPost('/media2/clips/123.mp4') }));
  await f.load();
  cachedSource(f.page, 'media2', '123');
  assert.equal(f.effects.copies.length, 1, 'only the validated own-package video can be read');
  assert.throws(() => createPlayer('../media'), /无效/);
  assert.throws(() => createPlayer('media1'), /无效/);
});

test('retry unmounts a failed native video before binding its source and ignores stale playback events', async t => {
  const f = fixture(t);
  await f.load();
  const oldEvent = event(f.page);
  f.page.videoFailed(oldEvent);
  assert.equal(f.page.data.videoError, true);
  const retry = f.page.retryVideo();
  assert.equal(f.page.data.videoSource, '');
  assert.equal(f.effects.calls.length, 1, 'retry waits for the old view to unmount before fetching and binding');
  f.page.videoProgress(oldEvent);
  f.page.videoBuffering(oldEvent);
  f.page.videoFailed(oldEvent);
  assert.equal(f.page.data.videoError, false);
  await f.commitView(); await retry;
  cachedSource(f.page, 'media', '112285953');
  assert.notEqual(f.page.data.videoSource, oldEvent.currentTarget.dataset.src, 'retry cannot reuse the failed cache file');
  assert.ok(f.effects.unlinks.includes(oldEvent.currentTarget.dataset.src), 'retry removes only its retired cache file');
  assert.equal(f.page.data.videoAttempt, oldEvent.currentTarget.dataset.attempt + 1);
  f.page.videoFailed(oldEvent);
  assert.equal(f.page.data.videoError, false, 'old failures cannot destroy a successful retry');
  f.page.videoProgress(event(f.page));
  f.page.videoBuffering(event(f.page));
  assert.equal(f.page.data.videoWaiting, true);
  f.page.videoFailed(event(f.page));
  f.page.videoProgress(event(f.page));
  assert.equal(f.page.data.videoError, true, 'late ready events cannot conceal a current failure');
  assert.equal(f.page.data.videoWaiting, false);
});

test('failed metadata can be retried and an older request cannot replace a newer one', async t => {
  const f = fixture(t);
  f.reply(async () => { throw new Error('网络中断'); });
  await f.load();
  assert.equal(f.page.data.error, '网络中断');
  const older = deferred();
  f.reply(() => older.promise);
  const stale = f.page.retryVideo(); await f.commitView();
  f.reply(async () => ({ post: rawPost('/media/clips/164819779.mp4') }));
  const current = f.page.retryVideo(); await f.commitView(); await current;
  older.resolve({ post: rawPost() }); await stale;
  cachedSource(f.page, 'media', '164819779');
  assert.equal(f.page.data.error, '');
});

test('hiding pauses playback and defers an unfinished load, while unloading blocks all late callbacks', async t => {
  const f = fixture(t);
  const pendingPost = deferred(); f.reply(() => pendingPost.promise);
  const pending = f.page.onLoad({ id: rawPost().id }); await f.commitView();
  f.page.onHide();
  pendingPost.resolve({ post: rawPost() }); await pending;
  assert.equal(f.page.data.videoSource, '', 'an autoplay video must not mount on a hidden page');
  f.page.onShow();
  cachedSource(f.page, 'media', '112285953');
  const active = event(f.page);
  f.page.onHide();
  const pauseCount = f.effects.pauses.length;
  f.page.onUnload();
  assert.equal(f.effects.pauses.length, pauseCount + 1);
  const writes = f.effects.writes.length;
  f.page.videoProgress(active); f.page.videoBuffering(active); f.page.videoFailed(active); f.page.onShow();
  await f.page.retryVideo();
  assert.equal(f.effects.writes.length, writes);
  assert.ok(f.effects.unlinks.includes(active.currentTarget.dataset.src));
});

test('closing while metadata or the view commit is pending never mounts a video', async t => {
  const f = fixture(t);
  const pendingPost = deferred(); f.reply(() => pendingPost.promise);
  const pending = f.page.onLoad({ id: rawPost().id }); await f.commitView();
  f.page.onUnload(); const writes = f.effects.writes.length;
  pendingPost.resolve({ post: rawPost() }); await pending;
  assert.equal(f.effects.writes.length, writes);
  assert.equal(f.page.data.videoSource, '');

  const other = createPlayer('media');
  other.setData = f.page.setData;
  const beforeCommit = other.onLoad({ id: rawPost().id });
  const requests = f.effects.calls.length;
  other.onUnload(); await f.commitView(); await beforeCommit;
  assert.equal(f.effects.calls.length, requests, 'unload before view commit cancels the metadata request too');
});

test('code-package copy failure falls back to binary read/write and records no post content', async t => {
  const f = fixture(t);
  const bytes = mp4Bytes(24);
  f.files.copyFile = options => options.fail({ errMsg: 'copyFile:fail operation not permitted', errCode: 1301000 });
  f.files.readFile = options => { f.effects.reads.push(options.filePath); options.success({ data: bytes }); };
  f.reply(async () => ({ post: { ...rawPost(), title: 'private title must not be in diagnostics', text: 'private text' } }));
  await f.load();
  cachedSource(f.page, 'media', '112285953');
  assert.deepEqual(f.effects.reads, ['media/clips/112285953.mp4', f.page.data.videoSource]);
  assert.equal(f.effects.fileWrites[0].data, bytes, 'binary video data must not be text encoded');
  assert.equal(f.effects.fileWrites[0].filePath, f.page.data.videoSource);
  f.page.videoFailed({ ...event(f.page), detail: { errMsg: 'MEDIA_ERR_SRC_NOT_SUPPORTED', errCode: 4 } });
  const diagnostics = JSON.stringify(f.effects.diagnostics);
  assert.match(diagnostics, /copy-file/); assert.match(diagnostics, /native-playback/);
  assert.match(diagnostics, /MEDIA_ERR_SRC_NOT_SUPPORTED/);
  assert.doesNotMatch(diagnostics, /private title|private text|内容编辑/);
});

test('filesystem failures remain retryable without binding a partial or unprepared video', async t => {
  const f = fixture(t);
  f.files.copyFile = options => options.fail({ errMsg: 'copyFile:fail' });
  f.files.writeFile = options => options.fail({ errMsg: 'writeFile:fail storage limit exceeded' });
  await f.load();
  assert.equal(f.page.data.videoSource, '');
  assert.match(f.page.data.error, /文件暂未准备好/);
  assert.equal(f.effects.unlinks.length, 1, 'a partially written cache file is discarded');
  f.files.copyFile = options => options.success({});
  const retry = f.page.retryVideo(); await f.commitView(); await retry;
  cachedSource(f.page, 'media', '112285953');
  assert.equal(f.page.data.error, '');
});

test('late filesystem work is discarded after retry or unload and cannot overwrite the active cache', async t => {
  const f = fixture(t);
  let oldCopy;
  f.files.copyFile = options => { oldCopy = options; };
  const pending = f.page.onLoad({ id: rawPost().id }); await f.commitView();
  assert.ok(oldCopy);
  f.files.copyFile = options => options.success({});
  const retry = f.page.retryVideo(); await f.commitView(); await retry;
  const activeSource = f.page.data.videoSource;
  oldCopy.success({}); await pending;
  assert.equal(f.page.data.videoSource, activeSource);
  assert.notEqual(oldCopy.destPath, activeSource);
  assert.ok(f.effects.unlinks.includes(oldCopy.destPath));
  assert.ok(!f.effects.unlinks.includes(activeSource), 'stale cleanup cannot remove the active file');

  let lateRead;
  f.files.copyFile = options => options.fail({ errMsg: 'copy unavailable' });
  f.files.readFile = options => { lateRead = options; };
  const closing = f.page.retryVideo(); await f.commitView();
  f.page.onUnload();
  lateRead.success({ data: new ArrayBuffer(16) }); await closing;
  assert.equal(f.effects.fileWrites.length, 0, 'a late read must not create a file after the page has closed');
  assert.equal(f.page.data.videoSource, '');
});

test('the browser preview continues to use its HTTP-served package asset', async t => {
  const f = fixture(t);
  global.wx.__preview = true;
  delete global.wx.getFileSystemManager;
  await f.load();
  assert.equal(f.page.data.videoSource, '/media/clips/112285953.mp4');
  assert.equal(f.effects.copies.length, 0);
});

test('WeChat upload configuration and project checks protect the controller required only from video subpackages', () => {
  const projectFile = path.resolve(__dirname, '../project.config.json');
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  const kept = entry => entry.type === 'file' && entry.value === 'pages/post/_player.js';
  assert.ok(project.packOptions.include.some(kept), 'unused-file pruning must retain the shared player controller');
  project.packOptions.include = project.packOptions.include.filter(entry => !kept(entry));
  const errors = [], processState = { exitCode: 0 };
  const checker = path.resolve(__dirname, '../scripts/check-project.js');
  vm.runInNewContext(fs.readFileSync(checker, 'utf8'), {
    __dirname: path.dirname(checker),
    process: processState,
    console: { log() {}, error(value) { errors.push(value); } },
    require(name) {
      if (name !== 'node:fs') return require(name);
      return { ...fs, readFileSync(file, options) { return path.resolve(String(file)) === projectFile ? JSON.stringify(project) : fs.readFileSync(file, options); } };
    }
  }, { filename: checker });
  assert.equal(processState.exitCode, 1);
  assert.ok(errors.some(value => value.includes('共享控制器 pages/post/_player.js 必须显式包含')), 'the check must fail when a future edit removes upload protection');
});

test('native play waits for both page readiness and the committed video node, and runs once', async t => {
  const f = fixture(t);
  const pending = f.page.onLoad({ id: rawPost().id });
  await f.commitView(); await pending;
  f.page.onReady();
  assert.equal(f.effects.plays.length, 0, 'page onReady is insufficient while the source view has not committed');
  await f.commitView();
  assert.equal(f.effects.plays.length, 1);
  f.page.onReady(); f.page.startVideo();
  assert.equal(f.effects.plays.length, 1, 'duplicate readiness callbacks must not restart playback');
  assert.ok(f.effects.diagnostics.some(values => values[1].stage === 'file-ready' && values[1].bytes === 32));
  assert.ok(f.effects.diagnostics.some(values => values[1].stage === 'native-mounted'));
});

test('metadata and play events do not prove visible progress or permit an endless startup spinner', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.load();
  f.page.videoMetadata(event(f.page, {}, { duration: 8 }));
  f.page.videoPlaying(event(f.page));
  f.page.videoProgress(event(f.page, {}, { currentTime: 0 }));
  assert.equal(f.page.data.videoWaiting, true);
  t.mock.timers.tick(8000);
  assert.equal(f.page.data.videoWaiting, false);
  assert.equal(f.page.data.videoError, true);
  assert.match(f.page.data.videoErrorText, /未能开始播放/);
  assert.ok(f.effects.diagnostics.some(values => values[1].stage === 'native-start-timeout'));
});

test('actual advancing frames clear buffering, stalled frames time out, and retry mounts a fresh player', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.load();
  const oldEvent = event(f.page);
  f.page.videoProgress(oldEvent);
  assert.equal(f.page.data.videoWaiting, false);
  assert.equal(f.effects.diagnostics.filter(values => values[1].stage === 'native-first-frame').length, 1);
  t.mock.timers.tick(6000);
  f.page.videoProgress(event(f.page, {}, { currentTime: .5 }));
  f.page.videoBuffering(event(f.page));
  t.mock.timers.tick(6000);
  assert.equal(f.page.data.videoError, false, 'advancing media resets the stall deadline');
  f.page.videoBuffering(event(f.page));
  f.page.videoProgress(event(f.page, {}, { currentTime: .5 }));
  t.mock.timers.tick(2000);
  assert.equal(f.page.data.videoError, true, 'repeated waiting or frozen time cannot postpone the timeout');
  assert.match(f.page.data.videoErrorText, /播放中断/);
  const retry = f.page.retryVideo(); await f.commitView(); await retry; await f.commitView();
  assert.equal(f.page.data.videoError, false);
  assert.equal(f.effects.plays.length, 2);
  f.page.videoFailed(oldEvent);
  assert.equal(f.page.data.videoError, false);
  f.page.videoProgress(event(f.page));
  f.page.videoEnded(event(f.page));
  t.mock.timers.tick(9000);
  assert.equal(f.page.data.videoError, false, 'completed playback must not be labelled stalled');
});

test('a stalled file preparation is bounded and its late output cannot bind after a retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  let copy;
  f.files.copyFile = options => { copy = options; };
  const pending = f.page.onLoad({ id: rawPost().id }); await f.commitView();
  t.mock.timers.tick(20000);
  assert.equal(f.page.data.loading, false);
  assert.match(f.page.data.error, /准备时间过长/);
  assert.equal(f.page.data.videoSource, '');
  f.files.copyFile = options => options.success({});
  const retry = f.page.retryVideo(); await f.commitView(); await retry;
  const source = f.page.data.videoSource;
  copy.success({}); await pending;
  assert.equal(f.page.data.videoSource, source);
  assert.ok(f.effects.unlinks.includes(copy.destPath));
  assert.ok(!f.effects.unlinks.includes(source));
});

test('the destination must contain a readable MP4, even after a successful file copy', async t => {
  const f = fixture(t);
  f.files.readFile = options => options.success({ data: new ArrayBuffer(32) });
  await f.load();
  assert.equal(f.page.data.videoSource, '');
  assert.equal(f.effects.plays.length, 0);
  assert.match(f.page.data.error, /文件暂未准备好/);
  assert.ok(f.effects.diagnostics.some(values => values[1].errMsg === '本地视频文件不完整'));
  assert.equal(f.effects.unlinks.length, 1);
});

test('explicit pause and backgrounding cancel the stall deadline without manufacturing an error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.load();
  f.page.videoProgress(event(f.page));
  f.page.videoPaused(event(f.page));
  t.mock.timers.tick(10000);
  assert.equal(f.page.data.videoError, false);
  f.page.videoPlaying(event(f.page));
  f.page.onHide();
  t.mock.timers.tick(10000);
  assert.equal(f.page.data.videoError, false);
});

test('native playback mounts the temporary media path returned by platform conversion, never the persistent input', async t => {
  const f = fixture(t);
  const converted = [];
  global.wx.compressVideo = options => { converted.push({ src: options.src, quality: options.quality }); options.success({ tempFilePath: 'wxfile://tmp/native-1.mp4' }); };
  await f.load();
  assert.deepEqual(converted, [{ src: f.effects.copies[0].destPath, quality: 'high' }]);
  assert.equal(f.page.data.videoSource, 'wxfile://tmp/native-1.mp4');
  assert.equal(f.effects.writes.some(value => value.videoSource === converted[0].src), false);
  assert.equal(f.effects.plays.length, 1);
  assert.ok(f.effects.diagnostics.some(values => values[1].stage === 'temporary-video-ready'));
  f.page.onUnload();
  assert.ok(f.effects.unlinks.includes(converted[0].src));
  assert.ok(f.effects.unlinks.includes('wxfile://tmp/native-1.mp4'));
});

test('only an explicitly unsupported conversion can fall back; actual encoding failures stay retryable', async t => {
  const f = fixture(t);
  global.wx.compressVideo = options => options.fail({ errMsg: 'compressVideo:fail not supported' });
  await f.load();
  cachedSource(f.page, 'media', '112285953');
  assert.ok(f.effects.diagnostics.some(values => values[1].stage === 'temporary-video-unsupported'));
  for (const errMsg of ['compressVideo:fail insufficient storage', 'compressVideo:fail codec not supported']) {
    global.wx.compressVideo = options => options.fail({ errMsg });
    const failed = f.page.retryVideo(); await f.commitView(); await failed;
    assert.equal(f.page.data.videoSource, '', errMsg);
    assert.match(f.page.data.error, /视频处理未完成/, errMsg);
  }
  global.wx.compressVideo = options => options.success({ tempFilePath: 'wxfile://tmp/native-retry.mp4' });
  const retry = f.page.retryVideo(); await f.commitView(); await retry; await f.commitView();
  assert.equal(f.page.data.videoSource, 'wxfile://tmp/native-retry.mp4');
  assert.equal(f.page.data.error, '');
});

test('conversion shares the preparation deadline and late output is removed without touching a newer player', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  let oldConversion;
  global.wx.compressVideo = options => { oldConversion = options; };
  const pending = f.page.onLoad({ id: rawPost().id }); await f.commitView();
  assert.ok(oldConversion);
  assert.equal(f.page.data.loadingText, '正在准备视频…');
  t.mock.timers.tick(20000);
  assert.equal(f.page.data.loading, false);
  assert.match(f.page.data.error, /准备时间过长/);
  global.wx.compressVideo = options => options.success({ tempFilePath: 'wxfile://tmp/active.mp4' });
  const retry = f.page.retryVideo(); await f.commitView(); await retry;
  oldConversion.success({ tempFilePath: 'wxfile://tmp/stale.mp4' }); await pending;
  assert.equal(f.page.data.videoSource, 'wxfile://tmp/active.mp4');
  assert.ok(f.effects.unlinks.includes('wxfile://tmp/stale.mp4'));
  assert.ok(!f.effects.unlinks.includes('wxfile://tmp/active.mp4'));
});

test('closing during platform conversion cannot mount or leak its late temporary output', async t => {
  const f = fixture(t);
  let converting;
  global.wx.compressVideo = options => { converting = options; };
  const pending = f.page.onLoad({ id: rawPost().id }); await f.commitView();
  f.page.onUnload();
  const writes = f.effects.writes.length;
  converting.success({ tempFilePath: 'wxfile://tmp/closed.mp4' }); await pending;
  assert.equal(f.effects.writes.length, writes);
  assert.equal(f.effects.plays.length, 0);
  assert.ok(f.effects.unlinks.includes(converting.src));
  assert.ok(f.effects.unlinks.includes('wxfile://tmp/closed.mp4'));
});

test('a page hidden between source commit and onReady starts once it becomes visible', async t => {
  const f = fixture(t);
  const pending = f.page.onLoad({ id: rawPost().id }); await f.commitView(); await pending;
  f.page.onHide(); await f.commitView(); f.page.onReady();
  assert.equal(f.effects.plays.length, 0);
  f.page.onShow();
  assert.equal(f.effects.plays.length, 1);
});

test('a native pause before the first advancing frame cannot disable the startup deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.load();
  f.page.videoPlaying(event(f.page)); f.page.videoPaused(event(f.page));
  t.mock.timers.tick(8000);
  assert.equal(f.page.data.videoError, true);
  assert.match(f.page.data.videoErrorText, /未能开始播放/);
});

test('only verified DevTools may bypass its missing ffmpeg dependency; phones retain real conversion failures', async t => {
  const f = fixture(t);
  const errMsg = 'compressVideo:fail 音视频处理需要使用 ffmpeg, 详见文档：https://developers.weixin.qq.com/miniprogram/dev/devtools/ffmpeg.html';
  global.wx.compressVideo = options => options.fail({ errMsg });
  for (const platform of ['ios', 'android', '', 'unknown']) {
    global.wx.getDeviceInfo = () => ({ platform });
    await f.load();
    assert.equal(f.page.data.videoSource, '', platform);
    assert.match(f.page.data.error, /视频处理未完成/, platform);
  }
  global.wx.getDeviceInfo = () => ({ platform: 'devtools' });
  await f.load();
  cachedSource(f.page, 'media', '112285953');
  assert.ok(f.effects.diagnostics.some(values => values[1].stage === 'temporary-video-devtools-dependency'));
  assert.equal(f.effects.plays.length, 1);
  global.wx.compressVideo = options => options.fail({ errMsg: 'compressVideo:fail ffmpeg could not decode this video' });
  await f.load();
  assert.equal(f.page.data.videoSource, '', 'a real ffmpeg codec failure is not an absent simulator dependency');
  assert.match(f.page.data.error, /视频处理未完成/);
  delete global.wx.getDeviceInfo;
  global.wx.getSystemInfoSync = () => ({ platform: 'devtools' });
  global.wx.compressVideo = options => options.fail({ errMsg });
  await f.load();
  cachedSource(f.page, 'media', '112285953');
});

test('backgrounding an already requested startup resumes its first play and retains a bounded startup deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.load();
  assert.equal(f.effects.plays.length, 1);
  f.page.onHide(); f.page.videoPaused(event(f.page));
  t.mock.timers.tick(10000);
  assert.equal(f.page.data.videoError, false, 'hidden startup is not labelled failed');
  f.page.onShow();
  assert.equal(f.effects.plays.length, 2, 'the first frame still needs a fresh play request');
  assert.equal(f.page.data.videoWaiting, true);
  t.mock.timers.tick(8000);
  assert.equal(f.page.data.videoError, true, 'a resumed startup retains its deadline');
  assert.match(f.page.data.videoErrorText, /未能开始播放/);
});

test('returning to an intentionally paused video that has played frames does not restart it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.load();
  f.page.videoProgress(event(f.page)); f.page.videoPaused(event(f.page));
  f.page.onHide(); f.page.videoPaused(event(f.page)); f.page.onShow();
  assert.equal(f.effects.plays.length, 1);
  t.mock.timers.tick(10000);
  assert.equal(f.page.data.videoError, false);
  assert.equal(f.page.data.videoWaiting, false);
});

test('missing onReady or a missing final view commit cannot leave an unmounted player spinning forever', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  const pending = f.page.onLoad({ id: rawPost().id }); await f.commitView(); await pending;
  await f.commitView(); // source node committed, but onReady never arrives.
  t.mock.timers.tick(8000);
  assert.equal(f.effects.plays.length, 0);
  assert.equal(f.page.data.videoError, true);
  assert.match(f.page.data.videoErrorText, /播放器未能准备好/);
  assert.ok(f.effects.diagnostics.some(values => values[1].stage === 'native-mount-timeout'));
  const retry = f.page.retryVideo(); await f.commitView(); await retry;
  f.page.onReady(); // page ready, but the new node's final commit never arrives.
  t.mock.timers.tick(8000);
  assert.equal(f.effects.plays.length, 0);
  assert.equal(f.page.data.videoError, true);
  await f.commitView();
  assert.equal(f.effects.plays.length, 0, 'a late commit cannot restart a timed-out native node');
});
