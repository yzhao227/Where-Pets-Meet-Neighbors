// DevTools 2.02 can render its native tab bar before its image server URL is
// ready. Read the same packaged icons directly; phones keep app.json paths.
const names = ['community', 'nearby', 'messages', 'me'];

async function refresh(platform) {
  if (!platform || platform.__preview || typeof platform.setTabBarItem !== 'function') return false;
  try {
    const device = typeof platform.getDeviceInfo === 'function'
      ? platform.getDeviceInfo()
      : typeof platform.getSystemInfoSync === 'function' ? platform.getSystemInfoSync() : null;
    if (!device || device.platform !== 'devtools') return false;
    const files = platform.getFileSystemManager();
    const image = path => 'data:image/png;base64,' + files.readFileSync(path, 'base64');
    const items = names.map((name, index) => ({
      index,
      iconPath: image('assets/tab-' + name + '.png'),
      selectedIconPath: image('assets/tab-' + name + '-active.png')
    }));
    const results = await Promise.all(items.map(item => new Promise(resolve => {
      platform.setTabBarItem({ ...item, success: () => resolve(true), fail: () => resolve(false) });
    })));
    return results.every(Boolean);
  } catch (_) {
    // Unsupported DevTools versions retain their normal native icon paths.
    return false;
  }
}

module.exports = { refresh };
