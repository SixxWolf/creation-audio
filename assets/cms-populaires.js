/* =========================================================
   Création Audio — CMS Populaires (Admin › Promos & nouveautés › Populaires, 2026-11-18)
   Pastille dorée « ★ Populaire » : top des ventes par rayon, calculé en direct par la base
   (schema-v2.sql § PASTILLE « POPULAIRE » : _popular_rank, admin_popular, popular_items).
   Ici : réglages (popular_settings : période, top, minimum) + Forcer / Masquer / Auto par article
   (popular_overrides). Les quantités ne sont visibles qu'ici, jamais côté public.
   Rayons : spacer · material (cartes matériau) · color (pastilles de la fiche, top par matériau) · accessory · pack.
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

  var listEl = $('#pp-list'), statusEl = $('#pp-status');
  var daysI = $('#pp-days'), topI = $('#pp-top'), minI = $('#pp-min');
  if (!listEl) return;

  var rows = [], st = { days: 90, top: 3, min_qty: 5 }, busy = false;
  var SECS = [
    ['spacer', 'Spacers'],
    ['material', 'Filaments (cartes matériau)'],
    ['color', 'Couleurs de filament (dans chaque matériau)'],
    ['accessory', 'Accessoires'],
    ['pack', 'Packs de filament']
  ];
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>';

  function qtyText(q) {
    var n = +q || 0;
    return (Math.round(n) === n ? n : n.toFixed(1).replace('.', ',')) + ' vendu' + (n >= 2 ? 's' : '');
  }

  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return Promise.all([
      sb.rpc('admin_popular'),
      sb.from('popular_settings').select('days,top,min_qty').eq('id', 1).maybeSingle()
    ]).then(function (r) {
      if (r[0].error) { listEl.innerHTML = '<p class="empty">Impossible de charger le classement.<br>' + esc(r[0].error.message) + '</p>'; return; }
      rows = r[0].data || [];
      if (r[1] && r[1].data) st = r[1].data;
      daysI.value = st.days; topI.value = st.top; minI.value = Math.round(+st.min_qty);
      render();
    }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  function rowHtml(x) {
    var on = !!x.popular, mode = x.mode || '';
    var state = mode === 'force' ? 'Forcé' : mode === 'hide' ? 'Masqué' : on ? 'Populaire' : '';
    var acts = mode
      ? '<button type="button" class="btn btn-ghost btn-sm" data-ic="undo" data-pp="auto">Auto</button>'
      : on ? '<button type="button" class="btn btn-ghost btn-sm" data-ic="eye-off" data-pp="hide">Masquer</button>'
           : '<button type="button" class="btn btn-ghost btn-sm" data-ic="star" data-pp="force">Forcer</button>';
    return '<div class="pp-row' + (on ? ' is-on' : '') + '" data-kind="' + esc(x.kind) + '" data-ref="' + esc(x.ref) + '">' +
      '<span class="pp-rank">' + (x.rnk ? '#' + x.rnk : '—') + '</span>' +
      // couleur : le groupe donne déjà « Marque · Matériau », la ligne montre juste la couleur
      '<span class="pp-name">' + esc(x.label ? (x.kind === 'color' ? x.label.split(' · ')[0] : x.label) : '(sans vente sur la période)') + '</span>' +
      '<span class="pp-qty">' + qtyText(x.qty) + '</span>' +
      '<span class="pp-state' + (on ? ' s-on' : mode === 'hide' ? ' s-hide' : '') + '">' + (on ? STAR : '') + esc(state) + '</span>' +
      '<span class="pp-acts">' + acts + '</span>' +
    '</div>';
  }

  function render() {
    var by = {};
    rows.forEach(function (x) { (by[x.kind] = by[x.kind] || []).push(x); });
    var cut = (+st.top || 3) + 2;   // couleurs : top + 2 par matériau, plus les forcées/masquées
    listEl.innerHTML = SECS.map(function (s) {
      var list = (by[s[0]] || []).slice();
      if (s[0] === 'color') {
        // groupé par matériau (le libellé finit par « · Matériau »)
        var g = {}, order = [];
        list.forEach(function (x) {
          var k = String(x.label || '').split(' · ').slice(1).join(' · ') || 'Autres';
          if (!g[k]) { g[k] = []; order.push(k); }
          g[k].push(x);
        });
        order.sort(function (a, b) { return a.localeCompare(b, 'fr'); });
        var body = order.map(function (k) {
          var l = g[k].sort(function (a, b) { return (a.rnk || 99) - (b.rnk || 99); })
            .filter(function (x) { return x.mode || (x.rnk && x.rnk <= cut); });
          var n = l.filter(function (x) { return x.popular; }).length;
          return '<details class="pm-g pp-g"' + (n ? ' open' : '') + '><summary><span class="pm-gname">' + esc(k) + '</span>' +
            '<span class="muted">' + (n ? n + ' populaire' + (n > 1 ? 's' : '') : 'aucune') + '</span></summary>' +
            '<div class="pp-rows">' + l.map(rowHtml).join('') + '</div></details>';
        }).join('');
        return '<section class="pp-sec"><h3>' + esc(s[1]) + '</h3>' + (body || '<p class="muted">Aucune vente sur la période.</p>') + '</section>';
      }
      list.sort(function (a, b) { return (a.rnk || 99) - (b.rnk || 99); });
      return '<section class="pp-sec"><h3>' + esc(s[1]) + '</h3>' +
        (list.length ? '<div class="pp-rows">' + list.map(rowHtml).join('') + '</div>' : '<p class="muted">Aucune vente sur la période.</p>') +
      '</section>';
    }).join('');
    if (window.CA.decorateIcons) window.CA.decorateIcons(listEl);
  }

  // Forcer / Masquer / Auto
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pp]'); if (!b || busy) return;
    var row = b.closest('.pp-row'), kind = row.getAttribute('data-kind'), ref = row.getAttribute('data-ref'), act = b.getAttribute('data-pp');
    busy = true; b.disabled = true;
    var q = act === 'auto'
      ? sb.from('popular_overrides').delete().eq('kind', kind).eq('ref', ref)
      : sb.from('popular_overrides').upsert({ kind: kind, ref: ref, mode: act }, { onConflict: 'kind,ref' });
    q.then(function (r) {
      busy = false;
      if (r.error) { b.disabled = false; statusEl.textContent = 'Erreur : ' + r.error.message; return; }
      statusEl.textContent = '';
      load();
    }, function () { busy = false; b.disabled = false; statusEl.textContent = 'Erreur réseau.'; });
  });

  // réglages : chaque champ s'enregistre en le quittant
  function saveSettings() {
    var d = parseInt(daysI.value, 10), t = parseInt(topI.value, 10), m = parseFloat(minI.value);
    if (!(d >= 7 && d <= 730)) { statusEl.textContent = 'Période entre 7 et 730 jours.'; return; }
    if (!(t >= 1 && t <= 20)) { statusEl.textContent = 'Top entre 1 et 20.'; return; }
    if (!(m >= 0)) { statusEl.textContent = 'Minimum de 0 ou plus.'; return; }
    if (d === +st.days && t === +st.top && m === +st.min_qty) return;
    statusEl.textContent = 'Enregistrement…';
    sb.from('popular_settings').update({ days: d, top: t, min_qty: m }).eq('id', 1).then(function (r) {
      if (r.error) { statusEl.textContent = 'Erreur : ' + r.error.message; return; }
      statusEl.textContent = 'Enregistré';
      load();
    }, function () { statusEl.textContent = 'Erreur réseau.'; });
  }
  [daysI, topI, minI].forEach(function (i) { i.addEventListener('change', saveSettings); });
  var rf = $('#pp-refresh'); if (rf) rf.addEventListener('click', load);

  window.CA.loadPopulaires = load;
})();
