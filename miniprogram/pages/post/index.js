const s = require('../_shared');
const media = require('./_media');
const visibility = require('../../data/post-visibility');
function copyLink(page, value, successText) {
  const url = s.httpsUrl(value);
  if (!url) return s.toast('链接暂不可用，请稍后再试');
  const fail = () => { if (!page._closed) s.toast('链接未能复制，请再试一次'); };
  try {
    wx.setClipboardData({ data: url, success: () => { if (!page._closed) s.toast(successText); }, fail });
  } catch (error) { fail(); }
}
function selectedCredit(page, event) {
  const index = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.index;
  if (!(typeof index === 'number' && Number.isInteger(index) || typeof index === 'string' && /^\d+$/.test(index))) return null;
  const credits = page.data.post && page.data.post.imageCredits;
  return Array.isArray(credits) && Number(index) >= 0 ? credits[Number(index)] : null;
}
s.register({
  data: { videoError: false, videoSource: '', videoPlayerPath: '', videoWaiting: false, videoAttempt: 0, photoItems: [], photoIndex: 0, photoHeightPercent: 75, loading: true, error: '', mode: '', post: null, comments: [], nextCursor: null, moreBusy: false, text: '', hasCommentText: false, commentOpen: false, commentFocused: false, keyboardHeight: 0, replyId: '', replyName: '', busy: false, canModerate: false },
  onLoad(options) { this.id = options.id; this.syncShareMenu(); this.refresh(); }, onShow() { if (this._loaded) this.refresh(); }, onPullDownRefresh() { this.refresh(); },
  refresh() { return s.load(this, async () => { if (!this.id) throw new Error('找不到这篇内容'); const [boot, result] = await Promise.all([s.api.call('bootstrap'), s.api.call('getPost', { id: this.id })]); const post = s.post(result.post); const photoItems = media.photos(post, this.data.photoItems); const photoIndex = Math.min(this.data.photoIndex, Math.max(0, photoItems.length - 1)); return { mode: boot.mode, canModerate: !s.personalMode && !!boot.user.isAdmin, post, photoItems, photoIndex, photoHeightPercent: media.photoHeight(photoItems, photoIndex), comments: s.personalMode ? [] : (result.comments || []).map(s.comment), nextCursor: s.personalMode ? null : result.nextCursor || null }; }).then(() => { if (this._closed) return; if (this.data.error) { this._videoRequest = (this._videoRequest || 0) + 1; s.safe(this, { post: null, comments: [], photoItems: [], videoSource: '', videoPlayerPath: '', videoWaiting: false, commentOpen: false }); } this.syncShareMenu(); if (!this.data.error) return this.prepareVideo(); }); },
  syncShareMenu() {
    const visible = !s.personalMode && !this.data.loading && !this.data.error && this.data.post && this.data.post.visibility === 'public';
    const method = visible ? 'showShareMenu' : 'hideShareMenu';
    if (typeof wx[method] === 'function') wx[method]({ menus: ['shareAppMessage', 'shareTimeline'] });
  },
  changeVisibility() { if (s.personalMode) return; return s.action(this, () => this.editVisibility()); },
  async editVisibility() { if (s.personalMode) return;
    const post = this.data.post;
    if (!post || !post.isMine) return;
    const index = await s.choose(visibility.choices.map(item => item.name + (item.id === post.visibility ? '（当前）' : '')));
    const choice = visibility.choices[index];
    if (this._closed || !choice || choice.id === post.visibility) return;
    const result = await s.api.call('setPostVisibility', { id: this.id, visibility: choice.id });
    if (this._closed) return;
    s.safe(this, { post: s.post(result.post) }); this.syncShareMenu();
    await this.refresh();
    if (!this._closed && !this.data.error) s.toast('已设为' + choice.name);
  },
  async prepareVideo() {
    const video = this.data.post && this.data.post.video;
    const videoPlayerPath = video && media.playerPath(video.url, this.id);
    if (videoPlayerPath) {
      this._videoRequest = (this._videoRequest || 0) + 1;
      s.safe(this, { videoPlayerPath, videoSource: '', videoError: false, videoWaiting: false });
      return;
    }
    if (!video || this._closed || this.data.videoSource === media.videoPath(video.url) && !this.data.videoError) return;
    const request = this._videoRequest = (this._videoRequest || 0) + 1;
    s.safe(this, { videoError: false, videoWaiting: true, videoSource: '' });
    try {
      const videoSource = await media.videoSource(wx, video.url);
      if (!this._closed && request === this._videoRequest) s.safe(this, { videoSource, videoWaiting: false });
    } catch (_) { if (!this._closed && request === this._videoRequest) this.videoFailed(); }
  },
  currentVideoEvent(e) { const data = e && e.currentTarget && e.currentTarget.dataset; return !e || data && Number(data.attempt) === this.data.videoAttempt && data.src === this.data.videoSource; },
  videoFailed(e) { if (this.currentVideoEvent(e)) s.safe(this, { videoError: true, videoWaiting: false }); },
  videoBuffering(e) { if (this.currentVideoEvent(e) && !this.data.videoWaiting && !this.data.videoError) s.safe(this, { videoWaiting: true }); },
  videoReady(e) { if (this.currentVideoEvent(e) && this.data.videoWaiting) s.safe(this, { videoWaiting: false }); },
  retryVideo() { s.safe(this, { videoAttempt: this.data.videoAttempt + 1 }); if (this.data.post && this.data.post.mediaSigned) { s.safe(this, { videoSource: '' }); return this.refresh(); } return this.prepareVideo(); },
  openVideo() { if (this.data.videoPlayerPath) s.go(this.data.videoPlayerPath); },
  photoChanged(e) { const index = Number(e.detail.current); if (Number.isInteger(index) && index >= 0 && index < this.data.photoItems.length && index !== this.data.photoIndex) s.safe(this, { photoIndex: index, photoHeightPercent: media.photoHeight(this.data.photoItems, index) }); },
  selectPhoto(e) { this.photoChanged({ detail: { current: e.currentTarget.dataset.index } }); },
  previousPhoto() { this.photoChanged({ detail: { current: this.data.photoIndex - 1 } }); },
  nextPhoto() { this.photoChanged({ detail: { current: this.data.photoIndex + 1 } }); },
  photoLoaded(e) { const photoItems = media.photoEvent(this.data.photoItems, e, 'ready'); if (photoItems !== this.data.photoItems) s.safe(this, { photoItems, photoHeightPercent: media.photoHeight(photoItems, this.data.photoIndex) }); },
  photoFailed(e) { const photoItems = media.photoEvent(this.data.photoItems, e, 'error'); if (photoItems !== this.data.photoItems) s.safe(this, { photoItems }); },
  retryPhoto(e) { const index = Number(e.currentTarget.dataset.index); const item = this.data.photoItems[index]; if (item && item.status === 'error') { s.safe(this, { photoItems: this.data.photoItems.map((value, i) => i === index ? Object.assign({}, value, { status: 'loading', attempt: value.attempt + 1 }) : value) }); if (this.data.post && this.data.post.mediaSigned) return this.refresh(); } },
  onHide() { this.dismissComment(); if (this.data.post && this.data.post.video && typeof wx.createVideoContext === 'function') { try { wx.createVideoContext('post-video', this).pause(); } catch (_) {} } },
  onUnload() { this.hideCommentKeyboard(); },
  loadMore() { if (s.personalMode) return; return s.more(this, { key: 'comments', request: cursor => s.api.call('getPost', { id: this.id, cursor }), select: result => result.comments, decorate: s.comment }); },
  openAuthor(e) { if (s.personalMode) return; s.go('/pages/author/index?userId=' + e.currentTarget.dataset.id); },
  openEvent() { if (s.personalMode) return; if (this.data.post.event) s.go('/pages/event/index?id=' + this.data.post.event.id); },
  openPlace() { if (this.data.post.place) s.go('/pages/local-detail/index?id=' + this.data.post.place.id); },
  like() { if (s.personalMode) return; return s.action(this, async () => { const result = await s.api.call('likePost', { id: this.id, like: !this.data.post.isLiked }); s.safe(this, { post: s.post(result.post) }); }); },
  bookmark() { return s.action(this, async () => { const result = await s.api.call('bookmarkPost', { id: this.id, bookmark: !this.data.post.isBookmarked }); s.safe(this, { post: s.post(result.post) }); if (!this._closed) s.toast(result.post.isBookmarked ? '已收藏，可以在我的收藏里找到' : '已取消收藏'); }); },
  openCircle() { if (s.personalMode) return; s.go('/pages/circle/index?id=' + this.data.post.circle.id); },
  preview(e) { s.preview(this.data.post.images, e.currentTarget.dataset.src); },
  copySource() { const source = this.data.post && this.data.post.source; return copyLink(this, source && source.url, '原文链接已复制，可在浏览器中查看'); },
  copyImageSource(e) { const credit = selectedCredit(this, e); return copyLink(this, credit && credit.sourceUrl, '图片来源已复制，可在浏览器中查看'); },
  copyImageLicense(e) { const credit = selectedCredit(this, e); return copyLink(this, credit && credit.licenseUrl, '许可链接已复制，可在浏览器中查看'); },
  openComment() { if (s.personalMode) return; if (this._closed || this.data.busy || this.data.loading || this.data.error) return; s.safe(this, { commentOpen: true, commentFocused: true }); },
  hideCommentKeyboard() { if (typeof wx.hideKeyboard === 'function') { try { wx.hideKeyboard({}); } catch (_) {} } },
  dismissComment() { s.safe(this, { commentOpen: false, commentFocused: false, keyboardHeight: 0 }); this.hideCommentKeyboard(); },
  closeComment() { if (!this.data.busy && !this._closed) this.dismissComment(); },
  preventBackgroundScroll() {},
  commentKeyboardChanged(e) { const height = e && e.detail && e.detail.height; if (this._closed || !this.data.commentOpen || !Number.isFinite(height) || height < 0) return; const keyboardHeight = Math.min(1000, height); if (keyboardHeight !== this.data.keyboardHeight) s.safe(this, { keyboardHeight }); },
  showComments() { if (s.personalMode) return; if (!this._closed && !this.data.loading && !this.data.error && typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ selector: '#post-comments', duration: 250 }); },
  input(e) { const text = typeof e.detail.value === 'string' ? e.detail.value : ''; s.safe(this, { text, hasCommentText: !!text.trim() }); },
  reply(e) { if (s.personalMode) return; if (this._closed || this.data.busy) return; const comment = this.data.comments.find(value => value.id === e.currentTarget.dataset.id); if (comment) { s.safe(this, { replyId: comment.id, replyName: comment.author.nickname }); this.openComment(); } },
  cancelReply() { s.safe(this, { replyId: '', replyName: '' }); },
  send() { if (s.personalMode) return; if (this._closed) return; return s.action(this, async () => { const text = this.data.text.trim(); if (!text) return s.toast('写一点想说的话吧'); await s.api.call('addComment', { targetType: 'post', targetId: this.id, text, replyToId: this.data.replyId || undefined }); if (this._closed) return; s.safe(this, { text: '', hasCommentText: false, replyId: '', replyName: '' }); this.dismissComment(); await this.refresh(); if (!this._closed) s.toast(this.data.mode === 'demo' ? '演示回应已保存在本机' : '回应已送到'); }); },
  more() { if (s.personalMode) return this.deletePrivateRecord(); return s.action(this, async () => { const post = this.data.post; const canDelete = post.isMine || this.data.canModerate; const items = post.isMine ? ['设置可见范围', '删除这篇日常'] : canDelete ? ['举报内容', '屏蔽这位用户', '删除内容（管理员）'] : ['举报内容', '屏蔽这位用户']; const index = await s.choose(items); if (index < 0 || this._closed) return; if (post.isMine && index === 0) return this.editVisibility(); if ((post.isMine && index === 1) || (!post.isMine && index === 2 && canDelete)) { if (!await s.confirm('删除这篇日常？', '删除后无法恢复，相关回应也将不可见。', '删除')) return; await s.api.call('deletePost', { id: this.id }); if (!this._closed) { s.toast('已删除'); s.back(); } } else if (index === 0) await s.report('post', this.id); else if (index === 1 && await s.block(post.author.id)) { if (!this._closed) s.back(); } }); },
  commentMenu(e) { if (s.personalMode) return; return s.action(this, async () => { const item = this.data.comments.find(value => value.id === e.currentTarget.dataset.id); if (!item) return; const options = item.isMine ? ['删除这条回应'] : this.data.canModerate ? ['举报回应', '屏蔽这位用户', '删除回应（管理员）'] : ['举报回应', '屏蔽这位用户']; const choice = await s.choose(options); if (choice < 0 || this._closed) return; if ((item.isMine && choice === 0) || (!item.isMine && this.data.canModerate && choice === 2)) { if (!await s.confirm('删除这条回应？', '删除后无法恢复。', '删除')) return; await s.api.call('deleteComment', { id: item.id }); await this.refresh(); } else if (choice === 0) await s.report('comment', item.id); else if (choice === 1 && await s.block(item.author.id)) await this.refresh(); }); },
  deletePrivateRecord() { return s.action(this, async () => {
    if (!s.personalMode || !this.data.post || !this.data.post.isMine) return;
    if (!await s.confirm('删除这篇私人日记？', '删除后无法恢复。', '删除')) return;
    await s.api.call('deletePost', { id: this.id });
    if (!this._closed) { s.toast('日记已删除'); s.back(); }
  }); },
  onShareAppMessage() { if (s.personalMode) return {}; if (this.data.loading || this.data.error || !this.data.post || this.data.post.visibility !== 'public') return { title: '有宠有邻｜喜欢宠物，就在这里相遇', path: '/pages/community/index', imageUrl: '/assets/event-walk.png' }; return { title: this.data.post ? (this.data.post.title || this.data.post.text || '看看这份宠物分享').slice(0, 45) : '有宠有邻的分享', path: '/pages/post/index?id=' + this.id }; }
});
