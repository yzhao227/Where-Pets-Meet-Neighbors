'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// This intentionally small DOM exercises media and input rendering branches.
// No runtime start, browser, network request or real storage is involved.
class Element {
  constructor(tag, attributes = {}) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.style = {};
    this.childNodes = [];
    this.parentNode = null;
    this.textContent = '';
    this.className = '';
    this._attributes = new Map();
    this.listeners = new Map();
    this.mutations = [];
    this.attributeRemovals = [];
    this.srcAssignments = [];
    this.naturalWidth = 640;
    this.naturalHeight = 480;
    this.classList = {
      add: (...names) => { this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(names))].join(' '); }
    };
    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
  }
  get attributes() { return Array.from(this._attributes, ([name, value]) => ({ name, value })); }
  hasAttribute(name) { return this._attributes.has(name); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  getAttributeNames() { return Array.from(this._attributes.keys()); }
  setAttribute(name, value) {
    this._attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  removeAttribute(name) {
    this.attributeRemovals.push(name);
    this._attributes.delete(name);
    if (name === 'loading') this._loading = '';
    if (name === 'decoding') this._decoding = '';
    if (name === 'src') this._src = '';
    if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
  }
  append(...children) {
    for (const child of children) {
      if (child.parentNode) child.parentNode.childNodes = child.parentNode.childNodes.filter(item => item !== child);
      this.childNodes.push(child);
      child.parentNode = this;
    }
  }
  contains(element) { return this === element || this.childNodes.some(child => child.contains && child.contains(element)); }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim());
    const matches = element => selectors.some(value => {
      if (value.startsWith('.')) return element.className.split(/\s+/).includes(value.slice(1));
      const match = /^(\w+)?(?:\[([^\]]+)\])?$/.exec(value);
      const attribute = match && match[2];
      const dataKey = attribute && attribute.startsWith('data-') && attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return match && (!match[1] || element.tagName.toLowerCase() === match[1]) && (!attribute || element.hasAttribute(attribute) || dataKey && element.dataset[dataKey] !== undefined);
    });
    return this.childNodes.flatMap(child => [matches(child) ? [child] : [], child.querySelectorAll ? child.querySelectorAll(selector) : []].flat());
  }
  replaceChildren(...children) {
    const active = this.ownerDocument && this.ownerDocument.activeElement;
    if (active && this.contains(active)) {
      if (this.ownerDocument.deferRemovalBlur) {
        this.ownerDocument.activeElement = null;
        this.ownerDocument.deferRemovalBlur(() => active.dispatch('blur'));
      } else active.blur();
    }
    this.childNodes.forEach(child => { child.parentNode = null; });
    this.childNodes = [];
    for (const child of children) this.append(...(child.nodeType === 11 ? child.childNodes.slice() : [child]));
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, details = {}) {
    const event = { type, target: this, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {}, ...details };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  click() { this.dispatch('click'); }
  focus(options) {
    if (!this.ownerDocument || this.ownerDocument.activeElement === this) return;
    const previous = this.ownerDocument.activeElement;
    if (previous) previous.blur();
    this.ownerDocument.activeElement = this;
    this.focusOptions = options;
    this.dispatch('focus');
  }
  blur() {
    if (!this.ownerDocument || this.ownerDocument.activeElement !== this) return;
    this.ownerDocument.activeElement = null;
    this.dispatch('blur');
  }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  set loading(value) { this._loading = value; this._attributes.set('loading', value); this.mutations.push(['loading', value]); }
  get loading() { return this._loading; }
  set decoding(value) { this._decoding = value; this._attributes.set('decoding', value); this.mutations.push(['decoding', value]); }
  get decoding() { return this._decoding; }
  set src(value) {
    this._src = value;
    this._attributes.set('src', value);
    this.mutations.push(['src', value]);
    this.srcAssignments.push({ value, loading: this.loading, decoding: this.decoding });
  }
  get src() { return this._src; }
}

