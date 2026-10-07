#!/usr/bin/env node
/* =========================================================
   Création Audio — vraies pages des spacers (référencement)
   ---------------------------------------------------------
   Google ignore tout ce qui suit le « # » : les fiches
   spacers.html#/s/<slug> ne forment qu'UNE page pour lui.
   Ce script écrit une vraie page par spacer actif :
     - spacer/<slug>.html : titre, description, Open Graph
       (aperçu Messenger/Facebook), données produit JSON-LD et
       la fiche déjà rendue (même HTML que spacer-catalog.js) ;
       spacers.js reprend la main au chargement (prix/stock live).
     - spacers.html : catalogue pré-rendu (liens vers les pages)
       + window.CA_SPACER_PAGES + liste JSON-LD, entre les
       repères <!-- spacers:head --> et <!-- spacers:list -->.
     - sitemap.xml : une URL par page (repère spacers:urls).
   Pages des spacers retirés/masqués : supprimées (la 404
   renvoie vers le catalogue). N'écrit que ce qui a changé.
   Lancé par .github/workflows/spacer-pages.yml (aux 6 h et à
   la demande) ou à la main : node tools/build-spacer-pages.js
   Lecture seule côté base (vue products_public, clé publique).
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://creationaudio.ca/';
const DIR = 'spacer';
const OG_DEFAULT = SITE + 'assets/img/og-creation-audio.png';
const SLUG_OK = /^[a-z0-9][a-z0-9-]*$/;   // nom de fichier sûr ; sinon la fiche reste sur spacers.html#/s/…

const file = (f) => path.join(ROOT, f);
const read = (f) => fs.readFileSync(file(f), 'utf8');
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const jsonLd = (o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';

/* ---------- données ---------- */
function supaConfig() {
  const src = read('assets/supabase-config.js');
  const url = /url:\s*'([^']+)'/.exec(src), key = /anonKey:\s*'([^']+)'/.exec(src);
  if (!url || !key) throw new Error('assets/supabase-config.js : url / anonKey introuvables');
  return { url: url[1].replace(/\/+$/, ''), key: key[1] };
}
async function fetchSpacers(c) {
  // même requête et même ordre que spacers.js
  const u = c.url + '/rest/v1/products_public?select=*&type=eq.spacer&order=sort_order.asc,name.asc';
  const res = await fetch(u, { headers: { apikey: c.key, Accept: 'application/json' } });
  if (!res.ok) throw new Error('Supabase ' + res.status + ' : ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Supabase : réponse inattendue');
  return data;
}

/* ---------- rendu : on exécute spacer-catalog.js tel quel ---------- */
function loadCatalog() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(read('assets/spacer-catalog.js'), ctx, { filename: 'assets/spacer-catalog.js' });
  if (!ctx.window.CASpacers) throw new Error('spacer-catalog.js : window.CASpacers absent');
  return ctx.window.CASpacers;
}
// même URL publique que supabase-js (storage.from(b).getPublicUrl(p))
function fakeSb(c) {
  return { storage: { from: (b) => ({ getPublicUrl: (p) => ({ data: { publicUrl: encodeURI(c.url + '/storage/v1/object/public/' + b + '/' + p) } }) }) } };
}
function renderer(CAS, c, items, pages, onPage) {
  const PUB = CAS.PUBLIC, stub = {};
  const sc = CAS.create({
    sb: fakeSb(c), mode: 'public', staticRender: true,
    catalogEl: stub, listEl: stub, productEl: stub,
    addLabel: PUB.addLabel, assureHtml: PUB.assureHtml, emptyHint: PUB.emptyHint,
    // le stock exact bouge à chaque vente : la page statique n'en dépend pas (le JS remet le vrai)
    maxQty: (p) => ((p.qty | 0) > 0 ? 1 : 0),
    // même règle que pageHref() dans spacers.js
    pageHref: (s) => (pages.has(s) ? (onPage ? '' : DIR + '/') + s + '.html' : (onPage ? '../spacers.html#/s/' + encodeURIComponent(s) : null)),
    rootHref: onPage ? '../spacers.html' : '#/'
  });
  sc.setItems(items);
  return sc;
}

