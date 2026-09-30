'use strict';

const crypto = require('node:crypto');
const pets = require('./pets');

function authorizeMaintenance(event, wxContext, secret) {
  if (wxContext && wxContext.OPENID) return false;
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 || !secret.trim()) return false;
  if (!event || event.action !== '__maintenance' || typeof event.maintenanceSecret !== 'string') return false;
  const actual = Buffer.from(event.maintenanceSecret, 'utf8'); const expected = Buffer.from(secret, 'utf8');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createMaintenance({ repository: repo, storage, now, randomId, flushOutbox, fail }) {
  const errorCategory = (error, fallback) => /^[A-Z][A-Z0-9_]{0,63}$/.test(error && error.code || '') ? error.code : fallback;
  async function eligible(upload, access = repo) {
    if (upload.status === 'cleanup') return true;
    if (upload.purpose === 'pet' && upload.petRetired) return !(upload.status === 'processing' && upload.leaseUntil > now());
    if (upload.purpose === 'pet' && upload.petAttached) {
      const owner = await access.get('users', upload.ownerId);
      return !owner || owner.status !== 'active' || !pets.list(owner).some(pet => pet.photoTicketId === upload._id && pet.photo === upload.fileId);
    }
    if (upload.postId) {
      const post = await access.get('posts', upload.postId);
      return !post || post.deleted === true;
    }
    if (['rejected', 'expired'].includes(upload.status)) return true;
    if (upload.status === 'pending') return upload.expiresAt <= now();
    if (upload.status === 'processing') return Math.max(upload.leaseUntil || 0, upload.reviewExpiresAt || upload.expiresAt || 0) <= now();
    return upload.status === 'complete' && (upload.completedAt || upload.createdAt || now()) + 86400000 <= now();
  }
  async function referenced(upload) {
    if (upload.purpose === 'pet' && upload.ownerId) {
      const owner = await repo.get('users', upload.ownerId);
      if (owner && owner.status === 'active' && pets.list(owner).some(pet => pet.photoTicketId === upload._id && pet.photo === upload.fileId)) return true;
    }
    if (upload.postId) {
      const post = await repo.get('posts', upload.postId);
      if (post && !post.deleted) return true;
    }
    if (!upload.fileId) return false;
    return (await repo.find('posts', { deleted: false, images: upload.fileId }, { limit: 1 })).length > 0;
  }
  async function cleanSources(upload) {
    if (upload.status !== 'complete' || upload.sourcesCleanedAt) return false;
    const files = [...new Set([upload.sourceFileId, upload.quarantineFileId, upload.publishingFileId, ...(upload.cleanupFileIds || []),
      upload.cloudPath && storage && storage.fileIdForPath && storage.fileIdForPath(upload.cloudPath)].filter(file => file && file !== upload.fileId))];
    if (files.length && (!storage || typeof storage.remove !== 'function')) return false;
    if (files.length) await storage.remove(files);
    if (upload.traceId && storage && storage.removeReview) await storage.removeReview({ traceId: upload.traceId, ticketId: upload._id });
    await repo.transaction(async tx => {
      const current = await tx.get('uploads', upload._id);
      if (current && current.status === 'complete' && current.fileId === upload.fileId)
        await tx.set('uploads', upload._id, { ...current, sourceFileId: '', quarantineFileId: '', traceId: '', publishingFileId: '', cleanupFileIds: [], sourcesCleanedAt: now() });
    });
    return true;
  }
  async function cleanUpload(upload) {
    if (!await eligible(upload) || await referenced(upload)) return false;
    const token = randomId();
    const locked = await repo.transaction(async tx => {
      const current = await tx.get('uploads', upload._id);
      if (!current || !await eligible(current, tx)) return null;
      await tx.set('uploads', current._id, { ...current, status: 'cleanup', cleanupToken: token, cleanupStartedAt: now() });
      return current;
    });
    if (!locked) return false;
    // Publication and finalization both re-read the ticket state in a transaction.
    // Once cleanup is committed no newly published post can claim this ticket.
    if (await referenced(locked)) return false;
    const files = [...new Set([locked.fileId, locked.publishingFileId, locked.quarantineFileId, locked.sourceFileId, ...(locked.cleanupFileIds || []),
      locked.cloudPath && storage && storage.fileIdForPath && storage.fileIdForPath(locked.cloudPath)].filter(Boolean))];
    if (files.length && (!storage || typeof storage.remove !== 'function')) return false;
    if (files.length) await storage.remove(files);
    if (locked.traceId && storage && storage.removeReview) await storage.removeReview({ traceId: locked.traceId, ticketId: locked._id });
    await repo.transaction(async tx => {
      const current = await tx.get('uploads', upload._id);
      if (current && current.status === 'cleanup' && current.cleanupToken === token) await tx.remove('uploads', upload._id);
    });
    return true;
  }
  async function cleanReview(review) {
    const expired = record => record.reviewExpiresAt ? record.reviewExpiresAt <= now() :
      (record.createdAt || record.receivedAt || record.boundAt || now()) + 86400000 <= now();
    if (!expired(review)) return false;
    const token = randomId();
    const locked = await repo.transaction(async tx => {
      const current = await tx.get('media_reviews', review._id);
      if (!current || !expired(current)) return null;
      const upload = current.ticketId && await tx.get('uploads', current.ticketId);
      if (upload && upload.status === 'processing' && upload.leaseUntil > now()) return null;
      // A service invocation may have ended after the review binding but before
      // attaching its trace to the ticket. Expire that ticket before deleting bytes.
      if (upload && ['pending', 'processing'].includes(upload.status)) {
        if (Math.max(upload.expiresAt || 0, upload.reviewExpiresAt || 0, upload.leaseUntil || 0) > now()) return null;
        await tx.set('uploads', upload._id, { ...upload, status: 'expired', reviewMessage: '图片审核已过期，请重新选择' });
      }
      await tx.set('media_reviews', review._id, { ...current, cleanupToken: token });
      return { ...current, publicFileId: upload && upload.fileId };
    });
    if (!locked) return false;
    if (locked.quarantineFileId && locked.quarantineFileId !== locked.publicFileId) {
      if (!storage || !storage.remove) return false;
      if (await referenced({ fileId: locked.quarantineFileId })) return false;
      await storage.remove([locked.quarantineFileId]);
    }
    await repo.transaction(async tx => {
      const current = await tx.get('media_reviews', review._id);
      if (current && current.cleanupToken === token && current.ticketId === locked.ticketId && expired(current))
        await tx.remove('media_reviews', review._id);
    });
    return true;
  }
  return {
    async run({ limit = 20 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID_INPUT', '维护批次需要在 1–50 之间');
      const token = randomId(); let before; let reviewBefore;
      await repo.transaction(async tx => {
        const state = await tx.get('settings', 'maintenance') || {};
        if (state.lockUntil > now()) fail('MAINTENANCE_BUSY', '已有维护任务正在执行');
        before = state.uploadCursor || '';
        reviewBefore = state.reviewCursor || '';
        await tx.set('settings', 'maintenance', { ...state, lockToken: token, lockUntil: now() + 300000, lastRunAt: now(), lastErrorCode: null });
      });
      const result = { notificationsProcessed: 0, uploadsScanned: 0, uploadsDeleted: 0, uploadSourcesCleaned: 0,
        mediaReviewsScanned: 0, mediaReviewsDeleted: 0, rateLimitsDeleted: 0, failures: 0 };
      let nextCursor = before; let nextReviewCursor = reviewBefore; let errorCode = null;
      try {
        try { result.notificationsProcessed = await flushOutbox(Math.min(3, limit)); } catch (error) { result.failures++; errorCode = errorCategory(error, 'NOTIFICATION_RETRY'); }
        const retries = await repo.find('uploads', { status: 'cleanup' }, { orderBy: '_id', limit });
        const remaining = limit - retries.length;
        const fresh = remaining ? await repo.find('uploads', before ? { _id: { gt: before } } : {}, { orderBy: '_id', limit: remaining }) : [];
        const seen = new Set(); const uploads = [...retries, ...fresh].filter(upload => { if (seen.has(upload._id)) return false; seen.add(upload._id); return true; });
        result.uploadsScanned = uploads.length;
        for (const upload of uploads) {
          try {
            if (await cleanUpload(upload)) result.uploadsDeleted++;
            else if (await cleanSources(upload)) result.uploadSourcesCleaned++;
          }
          catch (error) { result.failures++; errorCode = errorCategory(error, 'UPLOAD_CLEANUP_RETRY'); }
        }
        if (remaining) nextCursor = fresh.length === remaining ? fresh[fresh.length - 1]._id : '';
        const reviews = await repo.find('media_reviews', reviewBefore ? { _id: { gt: reviewBefore } } : {}, { orderBy: '_id', limit });
        result.mediaReviewsScanned = reviews.length;
        for (const review of reviews) {
          try { if (await cleanReview(review)) result.mediaReviewsDeleted++; }
          catch (error) { result.failures++; errorCode = errorCategory(error, 'MEDIA_CLEANUP_RETRY'); }
        }
        nextReviewCursor = reviews.length === limit ? reviews[reviews.length - 1]._id : '';
        const expired = await repo.find('rate_limits', { expiresAt: { lte: now() } }, { orderBy: 'expiresAt', limit });
        for (const record of expired) {
          const deleted = await repo.transaction(async tx => {
            const current = await tx.get('rate_limits', record._id);
            if (current && current.expiresAt <= now()) { await tx.remove('rate_limits', record._id); return true; }
            return false;
          });
          if (deleted) result.rateLimitsDeleted++;
        }
      } catch (error) { result.failures++; errorCode = errorCategory(error, 'MAINTENANCE_RETRY'); }
      finally {
        await repo.transaction(async tx => {
          const state = await tx.get('settings', 'maintenance');
          if (state && state.lockToken === token) await tx.set('settings', 'maintenance', { ...state, uploadCursor: nextCursor, reviewCursor: nextReviewCursor,
            lockUntil: 0, lockToken: '', lastErrorCode: errorCode,
            lastSuccessAt: result.failures ? state.lastSuccessAt || null : now(), lastResult: result });
        });
      }
      return result;
    }
  };
}

module.exports = { authorizeMaintenance, createMaintenance };
