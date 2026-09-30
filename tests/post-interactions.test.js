'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../miniprogram/pages/_shared');

const event = (value, dataset = {}) => ({ detail: { value }, currentTarget: { dataset } });
const keyboard = height => ({ detail: { height } });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

async function fixture(t) {
  const previous = { wx: global.wx, Page: global.Page, call: shared.api.call };
  const effects = { calls: [], hiddenKeyboards: 0, scrolls: [], toasts: [], writes: [], writesAfterUnload: 0 };
  const post = { id: 'post-under-test', title: '测试内容', text: '原帖正文', kind: 'daily', images: [], topics: [], animalTypes: [], circle: { id: 'circle', name: '养宠同好' }, author: { id: 'author', nickname: '发帖人' }, createdAt: 1, commentCount: 1 };
  const comments = [{ id: 'comment-existing', text: '已有回应', author: { id: 'neighbour', nickname: '邻居小林' }, createdAt: 1 }];
  const handlers = {
    bootstrap: () => ({ mode: 'demo', user: { id: 'self', isAdmin: false } }),
    getPost: () => ({ post: { ...post, commentCount: comments.length }, comments, nextCursor: null }),
    addComment: payload => {
      const comment = { id: 'comment-' + comments.length, text: payload.text, author: { id: 'self', nickname: '我' }, createdAt: 2 };
      comments.push(comment);
      return { comment };
    }
  };
  global.wx = {
    hideKeyboard(options = {}) { effects.hiddenKeyboards++; if (options.success) options.success({}); },
    pageScrollTo(options) { effects.scrolls.push({ selector: options.selector, duration: options.duration }); if (options.success) options.success({}); },
    showToast(options) { effects.toasts.push(options.title); },
    stopPullDownRefresh() {},
    nextTick(callback) { queueMicrotask(callback); }
  };
  shared.api.call = async (action, payload) => {
    effects.calls.push({ action, payload: payload && structuredClone(payload) });
    assert.equal(typeof handlers[action], 'function', 'unexpected API action: ' + action);
    return handlers[action](payload);
  };
  let definition;
  global.Page = value => { definition = value; };
  const source = require.resolve('../miniprogram/pages/post/index');
  delete require.cache[source]; require(source);
  const page = { ...definition, data: structuredClone(definition.data), setData(values, callback) {
    if (this._closed) effects.writesAfterUnload++;
    effects.writes.push(structuredClone(values));
    Object.assign(this.data, values);
    if (callback) queueMicrotask(callback);
  } };
  t.after(() => {
    if (!page._closed) page.onUnload();
    global.wx = previous.wx; global.Page = previous.Page; shared.api.call = previous.call;
  });
  page.onLoad({ id: post.id });
  for (let count = 0; count < 20 && page.data.loading; count++) await flush();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, '');
  return { page, effects, handlers, comments };
}

test('comment entry respects readiness and busy state, and closing preserves the draft and reply target', async t => {
  const f = await fixture(t), p = f.page;
  assert.equal(p.data.commentOpen, false);
  assert.equal(p.data.commentFocused, false);
  assert.equal(p.data.keyboardHeight, 0);
  for (const state of [{ busy: true }, { loading: true }, { error: '内容不可用' }]) {
    Object.assign(p.data, { busy: false, loading: false, error: '' }, state);
    p.openComment(); await flush();
    assert.equal(p.data.commentOpen, false);
    assert.equal(p.data.commentFocused, false);
  }
  Object.assign(p.data, { busy: false, loading: false, error: '' });
  p.openComment(); await flush();
  assert.equal(p.data.commentOpen, true);
  assert.equal(p.data.commentFocused, true);
  p.input(event('还没发出的想法'));
  p.reply(event(undefined, { id: 'comment-existing' }));
  p.commentKeyboardChanged(keyboard(260));
  p.data.busy = true;
  const hiddenBefore = f.effects.hiddenKeyboards;
  p.closeComment();
  assert.equal(p.data.commentOpen, true);
  assert.equal(p.data.commentFocused, true);
  assert.equal(f.effects.hiddenKeyboards, hiddenBefore, 'sending must not dismiss the composer');
  p.data.busy = false;
  p.closeComment();
  assert.equal(p.data.commentOpen, false);
  assert.equal(p.data.commentFocused, false);
  assert.equal(p.data.keyboardHeight, 0);
  assert.ok(f.effects.hiddenKeyboards > hiddenBefore);
  assert.equal(p.data.text, '还没发出的想法');
  assert.equal(p.data.hasCommentText, true);
  assert.equal(p.data.replyId, 'comment-existing');
  assert.equal(p.data.replyName, '邻居小林');
  p.openComment(); await flush();
  assert.equal(p.data.text, '还没发出的想法');
  assert.equal(p.data.replyId, 'comment-existing');
});

