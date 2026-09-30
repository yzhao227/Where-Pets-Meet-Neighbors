const s = require('../../../pages/_shared');
const social = require('../../shared');

s.register({
  data: { loading: true, error: '', busy: false, ownId: '', mode: '', friends: [], incoming: [], outgoing: [],
    searchText: '', query: '', results: [], searching: false, searchError: '', nextCursor: null, moreBusy: false,
    requestTarget: null, requestNote: '' },
  onLoad() { this._failedImages = Object.create(null); return this.refresh(); },
  onShow() { if (this._loaded) return this.refresh(); },
  onPullDownRefresh() { return this.refresh(); },
  async refresh() {
    await s.load(this, async () => {
      const [hub, boot] = await Promise.all([s.api.call('getFriendHub'), s.api.call('bootstrap').catch(() => null)]);
      const decorate = value => social.person(value, this._failedImages);
      return { friends: (hub.friends || []).map(decorate),
        incoming: (hub.incoming || []).map(item => ({ id: item.id, from: decorate(item.from), note: item.note || '', timeText: s.relative(item.createdAt) })),
        outgoing: (hub.outgoing || []).map(item => ({ id: item.id, to: decorate(item.to), note: item.note || '', timeText: s.relative(item.createdAt) })),
        ownId: boot && boot.user ? boot.user.id || '' : this.data.ownId, mode: boot ? boot.mode : this.data.mode };
    });
    if (!this._closed && this.data.query) return this.runSearch(false);
  },
  inputSearch(e) { s.safe(this, { searchText: e.detail.value || '' }); },
  search() {
    const query = this.data.searchText.trim();
    if (!query) return this.clearSearch();
    if (Array.from(query).length > 60) return s.toast('昵称或 ID 最多 60 个字');
    s.safe(this, { query, searchText: query });
    if (wx.hideKeyboard) wx.hideKeyboard();
    return this.runSearch(false);
  },
  clearSearch() {
    this._searchId = (this._searchId || 0) + 1;
    s.safe(this, { query: '', searchText: '', results: [], searching: false, searchError: '', nextCursor: null, moreBusy: false });
  },
  async runSearch(more) {
    if (!this.data.query || more && (this.data.searching || this.data.moreBusy || !this.data.nextCursor)) return;
    const query = this.data.query;
    const cursor = more ? this.data.nextCursor : null;
    const id = this._searchId = (this._searchId || 0) + 1;
    s.safe(this, { searching: !more, moreBusy: !!more, searchError: '', ...(more ? {} : { results: [], nextCursor: null }) });
    try {
      const result = await s.api.call('searchPeople', { query, ...(cursor ? { cursor } : {}) });
      if (this._closed || id !== this._searchId || query !== this.data.query) return;
      const merged = new Map((more ? this.data.results : []).map(person => [person.id, person]));
      (result.items || []).forEach(person => merged.set(person.id, social.person(person, this._failedImages)));
      s.safe(this, { results: Array.from(merged.values()), nextCursor: result.nextCursor || null });
    } catch (error) {
      if (!this._closed && id === this._searchId) s.safe(this, { searchError: error.message || '搜索未完成，请重试' });
    } finally {
      if (id === this._searchId) s.safe(this, { searching: false, moreBusy: false });
    }
  },
  retrySearch() { return this.runSearch(false); },
  loadMore() { return this.runSearch(true); },
  copyId() { if (this.data.ownId) wx.setClipboardData({ data: this.data.ownId }); },
  beginRequest(e) {
    const target = this.data.results.find(item => item.id === e.currentTarget.dataset.id);
    if (target && target.friendStatus === 'none') s.safe(this, { requestTarget: target, requestNote: '' });
  },
  cancelRequest() { if (!this.data.busy) s.safe(this, { requestTarget: null, requestNote: '' }); },
  inputNote(e) { s.safe(this, { requestNote: e.detail.value || '' }); },
  sendRequest() {
    const target = this.data.requestTarget;
    if (!target) return;
    return s.action(this, async () => {
      const result = await s.api.call('sendFriendRequest', { targetId: target.id, note: this.data.requestNote.trim() });
      if (this._closed) return;
      s.safe(this, { requestTarget: null, requestNote: '' });
      s.toast(result.status === 'friends' ? '你们已经是好友了' : result.status === 'incoming' ? '对方也申请了，请在下方处理' : '好友申请已发送');
      await this.refresh();
    });
  },
  respond(e) {
    const id = e.currentTarget.dataset.id;
    const accept = e.currentTarget.dataset.accept === true || e.currentTarget.dataset.accept === 'true';
    if (!this.data.incoming.some(item => item.id === id)) return;
    return s.action(this, async () => {
      await s.api.call('respondFriendRequest', { requestId: id, accept });
      if (this._closed) return;
      s.toast(accept ? '已成为好友，打个招呼吧' : '已拒绝这条申请');
      await this.refresh();
    });
  },
  chat(e) {
    const targetId = e.currentTarget.dataset.id;
    return s.action(this, async () => {
      const result = await s.api.call('openDirectChat', { targetId });
      if (!this._closed) social.openChat(result.conversation);
    });
  },
  removeFriend(e) {
    const targetId = e.currentTarget.dataset.id;
    const person = this.data.friends.find(item => item.id === targetId);
    if (!person) return;
    return s.action(this, async () => {
      if (!await s.confirm('删除这位好友？', '删除后，你与「' + person.nickname + '」将解除好友关系，已有聊天记录仍可查看。', '删除好友') || this._closed) return;
      await s.api.call('removeFriend', { targetId });
      if (!this._closed) { s.toast('已删除好友'); await this.refresh(); }
    });
  },
  imageFailed(e) {
    const { id, src } = e.currentTarget.dataset;
    this._failedImages[id] = src;
    const fix = person => person.id === id && person.avatarUrl === src ? { ...person, avatarUrl: '' } : person;
    s.safe(this, { friends: this.data.friends.map(fix), results: this.data.results.map(fix),
      incoming: this.data.incoming.map(item => ({ ...item, from: fix(item.from) })),
      outgoing: this.data.outgoing.map(item => ({ ...item, to: fix(item.to) })) });
  }
});
