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
  var CAT_LABEL = { filament: 'Filament', spacer: 'Spacer', accessory: 'Accessoire', caisson: 'Caisson', divers: 'Divers', mixte: 'Mixte' };

  var loaded = false, invoices = [], linesByInv = {}, periodDays = 30, prodInfo = {};
  var bodyEl = $('#stat-body'), soldEl = $('#stat-sold'), refreshBtn = $('#stat-refresh');

  // Groupes de produits (Top produits + onglet « Produits vendus »).
  // Caisson / divers / mixte -> « Autres » (affiché seulement s'il y a des ventes).
  var GROUPS = [
    { key: 'filament', label: 'Filaments' },
    { key: 'accessory', label: 'Accessoires' },
    { key: 'spacer', label: 'Spacers' },
    { key: 'autre', label: 'Autres' }
  ];
  function groupOf(cat) { return (cat === 'filament' || cat === 'accessory' || cat === 'spacer') ? cat : 'autre'; }

  // Pastille couleur — même règle que la boutique : dégradé si attrs.colors (2+),
  // sinon hex du produit, sinon gris.
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
  function swatchBg(p) {
    var cs = p && p.attrs && Array.isArray(p.attrs.colors) ? p.attrs.colors.filter(isHex) : [];
    if (cs.length >= 2) {
      var n = cs.length, parts = [];
      for (var i = 0; i < n; i++) { parts.push(cs[i] + ' ' + (100 * i / n) + '%', cs[i] + ' ' + (100 * (i + 1) / n) + '%'); }
      return 'linear-gradient(90deg,' + parts.join(',') + ')';
    }
    return cs[0] || (p && isHex(p.hex) ? p.hex : '#ccc');
  }

  // sous-onglets : Vue d'ensemble / Produits vendus (URL #statistiques/produits)
  var curSub = 'apercu';
  function showSub(sub) {
    curSub = (sub === 'produits') ? 'produits' : 'apercu';
    $$('.stat-subtab').forEach(function (b) {
      var on = b.getAttribute('data-sub') === curSub;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    });
    if (bodyEl) bodyEl.hidden = (curSub !== 'apercu');
    if (soldEl) soldEl.hidden = (curSub !== 'produits');
  }
  $$('.stat-subtab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var sub = btn.getAttribute('data-sub');
      if (window.CA.route && window.CA.route.goSub) window.CA.route.goSub(sub === 'apercu' ? null : sub);
      else showSub(sub);
    });
  });
  if (window.CA.route && window.CA.route.onSub) {
    window.CA.route.onSub(function (sub, tab) { if (tab === 'statistiques') showSub(sub); });
    // lien direct / rechargement sur #statistiques/produits (le routage initial
    // d'admin-core a tourné avant l'enregistrement de ce module)
    var r0 = window.CA.route.get();
    if (r0 && r0.tab === 'statistiques') showSub(r0.sub);
  }

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
    if (soldEl) soldEl.innerHTML = '<p class="muted">Chargement…</p>';
    // couleurs des produits (pastilles) — en parallèle, non bloquant
    sb.from('products').select('id,type,hex,attrs').then(function (pr) {
      if (pr && !pr.error && pr.data) {
        prodInfo = {};
        pr.data.forEach(function (p) { prodInfo[p.id] = p; });
        if (invoices.length) render();
      }
    });
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

  // gabarit d'UNE ligne de facture (pour ventiler une facture mixte).
  //  - catégorie stockée (ptype) prioritaire — choisie à la facturation ;
  //  - repli pour les anciennes lignes sans ptype :
  //      bobine/recharge -> filament ; unité+« Accessoire » -> accessoire, sinon spacer ;
  //      ligne libre non catégorisée -> divers.
  function lineCat(l, inv) {
    if (l.ptype) return l.ptype;
    var k = l.kind;
    if (k === 'spool' || k === 'refill') return 'filament';
    if (k === 'unit') return /accessoire/i.test(l.meta || '') ? 'accessory' : 'spacer';
    if (k === 'free') return 'divers';
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
          // regroupe par produit ET format (bobine/recharge/unité) — sinon on
          // fusionnerait à tort les ventes bobine et recharge d'une même couleur.
          var key = l.product_id ? (l.product_id + '|' + (l.kind || '')) : ('free:' + (l.label || ''));
          var p = prod[key] || (prod[key] = { label: l.label || '(ligne)', meta: l.meta || '', qty: 0, rev: 0, cost: 0,
                                              pid: l.product_id || null, group: groupOf(lc) });
          p.qty += (+l.qty) || 0; p.rev += (+l.line_total) || 0; p.cost += ((+l.unit_cost) || 0) * ((+l.qty) || 0);
        });
      } else {
        // repli : facture dont les lignes n'ont pas pu être chargées
        var c = inv.category || 'mixte'; byCat[c] = (byCat[c] || 0) + ((+inv.subtotal) || 0);
      }
    });
    var margin = ca - cost, avg = n ? ca / n : 0;

    if (!n) {
      var emptyHtml = '<div class="empty">Aucune facture sur cette période' +
        (invoices.length ? '.' : ' — commence par créer des factures.') + '</div>';
      bodyEl.innerHTML = emptyHtml;
      if (soldEl) soldEl.innerHTML = emptyHtml;
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

    // produits vendus, groupés par catégorie et triés du plus vendu (unités)
    // au moins vendu — MÊME calcul pour « Top produits » et « Produits vendus ».
    var byGroup = {};
    GROUPS.forEach(function (g) { byGroup[g.key] = []; });
    Object.keys(prod).forEach(function (k) { byGroup[prod[k].group].push(prod[k]); });
    GROUPS.forEach(function (g) {
      byGroup[g.key].sort(function (a, b) { return (b.qty - a.qty) || (b.rev - a.rev) || a.label.localeCompare(b.label, 'fr'); });
    });
    function shownGroups() {
      return GROUPS.filter(function (g) { return g.key !== 'autre' || byGroup.autre.length; });
    }

    // Top produits : top 5 de chaque catégorie (plus de mélange entre catégories)
    var topHtml = shownGroups().map(function (g) {
      var list = byGroup[g.key].slice(0, 5);
      var maxQty = list.length ? list[0].qty : 0;
      return '<div class="stat-topgroup"><h3>' + esc(g.label) + '</h3>' +
        (list.length ? list.map(function (p) { return topRow(p, g.key, maxQty); }).join('')
                     : '<p class="muted stat-none">Aucune vente sur cette période.</p>') + '</div>';
    }).join('');

    bodyEl.innerHTML =
      '<div class="stat-cards">' + kpis + '</div>' +
      '<div class="stat-panel"><h2>Ventes par gabarit</h2>' + (catRows || '<p class="muted">—</p>') + '</div>' +
      '<div class="stat-panel stat-toppanel"><h2>Top produits <span class="stat-h-note">par unités vendues</span></h2>' +
        '<div class="stat-topgrid">' + topHtml + '</div></div>';

    if (soldEl) soldEl.innerHTML = shownGroups().map(function (g) {
      var list = byGroup[g.key];
      var units = list.reduce(function (s, p) { return s + p.qty; }, 0);
      var rev = list.reduce(function (s, p) { return s + p.rev; }, 0);
      var head = '<div class="stat-soldhead"><h2>' + esc(g.label) + '</h2>' +
        '<span class="stat-soldsum">' + list.length + ' produit' + (list.length > 1 ? 's' : '') +
        ' · ' + units + ' unité' + (units > 1 ? 's' : '') + ' · ' + money(rev) + '</span></div>';
      if (!list.length) return '<div class="stat-panel stat-soldpanel">' + head + '<p class="muted stat-none">Aucune vente sur cette période.</p></div>';
      var rows = list.map(function (p, i) {
        var m = p.rev - p.cost;
        return '<div class="stat-soldrow">' +
          '<span class="stat-soldrank">' + (i + 1) + '</span>' +
          '<span class="stat-soldname">' + chip(p, g.key) + '<span class="stat-soldlabel">' + esc(p.label) +
            (p.meta ? ' <span class="stat-topmeta">' + esc(p.meta) + '</span>' : '') + '</span></span>' +
          '<span class="stat-soldqty">×' + p.qty + '</span>' +
          '<span class="stat-soldrev">' + money(p.rev) + '</span>' +
          '<span class="stat-soldmargin"><span class="stat-topmargin ' + (m >= 0 ? 'pos' : 'neg') + '">' + money(m) + '</span></span>' +
        '</div>';
      }).join('');
      return '<div class="stat-panel stat-soldpanel">' + head +
        '<div class="stat-soldcols"><span>#</span><span>Produit</span><span>Qté</span><span>Revenu</span><span>Marge</span></div>' +
        rows + '</div>';
    }).join('');
  }

  // pastille couleur : filaments seulement (accessoires / spacers : aucune)
  function chip(p, group) {
    if (group !== 'filament') return '';
    return '<span class="stat-chip" style="background:' + esc(swatchBg(prodInfo[p.pid])) + '"></span>';
  }
  function topRow(p, group, maxQty) {
    var m = p.rev - p.cost;
    return '<div class="stat-toprow">' +
      '<div class="stat-topmain"><span class="stat-topname">' + chip(p, group) + esc(p.label) + (p.meta ? ' <span class="stat-topmeta">' + esc(p.meta) + '</span>' : '') + '</span>' +
        '<span class="stat-bar"><span class="stat-bar-fill" style="width:' + pct(p.qty, maxQty) + '%"></span></span></div>' +
      '<div class="stat-topnums"><span class="stat-topqty">×' + p.qty + '</span>' +
        '<span class="stat-toprev">' + money(p.rev) + '</span>' +
        '<span class="stat-topmargin ' + (m >= 0 ? 'pos' : 'neg') + '">marge ' + money(m) + '</span></div>' +
    '</div>';
  }

  function card(label, value, sub) {
    return '<div class="stat-card"><div class="stat-card-label">' + esc(label) + '</div>' +
      '<div class="stat-card-value">' + value + '</div>' +
      '<div class="stat-card-sub">' + esc(sub) + '</div></div>';
  }
})();
