// Public event announcements rechecked on 2026-09-30; not platform registrations.
const checkedAt = '2026-09-30';
const source = (publisher, title, url, publishedAt) => ({ publisher, title, url, publishedAt, checkedAt });

module.exports = [
  {
    id: 'event-dingfeng-pets-2026', type: 'event', title: '鼎丰酱园 · 国庆宠物生活节',
    petPlayTags: ['training', 'social', 'agility'], feeType: 'free',
    categoryLabel: '训犬 · 手作 · 运动', city: '上海', district: '奉贤区', area: '南桥',
    address: '上海市奉贤区南桥镇新建中路496号 · 鼎丰酱园', venue: '鼎丰酱园', hostName: '鼎丰酱园',
    startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-04T00:00:00+08:00', datePrecision: 'day',
    dateLabel: '10月1日—3日 · 按每日场次参加', ticketText: '活动免费 · 通过鼎丰酱园公众号报名',
    summary: '10月3日还有手作、宠物走秀、自由社交与趣味运动，参加前通过公众号确认场次安排。',
    playTags: ['social', 'exhibition'], noPetRequired: true,
    petPolicy: { status: 'conditional', text: '公告欢迎携宠；参与前确认犬只健康、牵引及具体场次要求。' },
    highlights: [
      '10月1日：训犬指导、口水巾DIY、趣味运动及宠物零食互动均已结束。',
      '10月2日：9:00—10:00、13:00—14:00幸福养宠小课堂均已结束，不再提供该场次报名指引。',
      '10月3日：13:00签到，13:45手作，14:40宠物走秀，16:30—19:00自由社交与趣味运动。',
      '参与入口：鼎丰酱园公众号 → 酱子好玩 → 萌爪派对。市集消费另计，具体余量以主办方为准。',
      '公告列出10月1—3日13:00—20:00集市；10月3日上午另有市集安排。'
    ],
    sources: [{ ...source('上海奉贤（新浪转载）', '国庆带毛孩子去哪？鼎丰酱园三天宠物派对，天天不重样！', 'https://finance.sina.com.cn/wm/2026-09-29/doc-initnscx7762391.shtml', '2026-09-29'), checkedAt: '2026-10-01' }]
  },
  {
    id: 'event-baijia-pet-market-2026', type: 'event', title: '百家村 · 萌宠创意嘉年华',
    petPlayTags: ['social'], feeType: 'unknown',
    categoryLabel: '宠物市集 · 音乐时装秀', city: '上海', district: '金山区', area: '张堰',
    address: '上海市金山区张堰镇百家村 · 白玉兰路以南林下停车场主舞台（活动场地，非停车区）', venue: '百家村', hostName: '主办单位待公布',
    startsAt: '2026-10-01T09:00:00+08:00', endsAt: '2026-10-03T16:00:00+08:00',
    dateLabel: '10月1日—3日 · 市集10:00—16:00，主题活动分场次', ticketText: '音乐会、时装秀可现场观看 · 票价及体验费用待确认',
    summary: '在林下逛宠物市集，看携宠音乐会与时装秀；运动体验按项目确认招募安排。',
    playTags: ['exhibition', 'social'], noPetRequired: true,
    petPolicy: { status: 'conditional', text: '主舞台周边有宠物运动、人宠互动和技能展示；携宠范围、牵引及参赛条件需向现场工作人员确认。' },
    notice: '荡里路沿线施工封路，请绕行。白玉兰路以南林下停车场是主舞台活动区，不能停车；地图点仅为百家村村域参照。',
    highlights: [
      '10月1—3日市集每天10:00—16:00；主舞台携宠音乐会每天13:00—13:30，官方表格标为现场观看。',
      '宠物时装秀：10月3日10:00—11:00可现场观看；10月1日及2日场次已结束。',
      '库尔辛挑战赛每天10:00—11:30、14:00—16:00；丛林探险每天10:30—12:00、14:30—16:00。两项均为前期招募，能否补报需询工作人员。',
      '亲子萌宠手作：10月3日9:30—10:30，表格标为现场观看，不据此承诺可现场制作；10月2日13:00—14:00场次已结束。10月1日9:00数字油画体验和交友派对已结束。',
      '驾车查看官方停车示意图的高桥路、白玉兰路石水路入口，按现场指引停车、候乘接驳。活动区不能停车，荡里路封路需绕行；景区禁止明火。',
      '摊主招募已截止；市集有宠物用品、科普、手作及农产小吃。观众票价、体验收费和携宠细则未完整公布。'
    ],
    sources: [
      source('上海市金山区人民政府', '国庆赴野趣！金山区“文明鑫市集”萌宠创意嘉年华来袭', 'https://www.jinshan.gov.cn/shfw-bmxx/20260917/878841.html', '2026-09-17'),
      { ...source('上海市金山区人民政府 · 区融媒体中心', '金山区张堰镇百家村“萌宠同行·创艺无界”主题活动来袭', 'https://www.jinshan.gov.cn/shfw-bmxx/20260928/878981.html', '2026-09-28'), checkedAt: '2026-10-02' }
    ]
  },
  {
    id: 'event-cpark-lifestyle-2026', type: 'event', title: 'C·PARK · 悠享生活季「放一放乐园」',
    petPlayTags: [], feeType: 'unknown',
    categoryLabel: '户外市集 · 亲子体验', city: '上海', district: '长宁区', area: '新华路',
    address: '上海市长宁区 · C·PARK海粟文化广场', venue: 'C·PARK海粟文化广场', hostName: '主办单位待公布',
    startsAt: '2026-10-17T10:00:00+08:00', endsAt: '2026-10-18T21:00:00+08:00',
    dateLabel: '10月17日—18日 · 每天10:00—21:00', ticketText: '入场票务与各体验项目费用、预约要求待确认',
    summary: '在户外草坪逛市集、看演出、体验绘画与共读；已公布节目以亲子家庭为主，携宠前先确认。',
    playTags: ['exhibition'], noPetRequired: true,
    petPolicy: { status: 'unknown', text: '早期政府指南提及宠物业态；9月30日具体节目以亲子为主，未明确宠物环节和游客携宠准入，需另行确认。' },
    highlights: [
      '9月30日文汇网报道明确10月17—18日每天10:00—21:00，在C·PARK海粟文化广场户外草坪举行。',
      '公布的体验包含人像绘画、纸飞机工坊、儿童闲置交换与义卖、户外涂鸦、共读、乐队演出及亲子运动；具体场次、费用和报名条件另询。',
      '公告介绍到场领取打卡地图、按点位互动集章后到服务台参加抽奖；不保证获奖或赠品库存，不代表全部体验免费。',
      '这是综合家庭休闲活动，原政府指南提及宠物业态，但最新节目没有列出具体宠物活动；不当作已确认可携宠的专门宠物展。'
    ],
    sources: [source('上海市人民政府 · 长宁区人民政府', '最新！长宁重点商圈、特色街区打卡指南来了', 'https://www.shanghai.gov.cn/nw17239/20260904/4ee735e460cd477b8b1c660b31f78df6.html', '2026-09-04'),
      { publisher: '文汇网（凤凰网大风号）', title: '悠享生活季即将启幕，解锁全球最酷街区的秋日松弛感', url: 'https://feng.ifeng.com/c/8wqULdudONJ', publishedAt: '2026-09-30', checkedAt: '2026-10-06' }
    ]
  },
  {
    id: 'event-shenlong-pet-adventure-2026', type: 'event', title: '申隆·宠物冒险岛 · 国庆勇士挑战',
    petPlayTags: ['agility'], feeType: 'paid',
    categoryLabel: '人宠闯关 · 动物互动', city: '上海', district: '奉贤区', area: '沿钱公路',
    address: '上海市奉贤区沿钱公路5599号 · 申隆·宠物冒险岛（具体入园口请先确认）',
    venue: '申隆·宠物冒险岛', hostName: '申隆·宠物冒险岛',
    startsAt: '2026-10-01T00:00:00+08:00', endsAt: '2026-10-08T00:00:00+08:00', datePrecision: 'day',
    dateLabel: '10月1日—7日 · 核心赛事每日16:00—17:00',
    ticketText: '公开报价198元/宠，含3人陪同 · 项目费用及预约另询园方',
    summary: '国庆期间安排人宠越野、皮划艇挑战和趣味闯关，不带宠也可了解现场动物互动体验。',
    playTags: ['social', 'animals'], noPetRequired: true, needsRecheck: true,
    petPolicy: { status: 'conditional', text: '活动面向带宠和无宠游客；犬种、体型、免疫证明及比赛条件待园方确认，动物互动须服从工作人员评估。' },
    notice: '国庆活动公告日期已过，以下保留10月1—7日资料；后续活动及入园安排以园方新公告为准。',
    highlights: [
      '日程预告：10月1日人宠丛林越野开幕赛，10月2—6日皮划艇赛，10月7日积分晋级总决赛；核心赛事每日16:00—17:00。',
      '品牌公开文章列出9:00—18:00日间游玩与趣味小赛，18:00后有晚间内容；闭园时间、具体场次以园方最终公告为准。',
      '耐威克9月24日文章报价198元/宠，每张宠物票可3人免票陪同；无宠游客的互动安排、项目收费和购票预约请咨询园方18930760079。',
      '近期宣传地址为沿钱公路5599号，4月上海奉贤公告写5601号中心路1号；出发前请向园方确认实际入口和停车安排。',
      '可了解宠物障碍、定力和寻亲等趣味项目，以及工作人员引导的动物观察互动；不保证所有动物或项目每天开放。'
    ],
    sources: [
      { ...source('耐威克（知乎公开文章）', '上海宠物圈再添加文旅新地标！10月1日，申隆·宠物冒险岛正式开岛！230万养宠家庭的超绝打卡地！', 'https://zhuanlan.zhihu.com/p/2086510398522639051', '2026-09-24'), checkedAt: '2026-10-07' },
      source('资讯中国（新浪转载宣传稿）', '国庆不出沪，带狗去岛上！上海宠物冒险岛乐园10月1日正式开岛！', 'https://news.sina.cn/sx/2026-09-24/detail-inisxnvc0383733.d.html?vt=4', '2026-09-24'),
      source('上海奉贤 · 官方澎湃号（报送：上海东方金融小镇）', '咱们奉贤也有自己的宠物岛了！（内含送票福利哦）', 'https://m.thepaper.cn/baijiahao_33009782', '2026-04-20')
    ]
  }
];
