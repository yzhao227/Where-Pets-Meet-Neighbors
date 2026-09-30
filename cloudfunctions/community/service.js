'use strict';

const crypto = require('node:crypto');
const { normalizeRuntimeConfig, policiesFor } = require('./runtime-config');
const { createRateLimiter, isPositiveAction } = require('./rate-limit');
const { createMaintenance } = require('./maintenance');
const { createSocialService } = require('./social-service');
const neighbors = require('./neighbor-profile');
const placeDomain = require('./place-engine');
const placeCatalogue = require('./place-catalogue');
const petData = require('./pets');
const { createPetService } = require('./pet-service');

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new AppError(code, message); };
const idFor = openid => `u_${crypto.createHash('sha256').update(openid).digest('hex').slice(0, 32)}`;
const pair = (a, b) => `${a}__${b}`;
const publicAuthor = user => ({ id: user.id || user._id, nickname: user.nickname || '爱宠邻居', avatar: user.avatar || '',
  ...(user.showPet === true && user.pet ? { pet: { name: user.pet.name, type: user.pet.type } } : {}) });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const countChars = text => Array.from(text).length;
const TOPICS = ['饮食喂养', '行为观察', '健康护理', '居家布置', '户外出行', '成长记录', '治愈瞬间', '陪伴日常'];
const TOPIC_ALIASES = {
  '宠物治愈时刻': '治愈瞬间', '新手养宠': '健康护理', '一起散步': '户外出行',
  '没养宠也能来': '陪伴日常', '宠物友好去处': '户外出行', '养宠经验': '成长记录'
};
const normalizeTopic = value => typeof value === 'string' ? TOPICS.includes(value) ? value : Object.prototype.hasOwnProperty.call(TOPIC_ALIASES, value) ? TOPIC_ALIASES[value] : '' : '';
const normalizeTopics = value => Array.isArray(value) ? [...new Set(value.map(normalizeTopic).filter(Boolean))] : [];
// Cloud functions deploy independently; a contract test keeps this whitelist
// aligned with the mini-program's animal-types module.
const ANIMAL_TYPES = Object.freeze(['cat', 'dog', 'rabbit', 'small-mammal', 'bird', 'fish', 'reptile', 'amphibian', 'invertebrate', 'other']);
const normalizeAnimals = value => Array.isArray(value) ? [...new Set(value.filter(item => ANIMAL_TYPES.includes(item)))] : [];
function postVisibility(value = 'public') {
  if (!['public', 'friends', 'private'].includes(value)) fail('INVALID_INPUT', '请选择公开、仅好友可见或仅自己可见');
  return value;
}
const TERMS_VERSION = '2026-09-29';
const PRIVACY_VERSION = '2026-09-29';
const MESSAGE_CATEGORIES = ['all', 'interactions', 'comments', 'follows', 'system'];
function messageKind(record) { return ['like', 'bookmark', 'follow', 'comment', 'reply', 'system'].includes(record.kind) ? record.kind : record.targetType === 'post' ? 'comment' : 'system'; }
function messageCategory(record) { return ({ like: 'interactions', bookmark: 'interactions', follow: 'follows', comment: 'comments', reply: 'comments' })[messageKind(record)] || 'system'; }
function messageCounts(records) {
  const categoryUnread = { interactions: 0, comments: 0, follows: 0, system: 0 };
  records.forEach(record => { if (!record.isRead) categoryUnread[messageCategory(record)] += 1; });
  return { unreadCount: Object.values(categoryUnread).reduce((sum, count) => sum + count, 0), categoryUnread };
}
function messagePage(records, payload, matches = () => true) {
  const category = payload.category === undefined ? 'all' : payload.category;
  if (!MESSAGE_CATEGORIES.includes(category)) fail('INVALID_INPUT', '请选择有效的消息分类');
  const limit = pageSize(payload); let anchor;
  if (payload.cursor !== undefined && payload.cursor !== null && payload.cursor !== '') {
    const match = typeof payload.cursor === 'string' && /^m_(\d{1,16})_([A-Za-z0-9_-]{1,120})$/.exec(payload.cursor);
    if (match && Number.isSafeInteger(Number(match[1]))) anchor = { createdAt: Number(match[1]), _id: match[2] };
    else anchor = records.find(record => record._id === payload.cursor);
    if (!anchor) fail('INVALID_INPUT', '消息分页位置无效，请刷新后重试');
  }
  const selected = records.filter(record => (category === 'all' || messageCategory(record) === category) && matches(record) && (!anchor || record.createdAt < anchor.createdAt || record.createdAt === anchor.createdAt && record._id < anchor._id))
    .sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : a._id > b._id ? -1 : 0));
  const items = selected.slice(0, limit); const last = items[items.length - 1];
  return { items, ...(selected.length > limit ? { nextCursor: 'm_' + last.createdAt + '_' + last._id } : {}) };
}

function string(value, name, min, max) {
  if (typeof value !== 'string') fail('INVALID_INPUT', `${name}格式不正确`);
  const result = value.trim();
  if (countChars(result) < min || countChars(result) > max) fail('INVALID_INPUT', `${name}需要 ${min}–${max} 个字`);
  return result;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(value)) fail('INVALID_INPUT', '记录编号不正确');
  return value;
}
function boolean(value, name = '选项') {
  if (typeof value !== 'boolean') fail('INVALID_INPUT', `${name}格式不正确`);
  return value;
}
function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_INPUT', `${name}需要是 ${min}–${max} 的整数`);
  return value;
}
function pageSize(payload) { return payload.limit === undefined ? 20 : integer(payload.limit, '每页数量', 1, 50); }
function cursor(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return identifier(value);
}
function animalList(value, name, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some(item => !ANIMAL_TYPES.includes(item))) fail('INVALID_INPUT', name + '最多选择 ' + max + ' 个有效动物种类');
  return [...new Set(value)];
}
function animalFilters(payload) {
  const selected = payload.animalType === undefined ? '' : payload.animalType;
  if (typeof selected !== 'string' || selected && selected !== 'unclassified' && !ANIMAL_TYPES.includes(selected)) fail('INVALID_INPUT', '请选择有效的动物分类');
  const excluded = animalList(payload.excludedAnimalTypes, '屏蔽种类', ANIMAL_TYPES.length);
  return value => {
    const types = normalizeAnimals(value);
    return (!selected || (selected === 'unclassified' ? !types.length : types.includes(selected))) && !types.some(type => excluded.includes(type));
  };
}
function videoMetadata(value) {
  if (!object(value) || !Number.isFinite(value.durationSeconds) || value.durationSeconds < 1 || value.durationSeconds > 60 ||
    !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 20 * 1024 * 1024) fail('INVALID_VIDEO', '视频需为 1–60 秒且不超过 20 MB');
  const result = { durationSeconds: value.durationSeconds, bytes: value.bytes };
  for (const field of ['width', 'height']) if (value[field] !== undefined) result[field] = integer(value[field], '视频尺寸', 1, 16384);
  return result;
}
function publicVideo(value) {
  if (!object(value) || typeof value.url !== 'string' || !value.url) return null;
  return { url: value.url, ...(typeof value.poster === 'string' && value.poster ? { poster: value.poster } : {}),
    durationSeconds: value.durationSeconds, ...(value.width ? { width: value.width } : {}), ...(value.height ? { height: value.height } : {}) };
}

function navigationPoint(value) {
  if (!value || value.coordinateSystem !== 'gcj02' || !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
    value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180) return null;
  return { latitude: value.latitude, longitude: value.longitude, coordinateSystem: 'gcj02' };
}
function navigationDestination(place) {
  if (!place || !['place', 'event', 'exhibition'].includes(place.type) || place.active === false || place.published === false || place.deleted === true ||
    place.public === false || place.visibility && place.visibility !== 'public' ||
    ['draft', 'unpublished', 'withdrawn', 'deleted', 'private', 'hidden', 'inactive'].includes(place.status)) fail('NOT_FOUND', '这条地点信息已下架或不存在');
  const title = typeof place.title === 'string' ? place.title : '';
  const venue = ['event', 'exhibition'].includes(place.type) && typeof place.venue === 'string' ? place.venue.trim() : '';
  // Event timing/availability is separate from whether its venue is public.
  return { title, name: venue || title, address: typeof place.address === 'string' ? place.address : '',
    city: typeof place.city === 'string' ? place.city : '', point: navigationPoint(place.point) };
}

