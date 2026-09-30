'use strict';

const crypto = require('node:crypto');

function callbackConfiguration(environment) {
  const token = environment.MEDIA_CALLBACK_TOKEN || '';
  const encodedKey = environment.MEDIA_CALLBACK_ENCODING_AES_KEY || '';
  const appId = environment.MEDIA_CALLBACK_APP_ID || '';
  const key = /^[A-Za-z0-9+/]{43}$/.test(encodedKey) ? Buffer.from(encodedKey + '=', 'base64') : null;
  return { token, appId, key, enabled: typeof token === 'string' && token.length >= 3 && token.length <= 256 && !!token.trim() && /^wx[a-zA-Z0-9]{8,64}$/.test(appId) && !!key && key.length === 32 };
}

function signed(signature, parts) {
  if (typeof signature !== 'string' || !/^[a-fA-F0-9]{40}$/.test(signature)) return false;
  const expected = crypto.createHash('sha1').update(parts.slice().sort().join('')).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

function decodeEntities(text) {
  return text.replace(/&([^;]+);/g, (_, entity) => {
    const named = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
    if (/^#\d+$/.test(entity) || /^#x[0-9a-f]+$/i.test(entity)) {
      const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (point > 0 && point <= 0x10ffff) return String.fromCodePoint(point);
    }
    throw new Error('Unsupported XML entity');
  });
}

// A bounded protocol parser; DTDs, custom entities, attributes and mixed content
// are rejected. WeChat's documented XML fields and CDATA need none of those.
function parseXml(source) {
  const text = source.replace(/^\s*<\?xml[^?]*\?>/, '').trim();
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML declarations are not supported');
  const tokens = text.match(/<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][A-Za-z0-9_:-]*\s*>|[^<]+/g) || [];
  if (tokens.join('') !== text) throw new Error('Invalid XML');
  const stack = [];
  let root;
  for (const token of tokens) {
    if (token.startsWith('<![CDATA[')) {
      if (!stack.length) throw new Error('Invalid CDATA');
      stack[stack.length - 1].text += token.slice(9, -3);
    } else if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim();
      const node = stack.pop();
      if (!node || node.name !== name) throw new Error('Mismatched XML tag');
      if (Object.keys(node.children).length && node.text.trim()) throw new Error('Mixed XML content');
      const value = Object.keys(node.children).length ? node.children : node.text.trim();
      if (!stack.length) {
        if (root !== undefined) throw new Error('Multiple XML roots');
        root = { name, value };
      } else {
        const parent = stack[stack.length - 1].children;
        if (Object.prototype.hasOwnProperty.call(parent, name)) parent[name] = Array.isArray(parent[name]) ? parent[name].concat([value]) : [parent[name], value];
        else parent[name] = value;
      }
    } else if (token.startsWith('<')) {
      if (stack.length > 20) throw new Error('XML nesting too deep');
      stack.push({ name: token.slice(1, -1).trim(), text: '', children: Object.create(null) });
    } else if (stack.length) stack[stack.length - 1].text += decodeEntities(token);
    else if (token.trim()) throw new Error('Text outside XML root');
  }
  if (stack.length || !root || root.name !== 'xml') throw new Error('Missing XML root');
  return root.value;
}

function parseMessage(text) {
  const trimmed = text.trim();
  const parsed = trimmed.startsWith('{') ? JSON.parse(trimmed) : parseXml(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid message');
  return parsed;
}

function decryptMessage(encrypted, key, appId) {
  if (typeof encrypted !== 'string' || encrypted.length > 1500000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) throw new Error('Invalid encrypted body');
  const bytes = Buffer.from(encrypted, 'base64');
  if (!bytes.length || bytes.length % 16) throw new Error('Invalid ciphertext length');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(bytes), decipher.final()]);
  const padding = padded[padded.length - 1];
  if (padding < 1 || padding > 32 || padding > padded.length || !padded.subarray(padded.length - padding).every(byte => byte === padding)) throw new Error('Invalid encryption padding');
  const clear = padded.subarray(0, padded.length - padding);
  if (clear.length < 20) throw new Error('Truncated message');
  const size = clear.readUInt32BE(16);
  if (size > 1000000 || 20 + size >= clear.length) throw new Error('Invalid cleartext length');
  const receiver = clear.subarray(20 + size).toString('utf8');
  if (receiver !== appId) throw new Error('Wrong message receiver');
  return clear.subarray(20, 20 + size).toString('utf8');
}

function createMediaCallback({ environment, onReview }) {
  const config = callbackConfiguration(environment);
  const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body });
  return {
    enabled: config.enabled,
    async handle(event) {
      if (!config.enabled || typeof onReview !== 'function') return reply(503, 'callback unavailable');
      try {
        const method = String(event.httpMethod || event.requestContext && event.requestContext.http && event.requestContext.http.method || '').toUpperCase();
        const query = event.queryStringParameters || Object.fromEntries(new URLSearchParams(event.rawQueryString || ''));
        const timestamp = query.timestamp;
        const nonce = query.nonce;
        if (typeof timestamp !== 'string' || !/^\d{1,16}$/.test(timestamp) || typeof nonce !== 'string' || !nonce.length || nonce.length > 256) return reply(403, 'invalid signature');
        if (method === 'GET') {
          const echo = query.echostr;
          if (typeof echo !== 'string' || echo.length > 10000) return reply(400, 'invalid challenge');
          if (query.msg_signature) {
            if (!signed(query.msg_signature, [config.token, timestamp, nonce, echo])) return reply(403, 'invalid signature');
            return reply(200, decryptMessage(echo, config.key, config.appId));
          }
          if (!signed(query.signature, [config.token, timestamp, nonce])) return reply(403, 'invalid signature');
          return reply(200, echo);
        }
        if (method !== 'POST') return reply(405, 'method not allowed');
        if (typeof event.body !== 'string' || event.body.length > 1500000) return reply(400, 'invalid body');
        const outer = parseMessage(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
        const encrypted = outer.Encrypt;
        if (typeof encrypted !== 'string' || !signed(query.msg_signature, [config.token, timestamp, nonce, encrypted])) return reply(403, 'invalid signature');
        const plaintext = decryptMessage(encrypted, config.key, config.appId);
        const message = parseMessage(plaintext);
        if (message.MsgType !== 'event' || message.Event !== 'wxa_media_check' || message.appid !== config.appId || Number(message.version) !== 2 || typeof message.trace_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(message.trace_id)) return reply(400, 'invalid media event');
        const errorCode = typeof message.errcode === 'number' || typeof message.errcode === 'string' && /^-?\d+$/.test(message.errcode)
          ? Number(message.errcode) : NaN;
        const suggestion = message.result && message.result.suggest;
        const decision = Number.isFinite(errorCode) && errorCode === 0 && suggestion === 'pass' ? 'pass' : 'reject';
        try {
          await onReview({ traceId: message.trace_id, decision, errorCode: Number.isFinite(errorCode) ? errorCode : -1,
            callbackDigest: crypto.createHash('sha256').update(plaintext).digest('hex') });
        } catch (_) {
          // A verified event must be retried when durable receipt storage fails.
          return reply(503, 'please retry');
        }
        return reply(200, 'success');
      } catch (_) {
        // No raw callback, decrypted body, tokens or identity details enter logs.
        return reply(400, 'invalid callback');
      }
    }
  };
}

module.exports = { createMediaCallback, callbackConfiguration };
