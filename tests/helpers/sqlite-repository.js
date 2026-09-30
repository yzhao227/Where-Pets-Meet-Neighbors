'use strict';

// Integration-test adapter only. Production continues to use CloudBase.
const { DatabaseSync } = require('node:sqlite');
function createSqliteRepository(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (collection,id))');
  const select = db.prepare('SELECT body FROM documents WHERE collection = ? AND id = ?');
  const list = db.prepare('SELECT body FROM documents WHERE collection = ? ORDER BY id');
  const upsert = db.prepare('INSERT INTO documents(collection,id,body) VALUES (?,?,?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body');
  const drop = db.prepare('DELETE FROM documents WHERE collection=? AND id=?');
  let lock = Promise.resolve();
  const enqueue = task => { const job = lock.then(task); lock = job.catch(() => {}); return job; };
  const read = (name, id) => { const row = select.get(name, id); return row ? JSON.parse(row.body) : null; };
  const compare = (actual, expected) => {
    if (!expected || typeof expected !== 'object') return actual === expected;
    return Object.entries(expected).every(([op, value]) => ({ lt: () => actual < value, lte: () => actual <= value, gt: () => actual > value,
      gte: () => actual >= value, neq: () => actual !== value, in: () => value.includes(actual) })[op]());
  };
  return {
    async get(name, id) { return read(name, id); },
    set(name, id, value) { return enqueue(() => upsert.run(name, id, JSON.stringify({ ...value, _id: id }))); },
    remove(name, id) { return enqueue(() => drop.run(name, id)); },
    async find(name, filters = {}, options = {}) {
      const rows = list.all(name).map(row => JSON.parse(row.body)).filter(row => Object.entries(filters).every(([key, value]) => compare(row[key], value)));
      if (options.orderBy) rows.sort((a, b) => a[options.orderBy] < b[options.orderBy] ? -1 : a[options.orderBy] > b[options.orderBy] ? 1 : 0);
      if (options.direction === 'desc') rows.reverse();
      return rows.slice(0, options.limit || 20);
    },
    transaction(fn) {
      return enqueue(async () => {
        // Buffer mutations so unrelated readers never see an in-flight transaction.
        const pending = new Map();
        const key = (name, id) => JSON.stringify([name, id]);
        const tx = {
          async get(name, id) { const row = pending.get(key(name, id)); return structuredClone(row ? row.value : read(name, id)); },
          async set(name, id, value) { pending.set(key(name, id), { name, id, value: structuredClone({ ...value, _id: id }) }); },
          async remove(name, id) { pending.set(key(name, id), { name, id, value: null }); }
        };
        const result = await fn(tx);
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const row of pending.values()) {
            if (row.value === null) drop.run(row.name, row.id);
            else upsert.run(row.name, row.id, JSON.stringify(row.value));
          }
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return result;
      });
    },
    async close() { await lock; db.close(); }
  };
}
module.exports = { createSqliteRepository };
