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
  // plage de cueillette -> « jeudi 23 oct., 13 h – 17 h » (aussi cms-reservations.js, cms-cueillettes.js)
  CA.hourTxt = function (t) {
    var p = String(t || '').split(':');
    return Number(p[0]) + ' h ' + (p[1] || '00');
  };
  CA.fmtPickup = function (x) {
    if (!x || !x.pickup_date) return '';
    var p = String(x.pickup_date).split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'short' }) +
      (x.pickup_start ? ', ' + CA.hourTxt(x.pickup_start) + (x.pickup_end ? ' – ' + CA.hourTxt(x.pickup_end) : '') : '');
  };
  CA.pickupLine = function (x) {
    var t = CA.fmtPickup(x), q = x && x.pickup_req;
    var req = q && q.state === 'pending'
      ? '<div class="co-pk is-req"><p><b>Demande d\'exception :</b> ' + esc(CA.fmtPickup({ pickup_date: q.d, pickup_start: q.s })) + '</p>' +
        (q.note ? '<p class="co-pk-note">' + esc(q.note) + '</p>' : '') +
        '<div class="co-pk-act"><button type="button" class="btn btn-accent btn-sm" data-pkreq="yes" data-ic="check">Approuver</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-pkreq="no">Refuser</button></div></div>' : '';
    return (t ? '<p class="co-pk"><b>Cueillette :</b> ' + esc(t) + '</p>' : '') + req;
  };
  // boutons Approuver / Refuser d'une demande (cartes Clients en ligne et Réservations) ; kind : 'order' | 'reservation'
  CA.bindPickupReq = function (card, x, kind, reload) {
    var q = x && x.pickup_req;
    Array.prototype.slice.call(card.querySelectorAll('[data-pkreq]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var yes = btn.getAttribute('data-pkreq') === 'yes';
        var when = CA.fmtPickup({ pickup_date: q.d, pickup_start: q.s });
        (yes ? Promise.resolve('') : caDialog.prompt({ title: 'Refuser la demande ?', message: (x.name || x.email) + ' — ' + when,
          placeholder: 'Mot pour le client (facultatif)', ok: 'Refuser' })).then(function (reply) {
          if (reply === null) return;
          btn.disabled = true;
          sb.rpc('admin_decide_pickup', { p_kind: kind, p_id: x.id, p_ok: yes, p_reply: reply || null }).then(function (res) {
            if (res.error) throw res.error;
            sb.functions.invoke('pickup-request-notify', { body: { kind: kind, id: x.id, event: yes ? 'approved' : 'refused' } }).then(function (r) {
              if (r && r.error) caDialog.toast('Courriel au client non envoyé.', 'bad');
              else caDialog.toast(yes ? 'Approuvée — client prévenu.' : 'Refusée — client prévenu.');
            }, function () { caDialog.toast('Courriel au client non envoyé.', 'bad'); });
            reload();
          }).then(null, function (err) { btn.disabled = false; caDialog.error(err); });
        });
      });
    });
  };
  // bouton « Cueillette » des cartes : même sélecteur que Mon compte (CA.custOrder.picker), affiché dans la carte.
  // « Autre jour ou heure » = jour et heure libres (admin_set_pickup ne regarde ni plages, ni préavis, ni capacité).
  CA.editPickup = function (x, kind, reload, card) {
    var old = card.querySelector('.co-pkedit');
    if (old) { old.remove(); return; }
    var CO = CA.custOrder, cur = x.pickup_date ? { d: String(x.pickup_date), s: String(x.pickup_start || '').slice(0, 5) } : null;
    var panel = document.createElement('div');
    panel.className = 'co-pkedit';
    panel.innerHTML = '<h3 class="co-pkedit-h">Changer la cueillette</h3><div class="co-pkedit-cal"><p class="muted">Chargement des plages…</p></div>' +
      '<div class="co-pkedit-free" hidden><input type="date" id="pke-d" value="' + esc(cur ? cur.d : '') + '"><input type="time" id="pke-s" step="900" value="' + esc(cur ? cur.s : '') + '"></div>' +
      '<div class="co-pkedit-foot"><button type="button" class="btn btn-accent btn-sm" data-ic="check" data-k="ok">Enregistrer</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-k="free">Autre jour ou heure</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-k="no">Annuler</button></div>';
    var anchor = card.querySelector('.co-table-wrap');
    anchor.parentNode.insertBefore(panel, anchor);
    var calEl = panel.querySelector('.co-pkedit-cal'), freeEl = panel.querySelector('.co-pkedit-free'), p = null;
    sb.rpc('pickup_slots', { p_until: kind === 'reservation' ? x.expires_at : null, p_self: x.id }).then(function (res) {
      calEl.innerHTML = '';
      if (res.error || !(res.data || []).length) { calEl.innerHTML = '<p class="muted">Aucune plage offerte : utilise « Autre jour ou heure ».</p>'; return; }
      p = CO.picker(calEl, { big: true });
      p.load(res.data, cur);
    });
    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-k]');
      if (!btn) return;
      var k = btn.getAttribute('data-k');
      if (k === 'no') { panel.remove(); return; }
      if (k === 'free') { freeEl.hidden = !freeEl.hidden; calEl.hidden = !freeEl.hidden; return; }
      var d, s;
      if (!freeEl.hidden) { d = panel.querySelector('#pke-d').value; s = panel.querySelector('#pke-s').value; }
      else { var v = p && p.value(); d = v && v.d; s = v && v.s; }
      if (!d || !s) { caDialog.toast('Choisis un jour et une heure.', 'bad'); return; }
      btn.disabled = true;
      sb.rpc('admin_set_pickup', { p_kind: kind, p_id: x.id, p_d: d, p_s: s }).then(function (res) {
        if (res.error) throw res.error;
        caDialog.toast('Cueillette modifiée.');
        reload();
      }).then(null, function (err) { btn.disabled = false; caDialog.error(err); });
    });
  };
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
  var orders = [], stock = {}, filter = 'open', loaded = false, pending = null, sub = 'clients', tabOpen = false;

  // Grand écran (≥ 1880 px, CA.wideLayout) : plus de sous-onglets, les 3 sources en colonnes (toutes affichées
  // et chargées) ; « Nouvelle commande » en bandeau au-dessus. En dessous : sous-onglets comme avant.
  // 1880 et pas 1600 : sous 1880 px, 3 colonnes pleines rendent les tableaux des cartes trop étroits.
  var panel = wrap.closest('.tabpanel');
  function isWide() { return !!(panel && panel.classList.contains('is-wide')); }
  function loadAll() { load(); if (CA.loadReservations) CA.loadReservations(); }
  if (panel) panel.addEventListener('ca:wide', function () { showSub(sub); });   // avant wideLayout : reçoit l'état initial
  if (CA.wideLayout) CA.wideLayout(panel, { min: 1880 });

  /* ---- sous-onglets Dealers / Clients en ligne / Réservations / Cueillettes (#commandes/clients, …/reservations,
     …/cueillettes — cms-cueillettes.js, CA.loadPickups). Grand écran : [Commandes] (les 3 colonnes) | [Cueillettes] ---- */
  var colsEl = $('.co-cols'), topEl = $('.co-top'), cqEl = $('#cq-wrap');
  function showSub(s) {
    sub = s === 'dealers' || s === 'reservations' || s === 'cueillettes' ? s : 'clients';
    var all = isWide(), cq = sub === 'cueillettes';
    $$('[data-cosub]').forEach(function (b) {
      var k = b.getAttribute('data-cosub'), on = k === 'all' ? !cq : k === sub;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on);
    });
    if (colsEl) colsEl.hidden = cq;
    if (topEl) topEl.hidden = cq;
    if (cqEl) cqEl.hidden = !cq;
    if (dealersEl) dealersEl.hidden = !all && sub !== 'dealers';
    wrap.hidden = !all && sub !== 'clients';
    if (resvEl) resvEl.hidden = !all && sub !== 'reservations';
    $$('[data-co-dealer]').forEach(function (el) { el.hidden = cq || (!all && sub !== 'dealers'); });
    if (cq) { if (tabOpen && CA.loadPickups) CA.loadPickups(); return; }
    if (all) { if (tabOpen) loadAll(); return; }
    if (sub === 'clients' && tabOpen) load();
    if (sub === 'reservations' && tabOpen && CA.loadReservations) CA.loadReservations();
  }
  $$('[data-cosub]').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = b.getAttribute('data-cosub');
      if (s === 'all') s = 'clients';
      if (CA.route && CA.route.goSub) CA.route.goSub(s === 'clients' ? '' : s); else showSub(s);
    });
  });
  if (CA.route && CA.route.onSub) CA.route.onSub(function (s, tab) { if (tab === 'commandes') showSub(s); });
  var prevOnTab = CA.onTab;
  CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    tabOpen = name === 'commandes';
    if (!tabOpen) return;
    var m = /^#commandes\/(dealers|reservations|cueillettes)\b/.exec(location.hash), want = m ? m[1] : 'clients';   // lien direct
    if (want !== sub) showSub(want); else if (sub === 'cueillettes') { if (CA.loadPickups) CA.loadPickups(); }
    else if (isWide()) loadAll(); else if (sub === 'clients') load();
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
    if (sub === 'cueillettes') { if (CA.loadPickups) CA.loadPickups(); }
    else if (isWide()) loadAll();
    else if (sub === 'clients') load(); else if (sub === 'reservations' && CA.loadReservations) CA.loadReservations();
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
    if (document.querySelector('.co-pkedit')) return;
    if (tabOpen && (sub === 'clients' || isWide())) load(); else refreshBadge();
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
        return (list.length ? sb.from('products').select('id,qty,qty_2,hex,image_path,attrs').in('id', list) : Promise.resolve({ data: [] }))
          .then(function (rp) {
            stock = {};
            ((rp && rp.data) || []).forEach(function (p) { stock[p.id] = p; });
            loaded = true;
            if (CA.loadHeldStock) CA.loadHeldStock();   // attente / statut changé -> cartes de stock à jour
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
  function publicUrl(path) { if (!path) return ''; try { return sb.storage.from('products').getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  // image du produit : filament = photo du format (bobine / recharge) sinon photo de la couleur ; accessoire, spacer = image_path
  function imgPath(p, kind) {
    if (!p) return '';
    var a = p.attrs || {};
    return (kind === 'refill' ? a.img_refill : kind === 'spool' ? a.img_spool : '') || p.image_path || '';
  }
  function thumb(p, kind) {
    var u = publicUrl(imgPath(p, kind));
    return u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '<span class="co-noimg"></span>';
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
        (act === 'invoice' ? ' data-ic="receipt"' : act === 'edit' ? ' data-ic="edit"' : act === 'delete' ? ' data-ic="trash"' : '') + '>' + label + '</button>';
    };
    var hold = OPEN[o.status] ? b(o.stock_hold ? 'unhold' : 'hold', o.stock_hold ? 'Libérer le stock' : 'Mettre en attente') + b('edit', 'Modifier') + b('pickup', 'Cueillette') : '';
    switch (o.status) {
      case 'new': return b('preparing', 'Commencer la préparation', 'btn-accent') + hold + b('invoice', 'Facturer') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'preparing': return b('ready', 'Marquer prête', 'btn-accent') + hold + b('invoice', 'Facturer') + b('new', '↩ Remettre « Nouvelle »') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'ready': return b('invoice', 'Facturer', 'btn-accent') + hold + b('preparing', '↩ En préparation') + b('cancel', 'Annuler', 'btn-ghost co-danger');
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
      var nRef = 0, nSpl = 0;
      var rows = lines.map(function (l) {
        var kd = CA.kindOf(l.meta, l.kind), st0 = stockFor(l);
        if (OPEN[o.status] && st0 != null && (l.qty | 0) > st0) { var mq = (l.qty | 0) - st0; if (kd === 'refill') nRef += mq; else if (kd === 'spool') nSpl += mq; }
        var st = stockFor(l), miss = st == null ? 0 : Math.max(0, (l.qty | 0) - st);
        items += l.qty | 0; missing += OPEN[o.status] ? miss : 0;
        return '<tr>' +
          '<td class="l"><span class="co-prod">' + thumb(l.product_id && stock[l.product_id], kd) +
            '<span><b>' + esc(l.name) + '</b>' + (l.meta ? '<small class="cc-meta">' + esc(CA.kindMeta(l.meta)) + '</small>' : '') + '</span>' +
            CA.kindPill(CA.kindOf(l.meta, l.kind)) + '</span></td>' +
          '<td class="n" data-l="Qté"><b>' + (l.qty | 0) + '</b></td>' +
          '<td class="n" data-l="À commander">' + (!OPEN[o.status] ? '—' : miss ? '<span class="co-print-n">' + miss + '</span>' : '<span class="co-ok">en stock</span>') + '</td>' +
          '<td class="n co-unit" data-l="Prix">' + money(l.unit_price) + '</td>' +
          '<td class="n" data-l="Total"><b>' + money(l.line_total) + '</b></td>' +
        '</tr>';
      }).join('');
      var who = o.name || o.email;
      if (editing && editing.id === o.id && OPEN[o.status]) return editCard(o, who);
      return '<article class="co-card is-' + esc(o.status) + '" data-id="' + esc(o.id) + '">' +
        '<header class="co-head">' +
          '<div class="co-id"><b>' + esc(o.number) + '</b><span class="co-status is-' + esc(o.status) + '">' + esc(STATUS[o.status] || o.status) + '</span>' +
            (o.edited_at && OPEN[o.status] ? '<span class="co-edited">modifiée par le client ' + esc(ago(o.edited_at)) + '</span>' : '') +
            (o.stock_hold && OPEN[o.status] ? '<span class="co-status is-preparing">Stock en attente</span>' : '') +
            (o.status === 'cancelled' ? '<span class="co-edited">' + (o.cancelled_by === 'client' ? 'par le client' : 'par toi') + '</span>' : '') +
          '</div>' +
          '<div class="co-who">' + (CA.avatar ? CA.avatar(who) : '') +
            '<span><b>' + esc(who) + '</b><small>' + CA.pv(o.email) + (o.phone ? ' · ' + CA.pv(o.phone) : '') + ' · ' + esc(ago(o.created_at)) + '</small></span></div>' +
        '</header>' +
        (OPEN[o.status] ? CA.pickupLine(o) : '') +
        (o.note ? '<p class="co-note"><b>Note :</b> ' + esc(o.note) + '</p>' : '') +
        '<div class="co-table-wrap"><table class="co-table">' +
          '<thead><tr><th class="l">Article</th><th class="n">Qté</th><th class="n">À commander</th><th class="n">Prix</th><th class="n">Total</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>' +
        '<footer class="co-foot">' +
          '<span class="co-total">' + plural(items, 'article', 'articles') + (missing ? ' · <span class="co-print-n">' + missing + ' à commander</span>' +
            (nRef ? ' <span class="kind-pill is-refill">' + nRef + ' recharge' + (nRef > 1 ? 's' : '') + '</span>' : '') +
            (nSpl ? ' <span class="kind-pill is-spool">' + nSpl + ' avec bobine</span>' : '') : '') +
            ' · <b>' + money(o.total) + '</b> <small>' + esc(fmtDate(o.created_at)) + '</small></span>' +
          '<div class="co-actions">' + actionsFor(o) + '</div>' +
        '</footer>' +
      '</article>';
    }).join('');
    $$('.co-card', listEl).forEach(function (card) {
      var o = orders.filter(function (x) { return x.id === card.getAttribute('data-id'); })[0];
      if (card.classList.contains('is-editing')) { bindEditor(card, o); return; }
      CA.bindPickupReq(card, o, 'order', load);
      $$('[data-act]', card).forEach(function (btn) {
        btn.addEventListener('click', function () { act(o, btn.getAttribute('data-act'), btn); });
      });
    });
  }

  /* ---- modifier les articles d'une commande en cours (bobine 70 °C introuvable -> 90 °C, etc.) ----
     Catalogue = products_public (même vue que le serveur) ; RPC admin_update_customer_order recalcule les prix. */
  var editing = null, catalog = null, catPending = null, ecMatches = [], ecActive = -1;
  function loadCatalog() {
    if (catalog) return Promise.resolve();
    if (catPending) return catPending;
    catPending = sb.from('products_public').select('id,type,name,brand,material,hex,qty,qty_2,sell_price,sell_price_2,image_path,attrs').then(function (r) {
      if (r.error) throw r.error;
      var out = [];
      (r.data || []).forEach(function (p) {
        var base = [p.brand, p.material].filter(Boolean).join(' · ');
        if (p.type === 'filament') {
          if (p.sell_price != null) out.push({ pid: p.id, kind: 'spool', name: p.name, meta: base + (base ? ' · ' : '') + 'Avec bobine', stock: p.qty | 0, price: +p.sell_price, p: p });
          if (p.sell_price_2 != null) out.push({ pid: p.id, kind: 'refill', name: p.name, meta: base + (base ? ' · ' : '') + 'Recharge', stock: p.qty_2 | 0, price: +p.sell_price_2, p: p });
        } else if (p.sell_price != null) {
          out.push({ pid: p.id, kind: 'unit', name: p.name, meta: p.type === 'accessory' ? 'Accessoire' : 'Spacer · paire', stock: p.qty | 0, price: +p.sell_price, p: p });
        }
      });
      catalog = out;
    }).then(function () { catPending = null; }, function (e) { catPending = null; throw e; });
    return catPending;
  }
  function startEdit(o) {
    var dropped = 0, items = [];
    linesOf(o).forEach(function (l) {
      if (!l.product_id) { dropped++; return; }
      var k = CA.kindOf(l.meta, l.kind);
      items.push({ pid: l.product_id, kind: k === 'refill' || k === 'spool' ? k : 'unit', name: l.name, meta: l.meta || '', qty: l.qty | 0 });
    });
    editing = { id: o.id, items: items, status: dropped ? plural(dropped, 'article retiré', 'articles retirés') + ' : produit supprimé.' : '' };
    render();
    loadCatalog().then(function () { render(); var s = $('.ce-search', listEl); if (s) s.focus({ preventScroll: true }); },
      function (e) { if (editing) { editing.status = 'Catalogue indisponible : ' + (e && e.message || e); render(); } });
  }
  function stopEdit() { editing = null; render(); }
  function editCard(o, who) {
    var rows = editing.items.map(function (it, i) {
      var c = catalog && catalog.filter(function (x) { return x.pid === it.pid && x.kind === it.kind; })[0];
      var st = c ? (c.stock > 0 ? c.stock + ' en stock' : 'sur commande') : '';
      return '<tr data-i="' + i + '"><td class="l"><span class="co-prod">' + thumb(c ? c.p : stock[it.pid], it.kind) + '<span><b>' + esc(it.name) + '</b>' +
          (it.meta ? '<small class="cc-meta">' + esc(CA.kindMeta(it.meta)) + '</small>' : '') + '</span>' + CA.kindPill(it.kind) + '</span></td>' +
        '<td class="n"><input type="number" class="cof-qty" min="1" max="999" step="1" inputmode="numeric" value="' + it.qty + '" aria-label="Quantité ' + esc(it.name) + '"></td>' +
        '<td class="n cof-opt">' + esc(st) + '</td>' +
        '<td class="n"><button type="button" class="btn btn-ghost btn-sm btn-icon ce-del" data-ic="trash" aria-label="Retirer ' + esc(it.name) + '"></button></td></tr>';
    }).join('');
    return '<article class="co-card is-editing is-' + esc(o.status) + '" data-id="' + esc(o.id) + '">' +
      '<header class="co-head"><div class="co-id"><b>' + esc(o.number) + '</b><span class="co-status is-' + esc(o.status) + '">Modification</span></div>' +
        '<div class="co-who">' + (CA.avatar ? CA.avatar(who) : '') + '<span><b>' + esc(who) + '</b><small>' + CA.pv(o.email) + '</small></span></div></header>' +
      '<div class="field"><div class="fx-combo"><input type="search" class="ce-search" placeholder="Ajouter ou remplacer un article…" autocomplete="off">' +
        '<div class="fx-combo-list ce-results" hidden></div></div></div>' +
      '<div class="co-table-wrap">' + (rows ? '<table class="co-table cof-table"><thead><tr><th class="l">Article</th><th class="n">Qté</th><th class="n cof-opt">Stock</th><th class="n" aria-label="Retirer"></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p class="cof-empty">Aucun article.</p>') + '</div>' +
      '<footer class="co-foot"><div class="co-actions">' +
        '<button type="button" class="btn btn-accent btn-sm ce-save" data-ic="save">Enregistrer</button>' +
        '<button type="button" class="btn btn-ghost btn-sm ce-cancel">Annuler</button>' +
        '<span class="status ce-status">' + esc(editing.status || '') + '</span></div></footer></article>';
  }
  function bindEditor(card, o) {
    var search = $('.ce-search', card), results = $('.ce-results', card), status = $('.ce-status', card), save = $('.ce-save', card);
    function hide() { results.hidden = true; ecActive = -1; }
    function show() {
      if (!catalog) { results.innerHTML = '<div class="fx-combo-empty">Chargement…</div>'; results.hidden = false; return; }
      var q = search.value;
      ecMatches = catalog.filter(function (c) { return !q.trim() || CA.searchMatch([c.name, c.meta].join(' '), q); }).slice(0, 40);
      ecActive = ecMatches.length ? 0 : -1;
      results.innerHTML = !ecMatches.length ? '<div class="fx-combo-empty">Aucun article trouvé.</div>' : ecMatches.map(function (c, i) {
        return '<button type="button" class="fx-combo-item' + (i === ecActive ? ' is-active' : '') + '" data-i="' + i + '">' + thumb(c.p, c.kind) + '<span class="ce-tx"><span class="nm">' + esc(c.name) + '</span><span class="ct">' +
          esc([c.meta, c.stock > 0 ? c.stock + ' en stock' : 'sur commande', money(c.price)].filter(Boolean).join(' · ')) + '</span></span></button>';
      }).join('');
      $$('.fx-combo-item', results).forEach(function (b) {
        b.addEventListener('mousedown', function (e) { e.preventDefault(); add(ecMatches[+b.getAttribute('data-i')]); });
      });
      results.hidden = false;
    }
    function add(c) {
      if (!c) return;
      var it = editing.items.filter(function (x) { return x.pid === c.pid && x.kind === c.kind; })[0];
      if (it) it.qty = Math.min(999, it.qty + 1); else editing.items.push({ pid: c.pid, kind: c.kind, name: c.name, meta: c.meta, qty: 1 });
      editing.status = '';
      render();
    }
    search.addEventListener('input', show);
    search.addEventListener('click', function () { if (results.hidden) show(); });
    search.addEventListener('blur', hide);
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (!results.hidden && ecMatches[ecActive]) add(ecMatches[ecActive]); }
      else if (e.key === 'Escape') hide();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (results.hidden) { show(); return; }
        if (!ecMatches.length) return;
        ecActive = (ecActive + (e.key === 'ArrowDown' ? 1 : -1) + ecMatches.length) % ecMatches.length;
        $$('.fx-combo-item', results).forEach(function (b, i) { b.classList.toggle('is-active', i === ecActive); if (i === ecActive) b.scrollIntoView({ block: 'nearest' }); });
      }
    });
    $$('tbody tr', card).forEach(function (tr) {
      var it = editing.items[+tr.getAttribute('data-i')], q = $('.cof-qty', tr);
      q.addEventListener('input', function () { var n = parseInt(q.value, 10); if (n >= 1) it.qty = Math.min(999, n); });
      q.addEventListener('change', function () { q.value = it.qty; });
      $('.ce-del', tr).addEventListener('click', function () { editing.items = editing.items.filter(function (x) { return x !== it; }); render(); });
    });
    $('.ce-cancel', card).addEventListener('click', stopEdit);
    save.addEventListener('click', function () {
      if (!editing.items.length) { status.textContent = 'Ajoute au moins un article.'; return; }
      save.disabled = true; status.textContent = 'Enregistrement…';
      sb.rpc('admin_update_customer_order', { p_id: o.id, p_lines: editing.items.map(function (it) { return { product_id: it.pid, kind: it.kind, qty: it.qty }; }) })
        .then(function (res) {
          if (res.error) throw res.error;
          if (!res.data || !res.data.id) throw new Error('Refusé (permissions). Es-tu connecté en admin ?');
          editing = null; caDialog.toast('Commande ' + o.number + ' modifiée.'); load();
        }).then(null, function (err) {
          save.disabled = false;
          var m = err && err.message ? err.message : String(err);
          if (/admin_update_customer_order|schema cache/i.test(m)) m = 'relance schema-v2.sql (modification des commandes clients).';
          status.textContent = 'Erreur : ' + m;
        });
    });
  }

  /* ---- actions ---- */
  function act(o, what, btn) {
    if (what === 'pickup') { CA.editPickup(o, 'order', load, btn.closest('.co-card')); return; }
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
    if (what === 'edit') { startEdit(o); return; }
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
    if (what === 'hold' || what === 'unhold') { setHold(o, what === 'hold', btn); return; }
    setStatus(o, what, btn);
  }
  // stock retiré du site (ou remis) en attendant le paiement : customer_orders.stock_hold -> _held_stock
  function setHold(o, on, btn) {
    btn.disabled = true;
    sb.from('customer_orders').update({ stock_hold: on, updated_at: new Date().toISOString() }).eq('id', o.id).select('id').then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('Refusé (permissions). Es-tu connecté en admin ?');
      caDialog.toast(on ? 'Stock en attente — retiré du site.' : 'Stock remis en vente.');
      load();
    }).then(null, function (err) { btn.disabled = false; caDialog.error(err); });
  }
  function setStatus(o, what, btn) {
    var patch = { status: what === 'cancel' ? 'cancelled' : what, updated_at: new Date().toISOString(),
                  cancelled_by: what === 'cancel' ? 'admin' : null };
    btn.disabled = true;
    sb.from('customer_orders').update(patch).eq('id', o.id).select('id').then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('Refusé (permissions). Es-tu connecté en admin ?');
      load();
      // « Prête » : courriel au client (une seule fois par commande, garde côté fonction : ready_notified_at)
      if (what === 'ready') sb.functions.invoke('customer-order-notify', { body: { order_id: o.id, event: 'ready' } }).then(function (r) {
        if (r && r.error) caDialog.toast('Courriel « prête » non envoyé.', 'bad');
        else if (r && r.data && r.data.sent) caDialog.toast('Client prévenu par courriel.');
      }, function () { caDialog.toast('Courriel « prête » non envoyé.', 'bad'); });
    }).then(null, function (err) { btn.disabled = false; caDialog.error(err); });
  }
})();
