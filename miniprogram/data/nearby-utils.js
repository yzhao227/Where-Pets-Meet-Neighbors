'use strict';

const RECORD_TYPES = ['place', 'exhibition', 'event'];
const PLAY_TAGS = [
  { id: 'walk', name: '牵绳散步', description: '在允许携宠的步道慢慢探索，全程牵引并及时清理。' },
  { id: 'lawn', name: '草地探索', description: '在已开放的草坪嗅闻、散步；草坪不代表可以脱绳。' },
  { id: 'social', name: '宠友互动', description: '先征得对方主人同意，让宠物在可控距离认识新朋友。' },
  { id: 'hangout', name: '随行休息', description: '在明确开放的宠物休憩区域停留，室内规则另行确认。' },
  { id: 'agility', name: '障碍闯关', description: '按现场规则体验障碍设施或赛事，量力参与。' },
  { id: 'training', name: '训犬体验', description: '按主办方安排参加训练指导，提前确认报名与犬只要求。' },
  // Legacy editorial categories are retained for old catalogue validation only.
  { id: 'exhibition', name: '宠物主题展', legacy: true }, { id: 'animals', name: '动物互动', legacy: true }
];

function playTagsFor(record) {
  if (!record) return [];
  const tags = Array.isArray(record.petPlayTags) ? record.petPlayTags : [];
  if (!['allowed', 'conditional'].includes(record.petPolicy && record.petPolicy.status)) return [];
  return PLAY_TAGS.filter(tag => !tag.legacy && tags.includes(tag.id));
}

function isLocalScenePhoto(value) {
  return typeof value === 'string' && /^\/assets\/nearby\/[a-z0-9][a-z0-9_-]{0,79}\.(?:jpe?g|webp)$/i.test(value);
}

function matchesDiscoveryFilters(record, settings) {
  const district = text(settings.district);
  if (district && district !== 'all' && district !== '全部' && text(record.district) !== district) return false;
  const playTag = text(settings.playTag);
  return !playTag || playTag === 'all' || playTagsFor(record).some(tag => tag.id === playTag);
}

function text(value) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

// Catalogue dates must carry a time zone; a device's local zone must not shift an event.
function timestamp(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] || 0) > 59) return NaN;
  const zone = match[8];
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(4, 6));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return NaN;
  }
  return Date.parse(value);
}

function referenceTime(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return Number.isFinite(now) ? now : NaN;
  return timestamp(now);
}

/**
 * A place has no event clock (null). Events need a valid, complete time interval.
 * Intervals include their start and exclude their end. Unknown dates are undated,
 * never guessed from publication dates or treated as upcoming.
 */
function getTimeStatus(record, now = Date.now()) {
  if (!record || typeof record !== 'object') return 'undated';
  if (record.status === 'cancelled') return 'cancelled';
  if (record.type === 'place') return null;
  const start = timestamp(record.startsAt);
  const end = timestamp(record.endsAt);
  const current = referenceTime(now);
  if (![start, end, current].every(Number.isFinite) || end <= start) return 'undated';
  if (current < start) return 'upcoming';
  if (current >= end) return 'ended';
  return 'ongoing';
}

function matchesQuery(record, query) {
  const tokens = text(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = [record.title, record.area, record.district, record.city, record.address, record.summary, record.venue, record.categoryLabel, record.petPolicy && record.petPolicy.text, playTagsFor(record).map(tag => tag.name).join(' ')]
    .map(text).join(' ');
  return tokens.every(token => haystack.includes(token));
}

/**
 * Select a catalogue without mutating its records or changing editorial order.
 * kind: place / exhibition / event, or an array of these; omitted means all.
 * history: show ended events instead of upcoming/ongoing; places are unaffected.
 * without means "no pet required", independent of whether pets may enter.
 * Only records explicitly tagged noPetRequired: true qualify for that filter.
 * Cancelled entries stay hidden unless includeCancelled is explicitly true.
 */
function selectNearbyRecords(records, options = {}) {
  if (!Array.isArray(records)) return [];
  const settings = options || {};
  const kinds = settings.kind === undefined || settings.kind === null || settings.kind === 'all'
    ? RECORD_TYPES : (Array.isArray(settings.kind) ? settings.kind : [settings.kind]);
  const area = text(settings.area);
  const allAreas = !area || area === '全部' || area === 'all';
  const now = settings.now === undefined ? Date.now() : settings.now;
  return records.reduce((selected, record) => {
    if (!record || typeof record !== 'object' || !RECORD_TYPES.includes(record.type) || !kinds.includes(record.type)) return selected;
    if (!matchesDiscoveryFilters(record, settings)) return selected;
    if (!allAreas && text(record.area) !== area) return selected;
    if (!matchesQuery(record, settings.query)) return selected;
    const petStatus = record.petPolicy && record.petPolicy.status;
    if (settings.petFilter === 'with' && petStatus !== 'allowed' && petStatus !== 'conditional') return selected;
    if (settings.petFilter === 'without' && record.noPetRequired !== true) return selected;

    const timeStatus = getTimeStatus(record, now);
    if (timeStatus === 'cancelled') {
      if (settings.includeCancelled !== true) return selected;
    } else if (record.type !== 'place') {
      const accepted = settings.history === true ? timeStatus === 'ended' : timeStatus === 'upcoming' || timeStatus === 'ongoing';
      if (!accepted) return selected;
    }
    selected.push({ ...record, timeStatus });
    return selected;
  }, []);
}

// A month-only official announcement is a notice, never a dated event.
// Retire it after the announced Shanghai calendar month until editors update it.
function selectAnnouncements(records, options = {}) {
  if (!Array.isArray(records)) return [];
  const settings = options || {};
  const current = referenceTime(settings.now === undefined ? Date.now() : settings.now);
  if (!Number.isFinite(current)) return [];
  const shanghai = new Date(current + 8 * 3600000);
  const month = shanghai.getUTCFullYear() + '-' + String(shanghai.getUTCMonth() + 1).padStart(2, '0');
  return records.filter(record => record && ['event', 'exhibition'].includes(record.type) && record.status !== 'cancelled' &&
    /^\d{4}-(?:0[1-9]|1[0-2])$/.test(record.announcementMonth || '') && record.announcementMonth >= month &&
    getTimeStatus(record, current) === 'undated' && matchesQuery(record, settings.query) && matchesDiscoveryFilters(record, settings))
    .map(record => ({ ...record, timeStatus: 'undated' }));
}

module.exports = { getTimeStatus, selectNearbyRecords, selectAnnouncements, PLAY_TAGS, playTagsFor, isLocalScenePhoto };
