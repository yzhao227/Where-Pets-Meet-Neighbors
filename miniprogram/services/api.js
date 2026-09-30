const { createDemoService } = require('./demo');

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function nativeCall(platform, method, args) {
  return new Promise((resolve, reject) => {
    if (!platform || typeof platform[method] !== 'function') {
      reject(failure('UNSUPPORTED_API', '当前环境暂不支持此操作'));
      return;
    }
    platform[method](Object.assign({}, args, {
      success: resolve,
      fail: error => reject(failure('DEVICE_ERROR', error && (error.errMsg || error.message) || '操作失败，请重试'))
    }));
  });
}

function imageExtension(filePath) {
  if (/^data:image\/png[;,]/i.test(filePath) || /\.png(?:\?|$)/i.test(filePath)) return 'png';
  if (/^data:image\/webp[;,]/i.test(filePath) || /\.webp(?:\?|$)/i.test(filePath)) return 'webp';
  return 'jpg';
}

const UPLOAD_QUEUE_KEY = 'youchong.uploadQueue.v1';
const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_SECONDS = 60;
const isVideo = record => record.mediaType === 'video';
const mediaLabel = record => isVideo(record) ? '视频' : '图片';

function createApi(platform, config, options) {
  const settings = config || { mode: 'demo' };
  const opts = options || {};
  const demo = createDemoService(platform, options);
  const isDemo = () => !!(platform && platform.__preview) || settings.mode !== 'cloud';
  const clock = opts.now || Date.now;
  const pause = opts.mediaDelay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const pollAttempts = opts.mediaPollAttempts === undefined ? 2 : Math.max(0, Math.min(5, Number(opts.mediaPollAttempts) || 0));
  const scope = () => isDemo() ? 'demo' : 'cloud:' + (settings.cloudEnv || 'default');
  let feedVersion = 0;
  let queueWork = Promise.resolve();
  function serializeQueue(work) {
    const job = queueWork.then(work); queueWork = job.catch(() => {}); return job;
  }

  function readQueue() {
    if (!platform || typeof platform.getStorageSync !== 'function') throw failure('STORAGE_UNAVAILABLE', '无法读取附件草稿，请检查本机存储');
    const saved = platform.getStorageSync(UPLOAD_QUEUE_KEY);
    if (!saved) return [];
    if (!saved || saved.version !== 1 || !Array.isArray(saved.items)) throw failure('STORAGE_UNAVAILABLE', '附件草稿记录无法读取，请先保留正文');
    return JSON.parse(JSON.stringify(saved.items));
  }
  function saveQueue(items) {
    try { platform.setStorageSync(UPLOAD_QUEUE_KEY, { version: 1, items }); }
    catch (_) { throw failure('STORAGE_UNAVAILABLE', '附件草稿未能保存到本机，请检查存储空间'); }
  }
  function remember(record) {
    const queue = readQueue();
    const index = queue.findIndex(item => item.localId === record.localId);
    if (index < 0) queue.push(record); else queue[index] = record;
    saveQueue(queue);
  }
  async function removeLocal(path, strict) {
    if (!path || /^data:/i.test(path)) return;
    try { await nativeCall(platform, 'removeSavedFile', { filePath: path }); }
    catch (error) { if (strict && !/not exist|not found|不存在/i.test(error.message || '')) throw error; }
  }
  async function forgetPublished(images, video) {
    const files = (Array.isArray(images) ? images : []).concat(video && (video.url || video.fileId) || []).filter(Boolean);
    if (!files.length) return;
    const queue = readQueue();
    const published = queue.filter(item => item.scope === scope() && item.status === 'complete' && files.indexOf(item.fileId) !== -1);
    // Demo posts display their durable local file. Keep that file until account
    // deletion; cloud posts display the approved cloud file and can drop the copy.
    if (isDemo()) { saveQueue(queue.filter(item => published.indexOf(item) === -1)); return; }
    // Record consumption before attempting disk cleanup. A cleanup retry must
    // never present a successfully published image as a new selectable draft.
    for (const item of published) item.status = 'consumed';
    saveQueue(queue);
    const removed = []; let incomplete = false;
    for (const item of published) {
      try { await removeLocal(item.localPath, true); removed.push(item); }
      catch (_) { incomplete = true; }
    }
    saveQueue(queue.filter(item => removed.indexOf(item) === -1));
    if (incomplete) throw failure('LOCAL_CLEANUP_FAILED', '内容已发布，本机附件副本尚未清理完成');
  }
  async function clearLocalUploads() {
    const queue = readQueue(); const remaining = [];
    for (const item of queue) {
      try { await removeLocal(item.localPath, true); }
      catch (_) { remaining.push(item); }
    }
    if (remaining.length) saveQueue(remaining);
    else if (platform && typeof platform.removeStorageSync === 'function') platform.removeStorageSync(UPLOAD_QUEUE_KEY);
    else saveQueue([]);
    if (remaining.length) throw failure('LOCAL_CLEANUP_FAILED', '本机附件尚未清理完成，请重试清理');
    return { success: true };
  }
  async function clearPrivateData() {
    let cleanupError;
    try { await clearLocalUploads(); } catch (error) { cleanupError = error; }
    try { await require('./pet-photos').clearLocalPetPhotos(platform); } catch (error) { cleanupError = error; }
    try {
      if (platform && typeof platform.removeStorageSync === 'function') platform.removeStorageSync('youchong.privateDrafts.v1');
      else if (platform && typeof platform.setStorageSync === 'function') platform.setStorageSync('youchong.privateDrafts.v1', {});
    } catch (error) { cleanupError = error; }
    if (cleanupError) throw cleanupError;
  }

  async function call(action, payload) {
    let data;
    if (isDemo()) data = await demo.call(action, payload || {});
    else {
      if (!platform || !platform.cloud || typeof platform.cloud.callFunction !== 'function') throw failure('CLOUD_UNAVAILABLE', '当前环境不支持云服务，请在微信中重试');
      let response;
      try { response = await platform.cloud.callFunction({ name: 'community', data: { action, payload: payload || {} } }); }
      catch (_) { throw failure('NETWORK_ERROR', '暂时无法连接服务，请检查网络后重试'); }
      const envelope = response && response.result;
      if (!envelope || typeof envelope.ok !== 'boolean') throw failure('INVALID_RESPONSE', '服务返回异常，请稍后重试');
      if (!envelope.ok) throw failure(envelope.error && envelope.error.code || 'SERVICE_ERROR', envelope.error && envelope.error.message || '操作失败，请稍后重试');
      data = envelope.data;
    }
    if (['followUser', 'blockUser', 'joinCircle', 'createPost', 'deletePost', 'setPostVisibility', 'deleteAccount', 'respondFriendRequest', 'removeFriend'].includes(action)) feedVersion += 1;
    if (action === 'createPost' || action === 'deleteAccount') {
      try {
        if (action === 'createPost') await serializeQueue(() => forgetPublished(payload && payload.images, payload && payload.video));
        else await serializeQueue(clearPrivateData);
      } catch (_) {
        // The remote mutation has committed. Never turn a local cleanup error
        // into an apparent publish/delete failure that would invite a replay.
        data = Object.assign({}, data, { localCleanup: { status: 'failed', message: action === 'createPost'
          ? '内容已发布，本机附件草稿尚未清理完成' : '资料已清除，本机草稿和附件尚未清理完成' } });
      }
      if (data && data.localCleanupPending && !data.localCleanup) data = Object.assign({}, data, {
        localCleanup: { status: 'failed', message: '资料已清除，本机草稿尚未清理完成' }
      });
    }
    return data;
  }

  function snapshot(records) {
    const result = { images: [], video: null, completed: [], pending: [], failures: [] };
    for (const item of records) {
      const ticketId = item.ticketId || item.localId;
      const label = mediaLabel(item);
      const kind = isVideo(item) ? { mediaType: 'video' } : {};
      const previewPath = typeof item.localPath === 'string' ? item.localPath : '';
      if (item.status === 'complete' && item.fileId) {
        if (isVideo(item)) {
          const metadata = item.video || item.videoMetadata || {};
          const video = { url: item.fileId, durationSeconds: metadata.durationSeconds };
          for (const key of ['width', 'height']) if (Number.isFinite(metadata[key]) && metadata[key] > 0) video[key] = metadata[key];
          if (typeof metadata.poster === 'string' && metadata.poster) video.poster = metadata.poster;
          result.video = video;
          result.completed.push({ ticketId, fileId: item.fileId, previewPath, mediaType: 'video', video });
        } else {
          result.images.push(item.fileId); result.completed.push({ ticketId, fileId: item.fileId, previewPath });
        }
      } else if (item.status === 'pending') result.pending.push(Object.assign({ ticketId, status: 'pending', message: label + '正在审核，正文草稿已保留，请稍后重新检查' }, kind));
      else result.failures.push(Object.assign({ ticketId, status: item.status, code: item.errorCode || (isVideo(item) ? 'VIDEO_UPLOAD_FAILED' : 'IMAGE_UPLOAD_FAILED'), message: item.message || label + '暂未完成，请重试', retryable: !['rejected', 'expired', 'source_missing', 'invalid'].includes(item.status) }, kind));
    }
    return result;
  }
  async function owner(requireVerified) {
    const boot = await call('bootstrap');
    const user = boot && boot.user;
    if (!user || !user.id) throw failure('INVALID_RESPONSE', '无法确认附件草稿所属账号');
    if (requireVerified && (!user.verification || user.verification.status !== (isDemo() ? 'demo_verified' : 'phone_verified'))) throw failure('VERIFICATION_REQUIRED', isDemo() ? '先完成本机模拟核验，再分享图片吧' : '先完成手机号核验，再分享图片吧');
    return user.id;
  }
  const owned = userId => readQueue().filter(item => item.ownerId === userId && item.scope === scope() && item.status !== 'consumed');

  function applyStatus(record, status) {
    const label = mediaLabel(record);
    if (status && typeof status.fileId === 'string' && status.fileId && (!status.status || status.status === 'complete')) {
      if (isVideo(record)) {
        const metadata = status.video || status;
        const durationSeconds = metadata.durationSeconds === undefined ? record.videoMetadata && record.videoMetadata.durationSeconds : metadata.durationSeconds;
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > VIDEO_MAX_SECONDS) throw failure('INVALID_RESPONSE', '视频审核结果缺少有效时长');
        record.video = Object.assign({}, record.videoMetadata || {}, metadata, { durationSeconds });
      }
      record.status = 'complete'; record.fileId = status.fileId; record.errorCode = ''; record.message = ''; return;
    }
    if (status && ['pending', 'processing'].includes(status.status)) {
      record.status = 'pending'; record.serverPending = true; record.errorCode = ''; record.message = ''; return;
    }
    if (status && ['rejected', 'expired'].includes(status.status)) {
      record.status = status.status; record.errorCode = status.status === 'expired' ? 'UPLOAD_EXPIRED' : 'CONTENT_REJECTED'; record.message = status.message || (status.status === 'expired' ? label + '审核已过期，请重新选择' : label + '未通过审核，请更换'); return;
    }
    throw failure('INVALID_RESPONSE', label + '审核结果暂时不可用，请重新检查');
  }

  async function ensureVideoOwner(record) {
    if (isVideo(record) && (record.scope !== scope() || await owner(true) !== record.ownerId)) throw failure('UPLOAD_OWNER_CHANGED', '账号已切换，视频仍保留在原账号的草稿中');
  }
  function videoDeviceError(error, code, message) {
    if (/no such file|not exist|not found|不存在/i.test(error && error.message || '')) return failure('VIDEO_SOURCE_UNAVAILABLE', '本机视频副本已失效，请移除后重新选择');
    return failure(code, message);
  }
  async function prepareVideo(record) {
    if (record.localPath) return;
    if (!record.tempPath && !record.preparedPath) throw failure('VIDEO_SOURCE_UNAVAILABLE', '本机视频副本不可用，请移除后重新选择');
    if (!record.preparedPath) {
      let path = record.tempPath;
      const selected = record.selected || {};
      if (Number.isFinite(selected.durationSeconds) && selected.durationSeconds > VIDEO_MAX_SECONDS) throw failure('VIDEO_TOO_LONG', '单个视频最长 60 秒，请剪短后重试');
      if (platform && typeof platform.compressVideo === 'function') {
        let compressed;
        try { compressed = await nativeCall(platform, 'compressVideo', { src: path, quality: 'medium' }); }
        catch (error) { throw videoDeviceError(error, 'VIDEO_COMPRESSION_FAILED', '视频压缩未完成，已保留选择，请重试'); }
        if (!compressed || typeof compressed.tempFilePath !== 'string' || !compressed.tempFilePath) throw failure('VIDEO_COMPRESSION_FAILED', '视频压缩未完成，请重试');
        path = compressed.tempFilePath;
      }
      let info = {};
      if (platform && typeof platform.getVideoInfo === 'function') {
        try { info = await nativeCall(platform, 'getVideoInfo', { src: path }); }
        catch (error) { throw videoDeviceError(error, 'VIDEO_READ_FAILED', '暂时无法读取视频信息，已保留选择，请重试'); }
      }
      const metadata = { durationSeconds: info.duration === undefined ? selected.durationSeconds : Number(info.duration),
        width: Number(info.width || selected.width) || undefined, height: Number(info.height || selected.height) || undefined };
      // getFileInfo reports bytes; getVideoInfo/chooseVideo size fields use kB in
      // some SDK versions, so never reuse them as authoritative byte counts.
      if (!platform || typeof platform.getFileInfo !== 'function') throw failure('UNSUPPORTED_API', '当前微信版本无法检查视频大小，请升级微信后重试');
      let stat;
      try { stat = await nativeCall(platform, 'getFileInfo', { filePath: path }); }
      catch (error) { throw videoDeviceError(error, 'VIDEO_READ_FAILED', '暂时无法读取视频大小，已保留选择，请重试'); }
      metadata.bytes = Number(stat && stat.size);
      if (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0) throw failure('INVALID_VIDEO', '无法读取视频时长，请重新选择 MP4 视频');
      if (metadata.durationSeconds > VIDEO_MAX_SECONDS) throw failure('VIDEO_TOO_LONG', '单个视频最长 60 秒，请剪短后重试');
      if (!Number.isFinite(metadata.bytes) || metadata.bytes <= 0) throw failure('INVALID_VIDEO', '所选视频无法读取，请重新选择');
      if (metadata.bytes > VIDEO_MAX_BYTES) throw failure('VIDEO_TOO_LARGE', '压缩后视频仍超过 20 MiB，请剪短后重试');
      record.preparedPath = path; record.videoMetadata = metadata; remember(record);
    }
    await ensureVideoOwner(record);
    let saved;
    try { saved = await nativeCall(platform, 'saveFile', { tempFilePath: record.preparedPath }); }
    catch (error) { throw videoDeviceError(error, 'VIDEO_SAVE_FAILED', '视频未能保存到本机，请检查存储空间后重试'); }
    if (!saved || !saved.savedFilePath) throw failure('VIDEO_SAVE_FAILED', '视频未能保存到本机，请检查存储空间后重试');
    record.localPath = saved.savedFilePath;
    delete record.tempPath; delete record.preparedPath; delete record.selected;
    remember(record);
  }

  async function uploadCloudFile(record, onProgress) {
    if (!isVideo(record)) return platform.cloud.uploadFile({ cloudPath: record.cloudPath, filePath: record.localPath });
    return new Promise((resolve, reject) => {
      const task = platform.cloud.uploadFile({ cloudPath: record.cloudPath, filePath: record.localPath, success: resolve, fail: reject });
      if (task && typeof task.then === 'function') task.then(resolve, reject);
      if (task && typeof task.onProgressUpdate === 'function' && typeof onProgress === 'function') task.onProgressUpdate(event => {
        if (!event || !Number.isFinite(event.progress)) return;
        try { onProgress(Math.max(0, Math.min(100, event.progress))); } catch (_) { /* UI observers cannot fail an upload. */ }
      });
    });
  }

  async function process(record, onProgress) {
    if (['complete', 'rejected', 'expired', 'source_missing', 'invalid'].includes(record.status)) return;
    const label = mediaLabel(record);
    try {
      await ensureVideoOwner(record);
      if (isVideo(record)) await prepareVideo(record);
      if (!record.ticketId) {
        const payload = isVideo(record) ? Object.assign({ extension: 'mp4', mediaType: 'video' }, record.videoMetadata) : { extension: record.extension };
        await ensureVideoOwner(record);
        const ticket = await call('createUploadTicket', payload);
        if (!ticket || typeof ticket.ticketId !== 'string' || !ticket.ticketId || typeof ticket.cloudPath !== 'string' || !ticket.cloudPath) throw failure('INVALID_RESPONSE', label + '上传记录暂时不可用，请重试');
        record.ticketId = ticket.ticketId; record.cloudPath = ticket.cloudPath; remember(record);
      }
      if (!record.sourceFileId) {
        if (!record.localPath) throw failure(isVideo(record) ? 'VIDEO_SOURCE_UNAVAILABLE' : 'IMAGE_SOURCE_UNAVAILABLE', '本机' + label + '副本不可用，请移除后重新选择');
        await ensureVideoOwner(record);
        if (isDemo()) record.sourceFileId = record.localPath;
        else {
          if (!platform.cloud || typeof platform.cloud.uploadFile !== 'function') throw failure('CLOUD_UNAVAILABLE', '当前环境不支持上传' + label);
          const uploaded = await uploadCloudFile(record, onProgress);
          if (!uploaded || !uploaded.fileID) throw failure(isVideo(record) ? 'VIDEO_UPLOAD_FAILED' : 'IMAGE_UPLOAD_FAILED', label + '上传未完成，请重试');
          record.sourceFileId = uploaded.fileID;
        }
        remember(record);
      }
      await ensureVideoOwner(record);
      applyStatus(record, record.serverPending && !isDemo() ? await call('getUploadStatus', { ticketId: record.ticketId }) : await call('completeUpload', { ticketId: record.ticketId, fileId: record.sourceFileId }));
      remember(record);
      for (let attempt = 0; record.status === 'pending' && attempt < pollAttempts && !isDemo(); attempt += 1) {
        await pause(750); await ensureVideoOwner(record);
        applyStatus(record, await call('getUploadStatus', { ticketId: record.ticketId })); remember(record);
      }
    } catch (error) {
      record.status = ['CONTENT_REJECTED', 'MEDIA_CONTENT_CHANGED'].includes(error.code) ? 'rejected' : error.code === 'UPLOAD_EXPIRED' ? 'expired' : ['IMAGE_SOURCE_UNAVAILABLE', 'VIDEO_SOURCE_UNAVAILABLE'].includes(error.code) ? 'source_missing' : ['VIDEO_TOO_LONG', 'VIDEO_TOO_LARGE', 'INVALID_VIDEO'].includes(error.code) ? 'invalid' : 'retry';
      record.errorCode = error.code || (isVideo(record) ? 'VIDEO_UPLOAD_FAILED' : 'IMAGE_UPLOAD_FAILED');
      record.message = error.message || label + '暂未完成，请保留草稿后重试';
      remember(record);
    }
  }

  async function resumeUploads() {
    const userId = await owner(true);
    const records = owned(userId);
    for (const record of records) await process(record);
    const video = records.find(isVideo);
    if (video) await ensureVideoOwner(video);
    return snapshot(owned(userId));
  }

  async function uploadImages(count) {
    const requested = count === undefined ? 3 : Math.min(3, Math.max(0, Math.floor(Number(count) || 0)));
    const userId = await owner(requested > 0);
    const existing = owned(userId);
    if (requested > 0 && existing.some(isVideo)) throw failure('MEDIA_CONFLICT', '一篇分享可添加照片或一个视频，请先移除视频');
    const limit = Math.min(requested, Math.max(0, 3 - existing.length));
    if (!limit) return snapshot(existing);
    let selection;
    try {
      selection = platform && typeof platform.chooseMedia === 'function' ? await nativeCall(platform, 'chooseMedia', { count: limit, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] }) : await nativeCall(platform, 'chooseImage', { count: limit, sourceType: ['album', 'camera'], sizeType: ['compressed'] });
    } catch (error) {
      if (/cancel/i.test(error.message || '')) return snapshot(owned(userId));
      throw failure('IMAGE_SELECTION_FAILED', '没有取得图片，请检查相册权限后重试');
    }
    const files = selection.tempFiles && selection.tempFiles.length ? selection.tempFiles.map(file => ({ path: file.tempFilePath || file.path, size: file.size })) : (selection.tempFilePaths || []).map(path => ({ path }));
    if (files.length > limit) throw failure('INVALID_INPUT', '最多选择 ' + limit + ' 张图片');
    for (const file of files) {
      const record = { localId: 'local-' + clock().toString(36) + '-' + Math.random().toString(36).slice(2), ownerId: userId, scope: scope(), extension: imageExtension(file.path || ''), createdAt: clock(), status: 'retry' };
      try {
        if (!file.path || typeof file.path !== 'string') throw failure('IMAGE_SOURCE_UNAVAILABLE', '所选图片无法读取，请重新选择');
        if (file.size && file.size > 5 * 1024 * 1024) throw failure('IMAGE_TOO_LARGE', '单张图片不能超过 5 MB，请压缩后重试');
        const saved = await nativeCall(platform, 'saveFile', { tempFilePath: file.path });
        if (!saved || !saved.savedFilePath) throw failure('IMAGE_SAVE_FAILED', '图片未能保存到本机，请重新选择');
        record.localPath = saved.savedFilePath; remember(record);
        await process(record);
      } catch (error) {
        record.status = record.localPath ? 'retry' : 'source_missing'; record.errorCode = error.code === 'DEVICE_ERROR' ? 'IMAGE_SAVE_FAILED' : error.code || 'IMAGE_SAVE_FAILED'; record.message = error.message || '图片未能保存，请重新选择'; remember(record);
      }
    }
    return snapshot(owned(userId));
  }

  async function uploadVideo(onProgress) {
    const userId = await owner(true);
    const existing = owned(userId);
    if (existing.some(item => !isVideo(item))) throw failure('MEDIA_CONFLICT', '一篇分享可添加照片或一个视频，请先移除照片');
    if (existing.some(isVideo)) return snapshot(existing);
    let selection;
    try {
      selection = platform && typeof platform.chooseMedia === 'function'
        ? await nativeCall(platform, 'chooseMedia', { count: 1, mediaType: ['video'], sourceType: ['album', 'camera'], maxDuration: VIDEO_MAX_SECONDS, sizeType: ['compressed'] })
        : await nativeCall(platform, 'chooseVideo', { sourceType: ['album', 'camera'], compressed: true, maxDuration: VIDEO_MAX_SECONDS });
    } catch (error) {
      if (/cancel/i.test(error.message || '')) return snapshot(owned(userId));
      throw failure('VIDEO_SELECTION_FAILED', '没有取得视频，请检查相册权限后重试');
    }
    const files = selection.tempFiles && selection.tempFiles.length ? selection.tempFiles : [selection];
    if (files.length !== 1) throw failure('INVALID_INPUT', '每篇分享最多选择一个视频');
    const file = files[0];
    const path = file.tempFilePath || file.path;
    if (typeof path !== 'string' || !path) throw failure('VIDEO_SOURCE_UNAVAILABLE', '所选视频无法读取，请重新选择');
    const record = { localId: 'local-' + clock().toString(36) + '-' + Math.random().toString(36).slice(2), ownerId: userId, scope: scope(),
      mediaType: 'video', extension: 'mp4', tempPath: path, selected: { durationSeconds: Number(file.duration), width: Number(file.width), height: Number(file.height) }, createdAt: clock(), status: 'retry' };
    // Persist selection before compression/saving. If the device operation fails,
    // the draft retains its video ticket and can retry while the temp file exists.
    remember(record);
    await process(record, onProgress);
    await ensureVideoOwner(record);
    return snapshot(owned(userId));
  }

  async function discardUploads(ticketIds) {
    if (!Array.isArray(ticketIds)) throw failure('INVALID_INPUT', '请选择要移除的附件');
    const userId = await owner(false);
    const queue = readQueue();
    const removed = queue.filter(item => item.ownerId === userId && item.scope === scope() && (ticketIds.includes(item.ticketId) || ticketIds.includes(item.localId)));
    const cleared = []; let incomplete = false;
    for (const item of removed) {
      try { await removeLocal(item.localPath, true); cleared.push(item); }
      catch (_) { incomplete = true; }
    }
    saveQueue(queue.filter(item => cleared.indexOf(item) === -1));
    if (incomplete) throw failure('LOCAL_CLEANUP_FAILED', '本机附件尚未移除，请检查存储后重试');
    return snapshot(owned(userId));
  }

  return { call, getFeedVersion: () => feedVersion,
    uploadImages: count => serializeQueue(() => uploadImages(count)),
    uploadVideo: onProgress => serializeQueue(() => uploadVideo(onProgress)),
    resumeUploads: () => serializeQueue(resumeUploads),
    discardUploads: ticketIds => serializeQueue(() => discardUploads(ticketIds)),
    clearLocalUploads: () => serializeQueue(clearLocalUploads)
  };
}

let singleton;
function defaultApi() {
  if (!singleton) {
    const platform = typeof wx === 'undefined' ? null : wx;
    const config = require('../config');
    singleton = createApi(platform, config);
  }
  return singleton;
}

module.exports = {
  call: function (action, payload) { return defaultApi().call(action, payload); },
  getFeedVersion: function () { return singleton ? singleton.getFeedVersion() : 0; },
  uploadImages: function (count) { return defaultApi().uploadImages(count); },
  uploadVideo: function (onProgress) { return defaultApi().uploadVideo(onProgress); },
  resumeUploads: function () { return defaultApi().resumeUploads(); },
  discardUploads: function (ticketIds) { return defaultApi().discardUploads(ticketIds); },
  clearLocalUploads: function () { return defaultApi().clearLocalUploads(); },
  createApi
};
