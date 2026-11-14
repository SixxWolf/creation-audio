// Fichier du batch en cours : retrouvé puis lu (en-tête AutoLoop) pour l'onglet Production.
// Sources, dans l'ordre : 1) la carte microSD de l'imprimante (FTPS implicite, port 990, session TLS réutilisée)
// 2) les dossiers locaux de la config (« jobDirs », Téléchargements par défaut) : le .gcode.3mf exporté d'AutoLoop.
// Rien n'est stocké : seuls les chiffres de l'en-tête partent vers Supabase (loops, durée, objets, filaments).
const fs = require('fs');
const os = require('os');
const path = require('path');
const tls = require('tls');
const zlib = require('zlib');

const HEAD_BYTES = 3 * 1024 * 1024;   // en-tête + bloc de config : dans les 3 premiers Mo (comme cms-production.js)

/* ---------- zip minimal (.3mf) : répertoire central + inflate ---------- */
function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('pas un zip');
  const n = buf.readUInt16LE(e + 10), entries = {};
  let off = buf.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(off + 10), size = buf.readUInt32LE(off + 20);
    const fl = buf.readUInt16LE(off + 28), xl = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32);
    const lo = buf.readUInt32LE(off + 42), name = buf.toString('utf8', off + 46, off + 46 + fl);
    entries[name] = { method, size, lo };
    off += 46 + fl + xl + cl;
  }
  return {
    names: Object.keys(entries),
    get(name, max) {
      const z = entries[name]; if (!z) return null;
      const ds = z.lo + 30 + buf.readUInt16LE(z.lo + 26) + buf.readUInt16LE(z.lo + 28);
      const raw = buf.subarray(ds, ds + z.size);
      if (z.method === 0) return max ? raw.subarray(0, max) : raw;
      try { return zlib.inflateRawSync(raw, max ? { maxOutputLength: max } : {}); }
      catch (err) { if (err.code === 'ERR_BUFFER_TOO_LARGE') return zlib.inflateRawSync(raw.subarray(0, Math.min(raw.length, max)), { finishFlush: zlib.constants.Z_SYNC_FLUSH }); throw err; }
    },
  };
}

