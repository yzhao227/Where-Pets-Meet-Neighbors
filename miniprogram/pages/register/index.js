const s = require('../_shared');
s.register({
  data: { loading: true, error: '', mode: '', busy: false, consentAccepted: false, termsVersion: '', privacyVersion: '', versionsReady: false, policyConfigured: false, phoneEnabled: false, verificationStatus: 'unverified', maskedPhone: '', isVerified: false, verificationError: '', fromAction: false },
  onLoad(options) { s.verificationArrived(); s.safe(this, { fromAction: options.from === 'action' }); this.refresh(); },
  onShow() { if (this._loaded) this.refresh(); },
  onUnload() { s.verificationLeft(); },
  refresh() { return s.load(this, async () => {
    const boot = await s.api.call('bootstrap');
    const registration = boot.registration || {};
    const verification = boot.user.verification || { status: 'unverified' };
    const termsVersion = registration.termsVersion || '';
    const privacyVersion = registration.privacyVersion || '';
    const versionsChanged = termsVersion !== this.data.termsVersion || privacyVersion !== this.data.privacyVersion || (boot.mode === 'cloud' && (registration.policyConfigured === true) !== this.data.policyConfigured);
    return { mode: boot.mode, termsVersion, privacyVersion, versionsReady: !!termsVersion && !!privacyVersion,
      consentAccepted: versionsChanged ? false : this.data.consentAccepted, policyConfigured: registration.policyConfigured === true, phoneEnabled: registration.phoneEnabled === true,
      verificationStatus: verification.status, maskedPhone: verification.maskedPhone || '',
      isVerified: boot.mode === 'demo' ? verification.status === 'demo_verified' : verification.status === 'phone_verified' };
  }); },
  toggleConsent() { if (!this.data.busy) s.safe(this, { consentAccepted: !this.data.consentAccepted, verificationError: '' }); },
  policy(e) { const type = e.currentTarget.dataset.type === 'privacy' ? 'privacy' : 'terms'; s.go('/pages/policy/index?type=' + type); },
  consent() { return { accepted: true, termsVersion: this.data.termsVersion, privacyVersion: this.data.privacyVersion }; },
  canVerify(mode) {
    if (this.data.mode !== mode || this.data.isVerified || this.data.busy) return false;
    if (mode === 'cloud' && !this.data.policyConfigured) { s.safe(this, { verificationError: '运营方尚未完成正式政策配置，暂时不能授权核验。你可以继续浏览。' }); return false; }
    if (!this.data.versionsReady) { s.safe(this, { verificationError: '协议版本尚未配置，请稍后再试。' }); return false; }
    if (!this.data.consentAccepted) { s.safe(this, { verificationError: '请先阅读并主动勾选同意协议与隐私说明。' }); return false; }
    return true;
  },
  demoVerify() {
    if (!this.canVerify('demo')) return;
    return s.action(this, async () => {
      try { await s.api.call('demoVerifyIdentity', { consent: this.consent() }); } catch (error) { s.safe(this, { verificationError: error.message || '核验未完成，请检查网络后重试。' }); throw error; }
      if (this._closed) return;
      s.verificationLeft(); s.toast('模拟核验已保存，请继续刚才的操作'); s.back();
    });
  },
  phoneNumber(e) {
    if (!this.canVerify('cloud')) return;
    if (!this.data.phoneEnabled) { s.safe(this, { verificationError: '真实手机号核验尚未开放，请等待运营方完成配置。' }); return; }
    const detail = e.detail || {};
    if (!detail.code || (detail.errMsg && detail.errMsg !== 'getPhoneNumber:ok')) {
      s.safe(this, { verificationError: '没有取得手机号授权。你可以继续浏览，准备好后再核验。' }); return;
    }
    return s.action(this, async () => {
      try { await s.api.call('verifyPhone', { code: detail.code, consent: this.consent() }); } catch (error) { s.safe(this, { verificationError: error.message || '核验未完成，请检查网络后重试。' }); throw error; }
      if (this._closed) return;
      s.verificationLeft(); s.toast('手机号已核验，请继续刚才的操作'); s.back();
    });
  },
  continueBrowsing() { s.verificationLeft(); s.back(); }
});
