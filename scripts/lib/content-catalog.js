'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createHash, randomUUID } = require('node:crypto');
const TOPICS = require('../../miniprogram/data/topics');
const contentPolicy = require('../../miniprogram/data/content-policy');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_INPUT = path.join(ROOT, 'content/batch-001/approved.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'miniprogram/data/curated.js');
const TARGETS = Object.freeze({ knowledge: 100, photo: 200 });
// Defaults describe the original batch; explicit complete snapshots can grow
// within a separate bound without silently changing the original 100/200 goal.
const LIMITS = Object.freeze({ knowledge: 100, photo: 400, video: 40 });
const SNAPSHOT_NOTICE = 'manifest 是当前目录的完整快照；生成会替换目录，未列出的旧条目将撤下，请同时保留此前已采集且仍需发布的条目。';
const EDITOR_IDS = Object.freeze(['catalog-cat-home', 'catalog-cat-behavior', 'catalog-dog-life', 'catalog-dog-walk', 'catalog-pet-care', 'catalog-photo']);
const CIRCLES = require('../../miniprogram/data/circles').CIRCLES.map(circle => circle.id);
const REVIEW_STATES = ['pending', 'rejected', 'approved'];
const ANIMAL_TYPES = Object.freeze(['cat', 'dog', 'rabbit', 'small-mammal', 'bird', 'fish', 'reptile', 'amphibian', 'invertebrate', 'other']);

// This tool checks an editor's manifest, not a website or the legal scope of a
// licence. Source retrieval, factual review and permission review happen before
// an editor marks an item approved. No requests or downloads are performed.
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function aliased(value, preferred, legacy, name, errors) {
  if (value[preferred] !== undefined && value[legacy] !== undefined && JSON.stringify(value[preferred]) !== JSON.stringify(value[legacy])) errors.push(name + ': ' + preferred + ' 与旧字段 ' + legacy + ' 冲突');
  return value[preferred] === undefined ? value[legacy] : value[preferred];
}
function field(value, name, errors, min = 1, max = 200) {
  if (typeof value !== 'string') { errors.push(name + ': 必须是文字'); return ''; }
  const result = value.trim();
  const length = Array.from(result).length;
  if (length < min || length > max) errors.push(name + ': 需为 ' + min + '–' + max + ' 字');
  return result;
}
function dateField(value, name, errors) {
  const result = field(value, name, errors, 10, 40);
  const format = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;
  const day = result.slice(0, 10);
  const dayTime = Date.parse(day + 'T00:00:00Z');
  if (!format.test(result) || !Number.isFinite(Date.parse(result)) || !Number.isFinite(dayTime) || new Date(dayTime).toISOString().slice(0, 10) !== day) {
    errors.push(name + ': 需要有效的 YYYY-MM-DD 或带时区 ISO 日期');
  }
  return result;
}
function publicHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const ip = net.isIP(host);
  if (ip === 4) {
    const [a, b, c] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (ip === 6) {
    const first = Number.parseInt(host.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff && !/^2001:(?:0*:|0*db8:)/i.test(host) && !/^3fff:/i.test(host);
  }
  if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion|arpa)$/.test(host)) return false;
  return host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) && /(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(host.split('.').at(-1));
}
function urlField(value, name, errors, allowCloud = false) {
  const result = field(value, name, errors, 1, 2048);
  let url;
  try { url = new URL(result); } catch (_) { errors.push(name + ': 需要有效的公开 HTTPS 地址' + (allowCloud ? '或 cloud:// 文件地址' : '')); return result; }
  const credentials = !!(url.username || url.password);
  const controls = /[\u0000-\u0020\u007f]/.test(result) || /%(?![0-9a-f]{2})/i.test(result);
  if (allowCloud && url.protocol === 'cloud:') {
    if (credentials || controls || !url.hostname || url.port || url.search || url.hash || url.pathname === '/' || !url.pathname || !/^[a-z0-9.-]+$/i.test(url.hostname) || /(?:^|\/)\.\.(?:\/|$)/.test(result)) errors.push(name + ': cloud:// 地址必须指定环境及文件路径，不能含凭据或临时查询参数');
  } else if (url.protocol !== 'https:' || credentials || controls || !publicHost(url.hostname)) {
    errors.push(name + ': 仅允许不含账号凭据的公开 HTTPS 地址，不能使用本机、内网或保留地址');
  }
  return result;
}
function videoUrlField(value, hashValue, name, errors, options) {
  if (typeof value !== 'string' || !value.startsWith('/')) return urlField(value, name, errors, true);
  if (!/^\/(?:assets\/curated-video|media[2-9]?\/clips)\/[0-9]+\.mp4$/.test(value)) {
    errors.push(name + ': 打包视频仅允许 /media/clips/数字.mp4、/media2..9/clips/数字.mp4 或兼容的 /assets/curated-video/数字.mp4');
    return value;
  }
  const expectedHash = typeof hashValue === 'string' ? hashValue.toLowerCase().replace(/^sha256:/, '') : '';
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) errors.push(name + ': 打包视频必须提供有效的 SHA-256 contentHash');
  try {
    const root = fs.realpathSync(path.resolve(options.assetsRoot || path.join(ROOT, 'miniprogram')));
    const resolved = value.startsWith('/assets/curated-video/') && !fs.existsSync(path.join(root, value)) ? value.replace('/assets/curated-video/', '/media/clips/') : value;
    const file = fs.realpathSync(path.join(root, resolved));
    const packageDirectory = /^\/(media[2-9]?\/clips)\//.exec(resolved);
    const allowedDirectory = path.join(root, packageDirectory ? packageDirectory[1] : 'assets/curated-video') + path.sep;
    if (!file.startsWith(allowedDirectory)) throw new Error('视频路径越出打包目录');
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > 300 * 1024) throw new Error('每条打包视频必须为 1–300 KiB 的实际文件');
    const actualHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (expectedHash && actualHash !== expectedHash) errors.push(name + ': 打包视频内容与 contentHash 不一致');
  } catch (error) {
    errors.push(name + ': 打包视频不存在、不可读取、路径无效或超过 300 KiB');
  }
  return value;
}
function posterUrlField(value, hashValue, name, errors, options) {
  if (typeof value !== 'string' || !value.startsWith('/')) return urlField(value, name, errors, true);
  if (!/^\/assets\/curated-poster\/[0-9]+\.jpg$/.test(value)) {
    errors.push(name + ': 打包视频封面仅允许 /assets/curated-poster/数字.jpg');
    return value;
  }
  const expectedHash = typeof hashValue === 'string' ? hashValue.toLowerCase().replace(/^sha256:/, '') : '';
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) errors.push(name + ': 打包封面必须提供有效的 SHA-256 contentHash');
  try {
    const root = fs.realpathSync(path.resolve(options.assetsRoot || path.join(ROOT, 'miniprogram')));
    const file = fs.realpathSync(path.join(root, value));
    if (!file.startsWith(path.join(root, 'assets/curated-poster') + path.sep)) throw new Error('封面路径越出打包目录');
    const bytes = fs.readFileSync(file);
    if (bytes.length < 4 || bytes.length > 100 * 1024 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw new Error('需要 1–100 KiB JPEG 文件');
    if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) errors.push(name + ': 打包封面内容与 contentHash 不一致');
  } catch (_) {
    errors.push(name + ': 打包封面不存在、不是 JPEG、路径无效或超过 100 KiB');
  }
  return value;
}
function canonicalAssetUrl(value) {
  try {
    const url = new URL(value);
    // Source images often have resize/download/tracking parameters. Those do
    // not make a second original image for quota or duplicate purposes.
    let pathname;
    try { pathname = decodeURIComponent(url.pathname).normalize('NFC'); } catch (_) { pathname = url.pathname; }
    return url.origin.toLowerCase() + pathname.replace(/\/$/, '');
  } catch (_) { return value; }
}
function normalizedText(value) { return value.normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff]+/gu, ''); }
function licenseType(name) {
  const value = name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^cc0(?: 1\.0)?$/.test(value)) return 'cc0';
  if (/^public domain(?: mark(?: 1\.0)?)?$/.test(value)) return 'public-domain';
  if (/^cc by(?: (?:1\.0|2\.0|2\.5|3\.0|4\.0))?$/.test(value)) return 'cc-by';
  if (/^cc by-sa(?: (?:1\.0|2\.0|2\.5|3\.0|4\.0))?$/.test(value)) return 'cc-by-sa';
  if (/^pexels(?: license)?$/.test(value)) return 'pexels';
  if (/^unsplash(?: license)?$/.test(value)) return 'unsplash';
  if (['permission', 'explicit permission', '明确授权'].includes(value)) return 'permission';
  return '';
}
function defaultEditor(type, circleId) {
  if (type === 'photo' || type === 'video') return 'catalog-photo';
  if (circleId === 'circle-cats') return 'catalog-cat-home';
  if (circleId === 'circle-walks') return 'catalog-dog-walk';
  return 'catalog-pet-care';
}

