'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const events = require('../miniprogram/data/nearby-events-20260930');
const catalogue = require('../miniprogram/data/nearby-catalogue');
const { getTimeStatus, selectNearbyRecords, playTagsFor } = require('../miniprogram/data/nearby-utils');
const presentation = require('../miniprogram/pages/nearby/presentation');

const cruiseId = 'event-longhua-pet-cruise-2026';
const showId = 'event-monaco-dog-show-2026';
const cruise = events.find(record => record.id === cruiseId);
const show = events.find(record => record.id === showId);
const sourceUrl = 'https://news.qq.com/rain/a/20260929A0BPRQ00';

// Date and eligibility expectations come from the 2026-09-29 Shanghai Xuhui
// announcement, independently retrieved on 2026-09-30. See the source audit.
test('the newly sourced National Day events are available in the actual nearby catalogue', () => {
  const listed = selectNearbyRecords(catalogue.records, { kind: 'event', now: '2026-09-30T12:00:00+08:00' });
  for (const id of [cruiseId, showId]) {
    const record = listed.find(item => item.id === id);
    assert.ok(record, id + ' must be visible before its published start date');
    assert.equal(record.timeStatus, 'upcoming');
    assert.ok(record.sources.some(source => source.url === sourceUrl && source.publishedAt === '2026-09-29'));
  }
});

test('published date-only ranges include the final Shanghai calendar day and end at the following midnight', () => {
  for (const [record, start, finalDay, nextDay, stamp] of [
    [cruise, '2026-10-01', '2026-10-07', '2026-10-08', '01'],
    [show, '2026-10-04', '2026-10-06', '2026-10-07', '04']
  ]) {
    const startTime = Date.parse(start + 'T00:00:00+08:00');
    const endTime = Date.parse(nextDay + 'T00:00:00+08:00');
    assert.equal(getTimeStatus(record, startTime - 1), 'upcoming', record.id);
    assert.equal(getTimeStatus(record, startTime), 'ongoing', record.id);
    assert.equal(getTimeStatus(record, finalDay + 'T23:59:59+08:00'), 'ongoing', record.id + ' includes its last published day');
    assert.equal(getTimeStatus(record, endTime), 'ended', record.id);
    assert.equal(getTimeStatus(record, new Date(endTime).toISOString()), 'ended', record.id + ' is independent of the device time zone');
    assert.equal(selectNearbyRecords([record], { now: endTime }).length, 0);
    assert.equal(selectNearbyRecords([record], { now: endTime, history: true }).length, 1);
    assert.equal(record.datePrecision, 'day');
    assert.doesNotMatch(record.dateLabel, /00:00/, 'interval boundaries are not presented as opening or sailing hours');
    assert.equal(presentation(record).stampDay, stamp);
  }
});

test('a pet cruise or dog competition does not imply a confirmed pet-free visitor option', () => {
  const selected = selectNearbyRecords(events, { petFilter: 'without', now: '2026-10-04T12:00:00+08:00' });
  assert.deepEqual(selected.filter(record => [cruiseId, showId].includes(record.id)), []);
  for (const record of [cruise, show]) {
    assert.equal(record.noPetRequired, false, record.id + ': the source does not explicitly confirm this visitor option');
    assert.doesNotMatch(record.petPolicy.text, /必须带宠|必须携宠|仅限携宠游客/, 'unconfirmed pet-free entry must not become a pet requirement');
  }
});

test('afternoon pet cruises never inherit the separate night cruise booking or pet permission', () => {
  assert.equal(cruise.petPolicy.status, 'conditional');
  assert.match(cruise.dateLabel, /下午/);
  assert.match(cruise.petPolicy.text, /下午指定航班/);
  assert.match(cruise.petPolicy.text, /夜航未确认可携宠/);
  assert.match(presentation(cruise).petHint, /指定.*航班|下午指定/);
  assert.match(cruise.ticketText, /咨询|确认/);
  assert.doesNotMatch([cruise.dateLabel, cruise.ticketText, ...cruise.highlights].join('\n'), /小程序/,
    'the only source instruction about mini-program departure times belongs to the night cruise section');
  assert.equal(cruise.hostName, undefined, 'the article byline must not be turned into an afternoon-event organizer');
  assert.deepEqual(playTagsFor(cruise), [], 'a boat trip does not establish a dog playground or off-leash activity');
});

test('dog-show eligibility remains attached to competitors and does not promise ordinary spectator pet access', () => {
  assert.equal(show.petPolicy.status, 'conditional');
  for (const term of ['参赛', '9个月至9岁', '健康', '检疫证明', '狂犬病免疫证明', '养犬登记证', '烈性犬', '怀孕', '哺乳', '发情', '传染病', '身体不适', '攻击倾向']) {
    assert.ok(show.petPolicy.text.includes(term), 'the source eligibility condition is retained: ' + term);
  }
  assert.match(show.petPolicy.text, /普通观众携犬规则另询/);
  assert.match(presentation(show).petHint, /参赛/);
  assert.deepEqual(playTagsFor(show).map(tag => tag.id), ['agility'], 'only the sourced agility programme is a pet-play tag');
  assert.equal(show.feeType, 'unknown', 'a ticket giveaway does not establish free admission');
  assert.match(show.ticketText, /查询|确认/);
});
