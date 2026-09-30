'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { serializeCatalog } = require('../scripts/lib/content-catalog');
const catalogue = require('../miniprogram/data/curated');

function evaluate(source) {
  const context = { module: { exports: {} } };
  vm.runInNewContext(source, context);
  return { context, exports: context.module.exports };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('the bundled catalogue can be compacted without changing any post, attribution, ordering or version', () => {
  const before = plain(catalogue);
  const source = serializeCatalog(catalogue.CURATED_POSTS, catalogue.CATALOG_VERSION);
  const after = evaluate(source).exports;
  assert.deepEqual(plain(after), before);
  assert.deepEqual(Object.keys(after), ['CURATED_POSTS', 'CATALOG_VERSION']);
  assert.equal(source, serializeCatalog(catalogue.CURATED_POSTS, catalogue.CATALOG_VERSION), 'identical data produces byte-identical output');
  const literalSize = Buffer.byteLength(JSON.stringify(catalogue.CURATED_POSTS));
  assert.ok(Buffer.byteLength(source) < literalSize, 'the format saves bytes instead of adding a runtime dependency');
  assert.deepEqual(plain(catalogue), before, 'serializing never mutates the loaded catalogue');
});

test('repeated attribution strings share source literals while nested objects and arrays remain independently mutable', () => {
  const credit = { author: '仅离线测试的共同作者', licenseName: 'CC BY 4.0', attribution: '仅用于离线测试的署名、来源和许可说明；不能因压缩丢失任何文字。' };
  const posts = Array.from({ length: 8 }, (_, index) => ({ id: 'fixture-' + index, source: { publisher: credit.author }, images: ['https://example.invalid/shared-photo.jpg'], imageCredits: [{ ...credit }] }));
  const snapshot = plain(posts);
  const output = evaluate(serializeCatalog(posts, 'fixture-unchanged-version')).exports;
  assert.deepEqual(plain(output.CURATED_POSTS), snapshot);
  assert.equal(output.CATALOG_VERSION, 'fixture-unchanged-version');
  assert.notStrictEqual(output.CURATED_POSTS[0].source, output.CURATED_POSTS[1].source);
  assert.notStrictEqual(output.CURATED_POSTS[0].images, output.CURATED_POSTS[1].images);
  assert.notStrictEqual(output.CURATED_POSTS[0].imageCredits[0], output.CURATED_POSTS[1].imageCredits[0]);
  output.CURATED_POSTS[0].imageCredits[0].author = 'changed only in the first test item';
  output.CURATED_POSTS[0].images.push('https://example.invalid/another.jpg');
  assert.equal(output.CURATED_POSTS[1].imageCredits[0].author, credit.author);
  assert.equal(output.CURATED_POSTS[1].images.length, 1);
  assert.deepEqual(posts, snapshot);
});

test('quotes, backslashes, code-shaped strings and non-identifier keys remain inert JSON data', () => {
  const value = '测试 \\ "\n\t ; globalThis.catalogueInjected = true; // 🐾';
  const posts = [
    { id: 'one', title: value, text: value, 'non-identifier-key': value, '中文字段': value, empty: '', truthy: true, falsey: false, zero: 0, nested: [null, value, undefined] },
    { id: 'two', title: value, absent: undefined, nullable: null }
  ];
  const result = evaluate(serializeCatalog(posts, 'version " remains \\ literal'));
  assert.deepEqual(plain(result.exports.CURATED_POSTS), plain(posts));
  assert.equal(result.exports.CATALOG_VERSION, 'version " remains \\ literal');
  assert.equal(result.context.catalogueInjected, undefined);
  assert.equal('absent' in result.exports.CURATED_POSTS[1], false, 'the former JSON.stringify omission behavior is preserved');
});

test('short catalogues do not grow merely to allocate a string pool and unusual own keys remain own keys', () => {
  const posts = JSON.parse('[{"id":"x","__proto__":{"note":"own value"},"constructor":"own constructor"}]');
  const result = evaluate(serializeCatalog(posts, 'v')).exports;
  assert.deepEqual(plain(result.CURATED_POSTS), posts);
  assert.equal(Object.prototype.hasOwnProperty.call(result.CURATED_POSTS[0], '__proto__'), true);
  const emptySource = serializeCatalog([], 'v');
  assert.doesNotMatch(emptySource, /const S=/);
  assert.deepEqual(plain(evaluate(emptySource).exports), { CURATED_POSTS: [], CATALOG_VERSION: 'v' });
});
