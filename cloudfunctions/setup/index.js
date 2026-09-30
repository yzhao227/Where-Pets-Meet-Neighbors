'use strict';
const cloud = require('wx-server-sdk');
const { createSetup, SetupError } = require('./service');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const run = createSetup(cloud.database(), process.env.SETUP_SECRET || '');
exports.main = async event => {
  try { return { ok: true, data: await run(event, cloud.getWXContext()) }; }
  catch (error) { return { ok: false, error: { code: error instanceof SetupError ? error.code : 'SETUP_FAILED', message: '数据库设置未完成，请通过受保护的服务端工具检查' } }; }
};
