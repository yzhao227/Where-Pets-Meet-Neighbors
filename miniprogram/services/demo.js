const { createSeed, newUser, demoPolicies, createCircles, welcomeMessage } = require('../data/seed');
const { CATALOG_VERSION } = require('../data/curated');
const { syncCatalogue } = require('../data/catalogue');
const TOPICS = require('../data/topics');
const { IDS: ANIMAL_TYPES, normalize: normalizeAnimals } = require('../data/animal-types');
const { syncCircles } = require('../data/circles');
const placeDomain = require('./place-engine');
const placeCatalogue = require('../data/nearby-catalogue');
const neighbors = require('../data/neighbor-profile');
const social = require('./social');
const petData = require('../data/pets');
const petService = require('./pets');

const STORAGE_KEY = 'youban.demo.v1';
const PAGE_SIZE = 20;
const TERMS_VERSION = '2026-09-29';
const PRIVACY_VERSION = '2026-09-29';
const MESSAGE_CATEGORIES = ['all', 'interactions', 'comments', 'follows', 'system'];
const POST_VISIBILITIES = ['public', 'friends', 'private'];
function visibility(value) {
  if (!POST_VISIBILITIES.includes(value)) throw failure('INVALID_INPUT', '请选择公开、仅好友可见或仅自己可见');
  return value;
}
function postVisibility(post) { return post.visibility === undefined ? 'public' : POST_VISIBILITIES.includes(post.visibility) ? post.visibility : 'private'; }
function messageKind(record) { return ['like', 'bookmark', 'follow', 'comment', 'reply', 'system'].includes(record.kind) ? record.kind : record.targetType === 'post' ? 'comment' : 'system'; }
function messageCategory(record) { return ({ like: 'interactions', bookmark: 'interactions', follow: 'follows', comment: 'comments', reply: 'comments' })[messageKind(record)] || 'system'; }
function messageCounts(records) {
  const categoryUnread = { interactions: 0, comments: 0, follows: 0, system: 0 };
  records.forEach(record => { if (!record.isRead) categoryUnread[messageCategory(record)] += 1; });
  return { unreadCount: Object.values(categoryUnread).reduce((sum, count) => sum + count, 0), categoryUnread };
}
function messagePage(records, payload, matches = () => true) {
  const category = payload.category === undefined ? 'all' : payload.category;
  if (!MESSAGE_CATEGORIES.includes(category)) throw failure('INVALID_INPUT', '请选择有效的消息分类');
  const limit = payload.limit === undefined ? PAGE_SIZE : payload.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw failure('INVALID_INPUT', '每页消息数量需为 1–50');
  let anchor;
  if (payload.cursor !== undefined && payload.cursor !== null && payload.cursor !== '') {
    const match = typeof payload.cursor === 'string' && /^m_(\d{1,16})_([A-Za-z0-9_-]{1,120})$/.exec(payload.cursor);
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw failure('INVALID_INPUT', '消息分页位置无效，请刷新后重试');
    anchor = { createdAt: Number(match[1]), id: match[2] };
  }
  const selected = records.filter(record => (category === 'all' || messageCategory(record) === category) && matches(record) && (!anchor || record.createdAt < anchor.createdAt || record.createdAt === anchor.createdAt && record.id < anchor.id))
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const items = selected.slice(0, limit); const last = items[items.length - 1];
  return { items, ...(selected.length > limit ? { nextCursor: 'm_' + last.createdAt + '_' + last.id } : {}) };
}

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function textField(value, name, min, max) {
  if (typeof value !== 'string') throw failure('INVALID_INPUT', '请填写' + name);
  const text = value.trim();
  const length = Array.from(text).length;
  if (length < min || length > max) throw failure('INVALID_INPUT', name + '需为 ' + min + '–' + max + ' 字');
  return text;
}

function animalList(value, name, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some(item => !ANIMAL_TYPES.includes(item))) throw failure('INVALID_INPUT', name + '最多选择 ' + max + ' 个有效动物种类');
  return Array.from(new Set(value));
}

function animalFilters(payload) {
  const selected = payload.animalType === undefined ? '' : payload.animalType;
  if (typeof selected !== 'string' || selected && selected !== 'unclassified' && !ANIMAL_TYPES.includes(selected)) throw failure('INVALID_INPUT', '请选择有效的动物分类');
  const excluded = animalList(payload.excludedAnimalTypes, '屏蔽种类', ANIMAL_TYPES.length);
  return value => {
    const types = normalizeAnimals(value);
    return (!selected || (selected === 'unclassified' ? !types.length : types.includes(selected))) && !types.some(type => excluded.includes(type));
  };
}
function videoMetadata(value) {
  if (!Number.isFinite(value.durationSeconds) || value.durationSeconds < 1 || value.durationSeconds > 60 ||
    !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 20 * 1024 * 1024) throw failure('INVALID_VIDEO', '视频需为 1–60 秒且不超过 20 MB');
  const result = { durationSeconds: value.durationSeconds, bytes: value.bytes };
  ['width', 'height'].forEach(field => {
    if (value[field] !== undefined) {
      if (!Number.isInteger(value[field]) || value[field] < 1 || value[field] > 16384) throw failure('INVALID_VIDEO', '视频尺寸无效');
      result[field] = value[field];
    }
  });
  return result;
}
function videoView(value) {
  if (!value || typeof value !== 'object' || typeof value.url !== 'string' || !value.url) return null;
  return { url: value.url, ...(value.poster ? { poster: value.poster } : {}), durationSeconds: value.durationSeconds,
    ...(value.width ? { width: value.width } : {}), ...(value.height ? { height: value.height } : {}) };
}

