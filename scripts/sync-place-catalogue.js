'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalogue = require('../miniprogram/data/nearby-catalogue');
fs.copyFileSync(path.join(root, 'miniprogram/services/place-engine.js'), path.join(root, 'cloudfunctions/community/place-engine.js'));
fs.writeFileSync(path.join(root, 'cloudfunctions/community/place-catalogue.js'), "'use strict';\n// Generated from the reviewed local catalogue; never contains member data.\nmodule.exports = " + JSON.stringify(catalogue) + ';\n');
console.log('Synced place domain and ' + catalogue.records.length + ' reviewed directory records for cloud deployment.');
