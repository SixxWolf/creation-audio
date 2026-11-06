/* =========================================================
   Création Audio — lecture d'un 3MF ou d'un G-code dans un Worker (aperçu 3D : page Impression 3D, Messagerie, admin).
   Rien ne quitte le navigateur : le fichier est lu ici, pour l'aperçu seulement.
   - 3MF = ZIP + XML. Le XML est décompressé et lu par morceaux, sans jamais tenir en mémoire d'un bloc.
   - Plateaux, instances, couleur de chaque pièce : Metadata/model_settings.config et project_settings.config
     (Bambu Studio et Orca). Un 3MF ordinaire donne un seul plateau.
   - Déjà tranché : temps et poids réels dans slice_info.config ; le G-code (Metadata/plate_N.gcode, ou un .gcode brut
     d'Orca, Prusa, Cura) est lu au moment d'afficher le plateau et donne les trajets d'extrusion.
   - Téléphone : au-delà du budget par plateau, version allégée (sommets regroupés ; trajets sans le remplissage).
   Messages reçus : {t:'open', file, budget, maxTris, maxPts, paths}, {t:'plate', i, req}, {t:'capv', req}
   Messages envoyés : {t:'progress', p}, {t:'meta', …}, {t:'plate', req, pos, groups, rect | paths}, {t:'capv', req, blob}, {t:'fail'}
   ========================================================= */
'use strict';

var doc = null;            // { plates, colors, kinds, W, H, ax, ay, file, zip }
var totalTris = 0, totalVerts = 0, limitTris = 3e7, limitPts = 8e6, wantPaths = true, lastReq = 0;
var jobs = Promise.resolve();

self.onmessage = function (e) {
  var m = e.data;
  if (m.t === 'open') {
    limitPts = m.maxPts || 8e6;
    wantPaths = m.paths !== false;
    var open = /\.gcode$/i.test(m.file.name) ? openGcode(m.file) : openFile(m.file, m.budget || 8e6, m.maxTris || 3e7);
    open.catch(function (err) {
      self.postMessage({ t: 'fail', why: String(err && err.message || err) });
    });
  } else if (m.t === 'plate' && doc) {
    lastReq = m.req;
    jobs = jobs.then(function () { return sendPlate(m.i, m.req); }).catch(function () {
      self.postMessage({ t: 'plate', req: m.req, i: m.i, pos: null });
    });
  } else if (m.t === 'capv' && doc) {
    jobs = jobs.then(function () { return sendCapv(m.req); }).catch(function () {
      self.postMessage({ t: 'capv', req: m.req, blob: null });
    });
  }
};

/* ---------- ZIP ---------- */
function u16(d, o) { return d[o] | d[o + 1] << 8; }
function u32(d, o) { return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) + d[o + 3] * 16777216; }
function u64(d, o) { return u32(d, o) + u32(d, o + 4) * 4294967296; }
function isSig(d, o, a, b) { return d[o] === 80 && d[o + 1] === 75 && d[o + 2] === a && d[o + 3] === b; }
function readRange(file, a, b) { return file.slice(a, b).arrayBuffer().then(function (x) { return new Uint8Array(x); }); }

async function zipList(file) {
  var tail = Math.min(file.size, 66000), t = await readRange(file, file.size - tail, file.size), i = t.length - 22;
  while (i >= 0 && !isSig(t, i, 5, 6)) i--;
  if (i < 0) throw new Error('pas un zip');
  var n = u16(t, i + 10), cdSize = u32(t, i + 12), cdOff = u32(t, i + 16);
  if (n === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    if (i < 20 || !isSig(t, i - 20, 6, 7)) throw new Error('zip64');
    var at = u64(t, i - 12), z = await readRange(file, at, at + 56);
    n = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48);
  }
  var cd = await readRange(file, cdOff, cdOff + cdSize), o = 0, out = {}, dec = new TextDecoder();
  for (var k = 0; k < n && o + 46 <= cd.length && isSig(cd, o, 1, 2); k++) {
    var nl = u16(cd, o + 28), el = u16(cd, o + 30), cl = u16(cd, o + 32);
    var e = { m: u16(cd, o + 10), cs: u32(cd, o + 20), us: u32(cd, o + 24), lo: u32(cd, o + 42) };
    if (e.us === 0xffffffff || e.cs === 0xffffffff || e.lo === 0xffffffff) {
      for (var x = o + 46 + nl, xe = x + el; x + 4 <= xe; x += 4 + u16(cd, x + 2)) {
        if (u16(cd, x) !== 1) continue;
        var y = x + 4;
        if (e.us === 0xffffffff) { e.us = u64(cd, y); y += 8; }
        if (e.cs === 0xffffffff) { e.cs = u64(cd, y); y += 8; }
        if (e.lo === 0xffffffff) e.lo = u64(cd, y);
      }
    }
    out[dec.decode(cd.subarray(o + 46, o + 46 + nl)).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()] = e;
    o += 46 + nl + el + cl;
  }
  return out;
}
async function entryStream(file, e) {
  var h = await readRange(file, e.lo, e.lo + 30);
  if (!isSig(h, 0, 3, 4)) throw new Error('entrée zip');
  var start = e.lo + 30 + u16(h, 26) + u16(h, 28), s = file.slice(start, start + e.cs).stream();
  if (e.m === 0) return s;
  if (e.m !== 8) throw new Error('compression');
  return s.pipeThrough(new DecompressionStream('deflate-raw'));
}
async function entryBytes(file, e) {
  var reader = (await entryStream(file, e)).getReader(), parts = [], size = 0, r;
  for (;;) {
    r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 64 * 1048576) { reader.cancel(); throw new Error('entrée trop lourde'); }
    parts.push(r.value);
  }
  var out = new Uint8Array(size), at = 0;
  parts.forEach(function (p) { out.set(p, at); at += p.length; });
  return out;
}
async function entryText(file, e) { return new TextDecoder().decode(await entryBytes(file, e)); }

/* ---------- lecture du XML, octet par octet ---------- */
function Obj(key, id) {
  this.key = key; this.id = id;
  this.V = new Float32Array(3 * 1024); this.nv = 0;
  this.T = new Uint32Array(3 * 2048); this.nt = 0;
  this.S = null;       // état peint par triangle : 0 = couleur de la pièce, n = filament n
  this.comps = [];
  this.pid = null; this.pindex = 0;
  this.vol = -1; this.area = 0;
}
function pushV(o, x, y, z) {
  var at = o.nv * 3;
  if (at + 3 > o.V.length) { var v = new Float32Array(o.V.length * 2); v.set(o.V); o.V = v; }
  o.V[at] = x; o.V[at + 1] = y; o.V[at + 2] = z;
  return o.nv++;
}
function pushT(o, a, b, c, s) {
  var at = o.nt * 3;
  if (at + 3 > o.T.length) {
    var t = new Uint32Array(o.T.length * 2); t.set(o.T); o.T = t;
    if (o.S) { var u = new Uint8Array(o.T.length / 3); u.set(o.S); o.S = u; }
  }
  o.T[at] = a; o.T[at + 1] = b; o.T[at + 2] = c;
  if (s) {
    if (!o.S) o.S = new Uint8Array(o.T.length / 3);
    o.S[o.nt] = s;
  }
  o.nt++; totalTris++;
}
function mid(o, a, b) {
  var V = o.V, i = a * 3, j = b * 3;
  return pushV(o, (V[i] + V[j]) / 2, (V[i + 1] + V[j + 1]) / 2, (V[i + 2] + V[j + 2]) / 2);
}