function runtime(options = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../preview/runtime.js'), 'utf8');
  const instrumented = source.replace(/\}\)\(\);\s*$/, `window.__testRenderNode = renderNode; window.__testInterpolate = interpolate; window.__testRestoreInputFocus = restoreInputFocus;
    window.__testScheduleRender = scheduleRender; window.__testInstallInputClickGuard = installInputClickGuard;
    window.__testStartRender = (page, template) => {
      current = page;
      manifest = { pages: { [page.route]: { template: 'fixture', style: '' } }, app: { tabBar: { list: [] } } };
      makeTemplate = () => template; nativeCss = () => ''; render();
    };
  })();`);
  assert.notEqual(instrumented, source, 'the test exports renderNode from the runtime closure');
  const elements = [];
  const roots = new Map();
  const microtasks = [];
  const timers = new Map(); let timerId = 0;
  const documentListeners = new Map();
  const document = {
    activeElement: null,
    addEventListener(type, listener) { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(listener); },
    getElementById(id) { if (!roots.has(id)) { const element = new Element('div'); element.ownerDocument = document; roots.set(id, element); } return roots.get(id); },
    createElement(tag) { const element = new Element(tag); element.ownerDocument = document; elements.push(element); return element; },
    createDocumentFragment() { const fragment = new Element('fragment'); fragment.nodeType = 11; return fragment; }
  };
  const window = { addEventListener() {} };
  const context = vm.createContext({ window, document, console,
    setTimeout: options.queuedTimers ? callback => { const id = ++timerId; timers.set(id, callback); return id; } : setTimeout,
    clearTimeout: options.queuedTimers ? id => timers.delete(id) : clearTimeout,
    queueMicrotask: options.queued ? callback => microtasks.push(callback) : queueMicrotask });
  vm.runInContext(instrumented, context, { filename: 'preview/runtime.js' });
  return { renderNode: window.__testRenderNode, interpolate: window.__testInterpolate, restoreInputFocus: window.__testRestoreInputFocus, startRender: window.__testStartRender, scheduleRender: window.__testScheduleRender,
    installInputClickGuard: window.__testInstallInputClickGuard, timers,
    dispatchDocument(type, target, details = {}) { const event = { type, target, ...details }; for (const listener of documentListeners.get(type) || []) listener(event); },
    microtasks, wx: window.wx, document, pageRoot: roots.get('mini-page'), elements };
}

test('mixed bindings keep gallery counters and action labels while single bindings retain their type', () => {
  const { interpolate } = runtime();
  const values = { photoIndex: 1, photoItems: ['first', 'second', 'third'], post: { isLiked: false, likeCount: 0 } };
  assert.equal(interpolate('{{photoIndex + 1}} / {{photoItems.length}}', values), '2 / 3');
  assert.equal(interpolate("{{post.isLiked ? '♥' : '♡'}}喜欢 {{post.likeCount}}", values), '♡喜欢 0');
  assert.equal(interpolate('{{post.isLiked}}', values), false);
  assert.equal(interpolate('{{photoIndex}}', values), 1);
});

function imageTemplate(attributes = {}, tag = 'image') {
  return new Element(tag, {
    src: '{{src}}', 'data-id': '{{id}}', 'data-attempt': '{{attempt}}',
    class: '{{state}}', mode: '{{mode}}', ...attributes
  });
}
function scope(overrides = {}) {
  return { src: 'https://example.invalid/test.jpg', id: 'test-post', attempt: 1, state: 'loading', mode: 'aspectFit', ...overrides };
}
function page() { return { route: 'pages/community/index', _previewImageNodes: new Map(), _previewNextImages: new Map() }; }
function draw(adapter, targetPage, template, values, nodePath = 'n-0') {
  targetPage._previewNextImages = new Map();
  const parent = new Element('div');
  adapter.renderNode(template, parent, values, targetPage, nodePath);
  targetPage._previewImageNodes = targetPage._previewNextImages;
  assert.equal(parent.childNodes.length, 1);
  return parent.childNodes[0];
}

