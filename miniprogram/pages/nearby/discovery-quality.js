'use strict';

const { DEFAULT_FILTERS } = require('../../data/nearby-controls');
const { isLocalScenePhoto } = require('../../data/nearby-utils');
const { normalizePoint } = require('../../utils/geo');

const FEATURED_LIMIT = 6;
const FEATURED_MINIMUM = 4;
const text = value => typeof value === 'string' ? value.trim() : '';
const publicUrl = value => /^https:\/\/[A-Za-z0-9.-]+(?:[/?#][^\s<>"\\]*)?$/.test(text(value));

function hasScenePhoto(item) {
  // photoUrl is the decorated, currently usable image. A failed image and an
  // illustrative fallback never qualify merely because a raw cover exists.
  const url = text(item.photoUrl);
  if (!url || (!isLocalScenePhoto(url) && !publicUrl(url))) return false;
  return [item.photo].concat(Array.isArray(item.photos) ? item.photos : []).some(photo => photo &&
    photo.url === url && publicUrl(photo.sourceUrl) && text(photo.credit) && text(photo.license));
}

function hasNavigation(item) {
  const point = item.point;
  return !!(normalizePoint(point) && ['venue', 'entrance'].includes(point.precision) && publicUrl(point.sourceUrl));
}

function hasPublicSource(item) {
  return Array.isArray(item.sources) && item.sources.some(source => source && publicUrl(source.url) &&
    text(source.title) && text(source.publisher));
}

function isManualSelection(options) {
  const selected = (value, empty) => text(value) && !empty.includes(text(value));
  if (text(options.query) || selected(options.sort, ['recommended']) ||
      selected(options.district, ['all', '全部', '全部区域', '全上海']) ||
      selected(options.area, ['all', '全部', '全部片区']) || selected(options.playTag, ['all'])) return true;
  const filters = options.filters || {};
  return Object.keys(DEFAULT_FILTERS).some(key => filters[key] !== undefined && filters[key] !== DEFAULT_FILTERS[key]);
}

/**
 * Partition already decorated and filtered place cards for the default view.
 * Both arrays contain the original objects exactly once; the caller retains
 * its complete `places` array. Search, filters and deliberate sorts bypass this
 * presentation entirely. This module never computes distance or popularity.
 */
function splitDiscoveryCards(items, options = {}) {
  const all = Array.isArray(items) ? items : [];
  const uncurated = () => ({ featured: all.slice(), more: [], curatedMode: false });
  if (isManualSelection(options || {})) return uncurated();

  const candidates = [], illustrated = [];
  all.forEach((item, index) => {
    if (!item || item.type !== 'place' || item.active === false || item.needsRecheck === true) return;
    const pet = !!(item.petPolicy && ['allowed', 'conditional'].includes(item.petPolicy.status) && text(item.petPolicy.text));
    // noPetRequired is a broad filter, not an editorial recommendation to visit
    // without a pet. Only the explicit visitWithoutPet flag establishes that.
    if (!pet && item.visitWithoutPet !== true) return;
    const photo = hasScenePhoto(item), navigation = hasNavigation(item);
    if (photo || navigation) candidates.push({ item, index, pet, photo, navigation });
    // An illustration is presentation, not evidence. A documented admission
    // rule and a named public source can support a place without a scene photo.
    else if (hasPublicSource(item)) illustrated.push({ item, index, pet, photo, navigation });
  });
  if (!candidates.length && !illustrated.length) return uncurated();

  candidates.sort((a, b) => Number(b.photo) - Number(a.photo) || Number(b.pet) - Number(a.pet) ||
    Number(b.navigation) - Number(a.navigation) || a.index - b.index);
  illustrated.sort((a, b) => Number(b.pet) - Number(a.pet) || a.index - b.index);
  const eligible = candidates.concat(illustrated);
  const target = candidates.length > FEATURED_MINIMUM ? FEATURED_LIMIT : FEATURED_MINIMUM;
  let count = Math.min(target, eligible.length);
  // Keep two-column rows full when further records remain behind "more".
  // A genuinely small or odd-sized complete list keeps all its real records.
  if (count > 1 && count % 2 === 1 && count < all.length) count -= 1;
  const selected = eligible.slice(0, count);
  const indices = new Set(selected.map(entry => entry.index));
  return {
    featured: selected.map(entry => entry.item),
    more: all.filter((_, index) => !indices.has(index)),
    curatedMode: true
  };
}

module.exports = { splitDiscoveryCards };
