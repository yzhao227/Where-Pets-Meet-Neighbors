const api = require('./api');
const withSourcePhoto = require('../data/nearby-source-photos');
async function listAll(parameters = {}) {
  const items = []; let cursor; const seen = new Set();
  for (let count = 0; count < 40; count += 1) {
    const result = await api.call('listPlaces', { ...parameters, limit: 50, ...(cursor ? { cursor } : {}) });
    items.push(...result.items.map(withSourcePhoto));
    if (!result.nextCursor || seen.has(result.nextCursor)) return items;
    cursor = result.nextCursor; seen.add(cursor);
  }
  return items;
}
module.exports = { listAll };