test('boolean attributes distinguish bare presence from false and empty bound values', () => {
  const adapter = runtime();
  const cases = [
    { name: 'bare attribute', attribute: '', expected: true },
    { name: 'literal true', attribute: 'true', expected: true },
    { name: 'literal false', attribute: 'false', expected: false },
    { name: 'bound false', attribute: '{{value}}', value: false, expected: false },
    { name: 'bound zero', attribute: '{{value}}', value: 0, expected: false },
    { name: 'bound empty string', attribute: '{{value}}', value: '', expected: false },
    { name: 'bound null', attribute: '{{value}}', value: null, expected: false },
    { name: 'bound missing value', attribute: '{{value}}', expected: false },
    { name: 'bound positive count', attribute: '{{value}}', value: 1, expected: true }
  ];
  for (const item of cases) {
    const button = draw(adapter, page(), new Element('button', { disabled: item.attribute }), { value: item.value });
    assert.equal(button.disabled, item.expected, item.name);
  }
});

test('the compose publish control follows attachment state across preview redraws', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/compose/index.wxml'), 'utf8');
  const tag = markup.match(/<button\b[^>]*class="[^"]*\bpublish-button\b[^"]*"[^>]*>/);
  assert.ok(tag, 'exercise the actual compose publish button attributes');
  const attributes = Object.fromEntries(Array.from(tag[0].matchAll(/([\w-]+)="([^"]*)"/g), match => [match[1], match[2]]));
  const adapter = runtime({ queued: true });
  const targetPage = { route: 'pages/compose/index', data: { busy: false, uploadsBusy: false, hasVideoAttachment: false, pendingUploads: [], failedUploads: [] } };
  let submissions = 0;
  targetPage[attributes.bindtap] = () => { submissions += 1; };
  targetPage.setData = values => { Object.assign(targetPage.data, values); adapter.scheduleRender(); };
  const template = new Element('view');
  template.append(new Element('button', attributes));
  adapter.startRender(targetPage, template);
  const button = () => adapter.pageRoot.querySelectorAll('button')[0];
  const update = values => {
    targetPage.setData(values);
    let count = 0;
    while (adapter.microtasks.length && count++ < 10) adapter.microtasks.shift()();
    assert.equal(adapter.microtasks.length, 0);
  };
  assert.equal(button().disabled, false, 'no unfinished attachment permits text-only submission');
  button().click();
  assert.equal(submissions, 1);
  update({ pendingUploads: [{ ticketId: 'pending-image' }] });
  assert.equal(button().disabled, true, 'an unfinished image blocks submission');
  button().click();
  assert.equal(submissions, 1, 'the disabled control cannot invoke submission');
  update({ pendingUploads: [], failedUploads: [{ ticketId: 'failed-video' }] });
  assert.equal(button().disabled, true, 'a failed attachment also blocks submission');
  update({ failedUploads: [] });
  assert.equal(button().disabled, false, 'removing the last unfinished attachment enables submission again');
  button().click();
  assert.equal(submissions, 2);
  update({ hasVideoAttachment: true });
  assert.equal(button().disabled, true, 'even a completed legacy video blocks submission');
  button().click(); assert.equal(submissions, 2);
  update({ hasVideoAttachment: false });
  assert.equal(button().disabled, false, 'explicitly removing legacy video permits text and image submission');
});

test('image lazy-load is resolved before src and all images decode asynchronously', () => {
  const adapter = runtime();
  const cases = [
    { name: 'omitted', attributes: {}, values: {}, expected: 'eager' },
    { name: 'bound false', attributes: { 'lazy-load': '{{lazy}}' }, values: { lazy: false }, expected: 'eager' },
    { name: 'bound true', attributes: { 'lazy-load': '{{lazy}}' }, values: { lazy: true }, expected: 'lazy' },
    { name: 'empty boolean attribute', attributes: { 'lazy-load': '' }, values: {}, expected: 'lazy' },
    { name: 'literal true', attributes: { 'lazy-load': 'true' }, values: {}, expected: 'lazy' },
    { name: 'literal false', attributes: { 'lazy-load': 'false' }, values: {}, expected: 'eager' }
  ];
  for (const item of cases) {
    // src deliberately appears before lazy-load in the template attribute list.
    const image = draw(adapter, page(), imageTemplate(item.attributes), scope(item.values));
    assert.equal(image.tagName, 'IMG');
    assert.equal(image.loading, item.expected, item.name);
    assert.equal(image.decoding, 'async', item.name);
    assert.deepEqual(image.srcAssignments, [{ value: 'https://example.invalid/test.jpg', loading: item.expected, decoding: 'async' }], item.name + ' configures the first request');
    assert.ok(image.mutations.findIndex(item => item[0] === 'loading') < image.mutations.findIndex(item => item[0] === 'src'));
  }
  const parsedImage = draw(adapter, page(), imageTemplate({ 'lazy-load': '{{lazy}}' }, 'img'), scope({ lazy: true }));
  assert.equal(parsedImage.tagName, 'IMG', 'HTML-parsed WXML img follows the same image branch');
  assert.equal(parsedImage.loading, 'lazy');
});

