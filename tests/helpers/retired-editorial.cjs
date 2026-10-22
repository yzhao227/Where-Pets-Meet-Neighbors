'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const project = require('../../project.config.json');
function isRetiredAsset(file) {
  const relative = file.replace(/^miniprogram\//, '');
  return file.startsWith('miniprogram/') && (project.packOptions.ignore || []).some(entry => entry.type === 'folder'
    ? relative === entry.value || relative.startsWith(entry.value + '/')
    : entry.type === 'file' && relative === entry.value);
}
// Local archives remain verifiable, while independent upload candidates must
// omit those retired assets. A missing active asset is always an error.
function hasReviewAsset(file) {
  if (fs.existsSync(path.join(root, file))) return true;
  assert.equal(isRetiredAsset(file), true, 'missing active review asset: ' + file);
  return false;
}
module.exports = { isRetiredAsset, hasReviewAsset };
