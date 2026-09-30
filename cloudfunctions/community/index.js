'use strict';

const cloud = require('wx-server-sdk');
const { createRepository, COLLECTIONS } = require('./repository');
const { createService, AppError } = require('./service');
const { createStorage } = require('./storage');
const { createPhoneVerifier } = require('./phone');
const { createMapGeocoder } = require('./map-geocoder');
const { createRuntimeConfig } = require('./runtime-config');
const { authorizeMaintenance } = require('./maintenance');
const { createMediaCallback } = require('./media-callback');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const repository = createRepository(cloud.database());
let schemaReady;
const storage = createStorage(cloud, process.env, { repository });
const mediaCallback = createMediaCallback({ environment: process.env, onReview: result => storage.acceptReviewResult(result) });

async function moderateText(text, openid) {
  try {
    const response = await cloud.openapi.security.msgSecCheck({ version: 2, scene: 2, openid, content: text });
    if (response && response.result && response.result.suggest === 'pass') return;
    if (response && response.result) throw new AppError('CONTENT_REJECTED', '这段内容暂时无法发布，请调整后重试');
    throw new Error('Content security returned no decision');
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Text security unavailable', { code: error.errCode || error.errcode || 'unknown' });
    throw new AppError('CONTENT_CHECK_UNAVAILABLE', '内容检查暂时不可用，请稍后重试');
  }
}

const service = createService({ repository,
  adminOpenids: (process.env.ADMIN_OPENIDS || '').split(',').map(value => value.trim()).filter(Boolean),
  moderateText,
  storage,
  phoneVerifier: createPhoneVerifier(cloud, process.env),
  mapGeocoder: createMapGeocoder(process.env),
  runtimeConfig: createRuntimeConfig(process.env)
});

async function ensureSchema() {
  if (process.env.DATABASE_RULES_CONFIRMED !== 'true') throw new AppError('SETUP_REQUIRED', '社区尚未完成部署设置，请联系运营者');
  if (!schemaReady) schemaReady = Promise.all(COLLECTIONS.map(name => repository.find(name, {}, { limit: 1 }))).catch(() => {
    schemaReady = null;
    throw new AppError('SETUP_REQUIRED', '云数据库集合尚未配置完整，请联系运营者');
  });
  await schemaReady;
}

exports.main = async event => {
  try {
    const wxContext = cloud.getWXContext();
    if (event && event.action === '__maintenance') {
      if (!authorizeMaintenance(event, wxContext, process.env.MAINTENANCE_SECRET)) throw new AppError('FORBIDDEN', '无权调用维护入口');
      await ensureSchema();
      return { ok: true, data: await service.runMaintenance(event.payload || {}) };
    }
    if (event && (event.httpMethod || event.requestContext && event.requestContext.http)) {
      if (wxContext.OPENID) return { statusCode: 403, body: 'client callback rejected' };
      try { await ensureSchema(); } catch (_) { return { statusCode: 503, body: 'service unavailable' }; }
      // This verifier requires a valid WeChat signature, encrypted payload and app ID.
      // Merely naming an event/trigger/trace cannot invoke an internal operation.
      return mediaCallback.handle(event);
    }
    if (!wxContext.OPENID) throw new AppError('UNAUTHENTICATED', '请通过微信小程序访问');
    // Collection creation defaults vary between environments. Never create collections
    // and then start writing private data under potentially public default rules.
    // Upgrades must provision every private collection before any account or social
    // write can run. A missing collection must not be implicitly created by set().
    await ensureSchema();
    const data = await service.handle(event && event.action, event && event.payload || {}, { openid: wxContext.OPENID });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: { code: error.code, message: error.message } };
    // Never return raw database errors, context, openid, stack traces, or environment values.
    console.error('Community request failed', { name: error.name || 'Error', code: error.errCode || error.code || 'unknown' });
    return { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' } };
  }
};