function manifestTargets(value, errors) {
  if (value === undefined) return { ...TARGETS };
  if (!record(value)) { errors.push('targets: 必须是包含 knowledge 和 photo 的对象'); return { ...TARGETS }; }
  if (Object.keys(value).some(key => !Object.hasOwn(LIMITS, key))) errors.push('targets: 只允许 knowledge、photo 和 video');
  const targets = {};
  for (const type of Object.keys(TARGETS)) {
    if (!Number.isInteger(value[type]) || value[type] < 0 || value[type] > LIMITS[type]) errors.push('targets.' + type + ': 必须是 0–' + LIMITS[type] + ' 的整数');
    targets[type] = value[type];
  }
  if (value.video !== undefined) {
    if (!Number.isInteger(value.video) || value.video < 0 || value.video > LIMITS.video) errors.push('targets.video: 必须是 0–' + LIMITS.video + ' 的整数');
    targets.video = value.video;
  }
  if (targets.knowledge === 0 && targets.photo === 0 && !targets.video) errors.push('targets: 总目标必须大于 0');
  return targets;
}

function validateManifest(manifest, options = {}) {
  const errors = [];
  const counts = { knowledge: 0, photo: 0 };
  const approved = { knowledge: 0, photo: 0 };
  const items = [];
  if (!record(manifest)) return { valid: false, errors: ['manifest: 必须是 JSON 对象'], batchId: '', counts, approved, items };
  const batchId = field(manifest.batchId, 'batchId', errors, 1, 64);
  const targets = manifestTargets(manifest.targets, errors);
  if (Object.hasOwn(targets, 'video')) { counts.video = 0; approved.video = 0; }
  if (manifest.omitPublicAttribution !== undefined && typeof manifest.omitPublicAttribution !== 'boolean') errors.push('omitPublicAttribution: 必须是布尔值');
  const omitPublicAttribution = manifest.omitPublicAttribution === true;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(batchId)) errors.push('batchId: 只能使用小写字母、数字和连字符');
  if (!Array.isArray(manifest.items)) errors.push('items: 必须是数组');
  const seen = { id: new Map(), text: new Map(), asset: new Map(), hash: new Map() };
  const unique = (bucket, key, location) => {
    if (!key) return;
    if (bucket.has(key)) errors.push(location + ': 与 ' + bucket.get(key) + ' 重复');
    else bucket.set(key, location);
  };
  for (const [index, raw] of (Array.isArray(manifest.items) ? manifest.items : []).entries()) {
    const at = 'items[' + index + ']';
    if (!record(raw)) { errors.push(at + ': 必须是内容对象'); continue; }
    const type = aliased(raw, 'contentType', 'type', at + '.contentType', errors);
    const knownType = typeof type === 'string' && Object.hasOwn(LIMITS, type);
    if (!knownType) errors.push(at + '.contentType: 只能是 knowledge、photo 或 video');
    else { counts[type] = (counts[type] || 0) + 1; approved[type] = approved[type] || 0; }
    const id = field(raw.id, at + '.id', errors, 1, 96);
    const prefix = type === 'knowledge' ? '(?:knowledge|guide)' : type === 'video' ? 'video' : 'photo';
    if (!new RegExp('^' + prefix + '-[a-z0-9][a-z0-9-]*$').test(id)) errors.push(at + '.id: 必须使用 ' + (type === 'knowledge' ? 'knowledge-（兼容 guide-）' : prefix + '-') + ' 前缀及小写字母、数字、连字符');
    unique(seen.id, id, at + '.id');
    const title = field(raw.title, at + '.title', errors, 1, 40);
    const text = field(raw.text, at + '.text', errors, type === 'knowledge' ? 60 : 1, 1000);
    if (type === 'knowledge' && Array.from(normalizedText(text)).length < 60) errors.push(at + '.text: 知识卡需要至少 60 字独立正文，空白不计入');
    unique(seen.text, normalizedText(text), at + '.text');
    const topics = TOPICS.normalize(raw.topics);
    if (!Array.isArray(raw.topics) || raw.topics.length > 3 || raw.topics.some(topic => typeof topic !== 'string' || !TOPICS.normalizeTopic(topic))) errors.push(at + '.topics: 使用项目已有话题，最多 3 个');
    const circleId = raw.circleId;
    if (!CIRCLES.includes(circleId)) errors.push(at + '.circleId: 圈子不存在');
    const requestedAnimals = raw.animalTypes === undefined ? [] : raw.animalTypes;
    if (!Array.isArray(requestedAnimals) || requestedAnimals.length > 3 || requestedAnimals.some(value => !ANIMAL_TYPES.includes(value))) errors.push(at + '.animalTypes: 最多 3 个有效动物种类');
    const animalTypes = Array.isArray(requestedAnimals) ? [...new Set(requestedAnimals)] : [];
    const editorId = raw.editorId === undefined ? defaultEditor(type, circleId) : raw.editorId;
    if (!EDITOR_IDS.includes(editorId)) errors.push(at + '.editorId: 必须是预设资料栏目账号，不能导入伪造用户');
    const sourceRaw = record(raw.source) ? raw.source : {};
    if (!record(raw.source)) errors.push(at + '.source: 缺少来源对象');
    const source = {
      title: field(sourceRaw.title, at + '.source.title', errors, 1, 300),
      publisher: field(sourceRaw.publisher, at + '.source.publisher', errors, 1, 160),
      url: urlField(sourceRaw.url, at + '.source.url', errors),
      author: field(sourceRaw.author, at + '.source.author', errors, 1, 160),
      checkedAt: dateField(sourceRaw.checkedAt, at + '.source.checkedAt', errors)
    };
    const reviewRaw = record(raw.review) ? raw.review : {};
    if (!record(raw.review)) errors.push(at + '.review: 缺少审核记录');
    if (!REVIEW_STATES.includes(reviewRaw.status)) errors.push(at + '.review.status: 只能是 pending、rejected 或 approved');
    const review = { status: reviewRaw.status };
    if (reviewRaw.status === 'approved') {
      if (knownType) approved[type]++;
      review.reviewer = field(reviewRaw.reviewer, at + '.review.reviewer', errors, 1, 80);
      review.reviewedAt = dateField(reviewRaw.reviewedAt, at + '.review.reviewedAt', errors);
    } else {
      if (reviewRaw.reviewer) review.reviewer = field(reviewRaw.reviewer, at + '.review.reviewer', errors, 1, 80);
      if (reviewRaw.reviewedAt) review.reviewedAt = dateField(reviewRaw.reviewedAt, at + '.review.reviewedAt', errors);
    }
    const assets = [];
    const inputImages = aliased(raw, 'images', 'assets', at + '.images', errors);
    const assetRaw = inputImages === undefined && type === 'knowledge' ? [] : inputImages;
    let coverPhotoId;
    if (raw.coverPhotoId !== undefined) {
      coverPhotoId = field(raw.coverPhotoId, at + '.coverPhotoId', errors, 1, 96);
      if (type !== 'knowledge') errors.push(at + '.coverPhotoId: 仅知识卡可以引用图片内容');
      if (Array.isArray(assetRaw) && assetRaw.length > 0) errors.push(at + '.coverPhotoId: 不能与自带 images 同时使用');
    }
    let imagePhotoIds;
    if (raw.imagePhotoIds !== undefined) {
      imagePhotoIds = Array.isArray(raw.imagePhotoIds) ? raw.imagePhotoIds.map((id, i) => field(id, at + '.imagePhotoIds[' + i + ']', errors, 1, 96)) : [];
      if (type !== 'knowledge') errors.push(at + '.imagePhotoIds: 仅编辑知识图解可以引用图片内容');
      if (imagePhotoIds.length < 2 || imagePhotoIds.length > 3 || new Set(imagePhotoIds).size !== imagePhotoIds.length) errors.push(at + '.imagePhotoIds: 需要 2–3 个不重复图片 ID');
      if (coverPhotoId !== undefined || Array.isArray(assetRaw) && assetRaw.length > 0) errors.push(at + '.imagePhotoIds: 不能与 coverPhotoId 或自带 images 同时使用');
    }
    let additionalPhotoIds;
    if (raw.additionalPhotoIds !== undefined) {
      additionalPhotoIds = Array.isArray(raw.additionalPhotoIds) ? raw.additionalPhotoIds.map((id, i) => field(id, at + '.additionalPhotoIds[' + i + ']', errors, 1, 96)) : [];
      if (type !== 'photo') errors.push(at + '.additionalPhotoIds: 仅自带新原图的图片内容可以补充已核验图片');
      if (additionalPhotoIds.length < 1 || additionalPhotoIds.length > 2 || new Set(additionalPhotoIds).size !== additionalPhotoIds.length) errors.push(at + '.additionalPhotoIds: 需要 1–2 个不重复图片 ID');
      if (!Array.isArray(assetRaw) || assetRaw.length < 1 || assetRaw.length + additionalPhotoIds.length > 3 || imagePhotoIds !== undefined || coverPhotoId !== undefined) errors.push(at + '.additionalPhotoIds: 必须自带至少 1 张独立新原图，补图后最多 3 张');
    }
    if (!Array.isArray(assetRaw) || assetRaw.length > 3 || type === 'photo' && assetRaw.length < 1) errors.push(at + '.images: 知识卡可附 0–3 张图片，图片内容必须有 1–3 张');
    if (type === 'video' && (!Array.isArray(assetRaw) || assetRaw.length !== 1)) errors.push(at + '.images: 视频内容必须有 1 张带许可元数据的封面');
    for (const [assetIndex, value] of (Array.isArray(assetRaw) ? assetRaw : []).entries()) {
      const name = at + '.images[' + assetIndex + ']';
      if (!record(value)) { errors.push(name + ': 必须是图片元数据对象'); continue; }
      const licenseRaw = record(value.license) ? value.license : {};
      const license = { name: field(licenseRaw.name, name + '.license.name', errors, 1, 100), url: urlField(licenseRaw.url, name + '.license.url', errors) };
      const typeOfLicense = licenseType(license.name);
      if (!typeOfLicense) errors.push(name + '.license.name: 只接受 CC0、Public Domain、CC BY、CC BY-SA、Pexels、Unsplash 或明确 permission');
      if (omitPublicAttribution && !['cc0', 'public-domain'].includes(typeOfLicense)) errors.push(name + '.license.name: omitPublicAttribution 仅允许 CC0 或 Public Domain 素材');
      const asset = {
        url: type === 'video' ? posterUrlField(value.url, value.contentHash, name + '.url', errors, options) : urlField(value.url, name + '.url', errors, true),
        originalUrl: urlField(value.originalUrl, name + '.originalUrl', errors),
        sourceUrl: urlField(value.sourceUrl, name + '.sourceUrl', errors),
        author: field(value.author, name + '.author', errors, 1, 160),
        license,
        attribution: field(value.attribution, name + '.attribution', errors, 1, 600)
      };
      const modification = aliased(value, 'modifiedDescription', 'changes', name + '.modifiedDescription', errors);
      if (modification !== undefined) asset.modifiedDescription = field(modification, name + '.modifiedDescription', errors, 0, 300);
      // Permission references name an editorial evidence record; they must not
      // contain access tokens, a local file path or the full private agreement.
      if (typeOfLicense === 'permission' || value.permissionRef !== undefined) asset.permissionRef = field(value.permissionRef, name + '.permissionRef', errors, 8, 300);
      // A bundled video-frame poster derives from this same item's original
      // video. Register that original once below, so other records still cannot
      // reuse it as a second independent video or photo.
      const ownVideoFrame = type === 'video' && /^\/assets\/curated-poster\/[0-9]+\.jpg$/.test(asset.url) &&
        record(raw.video) && canonicalAssetUrl(asset.originalUrl) === canonicalAssetUrl(raw.video.originalUrl);
      if (!ownVideoFrame) unique(seen.asset, canonicalAssetUrl(asset.originalUrl), name + '.originalUrl');
      if (value.contentHash !== undefined) {
        const hash = field(value.contentHash, name + '.contentHash', errors, 64, 71).toLowerCase().replace(/^sha256:/, '');
        if (!/^[a-f0-9]{64}$/.test(hash)) errors.push(name + '.contentHash: 需要 SHA-256 十六进制摘要，可加 sha256: 前缀');
        asset.contentHash = hash;
        unique(seen.hash, hash, name + '.contentHash');
      }
      assets.push(asset);
    }
    let video;
    if (type === 'video') {
      const value = record(raw.video) ? raw.video : {};
      if (!record(raw.video)) errors.push(at + '.video: 缺少视频元数据对象');
      const name = at + '.video';
      const licenseRaw = record(value.license) ? value.license : {};
      const license = { name: field(licenseRaw.name, name + '.license.name', errors, 1, 100), url: urlField(licenseRaw.url, name + '.license.url', errors) };
      const typeOfLicense = licenseType(license.name);
      if (!typeOfLicense) errors.push(name + '.license.name: 需要受支持的素材许可');
      if (omitPublicAttribution && !['cc0', 'public-domain'].includes(typeOfLicense)) errors.push(name + '.license.name: omitPublicAttribution 仅允许 CC0 或 Public Domain 素材');
      video = {
        url: videoUrlField(value.url, value.contentHash, name + '.url', errors, options),
        poster: posterUrlField(value.poster, assets[0] && assets[0].contentHash, name + '.poster', errors, options),
        durationSeconds: value.durationSeconds,
        originalUrl: urlField(value.originalUrl, name + '.originalUrl', errors),
        sourceUrl: urlField(value.sourceUrl, name + '.sourceUrl', errors),
        author: field(value.author, name + '.author', errors, 1, 160),
        license, attribution: field(value.attribution, name + '.attribution', errors, 1, 600)
      };
      if (!Number.isFinite(video.durationSeconds) || video.durationSeconds < 1 || video.durationSeconds > 60) errors.push(name + '.durationSeconds: 视频时长必须为 1–60 秒');
      if (assets.length === 1 && video.poster !== assets[0].url) errors.push(name + '.poster: 必须与已核验的 images 封面地址一致');
      if (value.modifiedDescription !== undefined) video.modifiedDescription = field(value.modifiedDescription, name + '.modifiedDescription', errors, 0, 300);
      if (typeOfLicense === 'permission' || value.permissionRef !== undefined) video.permissionRef = field(value.permissionRef, name + '.permissionRef', errors, 8, 300);
      unique(seen.asset, canonicalAssetUrl(video.originalUrl), name + '.originalUrl');
      if (value.contentHash !== undefined) {
        const hash = field(value.contentHash, name + '.contentHash', errors, 64, 71).toLowerCase().replace(/^sha256:/, '');
        if (!/^[a-f0-9]{64}$/.test(hash)) errors.push(name + '.contentHash: 需要 SHA-256 十六进制摘要，可加 sha256: 前缀');
        video.contentHash = hash;
        unique(seen.hash, hash, name + '.contentHash');
      }
    } else if (raw.video !== undefined) errors.push(at + '.video: 仅 video 内容可以提供视频');
    items.push({ id, contentType: type, title, text, topics, animalTypes, circleId, editorId, source, review, images: assets,
      ...(coverPhotoId !== undefined ? { coverPhotoId } : {}), ...(imagePhotoIds !== undefined ? { imagePhotoIds } : {}),
      ...(additionalPhotoIds !== undefined ? { additionalPhotoIds } : {}), ...(video ? { video } : {}) });
  }
  const byId = new Map(items.map(item => [item.id, item]));
  for (const item of items) {
    for (const id of item.imagePhotoIds || (item.coverPhotoId === undefined ? [] : [item.coverPhotoId])) {
      const field = item.imagePhotoIds ? 'imagePhotoIds' : 'coverPhotoId';
      const referenced = byId.get(id);
      if (id === item.id) errors.push(item.id + '.' + field + ': 不能引用自身');
      else if (!referenced) errors.push(item.id + '.' + field + ': 引用必须存在于同一清单');
      else if (referenced.contentType !== 'photo') errors.push(item.id + '.' + field + ': 只能引用 photo 内容');
    }
    for (const id of item.additionalPhotoIds || []) {
      const referenced = byId.get(id);
      if (id === item.id || !referenced || referenced.contentType !== 'photo' || referenced.images.length !== 1 || referenced.additionalPhotoIds) errors.push(item.id + '.additionalPhotoIds: 只能引用同一清单内另一条独立单图内容');
      else if (referenced.review.status !== 'approved') errors.push(item.id + '.additionalPhotoIds: 补图必须已经核验通过');
    }
  }
  return { valid: errors.length === 0, errors, batchId, targets, omitPublicAttribution, counts, approved, items };
}

