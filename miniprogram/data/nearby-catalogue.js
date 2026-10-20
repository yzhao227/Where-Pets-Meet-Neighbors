// Public place facts and external notices. These records never create users,
// RSVP capacity, platform events, user locations, or fabricated venue photos.
// checkedAt is a desk-research date, not an on-site inspection.
const checkedAt = '2026-09-29';
const region = '上海 · 从莘庄出发';
const source = (publisher, title, url, publishedAt) => ({ publisher, title, url, publishedAt: publishedAt || '', checkedAt });
const parks2026 = source('上观新闻（新浪转载）', '可以带“毛孩子”去哪里撒欢？', 'https://finance.sina.com.cn/jjxw/2026-06-07/doc-iniapryw9995725.shtml', '2026-06-07');
const parks2024 = source('今日闵行 · 官方澎湃号', '闵行有哪些公园宠物友好？哪些未对宠物开放？', 'https://www.thepaper.cn/newsDetail_forward_27352160', '2024-05-12');
const weijingEvent = source('今日闵行 · 官方澎湃号', '骑行赏花、萌宠竞技，周末来这里点燃春日活力', 'https://m.thepaper.cn/newsDetail_forward_32958308', '2026-04-13');
const petfair = { ...source('亚洲宠物展主办方', '第28届亚洲宠物展圆满收官及2027特展预告', 'https://www.petfairasia.com/news/441.html', '2026-08-26'), checkedAt: '2026-09-30' };

