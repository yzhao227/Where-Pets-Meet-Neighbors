'use strict';

// The mini program runtime does not consistently provide the browser URL class.
// Accept an absolute HTTPS URL with a normal hostname, no credentials, control
// characters or malformed escapes.
function httpsUrl(value) {
  if (typeof value !== 'string' || /[\s\\<>"\u0000-\u001f\u007f]/.test(value) || /%(?![0-9a-f]{2})/i.test(value)) return '';
  const match = /^https:\/\/([^/?#]+)(?:[/?#].*)?$/i.exec(value);
  if (!match) return '';
  const authority = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(match[1]);
  if (!authority || authority[2] && (Number(authority[2]) < 1 || Number(authority[2]) > 65535)) return '';
  const host = authority[1];
  if (host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return '';
  return value;
}

module.exports = { httpsUrl };
