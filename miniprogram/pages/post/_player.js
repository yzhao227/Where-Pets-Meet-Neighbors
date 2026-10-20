'use strict';

const s = require('../_shared');
const media = require('./_media');
let playerSequence = 0;
const PREPARE_TIMEOUT_MS = 20000;
const PLAYBACK_TIMEOUT_MS = 8000;

function diagnostic(stage, source, error) {
  const detail = error && error.detail || error || {};
  const errMsg = String(detail.errMsg || detail.message || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
  const errCode = typeof detail.errCode === 'number' || typeof detail.errCode === 'string' ? String(detail.errCode).slice(0, 40) : '';
  const values = { stage, source, errMsg, errCode };
  ['bytes', 'currentTime', 'duration'].forEach(key => { if (Number.isFinite(detail[key])) values[key] = detail[key]; });
  console.warn('[packaged-video]', values);
}

function fileCall(fs, method, args) {
  return new Promise((resolve, reject) => {
    if (typeof fs[method] !== 'function') return reject(new Error(method + ' unavailable'));
    try { fs[method](Object.assign({}, args, { success: resolve, fail: reject })); } catch (error) { reject(error); }
  });
}

function discardFile(fs, filePath) {
  return fileCall(fs, 'unlink', { filePath }).catch(() => {});
}

function discardSettledFiles(page) {
  if (!page._videoCacheFiles) return;
  for (const [filePath, fs] of page._videoCacheFiles) discardFile(fs, filePath);
  page._videoCacheFiles.clear();
}

function missingDevtoolsVideoDependency(message) {
  if (!/^compressVideo:fail[: ]*音视频处理需要使用\s+ffmpeg(?:[\s,，]|$)/i.test(String(message))) return false;
  try {
    const device = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null;
    return !!device && device.platform === 'devtools';
  } catch (_) { return false; }
}

async function platformVideoSource(page, filePath, packageSource, fs, request) {
  // video.src documents temporary media paths. compressVideo explicitly accepts
  // persistent files and returns a platform-owned temporary video path.
  if (typeof wx.compressVideo !== 'function') {
    diagnostic('temporary-video-unavailable', packageSource);
    return filePath;
  }
  s.safe(page, { loadingText: '正在准备视频…' });
  let compressed;
  try { compressed = await fileCall(wx, 'compressVideo', { src: filePath, quality: 'high' }); }
  catch (error) {
    if (page._closed || request !== page._playerRequest) throw error;
    const detail = error && error.errMsg || error && error.message || '';
    // The simulator needs a separately configured ffmpeg dependency. This
    // exact DevTools-only failure says nothing about a phone's video codec.
    if (missingDevtoolsVideoDependency(detail)) {
      diagnostic('temporary-video-devtools-dependency', packageSource, error);
      return filePath;
    }
    // Some old WeChat versions and DevTools expose the method without an
    // implementation. Real encoding/storage failures must remain visible.
    if (/^(?:compressVideo:fail[: ]*)?(?:(?:function |API )?(?:not support(?:ed)?|unsupported|not implemented)|(?:此|该)?(?:接口|API)?暂不支持|不支持(?:此|该)?(?:接口|API))$/i.test(String(detail).trim())) {
      diagnostic('temporary-video-unsupported', packageSource, error);
      return filePath;
    }
    diagnostic('temporary-video-failed', packageSource, error);
    throw new Error('视频处理未完成，请重新加载');
  }
  const temporary = compressed && compressed.tempFilePath;
  if (typeof temporary !== 'string' || !temporary || temporary.length > 2048 || /[\u0000-\u001f\u007f]/.test(temporary)) throw new Error('视频处理未完成，请重新加载');
  if (page._closed || request !== page._playerRequest) {
    if (temporary !== filePath) discardFile(fs, temporary);
    throw new Error('视频加载已取消');
  }
  // Only files generated for this page/request are removed on retry/unload.
  page._videoCacheFiles.set(temporary, fs);
  diagnostic('temporary-video-ready', packageSource);
  return temporary;
}

async function localVideoSource(page, source, request) {
  // The HTML preview serves package assets over HTTP. WeChat's native player
  // needs a filesystem URL rather than a code-package resource URL.
  if (typeof wx !== 'undefined' && wx.__preview) return source;
  if (typeof wx === 'undefined' || typeof wx.getFileSystemManager !== 'function' || !wx.env || typeof wx.env.USER_DATA_PATH !== 'string' || !wx.env.USER_DATA_PATH) throw new Error('当前微信暂不支持本地视频播放，请更新微信后重试');
  const fs = wx.getFileSystemManager();
  const file = /^\/(media[2-9]?)\/clips\/(\d+)\.mp4$/.exec(source);
  const filePath = wx.env.USER_DATA_PATH + '/pet-video-v1-' + file[1] + '-' + file[2] + '-' + page._videoSession + '-' + request + '.mp4';
  const current = () => !page._closed && request === page._playerRequest;
  const cancelled = () => new Error('视频加载已取消');
  try {
    try {
      await fileCall(fs, 'copyFile', { srcPath: source.slice(1), destPath: filePath });
    } catch (error) {
      if (!current()) throw cancelled();
      diagnostic('copy-file', source, error);
      const read = await fileCall(fs, 'readFile', { filePath: source.slice(1) });
      if (!current()) throw cancelled();
      if (!read || !read.data || !Number.isFinite(read.data.byteLength) || read.data.byteLength < 1 || read.data.byteLength > 2 * 1024 * 1024) throw new Error('本地视频文件无效');
      await fileCall(fs, 'writeFile', { filePath, data: read.data });
    }
    if (!current()) throw cancelled();
    // A successful copy callback alone does not prove the native player was
    // handed a complete MP4. Verify the actual destination before mounting it.
    const copied = await fileCall(fs, 'readFile', { filePath });
    if (!current()) throw cancelled();
    const bytes = copied && copied.data && new Uint8Array(copied.data);
    if (!bytes || bytes.length < 12 || bytes.length > 2 * 1024 * 1024 || String.fromCharCode.apply(null, Array.from(bytes.slice(4, 8))) !== 'ftyp') throw new Error('本地视频文件不完整');
    diagnostic('file-ready', source, { bytes: bytes.length });
    page._videoCacheFiles.set(filePath, fs);
    return await platformVideoSource(page, filePath, source, fs, request);
  } catch (error) {
    await discardFile(fs, filePath);
    page._videoCacheFiles.delete(filePath);
    if (current()) {
      diagnostic('prepare-file', source, error);
      throw new Error(error.message === '视频处理未完成，请重新加载' ? error.message : '视频文件暂未准备好，请重新加载');
    }
    throw cancelled();
  }
}

function createPlayer(packageRoot) {
  if (!/^media(?:[2-9])?$/.test(packageRoot)) throw new Error('无效的视频资源包');
  const ownVideo = new RegExp('^/' + packageRoot + '/clips/\\d+\\.mp4$');
  return {
    data: { loading: true, loadingText: '正在准备视频…', error: '', post: null, videoSource: '', videoWaiting: false, videoError: false, videoErrorText: '', videoAttempt: 0 },
    onLoad(options) {
      this._closed = false;
      this._hidden = false;
      this._viewReady = false;
      this._playing = false;
      this._lastVideoTime = 0;
      this._videoSession = Date.now().toString(36) + '-' + (++playerSequence);
      this._videoCacheFiles = new Map();
      this.id = options && typeof options.id === 'string' ? options.id : '';
      return this.refresh();
    },
    async refresh() {
      if (this._closed) return;
      const request = this._playerRequest = (this._playerRequest || 0) + 1;
      this.clearVideoWatch();
      this._playRequested = false;
      this._sourceMounted = false;
      this._firstProgress = false;
      this._lastVideoTime = 0;
      this._playing = false;
      this._pendingVideoSource = '';
      this._prepareTimer = setTimeout(() => {
        if (this._closed || request !== this._playerRequest) return;
        this._playerRequest++;
        diagnostic('prepare-timeout', this._packageVideoSource);
        s.safe(this, { loading: false, error: '视频准备时间过长，请重新加载', videoSource: '', videoWaiting: false });
      }, PREPARE_TIMEOUT_MS);
      if (this._prepareTimer && this._prepareTimer.unref) this._prepareTimer.unref();
      this.pauseVideo();
      // Wait for the empty source to reach the view before mounting a new
      // native video. Merely changing an attempt attribute reuses a failed one.
      await new Promise(resolve => this.setData({ loading: true, loadingText: '正在读取视频…', error: '', post: null, videoSource: '', videoWaiting: false, videoError: false, videoErrorText: '', videoAttempt: this.data.videoAttempt + 1 }, resolve));
      if (this._closed || request !== this._playerRequest) return;
      discardSettledFiles(this);
      try {
        if (!this.id || this.id.length > 256 || /[\u0000-\u001f\u007f]/.test(this.id)) throw new Error('找不到这篇内容');
        const result = await s.api.call('getPost', { id: this.id });
        if (this._closed || request !== this._playerRequest) return;
        if (!result || !result.post || typeof result.post !== 'object' || Array.isArray(result.post)) throw new Error('找不到这篇内容');
        const post = s.post(result.post);
        if (post.visibility !== 'public') throw new Error('这篇内容请返回详情页查看');
        if (!post.video) throw new Error('这篇内容没有可播放的视频');
        const source = media.videoPath(post.video.url);
        if (!ownVideo.test(source)) throw new Error('视频资源与当前播放页不匹配，请返回内容页重新打开');
        // Opening this page has already loaded its own package. Never reach
        // into another package, even when loadSubpackage happened to succeed.
        this._packageVideoSource = source;
        const videoSource = await localVideoSource(this, source, request);
        if (this._closed || request !== this._playerRequest) return;
        this._pendingVideoSource = this._hidden ? videoSource : '';
        clearTimeout(this._prepareTimer);
        this.setData({ loading: false, post, videoSource: this._hidden ? '' : videoSource, videoWaiting: !this._hidden }, () => {
          if (!this._closed && request === this._playerRequest) { this._sourceMounted = !!this.data.videoSource; this.startVideo(); }
        });
        this.watchVideoMount();
      } catch (error) {
        if (this._closed || request !== this._playerRequest) return;
        clearTimeout(this._prepareTimer);
        s.safe(this, { loading: false, error: error.message || '视频暂时未能加载，请重试', videoSource: '', videoWaiting: false });
      }
    },
    currentVideoEvent(event) {
      const data = event && event.currentTarget && event.currentTarget.dataset;
      return !this._closed && !!this.data.videoSource && !!data && data.src === this.data.videoSource && Number(data.attempt) === this.data.videoAttempt;
    },
    onReady() { this._viewReady = true; this.startVideo(); },
    clearVideoWatch() {
      clearTimeout(this._prepareTimer); clearTimeout(this._playbackTimer); clearTimeout(this._mountTimer);
      this._prepareTimer = null; this._playbackTimer = null; this._mountTimer = null;
    },
    watchVideoMount() {
      clearTimeout(this._mountTimer); this._mountTimer = null;
      if (this._closed || this._hidden || this.data.videoError || !this.data.videoSource || this._playRequested) return;
      const request = this._playerRequest;
      this._mountTimer = setTimeout(() => {
        if (this._closed || this._hidden || request !== this._playerRequest || this._playRequested) return;
        diagnostic('native-mount-timeout', this._packageVideoSource);
        this.failVideo('播放器未能准备好，请重新播放');
      }, PLAYBACK_TIMEOUT_MS);
      if (this._mountTimer && this._mountTimer.unref) this._mountTimer.unref();
    },
    watchVideo() {
      clearTimeout(this._playbackTimer);
      if (this._closed || this._hidden || this.data.videoError || !this.data.videoSource) return;
      const attempt = this.data.videoAttempt;
      this._playbackTimer = setTimeout(() => {
        if (this._closed || this._hidden || attempt !== this.data.videoAttempt) return;
        const stage = this._firstProgress ? 'native-stalled' : 'native-start-timeout';
        diagnostic(stage, this._packageVideoSource, { currentTime: this._lastVideoTime });
        this.failVideo(this._firstProgress ? '视频播放中断，请重新播放' : '视频未能开始播放，请重新播放');
      }, PLAYBACK_TIMEOUT_MS);
      if (this._playbackTimer && this._playbackTimer.unref) this._playbackTimer.unref();
    },
    startVideo() {
      if (!this._viewReady || !this._sourceMounted || this._hidden || this._closed || !this.data.videoSource || this.data.videoError || this._playRequested) return;
      this._playRequested = true;
      clearTimeout(this._mountTimer); this._mountTimer = null;
      diagnostic('native-mounted', this._packageVideoSource);
      s.safe(this, { videoWaiting: true });
      this.watchVideo();
      // The native node must exist after both page onReady and setData commit.
      // An autoplay attribute alone can run while the page is still opening.
      try { wx.createVideoContext('post-video', this).play(); }
      catch (error) { diagnostic('native-start', this._packageVideoSource, error); this.failVideo('视频未能开始播放，请重新播放'); }
    },
    failVideo(message) {
      if (this._closed) return;
      this.clearVideoWatch();
      this._playing = false;
      this.pauseVideo();
      s.safe(this, { videoError: true, videoWaiting: false, videoErrorText: message });
    },
    videoFailed(event) {
      if (this.currentVideoEvent(event)) {
        diagnostic('native-playback', this._packageVideoSource, event);
        this.failVideo('视频暂未打开，请重新播放');
      }
    },
    videoBuffering(event) {
      if (!this.currentVideoEvent(event) || this._hidden || this.data.videoError) return;
      if (!this.data.videoWaiting) s.safe(this, { videoWaiting: true });
      // Repeated waiting events must not extend a stalled stream forever.
      if (!this._playbackTimer) this.watchVideo();
    },
    videoMetadata(event) {
      if (this.currentVideoEvent(event)) diagnostic('native-metadata', this._packageVideoSource, event);
    },
    videoPlaying(event) {
      if (!this.currentVideoEvent(event) || this._hidden || this.data.videoError) return;
      this._playing = true;
      this.watchVideo();
    },
    videoProgress(event) {
      if (!this.currentVideoEvent(event) || this._hidden || this.data.videoError) return;
      const currentTime = Number(event.detail && event.detail.currentTime);
      if (!Number.isFinite(currentTime) || currentTime < 0 || Math.abs(currentTime - this._lastVideoTime) < .01) return;
      this._lastVideoTime = currentTime;
      this._playing = true;
      if (!this._firstProgress) { this._firstProgress = true; diagnostic('native-first-frame', this._packageVideoSource, event); }
      if (this.data.videoWaiting) s.safe(this, { videoWaiting: false });
      this.watchVideo();
    },
    videoPaused(event) {
      if (!this.currentVideoEvent(event) || this.data.videoError) return;
      this._playing = false;
      // A native pause before any advancing frame may mean startup was
      // rejected. Keep its deadline so it cannot silently remain stuck.
      if (this._firstProgress || this._hidden) {
        clearTimeout(this._playbackTimer); this._playbackTimer = null;
        if (this.data.videoWaiting) s.safe(this, { videoWaiting: false });
      }
    },
    videoEnded(event) {
      if (!this.currentVideoEvent(event) || this.data.videoError) return;
      diagnostic('native-ended', this._packageVideoSource, { currentTime: this._lastVideoTime });
      this.clearVideoWatch(); this._playing = false;
      if (this.data.videoWaiting) s.safe(this, { videoWaiting: false });
    },
    retryVideo() { return this.refresh(); },
    pauseVideo() {
      if (typeof wx === 'undefined' || typeof wx.createVideoContext !== 'function') return;
      try { wx.createVideoContext('post-video', this).pause(); } catch (_) {}
    },
    onShow() {
      if (this._closed) return;
      this._hidden = false;
      if (this._pendingVideoSource) {
        const videoSource = this._pendingVideoSource;
        this._pendingVideoSource = '';
        const request = this._playerRequest;
        this.setData({ videoSource, videoWaiting: true }, () => {
          if (!this._closed && request === this._playerRequest) { this._sourceMounted = true; this.startVideo(); }
        });
      } else this.startVideo();
      this.watchVideoMount();
    },
    onHide() {
      this._hidden = true;
      clearTimeout(this._playbackTimer); this._playbackTimer = null;
      clearTimeout(this._mountTimer); this._mountTimer = null;
      // A startup interrupted before any frame still needs its first play
      // request when visible again. A video already played/paused stays paused.
      if (!this._firstProgress) this._playRequested = false;
      this.pauseVideo();
    },
    onUnload() {
      this._closed = true;
      this._playerRequest = (this._playerRequest || 0) + 1;
      this._pendingVideoSource = '';
      this.clearVideoWatch();
      this.pauseVideo();
      discardSettledFiles(this);
    },
    onShareAppMessage() {
      if (s.personalMode) return {};
      const post = this.data.post;
      if (this.data.loading || this.data.error || !post || post.visibility !== 'public') return { title: '有宠有邻｜喜欢宠物，就在这里相遇', path: '/pages/community/index', imageUrl: '/assets/event-walk.png' };
      return { title: post ? (post.title || post.text || '看看这份宠物分享').slice(0, 45) : '有宠有邻的分享', path: '/pages/post/index?id=' + encodeURIComponent(this.id || '') };
    }
  };
}

module.exports = createPlayer;
