const config = require('./config');

App({
  globalData: { mode: config.mode, isDemo: config.mode === 'demo', user: null, settings: null },
  onLaunch() {
    const demo = config.mode !== 'cloud' || wx.__preview === true;
    this.globalData.mode = demo ? 'demo' : 'cloud';
    this.globalData.isDemo = demo;
    if (!demo && wx.cloud && config.cloudEnv) {
      wx.cloud.init({ env: config.cloudEnv, traceUser: false });
    }
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