/* Peinture au pinceau (paint_color, mmu_segmentation) : une chaîne hexadécimale lue de la fin vers le début.
   Chaque triangle : 2 bits = côtés divisés ; feuille = n° du filament ; sinon, ses enfants en ordre inverse. */
var pd = null, pp = 0, pa = 0;
function nib() {
  if (pp <= pa) return 0;
  var c = pd[--pp];
  return c <= 57 ? c - 48 : c >= 97 ? c - 87 : c - 55;
}
function paintTri(o, a, b, c) {
  var code = nib(), sides = code & 3;
  if (!sides) { pushT(o, a, b, c, (code & 12) === 12 ? nib() + 3 : code >> 2); return; }
  var sp = code >> 2, p0 = a, p1 = b, p2 = c;
  if (sp === 1) { p0 = b; p1 = c; p2 = a; } else if (sp === 2) { p0 = c; p1 = a; p2 = b; }
  var m01, m12, m20;
  if (sides === 1) {
    m12 = mid(o, p1, p2);
    paintTri(o, m12, p2, p0);
    paintTri(o, p0, p1, m12);
  } else if (sides === 2) {
    m01 = mid(o, p0, p1); m20 = mid(o, p2, p0);
    paintTri(o, p1, p2, m20);
    paintTri(o, m01, p1, m20);
    paintTri(o, p0, m01, m20);
  } else {
    m01 = mid(o, p0, p1); m12 = mid(o, p1, p2); m20 = mid(o, p2, p0);
    paintTri(o, m01, m12, m20);
    paintTri(o, m12, p2, m20);
    paintTri(o, m01, p1, m12);
    paintTri(o, p0, m01, m20);
  }
}

var fp = 0;
function flt(d, q) {
  var c = d[q], neg = false, v = 0;
  if (c === 45) { neg = true; c = d[++q]; } else if (c === 43) c = d[++q];
  while (c >= 48 && c <= 57) { v = v * 10 + c - 48; c = d[++q]; }
  if (c === 46) {
    var f = 0, s = 1;
    c = d[++q];
    while (c >= 48 && c <= 57) { if (s < 1e15) { f = f * 10 + c - 48; s *= 10; } c = d[++q]; }
    v += f / s;
  }
  if (c === 101 || c === 69) {
    c = d[++q];
    var en = false, x = 0;
    if (c === 45) { en = true; c = d[++q]; } else if (c === 43) c = d[++q];
    while (c >= 48 && c <= 57) { x = x * 10 + c - 48; c = d[++q]; }
    v *= Math.pow(10, en ? -x : x);
  }
  fp = q;
  return neg ? -v : v;
}
function attrs(d, i, gt) {
  var s = '';
  for (var k = i; k < gt; k += 4096) s += String.fromCharCode.apply(null, d.subarray(k, Math.min(gt, k + 4096)));
  return s;
}
function attr(s, name) {
  var m = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*["\']([^"\']*)').exec(s);
  return m ? m[1] : null;
}
var IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function matrix(s) {
  if (!s) return IDENT;
  var p = s.trim().split(/\s+/).map(Number);
  return p.length === 12 && p.every(isFinite) ? p : IDENT;
}

function scanner(path, st) {
  var cur = null, mats = null;
  function vertex(d, p, gt) {
    if (!cur) return;
    var x = 0, y = 0, z = 0;
    while (p < gt) {
      if (d[p] !== 61) { p++; continue; }
      var k = d[p - 1], q = p + 1;
      while (d[q] !== 34 && d[q] !== 39 && q < gt) q++;
      var v = flt(d, q + 1);
      if (k === 120) x = v; else if (k === 121) y = v; else if (k === 122) z = v;
      p = fp + 1;
    }
    pushV(cur, x, y, z);
    if (++totalVerts > limitTris) throw new Error('LIMITE');
  }
  function triangle(d, p, gt) {
    if (!cur) return;
    var a = -1, b = -1, c = -1, pa0 = -1, pa1 = -1, pid = null, p1 = 0;
    while (p < gt) {
      if (d[p] !== 61) { p++; continue; }
      var k = d[p - 1], j = d[p - 2], q = p + 1;
      while (d[q] !== 34 && d[q] !== 39 && q < gt) q++;
      q++;
      if (j === 118 && k >= 49 && k <= 51) {
        var v = 0, ch = d[q];
        while (ch >= 48 && ch <= 57) { v = v * 10 + ch - 48; ch = d[++q]; }
        if (k === 49) a = v; else if (k === 50) b = v; else c = v;
      } else if ((k === 114 && d[p - 5] === 99 && d[p - 2] === 111) || (k === 110 && j === 111 && d[p - 3] === 105)) {
        pa0 = q;      // paint_color, mmu_segmentation
        while (d[q] !== 34 && d[q] !== 39 && q < gt) q++;
        pa1 = q;
      } else if (k === 100 && j === 105 && d[p - 3] === 112) {
        pid = flt(d, q); q = fp;
      } else if (k === 49 && j === 112) {
        p1 = flt(d, q); q = fp;
      }
      while (d[q] !== 34 && d[q] !== 39 && q < gt) q++;
      p = q + 1;
    }
    if (a < 0 || b < 0 || c < 0 || a >= cur.nv || b >= cur.nv || c >= cur.nv) return;
    if (pid != null && cur.pid == null) { cur.pid = pid; cur.pindex = p1; }
    if (pa0 >= 0 && pa1 > pa0) { pd = d; pp = pa1; pa = pa0; paintTri(cur, a, b, c); } else pushT(cur, a, b, c, 0);
    if (totalTris > limitTris) throw new Error('LIMITE');
  }
  return function scan(d) {
    var i = 0, n = d.length, gt, c, s;
    for (;;) {
      i = d.indexOf(60, i);
      if (i < 0) return n;
      gt = d.indexOf(62, i + 1);
      if (gt < 0) return i;
      c = d[i + 1];
      if (c === 118) {
        if (d[i + 6] === 120) vertex(d, i + 7, gt);
      } else if (c === 116) {
        if (d[i + 8] === 101 && d[i + 9] !== 115) triangle(d, i + 9, gt);
      } else if (c === 47) {
        if (d[i + 2] === 111 && d[i + 3] === 98 && cur) {      // </object> : on rend la mémoire en trop
          cur.V = cur.V.slice(0, cur.nv * 3);
          cur.T = cur.T.slice(0, cur.nt * 3);
          if (cur.S) cur.S = cur.S.slice(0, cur.nt);
          cur = null;
        }
      } else if (c === 111) {
        if (d[i + 2] === 98) {                                 // <object
          s = attrs(d, i, gt);
          var id = attr(s, 'id');
          cur = new Obj(path + '#' + id, id);
          var pid = attr(s, 'pid');
          if (pid != null) { cur.pid = +pid; cur.pindex = +(attr(s, 'pindex') || 0); }
          st.objs[cur.key] = cur;
        }
      } else if (c === 99) {
        if (d[i + 2] === 111 && d[i + 3] === 109 && d[i + 10] !== 115 && cur) {   // <component, pas <components>
          s = attrs(d, i, gt);
          var ref = attr(s, '(?:\\w+:)?path') || path;
          if (ref.charAt(0) !== '/') ref = '/' + ref;
          ref = ref.toLowerCase();
          cur.comps.push({ key: ref + '#' + attr(s, 'objectid'), id: attr(s, 'objectid'), T: matrix(attr(s, 'transform')) });
          if (st.seen[ref] == null) { st.seen[ref] = 0; st.queue.push(ref); }
        } else if (d[i + 2] === 111 && d[i + 3] === 108) {     // <colorgroup, <color
          s = attrs(d, i, gt);
          if (/^<colorgroup/.test(s)) { mats = st.mats[path + '#' + attr(s, 'id')] = []; } else if (mats) mats.push(attr(s, 'color'));
        }
      } else if (c === 109) {
        if (d[i + 2] === 58 && d[i + 3] === 99) {              // <m:colorgroup, <m:color
          s = attrs(d, i, gt);
          if (/^<m:colorgroup/.test(s)) { mats = st.mats[path + '#' + attr(s, 'id')] = []; } else if (mats) mats.push(attr(s, 'color'));
        } else if (d[i + 2] === 111 && d[i + 3] === 100 && st.unit == null) {     // <model
          st.unit = attr(attrs(d, i, gt), 'unit') || 'millimeter';
        }
      } else if (c === 105) {
        if (d[i + 2] === 116 && d[i + 3] === 101 && d[i + 4] === 109) {           // <item
          s = attrs(d, i, gt);
          st.items.push({ key: path + '#' + attr(s, 'objectid'), id: attr(s, 'objectid'), T: matrix(attr(s, 'transform')), printable: attr(s, 'printable') !== '0' });
        }
      } else if (c === 98) {
        if (d[i + 2] === 97 && d[i + 3] === 115 && d[i + 4] === 101) {            // <basematerials, <base
          s = attrs(d, i, gt);
          if (d[i + 5] === 109) mats = st.mats[path + '#' + attr(s, 'id')] = [];
          else if (mats) mats.push(attr(s, 'displaycolor'));
        }
      }
      i = gt + 1;
    }
  };
}

