/*
 * Fedget image library
 * 画像の読込 / リサイズ / 各形式へのエンコード (PNG, JPEG, WebP, BMP, ICO) を Canvas で行う。
 */
(function (global) {
  'use strict';

  const FORMATS = {
    png: { mime: 'image/png', ext: 'png', alpha: true, lossy: false },
    jpeg: { mime: 'image/jpeg', ext: 'jpg', alpha: false, lossy: true },
    webp: { mime: 'image/webp', ext: 'webp', alpha: true, lossy: true },
    bmp: { mime: 'image/bmp', ext: 'bmp', alpha: false, lossy: false },
    ico: { mime: 'image/x-icon', ext: 'ico', alpha: true, lossy: false, maxSize: 256 },
  };

  /** Blob → HTMLImageElement (decode 済み) */
  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { resolve({ img, url, width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像として読み込めませんでした')); };
      img.src = url;
    });
  }

  /** 出力サイズを計算 */
  function targetSize(w, h, opts = {}) {
    let tw = w, th = h;
    if (opts.resize === 'fit') {
      const r = Math.min(1, (opts.maxW || w) / w, (opts.maxH || h) / h);
      tw = w * r; th = h * r;
    } else if (opts.resize === 'scale') {
      const r = (opts.scale || 100) / 100;
      tw = w * r; th = h * r;
    }
    if (opts.maxSide) {
      const r = Math.min(1, opts.maxSide / Math.max(tw, th));
      tw *= r; th *= r;
    }
    return { width: Math.max(1, Math.round(tw)), height: Math.max(1, Math.round(th)) };
  }

  /** 画像を指定サイズの canvas に描画 (background を指定すると塗りつぶし) */
  function toCanvas(source, width, height, background) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error(`${mime} への変換に失敗しました`)), mime, quality);
    });
  }

  function encodeBMP(canvas) {
    const { width: w, height: h } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const rowSize = Math.ceil((24 * w) / 32) * 4;
    const imageSize = rowSize * h;
    const buf = new ArrayBuffer(54 + imageSize);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x42); dv.setUint8(1, 0x4D);       // 'BM'
    dv.setUint32(2, 54 + imageSize, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, h, true);                           // 正 = bottom-up
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(34, imageSize, true);
    dv.setInt32(38, 2835, true);                        // 72 dpi
    dv.setInt32(42, 2835, true);
    const out = new Uint8Array(buf);
    for (let y = 0; y < h; y++) {
      let o = 54 + (h - 1 - y) * rowSize;
      let i = y * w * 4;
      for (let x = 0; x < w; x++, i += 4) {
        out[o++] = data[i + 2]; out[o++] = data[i + 1]; out[o++] = data[i];
      }
    }
    return new Blob([buf], { type: 'image/bmp' });
  }

  async function encodeICO(canvas) {
    const png = new Uint8Array(await (await canvasToBlob(canvas, 'image/png')).arrayBuffer());
    const head = new DataView(new ArrayBuffer(22));
    head.setUint16(2, 1, true);                         // type: icon
    head.setUint16(4, 1, true);                         // count
    head.setUint8(6, canvas.width >= 256 ? 0 : canvas.width);
    head.setUint8(7, canvas.height >= 256 ? 0 : canvas.height);
    head.setUint16(10, 1, true);                        // planes
    head.setUint16(12, 32, true);                       // bpp
    head.setUint32(14, png.length, true);
    head.setUint32(18, 22, true);
    return new Blob([head.buffer, png], { type: 'image/x-icon' });
  }

  /**
   * 画像ソースを変換して Blob を返す
   * @param source HTMLImageElement / ImageBitmap / Canvas
   * @param opts {format, quality(0-1), background, resize, maxW, maxH, scale}
   */
  async function convert(source, srcW, srcH, opts) {
    const fmt = FORMATS[opts.format] || FORMATS.png;
    const size = targetSize(srcW, srcH, { ...opts, maxSide: fmt.maxSize });
    const bg = fmt.alpha ? null : (opts.background || '#ffffff');
    const canvas = toCanvas(source, size.width, size.height, bg);
    let blob;
    if (opts.format === 'bmp') blob = encodeBMP(canvas);
    else if (opts.format === 'ico') blob = await encodeICO(canvas);
    else {
      blob = await canvasToBlob(canvas, fmt.mime, fmt.lossy ? opts.quality : undefined);
      if (blob.type !== fmt.mime) throw new Error(`このブラウザは ${opts.format.toUpperCase()} 形式の書き出しに対応していません`);
    }
    return { blob, width: size.width, height: size.height, ext: fmt.ext, mime: fmt.mime };
  }

  global.FedgetImage = { FORMATS, loadImage, targetSize, toCanvas, canvasToBlob, convert, encodeBMP, encodeICO };
})(window);
