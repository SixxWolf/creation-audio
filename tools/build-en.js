#!/usr/bin/env node
/* =========================================================
   Création Audio — pages anglaises (/en/)
   ---------------------------------------------------------
   Le français reste la source : ce script relit chaque page
   publique et écrit sa copie anglaise sous en/ :
     - textes et attributs (title, alt, placeholder, aria-label,
       data-msg…, meta description / Open Graph) traduits par
       tools/i18n/pages.en.json (clé = texte français exact,
       espaces compactés) ;
     - liens : assets/ → ../assets/, /x.html → /en/x.html,
       canonical / og:url → /en/, lang="en", og:locale en_CA ;
     - assets/i18n-en.js ajouté après assets/i18n.js (textes
       des scripts : CA.t, voir assets/i18n.js) ;
     - lien [data-lang-switch] inversé (EN → FR).
   Texte sans traduction : le français reste, et la clé est
   listée dans tools/i18n/missing.json (à traduire puis relancer).
   spacers.html et spacer/*.html : faits par build-spacer-pages.js
   (qui se sert de translatePage ci-dessous).
   Lancé par .github/workflows/spacer-pages.yml ou à la main :
     node tools/build-en.js
   ========================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://creationaudio.ca/';
const PAGES = ['index.html', 'boutique.html', 'compte.html', 'dealer.html', 'aide.html',
  'conditions.html', 'confidentialite.html', 'retours.html', '404.html', 'revendeur.html'];
const DICT_FILE = path.join(ROOT, 'tools/i18n/pages.en.json');
const MISSING_FILE = path.join(ROOT, 'tools/i18n/missing.json');

let DICT = null;
const missing = new Set();
function dict() {
  if (!DICT) DICT = JSON.parse(fs.readFileSync(DICT_FILE, 'utf8'));
  return DICT;
}
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const hasWords = (s) => /[A-Za-zÀ-ÿ]{2,}/.test(s.replace(/&[a-z]+;|&#\d+;/gi, ''));

// texte (HTML brut, entités comprises) → anglais ; espaces de bord conservés
function tx(raw) {
  const key = norm(raw);
  if (!key || !hasWords(key)) return raw;
  const d = dict();
  if (!(key in d)) { missing.add(key); return raw; }
  const en = d[key] == null ? key : d[key];
  const lead = /^\s*/.exec(raw)[0], trail = /\s*$/.exec(raw)[0];
  return lead + en + trail;
}

const TX_ATTRS = new Set(['title', 'alt', 'placeholder', 'aria-label', 'data-msg', 'data-msg-body', 'data-msg-ref', 'data-label', 'data-empty']);
const TX_META = /^(description|og:title|og:description|twitter:title|twitter:description)$/;

