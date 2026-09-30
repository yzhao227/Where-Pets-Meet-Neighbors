// Test-only fictional people, posts, and events. Never import from production code.
const { CATALOG_VERSION } = require('../../miniprogram/data/curated');

const DAY = 24 * 60 * 60 * 1000;

const EXAMPLE_POST_DETAILS = {
  'demo-post-1': { title: '示例｜看着它晒太阳，我也慢了下来', kind: 'daily', topics: ['宠物治愈时刻'], eventId: '' },
  'demo-post-2': { title: '示例｜没养宠，也想认识爱宠的邻居', kind: 'daily', topics: ['没养宠也能来'], eventId: '' },
  'demo-post-3': { title: '示例｜和狗狗一起，把路走慢一点', kind: 'meetup', topics: ['一起散步', '宠物友好去处'], eventId: 'demo-event-walk' },
  'demo-post-4': { title: '示例｜你家小动物最喜欢哪个角落？', kind: 'question', topics: ['养宠经验', '宠物治愈时刻'], eventId: '' },
  'demo-post-5': { title: '示例｜不用带宠的周末咖啡小聚', kind: 'meetup', topics: ['没养宠也能来', '宠物友好去处'], eventId: 'demo-event-coffee' },
  'demo-post-6': { title: '示例｜狗狗第一次见面，我们这样做', kind: 'daily', topics: ['一起散步', '养宠经验'], eventId: '' },
  'demo-post-7': { title: '示例｜一句话，认识一个新邻居', kind: 'daily', topics: ['宠物治愈时刻', '没养宠也能来'], eventId: '' },
  'demo-post-8': { title: '示例｜第一次领养前，需要准备什么？', kind: 'question', topics: ['新手养宠', '没养宠也能来'], eventId: '' }
};

function newUser(id, isAdmin) {
  return {
    id: id || 'demo-self',
    nickname: '新来的邻居',
    avatar: '/assets/avatar-6.png',
    area: '',
    bio: '',
    pet: null,
    publicProfile: false,
    showPet: false,
    verification: { status: 'unverified' },
    isAdmin: isAdmin !== false
  };
}

