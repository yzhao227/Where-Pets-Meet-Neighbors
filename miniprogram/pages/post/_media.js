'use strict';

const contentPolicy = require('../../data/content-policy');

// Keep stale callers unable to resolve a retired attachment.
function playerPath() { return ''; }
function videoSource() { return Promise.reject(contentPolicy.videoError()); }
function photos(post, previous) {
  return (post.images || []).map((src, index) => {
    const old = previous && previous[index];
    return old && old.src === src ? old : { src, index, status: 'loading', attempt: 0 };
  });
}
function photoDimensions(detail) {
  const width = detail && detail.width, height = detail && detail.height;
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 && Number.isFinite(height / width) ? { width, height } : {};
}
function photoHeight(items, index) {
  const size = photoDimensions(items[index]);
  // Match the image's own proportions. Very tall images remain fully visible
  // within a portrait frame; ordinary landscape photos have no letterboxing.
  return size.width ? Math.min(150, 100 * (size.height / size.width)) : 75;
}
function photoEvent(items, event, status) {
  const data = event && event.currentTarget && event.currentTarget.dataset || {};
  const index = Number(data.index), attempt = Number(data.attempt);
  const item = items[index];
  if (!Number.isInteger(index) || !item || item.src !== data.src || item.attempt !== attempt || item.status !== 'loading') return items;
  const size = status === 'ready' ? photoDimensions(event.detail) : {};
  return items.map((value, i) => i === index ? Object.assign({}, value, size, { status }) : value);
}
module.exports = { playerPath, videoSource, photos, photoEvent, photoHeight };
