'use strict';
const pets = require('../data/pets');
const actions = ['listPets', 'savePet', 'deletePet', 'createPetUploadTicket', 'setPetPhoto', 'discardPetUpload'];
function dispatch(state, user, action, payload, helpers) {
  const { now, id, failure, platform } = helpers;
  const fail = (code, message) => { throw failure(code, message); };
  const items = pets.list(user);
  const find = petId => { const pet = items.find(item => item.id === petId); if (!pet) fail('NOT_FOUND', '这份宠物资料不存在或不属于你'); return pet; };
  const result = () => ({ pets: pets.list(user), pet: user.pet || null });
  const commit = () => Object.assign(user, pets.projection(items));
  const retire = ticket => {
    if (!ticket) return;
    ticket.status = 'cleanup'; ticket.petAttached = false;
    if (ticket.fileId && !/^data:/i.test(ticket.fileId) && platform && typeof platform.removeSavedFile === 'function') platform.removeSavedFile({ filePath: ticket.fileId, success() { ticket.localRemoved = true; }, fail() {} });
  };
  if (action === 'listPets') return result();
  if (action === 'savePet') {
    const fields = pets.validate(payload, now(), fail);
    if (payload.id) Object.assign(find(payload.id), fields);
    else { if (items.length >= pets.MAX_PETS) fail('PET_LIMIT', '每个账号最多登记 ' + pets.MAX_PETS + ' 只宠物'); items.push({ id: id(state, 'pet'), ...fields, photo: '', createdAt: now() }); }
    commit(); return result();
  }
  const pet = action === 'discardPetUpload' ? null : find(payload.petId);
  if (action === 'deletePet') {
    items.splice(items.indexOf(pet), 1); commit();
    state.uploads.filter(item => item.userId === user.id && item.purpose === 'pet' && item.petId === pet.id).forEach(retire);
    if (!items.length) user.showPet = false;
    return result();
  }
  if (action === 'createPetUploadTicket') {
    if (Object.keys(payload).some(key => !['petId', 'extension'].includes(key))) fail('INVALID_INPUT', '宠物照片上传参数无效');
    if (!['jpg', 'png', 'webp'].includes(payload.extension)) fail('INVALID_INPUT', '请选择 JPG、PNG 或 WebP 宠物照片');
    const ticketId = id(state, 'upload'), cloudPath = 'demo-uploads/' + user.id + '/' + ticketId + '.' + payload.extension;
    state.uploads.push({ ticketId, cloudPath, userId: user.id, purpose: 'pet', petId: pet.id, mediaType: 'image', status: 'pending', createdAt: now(), extension: payload.extension });
    return { ticketId, cloudPath, purpose: 'pet', petId: pet.id };
  }
  if (action === 'discardPetUpload') {
    const ticket = state.uploads.find(item => item.ticketId === payload.ticketId && item.userId === user.id && item.purpose === 'pet');
    if (!ticket) fail('NOT_FOUND', '宠物照片记录不存在');
    if (ticket.petAttached && items.some(item => item.photoTicketId === ticket.ticketId)) fail('FORBIDDEN', '正在使用的照片请从宠物资料中移除');
    retire(ticket); return { success: true };
  }
  if (action === 'setPetPhoto') {
    if (Object.keys(payload).some(key => !['petId', 'ticketId'].includes(key)) || typeof payload.ticketId !== 'string') fail('INVALID_INPUT', '请选择已保存的宠物照片，或移除现有照片');
    const ticket = payload.ticketId ? state.uploads.find(item => item.ticketId === payload.ticketId && item.userId === user.id && item.purpose === 'pet' && item.petId === pet.id) : null;
    if (payload.ticketId && (!ticket || ticket.status !== 'complete' || ticket.mediaType === 'video' || ticket.postId || !ticket.fileId)) fail('FORBIDDEN', '仅可使用这只宠物本人上传并已完成保存的照片');
    const previous = state.uploads.find(item => item.ticketId === pet.photoTicketId && item.userId === user.id && item.purpose === 'pet');
    pet.photo = ticket ? ticket.fileId : ''; pet.photoTicketId = ticket ? ticket.ticketId : '';
    if (ticket) ticket.petAttached = true;
    commit(); if (previous && previous !== ticket) retire(previous);
    return result();
  }
}
module.exports = { handles: action => actions.includes(action), dispatch };
