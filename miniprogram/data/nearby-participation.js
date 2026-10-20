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
  'event-kunxiu-lake-pet-carnival-2026': {
    evidenceSignature: '1095:988d79373fa25a2f',
    sourceUrl: 'https://mp.weixin.qq.com/s?__biz=MzI1MjY0NzEwNA==&mid=2247721719&idx=1&sn=67a45f65c765fe03702c4e3c8170051f&chksm=e8edc6fb9e46c39e532e6373a65f760140f08d8a218905db2db09cd91be0f352fa93fd784806&scene=27',
    state: 'guide', label: '先看游园攻略', title: '确认入场条件，按18日日程到昆秀湖',
    steps: [
      { title: '先确认票务与参赛条件', text: '官方攻略未列票价和报名入口；运动会晋级赛、收官战及走秀的参赛资格需另行确认。' },
      { title: '备好携宠用品', text: '携宠保持牵引，大犬戴嘴套，及时拾便。海选另外要求犬只登记证与疫苗证明，猫咪出行箱包与免疫记录；普通观众准入另询。' },
      { title: '按活动分区到场', text: '18日16:00—16:50主舞台闭幕式，17:00—18:00自由互动；17:40起停止新增交易，18:00结束。入口与停车按现场导视。' }
    ],
    note: '下方打开经开区官方攻略；具体时刻与流程以现场执行为准，未核实可现场参赛或剩余名额。',
    actionLabel: '查看游园攻略'
  },
  'event-petfair-asia-2027': {
    evidenceSignature: '546:144dc1e01142b7ac',
    sourceUrl: 'https://www.petfairasia.com/',
    state: 'pending', label: '展期已公布', title: '等待2027届观众开放与票务公告',
    steps: [],
    note: '8月18—22日是整体展期；公众开放日、每日时段及携宠条件待公布，暂不能据此报名。官网其他入口仍可能属于往届或外地系列展，请先核对年份与城市。',
    actionLabel: '查看展期预告'
  },
  'event-shanghai-pet-fashion-week-2026': {
    evidenceSignature: '1489:274e04e42a561eca',
    sourceUrl: 'https://jsj.top/f/P3iRYG',
    state: 'guide', label: '观秀免费预约', title: '选择观秀场次，填写限量通票预约表',
    steps: [
      { title: '每天最多选3场', text: '打开预约表，选择10月30日—11月1日场次并填写联系与身份信息；海报注明至11月1日、各场额满为止。' },
      { title: '携宠先读准入规则', text: '在表单登记是否携宠。携犬需养犬登记证、成年人牵引，大型犬戴嘴套；其他种类先咨询，阅读规则后自行确认。' },
      { title: '提前15分钟签到', text: '保存报名确认信息，按确认场次抵达；开幕式开场后不可入场。驾车停7号楼停车场，运动体验需另行核实。' }
    ],
    contactLabel: '观秀预约咨询', contact: '021-60708201',
    note: '链接来自杨浦区政府公告的观秀二维码；海报与表单个别场次时刻不同，以预约确认信息为准。免费范围为观秀预约，市集消费及其他体验另询，不保证余量。',
    actionLabel: '预约观秀'
  },
  'event-british-library-cats-2026': {
    evidenceSignature: '629:614fa43f357b66af',
    sourceUrl: 'https://www.library.sh.cn/activityDetail?id=252&code=199999',
    state: 'closed', label: '官网标记结束', title: '请先向馆方核实当前入场安排',
    steps: [], fee: '',
    note: '10月18日查阅时官方页面已显示“结束”，原列展期仍至10月18日，未公布最后入场时刻；本页暂不提供购票指引。',
    actionLabel: '查看官方说明'
  },
  'event-miaosheng-museum-2026': {
    evidenceSignature: '744:ee9a82757e4b8155',
    sourceUrl: 'https://news.qq.com/rain/a/20260709A09OQT00',
    label: '携猫提前预约', title: '到「喵生博物馆」公众号确认场次与携猫名额',
    steps: [
      { title: '先确认开放与票务', text: '通过官方公众号或咨询电话，核对当天开放、剧场排期及当前票价。7月公布的每天10:00—20:00安排供参考。' },
      { title: '携猫单独预约', text: '在「喵生博物馆」官方公众号提前预约携猫参观；确认名额及入场要求，适合能适应陌生环境的猫，由主人陪同。' },
      { title: '按预约指引到馆', text: '目的地是博成路850号世博展览馆北广场STATION X；具体入口和所需凭证按预约确认信息准备。' }
    ],
    contactLabel: '展馆公开咨询', contact: '021-68812361 / 4001351018',
    note: '尚未取得可直接跳转的购票或携猫预约链接；下方打开的是参观报道，余量和临时闭馆安排请先咨询。',
    actionLabel: '查看参观说明'
  },
  'event-ace-pet-zone-2026': {
    evidenceSignature: '942:1fe5d5f40eb13fd2',
    sourceUrl: 'https://www.jinantimes.com.cn/news-86-11053218.html',
    label: '持票提前预约', title: '宠物预约审核通过后，从6号门入园',
    steps: [
      { title: '准备当日票与两证', text: '上海市9个月—10岁非烈性犬，需免疫证、养犬登记证；每张当日赛票可申请预约1只犬。' },
      { title: '提前申请，等短信确认', text: '通过赛事官方渠道核实宠物预约入口，上传两证并等待审核。截止时刻以系统为准；买票不等于宠物预约成功。' },
      { title: '从6号门安检入场', text: '带好赛票、宠物预约码及两证原件；犬只戴嘴套、牵引绳不超过1.5米，通过健康检查后进入专区。' }
    ],
    note: '宠物预约直接链接尚未核实；请勿将已结束的4—6日犬赛报名入口用于日常专区预约。',
    actionLabel: '查看预约说明'
  },
  'event-shanghai-turtle-expo-2026': {
    evidenceSignature: '1050:3bddb5bf47b8f8b3',
    sourceUrl: 'https://www.df962388.com/yanchu/436422.html',
    state: 'closed', label: '已过末场时段', title: '本场参与指引已关闭',
    steps: [], fee: '', contact: '', contactLabel: '',
    note: '转载须知所载末场于12日14:00结束、13:00停止入场；请勿再按本场购票或出发。官方展期按日期保留，后续活动需另行确认。',
    actionLabel: '查看往期须知'
  },
  'event-dingfeng-pets-2026': {
    evidenceSignature: '628:f69e105c8ef806ec',
    sourceUrl: 'https://finance.sina.com.cn/wm/2026-09-29/doc-initnscx7762391.shtml',
    label: '公众号报名', title: '到「鼎丰酱园」公众号选择场次',
    steps: [
      { title: '找到公众号', text: '在微信搜索并关注「鼎丰酱园」。' },
      { title: '进入报名菜单', text: '点底部菜单「酱子好玩」→「萌爪派对」。' },
      { title: '确认10月3日场次', text: '查看手作、宠物走秀及趣味运动安排，确认余量及携宠要求后报名。' }
    ],
    fee: '10月1—3日活动免费，市集消费另计。',
    note: '小课堂、摊主及志愿者原要求「9月30日前报名」，这不是整个生活节的统一截止时间；10月2日两场小课堂已结束，10月3日安排仍可通过公众号查询。',
    actionLabel: '查看报名指引'
  },
  'event-shenlong-pet-adventure-2026': {
    evidenceSignature: '1072:d5c294e0ce62e9c2',
    sourceUrl: 'https://zhuanlan.zhihu.com/p/2086510398522639051',
    label: '先咨询园方', title: '今晚先确认开放，再安排入园',
    steps: [
      { title: '先问晚间是否开放', text: '10月7日16:00—17:00核心赛事已过公告时段；向园方确认今晚是否仍接待、最晚入园与闭园时间。' },
      { title: '确认今晚可参与内容', text: '原公告预告18:00后晚间内容；具体项目、票务、是否预约与携宠条件需另询，不保证仍可参赛。' }
    ],
    fee: '原公告报价198元/宠，含3人陪同；晚间票务、项目收费及无宠游客费用另询园方。',
    contactLabel: '园方咨询', contact: '18930760079',
    note: '不同公告中的门牌不一致，请同时核对实际入口和停车安排。',
    actionLabel: '查看活动公告'
  },
  'event-longhua-pet-cruise-2026': {
    evidenceSignature: '607:7b96452d98e6b841',
    sourceUrl: 'https://news.qq.com/rain/a/20260929A0BPRQ00',
    label: '先咨询运营方', title: '向浦江游览集团确认宠物友好班次',
    steps: [
      { title: '询问指定航班', text: '国庆10月1—7日每天下午一班；确认当日时刻、票价与购票渠道。' },
      { title: '确认登船要求', text: '核对携宠条件和登船位置，再安排出发。普通航班不适用这条携宠信息。' }
    ],
    note: '尚未取得直接购票链接与公开电话。犬赛赠票抽奖已仅作历史说明，对应犬赛6日18:00结束；宠物航班继续至7日，岸边市集为另一场活动。',
    actionLabel: '查看航班公告'
  },
  'event-monaco-dog-show-2026': {
    evidenceSignature: '1511:770321dc3022267e',
    sourceUrl: 'https://www.shobserver.com/sgh/detail?id=4061174',
    label: '两步预约', title: '赛事缴费后，还需完成宠物入园登记',
    steps: [
      { title: '先核对预约日期', text: '比赛日前两天23:59截止：4、5、6日场次对应10月2、3、4日。4、5日场次已过公告截止；余量与最新安排以官方系统为准。' },
      { title: '完成赛事缴费', text: '打开下方报名指引，按公告二维码前往久事体育APP，核对比赛日期、犬只条件及名额后缴费。' },
      { title: '完成宠物入园登记', text: '再按公告二维码进入「久事文传」微信小程序，上传免疫证、养犬登记证；仅缴费不算报名成功。参赛另需有效检疫证明。' }
    ],
    note: '场地为2号馆北侧草坪；报到时刻按预约通知。普通观众票务及携犬规则另询；不保证余位、补报或现场报名。',
    actionLabel: '查看报名指引'
  },
  'event-baijia-pet-market-2026': {
    evidenceSignature: '1012:7b6d38ac12efa6b0',
    sourceUrl: 'https://www.jinshan.gov.cn/shfw-bmxx/20260928/878981.html',
    label: '按项目参加', title: '音乐会和时装秀可现场观看',
    steps: [
      { title: '选10月3日场次', text: '主舞台时装秀10:00—11:00、音乐会13:00—13:30，可现场观看；10月2日场次已结束。' },
      { title: '体验先问招募', text: '库尔辛挑战、丛林探险及林下瑜伽属于前期招募；补报、费用和携宠条件需询工作人员，不能直接当作现场报名。' },
      { title: '按指引停车入场', text: '查看公告中的高桥路、白玉兰路石水路入口示意图，按工作人员指引停车或候乘接驳，再前往主舞台。' }
    ],
    fee: '公告未明确观众票价及体验费用；现场观看不等于所有项目免费。',
    note: '荡里路施工封路，林下停车场主舞台区不能停车。摊主招募已截止；10月1日的交友派对与数字油画体验已结束。',
    actionLabel: '查看游玩指南'
  },
  'event-changtan-langhua-market-2026': {
    evidenceSignature: '1221:4d75dd57515050bf',
    sourceUrl: 'https://finance.sina.com.cn/wm/2026-09-29/doc-initnfqc7877861.shtml',
    label: '按市集安排参加', title: '萌宠派对已结束，市集至6日20:00',
    steps: [
      { title: '留意市集结束时间', text: '市集10月6日14:00—20:00；5日萌宠派对已结束，不再提供该场次报名。' },
      { title: '确认当天携宠范围', text: '市集设宠物友好区域，具体边界、宠物种类、牵引和健康要求需现场确认；5日派对条件不直接适用于其他时段。' },
      { title: '安排停车与入场', text: '官方指引列出宝杨码头地下停车场、子青路停车点或海上世界停车场；停车费自理，入场按当天现场指引。' }
    ],
    fee: '市集免费参与，购物与其他消费另计；5日派对和晚宴已结束。',
    note: '未核实到派对加场或延期公告；请勿按5日节目安排出行。',
    actionLabel: '查看市集指引'
  },
  'event-m515-camping-2026': {
    evidenceSignature: '775:1ec8145b81bed357',
    sourceUrl: 'https://www.shobserver.com/sgh/detail?id=4066166',
    label: '先确认主题场次', title: '先确认「萌友同乐日」，再安排出行',
    steps: [
      { title: '选择当天节目', text: '露营季为10月1—7日，萌宠主题对应日期、场次和活动区域需向M515园区确认。' },
      { title: '确认费用与携宠', text: '先问入园、露营和体验费用及预约方式；自带宠物需另外确认准入要求。' }
    ],
    note: '尚未取得直接报名链接或公开咨询电话；晚间光影秀不代表萌宠活动时段。',
    actionLabel: '查看活动攻略'
  },
  'event-cpark-lifestyle-2026': {
    evidenceSignature: '780:7a8c69e7cacee139',
    sourceUrl: 'https://feng.ifeng.com/c/8wqULdudONJ',
    label: '先确认体验安排', title: '选好游园时段，再确认项目与携宠条件',
    steps: [
      { title: '选择到场时段', text: '10月17—18日每天10:00—21:00，C·PARK海粟文化广场户外草坪。' },
      { title: '确认入场与体验', text: '票务、各体验费用和预约要求未明确；可查看绘画、共读、乐队与亲子运动安排，参加前向现场服务台确认。' },
      { title: '携宠需先询问', text: '最新节目以亲子家庭为主，尚未明确宠物活动或携宠入场条件，不能直接按可带宠安排。' }
    ],
    note: '公告介绍现场领取打卡地图与互动集章；赠品、奖品及具体体验以现场条件为准，不承诺全部免费或有余量。',
    actionLabel: '查看活动攻略'
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
  if (guide && ['公众号报名', '先咨询园方', '先咨询运营方', '两步预约'].includes(guide.label)) result.state = 'guide';
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
