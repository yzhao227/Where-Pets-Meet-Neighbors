'use strict';

const DEFAULT_VERSION = '2026-09-29';
const DEFAULT_RATE_LIMITS = Object.freeze({
  createPost: { limit: 10, windowMs: 60000 }, addComment: { limit: 30, windowMs: 60000 },
  createEvent: { limit: 10, windowMs: 60000 }, updateEvent: { limit: 20, windowMs: 60000 },
  updateProfile: { limit: 30, windowMs: 60000 }, report: { limit: 10, windowMs: 60000 },
  recordPlaceVisit: { limit: 20, windowMs: 60000 }, submitPlaceCorrection: { limit: 10, windowMs: 60000 }, bookmarkPlace: { limit: 40, windowMs: 60000 },
  submitNearbySubmission: { limit: 10, windowMs: 60000 }, reviewNearbySubmission: { limit: 30, windowMs: 60000 }, unpublishNearbySubmission: { limit: 30, windowMs: 60000 },
  joinCircle: { limit: 60, windowMs: 60000 }, joinEvent: { limit: 60, windowMs: 60000 },
  followUser: { limit: 60, windowMs: 60000 }, likePost: { limit: 120, windowMs: 60000 },
  bookmarkPost: { limit: 120, windowMs: 60000 }, createUploadTicket: { limit: 20, windowMs: 60000 },
  completeUpload: { limit: 30, windowMs: 60000 }, verifyPhone: { limit: 5, windowMs: 60000 },
  sendFriendRequest: { limit: 20, windowMs: 60000 }, respondFriendRequest: { limit: 30, windowMs: 60000 },
  createGroupChat: { limit: 10, windowMs: 60000 }, openDirectChat: { limit: 60, windowMs: 60000 }, sendChatMessage: { limit: 60, windowMs: 60000 }
});

function clean(value, maximum) { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }
function normalizeRuntimeConfig(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const name = clean(source.name, 120); const contact = clean(source.contact, 200); const retention = clean(source.retention, 1500);
  const termsVersion = /^\d{4}-\d{2}-\d{2}$/.test(source.termsVersion || '') ? source.termsVersion : DEFAULT_VERSION;
  const privacyVersion = /^\d{4}-\d{2}-\d{2}$/.test(source.privacyVersion || '') ? source.privacyVersion : DEFAULT_VERSION;
  const placeholder = value => /^(待填写|你的|示例|测试运营|placeholder|todo)/i.test(value);
  const policyConfigured = name.length >= 2 && contact.length >= 3 && retention.length >= 10 &&
    ![name, contact, retention].some(placeholder) && source.policyApproved === true;
  const rateLimits = {};
  for (const [action, fallback] of Object.entries(DEFAULT_RATE_LIMITS)) {
    const configured = source.rateLimits && source.rateLimits[action];
    rateLimits[action] = configured && Number.isInteger(configured.limit) && configured.limit >= 1 && configured.limit <= 10000 &&
      Number.isInteger(configured.windowMs) && configured.windowMs >= 1000 && configured.windowMs <= 86400000 ?
      { limit: configured.limit, windowMs: configured.windowMs } : { ...fallback };
  }
  return { name, contact, retention, termsVersion, privacyVersion, policyConfigured, policyApproved: source.policyApproved === true, rateLimits,
    maintenanceEnabled: source.maintenanceEnabled === true };
}

function createRuntimeConfig(environment) {
  let operator = {};
  try { operator = JSON.parse(environment.OPERATOR_CONFIG || '{}'); } catch (_) { /* Remain a draft. */ }
  const secret = environment.MAINTENANCE_SECRET || '';
  return normalizeRuntimeConfig({ ...operator, maintenanceEnabled: Buffer.byteLength(secret, 'utf8') >= 32 && secret.trim().length > 0 });
}

