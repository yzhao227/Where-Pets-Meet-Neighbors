const s = require('../_shared');
const topics = require('../../data/topics');
const descriptions = {
  '饮食喂养': '食物选择、喂养习惯与日常饮水',
  '行为观察': '读懂动作、习性与相处方式',
  '健康护理': '清洁护理与日常健康观察',
  '居家布置': '生活空间、用品与居家环境',
  '户外出行': '外出准备、散步与携宠安排',
  '成长记录': '不同成长阶段的变化与记录',
  '治愈瞬间': '动物影像与温暖的小片刻',
  '陪伴日常': '人与动物相伴的生活记录'
};

s.register({
  data: { topics: topics.map((name, index) => ({ id: name, name, number: String(index + 1).padStart(2, '0'), description: descriptions[name] || '' })) },
  onLoad() { this._hidden = false; },
  onShow() { this._hidden = false; },
  onHide() { this._hidden = true; },
  openTopic(e) {
    if (s.personalMode || this._closed || this._hidden) return;
    const topic = topics.normalizeTopic(e.currentTarget.dataset.id);
    if (topic) s.go('/pages/circle/index?topic=' + encodeURIComponent(topic));
  },
  onShareAppMessage() { return s.shareCard('有宠有邻｜主题指南', '/pages/circle-square/index'); },
  onShareTimeline() { return s.shareTimeline('有宠有邻｜主题指南'); }
});
