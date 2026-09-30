const { CURATED_POSTS, CATALOG_VERSION } = require('./curated');
const { EDITORS } = require('./editors');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function managed(post) { return post.catalogManaged === true || post.authorId === 'catalog-editor' && !!post.source; }
function mixCircles(posts) {
  const groups = new Map();
  posts.forEach(post => {
    if (!groups.has(post.circleId)) groups.set(post.circleId, []);
    groups.get(post.circleId).push(post);
  });
  const buckets = Array.from(groups.values());
  const result = [];
  for (let i = 0; result.length < posts.length; i++) buckets.forEach(group => { if (group[i]) result.push(group[i]); });
  return result;
}

function mixMedia(posts) {
  const result = mixCircles(posts.filter(post => post.contentType === 'photo'));
  const videos = mixCircles(posts.filter(post => post.contentType === 'video'));
  // Three clips reach the first few feed pages without changing source dates.
  videos.forEach((video, index) => {
    const preferred = Math.min(3 + index * 12, result.length);
    let position = preferred;
    while (position < result.length &&
      (result[position].circleId === video.circleId || position > 0 && result[position - 1].circleId === video.circleId)) position++;
    // A single-circle catalogue cannot alternate; still show its clips early.
    if (position === result.length) position = preferred;
    result.splice(position, 0, video);
  });
  return result;
}

// Reconcile the editorial catalogue without replacing user data or replaying
// fake engagement. Options allow isolated fixtures without changing the bundle.
function syncCatalogue(state, timestamp, options) {
  const config = options || {};
  const posts = config.posts || CURATED_POSTS;
  const editors = config.editors || EDITORS;
  const version = config.version || CATALOG_VERSION;
  const editorIds = new Set(editors.map(editor => editor.id));
  if (editorIds.size !== editors.length) throw new Error('展示账号 ID 重复');
  const ids = new Set();
  const deleted = new Set(state.catalogDeletedIds || []);
  const existing = new Map(state.posts.map(post => [post.id, post]));
  const pickEditor = post => post.editorId || (['photo', 'video'].includes(post.contentType) ? 'catalog-photo' : post.circleId === 'circle-cats' ? 'catalog-cat-home' : post.circleId === 'circle-walks' ? 'catalog-dog-walk' : 'catalog-pet-care');
  for (const post of posts) {
    if (!post.id || ids.has(post.id)) throw new Error('内容目录 ID 缺失或重复');
    ids.add(post.id);
    if (!editorIds.has(pickEditor(post))) throw new Error('内容目录引用了未知展示账号');
    if (existing.has(post.id) && !managed(existing.get(post.id))) throw new Error('内容目录 ID 与用户内容冲突');
  }
  for (const editor of editors) {
    const user = state.users.find(item => item.id === editor.id);
    if (user && user.isEditorial !== true) throw new Error('展示账号 ID 与用户账号冲突');
  }
  const knowledge = mixCircles(posts.filter(post => !['photo', 'video'].includes(post.contentType)));
  const media = mixMedia(posts);
  const ordered = [];
  for (let i = 0; i < Math.max(knowledge.length, Math.ceil(media.length / 2)); i++) {
    if (knowledge[i]) ordered.push(knowledge[i]);
    if (media[i * 2]) ordered.push(media[i * 2]);
    if (media[i * 2 + 1]) ordered.push(media[i * 2 + 1]);
  }
  const records = ordered.filter(post => !deleted.has(post.id)).map((post, index) => ({
    ...clone(post), authorId: pickEditor(post), images: clone(post.images || []),
    imageCredits: clone(post.imageCredits || []), coverIndex: post.coverIndex || 0,
    contentType: post.contentType || 'knowledge', eventId: '', createdAt: 0,
    importedAt: existing.has(post.id) && existing.get(post.id).importedAt !== undefined ? existing.get(post.id).importedAt : timestamp,
    catalogManaged: true, catalogOrder: index
  }));
  // Perform all collision checks before changing any state.
  state.posts = state.posts.filter(post => !managed(post)).concat(records);
  for (const editor of editors) {
    const fields = {
      ...clone(editor), isEditorial: true, isAdmin: false,
      area: '', pet: null, showPet: false, publicProfile: true,
      verification: { status: 'unverified' }
    };
    const user = state.users.find(item => item.id === editor.id);
    if (user) { Object.assign(user, fields); delete user.accountLabel; }
    else state.users.push(fields);
  }
  const legacy = state.users.find(user => user.id === 'catalog-editor');
  if (legacy) { Object.assign(legacy, { isEditorial: true, isAdmin: false, area: '', pet: null, showPet: false }); delete legacy.accountLabel; }
  state.catalogDeletedIds = Array.from(deleted);
  state.contentCatalogVersion = version;
  return state;
}

module.exports = { syncCatalogue };