test('SVG icons without a mode attribute render without aborting the detail page', () => {
  const adapter = runtime();
  for (const tag of ['image', 'img']) {
    const template = new Element(tag, { src: '{{icon}}', class: 'scene-icon' });
    const targetPage = page();
    targetPage.route = 'pages/local-detail/index';
    assert.equal(template.getAttribute('mode'), null, 'the fixture must exercise a genuinely omitted mode');
    const values = { icon: '/assets/nearby/icons/scene-park.svg' };
    const icon = draw(adapter, targetPage, template, values);
    assert.equal(icon.tagName, 'IMG');
    assert.equal(icon.src, values.icon);
    assert.match(icon.className, /scene-icon/);
    assert.equal(icon.loading, 'eager');
    assert.equal(icon.decoding, 'async');
    assert.strictEqual(draw(adapter, targetPage, template, values), icon, 'a detail state update can reuse the default-mode icon safely');
    assert.equal(icon.srcAssignments.length, 1);
  }
});

test('video playback controls respect false booleans and state updates reuse playback nodes', () => {
  const adapter = runtime();
  const targetPage = page();
  const received = [];
  targetPage.waiting = e => received.push(e);
  const template = new Element('video', { src: '{{src}}', controls: 'true', autoplay: 'false', loop: '{{loop}}', 'data-attempt': '{{attempt}}', bindwaiting: 'waiting' });
  const video = draw(adapter, targetPage, template, scope({ src: '/media/clips/123.mp4', loop: false }));
  assert.equal(video.controls, true);
  assert.equal(video.autoplay, false, 'autoplay="false" must not become a truthy HTML boolean attribute');
  assert.equal(video.loop, false);
  assert.equal(video.preload, 'metadata');
  assert.equal(video.playsInline, true);
  video.currentTime = 4;
  const reused = draw(adapter, targetPage, template, scope({ src: '/media/clips/123.mp4', loop: false, state: 'buffering' }));
  assert.equal(reused, video);
  assert.equal(reused.currentTime, 4);
  assert.equal(reused.srcAssignments.length, 1);
  assert.equal(reused.listeners.get('waiting').length, 1);
  reused.dispatch('waiting');
  assert.equal(received.length, 1);
  assert.notEqual(draw(adapter, targetPage, template, scope({ src: '/media/clips/123.mp4', attempt: 2 })), video, 'explicit retry recreates the failed media element');
});

test('same path, source, post and attempt reuse the image without assigning src again', () => {
  const adapter = runtime();
  const targetPage = page();
  const template = imageTemplate({ 'lazy-load': '{{lazy}}' });
  const first = draw(adapter, targetPage, template, scope({ lazy: true }));
  for (let i = 0; i < 3; i += 1) {
    assert.strictEqual(draw(adapter, targetPage, template, scope({ state: 'ready', lazy: true })), first);
    assert.equal(first.loading, 'lazy', 'unrelated state updates keep an off-screen image lazy');
  }
  assert.deepEqual(first.mutations.map(item => item[0]), ['loading', 'decoding', 'src'], 'reuse does not repeat loading, decoding or src writes');
  assert.ok(first.attributeRemovals.every(name => !['loading', 'decoding', 'src'].includes(name)), 'reuse never temporarily removes request attributes');
  const reused = draw(adapter, targetPage, template, scope({ state: 'ready', lazy: false }));
  assert.strictEqual(reused, first, 'state-only rendering keeps the loaded DOM image');
  assert.match(reused.className, /ready/);
  assert.doesNotMatch(reused.className, /loading/);
  assert.equal(reused.loading, 'eager', 'an existing image can become a first-screen eager image');
  assert.equal(reused.srcAssignments.length, 1, 'unrelated state updates do not restart image requests');
  assert.equal(adapter.elements.filter(element => element.tagName === 'IMG').length, 1);
  assert.equal(targetPage._previewImageNodes.size, 1);
});

