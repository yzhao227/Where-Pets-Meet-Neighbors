'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.js')).sort();
const personal = file => ['personal-api.test.js', 'personal-content.test.js', 'personal-product.test.js', 'personal-surfaces.test.js'].includes(file);
// The active community build and the retained personal service run in separate
// processes. Product fixtures only change the in-memory configuration; neither
// group modifies source settings or a user's real stored records.
for (const [label, selected, preload] of [
  ['当前社区版', files.filter(file => !personal(file)), []],
  ['保留私人资料的隔离回归', files.filter(personal), ['--require', path.join(root, 'tests/helpers/personal-product.cjs')]]
]) {
  console.log('\n' + label);
  const result = spawnSync(process.execPath, [...preload, '--test', ...selected.map(file => path.join(root, 'tests', file))], { cwd: root, stdio: 'inherit', timeout: 120000 });
  if (result.status !== 0) process.exitCode = 1;
}
