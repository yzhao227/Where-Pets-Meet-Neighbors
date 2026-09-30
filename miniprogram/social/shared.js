const s = require('../pages/_shared');
let serial = 0;

function requestId(prefix) {
  serial += 1;
  return prefix + '-' + Date.now().toString(36) + '-' + serial.toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}
function safeImage(value) {
  if (s.httpsUrl(value)) return value;
  if (typeof value !== 'string' || /[\s\\<>"\u0000-\u001f\u007f]/.test(value)) return '';
  if (/^\/assets\/[a-zA-Z0-9_./-]+$/.test(value) && !value.split('/').includes('..')) return value;
  return /^cloud:\/\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_./%()-]+$/.test(value) && !value.split('/').includes('..') ? value : '';
}
function person(value, failedImages) {
  const source = value || {};
  const nickname = typeof source.nickname === 'string' && source.nickname.trim() || '宠友';
  const avatarUrl = safeImage(source.avatar);
  return { id: source.id || '', nickname, avatarUrl: failedImages && failedImages[source.id] === avatarUrl ? '' : avatarUrl,
    initial: Array.from(nickname)[0], friendStatus: source.friendStatus || 'none' };
}
function chatMessage(value, failedImages) {
  return { id: value.id, seq: value.seq, text: value.text || '', createdAt: value.createdAt,
    isMine: !!value.isMine, sender: person(value.sender, failedImages),
    timeText: Number.isFinite(value.createdAt) && value.createdAt > 0 ? s.dateText(value.createdAt) : '' };
}
function mergeMessages(items) {
  const byId = new Map();
  items.forEach(item => { if (item && item.id) byId.set(item.id, item); });
  return Array.from(byId.values()).sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
}
function openChat(conversation) {
  if (!conversation || !conversation.id) throw new Error('会话暂时无法打开，请重试');
  s.go('/social/pages/chat/index?id=' + encodeURIComponent(conversation.id));
}
module.exports = { requestId, safeImage, person, chatMessage, mergeMessages, openChat };
