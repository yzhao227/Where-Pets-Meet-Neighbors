'use strict';

// Editorial participation directions, tied to their public evidence. These are
// not platform registrations or live inventory. A changed source falls back to
// the latest record instead of silently retaining an old registration route.
// After checking changed facts and revising the guide, regenerate its signature:
// const catalogue = require('./miniprogram/data/nearby-catalogue');
// const signature = require('./miniprogram/data/nearby-participation').recordSignature;
// console.log(signature(catalogue.records.find(record => record.id === 'EVENT_ID')));
function recordSignature(record) {
  const fields = ['id', 'type', 'title', 'startsAt', 'endsAt', 'datePrecision', 'dateLabel', 'announcementMonth',
    'ticketText', 'feeType', 'hostName', 'venue', 'address', 'notice'];
  const payload = JSON.stringify([
    fields.map(key => record[key] === undefined ? '' : record[key]),
    record.petPolicy && [record.petPolicy.status || '', record.petPolicy.text || ''],
    Array.isArray(record.highlights) ? record.highlights : [],
    (Array.isArray(record.sources) ? record.sources : []).map(source => source && [source.url || '', source.title || '', source.publisher || '', source.publishedAt || ''])
  ]);
  // Change detection only, not a security signature. Two compact streams avoid
  // storing the complete source text again in the mini-program package.
  let first = 2166136261, second = 2246822519;
  for (let index = 0; index < payload.length; index += 1) {
    first = Math.imul(first ^ payload.charCodeAt(index), 16777619);
    second = Math.imul(second ^ payload.charCodeAt(index), 3266489917);
  }
  return payload.length + ':' + (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
}

function latestSource(sources) {
  const date = source => {
    const parsed = Date.parse(source && source.publishedAt);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  // A later added source wins tied publication dates, without treating a desk
  // research checkedAt refresh as new activity information.
  return sources.reduce((latest, source) => source && source.url && (!latest || date(source) >= date(latest)) ? source : latest, null);
}

const guides = {
  'event-dingfeng-pets-2026': {
    evidenceSignature: '708:c26e8ee19cc5f4af',
    sourceUrl: 'https://finance.sina.com.cn/wm/2026-09-29/doc-initnscx7762391.shtml',
    label: '公众号报名', title: '到「鼎丰酱园」公众号选择场次',
    steps: [
      { title: '找到公众号', text: '在微信搜索并关注「鼎丰酱园」。' },
      { title: '进入报名菜单', text: '点底部菜单「酱子好玩」→「萌爪派对」。' },
      { title: '确认场次后报名', text: '按页面选择想参加的活动，确认余量及携宠要求。' }
    ],
    fee: '10月1—3日活动免费，市集消费另计。',
    note: '10月2日小课堂、摊主及志愿者招募要求「9月30日前报名」；这不是整个生活节的统一截止时间，具体余量请先确认。',
    contactLabel: '小课堂与招募咨询 · 瑞雪公益', contact: '18121343143',
    actionLabel: '查看报名指引'
  },
  'event-shenlong-pet-adventure-2026': {
    evidenceSignature: '1077:8f83f30f9ffbc95f',
    sourceUrl: 'https://zhuanlan.zhihu.com/p/2086510398522639051',
    label: '先咨询园方', title: '先确认门票，再预约参赛项目',
    steps: [
      { title: '联系园方咨询', text: '向园方确认购票渠道、目标日期和具体入园口。' },
      { title: '确认项目与携宠条件', text: '询问门票包含项目、赛事是否另需预约，以及犬种、体型和免疫证明要求。' }
    ],
    fee: '公开报价198元/宠，含3人陪同；项目收费及无宠游客票务另询园方。',
    contactLabel: '园方咨询', contact: '18930760079',
    note: '不同公告中的门牌不一致，请同时核对实际入口和停车安排。',
    actionLabel: '查看参与指引'
  },
  'event-longhua-pet-cruise-2026': {
    evidenceSignature: '595:2406828ffa100965',
    sourceUrl: 'https://news.qq.com/rain/a/20260929A0BPRQ00',
    label: '先咨询运营方', title: '向浦江游览集团确认宠物友好班次',
    steps: [
      { title: '询问指定航班', text: '国庆10月1—7日每天下午一班；确认当日时刻、票价与购票渠道。' },
      { title: '确认登船要求', text: '核对携宠条件和登船位置，再安排出发。普通航班不适用这条携宠信息。' }
    ],
    note: '尚未取得可直接购票的链接与公开咨询电话；岸边市集是另一场活动。',
    actionLabel: '查看航班公告'
  },
  'event-monaco-dog-show-2026': {
    evidenceSignature: '953:a8f5cc7633954664',
    sourceUrl: 'https://news.qq.com/rain/a/20260929A0BPRQ00',
    label: '报名入口待确认', title: '先区分「观赛」与「带犬参赛」',
    steps: [
      { title: '观众参加', text: '观赛票价、入场方式及观众携犬要求，需向赛事组织方确认。' },
      { title: '参赛准备', text: '公告列出犬龄9个月至9岁；需有效检疫证明、狂犬病免疫证明和养犬登记证。' },
      { title: '认准场内区域', text: '犬赛设在「ACE萌友天地」宠物区。若需寄养，再确认开放时段、收费和预约；中央场馆携宠准入未获确认。' }
    ],
    note: '报名入口、截止时间及费用尚待确认；具备参赛条件不等于已获得参赛名额。',
    actionLabel: '查看赛事公告'
  },
  'event-baijia-pet-market-2026': {
    evidenceSignature: '527:928af2ff1eeb2bdf',
    sourceUrl: 'https://www.jinshan.gov.cn/shfw-bmxx/20260917/878841.html',
    label: '观众安排待确认', title: '观众入场方式还需等后续公告',
    steps: [{ title: '先确认再出发', text: '观众票价、是否预约和携宠通行范围尚未明确，先查看活动后续通知。' }],
    note: '摊主招募已截止；此页的10月1—3日为观众游玩日期，不代表仍可报名摆摊。',
    actionLabel: '查看活动公告'
  },
  'event-changtan-langhua-market-2026': {
    evidenceSignature: '836:66b575cd8356ae1d',
    sourceUrl: 'https://www.shanghai.gov.cn/nw17239/20260921/5a558d54e2604b8ebbb6b8ac1da79115.html',
    label: '关注官方安排', title: '到「文旅宝山」公众号确认当日安排',
    steps: [
      { title: '确认入口与时段', text: '市集10月2—6日每天14:00—20:00开放；具体入口查看「文旅宝山」后续指引。' },
      { title: '带宠先核对范围', text: '确认宠物友好区边界和携宠条件；萌宠派对的场次、参与方式需要单独查询。' }
    ],
    fee: '公告明确市集免费参与；具体消费与体验项目费用另询。',
    note: '公众号是详情查询渠道，尚未公布萌宠派对报名入口。时间和内容可能因天气、现场情况调整。',
    actionLabel: '查看活动公告'
  },
  'event-cpark-lifestyle-2026': {
    evidenceSignature: '481:e400c8db0cf460d3',
    sourceUrl: 'https://www.shanghai.gov.cn/nw17239/20260904/4ee735e460cd477b8b1c660b31f78df6.html',
    label: '参与方式待公布', title: '日期已公布，先收藏再等报名安排',
    steps: [{ title: '关注后续安排', text: '已公布10月17—18日及C·PARK场地，票价、报名方式和每日时段尚待公布。' }],
    note: '宠物主题环节与携宠规则也尚未确认，请先不要按可携宠活动安排出行。',
    actionLabel: '查看活动预告'
  }
};

function participationFor(record, { timeStatus, isAnnouncement, announcementPast }) {
  if (record.type === 'place') return null;
  const sourceList = Array.isArray(record.sources) ? record.sources : [];
  const matched = guides[record.id];
  const guide = matched && recordSignature(record) === matched.evidenceSignature && sourceList.some(source => source && source.url === matched.sourceUrl) ? matched : null;
  const source = guide ? sourceList.find(source => source.url === guide.sourceUrl) : latestSource(sourceList);
  const result = {
    state: 'pending', label: '参与方式待确认', title: '先确认参加方式，再安排出行',
    steps: [{ title: '查看最新安排', text: '报名入口、名额及入场要求尚待确认，请以主办方后续公告为准。' }],
    fee: record.ticketText || '费用待主办方公布', note: '', contact: '', contactLabel: '',
    sourceUrl: source && source.url || '', actionLabel: '查看参与公告',
    ...(guide || {})
  };
  if (guide && ['公众号报名', '先咨询园方', '先咨询运营方'].includes(guide.label)) result.state = 'guide';
  if (record.active === false || timeStatus === 'cancelled' || timeStatus === 'ended') {
    const withdrawn = record.active === false;
    return { ...result, state: 'closed', label: withdrawn ? '已下架' : timeStatus === 'cancelled' ? '活动已取消' : '本场已结束',
      title: withdrawn ? '当前活动信息已不可用' : timeStatus === 'cancelled' ? '取消后的安排以最新通知为准' : '期待下一次相聚',
      steps: [], fee: '', contact: '', contactLabel: '',
      note: withdrawn ? '出行或报名之前，请重新向主办方核实。' : timeStatus === 'cancelled' ? '请勿按原场次报名或出发。' : '这里保留往期记录；本场不再提供参与指引，新场次需另行确认。',
      actionLabel: withdrawn ? '查看原有公告' : timeStatus === 'cancelled' ? '查看活动公告' : '打开往期原文' };
  }
  if (timeStatus === 'undated') {
    return { ...result, state: 'pending', label: announcementPast ? '预告待更新' : '尚待正式开放',
      title: isAnnouncement && !announcementPast ? '月份已官宣，具体参与安排待公布' : '先等主办方确认活动日期',
      steps: [], contact: '', contactLabel: '',
      note: announcementPast ? '此前公布的月份已过，请查看主办方最新安排。' : '具体日期、票务与公众入场要求尚未确认，暂不能据此报名或安排出行。',
      actionLabel: '打开活动预告' };
  }
  return result;
}

module.exports = participationFor;
module.exports.recordSignature = recordSignature;