async function parseModel(file, entry, path, st, tick) {
  var reader = (await entryStream(file, entry)).getReader(), scan = scanner(path, st), carry = null, r, d, end;
  try {
    for (;;) {
      r = await reader.read();
      if (r.done) break;
      d = r.value;
      tick(d.length);
      if (carry) {
        var j = new Uint8Array(carry.length + d.length);
        j.set(carry); j.set(d, carry.length);
        d = j;
      }
      end = scan(d);
      carry = end < d.length ? d.slice(end) : null;
      if (carry && carry.length > 64 * 1048576) throw new Error('balise trop longue');
    }
  } catch (err) {
    try { reader.cancel(); } catch (e2) { /* déjà fermé */ }
    throw err;
  }
}

/* ---------- réglages du projet ---------- */
function meta(s, key) {
  var m = new RegExp('key="' + key + '"\\s+value="([^"]*)"').exec(s);
  return m ? m[1] : null;
}
function parseConfig(s) {
  var objects = {}, plates = [], m;
  var reO = /<object\s+id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g;
  while ((m = reO.exec(s))) {
    var parts = {}, rest = m[2], p;
    var reP = /<part\s+([^>]*)>([\s\S]*?)<\/part>/g;
    while ((p = reP.exec(m[2]))) {
      var pid = attr(p[1], 'id');
      if (pid != null) parts[pid] = { sub: attr(p[1], 'subtype'), ext: +(meta(p[2], 'extruder') || 0) };
    }
    rest = rest.replace(reP, '');
    objects[m[1]] = { ext: +(meta(rest, 'extruder') || 0), parts: parts };
  }
  var reL = /<plate>([\s\S]*?)<\/plate>/g;
  while ((m = reL.exec(s))) {
    var insts = [], i, reI = /<model_instance>([\s\S]*?)<\/model_instance>/g;
    while ((i = reI.exec(m[1]))) insts.push({ obj: meta(i[1], 'object_id'), inst: +(meta(i[1], 'instance_id') || 0) });
    plates.push({ id: +(meta(m[1], 'plater_id') || plates.length + 1), insts: insts });
  }
  return { objects: objects, plates: plates };
}
function parseSlice(s) {
  var out = {}, m, re = /<plate>([\s\S]*?)<\/plate>/g;
  while ((m = re.exec(s))) {
    var id = +(meta(m[1], 'index') || 0);
    if (id) out[id] = { time: +(meta(m[1], 'prediction') || 0), weight: +(meta(m[1], 'weight') || 0) };
  }
  return out;
}
var UNITS = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

