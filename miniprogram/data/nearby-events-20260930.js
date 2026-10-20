// Public announcement read on 2026-09-30; no platform booking or ticket inventory.
const source = {
  publisher: '上海徐汇 · 徐汇区新闻办公室官方账号',
  title: '有福利！带毛孩子坐游船，吹江风，赏光影，还有一场岸边派对',
  url: 'https://news.qq.com/rain/a/20260929A0BPRQ00',
  publishedAt: '2026-09-29', checkedAt: '2026-10-01'
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
      '原公告曾向10月1—2日乘过宠物友好航班的游客提供犬赛门票抽奖；对应犬赛已于10月6日18:00结束，本条仅保留福利回顾，不再提供领票参与指引。',
      '岸边城市派对为10月1日至7日每天12:00—22:00；属于另一个活动，其票价与携宠规则需单独确认。'
    ], sources: [source]
  },
  {
    id: 'event-monaco-dog-show-2026', type: 'event', title: '摩纳哥全明星犬赛 · 大师赛嘉年华',
    city: '上海', district: '闵行区', area: '元江路沿线', categoryLabel: '犬只选美 · 敏捷赛',
    address: '上海市闵行区元江路5500号 · 旗忠网球中心（具体赛事入口按主办方指引）', venue: '旗忠网球中心', hostName: '赛事组织方以报名公告为准',
    startsAt: '2026-10-04T11:30:00+08:00', endsAt: '2026-10-06T18:00:00+08:00',
    dateLabel: '10月4日—6日 · 敏捷赛11:30—13:30，选美赛14:00—18:00',
    ticketText: '参赛288元/组（2人1犬）· 观众票务另行确认', feeType: 'paid',
    summary: '选美赛与敏捷赛同场，不限品种和血统；想带狗狗参赛，先核对年龄与证件要求。',
    noPetRequired: false, playTags: ['agility'], petPlayTags: ['agility'],
    petPolicy: { status: 'conditional', text: '参赛限9个月至9岁的健康犬只，需有效检疫证明、狂犬病免疫证明和养犬登记证。禁养烈性犬及怀孕、哺乳、发情、传染病、身体不适或有攻击倾向的犬只不得参赛。普通观众携犬规则另询。' },
    highlights: [
      '10月4—6日每天11:30—13:30敏捷赛、14:00—18:00选美赛；4—5日敏捷赛为中级8项可牵绳，6日为高级16项不可牵绳，仅适用于赛场规则。',
      '报名分两步：在久事体育APP缴费，再到「久事文传」微信小程序完成宠物入园登记；两项都完成才生效，入口二维码见报名公告。',
      '预约在比赛日前两天23:59截止：4、5、6日场次分别对应10月2、3、4日。是否仍有名额以官方系统为准，不承诺补报或现场报名。',
      '犬龄9个月至9岁；预约需上传免疫证、养犬登记证，参赛另需有效检疫证明。牵犬师须年满12岁，未满18岁需监护人陪同及同意；非犬主需书面授权。',
      '公告指引场地为旗忠网球中心2号馆北侧草坪，位于「ACE萌友天地」宠物区；报到时刻及实际入口请核对预约通知。导航点仍为场馆参照。',
      '宠物区另有寄养服务，时段、费用及余位另询；寄养不等于宠物可进入中央场馆。普通观众票价、入场方式和携犬要求尚未明确。',
      '9月29日报道列明管理推广方为上海久事动娱文旅集团股份有限公司、上海久事体育产业发展（集团）有限公司；具体报名承办与联系方式仍需确认。',
      '报名公告列出参赛赠2张大师赛门票：4日为嘉年华票、5—6日为资格赛票；使用与领取条件以官方确认为准，不代表中央场馆门票或犬赛免费报名。'
    ], sources: [source, { publisher: '腾讯地图', title: '久事体育场馆旗忠网球中心地点详情', url: 'https://map.qq.com/poi/?sm=539366273284470100&keyfrom=1', publishedAt: '', checkedAt: '2026-09-30' },
      { publisher: '上观新闻 · 新民晚报', title: '服务更细，商品更多，宠物更友好，上海劳力士大师赛又升级了', url: 'https://www.shobserver.com/staticsg/res/html/web/newsDetail.html?id=1186234', publishedAt: '2026-09-28', checkedAt: '2026-09-30' },
      { publisher: '新闻晨报 · 官方账号', title: '十月上海旗忠“网球+萌宠”双赛联动，摩纳哥网球“梦之队”将亮相2026摩纳哥全明星犬赛开幕式', url: 'https://news.qq.com/rain/a/20260929A0CTU300', publishedAt: '2026-09-29', checkedAt: '2026-10-01' },
      { publisher: '上观号 · 图文：上海劳力士大师赛', title: '100000元奖池！摩纳哥全明星犬赛开放报名！报名即送大师赛门票和伴手礼', url: 'https://www.shobserver.com/sgh/detail?id=4061174', publishedAt: '2026-09-21', checkedAt: '2026-10-03' }],
    point: { latitude: 31.040443, longitude: 121.358051, coordinateSystem: 'gcj02', precision: 'venue', label: '旗忠网球中心（场所参照，非犬赛入口）', sourceUrl: 'https://map.qq.com/poi/?sm=539366273284470100&keyfrom=1' }
  },
  {
    id: 'event-changtan-langhua-market-2026', type: 'event', title: '上海长滩 · 浪花市集',
    city: '上海', district: '宝山区', area: '长滩滨江', categoryLabel: '滨江市集 · 宠物友好区',
    address: '上海市宝山区长滩滨江公园段 · 浪花市集（具体入口待公布）', venue: '长滩滨江公园段', hostName: '具体主办单位待公布',
    startsAt: '2026-10-02T14:00:00+08:00', endsAt: '2026-10-06T20:00:00+08:00',
    dateLabel: '10月2日—6日 · 每天14:00—20:00（市集）',
    ticketText: '市集免费参与 · 10月5日萌宠派对已结束', feeType: 'free',
    summary: '沿江逛宠物好物、手作和美食摊；市集至10月6日20:00，5日萌宠派对已结束。',
    visitAdvice: '市集10月6日20:00结束；先确认当天携宠范围，按官方停车指引前往。5日派对不再报名。',
    noPetRequired: true, playTags: [], petPlayTags: [],
    petPolicy: { status: 'conditional', text: '市集设宠物友好区域，范围、宠物种类及牵引、健康要求需现场确认。5日派对欢迎猫犬的说明仅适用于该场次，不代表整个滨江公园均可携宠。' },
    notice: '10月5日14:30—18:40的萌宠派对已结束；市集继续至6日20:00，不再提供派对或晚宴报名指引。',
    highlights: [
      '「与浪之间」上海长滩艺术集的一部分，10月2日至6日每天14:00—20:00在滨江公园段举办。',
      '市集设美食、文创、手作及宠物友好区域，市民游客可免费逛集；具体消费与体验项目费用另询。',
      '10月5日14:30—18:40萌宠欢乐派对已结束，当时安排宠友互动、趣味运动会和萌宠晚宴；6日不再据此提供派对报名。',
      '自驾可参考宝杨码头地下停车场、子青路道路停车点（近上海市行知中学）或海上世界停车场，停车收费自理，现场车位不作保证。',
      '不带宠可参考吴淞滨江线至吴淞口路盘古路站；其他公共交通指引见原文，不能据此推定普通宠物可以乘坐公交或地铁。'
    ], sources: [
      { publisher: '上海市人民政府 · 宝山区人民政府', title: '国庆来宝山！200项活动嗨遍全城，重磅礼遇buff叠满！追浪听歌看烟花全部安排', url: 'https://www.shanghai.gov.cn/nw17239/20260921/5a558d54e2604b8ebbb6b8ac1da79115.html', publishedAt: '2026-09-21', checkedAt: '2026-09-30' },
      { publisher: '上观新闻 · 新民晚报', title: '国庆去哪玩？上海16个区放大招！从滨江赛事到郊野丰收，总有一款适合你', url: 'https://www.shobserver.com/staticsg/res/html/web/newsDetail.html?id=1185747', publishedAt: '2026-09-30', checkedAt: '2026-09-30' },
      { publisher: '上海宝山（新浪转载）', title: '玩转宝山｜国庆开“浪”！宝山滨江沉浸式浪花市集燃动上线！', url: 'https://finance.sina.com.cn/wm/2026-09-29/doc-initnfqc7877861.shtml', publishedAt: '2026-09-29', checkedAt: '2026-10-06' },
      { publisher: '上海宝山（上海热线转载）', title: '玩转宝山｜国庆开“浪”！宝山滨江沉浸式浪花市集燃动上线！', url: 'https://hot.online.sh.cn/content/2026-10/01/content_10492120.htm', publishedAt: '2026-10-01', checkedAt: '2026-10-02' }
    ]
  }
];
