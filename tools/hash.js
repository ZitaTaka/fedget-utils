/* ハッシュ計算 */
(function () {
  'use strict';
  const F = Fedget;
  const D = FedgetDigest;
  const { $, el } = F;
  const CHUNK = 4 * 1024 * 1024;

  // アルゴリズム選択肢を生成 (persistForm より前に作る)
  const defaults = { md5: true, sha1: false, sha256: true, sha384: false, sha512: false, crc32: false };
  D.ALGORITHMS.forEach(a => {
    $('#hs-algos').append(el('label', { class: 'check' },
      el('input', { type: 'checkbox', value: a.id, 'data-persist': 'alg_' + a.id, checked: defaults[a.id] }), a.label));
  });
  F.persistForm($('main'), 'hash');

  const state = {
    text: null,       // { label, size, rows: [{alg, bytes}] }
    files: [],        // [{ name, size, rows }]
    fileList: [],     // 再計算用に保持する File
    cancel: false,
    running: false,
  };

  const selectedAlgs = () => F.$$('#hs-algos input:checked').map(i => i.value);
  const useHmac = () => $('#hs-hmac').checked;

  function hmacKey() {
    const v = $('#hs-hmac-key').value;
    const fmt = $('#hs-hmac-format').value;
    if (fmt === 'hex') return F.hexToBytes(v);
    if (fmt === 'base64') return F.base64ToBytes(v);
    return new TextEncoder().encode(v);
  }

  function effectiveAlgs() {
    let algs = selectedAlgs();
    if (useHmac()) algs = algs.filter(a => D.byId[a].hmac);
    return algs;
  }

  function algLabel(id) { return (useHmac() ? 'HMAC-' : '') + D.byId[id].label; }

  function fmt(bytes) {
    const f = $('#hs-format').value;
    if (f === 'base64') return F.bytesToBase64(bytes);
    return F.bytesToHex(bytes, f === 'HEX');
  }

  // ---------------- テキスト ----------------
  function textBytes() {
    let v = $('#hs-text').value;
    const f = $('#hs-text-format').value;
    if (f === 'hex') return F.hexToBytes(v);
    if (f === 'base64') return F.base64ToBytes(v);
    if ($('#hs-newline').value === 'crlf') v = v.replace(/\r?\n/g, '\r\n');
    return new TextEncoder().encode(v);
  }

  let textTimer = null;
  let textSeq = 0;
  async function computeText() {
    const seq = ++textSeq;
    const raw = $('#hs-text').value;
    if (raw === '') { state.text = null; $('#hs-text-size').textContent = '0 バイト'; render(); return; }
    let data;
    try { data = textBytes(); }
    catch (e) { $('#hs-text-size').textContent = '⚠ ' + e.message; state.text = null; render(); return; }
    $('#hs-text-size').textContent = `${data.length.toLocaleString()} バイト`;
    try {
      const key = useHmac() ? hmacKey() : null;
      const rows = [];
      for (const alg of effectiveAlgs()) {
        rows.push({ alg, bytes: key ? await D.hmac(alg, key, data) : await D.hash(alg, data) });
      }
      if (seq !== textSeq) return;
      state.text = { label: 'テキスト入力', size: data.length, rows };
      render();
    } catch (e) {
      if (seq !== textSeq) return;
      state.text = null;
      render();
      F.notify(e.message, 'error');
    }
  }
  const scheduleText = () => { clearTimeout(textTimer); textTimer = setTimeout(computeText, 150); };
  ['#hs-text', '#hs-text-format', '#hs-newline'].forEach(s => $(s).addEventListener('input', scheduleText));
  $('#hs-text-format').addEventListener('change', scheduleText);
  $('#hs-newline').addEventListener('change', scheduleText);

  // ---------------- ファイル ----------------
  /** MD5 / CRC32 / HMAC-MD5 の逐次計算器 */
  function streamer(alg, key) {
    if (alg === 'crc32') { const c = new D.CRC32(); return { update: u => c.update(u), digest: () => c.digest() }; }
    if (alg === 'md5' && !key) { const m = new D.MD5(); return { update: u => m.update(u), digest: () => m.digest() }; }
    if (alg === 'md5' && key) {
      const k0 = new Uint8Array(64);
      k0.set(key.length > 64 ? D.md5(key) : key);
      const inner = new D.MD5().update(k0.map(b => b ^ 0x36));
      return {
        update: u => inner.update(u),
        digest: () => new D.MD5().update(k0.map(b => b ^ 0x5c)).update(inner.digest()).digest(),
      };
    }
    return null;
  }

  async function computeFiles(files) {
    if (state.running) { F.notify('計算中です。完了または中止してから実行してください', 'warn'); return; }
    const algs = effectiveAlgs();
    if (!algs.length) { F.notify('アルゴリズムを1つ以上選択してください', 'warn'); return; }
    let key = null;
    try { if (useHmac()) key = hmacKey(); } catch (e) { F.notify(e.message, 'error'); return; }
    if (key && !key.length) { F.notify('HMAC キーを入力してください', 'warn'); return; }

    state.fileList = files;
    state.files = [];
    state.cancel = false;
    state.running = true;
    $('#hs-cancel').disabled = false;
    $('#hs-recalc').disabled = true;
    render();

    const n = files.length;
    try {
      await F.task.run('ハッシュ計算', async (task) => {
        for (let i = 0; i < n; i++) {
          const file = files[i];
          const tag = n > 1 ? `[${i + 1}/${n}] ` : '';
          const rows = [];
          const streamAlgs = algs.filter(a => !D.byId[a].subtle);
          const subtleAlgs = algs.filter(a => D.byId[a].subtle);
          const base = i / n;

          if (subtleAlgs.length) {
            // SHA 系: ファイル全体を読み込んでから計算
            task.step(`${tag}${file.name} を読込中 (${F.formatBytes(file.size)})`, base);
            const buf = new Uint8Array(await readWithProgress(file, (p) => task.progress(base + p * 0.5 / n)));
            if (state.cancel) throw new Error('中止しました');
            for (const alg of algs) {
              task.step(`${tag}${file.name}: ${algLabel(alg)} を計算中`);
              const s = streamer(alg, key);
              let bytes;
              if (s) {
                for (let o = 0; o < buf.length; o += CHUNK) {
                  s.update(buf.subarray(o, o + CHUNK));
                  await F.yieldUI();
                  if (state.cancel) throw new Error('中止しました');
                }
                if (!buf.length) s.update(buf);
                bytes = s.digest();
              } else {
                bytes = key ? await D.hmac(alg, key, buf) : await D.hash(alg, buf);
              }
              rows.push({ alg, bytes });
              task.progress(base + (0.5 + 0.5 * rows.length / algs.length) / n);
            }
          } else {
            // MD5 / CRC32 のみ: 分割読込でストリーム計算
            const ss = streamAlgs.map(a => ({ alg: a, s: streamer(a, key) }));
            const label = streamAlgs.map(algLabel).join(', ');
            for (let o = 0; o < file.size || o === 0; o += CHUNK) {
              const chunk = new Uint8Array(await file.slice(o, o + CHUNK).arrayBuffer());
              ss.forEach(x => x.s.update(chunk));
              const p = file.size ? Math.min(1, (o + CHUNK) / file.size) : 1;
              task.step(`${tag}${file.name}: ${label} 計算中 ${(p * 100).toFixed(0)}%`, base + p / n);
              if (state.cancel) throw new Error('中止しました');
              if (!file.size) break;
            }
            ss.forEach(x => rows.push({ alg: x.alg, bytes: x.s.digest() }));
          }
          state.files.push({ name: file.name, size: file.size, rows });
          render();
        }
        return `${n}件のファイルを計算しました`;
      }, { quiet: true });
    } catch (e) {
      /* トップバーにエラー表示済み */
    } finally {
      state.running = false;
      $('#hs-cancel').disabled = true;
      $('#hs-recalc').disabled = !state.fileList.length;
      render();
    }
  }

  async function readWithProgress(file, onProgress) {
    if (file.size <= CHUNK) return file.arrayBuffer();
    const out = new Uint8Array(file.size);
    for (let o = 0; o < file.size; o += CHUNK) {
      out.set(new Uint8Array(await file.slice(o, o + CHUNK).arrayBuffer()), o);
      onProgress(Math.min(1, (o + CHUNK) / file.size));
      if (state.cancel) break;
    }
    return out.buffer;
  }

  const drop = $('#hs-drop');
  const fileInput = $('#hs-file');
  fileInput.addEventListener('change', () => { if (fileInput.files.length) computeFiles(Array.from(fileInput.files)); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) computeFiles(files);
  });
  $('#hs-cancel').addEventListener('click', () => { state.cancel = true; });
  $('#hs-recalc').addEventListener('click', () => computeFiles(state.fileList));

  // 設定変更時は再計算 (テキストは即時、ファイルはボタンで)
  $('#hs-form').addEventListener('change', () => {
    scheduleText();
    if (state.fileList.length && !state.running) F.notify('設定が変わりました。ファイルは「再計算」で更新できます', 'info');
  });
  $('#hs-hmac-key').addEventListener('input', scheduleText);
  $('#hs-format').addEventListener('change', render);
  $('#hs-expected').addEventListener('input', render);

  // ---------------- 表示 ----------------
  function normalizeExpected() {
    return $('#hs-expected').value.trim().replace(/\s+/g, '').split(/[*\s]/)[0];
  }
  function isMatch(bytes, expected) {
    if (!expected) return false;
    const hex = F.bytesToHex(bytes);
    if (expected.toLowerCase() === hex) return true;
    const b64 = F.bytesToBase64(bytes);
    return expected === b64 || expected === b64.replace(/=+$/, '') || expected === F.bytesToBase64Url(bytes);
  }

  function allEntries() {
    const list = [];
    if (state.text) list.push(state.text);
    list.push(...state.files);
    return list;
  }

  function render() {
    const tbody = $('#hs-results');
    tbody.textContent = '';
    const expected = normalizeExpected();
    const entries = allEntries();
    let matched = 0;
    entries.forEach(entry => {
      entry.rows.forEach((r, idx) => {
        const value = fmt(r.bytes);
        const ok = isMatch(r.bytes, expected);
        if (ok) matched++;
        const tr = el('tr', { style: ok ? 'background: var(--success-soft)' : null },
          idx === 0 ? el('td', { rowspan: entry.rows.length }, entry.label || entry.name) : null,
          idx === 0 ? el('td', { rowspan: entry.rows.length, style: 'white-space:nowrap' }, F.formatBytes(entry.size)) : null,
          el('td', { style: 'white-space:nowrap' }, algLabel(r.alg), ok ? el('span', { class: 'tag tag-success', style: 'margin-left:6px' }, '✓ 一致') : null),
          el('td', { class: 'mono' }, value),
          el('td', null, el('button', { class: 'btn btn-sm', type: 'button', onclick: () => F.copyText(value) }, 'コピー')));
        tbody.append(tr);
      });
    });
    if (!entries.length) {
      tbody.append(el('tr', null, el('td', { colspan: 5, class: 'empty' },
        state.running ? '計算中…' : 'テキストを入力するかファイルを選択してください')));
    }
    const box = $('#hs-match');
    box.textContent = '';
    if (expected && entries.length) {
      box.append(el('div', { class: matched ? 'note' : 'note note-danger', style: 'margin-bottom:10px' + (matched ? ';color:var(--success)' : '') },
        matched ? `✓ 照合値と一致する結果が ${matched} 件あります` : '✗ 照合値と一致する結果はありません'));
    }
    const has = entries.some(e => e.rows.length);
    ['#hs-copy-sum', '#hs-dl-csv', '#hs-clear'].forEach(s => { $(s).disabled = !has; });
  }

  $('#hs-copy-sum').addEventListener('click', () => {
    // sha256sum / md5sum 互換の "ハッシュ  ファイル名" 形式で出力
    const lines = [];
    allEntries().forEach(e => e.rows.forEach(r => {
      lines.push(`${F.bytesToHex(r.bytes)}  ${e.name || '-'}  # ${algLabel(r.alg)}`);
    }));
    F.copyText(lines.join('\n'));
  });
  $('#hs-dl-csv').addEventListener('click', () => {
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = ['対象,サイズ(バイト),アルゴリズム,値'];
    allEntries().forEach(e => e.rows.forEach(r => lines.push([q(e.label || e.name), e.size, q(algLabel(r.alg)), q(fmt(r.bytes))].join(','))));
    F.download('﻿' + lines.join('\r\n') + '\r\n', `hash_${F.formatDate()}.csv`, 'text/csv;charset=utf-8');
  });
  $('#hs-clear').addEventListener('click', () => {
    state.files = []; state.fileList = []; state.text = null;
    $('#hs-text').value = '';
    $('#hs-text-size').textContent = '0 バイト';
    $('#hs-recalc').disabled = true;
    render();
  });

  render();
})();