test('a changed path, src, id or attempt creates a distinct image node', () => {
  for (const change of [
    { name: 'path', values: {}, path: 'n-1' },
    { name: 'src', values: { src: 'https://example.invalid/replacement.jpg' } },
    { name: 'id', values: { id: 'different-post' } },
    { name: 'attempt', values: { attempt: 2 } }
  ]) {
    const adapter = runtime();
    const targetPage = page();
    const template = imageTemplate();
    const first = draw(adapter, targetPage, template, scope());
    const replacement = draw(adapter, targetPage, template, scope(change.values), change.path);
    assert.notStrictEqual(replacement, first, change.name + ' does not reuse the old request');
    assert.equal(first.srcAssignments.length, 1);
    assert.equal(replacement.srcAssignments.length, 1);
    assert.equal(replacement.dataset.id, change.values.id || 'test-post');
    assert.equal(replacement.dataset.attempt, String(change.values.attempt || 1));
    assert.equal(targetPage._previewImageNodes.size, 1, 'the new render keeps only its current image');
  }
  const adapter = runtime();
  const template = imageTemplate();
  assert.notStrictEqual(draw(adapter, page(), template, scope()), draw(adapter, page(), template, scope()), 'separate pages never share request state');
});

test('reused images bind tap, load and error only once and keep old-attempt events distinct', () => {
  const adapter = runtime();
  const events = [];
  const targetPage = page();
  for (const method of ['onTap', 'onLoad', 'onError']) targetPage[method] = event => events.push({ method, event });
  const template = imageTemplate({ catchtap: 'onTap', bindload: 'onLoad', binderror: 'onError' });
  const first = draw(adapter, targetPage, template, scope());
  for (let i = 0; i < 3; i += 1) assert.strictEqual(draw(adapter, targetPage, template, scope({ state: 'ready' })), first);
  for (const type of ['click', 'load', 'error']) assert.equal(first.listeners.get(type).length, 1, type + ' is bound once');
  assert.equal(first.listeners.get('keydown').length, 1, 'keyboard activation is bound once');
  assert.equal(first.dispatch('click').stopped, true, 'catchtap stops the parent card action');
  first.dispatch('load');
  first.dispatch('error');
  assert.deepEqual(events.map(item => item.method), ['onTap', 'onLoad', 'onError']);
  assert.equal(events[1].event.detail.width, 640);
  assert.equal(events[1].event.detail.height, 480);
  assert.equal(events[2].event.detail.errMsg, '图片暂时无法加载');
  const replacement = draw(adapter, targetPage, template, scope({ attempt: 2 }));
  first.dispatch('error');
  replacement.dispatch('load');
  assert.equal(events.at(-2).event.currentTarget.dataset.attempt, '1', 'late events still identify the old attempt');
  assert.equal(events.at(-1).event.currentTarget.dataset.attempt, '2');
  assert.equal(replacement.listeners.get('load').length, 1);
  assert.equal(replacement.listeners.get('error').length, 1);
});

