/*
 * Fedget Markdown renderer
 * 依存なしの軽量 Markdown → HTML 変換 (CommonMark/GFM の主要部分)。
 *   見出し (ATX / Setext), 段落, 強調, 打消し, インラインコード, コードブロック (フェンス / インデント),
 *   リンク, 画像, 自動リンク, 引用, 箇条書き (入れ子・タスク), 番号付きリスト, 表, 水平線, 改行
 * 外部サイト由来のテキストを扱うため、生の HTML はすべてエスケープし、危険な URL スキームは無効化する。
 */
(function (global) {
  'use strict';

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const RE = {
    fence: /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/,
    atx: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
    hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
    quote: /^ {0,3}> ?/,
    list: /^( *)([-*+]|\d{1,9}[.)])( +|\t|$)(.*)$/,
    setext1: /^ {0,3}=+[ \t]*$/,
    setext2: /^ {0,3}-+[ \t]*$/,
    tableDelim: /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/,
    blank: /^[ \t]*$/,
    indentCode: /^( {4}|\t)/,
  };

  const indentOf = l => l.match(/^ */)[0].length;

  function safeUrl(url, base, forImage) {
    let u = String(url || '').trim().replace(/^<|>$/g, '');
    if (!u) return '';
    if (/^(javascript|vbscript|file):/i.test(u)) return '';
    if (/^data:/i.test(u) && !(forImage && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u))) return '';
    if (base && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('#')) {
      try { u = new URL(u, base).href; } catch (e) { /* keep */ }
    }
    return u;
  }

  // ------------------------------------------------------------------
  // インライン
  // ------------------------------------------------------------------
  function inline(src, opt) {
    const slots = [];
    const put = html => `\u0001${slots.push(html) - 1}\u0001`;
    let s = String(src);

    // バックスラッシュエスケープ
    s = s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (m, c) => put(esc(c)));
    // 改行 (行末スペース2つ / バックスラッシュ)
    s = s.replace(/(?: {2,}|\\)\n/g, () => put('<br>'));
    // コードスパン
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, t, code) => put(`<code>${esc(code.replace(/^ (.*) $/, '$1'))}</code>`));
    // 自動リンク <https://...>
    s = s.replace(/<((?:https?|mailto):[^\s<>]+)>/gi, (m, u) => {
      const href = safeUrl(u, opt.baseUrl);
      return href ? put(`<a href="${esc(href)}">${esc(u)}</a>`) : m;
    });
    // 画像 ![alt](src "title")
    const linkTarget = '\\(\\s*(<[^>]*>|[^\\s()]*(?:\\([^\\s()]*\\)[^\\s()]*)*)(?:\\s+(?:"([^"]*)"|\'([^\']*)\'))?\\s*\\)';
    s = s.replace(new RegExp('!\\[([^\\]]*)\\]' + linkTarget, 'g'), (m, alt, u, t1, t2) => {
      const href = safeUrl(u, opt.baseUrl, true);
      if (!href) return put(esc(alt));
      const title = t1 || t2;
      return put(`<img src="${esc(href)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`);
    });
    // リンク [text](href "title")  (text 内の画像は置換済み)
    s = s.replace(new RegExp('\\[((?:[^\\[\\]]|\\[[^\\[\\]]*\\])*)\\]' + linkTarget, 'g'), (m, text, u, t1, t2) => {
      const href = safeUrl(u, opt.baseUrl);
      const title = t1 || t2;
      const inner = emphasis(escapeText(text));
      if (!href) return put(inner);
      const ext = /^https?:/i.test(href) && opt.externalLinks ? ' target="_blank" rel="noopener noreferrer"' : '';
      return put(`<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${ext}>${inner}</a>`);
    });

    s = escapeText(s);
    // 素の URL を自動リンク
    s = s.replace(/(^|[\s(（])((?:https?:\/\/)[^\s<>\u0001）)]+[^\s<>\u0001）).,;:!?'"、。])/g, (m, pre, u) => {
      const href = safeUrl(u.replace(/&amp;/g, '&'));
      return href ? pre + put(`<a href="${esc(href)}"${opt.externalLinks ? ' target="_blank" rel="noopener noreferrer"' : ''}>${u}</a>`) : m;
    });
    s = emphasis(s);

    // スロットを復元 (入れ子があるので繰り返す)
    for (let i = 0; i < 5 && s.includes('\u0001'); i++) s = s.replace(/\u0001(\d+)\u0001/g, (m, n) => slots[+n]);
    return s;
  }

  // HTML エスケープ (スロットは維持)
  function escapeText(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function emphasis(s) {
    return s
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?=[^\s_])([^_]*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>');
  }

  // ------------------------------------------------------------------
  // ブロック
  // ------------------------------------------------------------------
  function isBlockStart(line) {
    return RE.fence.test(line) || RE.atx.test(line) || RE.hr.test(line) || RE.quote.test(line) ||
      (RE.list.test(line) && !RE.blank.test(line.replace(RE.list, '$4')));
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let buf = '', code = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '|') { buf += '|'; i++; continue; }
      if (c === '`') code = !code;
      if (c === '|' && !code) { cells.push(buf.trim()); buf = ''; continue; }
      buf += c;
    }
    cells.push(buf.trim());
    return cells;
  }

  function blocks(lines, opt, tight) {
    const out = [];
    let i = 0;
    const n = lines.length;

    while (i < n) {
      const line = lines[i];
      if (RE.blank.test(line)) { i++; continue; }

      // フェンスコード
      let m = line.match(RE.fence);
      if (m) {
        const fence = m[1];
        const lang = m[2];
        const ind = indentOf(line);
        const code = [];
        i++;
        while (i < n && !new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(lines[i])) {
          code.push(lines[i].replace(new RegExp(`^ {0,${ind}}`), ''));
          i++;
        }
        i++;
        out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(code.join('\n'))}</code></pre>`);
        continue;
      }

      // ATX 見出し
      m = line.match(RE.atx);
      if (m) {
        out.push(`<h${m[1].length}>${inline(m[2] || '', opt)}</h${m[1].length}>`);
        i++;
        continue;
      }

      // 水平線
      if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }

      // 引用
      if (RE.quote.test(line)) {
        const q = [];
        while (i < n && (RE.quote.test(lines[i]) || (!RE.blank.test(lines[i]) && q.length && !RE.blank.test(q[q.length - 1]) && !isBlockStart(lines[i])))) {
          q.push(lines[i].replace(RE.quote, ''));
          i++;
        }
        out.push(`<blockquote>${blocks(q, opt)}</blockquote>`);
        continue;
      }

      // リスト
      m = line.match(RE.list);
      if (m) {
        const r = list(lines, i, opt);
        out.push(r.html);
        i = r.next;
        continue;
      }

      // 表
      if (line.includes('|') && i + 1 < n && RE.tableDelim.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const head = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : '');
        i += 2;
        const rows = [];
        while (i < n && !RE.blank.test(lines[i]) && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
        const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c || '', opt)}</${tag}>`;
        out.push('<table><thead><tr>' + head.map((c, k) => cell('th', c, k)).join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + head.map((_, k) => cell('td', r[k], k)).join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }

      // インデントコード
      if (RE.indentCode.test(line)) {
        const code = [];
        while (i < n && (RE.indentCode.test(lines[i]) || RE.blank.test(lines[i]))) { code.push(lines[i].replace(RE.indentCode, '')); i++; }
        while (code.length && RE.blank.test(code[code.length - 1])) code.pop();
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
        continue;
      }

      // 段落 (+ Setext 見出し)
      const para = [line];
      i++;
      let heading = 0;
      while (i < n) {
        const l = lines[i];
        if (RE.setext1.test(l)) { heading = 1; i++; break; }
        if (RE.setext2.test(l)) { heading = 2; i++; break; }
        if (RE.blank.test(l) || isBlockStart(l)) break;
        para.push(l);
        i++;
      }
      const text = para.map(l => l.replace(/^ +/, '')).join('\n').replace(/[ \t]+$/, '');
      if (heading) out.push(`<h${heading}>${inline(text, opt)}</h${heading}>`);
      else out.push(tight ? inline(text, opt) : `<p>${inline(text, opt)}</p>`);
    }
    return out.join('\n');
  }

  function list(lines, start, opt) {
    const first = lines[start].match(RE.list);
    const base = first[1].length;
    const ordered = /\d/.test(first[2]);
    const startNum = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let i = start;
    let loose = false;
    const n = lines.length;

    while (i < n) {
      const m = lines[i].match(RE.list);
      if (!m || m[1].length > base + 1 || m[1].length < base || /\d/.test(m[2]) !== ordered) break;
      const spaces = m[3] === '\t' ? 4 : m[3].length;
      const contentIndent = m[1].length + m[2].length + (spaces > 4 || spaces === 0 ? 1 : spaces);
      const item = [m[4]];
      i++;
      while (i < n) {
        const l = lines[i];
        if (RE.blank.test(l)) {
          let j = i + 1;
          while (j < n && RE.blank.test(lines[j])) j++;
          if (j < n && indentOf(lines[j]) >= contentIndent) {
            for (let k = i; k < j; k++) item.push('');
            i = j;
            loose = loose || !RE.list.test(lines[j].slice(contentIndent));
            continue;
          }
          break;
        }
        const ind = indentOf(l);
        if (ind >= contentIndent || (ind > base && !RE.list.test(l))) { item.push(l.slice(Math.min(ind, contentIndent))); i++; continue; }
        if (ind > base && RE.list.test(l)) { item.push(l.slice(Math.min(ind, contentIndent))); i++; continue; }
        if (RE.list.test(l) || isBlockStart(l)) break;
        // 怠惰な継続行
        if (!RE.blank.test(item[item.length - 1])) { item.push(l); i++; continue; }
        break;
      }
      items.push(item);
      // 項目間の空行 → loose
      if (i < n && RE.blank.test(lines[i - 1] || '')) loose = true;
      if (i < n && RE.blank.test(lines[i])) {
        let j = i;
        while (j < n && RE.blank.test(lines[j])) j++;
        const mm = j < n && lines[j].match(RE.list);
        if (mm && mm[1].length >= base && mm[1].length <= base + 1 && /\d/.test(mm[2]) === ordered) { loose = true; i = j; continue; }
        break;
      }
    }

    const lis = items.map(item => {
      let task = '';
      const tm = item[0].match(/^\[([ xX])\][ \t]+(.*)$/);
      if (tm) { task = `<input type="checkbox" disabled${tm[1] !== ' ' ? ' checked' : ''}> `; item[0] = tm[2]; }
      return `<li${task ? ' class="task"' : ''}>${task}${blocks(item, opt, !loose)}</li>`;
    }).join('\n');
    const tag = ordered ? 'ol' : 'ul';
    return { html: `<${tag}${ordered && startNum !== 1 ? ` start="${startNum}"` : ''}>\n${lis}\n</${tag}>`, next: i };
  }

  /**
   * @param {string} md
   * @param {{baseUrl?: string, externalLinks?: boolean}} opt
   */
  function render(md, opt = {}) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    return blocks(lines, opt, false);
  }

  /** フロントマター (--- ... ---) を分離 */
  function splitFrontMatter(md) {
    const m = String(md).match(/^---\n([\s\S]*?)\n---\n?/);
    return m ? { frontMatter: m[1], body: md.slice(m[0].length) } : { frontMatter: '', body: md };
  }

  global.FedgetMarkdown = { render, escapeHtml: esc, splitFrontMatter, safeUrl };
})(window);
