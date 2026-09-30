'use strict';

const { AppError } = require('./service');
const crypto = require('node:crypto');
const { createMediaReviewStore } = require('./media-review');
const { callbackConfiguration } = require('./media-callback');
const { inspectVideo } = require('./video-file');

function contentType(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > 5 * 1024 * 1024) throw new AppError('INVALID_IMAGE', '图片文件无效或超过 5 MB');
  if (extension === 'jpg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (extension === 'png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (extension === 'webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new AppError('INVALID_IMAGE', '文件格式与图片类型不一致');
}

function createStorage(cloud, environment, options = {}) {
  const prefix = environment.CLOUD_FILE_PREFIX || '';
  const mode = environment.MEDIA_REVIEW_MODE || 'disabled';
  const now = options.now || Date.now;
  const reviewStore = options.repository ? createMediaReviewStore(options.repository, { now }) : null;
  const asyncReady = !!reviewStore && callbackConfiguration(environment).enabled && environment.MEDIA_QUARANTINE_LOCK_CONFIRMED === 'true' &&
    cloud.openapi && cloud.openapi.security && typeof cloud.openapi.security.mediaCheckAsync === 'function' && typeof cloud.getTempFileURL === 'function';
  const syncReady = cloud.openapi && cloud.openapi.security && typeof cloud.openapi.security.imgSecCheck === 'function';
  const enabled = environment.UPLOADS_ENABLED === 'true' && /^cloud:\/\/[^/]+\/$/.test(prefix) && (mode === 'sync' && !!syncReady || mode === 'async' && !!asyncReady);
  // A video provider must inspect the full motion picture and its audio track.
  // The image APIs below do not provide that capability and cannot enable video.
  const videoProvider = options.videoReviewProvider;
  const videoEnabled = environment.VIDEO_UPLOADS_ENABLED === 'true' && environment.VIDEO_REVIEW_MODE === 'provider' &&
    /^cloud:\/\/[^/]+\/$/.test(prefix) && !!videoProvider && videoProvider.supportsFullVideo === true &&
    videoProvider.supportsAudio === true && typeof videoProvider.review === 'function';
  async function verifyVideoAndPublish({ fileId, cloudPath, extension, openid }) {
    if (!videoEnabled) throw new AppError('VIDEO_UNAVAILABLE', '视频审核尚未配置，请先分享照片或文字');
    if (extension !== 'mp4' || !/^community\/published\/[A-Za-z0-9_-]+\.mp4$/.test(cloudPath)) throw new AppError('INVALID_VIDEO', '视频发布记录无效');
    const download = await cloud.downloadFile({ fileID: fileId });
    const bytes = download.fileContent;
    const metadata = inspectVideo(bytes, extension);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    let timer;
    try {
      const timeout = Math.max(1000, Math.min(90000, Number(options.videoReviewTimeoutMs) || 60000));
      const decision = await Promise.race([
        videoProvider.review({ bytes: Buffer.from(bytes), contentType: 'video/mp4', sha256, metadata: { ...metadata }, openid }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Video review timed out')), timeout); })
      ]);
      if (decision && decision.decision === 'reject') throw new AppError('CONTENT_REJECTED', '视频未通过审核，请更换视频');
      // Only an explicit final pass tied to these exact bytes is publishable.
      if (!decision || decision.decision !== 'pass' || decision.sha256 !== sha256) throw new AppError('CONTENT_CHECK_UNAVAILABLE', '视频审核尚未完成，请保留草稿后重试');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('CONTENT_CHECK_UNAVAILABLE', '视频审核暂时不可用，请保留草稿后重试');
    } finally { if (timer) clearTimeout(timer); }
    const published = await writeSnapshot(cloudPath, bytes);
    return { fileId: published, durationSeconds: metadata.durationSeconds, width: metadata.width, height: metadata.height, bytes: metadata.bytes };
  }
  async function writeSnapshot(cloudPath, bytes) {
    const result = await cloud.uploadFile({ cloudPath, fileContent: bytes });
    if (!result.fileID || result.fileID !== `${prefix}${cloudPath}`) {
      if (result.fileID) await cloud.deleteFile({ fileList: [result.fileID] }).catch(() => {});
      throw new AppError('UPLOAD_UNAVAILABLE', '云存储环境配置不匹配，请联系运营者');
    }
    return result.fileID;
  }
  return {
    enabled, mode, videoEnabled, videoMode: 'sync',
    fileIdForPath(path) { return prefix ? `${prefix}${path}` : null; },
    isExpectedFile(fileId, path, mediaType) { return (mediaType === 'video' || /\.mp4$/.test(path) ? videoEnabled : enabled) && fileId === `${prefix}${path}`; },
    async verifyAndPublish({ fileId, cloudPath, extension, mediaType, openid }) {
      if (mediaType === 'video' || extension === 'mp4') return verifyVideoAndPublish({ fileId, cloudPath, extension, openid });
      if (!enabled || mode !== 'sync') throw new AppError('UPLOAD_UNAVAILABLE', '同步图片审核尚未配置');
      const download = await cloud.downloadFile({ fileID: fileId });
      const bytes = download.fileContent;
      const mime = contentType(bytes, extension);
      try {
        // Requires explicit account capability verification before UPLOADS_ENABLED=true.
        // No image is published when the API is unsupported, fails, or rejects content.
        const decision = await cloud.openapi.security.imgSecCheck({ media: { contentType: mime, value: bytes } });
        const code = decision && (decision.errCode === undefined ? decision.errcode : decision.errCode);
        if (code !== 0) throw new AppError('CONTENT_REJECTED', '这张图片暂时无法发布，请更换图片');
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (Number(error.errCode || error.errcode) === 87014) throw new AppError('CONTENT_REJECTED', '这张图片暂时无法发布，请更换图片');
        throw new AppError('CONTENT_CHECK_UNAVAILABLE', '图片内容检查暂时不可用，请先分享文字');
      }
      return writeSnapshot(cloudPath, bytes);
    },
    async submitReview({ fileId, extension, openid, ticketId, ownerId, operationToken }) {
      if (!enabled || mode !== 'async') throw new AppError('UPLOAD_UNAVAILABLE', '异步图片审核尚未配置');
      if (!openid || !ticketId || !ownerId || !operationToken) throw new AppError('INVALID_INPUT', '图片审核归属信息不完整');
      const download = await cloud.downloadFile({ fileID: fileId });
      const bytes = download.fileContent;
      contentType(bytes, extension);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const quarantinePath = `community/quarantine/${crypto.randomBytes(24).toString('hex')}.${extension}`;
      const quarantineFileId = `${prefix}${quarantinePath}`;
      // Register the server-owned path before external storage I/O. If review
      // submission, deletion, or the process fails, maintenance can still find it.
      await options.repository.transaction(async tx => {
        const ticket = await tx.get('uploads', ticketId);
        if (ticket && ticket.ownerId !== ownerId) throw new AppError('FORBIDDEN', '不能使用他人的上传记录');
        if (!ticket || ticket.status !== 'processing' || ticket.phase !== 'submitting' || ticket.operationToken !== operationToken ||
          ticket.sourceFileId !== fileId || !Number.isFinite(ticket.leaseUntil) || ticket.leaseUntil <= now()) throw new AppError('UPLOAD_EXPIRED', '图片处理已结束，请重新选择');
        await tx.set('uploads', ticketId, { ...ticket, quarantineFileId, sha256,
          cleanupFileIds: [...new Set([...(ticket.cleanupFileIds || []), ticket.quarantineFileId].filter(Boolean))] });
      });
      try {
        await writeSnapshot(quarantinePath, bytes);
        const urls = await cloud.getTempFileURL({ fileList: [quarantineFileId] });
        const entry = urls && urls.fileList && urls.fileList.find(item => item.fileID === quarantineFileId);
        if (!entry || (entry.status !== undefined && Number(entry.status) !== 0) || typeof entry.tempFileURL !== 'string' || !entry.tempFileURL.startsWith('https://')) throw new Error('Temporary media URL unavailable');
        // SDK request/response shapes follow WeChat mediaCheckAsync v2. Capability
        // and encrypted callback delivery still require a real-account smoke test.
        const response = await cloud.openapi.security.mediaCheckAsync({ mediaUrl: entry.tempFileURL, mediaType: 2, version: 2, scene: 2, openid });
        const code = response && (response.errCode === undefined ? response.errcode : response.errCode);
        const traceId = response && (response.traceId || response.trace_id);
        if (Number(code) !== 0 || typeof traceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(traceId)) throw new Error('Media request did not return a trace');
        const reviewExpiresAt = now() + 30 * 60 * 1000;
        await reviewStore.bind({ traceId, ticketId, ownerId, quarantineFileId, sha256, reviewExpiresAt });
        return { traceId, quarantineFileId, sha256, reviewExpiresAt };
      } catch (error) {
        await cloud.deleteFile({ fileList: [quarantineFileId] }).catch(() => {});
        if (error instanceof AppError) throw error;
        throw new AppError('CONTENT_CHECK_UNAVAILABLE', '图片审核暂时不可用，请保留草稿后重试');
      }
    },
    async acceptReviewResult(result) {
      if (!reviewStore || mode !== 'async') throw new AppError('CONTENT_CHECK_UNAVAILABLE', '异步图片审核尚未配置');
      // This method is wired only to media-callback after signature/decryption.
      // It is never registered as a community action callable by the client.
      return reviewStore.receive(result);
    },
    async getReviewDecision(input) {
      if (!enabled || mode !== 'async') throw new AppError('CONTENT_CHECK_UNAVAILABLE', '异步图片审核尚未配置');
      return reviewStore.decision(input);
    },
    async removeReview(input) {
      if (!reviewStore) return { removed: false };
      return reviewStore.remove(input);
    },
    async finalizeReview({ quarantineFileId, sha256, cloudPath }) {
      if (!enabled || mode !== 'async' || typeof quarantineFileId !== 'string' || !quarantineFileId.startsWith(`${prefix}community/quarantine/`) || !/^[a-f0-9]{64}$/.test(sha256) || !/^community\/published\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(cloudPath)) throw new AppError('UPLOAD_UNAVAILABLE', '图片发布记录无效');
      const download = await cloud.downloadFile({ fileID: quarantineFileId });
      const bytes = download.fileContent;
      const extension = cloudPath.split('.').pop();
      contentType(bytes, extension);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha256) throw new AppError('MEDIA_CONTENT_CHANGED', '待审核图片内容发生变化，请重新选择图片');
      return writeSnapshot(cloudPath, bytes);
    },
    async remove(fileIds) {
      if (!fileIds.length) return;
      const result = await cloud.deleteFile({ fileList: fileIds });
      const failed = (result.fileList || []).filter(file => Number(file.status) !== 0 && !/not exist|not found/i.test(file.errMsg || ''));
      if (failed.length) throw new AppError('FILE_DELETE_FAILED', '图片清理尚未完成，请稍后重试');
    }
  };
}

module.exports = { createStorage, contentType, inspectVideo };
