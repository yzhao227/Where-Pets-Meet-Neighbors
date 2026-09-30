'use strict';

const DEFAULT_FILTERS = { petFilter: 'all', placeKind: 'all', eventKind: 'all', feeType: 'all', dateRange: 'all', radius: 'all', photosOnly: false, period: 'upcoming' };
const SORTS = {
  places: [{ id: 'recommended', name: '综合推荐' }, { id: 'distance', name: '距离最近' }, { id: 'recent', name: '消息最新' }, { id: 'photos', name: '实景优先' }],
  activities: [{ id: 'recommended', name: '综合推荐' }, { id: 'date', name: '开始时间' }, { id: 'distance', name: '距离最近' }, { id: 'recent', name: '消息最新' }, { id: 'free', name: '免费优先' }]
};
const SORT_HELP = {
  recommended: '默认首页先精选有实景或导航、适用方式明确的地点，实景优先；点击全部或主动搜索筛选可查看完整结果。完整列表中，地点优先展示有明确携宠条件的去处，同类中优先无需复核的记录，再结合已选参照距离和来源新旧。活动优先展示正在举办、即将开始的场次，同日优先携宠条件较明确的活动。未使用浏览量或个性化数据。',
  distance: '按到所选参照点的直线距离排列，无坐标的条目放在后面。不是路程或到达用时。',
  recent: '按来源中最近一次明确标注的发布日期排列，没有发布日期的条目放在后面；不把查阅日期当成新消息。',
  photos: '优先展示有可用实景图片的地点，图片不代表已确认携宠。',
  date: '近期按开始日期从早到晚；往期按结束日期从近到远。只有月份的预告单独展示。',
  free: '仅将明确免费参与的活动提前。费用待公布、需要积分预约不视为免费；商品与额外项目可能另收费。'
};
const FILTER_GROUPS = [
  { key: 'petFilter', title: '携宠安排', choices: [['all', '不限'], ['with', '带宠出门'], ['unknown', '规则待确认'], ['without', '不带宠也可去']] },
  { key: 'placeKind', title: '场地类型', tab: 'places', choices: [['all', '不限'], ['park', '公园绿地'], ['waterside', '滨水步道'], ['commercial', '商场街区'], ['rest', '宠物休憩'], ['culture', '自然科普']] },
  { key: 'period', title: '活动范围', tab: 'activities', choices: [['upcoming', '近期活动'], ['past', '往期回顾']] },
  { key: 'eventKind', title: '活动类型', tab: 'activities', choices: [['all', '不限'], ['event', '活动与市集'], ['exhibition', '宠物展览']] },
  { key: 'dateRange', title: '举办日期', tab: 'activities', choices: [['all', '不限'], ['today', '今天'], ['weekend', '本周末'], ['week', '未来7天'], ['month', '未来30天']] },
  { key: 'feeType', title: '参与费用', choices: [['all', '不限'], ['free', '明确免费'], ['paid', '需要购票'], ['unknown', '费用待确认']] },
  { key: 'radius', title: '直线距离', choices: [['all', '不限'], ['1', '1km内'], ['3', '3km内'], ['5', '5km内'], ['10', '10km内']] },
  { key: 'photosOnly', title: '图片', choices: [[false, '不限'], [true, '只看实景图']] }
];

function dateWindow(range, now) {
  const day = 86400000;
  const start = Math.floor((now + 8 * 3600000) / day) * day - 8 * 3600000;
  if (range === 'today') return [start, start + day];
  if (range === 'week') return [start, start + 7 * day];
  if (range === 'month') return [start, start + 30 * day];
  if (range === 'weekend') {
    const weekday = new Date(start + 8 * 3600000).getUTCDay();
    const saturday = start + (weekday === 0 ? -1 : 6 - weekday) * day;
    return [saturday, saturday + 2 * day];
  }
  return null;
}

function filterCards(items, settings = {}, now = Date.now()) {
  const window = dateWindow(settings.dateRange, now);
  return items.filter(item => {
    const status = item.petPolicy && item.petPolicy.status;
    if (settings.petFilter === 'with' && !['allowed', 'conditional'].includes(status)) return false;
    if (settings.petFilter === 'unknown' && status && status !== 'unknown') return false;
    if (settings.petFilter === 'without' && item.noPetRequired !== true) return false;
    if (settings.placeKind && settings.placeKind !== 'all' && item.placeKind !== settings.placeKind) return false;
    if (settings.eventKind && settings.eventKind !== 'all' && item.type !== settings.eventKind) return false;
    if (settings.feeType && settings.feeType !== 'all' && (item.feeType || 'unknown') !== settings.feeType) return false;
    if (settings.photosOnly && !item.photoUrl) return false;
    if (settings.radius && settings.radius !== 'all' && (!item.distance || item.distance.meters > Number(settings.radius) * 1000)) return false;
    if (window && !(Date.parse(item.startsAt) < window[1] && Date.parse(item.endsAt) > window[0])) return false;
    return true;
  });
}

function publishedTime(item) {
  return Math.max(0, ...(item.sources || []).map(source => {
    const date = source.publishedAt;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
    const value = Date.parse(date + 'T00:00:00+08:00');
    return Number.isFinite(value) ? value : 0;
  }));
}
function admissionRank(item) {
  const status = item.petPolicy && item.petPolicy.status;
  return ['allowed', 'conditional'].includes(status) ? 0 : !status || status === 'unknown' ? 1 : 2;
}
function distanceCompare(a, b) {
  if (!a.distance || !b.distance) return Number(!a.distance) - Number(!b.distance);
  return a.distance.meters - b.distance.meters;
}
function dateCompare(a, b, history) {
  const left = Date.parse(history ? a.endsAt : a.startsAt), right = Date.parse(history ? b.endsAt : b.startsAt);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number(!Number.isFinite(left)) - Number(!Number.isFinite(right));
  return history ? right - left : left - right;
}
function sortCards(items, sort, tab, history = false) {
  return items.slice().sort((a, b) => {
    if (sort === 'distance') return distanceCompare(a, b);
    if (sort === 'recent') return publishedTime(b) - publishedTime(a);
    if (sort === 'photos') return Number(!a.photoUrl) - Number(!b.photoUrl);
    if (sort === 'free') return Number(b.feeType === 'free') - Number(a.feeType === 'free');
    if (sort === 'date') return dateCompare(a, b, history);
    if (tab === 'activities') return Number(b.timeStatus === 'ongoing') - Number(a.timeStatus === 'ongoing') || dateCompare(a, b, history) || admissionRank(a) - admissionRank(b);
    return admissionRank(a) - admissionRank(b) || Number(!!a.needsRecheck) - Number(!!b.needsRecheck) || distanceCompare(a, b) || publishedTime(b) - publishedTime(a);
  });
}

function groupsFor(tab, filters) {
  return FILTER_GROUPS.filter(group => (!group.tab || group.tab === tab) && !(group.key === 'dateRange' && filters.period === 'past'));
}
function activeFilters(tab, filters) {
  return groupsFor(tab, filters).filter(group => filters[group.key] !== DEFAULT_FILTERS[group.key]).map(group => {
    const choice = group.choices.find(value => value[0] === filters[group.key]);
    return { key: group.key, label: choice ? choice[1] : '' };
  }).filter(item => item.label);
}

module.exports = { DEFAULT_FILTERS, SORTS, SORT_HELP, FILTER_GROUPS, groupsFor, activeFilters, filterCards, sortCards, dateWindow };