function createService({ repository: repo, now = Date.now, randomId = () => crypto.randomBytes(12).toString('hex'),
  adminOpenids = [], moderateText = async () => {}, storage = null, phoneVerifier = null, mapGeocoder = null, runtimeConfig = {} }) {
  const admins = new Set(adminOpenids);
  const uid = () => randomId();
  const orderedId = () => `${String(now()).padStart(13, '0')}_${uid()}`;
  const placeEngine = placeDomain.createPlaceEngine({ catalogue: placeCatalogue, now, newId: orderedId, fail });
  const placeRun = (operation, tx = repo) => placeDomain.drive(operation, {
    get: (table, id) => tx.get(table, id), set: (table, id, value) => tx.set(table, id, value), remove: (table, id) => tx.remove(table, id),
    all: (table, filters) => allRecords(table, filters),
    clearAttribution: (id, userId) => repo.transaction(async transaction => {
      const current = await transaction.get('place_records', id);
      if (current && current.updatedBy === userId) await transaction.set('place_records', id, { ...current, updatedBy: '' });
    }),
    cleanupSubmission: (id, userId) => repo.transaction(async transaction => {
      const current = await transaction.get('nearby_submissions', id);
      if (!current || current.userId !== userId) return;
      if (current.publishedId) await transaction.set('nearby_submissions', id, placeDomain.anonymousSubmission(current));
      else await transaction.remove('nearby_submissions', id);
    })
  });
  const runtime = normalizeRuntimeConfig(runtimeConfig);
  const rateLimiter = createRateLimiter({ repository: repo, limits: runtime.rateLimits, now, fail });
  const navigationLimiter = createRateLimiter({ repository: repo, limits: { getPlaceNavigation: { limit: 20, windowMs: 60000 } }, now, fail });
  const phoneEnabled = !!(phoneVerifier && phoneVerifier.enabled === true && typeof phoneVerifier.verifyCode === 'function');
  async function verificationFor(tx, userId) {
    const identity = await tx.get('identities', userId);
    if (!identity || identity.status !== 'phone_verified' || !identity.phoneKey) return { status: 'unverified' };
    const claim = await tx.get('phone_claims', identity.phoneKey);
    if (!claim || claim.userId !== userId) return { status: 'unverified' };
    return { status: 'phone_verified', maskedPhone: identity.maskedPhone };
  }
  const userProjection = async (record, isAdmin, committed = false) => ({ ...publicAuthor(record), area: record.area || '', bio: record.bio || '', pet: record.pet || null, ...await petService.projectPets(record, record._id || record.id, committed),
    publicProfile: record.publicProfile === true, showPet: record.showPet === true, verification: await verificationFor(repo, record._id || record.id), isAdmin, ...neighbors.settings(record) });

  async function getSettings() {
    return (await repo.get('settings', 'main')) || { city: '我的城市', areas: [], contact: '请联系本小程序运营者' };
  }
  async function requireUser(tx, userId, lifecycleId) {
    const user = await tx.get('users', userId);
    if (!user || user.status !== 'active' || lifecycleId && user.lifecycleId !== lifecycleId) fail('ACCOUNT_UNAVAILABLE', '账号状态已变化，请重新进入小程序');
    return user;
  }
  async function requireVerifiedUser(tx, userId, lifecycleId) {
    const user = await requireUser(tx, userId, lifecycleId);
    if ((await verificationFor(tx, userId)).status !== 'phone_verified') fail('VERIFICATION_REQUIRED', '完成手机号核验后，就可以发布和参与互动了');
    return user;
  }
  async function requireDocument(tx, collection, id) {
    const record = await tx.get(collection, id);
    if (!record || record.deleted) fail('NOT_FOUND', '内容不存在或已移除');
    return record;
  }
  async function ensureVisible(tx, viewerId, authorId) {
    if (!authorId || viewerId === authorId) return;
    const left = await tx.get('blocks', pair(viewerId, authorId));
    const right = await tx.get('blocks', pair(authorId, viewerId));
    if (left || right) fail('NOT_FOUND', '内容不存在或不可访问');
  }
  async function blockedSet(userId) {
    const all = new Set();
    for (const field of ['fromId', 'toId']) {
      let after;
      for (;;) {
        const filters = { [field]: userId, ...(after ? { _id: { gt: after } } : {}) };
        const records = await repo.find('blocks', filters, { orderBy: '_id', limit: 100 });
        records.forEach(record => all.add(field === 'fromId' ? record.toId : record.fromId));
        if (records.length < 100) break;
        after = records[records.length - 1]._id;
      }
    }
    return all;
  }
  async function canReadPost(record, viewerId, access = repo, excluded) {
    if (!record || record.deleted) return false;
    if (record.authorId === viewerId) return true;
    const visibility = record.visibility === undefined ? 'public' : record.visibility;
    if (visibility !== 'public' && visibility !== 'friends') return false;
    if (excluded ? excluded.has(record.authorId) : await access.get('blocks', pair(viewerId, record.authorId)) || await access.get('blocks', pair(record.authorId, viewerId))) return false;
    return visibility === 'public' || social.areFriends(access, viewerId, record.authorId);
  }
  async function requirePost(access, viewerId, id) {
    const record = await requireDocument(access, 'posts', id);
    if (!await canReadPost(record, viewerId, access)) fail('NOT_FOUND', '内容不存在或不可访问');
    return record;
  }
  async function postMedia(urls) {
    const cloudFiles = [...new Set(urls.filter(url => typeof url === 'string' && url.startsWith('cloud://')))];
    if (!cloudFiles.length) return url => url;
    if (!storage || typeof storage.resolvePostMedia !== 'function') fail('MEDIA_UNAVAILABLE', '图片或视频暂时无法加载，请稍后重试');
    const signed = await storage.resolvePostMedia(cloudFiles);
    if (cloudFiles.some(file => !signed || typeof signed[file] !== 'string' || !signed[file].startsWith('https://'))) fail('MEDIA_UNAVAILABLE', '图片或视频暂时无法加载，请稍后重试');
    return url => signed[url] || url;
  }
  function requirePrivateMedia(visibility, hasMedia) {
    if (visibility !== 'public' && hasMedia && (!storage || storage.privateMediaEnabled !== true)) fail('PRIVATE_MEDIA_UNAVAILABLE', '私密图片和视频的存储权限尚未配置，请稍后重试或先分享文字');
  }
  async function author(authorId) {
    const record = await repo.get('users', authorId);
    return record && record.status === 'active' ? publicAuthor(record) : { id: authorId, nickname: '已注销用户', avatar: '' };
  }
  async function circleProjection(record, viewerId) {
    const icon = { leaf: '🌿', cat: '🐱', dog: '🐶' }[record.icon] || record.icon || '🌿';
    return { id: record._id, name: record.name, description: record.description,
      memberCount: record.memberCount || 0, isJoined: !!await repo.get('memberships', pair(viewerId, record._id)),
      accent: record.accent || '#73957c', icon };
  }
  async function postProjection(record, viewerId, committed = false) {
    if (!await canReadPost(record, viewerId)) fail('NOT_FOUND', '内容不存在或不可访问');
    const circle = await repo.get('circles', record.circleId);
    const rawImages = record.images || [];
    const rawVideo = publicVideo(record.video);
    const media = rawImages.concat(rawVideo ? [rawVideo.url, rawVideo.poster] : []);
    let resolve;
    try { resolve = await postMedia(media); }
    catch (error) { if (!committed || error.code !== 'MEDIA_UNAVAILABLE') throw error; }
    // A signing outage must not turn a committed publish/scope change into a
    // failed mutation that invites a duplicate. Never fall back to raw file IDs.
    const images = resolve ? rawImages.map(resolve) : [];
    const video = resolve && rawVideo && { ...rawVideo, url: resolve(rawVideo.url), ...(rawVideo.poster ? { poster: resolve(rawVideo.poster) } : {}) };
    const coverIndex = Number.isInteger(record.coverIndex) && record.coverIndex >= 0 && record.coverIndex < images.length ? record.coverIndex : 0;
    let event = null;
    if (record.eventId) {
      const linked = await repo.get('events', record.eventId);
      if (linked && !linked.deleted) {
        try {
          await ensureVisible(repo, viewerId, linked.hostId);
          event = { id: linked._id, title: linked.title, startAt: linked.startAt, location: linked.location, status: linked.status, petPolicy: linked.petPolicy };
        } catch (error) { if (!(error instanceof AppError)) throw error; }
      }
    }
    const result = { id: record._id, author: await author(record.authorId), circle: { id: record.circleId, name: circle ? circle.name : '小圈子' },
      text: record.text, title: record.title || '', kind: record.kind || 'daily', topics: normalizeTopics(record.topics), animalTypes: normalizeAnimals(record.animalTypes),
      images, ...(video ? { video, contentType: 'video' } : {}), coverIndex, cover: video ? video.poster || '' : images[coverIndex] || '', eventId: event ? event.id : '', event, createdAt: record.createdAt,
      place: await placeRun(placeEngine.postPlace(record)), placeId: record.placeId || '', visitId: record.authorId === viewerId ? record.visitId || '' : '',
      likeCount: record.likeCount || 0, isLiked: !!await repo.get('likes', pair(viewerId, record._id)),
      isBookmarked: !!await repo.get('bookmarks', pair(viewerId, record._id)),
      commentCount: record.commentCount || 0, isMine: record.authorId === viewerId };
    // Recheck after media signing and projection I/O, including changed friendships.
    const current = await requirePost(repo, viewerId, record._id);
    return { ...result, ...(!resolve ? { mediaUnavailable: true } : media.some(url => typeof url === 'string' && url.startsWith('cloud://')) ? { mediaSigned: true } : {}), visibility: current.visibility === undefined ? 'public' : ['public', 'friends'].includes(current.visibility) ? current.visibility : 'private' };
  }
  async function postResult(id, ctx, committed = false) {
    const record = await requirePost(repo, ctx.userId, id);
    return { post: await postProjection(record, ctx.userId, committed) };
  }
  async function commentProjection(record, viewerId) {
    let replyToName = '';
    if (record.replyToAuthorId) {
      try {
        await ensureVisible(repo, viewerId, record.replyToAuthorId);
        const replyAuthor = await repo.get('users', record.replyToAuthorId);
        if (replyAuthor && replyAuthor.status === 'active') replyToName = replyAuthor.nickname;
      } catch (error) { if (!(error instanceof AppError)) throw error; }
    }
    return { id: record._id, author: await author(record.authorId), text: record.text, createdAt: record.createdAt,
      ...(replyToName ? { replyToName } : {}), isMine: record.authorId === viewerId };
  }
  async function eventProjection(record, viewerId) {
    const host = record.hostId ? await author(record.hostId) : { nickname: '已注销用户' };
    return { id: record._id, title: record.title, description: record.description, location: record.location,
      startAt: record.startAt, endAt: record.endAt, capacity: record.capacity, attendeeCount: (record.attendeeIds || []).length,
      petPolicy: record.petPolicy, circleId: record.circleId, hostName: host.nickname,
      cover: record.cover || '', status: record.status, isJoined: (record.attendeeIds || []).includes(viewerId),
      isMine: record.hostId === viewerId, ...(record.cancelReason ? { cancelReason: record.cancelReason } : {}) };
  }
  async function notify(tx, toId, title, text, targetType, targetId, actorId, kind = 'system') {
    if (toId === actorId) return;
    const receiver = await tx.get('users', toId);
    if (!receiver || receiver.status !== 'active') return;
    if (targetType === 'post' && !await canReadPost(await tx.get('posts', targetId), toId, tx)) return;
    if (actorId) {
      const actor = await tx.get('users', actorId);
      if (!actor || actor.status !== 'active' || await tx.get('blocks', pair(toId, actorId)) || await tx.get('blocks', pair(actorId, toId))) return;
    }
    // A social action notifies once even after it is undone and repeated. Existing read state/time survive.
    const id = ['like', 'bookmark', 'follow'].includes(kind) ? 'notice_' + crypto.createHash('sha256').update(JSON.stringify([toId, actorId, kind, targetType, targetId])).digest('hex').slice(0, 48) : orderedId();
    if (await tx.get('messages', id)) return;
    await tx.set('messages', id, { toId, title, text, targetType, targetId, actorId: actorId || '', kind, isRead: false, createdAt: now() });
  }
  async function queueEventNotices(tx, recipients, title, text, eventId, actorId) {
    if (!recipients.length) return;
    const id = orderedId();
    await tx.set('outbox', id, { recipientIds: [...new Set(recipients)], title, text,
      targetType: 'event', targetId: eventId, actorId: actorId || '', kind: 'system', createdAt: now() });
  }
  async function flushOutbox(limit = 3) {
    const jobs = await repo.find('outbox', {}, { orderBy: '_id', limit: Math.max(1, Math.min(3, limit)) });
    let processed = 0;
    for (const job of jobs) {
      // Each recipient has a deterministic message ID: concurrent retries cannot duplicate it.
      // Fan-out happens after the event transaction, avoiding a 100-person transaction.
      for (let offset = 0; offset < job.recipientIds.length; offset += 10) {
        const results = await Promise.allSettled(job.recipientIds.slice(offset, offset + 10).map(toId => repo.transaction(async tx => {
          const currentJob = await tx.get('outbox', job._id);
          if (!currentJob || !currentJob.recipientIds.includes(toId)) return;
          const user = await tx.get('users', toId); const id = pair(job._id, toId);
          if (!user || user.status !== 'active' || toId === job.actorId || await tx.get('messages', id)) return;
          if (job.actorId) {
            const actor = await tx.get('users', job.actorId);
            if (!actor || actor.status !== 'active' || await tx.get('blocks', pair(toId, job.actorId)) || await tx.get('blocks', pair(job.actorId, toId))) return;
          }
          await tx.set('messages', id, { toId, title: job.title, text: job.text, targetType: job.targetType,
            targetId: job.targetId, actorId: job.actorId, kind: 'system', isRead: false, createdAt: job.createdAt });
        })));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      }
      await repo.remove('outbox', job._id);
      processed++;
    }
    return processed;
  }
  async function authenticated(openid, action) {
    if (!openid || typeof openid !== 'string') fail('UNAUTHENTICATED', '请通过微信小程序访问');
    const userId = idFor(openid);
    return repo.transaction(async tx => {
      let user = await tx.get('users', userId);
      if (user && user.status === 'deleting' && action !== 'deleteAccount') fail('ACCOUNT_UNAVAILABLE', '账号清理尚未完成，请重试注销');
      if (!user || user.status === 'deleted') {
        if (user && action !== 'bootstrap') fail('ACCOUNT_UNAVAILABLE', '请重新进入小程序');
        user = { nickname: '爱宠邻居', avatar: '', area: '', bio: '', pet: null, publicProfile: false, showPet: false, neighborVisible: false, neighborAreaId: '', residenceSharing: false, residenceCell: null, residenceUpdatedAt: null, followerCount: 0, followingCount: 0,
          lifecycleId: uid(), status: 'active', createdAt: now(), updatedAt: now() };
        await tx.set('users', userId, user);
      } else if (!user.lifecycleId) {
        user = { ...user, lifecycleId: uid() };
        await tx.set('users', userId, user);
      }
      return { userId, lifecycleId: user.lifecycleId, isAdmin: admins.has(openid) };
    });
  }
  async function scanVisible(collection, filters, payload, excluded, authorField = 'authorId', matches = () => true) {
    const limit = pageSize(payload);
    let before = cursor(payload.cursor);
    const items = [];
    let consumed = before;
    let hasMore = false;
    // Bounded scan: a cursor is returned even if a whole page was hidden by blocking.
    for (let batch = 0; batch < 5 && items.length < limit; batch++) {
      const records = await repo.find(collection, { ...filters, ...(before ? { _id: { lt: before } } : {}) },
        { orderBy: '_id', direction: 'desc', limit: Math.min(50, limit * 2) });
      if (!records.length) { hasMore = false; break; }
      hasMore = records.length === Math.min(50, limit * 2);
      for (let i = 0; i < records.length; i++) {
        const record = records[i]; consumed = record._id;
        if (!excluded.has(record[authorField]) && await matches(record)) items.push(record);
        if (items.length === limit) { hasMore = hasMore || i < records.length - 1; break; }
      }
      before = consumed;
      if (!hasMore) break;
    }
    return { items, ...(hasMore && consumed ? { nextCursor: consumed } : {}) };
  }
  async function commentsFor(targetType, targetId, userId, payload = {}) {
    const page = await scanVisible('comments', { targetType, targetId, deleted: false }, payload, await blockedSet(userId));
    return { ...page, items: await Promise.all(page.items.map(record => commentProjection(record, userId))) };
  }
  async function allRecords(collection, filters) {
    const records = []; let after;
    for (;;) {
      const batch = await repo.find(collection, { ...filters, ...(after ? { _id: { gt: after } } : {}) }, { orderBy: '_id', limit: 100 });
      records.push(...batch);
      if (batch.length < 100) return records;
      after = batch[batch.length - 1]._id;
    }
  }
  async function messageVisible(record, userId, access = repo, excluded) {
    if (record.toId !== userId) return false;
    const blocked = async otherId => otherId && otherId !== userId && (excluded ? excluded.has(otherId) : !!(await access.get('blocks', pair(userId, otherId)) || await access.get('blocks', pair(otherId, userId))));
    if (await blocked(record.actorId)) return false;
    const collection = record.targetType === 'post' ? 'posts' : record.targetType === 'event' ? 'events' : '';
    const target = collection && record.targetId ? await access.get(collection, record.targetId) : null;
    if (record.targetType === 'post' && target && !await canReadPost(target, userId, access, excluded)) return false;
    const ownerId = target && (target.authorId || target.hostId) || (record.targetType === 'user' ? record.targetId : '');
    return !await blocked(ownerId);
  }
  async function visibleMessages(userId) {
    const excluded = await blockedSet(userId);
    const records = await allRecords('messages', { toId: userId });
    const cache = new Map();
    const access = { get(collection, id) { const key = collection + ':' + id; if (!cache.has(key)) cache.set(key, repo.get(collection, id)); return cache.get(key); } };
    const visible = [];
    for (const record of records) if (await messageVisible(record, userId, access, excluded)) visible.push(record);
    return visible;
  }
  async function messageProjection(record, viewerId) {
    if (!await messageVisible(record, viewerId)) return null;
    const actor = record.actorId ? await repo.get('users', record.actorId) : null;
    const post = record.targetType === 'post' && record.targetId ? await repo.get('posts', record.targetId) : null;
    const images = post && post.images || [];
    const coverIndex = post && Number.isInteger(post.coverIndex) && post.coverIndex >= 0 && post.coverIndex < images.length ? post.coverIndex : 0;
    const rawCover = post && !post.deleted ? post.video ? post.video.poster || '' : images[coverIndex] || '' : '';
    const resolve = await postMedia([rawCover]);
    if (!await messageVisible(record, viewerId)) return null;
    const cover = resolve(rawCover);
    return { id: record._id, title: record.title, text: record.text, createdAt: record.createdAt, isRead: !!record.isRead,
      targetType: record.targetType, targetId: record.targetId, kind: messageKind(record), category: messageCategory(record),
      ...(actor && actor.status === 'active' ? { actor: publicAuthor(actor) } : {}), ...(cover ? { cover } : {}) };
  }
  async function removeLike(tx, id) {
    const relation = await tx.get('likes', id); if (!relation) return;
    const post = await tx.get('posts', relation.postId);
    if (post) await tx.set('posts', post._id, { ...post, likeCount: Math.max(0, (post.likeCount || 0) - 1) });
    await tx.remove('likes', id);
  }
  async function removeFollow(tx, fromId, toId) {
    const id = pair(fromId, toId); const relation = await tx.get('follows', id); if (!relation) return;
    const from = await tx.get('users', fromId); const to = await tx.get('users', toId);
    if (from) await tx.set('users', fromId, { ...from, followingCount: Math.max(0, (from.followingCount || 0) - 1) });
    if (to) await tx.set('users', toId, { ...to, followerCount: Math.max(0, (to.followerCount || 0) - 1) });
    await tx.remove('follows', id);
  }
  async function clearPostReactions(postId) {
    for (const collection of ['likes', 'bookmarks']) {
      for (const relation of await allRecords(collection, { postId })) await repo.remove(collection, relation._id);
    }
  }
  async function clearPostNotices(postId) {
    for (const message of await allRecords('messages', { targetType: 'post', targetId: postId })) await repo.remove('messages', message._id);
  }
  function validateEvent(payload) {
    const data = { title: string(payload.title, '活动名称', 1, 60), description: string(payload.description, '活动介绍', 1, 1000),
      location: string(payload.location, '活动地点', 1, 120), startAt: integer(payload.startAt, '开始时间', 1, 8640000000000000),
      endAt: integer(payload.endAt, '结束时间', 1, 8640000000000000), capacity: integer(payload.capacity, '人数', 2, 100),
      circleId: identifier(payload.circleId), petPolicy: payload.petPolicy };
    if (!['none', 'optional', 'dog'].includes(data.petPolicy)) fail('INVALID_INPUT', '请选择带宠要求');
    if (data.startAt <= now() || data.endAt <= data.startAt) fail('INVALID_INPUT', '活动开始时间需在未来，结束时间需晚于开始时间');
    return data;
  }
  async function cleanPost(id, userId, isAdmin, lifecycleId) {
    let images = [];
    await repo.transaction(async tx => {
      await requireUser(tx, userId, lifecycleId);
      const post = await tx.get('posts', id);
      if (!post) fail('NOT_FOUND', '内容不存在或已移除');
      if (post.authorId !== userId && !isAdmin) fail('FORBIDDEN', '只能删除自己的内容');
      await placeRun(placeEngine.unlinkPost(post), tx);
      images = (post.images || []).concat(post.video && post.video.url ? [post.video.url] : []);
      await tx.set('posts', id, { ...post, deleted: true, text: '', title: '', topics: [], animalTypes: [], images: [], video: null, eventId: '', placeId: '', visitId: '', coverIndex: 0, likeCount: 0, deletedAt: now() });
    });
    for (const comment of await allRecords('comments', { targetType: 'post', targetId: id })) await repo.remove('comments', comment._id);
    await clearPostReactions(id);
    await clearPostNotices(id);
    if (storage && images.length) await storage.remove(images).catch(() => {});
  }
  function uploadResult(ticket) {
    if (ticket.status === 'complete') return { status: 'complete', ticketId: ticket._id, fileId: ticket.fileId,
      ...(ticket.mediaType === 'video' ? { mediaType: 'video', video: publicVideo(ticket.video) } : {}) };
    if (['rejected', 'expired', 'cleanup'].includes(ticket.status)) return { status: ticket.status === 'cleanup' ? 'expired' : ticket.status,
      ticketId: ticket._id, message: ticket.reviewMessage || '图片未能完成审核，请重新选择' };
    return { status: 'pending', ticketId: ticket._id };
  }

  const social = createSocialService({ repository: repo, now, fail, requireUser, requireVerifiedUser, verificationFor, moderateText, allRecords });
  const petService = createPetService({ repository: repo, now, uid, fail, requireUser, requireVerifiedUser, moderateText, storage, allRecords, rateLimiter, resolveMedia: postMedia });
  const handlers = {
    async getPlaceNavigation(payload, ctx) {
      if (Object.keys(payload).some(key => key !== 'id')) fail('INVALID_INPUT', '导航仅接受公开地点编号');
      const id = identifier(payload.id);
      const readDestination = async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId);
        const result = await placeRun(placeEngine.execute('getPlace', { id }, ctx), tx);
        return navigationDestination(result.place);
      };
      const destination = await repo.transaction(readDestination);
      const response = (value, point, resolvedFrom) => ({ point, name: value.name, address: value.address, resolvedFrom });
      if (destination.point) return response(destination, destination.point, 'catalogue');
      if (!mapGeocoder || mapGeocoder.enabled !== true || typeof mapGeocoder.geocode !== 'function') fail('NAVIGATION_UNAVAILABLE', '暂时无法获取该地点的导航位置，请稍后重试');
      await navigationLimiter.consume(ctx.userId, 'getPlaceNavigation', ctx.lifecycleId);
      let point;
      try { point = navigationPoint(await mapGeocoder.geocode({ address: destination.address, city: destination.city })); }
      catch (_) { fail('NAVIGATION_UNAVAILABLE', '暂时无法获取该地点的导航位置，请稍后重试'); }
      if (!point) fail('NAVIGATION_UNAVAILABLE', '暂时无法获取该地点的导航位置，请稍后重试');
      // Geocoding is an external async operation. The account and public record
      // must still describe the same destination before coordinates are released.
      return repo.transaction(async tx => {
        const current = await readDestination(tx);
        if (JSON.stringify(current) !== JSON.stringify(destination)) fail('NAVIGATION_UNAVAILABLE', '地点信息已更新，请刷新后重新导航');
        return response(current, point, 'address');
      });
    },
    ...Object.fromEntries(placeDomain.ACTIONS.map(action => [action, async (payload, ctx) => {
      if (!placeDomain.WRITES.includes(action)) return placeRun(placeEngine.execute(action, payload, ctx));
      if (['submitNearbySubmission', 'reviewNearbySubmission', 'unpublishNearbySubmission'].includes(action)) {
        const content = await placeRun(placeEngine.submissionModeration(action, payload, ctx));
        if (content) await moderateText(content, ctx.openid);
      }
      if (action === 'savePlace' || action === 'submitPlaceCorrection') await moderateText([payload.title, payload.description, payload.petPolicyText, payload.text].filter(Boolean).join('\n'), ctx.openid);
      return repo.transaction(async tx => {
        await (placeDomain.VERIFIED.includes(action) || action === 'bookmarkPlace' && payload.bookmark === true ? requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId) : requireUser(tx, ctx.userId, ctx.lifecycleId));
        return placeRun(placeEngine.execute(action, payload, ctx), tx);
      });
    }])),
    ...social.handlers,
    ...petService.handlers,
    async bootstrap(payload, ctx) {
      const settings = await getSettings();
      const circles = await handlers.listCircles({}, ctx);
      const posts = await allRecords('posts', { authorId: ctx.userId, deleted: false });
      const registrations = await allRecords('registrations', { userId: ctx.userId });
      const bookmarks = [];
      for (const bookmark of await allRecords('bookmarks', { userId: ctx.userId })) if (await canReadPost(await repo.get('posts', bookmark.postId), ctx.userId)) bookmarks.push(bookmark);
      const follows = await allRecords('follows', { fromId: ctx.userId });
      return { mode: 'cloud', user: await userProjection(await repo.get('users', ctx.userId), ctx.isAdmin),
        registration: { termsVersion: runtime.termsVersion, privacyVersion: runtime.privacyVersion, phoneEnabled, policyConfigured: runtime.policyConfigured },
        settings: { city: settings.city, areas: settings.areas, contact: settings.contact }, circles: circles.items,
        stats: { postCount: posts.length, joinedCircleCount: circles.items.filter(circle => circle.isJoined).length, joinedEventCount: registrations.length,
          bookmarkCount: bookmarks.length, followingCount: follows.length } };
    },
    async verifyPhone(payload, ctx) {
      if (Object.keys(payload).some(key => !['code', 'consent'].includes(key))) fail('INVALID_INPUT', '请通过微信手机号授权完成核验');
      const code = string(payload.code, '微信授权凭证', 1, 256);
      const consent = payload.consent;
      if (object(consent) && Object.keys(consent).some(key => !['accepted', 'termsVersion', 'privacyVersion'].includes(key))) fail('INVALID_INPUT', '同意记录格式不正确');
      if (!object(consent) || consent.accepted !== true || consent.termsVersion !== runtime.termsVersion || consent.privacyVersion !== runtime.privacyVersion) {
        fail('CONSENT_REQUIRED', '请阅读并同意当前版本的用户协议与隐私政策');
      }
      if (!runtime.policyConfigured) fail('POLICY_NOT_CONFIGURED', '正式运营资料与隐私政策尚未确认，请联系运营者');
      if ((await verificationFor(repo, ctx.userId)).status === 'phone_verified') {
        return { user: await userProjection(await repo.get('users', ctx.userId), ctx.isAdmin) };
      }
      if (!phoneEnabled) fail('PHONE_UNAVAILABLE', '手机号核验尚未配置，请联系运营者');
      await rateLimiter.consume(ctx.userId, 'verifyPhone', ctx.lifecycleId);
      let verified;
      try { verified = await phoneVerifier.verifyCode(code); }
      catch (error) {
        if (error instanceof AppError) throw error;
        fail('PHONE_VERIFICATION_FAILED', '微信手机号核验未成功，请重新授权后重试');
      }
      if (!verified || !/^ph_[a-f0-9]{64}$/.test(verified.phoneKey) || typeof verified.maskedPhone !== 'string' || verified.maskedPhone.length > 40 || !verified.maskedPhone.includes('*')) {
        fail('PHONE_VERIFICATION_FAILED', '手机号核验结果不完整，请联系运营者');
      }
      await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId);
        // Different one-time codes may race. First completed binding wins; there is
        // deliberately no account phone-change API in this version.
        if ((await verificationFor(tx, ctx.userId)).status === 'phone_verified') return;
        const existingClaim = await tx.get('phone_claims', verified.phoneKey);
        if (existingClaim && existingClaim.userId !== ctx.userId) {
          const owner = await tx.get('users', existingClaim.userId);
          if (owner && owner.status !== 'deleted') fail('PHONE_ALREADY_IN_USE', '这个手机号已关联其他账号，请联系运营者');
          const staleIdentity = await tx.get('identities', existingClaim.userId);
          if (staleIdentity && staleIdentity.phoneKey === verified.phoneKey) await tx.remove('identities', existingClaim.userId);
        }
        const previous = await tx.get('identities', ctx.userId);
        if (previous && previous.phoneKey && previous.phoneKey !== verified.phoneKey) {
          const oldClaim = await tx.get('phone_claims', previous.phoneKey);
          if (oldClaim && oldClaim.userId === ctx.userId) await tx.remove('phone_claims', previous.phoneKey);
        }
        await tx.set('phone_claims', verified.phoneKey, { userId: ctx.userId, claimedAt: now() });
        await tx.set('identities', ctx.userId, { userId: ctx.userId, status: 'phone_verified', method: 'wechat_phone', phoneKey: verified.phoneKey,
          maskedPhone: verified.maskedPhone, termsVersion: runtime.termsVersion, privacyVersion: runtime.privacyVersion, consentedAt: now(), verifiedAt: now() });
      });
      return { user: await userProjection(await repo.get('users', ctx.userId), ctx.isAdmin) };
    },
    async getPolicies() { return policiesFor(runtime); },
    async getHealth(payload, ctx) {
      if (!ctx.isAdmin) fail('FORBIDDEN', '只有运营者可以查看运行状态');
      const queues = await Promise.all([
        repo.find('outbox', {}, { limit: 100 }),
        repo.find('uploads', { status: { in: ['pending', 'processing', 'cleanup'] } }, { limit: 100 }),
        repo.find('rate_limits', {}, { limit: 100 })
      ]);
      const maintenance = await repo.get('settings', 'maintenance') || {};
      return { mode: 'cloud', policyConfigured: runtime.policyConfigured, phoneEnabled, uploadsEnabled: !!(storage && storage.enabled),
        maintenanceEnabled: runtime.maintenanceEnabled, pendingNotifications: queues[0].length, pendingUploads: queues[1].length,
        rateLimitRecords: queues[2].length, countsLimited: queues.some(queue => queue.length === 100),
        maintenance: { lastRunAt: maintenance.lastRunAt || null, lastSuccessAt: maintenance.lastSuccessAt || null, lastErrorCode: maintenance.lastErrorCode || null } };
    },
    async listCircles(payload, ctx) {
      const records = await repo.find('circles', { active: true }, { orderBy: 'sort', limit: 50 });
      return { items: await Promise.all(records.map(record => circleProjection(record, ctx.userId))) };
    },
    async getCircle(payload, ctx) {
      const id = identifier(payload.id);
      const record = await requireDocument(repo, 'circles', id);
      const posts = await handlers.listPosts({ ...payload, circleId: id }, ctx);
      return { circle: await circleProjection(record, ctx.userId), posts: posts.items, ...(posts.nextCursor ? { nextCursor: posts.nextCursor } : {}) };
    },
    async joinCircle(payload, ctx) {
      const id = identifier(payload.id); const join = boolean(payload.join);
      await repo.transaction(async tx => {
        await (join ? requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId) : requireUser(tx, ctx.userId, ctx.lifecycleId));
        const circle = await requireDocument(tx, 'circles', id);
        const key = pair(ctx.userId, id); const membership = await tx.get('memberships', key);
        if (!!membership === join) return;
        if (join) {
          await tx.set('memberships', key, { userId: ctx.userId, circleId: id, createdAt: now() });
          circle.memberCount = (circle.memberCount || 0) + 1;
        } else {
          await tx.remove('memberships', key);
          circle.memberCount = Math.max(0, (circle.memberCount || 0) - 1);
        }
        await tx.set('circles', id, circle);
      });
      return { circle: await circleProjection(await repo.get('circles', id), ctx.userId) };
    },
    async listPosts(payload, ctx) {
      const filters = { deleted: false };
      if (payload.circleId) filters.circleId = identifier(payload.circleId);
      const mine = payload.mine === undefined ? false : boolean(payload.mine);
      const authorId = payload.authorId === undefined || payload.authorId === '' ? '' : identifier(payload.authorId);
      const bookmarked = payload.bookmarked === undefined ? false : boolean(payload.bookmarked);
      const feed = payload.feed === undefined ? 'discover' : payload.feed;
      if (!['discover', 'following', 'circles'].includes(feed)) fail('INVALID_INPUT', '内容分类不正确');
      const rawTopic = payload.topic === undefined ? '' : string(payload.topic, '话题', 0, 30);
      const topic = normalizeTopic(rawTopic);
      if (rawTopic && !topic) fail('INVALID_INPUT', '请选择支持的话题');
      const query = string(payload.query === undefined ? '' : payload.query, '搜索内容', 0, 60).toLowerCase();
      const matchesAnimals = animalFilters(payload);
      pageSize(payload); cursor(payload.cursor);
      if (mine && authorId && authorId !== ctx.userId) return { items: [] };
      if (mine || authorId) filters.authorId = mine ? ctx.userId : authorId;
      const followed = feed === 'following' ? new Set((await allRecords('follows', { fromId: ctx.userId })).map(record => record.toId)) : null;
      const joined = feed === 'circles' ? new Set((await allRecords('memberships', { userId: ctx.userId })).map(record => record.circleId)) : null;
      const saved = bookmarked ? new Set((await allRecords('bookmarks', { userId: ctx.userId })).map(record => record.postId)) : null;
      if (followed && !followed.size || joined && !joined.size || saved && !saved.size) return { items: [] };
      const excluded = await blockedSet(ctx.userId);
      const matches = async record => {
        const topics = normalizeTopics(record.topics);
        const aliases = Object.keys(TOPIC_ALIASES).filter(alias => topics.includes(TOPIC_ALIASES[alias]));
        return await canReadPost(record, ctx.userId, repo, excluded) && (!followed || followed.has(record.authorId)) && (!joined || joined.has(record.circleId)) && (!saved || saved.has(record._id)) &&
          matchesAnimals(record.animalTypes) && (!topic || topics.includes(topic)) && (!query || [record.title || '', record.text || '', ...topics, ...aliases].join(' ').toLowerCase().includes(query));
      };
      const page = await scanVisible('posts', filters, payload, excluded, 'authorId', matches);
      const items = await Promise.all(page.items.map(async record => {
        try { return await postProjection(record, ctx.userId); }
        catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; }
      }));
      return { ...page, items: items.filter(Boolean) };
    },
    async getPost(payload, ctx) {
      const record = await requirePost(repo, ctx.userId, identifier(payload.id));
      const comments = await commentsFor('post', record._id, ctx.userId, payload);
      return { post: await postProjection(record, ctx.userId), comments: comments.items, ...(comments.nextCursor ? { nextCursor: comments.nextCursor } : {}) };
    },
    async createPost(payload, ctx) {
      const circleId = identifier(payload.circleId);
      const visibility = postVisibility(payload.visibility);
      const text = string(payload.text === undefined ? '' : payload.text, '正文', 0, 1000);
      if (!Array.isArray(payload.images) || payload.images.length > 3 || payload.images.some(file => typeof file !== 'string' || file.length > 512)) fail('INVALID_INPUT', '最多添加 3 张图片');
      const images = [...new Set(payload.images)];
      const requestedVideo = payload.video === undefined || payload.video === null ? null : payload.video;
      if (requestedVideo !== null && (!object(requestedVideo) || typeof requestedVideo.url !== 'string' || !requestedVideo.url || requestedVideo.url.length > 512 || requestedVideo.poster)) fail('INVALID_INPUT', '请选择已上传的视频，视频封面暂不支持另行设置');
      if (requestedVideo && images.length) fail('INVALID_INPUT', '图片与视频不能同时发布');
      requirePrivateMedia(visibility, images.length || requestedVideo);
      if (!text && !images.length && !requestedVideo) fail('INVALID_INPUT', '请写一点内容或添加图片、视频');
      const title = string(payload.title === undefined ? '' : payload.title, '标题', 0, 40);
      const kind = payload.kind === undefined ? 'daily' : payload.kind;
      if (!['daily', 'question', 'meetup'].includes(kind)) fail('INVALID_INPUT', '请选择有效的分享类型');
      const requestedTopics = payload.topics === undefined ? [] : payload.topics;
      if (!Array.isArray(requestedTopics) || requestedTopics.length > 3 || requestedTopics.some(topic => !normalizeTopic(topic))) fail('INVALID_INPUT', '最多选择 3 个支持的话题');
      const topics = normalizeTopics(requestedTopics);
      const animalTypes = animalList(payload.animalTypes, '动物种类', 3);
      const coverIndex = integer(payload.coverIndex === undefined ? 0 : payload.coverIndex, '封面位置', 0, Math.max(0, images.length - 1));
      const eventId = payload.eventId === undefined || payload.eventId === '' ? '' : identifier(payload.eventId);
      const checkText = [title, text, ...topics].filter(Boolean).join('\n');
      if (checkText) await moderateText(checkText, ctx.openid);
      // The transaction re-reads tickets so deletion/account cleanup cannot race publication.
      const uploads = []; let video = null;
      for (const fileId of images.concat(requestedVideo ? [requestedVideo.url] : [])) {
        const rows = await repo.find('uploads', { ownerId: ctx.userId, fileId, status: 'complete' }, { limit: 1 });
        if (!rows[0] || rows[0].purpose === 'pet') fail('FORBIDDEN', requestedVideo ? '视频必须由本人上传并完成审核' : '图片必须使用发帖专用的本人审核上传');
        if (requestedVideo) {
          if (rows[0].mediaType !== 'video' || !publicVideo(rows[0].video) || rows[0].video.url !== fileId) fail('FORBIDDEN', '视频必须由本人上传并完成审核');
          video = publicVideo(rows[0].video);
        } else if (rows[0].mediaType === 'video') fail('INVALID_INPUT', '视频不能作为图片发布');
        uploads.push(rows[0]);
      }
      const id = orderedId();
      await repo.transaction(async tx => {
        await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId); await requireDocument(tx, 'circles', circleId);
        if (!await tx.get('memberships', pair(ctx.userId, circleId))) fail('NOT_MEMBER', '加入小圈子后再分享吧');
        if (eventId) {
          const linked = await requireDocument(tx, 'events', eventId);
          await ensureVisible(tx, ctx.userId, linked.hostId);
        }
        for (const upload of uploads) {
          const current = await tx.get('uploads', upload._id);
          if (!current || current.purpose === 'pet' || current.ownerId !== ctx.userId || current.status !== 'complete' || current.postId || current.fileId !== upload.fileId) fail('FORBIDDEN', '媒体尚未通过审核或已用于其他分享');
          await tx.set('uploads', current._id, { ...current, postId: id });
        }
        const placeFields = await placeRun(placeEngine.linkPost(payload, ctx, id), tx);
        await tx.set('posts', id, { authorId: ctx.userId, visibility, circleId, text, title, kind, topics, animalTypes, images, ...(video ? { video, contentType: 'video' } : {}), coverIndex, eventId, ...placeFields,
          likeCount: 0, createdAt: now(), commentCount: 0, deleted: false });
      });
      return { post: await postProjection(await repo.get('posts', id), ctx.userId, true) };
    },
    async setPostVisibility(payload, ctx) {
      if (Object.keys(payload).some(key => !['id', 'visibility'].includes(key))) fail('INVALID_INPUT', '可见范围请求包含无效字段');
      const id = identifier(payload.id); const visibility = postVisibility(payload.visibility);
      if (payload.visibility === undefined) fail('INVALID_INPUT', '请选择分享的可见范围');
      await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId);
        const post = await requireDocument(tx, 'posts', id);
        if (post.authorId !== ctx.userId) fail('FORBIDDEN', '只能修改自己分享的可见范围');
        requirePrivateMedia(visibility, post.images && post.images.length || post.video && post.video.url);
        await tx.set('posts', id, { ...post, visibility, updatedAt: now() });
      });
      return postResult(id, ctx, true);
    },
    async deletePost(payload, ctx) { await cleanPost(identifier(payload.id), ctx.userId, ctx.isAdmin, ctx.lifecycleId); return { deleted: true }; },
    async likePost(payload, ctx) {
      const id = identifier(payload.id); const like = boolean(payload.like);
      await repo.transaction(async tx => {
        await (like ? requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId) : requireUser(tx, ctx.userId, ctx.lifecycleId));
        const post = await requirePost(tx, ctx.userId, id);
        await requireUser(tx, post.authorId); await ensureVisible(tx, ctx.userId, post.authorId);
        const key = pair(ctx.userId, id); const previous = await tx.get('likes', key);
        if (!!previous === like) return;
        if (like) {
          await tx.set('likes', key, { userId: ctx.userId, postId: id, authorId: post.authorId, createdAt: now() });
          await tx.set('posts', id, { ...post, likeCount: (post.likeCount || 0) + 1 });
          await notify(tx, post.authorId, '收到一个赞', '赞了你的分享', 'post', id, ctx.userId, 'like');
        } else await removeLike(tx, key);
      });
      return postResult(id, ctx);
    },
    async bookmarkPost(payload, ctx) {
      const id = identifier(payload.id); const bookmark = boolean(payload.bookmark);
      await repo.transaction(async tx => {
        await (bookmark ? requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId) : requireUser(tx, ctx.userId, ctx.lifecycleId));
        const post = await requirePost(tx, ctx.userId, id);
        await requireUser(tx, post.authorId); await ensureVisible(tx, ctx.userId, post.authorId);
        const key = pair(ctx.userId, id); const previous = await tx.get('bookmarks', key);
        if (!!previous === bookmark) return;
        if (bookmark) {
          await tx.set('bookmarks', key, { userId: ctx.userId, postId: id, authorId: post.authorId, createdAt: now() });
          await notify(tx, post.authorId, '分享被收藏了', '收藏了你的分享', 'post', id, ctx.userId, 'bookmark');
        }
        else await tx.remove('bookmarks', key);
      });
      return postResult(id, ctx);
    },
    async followUser(payload, ctx) {
      const userId = identifier(payload.userId); const follow = boolean(payload.follow);
      if (userId === ctx.userId) fail('INVALID_INPUT', '不能关注自己');
      await repo.transaction(async tx => {
        const me = await (follow ? requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId) : requireUser(tx, ctx.userId, ctx.lifecycleId)); const target = await requireUser(tx, userId);
        await ensureVisible(tx, ctx.userId, userId);
        const key = pair(ctx.userId, userId); const previous = await tx.get('follows', key);
        if (!!previous === follow) return;
        if (follow) {
          await tx.set('follows', key, { fromId: ctx.userId, toId: userId, createdAt: now() });
          await tx.set('users', ctx.userId, { ...me, followingCount: (me.followingCount || 0) + 1 });
          await tx.set('users', userId, { ...target, followerCount: (target.followerCount || 0) + 1 });
          await notify(tx, userId, '有新的关注', '开始关注你了', 'user', ctx.userId, ctx.userId, 'follow');
        } else await removeFollow(tx, ctx.userId, userId);
      });
      return { success: true, isFollowing: !!await repo.get('follows', pair(ctx.userId, userId)) };
    },
    async listFollowing(payload, ctx) {
      const page = await scanVisible('follows', { fromId: ctx.userId }, payload, await blockedSet(ctx.userId), 'toId', async relation => {
        const user = await repo.get('users', relation.toId); return user && user.status === 'active';
      });
      return { ...page, items: await Promise.all(page.items.map(relation => author(relation.toId))) };
    },
    async listNeighbors(payload, ctx) {
      const filter = neighbors.filters(payload, fail);
      const excluded = await blockedSet(ctx.userId); excluded.add(ctx.userId);
      const me = await requireUser(repo, ctx.userId, ctx.lifecycleId);
      const viewer = neighbors.isParticipant(me) && (await verificationFor(repo, ctx.userId)).status === 'phone_verified' ? me : { neighborVisible: false };
      // The existing status/id index supports bounded scans, including sparse opt-ins and filters.
      const page = await scanVisible('users', { status: 'active' }, payload, excluded, '_id', async user =>
        neighbors.isParticipant(user) && neighbors.matches(user, filter) && (await verificationFor(repo, user._id)).status === 'phone_verified');
      return { ...page, items: await Promise.all(page.items.map(async user => ({
        ...publicAuthor(user), ...neighbors.publicFields(user, viewer),
        isFollowing: !!await repo.get('follows', pair(ctx.userId, user._id))
      }))) };
    },
    async getUserProfile(payload, ctx) {
      const userId = identifier(payload.userId);
      const user = await repo.get('users', userId);
      if (!user || user.status !== 'active') fail('NOT_FOUND', '这位用户暂时不可访问');
      await ensureVisible(repo, ctx.userId, userId);
      const isMine = userId === ctx.userId; const publicProfile = user.publicProfile === true;
      const ownPosts = [];
      for (const post of await allRecords('posts', { authorId: userId, deleted: false })) if (await canReadPost(post, ctx.userId)) ownPosts.push(post);
      const posts = await handlers.listPosts({ authorId: userId, cursor: payload.cursor, limit: payload.limit, excludedAnimalTypes: payload.excludedAnimalTypes }, ctx);
      const petProjection = await petService.projectPets(user, ctx.userId);
      return { user: { ...publicAuthor(user), publicProfile, showPet: user.showPet === true, bio: isMine || publicProfile ? user.bio || '' : '',
        pet: isMine || publicProfile || user.showPet === true ? user.pet || null : null, ...petProjection, isMine,
        isFollowing: !isMine && !!await repo.get('follows', pair(ctx.userId, userId)), postCount: ownPosts.length,
        followerCount: user.followerCount || 0, followingCount: user.followingCount || 0 },
      posts: posts.items, ...(posts.nextCursor ? { nextCursor: posts.nextCursor } : {}) };
    },
    async addComment(payload, ctx) {
      if (!['post', 'event'].includes(payload.targetType)) fail('INVALID_INPUT', '评论目标不正确');
      const targetId = identifier(payload.targetId); const text = string(payload.text, '评论', 1, 300);
      const replyToId = payload.replyToId ? identifier(payload.replyToId) : null;
      await moderateText(text, ctx.openid);
      const id = orderedId();
      await repo.transaction(async tx => {
        const me = await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId);
        const collection = payload.targetType === 'post' ? 'posts' : 'events';
        const target = payload.targetType === 'post' ? await requirePost(tx, ctx.userId, targetId) : await requireDocument(tx, collection, targetId);
        const ownerId = target.authorId || target.hostId;
        await ensureVisible(tx, ctx.userId, ownerId);
        let reply;
        if (replyToId) {
          reply = await requireDocument(tx, 'comments', replyToId);
          if (reply.targetType !== payload.targetType || reply.targetId !== targetId) fail('INVALID_INPUT', '回复必须属于当前内容');
          await ensureVisible(tx, ctx.userId, reply.authorId);
        }
        await tx.set('comments', id, { targetType: payload.targetType, targetId, text, authorId: ctx.userId,
          replyToId, replyToAuthorId: reply ? reply.authorId : '', createdAt: now(), deleted: false });
        await tx.set(collection, targetId, { ...target, commentCount: (target.commentCount || 0) + 1 });
        for (const recipient of new Set([ownerId, reply && reply.authorId].filter(Boolean))) {
          await notify(tx, recipient, reply && recipient === reply.authorId ? '有人回复了你' : '有新的留言', `${me.nickname}：${text.slice(0, 80)}`, payload.targetType, targetId, ctx.userId, reply && recipient === reply.authorId ? 'reply' : 'comment');
        }
      });
      return { comment: await commentProjection(await repo.get('comments', id), ctx.userId) };
    },
    async deleteComment(payload, ctx) {
      const id = identifier(payload.id);
      await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId);
        const comment = await requireDocument(tx, 'comments', id);
        if (comment.authorId !== ctx.userId && !ctx.isAdmin) fail('FORBIDDEN', '只能删除自己的评论');
        const collection = comment.targetType === 'post' ? 'posts' : 'events';
        const target = await tx.get(collection, comment.targetId);
        if (target) await tx.set(collection, target._id, { ...target, commentCount: Math.max(0, (target.commentCount || 0) - 1) });
        await tx.set('comments', id, { ...comment, deleted: true, text: '', replyToName: '', deletedAt: now() });
      });
      return { deleted: true };
    },
    async listEvents(payload, ctx) {
      if (payload.filter !== undefined && !['all', 'none', 'dog'].includes(payload.filter)) fail('INVALID_INPUT', '活动筛选不正确');
      const filters = {};
      if (payload.filter === 'none') filters.petPolicy = { in: ['none', 'optional'] };
      if (payload.filter === 'dog') filters.petPolicy = { in: ['dog', 'optional'] };
      const excluded = await blockedSet(ctx.userId);
      let page;
      if (payload.mine !== undefined && boolean(payload.mine)) {
        const regs = await allRecords('registrations', { userId: ctx.userId });
        const joined = new Set(regs.map(reg => reg.eventId));
        // Capacity is bounded but a user may have many historical registrations.
        const records = await Promise.all([...joined].map(id => repo.get('events', id)));
        const before = cursor(payload.cursor);
        const selected = records.filter(record => record && (!before || record._id < before) && !excluded.has(record.hostId) &&
          (payload.filter !== 'none' || record.petPolicy !== 'dog') && (payload.filter !== 'dog' || record.petPolicy !== 'none')).sort((a, b) => b._id.localeCompare(a._id));
        const limit = pageSize(payload); const items = selected.slice(0, limit);
        page = { items, ...(selected.length > limit ? { nextCursor: items[items.length - 1]._id } : {}) };
      } else page = await scanVisible('events', filters, payload, excluded, 'hostId');
      return { ...page, items: await Promise.all(page.items.map(record => eventProjection(record, ctx.userId))) };
    },
    async getEvent(payload, ctx) {
      const record = await requireDocument(repo, 'events', identifier(payload.id));
      await ensureVisible(repo, ctx.userId, record.hostId);
      const comments = await commentsFor('event', record._id, ctx.userId, payload);
      return { event: await eventProjection(record, ctx.userId), comments: comments.items, ...(comments.nextCursor ? { nextCursor: comments.nextCursor } : {}) };
    },
    async joinEvent(payload, ctx) {
      const id = identifier(payload.id); const join = boolean(payload.join);
      await repo.transaction(async tx => {
        const me = await (join ? requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId) : requireUser(tx, ctx.userId, ctx.lifecycleId));
        const event = await requireDocument(tx, 'events', id);
        await ensureVisible(tx, ctx.userId, event.hostId);
        const attendees = event.attendeeIds || [];
        const present = attendees.includes(ctx.userId);
        if (present === join) return;
        const key = pair(ctx.userId, id);
        if (join) {
          if (event.status !== 'active' || event.startAt <= now()) fail('EVENT_CLOSED', '活动已开始或已取消');
          if (attendees.length >= event.capacity) fail('EVENT_FULL', '名额已满');
          event.attendeeIds = [...attendees, ctx.userId];
          await tx.set('registrations', key, { userId: ctx.userId, eventId: id, createdAt: now() });
          await notify(tx, event.hostId, '有新的活动报名', `${me.nickname}报名了「${event.title}」`, 'event', id, ctx.userId);
        } else {
          event.attendeeIds = attendees.filter(userId => userId !== ctx.userId);
          await tx.remove('registrations', key);
        }
        await tx.set('events', id, event);
      });
      return { event: await eventProjection(await repo.get('events', id), ctx.userId) };
    },
    async createEvent(payload, ctx) {
      if (!ctx.isAdmin) fail('FORBIDDEN', '只有运营者可以创建活动');
      const data = validateEvent(payload);
      await moderateText(`${data.title}\n${data.description}\n${data.location}`, ctx.openid);
      const id = orderedId();
      await repo.transaction(async tx => {
        await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId); await requireDocument(tx, 'circles', data.circleId);
        await tx.set('events', id, { ...data, hostId: ctx.userId, attendeeIds: [], status: 'active', cover: '', commentCount: 0, createdAt: now(), updatedAt: now() });
      });
      return { event: await eventProjection(await repo.get('events', id), ctx.userId) };
    },
    async updateEvent(payload, ctx) {
      if (!ctx.isAdmin) fail('FORBIDDEN', '只有运营者可以修改活动');
      const id = identifier(payload.id); const data = validateEvent(payload);
      await moderateText(`${data.title}\n${data.description}\n${data.location}`, ctx.openid);
      await repo.transaction(async tx => {
        await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId); await requireDocument(tx, 'circles', data.circleId);
        const event = await requireDocument(tx, 'events', id);
        if (event.status !== 'active' || event.startAt <= now()) fail('EVENT_CLOSED', '已取消或已开始的活动不能修改');
        if ((event.attendeeIds || []).length > data.capacity) fail('INVALID_INPUT', '名额不能少于已报名人数');
        const changed = Object.entries(data).some(([key, value]) => event[key] !== value);
        await tx.set('events', id, { ...event, ...data, updatedAt: now() });
        if (changed) await queueEventNotices(tx, event.attendeeIds || [], '活动信息已更新', `「${data.title}」的安排有变化，请查看最新详情。`, id, ctx.userId);
      });
      return { event: await eventProjection(await repo.get('events', id), ctx.userId) };
    },
    async cancelEvent(payload, ctx) {
      if (!ctx.isAdmin) fail('FORBIDDEN', '只有运营者可以取消活动');
      const id = identifier(payload.id); const reason = string(payload.reason, '取消原因', 1, 80);
      await moderateText(reason, ctx.openid);
      await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId); const event = await requireDocument(tx, 'events', id);
        if (event.status === 'cancelled') return;
        if (event.endAt <= now()) fail('EVENT_CLOSED', '已结束的活动不能取消');
        await tx.set('events', id, { ...event, status: 'cancelled', cancelReason: reason, updatedAt: now() });
        await queueEventNotices(tx, event.attendeeIds || [], '活动已取消', `「${event.title}」已取消：${reason}`, id, ctx.userId);
      });
      return { event: await eventProjection(await repo.get('events', id), ctx.userId) };
    },
    async listMessages(payload, ctx) {
      // Stable reaction IDs are not timestamps. Filter and order on the server before cutting a page.
      // Cold-start inboxes are read in 100-record batches for exact counts; large inboxes need a sort-key index.
      const query = string(payload.query === undefined ? '' : payload.query, '搜索内容', 0, 60).toLowerCase();
      const visible = await visibleMessages(ctx.userId); const actorNames = new Map();
      if (query) for (const record of visible) {
        if (!record.actorId || actorNames.has(record.actorId)) continue;
        const actor = await repo.get('users', record.actorId);
        actorNames.set(record.actorId, actor && actor.status === 'active' ? publicAuthor(actor).nickname : '');
      }
      const page = messagePage(visible, payload, record => !query || [record.title, record.text, actorNames.get(record.actorId)].join(' ').toLowerCase().includes(query));
      const items = await Promise.all(page.items.map(record => messageProjection(record, ctx.userId)));
      return { ...page, items: items.filter(Boolean), ...messageCounts(await visibleMessages(ctx.userId)) };
    },
    async readMessage(payload, ctx) {
      const all = payload.all === undefined ? false : boolean(payload.all);
      if (!all && !payload.id) fail('INVALID_INPUT', '请选择消息');
      const ids = all ? (await visibleMessages(ctx.userId)).filter(record => !record.isRead).map(record => record._id) : [identifier(payload.id)];
      for (const id of ids) await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId); const record = await requireDocument(tx, 'messages', id);
        if (!await messageVisible(record, ctx.userId, tx)) { if (all) return; fail('NOT_FOUND', '消息不存在'); }
        await tx.set('messages', id, { ...record, isRead: true });
      });
      return { success: true, ...messageCounts(await visibleMessages(ctx.userId)) };
    },
    async updateProfile(payload, ctx) {
      const nickname = payload.nickname === undefined ? undefined : string(payload.nickname, '昵称', 1, 24);
      const area = payload.area === undefined ? undefined : string(payload.area, '片区', 0, 40);
      const bio = payload.bio === undefined ? undefined : string(payload.bio, '个人介绍', 0, 160);
      const publicProfile = payload.publicProfile === undefined ? undefined : boolean(payload.publicProfile, '公开资料选项');
      const showPet = payload.showPet === undefined ? undefined : boolean(payload.showPet, '头像宠物展示选项');
      const settings = await getSettings();
      if (area && !settings.areas.includes(area)) fail('INVALID_INPUT', '请选择已开放的片区');
      let pet = payload.pet === undefined ? undefined : null;
      if (payload.pet !== null && payload.pet !== undefined) {
        if (!object(payload.pet) || !['cat', 'dog', 'other'].includes(payload.pet.type)) fail('INVALID_INPUT', '宠物类型不正确');
        if (Object.prototype.hasOwnProperty.call(payload.pet, 'photo')) fail('INVALID_INPUT', '请通过宠物资料中的照片入口选择并审核照片');
        pet = { name: string(payload.pet.name, '宠物名字', 1, 24), type: payload.pet.type };
      }
      const changedText = [nickname, bio, pet && pet.name].filter(Boolean).join('\n');
      if (changedText) await moderateText(changedText, ctx.openid);
      await repo.transaction(async tx => {
        const me = await (payload.neighborVisible === true || payload.residenceSharing === true ? requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId) : requireUser(tx, ctx.userId, ctx.lifecycleId));
        const neighborSettings = neighbors.update(me, payload, now(), fail);
        await tx.set('users', ctx.userId, { ...me, nickname: nickname === undefined ? me.nickname : nickname,
          area: area === undefined ? me.area || '' : area, bio: bio === undefined ? me.bio || '' : bio, pet: pet === undefined ? me.pet || null : pet,
          publicProfile: publicProfile === undefined ? me.publicProfile === true : publicProfile,
          showPet: showPet === undefined ? me.showPet === true : showPet, ...neighborSettings, ...petData.legacyPatch(me, pet), updatedAt: now() });
      });
      if (pet === null) await petService.cleanupDetached(ctx);
      return { user: await userProjection(await repo.get('users', ctx.userId), ctx.isAdmin, true) };
    },
    async report(payload, ctx) {
      if (!['post', 'comment', 'user', 'event'].includes(payload.targetType)) fail('INVALID_INPUT', '举报类型不正确');
      const targetId = identifier(payload.targetId); const reason = string(payload.reason, '举报原因', 1, 80);
      const description = string(payload.description || '', '补充说明', 0, 500); const id = orderedId();
      await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId);
        const collection = { post: 'posts', comment: 'comments', user: 'users', event: 'events' }[payload.targetType];
        const target = await requireDocument(tx, collection, targetId);
        if (payload.targetType === 'post') await requirePost(tx, ctx.userId, targetId);
        if (payload.targetType === 'comment' && target.targetType === 'post') await requirePost(tx, ctx.userId, target.targetId);
        const targetTypeForLink = payload.targetType === 'comment' ? target.targetType : payload.targetType;
        const targetIdForLink = payload.targetType === 'comment' ? target.targetId : targetId;
        await tx.set('reports', id, { reporterId: ctx.userId, targetType: payload.targetType, targetId,
          targetTypeForLink, targetIdForLink, reason, description, status: 'open', createdAt: now() });
      });
      return { id };
    },
    async listReports(payload, ctx) {
      if (!ctx.isAdmin) fail('FORBIDDEN', '只有运营者可以查看举报');
      const status = payload.status === undefined ? 'open' : payload.status;
      if (!['open', 'all'].includes(status)) fail('INVALID_INPUT', '举报筛选不正确');
      // Legacy pending documents remain actionable after upgrading an early deployment.
      const filters = status === 'open' ? { status: { in: ['open', 'pending'] } } : {};
      const page = await scanVisible('reports', filters, payload, new Set(), 'reporterId');
      const items = await Promise.all(page.items.map(async record => {
        const collection = { post: 'posts', comment: 'comments', user: 'users', event: 'events' }[record.targetType];
        const target = collection ? await repo.get(collection, record.targetId) : null;
        const linkedPost = record.targetType === 'post' ? target : record.targetType === 'comment' && (target && target.targetType || record.targetTypeForLink) === 'post' ? await repo.get('posts', target && target.targetId || record.targetIdForLink) : null;
        const restricted = linkedPost && !await canReadPost(linkedPost, ctx.userId);
        const available = target && !target.deleted && !restricted && (record.targetType !== 'user' || target.status === 'active');
        let targetSummary = restricted ? '内容不可见' : '内容已删除';
        if (available) {
          const summary = record.targetType === 'user' ? target.nickname : record.targetType === 'event' ? target.title : target.text;
          targetSummary = Array.from(summary || (record.targetType === 'post' ? '图片分享' : '内容已删除')).slice(0, 140).join('');
        }
        const isComment = record.targetType === 'comment';
        const targetTypeForLink = isComment ? (record.targetTypeForLink || target && target.targetType || 'post') : record.targetType;
        const targetIdForLink = isComment ? (record.targetIdForLink || target && target.targetId || '') : record.targetId;
        return { id: record._id, targetType: record.targetType, targetId: record.targetId, reason: restricted ? '内容不可见' : record.reason,
          description: restricted ? '' : record.description || '', status: record.status === 'pending' ? 'open' : record.status,
          createdAt: record.createdAt, reporter: await author(record.reporterId), targetSummary, targetTypeForLink, targetIdForLink };
      }));
      return { ...page, items };
    },
    async resolveReport(payload, ctx) {
      if (!ctx.isAdmin) fail('FORBIDDEN', '只有运营者可以处理举报');
      const id = identifier(payload.id);
      if (!['resolved', 'dismissed'].includes(payload.status)) fail('INVALID_INPUT', '举报处理结果不正确');
      const note = string(payload.note === undefined ? '' : payload.note, '处理说明', 0, 300);
      // A repeat request never changes the first committed decision or its notification.
      const before = await requireDocument(repo, 'reports', id);
      if (['resolved', 'dismissed'].includes(before.status)) return { success: true };
      if (note) await moderateText(note, ctx.openid);
      await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId);
        const report = await requireDocument(tx, 'reports', id);
        if (['resolved', 'dismissed'].includes(report.status)) return;
        await tx.set('reports', id, { ...report, status: payload.status, note, resolvedBy: ctx.userId, resolvedAt: now() });
        const title = payload.status === 'resolved' ? '举报已处理' : '举报处理结果';
        const text = `${payload.status === 'resolved' ? '你提交的举报已由运营者处理。' : '你提交的举报已完成核查，本次未采取进一步处理。'}${note ? `\n处理说明：${note}` : ''}`;
        // System notices remain readable when the reporter has blocked an operator.
        // They contain no operator identity or another reporter's information.
        await notify(tx, report.reporterId, title, text, 'system', id, '');
      });
      return { success: true };
    },
    async blockUser(payload, ctx) {
      const userId = identifier(payload.userId); const block = boolean(payload.block);
      if (userId === ctx.userId) fail('INVALID_INPUT', '不能屏蔽自己');
      await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId); await requireUser(tx, userId);
        const key = pair(ctx.userId, userId);
        if (block) {
          await tx.set('blocks', key, { fromId: ctx.userId, toId: userId, createdAt: now() });
          await removeFollow(tx, ctx.userId, userId);
          await removeFollow(tx, userId, ctx.userId);
          await social.blockPair(tx, ctx.userId, userId);
        }
        else if (await tx.get('blocks', key)) await tx.remove('blocks', key);
      });
      if (block) {
        for (const [reactorId, authorId] of [[ctx.userId, userId], [userId, ctx.userId]]) {
          for (const collection of ['likes', 'bookmarks']) {
            for (const reaction of await allRecords(collection, { userId: reactorId, authorId })) {
              await repo.transaction(async tx => {
                if (collection === 'likes') await removeLike(tx, reaction._id);
                else if (await tx.get('bookmarks', reaction._id)) await tx.remove('bookmarks', reaction._id);
              });
            }
          }
        }
        // Blocking also releases any seat in an activity hosted by the other person.
        // This leaves no hidden registration that the blocked user cannot manage.
        for (const [memberId, hostId] of [[ctx.userId, userId], [userId, ctx.userId]]) {
          for (const registration of await allRecords('registrations', { userId: memberId })) {
            await repo.transaction(async tx => {
              const current = await tx.get('registrations', registration._id); if (!current) return;
              const event = await tx.get('events', current.eventId);
              if (event && event.hostId === hostId) {
                await tx.set('events', event._id, { ...event, attendeeIds: (event.attendeeIds || []).filter(id => memberId !== id) });
                await tx.remove('registrations', current._id);
              }
            });
          }
        }
      }
      return { success: true };
    },
    async listBlocked(payload, ctx) {
      const limit = pageSize(payload); const after = cursor(payload.cursor);
      const rows = await repo.find('blocks', { fromId: ctx.userId, ...(after ? { _id: { gt: after } } : {}) }, { orderBy: '_id', limit: limit + 1 });
      const page = rows.slice(0, limit);
      return { items: await Promise.all(page.map(record => author(record.toId))), ...(rows.length > limit ? { nextCursor: page[page.length - 1]._id } : {}) };
    },
    async createUploadTicket(payload, ctx) {
      const mediaType = payload.mediaType === undefined ? 'image' : payload.mediaType;
      if (!['image', 'video'].includes(mediaType)) fail('INVALID_INPUT', '上传媒体类型不正确');
      const isVideo = mediaType === 'video';
      if (isVideo ? !storage || !storage.videoEnabled : !storage || !storage.enabled) fail(isVideo ? 'VIDEO_UNAVAILABLE' : 'UPLOAD_UNAVAILABLE', isVideo ? '视频审核尚未配置，请先分享图文' : '图片上传尚未开放，请先分享文字');
      if (isVideo ? payload.extension !== 'mp4' : !['jpg', 'png', 'webp'].includes(payload.extension)) fail('INVALID_INPUT', isVideo ? '视频仅支持 MP4 格式' : '仅支持 JPG、PNG、WebP 图片');
      const declaredVideo = isVideo ? videoMetadata(payload) : null;
      const id = uid(); const cloudPath = `community/incoming/${ctx.userId}/${id}.${payload.extension}`;
      await repo.transaction(async tx => {
        await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId);
        await tx.set('uploads', id, { ownerId: ctx.userId, cloudPath, extension: payload.extension, ...(isVideo ? { mediaType, declaredVideo } : {}), status: 'pending', createdAt: now(), expiresAt: now() + 15 * 60 * 1000 });
      });
      return { ticketId: id, cloudPath, ...(isVideo ? { mediaType } : {}) };
    },
    async completeUpload(payload, ctx) {
      if (!storage || !storage.enabled && !storage.videoEnabled) fail('UPLOAD_UNAVAILABLE', '媒体上传尚未开放');
      const ticketId = identifier(payload.ticketId); const fileId = string(payload.fileId, '媒体编号', 1, 512);
      const ticket = await requireDocument(repo, 'uploads', ticketId);
      const isVideo = ticket.mediaType === 'video';
      if (ticket.ownerId !== ctx.userId) fail('FORBIDDEN', '不能使用他人的上传记录');
      if (isVideo ? !storage.videoEnabled : !storage.enabled) fail(isVideo ? 'VIDEO_UNAVAILABLE' : 'UPLOAD_UNAVAILABLE', isVideo ? '视频审核尚未配置，请先分享图文' : '图片上传尚未开放');
      if (ticket.status === 'complete') return uploadResult(ticket);
      if (ticket.status !== 'pending') return handlers.getUploadStatus({ ticketId }, ctx);
      if (ticket.expiresAt <= now()) fail('UPLOAD_EXPIRED', '上传已过期，请重新选择媒体');
      if (!storage.isExpectedFile(fileId, ticket.cloudPath, ticket.mediaType || 'image')) fail('FORBIDDEN', '媒体路径与上传记录不匹配');
      const operationToken = uid(); const asynchronous = !isVideo && storage.mode === 'async';
      const publishPath = asynchronous ? '' : `community/published/${uid()}.${ticket.extension}`;
      const acquired = await repo.transaction(async tx => {
        await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId);
        const current = await requireDocument(tx, 'uploads', ticketId);
        if (current.ownerId !== ctx.userId) fail('FORBIDDEN', '不能使用他人的上传记录');
        if (current.status !== 'pending') return false;
        if (current.expiresAt <= now()) fail('UPLOAD_EXPIRED', '上传已过期');
        await tx.set('uploads', ticketId, { ...current, status: 'processing', phase: asynchronous ? 'submitting' : 'sync',
          operationToken, leaseUntil: now() + 120000, sourceFileId: fileId,
          publishingFileId: publishPath && storage.fileIdForPath ? storage.fileIdForPath(publishPath) : '' });
        return true;
      });
      if (!acquired) return handlers.getUploadStatus({ ticketId }, ctx);
      let published; let review; let verifiedVideo;
      try {
        if (asynchronous) {
          review = await storage.submitReview({ fileId, extension: ticket.extension, openid: ctx.openid, ticketId, ownerId: ctx.userId, operationToken });
          if (!review || !review.traceId || !review.quarantineFileId || !/^[a-f0-9]{64}$/.test(review.sha256) || !Number.isFinite(review.reviewExpiresAt)) fail('UPLOAD_UNAVAILABLE', '图片审核结果异常');
          await repo.transaction(async tx => {
            await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId);
            const current = await requireDocument(tx, 'uploads', ticketId);
            if (current.ownerId !== ctx.userId || current.status !== 'processing' || current.operationToken !== operationToken || current.leaseUntil <= now()) fail('UPLOAD_EXPIRED', '图片处理已结束，请重新选择');
            await tx.set('uploads', ticketId, { ...current, phase: 'review', leaseUntil: 0, traceId: review.traceId,
              quarantineFileId: review.quarantineFileId, sha256: review.sha256, reviewExpiresAt: review.reviewExpiresAt });
          });
          return { status: 'pending', ticketId };
        }
        const verified = await storage.verifyAndPublish({ fileId, cloudPath: publishPath, extension: ticket.extension, openid: ctx.openid, mediaType: ticket.mediaType || 'image' });
        published = isVideo && object(verified) ? verified.fileId : verified;
        if (isVideo) {
          const metadata = videoMetadata(verified);
          if (typeof published !== 'string' || !published || storage.fileIdForPath && published !== storage.fileIdForPath(publishPath)) fail('VIDEO_UNAVAILABLE', '视频审核结果异常');
          verifiedVideo = { url: published, durationSeconds: metadata.durationSeconds, ...(metadata.width ? { width: metadata.width } : {}), ...(metadata.height ? { height: metadata.height } : {}) };
        }
        await repo.transaction(async tx => {
          await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId);
          const current = await requireDocument(tx, 'uploads', ticketId);
          if (current.ownerId !== ctx.userId || current.status !== 'processing' || current.operationToken !== operationToken || current.leaseUntil <= now()) fail('UPLOAD_EXPIRED', '媒体处理已结束，请重新选择');
          await tx.set('uploads', ticketId, { ...current, status: 'complete', phase: '', leaseUntil: 0, fileId: published, ...(verifiedVideo ? { video: verifiedVideo } : {}), completedAt: now() });
        });
      } catch (error) {
        const created = [published, review && review.quarantineFileId].filter(value => typeof value === 'string' && value);
        if (created.length) await storage.remove(created).catch(() => {});
        await repo.transaction(async tx => {
          const current = await tx.get('uploads', ticketId);
          if (current && current.status === 'processing' && current.operationToken === operationToken) {
            const retryVideo = isVideo && !published && ['CONTENT_CHECK_UNAVAILABLE', 'VIDEO_UNAVAILABLE', 'UPLOAD_UNAVAILABLE'].includes(error.code) && current.expiresAt > now();
            await tx.set('uploads', ticketId, { ...current, ...(review || {}), ...(typeof published === 'string' ? { fileId: published } : {}),
              status: retryVideo ? 'pending' : 'rejected', phase: '', leaseUntil: 0,
              ...(retryVideo ? { publishingFileId: '', cleanupFileIds: [...new Set([...(current.cleanupFileIds || []), current.publishingFileId].filter(Boolean))] } : {}),
              reviewMessage: retryVideo ? '视频审核暂时不可用，可稍后重试' : isVideo ? '视频处理未完成，请重新选择' : '图片处理未完成，请重新选择' });
          }
        }).catch(() => {});
        throw error;
      }
      await storage.remove([fileId]).catch(() => {});
      return uploadResult(await requireDocument(repo, 'uploads', ticketId));
    },
    async getUploadStatus(payload, ctx) {
      const ticketId = identifier(payload.ticketId); let ticket = await requireDocument(repo, 'uploads', ticketId);
      if (ticket.ownerId !== ctx.userId) fail('FORBIDDEN', '不能查看他人的上传记录');
      if (['complete', 'rejected', 'expired', 'cleanup'].includes(ticket.status)) return uploadResult(ticket);
      if (ticket.status !== 'processing' || ticket.phase !== 'review') {
        const deadline = ticket.status === 'pending' ? ticket.expiresAt : ticket.leaseUntil;
        if (deadline && deadline <= now()) {
          await repo.transaction(async tx => {
            const current = await tx.get('uploads', ticketId);
            if (current && current.status === ticket.status && current.operationToken === ticket.operationToken && current.phase === ticket.phase)
              await tx.set('uploads', ticketId, { ...current, status: 'expired', reviewMessage: '媒体处理已过期，请重新选择' });
          });
          return uploadResult(await requireDocument(repo, 'uploads', ticketId));
        }
        return uploadResult(ticket);
      }
      if (!storage || typeof storage.getReviewDecision !== 'function' || typeof storage.finalizeReview !== 'function') fail('UPLOAD_UNAVAILABLE', '图片审核尚未配置');
      const decision = await storage.getReviewDecision({ traceId: ticket.traceId, ticketId, ownerId: ctx.userId, reviewExpiresAt: ticket.reviewExpiresAt });
      if (decision.status === 'pending') return uploadResult(ticket);
      if (['reject', 'expired'].includes(decision.status)) {
        await repo.transaction(async tx => {
          const current = await tx.get('uploads', ticketId);
          if (current && current.status === 'processing' && current.phase === 'review' && current.traceId === ticket.traceId)
            await tx.set('uploads', ticketId, { ...current, status: decision.status === 'reject' ? 'rejected' : 'expired',
              reviewMessage: decision.status === 'reject' ? '这张图片暂时无法发布，请更换图片' : '图片审核已过期，请重新选择' });
        });
        return uploadResult(await requireDocument(repo, 'uploads', ticketId));
      }
      if (decision.status !== 'pass') fail('UPLOAD_UNAVAILABLE', '图片审核结果异常');
      const token = uid(); const publishPath = `community/published/${uid()}.${ticket.extension}`;
      const acquired = await repo.transaction(async tx => {
        await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId);
        const current = await requireDocument(tx, 'uploads', ticketId);
        if (current.ownerId !== ctx.userId) fail('FORBIDDEN', '不能查看他人的上传记录');
        if (current.status !== 'processing' || current.phase !== 'review' || current.traceId !== ticket.traceId) return false;
        if (current.reviewExpiresAt <= now()) {
          await tx.set('uploads', ticketId, { ...current, status: 'expired', reviewMessage: '图片审核已过期，请重新选择' }); return false;
        }
        await tx.set('uploads', ticketId, { ...current, phase: 'finalizing', operationToken: token, leaseUntil: now() + 120000,
          cleanupFileIds: [...new Set([...(current.cleanupFileIds || []), current.publishingFileId].filter(Boolean))],
          publishingFileId: storage.fileIdForPath ? storage.fileIdForPath(publishPath) : '' });
        return true;
      });
      if (!acquired) return uploadResult(await requireDocument(repo, 'uploads', ticketId));
      let published;
      try {
        published = await storage.finalizeReview({ quarantineFileId: ticket.quarantineFileId, sha256: ticket.sha256,
          cloudPath: publishPath });
        await repo.transaction(async tx => {
          await requireVerifiedUser(tx, ctx.userId, ctx.lifecycleId);
          const current = await requireDocument(tx, 'uploads', ticketId);
          if (current.ownerId !== ctx.userId || current.status !== 'processing' || current.phase !== 'finalizing' || current.operationToken !== token || current.leaseUntil <= now()) fail('UPLOAD_EXPIRED', '图片处理已结束，请重新选择');
          await tx.set('uploads', ticketId, { ...current, status: 'complete', fileId: published, phase: '', leaseUntil: 0, completedAt: now() });
        });
      } catch (error) {
        if (published) await storage.remove([published]).catch(() => {});
        await repo.transaction(async tx => {
          const current = await tx.get('uploads', ticketId);
          if (current && current.status === 'processing' && current.operationToken === token) {
            const terminal = ['MEDIA_CONTENT_CHANGED', 'INVALID_IMAGE', 'UPLOAD_EXPIRED'].includes(error.code);
            await tx.set('uploads', ticketId, { ...current, phase: terminal ? '' : 'review', leaseUntil: 0,
              ...(published ? { cleanupFileIds: [...new Set([...(current.cleanupFileIds || []), published])] } : {}),
              ...(terminal ? { status: error.code === 'UPLOAD_EXPIRED' ? 'expired' : 'rejected', reviewMessage: '图片内容无效或处理已过期，请重新选择' } : {}) });
          }
        }).catch(() => {});
        throw error;
      }
      await storage.remove([ticket.sourceFileId, ticket.quarantineFileId].filter(Boolean)).catch(() => {});
      return { status: 'complete', ticketId, fileId: published };
    },
    async initialize(payload, ctx) {
      if (!ctx.isAdmin) fail('FORBIDDEN', '只有运营者可以初始化社区');
      const city = string(payload.city, '城市', 1, 30); const contact = string(payload.contact, '联系方式', 1, 160);
      if (!Array.isArray(payload.areas) || !payload.areas.length || payload.areas.length > 20) fail('INVALID_INPUT', '请设置 1–20 个开放片区');
      const areas = [...new Set(payload.areas.map(value => string(value, '片区', 1, 40)))];
      await repo.transaction(async tx => {
        await requireUser(tx, ctx.userId, ctx.lifecycleId);
        await tx.set('settings', 'main', { city, areas, contact, updatedAt: now() });
        const definitions = [
          { id: 'neighbors', name: '爱宠邻里', description: '聊陪伴、分享相处的小事；暂时没养宠，也可以在这里认识同好。', accent: '#EF725B', icon: '邻' },
          { id: 'cat_friends', name: '猫咪慢生活', description: '猫咪的日常、行为与照护，一起读懂每一声喵。', accent: '#9A88BD', icon: '猫' },
          { id: 'dog_walks', name: '汪星人日常', description: '聊狗狗的生活习惯、友善互动和每日散步。', accent: '#79A6BE', icon: '汪' },
          { id: 'small_pets', name: '小宠乐园', description: '兔子、仓鼠、豚鼠与小型哺乳宠物，记录小小身体的大大日常。', accent: '#B39B71', icon: '小' },
          { id: 'birds', name: '羽毛朋友', description: '观察宠物鸟的鸣叫、互动和生活环境，分享羽毛朋友的日常。', accent: '#7DA58C', icon: '羽' },
          { id: 'aquatics', name: '水族日记', description: '鱼、虾、螺与水草造景，交流水族照护和缸里的小发现。', accent: '#75A7B5', icon: '水' },
          { id: 'exotics', name: '异宠观察', description: '龟、蜥蜴及其他特别的宠物；按动物种类选择自己想看的内容。', accent: '#92A879', icon: '异' },
          { id: 'beginners', name: '新手养宠', description: '从准备迎接到日常照护，分享实用问题和有依据的养宠知识。', accent: '#C19483', icon: '新' }
        ];
        for (let sort = 0; sort < definitions.length; sort++) {
          const { id, ...definition } = definitions[sort]; const existing = await tx.get('circles', id);
          if (!existing) await tx.set('circles', id, { ...definition, sort, active: true, memberCount: 0, createdAt: now() });
        }
      });
      return { success: true };
    },
    async getPetStats(payload, ctx) {
      if (!ctx.isAdmin) fail('FORBIDDEN', '只有运营者可以查看宠物统计');
      const users = await allRecords('users', { status: 'active' });
      const byType = { cat: 0, dog: 0, other: 0 }; let profilesWithPet = 0; let publicPetProfiles = 0;
      for (const user of users) {
        if (!user.pet) continue;
        profilesWithPet++;
        if (user.showPet === true) publicPetProfiles++;
        byType[['cat', 'dog', 'other'].includes(user.pet.type) ? user.pet.type : 'other']++;
      }
      return { totalUsers: users.length, profilesWithPet, profilesWithoutPet: users.length - profilesWithPet, publicPetProfiles, byType,
        scope: '按每个账号的首只宠物统计类型；可登记多只，未填写不代表没有宠物' };
    },
    async deleteAccount(payload, ctx) {
      const deletionToken = uid();
      await repo.transaction(async tx => {
        const me = await tx.get('users', ctx.userId);
        if (!me || me.lifecycleId !== ctx.lifecycleId || me.status === 'deleted') fail('ACCOUNT_UNAVAILABLE', '账号状态已变化，请重新进入小程序');
        if (me.deletionLeaseUntil > now()) fail('ACCOUNT_UNAVAILABLE', '账号正在清理，请稍后再试');
        await tx.set('users', ctx.userId, { ...me, status: 'deleting', deletionToken, deletionLeaseUntil: now() + 300000, updatedAt: now() });
      });
      try {
      // An external storage write can finish after deleteFile has observed no file.
      // Keep its ticket while the writer's lease is active, so a later failure or
      // process exit never loses the only durable path registered for cleanup.
      const activeUploads = await allRecords('uploads', { ownerId: ctx.userId });
      if (activeUploads.some(upload => upload.status === 'processing' && upload.leaseUntil > now()))
        fail('ACCOUNT_UNAVAILABLE', '图片仍在处理中，账号已停止参与社区，请稍后重试注销');
      // Every public mutation re-reads the user in its transaction, so no new content,
      // membership, upload or message can be created while cleanup is in progress.
      await repo.transaction(async tx => {
        const identity = await tx.get('identities', ctx.userId);
        if (!identity) return;
        const claim = identity.phoneKey ? await tx.get('phone_claims', identity.phoneKey) : null;
        if (claim && claim.userId === ctx.userId) await tx.remove('phone_claims', identity.phoneKey);
        await tx.remove('identities', ctx.userId);
      });
      await social.deleteAccount(ctx);
      await placeRun(placeEngine.cleanupUser(ctx.userId));
      for (const field of ['fromId', 'toId']) {
        for (const relation of await allRecords('follows', { [field]: ctx.userId })) {
          await repo.transaction(tx => removeFollow(tx, relation.fromId, relation.toId));
        }
      }
      for (const relation of await allRecords('likes', { userId: ctx.userId })) {
        await repo.transaction(tx => removeLike(tx, relation._id));
      }
      for (const relation of await allRecords('bookmarks', { userId: ctx.userId })) await repo.remove('bookmarks', relation._id);
      for (const membership of await allRecords('memberships', { userId: ctx.userId })) {
        await repo.transaction(async tx => {
          const current = await tx.get('memberships', membership._id); if (!current) return;
          const circle = await tx.get('circles', current.circleId);
          if (circle) await tx.set('circles', circle._id, { ...circle, memberCount: Math.max(0, (circle.memberCount || 0) - 1) });
          await tx.remove('memberships', current._id);
        });
      }
      for (const registration of await allRecords('registrations', { userId: ctx.userId })) {
        await repo.transaction(async tx => {
          const current = await tx.get('registrations', registration._id); if (!current) return;
          const event = await tx.get('events', current.eventId);
          if (event) await tx.set('events', event._id, { ...event, attendeeIds: (event.attendeeIds || []).filter(id => id !== ctx.userId) });
          await tx.remove('registrations', current._id);
        });
      }
      for (const event of await allRecords('events', { hostId: ctx.userId })) {
        await repo.transaction(async tx => {
          const current = await tx.get('events', event._id);
          if (!current) return;
          await tx.set('events', current._id, { ...current, hostId: '', status: 'cancelled', cancelReason: current.cancelReason || '组织者已注销账号', updatedAt: now() });
          if (current.status !== 'cancelled') await queueEventNotices(tx, current.attendeeIds || [], '活动已取消', `「${current.title}」的组织者已注销账号，活动已取消。`, current._id, '');
        });
      }
      for (const post of await allRecords('posts', { authorId: ctx.userId })) {
        await repo.transaction(async tx => {
          const current = await tx.get('posts', post._id); if (!current) return;
          await tx.set('posts', current._id, { ...current, text: '', title: '', topics: [], animalTypes: [], images: [], video: null, eventId: '', placeId: '', visitId: '', coverIndex: 0, likeCount: 0, deleted: true, deletedAt: now() });
        });
        for (const comment of await allRecords('comments', { targetType: 'post', targetId: post._id })) await repo.remove('comments', comment._id);
        await clearPostReactions(post._id);
        await clearPostNotices(post._id);
      }
      for (const comment of await allRecords('comments', { authorId: ctx.userId })) {
        await repo.transaction(async tx => {
          const current = await tx.get('comments', comment._id); if (!current) return;
          const collection = current.targetType === 'post' ? 'posts' : 'events';
          const target = await tx.get(collection, current.targetId);
          if (target && !current.deleted) await tx.set(collection, target._id, { ...target, commentCount: Math.max(0, (target.commentCount || 0) - 1) });
          await tx.remove('comments', current._id);
        });
      }
      // Remove copied names in replies and notifications as well as the profile itself.
      for (const comment of await allRecords('comments', { replyToAuthorId: ctx.userId })) {
        await repo.transaction(async tx => {
          const current = await tx.get('comments', comment._id);
          if (current) await tx.set('comments', current._id, { ...current, replyToAuthorId: '', replyToId: null });
        });
      }
      for (const field of ['toId', 'actorId']) for (const message of await allRecords('messages', { [field]: ctx.userId })) await repo.remove('messages', message._id);
      for (const job of await allRecords('outbox', { actorId: ctx.userId })) await repo.remove('outbox', job._id);
      for (const job of await allRecords('outbox', {})) {
        if (!job.recipientIds.includes(ctx.userId)) continue;
        await repo.transaction(async tx => {
          const current = await tx.get('outbox', job._id); if (!current) return;
          await tx.set('outbox', job._id, { ...current, recipientIds: current.recipientIds.filter(id => id !== ctx.userId) });
        });
      }
      for (const field of ['fromId', 'toId']) for (const block of await allRecords('blocks', { [field]: ctx.userId })) await repo.remove('blocks', block._id);
      for (const upload of await allRecords('uploads', { ownerId: ctx.userId })) {
        if (storage) {
          const files = [...new Set([upload.fileId, upload.publishingFileId, upload.sourceFileId, upload.quarantineFileId, ...(upload.cleanupFileIds || []),
            upload.cloudPath && storage.fileIdForPath && storage.fileIdForPath(upload.cloudPath)].filter(Boolean))];
          if (files.length) await storage.remove(files);
          if (upload.traceId && storage.removeReview) await storage.removeReview({ traceId: upload.traceId, ticketId: upload._id });
        }
        await repo.remove('uploads', upload._id);
      }
      for (const report of await allRecords('reports', { reporterId: ctx.userId })) await repo.remove('reports', report._id);
      for (const record of await allRecords('rate_limits', { userId: ctx.userId })) await repo.remove('rate_limits', record._id);
      await repo.transaction(async tx => {
        const me = await tx.get('users', ctx.userId);
        if (!me || me.lifecycleId !== ctx.lifecycleId || me.deletionToken !== deletionToken) fail('ACCOUNT_UNAVAILABLE', '账号清理状态已变化，请重试');
        await tx.set('users', ctx.userId, { status: 'deleted', lifecycleId: ctx.lifecycleId, deletedAt: now() });
      });
      return { deleted: true };
      } finally {
        await repo.transaction(async tx => {
          const me = await tx.get('users', ctx.userId);
          if (me && me.status === 'deleting' && me.deletionToken === deletionToken)
            await tx.set('users', ctx.userId, { ...me, deletionToken: '', deletionLeaseUntil: 0 });
        }).catch(() => {});
      }
    }
  };

  return {
    async handle(action, payload = {}, context = {}) {
      if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, action)) fail('UNKNOWN_ACTION', '暂不支持此操作');
      if (!object(payload)) fail('INVALID_INPUT', '请求参数不正确');
      for (const key of ['openid', 'openId', '_openid', 'userId', 'isAdmin', 'admin']) {
        // These actions receive only a target's public ID; actor identity remains trusted context.
        if (Object.prototype.hasOwnProperty.call(payload, key) && !(key === 'userId' && ['blockUser', 'followUser', 'getUserProfile'].includes(action))) fail('INVALID_INPUT', '请求不能包含身份或权限字段');
      }
      const identity = await authenticated(context.openid, action);
      const gated = ['createPost', 'addComment', 'createEvent', 'updateEvent', 'createUploadTicket', 'completeUpload', 'getUploadStatus', 'sendFriendRequest', 'openDirectChat', 'createGroupChat', 'sendChatMessage'].includes(action) ||
        placeDomain.VERIFIED.includes(action) ||
        action === 'respondFriendRequest' && payload.accept === true ||
        (['joinCircle', 'joinEvent'].includes(action) && payload.join === true) || action === 'followUser' && payload.follow === true ||
        action === 'likePost' && payload.like === true || action === 'bookmarkPost' && payload.bookmark === true;
      if (gated) await requireVerifiedUser(repo, identity.userId, identity.lifecycleId);
      if (isPositiveAction(action, payload)) await rateLimiter.consume(identity.userId, action, identity.lifecycleId);
      const result = await handlers[action](payload, { ...identity, openid: context.openid });
      // Event changes are committed with durable jobs. Delivery failure does not undo
      // a successful cancellation; the next request (or scheduled drain) retries it.
      await flushOutbox().catch(() => {});
      return result;
    },
    flushOutbox() {
      return flushOutbox();
    },
    runMaintenance(options) {
      return createMaintenance({ repository: repo, storage, now, randomId: uid, flushOutbox, fail }).run(options);
    }
  };
}

module.exports = { createService, AppError, idFor, TOPICS, TOPIC_ALIASES, ANIMAL_TYPES, TERMS_VERSION, PRIVACY_VERSION };
