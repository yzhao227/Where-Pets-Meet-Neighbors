'use strict';

const crypto = require('node:crypto');
const { AppError } = require('./service');

// This adapter is server-only. Raw numbers exist only briefly in this function and
// are neither returned to the domain/client nor persisted or written to logs.
function createPhoneVerifier(cloud, environment) {
  const secret = environment.PHONE_HASH_SECRET || '';
  const available = cloud && cloud.openapi && cloud.openapi.phonenumber && typeof cloud.openapi.phonenumber.getPhoneNumber === 'function';
  const enabled = environment.PHONE_VERIFICATION_ENABLED === 'true' && Buffer.byteLength(secret, 'utf8') >= 32 && secret.trim().length > 0 && !!available;
  return {
    enabled,
    async verifyCode(code) {
      if (!enabled) throw new AppError('PHONE_UNAVAILABLE', '手机号核验尚未配置，请联系运营者');
      let result;
      try { result = await cloud.openapi.phonenumber.getPhoneNumber({ code }); }
      catch (_) { throw new AppError('PHONE_VERIFICATION_FAILED', '微信手机号核验未成功，请重新授权后重试'); }
      const errorCode = result && (result.errCode === undefined ? result.errcode : result.errCode);
      const phone = result && (result.phoneInfo || result.phone_info);
      if (errorCode !== 0 || !phone) throw new AppError('PHONE_VERIFICATION_FAILED', '微信手机号核验未成功，请重新授权后重试');
      const country = String(phone.countryCode === undefined ? phone.country_code || '' : phone.countryCode);
      const national = String(phone.purePhoneNumber === undefined ? phone.pure_phone_number || '' : phone.purePhoneNumber);
      if (!/^[1-9][0-9]{0,3}$/.test(country) || !/^[0-9]{7,14}$/.test(national) || country.length + national.length > 15) {
        throw new AppError('PHONE_VERIFICATION_FAILED', '微信返回的手机号信息不完整，请重新授权后重试');
      }
      const canonical = `+${country}${national}`;
      const phoneKey = `ph_${crypto.createHmac('sha256', secret).update(`youchong-phone-v1:${canonical}`).digest('hex')}`;
      const visiblePrefix = national.length >= 10 ? national.slice(0, 3) : '';
      const maskedPhone = `+${country} ${visiblePrefix}${'*'.repeat(Math.max(4, national.length - visiblePrefix.length - 4))}${national.slice(-4)}`;
      return { phoneKey, maskedPhone };
    }
  };
}

module.exports = { createPhoneVerifier };