function createDemoService(platform, options) {
  const opts = options || {};
  const now = opts.now || Date.now;
  function placeRun(state, operation) {
    const engine = placeDomain.createPlaceEngine({ catalogue: placeCatalogue, now, newId: () => id(state, 'place'), fail: (code, message) => { throw failure(code, message); } });
    const rows = key => state[key] || (state[key] = []);
    const store = {
      get: (key, recordId) => rows(key).find(item => item.id === recordId) || null,
      all: (key, filters) => rows(key).filter(item => Object.entries(filters).every(([field, value]) => item[field] === value)),
      set: (key, recordId, value) => { const items = rows(key); const index = items.findIndex(item => item.id === recordId); const row = { ...value, id: recordId }; if (index < 0) items.push(row); else items[index] = row; },
      remove: (key, recordId) => { state[key] = rows(key).filter(item => item.id !== recordId); },
      clearAttribution: (recordId, userId) => { const current = rows('place_records').find(item => item.id === recordId); if (current && current.updatedBy === userId) current.updatedBy = ''; },
      cleanupSubmission: (recordId, userId) => {
        const items = rows('nearby_submissions'); const index = items.findIndex(item => item.id === recordId); const current = items[index];
        if (!current || current.userId !== userId) return;
        if (current.publishedId) items[index] = { ...placeDomain.anonymousSubmission(current), id: recordId };
        else state.nearby_submissions = items.filter(item => item.id !== recordId);
      }
    };
    return placeDomain.driveSync(operation(engine), store);
  }
  const storageKey = opts.storageKey || STORAGE_KEY;

  function isSavedHttpImage(filePath) {
    // DevTools represents durable device files as HTTP URLs (for example
    // http://store_... or http://usr/...). Trust the native saved-file list,
    // rather than accepting arbitrary URLs or guessing a virtual path prefix.
    return new Promise((resolve, reject) => {
      const unavailable = () => reject(failure('LOCAL_IMAGE_CHECK_FAILED', '暂时无法检查本机照片，请点击重新检查与重试图片'));
      if (!platform || typeof platform.getSavedFileList !== 'function') return unavailable();
      try {
        platform.getSavedFileList({
          success: result => resolve(!!(result && Array.isArray(result.fileList) && result.fileList.some(file => file && file.filePath === filePath))),
          fail: unavailable
        });
      } catch (_) { unavailable(); }
    });
  }

  function persist(state) {
    if (!platform || typeof platform.setStorageSync !== 'function') throw failure('STORAGE_UNAVAILABLE', '无法保存本机演示数据，请检查存储空间后重试');
    try { platform.setStorageSync(storageKey, clone(state)); }
    catch (error) { throw failure('STORAGE_UNAVAILABLE', '本机存储空间不足或不可用，本次操作未保存'); }
  }

  function load() {
    if (!platform || typeof platform.getStorageSync !== 'function') throw failure('STORAGE_UNAVAILABLE', '无法读取本机演示数据');
    let saved;
    try { saved = platform.getStorageSync(storageKey); }
    catch (error) { throw failure('STORAGE_UNAVAILABLE', '无法读取本机演示数据，请重试'); }
    if (saved && saved.version === 1 && Array.isArray(saved.users)) {
      const state = clone(saved);
      if (upgrade(state)) persist(state);
      return state;
    }
    if (saved) throw failure('STORAGE_INVALID', '本机演示数据格式无法读取，请先备份或清除小程序缓存');
    const state = createSeed(now());
    social.upgrade(state);
    persist(state);
    return state;
  }

  // Keep the original storage key and data version. Upgrade only missing fields;
  // never replace user-written content, replay seeds, or publish an old profile.
  function upgrade(state) {
    let changed = false;
    placeDomain.TABLES.forEach(key => { if (!Array.isArray(state[key])) { state[key] = []; changed = true; } });
    if (social.upgrade(state)) changed = true;
    if (syncCircles(state)) changed = true;
    ['likes', 'bookmarks', 'follows'].forEach(key => {
      if (!Array.isArray(state[key])) { state[key] = []; changed = true; }
    });
    state.users.forEach(user => {
      if (typeof user.publicProfile !== 'boolean') { user.publicProfile = false; changed = true; }
      if (typeof user.showPet !== 'boolean') { user.showPet = false; changed = true; }
      if (typeof user.neighborVisible !== 'boolean') { user.neighborVisible = false; changed = true; }
      if (typeof user.neighborAreaId !== 'string') { user.neighborAreaId = ''; changed = true; }
      if (typeof user.residenceSharing !== 'boolean') { user.residenceSharing = false; changed = true; }
      if (user.residenceCell === undefined) { user.residenceCell = null; changed = true; }
      if (user.residenceUpdatedAt === undefined) { user.residenceUpdatedAt = null; changed = true; }
      const hasDemoConsent = user.demoConsent && user.demoConsent.accepted === true && user.demoConsent.source === 'demo' && user.demoConsent.termsVersion === TERMS_VERSION && user.demoConsent.privacyVersion === PRIVACY_VERSION;
      const status = user.verification && user.verification.status === 'demo_verified' && hasDemoConsent ? 'demo_verified' : 'unverified';
      if (!user.verification || user.verification.status !== status || Object.keys(user.verification).length !== 1) {
        user.verification = { status }; changed = true;
      }
    });
    state.posts.forEach(post => {
      const defaults = { title: '', kind: 'daily', topics: [], coverIndex: 0, eventId: '' };
      Object.keys(defaults).forEach(key => {
        if (post[key] === undefined) { post[key] = clone(defaults[key]); changed = true; }
      });
    });
    state.messages.forEach(message => {
      if (message.id !== 'demo-welcome') return;
      ['title', 'text'].forEach(key => {
        if (typeof message[key] === 'string') {
          const renamed = message[key].replace(/有伴|有宠(?!有邻|物)/g, '有宠有邻');
          if (renamed !== message[key]) { message[key] = renamed; changed = true; }
        }
      });
    });
    if (state.contentCatalogVersion !== CATALOG_VERSION) { updateContentCatalogue(state); changed = true; }
    return changed;
  }

  function updateContentCatalogue(state) {
    const sampleUsers = new Set(['demo-lin', 'demo-yue', 'demo-qiao', 'demo-an', 'demo-chen', 'demo-he'].filter(id => id !== state.currentUserId));
    const samplePosts = new Set(Array.from({ length: 8 }, (_, index) => 'demo-post-' + (index + 1)));
    const sampleEvents = new Set(['demo-event-coffee', 'demo-event-walk', 'demo-event-chat', 'demo-event-cats']);
    const archive = state.legacySampleArchive || { version: 1, archivedAt: now() };
    const retire = (key, matches) => {
      const records = state[key] || [];
      const removed = records.filter(matches);
      if (removed.length) archive[key] = (archive[key] || []).concat(clone(removed));
      state[key] = records.filter(record => !matches(record));
    };
    // Preserve old records (including the user's replies to sample posts) in a
    // local archive, while taking the fabricated activity out of public feeds.
    retire('posts', post => samplePosts.has(post.id));
    retire('events', event => sampleEvents.has(event.id));
    const retiredComments = new Set((state.comments || []).filter(comment => samplePosts.has(comment.targetId) || sampleEvents.has(comment.targetId) || sampleUsers.has(comment.authorId)).map(comment => comment.id));
    retire('comments', comment => retiredComments.has(comment.id));
    for (const key of ['likes', 'bookmarks']) retire(key, item => samplePosts.has(item.postId) || sampleUsers.has(item.userId));
    retire('follows', item => sampleUsers.has(item.userId) || sampleUsers.has(item.targetUserId));
    retire('blocks', item => sampleUsers.has(item.userId) || sampleUsers.has(item.blockedUserId));
    retire('reports', item => samplePosts.has(item.targetId) || sampleEvents.has(item.targetId) || retiredComments.has(item.targetId) || sampleUsers.has(item.userId));
    retire('messages', item => samplePosts.has(item.targetId) || sampleEvents.has(item.targetId) || sampleUsers.has(item.actorId) || sampleUsers.has(item.userId));
    retire('users', user => sampleUsers.has(user.id) && !state.posts.some(post => post.authorId === user.id) && !state.events.some(event => event.hostId === user.id));
    const circleDefaults = createCircles();
    for (const circle of state.circles) {
      const preset = circleDefaults.find(item => item.id === circle.id);
      const removed = circle.memberIds.filter(id => sampleUsers.has(id));
      if (removed.length) (archive.memberships || (archive.memberships = [])).push({ circleId: circle.id, memberIds: removed });
      circle.memberIds = circle.memberIds.filter(id => !sampleUsers.has(id));
      if (preset && /示例|虚构/.test(circle.description)) circle.description = preset.description;
      if (preset) circle.accent = preset.accent;
    }
    if (state.settings.city === '示例城市') state.settings.city = '';
    const sampleAreas = new Set(['示例·梧桐里', '示例·河畔街', '示例·花园路']);
    state.settings.areas = state.settings.areas.filter(area => !sampleAreas.has(area));
    const welcome = state.messages.find(item => item.id === 'demo-welcome');
    if (welcome) Object.assign(welcome, { title: welcomeMessage(welcome.userId, welcome.createdAt).title, text: welcomeMessage(welcome.userId, welcome.createdAt).text });
    syncCatalogue(state, now());
    state.legacySampleArchive = archive;
  }

  function id(state, prefix) {
    state.seq += 1;
    return 'local-' + prefix + '-' + now().toString(36) + '-' + state.seq;
  }

  function currentUser(state) {
    const user = state.users.find(item => item.id === state.currentUserId);
    if (!user) throw failure('AUTH_REQUIRED', '账号已注销，请重新进入后建立新的个人资料');
    return user;
  }

  function ownUser(user) {
    return { id: user.id, nickname: user.nickname, avatar: user.avatar, area: user.area || '', bio: user.bio || '', pet: user.pet || null, pets: petData.list(user),
      publicProfile: user.publicProfile === true, showPet: user.showPet === true, isAdmin: user.isAdmin === true,
      verification: { status: user.verification && user.verification.status === 'demo_verified' ? 'demo_verified' : 'unverified' }, ...neighbors.settings(user) };
  }

  function requireVerification(user, action, payload) {
    const always = ['createPost', 'addComment', 'createEvent', 'updateEvent', 'createUploadTicket', 'createPetUploadTicket', 'completeUpload'];
    const adding = (action === 'joinCircle' || action === 'joinEvent') && payload.join === true ||
      action === 'followUser' && payload.follow === true || action === 'likePost' && payload.like === true || action === 'bookmarkPost' && payload.bookmark === true ||
      action === 'updateProfile' && (payload.neighborVisible === true || payload.residenceSharing === true);
    if ((always.indexOf(action) !== -1 || adding || social.needsVerification(action, payload)) && (!user.verification || user.verification.status !== 'demo_verified')) {
      throw failure('VERIFICATION_REQUIRED', '请先完成本机模拟核验，再参与互动');
    }
  }

  function isBlocked(state, authorId) {
    return isBlockedPair(state, state.currentUserId, authorId);
  }

  function isBlockedPair(state, fromId, toId) {
    return state.blocks.some(item => (item.userId === fromId && item.blockedUserId === toId) || (item.userId === toId && item.blockedUserId === fromId));
  }

  function findUser(state, userId) {
    const user = state.users.find(item => item.id === userId);
    if (!user || isBlocked(state, userId)) throw failure('NOT_FOUND', '这位邻居不存在或不可见');
    return user;
  }

  function followsUser(state, fromId, toId) {
    return !isBlockedPair(state, fromId, toId) && state.follows.some(item => item.userId === fromId && item.targetUserId === toId);
  }

  function followingFor(state, userId) {
    return state.follows.filter(item => item.userId === userId && !isBlockedPair(state, userId, item.targetUserId) && state.users.some(user => user.id === item.targetUserId));
  }

  function bookmarksFor(state, userId) {
    return state.bookmarks.filter(item => item.userId === userId && state.posts.some(post => post.id === item.postId && canViewPost(state, post, userId)));
  }

  function publicUser(state, userId) {
    const user = state.users.find(item => item.id === userId);
    if (!user) return { id: userId, nickname: '已注销用户', avatar: '/assets/avatar-6.png' };
    const snippet = { id: user.id, nickname: user.nickname, avatar: user.avatar };
    if (user.isEditorial) snippet.isEditorial = true;
    if (user.showPet === true && user.pet) snippet.pet = { name: user.pet.name, type: user.pet.type };
    return snippet;
  }

  function findCircle(state, circleId) {
    const circle = state.circles.find(item => item.id === circleId);
    if (!circle) throw failure('NOT_FOUND', '圈子不存在');
    return circle;
  }

  function canViewPost(state, post, userId = state.currentUserId) {
    if (!post || isBlockedPair(state, userId, post.authorId)) return false;
    const scope = postVisibility(post);
    return post.authorId === userId || scope === 'public' || scope === 'friends' && state.friendships.some(item => item.userIds.includes(userId) && item.userIds.includes(post.authorId));
  }

  function findPost(state, postId) {
    const post = state.posts.find(item => item.id === postId);
    if (!canViewPost(state, post)) throw failure('NOT_FOUND', '这条动态已删除或不可见');
    return post;
  }

  function findEvent(state, eventId) {
    const event = state.events.find(item => item.id === eventId);
    if (!event || isBlocked(state, event.hostId)) throw failure('NOT_FOUND', '活动不存在或不可见');
    return event;
  }

  function circleView(state, circle) {
    return { id: circle.id, name: circle.name, description: circle.description, memberCount: circle.memberIds.length, isJoined: circle.memberIds.indexOf(state.currentUserId) !== -1, accent: circle.accent, icon: circle.icon };
  }

  function visibleComments(state, targetType, targetId) {
    return state.comments.filter(item => item.targetType === targetType && item.targetId === targetId && !isBlocked(state, item.authorId)).sort((a, b) => a.createdAt - b.createdAt);
  }

  function commentView(state, comment) {
    const view = { id: comment.id, author: publicUser(state, comment.authorId), text: comment.text, createdAt: comment.createdAt, isMine: comment.authorId === state.currentUserId };
    if (comment.replyToId) {
      const reply = state.comments.find(item => item.id === comment.replyToId);
      if (reply && !isBlocked(state, reply.authorId)) view.replyToName = publicUser(state, reply.authorId).nickname;
    }
    return view;
  }

  function postView(state, post) {
    const circle = findCircle(state, post.circleId);
    const associated = post.eventId && state.events.find(event => event.id === post.eventId && !isBlocked(state, event.hostId));
    const event = associated ? { id: associated.id, title: associated.title, startAt: associated.startAt, location: associated.location, status: associated.status, petPolicy: associated.petPolicy } : null;
    const video = videoView(post.video);
    return {
      id: post.id, author: publicUser(state, post.authorId), circle: { id: circle.id, name: circle.name },
      title: post.title || '', kind: post.kind || 'daily', visibility: postVisibility(post), topics: TOPICS.normalize(post.topics), animalTypes: normalizeAnimals(post.animalTypes), text: post.text,
      images: post.images.slice(), ...(video ? { video } : {}), coverIndex: post.coverIndex || 0, cover: video ? video.poster || '' : post.images[post.coverIndex || 0] || '',
      ...(post.source ? { source: clone(post.source) } : {}),
      ...(post.contentType || video ? { contentType: post.contentType || 'video' } : {}),
      ...(post.omitPublicAttribution === true ? { omitPublicAttribution: true } : {}),
      ...(post.imageCredits ? { imageCredits: post.imageCredits.map(credit => ({
        imageUrl: credit.imageUrl, originalUrl: credit.originalUrl, sourceUrl: credit.sourceUrl, author: credit.author,
        attribution: credit.attribution, licenseName: credit.licenseName,
        licenseUrl: credit.licenseUrl, modifiedDescription: credit.modifiedDescription || ''
      })) } : {}),
      eventId: event ? event.id : '', event, place: placeRun(state, engine => engine.postPlace(post)), placeId: post.placeId || '', visitId: post.authorId === state.currentUserId ? post.visitId || '' : '',
      likeCount: new Set(state.likes.filter(item => item.postId === post.id).map(item => item.userId)).size,
      isLiked: state.likes.some(item => item.postId === post.id && item.userId === state.currentUserId),
      isBookmarked: state.bookmarks.some(item => item.postId === post.id && item.userId === state.currentUserId),
      createdAt: post.createdAt, commentCount: visibleComments(state, 'post', post.id).length, isMine: post.authorId === state.currentUserId
    };
  }

  function eventView(state, event) {
    const view = { id: event.id, title: event.title, description: event.description, location: event.location, startAt: event.startAt, endAt: event.endAt, capacity: event.capacity, attendeeCount: event.attendeeIds.length, petPolicy: event.petPolicy, circleId: event.circleId, hostName: publicUser(state, event.hostId).nickname, cover: event.cover, status: event.status, isJoined: event.attendeeIds.indexOf(state.currentUserId) !== -1, isMine: event.hostId === state.currentUserId };
    if (event.cancelReason) view.cancelReason = event.cancelReason;
    return view;
  }

  function pushMessage(state, userId, title, message, targetType, targetId, actorId, kind) {
    if (!state.users.some(user => user.id === userId)) return;
    if (targetType === 'post' && !canViewPost(state, state.posts.find(item => item.id === targetId), userId)) return;
    const actor = actorId === undefined ? state.currentUserId : actorId;
    if (isBlockedPair(state, userId, actor)) return;
    if (kind && kind !== 'system' && userId === actor) return;
    if (['like', 'bookmark', 'follow'].includes(kind) && state.messages.some(item => item.userId === userId && item.actorId === actor && item.kind === kind && item.targetType === targetType && item.targetId === targetId)) return;
    state.messages.push({ id: id(state, 'message'), userId, actorId: actor, title, text: message, createdAt: now(), isRead: false, targetType: targetType || 'system', targetId: targetId || '', kind: kind || 'system' });
  }

  function visibleMessages(state, userId) {
    return state.messages.filter(message => {
      if (message.userId !== userId || isBlockedPair(state, userId, message.actorId)) return false;
      const target = message.targetType === 'post' ? state.posts.find(item => item.id === message.targetId) : message.targetType === 'event' ? state.events.find(item => item.id === message.targetId) : null;
      if (message.targetType === 'post' && target && !canViewPost(state, target, userId)) return false;
      const ownerId = target && (target.authorId || target.hostId) || (message.targetType === 'user' ? message.targetId : '');
      return !ownerId || !isBlockedPair(state, userId, ownerId);
    });
  }
  function messageView(state, record) {
    const actor = record.actorId && state.users.some(user => user.id === record.actorId) ? publicUser(state, record.actorId) : null;
    const post = record.targetType === 'post' && state.posts.find(item => item.id === record.targetId);
    const cover = post && (post.video ? post.video.poster || '' : (post.images || [])[post.coverIndex || 0] || '');
    return { id: record.id, title: record.title, text: record.text, createdAt: record.createdAt, isRead: !!record.isRead,
      targetType: record.targetType, targetId: record.targetId, kind: messageKind(record), category: messageCategory(record), ...(actor ? { actor } : {}), ...(cover ? { cover } : {}) };
  }

  function assertAdmin(user) {
    if (!user.isAdmin) throw failure('FORBIDDEN', '只有管理员可以进行这项操作');
  }

  function reportStatus(report) {
    return report.status === 'resolved' || report.status === 'dismissed' ? report.status : 'open';
  }

  function reportTarget(state, report) {
    let target;
    let summary;
    let targetTypeForLink = report.targetTypeForLink || report.targetType;
    let targetIdForLink = report.targetIdForLink || report.targetId;
    if (report.targetType === 'post') {
      target = state.posts.find(post => post.id === report.targetId);
      summary = target && (canViewPost(state, target) ? target.text || '图片动态' : '内容已不可见');
    } else if (report.targetType === 'comment') {
      target = state.comments.find(comment => comment.id === report.targetId);
      summary = target && target.text;
      targetTypeForLink = report.targetTypeForLink || (target && target.targetType) || 'post';
      targetIdForLink = report.targetIdForLink || (target && target.targetId) || '';
      if (target && target.targetType === 'post' && !canViewPost(state, state.posts.find(post => post.id === target.targetId))) summary = '内容已不可见';
    } else if (report.targetType === 'event') {
      target = state.events.find(event => event.id === report.targetId);
      summary = target && target.title;
    } else if (report.targetType === 'user') {
      target = state.users.find(user => user.id === report.targetId);
      summary = target && target.nickname;
    }
    return { targetSummary: summary ? Array.from(summary).slice(0, 180).join('') : '内容已删除', targetTypeForLink, targetIdForLink };
  }

  function reportView(state, report) {
    return Object.assign({ id: report.id, targetType: report.targetType, targetId: report.targetId, reason: report.reason, description: report.description || '', status: reportStatus(report), createdAt: report.createdAt, reporter: publicUser(state, report.userId) }, reportTarget(state, report));
  }

  function validateEvent(state, payload) {
    const title = textField(payload.title, '活动标题', 1, 60);
    const description = textField(payload.description, '活动介绍', 1, 1000);
    const location = textField(payload.location, '活动地点', 1, 120);
    const startAt = payload.startAt;
    const endAt = payload.endAt;
    if (!Number.isSafeInteger(startAt) || startAt > 8640000000000000 || startAt <= now()) throw failure('INVALID_INPUT', '请选择未来的活动开始时间');
    if (!Number.isSafeInteger(endAt) || endAt > 8640000000000000 || endAt <= startAt) throw failure('INVALID_INPUT', '结束时间需晚于开始时间');
    if (!Number.isInteger(payload.capacity) || payload.capacity < 2 || payload.capacity > 100) throw failure('INVALID_INPUT', '活动人数需为 2–100 的整数');
    if (['none', 'optional', 'dog'].indexOf(payload.petPolicy) === -1) throw failure('INVALID_INPUT', '请选择有效的携宠规则');
    findCircle(state, payload.circleId);
    return { title, description, location, startAt, endAt, capacity: payload.capacity, petPolicy: payload.petPolicy, circleId: payload.circleId };
  }

  function offsetFor(cursor) {
    let offset = 0;
    if (cursor !== undefined && cursor !== null && cursor !== '') {
      if (typeof cursor !== 'string' || !/^\d+$/.test(cursor)) throw failure('INVALID_INPUT', '分页参数无效，请刷新后重试');
      offset = Number(cursor);
      if (!Number.isSafeInteger(offset)) throw failure('INVALID_INPUT', '分页参数无效，请刷新后重试');
    }
    return offset;
  }

  function listPosts(state, payload) {
    if (payload.circleId) findCircle(state, payload.circleId);
    const feed = payload.feed === undefined ? 'discover' : payload.feed;
    if (['discover', 'following', 'circles'].indexOf(feed) === -1) throw failure('INVALID_INPUT', '请选择有效的内容分类');
    const rawTopic = payload.topic === undefined ? '' : textField(payload.topic, '话题', 0, 40);
    const topic = TOPICS.normalizeTopic(rawTopic);
    if (rawTopic && !topic) throw failure('INVALID_INPUT', '请选择已有话题');
    const query = textField(payload.query === undefined ? '' : payload.query, '搜索内容', 0, 60).toLowerCase();
    const matchesAnimals = animalFilters(payload);
    if (payload.mine !== undefined && typeof payload.mine !== 'boolean') throw failure('INVALID_INPUT', '我的动态筛选参数无效');
    if (payload.bookmarked !== undefined && typeof payload.bookmarked !== 'boolean') throw failure('INVALID_INPUT', '收藏筛选参数无效');
    const authorId = payload.authorId === undefined ? '' : textField(payload.authorId, '作者', 0, 128);
    const joinedCircleIds = state.circles.filter(circle => circle.memberIds.indexOf(state.currentUserId) !== -1).map(circle => circle.id);
    const items = state.posts.filter(item => {
      if (!matchesAnimals(item.animalTypes)) return false;
      if (!canViewPost(state, item)) return false;
      if (payload.circleId && item.circleId !== payload.circleId) return false;
      if (payload.mine && item.authorId !== state.currentUserId) return false;
      if (authorId && item.authorId !== authorId) return false;
      if (feed === 'following' && !followsUser(state, state.currentUserId, item.authorId)) return false;
      if (feed === 'circles' && joinedCircleIds.indexOf(item.circleId) === -1) return false;
      if (payload.bookmarked && !state.bookmarks.some(mark => mark.userId === state.currentUserId && mark.postId === item.id)) return false;
      const topics = TOPICS.normalize(item.topics);
      if (topic && !topics.includes(topic)) return false;
      const aliases = Object.keys(TOPICS.ALIASES).filter(alias => topics.includes(TOPICS.ALIASES[alias]));
      return !query || [item.title, item.text].concat(topics, aliases).join(' ').toLowerCase().indexOf(query) !== -1;
    }).sort((a, b) => b.createdAt - a.createdAt || Number(!!a.catalogManaged) - Number(!!b.catalogManaged) ||
      (a.catalogManaged && b.catalogManaged ? a.catalogOrder - b.catalogOrder : 0) || b.id.localeCompare(a.id));
    const offset = offsetFor(payload.cursor);
    const result = { items: items.slice(offset, offset + PAGE_SIZE).map(post => postView(state, post)) };
    if (offset + PAGE_SIZE < items.length) result.nextCursor = String(offset + PAGE_SIZE);
    return result;
  }

  function dispatch(state, action, payload, savedHttpImage) {
    if (action === 'getPolicies') return clone(demoPolicies(state.settings.contact));
    if (action === 'bootstrap') {
      let user = state.users.find(item => item.id === state.currentUserId);
      if (!user) {
        user = newUser(state.currentUserId, true);
        state.users.push(user);
        persist(state);
      }
      return { mode: 'demo', user: ownUser(user), registration: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, phoneEnabled: false, policyConfigured: false }, settings: state.settings, circles: state.circles.map(circle => circleView(state, circle)), stats: { postCount: state.posts.filter(post => post.authorId === user.id).length, joinedCircleCount: state.circles.filter(circle => circle.memberIds.indexOf(user.id) !== -1).length, joinedEventCount: state.events.filter(event => event.status === 'active' && event.attendeeIds.indexOf(user.id) !== -1).length, bookmarkCount: bookmarksFor(state, user.id).length, followingCount: followingFor(state, user.id).length } };
    }
    const user = currentUser(state);
    requireVerification(user, action, payload);
    if (petService.handles(action)) {
      const response = petService.dispatch(state, user, action, payload, { now, id, failure, platform });
      if (action !== 'listPets') persist(state);
      return response;
    }
    if (placeDomain.ACTIONS.includes(action)) {
      if ((placeDomain.VERIFIED.includes(action) || action === 'bookmarkPlace' && payload.bookmark === true) && (!user.verification || user.verification.status !== 'demo_verified')) throw failure('VERIFICATION_REQUIRED', '请先完成本机模拟核验，再投稿、收藏、记录到访或纠错');
      // A rejected submission never persists this new lifecycle or consumes its
      // sequence. Re-created accounts receive a fresh value on their next submit.
      if (action === 'submitNearbySubmission' && !user.nearbySubmissionLifecycleId) user.nearbySubmissionLifecycleId = id(state, 'submission-life');
      const response = placeRun(state, engine => engine.execute(action, payload, { userId: user.id, lifecycleId: user.nearbySubmissionLifecycleId || '', isAdmin: user.isAdmin === true }));
      if (placeDomain.WRITES.includes(action)) persist(state);
      return response;
    }
    if (social.handles(action)) {
      const response = social.dispatch(state, user, action, payload, { now, id, failure, textField, isBlockedPair });
      if (social.writes(action)) persist(state);
      return response;
    }
    let result;
    switch (action) {
      case 'verifyPhone': throw failure('PHONE_UNAVAILABLE', '本机演示不支持真实手机号核验，请使用模拟核验；不要提交手机号或微信授权码');
      case 'demoVerifyIdentity': {
        if (Object.keys(payload).some(key => key !== 'consent')) throw failure('INVALID_INPUT', '模拟核验只接收协议确认，不接收手机号、授权码或身份凭证');
        const consent = payload.consent;
        if (consent && (typeof consent !== 'object' || Array.isArray(consent) || Object.keys(consent).some(key => ['accepted', 'termsVersion', 'privacyVersion'].indexOf(key) === -1))) throw failure('INVALID_INPUT', '协议确认格式不正确，请勿提交其他个人信息');
        if (!consent || consent.accepted !== true || consent.termsVersion !== TERMS_VERSION || consent.privacyVersion !== PRIVACY_VERSION) throw failure('CONSENT_REQUIRED', '请阅读并同意当前版本的用户协议和隐私说明，再完成模拟核验');
        if (user.verification.status === 'demo_verified') return { user: ownUser(user) };
        user.verification = { status: 'demo_verified' };
        user.demoConsent = { accepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: now(), source: 'demo' };
        result = { user: ownUser(user) };
        break;
      }
      case 'getHealth': {
        assertAdmin(user);
        return { mode: 'demo', policyConfigured: false, phoneEnabled: false, uploadsEnabled: false, maintenanceEnabled: false, pendingNotifications: 0, pendingUploads: state.uploads.filter(item => item.status === 'pending').length, rateLimitRecords: 0, countsLimited: false, maintenance: { lastRunAt: null, lastSuccessAt: null, lastErrorCode: null } };
      }
      case 'getPetStats': {
        assertAdmin(user);
        const members = state.users.filter(item => !item.isEditorial);
        const profiles = members.filter(item => !!item.pet);
        const byType = { cat: 0, dog: 0, other: 0 };
        profiles.forEach(item => { byType[['cat', 'dog', 'other'].indexOf(item.pet.type) === -1 ? 'other' : item.pet.type] += 1; });
        return { totalUsers: members.length, profilesWithPet: profiles.length, profilesWithoutPet: members.length - profiles.length,
          publicPetProfiles: profiles.filter(item => item.showPet === true).length, byType,
          scope: '按每个账号的首只宠物统计类型；可登记多只，未填写不代表没有宠物' };
      }
      case 'listCircles': return { items: state.circles.map(circle => circleView(state, circle)) };
      case 'listNeighbors': {
        const reject = (code, message) => { throw failure(code, message); };
        const filter = neighbors.filters(payload, reject);
        const limit = payload.limit === undefined ? PAGE_SIZE : payload.limit;
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw failure('INVALID_INPUT', '每页数量需为1–50');
        const cursor = payload.cursor === undefined || payload.cursor === null || payload.cursor === '' ? '' : payload.cursor;
        if (typeof cursor !== 'string' || cursor && !/^[A-Za-z0-9_-]{1,120}$/.test(cursor)) throw failure('INVALID_INPUT', '邻居分页位置无效');
        const participating = person => neighbors.isParticipant(person) && person.verification && person.verification.status === 'demo_verified';
        const viewer = participating(user) ? user : { neighborVisible: false };
        const selected = state.users.filter(person => person.id !== user.id && participating(person) && !isBlocked(state, person.id) && neighbors.matches(person, filter) && (!cursor || person.id < cursor))
          .sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
        const rows = selected.slice(0, limit);
        return { items: rows.map(person => ({ ...publicUser(state, person.id), ...neighbors.publicFields(person, viewer), isFollowing: followsUser(state, user.id, person.id) })),
          ...(selected.length > limit ? { nextCursor: rows[rows.length - 1].id } : {}) };
      }
      case 'getCircle': {
        const circle = findCircle(state, payload.id);
        const page = listPosts(state, { circleId: circle.id, cursor: payload.cursor, excludedAnimalTypes: payload.excludedAnimalTypes });
        return { circle: circleView(state, circle), posts: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
      }
      case 'joinCircle': {
        if (typeof payload.join !== 'boolean') throw failure('INVALID_INPUT', '请选择加入或退出圈子');
        const circle = findCircle(state, payload.id);
        circle.memberIds = circle.memberIds.filter(memberId => memberId !== user.id);
        if (payload.join) circle.memberIds.push(user.id);
        result = { circle: circleView(state, circle) };
        break;
      }
      case 'listPosts': return listPosts(state, payload);
      case 'getPost': {
        const post = findPost(state, payload.id);
        return { post: postView(state, post), comments: visibleComments(state, 'post', post.id).map(comment => commentView(state, comment)) };
      }
      case 'likePost':
      case 'bookmarkPost': {
        const isLike = action === 'likePost';
        const enabled = isLike ? payload.like : payload.bookmark;
        if (typeof enabled !== 'boolean') throw failure('INVALID_INPUT', isLike ? '请选择喜欢或取消喜欢' : '请选择收藏或取消收藏');
        const post = findPost(state, payload.id);
        const key = isLike ? 'likes' : 'bookmarks';
        const exists = state[key].some(item => item.userId === user.id && item.postId === post.id);
        if (exists === enabled) return { post: postView(state, post) };
        state[key] = state[key].filter(item => !(item.userId === user.id && item.postId === post.id));
        if (enabled) {
          state[key].push({ userId: user.id, postId: post.id, createdAt: now() });
          pushMessage(state, post.authorId, isLike ? '收到一个赞' : '分享被收藏了', isLike ? '赞了你的分享' : '收藏了你的分享', 'post', post.id, user.id, isLike ? 'like' : 'bookmark');
        }
        result = { post: postView(state, post) };
        break;
      }
      case 'followUser': {
        if (typeof payload.follow !== 'boolean') throw failure('INVALID_INPUT', '请选择关注或取消关注');
        if (payload.userId === user.id) throw failure('INVALID_INPUT', '不能关注自己');
        const target = findUser(state, payload.userId);
        const exists = followsUser(state, user.id, target.id);
        if (exists === payload.follow) return { success: true, isFollowing: exists };
        state.follows = state.follows.filter(item => !(item.userId === user.id && item.targetUserId === target.id));
        if (payload.follow) {
          state.follows.push({ userId: user.id, targetUserId: target.id, createdAt: now() });
          pushMessage(state, target.id, '有新的关注', '开始关注你了', 'user', user.id, user.id, 'follow');
        }
        result = { success: true, isFollowing: payload.follow };
        break;
      }
      case 'listFollowing': {
        const offset = offsetFor(payload.cursor);
        const following = followingFor(state, user.id).sort((a, b) => b.createdAt - a.createdAt || a.targetUserId.localeCompare(b.targetUserId));
        const page = { items: following.slice(offset, offset + PAGE_SIZE).map(item => publicUser(state, item.targetUserId)) };
        if (offset + PAGE_SIZE < following.length) page.nextCursor = String(offset + PAGE_SIZE);
        return page;
      }
      case 'getUserProfile': {
        const target = findUser(state, payload.userId);
        const isMine = target.id === user.id;
        const showDetails = isMine || target.publicProfile === true;
        const profile = Object.assign(publicUser(state, target.id), {
          publicProfile: target.publicProfile === true, showPet: target.showPet === true, bio: showDetails ? target.bio : '', pet: showDetails || target.showPet === true ? target.pet : null, pets: petData.publicList(target, target.id === user.id, now()),
          isMine, isFollowing: followsUser(state, user.id, target.id),
          postCount: state.posts.filter(post => post.authorId === target.id && canViewPost(state, post)).length,
          followerCount: state.follows.filter(item => item.targetUserId === target.id && !isBlockedPair(state, item.userId, target.id) && state.users.some(person => person.id === item.userId)).length,
          followingCount: followingFor(state, target.id).length
        });
        const posts = listPosts(state, { authorId: target.id, cursor: payload.cursor, excludedAnimalTypes: payload.excludedAnimalTypes });
        const response = { user: profile, posts: posts.items };
        if (posts.nextCursor) response.nextCursor = posts.nextCursor;
        return response;
      }
      case 'createPost': {
        const scope = visibility(payload.visibility === undefined ? 'public' : payload.visibility);
        const circle = findCircle(state, payload.circleId);
        if (circle.memberIds.indexOf(user.id) === -1) throw failure('NOT_MEMBER', '请先加入这个圈子再发布动态');
        const text = textField(payload.text === undefined ? '' : payload.text, '动态正文', 0, 1000);
        const title = textField(payload.title === undefined ? '' : payload.title, '动态标题', 0, 40);
        const kind = payload.kind === undefined ? 'daily' : payload.kind;
        if (['daily', 'question', 'meetup'].indexOf(kind) === -1) throw failure('INVALID_INPUT', '请选择日常、提问或约伴');
        const selectedTopics = payload.topics === undefined ? [] : payload.topics;
        if (!Array.isArray(selectedTopics) || selectedTopics.length > 3 || selectedTopics.some(topic => typeof topic !== 'string' || !TOPICS.normalizeTopic(topic))) throw failure('INVALID_INPUT', '最多选择 3 个已有话题');
        const topics = TOPICS.normalize(selectedTopics);
        const animalTypes = animalList(payload.animalTypes, '动物种类', 3);
        const images = payload.images === undefined ? [] : payload.images;
        if (!Array.isArray(images) || images.length > 3 || images.some(fileId => typeof fileId !== 'string' || !fileId)) throw failure('INVALID_INPUT', '最多添加 3 张图片');
        const requestedVideo = payload.video === undefined || payload.video === null ? null : payload.video;
        if (requestedVideo !== null && (!requestedVideo || typeof requestedVideo !== 'object' || Array.isArray(requestedVideo) || typeof requestedVideo.url !== 'string' || !requestedVideo.url || requestedVideo.poster)) throw failure('INVALID_INPUT', '请选择已保存的视频，视频封面暂不支持另行设置');
        if (requestedVideo && images.length) throw failure('INVALID_INPUT', '图片与视频不能同时发布');
        const videoUpload = requestedVideo && state.uploads.find(upload => upload.userId === user.id && upload.purpose !== 'pet' && upload.mediaType === 'video' && upload.status === 'complete' && upload.fileId === requestedVideo.url && !upload.postId);
        if (requestedVideo && !videoUpload) throw failure('UPLOAD_UNAVAILABLE', '视频只能使用本人已保存且尚未发布的上传记录');
        const video = videoUpload ? videoView(videoUpload.video) : null;
        const coverIndex = payload.coverIndex === undefined ? 0 : payload.coverIndex;
        if (!Number.isInteger(coverIndex) || coverIndex < 0 || (images.length ? coverIndex >= images.length : coverIndex !== 0)) throw failure('INVALID_INPUT', '请从已选图片中选择封面');
        const eventId = payload.eventId === undefined ? '' : textField(payload.eventId, '关联活动', 0, 128);
        if (eventId) findEvent(state, eventId);
        if (!text && !images.length && !video) throw failure('INVALID_INPUT', '写一点内容或添加图片、视频吧');
        if (images.some(fileId => !state.uploads.some(upload => upload.userId === user.id && upload.purpose !== 'pet' && upload.fileId === fileId && upload.mediaType !== 'video' && upload.status === 'complete'))) throw failure('UPLOAD_UNAVAILABLE', '请重新选择图片，动态只能使用本人已保存的图片');
        const post = { id: id(state, 'post'), authorId: user.id, circleId: circle.id, title, kind, visibility: scope, topics, animalTypes, text, images: images.slice(), ...(video ? { video, contentType: 'video' } : {}), coverIndex, eventId, createdAt: now() };
        Object.assign(post, placeRun(state, engine => engine.linkPost(payload, { userId: user.id }, post.id)));
        if (videoUpload) videoUpload.postId = post.id;
        state.posts.push(post);
        result = { post: postView(state, post) };
        break;
      }
      case 'setPostVisibility': {
        if (Object.keys(payload).some(key => !['id', 'visibility'].includes(key))) throw failure('INVALID_INPUT', '可见范围只接收分享编号与范围');
        const scope = visibility(payload.visibility);
        const post = state.posts.find(item => item.id === payload.id);
        if (!post) throw failure('NOT_FOUND', '这条动态已删除或不可见');
        if (post.authorId !== user.id) throw failure('FORBIDDEN', '只能修改自己分享的可见范围');
        post.visibility = scope;
        result = { post: postView(state, post) };
        break;
      }
      case 'deletePost': {
        const post = findPost(state, payload.id);
        if (post.authorId !== user.id && !user.isAdmin) throw failure('FORBIDDEN', '只能删除自己发布的动态');
        placeRun(state, engine => engine.unlinkPost(post));
        if (post.catalogManaged || post.authorId === 'catalog-editor' && post.source) {
          state.catalogDeletedIds = Array.from(new Set((state.catalogDeletedIds || []).concat(post.id)));
        }
        state.posts = state.posts.filter(item => item.id !== post.id);
        state.comments = state.comments.filter(comment => !(comment.targetType === 'post' && comment.targetId === post.id));
        state.likes = state.likes.filter(item => item.postId !== post.id);
        state.bookmarks = state.bookmarks.filter(item => item.postId !== post.id);
        state.messages = state.messages.filter(item => item.targetType !== 'post' || item.targetId !== post.id);
        result = { deleted: true };
        break;
      }
      case 'addComment': {
        const text = textField(payload.text, '评论', 1, 300);
        let target;
        let recipientId;
        if (payload.targetType === 'post') { target = findPost(state, payload.targetId); recipientId = target.authorId; }
        else if (payload.targetType === 'event') {
          target = findEvent(state, payload.targetId);
          recipientId = target.hostId;
        } else throw failure('INVALID_INPUT', '评论对象无效');
        let reply;
        if (payload.replyToId) {
          reply = state.comments.find(comment => comment.id === payload.replyToId && comment.targetType === payload.targetType && comment.targetId === payload.targetId && !isBlocked(state, comment.authorId));
          if (!reply) throw failure('NOT_FOUND', '要回复的评论已删除或不可见');
          recipientId = reply.authorId;
        }
        const comment = { id: id(state, 'comment'), authorId: user.id, targetType: payload.targetType, targetId: payload.targetId, text, createdAt: now() };
        if (reply) comment.replyToId = reply.id;
        state.comments.push(comment);
        new Set([target.authorId || target.hostId, recipientId]).forEach(recipient => {
          if (recipient !== user.id) {
            const isReply = reply && recipient === reply.authorId;
            pushMessage(state, recipient, isReply ? '收到一条回复' : '收到一条评论', user.nickname + '：' + text, payload.targetType, payload.targetId, user.id, isReply ? 'reply' : 'comment');
          }
        });
        result = { comment: commentView(state, comment) };
        break;
      }
      case 'deleteComment': {
        const comment = state.comments.find(item => item.id === payload.id);
        if (!comment) throw failure('NOT_FOUND', '评论不存在或已删除');
        if (comment.authorId !== user.id && !user.isAdmin) throw failure('FORBIDDEN', '只能删除自己发布的评论');
        state.comments = state.comments.filter(item => item.id !== comment.id);
        result = { deleted: true };
        break;
      }
      case 'listEvents': {
        if (payload.filter && ['all', 'none', 'dog'].indexOf(payload.filter) === -1) throw failure('INVALID_INPUT', '活动筛选条件无效');
        const items = state.events.filter(event => !isBlocked(state, event.hostId) && (!payload.mine || event.attendeeIds.indexOf(user.id) !== -1) && (!payload.filter || payload.filter === 'all' || (payload.filter === 'none' ? event.petPolicy !== 'dog' : event.petPolicy !== 'none'))).sort((a, b) => {
          const aPast = a.status === 'cancelled' || a.endAt <= now();
          const bPast = b.status === 'cancelled' || b.endAt <= now();
          return Number(aPast) - Number(bPast) || a.startAt - b.startAt;
        });
        return { items: items.map(event => eventView(state, event)) };
      }
      case 'getEvent': {
        const event = findEvent(state, payload.id);
        return { event: eventView(state, event), comments: visibleComments(state, 'event', event.id).map(comment => commentView(state, comment)) };
      }
      case 'joinEvent': {
        if (typeof payload.join !== 'boolean') throw failure('INVALID_INPUT', '请选择报名或取消报名');
        const event = findEvent(state, payload.id);
        const joined = event.attendeeIds.indexOf(user.id) !== -1;
        if (payload.join === joined) return { event: eventView(state, event) };
        if (payload.join) {
          if (event.status === 'cancelled') throw failure('EVENT_CLOSED', '活动已取消');
          if (event.startAt <= now()) throw failure('EVENT_CLOSED', '活动已开始或结束，无法报名');
          if (event.attendeeIds.length >= event.capacity) throw failure('EVENT_FULL', '活动名额已满，可以看看其他活动');
          event.attendeeIds.push(user.id);
          pushMessage(state, user.id, '已保存演示报名', '你已在本机报名「' + event.title + '」。这是本机演示记录，不代表实际预约；演示活动请勿赴约。', 'event', event.id);
        } else {
          event.attendeeIds = event.attendeeIds.filter(attendeeId => attendeeId !== user.id);
          pushMessage(state, user.id, '已取消演示报名', '你已取消「' + event.title + '」的本机报名，名额已释放。', 'event', event.id);
        }
        result = { event: eventView(state, event) };
        break;
      }
      case 'createEvent': {
        assertAdmin(user);
        const fields = validateEvent(state, payload);
        const event = Object.assign(fields, { id: id(state, 'event'), hostId: user.id, attendeeIds: [], cover: fields.petPolicy === 'dog' ? '/assets/event-walk.png' : '/assets/event-coffee.png', status: 'active', createdAt: now() });
        state.events.push(event);
        result = { event: eventView(state, event) };
        break;
      }
      case 'updateEvent': {
        assertAdmin(user);
        const event = findEvent(state, payload.id);
        if (event.status === 'cancelled') throw failure('EVENT_CLOSED', '已取消的活动不能修改');
        if (event.startAt <= now()) throw failure('EVENT_CLOSED', '已开始或结束的活动不能修改');
        const fields = validateEvent(state, payload);
        if (fields.capacity < event.attendeeIds.length) throw failure('INVALID_INPUT', '人数上限不能少于已报名人数');
        const changed = Object.keys(fields).some(key => fields[key] !== event[key]);
        Object.assign(event, fields);
        if (changed) event.attendeeIds.forEach(userId => pushMessage(state, userId, '演示活动信息更新', '「' + event.title + '」的信息有变化，请查看最新时间、地点和参加条件。本机演示，无实际活动。', 'event', event.id));
        result = { event: eventView(state, event) };
        break;
      }
      case 'cancelEvent': {
        assertAdmin(user);
        const event = findEvent(state, payload.id);
        if (event.status === 'cancelled') return { event: eventView(state, event) };
        if (event.endAt <= now()) throw failure('EVENT_CLOSED', '已结束的活动不能取消');
        const reason = textField(payload.reason, '取消原因', 1, 80);
        event.status = 'cancelled';
        event.cancelReason = reason;
        event.attendeeIds.forEach(userId => pushMessage(state, userId, '演示活动已取消', '「' + event.title + '」已取消。原因：' + reason, 'event', event.id));
        result = { event: eventView(state, event) };
        break;
      }
      case 'listMessages': {
        const query = textField(payload.query === undefined ? '' : payload.query, '搜索内容', 0, 60).toLowerCase();
        const visible = visibleMessages(state, user.id);
        const actorNames = new Map(state.users.map(actor => [actor.id, actor.nickname]));
        const page = messagePage(visible, payload, record => !query || [record.title, record.text, actorNames.get(record.actorId)].join(' ').toLowerCase().includes(query));
        return Object.assign({}, page, { items: page.items.map(record => messageView(state, record)) }, messageCounts(visible));
      }
      case 'readMessage': {
        if (payload.all !== undefined && typeof payload.all !== 'boolean') throw failure('INVALID_INPUT', '请选择标记单条或全部消息');
        const visible = visibleMessages(state, user.id);
        if (payload.all === true) visible.forEach(message => { message.isRead = true; });
        else {
          const message = visible.find(item => item.id === payload.id);
          if (!message) throw failure('NOT_FOUND', '消息不存在');
          message.isRead = true;
        }
        result = Object.assign({ success: true }, messageCounts(visible));
        break;
      }
      case 'updateProfile': {
        const nickname = payload.nickname === undefined ? user.nickname : textField(payload.nickname, '昵称', 1, 24);
        const area = payload.area === undefined ? user.area || '' : textField(payload.area, '生活片区', 0, 40);
        if (payload.area !== undefined && area && area !== user.area && state.settings.areas.indexOf(area) === -1) throw failure('INVALID_INPUT', '请选择所在片区，也可以暂不填写');
        const bio = payload.bio === undefined ? user.bio || '' : textField(payload.bio, '个人简介', 0, 160);
        let pet = payload.pet === undefined ? user.pet || null : null;
        if (payload.pet !== null && payload.pet !== undefined) {
          if (!payload.pet || typeof payload.pet !== 'object' || ['cat', 'dog', 'other'].indexOf(payload.pet.type) === -1) throw failure('INVALID_INPUT', '请选择宠物类型，也可以选择暂时没养宠');
          if (Object.prototype.hasOwnProperty.call(payload.pet, 'photo')) throw failure('INVALID_INPUT', '请通过宠物资料中的照片入口选择并审核照片');
          pet = { name: textField(payload.pet.name, '宠物名字', 1, 24), type: payload.pet.type };
        }
        if (payload.publicProfile !== undefined && typeof payload.publicProfile !== 'boolean') throw failure('INVALID_INPUT', '请选择是否公开个人介绍');
        const publicProfile = payload.publicProfile === undefined ? user.publicProfile === true : payload.publicProfile;
        if (payload.showPet !== undefined && typeof payload.showPet !== 'boolean') throw failure('INVALID_INPUT', '请选择是否在社区展示宠物信息');
        const showPet = payload.showPet === undefined ? user.showPet === true : payload.showPet;
        const neighborSettings = neighbors.update(user, payload, now(), (code, message) => { throw failure(code, message); });
        const previousPet = petData.list(user)[0];
        Object.assign(user, { nickname, area, bio, pet, publicProfile, showPet }, neighborSettings, petData.legacyPatch(user, payload.pet));
        if (payload.pet === null && previousPet && previousPet.photoTicketId) petService.dispatch(state, user, 'discardPetUpload', { ticketId: previousPet.photoTicketId }, { now, id, failure, platform });
        result = { user: ownUser(user) };
        break;
      }
      case 'report': {
        const reason = textField(payload.reason, '反馈原因', 1, 80);
        const description = textField(payload.description === undefined ? '' : payload.description, '补充说明', 0, 500);
        let exists = false;
        if (payload.targetType === 'post') exists = !!findPost(state, payload.targetId);
        else if (payload.targetType === 'comment') exists = state.comments.some(comment => comment.id === payload.targetId && !isBlocked(state, comment.authorId) && (comment.targetType !== 'post' || canViewPost(state, state.posts.find(post => post.id === comment.targetId))));
        else if (payload.targetType === 'event') exists = state.events.some(event => event.id === payload.targetId);
        else if (payload.targetType === 'user') exists = state.users.some(item => item.id === payload.targetId);
        else throw failure('INVALID_INPUT', '反馈对象无效');
        if (!exists) throw failure('NOT_FOUND', '反馈对象已不存在');
        const report = { id: id(state, 'report'), userId: user.id, targetType: payload.targetType, targetId: payload.targetId, reason, description, status: 'open', createdAt: now() };
        const reportLink = reportTarget(state, report);
        report.targetTypeForLink = reportLink.targetTypeForLink;
        report.targetIdForLink = reportLink.targetIdForLink;
        state.reports.push(report);
        pushMessage(state, user.id, '演示反馈已保存在本机', '反馈内容只保存在当前设备，没有发送给真实工作人员。', 'system', '');
        result = { id: report.id };
        break;
      }
      case 'listReports': {
        assertAdmin(user);
        const status = payload.status === undefined ? 'open' : payload.status;
        if (status !== 'open' && status !== 'all') throw failure('INVALID_INPUT', '请选择待处理或全部举报');
        const offset = offsetFor(payload.cursor);
        const reports = state.reports.filter(report => status === 'all' || reportStatus(report) === 'open').sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        const page = { items: reports.slice(offset, offset + PAGE_SIZE).map(report => reportView(state, report)) };
        if (offset + PAGE_SIZE < reports.length) page.nextCursor = String(offset + PAGE_SIZE);
        return page;
      }
      case 'resolveReport': {
        assertAdmin(user);
        if (payload.status !== 'resolved' && payload.status !== 'dismissed') throw failure('INVALID_INPUT', '请选择有效的举报处理结果');
        const note = textField(payload.note === undefined ? '' : payload.note, '处理说明', 0, 300);
        const report = state.reports.find(item => item.id === payload.id);
        if (!report) throw failure('NOT_FOUND', '举报记录不存在');
        if (reportStatus(report) !== 'open') return { success: true };
        report.status = payload.status;
        report.note = note;
        report.resolvedAt = now();
        report.resolvedBy = user.id;
        const outcome = payload.status === 'resolved' ? '已处理' : '暂未发现需要处理的问题';
        pushMessage(state, report.userId, payload.status === 'resolved' ? '演示举报已处理' : '演示举报处理结果', '你的本机演示举报' + outcome + '。' + (note ? '处理说明：' + note + '。' : '') + '此结果仅保存在当前设备，没有真实工作人员参与。', 'system', report.id);
        result = { success: true };
        break;
      }
      case 'blockUser': {
        if (typeof payload.block !== 'boolean') throw failure('INVALID_INPUT', '请选择屏蔽或取消屏蔽');
        if (payload.userId === user.id) throw failure('INVALID_INPUT', '不能屏蔽自己');
        if (!state.users.some(item => item.id === payload.userId)) throw failure('NOT_FOUND', '这位邻居已不存在');
        state.blocks = state.blocks.filter(item => !(item.userId === user.id && item.blockedUserId === payload.userId));
        if (payload.block) {
          state.blocks.push({ userId: user.id, blockedUserId: payload.userId });
          social.blockPair(state, user.id, payload.userId);
          state.follows = state.follows.filter(item => !((item.userId === user.id && item.targetUserId === payload.userId) || (item.userId === payload.userId && item.targetUserId === user.id)));
          ['likes', 'bookmarks'].forEach(key => {
            state[key] = state[key].filter(item => {
              const post = state.posts.find(post => post.id === item.postId);
              return !post || !((item.userId === user.id && post.authorId === payload.userId) || (item.userId === payload.userId && post.authorId === user.id));
            });
          });
          state.events.forEach(event => {
            if (event.hostId === payload.userId) event.attendeeIds = event.attendeeIds.filter(attendeeId => attendeeId !== user.id);
            if (event.hostId === user.id) event.attendeeIds = event.attendeeIds.filter(attendeeId => attendeeId !== payload.userId);
          });
        }
        result = { success: true };
        break;
      }
      case 'listBlocked': return { items: state.blocks.filter(item => item.userId === user.id).map(item => publicUser(state, item.blockedUserId)) };
      case 'createUploadTicket': {
        const mediaType = payload.mediaType === undefined ? 'image' : payload.mediaType;
        if (!['image', 'video'].includes(mediaType)) throw failure('INVALID_INPUT', '上传媒体类型不正确');
        const isVideo = mediaType === 'video';
        if (isVideo ? payload.extension !== 'mp4' : ['jpg', 'png', 'webp'].indexOf(payload.extension) === -1) throw failure('INVALID_INPUT', isVideo ? '视频仅支持 MP4 格式' : '请选择 JPG、PNG 或 WebP 图片');
        const metadata = isVideo ? videoMetadata(payload) : null;
        const ticketId = id(state, 'upload');
        const cloudPath = 'demo-uploads/' + user.id + '/' + ticketId + '.' + payload.extension;
        state.uploads.push({ ticketId, cloudPath, userId: user.id, status: 'pending', createdAt: now(), extension: payload.extension, ...(isVideo ? { mediaType, declaredVideo: metadata } : {}) });
        result = { ticketId, cloudPath, ...(isVideo ? { mediaType } : {}) };
        break;
      }
      case 'completeUpload': {
        const upload = state.uploads.find(item => item.ticketId === payload.ticketId && item.userId === user.id);
        if (!upload) throw failure('UPLOAD_UNAVAILABLE', '图片保存记录不存在，请重新选择');
        if (!['pending', 'complete'].includes(upload.status)) throw failure('UPLOAD_UNAVAILABLE', '这份上传记录已结束，请重新选择');
        if (upload.mediaType === 'video' && !savedHttpImage) throw failure('UPLOAD_UNAVAILABLE', '本机演示只接受已保存到当前设备的视频');
        if (typeof payload.fileId !== 'string' || !payload.fileId || /^cloud:/i.test(payload.fileId) || (/^https?:/i.test(payload.fileId) && !savedHttpImage)) throw failure('UPLOAD_UNAVAILABLE', '本机演示只接受已保存到当前设备的图片');
        if (upload.status === 'complete' && upload.fileId !== payload.fileId) throw failure('UPLOAD_UNAVAILABLE', '这张图片的保存记录已完成');
        upload.fileId = payload.fileId;
        upload.status = 'complete';
        if (upload.mediaType === 'video') upload.video = videoView(Object.assign({ url: upload.fileId }, upload.declaredVideo));
        result = { ticketId: upload.ticketId, status: 'complete', fileId: upload.fileId, ...(upload.mediaType === 'video' ? { mediaType: 'video', video: upload.video } : {}) };
        break;
      }
      case 'getUploadStatus': {
        const upload = state.uploads.find(item => item.ticketId === payload.ticketId && item.userId === user.id);
        if (!upload) throw failure('UPLOAD_UNAVAILABLE', '图片保存记录不存在，请重新选择');
        if (upload.status === 'cleanup') return { ticketId: upload.ticketId, status: 'expired', message: '照片已移除，请重新选择' };
        return { ticketId: upload.ticketId, status: upload.status === 'complete' ? 'complete' : 'pending', fileId: upload.status === 'complete' ? upload.fileId : undefined,
          ...(upload.mediaType === 'video' && upload.status === 'complete' ? { mediaType: 'video', video: upload.video } : {}) };
      }
      case 'initialize': {
        assertAdmin(user);
        const city = textField(payload.city, '城市', 1, 40);
        if (!Array.isArray(payload.areas) || !payload.areas.length || payload.areas.length > 30) throw failure('INVALID_INPUT', '请设置 1–30 个片区');
        const areas = payload.areas.map(area => textField(area, '片区', 1, 40));
        state.settings = { city, areas: areas.filter((area, index) => areas.indexOf(area) === index), contact: textField(payload.contact, '联系方式', 1, 200) };
        result = { success: true };
        break;
      }
      case 'deleteAccount': {
        placeRun(state, engine => engine.cleanupUser(user.id));
        social.removeUser(state, user.id);
        const ownedPostIds = state.posts.filter(post => post.authorId === user.id).map(post => post.id);
        state.events.forEach(event => {
          if (event.hostId === user.id && event.status === 'active' && event.endAt > now()) {
            event.status = 'cancelled';
            event.cancelReason = '组织者已注销账号';
            event.attendeeIds.filter(attendeeId => attendeeId !== user.id).forEach(attendeeId => pushMessage(state, attendeeId, '演示活动已取消', '「' + event.title + '」的组织者已注销账号，活动已取消。', 'event', event.id, '', 'system'));
          }
          event.attendeeIds = event.attendeeIds.filter(attendeeId => attendeeId !== user.id);
          if (event.hostId === user.id) event.hostId = 'deleted-user';
        });
        state.posts = state.posts.filter(post => post.authorId !== user.id);
        ['likes', 'bookmarks'].forEach(key => { state[key] = state[key].filter(item => item.userId !== user.id && ownedPostIds.indexOf(item.postId) === -1); });
        state.follows = state.follows.filter(item => item.userId !== user.id && item.targetUserId !== user.id);
        state.comments = state.comments.filter(comment => comment.authorId !== user.id && !(comment.targetType === 'post' && ownedPostIds.indexOf(comment.targetId) !== -1));
        state.circles.forEach(circle => { circle.memberIds = circle.memberIds.filter(memberId => memberId !== user.id); });
        state.messages = state.messages.filter(message => message.userId !== user.id && message.actorId !== user.id && !(message.targetType === 'post' && ownedPostIds.includes(message.targetId)));
        state.blocks = state.blocks.filter(block => block.userId !== user.id && block.blockedUserId !== user.id);
        state.reports = state.reports.filter(report => report.userId !== user.id);
        const ownedUploads = state.uploads.filter(upload => upload.userId === user.id);
        state.uploads = state.uploads.filter(upload => upload.userId !== user.id);
        state.users = state.users.filter(item => item.id !== user.id);
        // Retired sample records may contain this account's old replies or
        // registrations. Account deletion also clears that local archive.
        delete state.legacySampleArchive;
        persist(state);
        if (platform && typeof platform.removeSavedFile === 'function') ownedUploads.forEach(upload => {
          if (upload.fileId && !/^data:/i.test(upload.fileId)) platform.removeSavedFile({ filePath: upload.fileId, fail: function () {} });
        });
        try {
          if (platform && typeof platform.removeStorageSync === 'function') platform.removeStorageSync('youchong.privateDrafts.v1');
          else if (platform && typeof platform.setStorageSync === 'function') platform.setStorageSync('youchong.privateDrafts.v1', {});
        } catch (error) { return { deleted: true, localCleanupPending: true }; }
        return { deleted: true };
      }
      default: throw failure('UNKNOWN_ACTION', '暂不支持这个操作');
    }
    persist(state);
    return result;
  }

  return {
    call: function (action, payload) {
      return Promise.resolve().then(async () => {
        if (typeof action !== 'string') throw failure('INVALID_INPUT', '操作名称无效');
        if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) throw failure('INVALID_INPUT', '提交内容格式无效');
        // Keep the scalar upload path and ticket stable while native file
        // validation is pending; the caller may reuse its payload object.
        const data = Object.assign({}, payload || {});
        const videoTicket = action === 'completeUpload' && load().uploads.some(upload => upload.ticketId === data.ticketId && upload.mediaType === 'video');
        const savedHttpImage = action === 'completeUpload' && typeof data.fileId === 'string' && (videoTicket || /^https?:/i.test(data.fileId))
          ? await isSavedHttpImage(data.fileId) : false;
        // Read state after the asynchronous device check so concurrent demo
        // actions are never overwritten with a stale snapshot.
        return clone(dispatch(load(), action, data, savedHttpImage));
      });
    }
  };
}

module.exports = { createDemoService, STORAGE_KEY };
