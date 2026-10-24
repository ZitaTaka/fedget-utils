/*
 * Fedget ZIP writer
 * 複数ファイルを 1 つの ZIP にまとめる (依存: lib/digest.js の CRC32)。
 * CompressionStream('deflate-raw') が使えるブラウザでは Deflate 圧縮、使えなければ無圧縮(Store)。
 * ファイル名は UTF-8 (汎用ビット 11) で格納する。
 */
(function (global) {
  'use strict';

  const enc = new TextEncoder();

  function canDeflate() {
    try { new CompressionStream('deflate-raw'); return true; } catch (e) { return false; }
  }

  async function deflateRaw(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return enc.encode(String(data));
  }

  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  /** 同名ファイルに連番を付けて重複を避ける */
  function uniqueName(name, used) {
    if (!used.has(name)) { used.add(name); return name; }
    const m = name.match(/^(.*?)(\.[^./]*)?$/);
    for (let i = 2; ; i++) {
      const n = `${m[1]} (${i})${m[2] || ''}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
  }

  /**
   * @param {Array<{name:string, data:Uint8Array|ArrayBuffer|Blob|string, date?:Date}>} files
   * @param {{compress?: boolean, onProgress?: (done:number,total:number)=>void}} opts
   * @returns {Promise<Blob>}
   */
  async function create(files, opts = {}) {
    const compress = opts.compress !== false && canDeflate();
    const parts = [];
    const central = [];
    const used = new Set();
    let offset = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const name = uniqueName(String(f.name).replace(/\\/g, '/').replace(/^\/+/, ''), used);
      const nameBytes = enc.encode(name);
      const raw = await toBytes(f.data);
      const crc = new global.FedgetDigest.CRC32().update(raw).value();
      let body = raw, method = 0;
      if (compress && raw.length > 64) {
        const z = await deflateRaw(raw);
        if (z.length < raw.length) { body = z; method = 8; }
      }
      const { time, date } = dosDateTime(f.date || new Date());

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true);
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, body.length, true);
      lh.setUint32(22, raw.length, true);
      lh.setUint16(26, nameBytes.length, true);
      lh.setUint16(28, 0, true);
      parts.push(lh.buffer, nameBytes, body);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, body.length, true);
      ch.setUint32(24, raw.length, true);
      ch.setUint16(28, nameBytes.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, nameBytes);

      offset += 30 + nameBytes.length + body.length;
      if (opts.onProgress) opts.onProgress(i + 1, files.length);
    }

    const cdSize = central.reduce((s, b) => s + b.byteLength, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    return new Blob([...parts, ...central, eocd.buffer], { type: 'application/zip' });
  }

  global.FedgetZip = { create, canDeflate };
})(window);
