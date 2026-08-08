/* =========================================================
   Création Audio V2 — Inventaire / Réception de commande
   - Saisir un n° de commande Bambu + date.
   - Coller le texte de la commande -> pré-remplir un tableau
     (filament · type · quantité), corrigeable.
   - Confirmer -> incrémente le stock (RPC receive_stock) et
     archive la réception (tables receipts / receipt_lines).
   - Historique des réceptions (réconsultable).
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
    ]).then(function () { renderRows(); loadHistory(); }, function () { loadHistory(); });
  }

  // toutes marques confondues (une réception peut mélanger, on rattache par code)
  function loadFilaments() {
    return sb.from('products').select('id,name,material,code,brand').eq('type', 'filament')
      .order('material', { ascending: true }).order('name', { ascending: true })
      .then(function (res) { filaments = (res.data || []); });
  }

  function filProd(id) { return filaments.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function matHasRefill(f) { var m = f && window.CA.materialOf ? window.CA.materialOf(f.brand, f.material) : null; return !!(m && m.sell_refill != null); }
  function matHasSpool(f) { var m = f && window.CA.materialOf ? window.CA.materialOf(f.brand, f.material) : null; return !!(m && m.sell_spool != null); }
  function filLabel(f) { return (f.brand ? f.brand + ' · ' : '') + (f.material ? f.material + ' · ' : '') + (f.name || '(sans nom)'); }

  /* ---- lignes du tableau (état: [{productId, kind, qty, label}]) ---- */
  var rows = [];
  var editingReceiptId = null;   // null = création ; sinon = modification d'une réception existante
  var editingOldLines = [];      // lignes d'origine (pour annuler leur effet stock lors d'une modif)

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
    if (!rows.length) { rowsEl.innerHTML = ''; emptyHint.style.display = ''; return; }
    emptyHint.style.display = 'none';
    rowsEl.innerHTML = rows.map(function (r, i) {
      var f = filProd(r.productId);
      var hasS = !r.productId || matHasSpool(f);
      var hasR = !r.productId || matHasRefill(f);
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
        // aligner le type sur les formats offerts par le matériau
        if (rows[i].kind === 'refill' && !matHasRefill(f) && matHasSpool(f)) rows[i].kind = 'spool';
        if (rows[i].kind === 'spool' && !matHasSpool(f) && matHasRefill(f)) rows[i].kind = 'refill';
        renderRows();
      });
      $('.rcp-kind', tr).addEventListener('change', function () { rows[i].kind = this.value; });
      $('.rcp-qty', tr).addEventListener('input', function () { rows[i].qty = Math.max(0, parseInt(this.value, 10) || 0); });
      $('.rcp-row-del', tr).addEventListener('click', function () { rows.splice(i, 1); renderRows(); });
    });
  }

  if (addLineBtn) addLineBtn.addEventListener('click', function () { rows.push({ productId: '', kind: 'spool', qty: 1, label: '' }); renderRows(); });
  if (resetBtn) resetBtn.addEventListener('click', resetForm);
  function resetForm() {
    rows = []; pasteI.value = ''; orderI.value = ''; dateI.value = todayISO();
    parseHint.textContent = ''; statusEl.textContent = '';
    setMode(null, []);
    renderRows();
  }

  /* ---- analyse du texte collé (best-effort, calibré ensuite sur un vrai exemple) ---- */
  if (parseBtn) parseBtn.addEventListener('click', function () {
    var text = pasteI.value || '';
    if (!text.trim()) { parseHint.textContent = 'Colle d\'abord le texte de la commande.'; return; }
    var found = parseText(text);
    if (!found.length) { parseHint.textContent = 'Rien reconnu automatiquement — ajoute les lignes à la main.'; return; }
    // fusionne avec les lignes existantes (append)
    found.forEach(function (r) { rows.push(r); });
    parseHint.textContent = found.length + ' ligne(s) détectée(s) — vérifie/complète avant de confirmer.';
    renderRows();
  });

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  // rattache une ligne à un filament du catalogue.
  // Priorité : CODE Bambu (infaillible) ; puis (matériau + couleur) ; repli : couleur seule.
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

  // Format Bambu : la ligne « Couleur(code) / Type / 1kg » est l'ancre.
  // Le matériau est la ligne juste au-dessus ; la quantité est le petit
  // entier isolé dans les 3 lignes précédentes.
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
      // quantité : premier entier isolé dans les 3 lignes au-dessus
      var qty = 1;
      for (var k = i - 1; k >= 0 && k >= i - 3; k--) {
        if (/^\d+$/.test(lines[k])) { qty = parseInt(lines[k], 10); break; }
      }
      var f = matchFilament(material, color, code);
      if (f && kind === 'refill' && !matHasRefill(f) && matHasSpool(f)) kind = 'spool';
      if (f && kind === 'spool' && !matHasSpool(f) && matHasRefill(f)) kind = 'refill';
      out.push({
        productId: f ? String(f.id) : '',
        kind: kind,
        qty: qty,
        label: material + ' · ' + color + ' (' + code + ')'
      });
    });
    return out;
  }

  /* ---- application du stock (delta signé, ligne par ligne) ---- */
  function applyStock(lines, sign) {
    return Promise.all(lines.filter(function (l) { return l.product_id && l.qty > 0; }).map(function (l) {
      return sb.rpc('receive_stock', { p_product: l.product_id, p_kind: l.kind, p_qty: sign * l.qty });
    }));
  }

  /* ---- confirmation : création OU modification ---- */
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
      // MODIFICATION : annuler l'ancien effet stock, remplacer les lignes, réappliquer.
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
      // CRÉATION
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
      loadFilaments();
      loadHistory();
    }, function (err) {
      confirmBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }

  /* ---- historique ---- */
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

  /* ---- charger une réception dans le formulaire pour la modifier ---- */
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

  /* ---- supprimer une réception : annule son effet stock puis supprime ---- */
  function delReceipt(rc, lines) {
    if (!window.confirm('Supprimer cette réception' + (rc.order_number ? ' (' + rc.order_number + ')' : '') +
      ' ?\nLe stock qu\'elle a ajouté sera retiré.')) return;
    applyStock(lines, -1)
      .then(function () { return sb.from('receipts').delete().eq('id', rc.id).select(); })
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Suppression refusée (permissions).');
        if (editingReceiptId === rc.id) resetForm();
        loadFilaments();
        loadHistory();
      }, function (err) { window.alert('Erreur : ' + (err && err.message ? err.message : err)); });
  }
})();
