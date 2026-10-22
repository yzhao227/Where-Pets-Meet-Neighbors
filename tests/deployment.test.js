'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const d = require('../scripts/lib/deployment');
const { createSetup } = require('../cloudfunctions/setup/service');
const { invoke } = require('../scripts/cloud-admin');
const schema = require('../infra/database.schema.json');
const { generate } = require('../scripts/generate-secrets');
const { runWechatSmoke } = require('../scripts/wechat-smoke');
function config() {
  return { appName: '有宠有邻', version: '0.4.0', wechat: { appid: 'wx1234567890abcdef', cloudEnv: 'integration-environment', cloudFilePrefix: 'cloud://integration.bucket/' },
    operator: { name: '有宠联调团队', contact: 'team@example.invalid', retention: '这是一份自动测试配置，临时资料在测试结束后删除。', policyApproved: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' },
    community: { city: '联调城市', areas: ['联调公园'], contact: 'team@example.invalid' }, features: { phoneVerification: true, imageReviewMode: 'async' } };
}
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'youchong-deploy-')); }
function contentBundleFixture(directory) {
  const root = path.join(directory, 'source');
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  for (const name of ['miniprogram', 'cloudfunctions', 'preview', 'scripts', 'tests', 'infra', 'docs', 'tools']) fs.mkdirSync(path.join(root, name), { recursive: true });
  write('package.json', { name: 'content-bundle-fixture', private: true });
  write('README.md', 'Synthetic independent review package.');
  write('project.config.json', { appid: 'touristappid' });
  write('miniprogram/config.js', 'module.exports = {};');
  write('infra/README.md', 'Synthetic deployment instructions.');
  write('scripts/check-project.js', "require('node:assert/strict').equal(require('../content/batch-001/approved.json').items.length, 1);");
  write('content/batch-001/approved.json', { items: [{ id: 'fixture-photo' }] });
  for (const [batch, count] of [['003', 250], ['004', 260]]) {
    write('content/batch-' + batch + '/baseline-' + count + '.json', { items: [] });
    write('content/batch-' + batch + '/baseline-runtime-' + count + '.json', []);
    write('content/batch-' + batch + '/additions.json', []);
  }
  const media = 'content/batch-002/media/123.source';
  const metadata = 'content/batch-002/sources/photos-metadata.json';
  const reviewed = 'content/batch-003/review/photo-groups.jpg';
  write(media, 'synthetic adopted image');
  write(metadata, [{ pageid: 123 }]);
  write(reviewed, 'synthetic review contact sheet');
  write('content/batch-003/review/evidence.json', { reviewedFileSha256: { [reviewed]: crypto.createHash('sha256').update('synthetic review contact sheet').digest('hex') } });
  write('content/batch-004/review-evidence.json', { reviewedFileSha256: {} });
  write('content/batch-004/photo-sources/selected.json', [{ pageid: 123, localFile: media, metadataFile: metadata }]);
  write('content/batch-004/media-packages.json', { packages: [] });
  return { root, write, media, metadata, reviewed };
}

