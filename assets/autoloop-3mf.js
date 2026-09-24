/* =========================================================
   Création Audio — AutoLoop : projets Bambu Studio (.gcode.3mf)
   « Exporter le fichier tranché du plateau » produit une archive ZIP :
     Metadata/plate_N.gcode      <- le gcode du plateau (ce qu'AutoLoop traite)
     Metadata/plate_N.gcode.md5  <- empreinte MD5 (hexa MAJUSCULE) de ce gcode
     + aperçus, réglages, modèle 3D… (conservés tels quels).
   Ce module lit l'archive, en sort le gcode, puis la reconstruit avec le
   gcode du batch et son MD5 recalculé. 100 % local (fflate, copie locale).
   Expose window.ALProject = { isZip, read, build, md5 }.
   ========================================================= */
(function (root) {
  'use strict';

  var RE_PLATE = /^Metadata\/plate_(\d+)\.gcode$/;

  function isZip(u8) { return u8 && u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04; }

  // Lit l'archive -> { entries: {nom: Uint8Array} (ordre d'origine), plates: [{ n, name }] }
  function read(u8) {
    var ff = root.fflate;
    if (!ff) throw new Error('Module ZIP (fflate) non chargé.');
    var entries = ff.unzipSync(u8);
    var plates = Object.keys(entries).map(function (name) {
      var m = RE_PLATE.exec(name);
      return m ? { n: +m[1], name: name } : null;
    }).filter(Boolean).sort(function (a, b) { return a.n - b.n; });
    return { entries: entries, plates: plates };
  }

  // Reconstruit l'archive : même contenu, même ordre ; seuls plate_N.gcode et son .md5
  // changent. Les images restent « stockées » (déjà compressées), le reste en deflate.
  // -> Promise(Uint8Array)
  function build(project, plateName, gcodeBytes) {
    var ff = root.fflate;
    if (!ff) return Promise.reject(new Error('Module ZIP (fflate) non chargé.'));
    var files = {}, sawMd5 = false, md5Name = plateName + '.md5';
    var hash = md5(gcodeBytes);
    Object.keys(project.entries).forEach(function (name) {
      if (/\/$/.test(name)) return;                          // dossiers : implicites
      var data = project.entries[name];
      if (name === plateName) data = gcodeBytes;
      else if (name === md5Name) { data = asciiBytes(hash); sawMd5 = true; }
      files[name] = [data, { level: /\.(png|jpe?g)$/i.test(name) ? 0 : 6 }];
    });
    if (!sawMd5) files[md5Name] = [asciiBytes(hash), { level: 6 }];
    return new Promise(function (resolve, reject) {
      var done = false;
      function sync() {
        try { resolve(ff.zipSync(files)); } catch (e) { reject(e); }
      }
      try {
        // compression en arrière-plan (web workers) : l'onglet reste réactif
        ff.zip(files, function (err, out) {
          if (done) return; done = true;
          if (err) sync(); else resolve(out);
        });
      } catch (e) { if (!done) { done = true; sync(); } }
    });
  }

  function asciiBytes(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF; return u; }

  /* ---- MD5 (RFC 1321) sur Uint8Array -> hexa MAJUSCULE, comme Bambu Studio.
     WebCrypto ne fait pas le MD5 ; implémentation compacte, testée contre md5sum. */
  var K = (function () { var k = new Int32Array(64); for (var i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0; return k; })();
  var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  function md5(bytes) {
    var st = [0x67452301, 0xEFCDAB89 | 0, 0x98BADCFE | 0, 0x10325476];
    var M = new Int32Array(16), len = bytes.length;
    var full = len - (len % 64);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (var off = 0; off < full; off += 64) {
      for (var j = 0; j < 16; j++) M[j] = dv.getInt32(off + j * 4, true);
      block(st, M);
    }
    // bourrage : 0x80, zéros, longueur en bits (64 bits, petit-boutiste)
    var restLen = len - full, padLen = restLen < 56 ? 64 : 128;
    var tail = new Uint8Array(padLen);
    tail.set(bytes.subarray(full));
    tail[restLen] = 0x80;
    var bits = len * 8, tdv = new DataView(tail.buffer);
    tdv.setUint32(padLen - 8, bits >>> 0, true);
    tdv.setUint32(padLen - 4, Math.floor(bits / 4294967296), true);
    for (var o2 = 0; o2 < padLen; o2 += 64) {
      for (var j2 = 0; j2 < 16; j2++) M[j2] = tdv.getInt32(o2 + j2 * 4, true);
      block(st, M);
    }
    var hex = '';
    for (var w = 0; w < 4; w++) for (var b = 0; b < 4; b++) {
      var v = (st[w] >>> (b * 8)) & 0xFF;
      hex += (v < 16 ? '0' : '') + v.toString(16);
    }
    return hex.toUpperCase();
  }
  function block(st, M) {
    var A = st[0], B = st[1], C = st[2], D = st[3], F, g, s, t;
    for (var i = 0; i < 64; i++) {
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      s = S[((i >> 4) << 2) | (i & 3)];
      t = (F << s) | (F >>> (32 - s));
      B = (B + t) | 0;
    }
    st[0] = (st[0] + A) | 0; st[1] = (st[1] + B) | 0; st[2] = (st[2] + C) | 0; st[3] = (st[3] + D) | 0;
  }

  root.ALProject = { isZip: isZip, read: read, build: build, md5: md5 };
})(typeof self !== 'undefined' ? self : this);
