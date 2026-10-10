/* =========================================================
   Création Audio V2 — Inventaire
   Sous-onglets :
   1) RÉCEPTION (scan) — on choisit une commande « en route » et on la
      pointe au scanner (reçu / attendu, − / + à la main, lignes ajoutées).
      Codes appris une fois (attrs.barcodes.{spool,refill}) puis reconnus.
      Confirmer -> receive_stock + archive au prix payé de la commande
      (taxes incluses) -> coût moyen (attrs.avg_cost) + dernier prix (attrs.last_cost).
   2) À COMMANDER — cible de stock par format (attrs.par_spool /
      attrs.par_refill). Manque = cible + réservés − stock − en route,
      regroupé en liste de commande copiable.
   3) CODES-BARRES, 4) LISTE D'ATTENTE.
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
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
  function swatchBg(hex, colors) {
    var cs = (Array.isArray(colors) ? colors : []).filter(isHex);
    if (cs.length >= 2) {
      var n = cs.length, parts = [];
      for (var i = 0; i < n; i++) { parts.push(cs[i] + ' ' + (100 * i / n) + '%', cs[i] + ' ' + (100 * (i + 1) / n) + '%'); }
      return 'linear-gradient(90deg,' + parts.join(',') + ')';
    }
    return cs[0] || (isHex(hex) ? hex : '#c9c9c4');
  }
  function colorsOf(row) { return row && row.attrs && Array.isArray(row.attrs.colors) ? row.attrs.colors.filter(isHex) : []; }

  var loaded = false, filaments = [];

  var editor = $('#r-editor'), editorTitle = $('#r-editor-title'), dateI = $('#r-date'), addLineBtn = $('#r-add-line'),
      rowsEl = $('#r-rows'), emptyHint = $('#r-empty-hint'),
      confirmBtn = $('#r-confirm'), resetBtn = $('#r-reset'), statusEl = $('#r-status'),
      historyEl = $('#r-history'), refreshBtn = $('#r-refresh'),
      pickEl = $('#rv-pick'), ordersEl = $('#rv-orders'), freeBtn = $('#rv-free'), workEl = $('#rv-work'),
      metaEl = $('#rv-meta'), barEl = $('#rv-bar'), barFill = $('#rv-bar-fill');

  function num(v) { if (v == null || v === '') return null; var n = +v; return isFinite(n) ? n : null; }
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }
  function money(n) { return round2(n).toFixed(2).replace('.', ',') + ' $'; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x != null && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
  // coût connu d'un article : coût moyen de ses réceptions (sinon moyenne de la même matière) ;
  // accessoire : son coût moyen, sinon le coût saisi sur sa fiche
  function costOf(f, kind) {
    if (!f) return null;
    if (isAcc(f)) { var ai = f.attrs && f.attrs.avg_cost && f.attrs.avg_cost.item; return num(ai != null ? ai : f.cost_price); }
    return window.CA.costing.costOf(f, kind, filaments);
  }
  // estimé de la liste à commander : le dernier prix payé, sinon le coût connu
  function estCostOf(f, kind) {
    var lc = f && f.attrs && f.attrs.last_cost;
    var v = lc ? num(lc[kind]) : null;
    return v != null ? v : costOf(f, kind);
  }

  /* ---- activation quand on ouvre l'onglet ---- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name !== 'inventaire') return;
    if (!loaded) { ensureLoad(); return; }
    // déjà chargé : une vente (facturation) ou une réception a pu changer le stock
    // depuis la dernière visite -> on relit le stock et on rafraîchit « À commander ».
    loadFilaments().then(function () { renderReorder(); renderCodes(); });
  };
  function ensureLoad() {
    if (loaded) return;
    loaded = true;
    if (!dateI.value) dateI.value = todayISO();
    Promise.all([
      window.CA.loadMaterials ? window.CA.loadMaterials() : Promise.resolve(),
      loadFilaments(), loadAccessories()
    ]).then(function () { renderPick(); loadHistory(); renderReorder(); renderCodes(); }, function () { loadHistory(); });
  }

  // toutes marques confondues (une réception peut mélanger, on rattache par code-barres appris)
  function loadFilaments() {
    return sb.from('products')
      .select('id,name,material,code,brand,hex,attrs,qty,qty_2,offer_spool,offer_refill')
      .eq('type', 'filament')
      .order('brand', { ascending: true }).order('material', { ascending: true })
      .order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) { filaments = (res.data || []); });
  }

  // accessoires (bobines vides, etc.) : Codes-barres + Réception (attrs.barcodes.item, kind 'item' -> qty)
  var accessories = [];
  function loadAccessories() {
    return sb.from('products').select('id,name,attrs,qty,cost_price,sell_price').eq('type', 'accessory')
      .order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) { accessories = (res.data || []); });
  }

  function filProd(id) { return filaments.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function matOf(f) { return f && window.CA.materialOf ? window.CA.materialOf(f.brand, f.material) : null; }
  function matHasSpool(f) { var m = matOf(f); return !!(m && m.sell_spool != null); }
  function matHasRefill(f) { var m = matOf(f); return !!(m && m.sell_refill != null); }
  // format réellement vendu pour CETTE couleur = matériau l'offre ET la couleur ne l'a pas désactivé
  function offersSpool(f) { return matHasSpool(f) && f.offer_spool !== false; }
  function offersRefill(f) { return matHasRefill(f) && f.offer_refill !== false; }
  function filLabel(f) { return (f.brand ? f.brand + ' · ' : '') + (f.material ? f.material + ' · ' : '') + (f.name || '(sans nom)'); }
  function kindLabel(k) { return k === 'item' ? 'article' : (k === 'refill' ? 'recharge' : 'bobine'); }
  function accProd(id) { return accessories.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function isAcc(p) { return !!p && accessories.indexOf(p) !== -1; }
  // deux accessoires peuvent porter le même nom : la description les distingue
  function accLabel(a) {
    var d = a.attrs && a.attrs.description;
    var dup = accessories.some(function (x) { return x !== a && x.name === a.name; });
    return (a.name || '(sans nom)') + (dup && d ? ' — ' + d : '');
  }
  function bcProd(id) { return filProd(id) || accProd(id); }
  function bcLabel(p) { return isAcc(p) ? accLabel(p) : filLabel(p); }

  /* ---- API pour cms-en-route.js (commandes fournisseur « en route ») ---- */
  window.CA.inv = {
    ready: function () { ensureLoad(); return Promise.all([loadFilaments(), loadAccessories()]); },
    filaments: function () { return filaments; },
    accessories: function () { return accessories; },
    prod: function (id) { return bcProd(id); },
    label: function (p) { return bcLabel(p); },
    isAcc: function (p) { return isAcc(p); },
    offersSpool: function (f) { return offersSpool(f); },
    offersRefill: function (f) { return offersRefill(f); },
    fitKind: function (p, k) { return fitKind(p, k); },
    cost: function (p, k) { return costOf(p, k); },
    // « Recevoir » une commande en route : ouvre son pointage dans Réception
    receiveOrder: function (id) {
      if (window.CA.route && window.CA.route.goSub) window.CA.route.goSub('reception'); else showSub('reception');
      receiveOrder(id);
    }
  };

  /* =========================================================
     SOUS-ONGLETS
     ========================================================= */
  var subReception = $('#inv-sub-reception'), subCommander = $('#inv-sub-commander'),
      subCodes = $('#inv-sub-codes'), subAttente = $('#inv-sub-attente');
  // bascule DOM du sous-onglet (l'URL est gérée par le routing de admin-core)
  function showSub(sub) {
    if (['commander', 'codes', 'attente'].indexOf(sub) < 0) sub = 'reception';
    $$('.inv-subtab').forEach(function (b) {
      var on = b.getAttribute('data-sub') === sub;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    });
    if (subReception) subReception.hidden = (sub !== 'reception');
    if (subCommander) subCommander.hidden = (sub !== 'commander');
    if (subCodes) subCodes.hidden = (sub !== 'codes');
    if (subAttente) subAttente.hidden = (sub !== 'attente');
    if (sub === 'commander') renderReorder();
    if (sub === 'reception') renderPick();
    if (sub === 'codes') renderCodes();
    if (sub === 'reception' && scanActive) focusScan();
  }
  $$('.inv-subtab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var sub = btn.getAttribute('data-sub');
      // le sous-onglet a son URL (#inventaire/reception|commander) -> retour navigateur OK
      if (window.CA.route && window.CA.route.goSub) window.CA.route.goSub(sub);
      else showSub(sub);
    });
  });
  // applique le sous-onglet quand l'URL change (retour navigateur, lien direct)
  if (window.CA.route && window.CA.route.onSub) {
    window.CA.route.onSub(function (sub, tab) { if (tab === 'inventaire') showSub(sub); });
  }

  /* =========================================================
     RÉCEPTION — pointage d'une commande en route
     On choisit une commande « en route » (cms-en-route.js), le scanner s'arme et
     chaque scan coche +1 sur la bonne ligne (reçu / attendu). Les boutons − / +
     comptent à la main (code-barres illisible) ; « Ajouter une ligne » pour un
     article imprévu. Le prix payé vient de la commande (taxes du fournisseur
     incluses) : rien à saisir ici.
     rows : [{ productId, kind, qty (reçu), expected (attendu ; 0 = hors commande ;
              null = sans commande / modification), label, unitCost (prix de la
              commande, avant taxes), oldCost (modification : prix déjà enregistré),
              free (ligne ajoutée à la main : article au choix) }]
     ========================================================= */
  var rows = [];
  var current = null;          // commande en route pointée ; null = sans commande
  var editingReceipt = null;   // réception de l'historique en cours de modification
  var editingOldLines = [];

  function filamentOptions(selected) {
    function opt(p, label) { return '<option value="' + esc(p.id) + '"' + (String(p.id) === String(selected) ? ' selected' : '') + '>' + esc(label(p)) + '</option>'; }
    var fils = filaments.map(function (f) { return opt(f, filLabel); }).join('');
    if (!accessories.length) return '<option value="">— choisir —</option>' + fils;
    return '<option value="">— choisir —</option>' +
      '<optgroup label="Filaments">' + fils + '</optgroup>' +
      '<optgroup label="Accessoires">' + accessories.map(function (a) { return opt(a, accLabel); }).join('') + '</optgroup>';
  }
  // format d'une ligne selon le produit : accessoire -> 'item', filament -> bobine/recharge offert
  function fitKind(p, kind) {
    if (isAcc(p)) return 'item';
    if (kind === 'item') kind = 'spool';
    if (p && kind === 'refill' && !offersRefill(p) && offersSpool(p)) return 'spool';
    if (p && kind === 'spool' && !offersSpool(p) && offersRefill(p)) return 'refill';
    return kind;
  }
  function orderRemaining(l) { return Math.max(0, (l.qty | 0) - (l.qty_received | 0)); }
  function enRouteList() { return window.CA.enRoute && window.CA.enRoute.list ? window.CA.enRoute.list() : []; }

  // choix de la commande à recevoir
  function renderPick() {
    if (!ordersEl) return;
    var list = enRouteList();
    if (!list.length) {
      ordersEl.innerHTML = '<p class="po-none">Aucune commande en route. Ajoute-les dans « À commander ».</p>';
      return;
    }
    ordersEl.innerHTML = list.map(function (o) {
      var left = 0, got = 0;
      o.lines.forEach(function (l) { left += orderRemaining(l); got += Math.min(l.qty | 0, l.qty_received | 0); });
      return '<div class="rv-order" data-id="' + esc(o.id) + '">' +
        '<div class="rv-order-main">' +
          '<span class="po-num">' + esc(o.order_number || 'Sans n°') + '</span>' +
          '<span class="po-meta">' + esc([o.supplier, o.ordered_at].filter(Boolean).join(' · ')) + '</span>' +
          '<span class="po-prog">' + left + ' attendu' + (left > 1 ? 's' : '') + (got ? ' · ' + got + ' déjà reçu' + (got > 1 ? 's' : '') : '') + '</span>' +
        '</div>' +
        '<button type="button" class="btn btn-accent btn-sm rv-go" data-ic="scan">Recevoir</button>' +
      '</div>';
    }).join('');
    $$('.rv-go', ordersEl).forEach(function (b) {
      b.addEventListener('click', function () { receiveOrder(b.closest('.rv-order').getAttribute('data-id')); });
    });
  }
  document.addEventListener('ca:enroute', function () { if (loaded) renderPick(); });
  if (freeBtn) freeBtn.addEventListener('click', function () { startWork(null); });

  function receiveOrder(id) {
    var go = function () {
      var o = enRouteList().filter(function (x) { return String(x.id) === String(id); })[0];
      if (o) startWork(o);
    };
    if (!loaded) { ensureLoad(); setTimeout(go, 600); } else go();
  }

  // ouvre le pointage : une commande (o), sans commande (null), ou la modification d'une réception (rc)
  function startWork(o, rc, oldLines) {
    current = rc ? null : (o || null);
    editingReceipt = rc || null;
    editingOldLines = oldLines || [];
    rows = [];
    if (rc) {
      rows = editingOldLines.map(function (l) {
        return { productId: l.product_id ? String(l.product_id) : '', kind: l.kind === 'refill' ? 'refill' : (l.kind === 'item' ? 'item' : 'spool'),
          qty: l.qty | 0, expected: null, label: l.label || '', oldCost: l.unit_cost != null ? +l.unit_cost : null };
      });
    } else if (current) {
      // une ligne par article + format : ce qui reste à recevoir, au prix moyen de la commande
      var byKey = {};
      current.lines.forEach(function (l) {
        var left = orderRemaining(l); if (!left || !l.product_id) return;
        var p = bcProd(l.product_id), kind = fitKind(p, l.kind), k = l.product_id + '|' + kind;
        var r = byKey[k];
        if (!r) { r = byKey[k] = { productId: String(l.product_id), kind: kind, qty: 0, expected: 0, label: l.label || '', unitCost: null, sum: 0, priced: 0 }; rows.push(r); }
        r.expected += left;
        if (l.unit_cost != null) { r.sum += (+l.unit_cost) * left; r.priced += left; }
      });
      rows.forEach(function (r) { r.unitCost = r.priced ? round2(r.sum / r.priced) : null; delete r.sum; delete r.priced; });
    }
    editorTitle.textContent = rc ? 'Modifier la réception' : (current ? 'Réception · ' + (current.order_number || 'commande sans n°') : 'Réception sans commande');
    metaEl.textContent = rc ? [rc.order_number, rc.received_at].filter(Boolean).join(' · ')
      : current ? [current.supplier, current.ordered_at].filter(Boolean).join(' · ') : '';
    dateI.value = rc ? (rc.received_at || todayISO()) : todayISO();
    confirmBtn.textContent = rc ? 'Enregistrer les modifications' : 'Confirmer la réception';
    statusEl.textContent = '';
    feedback('', ''); closeLearn();
    if (pickEl) pickEl.hidden = true;
    if (workEl) workEl.hidden = false;
    renderRows();
    setScanActive(true);
    setTimeout(function () { (workEl || editor).scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 40);
  }
  function closeWork() {
    setScanActive(false);
    rows = []; current = null; editingReceipt = null; editingOldLines = [];
    statusEl.textContent = '';
    if (workEl) workEl.hidden = true;
    if (pickEl) pickEl.hidden = false;
    renderPick();
  }
  if (resetBtn) resetBtn.addEventListener('click', closeWork);

  function stateOf(r) {
    if (r.expected == null) return null;
    if (r.expected === 0) return ['off', 'Hors commande'];
    if (r.qty === r.expected) return ['ok', '✓ Reçu'];
    if (r.qty > r.expected) return ['over', '+' + (r.qty - r.expected) + ' de trop'];
    return ['wait', 'Manque ' + (r.expected - r.qty)];
  }
  function artName(f) { return isAcc(f) ? accLabel(f) : ((f.material ? f.material + ' · ' : '') + (f.name || '(sans nom)')); }
  function kindTxt(k) { return k === 'item' ? 'Article' : (k === 'refill' ? 'Recharge' : 'Bobine'); }

  function renderRows(flashIdx) {
    var table = rowsEl.closest('table');
    if (table) table.classList.toggle('rv-noexp', !rows.some(function (r) { return r.expected != null; }));
    if (!rows.length) { rowsEl.innerHTML = ''; emptyHint.style.display = ''; updateScanCount(); return; }
    emptyHint.style.display = 'none';
    rowsEl.innerHTML = rows.map(function (r, i) {
      var f = bcProd(r.productId), acc = isAcc(f), st = stateOf(r);
      var art = r.free
        ? '<select class="rcp-fil-sel" aria-label="Article">' + filamentOptions(r.productId) + '</select>'
        : '<div class="rv-art">' + (f && !acc ? '<span class="ro-sw" style="background:' + esc(swatchBg(f.hex, colorsOf(f))) + '"></span>' : '') +
            '<span>' + esc(f ? artName(f) : (r.label || '(article retiré)')) + '</span></div>';
      var fmt = r.free && !acc
        ? '<select class="rcp-kind" aria-label="Format">' +
            '<option value="spool"' + (r.kind !== 'refill' ? ' selected' : '') + (!f || offersSpool(f) ? '' : ' disabled') + '>Bobine</option>' +
            '<option value="refill"' + (r.kind === 'refill' ? ' selected' : '') + (!f || offersRefill(f) ? '' : ' disabled') + '>Recharge</option>' +
          '</select>'
        : '<span class="rv-kind">' + kindTxt(acc ? 'item' : r.kind) + '</span>';
      var removable = r.free || !r.expected;
      return '<tr class="rcp-row' + (r.productId ? '' : ' unmatched') + (st ? ' is-' + st[0] : '') + (flashIdx === i ? ' rv-flash' : '') + '" data-i="' + i + '">' +
        '<td class="rcp-fil">' + art + '</td>' +
        '<td>' + fmt + '</td>' +
        '<td class="num"><div class="rv-step">' +
          '<button type="button" class="rv-minus" aria-label="Un de moins">−</button>' +
          '<input type="number" class="rcp-qty num" min="0" step="1" value="' + (r.qty | 0) + '" aria-label="Reçu">' +
          '<button type="button" class="rv-plus" aria-label="Un de plus">+</button>' +
        '</div></td>' +
        '<td class="num rv-exp">' + (r.expected > 0 ? r.expected : '—') + '</td>' +
        '<td class="rv-stc">' + (st ? '<span class="rv-st is-' + st[0] + '">' + st[1] + '</span>' : '') + '</td>' +
        '<td>' + (removable ? '<button type="button" class="rcp-row-del" aria-label="Retirer la ligne">✕</button>' : '') + '</td>' +
      '</tr>';
    }).join('');

    $$('.rcp-row', rowsEl).forEach(function (tr) {
      var i = +tr.getAttribute('data-i'), r = rows[i];
      var sel = $('.rcp-fil-sel', tr);
      if (sel) sel.addEventListener('change', function () { r.productId = this.value; r.kind = fitKind(bcProd(this.value), r.kind); renderRows(); focusScan(); });
      var kindSel = $('.rcp-kind', tr);
      if (kindSel) kindSel.addEventListener('change', function () { r.kind = this.value; renderRows(); focusScan(); });
      var qty = $('.rcp-qty', tr);
      qty.addEventListener('input', function () { r.qty = Math.max(0, parseInt(this.value, 10) || 0); updateScanCount(); });
      qty.addEventListener('change', function () { renderRows(); focusScan(); });
      $('.rv-minus', tr).addEventListener('click', function () { r.qty = Math.max(0, (r.qty | 0) - 1); renderRows(); focusScan(); });
      $('.rv-plus', tr).addEventListener('click', function () { r.qty = (r.qty | 0) + 1; renderRows(i); focusScan(); });
      var del = $('.rcp-row-del', tr);
      if (del) del.addEventListener('click', function () { rows.splice(i, 1); renderRows(); focusScan(); });
    });
    updateScanCount();
  }

  // ligne vide : article imprévu, ou code-barres qui ne passe pas
  if (addLineBtn) addLineBtn.addEventListener('click', function () {
    rows.push({ productId: '', kind: 'spool', qty: 1, expected: current ? 0 : null, label: '', free: true });
    renderRows();
    var sel = rowsEl.querySelector('tr:last-child .rcp-fil-sel'); if (sel) sel.focus();
  });

  /* =========================================================
     POSTE DE SCAN
     ========================================================= */
  var scanStation = $('#scan-station'), scanToggle = $('#scan-toggle'), scanInput = $('#scan-input'),
      scanCount = $('#scan-count'), scanFeedback = $('#scan-feedback'),
      scanLearn = $('#scan-learn'), scanLearnCode = $('#scan-learn-code'),
      scanLearnFil = $('#scan-learn-fil'), scanLearnKind = $('#scan-learn-kind'),
      scanLearnSave = $('#scan-learn-save'), scanLearnCancel = $('#scan-learn-cancel');

  var scanActive = false;
  var learnOpen = false;
  var pendingCode = '';   // code inconnu en attente d'association

  function focusScan() { try { scanInput.focus(); } catch (e) {} }

  function setScanActive(on) {
    scanActive = !!on;
    scanInput.disabled = !scanActive;
    scanStation.classList.toggle('is-armed', scanActive);
    scanToggle.setAttribute('aria-pressed', String(scanActive));
    scanToggle.textContent = scanActive ? 'Mettre en pause' : 'Reprendre le scan';
    scanToggle.dataset.ic = scanActive ? 'pause' : 'scan';
    scanInput.placeholder = scanActive ? 'Scanne un article…' : 'Scan en pause';
    if (scanActive) { scanInput.value = ''; focusScan(); }
    else { closeLearn(); }
  }
  if (scanToggle) scanToggle.addEventListener('click', function () { setScanActive(!scanActive); });

  // Garde la case de scan active : si le focus part « dans le vide » pendant une réception,
  // on le rend à la case (mais on laisse l'utilisateur cliquer dans le tableau, le n°/date, etc.).
  if (scanInput) scanInput.addEventListener('blur', function () {
    setTimeout(function () {
      if (!scanActive || learnOpen) return;
      var a = document.activeElement;
      if (a && a !== document.body && a.closest &&
          a.closest('#r-rows, #scan-learn, .editor-actions, #r-date, #r-add-line, .inv-subtab')) return;
      focusScan();
    }, 40);
  });

  // Entrée = fin d'un code scanné.
  if (scanInput) scanInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    var code = (scanInput.value || '').trim();
    scanInput.value = '';
    if (code) processScan(code);
  });

  // index code-barres -> { f, kind } (recalculé à chaud car peu d'entrées)
  function findByBarcode(code) {
    for (var i = 0; i < filaments.length; i++) {
      var b = filaments[i].attrs && filaments[i].attrs.barcodes;
      if (!b) continue;
      if (b.spool && String(b.spool) === code) return { f: filaments[i], kind: 'spool' };
      if (b.refill && String(b.refill) === code) return { f: filaments[i], kind: 'refill' };
    }
    for (var j = 0; j < accessories.length; j++) {
      var a = accessories[j].attrs && accessories[j].attrs.barcodes;
      if (a && a.item && String(a.item) === code) return { f: accessories[j], kind: 'item' };
    }
    return null;
  }
  function scanLabel(f, kind) { return bcLabel(f) + (kind === 'item' ? '' : ' · ' + kindLabel(kind)); }

  function feedback(msg, cls) {
    scanFeedback.textContent = msg;
    scanFeedback.className = 'scan-feedback' + (cls ? ' ' + cls : '');
  }

  function processScan(code) {
    var hit = findByBarcode(code);
    if (!hit) { openLearn(code); return; }
    scanNote(addScanUnit(hit.f, hit.kind), hit.f, hit.kind, '');
    bumpCount();
    if (window.CA.waitlist) window.CA.waitlist.onScan(hit.f.id, hit.kind);   // quelqu'un l'attend ?
    if (window.CA.reserved) window.CA.reserved.onScan(hit.f.id, hit.kind);   // réservé pour un client ?
    focusScan();
  }

  // crédite +1 : d'abord une ligne attendue pas encore complète, sinon la ligne de cet article ;
  // un article absent de la commande s'ajoute en « hors commande ». Renvoie la ligne.
  function addScanUnit(f, kind) {
    var same = rows.filter(function (r) { return String(r.productId) === String(f.id) && r.kind === kind; });
    var line = same.filter(function (r) { return r.expected > 0 && r.qty < r.expected; })[0] || same[0];
    if (line) line.qty = (line.qty | 0) + 1;
    else { line = { productId: String(f.id), kind: kind, qty: 1, expected: current ? 0 : null, label: bcLabel(f) }; rows.push(line); }
    renderRows(rows.indexOf(line));
    return line;
  }
  function scanNote(line, f, kind, prefix) {
    var name = scanLabel(f, kind);
    if (line.expected === 0) feedback('⚠ ' + prefix + 'Pas dans la commande : ' + name, 'warn');
    else if (line.expected > 0 && line.qty > line.expected) feedback('⚠ ' + prefix + name + ' : ' + (line.qty - line.expected) + ' de trop', 'warn');
    else feedback('✓ ' + prefix + name + (line.expected > 0 ? '  (' + line.qty + ' / ' + line.expected + ')' : '  (×' + line.qty + ')'), 'ok');
  }

  // compteur : « reçus / attendus » + barre pour une commande, sinon le nombre d'articles
  function updateScanCount() {
    if (!scanCount) return;
    var exp = 0, got = 0, total = 0;
    rows.forEach(function (r) {
      total += r.qty | 0;
      if (r.expected > 0) { exp += r.expected; got += Math.min(r.qty | 0, r.expected); }
    });
    if (exp) {
      scanCount.innerHTML = '<span class="scan-count-num">' + got + '</span><span class="scan-count-lbl">/ ' + exp + ' reçus</span>';
      if (barEl) { barEl.hidden = false; barEl.classList.toggle('is-done', got >= exp); }
      if (barFill) barFill.style.width = Math.round(got / exp * 100) + '%';
    } else {
      scanCount.innerHTML = '<span class="scan-count-num">' + total + '</span><span class="scan-count-lbl">' + (total > 1 ? 'articles' : 'article') + '</span>';
      if (barEl) barEl.hidden = true;
    }
  }
  function bumpCount() {
    var num = scanCount && scanCount.querySelector('.scan-count-num');
    if (!num) return;
    num.classList.remove('scan-bump'); void num.offsetWidth; num.classList.add('scan-bump');
  }

  /* ---- apprentissage d'un code inconnu ---- */
  function learnOptions() { return filamentOptions('').replace('— choisir —', '— choisir l\'article —'); }
  function openLearn(code) {
    pendingCode = code;
    learnOpen = true;
    scanLearnCode.textContent = code;
    scanLearnFil.innerHTML = learnOptions();
    scanLearnFil.value = '';
    scanLearnKind.value = 'spool'; scanLearnKind.hidden = false;
    scanLearn.hidden = false;
    feedback('⚠ Code-barres inconnu — associe-le ci-dessous.', 'warn');
    try { scanLearnFil.focus(); } catch (e) {}
  }
  function closeLearn() {
    learnOpen = false; pendingCode = '';
    if (scanLearn) scanLearn.hidden = true;
  }
  // ajuste le format proposé selon les formats offerts par la couleur choisie
  if (scanLearnFil) scanLearnFil.addEventListener('change', function () {
    scanLearnKind.hidden = !!accProd(this.value);   // accessoire : pas de format
    var f = filProd(this.value); if (!f) return;
    var hasS = offersSpool(f), hasR = offersRefill(f);
    scanLearnKind.querySelector('option[value="spool"]').disabled = !hasS;
    scanLearnKind.querySelector('option[value="refill"]').disabled = !hasR;
    if (!hasS && hasR) scanLearnKind.value = 'refill';
    if (!hasR && hasS) scanLearnKind.value = 'spool';
  });
  if (scanLearnCancel) scanLearnCancel.addEventListener('click', function () {
    feedback('Code ignoré.', 'warn'); closeLearn(); focusScan();
  });
  if (scanLearnSave) scanLearnSave.addEventListener('click', function () {
    var f = bcProd(scanLearnFil.value);
    if (!f) { scanLearnFil.focus(); return; }
    var kind = isAcc(f) ? 'item' : (scanLearnKind.value === 'refill' ? 'refill' : 'spool');
    var code = pendingCode;
    scanLearnSave.disabled = true;
    feedback('Association…', 'warn');
    var attrs = Object.assign({}, f.attrs || {});
    attrs.barcodes = Object.assign({}, attrs.barcodes || {});
    attrs.barcodes[kind] = code;
    sb.from('products').update({ attrs: attrs, updated_at: new Date().toISOString() }).eq('id', f.id).select()
      .then(function (res) {
        scanLearnSave.disabled = false;
        if (res.error || !res.data || !res.data.length) { feedback('Échec de l\'association (permissions ?).', 'bad'); return; }
        f.attrs = res.data[0].attrs || attrs;   // maj en mémoire -> reconnu immédiatement ensuite
        closeLearn();
        scanNote(addScanUnit(f, kind), f, kind, 'Associé · ');
        bumpCount();
        if (window.CA.waitlist) window.CA.waitlist.onScan(f.id, kind);
        if (window.CA.reserved) window.CA.reserved.onScan(f.id, kind);
        focusScan();
      }, function (err) {
        scanLearnSave.disabled = false;
        feedback('Erreur : ' + (err && err.message ? err.message : err), 'bad');
      });
  });

  /* =========================================================
     CONFIRMATION — stock + archive + commande en route consommée
     ========================================================= */
  function applyStock(lines, sign) {
    return Promise.all(lines.filter(function (l) { return l.product_id && l.qty > 0; }).map(function (l) {
      return sb.rpc('receive_stock', { p_product: l.product_id, p_kind: l.kind, p_qty: sign * l.qty })
        .then(function (res) { if (res && res.error) throw res.error; return res; });   // ne PAS masquer une erreur RPC
    }));
  }
  // commande à laquelle une réception de l'historique est rattachée (id, sinon ancien n°)
  function orderRefOf(rc) { return rc ? (rc.supplier_order_id ? { id: rc.supplier_order_id } : (rc.order_number || null)) : null; }

  if (editor) editor.addEventListener('submit', function (e) { e.preventDefault(); onConfirm(false, false); });
  function onConfirm(skipOrphan, skipMissing) {
    var valid = rows.filter(function (r) { return r.productId && r.qty > 0; });
    if (!valid.length) { statusEl.textContent = 'Aucun article reçu.'; return; }
    if (!skipOrphan && rows.some(function (r) { return !r.productId && r.qty > 0; })) {
      caDialog.confirm({ title: 'Ignorer les lignes sans article ?', message: 'Certaines lignes n\'ont pas d\'article choisi.', ok: 'Continuer' })
        .then(function (ok) { if (ok) onConfirm(true, skipMissing); });
      return;
    }
    var missing = rows.reduce(function (s, r) { return s + (r.expected > 0 ? Math.max(0, r.expected - (r.qty | 0)) : 0); }, 0);
    if (current && missing && !skipMissing) {
      caDialog.confirm({ title: missing + ' article' + (missing > 1 ? 's' : '') + ' pas reçu' + (missing > 1 ? 's' : ''),
        message: 'Ils restent en route pour une prochaine livraison, ou tu les retires de la commande.',
        ok: 'Laisser en route', alt: 'Retirer de la commande', icon: 'clock' })
        .then(function (v) { if (v === true) save(valid, false); else if (v === 'alt') save(valid, true); });
      return;
    }
    save(valid, false);
  }

  function save(valid, dropRest) {
    var date = /^\d{4}-\d{2}-\d{2}$/.test(dateI.value.trim()) ? dateI.value.trim() : todayISO();
    var order = current, rc = editingReceipt, oldLines = editingOldLines;
    var tax = order ? (+order.tax_rate || 0) : 0;
    var newLines = null;
    var newLinesFor = function (receiptId) {
      return valid.map(function (r) {
        var f = bcProd(r.productId), kind = fitKind(f, r.kind);
        // prix payé : celui de la commande + taxes du fournisseur ; hors commande / sans commande : le coût connu
        var cost = r.oldCost != null ? r.oldCost : (r.unitCost != null ? r.unitCost * (1 + tax / 100) : costOf(f, kind));
        return { receipt_id: receiptId, product_id: r.productId, label: f ? bcLabel(f) : null, kind: kind, qty: r.qty,
          unit_cost: cost != null ? round2(cost) : null };
      });
    };
    var affected = uniq(oldLines.map(function (l) { return l.product_id; }).concat(valid.map(function (r) { return r.productId; })));
    var ref = rc ? orderRefOf(rc) : (order ? { id: order.id } : null);

    confirmBtn.disabled = true;
    statusEl.textContent = 'Enregistrement…';
    var chain;
    if (rc) {
      chain = applyStock(oldLines, -1)
        .then(function () { return sb.from('receipt_lines').delete().eq('receipt_id', rc.id); })
        .then(function () { return sb.from('receipts').update({ received_at: date }).eq('id', rc.id).select(); })
        .then(function (res) {
          if (res.error || !res.data || !res.data.length) throw (res.error || new Error('Modification refusée (permissions).'));
          newLines = newLinesFor(rc.id);
          return sb.from('receipt_lines').insert(newLines).then(function (r2) { if (r2.error) throw r2.error; return applyStock(newLines, +1); });
        });
    } else {
      var head = { order_number: order ? (order.order_number || null) : null, received_at: date, note: null,
        supplier: order ? (order.supplier || null) : null, supplier_order_id: order ? order.id : null };
      chain = sb.from('receipts').insert(head).select()
        .then(function (res) {
          if (res.error || !res.data || !res.data.length) throw (res.error || new Error('Réception refusée (permissions).'));
          newLines = newLinesFor(res.data[0].id);
          return sb.from('receipt_lines').insert(newLines).then(function (r2) { if (r2.error) throw r2.error; return applyStock(newLines, +1); });
        });
    }
    // commande en route : la réception consomme ce qui était attendu (modification = on rend l'ancien d'abord)
    chain = chain.then(function () {
      var er = window.CA.enRoute; if (!er || !ref) return;
      return (rc ? er.allocate(oldLines, ref, -1) : Promise.resolve())
        .then(function () { return er.allocate(newLines, ref, +1); })
        .then(function () { if (dropRest && order) return er.dropRemaining(order.id); })
        .then(null, function (e) { console.warn('en route', e); });   // la réception est déjà enregistrée
    });

    chain.then(function () { return recomputeAvgCosts(affected); }).then(function () {
      confirmBtn.disabled = false;
      // liste d'attente / réservés : alerte pour TOUT ce qui vient d'entrer
      var recv = valid.map(function (r) { return { productId: r.productId, kind: fitKind(bcProd(r.productId), r.kind) }; });
      if (window.CA.waitlist) window.CA.waitlist.onReceived(recv);
      if (window.CA.reserved) window.CA.reserved.onReceived(recv);
      if (window.caDialog && caDialog.toast) caDialog.toast(rc ? 'Réception modifiée' : 'Réception enregistrée');
      closeWork();
      Promise.all([loadFilaments(), loadAccessories()]).then(function () { renderReorder(); });
      loadHistory();
    }, function (err) {
      confirmBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }

  /* ---- Coût moyen pondéré : recalcul par rejeu des réceptions ----
     Pour chaque produit touché, on relit TOUTES ses lignes de réception et on
     recalcule attrs.avg_cost { spool, refill | item } (prix payés, taxes incluses)
     + attrs.last_cost (dernier prix payé : estimé de la liste à commander).
     Le rejeu rend le tout cohérent même après modification/suppression. */
  function recomputeAvgCosts(productIds) {
    productIds = uniq(productIds || []).filter(Boolean);
    if (!productIds.length) return Promise.resolve();
    var lines;
    return sb.from('receipt_lines').select('product_id,kind,qty,unit_cost,receipt_id').in('product_id', productIds)
      .then(function (res) {
        if (res.error) throw res.error;
        lines = res.data || [];
        var rids = uniq(lines.map(function (l) { return l.receipt_id; }));
        return rids.length ? sb.from('receipts').select('id,received_at,created_at').in('id', rids) : { data: [] };
      })
      .then(function (r2) {
        var when = {};
        ((r2 && r2.data) || []).forEach(function (r) { when[r.id] = (r.received_at || '') + '|' + (r.created_at || ''); });
        var byProd = {};
        lines.forEach(function (l) {
          var g = byProd[l.product_id] || (byProd[l.product_id] = { spool: [], refill: [] });
          (l.kind === 'refill' ? g.refill : g.spool).push({ qty: l.qty, unit_cost: l.unit_cost, w: when[l.receipt_id] || '' });
        });
        var last = function (arr) {
          var priced = arr.filter(function (l) { return num(l.unit_cost) != null; });
          if (!priced.length) return null;
          priced.sort(function (a, z) { return a.w < z.w ? -1 : a.w > z.w ? 1 : 0; });
          return round2(priced[priced.length - 1].unit_cost);
        };
        return Promise.all(productIds.map(function (pid) {
          var f = bcProd(pid);
          if (!f) return null;
          var g = byProd[pid] || { spool: [], refill: [] };
          var attrs = Object.assign({}, f.attrs || {});
          var ac = {}, lc = {}, v;
          // accessoire : un seul coût (lignes 'item' rangées avec 'spool' ci-dessus)
          (isAcc(f) ? [['item', g.spool]] : [['spool', g.spool], ['refill', g.refill]]).forEach(function (k) {
            v = CA.costing.avg(k[1], null); if (v != null) ac[k[0]] = v;
            v = last(k[1]); if (v != null) lc[k[0]] = v;
          });
          if (Object.keys(ac).length) attrs.avg_cost = ac; else delete attrs.avg_cost;
          if (Object.keys(lc).length) attrs.last_cost = lc; else delete attrs.last_cost;
          return sb.from('products').update({ attrs: attrs, updated_at: new Date().toISOString() }).eq('id', pid).select()
            .then(function (r) { if (r.data && r.data[0]) f.attrs = r.data[0].attrs || attrs; });
        }));
      });
  }

  /* =========================================================
     HISTORIQUE — inchangé
     ========================================================= */
  if (refreshBtn) refreshBtn.addEventListener('click', loadHistory);
  function loadHistory() {
    historyEl.innerHTML = '<p class="muted">Chargement…</p>';
    sb.from('receipts').select('*').order('received_at', { ascending: false }).order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) { historyEl.innerHTML = '<p class="empty">Impossible de charger l\'historique. As-tu relancé schema-v2.sql ?</p>'; return; }
        var receipts = res.data || [];
        if (!receipts.length) { historyEl.innerHTML = '<p class="empty">Aucune réception enregistrée pour l\'instant.</p>'; return; }
        var ids = receipts.map(function (r) { return r.id; });
        sb.from('receipt_lines').select('*').in('receipt_id', ids).then(function (r2) {
          var byReceipt = {};
          (r2.data || []).forEach(function (l) { (byReceipt[l.receipt_id] = byReceipt[l.receipt_id] || []).push(l); });
          renderHistory(receipts, byReceipt);
        });
      });
  }
  function renderHistory(receipts, byReceipt) {
    historyEl.innerHTML = receipts.map(function (rc) {
      var lines = byReceipt[rc.id] || [];
      var totalRolls = lines.reduce(function (s, l) { return s + (l.qty | 0); }, 0);
      var totalCost = 0, hasAnyCost = false;
      var linesHtml = lines.map(function (l) {
        var q = l.qty | 0;
        var priced = (l.unit_cost != null && l.unit_cost !== '');
        var eff = priced ? +l.unit_cost : null;
        if (eff != null) { totalCost += eff * q; hasAnyCost = true; }
        var priceTxt = priced
          ? '<span class="rcp-hist-price">' + money(l.unit_cost) + '/u</span>'
          : '<span class="rcp-hist-price muted">—</span>';
        return '<li>' + esc(l.label || '(produit supprimé)') + ' — ' + kindLabel(l.kind) + ' × ' + q + ' · ' + priceTxt + '</li>';
      }).join('');
      var costTxt = hasAnyCost ? ' · ' + money(totalCost) : '';
      return '<div class="mat-row rcp-hist" data-id="' + esc(rc.id) + '">' +
        '<div class="mat-main">' +
          '<div class="rcp-hist-head">' +
            '<span class="rcp-hist-order">' + (rc.order_number ? esc(rc.order_number) : 'Commande sans n°') + '</span>' +
            '<span class="grow"></span>' +
            '<span class="rcp-hist-meta">' + esc(rc.received_at) + ' · ' + lines.length + ' ligne(s) · ' + totalRolls + ' article(s)' + costTxt + '</span>' +
          '</div>' +
          '<ul class="rcp-hist-lines">' + (linesHtml || '<li>(aucune ligne)</li>') + '</ul>' +
        '</div>' +
        '<div class="mat-actions">' +
          '<button class="btn btn-ghost btn-sm rcp-edit" type="button">Modifier</button>' +
          '<button class="btn btn-ghost btn-sm rcp-del" type="button">Suppr.</button>' +
        '</div>' +
      '</div>';
    }).join('');
    $$('.rcp-hist', historyEl).forEach(function (el) {
      var id = el.getAttribute('data-id');
      var rc = receipts.filter(function (x) { return String(x.id) === id; })[0];
      var lines = byReceipt[id] || [];
      $('.rcp-hist-head', el).addEventListener('click', function () { el.classList.toggle('open'); });
      $('.rcp-edit', el).addEventListener('click', function () { editReceipt(rc, lines); });
      $('.rcp-del', el).addEventListener('click', function () { delReceipt(rc, lines); });
    });
  }

  function editReceipt(rc, lines) {
    var sub = window.CA.route && window.CA.route.goSub;
    startWork(null, rc, lines);
    if (sub) sub('reception');
  }

  function delReceipt(rc, lines) {
    caDialog.confirm({ title: 'Supprimer cette réception' + (rc.order_number ? ' (' + rc.order_number + ')' : '') + ' ?',
      message: 'Le stock qu\'elle a ajouté sera retiré.', ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
      if (!ok) return;
      var affected = uniq(lines.map(function (l) { return l.product_id; }));
      applyStock(lines, -1)
        .then(function () { return sb.from('receipts').delete().eq('id', rc.id).select(); })
        .then(function (res) {
          // ce qu'elle avait consommé redevient « en route »
          if (res.error || !window.CA.enRoute) return res;
          return window.CA.enRoute.allocate(lines, orderRefOf(rc), -1).then(function () { return res; }, function () { return res; });
        })
        .then(function (res) {
          if (res.error) throw res.error;
          if (!res.data || !res.data.length) throw new Error('Suppression refusée (permissions).');
          return recomputeAvgCosts(affected);
        })
        .then(function () {
          if (editingReceipt && editingReceipt.id === rc.id) closeWork();
          Promise.all([loadFilaments(), loadAccessories()]).then(function () { renderReorder(); });
          loadHistory();
        }, function (err) { caDialog.error(err); });
    });
  }

  /* =========================================================
     À COMMANDER — cibles de stock + liste de réappro
     ========================================================= */
  var reorderSummary = $('#reorder-summary'), reorderBody = $('#reorder-body'),
      reorderOnlyMiss = $('#reorder-onlymiss'), reorderRefresh = $('#reorder-refresh'),
      reorderBrand = $('#reorder-brand'), reorderMaterial = $('#reorder-material');

  var roBrand = null, roMaterial = '';   // filtre courant (marque puis matériau)

  if (reorderOnlyMiss) reorderOnlyMiss.addEventListener('change', renderReorder);
  if (reorderRefresh) reorderRefresh.addEventListener('click', function () {
    loadFilaments().then(function () {
      if (window.CA.loadMaterials) return window.CA.loadMaterials();
    }).then(renderReorder, renderReorder);
  });
  if (reorderBrand) reorderBrand.addEventListener('change', function () {
    roBrand = this.value; roMaterial = ''; populateReorderFilters(); renderReorder();
  });
  if (reorderMaterial) reorderMaterial.addEventListener('change', function () {
    roMaterial = this.value; renderReorder();
  });

  // marques / matériaux réellement présents parmi les filaments (ordre de chargement)
  function brandsPresent() {
    var seen = {}, out = [];
    filaments.forEach(function (f) { var b = f.brand || '—'; if (!seen[b]) { seen[b] = 1; out.push(b); } });
    return out;
  }
  function materialsPresent(brand) {
    var seen = {}, out = [];
    filaments.forEach(function (f) {
      if ((f.brand || '—') !== brand) return;
      var m = f.material || '(sans matériau)'; if (!seen[m]) { seen[m] = 1; out.push(m); }
    });
    // ordre des matériaux = celui réglé dans l'admin (page Filaments), pas l'alphabet
    out.sort(function (a, z) { return matOrderIndex(brand, a) - matOrderIndex(brand, z); });
    return out;
  }
  function populateReorderFilters() {
    if (!reorderBrand || !reorderMaterial) return;
    var brands = brandsPresent();
    if (!brands.length) { reorderBrand.innerHTML = ''; reorderMaterial.innerHTML = ''; return; }
    // marque par défaut : la marque courante de l'admin si présente, sinon la 1re
    if (!roBrand || brands.indexOf(roBrand) < 0) {
      roBrand = (window.CA.currentBrand && brands.indexOf(window.CA.currentBrand) > -1) ? window.CA.currentBrand : brands[0];
    }
    reorderBrand.innerHTML = brands.map(function (b) {
      return '<option value="' + esc(b) + '"' + (b === roBrand ? ' selected' : '') + '>' + esc(b) + '</option>';
    }).join('');
    var mats = materialsPresent(roBrand);
    if (roMaterial && mats.indexOf(roMaterial) < 0) roMaterial = '';
    reorderMaterial.innerHTML = '<option value="">Tous les matériaux</option>' + mats.map(function (m) {
      return '<option value="' + esc(m) + '"' + (m === roMaterial ? ' selected' : '') + '>' + esc(m) + '</option>';
    }).join('');
    reorderMaterial.value = roMaterial;
  }

  function parOf(f, kind) {
    var v = f.attrs && f.attrs['par_' + kind];
    v = parseInt(v, 10);
    return isFinite(v) && v > 0 ? v : 0;
  }
  function stockOf(f, kind) { return (kind === 'refill' ? f.qty_2 : f.qty) | 0; }
  function missOf(f, kind) {
    var offers = kind === 'refill' ? offersRefill(f) : offersSpool(f);
    if (!offers) return 0;
    // les articles promis à un client (facture « à venir ») s'ajoutent à la cible ;
    // ceux déjà commandés chez le fournisseur (« en route », cms-en-route.js) s'en retirent
    return Math.max(0, parOf(f, kind) + reservedOf(f, kind) - stockOf(f, kind) - enRouteOf(f, kind));
  }
  function reservedOf(f, kind) { return window.CA.reserved ? window.CA.reserved.count(f.id, kind) : 0; }
  function enRouteOf(f, kind) { return window.CA.enRoute ? window.CA.enRoute.count(f.id, kind) : 0; }

  // enregistre une cible dans attrs.par_spool / attrs.par_refill
  function saveTarget(f, kind, value, cell) {
    var v = Math.max(0, parseInt(value, 10) || 0);
    var attrs = Object.assign({}, f.attrs || {});
    if (v > 0) attrs['par_' + kind] = v; else delete attrs['par_' + kind];
    if (cell) cell.classList.add('saving');
    sb.from('products').update({ attrs: attrs, updated_at: new Date().toISOString() }).eq('id', f.id).select()
      .then(function (res) {
        if (cell) cell.classList.remove('saving');
        if (res.error || !res.data || !res.data.length) return;
        f.attrs = res.data[0].attrs || attrs;
        renderReorderSummary();
        // maj visuelle de la ligne (manque + surbrillance) sans tout reconstruire
        refreshRow(f);
      }, function () { if (cell) cell.classList.remove('saving'); });
  }

  function refreshRow(f) {
    var tr = reorderBody && reorderBody.querySelector('tr[data-id="' + cssId(f.id) + '"]');
    if (!tr) return;
    var anyMiss = false;
    ['spool', 'refill'].forEach(function (kind) {
      var missEl = tr.querySelector('.reorder-miss.k-' + kind);
      if (!missEl) return;
      var m = missOf(f, kind);
      if (m > 0) anyMiss = true;
      missEl.textContent = m > 0 ? '−' + m : '0';
      missEl.classList.toggle('ok', m <= 0);
    });
    tr.classList.toggle('has-miss', anyMiss);
  }
  function cssId(id) { return String(id).replace(/"/g, '\\"'); }

  // pastille « N en attente » (liste d'attente) — guide les achats
  function waitBadge(f) {
    var n = window.CA.waitlist ? window.CA.waitlist.count(f.id) : 0;
    return n ? ' <span class="ro-wait" title="Personnes en liste d\'attente pour cette couleur">⏳ ' + n + ' en attente</span>' : '';
  }
  // pastille « N réservés » : facturés à un client, pas encore remis (cms-reserves.js)
  function resBadge(f) {
    var n = reservedOf(f, 'spool') + reservedOf(f, 'refill');
    if (!n) return '';
    return ' <span class="ro-res" title="' + esc('Réservé : ' + window.CA.reserved.who(f.id).join(', ')) + '">📦 ' + n + ' réservé' + (n > 1 ? 's' : '') + '</span>';
  }
  // pastille « N en route » : commandés chez le fournisseur, pas encore reçus (cms-en-route.js)
  function routeBadge(f) {
    var n = enRouteOf(f, 'spool') + enRouteOf(f, 'refill');
    return n ? ' <span class="ro-route" title="Commandé, pas encore reçu">🚚 ' + n + ' en route</span>' : '';
  }
  // la liste d'attente se charge en parallèle -> on rafraîchit les pastilles à son arrivée
  document.addEventListener('ca:waitlist', function () { if (loaded && reorderBody && subCommander && !subCommander.hidden) renderReorder(); });
  document.addEventListener('ca:reserved', function () { if (loaded && reorderBody && subCommander && !subCommander.hidden) renderReorder(); });
  document.addEventListener('ca:enroute', function () { if (loaded && reorderBody) renderReorder(); });

  function renderReorder() {
    if (!reorderBody) return;
    if (!loaded) { ensureLoad(); return; }
    if (!filaments.length) {
      populateReorderFilters();
      reorderBody.innerHTML = '<p class="empty">Aucun filament. Ajoute des couleurs dans l\'onglet Filaments.</p>';
      renderReorderSummary();
      return;
    }
    populateReorderFilters();
    var onlyMiss = reorderOnlyMiss && reorderOnlyMiss.checked;

    // filtre marque -> matériau, puis regroupe par matériau (ordre de chargement)
    var groups = [], gmap = {};
    filaments.forEach(function (f) {
      if (roBrand && (f.brand || '—') !== roBrand) return;
      if (roMaterial && (f.material || '(sans matériau)') !== roMaterial) return;
      var hasS = offersSpool(f), hasR = offersRefill(f);
      if (!hasS && !hasR) return;  // couleur sans format vendable -> hors réappro
      if (onlyMiss && missOf(f, 'spool') <= 0 && missOf(f, 'refill') <= 0) return;
      var key = (f.material || '(sans matériau)');
      if (!gmap[key]) { gmap[key] = { key: key, brand: f.brand, material: f.material, rows: [] }; groups.push(gmap[key]); }
      gmap[key].rows.push(f);
    });
    // ordre des groupes = ordre des matériaux réglé dans l'admin (page Filaments)
    groups.sort(function (a, z) {
      var ba = brandOrderIndex(a.brand), bz = brandOrderIndex(z.brand); if (ba !== bz) return ba - bz;
      return matOrderIndex(a.brand, a.material) - matOrderIndex(z.brand, z.material);
    });

    if (!groups.length) {
      reorderBody.innerHTML = onlyMiss
        ? '<p class="reorder-empty" style="padding:14px 0">✓ Tout est au-dessus des cibles pour ce filtre.</p>'
        : '<p class="empty">Aucun filament pour ce filtre.</p>';
      renderReorderSummary();
      return;
    }

    reorderBody.innerHTML = groups.map(function (g) {
      var anyS = g.rows.some(offersSpool), anyR = g.rows.some(offersRefill);
      var head = '<tr>' +
        '<th class="l">Filament</th>' +
        (anyS ? '<th>Bob. stock</th><th>Bob. cible</th><th>Manque</th>' : '') +
        (anyR ? '<th>Rech. stock</th><th>Rech. cible</th><th>Manque</th>' : '') +
      '</tr>';
      var body = g.rows.map(function (f) {
        var hasS = offersSpool(f), hasR = offersRefill(f);
        var mS = missOf(f, 'spool'), mR = missOf(f, 'refill');
        var anyMiss = mS > 0 || mR > 0;
        var sw = swatchBg(f.hex, colorsOf(f));
        function fmtCells(kind, has, colOn) {
          if (!colOn) return '';
          if (!has) return '<td class="reorder-na">—</td><td class="reorder-na">—</td><td class="reorder-na">—</td>';
          var st = stockOf(f, kind), par = parOf(f, kind), m = missOf(f, kind);
          return '<td>' + st + '</td>' +
            '<td><input type="number" class="reorder-par num k-' + kind + '" min="0" step="1" value="' + (par || '') + '" placeholder="0"></td>' +
            '<td class="reorder-miss k-' + kind + (m > 0 ? '' : ' ok') + '">' + (m > 0 ? '−' + m : '0') + '</td>';
        }
        return '<tr data-id="' + esc(f.id) + '"' + (anyMiss ? ' class="has-miss"' : '') + '>' +
          '<td class="l"><div class="reorder-fil">' +
            '<span class="ro-sw" style="background:' + esc(sw) + '"></span>' +
            '<span><span class="ro-name">' + esc(f.name || '(sans nom)') + '</span>' +
            (f.code ? ' <span class="ro-code">' + esc(f.code) + '</span>' : '') + waitBadge(f) + resBadge(f) + routeBadge(f) + '</span>' +
          '</div></td>' +
          fmtCells('spool', hasS, anyS) +
          fmtCells('refill', hasR, anyR) +
        '</tr>';
      }).join('');

      return '<div class="reorder-group">' +
        '<h3>' + esc(g.material || '(sans matériau)') +
          ' <span class="fil-count">' + g.rows.length + '</span></h3>' +
        '<div class="reorder-table-wrap"><table class="reorder-table">' +
          '<thead>' + head + '</thead><tbody>' + body + '</tbody>' +
        '</table></div>' +
      '</div>';
    }).join('');

    // câblage des champs « cible »
    $$('.reorder-par', reorderBody).forEach(function (inp) {
      var tr = inp.closest('tr'), id = tr.getAttribute('data-id');
      var kind = inp.classList.contains('k-refill') ? 'refill' : 'spool';
      var f = filProd(id);
      var commit = function () { if (f) saveTarget(f, kind, inp.value, tr); };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    });

    renderReorderSummary();
  }

  // la « liste à commander » : agrège tous les manques, groupés par marque
  function renderReorderSummary() {
    if (!reorderSummary) return;
    var items = [];
    filaments.forEach(function (f) {
      ['spool', 'refill'].forEach(function (kind) {
        var m = missOf(f, kind);
        if (m > 0) items.push({ f: f, kind: kind, qty: m });
      });
    });
    // ordre = marque puis matériau (ordre admin) puis filament (sort_order) puis format
    items.sort(function (a, z) {
      var ba = brandOrderIndex(a.f.brand), bz = brandOrderIndex(z.f.brand); if (ba !== bz) return ba - bz;
      var ma = matOrderIndex(a.f.brand, a.f.material), mz = matOrderIndex(z.f.brand, z.f.material); if (ma !== mz) return ma - mz;
      var ia = filaments.indexOf(a.f), iz = filaments.indexOf(z.f); if (ia !== iz) return ia - iz;
      return (a.kind === 'refill' ? 1 : 0) - (z.kind === 'refill' ? 1 : 0);
    });
    var totalUnits = items.reduce(function (s, it) { return s + it.qty; }, 0);

    if (!items.length) {
      reorderSummary.innerHTML = '<div class="reorder-card"><div class="reorder-card-head">' +
        '<h2>Liste à commander</h2><span class="grow"></span><span class="reorder-total zero">À jour</span></div>' +
        '<p class="reorder-empty">✓ Rien à commander pour l\'instant.</p></div>';
      return;
    }

    // groupé par marque pour l'affichage + le texte copiable
    var byBrand = {};
    items.forEach(function (it) { (byBrand[it.f.brand || '—'] = byBrand[it.f.brand || '—'] || []).push(it); });

    // Estimé de la commande = dernier prix payé (taxes incluses ; sinon coût moyen,
    // sinon moyenne de la même matière) × quantité manquante. Un article jamais reçu
    // dont la matière non plus n'est pas compté (listé).
    var est = 0, estByBrand = {}, noPrice = {};
    items.forEach(function (it) {
      var c = estCostOf(it.f, it.kind), b = it.f.brand || '—';
      if (c == null) { noPrice[(it.f.material || it.f.name || '—') + ' · ' + kindLabel(it.kind)] = 1; return; }
      est += c * it.qty;
      estByBrand[b] = (estByBrand[b] || 0) + c * it.qty;
    });
    var missing = Object.keys(noPrice);
    var multiBrand = Object.keys(byBrand).length > 1;
    var estHtml = (est > 0 || !missing.length)
      ? '<span class="reorder-est" title="Dernier prix payé (taxes incluses) × quantités à commander">Estimé <b>≈ ' + money(est) + '</b></span>'
      : '';
    var noteHtml = missing.length
      ? '<p class="reorder-est-note">Jamais reçu, non compté' + (missing.length > 1 ? 's' : '') + ' : ' +
          esc(missing.slice(0, 4).join(', ')) + (missing.length > 4 ? '…' : '') + '</p>'
      : '';

    var listHtml = Object.keys(byBrand).map(function (brand) {
      var lis = byBrand[brand].map(function (it) {
        var sw = swatchBg(it.f.hex, colorsOf(it.f));
        var name = '<span>' + esc((it.f.material ? it.f.material + ' · ' : '') + (it.f.name || '')) +
          ' <span class="ro-code">' + kindLabel(it.kind) + (it.f.code ? ' · ' + esc(it.f.code) : '') + '</span></span>';
        // commandé (en tout ou en partie) pour un client : étiquette cliquable -> sa facture
        var res = window.CA.reserved ? window.CA.reserved.detail(it.f.id, it.kind) : [];
        if (res.length) {
          var resQty = res.reduce(function (s, d) { return s + d.qty; }, 0);
          name = '<span class="ro-main">' + name + '<span class="ro-fors">' + res.map(function (d) {
            return '<button type="button" class="ro-for" data-inv="' + esc(d.invoiceId) + '" title="Ouvrir la facture">📦 ' +
              (resQty >= it.qty && res.length === 1 ? 'Pour ' : d.qty + ' pour ') + esc(d.client) + ' · ' + esc(d.number) + '</button>';
          }).join('') + '</span></span>';
        }
        return '<li' + (res.length ? ' class="is-res"' : '') + '><span class="ro-sw" style="background:' + esc(sw) + '"></span>' +
          name + '<span class="ro-q">×' + it.qty + '</span></li>';
      }).join('');
      return '<div class="reorder-brandgroup"><h3 style="font-size:.9rem;margin:12px 0 4px">' + esc(brand) +
          (multiBrand && estByBrand[brand] ? '<span class="ro-brand-est">≈ ' + money(estByBrand[brand]) + '</span>' : '') + '</h3>' +
        '<ul class="reorder-list">' + lis + '</ul></div>';
    }).join('');

    reorderSummary.innerHTML = '<div class="reorder-card has-miss">' +
      '<div class="reorder-card-head">' +
        '<h2>Liste à commander</h2>' +
        '<span class="grow"></span>' +
        estHtml +
        '<span class="reorder-total">' + totalUnits + ' article' + (totalUnits > 1 ? 's' : '') + '</span>' +
        '<button class="btn btn-ghost btn-sm" id="reorder-copy" type="button" data-ic="copy">Copier la liste</button>' +
      '</div>' + noteHtml + listHtml + '</div>';

    $$('.ro-for', reorderSummary).forEach(function (b) {
      b.addEventListener('click', function () {
        if (window.CA.focusInvoice) window.CA.focusInvoice(b.getAttribute('data-inv'));
        location.hash = '#historique';
      });
    });
    var copyBtn = $('#reorder-copy');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var text = buildOrderText(byBrand);
      var done = function () {
        copyBtn.textContent = 'Copié'; copyBtn.dataset.ic = 'check';
        setTimeout(function () { copyBtn.textContent = 'Copier la liste'; copyBtn.dataset.ic = 'copy'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else { fallbackCopy(text); done(); }
    });
  }

  function buildOrderText(byBrand) {
    var out = [];
    Object.keys(byBrand).forEach(function (brand) {
      out.push('=== ' + brand + ' — à commander ===');
      byBrand[brand].forEach(function (it) {
        out.push('- ' + (it.f.material ? it.f.material + ' · ' : '') + (it.f.name || '') +
          ' — ' + kindLabel(it.kind) + (it.f.code ? ' (' + it.f.code + ')' : '') + ' ×' + it.qty);
      });
      out.push('');
    });
    return out.join('\n').trim();
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* =========================================================
     CODES-BARRES — voir / corriger / supprimer les associations
     (products.attrs.barcodes.{spool,refill} ; accessoires : .item)
     ========================================================= */
  var bcBody = $('#bc-body'), bcSearch = $('#bc-search'), bcCount = $('#bc-count'),
      bcAddBtn = $('#bc-add'), bcRefreshBtn = $('#bc-refresh');
  var bcScan = $('#bc-scan'), bcScanToggle = $('#bc-scan-toggle'), bcScanInput = $('#bc-scan-input'), bcScanFeedback = $('#bc-scan-feedback');
  var bcEditing = null;      // clé "productId:kind" en édition, ou '__new__', ou null
  var pendingScanCode = '';  // code scanné inconnu, pré-rempli dans le formulaire d'association

  if (bcSearch) bcSearch.addEventListener('input', function () { renderCodes(); });
  if (bcAddBtn) bcAddBtn.addEventListener('click', function () { pendingScanCode = ''; bcEditing = '__new__'; renderCodes(); });
  if (bcRefreshBtn) bcRefreshBtn.addEventListener('click', function () {
    Promise.all([loadFilaments(), loadAccessories()]).then(function () { renderCodes(); renderReorder(); });
  });

  /* ---- poste de scan (vérification) ---- */
  var bcScanActive = false;
  function bcFocusScan() { if (bcScanInput) try { bcScanInput.focus(); } catch (e) {} }
  function bcScanFb(msg, cls) { if (bcScanFeedback) { bcScanFeedback.textContent = msg || ''; bcScanFeedback.className = 'bc-scan-feedback' + (cls ? ' ' + cls : ''); } }
  function setBcScanActive(on) {
    bcScanActive = !!on;
    if (bcScanInput) { bcScanInput.disabled = !bcScanActive; bcScanInput.value = ''; }
    if (bcScan) bcScan.classList.toggle('is-armed', bcScanActive);
    if (bcScanToggle) {
      bcScanToggle.setAttribute('aria-pressed', String(bcScanActive));
      bcScanToggle.textContent = bcScanActive ? 'Scan en cours…' : 'Scanner pour vérifier';
      bcScanToggle.dataset.ic = bcScanActive ? 'pause' : 'scan';
    }
    if (bcScanActive) { bcScanFb('En attente d\'un scan…', ''); bcFocusScan(); } else { bcScanFb('', ''); }
  }
  if (bcScanToggle) bcScanToggle.addEventListener('click', function () { setBcScanActive(!bcScanActive); });
  if (bcScanInput) bcScanInput.addEventListener('blur', function () {
    setTimeout(function () {
      if (!bcScanActive || bcEditing) return;
      if (document.activeElement && document.activeElement !== document.body) return;
      bcFocusScan();
    }, 40);
  });
  if (bcScanInput) bcScanInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    e.preventDefault();
    var code = (bcScanInput.value || '').trim();
    bcScanInput.value = '';
    if (code) bcProcessScan(code);
  });
  function bcProcessScan(code) {
    var hit = allBarcodeEntries().filter(function (e) { return e.code === code; })[0];
    if (hit) {
      // connu -> confirme le filament + met la ligne en évidence
      bcScanFb('✓ ' + code + ' → ' + bcLabel(hit.f) + (hit.acc ? '' : ' · ' + kindLabel(hit.kind)), 'ok');
      if (bcSearch && bcSearch.value) { bcSearch.value = ''; }   // s'assure que la ligne est visible
      renderCodes();
      var tr = bcBody && bcBody.querySelector('tr[data-key="' + hit.key.replace(/"/g, '\\"') + '"]');
      if (tr) { tr.classList.remove('bc-flash'); void tr.offsetWidth; tr.classList.add('bc-flash'); tr.scrollIntoView({ block: 'nearest' }); }
      bcFocusScan();
    } else {
      // inconnu -> ouvre le formulaire d'association pré-rempli avec le code
      bcScanFb('⚠ ' + code + ' — code inconnu, associe-le ci-dessous.', 'warn');
      pendingScanCode = code; bcEditing = '__new__'; renderCodes();
      var sel = bcBody && bcBody.querySelector('.bc-e-fil'); if (sel) try { sel.focus(); } catch (e) {}
    }
  }

  // ordre exactement comme la page Filaments de l'admin : marque (sort_order),
  // puis matériau (ordre de CA.materials.list = ordre réglé dans l'admin),
  // puis filament (son sort_order), puis format (bobine avant recharge).
  function brandOrderIndex(name) {
    var list = (window.CA.brands && window.CA.brands.list) || [];
    for (var i = 0; i < list.length; i++) { if (list[i].name === name) return i; }
    return 9999;
  }
  function matOrderIndex(brand, mat) {
    var list = (window.CA.materials && window.CA.materials.list) || [];
    for (var i = 0; i < list.length; i++) { if (list[i].brand === brand && list[i].name === mat) return i; }
    return 9999;
  }
  // toutes les associations (une entrée par code : un filament peut en avoir 2, bobine + recharge)
  function allBarcodeEntries() {
    var out = [];
    // idx = position dans `filaments` (déjà trié par sort_order) -> ordre du filament dans son matériau
    filaments.forEach(function (f, idx) {
      var b = f.attrs && f.attrs.barcodes; if (!b) return;
      ['spool', 'refill'].forEach(function (k) {
        if (b[k]) out.push({ key: String(f.id) + ':' + k, productId: String(f.id), kind: k, code: String(b[k]), f: f, idx: idx });
      });
    });
    out.sort(function (a, z) {
      var ba = brandOrderIndex(a.f.brand), bz = brandOrderIndex(z.f.brand); if (ba !== bz) return ba - bz;
      var ma = matOrderIndex(a.f.brand, a.f.material), mz = matOrderIndex(z.f.brand, z.f.material); if (ma !== mz) return ma - mz;
      if (a.idx !== z.idx) return a.idx - z.idx;                                   // ordre du filament (sort_order)
      return (a.kind === 'refill' ? 1 : 0) - (z.kind === 'refill' ? 1 : 0);        // bobine avant recharge
    });
    // accessoires ensuite (un seul code par article), dans leur ordre du catalogue
    accessories.forEach(function (a, idx) {
      var b = a.attrs && a.attrs.barcodes;
      if (b && b.item) out.push({ key: String(a.id) + ':item', productId: String(a.id), kind: 'item', code: String(b.item), f: a, idx: idx, acc: true });
    });
    return out;
  }
  // qui possède déjà ce code ? (pour éviter les doublons)
  function findCodeOwner(code) {
    code = String(code).trim();
    var hit = null;
    allBarcodeEntries().some(function (e) { if (e.code === code) { hit = e; return true; } return false; });
    return hit;
  }
  // scope : 'fil' | 'acc' | 'all' (nouvelle association : filament OU accessoire)
  function filCodeOptions(selected, scope) {
    function opts(list, label) {
      return list.slice().sort(function (a, b) { return label(a).localeCompare(label(b)); }).map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (String(p.id) === String(selected) ? ' selected' : '') + '>' + esc(label(p)) + '</option>';
      }).join('');
    }
    if (scope === 'acc') return '<option value="">— choisir l\'accessoire —</option>' + opts(accessories, accLabel);
    if (scope === 'fil' || !accessories.length) return '<option value="">— choisir le filament —</option>' + opts(filaments, filLabel);
    return '<option value="">— choisir l\'article —</option>' +
      '<optgroup label="Filaments">' + opts(filaments, filLabel) + '</optgroup>' +
      '<optgroup label="Accessoires">' + opts(accessories, accLabel) + '</optgroup>';
  }
  function kindOptions(sel) {
    return '<option value="spool"' + (sel !== 'refill' ? ' selected' : '') + '>Avec bobine</option>' +
           '<option value="refill"' + (sel === 'refill' ? ' selected' : '') + '>Recharge</option>';
  }

  function renderCodes() {
    if (!bcBody) return;
    if (!loaded) { ensureLoad(); return; }
    var entries = allBarcodeEntries();
    var q = (bcSearch && bcSearch.value || '').trim().toLowerCase();
    var shown = entries.filter(function (e) {
      if (!q) return true;
      return (e.code + ' ' + bcLabel(e.f) + ' ' + kindLabel(e.kind)).toLowerCase().indexOf(q) !== -1;
    });
    if (bcCount) bcCount.textContent = entries.length + ' code' + (entries.length > 1 ? 's' : '') + ' associé' + (entries.length > 1 ? 's' : '');

    var newRow = (bcEditing === '__new__') ? editRowHtml({ code: pendingScanCode || '', productId: '', kind: 'spool', scope: 'all' }, '__new__', true) : '';

    if (!entries.length && bcEditing !== '__new__') {
      bcBody.innerHTML = '<p class="empty">Aucun code-barres associé pour l\'instant.<br>' +
        'Ils se créent en scannant à la réception (ou clique «&nbsp;+ Associer un code&nbsp;»).</p>';
      return;
    }

    function rows(list) {
      return list.map(function (e) { return (bcEditing === e.key) ? editRowHtml(e, e.key, false) : viewRowHtml(e); }).join('');
    }
    var filRows = rows(shown.filter(function (e) { return !e.acc; })),
        accRows = rows(shown.filter(function (e) { return e.acc; }));
    if (!filRows && !accRows && !newRow) {
      bcBody.innerHTML = '<div class="bc-table-wrap"><p class="hint" style="padding:12px">Aucun résultat pour «&nbsp;' + esc(q) + '&nbsp;».</p></div>';
      return;
    }

    // un seul tableau (colonnes alignées) ; les accessoires ont leur propre section
    bcBody.innerHTML = '<div class="bc-table-wrap"><table class="bc-table">' +
      '<thead><tr><th>Code-barres</th><th>Filament</th><th>Format</th><th></th></tr></thead>' +
      '<tbody>' + newRow + filRows +
      (accRows ? '<tr class="bc-group"><th colspan="4">Accessoires</th></tr>' + accRows : '') +
      '</tbody></table></div>';
    wireCodes();
  }

  function viewRowHtml(e) {
    var sw = e.acc ? '' : '<span class="ro-sw" style="background:' + esc(swatchBg(e.f.hex, colorsOf(e.f))) + '"></span>';
    return '<tr data-key="' + esc(e.key) + '">' +
      '<td class="bc-code"><code>' + esc(e.code) + '</code></td>' +
      '<td class="bc-fil"><span class="bc-fil-in">' + sw + (e.acc
        ? '<span>' + esc(e.f.name || '(sans nom)') + ((e.f.attrs && e.f.attrs.description) ? '<small class="bc-acc-desc">' + esc(e.f.attrs.description) + '</small>' : '') + '</span>'
        : esc(filLabel(e.f))) + '</span></td>' +
      '<td class="bc-format">' + kindLabel(e.kind) + '</td>' +
      '<td class="bc-act">' +
        '<button type="button" class="btn btn-ghost btn-sm bc-edit">Modifier</button>' +
        '<button type="button" class="btn btn-ghost btn-sm bc-del">Suppr.</button>' +
      '</td>' +
    '</tr>';
  }
  function editRowHtml(e, key, isNew) {
    return '<tr class="bc-editing" data-key="' + esc(key) + '">' +
      '<td><input type="text" class="bc-e-code" value="' + esc(e.code) + '" placeholder="Code-barres" autocomplete="off"></td>' +
      '<td><select class="bc-e-fil">' + filCodeOptions(e.productId, e.scope || (e.acc ? 'acc' : 'fil')) + '</select></td>' +
      '<td><select class="bc-e-kind"' + (e.acc ? ' hidden' : '') + '>' + kindOptions(e.kind) + '</select>' +
        '<span class="bc-format bc-e-item"' + (e.acc ? '' : ' hidden') + '>article</span></td>' +
      '<td class="bc-act">' +
        '<button type="button" class="btn btn-accent btn-sm bc-save">' + (isNew ? 'Associer' : 'Enregistrer') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm bc-cancel">Annuler</button>' +
      '</td>' +
    '</tr>';
  }

  function wireCodes() {
    // le format se restreint aux formats réellement vendus par le filament choisi
    // (comme la page Filaments) : si le filament ne se vend qu'en recharge, on force « Recharge ».
    $$('.bc-e-fil', bcBody).forEach(function (sel) {
      var applyKinds = function () {
        var tr = sel.closest('tr'), kindSel = tr && tr.querySelector('.bc-e-kind'); if (!kindSel) return;
        // accessoire : pas de format bobine/recharge
        var acc = !!accProd(sel.value), itemLbl = tr.querySelector('.bc-e-item');
        kindSel.hidden = acc; if (itemLbl) itemLbl.hidden = !acc;
        if (acc) return;
        var f = filProd(sel.value);
        var os = kindSel.querySelector('option[value="spool"]'), orf = kindSel.querySelector('option[value="refill"]');
        if (!f) { if (os) os.disabled = false; if (orf) orf.disabled = false; return; }
        var hasS = offersSpool(f), hasR = offersRefill(f);
        if (os) os.disabled = !hasS; if (orf) orf.disabled = !hasR;
        if (!hasS && hasR) kindSel.value = 'refill';
        else if (!hasR && hasS) kindSel.value = 'spool';
      };
      sel.addEventListener('change', applyKinds);
      applyKinds();   // applique aussi immédiatement (édition d'une ligne existante)
    });
    $$('.bc-edit', bcBody).forEach(function (b) {
      b.addEventListener('click', function () { bcEditing = b.closest('tr').getAttribute('data-key'); renderCodes(); });
    });
    $$('.bc-del', bcBody).forEach(function (b) {
      b.addEventListener('click', function () {
        var e = entryByKey(b.closest('tr').getAttribute('data-key')); if (!e) return;
        caDialog.confirm({ title: 'Supprimer le code « ' + e.code + ' » ?', message: bcLabel(e.f) + ' · ' + kindLabel(e.kind),
          ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
          if (!ok) return;
          applyBarcodeChange(e, null, function (err) {
            if (err) { caDialog.error(err); return; }
            renderCodes();
          });
        });
      });
    });
    $$('.bc-cancel', bcBody).forEach(function (b) {
      b.addEventListener('click', function () { bcEditing = null; pendingScanCode = ''; renderCodes(); if (bcScanActive) bcFocusScan(); });
    });
    $$('.bc-save', bcBody).forEach(function (b) {
      b.addEventListener('click', function () {
        var tr = b.closest('tr'), key = tr.getAttribute('data-key');
        var code = $('.bc-e-code', tr).value.trim();
        var pid = $('.bc-e-fil', tr).value;
        if (!code) { $('.bc-e-code', tr).focus(); return; }
        if (!pid) { $('.bc-e-fil', tr).focus(); return; }
        var kind = accProd(pid) ? 'item' : ($('.bc-e-kind', tr).value === 'refill' ? 'refill' : 'spool');
        var oldEntry = (key === '__new__') ? null : entryByKey(key);
        // doublon : ce code appartient-il déjà à une AUTRE association ?
        var owner = findCodeOwner(code);
        if (owner && (!oldEntry || owner.key !== oldEntry.key)) {
          caDialog.alert({ title: 'Code déjà associé', message: bcLabel(owner.f) + ' · ' + kindLabel(owner.kind) +
            '\nModifie ou supprime cette association-là d\'abord.' });
          return;
        }
        applyBarcodeChange(oldEntry, { productId: pid, kind: kind, code: code }, function (err) {
          if (err) { caDialog.error(err); return; }
          bcEditing = null; pendingScanCode = ''; renderCodes();
          if (bcScanActive) { bcScanFb('✓ Associé & vérifié : ' + code, 'ok'); bcFocusScan(); }
        });
      });
    });
  }
  function entryByKey(key) { return allBarcodeEntries().filter(function (e) { return e.key === key; })[0] || null; }

  // applique un changement : retire l'ancien emplacement (si fourni), pose le nouveau,
  // en écrivant products.attrs.barcodes pour chaque produit touché.
  function applyBarcodeChange(oldEntry, newEntry, done) {
    var work = {};
    function ensure(f) {
      if (!work[f.id]) {
        var a = Object.assign({}, f.attrs || {});
        a.barcodes = Object.assign({}, a.barcodes || {});
        work[f.id] = { f: f, attrs: a };
      }
      return work[f.id];
    }
    if (oldEntry) {
      var op = bcProd(oldEntry.productId);
      if (op) { var wo = ensure(op); delete wo.attrs.barcodes[oldEntry.kind]; if (!Object.keys(wo.attrs.barcodes).length) delete wo.attrs.barcodes; }
    }
    if (newEntry) {
      var np = bcProd(newEntry.productId);
      if (!np) { done(new Error('Article introuvable.')); return; }
      var wn = ensure(np);
      wn.attrs.barcodes = wn.attrs.barcodes || {};
      wn.attrs.barcodes[newEntry.kind] = newEntry.code;
    }
    var ids = Object.keys(work);
    if (!ids.length) { done(null); return; }
    Promise.all(ids.map(function (id) {
      var w = work[id];
      return sb.from('products').update({ attrs: w.attrs, updated_at: new Date().toISOString() }).eq('id', id).select()
        .then(function (res) {
          if (res.error || !res.data || !res.data.length) throw (res.error || new Error('refusé (permissions ?)'));
          w.f.attrs = res.data[0].attrs || w.attrs;   // maj mémoire -> scan reconnaît tout de suite
        });
    })).then(function () { done(null); }, function (e) { done(e); });
  }

  // si les matériaux changent ailleurs (formats offerts, ORDRE réarrangé), rafraîchir
  if (window.CA.onMaterialsChange) window.CA.onMaterialsChange(function () { if (loaded) { renderReorder(); renderCodes(); } });
})();
