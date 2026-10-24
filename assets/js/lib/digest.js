/*
 * Fedget digest library
 *   - MD5 / CRC32 : JS 実装 (逐次 update 可能、巨大ファイルのストリーム処理用)
 *   - SHA-1/256/384/512 : WebCrypto (crypto.subtle)
 *   - HMAC : SHA 系は WebCrypto、MD5 は RFC 2104 の汎用実装
 */
(function (global) {
  'use strict';

  // ---------------- CRC32 (IEEE 802.3) ----------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  class CRC32 {
    constructor() { this.crc = 0xFFFFFFFF; }
    update(u8) {
      let c = this.crc;
      for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
      this.crc = c;
      return this;
    }
    value() { return (this.crc ^ 0xFFFFFFFF) >>> 0; }
    digest() {
      const v = this.value();
      return new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
    }
  }

  // ---------------- MD5 (RFC 1321) ----------------
  const MD5_K = new Int32Array(64);
  for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
  const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

  class MD5 {
    constructor() {
      this.h = new Int32Array([0x67452301, 0xEFCDAB89 | 0, 0x98BADCFE | 0, 0x10325476]);
      this.buf = new Uint8Array(64);
      this.bufLen = 0;
      this.total = 0;
      this.M = new Int32Array(16);
    }
    _block(u8, off) {
      const M = this.M;
      for (let i = 0; i < 16; i++) {
        const j = off + i * 4;
        M[i] = u8[j] | (u8[j + 1] << 8) | (u8[j + 2] << 16) | (u8[j + 3] << 24);
      }
      const h = this.h;
      let a = h[0], b = h[1], c = h[2], d = h[3];
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
        else { f = c ^ (b | ~d); g = (7 * i) & 15; }
        const tmp = d;
        d = c;
        c = b;
        const x = (a + f + MD5_K[i] + M[g]) | 0;
        b = (b + ((x << MD5_S[i]) | (x >>> (32 - MD5_S[i])))) | 0;
        a = tmp;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    }
    update(u8) {
      let i = 0;
      this.total += u8.length;
      if (this.bufLen) {
        const need = 64 - this.bufLen;
        const n = Math.min(need, u8.length);
        this.buf.set(u8.subarray(0, n), this.bufLen);
        this.bufLen += n;
        i = n;
        if (this.bufLen === 64) { this._block(this.buf, 0); this.bufLen = 0; }
      }
      for (; i + 64 <= u8.length; i += 64) this._block(u8, i);
      if (i < u8.length) { this.buf.set(u8.subarray(i), 0); this.bufLen = u8.length - i; }
      return this;
    }
    digest() {
      const bitLen = this.total * 8;
      const padLen = this.bufLen < 56 ? 56 - this.bufLen : 120 - this.bufLen;
      const pad = new Uint8Array(padLen + 8);
      pad[0] = 0x80;
      const lo = bitLen >>> 0, hi = Math.floor(bitLen / 0x100000000) >>> 0;
      for (let i = 0; i < 4; i++) { pad[padLen + i] = (lo >>> (8 * i)) & 255; pad[padLen + 4 + i] = (hi >>> (8 * i)) & 255; }
      const total = this.total;
      this.update(pad);
      this.total = total;
      const out = new Uint8Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out[i * 4 + j] = (this.h[i] >>> (8 * j)) & 255;
      return out;
    }
  }

  function md5(u8) { return new MD5().update(u8).digest(); }

  function hmacMd5(key, data) {
    let k = key.length > 64 ? md5(key) : key;
    const k0 = new Uint8Array(64);
    k0.set(k);
    const ipad = k0.map(b => b ^ 0x36), opad = k0.map(b => b ^ 0x5c);
    const inner = new MD5().update(ipad).update(data).digest();
    return new MD5().update(opad).update(inner).digest();
  }

  // ---------------- 統一インタフェース ----------------
  const ALGORITHMS = [
    { id: 'md5', label: 'MD5', bits: 128, stream: true, hmac: true },
    { id: 'sha1', label: 'SHA-1', bits: 160, subtle: 'SHA-1', hmac: true },
    { id: 'sha256', label: 'SHA-256', bits: 256, subtle: 'SHA-256', hmac: true },
    { id: 'sha384', label: 'SHA-384', bits: 384, subtle: 'SHA-384', hmac: true },
    { id: 'sha512', label: 'SHA-512', bits: 512, subtle: 'SHA-512', hmac: true },
    { id: 'crc32', label: 'CRC32', bits: 32, stream: true, hmac: false },
  ];
  const byId = Object.fromEntries(ALGORITHMS.map(a => [a.id, a]));

  function requireSubtle() {
    if (!global.crypto || !global.crypto.subtle) {
      throw new Error('WebCrypto (crypto.subtle) が使えません。https:// / localhost / file:// で開いてください');
    }
    return global.crypto.subtle;
  }

  /** 単発ハッシュ: data(Uint8Array) → Uint8Array */
  async function hash(algId, data) {
    const a = byId[algId];
    if (!a) throw new Error('未対応のアルゴリズム: ' + algId);
    if (algId === 'md5') return md5(data);
    if (algId === 'crc32') return new CRC32().update(data).digest();
    return new Uint8Array(await requireSubtle().digest(a.subtle, data));
  }

  /** HMAC: key, data(Uint8Array) → Uint8Array */
  async function hmac(algId, key, data) {
    const a = byId[algId];
    if (!a || !a.hmac) throw new Error(`${a ? a.label : algId} は HMAC に対応していません`);
    if (algId === 'md5') return hmacMd5(key, data);
    const subtle = requireSubtle();
    if (!key.length) throw new Error('HMAC キーが空です');
    const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: a.subtle }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', k, data));
  }

  global.FedgetDigest = { ALGORITHMS, byId, MD5, CRC32, md5, hash, hmac };
})(window);
