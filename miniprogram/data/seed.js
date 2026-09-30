const { syncCatalogue } = require('./catalogue');
const { createCircles, CIRCLE_VERSION } = require('./circles');

function newUser(id, isAdmin) {
  return {
    id: id || 'demo-self', nickname: '新来的邻居', avatar: '/assets/avatar-6.png',
    area: '', bio: '', pet: null, publicProfile: false, showPet: false,
    neighborVisible: false, neighborAreaId: '', residenceSharing: false, residenceCell: null, residenceUpdatedAt: null,
    verification: { status: 'unverified' }, isAdmin: isAdmin !== false
  };
}

function welcomeMessage(userId, createdAt) {
  return {
    id: 'demo-welcome', userId, title: '欢迎来到有宠有邻',
    text: '从一张照片、一个问题开始，记录和宠物有关的小事。养宠或暂时没养宠，都欢迎。当前为本机体验，资料与互动只保存在这台设备，暂不与其他用户同步。',
    createdAt, isRead: false, targetType: 'system', targetId: ''
  };
}

// An empty community is preferable to fabricated people, social activity or
// meetups. Only verified, attributed material may be added to the catalogue.
function createSeed(seedAt) {
  const user = newUser('demo-self', true);
  const state = {
    version: 1, seedAt, seq: 0, circleCatalogVersion: CIRCLE_VERSION,
    currentUserId: user.id, users: [user], circles: createCircles(user.id), posts: [], events: [],
    settings: { city: '', areas: [], contact: '本机体验：反馈仅保存在这台设备，暂未连接在线客服。' },
    comments: [], messages: [welcomeMessage(user.id, seedAt)],
    blocks: [], reports: [], uploads: [], likes: [], bookmarks: [], follows: []
  };
  return syncCatalogue(state, seedAt);
}

const terms = [
  { title: '1. 浏览与参与', text: '你可以先浏览公开内容。分享、回应、报名等参与操作需要完成相应核验。真实手机号核验通过微信授权与云服务完成；演示模式仅模拟流程，不采集真实手机号。微信登录标识本身不代表手机号已核验。' },
  { title: '2. 友善、真实地分享', text: '请只分享你有权使用的文字和图片，尊重他人和动物。不发布住址、他人手机号等隐私，不进行骚扰、攻击、欺骗或垃圾营销。运营方可以依据用户举报核查和处理内容。' },
  { title: '3. 活动与宠物互动', text: '参加前请查看时间、地点、人数与带宠要求。无法参加时及时取消，关注活动变更。线下活动优先使用公共场所；接触、拍摄或喂食宠物前请征得主人同意，并妥善照看同行宠物。' },
  { title: '4. 管理自己的账号', text: '你可以编辑资料、调整公开范围、删除自己的分享和回应、取消关注或收藏，以及举报和屏蔽用户。在“我”中可以清除个人资料和内容；如清理中断，可以按提示继续完成。' },
  { title: '5. 当前预览范围', text: '本机体验仅保存当前设备上的操作，不与其他用户同步，也不产生真实预约。当前版本的活动免费，未提供商品支付、商家交易或付费服务。正式开放前，运营方需明确真实主体、服务范围、联系方式及完整适用条款。' }
];
const privacy = [
  { title: '1. 处理哪些信息', text: '系统使用微信登录标识区分账号，保存你主动填写的昵称、可选片区、简介、至多一只宠物的名字和类型，以及你产生的帖子、回应、报名、关注、收藏和举报记录。未填写宠物不影响浏览，也不代表你没有宠物。' },
  { title: '2. 手机号核验', text: '真实核验时，你在微信授权界面主动操作，客户端把一次性授权凭证交给云服务，由云服务向微信校验手机号。后台只保存用于核验与防止重复绑定的号码摘要、掩码号码、核验时间和协议同意记录，不持久保存完整号码。界面显示核验状态和掩码号码，号码不会在公开社区中展示。演示核验不采集真实手机号。' },
  { title: '3. 公开范围由你选择', text: '昵称、默认头像、公开帖子和关注数量可被其他社区用户看到。简介与宠物的主页公开开关默认关闭；“在头像旁展示宠物名字和类型”是独立、默认关闭的选择。开启任一宠物公开方式，都会在对应场景展示宠物信息。生活片区始终不公开。' },
  { title: '4. 记录的用途与可见性', text: '内容与互动记录用于提供社区功能和安全治理。报名、通知、举报及核验状态按业务权限访问。运营者的宠物概况只展示汇总数量，不提供逐人私密资料导出。手机号核验结果不会在公开交流中展示，公开交流继续使用昵称。' },
  { title: '附近位置与参照地点', text: '仅在你主动点击定位时取得当前位置，用于本机计算到公共地点的直线距离；定位结果仅在本次运行中使用，15 分钟后失效，不写入个人资料或云端，不向其他用户公开，也不持续记录轨迹。你可以拒绝定位并手选片区，或选择一个地点作为参照；手选参照仅保存在本机，可在附近页清除。打开地图时，目的地交由微信地图处理；浏览器预览会打开腾讯地图网页。' },
  { title: '附近宠友与住宅距离', text: '邻居展示和住宅距离分享分别默认关闭，仅在你编辑资料时主动开启。邻居页展示另行选择的公开片区，不公开原生活片区。宠物资料遵循已有公开设置。住宅位置由你主动选择，先在设备上转换为约1公里网格，再保存网格，不上传原始坐标或详细住址。只有双方都开启邻居和住宅分享时，才向对方显示约1–3公里等距离分段，不显示住宅网格、坐标或导航到人。住宅参照每24小时可设置或更换一次，关闭再开不会绕过间隔；随时保存关闭可清除网格，退出邻居展示也同时关闭清除。注销清除这些设置。' },
  { title: '5. 保存、删除与反馈', text: '本机演示数据保存在当前设备。云端模式的数据保存在运营方配置的微信云环境。你可以通过编辑资料、删除内容和“清除我的资料和内容”入口管理数据。正式开放前，运营方需补充真实主体、存储与保留期限、必要共享对象、权利请求渠道等完整信息。' }
];

function demoPolicies(contact) {
  return { mode: 'demo', isDraft: true, operator: { name: '本机演示 · 未配置真实运营主体', contact: contact || '' }, termsVersion: '2026-09-29', privacyVersion: '2026-09-29', terms, privacy };
}

module.exports = { createSeed, newUser, demoPolicies, createCircles, welcomeMessage };
