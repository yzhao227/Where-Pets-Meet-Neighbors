'use strict';

// Domain code only uses deterministic document reads inside transactions.
// Cloud database transactions do not support arbitrary collection queries.
const COLLECTIONS = ['users', 'settings', 'circles', 'memberships', 'posts', 'comments',
  'events', 'registrations', 'messages', 'blocks', 'reports', 'uploads', 'outbox', 'likes', 'bookmarks', 'follows', 'identities', 'phone_claims', 'rate_limits', 'media_reviews',
  'friend_requests', 'friendships', 'conversations', 'chat_messages', 'chat_reads',
  'place_records', 'place_bookmarks', 'place_visits', 'place_corrections', 'nearby_submissions'];

function missing(error) {
  return /does not exist|not exist|not found|DOCUMENT_NOT_EXIST/i.test(String(error && (error.errMsg || error.message)));
}

function createRepository(db) {
  const command = db.command;
  const make = (access) => ({
    async get(collection, id) {
      try {
        const result = await access.collection(`yb_${collection}`).doc(id).get();
        return result.data || null;
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async set(collection, id, value) {
      const data = { ...value }; delete data._id;
      await access.collection(`yb_${collection}`).doc(id).set({ data });
      return { ...data, _id: id };
    },
    async remove(collection, id) {
      await access.collection(`yb_${collection}`).doc(id).remove();
    }
  });
  return {
    ...make(db),
    async find(collection, filters = {}, options = {}) {
      const where = {};
      for (const [field, value] of Object.entries(filters)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const parts = Object.entries(value).map(([operator, operand]) => {
            if (!['lt', 'lte', 'gt', 'gte', 'neq', 'in'].includes(operator)) throw new Error('Unsupported query operator');
            return command[operator](operand);
          });
          where[field] = parts.length === 1 ? parts[0] : command.and(parts);
        } else where[field] = value;
      }
      let query = db.collection(`yb_${collection}`).where(where);
      if (options.orderBy) query = query.orderBy(options.orderBy, options.direction || 'asc');
      query = query.limit(Math.max(1, Math.min(100, options.limit || 20)));
      return (await query.get()).data || [];
    },
    transaction(fn) { return db.runTransaction(transaction => fn(make(transaction))); }
  };
}

module.exports = { createRepository, COLLECTIONS };
