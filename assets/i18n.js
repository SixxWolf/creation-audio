/* =========================================================
   Création Audio — langue du site public (FR / EN)
   - Les pages anglaises sont de vraies pages sous /en/ (lang="en"),
     écrites par tools/build-en.js à partir des pages françaises.
   - CA.t('texte français', { n: 3 }) : le français sert de clé ; sur une
     page anglaise on prend la traduction de window.CA_EN (assets/i18n-en.js,
     chargé seulement par les pages /en/). Clé absente → le français reste
     (et la clé est notée dans CA.i18nMissing pour la retrouver).
   - CA.money(n) : 12,99 $ (FR) · $12.99 (EN) ; CA.locale pour les dates.
   - CA.tr(row, 'champ') : texte venu de la base, traduit en coulisse dans
     attrs.en (fonction Supabase « translate ») ; sinon le français.
   - CA.langHref(lang) : la même page dans l'autre langue (hash conservé).
   - Lien [data-lang-switch] (en-tête) + bandeau « Available in English »
     quand le navigateur est en anglais (jamais de redirection).
   Chargé en premier par toutes les pages publiques (et par l'admin pour
   les modules partagés : il y reste en français).
   ========================================================= */
(function (root) {
  'use strict';
  var w = root.window || root;
  var CA = w.CA = w.CA || {};
  var doc = w.document;
  var lang = w.CA_LANG || (doc && /^en/i.test(doc.documentElement.lang || '') ? 'en' : 'fr');
  CA.lang = lang;
  CA.locale = lang === 'en' ? 'en-CA' : 'fr-CA';
  var missing = CA.i18nMissing = CA.i18nMissing || {};

  function fill(s, v) {
    return v ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : v[k]; }) : s;
  }
  CA.t = function (fr, v) {
    if (lang !== 'en') return fill(fr, v);
    var d = w.CA_EN || {}, en = d[fr];
    if (en == null) { missing[fr] = 1; en = fr; }
    return fill(en, v);
  };
  // n = 1 → forme singulière (la clé reste le français)
  CA.tn = function (n, one, many, v) {
    v = v || {}; v.n = n;
    return CA.t(Math.abs(n) >= 2 ? many : one, v);
  };
  CA.money = function (n) {
    var x = (Math.round((+n || 0) * 100) / 100).toFixed(2);
    if (lang !== 'en') return x.replace('.', ',') + ' $';
    var neg = x.charAt(0) === '-'; if (neg) x = x.slice(1);
    return (neg ? '-' : '') + '$' + x.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  // prix court : 18 $ / $18 (entier) sinon comme CA.money
  CA.priceShort = function (n) {
    n = +n || 0;
    if (n % 1) return CA.money(n);
    return lang === 'en' ? '$' + n : n + ' $';
  };
  CA.tr = function (row, field) {
    if (!row) return '';
    var a = row.attrs || {};
    var fr = field in row ? row[field] : a[field];
    if (lang === 'en') {
      var en = (row.en && row.en[field]) || (a.en && a.en[field]);
      if (en != null && en !== '') return en;
    }
    return fr == null ? '' : fr;
  };
  // matériau d'un produit de products_public (material_desc, material_long_desc… + material_en)
  CA.trm = function (p, field) {
    var fr = p ? (field === 'description' ? p.material_desc : p['material_' + field]) : '';
    if (lang === 'en' && p && p.material_en && p.material_en[field]) return p.material_en[field];
    return fr == null ? '' : fr;
  };
  // texte court traduit en coulisse (specs, positions) : en.s / material_en.s
  CA.trs = function (row, s, mat) {
    if (lang !== 'en' || !row || s == null) return s;
    var e = mat ? row.material_en : (row.en || (row.attrs && row.attrs.en));
    return (e && e.s && e.s[s]) || s;
  };

  /* ---- même page dans l'autre langue ---- */
  CA.langHref = function (to) {
    if (!doc) return '';
    var p = w.location.pathname, isEn = /^\/en(\/|$)/.test(p);
    if (to === 'en' && !isEn) p = '/en' + (p === '/' ? '/' : p);
    else if (to === 'fr' && isEn) p = p.replace(/^\/en/, '') || '/';
    return p + w.location.search + w.location.hash;
  };
  if (!doc) return;
  var KEY = 'ca-lang';
  function remember(l) { try { localStorage.setItem(KEY, l); } catch (e) {} }

  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-lang-switch]');
    if (!a) return;
    var to = a.getAttribute('data-lang-switch');
    remember(to);
    e.preventDefault();
    w.location.href = CA.langHref(to);
  });

  function ready() {
    // le hash change (boutique, compte…) : le lien garde la bonne fiche
    function sync() {
      Array.prototype.forEach.call(doc.querySelectorAll('[data-lang-switch]'), function (a) {
        a.setAttribute('href', CA.langHref(a.getAttribute('data-lang-switch')));
      });
    }
    sync(); w.addEventListener('hashchange', sync);

    // bandeau : page française, navigateur en anglais, jamais choisi le français
    var pref = null;
    try { pref = localStorage.getItem(KEY); } catch (e) {}
    var nav = (w.navigator.languages && w.navigator.languages[0]) || w.navigator.language || '';
    if (lang !== 'fr' || pref || !/^en/i.test(nav) || !doc.querySelector('[data-lang-switch="en"]')) return;
    var bar = doc.createElement('div');
    bar.className = 'lang-hint'; bar.setAttribute('lang', 'en'); bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Language');
    bar.innerHTML = '<span>This page is available in English.</span>' +
      '<a href="' + CA.langHref('en') + '" data-lang-switch="en">View in English →</a>' +
      '<button type="button" aria-label="Rester en français" title="Rester en français">×</button>';
    bar.querySelector('button').addEventListener('click', function () { remember('fr'); bar.remove(); });
    doc.body.insertBefore(bar, doc.body.firstChild);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready); else ready();
})(typeof window !== 'undefined' ? window : this);
