const { httpsUrl } = require('../utils/public-url');
const animalTypes = require('../data/animal-types');
const contentTopics = require('../data/topics');
const contentPolicy = require('../data/content-policy');
const postVisibility = require('../data/post-visibility');
const api = require('../services/api');
const nearbyLocation = require('../services/nearby-location');
const { publication } = require('./post/_metadata');
const product = require('../product');
const personalMode = product.personalMode;
let verificationPageOpen = false;
const SHARE_TITLE = '有宠有邻｜喜欢宠物，就在这里相遇';
const SHARE_IMAGE = '/assets/event-walk.png';

// Always use a public cover: WeChat's default page screenshot may include
// private profile fields, visit notes or an unfinished comment.
function shareCard(title = SHARE_TITLE, path = '/pages/community/index') {
  return { title, path, imageUrl: SHARE_IMAGE };
}
function shareTimeline(title = SHARE_TITLE, query = '') {
  return { title, query, imageUrl: SHARE_IMAGE };
}
function shareMenu(visible) {
  const method = !personalMode && visible ? 'showShareMenu' : 'hideShareMenu';
  if (typeof wx[method] === 'function') wx[method]({ menus: ['shareAppMessage', 'shareTimeline'] });
}

function verificationArrived() { verificationPageOpen = true; }
function verificationLeft() { verificationPageOpen = false; }
function openVerification(from) {
  if (personalMode) return;
  if (verificationPageOpen) return;
  verificationPageOpen = true;
  wx.navigateTo({ url: from === 'me' ? '/pages/register/index' : '/pages/register/index?from=action', fail: () => {
    verificationPageOpen = false;
    toast('请到「我」完成手机号核验后，再继续操作');
  } });
}

function safe(page, values) {
  if (!page._closed) page.setData(values);
}

function register(definition) {
  const originalLoad = definition.onLoad;
  const originalShow = definition.onShow;
  const originalUnload = definition.onUnload;
  definition.data = Object.assign({}, definition.data, { personalMode });
  if (personalMode) {
    // Personal records must never become public through the WeChat menu.
    delete definition.onShareAppMessage;
    delete definition.onShareTimeline;
    delete definition.onAddToFavorites;
  }
  const syncSharing = function () {
    if (!personalMode && typeof this.syncShareMenu === 'function') this.syncShareMenu();
    else shareMenu(!!definition.onShareAppMessage || !!definition.onShareTimeline);
  };
  definition.onLoad = function (options) {
    this._closed = false;
    syncSharing.call(this);
    if (originalLoad) return originalLoad.call(this, options || {});
  };
  definition.onShow = function () {
    syncSharing.call(this);
    if (originalShow) return originalShow.call(this);
  };
  definition.onUnload = function () {
    this._closed = true;
    this._loadId = (this._loadId || 0) + 1;
    if (originalUnload) originalUnload.call(this);
  };
  Page(definition);
}

async function load(page, task, options = {}) {
  const retain = options.retain === true && page._loaded && !page.data.error;
  const id = page._loadId = (page._loadId || 0) + 1;
  page._moreRequestId = (page._moreRequestId || 0) + 1;
  safe(page, Object.assign({ error: '', errorCode: '', moreBusy: false }, retain ? {} : { loading: true }));
  try {
    const values = await task();
    if (id === page._loadId) safe(page, Object.assign({ loading: false }, values || {}));
    page._loaded = true;
  } catch (error) {
    if (id === page._loadId && !retain) safe(page, { loading: false, error: error.message || '暂时没有连接上，请重试', errorCode: error.code || '' });
  } finally {
    if (!page._closed && wx.stopPullDownRefresh) wx.stopPullDownRefresh();
  }
}

async function more(page, options) {
  if (page.data.loading || page.data.moreBusy || !page.data.nextCursor) return;
  const cursor = page.data.nextCursor;
  const loadId = page._loadId;
  const requestId = page._moreRequestId = (page._moreRequestId || 0) + 1;
  safe(page, { moreBusy: true });
  try {
    const result = await options.request(cursor);
    if (page._closed || page._loadId !== loadId || page._moreRequestId !== requestId) return;
    const incoming = options.select ? options.select(result) : result.items;
    const merged = page.data[options.key].slice();
    const positions = new Map(merged.map((item, index) => [item.id, index]));
    (incoming || []).map(options.decorate || (item => item)).forEach(item => {
      if (positions.has(item.id)) merged[positions.get(item.id)] = item;
      else { positions.set(item.id, merged.length); merged.push(item); }
    });
    safe(page, Object.assign({}, options.extra ? options.extra(result) : {}, { [options.key]: merged, nextCursor: result.nextCursor || null }));
  } catch (error) {
    if (!page._closed && page._moreRequestId === requestId) toast(error.message || '加载未完成，请重试');
  } finally {
    if (page._moreRequestId === requestId) safe(page, { moreBusy: false });
  }
}

