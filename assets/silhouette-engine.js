/* =========================================================
   Création Audio — Silhouettes : moteur de calcul (sans DOM)
   Image en gris -> masque à l'échelle (mm) -> contrôles de fabrication
   (morceaux détachés, passages minces, petits trous) -> segments au
   format du plateau (joints mi-bois) -> contours lissés -> 3MF / SVG / DXF.
   Tourne dans silhouette-worker.js (ou sur la page, à défaut de Worker).
   Unités : mm. Masques : Uint8Array, 1 = matière. Axe y vers le bas
   (comme l'image) ; les exports 3D et DXF le remettent vers le haut.
   Expose self.SilEngine. Le ZIP du 3MF utilise fflate (copie locale).
   ========================================================= */
(function (root) {
  'use strict';

  var INF = 1e20;
  var BEDS = { bambu: 256, sv08: 500 };
  var BED_MARGIN = 5;       // marge de sécurité de chaque côté du plateau (mm)
  var JOINT_GAP = 0.2;      // jeu au bout des languettes du mi-bois (mm)
  var DEF = {
    threshold: 128, invert: false, smooth: 2, simplify: 0.1, speck: 4, crop: null,
    mode: 'plein', stroke: 4, adapt: 0, margin: 15,
    sizeAxis: 'w', size: 600,
    printer: 'bambu', thickness: 4, minStroke: 3, overlap: 12, strokeMin: 2, bridge: 3, holeMin: 1.5,
    islandMode: 'link', islands: null, thinMode: 'fix', holeMode: 'fill',
    back: 'none', backT: 2, backM: 5, colPiece: '#000000', colBack: '#FFFFFF',
    cuts: null, edits: [], draft: false
  };
  var BACK_R = 3;           // rayon des coins du fond rectangle (mm)

  /* ------------------------------------------------------------------ */
  /*  Outils                                                             */
  /* ------------------------------------------------------------------ */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function round3(v) { return Math.round(v * 1000) / 1000; }
  var scratch = {};
  function buf(name, Type, n) {          // tampon réutilisé (piles, lignes)
    var b = scratch[name];
    if (!b || b.length < n) b = scratch[name] = new Type(n);
    return b;
  }
  function invert(m, n) { var o = new Uint8Array(n); for (var i = 0; i < n; i++) o[i] = m[i] ? 0 : 1; return o; }

  function norm(p) {
    var o = {}, k;
    for (k in DEF) o[k] = DEF[k];
    for (k in (p || {})) if (p[k] != null) o[k] = p[k];
    o.threshold = clamp(+o.threshold || 128, 1, 254);
    o.invert = !!o.invert;
    o.smooth = clamp(+o.smooth || 0, 0, 10);
    o.simplify = clamp(+o.simplify || 0, 0, 5);
    o.speck = clamp(+o.speck || 0, 0, 10000);
    if (['plein', 'contour', 'inverse'].indexOf(o.mode) < 0) o.mode = 'plein';
    o.stroke = clamp(+o.stroke || 4, 0.5, 100);
    o.adapt = clamp(+o.adapt || 0, 0, 100);
    o.margin = clamp(+o.margin || 0, 0, 500);
    o.sizeAxis = o.sizeAxis === 'h' ? 'h' : 'w';
    o.size = clamp(+o.size || 600, 10, 5000);
    o.printer = BEDS[o.printer] ? o.printer : 'bambu';
    o.thickness = clamp(+o.thickness || 4, 0.4, 50);
    o.minStroke = clamp(+o.minStroke || 3, 0.4, 50);
    o.strokeMin = clamp(+o.strokeMin || 2, 0.4, 100);
    o.bridge = clamp(+o.bridge || 3, 0.4, 50);
    o.holeMin = clamp(+o.holeMin || 0, 0, 50);
    o.overlap = clamp(+o.overlap || 12, 2, 100);
    if (['link', 'drop', 'apart'].indexOf(o.islandMode) < 0) o.islandMode = 'link';
    o.thinMode = o.thinMode === 'keep' ? 'keep' : 'fix';
    o.holeMode = o.holeMode === 'keep' ? 'keep' : 'fill';
    // fond : contour extérieur élargi de la marge, ou rectangle ; les couleurs ne servent qu'au SVG
    if (['none', 'contour', 'rect'].indexOf(o.back) < 0) o.back = 'none';
    o.backT = clamp(+o.backT || 2, 0.4, 20);
    o.backM = clamp(+o.backM || 0, 0, 200);
    var hex = function (v, d) { return /^#[0-9a-fA-F]{6}$/.test(v) ? v : d; };
    o.colPiece = hex(o.colPiece, DEF.colPiece); o.colBack = hex(o.colBack, DEF.colBack);
    o.islands = Array.isArray(o.islands) ? o.islands : [];
    // retouches : points en pixels de l'image source
    var pt = function (q) { return Array.isArray(q) && isFinite(q[0]) && isFinite(q[1]) ? [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10] : null; };
    o.edits = (Array.isArray(o.edits) ? o.edits : []).map(function (e) {
      if (!e) return null;
      if (e.t === 'fill' || e.t === 'empty') { var p = pt(e.p); return p ? { t: e.t, p: p } : null; }
      var ps = (Array.isArray(e.pts) ? e.pts : []).map(pt).filter(Boolean);
      if (e.t === 'line') return ps.length >= 2 ? { t: e.t, pts: ps } : null;
      // pinceau et gomme : tracé à main levée, diamètre s (mm)
      if (e.t === 'erase' || e.t === 'paint') return ps.length ? { t: e.t, pts: ps, s: Math.round(clamp(+e.s || ERASE_W, 0.5, 80) * 10) / 10 } : null;
      return null;
    }).filter(Boolean);
    // coupes déplacées à la main : { x: [fractions de la largeur], y: [fractions de la hauteur] }
    var cl = function (a) { return Array.isArray(a) && a.length ? a.map(Number).filter(isFinite) : null; };
    o.cuts = o.cuts && typeof o.cuts === 'object' && !Array.isArray(o.cuts) && (cl(o.cuts.x) || cl(o.cuts.y)) ? { x: cl(o.cuts.x), y: cl(o.cuts.y) } : null;
    o.crop = Array.isArray(o.crop) && o.crop.length === 4 ? o.crop.map(Number) : null;
    o.draft = !!o.draft;
    return o;
  }

  /* ------------------------------------------------------------------ */
  /*  Image : gris, seuil d'Otsu, flou                                    */
  /* ------------------------------------------------------------------ */
  // Gris 0..255 (0 = noir) ; la transparence compte comme du blanc (fond).
  function grayFromRGBA(px, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) {
      var a = px[j + 3] / 255, l = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
      g[i] = Math.round(l * a + 255 * (1 - a));
    }
    return g;
  }
  // Seuil d'Otsu : sépare le mieux sujet et fond (pixel « foncé » si gris < seuil).
  function otsu(g) {
    var hist = new Float64Array(256), n = g.length, i, t;
    for (i = 0; i < n; i++) hist[g[i]]++;
    var sum = 0; for (t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, best = -1, t0 = 127, t1 = 127;
    for (t = 0; t < 255; t++) {
      wB += hist[t]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sumB += t * hist[t];
      var d = sumB / wB - (sum - sumB) / wF, between = wB * wF * d * d;
      if (between > best * (1 + 1e-9)) { best = between; t0 = t1 = t; }
      else if (between >= best * (1 - 1e-9)) t1 = t;      // plateau (image en pur noir et blanc) : on vise le milieu
    }
    return clamp(Math.round((t0 + t1) / 2) + 1, 1, 254);
  }
  // Flou ≈ gaussien : 3 flous-boîtes séparables (bords prolongés), en place.
  function boxRadii(sigma) {
    var n = 3, wl = Math.floor(Math.sqrt(12 * sigma * sigma / n + 1));
    if (wl % 2 === 0) wl--;
    var m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)), out = [];
    for (var i = 0; i < n; i++) out.push(((i < m ? wl : wl + 2) - 1) / 2);
    return out;
  }
  function blurLine(a, start, step, n, r, tmp) {
    var i, acc = 0, inv = 1 / (2 * r + 1), last = n - 1;
    for (i = 0; i < n; i++) tmp[i] = a[start + i * step];
    for (i = -r; i <= r; i++) acc += tmp[i < 0 ? 0 : i > last ? last : i];
    for (i = 0; i < n; i++) {
      a[start + i * step] = acc * inv;
      var ad = i + r + 1, sb = i - r;
      acc += tmp[ad > last ? last : ad] - tmp[sb < 0 ? 0 : sb];
    }
  }
  // Maximum glissant sur un carré (2R+1)² (van Herk / Gil-Werman, O(n) quel que soit R), en place.
  function maxFilter(a, w, h, R) {
    if (R < 1) return a;
    var M = Math.max(w, h) + 2 * R + 2, pl = buf('mfP', Float32Array, M), gm = buf('mfG', Float32Array, M), hm = buf('mfH', Float32Array, M);
    var k = 2 * R + 1, x, y;
    var pass = function (start, step, n) {
      var N = n + 2 * R, i;
      for (i = 0; i < N; i++) { var s = i - R; pl[i] = s >= 0 && s < n ? a[start + s * step] : -INF; }
      for (i = 0; i < N; i++) gm[i] = i % k === 0 ? pl[i] : Math.max(gm[i - 1], pl[i]);
      for (i = N - 1; i >= 0; i--) hm[i] = (i === N - 1 || (i + 1) % k === 0) ? pl[i] : Math.max(hm[i + 1], pl[i]);
      for (i = 0; i < n; i++) a[start + i * step] = Math.max(hm[i], gm[i + 2 * R]);
    };
    for (y = 0; y < h; y++) pass(y * w, 1, w);
    for (x = 0; x < w; x++) pass(x, w, h);
    return a;
  }
  function gaussBlur(a, w, h, sigma) {
    if (!(sigma >= 0.4)) return a;
    var rs = boxRadii(sigma), tmp = buf('line', Float32Array, Math.max(w, h)), x, y;
    if (rs.every(function (r) { return r < 1; })) rs = [1];
    rs.forEach(function (r) {
      if (r < 1) return;
      for (y = 0; y < h; y++) blurLine(a, y * w, 1, w, r, tmp);
      for (x = 0; x < w; x++) blurLine(a, x, w, h, r, tmp);
    });
    return a;
  }

  /* ------------------------------------------------------------------ */
  /*  Distance euclidienne (Felzenszwalb & Huttenlocher)                  */
  /* ------------------------------------------------------------------ */
  // Distance² (px²) de chaque pixel au « site » le plus proche (sites[i] = 1).
  // wantIdx : renvoie aussi l'indice du site le plus proche (-1 s'il n'y en a aucun).
  function edt(sites, w, h, wantIdx) {
    var n = w * h, d = new Float32Array(n), row = wantIdx ? new Int32Array(n) : null;
    var x, y, i, last, dy;
    // 1) colonnes : distance verticale au site le plus proche (deux balayages)
    for (x = 0; x < w; x++) {
      last = -1;
      for (y = 0, i = x; y < h; y++, i += w) {
        if (sites[i]) { last = y; d[i] = 0; if (row) row[i] = y; }
        else if (last >= 0) { dy = y - last; d[i] = dy * dy; if (row) row[i] = last; }
        else { d[i] = INF; if (row) row[i] = -1; }
      }
      last = -1;
      for (y = h - 1, i = x + (h - 1) * w; y >= 0; y--, i -= w) {
        if (sites[i]) last = y;
        else if (last >= 0) { dy = last - y; dy *= dy; if (dy < d[i]) { d[i] = dy; if (row) row[i] = last; } }
      }
    }
    // 2) lignes : enveloppe inférieure des paraboles
    var f = buf('edtF', Float64Array, w), v = buf('edtV', Int32Array, w), z = buf('edtZ', Float64Array, w + 1);
    var rw = row ? buf('edtR', Int32Array, w) : null, idx = wantIdx ? new Int32Array(n) : null;
    for (y = 0; y < h; y++) {
      var off = y * w, k = -1, q, s, p;
      for (x = 0; x < w; x++) { f[x] = d[off + x]; if (rw) rw[x] = row[off + x]; }
      for (q = 0; q < w; q++) {
        if (f[q] >= INF) continue;
        if (k < 0) { k = 0; v[0] = q; z[0] = -INF; z[1] = INF; continue; }
        for (;;) {
          p = v[k];
          s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p));
          if (s > z[k]) break;
          k--;
        }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      if (k < 0) { for (x = 0; x < w; x++) { d[off + x] = INF; if (idx) idx[off + x] = -1; } continue; }
      k = 0;
      for (q = 0; q < w; q++) {
        while (z[k + 1] < q) k++;
        p = v[k];
        var dx = q - p;
        d[off + q] = dx * dx + f[p];
        if (idx) idx[off + q] = rw[p] * w + p;
      }
    }
    return { d: d, idx: idx };
  }

  /* ------------------------------------------------------------------ */
  /*  Composantes connexes                                                */
  /* ------------------------------------------------------------------ */
  // val = 1 : matière, 8-connexe ; val = 0 : vide, 4-connexe.
  // -> { lab: Int32Array (0 = autre valeur), comps: [{ id, area, sx, sy, x0, y0, x1, y1, border }] }
  function label(m, w, h, val) {
    var n = w * h, lab = new Int32Array(n), st = buf('stack', Int32Array, n), comps = [], id = 0, c8 = val === 1;
    for (var i0 = 0; i0 < n; i0++) {
      if (m[i0] !== val || lab[i0]) continue;
      id++;
      var c = { id: id, area: 0, sx: 0, sy: 0, x0: w, y0: h, x1: -1, y1: -1, border: false };
      var sp = 0; st[sp++] = i0; lab[i0] = id;
      while (sp) {
        var p = st[--sp], y = (p / w) | 0, x = p - y * w;
        c.area++; c.sx += x; c.sy += y;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        var l = x > 0, r = x < w - 1, u = y > 0, d = y < h - 1, q;
        if (!l || !r || !u || !d) c.border = true;
        if (l && m[q = p - 1] === val && !lab[q]) { lab[q] = id; st[sp++] = q; }
        if (r && m[q = p + 1] === val && !lab[q]) { lab[q] = id; st[sp++] = q; }
        if (u && m[q = p - w] === val && !lab[q]) { lab[q] = id; st[sp++] = q; }
        if (d && m[q = p + w] === val && !lab[q]) { lab[q] = id; st[sp++] = q; }
        if (c8) {
          if (l && u && m[q = p - w - 1] === val && !lab[q]) { lab[q] = id; st[sp++] = q; }
          if (r && u && m[q = p - w + 1] === val && !lab[q]) { lab[q] = id; st[sp++] = q; }
          if (l && d && m[q = p + w - 1] === val && !lab[q]) { lab[q] = id; st[sp++] = q; }
          if (r && d && m[q = p + w + 1] === val && !lab[q]) { lab[q] = id; st[sp++] = q; }
        }
      }
      comps.push(c);
    }
    return { lab: lab, comps: comps };
  }
  // Pose la valeur v sur les pixels d'une composante (et les note dans `mark`).
  function fillComp(m, w, lab, c, v, mark) {
    for (var y = c.y0; y <= c.y1; y++) {
      for (var x = c.x0, i = y * w + c.x0; x <= c.x1; x++, i++) {
        if (lab[i] === c.id) { m[i] = v; if (mark) mark[i] = 1; }
      }
    }
  }
  // Retire les taches (val = 1) ou bouche les trous fermés (val = 0) plus petits que minArea px.
  function removeSmall(m, w, h, val, minArea) {
    if (!(minArea > 0)) return;
    var L = label(m, w, h, val);
    L.comps.forEach(function (c) {
      if (c.area >= minArea || (val === 0 && c.border)) return;
      fillComp(m, w, L.lab, c, 1 - val);
    });
  }
  // Trait épais (capsule) entre deux points, en px.
  function drawCapsule(m, w, h, ax, ay, bx, by, rad, mark) {
    var x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + rad));
    var y0 = Math.max(0, Math.floor(Math.min(ay, by) - rad)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + rad));
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, r2 = rad * rad;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= r2) { var i = y * w + x; if (!m[i]) { m[i] = 1; if (mark) mark[i] = 1; } }
      }
    }
  }
  function inRoundRect(px, py, x0, y0, x1, y1, rc) {
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    if (rc <= 0) return true;
    var cx = px < x0 + rc ? x0 + rc : px > x1 - rc ? x1 - rc : px;
    var cy = py < y0 + rc ? y0 + rc : py > y1 - rc ? y1 - rc : py;
    var dx = px - cx, dy = py - cy;
    return dx * dx + dy * dy <= rc * rc;
  }

  /* ------------------------------------------------------------------ */
  /*  Contours (marching squares) et anneaux                              */
  /* ------------------------------------------------------------------ */
  // Champ lissé (deux flous 3×3) d'un masque : contour iso 0,5 sans marches d'escalier.
  function smoothField(m, w, h) {
    var f = new Float32Array(w * h), tmp = buf('line', Float32Array, Math.max(w, h)), i, x, y;
    for (i = 0; i < f.length; i++) f[i] = m[i];
    for (var pass = 0; pass < 2; pass++) {
      for (y = 0; y < h; y++) blurLine(f, y * w, 1, w, 1, tmp);
      for (x = 0; x < w; x++) blurLine(f, x, w, h, 1, tmp);
    }
    return f;
  }
  // Contours iso `lvl` (sommets = centres des pixels) -> anneaux fermés en px, orientation
  // cohérente (matière toujours du même côté). Accepte un champ réel ou un masque 0/1.
  function contours(f, w, h, lvl) {
    var next = new Map(), pa = [0, 0], pb = [0, 0];
    function pt(key, out) {
      var vert = key % 2, cell = (key - vert) / 2, y = (cell / w) | 0, x = cell - y * w, a = f[cell];
      var b = vert ? f[cell + w] : f[cell + 1], t = (lvl - a) / (b - a);
      if (vert) { out[0] = x; out[1] = y + t; } else { out[0] = x + t; out[1] = y; }
    }
    // segment de l'arête eA à l'arête eB ; (cx, cy) = coin de référence, cin = coin dans la matière
    function seg(eA, eB, cx, cy, cin) {
      pt(eA, pa); pt(eB, pb);
      var cr = (pb[0] - pa[0]) * (cy - pa[1]) - (pb[1] - pa[1]) * (cx - pa[0]);
      if ((cr > 0) !== cin) { var t = eA; eA = eB; eB = t; }
      next.set(eA, eB);
    }
    for (var y = 0; y < h - 1; y++) {
      for (var x = 0; x < w - 1; x++) {
        var i = y * w + x;
        var tl = f[i] >= lvl, tr = f[i + 1] >= lvl, bl = f[i + w] >= lvl, br = f[i + w + 1] >= lvl;
        var code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
        if (code === 0 || code === 15) continue;
        var T = i * 2, B = (i + w) * 2, L = i * 2 + 1, R = (i + 1) * 2 + 1;
        switch (code) {
          case 1: seg(L, B, x, y + 1, true); break;
          case 2: seg(B, R, x + 1, y + 1, true); break;
          case 3: seg(L, R, x, y + 1, true); break;
          case 4: seg(T, R, x + 1, y, true); break;
          case 6: seg(T, B, x + 1, y, true); break;
          case 7: seg(L, T, x, y, false); break;
          case 8: seg(L, T, x, y, true); break;
          case 9: seg(T, B, x, y, true); break;
          case 11: seg(T, R, x + 1, y, false); break;
          case 12: seg(L, R, x, y, true); break;
          case 13: seg(B, R, x + 1, y + 1, false); break;
          case 14: seg(L, B, x, y + 1, false); break;
          case 5:
            if ((f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) / 4 >= lvl) { seg(L, T, x, y, false); seg(B, R, x + 1, y + 1, false); }
            else { seg(T, R, x + 1, y, true); seg(L, B, x, y + 1, true); }
            break;
          case 10:
            if ((f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) / 4 >= lvl) { seg(T, R, x + 1, y, false); seg(L, B, x, y + 1, false); }
            else { seg(L, T, x, y, true); seg(B, R, x + 1, y + 1, true); }
            break;
        }
      }
    }
    var rings = [], keys = Array.from(next.keys()), p = [0, 0];
    for (var s = 0; s < keys.length; s++) {
      var k0 = keys[s];
      if (!next.has(k0)) continue;
      var arr = [], k = k0, guard = 0;
      do {
        pt(k, p); arr.push(p[0], p[1]);
        var nk = next.get(k); next.delete(k); k = nk;
      } while (k !== undefined && k !== k0 && ++guard < 5e6);
      if (arr.length >= 6) rings.push(new Float64Array(arr));
    }
    return rings;
  }
  function ringArea(R) {
    var s = 0, n = R.length;
    for (var i = 0; i < n; i += 2) { var j = (i + 2) % n; s += R[i] * R[j + 1] - R[j] * R[i + 1]; }
    return s / 2;
  }
  function ringBox(R) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < R.length; i += 2) {
      if (R[i] < b[0]) b[0] = R[i]; if (R[i] > b[2]) b[2] = R[i];
      if (R[i + 1] < b[1]) b[1] = R[i + 1]; if (R[i + 1] > b[3]) b[3] = R[i + 1];
    }
    return b;
  }
  function inRing(R, x, y) {
    var inside = false, n = R.length;
    for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
      var yi = R[i + 1], yj = R[j + 1];
      if ((yi > y) !== (yj > y) && x < (R[j] - R[i]) * (y - yi) / (yj - yi) + R[i]) inside = !inside;
    }
    return inside;
  }
  function reverseRing(R) {
    var n = R.length, o = new Float64Array(n);
    for (var k = 0; k < n; k += 2) { o[k] = R[n - 2 - k]; o[k + 1] = R[n - 1 - k]; }
    return o;
  }
  // Échange x et y (et l'ordre des sommets, pour garder l'orientation).
  function swapXY(rings) {
    return rings.map(function (R) {
      var n = R.length, o = new Float64Array(n);
      for (var k = 0; k < n; k += 2) { var j = n - 2 - k; o[k] = R[j + 1]; o[k + 1] = R[j]; }
      return o;
    });
  }
  // Douglas-Peucker sur un anneau fermé (tolérance dans l'unité des coordonnées).
  function simplifyRing(R, tol) {
    var n = R.length >> 1;
    if (!(tol > 0) || n <= 8) return R;
    var keep = new Uint8Array(n), tol2 = tol * tol, far = 0, fd = -1, k;
    for (k = 1; k < n; k++) {
      var ddx = R[2 * k] - R[0], ddy = R[2 * k + 1] - R[1], dd = ddx * ddx + ddy * ddy;
      if (dd > fd) { fd = dd; far = k; }
    }
    keep[0] = keep[far] = 1;
    var stack = [0, far, far, n];
    while (stack.length) {
      var b = stack.pop(), a = stack.pop(), bi = b % n;
      var ax = R[2 * a], ay = R[2 * a + 1], dx = R[2 * bi] - ax, dy = R[2 * bi + 1] - ay, L2 = dx * dx + dy * dy;
      var best = -1, bestD = tol2;
      for (k = a + 1; k < b; k++) {
        var px = R[2 * k] - ax, py = R[2 * k + 1] - ay, d;
        if (L2 > 0) { var cr = px * dy - py * dx; d = cr * cr / L2; } else d = px * px + py * py;
        if (d > bestD) { bestD = d; best = k; }
      }
      if (best >= 0) { keep[best] = 1; stack.push(a, best, best, b); }
    }
    var out = [];
    for (k = 0; k < n; k++) if (keep[k]) out.push(R[2 * k], R[2 * k + 1]);
    return out.length >= 6 ? new Float64Array(out) : R;
  }
  function packRings(rings) {
    var total = 0;
    rings.forEach(function (R) { total += R.length; });
    var pts = new Float32Array(total), starts = new Uint32Array(rings.length + 1), o = 0;
    rings.forEach(function (R, k) { starts[k] = o / 2; pts.set(R, o); o += R.length; });
    starts[rings.length] = o / 2;
    return { pts: pts, starts: starts };
  }

  /* ------------------------------------------------------------------ */
  /*  Étape A : image -> masque à l'échelle (taches retirées)             */
  /* ------------------------------------------------------------------ */
  function Ctx(gray, w, h) { this.gray = gray; this.w = w; this.h = h; this.memo = {}; this.blurKey = ''; this.blur = null; }
  function context(gray, w, h) { return new Ctx(gray, w, h); }

  function blurred(ctx, sigma, crop) {
    var key = sigma + '|' + (crop ? crop.join(',') : '');
    if (ctx.blurKey === key) return ctx.blur;
    var W = ctx.w, H = ctx.h, g = ctx.gray, f = new Float32Array(W * H), i, x, y;
    if (crop) {
      f.fill(255);
      for (y = crop[1]; y < crop[3]; y++) for (x = crop[0], i = y * W + x; x < crop[2]; x++, i++) f[i] = g[i];
    } else for (i = 0; i < f.length; i++) f[i] = g[i];
    gaussBlur(f, W, H, sigma);
    ctx.blur = f; ctx.blurKey = key;
    return f;
  }

  function stageA(ctx, P) {
    // marge en plus autour du dessin quand une ligne ou le pinceau peut en sortir (mm)
    var room = P.edits.some(function (e) { return e.t === 'line' || e.t === 'paint'; }) ? 10 : 0;
    var key = ['A', room, P.threshold, P.invert ? 1 : 0, P.smooth, P.speck, P.mode === 'inverse' ? P.margin : -1,
      P.sizeAxis, P.size, P.crop ? P.crop.join(',') : '', P.draft ? 1 : 0, P.minStroke, P.bridge].join('|');
    var memo = ctx.memo;
    if (memo.A && memo.A.key === key) return memo.A;
    memo.B = memo.C = memo.D = memo.E = null;
    var W = ctx.w, H = ctx.h, g = ctx.gray, thr = P.threshold, inv = P.invert, x, y, i;
    var cr = P.crop || [0, 0, W, H];
    var cx0 = clamp(Math.round(cr[0]), 0, W - 1), cy0 = clamp(Math.round(cr[1]), 0, H - 1);
    var cx1 = clamp(Math.round(cr[2]), cx0 + 1, W), cy1 = clamp(Math.round(cr[3]), cy0 + 1, H);
    // 1) au pas de l'image : boîte englobante du sujet, taches exclues
    var bin = new Uint8Array(W * H);
    for (y = cy0; y < cy1; y++) for (x = cx0, i = y * W + x; x < cx1; x++, i++) {
      var gv = g[i];
      if (inv ? gv > thr : gv < thr) bin[i] = 1;
    }
    var comps = label(bin, W, H, 1).comps;
    bin = null;
    if (!comps.length) return (memo.A = { key: key, empty: true });
    var big = 0;
    comps.forEach(function (c) { if (c.area > big) big = c.area; });
    var frame = P.mode === 'inverse' ? P.margin : 0;
    var box = function (minArea) {
      var b = null;
      comps.forEach(function (c) {
        if (c.area < minArea) return;
        if (!b) { b = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }; return; }
        if (c.x0 < b.x0) b.x0 = c.x0; if (c.y0 < b.y0) b.y0 = c.y0;
        if (c.x1 > b.x1) b.x1 = c.x1; if (c.y1 > b.y1) b.y1 = c.y1;
      });
      return b;
    };
    var scaleOf = function (b) {
      var avail = Math.max(1, P.size - 2 * frame);
      return avail / (P.sizeAxis === 'h' ? b.y1 - b.y0 + 1 : b.x1 - b.x0 + 1);
    };
    var bb = box(Math.max(2, big * 0.0005)), s = scaleOf(bb);
    bb = box(Math.max(2, P.speck / (s * s))) || bb;
    s = scaleOf(bb);
    // 2) pas du masque : fin (≥ 0,08 mm) mais borné à ~6 M pixels
    var sw = (bb.x1 - bb.x0 + 1) * s, sh = (bb.y1 - bb.y0 + 1) * s, ow = sw + 2 * frame, oh = sh + 2 * frame;
    var r = Math.max(0.08, Math.max(ow, oh) / 4500, Math.sqrt(ow * oh / 6e6));
    if (P.draft) r *= 2;
    var pad = Math.ceil((frame + Math.max(P.minStroke, P.bridge) + 1 + room) / r) + 2;
    var spw = Math.ceil(sw / r), sph = Math.ceil(sh / r), mw = spw + 2 * pad, mh = sph + 2 * pad;
    // 3) champ flou de l'image : lissage + anti-crénelage si le masque est plus grossier que l'image
    var aa = r > s ? 0.45 * r / s : 0, sp = P.smooth * 0.35;
    var sig = Math.round(Math.sqrt(sp * sp + aa * aa) * 20) / 20;
    var fld = blurred(ctx, sig, P.crop ? [cx0, cy0, cx1, cy1] : null);
    // boîte remesurée sur l'image floue (c'est elle qu'on échantillonne) : la cote demandée tombe juste
    if (sig >= 0.4) {
      var bin2 = new Uint8Array(W * H);
      for (y = cy0; y < cy1; y++) for (x = cx0, i = y * W + x; x < cx1; x++, i++) {
        if (inv ? fld[i] > thr : fld[i] < thr) bin2[i] = 1;
      }
      comps = label(bin2, W, H, 1).comps;
      bin2 = null;
      var bb2 = box(Math.max(2, P.speck / (s * s)));
      if (bb2) {
        bb = bb2; s = scaleOf(bb);
        sw = (bb.x1 - bb.x0 + 1) * s; sh = (bb.y1 - bb.y0 + 1) * s;
        spw = Math.ceil(sw / r); sph = Math.ceil(sh / r); mw = spw + 2 * pad; mh = sph + 2 * pad;
      }
    }
    // 4) échantillonnage bilinéaire au pas du masque, puis seuil
    var m = new Uint8Array(mw * mh), k = r / s;
    var umin = cx0 - 0.5, umax = cx1 - 0.5, vmin = cy0 - 0.5, vmax = cy1 - 0.5;
    for (var j = 0; j < mh; j++) {
      var vc = bb.y0 + (j - pad + 0.5) * k - 0.5;
      if (vc < vmin || vc > vmax) continue;
      var iy = Math.floor(vc), fy = vc - iy;
      var ya = clamp(iy, cy0, cy1 - 1) * W, yb = clamp(iy + 1, cy0, cy1 - 1) * W;
      for (var ii = 0; ii < mw; ii++) {
        var uc = bb.x0 + (ii - pad + 0.5) * k - 0.5;
        if (uc < umin || uc > umax) continue;
        var ix = Math.floor(uc), fx = uc - ix, xa = clamp(ix, cx0, cx1 - 1), xb = clamp(ix + 1, cx0, cx1 - 1);
        var top = fld[ya + xa] + (fld[ya + xb] - fld[ya + xa]) * fx;
        var bot = fld[yb + xa] + (fld[yb + xb] - fld[yb + xa]) * fx;
        var val = top + (bot - top) * fy;
        if (inv ? val > thr : val < thr) m[j * mw + ii] = 1;
      }
    }
    // 5) nettoyage : taches isolées et micro-trous plus petits que « Taches ignorées »
    var speckPx = P.speck / (r * r);
    removeSmall(m, mw, mh, 1, speckPx);
    removeSmall(m, mw, mh, 0, speckPx);
    return (memo.A = { key: key, m: m, mw: mw, mh: mh, r: r, pad: pad, spw: spw, sph: sph, s: s, bb: bb, frame: frame, W: W, H: H });
  }

  /* ------------------------------------------------------------------ */
  /*  Étape B : rendu (plein, contour, inversé)                           */
  /* ------------------------------------------------------------------ */
  function stageB(ctx, P, A) {
    var key = A.key + '|B|' + P.mode + '|' + (P.mode === 'contour' ? P.stroke + ':' + P.strokeMin + ':' + P.adapt : '');
    var memo = ctx.memo;
    if (memo.B && memo.B.key === key) return memo.B;
    var w = A.mw, h = A.mh, n = w * h, base = A.m, out, i, x, y;
    if (P.mode === 'contour') {
      // bande intérieure le long de chaque bord : la taille hors tout ne change pas
      var D = edt(invert(base, n), w, h).d, wmax = P.stroke / A.r, wmin = Math.min(wmax, P.strokeMin / A.r), ad = P.adapt / 100;
      out = new Uint8Array(n);
      if (ad > 0 && wmin < wmax) {
        // trait adaptatif : demi-épaisseur locale de la forme = plus grande distance au vide dans un rayon de
        // 2 traits ; dans un détail plus étroit, le trait s'amincit (60 % de cette demi-épaisseur), jamais sous le
        // trait minimum. ad = part de l'amincissement (0 = largeur fixe).
        var loc = maxFilter(Float32Array.from(D), w, h, Math.ceil(2 * wmax));
        for (i = 0; i < n; i++) {
          if (!base[i]) continue;
          var wl = Math.max(wmin, Math.min(wmax, 0.6 * Math.sqrt(loc[i]))), wf = wmax + (wl - wmax) * ad + 0.5;
          if (D[i] <= wf * wf) out[i] = 1;
        }
      } else {
        var lim = wmax + 0.5;
        lim *= lim;
        for (i = 0; i < n; i++) if (base[i] && D[i] <= lim) out[i] = 1;
      }
    } else if (P.mode === 'inverse') {
      // plaque aux coins arrondis, la forme y est découpée
      out = new Uint8Array(n);
      var fr = A.frame / A.r, x0 = A.pad - fr, y0 = A.pad - fr, x1 = A.pad + A.spw + fr, y1 = A.pad + A.sph + fr;
      var rc = Math.min(fr, 4 / A.r);
      for (y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
        for (x = Math.max(0, Math.floor(x0)), i = y * w + x; x < Math.min(w, Math.ceil(x1)); x++, i++) {
          if (!base[i] && inRoundRect(x + 0.5, y + 0.5, x0, y0, x1, y1, rc)) out[i] = 1;
        }
      }
    } else out = base.slice();
    return (memo.B = { key: key, m: out });
  }

  /* ------------------------------------------------------------------ */
  /*  Étape C : contrôles de fabrication                                  */
  /* ------------------------------------------------------------------ */
  function overrideFor(list, fx, fy) {
    var best = null, bd = 0.012 * 0.012;
    list.forEach(function (o) {
      var dx = o.fx - fx, dy = o.fy - fy, d = dx * dx + dy * dy;
      if (d <= bd) { bd = d; best = o.act; }
    });
    return best;
  }

  // Ponts « face à face ». Frontière de Voronoï entre morceaux (pixels dont les sites les plus proches sont
  // dans deux morceaux différents) : chaque tronçon continu = une zone où deux morceaux se font face.
  // Retenues : toutes les zones proches (≤ voisinage des deux morceaux) + l'arbre couvrant pour relier le reste.
  // Pont = point du milieu (axe principal) de la partie la plus serrée de la zone, d'un bord à l'autre.
  // ms = trait minimum en px. -> [{ ax, ay, bx, by }] en px
  // forbid : pixels où aucun pont ne passe (traits de gomme)
  function facingBridges(link, LL, w, h, ms, forbid) {
    var E = edt(link, w, h, true), idx = E.idx, lab = LL.lab, N = LL.comps.length + 1;
    // un pont qui traverserait un trait de gomme est écarté
    var crosses = function (a, b) {
      var ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w, L = Math.hypot(bx - ax, by - ay), ns = Math.min(200, Math.ceil(L));
      for (var q = 0; q <= ns; q++) { var t = ns ? q / ns : 0; if (forbid[Math.round(ay + (by - ay) * t) * w + Math.round(ax + (bx - ax) * t)]) return true; }
      return false;
    };
    var pairOf = new Map(), pairs = [], at = new Map(), bp = [], bk = [], bd = [], ba = [], bb = [];
    var rec = function (i, si, sj) {
      if (at.has(i) || (forbid && crosses(si, sj))) return;
      var la = lab[si], lb = lab[sj], t;
      if (la > lb) { t = la; la = lb; lb = t; t = si; si = sj; sj = t; }
      var key = la * N + lb, pk = pairOf.get(key);
      if (pk === undefined) { pk = pairs.length; pairOf.set(key, pk); pairs.push([la, lb]); }
      var ax = si % w, ay = (si - ax) / w, bx = sj % w, by = (sj - bx) / w;
      at.set(i, bp.length);
      bp.push(i); bk.push(pk); bd.push(Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by))); ba.push(si); bb.push(sj);
    };
    var x, y, i, si, sj, k;
    for (y = 0; y < h; y++) {
      for (x = 0, i = y * w; x < w; x++, i++) {
        si = idx[i];
        if (si < 0) continue;
        if (x < w - 1 && (sj = idx[i + 1]) >= 0 && lab[sj] !== lab[si]) rec(i, si, sj);
        else if (y < h - 1 && (sj = idx[i + w]) >= 0 && lab[sj] !== lab[si]) rec(i, si, sj);
      }
    }
    E = null; idx = null;
    // zones : points voisins (5 × 5) de la même paire
    var zoneOf = new Int32Array(bp.length).fill(-1), zones = [];
    for (var s = 0; s < bp.length; s++) {
      if (zoneOf[s] >= 0) continue;
      var z = { pk: bk[s], pts: [], d: Infinity }, st = [s];
      zoneOf[s] = zones.length;
      while (st.length) {
        var q = st.pop(), pi = bp[q], px = pi % w, py = (pi - px) / w;
        z.pts.push(q);
        if (bd[q] < z.d) z.d = bd[q];
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            var nx = px + dx, ny = py + dy, nq;
            if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            nq = at.get(ny * w + nx);
            if (nq === undefined || zoneOf[nq] >= 0 || bk[nq] !== z.pk) continue;
            zoneOf[nq] = zones.length; st.push(nq);
          }
        }
      }
      zones.push(z);
    }
    // voisinage d'un morceau : max(4 traits, 1,6 × la distance à son plus proche voisin)
    var nn = new Float64Array(N).fill(Infinity);
    zones.forEach(function (zz) { var p = pairs[zz.pk]; nn[p[0]] = Math.min(nn[p[0]], zz.d); nn[p[1]] = Math.min(nn[p[1]], zz.d); });
    var near = function (c) { return Math.max(4 * ms, 1.6 * nn[c]); };
    var keep = new Uint8Array(zones.length);
    zones.forEach(function (zz, kk) { var p = pairs[zz.pk]; if (zz.d <= Math.min(near(p[0]), near(p[1]))) keep[kk] = 1; });
    // arbre couvrant : les zones proches relient déjà ; on complète au plus court
    var order = zones.map(function (zz, kk) { return kk; }).sort(function (a, b) { return zones[a].d - zones[b].d; });
    var par = new Int32Array(N);
    for (k = 0; k < N; k++) par[k] = k;
    var find = function (a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    var join = function (kk) { var p = pairs[zones[kk].pk], ra = find(p[0]), rb = find(p[1]); if (ra === rb) return false; par[ra] = rb; return true; };
    order.forEach(function (kk) { if (keep[kk]) join(kk); });
    order.forEach(function (kk) { if (!keep[kk] && join(kk)) keep[kk] = 1; });
    var out = [];
    zones.forEach(function (zz, kk) {
      if (!keep[kk]) return;
      var lim = Math.max(zz.d * 1.5, zz.d + 4 * ms);
      var sub = zz.pts.filter(function (q) { return bd[q] <= lim; }), cnt = sub.length, mx = 0, my = 0, sxx = 0, syy = 0, sxy = 0;
      var X = function (q) { return bp[q] % w; }, Y = function (q) { return (bp[q] / w) | 0; };
      sub.forEach(function (q) { mx += X(q); my += Y(q); });
      mx /= cnt; my /= cnt;
      sub.forEach(function (q) { var ex = X(q) - mx, ey = Y(q) - my; sxx += ex * ex; syy += ey * ey; sxy += ex * ey; });
      // milieu pris sur le côté le plus étroit qui fait face (ex. le bout d'un arc, pas le nuage) :
      // projection des sites de chaque morceau sur l'axe principal de la zone
      var ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
      var side = function (arr) {
        var lo = Infinity, hi = -Infinity, t = sub.map(function (q) {
          var p = arr[q], v = (p % w - mx) * ux + (((p / w) | 0) - my) * uy;
          if (v < lo) lo = v; if (v > hi) hi = v;
          return v;
        });
        return { t: t, mid: (lo + hi) / 2, span: hi - lo };
      };
      var sa = side(ba), sb = side(bb), sd = sa.span <= sb.span ? sa : sb, best = sub[0], bs = Infinity;
      sub.forEach(function (q, j) { var sc = Math.abs(sd.t[j] - sd.mid) + 0.05 * bd[q]; if (sc < bs) { bs = sc; best = q; } });
      var a = ba[best], b = bb[best];
      out.push({ ax: a % w, ay: (a / w) | 0, bx: b % w, by: (b / w) | 0 });
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  Retouches (mode Édition) : appliquées au masque rendu, avant les    */
  /*  contrôles. Points en pixels de l'image source (stables au recadrage */
  /*  et à la taille).                                                    */
  /* ------------------------------------------------------------------ */
  var ERASE_W = 2;          // diamètre par défaut du pinceau et de la gomme (mm)
  // Courbe douce passant par les points [[x, y], …], échantillonnée au pas `step`. -> [x0, y0, x1, y1, …]
  // Sans `ends` : Catmull-Rom centripète. Avec ends = [d0, d1] (directions unitaires ou null) : la courbe part
  // dans la direction d0 et arrive dans la direction d1 (Hermite ; tangente = d × longueur de la corde).
  function spline(pts, step, ends) {
    var n = pts.length, out = [];
    if (!n) return out;
    out.push(pts[0][0], pts[0][1]);
    if (n < 2) return out;
    var i, s, segs;
    if (ends && (ends[0] || ends[1])) {
      var tan = function (k) {
        var a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)], f = k === 0 || k === n - 1 ? 1 : 0.5;
        var d = k === 0 ? ends[0] : k === n - 1 ? ends[1] : null;
        if (!d) return [(b[0] - a[0]) * f, (b[1] - a[1]) * f];
        var c = k === 0 ? pts[1] : pts[n - 2], L = Math.hypot(c[0] - pts[k][0], c[1] - pts[k][1]);
        return [d[0] * L, d[1] * L];
      };
      for (i = 0; i < n - 1; i++) {
        var p0 = pts[i], p1 = pts[i + 1], m0 = tan(i), m1 = tan(i + 1);
        segs = Math.max(2, Math.ceil(1.3 * Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / step));
        for (s = 1; s <= segs; s++) {
          var t = s / segs, t2 = t * t, t3 = t2 * t;
          var h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = 3 * t2 - 2 * t3, h11 = t3 - t2;
          out.push(h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0], h00 * p0[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1]);
        }
      }
      return out;
    }
    var pt = function (i) {
      if (i < 0) return [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]];
      if (i > n - 1) return [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]];
      return pts[i];
    };
    var kn = function (a, b) { return Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1]))); };
    var lerp = function (a, b, ta, tb, t) {
      var u = (t - ta) / (tb - ta);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    };
    for (i = 0; i < n - 1; i++) {
      var q0 = pt(i - 1), q1 = pt(i), q2 = pt(i + 1), q3 = pt(i + 2);
      var t0 = 0, t1 = t0 + kn(q0, q1), tt2 = t1 + kn(q1, q2), tt3 = tt2 + kn(q2, q3);
      segs = Math.max(1, Math.ceil(Math.hypot(q2[0] - q1[0], q2[1] - q1[1]) / step));
      for (s = 1; s <= segs; s++) {
        var u = t1 + (tt2 - t1) * s / segs;
        var A1 = lerp(q0, q1, t0, t1, u), A2 = lerp(q1, q2, t1, tt2, u), A3 = lerp(q2, q3, tt2, tt3, u);
        var B1 = lerp(A1, A2, t0, tt2, u), B2 = lerp(A2, A3, t1, tt3, u), C = lerp(B1, B2, t1, tt2, u);
        out.push(C[0], C[1]);
      }
    }
    return out;
  }
  // Pose la valeur v dans un trait épais (capsule) entre deux points (px).
  function stamp(m, w, h, ax, ay, bx, by, rad, v) {
    var x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rad)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + rad));
    var y0 = Math.max(0, Math.floor(Math.min(ay, by) - rad)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + rad));
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, r2 = rad * rad;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= r2) m[y * w + x] = v;
      }
    }
  }
  // Largeur (mm) des traits du dessin : médiane de 2 × distance au vide sur l'axe des traits (crêtes).
  function typicalWidth(m, D, w, h, r) {
    var hist = new Int32Array(121), tot = 0, x, y, i;
    for (y = 1; y < h - 1; y++) {
      for (x = 1, i = y * w + 1; x < w - 1; x++, i++) {
        var d = D[i];
        if (!m[i] || d < D[i - 1] || d < D[i + 1] || d < D[i - w] || d < D[i + w]) continue;
        hist[Math.min(120, Math.round(2 * Math.sqrt(d) * r * 4))]++; tot++;
      }
    }
    for (i = 0, x = 0; i < 121; i++) { x += hist[i]; if (x * 2 >= tot) return i / 4; }
    return 0;
  }
  // Arête sans épaisseur le long de la polyligne cv (px) : un mur qui couvre chaque case traversée ; tout vide
  // qu'il coupe en plusieurs morceaux est rempli, sauf les morceaux qui donnent sur le dehors (à défaut le plus
  // grand), et le mur rejoint le côté rempli. dry : sur une copie. -> { n: pixels remplis, x, y: leur centre }
  function edgeFill(m, w, h, cv, dry) {
    var n = w * h, L0 = label(m, w, h, 0), t = dry ? m.slice() : m, wall = new Uint8Array(n), q, i;
    for (q = 2; q < cv.length; q += 2) stamp(wall, w, h, cv[q - 2], cv[q - 1], cv[q], cv[q + 1], 0.72, 1);
    for (i = 0; i < n; i++) {
      if (!wall[i]) continue;
      if (t[i]) wall[i] = 0; else t[i] = 1;
    }
    var L1 = label(t, w, h, 0), parent = new Int32Array(L1.comps.length + 1), fill = new Uint8Array(L1.comps.length + 1), groups = {};
    for (i = 0; i < n; i++) { var l1 = L1.lab[i]; if (l1 && !parent[l1]) parent[l1] = L0.lab[i]; }
    L1.comps.forEach(function (cc) { (groups[parent[cc.id]] = groups[parent[cc.id]] || []).push(cc); });
    Object.keys(groups).forEach(function (g) {
      var list = groups[g];
      if (list.length < 2) return;
      var out = list.filter(function (cc) { return cc.border; }), big = list.reduce(function (a, b) { return b.area > a.area ? b : a; });
      list.forEach(function (cc) { if (out.length ? !cc.border : cc !== big) fill[cc.id] = 1; });
    });
    var cnt = 0, sx = 0, sy = 0, lab = L1.lab;
    for (i = 0; i < n; i++) if (fill[lab[i]]) { t[i] = 1; cnt++; sx += i % w; sy += (i / w) | 0; }
    for (i = 0; i < n; i++) {
      if (!wall[i]) continue;
      var x = i % w, y = (i - x) / w, keep = false;
      for (var dy = -1; dy <= 1 && !keep; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && fill[lab[yy * w + xx]]) { keep = true; break; }
        }
      }
      if (!keep) t[i] = 0;
    }
    return { n: cnt, x: cnt ? sx / cnt : 0, y: cnt ? sy / cnt : 0 };
  }
  // Bout d'une ligne posé sur la pointe d'un trait : centre de la matière dans un disque de 1,5 largeur ; loin
  // du point = pointe. -> direction du trait vers sa pointe [dx, dy], ou null (milieu de trait, croisement)
  function tipDir(m, w, h, x0, y0, wd) {
    var R = Math.max(2, 1.5 * wd), c = 0, tot = 0, sx = 0, sy = 0, xx, yy;
    for (yy = Math.max(0, Math.floor(y0 - R)); yy <= Math.min(h - 1, Math.ceil(y0 + R)); yy++) {
      for (xx = Math.max(0, Math.floor(x0 - R)); xx <= Math.min(w - 1, Math.ceil(x0 + R)); xx++) {
        if ((xx - x0) * (xx - x0) + (yy - y0) * (yy - y0) > R * R) continue;
        tot++;
        if (m[yy * w + xx]) { c++; sx += xx; sy += yy; }
      }
    }
    if (!c) return null;
    var gx = x0 - sx / c, gy = y0 - sy / c, gl = Math.hypot(gx, gy);
    return gl < 0.35 * wd || c / tot > 0.4 ? null : [gx / gl, gy / gl];
  }
  // Ramène le milieu de la courbe vers un contour parallèle aux traits qui la longent : là où la matière la plus
  // proche est sur le côté (pas devant ni derrière), l'écart est rapproché de sa médiane. Déplacement borné
  // (≤ 2 mm et ≤ 1/4 de l'écart), nul aux bouts (zone `endZone` px). cv modifiée en place.
  function hugNeighbours(cv, Dm, w, h, r, endZone) {
    var N = cv.length >> 1, k;
    if (N < 6) return;
    var cum = new Float64Array(N);
    for (k = 1; k < N; k++) cum[k] = cum[k - 1] + Math.hypot(cv[2 * k] - cv[2 * k - 2], cv[2 * k + 1] - cv[2 * k - 1]);
    var T = cum[N - 1], e = endZone / T;
    if (e >= 0.45) return;
    var R = 12 / r, rec = [], bal = 0;
    for (k = 1; k < N - 1; k++) {
      var x = cv[2 * k], y = cv[2 * k + 1], xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
      var i = yi * w + xi, d2 = Dm.d[i], st = Dm.idx[i];
      if (!(d2 > 1) || d2 > R * R || st < 0) continue;
      var d = Math.sqrt(d2), nx = (st % w - x) / d, ny = (((st / w) | 0) - y) / d;
      var tx = cv[2 * k + 2] - cv[2 * k - 2], ty = cv[2 * k + 3] - cv[2 * k - 1], tl = Math.hypot(tx, ty) || 1;
      if (Math.abs((nx * tx + ny * ty) / tl) > 0.5) continue;
      var sg = tx * ny - ty * nx > 0 ? 1 : -1;
      bal += sg;
      rec.push({ k: k, d: d, ux: nx, uy: ny, sg: sg });
    }
    var side = bal >= 0 ? 1 : -1;
    rec = rec.filter(function (o) { return o.sg === side; });
    if (rec.length < 0.25 * N) return;
    var ds = rec.map(function (o) { return o.d; }).sort(function (a, b) { return a - b; }), target = ds[ds.length >> 1];
    var ss = function (u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
    var moved = false;
    rec.forEach(function (o) {
      var s = cum[o.k] / T, wt = s < e ? ss(s / e) : s > 1 - e ? ss((1 - s) / e) : 1;
      var cap = Math.min(2 / r, 0.25 * o.d), dl = clamp(o.d - target, -cap, cap) * wt;
      if (!dl) return;
      cv[2 * o.k] += o.ux * dl; cv[2 * o.k + 1] += o.uy * dl; moved = true;
    });
    if (!moved) return;
    for (var it = 0; it < 4; it++) {
      for (k = 1; k < N - 1; k++) {
        cv[2 * k] = 0.5 * cv[2 * k] + 0.25 * (cv[2 * k - 2] + cv[2 * k + 2]);
        cv[2 * k + 1] = 0.5 * cv[2 * k + 1] + 0.25 * (cv[2 * k - 1] + cv[2 * k + 3]);
      }
    }
  }
  // Applique les retouches dans l'ordre. -> [{ ok, why, pts (px) }] pour l'affichage.
  //   fill  : vide fermé cliqué -> plein (rien si la zone touche le dehors)
  //   empty : zone pleine cliquée -> vidée, il reste un contour de la largeur des traits du dessin
  //   line  : arête sans épaisseur par les points ; elle part et arrive dans le prolongement des traits qu'elle
  //           relie, suit les traits qui la longent, et le côté qu'elle ferme est rempli
  //   paint / erase : pinceau rond à main levée (diamètre s mm), plein ou vide
  function applyEdits(m, w, h, A, P, erased) {
    var info = [], r = A.r, k = A.r / A.s, n = w * h;
    var toPx = function (q) { return [(q[0] + 0.5 - A.bb.x0) / k + A.pad - 0.5, (q[1] + 0.5 - A.bb.y0) / k + A.pad - 0.5]; };
    var at = function (p) { var x = Math.round(p[0]), y = Math.round(p[1]); return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1; };
    P.edits.forEach(function (e) {
      var res = { ok: true, why: '', pts: [] }, i, c, q;
      info.push(res);
      if (e.t === 'fill' || e.t === 'empty') {
        var p = toPx(e.p), pi = at(p);
        res.pts = [p[0], p[1]];
        if (e.t === 'fill') {
          if (pi < 0 || m[pi]) { res.ok = false; res.why = pi < 0 ? 'ouvert' : 'plein'; return; }
          var L = label(m, w, h, 0);
          c = L.comps[L.lab[pi] - 1];
          if (c.border) { res.ok = false; res.why = 'ouvert'; return; }
          fillComp(m, w, L.lab, c, 1);
          return;
        }
        if (pi < 0 || !m[pi]) { res.ok = false; res.why = 'vide'; return; }
        var D = edt(invert(m, n), w, h).d, rim = Math.max(P.minStroke, Math.min(15, typicalWidth(m, D, w, h, r))) / r;
        var core = new Uint8Array(n), lim = (rim + 0.5) * (rim + 0.5);
        for (i = 0; i < n; i++) if (m[i] && D[i] >= lim) core[i] = 1;
        if (!core[pi]) { res.ok = false; res.why = 'mince'; return; }
        var LC = label(core, w, h, 1);
        fillComp(m, w, LC.lab, LC.comps[LC.lab[pi] - 1], 0);
        return;
      }
      var pts = e.pts.map(toPx);
      if (e.t === 'erase' || e.t === 'paint') {
        var rb = e.s / (2 * r), fl = [];
        pts.forEach(function (p2) { fl.push(p2[0], p2[1]); });
        res.pts = fl;
        for (q = 0; q < fl.length; q += 2) {
          var qa = q ? q - 2 : 0;
          stamp(m, w, h, fl[qa], fl[qa + 1], fl[q], fl[q + 1], rb, e.t === 'paint' ? 1 : 0);
          if (e.t === 'erase') stamp(erased, w, h, fl[qa], fl[qa + 1], fl[q], fl[q + 1], rb + 1, 1);
        }
        return;
      }
      // ligne-arête. Bouts : dans la matière -> largeur et direction du trait (pointe) ; dans le vide -> prolongés
      // en droite jusqu'à la matière la plus proche (≤ 4 mm)
      var Din = edt(invert(m, n), w, h).d, Dm = edt(m, w, h, true), step = Math.max(0.7, 0.5 / r);
      var end = function (p2) {
        var j = at(p2), o = { p: p2, tip: null, wd: 0, pre: null };
        if (j < 0) return o;
        if (!m[j]) {
          var st = Dm.idx[j];
          if (st >= 0 && Dm.d[j] <= (4 / r) * (4 / r)) o.pre = [st % w, (st / w) | 0];
          return o;
        }
        var best = 0, rr = Math.ceil(1.5 / r), xx, yy, x0 = Math.round(p2[0]), y0 = Math.round(p2[1]);
        for (yy = Math.max(0, y0 - rr); yy <= Math.min(h - 1, y0 + rr); yy++) {
          for (xx = Math.max(0, x0 - rr); xx <= Math.min(w - 1, x0 + rr); xx++) if (m[yy * w + xx] && Din[yy * w + xx] > best) best = Din[yy * w + xx];
        }
        o.wd = 2 * Math.sqrt(best);
        o.tip = o.wd ? tipDir(m, w, h, p2[0], p2[1], o.wd) : null;
        return o;
      };
      var E0 = end(pts[0]), E1 = end(pts[pts.length - 1]);
      Din = null;
      // courbe : départ dans le prolongement du trait de départ, arrivée en entrant dans le trait d'arrivée
      var inside = function (cv) {
        for (var j = 0; j < cv.length; j += 2) if (cv[j] < 1 || cv[j + 1] < 1 || cv[j] > w - 2 || cv[j + 1] > h - 2) return false;
        return true;
      };
      var build = function (g) {
        var cv = null;
        [1, 0.6, 0.3, 0].some(function (f) {
          var dirs = [E0.tip ? [E0.tip[0] * f, E0.tip[1] * f] : null, E1.tip ? [-E1.tip[0] * f, -E1.tip[1] * f] : null];
          cv = spline(g, step, f ? dirs : null);
          return inside(cv);
        });
        hugNeighbours(cv, Dm, w, h, r, Math.max(3 / r, 2 * Math.max(E0.wd, E1.wd)));
        var head = [], tail = [];
        if (E0.pre) head.push(E0.pre[0], E0.pre[1]);
        if (g[0] !== E0.p) head.push(E0.p[0], E0.p[1]);
        if (g[g.length - 1] !== E1.p) tail.push(E1.p[0], E1.p[1]);
        if (E1.pre) tail.push(E1.pre[0], E1.pre[1]);
        return { cv: cv, all: head.concat(cv, tail) };
      };
      var B0 = build(pts);
      if (B0.cv.length < 4) { res.ok = false; res.why = 'court'; return; }
      var F = edgeFill(m, w, h, B0.all, true);
      if (!F.n) { res.ok = false; res.why = 'ferme'; res.pts = B0.cv; return; }
      // bouts sur une pointe : l'arête part du bord extérieur du trait (côté opposé à la zone remplie), pour que
      // ce bord continue sans marche
      var shift = function (E) {
        if (!E.tip) return E.p;
        var nx = -E.tip[1], ny = E.tip[0];
        if (nx * (F.x - E.p[0]) + ny * (F.y - E.p[1]) > 0) { nx = -nx; ny = -ny; }
        return [E.p[0] + nx * E.wd / 2, E.p[1] + ny * E.wd / 2];
      };
      var g = pts.slice();
      g[0] = shift(E0); g[g.length - 1] = shift(E1);
      var B1 = E0.tip || E1.tip ? build(g) : B0;
      if (B1 !== B0 && !edgeFill(m, w, h, B1.all, true).n) B1 = B0;
      edgeFill(m, w, h, B1.all, false);
      res.pts = B1.cv;
    });
    return info;
  }
  // Bouts de traits (pointes de la matière) sur les contours (mm) : là où le contour fait demi-tour sur une
  // courte longueur. Point renvoyé = centre du bout arrondi (pour l'aimant des lignes). -> [x, y, …]
  function strokeTips(rings) {
    var out = [], big = 0, ba = 0;
    rings.forEach(function (R) { var a = ringArea(R); if (Math.abs(a) > ba) { ba = Math.abs(a); big = a; } });
    var sg = big < 0 ? -1 : 1;
    var near = function (x, y) {
      for (var k = 0; k < out.length; k += 2) if (Math.abs(out[k] - x) < 1.5 && Math.abs(out[k + 1] - y) < 1.5) return true;
      return false;
    };
    [1.5, 3, 6, 12].forEach(function (d) {
      rings.forEach(function (R) {
        var n = R.length >> 1, k;
        if (n < 6) return;
        var cum = new Float64Array(n + 1);
        for (k = 0; k < n; k++) { var q = (k + 1) % n; cum[k + 1] = cum[k] + Math.hypot(R[2 * q] - R[2 * k], R[2 * q + 1] - R[2 * k + 1]); }
        var T = cum[n];
        if (T < 4 * d) return;
        var ptAt = function (s) {
          s = ((s % T) + T) % T;
          var lo = 0, hi = n;
          while (hi - lo > 1) { var md = (lo + hi) >> 1; if (cum[md] <= s) lo = md; else hi = md; }
          var q2 = (lo + 1) % n, u = (s - cum[lo]) / Math.max(1e-9, cum[lo + 1] - cum[lo]);
          return [R[2 * lo] + (R[2 * q2] - R[2 * lo]) * u, R[2 * lo + 1] + (R[2 * q2 + 1] - R[2 * lo + 1]) * u];
        };
        var run = null;
        var flush = function () { if (run && !near(run.x, run.y)) out.push(run.x, run.y); run = null; };
        for (k = 0; k <= n; k++) {
          var kk = k % n, px = R[2 * kk], py = R[2 * kk + 1], a = ptAt(cum[kk] - d), b = ptAt(cum[kk] + d);
          var ch = Math.hypot(a[0] - b[0], a[1] - b[1]), ratio = ch / (2 * d);
          var cr = (px - a[0]) * (b[1] - py) - (py - a[1]) * (b[0] - px);
          if (ratio < 0.45 && cr * sg > 0) {
            var mx = (a[0] + b[0]) / 2 - px, my = (a[1] + b[1]) / 2 - py, ml = Math.hypot(mx, my) || 1, dd = Math.min(ml, ch / 2);
            if (!run || ratio < run.ratio) run = { ratio: ratio, x: px + mx / ml * dd, y: py + my / ml * dd };
          } else flush();
        }
        flush();
      });
    });
    return out;
  }

  function stageC(ctx, P, A, B) {
    var isl = P.islands.map(function (o) { return o.fx + ':' + o.fy + ':' + o.act; }).join(';');
    var key = B.key + '|C|' + P.minStroke + '|' + P.bridge + '|' + P.holeMin + '|' + P.islandMode + '|' + isl + '|' + P.thinMode + '|' + P.holeMode + '|' + (P.back === 'none' ? 0 : 1) +
      '|' + JSON.stringify(P.edits) + (P.edits.length ? '|' + P.stroke : '');
    var memo = ctx.memo;
    if (memo.C && memo.C.key === key) return memo.C;
    var w = A.mw, h = A.mh, n = w * h, r = A.r, m = B.m.slice(), i, x, y, k;
    var erased = new Uint8Array(n), edits = P.edits.length ? applyEdits(m, w, h, A, P, erased) : [];
    var added = new Uint8Array(n), dropM = new Uint8Array(n), apartM = new Uint8Array(n);
    var counts = { islands: 0, link: 0, drop: 0, apart: 0, thin: 0, holes: 0, bridges: 0, pieces: 0 };

    // 1) morceaux détachés : le plus gros = le corps ; les autres suivent le choix global ou le leur
    var L1 = label(m, w, h, 1), comps = L1.comps.slice().sort(function (a, b) { return b.area - a.area; });
    var islands = [];
    for (k = 1; k < comps.length; k++) {
      var c = comps[k];
      var fx = round3((c.sx / c.area - A.pad + 0.5) / A.spw), fy = round3((c.sy / c.area - A.pad + 0.5) / A.sph);
      var act = overrideFor(P.islands, fx, fy) || P.islandMode;
      counts.islands++; counts[act]++;
      islands.push({ fx: fx, fy: fy, act: act, area: c.area * r * r, bb: [c.x0, c.y0, c.x1, c.y1] });
      if (act === 'drop') fillComp(m, w, L1.lab, c, 0, dropM);
      else if (act === 'apart') fillComp(apartM, w, L1.lab, c, 1);
    }
    L1 = null;

    // 2) passages plus minces que le trait minimum (ouverture morphologique de rayon trait/2)
    var rt = P.minStroke / (2 * r);
    var Din = edt(invert(m, n), w, h).d;
    var core = new Uint8Array(n), cl = Math.max(0, rt - 0.25);
    cl *= cl;
    for (i = 0; i < n; i++) if (m[i] && Din[i] >= cl) core[i] = 1;
    var Dc = edt(core, w, h).d, ol = (rt + 0.5) * (rt + 0.5), thin = new Uint8Array(n);
    for (i = 0; i < n; i++) if (m[i] && Dc[i] > ol) thin[i] = 1;
    Dc = null; core = null;
    var TL = label(thin, w, h, 1), minZone = Math.max(4, 0.6 * rt * rt);
    TL.comps.forEach(function (cc) { if (cc.area < minZone) fillComp(thin, w, TL.lab, cc, 0); else counts.thin++; });
    TL = null;
    if (P.thinMode === 'fix' && counts.thin) {
      // axe médian des zones minces, regonflé au rayon du trait minimum
      var ridge = new Uint8Array(n);
      for (y = 0; y < h; y++) {
        for (x = 0, i = y * w; x < w; x++, i++) {
          if (!thin[i]) continue;
          var d = Din[i];
          var hx = (x === 0 || d >= Din[i - 1]) && (x === w - 1 || d >= Din[i + 1]);
          var vy = (y === 0 || d >= Din[i - w]) && (y === h - 1 || d >= Din[i + w]);
          if (hx || vy) ridge[i] = 1;
        }
      }
      var Dr = edt(ridge, w, h).d;
      for (i = 0; i < n; i++) if (!m[i] && Dr[i] <= ol) { m[i] = 1; added[i] = 1; }
      thin = null;
    }
    Din = null;

    // 3) petits trous fermés : trop étroits pour bien s'imprimer
    var HL = label(m, w, h, 0), holeM = new Uint8Array(n), holeMin = P.holeMin / r, Dout = null;
    HL.comps.forEach(function (hc) {
      if (hc.border) return;
      if (!Dout) Dout = edt(m, w, h).d;
      var mx = 0;
      for (var yy = hc.y0; yy <= hc.y1; yy++) {
        for (var xx = hc.x0, j = yy * w + hc.x0; xx <= hc.x1; xx++, j++) if (HL.lab[j] === hc.id && Dout[j] > mx) mx = Dout[j];
      }
      if (2 * Math.sqrt(mx) - 1 >= holeMin) return;
      counts.holes++;
      if (P.holeMode === 'fill') fillComp(m, w, HL.lab, hc, 1, added);
      else fillComp(holeM, w, HL.lab, hc, 1);
    });
    HL = null; Dout = null;

    // 4) ponts : chaque morceau (sauf « à part ») relié à TOUS ses voisins proches — un arc tient par ses deux
    //    bouts, la forme reste symétrique — et, au besoin, au reste par le plus court (arbre couvrant) pour que
    //    tout tienne en une pièce. Chaque pont est posé au milieu de la zone où les deux morceaux se font face,
    //    perpendiculaire au vide.
    var link = new Uint8Array(n);
    for (i = 0; i < n; i++) if (m[i] && !apartM[i]) link[i] = 1;
    var LL = label(link, w, h, 1);
    var bridges = [];
    if (LL.comps.length > 1 && P.back === 'none') {   // avec un fond, les îlots se collent dessus : aucun pont
      var hasErase = P.edits.some(function (e) { return e.t === 'erase'; });
      bridges = facingBridges(link, LL, w, h, P.bridge / r, hasErase ? erased : null);
      var rad = P.bridge / (2 * r) + 0.5;   // demi-largeur des ponts (réglage propre)
      bridges.forEach(function (e) { drawCapsule(m, w, h, e.ax, e.ay, e.bx, e.by, rad, added); counts.bridges++; });
    }
    LL = null; link = null;

    counts.pieces = label(m, w, h, 1).comps.length;
    return (memo.C = { key: key, m: m, edits: edits, added: added, thin: thin, holeM: holeM, dropM: dropM, apartM: apartM, islands: islands, bridges: bridges, counts: counts });
  }

  /* ------------------------------------------------------------------ */
  /*  Étape D : segments au format du plateau                            */
  /* ------------------------------------------------------------------ */
  // Joint à tenon caché au dos (couture s, tenon = ov mm) : la pièce k va de la couture s(k-1) jusqu'au bout
  // du tenon s(k) + ov ; celle d'après commence à s(k) (rainure dans [s, s + ov]).
  var TENON_WALL = 1.0;     // paroi de chaque côté de la rainure (mm)
  var TENON_MIN = 0.8;      // tenon plus étroit = pas de tenon (trait trop mince : simple collage bout à bout)
  // « Âme » des traits = matière à au moins TENON_WALL du bord (le tenon), sans les filets plus étroits
  // que TENON_MIN (ouverture). Gardée sur l'étape C (calculée une fois par tracé).
  function coreOf(C, A) {
    if (C.core) return C.core;
    var w = A.mw, h = A.mh, n = w * h, r = A.r, m = C.m, i;
    var D = edt(invert(m, n), w, h).d, lim = TENON_WALL / r, core = new Uint8Array(n);
    lim *= lim;
    for (i = 0; i < n; i++) if (m[i] && D[i] >= lim) core[i] = 1;
    D = null;
    var rad = TENON_MIN / 2 / r;
    if (rad >= 0.7) {
      var D2 = edt(invert(core, n), w, h).d, er = new Uint8Array(n), r2 = rad * rad;
      for (i = 0; i < n; i++) if (core[i] && D2[i] >= r2) er[i] = 1;
      D2 = null;
      var D3 = edt(er, w, h).d, r3 = (rad + 0.5) * (rad + 0.5);
      for (i = 0; i < n; i++) if (core[i] && D3[i] > r3) core[i] = 0;
    }
    return (C.core = core);
  }

  // Coutures adaptatives. Chaque coupe garde une position de départ (auto : pièces de même largeur ; ou
  // glissée) et une marge de part et d'autre (≤ SEAM_BAND, bornée pour que chaque pièce tienne sur le plateau).
  // Dans cette marge, le chemin le moins coûteux (programmation dynamique sur une grille de ~0,7 mm) : le vide
  // ne coûte presque rien, la matière coûte cher (un trait se traverse au plus court, donc à angle droit et là
  // où il est étroit), la matière dans la zone du tenon aussi (un trait longé serait fendu en lamelle).
  // Ensuite, les morceaux seuls (bout de trait ou miette qui ne tient à rien dans sa pièce) sont pénalisés et
  // le chemin recalculé : il les contourne et ils restent avec la pièce voisine.
  var SEAM_BAND = 60;       // écart max. d'une couture de part et d'autre de sa position (mm)
  var SEAM_PASSES = 6;      // passes pour contourner les morceaux seuls
  // Couture : position v (mm, sur l'axe coupé) en fonction de u (mm, sur l'autre axe), linéaire par morceaux,
  // prolongée à plat au-delà des bouts. { u: croissant, v }
  function seamAt(S, u) {
    var U = S.u, n = U.length;
    if (u <= U[0]) return S.v[0];
    if (u >= U[n - 1]) return S.v[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var md = (lo + hi) >> 1; if (U[md] <= u) lo = md; else hi = md; }
    return S.v[lo] + (S.v[hi] - S.v[lo]) * (u - U[lo]) / (U[hi] - U[lo]);
  }
  // Polyligne [u, v] simplifiée (Douglas-Peucker sur v, tolérance tol mm) -> couture.
  function makeSeam(us, vs, tol) {
    var n = us.length, keep = new Uint8Array(n), st = [[0, n - 1]], k;
    keep[0] = keep[n - 1] = 1;
    while (st.length) {
      var s = st.pop(), a = s[0], b = s[1], best = -1, bd = tol;
      for (k = a + 1; k < b; k++) {
        var t = (us[k] - us[a]) / (us[b] - us[a] || 1), d = Math.abs(vs[k] - (vs[a] + (vs[b] - vs[a]) * t));
        if (d > bd) { bd = d; best = k; }
      }
      if (best > 0) { keep[best] = 1; st.push([a, best], [best, b]); }
    }
    var u = [], v = [];
    for (k = 0; k < n; k++) if (keep[k] && (!u.length || us[k] > u[u.length - 1] + 1e-9)) { u.push(us[k]); v.push(vs[k]); }
    return { u: new Float64Array(u), v: new Float64Array(v) };
  }
  function stageD(ctx, P, A, C) {
    var key = C.key + '|D|' + P.printer + '|' + P.overlap + '|' + (P.cuts ? JSON.stringify(P.cuts) : 'auto');
    var memo = ctx.memo;
    if (memo.D && memo.D.key === key) return memo.D;
    var w = A.mw, h = A.mh, m = C.m, r = A.r, x, y, i, k, q;
    var bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    for (y = 0; y < h; y++) {
      for (x = 0, i = y * w; x < w; x++, i++) {
        if (!m[i]) continue;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
    if (bx1 < 0) return (memo.D = { key: key, empty: true });
    var Wm = (bx1 - bx0 + 1) * r, Hm = (by1 - by0 + 1) * r;
    var bed = BEDS[P.printer], U = bed - 2 * BED_MARGIN, ov = P.overlap;
    var seg = { bed: bed, U: U, ov: ov, w: Wm, h: Hm, auto: true, impossible: false, cols: 1, rows: 1, list: [] };
    // 1) nombre de pièces, positions de départ et marges de chaque couture
    ['x', 'y'].forEach(function (ax) {
      var L = ax === 'x' ? Wm : Hm, G = seg[ax] = { L: L, cuts: [], need: 0, joints: [], auto: true, seams: [], lo: [], hi: [] };
      if (L <= U) return;
      if (U <= ov + 10) { seg.impossible = true; return; }
      var N = Math.ceil((L - ov) / (U - ov) - 1e-9), cs = [];
      G.need = N - 1;
      var manual = (P.cuts && P.cuts[ax] || []).map(function (f) { return clamp(f * L, 15, L - ov - 15); }).sort(function (a, c) { return a - c; });
      if (manual.length >= G.need) { cs = manual; G.auto = false; seg.auto = false; }
      else for (k = 0; k < G.need; k++) cs.push((k + 1) * ((L + G.need * ov) / N - ov));
      G.cuts = cs;
      var n = cs.length, slack = [];
      for (k = 0; k <= n; k++) slack.push(Math.max(0, U - ((k < n ? cs[k] + ov : L) - (k ? cs[k - 1] : 0))));
      // la moitié du jeu de chaque pièce voisine (tout le jeu pour une pièce de bout), 15 mm des bords,
      // un tenon + 10 mm entre deux coutures
      for (k = 0; k < n; k++) {
        G.hi[k] = Math.max(0, Math.min(SEAM_BAND, slack[k] * (k === 0 ? 1 : 0.5), L - ov - 15 - cs[k]));
        G.lo[k] = Math.max(0, Math.min(SEAM_BAND, slack[k + 1] * (k + 1 === n ? 1 : 0.5), cs[k] - 15));
      }
      for (k = 0; k + 1 < n; k++) {
        var room = Math.max(0, cs[k + 1] - cs[k] - ov - 10), used = G.hi[k] + G.lo[k + 1];
        if (used > room) { G.hi[k] *= room / used; G.lo[k + 1] *= room / used; }
      }
    });
    var multi = seg.x.cuts.length + seg.y.cuts.length > 0;
    // 2) grille grossière (~0,7 mm) sur la boîte de la pièce : part de matière, part sans âme (trop mince
    //    pour un tenon), morceaux « à part » (imprimés seuls, hors du décompte des morceaux)
    var f = Math.max(1, Math.round(0.7 / r)), g0 = f * r, cw = Math.ceil((bx1 - bx0 + 1) / f), ch = Math.ceil((by1 - by0 + 1) / f), nc = cw * ch;
    var fr = new Float32Array(multi ? nc : 0), thinF = new Float32Array(multi ? nc : 0), ap = new Uint8Array(multi ? nc : 0);
    var core = multi && !P.draft ? coreOf(C, A) : null;
    if (multi) {
      for (y = by0; y <= by1; y++) {
        var rowq = (((y - by0) / f) | 0) * cw;
        for (x = bx0, i = y * w + bx0; x <= bx1; x++, i++) {
          if (!m[i]) continue;
          q = rowq + (((x - bx0) / f) | 0);
          fr[q]++;
          if (core && !core[i]) thinF[q]++;
          if (C.apartM[i]) ap[q] = 1;
        }
      }
      for (q = 0; q < nc; q++) { fr[q] /= f * f; thinF[q] /= f * f; }
    }
    var mat = function (q2) { return fr[q2] >= 0.4 && !ap[q2]; };
    // matière (cases) cumulée le long des rangées (coutures verticales) et des colonnes (horizontales)
    var preR = multi ? new Float32Array((cw + 1) * ch) : null, preC = multi ? new Float32Array((ch + 1) * cw) : null, a, b;
    if (multi) {
      for (b = 0; b < ch; b++) for (a = 0; a < cw; a++) preR[b * (cw + 1) + a + 1] = preR[b * (cw + 1) + a] + fr[b * cw + a];
      for (a = 0; a < cw; a++) for (b = 0; b < ch; b++) preC[a * (ch + 1) + b + 1] = preC[a * (ch + 1) + b] + fr[b * cw + a];
    }
    var pen = new Float32Array(multi ? nc : 0), ovc = Math.max(1, Math.round(ov / g0));
    // chemin d'une couture -> position (mm) par ligne de la grille (rangée pour ax = 'x', colonne pour 'y')
    var path = function (ax, k2) {
      var G = seg[ax], c = G.cuts[k2], nL = ax === 'x' ? ch : cw, nP = ax === 'x' ? cw : ch, l, p, out = new Float64Array(nL);
      var p0 = Math.max(0, Math.ceil((c - G.lo[k2]) / g0 - 0.5)), p1 = Math.min(nP - 1, Math.floor((c + G.hi[k2]) / g0 - 0.5));
      if (P.draft || p1 - p0 < 2) { out.fill(c); return out; }
      var nb = p1 - p0 + 1, cost = new Float64Array(nb), nxt = new Float64Array(nb), dxs = new Int8Array(nL * nb);
      var wl = new Float64Array(nb), zl = new Float64Array(nb), zw = g0 * g0;   // zw : mm² par case de matière dans la zone du tenon
      // poids des cases d'une ligne (vide 1, matière 41, sans âme 201, + pénalité) et matière dans la zone du tenon
      var line = function (l2) {
        for (var p2 = 0; p2 < nb; p2++) {
          var a2 = p2 + p0, q2 = ax === 'x' ? l2 * cw + a2 : a2 * cw + l2, e2 = Math.min(ax === 'x' ? cw : ch, a2 + ovc);
          wl[p2] = 1 + 40 * fr[q2] + 160 * thinF[q2] + pen[q2];
          zl[p2] = zw * (ax === 'x' ? preR[l2 * (cw + 1) + e2] - preR[l2 * (cw + 1) + a2] : preC[l2 * (ch + 1) + e2] - preC[l2 * (ch + 1) + a2]);
        }
      };
      var L1 = g0 * Math.SQRT2, L2 = g0 * Math.sqrt(5), D1 = 0.3 * g0, D2 = 0.6 * g0;
      line(0);
      for (p = 0; p < nb; p++) cost[p] = g0 * wl[p] + zl[p];
      for (l = 1; l < nL; l++) {
        line(l);
        for (p = 0; p < nb; p++) {
          var wp = wl[p], best = cost[p] + g0 * wp, bd = 0, cc, mx;
          if (p > 0) { mx = wl[p - 1] > wp ? wl[p - 1] : wp; cc = cost[p - 1] + L1 * mx + D1; if (cc < best) { best = cc; bd = 1; } }
          if (p < nb - 1) { mx = wl[p + 1] > wp ? wl[p + 1] : wp; cc = cost[p + 1] + L1 * mx + D1; if (cc < best) { best = cc; bd = -1; } }
          if (p > 1) { mx = Math.max(wl[p - 2], wl[p - 1], wp); cc = cost[p - 2] + L2 * mx + D2; if (cc < best) { best = cc; bd = 2; } }
          if (p < nb - 2) { mx = Math.max(wl[p + 2], wl[p + 1], wp); cc = cost[p + 2] + L2 * mx + D2; if (cc < best) { best = cc; bd = -2; } }
          nxt[p] = best + zl[p]; dxs[l * nb + p] = bd;
        }
        var tmp = cost; cost = nxt; nxt = tmp;
      }
      var pe = 0;
      for (p = 1; p < nb; p++) if (cost[p] < cost[pe]) pe = p;
      for (l = nL - 1; l >= 0; l--) { out[l] = (pe + p0 + 0.5) * g0; pe -= dxs[l * nb + pe]; }
      // lissage léger (le chemin suit la grille par marches de 0,5 mm)
      for (var it = 0; it < 2; it++) {
        var prev = out[0];
        for (l = 1; l < nL - 1; l++) { var cur = out[l]; out[l] = 0.25 * prev + 0.5 * cur + 0.25 * out[l + 1]; prev = cur; }
      }
      for (l = 0; l < nL; l++) out[l] = clamp(out[l], c - G.lo[k2], c + G.hi[k2]);
      return out;
    };
    // pièce de chaque case selon les coutures, puis morceaux par pièce : le plus gros = la pièce, les autres
    // sont des morceaux seuls -> { n: nombre, area: cases, cells: [[q…]…], per: morceaux par pièce }
    var nX = seg.x.cuts.length + 1, nY = seg.y.cuts.length + 1;
    var analyse = function (PX, PY) {
      var cid = new Int32Array(nc), lab = new Int32Array(nc), st = [], comps = [];
      for (b = 0; b < ch; b++) {
        for (a = 0; a < cw; a++) {
          var xm = (a + 0.5) * g0, ym = (b + 0.5) * g0, ii = 0, jj = 0;
          for (k = 0; k < PX.length; k++) if (xm >= PX[k][b]) ii++;
          for (k = 0; k < PY.length; k++) if (ym >= PY[k][a]) jj++;
          cid[b * cw + a] = jj * nX + ii;
        }
      }
      for (q = 0; q < nc; q++) {
        if (lab[q] || !mat(q)) continue;
        var cc2 = { id: comps.length + 1, cell: cid[q], cells: [] };
        comps.push(cc2); lab[q] = cc2.id; st.push(q);
        while (st.length) {
          var p2 = st.pop(), px = p2 % cw, py = (p2 - px) / cw;
          cc2.cells.push(p2);
          for (var dy = -1; dy <= 1; dy++) for (var dx2 = -1; dx2 <= 1; dx2++) {
            var nx = px + dx2, ny = py + dy, q2 = ny * cw + nx;
            if (nx < 0 || ny < 0 || nx >= cw || ny >= ch || lab[q2] || cid[q2] !== cc2.cell || !mat(q2)) continue;
            lab[q2] = cc2.id; st.push(q2);
          }
        }
      }
      var big = {}, res = { n: 0, area: 0, cells: [], per: new Int32Array(nX * nY) };
      comps.forEach(function (o) { if (!big[o.cell] || o.cells.length > big[o.cell].cells.length) big[o.cell] = o; });
      comps.forEach(function (o) {
        res.per[o.cell]++;
        if (big[o.cell] === o) return;
        res.n++; res.area += o.cells.length; res.cells.push(o.cells);
      });
      return res;
    };
    var PX = seg.x.cuts.map(function (c, k2) { return path('x', k2); }), PY = seg.y.cuts.map(function (c, k2) { return path('y', k2); });
    var FR = multi && !P.draft ? analyse(PX, PY) : null;
    if (FR) {
      for (var pass = 1; pass < SEAM_PASSES && FR.cells.length; pass++) {
        // pénalité sur les morceaux seuls (élargis de 2 cases) : le prochain chemin passe à côté
        FR.cells.forEach(function (list) {
          list.forEach(function (q2) {
            var px = q2 % cw, py = (q2 - px) / cw;
            for (var dy = -2; dy <= 2; dy++) for (var dx2 = -2; dx2 <= 2; dx2++) {
              var nx = px + dx2, ny = py + dy;
              if (nx >= 0 && ny >= 0 && nx < cw && ny < ch) pen[ny * cw + nx] = Math.min(400, pen[ny * cw + nx] + 80);
            }
          });
        });
        var PX2 = seg.x.cuts.map(function (c, k2) { return path('x', k2); }), PY2 = seg.y.cuts.map(function (c, k2) { return path('y', k2); });
        var F2 = analyse(PX2, PY2);
        if (F2.n < FR.n || (F2.n === FR.n && F2.area < FR.area)) { PX = PX2; PY = PY2; FR = F2; }
        else FR.cells = F2.cells;   // on garde le meilleur, mais les nouveaux morceaux sont pénalisés aussi
      }
    }
    // 3) coutures (mm, repère de la pièce) : internes (découpe 3D) et polylignes pour l'aperçu
    var SX = [], SY = [];
    ['x', 'y'].forEach(function (ax) {
      var Ps = ax === 'x' ? PX : PY, nL = ax === 'x' ? ch : cw, Lu = ax === 'x' ? Hm : Wm, G = seg[ax];
      Ps.forEach(function (pos, k2) {
        var us = [-20], vs = [pos[0]], l;
        for (l = 0; l < nL; l++) { us.push((l + 0.5) * g0); vs.push(pos[l]); }
        us.push(Lu + 20); vs.push(pos[nL - 1]);
        var S = makeSeam(us, vs, 0.05), vis = makeSeam(us, vs, 0.3), pl = [], last = null;
        (ax === 'x' ? SX : SY).push(S);
        for (var j = 0; j < vis.u.length; j++) {
          var uu = clamp(vis.u[j], 0, Lu);
          if (uu === last) continue;
          last = uu;
          var vv = seamAt(S, uu);
          if (ax === 'x') pl.push(vv, uu); else pl.push(uu, vv);
        }
        G.seams.push(pl);
        // traits coupés et traits qui portent un tenon, le long du chemin
        var strokes = 0, tenons = 0, inS = false, inT = false;
        for (l = 0; l < nL; l++) {
          var pc = clamp(Math.floor(pos[l] / g0), 0, (ax === 'x' ? cw : ch) - 1), q2 = ax === 'x' ? l * cw + pc : pc * cw + l;
          var sM = fr[q2] >= 0.4, sT = sM && fr[q2] - thinF[q2] >= 0.2;
          if (sM && !inS) strokes++;
          if (sT && !inT) tenons++;
          inS = sM; inT = sT;
        }
        if (core) G.joints.push({ at: G.cuts[k2], strokes: strokes, tenons: tenons });
      });
    });
    // 4) pièces : de la couture précédente (au plus loin) au bout du tenon de la suivante
    var ext = function (Ps, k2, L) {
      var lo = Infinity, hi = -Infinity, l;
      if (k2) for (l = 0; l < Ps[k2 - 1].length; l++) lo = Math.min(lo, Ps[k2 - 1][l]);
      if (k2 < Ps.length) for (l = 0; l < Ps[k2].length; l++) hi = Math.max(hi, Ps[k2][l]);
      return [k2 ? lo : 0, k2 < Ps.length ? hi + ov : L];
    };
    seg.cols = nX; seg.rows = nY;
    for (var j2 = 0; j2 < nY; j2++) {
      for (k = 0; k < nX; k++) {
        var ex = ext(PX, k, Wm), ey = ext(PY, j2, Hm), cw2 = ex[1] - ex[0], ch2 = ey[1] - ey[0];
        seg.list.push({
          i: seg.list.length, col: k, row: j2, name: cellName(k, j2, nX, nY),
          x0: ex[0], x1: ex[1], y0: ey[0], y1: ey[1], w: cw2, h: ch2, fits: cw2 <= U + 1e-6 && ch2 <= U + 1e-6,
          pose: nX * nY > 1 ? 'dos' : 'face', frags: FR ? FR.per[j2 * nX + k] : 1
        });
      }
    }
    seg.loose = FR ? FR.n : 0;
    return (memo.D = { key: key, bx0: bx0, by0: by0, w: Wm, h: Hm, seg: seg, sx: SX, sy: SY });
  }
  // Nom d'une pièce : numéro seul sur une rangée ou une colonne, sinon rangée en lettre + colonne (A1, A2, B1…).
  function cellName(i, j, nX, nY) {
    if (nY === 1) return String(i + 1);
    if (nX === 1) return String(j + 1);
    return String.fromCharCode(65 + j) + (i + 1);
  }

  /* ------------------------------------------------------------------ */
  /*  Étape E : contours lissés (mm, origine = coin de la pièce)          */
  /* ------------------------------------------------------------------ */
  function stageE(ctx, P, A, C, D) {
    var key = C.key + '|E|' + P.simplify;
    var memo = ctx.memo;
    if (memo.E && memo.E.key === key) return memo.E;
    var w = A.mw, h = A.mh, r = A.r, ox = D.bx0 * r, oy = D.by0 * r;
    var toMm = function (px, tol, minArea) {
      var out = [];
      px.forEach(function (R) {
        var o = new Float64Array(R.length);
        for (var k = 0; k < R.length; k += 2) { o[k] = (R[k] + 0.5) * r - ox; o[k + 1] = (R[k + 1] + 0.5) * r - oy; }
        o = simplifyRing(o, tol);
        if (Math.abs(ringArea(o)) >= minArea) out.push(o);
      });
      return out;
    };
    var rings = toMm(contours(smoothField(C.m, w, h), w, h, 0.5), Math.max(0.02, P.simplify), 0.05);
    var over = function (mask) {
      if (!mask) return null;
      for (var i = 0, n = mask.length; i < n; i++) if (mask[i]) return packRings(toMm(contours(mask, w, h, 0.5), r * 0.5, 0));
      return null;
    };
    return (memo.E = {
      key: key, rings: rings,
      over: { added: over(C.added), thin: over(C.thin), holes: over(C.holeM), drop: over(C.dropM), apart: over(C.apartM) }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Étape F : fond (imprimé à part, la pièce se colle dessus)           */
  /* ------------------------------------------------------------------ */
  // Contour : la silhouette pleine (trous bouchés) élargie de la marge ; rectangle : boîte + marge, coins
  // arrondis. Anneaux en mm dans le repère de la pièce (ils sortent de [0, w] × [0, h] de la marge).
  function stageF(ctx, P, A, C, D) {
    if (P.back === 'none') return null;
    var key = C.key + '|F|' + P.back + '|' + P.backM + '|' + P.simplify;
    var memo = ctx.memo;
    if (memo.F && memo.F.key === key) return memo.F;
    var M = P.backM, rings = [], k;
    if (P.back === 'rect') {
      var rr = Math.min(BACK_R, M + 1), x0 = -M, y0 = -M, x1 = D.w + M, y1 = D.h + M, pts = [];
      [[x1 - rr, y1 - rr, 0], [x0 + rr, y1 - rr, 90], [x0 + rr, y0 + rr, 180], [x1 - rr, y0 + rr, 270]].forEach(function (c) {
        for (k = 0; k <= 6; k++) { var a = (c[2] + k * 15) * Math.PI / 180; pts.push(c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)); }
      });
      rings.push(new Float64Array(pts));
    } else {
      var w = A.mw, h = A.mh, r = A.r, p = Math.ceil(M / r) + 3, W2 = w + 2 * p, H2 = h + 2 * p, x, y, i;
      // silhouette pleine : les vides qui ne touchent pas le bord sont des trous
      var full = new Uint8Array(C.m), L = label(C.m, w, h, 0);
      L.comps.forEach(function (c) { if (!c.border) fillComp(full, w, L.lab, c, 1, null); });
      L = null;
      var big = new Uint8Array(W2 * H2);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (full[y * w + x]) big[(y + p) * W2 + x + p] = 1;
      full = null;
      if (M > 0) {
        var dd = edt(big, W2, H2).d, lim = (M / r) * (M / r);
        for (i = 0; i < big.length; i++) big[i] = dd[i] <= lim ? 1 : 0;
        dd = null;
      }
      var ox = (D.bx0 + p) * r, oy = (D.by0 + p) * r;   // pixel X du grand masque = X − p du masque
      contours(smoothField(big, W2, H2), W2, H2, 0.5).forEach(function (R) {
        var o = new Float64Array(R.length);
        for (k = 0; k < R.length; k += 2) { o[k] = (R[k] + 0.5) * r - ox; o[k + 1] = (R[k + 1] + 0.5) * r - oy; }
        o = simplifyRing(o, Math.max(0.05, P.simplify));
        if (Math.abs(ringArea(o)) >= 1) rings.push(o);
      });
    }
    var bb = [Infinity, Infinity, -Infinity, -Infinity], area = 0;
    rings.forEach(function (R) {
      var b = ringBox(R);
      if (b[0] < bb[0]) bb[0] = b[0]; if (b[1] < bb[1]) bb[1] = b[1]; if (b[2] > bb[2]) bb[2] = b[2]; if (b[3] > bb[3]) bb[3] = b[3];
      area += ringArea(R);
    });
    return (memo.F = { key: key, rings: rings, box: rings.length ? bb : null, area: Math.abs(area) });
  }

  function run(ctx, P) {
    var A = stageA(ctx, P);
    if (A.empty) return null;
    var B = stageB(ctx, P, A), C = stageC(ctx, P, A, B), D = stageD(ctx, P, A, C);
    if (D.empty) return null;
    return { A: A, B: B, C: C, D: D, E: stageE(ctx, P, A, C, D), F: stageF(ctx, P, A, C, D) };
  }
  // La cote demandée vaut pour la pièce FINALE : si un morceau retiré (ou un épaississement)
  // change la boîte, on refait le calcul à l'échelle corrigée — correction retenue pour ces réglages.
  function geoKey(P) {
    return [P.threshold, P.invert, P.smooth, P.speck, P.crop, P.mode, P.stroke, P.strokeMin, P.adapt, P.margin, P.sizeAxis, P.size, P.minStroke, P.bridge, P.holeMin,
      P.islandMode, JSON.stringify(P.islands), P.thinMode, P.holeMode, P.back === 'none' ? 0 : 1, JSON.stringify(P.edits), P.draft].join('|');
  }
  function stages(ctx, P) {
    var gk = geoKey(P), Q = P;
    if (ctx.fix && ctx.fix.k === gk) Q = Object.assign({}, P, { size: ctx.fix.size });
    var S = run(ctx, Q);
    if (!S || Q !== P) return S;
    var got = P.sizeAxis === 'h' ? S.D.h : S.D.w;
    if (got > 0 && Math.abs(got - P.size) > P.size * 0.003) {
      var size2 = P.size * P.size / got, S2 = run(ctx, Object.assign({}, P, { size: size2 }));
      if (S2) { ctx.fix = { k: gk, size: size2 }; return S2; }
    }
    return S;
  }

  // Résultat pour l'aperçu 2D et le panneau.
  function compute(ctx, P0) {
    var P = norm(P0), S = stages(ctx, P);
    if (!S) return { ok: false, reason: 'empty' };
    var A = S.A, C = S.C, D = S.D, r = A.r, ox = D.bx0 * r, oy = D.by0 * r, area = 0, i, n;
    for (i = 0, n = C.m.length; i < n; i++) area += C.m[i];
    area *= r * r;
    return {
      ok: true, draft: P.draft, w: D.w, h: D.h, r: r,
      image: { x: A.pad * r - A.bb.x0 * A.s - ox, y: A.pad * r - A.bb.y0 * A.s - oy, w: A.W * A.s, h: A.H * A.s },
      piece: packRings(S.E.rings),
      over: S.E.over,
      islands: C.islands.map(function (o) {
        return { fx: o.fx, fy: o.fy, act: o.act, area: o.area,
          x: o.bb[0] * r - ox, y: o.bb[1] * r - oy, w: (o.bb[2] - o.bb[0] + 1) * r, h: (o.bb[3] - o.bb[1] + 1) * r };
      }),
      bridges: C.bridges.map(function (e) {
        return [(e.ax + 0.5) * r - ox, (e.ay + 0.5) * r - oy, (e.bx + 0.5) * r - ox, (e.by + 0.5) * r - oy];
      }),
      // retouches (mm) et bouts de traits pour l'aimant des lignes
      edits: C.edits.map(function (e) {
        var o = [];
        for (var q = 0; q < e.pts.length; q += 2) o.push((e.pts[q] + 0.5) * r - ox, (e.pts[q + 1] + 0.5) * r - oy);
        return { ok: e.ok, why: e.why, pts: o };
      }),
      tips: P.draft ? [] : (S.E.tips || (S.E.tips = strokeTips(S.E.rings))),
      counts: C.counts, seg: D.seg, area: area, volume: area * P.thickness,
      back: S.F && S.F.box ? { rings: packRings(S.F.rings), box: S.F.box, T: P.backT, volume: S.F.area * P.backT } : null
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Découpe vectorielle (le long des coutures) et maillage              */
  /* ------------------------------------------------------------------ */
  // Garde la partie x < couture + d (keepLow) ou x ≥ couture + d d'un ensemble d'anneaux orientés de façon
  // cohérente (couture S : x en fonction de y, voir seamAt) ; les morceaux sont refermés le long de la couture
  // (pair/impair), en passant par ses sommets.
  function cutS(rings, S, d, keepLow) {
    var out = [], chains = [];
    var fv = function (x, y) { return x - seamAt(S, y) - d; };
    var ins = keepLow ? function (x, y) { return fv(x, y) < 0; } : function (x, y) { return fv(x, y) >= 0; };
    // point de la couture sur le segment a -> b (changement de côté) : dichotomie, puis posé sur la couture
    var cross = function (ax, ay, bx, by) {
      var lo = 0, hi = 1, sa = fv(ax, ay) < 0;
      for (var it = 0; it < 48; it++) {
        var md = (lo + hi) / 2;
        if ((fv(ax + (bx - ax) * md, ay + (by - ay) * md) < 0) === sa) lo = md; else hi = md;
      }
      var yy = ay + (by - ay) * (lo + hi) / 2;
      return [seamAt(S, yy) + d, yy];
    };
    // un côté de contour qui passe un sommet de la couture y est coupé : sur chaque morceau la couture est droite,
    // donc au plus un croisement (sinon un côté pourrait la traverser deux fois sans changer de côté)
    var U = S.u, vmin = Infinity, vmax = -Infinity, j;
    for (j = 0; j < U.length; j++) { if (S.v[j] < vmin) vmin = S.v[j]; if (S.v[j] > vmax) vmax = S.v[j]; }
    vmin += d - 1e-6; vmax += d + 1e-6;
    var dense = function (R) {
      var n = R.length >> 1, o = [], k, added = false;
      for (k = 0; k < n; k++) {
        var ax = R[2 * k], ay = R[2 * k + 1], b = (k + 1) % n, bx = R[2 * b], by = R[2 * b + 1];
        o.push(ax, ay);
        if (Math.max(ax, bx) < vmin || Math.min(ax, bx) > vmax || ay === by) continue;
        var lo = Math.min(ay, by), hi = Math.max(ay, by), mid = [];
        for (j = 0; j < U.length; j++) if (U[j] > lo && U[j] < hi) mid.push(U[j]);
        if (by < ay) mid.reverse();
        mid.forEach(function (u) { var t = (u - ay) / (by - ay); o.push(ax + (bx - ax) * t, u); added = true; });
      }
      return added ? new Float64Array(o) : R;
    };
    rings.forEach(function (R0) {
      var R = dense(R0), n = R.length >> 1, k, st = new Uint8Array(n), anyIn = false, anyOut = false;
      for (k = 0; k < n; k++) { st[k] = ins(R[2 * k], R[2 * k + 1]) ? 1 : 0; if (st[k]) anyIn = true; else anyOut = true; }
      if (!anyIn) return;
      if (!anyOut) { out.push(R0); return; }
      var k0 = 0;
      while (st[k0]) k0++;
      var cur = null;
      for (var t = 0; t < n; t++) {
        var a = (k0 + t) % n, b = (a + 1) % n, ia = st[a], ib = st[b];
        if (ia && cur) cur.pts.push(R[2 * a], R[2 * a + 1]);
        if (ia !== ib) {
          var X = cross(R[2 * a], R[2 * a + 1], R[2 * b], R[2 * b + 1]);
          if (!ia) cur = { pts: [X[0], X[1]], yin: X[1] };
          else if (cur) { cur.pts.push(X[0], X[1]); cur.yout = X[1]; chains.push(cur); cur = null; }
        }
      }
    });
    if (!chains.length) return out;
    var ends = [];
    chains.forEach(function (ch, k) { ends.push({ y: ch.yin, k: k, inn: true }, { y: ch.yout, k: k, inn: false }); });
    ends.sort(function (p, q) { return p.y - q.y; });
    var nextOf = new Int32Array(chains.length).fill(-1);
    for (var e = 0; e + 1 < ends.length; e += 2) {
      var p = ends[e], q = ends[e + 1];
      if (p.inn === q.inn) continue;
      nextOf[(p.inn ? q : p).k] = (p.inn ? p : q).k;
    }
    // sommets de la couture strictement entre y1 et y2, dans le sens de y1 vers y2
    var along = function (pts, y1, y2) {
      if (y2 > y1) { for (j = 0; j < U.length; j++) if (U[j] > y1 && U[j] < y2) pts.push(S.v[j] + d, U[j]); }
      else for (j = U.length - 1; j >= 0; j--) if (U[j] < y1 && U[j] > y2) pts.push(S.v[j] + d, U[j]);
    };
    var used = new Uint8Array(chains.length);
    for (var s = 0; s < chains.length; s++) {
      if (used[s]) continue;
      var seq = [], k2 = s, guard = 0;
      while (k2 >= 0 && !used[k2] && guard++ < 1e6) { used[k2] = 1; seq.push(k2); k2 = nextOf[k2]; }
      var closed = k2 === s, pts = [];
      seq.forEach(function (c, z) {
        var cp = chains[c].pts;
        for (var zz = 0; zz < cp.length; zz++) pts.push(cp[zz]);
        var nx = z + 1 < seq.length ? seq[z + 1] : closed ? seq[0] : -1;
        if (nx >= 0) along(pts, chains[c].yout, chains[nx].yin);
      });
      if (pts.length >= 6) out.push(new Float64Array(pts));
    }
    return out;
  }
  // Bande entre deux coutures décalées : lo / hi = { S, d } ou null (pas de limite de ce côté).
  function slabS(rings, lo, hi) {
    var o = hi ? cutS(rings, hi.S, hi.d, true) : rings;
    return lo ? cutS(o, lo.S, lo.d, false) : o;
  }
  // Anneaux (extérieurs > 0, trous < 0) -> polygones [extérieur, trou, trou…].
  function nest(rings) {
    var outers = [], holes = [];
    rings.forEach(function (R) {
      var a = ringArea(R);
      if (Math.abs(a) < 1e-4) return;
      (a > 0 ? outers : holes).push({ R: R, a: Math.abs(a), bb: ringBox(R) });
    });
    var polys = outers.map(function (o) { return { o: o, holes: [] }; });
    holes.forEach(function (hh) {
      var x = hh.R[0], y = hh.R[1], best = null;
      polys.forEach(function (p) {
        var b = p.o.bb;
        if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return;
        if (best && p.o.a >= best.o.a) return;
        if (inRing(p.o.R, x, y)) best = p;
      });
      if (best) best.holes.push(hh.R);
    });
    return polys.map(function (p) { return [p.o.R].concat(p.holes); });
  }
  // Prisme de polygones (y vers le haut, extérieurs CCW, trous CW) entre z0 et z1. Les parois suivent le bord
  // des triangles du dessus (et non les anneaux) : points doublés, alignés ou pincements qu'earcut saute ou
  // arrange, le maillage reste fermé.
  function extrude(polys, z0, z1, mesh) {
    polys.forEach(function (poly) {
      var flat = [], holeIdx = [], count = 0, base = mesh.v.length / 3, i, j;
      poly.forEach(function (R, k) {
        if (k) holeIdx.push(count);
        for (i = 0; i < R.length; i++) flat.push(R[i]);
        count += R.length / 2;
      });
      for (i = 0; i < count; i++) mesh.v.push(flat[2 * i], flat[2 * i + 1], z0, flat[2 * i], flat[2 * i + 1], z1);
      var tris = earcut(flat, holeIdx);
      var edges = new Map(), key = function (p, q) { return p * 4194304 + q; };
      for (j = 0; j < tris.length; j += 3) {
        var a = tris[j], b = tris[j + 1], c = tris[j + 2];
        var cr = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
        if (cr < 0) { var t = b; b = c; c = t; }
        mesh.t.push(base + 2 * a + 1, base + 2 * b + 1, base + 2 * c + 1);
        mesh.t.push(base + 2 * a, base + 2 * c, base + 2 * b);
        [[a, b], [b, c], [c, a]].forEach(function (e) { var kk = key(e[0], e[1]); edges.set(kk, (edges.get(kk) || 0) + 1); });
      }
      // bord du dessus (CCW) = arêtes sans jumelle : une paroi par arête, tournée vers l'extérieur
      edges.forEach(function (cnt, kk) {
        var p = Math.floor(kk / 4194304), q = kk - p * 4194304;
        if (edges.has(key(q, p))) return;
        var pb = base + 2 * p, qb = base + 2 * q;
        for (var r2 = 0; r2 < cnt; r2++) mesh.t.push(pb, qb, qb + 1, pb, qb + 1, pb + 1);
      });
    });
    return mesh;
  }

  // Pièces 3D de la grille, dans la position assemblée (z = 0 au mur, z = T en façade).
  // Joint à chaque coupe c (verticale ou horizontale) : la pièce de gauche (ou du haut) porte un TENON (âme
  // des traits, demi-épaisseur côté mur, de c à c + tenon − jeu) ; celle de droite (ou du bas) a la RAINURE
  // ouverte au dos (âme + jeu, de c à c + tenon), fermée devant par une peau, entre deux parois. Rien ne se
  // voit de face ; on pose la pièce suivante sur les tenons par l'arrière. Toutes les pièces s'impriment dos
  // au plateau (tenon et rainure au plateau, aucun porte-à-faux).
  // Au croisement de deux coupes : la pièce du bas à droite garde parois et peau, celle du haut à gauche y
  // prolonge son tenon ; les deux autres n'y mettent rien.
  // Un trait trop mince pour un tenon reste en simple collage bout à bout.
  function buildParts(ctx, P) {
    var S = stages(ctx, P);
    if (!S) return null;
    var A = S.A, C = S.C, D = S.D, seg = D.seg, T = P.thickness, ov = P.overlap, g = JOINT_GAP, Hm = D.h, r = A.r;
    var flipY = function (R) {
      var o = new Float64Array(R.length);
      for (var k = 0; k < R.length; k += 2) { o[k] = R[k]; o[k + 1] = Hm - R[k + 1]; }
      return o;
    };
    var rings = S.E.rings.map(flipY);
    var big = 0, ba = 0;
    rings.forEach(function (R) { var a = ringArea(R); if (Math.abs(a) > ba) { ba = Math.abs(a); big = a; } });
    var rev = big < 0;
    if (rev) rings = rings.map(reverseRing);
    var nx = seg.x.cuts.length, ny = seg.y.cuts.length, multi = seg.list.length > 1;
    // coutures dans le repère du maillage (y vers le haut) : verticales x = s(Hm − y) ; horizontales vues après
    // swapXY (axe coupé = Hm − t(x))
    var XS = D.sx.map(function (Q) {
      var n = Q.u.length, u = new Float64Array(n), v = new Float64Array(n);
      for (var k = 0; k < n; k++) { u[k] = Hm - Q.u[n - 1 - k]; v[k] = Q.v[n - 1 - k]; }
      return { u: u, v: v };
    });
    var YS = D.sy.map(function (Q) {
      var v = new Float64Array(Q.v.length);
      for (var k = 0; k < v.length; k++) v[k] = Hm - Q.v[k];
      return { u: Q.u, v: v };
    });
    var sets = { full: rings };
    if (multi) {
      // âme des traits (tenon) en mm, même repère et même sens que la pièce
      var w = A.mw, h = A.mh, ox = D.bx0 * r, oy = D.by0 * r, cm = coreOf(C, A);
      var ringsOf = function (field) {
        var out2 = [];
        contours(field, w, h, 0.5).forEach(function (R) {
          var o = new Float64Array(R.length);
          for (var k = 0; k < R.length; k += 2) { o[k] = (R[k] + 0.5) * r - ox; o[k + 1] = (R[k + 1] + 0.5) * r - oy; }
          o = simplifyRing(o, 0.05);
          if (Math.abs(ringArea(o)) >= 0.05) out2.push(rev ? reverseRing(flipY(o)) : flipY(o));
        });
        return out2;
      };
      sets.core = ringsOf(smoothField(cm, w, h));
      // rainure = âme + jeu : ligne de niveau d'un champ de distance à l'âme (bord de l'âme ≈ ½ px des centres),
      // jamais de contours qui se croisent ou se chevauchent
      var Dc = edt(cm, w, h).d, gf = new Float32Array(w * h), lim = 1.0137 + g / r;   // jamais pile sur 0,5 (distances entières)
      for (var q = 0; q < gf.length; q++) gf[q] = clamp(lim - Math.sqrt(Dc[q]), 0, 1);
      Dc = null;
      sets.groove = ringsOf(gf);
      sets.walls = rings.concat(sets.groove.map(reverseRing));   // trait moins la rainure (pair/impair)
    }
    // polygones d'un jeu d'anneaux entre les coutures (bornes { k, d } : couture k décalée de d mm, repère de
    // l'image) ; tx / ty : ne garder que ceux qui touchent ces coutures (un tenon doit tenir à sa pièce)
    var bx = function (o) { return o ? { S: XS[o.k], d: o.d } : null; };
    var by = function (o) { return o ? { S: YS[o.k], d: -o.d } : null; };
    var polys = function (set, zx, zy, tx, ty) {
      var R = slabS(sets[set], bx(zx.lo), bx(zx.hi));
      if (zy.lo || zy.hi) R = swapXY(slabS(swapXY(R), by(zy.hi), by(zy.lo)));
      var ps = nest(R);
      if (tx != null || ty != null) {
        ps = ps.filter(function (pp) {
          var Q = pp[0];
          for (var k = 0; k < Q.length; k += 2) {
            if (tx != null && Math.abs(Q[k] - seamAt(XS[tx], Q[k + 1])) < 1e-6) return true;
            if (ty != null && Math.abs(Q[k + 1] - seamAt(YS[ty], Q[k])) < 1e-6) return true;
          }
          return false;
        });
      }
      return ps;
    };
    // bandes d'une pièce le long d'un axe (n coutures, pièce k) : rainure (recv), corps (full), tenon
    var zones = function (n, k) {
      var z = [], last = k === n;
      if (k) z.push({ lo: { k: k - 1, d: 0 }, hi: { k: k - 1, d: ov }, role: 'recv' });
      z.push({ lo: k ? { k: k - 1, d: ov } : null, hi: last ? null : { k: k, d: 0 }, role: 'full' });
      if (!last) z.push({ lo: { k: k, d: 0 }, hi: { k: k, d: ov - g }, role: 'tenon' });
      return z;
    };
    var th = T / 2, out = [];
    seg.list.forEach(function (cell) {
      var i = cell.col, j = cell.row, parts = [];
      var add = function (ps, z0, z1, kind) {
        if (!ps.length || z1 - z0 < 1e-6) return;
        var mesh = extrude(ps, z0, z1, { v: [], t: [] });
        if (mesh.t.length) parts.push({ kind: kind, v: mesh.v, t: mesh.t });
      };
      var tx = i < nx ? i : null, ty = j < ny ? j : null;
      zones(nx, i).forEach(function (zx) {
        zones(ny, j).forEach(function (zy) {
          var a = zx.role, b = zy.role;
          if (a === 'full' && b === 'full') add(polys('full', zx, zy), 0, T, 'full');
          else if (a !== 'tenon' && b !== 'tenon') {
            // parois + peau au-dessus de la rainure
            add(polys('groove', zx, zy), th + g, T, 'skin');
            add(polys('walls', zx, zy), 0, T, 'wall');
          } else if (a !== 'recv' && b !== 'recv') add(polys('core', zx, zy, tx, ty), 0, th, 'tenon');
        });
      });
      out.push({ i: cell.i, col: i, row: j, name: cell.name, pose: multi ? 'dos' : 'face', parts: parts, back: [] });
    });
    // fond : derrière la pièce (z de −Tb à 0), coupé aux mêmes coutures que la façade (collé bout à bout)
    var Tb = 0;
    if (S.F && S.F.rings.length) {
      Tb = P.backT;
      var bRings = S.F.rings.map(flipY), bBig = 0, bA = 0;
      bRings.forEach(function (R) { var a = ringArea(R); if (Math.abs(a) > bA) { bA = Math.abs(a); bBig = a; } });
      sets.back = bBig < 0 ? bRings.map(reverseRing) : bRings;
      seg.list.forEach(function (cell, n) {
        var i = cell.col, j = cell.row;
        var ps = polys('back', { lo: i ? { k: i - 1, d: 0 } : null, hi: i < nx ? { k: i, d: 0 } : null },
          { lo: j ? { k: j - 1, d: 0 } : null, hi: j < ny ? { k: j, d: 0 } : null });
        if (!ps.length) return;
        var mesh = extrude(ps, -Tb, 0, { v: [], t: [] });
        if (mesh.t.length) out[n].back.push({ kind: 'back', v: mesh.v, t: mesh.t });
      });
    }
    return { segs: out, w: D.w, h: D.h, T: T, Tb: Tb, seg: seg };
  }

  // Aperçu 3D : triangles à plat (position + normale) dans un seul tableau.
  function preview3d(ctx, P0) {
    var P = norm(P0);
    P.draft = false;
    var B = buildParts(ctx, P);
    if (!B) return { ok: false };
    var total = 0, list = [];
    var all = function (s) { return s.back.length ? s.parts.concat(s.back) : s.parts; };
    B.segs.forEach(function (s) { all(s).forEach(function (p) { total += p.t.length; }); });
    var data = new Float32Array(total * 6), o = 0;
    B.segs.forEach(function (s) {
      all(s).forEach(function (p) {
        var v = p.v, t = p.t, first = o / 6;
        for (var k = 0; k < t.length; k += 3) {
          var a = t[k] * 3, bb = t[k + 1] * 3, c = t[k + 2] * 3;
          var ux = v[bb] - v[a], uy = v[bb + 1] - v[a + 1], uz = v[bb + 2] - v[a + 2];
          var wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
          var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= l; ny /= l; nz /= l;
          for (var e = 0; e < 3; e++) {
            var q = e === 0 ? a : e === 1 ? bb : c;
            data[o++] = v[q]; data[o++] = v[q + 1]; data[o++] = v[q + 2]; data[o++] = nx; data[o++] = ny; data[o++] = nz;
          }
        }
        list.push({ seg: s.i, col: s.col, row: s.row, kind: p.kind, first: first, count: o / 6 - first });
      });
    });
    return { ok: true, data: data, parts: list, w: B.w, h: B.h, T: B.T, Tb: B.Tb, cols: B.seg.cols, rows: B.seg.rows, segs: B.segs.length };
  }

  /* ------------------------------------------------------------------ */
  /*  Exports : 3MF (segments en position d'impression), SVG, DXF         */
  /* ------------------------------------------------------------------ */
  function num(v, d) { var s = (Math.round(v * d) / d).toString(); return s === '-0' ? '0' : s; }
  function xmlEsc(s) { return String(s).replace(/[<>&"']/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]; }); }

  function make3mf(B, title) {
    var ff = root.fflate;
    if (!ff) throw new Error('Module ZIP (fflate) non chargé.');
    var out = [], items = [], id = 0, T = B.T, x0 = 0;
    out.push('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="fr-CA" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
      ' <metadata name="Title">', xmlEsc(title), '</metadata>\n <metadata name="Application">Création Audio — Silhouettes</metadata>\n <resources>\n');
    // un objet par pièce (ses morceaux en composants) ; flip = retourné (180° autour de x) : z' = zf − z
    var emit = function (parts, name, flip, zf) {
      var mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
      parts.forEach(function (p) {
        for (var k = 0; k < p.v.length; k += 3) {
          var y = flip ? -p.v[k + 1] : p.v[k + 1];
          if (p.v[k] < mn[0]) mn[0] = p.v[k]; if (p.v[k] > mx[0]) mx[0] = p.v[k];
          if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
        }
      });
      var ids = [];
      parts.forEach(function (p) {
        id++; ids.push(id);
        var v = p.v, t = p.t, k, a = ['  <object id="', id, '" type="model"><mesh><vertices>'];
        for (k = 0; k < v.length; k += 3) {
          var X = v[k] - mn[0] + x0, Y = (flip ? -v[k + 1] : v[k + 1]) - mn[1], Z = flip ? zf - v[k + 2] : v[k + 2] + zf;
          a.push('<vertex x="', num(X, 1e4), '" y="', num(Y, 1e4), '" z="', num(Z, 1e4), '"/>');
        }
        a.push('</vertices><triangles>');
        for (k = 0; k < t.length; k += 3) a.push('<triangle v1="', t[k], '" v2="', t[k + 1], '" v3="', t[k + 2], '"/>');
        a.push('</triangles></mesh></object>\n');
        out.push(a.join(''));
      });
      id++;
      out.push('  <object id="', id, '" name="', xmlEsc(name), '" type="model"><components>');
      ids.forEach(function (k) { out.push('<component objectid="', k, '"/>'); });
      out.push('</components></object>\n');
      items.push('  <item objectid="' + id + '"/>\n');
      x0 += mx[0] - mn[0] + 10;
    };
    // pose d'impression : « face » = retourné, languettes au plateau ; « dos » = tel quel (z = 0 au plateau)
    B.segs.forEach(function (s) {
      if (s.parts.length) emit(s.parts, 'Pièce ' + s.name, s.pose === 'face', s.pose === 'face' ? T : 0);   // case vide : rien
    });
    // fonds : face visible au plateau (retournés : z de −Tb..0 -> 0..Tb)
    B.segs.forEach(function (s) { if (s.back.length) emit(s.back, 'Fond ' + s.name, true, 0); });
    out.push(' </resources>\n <build>\n', items.join(''), ' </build>\n</model>\n');
    var ct = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
    return ff.zipSync({
      '[Content_Types].xml': ff.strToU8(ct), '_rels/.rels': ff.strToU8(rels), '3D/3dmodel.model': ff.strToU8(out.join(''))
    }, { level: 6 });
  }

  // F = fond (ou null) : calque « fond » dessous, cadre élargi à sa boîte ; couleurs = filaments choisis
  function makeSvg(rings, w, h, title, F, P) {
    var path = function (rs) {
      var d = [];
      rs.forEach(function (R) {
        d.push('M', num(R[0], 1e3), ' ', num(R[1], 1e3));
        for (var k = 2; k < R.length; k += 2) d.push('L', num(R[k], 1e3), ' ', num(R[k + 1], 1e3));
        d.push('Z');
      });
      return d.join('');
    };
    var b = F && F.box ? [Math.min(0, F.box[0]), Math.min(0, F.box[1]), Math.max(w, F.box[2]), Math.max(h, F.box[3])] : [0, 0, w, h];
    var W = b[2] - b[0], H = b[3] - b[1];
    return '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + num(W, 1e3) + 'mm" height="' + num(H, 1e3) +
      'mm" viewBox="' + num(b[0], 1e3) + ' ' + num(b[1], 1e3) + ' ' + num(W, 1e3) + ' ' + num(H, 1e3) + '">\n<title>' + xmlEsc(title) + '</title>\n' +
      (F && F.box ? '<path id="fond" fill="' + P.colBack + '" fill-rule="evenodd" d="' + path(F.rings) + '"/>\n' : '') +
      '<path id="silhouette" fill="' + (F && F.box ? P.colPiece : '#000') + '" fill-rule="evenodd" d="' + path(rings) + '"/>\n</svg>\n';
  }

  // DXF R12 (POLYLINE fermées, mm, y vers le haut) : lu par LightBurn, Inkscape, Fusion… Fond sur le calque FOND.
  function makeDxf(rings, h, back) {
    var o = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES'];
    var poly = function (R, ly) {
      o.push('0', 'POLYLINE', '8', ly, '66', '1', '10', '0.0', '20', '0.0', '30', '0.0', '70', '1');
      for (var k = 0; k < R.length; k += 2) o.push('0', 'VERTEX', '8', ly, '10', num(R[k], 1e4), '20', num(h - R[k + 1], 1e4), '30', '0.0');
      o.push('0', 'SEQEND', '8', ly);
    };
    rings.forEach(function (R) { poly(R, '0'); });
    (back || []).forEach(function (R) { poly(R, 'FOND'); });
    o.push('0', 'ENDSEC', '0', 'EOF');
    return o.join('\r\n') + '\r\n';
  }

  function exportFile(ctx, P0, fmt, base) {
    var P = norm(P0);
    P.draft = false;
    var name = (base || 'silhouette') + '.' + fmt;
    if (fmt === '3mf') {
      var B = buildParts(ctx, P);
      if (!B) throw new Error('Rien à exporter.');
      return { name: name, mime: 'model/3mf', bytes: make3mf(B, base || 'Silhouette') };
    }
    var S = stages(ctx, P);
    if (!S) throw new Error('Rien à exporter.');
    if (fmt === 'svg') return { name: name, mime: 'image/svg+xml', text: makeSvg(S.E.rings, S.D.w, S.D.h, base || 'Silhouette', S.F, P) };
    if (fmt === 'dxf') return { name: name, mime: 'application/dxf', text: makeDxf(S.E.rings, S.D.h, S.F && S.F.rings) };
    throw new Error('Format inconnu : ' + fmt);
  }

  /* ------------------------------------------------------------------ */
  /*  earcut — triangulation de polygones avec trous                     */
  /*  Algorithme de Mapbox (github.com/mapbox/earcut, v2.2), réécrit ici. */
  /*  ISC License — Copyright (c) 2016, Mapbox. Permission to use, copy,  */
  /*  modify, and/or distribute this software for any purpose with or     */
  /*  without fee is hereby granted, provided that the above copyright    */
  /*  notice and this permission notice appear in all copies. THE         */
  /*  SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL           */
  /*  WARRANTIES WITH REGARD TO THIS SOFTWARE.                            */
  /* ------------------------------------------------------------------ */
  function earcut(data, holeIndices) {
    var dim = 2, hasHoles = holeIndices && holeIndices.length, outerLen = hasHoles ? holeIndices[0] * dim : data.length;
    var outerNode = linkedList(data, 0, outerLen, dim, true), triangles = [];
    if (!outerNode || outerNode.next === outerNode.prev) return triangles;
    var minX, minY, maxX, maxY, x, y, invSize;
    if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
    if (data.length > 80 * dim) {
      minX = maxX = data[0]; minY = maxY = data[1];
      for (var i = dim; i < outerLen; i += dim) {
        x = data[i]; y = data[i + 1];
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
      invSize = Math.max(maxX - minX, maxY - minY);
      invSize = invSize !== 0 ? 32767 / invSize : 0;
    }
    earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
    return triangles;
  }
  function linkedList(data, start, end, dim, clockwise) {
    var i, last;
    if (clockwise === (signedArea(data, start, end, dim) > 0)) {
      for (i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
    } else {
      for (i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
    }
    if (last && equals(last, last.next)) { removeNode(last); last = last.next; }
    return last;
  }
  function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;
    var p = start, again;
    do {
      again = false;
      if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
        removeNode(p);
        p = end = p.prev;
        if (p === p.next) break;
        again = true;
      } else p = p.next;
    } while (again || p !== end);
    return end;
  }
  function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
    if (!ear) return;
    if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
    var stop = ear, prev, next;
    while (ear.prev !== ear.next) {
      prev = ear.prev; next = ear.next;
      if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
        triangles.push(prev.i / dim | 0, ear.i / dim | 0, next.i / dim | 0);
        removeNode(ear);
        ear = next.next; stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!pass) earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
        else if (pass === 1) {
          ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
          earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
        } else if (pass === 2) splitEarcut(ear, triangles, dim, minX, minY, invSize);
        break;
      }
    }
  }
  function isEar(ear) {
    var a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    var ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
    var x0 = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx), y0 = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy);
    var x1 = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx), y1 = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);
    var p = c.next;
    while (p !== a) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) &&
          area(p.prev, p, p.next) >= 0) return false;
      p = p.next;
    }
    return true;
  }
  function isEarHashed(ear, minX, minY, invSize) {
    var a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    var ax = a.x, bx = b.x, cx = c.x, ay = a.y, by = b.y, cy = c.y;
    var x0 = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx), y0 = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy);
    var x1 = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx), y1 = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy);
    var minZ = zOrder(x0, y0, minX, minY, invSize), maxZ = zOrder(x1, y1, minX, minY, invSize);
    var p = ear.prevZ, n = ear.nextZ;
    while (p && p.z >= minZ && n && n.z <= maxZ) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
          pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
      p = p.prevZ;
      if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
          pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
      n = n.nextZ;
    }
    while (p && p.z >= minZ) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c &&
          pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
      p = p.prevZ;
    }
    while (n && n.z <= maxZ) {
      if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c &&
          pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
      n = n.nextZ;
    }
    return true;
  }
  function cureLocalIntersections(start, triangles, dim) {
    var p = start;
    do {
      var a = p.prev, b = p.next.next;
      if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
        triangles.push(a.i / dim | 0, p.i / dim | 0, b.i / dim | 0);
        removeNode(p); removeNode(p.next);
        p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return filterPoints(p);
  }
  function splitEarcut(start, triangles, dim, minX, minY, invSize) {
    var a = start;
    do {
      var b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && isValidDiagonal(a, b)) {
          var c = splitPolygon(a, b);
          a = filterPoints(a, a.next);
          c = filterPoints(c, c.next);
          earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
          earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
          return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }
  function eliminateHoles(data, holeIndices, outerNode, dim) {
    var queue = [], i, len, start, end, list;
    for (i = 0, len = holeIndices.length; i < len; i++) {
      start = holeIndices[i] * dim;
      end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
      list = linkedList(data, start, end, dim, false);
      if (!list) continue;
      if (list === list.next) list.steiner = true;
      queue.push(getLeftmost(list));
    }
    queue.sort(function (a, b) { return a.x - b.x; });
    for (i = 0; i < queue.length; i++) outerNode = eliminateHole(queue[i], outerNode);
    return outerNode;
  }
  function eliminateHole(hole, outerNode) {
    var bridge = findHoleBridge(hole, outerNode);
    if (!bridge) return outerNode;
    var bridgeReverse = splitPolygon(bridge, hole);
    filterPoints(bridgeReverse, bridgeReverse.next);
    return filterPoints(bridge, bridge.next);
  }
  function findHoleBridge(hole, outerNode) {
    var p = outerNode, hx = hole.x, hy = hole.y, qx = -Infinity, m;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
        if (x <= hx && x > qx) {
          qx = x;
          m = p.x < p.next.x ? p : p.next;
          if (x === hx) return m;
        }
      }
      p = p.next;
    } while (p !== outerNode);
    if (!m) return null;
    var stop = m, mx = m.x, my = m.y, tanMin = Infinity, tan;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x &&
          pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        tan = Math.abs(hy - p.y) / (hx - p.x);
        if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
          m = p; tanMin = tan;
        }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function sectorContainsSector(m, p) { return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0; }
  function indexCurve(start, minX, minY, invSize) {
    var p = start;
    do {
      if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
      p.prevZ = p.prev; p.nextZ = p.next;
      p = p.next;
    } while (p !== start);
    p.prevZ.nextZ = null;
    p.prevZ = null;
    sortLinked(p);
  }
  function sortLinked(list) {
    var i, p, q, e, tail, numMerges, pSize, qSize, inSize = 1;
    do {
      p = list; list = null; tail = null; numMerges = 0;
      while (p) {
        numMerges++;
        q = p; pSize = 0;
        for (i = 0; i < inSize; i++) { pSize++; q = q.nextZ; if (!q) break; }
        qSize = inSize;
        while (pSize > 0 || (qSize > 0 && q)) {
          if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) { e = p; p = p.nextZ; pSize--; }
          else { e = q; q = q.nextZ; qSize--; }
          if (tail) tail.nextZ = e; else list = e;
          e.prevZ = tail;
          tail = e;
        }
        p = q;
      }
      tail.nextZ = null;
      inSize *= 2;
    } while (numMerges > 1);
    return list;
  }
  function zOrder(x, y, minX, minY, invSize) {
    x = (x - minX) * invSize | 0;
    y = (y - minY) * invSize | 0;
    x = (x | (x << 8)) & 0x00FF00FF; x = (x | (x << 4)) & 0x0F0F0F0F; x = (x | (x << 2)) & 0x33333333; x = (x | (x << 1)) & 0x55555555;
    y = (y | (y << 8)) & 0x00FF00FF; y = (y | (y << 4)) & 0x0F0F0F0F; y = (y | (y << 2)) & 0x33333333; y = (y | (y << 1)) & 0x55555555;
    return x | (y << 1);
  }
  function getLeftmost(start) {
    var p = start, leftmost = start;
    do {
      if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
      p = p.next;
    } while (p !== start);
    return leftmost;
  }
  function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
           (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  function isValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
      (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (area(a.prev, a, b.prev) || area(a, b.prev, b)) ||
       equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0);
  }
  function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function equals(p1, p2) { return p1.x === p2.x && p1.y === p2.y; }
  function intersects(p1, q1, p2, q2) {
    var o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2)), o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;
    return false;
  }
  function onSegment(p, q, r) {
    return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
  }
  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  function intersectsPolygon(a, b) {
    var p = a;
    do {
      if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
      p = p.next;
    } while (p !== a);
    return false;
  }
  function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
  }
  function middleInside(a, b) {
    var p = a, inside = false, px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
    do {
      if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) inside = !inside;
      p = p.next;
    } while (p !== a);
    return inside;
  }
  function splitPolygon(a, b) {
    var a2 = new ENode(a.i, a.x, a.y), b2 = new ENode(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a;
    a2.next = an; an.prev = a2;
    b2.next = a2; a2.prev = b2;
    bp.next = b2; b2.prev = bp;
    return b2;
  }
  function insertNode(i, x, y, last) {
    var p = new ENode(i, x, y);
    if (!last) { p.prev = p; p.next = p; }
    else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function removeNode(p) {
    p.next.prev = p.prev;
    p.prev.next = p.next;
    if (p.prevZ) p.prevZ.nextZ = p.nextZ;
    if (p.nextZ) p.nextZ.prevZ = p.prevZ;
  }
  function ENode(i, x, y) {
    this.i = i; this.x = x; this.y = y;
    this.prev = null; this.next = null;
    this.z = 0; this.prevZ = null; this.nextZ = null;
    this.steiner = false;
  }
  function signedArea(data, start, end, dim) {
    var sum = 0;
    for (var i = start, j = end - dim; i < end; i += dim) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; }
    return sum;
  }

  root.SilEngine = {
    version: 1, BEDS: BEDS, DEF: DEF,
    grayFromRGBA: grayFromRGBA, otsu: otsu, context: context,
    compute: compute, preview3d: preview3d, exportFile: exportFile, spline: spline,
    // exposés pour les tests
    _: { edt: edt, label: label, contours: contours, cutS: cutS, seamAt: seamAt, nest: nest, earcut: earcut, ringArea: ringArea, extrude: extrude }
  };
})(typeof self !== 'undefined' ? self : this);
