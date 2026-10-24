/* Blog Snapshot: 複数 URL → Jina Reader で Markdown 取得 → Markdown / HTML / PDF / ZIP / JSON */
(function () {
  'use strict';
  const F = Fedget;
  const J = FedgetJina;
  const MD = FedgetMarkdown;
  const { $, el } = F;
  const RESULTS_KEY = 'blogSnapshot.results';

  // ---------------- 初期化 ----------------
  const presetSel = $('#bs-preset');
  J.VIEWPORT_PRESETS.forEach(p => presetSel.append(el('option', { value: p.id }, p.label)));
  presetSel.value = 'desktop';
  F.persistForm($('main'), 'blog-snapshot');
  J.renderSettings($('#bs-jina'));

  presetSel.addEventListener('change', () => {
    const p = J.VIEWPORT_PRESETS.find(x => x.id === presetSel.value);
    if (!p || p.id === 'custom') return;
    $('#bs-w').value = p.width;
    $('#bs-h').value = p.height;
    $('#bs-w').dispatchEvent(new Event('change', { bubbles: true }));
  });
  ['#bs-w', '#bs-h'].forEach(s => $(s).addEventListener('input', () => { presetSel.value = 'custom'; }));

  const urlArea = $('#bs-urls');
  const updateCount = () => {
    const list = F.parseUrlList(urlArea.value);
    const bad = list.filter(x => !x.url).length;
    $('#bs-url-count').textContent = `${list.length - bad} 件` + (bad ? ` (不正 ${bad})` : '');
    $('#bs-url-count').className = 'tag ' + (bad ? 'tag-warn' : 'tag-primary');
  };
  urlArea.addEventListener('input', updateCount);
  updateCount();

  /** @type {Array<{id:number,url:string,status:string,title?:string,content?:string,description?:string,publishedTime?:string,fetchedAt?:string,ms?:number,error?:string,screenshotUrl?:string,viewport?:object}>} */
  let items = loadResults();
  let nextId = items.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  let selectedId = null;
  let controller = null;
  const shotBlobs = new Map();   // id → Blob (スクリーンショット画像、保存はしない)

  function loadResults() {
    const saved = F.store.get(RESULTS_KEY, []);
    return Array.isArray(saved) ? saved.map(x => (x.status === 'running' || x.status === 'pending') ? { ...x, status: 'canceled' } : x) : [];
  }
  function saveResults() {
    if (!F.store.set(RESULTS_KEY, items)) {
      F.notify('結果が大きすぎるためブラウザに保存できませんでした (ページを閉じると消えます)', 'warn', 6000);
    }
  }

  // ---------------- オプション ----------------
  function options() {
    const p = J.VIEWPORT_PRESETS.find(x => x.id === presetSel.value) || {};
    return {
      viewport: {
        width: Math.max(200, Math.min(3840, parseInt($('#bs-w').value, 10) || 1280)),
        height: Math.max(200, Math.min(4320, parseInt($('#bs-h').value, 10) || 800)),
        deviceScaleFactor: p.deviceScaleFactor,
        isMobile: p.isMobile,
        hasTouch: p.hasTouch,
      },
      retainImages: $('#bs-images').value,
      concurrency: parseInt($('#bs-concurrency').value, 10) || 1,
      interval: Math.max(0, parseInt($('#bs-interval').value, 10) || 0),
      screenshot: $('#bs-shot').checked,
      frontMatter: $('#bs-frontmatter').checked,
      targetSelector: $('#bs-target').value.trim(),
      removeSelector: $('#bs-remove').value.trim(),
      waitForSelector: $('#bs-wait').value.trim(),
      timeout: parseInt($('#bs-timeout').value, 10) || 60,
      withLinksSummary: $('#bs-links').checked,
      withImagesSummary: $('#bs-imgsum').checked,
      noCache: $('#bs-nocache').checked,
    };
  }

  // ---------------- 取得 ----------------
  async function run(targets) {
    if (controller) { F.notify('取得中です', 'warn'); return; }
    const o = options();
    controller = new AbortController();
    const signal = controller.signal;
    targets.forEach(t => { t.status = 'pending'; t.error = null; });
    render();
    setRunning(true);

    const total = targets.length;
    let done = 0, failed = 0, cursor = 0, lastStart = 0;
    const host = u => { try { return new URL(u).host; } catch (e) { return u; } };

    try {
      await F.task.run('Blog Snapshot', async (task) => {
        const report = (text) => task.step(`${text} — 完了 ${done}/${total}${failed ? ` 失敗 ${failed}` : ''}`, (done + failed) / total);
        report('取得を開始');

        async function worker() {
          while (cursor < targets.length && !signal.aborted) {
            const item = targets[cursor++];
            const idx = cursor;
            // リクエスト間隔 (レート制限対策)
            const wait = lastStart + o.interval - Date.now();
            lastStart = Math.max(Date.now(), lastStart + o.interval);
            if (wait > 0) await F.sleep(wait);
            if (signal.aborted) break;

            item.status = 'running';
            render();
            const t0 = Date.now();
            report(`[${idx}/${total}] ${host(item.url)} を取得中`);
            try {
              const data = await J.read(item.url, {
                respondWith: 'markdown',
                viewport: o.viewport,
                retainImages: o.retainImages,
                timeout: o.timeout,
                noCache: o.noCache,
                targetSelector: o.targetSelector,
                removeSelector: o.removeSelector,
                waitForSelector: o.waitForSelector,
                withLinksSummary: o.withLinksSummary,
                withImagesSummary: o.withImagesSummary,
                signal,
                onRetry: (n, w, st) => report(`[${idx}/${total}] ${host(item.url)}: HTTP ${st} のため ${Math.round(w / 1000)}秒後に再試行`),
              });
              Object.assign(item, {
                title: (data.title || '').trim() || host(item.url),
                description: data.description || '',
                publishedTime: data.publishedTime || '',
                finalUrl: data.url || item.url,
                content: (data.content || '').trim(),
                links: data.links || null,
                images: data.images || null,
                fetchedAt: new Date().toISOString(),
                viewport: { width: o.viewport.width, height: o.viewport.height },
                screenshotUrl: null,
              });
              if (o.screenshot && !signal.aborted) {
                report(`[${idx}/${total}] ${host(item.url)} のスクリーンショットを取得中`);
                try {
                  const shot = await J.read(item.url, { respondWith: 'screenshot', viewport: o.viewport, timeout: o.timeout, noCache: o.noCache, waitForSelector: o.waitForSelector, signal });
                  item.screenshotUrl = shot.screenshotUrl || shot.pageshotUrl || null;
                  if (item.screenshotUrl) {
                    try { const r = await fetch(item.screenshotUrl, { signal }); if (r.ok) shotBlobs.set(item.id, await r.blob()); } catch (e) { /* CORS 不可ならURL参照のみ */ }
                  }
                } catch (e) {
                  if (signal.aborted) throw e;
                  item.shotError = e.message;
                }
              }
              item.status = 'done';
              item.ms = Date.now() - t0;
              done++;
            } catch (e) {
              item.ms = Date.now() - t0;
              if (signal.aborted) { item.status = 'canceled'; }
              else { item.status = 'error'; item.error = e.message; failed++; }
            }
            render();
            report(`[${idx}/${total}] ${host(item.url)} ${item.status === 'done' ? '完了' : item.status === 'error' ? '失敗' : '中止'}`);
          }
        }

        await Promise.all(Array.from({ length: Math.min(o.concurrency, total) }, worker));
        targets.forEach(t => { if (t.status === 'pending' || t.status === 'running') t.status = 'canceled'; });
        if (signal.aborted) { task.warn(`中止しました (完了 ${done} / 失敗 ${failed} / 全 ${total})`); return; }
        if (failed && !done) throw new Error(`すべて失敗しました (${failed}件)。${targets.find(t => t.error)?.error || ''}`);
        if (failed) { task.warn(`完了 ${done}件 / 失敗 ${failed}件`); return; }
        return `${done}件のページを Markdown に変換しました`;
      }, { quiet: false });
    } catch (e) {
      /* トップバーに表示済み */
    } finally {
      controller = null;
      setRunning(false);
      saveResults();
      render();
      if (!selectedId) { const first = items.find(x => x.status === 'done'); if (first) select(first.id); }
    }
  }

  function setRunning(on) {
    $('#bs-run').disabled = on;
    $('#bs-cancel').hidden = !on;
    $('#bs-retry').disabled = on || !items.some(x => x.status === 'error' || x.status === 'canceled');
  }

  $('#bs-form').addEventListener('submit', () => {
    const list = F.parseUrlList(urlArea.value);
    const urls = list.filter(x => x.url).map(x => x.url);
    if (!urls.length) { F.notify('URL を 1 行に 1 つ入力してください', 'warn'); urlArea.focus(); return; }
    if (list.some(x => !x.url)) F.notify(`解釈できない行を ${list.filter(x => !x.url).length} 件スキップしました`, 'warn');
    if (!$('#bs-append').checked) { items = []; shotBlobs.clear(); selectedId = null; $('#bs-preview-card').hidden = true; }
    const existing = new Set(items.map(x => x.url));
    const targets = urls.filter(u => !existing.has(u)).map(url => ({ id: nextId++, url, status: 'pending' }));
    if (!targets.length) { F.notify('新しい URL がありません (すべて取得済み)', 'info'); return; }
    items.push(...targets);
    run(targets);
  });
  $('#bs-cancel').addEventListener('click', () => controller && controller.abort());
  $('#bs-retry').addEventListener('click', () => run(items.filter(x => x.status === 'error' || x.status === 'canceled')));
  $('#bs-clear').addEventListener('click', () => {
    if (controller) return;
    items = []; shotBlobs.clear(); selectedId = null;
    $('#bs-preview-card').hidden = true;
    saveResults();
    render();
  });

  // ---------------- 一覧表示 ----------------
  const STATUS = {
    pending: ['待機中', 'tag'],
    running: ['取得中', 'tag tag-primary'],
    done: ['完了', 'tag tag-success'],
    error: ['失敗', 'tag tag-danger'],
    canceled: ['中止', 'tag tag-warn'],
  };

  function render() {
    const tbody = $('#bs-rows');
    tbody.textContent = '';
    items.forEach((it, i) => {
      const [label, cls] = STATUS[it.status] || STATUS.pending;
      const tr = el('tr', { class: it.id === selectedId ? 'is-selected' : '', onclick: () => it.status === 'done' && select(it.id) },
        el('td', null, i + 1),
        el('td', null, el('span', { class: cls, title: it.error || '' }, it.status === 'running' ? '⏳ ' + label : label)),
        el('td', null,
          el('div', { class: 'bs-title', title: it.title || '' }, it.title || '—'),
          el('div', { class: 'bs-url', title: it.url }, it.url),
          it.error ? el('div', { class: 'hint', style: 'color:var(--danger)' }, it.error) : null,
          it.shotError ? el('div', { class: 'hint', style: 'color:var(--warn)' }, 'スクリーンショット: ' + it.shotError) : null),
        el('td', null, it.content ? it.content.length.toLocaleString() : '-'),
        el('td', null, it.ms ? F.formatDuration(it.ms) : '-'),
        el('td', null, el('div', { class: 'bs-actions' },
          it.status === 'done' ? el('button', { class: 'btn btn-sm', type: 'button', title: 'Markdown を保存', onclick: (e) => { e.stopPropagation(); downloadMd([it]); } }, 'MD') : null,
          it.status === 'done' ? el('button', { class: 'btn btn-sm', type: 'button', title: 'PDF として印刷', onclick: (e) => { e.stopPropagation(); printPdf([it]); } }, 'PDF') : null,
          (it.status === 'error' || it.status === 'canceled') && !controller ? el('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => { e.stopPropagation(); run([it]); } }, '再取得') : null,
          !controller ? el('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: '一覧から削除', 'aria-label': '削除', onclick: (e) => { e.stopPropagation(); removeItem(it); } }, '✕') : null)));
      tbody.append(tr);
    });
    if (!items.length) tbody.append(el('tr', null, el('td', { colspan: 6, class: 'empty' }, 'URL を入力して「取得開始」を押してください')));

    const count = s => items.filter(x => x.status === s).length;
    const sum = $('#bs-summary');
    sum.textContent = '';
    if (items.length) {
      sum.append(el('span', { class: 'tag' }, `全 ${items.length}`));
      if (count('done')) sum.append(el('span', { class: 'tag tag-success' }, `完了 ${count('done')}`));
      if (count('error')) sum.append(el('span', { class: 'tag tag-danger' }, `失敗 ${count('error')}`));
      if (count('canceled')) sum.append(el('span', { class: 'tag tag-warn' }, `中止 ${count('canceled')}`));
    }
    const hasDone = count('done') > 0;
    F.$$('[data-export]').forEach(b => { b.disabled = !hasDone; });
    $('#bs-clear').disabled = !items.length || !!controller;
    $('#bs-retry').disabled = !!controller || !items.some(x => x.status === 'error' || x.status === 'canceled');
  }

  function removeItem(it) {
    items = items.filter(x => x !== it);
    shotBlobs.delete(it.id);
    if (selectedId === it.id) { selectedId = null; $('#bs-preview-card').hidden = true; }
    saveResults();
    render();
  }

  // ---------------- プレビュー ----------------
  function select(id) {
    selectedId = id;
    const it = items.find(x => x.id === id);
    if (!it) return;
    $('#bs-preview-card').hidden = false;
    $('#bs-preview-title').textContent = it.title;
    const meta = $('#bs-preview-meta');
    meta.textContent = '';
    meta.append(
      el('a', { href: it.finalUrl || it.url, target: '_blank', rel: 'noopener' }, it.finalUrl || it.url),
      el('span', { class: 'tag' }, `取得: ${F.formatDate(new Date(it.fetchedAt), 'yyyy-MM-dd HH:mm')}`),
      it.viewport ? el('span', { class: 'tag' }, `ビューポート ${it.viewport.width}×${it.viewport.height}`) : null,
      it.publishedTime ? el('span', { class: 'tag' }, `公開: ${it.publishedTime}`) : null);
    const md = articleMarkdown(it, options().frontMatter);
    $('#bs-preview').innerHTML = MD.render(MD.splitFrontMatter(md).body, { baseUrl: it.finalUrl || it.url, externalLinks: true });
    $('#bs-preview-raw').value = md;
    render();
  }
  F.$$('input[name="bs-view"]').forEach(r => r.addEventListener('change', () => {
    const raw = $('input[name="bs-view"]:checked').value === 'raw';
    $('#bs-preview').hidden = raw;
    $('#bs-preview-raw').hidden = !raw;
  }));
  $('#bs-preview-copy').addEventListener('click', () => F.copyText($('#bs-preview-raw').value, 'Markdown をコピーしました'));

  // ---------------- 変換 ----------------
  const yamlStr = s => JSON.stringify(String(s ?? ''));

  function articleMarkdown(it, withFrontMatter, opts = {}) {
    const lines = [];
    if (withFrontMatter) {
      lines.push('---',
        `title: ${yamlStr(it.title)}`,
        `url: ${yamlStr(it.finalUrl || it.url)}`,
        `fetched_at: ${yamlStr(it.fetchedAt)}`);
      if (it.viewport) lines.push(`viewport: ${yamlStr(`${it.viewport.width}x${it.viewport.height}`)}`);
      if (it.publishedTime) lines.push(`published: ${yamlStr(it.publishedTime)}`);
      if (it.description) lines.push(`description: ${yamlStr(it.description)}`);
      lines.push('source: "Jina Reader"', '---', '');
    }
    const h = '#'.repeat(opts.level || 1);
    lines.push(`${h} ${it.title.replace(/\n/g, ' ')}`, '');
    lines.push(`> 出典: <${it.finalUrl || it.url}>  `, `> 取得日時: ${F.formatDate(new Date(it.fetchedAt), 'yyyy-MM-dd HH:mm:ss')}` +
      (it.viewport ? `  \n> ビューポート: ${it.viewport.width}×${it.viewport.height}` : ''), '');
    const shot = opts.screenshotRef ? opts.screenshotRef(it) : it.screenshotUrl;
    if (shot) lines.push(`![スクリーンショット (${it.viewport ? it.viewport.width + '×' + it.viewport.height : 'viewport'})](${shot})`, '');
    lines.push(it.content || '');
    return lines.join('\n').replace(/\s+$/, '') + '\n';
  }

  function doneItems(list) { return (list || items).filter(x => x.status === 'done'); }

  function baseFilename() {
    const t = $('#bs-filename').value || 'blog-snapshot_{date}';
    return F.sanitizeFilename(t.replace(/\{date\}/g, F.formatDate()), 100);
  }
  function articleFilename(it, i) {
    return `${String(i + 1).padStart(2, '0')}_${F.sanitizeFilename(it.title, 60)}`;
  }

  function combinedMarkdown(list) {
    const now = F.formatDate(new Date(), 'yyyy-MM-dd HH:mm');
    const parts = [`# Blog Snapshot (${now})`, '', `${list.length} ページ`, ''];
    list.forEach((it, i) => parts.push(`${i + 1}. [${it.title.replace(/[[\]]/g, '\\$&')}](${it.finalUrl || it.url})`));
    parts.push('');
    list.forEach(it => { parts.push('', '---', '', articleMarkdown(it, false, { level: 1 })); });
    return parts.join('\n');
  }

  function downloadMd(list) {
    if (list.length === 1) {
      F.download(articleMarkdown(list[0], options().frontMatter), `${F.sanitizeFilename(list[0].title, 80)}.md`, 'text/markdown;charset=utf-8');
    } else {
      F.download(combinedMarkdown(list), `${baseFilename()}.md`, 'text/markdown;charset=utf-8');
    }
  }

  const blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

  const DOC_CSS = `
    :root { color-scheme: light; }
    body { font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif;
      color: #1c2430; line-height: 1.8; margin: 0; background: #fff; font-size: 15px; }
    .wrap { max-width: 860px; margin: 0 auto; padding: 32px 28px 64px; }
    a { color: #2357c6; word-break: break-all; }
    header.doc { border-bottom: 3px solid #1c2430; margin-bottom: 24px; padding-bottom: 12px; }
    header.doc h1 { margin: 0; font-size: 26px; }
    header.doc p { margin: 4px 0 0; color: #5d6b7c; font-size: 13px; }
    nav.toc ol { padding-left: 1.4em; }
    nav.toc li { margin: 2px 0; }
    article { margin-top: 40px; }
    article + article { border-top: 1px solid #dde3ea; padding-top: 32px; }
    .meta { font-size: 12.5px; color: #5d6b7c; background: #f4f6f9; border-radius: 6px; padding: 8px 12px; margin: 0 0 20px; }
    .meta div { word-break: break-all; }
    .shot { margin: 0 0 20px; border: 1px solid #dde3ea; }
    .shot img { display: block; width: 100%; }
    h1, h2, h3, h4 { line-height: 1.4; margin: 1.5em 0 .6em; }
    article > h1:first-child { margin-top: 0; font-size: 24px; }
    .body h1 { font-size: 1.5em; } .body h2 { font-size: 1.3em; border-bottom: 1px solid #dde3ea; padding-bottom: .2em; } .body h3 { font-size: 1.12em; }
    img { max-width: 100%; height: auto; }
    pre { background: #f2f4f7; padding: 12px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; font-size: 13px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; background: #f2f4f7; padding: .1em .3em; border-radius: 3px; }
    pre code { background: none; padding: 0; }
    blockquote { margin: 1em 0; padding: .2em 1em; border-left: 4px solid #c5ced9; color: #5d6b7c; }
    table { border-collapse: collapse; margin: 1em 0; font-size: 13.5px; }
    th, td { border: 1px solid #dde3ea; padding: 5px 9px; }
    th { background: #f4f6f9; }
    hr { border: 0; border-top: 1px solid #dde3ea; margin: 2em 0; }
    li.task { list-style: none; }
    @page { size: A4; margin: 15mm 14mm; }
    @media print {
      body { font-size: 11pt; }
      .wrap { max-width: none; padding: 0; }
      article { break-before: page; margin-top: 0; border-top: 0 !important; padding-top: 0 !important; }
      nav.toc + article, .single article { break-before: auto; }
      a { color: inherit; text-decoration: underline; }
      pre, blockquote, table, img, .shot { break-inside: avoid; }
      h1, h2, h3, h4 { break-after: avoid; }
    }`;

  async function buildHtml(list, title) {
    const esc = MD.escapeHtml;
    const single = list.length === 1;
    const now = F.formatDate(new Date(), 'yyyy-MM-dd HH:mm');
    const articles = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const base = it.finalUrl || it.url;
      let shot = '';
      const blob = shotBlobs.get(it.id);
      const shotSrc = blob ? await blobToDataUrl(blob) : it.screenshotUrl;
      if (shotSrc) shot = `<figure class="shot"><img src="${esc(shotSrc)}" alt="スクリーンショット"></figure>`;
      articles.push(`<article id="a${i + 1}">
<h1>${esc(it.title)}</h1>
<div class="meta">
  <div>出典: <a href="${esc(base)}">${esc(base)}</a></div>
  <div>取得日時: ${esc(F.formatDate(new Date(it.fetchedAt), 'yyyy-MM-dd HH:mm:ss'))}${it.viewport ? ` / ビューポート: ${it.viewport.width}×${it.viewport.height}` : ''}${it.publishedTime ? ` / 公開: ${esc(it.publishedTime)}` : ''}</div>
</div>
${shot}
<div class="body">${MD.render(it.content || '', { baseUrl: base })}</div>
</article>`);
    }
    const toc = single ? '' : `<nav class="toc"><h2>目次</h2><ol>${list.map((it, i) => `<li><a href="#a${i + 1}">${esc(it.title)}</a></li>`).join('')}</ol></nav>`;
    const header = single ? '' : `<header class="doc"><h1>${esc(title)}</h1><p>${list.length} ページ / 作成: ${esc(now)} / Fedget Utils Blog Snapshot</p></header>`;
    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Fedget Utils Blog Snapshot">
<title>${esc(single ? list[0].title : title)}</title>
<style>${DOC_CSS}</style>
</head>
<body class="${single ? 'single' : ''}"><div class="wrap">
${header}
${toc}
${articles.join('\n')}
</div></body>
</html>
`;
  }

  /** 印刷用ウィンドウを開いて印刷ダイアログを表示 (PDF に保存) */
  async function printPdf(list) {
    // ユーザー操作の直後に開かないとポップアップブロックされるため先に開く
    const win = window.open('', '_blank');
    await F.task.run('PDF 作成', async (task) => {
      task.step('印刷用 HTML を生成中');
      const html = await buildHtml(list, list.length === 1 ? list[0].title : baseFilename());
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        task.step('画像の読込を待っています');
        await waitImages(win.document, 15000);
        win.focus();
        win.print();
        return '印刷ダイアログを開きました (送信先で「PDF に保存」を選択)';
      }
      // ポップアップがブロックされた場合は iframe で印刷
      const frame = el('iframe', { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0', title: 'print' });
      document.body.append(frame);
      frame.srcdoc = html;
      await new Promise(r => frame.addEventListener('load', r, { once: true }));
      task.step('画像の読込を待っています');
      await waitImages(frame.contentDocument, 15000);
      const prevTitle = document.title;
      document.title = list.length === 1 ? list[0].title : baseFilename();
      frame.contentWindow.focus();
      frame.contentWindow.print();
      document.title = prevTitle;
      setTimeout(() => frame.remove(), 60_000);
      return '印刷ダイアログを開きました (送信先で「PDF に保存」を選択)';
    }).catch(() => { if (win) win.close(); });
  }

  function waitImages(doc, timeout) {
    const imgs = Array.from(doc.images).filter(img => !img.complete);
    imgs.forEach(img => { img.loading = 'eager'; });
    return Promise.race([
      Promise.all(imgs.map(img => new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }))),
      F.sleep(timeout),
    ]);
  }

  F.$$('[data-export]').forEach(btn => btn.addEventListener('click', async () => {
    const list = doneItems();
    if (!list.length) { F.notify('取得済みのページがありません', 'warn'); return; }
    const kind = btn.dataset.export;
    const name = baseFilename();
    if (kind === 'md') { downloadMd(list); return; }
    if (kind === 'pdf') { printPdf(list); return; }
    if (kind === 'json') {
      const data = { generator: 'Fedget Utils Blog Snapshot', createdAt: new Date().toISOString(), pages: list.map(({ id, status, ...rest }) => rest) };
      F.download(JSON.stringify(data, null, 2), `${name}.json`, 'application/json');
      return;
    }
    if (kind === 'html') {
      await F.task.run('HTML 作成', async (task) => {
        task.step('HTML を生成中');
        F.download(await buildHtml(list, name), `${name}.html`, 'text/html;charset=utf-8');
        return `${list.length}ページを HTML で保存しました`;
      });
      return;
    }
    if (kind === 'zip') {
      await F.task.run('ZIP 作成', async (task) => {
        const files = [];
        const fm = options().frontMatter;
        const index = [`# ${name}`, ''];
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          const fname = articleFilename(it, i);
          task.step(`[${i + 1}/${list.length}] ${it.title} を変換中`, i / list.length);
          const blob = shotBlobs.get(it.id);
          let shotRef = null;
          if (blob) {
            const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
            const shotName = `images/${fname}.${ext}`;
            files.push({ name: shotName, data: blob });
            shotRef = () => shotName;
          }
          files.push({ name: `${fname}.md`, data: articleMarkdown(it, fm, { screenshotRef: shotRef }) });
          files.push({ name: `html/${fname}.html`, data: await buildHtml([it], it.title) });
          index.push(`${i + 1}. [${it.title.replace(/[[\]]/g, '\\$&')}](${encodeURI(fname)}.md) — <${it.finalUrl || it.url}>`);
        }
        files.unshift({ name: 'index.md', data: index.join('\n') + '\n' });
        files.push({ name: `${name}.html`, data: await buildHtml(list, name) });
        task.step('ZIP を圧縮中');
        const zip = await FedgetZip.create(files, { onProgress: (d, n) => task.progress(d / n) });
        F.download(zip, `${name}.zip`, 'application/zip');
        return `${list.length}ページを ZIP で保存しました (${F.formatBytes(zip.size)})`;
      });
    }
  }));

  render();
  setRunning(false);
  const first = items.find(x => x.status === 'done');
  if (first) select(first.id);
})();