/* ---------- textes de référencement ---------- */
function makesOf(CAS, p) {
  const seen = new Map();
  CAS.fitmentOf(p).forEach((r) => {
    if (!r.make) return;
    if (!seen.has(r.make)) seen.set(r.make, []);
    if (r.model && seen.get(r.make).indexOf(r.model) === -1) seen.get(r.make).push(r.model);
  });
  return [...seen.entries()].map(([make, models]) => ({ make, models })).sort((a, b) => b.models.length - a.models.length);
}
const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function seoTexts(CAS, p) {
  const size = CAS.sizeOf(p), makes = makesOf(CAS, p), refs = CAS.replacesOf(p).map(CAS.refLabel);
  const makeNames = makes.slice(0, 3).map((m) => m.make);
  // spacer fait pour un haut-parleur (AP 5, APX 4…) : on nomme les haut-parleurs confirmés
  const spk = CAS.speakersOf(p).filter((x) => x.ok).map((x) => x.model);
  const head = 'Spacer' + (size ? ' ' + size : '') +
    (makeNames.length ? ' ' + makeNames.join(' / ') : (spk.length ? ' pour ' + spk.slice(0, 2).join(' / ') : ''));
  // le code n'est répété que s'il diffère de la pièce remplacée (spacer pas encore renommé)
  const codeIsRef = CAS.replacesOf(p).some((x) => flat(x.ref) === flat(p.name));
  const title = head + (refs.length ? ' – remplace ' + refs.join(', ') : '') + (codeIsRef ? '' : ' | ' + p.name) + ' · Création Audio';
  const vehicles = makes.slice(0, 3).map((m) => m.make + (m.models.length ? ' (' + m.models.slice(0, 3).join(', ') + (m.models.length > 3 ? '…' : '') + ')' : ''));
  const summary = String((p.attrs && p.attrs.description) || '').replace(/\s+/g, ' ').trim();
  let desc = 'Spacer de haut-parleur' + (size ? ' ' + size : '') + ' imprimé 3D' +
    (vehicles.length ? ' pour ' + vehicles.join(', ')
      : spk.length ? ', ajustement confirmé avec ' + spk.join(', ')
      : (summary ? ' — ' + summary : '')) + '.' +
    (refs.length ? ' Remplace la pièce ' + refs.join(', ') + '.' : ' Conception Création Audio.') +
    ' Vendu par paire, ramassage à Québec.';
  if (desc.length > 300) desc = desc.slice(0, 297).replace(/\s+\S*$/, '') + '…';
  return { title, desc, size, makes, refs };
}

/* ---------- gabarit ---------- */
function block(html, name, inner) {
  const re = new RegExp('(<!-- ' + name + '\\b[^>]*-->)[\\s\\S]*?([ \\t]*<!-- /' + name + ' -->)');
  if (!re.test(html)) throw new Error('repère <!-- ' + name + ' --> introuvable');
  return html.replace(re, (m, a, b) => a + (inner ? '\n' + inner + '\n' : '') + b);
}
function setAttrOf(html, selector, attr, value) {
  // <meta name="description" content="…"> / <meta property="og:title" content="…"> / <link rel="canonical" href="…">
  const re = new RegExp('(<(?:meta|link) ' + selector + ' ' + attr + '=")[^"]*(")');
  if (!re.test(html)) throw new Error('balise ' + selector + ' introuvable');
  return html.replace(re, (m, a, b) => a + esc(value) + b);
}
// les liens relatifs de spacers.html, vus depuis spacer/<slug>.html
function relink(html) {
  return html.replace(/\b(href|src)="([^"]*)"/g, (m, a, v) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#|\.\.\/)/i.test(v)) return m;
    return a + '="../' + (v.indexOf('./') === 0 ? v.slice(2) : v) + '"';
  });
}

