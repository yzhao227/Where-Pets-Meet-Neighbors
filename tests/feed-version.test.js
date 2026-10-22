'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../miniprogram/services/api');

test('failed remote membership changes leave the feed version unchanged and successful changes invalidate it', async () => {
  let failure = 'transport';
  const client = createApi({ cloud: { async callFunction({ data: request }) {
    if (failure === 'transport') throw new Error('offline');
    if (failure === 'envelope') return { result: { ok: false, error: { code: 'FORBIDDEN', message: 'Denied' } } };
    if (request.action === 'bootstrap') return { result: { ok: true, data: { user: { id: 'test-owner' } } } };
    return { result: { ok: true, data: { success: true } } };
  } } }, { mode: 'cloud' });
  await assert.rejects(client.call('followUser', { userId: 'other', follow: false }), { code: 'NETWORK_ERROR' });
  assert.equal(client.getFeedVersion(), 0);
  failure = 'envelope';
  await assert.rejects(client.call('blockUser', { userId: 'other', block: true }), { code: 'FORBIDDEN' });
  assert.equal(client.getFeedVersion(), 0);
  failure = '';
  await client.call('followUser', { userId: 'other', follow: false });
  assert.equal(client.getFeedVersion(), 1);
  await client.call('likePost', { id: 'post', like: true });
  await client.call('addComment', { targetType: 'post', targetId: 'post', text: 'Hi' });
  await client.call('bootstrap');
  assert.equal(client.getFeedVersion(), 1);
  const deleted = await client.call('deleteAccount');
  assert.equal(deleted.localCleanup.status, 'failed', 'a cleanup failure must not hide a committed server deletion');
  assert.equal(client.getFeedVersion(), 2);
  assert.equal(createApi(null, { mode: 'demo' }).getFeedVersion(), 0, 'versions belong to each client session');
});
