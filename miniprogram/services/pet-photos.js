'use strict';
const KEY = 'youchong.petPhotoQueue.v1';
const error = (code, message) => Object.assign(new Error(message), { code });
function native(platform, method, args) {
  return new Promise((resolve, reject) => {
    if (!platform || typeof platform[method] !== 'function') return reject(error('UNSUPPORTED_API', '当前环境暂不支持选择宠物照片'));
    platform[method]({ ...args, success: resolve, fail: value => reject(error('DEVICE_ERROR', value && (value.errMsg || value.message) || '照片操作失败')) });
  });
}
function read(platform) {
  const value = platform.getStorageSync(KEY);
  if (!value) return [];
  if (value.version !== 1 || !Array.isArray(value.items)) throw error('STORAGE_UNAVAILABLE', '宠物照片记录无法读取，请检查本机存储');
  return JSON.parse(JSON.stringify(value.items));
}
const write = (platform, items) => platform.setStorageSync(KEY, { version: 1, items });
async function removeLocal(platform, path) {
  if (!path || /^data:/i.test(path)) return;
  try { await native(platform, 'removeSavedFile', { filePath: path }); }
  catch (err) { if (!/not found|not exist|不存在/i.test(err.message)) throw err; }
}
async function clearLocalPetPhotos(platform) {
  const remaining = [];
  for (const item of read(platform)) { try { await removeLocal(platform, item.localPath); } catch (_) { remaining.push(item); } }
  if (remaining.length) { write(platform, remaining); throw error('LOCAL_CLEANUP_FAILED', '宠物照片本机副本尚未清理，请重试'); }
  if (typeof platform.removeStorageSync === 'function') platform.removeStorageSync(KEY); else write(platform, []);
}
function createPetPhotos(platform, api, config = {}) {
  const demo = !!platform.__preview || config.mode !== 'cloud';
  const scope = demo ? 'demo' : 'cloud:' + (config.cloudEnv || 'default');
  let work = Promise.resolve();
  const serial = fn => { const job = work.then(fn); work = job.catch(() => {}); return job; };
  async function owner(verified) {
    const boot = await api.call('bootstrap'), user = boot && boot.user;
    if (!user || !user.id) throw error('AUTH_REQUIRED', '请重新进入后读取宠物资料');
    if (verified && (!user.verification || user.verification.status !== (demo ? 'demo_verified' : 'phone_verified'))) throw error('VERIFICATION_REQUIRED', demo ? '完成本机模拟核验后即可选择宠物照片' : '完成手机号核验后即可选择宠物照片');
    return user.id;
  }
  const save = record => { const items = read(platform), index = items.findIndex(item => item.localId === record.localId); if (index < 0) items.push(record); else items[index] = record; write(platform, items); };
  const forget = record => write(platform, read(platform).filter(item => item.localId !== record.localId));
  const owned = userId => read(platform).filter(item => item.ownerId === userId && item.scope === scope && item.status !== 'attached');
  const ensure = async record => { if (await owner(true) !== record.ownerId || record.scope !== scope) throw error('UPLOAD_OWNER_CHANGED', '账号已切换，照片仍保留在原账号的宠物资料中'); };
  async function process(record) {
    try {
      await ensure(record);
      if (!record.ticketId) { const ticket = await api.call('createPetUploadTicket', { petId: record.petId, extension: record.extension }); Object.assign(record, ticket); save(record); }
      if (!record.sourceFileId) {
        await ensure(record);
        if (demo) record.sourceFileId = record.localPath;
        else {
          if (!platform.cloud || typeof platform.cloud.uploadFile !== 'function') throw error('CLOUD_UNAVAILABLE', '当前环境不支持上传宠物照片');
          const uploaded = await platform.cloud.uploadFile({ cloudPath: record.cloudPath, filePath: record.localPath });
          if (!uploaded || !uploaded.fileID) throw error('UPLOAD_UNAVAILABLE', '宠物照片上传未完成，请重试');
          record.sourceFileId = uploaded.fileID;
        }
        save(record);
      }
      await ensure(record);
      const status = await api.call(record.serverPending ? 'getUploadStatus' : 'completeUpload', record.serverPending ? { ticketId: record.ticketId } : { ticketId: record.ticketId, fileId: record.sourceFileId });
      if (status.status === 'pending' || status.status === 'processing') { record.serverPending = true; record.status = 'pending'; record.message = '照片正在审核，现有照片会继续保留'; save(record); return { pending: true }; }
      if (status.status !== 'complete' || !status.fileId) { record.status = status.status === 'rejected' ? 'rejected' : 'expired'; record.message = status.message || '照片未通过审核，请移除后重新选择'; save(record); return { pending: true }; }
      await ensure(record);
      const response = await api.call('setPetPhoto', { petId: record.petId, ticketId: record.ticketId });
      record.status = 'attached';
      try { save(record); if (!demo) await removeLocal(platform, record.localPath); forget(record); } catch (_) { response.localCleanupPending = true; }
      return response;
    } catch (err) {
      record.status = ['CONTENT_REJECTED', 'MEDIA_CONTENT_CHANGED'].includes(err.code) ? 'rejected' : err.code === 'UPLOAD_EXPIRED' ? 'expired' : 'retry';
      record.message = err.message || '照片处理未完成，可稍后重试'; save(record); throw err;
    }
  }
  async function select(petId) {
    const userId = await owner(true);
    if (owned(userId).some(item => item.petId === petId)) throw error('UPLOAD_PENDING', '这只宠物还有待处理照片，请先重试或移除本次选择');
    let selected;
    try { selected = typeof platform.chooseMedia === 'function' ? await native(platform, 'chooseMedia', { count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] }) : await native(platform, 'chooseImage', { count: 1, sourceType: ['album', 'camera'], sizeType: ['compressed'] }); }
    catch (err) { if (/cancel/i.test(err.message)) return { cancelled: true }; throw err; }
    const file = selected.tempFiles && selected.tempFiles[0] || { tempFilePath: selected.tempFilePaths && selected.tempFilePaths[0] };
    const path = file.tempFilePath || file.path;
    if (typeof path !== 'string' || !path) throw error('IMAGE_SOURCE_UNAVAILABLE', '所选宠物照片无法读取');
    if (file.size > 5 * 1024 * 1024) throw error('IMAGE_TOO_LARGE', '宠物照片不能超过 5 MB');
    if (await owner(true) !== userId) throw error('UPLOAD_OWNER_CHANGED', '账号已切换，请重新选择宠物照片');
    const saved = await native(platform, 'saveFile', { tempFilePath: path });
    if (!saved || !saved.savedFilePath) throw error('IMAGE_SAVE_FAILED', '照片未能保存，请检查本机存储');
    const record = { localId: 'pet-photo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), ownerId: userId, scope, petId, localPath: saved.savedFilePath, extension: /(?:\.png(?:\?|$)|^data:image\/png)/i.test(path) ? 'png' : /(?:\.webp(?:\?|$)|^data:image\/webp)/i.test(path) ? 'webp' : 'jpg', status: 'retry' };
    save(record); return process(record);
  }
  async function retry(petId) { const record = owned(await owner(true)).find(item => item.petId === petId); return record ? process(record) : {}; }
  async function discard(petId) {
    const records = owned(await owner(false)).filter(item => item.petId === petId);
    for (const record of records) {
      if (record.ticketId) { try { await api.call('discardPetUpload', { ticketId: record.ticketId }); } catch (err) { if (!['NOT_FOUND', 'UPLOAD_UNAVAILABLE'].includes(err.code)) throw err; } }
      await removeLocal(platform, record.localPath); forget(record);
    }
    return { success: true };
  }
  return { select: id => serial(() => select(id)), retry: id => serial(() => retry(id)), discard: id => serial(() => discard(id)),
    pending: async () => owned(await owner(false)).map(item => ({ petId: item.petId, status: item.status, message: item.message || '照片尚未处理完成', retryable: !['rejected', 'expired'].includes(item.status) })) };
}
module.exports = { KEY, createPetPhotos, clearLocalPetPhotos };
