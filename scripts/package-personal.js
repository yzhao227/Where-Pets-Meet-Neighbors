'use strict';

// Build an isolated, local-only upload candidate. This never invokes WeChat,
// deploys cloud functions, or removes data from an existing installation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
function build(output, root = ROOT) {
  const config = require(path.join(root, 'miniprogram/config'));
  if (config.productMode !== 'personal' || config.cloudEnv) throw new Error('仅允许构建已关闭云服务的个人工具版');
  if (!output) throw new Error('请指定一个新的输出目录');
  const target = path.resolve(output);
  if (fs.existsSync(target)) throw new Error('输出目录已存在，请使用新目录，保留原有候选包');
  for (const script of ['check-project.js', 'check-wechat.js']) {
    const check = spawnSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, encoding: 'utf8', timeout: 120000 });
    if (check.status !== 0) throw new Error((check.stderr || check.stdout || '检查失败').trim());
    process.stdout.write(check.stdout);
  }
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const ignore = project.packOptions.ignore || [];
  const files = [];
  const mini = path.join(root, 'miniprogram');
  function copy(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const source = path.join(directory, entry.name);
      const relative = path.relative(mini, source).split(path.sep).join('/');
      if (ignore.some(item => item.type === 'folder' && (relative === item.value || relative.startsWith(item.value + '/')) || item.type === 'file' && relative === item.value)) continue;
      if (entry.isDirectory()) { copy(source); continue; }
      const destination = path.join(target, 'miniprogram', relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      files.push({ path: 'miniprogram/' + relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') });
    }
  }
  copy(mini);
  delete project.cloudfunctionRoot;
  fs.writeFileSync(path.join(target, 'project.config.json'), JSON.stringify(project, null, 2) + '\n');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const manifest = { version, productMode: 'personal', builtAt: new Date().toISOString(), uploaded: false, cloudDeployed: false, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  fs.writeFileSync(path.join(target, 'personal-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { directory: target, version, fileCount: files.length, uploaded: false };
}
if (require.main === module) {
  try { console.log(JSON.stringify(build(process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build };
