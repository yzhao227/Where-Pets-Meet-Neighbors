'use strict';

// Adoption announcements confirm programme times and venues, not public
// admission. The TOPS footer confirms a future Shanghai exhibition interval only.
const source = {
  publisher: '上海领养日shanghai · 官方平台',
  title: '26年10月线下公益活动体验义工招募',
  url: 'https://www.163.com/dy/article/L9NH60250525FDCD.html',
  publishedAt: '2026-10-20', checkedAt: '2026-10-21'
};
const volunteerNote = '体验义工需喜欢且不怕猫狗，接受岗位安排，不迟到早退，并提前阅读线上岗位培训说明；报名入口、资格确认和剩余名额待核实，不表示到场即可上岗。';

module.exports = [{
  id: 'event-financial-street-shih-tzu-adoption-2026', type: 'event', title: '上海领养日 · 金融街西施繁殖犬专场领养',
  city: '上海', district: '静安区', area: '金融街购物中心', categoryLabel: '公益领养 · 义工招募',
  venue: '上海金融街购物中心1F中庭', address: '上海市静安区中兴路1683号 · 上海金融街购物中心1F中庭',
  hostName: '上海领养日 × 上海金融街购物中心',
  startsAt: '2026-10-24T13:00:00+08:00', endsAt: '2026-10-24T17:00:00+08:00',
  dateLabel: '10月24日13:00—17:00 · 聚会与DIY 14:00—16:00',
  ticketText: '公众入场、领养及DIY费用与参与方式待确认', feeType: 'unknown',
  summary: '了解西施繁殖犬的领养安排，同场预告萌宠聚会和宠物围脖DIY，也可关注体验义工招募。',
  noPetRequired: true, playTags: [], petPlayTags: [],
  petPolicy: { status: 'unknown', text: '公告未说明自带宠物的种类、体型、证件及牵引要求；参加萌宠聚会或DIY也需先确认携宠准入。' },
  visitAdvice: '不带宠也可关注领养与志愿岗位信息；公众入场、领养审核及DIY参与方式请先向活动方确认。',
  needsRecheck: true,
  notice: '来源为义工招募公告，尚未核实公众票价、是否预约、领养审核与费用、DIY报名及费用；请勿直接带宠到场或视为可现场领养。',
  highlights: [
    '10月24日13:00—17:00为西施繁殖犬专场领养；同场14:00—16:00安排萌宠聚会与宠物围脖DIY，具体名额和参加方式待确认。',
    '公告要求当场义工12:00签到；这是义工到岗时间，不是公众活动开始或商场开放时间。',
    volunteerNote
  ],
  sources: [source]
}, {
  id: 'event-pufa-shiguangli-ragdoll-adoption-2026', type: 'event', title: '上海领养日 · 奇喵幸福制造局布偶繁殖猫专场领养',
  city: '上海', district: '浦东新区', area: '浦发时光里', categoryLabel: '公益领养 · 义工招募',
  venue: '浦发时光里 · 奇喵幸福制造局', address: '上海市浦东新区浦三路3088号 · 浦发时光里商场外街1楼L120号铺奇喵幸福制造局',
  hostName: '上海领养日 × 奇喵幸福制造局 × 浦发时光里',
  startsAt: '2026-10-25T13:00:00+08:00', endsAt: '2026-10-25T17:00:00+08:00',
  dateLabel: '10月25日13:00—17:00',
  ticketText: '公众入场、领养审核及相关费用待确认', feeType: 'unknown',
  summary: '到奇喵幸福制造局了解布偶繁殖猫的领养信息，也可关注本场体验义工岗位及参加条件。',
  noPetRequired: true, playTags: [], petPlayTags: [],
  petPolicy: { status: 'unknown', text: '未公布访客自带宠物的准入条件；领养猫咪在场不代表可以携带自家宠物入内。' },
  visitAdvice: '先确认公众入场和领养审核流程；体验义工须另行确认报名资格与岗位安排，不要求自带宠物。',
  needsRecheck: true,
  notice: '仅确认本场日期、时段和活动地点；公众票价、预约要求、领养条件及费用待公布或确认，不承诺现场即可领养或上岗。',
  highlights: [
    '布偶繁殖猫专场领养为10月25日13:00—17:00，活动地点为商场外街1楼L120号铺。',
    '公告要求当场义工12:00签到；该时刻仅供已确认岗位的义工安排到岗，不作公众开放依据。',
    volunteerNote
  ],
  sources: [source]
}, {
  id: 'event-changfeng-mag-cat-adoption-2026', type: 'event', title: 'MAG令喵心动的offer第二季 · 猫咪领养专场',
  city: '上海', district: '普陀区', area: '长风大悦城', categoryLabel: '公益领养 · 义工招募',
  venue: '长风大悦城室外L1中央广场', address: '上海市普陀区大渡河路196号 · 长风大悦城室外L1中央广场',
  hostName: 'MAG × 上海领养日 × 长风大悦城',
  startsAt: '2026-10-31T13:00:00+08:00', endsAt: '2026-11-01T18:00:00+08:00',
  dateLabel: '10月31日—11月1日 · 每天13:00—18:00',
  ticketText: '公众入场、领养审核及相关费用待确认', feeType: 'unknown',
  summary: '在长风大悦城关注两天的猫咪领养活动，了解领养安排，或申请参与体验义工岗位。',
  noPetRequired: true, playTags: [], petPlayTags: [],
  petPolicy: { status: 'unknown', text: '公告未说明访客自带宠物的种类、体型及通行条件；室外活动场地不等于已获携宠许可。' },
  visitAdvice: '按每天13:00—18:00的活动时段关注安排；公众预约、领养条件与义工报名须先向活动方确认。',
  needsRecheck: true,
  notice: '两天均为13:00—18:00，不是连续开放；公众票价、是否预约、领养条件及费用尚未核实，义工报名入口和余量待确认。',
  highlights: [
    'MAG、上海领养日与长风大悦城联合开展猫咪领养专场，10月31日和11月1日每天13:00—18:00。',
    '公告要求义工每天12:00签到；公众活动从13:00开始，领养审核与动物交接流程需另行确认。',
    volunteerNote
  ],
  sources: [source]
}, {
  id: 'event-tops-shanghai-2028', type: 'exhibition', title: '2028 TOPS它博会 · 上海展期预告',
  city: '上海', area: '国家会展中心', categoryLabel: '2028展期预告',
  venue: '国家会展中心（上海）', address: '国家会展中心（上海）· 本届展馆及入口待公布',
  hostName: '上海它布斯展览有限公司',
  startsAt: '2028-04-06T00:00:00+08:00', endsAt: '2028-04-10T00:00:00+08:00', datePrecision: 'day',
  dateLabel: '2028年4月6日—9日 · 公众开放日待公布',
  ticketText: '2028届票价、公众开放日与参与方式待公布', feeType: 'unknown',
  summary: '主办方公布2028年上海它博会展期，可先收藏日期，等候本届展区、公众参观和携宠安排。',
  noPetRequired: false, playTags: ['exhibition'], petPlayTags: [],
  petPolicy: { status: 'unknown', text: '2028上海场的携宠种类、体型、证件和牵引要求尚未公布；不沿用往届或杭州场规则，也不表示必须携宠。' },
  visitAdvice: '目前适合收藏展期；待本届公众开放日、票务和携宠规则公布后再安排参观。',
  needsRecheck: true,
  notice: '目前仅确认整体展期和场馆，不代表4天均对普通观众开放；每日开放时段、具体展馆、票价、预约和携宠条件待公布。',
  highlights: [
    '官网列明2028年4月6日—9日在国家会展中心（上海）举办，主办方为上海它布斯展览有限公司；该展期预告未标注发布日期。',
    '官网另列的2027年4月15日—18日为杭州场，不与本条上海展期合并。',
    '首页仍展示2026届的会议和活动；这些旧节目、时段及报名信息不作为2028届参与依据。'
  ],
  sources: [{ publisher: 'TOPS它博会 · 上海它布斯展览有限公司', title: 'TOPS它博会官网 · 2028上海展期预告', url: 'https://www.theonepetshow.com/', publishedAt: '', checkedAt: '2026-10-21' }]
}];
