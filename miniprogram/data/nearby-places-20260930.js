// Official pages reviewed on 2026-09-30. Desk research only: no visited claims,
// fabricated coordinates, pet admission, performances or interaction promises.
const checkedAt = '2026-09-30';
const source = (publisher, title, url) => ({ publisher, title, url, publishedAt: '', checkedAt });
module.exports = [
  {
    id: 'place-shanghai-zoo', type: 'place', title: '上海动物园', city: '上海', district: '长宁区', area: '虹桥路沿线',
    address: '上海市虹桥路2381号 · 上海动物园', categoryLabel: '野生动物观察', placeKind: 'culture', feeType: 'paid',
    summary: '看看园中的野生动物，留出一段安静观察的时间；建议不带宠前往。',
    dateLabel: '售票及购票入园：3—10月 08:00—17:00；11—2月 08:00—16:30',
    ticketText: '成人票40元，其他票种与优惠以园方公告为准',
    petPolicy: { status: 'unknown', text: '尚未核实携宠规则，请按不带宠参观安排；不要把动物展示场所理解为宠物互动空间。' },
    noPetRequired: true, visitWithoutPet: true, playTags: ['exhibition'], petPlayTags: [],
    visitAdvice: '按园方指引观察野生动物，留意现场开放区域；不安排宠物互动。',
    highlights: ['官网介绍园内有约470种野生动物；本页收录自然观察场所，不提供宠物接触或互动承诺。',
      '官方参观指南列出地铁10号线上海动物园站1号出口。停车位紧张，园方建议公共交通出行。',
      '所列时间为官网售票及购票游客入园时段，临时安排以当天园方公告为准。',
      '地址已核实，具体导航坐标和其他入口未核实。'],
    sources: [source('上海动物园', '上海动物园介绍', 'https://www.shanghaizoo.cn/sites/shanghaizoo/contentA.ashx'),
      source('上海动物园', '参观指南：交通、票价与开放安排', 'https://www.shanghaizoo.cn/sites/shanghaizoo/zhinan.ashx')]
  },
  {
    id: 'place-shanghai-natural-history-museum', type: 'place', title: '上海自然博物馆', city: '上海', district: '静安区', area: '北京西路沿线',
    address: '上海市北京西路510号 · 静安雕塑公园内', categoryLabel: '不带宠看自然', placeKind: 'culture', feeType: 'paid',
    summary: '走进自然博物馆看看生命与自然；馆内明确禁止携带宠物。',
    dateLabel: '09:00—17:00，16:00停止入馆；周二闭馆（国定假日除外）',
    ticketText: '成人票30元；线上实名购票，现场凭身份证入馆',
    petPolicy: { status: 'not_allowed', text: '官方参观须知明确禁止携带宠物，请不带宠物入馆。' },
    noPetRequired: true, visitWithoutPet: true, playTags: ['exhibition'], petPlayTags: [],
    visitAdvice: '先核对开放日期并完成实名购票，带好身份证，16:00前入馆。',
    highlights: ['官方参观须知列明开放时间为09:00—17:00，16:00停止入馆；周二闭馆，国定假日除外。',
      '使用线上实名购票，参观时携带本人身份证；具体票种和优惠以官方当日信息为准。',
      '可参考地铁13号线自然博物馆站；馆内没有公众停车场。',
      '场馆位于静安雕塑公园内，馆内禁宠规定不能反向推断周边所有公共空间的规则。'],
    sources: [source('上海自然博物馆', '参观须知', 'https://www.snhm.org.cn/cgfw/cgzx.htm')]
  },
  {
    id: 'place-changfeng-ocean-world', type: 'place', title: '长风海洋世界', city: '上海', district: '普陀区', area: '长风公园',
    address: '上海市大渡河路451号 · 长风海洋世界', categoryLabel: '水生动物观察', placeKind: 'culture', feeType: 'unknown',
    summary: '了解水族、企鹅与珊瑚等展区；先向场馆确认当天开放、票务和参观安排。',
    dateLabel: '开放时段待向场馆确认', ticketText: '现行票价与购票方式待确认',
    petPolicy: { status: 'unknown', text: '尚未取得现行携宠规则，建议不带宠参观，行前向场馆确认。' },
    noPetRequired: true, visitWithoutPet: true, playTags: ['exhibition'], petPlayTags: [], needsRecheck: true,
    visitAdvice: '先确认当天开放时间、票价与展区安排，不把旧资料中的表演或互动作为出行承诺。',
    notice: '公开介绍中的开放时段不一致，出发前请向场馆确认；票价与携宠规则也待核实。',
    highlights: ['上海市文旅部门的景点介绍确认地址为大渡河路451号，可参考地铁15号线长风公园站。',
      '同部门另一篇介绍提及水族、企鹅与珊瑚等展区；当天实际展区以场馆公告为准。',
      '两篇公开介绍分别列出08:30—17:00与09:30—18:00，本页不把任一时段当作已经确认的现行开放时间。',
      '未核实现行票价、携宠规定、表演时刻或动物互动项目，不据旧网页作保证。'],
    sources: [source('上海市文化和旅游局', '长风公园、长风海洋世界景区介绍', 'https://www.meet-in-shanghai.net/cn/attraction/shanghai-changfeng-park-and-changfeng-ocean-world-scenic-area-750928/'),
      source('上海市文化和旅游局', '长风公园、长风海洋世界旅游景点资料', 'https://www.meet-in-shanghai.net/cn/tourist-attraction/shanghai-changfeng-park-changfeng-ocean-world-scenic-area-725039/')]
  }
];