test('a standalone review bundle retains only required content metadata and evidence files', () => {
  const directory = temp();
  try {
    const fixture = contentBundleFixture(directory);
    for (const file of ['content/batch-002/media/unused.webm', 'content/batch-004/unreviewed.json', 'content/batch-004/credentials.json']) fixture.write(file, 'must not enter the bundle');
    fixture.write('tests/content.test.js', `
      const test = require('node:test');
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const crypto = require('node:crypto');
      test('copied content can be validated without the source checkout', () => {
        assert.equal(require('../content/batch-001/approved.json').items[0].id, 'fixture-photo');
        for (const row of require('../content/batch-004/photo-sources/selected.json')) {
          assert.equal(fs.readFileSync(path.join(__dirname, '..', row.localFile), 'utf8'), 'synthetic adopted image');
          assert.equal(require(path.join(__dirname, '..', row.metadataFile))[0].pageid, row.pageid);
        }
        for (const [file, hash] of Object.entries(require('../content/batch-003/review/evidence.json').reviewedFileSha256)) {
          assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex'), hash);
        }
      });
    `);
    const result = d.createBundle(config(), { root: fixture.root, output: path.join(directory, 'release') });
    fs.renameSync(fixture.root, path.join(directory, 'source-unavailable'));
    const paths = result.manifest.files.map(entry => entry.path);
    for (const file of [fixture.media, fixture.metadata, fixture.reviewed]) assert.ok(paths.includes(file), file);
    for (const file of ['content/batch-002/media/unused.webm', 'content/batch-004/unreviewed.json', 'content/batch-004/credentials.json']) assert.ok(!paths.includes(file), file);
    const checked = d.checkBundle(result.directory, (binary, args, options) => {
      const child = spawnSync(binary, args, { ...options, stdio: 'pipe', encoding: 'utf8' });
      assert.equal(child.status, 0, child.stdout + child.stderr);
      return child;
    });
    assert.equal(checked.checksPassed, true);
    fs.appendFileSync(path.join(result.directory, fixture.media), 'changed');
    assert.throws(() => d.verifyBundle(result.directory), /发生变化/, 'content evidence participates in the immutable bundle inventory');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('release candidates omit retired package folders and keep active images and source archives untouched', () => {
  const directory = temp();
  try {
    const fixture = contentBundleFixture(directory);
    const ignored = [{ type: 'folder', value: 'media' }, { type: 'folder', value: 'assets/curated-poster' }, { type: 'file', value: 'pages/post/_player.js' }];
    fixture.write('project.config.json', { appid: 'touristappid', packOptions: { ignore: ignored } });
    const retired = ['media/clips/123.mp4', 'media/pages/index.js', 'assets/curated-poster/123.jpg', 'pages/post/_player.js'];
    retired.forEach(file => fixture.write('miniprogram/' + file, 'archived local video resource'));
    fixture.write('miniprogram/assets/current-photo.jpg', 'retained photo');
    const result = d.createBundle(config(), { root: fixture.root, output: path.join(directory, 'release') });
    for (const file of retired) {
      assert.equal(fs.existsSync(path.join(result.directory, 'miniprogram', file)), false, file);
      assert.equal(fs.readFileSync(path.join(fixture.root, 'miniprogram', file), 'utf8'), 'archived local video resource');
    }
    assert.ok(result.manifest.files.some(file => file.path === 'miniprogram/assets/current-photo.jpg'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('content dependency references reject missing files, path escapes, private filenames and symlinks before copying', () => {
  const directory = temp();
  try {
    const fixture = contentBundleFixture(directory);
    const selected = 'content/batch-004/photo-sources/selected.json';
    const references = ['content/batch-002/media/missing.source', 'content/batch-002/../../.env.local', '/tmp/outside.json', 'content/batch-002/secrets.json'];
    fixture.write('content/batch-002/secrets.json', 'synthetic secret excluded by name');
    const symlink = 'content/batch-002/media/linked.source';
    fs.symlinkSync(path.join(fixture.root, fixture.media), path.join(fixture.root, symlink));
    references.push(symlink);
    references.forEach((localFile, index) => {
      fixture.write(selected, [{ localFile, metadataFile: fixture.metadata }]);
      const output = path.join(directory, 'rejected-' + index);
      assert.throws(() => d.createBundle(config(), { root: fixture.root, output }), /内容发布依赖/);
      assert.equal(fs.existsSync(output), false, 'dependency validation precedes copying the release');
    });
    fixture.write(selected, []);
    fixture.write('content/batch-003/review/evidence.json', { reviewedFileSha256: { 'miniprogram/../../.env.local': 'invalid' } });
    assert.throws(() => d.createBundle(config(), { root: fixture.root, output: path.join(directory, 'invalid-review-path') }), /内容发布依赖/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('optional publicWeb configuration roundtrips through planning and a verified review bundle without enabling legacy configs', () => {
  const directory = temp();
  try {
    const root = path.join(directory, 'fixture-source');
    for (const name of ['miniprogram', 'cloudfunctions', 'preview', 'scripts', 'tests', 'infra', 'docs', 'tools']) fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'public-web-bundle-fixture', private: true }));
    fs.writeFileSync(path.join(root, 'README.md'), 'Synthetic public configuration bundle fixture.');
    fs.writeFileSync(path.join(root, 'infra/README.md'), 'Synthetic deployment instructions.');
    fs.writeFileSync(path.join(root, 'project.config.json'), JSON.stringify({ appid: 'touristappid' }));
    fs.writeFileSync(path.join(root, 'miniprogram/config.js'), 'module.exports = {};');
    const policies = [undefined, { enabled: false, businessDomains: ['approved.example.org'] }, { enabled: true, businessDomains: ['approved.example.org', 'news.example.org'] }];
    policies.forEach((publicWeb, index) => {
      const input = { ...config(), ...(publicWeb === undefined ? {} : { publicWeb }) };
      const original = structuredClone(input);
      const file = path.join(directory, 'public-config-' + index + '.json');
      fs.writeFileSync(file, JSON.stringify(input));
      const loaded = d.readConfig(file);
      assert.deepEqual(loaded, original);
      assert.deepEqual(d.validate(loaded), []);
      const result = d.createBundle(loaded, { root, output: path.join(directory, 'bundle-' + index) });
      const context = { module: { exports: {} } };
      vm.runInNewContext(fs.readFileSync(path.join(result.directory, 'miniprogram/config.js'), 'utf8'), context);
      const client = structuredClone(context.module.exports);
      assert.deepEqual(client.publicWeb, publicWeb || { enabled: false, businessDomains: [] });
      assert.equal(client.mode, 'cloud');
      assert.equal(client.cloudEnv, input.wechat.cloudEnv);
      assert.deepEqual(loaded, original, 'bundling must not mutate the source deployment configuration');
      const manifest = d.verifyBundle(result.directory);
      assert.equal(manifest.configured, true);
      assert.equal(manifest.checksPassed, false, 'serializing domains is not a successful runtime or WeChat capability check');
      assert.equal(manifest.wechatVerified, false);
      assert.ok(manifest.files.some(entry => entry.path === 'miniprogram/config.js'));
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('publicWeb deployment config rejects unknown fields and unsupported domain declarations', () => {
  const directory = temp();
  try {
    const file = path.join(directory, 'public-config.json');
    for (const publicWeb of [null, [], { enabled: true, businessDomains: ['approved.example.org'], arbitraryToken: 'synthetic-value' }]) {
      fs.writeFileSync(file, JSON.stringify({ ...config(), publicWeb }));
      assert.throws(() => d.readConfig(file), /publicWeb/, 'only the declared publicWeb shape is accepted');
    }
    const invalidPolicies = [
      { enabled: 'true', businessDomains: ['approved.example.org'] },
      { enabled: true, businessDomains: [] },
      { enabled: true, businessDomains: 'approved.example.org' },
      ...['https://approved.example.org', '*.example.org', 'approved.example.org/path', 'approved.example.org:8443', 'approved.example.org@evil.invalid', 'localhost', '', null]
        .map(domain => ({ enabled: true, businessDomains: [domain] }))
    ];
    for (const publicWeb of invalidPolicies) {
      assert.ok(d.validate({ ...config(), publicWeb }).includes('网页跳转需填写已验证的业务域名'), JSON.stringify(publicWeb));
    }
    assert.deepEqual(d.validate({ ...config(), publicWeb: { enabled: false, businessDomains: [] } }), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('release planning identifies unconfigured account/policy and never puts secret values in cloud settings', () => {
  const example = d.readConfig(path.join(d.ROOT, 'infra/deployment.example.json'));
  assert.ok(d.validate(example).includes('真实微信 AppID'));
  assert.ok(d.validate(example).includes('微信云开发环境 ID'));
  assert.deepEqual(d.validate(config()), []);
  const runtime = d.runtimeEnvironment(config());
  assert.equal(runtime.DATABASE_RULES_CONFIRMED, 'false');
  assert.equal(runtime.MEDIA_QUARANTINE_LOCK_CONFIRMED, 'false');
  assert.equal(runtime.MEDIA_REVIEW_MODE, 'async');
  assert.equal('PHONE_HASH_SECRET' in runtime, false);
  const directory = temp();
  try {
    const file = path.join(directory, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ ...config(), operator: { ...config().operator, secretKey: 'must-not-be-copied' } }));
    assert.throws(() => d.readConfig(file), /机密/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('review bundles are inspectable but unconfigured or untested bundles cannot be uploaded', async () => {
  const directory = temp();
  try {
    const result = d.createBundle(d.readConfig(path.join(d.ROOT, 'infra/deployment.example.json')), { output: path.join(directory, 'review') });
    assert.equal(result.manifest.configured, false);
    assert.equal(result.manifest.checksPassed, false);
    assert.equal(d.verifyBundle(result.directory).wechatVerified, false);
    await assert.rejects(d.uploadBundle(result.directory, { ci: {} }), /补齐配置/);
    assert.throws(() => d.createBundle(config(), { output: result.directory }), /已存在/);
    assert.equal(fs.existsSync(path.join(result.directory, 'infra/secrets.env.example')), true);
    assert.equal(fs.existsSync(path.join(result.directory, 'preview/index.html')), true);
    assert.equal(fs.existsSync(path.join(result.directory, '.env.local')), false);
    assert.equal(fs.existsSync(path.join(result.directory, 'infra/deployment.local.json')), false);
    assert.equal(fs.existsSync(path.join(result.directory, '.env')), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('real review bundles independently validate approved cover dimensions beyond the latest selected photos', () => {
  const directory = temp();
  try {
    const result = d.createBundle(config(), { output: path.join(directory, 'release') });
    const paths = new Set(result.manifest.files.map(entry => entry.path));
    assert.ok(paths.has('content/batch-001/sources/commons-cats-metadata.json'));
    assert.ok(paths.has('content/batch-001/sources/commons-dogs-metadata.json'));
    const approved = JSON.parse(fs.readFileSync(path.join(result.directory, 'content/batch-001/approved.json'), 'utf8'));
    for (const item of approved.items) {
      const source = item.sourceEvidence;
      for (const evidence of [source, ...(source && source.imageSources || [])]) {
        if (evidence && evidence.metadataFile) assert.ok(paths.has(evidence.metadataFile), item.id + ': ' + evidence.metadataFile);
      }
    }
    // Run the actual dynamic metadata consumer in the generated package, not
    // just an existence check or a fixture limited to the latest selected list.
    const child = spawnSync(process.execPath, ['--test', 'tests/discovery-presentation.test.js'], { cwd: result.directory, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.equal(d.verifyBundle(result.directory).checksPassed, false, 'this focused regression does not replace the full release check');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('only a checked unchanged bundle reaches the WeChat SDK and private keys stay outside it', async () => {
  const directory = temp();
  try {
    const result = d.createBundle(config(), { output: path.join(directory, 'release') });
    const calls = [];
    d.checkBundle(result.directory, (binary, args, options) => { calls.push({ binary, args, options }); return { status: 0 }; });
    assert.equal(calls.length, 2);
    assert.equal(calls.every(call => call.options.cwd === result.directory && !call.options.shell), true);
    const key = path.join(directory, 'test-upload-key.pem'); fs.writeFileSync(key, 'fixture-only-not-a-real-private-key');
    let submitted;
    const ci = { Project: class { constructor(options) { this.options = options; } }, async upload(options) { submitted = options; return { success: true }; } };
    await d.uploadBundle(result.directory, { ci, privateKeyPath: key });
    assert.equal(submitted.version, '0.4.0');
    assert.equal(submitted.project.options.projectPath, path.join(result.directory, 'miniprogram'));
    for (const excluded of ['media/**/*', 'media2/**/*', 'media3/**/*', 'pages/post/_player.js']) assert.ok(submitted.project.options.ignores.includes(excluded), excluded);
    fs.appendFileSync(path.join(result.directory, 'miniprogram/app.js'), '\n// changed after test\n');
    await assert.rejects(d.uploadBundle(result.directory, { ci, privateKeyPath: key }), /发生变化/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('test failures stop a release and hidden file additions invalidate its inventory', () => {
  const directory = temp();
  try {
    const result = d.createBundle(config(), { output: path.join(directory, 'release') });
    assert.throws(() => d.checkBundle(result.directory, () => ({ status: 1 })), /测试未通过/);
    assert.equal(d.verifyBundle(result.directory).checksPassed, false);
    fs.writeFileSync(path.join(result.directory, 'miniprogram/.unexpected'), 'not in checked package');
    assert.throws(() => d.verifyBundle(result.directory), /发生变化/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('database setup requires a server secret and cannot be invoked by a WeChat client or create arbitrary collections', async () => {
  const names = new Set(); const created = []; let writes = 0;
  const db = { collection(name) { return { limit() { return { async get() { if (!names.has(name)) throw new Error('collection does not exist'); return { data: [] }; } }; }, set() { writes++; } }; },
    async createCollection(name) { names.add(name); created.push(name); } };
  const secret = 'setup-fixture-secret-'.repeat(3);
  const setup = createSetup(db, secret);
  await assert.rejects(setup({ action: 'createMissing', setupSecret: secret }, { OPENID: 'user' }), { code: 'FORBIDDEN' });
  await assert.rejects(setup({ action: 'createMissing', setupSecret: 'wrong' }), { code: 'FORBIDDEN' });
  await assert.rejects(setup({ action: 'createMissing', Type: 'Timer' }), { code: 'FORBIDDEN' });
  const before = await setup({ action: 'inspect', setupSecret: secret });
  assert.equal(before.missing.length, schema.collections.length);
  const first = await setup({ action: 'createMissing', setupSecret: secret, collection: 'arbitrary' });
  assert.deepEqual(created, schema.collections.map(item => item.name));
  assert.equal(first.databaseRulesReady, false);
  const second = await setup({ action: 'createMissing', setupSecret: secret });
  assert.equal(second.created.length, 0);
  assert.equal(writes, 0, 'setup never writes profile data under newly created default ACLs');
});

test('server administration uses secret credentials without identity payloads and fails closed on platform errors', async () => {
  let request;
  const environment = { TENCENTCLOUD_SECRET_ID: 'fixture-id', TENCENTCLOUD_SECRET_KEY: 'fixture-key', MAINTENANCE_SECRET: 'maintenance-fixture-'.repeat(3) };
  const sdk = { init() { return { async callFunction(value) { request = value; return { result: { ok: true, data: { processed: 2 } } }; } }; } };
  assert.deepEqual(await invoke(config(), 'maintenance', { sdk, environment }), { processed: 2 });
  assert.equal(request.data.action, '__maintenance');
  assert.equal(request.data.maintenanceSecret, environment.MAINTENANCE_SECRET);
  assert.equal('openid' in request.data, false);
  await assert.rejects(invoke(config(), 'maintenance', { sdk, environment: {} }), /尚未配置/);
  const badSdk = { init() { return { async callFunction() { throw new Error(environment.TENCENTCLOUD_SECRET_KEY); } }; } };
  await assert.rejects(invoke(config(), 'maintenance', { sdk: badSdk, environment }), error => !error.message.includes(environment.TENCENTCLOUD_SECRET_KEY));
});

test('generated server secrets are private, stable on retries and use a valid WeChat AES key length', () => {
  const directory = temp();
  try {
    const file = path.join(directory, '.env.local');
    assert.equal(generate(file).length, 5);
    const before = fs.readFileSync(file, 'utf8');
    const values = Object.fromEntries(before.split('\n').filter(line => line && !line.startsWith('#')).map(line => { const position = line.indexOf('='); return [line.slice(0, position), line.slice(position + 1)]; }));
    assert.equal(Buffer.from(values.MEDIA_CALLBACK_ENCODING_AES_KEY + '=', 'base64').length, 32);
    assert.ok(values.PHONE_HASH_SECRET.length >= 32);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => generate(file), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('real-WeChat smoke helper cannot spoof onboarding or clean another account test post', async () => {
  await assert.rejects(runWechatSmoke({ __preview: true, cloud: {} }, { step: 'publish' }), /真实云环境/);
  const calls = [];
  let verified = false;
  const platform = { cloud: { async callFunction({ data }) {
    calls.push(data);
    if (data.action === 'bootstrap') return { result: { ok: true, data: { mode: 'cloud', user: { verification: { status: verified ? 'phone_verified' : 'unverified' } } } } };
    return { result: { ok: true, data: { post: { title: '有宠有邻部署联调', isMine: false } } } };
  } } };
  await assert.rejects(runWechatSmoke(platform, { step: 'publish' }), /真实手机号核验/);
  verified = true;
  await assert.rejects(runWechatSmoke(platform, { step: 'cleanup', postId: 'fixture-post' }), /发布测试帖的账号/);
  assert.equal(calls.some(call => call.action === 'deletePost' || 'openid' in call.payload || 'isAdmin' in call.payload), false);
});