test('replying selects a real comment and opens the editor; cancelling a reply leaves its text intact', async t => {
  const f = await fixture(t), p = f.page;
  p.input(event('想继续聊这个话题'));
  p.reply(event(undefined, { id: 'missing-comment' }));
  assert.equal(p.data.replyId, '');
  assert.equal(p.data.commentOpen, false);
  p.reply(event(undefined, { id: 'comment-existing' })); await flush();
  assert.equal(p.data.replyId, 'comment-existing');
  assert.equal(p.data.replyName, '邻居小林');
  assert.equal(p.data.commentOpen, true);
  assert.equal(p.data.commentFocused, true);
  p.cancelReply();
  assert.equal(p.data.replyId, '');
  assert.equal(p.data.replyName, '');
  assert.equal(p.data.text, '想继续聊这个话题');
  assert.equal(p.data.hasCommentText, true);
  assert.equal(p.data.commentOpen, true);
});

test('draft eligibility follows trimmed text and whitespace never sends a comment', async t => {
  const f = await fixture(t), p = f.page;
  p.openComment();
  for (const value of ['', '  ', '\n\t', '\u3000']) {
    p.input(event(value));
    assert.equal(p.data.text, value, 'typing does not rewrite the draft');
    assert.equal(p.data.hasCommentText, false);
    await p.send();
  }
  assert.equal(f.effects.calls.filter(call => call.action === 'addComment').length, 0);
  assert.equal(p.data.commentOpen, true);
  p.input(event('  有一点想分享  '));
  assert.equal(p.data.hasCommentText, true);
  assert.equal(p.data.text, '  有一点想分享  ');
});

test('keyboard heights are bounded to valid open-editor events and ignore close/unload races', async t => {
  const f = await fixture(t), p = f.page;
  p.commentKeyboardChanged(keyboard(280));
  assert.equal(p.data.keyboardHeight, 0);
  p.openComment(); await flush();
  p.commentKeyboardChanged(keyboard(280));
  assert.equal(p.data.keyboardHeight, 280);
  for (const height of [-1, Infinity, -Infinity, NaN, undefined]) {
    p.commentKeyboardChanged(keyboard(height));
    assert.equal(p.data.keyboardHeight, 280);
  }
  p.commentKeyboardChanged(keyboard(0));
  assert.equal(p.data.keyboardHeight, 0);
  p.closeComment();
  const closedWrites = f.effects.writes.length;
  p.commentKeyboardChanged(keyboard(360));
  assert.equal(p.data.keyboardHeight, 0);
  assert.equal(f.effects.writes.length, closedWrites, 'late native keyboard events do not write a closed composer');
  p.openComment(); await flush(); p.onUnload();
  const unloadedWrites = f.effects.writes.length;
  p.commentKeyboardChanged(keyboard(320));
  assert.equal(f.effects.writes.length, unloadedWrites);
  assert.equal(f.effects.writesAfterUnload, 0);
});

