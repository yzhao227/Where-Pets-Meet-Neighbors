'use strict';

const crypto = require('node:crypto');

function isPositiveAction(action, payload) {
  if (action === 'respondFriendRequest') return payload.accept === true;
  if (['removeFriend', 'readConversation', 'leaveGroup'].includes(action)) return false;
  if (['joinCircle', 'joinEvent'].includes(action)) return payload.join === true;
  if (action === 'followUser') return payload.follow === true;
  if (action === 'likePost') return payload.like === true;
  if (action === 'bookmarkPost') return payload.bookmark === true;
  if (action === 'bookmarkPlace') return payload.bookmark === true;
  return !['verifyPhone'].includes(action);
}

function createRateLimiter({ repository, limits, now, fail }) {
  return {
    async consume(userId, action, lifecycleId) {
      const rule = limits[action]; if (!rule) return;
      const timestamp = now(); const start = Math.floor(timestamp / rule.windowMs) * rule.windowMs;
      const id = `rl_${crypto.createHash('sha256').update(`${userId}:${action}:${start}:${rule.windowMs}`).digest('hex')}`;
      await repository.transaction(async tx => {
        const user = await tx.get('users', userId);
        if (!user || user.status !== 'active' || lifecycleId && user.lifecycleId !== lifecycleId) fail('ACCOUNT_UNAVAILABLE', '账号正在清理，请稍后再试');
        const current = await tx.get('rate_limits', id);
        if (current && current.count >= rule.limit) fail('RATE_LIMITED', '操作有些频繁，请稍后再试');
        await tx.set('rate_limits', id, { userId, action, windowStart: start, count: (current && current.count || 0) + 1,
          expiresAt: start + rule.windowMs + 86400000, updatedAt: timestamp });
      });
    }
  };
}

module.exports = { createRateLimiter, isPositiveAction };