/* ---------- géométrie ---------- */
function compose(a, b) {         // a puis b (convention 3MF : vecteur-ligne)
  var r = new Array(12);
  for (var c = 0; c < 3; c++) {
    r[c] = a[0] * b[c] + a[1] * b[3 + c] + a[2] * b[6 + c];
    r[3 + c] = a[3] * b[c] + a[4] * b[3 + c] + a[5] * b[6 + c];
    r[6 + c] = a[6] * b[c] + a[7] * b[3 + c] + a[8] * b[6 + c];
    r[9 + c] = a[9] * b[c] + a[10] * b[3 + c] + a[11] * b[6 + c] + b[9 + c];
  }
  return r;
}
function det3(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}
function metrics(o) {
  if (o.vol >= 0) return;
  var V = o.V, T = o.T, vol = 0, area = 0;
  for (var i = 0, n = o.nt * 3; i < n; i += 3) {
    var a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
    var ax = V[a], ay = V[a + 1], az = V[a + 2], bx = V[b], by = V[b + 1], bz = V[b + 2], cx = V[c], cy = V[c + 1], cz = V[c + 2];
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    var ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
  }
  o.vol = Math.abs(vol) / 6;
  o.area = area;
}
function matColor(st, o) {
  if (o.pid == null) return null;
  var list = st.mats[o.key.split('#')[0] + '#' + o.pid], c = list && list[o.pindex || 0];
  return c && /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7).toUpperCase() : null;
}
/* Une instance posée sur un plateau → la liste des maillages, avec leur matrice finale et leur filament. */
function flatten(st, item, out) {
  var main = st.objs[item.key];
  if (!main) return;
  var cfg = st.cfg && st.cfg.objects[item.id], scale = st.scale;
  function emit(o, M, ext) {
    var c = ext && st.colors[ext - 1] ? st.colors[ext - 1] : matColor(st, o);
    out.push({ o: o, M: scale === 1 ? M : M.map(function (v) { return v * scale; }), def: c });
  }
  function walk(o, M, ext, depth) {
    if (o.nt) emit(o, M, ext);
    if (depth > 8) return;
    o.comps.forEach(function (c) {
      var k = st.objs[c.key];
      if (k) walk(k, compose(c.T, M), ext, depth + 1);
    });
  }
  var top = cfg ? cfg.ext || 1 : 0;
  if (main.nt) emit(main, item.T, top);
  main.comps.forEach(function (c) {
    var part = cfg && cfg.parts[c.id];
    if (part && part.sub && part.sub !== 'normal_part') return;      // modificateurs, bloqueurs : pas imprimés
    var k = st.objs[c.key];
    if (k) walk(k, compose(c.T, item.T), cfg ? (part && part.ext) || top : 0, 1);
  });
}
function plateStats(p) {
  var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, vol = 0, area = 0, tris = 0;
  p.meshes.forEach(function (g) {
    var o = g.o, M = g.M, V = o.V;
    metrics(o);
    var s = Math.abs(det3(M));
    vol += o.vol * s; area += o.area * Math.pow(s, 2 / 3); tris += o.nt;
    for (var i = 0, n = o.nv * 3; i < n; i += 3) {
      var a = V[i], b = V[i + 1], c = V[i + 2];
      var x = a * M[0] + b * M[3] + c * M[6] + M[9], y = a * M[1] + b * M[4] + c * M[7] + M[10], z = a * M[2] + b * M[5] + c * M[8] + M[11];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  });
  if (!isFinite(minX + maxX + minY + maxY + minZ + maxZ) || Math.max(maxX - minX, maxY - minY, maxZ - minZ) > 1e5) { p.meshes = []; p.tris = 0; return; }
  p.box = [minX, minY, minZ, maxX, maxY, maxZ];
  p.size = [maxX - minX, maxY - minY, maxZ - minZ];
  p.volume = vol; p.area = area; p.tris = tris;
}

/* Version allégée : les sommets d'une même case se fondent en un ; la forme reste, les fins détails s'adoucissent. */
function cluster(o, cell) {
  var V = o.V, nv = o.nv, cap = 1024;
  while (cap < nv * 2) cap *= 2;
  var table = new Int32Array(cap), mask = cap - 1, keys = new Int32Array(nv * 3), sum = new Float64Array(nv * 3), cnt = new Uint32Array(nv), map = new Uint32Array(nv), nc = 0;
  for (var i = 0; i < nv; i++) {
    var x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
    var ix = Math.floor(x / cell), iy = Math.floor(y / cell), iz = Math.floor(z / cell);
    var h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask, c;
    for (;;) {
      c = table[h] - 1;
      if (c < 0) {
        c = nc++;
        table[h] = c + 1;
        keys[c * 3] = ix; keys[c * 3 + 1] = iy; keys[c * 3 + 2] = iz;
        break;
      }
      if (keys[c * 3] === ix && keys[c * 3 + 1] === iy && keys[c * 3 + 2] === iz) break;
      h = (h + 1) & mask;
    }
    sum[c * 3] += x; sum[c * 3 + 1] += y; sum[c * 3 + 2] += z; cnt[c]++;
    map[i] = c;
  }
  var T = new Uint32Array(o.nt * 3), S = o.S ? new Uint8Array(o.nt) : null, nt = 0;
  for (var t = 0, n = o.nt * 3; t < n; t += 3) {
    var a = map[o.T[t]], b = map[o.T[t + 1]], d = map[o.T[t + 2]];
    if (a === b || b === d || a === d) continue;
    T[nt * 3] = a; T[nt * 3 + 1] = b; T[nt * 3 + 2] = d;
    if (S) S[nt] = o.S[t / 3];
    nt++;
  }
  return { nc: nc, sum: sum, cnt: cnt, T: T, S: S, nt: nt };
}
function simplify(o, ratio) {
  var target = Math.max(800, o.nt * ratio);
  if (o.nt <= target * 1.1) return;
  metrics(o);
  var cell = Math.sqrt(2 * Math.max(o.area, 1e-3) / target), r = null;
  for (var k = 0; k < 6; k++) {
    r = cluster(o, cell);
    if (r.nt <= target * 1.25) break;
    cell *= Math.max(1.15, Math.sqrt(r.nt / target));
  }
  var V = new Float32Array(r.nc * 3);
  for (var i = 0; i < r.nc; i++) {
    V[i * 3] = r.sum[i * 3] / r.cnt[i]; V[i * 3 + 1] = r.sum[i * 3 + 1] / r.cnt[i]; V[i * 3 + 2] = r.sum[i * 3 + 2] / r.cnt[i];
  }
  o.V = V; o.nv = r.nc;
  o.T = r.T.slice(0, r.nt * 3); o.nt = r.nt;
  o.S = r.S ? r.S.slice(0, r.nt) : null;
}

/* ---------- un plateau → tampon de dessin ---------- */
function rgb(hex) {
  return [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16) / 255; });
}
async function sendPlate(i, req) {
  if (req !== lastReq) return;                       // un autre plateau a été demandé entre-temps
  var p = doc.plates[i];
  if (p && p.gcode && wantPaths && await sendPaths(p, i, req)) return;
  if (!p || !p.meshes.length) { self.postMessage({ t: 'plate', req: req, i: i, pos: null }); return; }
  var colors = doc.colors, slots = {}, order = [], counts = [];
  function slotOf(hex) {
    var k = hex || '';
    if (slots[k] == null) { slots[k] = order.length; order.push(hex || null); counts.push(0); }
    return slots[k];
  }
  // 1re passe : combien de triangles par couleur
  p.meshes.forEach(function (g) {
    var o = g.o, d = slotOf(g.def);
    if (!o.S) { counts[d] += o.nt; return; }
    for (var t = 0; t < o.nt; t++) {
      var s = o.S[t];
      counts[s && colors[s - 1] ? slotOf(colors[s - 1]) : d]++;
    }
  });
  var total = counts.reduce(function (a, b) { return a + b; }, 0), pos = new Float32Array(total * 9), at = [], acc = 0;
  counts.forEach(function (n) { at.push(acc); acc += n * 9; });
  var groups = order.map(function (hex, k) { return { c: hex ? rgb(hex) : null, first: at[k] / 3, count: counts[k] * 3 }; });

  // 2e passe : on écrit, centré et posé à z = 0
  var b = p.box, cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, z0 = b[2];
  p.meshes.forEach(function (g) {
    var o = g.o, M = g.M, V = o.V, T = o.T, d = slotOf(g.def), flip = det3(M) < 0;
    var m0 = M[0], m1 = M[1], m2 = M[2], m3 = M[3], m4 = M[4], m5 = M[5], m6 = M[6], m7 = M[7], m8 = M[8], tx = M[9] - cx, ty = M[10] - cy, tz = M[11] - z0;
    for (var t = 0; t < o.nt; t++) {
      var s = o.S ? o.S[t] : 0, k = s && colors[s - 1] ? slotOf(colors[s - 1]) : d, w = at[k];
      at[k] = w + 9;
      for (var j = 0; j < 3; j++) {
        var q = T[t * 3 + (flip && j ? 3 - j : j)] * 3, x = V[q], y = V[q + 1], z = V[q + 2], e = w + j * 3;
        pos[e] = x * m0 + y * m3 + z * m6 + tx;
        pos[e + 1] = x * m1 + y * m4 + z * m7 + ty;
        pos[e + 2] = x * m2 + y * m5 + z * m8 + tz;
      }
    }
  });
  var hw = doc.W / 2, hh = doc.H / 2, rx = p.ox + hw, ry = p.oy + hh;
  // pièces hors du plateau prévu (fichier ordinaire, plateau inconnu) : le plateau se centre sous elles
  if (Math.abs(cx - rx) > hw || Math.abs(cy - ry) > hh) { rx = cx; ry = cy; }
  self.postMessage({ t: 'plate', req: req, i: i, pos: pos, groups: groups, rect: [rx - cx, ry - cy, hw, hh] }, [pos.buffer]);
}

/* ---------- G-code : les trajets d'extrusion, 8 octets par point ----------
   x, y, z en Int16 (0,02 mm) + 16 bits : 0x8000 = début de trajet | type << 10 | outil << 6 | largeur en 0,025 mm.
   Un segment relie un point au suivant, sauf si le suivant commence un trajet.
   Types = ceux de Bambu Studio, mêmes numéros que TYPES dans apercu-3d.js :
   0 mur intérieur, 1 mur extérieur, 2 surplomb, 3 remplissage, 4 solide interne, 5 coque flottante, 6 surface supérieure, 7 surface inférieure,
   8 lissage, 9 pont, 10 remplissage d'espace, 11 support, 12 interface, 13 transition, 14 lissage de support, 15 tour de purge, 16 jupe, 17 bordure, 18 autre.
   À partir de 15 : pas la pièce (hors dimensions). */
