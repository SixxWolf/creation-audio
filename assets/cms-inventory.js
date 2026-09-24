/* =========================================================
   Création Audio V2 — Inventaire
   Deux sous-onglets :
   1) RÉCEPTION (scan) — un scanner de code-barres « tape » un code
      EAN/UPC puis Entrée. Chaque scan crédite +1 le bon filament
      dans le bon format (bobine / recharge). Décompte en direct.
      Codes appris une fois (attrs.barcodes.{spool,refill}) puis
      reconnus automatiquement. Confirmer -> receive_stock + archive.
   2) À COMMANDER — cible de stock par format (attrs.par_spool /
      attrs.par_refill). Le manque (cible - stock) est calculé et
      regroupé en liste de commande copiable.
   Aucune migration SQL : tout vit dans products.attrs.
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

  var editor = $('#r-editor'), editorTitle = $('#r-editor-title'), orderI = $('#r-order'), dateI = $('#r-date'), pasteI = $('#r-paste'),
      parseBtn = $('#r-parse'), parseHint = $('#r-parse-hint'), addLineBtn = $('#r-add-line'),
      rowsEl = $('#r-rows'), emptyHint = $('#r-empty-hint'),
      confirmBtn = $('#r-confirm'), resetBtn = $('#r-reset'), statusEl = $('#r-status'),
      historyEl = $('#r-history'), refreshBtn = $('#r-refresh'),
      discMode = $('#r-disc-mode'), discVal = $('#r-disc-val'), discApply = $('#r-disc-apply'), discReset = $('#r-disc-reset');

  function num(v) { if (v == null || v === '') return null; var n = +v; return isFinite(n) ? n : null; }
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }
  function money(n) { return round2(n).toFixed(2).replace('.', ',') + ' $'; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x != null && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
  // coût catalogue (référence matériau) pour CE filament + format — sert de défaut
  function refCostOf(f, kind) {
    if (f && isAcc(f)) return num(f.cost_price);   // accessoire : prix à l'unité du produit
    var m = matOf(f);
    if (m) return num(kind === 'refill' ? m.cost_refill : m.cost_spool);
    return num(kind === 'refill' ? f.cost_price_2 : f.cost_price);
  }
  // prix de vente (référence matériau) pour l'aperçu de marge à la réception
  function sellOf(f, kind) {
    if (f && isAcc(f)) return num(f.sell_price);
    var m = matOf(f);
    if (m) return num(kind === 'refill' ? m.sell_refill : m.sell_spool);
    return num(kind === 'refill' ? f.sell_price_2 : f.sell_price);
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
    ]).then(function () { renderRows(); loadHistory(); renderReorder(); renderCatalog(); renderCodes(); }, function () { loadHistory(); });
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

  /* =========================================================
     SOUS-ONGLETS
     ========================================================= */
  var subReception = $('#inv-sub-reception'), subCommander = $('#inv-sub-commander'),
      subCatalogue = $('#inv-sub-catalogue'), subCodes = $('#inv-sub-codes'), subAttente = $('#inv-sub-attente');
  // bascule DOM du sous-onglet (l'URL est gérée par le routing de admin-core)
  function showSub(sub) {
    if (['commander', 'catalogue', 'codes', 'attente'].indexOf(sub) < 0) sub = 'reception';
    $$('.inv-subtab').forEach(function (b) {
      var on = b.getAttribute('data-sub') === sub;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', String(on));
    });
    if (subReception) subReception.hidden = (sub !== 'reception');
    if (subCommander) subCommander.hidden = (sub !== 'commander');
    if (subCatalogue) subCatalogue.hidden = (sub !== 'catalogue');
    if (subCodes) subCodes.hidden = (sub !== 'codes');
    if (subAttente) subAttente.hidden = (sub !== 'attente');
    if (sub === 'commander') renderReorder();
    if (sub === 'catalogue') renderCatalog();
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
     RÉCEPTION — lignes du tableau (état : [{productId, kind, qty, label}])
     ========================================================= */
  var rows = [];
  var editingReceiptId = null;
  var editingOldLines = [];

  function setMode(receipt, oldLines) {
    editingReceiptId = receipt ? receipt.id : null;
    editingOldLines = oldLines || [];
    editorTitle.textContent = receipt ? 'Modifier la réception' : 'Nouvelle réception';
    confirmBtn.textContent = receipt ? 'Enregistrer les modifications' : 'Confirmer la réception';
  }

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

  // cellule « prix payé » : champ + repère de marge réelle (vente − prix payé)
  function priceCell(r, f) {
    var ref = f ? refCostOf(f, r.kind) : null;
    var val = (r.unitCost != null && r.unitCost !== '') ? r.unitCost : '';
    var ph = ref != null ? ref.toFixed(2) : '';
    var input = '<input type="number" class="rcp-price num" min="0" step="0.01" value="' + val + '"' +
      ' placeholder="' + ph + '" title="Laisse vide pour le prix catalogue">';
    return input + '<div class="rcp-price-hint">' + priceHint(r, f) + '</div>';
  }
  function priceHint(r, f) {
    if (!f) return '';
    var paid = num(r.unitCost); var ref = refCostOf(f, r.kind);
    var eff = paid != null ? paid : ref;               // prix effectif (payé, sinon catalogue)
    var sell = sellOf(f, r.kind);
    if (eff == null) return '<span class="muted">—</span>';
    var bits = [];
    if (paid != null && ref != null && Math.abs(paid - ref) >= 0.005) {
      var d = paid - ref;
      bits.push('<span class="' + (d < 0 ? 'pos' : 'neg') + '">' + (d < 0 ? '' : '+') + money(d) + ' vs catalogue</span>');
    }
    if (sell != null) {
      var m = sell - eff, pct = sell > 0 ? Math.round(m / sell * 100) : 0;
      bits.push('<span class="' + (m >= 0 ? 'pos' : 'neg') + '">marge ' + money(m) + (sell > 0 ? ' · ' + pct + '%' : '') + '</span>');
    }
    return bits.join(' · ') || '<span class="muted">catalogue</span>';
  }

  function renderRows() {
    if (!rows.length) { rowsEl.innerHTML = ''; emptyHint.style.display = ''; updateScanCount(); return; }
    emptyHint.style.display = 'none';
    rowsEl.innerHTML = rows.map(function (r, i) {
      var f = bcProd(r.productId), acc = isAcc(f);
      var hasS = !r.productId || acc || offersSpool(f);
      var hasR = !r.productId || acc || offersRefill(f);
      return '<tr class="rcp-row' + (r.productId ? '' : ' unmatched') + '" data-i="' + i + '">' +
        '<td class="rcp-fil"><select class="rcp-fil-sel">' + filamentOptions(r.productId) + '</select>' +
          (!r.productId && r.label ? '<div class="hint">détecté : ' + esc(r.label) + '</div>' : '') + '</td>' +
        '<td>' + (acc
          ? '<span class="rcp-kind-item">Article</span>'
          : '<select class="rcp-kind">' +
            '<option value="spool"' + (r.kind !== 'refill' ? ' selected' : '') + (hasS ? '' : ' disabled') + '>Avec bobine</option>' +
            '<option value="refill"' + (r.kind === 'refill' ? ' selected' : '') + (hasR ? '' : ' disabled') + '>Recharge</option>' +
          '</select>') + '</td>' +
        '<td class="num"><input type="number" class="rcp-qty num" min="0" step="1" value="' + (r.qty != null ? r.qty : '') + '"></td>' +
        '<td class="num rcp-price-cell">' + priceCell(r, f) + '</td>' +
        '<td><button type="button" class="rcp-row-del" aria-label="Retirer">✕</button></td>' +
      '</tr>';
    }).join('');

    $$('.rcp-row', rowsEl).forEach(function (tr) {
      var i = +tr.getAttribute('data-i');
      $('.rcp-fil-sel', tr).addEventListener('change', function () {
        rows[i].productId = this.value;
        rows[i].kind = fitKind(bcProd(this.value), rows[i].kind);
        renderRows();
      });
      var kindSel = $('.rcp-kind', tr);
      if (kindSel) kindSel.addEventListener('change', function () { rows[i].kind = this.value; renderRows(); });
      $('.rcp-qty', tr).addEventListener('input', function () { rows[i].qty = Math.max(0, parseInt(this.value, 10) || 0); updateScanCount(); });
      var priceInp = $('.rcp-price', tr);
      if (priceInp) priceInp.addEventListener('input', function () {
        rows[i].unitCost = this.value === '' ? null : Math.max(0, parseFloat(this.value) || 0);
        var hint = $('.rcp-price-hint', tr);
        if (hint) hint.innerHTML = priceHint(rows[i], bcProd(rows[i].productId));
      });
      $('.rcp-row-del', tr).addEventListener('click', function () { rows.splice(i, 1); renderRows(); });
    });
    updateScanCount();
  }

  if (addLineBtn) addLineBtn.addEventListener('click', function () { rows.push({ productId: '', kind: 'spool', qty: 1, label: '', unitCost: null }); renderRows(); });
  if (resetBtn) resetBtn.addEventListener('click', resetForm);

  // « Prix payé » global : applique un rabais % ou un prix fixe à toutes les lignes
  if (discApply) discApply.addEventListener('click', function () {
    var mode = discMode ? discMode.value : 'pct';
    var v = num(discVal && discVal.value);
    if (v == null) { statusEl.textContent = 'Entre une valeur à appliquer.'; return; }
    rows.forEach(function (r) {
      var f = bcProd(r.productId); if (!f) return;
      if (mode === 'fixed') { r.unitCost = round2(Math.max(0, v)); return; }
      var ref = refCostOf(f, r.kind);
      if (ref != null) r.unitCost = round2(Math.max(0, ref * (1 - v / 100)));
    });
    renderRows();
    statusEl.textContent = mode === 'fixed'
      ? '✓ Prix fixé à ' + money(v) + '/unité sur toutes les lignes.'
      : '✓ Rabais de ' + v + ' % appliqué sur le prix catalogue de chaque ligne.';
  });
  if (discReset) discReset.addEventListener('click', function () {
    rows.forEach(function (r) { r.unitCost = null; });
    if (discVal) discVal.value = '';
    renderRows();
    statusEl.textContent = 'Prix catalogue rétabli sur toutes les lignes.';
  });
  function resetForm() {
    rows = []; pasteI.value = ''; orderI.value = ''; dateI.value = todayISO();
    parseHint.textContent = ''; statusEl.textContent = '';
    setMode(null, []);
    renderRows();
  }

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
    scanToggle.textContent = scanActive ? '⏸ Réception en cours…' : '▶ Démarrer la réception';
    scanInput.placeholder = scanActive ? 'En attente d\'un scan… (garde cette case active)' : 'Clique « Démarrer » puis scanne un code-barres…';
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
          a.closest('#r-rows, #scan-learn, .editor-actions, #r-order, #r-date, .rcp-manual, .inv-subtab')) return;
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
    var qty = addScanUnit(hit.f, hit.kind);
    feedback('✓ ' + scanLabel(hit.f, hit.kind) + '  (×' + qty + ')', 'ok');
    bumpCount();
    if (window.CA.waitlist) window.CA.waitlist.onScan(hit.f.id, hit.kind);   // quelqu'un l'attend ?
    focusScan();
  }

  // crédite +1 la ligne (productId+kind) ; renvoie la nouvelle quantité de cette ligne
  function addScanUnit(f, kind) {
    var line = rows.filter(function (r) { return String(r.productId) === String(f.id) && r.kind === kind; })[0];
    if (line) { line.qty = (line.qty | 0) + 1; }
    else { line = { productId: String(f.id), kind: kind, qty: 1, label: bcLabel(f), unitCost: null }; rows.push(line); }
    renderRows();
    return line.qty;
  }

  function updateScanCount() {
    if (!scanCount) return;
    var total = rows.reduce(function (s, r) { return s + (r.qty | 0); }, 0);
    var lines = rows.filter(function (r) { return (r.qty | 0) > 0; }).length;
    scanCount.innerHTML = '<span class="scan-count-num">' + total + '</span>' +
      '<span class="scan-count-lbl">' + (total <= 1 ? 'article' : 'articles') +
      (lines ? ' · ' + lines + ' ligne' + (lines > 1 ? 's' : '') : '') + '</span>';
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
        var qty = addScanUnit(f, kind);
        feedback('✓ Associé & compté : ' + scanLabel(f, kind) + '  (×' + qty + ')', 'ok');
        bumpCount();
        if (window.CA.waitlist) window.CA.waitlist.onScan(f.id, kind);
        focusScan();
      }, function (err) {
        scanLearnSave.disabled = false;
        feedback('Erreur : ' + (err && err.message ? err.message : err), 'bad');
      });
  });

  /* =========================================================
     ANALYSE DU TEXTE COLLÉ (repli manuel — inchangé)
     ========================================================= */
  if (parseBtn) parseBtn.addEventListener('click', function () {
    var text = pasteI.value || '';
    if (!text.trim()) { parseHint.textContent = 'Colle d\'abord le texte de la commande.'; return; }
    var found = parseText(text);
    if (!found.length) { parseHint.textContent = 'Rien reconnu automatiquement — ajoute les lignes à la main.'; return; }
    found.forEach(function (r) { rows.push(r); });
    parseHint.textContent = found.length + ' ligne(s) détectée(s) — vérifie/complète avant de confirmer.';
    renderRows();
  });

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  function matchFilament(material, color, code) {
    if (code) {
      var byCode = filaments.filter(function (f) { return f.code && String(f.code).trim() === String(code).trim(); })[0];
      if (byCode) return byCode;
    }
    var nm = norm(material), nc = norm(color);
    var exact = filaments.filter(function (f) { return norm(f.material) === nm && norm(f.name) === nc; })[0];
    if (exact) return exact;
    return filaments.filter(function (f) { return norm(f.name) === nc; })[0] || null;
  }

  function parseText(text) {
    var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); });
    var out = [];
    var anchor = /^(.+?)\s*\((\d+)\)\s*\/\s*(.+?)\s*\/\s*[\d.]+\s*kg\b/i;
    lines.forEach(function (l, i) {
      var m = l.match(anchor);
      if (!m) return;
      var color = m[1].trim(), code = m[2], typeStr = m[3];
      var kind = /spool/i.test(typeStr) ? 'spool' : (/refill/i.test(typeStr) ? 'refill' : 'spool');
      var material = (i >= 1 ? lines[i - 1] : '') || '';
      var qty = 1;
      for (var k = i - 1; k >= 0 && k >= i - 3; k--) {
        if (/^\d+$/.test(lines[k])) { qty = parseInt(lines[k], 10); break; }
      }
      var f = matchFilament(material, color, code);
      if (f && kind === 'refill' && !offersRefill(f) && offersSpool(f)) kind = 'spool';
      if (f && kind === 'spool' && !offersSpool(f) && offersRefill(f)) kind = 'refill';
      out.push({
        productId: f ? String(f.id) : '',
        kind: kind,
        qty: qty,
        label: material + ' · ' + color + ' (' + code + ')',
        unitCost: null
      });
    });
    return out;
  }

  /* =========================================================
     CONFIRMATION (création / modification) — inchangé
     ========================================================= */
  function applyStock(lines, sign) {
    return Promise.all(lines.filter(function (l) { return l.product_id && l.qty > 0; }).map(function (l) {
      return sb.rpc('receive_stock', { p_product: l.product_id, p_kind: l.kind, p_qty: sign * l.qty })
        .then(function (res) { if (res && res.error) throw res.error; return res; });   // ne PAS masquer une erreur RPC
    }));
  }

  if (editor) editor.addEventListener('submit', onConfirm);
  function onConfirm(e) {
    e.preventDefault();
    var valid = rows.filter(function (r) { return r.productId && r.qty > 0; });
    if (!valid.length) { statusEl.textContent = 'Ajoute au moins une ligne (filament + quantité).'; return; }
    var missing = rows.some(function (r) { return !r.productId && r.qty > 0; });
    if (missing && !window.confirm('Certaines lignes n\'ont pas de filament choisi et seront ignorées. Continuer ?')) return;

    var date = /^\d{4}-\d{2}-\d{2}$/.test(dateI.value) ? dateI.value : todayISO();
    var order = orderI.value.trim() || null;
    var newLinesFor = function (receiptId) {
      return valid.map(function (r) {
        var f = bcProd(r.productId);
        return { receipt_id: receiptId, product_id: r.productId, label: f ? bcLabel(f) : null, kind: fitKind(f, r.kind), qty: r.qty,
          unit_cost: (r.unitCost != null && r.unitCost !== '') ? round2(r.unitCost) : null };
      });
    };
    // produits dont le coût moyen doit être recalculé (anciennes + nouvelles lignes)
    var affected = uniq(
      editingOldLines.map(function (l) { return l.product_id; })
        .concat(valid.map(function (r) { return r.productId; }))
    );

    confirmBtn.disabled = true;
    statusEl.textContent = 'Enregistrement…';

    var chain;
    if (editingReceiptId) {
      var rid = editingReceiptId;
      chain = applyStock(editingOldLines, -1)
        .then(function () { return sb.from('receipt_lines').delete().eq('receipt_id', rid); })
        .then(function () { return sb.from('receipts').update({ order_number: order, received_at: date }).eq('id', rid).select(); })
        .then(function (res) {
          if (res.error || !res.data || !res.data.length) throw (res.error || new Error('Modification refusée (permissions).'));
          var lines = newLinesFor(rid);
          return sb.from('receipt_lines').insert(lines).then(function (r2) {
            if (r2.error) throw r2.error;
            return applyStock(lines, +1);
          });
        });
    } else {
      chain = sb.from('receipts').insert({ order_number: order, received_at: date, note: null }).select()
        .then(function (res) {
          if (res.error || !res.data || !res.data.length) throw (res.error || new Error('Réception refusée (permissions).'));
          var lines = newLinesFor(res.data[0].id);
          return sb.from('receipt_lines').insert(lines).then(function (r2) {
            if (r2.error) throw r2.error;
            return applyStock(lines, +1);
          });
        });
    }

    chain.then(function () { return recomputeAvgCosts(affected); }).then(function () {
      confirmBtn.disabled = false;
      statusEl.textContent = editingReceiptId ? '✓ Réception modifiée, stock et coût moyen ajustés.' : '✓ Réception enregistrée, stock et coût moyen mis à jour.';
      // liste d'attente : alerte pour TOUT ce qui vient d'entrer (y compris lignes saisies à la main)
      if (window.CA.waitlist) window.CA.waitlist.onReceived(valid.map(function (r) { return { productId: r.productId, kind: fitKind(bcProd(r.productId), r.kind) }; }));
      resetForm();
      Promise.all([loadFilaments(), loadAccessories()]).then(function () { renderReorder(); });
      loadHistory();
    }, function (err) {
      confirmBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }

  /* ---- Coût moyen pondéré : recalcul par rejeu des réceptions ----
     Pour chaque produit touché, on relit TOUTES ses lignes de réception
     et on recalcule attrs.avg_cost { spool, refill }. Une ligne sans prix
     saisi retombe sur le coût catalogue du matériau. Le rejeu rend le tout
     rétroactif et cohérent même après modification/suppression. */
  function recomputeAvgCosts(productIds) {
    productIds = uniq(productIds || []).filter(Boolean);
    if (!productIds.length) return Promise.resolve();
    return sb.from('receipt_lines').select('product_id,kind,qty,unit_cost').in('product_id', productIds)
      .then(function (res) {
        if (res.error) throw res.error;
        var byProd = {};
        (res.data || []).forEach(function (l) {
          var g = byProd[l.product_id] || (byProd[l.product_id] = { spool: [], refill: [] });
          (l.kind === 'refill' ? g.refill : g.spool).push(l);
        });
        return Promise.all(productIds.map(function (pid) {
          var f = bcProd(pid);
          if (!f) return null;
          var g = byProd[pid] || { spool: [], refill: [] };
          var attrs = Object.assign({}, f.attrs || {});
          var ac = {};
          if (isAcc(f)) {
            // accessoire : un seul coût moyen (lignes 'item' rangées avec 'spool' ci-dessus)
            var avgI = CA.costing.avg(g.spool, refCostOf(f, 'item'));
            if (avgI != null) ac.item = avgI;
          } else {
            var avgS = CA.costing.avg(g.spool, refCostOf(f, 'spool'));
            var avgR = CA.costing.avg(g.refill, refCostOf(f, 'refill'));
            if (avgS != null) ac.spool = avgS;
            if (avgR != null) ac.refill = avgR;
          }
          if (Object.keys(ac).length) attrs.avg_cost = ac; else delete attrs.avg_cost;
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
        var eff = priced ? +l.unit_cost : refCostOf(bcProd(l.product_id), l.kind === 'refill' ? 'refill' : 'spool');
        if (eff != null) { totalCost += eff * q; hasAnyCost = true; }
        var priceTxt = priced
          ? '<span class="rcp-hist-price">' + money(l.unit_cost) + '/u</span>'
          : '<span class="rcp-hist-price muted">catalogue' + (eff != null ? ' ' + money(eff) + '/u' : '') + '</span>';
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
    orderI.value = rc.order_number || '';
    dateI.value = rc.received_at || todayISO();
    pasteI.value = ''; parseHint.textContent = '';
    rows = lines.map(function (l) {
      return { productId: l.product_id ? String(l.product_id) : '', kind: l.kind === 'refill' ? 'refill' : (l.kind === 'item' ? 'item' : 'spool'), qty: l.qty | 0, label: l.label || '',
        unitCost: (l.unit_cost != null && l.unit_cost !== '') ? +l.unit_cost : null };
    });
    setMode(rc, lines);
    renderRows();
    statusEl.textContent = 'Modifie puis « Enregistrer les modifications ». Le stock sera réajusté.';
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function delReceipt(rc, lines) {
    if (!window.confirm('Supprimer cette réception' + (rc.order_number ? ' (' + rc.order_number + ')' : '') +
      ' ?\nLe stock qu\'elle a ajouté sera retiré.')) return;
    var affected = uniq(lines.map(function (l) { return l.product_id; }));
    applyStock(lines, -1)
      .then(function () { return sb.from('receipts').delete().eq('id', rc.id).select(); })
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Suppression refusée (permissions).');
        return recomputeAvgCosts(affected);
      })
      .then(function () {
        if (editingReceiptId === rc.id) resetForm();
        Promise.all([loadFilaments(), loadAccessories()]).then(function () { renderReorder(); });
        loadHistory();
      }, function (err) { window.alert('Erreur : ' + (err && err.message ? err.message : err)); });
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
    return Math.max(0, parOf(f, kind) - stockOf(f, kind));
  }

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
  // la liste d'attente se charge en parallèle -> on rafraîchit les pastilles à son arrivée
  document.addEventListener('ca:waitlist', function () { if (loaded && reorderBody && subCommander && !subCommander.hidden) renderReorder(); });

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
            (f.code ? ' <span class="ro-code">' + esc(f.code) + '</span>' : '') + waitBadge(f) + '</span>' +
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

  // enregistre le coût catalogue d'un matériau (cost_spool / cost_refill) dans la table materials.
  // `cols` = { cost_spool?, cost_refill? } (valeur nombre ou null). Met à jour le cache CA.materials
  // en place -> réception (refCostOf) et facturation en profitent aussitôt. Renvoie une promesse.
  function updateMaterialCost(brand, name, cols) {
    var m = window.CA.materialOf ? window.CA.materialOf(brand, name) : null;
    if (!m) return Promise.resolve({ error: 'introuvable' });
    var patch = { updated_at: new Date().toISOString() };
    if ('cost_spool' in cols) patch.cost_spool = cols.cost_spool;
    if ('cost_refill' in cols) patch.cost_refill = cols.cost_refill;
    return sb.from('materials').update(patch).eq('brand', brand).eq('name', name).select()
      .then(function (res) {
        if (res.error || !res.data || !res.data.length) return { error: res.error || 'refusé' };
        if ('cost_spool' in cols) m.cost_spool = res.data[0].cost_spool;
        if ('cost_refill' in cols) m.cost_refill = res.data[0].cost_refill;
        return { data: res.data[0] };
      }, function (err) { return { error: err }; });
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

    // Estimé de la commande = prix catalogue (coût matériau par format, même base que
    // la réception) × quantité manquante ; avant taxes, rabais et livraison. Les
    // articles sans prix catalogue ne sont pas comptés (listés pour les compléter).
    var est = 0, estByBrand = {}, noPrice = {};
    items.forEach(function (it) {
      var c = refCostOf(it.f, it.kind), b = it.f.brand || '—';
      if (c == null) { noPrice[(it.f.material || it.f.name || '—') + ' · ' + kindLabel(it.kind)] = 1; return; }
      est += c * it.qty;
      estByBrand[b] = (estByBrand[b] || 0) + c * it.qty;
    });
    var missing = Object.keys(noPrice);
    var multiBrand = Object.keys(byBrand).length > 1;
    var tx = taxRates(), taxMul = 1 + (tx.gst + tx.qst) / 100;
    var estHtml = (est > 0 || !missing.length)
      ? '<span class="reorder-est" title="Prix catalogue × quantités à commander, + TPS ' + fmtRate(tx.gst) + ' % et TVQ ' + fmtRate(tx.qst) +
          ' % (taux de Facturation) — hors rabais et livraison">Estimé <b>≈ ' + money(est * taxMul) + '</b> taxes incluses' +
          ' <span class="reorder-est-ht">(' + money(est) + ' avant taxes)</span></span>'
      : '';
    var noteHtml = missing.length
      ? '<p class="reorder-est-note">Sans prix catalogue, non compté' + (missing.length > 1 ? 's' : '') + ' : ' +
          esc(missing.slice(0, 4).join(', ')) + (missing.length > 4 ? '…' : '') +
          ' — <button type="button" class="ro-link" id="reorder-to-catalog">compléter les prix catalogue</button></p>'
      : '';

    var listHtml = Object.keys(byBrand).map(function (brand) {
      var lis = byBrand[brand].map(function (it) {
        var sw = swatchBg(it.f.hex, colorsOf(it.f));
        return '<li><span class="ro-sw" style="background:' + esc(sw) + '"></span>' +
          '<span>' + esc((it.f.material ? it.f.material + ' · ' : '') + (it.f.name || '')) +
          ' <span class="ro-code">' + kindLabel(it.kind) + (it.f.code ? ' · ' + esc(it.f.code) : '') + '</span></span>' +
          '<span class="ro-q">×' + it.qty + '</span></li>';
      }).join('');
      return '<div class="reorder-brandgroup"><h3 style="font-size:.9rem;margin:12px 0 4px">' + esc(brand) +
          (multiBrand && estByBrand[brand] ? '<span class="ro-brand-est">≈ ' + money(estByBrand[brand] * taxMul) + ' taxes incl.</span>' : '') + '</h3>' +
        '<ul class="reorder-list">' + lis + '</ul></div>';
    }).join('');

    reorderSummary.innerHTML = '<div class="reorder-card has-miss">' +
      '<div class="reorder-card-head">' +
        '<h2>Liste à commander</h2>' +
        '<span class="grow"></span>' +
        estHtml +
        '<span class="reorder-total">' + totalUnits + ' article' + (totalUnits > 1 ? 's' : '') + '</span>' +
        '<button class="btn btn-ghost btn-sm" id="reorder-copy" type="button">Copier la liste</button>' +
      '</div>' + noteHtml + listHtml + '</div>';

    var toCat = $('#reorder-to-catalog');
    if (toCat) toCat.addEventListener('click', function () {
      if (window.CA.route && window.CA.route.goSub) window.CA.route.goSub('catalogue'); else showSub('catalogue');
    });
    var copyBtn = $('#reorder-copy');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var text = buildOrderText(byBrand);
      var done = function () { copyBtn.textContent = '✓ Copié'; setTimeout(function () { copyBtn.textContent = 'Copier la liste'; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else { fallbackCopy(text); done(); }
    });
  }

  // taux TPS / TVQ réglés dans Facturation (« Coordonnées de l'entreprise & taxes »,
  // mémorisés sur l'appareil) ; défaut Québec 5 % / 9,975 %, comme Facturation.
  function taxRates() {
    var co = {}; try { co = JSON.parse(localStorage.getItem('ca_v2_facture_company')) || {}; } catch (e) {}
    function rate(v, d) { var n = parseFloat(v); return (v != null && v !== '' && isFinite(n)) ? n : d; }
    return { gst: rate(co.gstRate, 5), qst: rate(co.qstRate, 9.975) };
  }
  function fmtRate(n) { return String(n).replace('.', ','); }

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
     PRIX CATALOGUE — coût de base par matériau (cost_spool / cost_refill).
     Édition ligne par ligne + application groupée d'un prix (bobine / recharge)
     à plusieurs matériaux cochés d'un coup. C'est ce coût qui sert de base au
     rabais % de la réception (refCostOf), avant que le CMP prenne le relais.
     ========================================================= */
  var catalogBody = $('#catalog-body'), catalogBrand = $('#catalog-brand'),
      catalogBulkSpool = $('#catalog-bulk-spool'), catalogBulkRefill = $('#catalog-bulk-refill'),
      catalogApply = $('#catalog-apply'), catalogStatus = $('#catalog-status'), catalogRefresh = $('#catalog-refresh');
  var catBrand = '';   // '' = toutes les marques

  if (catalogBrand) catalogBrand.addEventListener('change', function () { catBrand = this.value; renderCatalog(); });
  if (catalogRefresh) catalogRefresh.addEventListener('click', function () {
    (window.CA.loadMaterials ? window.CA.loadMaterials() : Promise.resolve()).then(renderCatalog, renderCatalog);
  });
  if (catalogApply) catalogApply.addEventListener('click', applyBulkCost);

  function catalogBrands() {
    var list = (window.CA.materials && window.CA.materials.list) || [];
    var seen = {}, out = [];
    list.forEach(function (m) { if (!seen[m.brand]) { seen[m.brand] = 1; out.push(m.brand); } });
    out.sort(function (a, z) { return brandOrderIndex(a) - brandOrderIndex(z); });
    return out;
  }
  function catalogMaterials() {
    var list = ((window.CA.materials && window.CA.materials.list) || []).slice();
    list = list.filter(function (m) { return !catBrand || m.brand === catBrand; });
    list.sort(function (a, z) {
      var ba = brandOrderIndex(a.brand), bz = brandOrderIndex(z.brand); if (ba !== bz) return ba - bz;
      return matOrderIndex(a.brand, a.name) - matOrderIndex(z.brand, z.name);
    });
    return list;
  }
  function populateCatalogBrand() {
    if (!catalogBrand) return;
    var brands = catalogBrands();
    if (catBrand && brands.indexOf(catBrand) < 0) catBrand = '';
    catalogBrand.innerHTML = '<option value="">Toutes les marques</option>' + brands.map(function (b) {
      return '<option value="' + esc(b) + '"' + (b === catBrand ? ' selected' : '') + '>' + esc(b) + '</option>';
    }).join('');
    catalogBrand.value = catBrand || '';
  }

  function renderCatalog() {
    if (!catalogBody) return;
    if (!loaded) { ensureLoad(); return; }
    populateCatalogBrand();
    var mats = catalogMaterials();
    if (!mats.length) {
      catalogBody.innerHTML = '<p class="empty">Aucun matériau. Ajoute des matériaux dans l\'onglet <b>Filaments</b>.</p>';
      return;
    }
    var multiBrand = !catBrand && catalogBrands().length > 1;
    function costCell(kind, has, val) {
      if (!has) return '<td class="cat-na">—</td>';
      return '<td><input type="number" class="catcost num" data-kind="' + kind + '" min="0" step="0.01" value="' +
        (val != null ? val : '') + '" placeholder="0.00"></td>';
    }
    var rows = mats.map(function (m) {
      var hasS = m.sell_spool != null, hasR = m.sell_refill != null;
      return '<tr data-brand="' + esc(m.brand || '') + '" data-mat="' + esc(m.name || '') + '">' +
        '<td class="cat-check-td"><input type="checkbox" class="cat-check"></td>' +
        '<td class="l"><span class="cat-mat">' + esc(m.name || '(sans nom)') + '</span>' +
          (multiBrand ? ' <span class="cat-brand">' + esc(m.brand || '') + '</span>' : '') + '</td>' +
        costCell('spool', hasS, m.cost_spool) +
        costCell('refill', hasR, m.cost_refill) +
      '</tr>';
    }).join('');
    catalogBody.innerHTML =
      '<div class="reorder-table-wrap"><table class="reorder-table catalog-table">' +
        '<thead><tr>' +
          '<th class="cat-check-td"><input type="checkbox" class="cat-check-all" title="Tout cocher / décocher"></th>' +
          '<th class="l">Matériau</th><th>Bobine</th><th>Recharge</th>' +
        '</tr></thead><tbody>' + rows + '</tbody>' +
      '</table></div>';
    wireCatalog();
  }

  function wireCatalog() {
    $$('.catcost', catalogBody).forEach(function (inp) {
      var tr = inp.closest('tr');
      var brand = tr.getAttribute('data-brand'), mat = tr.getAttribute('data-mat');
      var col = inp.getAttribute('data-kind') === 'refill' ? 'cost_refill' : 'cost_spool';
      var commit = function () {
        var v = (inp.value === '') ? null : Math.max(0, round2(inp.value));
        var cols = {}; cols[col] = v;
        tr.classList.add('saving');
        updateMaterialCost(brand, mat, cols).then(function (r) {
          tr.classList.remove('saving');
          if (!r.error && v != null) inp.value = v;
          flashRow(tr, !r.error);
        });
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    });
    var all = $('.cat-check-all', catalogBody);
    if (all) all.addEventListener('change', function () {
      $$('.cat-check', catalogBody).forEach(function (c) { c.checked = all.checked; });
    });
  }

  function flashRow(tr, ok) {
    var cls = ok ? 'saved' : 'save-err';
    tr.classList.add(cls);
    setTimeout(function () { tr.classList.remove(cls); }, ok ? 900 : 2500);
  }

  // applique le(s) prix saisi(s) dans la barre à tous les matériaux cochés.
  // Un champ vide = ce format n'est pas touché ; un matériau qui n'offre pas le format est ignoré pour ce format.
  function applyBulkCost() {
    if (!catalogStatus) return;
    var setS = catalogBulkSpool && catalogBulkSpool.value !== '';
    var setR = catalogBulkRefill && catalogBulkRefill.value !== '';
    if (!setS && !setR) { catalogStatus.textContent = 'Entre un prix bobine et/ou recharge à appliquer.'; return; }
    var sNum = setS ? Math.max(0, round2(catalogBulkSpool.value)) : null;
    var rNum = setR ? Math.max(0, round2(catalogBulkRefill.value)) : null;
    var checked = $$('.cat-check', catalogBody).filter(function (c) { return c.checked; });
    if (!checked.length) { catalogStatus.textContent = 'Coche au moins un matériau.'; return; }

    var jobs = [];
    checked.forEach(function (c) {
      var tr = c.closest('tr');
      var brand = tr.getAttribute('data-brand'), mat = tr.getAttribute('data-mat');
      var m = window.CA.materialOf ? window.CA.materialOf(brand, mat) : null;
      if (!m) return;
      var cols = {};
      if (setS && m.sell_spool != null) cols.cost_spool = sNum;
      if (setR && m.sell_refill != null) cols.cost_refill = rNum;
      if (!('cost_spool' in cols) && !('cost_refill' in cols)) return;   // n'offre pas le(s) format(s) saisi(s)
      tr.classList.add('saving');
      jobs.push(updateMaterialCost(brand, mat, cols).then(function (r) {
        tr.classList.remove('saving');
        if (!r.error) {
          if ('cost_spool' in cols) { var i1 = tr.querySelector('.catcost[data-kind="spool"]'); if (i1) i1.value = cols.cost_spool != null ? cols.cost_spool : ''; }
          if ('cost_refill' in cols) { var i2 = tr.querySelector('.catcost[data-kind="refill"]'); if (i2) i2.value = cols.cost_refill != null ? cols.cost_refill : ''; }
        }
        flashRow(tr, !r.error);
        return r;
      }));
    });
    if (!jobs.length) { catalogStatus.textContent = 'Les matériaux cochés n\'offrent pas ce(s) format(s).'; return; }

    catalogApply.disabled = true;
    catalogStatus.textContent = 'Application…';
    Promise.all(jobs).then(function (rs) {
      catalogApply.disabled = false;
      var okN = rs.filter(function (r) { return !r.error; }).length, errN = rs.length - okN;
      catalogStatus.textContent = '✓ Prix appliqué à ' + okN + ' matériau' + (okN > 1 ? 'x' : '') +
        (errN ? ' · ' + errN + ' refusé' + (errN > 1 ? 's' : '') : '') + '.';
    });
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
      bcScanToggle.textContent = bcScanActive ? '⏸ Scan en cours…' : '▶ Scanner pour vérifier';
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
        if (!window.confirm('Supprimer l\'association du code « ' + e.code +' » ?\n(' + bcLabel(e.f) + ' · ' + kindLabel(e.kind) + ')')) return;
        applyBarcodeChange(e, null, function (err) {
          if (err) { window.alert('Erreur : ' + (err.message || err)); return; }
          renderCodes();
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
          window.alert('Ce code est déjà associé à :\n' + bcLabel(owner.f) + ' · ' + kindLabel(owner.kind) +
            '.\nModifie ou supprime cette association-là d\'abord.');
          return;
        }
        applyBarcodeChange(oldEntry, { productId: pid, kind: kind, code: code }, function (err) {
          if (err) { window.alert('Erreur : ' + (err.message || err)); return; }
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
  if (window.CA.onMaterialsChange) window.CA.onMaterialsChange(function () { if (loaded) { renderReorder(); renderCatalog(); renderCodes(); } });
})();
