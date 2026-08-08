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
  var grid = $('#feat-grid');
  if (!grid) return;

  function publicUrl(path) { if (!path || !sb) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function removeSection() { var w = document.querySelector('.feat-wrap'); if (w) w.parentNode.removeChild(w); }

  if (!sb) { removeSection(); return; }

  Promise.all([
    sb.from('products_public').select('*').eq('type', 'filament').order('sort_order', { ascending: true }).limit(30),
    sb.from('products_public').select('*').eq('type', 'spacer').order('sort_order', { ascending: true }).limit(12)
  ]).then(function (res) {
    var fil = (res[0] && res[0].data) || [], spa = (res[1] && res[1].data) || [];
    // priorité aux items avec image ; on prend un mélange filaments + spacers
    var filPick = fil.filter(function (p) { return p.image_path; }).slice(0, 4);
    if (filPick.length < 4) filPick = filPick.concat(fil.filter(function (p) { return !p.image_path; }).slice(0, 4 - filPick.length));
    var spaPick = spa.filter(function (p) { return p.image_path; }).slice(0, 2);
    if (spaPick.length < 2) spaPick = spaPick.concat(spa.filter(function (p) { return !p.image_path; }).slice(0, 2 - spaPick.length));

    var cards = [];
    filPick.forEach(function (p) {
      var url = publicUrl(p.image_path);
      var base = (p.sell_price != null) ? p.sell_price : p.sell_price_2;
      var media = url
        ? '<img src="' + esc(url) + '" alt="' + esc(p.name) + '" loading="lazy">'
        : '<span class="feat-swatch" style="background:' + esc(p.hex || '#ccc') + '"></span>';
      cards.push('<a class="feat-card" href="boutique.html">' +
        '<div class="feat-media">' + media + '</div>' +
        '<div class="feat-body"><span class="feat-kind">' + esc(p.material || 'Filament') + '</span>' +
          '<span class="feat-name">' + esc(p.name) + '</span>' +
          (base != null ? '<span class="feat-price">dès <b>' + money(base) + '</b></span>' : '') +
        '</div></a>');
    });
    spaPick.forEach(function (p) {
      var url = publicUrl(p.image_path);
      var media = url ? '<img src="' + esc(url) + '" alt="' + esc(p.name) + '" loading="lazy">' : '<span class="feat-swatch" style="background:#d7d9db"></span>';
      cards.push('<a class="feat-card" href="spacers.html">' +
        '<div class="feat-media">' + media + '</div>' +
        '<div class="feat-body"><span class="feat-kind">Spacer</span>' +
          '<span class="feat-name">' + esc(p.name) + '</span>' +
          (p.sell_price != null ? '<span class="feat-price"><b>' + money(p.sell_price) + '</b> / paire</span>' : '') +
        '</div></a>');
    });

    if (!cards.length) { removeSection(); return; }
    grid.innerHTML = cards.join('');
  }, function () { removeSection(); });
})();