var K = 50, SAG = 0.04, T_SPARSE = 3, T_NOT_PART = 15, T_OTHER = 18;
function gtype(name) {
  var n = name.toLowerCase();
  if (/custom/.test(n)) return -1;       // ligne de purge du début : pas la pièce
  if (/iron/.test(n)) return /support/.test(n) ? 14 : 8;
  if (/support/.test(n)) return /transition/.test(n) ? 13 : /interface/.test(n) ? 12 : 11;
  if (/tower|prime/.test(n)) return 15;
  if (/skirt/.test(n)) return 16;
  if (/brim/.test(n)) return 17;
  if (/overhang/.test(n)) return 2;
  if (/floating/.test(n)) return 5;
  if (/outer wall|external perimeter|wall-outer/.test(n)) return 1;
  if (/wall|perimeter|shell/.test(n)) return 0;
  if (/top/.test(n)) return 6;
  if (/bottom/.test(n)) return 7;
  if (/bridge/.test(n)) return 9;
  if (/gap/.test(n)) return 10;
  if (/solid|skin/.test(n)) return 4;
  if (/sparse|infill|fill$/.test(n)) return T_SPARSE;
  return T_OTHER;
}
function hms(s) {
  var m = /^\s*(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?!s))?\s*(?:(\d+)\s*s)?/.exec(s);
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
}
function afterSign(r) { var i = r.search(/[=:]/); return i < 0 ? '' : r.slice(i + 1).trim(); }
function bedOf(v) {
  var pts = v.split(',').map(function (a) { return a.trim().split('x').map(Number); }).filter(function (a) { return a.length === 2 && isFinite(a[0]) && isFinite(a[1]); });
  if (pts.length < 3) return null;
  var xs = pts.map(function (a) { return a[0]; }), ys = pts.map(function (a) { return a[1]; });
  var ax = Math.min.apply(null, xs), ay = Math.min.apply(null, ys), w = Math.max.apply(null, xs) - ax, h = Math.max.apply(null, ys) - ay;
  return w > 0 && h > 0 ? [ax, ay, w, h] : null;
}
function GcodeReader(o) {
  var cap = 65536, P = new Int16Array(cap * 4), n = 0, layers = [], layerZ = [];
  var x = 0, y = 0, z = 0, E = 0, relE = false, abs = true, cur = T_OTHER, tool = 0, w = 0, w0 = 0.45, on = !!o.noMarkers, done = false, flush = false, markers = false, lastZ = -1e9;
  var a0 = Infinity, a1 = Infinity, a2 = Infinity, a3 = -Infinity, a4 = -Infinity, a5 = -Infinity;     // tout ce qui est dessiné
  var b0 = Infinity, b1 = Infinity, b3 = -Infinity, b4 = -Infinity, b5 = -Infinity;                    // les pièces : sans tour de purge ni bordure
  var toolMask = 0, typeMask = 0, heights = {}, time = 0, timeM73 = 0, weight = 0, weightTotal = false, dens = 0, diam = 0, ext = 0, colors = null, kinds = null, bed = null, cfgH = 0;
  var lx = NaN, ly = NaN, lz = NaN, lm = -1, mx = new Float64Array(48), nm = 0, tol = o.tol;
  function push(px, py, pz, meta) {
    if (n >= cap) {
      if (n >= o.cap) throw new Error('LIMITE');
      cap *= 2;
      var Q = new Int16Array(cap * 4); Q.set(P); P = Q;
    }
    var i = n * 4;
    P[i] = Math.round(px * K); P[i + 1] = Math.round(py * K); P[i + 2] = Math.round(pz * K); P[i + 3] = meta;
    n++;
  }
  function near(ox, oy, dx, dy, L, qx, qy) {
    var c = ((qx - ox) * dx + (qy - oy) * dy) / L, d = Math.abs((qx - ox) * dy - (qy - oy) * dx) / L;
    return c >= -0.001 && c <= L + 0.001 && d <= tol;
  }
  function seg(ax, ay, bx, by, bz, meta, t) {
    if (Math.abs(ax) > 650 || Math.abs(ay) > 650 || Math.abs(bx) > 650 || Math.abs(by) > 650 || bz > 650 || bz < -10) return;
    if (ax !== lx || ay !== ly || bz !== lz || meta !== lm) {            // nouveau trajet
      push(ax, ay, bz, meta | 0x8000);
      push(bx, by, bz, meta);
      nm = 0;
      if (ax < a0) a0 = ax; if (ax > a3) a3 = ax;
      if (ay < a1) a1 = ay; if (ay > a4) a4 = ay;
      if (t < T_NOT_PART) { if (ax < b0) b0 = ax; if (ax > b3) b3 = ax; if (ay < b1) b1 = ay; if (ay > b4) b4 = ay; }
    } else {                                                             // presque aligné : le dernier point s'allonge
      var j = (n - 2) * 4, ox = P[j] / K, oy = P[j + 1] / K, dx = bx - ox, dy = by - oy, L = Math.sqrt(dx * dx + dy * dy);
      var ok = L > 0 && nm < 24 && !(P[(n - 1) * 4 + 3] & 0x8000) && near(ox, oy, dx, dy, L, lx, ly);
      for (var q = 0; ok && q < nm; q++) ok = near(ox, oy, dx, dy, L, mx[q * 2], mx[q * 2 + 1]);
      if (ok) {
        mx[nm * 2] = lx; mx[nm * 2 + 1] = ly; nm++;
        var i = (n - 1) * 4;
        P[i] = Math.round(bx * K); P[i + 1] = Math.round(by * K);
      } else { push(bx, by, bz, meta); nm = 0; }
    }
    if (bx < a0) a0 = bx; if (bx > a3) a3 = bx;
    if (by < a1) a1 = by; if (by > a4) a4 = by;
    if (bz < a2) a2 = bz; if (bz > a5) a5 = bz;
    if (t < T_NOT_PART) { if (bx < b0) b0 = bx; if (bx > b3) b3 = bx; if (by < b1) b1 = by; if (by > b4) b4 = by; if (bz > b5) b5 = bz; }
    lx = bx; ly = by; lz = bz; lm = meta;
  }
  function note(r) {
    if (r.startsWith('model printing time') || r.startsWith('total estimated time')) {
      var m = /total estimated time:\s*(.+)$/.exec(r);
      time = hms(m ? m[1] : afterSign(r));
    } else if (r.startsWith('estimated printing time')) { if (!time) time = hms(afterSign(r)); }
    else if (r.startsWith('TIME:')) { if (!time) time = +r.slice(5) || 0; }
    else if (/^(total )?filament (used|weight) \[g\]/.test(r)) {
      var tot = r.charCodeAt(0) === 116;
      if (tot || !weightTotal) {
        var g = afterSign(r).split(/[,;]/).reduce(function (s, v) { return s + (parseFloat(v) || 0); }, 0);
        if (g > 0) { weight = g; weightTotal = tot; }
      }
    } else if (r.startsWith('filament_density')) { if (!dens) dens = parseFloat(afterSign(r)) || 0; }
    else if (r.startsWith('filament_diameter')) { if (!diam) diam = parseFloat(afterSign(r)) || 0; }
    else if (r.startsWith('filament_colour')) {
      if (!colors) colors = afterSign(r).split(/[,;]/).map(function (c) { c = c.trim(); return /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7).toUpperCase() : null; });
    } else if (r.startsWith('filament_type')) {
      if (!kinds) kinds = afterSign(r).split(/[,;]/).map(function (c) { return c.trim().replace(/["']/g, '').slice(0, 16); });
    } else if (r.startsWith('printable_area') || r.startsWith('bed_shape')) { if (!bed) bed = bedOf(afterSign(r)); }
    else if (r.startsWith('nozzle_diameter')) { var d = parseFloat(afterSign(r)); if (d > 0.1 && d < 2) w0 = d * 1.125; }
    else if (r.startsWith('layer_height') || r.startsWith('Layer height:')) { if (!cfgH) cfgH = parseFloat(afterSign(r)) || 0; }
  }
  function comment(l) {
    var r = l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1), c = r.charCodeAt(0);
    if (!done) {
      if (r.startsWith('FEATURE:') || r.startsWith('TYPE:')) { cur = gtype(r.slice(r.indexOf(':') + 1).trim()); return; }
      if (r.startsWith('CHANGE_LAYER') || r.startsWith('LAYER_CHANGE') || /^LAYER:\d/.test(r)) {
        markers = true; on = true; layers.push(n); layerZ.push(z);
        return;
      }
      if (r.startsWith('LINE_WIDTH:') || r.startsWith('WIDTH:')) { w = parseFloat(r.slice(r.indexOf(':') + 1)) || w; return; }
      if (r.startsWith('LAYER_HEIGHT:') || r.startsWith('HEIGHT:')) {
        var h = Math.round((parseFloat(r.slice(r.indexOf(':') + 1)) || 0) * 100);
        if (h > 0) heights[h] = (heights[h] || 0) + 1;
        return;
      }
      if (c === 70 && r.startsWith('FLUSH_START')) { flush = true; return; }
      if (c === 70 && r.startsWith('FLUSH_END')) { flush = false; return; }
      if (on && (r.startsWith('EXECUTABLE_BLOCK_END') || r.startsWith('MACHINE_END_GCODE_START'))) { done = true; return; }
    }
    note(r);
  }
  function words(l, i, end, out) {
    out.x = NaN; out.y = NaN; out.z = NaN; out.e = NaN; out.i = 0; out.j = 0;
    while (i < end) {
      var a = l.charCodeAt(i);
      if (a < 65 || a > 90) { i++; continue; }
      var j = i + 1;
      while (j < end) {
        var c = l.charCodeAt(j);
        if (c === 32 || c === 9 || (c >= 65 && c <= 90)) break;
        j++;
      }
      var v = +l.slice(i + 1, j);
      if (a === 88) out.x = v; else if (a === 89) out.y = v; else if (a === 90) out.z = v; else if (a === 69) out.e = v;
      else if (a === 73) out.i = v; else if (a === 74) out.j = v;
      i = j;
    }
  }
  var W = { x: 0, y: 0, z: 0, e: 0, i: 0, j: 0 };
  this.line = function (l) {
    var c0 = l.charCodeAt(0);
    if (c0 === 59) { comment(l); return; }
    if (c0 === 77) {
      if (l.startsWith('M83')) relE = true;
      else if (l.startsWith('M82')) relE = false;
      else if (!timeM73 && l.startsWith('M73')) { var rm = /\bR(\d+)/.exec(l); if (rm) timeM73 = +rm[1] * 60; }
      return;
    }
    if (done) return;
    if (c0 === 84) { var t = /^T(\d+)/.exec(l); if (t && +t[1] < 16) tool = +t[1]; return; }
    if (c0 !== 71) return;
    var i = 1, code = 0, c = l.charCodeAt(1);
    while (c >= 48 && c <= 57) { code = code * 10 + c - 48; c = l.charCodeAt(++i); }
    if (i === 1) return;
    if (code === 90) { abs = true; return; }
    if (code === 91) { abs = false; return; }
    if (code === 92) { var ge = /E(-?[\d.]+)/.exec(l); if (ge) E = +ge[1]; return; }
    if (code > 3) return;
    var sc = l.indexOf(';');
    words(l, i, sc < 0 ? l.length : sc, W);
    var bx = W.x !== W.x ? x : abs ? W.x : x + W.x, by = W.y !== W.y ? y : abs ? W.y : y + W.y, bz = W.z !== W.z ? z : abs ? W.z : z + W.z;
    var de = W.e !== W.e ? 0 : (relE || !abs) ? W.e : W.e - E;
    if (!relE && abs && W.e === W.e) E = W.e;
    if (on && !flush && cur >= 0 && de > 0 && (bx !== x || by !== y) && !(o.noInfill && cur === T_SPARSE)) {
      if (!markers && bz > lastZ + 1e-4) { lastZ = bz; layers.push(n); layerZ.push(bz); }
      var width = Math.max(1, Math.min(63, Math.round((w || w0) * 40)));
      var meta = (cur << 10) | (tool << 6) | width;
      toolMask |= 1 << tool; typeMask |= 1 << cur; ext += de;
      if (code >= 2 && (W.i || W.j)) {
        var cx = x + W.i, cy = y + W.j, rr = Math.sqrt(W.i * W.i + W.j * W.j);
        var s0 = Math.atan2(y - cy, x - cx), d = Math.atan2(by - cy, bx - cx) - s0;
        if (code === 2) { if (d >= -1e-9) d -= 2 * Math.PI; } else if (d <= 1e-9) d += 2 * Math.PI;
        var st = Math.min(64, Math.max(1, Math.ceil(Math.abs(d) / (2 * Math.acos(Math.max(0, 1 - SAG / Math.max(rr, SAG)))))));
        var px = x, py = y;
        for (var s = 1; s <= st; s++) {
          var u = s0 + d * s / st, qx = s === st ? bx : cx + rr * Math.cos(u), qy = s === st ? by : cy + rr * Math.sin(u);
          seg(px, py, qx, qy, bz, meta, cur);
          px = qx; py = qy;
        }
      } else seg(x, y, bx, by, bz, meta, cur);
    }
    x = bx; y = by; z = bz;
  };
  this.finished = function () { return done; };
  this.empty = function () { return !markers && n < 2; };
  this.finish = function () {
    if (n < 2 || !isFinite(a0 + a1 + a2 + a3 + a4 + a5)) return null;
    var L = [];
    for (var k = 0; k < layers.length; k++) if (layers[k] < n && (k + 1 === layers.length || layers[k + 1] > layers[k])) L.push(layers[k]);
    if (!L.length) L.push(0);
    L[0] = 0;
    // hauteur de couche : la plus fréquente
    var best = 0, bh = 0;
    Object.keys(heights).forEach(function (h) { if (heights[h] > best) { best = heights[h]; bh = +h / 100; } });
    if (!bh) {
      var dz = {};
      for (var q = 1; q < layerZ.length; q++) { var t = Math.round((layerZ[q] - layerZ[q - 1]) * 100); if (t > 0) dz[t] = (dz[t] || 0) + 1; }
      Object.keys(dz).forEach(function (h) { if (dz[h] > best) { best = dz[h]; bh = +h / 100; } });
    }
    bh = Math.max(0.02, Math.min(2, bh || cfgH || 0.2));
    var d = diam || 1.75, g = ext * Math.PI * d * d / 4 / 1000 * (dens || 1.24);
    var noPart = !isFinite(b0 + b3 + b1 + b4 + b5);
    return {
      n: n, pts: P.slice(0, n * 4), layers: new Uint32Array(L), h: bh,
      box: [a0, a1, a2, a3, a4, a5],
      size: noPart ? [a3 - a0, a4 - a1, a5] : [b3 - b0, b4 - b1, b5],
      tools: toolMask, types: typeMask, time: time || timeM73, weight: weight || g, colors: colors, kinds: kinds, bed: bed
    };
  };
}
async function readLines(stream, rd, tick, stopWhenDone) {
  var reader = stream.getReader(), dec = new TextDecoder('latin1'), tail = '', r;
  try {
    for (;;) {
      r = await reader.read();
      if (r.done) break;
      tick(r.value.length);
      var ls = (tail + dec.decode(r.value, { stream: true })).split('\n');
      tail = ls.pop();
      if (tail.length > 4194304) throw new Error('ligne trop longue');
      for (var i = 0; i < ls.length; i++) rd.line(ls[i]);
      if (stopWhenDone && rd.finished()) { reader.cancel().catch(function () {}); return; }
    }
    if (tail) rd.line(tail);
  } catch (err) {
    try { reader.cancel().catch(function () {}); } catch (e2) { /* déjà fermé */ }
    throw err;
  }
}
/* Trop de points pour le budget : sans le remplissage, puis des trajets plus grossiers. */
var TRIES = [[0.04, false], [0.04, true], [0.15, true]];
async function parseGcode(p) {
  var entry = p.raw ? null : doc.zip['metadata/plate_' + p.id + '.gcode'], total = p.raw ? p.raw.size : entry.us, noMarkers = false;
  for (var a = 0; a < TRIES.length; a++) {
    var rd = new GcodeReader({ tol: TRIES[a][0], noInfill: TRIES[a][1], noMarkers: noMarkers, cap: limitPts }), seen = 0, last = 0;
    var tick = function (bytes) {
      seen += bytes;
      var now = Date.now();
      if (now - last > 120) { last = now; self.postMessage({ t: 'progress', p: Math.min(0.97, seen / Math.max(1, total)) }); }
    };
    var stream = p.raw ? p.raw.stream() : await entryStream(doc.file, entry);
    try {
      await readLines(stream, rd, tick, !p.raw);
    } catch (err) {
      if (err.message === 'LIMITE') continue;
      throw err;
    }
    if (rd.empty() && !noMarkers) { noMarkers = true; a--; continue; }      // aucun repère de couche : on suit le Z
    var res = rd.finish();
    if (res) res.light = a > 0;
    return res;
  }
  return null;
}
async function parsedOf(p) {
  if (p.parsed !== undefined) return p.parsed;
  var r = null;
  try { r = await parseGcode(p); } catch (err) { r = null; }
  p.parsed = r;
  // on garde les plateaux déjà lus, dans la limite du budget
  var sum = r ? r.n : 0;
  doc.plates.forEach(function (o) {
    if (o === p || !o.parsed) return;
    if (sum + o.parsed.n > limitPts * 2) o.parsed = undefined; else sum += o.parsed.n;
  });
  return r;
}
function pathsInfo(p, r) {
  var b = r.box, cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, bed = doc.zip ? [doc.ax, doc.ay, doc.W, doc.H] : r.bed, rect = null;
  if (bed) {
    var hw = bed[2] / 2, hh = bed[3] / 2, rx = bed[0] + hw, ry = bed[1] + hh;
    if (Math.abs(cx - rx) > hw || Math.abs(cy - ry) > hh) { rx = cx; ry = cy; }
    rect = [rx - cx, ry - cy, hw, hh];
  }
  var cols = doc.colors && doc.colors.length ? doc.colors : r.colors || [], kinds = doc.kinds && doc.kinds.length ? doc.kinds : r.kinds || [], tools = [];
  for (var t = 0; t < 16; t++) if (r.tools >> t & 1) tools.push({ i: t, c: cols[t] || null, k: kinds[t] || '' });
  return {
    id: p.id, h: r.h, off: [cx, cy], fit: [b[3] - b[0], b[4] - b[1], b[5]], size: r.size, rect: rect, tools: tools, types: r.types,
    time: p.time || r.time, weight: p.weight || r.weight, light: r.light, count: r.n
  };
}
async function sendPaths(p, i, req) {
  var r = await parsedOf(p);
  if (req !== lastReq) return true;
  if (!r) return false;
  var info = pathsInfo(p, r), pts = r.pts.slice(), layers = r.layers.slice();
  info.pts = pts; info.layers = layers; info.volume = 0; info.area = 0;
  self.postMessage({ t: 'plate', req: req, i: i, paths: info }, [pts.buffer, layers.buffer]);
  return true;
}
/* L'aperçu qu'on peut envoyer à un client : les trajets et les chiffres, jamais le G-code ni les réglages.
   'CAPV' + version + taille de l'en-tête JSON + en-tête + pour chaque plateau : couches, 4 colonnes en écarts, vignette. Le tout en gzip. */
async function sendCapv(req) {
  var heads = [], parts = [], points = 0, list = doc.plates.filter(function (p) { return p.gcode; });
  for (var a = 0; a < list.length; a++) {
    var p = list[a], r = await parsedOf(p);
    if (!r) continue;
    var n = r.n, cols = new Int16Array(n * 4);
    for (var c = 0; c < 4; c++) {
      var prev = 0;
      for (var i = 0; i < n; i++) { var v = r.pts[i * 4 + c]; cols[c * n + i] = v - prev; prev = v; }
    }
    var thumb = p.thumb ? new Uint8Array(await p.thumb.arrayBuffer()) : null, info = pathsInfo(p, r);
    info.n = n; info.m = r.layers.length; info.thumb = thumb ? thumb.length : 0; delete info.count;
    heads.push(info);
    parts.push(r.layers, cols);
    if (thumb) parts.push(thumb);
    points += n;
  }
  if (!heads.length) { self.postMessage({ t: 'capv', req: req, blob: null }); return; }
  var json = new TextEncoder().encode(JSON.stringify({ v: 1, plates: heads })), top = new Uint8Array(12);
  top.set([67, 65, 80, 86, 1]);
  new DataView(top.buffer).setUint32(8, json.length, true);
  var blob = new Blob([top, json].concat(parts), { type: 'application/octet-stream' });
  if (self.CompressionStream) blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  self.postMessage({ t: 'capv', req: req, blob: blob, plates: heads.length, points: points });
}

/* ---------- ouverture ---------- */
async function openGcode(file) {
  doc = { plates: [{ id: 1, meshes: [], gcode: true, raw: file, time: 0, weight: 0, tris: 0, thumb: null, ox: 0, oy: 0 }], colors: [], kinds: [], W: 0, H: 0, ax: 0, ay: 0, file: file, zip: null };
  self.postMessage({ t: 'meta', lightened: false, tooBig: false, tris: 0, plates: [{ id: 1, hasMesh: false, gcode: true, size: null, volume: 0, area: 0, tris: 0, thumb: null, time: 0, weight: 0 }] });
}
async function openFile(file, budget, maxTris) {
  limitTris = maxTris;
  var zip = await zipList(file), st = { objs: {}, mats: {}, items: [], queue: [], seen: {}, unit: null, colors: [], cfg: null, scale: 1 };

  // où est le modèle principal
  var mainName = '3d/3dmodel.model';
  if (zip['_rels/.rels']) {
    var rel = /Target="\/?([^"]+\.model)"/i.exec(await entryText(file, zip['_rels/.rels']));
    if (rel) mainName = rel[1].toLowerCase();
  }
  if (!zip[mainName]) {
    mainName = Object.keys(zip).filter(function (n) { return /\.model$/.test(n); }).sort(function (a, b) { return a.split('/').length - b.split('/').length; })[0];
    if (!mainName) throw new Error('pas de modèle');
  }
  st.mainPath = '/' + mainName;

  // lecture des modèles, un à un, sans tout garder en mémoire
  var totalBytes = 0, doneBytes = 0, last = 0;
  Object.keys(zip).forEach(function (n) { if (/\.model$/.test(n)) totalBytes += zip[n].us; });
  function tick(n) {
    doneBytes += n;
    var now = Date.now();
    if (now - last > 120) { last = now; self.postMessage({ t: 'progress', p: Math.min(0.97, doneBytes / Math.max(1, totalBytes)) }); }
  }
  st.seen[st.mainPath] = 0; st.queue.push(st.mainPath);
  var tooBig = false;
  try {
    while (st.queue.length) {
      var path = st.queue.shift(), e = zip[path.slice(1)];
      if (e) await parseModel(file, e, path, st, tick);
    }
  } catch (err) {
    if (err.message !== 'LIMITE') throw err;
    tooBig = true; st.objs = {}; st.items = [];
  }
  st.scale = UNITS[st.unit] || 1;

  // réglages du projet
  var W = 256, H = 256, ax = 0, ay = 0, kinds = [];
  if (zip['metadata/project_settings.config']) {
    try {
      var ps = JSON.parse(await entryText(file, zip['metadata/project_settings.config']));
      if (Array.isArray(ps.filament_colour)) st.colors = ps.filament_colour.map(function (c) { return /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7).toUpperCase() : null; });
      if (Array.isArray(ps.filament_type)) kinds = ps.filament_type.map(function (c) { return String(c).slice(0, 16); });
      if (Array.isArray(ps.printable_area) && ps.printable_area.length >= 3) {
        var xs = ps.printable_area.map(function (a) { return parseFloat(a.split('x')[0]); }), ys = ps.printable_area.map(function (a) { return parseFloat(a.split('x')[1]); });
        ax = Math.min.apply(null, xs); ay = Math.min.apply(null, ys);
        W = Math.max.apply(null, xs) - ax; H = Math.max.apply(null, ys) - ay;
      }
    } catch (e1) { /* réglages illisibles : plateau de 256 mm, sans couleurs */ }
  }
  if (zip['metadata/model_settings.config']) {
    try { st.cfg = parseConfig(await entryText(file, zip['metadata/model_settings.config'])); } catch (e2) { st.cfg = null; }
  }
  var sliced = {};
  if (zip['metadata/slice_info.config']) {
    try { sliced = parseSlice(await entryText(file, zip['metadata/slice_info.config'])); } catch (e3) { sliced = {}; }
  }

  // plateaux
  var byObj = {};
  st.items.forEach(function (it) { (byObj[it.id] = byObj[it.id] || []).push(it); });
  var plates = [], cfgPlates = st.cfg ? st.cfg.plates : [], cols = Math.ceil(Math.sqrt(Math.max(1, cfgPlates.length)));
  cfgPlates.forEach(function (cp) {
    var meshes = [];
    cp.insts.forEach(function (ins) {
      var list = byObj[ins.obj], it = list && (list[ins.inst] || list[0]);
      if (it && it.printable) flatten(st, it, meshes);
    });
    var idx = cp.id - 1, g = sliced[cp.id] || {};
    plates.push({
      id: cp.id, meshes: meshes, time: g.time || 0, weight: g.weight || 0,
      ox: ax + (idx % cols) * W * 1.2, oy: ay - Math.floor(idx / cols) * H * 1.2,
      gcode: !!zip['metadata/plate_' + cp.id + '.gcode']
    });
  });
  plates = plates.filter(function (p) { return p.meshes.length || p.gcode || p.time; });
  if (!plates.length && st.items.length) {          // 3MF ordinaire : un seul plateau, tout ce qui est à imprimer
    var meshes = [];
    st.items.forEach(function (it) { if (it.printable) flatten(st, it, meshes); });
    var s1 = sliced[1] || {};
    plates.push({ id: 1, meshes: meshes, time: s1.time || 0, weight: s1.weight || 0, ox: ax, oy: ay, gcode: false });
  }
  if (!plates.length && !tooBig) {                  // aucun maillage, aucune trace de plateau : du G-code seul, peut-être
    Object.keys(zip).forEach(function (n) {
      var m = /^metadata\/plate_(\d+)\.gcode$/.exec(n);
      if (m) { var g = sliced[+m[1]] || {}; plates.push({ id: +m[1], meshes: [], time: g.time || 0, weight: g.weight || 0, ox: 0, oy: 0, gcode: true }); }
    });
    plates.sort(function (a, b) { return a.id - b.id; });
  }
  if (tooBig && !plates.length) {                    // trop lourd : l'image du plateau, sans 3D
    Object.keys(zip).forEach(function (n) {
      var m = /^metadata\/plate_(\d+)\.png$/.exec(n);
      if (m) { var g = sliced[+m[1]] || {}; plates.push({ id: +m[1], meshes: [], time: g.time || 0, weight: g.weight || 0, ox: 0, oy: 0, gcode: false }); }
    });
    plates.sort(function (a, b) { return a.id - b.id; });
  }
  if (!plates.length) throw new Error('rien à montrer');
  plates.forEach(function (p) { p.tris = 0; if (p.meshes.length) plateStats(p); });

  // téléphone : allégé si un plateau dépasse le budget
  var maxPlate = 0, lightened = false;
  plates.forEach(function (p) { if (p.tris > maxPlate) maxPlate = p.tris; });
  if (maxPlate > budget) {
    var seen = {}, ratio = budget / maxPlate;
    plates.forEach(function (p) {
      p.meshes.forEach(function (g) {
        if (seen[g.o.key]) return;
        seen[g.o.key] = 1;
        simplify(g.o, ratio);
      });
    });
    lightened = true;
  }

  // images des plateaux
  var multi = plates.length > 1;
  for (var i = 0; i < plates.length; i++) {
    var pl = plates[i], name = 'metadata/plate_' + pl.id + '.png';
    if (!zip[name] && !multi) name = ['metadata/thumbnail.png', 'thumbnails/thumbnail.png', '3d/thumbnail.png'].filter(function (n) { return zip[n]; })[0];
    var en = name && zip[name];
    pl.thumb = null;
    if (en && en.us < 5 * 1048576) {
      try {
        var png = await entryBytes(file, en);
        if (png[0] === 0x89 && png[1] === 0x50) pl.thumb = new Blob([png], { type: 'image/png' });
      } catch (e4) { /* sans image, on affiche le numéro */ }
    }
  }

  doc = { plates: plates, colors: st.colors, kinds: kinds, W: W || 256, H: H || 256, ax: ax, ay: ay, file: file, zip: zip };
  self.postMessage({
    t: 'meta', lightened: lightened, tooBig: tooBig, tris: maxPlate,
    plates: plates.map(function (p) {
      return { id: p.id, hasMesh: p.meshes.length > 0, gcode: !!p.gcode, size: p.size || null, volume: p.volume || 0, area: p.area || 0, tris: p.tris, thumb: p.thumb, time: p.time, weight: p.weight };
    })
  });
}