// All people, places, posts and activities in this seed are fictional.
// Dates are calculated once and persisted, so restarting never moves an event.
function createSeed(seedAt) {
  const users = [
    { id: 'demo-lin', nickname: '示例·小林', avatar: '/assets/avatar-1.png', area: '示例·梧桐里', bio: '虚构的猫咪主人', pet: { name: '布丁', type: 'cat' }, isAdmin: false },
    { id: 'demo-yue', nickname: '示例·阿月', avatar: '/assets/avatar-2.png', area: '示例·河畔街', bio: '虚构的狗狗主人', pet: { name: '豆豆', type: 'dog' }, isAdmin: false },
    { id: 'demo-qiao', nickname: '示例·小乔', avatar: '/assets/avatar-3.png', area: '示例·梧桐里', bio: '暂时没养宠物，也喜欢小动物。虚构人物。', pet: null, isAdmin: false },
    { id: 'demo-an', nickname: '示例·阿安', avatar: '/assets/avatar-4.png', area: '示例·花园路', bio: '虚构的爱宠邻居', pet: { name: '小米', type: 'cat' }, isAdmin: false },
    { id: 'demo-chen', nickname: '示例·小陈', avatar: '/assets/avatar-5.png', area: '示例·河畔街', bio: '虚构的爱宠邻居', pet: { name: '芝麻', type: 'dog' }, isAdmin: false },
    { id: 'demo-he', nickname: '示例·阿禾', avatar: '/assets/avatar-6.png', area: '示例·花园路', bio: '虚构活动组织者，无宠也可以来。', pet: null, isAdmin: true },
    newUser('demo-self', true)
  ];
  users.forEach(user => {
    if (user.id !== 'demo-self') user.publicProfile = true;
    user.showPet = false;
    user.verification = { status: 'unverified' };
  });
  const circles = [
    { id: 'circle-neighbors', name: '爱宠邻里', description: '养宠或暂时没养宠，都可以聊聊日常。这里的街区和成员为演示虚构。', accent: '#e5b85c', icon: '☀', memberIds: users.map(user => user.id) },
    { id: 'circle-cats', name: '猫咪慢生活', description: '分享猫咪的日常和照顾心得，欢迎云养猫。示例圈子。', accent: '#ab9ec7', icon: '猫', memberIds: ['demo-lin', 'demo-qiao', 'demo-an'] },
    { id: 'circle-walks', name: '一起散散步', description: '认识爱散步的邻居，尊重每只宠物的节奏。示例圈子。', accent: '#94b796', icon: '步', memberIds: ['demo-yue', 'demo-chen', 'demo-he'] }
  ];
  const postData = [
    ['demo-post-1', 'demo-lin', 'circle-cats', '示例日常：今天的布丁又在窗边睡着了。阳光刚刚好，看着它，自己也慢慢放松下来。', ['/assets/story-cat.png']],
    ['demo-post-2', 'demo-qiao', 'circle-neighbors', '示例分享：暂时没养宠物，但很喜欢听大家的小故事。想认识几个可以周末一起坐坐的爱宠邻居。', []],
    ['demo-post-3', 'demo-yue', 'circle-walks', '示例散步：豆豆喜欢慢慢闻路边的草。一起出门时，先问过主人再靠近狗狗，大家都会更自在。', ['/assets/story-dog.png']],
    ['demo-post-4', 'demo-an', 'circle-cats', '示例话题：猫咪躲在纸箱里不出来的时候，我会给它留一点自己的空间。你家小动物最喜欢哪个角落？', []],
    ['demo-post-5', 'demo-he', 'circle-neighbors', '示例邀请：准备了一场不用带宠物的咖啡小聚。可以聊照片、养宠经历，也可以安静听一会儿。活动和地点均为虚构，请勿实际前往。', ['/assets/event-coffee.png']],
    ['demo-post-6', 'demo-chen', 'circle-walks', '示例经验：第一次和新伙伴散步，我们选择了人少的时段，保持距离慢慢熟悉，没有急着让狗狗玩在一起。', []],
    ['demo-post-7', 'demo-lin', 'circle-neighbors', '示例讨论：刚搬来一个地方的时候，一句“你家小猫叫什么”就能开启一段聊天。分享宠物的小事，也是在分享我们的生活。', []],
    ['demo-post-8', 'demo-qiao', 'circle-cats', '示例提问：如果以后条件合适，我想认真准备领养。在那之前，先学习照顾动物，也认识一些有经验的朋友。', []]
  ];
  const posts = postData.map((entry, index) => Object.assign({
    id: entry[0], authorId: entry[1], circleId: entry[2], text: entry[3], images: entry[4],
    createdAt: seedAt - (index + 1) * 75 * 60 * 1000, coverIndex: 0
  }, EXAMPLE_POST_DETAILS[entry[0]], { topics: EXAMPLE_POST_DETAILS[entry[0]].topics.slice() }));
  const events = [
    { id: 'demo-event-coffee', title: '示例｜不用带宠的咖啡小聚', description: '这是一场虚构演示活动，地点不可用于实际赴约。带一张喜欢的小动物照片，认识几位爱宠邻居；没有养宠物也欢迎参加。', location: '示例·梧桐里咖啡馆（虚构）', startAt: seedAt + 2 * DAY, endAt: seedAt + 2 * DAY + 90 * 60 * 1000, capacity: 6, petPolicy: 'none', circleId: 'circle-neighbors', hostId: 'demo-he', cover: '/assets/event-coffee.png', status: 'active', attendeeIds: ['demo-qiao', 'demo-lin'] },
    { id: 'demo-event-walk', title: '示例｜和狗狗慢慢散步', description: '这是一场虚构演示活动，请勿实际前往。带好牵引绳，先保持距离认识彼此；只适合可以与其他犬只保持平静的狗狗。', location: '示例·河畔公园南门（虚构）', startAt: seedAt + 3 * DAY, endAt: seedAt + 3 * DAY + 60 * 60 * 1000, capacity: 5, petPolicy: 'dog', circleId: 'circle-walks', hostId: 'demo-yue', cover: '/assets/event-walk.png', status: 'active', attendeeIds: ['demo-yue', 'demo-chen'] },
    { id: 'demo-event-chat', title: '示例｜聊聊和小动物的生活', description: '这是一场虚构演示活动。可以带宠物，也可以独自来；主人照看自己的宠物，互动前先征得同意。示例地点不可用于实际赴约。', location: '示例·花园路邻里空间（虚构）', startAt: seedAt + 5 * DAY, endAt: seedAt + 5 * DAY + 2 * 60 * 60 * 1000, capacity: 8, petPolicy: 'optional', circleId: 'circle-neighbors', hostId: 'demo-he', cover: '/assets/event-coffee.png', status: 'active', attendeeIds: ['demo-an'] },
    { id: 'demo-event-cats', title: '示例｜云养猫照片分享会', description: '这是一场虚构演示活动，不用带猫咪。用照片讲讲喜欢的小动物，暂时没养宠的朋友也可以来。请勿前往示例地点。', location: '示例·梧桐里阅读角（虚构）', startAt: seedAt + 7 * DAY, endAt: seedAt + 7 * DAY + 60 * 60 * 1000, capacity: 6, petPolicy: 'none', circleId: 'circle-cats', hostId: 'demo-he', cover: '/assets/story-cat.png', status: 'active', attendeeIds: ['demo-lin', 'demo-qiao'] }
  ];
  return {
    version: 1, contentCatalogVersion: CATALOG_VERSION, seedAt, seq: 0, currentUserId: 'demo-self', users, circles, posts, events,
    settings: { city: '示例城市', areas: ['示例·梧桐里', '示例·河畔街', '示例·花园路'], contact: '本机演示：反馈仅保存在这台设备，未连接真实客服。' },
    comments: [
      { id: 'demo-comment-1', targetType: 'post', targetId: 'demo-post-1', authorId: 'demo-an', text: '示例评论：窗边也是小米最喜欢的地方。', createdAt: seedAt - 40 * 60 * 1000 },
      { id: 'demo-comment-2', targetType: 'post', targetId: 'demo-post-2', authorId: 'demo-he', text: '示例评论：没有养宠物也很欢迎，一起聊聊喜欢的小动物。', createdAt: seedAt - 35 * 60 * 1000 },
      { id: 'demo-comment-3', targetType: 'event', targetId: 'demo-event-coffee', authorId: 'demo-qiao', text: '示例评论：很喜欢这种不用带宠也能参与的活动。', createdAt: seedAt - 20 * 60 * 1000 }
    ],
    messages: [{ id: 'demo-welcome', userId: 'demo-self', title: '欢迎来到有宠有邻 · 本机演示', text: '这里的人物、街区、帖子和活动均为虚构。发布、报名、关注和收藏会保存在当前设备；没有真实用户、在线服务或实际活动预约。演示账号拥有管理权限。', createdAt: seedAt, isRead: false, targetType: 'system', targetId: '' }],
    blocks: [], reports: [], uploads: [], likes: [], bookmarks: [], follows: []
  };
}

module.exports = { createSeed, newUser, EXAMPLE_POST_DETAILS };
