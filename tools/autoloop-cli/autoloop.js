#!/usr/bin/env node
/* =========================================================================
   Création Audio — AutoLoop en ligne de commande (PC de l'atelier)

   Génère un batch AutoLoop SANS navigateur, avec exactement le même code que la
   page admin (assets/autoloop-core.js + assets/autoloop-3mf.js), puis l'ouvre
   dans Bambu Studio. L'envoi à l'imprimante (Print plate → imprimante → Send)
   reste fait dans Bambu Studio.

   UTILISATION
     node tools/autoloop-cli/autoloop.js <spacer> <loops> <imprimante> [imprimante…] [options]

     node tools/autoloop-cli/autoloop.js HKSB110 8 p2s-2 p2s-3
     node tools/autoloop-cli/autoloop.js "6.5" 12 p2s-1 --version "Less Squish"
     node tools/autoloop-cli/autoloop.js --list          (spacers + versions disponibles)

   OPTIONS
     --version <texte>  version du plateau (sinon : celle « par défaut » d'AutoLoop,
                        la 1re de la carte du spacer sans étiquette client)
     --no-open          ne pas ouvrir Bambu Studio (fichier seulement)
     --force            générer même si une imprimante visée est déjà en impression
     --out <dossier>    dossier de sortie (défaut : Téléchargements — le relais des
                        imprimantes y lit le fichier du batch pour Production)

   CE QUE FAIT LE SCRIPT
     1. Demande à la fonction Supabase « autoloop-cli » (jeton du relais, lecture seule) :
        les plateaux enregistrés dans AutoLoop (onglet Fichiers), les réglages par
        défaut d'AutoLoop, le Z de chaque imprimante et l'état des imprimantes.
        → Seuls les fichiers téléversés dans AutoLoop sont utilisés, jamais un
          fichier du disque.
     2. Trouve le spacer (nom, slug, n° remplacés, anciens noms — comme Production)
        et sa version, puis télécharge son .gcode.3mf (lien signé de 2 min).
     3. Réglages = valeurs d'origine des champs → défauts enregistrés d'AutoLoop →
        réglages enregistrés avec le plateau (même ordre que la page). Cases flow /
        bed leveling : celles du plateau, sinon le motif « tous les X loops ».
     4. Regroupe les imprimantes par Z (admin_settings « autoloop_ztrim ») : même Z
        = un seul fichier. Z différents = un fichier par Z, nommé avec l'imprimante.
     5. Génère (ALCore.generateBatch), vérifie que chaque loop a le bon « G29.1 Z »,
        reconstruit le projet (ALProject.build : MD5 + slice_info), écrit le fichier.
     6. Ouvre chaque fichier dans une NOUVELLE fenêtre Bambu Studio (sauf --no-open).

   CONFIG (locale, hors dépôt) : %USERPROFILE%\Documents\Création Audio - Imprimantes\config.json
     { "supabase": { "url", "key", "token" }, … } — la même que le relais (tools/farm-relay).
     Autre chemin : variable d'environnement RELAY_CONFIG.

   CODE DE SORTIE : 0 = fichier(s) prêt(s) ; 1 = erreur (rien d'écrit ou vérification ratée).
   ========================================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const STUDIO = 'C:\\Program Files\\Bambu Studio\\bambu-studio.exe';
const CONFIG = process.env.RELAY_CONFIG ||
  path.join(os.homedir(), 'Documents', 'Création Audio - Imprimantes', 'config.json');
const BUSY = ['RUNNING', 'PREPARE', 'PAUSE', 'SLICING'];

/* ---- Code partagé avec la page (chargé tel quel, sans copie) ---------------- */
function loadShared() {
  const box = { TextEncoder, TextDecoder, console };
  box.self = box;   // les modules du site s'accrochent à « self »
  vm.createContext(box);
  for (const f of ['assets/vendor/fflate-0.8.3.min.js', 'assets/autoloop-3mf.js', 'assets/autoloop-core.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), box, { filename: f });
  }
  if (!box.fflate && box.module) box.fflate = box.module.exports;
  if (!box.ALCore || !box.ALProject || !box.fflate) throw new Error('modules AutoLoop introuvables dans assets/');
  return box;
}

/* ---- Arguments ------------------------------------------------------------- */
function parseArgs(argv) {
  const a = { pos: [], version: null, open: true, force: false, out: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--version') a.version = argv[++i];
    else if (v === '--no-open') a.open = false;
    else if (v === '--force') a.force = true;
    else if (v === '--out') a.out = argv[++i];
    else if (v === '--list') a.list = true;
    else if (v === '-h' || v === '--help') a.help = true;
    else a.pos.push(v);
  }
  return a;
}
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fail = (msg) => { console.error('✗ ' + msg); process.exit(1); };

/* ---- Supabase (fonction autoloop-cli) ------------------------------------- */
async function api(cfg, body) {
  const res = await fetch(`${cfg.supabase.url}/functions/v1/autoloop-cli`, {
    method: 'POST',
    headers: { apikey: cfg.supabase.key, Authorization: `Bearer ${cfg.supabase.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ token: cfg.supabase.token }, body)),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error('autoloop-cli : ' + (j.error || res.status));
  return j;
}

/* ---- Spacers / versions (mêmes règles que cms-autoloop-files.js) ----------- */
function refsOf(sp) {
  const a = (sp && sp.attrs) || {};
  return (a.replaces || []).map((r) => r && r.ref).concat(a.aliases || []).filter(Boolean);
}
function spLabel(sp) { const r = refsOf(sp); return sp.name + (r.length ? ' · ' + r.join(', ') : ''); }
function versionsOf(plates, spId) {
  return plates.filter((r) => String(r.spacer_id || '') === String(spId))
    .sort((a, b) => (a.sort - b.sort) || (a.created_at < b.created_at ? 1 : -1));
}
function defaultOf(plates, spId) {
  const v = versionsOf(plates, spId);
  return v.filter((r) => !r.client)[0] || v[0] || null;
}
function findSpacers(data, query) {
  const q = norm(query);
  const withFiles = data.spacers.filter((sp) => data.plates.some((p) => String(p.spacer_id) === String(sp.id)));
  const names = (sp) => [sp.name, sp.slug].concat(refsOf(sp)).concat(versionsOf(data.plates, sp.id).map((p) => p.name)).map(norm).filter(Boolean);
  const exact = withFiles.filter((sp) => names(sp).includes(q));
  if (exact.length) return exact;
  return withFiles.filter((sp) => names(sp).some((n) => n.includes(q) || (n.length >= 4 && q.includes(n))));
}

/* ---- Réglages : champs d'origine → défauts AutoLoop → plateau --------------- */
function fieldValues(C, defaults, plate) {
  const v = Object.assign({}, C.FIELD_DEFAULTS, (defaults && defaults.gcode) || {});
  const ps = plate.settings || {};
  if (ps.gcode) Object.assign(v, ps.gcode);
  return { v, savedCal: ps.gcode && ps.cal && ps.cal.flow ? ps.cal : null };
}

function verifyZ(C, text, loops, want) {
  const vals = [];
  text.replace(C.RE_ZT, (m, a, n, c) => { if (!/clear/i.test(c || '')) vals.push(+n); return m; });
  const bad = vals.filter((x) => Math.abs(x - want) > 1e-6);
  return { ok: vals.length === loops && !bad.length, count: vals.length, bad };
}

/* ---- Principal ------------------------------------------------------------ */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.list && args.pos.length < 3)) {
    console.log('Usage : node tools/autoloop-cli/autoloop.js <spacer> <loops> <imprimante> [imprimante…] [--version x] [--no-open] [--force] [--out dossier]\n' +
                '        node tools/autoloop-cli/autoloop.js --list');
    process.exit(args.help ? 0 : 1);
  }
  if (!fs.existsSync(CONFIG)) fail('config introuvable : ' + CONFIG);
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const S = loadShared(), C = S.ALCore, P = S.ALProject;
  const data = await api(cfg, { action: 'list' });

  if (args.list) {
    data.spacers.filter((sp) => data.plates.some((p) => String(p.spacer_id) === String(sp.id))).forEach((sp) => {
      const def = defaultOf(data.plates, sp.id);
      console.log(spLabel(sp));
      versionsOf(data.plates, sp.id).forEach((p) =>
        console.log('   - ' + p.name + (p.client ? ' · ' + p.client.label : '') + (p === def ? '  (défaut)' : '')));
    });
    console.log('\nImprimantes : ' + data.printers.map((p) => `${p.id} (${p.name}, ${p.state || '?'}, Z ${data.ztrim[p.id] ?? '—'})`).join(' · '));
    return;
  }

  const [query, loopsArg, ...printerArgs] = args.pos;
  const loops = parseInt(loopsArg, 10);
  if (!(loops >= C.LOOPS_MIN && loops <= 200)) fail('nombre de loops invalide : ' + loopsArg + ' (minimum ' + C.LOOPS_MIN + ')');

  // Spacer + version
  const sps = findSpacers(data, query);
  if (!sps.length) fail(`aucun plateau dans AutoLoop pour « ${query} ». Ajoute-le dans AutoLoop › Fichiers.`);
  if (sps.length > 1) fail(`« ${query} » correspond à plusieurs spacers : ${sps.map(spLabel).join(' | ')}`);
  const sp = sps[0];
  let plate = defaultOf(data.plates, sp.id);
  if (args.version) {
    const vq = norm(args.version), vs = versionsOf(data.plates, sp.id);
    plate = vs.find((p) => norm(p.name) === vq) || vs.find((p) => norm(p.name).includes(vq));
    if (!plate) fail(`version « ${args.version} » introuvable. Versions : ${vs.map((p) => p.name).join(' | ')}`);
  }

  // Imprimantes
  const printers = printerArgs.map((a) => {
    const p = data.printers.find((x) => norm(x.id) === norm(a) || norm(x.name) === norm(a));
    if (!p) fail(`imprimante « ${a} » inconnue. Connues : ${data.printers.map((x) => x.id).join(', ')}`);
    return p;
  });
  for (const p of printers) {
    if (BUSY.includes(p.state) && !args.force) fail(`${p.name} est en impression (${p.state} : ${p.file || '?'}). --force pour générer quand même.`);
    if (p.online === false) console.warn(`! ${p.name} semble hors ligne.`);
    if (p.state === 'FINISH') console.warn(`! ${p.name} a terminé « ${p.file} » : vérifier que le plateau est vide.`);
  }

  // Fichier du plateau
  const { url } = await api(cfg, { action: 'file', id: plate.id });
  const dl = await fetch(url);
  if (!dl.ok) fail('téléchargement du plateau impossible (' + dl.status + ')');
  const u8 = new Uint8Array(await dl.arrayBuffer());
  if (!P.isZip(u8)) fail('le fichier du plateau n\'est pas un .gcode.3mf');
  const project = P.read(u8);
  if (!project.plates.length) fail('le .3mf ne contient pas de plateau tranché');
  const plateName = project.plates[0].name;
  const raw = new TextDecoder('utf-8').decode(project.entries[plateName]);
  const zFile = C.ztFind(raw);
  const rawName = plate.file_name || (plate.name + '.gcode.3mf');
  const base = rawName.replace(/(\.gcode)?\.3mf$/i, '') || 'plateau';

  // Réglages + options
  const { v, savedCal } = fieldValues(C, data.defaults, plate);
  const cal = C.calFor(savedCal, loops, C.intOr(v['al-cal-flow-every'], 0), C.intOr(v['al-cal-bed-every'], 0));

  // Groupes par Z
  const groups = new Map();
  for (const p of printers) {
    const zt = data.ztrim[p.id] != null ? +data.ztrim[p.id] : zFile;
    const key = zt == null ? 'fichier' : zt.toFixed(3);
    if (!groups.has(key)) groups.set(key, { z: zt, printers: [] });
    groups.get(key).printers.push(p);
  }

  const outDir = args.out || path.join(os.homedir(), 'Downloads');
  console.log(`Spacer  : ${spLabel(sp)} — version « ${plate.name} »${plate.settings && plate.settings.gcode ? ' (réglages du plateau)' : ' (réglages par défaut d\'AutoLoop)'}`);
  const made = [];
  for (const g of groups.values()) {
    const ztrim = g.z == null || zFile == null || Math.abs(g.z - zFile) < 1e-6 ? null : g.z;
    const res = C.generateBatch(raw, C.optsFrom(v, loops, cal, ztrim));
    if (!res.report.ok) fail('génération : ' + res.report.error);
    const want = ztrim != null ? ztrim : zFile;
    if (want != null) {
      const chk = verifyZ(C, res.text, loops, want);
      if (!chk.ok) fail(`vérification du Z ratée : ${chk.count} lignes G29.1 (attendu ${loops} × ${want})`);
    }
    const r = res.report;
    const zip = await P.build(project, plateName, new TextEncoder().encode(res.text),
      { loops, predictionSec: r.progress ? r.totalMin * 60 : 0 });
    const tag = groups.size > 1 ? ' ' + g.printers.map((p) => p.name).join('+') : '';
    const file = path.join(outDir, `${base} AutoLoop x${loops}${tag}.gcode.3mf`);
    fs.writeFileSync(file, zip);
    made.push(file);
    console.log(`\n✓ ${path.basename(file)}`);
    console.log(`  Imprimantes : ${g.printers.map((p) => p.name).join(', ')}`);
    console.log(`  Z 1re couche : ${want != null ? want.toFixed(3) + ' mm' : '?'} (${ztrim != null ? 'fichier ' + zFile.toFixed(3) : 'celui du fichier'}) — vérifié sur ${loops} loops`);
    console.log(`  Durée ≈ ${r.progress ? C.fmtDur(r.totalMin) : '?'} · filament ≈ ${(r.weightPer * loops).toFixed(1)} g`);
    console.log(`  Flow : loops ${r.flow.join(', ') || 'aucun'} · bed leveling : loops ${r.bed.join(', ') || 'aucun'}`);
    console.log(`  Fichier : ${file}`);
  }

  if (args.open) {
    if (!fs.existsSync(STUDIO)) { console.warn('! Bambu Studio introuvable : ' + STUDIO); return; }
    for (const f of made) spawn(STUDIO, [f], { detached: true, stdio: 'ignore' }).unref();
    console.log('\nOuvert dans Bambu Studio (nouvelle fenêtre). Reste : Print plate → imprimante → Send.');
  }
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
