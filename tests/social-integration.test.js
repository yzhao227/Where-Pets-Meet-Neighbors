'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createDemoService } = require('../miniprogram/services/demo');
const { createSeed, newUser } = require('../miniprogram/data/seed');
const shared = require('../miniprogram/pages/_shared');
const social = require('../miniprogram/social/shared');

const clone = value => JSON.parse(JSON.stringify(value));
const input = value => ({ detail: { value } });
const tap = (id, extra = {}) => ({ currentTarget: { dataset: { id, ...extra } } });
const KEY = 'social-integration-memory-only';
const EPOCH = Date.UTC(2026, 8, 30, 10);

function fixture(t) {
  let saved = createSeed(EPOCH);
  // Only this test's memory contains these three accounts. Every business result
  // below comes from the production service over its normal persisted snapshot.
  saved.users = ['alice', 'bob', 'charlie'].map(id => ({ ...newUser(id, false), nickname: '集成测试' + id, publicProfile: true }));
  saved.currentUserId = 'alice';
  saved.posts = []; saved.events = []; saved.comments = []; saved.messages = [];
  saved.circles.forEach(circle => { circle.memberIds = []; });
  const effects = { calls: [], routes: [], toasts: [], timers: new Map(), writesAfterUnload: 0 };
  let timerId = 0;
  const platform = {
    getStorageSync(key) { return key === KEY ? clone(saved) : ''; },
    setStorageSync(key, value) { assert.equal(key, KEY); saved = clone(value); },
    stopPullDownRefresh() {}, hideKeyboard() {},
    showToast(options) { effects.toasts.push(options.title); },
    showModal(options) { if (options.success) options.success({ confirm: true }); },
    navigateTo(options) { effects.routes.push(options.url); },
    redirectTo(options) { effects.routes.push(options.url); },
    switchTab(options) { effects.routes.push(options.url); }
  };
  const createBackend = () => createDemoService(platform, { storageKey: KEY, now: () => EPOCH });
  let backend = createBackend();
  const originals = { wx: global.wx, Page: global.Page, call: shared.api.call };
  global.wx = platform;
  shared.api.call = (action, payload = {}) => {
    effects.calls.push({ actor: saved.currentUserId, action, payload: clone(payload) });
    return backend.call(action, payload);
  };
  const pages = [];
  function page(name) {
    let definition;
    global.Page = value => { definition = value; };
    const file = path.join(__dirname, ['messages', 'author'].includes(name) ? '../miniprogram/pages/' + name + '/index.js' : '../miniprogram/social/pages/' + name + '/index.js');
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      wx: platform,
      setInterval(callback, delay) { const id = ++timerId; effects.timers.set(id, { callback, delay }); return id; },
      clearInterval(id) { effects.timers.delete(id); },
      require(name) {
        if (name === '../../../pages/_shared' || name === '../_shared') return shared;
        if (name === '../../shared') return social;
        if (['../../data/pets', '../../data/feed-preferences'].includes(name)) return createRequire(file)(name);
        throw new Error('Unexpected page dependency: ' + name);
      }
    }, { filename: file });
    const instance = { ...definition, data: structuredClone(definition.data), setData(values) {
      if (this._closed) effects.writesAfterUnload += 1;
      Object.assign(this.data, values);
    } };
    pages.push(instance);
    return instance;
  }
  const closePages = () => {
    pages.forEach(instance => { if (!instance._closed) { if (instance.onHide) instance.onHide(); instance.onUnload(); } });
  };
  t.after(() => { closePages(); global.wx = originals.wx; global.Page = originals.Page; shared.api.call = originals.call; });
  return { page, effects, call: (...args) => shared.api.call(...args),
    as(id) { assert.ok(saved.users.some(user => user.id === id)); saved.currentUserId = id; },
    restart() { closePages(); saved = clone(saved); backend = createBackend(); },
    state: () => clone(saved), closePages };
}

