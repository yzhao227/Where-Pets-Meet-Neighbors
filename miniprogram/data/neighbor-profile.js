'use strict';

const areas = require('./neighbor-areas');
const location = require('./neighbor-location');
const areaFor = id => areas.find(area => area.id === id) || null;
function settings(user) {
  const visible = user.neighborVisible === true;
  const cell = location.normalizeCell(user.residenceCell);
  const sharing = visible && user.residenceSharing === true && !!cell;
  return { neighborVisible: visible, neighborAreaId: areaFor(user.neighborAreaId) ? user.neighborAreaId : '',
    residenceSharing: sharing, residenceCell: sharing ? cell : null,
    residenceUpdatedAt: Number.isFinite(user.residenceUpdatedAt) && user.residenceUpdatedAt >= 0 ? user.residenceUpdatedAt : null };
}
function update(user, payload, now, fail) {
  for (const key of ['neighborVisible', 'residenceSharing']) if (payload[key] !== undefined && typeof payload[key] !== 'boolean') fail('INVALID_INPUT', '请明确选择是否公开邻居资料和住宅距离');
  if (payload.neighborAreaId !== undefined && (typeof payload.neighborAreaId !== 'string' || payload.neighborAreaId && !areaFor(payload.neighborAreaId))) fail('INVALID_INPUT', '请选择已开放的公开片区');
  if (payload.residenceCell !== undefined && payload.residenceCell !== null && !location.normalizeCell(payload.residenceCell)) fail('INVALID_INPUT', '住宅位置只接受有效的粗粒度网格，请重新选择');
  if (['latitude', 'longitude', 'homeAddress', 'residenceAddress', 'residenceUpdatedAt'].some(key => Object.prototype.hasOwnProperty.call(payload, key))) fail('INVALID_INPUT', '请仅提交住宅附近的粗粒度网格，不要提交坐标、住址或修改时间');
  const previous = settings(user);
  const next = { ...previous, neighborVisible: payload.neighborVisible === undefined ? previous.neighborVisible : payload.neighborVisible,
    neighborAreaId: payload.neighborAreaId === undefined ? previous.neighborAreaId : payload.neighborAreaId };
  if (next.neighborVisible && !areaFor(next.neighborAreaId)) fail('INVALID_INPUT', '开启邻居展示前，请选择一个公开片区');
  const sharing = payload.residenceSharing === undefined ? previous.residenceSharing : payload.residenceSharing;
  if (!next.neighborVisible || !sharing) return { ...next, residenceSharing: false, residenceCell: null };
  const cell = payload.residenceCell === undefined ? previous.residenceCell : location.normalizeCell(payload.residenceCell);
  if (!cell) fail('INVALID_INPUT', '开启住宅距离前，请主动选择住宅附近的粗粒度位置');
  const changed = !previous.residenceCell || cell.x !== previous.residenceCell.x || cell.y !== previous.residenceCell.y;
  if (changed && previous.residenceUpdatedAt !== null && now - previous.residenceUpdatedAt < location.CHANGE_INTERVAL_MS) fail('RESIDENCE_CHANGE_LIMIT', '住宅参照位置每24小时可设置一次；你仍可随时关闭分享');
  return { ...next, residenceSharing: true, residenceCell: cell, residenceUpdatedAt: changed ? now : previous.residenceUpdatedAt };
}
function isParticipant(user) {
  const id = user.id || user._id || '';
  return user.neighborVisible === true && !!areaFor(user.neighborAreaId) && !user.deleted && (!user.status || user.status === 'active') &&
    !['isEditorial', 'catalogManaged', 'isSample', 'isSeed', 'isCurated', 'isDemo'].some(flag => user[flag] === true) &&
    !/^(catalog-|editor-|curated-|sample-|seed-)/.test(id) && !['demo-lin', 'demo-yue', 'demo-qiao', 'demo-an', 'demo-chen', 'demo-he'].includes(id);
}
function publicPet(user) {
  return (user.showPet === true || user.publicProfile === true) && user.pet && ['cat', 'dog', 'rabbit', 'small-mammal', 'bird', 'fish', 'reptile', 'amphibian', 'invertebrate', 'other'].includes(user.pet.type) ? { name: user.pet.name || '', type: user.pet.type } : null;
}
function matches(user, filter) {
  const pet = publicPet(user);
  const publicArea = areaFor(user.neighborAreaId);
  const areaWords = publicArea ? [publicArea.label, publicArea.city, publicArea.district, publicArea.area] : [];
  return (filter.kind !== 'pets' || !!pet) && (filter.kind !== 'people' || !pet) &&
    (!filter.areaId || user.neighborAreaId === filter.areaId) && (filter.petType === 'all' || pet && (filter.petType === 'other' ? !['cat', 'dog'].includes(pet.type) : pet.type === filter.petType)) &&
    (!filter.query || [user.nickname || '', user.publicProfile === true ? user.bio || '' : '', pet && pet.name || ''].concat(areaWords).join(' ').toLowerCase().includes(filter.query));
}
function filters(payload, fail) {
  if (Object.keys(payload).some(key => !['areaId', 'kind', 'petType', 'query', 'cursor', 'limit'].includes(key))) fail('INVALID_INPUT', '邻居筛选不接受位置坐标或身份字段');
  const kind = payload.kind === undefined ? 'pets' : payload.kind;
  const petType = payload.petType === undefined ? 'all' : payload.petType;
  const areaId = payload.areaId === undefined ? '' : payload.areaId;
  const query = payload.query === undefined ? '' : payload.query;
  if (!['pets', 'people', 'all'].includes(kind) || !['all', 'cat', 'dog', 'other'].includes(petType) || typeof areaId !== 'string' || areaId && !areaFor(areaId) || typeof query !== 'string' || Array.from(query).length > 60) fail('INVALID_INPUT', '请选择有效的邻居分类、片区或搜索内容');
  return { kind, petType, areaId, query: query.trim().toLowerCase() };
}
function publicFields(user, viewer) {
  const pet = publicPet(user); const selectedArea = areaFor(user.neighborAreaId);
  const source = settings(viewer); const destination = settings(user);
  const band = source.neighborVisible && source.residenceSharing && destination.neighborVisible && destination.residenceSharing ? location.distanceBand(source.residenceCell, destination.residenceCell) : '';
  return { neighborArea: selectedArea ? { ...selectedArea } : null, pet,
    petLabel: pet ? [pet.name, { cat: '猫', dog: '狗', rabbit: '兔子', 'small-mammal': '小型哺乳动物', bird: '鸟', fish: '鱼', reptile: '爬行动物', amphibian: '两栖动物', invertebrate: '无脊椎动物', other: '其他宠物' }[pet.type]].filter(Boolean).join(' · ') : '',
    bio: user.publicProfile === true ? user.bio || '' : '', ...(band ? { distanceBand: band } : {}) };
}
module.exports = { areaFor, settings, update, isParticipant, publicPet, matches, filters, publicFields };
