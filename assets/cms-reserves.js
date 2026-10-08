/* =========================================================
   Création Audio V2 — Réservés (articles facturés « À venir »)
   Une commande remise en deux fois : la facture est faite au complet,
   les lignes pas encore remises gardent invoice_lines.qty_pending > 0
   (factures non annulées). Ce module les rend visibles là où on achète
   et où on reçoit :
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

  /* ---------- données ---------- */
  var loaded = false, loading = null;
  var rows = [];        // { line, inv } — lignes de produit encore à remettre
  var alerted = [];     // { pid, kind } signalés au poste de scan (ordre d'arrivée)

  function load() {
    loading = sb.from('invoice_lines').select('id,invoice_id,product_id,kind,label,meta,qty,qty_pending')
      .gt('qty_pending', 0).then(function (res) {
        if (res.error) throw res.error;
        var lines = (res.data || []).filter(function (l) { return l.product_id; });
        var ids = lines.map(function (l) { return l.invoice_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        if (!ids.length) return [lines, []];
        return sb.from('invoices').select('id,number,client_name,invoice_date,status').in('id', ids).then(function (r2) {
          if (r2.error) throw r2.error;
          return [lines, r2.data || []];
        });
      }).then(function (r) {
        var byId = {}; r[1].forEach(function (inv) { byId[inv.id] = inv; });
        rows = r[0].map(function (l) { return { line: l, inv: byId[l.invoice_id] }; })
          .filter(function (x) { return x.inv && x.inv.status !== 'cancelled'; });
        loaded = true;
        renderAlert();
        try { document.dispatchEvent(new CustomEvent('ca:reserved')); } catch (e) {}
      }, function () { loaded = true; rows = []; });   // colonne absente / réseau : rien de réservé
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
    return matchFor(pid, kind).reduce(function (s, x) { return s + ((+x.line.qty_pending) || 0); }, 0);
  }

  /* ---------- alerte au poste de scan ---------- */
  function renderAlert() {
    var el = $('#res-alert'); if (!el) return;
    var groups = alerted.map(function (a) { return matchFor(a.pid, a.kind); }).filter(function (g) { return g.length; });
    if (!groups.length) { el.hidden = true; el.innerHTML = ''; return; }
    var clients = {};
    groups.forEach(function (g) { g.forEach(function (x) { clients[x.inv.id] = 1; }); });
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
            var n = +x.line.qty_pending || 0;
            return '<div class="wl-req">' +
              '<div class="wl-req-main"><span class="wl-req-who">' + esc(x.inv.client_name || 'Sans nom') + '</span>' +
                '<span class="wl-req-meta">' + esc(x.inv.number || '') + ' · ' + n + ' à remettre</span></div>' +
              '<div class="wl-req-act"><button type="button" class="btn btn-ghost btn-sm res-open" data-inv="' + esc(x.inv.id) + '">Voir la facture</button></div>' +
            '</div>';
          }).join('') +
        '</div>';
      }).join('');
    el.hidden = false;
    $('.wl-alert-close', el).addEventListener('click', function () { alerted = []; renderAlert(); });
    $$('.res-open', el).forEach(function (b) {
      b.addEventListener('click', function () {
        if (window.CA.focusInvoice) window.CA.focusInvoice(b.getAttribute('data-inv'));
        location.hash = '#historique';
      });
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
      return matchFor(pid, kind).map(function (x) { return (x.inv.client_name || 'Sans nom') + ' (' + (x.inv.number || '') + ')'; });
    },
    // détail par facture (Liste à commander) : [{ invoiceId, number, client, qty }]
    detail: function (pid, kind) {
      var by = {}, out = [];
      matchFor(pid, kind).forEach(function (x) {
        var d = by[x.inv.id];
        if (!d) { d = by[x.inv.id] = { invoiceId: x.inv.id, number: x.inv.number || '', client: x.inv.client_name || 'Sans nom', qty: 0 }; out.push(d); }
        d.qty += (+x.line.qty_pending) || 0;
      });
      return out;
    },
    reload: load
  };
})();