/* ---------- lecture de l'en-tête (même règles que parseGcode de cms-production.js) ---------- */
function parseDur(s) {
  const d = /(\d+)\s*j/.exec(s), hm = /(\d+)\s*h\s*(\d+)?/.exec(s), mm = /(\d+)\s*min/.exec(s);
  return (d ? +d[1] * 1440 : 0) + (hm ? +hm[1] * 60 + (+hm[2] || 0) : mm ? +mm[1] : 0);
}
function parseHms(s) {
  const h = /([\d.]+)\s*h/i.exec(s), m = /([\d.]+)\s*m(?!s)/i.exec(s), sec = /([\d.]+)\s*s/i.exec(s);
  return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (sec ? +sec[1] / 60 : 0);
}
const listOf = (re, text, sep) => { const m = re.exec(text); return m ? m[1].trim().split(sep) : []; };
function parseGcode(head) {
  const isAuto = head.indexOf('Batch généré par AutoLoop') !== -1;
  const lm = /; === LOOP 1 OF (\d+) ===/.exec(head) || /^; (\d+) loops · /m.exec(head);
  const loops = isAuto && lm ? Math.max(1, +lm[1]) : 1;
  const dm = /Durée estimée du batch : ([^(\r\n]+)/.exec(head);
  let minutes = dm ? parseDur(dm[1]) : 0;
  if (!minutes) {
    const tm = /;\s*total estimated time:\s*([0-9hms .]+)/i.exec(head) || /;\s*model printing time:\s*([0-9hms .]+)/i.exec(head);
    minutes = tm ? parseHms(tm[1]) * loops : 0;
  }
  const w = listOf(/^;\s*total filament weight \[g\]\s*:\s*([\d.,\s]+)$/m, head, ',').map((v) => +v || 0);
  const slots = listOf(/^;\s*filament:\s*([\d,\s]+)$/m, head, ',').map((v) => +v || 0);
  const types = listOf(/^;\s*filament_type\s*=\s*(.+)$/m, head, ';');
  const cols = listOf(/^;\s*filament_colour\s*=\s*(.+)$/m, head, ';');
  const fils = [];
  w.forEach((g, i) => {
    if (!(g > 0)) return;
    const slot = slots.length === w.length && slots[i] > 0 ? slots[i] : i + 1;
    fils.push({ type: (types[slot - 1] || '').trim(), hex: (cols[slot - 1] || '').trim(), perLoop: Math.round(g / loops * 100) / 100 });
  });
  return { isAuto, loops, minutes: Math.round(minutes), fils };
}
function countObjects(xml, plateN) {
  let n = 0;
  String(xml || '').replace(/<plate>[\s\S]*?<\/plate>/g, (blk) => {
    const idx = /<metadata key="index" value="(\d+)"/.exec(blk);
    if (idx && +idx[1] === plateN) n = (blk.match(/<object /g) || []).length;
    return blk;
  });
  return n;
}
// buf = .gcode.3mf ou .gcode ; plate = n° du plateau imprimé (MQTT gcode_file « Metadata/plate_N.gcode »)
function parseJobFile(buf, plate) {
  if (buf.readUInt32LE(0) === 0x04034b50) {
    const z = readZip(buf);
    const plates = z.names.filter((n) => /^Metadata\/plate_\d+\.gcode$/.test(n));
    if (!plates.length) throw new Error('aucun plateau tranché');
    let name = plates.find((n) => n === `Metadata/plate_${plate}.gcode`);
    if (!name) name = plates.find((n) => z.get(n, 4096).toString('utf8').indexOf('Batch généré par AutoLoop') !== -1) || plates[0];
    const head = z.get(name, HEAD_BYTES).toString('utf8');
    const info = parseGcode(head);
    const sc = z.get('Metadata/slice_info.config');
    info.objects = countObjects(sc && sc.toString('utf8'), +/plate_(\d+)/.exec(name)[1]);
    return info;
  }
  const info = parseGcode(buf.subarray(0, HEAD_BYTES).toString('utf8'));
  info.objects = 0;
  return info;
}

/* ---------- source 1 : microSD de l'imprimante (FTPS) ---------- */
function ftpsGet(p, wanted, timeout = 60000) {
  return new Promise((resolve, reject) => {
    let sess = null, buf = '', wait = null, done = false;
    const s = tls.connect({ host: p.ip, port: 990, rejectUnauthorized: false, maxVersion: 'TLSv1.2' });
    const fin = (err, v) => { if (done) return; done = true; clearTimeout(t); s.destroy(); err ? reject(err) : resolve(v); };
    const t = setTimeout(() => fin(new Error('délai FTPS')), timeout);
    s.on('session', (x) => { sess = x; });
    s.on('error', (e) => fin(e));
    s.on('data', (d) => {
      buf += d; let m;
      while ((m = /^(\d{3}) .*\r?\n/m.exec(buf))) { const line = m[0]; buf = buf.slice(m.index + line.length); if (wait) { const w = wait; wait = null; w(line.trim()); } }
    });
    const next = () => new Promise((r) => { wait = r; });
    const cmd = (c) => { const pr = next(); s.write(c + '\r\n'); return pr; };
    const data = async (c) => {
      const pv = await cmd('PASV'), n = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(pv);
      if (!n) throw new Error('PASV refusé');
      const d = tls.connect({ host: p.ip, port: n[5] * 256 + +n[6], rejectUnauthorized: false, maxVersion: 'TLSv1.2', session: sess || s.getSession() });
      const chunks = [];
      d.on('data', (x) => chunks.push(x));
      const closed = new Promise((r) => { d.on('close', r); d.on('error', r); });
      const r1 = await cmd(c);
      if (!/^1\d\d/.test(r1)) { d.destroy(); throw new Error(r1); }
      await closed; const r2 = await next();
      if (!/^2\d\d/.test(r2)) throw new Error(r2);
      return Buffer.concat(chunks);
    };
    (async () => {
      await next();
      await cmd('USER bblp');
      if (!/^230/.test(await cmd('PASS ' + p.code))) throw new Error('connexion FTPS refusée');
      await cmd('PBSZ 0'); await cmd('PROT P'); await cmd('TYPE I');
      for (const dir of ['/cache', '/', '/model']) {
        let list;
        try { list = (await data('NLST ' + dir)).toString('utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean); } catch { continue; }
        const hit = list.map((x) => path.posix.basename(x)).find((x) => wanted.includes(x));
        if (hit) return fin(null, await data('RETR ' + path.posix.join(dir, hit)));
      }
      fin(null, null);
    })().catch((e) => fin(e));
  });
}

/* ---------- source 2 : dossiers locaux (Téléchargements) ---------- */
function localFind(dirs, wanted) {
  let best = null;
  for (const dir of dirs) {
    let names; try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!wanted.includes(n)) continue;
      const f = path.join(dir, n), st = fs.statSync(f);
      if (!best || st.mtimeMs > best.mtime) best = { file: f, mtime: st.mtimeMs };
    }
  }
  return best ? fs.readFileSync(best.file) : null;
}

// Noms possibles du fichier à partir du nom de tâche MQTT (subtask_name) ; le navigateur remplace parfois les « _ » par des espaces
function candidates(task) {
  const out = new Set();
  [task, task.replace(/_/g, ' '), task.replace(/ /g, '_')].forEach((b) => {
    ['.gcode.3mf', '.3mf', '.gcode'].forEach((ext) => out.add(b + ext));
  });
  return [...out];
}

const DEFAULT_DIRS = [path.join(os.homedir(), 'Downloads')];
async function findJob(p, task, plate, dirs) {
  const wanted = candidates(task);
  let buf = null, src = null;
  try { buf = await ftpsGet(p, wanted); if (buf) src = 'sd'; } catch { /* pas de carte microSD : normal sur les P2S de base */ }
  if (!buf) { buf = localFind(dirs && dirs.length ? dirs : DEFAULT_DIRS, wanted); if (buf) src = 'pc'; }
  if (!buf) return null;
  const info = parseJobFile(buf, plate);
  info.src = src;
  return info;
}

module.exports = { findJob, parseJobFile };
