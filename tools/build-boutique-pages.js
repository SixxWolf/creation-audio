#!/usr/bin/env node
/* =========================================================
   Pages de rayon de la boutique (2026-11-14)
   Source unique : boutique/filaments.html (le script boutique.js
   sert les trois pages, selon <body data-shop="…">).
   Ce script en tire :
     boutique/accessoires.html  (data-shop="accessoires")
     boutique/promotions.html   (data-shop="promotions")
     boutique/packs.html        (data-shop="packs", 2026-11-16)
   → ne jamais éditer ces deux fichiers à la main : modifier
   boutique/filaments.html puis lancer « node tools/build-en.js »
   (qui appelle ce script avant de traduire).
   Exporte aussi tabs() : la barre des rayons
   (⌂ · Filaments · Packs · Spacers · Accessoires · Imprimantes 3D · Promotions).
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const HOME_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 11.2 12 4.5l8 6.7"/><path d="M6.2 9.6V19.5h11.6V9.6"/><path d="M10 19.5v-5h4v5"/></svg>';

/* cur = onglet actif ; pre = chemin vers le dossier boutique/ (« ../boutique/ », « boutique/ ») ; ind = retrait */
function tabs(cur, pre, ind) {
  const T = [
    ['home', pre.replace(/\/$/, ''), HOME_IC],
    ['filaments', pre + 'filaments', 'Filaments'],
    ['packs', pre + 'packs', 'Packs'],
    ['spacers', pre + 'spacers', 'Spacers'],
    ['accessoires', pre + 'accessoires', 'Accessoires'],
    ['imprimantes', pre + 'imprimantes', 'Imprimantes 3D'],
    ['promo', pre + 'promotions', 'Promotions']
  ];
  return ind + '<nav class="shop-tabs" id="shop-tabs" aria-label="Rayons de la boutique">\n' + T.map(([k, h, l]) => {
    const on = cur === k;
    const cls = k === 'home' ? ' class="shop-tab-home' + (on ? ' is-active' : '') + '" aria-label="Accueil de la boutique" title="Accueil de la boutique"'
      : on ? ' class="is-active"' : '';
        // Packs : caché tant qu'aucun pack n'est en ligne (boutique.js le montre)
    return ind + '  <a href="' + h + '" data-tab="' + k + '"' + cls + (on ? ' aria-current="page"' : '') + (k === 'packs' && !on ? ' hidden' : '') + '>' + l + '</a>';
  }).join('\n') + '\n' + ind + '</nav>';
}

const PAGES = {
  accessoires: {
    tab: 'accessoires', screen: 'screen-accs',
    title: 'Création Audio — Accessoires',
    desc: 'Bobines vides réutilisables et accessoires d\'impression 3D — Création Audio, région de Québec.'
  },
  promotions: {
    tab: 'promo', screen: 'screen-promo',
    title: 'Création Audio — Promotions',
    desc: 'Filaments, accessoires et spacers en rabais — Création Audio, région de Québec.'
  },
  packs: {
    tab: 'packs', screen: 'screen-packs',
    title: 'Création Audio — Packs',
    desc: 'Packs de recharges de filament à prix réduit, à composer par paires — Création Audio, région de Québec.'
  }
};

function must(s, a) { if (!s.includes(a)) throw new Error('build-boutique-pages : introuvable dans filaments.html → ' + a); }

function build(src, name) {
  const P = PAGES[name];
  let h = src.replace(/\r\n/g, '\n');
  const TITLE = '<title>Création Audio — Filaments</title>', DESC = 'Filaments d\'impression 3D — Création Audio, région de Québec.';
  [TITLE, 'content="Création Audio — Filaments"', DESC, 'data-shop="filaments"', '<section id="screen-catalog" '].forEach((a) => must(h, a));
  h = h.replace(TITLE, '<title>' + P.title + '</title>')
    .split('content="Création Audio — Filaments"').join('content="' + P.title + '"')
    .split(DESC).join(P.desc)
    // canonical, hreflang, og:url, lien vers la version anglaise
    .split('creationaudio.ca/boutique/filaments"').join('creationaudio.ca/boutique/' + name + '"')
    .split('creationaudio.ca/en/boutique/filaments"').join('creationaudio.ca/en/boutique/' + name + '"')
    .split('href="../en/boutique/filaments"').join('href="../en/boutique/' + name + '"')
    .replace('data-shop="filaments"', 'data-shop="' + name + '"');
  // lien actif du menu déroulant et du tiroir
  h = h.replace(/<div class="(nav-dd-m|drawer-sub)">[\s\S]*?<\/div>/g, (blk) => blk
    .replace(/ class="is-active"/g, '')
    .replace(new RegExp('<a href="\.\./boutique/' + name + '"([^>]*)>'), '<a href="../boutique/' + name + '" class="is-active"$1>'));
  // barre des rayons
  h = h.replace(/  <nav class="shop-tabs" id="shop-tabs"[\s\S]*?<\/nav>/, tabs(P.tab, '../boutique/', '  '));
  // écran visible au chargement
  h = h.replace('<section id="screen-catalog" ', '<section id="screen-catalog" hidden ')
    .replace(new RegExp('(<section id="' + P.screen + '"[^>]*?) hidden>'), '$1>');
  return h;
}

function run() {
  const src = fs.readFileSync(path.join(ROOT, 'boutique/filaments.html'), 'utf8');
  const crlf = src.includes('\r\n');
  let n = 0;
  Object.keys(PAGES).forEach((name) => {
    let out = build(src, name);
    if (crlf) out = out.replace(/\n/g, '\r\n');
    const f = path.join(ROOT, 'boutique', name + '.html');
    if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === out) return;
    fs.writeFileSync(f, out); n++;
    console.log('boutique/' + name + '.html');
  });
  return n;
}

if (require.main === module) console.log(run() + ' page(s) de rayon écrite(s)');
module.exports = { run, tabs };
