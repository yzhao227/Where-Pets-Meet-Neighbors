'use strict';

const additionalShapes = require('../../data/curated-shapes');

// Compact shape hints from the approved catalogue's existing Commons metadata.
// Unknown images start fully contained. No catalogue or user data is changed;
// these hints reserve taller frames before loading begins to keep photos dominant.
const PORTRAITS = new Set('191392916 68608952 148465188 142916199 196899360 148351244 143121979 183770272 145352113 149287804 175891139 142917064 148653178 157059809 72027806 15957924 123858522 116675279 116761695 151439490 154512024 154511883 15957835 154512149 167915424 181723485 182506623 187358862 120627440 177243784 198496329 149176678 138202191 176605947 149187296 171805594 152977824 199018349 147796529 147733270 147718507 198034033 186436500 143883376 113304301 147359521 163103659 69408720 141266248 147342436 150949970 164819779'.split(' '));
const LANDSCAPES = new Set('61856994 61619827 76097663 81513944 94885224 126144013 85952329 85952327 85952330 94885223 92201445 110153952 169786731 148557486 18764428 171953505 126143561 63705523 97274886 197180428 62207892 138384797 68608233 46704078 31049959 176377551 39619840 46671383 62176874 68607529 145478988 26592914 189372065 131640573 131641710 163829632 31033299 65257801 131127210 123228797 67379828 167852355 116675287 131641351 67379827 14707893 152384824 177243945 126371057 141342617 120627436 81984202 198519439 131641833 40712721 169225669 146079513 15060306 176378449 111181383 155032662 181503615 155880836 129913602 56628996 200255842 69452935 198034185 175432775 130119306 186642120 15690260 193124568 91368362 55029475 193433386 181503664 79067216 167171 156307723 62231316 38484097 195520635 18280751 152771179 139199242 122210138 15416446 18707726 97673453 17797779 156038624 86374218 189264082 61696100 15758167 63987793 175313100 198034222 61695010 121439018 143838847 26064246 14759520 72070453 167245525 34900452 105720241 93435557 71852953 69295425 105723260 24887320 121439037 18094679 71317053 80427912 70114486 146730506 195567546 105758621 155186024 77198954 112285953'.split(' '));
const SQUARES = new Set('61369169 147230400 85952328 45948776 68609174 69243778 200109802 148652591 150140769 12910032 46858283 191102767 155967668 198523592 163230242 31705969 62093062 163230733 108429446 182447435 91733769 37443137 149146759 106922444'.split(' '));
// Character n - 1 describes knowledge-n's coverPhotoId: p/l/s = portrait /
// landscape / square; '.' = no known item. The reviewed covers also allow fill.
const KNOWLEDGE_SHAPES = 'lllpslp......l..l.p...llsl.l.p.lllp.p..pl...s.l..l.sl...p...l.lls.ll.lll...pl.lplp...ps.p.s.ll';
// Named editorial groups reuse the first photo's verified source dimensions.
// Keep this tiny mapping here because feed responses need not expose import refs.
const GROUP_COVER_SOURCES = Object.freeze({
  'knowledge-observe-rabbit-routine': '199018349',
  'knowledge-observe-bird-framing': '31705969',
  'knowledge-observe-guppy-tails': '193433386',
  'knowledge-observe-axolotl-colors': '46858283',
  'knowledge-observe-shrimp-scenes': '200255842',
  'knowledge-observe-gecko-details': '37443137',
  'knowledge-observe-chinchilla-features': '86374218',
  'knowledge-observe-guinea-pig-coats': '198523592'
});
// The two new posters preserve their encoded clips' 480×270 / 480×854 shape.
LANDSCAPES.add('101613615');
PORTRAITS.add('134636343');
// The ten reviewed original JPEGs are 644–905 px wide in their source metadata.
// Match exact Commons paths only; a different file must keep its original URL.
const REVIEWED_ORIGINALS = new Set('d/d7/Small_Cat_Receiving_Love.jpg f/f4/Dog_sleeping_in_a_dog_bed.JPG f/f0/Anatolian_Shepherd_Dog_Laying.jpg 2/28/Orange_Syrian_shorthair_hamster.jpg 6/66/Holland_Lop_Bunny_Standing_On_Her_Back_Feet.jpg 1/16/Cat_Peeing_in_Plant.jpg 8/8d/Winter_white_hamster_sapphire.jpg c/c2/Winter_white_hamster_pearl_sapphire.jpg 9/9d/Goldhamster.jpg 0/05/Bunny_Photo.jpg'.split(' '));

