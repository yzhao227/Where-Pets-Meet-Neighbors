'use strict';

const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;
const pad = value => String(value).padStart(2, '0');

function shanghaiDate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  // Read UTC fields after the China Standard Time offset so browser and
  // WeChat hosts produce the same label without depending on the device zone.
  const date = new Date(value + SHANGHAI_OFFSET);
  return Number.isFinite(date.getTime()) ? date : null;
}

function publication(post, now = Date.now()) {
  const item = post && typeof post === 'object' ? post : {};
  const created = shanghaiDate(item.createdAt);
  const today = shanghaiDate(now);
  // The owner supplied these display defaults for the existing content catalogue.
  // Keep source timestamps, linked places and new member posts unchanged.
  const legacyCatalogue = item.catalogManaged === true || item.createdAt === 0 && !!(item.author && item.author.isEditorial === true);
  let publishTimeText = legacyCatalogue ? '09-30' : '时间未标注';
  if (created) {
    const year = created.getUTCFullYear();
    const yearText = !today || year !== today.getUTCFullYear() ? year + '-' : '';
    publishTimeText = yearText + pad(created.getUTCMonth() + 1) + '-' + pad(created.getUTCDate()) + ' ' + pad(created.getUTCHours()) + ':' + pad(created.getUTCMinutes());
  }
  const title = item.place && typeof item.place.title === 'string' ? item.place.title.trim() : '';
  return { publishTimeText, publishPlaceText: title || (legacyCatalogue ? '莘庄' : '地点未标注') };
}

module.exports = { publication };
