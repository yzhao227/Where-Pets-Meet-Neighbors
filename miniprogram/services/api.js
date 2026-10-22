const { createDemoService } = require('./demo');
const { createPersonalService, personalFileReferenced, clearCommunityDrafts } = require('./personal');
const contentPolicy = require('../data/content-policy');

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
const isVideo = contentPolicy.isVideoUpload;
const mediaLabel = () => '图片';

function createApi(platform, config, options) {
  const settings = config || { mode: 'demo' };
  const opts = options || {};
  const personalMode = settings.productMode === 'personal';
  const personal = personalMode ? createPersonalService(platform, options) : null;
  const privateLibrary = personal || createPersonalService(platform, options);
  const demo = personalMode ? null : createDemoService(platform, options);
  const isDemo = () => personalMode || !!(platform && platform.__preview) || settings.mode !== 'cloud';
  const uploadQueueKey = personalMode ? 'youchong.personalUploadQueue.v1' : UPLOAD_QUEUE_KEY;
  const clock = opts.now || Date.now;
  const pause = opts.mediaDelay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const pollAttempts = opts.mediaPollAttempts === undefined ? 2 : Math.max(0, Math.min(5, Number(opts.mediaPollAttempts) || 0));
  const scope = () => personalMode ? 'personal' : isDemo() ? 'demo' : 'cloud:' + (settings.cloudEnv || 'default');
  let feedVersion = 0;
  let queueWork = Promise.resolve();
  function serializeQueue(work) {
    const job = queueWork.then(work); queueWork = job.catch(() => {}); return job;
  }

  function readQueue() {
    if (!platform || typeof platform.getStorageSync !== 'function') throw failure('STORAGE_UNAVAILABLE', '无法读取附件草稿，请检查本机存储');
    const saved = platform.getStorageSync(uploadQueueKey);
    if (!saved) return [];
    if (!saved || saved.version !== 1 || !Array.isArray(saved.items)) throw failure('STORAGE_UNAVAILABLE', '附件草稿记录无法读取，请先保留正文');
    return JSON.parse(JSON.stringify(saved.items));
  }
  function saveQueue(items) {
    try { platform.setStorageSync(uploadQueueKey, { version: 1, items }); }
    catch (_) { throw failure('STORAGE_UNAVAILABLE', '附件草稿未能保存到本机，请检查存储空间'); }
  }
  function remember(record) {
    const queue = readQueue();
    const index = queue.findIndex(item => item.localId === record.localId);
    if (index < 0) queue.push(record); else queue[index] = record;
    saveQueue(queue);
  }
  async function removeLocal(path, strict, ownerId, referenceOptions) {
    if (!path || /^data:/i.test(path)) return true;
    if (personalMode && !personal.canRemoveLocalFile(path, ownerId, referenceOptions)) return false;
    if (!personalMode && personalFileReferenced(platform, path, { ...opts, throwOnReadError: true })) return true;
    try { await nativeCall(platform, 'removeSavedFile', { filePath: path }); }
    catch (error) { if (strict && !/not exist|not found|不存在/i.test(error.message || '')) throw error; }
    return true;
  }
  async function forgetPublished(images, video, committedOwner) {
    const files = (Array.isArray(images) ? images : []).concat(video && (video.url || video.fileId) || []).filter(Boolean);
    if (!files.length) return;
    const queue = readQueue();
    const published = queue.filter(item => item.scope === scope() && (!personalMode || item.ownerId === committedOwner) && (item.status === 'complete' || personalMode && item.status === 'consumed') && files.indexOf(item.fileId) !== -1);
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
  async function clearLocalUploads(expectedOwner, clearingAccount = false) {
    const queue = readQueue(); const remaining = []; let incomplete = false;
    const currentOwner = expectedOwner || await owner(false);
    const referenceOptions = personalMode ? { excludeOwnerQueues: clearingAccount, excludeOwnerDrafts: clearingAccount,
      excludeQueueEntries: queue.filter(item => item.ownerId === currentOwner && item.scope === scope()).map(item => ({ key: uploadQueueKey, localId: item.localId })) } : undefined;
    if (personalMode) {
      const discarded = queue.filter(item => item.ownerId === currentOwner && item.scope === scope());
      discarded.forEach(item => { item.status = 'consumed'; });
      if (discarded.length) saveQueue(queue);
    }
    for (const item of queue) {
      if (item.ownerId !== currentOwner || item.scope !== scope()) { remaining.push(item); continue; }
      try { if (!await removeLocal(item.localPath, true, currentOwner, referenceOptions)) remaining.push(item); }
      catch (_) { remaining.push(item); incomplete = true; }
    }
    if (remaining.length) saveQueue(remaining);
    else if (platform && typeof platform.removeStorageSync === 'function') platform.removeStorageSync(uploadQueueKey);
    else saveQueue([]);
    if (incomplete) throw failure('LOCAL_CLEANUP_FAILED', '本机附件尚未清理完成，请重试清理');
    if (personalMode) await personal.clearLocalFiles(currentOwner, referenceOptions);
    return { success: true };
  }
  async function clearPrivateData(expectedOwner) {
    let cleanupError;
    const currentOwner = expectedOwner || await owner(false);
    try { await clearLocalUploads(currentOwner, true); } catch (error) { cleanupError = error; }
    try { await require('./pet-photos').clearLocalPetPhotos(platform, personalMode ? { productMode: 'personal', ownerId: currentOwner, canRemoveLocalFile: path => personal.canRemoveLocalFile(path, currentOwner, { excludeOwnerQueues: true, excludeOwnerDrafts: true }) } : { ...opts, ownerId: currentOwner, scope: scope() }); } catch (error) { cleanupError = error; }
    try {
      if (personalMode) {
        const saved = platform.getStorageSync('youchong.privateDrafts.v1');
        if (saved) {
          if (typeof saved !== 'object' || Array.isArray(saved)) throw failure('STORAGE_UNAVAILABLE', '本机草稿记录无法读取');
          const drafts = JSON.parse(JSON.stringify(saved));
          Object.keys(drafts).forEach(key => { if (key.startsWith('personal:') && key.endsWith(':' + currentOwner)) delete drafts[key]; });
          platform.setStorageSync('youchong.privateDrafts.v1', drafts);
        }
      } else clearCommunityDrafts(platform, currentOwner, isDemo() ? 'demo' : 'cloud');
    } catch (error) { cleanupError = error; }
    if (cleanupError) throw cleanupError;
  }

  async function request(action, payload) {
    let data;
    if (personalMode) data = await personal.call(action, payload || {});
    else if (isDemo()) data = await demo.call(action, payload || {});
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
    return data;
  }

  async function visibleResponse(action, payload, response) {
    const field = ['listPosts', 'listMessages'].includes(action) ? 'items' : ['getCircle', 'getUserProfile'].includes(action) ? 'posts' : '';
    const visited = new Set([payload && payload.cursor || '']);
    const messageTargets = new Map();
    let hiddenMessages = false;
    async function visibleMessage(item) {
      if (!item || contentPolicy.isVideoPost(item) || contentPolicy.isVideoPost(item.post)) return false;
      if (item.targetType !== 'post') return true;
      if (!item.targetId) return false;
      if (!messageTargets.has(item.targetId)) messageTargets.set(item.targetId, request('getPost', { id: item.targetId }).then(result => !!(result && result.post) && !contentPolicy.isVideoPost(result.post), error => {
        if (['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) return false;
        throw error;
      }));
      return messageTargets.get(item.targetId);
    }
    let data = response;
    for (let scanned = 0; ; scanned += 1) {
      if (data && contentPolicy.isVideoPost(data.post)) throw failure('NOT_FOUND', '这条内容已下架或不可见');
      if (['completeUpload', 'getUploadStatus'].includes(action) && contentPolicy.isVideoUpload(data)) contentPolicy.assertVideoAllowed();
      if (!field || !data || !Array.isArray(data[field])) return data;
      let items;
      if (action === 'listMessages' && !isDemo()) {
        const visible = await Promise.all(data[field].map(visibleMessage));
        items = data[field].filter((item, index) => visible[index]);
        hiddenMessages = hiddenMessages || items.length !== data[field].length;
      } else items = data[field].filter(post => !contentPolicy.isVideoPost(post));
      const result = Object.assign({}, data, { [field]: items });
      // Legacy cloud totals can include unavailable targets on other pages.
      // Do not present them as verified unread counts after filtering.
      if (hiddenMessages) Object.assign(result, { unreadCount: null, categoryUnread: null });
      // Cursors describe the server's scanned records, not our visible count.
      // Never renumber them after filtering or skip rows from a partial page.
      if (items.length || !data.nextCursor || isDemo() || scanned >= 9) return result;
      if (visited.has(data.nextCursor)) throw failure('INVALID_RESPONSE', '内容分页暂时不可用，请刷新后重试');
      visited.add(data.nextCursor);
      data = await request(action, Object.assign({}, payload, { cursor: data.nextCursor }));
    }
  }

  async function call(action, payload) {
    contentPolicy.assertRequest(action, payload);
    if (['completeUpload', 'getUploadStatus'].includes(action) && payload && readQueue().some(item => (item.ticketId === payload.ticketId || item.localId === payload.ticketId) && isVideo(item))) contentPolicy.assertVideoAllowed();
    // Resolve ownership before deletion, never from a newly created account
    // after the server has committed the request.
    const deletingOwner = action === 'deleteAccount' ? await owner(false) : null;
    let data = await visibleResponse(action, payload, await request(action, payload));
    if (['followUser', 'blockUser', 'joinCircle', 'createPost', 'deletePost', 'setPostVisibility', 'deleteAccount', 'respondFriendRequest', 'removeFriend'].includes(action)) feedVersion += 1;
    if (action === 'createPost' || action === 'deleteAccount') {
      try {
        if (action === 'createPost') await serializeQueue(() => forgetPublished(payload && payload.images, payload && payload.video, data && data.post && data.post.author && data.post.author.id));
        else await serializeQueue(() => clearPrivateData(data && data.ownerId || deletingOwner));
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
    if (personalMode && ['deletePost', 'deletePet', 'setPetPhoto', 'discardPetUpload'].includes(action)) {
      try { await personal.clearLocalFiles(data && data.ownerId); }
      catch (_) { data = Object.assign({}, data, { localCleanupPending: true }); }
    }
    return data;
  }

  function snapshot(records) {
    const result = { images: [], video: null, completed: [], pending: [], failures: [] };
    for (const item of records) {
      const ticketId = item.ticketId || item.localId;
      if (isVideo(item)) {
        result.failures.push({ ticketId, mediaType: 'video', status: 'disabled', code: 'VIDEO_DISABLED', message: '旧附件不再支持，请移除后继续', retryable: false });
        continue;
      }
      const label = mediaLabel(item);
      const kind = isVideo(item) ? { mediaType: 'video' } : {};
      const previewPath = typeof item.localPath === 'string' ? item.localPath : '';
      if (item.status === 'complete' && item.fileId) {
        result.images.push(item.fileId); result.completed.push({ ticketId, fileId: item.fileId, previewPath });
      } else if (item.status === 'pending') result.pending.push(Object.assign({ ticketId, status: 'pending', message: label + '正在审核，正文草稿已保留，请稍后重新检查' }, kind));
      else result.failures.push(Object.assign({ ticketId, status: item.status, code: item.errorCode || (isVideo(item) ? 'VIDEO_UPLOAD_FAILED' : 'IMAGE_UPLOAD_FAILED'), message: item.message || label + '暂未完成，请重试', retryable: !['rejected', 'expired', 'source_missing', 'invalid'].includes(item.status) }, kind));
    }
    return result;
  }
  async function owner(requireVerified) {
    const boot = await call('bootstrap');
    const user = boot && boot.user;
    if (!user || !user.id) throw failure('INVALID_RESPONSE', '无法确认附件草稿所属账号');
    if (!personalMode && requireVerified && (!user.verification || user.verification.status !== (isDemo() ? 'demo_verified' : 'phone_verified'))) throw failure('VERIFICATION_REQUIRED', isDemo() ? '先完成本机模拟核验，再分享图片吧' : '先完成手机号核验，再分享图片吧');
    return user.id;
  }
  const owned = userId => readQueue().filter(item => item.ownerId === userId && item.scope === scope() && item.status !== 'consumed');
  async function ownedSnapshot(userId, records) {
    const selected = records || owned(userId);
    if (personalMode && await owner(false) !== userId) throw failure('UPLOAD_OWNER_CHANGED', '本机资料已切换，附件仍保留在原资料的草稿中');
    return snapshot(selected);
  }

  function applyStatus(record, status) {
    const label = mediaLabel(record);
    if (status && typeof status.fileId === 'string' && status.fileId && (!status.status || status.status === 'complete')) {
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
    if ((personalMode || isVideo(record)) && (record.scope !== scope() || await owner(true) !== record.ownerId)) throw failure('UPLOAD_OWNER_CHANGED', '账号已切换，附件仍保留在原账号的草稿中');
  }
  async function process(record) {
    if (isVideo(record)) return;
    if (['complete', 'rejected', 'expired', 'source_missing', 'invalid'].includes(record.status)) return;
    const label = mediaLabel(record);
    try {
      await ensureVideoOwner(record);
      if (!record.ticketId) {
        const payload = { extension: record.extension };
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
          const uploaded = await platform.cloud.uploadFile({ cloudPath: record.cloudPath, filePath: record.localPath });
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
    if (personalMode) {
      try { await discardUploads([]); }
      catch (error) { if (error.code !== 'LOCAL_CLEANUP_FAILED') throw error; }
    }
    const records = owned(userId);
    for (const record of records) await process(record);
    return ownedSnapshot(userId);
  }

  async function uploadImages(count) {
    const requested = count === undefined ? 3 : Math.min(3, Math.max(0, Math.floor(Number(count) || 0)));
    const userId = await owner(requested > 0);
    const existing = owned(userId);
    if (requested > 0 && existing.some(isVideo)) throw failure('MEDIA_CONFLICT', '请先移除草稿中已停用的旧附件，再添加图片');
    const limit = Math.min(requested, Math.max(0, 3 - existing.length));
    if (!limit) return ownedSnapshot(userId, existing);
    let selection;
    try {
      selection = platform && typeof platform.chooseMedia === 'function' ? await nativeCall(platform, 'chooseMedia', { count: limit, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] }) : await nativeCall(platform, 'chooseImage', { count: limit, sourceType: ['album', 'camera'], sizeType: ['compressed'] });
    } catch (error) {
      if (/cancel/i.test(error.message || '')) return ownedSnapshot(userId);
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
    return ownedSnapshot(userId);
  }

  async function uploadVideo() { contentPolicy.assertVideoAllowed(); }

  async function discardUploads(ticketIds) {
    if (!Array.isArray(ticketIds)) throw failure('INVALID_INPUT', '请选择要移除的附件');
    const userId = await owner(false);
    const queue = readQueue();
    const removed = queue.filter(item => item.ownerId === userId && item.scope === scope() && (ticketIds.includes(item.ticketId) || ticketIds.includes(item.localId) || personalMode && item.status === 'consumed'));
    const referenceOptions = { excludeQueueEntries: removed.map(item => ({ key: uploadQueueKey, localId: item.localId })) };
    if (personalMode && removed.length) {
      // A saved draft can still reference a just-removed attachment. Retain a
      // durable cleanup record until that draft has been successfully updated.
      removed.forEach(item => { item.status = 'consumed'; });
      saveQueue(queue);
    }
    const cleared = []; let incomplete = false;
    for (const item of removed) {
      try { if (await removeLocal(item.localPath, true, userId, referenceOptions)) cleared.push(item); }
      catch (_) { incomplete = true; }
    }
    saveQueue(queue.filter(item => cleared.indexOf(item) === -1));
    if (incomplete) throw failure('LOCAL_CLEANUP_FAILED', '本机附件尚未移除，请检查存储后重试');
    return ownedSnapshot(userId);
  }

  async function getPrivateLibrary() {
    // A local identity is not proof of ownership of a future cloud identity.
    // Keep that archive on device until an explicit account-link flow exists.
    if (!isDemo()) throw failure('PRIVATE_LIBRARY_UNLINKED', '这份本机资料尚未与当前云端账号关联，原数据仍保存在本机');
    const currentOwner = await owner(false);
    const library = await privateLibrary.readLibrary(currentOwner);
    if (await owner(false) !== currentOwner) throw failure('UPLOAD_OWNER_CHANGED', '本机账号已切换，请重新打开私人资料库');
    return library;
  }

  return { call, getPrivateLibrary, getFeedVersion: () => feedVersion,
    canRemoveLocalFile: (path, ownerId, options) => personalMode ? personal.canRemoveLocalFile(path, ownerId, options) : !personalFileReferenced(platform, path, opts),
    uploadImages: count => serializeQueue(() => uploadImages(count)),
    uploadVideo: onProgress => serializeQueue(() => uploadVideo(onProgress)),
    resumeUploads: () => serializeQueue(resumeUploads),
    discardUploads: ticketIds => serializeQueue(() => discardUploads(ticketIds)),
    clearLocalUploads: () => serializeQueue(() => clearLocalUploads())
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
  getPrivateLibrary: function () { return defaultApi().getPrivateLibrary(); },
  uploadImages: function (count) { return defaultApi().uploadImages(count); },
  uploadVideo: function (onProgress) { return defaultApi().uploadVideo(onProgress); },
  resumeUploads: function () { return defaultApi().resumeUploads(); },
  discardUploads: function (ticketIds) { return defaultApi().discardUploads(ticketIds); },
  clearLocalUploads: function () { return defaultApi().clearLocalUploads(); },
  canRemoveLocalFile: function (path, ownerId, options) { return defaultApi().canRemoveLocalFile(path, ownerId, options); },
  createApi
};
