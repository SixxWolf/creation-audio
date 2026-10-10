/* =========================================================
   Création Audio — CMS Commandes › Réservations (comptes clients, étape 3)
   Réservations 72 h faites par les clients approuvés (case « Peut réserver »
   dans Clients) depuis le panier de la boutique : tables customer_reservations
   + customer_reservation_lines. Le stock gardé sort de la boutique publique
   (products_public) tant que la réservation est active.
   - Sous-onglet #commandes/reservations (cms-commandes-clients.js gère les
     sous-onglets et appelle CA.loadReservations à l'ouverture).
   - Pastille = réservations actives (CA.ordersCount.resv, pastille commune).
   - Active : « Facturer » (CA.invoiceFromOrder kind 'reservation' ; à
     l'enregistrement, RPC admin_invoice_reservation), « Annuler » (sans
     pénalité ; le client est avisé par courriel au prochain tick).
   - Expirée : « Facturer » (pénalité retirée) ou « Retirer la pénalité ».
   - CA.held(pid, kind) -> { qty, who[] } : stock gardé (alerte en Facturation).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;
  var CA = window.CA;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return String(iso || '').slice(0, 16); }
  }
  // « 1 j 4 h » / « 3 h 20 min »
  function left(iso) {
    var s = (Date.parse(iso) - Date.now()) / 1000;
    if (!isFinite(s) || s <= 0) return '';
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? d + ' j ' + h + ' h' : h ? h + ' h ' + m + ' min' : m + ' min';
  }
  // active mais échue (le tick passe aux 10 min) = déjà expirée pour l'affichage
  function stOf(r) { return r.status === 'active' && Date.parse(r.expires_at) <= Date.now() ? 'expired' : r.status; }
  function penalized(r) { return r.penalized || (r.status === 'active' && stOf(r) === 'expired'); }
  var STATUS = { active: 'Gardée', invoiced: 'Facturée', cancelled: 'Annulée', expired: 'Expirée' };

  var wrap = $('#cr-wrap'), listEl = $('#cr-list');
  if (!wrap || !listEl) return;
  var resv = [], stock = {}, filter = 'open', loaded = false, pending = null;

  function setBadge(n) {
    CA.ordersCount = CA.ordersCount || {};
    CA.ordersCount.resv = n;
    if (CA.paintOrdersBadge) CA.paintOrdersBadge();
  }
  function refreshBadge() {
    sb.from('customer_reservations').select('id,number,name,email,expires_at,customer_reservation_lines(product_id,kind,qty)')
      .eq('status', 'active').then(function (res) {
        if (!res || res.error) return;
        var act = (res.data || []).filter(function (r) { return Date.parse(r.expires_at) > Date.now(); });
        setBadge(act.length);
        setHeld(act);
      }, function () {});
  }
  if (CA.onAdminReady) CA.onAdminReady(refreshBadge);
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (!wrap.hidden) load(); else refreshBadge();
  }, 60000);

  $$('.cr-filter').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      $$('.cr-filter').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      render();
    });
  });
  CA.loadReservations = function () { return load(); };
  CA.reloadReservations = function () { if (loaded) load(); else refreshBadge(); };

  /* ---- stock gardé, par produit + format (Facturation : alerte au comptoir) ---- */
  var held = {};
  function heldKey(pid, kind) { return pid + '|' + (kind === 'refill' ? 'refill' : 'main'); }
  function setHeld(active) {
    held = {};
    active.forEach(function (r) {
      (r.customer_reservation_lines || []).forEach(function (l) {
        if (!l.product_id) return;
        var k = heldKey(l.product_id, l.kind), h = held[k] || (held[k] = { qty: 0, who: [] });
        h.qty += l.qty | 0;
        var tag = (r.number || '') + ' · ' + (r.name || r.email || '');
        if (h.who.indexOf(tag) < 0) h.who.push(tag);
      });
    });
  }
  CA.held = function (pid, kind) { return held[heldKey(pid, kind)] || null; };

  /* ---- chargement ---- */
  function load() {
    if (pending) return pending;
    if (!loaded) listEl.innerHTML = '<p class="muted">Chargement…</p>';
    pending = sb.from('customer_reservations').select('*, customer_reservation_lines(*)')
      .order('created_at', { ascending: false }).limit(200)
      .then(function (ro) {
        if (ro.error) {
          listEl.innerHTML = '<p class="empty">Impossible de charger les réservations.<br>' + esc(ro.error.message) + '</p>';
          return;
        }
        resv = ro.data || [];
        var ids = {};
        resv.forEach(function (r) { linesOf(r).forEach(function (l) { if (l.product_id) ids[l.product_id] = 1; }); });
        var list = Object.keys(ids);
        return (list.length ? sb.from('products').select('id,qty,qty_2,hex').in('id', list) : Promise.resolve({ data: [] }))
          .then(function (rp) {
            stock = {};
            ((rp && rp.data) || []).forEach(function (p) { stock[p.id] = p; });
            loaded = true;
            var act = resv.filter(function (r) { return stOf(r) === 'active'; });
            setHeld(act);
            setBadge(act.length);
            render();
          });
      }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; })
      .then(function () { pending = null; }, function () { pending = null; });
    return pending;
  }
  function linesOf(r) {
    return (r.customer_reservation_lines || []).slice().sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  }
  function stockFor(l) {
    var p = l.product_id ? stock[l.product_id] : null;
    if (!p) return null;
    return l.kind === 'refill' ? (p.qty_2 | 0) : p.qty;
  }

  /* ---- liste ---- */
  function actionsFor(r) {
    var b = function (act, label, cls) {
      return '<button type="button" class="btn ' + (cls || 'btn-ghost') + ' btn-sm" data-act="' + act + '"' +
        (act === 'invoice' ? ' data-ic="receipt"' : act === 'delete' ? ' data-ic="trash"' : '') + '>' + label + '</button>';
    };
    switch (stOf(r)) {
      case 'active': return b('invoice', 'Facturer', 'btn-accent') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'expired': return b('invoice', 'Facturer') + (penalized(r) ? b('forgive', 'Retirer la pénalité') : '');
      case 'invoiced': return r.invoice_id ? b('see-invoice', 'Voir la facture') : '';
      case 'cancelled': return b('delete', 'Supprimer', 'btn-ghost co-danger');
    }
    return '';
  }
  function render() {
    var open = resv.filter(function (r) { return stOf(r) === 'active'; });
    var list = filter === 'open' ? open : resv;
    if (!list.length) {
      listEl.innerHTML = '<p class="empty">' + (filter === 'open'
        ? 'Aucune réservation en cours.' + (resv.length ? '<br>Les réservations fermées sont sous « Toutes ».' : '<br>Les clients approuvés (« Peut réserver » dans Clients) réservent depuis le panier de la boutique.')
        : 'Aucune réservation pour l\'instant.') + '</p>';
      return;
    }
    listEl.innerHTML = list.map(function (r) {
      var st = stOf(r), lines = linesOf(r), items = 0;
      var rows = lines.map(function (l) {
        var s = stockFor(l);
        items += l.qty | 0;
        var hex = l.product_id && stock[l.product_id] && stock[l.product_id].hex;
        return '<tr>' +
          '<td class="l"><span class="co-prod">' + (hex ? '<span class="cc-sw" style="background:' + esc(hex) + '"></span>' : '<span class="co-noimg"></span>') +
            '<span><b>' + esc(l.name) + '</b>' + (l.meta ? '<small class="cc-meta">' + esc(l.meta) + '</small>' : '') + '</span></span></td>' +
          '<td class="n"><b>' + (l.qty | 0) + '</b></td>' +
          '<td class="n">' + (s == null ? '—' : s) + '</td>' +
          '<td class="n">' + money(l.unit_price) + '</td>' +
          '<td class="n"><b>' + money(l.line_total) + '</b></td>' +
        '</tr>';
      }).join('');
      var who = r.name || r.email;
      var tag = st === 'active' ? '<span class="co-edited">expire dans ' + esc(left(r.expires_at)) + '</span>'
        : st === 'expired' ? '<span class="co-edited">' + (penalized(r) ? 'non récupérée' : 'pénalité retirée') + '</span>'
        : st === 'cancelled' ? '<span class="co-edited">' + (r.cancelled_by === 'client' ? 'par le client' : 'par toi') + '</span>' : '';
      // styles des commandes (admin.css) : gardée = « prête » (vert), expirée = annulée (rouge, carte atténuée)
      var look = { active: 'ready', expired: 'cancelled' }[st] || st;
      return '<article class="co-card is-' + esc(look) + '" data-id="' + esc(r.id) + '">' +
        '<header class="co-head">' +
          '<div class="co-id"><b>' + esc(r.number) + '</b><span class="co-status is-' + esc(look) + '">' + esc(STATUS[st] || st) + '</span>' + tag + '</div>' +
          '<div class="co-who">' + (CA.avatar ? CA.avatar(who) : '') +
            '<span><b>' + esc(who) + '</b><small>' + esc(r.email) + (r.phone ? ' · ' + esc(r.phone) : '') + '</small></span></div>' +
        '</header>' +
        (r.note ? '<p class="co-note"><b>Note :</b> ' + esc(r.note) + '</p>' : '') +
        '<div class="co-table-wrap"><table class="co-table">' +
          '<thead><tr><th class="l">Article</th><th class="n">Qté</th><th class="n">Stock</th><th class="n">Prix</th><th class="n">Total</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>' +
        '<footer class="co-foot">' +
          '<span class="co-total">' + plural(items, 'article', 'articles') + ' · <b>' + money(r.total) + '</b> <small>jusqu\'au ' + esc(fmtDate(r.expires_at)) + '</small></span>' +
          '<div class="co-actions">' + actionsFor(r) + '</div>' +
        '</footer>' +
      '</article>';
    }).join('');
    $$('.co-card', listEl).forEach(function (card) {
      var r = resv.filter(function (x) { return x.id === card.getAttribute('data-id'); })[0];
      $$('[data-act]', card).forEach(function (btn) {
        btn.addEventListener('click', function () { act(r, btn.getAttribute('data-act'), btn); });
      });
    });
  }

  /* ---- actions ---- */
  function fail(btn) {
    return function (err) { btn.disabled = false; window.alert('Erreur : ' + (err && err.message ? err.message : err)); };
  }
  function act(r, what, btn) {
    if (what === 'invoice') {
      if (!CA.invoiceFromOrder) { window.alert('Facturation indisponible.'); return; }
      var ord = Object.assign({}, r, { kind: 'reservation' });
      if (CA.invoiceFromOrder(ord, linesOf(r)) !== false) location.hash = '#facturation';
      return;
    }
    if (what === 'see-invoice') {
      if (CA.focusInvoice) CA.focusInvoice(r.invoice_id);
      location.hash = '#historique';
      return;
    }
    if (what === 'delete') {
      if (!window.confirm('Supprimer définitivement la réservation ' + r.number + ' ?\nElle disparaîtra aussi de Mon compte du client.')) return;
      btn.disabled = true;
      sb.from('customer_reservations').delete().eq('id', r.id).eq('status', 'cancelled').select('id').then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Refusé : seule une réservation annulée peut être supprimée.');
        load();
      }).then(null, fail(btn));
      return;
    }
    if (what === 'cancel' && !window.confirm('Annuler la réservation ' + r.number + ' de ' + (r.name || r.email) + ' ?\nLe stock est libéré, sans pénalité ; le client est avisé par courriel.')) return;
    if (what === 'forgive' && !window.confirm('Retirer la pénalité de ' + r.number + ' ?\nElle ne comptera plus comme non récupérée (une suspension qu\'elle a causée est levée).')) return;
    btn.disabled = true;
    sb.rpc('admin_reservation_action', { p_res: r.id, p_action: what }).then(function (res) {
      if (res.error) throw res.error;
      load();
    }).then(null, fail(btn));
  }
})();