function relPath(v, depth) {
  // depth : nombre de dossiers sous la racine pour la page anglaise (en/ = 1, en/spacer/ = 2)
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(v)) return v;
  if (v.charAt(0) === '/') {
    if (/^\/(?:assets|Image)\//.test(v) || /^\/en(\/|$)/.test(v)) return v;
    return '/en' + v;
  }
  // relatif : les pages restent voisines (en/), les fichiers du site remontent d'un cran

  let p = v, dots = '';
  while (p.indexOf('../') === 0) { dots += '../'; p = p.slice(3); }
  if (/^(?:assets|Image)\//.test(p)) return dots + '../' + p;
  return v;
}

function tagAttrs(tag, depth, ctx) {
  const name = (/^<\s*([a-z0-9-]+)/i.exec(tag) || [])[1];
  if (!name) return tag;
  const lname = name.toLowerCase();
  let metaKey = null;
  if (lname === 'meta') {
    const m = /\s(?:name|property)="([^"]*)"/i.exec(tag);
    metaKey = m && m[1];
  }
  return tag.replace(/(\s)([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g, (m, sp, a, v) => {
    const la = a.toLowerCase();
    if (lname === 'html' && la === 'lang') return sp + a + '="en"';
    if (la === 'content' && metaKey) {
      if (TX_META.test(metaKey)) return sp + a + '="' + tx(v) + '"';
      if (metaKey === 'og:locale') return sp + a + '="en_CA"';
      if (metaKey === 'og:url') return sp + a + '="' + toEnUrl(v) + '"';
      return m;
    }
    if (la === 'href' && /\srel="canonical"/i.test(tag)) return sp + a + '="' + toEnUrl(v) + '"';
    if (la === 'href' && /\shreflang=/i.test(tag)) return m;          // alternates : absolus, identiques dans les deux langues
    if (la === 'href' || la === 'src' || la === 'action' || la === 'poster') return sp + a + '="' + relPath(v, depth) + '"';
    if (la === 'srcset') return sp + a + '="' + v.split(',').map((s) => s.trim().replace(/^\S+/, (u) => relPath(u, depth))).join(', ') + '"';
    if (TX_ATTRS.has(la) && !(la === 'data-msg-ref' && !hasWords(v))) return sp + a + '="' + tx(v) + '"';
    if (la === 'value' && lname === 'input' && /\stype="(?:submit|button|reset)"/i.test(tag)) return sp + a + '="' + tx(v) + '"';
    return m;
  });
}
function toEnUrl(u) {
  if (u.indexOf(SITE) !== 0 || u.indexOf(SITE + 'en/') === 0) return u;
  return SITE + 'en/' + u.slice(SITE.length);
}

// JSON-LD : chaînes traduites si le dictionnaire les connaît, URL du site → /en/
function jsonLd(src) {
  let o;
  try { o = JSON.parse(src); } catch (e) { return src; }
  const walk = (x, k) => {
    if (typeof x === 'string') {
      if (/^https:\/\/creationaudio\.ca\//.test(x) && /(?:url|@id|item)$/i.test(k || '')) return toEnUrl(x);
      const key = norm(x);
      return hasWords(key) && key in dict() ? (dict()[key] == null ? x : dict()[key]) : x;
    }
    if (Array.isArray(x)) return x.map((y) => walk(y, k));
    if (x && typeof x === 'object') { const r = {}; for (const kk in x) r[kk] = kk === 'inLanguage' ? 'en-CA' : walk(x[kk], kk); return r; }
    return x;
  };
  return JSON.stringify(walk(o)).replace(/</g, '\\u003c');
}

const I18N_EN_V = (() => {
  try { return (/CA_EN_V\s*=\s*(\d+)/.exec(fs.readFileSync(path.join(ROOT, 'assets/i18n-en.js'), 'utf8')) || [])[1] || '1'; }
  catch (e) { return '1'; }
})();

/* html : page française ; rel : chemin de la page FR depuis la racine (ex. « boutique.html », « spacer/x.html ») */
function translatePage(html, rel) {
  const depth = rel.split('/').length;               // en/x.html → 1 ; en/spacer/x.html → 2
  const out = [];
  const re = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<[^>]+>/gi;
  let last = 0, m;
  while ((m = re.exec(html))) {
    if (m.index > last) out.push(tx(html.slice(last, m.index)));
    const tok = m[0];
    if (tok.indexOf('<!--') === 0) out.push(tok);
    else if (/^<script/i.test(tok)) {
      const open = /^<script\b[^>]*>/i.exec(tok)[0];
      const body = tok.slice(open.length, tok.length - (/<\/script\s*>$/i.exec(tok)[0].length));
      const close = tok.slice(open.length + body.length);
      let nb = body;
      if (/type="application\/ld\+json"/i.test(open)) nb = jsonLd(body);
      out.push(tagAttrs(open, depth) + nb + close);
      if (/\ssrc="[^"]*assets\/i18n\.js[^"]*"/i.test(open)) {
        const base = /\ssrc="([^"]*?)i18n\.js/i.exec(tagAttrs(open, depth))[1];
        out.push('\n<script src="' + base + 'i18n-en.js?v=' + I18N_EN_V + '"></script>');
      }
    } else if (/^<style/i.test(tok)) out.push(tok);
    else out.push(tagAttrs(tok, depth));
    last = re.lastIndex;
  }
  if (last < html.length) out.push(tx(html.slice(last)));
  let res = out.join('');
  // lien de langue : sur la page anglaise, il ramène au français
  const frHref = rel === '404.html' ? '/' : '../'.repeat(depth) + (rel === 'index.html' ? '' : rel);
  res = res.replace(/<a\b([^>]*)\sdata-lang-switch="en"([^>]*)>([\s\S]*?)<\/a>/gi, (mm, a, b, inner) => {
    const at = (a + b).replace(/\shref="[^"]*"/, '').replace(/\shreflang="en"/, ' hreflang="fr"')
      .replace(/\slang="en"/, ' lang="fr"').replace(/\stitle="[^"]*"/, ' title="Version française"');
    return '<a href="' + frHref + '"' + at + ' data-lang-switch="fr">' +
      inner.replace(/\bEN\b/, 'FR').replace(/English/, 'Français') + '</a>';
  });
  return res;
}

function writeIfChanged(f, s) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === s) return false;
  fs.writeFileSync(f, s);
  return true;
}
function reportMissing(tag) {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(MISSING_FILE, 'utf8')); } catch (e) {}
  const all = {};
  // on garde les clés déjà listées par l'autre script (pages ou spacers), sauf celles traduites depuis
  Object.keys(prev).forEach((k) => { if (!(k in dict())) all[k] = prev[k]; });
  missing.forEach((k) => { all[k] = all[k] || tag; });
  const keys = Object.keys(all);
  if (!keys.length) { if (fs.existsSync(MISSING_FILE)) fs.unlinkSync(MISSING_FILE); return 0; }
  fs.writeFileSync(MISSING_FILE, JSON.stringify(all, null, 1) + '\n');
  return missing.size;
}

if (require.main === module) {
  let n = 0;
  PAGES.forEach((p) => {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
    if (writeIfChanged(path.join(ROOT, 'en', p), translatePage(src, p))) { n++; console.log('en/' + p); }
  });
  const miss = reportMissing('pages');
  console.log(n + ' page(s) écrite(s)' + (miss ? ' · ' + miss + ' texte(s) sans traduction → tools/i18n/missing.json' : ''));
}

module.exports = { translatePage, reportMissing, writeIfChanged, toEnUrl, tx };