function status(manifest, options = {}) {
  const checked = validateManifest(manifest, options);
  const allowed = contentPolicy.videoEnabled || !checked.items.some(contentPolicy.isVideoPost);
  return {
    batchId: checked.batchId,
    targets: checked.targets || { ...TARGETS }, omitPublicAttribution: checked.omitPublicAttribution === true, counts: checked.counts, approved: checked.approved,
    total: Object.values(checked.counts).reduce((sum, count) => sum + count, 0),
    approvedTotal: Object.values(checked.approved).reduce((sum, count) => sum + count, 0),
    metadataValid: checked.valid,
    readyToBuild: checked.valid && allowed && Object.keys(LIMITS).every(type => (checked.counts[type] || 0) === (checked.targets[type] || 0) && (checked.approved[type] || 0) === (checked.targets[type] || 0)),
    readyToBuildPartial: checked.valid && allowed && checked.items.length > 0 && Object.keys(LIMITS).every(type => (checked.counts[type] || 0) <= (checked.targets[type] || 0) && (checked.approved[type] || 0) === (checked.counts[type] || 0)),
    verification: 'metadata-only; sources and permissions require editorial review',
    errors: checked.errors
  };
}

// Generate ordinary CommonJS literals with immutable strings and flat credit
// facts shared in source only. Exported objects and arrays remain independent;
// no decompression library, browser API or asynchronous loading is needed.
function serializeCatalog(posts, version) {
  const data = JSON.parse(JSON.stringify(posts));
  const frequencies = new Map();
  function visit(value) {
    if (typeof value === 'string') frequencies.set(value, (frequencies.get(value) || 0) + 1);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(data);
  const candidates = Array.from(frequencies, ([value, count]) => ({ value, count, bytes: Buffer.byteLength(JSON.stringify(value)) }))
    .filter(item => item.count > 1)
    .sort((a, b) => (b.bytes - 6) * b.count - b.bytes - ((a.bytes - 6) * a.count - a.bytes));
  const strings = [];
  for (const item of candidates) {
    const referenceBytes = ('S[' + strings.length + ']').length;
    if ((item.bytes - referenceBytes) * item.count > item.bytes + 1) strings.push(item.value);
  }
  // Give the most frequently used strings the shortest numeric references.
  strings.sort((a, b) => frequencies.get(b) - frequencies.get(a));
  const indexes = new Map(strings.map((value, index) => [value, index]));
  function encode(value, stringIndexes = indexes, creditIndexes) {
    if (typeof value === 'string') return stringIndexes.has(value) ? 'S[' + stringIndexes.get(value) + ']' : JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(child => encode(child, stringIndexes, creditIndexes)).join(',') + ']';
    if (value && typeof value === 'object') {
      if (creditIndexes && creditIndexes.has(value)) return '{...creditFacts[' + creditIndexes.get(value) + ']}';
      return '{' + Object.entries(value).map(([key, child]) => {
        // Keep own __proto__ as data even in the unpooled fallback.
        const property = key === '__proto__' ? '["__proto__"]' : /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
        return property + ':' + encode(child, stringIndexes, creditIndexes);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }
  const creditGroups = new Map();
  for (const post of Array.isArray(data) ? data : []) {
    for (const credit of record(post) && Array.isArray(post.imageCredits) ? post.imageCredits : []) {
      if (!record(credit) || Object.values(credit).some(value => value !== null && typeof value === 'object')) continue;
      const literal = encode(credit);
      const group = creditGroups.get(literal) || { literal, instances: [], bytes: Buffer.byteLength(literal) };
      group.instances.push(credit);
      creditGroups.set(literal, group);
    }
  }
  const creditFacts = [], creditIndexes = new Map();
  const repeated = Array.from(creditGroups.values()).filter(group => group.instances.length > 1)
    .sort((a, b) => (b.instances.length - 1) * b.bytes - (a.instances.length - 1) * a.bytes);
  for (const group of repeated) {
    const referenceBytes = ('{...creditFacts[' + creditFacts.length + ']}').length;
    if ((group.bytes - referenceBytes) * group.instances.length <= group.bytes + 1) continue;
    group.instances.forEach(credit => creditIndexes.set(credit, creditFacts.length));
    creditFacts.push(group.literal);
  }
  const stringPool = strings.length ? 'const S=' + JSON.stringify(strings) + ';\n' : '';
  const plain = 'const CURATED_POSTS = ' + encode(data, new Map()) + ';\n';
  const pooled = stringPool + 'const CURATED_POSTS = ' + encode(data) + ';\n';
  const credits = stringPool + 'const creditFacts=[' + creditFacts.join(',') + '];\n' + 'const CURATED_POSTS = ' + encode(data, indexes, creditIndexes) + ';\n';
  let body = Buffer.byteLength(pooled) < Buffer.byteLength(plain) ? pooled : plain;
  if (creditFacts.length && Buffer.byteLength(credits) < Buffer.byteLength(body)) body = credits;
  return "'use strict';\n\n// Generated from an editorially approved manifest. The import tool validates\n// metadata only; it does not fetch sources or independently verify licences.\nconst CATALOG_VERSION = " + JSON.stringify(version) + ';\n' + body + '\nmodule.exports = { CURATED_POSTS, CATALOG_VERSION };\n';
}

function buildCatalog(manifest, options = {}) {
  const checked = validateManifest(manifest, options);
  if (!checked.valid) throw new Error('内容元数据校验失败，现有目录未修改：\n' + checked.errors.join('\n'));
  if (!contentPolicy.videoEnabled && checked.items.some(contentPolicy.isVideoPost)) throw new Error('视频发布已停用，不能生成含视频的目录；现有目录未修改');
  if (options.partial !== undefined && typeof options.partial !== 'boolean') throw new Error('partial 必须是布尔值；现有目录未修改');
  const partialBuild = options.partial === true;
  const targets = checked.targets;
  const quota = targets.knowledge + ' 条知识卡和 ' + targets.photo + ' 条图片内容' + (targets.video ? '及 ' + targets.video + ' 条视频' : '');
  if (partialBuild) {
    if (!checked.items.length) throw new Error('小批发布必须包含至少 1 条已审批内容，不能用空清单清空目录；现有目录未修改');
    if (Object.keys(LIMITS).some(type => (checked.counts[type] || 0) > (targets[type] || 0))) throw new Error('小批发布不能超过 ' + quota + '；现有目录未修改');
    if (Object.keys(LIMITS).some(type => (checked.approved[type] || 0) !== (checked.counts[type] || 0))) throw new Error('小批发布的每条内容都必须有 approved 审核记录；现有目录未修改');
  } else {
    if (Object.keys(LIMITS).some(type => (checked.counts[type] || 0) !== (targets[type] || 0))) throw new Error('批次必须准确包含 ' + quota + '；现有目录未修改');
    if (Object.keys(LIMITS).some(type => (checked.approved[type] || 0) !== (targets[type] || 0))) throw new Error('全部 ' + Object.values(targets).reduce((sum, count) => sum + count, 0) + ' 条内容必须有 approved 审核记录后才能生成；现有目录未修改');
  }
  const byId = new Map(checked.items.map(item => [item.id, item]));
  const posts = checked.items.map(item => {
    // References reuse verified assets; they do not add independent photos or
    // bypass original-asset/hash deduplication during manifest validation.
    const images = item.imagePhotoIds ? item.imagePhotoIds.map(id => byId.get(id).images[0]) : item.coverPhotoId ? byId.get(item.coverPhotoId).images : item.additionalPhotoIds ? [...item.images, ...item.additionalPhotoIds.map(id => byId.get(id).images[0])] : item.images;
    return {
      id: item.id, contentType: item.contentType, title: item.title, text: item.text,
      kind: 'daily', topics: item.topics, animalTypes: item.animalTypes, circleId: item.circleId, editorId: item.editorId, source: item.source,
      ...(item.coverPhotoId ? { coverPhotoId: item.coverPhotoId } : {}),
      ...(item.imagePhotoIds ? { imagePhotoIds: item.imagePhotoIds } : {}),
      ...(item.additionalPhotoIds ? { additionalPhotoIds: item.additionalPhotoIds } : {}),
      ...(checked.omitPublicAttribution ? { omitPublicAttribution: true } : {}),
      ...(item.video ? { video: { url: item.video.url, poster: item.video.poster, durationSeconds: item.video.durationSeconds } } : {}),
      images: images.map(asset => asset.url),
      imageCredits: images.map(asset => ({
        imageUrl: asset.url, originalUrl: asset.originalUrl, sourceUrl: asset.sourceUrl,
        author: asset.author, licenseName: asset.license.name, licenseUrl: asset.license.url,
        attribution: asset.attribution, modifiedDescription: asset.modifiedDescription || ''
      }))
    };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const digest = createHash('sha256').update(JSON.stringify(posts)).digest('hex');
  const version = checked.batchId + '-' + digest.slice(0, 16);
  const content = serializeCatalog(posts, version);
  const output = path.resolve(options.output || DEFAULT_OUTPUT);
  let changed = true;
  try { changed = fs.readFileSync(output, 'utf8') !== content; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (changed) {
    // Validate the entire batch before touching the output. A same-directory
    // rename replaces the catalogue atomically, including when it exists.
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temporary = output + '.tmp-' + process.pid + '-' + randomUUID();
    try {
      fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
      fs.renameSync(temporary, output);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return {
    output, version, hash: digest, counts: checked.counts, approved: checked.approved,
    writtenCount: posts.length,
    targets, omitPublicAttribution: checked.omitPublicAttribution,
    coverage: Object.fromEntries(Object.keys(targets).map(type => [type, { count: checked.counts[type], approved: checked.approved[type], target: targets[type] }])),
    isPartial: Object.keys(targets).some(type => checked.counts[type] < targets[type]),
    buildMode: partialBuild ? 'partial' : 'full',
    snapshotMode: 'replace', snapshotNotice: SNAPSHOT_NOTICE,
    changed, verification: 'metadata-only'
  };
}

module.exports = { ROOT, DEFAULT_INPUT, DEFAULT_OUTPUT, TARGETS, LIMITS, SNAPSHOT_NOTICE, EDITOR_IDS, ANIMAL_TYPES, validateManifest, buildCatalog, status, serializeCatalog };
