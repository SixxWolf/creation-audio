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

  /* ---------- factures « À venir » : où en est chacune (articles reçus, client prévenu, cueillette) ---------- */
  var invState = {};   // id de facture -> { n_tot, n_in, has_account, ready_at, pickup_* } (RPC admin_pending_invoices)
  function loadInvState() {
    return sb.rpc('admin_pending_invoices').then(function (res) {
      invState = {};
      if (!res.error) (res.data || []).forEach(function (r) { invState[r.id] = r; });
    }, function () { invState = {}; });
  }
  // « Prévenir » : marque la facture arrivée (RPC) puis envoie le courriel (EF pickup-request-notify, event 'ready')
  function notifyInvoice(id, btn, done) {
    if (btn) btn.disabled = true;
    sb.rpc('admin_invoice_ready', { p_id: id }).then(function (res) {
      if (res.error) throw res.error;
      return sb.functions.invoke('pickup-request-notify', { body: { kind: 'invoice', id: id, event: 'ready' } }).then(function (r) {
        var d = (r && r.data) || {};
        if ((r && r.error) || d.error || d.result === 'skipped' || (d.client && d.client !== 'sent')) caDialog.toast('Marquée, mais courriel non envoyé.', 'bad');
        else caDialog.toast('Client prévenu.');
      }, function () { caDialog.toast('Marquée, mais courriel non envoyé.', 'bad'); });
    }).then(function () { return load(); }).then(function () { if (done) done(); }, function (err) {
      if (btn) btn.disabled = false;
      caDialog.error(err);
    });
  }

  function load() {
    loading = Promise.all([
      loadInvState(),
      pendingInvoices(),
      openCustomer(sb.from('customer_reservations')
        .select('id,number,name,email,status,expires_at,customer_reservation_lines(product_id,kind,name,meta,qty)')
        .eq('status', 'active'), 'customer_reservation_lines', 'resv'),
      openCustomer(sb.from('customer_orders')
        .select('id,number,name,email,status,customer_order_lines(product_id,kind,name,meta,qty)')
        .in('status', ['new', 'preparing', 'ready']), 'customer_order_lines', 'order')
    ]).then(function (r) {
      rows = r[1].concat(r[2], r[3]);
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
    // pas d'alerte si le stock déjà en main (avant cette réception) couvre ce que les clients attendent
    var groups = alerted.filter(function (a) { return a.before == null || a.before < count(a.pid, a.kind); })
      .map(function (a) { return matchFor(a.pid, a.kind); }).filter(function (g) { return g.length; });
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
      }).join('') + notifyHtml(groups);
    el.hidden = false;
    $$('.res-ready', el).forEach(function (b) {
      b.addEventListener('click', function () { notifyInvoice(b.getAttribute('data-id'), b); });
    });
    $('.wl-alert-close', el).addEventListener('click', function () { alerted = []; renderAlert(); });
    $$('.res-open', el).forEach(function (b) {
      b.addEventListener('click', function () { openSrc(b.getAttribute('data-type'), b.getAttribute('data-id')); });
    });
  }
  // une ligne par facture « À venir » touchée : « 1 de 2 reçus » (bouton grisé) puis « Prévenir David » quand tout est là
  function notifyHtml(groups) {
    var seen = {}, out = '';
    groups.forEach(function (g) {
      g.forEach(function (x) {
        var id = x.src.type === 'invoice' ? x.src.id : null, st = id && invState[id];
        if (!st || seen[id]) return;
        seen[id] = 1;
        var all = st.n_in >= st.n_tot, first = String(st.client_name || '').trim().split(/\s+/)[0] || 'le client';
        var act = st.ready_at ? '<span class="res-ready-st">Prévenu</span>'
          : !st.has_account ? '<span class="res-ready-st">Pas de compte lié</span>'
          : '<button type="button" class="btn btn-accent btn-sm res-ready" data-id="' + esc(id) + '" data-ic="mail"' + (all ? '' : ' disabled') + '>Prévenir ' + esc(first) + '</button>';
        out += '<div class="wl-req res-notify"><div class="wl-req-main"><span class="wl-req-who">' + esc(st.client_name || 'Sans nom') + '</span>' +
          '<span class="wl-req-meta">' + esc(st.number) + ' · ' + st.n_in + ' de ' + st.n_tot + ' reçu' + (st.n_tot > 1 ? 's' : '') + '</span></div>' +
          '<div class="wl-req-act">' + act + '</div></div>';
      });
    });
    return out;
  }
  // stock en main d'un produit (bobine / recharge / unité), lu frais dans la base
  function stockNow(pid, kind) {
    return sb.from('products').select('qty,qty_2').eq('id', pid).then(function (res) {
      var p = res.data && res.data[0];
      if (res.error || !p) return null;
      return (kind === 'refill' ? p.qty_2 : p.qty) | 0;
    }, function () { return null; });
  }
  // recvQty : quantité qui vient d'entrer (0 au scan : le stock n'est pas encore touché)
  function flag(pid, kind, recvQty) {
    if (!pid || !matchFor(pid, kind).length) return Promise.resolve();
    return stockNow(pid, kind).then(function (n) {
      var before = n == null ? null : Math.max(0, n - (recvQty | 0));
      alerted = alerted.filter(function (a) { return !(String(a.pid) === String(pid) && a.kind === kind); });
      alerted.unshift({ pid: pid, kind: kind, before: before });
    });
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
    onScan: function (pid, kind) { ensure().then(function () { return flag(pid, kind, 0); }).then(renderAlert); },
    // réception confirmée -> alerte pour tous les articles reçus réservés
    onReceived: function (lines) {
      ensure().then(function () {
        var tot = {};   // quantité reçue par produit + format
        (lines || []).forEach(function (l) { var k = (l.productId || l.product_id) + '|' + l.kind; tot[k] = (tot[k] || 0) + (l.qty | 0); });
        return Promise.all(Object.keys(tot).map(function (k) {
          var i = k.lastIndexOf('|'); return flag(k.slice(0, i), k.slice(i + 1), tot[k]);
        }));
      }).then(renderAlert);
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
    // « Prévenir » un client dont la facture est arrivée (aussi Historique) ; done : appelé après le rechargement
    notifyInvoice: notifyInvoice,
    // état d'une facture « À venir » : { n_tot, n_in, has_account, ready_at, pickup_date, pickup_start, pickup_confirmed } ou null
    invoiceState: function (id) { return ensure().then(function () { return invState[id] || null; }); },
    reload: load
  };
})();
