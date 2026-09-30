// 公共配置。获得自己的 AppID 和云开发环境后，按启动指南切换。
// 这里不保存管理员身份、密钥或其他秘密。
module.exports = {
  appName: '有宠有邻',
  mode: 'demo',
  cloudEnv: '',
  // 仅在主体支持 web-view 且域名已在微信后台验证后启用。不可填未验证的第三方域名。
  publicWeb: { enabled: false, businessDomains: [] }
};
