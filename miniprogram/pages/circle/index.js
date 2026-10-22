const s = require('../_shared');
const preferences = require('../../data/feed-preferences');
const topics = require('../../data/topics');

function contentCard(item) {
  const post = s.post(item);
  const source = post.source;
  const publisher = source && (source.publisher || source.author || source.title);
  return { ...post, previewImages: post.images.slice(0, 3),
    sourceLabel: source ? '资料整理' : post.isEditorialContent ? '内容整理' : '作者分享',
    sourceText: source ? publisher ? '来源：' + publisher : '来源见正文' : '作者：' + post.author.nickname };
}

s.register({
  data: { loading: true, error: '', circle: null, topic: '', posts: [], excludedAnimalTypes: [], preferenceError: '', nextCursor: null, moreBusy: false, busy: false },
  onLoad(options = {}) {
    this.id = typeof options.id === 'string' ? options.id.trim() : '';
    this.topic = topics.normalizeTopic(options.topic);
    this._invalidTopic = !!options.topic && !this.topic;
    s.safe(this, { topic: this.topic });
    return this.refresh();
  },
  onShow() { const wasHidden = this._hidden; this._hidden = false; if (this._loaded || wasHidden) return this.refresh(); },
  onHide() {
    this._hidden = true;
    this._loadId = (this._loadId || 0) + 1;
    this._moreRequestId = (this._moreRequestId || 0) + 1;
    s.safe(this, { moreBusy: false });
  },
  onPullDownRefresh() { return this.refresh(); },
  onReachBottom() { return this.loadMore(); },
  parameters(cursor, excludedAnimalTypes = this.data.excludedAnimalTypes) {
    return this.topic ? { feed: 'discover', topic: this.topic, excludedAnimalTypes, ...(cursor ? { cursor } : {}) }
      : { id: this.id, excludedAnimalTypes, ...(cursor ? { cursor } : {}) };
  },
  refresh() {
    if (this._closed || this._hidden) return Promise.resolve();
    const saved = preferences.read(wx);
    s.safe(this, { excludedAnimalTypes: saved.excludedAnimalTypes, preferenceError: saved.error });
    return s.load(this, async () => {
      const request = this._loadId;
      if (this._invalidTopic || !this.topic && !this.id) throw new Error('暂未找到这个主题，请从主题指南重新选择。');
      if (!this.topic && s.personalMode) throw new Error('当前版本请从首页按养宠主题浏览内容。');
      const result = await s.api.call(this.topic ? 'listPosts' : 'getCircle', this.parameters(null, saved.excludedAnimalTypes));
      if (this._closed || this._hidden || request !== this._loadId) return {};
      const circle = this.topic ? { id: '', name: this.topic, description: '按养宠主题查看已有资料与作者分享。' }
        : result.circle && { id: result.circle.id, name: result.circle.name, description: '按原有分类查看已有资料与作者分享。' };
      const items = this.topic ? result.items : result.posts;
      if (!circle || !Array.isArray(items)) throw new Error('内容暂未读取完整，请重新加载。');
      if (typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: circle.name || '主题内容' });
      return { circle, posts: items.map(contentCard), nextCursor: result.nextCursor || null };
    });
  },
  loadMore() {
    if (this._closed || this._hidden || this.data.error || this.data.busy || !this.topic && s.personalMode) return Promise.resolve();
    const action = this.topic ? 'listPosts' : 'getCircle';
    const isTopic = !!this.topic;
    const parameters = this.parameters(null, this.data.excludedAnimalTypes.slice());
    return s.more(this, { key: 'posts', request: cursor => s.api.call(action, { ...parameters, cursor }),
      select: result => isTopic ? result.items : result.posts, decorate: contentCard });
  },
  openPost(e) {
    if (this._closed || this._hidden || this.data.loading || this.data.error || this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    if (this.data.posts.some(post => post.id === id)) s.go('/pages/post/index?id=' + encodeURIComponent(id));
  },
  onShareAppMessage() {
    if (this.data.loading || this.data.error || !this.data.circle) return s.shareCard('有宠有邻｜主题指南', '/pages/circle-square/index');
    const query = this.topic ? 'topic=' + encodeURIComponent(this.topic) : 'id=' + encodeURIComponent(this.id);
    return s.shareCard('有宠有邻｜' + this.data.circle.name + ' · 主题内容', '/pages/circle/index?' + query);
  },
  onShareTimeline() {
    if (this.data.loading || this.data.error || !this.data.circle) return s.shareTimeline('有宠有邻｜主题指南');
    const query = this.topic ? 'topic=' + encodeURIComponent(this.topic) : 'id=' + encodeURIComponent(this.id);
    return s.shareTimeline('有宠有邻｜' + this.data.circle.name + ' · 主题内容', query);
  }
});