test('input focus requests open once, preserve the cursor across redraws and stay blurred after hideKeyboard', () => {
  const adapter = runtime(), targetPage = page(), events = [];
  targetPage.focused = event => events.push(['focus', event.detail]);
  targetPage.blurred = event => events.push(['blur', event.detail]);
  targetPage.keyboardChanged = event => events.push(['keyboard', event.detail]);
  const template = new Element('textarea', { value: '{{text}}', focus: '{{focused}}', bindfocus: 'focused', bindblur: 'blurred', bindkeyboardheightchange: 'keyboardChanged' });
  function renderInput(focused) {
    const active = adapter.document.activeElement;
    const key = active && active.dataset.previewKey;
    const selection = active && { start: active.selectionStart, end: active.selectionEnd };
    const input = draw(adapter, targetPage, template, { text: 'A preserved draft', focused });
    adapter.pageRoot.querySelectorAll = () => [input];
    adapter.document.activeElement = null; // Replacing a DOM node does not dispatch a native blur event.
    adapter.restoreInputFocus(targetPage, key, selection);
    return input;
  }
  renderInput(false);
  assert.equal(adapter.document.activeElement, null);
  const first = renderInput(true);
  assert.equal(adapter.document.activeElement, first);
  assert.deepEqual(events.map(([type]) => type), ['focus', 'keyboard']);
  assert.equal(events[0][1].value, 'A preserved draft');
  assert.equal(events[0][1].height, 0);
  assert.equal(events[1][1].height, 0, 'desktop focus never fabricates a keyboard gap');
  first.setSelectionRange(2, 7);
  const replacement = renderInput(true);
  assert.equal(adapter.document.activeElement, replacement);
  assert.equal(replacement.selectionStart, 2);
  assert.equal(replacement.selectionEnd, 7);
  assert.equal(replacement.focusOptions.preventScroll, true);
  assert.equal(events.length, 2, 'render restoration must not dispatch a new business focus event');

  const callbacks = [];
  adapter.wx.hideKeyboard({ success: value => callbacks.push(value.errMsg), complete: value => callbacks.push(value.errMsg) });
  assert.equal(adapter.document.activeElement, null);
  assert.deepEqual(callbacks, ['hideKeyboard:ok', 'hideKeyboard:ok']);
  assert.deepEqual(events.map(([type]) => type), ['focus', 'keyboard', 'blur', 'keyboard']);
  renderInput(true);
  assert.equal(adapter.document.activeElement, null, 'an unchanged true binding cannot reopen a dismissed keyboard');
  renderInput(false);
  const reopened = renderInput(true);
  assert.equal(adapter.document.activeElement, reopened, 'a fresh false-to-true request can focus again');

  adapter.pageRoot.querySelectorAll = () => [];
  adapter.document.activeElement = null;
  adapter.restoreInputFocus(targetPage, null, null);
  const mountedAgain = renderInput(true);
  assert.equal(adapter.document.activeElement, mountedAgain, 'removing then reopening the editor permits its initial focus request again');
});

test('stable false focus bindings preserve manual input focus while a true-to-false change releases it', () => {
  const adapter = runtime(), targetPage = page();
  const template = new Element('input', { value: 'draft', focus: '{{focused}}' });
  let input = draw(adapter, targetPage, template, { focused: false });
  adapter.pageRoot.querySelectorAll = () => [input];
  adapter.restoreInputFocus(targetPage, null, null);
  input.focus();
  const key = input.dataset.previewKey;
  input = draw(adapter, targetPage, template, { focused: false });
  adapter.document.activeElement = null;
  adapter.restoreInputFocus(targetPage, key, { start: 3, end: 3 });
  assert.equal(adapter.document.activeElement, input, 'manual focus remains stable without an explicit focus request');
  assert.equal(input.selectionStart, 3);
  input = draw(adapter, targetPage, template, { focused: true });
  adapter.document.activeElement = null;
  adapter.restoreInputFocus(targetPage, key, null);
  assert.equal(adapter.document.activeElement, input);
  input = draw(adapter, targetPage, template, { focused: false });
  adapter.document.activeElement = null;
  adapter.restoreInputFocus(targetPage, key, null);
  assert.equal(adapter.document.activeElement, null, 'an explicit false transition must not be undone by cursor restoration');
});

