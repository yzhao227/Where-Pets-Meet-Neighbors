const choices = [
  { id: 'public', name: '公开', hint: '所有人可见' },
  { id: 'friends', name: '仅好友可见', hint: '你和已确认的好友可见，关注关系不算好友' },
  { id: 'private', name: '仅自己可见', hint: '只有你能查看，不向其他人展示' }
];
function selected(value) {
  return choices.find(item => item.id === value) || choices[value === undefined ? 0 : 2];
}
module.exports = { choices, selected };
