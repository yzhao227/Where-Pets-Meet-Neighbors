'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.js')).sort();
const active = file => file.startsWith('personal-') || ['devtools-tabbar.test.js', 'deployment.test.js'].includes(file);
// The shipping personal product has its own real-service/UI tests. Existing
// community tests cover the retained source with an explicit in-memory fixture.
// Neither group edits the source product setting or a user's stored records.
for (const [label, selected, preload] of [
  ['当前个人工具版', files.filter(active), []],
  ['保留社区源码的隔离回归', files.filter(file => !active(file)), ['--require', path.join(root, 'tests/helpers/community-product.cjs')]]
]) {
  console.log('\n' + label);
  const result = spawnSync(process.execPath, [...preload, '--test', ...selected.map(file => path.join(root, 'tests', file))], { cwd: root, stdio: 'inherit', timeout: 120000 });
  if (result.status !== 0) process.exitCode = 1;
}
