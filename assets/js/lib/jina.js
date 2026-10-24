/*
 * Fedget Jina Reader client
 * https://r.jina.ai/ (Jina Reader API) をブラウザから直接呼び出す。
 *   - POST の JSON ボディで url / viewport を渡し、オプションは X-* ヘッダで指定
 *   - Accept: application/json で { code, data: { title, url, content, screenshotUrl, pageshotUrl, ... } } を受け取る
 *   - API キーは任意 (無しでも利用可能だがレート制限が厳しい)。保存先は localStorage / sessionStorage / 保存しない から選択
 */
(function (global) {
  'use strict';
  const F = global.Fedget;
  const { el } = F;

  const DEFAULT_ENDPOINT = 'https://r.jina.ai/';
  let memoryKey = '';

  const VIEWPORT_PRESETS = [
    { id: 'desktop-fhd', label: 'デスクトップ 1920×1080', width: 1920, height: 1080 },
    { id: 'desktop', label: 'デスクトップ 1280×800', width: 1280, height: 800 },
    { id: 'laptop', label: 'ノートPC 1440×900', width: 1440, height: 900 },
    { id: 'tablet', label: 'タブレット 768×1024', width: 768, height: 1024, isMobile: true, hasTouch: true },
    { id: 'mobile', label: 'スマートフォン 390×844', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { id: 'custom', label: 'カスタム' },
  ];

  // ---------------- 設定 ----------------
  function storageMode() { return F.store.get('jina.keyStorage', 'local'); }
  function getApiKey() {
    const mode = storageMode();
    if (mode === 'local') return F.store.get('jina.apiKey', '') || '';
    if (mode === 'session') return F.session.get('jina.apiKey', '') || '';
    return memoryKey;
  }
  function setApiKey(key, mode = storageMode()) {
    F.store.set('jina.keyStorage', mode);
    memoryKey = key;
    F.store.remove('jina.apiKey');
    F.session.remove('jina.apiKey');
    if (mode === 'local' && key) F.store.set('jina.apiKey', key);
    if (mode === 'session' && key) F.session.set('jina.apiKey', key);
  }
  function getEndpoint() { return F.store.get('jina.endpoint', '') || DEFAULT_ENDPOINT; }

  /** API キー等の設定 UI を container に描画 */
  function renderSettings(container) {
    const keyInput = el('input', { type: 'password', class: 'mono', placeholder: 'jina_xxxxxxxx (任意)', autocomplete: 'off', style: 'width:100%' });
    keyInput.value = getApiKey();
    const show = el('input', { type: 'checkbox' });
    const modeSel = el('select', null,
      el('option', { value: 'local' }, 'このブラウザに保存 (localStorage)'),
      el('option', { value: 'session' }, 'タブを閉じるまで (sessionStorage)'),
      el('option', { value: 'none' }, '保存しない (このページのみ)'));
    modeSel.value = storageMode();
    const endpoint = el('input', { type: 'url', class: 'mono', placeholder: DEFAULT_ENDPOINT, style: 'width:100%' });
    endpoint.value = F.store.get('jina.endpoint', '') || '';

    const save = () => setApiKey(keyInput.value.trim(), modeSel.value);
    keyInput.addEventListener('change', save);
    modeSel.addEventListener('change', save);
    show.addEventListener('change', () => { keyInput.type = show.checked ? 'text' : 'password'; });
    endpoint.addEventListener('change', () => F.store.set('jina.endpoint', endpoint.value.trim()));

    container.append(
      el('div', { class: 'fields' },
        el('div', { class: 'field', style: 'grid-column: span 2' },
          el('label', null, 'Jina API キー'),
          keyInput,
          el('label', { class: 'check hint' }, show, 'キーを表示')),
        el('div', { class: 'field' }, el('label', null, 'キーの保存先'), modeSel),
        el('div', { class: 'field' }, el('label', null, 'エンドポイント'), endpoint,
          el('span', { class: 'hint' }, 'セルフホストの Reader を使う場合に変更'))),
      el('p', { class: 'hint', style: 'margin:8px 0 0' },
        'API キー無しでも利用できますがレート制限があります。キーは ',
        el('a', { href: 'https://jina.ai/reader', target: '_blank', rel: 'noopener' }, 'jina.ai/reader'),
        ' で取得できます。指定した URL は Jina のサーバへ送信されます。'));
  }

  // ---------------- API ----------------
  class JinaError extends Error {
    constructor(message, status) { super(message); this.name = 'JinaError'; this.status = status; }
  }

  /**
   * Jina Reader でページを取得
   * @param {string} url
   * @param {object} o  respondWith, viewport{width,height,...}, timeout(sec), noCache, targetSelector,
   *                    removeSelector, waitForSelector, withImagesSummary, withLinksSummary, retainImages,
   *                    locale, signal, onRetry(attempt, waitMs, status)
   * @returns {Promise<object>} data ({title, url, content, screenshotUrl, pageshotUrl, ...})
   */
  async function read(url, o = {}) {
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    const key = getApiKey();
    if (key) headers['Authorization'] = 'Bearer ' + key;
    if (o.respondWith) headers['X-Respond-With'] = o.respondWith;
    if (o.timeout) headers['X-Timeout'] = String(o.timeout);
    if (o.noCache) headers['X-No-Cache'] = 'true';
    if (o.targetSelector) headers['X-Target-Selector'] = o.targetSelector;
    if (o.removeSelector) headers['X-Remove-Selector'] = o.removeSelector;
    if (o.waitForSelector) headers['X-Wait-For-Selector'] = o.waitForSelector;
    if (o.withImagesSummary) headers['X-With-Images-Summary'] = 'true';
    if (o.withLinksSummary) headers['X-With-Links-Summary'] = 'true';
    if (o.retainImages) headers['X-Retain-Images'] = o.retainImages;
    if (o.locale) headers['X-Locale'] = o.locale;
    if (o.engine) headers['X-Engine'] = o.engine;

    const body = { url };
    if (o.viewport && o.viewport.width && o.viewport.height) {
      body.viewport = { width: Math.round(o.viewport.width), height: Math.round(o.viewport.height) };
      ['deviceScaleFactor', 'isMobile', 'hasTouch', 'isLandscape'].forEach(k => {
        if (o.viewport[k] !== undefined && o.viewport[k] !== null && o.viewport[k] !== '') body.viewport[k] = o.viewport[k];
      });
    }

    const maxRetry = o.maxRetry ?? 2;
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (o.signal) { if (o.signal.aborted) ctrl.abort(); else o.signal.addEventListener('abort', onAbort, { once: true }); }
      const timer = setTimeout(() => ctrl.abort(), ((o.timeout || 60) + 30) * 1000);
      let res;
      try {
        res = await fetch(getEndpoint(), { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
      } catch (e) {
        if (o.signal && o.signal.aborted) throw new JinaError('中止しました', 0);
        if (e.name === 'AbortError') throw new JinaError('タイムアウトしました', 0);
        throw new JinaError(`Jina Reader に接続できませんでした (${e.message})。ネットワーク・CORS・広告ブロッカー等を確認してください`, 0);
      } finally {
        clearTimeout(timer);
        if (o.signal) o.signal.removeEventListener('abort', onAbort);
      }

      if ((res.status === 429 || res.status >= 500) && attempt < maxRetry) {
        const ra = parseInt(res.headers.get('Retry-After'), 10);
        const wait = (isFinite(ra) ? ra * 1000 : 0) || (res.status === 429 ? 10000 : 3000) * (attempt + 1);
        if (o.onRetry) o.onRetry(attempt + 1, wait, res.status);
        await F.sleep(wait);
        continue;
      }

      const ct = res.headers.get('Content-Type') || '';
      if (ct.startsWith('image/')) {
        if (!res.ok) throw new JinaError(`HTTP ${res.status}`, res.status);
        return { url, imageBlob: await res.blob() };
      }
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* not json */ }
      if (!res.ok || (json && json.code && json.code >= 400)) {
        const msg = json ? (json.readableMessage || json.message || json.name) : text.slice(0, 200);
        throw new JinaError(`${res.status} ${msg || res.statusText}`, res.status);
      }
      if (!json) return { url, content: text };
      return json.data || json;
    }
  }

  global.FedgetJina = { DEFAULT_ENDPOINT, VIEWPORT_PRESETS, getApiKey, setApiKey, getEndpoint, renderSettings, read, JinaError };
})(window);
