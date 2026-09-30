'use strict';
const pets = require('./pets');

function createPetService({ repository: repo, now, uid, fail, requireUser, requireVerifiedUser, moderateText, storage, allRecords, rateLimiter, resolveMedia }) {
  const locate = (user, id) => { const item = pets.list(user).find(pet => pet.id === id); if (!item) fail('NOT_FOUND', '这份宠物资料不存在或不属于你'); return item; };
  async function projectPets(user, viewerId, committed = false) {
    const ownerId = user._id || user.id; const isMine = ownerId === viewerId;
    const items = pets.publicList(user, isMine, now());
    if (!items.length) return { pets: [] };
    let resolve;
    try { resolve = await resolveMedia(items.map(pet => pet.photo)); }
    catch (error) { if (!committed || error.code !== 'MEDIA_UNAVAILABLE') throw error; }
    const current = await repo.get('users', ownerId);
    if (!current || current.status !== 'active' || current.lifecycleId !== user.lifecycleId) {
      if (isMine) fail('ACCOUNT_UNAVAILABLE', '账号状态已变化，请重新进入小程序');
      return { pets: [] };
    }
    if (!isMine && (current.publicProfile !== true || await repo.get('blocks', viewerId + '__' + ownerId) || await repo.get('blocks', ownerId + '__' + viewerId))) return { pets: [] };
    const currentPhotos = new Map(pets.list(current).map(pet => [pet.id, pet.photo]));
    return { pets: items.filter(pet => currentPhotos.has(pet.id)).map(pet => ({ ...pet,
      photo: currentPhotos.get(pet.id) !== pet.photo ? '' : resolve ? resolve(pet.photo || '') : /^cloud:\/\//.test(pet.photo || '') ? '' : pet.photo || ''
    })), ...(!resolve ? { mediaUnavailable: true } : {}) };
  }
  async function result(user, ctx, committed = false) {
    const projected = await projectPets(user, ctx.userId, committed);
    return { ...projected, pet: pets.primary(projected.pets) };
  }
  async function retire(ticket, ownerId) {
    const locked = await repo.transaction(async tx => {
      const current = await tx.get('uploads', ticket._id);
      if (!current || current.ownerId !== ownerId || current.purpose !== 'pet') return null;
      const owner = await tx.get('users', ownerId);
      if (owner && pets.list(owner).some(pet => pet.photoTicketId === current._id)) return null;
      if (current.status === 'processing' && current.leaseUntil > now()) {
        await tx.set('uploads', current._id, { ...current, petRetired: true, petAttached: false });
        return { deferred: true };
      }
      await tx.set('uploads', current._id, { ...current, status: 'cleanup', petAttached: false });
      return current;
    });
    if (!locked) return false;
    if (locked.deferred) return true;
    const files = [...new Set([locked.fileId, locked.sourceFileId, locked.quarantineFileId, locked.publishingFileId, ...(locked.cleanupFileIds || []), locked.cloudPath && storage && storage.fileIdForPath && storage.fileIdForPath(locked.cloudPath)].filter(Boolean))];
    try {
      if (files.length) { if (!storage || !storage.remove) return true; await storage.remove(files); }
      if (locked.traceId && storage && storage.removeReview) await storage.removeReview({ traceId: locked.traceId, ticketId: locked._id });
      await repo.transaction(async tx => { const current = await tx.get('uploads', locked._id); if (current && current.status === 'cleanup' && current.ownerId === ownerId) await tx.remove('uploads', locked._id); });
      return false;
    } catch (_) { return true; }
  }
  async function cleanupDetached(ctx, petId) {
    let pending = false;
    // Match the provisioned ownerId/_id index; pet metadata is filtered only
    // after reading this account's uploads, never another account's records.
    const tickets = (await allRecords('uploads', { ownerId: ctx.userId })).filter(ticket => ticket.purpose === 'pet' && (!petId || ticket.petId === petId));
    for (const ticket of tickets) if (petId || ticket.petAttached || ticket.status === 'cleanup') pending = await retire(ticket, ctx.userId) || pending;
    return pending;
  }
  const handlers = {
    async listPets(payload, ctx) { return result(await requireUser(repo, ctx.userId, ctx.lifecycleId), ctx); },
    async savePet(payload, ctx) {
      const fields = pets.validate(payload, now(), fail);
      await moderateText([fields.name, fields.breed].filter(Boolean).join('\n'), ctx.openid);
      const next = await repo.transaction(async tx => {
        const user = await requireUser(tx, ctx.userId, ctx.lifecycleId), items = pets.list(user);
        if (payload.id) { locate(user, payload.id); Object.assign(items.find(pet => pet.id === payload.id), fields); }
        else { if (items.length >= pets.MAX_PETS) fail('PET_LIMIT', '每个账号最多登记 ' + pets.MAX_PETS + ' 只宠物'); items.push({ id: 'pet-' + uid(), ...fields, photo: '', createdAt: now() }); }
        const next = { ...user, ...pets.projection(items), updatedAt: now() }; await tx.set('users', ctx.userId, next); return next;
      });
      return result(next, ctx, true);
    },
    async deletePet(payload, ctx) {
      const response = await repo.transaction(async tx => {
        const user = await requireUser(tx, ctx.userId, ctx.lifecycleId); locate(user, payload.petId);
        const items = pets.list(user).filter(pet => pet.id !== payload.petId);
        const next = { ...user, ...pets.projection(items), ...(!items.length ? { showPet: false } : {}), updatedAt: now() };
        await tx.set('users', ctx.userId, next); return next;
      });
      return { ...await result(response, ctx, true), cleanupPending: await cleanupDetached(ctx, payload.petId) };
    },
    async createPetUploadTicket(payload, ctx) {
      if (Object.keys(payload).some(key => !['petId', 'extension'].includes(key))) fail('INVALID_INPUT', '宠物照片上传参数无效');
      if (!storage || !storage.enabled) fail('UPLOAD_UNAVAILABLE', '宠物照片审核尚未配置，请先保存文字资料');
      if (!['jpg', 'png', 'webp'].includes(payload.extension)) fail('INVALID_INPUT', '请选择 JPG、PNG 或 WebP 宠物照片');
      await rateLimiter.consume(ctx.userId, 'createUploadTicket', ctx.lifecycleId);
      const ticketId = uid(), cloudPath = `community/incoming/${ctx.userId}/${ticketId}.${payload.extension}`;
      await repo.transaction(async tx => {
        const user = await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId); locate(user, payload.petId);
        await tx.set('uploads', ticketId, { ownerId: ctx.userId, cloudPath, extension: payload.extension, mediaType: 'image', purpose: 'pet', petId: payload.petId, status: 'pending', createdAt: now(), expiresAt: now() + 15 * 60 * 1000 });
      });
      return { ticketId, cloudPath, purpose: 'pet', petId: payload.petId };
    },
    async setPetPhoto(payload, ctx) {
      if (Object.keys(payload).some(key => !['petId', 'ticketId'].includes(key)) || typeof payload.ticketId !== 'string') fail('INVALID_INPUT', '请选择已审核完成的宠物照片，或移除现有照片');
      let previous;
      const response = await repo.transaction(async tx => {
        const user = await requireUser(tx, ctx.userId, ctx.lifecycleId), items = pets.list(user); locate(user, payload.petId);
        const pet = items.find(item => item.id === payload.petId);
        const ticket = payload.ticketId ? await tx.get('uploads', payload.ticketId) : null;
        if (payload.ticketId && (!ticket || ticket.ownerId !== ctx.userId || ticket.purpose !== 'pet' || ticket.petId !== pet.id || ticket.petRetired || ticket.status !== 'complete' || !ticket.fileId || ticket.mediaType === 'video' || ticket.postId)) fail('FORBIDDEN', '仅可使用这只宠物本人上传且审核通过的照片');
        if (ticket) await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId);
        previous = pet.photoTicketId && pet.photoTicketId !== payload.ticketId ? await tx.get('uploads', pet.photoTicketId) : null;
        pet.photo = ticket ? ticket.fileId : ''; pet.photoTicketId = payload.ticketId;
        if (ticket) await tx.set('uploads', ticket._id || payload.ticketId, { ...ticket, petAttached: true });
        const next = { ...user, ...pets.projection(items), updatedAt: now() }; await tx.set('users', ctx.userId, next); return next;
      });
      return { ...await result(response, ctx, true), cleanupPending: previous ? await retire(previous, ctx.userId) : false };
    },
    async discardPetUpload(payload, ctx) {
      await requireUser(repo, ctx.userId, ctx.lifecycleId);
      const ticket = typeof payload.ticketId === 'string' && await repo.get('uploads', payload.ticketId);
      if (!ticket || ticket.ownerId !== ctx.userId || ticket.purpose !== 'pet') fail('NOT_FOUND', '宠物照片记录不存在');
      const user = await requireUser(repo, ctx.userId, ctx.lifecycleId);
      if (pets.list(user).some(pet => pet.photoTicketId === ticket._id)) fail('FORBIDDEN', '正在使用的照片请从宠物资料中移除');
      return { success: true, cleanupPending: await retire(ticket, ctx.userId) };
    }
  };
  return { handlers, cleanupDetached, projectPets };
}
module.exports = { createPetService };
