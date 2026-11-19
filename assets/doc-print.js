/* =========================================================
   Création Audio — Facture / reçu imprimable d'une commande dealer
   CA.docPrint(kind, docs) : kind = 'invoice' | 'receipt',
   docs = résultat de la RPC dealer_order_docs (facture + lignes + entreprise + paid_at).
   Même document côté admin (Commandes) et côté dealer (Mes commandes) ;
   « Imprimer / Enregistrer en PDF » = window.print().
   Mise en page : doc-print.css.
   ========================================================= */
(function () {
  'use strict';
  window.CA = window.CA || {};
  var _t = window.CA.t || function (s) { return s; };
  var loc = window.CA.locale || 'fr-CA';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString(loc, { style: 'currency', currency: 'CAD' }); }
  function fmtDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''), d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
    if (isNaN(d)) return String(iso || '');
    return d.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' });
  }
  var DEFAULT_CO = { name: 'Création Audio', tagline: _t('Audio automobile & impression 3D — Québec'),
    address: '', city: _t('Québec, QC'), email: 'contact@creationaudio.ca', phone: '', gst: '', qst: '', logo: '' };

  /* Design « A · Accent » — même document que le PDF joint au courriel (supabase/functions/invoice-notify/pdf.ts) :
     filet orange, FACTURE à droite, blocs De / Facturé à, vignettes photo (l.img = adresse), total en bloc noir.
     docs.title : titre à la place de FACTURE (Facturation : USAGE INTERNE, ENVOI AMAZON) ; docs.internal : sans
     « Facturé à » ni remerciement ; docs.extra : HTML ajouté sous le paiement (Facturation : envoi Amazon). */
  function build(kind, docs) {
    var inv = docs.invoice, co = {}, c0 = docs.company || {}, k;
    for (k in DEFAULT_CO) co[k] = (c0[k] != null && c0[k] !== '') ? c0[k] : DEFAULT_CO[k];
    var isReceipt = kind === 'receipt';
    // crédit boutique dealer (invoices.credit_used) : déduit du total, le reste est payé comptant/Interac
    var credit = Math.round((+inv.credit_used || 0) * 100) / 100;
    var rest = Math.max(0, Math.round(((+inv.total || 0) - credit) * 100) / 100);
    var PAY = { cash: _t('Comptant'), interac: _t('Virement Interac'), credit: _t('Crédit boutique') };
    var payTxt = PAY[inv.pay_method] ? (credit > 0 && inv.pay_method !== 'credit' ? _t('Crédit boutique') + ' + ' : '') + PAY[inv.pay_method] : '';
    function block(lbl, rows) {
      rows = rows.filter(Boolean);
      return '<div class="ia-blk"><div class="ia-lbl">' + lbl + '</div>' +
        rows.map(function (r, i) { return '<div class="' + (i ? 'ia-soft' : 'ia-who') + '">' + esc(r) + '</div>'; }).join('') + '</div>';
    }
    var from = block(_t('De'), [co.name, co.address, co.city, co.email, co.phone,
      co.neq && 'NEQ ' + co.neq, co.gst && _t('TPS') + ' ' + co.gst, co.qst && _t('TVQ') + ' ' + co.qst]);
    var toRows = [inv.client_name, inv.client_address, inv.client_city, inv.client_contact].filter(Boolean);
    var to = (!docs.internal && toRows.length) ? block(isReceipt ? _t('Reçu de') : _t('Facturé à'), toRows) : '<div class="ia-blk"></div>';
    var L = window.CA.packRows(inv.lines || []);
    var hasImg = L.some(function (l) { return l.img; });   // une colonne photo dès qu'une ligne en a une
    var rows = L.map(function (l) {
      return '<tr>' + (hasImg ? '<td class="ia-th">' + (l.img ? '<span><img src="' + esc(l.img) + '" alt=""></span>' : '') + '</td>' : '') +
        '<td class="ia-desc"><div class="ia-name">' + esc(l.label || '') + '</div>' + (l.meta ? '<div class="ia-meta">' + esc(l.meta) + '</div>' : '') + '</td>' +
        '<td class="num">' + (+l.qty) + '</td><td class="num">' + money(l.unit_price) + '</td><td class="num ia-b">' + money(l.line_total) + '</td></tr>';
    }).join('');
    var sums = inv.tax_enabled
      ? [[_t('Sous-total'), inv.subtotal], [_t('TPS'), inv.tax_gst], [_t('TVQ'), inv.tax_qst]].map(function (r) {
          return '<div class="ia-line"><span>' + r[0] + '</span><span>' + money(r[1]) + '</span></div>';
        }).join('')
      : '';
    var left = (isReceipt
        ? '<div class="inv-paid"><b>' + _t('PAYÉ') + '</b><span>' +
            (credit > 0 ? money(credit) + _t(' en crédit boutique') + (rest > 0 ? ' + ' : '') : '') +
            (rest > 0 || !(credit > 0) ? money(rest) + (inv.pay_method === 'cash' ? _t(' reçu comptant') : _t(' reçu par virement')) : '') +
            _t(' le ') + esc(fmtDay(docs.paid_at)) + '</span></div>'
        : (payTxt ? '<div class="ia-note"><div class="ia-lbl">' + _t('Paiement') + '</div>' + esc(payTxt) + '</div>' : '')) +
      (inv.note ? '<div class="ia-note"><div class="ia-lbl">' + _t('Note') + '</div>' + esc(inv.note) + '</div>' : '') +
      (docs.extra || '');
    var foot = [co.name, co.email, co.phone].filter(Boolean).map(esc).join('&nbsp; · &nbsp;');
    return '<div class="ia">' +
      '<div class="ia-rule"></div>' +
      '<div class="ia-top">' +
        '<div class="ia-co">' + (co.logo ? '<img class="ia-logo" src="' + esc(co.logo) + '" alt="">' : '<div class="ia-co-name">' + esc(co.name) + '</div>') +
          (co.tagline ? '<div class="ia-tag">' + esc(co.tagline) + '</div>' : '') + '</div>' +
        '<div class="ia-title"><i></i><h1>' + esc(docs.title || (isReceipt ? _t('REÇU') : _t('FACTURE'))) + '</h1>' +
          '<div class="ia-no">' + (isReceipt ? _t('Facture N° ') : _t('N° ')) + esc(inv.number || '—') + '</div>' +
          '<div class="ia-date">' + (isReceipt ? _t('Payé le ') + esc(fmtDay(docs.paid_at)) : esc(fmtDay(inv.invoice_date))) + '</div></div>' +
      '</div>' +
      (inv.status === 'cancelled' ? '<div class="inv-cancelled">' + _t('FACTURE ANNULÉE') + '</div>' : '') +
      '<div class="ia-parties">' + from + to + '</div>' +
      '<table class="ia-table"><thead><tr>' + (hasImg ? '<th class="ia-th"></th>' : '') + '<th>' + _t('Description') + '</th><th class="num">' + _t('Qté') +
        '</th><th class="num">' + _t('Prix unitaire') + '</th><th class="num">' + _t('Total') + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="ia-bottom"><div class="ia-left">' + left + '</div>' +
        '<div class="ia-tot">' + sums +
          '<div class="ia-grand"><span>' + _t('Total') + '</span><b>' + money(inv.total) + '</b></div>' +
          (credit > 0
            ? '<div class="ia-line"><span>' + _t('Crédit boutique') + '</span><span>−' + money(credit) + '</span></div>' +
              '<div class="ia-line ia-due"><span>' + _t('À payer') + '</span><span>' + money(rest) + '</span></div>'
            : '') +
        '</div></div>' +
      (docs.internal ? '' : '<div class="ia-thanks">' + _t('Merci pour ta commande !') + '</div>') +
      (foot ? '<div class="ia-foot">' + foot + '</div>' : '') +
    '</div>';
  }

  /* Reçu de crédit boutique (registre dealer_credit) : { row, balance, dealer:{name,email,address,city}, company } */
  var REASON = { debt: _t('Règlement de dette'), gesture: _t('Geste commercial'), refund: _t('Remboursement'), correction: _t('Correction') };
  function buildCredit(o) {
    var r = o.row, d = o.dealer || {}, co = {}, c0 = o.company || {}, k;
    for (k in DEFAULT_CO) co[k] = (c0[k] != null && c0[k] !== '') ? c0[k] : DEFAULT_CO[k];
    var meta = [co.address, co.city, co.email, co.phone].filter(Boolean);
    var amt = +r.amount || 0;
    return '<div class="inv-top">' +
        '<div class="inv-co">' + (co.logo ? '<img class="inv-logo" src="' + esc(co.logo) + '" alt="">' : '') +
          '<div class="inv-co-name">' + esc(co.name) + '</div>' +
          (co.tagline ? '<div class="inv-co-tag">' + esc(co.tagline) + '</div>' : '') +
          (meta.length ? '<div class="inv-co-meta">' + esc(meta.join('\n')) + '</div>' : '') + '</div>' +
        '<div class="inv-title"><h1>' + _t('CRÉDIT BOUTIQUE') + '</h1><div class="inv-meta">' + _t('N° ') + esc(r.receipt_no || '—') + '<br>' + esc(fmtDay(r.created_at)) + '</div></div>' +
      '</div>' +
      '<div class="inv-billto"><div class="lbl">' + _t('Crédit au compte de') + '</div>' +
        (d.name ? '<div class="who">' + esc(d.name) + '</div>' : '') +
        (d.address ? '<div>' + esc(d.address) + '</div>' : '') + (d.city ? '<div>' + esc(d.city) + '</div>' : '') +
        (d.email ? '<div>' + esc(d.email) + '</div>' : '') + '</div>' +
      '<table class="inv-table"><thead><tr><th>' + _t('Description') + '</th><th class="num">' + _t('Montant') + '</th></tr></thead><tbody>' +
        '<tr><td>' + esc(REASON[r.reason] || '') + (r.note ? ' <span class="inv-mat">' + esc(r.note) + '</span>' : '') + '</td>' +
        '<td class="num">' + (amt < 0 ? '−' : '') + money(Math.abs(amt)) + '</td></tr></tbody></table>' +
      '<div class="inv-tot">' +
        '<div class="line grand"><span>' + _t('Solde de crédit') + '</span><span>' + money(o.balance) + '</span></div>' +
      '</div>' +
      '<div class="inv-pay"><span class="lbl">' + _t('Conditions') + '</span>' +
        _t('Utilisable sur tous les articles de la boutique, promotions comprises. N\'expire pas. Ni remboursable ni échangeable contre de l\'argent.') + '</div>' +
      '<div class="inv-foot">' + _t('Merci de votre confiance !') + '</div>';
  }

  var TITLE = document.title;
  function printHtml(html, name) {
    var box = document.getElementById('doc-print');
    if (!box) { box = document.createElement('div'); box.id = 'doc-print'; box.className = 'doc-print'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box); }
    box.innerHTML = html;
    // photos des articles : on attend qu'elles soient chargées (4 s max), sinon le PDF sort avec des cases vides
    var waits = Array.prototype.map.call(box.querySelectorAll('img'), function (im) {
      return im.complete ? null : new Promise(function (ok) { im.onload = im.onerror = ok; });
    }).filter(Boolean);
    var go = function () {
      // nom proposé par « Enregistrer en PDF »
      document.title = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || TITLE;
      document.body.classList.add('doc-printing');
      window.print();
      setTimeout(function () { document.body.classList.remove('doc-printing'); box.innerHTML = ''; document.title = TITLE; }, 400);
    };
    if (!waits.length) go();
    else Promise.race([Promise.all(waits), new Promise(function (ok) { setTimeout(ok, 4000); })]).then(go);
    return true;
  }
  // packs de filament (2026-11-16) : les lignes d'un même pack (pack.k) → une ligne « nom du pack », détail « code · 2 × Black, 2 × Jade White »
  // (même règle que packGroup dans supabase/functions/_shared/mail.ts : PDF et courriels)
  window.CA.packRows = function (lines) {
    var out = [], at = {};
    (lines || []).forEach(function (l) {
      var pk = l && l.pack;
      if (!pk || !pk.k) { out.push(l); return; }
      var n = Math.max(1, +pk.n || 1), col = Math.round((+l.qty || 0) / n) + ' × ' + (l.label || l.name || '');
      var g = at[pk.k];
      if (!g) {
        g = at[pk.k] = { pack: pk, label: ((window.CA.lang === 'en' && pk.name_en) || pk.name || 'Pack') + (pk.kind === 'spool' ? (window.CA.lang === 'en' ? ' · With spool' : ' · Avec bobine') : ''), qty: n, unit_price: +pk.price || 0,
          line_total: 0, qty_pending: 0, cols: [], img: pk.img || l.img || null };
        out.push(g);
      }
      g.line_total = Math.round((g.line_total + (+l.line_total || 0)) * 100) / 100;
      g.qty_pending += +l.qty_pending || 0;
      g.cols.push(col);
      g.meta = [pk.code, g.cols.join(', ')].filter(Boolean).join(' · ');
    });
    return out;
  };
  window.CA.docPrint = function (kind, docs) {
    if (!docs || !docs.invoice) return false;
    return printHtml(build(kind, docs), (kind === 'receipt' ? _t('Reçu') + ' ' : '') + String(docs.invoice.number || ''));
  };
  window.CA.docHtml = build;   // aperçu / tests : même HTML que l'impression
  window.CA.creditPrint = function (o) {
    if (!o || !o.row) return false;
    return printHtml(buildCredit(o), _t('Crédit') + ' ' + (o.row.receipt_no || ''));
  };
})();
