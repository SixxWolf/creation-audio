/* =========================================================
   Création Audio — aides d'affichage des promotions (public + portail dealer)
   Le prix promo est déjà dans sell_price / tiers (vues products_public / products_dealer) ;
   reg_price = prix normal, promo_name / promo_ends = bandeau. Voir schema-v2.sql § PROMOTIONS.
   CA.promo.pct(normal, promo)      -> % de rabais entier (0 si aucun)
   CA.promo.pctText(n)              -> −20 % (FR) · −20% (EN)
   CA.promo.endText(ts)             -> jusqu'au 15 novembre · until November 15
   CA.promo.nameOf(row)             -> nom de la promo dans la langue de la page
   CA.promo.ribbon(n)               -> ruban « −20 % » (coin de la photo)
   CA.promo.banner(row, n)          -> bandeau de la fiche (grand, bien visible)
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA = window.CA || {};
  var _t = CA.t || function (s, v) { return v ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : v[k]; }) : s; };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function pct(reg, price) {
    reg = +reg; price = +price;
    if (!(reg > 0) || !(price >= 0) || price >= reg) return 0;
    return Math.max(1, Math.round((1 - price / reg) * 100));
  }
  function pctText(n) { return '\u2212' + n + (CA.lang === 'en' ? '%' : '\u00a0%'); }
  function endText(ts) {
    if (!ts) return '';
    var d = new Date(ts); if (isNaN(d)) return '';
    return _t('jusqu\'au {d}', { d: d.toLocaleDateString(CA.locale || 'fr-CA', { day: 'numeric', month: 'long' }) });
  }
  function nameOf(row) { return (CA.lang === 'en' && row && row.promo_name_en) ? row.promo_name_en : (row && row.promo_name) || ''; }
  function ribbon(n) {
    return n > 0 ? '<span class="promo-rib" aria-hidden="true"><b>' + pctText(n) + '</b></span>' : '';
  }
  function banner(row, n) {
    var nm = nameOf(row), end = endText(row && row.promo_ends);
    return '<div class="promo-banner" role="note">' +
      '<span class="pb-badge">' + (n > 0 ? pctText(n) : _t('PROMO')) + '</span>' +
      '<span class="pb-tx"><b>' + _t('En promotion') + '</b>' + (nm ? ' · ' + esc(nm) : '') + '</span>' +
      (end ? '<span class="pb-end">' + esc(end) + '</span>' : '') +
    '</div>';
  }
  CA.promo = { pct: pct, pctText: pctText, endText: endText, nameOf: nameOf, ribbon: ribbon, banner: banner };
})();
