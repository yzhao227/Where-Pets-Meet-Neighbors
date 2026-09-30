'use strict';

const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./lib/content-catalog');

function main(argv = process.argv.slice(2), options = {}) {
  const usage = '用法：node scripts/content-batch.js status|validate [approved.json]，或 build [--partial] [approved.json]\n' + catalog.SNAPSHOT_NOTICE;
  const write = options.write || (value => process.stdout.write(value));
  if (argv.length === 1 && ['--help', 'help'].includes(argv[0])) { write(usage + '\n'); return { exitCode: 0 }; }
  const [action = 'status', ...args] = argv;
  const partial = args.includes('--partial');
  const inputs = args.filter(value => value !== '--partial');
  if (!['status', 'validate', 'build'].includes(action) || inputs.length > 1 || inputs.some(value => value.startsWith('-')) || args.filter(value => value === '--partial').length > 1 || partial && action !== 'build') throw new Error(usage);
  const input = inputs[0];
  const file = path.resolve(input || catalog.DEFAULT_INPUT);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error('无法读取内容清单 ' + file + '：' + error.message); }
  const result = action === 'build' ? catalog.buildCatalog(manifest, { output: options.output, partial }) : catalog.status(manifest);
  write(JSON.stringify({ action, input: file, ...result }, null, 2) + '\n');
  return { ...result, exitCode: action === 'validate' && !result.metadataValid ? 1 : 0 };
}

if (require.main === module) {
  try { process.exitCode = main().exitCode; }
  catch (error) { process.stderr.write((error.message || '内容批次处理失败') + '\n'); process.exitCode = 1; }
}

module.exports = { main };
