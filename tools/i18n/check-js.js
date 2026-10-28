#!/usr/bin/env node
/* =========================================================
   Création Audio — textes des scripts publics sans traduction
   Relève les clés _t('…'), plural(n, '…', '…') et tn(n, '…', '…')
   des modules publics et liste celles absentes d'assets/i18n-en.js
   (window.CA_EN). Sortie : tools/i18n/missing-js.json (clé → fichier).
     node tools/i18n/check-js.js
   Clés devenues inutiles : listées à part (--unused).
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const FILES = ['nav.js', 'accueil.js', 'boutique.js', 'commande-client.js', 'spacer-catalog.js', 'spacers.js',
  'dealer.js', 'doc-print.js', 'auth-gate.js', 'compte.js', 'messagerie.js', 'dialog.js', 'aide.js', 'aide-public.js', 'fetes.js', 'look.js', 'revendeur.js']
  .map((f) => 'assets/' + f);

const STR = `'(?:[^'\\\\\\n]|\\\\.)*'`;
const RE_T = new RegExp(`(?<![\\w.$])_t\\(\\s*(${STR})`, 'g');
const RE_PL = new RegExp(`(?:plural|tn)\\([^,()]+(?:\\([^()]*\\))?[^,()]*,\\s*(${STR})\\s*,\\s*(${STR})`, 'g');
const lit = (s) => Function('return ' + s)();

function keysOf(src) {
  const out = new Set();
  let m;
  while ((m = RE_T.exec(src))) out.add(lit(m[1]));
  while ((m = RE_PL.exec(src))) { out.add(lit(m[1])); out.add(lit(m[2])); }
  return out;
}
function dict() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/i18n-en.js'), 'utf8'), ctx);
  return ctx.window.CA_EN || {};
}

const D = dict(), used = new Set(), miss = {};
FILES.forEach((f) => {
  keysOf(fs.readFileSync(path.join(ROOT, f), 'utf8')).forEach((k) => {
    used.add(k);
    if (!(k in D)) miss[k] = miss[k] ? miss[k] + ', ' + path.basename(f) : path.basename(f);
  });
});
const out = path.join(ROOT, 'tools/i18n/missing-js.json');
const n = Object.keys(miss).length;
if (n) fs.writeFileSync(out, JSON.stringify(miss, null, 1) + '\n');
else if (fs.existsSync(out)) fs.unlinkSync(out);
console.log(used.size + ' clé(s) · ' + n + ' sans traduction' + (n ? ' → tools/i18n/missing-js.json' : ''));
if (process.argv.includes('--unused')) {
  const extra = Object.keys(D).filter((k) => !used.has(k));
  console.log(extra.length + ' clé(s) inutilisée(s) dans i18n-en.js (certaines servent aux erreurs du serveur)');
  extra.forEach((k) => console.log('  ' + k.slice(0, 100)));
}
