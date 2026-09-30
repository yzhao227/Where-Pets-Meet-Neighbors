// Public announcement read on 2026-09-30; no platform booking or ticket inventory.
const source = {
  publisher: '上海徐汇 · 徐汇区新闻办公室官方账号',
  title: '有福利！带毛孩子坐游船，吹江风，赏光影，还有一场岸边派对',
  url: 'https://news.qq.com/rain/a/20260929A0BPRQ00',
  publishedAt: '2026-09-29', checkedAt: '2026-09-30'
};

module.exports = [
  {
    id: 'event-longhua-pet-cruise-2026', type: 'event', title: '徐汇滨江 · 国庆萌宠航班',
    city: '上海', district: '徐汇区', area: '龙华码头', categoryLabel: '人宠同游 · 江上假期',
    address: '上海市徐汇区龙华码头 · 徐汇滨江航线', venue: '龙华码头',
    startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-08T00:00:00+08:00', datePrecision: 'day',
    dateLabel: '10月1日—7日 · 每天下午一班',
    ticketText: '票价与下午班次，请向浦江游览集团咨询', feeType: 'unknown',
    summary: '带毛孩子登船吹江风，一起看看秋日滨江；国庆每天下午设宠物友好航班。',
    visitAdvice: '选择下午的萌宠航班，提前核对登船时刻、携宠要求和码头位置。',
    noPetRequired: false, playTags: [], petPlayTags: [],
    petPolicy: { status: 'conditional', text: '公告确认下午指定航班可携宠；购票前需向运营方核对犬种、体型、牵引及免疫证明要求。夜航未确认可携宠。' },
    highlights: [
      '10月1日至7日，每天下午有一班宠物友好航班；具体时刻与票价请向运营方确认。',
      '先选择宠物友好班次，再确认携宠条件与登船位置；这条信息不适用于所有滨江游船。',
      '10月1日至2日乘过宠物友好航班的游客，可凭船票到龙华码头的浦江游览集市展位参加犬赛门票抽奖，每日3张；奖励不保证获得。',
      '岸边城市派对为10月1日至7日每天12:00—22:00；属于另一个活动，其票价与携宠规则需单独确认。'
    ], sources: [source]
  },
  {
    id: 'event-monaco-dog-show-2026', type: 'event', title: '摩纳哥全明星犬赛 · 大师赛嘉年华',
    city: '上海', district: '闵行区', area: '元江路沿线', categoryLabel: '犬只选美 · 敏捷赛',
    address: '上海市闵行区元江路5500号 · 旗忠网球中心（具体赛事入口按主办方指引）', venue: '旗忠网球中心', hostName: '赛事组织方以报名公告为准',
    startsAt: '2026-10-04T00:00:00+08:00', endsAt: '2026-10-07T00:00:00+08:00', datePrecision: 'day',
    dateLabel: '10月4日—6日 · 每日场次以赛事公告为准',
    ticketText: '观赛票价与参赛报名请查询赛事官方公告', feeType: 'unknown',
    summary: '选美赛与敏捷赛同场，不限品种和血统；想带狗狗参赛，先核对年龄与证件要求。',
    noPetRequired: false, playTags: ['agility'], petPlayTags: ['agility'],
    petPolicy: { status: 'conditional', text: '参赛限9个月至9岁的健康犬只，需有效检疫证明、狂犬病免疫证明和养犬登记证。禁养烈性犬及怀孕、哺乳、发情、传染病、身体不适或有攻击倾向的犬只不得参赛。普通观众携犬规则另询。' },
    highlights: [
      '赛事将于10月4日至6日在旗忠网球中心举办，属于上海劳力士大师赛嘉年华活动。',
      '设选美赛、敏捷赛；不限品种、血统，公告提到面向新手的分组。',
      '参赛犬只年龄为9个月至9岁，需要有效检疫证明、狂犬病免疫证明和养犬登记证。',
      '报名入口、费用、报到时间及普通观众携犬要求请向赛事组织方确认；本页不受理报名。'
    ], sources: [source, { publisher: '腾讯地图', title: '久事体育场馆旗忠网球中心地点详情', url: 'https://map.qq.com/poi/?sm=539366273284470100&keyfrom=1', publishedAt: '', checkedAt: '2026-09-30' }],
    point: { latitude: 31.040443, longitude: 121.358051, coordinateSystem: 'gcj02', precision: 'venue', label: '旗忠网球中心（场所参照，非犬赛入口）', sourceUrl: 'https://map.qq.com/poi/?sm=539366273284470100&keyfrom=1' }
  }
];