test('full renders settle when replacing a focused comment field dispatches synchronous or delayed blur', () => {
  for (const delayed of [false, true]) {
    const adapter = runtime({ queued: true }), events = [];
    if (delayed) adapter.document.deferRemovalBlur = callback => adapter.microtasks.push(callback);
    const targetPage = { route: 'pages/post/index', data: { open: false, focused: true, text: 'Unpublished draft', height: 0 } };
    targetPage.setData = values => { Object.assign(targetPage.data, values); adapter.scheduleRender(); };
    targetPage.keyboardChanged = event => {
      events.push(event.type);
      // Deliberately write even an unchanged height: render-loop protection
      // must not depend on every page controller guarding redundant setData.
      targetPage.setData({ height: event.detail.height });
    };
    const template = new Element('view');
    const editor = new Element('view', { 'wx:if': '{{open}}' });
    editor.append(new Element('textarea', { value: '{{text}}', focus: '{{focused}}', bindfocus: 'keyboardChanged', bindkeyboardheightchange: 'keyboardChanged' }));
    template.append(editor);
    adapter.startRender(targetPage, template);
    const settle = () => {
      let count = 0;
      while (adapter.microtasks.length && count++ < 8) adapter.microtasks.shift()();
      assert.equal(adapter.microtasks.length, 0, (delayed ? 'delayed' : 'synchronous') + ' removal blur must not keep enqueueing renders');
    };
    targetPage.setData({ open: true });
    settle();
    assert.equal(adapter.document.activeElement.tagName, 'TEXTAREA');
    assert.equal(adapter.document.activeElement.value, 'Unpublished draft');
    assert.deepEqual(events, ['focus', 'focus'], 'only the initial real focus and its keyboard notification reach the page');
    adapter.document.activeElement.setSelectionRange(2, 5);
    targetPage.setData({ text: 'Retained draft' });
    settle();
    assert.equal(adapter.document.activeElement.selectionStart, 2);
    assert.equal(adapter.document.activeElement.selectionEnd, 5);
    assert.equal(events.length, 2, 'redraws cannot turn native DOM removal into a user blur');
    adapter.wx.hideKeyboard();
    settle();
    assert.equal(adapter.document.activeElement, null, 'explicit keyboard dismissal still blurs and stays dismissed');
    assert.equal(events.at(-1), 'blur');
    targetPage.setData({ open: false });
    settle();
    assert.equal(adapter.pageRoot.querySelectorAll('textarea').length, 0);
  }
});

test('a first pointer click survives input blur redraws until the original search button handles it', () => {
  const adapter = runtime({ queued: true, queuedTimers: true }), events = [];
  adapter.installInputClickGuard();
  const targetPage = { route: 'pages/nearby/index', data: { focused: true, text: 'fixture search', query: '' } };
  targetPage.setData = values => { Object.assign(targetPage.data, values); adapter.scheduleRender(); };
  targetPage.blurred = () => { events.push('blur'); targetPage.setData({ focused: false }); };
  targetPage.search = () => { events.push('search'); targetPage.setData({ query: targetPage.data.text }); };
  const template = new Element('view');
  template.append(new Element('input', { value: '{{text}}', focus: '{{focused}}', bindblur: 'blurred' }), new Element('button', { bindtap: 'search' }));
  adapter.startRender(targetPage, template);
  const originalButton = adapter.pageRoot.querySelectorAll('button')[0];
  const settle = () => { let count = 0; while (adapter.microtasks.length && count++ < 10) adapter.microtasks.shift()(); assert.equal(adapter.microtasks.length, 0); };
  adapter.dispatchDocument('pointerdown', originalButton, { button: 0 });
  originalButton.focus(); // Native pointerdown default action blurs the input.
  settle();
  assert.deepEqual(events, ['blur']);
  assert.equal(adapter.pageRoot.contains(originalButton), true, 'blur must not detach the imminent click target');
  adapter.dispatchDocument('pointerup', originalButton);
  adapter.dispatchDocument('click', originalButton); // Capture phase.
  originalButton.click(); // The original target receives the first real click.
  settle();
  assert.deepEqual(events, ['blur', 'search']);
  for (const [id, timer] of adapter.timers) { adapter.timers.delete(id); timer(); }
  settle();
  assert.equal(targetPage.data.query, 'fixture search');
  assert.equal(adapter.pageRoot.contains(originalButton), false, 'normal rendering resumes after the click');
  assert.equal(adapter.document.activeElement.tagName, 'BUTTON', 'button focus remains available to keyboard users');
});

