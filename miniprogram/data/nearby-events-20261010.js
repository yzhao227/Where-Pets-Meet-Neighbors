'use strict';

// Day-only exhibition dates do not establish daily opening hours.
module.exports = [{
  id: 'event-british-library-cats-2026', type: 'exhibition', title: '大英图书馆·奇喵史',
  city: '上海', district: '浦东新区', area: '图书馆东馆', categoryLabel: '猫咪文化 · 艺术展览',
  venue: '上海图书馆东馆一楼2号展厅', address: '上海市浦东新区迎春路300号 · 一楼2号展厅',
  hostName: '上海图书馆、MUSEUM BOX',
  startsAt: '2026-06-27T00:00:00+08:00', endsAt: '2026-10-19T00:00:00+08:00', datePrecision: 'day',
  dateLabel: '原列展期6月27日—10月18日 · 官网已标记结束',
  ticketText: '60元起 · 以所选票种为准', feeType: 'paid',
  summary: '从猫咪的演化、人猫共生到文学艺术，逛一场跨越历史的猫文化展。',
  noPetRequired: true, visitWithoutPet: true, playTags: ['exhibition'], petPlayTags: [],
  visitAdvice: '官网已标记结束，当前入场安排请先向馆方确认；本场暂停购票指引，如获确认可入场，请不带宠参观。',
  petPolicy: { status: 'not_allowed', text: '东馆须知禁止携带猫、狗等动物，导盲犬、军警犬除外；请不带宠参观。' },
  needsRecheck: true,
  notice: '10月18日查阅时，官网已标记“结束”，原列展期仍至10月18日；当前入场与最后开放时刻请向馆方确认，暂不提供购票指引。',
  highlights: [
    '了解猫咪随人类迁徙的历史，以及文学、绘画和音乐中的猫形象。展品含复刻件。',
    '地铁18号线迎春路站4号口或2号线科技馆站3号口；驾车入口为合欢路300号。'
  ],
  sources: [
    { publisher: '上海图书馆', title: '大英图书馆·奇喵史 (MEOW, CATS! @ THE BRITISH LIBRARY)', url: 'https://www.library.sh.cn/activityDetail?id=252&code=199999', publishedAt: '', checkedAt: '2026-10-18' },
    { publisher: '上海图书馆', title: '读者须知 · 东馆总则', url: 'https://www.library.sh.cn/guide/xuzhi', publishedAt: '', checkedAt: '2026-10-10' }
  ]
}];
