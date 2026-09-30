'use strict';

function videoPath(url) {
  return String(url || '').replace(/^\/assets\/curated-video\/(\d+\.mp4)$/, '/media/clips/$1');
}
function videoPackage(url) {
  const match = /^\/(media[2-9]?)\/clips\/\d+\.mp4$/.exec(videoPath(url));
  return match ? match[1] : '';
}
function playerPath(url, id) {
  const root = videoPackage(url);
  return root && id ? '/' + root + '/pages/index?id=' + encodeURIComponent(id) : '';
}
function videoSource(platform, url) {
  const source = videoPath(url);
  // Loading another package does not grant the main page access to its assets.
  // A package video must be opened in that package's own player page.
  if (videoPackage(source)) return Promise.reject(new Error('请在视频播放页打开这段视频'));
  return Promise.resolve(source);
}
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
module.exports = { videoPath, videoPackage, playerPath, videoSource, photos, photoEvent, photoHeight };
