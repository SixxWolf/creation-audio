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
      historyEl = $('#r-history'), refreshBtn = $('#r-refresh');

  /* ---- activation quand on ouvre l'onglet ---- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'inventaire') ensureLoad();
  };
  function ensureLoad() {
    if (loaded) return;
    loaded = true;
    if (!dateI.value) dateI.value = todayISO();
    Promise.all([
      window.CA.loadMaterials ? window.CA.loadMaterials() : Promise.resolve(),
      loadFilaments()
    ]).then(function () { renderRows(); loadHistory(); renderReorder(); }, function () { loadHistory(); });
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

  function filProd(id) { return filaments.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function matOf(f) { return f && window.CA.materialOf ? window.CA.materialOf(f.brand, f.material) : null; }
  function matHasSpool(f) { var m = matOf(f); return !!(m && m.sell_spool != null); }
  function matHasRefill(f) { var m = matOf(f); return !!(m && m.sell_refill != null); }
  // format réellement vendu pour CETTE couleur = matériau l'offre ET la couleur ne l'a pas désactivé
  function offersSpool(f) { return matHasSpool(f) && f.offer_spool !== false; }
  function offersRefill(f) { return matHasRefill(f) && f.offer_refill !== false; }
  function filLabel(f) { return (f.brand ? f.brand + ' · ' : '') + (f.material ? f.material + ' · ' : '') + (f.name || '(sans nom)'); }
  function kindLabel(k) { return k === 'refill' ? 'recharge' : 'bobine'; }

  /* =========================================================
     SOUS-ONGLETS
     ========================================================= */
  var subReception = $('#inv-sub-reception'), subCommander = $('#inv-sub-commander');
  $$('.inv-subtab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var sub = btn.getAttribute('data-sub');
      $$('.inv-subtab').forEach(function (b) { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
      if (subReception) subReception.hidden = (sub !== 'reception');
      if (subCommander) subCommander.hidden = (sub !== 'commander');
      if (sub === 'commander') renderReorder();
      if (sub === 'reception' && scanActive) focusScan();
    });
  });

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
    var opts = ['<option value="">— choisir —</option>'];
    filaments.forEach(function (f) {
      opts.push('<option value="' + esc(f.id) + '"' + (String(f.id) === String(selected) ? ' selected' : '') + '>' + esc(filLabel(f)) + '</option>');
    });
    return opts.join('');
  }

  function renderRows() {
    if (!rows.length) { rowsEl.innerHTML = ''; emptyHint.style.display = ''; updateScanCount(); return; }
    emptyHint.style.display = 'none';
    rowsEl.innerHTML = rows.map(function (r, i) {
      var f = filProd(r.productId);
      var hasS = !r.productId || offersSpool(f);
      var hasR = !r.productId || offersRefill(f);
      return '<tr class="rcp-row' + (r.productId ? '' : ' unmatched') + '" data-i="' + i + '">' +
        '<td class="rcp-fil"><select class="rcp-fil-sel">' + filamentOptions(r.productId) + '</select>' +
          (!r.productId && r.label ? '<div class="hint">détecté : ' + esc(r.label) + '</div>' : '') + '</td>' +
        '<td><select class="rcp-kind">' +
            '<option value="spool"' + (r.kind !== 'refill' ? ' selected' : '') + (hasS ? '' : ' disabled') + '>Avec bobine</option>' +
            '<option value="refill"' + (r.kind === 'refill' ? ' selected' : '') + (hasR ? '' : ' disabled') + '>Recharge</option>' +
          '</select></td>' +
        '<td class="num"><input type="number" class="rcp-qty num" min="0" step="1" value="' + (r.qty != null ? r.qty : '') + '"></td>' +
        '<td><button type="button" class="rcp-row-del" aria-label="Retirer">✕</button></td>' +
      '</tr>';
    }).join('');

    $$('.rcp-row', rowsEl).forEach(function (tr) {
      var i = +tr.getAttribute('data-i');
      $('.rcp-fil-sel', tr).addEventListener('change', function () {
        rows[i].productId = this.value;
        var f = filProd(this.value);
        if (rows[i].kind === 'refill' && !offersRefill(f) && offersSpool(f)) rows[i].kind = 'spool';
        if (rows[i].kind === 'spool' && !offersSpool(f) && offersRefill(f)) rows[i].kind = 'refill';
        renderRows();
      });
      $('.rcp-kind', tr).addEventListener('change', function () { rows[i].kind = this.value; });
      $('.rcp-qty', tr).addEventListener('input', function () { rows[i].qty = Math.max(0, parseInt(this.value, 10) || 0); updateScanCount(); });
      $('.rcp-row-del', tr).addEventListener('click', function () { rows.splice(i, 1); renderRows(); });
    });
    updateScanCount();
  }

  if (addLineBtn) addLineBtn.addEventListener('click', function () { rows.push({ productId: '', kind: 'spool', qty: 1, label: '' }); renderRows(); });
  if (resetBtn) resetBtn.addEventListener('click', resetForm);
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
    return null;
  }

  function feedback(msg, cls) {
    scanFeedback.textContent = msg;
    scanFeedback.className = 'scan-feedback' + (cls ? ' ' + cls : '');
  }

  function processScan(code) {
    var hit = findByBarcode(code);
    if (!hit) { openLearn(code); return; }
    var qty = addScanUnit(hit.f, hit.kind);
    feedback('✓ ' + filLabel(hit.f) + ' · ' + kindLabel(hit.kind) + '  (×' + qty + ')', 'ok');
    bumpCount();
    focusScan();
  }

  // crédite +1 la ligne (productId+kind) ; renvoie la nouvelle quantité de cette ligne
  function addScanUnit(f, kind) {
    var line = rows.filter(function (r) { return String(r.productId) === String(f.id) && r.kind === kind; })[0];
    if (line) { line.qty = (line.qty | 0) + 1; }
    else { line = { productId: String(f.id), kind: kind, qty: 1, label: filLabel(f) }; rows.push(line); }
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
  function learnOptions() {
    var opts = ['<option value="">— choisir le filament —</option>'];
    filaments.forEach(function (f) {
      opts.push('<option value="' + esc(f.id) + '">' + esc(filLabel(f)) + '</option>');
    });
    return opts.join('');
  }
  function openLearn(code) {
    pendingCode = code;
    learnOpen = true;
    scanLearnCode.textContent = code;
    scanLearnFil.innerHTML = learnOptions();
    scanLearnFil.value = '';
    scanLearnKind.value = 'spool';
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
    var f = filProd(scanLearnFil.value);
    if (!f) { scanLearnFil.focus(); return; }
    var kind = scanLearnKind.value === 'refill' ? 'refill' : 'spool';
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
        feedback('✓ Associé & compté : ' + filLabel(f) + ' · ' + kindLabel(kind) + '  (×' + qty + ')', 'ok');
        bumpCount();
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
        label: material + ' · ' + color + ' (' + code + ')'
      });
    });
    return out;
  }

  /* =========================================================
     CONFIRMATION (création / modification) — inchangé
     ========================================================= */
  function applyStock(lines, sign) {
    return Promise.all(lines.filter(function (l) { return l.product_id && l.qty > 0; }).map(function (l) {
      return sb.rpc('receive_stock', { p_product: l.product_id, p_kind: l.kind, p_qty: sign * l.qty });
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
        var f = filaments.filter(function (x) { return String(x.id) === String(r.productId); })[0];
        return { receipt_id: receiptId, product_id: r.productId, label: f ? filLabel(f) : null, kind: r.kind, qty: r.qty };
      });
    };

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

    chain.then(function () {
      confirmBtn.disabled = false;
      statusEl.textContent = editingReceiptId ? '✓ Réception modifiée, stock ajusté.' : '✓ Réception enregistrée, stock mis à jour.';
      resetForm();
      loadFilaments().then(function () { renderReorder(); });
      loadHistory();
    }, function (err) {
      confirmBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
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
      var linesHtml = lines.map(function (l) {
        return '<li>' + esc(l.label || '(filament supprimé)') + ' — ' + (l.kind === 'refill' ? 'recharge' : 'bobine') + ' × ' + (l.qty | 0) + '</li>';
      }).join('');
      return '<div class="mat-row rcp-hist" data-id="' + esc(rc.id) + '">' +
        '<div class="mat-main">' +
          '<div class="rcp-hist-head">' +
            '<span class="rcp-hist-order">' + (rc.order_number ? esc(rc.order_number) : 'Commande sans n°') + '</span>' +
            '<span class="grow"></span>' +
            '<span class="rcp-hist-meta">' + esc(rc.received_at) + ' · ' + lines.length + ' ligne(s) · ' + totalRolls + ' article(s)</span>' +
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
      return { productId: l.product_id ? String(l.product_id) : '', kind: l.kind === 'refill' ? 'refill' : 'spool', qty: l.qty | 0, label: l.label || '' };
    });
    setMode(rc, lines);
    renderRows();
    statusEl.textContent = 'Modifie puis « Enregistrer les modifications ». Le stock sera réajusté.';
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function delReceipt(rc, lines) {
    if (!window.confirm('Supprimer cette réception' + (rc.order_number ? ' (' + rc.order_number + ')' : '') +
      ' ?\nLe stock qu\'elle a ajouté sera retiré.')) return;
    applyStock(lines, -1)
      .then(function () { return sb.from('receipts').delete().eq('id', rc.id).select(); })
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Suppression refusée (permissions).');
        if (editingReceiptId === rc.id) resetForm();
        loadFilaments().then(function () { renderReorder(); });
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
            (f.code ? ' <span class="ro-code">' + esc(f.code) + '</span>' : '') + '</span>' +
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

    var listHtml = Object.keys(byBrand).map(function (brand) {
      var lis = byBrand[brand].map(function (it) {
        var sw = swatchBg(it.f.hex, colorsOf(it.f));
        return '<li><span class="ro-sw" style="background:' + esc(sw) + '"></span>' +
          '<span>' + esc((it.f.material ? it.f.material + ' · ' : '') + (it.f.name || '')) +
          ' <span class="ro-code">' + kindLabel(it.kind) + (it.f.code ? ' · ' + esc(it.f.code) : '') + '</span></span>' +
          '<span class="ro-q">×' + it.qty + '</span></li>';
      }).join('');
      return '<div class="reorder-brandgroup"><h3 style="font-size:.9rem;margin:12px 0 4px">' + esc(brand) + '</h3>' +
        '<ul class="reorder-list">' + lis + '</ul></div>';
    }).join('');

    reorderSummary.innerHTML = '<div class="reorder-card has-miss">' +
      '<div class="reorder-card-head">' +
        '<h2>Liste à commander</h2>' +
        '<span class="grow"></span>' +
        '<span class="reorder-total">' + totalUnits + ' article' + (totalUnits > 1 ? 's' : '') + '</span>' +
        '<button class="btn btn-ghost btn-sm" id="reorder-copy" type="button">Copier la liste</button>' +
      '</div>' + listHtml + '</div>';

    var copyBtn = $('#reorder-copy');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var text = buildOrderText(byBrand);
      var done = function () { copyBtn.textContent = '✓ Copié'; setTimeout(function () { copyBtn.textContent = 'Copier la liste'; }, 1600); };
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

  // si les matériaux changent ailleurs (formats offerts), rafraîchir la vue réappro
  if (window.CA.onMaterialsChange) window.CA.onMaterialsChange(function () { if (loaded) renderReorder(); });
})();