test('legacy friendship data and private chats retain read/search and account authorization across restarts', async t => {
  const f = fixture(t);
  for (const id of ['alice', 'bob', 'charlie']) {
    f.as(id);
    await f.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  }

  f.as('alice');
  const aliceFriends = f.page('friends');
  await aliceFriends.onLoad();
  assert.equal(aliceFriends.data.friends.length, 0);
  aliceFriends.inputSearch(input('  集成测试bob  '));
  await aliceFriends.search();
  assert.deepEqual(Array.from(aliceFriends.data.results, person => person.id), ['bob']);
  aliceFriends.beginRequest(tap('bob'));
  aliceFriends.inputNote(input('一起交流猫咪日常'));
  await aliceFriends.sendRequest();
  assert.equal(aliceFriends.data.outgoing.length, 1);
  assert.equal(aliceFriends.data.results[0].friendStatus, 'outgoing');
  assert.equal(aliceFriends.data.friends.length, 0, 'an application alone is not a friendship');

  f.as('bob');
  const bobFriends = f.page('friends');
  await bobFriends.onLoad();
  assert.equal(bobFriends.data.incoming[0].from.id, 'alice');
  assert.equal(bobFriends.data.incoming[0].note, '一起交流猫咪日常');
  await bobFriends.respond(tap(bobFriends.data.incoming[0].id, { accept: true }));
  assert.deepEqual(Array.from(bobFriends.data.friends, person => person.id), ['alice']);
  assert.equal(bobFriends.data.incoming.length, 0);
  f.as('alice');
  await aliceFriends.onShow();
  assert.deepEqual(Array.from(aliceFriends.data.friends, person => person.id), ['bob']);
  assert.equal(aliceFriends.data.results[0].friendStatus, 'friends');
  assert.equal(f.state().follows.length, 0, 'the friend flow does not create follows');

  const conversationId = (await f.call('openDirectChat', { targetId: 'bob' })).conversation.id;
  assert.deepEqual(f.state().conversations[0].memberIds, ['alice', 'bob']);

  f.as('bob');
  const bobChat = f.page('chat');
  await bobChat.onLoad({ id: conversationId });
  await bobChat.onShow();
  assert.equal(bobChat.data.error, '');
  assert.equal(bobChat.data.conversation.canSend, true);
  assert.equal(f.effects.timers.size, 1);
  bobChat.inputDraft(input('今天猫咪学会了握手，集成检索词')); await bobChat.send();
  assert.equal(bobChat.data.pending.length, 0);
  assert.equal(bobChat.data.messages.length, 1);
  assert.equal(bobChat.data.messages[0].isMine, true);
  assert.equal(f.state().chatMessages[0].senderId, 'bob');
  bobChat.onHide();
  assert.equal(f.effects.timers.size, 0);

  f.as('alice');
  const inbox = f.page('messages');
  await inbox.onLoad();
  assert.equal(inbox.data.socialError, '');
  assert.equal(inbox.data.chatUnreadCount, 1);
  assert.equal(inbox.data.conversations[0].id, conversationId);
  inbox.openSearch(); inbox.inputSearch(input('集成检索词')); await inbox.search();
  assert.equal(inbox.data.conversations.length, 1);
  assert.equal(inbox.data.chatUnreadCount, 1, 'searching does not consume unread chat');
  inbox.openConversation(tap(conversationId));
  assert.equal(f.effects.routes.at(-1), '/social/pages/chat/index?id=' + encodeURIComponent(conversationId));
  const aliceChat = f.page('chat');
  await aliceChat.onLoad({ id: conversationId });
  await aliceChat.onShow();
  assert.equal(aliceChat.data.messages[0].text, '今天猫咪学会了握手，集成检索词');
  assert.equal(aliceChat.data.messages[0].sender.id, 'bob');
  assert.equal(aliceChat.data.messages[0].isMine, false);
  assert.equal(aliceChat.data.readError, '');
  const read = f.state().conversations[0].readBy.find(item => item.userId === 'alice');
  assert.equal(read.seq, aliceChat.data.messages[0].seq);
  aliceChat.onHide();
  await inbox.refresh();
  assert.equal(inbox.data.query, '集成检索词');
  assert.equal(inbox.data.conversations.length, 1);
  assert.equal(inbox.data.chatUnreadCount, 0);
  inbox.inputSearch(input('没有这个检索词')); await inbox.search();
  assert.equal(inbox.data.conversations.length, 0);
  await inbox.cancelSearch();
  assert.equal(inbox.data.conversations.length, 1);

  f.as('charlie');
  const stranger = f.page('chat');
  await stranger.onLoad({ id: conversationId });
  await stranger.onShow();
  assert.match(stranger.data.error, /会话不存在或不可见/);
  assert.equal(stranger.data.messages.length, 0);
  assert.equal(stranger.data.conversation, null);
  assert.equal(f.effects.calls.filter(call => call.actor === 'charlie' && call.action === 'readConversation').length, 0);
  stranger.onHide();
  await assert.rejects(f.call('sendChatMessage', { conversationId, text: '不能写入', requestId: 'unauthorized' }), { code: 'NOT_FOUND' });

  f.as('alice');
  const persisted = f.state();
  f.restart();
  const restoredFriends = f.page('friends'); await restoredFriends.onLoad();
  assert.deepEqual(Array.from(restoredFriends.data.friends, person => person.id), ['bob']);
  const restoredInbox = f.page('messages'); await restoredInbox.onLoad();
  assert.equal(restoredInbox.data.conversations[0].id, conversationId);
  assert.equal(restoredInbox.data.chatUnreadCount, 0);
  const restoredChat = f.page('chat'); await restoredChat.onLoad({ id: conversationId });
  assert.equal(restoredChat.data.messages[0].id, persisted.chatMessages[0].id);
  assert.equal(restoredChat.data.messages[0].text, persisted.chatMessages[0].text);
  assert.deepEqual(f.state().friendships, persisted.friendships);
  assert.deepEqual(f.state().chatMessages, persisted.chatMessages);
  assert.equal(f.state().users.length, 3);
  f.closePages();
  assert.equal(f.effects.timers.size, 0);
  assert.equal(f.effects.writesAfterUnload, 0);
});


