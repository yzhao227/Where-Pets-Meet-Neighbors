const s = require('../_shared');
s.register({
  data: { loading: true, error: '', type: 'terms', mode: '', isDraft: true, version: '', operatorName: '', contact: '', sections: [], contentMissing: true },
  onLoad(options) { s.safe(this, { type: options.type === 'privacy' ? 'privacy' : 'terms' }); this.refresh(); },
  refresh() {
    const type = this.data.type;
    return s.load(this, async () => {
      const result = await s.api.call('getPolicies');
      const operator = result.operator || {};
      const sections = (Array.isArray(result[type]) ? result[type] : []).filter(section => section && typeof section.title === 'string' && typeof section.text === 'string');
      const version = type === 'privacy' ? result.privacyVersion : result.termsVersion;
      return { mode: result.mode, isDraft: result.mode === 'demo' || result.isDraft !== false, operatorName: operator.name || '', contact: operator.contact || '', version: version || '待配置', sections, contentMissing: !sections.length };
    });
  },
  selectType(e) { s.safe(this, { type: e.currentTarget.dataset.type === 'privacy' ? 'privacy' : 'terms' }); this.refresh(); },
  copyContact() { if (this.data.contact) wx.setClipboardData({ data: this.data.contact }); }
});
