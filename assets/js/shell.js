/*
 * Fedget shell
 * 全ページ共通のレイアウトを構築する。
 *   - トップバー (通知エリア): 機能名 / 最新ステップ / 経過時間 / 進捗 / 通知履歴
 *   - サイドバー: config/menu.yaml から生成する折りたたみ式の階層メニュー
 *   - Fedget.task / Fedget.notify: 各ツールから状態をトップバーに通知する API
 *
 * ページ側の規約:
 *   <title> に機能名を書く (ウィンドウ名とトップバーに使う)
 *   <body data-root=".."> にサイトルートへの相対パスを書く
 *   本文は <main> の中に書く
 */
(function (global) {
  'use strict';

  const F = global.Fedget;
  const { el } = F;
  const APP_NAME = 'Fedget Utils';

  // config/menu.yaml を読めない (file:// で開いた等) 場合の最終フォールバック
  const BUILTIN_MENU = {
    title: APP_NAME,
    items: [
      { label: 'メインメニュー', icon: '🏠', href: 'index.html' },
      {
        label: 'セキュリティ', icon: '🔐', children: [
          { label: 'パスワード生成', icon: '🔑', href: 'tools/password.html' },
          { label: 'ハッシュ計算', icon: '🧮', href: 'tools/hash.html' },
          { label: '暗号化キー生成', icon: '🗝️', href: 'tools/keygen.html' },
        ],
      },
      {
        label: '変換', icon: '🔄', children: [
          { label: '画像貼付け→ファイル', icon: '🖼️', href: 'tools/image-paste.html' },
          { label: 'Web Snapshot', icon: '📸', href: 'tools/web-snapshot.html' },
          { label: 'Blog Snapshot', icon: '📝', href: 'tools/blog-snapshot.html' },
        ],
      },
    ],
  };

  const rootUrl = new URL((document.body.dataset.root || '.').replace(/\/?$/, '/'), location.href);
  const featureName = (document.title || APP_NAME).trim();
  F.rootUrl = rootUrl;
  F.featureName = featureName;

  // =====================================================================
  // レイアウト構築
  // =====================================================================
  const main = document.querySelector('main') || el('main');
  main.classList.add('fg-main');
  main.id = main.id || 'fg-main';

  const ui = {};
  ui.toggle = el('button', { class: 'fg-icon-btn fg-sidebar-toggle', type: 'button', title: 'メニューの開閉', 'aria-label': 'メニューの開閉', 'aria-controls': 'fg-sidebar' }, '☰');
  ui.featureIcon = el('span', { class: 'fg-feature-icon', 'aria-hidden': 'true' });
  ui.featureName = el('h1', { class: 'fg-feature-name' }, featureName);
  ui.indicator = el('span', { class: 'fg-indicator', 'data-state': 'idle', 'aria-hidden': 'true' });
  ui.statusText = el('span', { class: 'fg-status-text' }, '待機中');
  ui.status = el('div', { class: 'fg-status', role: 'status', 'aria-live': 'polite' }, ui.indicator, ui.statusText);
  ui.elapsed = el('div', { class: 'fg-elapsed', title: '経過時間' }, '--:--.-');
  ui.badge = el('span', { class: 'fg-badge', hidden: true });
  ui.logBtn = el('button', { class: 'fg-icon-btn fg-log-toggle', type: 'button', title: '通知履歴', 'aria-label': '通知履歴', 'aria-expanded': 'false' }, '🔔', ui.badge);
  ui.progressBar = el('div', { class: 'fg-progress-bar' });
  ui.progress = el('div', { class: 'fg-progress', hidden: true }, ui.progressBar);
  ui.logList = el('ol', { class: 'fg-log-list' });
  ui.logPanel = el('div', { class: 'fg-log-panel', hidden: true },
    el('div', { class: 'fg-log-head' }, el('strong', null, '通知履歴'),
      el('button', { class: 'fg-link-btn', type: 'button', onclick: () => clearLog() }, 'クリア')),
    ui.logList);

  const topbar = el('header', { class: 'fg-topbar' },
    ui.toggle,
    el('div', { class: 'fg-feature' }, ui.featureIcon, ui.featureName),
    ui.status,
    ui.elapsed,
    ui.logBtn,
    ui.progress,
    ui.logPanel);

  ui.search = el('input', { class: 'fg-menu-search', type: 'search', placeholder: '機能を検索…', 'aria-label': '機能を検索' });
  ui.menu = el('ul', { class: 'fg-menu', role: 'tree' });
  ui.menuSource = el('span', { class: 'fg-menu-source' });
  ui.importInput = el('input', { type: 'file', accept: '.yaml,.yml,text/yaml', hidden: true });
  ui.sidebar = el('nav', { class: 'fg-sidebar', id: 'fg-sidebar', 'aria-label': '機能メニュー' },
    el('div', { class: 'fg-sidebar-head' },
      el('a', { class: 'fg-brand', href: new URL('index.html', rootUrl).href }, el('span', { class: 'fg-brand-mark' }, 'F'), el('span', { class: 'fg-brand-text' }, APP_NAME)),
      ui.search),
    ui.menu,
    el('div', { class: 'fg-sidebar-foot' },
      ui.menuSource,
      el('div', { class: 'fg-sidebar-actions' },
        el('button', { class: 'fg-link-btn', type: 'button', title: 'config/menu.yaml を再読込', onclick: () => loadMenu(true) }, '再読込'),
        el('button', { class: 'fg-link-btn', type: 'button', title: 'menu.yaml ファイルを選んで読み込む (file:// で開いている場合用)', onclick: () => ui.importInput.click() }, 'YAML読込')),
      ui.importInput));
  ui.scrim = el('div', { class: 'fg-scrim', hidden: true });

  const layout = el('div', { class: 'fg-layout' }, ui.sidebar, ui.scrim);
  main.replaceWith(layout);
  layout.append(main);
  document.body.prepend(topbar);
  document.body.classList.add('fg-app');

  // =====================================================================
  // サイドバー開閉
  // =====================================================================
  const mqMobile = global.matchMedia('(max-width: 760px)');
  function applySidebarState() {
    const collapsed = F.store.get('ui.sidebarCollapsed', false);
    const mobileOpen = document.body.classList.contains('fg-sidebar-mobile-open');
    document.body.classList.toggle('fg-sidebar-collapsed', !mqMobile.matches && collapsed);
    ui.scrim.hidden = !(mqMobile.matches && mobileOpen);
    ui.toggle.setAttribute('aria-expanded', String(mqMobile.matches ? mobileOpen : !collapsed));
  }
  ui.toggle.addEventListener('click', () => {
    if (mqMobile.matches) document.body.classList.toggle('fg-sidebar-mobile-open');
    else F.store.set('ui.sidebarCollapsed', !F.store.get('ui.sidebarCollapsed', false));
    applySidebarState();
  });
  ui.scrim.addEventListener('click', () => { document.body.classList.remove('fg-sidebar-mobile-open'); applySidebarState(); });
  mqMobile.addEventListener('change', applySidebarState);
  applySidebarState();

  // =====================================================================
  // メニュー
  // =====================================================================
  const menuState = { data: null, source: null, error: null };
  const openGroups = F.store.get('ui.menuOpen', {});

  function normalizeHref(u) {
    const x = new URL(u, location.href);
    x.hash = ''; x.search = '';
    if (x.pathname.endsWith('/')) x.pathname += 'index.html';
    return x.href;
  }
  const here = normalizeHref(location.href);

  function normalizeItems(items, parentPath) {
    if (!Array.isArray(items)) return [];
    return items.filter(it => it && typeof it === 'object' && !it.hidden).map((it, i) => {
      const label = String(it.label ?? it.name ?? `項目${i + 1}`);
      const path = parentPath ? parentPath + ' / ' + label : label;
      const node = {
        label, path,
        icon: it.icon ? String(it.icon) : '',
        description: it.description ? String(it.description) : '',
        href: it.href ? new URL(String(it.href), rootUrl).href : null,
        external: !!it.external,
        collapsed: !!it.collapsed,
        children: normalizeItems(it.children || it.items, path),
      };
      node.active = !!node.href && normalizeHref(node.href) === here;
      node.containsActive = node.active || node.children.some(c => c.containsActive);
      return node;
    });
  }

  function findActive(nodes) {
    for (const n of nodes) {
      if (n.active) return n;
      const c = findActive(n.children);
      if (c) return c;
    }
    return null;
  }

  function renderMenu() {
    const nodes = menuState.nodes || [];
    const q = ui.search.value.trim().toLowerCase();
    ui.menu.textContent = '';

    function matches(n) {
      return !q || n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q) || n.children.some(matches);
    }

    function build(n, depth) {
      if (!matches(n)) return null;
      const hasChildren = n.children.length > 0;
      const li = el('li', { class: 'fg-menu-item', role: 'treeitem', style: `--depth:${depth}` });
      const icon = el('span', { class: 'fg-menu-icon', 'aria-hidden': 'true' }, n.icon || (hasChildren ? '▸' : '•'));
      const text = el('span', { class: 'fg-menu-label' }, n.label);
      let row;
      if (n.href) {
        row = el('a', {
          class: 'fg-menu-link' + (n.active ? ' is-active' : ''),
          href: n.href, title: n.description || n.label,
          target: n.external ? '_blank' : null, rel: n.external ? 'noopener' : null,
          'aria-current': n.active ? 'page' : null,
        }, icon, text);
      } else {
        row = el('button', { class: 'fg-menu-link fg-menu-group', type: 'button', title: n.label }, icon, text);
      }
      li.append(row);

      if (hasChildren) {
        const stored = openGroups[n.path];
        const open = q ? true : (stored !== undefined ? stored : (n.containsActive || !n.collapsed));
        const caret = el('button', { class: 'fg-menu-caret', type: 'button', 'aria-label': `${n.label} を開閉` });
        li.setAttribute('aria-expanded', String(open));
        li.classList.add('has-children');
        const sub = el('ul', { class: 'fg-submenu', role: 'group' });
        n.children.forEach(c => { const x = build(c, depth + 1); if (x) sub.append(x); });
        const toggle = (e) => {
          e.preventDefault();
          if (document.body.classList.contains('fg-sidebar-collapsed')) {
            // アイコンのみ表示中はサイドバーを開いてからグループを開く
            F.store.set('ui.sidebarCollapsed', false);
            applySidebarState();
            openGroups[n.path] = true;
          } else {
            openGroups[n.path] = li.getAttribute('aria-expanded') !== 'true';
          }
          F.store.set('ui.menuOpen', openGroups);
          li.setAttribute('aria-expanded', String(openGroups[n.path]));
        };
        caret.addEventListener('click', toggle);
        if (!n.href) row.addEventListener('click', toggle);
        li.append(caret, sub);
      }
      return li;
    }

    nodes.forEach(n => { const x = build(n, 0); if (x) ui.menu.append(x); });
    if (!ui.menu.children.length) ui.menu.append(el('li', { class: 'fg-menu-empty' }, q ? '該当する機能がありません' : 'メニューがありません'));

    const srcLabel = {
      yaml: 'config/menu.yaml',
      cache: 'キャッシュ (YAML未読込)',
      import: '読込んだYAML',
      builtin: '組込みメニュー',
    }[menuState.source] || '';
    ui.menuSource.textContent = 'メニュー: ' + srcLabel;
    ui.menuSource.title = menuState.error ? `config/menu.yaml を読み込めませんでした: ${menuState.error}\n` +
      'file:// で開いている場合はローカルHTTPサーバ経由で開くか、「YAML読込」で menu.yaml を選択してください。' : '';
    ui.menuSource.classList.toggle('is-warn', !!menuState.error);
  }
  ui.search.addEventListener('input', renderMenu);
  ui.search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = ui.menu.querySelector('a.fg-menu-link');
      if (first) location.href = first.href;
    }
  });

  function setMenu(data, source, error) {
    menuState.data = data;
    menuState.source = source;
    menuState.error = error || null;
    menuState.nodes = normalizeItems(data && data.items);
    const active = findActive(menuState.nodes);
    ui.featureIcon.textContent = active && active.icon ? active.icon : '';
    renderMenu();
    document.dispatchEvent(new CustomEvent('fedget:menu', { detail: { ...menuState } }));
  }

  async function loadMenu(manual) {
    const url = new URL('config/menu.yaml', rootUrl).href;
    try {
      if (location.protocol === 'file:') throw new Error('file:// では外部ファイルを読み込めません');
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = F.YAML_parse(text);
      F.store.set('menu.cache', { text, at: Date.now(), source: 'yaml' });
      setMenu(data, 'yaml');
      if (manual) F.notify('メニューを再読込しました', 'success');
    } catch (e) {
      const cached = F.store.get('menu.cache');
      let fallbackOk = false;
      if (cached && cached.text) {
        try { setMenu(F.YAML_parse(cached.text), cached.source === 'import' ? 'import' : 'cache', e.message); fallbackOk = true; }
        catch (e2) { /* 壊れたキャッシュ */ }
      }
      if (!fallbackOk) setMenu(BUILTIN_MENU, 'builtin', e.message);
      if (manual || e.name === 'YamlError') F.notify(`menu.yaml の読込に失敗: ${e.message}`, 'error');
    }
  }
  F.YAML_parse = text => {
    const data = global.FedgetYAML.parse(text);
    if (!data || !Array.isArray(data.items)) {
      const err = new Error('items: (配列) が定義されていません');
      err.name = 'YamlError';
      throw err;
    }
    return data;
  };

  ui.importInput.addEventListener('change', async () => {
    const file = ui.importInput.files[0];
    ui.importInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = F.YAML_parse(text);
      F.store.set('menu.cache', { text, at: Date.now(), source: 'import' });
      setMenu(data, 'import');
      F.notify(`${file.name} からメニューを読み込みました`, 'success');
    } catch (e) {
      F.notify(`メニューYAMLの読込に失敗: ${e.message}`, 'error');
    }
  });

  F.menu = {
    get data() { return menuState.data; },
    get nodes() { return menuState.nodes || []; },
    get source() { return menuState.source; },
    reload: () => loadMenu(true),
    /** メニュー読込(更新)時に呼ばれる。既に読込済みなら即時呼び出し */
    onLoad(cb) {
      document.addEventListener('fedget:menu', e => cb(e.detail));
      if (menuState.data) cb({ ...menuState });
    },
  };

  // =====================================================================
  // 通知 / タスク状態 (トップバー)
  // =====================================================================
  const status = {
    task: null,          // 実行中のタスク
    last: null,          // 直近に終了したタスク {state, text, elapsed}
    notice: null,        // 一時通知 {text, type, until}
    unread: 0,
  };
  const LOG_MAX = 200;
  const log = [];

  function addLog(text, type) {
    log.unshift({ at: new Date(), text, type });
    if (log.length > LOG_MAX) log.length = LOG_MAX;
    if (ui.logPanel.hidden) { status.unread++; }
    renderLog();
  }
  function clearLog() { log.length = 0; status.unread = 0; renderLog(); }
  function renderLog() {
    ui.badge.hidden = status.unread === 0;
    ui.badge.textContent = status.unread > 99 ? '99+' : String(status.unread);
    if (ui.logPanel.hidden) return;
    ui.logList.textContent = '';
    if (!log.length) ui.logList.append(el('li', { class: 'fg-log-empty' }, '通知はありません'));
    log.forEach(entry => ui.logList.append(el('li', { class: 'fg-log-item', 'data-type': entry.type },
      el('time', null, F.formatDate(entry.at, 'HH:mm:ss')), el('span', null, entry.text))));
  }
  ui.logBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ui.logPanel.hidden = !ui.logPanel.hidden;
    ui.logBtn.setAttribute('aria-expanded', String(!ui.logPanel.hidden));
    if (!ui.logPanel.hidden) status.unread = 0;
    renderLog();
  });
  document.addEventListener('click', (e) => {
    if (!ui.logPanel.hidden && !ui.logPanel.contains(e.target)) {
      ui.logPanel.hidden = true;
      ui.logBtn.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ui.logPanel.hidden = true;
      document.body.classList.remove('fg-sidebar-mobile-open');
      applySidebarState();
    }
  });

  let timer = null;
  function renderStatus() {
    const now = Date.now();
    const t = status.task;
    const n = status.notice && status.notice.until > now ? status.notice : null;
    let state, text;
    if (n) { state = n.type; text = n.text; }
    else if (t) { state = 'running'; text = t.stepText || t.label; }
    else if (status.last) { state = status.last.state; text = status.last.text; }
    else { state = 'idle'; text = '待機中'; }
    ui.indicator.dataset.state = state;
    ui.status.dataset.state = state;
    if (ui.statusText.textContent !== text) { ui.statusText.textContent = text; ui.statusText.title = text; }

    if (t) ui.elapsed.textContent = F.formatClock(now - t.startedAt);
    else if (status.last) ui.elapsed.textContent = F.formatClock(status.last.elapsed);
    else ui.elapsed.textContent = '--:--.-';
    ui.elapsed.classList.toggle('is-running', !!t);

    if (t && t.progressValue !== null) {
      ui.progress.hidden = false;
      ui.progress.classList.remove('is-indeterminate');
      ui.progressBar.style.width = (Math.max(0, Math.min(1, t.progressValue)) * 100).toFixed(1) + '%';
    } else if (t) {
      ui.progress.hidden = false;
      ui.progress.classList.add('is-indeterminate');
      ui.progressBar.style.width = '';
    } else {
      ui.progress.hidden = true;
    }

    document.title = t ? `⏳ ${featureName}` : featureName;
    const needTick = t || n;
    if (needTick && !timer) timer = setInterval(renderStatus, 100);
    else if (!needTick && timer) { clearInterval(timer); timer = null; }
  }

  /**
   * トップバーに一時的なメッセージを表示する。
   * type: info | success | warn | error
   */
  F.notify = function (text, type = 'info', ms = 3500) {
    status.notice = { text, type, until: Date.now() + ms };
    addLog(text, type);
    renderStatus();
  };

  class Task {
    constructor(label, opts = {}) {
      this.label = label;
      this.startedAt = Date.now();
      this.stepText = label;
      this.progressValue = null;
      this.finished = false;
      this.quiet = !!opts.quiet;
      this.steps = [];
      addLog(`開始: ${label}`, 'info');
    }
    get elapsed() { return Date.now() - this.startedAt; }
    /** 最新ステップを更新する。progress は 0〜1 (省略で不確定表示のまま) */
    step(text, progress) {
      if (this.finished) return this;
      this.stepText = text;
      this.steps.push({ at: Date.now(), text });
      if (progress !== undefined) this.progressValue = progress;
      if (!this.quiet) addLog(text, 'step');
      status.notice = null;
      renderStatus();
      return this;
    }
    progress(value) {
      if (this.finished) return this;
      this.progressValue = value;
      renderStatus();
      return this;
    }
    _finish(state, text) {
      if (this.finished) return;
      this.finished = true;
      const elapsed = this.elapsed;
      if (status.task === this) status.task = null;
      status.last = { state, text: `${text} (${F.formatDuration(elapsed)})`, elapsed };
      status.notice = null;
      addLog(status.last.text, state);
      renderStatus();
    }
    done(text = '完了') { this._finish('success', text); return this; }
    warn(text) { this._finish('warn', text); return this; }
    fail(err) {
      const msg = err && err.message ? err.message : String(err || 'エラー');
      this._finish('error', `エラー: ${msg}`);
      return this;
    }
  }

  F.task = {
    get current() { return status.task; },
    /** タスク開始。既に実行中のタスクがあれば中断扱いにする */
    start(label, opts) {
      if (status.task) status.task._finish('warn', `中断: ${status.task.label}`);
      status.task = new Task(label, opts);
      renderStatus();
      return status.task;
    },
    /**
     * fn(task) を実行し、成功/失敗を自動でトップバーへ反映する。
     * fn が文字列を返せばそれを完了メッセージにする。
     */
    async run(label, fn, opts) {
      const task = F.task.start(label, opts);
      try {
        const result = await fn(task);
        if (!task.finished) task.done(typeof result === 'string' ? result : `${label} 完了`);
        return result;
      } catch (e) {
        console.error(e);
        task.fail(e);
        throw e;
      }
    },
  };

  global.addEventListener('beforeunload', (e) => {
    if (status.task) { e.preventDefault(); e.returnValue = ''; }
  });

  // =====================================================================
  // 初期化
  // =====================================================================
  // キャッシュがあれば即時描画 (チラつき防止) → 非同期で YAML を再取得
  const cached = F.store.get('menu.cache');
  if (cached && cached.text) {
    try { setMenu(F.YAML_parse(cached.text), cached.source === 'import' ? 'import' : 'cache'); } catch (e) { /* ignore */ }
  }
  renderStatus();
  loadMenu(false);
})(window);
