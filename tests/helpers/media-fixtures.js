'use strict';

const crypto = require('node:crypto');

const callbackEnvironment = {
  MEDIA_CALLBACK_TOKEN: 'test-only-callback-token',
  MEDIA_CALLBACK_ENCODING_AES_KEY: Buffer.alloc(32, 7).toString('base64').replace(/=$/, ''),
  MEDIA_CALLBACK_APP_ID: 'wx0123456789abcdef'
};

function memoryRepository() {
  let tables = new Map(); let pending = Promise.resolve();
  function access(state) {
    const table = name => { if (!state.has(name)) state.set(name, new Map()); return state.get(name); };
    return {
      async get(name, id) { return structuredClone(table(name).get(id) || null); },
      async set(name, id, value) { table(name).set(id, structuredClone(value)); },
      async remove(name, id) { table(name).delete(id); }
    };
  }
  return {
    get: (...args) => access(tables).get(...args),
    set: (...args) => access(tables).set(...args),
    transaction(fn) {
      const job = pending.then(async () => {
        const copy = structuredClone(tables); const result = await fn(access(copy)); tables = copy; return result;
      });
      pending = job.catch(() => {}); return job;
    }
  };
}

function signed(parts) { return crypto.createHash('sha1').update(parts.slice().sort().join('')).digest('hex'); }

function encrypt(message, receiver = callbackEnvironment.MEDIA_CALLBACK_APP_ID, options = {}) {
  const key = Buffer.from(callbackEnvironment.MEDIA_CALLBACK_ENCODING_AES_KEY + '=', 'base64');
  const body = Buffer.from(message); const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
  const clear = Buffer.concat([Buffer.alloc(16, 19), length, body, Buffer.from(receiver)]);
  const count = 32 - clear.length % 32;
  const padded = Buffer.concat([clear, Buffer.alloc(count, options.badPadding ? 0 : count)]);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

function reviewMessage(overrides = {}) {
  return { MsgType: 'event', Event: 'wxa_media_check', appid: callbackEnvironment.MEDIA_CALLBACK_APP_ID,
    trace_id: 'trace-test-1', version: 2, errcode: 0, result: { suggest: 'pass', label: 100 }, ...overrides };
}

function callbackEvent(message = reviewMessage(), options = {}) {
  const plaintext = typeof message === 'string' ? message : JSON.stringify(message);
  const encrypted = encrypt(plaintext, options.receiver, options);
  const timestamp = '1800000000'; const nonce = 'test-nonce';
  const body = options.xml ? '<xml><Encrypt><![CDATA[' + encrypted + ']]></Encrypt></xml>' : JSON.stringify({ Encrypt: encrypted });
  return {
    httpMethod: 'POST', queryStringParameters: { timestamp, nonce,
      msg_signature: signed([callbackEnvironment.MEDIA_CALLBACK_TOKEN, timestamp, nonce, encrypted]) },
    body: options.base64 ? Buffer.from(body).toString('base64') : body,
    isBase64Encoded: !!options.base64
  };
}

module.exports = { callbackEnvironment, memoryRepository, signed, encrypt, reviewMessage, callbackEvent };
