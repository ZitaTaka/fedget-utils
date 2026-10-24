/* 暗号化キー生成 */
(function () {
  'use strict';
  const F = Fedget;
  const { $, el } = F;
  const subtle = window.crypto && window.crypto.subtle;

  F.persistForm($('#kg-random-form'), 'keygen.random');
  F.persistForm($('#kg-key-form'), 'keygen.key');

  // =====================================================================
  // ランダムキー
  // =====================================================================
  let randomKeys = [];
  const rBits = $('#kg-r-bits');
  const syncCustom = () => { $('#kg-r-custom-box').hidden = rBits.value !== 'custom'; };
  rBits.addEventListener('change', syncCustom);
  syncCustom();

  function encodeBytes(bytes, format) {
    if (format === 'HEX') return F.bytesToHex(bytes, true);
    if (format === 'base64') return F.bytesToBase64(bytes);
    if (format === 'base64url') return F.bytesToBase64Url(bytes);
    return F.bytesToHex(bytes);
  }

  $('#kg-r-generate').addEventListener('click', () => {
    const nBytes = rBits.value === 'custom'
      ? Math.max(1, Math.min(4096, parseInt($('#kg-r-bytes').value, 10) || 32))
      : parseInt(rBits.value, 10) / 8;
    const count = Math.max(1, Math.min(1000, parseInt($('#kg-r-count').value, 10) || 1));
    const format = $('#kg-r-format').value;
    randomKeys = Array.from({ length: count }, () => encodeBytes(F.randomBytes(nBytes), format));
    const box = $('#kg-r-results');
    box.textContent = '';
    randomKeys.slice(0, 100).forEach(k => box.append(el('div', { class: 'copy-row' },
      el('div', { class: 'output' }, k),
      el('button', { class: 'btn btn-sm', type: 'button', onclick: () => F.copyText(k) }, 'コピー'))));
    if (randomKeys.length > 100) box.append(el('div', { class: 'hint' }, `ほか ${randomKeys.length - 100} 件`));
    $('#kg-r-copy').disabled = $('#kg-r-dl').disabled = false;
    F.notify(`${count}件のランダムキー (${nBytes * 8} bit) を生成しました`, 'success');
  });
  $('#kg-r-copy').addEventListener('click', () => F.copyText(randomKeys.join('\n')));
  $('#kg-r-dl').addEventListener('click', () => F.download(randomKeys.join('\n') + '\n', `random-keys_${F.formatDate()}.txt`, 'text/plain'));

  // =====================================================================
  // WebCrypto 鍵 / 鍵ペア
  // =====================================================================
  const TYPES = {
    'AES-GCM': { kind: 'secret', fields: ['aes'], usages: ['encrypt', 'decrypt'] },
    'AES-CBC': { kind: 'secret', fields: ['aes'], usages: ['encrypt', 'decrypt'] },
    'AES-CTR': { kind: 'secret', fields: ['aes'], usages: ['encrypt', 'decrypt'] },
    'AES-KW': { kind: 'secret', fields: ['aes'], usages: ['wrapKey', 'unwrapKey'] },
    'HMAC': { kind: 'secret', fields: ['hash'], usages: ['sign', 'verify'] },
    'RSA-OAEP': { kind: 'pair', fields: ['rsa', 'hash'], usages: ['encrypt', 'decrypt'] },
    'RSA-PSS': { kind: 'pair', fields: ['rsa', 'hash', 'comment'], usages: ['sign', 'verify'], ssh: true },
    'RSASSA-PKCS1-v1_5': { kind: 'pair', fields: ['rsa', 'hash', 'comment'], usages: ['sign', 'verify'], ssh: true },
    'ECDSA': { kind: 'pair', fields: ['ec', 'comment'], usages: ['sign', 'verify'], ssh: true },
    'ECDH': { kind: 'pair', fields: ['ec'], usages: ['deriveKey', 'deriveBits'] },
    'Ed25519': { kind: 'pair', fields: ['comment'], usages: ['sign', 'verify'], ssh: true },
    'X25519': { kind: 'pair', fields: [], usages: ['deriveKey', 'deriveBits'] },
  };

  const typeSel = $('#kg-type');
  function syncFields() {
    const t = TYPES[typeSel.value];
    F.$$('#kg-key-form [data-for]').forEach(f => { f.hidden = !t.fields.includes(f.dataset.for); });
  }
  typeSel.addEventListener('change', syncFields);
  syncFields();

  function algorithmParams(name) {
    const hash = $('#kg-hash').value;
    if (name.startsWith('AES')) return { name, length: parseInt($('#kg-aes-len').value, 10) };
    if (name === 'HMAC') return { name, hash };
    if (name.startsWith('RSA')) {
      return { name, modulusLength: parseInt($('#kg-rsa-len').value, 10), publicExponent: new Uint8Array([1, 0, 1]), hash };
    }
    if (name === 'ECDSA' || name === 'ECDH') return { name, namedCurve: $('#kg-curve').value };
    return { name };
  }

  function describe(params) {
    if (params.name.startsWith('AES')) return `${params.name} ${params.length} bit`;
    if (params.name === 'HMAC') return `HMAC-${params.hash}`;
    if (params.name.startsWith('RSA')) return `${params.name} ${params.modulusLength} bit / ${params.hash}`;
    if (params.namedCurve) return `${params.name} ${params.namedCurve}`;
    return params.name;
  }

  function pem(der, label) {
    const b64 = F.bytesToBase64(new Uint8Array(der));
    return `-----BEGIN ${label}-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  }

  // ---------- OpenSSH 公開鍵 ----------
  function sshString(bytes) {
    const out = new Uint8Array(4 + bytes.length);
    new DataView(out.buffer).setUint32(0, bytes.length);
    out.set(bytes, 4);
    return out;
  }
  function sshMpint(bytes) {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let b = bytes.subarray(i);
    if (b[0] & 0x80) { const p = new Uint8Array(b.length + 1); p.set(b, 1); b = p; }
    return sshString(b);
  }
  const concat = (...arrs) => {
    const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let o = 0;
    arrs.forEach(a => { out.set(a, o); o += a.length; });
    return out;
  };
  const utf8 = s => new TextEncoder().encode(s);

  function sshPublicBlob(jwk) {
    if (jwk.kty === 'RSA') {
      return { type: 'ssh-rsa', blob: concat(sshString(utf8('ssh-rsa')), sshMpint(F.base64ToBytes(jwk.e)), sshMpint(F.base64ToBytes(jwk.n))) };
    }
    if (jwk.kty === 'EC') {
      const curve = { 'P-256': 'nistp256', 'P-384': 'nistp384', 'P-521': 'nistp521' }[jwk.crv];
      const type = 'ecdsa-sha2-' + curve;
      const point = concat(new Uint8Array([4]), F.base64ToBytes(jwk.x), F.base64ToBytes(jwk.y));
      return { type, blob: concat(sshString(utf8(type)), sshString(utf8(curve)), sshString(point)) };
    }
    if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') {
      return { type: 'ssh-ed25519', blob: concat(sshString(utf8('ssh-ed25519')), sshString(F.base64ToBytes(jwk.x))) };
    }
    return null;
  }

  // ---------- JWK Thumbprint (RFC 7638) ----------
  async function jwkThumbprint(jwk) {
    const members = { RSA: ['e', 'kty', 'n'], EC: ['crv', 'kty', 'x', 'y'], OKP: ['crv', 'kty', 'x'], oct: ['k', 'kty'] }[jwk.kty];
    if (!members) return null;
    const json = '{' + members.map(m => `${JSON.stringify(m)}:${JSON.stringify(jwk[m])}`).join(',') + '}';
    return F.bytesToBase64Url(new Uint8Array(await subtle.digest('SHA-256', utf8(json))));
  }

  // ---------- 出力 ----------
  let outputs = [];   // [{title, filename, text, mime, binary?}]
  let outputBase = 'key';

  function renderOutputs(title, meta) {
    $('#kg-output-card').hidden = false;
    $('#kg-output-title').textContent = title;
    const metaBox = $('#kg-meta');
    metaBox.textContent = '';
    meta.forEach(([k, v]) => metaBox.append(el('span', { class: 'tag' }, `${k}: `, el('span', { class: 'mono', style: 'font-weight:400' }, v))));
    const box = $('#kg-outputs');
    box.textContent = '';
    outputs.forEach(o => {
      const ta = el('textarea', { class: 'mono', rows: o.rows || 6, readonly: true, spellcheck: 'false' });
      ta.value = o.text;
      box.append(el('div', { class: 'field' },
        el('div', { class: 'row' },
          el('span', { class: 'label', style: 'font-weight:600' }, o.title),
          o.secret ? el('span', { class: 'tag tag-danger' }, '秘密') : el('span', { class: 'tag tag-success' }, '公開可'),
          el('span', { class: 'spacer' }),
          el('button', { class: 'btn btn-sm', type: 'button', onclick: () => F.copyText(o.text, `${o.title} をコピーしました`) }, 'コピー'),
          el('button', { class: 'btn btn-sm', type: 'button', onclick: () => F.download(o.binary || o.text, o.filename, o.mime) }, '保存')),
        ta,
        el('span', { class: 'hint' }, o.filename)));
    });
    $('#kg-dl-all').disabled = !outputs.length;
  }

  async function generate() {
    if (!subtle) { F.notify('WebCrypto (crypto.subtle) が使えません。https:// / localhost / file:// で開いてください', 'error'); return; }
    const name = typeSel.value;
    const t = TYPES[name];
    const params = algorithmParams(name);
    const desc = describe(params);
    const stamp = F.formatDate();
    outputBase = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${stamp}`;
    $('#kg-generate').disabled = true;

    try {
      await F.task.run(`鍵生成 (${desc})`, async (task) => {
        task.step(`${desc} の鍵を生成中…${name.startsWith('RSA') && params.modulusLength >= 4096 ? ' (数秒〜数十秒かかります)' : ''}`);
        await F.yieldUI();
        let key;
        try {
          key = await subtle.generateKey(params, true, t.usages);
        } catch (e) {
          if (name === 'Ed25519' || name === 'X25519') throw new Error(`このブラウザは ${name} に対応していません (${e.message})`);
          throw e;
        }
        outputs = [];
        const meta = [['種類', desc], ['生成日時', F.formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')]];

        if (t.kind === 'secret') {
          task.step('鍵をエクスポート中 (Raw / JWK)');
          const raw = new Uint8Array(await subtle.exportKey('raw', key));
          const jwk = await subtle.exportKey('jwk', key);
          jwk.kid = await jwkThumbprint(jwk);
          meta.push(['鍵長', `${raw.length * 8} bit`]);
          outputs.push(
            { title: '鍵 (16進)', text: F.bytesToHex(raw), filename: `${outputBase}.hex.txt`, mime: 'text/plain', secret: true, rows: 2 },
            { title: '鍵 (Base64)', text: F.bytesToBase64(raw), filename: `${outputBase}.b64.txt`, mime: 'text/plain', secret: true, rows: 2 },
            { title: 'JWK', text: JSON.stringify(jwk, null, 2), filename: `${outputBase}.jwk.json`, mime: 'application/json', secret: true, rows: 8 },
            { title: '鍵 (バイナリ)', text: `${raw.length} バイトのバイナリ (保存でダウンロード)`, binary: raw, filename: `${outputBase}.key`, mime: 'application/octet-stream', secret: true, rows: 1 },
          );
        } else {
          task.step('公開鍵をエクスポート中 (SPKI / JWK)');
          const spki = await subtle.exportKey('spki', key.publicKey);
          const pubJwk = await subtle.exportKey('jwk', key.publicKey);
          task.step('秘密鍵をエクスポート中 (PKCS#8 / JWK)');
          const pkcs8 = await subtle.exportKey('pkcs8', key.privateKey);
          const privJwk = await subtle.exportKey('jwk', key.privateKey);

          task.step('フィンガープリントを計算中');
          const kid = await jwkThumbprint(pubJwk);
          pubJwk.kid = privJwk.kid = kid;
          const spkiFp = F.bytesToHex(new Uint8Array(await subtle.digest('SHA-256', spki))).match(/../g).join(':');
          meta.push(['JWK Thumbprint (kid)', kid]);
          meta.push(['SPKI SHA-256', spkiFp.slice(0, 47) + '…']);

          outputs.push(
            { title: '公開鍵 (PEM / SPKI)', text: pem(spki, 'PUBLIC KEY'), filename: `${outputBase}_public.pem`, mime: 'application/x-pem-file', rows: 6 },
            { title: '秘密鍵 (PEM / PKCS#8)', text: pem(pkcs8, 'PRIVATE KEY'), filename: `${outputBase}_private.pem`, mime: 'application/x-pem-file', secret: true, rows: 6 },
          );

          if (t.ssh) {
            const ssh = sshPublicBlob(pubJwk);
            if (ssh) {
              const comment = $('#kg-comment').value.trim();
              const line = `${ssh.type} ${F.bytesToBase64(ssh.blob)}${comment ? ' ' + comment : ''}\n`;
              const fp = 'SHA256:' + F.bytesToBase64(new Uint8Array(await subtle.digest('SHA-256', ssh.blob))).replace(/=+$/, '');
              meta.push(['OpenSSH', fp]);
              outputs.push({ title: 'OpenSSH 公開鍵 (authorized_keys 形式)', text: line, filename: `${outputBase}.pub`, mime: 'text/plain', rows: 3 });
            }
          }
          outputs.push(
            { title: '公開鍵 (JWK)', text: JSON.stringify(pubJwk, null, 2), filename: `${outputBase}_public.jwk.json`, mime: 'application/json', rows: 8 },
            { title: '秘密鍵 (JWK)', text: JSON.stringify(privJwk, null, 2), filename: `${outputBase}_private.jwk.json`, mime: 'application/json', secret: true, rows: 8 },
            { title: 'JWKS (公開鍵セット)', text: JSON.stringify({ keys: [pubJwk] }, null, 2), filename: `${outputBase}_jwks.json`, mime: 'application/json', rows: 8 },
          );
        }
        renderOutputs(`生成した鍵: ${desc}`, meta);
        return `${desc} の鍵を生成しました`;
      });
    } catch (e) {
      /* トップバーにエラー表示済み */
    } finally {
      $('#kg-generate').disabled = false;
    }
  }

  $('#kg-generate').addEventListener('click', generate);
  $('#kg-dl-all').addEventListener('click', async () => {
    if (!window.FedgetZip) { outputs.forEach(o => F.download(o.binary || o.text, o.filename, o.mime)); return; }
    const blob = await FedgetZip.create(outputs.map(o => ({ name: o.filename, data: o.binary || o.text })));
    F.download(blob, `${outputBase}.zip`, 'application/zip');
  });
})();
