const config = require('./config');

// Product scope is fixed by the shipped package, never by reviewer identity,
// launch scene, time, or a remote setting.
const personalMode = config.productMode === 'personal';
const PERSONAL_PAGES = [
  'pages/community/index', 'pages/nearby/index', 'pages/me/index',
  'pages/post/index', 'pages/compose/index', 'pages/profile/index',
  'pages/records/index', 'pages/policy/index', 'pages/local-detail/index',
  'pages/places/index', 'pages/web/index'
];
const COMMUNITY_PAGES = PERSONAL_PAGES.concat([
  'pages/messages/index', 'pages/circle/index', 'pages/circle-square/index',
  'pages/event/index', 'pages/blocked/index', 'pages/manage/index',
  'pages/moderation/index', 'pages/author/index', 'pages/register/index',
  'pages/petstats/index', 'pages/operations/index', 'pages/places-manage/index',
  'social/pages/friends/index',
  'social/pages/chat/index', 'social/pages/contribute/index',
  'social/pages/submissions-manage/index', 'social/pages/private-library/index'
]);
function allowsNavigation(url) {
  if (typeof url !== 'string') return false;
  const route = url.split(/[?#]/)[0].replace(/^\//, '');
  return (personalMode ? PERSONAL_PAGES : COMMUNITY_PAGES).includes(route);
}
module.exports = { personalMode, PERSONAL_PAGES, COMMUNITY_PAGES, allowsNavigation };
