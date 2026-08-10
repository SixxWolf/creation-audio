/* =========================================================
   Création Audio V2 — Statistiques (Phase 5)
   Sur les factures NON annulées, filtrées par période
   (1s / 1m / 3m / 6m / 1an / Tout) : chiffre d'affaires,
   marge (ventes − coûts, hors taxes), nb factures, panier
   moyen, répartition par gabarit et top produits.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function pct(part, whole) { return whole > 0 ? Math.round(part / whole * 100) : 0; }
  var CAT_LABEL = { filament: 'Filament', spacer: 'Spacer', accessory: 'Accessoire', caisson: 'Caisson', mixte: 'Mixte' };

  var loaded = false, invoices = [], linesByInv = {}, periodDays = 30;
  var bodyEl = $('#stat-body'), refreshBtn = $('#stat-refresh');

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'statistiques') { if (!loaded) { loaded = true; load(); } }
  };
  window.CA.reloadStatistiques = function () { if (loaded) load(); };

  if (refreshBtn) refreshBtn.addEventListener('click', load);
  $$('.stat-pbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      periodDays = parseInt(b.getAttribute('data-days'), 10) || 0;
      $$('.stat-pbtn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      render();
    });
  });

  function load() {
    bodyEl.innerHTML = '<p class="muted">Chargement…</p>';
    sb.from('invoices').select('*').then(function (res) {
      if (res.error) { bodyEl.innerHTML = '<p class="empty">Impossible de charger.<br>As-tu relancé <strong>schema-v2.sql</strong> ?</p>'; return; }
      invoices = res.data || [];
      linesByInv = {};
      if (!invoices.length) { render(); return; }
      var ids = invoices.map(function (r) { return r.id; });
      sb.from('invoice_lines').select('*').in('invoice_id', ids).then(function (r2) {
        (r2.data || []).forEach(function (l) { (linesByInv[l.invoice_id] = linesByInv[l.invoice_id] || []).push(l); });
        render();
      }, function () { render(); });
    }, function () { bodyEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  function cutoffISO() {
    if (!periodDays) return null;
    var d = new Date(Date.now() - periodDays * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function inScope() {
    var cut = cutoffISO();
    return invoices.filter(function (inv) {
      if (inv.status === 'cancelled') return false;
      if (cut && (inv.invoice_date || '') < cut) return false;
      return true;
    });
  }

  // gabarit d'UNE ligne de facture (pour ventiler une facture mixte) :
  //  - bobine/recharge      -> filament
  //  - unité + méta « Accessoire » -> accessoire ; sinon -> spacer
  //  - ligne libre          -> gabarit de la facture si net, sinon caisson
  function lineCat(l, inv) {
    var k = l.kind;
    if (k === 'spool' || k === 'refill') return 'filament';
    if (k === 'unit') return /accessoire/i.test(l.meta || '') ? 'accessory' : 'spacer';
    if (k === 'free') { var c = inv.category; return (c && c !== 'mixte') ? c : 'caisson'; }
    return inv.category || 'mixte';
  }

  function render() {
    var rows = inScope();
    var n = rows.length;
    var ca = 0, cost = 0, collected = 0;
    var byCat = {}, prod = {};
    rows.forEach(function (inv) {
      ca += (+inv.subtotal) || 0; cost += (+inv.cost_total) || 0; collected += (+inv.total) || 0;
      var lns = linesByInv[inv.id] || [];
      if (lns.length) {
        lns.forEach(function (l) {
          // ventilation par gabarit AU NIVEAU DE LA LIGNE : une facture mixte
          // répartit ses filaments et ses accessoires dans les bonnes cases.
          var lc = lineCat(l, inv);
          byCat[lc] = (byCat[lc] || 0) + ((+l.line_total) || 0);
          var key = l.product_id || ('free:' + (l.label || ''));
          var p = prod[key] || (prod[key] = { label: l.label || '(ligne)', meta: l.meta || '', qty: 0, rev: 0, cost: 0 });
          p.qty += (+l.qty) || 0; p.rev += (+l.line_total) || 0; p.cost += ((+l.unit_cost) || 0) * ((+l.qty) || 0);
        });
      } else {
        // repli : facture dont les lignes n'ont pas pu être chargées
        var c = inv.category || 'mixte'; byCat[c] = (byCat[c] || 0) + ((+inv.subtotal) || 0);
      }
    });
    var margin = ca - cost, avg = n ? ca / n : 0;

    if (!n) {
      bodyEl.innerHTML = '<div class="empty">Aucune facture sur cette période' +
        (invoices.length ? '.' : ' — commence par créer des factures.') + '</div>';
      return;
    }

    // KPI cards
    var kpis =
      card('Chiffre d\'affaires', money(ca), 'hors taxes') +
      card('Marge', money(margin) + ' <span class="stat-pct ' + (margin >= 0 ? 'pos' : 'neg') + '">' + pct(margin, ca) + '%</span>', 'coût ' + money(cost)) +
      card('Factures', String(n), n > 1 ? n + ' factures' : '1 facture') +
      card('Panier moyen', money(avg), 'par facture') +
      card('Encaissé', money(collected), 'taxes incluses');

    // répartition par gabarit
    var catRows = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).map(function (c) {
      return '<div class="stat-catrow"><span class="stat-catname">' + esc(CAT_LABEL[c] || c) + '</span>' +
        '<span class="stat-bar"><span class="stat-bar-fill" style="width:' + pct(byCat[c], ca) + '%"></span></span>' +
        '<span class="stat-catval">' + money(byCat[c]) + '</span></div>';
    }).join('');

    // top produits par revenu
    var top = Object.keys(prod).map(function (k) { return prod[k]; })
      .sort(function (a, b) { return b.rev - a.rev; }).slice(0, 8);
    var maxRev = top.length ? top[0].rev : 0;
    var topRows = top.map(function (p) {
      var m = p.rev - p.cost;
      return '<div class="stat-toprow">' +
        '<div class="stat-topmain"><span class="stat-topname">' + esc(p.label) + (p.meta ? ' <span class="stat-topmeta">' + esc(p.meta) + '</span>' : '') + '</span>' +
          '<span class="stat-bar"><span class="stat-bar-fill" style="width:' + pct(p.rev, maxRev) + '%"></span></span></div>' +
        '<div class="stat-topnums"><span class="stat-topqty">×' + p.qty + '</span>' +
          '<span class="stat-toprev">' + money(p.rev) + '</span>' +
          '<span class="stat-topmargin ' + (m >= 0 ? 'pos' : 'neg') + '">marge ' + money(m) + '</span></div>' +
      '</div>';
    }).join('');

    bodyEl.innerHTML =
      '<div class="stat-cards">' + kpis + '</div>' +
      '<div class="stat-cols">' +
        '<div class="stat-panel"><h2>Ventes par gabarit</h2>' + (catRows || '<p class="muted">—</p>') + '</div>' +
        '<div class="stat-panel"><h2>Top produits</h2>' + (topRows || '<p class="muted">—</p>') + '</div>' +
      '</div>';
  }

  function card(label, value, sub) {
    return '<div class="stat-card"><div class="stat-card-label">' + esc(label) + '</div>' +
      '<div class="stat-card-value">' + value + '</div>' +
      '<div class="stat-card-sub">' + esc(sub) + '</div></div>';
  }
})();
