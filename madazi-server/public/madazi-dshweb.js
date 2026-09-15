(function() {
  if (window.__madazi_dshweb_installed) return;
  window.__madazi_dshweb_installed = true;
  if (window.top !== window.self) return; // iframe 内不生效

  var HIS_KEY = 'madazi.previewHistory';
  var MAX_HIS = 10;

  var addrInput = null;
  var currentProjectId = null;
  var currentProjectName = null;
  var curRunning = false;
  var enhanced = false;
  var autoOpened = false;
  var dropBtn = null;
  var dropMenu = null;
  var ctlBtn = null;
  var ctlTimer = null;
  var lastAddr = null;

  // ── 工具 ──
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

  function pvPrefixFromUrl(url) {
    var m = (url || '').match(/pv-([a-z0-9]{8})\./);
    return m ? m[1] : null;
  }

  // ── 导航：填地址栏 + Enter（workbench 浏览器地址栏是 React 受控组件） ──
  function navigateTo(url) {
    if (!addrInput) return;
    addHistory(currentProjectName, url, currentProjectId);
    setNativeValue(addrInput, url);
    addrInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    addrInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
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
    fetch('/api/projects/' + pid + '/preview/' + act, { method: 'POST', credentials: 'same-origin' }).then(function(r) { return r.json(); }).then(function() {
      if (ctlTimer) clearTimeout(ctlTimer);
      pollStatus(4, 2500);
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

  // 浏览器 toolbar：含「后退/前进/刷新」的按钮行（排除「刷新文件树」）
  function findBrowserToolbar() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      var ti = btns[i].title || '';
      var aria = btns[i].getAttribute('aria-label') || '';
      if (t.indexOf('后退') >= 0 || ti.indexOf('后退') >= 0 || aria.indexOf('后退') >= 0) {
        var p = btns[i].parentElement;
        if (p && p.querySelector('button')) return p;
      }
    }
    return null;
  }

  function injectCtlBtn() {
    var existing = document.querySelector('.mzi-ctl-btn');
    if (existing) { ctlBtn = existing; return; }
    var toolbar = findBrowserToolbar();
    if (!toolbar) return;
    var btns = toolbar.querySelectorAll('button');
    var refreshBtn = null;
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      var ti = btns[i].title || '';
      var aria = btns[i].getAttribute('aria-label') || '';
      if (t.indexOf('刷新') >= 0 || ti.indexOf('刷新') >= 0 || aria.indexOf('刷新') >= 0 ||
          t.indexOf('重新加载') >= 0 || ti.indexOf('重新加载') >= 0 || aria.indexOf('重新加载') >= 0 ||
          /reload/i.test(ti) || /reload/i.test(aria)) { refreshBtn = btns[i]; break; }
    }
    if (!refreshBtn) return;
    ctlBtn = document.createElement('button');
    ctlBtn.className = 'mzi-ctl-btn';
    ctlBtn.type = 'button';
    ctlBtn.textContent = '停止预览';
    refreshBtn.parentElement.insertBefore(ctlBtn, refreshBtn.nextSibling);
    updateCtlBtn();
  }

  // ── document 级事件委托（React 重渲染安全） ──
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

  // ── CSS（适配 dsh-web 深色主题） ──
  function injectCss() {
    var s = document.createElement('style');
    s.setAttribute('data-madazi', 'dshweb-prev');
    s.textContent = '.mzi-dd-btn{flex:0 0 auto;margin-left:6px;padding:2px 8px;border:1px solid var(--dsw-alias-border,rgba(255,255,255,.14));border-radius:4px;background:var(--dsw-alias-bg-secondary,#2c2c2e);cursor:pointer;font-size:12px;color:var(--dsw-alias-label-primary,#e5e5ea);line-height:1.4}' +
      '.mzi-dd-menu{display:none;position:fixed;z-index:99999;min-width:220px;max-height:320px;overflow-y:auto;background:var(--dsw-surface,#1c1c1e);border:1px solid var(--dsw-alias-border,rgba(255,255,255,.14));border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.5);padding:4px;font-size:12px;color:var(--dsw-alias-label-primary,#e5e5ea)}' +
      '.mzi-dd-menu.mzi-dd-open{display:block}' +
      '.mzi-dd-item{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;cursor:pointer;border-radius:4px;align-items:center}' +
      '.mzi-dd-item:hover{background:var(--dsw-alias-bg-hover,rgba(255,255,255,.08))}' +
      '.mzi-dd-name{color:var(--dsw-alias-label-primary,#e5e5ea);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mzi-dd-url{color:var(--dsw-alias-label-secondary,#9a9aa0);font-size:11px;white-space:nowrap}' +
      '.mzi-dd-empty{padding:8px;color:var(--dsw-alias-label-secondary,#9a9aa0);text-align:center}' +
      '.mzi-ctl-btn{flex:0 0 auto;margin-left:8px;padding:2px 10px;border:1px solid var(--dsw-alias-border,rgba(255,255,255,.14));border-radius:4px;background:var(--dsw-alias-bg-secondary,#2c2c2e);cursor:pointer;font-size:12px;color:var(--dsw-alias-label-primary,#e5e5ea);line-height:1.4}' +
      '.mzi-ctl-btn:hover{border-color:#D4AF37;color:#D4AF37}' +
      '.mzi-ctl-btn:disabled{opacity:.5;cursor:not-allowed}';
    (document.head || document.documentElement).appendChild(s);
  }

  // ── 自动打开：进入工作区后自动点「打开内置浏览器」 ──
  function tryAutoOpen() {
    if (autoOpened) return;
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      var ti = btns[i].title || '';
      if ((t === '打开内置浏览器' || ti.indexOf('内置浏览器') >= 0) && btns[i].offsetParent !== null) {
        var el = btns[i];
        autoOpened = true;
        setTimeout(function() { el.click(); }, 600);
        setTimeout(ensureAddr, 3000);
        return;
      }
    }
  }

  // ── 默认打开第一个项目预览 ──
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

  // ── 地址栏变化 → 反查项目（workbench 浏览器无 iframe，地址栏是唯一真相） ──
  function syncFromAddr() {
    if (!addrInput) return;
    var cur = (addrInput.value || '').trim();
    if (cur === lastAddr) return;
    lastAddr = cur;
    var prefix = pvPrefixFromUrl(cur);
    if (prefix) {
      resolvePid(prefix).then(function(pid) {
        if (pid && pid !== currentProjectId) {
          currentProjectId = pid;
          currentProjectName = null;
          fetchJSON('/api/projects').then(function(list) {
            var arr = list || [];
            for (var j = 0; j < arr.length; j++) {
              if (arr[j].id === pid) { currentProjectName = arr[j].name; break; }
            }
          }).catch(function() {});
        }
        updateCtlBtn();
      });
    }
  }

  // ── 定位增强点 ──
  function locateAndEnhance() {
    if (enhanced) return;
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var ph = (inputs[i].placeholder || '').toLowerCase();
      if (ph.indexOf('输入网址') >= 0 || ph.indexOf('enter a url') >= 0) {
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
    syncFromAddr();
  }

  // ── 主循环 ──
  initDelegation();
  var mo = new MutationObserver(function() {
    locateAndEnhance();
    injectCtlBtn();
    tryAutoOpen();
    syncFromAddr();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  locateAndEnhance();
  tryAutoOpen();
  // 周期性状态兜底（外部停止/超时后按钮不刷新）
  setInterval(function() {
    if (enhanced && ctlBtn && !ctlBtn.disabled) updateCtlBtn();
  }, 20000);
})();
