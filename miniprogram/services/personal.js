'use strict';

const { syncCatalogue } = require('../data/catalogue');
const animals = require('../data/animal-types');
const topics = require('../data/topics');
const petData = require('../data/pets');
const petService = require('./pets');
const placeDomain = require('./place-engine');
const placeCatalogue = require('../data/nearby-catalogue');
const contentPolicy = require('../data/content-policy');

const STORAGE_KEY = 'youchong.personal.v1';
const LEGACY_KEY = 'youban.demo.v1';
const CONTACT = '13122197119@163.com';
const VERSION = '2026-10-14-personal';
const PET_ACTIONS = ['listPets', 'savePet', 'deletePet', 'createPetUploadTicket', 'setPetPhoto', 'discardPetUpload'];
const PLACE_ACTIONS = ['listPlaces', 'getPlace', 'bookmarkPlace', 'listPlaceVisits', 'recordPlaceVisit', 'deletePlaceVisit'];
const ACTIONS = Object.freeze(['bootstrap', 'getMe', 'getPolicies', 'updateProfile', 'listPosts', 'getPost', 'createPost', 'deletePost', 'bookmarkPost', 'deleteAccount',
  'createUploadTicket', 'completeUpload', 'getUploadStatus', ...PET_ACTIONS, ...PLACE_ACTIONS]);
const allowed = new Set(ACTIONS);
const clone = value => JSON.parse(JSON.stringify(value));
const failure = (code, message) => Object.assign(new Error(message), { code });
const fail = (code, message) => { throw failure(code, message); };
const text = (value, label, max, required = false) => {
  if (typeof value !== 'string' || Array.from(value.trim()).length > max || required && !value.trim()) fail('INVALID_INPUT', label + '格式或长度无效');
  return value.trim();
};
const rows = value => Array.isArray(value) ? value : [];

// Community cleanup must not retire bytes that remain in the local private
// library. A failed storage read preserves the file so cleanup can be retried.
function personalFileReferenced(platform, path, options = {}) {
  if (!path) return false;
  const contains = value => value === path || value && typeof value === 'object' && Object.values(value).some(contains);
  try {
    if (!platform || typeof platform.getStorageSync !== 'function') throw new Error('storage unavailable');
    for (const key of [options.personalStorageKey || STORAGE_KEY, 'youchong.personalUploadQueue.v1', 'youchong.personalPetPhotoQueue.v1']) {
      if (contains(platform.getStorageSync(key))) return true;
    }
    const drafts = platform.getStorageSync('youchong.privateDrafts.v1');
    return !!(drafts && Object.entries(drafts).some(([owner, value]) => owner.startsWith('personal:') && contains(value)));
  } catch (_) {
    // Cleanup queues need to distinguish a confirmed reference from an unknown
    // read, otherwise they forget the only path that can retry this file later.
    if (options.throwOnReadError) fail('LOCAL_CLEANUP_FAILED', '暂时无法检查私人资料引用，附件已保留，请重试清理');
    return true;
  }
}

function clearCommunityDrafts(platform, ownerId, mode) {
  if (!ownerId || !['demo', 'cloud'].includes(mode)) fail('AUTH_REQUIRED', '无法确认要清理的本机草稿');
  const key = 'youchong.privateDrafts.v1';
  const stored = platform.getStorageSync(key);
  if (!stored) return;
  if (typeof stored !== 'object' || Array.isArray(stored)) fail('STORAGE_INVALID', '本机草稿记录无法读取，已保留原数据');
  const drafts = clone(stored);
  delete drafts[mode + ':' + ownerId];
  if (!Object.keys(drafts).length && typeof platform.removeStorageSync === 'function') platform.removeStorageSync(key);
  else platform.setStorageSync(key, drafts);
}

// Build public reading content only from the shipped catalogue. A local row
// with the same ID or an editable editorial flag never supplies its contents.
const canonical = { posts: [], users: [] };
syncCatalogue(canonical, 0);
const publicPosts = new Map(canonical.posts.map(post => [post.id, post]));
const editors = new Map(canonical.users.map(user => [user.id, user]));
const publicPlaces = new Map(placeCatalogue.records.map(place => [place.id, place]));

