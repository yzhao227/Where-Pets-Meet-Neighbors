const CIRCLE_VERSION = '2026-09-29-eight-circles';
const CIRCLES = [
  { id: 'circle-neighbors', name: '爱宠邻里', description: '聊陪伴、分享相处的小事；暂时没养宠，也可以在这里认识同好。', accent: '#EF725B', icon: '邻' },
  { id: 'circle-cats', name: '猫咪慢生活', description: '猫咪的日常、行为与照护，一起读懂每一声喵。', accent: '#9A88BD', icon: '猫' },
  { id: 'circle-walks', name: '汪星人日常', description: '聊狗狗的生活习惯、友善互动和每日散步。', accent: '#79A6BE', icon: '汪' },
  { id: 'circle-small-pets', name: '小宠乐园', description: '兔子、仓鼠、豚鼠与小型哺乳宠物，记录小小身体的大大日常。', accent: '#B39B71', icon: '小' },
  { id: 'circle-birds', name: '羽毛朋友', description: '观察宠物鸟的鸣叫、互动和生活环境，分享羽毛朋友的日常。', accent: '#7DA58C', icon: '羽' },
  { id: 'circle-aquatics', name: '水族日记', description: '鱼、虾、螺与水草造景，交流水族照护和缸里的小发现。', accent: '#75A7B5', icon: '水' },
  { id: 'circle-exotics', name: '异宠观察', description: '龟、蜥蜴及其他特别的宠物；按动物种类选择自己想看的内容。', accent: '#92A879', icon: '异' },
  { id: 'circle-beginners', name: '新手养宠', description: '从准备迎接到日常照护，分享实用问题和有依据的养宠知识。', accent: '#C19483', icon: '新' }
];
function createCircles(userId) {
  return CIRCLES.map(circle => ({ ...circle, memberIds: circle.id === 'circle-neighbors' && userId ? [userId] : [] }));
}
function syncCircles(state) {
  if (state.circleCatalogVersion === CIRCLE_VERSION) return false;
  for (const template of CIRCLES) {
    const existing = state.circles.find(circle => circle.id === template.id);
    if (existing) Object.assign(existing, template);
    else state.circles.push({ ...template, memberIds: [] });
  }
  state.circleCatalogVersion = CIRCLE_VERSION;
  return true;
}
module.exports = { CIRCLES, CIRCLE_VERSION, createCircles, syncCircles };
