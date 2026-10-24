/*
 * Fedget mini YAML parser
 * 外部ライブラリ無しで設定ファイル (config/*.yaml) を読むための YAML サブセットパーサ。
 *
 * 対応:
 *   - マップ (key: value) / ネストしたマップ
 *   - シーケンス (- item) / マップを要素に持つシーケンス (- key: value)
 *   - スカラー: 文字列 / 'single' / "double (\n \t \" \\ \uXXXX)" / 数値 / true,false / null,~
 *   - フロー形式の簡易配列 [a, b, c] / 空マップ {}
 *   - ブロックスカラー | と > (インデントで範囲を判定)
 *   - コメント (# ...)
 * 非対応: アンカー/エイリアス, 複数ドキュメント, 複雑なフロー形式
 */
(function (global) {
  'use strict';

  function YamlError(message, lineNo) {
    const e = new Error(lineNo ? `YAML ${lineNo}行目: ${message}` : `YAML: ${message}`);
    e.name = 'YamlError';
    return e;
  }

  // クォート外の " #" 以降をコメントとして除去
  function stripComment(text) {
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\' && quote === '"') { i++; continue; }
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
        return text.slice(0, i).replace(/\s+$/, '');
      }
    }
    return text.replace(/\s+$/, '');
  }

  // クォート外で最初に現れる "key: " の ':' 位置
  function findKeySep(text) {
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\' && quote === '"') { i++; continue; }
        if (c === quote) quote = null;
      } else if ((c === '"' || c === "'") && i === 0) {
        quote = c;
      } else if (c === ':' && (i + 1 === text.length || text[i + 1] === ' ' || text[i + 1] === '\t')) {
        return i;
      }
    }
    return -1;
  }

  function parseDoubleQuoted(s) {
    return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, e) => {
      if (e[0] === 'u') return String.fromCharCode(parseInt(e.slice(1), 16));
      return ({ n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/' })[e] ?? e;
    });
  }

  function splitFlow(inner) {
    const parts = [];
    let buf = '', quote = null, depth = 0;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (quote) {
        buf += c;
        if (c === '\\' && quote === '"') { buf += inner[++i] || ''; continue; }
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") { quote = c; buf += c; }
      else if (c === '[' || c === '{') { depth++; buf += c; }
      else if (c === ']' || c === '}') { depth--; buf += c; }
      else if (c === ',' && depth === 0) { parts.push(buf.trim()); buf = ''; }
      else buf += c;
    }
    if (buf.trim() !== '') parts.push(buf.trim());
    return parts;
  }

  function parseScalar(raw, lineNo) {
    const s = raw.trim();
    if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
    if (s === 'true' || s === 'True' || s === 'TRUE') return true;
    if (s === 'false' || s === 'False' || s === 'FALSE') return false;
    if (s[0] === '"') {
      if (s[s.length - 1] !== '"' || s.length < 2) throw YamlError('ダブルクォートが閉じていません', lineNo);
      return parseDoubleQuoted(s.slice(1, -1));
    }
    if (s[0] === "'") {
      if (s[s.length - 1] !== "'" || s.length < 2) throw YamlError('シングルクォートが閉じていません', lineNo);
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s[0] === '[') {
      if (s[s.length - 1] !== ']') throw YamlError('フロー配列が閉じていません', lineNo);
      return splitFlow(s.slice(1, -1)).map(p => parseScalar(p, lineNo));
    }
    if (s === '{}') return {};
    if (/^[-+]?(\d+|\d*\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
    if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    return s;
  }

  function parse(text) {
    const rawLines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    // 行情報: 空行・コメント行は除外 (ブロックスカラー用に元の行も保持)
    const lines = [];
    rawLines.forEach((raw, idx) => {
      if (/^\s*(#.*)?$/.test(raw)) return;
      if (/^(---|\.\.\.)\s*$/.test(raw)) return;
      if (/^\t/.test(raw)) throw YamlError('インデントにタブは使えません', idx + 1);
      const indent = raw.match(/^ */)[0].length;
      lines.push({ indent, text: stripComment(raw.slice(indent)), no: idx + 1, rawIndex: idx });
    });

    let pos = 0;
    const peek = () => lines[pos];

    function isSeqItem(text) { return text === '-' || text.startsWith('- '); }

    function parseBlockScalar(style, parentIndent, headerLine) {
      // headerLine の次の生の行から、parentIndent より深い行をすべて取り込む
      const start = headerLine.rawIndex + 1;
      const collected = [];
      let blockIndent = null;
      let i = start;
      for (; i < rawLines.length; i++) {
        const raw = rawLines[i];
        if (/^\s*$/.test(raw)) { collected.push(''); continue; }
        const ind = raw.match(/^ */)[0].length;
        if (ind <= parentIndent) break;
        if (blockIndent === null) blockIndent = ind;
        collected.push(raw.slice(Math.min(blockIndent, ind)));
      }
      while (collected.length && collected[collected.length - 1] === '') collected.pop();
      // 取り込んだ行を lines から読み飛ばす
      while (pos < lines.length && lines[pos].rawIndex < i) pos++;
      const chomp = style.includes('-') ? 'strip' : 'clip';
      let out;
      if (style[0] === '|') out = collected.join('\n');
      else out = collected.reduce((acc, l) => acc === null ? l : (l === '' ? acc + '\n' : (acc.endsWith('\n') ? acc + l : acc + ' ' + l)), null) || '';
      return chomp === 'strip' ? out : out + '\n';
    }

    function parseValueAfter(rest, ownerIndent, line) {
      // "key: rest" や "- rest" の rest を解釈
      if (/^[|>][-+]?$/.test(rest)) return parseBlockScalar(rest, ownerIndent, line);
      if (rest !== '') return parseScalar(rest, line.no);
      const next = peek();
      if (!next) return null;
      if (next.indent > ownerIndent) return parseBlock(next.indent);
      if (next.indent === ownerIndent && isSeqItem(next.text)) return parseSeq(ownerIndent);
      return null;
    }

    function parseBlock(indent) {
      const line = peek();
      if (!line) return null;
      if (isSeqItem(line.text)) return parseSeq(indent);
      if (findKeySep(line.text) >= 0) return parseMap(indent);
      // 単独スカラー (複数行はスペースで連結)
      const parts = [];
      while (peek() && peek().indent >= indent) parts.push(lines[pos++].text);
      return parseScalar(parts.join(' '), line.no);
    }

    function parseSeq(indent) {
      const arr = [];
      while (pos < lines.length) {
        const line = peek();
        if (line.indent !== indent || !isSeqItem(line.text)) {
          if (line.indent > indent) throw YamlError('インデントが不正です', line.no);
          break;
        }
        const rest = line.text === '-' ? '' : line.text.slice(2).replace(/^ +/, '');
        const offset = line.text.length - rest.length;
        if (rest !== '' && !/^[|>][-+]?$/.test(rest) && (isSeqItem(rest) || findKeySep(rest) >= 0)) {
          // "- key: value" → この行を内側のブロック先頭行として扱う
          lines[pos] = { indent: indent + offset, text: rest, no: line.no, rawIndex: line.rawIndex };
          arr.push(parseBlock(indent + offset));
        } else {
          pos++;
          arr.push(parseValueAfter(rest, indent, line));
        }
      }
      return arr;
    }

    function parseMap(indent) {
      const obj = {};
      while (pos < lines.length) {
        const line = peek();
        if (line.indent < indent) break;
        if (line.indent > indent) throw YamlError('インデントが不正です', line.no);
        if (isSeqItem(line.text)) break;
        const sep = findKeySep(line.text);
        if (sep < 0) throw YamlError(`"key: value" 形式ではありません: ${line.text}`, line.no);
        let key = line.text.slice(0, sep).trim();
        if (/^".*"$/.test(key)) key = parseDoubleQuoted(key.slice(1, -1));
        else if (/^'.*'$/.test(key)) key = key.slice(1, -1).replace(/''/g, "'");
        const rest = line.text.slice(sep + 1).trim();
        pos++;
        obj[key] = parseValueAfter(rest, indent, line);
      }
      return obj;
    }

    if (!lines.length) return null;
    const result = parseBlock(lines[0].indent);
    if (pos < lines.length) throw YamlError('解釈できない行があります', lines[pos].no);
    return result;
  }

  global.FedgetYAML = { parse };
})(window);
