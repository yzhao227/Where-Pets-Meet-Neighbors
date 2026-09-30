'use strict';

// A small effect-based domain shared by the synchronous demo store and cloud
// transactions. Coordinates describe public venues only, never a visitor.
const ACTIONS = ['listPlaces', 'getPlace', 'bookmarkPlace', 'listPlaceVisits', 'recordPlaceVisit', 'deletePlaceVisit', 'submitPlaceCorrection', 'listPlaceCorrections', 'resolvePlaceCorrection', 'deletePlaceCorrection', 'savePlace', 'publishPlaceCatalogue', 'submitNearbySubmission', 'listNearbySubmissions', 'reviewNearbySubmission', 'withdrawNearbySubmission', 'unpublishNearbySubmission'];
const WRITES = ACTIONS.filter(action => !['listPlaces', 'getPlace', 'listPlaceVisits', 'listPlaceCorrections', 'listNearbySubmissions'].includes(action));
const VERIFIED = ['recordPlaceVisit', 'submitPlaceCorrection', 'submitNearbySubmission'];
const TABLES = ['place_records', 'place_bookmarks', 'place_visits', 'place_corrections', 'nearby_submissions'];
const CATEGORIES = ['携宠规则', '地址或导航', '营业或关闭', '其他信息'];
const SUBMISSION_FIELDS = ['type', 'title', 'city', 'district', 'area', 'address', 'description', 'sourceUrl', 'petPolicyStatus', 'petPolicyText', 'costText', 'startDate', 'endDate'];
const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'];
const copy = value => JSON.parse(JSON.stringify(value));
function anonymousSubmission(row) {
  return Object.fromEntries([...SUBMISSION_FIELDS, 'id', 'status', 'createdAt', 'reviewedAt', 'publishedId'].filter(key => row[key] !== undefined).map(key => [key, row[key]]));
}
// Four independent 32-bit streams provide a compact stable storage key. The
// full tuple is still checked before reuse, so even a collision cannot overwrite
// another visit or authorize access to it.
function visitKey(userId, placeId, visitedOn) {
  const input = JSON.stringify([userId, placeId, visitedOn]);
  return 'visit_' + [2166136261, 2246822519, 3266489917, 668265263].map(seed => {
    let value = seed;
    for (let index = 0; index < input.length; index += 1) value = Math.imul(value ^ input.charCodeAt(index), 16777619);
    return (value >>> 0).toString(16).padStart(8, '0');
  }).join('');
}
function* get(table, id) { return yield ['get', table, id]; }
function* put(table, id, value) { return yield ['set', table, id, value]; }
function* remove(table, id) { return yield ['remove', table, id]; }
function* all(table, filters = {}) { return yield ['all', table, filters]; }
function createPlaceEngine({ catalogue, now, newId, fail }) {
  const base = new Map(catalogue.records.map(record => [record.id, record]));
  function readStored(row) {
    const current = base.get(row._id || row.id);
    const point = current && current.point;
    // Early catalogue imports were full snapshots. Fill only a missing venue
    // point on an untouched import; an explicit null is an operator's removal.
    // Keep this read-only so upgrades never rewrite visits, drafts or edits.
    if (!current || row.active !== true || current.active === false || Object.prototype.hasOwnProperty.call(row, 'point') ||
      ['updatedBy', 'updatedAt', 'createdBy', 'createdAt', 'submissionId', 'submittedBy'].some(key => Object.prototype.hasOwnProperty.call(row, key)) ||
      ['type', 'title', 'city', 'district', 'area', 'address', 'venue', 'hostName', 'startsAt', 'endsAt', 'datePrecision', 'announcementMonth', 'status'].some(key => row[key] !== current[key]) ||
      !point || point.coordinateSystem !== 'gcj02' || point.precision !== 'venue' || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
      !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 || typeof point.sourceUrl !== 'string' || !/^https:\/\/[^\s<>"\\]+$/.test(point.sourceUrl)) return row;
    return { ...row, point: copy(point) };
  }
  const text = (value, label, min, max) => {
    if (typeof value !== 'string' || Array.from(value.trim()).length < min || Array.from(value.trim()).length > max) fail('INVALID_INPUT', label + '需为 ' + min + '–' + max + ' 字');
    return value.trim();
  };
  const id = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) fail('INVALID_INPUT', '地点或记录编号无效'); return value; };
  const bool = value => { if (typeof value !== 'boolean') fail('INVALID_INPUT', '请选择有效的开关状态'); return value; };
  const admin = ctx => { if (!ctx.isAdmin) fail('FORBIDDEN', '只有运营者可以管理地点和处理纠错'); };
  const link = record => record ? { id: record.id || record._id, title: record.title, address: record.address || '', city: record.city || '', area: record.area || '', active: record.active !== false,
    ...(record.point && record.point.coordinateSystem === 'gcj02' ? { point: copy(record.point) } : {}) } : null;
  const page = (items, payload) => {
    const limit = payload.limit === undefined ? 20 : payload.limit;
    const start = payload.cursor === undefined || payload.cursor === null || payload.cursor === '' ? 0 : Number(payload.cursor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(start) || start < 0) fail('INVALID_INPUT', '分页参数无效');
    return { items: items.slice(start, start + limit), ...(start + limit < items.length ? { nextCursor: String(start + limit) } : {}) };
  };
  function* record(value, includeInactive = false) {
    const key = id(value); const row = yield* get('place_records', key); const found = row ? readStored(row) : base.get(key);
    if (!found || !includeInactive && found.active === false) fail('NOT_FOUND', '这条地点信息已下架或不存在');
    return { ...copy(found), id: key };
  }
  function publicRecord(row) {
    const result = copy(row); delete result._id; delete result.updatedBy; delete result.createdBy;
    return { ...result, active: row.active !== false };
  }
  function* records() {
    const merged = new Map(base);
    for (const row of yield* all('place_records')) merged.set(row._id || row.id, { ...readStored(row), id: row._id || row.id });
    return Array.from(merged.values());
  }
  function date(value) {
    const result = text(value, '到访日期', 10, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result + 'T00:00:00Z')) || new Date(result + 'T00:00:00Z').toISOString().slice(0, 10) !== result || result < '2000-01-01' || result > new Date(now() + 8 * 3600000).toISOString().slice(0, 10)) fail('INVALID_INPUT', '请选择有效的已到访日期');
    return result;
  }
  function edit(payload, previous) {
    const title = text(payload.title, '地点名称', 1, 60);
    const officialUrl = text(payload.officialUrl, '资料链接', 1, 1000);
    if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/[\S]*)?$/.test(officialUrl) || /[<>"\\]/.test(officialUrl)) fail('INVALID_INPUT', '资料链接需为有效 HTTPS 地址');
    const point = payload.point;
    let coordinate;
    if (point !== undefined && point !== null) {
      if (!point || point.coordinateSystem !== 'gcj02' || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180 || payload.pointConfirmed !== true) fail('INVALID_INPUT', '请核实公共场所坐标，并确认坐标类型为 GCJ-02');
      coordinate = { latitude: point.latitude, longitude: point.longitude, coordinateSystem: 'gcj02', precision: 'venue', sourceUrl: officialUrl, checkedAt: new Date(now()).toISOString().slice(0, 10) };
    }
    const policy = text(payload.petPolicyText, '携宠说明', 1, 500);
    const status = payload.petPolicyStatus;
    if (!['allowed', 'conditional', 'not_allowed', 'unknown'].includes(status)) fail('INVALID_INPUT', '请选择有效的携宠状态');
    return { ...(previous || {}), type: 'place', title, address: text(payload.address, '公开场所地址', 1, 200), description: text(payload.description || '', '地点介绍', 0, 2000),
      city: text(payload.city || '上海', '城市', 1, 40), area: text(payload.area || '', '片区', 0, 40), officialUrl,
      petPolicy: { status, text: policy }, active: payload.active === undefined ? true : bool(payload.active),
      ...(point === undefined ? {} : { point: coordinate || null }), sources: [{ title: '运营者核实资料', url: officialUrl, checkedAt: new Date(now()).toISOString().slice(0, 10) }].concat((previous && previous.sources || []).filter(source => source.url !== officialUrl)), checkedAt: new Date(now()).toISOString().slice(0, 10) };
  }
  function submissionFields(value, extras = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !SUBMISSION_FIELDS.includes(key) && !extras.includes(key))) fail('INVALID_INPUT', '投稿仅接受地点或活动的公开文字资料');
    if (!['place', 'event'].includes(value.type)) fail('INVALID_INPUT', '请选择投稿地点或活动');
    const optional = (key, label, max) => text(value[key] === undefined ? '' : value[key], label, 0, max);
    const sourceUrl = optional('sourceUrl', '参考链接', 1000);
    if (sourceUrl && !/^https:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?::\d{1,5})?(?:[/?#][^\s<>"\\]*)?$/.test(sourceUrl)) fail('INVALID_INPUT', '参考链接需为有效 HTTPS 地址');
    const petPolicyStatus = value.petPolicyStatus === undefined ? 'unknown' : value.petPolicyStatus;
    if (!['unknown', 'allowed', 'conditional', 'not_allowed'].includes(petPolicyStatus)) fail('INVALID_INPUT', '请选择有效的携宠状态');
    const petPolicyText = text(value.petPolicyText === undefined ? '' : value.petPolicyText, '携宠说明', petPolicyStatus === 'unknown' ? 0 : 1, 500);
    const calendarDate = input => {
      const result = text(input, '活动日期', 10, 10); const timestamp = Date.parse(result + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== result) fail('INVALID_INPUT', '请选择有效的活动日期');
      return result;
    };
    const startDate = value.type === 'event' ? calendarDate(value.startDate) : '';
    const endDate = value.type === 'event' ? calendarDate(value.endDate) : '';
    if (endDate < startDate) fail('INVALID_INPUT', '活动结束日期不能早于开始日期');
    return { type: value.type, title: text(value.title, '名称', 2, 60), city: text(value.city, '城市', 1, 40), district: optional('district', '行政区', 40), area: optional('area', '片区', 40),
      address: text(value.address, '公开场所地址', 2, 200), description: text(value.description, '投稿介绍', 10, 2000), sourceUrl, petPolicyStatus, petPolicyText,
      costText: optional('costText', '费用说明', 200), startDate, endDate };
  }
  function submissionView(row) {
    return { ...Object.fromEntries(SUBMISSION_FIELDS.map(key => [key, row[key]])), id: row.id || row._id, status: row.status, createdAt: row.createdAt,
      ...(row.reviewedAt !== undefined ? { reviewedAt: row.reviewedAt } : {}), ...(row.reviewNote !== undefined ? { reviewNote: row.reviewNote } : {}), ...(row.publishedId ? { publishedId: row.publishedId } : {}) };
  }
  function* submission(value) {
    const key = id(value); const row = yield* get('nearby_submissions', key);
    if (!row) fail('NOT_FOUND', '这条投稿不存在');
    return { ...row, id: key };
  }
  function* requireSubmissionAuthor(row) {
    const author = yield* get('users', row.userId);
    if (!author || author.status && author.status !== 'active' || (author.lifecycleId || author.nearbySubmissionLifecycleId) !== row.lifecycleId) fail('AUTHOR_UNAVAILABLE', '投稿账号已注销或状态发生变化，无法通过审核');
  }
  function publicSubmission(row, key, ctx) {
    const checkedAt = new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
    return { id: key, type: row.type, title: row.title, city: row.city, district: row.district, area: row.area, address: row.address,
      description: row.description, summary: row.description, petPolicy: { status: row.petPolicyStatus, text: row.petPolicyText }, ticketText: row.costText,
      active: true, checkedAt, categoryLabel: row.type === 'place' ? '宠友推荐地点' : '宠友推荐活动', updatedBy: ctx.userId, updatedAt: now(),
      ...(row.sourceUrl ? { officialUrl: row.sourceUrl, sources: [{ title: '投稿参考资料', url: row.sourceUrl, checkedAt }] } : {}),
      ...(row.type === 'event' ? { startsAt: row.startDate + 'T00:00:00+08:00', endsAt: row.endDate + 'T23:59:59+08:00' } : {}) };
  }
  // Expose precisely the text that the cloud adapter must moderate. Pending
  // fields are immutable; execute still rechecks status/ownership in its tx.
  function* submissionModeration(action, payload, ctx) {
    if (action !== 'submitNearbySubmission') admin(ctx);
    let fields;
    if (action === 'submitNearbySubmission') fields = submissionFields(payload, ['requestId']);
    if (action === 'reviewNearbySubmission' && payload.decision === 'approved') {
      const row = yield* submission(payload.id);
      fields = payload.fields === undefined ? Object.fromEntries(SUBMISSION_FIELDS.map(key => [key, row[key]])) : submissionFields(payload.fields);
    }
    return [...(fields ? SUBMISSION_FIELDS.map(key => fields[key]) : []), typeof payload.note === 'string' ? payload.note.trim() : ''].filter(Boolean).join('\n');
  }
  function* execute(action, payload, ctx) {
    if (action === 'submitNearbySubmission') {
      const fields = submissionFields(payload, ['requestId']);
      const requestId = text(payload.requestId, '投稿请求编号', 8, 100);
      if (!/^[A-Za-z0-9_-]+$/.test(requestId)) fail('INVALID_INPUT', '投稿请求编号格式无效');
      if (typeof ctx.lifecycleId !== 'string' || !ctx.lifecycleId) fail('ACCOUNT_UNAVAILABLE', '投稿账号状态尚未准备好，请重试');
      const key = 'submission_' + visitKey(ctx.userId, ctx.lifecycleId, requestId).slice(6);
      const existing = yield* get('nearby_submissions', key);
      if (existing) {
        if (existing.userId !== ctx.userId || existing.lifecycleId !== ctx.lifecycleId || existing.requestId !== requestId || JSON.stringify(existing.submittedFields) !== JSON.stringify(fields)) fail('IDEMPOTENCY_CONFLICT', '这个请求编号已经用于另一份投稿，请重新提交');
        return { submission: submissionView(existing) };
      }
      const row = { ...fields, id: key, userId: ctx.userId, lifecycleId: ctx.lifecycleId, requestId, submittedFields: fields, status: 'pending', createdAt: now() };
      yield* requireSubmissionAuthor(row);
      yield* put('nearby_submissions', key, row);
      return { submission: submissionView(row) };
    }
    if (action === 'listNearbySubmissions') {
      const mine = payload.mine === undefined ? true : bool(payload.mine); if (!mine) admin(ctx);
      const status = payload.status === undefined ? 'all' : payload.status;
      if (status !== 'all' && !SUBMISSION_STATUSES.includes(status)) fail('INVALID_INPUT', '请选择有效的投稿状态');
      const limit = payload.limit === undefined ? 20 : payload.limit; let anchor;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID_INPUT', '每页数量需为 1–50');
      if (payload.cursor !== undefined && payload.cursor !== null && payload.cursor !== '') {
        const match = typeof payload.cursor === 'string' && /^n_(\d{1,16})_([A-Za-z0-9_-]{1,120})$/.exec(payload.cursor);
        if (!match || !Number.isSafeInteger(Number(match[1]))) fail('INVALID_INPUT', '投稿分页位置无效');
        anchor = { createdAt: Number(match[1]), id: match[2] };
      }
      const rows = (yield* all('nearby_submissions', mine ? { userId: ctx.userId } : status === 'all' ? {} : { status }))
        .map(row => ({ ...row, id: row.id || row._id })).filter(row => (!mine || row.lifecycleId === ctx.lifecycleId) && (status === 'all' || row.status === status) && (!anchor || row.createdAt < anchor.createdAt || row.createdAt === anchor.createdAt && row.id < anchor.id))
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const items = rows.slice(0, limit); const last = items[items.length - 1];
      return { items: items.map(submissionView), ...(rows.length > limit ? { nextCursor: 'n_' + last.createdAt + '_' + last.id } : {}) };
    }
    if (action === 'reviewNearbySubmission') {
      admin(ctx); const row = yield* submission(payload.id); const decision = payload.decision;
      if (!['approved', 'rejected'].includes(decision)) fail('INVALID_INPUT', '请选择通过或拒绝');
      if (row.status === decision) return { submission: submissionView(row) };
      if (row.status !== 'pending') fail('CONFLICT', '这条投稿已处理，请刷新查看结果');
      const note = text(payload.note === undefined ? '' : payload.note, '审核说明', decision === 'rejected' ? 1 : 0, 500);
      let fields = {};
      if (decision === 'approved') {
        if (payload.confirmed !== true) fail('INVALID_INPUT', '请先确认已核实地点或活动资料');
        fields = submissionFields(payload.fields === undefined ? Object.fromEntries(SUBMISSION_FIELDS.map(key => [key, row[key]])) : payload.fields);
        yield* requireSubmissionAuthor(row);
        const publishedId = 'nearby_' + row.id;
        if (yield* get('place_records', publishedId)) fail('CONFLICT', '对应公开记录已存在，请核实后重试');
        yield* put('place_records', publishedId, publicSubmission(fields, publishedId, ctx));
        fields.publishedId = publishedId;
      }
      const result = { ...row, ...fields, status: decision, reviewNote: note, reviewedAt: now() };
      yield* put('nearby_submissions', row.id, result);
      return { submission: submissionView(result) };
    }
    if (action === 'withdrawNearbySubmission') {
      const row = yield* submission(payload.id);
      if (row.userId !== ctx.userId || row.lifecycleId !== ctx.lifecycleId) fail('NOT_FOUND', '这条投稿不存在');
      if (row.status === 'withdrawn' && !row.publishedId) return { submission: submissionView(row) };
      if (row.status !== 'pending') fail('CONFLICT', '只有待审核投稿可以自行撤回');
      const result = { ...row, status: 'withdrawn' }; yield* put('nearby_submissions', row.id, result);
      return { submission: submissionView(result) };
    }
    if (action === 'unpublishNearbySubmission') {
      admin(ctx); const row = yield* submission(payload.id); const note = text(payload.note, '下架说明', 1, 500);
      if (row.status === 'withdrawn' && row.publishedId) return { submission: submissionView(row) };
      if (row.status !== 'approved' || !row.publishedId) fail('CONFLICT', '只有已通过的投稿可以下架');
      const published = yield* get('place_records', row.publishedId);
      if (!published) fail('NOT_FOUND', '对应公开记录已不存在');
      yield* put('place_records', row.publishedId, { ...published, active: false, updatedBy: ctx.userId, updatedAt: now() });
      const result = { ...row, status: 'withdrawn', reviewNote: note, reviewedAt: now() };
      yield* put('nearby_submissions', row.id, result);
      return { submission: submissionView(result) };
    }
    if (action === 'listPlaces') {
      if (payload.includeInactive) admin(ctx);
      const favorites = new Set((yield* all('place_bookmarks', { userId: ctx.userId })).map(row => row.placeId));
      const query = text(payload.query || '', '搜索词', 0, 80).toLowerCase();
      const rows = (yield* records()).filter(row => (row.active !== false || payload.includeInactive || payload.bookmarked) && (!payload.bookmarked || favorites.has(row.id)) && (payload.type === 'all' || row.type === 'place') && (!query || [row.title, row.area, row.address].join(' ').toLowerCase().includes(query)))
        .sort((a, b) => a.id.localeCompare(b.id)).map(row => ({ ...publicRecord(row), isBookmarked: favorites.has(row.id) }));
      return page(rows, payload);
    }
    if (action === 'getPlace') {
      const row = yield* record(payload.id, true);
      return { place: publicRecord(row), isBookmarked: !!(yield* get('place_bookmarks', visitKey(ctx.userId, row.id, 'bookmark'))), isAdmin: ctx.isAdmin === true };
    }
    if (action === 'bookmarkPlace') {
      const key = id(payload.id); const enabled = bool(payload.bookmark); if (enabled) yield* record(key);
      if (enabled) yield* put('place_bookmarks', visitKey(ctx.userId, key, 'bookmark'), { userId: ctx.userId, placeId: key, createdAt: now() });
      else yield* remove('place_bookmarks', visitKey(ctx.userId, key, 'bookmark'));
      return { isBookmarked: enabled };
    }
    if (action === 'recordPlaceVisit') {
      const venue = yield* record(payload.placeId); if (venue.type !== 'place') fail('INVALID_INPUT', '请选择公开地点记录到访');
      const visitedOn = date(payload.visitedOn);
      const visitId = visitKey(ctx.userId, venue.id, visitedOn);
      const existing = yield* get('place_visits', visitId);
      if (existing && (existing.userId !== ctx.userId || existing.placeId !== venue.id || existing.visitedOn !== visitedOn)) fail('CONFLICT', '到访编号发生冲突，请稍后重试');
      const note = text(payload.note === undefined && existing ? existing.note || '' : payload.note || '', '私人到访备注', 0, 300);
      const visit = { ...(existing || {}), userId: ctx.userId, placeId: venue.id, visitedOn, note, createdAt: existing ? existing.createdAt : now() };
      yield* put('place_visits', visitId, visit);
      return { visit: { ...visit, id: visitId, place: link(venue) } };
    }
    if (action === 'listPlaceVisits') {
      const rows = (yield* all('place_visits', { userId: ctx.userId })).filter(row => !payload.placeId || row.placeId === payload.placeId).sort((a, b) => b.createdAt - a.createdAt);
      const result = page(rows, payload); const items = [];
      for (const row of result.items) { let place = null; try { place = link(yield* record(row.placeId, true)); } catch (_) {} items.push({ ...row, id: row._id || row.id, place }); }
      return { ...result, items };
    }
    if (action === 'deletePlaceVisit') {
      const key = id(payload.id); const row = yield* get('place_visits', key);
      if (!row || row.userId !== ctx.userId) fail('NOT_FOUND', '这条到访记录不存在');
      if (row.postId) { const post = yield* get('posts', row.postId); if (post && post.authorId === ctx.userId && post.visitId === key) yield* put('posts', row.postId, { ...post, visitId: '' }); }
      yield* remove('place_visits', key); return { deleted: true };
    }
    if (action === 'submitPlaceCorrection') {
      const venue = yield* record(payload.placeId, true); const category = payload.category;
      if (!CATEGORIES.includes(category)) fail('INVALID_INPUT', '请选择纠错类型');
      const detail = text(payload.text, '纠错说明', 5, 1000); const key = newId();
      yield* put('place_corrections', key, { userId: ctx.userId, placeId: venue.id, placeTitle: venue.title, category, text: detail, status: 'pending', createdAt: now() });
      return { id: key, status: 'pending' };
    }
    if (action === 'listPlaceCorrections') {
      if (payload.mine !== true) admin(ctx);
      const rows = (yield* all('place_corrections', payload.mine ? { userId: ctx.userId } : {})).filter(row => !payload.status || payload.status === 'all' || row.status === payload.status).sort((a, b) => b.createdAt - a.createdAt);
      return page(rows.map(row => ({ ...row, id: row._id || row.id })), payload);
    }
    if (action === 'resolvePlaceCorrection') {
      admin(ctx); const key = id(payload.id); const row = yield* get('place_corrections', key);
      if (!row) fail('NOT_FOUND', '这条纠错已不存在');
      if (!['resolved', 'dismissed'].includes(payload.status)) fail('INVALID_INPUT', '请选择处理结果');
      yield* put('place_corrections', key, { ...row, status: payload.status, resolution: text(payload.note || '', '处理说明', 1, 500), resolvedAt: now() });
      return { success: true };
    }
    if (action === 'deletePlaceCorrection') {
      const key = id(payload.id); const row = yield* get('place_corrections', key);
      if (!row || row.userId !== ctx.userId) fail('NOT_FOUND', '这条纠错记录不存在');
      yield* remove('place_corrections', key); return { deleted: true };
    }
    if (action === 'savePlace') {
      admin(ctx); const key = payload.id ? id(payload.id) : newId(); let previous;
      if (payload.id) { previous = yield* record(key, true); if (previous.type !== 'place') fail('INVALID_INPUT', '地点管理仅可编辑公开地点，展览和活动请使用对应资料流程'); }
      const row = { ...edit(payload, previous), id: key, updatedAt: now(), updatedBy: ctx.userId };
      yield* put('place_records', key, row); return { place: publicRecord(row) };
    }
    if (action === 'publishPlaceCatalogue') {
      admin(ctx); const selection = page(catalogue.records, { ...payload, limit: 20 }); let added = 0;
      for (const row of selection.items) if (!(yield* get('place_records', row.id))) { yield* put('place_records', row.id, { ...copy(row), active: true }); added += 1; }
      return { added, nextCursor: selection.nextCursor || null };
    }
    fail('UNKNOWN_ACTION', '暂不支持这个地点操作');
  }
  function* linkPost(payload, ctx, postId) {
    if (!payload.placeId && !payload.visitId) return { placeId: '', visitId: '' };
    if (!payload.placeId) fail('INVALID_INPUT', '到访分享必须选择关联地点');
    const venue = yield* record(payload.placeId); if (venue.type !== 'place') fail('INVALID_INPUT', '分享仅可关联公开地点');
    let visitId = '';
    if (payload.visitId) {
      visitId = id(payload.visitId); const visit = yield* get('place_visits', visitId);
      if (!visit || visit.userId !== ctx.userId || visit.placeId !== venue.id || visit.postId && visit.postId !== postId) fail('INVALID_INPUT', '请选择本人的有效到访记录，或取消到访关联');
      yield* put('place_visits', visitId, { ...visit, postId });
    }
    return { placeId: venue.id, visitId };
  }
  function* unlinkPost(post) {
    if (!post.visitId) return;
    const visit = yield* get('place_visits', post.visitId);
    if (visit && visit.postId === (post._id || post.id)) yield* put('place_visits', post.visitId, { ...visit, postId: '' });
  }
  function* postPlace(post) {
    if (!post.placeId) return null;
    try { return link(yield* record(post.placeId, true)); } catch (_) { return null; }
  }
  function* cleanupUser(userId) {
    for (const table of TABLES.slice(1)) for (const row of yield* all(table, { userId })) {
      if (table === 'nearby_submissions') yield ['cleanupSubmission', row._id || row.id, userId];
      else yield* remove(table, row._id || row.id);
    }
    // The directory query is only a candidate list. The storage driver must
    // re-read and clear attribution atomically so another operator's edit is
    // never replaced by this older snapshot during account cleanup.
    for (const row of yield* all('place_records', { updatedBy: userId })) yield ['clearAttribution', row._id || row.id, userId];
  }
  return { execute, linkPost, unlinkPost, postPlace, cleanupUser, submissionModeration };
}
function driveSync(iterator, store) { let step = iterator.next(); while (!step.done) { const [action, ...args] = step.value; step = iterator.next(store[action](...args)); } return step.value; }
async function drive(iterator, store) { let step = iterator.next(); while (!step.done) { const [action, ...args] = step.value; step = iterator.next(await store[action](...args)); } return step.value; }
module.exports = { createPlaceEngine, driveSync, drive, ACTIONS, WRITES, VERIFIED, TABLES, CATEGORIES, anonymousSubmission };
