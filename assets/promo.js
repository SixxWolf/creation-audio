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
   CA.promo.isNew(row)              -> true si attrs.new_until est dans le futur
   CA.promo.newTag(inline)          -> pastille « Nouveau » (coin bas-gauche de la photo, ou en ligne)
   CA.promo.loadPopular()           -> promesse : charge les articles « Populaire » (une fois)
   CA.promo.isPop(kind, ref)        -> true si l'article porte la pastille (après loadPopular)
   CA.promo.popTag(inline)          -> pastille dorée « ★ Populaire » (coin haut-droit de la photo, ou en ligne)
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
  /* « Nouveau » : attrs.new_until (ISO, posé par Admin › Nouveautés, exposé par les vues) tant que la date n'est pas passée */
  function isNew(row) {
    var u = row && row.attrs && row.attrs.new_until;
    if (!u) return false;
    var t = Date.parse(u);
    return !isNaN(t) && t > Date.now();
  }
  function newTag(inline) {
    return '<span class="new-tag' + (inline ? '' : ' is-abs') + '" aria-hidden="' + (inline ? 'false' : 'true') + '">' + _t('Nouveau') + '</span>';
  }
  /* « Populaire » (2026-11-18) : RPC popular_items (top des ventes 90 j par rayon, schema-v2.sql § PASTILLE « POPULAIRE »).
     kind : 'spacer' | 'accessory' | 'color' (id de la couleur) | 'material' ('Marque|Matériau') | 'pack' ; aucune quantité reçue.
     loadPopular() se lance une seule fois ; une erreur = aucune pastille, jamais un blocage. */
  var popSet = {}, popP = null;
  function loadPopular() {
    if (popP) return popP;
    var sb = CA.sb;
    if (!sb || !sb.rpc) return (popP = Promise.resolve());
    popP = Promise.resolve(sb.rpc('popular_items')).then(function (r) {
      ((r && !r.error && r.data) || []).forEach(function (x) { popSet[x.kind + ':' + x.ref] = 1; });
    }, function () {});
    return popP;
  }
  function isPop(kind, ref) { return ref != null && !!popSet[kind + ':' + ref]; }
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>';
  function popTag(inline) {
    return '<span class="pop-tag' + (inline ? '' : ' is-abs') + '">' + STAR + _t('Populaire') + '</span>';
  }
  CA.promo = { pct: pct, pctText: pctText, endText: endText, nameOf: nameOf, ribbon: ribbon, banner: banner, isNew: isNew, newTag: newTag,
               loadPopular: loadPopular, isPop: isPop, popTag: popTag, star: STAR };
})();
