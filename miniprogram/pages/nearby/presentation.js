// Short list copy, based on the catalogue. Full conditions and sources stay in details.
const PET_HINTS = {
  "place-shanghai-zoo": "不带宠参观 · 按园方指引观察动物",
  "place-shanghai-natural-history-museum": "馆内禁止携宠 · 提前实名购票",
  "place-changfeng-ocean-world": "建议不带宠参观 · 行前确认开放",
  "event-longhua-pet-cruise-2026": "仅指定萌宠航班 · 登船条件需确认",
  "event-monaco-dog-show-2026": "参赛需三项证明 · 年龄、健康限制见详情",
  'place-xinzhuang-weijing': '室内携宠需向商场确认',
  'place-zhongsheng': '携宠规则需向商场及店铺确认',
  'place-libopark': '可牵绳带宠 · 及时清理',
  'place-xincheng-central': '先按不带宠安排 · 现行规则待复核',
  'place-yuanjiang-tod': '可牵绳带宠 · 留意现场管理',
  'place-pujiang-pet-zones': '仅森林游憩区、滨江漫步区可携宠',
  'place-lanxiang-lake': '环湖绿道可牵绳带宠',
  'place-starbucks-zizhu': '仅外摆区已确认 · 室内另询门店',
  'place-hanxiang-water-garden': '烈犬及大型犬禁入 · 标准询园方',
  'place-menghuayuan': '宠物需另购票 · 现价与规则待确认',
  'place-gubei-citizen-park': '牵绳携宠试点 · 当前范围需确认',
  'place-haisu-park-pet-zones': '仅指定广场、草坪试点区 · 牵绳，行前确认',
  'place-xuhui-westbund-walk': '仅公共步道 · 馆舍与商铺另询',
  'place-shangsheng-xinsuo': '历史要求推车、不落地 · 现行规则待确认',
  'place-zhongshan-park': '先按不带宠安排 · 携宠依据待确认',
  'place-yuehu-sculpture': '凭票、犬证/免疫证明入园 · 牵绳，大型犬戴嘴套',
  'place-fuyuehui-pet-park': '仅外广场 · 活动期禁烈性或攻击性宠物，现规需确认',
  'event-dingfeng-pets-2026': '欢迎携宠 · 健康、牵引与场次要求需确认',
  'event-baijia-pet-market-2026': '设宠物友好区 · 通行与牵引规则需确认',
  'event-cpark-lifestyle-2026': '携宠入场规则待公布',
  'event-shenlong-pet-adventure-2026': '犬种、体型、免疫及参赛条件待确认 · 动物互动须现场评估，入口需复核',
  'notice-pfa-boutique-2027': '携宠规则与票务待公布'
};
const TICKET_HINTS = {
  'event-dingfeng-pets-2026': '免费 · 需公众号报名',
  'event-baijia-pet-market-2026': '票价与预约待公布',
  'event-cpark-lifestyle-2026': '票价与报名待公布',
  'event-shenlong-pet-adventure-2026': '198元/宠含3人 · 项目及预约另询'
};

// Revert to full catalogue copy when an editor or scheduled update changes a rule.
const COPY_REVISIONS = {
  "place-shanghai-zoo": [1059225898,3106669616],
  "place-shanghai-natural-history-museum": [3031955651,706921756],
  "place-changfeng-ocean-world": [1078536785,2791950824],
  "event-longhua-pet-cruise-2026": [767562971,465336665],
  "event-monaco-dog-show-2026": [554192075,4040567411],
  'place-xinzhuang-weijing': [2912830287, 2166136261],
  'place-zhongsheng': [4161997113, 2166136261],
  'place-libopark': [1461456696, 2166136261],
  'place-xincheng-central': [1273412032, 2166136261],
  'place-yuanjiang-tod': [1733545027, 2166136261],
  'place-pujiang-pet-zones': [72646306, 2166136261],
  'notice-pfa-boutique-2027': [72209801, 320907968],
  'event-petfair-asia-2026': [1952320671, 2087607405],
  'event-weijing-spartan-2026': [1739556780, 2651479751],
  'place-lanxiang-lake': [3358148713, 2166136261],
  'place-starbucks-zizhu': [1519192476, 2166136261],
  'place-hanxiang-water-garden': [2849441806, 2166136261],
  'place-menghuayuan': [4024853476, 2166136261],
  'place-gubei-citizen-park': [1690891783, 2166136261],
  'place-haisu-park-pet-zones': [2537848537, 2166136261],
  'place-xuhui-westbund-walk': [3823796173, 2166136261],
  'place-shangsheng-xinsuo': [384689085, 2166136261],
  'place-zhongshan-park': [2856089998, 2166136261],
  'place-yuehu-sculpture': [1489968796, 2166136261],
  'place-fuyuehui-pet-park': [181670942, 2166136261],
  'event-dingfeng-pets-2026': [676207085, 1440632992],
  'event-baijia-pet-market-2026': [3380652607, 2231768939],
  'event-cpark-lifestyle-2026': [1028524128, 3998013010],
  'event-shenlong-pet-adventure-2026': [2227326536, 3560682242]
};
function fingerprint(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function presentation(record) {
  const revision = COPY_REVISIONS[record.id] || [];
  const petUnchanged = revision[0] === fingerprint(JSON.stringify(record.petPolicy || null));
  const ticketUnchanged = revision[1] === fingerprint(record.ticketText || "");
  let stampMonth = '', stampDay = '', stampYear = '';
  if (record.startsAt && Number.isFinite(Date.parse(record.startsAt))) {
    const day = new Date(Date.parse(record.startsAt) + 8 * 3600000);
    stampMonth = (day.getUTCMonth() + 1) + '月';
    stampDay = String(day.getUTCDate()).padStart(2, '0');
    stampYear = String(day.getUTCFullYear());
  } else if (/^\d{4}-\d{2}$/.test(record.announcementMonth || '')) {
    stampMonth = Number(record.announcementMonth.slice(5)) + '月';
    stampDay = '待定';
    stampYear = record.announcementMonth.slice(0, 4);
  }
  const sceneKind = /湖|滨江/.test(record.categoryLabel) ? 'water'
    : (record.playTags || []).includes('walk') ? 'park' : 'city';
  return {
    sceneKind, stampMonth, stampDay, stampYear,
    ticketTheme: /航班|游船/.test(record.title || '') ? 'cruise' : (record.petPlayTags || []).includes('agility') ? 'sport' : 'party',
    locationLabel: [record.district, record.area].filter(Boolean).join(' · '),
    petHint: record.timeStatus === 'ended' ? '已结束 · 携宠条件仅适用当时场次'
      : (petUnchanged && PET_HINTS[record.id]) || record.petPolicy && record.petPolicy.text || '携宠规则待确认',
    ticketHint: (ticketUnchanged && TICKET_HINTS[record.id]) || record.ticketText || '票务信息待公布'
  };
}

module.exports = presentation;