async function action(page, task) {
  if (page.data.busy) return;
  safe(page, { busy: true });
  try {
    return await task();
  } catch (error) {
    if (!page._closed) {
      if (error.code === 'VERIFICATION_REQUIRED') openVerification();
      else toast(error.message || '操作没有完成，请重试');
    }
  } finally {
    safe(page, { busy: false });
  }
}

function toast(title) { wx.showToast({ title, icon: 'none', duration: 2300 }); }
function confirm(title, content, confirmText) {
  return new Promise(resolve => wx.showModal({ title, content, confirmText: confirmText || '确认', cancelText: '再想想', success: result => resolve(!!result.confirm), fail: () => resolve(false) }));
}
function choose(items) {
  return new Promise(resolve => wx.showActionSheet({ itemList: items, success: result => resolve(result.tapIndex), fail: () => resolve(-1) }));
}
function go(url) {
  if (!product.allowsNavigation(url)) return toast('该页面在当前版本不可用');
  wx.navigateTo({ url });
}
function back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/community/index' }) }); }
function relative(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + '分钟前';
  if (minutes < 1440) return Math.floor(minutes / 60) + '小时前';
  if (minutes < 10080) return Math.floor(minutes / 1440) + '天前';
  const d = new Date(timestamp);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
function avatar(author) {
  const isEditorial = !!author && author.isEditorial === true;
  const pet = !isEditorial && author && author.pet;
  const type = pet && { cat: '猫', dog: '狗', rabbit: '兔子', 'small-mammal': '小型哺乳动物', bird: '鸟', fish: '鱼', reptile: '爬行动物', amphibian: '两栖动物', invertebrate: '无脊椎动物', other: '其他宠物' }[pet.type];
  return Object.assign({}, author || {}, { nickname: author && author.nickname || (isEditorial ? '内容整理账号' : '爱宠邻居'), avatar: author && author.avatar || '/assets/avatar-1.png', isEditorial, accountLabel: '', pet: pet || null, petLabel: pet && pet.name && type ? pet.name + ' · ' + type : '' });
}

function publicSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const result = {};
  ['title', 'publisher', 'author', 'checkedAt'].forEach(key => { if (typeof source[key] === 'string') result[key] = source[key]; });
  if (typeof source.url === 'string') result.url = httpsUrl(source.url);
  return result;
}
function imageCredit(credit) {
  const input = credit && typeof credit === 'object' ? credit : {};
  const result = {};
  // Editorial permission evidence stays in the import manifest, not page data.
  ['imageUrl', 'author', 'licenseName', 'attribution'].forEach(key => { if (typeof input[key] === 'string') result[key] = input[key]; });
  ['originalUrl', 'sourceUrl', 'licenseUrl'].forEach(key => { result[key] = httpsUrl(input[key]); });
  result.modifiedDescription = typeof input.modifiedDescription === 'string' ? input.modifiedDescription : typeof input.changes === 'string' ? input.changes : '';
  const license = (result.licenseName || '').toLowerCase().replace(/[\s-]+/g, '');
  result.requiresAttribution = !/^(?:cc0(?:1\.0)?(?:universal)?|publicdomain(?:mark(?:1\.0)?)?|pd)$/.test(license);
  return result;
}
function post(item) {
  if (contentPolicy.isVideoPost(item)) throw Object.assign(new Error('内容已下架'), { code: 'NOT_FOUND' });
  const visibility = postVisibility.selected(item.visibility);
  const placeDistance = item.place && item.place.active !== false ? nearbyLocation.distanceFor(item.place.point) : null;
  const images = Array.isArray(item.images) ? item.images : [];
  const coverIndex = Number.isInteger(item.coverIndex) && item.coverIndex >= 0 && item.coverIndex < images.length ? item.coverIndex : 0;
  const kind = ['daily', 'question', 'meetup'].includes(item.kind) ? item.kind : 'daily';
  const title = item.title || '';
  const text = item.text || '';
  const source = publicSource(item.source);
  const imageCredits = Array.isArray(item.imageCredits) ? item.imageCredits.map(imageCredit) : [];
  const contentType = ['knowledge', 'photo'].includes(item.contentType) ? item.contentType : '';
  const isEditorialContent = !!source || item.catalogManaged === true || !!(item.author && item.author.isEditorial);
  const linkedEvent = item.event ? Object.assign({}, item.event, {
    timeText: dateText(item.event.startAt),
    statusText: item.event.status === 'cancelled' ? '已取消' : item.event.startAt <= Date.now() ? '已开始' : '去看看',
    petText: { none: '无需带宠', optional: '可带宠物', dog: '需要带犬' }[item.event.petPolicy] || ''
  }) : null;
  return Object.assign({}, item, publication(item), { visibility: visibility.id, visibilityText: visibility.name, author: avatar(item.author), images, title, text, kind, coverIndex, source, contentType, isEditorialContent,
    placeDistance, placeDistanceText: placeDistance ? '距' + placeDistance.referenceLabel + '直线 ' + placeDistance.label : '',
    animalTypes: animalTypes.normalize(item.animalTypes), animalLabels: animalTypes.normalize(item.animalTypes).map(id => animalTypes.TYPES.find(type => type.id === id).name),
    imageCredits, hasRequiredCredits: imageCredits.some(credit => credit.requiresAttribution),
    cover: item.cover || images[coverIndex] || '', topics: contentTopics.normalize(item.topics),
    timeText: isEditorialContent ? '' : relative(item.createdAt), commentCount: item.commentCount || 0,
    likeCount: item.likeCount || 0, isLiked: !!item.isLiked, isBookmarked: !!item.isBookmarked,
    kindText: personalMode ? (isEditorialContent ? (contentType === 'photo' ? '动物影像' : '养宠知识') : '私人记录') : contentType === 'photo' ? '图片分享' : isEditorialContent ? '养宠知识' : { daily: '日常分享', question: '想问问大家', meetup: '一起做点什么' }[kind],
    kindSymbol: { daily: '✦', question: '?', meetup: '↗' }[kind],
    displayTitle: title || text || (personalMode ? '留住这一刻' : '分享了一份可爱'), cardText: text || title || (personalMode ? '留住这一刻' : '分享了一份可爱'),
    event: linkedEvent, eventId: item.eventId || '' });
}
function updatePost(page, item, key) {
  const name = key || 'posts';
  safe(page, { [name]: page.data[name].map(previous => previous.id === item.id ? post(item) : previous) });
}
function dateText(timestamp) {
  const date = new Date(timestamp);
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 周' + week + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}
function event(item) {
  const cancelled = item.status === 'cancelled';
  const started = Date.now() >= item.startAt;
  const ended = Date.now() >= item.endAt;
  const full = item.attendeeCount >= item.capacity;
  const policy = { none: '无需带宠', optional: '可带宠物', dog: '需要带犬' };
  return Object.assign({}, item, {
    cover: item.cover || (item.petPolicy === 'dog' ? '/assets/event-walk.png' : '/assets/event-coffee.png'),
    timeText: dateText(item.startAt), endText: dateText(item.endAt), petText: policy[item.petPolicy] || '可带宠物',
    remaining: Math.max(0, item.capacity - item.attendeeCount), ended, started, cancelled,
    statusText: cancelled ? '已取消' : ended ? '已结束' : started ? '进行中' : item.isJoined ? '已报名' : full ? '名额已满' : '报名中',
    buttonText: cancelled ? '活动已取消' : ended ? '活动已结束' : item.isJoined ? '取消报名' : started ? '报名已截止' : full ? '名额已满' : '免费报名',
    canJoin: !cancelled && !started && !full,
    canCancel: !cancelled && !started && item.isJoined,
    buttonDisabled: cancelled || ended || started || (full && !item.isJoined)
  });
}
function comment(item) { return Object.assign({}, item, { author: avatar(item.author), timeText: relative(item.createdAt) }); }
function message(item) { return Object.assign({}, item, { timeText: relative(item.createdAt), symbol: item.targetType === 'event' ? '◷' : item.targetType === 'post' ? '♡' : '✦' }); }
function preview(images, current) { if (images && images.length) wx.previewImage({ urls: images, current: current || images[0] }); }
async function report(targetType, targetId) {
  const options = ['广告或垃圾信息', '骚扰、攻击或歧视', '不当或危险内容', '其他问题'];
  const selected = await choose(options);
  if (selected < 0) return;
  await api.call('report', { targetType, targetId, reason: options[selected] });
  toast('已提交举报，我们会查看处理');
}
async function block(userId) {
  if (!await confirm('屏蔽这位用户？', '屏蔽后将隐藏对方的帖子和评论。你可以在「我 · 已屏蔽用户」里取消。', '屏蔽')) return false;
  await api.call('blockUser', { userId, block: true });
  toast('已屏蔽');
  return true;
}

module.exports = { personalMode, api, safe, register, load, more, action, toast, confirm, choose, go, back, openVerification, verificationArrived, verificationLeft, relative, post, updatePost, person: avatar, event, comment, message, preview, report, block, dateText, httpsUrl, shareCard, shareTimeline, shareMenu };
