/* =========================================================
   Création Audio V2 — Statistiques (Phase 5)
   Sur les factures NON annulées, filtrées par période
   (1s / 1m / 3m / 6m / 1an / Tout) ou par mois précis
   (liste déroulante) : chiffre d'affaires,
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
  var CAT_LABEL = { filament: 'Filament', spacer: 'Spacer', accessory: 'Accessoire', divers: 'Divers', mixte: 'Mixte' };

  var loaded = false, invoices = [], linesByInv = {}, periodDays = 30, periodMonth = '', prodInfo = {};
  var bodyEl = $('#stat-body'), soldEl = $('#stat-sold'), refreshBtn = $('#stat-refresh'), monthSel = $('#stat-month'), visEl = $('#stat-visits');

  // Groupes de produits (Top produits + onglet « Produits vendus »).
  // Divers / mixte -> « Autres » (affiché seulement s'il y a des ventes).
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
    curSub = (sub === 'produits' || sub === 'visites') ? sub : 'apercu';
    $$('.stat-subtab').forEach(function (b) {
      var on = b.getAttribute('data-sub') === curSub;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    });
    // grand écran (≥ 1600 px, CA.wideLayout) : Vue d'ensemble et Produits vendus côte à côte
    var both = !!(panelEl && panelEl.classList.contains('is-wide'));
    if (bodyEl) bodyEl.hidden = !both && (curSub !== 'apercu');
    if (soldEl) soldEl.hidden = !both && (curSub !== 'produits');
    if (visEl) visEl.hidden = !both && (curSub !== 'visites');
  }
  var panelEl = bodyEl && bodyEl.closest('.tabpanel');
  if (panelEl) panelEl.addEventListener('ca:wide', function () { showSub(curSub); });
  if (window.CA.wideLayout && panelEl) window.CA.wideLayout(panelEl);
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
      periodMonth = '';
      $$('.stat-pbtn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      syncMonthSel();
      render();
      loadVisits();
    });
  });

  // Liste des mois (janvier → décembre) groupés par année : année en cours +
  // toute année qui a des factures. Mois à venir grisés. Choisir un mois
  // remplace la période ; cliquer une période vide le mois.
  var MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  function ymNow() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function buildMonths() {
    if (!monthSel) return;
    var nowYm = ymNow(), years = {};
    years[nowYm.slice(0, 4)] = 1;
    invoices.forEach(function (inv) { var y = (inv.invoice_date || '').slice(0, 4); if (/^\d{4}$/.test(y)) years[y] = 1; });
    var html = '<option value="" disabled hidden>Mois</option>';
    Object.keys(years).sort().reverse().forEach(function (y) {
      html += '<optgroup label="' + y + '">' + MONTHS.map(function (m, i) {
        var v = y + '-' + String(i + 1).padStart(2, '0');
        return '<option value="' + v + '"' + (v > nowYm ? ' disabled' : '') + '>' + m + '</option>';
      }).join('') + '</optgroup>';
    });
    monthSel.innerHTML = html;
    syncMonthSel();
  }
  // affiche « Septembre 2026 » dans le champ fermé (l'année n'est sinon que dans le groupe)
  function syncMonthSel() {
    if (!monthSel) return;
    $$('option', monthSel).forEach(function (o) {
      if (o.value) o.textContent = MONTHS[+o.value.slice(5) - 1] + (o.value === periodMonth ? ' ' + o.value.slice(0, 4) : '');
    });
    if (periodMonth) monthSel.value = periodMonth; else monthSel.selectedIndex = 0;
    monthSel.classList.toggle('is-active', !!periodMonth);
  }
  if (monthSel) {
    monthSel.addEventListener('change', function () {
      periodMonth = monthSel.value || '';
      if (!periodMonth) return;
      $$('.stat-pbtn').forEach(function (x) { x.classList.remove('is-active'); });
      syncMonthSel();
      render();
      loadVisits();
    });
    buildMonths();
  }

  function load() {
    bodyEl.innerHTML = '<p class="muted">Chargement…</p>';
    if (soldEl) soldEl.innerHTML = '<p class="muted">Chargement…</p>';
    loadVisits();
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
      buildMonths();
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
      if (periodMonth) return (inv.invoice_date || '').slice(0, 7) === periodMonth;
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
    var all = inScope();
    // usage interne (ce que Théo prend dans son stock, à 0 $) : jamais compté comme une vente
    var rows = all.filter(function (inv) { return inv.client_type !== 'internal'; });
    var intInv = all.filter(function (inv) { return inv.client_type === 'internal'; });
    // deux usages, comptés à part : « production » (filament pris pour imprimer des spacers) et « autre » (perso, projets ; anciennes sorties comprises)
    var intUse = { production: { cost: 0, qty: 0, n: 0 }, other: { cost: 0, qty: 0, n: 0 } };
    intInv.forEach(function (inv) {
      var u = intUse[inv.internal_use === 'production' ? 'production' : 'other'];
      u.n++; u.cost += (+inv.cost_total) || 0;
      (linesByInv[inv.id] || []).forEach(function (l) { u.qty += (+l.qty) || 0; });
    });
    function intCard(title, u) {
      return u.n ? card(title, money(u.cost), u.qty + ' article' + (u.qty > 1 ? 's' : '') + ' pris · au coûtant') : '';
    }
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

    if (!n && !intInv.length) {
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
      card('Factures', String(n), n > 1 ? n + ' factures' : n + ' facture') +
      card('Panier moyen', money(avg), 'par facture') +
      card('Encaissé', money(collected), 'taxes incluses') +
      intCard('Interne · production', intUse.production) + intCard('Interne · autre', intUse.other);

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

  // ---------- Visites : compteur maison (RPC site_stats_summary — schema-v2.sql, collecte dans nav.js) ----------
  var SRC_LABEL = { direct: 'Direct', interne: 'Interne', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', facebook: 'Facebook',
    instagram: 'Instagram', youtube: 'YouTube', reddit: 'Reddit', autre: 'Autre site' };
  var DEV_LABEL = { mobile: 'Mobile', desktop: 'Ordinateur' };
  var LANG_LABEL = { fr: 'Français', en: 'Anglais' };
  var PAGE_LABEL = { '/': 'Accueil', '/boutique': 'Boutique', '/spacers': 'Spacers', '/compte': 'Mon compte', '/dealer': 'Portail dealer',
    '/revendeur': 'Revendeurs', '/aide': 'Aide', '/conditions': 'Conditions', '/confidentialite': 'Confidentialité',
    '/retours': 'Retours', '/autre': 'Autres pages' };
  var visSeq = 0;
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtShort(d) { return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }); }
  function num(n) { return (Number(n) || 0).toLocaleString('fr-CA'); }
  function pageLabel(p) { return PAGE_LABEL[p] || (/^\/spacer\//.test(p) ? 'Spacer ' + p.slice(8) : p); }

  function visRange() {
    var now = new Date(), to = now, from = null;
    if (periodMonth) {
      var y = +periodMonth.slice(0, 4), m = +periodMonth.slice(5);
      from = new Date(y, m - 1, 1); to = new Date(y, m, 0); if (to > now) to = now;
    } else if (periodDays) {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - periodDays + 1);
    }
    return { from: from, to: to };
  }

  function loadVisits() {
    if (!visEl) return;
    var seq = ++visSeq, r = visRange();
    visEl.innerHTML = '<p class="muted">Chargement…</p>';
    sb.rpc('site_stats_summary', { p_from: ymd(r.from || new Date(2020, 0, 1)), p_to: ymd(r.to) }).then(function (res) {
      if (seq !== visSeq) return;
      if (res.error) { visEl.innerHTML = '<p class="empty">Impossible de charger les visites.<br>As-tu relancé <strong>schema-v2.sql</strong> ?</p>'; return; }
      renderVisits(res.data || {}, r);
    }, function () { if (seq === visSeq) visEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  function shareRows(list, key, labels) {
    var sum = list.reduce(function (s, x) { return s + x.visits; }, 0);
    if (!sum) return '<p class="muted stat-none">—</p>';
    return list.map(function (x) {
      var p = pct(x.visits, sum);
      return '<div class="stat-catrow"><span class="stat-catname">' + esc(labels[x[key]] || x[key]) + '</span>' +
        '<span class="stat-bar"><span class="stat-bar-fill" style="width:' + p + '%"></span></span>' +
        '<span class="stat-catval">' + p + ' %</span></div>';
    }).join('');
  }

  function renderVisits(d, r) {
    var days = d.days || [];
    if (!days.length) { visEl.innerHTML = '<div class="empty">Aucune visite sur cette période.</div>'; return; }
    var tot = { visits: 0, views: 0, visitors: 0 }, byDay = {}, todayKey = ymd(new Date());
    days.forEach(function (x) { tot.visits += x.visits; tot.views += x.views; tot.visitors += x.visitors; byDay[x.day] = x; });

    // une valeur par jour (zéros compris) ; par semaine au-delà de 120 jours
    var start = r.from || parseYmd(days[0].day), weekly = (r.to - start) / 86400000 > 120, series = [];
    for (var cur = new Date(start.getFullYear(), start.getMonth(), start.getDate()); cur <= r.to; cur.setDate(cur.getDate() + 1)) {
      var x = byDay[ymd(cur)] || { visits: 0, views: 0 };
      if (weekly) {
        var mon = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - ((cur.getDay() + 6) % 7)), key = ymd(mon);
        var last = series[series.length - 1];
        if (last && last.key === key) { last.visits += x.visits; last.views += x.views; }
        else series.push({ key: key, label: 'Semaine du ' + fmtShort(mon), short: fmtShort(mon), visits: x.visits, views: x.views });
      } else {
        series.push({ key: ymd(cur), label: cur.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }),
          short: fmtShort(cur), visits: x.visits, views: x.views });
      }
    }
    var max = 0, peak = null;
    series.forEach(function (s) { if (s.visits > max) { max = s.visits; peak = s; } });
    var bars = series.map(function (s) {
      return '<span class="vis-bar' + (s.visits ? '' : ' is-zero') + '" style="height:' + (max ? Math.max(s.visits / max * 100, s.visits ? 2 : 0) : 0) + '%" title="' +
        esc(s.label + ' : ' + num(s.visits) + ' visite' + (s.visits > 1 ? 's' : '') + ' · ' + num(s.views) + ' page' + (s.views > 1 ? 's' : '')) + '"></span>';
    }).join('');

    var today = byDay[todayKey] || { visits: 0 };
    var kpis =
      card('Visites', num(tot.visits), 'sessions') +
      card('Visiteurs', num(tot.visitors), 'uniques par jour') +
      card('Pages vues', num(tot.views), 'au total') +
      card('Pages par visite', tot.visits ? (tot.views / tot.visits).toFixed(1).replace('.', ',') : '—', 'en moyenne') +
      card("Aujourd'hui", num(today.visits), 'visite' + (today.visits > 1 ? 's' : ''));

    var pageMax = (d.pages && d.pages[0]) ? d.pages[0].views : 0;
    var pagesHtml = (d.pages || []).map(function (p) {
      return '<div class="stat-toprow"><div class="stat-topmain"><span class="stat-topname">' + esc(pageLabel(p.path)) + '</span>' +
        '<span class="stat-bar"><span class="stat-bar-fill" style="width:' + pct(p.views, pageMax) + '%"></span></span></div>' +
        '<div class="stat-topnums"><span class="stat-topqty">' + num(p.visits) + ' entrée' + (p.visits > 1 ? 's' : '') + '</span>' +
        '<span class="stat-toprev">' + num(p.views) + ' vue' + (p.views > 1 ? 's' : '') + '</span></div></div>';
    }).join('') || '<p class="muted stat-none">—</p>';

    visEl.innerHTML =
      '<p class="muted vis-note">Compteurs anonymes. Tes propres visites ne sont pas comptées.</p>' +
      '<div class="stat-cards">' + kpis + '</div>' +
      '<div class="stat-panel vis-chart"><h2>Visites par ' + (weekly ? 'semaine' : 'jour') + '</h2>' +
        '<div class="vis-bars" role="img" aria-label="Visites par ' + (weekly ? 'semaine' : 'jour') + '">' + bars + '</div>' +
        '<div class="vis-axis"><span>' + esc(series[0].short) + '</span>' +
          (peak ? '<span>Pic : ' + num(peak.visits) + ' · ' + esc(peak.short) + '</span>' : '') +
          '<span>' + esc(series[series.length - 1].short) + '</span></div></div>' +
      '<div class="vis-cols">' +
        '<div class="stat-panel"><h2>Pages les plus vues</h2>' + pagesHtml + '</div>' +
        '<div class="stat-panel vis-rows"><h2>Provenance</h2>' + shareRows(d.sources || [], 'source', SRC_LABEL) + '</div>' +
        '<div class="stat-panel vis-rows"><h2>Appareil</h2>' + shareRows(d.devices || [], 'device', DEV_LABEL) +
          '<h2 class="vis-h2b">Langue</h2>' + shareRows(d.langs || [], 'lang', LANG_LABEL) + '</div>' +
      '</div>';
  }

  function card(label, value, sub) {
    return '<div class="stat-card"><div class="stat-card-label">' + esc(label) + '</div>' +
      '<div class="stat-card-value">' + value + '</div>' +
      '<div class="stat-card-sub">' + esc(sub) + '</div></div>';
  }
})();
