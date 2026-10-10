/* =========================================================
   Création Audio — CMS Commandes › Clients en ligne
   Commandes envoyées par les clients connectés (compte.html -> panier de la
   boutique ou de la page spacers) : tables customer_orders + customer_order_lines.
   - Sous-onglets Dealers / Clients en ligne (#commandes/clients) / Réservations
     (#commandes/reservations — liste dans cms-reservations.js, CA.loadReservations).
   - Pastille de la barre latérale = nouvelles commandes dealer + client
     (CA.paintOrdersBadge, CA.ordersCount — cms-commandes.js y écrit les dealers).
   - Par commande : lignes, stock actuel, « à commander » (qté − stock), note, statut.
   - Statuts new → preparing → ready → invoiced (+ cancelled) ; dès « En préparation »
     le client ne peut plus modifier ni annuler dans Mon compte.
   - « Facturer » : CA.invoiceFromOrder({…, kind:'client'}) ; à l'enregistrement,
     RPC admin_invoice_customer_order (Facturée + compte relié à sa fiche).
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
    try { return new Date(iso).toLocaleString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return String(iso || '').slice(0, 16); }
  }
  function ago(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s)) return '';
    if (s < 90) return 'à l\'instant';
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
    return 'il y a ' + plural(Math.round(s / 86400), 'jour', 'jours');
  }
  var STATUS = { 'new': 'Nouvelle', preparing: 'En préparation', ready: 'Prête', invoiced: 'Facturée', cancelled: 'Annulée' };
  var OPEN = { 'new': 1, preparing: 1, ready: 1 };

  /* ---- pastille commune (dealers + clients) ---- */
  CA.ordersCount = CA.ordersCount || {};
  CA.paintOrdersBadge = function () {
    var navN = $('#nav-orders-n'); if (!navN) return;
    var c = CA.ordersCount, n = (c.dealer || 0) + (c.client || 0) + (c.resv || 0);
    navN.textContent = n; navN.hidden = !n;
    var tab = navN.closest('.tab');
    if (tab) tab.setAttribute('aria-label', 'Commandes' + (n ? ' (' + plural(n, 'nouvelle', 'nouvelles') + ')' : ''));
    var cn = $('#cc-new-n'); if (cn) { cn.textContent = c.client || 0; cn.hidden = !c.client; }
    var rn = $('#cr-n'); if (rn) { rn.textContent = c.resv || 0; rn.hidden = !c.resv; }
  };
  function setClientBadge(n) { CA.ordersCount.client = n; CA.paintOrdersBadge(); }

  var wrap = $('#cc-wrap'), listEl = $('#cc-list'), dealersEl = $('#co-dealers'), resvEl = $('#cr-wrap');
  if (!wrap || !listEl) return;
  var orders = [], stock = {}, filter = 'open', loaded = false, pending = null, sub = 'dealers', tabOpen = false;

  /* ---- sous-onglets Dealers / Clients en ligne / Réservations (#commandes/clients, #commandes/reservations) ---- */
  function showSub(s) {
    sub = s === 'clients' || s === 'reservations' ? s : 'dealers';
    $$('[data-cosub]').forEach(function (b) {
      var on = b.getAttribute('data-cosub') === sub;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on);
    });
    if (dealersEl) dealersEl.hidden = sub !== 'dealers';
    wrap.hidden = sub !== 'clients';
    if (resvEl) resvEl.hidden = sub !== 'reservations';
    $$('[data-co-dealer]').forEach(function (el) { el.hidden = sub !== 'dealers'; });
    if (sub === 'clients' && tabOpen) load();
    if (sub === 'reservations' && tabOpen && CA.loadReservations) CA.loadReservations();
  }
  $$('[data-cosub]').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = b.getAttribute('data-cosub');
      if (CA.route && CA.route.goSub) CA.route.goSub(s === 'dealers' ? '' : s); else showSub(s);
    });
  });
  if (CA.route && CA.route.onSub) CA.route.onSub(function (s, tab) { if (tab === 'commandes') showSub(s); });
  var prevOnTab = CA.onTab;
  CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    tabOpen = name === 'commandes';
    if (!tabOpen) return;
    var m = /^#commandes\/(clients|reservations)\b/.exec(location.hash), want = m ? m[1] : 'dealers';   // lien direct
    if (want !== sub) showSub(want); else if (sub === 'clients') load();
    else if (sub === 'reservations' && CA.loadReservations) CA.loadReservations();
  };
  $$('.cc-filter').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      $$('.cc-filter').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      render();
    });
  });
  var refreshBtn = $('#co-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function () {
    if (sub === 'clients') load(); else if (sub === 'reservations' && CA.loadReservations) CA.loadReservations();
  });
  CA.reloadCustomerOrders = function () { if (loaded) load(); else refreshBadge(); };

  function refreshBadge() {
    sb.from('customer_orders').select('id', { count: 'exact', head: true }).eq('status', 'new').then(function (res) {
      if (res && !res.error && typeof res.count === 'number') setClientBadge(res.count);
    }, function () {});
  }
  if (CA.onAdminReady) CA.onAdminReady(refreshBadge);
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (tabOpen && sub === 'clients') load(); else refreshBadge();
  }, 60000);

  /* ---- chargement ---- */
  function load() {
    if (pending) return pending;
    if (!loaded) listEl.innerHTML = '<p class="muted">Chargement…</p>';
    pending = sb.from('customer_orders').select('*, customer_order_lines(*)').order('created_at', { ascending: false }).limit(200)
      .then(function (ro) {
        if (ro.error) {
          listEl.innerHTML = '<p class="empty">Impossible de charger les commandes clients.<br>' + esc(ro.error.message) + '</p>';
          return;
        }
        orders = ro.data || [];
        var ids = {};
        orders.forEach(function (o) { linesOf(o).forEach(function (l) { if (l.product_id) ids[l.product_id] = 1; }); });
        var list = Object.keys(ids);
        return (list.length ? sb.from('products').select('id,qty,qty_2,hex').in('id', list) : Promise.resolve({ data: [] }))
          .then(function (rp) {
            stock = {};
            ((rp && rp.data) || []).forEach(function (p) { stock[p.id] = p; });
            loaded = true;
            setClientBadge(orders.filter(function (o) { return o.status === 'new'; }).length);
            render();
          });
      }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; })
      .then(function () { pending = null; }, function () { pending = null; });
    return pending;
  }
  function linesOf(o) {
    return (o.customer_order_lines || []).slice().sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  }
  function stockFor(l) {
    var p = l.product_id ? stock[l.product_id] : null;
    if (!p) return null;
    return l.kind === 'refill' ? (p.qty_2 | 0) : (p.qty | 0);
  }

  /* ---- liste ---- */
  function actionsFor(o) {
    var b = function (act, label, cls) {
      return '<button type="button" class="btn ' + (cls || 'btn-ghost') + ' btn-sm" data-act="' + act + '"' +
        (act === 'invoice' ? ' data-ic="receipt"' : act === 'delete' ? ' data-ic="trash"' : '') + '>' + label + '</button>';
    };
    switch (o.status) {
      case 'new': return b('preparing', 'Commencer la préparation', 'btn-accent') + b('invoice', 'Facturer') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'preparing': return b('ready', 'Marquer prête', 'btn-accent') + b('invoice', 'Facturer') + b('new', '↩ Remettre « Nouvelle »') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'ready': return b('invoice', 'Facturer', 'btn-accent') + b('preparing', '↩ En préparation') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'invoiced': return o.invoice_id ? b('see-invoice', 'Voir la facture') : '';
      case 'cancelled': return b('new', 'Rouvrir') + b('delete', 'Supprimer', 'btn-ghost co-danger');
    }
    return '';
  }
  function render() {
    var open = orders.filter(function (o) { return OPEN[o.status]; });
    var list = filter === 'open' ? open : orders;
    if (!list.length) {
      listEl.innerHTML = '<p class="empty">' + (filter === 'open'
        ? 'Aucune commande client en cours.' + (orders.length ? '<br>Les commandes facturées ou annulées sont sous « Toutes ».' : '<br>Les commandes envoyées depuis la boutique par les clients connectés arriveront ici.')
        : 'Aucune commande client pour l\'instant.') + '</p>';
      return;
    }
    listEl.innerHTML = list.map(function (o) {
      var lines = linesOf(o), items = 0, missing = 0;
      var rows = lines.map(function (l) {
        var st = stockFor(l), miss = st == null ? 0 : Math.max(0, (l.qty | 0) - st);
        items += l.qty | 0; missing += OPEN[o.status] ? miss : 0;
        var hex = l.product_id && stock[l.product_id] && stock[l.product_id].hex;
        return '<tr>' +
          '<td class="l"><span class="co-prod">' + (hex ? '<span class="cc-sw" style="background:' + esc(hex) + '"></span>' : '<span class="co-noimg"></span>') +
            '<span><b>' + esc(l.name) + '</b>' + (l.meta ? '<small class="cc-meta">' + esc(l.meta) + '</small>' : '') + '</span></span></td>' +
          '<td class="n"><b>' + (l.qty | 0) + '</b></td>' +
          '<td class="n">' + (st == null ? '—' : st) + '</td>' +
          '<td class="n">' + (!OPEN[o.status] ? '—' : miss ? '<span class="co-print-n">' + miss + '</span>' : '<span class="co-ok">en stock</span>') + '</td>' +
          '<td class="n">' + money(l.unit_price) + '</td>' +
          '<td class="n"><b>' + money(l.line_total) + '</b></td>' +
        '</tr>';
      }).join('');
      var who = o.name || o.email;
      return '<article class="co-card is-' + esc(o.status) + '" data-id="' + esc(o.id) + '">' +
        '<header class="co-head">' +
          '<div class="co-id"><b>' + esc(o.number) + '</b><span class="co-status is-' + esc(o.status) + '">' + esc(STATUS[o.status] || o.status) + '</span>' +
            (o.edited_at && OPEN[o.status] ? '<span class="co-edited">modifiée par le client ' + esc(ago(o.edited_at)) + '</span>' : '') +
            (o.status === 'cancelled' ? '<span class="co-edited">' + (o.cancelled_by === 'client' ? 'par le client' : 'par toi') + '</span>' : '') +
          '</div>' +
          '<div class="co-who">' + (CA.avatar ? CA.avatar(who) : '') +
            '<span><b>' + esc(who) + '</b><small>' + esc(o.email) + (o.phone ? ' · ' + esc(o.phone) : '') + ' · ' + esc(ago(o.created_at)) + '</small></span></div>' +
        '</header>' +
        (o.note ? '<p class="co-note"><b>Note :</b> ' + esc(o.note) + '</p>' : '') +
        '<div class="co-table-wrap"><table class="co-table">' +
          '<thead><tr><th class="l">Article</th><th class="n">Qté</th><th class="n">Stock</th><th class="n">À commander</th><th class="n">Prix</th><th class="n">Total</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>' +
        '<footer class="co-foot">' +
          '<span class="co-total">' + plural(items, 'article', 'articles') + (missing ? ' · <span class="co-print-n">' + missing + ' à commander</span>' : '') +
            ' · <b>' + money(o.total) + '</b> <small>' + esc(fmtDate(o.created_at)) + '</small></span>' +
          '<div class="co-actions">' + actionsFor(o) + '</div>' +
        '</footer>' +
      '</article>';
    }).join('');
    $$('.co-card', listEl).forEach(function (card) {
      var o = orders.filter(function (x) { return x.id === card.getAttribute('data-id'); })[0];
      $$('[data-act]', card).forEach(function (btn) {
        btn.addEventListener('click', function () { act(o, btn.getAttribute('data-act'), btn); });
      });
    });
  }

  /* ---- actions ---- */
  function act(o, what, btn) {
    if (what === 'invoice') {
      if (!CA.invoiceFromOrder) { caDialog.error('Facturation indisponible.'); return; }
      var ord = Object.assign({ kind: 'client' }, o);
      if (CA.invoiceFromOrder(ord, linesOf(o)) !== false) location.hash = '#facturation';
      return;
    }
    if (what === 'see-invoice') {
      if (CA.focusInvoice) CA.focusInvoice(o.invoice_id);
      location.hash = '#historique';
      return;
    }
    if (what === 'delete') {
      caDialog.confirm({ title: 'Supprimer la commande ' + o.number + ' ?', message: 'Elle disparaîtra aussi de Mon compte du client.',
        ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
        if (!ok) return;
        btn.disabled = true;
        sb.from('customer_orders').delete().eq('id', o.id).eq('status', 'cancelled').select('id').then(function (res) {
          if (res.error) throw res.error;
          if (!res.data || !res.data.length) throw new Error('Refusé : seule une commande annulée peut être supprimée.');
          load();
        }).then(null, function (err) { btn.disabled = false; caDialog.error(err); });
      });
      return;
    }
    if (what === 'cancel') {
      caDialog.confirm({ title: 'Annuler la commande ' + o.number + ' ?', message: (o.name || o.email) + ' — pense à prévenir le client.',
        ok: 'Annuler la commande', danger: true }).then(function (ok) { if (ok) setStatus(o, what, btn); });
      return;
    }
    setStatus(o, what, btn);
  }
  function setStatus(o, what, btn) {
    var patch = { status: what === 'cancel' ? 'cancelled' : what, updated_at: new Date().toISOString(),
                  cancelled_by: what === 'cancel' ? 'admin' : null };
    btn.disabled = true;
    sb.from('customer_orders').update(patch).eq('id', o.id).select('id').then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('Refusé (permissions). Es-tu connecté en admin ?');
      load();
    }).then(null, function (err) { btn.disabled = false; caDialog.error(err); });
  }
})();
