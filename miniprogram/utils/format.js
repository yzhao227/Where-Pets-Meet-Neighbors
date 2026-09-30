const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const pad = value => String(value).padStart(2, '0');
function timeLabel(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '时间待确认';
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}
function eventTime(value, endAt) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '时间待确认';
  const day = (date.getMonth() + 1) + '月' + date.getDate() + '日 周' + WEEK[date.getDay()];
  return day + ' · ' + timeLabel(value) + (endAt ? '–' + timeLabel(endAt) : '');
}
function relativeTime(value, now) {
  const time = Number(value);const delta = (Number(now) || Date.now()) - time;
  if (!Number.isFinite(time)) return '';
  if (delta < 60000) return '刚刚';
  if (delta < 3600000) return Math.floor(delta / 60000) + '分钟前';
  if (delta < 86400000) return Math.floor(delta / 3600000) + '小时前';
  if (delta < 604800000) return Math.floor(delta / 86400000) + '天前';
  const d = new Date(time);return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
function petPolicyLabel(value) {
  return { none: '无需带宠', optional: '带不带宠都欢迎', dog: '需要带犬' }[value] || '查看参与条件';
}
function decoratePost(post) { return Object.assign({}, post, { timeText: relativeTime(post.createdAt) }); }
function decorateComment(comment) { return Object.assign({}, comment, { timeText: relativeTime(comment.createdAt) }); }
function decorateMessage(message) { return Object.assign({}, message, { timeText: relativeTime(message.createdAt) }); }
function decorateEvent(event) {
  const now=Date.now();
  return Object.assign({}, event, {
    timeText:eventTime(event.startAt,event.endAt),petPolicyText:petPolicyLabel(event.petPolicy),
    statusText:event.status==='cancelled'?'已取消':event.endAt<=now?'已结束':event.startAt<=now?'进行中':event.attendeeCount>=event.capacity?'已满员':'可报名',
    spotsLeft:Math.max(0,event.capacity-event.attendeeCount)
  });
}
module.exports={relativeTime,timeLabel,eventTime,petPolicyLabel,decoratePost,decorateEvent,decorateComment,decorateMessage};
