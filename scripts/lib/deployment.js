'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../..');
const secretNames = ['PHONE_HASH_SECRET', 'MAINTENANCE_SECRET', 'ADMIN_OPENIDS'];
const allowedTop = ['appName', 'version', 'wechat', 'operator', 'community', 'features', 'publicWeb'];
// The independent review bundle must retain the content inputs used by its tests
// and content:validate/build. Do not copy the full scraping/download archive.
const contentInputs = [
  'content/batch-001/approved.json',
  'content/batch-003/baseline-250.json',
  'content/batch-003/baseline-runtime-250.json',
  'content/batch-003/additions.json',
  'content/batch-003/review/evidence.json',
  'content/batch-004/baseline-260.json',
  'content/batch-004/baseline-runtime-260.json',
  'content/batch-004/additions.json',
  'content/batch-004/photo-sources/selected.json',
  'content/batch-004/review-evidence.json',
  'content/batch-004/media-packages.json'
];
const contentReviewRecords = ['content/batch-003/review/evidence.json', 'content/batch-004/review-evidence.json'];
function assertShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Deployment configuration must be an object');
  if (Object.keys(value).some(key => !allowedTop.includes(key))) throw new Error('配置含未知字段；密钥不能放在部署配置文件中');
  if (value.publicWeb !== undefined && (!value.publicWeb || typeof value.publicWeb !== 'object' || Array.isArray(value.publicWeb) || Object.keys(value.publicWeb).some(key => !['enabled', 'businessDomains'].includes(key)))) throw new Error('publicWeb 配置仅接受开关及已验证业务域名');
  const nested = { wechat: ['appid', 'cloudEnv', 'cloudFilePrefix'], operator: ['name', 'contact', 'retention', 'termsVersion', 'privacyVersion', 'policyApproved'], community: ['city', 'areas', 'contact'], features: ['phoneVerification', 'imageReviewMode'] };
  for (const [name, allowed] of Object.entries(nested)) {
    const obj = value[name];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some(key => !allowed.includes(key))) throw new Error(name + ' 配置字段不正确；机密字段不能写入此文件');
  }
}
function readConfig(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assertShape(value);
  return value;
}
function validate(config) {
  const missing = [];
  const w = config.wechat || {}, o = config.operator || {}, c = config.community || {}, f = config.features || {};
  if (typeof config.appName !== 'string' || !config.appName.trim()) missing.push('小程序名称');
  if (!/^\d+\.\d+\.\d+$/.test(config.version || '')) missing.push('版本号（如 0.4.0）');
  if (!/^wx[a-f0-9]{16}$/.test(w.appid || '')) missing.push('真实微信 AppID');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{3,99}$/.test(w.cloudEnv || '')) missing.push('微信云开发环境 ID');
  for (const [key, label] of [['name', '运营主体名称'], ['contact', '运营联系方式'], ['retention', '数据保存期限及删除说明'], ['termsVersion', '用户协议版本'], ['privacyVersion', '隐私说明版本']]) {
    if (typeof o[key] !== 'string' || !o[key].trim()) missing.push(label);
  }
  if (o.policyApproved !== true) missing.push('运营方完善并检查正式协议与隐私说明');
  const normalized = require('../../cloudfunctions/community/runtime-config').normalizeRuntimeConfig(o);
  if (o.policyApproved === true && !normalized.policyConfigured) missing.push('运营资料需满足后台格式要求，不能保留占位内容');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.termsVersion || '') || !/^\d{4}-\d{2}-\d{2}$/.test(o.privacyVersion || '')) missing.push('协议版本日期（YYYY-MM-DD）');
  if (!c.city || typeof c.city !== 'string') missing.push('试运营城市');
  if (!Array.isArray(c.areas) || !c.areas.length || c.areas.length > 20 || c.areas.some(area => typeof area !== 'string' || !area.trim() || area.length > 40)) missing.push('1–20 个真实运营片区');
  if (!c.contact || typeof c.contact !== 'string') missing.push('社区客服联系方式');
  if (typeof f.phoneVerification !== 'boolean') missing.push('手机号核验开关');
  if (!['disabled', 'sync', 'async'].includes(f.imageReviewMode)) missing.push('图片审核模式');
  if (f.imageReviewMode !== 'disabled' && !/^cloud:\/\/[^/]+\/$/.test(w.cloudFilePrefix || '')) missing.push('完整云文件前缀');
  if (config.publicWeb !== undefined && (typeof config.publicWeb.enabled !== 'boolean' || !Array.isArray(config.publicWeb.businessDomains) || config.publicWeb.businessDomains.some(domain => typeof domain !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || !domain.includes('.')) || config.publicWeb.enabled && !config.publicWeb.businessDomains.length)) missing.push('网页跳转需填写已验证的业务域名');
  return missing;
}
function runtimeEnvironment(config) {
  return {
    DATABASE_RULES_CONFIRMED: 'false',
    PHONE_VERIFICATION_ENABLED: String(config.features.phoneVerification === true),
    UPLOADS_ENABLED: String(config.features.imageReviewMode !== 'disabled'),
    MEDIA_REVIEW_MODE: config.features.imageReviewMode,
    MEDIA_CALLBACK_APP_ID: config.wechat.appid || '',
    MEDIA_QUARANTINE_LOCK_CONFIRMED: 'false',
    CLOUD_FILE_PREFIX: config.wechat.cloudFilePrefix || '',
    OPERATOR_CONFIG: JSON.stringify(config.operator)
  };
}
function walk(directory, includeHidden = false) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (entry.name === 'node_modules' || (!includeHidden && entry.name.startsWith('.'))) return [];
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('发布包不接受符号链接: ' + entry.name);
    return entry.isDirectory() ? walk(file, includeHidden) : entry.isFile() ? [file] : [];
  });
}
function inventory(directory) {
  return walk(directory, true).filter(file => file !== path.join(directory, 'release-manifest.json')).map(file => ({
    path: path.relative(directory, file).split(path.sep).join('/'),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  }));
}
function contentBundleFiles(root) {
  if (!fs.existsSync(path.join(root, 'content'))) return [];
  const files = new Map();
  function add(relative) {
    // References are data, never arbitrary filesystem paths. Validate before
    // reading them, including every directory component to reject symlinks.
    if (typeof relative !== 'string' || !/^content\/batch-\d{3}\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:json|source|jpe?g|png|webp|mp4|webm)$/.test(relative) ||
        relative.split('/').some(part => /(?:^|[._-])(?:secrets?|credentials?|private[-_]?key|tokens?|local)(?:[._-]|$)/i.test(part))) {
      throw new Error('内容发布依赖路径不允许: ' + String(relative));
    }
    let source = root;
    const parts = relative.split('/');
    parts.forEach((part, index) => {
      source = path.join(source, part);
      let stat;
      try { stat = fs.lstatSync(source); } catch (_) { throw new Error('内容发布依赖缺失: ' + relative); }
      if (stat.isSymbolicLink()) throw new Error('内容发布依赖不接受符号链接: ' + relative);
      if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) throw new Error('内容发布依赖类型不正确: ' + relative);
    });
    files.set(relative, source);
  }
  contentInputs.forEach(add);
  const retiredVideos = 'content/batch-001/retired-video-20261022.json';
  if (fs.existsSync(path.join(root, retiredVideos))) add(retiredVideos);
  for (const relative of contentReviewRecords) {
    const record = JSON.parse(fs.readFileSync(files.get(relative), 'utf8'));
    if (!record.reviewedFileSha256 || typeof record.reviewedFileSha256 !== 'object' || Array.isArray(record.reviewedFileSha256)) throw new Error('内容审核依赖清单不正确: ' + relative);
    for (const file of Object.keys(record.reviewedFileSha256)) {
      if (/^miniprogram\/(?:assets|media\d*)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp|mp4|webm)$/.test(file)) continue; // Already included in full.
      add(file);
    }
  }
  const selected = JSON.parse(fs.readFileSync(files.get('content/batch-004/photo-sources/selected.json'), 'utf8'));
  if (!Array.isArray(selected)) throw new Error('已采用图片清单不正确');
  for (const picture of selected) {
    add(picture && picture.localFile);
    add(picture && picture.metadataFile);
  }
  // Shape validation and catalogue maintenance also read the source dimensions
  // of older approved entries, which are absent from the latest selected list.
  const approved = JSON.parse(fs.readFileSync(files.get('content/batch-001/approved.json'), 'utf8'));
  if (!Array.isArray(approved.items)) throw new Error('已发布内容清单不正确');
  function addSourceMetadata(evidence) {
    if (!evidence || typeof evidence !== 'object') return;
    if (evidence.metadataFile !== undefined) add(evidence.metadataFile);
    if (Array.isArray(evidence.imageSources)) evidence.imageSources.forEach(addSourceMetadata);
  }
  approved.items.forEach(item => addSourceMetadata(item && item.sourceEvidence));
  return [...files.values()].sort();
}
function createBundle(config, { root = ROOT, output } = {}) {
  assertShape(config);
  const sourceSettings = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/config.js'), 'utf8'), { module: sourceSettings });
  const client = clientConfiguration(config, sourceSettings.exports);
  if (!output) throw new Error('A new output directory is required');
  const target = path.resolve(output);
  if (fs.existsSync(target)) throw new Error('发布包目录已存在；请使用新的目录，避免覆盖旧结果');
  const contentFiles = contentBundleFiles(root);
  const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const ignored = project.packOptions && project.packOptions.ignore || [];
  const isIgnored = source => {
    const relative = path.relative(path.join(root, 'miniprogram'), source).split(path.sep).join('/');
    return ignored.some(entry => entry.type === 'file' ? relative === entry.value : entry.type === 'folder' && (relative === entry.value || relative.startsWith(entry.value + '/')));
  };
  fs.mkdirSync(target, { recursive: true });
  for (const directory of ['miniprogram', 'cloudfunctions', 'preview', 'scripts', 'tests', 'infra', 'docs', 'tools']) {
    for (const source of walk(path.join(root, directory))) {
      if (directory === 'miniprogram' && isIgnored(source)) continue;
      if (directory === 'infra' && !['database.schema.json', 'deployment.example.json', 'secrets.env.example', 'README.md', 'storage-policy.json', 'storage.rules.md'].includes(path.basename(source))) continue;
      if (/\.(?:pem|key|p12|pfx)$/i.test(source) || /(?:local|secrets)\.(?:json|env)$/i.test(source)) continue;
      const destination = path.join(target, path.relative(root, source));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
  }
  for (const source of contentFiles) {
    const destination = path.join(target, path.relative(root, source));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  fs.copyFileSync(path.join(root, 'package.json'), path.join(target, 'package.json'));
  fs.copyFileSync(path.join(root, 'README.md'), path.join(target, 'README.md'));
  project.appid = config.wechat.appid || 'touristappid';
  project.description = '有宠有邻 ' + config.version + ' · 微信部署候选包';
  fs.writeFileSync(path.join(target, 'project.config.json'), JSON.stringify(project, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'miniprogram/config.js'), '// Public settings only. Preserve the source product scope.\nmodule.exports = ' + JSON.stringify(client, null, 2) + ';\n');
  const instructions = client.productMode === 'personal' ? { environment: {}, secretEnvironmentNames: [], requiredActions: ['本版本为个人工具，无需部署云端社区服务', '完成本机私人记录、附件保存和导航检查', '按实际功能核实类目后提审'] } : { environment: runtimeEnvironment(config), secretEnvironmentNames: secretNames.concat(config.features.imageReviewMode === 'async' ? ['MEDIA_CALLBACK_TOKEN', 'MEDIA_CALLBACK_ENCODING_AES_KEY'] : []),
    communityInitialization: { action: 'initialize', payload: config.community },
    requiredActions: ['先创建全部空集合，再逐个设置拒绝客户端读写规则及索引', '验证真实数据库及存储权限后，才能将 DATABASE_RULES_CONFIRMED 改为 true', '机密字段只在服务端配置，不写入小程序', '上传云函数后验证微信能力与两账号完整流程'] };
  fs.writeFileSync(path.join(target, 'infra/cloud-settings.json'), JSON.stringify(instructions, null, 2) + '\n');
  const missing = validate(config);
  const manifest = { version: config.version, builtAt: new Date().toISOString(), configured: missing.length === 0, missing,
    checksPassed: false, wechatVerified: false, files: inventory(target) };
  fs.writeFileSync(path.join(target, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { directory: target, manifest };
}
function clientConfiguration(config, source) {
  if (source.productMode === 'personal') return { appName: config.appName, productMode: 'personal', mode: 'demo', cloudEnv: '', publicWeb: { enabled: false, businessDomains: [] } };
  return { appName: config.appName, mode: 'cloud', cloudEnv: config.wechat.cloudEnv || '', publicWeb: config.publicWeb || { enabled: false, businessDomains: [] } };
}
function verifyBundle(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'));
  const actual = inventory(directory);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('发布包在生成后发生变化，请重新打包和测试');
  return manifest;
}
function checkBundle(directory, runner = spawnSync) {
  verifyBundle(directory);
  for (const args of [['scripts/check-project.js'], ['--test', 'tests/*.test.js']]) {
    const result = runner(process.execPath, args, { cwd: directory, stdio: 'inherit', shell: false });
    if (result.status !== 0) throw new Error('发布包测试未通过，停止上传');
  }
  const manifest = verifyBundle(directory);
  manifest.checksPassed = true;
  fs.writeFileSync(path.join(directory, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
async function uploadBundle(directory, { ci, privateKeyPath, preview = false } = {}) {
  const manifest = verifyBundle(directory);
  if (!manifest.configured || !manifest.checksPassed) throw new Error('需要先补齐配置并对发布包运行完整测试');
  if (!privateKeyPath || !fs.existsSync(privateKeyPath)) throw new Error('请在本机设置 WECHAT_PRIVATE_KEY_PATH，指向微信代码上传密钥文件');
  const rootPath = path.resolve(directory);
  const keyPath = fs.realpathSync(privateKeyPath);
  if (keyPath === rootPath || keyPath.startsWith(rootPath + path.sep)) throw new Error('上传密钥必须保存在发布包目录之外');
  const projectConfig = JSON.parse(fs.readFileSync(path.join(rootPath, 'project.config.json'), 'utf8'));
  const ignored = (projectConfig.packOptions && projectConfig.packOptions.ignore || []).filter(entry => ['file', 'folder'].includes(entry.type)).map(entry => entry.value + (entry.type === 'folder' ? '/**/*' : ''));
  const project = new ci.Project({ appid: projectConfig.appid, type: 'miniProgram', projectPath: path.join(rootPath, 'miniprogram'),
    privateKeyPath: keyPath, ignores: ['node_modules/**/*', 'tools/**/*', 'tests/**/*', 'scripts/**/*', 'infra/**/*'].concat(ignored) });
  const args = { project, desc: '有宠有邻 ' + manifest.version + ' 微信体验候选版', setting: { es6: true, minify: true }, robot: 1 };
  if (preview) {
    // Keep generated QR code outside the immutable package inventory.
    return ci.preview({ ...args, qrcodeFormat: 'image', qrcodeOutputDest: rootPath + '-preview.png' });
  }
  return ci.upload({ ...args, version: manifest.version });
}
module.exports = { ROOT, readConfig, validate, runtimeEnvironment, createBundle, clientConfiguration, inventory, verifyBundle, checkBundle, uploadBundle };
