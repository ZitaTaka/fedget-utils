/*
 * Fedget core utilities
 * 全ページ共通のユーティリティ (WebStorage ラッパ, ダウンロード, コピー, 書式化 など)。
 * file:// でも動くよう ES Modules は使わず window.Fedget に集約する。
 */
(function (global) {
  'use strict';

  const Fedget = global.Fedget = global.Fedget || {};
  const PREFIX = 'fedget.';

  // ---------- WebStorage ----------
  function makeStore(getStorage) {
    return {
      get(key, fallback = null) {
        try {
          const v = getStorage().getItem(PREFIX + key);
          return v === null ? fallback : JSON.parse(v);
        } catch (e) { return fallback; }
      },
      set(key, value) {
        try { getStorage().setItem(PREFIX + key, JSON.stringify(value)); return true; }
        catch (e) { console.warn('storage set failed', key, e); return false; }
      },
      remove(key) {
        try { getStorage().removeItem(PREFIX + key); } catch (e) { /* noop */ }
      },
    };
  }
  Fedget.store = makeStore(() => global.localStorage);
  Fedget.session = makeStore(() => global.sessionStorage);

  /**
   * data-persist 属性を持つ入力要素の値を localStorage に自動保存/復元する。
   * <input data-persist="length"> → fedget.<scope>.length
   */
  Fedget.persistForm = function (root, scope) {
    const key = 'form.' + scope;
    const saved = Fedget.store.get(key, {});
    const els = root.querySelectorAll('[data-persist]');
    els.forEach(el => {
      const name = el.dataset.persist;
      if (!(name in saved)) return;
      if (el.type === 'checkbox') el.checked = !!saved[name];
      else if (el.type === 'radio') el.checked = (el.value === saved[name]);
      else el.value = saved[name];
    });
    const save = () => {
      const data = Fedget.store.get(key, {});
      els.forEach(el => {
        const name = el.dataset.persist;
        if (el.type === 'checkbox') data[name] = el.checked;
        else if (el.type === 'radio') { if (el.checked) data[name] = el.value; }
        else data[name] = el.value;
      });
      Fedget.store.set(key, data);
    };
    root.addEventListener('change', e => { if (e.target.matches('[data-persist]')) save(); });
    root.addEventListener('input', e => { if (e.target.matches('[data-persist]')) save(); });
    return { save, reset() { Fedget.store.remove(key); } };
  };

  // ---------- DOM ----------
  Fedget.$ = (sel, root = document) => root.querySelector(sel);
  Fedget.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** el('div', {class:'x', onclick: fn}, child, 'text', ...) */
  Fedget.el = function (tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  };

  Fedget.escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 書式化 ----------
  Fedget.formatBytes = function (n) {
    if (!isFinite(n)) return '-';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)) + ' ' + u[i];
  };

  Fedget.formatDuration = function (ms) {
    if (ms < 1000) return (ms / 1000).toFixed(1) + '秒';
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + '秒';
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    if (m < 60) return `${m}分${String(r).padStart(2, '0')}秒`;
    return `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, '0')}分`;
  };

  /** トップバー用の経過時間表示 mm:ss.d */
  Fedget.formatClock = function (ms) {
    const t = Math.max(0, ms) / 1000;
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const ss = s.toFixed(1).padStart(4, '0');
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + ss;
  };

  /** 日付フォーマット: yyyy MM dd HH mm ss */
  Fedget.formatDate = function (date = new Date(), fmt = 'yyyyMMdd_HHmmss') {
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return fmt
      .replace(/yyyy/g, date.getFullYear())
      .replace(/MM/g, p(date.getMonth() + 1))
      .replace(/dd/g, p(date.getDate()))
      .replace(/HH/g, p(date.getHours()))
      .replace(/mm/g, p(date.getMinutes()))
      .replace(/ss/g, p(date.getSeconds()));
  };

  /** ファイル名として使えない文字を除去 */
  Fedget.sanitizeFilename = function (name, maxLen = 80) {
    let s = String(name || '').normalize('NFC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ').trim()
      .replace(/^\.+/, '');
    if (s.length > maxLen) s = s.slice(0, maxLen).trim();
    return s || 'untitled';
  };

  // ---------- バイナリ ----------
  Fedget.bytesToHex = function (bytes, upper = false) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
    return upper ? s.toUpperCase() : s;
  };

  Fedget.bytesToBase64 = function (bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    return btoa(bin);
  };

  Fedget.bytesToBase64Url = bytes => Fedget.bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  Fedget.base64ToBytes = function (b64) {
    const s = String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };

  Fedget.hexToBytes = function (hex) {
    const s = String(hex).replace(/[\s:]/g, '');
    if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error('16進数として不正な値です');
    const u8 = new Uint8Array(s.length / 2);
    for (let i = 0; i < u8.length; i++) u8[i] = parseInt(s.substr(i * 2, 2), 16);
    return u8;
  };

  /** 暗号論的乱数 (Uint8Array) */
  Fedget.randomBytes = function (n) {
    const u8 = new Uint8Array(n);
    for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u8.subarray(i, Math.min(n, i + 65536)));
    return u8;
  };

  /** 0 <= x < max の一様な暗号論的乱数整数 (リジェクションサンプリング) */
  Fedget.randomInt = function (max) {
    if (max <= 0 || max > 0x100000000) throw new RangeError('max out of range');
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % max;
    }
  };

  // ---------- 入出力 ----------
  /** Blob / 文字列 / ArrayBuffer をファイルとしてダウンロード */
  Fedget.download = function (data, filename, mime = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = Fedget.el('a', { href: url, download: filename, style: 'display:none' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  Fedget.copyText = async function (text, label = 'コピーしました') {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = Fedget.el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) { Fedget.notify && Fedget.notify('クリップボードへのコピーに失敗しました', 'error'); return false; }
    }
    Fedget.notify && Fedget.notify(label, 'success');
    return true;
  };

  /** UIスレッドに処理を戻す (長い処理の途中でトップバーを再描画させる) */
  Fedget.yieldUI = () => new Promise(r => setTimeout(r, 0));
  Fedget.sleep = ms => new Promise(r => setTimeout(r, ms));

  /** URLリストを行単位で抽出 (空行・# コメント・重複を除去) */
  Fedget.parseUrlList = function (text) {
    const seen = new Set();
    const out = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      const s = line.trim();
      if (!s || s.startsWith('#')) return;
      let u = s;
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
      try { u = new URL(u).href; } catch (e) { out.push({ raw: s, url: null, error: 'URLとして解釈できません' }); return; }
      if (seen.has(u)) return;
      seen.add(u);
      out.push({ raw: s, url: u });
    });
    return out;
  };
})(window);
