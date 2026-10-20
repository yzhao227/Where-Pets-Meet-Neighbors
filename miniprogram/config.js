// 公共配置。获得自己的 AppID 和云开发环境后，按启动指南切换。
// 这里不保存管理员身份、密钥或其他秘密。
module.exports = {
  appName: '有宠有邻',
  // 当前交付为个人工具版，持续禁用用户间发布、分享及交流。
  // 与运行环境和审核状态无关；社区源码保留供未来具备资质的独立版本使用。
  productMode: 'personal',
  mode: 'demo',
  cloudEnv: '',
  // 仅在主体支持 web-view 且域名已在微信后台验证后启用。不可填未验证的第三方域名。
  publicWeb: { enabled: false, businessDomains: [] }
};
