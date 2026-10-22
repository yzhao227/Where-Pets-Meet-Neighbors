const s = require('../../../pages/_shared');
const petData = require('../../../data/pets');
const contentPolicy = require('../../../data/content-policy');
const PAGE_SIZE = 20;
const localMedia = value => typeof value === 'string' && !/^cloud:/i.test(value) ? value : '';
const blank = () => ({ user: null, posts: [], pets: [], drafts: [], selected: null, totalPosts: 0, hasMore: false });
const date = value => Number.isFinite(value) && value > 0 ? s.dateText(value) : '';
const entry = (item, draft) => ({ id: item.id, title: item.title || (draft ? '未保存的日记草稿' : '私人日记'),
  text: typeof item.text === 'string' ? item.text : '', timeText: date(draft ? item.savedAt : item.createdAt),
  images: (Array.isArray(item.images) ? item.images : []).map(localMedia).filter(Boolean),
  hasRetiredAttachment: contentPolicy.isVideoPost(item) || (item.pendingUploads || []).concat(item.failedUploads || []).some(contentPolicy.isVideoUpload),
  draft: !!draft, pendingCount: (item.pendingUploads || []).length + (item.failedUploads || []).length });
function hideSharing() {
  if (typeof wx.hideShareMenu === 'function') wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
}

s.register({
  data: { ...blank(), loading: true, error: '', section: 'posts' },
  onLoad() { this._active = true; hideSharing(); return this.refresh(); },
  onShow() { this._active = true; hideSharing(); return this.refresh(); },
  onHide() { this.forget(); },
  onUnload() { this.forget(); },
  onPullDownRefresh() { return this.refresh(); },
  forget() {
    this._active = false; this._request = (this._request || 0) + 1;
    this._library = null; this._ownerId = '';
    s.safe(this, { ...blank(), loading: true, error: '' });
  },
  async refresh() {
    const request = this._request = (this._request || 0) + 1;
    s.safe(this, { ...blank(), loading: true, error: '' });
    try {
      const library = await s.api.getPrivateLibrary();
      if (this._closed || !this._active || request !== this._request) return;
      this._library = library; this._ownerId = library.ownerId; this._loaded = true;
      s.safe(this, { user: library.user, posts: library.posts.slice(0, PAGE_SIZE).map(item => entry(item)),
        totalPosts: library.posts.length, hasMore: library.posts.length > PAGE_SIZE,
        pets: library.pets.map(pet => ({ ...pet, photo: localMedia(pet.photo),
          typeLabel: (petData.TYPES.find(type => type.id === pet.type) || {}).name || '宠物', ageLabel: petData.ageLabel(pet) })),
        drafts: library.drafts.map(item => entry(item, true)), loading: false });
    } catch (error) {
      if (!this._closed && this._active && request === this._request) s.safe(this, { ...blank(), loading: false, error: error.message || '本机私人资料暂时无法读取，原数据仍保留。' });
    } finally { if (wx.stopPullDownRefresh) wx.stopPullDownRefresh(); }
  },
  async currentLibrary() {
    const ownerId = this._ownerId, request = this._request;
    let library;
    try { library = await s.api.getPrivateLibrary(); }
    catch (error) {
      if (this._closed || !this._active || request !== this._request) return null;
      this._library = null; this._ownerId = '';
      s.safe(this, { ...blank(), loading: false, error: error.message || '本机私人资料暂时无法读取，请重新读取。' });
      return null;
    }
    if (this._closed || !this._active || request !== this._request) return null;
    if (library.ownerId !== ownerId) {
      this._library = null; this._ownerId = '';
      s.safe(this, { ...blank(), error: '本机账号已切换，请重新读取当前账号的私人资料。' });
      return null;
    }
    this._library = library;
    return library;
  },
  selectSection(e) {
    const section = e.currentTarget.dataset.section;
    if (['posts', 'pets', 'drafts'].includes(section)) s.safe(this, { section, selected: null });
  },
  async showEntry(e) {
    try {
      const library = await this.currentLibrary();
      if (!library) return;
      const isDraft = e.currentTarget.dataset.draft === true || e.currentTarget.dataset.draft === 'true';
      const item = (isDraft ? library.drafts : library.posts).find(row => row.id === e.currentTarget.dataset.id);
      s.safe(this, { selected: item ? entry(item, isDraft) : null });
    } catch (error) { s.safe(this, { selected: null, error: error.message || '资料暂时无法读取' }); }
  },
  closeEntry() { s.safe(this, { selected: null }); },
  async loadMore() {
    try {
      const library = await this.currentLibrary();
      if (!library) return;
      const count = this.data.posts.length + PAGE_SIZE;
      s.safe(this, { posts: library.posts.slice(0, count).map(item => entry(item)), hasMore: library.posts.length > count });
    } catch (error) { s.toast(error.message || '暂时无法加载更多日记'); }
  }
});
