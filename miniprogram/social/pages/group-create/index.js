const s = require('../../../pages/_shared');
const social = require('../../shared');

s.register({
  data: { loading: true, error: '', busy: false, name: '', friends: [], selectedIds: [], selectedCount: 0,
    createError: '', attemptLocked: false, createdConversation: null },
  onLoad() { this._failedImages = Object.create(null); return this.refresh(); },
  onShow() { if (this._loaded && !this.data.attemptLocked && !this.data.createdConversation) return this.refresh(); },
  onPullDownRefresh() { return this.refresh(); },
  refresh() {
    if (this.data.attemptLocked || this.data.createdConversation) {
      if (wx.stopPullDownRefresh) wx.stopPullDownRefresh();
      return Promise.resolve();
    }
    return s.load(this, async () => {
      const hub = await s.api.call('getFriendHub');
      const friends = (hub.friends || []).map(item => social.person(item, this._failedImages));
      const selectedIds = this.data.selectedIds.filter(id => friends.some(item => item.id === id));
      return { friends: friends.map(item => ({ ...item, selected: selectedIds.includes(item.id) })), selectedIds, selectedCount: selectedIds.length };
    });
  },
  inputName(e) { if (!this.data.attemptLocked) s.safe(this, { name: e.detail.value || '', createError: '' }); },
  toggleFriend(e) {
    if (this.data.busy || this.data.attemptLocked || this.data.createdConversation) return;
    const id = e.currentTarget.dataset.id;
    if (!this.data.friends.some(item => item.id === id)) return;
    const selected = this.data.selectedIds.includes(id);
    if (!selected && this.data.selectedIds.length >= 19) return s.toast('一个群最多邀请 19 位好友');
    const selectedIds = selected ? this.data.selectedIds.filter(value => value !== id) : [...this.data.selectedIds, id];
    s.safe(this, { selectedIds, selectedCount: selectedIds.length, createError: '', friends: this.data.friends.map(item => ({ ...item, selected: selectedIds.includes(item.id) })) });
  },
  addFriends() { s.go('/social/pages/friends/index'); },
  async createGroup() {
    if (this.data.busy || this.data.createdConversation) return;
    if (!this._createAttempt) {
      const name = this.data.name.trim();
      if (!name || Array.from(name).length > 30) return s.toast('给群聊起个 1–30 个字的名字');
      if (!this.data.selectedIds.length || this.data.selectedIds.length > 19) return s.toast('请选择 1–19 位已确认的好友');
      this._createRequestId = this._createRequestId || social.requestId('group');
      this._createAttempt = { name, memberIds: this.data.selectedIds.slice(), requestId: this._createRequestId };
    }
    s.safe(this, { busy: true, attemptLocked: true, createError: '' });
    try {
      const result = await s.api.call('createGroupChat', this._createAttempt);
      if (!result.conversation || !result.conversation.id) throw new Error('尚未确认创建结果，请重试');
      if (this._closed) return;
      this._createAttempt = null;
      this._createRequestId = null;
      s.safe(this, { createdConversation: result.conversation, attemptLocked: false });
      this.openCreated();
    } catch (error) {
      if (this._closed) return;
      const editable = ['INVALID_INPUT', 'VERIFICATION_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'NOT_FRIENDS', 'NOT_FRIEND', 'FRIEND_REQUIRED', 'MEMBER_UNAVAILABLE', 'CONTENT_REJECTED', 'CONTENT_BLOCKED'].includes(error.code);
      if (editable) this._createAttempt = null;
      s.safe(this, { attemptLocked: !editable, createError: error.message || '创建暂未完成，请重试。当前选择已为你保留。' });
      if (error.code === 'VERIFICATION_REQUIRED') s.openVerification();
    } finally { s.safe(this, { busy: false }); }
  },
  openCreated() {
    if (!this.data.createdConversation) return;
    const url = '/social/pages/chat/index?id=' + encodeURIComponent(this.data.createdConversation.id);
    // Replacing this completed form prevents accidental creation on a back gesture.
    if (wx.redirectTo) wx.redirectTo({ url, fail: () => { if (!this._closed) s.safe(this, { createError: '群聊已创建，点下方按钮进入。' }); } });
    else social.openChat(this.data.createdConversation);
  },
  imageFailed(e) {
    const { id, src } = e.currentTarget.dataset;
    this._failedImages[id] = src;
    s.safe(this, { friends: this.data.friends.map(item => item.id === id && item.avatarUrl === src ? { ...item, avatarUrl: '' } : item) });
  }
});