function privateUser(input, userId) {
  const user = input || {};
  return { id: userId, nickname: typeof user.nickname === 'string' ? user.nickname : '我的宠物手记',
    avatar: typeof user.avatar === 'string' && !/^cloud:/i.test(user.avatar) ? user.avatar : '/assets/avatar-6.png',
    area: typeof user.area === 'string' ? user.area : '', bio: typeof user.bio === 'string' ? user.bio : '',
    ...petData.projection(petData.list(user).map(pet => ({ ...pet, photo: /^cloud:/i.test(pet.photo || '') ? '' : pet.photo || '' }))), publicProfile: false, showPet: false, neighborVisible: false,
    neighborAreaId: '', residenceSharing: false, residenceCell: null, residenceUpdatedAt: null,
    isAdmin: false, verification: { status: 'not_required' } };
}

function policies() {
  return { mode: 'personal', productMode: 'personal', isDraft: false, operator: { name: '有宠有邻', contact: CONTACT }, termsVersion: VERSION, privacyVersion: VERSION,
    terms: [
      { title: '个人养宠工具', text: '本版本用于阅读精选资料、管理宠物档案和记录私人日记。日记、照片、收藏与到访备注仅保存在当前设备，不公开发布，也不提供用户交流或活动报名。' },
      { title: '资料与出行', text: '精选资料和公共地点信息供参考。活动时间、票务与携宠要求请向主办方确认；收藏或记录计划不代表报名成功。' },
      { title: '管理本机内容', text: '可以修改资料、删除私人日记或清除本版本的个人数据。旧社区版本的数据不会自动发布、迁移删除；本版本不提供他人内容或账号访问。' }
    ],
    privacy: [
      { title: '保存内容与用途', text: '仅在本机保存主动填写的昵称、宠物档案、私人图文、收藏和到访记录。不读取微信头像昵称，不采集手机号，不进行真实或模拟手机号核验，不启用云端社交服务。' },
      { title: '照片', text: '只处理主动选择或拍摄的文件，用于宠物档案和私人日记，并保存到当前设备；不会上传到云端或向其他用户展示。' },
      { title: '位置与导航', text: '主动定位仅用于本机计算公共地点距离，自动定位结果15分钟失效。手选参照可在本机保存和清除；地图导航目的地仅为公共场所，不保存或展示住宅距离。' },
      { title: '清除与联系', text: '本版本资料可在“我的”清除；历史社区版本的数据与本版本隔离保留。公开图片与资料加载仍可能使用网络。个人信息请求及反馈请联系 ' + CONTACT + '。' }
    ] };
}

