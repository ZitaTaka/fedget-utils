/* 画像貼付け→ファイル */
(function () {
  'use strict';
  const F = Fedget;
  const IMG = FedgetImage;
  const { $, el } = F;

  const form = $('#ip-form');
  F.persistForm(form, 'image-paste');

  const items = [];
  let seq = 0;

  // ---------------- 設定 ----------------
  function settings() {
    return {
      format: $('#ip-format').value,
      quality: parseInt($('#ip-quality').value, 10) / 100,
      background: $('#ip-bg').value,
      resize: $('#ip-resize').value,
      maxW: parseInt($('#ip-max-w').value, 10) || undefined,
      maxH: parseInt($('#ip-max-h').value, 10) || undefined,
      scale: parseInt($('#ip-scale').value, 10) || 100,
      template: $('#ip-name').value || 'image_{date}',
    };
  }

  function syncForm() {
    const s = settings();
    const fmt = IMG.FORMATS[s.format];
    $('#ip-quality-box').hidden = !fmt.lossy;
    $('#ip-bg-box').hidden = fmt.alpha;
    $('#ip-quality-label').textContent = $('#ip-quality').value;
    F.$$('[data-resize]').forEach(f => { f.hidden = f.dataset.resize !== s.resize; });
  }

  function applyTemplate(item, out) {
    const s = settings();
    const name = s.template
      .replace(/\{date\}/g, F.formatDate(item.addedAt))
      .replace(/\{n\}/g, String(item.n).padStart(2, '0'))
      .replace(/\{name\}/g, item.baseName)
      .replace(/\{w\}/g, out ? out.width : item.width)
      .replace(/\{h\}/g, out ? out.height : item.height);
    return F.sanitizeFilename(name, 120);
  }

  // ---------------- 追加 ----------------
  async function addBlobs(blobs, source) {
    const images = blobs.filter(b => b && (b.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(b.name || '')));
    if (!images.length) { F.notify('画像が見つかりませんでした', 'warn'); return; }
    await F.task.run('画像の読込', async (task) => {
      for (let i = 0; i < images.length; i++) {
        const blob = images[i];
        task.step(`画像を読込中 ${i + 1}/${images.length}`, i / images.length);
        try {
          const loaded = await IMG.loadImage(blob);
          const rawName = blob.name && !/^image\.(png|jpe?g)$/i.test(blob.name) ? blob.name : '';
          items.push({
            id: ++seq, n: seq,
            addedAt: new Date(),
            baseName: rawName ? rawName.replace(/\.[^.]+$/, '') : 'image',
            srcType: blob.type || '不明', srcSize: blob.size,
            img: loaded.img, url: loaded.url, width: loaded.width, height: loaded.height,
            customName: null, out: null, outError: null, source,
          });
        } catch (e) {
          F.notify(`${blob.name || '画像'}: ${e.message}`, 'error');
        }
      }
      render();
      await convertAll(task);
      return `${images.length}枚の画像を追加しました`;
    }, { quiet: true });
  }

  // 貼り付け (ページ全体)
  document.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = Array.from(cd.items || []).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
    const inText = e.target.matches && e.target.matches('input, textarea, [contenteditable]');
    if (files.length) { e.preventDefault(); addBlobs(files, '貼り付け'); return; }
    if (inText) return;
    // HTML 内の data URL 画像 / テキストの data URL
    const html = cd.getData('text/html') || '';
    const text = cd.getData('text/plain') || '';
    const dataUrls = [...html.matchAll(/<img[^>]+src="(data:image\/[^"]+)"/gi)].map(m => m[1]);
    if (/^data:image\//.test(text.trim())) dataUrls.push(text.trim());
    if (dataUrls.length) {
      e.preventDefault();
      const blobs = await Promise.all(dataUrls.map(u => fetch(u).then(r => r.blob())));
      addBlobs(blobs, '貼り付け');
    } else if (html.match(/<img/i) || /^https?:\/\/\S+\.(png|jpe?g|gif|webp)/i.test(text.trim())) {
      F.notify('画像の URL のみ貼り付けられました。画像そのものをコピーするか、ファイルとして保存してドロップしてください', 'warn', 6000);
    } else {
      F.notify('クリップボードに画像がありません', 'warn');
    }
  });

  $('#ip-clipboard').addEventListener('click', async () => {
    if (!navigator.clipboard || !navigator.clipboard.read) { F.notify('このブラウザはクリップボード読込に対応していません。Ctrl+V で貼り付けてください', 'warn'); return; }
    try {
      const clip = await navigator.clipboard.read();
      const blobs = [];
      for (const it of clip) {
        const t = it.types.find(x => x.startsWith('image/'));
        if (t) blobs.push(await it.getType(t));
      }
      if (!blobs.length) { F.notify('クリップボードに画像がありません', 'warn'); return; }
      addBlobs(blobs, 'クリップボード');
    } catch (e) {
      F.notify(`クリップボードを読めませんでした: ${e.message}`, 'error');
    }
  });

  const drop = $('#ip-drop');
  const fileInput = $('#ip-file');
  fileInput.addEventListener('change', () => { addBlobs(Array.from(fileInput.files), 'ファイル'); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', e => { e.preventDefault(); addBlobs(Array.from(e.dataTransfer.files || []), 'ドロップ'); });
  // ページのどこにドロップしてもブラウザで開かないように
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { if (!drop.contains(e.target)) { e.preventDefault(); addBlobs(Array.from(e.dataTransfer.files || []), 'ドロップ'); } });

  // ---------------- 変換 ----------------
  let convertSeq = 0;
  async function convertAll(task) {
    const mySeq = ++convertSeq;
    const s = settings();
    for (let i = 0; i < items.length; i++) {
      if (mySeq !== convertSeq) return;
      const it = items[i];
      if (task && items.length > 1) task.step(`${s.format.toUpperCase()} に変換中 ${i + 1}/${items.length}`, i / items.length);
      try {
        it.out = await IMG.convert(it.img, it.width, it.height, s);
        it.outError = null;
      } catch (e) {
        it.out = null;
        it.outError = e.message;
      }
      updateCard(it);
      await F.yieldUI();
    }
  }

  let convertTimer = null;
  form.addEventListener('input', () => {
    syncForm();
    clearTimeout(convertTimer);
    convertTimer = setTimeout(() => {
      if (!items.length) return;
      F.task.run('再変換', async (task) => { await convertAll(task); return `${items.length}枚を ${settings().format.toUpperCase()} で再変換しました`; }, { quiet: true });
    }, 300);
  });
  form.addEventListener('change', () => form.dispatchEvent(new Event('input')));

  // ---------------- 表示 ----------------
  function render() {
    const list = $('#ip-list');
    list.textContent = '';
    items.forEach(it => { it.card = buildCard(it); list.append(it.card); updateCard(it); });
    $('#ip-empty').hidden = items.length > 0;
    $('#ip-count').textContent = items.length;
    $('#ip-dl-all').disabled = $('#ip-clear').disabled = !items.length;
  }

  function buildCard(it) {
    const nameInput = el('input', { type: 'text', 'aria-label': 'ファイル名' });
    nameInput.addEventListener('input', () => { it.customName = nameInput.value; });
    const card = el('div', { class: 'img-card' },
      el('div', { class: 'img-thumb' }, el('img', { src: it.url, alt: '' })),
      el('div', { class: 'img-body' },
        el('div', { class: 'img-meta' },
          el('span', null, `元: ${it.width}×${it.height}`),
          el('span', null, it.srcType.replace('image/', '').toUpperCase()),
          el('span', null, F.formatBytes(it.srcSize))),
        el('div', { class: 'img-meta', dataset: { role: 'out' } }),
        el('div', { class: 'row', style: 'gap:4px; flex-wrap:nowrap' }, nameInput, el('span', { class: 'hint', dataset: { role: 'ext' } })),
        el('div', { class: 'img-actions' },
          el('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => downloadOne(it) }, '保存'),
          el('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyImage(it) }, 'PNGでコピー'),
          el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => removeItem(it) }, '削除'))));
    card._name = nameInput;
    return card;
  }

  function updateCard(it) {
    if (!it.card) return;
    const out = it.card.querySelector('[data-role="out"]');
    out.textContent = '';
    if (it.outError) out.append(el('span', { style: 'color:var(--danger)' }, '⚠ ' + it.outError));
    else if (it.out) {
      const ratio = it.srcSize ? it.out.blob.size / it.srcSize : 1;
      out.append(
        el('span', null, `出力: ${it.out.width}×${it.out.height}`),
        el('span', null, it.out.ext.toUpperCase()),
        el('strong', { style: 'color:' + (ratio <= 1 ? 'var(--success)' : 'var(--text)') }, F.formatBytes(it.out.blob.size)),
        el('span', null, `(${(ratio * 100).toFixed(0)}%)`));
    } else out.append(el('span', null, '変換中…'));
    if (it.customName === null) it.card._name.value = applyTemplate(it, it.out);
    it.card.querySelector('[data-role="ext"]').textContent = '.' + (it.out ? it.out.ext : IMG.FORMATS[settings().format].ext);
  }

  function filenameOf(it) {
    const base = F.sanitizeFilename(it.customName !== null ? it.customName : applyTemplate(it, it.out), 120);
    return `${base}.${it.out.ext}`;
  }

  function downloadOne(it) {
    if (!it.out) { F.notify(it.outError || '変換が完了していません', 'warn'); return; }
    F.download(it.out.blob, filenameOf(it));
    F.notify(`${filenameOf(it)} を保存しました`, 'success');
  }

  async function copyImage(it) {
    try {
      const size = { width: it.out ? it.out.width : it.width, height: it.out ? it.out.height : it.height };
      const png = await IMG.canvasToBlob(IMG.toCanvas(it.img, size.width, size.height), 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      F.notify('PNG としてクリップボードにコピーしました', 'success');
    } catch (e) {
      F.notify(`コピーできませんでした: ${e.message}`, 'error');
    }
  }

  function removeItem(it) {
    const i = items.indexOf(it);
    if (i >= 0) items.splice(i, 1);
    URL.revokeObjectURL(it.url);
    render();
  }

  $('#ip-clear').addEventListener('click', () => {
    items.splice(0).forEach(it => URL.revokeObjectURL(it.url));
    render();
  });

  $('#ip-dl-all').addEventListener('click', async () => {
    const ready = items.filter(it => it.out);
    if (!ready.length) { F.notify('保存できる画像がありません', 'warn'); return; }
    if (ready.length === 1) { downloadOne(ready[0]); return; }
    await F.task.run('ZIP 作成', async (task) => {
      task.step(`${ready.length}枚を ZIP にまとめています`);
      const blob = await FedgetZip.create(ready.map(it => ({ name: filenameOf(it), data: it.out.blob, date: it.addedAt })),
        { compress: false, onProgress: (d, n) => task.progress(d / n) });
      F.download(blob, `images_${F.formatDate()}.zip`, 'application/zip');
      return `${ready.length}枚を ZIP で保存しました (${F.formatBytes(blob.size)})`;
    });
  });

  syncForm();
  render();
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
})();
