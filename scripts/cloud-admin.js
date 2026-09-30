'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const { ROOT, readConfig, validate } = require('./lib/deployment');

async function invoke(config, action, { sdk, environment = process.env } = {}) {
  if (!config.wechat || !config.wechat.cloudEnv) throw new Error('请先配置真实云环境 ID');
  if (!environment.TENCENTCLOUD_SECRET_ID || !environment.TENCENTCLOUD_SECRET_KEY) throw new Error('服务端云访问凭据尚未配置');
  const inputs = { env: config.wechat.cloudEnv, secretId: environment.TENCENTCLOUD_SECRET_ID, secretKey: environment.TENCENTCLOUD_SECRET_KEY };
  if (environment.TENCENTCLOUD_SESSION_TOKEN) inputs.sessionToken = environment.TENCENTCLOUD_SESSION_TOKEN;
  const app = sdk.init(inputs);
  let request;
  if (action === 'maintenance') {
    if (Buffer.byteLength(environment.MAINTENANCE_SECRET || '') < 32) throw new Error('MAINTENANCE_SECRET 尚未正确配置');
    request = { name: 'community', data: { action: '__maintenance', maintenanceSecret: environment.MAINTENANCE_SECRET, payload: { limit: 20 } } };
  } else if (['inspect-schema', 'create-collections'].includes(action)) {
    if (Buffer.byteLength(environment.SETUP_SECRET || '') < 32) throw new Error('SETUP_SECRET 尚未正确配置');
    request = { name: 'setup', data: { action: action === 'inspect-schema' ? 'inspect' : 'createMissing', setupSecret: environment.SETUP_SECRET } };
  } else throw new Error('不支持的云管理动作');
  let response;
  try { response = await app.callFunction(request); } catch (_) { throw new Error('云管理调用失败，请检查环境、权限和云端日志；没有输出密钥或原始响应'); }
  let result = response && response.result;
  if (typeof result === 'string') { try { result = JSON.parse(result); } catch (_) { throw new Error('云管理响应格式不正确'); } }
  if (!result || result.ok !== true) throw new Error('云管理未完成：' + (result && result.error && /^[A-Z0-9_]{1,60}$/.test(result.error.code) ? result.error.code : 'UNAVAILABLE'));
  return result.data;
}
async function main() {
  const [action, configFile] = process.argv.slice(2);
  if (!configFile) throw new Error('用法: cloud-admin.js inspect-schema|create-collections|maintenance 本机配置文件');
  const config = readConfig(path.resolve(configFile));
  if (validate(config).includes('真实微信 AppID')) throw new Error('请先填写真实微信 AppID');
  const requireTool = createRequire(path.join(ROOT, 'tools/wechat/package.json'));
  let sdk;
  try { sdk = requireTool('@cloudbase/node-sdk'); } catch (_) { throw new Error('请先在 tools/wechat 安装云管理工具依赖'); }
  const result = await invoke(config, action, { sdk });
  // Only these count/status fields are suitable for an external scheduler log.
  const safe = {};
  for (const key of ['created', 'existing', 'missing', 'collections', 'databaseRulesReady', 'completed', 'processed', 'deleted', 'pending', 'failures', 'notificationsProcessed', 'uploadsScanned', 'uploadsDeleted', 'uploadSourcesCleaned', 'mediaReviewsScanned', 'mediaReviewsDeleted', 'rateLimitsDeleted', 'lastRunAt']) if (result[key] !== undefined) safe[key] = result[key];
  process.stdout.write(JSON.stringify(safe, null, 2) + '\n');
}
if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { invoke };
