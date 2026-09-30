const TOPICS = ['饮食喂养', '行为观察', '健康护理', '居家布置', '户外出行', '成长记录', '治愈瞬间', '陪伴日常'];
const ALIASES = {
  '宠物治愈时刻': '治愈瞬间', '新手养宠': '健康护理',
  '一起散步': '户外出行', '没养宠也能来': '陪伴日常',
  '宠物友好去处': '户外出行', '养宠经验': '成长记录'
};
const normalizeTopic = value => typeof value !== 'string' ? '' : TOPICS.includes(value) ? value : Object.prototype.hasOwnProperty.call(ALIASES, value) ? ALIASES[value] : '';
const normalize = values => Array.isArray(values) ? [...new Set(values.map(normalizeTopic).filter(Boolean))] : [];
Object.defineProperties(TOPICS, {
  ALIASES: { value: ALIASES }, normalizeTopic: { value: normalizeTopic }, normalize: { value: normalize }
});
module.exports = TOPICS;