test('author private messages connect two users without creating friends, follows or groups', async t => {
  const f = fixture(t);
  for (const id of ['alice', 'bob', 'charlie']) {
    f.as(id);
    await f.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  }
  f.as('alice');
  const author = f.page('author'); await author.onLoad({ userId: 'bob' });
  assert.equal(author.data.canChat, true);
  await author.startChat();
  const conversationId = f.state().conversations[0].id;
  assert.equal(f.effects.routes.at(-1), '/social/pages/chat/index?id=' + conversationId);
  assert.equal(f.state().chatMessages.length, 0, 'opening a conversation never sends a greeting');
  const aliceChat = f.page('chat'); await aliceChat.onLoad({ id: conversationId });
  aliceChat.inputDraft(input('仅内存私聊测试：你好')); await aliceChat.send();
  assert.equal(aliceChat.data.pending.length, 0);
  aliceChat.onHide(); author.onHide();

  f.as('bob');
  const inbox = f.page('messages'); await inbox.onLoad();
  assert.equal(inbox.data.chatUnreadCount, 1);
  assert.equal(inbox.data.conversations[0].id, conversationId);
  const authorBack = f.page('author'); await authorBack.onLoad({ userId: 'alice' });
  await authorBack.startChat();
  assert.equal(f.state().conversations.length, 1, 'both profile entries reuse the same private conversation');
  const bobChat = f.page('chat'); await bobChat.onLoad({ id: conversationId });
  assert.equal(bobChat.data.messages[0].text, '仅内存私聊测试：你好');
  bobChat.inputDraft(input('仅内存私聊测试：收到')); await bobChat.send();
  assert.equal(bobChat.data.pending.length, 0);
  bobChat.onHide(); authorBack.onHide(); inbox.onHide();

  f.as('alice');
  const aliceInbox = f.page('messages'); await aliceInbox.onLoad();
  assert.equal(aliceInbox.data.chatUnreadCount, 1);
  assert.equal(aliceInbox.data.conversations.length, 1);
  assert.equal(aliceInbox.data.conversations[0].kind, 'direct');
  assert.equal(f.state().conversations.some(item => item.kind === 'group'), false);
  assert.deepEqual(f.state().friendships, []);
  assert.deepEqual(f.state().friendRequests, []);
  assert.deepEqual(f.state().follows, []);
  assert.ok(!f.effects.calls.some(call => ['sendFriendRequest', 'respondFriendRequest', 'followUser', 'createGroupChat'].includes(call.action)));
  f.restart();
  const restored = f.page('chat'); await restored.onLoad({ id: conversationId });
  assert.equal(restored.data.messages.length, 2);
  assert.deepEqual(f.state().users.map(user => user.id), ['alice', 'bob', 'charlie']);
});

