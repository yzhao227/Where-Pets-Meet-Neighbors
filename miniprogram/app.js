const config = require('./config');
const { personalMode } = require('./product');

App({
  globalData: { productMode: config.productMode, personalMode, mode: config.mode, isDemo: personalMode || config.mode === 'demo', user: null, settings: null },
  onLaunch() {
    const demo = personalMode || config.mode !== 'cloud' || wx.__preview === true;
    this.globalData.mode = demo ? 'demo' : 'cloud';
    this.globalData.isDemo = demo;
    if (!demo && wx.cloud && config.cloudEnv) {
      wx.cloud.init({ env: config.cloudEnv, traceUser: false });
    }
  },
  onShow() {
    require('./services/devtools-tabbar').refresh(wx);
  },
  onPageNotFound() {
    // Legacy social shares cannot reopen retired pages in the personal build.
    wx.switchTab({ url: '/pages/community/index' });
  },
  async bootstrap() {
    const data = await require('./services/api').call('bootstrap');
    this.globalData.user = data.user;
    this.globalData.settings = data.settings;
    this.globalData.mode = data.mode;
    this.globalData.isDemo = data.mode === 'demo';
    return data;
  }
});