test('send failure keeps the draft and reply, and a successful retry clears and closes only after acknowledgement', async t => {
  const f = await fixture(t), p = f.page;
  p.reply(event(undefined, { id: 'comment-existing' })); await flush();
  p.input(event('  我家也有类似的小习惯  '));
  p.commentKeyboardChanged(keyboard(260));
  const initialHidden = f.effects.hiddenKeyboards;
  const success = f.handlers.addComment;
  f.handlers.addComment = () => { throw new Error('网络暂时中断'); };
  await p.send();
  assert.equal(p.data.busy, false);
  assert.equal(p.data.text, '  我家也有类似的小习惯  ');
  assert.equal(p.data.hasCommentText, true);
  assert.equal(p.data.replyId, 'comment-existing');
  assert.equal(p.data.replyName, '邻居小林');
  assert.equal(p.data.commentOpen, true);
  assert.equal(p.data.commentFocused, true);
  assert.equal(f.effects.hiddenKeyboards, initialHidden);
  assert.ok(f.effects.toasts.includes('网络暂时中断'));
  f.handlers.addComment = success;
  await p.send();
  const sends = f.effects.calls.filter(call => call.action === 'addComment');
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[1].payload, { targetType: 'post', targetId: 'post-under-test', text: '我家也有类似的小习惯', replyToId: 'comment-existing' });
  assert.equal(p.data.text, '');
  assert.equal(p.data.hasCommentText, false);
  assert.equal(p.data.replyId, '');
  assert.equal(p.data.replyName, '');
  assert.equal(p.data.commentOpen, false);
  assert.equal(p.data.commentFocused, false);
  assert.equal(p.data.keyboardHeight, 0);
  assert.ok(f.effects.hiddenKeyboards > initialHidden);
  assert.ok(p.data.comments.some(comment => comment.text === '我家也有类似的小习惯'), 'successful sends refresh the displayed discussion');
});

test('one in-flight submission blocks duplicate sends and dismissal until the result arrives', async t => {
  const f = await fixture(t), p = f.page;
  const pending = deferred();
  f.handlers.addComment = () => pending.promise;
  p.openComment(); await flush(); p.input(event('只发一次'));
  const first = p.send();
  assert.equal(p.data.busy, true);
  await p.send(); p.closeComment();
  assert.equal(f.effects.calls.filter(call => call.action === 'addComment').length, 1);
  assert.equal(p.data.commentOpen, true);
  assert.equal(p.data.text, '只发一次');
  pending.resolve({ comment: { id: 'accepted' } }); await first;
  assert.equal(p.data.busy, false);
  assert.equal(p.data.text, '');
  assert.equal(p.data.commentOpen, false);
});

test('jumping to comments uses the native discussion anchor and leaves the unfinished draft alone', async t => {
  const f = await fixture(t), p = f.page;
  p.input(event('稍后再发'));
  p.showComments();
  assert.deepEqual(f.effects.scrolls, [{ selector: '#post-comments', duration: 250 }]);
  assert.equal(p.data.text, '稍后再发');
  assert.equal(p.data.hasCommentText, true);
  assert.equal(p.data.commentOpen, false);
});

test('a completed send does not write into an unloaded page when its response arrives late', async t => {
  const f = await fixture(t), p = f.page;
  const pending = deferred(); f.handlers.addComment = () => pending.promise;
  p.openComment(); await flush(); p.input(event('提交途中离开'));
  const sending = p.send();
  p.onUnload();
  const writes = f.effects.writes.length;
  pending.resolve({ comment: { id: 'accepted-after-unload' } }); await sending;
  assert.equal(f.effects.writes.length, writes);
  assert.equal(f.effects.writesAfterUnload, 0);
});

test('an accepted comment stays cleared even if the subsequent discussion refresh fails', async t => {
  const f = await fixture(t), p = f.page;
  p.openComment(); await flush(); p.input(event('服务端已收到'));
  f.handlers.getPost = () => { throw new Error('列表刷新失败'); };
  await p.send();
  assert.equal(f.effects.calls.filter(call => call.action === 'addComment').length, 1);
  assert.equal(p.data.text, '');
  assert.equal(p.data.hasCommentText, false);
  assert.equal(p.data.commentOpen, false);
  assert.equal(p.data.error, '列表刷新失败');
});