test('keyboard blur and Enter confirmation remain immediate and pointer cancellation releases held rendering', () => {
  const adapter = runtime({ queued: true, queuedTimers: true }), events = [];
  adapter.installInputClickGuard();
  const targetPage = { route: 'pages/nearby/index', data: { focused: true } };
  targetPage.setData = values => { Object.assign(targetPage.data, values); adapter.scheduleRender(); };
  targetPage.blurred = () => { events.push('blur'); targetPage.setData({ focused: false }); };
  targetPage.search = () => { events.push('confirm'); targetPage.setData({ searched: true }); };
  const template = new Element('view');
  template.append(new Element('input', { focus: '{{focused}}', bindblur: 'blurred', bindconfirm: 'search' }), new Element('button'));
  adapter.startRender(targetPage, template);
  const settle = () => { let count = 0; while (adapter.microtasks.length && count++ < 10) adapter.microtasks.shift()(); assert.equal(adapter.microtasks.length, 0); };
  const firstInput = adapter.document.activeElement;
  firstInput.dispatch('keydown', { key: 'Enter' }); settle();
  assert.deepEqual(events, ['confirm']);
  assert.equal(targetPage.data.searched, true);
  const keyboardButton = adapter.pageRoot.querySelectorAll('button')[0];
  keyboardButton.focus(); settle();
  assert.deepEqual(events, ['confirm', 'blur']);
  assert.equal(adapter.pageRoot.contains(keyboardButton), false, 'keyboard-driven blur needs no pointer release');
  targetPage.setData({ focused: true }); settle();
  const originalButton = adapter.pageRoot.querySelectorAll('button')[0];
  adapter.dispatchDocument('pointerdown', originalButton, { button: 0 });
  originalButton.focus(); settle();
  assert.equal(adapter.pageRoot.contains(originalButton), true);
  adapter.dispatchDocument('pointercancel', originalButton); settle();
  assert.equal(adapter.pageRoot.contains(originalButton), false, 'cancelled pointer interactions cannot leave rendering suspended');
});

test('selector page scrolling is relative to the phone page and invalid targets do not reset its position', () => {
  const adapter = runtime(), queries = [], scrolls = [], callbacks = [];
  adapter.pageRoot.scrollTop = 120;
  adapter.pageRoot.getBoundingClientRect = () => ({ top: 70 });
  adapter.pageRoot.querySelector = selector => {
    queries.push(selector);
    if (selector === '[') throw new Error('invalid selector');
    return selector === '#post-comments' ? { getBoundingClientRect: () => ({ top: 300 }) } : null;
  };
  adapter.pageRoot.scrollTo = options => { scrolls.push({ ...options }); adapter.pageRoot.scrollTop = options.top; };
  adapter.wx.pageScrollTo({ selector: '#post-comments', scrollTop: 999, offsetTop: -12, duration: 0,
    success: value => callbacks.push(['success', value.errMsg]), complete: value => callbacks.push(['complete', value.errMsg]) });
  assert.deepEqual(queries, ['#post-comments']);
  assert.deepEqual(scrolls, [{ top: 338, behavior: 'instant' }]);
  assert.deepEqual(callbacks, [['success', 'pageScrollTo:ok'], ['complete', 'pageScrollTo:ok']]);
  for (const selector of ['#missing', '[']) {
    const failure = [];
    adapter.wx.pageScrollTo({ selector, fail: value => failure.push(['fail', value.errMsg]), complete: value => failure.push(['complete', value.errMsg]) });
    assert.deepEqual(failure.map(([type]) => type), ['fail', 'complete']);
    assert.match(failure[0][1], /^pageScrollTo:fail/);
  }
  assert.equal(scrolls.length, 1, 'missing or invalid targets do not jump to the top');
  assert.equal(adapter.pageRoot.scrollTop, 338);
  adapter.wx.pageScrollTo({ scrollTop: 200, duration: 300 });
  assert.deepEqual(scrolls[1], { top: 200, behavior: 'smooth' }, 'numeric scrolling keeps its existing duration behavior');
});
