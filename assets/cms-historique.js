/* =========================================================
   Création Audio V2 — Historique des factures (Phase 5)
   - Liste toutes les factures (invoices + invoice_lines).
   - Recherche (n° / client) + filtre Actives / Annulées / Toutes.
   - Détail des lignes, réimpression au format exact.
   - ANNULER une facture à tout moment : le stock déduit est REMIS
     (receive_stock positif), la facture passe en statut « annulée ».
   - Supprimer définitivement (remet aussi le stock si nécessaire).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var BUCKET = 'products';
  var LS_CO = 'ca_v2_facture_company';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function fmtDateFR(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    try { return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return iso; }
  }
  var CAT_LABEL = { filament: 'Filament', spacer: 'Spacer', accessory: 'Accessoire', caisson: 'Caisson', mixte: 'Mixte' };

  var DEFAULT_CO = {
    name: 'Création Audio', tagline: 'Audio automobile & impression 3D — Québec',
    address: '', city: 'Québec, QC', email: 'contact@creationaudio.ca', phone: '', gst: '', qst: '', logo: ''
  };
  function loadCompany() {
    var co = {}; try { co = JSON.parse(localStorage.getItem(LS_CO)) || {}; } catch (e) {}
    var m = {}; for (var k in DEFAULT_CO) m[k] = (co[k] != null && co[k] !== '') ? co[k] : DEFAULT_CO[k];
    return m;
  }

  /* ---------- état ---------- */
  var loaded = false, invoices = [], linesByInv = {}, filter = 'active', catFilter = 'all', query = '';

  var listEl = $('#hist-list'), searchEl = $('#hist-search'), refreshBtn = $('#hist-refresh'), printBox = $('#hist-print');

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'historique') { if (!loaded) { loaded = true; load(); } }
  };
  window.CA.reloadHistorique = function () { if (loaded) load(); };   // appelé après un enregistrement de facture

  if (refreshBtn) refreshBtn.addEventListener('click', load);
  if (searchEl) searchEl.addEventListener('input', function () { query = this.value.trim().toLowerCase(); render(); });
  $$('.hist-fbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      $$('.hist-fbtn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      render();
    });
  });
  $$('.hist-cbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      catFilter = b.getAttribute('data-c');
      $$('.hist-cbtn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      render();
    });
  });

  /* ---------- chargement ---------- */
  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    sb.from('invoices').select('*').order('created_at', { ascending: false }).then(function (res) {
      if (res.error) { listEl.innerHTML = '<p class="empty">Impossible de charger.<br>As-tu relancé <strong>schema-v2.sql</strong> ?</p>'; return; }
      invoices = res.data || [];
      linesByInv = {};
      if (!invoices.length) { render(); return; }
      var ids = invoices.map(function (r) { return r.id; });
      sb.from('invoice_lines').select('*').in('invoice_id', ids).order('sort_order', { ascending: true }).then(function (r2) {
        (r2.data || []).forEach(function (l) { (linesByInv[l.invoice_id] = linesByInv[l.invoice_id] || []).push(l); });
        render();
      }, function () { render(); });
    }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  function catOf(inv) { return inv.category || 'mixte'; }
  // filtre statut + recherche (indépendant de la catégorie -> sert aussi aux compteurs)
  function passStatusQuery(inv) {
    var cancelled = inv.status === 'cancelled';
    if (filter === 'active' && cancelled) return false;
    if (filter === 'cancelled' && !cancelled) return false;
    if (query) {
      var hay = ((inv.number || '') + ' ' + (inv.client_name || '') + ' ' + (inv.client_contact || '')).toLowerCase();
      if (hay.indexOf(query) === -1) return false;
    }
    return true;
  }
  function visible() {
    return invoices.filter(function (inv) {
      if (!passStatusQuery(inv)) return false;
      if (catFilter !== 'all' && catOf(inv) !== catFilter) return false;
      return true;
    });
  }
  function updateCatCounts() {
    var counts = { all: 0, filament: 0, spacer: 0, accessory: 0, caisson: 0, mixte: 0 };
    invoices.forEach(function (inv) {
      if (!passStatusQuery(inv)) return;
      counts.all++;
      var c = catOf(inv); if (counts[c] != null) counts[c]++;
    });
    $$('.hist-cnt').forEach(function (el) { el.textContent = counts[el.getAttribute('data-cnt')] || 0; });
  }

  function render() {
    updateCatCounts();
    var rows = visible();
    if (!rows.length) {
      listEl.innerHTML = '<p class="empty">' + (invoices.length ? 'Aucune facture pour ce filtre.' : 'Aucune facture enregistrée pour l\'instant.') + '</p>';
      return;
    }
    listEl.innerHTML = rows.map(function (inv) {
      var cancelled = inv.status === 'cancelled';
      var badge = '<span class="hist-cat">' + esc(CAT_LABEL[inv.category] || inv.category || '—') + '</span>';
      var dealer = inv.client_type === 'olivier' ? '<span class="hist-dealer">Dealer</span>' : '';
      return '<div class="hist-row' + (cancelled ? ' is-cancelled' : '') + '" data-id="' + esc(inv.id) + '">' +
        '<div class="hist-head">' +
          '<span class="hist-num">' + esc(inv.number || '—') + '</span>' + badge +
          (cancelled ? '<span class="hist-annul">Annulée</span>' : '') +
          '<span class="hist-client">' + esc(inv.client_name || 'Sans client') + ' ' + dealer + '</span>' +
          '<span class="grow"></span>' +
          '<span class="hist-date">' + esc(fmtDateFR(inv.invoice_date)) + '</span>' +
          '<span class="hist-total">' + money(inv.total) + '</span>' +
        '</div>' +
        '<div class="hist-detail"></div>' +
      '</div>';
    }).join('');

    $$('.hist-row', listEl).forEach(function (el) {
      var inv = rows.filter(function (x) { return String(x.id) === el.getAttribute('data-id'); })[0];
      $('.hist-head', el).addEventListener('click', function () { toggleDetail(el, inv); });
    });
  }

  function toggleDetail(el, inv) {
    var box = $('.hist-detail', el);
    if (el.classList.contains('open')) { el.classList.remove('open'); box.innerHTML = ''; return; }
    el.classList.add('open');
    var lines = linesByInv[inv.id] || [];
    var cancelled = inv.status === 'cancelled';
    var linesHtml = lines.map(function (l) {
      return '<tr><td>' + esc(l.label || '(ligne)') + (l.meta ? ' <span class="hd-meta">' + esc(l.meta) + '</span>' : '') + '</td>' +
        '<td class="num">' + (+l.qty) + '</td><td class="num">' + money(l.unit_price) + '</td><td class="num">' + money(l.line_total) + '</td></tr>';
    }).join('');
    var stockNote = inv.stock_deducted ? '<span class="hd-stock">stock déduit</span>' : (cancelled ? '<span class="hd-stock ok">stock remis</span>' : '');
    box.innerHTML =
      '<table class="hist-lines"><thead><tr><th>Article</th><th class="num">Qté</th><th class="num">Prix</th><th class="num">Montant</th></tr></thead>' +
        '<tbody>' + (linesHtml || '<tr><td colspan="4" class="muted">(aucune ligne)</td></tr>') + '</tbody></table>' +
      (inv.note ? '<div class="hd-note">' + esc(inv.note) + '</div>' : '') +
      '<div class="hist-actions">' +
        '<span class="hd-sum">Sous-total ' + money(inv.subtotal) + (inv.tax_enabled ? ' · taxes ' + money((+inv.tax_gst) + (+inv.tax_qst)) : '') + ' · <b>Total ' + money(inv.total) + '</b></span>' +
        stockNote +
        '<span class="grow"></span>' +
        '<button class="btn btn-ghost btn-sm hd-print" type="button">Réimprimer</button>' +
        (cancelled ? '' : '<button class="btn btn-ghost btn-sm hd-cancel" type="button">Annuler</button>') +
        '<button class="btn btn-ghost btn-sm hd-del" type="button">Suppr.</button>' +
      '</div>';
    $('.hd-print', box).addEventListener('click', function (e) { e.stopPropagation(); reprint(inv, lines); });
    var cb = $('.hd-cancel', box); if (cb) cb.addEventListener('click', function (e) { e.stopPropagation(); cancelInvoice(inv, lines); });
    $('.hd-del', box).addEventListener('click', function (e) { e.stopPropagation(); delInvoice(inv, lines); });
  }

  /* ---------- remise en stock (inverse de la déduction) ---------- */
  function restoreStock(lines) {
    var calls = (lines || []).filter(function (l) { return l.product_id && l.qty > 0; }).map(function (l) {
      return sb.rpc('receive_stock', { p_product: l.product_id, p_kind: l.kind === 'refill' ? 'refill' : 'spool', p_qty: Math.abs(+l.qty) });
    });
    return Promise.all(calls);
  }

  function cancelInvoice(inv, lines) {
    if (inv.status === 'cancelled') return;
    if (!window.confirm('Annuler la facture ' + (inv.number || '') + ' ?\n' +
      (inv.stock_deducted ? 'Le stock déduit sera remis.\n' : '') +
      'Elle restera dans l\'historique (marquée « Annulée ») et sortira des statistiques.')) return;
    var chain = inv.stock_deducted ? restoreStock(lines) : Promise.resolve();
    chain.then(function () {
      return sb.from('invoices').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), stock_deducted: false })
        .eq('id', inv.id).select();
    }).then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('Annulation refusée (permissions).');
      load();
    }, function (err) { window.alert('Erreur : ' + (err && err.message ? err.message : err)); });
  }

  function delInvoice(inv, lines) {
    if (!window.confirm('Supprimer définitivement la facture ' + (inv.number || '') + ' ?\n' +
      (inv.stock_deducted ? 'Le stock déduit sera remis avant suppression.\n' : '') +
      'Cette action est irréversible.')) return;
    var chain = inv.stock_deducted ? restoreStock(lines) : Promise.resolve();
    chain.then(function () { return sb.from('invoices').delete().eq('id', inv.id).select(); })
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Suppression refusée (permissions).');
        load();
      }, function (err) { window.alert('Erreur : ' + (err && err.message ? err.message : err)); });
  }

  /* ---------- réimpression (format facture) ---------- */
  function publicUrl(path) { if (!path) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function buildDoc(inv, lines) {
    var co = loadCompany();
    var meta = [];
    if (co.address) meta.push(co.address);
    if (co.city) meta.push(co.city);
    if (co.email) meta.push(co.email);
    if (co.phone) meta.push(co.phone);

    var dealer = inv.client_type === 'olivier' ? ' <span class="inv-cli-tag">Dealer</span>' : '';
    var billto = (inv.client_name || inv.client_contact || inv.client_address || inv.client_city)
      ? '<div class="inv-billto"><div class="lbl">Facturé à</div>' +
        (inv.client_name ? '<div class="who">' + esc(inv.client_name) + dealer + '</div>' : '') +
        (inv.client_address ? '<div>' + esc(inv.client_address) + '</div>' : '') +
        (inv.client_city ? '<div>' + esc(inv.client_city) + '</div>' : '') +
        (inv.client_contact ? '<div>' + esc(inv.client_contact) + '</div>' : '') + '</div>'
      : '';

    var rows = (lines || []).map(function (l) {
      return '<tr><td>' + esc(l.label || '') + (l.meta ? ' <span class="inv-mat">' + esc(l.meta) + '</span>' : '') + '</td>' +
        '<td class="num">' + (+l.qty) + '</td><td class="num">' + money(l.unit_price) + '</td><td class="num">' + money(l.line_total) + '</td></tr>';
    }).join('');

    var taxLines = inv.tax_enabled
      ? '<div class="line"><span>TPS' + (co.gst ? ' <span class="taxno">' + esc(co.gst) + '</span>' : '') + '</span><span>' + money(inv.tax_gst) + '</span></div>' +
        '<div class="line"><span>TVQ' + (co.qst ? ' <span class="taxno">' + esc(co.qst) + '</span>' : '') + '</span><span>' + money(inv.tax_qst) + '</span></div>'
      : '';

    var cancelled = inv.status === 'cancelled'
      ? '<div class="inv-cancelled">FACTURE ANNULÉE</div>' : '';

    return '<div class="inv-top">' +
        '<div class="inv-co">' + (co.logo ? '<img class="inv-logo" src="' + co.logo + '" alt="">' : '') +
          '<div class="inv-co-name">' + esc(co.name) + '</div>' +
          (co.tagline ? '<div class="inv-co-tag">' + esc(co.tagline) + '</div>' : '') +
          (meta.length ? '<div class="inv-co-meta">' + esc(meta.join('\n')) + '</div>' : '') + '</div>' +
        '<div class="inv-title"><h1>FACTURE</h1><div class="inv-meta">N° ' + esc(inv.number || '—') + '<br>' + esc(fmtDateFR(inv.invoice_date)) + '</div></div>' +
      '</div>' + cancelled + billto +
      '<table class="inv-table"><thead><tr><th>Description</th><th class="num">Qté</th><th class="num">Prix unit.</th><th class="num">Montant</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
      '<div class="inv-tot">' +
        '<div class="line"><span>Sous-total</span><span>' + money(inv.subtotal) + '</span></div>' + taxLines +
        '<div class="line grand"><span>Total</span><span>' + money(inv.total) + '</span></div>' +
      '</div>' +
      (inv.note ? '<div class="inv-pay"><span class="lbl">Note</span>' + esc(inv.note) + '</div>' : '') +
      '<div class="inv-foot">Aucun paiement en ligne — ramassage à Québec. Merci de votre confiance&nbsp;!</div>';
  }
  function reprint(inv, lines) {
    if (!printBox) return;
    printBox.innerHTML = buildDoc(inv, lines);
    document.body.classList.add('printing-hist');
    window.print();
    setTimeout(function () { document.body.classList.remove('printing-hist'); printBox.innerHTML = ''; }, 400);
  }
})();