test('one notes entry combines public comments and replies with private correspondence without changing where replies go', async t => {
  const f = fixture(t);
  for (const id of ['alice', 'bob', 'charlie']) {
    f.as(id);
    await f.call('demoVerifyIdentity', { consent: { accepted: true, termsVersion: '2026-09-29', privacyVersion: '2026-09-29' } });
  }
  f.as('alice');
  await f.call('joinCircle', { id: 'circle-neighbors', join: true });
  const { post } = await f.call('createPost', { circleId: 'circle-neighbors', text: '仅内存集成测试：周末携宠出行准备', images: [] });
  const { comment: authorComment } = await f.call('addComment', { targetType: 'post', targetId: post.id, text: '仅内存作者补充' });

  f.as('bob');
  await f.call('addComment', { targetType: 'post', targetId: post.id, text: '仅内存公开评论' });
  await f.call('likePost', { id: post.id, like: true });
  const { conversation } = await f.call('openDirectChat', { targetId: 'alice' });
  await f.call('sendChatMessage', { conversationId: conversation.id, text: '仅内存一对一留言一', requestId: 'merged-note-1' });
  await f.call('sendChatMessage', { conversationId: conversation.id, text: '仅内存一对一留言二', requestId: 'merged-note-2' });
  f.as('charlie');
  await f.call('addComment', { targetType: 'post', targetId: post.id, replyToId: authorComment.id, text: '仅内存公开回复' });

  f.as('alice');
  const inbox = f.page('messages'); await inbox.onLoad();
  assert.equal(inbox.data.inboxUnreadCount, 5);
  assert.equal(inbox.data.inboxItems.length, 4, 'a private conversation is one row even when it contains two unread messages');
  const notesEntry = inbox.data.notificationCategories.find(item => item.id === 'comments');
  assert.equal(notesEntry.label, '留言'); assert.equal(notesEntry.unreadCount, 4);
  await inbox.selectCategory(tap('comments'));
  assert.equal(inbox.data.inboxItems.length, 3);
  assert.deepEqual(new Set(Array.from(inbox.data.inboxItems, item => item.sourceLabel)), new Set(['内容评论', '内容回复', '一对一留言']));
  assert.equal(inbox.data.inboxItems.some(item => item.kind === 'like'), false);

  const commentRow = inbox.data.inboxItems.find(item => item.kind === 'comment');
  await inbox.openInboxItem(tap(commentRow.id, { type: commentRow.entryType }));
  assert.equal(f.effects.routes.at(-1), '/pages/post/index?id=' + encodeURIComponent(post.id));
  assert.equal(inbox.data.chatUnreadCount, 2);
  assert.equal(inbox.data.notificationCategories.find(item => item.id === 'comments').unreadCount, 3);
  assert.equal(inbox.data.inboxUnreadCount, 4);

  const directRow = inbox.data.inboxItems.find(item => item.entryType === 'conversation');
  await inbox.openInboxItem(tap(directRow.id, { type: directRow.entryType }));
  assert.equal(f.effects.routes.at(-1), '/social/pages/chat/index?id=' + encodeURIComponent(conversation.id));
  inbox.onHide();
  const conversationPage = f.page('chat'); await conversationPage.onLoad({ id: conversation.id });
  assert.equal(conversationPage.data.messages.length, 2);
  assert.ok(conversationPage.data.messages.every(item => item.text.startsWith('仅内存一对一留言')));
  conversationPage.onHide();
  await inbox.onShow();
  assert.equal(inbox.data.chatUnreadCount, 0);
  assert.equal(inbox.data.notificationCategories.find(item => item.id === 'comments').unreadCount, 1);
  assert.equal(inbox.data.inboxUnreadCount, 2, 'the public reply and like remain unread after reading private messages');
  assert.equal(f.state().comments.length, 3);
  assert.equal(f.state().chatMessages.length, 2);
  assert.deepEqual(f.state().friendships, []);
  assert.equal(f.state().conversations.some(item => item.kind === 'group'), false);
});
