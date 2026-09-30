const KEY = 'youchong.privateDrafts.v1';
function platform() { return typeof wx === 'undefined' ? null : wx; }
function data() {
  const p = platform();
  if (!p || typeof p.getStorageSync !== 'function') throw new Error('无法读取本机草稿');
  const stored = p.getStorageSync(KEY);
  if (!stored) return {};
  if (typeof stored !== 'object' || Array.isArray(stored)) throw new Error('本机草稿无法读取');
  return JSON.parse(JSON.stringify(stored));
}
function read(owner) {
  try { const value = data()[owner]; return { value: value && value.version === 1 ? value : null }; }
  catch (error) { return { value: null, error: '本机草稿未能读取。新输入的内容会保留在当前页面，请检查存储空间。' }; }
}
function save(owner, value) {
  try {
    const p = platform();
    if (!owner || !p || typeof p.setStorageSync !== 'function') throw new Error('无法保存草稿');
    const stored = data();
    stored[owner] = Object.assign({ version: 1, savedAt: Date.now() }, value);
    p.setStorageSync(KEY, stored);
    return '';
  } catch (error) { return '本机草稿保存失败。内容仍在当前页面，请检查存储空间后重试保存。'; }
}
function clear(owner) {
  try { const stored = data(); delete stored[owner]; platform().setStorageSync(KEY, stored); return true; }
  catch (error) { return false; }
}
function clearAll() {
  try { const p = platform(); if (typeof p.removeStorageSync === 'function') p.removeStorageSync(KEY); else p.setStorageSync(KEY, {}); return true; }
  catch (error) { return false; }
}
module.exports = { KEY, read, save, clear, clearAll };
