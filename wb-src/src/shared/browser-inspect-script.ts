import { BROWSER_MSG_SOURCE } from './browser-msg.ts'

/** Injected into proxied pages. Classic script (no import). Keep in sync with browser-locator.ts. */

export { BROWSER_MSG_SOURCE }

export const BROWSER_INSPECT_SCRIPT = `(function () {
  if (window.__DSH_BROWSER__) return;
  window.__DSH_BROWSER__ = true;
  var SOURCE = ${JSON.stringify(BROWSER_MSG_SOURCE)};
  var HTML_MAX = 48000;
  var TEXT_MAX = 500;
  var inspectOn = false;
  var overlay = null;
  var labelEl = null;
  var lastHover = null;

  function pageUrl() {
    var base = document.querySelector('base');
    var url = '';
    if (base && base.href) url = base.href;
    else {
      try {
        var u = new URL(location.href);
        var orig = u.searchParams.get('u');
        if (orig) url = orig;
      } catch (e) {}
    }
    if (url === '') return location.href;
    // ★ SPA hash 路由：把当前 hash 并到真实预览 URL 上，让地址栏跟随显示 #/xxx
    // （仅对真实预览 URL 拼 hash；fallback 到平台代理 URL 的场景不拼，避免混入代理前缀）
    var h = (typeof location !== 'undefined') ? location.hash : '';
    if (h && h !== '') {
      try {
        var u2 = new URL(url);
        if (u2.hash !== h) { u2.hash = h; }
        return u2.href;
      } catch (e) {}
    }
    return url;
  }

  function post(payload) {
    payload.source = SOURCE;
    try { parent.postMessage(payload, '*'); } catch (e) {}
  }

  function viewport() {
    return { w: window.innerWidth || 0, h: window.innerHeight || 0 };
  }

  function pageInfo() {
    return {
      type: 'page',
      url: pageUrl(),
      title: document.title || '',
      ua: navigator.userAgent || '',
      viewport: viewport(),
      secure: !!window.isSecureContext,
      cookiesEnabled: navigator.cookieEnabled !== false,
    };
  }

  function tagOf(el) {
    return (el.tagName || 'el').toLowerCase();
  }

  function indexAmongType(el) {
    var parent = el.parentElement;
    if (!parent) return 1;
    var tag = el.tagName;
    var n = 0;
    var kids = parent.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName !== tag) continue;
      n += 1;
      if (kids[i] === el) return n;
    }
    return 1;
  }

  function xpathOf(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      var tag = tagOf(node);
      if (tag === 'html') {
        parts.unshift('/html[1]');
        break;
      }
      parts.unshift('/' + tag + '[' + indexAmongType(node) + ']');
      node = node.parentElement;
    }
    return parts.join('');
  }

  function cssEscape(value) {
    return String(value).replace(/([^\\w-])/g, '\\\\$1');
  }

  function uniqueSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) {
      var byId = '#' + el.id;
      try { if (document.querySelectorAll(byId).length === 1) return byId; } catch (e) {}
    }
    var testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
    if (testId) {
      var sel = '[data-testid="' + String(testId).replace(/"/g, '\\\\"') + '"]';
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e2) {}
    }
    return null;
  }

  function cssPathOf(el) {
    var unique = uniqueSelector(el);
    if (unique) return unique;
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && tagOf(node) !== 'html') {
      var tag = tagOf(node);
      if (tag === 'body') { parts.unshift('body'); break; }
      var idSel = uniqueSelector(node);
      if (idSel) { parts.unshift(idSel); break; }
      var nth = indexAmongType(node);
      var klass = '';
      if (typeof node.className === 'string') {
        klass = node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).map(cssEscape).join('.');
      }
      var piece = klass ? tag + '.' + klass : tag;
      var siblings = node.parentElement ? node.parentElement.querySelectorAll(tag).length : 1;
      parts.unshift((nth > 1 || siblings !== 1) ? piece + ':nth-of-type(' + nth + ')' : piece);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function jsPathOf(el) {
    var css = cssPathOf(el);
    return 'document.querySelector("' + css.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '")';
  }

  function clipHtml(html) {
    if (html.length <= HTML_MAX) return { html: html, htmlTruncated: false };
    return { html: html.slice(0, HTML_MAX), htmlTruncated: true };
  }

  function pack(el) {
    var rawHtml = el.outerHTML || '';
    var clipped = clipHtml(rawHtml);
    var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX);
    return {
      tag: tagOf(el),
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      name: el.getAttribute('name') || '',
      href: el.getAttribute('href') || '',
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || '',
      xpath: xpathOf(el),
      cssPath: cssPathOf(el),
      jsPath: jsPathOf(el),
      text: text,
      html: clipped.html,
      htmlTruncated: clipped.htmlTruncated,
      url: pageUrl(),
      title: document.title || '',
    };
  }

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = document.createElement('div');
    overlay.setAttribute('data-dsh-inspect-overlay', '');
    overlay.style.cssText = 'position:fixed!important;z-index:2147483647!important;pointer-events:none!important;border:2px solid #1a73e8!important;background:rgba(26,115,232,0.18)!important;box-shadow:0 0 0 1px rgba(255,255,255,0.85)!important;display:none!important;box-sizing:border-box!important;margin:0!important;padding:0!important;';
    labelEl = document.createElement('div');
    labelEl.setAttribute('data-dsh-inspect-label', '');
    labelEl.style.cssText = 'position:absolute!important;left:-2px!important;height:20px!important;padding:0 6px!important;background:#1a73e8!important;color:#fff!important;font:11px/20px ui-sans-serif,system-ui,sans-serif!important;white-space:nowrap!important;border-radius:2px 2px 0 0!important;max-width:280px!important;overflow:hidden!important;text-overflow:ellipsis!important;pointer-events:none!important;';
    overlay.appendChild(labelEl);
    (document.documentElement || document.body).appendChild(overlay);
    return overlay;
  }

  function hideOverlay() {
    if (overlay) overlay.style.setProperty('display', 'none', 'important');
    lastHover = null;
  }

  function showOverlay(el) {
    if (!el || el === overlay || (labelEl && el === labelEl)) return;
    if (el.getAttribute && el.getAttribute('data-dsh-inspect-overlay') !== null) return;
    var box = ensureOverlay();
    var r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    box.style.setProperty('display', 'block', 'important');
    box.style.setProperty('left', r.left + 'px', 'important');
    box.style.setProperty('top', r.top + 'px', 'important');
    box.style.setProperty('width', Math.max(0, r.width) + 'px', 'important');
    box.style.setProperty('height', Math.max(0, r.height) + 'px', 'important');
    var name = tagOf(el);
    if (el.id) name += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) {
      name += '.' + el.className.trim().split(/\\s+/)[0];
    }
    if (labelEl) {
      labelEl.textContent = name;
      if (r.top < 24) {
        labelEl.style.setProperty('top', '100%', 'important');
        labelEl.style.setProperty('margin-top', '2px', 'important');
        labelEl.style.setProperty('border-radius', '0 0 2px 2px', 'important');
      } else {
        labelEl.style.setProperty('top', '-20px', 'important');
        labelEl.style.setProperty('margin-top', '0', 'important');
        labelEl.style.setProperty('border-radius', '2px 2px 0 0', 'important');
      }
    }
    lastHover = el;
  }

  function setInspect(on) {
    inspectOn = !!on;
    var root = document.documentElement;
    if (root) {
      root.style.cursor = inspectOn ? 'crosshair' : '';
      if (inspectOn) root.setAttribute('data-dsh-inspecting', '');
      else root.removeAttribute('data-dsh-inspecting');
    }
    if (document.body) document.body.style.cursor = inspectOn ? 'crosshair' : '';
    if (inspectOn) ensureOverlay();
    else hideOverlay();
  }

  function isOverlay(el) {
    if (!el) return false;
    if (el.getAttribute && (el.getAttribute('data-dsh-inspect-overlay') !== null || el.getAttribute('data-dsh-inspect-label') !== null)) return true;
    return !!(el.closest && el.closest('[data-dsh-inspect-overlay]'));
  }

  function targetFromEvent(event) {
    var x = event.clientX, y = event.clientY;
    var el = document.elementFromPoint(x, y);
    if (isOverlay(el)) {
      var prev = overlay.style.pointerEvents;
      overlay.style.pointerEvents = 'none';
      el = document.elementFromPoint(x, y);
      overlay.style.pointerEvents = prev;
    }
    if (!el || el === document.documentElement || el === document.body) return el;
    return el;
  }

  function onMove(event) {
    if (!inspectOn) return;
    showOverlay(targetFromEvent(event));
  }

  function onClick(event) {
    if (inspectOn) {
      event.preventDefault();
      event.stopPropagation();
      var el = targetFromEvent(event);
      if (el && !isOverlay(el)) post({ type: 'pick', snapshot: pack(el) });
      return;
    }
    var a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.href;
    if (!href) return;
    if (a.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (/^(javascript|mailto|tel):/i.test(href)) return;
    // SPA 内部路由：同源、同路径、仅 hash 变化的链接（如 #/system/users）交给应用自己处理，
    // 不是真实浏览器跳转，不拦截不上报——否则 HashRouter 导航会被当成坏地址（badUrl）。
    try {
      var cur = new URL(location.href);
      var tgt = new URL(href, cur.href);
      if (cur.origin === tgt.origin && cur.pathname === tgt.pathname) {
        return; // 仅 hash 变化 → 放行给框架
      }
    } catch (e) {}
    event.preventDefault();
    post({ type: 'nav', url: href });
  }

  function wrapConsole(level) {
    var orig = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var v = arguments[i];
        try { parts.push(typeof v === 'string' ? v : JSON.stringify(v)); }
        catch (e) { parts.push(String(v)); }
      }
      var text = parts.join(' ');
      if (text.length > 2000) text = text.slice(0, 2000);
      post({ type: 'console', level: level, text: text });
      return orig.apply(console, arguments);
    };
  }

  function stringify(value) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'bigint') return String(value) + 'n';
    if (typeof value === 'function' || typeof value === 'symbol') return String(value);
    try {
      var json = JSON.stringify(value);
      if (typeof json === 'string') return json;
    } catch (e) {}
    return String(value);
  }

  wrapConsole('log');
  wrapConsole('info');
  wrapConsole('debug');
  wrapConsole('warn');
  wrapConsole('error');
  var origClear = console.clear ? console.clear.bind(console) : function () {};
  console.clear = function () {
    post({ type: 'console-clear' });
    return origClear.apply(console, arguments);
  };

  var netSeq = 0;
  var netQueue = [];
  var netFlush = 0;
  window.__DSH_NET_HOOKS__ = true;
  function clipUrl(u) {
    u = String(u || '');
    if (u.length > 1500) u = u.slice(0, 1500);
    return u;
  }
  function kindFrom(t, url) {
    t = String(t || '').toLowerCase();
    if (t === 'xmlhttprequest' || t === 'xhr') return 'xhr';
    if (t === 'fetch') return 'fetch';
    if (t === 'script') return 'script';
    if (t === 'link' || t === 'css' || t === 'stylesheet') return 'stylesheet';
    if (t === 'img' || t === 'image' || t === 'icon' || t === 'cssimage') return 'image';
    if (t === 'font') return 'font';
    if (t === 'video' || t === 'audio' || t === 'media') return 'media';
    if (t === 'websocket') return 'websocket';
    if (t === 'navigation' || t === 'iframe' || t === 'document') return 'document';
    var path = String(url || '').split('?')[0].toLowerCase();
    if (/\\.(m?js|cjs)(\\.map)?$/.test(path)) return 'script';
    if (/\\.css$/.test(path)) return 'stylesheet';
    if (/\\.(png|jpe?g|gif|svg|webp|ico|avif|bmp)$/.test(path)) return 'image';
    if (/\\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
    if (/\\.(mp4|webm|mp3|wav|ogg)$/.test(path)) return 'media';
    return 'other';
  }
  function flushNet() {
    netFlush = 0;
    if (!netQueue.length) return;
    var batch = netQueue;
    netQueue = [];
    post({ type: 'net', entries: batch });
  }
  function postNet(entry) {
    netQueue.push(entry);
    if (netQueue.length >= 40) {
      if (netFlush) {
        try { cancelAnimationFrame(netFlush); } catch (e) {}
        netFlush = 0;
      }
      flushNet();
      return;
    }
    if (netFlush) return;
    try { netFlush = requestAnimationFrame(flushNet); }
    catch (e2) { netFlush = setTimeout(flushNet, 16); }
  }

  // ---- full-request capture (headers + body) so the workbench can build a complete curl ----
  function netBodyText(body) {
    try {
      if (typeof body === 'string') return body.slice(0, 2000);
      if (body instanceof Blob) return '[Blob ' + (body.size || 0) + ' bytes]';
      if (body instanceof ArrayBuffer) return '[ArrayBuffer ' + body.byteLength + ' bytes]';
      if (body instanceof URLSearchParams) return body.toString().slice(0, 2000);
      if (body instanceof FormData) return '[FormData ' + body.size + ' fields]';
      var json;
      try { json = JSON.stringify(body); } catch (e) { json = null; }
      if (typeof json === 'string') return json.slice(0, 2000);
      return String(body).slice(0, 2000);
    } catch (e) { return ''; }
  }
  function collectHeaders(raw) {
    var out = [];
    try {
      if (typeof Headers !== 'undefined' && raw instanceof Headers) {
        raw.forEach(function (v, k) { out.push([String(k), String(v)]); });
      } else if (Array.isArray(raw)) {
        for (var i = 0; i < raw.length; i++) {
          if (raw[i] && raw[i].length === 2) out.push([String(raw[i][0]), String(raw[i][1])]);
        }
      } else if (raw && typeof raw === 'object') {
        for (var k in raw) { try { out.push([String(k), String(raw[k])]); } catch (e) {} }
      }
    } catch (e) {}
    return out.slice(0, 20);
  }
  function pageRoute() {
    try { return pageUrl(); } catch (e) { return ''; }
  }

  try {
    var XO = XMLHttpRequest.prototype.open;
    var XS = XMLHttpRequest.prototype.send;
    var XSRH = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__dsh = { method: String(method || 'GET').toUpperCase(), url: clipUrl(url), start: Date.now(), headers: [], body: undefined };
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.open.__dshNet = true;
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (this.__dsh && Array.isArray(this.__dsh.headers)) {
        try { this.__dsh.headers.push([String(name), String(value)]); } catch (e) {}
      }
      return XSRH.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      var self = this;
      var meta = self.__dsh || { method: 'GET', url: '', start: Date.now(), headers: [], body: undefined };
      if (body !== undefined && body !== null && !(body instanceof Document)) {
        try { meta.body = netBodyText(body); } catch (e2) {}
      }
      var id = ++netSeq;
      var headers = meta.headers.slice(0, 20);
      var page = pageRoute();
      postNet({ id: id, method: meta.method, url: meta.url, resourceType: 'xhr', status: 0, durationMs: 0, size: 0, pending: true, failed: false, startAt: meta.start, requestHeaders: headers, postData: meta.body, pageUrl: page });
      self.addEventListener('loadend', function () {
        postNet({
          id: id,
          method: meta.method,
          url: clipUrl(self.responseURL || meta.url),
          resourceType: 'xhr',
          status: self.status || 0,
          durationMs: Date.now() - meta.start,
          size: 0,
          pending: false,
          failed: self.status === 0,
          startAt: meta.start,
          requestHeaders: headers,
          postData: meta.body,
          pageUrl: page,
        });
      });
      return XS.apply(this, arguments);
    };
  } catch (xhrErr) {}

  try {
    if (typeof window.fetch === 'function') {
      var origFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        var method = 'GET';
        var url = '';
        var headers = [];
        var postBody = undefined;
        try {
          if (typeof input === 'string') url = input;
          else if (input && input.url) url = input.url;
          if (init && init.method) method = String(init.method);
          else if (input && input.method) method = String(input.method);
          if (init && init.headers) headers = collectHeaders(init.headers);
          if (init && init.body !== undefined && init.body !== null) postBody = netBodyText(init.body);
        } catch (e) {}
        method = String(method || 'GET').toUpperCase();
        url = clipUrl(url);
        var id = ++netSeq;
        var start = Date.now();
        var page = pageRoute();
        postNet({ id: id, method: method, url: url, resourceType: 'fetch', status: 0, durationMs: 0, size: 0, pending: true, failed: false, startAt: start, requestHeaders: headers, postData: postBody, pageUrl: page });
        return origFetch.apply(this, arguments).then(function (res) {
          postNet({
            id: id,
            method: method,
            url: clipUrl((res && res.url) || url),
            resourceType: 'fetch',
            status: (res && res.status) || 0,
            durationMs: Date.now() - start,
            size: 0,
            pending: false,
            failed: false,
            startAt: start,
            requestHeaders: headers,
            postData: postBody,
            pageUrl: page,
          });
          return res;
        }, function (err) {
          postNet({ id: id, method: method, url: url, resourceType: 'fetch', status: 0, durationMs: Date.now() - start, size: 0, pending: false, failed: true, startAt: start, requestHeaders: headers, postData: postBody, pageUrl: page });
          throw err;
        });
      };
      window.fetch.__dshNet = true;
    }
  } catch (fetchErr) {}

  try {
    if (window.WebSocket) {
      var WS = window.WebSocket;
      window.WebSocket = function (url, protocols) {
        var id = ++netSeq;
        var start = Date.now();
        var u = clipUrl(url);
        postNet({ id: id, method: 'WS', url: u, resourceType: 'websocket', status: 0, durationMs: 0, size: 0, pending: true, failed: false, startAt: start });
        var ws = protocols !== undefined ? new WS(url, protocols) : new WS(url);
        ws.addEventListener('open', function () {
          postNet({ id: id, method: 'WS', url: u, resourceType: 'websocket', status: 101, durationMs: Date.now() - start, size: 0, pending: false, failed: false, startAt: start });
        });
        ws.addEventListener('error', function () {
          postNet({ id: id, method: 'WS', url: u, resourceType: 'websocket', status: 0, durationMs: Date.now() - start, size: 0, pending: false, failed: true, startAt: start });
        });
        return ws;
      };
      window.WebSocket.prototype = WS.prototype;
      window.WebSocket.CONNECTING = WS.CONNECTING;
      window.WebSocket.OPEN = WS.OPEN;
      window.WebSocket.CLOSING = WS.CLOSING;
      window.WebSocket.CLOSED = WS.CLOSED;
    }
  } catch (wsErr) {}

  function takeResource(entry) {
    if (!entry) return;
    var url = clipUrl(entry.name);
    if (!url) return;
    var kind = kindFrom(entry.initiatorType, url);
    if (kind === 'xhr' || kind === 'fetch') return;
    var status = 0;
    try { status = entry.responseStatus || 0; } catch (e) {}
    var size = 0;
    try { size = Math.round(entry.transferSize || entry.encodedBodySize || 0); } catch (e2) {}
    postNet({
      id: ++netSeq,
      method: 'GET',
      url: url,
      resourceType: kind,
      status: status,
      durationMs: Math.round(entry.duration || 0),
      size: size,
      pending: false,
      failed: false,
      startAt: Date.now() - Math.round(entry.duration || 0),
    });
  }
  try {
    if (typeof PerformanceObserver === 'function') {
      var po = new PerformanceObserver(function (list) {
        var recs = list.getEntries();
        for (var i = 0; i < recs.length; i++) takeResource(recs[i]);
      });
      try { po.observe({ type: 'resource', buffered: true }); } catch (e) {}
      try { po.observe({ type: 'navigation', buffered: true }); } catch (e2) {}
    }
  } catch (perfErr) {}

  function rowsFromStorage(store) {
    var rows = [];
    if (!store) return rows;
    var n = 0;
    try { n = store.length; } catch (e) { return rows; }
    for (var i = 0; i < n && rows.length < 80; i++) {
      var key = '';
      try { key = store.key(i) || ''; } catch (e2) { continue; }
      var val = '';
      var truncated = false;
      try {
        val = String(store.getItem(key) || '');
        if (val.length > 500) { val = val.slice(0, 500); truncated = true; }
      } catch (e3) {}
      rows.push({ name: String(key), value: val, truncated: truncated });
    }
    return rows;
  }
  function parseCookies() {
    var rows = [];
    var raw = '';
    try { raw = document.cookie || ''; } catch (e) { return rows; }
    var parts = raw.split(';');
    for (var i = 0; i < parts.length && rows.length < 80; i++) {
      var p = String(parts[i] || '').replace(/^\\s+/, '');
      if (!p) continue;
      var eq = p.indexOf('=');
      var name = eq === -1 ? p : p.slice(0, eq);
      var value = eq === -1 ? '' : p.slice(eq + 1);
      var truncated = false;
      if (value.length > 500) { value = value.slice(0, 500); truncated = true; }
      if (name) rows.push({ name: name, value: value, truncated: truncated });
    }
    return rows;
  }
  function postApp() {
    var payload = {
      type: 'app',
      cookies: parseCookies(),
      localStorage: [],
      sessionStorage: [],
      databases: [],
    };
    try { payload.localStorage = rowsFromStorage(window.localStorage); } catch (e) {}
    try { payload.sessionStorage = rowsFromStorage(window.sessionStorage); } catch (e2) {}
    var finish = function () { post(payload); };
    try {
      if (window.indexedDB && indexedDB.databases) {
        indexedDB.databases().then(function (list) {
          var dbs = [];
          if (list) {
            for (var i = 0; i < list.length && dbs.length < 80; i++) {
              var n = list[i] && list[i].name;
              if (n) dbs.push(String(n));
            }
          }
          payload.databases = dbs;
          finish();
        }).catch(finish);
        return;
      }
    } catch (e3) {}
    finish();
  }
  function postCss() {
    var sheets = [];
    var vars = [];
    try {
      var list = document.styleSheets;
      for (var i = 0; i < list.length && sheets.length < 80; i++) {
        var s = list[i];
        var href = '';
        var title = '';
        var disabled = false;
        try { href = s.href || ''; } catch (e) {}
        try { title = s.title || ''; } catch (e2) {}
        try { disabled = !!s.disabled; } catch (e3) {}
        var ruleCount = null;
        var blocked = false;
        try {
          var rules = s.cssRules || s.rules;
          ruleCount = rules ? rules.length : 0;
        } catch (e4) { blocked = true; }
        sheets.push({ href: clipUrl(href), title: title, disabled: disabled, ruleCount: ruleCount, blocked: blocked });
      }
    } catch (e5) {}
    try {
      var root = document.documentElement;
      if (root && window.getComputedStyle) {
        var cs = window.getComputedStyle(root);
        for (var j = 0; j < cs.length && vars.length < 80; j++) {
          var name = cs[j];
          if (name && name.indexOf('--') === 0) {
            vars.push({ name: name, value: String(cs.getPropertyValue(name) || '').slice(0, 300) });
          }
        }
      }
    } catch (e6) {}
    post({ type: 'css', sheets: sheets, vars: vars });
  }
  function postFiles() {
    var out = [];
    var seen = {};
    function add(url, kind, size, duration) {
      url = clipUrl(url);
      if (!url || seen[url]) return;
      seen[url] = 1;
      out.push({ url: url, kind: kind, size: size || 0, durationMs: duration || 0 });
    }
    add(pageUrl(), 'document', 0, 0);
    try {
      var scripts = document.scripts;
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].src) add(scripts[i].src, 'script', 0, 0);
      }
    } catch (e) {}
    try {
      var links = document.querySelectorAll('link[rel~="stylesheet"],link[rel="preload"][as="style"]');
      for (var li = 0; li < links.length; li++) {
        var href = links[li].href;
        if (href) add(href, 'stylesheet', 0, 0);
      }
    } catch (e2) {}
    try {
      var imgs = document.images;
      for (var im = 0; im < imgs.length; im++) {
        if (imgs[im].currentSrc || imgs[im].src) add(imgs[im].currentSrc || imgs[im].src, 'image', 0, 0);
      }
    } catch (e3) {}
    try {
      var entries = performance.getEntriesByType('resource');
      for (var p = 0; p < entries.length && out.length < 200; p++) {
        var en = entries[p];
        var size = 0;
        try { size = Math.round(en.transferSize || en.encodedBodySize || 0); } catch (e4) {}
        add(en.name, kindFrom(en.initiatorType, en.name), size, Math.round(en.duration || 0));
      }
    } catch (e5) {}
    post({ type: 'files', files: out.slice(0, 200) });
  }
  function dumpDevtools() {
    postApp();
    postCss();
    postFiles();
  }

  window.addEventListener('error', function (event) {
    var where = event.filename ? ' (' + event.filename + ':' + event.lineno + ')' : '';
    post({ type: 'console', level: 'error', text: (event.message || 'Error') + where });
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var text = 'Unhandled Promise: ';
    try { text += reason && reason.stack ? String(reason.stack) : stringify(reason); }
    catch (e) { text += String(reason); }
    if (text.length > 2000) text = text.slice(0, 2000);
    post({ type: 'console', level: 'error', text: text });
  });

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === 'inspect') setInspect(!!data.on);
    if (data.type === 'query' || data.type === 'probe') {
      post(pageInfo());
      dumpDevtools();
    }
    if (data.type === 'eval') {
      var id = data.id;
      var code = String(data.code || '');
      try {
        var result = (0, eval)(code);
        // ★ async IIFE / Promise 结果：等待后再序列化（否则 stringify(Promise) = '{}'，
        //   AI 的异步验证 code 会全被当成空结果反复重试）
        if (result && typeof result.then === 'function') {
          result.then(function (v) {
            post({ type: 'eval-result', id: id, ok: true, text: stringify(v) });
          }).catch(function (err) {
            var msg = err && err.stack ? String(err.stack) : String(err);
            if (msg.length > 2000) msg = msg.slice(0, 2000);
            post({ type: 'eval-result', id: id, ok: false, text: msg });
          });
          return;
        }
        post({ type: 'eval-result', id: id, ok: true, text: stringify(result) });
      } catch (err) {
        var msg = err && err.stack ? String(err.stack) : String(err);
        if (msg.length > 2000) msg = msg.slice(0, 2000);
        post({ type: 'eval-result', id: id, ok: false, text: msg });
      }
    }
    // ── agent 浏览器控制（AI 驱动）：snapshot/click/type/wait ──
    if (data.type === 'snapshot') { agentSnapshot(data.id); }
    if (data.type === 'click') { agentClick(data.id, data.ref); }
    if (data.type === 'type') { agentType(data.id, data.ref, data.text, data.submit); }
    if (data.type === 'wait') { agentWait(data.id, data.ms, data.selector); }
    // ★ 地址栏 hash 切换（2026-09-01）：host 请求在本页设置 location.hash（SPA HashRouter
    //   路由切换），不重载页面、不经过服务端 fetch（否则 hash 丢失回首页）。
    if (data.type === 'set-hash') {
      var h = String(data.hash || '');
      try {
        if (location.hash !== h) location.hash = h;
        post(pageInfo());
      } catch (e) { /* ignore */ }
    }
    if (data.type === 'verify_text') { agentVerifyText(data.id, data.text); }
    if (data.type === 'screenshot') { agentScreenshot(data.id); }
  });

  // ================= agent 执行器 =================
  // 快照采集的可交互元素（ref → cssPath），click/type 按 cssPath 重新定位
  // （页面重渲染后 ref 索引可能失效，cssPath 动态重查最稳）
  var agentRefs = [];
  var AGENT_MAX_ITEMS = 200;
  function agentText(el) {
    try {
      var t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      return t.length > 120 ? t.slice(0, 120) + '…' : t;
    } catch (e) { return ''; }
  }
  function agentLabel(el) {
    try {
      if (el.getAttribute && el.getAttribute('aria-label')) return String(el.getAttribute('aria-label')).slice(0, 120);
      if (el.labels && el.labels.length) return agentText(el.labels[0]);
      if (el.id) { var l = document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]'); if (l) return agentText(l); }
    } catch (e) {}
    return '';
  }
  function agentInteractive(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.getAttribute('href')) return true;
    if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') return true;
    var role = el.getAttribute && el.getAttribute('role');
    if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'radio' || role === 'textbox' || role === 'combobox' || role === 'tab' || role === 'menuitem') return true;
    if (el.getAttribute && (el.getAttribute('tabindex') !== null && el.getAttribute('tabindex') !== '-1')) return true;
    return false;
  }
  function agentSnapshot(id) {
    agentRefs = [];
    var items = [];
    var all = document.querySelectorAll('a[href],button,input,select,textarea,[role],[tabindex]');
    for (var i = 0; i < all.length && items.length < AGENT_MAX_ITEMS; i++) {
      var el = all[i];
      if (!agentInteractive(el)) continue;
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (rect && (rect.width < 1 || rect.height < 1)) continue; // 不可见/零尺寸跳过
      var ref = agentRefs.length;
      agentRefs.push(cssPathOf(el));
      var tag = tagOf(el);
      var item = { ref: ref, tag: tag };
      if (el.getAttribute) {
        var role = el.getAttribute('role');
        if (role) item.role = role;
        var type = el.getAttribute('type');
        if (type) item.type = type;
        var name = el.getAttribute('name');
        if (name) item.name = name.slice(0, 60);
        var href = el.getAttribute('href');
        if (href) item.href = href.slice(0, 200);
        var aria = el.getAttribute('aria-label');
        if (aria) item.ariaLabel = aria.slice(0, 120);
      }
      var label = agentLabel(el);
      if (label) item.label = label;
      var text = agentText(el);
      if (text) item.text = text;
      if (el.checked !== undefined) item.checked = !!el.checked;
      if (el.value !== undefined && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
        item.value = String(el.value).slice(0, 120);
      }
      items.push(item);
    }
    post({ type: 'agent-result', id: id, ok: true, data: { type: 'snapshot', url: pageUrl(), title: document.title || '', items: items } });
  }
  function agentFind(ref) {
    var css = agentRefs[ref];
    if (!css) return null;
    try { return document.querySelector(css); } catch (e) { return null; }
  }
  function agentFail(id, err) {
    var msg = err && err.stack ? String(err.stack) : String(err || 'error');
    if (msg.length > 800) msg = msg.slice(0, 800);
    post({ type: 'agent-result', id: id, ok: false, error: msg });
  }
  function agentClick(id, ref) {
    try {
      var el = agentFind(Number(ref));
      if (!el) { agentFail(id, 'element not found for ref ' + ref); return; }
      // 元素中心坐标（相对 iframe 视口）→ client 驱动 AI 光标滑到目标，像真人操作
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      el.click();
      post({ type: 'agent-result', id: id, ok: true, data: { type: 'click', ref: ref, tag: tagOf(el), url: pageUrl(), x: rect ? Math.round(rect.left + rect.width / 2) : 0, y: rect ? Math.round(rect.top + rect.height / 2) : 0 } });
    } catch (e) { agentFail(id, e); }
  }
  function agentType(id, ref, text, submit) {
    try {
      var el = agentFind(Number(ref));
      if (!el) { agentFail(id, 'element not found for ref ' + ref); return; }
      var tag = tagOf(el);
      var isText = tag === 'input' || tag === 'textarea';
      if (!isText) { agentFail(id, 'ref ' + ref + ' is not a text input (' + tag + ')'); return; }
      // 元素中心坐标（相对 iframe 视口）→ client 驱动 AI 光标滑到目标，像真人操作
      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      var proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) { setter.set.call(el, String(text)); } else { el.value = String(text); }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (submit) {
        try { el.focus(); } catch (e) {}
        var form = el.form;
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        } else {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }
      }
      post({ type: 'agent-result', id: id, ok: true, data: { type: 'type', ref: ref, tag: tag, value: String(text).slice(0, 120), submit: !!submit, x: rect ? Math.round(rect.left + rect.width / 2) : 0, y: rect ? Math.round(rect.top + rect.height / 2) : 0 } });
    } catch (e) { agentFail(id, e); }
  }
  function agentWait(id, ms, selector) {
    var started = Date.now();
    var poll = function () {
      try {
        if (selector) {
          if (document.querySelector(selector)) { post({ type: 'agent-result', id: id, ok: true, data: { type: 'wait', selector: selector } }); return; }
        } else {
          post({ type: 'agent-result', id: id, ok: true, data: { type: 'wait', ms: ms } });
          return;
        }
      } catch (e) { post({ type: 'agent-result', id: id, ok: false, error: String(e) }); return; }
      if (Date.now() - started > 15000) { post({ type: 'agent-result', id: id, ok: false, error: 'timeout waiting for ' + selector }); return; }
      setTimeout(poll, 100);
    };
    setTimeout(poll, Number(ms) || 0);
  }
  function agentVerifyText(id, text) {
    try {
      var body = document.body && document.body.innerText ? document.body.innerText : '';
      var found = String(text) !== '' && body.indexOf(String(text)) !== -1;
      post({ type: 'agent-result', id: id, ok: true, data: { type: 'verify_text', text: String(text).slice(0, 120), found: found } });
    } catch (e) { agentFail(id, e); }
  }
  // ===== 截图增强：全量样式内联 + 图片转 data URL + 跟随滚动视口 =====
  // foreignObject 用真实渲染引擎（比 html2canvas 更贴原页）；但 data-URL SVG 里
  // 相对路径解析不到、SVG-as-image 又禁外部资源 → CSS 全量内联、图片内联为
  // data URL 后再渲染，样式/布局/图片才能与原页对齐
  function absCss(cssText, base) {
    try {
      // 模板字符串内正则反斜杠必须双写（运行时保留单斜杠）
      return String(cssText).replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/g, function (m, q, u) {
        u = String(u).trim();
        if (!u || /^(data:|blob:|#)/.test(u)) return m;
        try { return 'url(' + q + new URL(u, base).href + q + ')'; }
        catch (e) { return m; }
      });
    } catch (e) { return String(cssText); }
  }
  // 从已绝对化的 CSS 提取 http(s) url() 值（去重）
  function cssAssetUrls(cssText) {
    var out = [];
    var re = /url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/g;
    var m;
    var text = String(cssText);
    while ((m = re.exec(text)) !== null) {
      var u = String(m[2]).trim();
      if (!u || /^(data:|blob:|#)/.test(u)) continue;
      if (u.indexOf('http://') === 0 || u.indexOf('https://') === 0) out.push(u);
    }
    return out;
  }
  // 抓取并转 data URL：预算制（总量超限跳过，避免 SVG 过大）+ 单文件体积上限
  function fetchInline(u, budget, maxBytes) {
    return fetch(u, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw 0;
      return r.blob();
    }).then(function (b) {
      if (!b || !b.size || b.size > maxBytes || budget.used + b.size > budget.max) return null;
      return new Promise(function (res) {
        var fr = new FileReader();
        fr.onload = function () { budget.used += b.size; res({ u: u, d: String(fr.result) }); };
        fr.onerror = function () { res(null); };
        fr.readAsDataURL(b);
      });
    }).catch(function () { return null; });
  }
  function collectPageAssets(done) {
    var css = '';
    var pageBase = pageUrl();
    var i, href, src;
    // 预算：CSS 背景图/字体 + <img> 共用总量上限（data URL 会撑大 SVG）
    var budget = { used: 0, max: 1500000 };
    // 1) CSS 文本：页内 <style>（同步）+ 外链 stylesheet（异步）
    try {
      var styles = document.querySelectorAll('style');
      for (var si = 0; si < styles.length && css.length < 60000; si++) css += absCss(styles[si].textContent, pageBase);
    } catch (e2) { css = ''; }
    var cssPending = [];
    var seenCss = {};
    try {
      var links = document.querySelectorAll('link[rel~="stylesheet"],link[rel~="preload"][as="style"]');
      for (var li = 0; li < links.length; li++) {
        href = links[li].href;
        if (!href || seenCss[href] || /^data:/.test(href)) continue;
        seenCss[href] = 1;
        (function (h) {
          cssPending.push(fetch(h, { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) throw 0;
            return r.text();
          }).then(function (t) { css += '\\n' + absCss(t, h); }).catch(function () {}));
        })(href);
      }
    } catch (e3) {}
    // 2) <img> 转 data URL（SVG-as-image 禁外部资源、相对 src 解析不到）：去重 + 限量
    var imgMap = {};
    var seenImg = {};
    var imgCount = 0;
    var imgPending = [];
    var imgs = document.querySelectorAll('img');
    for (i = 0; i < imgs.length && imgCount < 20; i++) {
      src = imgs[i].getAttribute('src');
      if (!src || /^(data:|blob:)/.test(src) || seenImg[src]) continue;
      seenImg[src] = 1;
      var absImg;
      try { absImg = new URL(src, pageBase).href; } catch (e4) { continue; }
      imgCount += 1;
      (function (uu) {
        imgPending.push(fetchInline(uu, budget, 200000).then(function (it) {
          if (it && it.u && it.d) imgMap[it.u] = it.d;
        }));
      })(absImg);
    }
    // 3) CSS 收集完成后：CSS 内 url() 资产（背景图/字体）也转 data URL 并回填
    Promise.all(cssPending).then(function () {
      var assetPending = [];
      var seenAsset = {};
      var assetCount = 0;
      var urls = cssAssetUrls(css);
      for (i = 0; i < urls.length && assetCount < 40; i++) {
        var u = urls[i];
        if (seenAsset[u]) continue;
        seenAsset[u] = 1;
        assetCount += 1;
        (function (uu) {
          assetPending.push(fetchInline(uu, budget, 400000).then(function (it) {
            if (it && it.u && it.d) {
              css = css.split('url(' + it.u + ')').join('url("' + it.d + '")')
                .split("url('" + it.u + "')").join('url("' + it.d + '")')
                .split('url("' + it.u + '")').join('url("' + it.d + '")');
            }
          }));
        })(u);
      }
      return Promise.all(assetPending);
    }).then(function () {
      return Promise.all(imgPending);
    }).then(function () {
      done(css, imgMap);
    });
  }
  function absolutizeDocHtml(html, base, imgMap) {
    try {
      var d = new DOMParser().parseFromString(html, 'text/html');
      var i, s, parts;
      var imgs = d.querySelectorAll('img');
      for (i = 0; i < imgs.length; i++) {
        s = imgs[i].getAttribute('src');
        if (s && !/^(data:|blob:)/.test(s)) {
          var abs;
          try { abs = new URL(s, base).href; } catch (e) { abs = s; }
          imgs[i].setAttribute('src', imgMap[abs] || abs);
          var srcset = imgs[i].getAttribute('srcset');
          if (srcset) {
            parts = srcset.split(',').map(function (p) {
              var t = p.trim().split(/\\s+/);
              if (!t[0]) return p;
              try { t[0] = imgMap[new URL(t[0], base).href] || new URL(t[0], base).href; } catch (e2) {}
              return t.join(' ');
            });
            imgs[i].setAttribute('srcset', parts.join(', '));
          }
        }
      }
      var srcs = d.querySelectorAll('video,source');
      for (i = 0; i < srcs.length; i++) {
        s = srcs[i].getAttribute('src');
        if (s && !/^(data:|blob:)/.test(s)) { try { srcs[i].setAttribute('src', new URL(s, base).href); } catch (e3) {} }
      }
      return d.documentElement ? d.documentElement.outerHTML : html;
    } catch (e) { return html; }
  }
  // 页面有效背景色（html/body 计算样式 → 默认白）：防透明区域转 JPEG 时变黑
  function pageBg() {
    var pick = function (el) {
      try {
        var c = el && getComputedStyle(el).backgroundColor;
        if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c;
      } catch (e) { /* ignore */ }
      return '';
    };
    var c = pick(document.documentElement);
    if (c) return c;
    c = pick(document.body);
    return c || '#ffffff';
  }
  // 截图（省 token）：JPEG 0.6 + 视口限制；真实引擎快照 + 全量样式 + 图片内联 + 跟随当前滚动位置
  // base64 只回传给 host 存文件，不进对话（browser_take_screenshot 返回文件路径/URL）
  function agentScreenshot(id) {
    try {
      var w = Math.min(window.innerWidth, 1280);
      var h = Math.min(window.innerHeight, 900);
      var sx = Math.round(window.scrollX || 0);
      var sy = Math.round(window.scrollY || 0);
      var docHtml = document.documentElement ? document.documentElement.outerHTML : '';
      collectPageAssets(function (css, imgMap) {
        try {
          var xhtml = absolutizeDocHtml(docHtml, pageUrl(), imgMap);
          xhtml = new XMLSerializer().serializeToString(new DOMParser().parseFromString(xhtml, 'text/html'));
          var docW = Math.max(document.documentElement ? document.documentElement.scrollWidth : 0, w);
          var docH = Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, h);
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">'
            + '<style>' + css + '</style>'
            + '<g transform="translate(' + (-sx) + ',' + (-sy) + ')">'
            + '<foreignObject width="' + docW + '" height="' + docH + '"><div xmlns="http://www.w3.org/1999/xhtml">' + xhtml + '</div></foreignObject></g></svg>';
          var svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var img = new Image();
          img.onload = function () {
            try {
              var ctx2 = canvas.getContext('2d');
              // 先铺页面背景色（默认白），再画快照——否则 SVG 透明区转 JPEG 变黑
              ctx2.fillStyle = pageBg();
              ctx2.fillRect(0, 0, w, h);
              ctx2.drawImage(img, 0, 0);
              var url = canvas.toDataURL('image/jpeg', 0.6);
              post({ type: 'agent-result', id: id, ok: true, data: { type: 'screenshot', url: url } });
            } catch (e3) { agentFail(id, e3); }
          };
          img.onerror = function () { agentFail(id, 'svg render failed'); };
          img.src = svgUrl;
        } catch (e4) { agentFail(id, e4); }
      });
    } catch (e) { agentFail(id, e); }
  }


  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseover', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', function (event) {
    if (inspectOn) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function () {
    var r = origPush.apply(this, arguments);
    post(pageInfo());
    return r;
  };
  history.replaceState = function () {
    var r = origReplace.apply(this, arguments);
    post(pageInfo());
    return r;
  };
  window.addEventListener('popstate', function () { post(pageInfo()); });
  window.addEventListener('hashchange', function () { post(pageInfo()); });
  window.addEventListener('resize', function () { post(pageInfo()); });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    post({ type: 'ready', url: pageUrl(), title: document.title || '', ua: navigator.userAgent || '', viewport: viewport(), secure: !!window.isSecureContext, cookiesEnabled: navigator.cookieEnabled !== false });
    dumpDevtools();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      post({ type: 'ready', url: pageUrl(), title: document.title || '', ua: navigator.userAgent || '', viewport: viewport(), secure: !!window.isSecureContext, cookiesEnabled: navigator.cookieEnabled !== false });
      dumpDevtools();
    });
  }
})();
`
