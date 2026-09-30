const animals = require('./animal-types');
const KEY = 'youchong.feedAnimalPreferences.v1';
function read(platform) {
  try {
    const saved = platform && typeof platform.getStorageSync === 'function' ? platform.getStorageSync(KEY) : null;
    return { excludedAnimalTypes: animals.normalize(saved && saved.excludedAnimalTypes), error: '' };
  } catch (_) { return { excludedAnimalTypes: [], error: '暂时无法读取浏览偏好，可以重新选择。' }; }
}
function save(platform, excludedAnimalTypes) {
  try {
    if (!platform || typeof platform.setStorageSync !== 'function') throw new Error('storage unavailable');
    platform.setStorageSync(KEY, { version: 1, excludedAnimalTypes: animals.normalize(excludedAnimalTypes) });
    return '';
  } catch (_) { return '偏好暂未保存，当前选择仍有效，重新打开后请再检查。'; }
}
module.exports = { KEY, read, save };
