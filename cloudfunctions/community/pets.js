'use strict';

const TYPES = [{ id: 'cat', name: '猫' }, { id: 'dog', name: '狗' }, { id: 'rabbit', name: '兔子' }, { id: 'small-mammal', name: '小型哺乳动物' }, { id: 'bird', name: '鸟' }, { id: 'fish', name: '鱼' }, { id: 'reptile', name: '爬行动物' }, { id: 'amphibian', name: '两栖动物' }, { id: 'invertebrate', name: '无脊椎动物' }, { id: 'other', name: '其他动物' }];
const MAX_PETS = 8;
const today = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
function list(user) {
  if (Array.isArray(user.pets)) return user.pets.map(pet => ({ ...pet }));
  return user.pet ? [{ id: 'legacy', name: user.pet.name || '', type: user.pet.type || 'other', breed: '', birthDate: '', ageMonths: null, photo: '' }] : [];
}
function primary(items) { return items.length ? { name: items[0].name, type: items[0].type } : null; }
function projection(items) { return { pets: items, pet: primary(items) }; }
function legacyPatch(user, value) {
  if (value === undefined) return {};
  const items = list(user);
  if (value === null) return projection(items.slice(1));
  if (items.length) items[0] = { ...items[0], name: value.name, type: value.type };
  else items.push({ id: 'legacy', ...value, breed: '', birthDate: '', ageMonths: null, photo: '' });
  return projection(items);
}
function validate(payload, now, fail) {
  const allowed = ['id', 'name', 'type', 'breed', 'birthDate', 'ageMonths'];
  if (!payload || Object.keys(payload).some(key => !allowed.includes(key))) fail('INVALID_INPUT', '宠物资料只接受名字、种类、品种与生日或年龄');
  const text = (value, label, max, required) => {
    if (typeof value !== 'string' || Array.from(value.trim()).length > max || required && !value.trim()) fail('INVALID_INPUT', label + (required ? '请填写 1–' : '最多 ') + max + ' 个字');
    return value.trim();
  };
  if (payload.id !== undefined && (typeof payload.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.id))) fail('INVALID_INPUT', '宠物资料编号无效');
  if (!TYPES.some(type => type.id === payload.type)) fail('INVALID_INPUT', '请选择有效的动物种类');
  const birthDate = payload.birthDate === undefined ? '' : payload.birthDate;
  const ageMonths = payload.ageMonths === undefined || payload.ageMonths === '' ? null : payload.ageMonths;
  if (typeof birthDate !== 'string' || birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(Date.parse(birthDate + 'T00:00:00Z')) || new Date(birthDate + 'T00:00:00Z').toISOString().slice(0, 10) !== birthDate || birthDate < '1900-01-01' || birthDate > today(now))) fail('INVALID_INPUT', '请选择有效且不晚于今天的生日');
  if (ageMonths !== null && (!Number.isInteger(ageMonths) || ageMonths < 0 || ageMonths > 1500)) fail('INVALID_INPUT', '年龄需为 0–1500 个月');
  if (birthDate && ageMonths !== null) fail('INVALID_INPUT', '生日与大致年龄选填一项即可');
  return { name: text(payload.name, '宠物名字', 24, true), type: payload.type, breed: text(payload.breed === undefined ? '' : payload.breed, '品种', 40), birthDate, ageMonths, ageRecordedAt: ageMonths === null ? null : now };
}
function monthsAt(pet, now = Date.now()) {
  let months = pet.ageMonths;
  if (pet.birthDate) {
    const start = new Date(pet.birthDate + 'T00:00:00Z'), end = new Date(now + 8 * 3600000);
    months = Math.max(0, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() - (end.getUTCDate() < start.getUTCDate() ? 1 : 0));
  } else if (Number.isInteger(months) && pet.ageRecordedAt) months += Math.max(0, Math.floor((now - pet.ageRecordedAt) / (30.4375 * 86400000)));
  return Number.isInteger(months) ? months : null;
}
function ageLabel(pet, now = Date.now()) {
  const months = monthsAt(pet, now);
  if (months === null) return '';
  const years = Math.floor(months / 12), rest = months % 12;
  return (pet.birthDate ? '' : '约 ') + (years ? years + ' 岁' : '') + (rest || !years ? (years ? ' ' : '') + rest + ' 个月' : '');
}
function publicList(user, isMine, now) {
  if (isMine) return list(user);
  if (user.publicProfile !== true) return [];
  return list(user).map(pet => ({ id: pet.id, name: pet.name, type: pet.type, breed: pet.breed || '', photo: pet.photo || '', ageLabel: ageLabel(pet, now) }));
}
module.exports = { TYPES, MAX_PETS, today, list, primary, projection, legacyPatch, validate, monthsAt, ageLabel, publicList };
