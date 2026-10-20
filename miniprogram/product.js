const config = require('./config');

// Product scope is fixed by the shipped package, never by reviewer identity,
// launch scene, time, or a remote setting. Retired routes are also unregistered.
const personalMode = config.productMode === 'personal';
const PERSONAL_PAGES = [
  'pages/community/index', 'pages/nearby/index', 'pages/me/index',
  'pages/post/index', 'pages/compose/index', 'pages/profile/index',
  'pages/records/index', 'pages/policy/index', 'pages/local-detail/index',
  'pages/places/index', 'pages/web/index',
  'media/pages/index', 'media2/pages/index', 'media3/pages/index'
];
function allowsNavigation(url) {
  if (!personalMode) return true;
  if (typeof url !== 'string') return false;
  const route = url.split(/[?#]/)[0].replace(/^\//, '');
  return PERSONAL_PAGES.includes(route);
}
module.exports = { personalMode, PERSONAL_PAGES, allowsNavigation };
