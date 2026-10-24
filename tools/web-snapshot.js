/* Web Snapshot: URL → スクリーンショット */
(function () {
  'use strict';
  const F = Fedget;
  const J = FedgetJina;
  const { $, el } = F;
  const HISTORY_KEY = 'webSnapshot.history';
  const HISTORY_MAX = 30;

  // プリセットは persistForm の前に生成
  const presetSel = $('#ws-preset');
  J.VIEWPORT_PRESETS.forEach(p => presetSel.append(el('option', { value: p.id }, p.label)));
  presetSel.value = 'desktop';
  const form = $('#ws-form');
  F.persistForm(form, 'web-snapshot');
  J.renderSettings($('#ws-jina'));

  presetSel.addEventListener('change', () => {
    const p = J.VIEWPORT_PRESETS.find(x => x.id === presetSel.value);
    if (!p || p.id === 'custom') return;
    $('#ws-w').value = p.width;
    $('#ws-h').value = p.height;
    $('#ws-dpr').value = String(p.deviceScaleFactor || 1);
    form.dispatchEvent(new Event('change'));
  });
  ['#ws-w', '#ws-h'].forEach(s => $(s).addEventListener('input', () => { presetSel.value = 'custom'; }));

  let current = null;     // { url, imageUrl, blob, mode, viewport, at }
  let controller = null;

  function viewport() {
    const p = J.VIEWPORT_PRESETS.find(x => x.id === presetSel.value) || {};
    return {
      width: Math.max(200, Math.min(3840, parseInt($('#ws-w').value, 10) || 1280)),
      height: Math.max(200, Math.min(4320, parseInt($('#ws-h').value, 10) || 800)),
      deviceScaleFactor: parseFloat($('#ws-dpr').value) || 1,
      isMobile: p.isMobile || undefined,
      hasTouch: p.hasTouch || undefined,
    };
  }

  async function capture() {
    const list = F.parseUrlList($('#ws-url').value);
    if (!list.length || !list[0].url) { F.notify('有効な URL を入力してください', 'warn'); $('#ws-url').focus(); return; }
    const url = list[0].url;
    const mode = form.querySelector('input[name="ws-mode"]:checked').value;
    const vp = viewport();
    const label = mode === 'pageshot' ? 'ページ全体' : '表示範囲';
    controller = new AbortController();
    $('#ws-go').disabled = true;
    $('#ws-cancel').hidden = false;

    try {
      await F.task.run('Web Snapshot', async (task) => {
        task.step(`${new URL(url).host} の${label}を撮影中 (${vp.width}×${vp.height} @${vp.deviceScaleFactor}x)`);
        const data = await J.read(url, {
          respondWith: mode,
          viewport: vp,
          timeout: parseInt($('#ws-timeout').value, 10) || 60,
          noCache: $('#ws-nocache').checked,
          waitForSelector: $('#ws-wait').value.trim(),
          removeSelector: $('#ws-remove').value.trim(),
          signal: controller.signal,
          onRetry: (n, wait, status) => task.step(`混雑しています (HTTP ${status})。${Math.round(wait / 1000)}秒後に再試行 (${n}回目)`),
        });

        let imageUrl = data.screenshotUrl || data.pageshotUrl || null;
        if (!imageUrl && typeof data.content === 'string' && /^https?:\/\/\S+$/.test(data.content.trim())) imageUrl = data.content.trim();
        let blob = data.imageBlob || null;
        if (!imageUrl && !blob) throw new Error('スクリーンショットの URL が応答に含まれていませんでした');

        if (!blob) {
          task.step('画像をダウンロード中');
          try {
            const res = await fetch(imageUrl, { signal: controller.signal });
            if (res.ok) blob = await res.blob();
          } catch (e) {
            // CORS で取得できない場合はプレビューのみ (保存は新しいタブから)
          }
        }
        current = { url, title: data.title || '', imageUrl, blob, mode, viewport: vp, at: Date.now() };
        showResult(current);
        if (imageUrl) addHistory(current);
        return `${label}のスクリーンショットを取得しました`;
      });
    } catch (e) {
      /* トップバーに表示済み */
    } finally {
      controller = null;
      $('#ws-go').disabled = false;
      $('#ws-cancel').hidden = true;
    }
  }

  function showResult(r) {
    $('#ws-result').hidden = false;
    const img = $('#ws-img');
    if (img.dataset.objectUrl) URL.revokeObjectURL(img.dataset.objectUrl);
    if (r.blob) {
      const u = URL.createObjectURL(r.blob);
      img.dataset.objectUrl = u;
      img.src = u;
    } else {
      delete img.dataset.objectUrl;
      img.src = r.imageUrl;
    }
    $('#ws-result-title').textContent = r.title || r.url;
    $('#ws-open').href = r.imageUrl || img.src;
    $('#ws-copy-url').disabled = !r.imageUrl;
    const meta = $('#ws-result-meta');
    meta.textContent = '';
    meta.append(
      el('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.url),
      el('span', { class: 'tag' }, r.mode === 'pageshot' ? 'ページ全体' : '表示範囲'),
      el('span', { class: 'tag' }, `${r.viewport.width}×${r.viewport.height} @${r.viewport.deviceScaleFactor}x`),
      r.blob ? el('span', { class: 'tag' }, F.formatBytes(r.blob.size)) : el('span', { class: 'tag tag-warn', title: '画像サーバが CORS を許可していないため、保存は「新しいタブで開く」から行ってください' }, 'プレビューのみ'));
    img.onload = () => {
      meta.append(el('span', { class: 'tag' }, `${img.naturalWidth}×${img.naturalHeight}px`));
    };
  }

  function filename(r, ext) {
    let host = 'site';
    try { host = new URL(r.url).host; } catch (e) { /* noop */ }
    return F.sanitizeFilename(`snapshot_${host}_${F.formatDate(new Date(r.at))}`) + '.' + ext;
  }

  $('#ws-save').addEventListener('click', async () => {
    if (!current) return;
    if (!current.blob) {
      window.open(current.imageUrl, '_blank', 'noopener');
      F.notify('画像を直接取得できないため新しいタブで開きました。右クリック→「名前を付けて画像を保存」で保存してください', 'warn', 7000);
      return;
    }
    const fmt = $('#ws-format').value;
    if (fmt === 'original') {
      const ext = (current.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      F.download(current.blob, filename(current, ext));
      return;
    }
    await F.task.run('画像変換', async (task) => {
      task.step(`${fmt.toUpperCase()} に変換中`);
      const loaded = await FedgetImage.loadImage(current.blob);
      const out = await FedgetImage.convert(loaded.img, loaded.width, loaded.height, { format: fmt, quality: 0.9 });
      URL.revokeObjectURL(loaded.url);
      F.download(out.blob, filename(current, out.ext));
      return `${fmt.toUpperCase()} で保存しました (${F.formatBytes(out.blob.size)})`;
    });
  });
  $('#ws-copy-url').addEventListener('click', () => current && current.imageUrl && F.copyText(current.imageUrl));

  form.addEventListener('submit', capture);
  $('#ws-cancel').addEventListener('click', () => controller && controller.abort());

  // ---------------- 履歴 ----------------
  function addHistory(r) {
    const h = F.store.get(HISTORY_KEY, []);
    h.unshift({ url: r.url, title: r.title, imageUrl: r.imageUrl, mode: r.mode, viewport: r.viewport, at: r.at });
    F.store.set(HISTORY_KEY, h.slice(0, HISTORY_MAX));
    renderHistory();
  }

  function renderHistory() {
    const h = F.store.get(HISTORY_KEY, []);
    const ul = $('#ws-history');
    ul.textContent = '';
    if (!h.length) { ul.append(el('li', { class: 'hint' }, '履歴はありません')); return; }
    h.forEach(item => ul.append(el('li', null,
      el('time', null, F.formatDate(new Date(item.at), 'MM/dd HH:mm')),
      el('span', { class: 'h-url', title: item.url }, item.title || item.url),
      el('span', { class: 'tag' }, item.mode === 'pageshot' ? '全体' : '表示'),
      el('button', { class: 'btn btn-sm', type: 'button', onclick: () => { current = { ...item, blob: null }; showResult(current); } }, '表示'),
      el('button', { class: 'btn btn-sm', type: 'button', onclick: () => { $('#ws-url').value = item.url; capture(); } }, '再取得'))));
  }
  $('#ws-history-clear').addEventListener('click', () => { F.store.remove(HISTORY_KEY); renderHistory(); });
  renderHistory();
})();
