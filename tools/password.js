/* パスワード生成 */
(function () {
  'use strict';
  const F = Fedget;
  const { $, el } = F;

  const SETS = {
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    digit: '0123456789',
  };
  const AMBIGUOUS = 'Il1O0o';
  const PRESETS = {
    standard: { length: 16, upper: true, lower: true, digit: true, symbol: true, ambiguous: true, require: true },
    strong: { length: 32, upper: true, lower: true, digit: true, symbol: true, ambiguous: false, require: true },
    alnum: { length: 20, upper: true, lower: true, digit: true, symbol: false, ambiguous: true, require: true },
    pin: { length: 6, upper: false, lower: false, digit: true, symbol: false, ambiguous: false, require: true },
  };

  const form = $('#pw-form');
  const persist = F.persistForm(form, 'password');
  const lengthInput = $('#pw-length');
  const lengthRange = $('#pw-length-range');
  let results = [];

  function syncLength(from) {
    let v = parseInt(from.value, 10) || 1;
    v = Math.max(1, Math.min(1024, v));
    lengthInput.value = v;
    lengthRange.value = Math.min(v, 128);
    $('#pw-length-label').textContent = v;
  }
  lengthRange.addEventListener('input', () => { syncLength(lengthRange); persist.save(); updatePoolInfo(); });
  lengthInput.addEventListener('input', () => { syncLength(lengthInput); updatePoolInfo(); });
  form.addEventListener('change', updatePoolInfo);
  form.addEventListener('input', updatePoolInfo);

  F.$$('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset];
    lengthInput.value = p.length;
    ['upper', 'lower', 'digit', 'symbol', 'ambiguous', 'require'].forEach(k => { $('#pw-' + k).checked = p[k]; });
    syncLength(lengthInput);
    persist.save();
    updatePoolInfo();
    generate();
  }));

  /** 設定から文字クラス (除外適用済み) を作る */
  function getOptions() {
    const exclude = new Set(Array.from($('#pw-exclude').value));
    if ($('#pw-ambiguous').checked) Array.from(AMBIGUOUS).forEach(c => exclude.add(c));
    const filter = s => Array.from(new Set(Array.from(s))).filter(c => !exclude.has(c) && !/\s/.test(c)).join('');
    const classes = [];
    if ($('#pw-upper').checked) classes.push({ name: '大文字', chars: filter(SETS.upper) });
    if ($('#pw-lower').checked) classes.push({ name: '小文字', chars: filter(SETS.lower) });
    if ($('#pw-digit').checked) classes.push({ name: '数字', chars: filter(SETS.digit) });
    if ($('#pw-symbol').checked) classes.push({ name: '記号', chars: filter($('#pw-symbols').value) });
    const usable = classes.filter(c => c.chars.length);
    const pool = Array.from(new Set(usable.map(c => c.chars).join(''))).join('');
    return {
      length: Math.max(1, Math.min(1024, parseInt(lengthInput.value, 10) || 16)),
      count: Math.max(1, Math.min(10000, parseInt($('#pw-count').value, 10) || 1)),
      classes: usable,
      emptyClasses: classes.filter(c => !c.chars.length),
      pool,
      require: $('#pw-require').checked,
      noRepeat: $('#pw-norepeat').checked,
    };
  }

  function entropyBits(length, poolSize) {
    return poolSize > 1 ? length * Math.log2(poolSize) : 0;
  }

  function strength(bits) {
    if (bits < 28) return { label: '非常に弱い', color: 'var(--danger)', ratio: .1 };
    if (bits < 36) return { label: '弱い', color: 'var(--danger)', ratio: .25 };
    if (bits < 60) return { label: '普通', color: 'var(--warn)', ratio: .5 };
    if (bits < 128) return { label: '強い', color: 'var(--success)', ratio: .8 };
    return { label: '非常に強い', color: 'var(--success)', ratio: 1 };
  }

  function updatePoolInfo() {
    const o = getOptions();
    const bits = entropyBits(o.length, o.pool.length);
    const s = strength(bits);
    $('#pw-pool').textContent = o.pool.length ? `候補文字 ${o.pool.length} 種類` : '使用する文字を選択してください';
    $('#pw-entropy').textContent = `${bits.toFixed(1)} bit`;
    $('#pw-strength-label').textContent = o.pool.length ? s.label : '-';
    $('#pw-strength-label').style.color = s.color;
    const meter = $('#pw-meter');
    meter.style.width = (o.pool.length ? s.ratio * 100 : 0) + '%';
    meter.style.background = s.color;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = F.randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const pick = s => s[F.randomInt(s.length)];

  function makePassword(o) {
    const chars = [];
    if (o.require && o.length >= o.classes.length) o.classes.forEach(c => chars.push(pick(c.chars)));
    while (chars.length < o.length) chars.push(pick(o.pool));
    shuffle(chars);
    if (o.noRepeat && o.pool.length > 1) {
      // 直前と同じ文字は、同じ文字種の中から前後と異なる文字に置き換える (必須文字種を維持)
      for (let i = 1; i < chars.length; i++) {
        if (chars[i] !== chars[i - 1]) continue;
        const cls = o.classes.find(c => c.chars.includes(chars[i]));
        const avoid = c => c === chars[i - 1] || c === chars[i + 1];
        let cand = cls ? Array.from(cls.chars).filter(c => !avoid(c)) : [];
        if (!cand.length) cand = Array.from(o.pool).filter(c => !avoid(c));
        if (cand.length) chars[i] = cand[F.randomInt(cand.length)];
      }
    }
    return chars.join('');
  }

  async function generate() {
    const o = getOptions();
    if (!o.pool.length) { F.notify('使用する文字を1種類以上選択してください', 'warn'); return; }
    if (o.emptyClasses.length) F.notify(`${o.emptyClasses.map(c => c.name).join('・')} は除外設定によって候補がありません`, 'warn');
    await F.task.run('パスワード生成', async (task) => {
      results = [];
      for (let i = 0; i < o.count; i++) {
        results.push(makePassword(o));
        if (i % 500 === 499) { task.step(`生成中 ${i + 1}/${o.count}`, (i + 1) / o.count); await F.yieldUI(); }
      }
      render();
      return `${o.count}件のパスワードを生成しました (${o.length}桁)`;
    }, { quiet: true });
  }

  function render() {
    const box = $('#pw-results');
    box.textContent = '';
    const show = results.slice(0, 200);
    show.forEach(pw => box.append(el('div', { class: 'copy-row' },
      el('div', { class: 'output' }, pw),
      el('button', { class: 'btn btn-sm', type: 'button', onclick: () => F.copyText(pw) }, 'コピー'))));
    if (results.length > show.length) box.append(el('div', { class: 'hint' }, `ほか ${results.length - show.length} 件 (コピー/ダウンロードで全件取得できます)`));
    ['#pw-copy-all', '#pw-dl-txt', '#pw-dl-csv'].forEach(s => { $(s).disabled = !results.length; });
  }

  $('#pw-generate').addEventListener('click', generate);
  $('#pw-copy-all').addEventListener('click', () => F.copyText(results.join('\n'), `${results.length}件コピーしました`));
  $('#pw-dl-txt').addEventListener('click', () => F.download(results.join('\r\n') + '\r\n', `passwords_${F.formatDate()}.txt`, 'text/plain;charset=utf-8'));
  $('#pw-dl-csv').addEventListener('click', () => {
    const esc = s => /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    const csv = '﻿no,password\r\n' + results.map((p, i) => `${i + 1},${esc(p)}`).join('\r\n') + '\r\n';
    F.download(csv, `passwords_${F.formatDate()}.csv`, 'text/csv;charset=utf-8');
  });

  // ---------- 強度チェック ----------
  const checkInput = $('#pw-check');
  $('#pw-check-show').addEventListener('change', e => { checkInput.type = e.target.checked ? 'text' : 'password'; });
  checkInput.addEventListener('input', () => {
    const v = checkInput.value;
    const out = $('#pw-check-result');
    if (!v) { out.textContent = '-'; out.style.color = ''; return; }
    let pool = 0;
    const kinds = [];
    if (/[a-z]/.test(v)) { pool += 26; kinds.push('小文字'); }
    if (/[A-Z]/.test(v)) { pool += 26; kinds.push('大文字'); }
    if (/[0-9]/.test(v)) { pool += 10; kinds.push('数字'); }
    if (/[^a-zA-Z0-9]/.test(v)) { pool += 33; kinds.push('記号等'); }
    const len = Array.from(v).length;
    let bits = entropyBits(len, pool);
    const warns = [];
    if (/(.)\1{2,}/.test(v)) { warns.push('同じ文字の繰り返し'); bits *= 0.8; }
    if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf|zxcv)/i.test(v)) { warns.push('連続した並び'); bits *= 0.8; }
    if (/^(password|passw0rd|admin|qwerty|letmein|welcome|iloveyou|abc123|123456)/i.test(v)) { warns.push('よく使われる語'); bits = Math.min(bits, 10); }
    const s = strength(bits);
    out.textContent = `${s.label} — 約 ${bits.toFixed(0)} bit / ${len}文字 / ${kinds.join('・')}` + (warns.length ? ` ⚠ ${warns.join('、')}` : '');
    out.style.color = s.color;
  });

  syncLength(lengthInput);
  updatePoolInfo();
})();
