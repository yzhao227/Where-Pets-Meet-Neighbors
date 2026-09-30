const s = require('../pages/_shared');
const policyChoices = [{ id: 'unknown', name: '待核实' }, { id: 'allowed', name: '允许携宠' }, { id: 'conditional', name: '有条件携宠' }, { id: 'not_allowed', name: '不可携宠' }];
const statuses = [{ id: 'all', name: '全部状态' }, { id: 'pending', name: '待审核' }, { id: 'approved', name: '已发布' }, { id: 'rejected', name: '未通过' }, { id: 'withdrawn', name: '已撤回 / 下架' }];
const textFields = ['title', 'city', 'district', 'area', 'address', 'description', 'sourceUrl', 'petPolicyText', 'costText', 'startDate', 'endDate'];
const editableFailures = ['INVALID_INPUT', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'AUTHOR_UNAVAILABLE', 'VERIFICATION_REQUIRED', 'CONTENT_REJECTED', 'CONTENT_CHECK_UNAVAILABLE', 'ACCOUNT_UNAVAILABLE'];

function empty() {
  return { type: 'place', title: '', city: '上海', district: '', area: '', address: '', description: '', sourceUrl: '', petPolicyStatus: 'unknown', policyIndex: 0, petPolicyText: '', costText: '', startDate: '', endDate: '' };
}
function formFor(row) {
  const form = empty();
  textFields.forEach(key => { if (typeof row[key] === 'string') form[key] = row[key]; });
  form.type = row.type === 'event' ? 'event' : 'place';
  form.policyIndex = Math.max(0, policyChoices.findIndex(item => item.id === row.petPolicyStatus));
  form.petPolicyStatus = policyChoices[form.policyIndex].id;
  if (form.type === 'place') { form.startDate = ''; form.endDate = ''; }
  return form;
}
function fields(form) {
  const result = { type: form.type === 'event' ? 'event' : 'place' };
  textFields.forEach(key => { result[key] = typeof form[key] === 'string' ? form[key].trim() : ''; });
  result.petPolicyStatus = (policyChoices[form.policyIndex] || policyChoices[0]).id;
  if (result.type === 'place') { result.startDate = ''; result.endDate = ''; }
  return result;
}
function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function validate(value) {
  const rules = [['title', 2, 60, '名称'], ['city', 1, 40, '城市'], ['district', 0, 40, '行政区'], ['area', 0, 40, '片区'], ['address', 2, 200, '公共场所地址'], ['description', 10, 2000, '详细介绍'], ['sourceUrl', 0, 1000, '参考链接'], ['petPolicyText', value.petPolicyStatus === 'unknown' ? 0 : 1, 500, '携宠说明'], ['costText', 0, 200, '费用说明']];
  for (const [key, min, max, label] of rules) {
    const length = Array.from(value[key] || '').length;
    if (length < min) return label + '至少填写 ' + min + ' 个字';
    if (length > max) return label + '最多填写 ' + max + ' 个字';
  }
  if (value.sourceUrl && !s.httpsUrl(value.sourceUrl)) return '参考链接请填写完整的 HTTPS 地址';
  if (value.type === 'event') {
    if (!calendarDate(value.startDate) || !calendarDate(value.endDate)) return '请选择有效的活动开始和结束日期';
    if (value.endDate < value.startDate) return '结束日期不能早于开始日期';
  }
  return '';
}
function decorate(row) {
  const form = formFor(row);
  const status = statuses.find(item => item.id === row.status);
  return { ...fields(form), id: row.id, status: row.status, publishedId: row.publishedId || '',
    statusText: row.status === 'withdrawn' ? row.publishedId ? '已下架' : '已撤回' : status ? status.name : '状态待刷新',
    typeText: row.type === 'event' ? '活动' : '地点', policyText: policyChoices[form.policyIndex].name,
    submittedText: Number.isFinite(row.createdAt) && row.createdAt > 0 ? s.dateText(row.createdAt) : '',
    reviewedText: Number.isFinite(row.reviewedAt) && row.reviewedAt > 0 ? s.dateText(row.reviewedAt) : '',
    reviewNote: typeof row.reviewNote === 'string' ? row.reviewNote : '' };
}
module.exports = { policyChoices, statuses, textFields, editableFailures, empty, formFor, fields, calendarDate, validate, decorate };