function policiesFor(config) {
  const name = config.name || '运营主体待配置'; const contact = config.contact || '联系方式待配置';
  return { mode: 'cloud', isDraft: !config.policyConfigured, operator: { name, contact }, termsVersion: config.termsVersion, privacyVersion: config.privacyVersion,
    terms: [
      { title: '运营者与联系', text: `本社区由${name}运营，联系渠道：${contact}。${config.policyConfigured ? '如需协助，可通过该渠道联系运营者。' : '运营资料及正式政策尚未确认，本页为草稿，不能用于完成真实手机号注册。'}` },
      { title: '社区参与', text: '有宠有邻提供图文分享、爱宠圈子、关注收藏和免费活动报名。发布与新增互动需要完成微信手机号核验；浏览、资料编辑、举报、屏蔽及删除退出仍可使用。核验仅表示完成手机号核验，不表示法律实名审查。' },
      { title: '内容与活动', text: '请仅发布有权分享的内容，尊重他人和动物。文字、图片会接受安全检查，运营者可依据举报移除内容。活动的地点、时间和带宠要求以页面最新安排为准；取消与变更通过站内通知告知。' },
      { title: '账号和退出', text: '可以随时撤销关注、点赞、收藏和报名，或申请注销。注销会清除个人资料、本人公开内容和相关关系；组织者退出时活动保留取消记录。当前版本不提供手机号换绑和支付交易。' }
    ],
    privacy: [
      { title: '必要账号与核验信息', text: '云端从微信上下文识别账号，手机号仅由微信授权凭证在服务端获取。原始号码不写入应用数据库或应用日志；保存不可逆的带密钥摘要、脱敏号码、核验方式时间、协议及隐私版本同意记录，用于核验、重复绑定判断和账号管理。' },
      { title: '你选择公开的信息', text: '昵称、公开帖子、评论与活动参与所需记录用于社区功能。个人介绍和宠物资料默认不公开；公开主页和头像旁宠物展示使用独立开关。片区不进入公开作者主页。手机号核验信息、收藏列表和站内通知不会向其他用户公开。' },
      { title: '附近位置与参照地点', text: '仅在你主动点击定位时取得当前位置，用于本机计算到公共地点的直线距离；定位结果仅在本次运行中使用，15 分钟后失效，不写入个人资料或云端，不向其他用户公开，也不持续记录轨迹。你可以拒绝定位并手选片区，或选择一个地点作为参照；手选参照仅保存在本机，可在附近页清除。打开地图时，目的地交由微信地图处理；浏览器预览会打开腾讯地图网页。' },
      { title: '附近宠友与住宅距离', text: '邻居展示和住宅距离分享分别默认关闭，仅在你编辑资料时主动开启。邻居页展示另行选择的公开片区，不公开原生活片区。宠物资料遵循已有公开设置。住宅位置由你主动选择，先在设备上转换为约1公里网格，再保存网格，不上传原始坐标或详细住址。只有双方都开启邻居和住宅分享时，才向对方显示约1–3公里等距离分段，不显示住宅网格、坐标或导航到人。住宅参照每24小时可设置或更换一次，关闭再开不会绕过间隔；随时保存关闭可清除网格，退出邻居展示也同时关闭清除。注销清除这些设置。' },
      { title: '内容安全与运行保障', text: '文字及上传图片提交微信内容安全接口检查。服务端保存必要的举报、上传审核状态、频次计数和运维结果，防止滥用并处理失败重试。图片检查通过后才发布；图片源文件删除不能撤回其他用户已保存的副本。' },
      { title: '保存期限与删除', text: config.retention || '保存期限、备份清理和必要记录保留方式尚待运营者填写；此处为草稿。' },
      { title: '你的选择与联系', text: `可以修改资料及公开开关、退出互动关系或注销。未填写宠物不代表没有宠物。需要访问、更正、删除或反馈个人信息问题，请联系：${contact}。` }
    ] };
}

module.exports = { DEFAULT_VERSION, DEFAULT_RATE_LIMITS, normalizeRuntimeConfig, createRuntimeConfig, policiesFor };
