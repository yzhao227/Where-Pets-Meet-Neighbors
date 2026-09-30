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
    summary: '训犬指导、口水巾DIY、趣味闯关与宠物走秀，按喜欢的玩法挑一天参加。',
    playTags: ['social', 'exhibition'], noPetRequired: true,
    petPolicy: { status: 'conditional', text: '公告欢迎携宠；参与前确认犬只健康、牵引及具体场次要求。' },
    highlights: [
      '10月1日：12:30—13:00建议入场；13:10训犬指导，14:00口水巾DIY，14:40趣味运动，15:20宠物零食互动。',
      '10月2日：9:00—10:00、13:00—14:00幸福养宠小课堂；公告要求“9月30日前报名”，未说明具体截止时刻，请先确认余量。',
      '10月3日：13:00签到，13:45手作，14:40宠物走秀，16:30—19:00自由社交与趣味运动。',
      '参与入口：鼎丰酱园公众号 → 酱子好玩 → 萌爪派对。市集消费另计，具体余量以主办方为准。',
      '公告列出10月1—3日13:00—20:00集市；10月3日上午另有市集安排。小课堂、摊主及志愿者报名可咨询瑞雪公益：18121343143。'
    ],
    sources: [source('上海奉贤（新浪转载）', '国庆带毛孩子去哪？鼎丰酱园三天宠物派对，天天不重样！', 'https://finance.sina.com.cn/wm/2026-09-29/doc-initnscx7762391.shtml', '2026-09-29')]
  },
  {
    id: 'event-baijia-pet-market-2026', type: 'event', title: '百家村 · 萌宠创意嘉年华',
    petPlayTags: [], feeType: 'unknown',
    categoryLabel: '宠物市集 · 养宠科普', city: '上海', district: '金山区', area: '张堰',
    address: '上海市金山区张堰镇百家村 · 林下停车场区域与荡里路沿途', venue: '百家村', hostName: '主办单位待公布',
    startsAt: '2026-10-01T10:00:00+08:00', endsAt: '2026-10-03T16:00:00+08:00',
    dateLabel: '10月1日—3日 · 每天10:00—16:00', ticketText: '观众票价与预约要求待公布 · 市集商品另计',
    summary: '逛宠物好物、听文明养宠科普，也可以看看小小掌柜与乡村手作摊位。',
    playTags: ['exhibition', 'social'], noPetRequired: true,
    petPolicy: { status: 'conditional', text: '官方公告设置萌宠友好区域；携宠通行范围与现场牵引要求需确认。' },
    highlights: [
      '萌宠甄选区包括宠物好物、文明养宠科普、萌娃与萌宠小小掌柜。',
      '自在生活区有文创手作、乡村农副产品和美食，可不带宠逛市集。',
      '摊主招募截止日期已过；本条提供观众游玩信息，不表示仍接受摆摊报名。',
      '属于上海周末远途拓展，出发前核对停车及具体入口。'
    ],
    sources: [source('上海市金山区人民政府', '国庆赴野趣！金山区“文明鑫市集”萌宠创意嘉年华来袭', 'https://www.jinshan.gov.cn/shfw-bmxx/20260917/878841.html', '2026-09-17')]
  },
  {
    id: 'event-cpark-lifestyle-2026', type: 'event', title: 'C·PARK · 悠享生活季「放一放乐园」',
    petPlayTags: [], feeType: 'unknown',
    categoryLabel: '生活市集 · 宠物主题', city: '上海', district: '长宁区', area: '新华路',
    address: '上海市长宁区 · C·PARK海粟文化广场', venue: 'C·PARK海粟文化广场', hostName: '主办单位待公布',
    startsAt: '2026-10-17T00:00:00+08:00', endsAt: '2026-10-19T00:00:00+08:00', datePrecision: 'day',
    dateLabel: '10月17日—18日 · 每日时段待公布', ticketText: '票价与报名方式待公布',
    summary: '市集、美育、音乐与宠物主题同场，适合先收藏日期，等具体节目公布后安排出行。',
    playTags: ['exhibition'], noPetRequired: true,
    petPolicy: { status: 'unknown', text: '公告提及宠物主题业态，但具体携宠入场规则尚待确认。' },
    highlights: ['上海市政府转载的长宁指南已公布日期及场地。', '属于综合生活活动；宠物环节、参与方式与现场时段尚未完整公布，不等同于专门宠物展。'],
    sources: [source('上海市人民政府 · 长宁区人民政府', '最新！长宁重点商圈、特色街区打卡指南来了', 'https://www.shanghai.gov.cn/nw17239/20260904/4ee735e460cd477b8b1c660b31f78df6.html', '2026-09-04')]
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
    notice: '国庆日程依据9月24日公开宣传。新旧公告的门牌表述不同，请先确认入园口、门票包含项目和参赛预约。',
    highlights: [
      '日程预告：10月1日人宠丛林越野开幕赛，10月2—6日皮划艇赛，10月7日积分晋级总决赛；核心赛事每日16:00—17:00。',
      '品牌公开文章列出9:00—18:00日间游玩与趣味小赛，18:00后有晚间内容；闭园时间、具体场次以园方最终公告为准。',
      '耐威克9月24日文章报价198元/宠，每张宠物票可3人免票陪同；无宠游客的互动安排、项目收费和购票预约请咨询园方18930760079。',
      '近期宣传地址为沿钱公路5599号，4月上海奉贤公告写5601号中心路1号；出发前请向园方确认实际入口和停车安排。',
      '可了解宠物障碍、定力和寻亲等趣味项目，以及工作人员引导的动物观察互动；不保证所有动物或项目每天开放。'
    ],
    sources: [
      source('耐威克（知乎公开文章）', '上海宠物圈再添加文旅新地标！10月1日，申隆·宠物冒险岛正式开岛！230万养宠家庭的超绝打卡地！', 'https://zhuanlan.zhihu.com/p/2086510398522639051', '2026-09-24'),
      source('资讯中国（新浪转载宣传稿）', '国庆不出沪，带狗去岛上！上海宠物冒险岛乐园10月1日正式开岛！', 'https://news.sina.cn/sx/2026-09-24/detail-inisxnvc0383733.d.html?vt=4', '2026-09-24'),
      source('上海奉贤 · 官方澎湃号（报送：上海东方金融小镇）', '咱们奉贤也有自己的宠物岛了！（内含送票福利哦）', 'https://m.thepaper.cn/baijiahao_33009782', '2026-04-20')
    ]
  }
];
