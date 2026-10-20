'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const events = require('../miniprogram/data/nearby-events-20260930');
const catalogue = require('../miniprogram/data/nearby-catalogue');
const { getTimeStatus, selectNearbyRecords, playTagsFor } = require('../miniprogram/data/nearby-utils');
const participationFor = require('../miniprogram/data/nearby-participation');
const presentation = require('../miniprogram/pages/nearby/presentation');

const cruiseId = 'event-longhua-pet-cruise-2026';
const showId = 'event-monaco-dog-show-2026';
const cruise = events.find(record => record.id === cruiseId);
const show = events.find(record => record.id === showId);
const sourceUrl = 'https://news.qq.com/rain/a/20260929A0BPRQ00';

// Date and eligibility expectations come from the 2026-09-29 Shanghai Xuhui
// announcement, independently retrieved on 2026-09-30. The dog-show schedule
// and price were clarified by the Sept 21 organizer poster read on Oct 3.
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
    [cruise, '2026-10-01', '2026-10-07', '2026-10-08', '01']
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

test('the turtle expo closes its participation guide after the reported final session without inventing official opening hours', () => {
  const record = catalogue.records.find(item => item.id === 'event-shanghai-turtle-expo-2026');
  assert.ok(record);
  assert.equal(record.datePrecision, 'day');
  assert.equal(record.startsAt, '2026-10-10T00:00:00+08:00');
  assert.equal(record.endsAt, '2026-10-13T00:00:00+08:00');

  for (const [now, expectedStatus] of [
    ['2026-10-12T18:00:52+08:00', 'ongoing'],
    ['2026-10-13T00:00:00+08:00', 'ended']
  ]) {
    const timeStatus = getTimeStatus(record, now);
    assert.equal(timeStatus, expectedStatus);
    const guide = participationFor(record, { timeStatus });
    assert.equal(guide.evidenceSignature, participationFor.recordSignature(record), 'the editorial closure must match the current sourced facts');
    assert.equal(guide.state, 'closed', now);
    assert.deepEqual(guide.steps, [], 'no ticket-buying, last-session or arrival directions remain actionable');
    for (const field of ['fee', 'contact', 'contactLabel']) assert.equal(guide[field], '', field);
    assert.ok(record.sources.some(source => source.url === guide.sourceUrl), 'the retained historical link still points to the record evidence');
    if (timeStatus === 'ongoing') {
      assert.match([guide.label, guide.title, guide.note].join('\n'), /转载/, 'closing current directions does not upgrade reprinted session times to first-party confirmation');
    }
  }
});

test('changed turtle-expo facts invalidate its editorial closure while a research-date refresh preserves it', () => {
  const base = catalogue.records.find(item => item.id === 'event-shanghai-turtle-expo-2026');
  const now = '2026-10-12T18:00:52+08:00';
  const guideFor = record => participationFor(record, { timeStatus: getTimeStatus(record, now) });
  const initial = guideFor(base);
  assert.equal(initial.state, 'closed');

  const refreshed = structuredClone(base);
  refreshed.sources.forEach(source => { source.checkedAt = '2026-10-13'; });
  assert.equal(participationFor.recordSignature(refreshed), initial.evidenceSignature);
  assert.equal(guideFor(refreshed).state, 'closed', 'rechecking the same evidence must not revive old admission instructions');

  for (const mutate of [
    record => { record.notice = '仅测试：主办方补充了新的参与安排，需重新核验。'; },
    record => { record.sources.push({ publisher: '仅测试主办方', title: '仅测试：参与安排更新', url: 'https://example.invalid/turtle-expo-update', publishedAt: '2026-10-12' }); }
  ]) {
    const changed = structuredClone(base);
    mutate(changed);
    assert.notEqual(participationFor.recordSignature(changed), initial.evidenceSignature);
    assert.ok(changed.sources.some(source => source.url === initial.sourceUrl), 'the old evidence URL can remain present after a genuine update');
    const guide = guideFor(changed);
    assert.equal(guide.state, 'pending', 'new facts require a fresh editorial decision instead of retaining a stale closure');
    assert.equal(guide.evidenceSignature, undefined);
    assert.notEqual(guide.title, initial.title);
    assert.equal(guide.contact, '');
    if (changed.sources.length > base.sources.length) assert.equal(guide.sourceUrl, 'https://example.invalid/turtle-expo-update');
  }
});

test('the confirmed dog-show timetable replaces midnight boundaries and closes after the final session', () => {
  assert.equal(getTimeStatus(show, '2026-10-04T00:00:00+08:00'), 'upcoming');
  assert.equal(getTimeStatus(show, '2026-10-04T11:29:59+08:00'), 'upcoming');
  assert.equal(getTimeStatus(show, '2026-10-04T11:30:00+08:00'), 'ongoing');
  assert.equal(getTimeStatus(show, '2026-10-06T17:59:59+08:00'), 'ongoing');
  for (const now of ['2026-10-06T18:00:00+08:00', '2026-10-06T10:00:00Z']) {
    assert.equal(getTimeStatus(show, now), 'ended');
    assert.equal(selectNearbyRecords([show], { now }).length, 0);
    assert.equal(selectNearbyRecords([show], { now, history: true }).length, 1);
  }
  assert.equal(presentation(show).stampDay, '04');
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
  assert.equal(show.feeType, 'paid', 'the verified 288-yuan competitor package is not free spectator admission');
  assert.match(show.ticketText, /查询|确认/);
});
