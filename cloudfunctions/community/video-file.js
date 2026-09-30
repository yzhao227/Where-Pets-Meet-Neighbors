'use strict';

const { AppError } = require('./service');
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SECONDS = 60;

function invalid(message) { throw new AppError('INVALID_VIDEO', message || '视频文件无效，请选择 MP4 视频'); }
function uint64(bytes, offset) {
  const number = bytes.readUInt32BE(offset) * 0x100000000 + bytes.readUInt32BE(offset + 4);
  if (!Number.isSafeInteger(number)) invalid();
  return number;
}

// Parse ISO BMFF box boundaries rather than accepting a renamed file or an
// ftyp-only header. Native WeChat compression produces ordinary MP4 tracks;
// fragmented, encrypted and unsupported files fail closed for re-selection.
function boxes(bytes, start, end) {
  const result = [];
  for (let offset = start; offset < end;) {
    if (result.length >= 4096 || offset + 8 > end) invalid();
    let size = bytes.readUInt32BE(offset); let header = 8;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (size === 1) {
      if (offset + 16 > end) invalid();
      size = uint64(bytes, offset + 8); header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) invalid();
    result.push({ type, start: offset, data: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}
function one(rows, type) {
  const found = rows.filter(box => box.type === type);
  if (found.length !== 1) invalid();
  return found[0];
}
function requireBytes(box, length) { if (box.end - box.data < length) invalid(); }
function duration(bytes, box) {
  requireBytes(box, 20);
  const version = bytes[box.data];
  if (version !== 0 && version !== 1) invalid();
  requireBytes(box, version === 1 ? 32 : 20);
  const timescale = bytes.readUInt32BE(box.data + (version === 1 ? 20 : 12));
  const ticks = version === 1 ? uint64(bytes, box.data + 24) : bytes.readUInt32BE(box.data + 16);
  const seconds = ticks / timescale;
  if (!timescale || !Number.isFinite(seconds) || seconds <= 0) invalid('无法读取视频实际时长，请重新选择');
  return { seconds, timescale };
}

function inspectVideo(bytes, extension = 'mp4') {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || extension !== 'mp4') invalid();
  if (bytes.length > MAX_BYTES) throw new AppError('VIDEO_TOO_LARGE', '视频不能超过 20 MiB');
  const top = boxes(bytes, 0, bytes.length);
  const ftyp = one(top, 'ftyp'); requireBytes(ftyp, 8);
  if ((ftyp.end - ftyp.data) % 4 !== 0 || top.some(box => box.type === 'moof')) invalid();
  const brands = [bytes.toString('ascii', ftyp.data, ftyp.data + 4)];
  for (let at = ftyp.data + 8; at < ftyp.end; at += 4) brands.push(bytes.toString('ascii', at, at + 4));
  if (!brands.some(brand => /^(?:isom|iso[2-9]|avc1|mp4[12]|M4V )$/.test(brand)) || brands[0] === 'qt  ') invalid('仅支持 MP4 视频，请使用微信压缩后重试');
  const media = top.filter(box => box.type === 'mdat');
  if (!media.length || media.every(box => box.end <= box.data)) invalid();
  const mediaBytes = media.reduce((total, box) => total + box.end - box.data, 0);
  const moov = one(top, 'moov');
  const movie = boxes(bytes, moov.data, moov.end);
  const movieTime = duration(bytes, one(movie, 'mvhd'));
  let actualDuration = movieTime.seconds;
  const tracks = movie.filter(box => box.type === 'trak');
  if (!tracks.length || tracks.length > 16) invalid();
  const videos = [];
  for (const track of tracks) {
    const trackRows = boxes(bytes, track.data, track.end);
    const tkhd = one(trackRows, 'tkhd'); requireBytes(tkhd, 84);
    const version = bytes[tkhd.data];
    if (version !== 0 && version !== 1) invalid();
    requireBytes(tkhd, version === 1 ? 96 : 84);
    const trackTicks = version === 1 ? uint64(bytes, tkhd.data + 28) : bytes.readUInt32BE(tkhd.data + 20);
    actualDuration = Math.max(actualDuration, trackTicks / movieTime.timescale);
    const mdia = one(trackRows, 'mdia');
    const trackMedia = boxes(bytes, mdia.data, mdia.end);
    const mediaTime = duration(bytes, one(trackMedia, 'mdhd'));
    const handler = one(trackMedia, 'hdlr'); requireBytes(handler, 12);
    if (bytes.toString('ascii', handler.data + 8, handler.data + 12) !== 'vide') continue;
    // AAC decoding can include encoder priming outside its presentation window;
    // audio presentation is bounded by tkhd/movie time rather than raw mdhd.
    actualDuration = Math.max(actualDuration, mediaTime.seconds);
    const minf = one(trackMedia, 'minf');
    const stbl = one(boxes(bytes, minf.data, minf.end), 'stbl');
    const samples = boxes(bytes, stbl.data, stbl.end);
    const stsd = one(samples, 'stsd'); requireBytes(stsd, 8);
    const formats = boxes(bytes, stsd.data + 8, stsd.end);
    if (bytes.readUInt32BE(stsd.data + 4) !== formats.length || formats.length !== 1) invalid();
    const format = formats[0]; requireBytes(format, 78);
    if (!['avc1', 'avc3', 'hvc1', 'hev1'].includes(format.type)) invalid('请使用 H.264 或 H.265 编码的 MP4 视频');
    const width = bytes.readUInt16BE(format.data + 24), height = bytes.readUInt16BE(format.data + 26);
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) invalid();
    const codec = one(boxes(bytes, format.data + 78, format.end), format.type.startsWith('avc') ? 'avcC' : 'hvcC');
    requireBytes(codec, format.type.startsWith('avc') ? 7 : 23);
    const stts = one(samples, 'stts'); requireBytes(stts, 8);
    const timings = bytes.readUInt32BE(stts.data + 4);
    if (!timings || stts.end - stts.data !== 8 + timings * 8) invalid();
    let sampleCount = 0, sampleTicks = 0;
    for (let at = stts.data + 8; at < stts.end; at += 8) {
      const count = bytes.readUInt32BE(at), delta = bytes.readUInt32BE(at + 4);
      if (!count || !delta) invalid();
      sampleCount += count; sampleTicks += count * delta;
      if (!Number.isSafeInteger(sampleTicks) || sampleCount > 1000000) invalid();
    }
    actualDuration = Math.max(actualDuration, sampleTicks / mediaTime.timescale);
    const stsz = one(samples, 'stsz'); requireBytes(stsz, 12);
    const uniformSize = bytes.readUInt32BE(stsz.data + 4), sizeCount = bytes.readUInt32BE(stsz.data + 8);
    if (sizeCount !== sampleCount || stsz.end - stsz.data !== 12 + (uniformSize ? 0 : sizeCount * 4)) invalid();
    let sampleBytes = uniformSize * sizeCount;
    if (!uniformSize) for (let at = stsz.data + 12; at < stsz.end; at += 4) sampleBytes += bytes.readUInt32BE(at);
    if (sampleBytes <= 0 || sampleBytes > mediaBytes) invalid();
    const offsets = samples.filter(box => ['stco', 'co64'].includes(box.type));
    if (offsets.length !== 1) invalid();
    const offsetsBox = offsets[0]; requireBytes(offsetsBox, 8);
    const stride = offsetsBox.type === 'co64' ? 8 : 4;
    const chunks = bytes.readUInt32BE(offsetsBox.data + 4);
    if (!chunks || offsetsBox.end - offsetsBox.data !== 8 + chunks * stride) invalid();
    for (let at = offsetsBox.data + 8; at < offsetsBox.end; at += stride) {
      const offset = stride === 8 ? uint64(bytes, at) : bytes.readUInt32BE(at);
      if (!media.some(box => offset >= box.data && offset < box.end)) invalid();
    }
    videos.push({ width, height });
  }
  if (!videos.length) invalid('文件中没有可播放的视频轨道');
  if (!Number.isFinite(actualDuration) || actualDuration <= 0) invalid();
  if (actualDuration > MAX_SECONDS) throw new AppError('VIDEO_TOO_LONG', '单个视频最长 60 秒，请剪短后重试');
  return { contentType: 'video/mp4', bytes: bytes.length, durationSeconds: actualDuration, ...videos[0] };
}

module.exports = { inspectVideo, MAX_BYTES, MAX_SECONDS };