function pageHtml(tpl, CAS, c, sc, p, slug, pagesList) {
  const t = seoTexts(CAS, p), url = SITE + DIR + '/' + slug + '.html';
  const imgs = [p.image_path].concat(p.attrs && Array.isArray(p.attrs.gallery) ? p.attrs.gallery : [])
    .filter((x) => typeof x === 'string' && x).map((x) => fakeSb(c).storage.from('products').getPublicUrl(x).data.publicUrl);
  const price = +p.sell_price;
  const product = {
    '@type': 'Product', name: t.title.replace(/ · Création Audio$/, ''), sku: p.name, mpn: p.name,
    brand: { '@type': 'Brand', name: 'Création Audio' },
    category: 'Adaptateur de haut-parleur', url,
    description: String((p.attrs && p.attrs.long_desc) || '').replace(/\s+/g, ' ').trim() || t.desc
  };
  if (imgs.length) product.image = imgs;
  if (price > 0) {
    product.offers = {
      '@type': 'Offer', url, priceCurrency: 'CAD', price: price.toFixed(2),
      availability: (p.qty | 0) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'Création Audio' }
    };
  }
  const crumbs = {
    '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Accueil', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Spacers', item: SITE + 'spacers.html' },
      { '@type': 'ListItem', position: 3, name: p.name, item: url }
    ]
  };

  let h = relink(tpl);
  h = h.replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(t.title) + '</title>');
  h = setAttrOf(h, 'name="description"', 'content', t.desc);
  h = setAttrOf(h, 'rel="canonical"', 'href', url);
  h = setAttrOf(h, 'property="og:type"', 'content', 'product');
  h = setAttrOf(h, 'property="og:url"', 'content', url);
  h = setAttrOf(h, 'property="og:title"', 'content', t.title);
  h = setAttrOf(h, 'property="og:description"', 'content', t.desc);
  h = setAttrOf(h, 'property="og:image"', 'content', imgs[0] || OG_DEFAULT);
  h = setAttrOf(h, 'name="twitter:image"', 'content', imgs[0] || OG_DEFAULT);
  h = block(h, 'spacers:head',
    '<script>window.CA_SPACER_PAGES=' + JSON.stringify(pagesList) + ';</script>\n' +
    jsonLd({ '@context': 'https://schema.org', '@graph': [product, crumbs] }));
  h = h.replace(/<body class="([^"]*)">/, (m, cls) => '<body class="' + cls + '" data-spacer="' + esc(slug) + '">');
  h = h.replace(/<main class="shop" id="main">[\s\S]*?<\/main>/, () =>
    '<main class="shop" id="main">\n' +
    '  <!-- Fiche pré-rendue (tools/build-spacer-pages.js) ; spacers.js la remplace par la version live -->\n' +
    '  <div id="sp-catalog" hidden><div id="sp-list"></div></div>\n' +
    '  <div id="sp-product">' + sc.staticProduct(slug) + '</div>\n' +
    '</main>');
  return h;
}

function catalogHead(CAS, items, slugOf, pagesList) {
  const list = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: 'Spacers et adaptateurs de haut-parleurs — Création Audio',
    itemListElement: items.filter((p) => pagesList.indexOf(slugOf(p)) !== -1).map((p, i) => ({
      '@type': 'ListItem', position: i + 1, url: SITE + DIR + '/' + slugOf(p) + '.html', name: p.name
    }))
  };
  return '<script>window.CA_SPACER_PAGES=' + JSON.stringify(pagesList) + ';</script>\n' + jsonLd(list);
}
function catalogDesc(CAS, items) {
  const count = new Map(), brands = new Set();
  items.forEach((p) => {
    makesOf(CAS, p).forEach((m) => count.set(m.make, (count.get(m.make) || 0) + 1));
    CAS.replacesOf(p).forEach((x) => { if (x.brand) brands.add(x.brand); });
  });
  const makes = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, 6).map((x) => x[0]);
  const b = [...brands].sort((x, y) => x.localeCompare(y, 'fr'));
  const bTxt = b.length > 1 ? b.slice(0, -1).join(', ') + ' et ' + b[b.length - 1] : b[0];
  return 'Spacers et adaptateurs de haut-parleurs imprimés 3D' + (makes.length ? ' pour ' + makes.join(', ') + ' et plus' : '') +
    (bTxt ? ', en remplacement des pièces ' + bTxt : '') + '. Vendus par paire, ramassage à Québec.';
}

