'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const d = require('./lib/deployment');
async function main(argv = process.argv.slice(2)) {
  const [action = 'plan', file] = argv;
  if (action === 'plan' || action === 'bundle') {
    const config = d.readConfig(path.resolve(file || path.join(d.ROOT, 'infra/deployment.example.json')));
    const missing = d.validate(config);
    if (action === 'plan') {
      process.stdout.write(JSON.stringify({ configured: missing.length === 0, missing, next: '补齐非机密配置后运行 release:bundle；机密配置只放服务端。' }, null, 2) + '\n');
      return;
    }
    const output = path.resolve(argv[2] || path.join(d.ROOT, 'artifacts', 'release-' + new Date().toISOString().replace(/[:.]/g, '-')));
    const bundle = d.createBundle(config, { output });
    process.stdout.write(JSON.stringify({ directory: bundle.directory, configured: bundle.manifest.configured, missing: bundle.manifest.missing }, null, 2) + '\n');
    return;
  }
  if (!file || !['check', 'preview', 'upload'].includes(action)) throw new Error('用法: release.js plan|bundle [配置文件] [新输出目录]，或 check|preview|upload 发布包目录');
  const directory = path.resolve(file);
  if (action === 'check') { d.checkBundle(directory); return; }
  const requireTool = createRequire(path.join(d.ROOT, 'tools/wechat/package.json'));
  let ci;
  try { ci = requireTool('miniprogram-ci'); } catch (_) { throw new Error('尚未安装微信上传工具。先在 tools/wechat 安装依赖，再配置微信上传密钥。'); }
  await d.uploadBundle(directory, { ci, privateKeyPath: process.env.WECHAT_PRIVATE_KEY_PATH, preview: action === 'preview' });
  process.stdout.write(action === 'preview' ? '微信预览二维码已生成。\n' : '代码已上传到微信开发版本；需要在微信后台选为体验版，正式发布仍需提审。\n');
}
if (require.main === module) main().catch(error => { process.stderr.write((error.message || '发布工具执行失败') + '\n'); process.exitCode = 1; });
module.exports = { main };
