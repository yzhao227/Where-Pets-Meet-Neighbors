'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function generate(file) {
  const values = {
    PHONE_HASH_SECRET: crypto.randomBytes(32).toString('hex'),
    MAINTENANCE_SECRET: crypto.randomBytes(32).toString('hex'),
    SETUP_SECRET: crypto.randomBytes(32).toString('hex'),
    MEDIA_CALLBACK_TOKEN: crypto.randomBytes(24).toString('hex'),
    MEDIA_CALLBACK_ENCODING_AES_KEY: crypto.randomBytes(32).toString('base64').replace(/=$/, '')
  };
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, '# Server-side secrets. Keep stable and private. Never upload to the mini program.\n' + Object.entries(values).map(([key, value]) => key + '=' + value).join('\n') + '\n'); }
  finally { fs.closeSync(fd); }
  return Object.keys(values);
}
if (require.main === module) {
  const file = path.resolve(__dirname, '../.env.local');
  try { generate(file); process.stdout.write('已生成本机服务端密钥文件 .env.local（仅当前用户可读写），不会输出密钥内容。\n'); }
  catch (error) { process.stderr.write(error.code === 'EEXIST' ? '密钥文件已存在，保留原值，没有覆盖或轮换。\n' : '密钥文件未能安全写入。\n'); process.exitCode = 1; }
}
module.exports = { generate };
