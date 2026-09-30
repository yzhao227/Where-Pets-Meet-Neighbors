const TYPES = [
  { id: 'cat', name: '猫' },
  { id: 'dog', name: '狗' },
  { id: 'rabbit', name: '兔子' },
  { id: 'small-mammal', name: '仓鼠与小型哺乳宠物' },
  { id: 'bird', name: '鸟' },
  { id: 'fish', name: '鱼' },
  { id: 'reptile', name: '爬行动物' },
  { id: 'amphibian', name: '两栖动物' },
  { id: 'invertebrate', name: '虾、螺与无脊椎宠物' },
  { id: 'other', name: '其他动物' }
];
const IDS = TYPES.map(item => item.id);
function normalize(value) {
  return Array.isArray(value) ? [...new Set(value.filter(id => IDS.includes(id)))] : [];
}
function choices(selected) {
  const ids = normalize(selected);
  return TYPES.map(item => ({ ...item, selected: ids.includes(item.id) }));
}
module.exports = { TYPES, IDS, normalize, choices };
