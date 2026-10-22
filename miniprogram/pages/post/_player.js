'use strict';

// Compatibility guard for stale local URLs. No player route is registered or
// included in the upload package, and this controller never reads old media.
module.exports = function createUnavailablePlayer() {
  return {
    data: { loading: false, error: '内容已下架', videoSource: '' },
    onLoad() {},
    onShow() {},
    onHide() {},
    onUnload() {},
    refresh() {},
    retryVideo() {}
  };
};
