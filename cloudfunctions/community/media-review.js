'use strict';

const { AppError } = require('./service');
const TRACE = /^[a-zA-Z0-9_-]{1,128}$/;

function createMediaReviewStore(repository, options = {}) {
  const now = options.now || Date.now;
  function validateTrace(traceId) {
    if (typeof traceId !== 'string' || !TRACE.test(traceId)) throw new AppError('MEDIA_RESULT_INVALID', '图片审核记录编号无效');
  }
  return {
    async bind(binding) {
      validateTrace(binding.traceId);
      if (!binding.ticketId || !binding.ownerId || !binding.quarantineFileId || !/^[a-f0-9]{64}$/.test(binding.sha256) || !Number.isFinite(binding.reviewExpiresAt)) throw new AppError('MEDIA_RESULT_INVALID', '图片审核绑定信息不完整');
      await repository.transaction(async tx => {
        const previous = await tx.get('media_reviews', binding.traceId);
        if (previous && previous.ticketId && (previous.ticketId !== binding.ticketId || previous.ownerId !== binding.ownerId || previous.sha256 !== binding.sha256 || previous.quarantineFileId !== binding.quarantineFileId)) throw new AppError('MEDIA_TRACE_CONFLICT', '图片审核记录冲突，请重新上传');
        // A signed callback can arrive before mediaCheckAsync returns its trace ID.
        // Keep that receipt, then bind it to the server-owned upload snapshot.
        await tx.set('media_reviews', binding.traceId, { ...previous, ...binding, boundAt: previous && previous.boundAt || now(), createdAt: previous && previous.createdAt || now() });
      });
    },
    async receive(result) {
      validateTrace(result.traceId);
      if (!['pass', 'reject'].includes(result.decision) || typeof result.callbackDigest !== 'string' || !/^[a-f0-9]{64}$/.test(result.callbackDigest)) throw new AppError('MEDIA_RESULT_INVALID', '图片审核结果格式无效');
      await repository.transaction(async tx => {
        const previous = await tx.get('media_reviews', result.traceId);
        if (previous && previous.decision) {
          if (previous.decision === result.decision) return;
          // Contradictory authenticated receipts never turn a rejection into pass.
          await tx.set('media_reviews', result.traceId, { ...previous, decision: 'reject', conflict: true });
          return;
        }
        await tx.set('media_reviews', result.traceId, { ...previous, traceId: result.traceId, decision: result.decision,
          callbackDigest: result.callbackDigest, errorCode: result.errorCode, receivedAt: now(), createdAt: previous && previous.createdAt || now() });
      });
      return { success: true };
    },
    async decision({ traceId, ticketId, ownerId, reviewExpiresAt }) {
      validateTrace(traceId);
      const record = await repository.get('media_reviews', traceId);
      if (!record || !record.ticketId) return Number.isFinite(reviewExpiresAt) && reviewExpiresAt <= now()
        ? { status: 'expired', message: '图片审核已过期，请重新选择图片' } : { status: 'pending' };
      if (record.ticketId !== ticketId || (ownerId && record.ownerId !== ownerId)) throw new AppError('FORBIDDEN', '不能读取其他上传的审核结果');
      const deadline = Math.min(record.reviewExpiresAt, Number.isFinite(reviewExpiresAt) ? reviewExpiresAt : record.reviewExpiresAt);
      if (!Number.isFinite(deadline) || deadline <= now() || (record.receivedAt && record.receivedAt > deadline)) return { status: 'expired', message: '图片审核已过期，请重新选择图片' };
      if (record.decision === 'reject' || record.conflict) return { status: 'reject', message: '这张图片未通过审核，请更换图片' };
      return { status: record.decision === 'pass' ? 'pass' : 'pending' };
    },
    async remove({ traceId, ticketId }) {
      validateTrace(traceId);
      if (typeof ticketId !== 'string' || !ticketId) throw new AppError('MEDIA_RESULT_INVALID', '图片审核绑定信息不完整');
      return repository.transaction(async tx => {
        const record = await tx.get('media_reviews', traceId);
        if (!record) return { removed: false };
        if (record.ticketId !== ticketId) throw new AppError('FORBIDDEN', '不能清理其他上传的审核记录');
        await tx.remove('media_reviews', traceId);
        return { removed: true };
      });
    }
  };
}

module.exports = { createMediaReviewStore };
