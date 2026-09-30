'use strict';

const crypto = require('node:crypto');
const schema = require('./schema.json');
class SetupError extends Error { constructor(code) { super(code); this.code = code; } }
function authorized(secret, supplied, context) {
  if (context.OPENID || context.openid || typeof secret !== 'string' || !secret.trim() || Buffer.byteLength(secret) < 32 || typeof supplied !== 'string' || supplied.length > 4096) return false;
  const expected = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(expected, crypto.createHash('sha256').update(supplied).digest());
}
function createSetup(db, secret) {
  return async (event, context = {}) => {
    if (!event || !authorized(secret, event.setupSecret, context)) throw new SetupError('FORBIDDEN');
    if (!['inspect', 'createMissing'].includes(event.action)) throw new SetupError('UNKNOWN_ACTION');
    const result = { created: [], existing: [], missing: [], databaseRulesReady: false };
    for (const collection of schema.collections) {
      let exists = true;
      try { await db.collection(collection.name).limit(1).get(); }
      catch (error) {
        if (!/collection.*(?:not exist|not found)|DATABASE_COLLECTION_NOT_EXIST/i.test(String(error.errMsg || error.message || ''))) throw new SetupError('INSPECTION_FAILED');
        exists = false;
      }
      if (exists) { result.existing.push(collection.name); continue; }
      if (event.action === 'inspect') { result.missing.push(collection.name); continue; }
      try { await db.createCollection(collection.name); result.created.push(collection.name); }
      catch (error) {
        // A concurrent setup can win collection creation. Re-read to confirm it exists.
        if (!/already exist|COLLECTION_EXIST/i.test(String(error.errMsg || error.message || ''))) throw new SetupError('CREATE_FAILED');
        await db.collection(collection.name).limit(1).get(); result.existing.push(collection.name);
      }
    }
    // This function creates EMPTY collections only. It does not write profiles,
    // seed content, secrets or identity records and never claims ACLs are configured.
    return result;
  };
}
module.exports = { createSetup, authorized, SetupError };
