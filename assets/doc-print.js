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
      '</div>' +
      (isReceipt
        ? '<div class="inv-paid"><b>' + _t('PAYÉ') + '</b><span>' + money(inv.total) + _t(' reçu par virement le ') + esc(fmtDay(docs.paid_at)) + '</span></div>'
        : (inv.note ? '<div class="inv-pay"><span class="lbl">' + _t('Note') + '</span>' + esc(inv.note) + '</div>' : '')) +
      '<div class="inv-foot">' + _t('Merci de votre confiance !') + '</div>';
  }

  var TITLE = document.title;
  window.CA.docPrint = function (kind, docs) {
    if (!docs || !docs.invoice) return false;
    var box = document.getElementById('doc-print');
    if (!box) { box = document.createElement('div'); box.id = 'doc-print'; box.className = 'doc-print'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box); }
    box.innerHTML = build(kind, docs);
    // nom proposé par « Enregistrer en PDF »
    var nm = (kind === 'receipt' ? _t('Reçu') + ' ' : '') + String(docs.invoice.number || '').trim();
    document.title = nm.replace(/[\\/:*?"<>|]+/g, '-') || TITLE;
    document.body.classList.add('doc-printing');
    window.print();
    setTimeout(function () { document.body.classList.remove('doc-printing'); box.innerHTML = ''; document.title = TITLE; }, 400);
    return true;
  };
})();
