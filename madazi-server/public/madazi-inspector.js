(function() {
  if (window.__madazi_inspector_installed) return;
  window.__madazi_inspector_installed = true;

  var inspectMode = false;
  var hoveredEl = null;
  var listenersActive = false;
  var styleEl = null;

  // ── 工具函数 ──
  function send(type, data) {
    try { parent.postMessage({ source: '__madazi_preview', type: type, data: data }, '*'); } catch(e) {}
  }
  function sendResponse(id, result) {
    try { parent.postMessage({ source: '__madazi_preview', type: 'rpc-response', id: id, result: result }, '*'); } catch(e) {}
  }

  // ── 优化3: 样式按需注入，inspectMode 关闭时移除 ──
  var STYLE_CSS = '\
    .__mzi_hover { outline: 2px solid #5e6ad2 !important; outline-offset: -2px !important; }\
    .__mzi_selected { outline: 2px solid #f5a623 !important; outline-offset: -2px !important; }\
  ';
  function injectStyles() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-madazi', 'inspector');
    styleEl.textContent = STYLE_CSS;
    (document.head || document.documentElement).appendChild(styleEl);
  }
  function removeStyles() {
    if (styleEl) { styleEl.remove(); styleEl = null; }
  }

  // ── Console 劫持（始终生效，不修改用户逻辑） ──
  ['log', 'warn', 'error', 'info'].forEach(function(method) {
    var orig = console[method];
    console[method] = function() {
      var args = Array.from(arguments).map(function(a) {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(e) { return String(a); }
      });
      send('console', { level: method, args: args.join(' '), time: new Date().toLocaleTimeString() });
      orig.apply(console, arguments);
    };
  });

  // ── fetch 劫持（始终生效） ──
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = (init && init.method) || 'GET';
      var reqBody = '';
      try { reqBody = init && init.body ? (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)) : ''; } catch(e) {}
      var t0 = Date.now();
      return origFetch.apply(this, arguments).then(function(resp) {
        resp.clone().text().then(function(body) {
          send('network', { url: url, method: method, status: resp.status, duration: Date.now() - t0, type: 'fetch', time: new Date().toLocaleTimeString(), reqBody: reqBody.slice(0, 2000), resBody: body.slice(0, 2000) });
        }).catch(function(){});
        return resp;
      }).catch(function(err) {
        send('network', { url: url, method: method, status: 0, duration: Date.now() - t0, type: 'fetch', error: err.message, time: new Date().toLocaleTimeString(), reqBody: reqBody.slice(0, 2000), resBody: '' });
        throw err;
      });
    };
  }

  // ── XHR 劫持（始终生效） ──
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__method = method; this.__url = url; this.__t0 = Date.now();
    origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    var self = this;
    var reqBody = '';
    try { reqBody = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : ''; } catch(e) {}
    this.__reqBody = reqBody.slice(0, 2000);
    this.addEventListener('loadend', function() {
      var resBody = '';
      try { resBody = self.responseText ? self.responseText.slice(0, 2000) : ''; } catch(e) {}
      send('network', { url: self.__url, method: self.__method, status: self.status, duration: Date.now() - self.__t0, type: 'xhr', time: new Date().toLocaleTimeString(), reqBody: self.__reqBody, resBody: resBody });
    });
    origSend.apply(this, arguments);
  };

  // ── 错误捕获（始终生效） ──
  window.addEventListener('error', function(e) {
    send('console', { level: 'error', args: (e.message || 'Error') + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : ''), time: new Date().toLocaleTimeString() });
  });
  window.addEventListener('unhandledrejection', function(e) {
    send('console', { level: 'error', args: 'Unhandled Promise: ' + (e.reason && e.reason.message || e.reason || ''), time: new Date().toLocaleTimeString() });
  });

  // ── 优化2: 事件监听器动态添加/移除，非审查模式零开销 ──
  function blockEvent(e) {
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
  }

  function onMouseMove(e) {
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    var el = e.target;
    if (hoveredEl && hoveredEl !== el) hoveredEl.classList.remove('__mzi_hover');
    hoveredEl = el;
    el.classList.add('__mzi_hover');
  }

  function onClick(e) {
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    var el = e.target;
    document.querySelectorAll('.__mzi_selected').forEach(function(n) { n.classList.remove('__mzi_selected'); });
    el.classList.add('__mzi_selected');
    var tag = el.tagName.toLowerCase();
    var id = el.id || '';
    var className = typeof el.className === 'string' ? el.className : '';
    var selector = tag;
    if (id) selector += '#' + id;
    if (className) selector += '.' + className.split(/\s+/).filter(Boolean).join('.');
    var outerHTML = el.outerHTML.slice(0, 500);
    var path = [];
    var node = el;
    while (node && node !== document.body) {
      var sib = Array.from(node.parentNode.children);
      var idx = sib.indexOf(node);
      path.unshift({ tag: node.tagName.toLowerCase(), idx: idx, id: node.id || '', className: typeof node.className === 'string' ? node.className : '' });
      node = node.parentNode;
    }
    send('inspect-element', { tag: tag, id: id, className: className, outerHTML: outerHTML, selector: selector, path: path });
  }

  // 优化1: 删除 <a target> 点击拦截，sandbox 已阻止 _top/_parent 逃逸

  var EVENT_MAP = {
    mousemove: onMouseMove,
    mousedown: blockEvent,
    mouseup: blockEvent,
    click: onClick,
    pointerdown: blockEvent,
    pointerup: blockEvent,
    dblclick: blockEvent,
  };

  function addListeners() {
    if (listenersActive) return;
    Object.keys(EVENT_MAP).forEach(function(evt) {
      document.addEventListener(evt, EVENT_MAP[evt], true);
    });
    listenersActive = true;
  }
  function removeListeners() {
    if (!listenersActive) return;
    Object.keys(EVENT_MAP).forEach(function(evt) {
      document.removeEventListener(evt, EVENT_MAP[evt], true);
    });
    listenersActive = false;
  }

  // ── inspectMode 控制 ──
  function setInspectMode(on) {
    inspectMode = on;
    if (!on) {
      document.querySelectorAll('.__mzi_hover, .__mzi_selected').forEach(function(n) {
        n.classList.remove('__mzi_hover'); n.classList.remove('__mzi_selected');
      });
      hoveredEl = null;
      if (document.body) document.body.style.cursor = '';
      removeListeners();
      removeStyles();
    } else {
      if (document.body) document.body.style.cursor = 'crosshair';
      injectStyles();
      addListeners();
    }
  }

  // ── DOM 树序列化（RPC） ──
  function serializeDom(el, maxDepth, depth) {
    depth = depth || 0;
    if (maxDepth && depth > maxDepth) return null;
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      attrs[el.attributes[i].name] = el.attributes[i].value;
    }
    var children = [];
    for (var j = 0; j < el.children.length; j++) {
      var child = el.children[j];
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
      var serialized = serializeDom(child, maxDepth, depth + 1);
      if (serialized) children.push(serialized);
    }
    return {
      tag: el.tagName.toLowerCase(),
      attrs: attrs,
      children: children,
      text: el.textContent ? el.textContent.slice(0, 50) : '',
      childCount: el.children.length,
    };
  }

  // ── 元素计算样式（RPC） ──
  function getStyles(path) {
    var el = resolveElement(path);
    if (!el) return [];
    var computed = window.getComputedStyle(el);
    var KEY = ['display','position','width','height','margin','padding','border','color','background-color','font-size','font-weight','flex-direction','justify-content','align-items','gap','text-align','line-height','border-radius','opacity','overflow','z-index'];
    var result = [];
    for (var i = 0; i < KEY.length; i++) {
      var val = computed.getPropertyValue(KEY[i]);
      if (val && val !== 'initial' && val !== 'normal' && val !== 'none' && val !== 'auto') {
        result.push([KEY[i], val]);
      }
    }
    var attrs = [];
    for (var j = 0; j < el.attributes.length; j++) {
      attrs.push(['@' + el.attributes[j].name, el.attributes[j].value]);
    }
    return attrs.concat(result);
  }

  // ── 通过 path 解析元素 ──
  function resolveElement(path) {
    var node = document.body;
    for (var i = 0; i < path.length; i++) {
      var step = path[i];
      var children = node.children;
      if (step.idx < children.length) {
        node = children[step.idx];
      } else {
        return null;
      }
    }
    return node;
  }

  // ── hover 高亮 overlay（RPC，DOM 树节点 hover 时调用） ──
  function highlightElement(path) {
    var el = resolveElement(path);
    if (hoveredEl && hoveredEl !== el) hoveredEl.classList.remove('__mzi_hover');
    if (el) {
      el.classList.add('__mzi_hover');
      hoveredEl = el;
    }
  }
  function clearHighlight() {
    if (hoveredEl) { hoveredEl.classList.remove('__mzi_hover'); hoveredEl = null; }
  }

  // ── 获取元素完整详情（用于"添加到对话"） ──
  function cleanHTML(html) {
    return html.replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim()
      .slice(0, 800);
  }
  function buildSelector(el) {
    var tag = el.tagName.toLowerCase();
    var id = el.id || '';
    var cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    var s = tag;
    if (id) s += '#' + id;
    if (cls) s += '.' + cls;
    return s;
  }
  function buildDomPath(el) {
    var parts = [];
    var node = el;
    var count = 0;
    while (node && node !== document.body && count < 6) {
      parts.unshift(buildSelector(node));
      node = node.parentElement;
      count++;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }
  function getElementDetails(path) {
    var el = resolveElement(path);
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    // 精选计算样式
    var computed = window.getComputedStyle(el);
    var STYLE_KEYS = ['display','position','width','height','margin','padding','border','color','background-color','font-size','font-weight','flex-direction','justify-content','align-items','gap','text-align','line-height','border-radius','overflow','z-index'];
    var styles = [];
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var val = computed.getPropertyValue(STYLE_KEYS[i]);
      if (val && val !== 'initial' && val !== 'normal' && val !== 'none' && val !== 'auto') {
        styles.push(STYLE_KEYS[i] + ': ' + val);
      }
    }
    // 父元素上下文（2层）
    var parentHTML = '';
    var parent = el.parentElement;
    if (parent && parent !== document.body) {
      var grandparent = parent.parentElement;
      if (grandparent && grandparent !== document.body) {
        parentHTML = cleanHTML(grandparent.outerHTML).replace(cleanHTML(parent.outerHTML), '[...]\n  ' + cleanHTML(parent.outerHTML));
      } else {
        parentHTML = cleanHTML(parent.outerHTML);
      }
      // 标记选中元素位置
      var selector = buildSelector(el);
      parentHTML = parentHTML.replace(cleanHTML(el.outerHTML), '[SELECTED] ' + selector);
    }
    // 文本内容
    var textContent = (el.textContent || '').trim().slice(0, 100);
    return {
      selector: buildSelector(el),
      domPath: buildDomPath(el),
      outerHTML: cleanHTML(el.outerHTML),
      textContent: textContent,
      styles: styles,
      rect: { width: Math.round(rect.width), height: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) },
      parentHTML: parentHTML,
    };
  }

  // ── 消息处理（RPC + 推送控制） ──
  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg || msg.source !== '__madazi_parent') return;

    switch (msg.type) {
      case 'inspect-mode':
        setInspectMode(msg.action === 'enable');
        break;
      case 'rpc':
        var result;
        switch (msg.method) {
          case 'get-dom-tree':
            result = serializeDom(document.body, 10);
            break;
          case 'get-styles':
            result = getStyles(msg.params.path);
            break;
          case 'highlight':
            highlightElement(msg.params.path);
            result = true;
            break;
          case 'clear-highlight':
            clearHighlight();
            result = true;
            break;
          case 'scroll-to':
            var el = resolveElement(msg.params.path);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            result = true;
            break;
          case 'get-element-details':
            result = getElementDetails(msg.params.path);
            break;
          default:
            result = null;
        }
        sendResponse(msg.id, result);
        break;
    }
  });

  // ── 通知父页面 inspector 已就绪（重试直到父页面响应） ──
  var readyAttempts = 0;
  var readyTimer = setInterval(function() {
    send('inspector-ready', {});
    readyAttempts++;
    if (readyAttempts > 20) clearInterval(readyTimer);
  }, 500);
  // 收到父页面任何消息说明已连接，停止重试
  window.addEventListener('message', function readyCheck(e) {
    if (e.data && e.data.source === '__madazi_parent') {
      clearInterval(readyTimer);
      window.removeEventListener('message', readyCheck);
    }
  });
})();

