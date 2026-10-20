const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { refresh } = require('../miniprogram/services/devtools-tabbar');
const { tabBar } = require('../miniprogram/app.json');

const root = path.resolve(__dirname, '../miniprogram');

function devtools(overrides = {}) {
  return {
    getDeviceInfo: () => ({ platform: 'devtools' }),
    getFileSystemManager: () => ({
      readFileSync: (file, encoding) => fs.readFileSync(path.join(root, file), encoding)
    }),
    setTabBarItem: options => options.success(),
    ...overrides
  };
}

test('phone platforms and the browser preview keep native icons without accessing files or tab items', async () => {
  for (const device of ['ios', 'android', 'windows', 'mac', 'devtools']) {
    const effects = { files: 0, items: 0 };
    const result = await refresh(devtools({
      __preview: device === 'devtools',
      getDeviceInfo: () => ({ platform: device }),
      getFileSystemManager() { effects.files += 1; throw new Error('must not read files'); },
      setTabBarItem() { effects.items += 1; }
    }));
    assert.equal(result, false, device);
    assert.deepEqual(effects, { files: 0, items: 0 }, device);
  }
});

test('DevTools uses the packaged normal and selected PNG bytes for every native tab', async () => {
  for (const legacy of [false, true]) {
    const items = [];
    const reads = [];
    const platform = devtools({
      getFileSystemManager: () => ({
        readFileSync(file, encoding) {
          reads.push(file);
          assert.equal(encoding, 'base64');
          return fs.readFileSync(path.join(root, file), encoding);
        }
      }),
      setTabBarItem(options) {
        const { success, fail, ...item } = options;
        assert.equal(typeof success, 'function');
        assert.equal(typeof fail, 'function');
        assert.deepEqual(Object.keys(item).sort(), ['iconPath', 'index', 'selectedIconPath']);
        items.push(item);
        queueMicrotask(success);
      }
    });
    if (legacy) {
      delete platform.getDeviceInfo;
      platform.getSystemInfoSync = () => ({ platform: 'devtools' });
    }
    assert.equal(await refresh(platform), true);
    assert.deepEqual(items.map(item => item.index), tabBar.list.map((item, index) => index));
    assert.deepEqual(reads, tabBar.list.flatMap(item => [item.iconPath, item.selectedIconPath]));
    for (const item of items) {
      for (const key of ['iconPath', 'selectedIconPath']) {
        assert.match(item[key], /^data:image\/png;base64,/);
        const actual = Buffer.from(item[key].slice('data:image/png;base64,'.length), 'base64');
        assert.deepEqual(actual, fs.readFileSync(path.join(root, tabBar.list[item.index][key])));
      }
    }
  }
});

test('unavailable APIs, file errors and native update failures settle without rejecting startup', async () => {
  let updates = 0;
  let reads = 0;
  const partialReadFailure = devtools({
    getFileSystemManager: () => ({
      readFileSync(file, encoding) {
        if (++reads === 3) throw new Error('file temporarily unavailable');
        return fs.readFileSync(path.join(root, file), encoding);
      }
    }),
    setTabBarItem() { updates += 1; }
  });
  assert.equal(await refresh(partialReadFailure), false);
  assert.equal(updates, 0, 'prepare all icon bytes before changing any tab');

  const platforms = [
    undefined,
    devtools({ setTabBarItem: undefined }),
    devtools({ getDeviceInfo() { throw new Error('device API unavailable'); } }),
    devtools({ getFileSystemManager: undefined }),
    devtools({ setTabBarItem() { throw new Error('native bridge unavailable'); } }),
    devtools({ setTabBarItem: options => queueMicrotask(() => options.fail({ errMsg: 'tabbar not ready' })) })
  ];
  for (const platform of platforms) assert.equal(await refresh(platform), false);
  assert.equal(await refresh(devtools()), true, 'a later app show can recover after an earlier failure');
});
