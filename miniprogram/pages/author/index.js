const s = require('../_shared');
const petData = require('../../data/pets');
const preferences = require('../../data/feed-preferences');
s.register({
  data: { loading: true, error: '', mode: '', user: null, canChat: false, posts: [], excludedAnimalTypes: [], preferenceError: '', nextCursor: null, moreBusy: false, busy: false },
  onLoad(options) { this.userId = typeof options.userId === 'string' ? options.userId.trim() : ''; return this.refresh(); },
  onShow() { const wasHidden = this._hidden; this._hidden = false; if (wasHidden || this._loaded) return this.refresh(); },
  onHide() { this._hidden = true; this._loadId = (this._loadId || 0) + 1; this._moreRequestId = (this._moreRequestId || 0) + 1; },
  onPullDownRefresh() { return this.refresh(); },
  refresh() { const saved = preferences.read(wx); s.safe(this, { excludedAnimalTypes: saved.excludedAnimalTypes, preferenceError: saved.error }); return s.load(this, async () => { if (!this.userId) throw new Error('找不到这个账号'); const [boot, result] = await Promise.all([s.api.call('bootstrap'), s.api.call('getUserProfile', { userId: this.userId, excludedAnimalTypes: saved.excludedAnimalTypes })]); const user = s.person(result.user); return { mode: boot.mode, user, canChat: !s.personalMode && !user.isMine && !user.isEditorial && !!user.id, pets: (user.pets || []).map(pet => ({ ...pet, typeName: (petData.TYPES.find(type => type.id === pet.type) || {}).name || '动物伙伴', ageLabel: pet.ageLabel || petData.ageLabel(pet) })), petText: user.pet ? ({ cat: '猫', dog: '狗', rabbit: '兔子', 'small-mammal': '小型哺乳动物', bird: '鸟', fish: '鱼', reptile: '爬行动物', amphibian: '两栖动物', invertebrate: '无脊椎动物', other: '其他宠物' }[user.pet.type] || '宠物') : '', privacyText: user.isEditorial ? '' : user.isMine ? (user.showPet ? '简介仅自己可见；宠物名字和类型已按头像旁展示设置公开。' : '简介与宠物资料仅自己可见，公开帖子始终可见。') : (user.pet ? '这位同好公开了宠物名字和类型，暂未公开更多介绍。' : '这位同好暂未公开更多介绍。可以先从日常认识彼此。'), posts: result.posts.map(s.post), nextCursor: result.nextCursor || null }; }); },
  follow() { return s.action(this, async () => { if (this.data.user.isMine) return; const follow = !this.data.user.isFollowing; if (!follow && !await s.confirm('取消关注「' + this.data.user.nickname + '」？', '取消后，该账号的内容将不再出现在你的关注列表中。', '取消关注')) return; await s.api.call('followUser', { userId: this.userId, follow }); await this.refresh(); if (!this._closed) s.toast(this.data.mode === 'demo' ? '关注状态已保存在本机' : follow ? '已关注' : '已取消关注'); }); },
  startChat() {
    const user = this.data.user;
    if (s.personalMode || this._closed || this._hidden || this.data.loading || this.data.error || !user || user.isMine) return;
    if (user.isEditorial) return s.toast('内容整理账号暂不接收私信');
    if (!this.data.canChat) return;
    return s.action(this, async () => {
      const userId = this.userId;
      const loadId = this._loadId;
      const result = await s.api.call('openDirectChat', { targetId: userId });
      if (this._closed || this._hidden || loadId !== this._loadId || userId !== this.userId) return;
      if (!result || !result.conversation || !result.conversation.id) throw new Error('会话暂时无法打开，请重试');
      s.go('/social/pages/chat/index?id=' + encodeURIComponent(result.conversation.id));
    });
  },
  editProfile() { s.go('/pages/profile/index'); },
  openPost(e) { s.go('/pages/post/index?id=' + e.currentTarget.dataset.id); },
  openEvent(e) { s.go('/pages/event/index?id=' + e.currentTarget.dataset.id); },
  like(e) { return s.action(this, async () => { const post = this.data.posts.find(item => item.id === e.currentTarget.dataset.id); if (!post) return; const result = await s.api.call('likePost', { id: post.id, like: !post.isLiked }); s.updatePost(this, result.post); }); },
  moreMenu() { return s.action(this, async () => { if (this.data.user.isMine) return; const choice = await s.choose(['举报这位用户', '屏蔽这位用户']); if (choice === 0) await s.report('user', this.userId); else if (choice === 1 && await s.block(this.userId) && !this._closed) s.back(); }); },
  loadMore() { return s.more(this, { key: 'posts', request: cursor => s.api.call('getUserProfile', { userId: this.userId, cursor, excludedAnimalTypes: this.data.excludedAnimalTypes }), select: result => result.posts, decorate: s.post }); },
  onShareAppMessage() { if (this.data.loading || this.data.error || !this.data.user || !this.userId) return s.shareCard(); return s.shareCard('在有宠有邻看看' + this.data.user.nickname, '/pages/author/index?userId=' + encodeURIComponent(this.userId)); },
  onShareTimeline() { if (this.data.loading || this.data.error || !this.data.user || !this.userId) return s.shareTimeline(); return s.shareTimeline('在有宠有邻看看' + this.data.user.nickname, 'userId=' + encodeURIComponent(this.userId)); }
});