// ── 预览增强（S6.5）：地址栏项目历史下拉 + 启停按钮 + 自动打开预览 ──
// 宿主 = 官方预览视图（地址栏「输入地址，回车导航…」+ 刷新预览按钮）。
// 本脚本经 nginx sub_filter 注入主站与 pv 子域；仅主站（window.top===self）生效，pv iframe 内自动跳过。
(function() {
  if (window.__madazi_prev_enh_installed) return;
  window.__madazi_prev_enh_installed = true;
  if (window.top !== window.self) return; // pv iframe 内不生效

  var HIS_KEY = 'madazi.previewHistory';
  var MAX_HIS = 10;

  var addrInput = null;
  var iframeEl = null;
  var currentProjectId = null;
  var currentProjectName = null;
  var curRunning = false;
  var enhanced = false;
  var autoOpened = false;
  var dropBtn = null;
  var dropMenu = null;
  var ctlBtn = null;
  var lastIframeSrc = null;
  var syncTimer = null;
  var ctlTimer = null;

  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function(r) { return r.json(); });
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HIS_KEY) || '[]'); } catch (e) { return []; }
  }

  function addHistory(name, url, pid) {
    var h = getHistory().filter(function(x) { return x.url !== url; });
    h.unshift({ name: name || '项目', url: url, pid: pid || null, t: Date.now() });
    if (h.length > MAX_HIS) h = h.slice(0, MAX_HIS);
    try { localStorage.setItem(HIS_KEY, JSON.stringify(h)); } catch (e) {}
  }

  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function resolvePid(prefix) {
    return fetchJSON('/api/projects').then(function(list) {
      var arr = list || [];
      for (var i = 0; i < arr.length; i++) {
        if ((arr[i].id || '').slice(0, 8) === prefix) return arr[i].id;
      }
      return null;
    }).catch(function() { return null; });
  }

  function navigateTo(url) {
    if (!addrInput) return;
    addHistory(currentProjectName, url, currentProjectId);
    setNativeValue(addrInput, url);
    addrInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    addrInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    if (iframeEl) {
      setTimeout(function() { if (iframeEl && iframeEl.src !== url) iframeEl.src = url; }, 400);
    }
  }

  // ── 启停按钮 ──
  function updateCtlBtn() {
    if (!ctlBtn) return;
    if (!currentProjectId) {
      ctlBtn.textContent = '停止预览';
      ctlBtn.disabled = true;
      ctlBtn.title = '未识别预览项目';
      return;
    }
    fetchJSON('/api/projects/' + currentProjectId + '/preview/status').then(function(s) {
      curRunning = !!(s && s.running);
      ctlBtn.textContent = curRunning ? '停止预览' : '启动预览';
      ctlBtn.disabled = false;
      ctlBtn.title = curRunning ? '停止当前预览' : '启动当前项目预览';
    }).catch(function() {
      ctlBtn.disabled = true;
      ctlBtn.textContent = '…';
    });
  }

  function togglePreview() {
    var pid = currentProjectId;
    var btn = document.querySelector('.mzi-ctl-btn');
    if (!pid || !btn || btn.disabled) return;
    var act = curRunning ? 'stop' : 'start';
    btn.disabled = true;
    btn.textContent = act === 'stop' ? '停止中…' : '启动中…';
    if (act === 'stop' && iframeEl) iframeEl.src = 'about:blank';
    fetch('/api/projects/' + pid + '/preview/' + act, { method: 'POST', credentials: 'same-origin' }).then(function(r) { return r.json(); }).then(function() {
      if (ctlTimer) clearTimeout(ctlTimer);
      pollStatus(4, 2500); // 预览启停异步，多轮拉取确保按钮状态同步
    }).catch(function() {
      updateCtlBtn();
    });
  }

  function pollStatus(times, delay) {
    if (times <= 0) return;
    if (ctlTimer) clearTimeout(ctlTimer);
    ctlTimer = setTimeout(function() {
      updateCtlBtn();
      pollStatus(times - 1, delay);
    }, delay);
  }

  // ── 地址栏右侧下拉 ──
  function renderDropdown() {
    if (!dropMenu) return;
    fetchJSON('/api/projects').then(function(list) {
      var arr = list || [];
      var h = getHistory();
      var merged = [];
      var seen = {};
      for (var i = 0; i < h.length; i++) {
        var x = h[i];
        if (!seen[x.url]) { seen[x.url] = 1; merged.push({ name: x.name, url: x.url, pid: x.pid, hist: true }); }
      }
      for (var j = 0; j < arr.length; j++) {
        var p = arr[j];
        var url = 'https://pv-' + (p.id || '').slice(0, 8) + '.<YOUR-DOMAIN>.com';
        if (!seen[url]) { seen[url] = 1; merged.push({ name: p.name, url: url, pid: p.id }); }
      }
      dropMenu.textContent = '';
      if (!merged.length) {
        var em = document.createElement('div');
        em.className = 'mzi-dd-empty';
        em.textContent = '暂无项目';
        dropMenu.appendChild(em);
        return;
      }
      for (var k = 0; k < merged.length; k++) {
        var it = merged[k];
        var d = document.createElement('div');
        d.className = 'mzi-dd-item';
        d.title = it.url;
        d.setAttribute('data-name', it.name || '');
        d.setAttribute('data-url', it.url);
        d.setAttribute('data-pid', it.pid || '');
        var n = document.createElement('span');
        n.className = 'mzi-dd-name';
        n.textContent = it.name;
        var u = document.createElement('span');
        u.className = 'mzi-dd-url';
        u.textContent = it.url.replace(/^https:\/\/pv-/, '').replace(/\.<YOUR-DOMAIN>\.com$/, '');
        d.appendChild(n);
        d.appendChild(u);
        dropMenu.appendChild(d);
      }
    }).catch(function() {});
  }

  function toggleMenu() {
    var menu = document.querySelector('.mzi-dd-menu');
    var btn = document.querySelector('.mzi-dd-btn');
    if (!menu || !btn) return;
    dropMenu = menu; dropBtn = btn;
    var open = menu.classList.toggle('mzi-dd-open');
    if (open) {
      var r = btn.getBoundingClientRect();
      menu.style.top = (r.bottom + 4) + 'px';
      menu.style.left = Math.max(4, r.left - 180 + r.width) + 'px';
      renderDropdown();
    }
  }

  function hideDropdown() { if (dropMenu) dropMenu.classList.remove('mzi-dd-open'); }

  // ── 注入 ──
  function injectDropdown(inp) {
    var wrap = inp.parentElement;
    if (!wrap || wrap.querySelector('.mzi-dd-btn')) return;
    dropBtn = document.createElement('button');
    dropBtn.className = 'mzi-dd-btn';
    dropBtn.type = 'button';
    dropBtn.textContent = '▾';
    dropBtn.title = '项目预览历史';
    wrap.insertBefore(dropBtn, inp.nextSibling);
    dropMenu = document.createElement('div');
    dropMenu.className = 'mzi-dd-menu';
    document.body.appendChild(dropMenu);
  }

  function injectCtlBtn() {
    var existing = document.querySelector('.mzi-ctl-btn');
    if (existing) { ctlBtn = existing; return; }
    var btns = document.querySelectorAll('button');
    var refreshBtn = null;
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      var ti = btns[i].title || '';
      var aria = btns[i].getAttribute('aria-label') || '';
      if (t.indexOf('刷新') >= 0 || ti.indexOf('刷新') >= 0 || aria.indexOf('刷新') >= 0) { refreshBtn = btns[i]; break; }
    }
    if (!refreshBtn) return;
    ctlBtn = document.createElement('button');
    ctlBtn.className = 'mzi-ctl-btn';
    ctlBtn.type = 'button';
    ctlBtn.textContent = '停止预览';
    refreshBtn.parentElement.insertBefore(ctlBtn, refreshBtn.nextSibling);
    updateCtlBtn();
  }

  // ── document 级事件委托：官方 React 重渲染会替换注入节点导致直绑监听丢失 ──
  function initDelegation() {
    document.addEventListener('click', function(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.mzi-ctl-btn')) { togglePreview(); return; }
      if (t.closest('.mzi-dd-btn')) { e.stopPropagation(); toggleMenu(); return; }
      var it = t.closest('.mzi-dd-item');
      if (it) {
        var url = it.getAttribute('data-url');
        if (url) {
          addHistory(it.getAttribute('data-name') || '', url, it.getAttribute('data-pid') || currentProjectId);
          if (it.getAttribute('data-pid')) currentProjectId = it.getAttribute('data-pid');
          navigateTo(url);
          hideDropdown();
        }
        return;
      }
      if (dropMenu && dropMenu.classList.contains('mzi-dd-open') && !dropMenu.contains(t)) hideDropdown();
    });
  }

  function injectCss() {
    var s = document.createElement('style');
    s.setAttribute('data-madazi', 'prev-enh');
    s.textContent = '.mzi-dd-btn{flex:0 0 auto;margin-left:6px;padding:2px 8px;border:1px solid #d0d7de;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;color:#333;line-height:1.4}' +
      '.mzi-dd-menu{display:none;position:fixed;z-index:99999;min-width:220px;max-height:320px;overflow-y:auto;background:#fff;border:1px solid #d0d7de;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:4px;font-size:12px}' +
      '.mzi-dd-menu.mzi-dd-open{display:block}' +
      '.mzi-dd-item{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;align-items:center}' +
      '.mzi-dd-item:hover{background:#f0f2f5}' +
      '.mzi-dd-name{color:#333;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mzi-dd-url{color:#888;font-size:11px;white-space:nowrap}' +
      '.mzi-dd-empty{padding:8px;color:#888;text-align:center}' +
      '.mzi-ctl-btn{flex:0 0 auto;margin-left:8px;padding:2px 10px;border:1px solid #d0d7de;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;color:#333;line-height:1.4}' +
      '.mzi-ctl-btn:hover{border-color:#5e6ad2;color:#5e6ad2}' +
      '.mzi-ctl-btn:disabled{opacity:.5;cursor:not-allowed}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── 自动打开：进入工作区后自动点「预览」 ──
  function tryAutoOpen() {
    if (autoOpened) return;
    var btns = document.querySelectorAll('button, [role="tab"]');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      if (t === '预览' && btns[i].offsetParent !== null) {
        var el = btns[i];
        autoOpened = true;
        setTimeout(function() { el.click(); }, 600);
        setTimeout(ensureAddr, 3000);
        return;
      }
    }
  }

  function ensureAddr() {
    if (!addrInput) return;
    var cur = (addrInput.value || '').trim();
    if (cur) return;
    fetchJSON('/api/projects').then(function(list) {
      var p = (list || [])[0];
      if (p) {
        currentProjectId = p.id;
        currentProjectName = p.name;
        navigateTo('https://pv-' + p.id.slice(0, 8) + '.<YOUR-DOMAIN>.com');
        updateCtlBtn();
      }
    }).catch(function() {});
  }

  // ── 定位增强点 + 状态同步 ──
  function locateAndEnhance() {
    if (enhanced) return;
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var ph = (inputs[i].placeholder || '').toLowerCase();
      if (ph.indexOf('输入地址') >= 0 || ph.indexOf('回车导航') >= 0) {
        addrInput = inputs[i];
        break;
      }
    }
    if (!addrInput) return;
    injectCss();
    injectDropdown(addrInput);
    injectCtlBtn();
    enhanced = true;
    updateCtlBtn();
  }

  function syncFromIframe() {
    var ifr = iframeEl;
    if (!ifr) return;
    var src = ifr.src || '';
    if (src === lastIframeSrc) return;
    lastIframeSrc = src;
    var m = src.match(/pv-([a-z0-9]{8})\./);
    if (m) {
      resolvePid(m[1]).then(function(pid) {
        if (pid) {
          currentProjectId = pid;
          currentProjectName = null;
          fetchJSON('/api/projects').then(function(list) {
            var arr = list || [];
            for (var j = 0; j < arr.length; j++) {
              if (arr[j].id === pid) { currentProjectName = arr[j].name; break; }
            }
          }).catch(function() {});
          updateCtlBtn(); // 无条件刷新（修复注入时未识别项目导致按钮 disabled）
        }
      });
    }
  }

  function scheduleSync() {
    if (syncTimer) return;
    syncTimer = setTimeout(function() {
      syncTimer = null;
      var ifr = null;
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        var s = frames[i].src || '';
        if (s.indexOf('pv-') >= 0) { ifr = frames[i]; break; }
      }
      if (ifr !== iframeEl) { iframeEl = ifr; lastIframeSrc = null; }
      if (iframeEl) syncFromIframe();
    }, 300);
  }

  // ── 主循环 ──
  initDelegation(); // document 级委托只注册一次
  var mo = new MutationObserver(function() {
    locateAndEnhance();
    injectCtlBtn(); // 预览 toolbar 渲染较晚，每次变化都尝试（ctlBtn 存在则直接跳过）
    scheduleSync();
    tryAutoOpen();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 立即尝试一次（脚本可能晚于 DOM 注入）
  locateAndEnhance();
  scheduleSync();
  tryAutoOpen();
})();
