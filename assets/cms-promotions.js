/* =========================================================
   Création Audio — CMS Promotions
   Tables « promotions » + « promotion_items » (schema-v2.sql § PROMOTIONS).
   Une promo : nom FR/EN, dates, seuil de stock, audience (public / dealers),
   mode « prix fixes » (prix + paliers par groupe d'articles) ou « % de rabais ».
   Le prix est appliqué par les VUES products_public / products_dealer :
   boutique, panier et serveur suivent seuls. Plusieurs promos sur un item : la plus
   forte remise l'emporte. Sous le seuil de stock, l'item sort de la promo tout seul.
   Groupes de prix : filament = marque · matériau ; spacers ; accessoires.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = window.CA.money || function (n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' $'; };
  var fold = window.CA.fold || function (s) { return String(s || '').toLowerCase(); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDay(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fromDay(v, end) {
    if (!v) return null;
    var p = v.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2], end ? 23 : 0, end ? 59 : 0, end ? 59 : 0);
    return isNaN(d) ? null : d.toISOString();
  }
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function fmtDay(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  }

  var listEl = $('#pm-list'), editor = $('#pm-editor');
  if (!listEl || !editor) return;
  var nameI = $('#pm-name'), nameEnI = $('#pm-name-en'), startI = $('#pm-start'), endI = $('#pm-end'),
      stockI = $('#pm-stock'), pubI = $('#pm-pub'), dealerI = $('#pm-dealer'),
      modeSeg = $('#pm-mode'), pctW = $('#pm-pct-w'), pctI = $('#pm-pct'),
      qI = $('#pm-q'), pickEl = $('#pm-pick'), pricesW = $('#pm-prices-w'), pricesEl = $('#pm-prices'),
      saveBtn = $('#pm-save'), statusEl = $('#pm-status');

  var promos = [], itemsBy = {}, prods = [], mats = {}, matOrder = {}, brandOrder = {};
  var loaded = false, editingId = null, mode = 'price';
  var sel = {};            // product_id -> true
  var gp = {};             // clé de groupe -> { price, price2, tiers, tiers2, dprice, dtiers }
  var openG = {};          // groupes dépliés

  /* ---------- livraison des revendeurs (admin_settings « dealer_shipping ») ----------
     Lu par le portail via la RPC dealer_shipping ; chaque commande fige le seuil et le forfait à son envoi. */
  var shipForm = $('#pm-ship'), shipOn = $('#pm-ship-on'), shipMin = $('#pm-ship-min'), shipFee = $('#pm-ship-fee'),
      shipEnd = $('#pm-ship-end'), shipSave = $('#pm-ship-save'), shipStatus = $('#pm-ship-status');
  function loadShip() {
    sb.from('admin_settings').select('value').eq('key', 'dealer_shipping').maybeSingle().then(function (res) {
      if (res.error) { shipStatus.textContent = 'Erreur : ' + res.error.message; return; }
      var v = (res.data && res.data.value) || {};
      shipOn.checked = v.enabled !== false;
      shipMin.value = v.threshold != null ? v.threshold : 150;
      shipFee.value = v.fee != null ? v.fee : 25;
      shipEnd.value = v.ends || '';
    });
  }
  shipForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var min = num(shipMin.value), fee = num(shipFee.value);
    if (min == null || min < 0) { shipStatus.textContent = 'Indique le montant de la livraison gratuite.'; shipMin.focus(); return; }
    if (fee == null || fee < 0) { shipStatus.textContent = 'Indique le prix de la livraison.'; shipFee.focus(); return; }
    shipSave.disabled = true; shipStatus.textContent = 'Enregistrement…';
    sb.from('admin_settings').upsert({
      key: 'dealer_shipping',
      value: { enabled: shipOn.checked, threshold: r2(min), fee: r2(fee), ends: shipEnd.value || null },
      updated_at: new Date().toISOString()
    }).then(function (res) {
      shipSave.disabled = false;
      shipStatus.textContent = res.error ? 'Erreur : ' + res.error.message : 'Enregistré ✓';
    }, function (err) { shipSave.disabled = false; shipStatus.textContent = 'Erreur : ' + (err && err.message || err); });
  });

  /* ---------- commande découverte (admin_settings « dealer_discovery ») ----------
     since = date de la 1re activation : seuls les comptes créés depuis y ont droit. */
  var discForm = $('#pm-disc'), discOn = $('#pm-disc-on'), discEnd = $('#pm-disc-end'), discSave = $('#pm-disc-save'), discStatus = $('#pm-disc-status'), discSince = null;
  function loadDisc() {
    sb.from('admin_settings').select('value').eq('key', 'dealer_discovery').maybeSingle().then(function (res) {
      if (res.error) { discStatus.textContent = 'Erreur : ' + res.error.message; return; }
      var v = (res.data && res.data.value) || {};
      discOn.checked = v.enabled === true;
      discEnd.value = v.ends || '';
      discSince = v.since || null;
    }, function () {});
  }
  discForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (discOn.checked && !discSince) discSince = new Date().toISOString();
    discSave.disabled = true; discStatus.textContent = 'Enregistrement…';
    sb.from('admin_settings').upsert({
      key: 'dealer_discovery',
      value: { enabled: discOn.checked, ends: discEnd.value || null, since: discSince },
    }, { onConflict: 'key' }).then(function (res) {
      discSave.disabled = false;
      discStatus.textContent = res.error ? 'Erreur : ' + res.error.message : 'Enregistré ✓';
    }, function (err) { discSave.disabled = false; discStatus.textContent = 'Erreur : ' + (err && err.message || err); });
  });

  /* ---------- données ---------- */
  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    loadShip(); loadDisc();
    return Promise.all([
      sb.from('promotions').select('*').order('starts_at', { ascending: false }),
      sb.from('promotion_items').select('*'),
      sb.from('products').select('*').eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true }),
      sb.from('materials').select('*'),
      sb.from('brands').select('name,sort_order')
    ]).then(function (r) {
      var bad = r.filter(function (x) { return x.error; })[0];
      if (bad) { listEl.innerHTML = '<p class="empty">Impossible de charger les promotions.<br>' + esc(bad.error.message || bad.error) + '</p>'; return; }
      promos = r[0].data || [];
      itemsBy = {};
      (r[1].data || []).forEach(function (it) { (itemsBy[it.promo_id] = itemsBy[it.promo_id] || []).push(it); });
      prods = r[2].data || [];
      mats = {}; matOrder = {}; brandOrder = {};
      (r[3].data || []).forEach(function (m, i) { mats[m.brand + '|' + m.name] = m; matOrder[m.brand + '|' + m.name] = m.sort_order != null ? m.sort_order : i; });
      (r[4].data || []).forEach(function (b, i) { brandOrder[b.name] = b.sort_order != null ? b.sort_order : i; });
      loaded = true;
      render();
    });
  }

  /* ---------- prix normaux / coûts ---------- */
  function matOf(p) { return mats[p.brand + '|' + p.material] || null; }
  // prix normal public { r1, r2, t1, t2 }
  function regPublic(p) {
    if (p.type === 'filament') {
      var m = matOf(p);
      return {
        r1: p.offer_spool === false ? null : num(m ? m.sell_spool : p.sell_price),
        r2: p.offer_refill === false ? null : num(m ? m.sell_refill : p.sell_price_2)
      };
    }
    return { r1: num(p.sell_price), r2: null };
  }
  function regDealer(p) { var v = num(p.dealer_price); return v != null ? v : num(p.sell_price); }
  function costOf(p, kind) {
    var C = window.CA.costing;
    if (p.type === 'filament' && C) return C.costOf(p, kind, prods.filter(function (x) { return x.type === 'filament'; }));
    var ac = p.attrs && p.attrs.avg_cost, v = ac ? num(ac.item) : null;
    return v != null ? v : num(p.cost_price);
  }
  function stockOf(p, kind) { return kind === 'refill' ? p.qty_2 : p.qty; }

  /* ---------- groupes ---------- */
  function gkey(p) { return p.type === 'filament' ? 'f|' + (p.brand || '') + '|' + (p.material || '') : p.type === 'spacer' ? 's' : 'a'; }
  function glabel(k, p) {
    if (k === 's') return 'Spacers';
    if (k === 'a') return 'Accessoires';
    return [p.brand, p.material].filter(Boolean).join(' · ') || 'Filaments';
  }
  function groupsOf(list) {
    var map = {}, out = [];
    list.forEach(function (p) {
      var k = gkey(p);
      if (!map[k]) { map[k] = { key: k, label: glabel(k, p), type: p.type, brand: p.brand, material: p.material, items: [] }; out.push(map[k]); }
      map[k].items.push(p);
    });
    var tr = { filament: 0, spacer: 1, accessory: 2 };
    out.sort(function (a, b) {
      return (tr[a.type] - tr[b.type]) ||
        ((brandOrder[a.brand] != null ? brandOrder[a.brand] : 999) - (brandOrder[b.brand] != null ? brandOrder[b.brand] : 999)) ||
        ((matOrder[a.brand + '|' + a.material] != null ? matOrder[a.brand + '|' + a.material] : 999) - (matOrder[b.brand + '|' + b.material] != null ? matOrder[b.brand + '|' + b.material] : 999));
    });
    return out;
  }
  function allowed(p) { return pubI.checked ? true : p.type === 'spacer'; }

  /* ---------- état d'une promo ---------- */
  function statusOf(pr) {
    var now = Date.now();
    if (!pr.enabled) return { k: 'off', t: 'Hors ligne' };
    if (pr.starts_at && new Date(pr.starts_at).getTime() > now) return { k: 'soon', t: 'Planifiée' };
    if (pr.ends_at && new Date(pr.ends_at).getTime() <= now) return { k: 'past', t: 'Terminée' };
    return { k: 'on', t: 'En cours' };
  }
  function sumOf(pr) {
    if (pr.mode === 'percent') return '−' + (+pr.pct) + ' %';
    var its = itemsBy[pr.id] || [], best = 0;
    its.forEach(function (it) {
      var p = prods.filter(function (x) { return x.id === it.product_id; })[0];
      if (!p) return;
      var rg = regPublic(p);
      if (it.price != null && rg.r1) best = Math.max(best, 1 - it.price / rg.r1);
      if (it.price_2 != null && rg.r2) best = Math.max(best, 1 - it.price_2 / rg.r2);
      if (it.dealer_price != null) { var d = regDealer(p); if (d) best = Math.max(best, 1 - it.dealer_price / d); }
    });
    return best > 0 ? 'jusqu\'à −' + Math.round(best * 100) + ' %' : '';
  }

  /* ---------- liste ---------- */
  function render() {
    if (!promos.length) { listEl.innerHTML = '<p class="empty">Aucune promotion. Crée la première avec « Promotion ».</p>'; return; }
    var order = { on: 0, soon: 1, off: 2, past: 3 };
    var rows = promos.slice().sort(function (a, b) { return order[statusOf(a).k] - order[statusOf(b).k]; });
    listEl.innerHTML = rows.map(function (pr) {
      var st = statusOf(pr), its = itemsBy[pr.id] || [];
      var low = 0;
      if (pr.stock_min > 0) its.forEach(function (it) {
        var p = prods.filter(function (x) { return x.id === it.product_id; })[0];
        if (p && p.qty != null && p.qty < pr.stock_min) low++;
      });
      var when = fmtDay(pr.starts_at) + (pr.ends_at ? ' → ' + fmtDay(pr.ends_at) : ' → sans fin');
      var aud = (pr.for_public ? '<span class="pm-tag">Public</span>' : '') + (pr.for_dealer ? '<span class="pm-tag">Dealers</span>' : '');
      return '<div class="pm-row is-' + st.k + '" data-id="' + esc(pr.id) + '">' +
        '<div class="pm-main">' +
          '<div class="pm-top"><b class="pm-title">' + esc(pr.name || 'Sans nom') + '</b><span class="pm-state s-' + st.k + '">' + st.t + '</span>' + aud + '</div>' +
          '<div class="pm-meta">' + esc(when) + ' · ' + its.length + ' article' + (its.length > 1 ? 's' : '') +
            (sumOf(pr) ? ' · ' + esc(sumOf(pr)) : '') +
            (pr.stock_min > 0 ? ' · stop sous ' + pr.stock_min + (low ? ' (' + low + ' sorti' + (low > 1 ? 's' : '') + ')' : '') : '') + '</div>' +
        '</div>' +
        '<div class="pm-acts">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-a="edit">Modifier</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-a="toggle">' + (pr.enabled ? 'Arrêter' : 'Activer') + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-a="copy">Dupliquer</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-a="del" data-ic="trash" aria-label="Supprimer"></button>' +
        '</div></div>';
    }).join('');
  }
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var row = b.closest('.pm-row'), pr = promos.filter(function (x) { return x.id === row.getAttribute('data-id'); })[0];
    if (!pr) return;
    var a = b.getAttribute('data-a');
    if (a === 'edit') openEditor(pr, false);
    else if (a === 'copy') openEditor(pr, true);
    else if (a === 'toggle') {
      sb.from('promotions').update({ enabled: !pr.enabled, updated_at: new Date().toISOString() }).eq('id', pr.id).select().then(function (res) {
        if (res.error) { caDialog.error(res.error); return; }
        pr.enabled = !pr.enabled; render();
      });
    } else if (a === 'del') {
      caDialog.confirm({ title: 'Supprimer cette promotion ?', message: pr.name || '', ok: 'Supprimer', cancel: 'Annuler', danger: true }).then(function (ok) {
        if (!ok) return;
        sb.from('promotions').delete().eq('id', pr.id).select().then(function (res) {
          if (res.error) { caDialog.error(res.error); return; }
          if (!res.data || !res.data.length) { caDialog.error('Suppression refusée (permissions).'); return; }
          if (editingId === pr.id) closeEditor();
          promos = promos.filter(function (x) { return x.id !== pr.id; }); delete itemsBy[pr.id]; render();
        });
      });
    }
  });

  /* ---------- éditeur ---------- */
  function setMode(m) {
    mode = m === 'percent' ? 'percent' : 'price';
    $$('.fx-seg-btn', modeSeg).forEach(function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('is-active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    pctW.hidden = mode !== 'percent';
  }
  function openEditor(pr, copy) {
    if (!loaded) return;
    editingId = pr && !copy ? pr.id : null;
    $('#pm-editor-title').textContent = editingId ? 'Modifier la promotion' : (copy ? 'Copie de la promotion' : 'Nouvelle promotion');
    nameI.value = pr ? (pr.name || '') + (copy ? ' (copie)' : '') : '';
    nameEnI.value = pr ? pr.name_en || '' : '';
    startI.value = pr && !copy ? toDay(pr.starts_at) : toDay(new Date());
    endI.value = pr && !copy ? toDay(pr.ends_at) : '';
    stockI.value = pr ? pr.stock_min || 0 : 0;
    pubI.checked = pr ? pr.for_public : true;
    dealerI.checked = pr ? pr.for_dealer : false;
    pctI.value = pr && pr.pct != null ? +pr.pct : '';
    setMode(pr ? pr.mode : 'price');
    sel = {}; gp = {}; openG = {};
    if (pr) {
      var its = itemsBy[pr.id] || [];
      its.forEach(function (it) {
        var p = prods.filter(function (x) { return x.id === it.product_id; })[0];
        if (!p) return;
        sel[p.id] = true;
        var k = gkey(p);
        if (!gp[k]) gp[k] = {
          price: it.price != null ? +it.price : '', price2: it.price_2 != null ? +it.price_2 : '',
          tiers: tiersIn(it.tiers), tiers2: tiersIn(it.tiers_2),
          dprice: it.dealer_price != null ? +it.dealer_price : '', dtiers: tiersIn(it.dealer_tiers)
        };
      });
    }
    qI.value = '';
    statusEl.textContent = '';
    renderPick(); renderPrices();
    var docked = !!(window.CA.dockEditor && window.CA.dockEditor(editor));
    editor.hidden = false;
    if (docked) { nameI.focus({ preventScroll: true }); editor.parentNode.scrollTop = 0; return; }
    nameI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { editor.hidden = true; editingId = null; }
  function tiersIn(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return { min: t.min, price: t.price }; });
  }
  function gstate(k) { return gp[k] || (gp[k] = { price: '', price2: '', tiers: [], tiers2: [], dprice: '', dtiers: [] }); }

  /* ---------- sélecteur d'articles ---------- */
  function swDot(p) { return p.hex ? '<i class="pm-dot" style="background:' + esc(p.hex) + '"></i>' : ''; }
  function renderPick() {
    var q = fold(qI.value.trim());
    var list = prods.filter(allowed).filter(function (p) {
      return !q || fold([p.name, p.brand, p.material, p.type === 'spacer' ? 'spacer' : ''].join(' ')).indexOf(q) >= 0;
    });
    var gs = groupsOf(list);
    pickEl.innerHTML = gs.map(function (g) {
      var n = g.items.filter(function (p) { return sel[p.id]; }).length;
      var open = openG[g.key] || (q && true);
      return '<details class="pm-g"' + (open ? ' open' : '') + ' data-k="' + esc(g.key) + '">' +
        '<summary><label class="pm-all"><input type="checkbox" data-all="' + esc(g.key) + '"' + (n === g.items.length ? ' checked' : '') + '></label>' +
        '<span class="pm-gname">' + esc(g.label) + '</span><span class="pm-gn">' + n + ' / ' + g.items.length + '</span></summary>' +
        '<div class="pm-chips">' + g.items.map(function (p) {
          var st = p.type === 'filament' ? (p.qty == null ? '' : p.qty) + (p.qty_2 != null ? ' + ' + p.qty_2 : '') : (p.qty == null ? '' : p.qty);
          return '<label class="pm-chip' + (sel[p.id] ? ' is-on' : '') + '"><input type="checkbox" data-pid="' + esc(p.id) + '"' + (sel[p.id] ? ' checked' : '') + '>' +
            swDot(p) + '<span class="pm-cn">' + esc(p.type === 'filament' ? p.name : p.name) + '</span>' +
            (st !== '' ? '<small>' + esc(st) + '</small>' : '') + '</label>';
        }).join('') + '</div></details>';
    }).join('') || '<p class="muted">Aucun article.</p>';
    // état indéterminé des cases de groupe
    $$('.pm-g', pickEl).forEach(function (d) {
      var g = gs.filter(function (x) { return x.key === d.getAttribute('data-k'); })[0]; if (!g) return;
      var n = g.items.filter(function (p) { return sel[p.id]; }).length, cb = $('[data-all]', d);
      cb.indeterminate = n > 0 && n < g.items.length;
    });
  }
  pickEl.addEventListener('toggle', function (e) {
    var d = e.target; if (d && d.classList && d.classList.contains('pm-g')) openG[d.getAttribute('data-k')] = d.open;
  }, true);
  pickEl.addEventListener('click', function (e) {
    if (e.target.closest('.pm-all')) e.stopPropagation();   // la case de groupe ne replie pas le groupe
  });
  pickEl.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-all')) {
      var k = t.getAttribute('data-all'), on = t.checked, q = fold(qI.value.trim());
      prods.filter(allowed).forEach(function (p) {
        if (gkey(p) !== k) return;
        if (q && fold([p.name, p.brand, p.material].join(' ')).indexOf(q) < 0) return;
        if (on) sel[p.id] = true; else delete sel[p.id];
      });
    } else if (t.hasAttribute('data-pid')) {
      if (t.checked) sel[t.getAttribute('data-pid')] = true; else delete sel[t.getAttribute('data-pid')];
    } else return;
    renderPick(); renderPrices();
  });
  qI.addEventListener('input', renderPick);
  pubI.addEventListener('change', function () {
    if (!pubI.checked) { prods.forEach(function (p) { if (p.type !== 'spacer') delete sel[p.id]; }); if (!dealerI.checked) dealerI.checked = true; }
    renderPick(); renderPrices();
  });
  dealerI.addEventListener('change', function () {
    if (!dealerI.checked && !pubI.checked) pubI.checked = true;
    renderPick(); renderPrices();
  });
  $$('.fx-seg-btn', modeSeg).forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); renderPrices(); });
  });
  pctI.addEventListener('input', function () { updateAllMargins(); });

  /* ---------- cartes de prix ---------- */
  function selGroups() { return groupsOf(prods.filter(function (p) { return sel[p.id]; })); }
  function groupRegs(g) {
    var o = { r1: null, r2: null, d: null };
    g.items.forEach(function (p) {
      var r = regPublic(p);
      if (r.r1 != null && (o.r1 == null || r.r1 > o.r1)) o.r1 = r.r1;
      if (r.r2 != null && (o.r2 == null || r.r2 > o.r2)) o.r2 = r.r2;
      var d = regDealer(p); if (d != null && (o.d == null || d > o.d)) o.d = d;
    });
    return o;
  }
  function groupCost(g, kind) {
    var c = null;
    g.items.forEach(function (p) { var v = costOf(p, kind); if (v != null && (c == null || v > c)) c = v; });
    return c;
  }
  function tierRowsHtml(arr, f) {
    return arr.map(function (t, i) {
      return '<div class="tier-row" data-i="' + i + '"><span class="t">À partir de</span>' +
        '<input type="number" class="tier-min" min="1" step="1" placeholder="4" value="' + (t.min != null ? esc(t.min) : '') + '" data-f="' + f + '" data-ti="' + i + '" data-tk="min">' +
        '<span class="t">→</span>' +
        '<input type="number" class="tier-price money" min="0" step="0.01" placeholder="18.00" value="' + (t.price != null ? esc(t.price) : '') + '" data-f="' + f + '" data-ti="' + i + '" data-tk="price">' +
        '<span class="t">$ ch.</span><button type="button" class="tier-del" aria-label="Retirer ce palier" data-tdel="' + f + ':' + i + '">✕</button></div>';
    }).join('');
  }
  function priceField(label, f, val, reg) {
    return '<div class="field"><label class="lbl">' + label + '</label>' +
      '<div class="pm-inp"><input type="number" class="money" min="0" step="0.01" data-f="' + f + '" value="' + (val !== '' && val != null ? esc(val) : '') + '" placeholder="' + (reg != null ? r2(reg * 0.85).toFixed(2) : '') + '" inputmode="decimal">' +
      '<span class="pm-reg">' + (reg != null ? 'normal ' + money(reg) : '') + '</span></div>' +
      '<span class="pm-m" data-m="' + f + '"></span></div>';
  }
  function tiersField(label, f, arr) {
    return '<div class="field col-2"><label class="lbl">' + label + '</label><div class="tiers" data-tl="' + f + '">' + tierRowsHtml(arr, f) + '</div>' +
      '<div><button type="button" class="btn btn-ghost btn-sm" data-tadd="' + f + '" data-ic="plus">Palier</button></div></div>';
  }
  function renderPrices() {
    var gs = selGroups();
    pricesW.hidden = !gs.length;
    if (!gs.length) { pricesEl.innerHTML = ''; return; }
    var pub = pubI.checked, dl = dealerI.checked;
    pricesEl.innerHTML = gs.map(function (g) {
      var s = gstate(g.key), rg = groupRegs(g), fil = g.type === 'filament', spa = g.type === 'spacer';
      var body = '';
      if (mode === 'percent') {
        body = '<div class="pm-calc" data-calc="1"></div>';
      } else {
        body += '<div class="grid">';
        if (pub) {
          if (fil) {
            if (rg.r1 != null) body += priceField('Bobine', 'price', s.price, rg.r1);
            if (rg.r2 != null) body += priceField('Recharge', 'price2', s.price2, rg.r2);
          } else body += priceField('Prix', 'price', s.price, rg.r1);
          if (!spa) {
            if (fil) {
              if (rg.r1 != null) body += tiersField('Paliers bobine', 'tiers', s.tiers);
              if (rg.r2 != null) body += tiersField('Paliers recharge', 'tiers2', s.tiers2);
            } else body += tiersField('Paliers', 'tiers', s.tiers);
          }
        }
        if (spa && dl) {
          body += priceField('Prix dealer', 'dprice', s.dprice, rg.d);
          body += tiersField('Paliers dealer', 'dtiers', s.dtiers);
        }
        body += '</div>';
      }
      return '<div class="pm-card" data-k="' + esc(g.key) + '"><div class="pm-ch"><b>' + esc(g.label) + '</b><span>' + g.items.filter(function (p) { return sel[p.id]; }).length + ' article' + (g.items.filter(function (p) { return sel[p.id]; }).length > 1 ? 's' : '') + '</span></div>' + body + '</div>';
    }).join('');
    updateAllMargins();
  }
  function marginHtml(price, cost, reg) {
    if (price == null || price === '') return '';
    var out = '';
    if (reg != null && price >= reg) return '<span class="neg">Pas un rabais</span>';
    if (reg != null) out += '−' + Math.round((1 - price / reg) * 100) + ' %';
    if (cost != null && price > 0) {
      var m = (price - cost) / price * 100;
      out += (out ? ' · ' : '') + '<span class="' + (m < 0 ? 'neg' : 'pos') + '">Marge ' + Math.round(m) + ' %</span>';
    }
    return out;
  }
  function updateMargins(card) {
    var k = card.getAttribute('data-k'), g = selGroups().filter(function (x) { return x.key === k; })[0]; if (!g) return;
    var s = gstate(k), rg = groupRegs(g);
    if (mode === 'percent') {
      var pc = num(pctI.value), el = $('[data-calc]', card); if (!el) return;
      if (pc == null) { el.innerHTML = ''; return; }
      var rows = [];
      function line(lab, reg, cost) { if (reg == null) return; var np = r2(reg * (1 - pc / 100)); rows.push('<div class="pm-cl"><span>' + lab + '</span><b>' + money(reg) + ' → ' + money(np) + '</b><span class="pm-m">' + marginHtml(np, cost, reg) + '</span></div>'); }
      if (pubI.checked) { line(g.type === 'filament' ? 'Bobine' : 'Prix', rg.r1, groupCost(g, 'spool')); if (g.type === 'filament') line('Recharge', rg.r2, groupCost(g, 'refill')); }
      if (g.type === 'spacer' && dealerI.checked) line('Dealer', rg.d, groupCost(g, 'spool'));
      el.innerHTML = rows.join('');
      return;
    }
    var map = { price: [rg.r1, 'spool'], price2: [rg.r2, 'refill'], dprice: [rg.d, 'spool'] };
    Object.keys(map).forEach(function (f) {
      var span = $('[data-m="' + f + '"]', card); if (!span) return;
      span.innerHTML = marginHtml(num(s[f]), groupCost(g, map[f][1]), map[f][0]);
    });
  }
  function updateAllMargins() { $$('.pm-card', pricesEl).forEach(updateMargins); }

  pricesEl.addEventListener('input', function (e) {
    var t = e.target, card = t.closest('.pm-card'); if (!card) return;
    var s = gstate(card.getAttribute('data-k')), f = t.getAttribute('data-f');
    if (!f) return;
    if (t.hasAttribute('data-ti')) s[f][+t.getAttribute('data-ti')][t.getAttribute('data-tk')] = t.value === '' ? null : num(t.value);
    else s[f] = t.value;
    updateMargins(card);
  });
  pricesEl.addEventListener('click', function (e) {
    var card = e.target.closest('.pm-card'); if (!card) return;
    var s = gstate(card.getAttribute('data-k')), add = e.target.closest('[data-tadd]'), del = e.target.closest('[data-tdel]');
    if (add) { s[add.getAttribute('data-tadd')].push({ min: null, price: null }); renderPrices(); }
    else if (del) { var p = del.getAttribute('data-tdel').split(':'); s[p[0]].splice(+p[1], 1); renderPrices(); }
  });

  /* ---------- enregistrement ---------- */
  function cleanTiers(arr) {
    return (arr || []).map(function (t) { return { min: parseInt(t.min, 10), price: num(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 1 && t.price != null && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; })
      .map(function (t) { return { min: t.min, price: r2(t.price) }; });
  }
  editor.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = nameI.value.trim();
    if (!name) { statusEl.textContent = 'Nom requis.'; nameI.focus(); return; }
    var starts = fromDay(startI.value, false) || new Date().toISOString(), ends = fromDay(endI.value, true);
    if (ends && ends <= starts) { statusEl.textContent = 'La fin doit suivre le début.'; endI.focus(); return; }
    var chosen = prods.filter(function (p) { return sel[p.id]; });
    if (!chosen.length) { statusEl.textContent = 'Choisis au moins un article.'; return; }
    var pct = num(pctI.value);
    if (mode === 'percent' && (pct == null || pct < 1 || pct > 95)) { statusEl.textContent = 'Rabais entre 1 et 95 %.'; pctI.focus(); return; }
    var pub = pubI.checked, dl = dealerI.checked, warn = [];
    var items = chosen.map(function (p) {
      var s = gstate(gkey(p)), it = { product_id: p.id, price: null, price_2: null, tiers: [], tiers_2: [], dealer_price: null, dealer_tiers: [] };
      if (mode === 'price') {
        var rg = regPublic(p);
        if (pub) {
          it.price = num(s.price); it.price_2 = p.type === 'filament' ? num(s.price2) : null;
          if (p.type !== 'spacer') { it.tiers = cleanTiers(s.tiers); it.tiers_2 = p.type === 'filament' ? cleanTiers(s.tiers2) : []; }
          if (it.price != null && rg.r1 != null && it.price >= rg.r1) warn.push(name + ' : le prix de ' + p.name + ' n\'est pas un rabais.');
        }
        if (dl && p.type === 'spacer') { it.dealer_price = num(s.dprice); it.dealer_tiers = cleanTiers(s.dtiers); }
      }
      return it;
    });
    if (mode === 'price') {
      var none = items.filter(function (it) { return it.price == null && it.price_2 == null && it.dealer_price == null; }).length;
      if (none === items.length) { statusEl.textContent = 'Entre au moins un prix promo.'; return; }
    }
    var below = [];
    chosen.forEach(function (p, i) {
      var it = items[i], pc = mode === 'percent' ? pct : null;
      function chk(price, reg, cost) { if (cost == null) return; var np = pc != null && reg != null ? r2(reg * (1 - pc / 100)) : price; if (np != null && np < cost) below.push(p.name); }
      var rg = regPublic(p);
      if (pub) { chk(it.price, rg.r1, costOf(p, 'spool')); if (p.type === 'filament') chk(it.price_2, rg.r2, costOf(p, 'refill')); }
      if (dl && p.type === 'spacer') chk(it.dealer_price, regDealer(p), costOf(p, 'spool'));
    });
    var bad = warn[0];
    if (bad) { statusEl.textContent = bad.replace(name + ' : ', ''); return; }
    var go = below.length
      ? caDialog.confirm({ title: 'Prix sous le coût', message: below.slice(0, 6).join(', ') + (below.length > 6 ? '…' : '') + ' se vendraient sous le coût moyen.', ok: 'Enregistrer quand même', cancel: 'Corriger', danger: true })
      : Promise.resolve(true);
    go.then(function (ok) { if (ok) doSave(name, starts, ends, pct, items); });
  });
  function doSave(name, starts, ends, pct, items) {
    var row = {
      name: name, name_en: nameEnI.value.trim() || null, mode: mode, pct: mode === 'percent' ? pct : null,
      starts_at: starts, ends_at: ends, stock_min: Math.max(0, parseInt(stockI.value, 10) || 0),
      for_public: pubI.checked, for_dealer: dealerI.checked, updated_at: new Date().toISOString()
    };
    saveBtn.disabled = true; statusEl.textContent = 'Enregistrement…';
    var isNew = !editingId;
    var p = editingId
      ? sb.from('promotions').update(row).eq('id', editingId).select().then(function (r) { if (r.error) throw r.error; if (!r.data || !r.data.length) throw new Error('Enregistrement refusé (permissions).'); return r.data[0]; })
      : sb.from('promotions').insert(Object.assign({ enabled: true }, row)).select().then(function (r) { if (r.error) throw r.error; return r.data[0]; });
    p.then(function (saved) {
      return sb.from('promotion_items').delete().eq('promo_id', saved.id).then(function (d) {
        if (d.error) throw d.error;
        var rows = items.map(function (it) { return Object.assign({ promo_id: saved.id }, it); });
        return sb.from('promotion_items').insert(rows).then(function (r) { if (r.error) throw r.error; return saved; });
      });
    }).then(function (saved) {
      if (isNew) return proposeNews(saved, items.length).then(function () { return saved; });
      return saved;
    }).then(function () {
      closeEditor(); return load();
    }).catch(function (err) {
      caDialog.error(err);
    }).then(function () { saveBtn.disabled = false; statusEl.textContent = ''; });
  }
  // Nouvelle de type promo, proposée (inactive) : à approuver dans Accueil › Nouvelles
  function proposeNews(pr, n) {
    var body = n + ' article' + (n > 1 ? 's' : '') + ' en promotion' + (pr.ends_at ? ', jusqu\'au ' + fmtDay(pr.ends_at) : '') + '.';
    return Promise.resolve(sb.from('news').insert({
      kind: 'promo', title: pr.name, body: body, cta_label: 'Voir les promotions', cta_url: 'boutique.html?promo=1',
      starts_at: pr.starts_at, ends_at: pr.ends_at, active: false, proposed: true, in_bar: true
    })).then(function () {}, function () {});
  }

  $('#pm-new').addEventListener('click', function () { openEditor(null, false); });
  $('#pm-refresh').addEventListener('click', load);
  $('#pm-cancel').addEventListener('click', closeEditor);

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'promotions') load();
  };
})();
