'use strict';

// Use only the installed offline template compilers. No login, cloud access,
// upload, private project settings, or generated source files are involved.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const directory = process.argv[2] || process.env.WECHAT_COMPILER_DIR ||
  '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec';

function filesAt(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesAt(file) : entry.isFile() ? [file] : [];
  });
}

function compile(name, files) {
  const binary = path.join(directory, name + (process.platform === 'win32' ? '.exe' : ''));
  if (!fs.existsSync(binary)) throw new Error('未找到微信离线编译器 ' + name + '；请安装微信开发者工具，或通过 WECHAT_COMPILER_DIR 指定其 wcc-exec 目录。');
  const result = spawnSync(binary, files, { cwd: mini, encoding: 'utf8', shell: false, timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : (result.stderr || result.stdout || '未返回错误详情').trim();
    throw new Error(name + ' 编译失败：\n' + detail.slice(0, 8000));
  }
  if (result.stderr && result.stderr.trim()) process.stderr.write(result.stderr);
}

try {
  const files = filesAt(mini).map(file => path.relative(mini, file).split(path.sep).join('/')).sort();
  const templates = files.filter(file => file.endsWith('.wxml'));
  const styles = files.filter(file => file.endsWith('.wxss'));
  if (!templates.length || !styles.length) throw new Error('未找到可编译的小程序模板或样式');
  compile('wcc', templates);
  compile('wcsc', styles);
  console.log('微信官方离线编译通过：' + templates.length + ' 个 WXML 模板、' + styles.length + ' 份 WXSS 样式。');
  console.log('此检查不包括模拟器运行、微信接口调用或真机验收。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
