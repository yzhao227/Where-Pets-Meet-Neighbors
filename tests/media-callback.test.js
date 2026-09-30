'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaCallback } = require('../cloudfunctions/community/media-callback');
const { callbackEnvironment: environment, signed, encrypt, reviewMessage, callbackEvent } = require('./helpers/media-fixtures');

function fixture(onReview) {
  const receipts = [];
  const callback = createMediaCallback({ environment, onReview: onReview || (async result => receipts.push(result)) });
  return { callback, receipts };
}

test('authenticated encrypted JSON media callback records only normalized decision metadata', async () => {
  const { callback, receipts } = fixture();
  assert.equal((await callback.handle(callbackEvent())).statusCode, 200);
  assert.equal(receipts.length, 1);
  assert.deepEqual(Object.keys(receipts[0]).sort(), ['callbackDigest', 'decision', 'errorCode', 'traceId']);
  assert.equal(receipts[0].traceId, 'trace-test-1');
  assert.equal(receipts[0].decision, 'pass');
  assert.match(receipts[0].callbackDigest, /^[a-f0-9]{64}$/);
});

test('encrypted XML and base64 HTTP bodies support the v2 event payload', async () => {
  const { callback, receipts } = fixture();
  const xml = '<xml><MsgType><![CDATA[event]]></MsgType><Event>wxa_media_check</Event><appid>' + environment.MEDIA_CALLBACK_APP_ID + '</appid><trace_id>xml-trace</trace_id><version>2</version><errcode>0</errcode><result><suggest>pass</suggest></result></xml>';
  assert.equal((await callback.handle(callbackEvent(xml, { xml: true, base64: true }))).statusCode, 200);
  assert.equal(receipts[0].traceId, 'xml-trace');
  assert.equal(receipts[0].decision, 'pass');
});

test('forged signatures and plaintext callbacks cannot reach review persistence', async () => {
  const { callback, receipts } = fixture(); const event = callbackEvent();
  event.queryStringParameters.msg_signature = '0'.repeat(40);
  assert.equal((await callback.handle(event)).statusCode, 403);
  const plaintext = { ...callbackEvent(), body: JSON.stringify(reviewMessage()) };
  assert.equal((await callback.handle(plaintext)).statusCode, 403);
  assert.equal(receipts.length, 0);
});

test('receiver, application, event kind and API version are bound before accepting media results', async () => {
  const { callback, receipts } = fixture();
  const invalid = [callbackEvent(reviewMessage(), { receiver: 'wxother0123456789' }), callbackEvent(reviewMessage({ appid: 'wxother0123456789' })),
    callbackEvent(reviewMessage({ Event: 'unrelated_event' })), callbackEvent(reviewMessage({ version: 1 })), callbackEvent(reviewMessage({ trace_id: '../../uploads' }))];
  for (const event of invalid) assert.equal((await callback.handle(event)).statusCode, 400);
  assert.equal(receipts.length, 0);
});

test('review, rejection, missing decision and API errors never become a pass', async () => {
  const { callback, receipts } = fixture();
  for (const override of [{ result: { suggest: 'review' } }, { result: { suggest: 'risky' } }, { result: {} }, { errcode: 87014 }, { errcode: undefined }, { errcode: null }]) {
    assert.equal((await callback.handle(callbackEvent(reviewMessage(override)))).statusCode, 200);
  }
  assert.equal(receipts.length, 6);
  assert.ok(receipts.every(receipt => receipt.decision === 'reject'));
});

test('durable receipt failure returns 503 so the verified callback can be retried', async () => {
  let attempts = 0;
  const { callback } = fixture(async () => { attempts += 1; if (attempts === 1) throw new Error('database unavailable'); });
  const event = callbackEvent();
  assert.equal((await callback.handle(event)).statusCode, 503);
  assert.equal((await callback.handle(event)).statusCode, 200);
  assert.equal(attempts, 2);
});

test('challenge verification supports signed plaintext and encrypted echo responses', async () => {
  const { callback, receipts } = fixture(); const timestamp = '1800000000'; const nonce = 'nonce';
  const plain = { httpMethod: 'GET', queryStringParameters: { timestamp, nonce, echostr: 'challenge', signature: signed([environment.MEDIA_CALLBACK_TOKEN, timestamp, nonce]) } };
  assert.deepEqual((await callback.handle(plain)).body, 'challenge');
  const echostr = encrypt('encrypted-challenge');
  const secure = { httpMethod: 'GET', queryStringParameters: { timestamp, nonce, echostr, msg_signature: signed([environment.MEDIA_CALLBACK_TOKEN, timestamp, nonce, echostr]) } };
  assert.equal((await callback.handle(secure)).body, 'encrypted-challenge');
  plain.queryStringParameters.signature = 'f'.repeat(40);
  assert.equal((await callback.handle(plain)).statusCode, 403);
  assert.equal(receipts.length, 0);
});

test('malformed XML, duplicate encrypted fields and invalid AES padding fail closed', async () => {
  const { callback, receipts } = fixture();
  const entity = '<!DOCTYPE xml [<!ENTITY x SYSTEM "file:///etc/passwd">]><xml><MsgType>&x;</MsgType></xml>';
  assert.equal((await callback.handle(callbackEvent(entity))).statusCode, 400);
  assert.equal((await callback.handle(callbackEvent(reviewMessage(), { badPadding: true }))).statusCode, 400);
  const event = callbackEvent(); const encrypted = JSON.parse(event.body).Encrypt;
  event.body = '<xml><Encrypt>' + encrypted + '</Encrypt><Encrypt>' + encrypted + '</Encrypt></xml>';
  assert.equal((await callback.handle(event)).statusCode, 403);
  assert.equal(receipts.length, 0);
});

test('missing configuration and unsupported methods do not claim successful delivery', async () => {
  assert.equal((await createMediaCallback({ environment: {}, onReview: async () => {} }).handle(callbackEvent())).statusCode, 503);
  const { callback } = fixture();
  assert.equal((await callback.handle({ ...callbackEvent(), httpMethod: 'DELETE' })).statusCode, 405);
});