function attemptNumber(value) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function dimensions(width, height) {
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : null;
}
function modeForSize(size, ratio) {
  const frame = ratio === 'portrait' ? 2 / 3 : 5 / 7;
  const relative = size && size.width / size.height / frame;
  // A taller feed frame keeps photos dominant. Panoramas and very tall images
  // retain the whole image; tapping any card opens its uncropped detail view.
  return relative && Math.min(relative, 1 / relative) >= 0.4 ? 'aspectFill' : 'aspectFit';
}
function initialShape(post) {
  const extra = additionalShapes[String(post.id || '').replace(/^catalog-/, '')];
  const size = dimensions(post.coverWidth, post.coverHeight) ||
    (post.video && post.cover === post.video.poster && dimensions(post.video.width, post.video.height)) ||
    (extra && dimensions(extra[0], extra[1]));
  if (size) {
    const sourceRatio = size.width / size.height;
    const ratio = sourceRatio < 0.9 ? 'portrait' : sourceRatio >= 1.2 ? 'landscape' : 'square';
    return { ratio, mode: modeForSize(size, ratio) };
  }
  const knowledge = /^(?:catalog-)?knowledge-(\d+)$/.exec(post.id || '');
  const hint = knowledge && KNOWLEDGE_SHAPES[Number(knowledge[1]) - 1];
  if (hint && hint !== '.') return { ratio: { p: 'portrait', l: 'landscape', s: 'square' }[hint], mode: 'aspectFill' };
  const match = /^(?:catalog-)?(?:photo|video)-commons-(\d+)$/.exec(post.id || '');
  const sourceId = match && match[1] || GROUP_COVER_SOURCES[String(post.id || '').replace(/^catalog-/, '')];
  if (PORTRAITS.has(sourceId)) return { ratio: 'portrait', mode: 'aspectFill' };
  if (LANDSCAPES.has(sourceId)) return { ratio: 'landscape', mode: 'aspectFill' };
  return { ratio: 'square', mode: SQUARES.has(sourceId) ? 'aspectFill' : 'aspectFit' };
}
function listCoverSource(post, sourceSrc) {
  if (post.isEditorialContent !== true) return sourceSrc;
  const thumb = /^(https:\/\/thumb\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/[^/?#\s]+\/)(\d+)px-([^/?#\s]+)([?#][^\s]*)?$/.exec(sourceSrc);
  if (thumb && Number(thumb[2]) > 500) return thumb[1] + '500px-' + thumb[3] + (thumb[4] || '');
  const original = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f]\/[0-9a-f]{2}\/([^/?#\s]+))([?#][^\s]*)?$/.exec(sourceSrc);
  if (original && REVIEWED_ORIGINALS.has(original[1])) return 'https://thumb.wikimedia.org/wikipedia/commons/thumb/' + original[1] + '/500px-' + original[2] + (original[3] || '');
  return sourceSrc;
}
function createCoverState(post, attempt) {
  const sourceSrc = typeof post.cover === 'string' ? post.cover : '';
  const src = listCoverSource(post, sourceSrc);
  return Object.assign({ id: post.id, sourceSrc, src, attempt: attemptNumber(attempt) || 0, status: src ? 'loading' : 'none' }, initialShape(post));
}
function cardLabel(post) {
  if (post.video) return { cardLabel: '视频', cardLabelType: 'video' };
  if (post.contentType === 'knowledge') return { cardLabel: '知识', cardLabelType: 'knowledge' };
  if (post.kind === 'question') return { cardLabel: '问答', cardLabelType: 'question' };
  if (post.kind === 'meetup') return { cardLabel: '一起玩', cardLabelType: 'meetup' };
  return { cardLabel: '', cardLabelType: '' };
}
function decorate(post, state) {
  const sourceSrc = typeof post.cover === 'string' ? post.cover : '';
  const current = state && state.id === post.id && state.sourceSrc === sourceSrc ? state : createCoverState(post, 0);
  return Object.assign({}, post, cardLabel(post), {
    coverRatio: current.ratio, coverMode: current.mode, coverState: current.status,
    coverAttempt: current.attempt, coverSrc: current.src
  });
}
function applyCoverEvent(state, event) {
  if (!state || !event || !state.src || state.status !== 'loading' ||
      event.id !== state.id || event.src !== state.src || attemptNumber(event.attempt) !== state.attempt) return state;
  if (event.type === 'error') {
    // A small thumbnail can be unavailable even when the catalogue URL works.
    // Retry that original source once with a new event identity, then stop.
    if (state.sourceSrc && state.src !== state.sourceSrc && state.attempt < Number.MAX_SAFE_INTEGER) {
      return Object.assign({}, state, { src: state.sourceSrc, attempt: state.attempt + 1, status: 'loading' });
    }
    return Object.assign({}, state, { status: 'error' });
  }
  if (event.type !== 'load') return state;
  const size = dimensions(event.width, event.height);
  // The reserved frame stays fixed across load/error/retry, preventing card jumps.
  return Object.assign({}, state, size || {}, { status: 'ready', mode: size ? modeForSize(size, state.ratio) : state.mode });
}
function retryCover(state, nextAttempt) {
  const attempt = attemptNumber(nextAttempt);
  if (!state || !state.src || state.status !== 'error' || attempt === null || attempt <= state.attempt) return state;
  return Object.assign({}, state, { attempt, status: 'loading' });
}
// An estimate in card-width units, for assigning only new cards to a short column.
function estimateHeight(post, state) {
  const card = !state && typeof post.coverSrc === 'string' ? post : decorate(post, state);
  const titleLength = Array.from(card.displayTitle || card.title || '').length;
  const textLength = Array.from(card.cardText || card.text || card.title || '').length;
  const media = card.coverSrc ? (card.coverRatio === 'portrait' ? 1.5 : 1.4) : Math.min(1.4, 0.38 + Math.ceil(textLength / 11) * 0.17);
  const title = card.coverSrc && titleLength ? Math.min(2, Math.ceil(titleLength / 12)) * 0.14 : 0;
  return media + title + 0.3 + (card.circle && card.circle.name || card.topics && card.topics.length ? 0.11 : 0);
}

module.exports = { createCoverState, decorate, applyCoverEvent, retryCover, estimateHeight };
