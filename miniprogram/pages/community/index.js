const s = require('../_shared');
const topics = require('../../data/topics');
const animals = require('../../data/animal-types');
const preferences = require('../../data/feed-preferences');
const presentation = require('./_presentation');
const COVER_WAIT_MS = 4000;
const EMPTY_PAGE_LIMIT = 4;
const animalNames = { cat: '猫', dog: '狗', rabbit: '兔子', 'small-mammal': '小宠', bird: '鸟', fish: '鱼', reptile: '爬宠', amphibian: '两栖动物', invertebrate: '虾螺等', other: '其他动物', unclassified: '未标注' };
function animalFilterTitle(type) { return type ? '只看' + animalNames[type] : '动物'; }
function animalFilterLabel(type, hidden) {
  const label = type ? '只看' + animalNames[type] : '动物筛选';
  return label + (hidden.length ? ' · 隐藏 ' + hidden.length + ' 类' : '');
}
function cardView(post, coverLazy) {
  const keys = ['id', 'title', 'text', 'displayTitle', 'cardText', 'kind', 'kindText', 'kindSymbol', 'cardLabel', 'cardLabelType', 'coverSrc', 'coverState', 'coverRatio', 'coverMode', 'coverAttempt', 'likeCount', 'isLiked', 'commentCount', 'place', 'placeDistanceText'];
  const result = {};
  keys.forEach(key => { result[key] = post[key]; });
  return Object.assign(result, { coverLazy: !!coverLazy, imageCount: post.images.length, author: { id: post.author.id, nickname: post.author.nickname, avatar: post.author.avatar }, circle: post.circle, topics: post.topics, event: post.event && { id: post.event.id, status: post.event.status } });
}
function navigationSize() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : {};
    const statusBarHeight = Number.isFinite(info.statusBarHeight) ? Math.max(0, Math.min(100, info.statusBarHeight)) : 0;
    const capsule = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null;
    const row = capsule && capsule.top >= statusBarHeight && capsule.height > 0 ? capsule.height + 2 * (capsule.top - statusBarHeight) : 44;
    const inset = capsule && Number.isFinite(info.windowWidth) && capsule.left > info.windowWidth / 2 ? info.windowWidth - capsule.left + 8 : 96;
    return { statusBarHeight, navigationHeight: Math.max(44, Math.min(64, row)), navigationInset: Math.max(80, Math.min(120, inset)) };
  } catch (_) { return { statusBarHeight: 0, navigationHeight: 44, navigationInset: 96 }; }
}
s.register({
  data: { loading: true, error: '', mode: '', statusBarHeight: 0, navigationHeight: 44, navigationInset: 96, circles: [], joinedCircles: [], posts: [], postColumns: [], feed: 'discover', topic: '', topics, selectedCircle: '', animalType: '', animalFilterLabel: '动物筛选', animalFilterTitle: '动物', animalChoices: [{ id: '', name: '全部动物' }].concat(animals.TYPES, [{ id: 'unclassified', name: '未标注' }]), excludedAnimalTypes: [], hiddenChoices: animals.choices([]), animalFiltersOpen: false, topicsOpen: false, preferenceError: '', searchFocused: false, searchInput: '', query: '', nextCursor: null, waitingForCovers: false, moreBusy: false, busy: false, feeds: s.personalMode ? [{ id: 'discover', name: '精选' }] : [{ id: 'discover', name: '发现' }, { id: 'following', name: '关注' }, { id: 'circles', name: '主题' }] },
  onLoad() { this._covers = new Map(); this._coverAttempt = 0; this._columnById = new Map(); const saved = preferences.read(wx); s.safe(this, Object.assign(navigationSize(), { excludedAnimalTypes: saved.excludedAnimalTypes, hiddenChoices: animals.choices(saved.excludedAnimalTypes), animalFilterTitle: animalFilterTitle(''), animalFilterLabel: animalFilterLabel('', saved.excludedAnimalTypes), preferenceError: saved.error })); return this.refresh(); },
  onShow() { if (this._loaded) return this.data.error ? this.refresh() : this.resume(); },
  onHide() {
    this._resumeRequest = (this._resumeRequest || 0) + 1;
    this._moreRequestId = (this._moreRequestId || 0) + 1;
    this._moreTask = null;
    this.cancelCoverWait();
    s.safe(this, { searchFocused: false, animalFiltersOpen: false, moreBusy: false });
  },
  onUnload() { this.cancelCoverWait(); },
  onResize() { s.safe(this, navigationSize()); },
  onPullDownRefresh() { return this.refresh(); },
  onReachBottom() {
    if (this._closed || this.data.loading || this.data.moreBusy || this._moreTask || !this.data.nextCursor || this._awaitingMore) return;
    if (!this.data.posts.some(post => post.coverState === 'loading')) return this.loadMore();
    this._awaitingMore = { loadId: this._loadId, cursor: this.data.nextCursor };
    s.safe(this, { waitingForCovers: true });
    this._coverWaitTimer = setTimeout(() => this.continueAfterCovers(true), COVER_WAIT_MS);
  },
  cancelCoverWait() {
    if (this._coverWaitTimer !== undefined) clearTimeout(this._coverWaitTimer);
    this._coverWaitTimer = undefined;
    this._awaitingMore = null;
    if (this.data.waitingForCovers) s.safe(this, { waitingForCovers: false });
  },
  continueAfterCovers(timedOut = false) {
    const pending = this._awaitingMore;
    if (!pending) return;
    if (this._closed || this.data.loading || pending.loadId !== this._loadId || pending.cursor !== this.data.nextCursor) return this.cancelCoverWait();
    if (!timedOut && this.data.posts.some(post => post.coverState === 'loading')) return;
    this.cancelCoverWait();
    return this.loadMore();
  },
  parameters(cursor) { return { feed: !s.personalMode && this.data.feed === 'following' ? 'following' : 'discover', topic: this.data.topic || undefined, query: this.data.query || undefined, circleId: undefined, animalType: this.data.animalType || undefined, excludedAnimalTypes: this.data.excludedAnimalTypes, cursor }; },
  preparePost(item) {
    const post = s.post(item);
    if (!this._covers) this._covers = new Map();
    let state = this._covers.get(post.id);
    if (!state || state.sourceSrc !== post.cover) {
      this._coverAttempt = (this._coverAttempt || 0) + 1;
      state = presentation.createCoverState(post, this._coverAttempt);
      this._covers.set(post.id, state);
    }
    return presentation.decorate(post, state);
  },
  columnsFor(posts) {
    if (!this._columnById) this._columnById = new Map();
    const columns = [{ id: 'left', posts: [] }, { id: 'right', posts: [] }];
    const heights = [0, 0];
    posts.forEach(post => {
      let column = this._columnById.get(post.id);
      if (column === undefined) { column = heights[0] <= heights[1] ? 0 : 1; this._columnById.set(post.id, column); }
      // Start the first two covers in each column immediately; defer the rest
      // until they approach the viewport so they do not compete with the top.
      columns[column].posts.push(cardView(post, columns[column].posts.length >= 2));
      heights[column] += presentation.estimateHeight(post);
    });
    return columns;
  },
  setPosts(posts) { if (!this._closed) s.safe(this, { posts, postColumns: this.columnsFor(posts) }); },
  async resume() {
    if (this._closed || this.data.loading) return;
    if (this._feedVersion !== s.api.getFeedVersion()) return this.refresh();
    const request = this._resumeRequest = (this._resumeRequest || 0) + 1;
    const version = this._refreshVersion;
    const postId = this._resumePostId;
    const outcome = task => Promise.resolve().then(task).then(value => ({ value }), error => ({ error }));
    // Keep the loaded pages and their image geometry mounted. A detail visit
    // only needs the opened card's interactions updated, not a new first page.
    const [bootResult, postResult] = await Promise.all([
      outcome(() => s.api.call('bootstrap')),
      postId ? outcome(() => s.api.call('getPost', { id: postId })) : Promise.resolve({})
    ]);
    if (this._closed || request !== this._resumeRequest || version !== this._refreshVersion || this.data.loading) return;
    if (this._feedVersion !== s.api.getFeedVersion()) return this.refresh();
    const boot = bootResult.value;
    if (boot) {
      if (this.data.mode !== boot.mode || this.data.user && boot.user && this.data.user.id !== boot.user.id) return this.refresh();
      s.safe(this, { mode: boot.mode, user: boot.user, circles: [], joinedCircles: [] });
    }
    if (postResult.value && postResult.value.post) {
      this.setPosts(this.data.posts.map(item => item.id === postId ? this.preparePost(postResult.value.post) : item));
      if (this._resumePostId === postId) this._resumePostId = '';
    } else if (postResult.error && postResult.error.code === 'NOT_FOUND') {
      this.setPosts(this.data.posts.filter(item => item.id !== postId));
      if (this._resumePostId === postId) this._resumePostId = '';
    }
  },
  refresh() {
    this._resumeRequest = (this._resumeRequest || 0) + 1;
    this._resumePostId = '';
    this.cancelCoverWait();
    this._moreTask = null;
    const parameters = this.parameters();
    const version = this._refreshVersion = (this._refreshVersion || 0) + 1;
    const feedVersion = s.api.getFeedVersion();
    return s.load(this, async () => {
      const [boot, result] = await Promise.all([s.api.call('bootstrap'), s.api.call('listPosts', parameters)]);
      if (this._closed || version !== this._refreshVersion) return {};
      const key = JSON.stringify(parameters);
      if (key !== this._columnKey) { this._columnKey = key; this._columnById = new Map(); }
      const posts = result.items.map(item => this.preparePost(item));
      this._feedVersion = feedVersion;
      return { mode: boot.mode, user: boot.user, circles: [], joinedCircles: [], posts, postColumns: this.columnsFor(posts), nextCursor: result.nextCursor || null };
    }).then(() => {
      if (this._closed || version !== this._refreshVersion || this.data.error) return;
      if (this._feedVersion !== s.api.getFeedVersion()) return this.refresh();
      if (!this.data.posts.length && this.data.nextCursor) return this.loadMore();
    });
  },
  selectFeed(e) {
    if (s.personalMode || this._closed) return;
    const feed = e.currentTarget.dataset.id;
    if (feed === 'circles') return s.go('/pages/circle-square/index');
    if (!['discover', 'following'].includes(feed)) return;
    s.safe(this, { feed, selectedCircle: '' }); return this.refresh();
  },
  selectTopic(e) { const topic = e.currentTarget.dataset.topic || ''; s.safe(this, { topic: topic === this.data.topic ? '' : topic }); return this.refresh(); },
  toggleAnimalFilters() { s.safe(this, { animalFiltersOpen: !this.data.animalFiltersOpen, searchFocused: false, topicsOpen: false }); },
  closeAnimalFilters() { s.safe(this, { animalFiltersOpen: false }); },
  stopTouch() {},
  toggleTopics() { s.safe(this, { topicsOpen: !this.data.topicsOpen }); },
  selectAnimal(e) { const id = e.currentTarget.dataset.id || ''; if (id && id !== 'unclassified' && !animals.IDS.includes(id)) return; if (this.data.excludedAnimalTypes.includes(id)) return s.toast('请先在下方取消隐藏这个种类'); const animalType = id === this.data.animalType ? '' : id; s.safe(this, { animalType, animalFilterTitle: animalFilterTitle(animalType), animalFilterLabel: animalFilterLabel(animalType, this.data.excludedAnimalTypes), animalFiltersOpen: false }); return this.refresh(); },
  toggleHiddenAnimal(e) { const id = e.currentTarget.dataset.id; if (!animals.IDS.includes(id)) return; const excludedAnimalTypes = this.data.excludedAnimalTypes.includes(id) ? this.data.excludedAnimalTypes.filter(value => value !== id) : this.data.excludedAnimalTypes.concat(id); const animalType = excludedAnimalTypes.includes(this.data.animalType) ? '' : this.data.animalType; s.safe(this, { excludedAnimalTypes, hiddenChoices: animals.choices(excludedAnimalTypes), animalType, animalFilterTitle: animalFilterTitle(animalType), animalFilterLabel: animalFilterLabel(animalType, excludedAnimalTypes), preferenceError: preferences.save(wx, excludedAnimalTypes) }); return this.refresh(); },
  clearHiddenAnimals() { s.safe(this, { excludedAnimalTypes: [], hiddenChoices: animals.choices([]), animalFilterTitle: animalFilterTitle(this.data.animalType), animalFilterLabel: animalFilterLabel(this.data.animalType, []), preferenceError: preferences.save(wx, []) }); return this.refresh(); },
  focusSearch() { if (!this.data.searchFocused) s.safe(this, { searchFocused: true }); },
  blurSearch() { if (this.data.searchFocused) s.safe(this, { searchFocused: false }); },
  inputSearch(e) { s.safe(this, { searchInput: e.detail.value }); },
  search() { const query = Array.from(this.data.searchInput.trim()).slice(0, 60).join(''); if (!query && !this.data.query) return s.safe(this, { searchFocused: true }); s.safe(this, { query, searchFocused: false }); this.refresh(); },
  clearSearch() { s.safe(this, { searchInput: '', query: '' }); this.refresh(); },
  resetFilters() { s.safe(this, { feed: 'discover', selectedCircle: '', animalType: '', animalFilterTitle: animalFilterTitle(''), animalFilterLabel: animalFilterLabel('', this.data.excludedAnimalTypes), topic: '', searchInput: '', query: '' }); this.refresh(); },
  coverEvent(e, type) {
    if (this._closed || !this._covers) return;
    const data = e.currentTarget.dataset;
    const post = this.data.posts.find(item => item.id === data.id);
    if (!post || post.coverSrc !== data.src || post.coverAttempt !== Number(data.attempt)) return;
    const state = this._covers.get(data.id);
    const next = presentation.applyCoverEvent(state, { id: data.id, src: data.src, attempt: Number(data.attempt), type, width: e.detail && e.detail.width, height: e.detail && e.detail.height });
    if (!next || next === state) return;
    this._coverAttempt = Math.max(this._coverAttempt || 0, next.attempt);
    this._covers.set(data.id, next);
    this.setPosts(this.data.posts.map(item => item.id === data.id ? presentation.decorate(item, next) : item));
    this.continueAfterCovers();
  },
  onCoverLoad(e) { this.coverEvent(e, 'load'); },
  onCoverError(e) { this.coverEvent(e, 'error'); },
  retryCover(e) {
    if (this._closed || !this._covers) return;
    const data = e.currentTarget.dataset;
    const state = this._covers.get(data.id);
    if (!state || state.status !== 'error' || state.src !== data.src || state.attempt !== Number(data.attempt)) return;
    const item = this.data.posts.find(post => post.id === data.id);
    if (item && item.mediaSigned) return this.refreshCover(data.id);
    const next = presentation.retryCover(state, ++this._coverAttempt);
    this._covers.set(data.id, next);
    this.setPosts(this.data.posts.map(item => item.id === data.id ? presentation.decorate(item, next) : item));
  },
  refreshCover(id) { return s.action(this, async () => {
    const version = this._refreshVersion;
    const request = this._resumeRequest = (this._resumeRequest || 0) + 1;
    try {
      const result = await s.api.call('getPost', { id });
      if (this._closed || version !== this._refreshVersion || request !== this._resumeRequest) return;
      this._covers.delete(id);
      this.setPosts(this.data.posts.map(post => post.id === id ? this.preparePost(result.post) : post));
    } catch (error) {
      if (this._closed || version !== this._refreshVersion || request !== this._resumeRequest) return;
      if (error.code === 'NOT_FOUND') this.setPosts(this.data.posts.filter(post => post.id !== id));
      else throw error;
    }
  }); },
  openCircle(e) { if (s.personalMode) return; s.go('/pages/circle/index?id=' + e.currentTarget.dataset.id); },
  openPost(e) { this._resumePostId = e.currentTarget.dataset.id; s.go('/pages/post/index?id=' + this._resumePostId); },
  openPlace(e) { s.go('/pages/local-detail/index?id=' + e.currentTarget.dataset.id); },
  openAuthor(e) { if (s.personalMode) return; s.go('/pages/author/index?userId=' + e.currentTarget.dataset.id); },
  openEvent(e) { if (s.personalMode) return; s.go('/pages/event/index?id=' + e.currentTarget.dataset.id); },
  compose() { if (s.personalMode) return; s.go('/pages/compose/index'); },
  like(e) { if (s.personalMode) return; return s.action(this, async () => {
    const item = this.data.posts.find(post => post.id === e.currentTarget.dataset.id);
    if (!item) return;
    this._resumeRequest = (this._resumeRequest || 0) + 1;
    const loadId = this._loadId;
    const userId = this.data.user && this.data.user.id;
    const mode = this.data.mode;
    const result = await s.api.call('likePost', { id: item.id, like: !item.isLiked });
    if (!this._closed && loadId === this._loadId && mode === this.data.mode && userId === (this.data.user && this.data.user.id)) this.setPosts(this.data.posts.map(post => post.id === result.post.id ? this.preparePost(result.post) : post));
  }); },
  async loadMore() {
    if (this._closed || this.data.loading || this.data.moreBusy || this._moreTask || !this.data.nextCursor) return;
    this.cancelCoverWait();
    const task = this._moreTask = {};
    const loadId = this._loadId;
    try {
      // Empty server scan pages cannot rely on a scrollable card to reach the
      // bottom again. Probe a bounded number, stopping as soon as content exists.
      for (let scanned = 0; scanned < EMPTY_PAGE_LIMIT; scanned += 1) {
        const cursor = this.data.nextCursor;
        if (!cursor) break;
        await s.more(this, { key: 'posts', request: next => s.api.call('listPosts', this.parameters(next)), decorate: item => this.preparePost(item) });
        if (this._closed || loadId !== this._loadId || this._moreTask !== task) return;
        s.safe(this, { postColumns: this.columnsFor(this.data.posts) });
        if (this.data.posts.length || !this.data.nextCursor || this.data.nextCursor === cursor) break;
      }
    } finally { if (this._moreTask === task) this._moreTask = null; }
  },
  onShareAppMessage() { return s.shareCard(); },
  onShareTimeline() { return s.shareTimeline(); }
});
