const s = require('../../../pages/_shared');
const social = require('../../shared');
const PAGE_SIZE = 40;
const inaccessible = error => ['FORBIDDEN', 'NOT_FOUND', 'NOT_MEMBER', 'CONVERSATION_NOT_FOUND', 'AUTH_REQUIRED', 'ACCOUNT_UNAVAILABLE', 'FEATURE_UNAVAILABLE'].includes(error.code);
function directConversation(conversation) {
  if (!conversation) throw new Error('会话暂时无法读取，请重试');
  if (conversation.kind !== 'direct') {
    const error = new Error('这个会话已停用，请返回消息页查看留言。');
    error.code = 'FEATURE_UNAVAILABLE';
    throw error;
  }
  return { ...conversation, name: conversation.name || '宠友留言' };
}

s.register({
  data: { loading: true, error: '', syncError: '', readError: '', moreBusy: false, busy: false,
    conversation: null, messages: [], pending: [], nextCursor: null,
    draft: '', scrollTarget: '', mode: '' },
  onLoad(options) {
    this._conversationId = typeof options.id === 'string' ? options.id : '';
    this._failedImages = Object.create(null);
    this._localMessages = [];
    this._revision = 0;
    this._accessVersion = 0;
    this._depth = 1;
    this._active = true;
    this._atBottom = true;
    if (!this._conversationId) { s.safe(this, { loading: false, error: '缺少会话信息，请返回消息页重新打开。' }); return; }
    s.api.call('bootstrap').then(boot => { if (!this._closed) s.safe(this, { mode: boot.mode }); }).catch(() => {});
    return this.refresh();
  },
  onShow() {
    this._active = true;
    this.startPolling();
    if (this._conversationId && !this._fetching) return this.refresh(!!this._loaded);
  },
  onHide() { this.stopPolling(); },
  onUnload() { this.stopPolling(); },
  onPullDownRefresh() { return this.refresh(); },
  startPolling() {
    if (this._timer) clearInterval(this._timer);
    if (this._conversationId) this._timer = setInterval(() => { if (this._active && !this._closed) this.refresh(true); }, 5000);
  },
  stopPolling() {
    this._active = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._historyToken = (this._historyToken || 0) + 1;
    this._fetching = false;
  },
  valid(token) { return !this._closed && this._active && token === this._historyToken; },
  clearConversation() {
    this._accessVersion += 1;
    this._historyToken = (this._historyToken || 0) + 1;
    this._fetching = false;
    this._localMessages = [];
    this._readWanted = 0;
    this._readAck = 0;
    s.safe(this, { messages: [], pending: [], draft: '', nextCursor: null, conversation: null, readError: '', syncError: '', loading: false, moreBusy: false });
  },
  async refresh(quiet) {
    if (!this._conversationId || this._fetching || !this._active || this._closed) return;
    this._fetching = true;
    const token = this._historyToken = (this._historyToken || 0) + 1;
    const revision = this._revision;
    s.safe(this, { loading: !this._loaded && !quiet, syncError: '', moreBusy: false });
    try {
      // Refresh the loaded depth so hidden or removed older messages disappear too.
      let cursor = null;
      let conversation;
      let fetched = [];
      let fetchedPages = 0;
      do {
        const result = await s.api.call('getChatMessages', { conversationId: this._conversationId, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
        if (!this.valid(token)) return;
        conversation = directConversation(result.conversation);
        fetched = fetched.concat(result.items || []);
        cursor = result.nextCursor || null;
        fetchedPages += 1;
      } while (cursor && fetchedPages < this._depth);
      const arrivedWhileLoading = this._localMessages.filter(item => item.revision > revision);
      this._localMessages = arrivedWhileLoading;
      const messages = social.mergeMessages(fetched.concat(arrivedWhileLoading.map(item => item.message))).map(item => social.chatMessage(item, this._failedImages));
      this._loaded = true;
      this._depth = fetchedPages;
      s.safe(this, { conversation, messages, nextCursor: cursor, loading: false, error: '', syncError: '' });
      if (this._atBottom) this.scrollBottom();
      const throughSeq = fetched.reduce((seq, message) => Math.max(seq, Number.isSafeInteger(message.seq) ? message.seq : 0), 0);
      await this.markRead(throughSeq);
    } catch (error) {
      if (!this.valid(token)) return;
      const revoked = inaccessible(error);
      if (revoked) this.clearConversation();
      s.safe(this, { loading: false, ...(this._loaded && !revoked ? { syncError: error.message || '同步暂时中断，请重试' } : { error: error.message || '留言记录未能加载，请重试' }) });
    } finally {
      if (token === this._historyToken) { this._fetching = false; s.safe(this, { loading: false }); }
      if (!this._closed && wx.stopPullDownRefresh) wx.stopPullDownRefresh();
    }
  },
  async loadEarlier() {
    if (!this.data.nextCursor || this._fetching || !this._active || this._closed || !this.data.conversation || this.data.conversation.kind !== 'direct') return;
    this._fetching = true;
    this._atBottom = false;
    const token = this._historyToken = (this._historyToken || 0) + 1;
    const cursor = this.data.nextCursor;
    const firstId = this.data.messages.length && this.data.messages[0].id;
    s.safe(this, { moreBusy: true, syncError: '' });
    try {
      const result = await s.api.call('getChatMessages', { conversationId: this._conversationId, cursor, limit: PAGE_SIZE });
      if (!this.valid(token)) return;
      const conversation = directConversation(result.conversation);
      const incoming = (result.items || []).map(item => social.chatMessage(item, this._failedImages));
      this._depth += 1;
      s.safe(this, { conversation, messages: social.mergeMessages(incoming.concat(this.data.messages)), nextCursor: result.nextCursor || null,
        ...(firstId ? { scrollTarget: 'message-' + firstId } : {}) });
      const throughSeq = (result.items || []).reduce((seq, message) => Math.max(seq, Number.isSafeInteger(message.seq) ? message.seq : 0), 0);
      await this.markRead(throughSeq);
    } catch (error) {
      if (this.valid(token)) {
        if (inaccessible(error)) { this.clearConversation(); s.safe(this, { error: error.message || '已无法读取这个会话' }); }
        else s.safe(this, { syncError: error.message || '更早的记录未能加载，请重试' });
      }
    } finally {
      if (token === this._historyToken) { this._fetching = false; s.safe(this, { moreBusy: false }); }
    }
  },
  async markRead(throughSeq) {
    if (!throughSeq || !this._active || this._closed || !this.data.conversation || this.data.conversation.kind !== 'direct') return;
    this._readWanted = Math.max(this._readWanted || 0, throughSeq);
    if (this._reading) return;
    this._reading = true;
    const accessVersion = this._accessVersion;
    try {
      while (this._active && !this._closed && accessVersion === this._accessVersion && this.data.conversation && this.data.conversation.kind === 'direct' && this._readWanted > (this._readAck || 0)) {
        const seq = this._readWanted;
        await s.api.call('readConversation', { conversationId: this._conversationId, throughSeq: seq });
        if (!this._active || this._closed || accessVersion !== this._accessVersion) return;
        this._readAck = seq;
        s.safe(this, { readError: '' });
      }
    } catch (_) {
      if (!this._closed && this._active && accessVersion === this._accessVersion) s.safe(this, { readError: '已读状态暂未保存，下次同步会重试。' });
    } finally { this._reading = false; }
  },
  inputDraft(e) { s.safe(this, { draft: e.detail.value || '' }); },
  send() {
    if (!this._active || this._closed) return;
    const text = this.data.draft.trim();
    if (!text) return;
    if (Array.from(text).length > 1000) return s.toast('每条留言最多 1000 个字');
    if (!this.data.conversation || this.data.conversation.kind !== 'direct' || !this.data.conversation.canSend) return s.toast('当前会话暂时不能发送留言');
    const requestId = social.requestId('chat');
    const pending = { id: requestId, requestId, text, state: 'sending', error: '' };
    s.safe(this, { draft: '', pending: this.data.pending.concat(pending) });
    this._atBottom = true;
    this.scrollBottom();
    return this.sendPending(requestId);
  },
  retryMessage(e) {
    if (!this._active || this._closed) return;
    const item = this.data.pending.find(message => message.id === e.currentTarget.dataset.id);
    if (item && item.state === 'failed') return this.sendPending(item.id);
  },
  async sendPending(id) {
    if (this._closed || !this._active || !this.data.conversation || this.data.conversation.kind !== 'direct' || !this.data.conversation.canSend) return;
    const accessVersion = this._accessVersion;
    const item = this.data.pending.find(message => message.id === id);
    if (!item || this._sending && this._sending.has(id)) return;
    this._sending = this._sending || new Set();
    this._sending.add(id);
    s.safe(this, { pending: this.data.pending.map(message => message.id === id ? { ...message, state: 'sending', error: '' } : message) });
    try {
      const result = await s.api.call('sendChatMessage', { conversationId: this._conversationId, text: item.text, requestId: item.requestId });
      if (!result.message || !result.message.id) throw new Error('尚未确认发送结果，请重试');
      if (this._closed || accessVersion !== this._accessVersion) return;
      this._revision += 1;
      this._localMessages.push({ revision: this._revision, message: result.message });
      s.safe(this, { messages: social.mergeMessages(this.data.messages.concat(social.chatMessage(result.message, this._failedImages))),
        pending: this.data.pending.filter(message => message.id !== id) });
      if (this._atBottom) this.scrollBottom();
    } catch (error) {
      if (this._closed || accessVersion !== this._accessVersion) return;
      if (inaccessible(error)) {
        this.clearConversation();
        s.safe(this, { error: error.message || '这个会话暂时无法使用，请返回消息页。' });
        return;
      }
      s.safe(this, { pending: this.data.pending.map(message => message.id === id ? { ...message, state: 'failed', error: error.message || '发送未完成，请点重试' } : message) });
      if (error.code === 'VERIFICATION_REQUIRED' && this._active) s.openVerification();
    } finally { this._sending.delete(id); }
  },
  scrollBottom() {
    s.safe(this, { scrollTarget: '' });
    const apply = () => { if (this._active && this._atBottom) s.safe(this, { scrollTarget: 'chat-bottom' }); };
    if (wx.nextTick) wx.nextTick(apply); else apply();
  },
  historyScrolled() { this._atBottom = false; },
  historyBottom() { this._atBottom = true; },
  jumpBottom() { this._atBottom = true; this.scrollBottom(); },
  imageFailed(e) {
    const { id, src } = e.currentTarget.dataset;
    this._failedImages[id] = src;
    const fix = person => person.id === id && person.avatarUrl === src ? { ...person, avatarUrl: '' } : person;
    s.safe(this, { messages: this.data.messages.map(item => ({ ...item, sender: fix(item.sender) })) });
  }
});
