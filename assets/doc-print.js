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

  function build(kind, docs) {
    var inv = docs.invoice, co = {}, c0 = docs.company || {}, k;
    for (k in DEFAULT_CO) co[k] = (c0[k] != null && c0[k] !== '') ? c0[k] : DEFAULT_CO[k];
    var isReceipt = kind === 'receipt';
    // crédit boutique dealer (invoices.credit_used) : déduit du total, le reste est payé comptant/Interac
    var credit = Math.round((+inv.credit_used || 0) * 100) / 100;
    var rest = Math.max(0, Math.round(((+inv.total || 0) - credit) * 100) / 100);
    var PAY = { cash: _t('Comptant'), interac: _t('Virement Interac'), credit: _t('Crédit boutique') };
    var meta = [co.address, co.city, co.email, co.phone].filter(Boolean);
    var billto = (inv.client_name || inv.client_contact || inv.client_address || inv.client_city)
      ? '<div class="inv-billto"><div class="lbl">' + (isReceipt ? _t('Reçu de') : _t('Facturé à')) + '</div>' +
        (inv.client_name ? '<div class="who">' + esc(inv.client_name) + '</div>' : '') +
        (inv.client_address ? '<div>' + esc(inv.client_address) + '</div>' : '') +
        (inv.client_city ? '<div>' + esc(inv.client_city) + '</div>' : '') +
        (inv.client_contact ? '<div>' + esc(inv.client_contact) + '</div>' : '') + '</div>'
      : '';
    var rows = (inv.lines || []).map(function (l) {
      return '<tr><td>' + esc(l.label || '') + (l.meta ? ' <span class="inv-mat">' + esc(l.meta) + '</span>' : '') + '</td>' +
        '<td class="num">' + (+l.qty) + '</td><td class="num">' + money(l.unit_price) + '</td><td class="num">' + money(l.line_total) + '</td></tr>';
    }).join('');
    var taxLines = inv.tax_enabled
      ? '<div class="line"><span>' + _t('TPS') + (co.gst ? ' <span class="taxno">' + esc(co.gst) + '</span>' : '') + '</span><span>' + money(inv.tax_gst) + '</span></div>' +
        '<div class="line"><span>' + _t('TVQ') + (co.qst ? ' <span class="taxno">' + esc(co.qst) + '</span>' : '') + '</span><span>' + money(inv.tax_qst) + '</span></div>'
      : '';
    var head = '<div class="inv-title"><h1>' + (isReceipt ? _t('REÇU') : _t('FACTURE')) + '</h1><div class="inv-meta">' +
      (isReceipt
        ? _t('Facture N° ') + esc(inv.number || '—') + '<br>' + _t('Payé le ') + esc(fmtDay(docs.paid_at))
        : _t('N° ') + esc(inv.number || '—') + '<br>' + esc(fmtDay(inv.invoice_date))) +
      '</div></div>';
    return '<div class="inv-top">' +
        '<div class="inv-co">' + (co.logo ? '<img class="inv-logo" src="' + esc(co.logo) + '" alt="">' : '') +
          '<div class="inv-co-name">' + esc(co.name) + '</div>' +
          (co.tagline ? '<div class="inv-co-tag">' + esc(co.tagline) + '</div>' : '') +
          (meta.length ? '<div class="inv-co-meta">' + esc(meta.join('\n')) + '</div>' : '') + '</div>' +
        head +
      '</div>' + (inv.status === 'cancelled' ? '<div class="inv-cancelled">' + _t('FACTURE ANNULÉE') + '</div>' : '') + billto +
      '<table class="inv-table"><thead><tr><th>' + _t('Description') + '</th><th class="num">' + _t('Qté') + '</th><th class="num">' +
        _t('Prix unit.') + '</th><th class="num">' + _t('Montant') + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="inv-tot">' +
        '<div class="line"><span>' + _t('Sous-total') + '</span><span>' + money(inv.subtotal) + '</span></div>' + taxLines +
        '<div class="line grand"><span>' + _t('Total') + '</span><span>' + money(inv.total) + '</span></div>' +
        (credit > 0
          ? '<div class="line"><span>' + _t('Crédit boutique') + '</span><span>−' + money(credit) + '</span></div>' +
            '<div class="line grand"><span>' + _t('À payer') + '</span><span>' + money(rest) + '</span></div>'
          : '') +
      '</div>' +
      (isReceipt
        ? '<div class="inv-paid"><b>' + _t('PAYÉ') + '</b><span>' +
            (credit > 0 ? money(credit) + _t(' en crédit boutique') + (rest > 0 ? ' + ' : '') : '') +
            (rest > 0 || !(credit > 0) ? money(rest) + (inv.pay_method === 'cash' ? _t(' reçu comptant') : _t(' reçu par virement')) : '') +
            _t(' le ') + esc(fmtDay(docs.paid_at)) + '</span></div>'
        : (PAY[inv.pay_method]
            ? '<div class="inv-pay"><span class="lbl">' + _t('Paiement') + '</span>' +
                (credit > 0 && inv.pay_method !== 'credit' ? _t('Crédit boutique') + ' + ' : '') + PAY[inv.pay_method] + '</div>' : '') +
          (inv.note ? '<div class="inv-pay"><span class="lbl">' + _t('Note') + '</span>' + esc(inv.note) + '</div>' : '')) +
      '<div class="inv-foot">' + _t('Merci de votre confiance !') + '</div>';
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
    // nom proposé par « Enregistrer en PDF »
    document.title = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || TITLE;
    document.body.classList.add('doc-printing');
    window.print();
    setTimeout(function () { document.body.classList.remove('doc-printing'); box.innerHTML = ''; document.title = TITLE; }, 400);
    return true;
  }
  window.CA.docPrint = function (kind, docs) {
    if (!docs || !docs.invoice) return false;
    return printHtml(build(kind, docs), (kind === 'receipt' ? _t('Reçu') + ' ' : '') + String(docs.invoice.number || ''));
  };
  window.CA.creditPrint = function (o) {
    if (!o || !o.row) return false;
    return printHtml(buildCredit(o), _t('Crédit') + ' ' + (o.row.receipt_no || ''));
  };
})();