const records = [
  {
    id: 'place-xinzhuang-weijing', type: 'place', title: '莘庄维璟印象城', categoryLabel: '商场闲逛', city: '上海', area: '莘庄',
    address: '上海市闵行区七莘路1507号 · 莘庄维璟印象城',
    summary: '逛商场、找个地方歇脚，也可以关注这里的萌宠主题活动。',
    petPolicy: { status: 'unknown', text: '曾举办狗狗赛事；日常室内携宠条件需向商场确认。' }, noPetRequired: true,
    highlights: ['印力官网确认项目已开业。2026年4月的官方活动公告记录了1号门广场的犬类挑战赛。', '活动场地允许参赛犬进入，不等于全部商铺均可带宠；推车、落地和体型要求需要单独确认。', '商场入口以七莘路侧公共地址为线索；集团官网所列顾戴路办公地址不作为导航入口。'],
    sources: [source('印力集团', '莘庄维璟印象城项目介绍', 'https://www.scpgroup.com/business/data?cname=project&id=62'), weijingEvent,
      source('Bing 地图公开地点卡', '莘庄维璟印象城公共地址', 'https://cn.bing.com/search?q=%E8%8E%98%E5%BA%84%E7%BB%B4%E7%92%9F%E5%8D%B0%E8%B1%A1%E5%9F%8E+%E5%AE%A0%E7%89%A9%E5%8F%8B%E5%A5%BD+%E5%9C%B0%E5%9D%80')]
  },
  {
    id: 'place-zhongsheng', type: 'place', title: '仲盛世界商城', categoryLabel: '商场与街区', city: '上海', area: '莘庄',
    address: '上海市闵行区都市路5001号 · 仲盛世界商城',
    summary: '从南下沉广场逛起，看看新开的店，再找个座位聊聊养宠日常。',
    petPolicy: { status: 'unknown', text: '曾推出宠物主题月；室内外及各商户的携宠规则待确认。' }, noPetRequired: true,
    highlights: ['今日闵行2026年5月报道确认南下沉广场开街，并介绍了宠物主题月。', '过去的主题月不代表当前仍有活动；本页收录常设场所，最新安排需查看商场公告。', '进入餐厅前单独询问店员是否可携宠，以及是否仅限外摆区域。'],
    sources: [source('今日闵行（上观号）', '仲盛世界商城南下沉广场正式开街', 'https://www.shobserver.com/sgh/detail?id=1744115', '2026-05-02'),
      source('Bing 地图公开地点卡', '仲盛世界商城公共地址', 'https://cn.bing.com/search?q=%E4%BB%B2%E7%9B%9B%E4%B8%96%E7%95%8C%E5%95%86%E5%9F%8E+%E5%AE%A0%E7%89%A9+2026')]
  },
  {
    id: 'place-libopark', type: 'place', title: '力波公园', categoryLabel: '公园散步', city: '上海', area: '梅陇',
    address: '上海市闵行区虹梅南路、益梅路转角 · 力波公园',
    summary: '给毛孩子安排一段户外散步，自己也从忙碌里缓一口气。',
    petPolicy: { status: 'conditional', text: '公开指引为宠物友好公园；牵好绳、及时清理，服从现场管理。' }, noPetRequired: true,
    highlights: ['2026年6月公开指引介绍了公园的宠物乐园。', '周边为上海·力波及力波1987创意产业园；店铺准入需另行询问。', '开放时间、设施维护和现场活动以公园当日公告为准。'],
    sources: [parks2026]
  },
  {
    id: 'place-xincheng-central', type: 'place', title: '莘城中央公园', categoryLabel: '不带宠散步', city: '上海', area: '莘庄',
    address: '上海市闵行区闵城路180号 · 莘城中央公园',
    summary: '莘庄南广场附近的一片绿意，适合不带宠时散步、看树和休息。',
    petPolicy: { status: 'unknown', text: '2024年官方名单标注暂未对宠物开放；现行规定待复核，先按不带宠安排。' }, noPetRequired: true,
    highlights: ['市绿化市容局公园目录确认地址为闵城路180号，位于莘庄地铁南广场附近。', '市文旅局介绍过这里的深秋银杏景观；实际叶色随天气变化。', '携宠资料较旧，本页不将其放入“带宠出门”筛选。开放时段请以园门公告为准。'],
    sources: [source('上海市绿化和市容管理局', '莘城中央公园目录', 'https://lhsr.sh.gov.cn/gyldml_con/?InfoId=db4e3a19-8827-47bb-9322-3daf794b4279'), parks2024,
      source('上海市文化和旅游局', '闵行赏花赏叶地介绍', 'https://whlyj.sh.gov.cn/gqfc/20240221/7ffebbbb812e4dcbb7eaa82feb796066.html', '2024-02-21')]
  },
  {
    id: 'place-yuanjiang-tod', type: 'place', title: '元江路 TOD 公园', categoryLabel: '开放绿地', city: '上海', area: '颛桥周边',
    address: '上海市闵行区 · 地铁15号线元江路站2号或3号口附近',
    summary: '顺着轨交站旁的绿地走一走，给日常遛宠换一个去处。',
    petPolicy: { status: 'conditional', text: '公开指引列为宠物友好；牵引通行，留意入口和现场管理要求。' }, noPetRequired: true,
    highlights: ['2026年6月携宠指引列出了这一地点和地铁出入口。', '本页不提供携宠乘坐轨道交通建议；携宠出行需自行安排符合运输规定的方式。', '进入前查看现场公告，避开养护或封闭区域。'],
    sources: [parks2026]
  },
  {
    id: 'place-pujiang-pet-zones', type: 'place', title: '浦江郊野公园 · 携宠开放区', categoryLabel: '周末户外', city: '上海', area: '浦江拓展',
    address: '上海市闵行区浦江郊野公园 · 森林游憩区 / 滨江漫步区（行前确认对应入口）',
    summary: '周末想走远一点，可以了解森林游憩区和滨江漫步区的携宠安排。',
    petPolicy: { status: 'conditional', text: '仅森林游憩区、滨江漫步区可携宠；其他区域不可据此通行。' }, noPetRequired: true,
    highlights: ['2026年6月指引明确区分携宠开放区与其他片区。', '该指引说明奇迹花园区、柳露田园区、活力森林区未对宠物开放。', '公园较大，应先确认目标片区入口和当天开放情况；不要把景区主入口当作所有携宠区入口。'],
    sources: [parks2026]
  },
  {
    id: 'notice-pfa-boutique-2027', type: 'exhibition', title: '亚宠甄选特展暨首届宠物主理人大会', categoryLabel: '展览预告', city: '上海', area: '徐汇西岸',
    address: '上海 · 西岸穹顶（具体入口待主办方公布）', venue: '西岸穹顶', hostName: '亚洲宠物展主办方',
    announcementMonth: '2027-04', dateLabel: '2027年4月 · 具体日期待公布', ticketText: '票价与参与方式待公布',
    summary: '主办方已预告在上海推出精品特展，关注优质宠物品牌与城市养宠生活。',
    petPolicy: { status: 'unknown', text: '观众携宠规则尚未公布。' }, noPetRequired: true,
    highlights: ['主办方2026年8月26日公告明确提及2027年4月、上海西岸穹顶和该特展名称。', '目前核实到月份，尚未取得具体日期、公众开放时段和票务安排；此条为预告。'],
    sources: [petfair]
  },
  {
    id: 'event-petfair-asia-2026', type: 'exhibition', title: '第28届亚洲宠物展', categoryLabel: '展览回顾', city: '上海', area: '浦东',
    address: '上海 · 上海新国际博览中心', venue: '上海新国际博览中心', hostName: '上海万耀亚宠展览有限公司',
    startsAt: '2026-08-19T00:00:00+08:00', endsAt: '2026-08-24T00:00:00+08:00', dateLabel: '2026年8月19日—23日', datePrecision: 'day',
    ticketText: '本届已结束', summary: '涵盖宠物品牌、养猫专区及人宠生活主题的年度展会；本条保留作往期回顾。',
    petPolicy: { status: 'unknown', text: '本届已结束；后续届次的携宠与观众入场规则需重新确认。' }, noPetRequired: true,
    highlights: ['官网显示本届展期为2026年8月19日至23日，并于8月26日发布收官公告。', '首日为邀请制VIP专业日，并非所有展期都对普通消费者开放。', '本条不提供报名、库存或名额；了解下一届请关注主办方新公告。'],
    sources: [petfair, source('亚洲宠物展主办方', '亚洲宠物展官网', 'https://www.petfairasia.com/')]
  },
  {
    id: 'event-weijing-spartan-2026', type: 'event', title: '莘庄维璟 · 狗狗斯巴达勇士赛', categoryLabel: '本地活动回顾', city: '上海', area: '莘庄',
    address: '上海市闵行区莘庄维璟印象城1号门广场', venue: '莘庄维璟印象城1号门广场', hostName: '莘庄维璟印象城',
    startsAt: '2026-04-19T00:00:00+08:00', endsAt: '2026-04-20T00:00:00+08:00', dateLabel: '2026年4月19日 · 15:00开赛', datePrecision: 'day',
    ticketText: '本场已结束 · 当时需300积分预约', summary: '狗狗与主人一起跨越障碍、默契闯关。这场家门口的萌宠赛事已结束。',
    petPolicy: { status: 'conditional', text: '当时面向健康犬只参赛；不代表商场日常携宠规则。' }, noPetRequired: false,
    highlights: ['今日闵行4月13日公告记录了4月19日的赛事，14:30签到，15:00开赛。', '当时通过“印享星”小程序使用300积分预约，不能标记为无条件免费活动。', '这是一条历史活动记录，新场次需另行确认。'],
    sources: [weijingEvent]
  }
];

