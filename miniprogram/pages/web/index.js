const s = require('../_shared');
const config = require('../../config');
const { canUseWebView } = require('../../services/public-links');

s.register({
  data: { url: '', error: '' },
  onLoad(options) {
    // Recheck incoming routes as well as the initiating button. Never make this
    // page an arbitrary URL opener through a shared or hand-edited page path.
    const url = typeof options.url === 'string' ? options.url : '';
    if (wx.hideShareMenu) wx.hideShareMenu();
    if (!canUseWebView(url, config)) return s.safe(this, { error: '该原文暂不支持在小程序内打开，可返回查看已整理的详情。' });
    s.safe(this, { url });
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: typeof options.title === 'string' ? options.title.slice(0, 30) : '原文' });
  },
  loadFailed() { s.safe(this, { url: '', error: '暂时未能打开原文，请稍后再试。' }); },
  back() { s.back(); }
});
