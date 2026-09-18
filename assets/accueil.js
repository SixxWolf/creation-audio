/* =========================================================
   Création Audio V2 — page d'accueil
   - Menu mobile (tiroir).
   - Produits vedettes chargés depuis la vue products_public
     (filaments + spacers, aucun coût exposé). Purement décoratif :
     si indisponible, la section se retire proprement.
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }

  /* ---- année du footer ---- */
  var yearEl = $('#year'); if (yearEl) yearEl.textContent = new Date().getFullYear();
  // menu mobile : géré par nav.js (partagé)

  /* ---- produits vedettes ---- */
  var sb = window.CA && window.CA.sb;
  var BUCKET = 'products';

  /* ---- compteurs dynamiques (couleurs = filaments actifs ; matériaux =
     paires distinctes marque|matériau). Lu depuis products_public en anon.
     Reste sur les valeurs codées en dur du HTML si indisponible. ---- */
  (function () {
    if (!sb) return;
    sb.from('products_public').select('brand,material').eq('type', 'filament').then(function (res) {
      var rows = (res && res.data) || [];
      if (!rows.length) return;
      var colors = rows.length, mats = {};
      rows.forEach(function (r) { mats[(r.brand || '') + '|' + (r.material || '')] = 1; });
      var nMat = Object.keys(mats).length;
      var set = function (sel, v) { var el = $(sel); if (el) el.textContent = v; };
      set('#stat-colors', colors);
      set('#stat-materials', nMat);
      var cf = $('#cat-fil-sub'); if (cf) cf.textContent = colors + ' couleurs · ' + nMat + ' matériaux';
    }, function () { /* silencieux : on garde le fallback HTML */ });
  })();

  var grid = $('#feat-grid');
  var spacerGrid = $('#spacer-grid');
  if (!grid && !spacerGrid) return;

  function publicUrl(path) { if (!path || !sb) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function hideEl(sel) { var w = document.querySelector(sel); if (w && w.parentNode) w.parentNode.removeChild(w); }

  if (!sb) { hideEl('.feat-wrap'); hideEl('#spacer-section'); return; }

  // Même slugify que boutique.js (minuscules, accents retirés, tirets).
  function slugify(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  // Lien direct vers le filament : boutique.html#/m/marque/matériau/couleur.
  // Les resolveBrand/Material/Color de boutique.js acceptent le slug auto, donc
  // slugify(brand) résout même si la marque a un slug personnalisé (non exposé ici).
  function filUrl(p) {
    var b = slugify(p.brand || 'Autres');
    var m = p.material_slug || slugify(p.material || 'Autres');
    var c = p.slug || slugify(p.name);
    return 'boutique.html#/m/' + b + '/' + m + '/' + c;
  }

  function filCard(p) {
    var url = publicUrl(p.image_path);
    // « dès » = le prix le plus bas réellement disponible (bobine OU recharge),
    // pas seulement le prix bobine — tout étant offert en recharge, c'est souvent 20 $.
    var prices = [p.sell_price, p.sell_price_2].filter(function (v) { return v != null; });
    var base = prices.length ? Math.min.apply(null, prices) : null;
    var media = url
      ? '<img src="' + esc(url) + '" alt="' + esc(p.name) + '" loading="lazy">'
      : '<span class="feat-swatch" style="background:' + esc(p.hex || '#ccc') + '"></span>';
    return '<a class="feat-card" href="' + filUrl(p) + '">' +
      '<div class="feat-media">' + media + '</div>' +
      '<div class="feat-body"><span class="feat-kind">' + esc(p.material || 'Filament') + '</span>' +
        '<span class="feat-name">' + esc(p.name) + '</span>' +
        (base != null ? '<span class="feat-price">dès <b>' + money(base) + '</b></span>' : '') +
      '</div></a>';
  }
  function spaCard(p) {
    var url = publicUrl(p.image_path);
    var media = url ? '<img src="' + esc(url) + '" alt="' + esc(p.name) + '" loading="lazy">' : '<span class="feat-swatch" style="background:#d7d9db"></span>';
    return '<a class="feat-card" href="spacers.html">' +
      '<div class="feat-media">' + media + '</div>' +
      '<div class="feat-body"><span class="feat-kind">Spacer</span>' +
        '<span class="feat-name">' + esc(p.name) + '</span>' +
        (p.sell_price != null ? '<span class="feat-price"><b>' + money(p.sell_price) + '</b> / paire</span>' : '') +
      '</div></a>';
  }

  /* Filaments POPULAIRES : top 5 par QUANTITÉ vendue (vue product_popularity,
     factures finales). Repli sur l'ordre boutique (sort_order) s'il n'y a pas
     encore de ventes ou si la vue n'existe pas (schéma pas encore relancé). */
  if (grid) {
    sb.from('products_public').select('*').eq('type', 'filament').limit(500).then(function (res) {
      var fils = (res && res.data) || [];
      if (!fils.length) { hideEl('.feat-wrap'); return; }
      var render = function (pop) {
        fils.forEach(function (p) { p._pop = pop[p.id] || 0; });
        fils.sort(function (a, b) {
          if (b._pop !== a._pop) return b._pop - a._pop;                    // + vendus d'abord
          var ai = a.image_path ? 0 : 1, bi = b.image_path ? 0 : 1;         // puis ceux avec image
          if (ai !== bi) return ai - bi;
          return (a.sort_order || 0) - (b.sort_order || 0);                 // puis ordre boutique
        });
        grid.innerHTML = fils.slice(0, 5).map(filCard).join('');
      };
      sb.from('product_popularity').select('product_id,qty_sold').then(function (pr) {
        var pop = {}; if (pr && pr.data) pr.data.forEach(function (r) { pop[r.product_id] = +r.qty_sold || 0; });
        render(pop);
      }, function () { render({}); });   // vue absente -> repli sort_order
    }, function () { hideEl('.feat-wrap'); });
  }

  /* Spacers : section séparée (ordre boutique). */
  if (spacerGrid) {
    sb.from('products_public').select('*').eq('type', 'spacer').order('sort_order', { ascending: true }).limit(10).then(function (res) {
      var spa = (res && res.data) || [];
      if (!spa.length) { hideEl('#spacer-section'); return; }
      spacerGrid.innerHTML = spa.slice(0, 5).map(spaCard).join('');
    }, function () { hideEl('#spacer-section'); });
  }
})();
