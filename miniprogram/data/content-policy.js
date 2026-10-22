'use strict';

// This is a package-wide capability, not an account or review-mode setting.
// Historical records stay on the device; readers simply do not expose them.
const videoEnabled = false;
const isVideoPost = record => !!(record && (record.video || record.contentType === 'video'));
const isVideoUpload = record => !!(record && (record.mediaType === 'video' || record.video || record.extension === 'mp4'));
const videoError = () => Object.assign(new Error('当前仅支持文字和图片，请移除不支持的附件'), { code: 'VIDEO_DISABLED' });
function assertVideoAllowed() { if (!videoEnabled) throw videoError(); }
function assertRequest(action, payload) {
  if (action === 'createPost' && isVideoPost(payload) || action === 'createUploadTicket' && isVideoUpload(payload)) assertVideoAllowed();
}

module.exports = Object.freeze({ videoEnabled, isVideoPost, isVideoUpload, videoError, assertVideoAllowed, assertRequest });
