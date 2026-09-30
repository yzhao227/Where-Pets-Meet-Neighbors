'use strict';
function mediaRange(header, length) {
  if (!Number.isSafeInteger(length) || length < 1) return null;
  if (header === undefined) return { start: 0, end: length - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2]) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  let end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= length) return null;
  return { start, end, partial: true };
}
module.exports = { mediaRange };