function createPersonalService(platform, options = {}) {
  const key = options.personalStorageKey || STORAGE_KEY;
  const legacyKey = options.storageKey || LEGACY_KEY;
  const now = options.now || Date.now;
  let work = Promise.resolve();
  const serial = fn => { const job = work.then(fn); work = job.catch(() => {}); return job; };
  function read(storageKey) {
    if (!platform || typeof platform.getStorageSync !== 'function') fail('STORAGE_UNAVAILABLE', '无法读取本机资料，请检查存储空间');
    try { const value = platform.getStorageSync(storageKey); return value ? clone(value) : null; }
    catch (_) { fail('STORAGE_UNAVAILABLE', '本机资料暂时无法读取，请重试'); }
  }
  function persist(state) {
    if (!platform || typeof platform.setStorageSync !== 'function') fail('STORAGE_UNAVAILABLE', '无法保存本机资料');
    try { platform.setStorageSync(key, clone(state)); }
    catch (_) { fail('STORAGE_UNAVAILABLE', '本机存储空间不足或不可用，本次操作未保存'); }
  }
  function context(cleanupOwner) {
    const legacy = read(legacyKey);
    if (legacy && (legacy.version !== 1 || !Array.isArray(legacy.users) || typeof legacy.currentUserId !== 'string' || !legacy.currentUserId)) fail('STORAGE_INVALID', '历史本机资料无法读取，请保留数据后重试');
    const userId = cleanupOwner || (legacy ? legacy.currentUserId : 'demo-self');
    const sourceUser = legacy && legacy.users.find(user => user.id === userId);
    const state = read(key) || { version: 1, seq: 0, accounts: [] };
    if (state.version !== 1 || !Array.isArray(state.accounts) || !Number.isSafeInteger(state.seq) || state.seq < 0) fail('STORAGE_INVALID', '个人工具资料格式无法读取，请保留数据后重试');
    let account = state.accounts.find(item => item.userId === userId);
    if (!account) {
      account = { userId, user: privateUser(sourceUser, userId), posts: [], bookmarks: rows(legacy && legacy.bookmarks).filter(row => row.userId === userId),
        hiddenLegacyIds: [], uploads: [], cleanupFiles: [], legacySuppressed: false,
        place_bookmarks: rows(legacy && legacy.place_bookmarks).filter(row => row.userId === userId),
        place_visits: rows(legacy && legacy.place_visits).filter(row => row.userId === userId).map(row => { const copy = { ...row }; delete copy.postId; return copy; }) };
      state.accounts.push(account);
    }
    for (const field of ['posts', 'bookmarks', 'hiddenLegacyIds', 'uploads', 'cleanupFiles', 'place_bookmarks', 'place_visits']) {
      if (!Array.isArray(account[field])) fail('STORAGE_INVALID', '个人工具记录无法读取，请保留数据后重试');
    }
    account.user = privateUser(account.user, userId);
    return { legacy, sourceUser, state, account, userId, user: account.user };
  }
  const id = (state, prefix) => 'personal-' + prefix + '-' + now().toString(36) + '-' + (++state.seq);
  function ownPosts(ctx) {
    const old = !ctx.account.legacySuppressed && ctx.sourceUser ? rows(ctx.legacy && ctx.legacy.posts).filter(post => post.authorId === ctx.userId && !publicPosts.has(post.id) && !ctx.account.hiddenLegacyIds.includes(post.id)) : [];
    return [...old, ...ctx.account.posts.filter(post => post.authorId === ctx.userId && !publicPosts.has(post.id))].filter(post => !contentPolicy.isVideoPost(post));
  }
  function findPost(ctx, postId) {
    const record = publicPosts.get(postId) || ownPosts(ctx).find(post => post.id === postId);
    if (!record || contentPolicy.isVideoPost(record)) fail('NOT_FOUND', '这条内容不存在或不属于当前本机资料');
    return record;
  }
  function postView(ctx, post) {
    const editorial = publicPosts.get(post.id) === post;
    const editor = editorial && editors.get(post.authorId);
    const images = rows(post.images).filter(path => typeof path === 'string' && !/^cloud:/i.test(path));
    if (contentPolicy.isVideoPost(post)) fail('NOT_FOUND', '内容已下架');
    const coverIndex = Number.isInteger(post.coverIndex) && post.coverIndex >= 0 && post.coverIndex < images.length ? post.coverIndex : 0;
    const place = !editorial && publicPlaces.get(post.placeId);
    const visit = !editorial && ctx.account.place_visits.find(row => (row.id || row._id) === post.visitId && row.userId === ctx.userId && row.placeId === post.placeId);
    const result = { id: post.id, title: post.title || '', text: post.text || '', images, coverIndex,
      cover: images[coverIndex] || '',
      kind: 'daily', animalTypes: animals.normalize(post.animalTypes), topics: editorial ? topics.normalize(post.topics) : [],
      author: editorial ? { id: '', nickname: '有宠有邻精选', avatar: editor && editor.avatar || '/assets/avatar-6.png', isEditorial: true } : { id: ctx.userId, nickname: ctx.user.nickname, avatar: ctx.user.avatar },
      visibility: editorial ? 'public' : 'private', isMine: !editorial, isEditorial: editorial, contentType: post.contentType || (images.length ? 'photo' : 'knowledge'),
      createdAt: Number(post.createdAt) || 0, isBookmarked: ctx.account.bookmarks.some(row => row.postId === post.id),
      likeCount: 0, commentCount: 0, isLiked: false, circle: null, circleId: '', event: null, eventId: '',
      place: place ? { id: place.id, title: place.title, address: place.address || '', city: place.city || '', area: place.area || '', active: place.active !== false, ...(place.point ? { point: clone(place.point) } : {}) } : null,
      placeId: place ? place.id : '', visitId: visit ? visit.id || visit._id : '', canShare: false };
    // Keep provenance and image credits intact; editorial provenance is not an
    // interactive community author profile.
    if (editorial) for (const field of ['source', 'imageCredits', 'omitPublicAttribution']) if (post[field] !== undefined) result[field] = clone(post[field]);
    return result;
  }
  function listPosts(ctx, payload) {
    if (payload.mine !== undefined && typeof payload.mine !== 'boolean' || payload.bookmarked !== undefined && typeof payload.bookmarked !== 'boolean') fail('INVALID_INPUT', '内容筛选参数无效');
    if (payload.circleId || payload.authorId || payload.feed && payload.feed !== 'discover') fail('PERSONAL_MODE_ONLY', '个人工具版不提供圈子、关注或作者内容');
    const query = text(payload.query === undefined ? '' : payload.query, '搜索词', 60).toLowerCase();
    const topic = payload.topic ? topics.normalizeTopic(text(payload.topic, '资料分类', 40)) : '';
    if (payload.topic && !topic) fail('INVALID_INPUT', '资料分类无效');
    const selected = payload.animalType || '';
    if (selected && selected !== 'unclassified' && !animals.IDS.includes(selected)) fail('INVALID_INPUT', '动物分类无效');
    const excluded = payload.excludedAnimalTypes === undefined ? [] : payload.excludedAnimalTypes;
    if (!Array.isArray(excluded) || excluded.some(item => !animals.IDS.includes(item))) fail('INVALID_INPUT', '动物分类无效');
    const marks = new Set(ctx.account.bookmarks.map(row => row.postId));
    let list = payload.mine ? ownPosts(ctx) : payload.bookmarked ? canonical.posts.concat(ownPosts(ctx)) : canonical.posts;
    list = list.filter(post => {
      if (contentPolicy.isVideoPost(post)) return false;
      const types = animals.normalize(post.animalTypes);
      return (!payload.bookmarked || marks.has(post.id)) && (!topic || publicPosts.get(post.id) === post && topics.normalize(post.topics).includes(topic)) &&
        (!query || [post.title, post.text, ...topics.normalize(post.topics)].join(' ').toLowerCase().includes(query)) &&
        (!selected || (selected === 'unclassified' ? !types.length : types.includes(selected))) && !types.some(type => excluded.includes(type));
    });
    if (payload.mine) list.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    const cursor = payload.cursor === undefined || payload.cursor === null || payload.cursor === '' ? 0 : Number(payload.cursor);
    const limit = payload.limit === undefined ? 20 : payload.limit;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID_INPUT', '分页参数无效');
    return { items: list.slice(cursor, cursor + limit).map(post => postView(ctx, post)), ...(cursor + limit < list.length ? { nextCursor: String(cursor + limit) } : {}) };
  }
  function placeRun(ctx, action, payload) {
    const engine = placeDomain.createPlaceEngine({ catalogue: placeCatalogue, now, newId: () => id(ctx.state, 'place'), fail });
    const table = name => ['place_bookmarks', 'place_visits'].includes(name) ? ctx.account[name] : [];
    const store = {
      get: (name, recordId) => table(name).find(row => (row.id || row._id) === recordId) || null,
      all: (name, filters) => table(name).filter(row => Object.entries(filters).every(([field, value]) => row[field] === value)),
      set: (name, recordId, value) => {
        if (!['place_bookmarks', 'place_visits'].includes(name)) fail('PERSONAL_MODE_ONLY', '个人工具版不修改公共目录');
        const list = table(name), index = list.findIndex(row => (row.id || row._id) === recordId), row = { ...value, id: recordId, userId: ctx.userId };
        delete row.postId; if (index < 0) list.push(row); else list[index] = row;
      },
      remove: (name, recordId) => { if (['place_bookmarks', 'place_visits'].includes(name)) ctx.account[name] = table(name).filter(row => (row.id || row._id) !== recordId); }
    };
    return placeDomain.driveSync(engine.execute(action, payload, { userId: ctx.userId, isAdmin: false }), store);
  }
  function boot(ctx) {
    const accessible = new Set(canonical.posts.filter(post => !contentPolicy.isVideoPost(post)).map(post => post.id).concat(ownPosts(ctx).map(post => post.id)));
    return { mode: 'personal', productMode: 'personal', user: ctx.user, settings: { city: '上海', areas: rows(ctx.legacy && ctx.legacy.settings && ctx.legacy.settings.areas), contact: CONTACT },
      registration: { phoneEnabled: false, verificationRequired: false, policyConfigured: true, termsVersion: VERSION, privacyVersion: VERSION },
      stats: { postCount: ownPosts(ctx).length, diaryCount: ownPosts(ctx).length, petCount: petData.list(ctx.user).length,
        bookmarkCount: ctx.account.bookmarks.filter(row => accessible.has(row.postId)).length, placeBookmarkCount: ctx.account.place_bookmarks.length, visitCount: ctx.account.place_visits.length } };
  }
  async function savedFile(path) {
    if (typeof path !== 'string' || !path || /^cloud:/i.test(path)) return false;
    if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(path) && platform && platform.__preview) return true;
    if (/^https?:/i.test(path)) {
      if (!platform || typeof platform.getSavedFileList !== 'function') fail('LOCAL_IMAGE_CHECK_FAILED', '暂时无法检查本机附件，请重试');
      return new Promise((resolve, reject) => platform.getSavedFileList({ success: result => resolve(rows(result && result.fileList).some(file => file.filePath === path)), fail: () => reject(failure('LOCAL_IMAGE_CHECK_FAILED', '暂时无法检查本机附件，请重试')) }));
    }
    return /^(?:wxfile:\/\/|\/)/i.test(path);
  }
  async function dispatch(ctx, action, payload) {
    if (action === 'bootstrap' || action === 'getMe') return boot(ctx);
    if (action === 'getPolicies') return policies();
    if (action === 'listPosts') return listPosts(ctx, payload);
    if (action === 'getPost') return { post: postView(ctx, findPost(ctx, payload.id)), comments: [] };
    if (PLACE_ACTIONS.includes(action)) return placeRun(ctx, action, payload);
    if (PET_ACTIONS.includes(action)) {
      const localState = { uploads: ctx.account.uploads };
      // Retire a file only after its replacement has committed. A full disk
      // must not delete the photo still referenced by the last saved profile.
      const deferredFiles = { removeSavedFile({ filePath }) { ctx.account.cleanupFiles = Array.from(new Set([...ctx.account.cleanupFiles, filePath])); } };
      return { ...petService.dispatch(localState, ctx.user, action, payload, { now, id: (_, prefix) => id(ctx.state, prefix), failure, platform: deferredFiles }), ownerId: ctx.userId };
    }
    if (action === 'updateProfile') {
      const fields = ['nickname', 'area', 'bio', 'pet', 'publicProfile', 'showPet', 'neighborVisible', 'residenceSharing', 'neighborAreaId', 'residenceCell'];
      if (Object.keys(payload).some(field => !fields.includes(field))) fail('INVALID_INPUT', '个人资料只接受昵称、片区、简介和宠物资料');
      if (payload.publicProfile || payload.showPet || payload.neighborVisible || payload.residenceSharing || payload.neighborAreaId || payload.residenceCell) fail('PERSONAL_MODE_ONLY', '个人资料仅保存在本机，不能公开或分享位置');
      for (const [field, max] of [['nickname', 24], ['area', 40], ['bio', 160]]) if (payload[field] !== undefined) ctx.user[field] = text(payload[field], field === 'nickname' ? '昵称' : '个人资料', max, field === 'nickname');
      if (payload.pet !== undefined) {
        const pet = payload.pet;
        if (pet !== null && (!pet || !['cat', 'dog', 'other'].includes(pet.type) || Object.keys(pet).some(field => !['name', 'type'].includes(field)))) fail('INVALID_INPUT', '宠物资料格式无效');
        Object.assign(ctx.user, petData.legacyPatch(ctx.user, pet === null ? null : { name: text(pet.name, '宠物名字', 24, true), type: pet.type }));
      }
      return { user: privateUser(ctx.user, ctx.userId) };
    }
    if (action === 'bookmarkPost') {
      findPost(ctx, payload.id);
      if (typeof payload.bookmark !== 'boolean') fail('INVALID_INPUT', '收藏状态无效');
      ctx.account.bookmarks = ctx.account.bookmarks.filter(row => row.postId !== payload.id);
      if (payload.bookmark) ctx.account.bookmarks.push({ postId: payload.id, userId: ctx.userId, createdAt: now() });
      return { post: postView(ctx, findPost(ctx, payload.id)), isBookmarked: payload.bookmark };
    }
    if (action === 'createPost') {
      if (payload.visibility !== undefined && payload.visibility !== 'private') fail('PERSONAL_MODE_ONLY', '日记仅自己可见，不能公开或分享给好友');
      const body = text(payload.text === undefined ? '' : payload.text, '日记正文', 1000), title = text(payload.title === undefined ? '' : payload.title, '日记标题', 40);
      const images = payload.images === undefined ? [] : payload.images;
      if (!Array.isArray(images) || images.length > 3 || new Set(images).size !== images.length || images.some(path => typeof path !== 'string' || !path)) fail('INVALID_INPUT', '每篇日记最多添加3张不重复的图片');
      const types = payload.animalTypes === undefined ? [] : payload.animalTypes;
      if (!Array.isArray(types) || types.length > 3 || types.some(type => !animals.IDS.includes(type))) fail('INVALID_INPUT', '最多选择3种动物');
      const attachment = path => ctx.account.uploads.find(upload => upload.userId === ctx.userId && upload.purpose !== 'pet' && upload.fileId === path && upload.status === 'complete' && !contentPolicy.isVideoUpload(upload) && !upload.postId);
      if (images.some(path => !attachment(path))) fail('UPLOAD_UNAVAILABLE', '请使用本人已保存在本机的图片');
      if (!body && !images.length) fail('INVALID_INPUT', '写一点日记或添加照片');
      const coverIndex = payload.coverIndex === undefined ? 0 : payload.coverIndex;
      if (!Number.isInteger(coverIndex) || coverIndex < 0 || (images.length ? coverIndex >= images.length : coverIndex !== 0)) fail('INVALID_INPUT', '封面选择无效');
      const placeId = payload.placeId || '', visitId = payload.visitId || '';
      if (placeId && (!publicPlaces.has(placeId) || publicPlaces.get(placeId).active === false)) fail('NOT_FOUND', '关联公共地点不存在或已下架');
      if (visitId && !ctx.account.place_visits.some(row => (row.id || row._id) === visitId && row.userId === ctx.userId && row.placeId === placeId)) fail('NOT_FOUND', '只能关联本人在该地点的到访记录');
      const post = { id: id(ctx.state, 'diary'), authorId: ctx.userId, visibility: 'private', title, text: body, animalTypes: [...new Set(types)],
        images: images.slice(), coverIndex, placeId, visitId, createdAt: now() };
      ctx.account.posts.push(post);
      for (const path of images) attachment(path).postId = post.id;
      return { post: postView(ctx, post) };
    }
    if (action === 'deletePost') {
      const post = ownPosts(ctx).find(item => item.id === payload.id);
      if (!post) fail('NOT_FOUND', '只能删除自己的私人日记');
      ctx.account.posts = ctx.account.posts.filter(item => item.id !== post.id);
      ctx.account.hiddenLegacyIds = Array.from(new Set([...ctx.account.hiddenLegacyIds, post.id]));
      ctx.account.bookmarks = ctx.account.bookmarks.filter(row => row.postId !== post.id);
      for (const upload of ctx.account.uploads.filter(row => row.postId === post.id)) {
        upload.status = 'cleanup';
        if (upload.fileId && !/^data:/i.test(upload.fileId)) ctx.account.cleanupFiles.push(upload.fileId);
      }
      ctx.account.cleanupFiles = Array.from(new Set(ctx.account.cleanupFiles));
      return { deleted: true, ownerId: ctx.userId };
    }
    if (action === 'createUploadTicket') {
      if (payload.mediaType !== undefined && payload.mediaType !== 'image' || !['jpg', 'png', 'webp'].includes(payload.extension)) fail('INVALID_INPUT', '仅支持 JPG、PNG 或 WebP 图片');
      const ticketId = id(ctx.state, 'upload'), cloudPath = 'personal-local/' + ticketId + '.' + payload.extension;
      ctx.account.uploads.push({ ticketId, cloudPath, userId: ctx.userId, status: 'pending', mediaType: 'image', createdAt: now() });
      return { ticketId, cloudPath };
    }
    if (action === 'completeUpload' || action === 'getUploadStatus') {
      const upload = ctx.account.uploads.find(row => row.ticketId === payload.ticketId && row.userId === ctx.userId);
      if (!upload) fail('UPLOAD_UNAVAILABLE', '本机附件记录不存在，请重新选择');
      if (contentPolicy.isVideoUpload(upload)) contentPolicy.assertVideoAllowed();
      if (action === 'completeUpload') {
        if (!['pending', 'complete'].includes(upload.status) || !await savedFile(payload.fileId) || upload.fileId && upload.fileId !== payload.fileId) fail('UPLOAD_UNAVAILABLE', '只能使用已保存到当前设备的附件');
        upload.fileId = payload.fileId; upload.status = 'complete';
      }
      return { ticketId: upload.ticketId, status: upload.status === 'cleanup' ? 'expired' : upload.status, ...(upload.status === 'complete' ? { fileId: upload.fileId } : {}) };
    }
    if (action === 'deleteAccount') {
      const files = ctx.account.uploads.map(upload => upload.fileId).filter(path => typeof path === 'string' && path && !/^data:/i.test(path));
      Object.assign(ctx.account, { user: privateUser(null, ctx.userId), posts: [], bookmarks: [], hiddenLegacyIds: [], uploads: [],
        place_bookmarks: [], place_visits: [], legacySuppressed: true, cleanupFiles: Array.from(new Set([...ctx.account.cleanupFiles, ...files])) });
      return { deleted: true, ownerId: ctx.userId };
    }
    fail('PERSONAL_MODE_ONLY', '个人工具版不提供这项社区操作');
  }
  function call(action, payload) {
    // Reject before even reading local storage. Unknown future actions are also
    // denied, rather than accidentally delegating to the demo/cloud router.
    if (typeof action !== 'string' || !allowed.has(action)) return Promise.reject(failure('PERSONAL_MODE_ONLY', '个人工具版不提供发布、交流或用户活动功能'));
    if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) return Promise.reject(failure('INVALID_INPUT', '提交内容格式无效'));
    let input;
    try { input = clone(payload || {}); } catch (_) { return Promise.reject(failure('INVALID_INPUT', '提交内容格式无效')); }
    try { contentPolicy.assertRequest(action, input); } catch (error) { return Promise.reject(error); }
    return serial(async () => {
      const ctx = context();
      const result = await dispatch(ctx, action, input);
      // Writes and the first bootstrap retain a per-owner overlay. Nothing is
      // ever written back to the legacy community store.
      if (!['getPolicies', 'listPosts', 'getPost', 'listPets', 'listPlaces', 'getPlace', 'listPlaceVisits', 'getUploadStatus'].includes(action)) persist(ctx.state);
      return clone(result);
    });
  }
  function readLibrary(expectedOwner) {
    return serial(() => {
      const ctx = context();
      if (!expectedOwner || ctx.userId !== expectedOwner) fail('UPLOAD_OWNER_CHANGED', '本机账号已切换，请重新打开私人资料库');
      const stored = read(key);
      const exists = rows(stored && stored.accounts).some(account => account.userId === expectedOwner);
      const draftMap = read('youchong.privateDrafts.v1') || {};
      if (typeof draftMap !== 'object' || Array.isArray(draftMap)) fail('STORAGE_INVALID', '本机草稿无法读取，原数据仍然保留');
      // This was the exact owner key used by the personal editor. Never accept
      // a page parameter, another account, or a loosely matching suffix.
      const draft = draftMap['personal:personal:' + expectedOwner];
      return clone({ ownerId: expectedOwner, available: exists || !!draft,
        user: exists ? ctx.user : null,
        posts: exists ? ownPosts(ctx).map(post => postView(ctx, post)).sort((a, b) => b.createdAt - a.createdAt) : [],
        pets: exists ? petData.list(ctx.user) : [],
        drafts: draft && draft.version === 1 ? [{ ...draft, id: 'personal-draft', visibility: 'private' }] : [],
        placeVisits: exists ? ctx.account.place_visits : [], placeBookmarks: exists ? ctx.account.place_bookmarks : [] });
    });
  }
  function canRemoveLocalFile(path, ownerId, options = {}) {
    const contains = value => value === path || value && typeof value === 'object' && Object.values(value).some(contains);
    // Preserved legacy records, attachments and drafts retain their bytes even
    // if a new local ticket happened to resolve to the same native file path.
    for (const storageKey of [legacyKey, 'youchong.uploadQueue.v1', 'youchong.petPhotoQueue.v1']) if (contains(read(storageKey))) return false;
    const personalState = read(key);
    for (const account of rows(personalState && personalState.accounts)) {
      if (contains(account.user) || contains(account.posts)) return false;
      if (account.userId !== ownerId && contains(account.uploads)) return false;
    }
    for (const storageKey of ['youchong.personalUploadQueue.v1', 'youchong.personalPetPhotoQueue.v1']) {
      const queue = read(storageKey);
      if (rows(queue && queue.items).some(item => {
        const excluded = item.ownerId === ownerId && (options.excludeOwnerQueues === true || rows(options.excludeQueueEntries).some(entry => entry.key === storageKey && entry.localId === item.localId));
        return !excluded && contains(item);
      })) return false;
    }
    const drafts = read('youchong.privateDrafts.v1');
    if (drafts && Object.entries(drafts).some(([draftOwner, draft]) => !(options.excludeOwnerDrafts === true && draftOwner.startsWith('personal:') && draftOwner.endsWith(':' + ownerId)) && contains(draft))) return false;
    return true;
  }
  async function clearLocalFiles(ownerId, options) {
    return serial(async () => {
      const ctx = context(ownerId), remaining = [];
      for (const path of ctx.account.cleanupFiles) {
        try {
          if (!canRemoveLocalFile(path, ctx.userId, options)) continue;
          if (!platform || typeof platform.removeSavedFile !== 'function') throw new Error('unavailable');
          await new Promise((resolve, reject) => platform.removeSavedFile({ filePath: path, success: resolve, fail: error => /not exist|not found|不存在/i.test(error && error.errMsg || '') ? resolve() : reject(error) }));
        } catch (_) { remaining.push(path); }
      }
      if (ctx.account.cleanupFiles.length) { ctx.account.cleanupFiles = remaining; persist(ctx.state); }
      if (remaining.length) fail('LOCAL_CLEANUP_FAILED', '个人工具附件尚未清理完成，请重试');
    });
  }
  return { call, readLibrary, clearLocalFiles, canRemoveLocalFile };
}

module.exports = { createPersonalService, personalFileReferenced, clearCommunityDrafts, STORAGE_KEY, ACTIONS };
