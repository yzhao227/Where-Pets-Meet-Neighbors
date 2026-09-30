'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../miniprogram/pages/_shared');
const formTools = require('../miniprogram/social/submission-form');
const event = (id, field, value) => ({ currentTarget: { dataset: { id, field } }, detail: { value } });
const valueEvent = value => ({ detail: { value } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const fields = () => ({ type: 'place', title: '仅测试公共地点', city: '上海', district: '徐汇区', area: '测试片区', address: '仅测试公共场所地址 1 号', description: '这是仅在隔离内存中使用的真实流程测试介绍。', sourceUrl: '', petPolicyStatus: 'unknown', petPolicyText: '', costText: '', startDate: '', endDate: '' });
const row = (id, status = 'pending', extra = {}) => ({ ...fields(), id, status, createdAt: 1790755200000, ...extra });

function fixture(t, name, isAdmin = false) {
  const effects = { calls: [], routes: [], toasts: [], copied: [], modals: [], writesAfterUnload: 0, confirm: true };
  const handlers = {
    bootstrap: () => ({ mode: 'demo', user: { id: 'memory-user', isAdmin } }),
    listNearbySubmissions: () => ({ items: [] })
  };
  const previous = { wx: global.wx, Page: global.Page, call: shared.api.call };
  global.wx = {
    getStorageSync() { throw new Error('This page test must not access real storage'); },
    setStorageSync() { throw new Error('This page test must not write real storage'); },
    stopPullDownRefresh() {}, showToast: options => effects.toasts.push(options.title),
    showModal: options => { effects.modals.push(options); options.success({ confirm: effects.confirm }); },
    navigateTo: options => effects.routes.push(options.url), setClipboardData: options => effects.copied.push(options.data)
  };
  shared.api.call = async (action, payload = {}) => {
    effects.calls.push({ action, payload: structuredClone(payload) });
    if (!handlers[action]) throw new Error('Unexpected API: ' + action);
    return handlers[action](payload);
  };
  let definition;
  global.Page = value => { definition = value; };
  const filename = require.resolve('../miniprogram/social/pages/' + name + '/index.js');
  delete require.cache[filename]; require(filename);
  const page = { ...definition, data: structuredClone(definition.data), setData(values) { if (this._closed) effects.writesAfterUnload += 1; Object.assign(this.data, values); } };
  t.after(() => { if (!page._closed) page.onUnload(); global.wx = previous.wx; global.Page = previous.Page; shared.api.call = previous.call; });
  return { page, handlers, effects };
}
function fill(page, supplied = fields()) {
  page.selectType(event(supplied.type));
  for (const field of formTools.textFields) page.input(event('', field, supplied[field] || ''));
  page.selectPolicy(valueEvent(formTools.policyChoices.findIndex(item => item.id === supplied.petPolicyStatus)));
}

test('contribution validates required public fields and never accepts ownership, publication, photos or coordinates', async t => {
  const { page, effects } = fixture(t, 'contribute');
  await page.onLoad({}); await page.submit();
  assert.match(page.data.formError, /名称/);
  assert.equal(effects.calls.some(call => call.action === 'submitNearbySubmission'), false);
  for (const key of ['ownerId', 'userId', 'role', 'status', 'photos', 'latitude', 'longitude']) page.input(event('', key, 'injected'));
  assert.equal(Object.keys(page.data.form).some(key => ['ownerId', 'userId', 'role', 'status', 'photos', 'latitude', 'longitude'].includes(key)), false);
  assert.deepEqual(effects.calls.find(call => call.action === 'listNearbySubmissions').payload, { mine: true, status: 'all' });
});

test('uncertain submit failures keep identical payload and request ID until success without clearing the draft early', async t => {
  const { page, handlers, effects } = fixture(t, 'contribute');
  await page.onLoad({}); fill(page);
  const first = deferred(); handlers.submitNearbySubmission = () => first.promise;
  const submitting = page.submit(); await page.submit();
  assert.equal(page.data.form.title, fields().title);
  assert.equal(effects.calls.filter(call => call.action === 'submitNearbySubmission').length, 1);
  first.reject(new Error('仅测试存储响应失败')); await submitting;
  assert.equal(page.data.attemptLocked, true);
  page.input(event('', 'title', '不能改动')); assert.equal(page.data.form.title, fields().title);
  handlers.submitNearbySubmission = () => ({ submission: row('new-row') });
  handlers.listNearbySubmissions = () => ({ items: [row('new-row')] });
  await page.submit();
  const calls = effects.calls.filter(call => call.action === 'submitNearbySubmission');
  assert.deepEqual(calls[0].payload, calls[1].payload);
  assert.ok(/^[A-Za-z0-9_-]{8,100}$/.test(calls[0].payload.requestId));
  assert.equal(page.data.tab, 'mine'); assert.equal(page.data.form.title, '');
  assert.match(page.data.notice, /本机/); assert.equal(page.data.items[0].id, 'new-row');
});

test('definite content failures keep an editable draft and omit client-only form properties from submission', async t => {
  const { page, handlers, effects } = fixture(t, 'contribute');
  await page.onLoad({}); fill(page);
  handlers.submitNearbySubmission = () => { const error = new Error('仅测试内容未通过'); error.code = 'CONTENT_REJECTED'; throw error; };
  await page.submit(); assert.equal(page.data.attemptLocked, false);
  page.input(event('', 'title', '修改后的测试地点'));
  await page.submit();
  const calls = effects.calls.filter(call => call.action === 'submitNearbySubmission');
  assert.equal(calls[0].payload.requestId, calls[1].payload.requestId);
  assert.equal(calls[1].payload.title, '修改后的测试地点');
  assert.equal('policyIndex' in calls[1].payload, false);
  assert.equal(page.data.form.description, fields().description);
});

test('form validation rejects false calendar dates, bad URLs and missing pet conditions while allowing past events', () => {
  const eventFields = { ...fields(), type: 'event', startDate: '2024-02-29', endDate: '2024-03-01' };
  assert.equal(formTools.validate(eventFields), '');
  assert.match(formTools.validate({ ...eventFields, startDate: '2025-02-29' }), /有效/);
  assert.match(formTools.validate({ ...eventFields, endDate: '2024-02-28' }), /结束日期/);
  assert.equal(formTools.calendarDate('0000-02-29'), true);
  assert.match(formTools.validate({ ...fields(), sourceUrl: 'javascript:alert(1)' }), /HTTPS/);
  assert.match(formTools.validate({ ...fields(), petPolicyStatus: 'conditional' }), /携宠说明/);
  assert.equal(formTools.fields({ ...formTools.formFor(eventFields), type: 'place' }).startDate, '');
});

test('my submissions paginate only own records, deduplicate overlaps and reject stale filter results', async t => {
  const { page, handlers, effects } = fixture(t, 'contribute');
  const more = deferred();
  handlers.listNearbySubmissions = payload => payload.cursor ? more.promise : payload.status === 'rejected' ? { items: [row('rejected-row', 'rejected')] } : { items: [row('one')], nextCursor: 'next' };
  await page.onLoad({ tab: 'mine' }); const old = page.loadMore();
  await page.changeStatus(valueEvent(3));
  more.resolve({ items: [row('stale')], nextCursor: 'old' }); await old;
  assert.deepEqual(page.data.items.map(item => item.id), ['rejected-row']);
  assert.equal(page.data.nextCursor, null);
  assert.ok(effects.calls.filter(call => call.action === 'listNearbySubmissions').every(call => call.payload.mine === true));
  handlers.listNearbySubmissions = payload => payload.cursor ? { items: [row('one'), row('two')] } : { items: [row('one')], nextCursor: 'next' };
  await page.changeStatus(valueEvent(0)); await Promise.all([page.loadMore(), page.loadMore()]);
  assert.deepEqual(page.data.items.map(item => item.id), ['one', 'two']);
});

test('owners can withdraw only pending records and copy rejected or withdrawn submissions into a separate new draft', async t => {
  const { page, handlers, effects } = fixture(t, 'contribute');
  let current = [row('pending'), row('published', 'approved', { publishedId: 'public?id&one' }), row('rejected', 'rejected', { reviewNote: '请补充时间' })];
  handlers.listNearbySubmissions = () => ({ items: current });
  handlers.withdrawNearbySubmission = payload => { current = current.map(item => item.id === payload.id ? { ...item, status: 'withdrawn' } : item); return { submission: current.find(item => item.id === payload.id) }; };
  await page.onLoad({ tab: 'mine' });
  await page.withdraw(event('published')); assert.equal(effects.calls.some(call => call.action === 'withdrawNearbySubmission'), false);
  await page.withdraw(event('pending')); assert.equal(page.data.items[0].statusText, '已撤回');
  page.openPublished(event('published')); assert.equal(effects.routes.at(-1), '/pages/local-detail/index?id=public%3Fid%26one');
  await page.copyDraft(event('rejected')); page.input(event('', 'title', '重新填写的地点'));
  assert.equal(page.data.items.find(item => item.id === 'rejected').title, fields().title);
  assert.equal(page.data.tab, 'form'); assert.equal(page.data.form.title, '重新填写的地点');
});

test('non-operators cannot load review data or invoke review controls', async t => {
  const { page, effects } = fixture(t, 'submissions-manage');
  await page.onLoad(); page.selectSubmission(event('missing')); await page.approve(); await page.reject(); await page.unpublish();
  assert.equal(page.data.isAdmin, false); assert.equal(page.data.form, null);
  assert.deepEqual(effects.calls.map(call => call.action), ['bootstrap']);
});

test('approval sends only complete public fields after explicit confirmation and public edits reset confirmation', async t => {
  const { page, handlers, effects } = fixture(t, 'submissions-manage', true);
  const item = row('approve-one', 'pending', { userId: 'private-owner', lifecycle: 4, photos: ['private-photo'] });
  handlers.listNearbySubmissions = () => ({ items: [item] });
  handlers.reviewNearbySubmission = payload => ({ submission: { ...item, ...payload.fields, status: payload.decision, publishedId: 'public-one' } });
  await page.onLoad(); page.selectSubmission(event('approve-one')); await page.approve();
  assert.match(page.data.formError, /先确认/); assert.equal(effects.calls.some(call => call.action === 'reviewNearbySubmission'), false);
  page.confirmReviewed(valueEvent(true)); page.input(event('', 'title', '核实后的公开地点'));
  assert.equal(page.data.confirmed, false);
  page.confirmReviewed(valueEvent(true)); await page.approve();
  const payload = effects.calls.find(call => call.action === 'reviewNearbySubmission').payload;
  assert.equal(payload.confirmed, true); assert.equal(payload.decision, 'approved');
  assert.equal(payload.fields.title, '核实后的公开地点');
  assert.deepEqual(Object.keys(payload.fields).sort(), Object.keys(fields()).sort());
  assert.doesNotMatch(JSON.stringify(payload), /private-owner|private-photo|policyIndex|lifecycle/);
  assert.equal(page.data.selected, null); assert.match(page.data.notice, /已发布/);
});

test('rejection requires a reason and uncertain review failures preserve the exact decision for retry', async t => {
  const { page, handlers, effects } = fixture(t, 'submissions-manage', true);
  const item = row('review-one'); handlers.listNearbySubmissions = () => ({ items: [item] });
  let attempts = 0;
  handlers.reviewNearbySubmission = payload => { if (++attempts === 1) throw new Error('仅测试审核响应中断'); return { submission: { ...item, status: payload.decision, reviewNote: payload.note } }; };
  await page.onLoad(); page.selectSubmission(event('review-one')); await page.reject();
  assert.match(page.data.formError, /原因/); assert.equal(attempts, 0);
  page.inputNote(valueEvent('需要补充可核实的活动日期')); await page.reject();
  assert.equal(page.data.reviewLocked, true);
  page.inputNote(valueEvent('不能替换')); assert.equal(page.data.note, '需要补充可核实的活动日期');
  await page.approve(); assert.equal(attempts, 1);
  await Promise.all([page.retryDecision(), page.retryDecision()]);
  const reviews = effects.calls.filter(call => call.action === 'reviewNearbySubmission');
  assert.deepEqual(reviews[0].payload, reviews[1].payload); assert.equal(reviews.length, 2);
  assert.equal('fields' in reviews[0].payload, false); assert.equal(page.data.selected, null);
});

test('operators require a reason to unpublish and never expose owner withdrawal as a management action', async t => {
  const { page, handlers, effects } = fixture(t, 'submissions-manage', true);
  const item = row('published', 'approved', { publishedId: 'public-one' }); handlers.listNearbySubmissions = () => ({ items: [item] });
  handlers.unpublishNearbySubmission = () => ({ submission: { ...item, status: 'withdrawn' } });
  await page.onLoad(); page.selectSubmission(event('published')); await page.unpublish();
  assert.match(page.data.formError, /下架原因/);
  page.inputNote(valueEvent('活动已经取消')); await Promise.all([page.unpublish(), page.unpublish()]);
  assert.equal(effects.calls.filter(call => call.action === 'unpublishNearbySubmission').length, 1);
  assert.equal(effects.calls.some(call => call.action === 'withdrawNearbySubmission'), false);
  assert.equal(page.data.selected, null);
});

test('permission loss hides selected private review content and late requests do not write after unloading', async t => {
  const { page, handlers, effects } = fixture(t, 'submissions-manage', true);
  handlers.listNearbySubmissions = () => ({ items: [row('one')] });
  await page.onLoad(); page.selectSubmission(event('one'));
  handlers.bootstrap = () => ({ mode: 'demo', user: { isAdmin: false } }); await page.refresh();
  assert.equal(page.data.selected, null); assert.equal(page.data.items.length, 0);
  handlers.bootstrap = () => ({ mode: 'demo', user: { isAdmin: true } });
  const pending = deferred(); handlers.listNearbySubmissions = () => pending.promise;
  const loading = page.refresh(); await Promise.resolve(); await Promise.resolve(); page.onUnload(); pending.resolve({ items: [row('late')] }); await loading;
  assert.equal(effects.writesAfterUnload, 0);
});

test('new contribution templates only bind implemented handlers and keep user and operator actions separate', async t => {
  const { page } = fixture(t, 'contribute');
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/social/pages/contribute/index.wxml'), 'utf8');
  for (const binding of markup.matchAll(/\b(?:bind|catch)(?:tap|input|change|confirm|error)="([^"]+)"/g)) assert.equal(typeof page[binding[1]], 'function', binding[1]);
  assert.doesNotMatch(markup, /bindtap="(?:approve|reject|unpublish)"/);
  assert.doesNotMatch(markup, /<image|经度|纬度|上传照片/);
});

test('management template handlers are valid and approval requires a checkbox confirmation', t => {
  const { page } = fixture(t, 'submissions-manage', true);
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/social/pages/submissions-manage/index.wxml'), 'utf8');
  for (const binding of markup.matchAll(/\b(?:bind|catch)(?:tap|input|change|confirm|error)="([^"]+)"/g)) assert.equal(typeof page[binding[1]], 'function', binding[1]);
  assert.match(markup, /type="checkbox"[^>]*bindchange="confirmReviewed"/);
  assert.match(markup, /aria-label="确认已核实投稿内容"/);
  assert.match(markup, /bindtap="approve" disabled="\{\{busy \|\| !confirmed\}\}"/);
});