/* ---------- sitemap ---------- */
function sitemapUrls(old, pages, changed, today) {
  const prev = {};
  const re = /<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
  let m;
  while ((m = re.exec(old))) prev[m[1]] = m[2];
  return pages.map((s) => {
    const loc = SITE + DIR + '/' + s + '.html';
    const lastmod = changed.has(s) || !prev[loc] ? today : prev[loc];
    return '  <url>\n    <loc>' + loc + '</loc>\n    <lastmod>' + lastmod + '</lastmod>\n' +
      '    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>';
  }).join('\n');
}

/* ---------- écriture (seulement si le contenu change) ---------- */
const written = [], removed = [];
function writeIfChanged(rel, html) {
  const f = file(rel);
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === html) return false;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
  written.push(rel);
  return true;
}

async function main() {
  const allowEmpty = process.argv.indexOf('--allow-empty') !== -1;
  const c = supaConfig();
  const items = await fetchSpacers(c);
  const dir = file(DIR);
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.html$/.test(f)) : [];
  // garde-fou : une base injoignable ou une vue vide ne doit jamais effacer toutes les pages
  if (!items.length && existing.length && !allowEmpty) throw new Error('0 spacer reçu alors que ' + existing.length + ' pages existent — arrêt (--allow-empty pour forcer)');

  const CAS = loadCatalog();
  const probe = renderer(CAS, c, items, new Set(), false);
  const slugOf = (p) => probe.slugOf(p);
  const pagesList = items.map(slugOf).filter((s) => SLUG_OK.test(s));
  const pages = new Set(pagesList);
  const today = new Date().toISOString().slice(0, 10);

  // 1) une page par spacer
  const tpl = read('spacers.html');
  const onPage = renderer(CAS, c, items, pages, true);
  const changed = new Set();
  items.forEach((p) => {
    const s = slugOf(p);
    if (!pages.has(s)) { console.warn('  ! slug non publiable « ' + s + ' » (' + p.name + ') : fiche laissée sur spacers.html#/s/'); return; }
    if (writeIfChanged(DIR + '/' + s + '.html', pageHtml(tpl, CAS, c, onPage, p, s, pagesList))) changed.add(s);
  });
  existing.forEach((f) => {
    const s = f.replace(/\.html$/, '');
    if (pages.has(s)) return;
    const rel = DIR + '/' + f;
    if (read(rel).indexOf('data-spacer="') === -1) return;   // pas une page générée : on n'y touche pas
    fs.unlinkSync(file(rel)); removed.push(rel);
  });

  // 2) catalogue pré-rendu + liste des pages publiées
  const onCatalog = renderer(CAS, c, items, pages, false);
  let cat = block(tpl, 'spacers:head', catalogHead(CAS, items, slugOf, pagesList));
  cat = block(cat, 'spacers:list', onCatalog.staticCatalog());
  if (items.length) {
    const d = catalogDesc(CAS, items);
    cat = setAttrOf(cat, 'name="description"', 'content', d);
    cat = setAttrOf(cat, 'property="og:description"', 'content', d);
  }
  writeIfChanged('spacers.html', cat);

  // 3) sitemap
  const sm = read('sitemap.xml');
  writeIfChanged('sitemap.xml', block(sm, 'spacers:urls', sitemapUrls(sm, pagesList, changed, today)));

  console.log(items.length + ' spacers · ' + pagesList.length + ' pages · ' +
    (written.length ? 'écrit : ' + written.join(', ') : 'rien de changé') +
    (removed.length ? ' · supprimé : ' + removed.join(', ') : ''));
}

main().catch((e) => { console.error('Échec : ' + (e && e.message ? e.message : e)); process.exit(1); });
