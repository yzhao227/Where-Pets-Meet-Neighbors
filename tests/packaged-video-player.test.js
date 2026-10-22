'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const playerFile = path.resolve(__dirname, '../miniprogram/pages/post/_player.js');
const createPlayer = fs.existsSync(playerFile) ? require(playerFile) : null;
const product = require('../miniprogram/product');
const app = require('../miniprogram/app.json');
const project = require('../project.config.json');

test('stale player controllers cannot fetch, copy or play historical video files', () => {
  if (!createPlayer) return assert.ok(project.packOptions.ignore.some(entry => entry.value === 'pages/post/_player.js'));
  for (const root of ['media', 'media2', 'media3']) {
    const page = createPlayer(root);
    assert.equal(page.data.videoSource, '');
    assert.match(page.data.error, /已下架/);
    for (const action of ['onLoad', 'onShow', 'refresh', 'retryVideo', 'onHide', 'onUnload']) page[action]({ id: 'video-commons-112285953' });
    assert.equal(page.data.videoSource, '');
    assert.equal(page.data.loading, false);
  }
});

test('video routes and assets are excluded from every shipped product scope', () => {
  for (const root of ['media', 'media2', 'media3']) {
    const route = root + '/pages/index';
    assert.equal(product.allowsNavigation('/' + route + '?id=historical-video'), false);
    assert.equal(product.PERSONAL_PAGES.includes(route), false);
    assert.equal(product.COMMUNITY_PAGES.includes(route), false);
    assert.equal(app.subPackages.some(pkg => pkg.root === root), false);
    assert.ok(project.packOptions.ignore.some(entry => entry.type === 'folder' && entry.value === root));
  }
  assert.ok(project.packOptions.ignore.some(entry => entry.type === 'file' && entry.value === 'pages/post/_player.js'));
  assert.equal(project.packOptions.include.some(entry => /media|_player|curated-poster/.test(entry.value)), false);
});

test('the project check rejects accidentally repackaging retired video assets', () => {
  const projectFile = path.resolve(__dirname, '../project.config.json');
  const invalid = structuredClone(project);
  invalid.packOptions.ignore = invalid.packOptions.ignore.filter(entry => entry.value !== 'media');
  const errors = [], processState = { exitCode: 0 };
  const checker = path.resolve(__dirname, '../scripts/check-project.js');
  vm.runInNewContext(fs.readFileSync(checker, 'utf8'), {
    __dirname: path.dirname(checker), process: processState,
    console: { log() {}, error(value) { errors.push(value); } },
    require(name) {
      if (name !== 'node:fs') return require(name);
      return { ...fs, readFileSync(file, options) { return path.resolve(String(file)) === projectFile ? JSON.stringify(invalid) : fs.readFileSync(file, options); } };
    }
  }, { filename: checker });
  assert.equal(processState.exitCode, 1);
  assert.ok(errors.some(value => value.includes('视频已停用，上传包必须排除')));
});
