const s = require('../_shared');
const drafts = require('../_drafts');
const nearbyLocation = require('../../services/nearby-location');
function clearLocationReference() {
  try { nearbyLocation.clearReference(); return true; }
  catch (_) { return false; }
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
function draftSummary(owner) {
  const result = drafts.read(owner);
  const draft = result.value || {};
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';
  const text = typeof draft.text === 'string' ? draft.text.trim() : '';
  const hasItems = key => Array.isArray(draft[key]) && draft[key].length > 0;
  const hasMedia = !!draft.video || ['images', 'completedUploads', 'pendingUploads', 'failedUploads'].some(hasItems);
  const hasChoices = ['selectedTopics', 'animalTypes'].some(hasItems) || !!draft.selectedEventId || ['question', 'meetup'].includes(draft.kind);
  const hasDraft = !!(title || text || hasMedia || hasChoices);
  return {
    hasDraft,
    draftPreview: (title || text || (hasMedia ? '照片或视频已留在草稿中' : hasDraft ? '已保存话题等编辑选择' : '把还没写完的日常留在这里')).replace(/\s+/g, ' ').slice(0, 60),
    draftError: result.error ? '暂时无法读取本机草稿，可进入编辑页重试' : ''
  };
}
s.register({
  data: { loading: true, error: '', errorCode: '', mode: '', statusBarHeight: 0, navigationHeight: 44, navigationInset: 96, user: null, stats: {}, circles: [], circlePreview: [], contact: '', verificationStatus: 'unverified', verificationLabel: '尚未完成手机号核验', maskedPhone: '', privacySummary: '', hasDraft: false, draftPreview: '', draftError: '', adminExpanded: false, localCleanupPending: false, busy: false },
  onLoad() { s.safe(this, navigationSize()); return this.refresh(); }, onShow() { if (this._loaded) this.refresh(); }, onPullDownRefresh() { this.refresh(); },
  onResize() { s.safe(this, navigationSize()); },
  refresh() {
    return s.load(this, async () => {
      const result = await s.api.call('bootstrap');
      const user = result.user;
      const verification = user.verification || { status: 'unverified' };
      const circles = result.circles.filter(circle => circle.isJoined);
      const privacy = [user.publicProfile === true ? '主页介绍已公开' : '主页介绍仅自己可见'];
      if (user.pet) privacy.push(user.showPet === true ? '头像旁宠物名片已开启' : '头像旁宠物名片未开启');
      return Object.assign({
        mode: result.mode, user, stats: result.stats || {}, circles, circlePreview: circles.slice(0, 3),
        petLabel: user.pet ? ({ cat: '猫', dog: '狗', rabbit: '兔子', 'small-mammal': '小型哺乳动物', bird: '鸟', fish: '鱼', reptile: '爬行动物', amphibian: '两栖动物', invertebrate: '无脊椎动物', other: '其他宠物' }[user.pet.type] || user.pet.type) : '',
        privacySummary: privacy.join(' · '),
        verificationStatus: verification.status,
        verificationLabel: { phone_verified: '手机号已核验', demo_verified: '演示模拟核验完成', unverified: '尚未完成手机号核验' }[verification.status] || '尚未完成手机号核验',
        maskedPhone: verification.maskedPhone || '', contact: result.settings.contact || ''
      }, draftSummary(result.mode + ':' + user.id));
    });
  },
  openDraft() { s.go('/pages/compose/index'); },
  exploreCircles() { s.go('/pages/circle-square/index'); },
  toggleAdmin() { if (this.data.user && this.data.user.isAdmin) s.safe(this, { adminExpanded: !this.data.adminExpanded }); },
  clearLocalDrafts() {
    return s.action(this, async () => {
      const cleared = drafts.clearAll();
      const referenceCleared = clearLocationReference();
      let photosCleared = true;
      try { if (s.api.clearLocalUploads) await s.api.clearLocalUploads(); } catch (_) { photosCleared = false; }
      try { if (typeof wx.getStorageSync === 'function') await require('../../services/pet-photos').clearLocalPetPhotos(wx); } catch (_) { photosCleared = false; }
      if (this._closed) return;
      const localCleanupPending = !cleared || !photosCleared || !referenceCleared;
      const summary = this.data.user ? draftSummary(this.data.mode + ':' + this.data.user.id) : {};
      s.safe(this, Object.assign({ localCleanupPending }, summary));
      s.toast(localCleanupPending ? '本机清理未完成，请检查存储空间' : '本机草稿、照片与参照地点已清除');
    });
  },
  registerIdentity() { s.openVerification('me'); },
  petStats() { s.go('/pages/petstats/index'); },
  myPlaces() { s.go('/pages/places/index'); },
  managePlaces() { s.go('/pages/places-manage/index'); },
  reviewSubmissions() { if (this.data.user && this.data.user.isAdmin) s.go('/social/pages/submissions-manage/index'); },
  operations() { s.go('/pages/operations/index'); },
  terms() { s.go('/pages/policy/index?type=terms'); },
  publicProfile() { s.go('/pages/author/index?userId=' + this.data.user.id); },
  editProfile() { s.go('/pages/profile/index'); },
  records(e) { s.go('/pages/records/index?type=' + e.currentTarget.dataset.type); },
  openCircle(e) { s.go('/pages/circle/index?id=' + e.currentTarget.dataset.id); },
  blocked() { s.go('/pages/blocked/index'); }, manage() { s.go('/pages/manage/index'); }, moderation() { s.go('/pages/moderation/index'); },
  help() { wx.showModal({ title: '有问题，和我们说说', content: this.data.contact ? '运营联系方式：' + this.data.contact + '\n你也可以通过帖子、评论和活动上的举报入口提交问题。' : '你可以通过帖子、评论和活动上的举报入口提交问题。运营联系方式暂未配置。', confirmText: this.data.contact ? '复制联系信息' : '知道了', showCancel: !!this.data.contact, success: result => { if (result.confirm && this.data.contact) wx.setClipboardData({ data: this.data.contact }); } }); },
  privacy() { s.go('/pages/policy/index?type=privacy'); },
  deleteAccount() {
    return s.action(this, async () => {
      if (!await s.confirm('清除我的资料和内容？', '将删除你的公开内容与个人资料，解除圈子和活动报名关系，并清除本机草稿和参照地点。此操作不能撤销。', '确认清除')) return;
      const result = await s.api.call('deleteAccount');
      if (!result || result.deleted !== true) throw new Error('尚未确认资料清除完成，请稍后重试');
      const cleared = drafts.clearAll();
      const referenceCleared = clearLocationReference();
      const localCleanupPending = !cleared || !referenceCleared || !!(result.localCleanup && result.localCleanup.status === 'failed');
      if (this._closed) return;
      s.safe(this, { localCleanupPending });
      s.toast(localCleanupPending ? '资料已清除，本机记录还需清理' : '已清除个人资料和内容');
      await this.refresh();
    });
  }
});