// Keep sourced additions separate from the editorial base; all are real local
// guide records, never generated community posts or registrations.
const placeExtras = require('./nearby-places-expanded');
const newPlaces = require('./nearby-places-20260930');
const eventExtras = require('./nearby-events-expanded');
const newEvents = require('./nearby-events-20260930');
const octoberEvents = require('./nearby-events-20261001');
const turtleExpo = require('./nearby-events-20261007');
const acePetZone = require('./nearby-events-20261008');
const miaoshengMuseum = require('./nearby-events-20261009');
const britishLibraryCats = require('./nearby-events-20261010');
const petFashionWeek = require('./nearby-events-20261012');
const adoptionSpace = require('./nearby-places-20261013');
const petfair2027 = require('./nearby-events-20261014');
const maoqiuPark = require('./nearby-places-20261015');
const kunxiuCarnival = require('./nearby-events-20261018');
const october19Events = require('./nearby-events-20261019');
const guides = require('./nearby-guides');
const enrichment = require('./nearby-enrichment');
const newEnrichment = require('./nearby-enrichment-20260930');
const withSourcePhoto = require('./nearby-source-photos');
// Pet activities are separate from the older visitor-oriented playTags. Unknown
// pet admission never supplies a pet activity; unknown fees do not mean free.
const baseAreas = {
  'place-xinzhuang-weijing': { district: '闵行区', playTags: ['hangout'], petPlayTags: [], placeKind: 'commercial', feeType: 'unknown' },
  'place-zhongsheng': { district: '闵行区', playTags: ['hangout'], petPlayTags: [], placeKind: 'commercial', feeType: 'unknown' },
  'place-libopark': { district: '闵行区', playTags: ['walk', 'social'], petPlayTags: ['walk'], placeKind: 'park', feeType: 'unknown' },
  'place-xincheng-central': { district: '闵行区', playTags: ['walk'], petPlayTags: [], placeKind: 'park', feeType: 'unknown' },
  'place-yuanjiang-tod': { district: '闵行区', playTags: ['walk'], petPlayTags: ['walk'], placeKind: 'park', feeType: 'unknown' },
  'place-pujiang-pet-zones': { district: '闵行区', playTags: ['walk'], petPlayTags: ['walk'], placeKind: 'park', feeType: 'unknown' },
  'notice-pfa-boutique-2027': { district: '徐汇区', playTags: ['exhibition'], petPlayTags: [], feeType: 'unknown' },
  'event-petfair-asia-2026': { district: '浦东新区', playTags: ['exhibition'], petPlayTags: [], feeType: 'unknown' },
  // The historical race required points, not a verified cash ticket price.
  'event-weijing-spartan-2026': { district: '闵行区', playTags: ['social'], petPlayTags: ['agility'], feeType: 'unknown' }
};
const allRecords = records.concat(placeExtras, newPlaces, eventExtras, newEvents, octoberEvents, turtleExpo, acePetZone, miaoshengMuseum, britishLibraryCats, petFashionWeek, adoptionSpace, petfair2027, maoqiuPark, kunxiuCarnival, october19Events).map(record => ({
  ...record, ...(baseAreas[record.id] || {}), ...(enrichment[record.id] || {}), ...(newEnrichment[record.id] || {})
})).map(withSourcePhoto);

module.exports = { records: allRecords, guides, region, checkedAt: '2026-10-19' };
