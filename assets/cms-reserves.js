/* =========================================================
   Création Audio V2 — Réservés (articles promis à un client, pas encore sortis du stock)
   - facture « À venir » (commande remise en deux fois : invoice_lines.qty_pending > 0) ;
   - réservation 72 h active (le stock est gardé, pas déduit) ;
   - commande en ligne ouverte (Nouvelle / En préparation / Prête).
   Ce module les rend visibles là où on achète et où on reçoit :
   - CA.reserved.count(pid, kind) -> « Manque » + pastille dans
     Inventaire › À commander (cms-inventory.js) ;
   - alerte au poste de scan (Inventaire › Réception) quand un article
     scanné / reçu est réservé pour un client (#res-alert).
   La remise elle-même se fait dans l'Historique (RPC deliver_invoice).
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

  /* ---------- données ----------
     Trois sources d'articles PROMIS à un client (pas encore sortis du stock) :
       - facture « À venir »       : invoice_lines.qty_pending (facture non annulée)
       - réservation 72 h active   : customer_reservation_lines (le stock est gardé, pas déduit)
       - commande en ligne ouverte : customer_order_lines (Nouvelle / En préparation / Prête)
     Une réservation ou commande facturée sort d'ici (sa facture prend le relais si « À venir »). */
  var loaded = false, loading = null;
  var rows = [];        // { line: {product_id, kind, label, meta, qty}, src: {type, id, number, client} }
  var alerted = [];     // { pid, kind } signalés au poste de scan (ordre d'arrivée)
  var SRC = {
    invoice: { open: '#historique', btn: 'Voir la facture', what: 'à remettre' },
    resv:    { open: '#commandes/reservations', btn: 'Voir la réservation', what: 'réservé' },
    order:   { open: '#commandes/clients', btn: 'Voir la commande', what: 'en commande' }
  };

  function pendingInvoices() {
    return sb.from('invoice_lines').select('id,invoice_id,product_id,kind,label,meta,qty,qty_pending')
      .gt('qty_pending', 0).then(function (res) {
        if (res.error) throw res.error;
        var lines = (res.data || []).filter(function (l) { return l.product_id; });
        var ids = lines.map(function (l) { return l.invoice_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        if (!ids.length) return [];
        return sb.from('invoices').select('id,number,client_name,invoice_date,status').in('id', ids).then(function (r2) {
          if (r2.error) throw r2.error;
          var byId = {}; (r2.data || []).forEach(function (inv) { byId[inv.id] = inv; });
          return lines.filter(function (l) { var inv = byId[l.invoice_id]; return inv && inv.status !== 'cancelled'; })
            .map(function (l) {
              var inv = byId[l.invoice_id];
              return { line: { product_id: l.product_id, kind: l.kind, label: l.label, meta: l.meta, qty: +l.qty_pending || 0 },
                src: { type: 'invoice', id: inv.id, number: inv.number || '', client: inv.client_name || 'Sans nom' } };
            });
        });
      }).then(null, function () { return []; });   // colonne absente / réseau : rien
  }
  // réservations actives (pas échues) et commandes en ligne ouvertes : toutes leurs lignes
  function openCustomer(query, linesKey, type) {
    return query.then(function (res) {
      if (res.error) throw res.error;
      var out = [];
      (res.data || []).forEach(function (o) {
        if (type === 'resv' && !(Date.parse(o.expires_at) > Date.now())) return;   // échue : le tick va l'expirer
        (o[linesKey] || []).forEach(function (l) {
          if (!l.product_id || !(l.qty > 0)) return;
          out.push({ line: { product_id: l.product_id, kind: l.kind, label: l.name, meta: l.meta, qty: l.qty | 0 },
            src: { type: type, id: o.id, number: o.number || '', client: o.name || o.email || 'Sans nom' } });
        });
      });
      return out;
    }).then(null, function () { return []; });
  }

  function load() {
    loading = Promise.all([
      pendingInvoices(),
      openCustomer(sb.from('customer_reservations')
        .select('id,number,name,email,status,expires_at,customer_reservation_lines(product_id,kind,name,meta,qty)')
        .eq('status', 'active'), 'customer_reservation_lines', 'resv'),
      openCustomer(sb.from('customer_orders')
        .select('id,number,name,email,status,customer_order_lines(product_id,kind,name,meta,qty)')
        .in('status', ['new', 'preparing', 'ready']), 'customer_order_lines', 'order')
    ]).then(function (r) {
      rows = r[0].concat(r[1], r[2]);
      loaded = true;
      renderAlert();
      try { document.dispatchEvent(new CustomEvent('ca:reserved')); } catch (e) {}
    });
    return loading;
  }
  function ensure() { return loaded ? Promise.resolve() : (loading || load()); }

  // format scanné (bobine / recharge) : seulement ce format ; accessoire / spacer : le produit
  function matchFor(pid, kind) {
    return rows.filter(function (x) {
      if (String(x.line.product_id) !== String(pid)) return false;
      if (kind === 'spool' || kind === 'refill') return (x.line.kind === 'refill' ? 'refill' : 'spool') === kind;
      return true;
    });
  }
  function count(pid, kind) {
    return matchFor(pid, kind).reduce(function (s, x) { return s + (x.line.qty || 0); }, 0);
  }
  function openSrc(type, id) {
    if (type === 'invoice' && window.CA.focusInvoice) window.CA.focusInvoice(id);
    location.hash = (SRC[type] || SRC.invoice).open;
  }

  /* ---------- alerte au poste de scan ---------- */
  function renderAlert() {
    var el = $('#res-alert'); if (!el) return;
    var groups = alerted.map(function (a) { return matchFor(a.pid, a.kind); }).filter(function (g) { return g.length; });
    if (!groups.length) { el.hidden = true; el.innerHTML = ''; return; }
    var clients = {};
    groups.forEach(function (g) { g.forEach(function (x) { clients[x.src.type + x.src.id] = 1; }); });
    var nc = Object.keys(clients).length;
    el.innerHTML =
      '<div class="wl-alert-head"><span class="wl-alert-ic" aria-hidden="true">📦</span>' +
        '<strong>Réservé pour ' + (nc > 1 ? nc + ' clients' : 'un client') + '</strong>' +
        '<span class="grow"></span>' +
        '<button type="button" class="wl-alert-close" aria-label="Masquer l\'alerte">✕</button></div>' +
      groups.map(function (g) {
        var l0 = g[0].line;
        return '<div class="wl-group">' +
          '<div class="wl-group-head"><span class="wl-group-name">' + esc(l0.label || '(article)') + '</span>' +
            (l0.meta ? '<span class="res-meta">' + esc(l0.meta) + '</span>' : '') + '</div>' +
          g.map(function (x) {
            var s = SRC[x.src.type] || SRC.invoice;
            return '<div class="wl-req">' +
              '<div class="wl-req-main"><span class="wl-req-who">' + esc(x.src.client) + '</span>' +
                '<span class="wl-req-meta">' + esc(x.src.number) + ' · ' + x.line.qty + ' ' + s.what + (x.src.type === 'resv' && x.line.qty > 1 ? 's' : '') + '</span></div>' +
              '<div class="wl-req-act"><button type="button" class="btn btn-ghost btn-sm res-open" data-type="' + esc(x.src.type) + '" data-id="' + esc(x.src.id) + '">' + s.btn + '</button></div>' +
            '</div>';
          }).join('') +
        '</div>';
      }).join('');
    el.hidden = false;
    $('.wl-alert-close', el).addEventListener('click', function () { alerted = []; renderAlert(); });
    $$('.res-open', el).forEach(function (b) {
      b.addEventListener('click', function () { openSrc(b.getAttribute('data-type'), b.getAttribute('data-id')); });
    });
  }
  function flag(pid, kind) {
    if (!pid) return;
    alerted = alerted.filter(function (a) { return !(String(a.pid) === String(pid) && a.kind === kind); });
    alerted.unshift({ pid: pid, kind: kind });
  }

  /* ---------- chargement : à chaque ouverture de l'Inventaire ---------- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'inventaire') load();
  };

  /* ---------- API (cms-inventory.js, cms-facturation.js, cms-historique.js) ---------- */
  window.CA.reserved = {
    // un article vient d'être scanné -> alerte s'il est réservé
    onScan: function (pid, kind) { ensure().then(function () { flag(pid, kind); renderAlert(); }); },
    // réception confirmée -> alerte pour tous les articles reçus réservés
    onReceived: function (lines) {
      ensure().then(function () {
        (lines || []).forEach(function (l) { flag(l.productId || l.product_id, l.kind); });
        renderAlert();
      });
    },
    count: count,
    // clients qui attendent ce produit (infobulle de la pastille « réservés »)
    who: function (pid, kind) {
      return matchFor(pid, kind).map(function (x) { return x.src.client + ' (' + x.src.number + ')'; });
    },
    // détail par facture / réservation / commande (Liste à commander) : [{ type, id, number, client, qty }]
    detail: function (pid, kind) {
      var by = {}, out = [];
      matchFor(pid, kind).forEach(function (x) {
        var k = x.src.type + '|' + x.src.id, d = by[k];
        if (!d) { d = by[k] = { type: x.src.type, id: x.src.id, number: x.src.number, client: x.src.client, qty: 0 }; out.push(d); }
        d.qty += x.line.qty || 0;
      });
      return out;
    },
    // ouvre la facture (Historique), la réservation ou la commande (Commandes)
    open: function (type, id) { openSrc(type, id); },
    reload: load
  };
})();
