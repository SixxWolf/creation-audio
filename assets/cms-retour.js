/* =========================================================
   Création Audio — CMS De retour (Admin › Promos & nouveautés › De retour, 2026-11-19)
   Pastille bleue « De retour » : article reçu (Réception) ou produit (spacers) alors que
   son format avait 2 unités ou moins, pendant 7 jours, tant qu'il reste en stock.
   Calcul en base : schema-v2.sql § PASTILLE « DE RETOUR » (_back_rank, back_items, admin_back_items).
   Ici : la liste en cours + Retirer / Remettre par produit (admin_back_hide → stock_moves.back_hidden).
   Packs : suivent leurs couleurs (aucun bouton). Cartes matériau : une couleur de retour suffit (pas listées).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var listEl = $('#rt-list'), statusEl = $('#rt-status');
  if (!listEl) return;

  var DAYS = 7, rows = [], prods = {}, matOrder = {}, brandOrder = {}, busy = false;

  function fmtDay(ts) { return new Date(ts).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' }); }
  function left(ts) { return Math.max(1, Math.ceil((Date.parse(ts) + DAYS * 86400000 - Date.now()) / 86400000)); }

  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return Promise.all([
      sb.rpc('admin_back_items'),
      sb.from('products').select('id,type,name,brand,material,hex,sort_order'),
      sb.from('materials').select('brand,name,sort_order'),
      sb.from('brands').select('name,sort_order')
    ]).then(function (r) {
      var bad = r.filter(function (x) { return x.error; })[0];
      if (bad) { listEl.innerHTML = '<p class="empty">Impossible de charger la liste.<br>' + esc(bad.error.message || bad.error) + '</p>'; return; }
      rows = (r[0].data || []).filter(function (x) { return x.kind !== 'material'; });
      prods = {}; matOrder = {}; brandOrder = {};
      (r[1].data || []).forEach(function (p) { prods[p.id] = p; });
      (r[2].data || []).forEach(function (m, i) { matOrder[m.brand + '|' + m.name] = m.sort_order != null ? m.sort_order : i; });
      (r[3].data || []).forEach(function (b, i) { brandOrder[b.name] = b.sort_order != null ? b.sort_order : i; });
      render();
    }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  // groupes dans l'ordre de la section Filaments (marque → matériau → couleur), puis spacers, accessoires
  function gOf(x) {
    var p = prods[x.ref] || {};
    if (x.kind === 'pack') return { k: 'k', label: 'Packs de filament', t: 0 };
    if (x.kind === 'spacer') return { k: 's', label: 'Spacers', t: 2 };
    if (x.kind === 'accessory') return { k: 'a', label: 'Accessoires', t: 3 };
    return { k: 'f|' + p.brand + '|' + p.material, label: [p.brand, p.material].filter(Boolean).join(' · ') || 'Filaments', t: 1, brand: p.brand, material: p.material };
  }
  function fmtName(f) { return f === 'refill' ? 'Recharge' : 'Bobine'; }

  function rowHtml(x) {
    var p = prods[x.ref] || {}, isPack = x.kind === 'pack';
    var name = isPack ? x.label : (p.name || x.label);
    var meta = [];
    if (x.kind === 'color') meta.push(fmtName(x.fmt));
    meta.push('reçu le ' + fmtDay(x.at));
    if (x.qty_before != null) meta.push('avant : ' + x.qty_before);
    if (x.qty_now != null) meta.push('en stock : ' + x.qty_now);
    var state = x.hidden ? '<span class="pp-state s-hide">Retiré</span>'
      : '<span class="pp-state rt-on">' + left(x.at) + ' j</span>';
    var act = isPack ? ''
      : x.hidden ? '<button type="button" class="btn btn-ghost btn-sm" data-ic="undo" data-rt="show">Remettre</button>'
                 : '<button type="button" class="btn btn-ghost btn-sm" data-ic="eye-off" data-rt="hide">Retirer</button>';
    return '<div class="pp-row rt-row' + (x.hidden ? '' : ' is-on') + '" data-ref="' + esc(x.ref) + '">' +
      '<span class="rt-sw">' + (p.hex ? '<i class="pm-dot" style="background:' + esc(p.hex) + '"></i>' : '') + '</span>' +
      '<span class="pp-name">' + esc(name) + '</span>' +
      '<span class="pp-qty">' + esc(meta.join(' · ')) + '</span>' +
      state +
      '<span class="pp-acts">' + act + '</span>' +
    '</div>';
  }

  function render() {
    if (!rows.length) { listEl.innerHTML = '<p class="empty">Rien n\'est de retour en ce moment.</p>'; return; }
    var map = {}, gs = [];
    rows.forEach(function (x) {
      var g = gOf(x);
      if (!map[g.k]) { map[g.k] = g; g.items = []; gs.push(g); }
      map[g.k].items.push(x);
    });
    function bo(g) { return brandOrder[g.brand] != null ? brandOrder[g.brand] : 999; }
    function mo(g) { var v = matOrder[g.brand + '|' + g.material]; return v != null ? v : 999; }
    gs.sort(function (a, b) { return (a.t - b.t) || (bo(a) - bo(b)) || (mo(a) - mo(b)); });
    listEl.innerHTML = gs.map(function (g) {
      g.items.sort(function (a, b) {
        var pa = prods[a.ref] || {}, pb = prods[b.ref] || {};
        return ((pa.sort_order != null ? pa.sort_order : 999) - (pb.sort_order != null ? pb.sort_order : 999)) ||
          String(pa.name || a.label).localeCompare(String(pb.name || b.label), 'fr') || (a.fmt === 'refill') - (b.fmt === 'refill');
      });
      var n = g.items.filter(function (x) { return !x.hidden; }).length;
      return '<section class="pp-sec"><h3>' + esc(g.label) + ' <span class="muted">' + n + '</span></h3>' +
        '<div class="pp-rows">' + g.items.map(rowHtml).join('') + '</div></section>';
    }).join('');
    if (window.CA.decorateIcons) window.CA.decorateIcons(listEl);
  }

  // Retirer / Remettre : toutes les réceptions récentes du produit (les deux formats)
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rt]'); if (!b || busy) return;
    var ref = b.closest('.rt-row').getAttribute('data-ref');
    busy = true; b.disabled = true;
    sb.rpc('admin_back_hide', { p_product: ref, p_hide: b.getAttribute('data-rt') === 'hide' }).then(function (r) {
      busy = false;
      if (r.error) { b.disabled = false; statusEl.textContent = 'Erreur : ' + r.error.message; return; }
      statusEl.textContent = '';
      load();
    }, function () { busy = false; b.disabled = false; statusEl.textContent = 'Erreur réseau.'; });
  });
  var rf = $('#rt-refresh'); if (rf) rf.addEventListener('click', load);

  window.CA.loadRetour = load;
})();
