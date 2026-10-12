/* =========================================================
   Création Audio V2 — Aujourd'hui (tableau de bord, grand écran)
   Ce qui demande ton attention d'un coup d'œil : messages non lus, commandes et
   réservations à traiter, articles à commander, commandes fournisseur en route,
   liste d'attente ; ventes du jour / 7 jours / mois ; derniers échanges, commandes
   ouvertes et factures. Lecture seule : chaque élément mène à son onglet.
   Page d'accueil dès 1600 px (DEFAULT_TAB d'admin-core) ; onglet caché en dessous
   (mobile inchangé). Rafraîchi chaque minute tant qu'il est ouvert.
   ========================================================= */
(function () {
  'use strict';

  var CA = window.CA = window.CA || {}, sb = CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dateFr(s) {   // 'AAAA-MM-JJ' (date locale) ou horodatage
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')), d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    return isNaN(d) ? '' : d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
  }
  function ago(ts) {
    var s = (Date.now() - Date.parse(ts)) / 1000;
    if (!isFinite(s)) return '';
    if (s < 3600) return 'il y a ' + Math.max(1, Math.round(s / 60)) + ' min';
    if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
    return 'il y a ' + plural(Math.round(s / 86400), 'jour', 'jours');
  }
  var ST = { 'new': 'Nouvelle', preparing: 'En préparation', ready: 'Prête', active: 'Active' };

  var panel = $('.tabpanel[data-panel="aujourdhui"]');
  if (!panel) return;
  var dateEl = $('#td-date'), tilesEl = $('#td-tiles'), salesEl = $('#td-sales'), msgsEl = $('#td-msgs'),
      ordersEl = $('#td-orders'), invEl = $('#td-invoices');
  var tabOpen = false, busy = null;

  // une requête qui échoue (même en la construisant) ne bloque pas la page : liste vide + erreur
  function q(make) {
    var p; try { p = make(); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (r) { return r && !r.error ? r : { data: [], count: 0, error: (r && r.error) || true }; },
      function (e) { return { data: [], count: 0, error: e || true }; });
  }

  // À commander + en route : mêmes calculs que l'Inventaire (CA.inv / CA.enRoute / CA.reserved)
  function stockSummary() {
    if (!CA.inv || !CA.inv.ready || !CA.inv.missing) return Promise.resolve(null);
    var waits = [CA.inv.ready()];
    if (CA.enRoute && CA.enRoute.reload) waits.push(CA.enRoute.reload());
    if (CA.reserved && CA.reserved.reload) waits.push(CA.reserved.reload());
    return Promise.all(waits).then(function () {
      var orders = CA.enRoute && CA.enRoute.list ? CA.enRoute.list() : [], left = 0;
      orders.forEach(function (o) { (o.lines || []).forEach(function (l) { left += Math.max(0, (l.qty | 0) - (l.qty_received | 0)); }); });
      return { miss: CA.inv.missing(), routeOrders: orders.length, routeLeft: left };
    }, function () { return null; });
  }

  function load() {
    if (busy) return busy;
    var now = new Date(), today = iso(now),
        d7 = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)),
        m1 = iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        from = d7 < m1 ? d7 : m1;
    if (dateEl) dateEl.textContent = now.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    busy = Promise.all([
      q(function () { return sb.from('conversations').select('id', { count: 'exact', head: true }).gt('admin_unread', 0); }),
      q(function () { return sb.from('conversations').select('id,admin_unread,last_preview,last_from,status,updated_at,customers(name,email)')
        .eq('status', 'open').order('updated_at', { ascending: false }).limit(5); }),
      q(function () { return sb.from('dealer_orders').select('id,number,dealer_name,dealer_email,status,total,created_at')
        .in('status', ['new', 'preparing', 'ready']).order('created_at', { ascending: false }); }),
      q(function () { return sb.from('customer_orders').select('id,number,name,email,status,total,created_at')
        .in('status', ['new', 'preparing', 'ready']).order('created_at', { ascending: false }); }),
      q(function () { return sb.from('customer_reservations').select('id,number,name,email,status,total,expires_at,created_at')
        .eq('status', 'active').order('expires_at', { ascending: true }); }),
      q(function () { return sb.from('invoices').select('id,total,invoice_date,status,client_type').gte('invoice_date', from); }),
      q(function () { return sb.from('invoices').select('id,number,client_name,client_type,total,invoice_date,status,created_at')
        .order('invoice_date', { ascending: false }).order('created_at', { ascending: false }).limit(5); }),
      q(function () { return sb.from('waitlist').select('id', { count: 'exact', head: true }).eq('status', 'open'); }),
      stockSummary()
    ]).then(function (r) {
      render({ unread: r[0].count || 0, convs: (r[1].data || []).slice(0, 5), dealer: r[2].data || [], client: r[3].data || [],
        resv: (r[4].data || []).filter(function (x) { return Date.parse(x.expires_at) > Date.now(); }),
        sales: r[5], last: (r[6].data || []).slice(0, 5), wait: r[7].count || 0, stock: r[8], today: today, d7: d7, m1: m1,
        err: r.map(function (x) { return !!(x && x.error); }) });
    }).then(function () { busy = null; }, function () { busy = null; });
    return busy;
  }

  function tile(go, n, label, sub, hot) {
    return '<button type="button" class="td-tile' + (hot ? ' is-hot' : '') + '" data-go="' + esc(go) + '">' +
      '<span class="td-n">' + esc(n) + '</span><span class="td-l">' + esc(label) + '</span>' +
      (sub ? '<span class="td-s">' + esc(sub) + '</span>' : '') + '</button>';
  }
  function card(title, go, body) {
    return '<div class="td-card-head"><h2>' + esc(title) + '</h2>' +
      (go ? '<button type="button" class="btn btn-ghost btn-sm" data-go="' + esc(go) + '">Ouvrir</button>' : '') + '</div>' + body;
  }

  function render(d) {
    var newOf = function (list) { return list.filter(function (o) { return o.status === 'new'; }).length; };
    var dNew = newOf(d.dealer), cNew = newOf(d.client);
    var soon = d.resv.filter(function (x) { return Date.parse(x.expires_at) - Date.now() < 86400000; }).length;
    var st = d.stock, miss = st && st.miss;

    tilesEl.innerHTML =
      tile('#messages', d.err[0] ? '—' : d.unread, 'Messages non lus', '', d.unread > 0) +
      tile('#commandes', d.err[2] ? '—' : dNew, 'Commandes dealers', d.dealer.length - dNew ? '+ ' + (d.dealer.length - dNew) + ' en cours' : '', dNew > 0) +
      tile('#commandes/clients', d.err[3] ? '—' : cNew, 'Commandes clients', d.client.length - cNew ? '+ ' + (d.client.length - cNew) + ' en cours' : '', cNew > 0) +
      tile('#commandes/reservations', d.err[4] ? '—' : d.resv.length, 'Réservations', soon ? plural(soon, 'expire', 'expirent') + ' < 24 h' : '', soon > 0) +
      tile('#inventaire/commander', miss ? miss.units : '—', 'À commander', miss && miss.lines ? plural(miss.lines, 'ligne', 'lignes') : '', !!(miss && miss.units)) +
      tile('#inventaire/reception', st ? st.routeOrders : '—', 'En route', st && st.routeLeft ? plural(st.routeLeft, 'article attendu', 'articles attendus') : '', false) +
      tile('#inventaire/attente', d.err[7] ? '—' : d.wait, 'Liste d\'attente', '', false);

    // ventes : factures finales, hors usage interne
    var sales = (d.sales.data || []).filter(function (f) { return f.status !== 'cancelled' && f.client_type !== 'internal'; });
    var sum = function (fromIso) {
      var l = sales.filter(function (f) { return f.invoice_date >= fromIso; });
      return { n: l.length, t: l.reduce(function (s, f) { return s + (Number(f.total) || 0); }, 0) };
    };
    var sToday = sum(d.today), s7 = sum(d.d7), sM = sum(d.m1);
    var line = function (label, x) {
      return '<div class="td-sale"><span>' + esc(label) + '</span><b>' + esc(money(x.t)) + '</b><small>' + esc(plural(x.n, 'facture', 'factures')) + '</small></div>';
    };
    salesEl.innerHTML = card('Ventes', '#statistiques', d.sales.error ? '<p class="td-none">Indisponible.</p>'
      : line('Aujourd\'hui', sToday) + line('7 derniers jours', s7) + line('Ce mois-ci', sM));

    msgsEl.innerHTML = card('Messages récents', '#messages', d.convs.length ? d.convs.map(function (c) {
      var k = c.customers || {}, who = k.name || k.email || 'Client';
      return '<button type="button" class="td-row" data-go="#messages/' + esc(c.id) + '">' + CA.avatar(who) +
        '<span class="td-row-tx"><b>' + esc(who) + '</b><small>' + esc(c.last_preview || '') + '</small></span>' +
        '<span class="td-row-end">' + (c.admin_unread > 0 ? '<b class="nav-count">' + c.admin_unread + '</b>' : '') +
        '<small>' + esc(ago(c.updated_at)) + '</small></span></button>';
    }).join('') : '<p class="td-none">Aucune conversation ouverte.</p>');

    var orders = d.dealer.map(function (o) { return { go: '#commandes', n: o.number, who: o.dealer_name || o.dealer_email, st: o.status, t: o.total, at: o.created_at }; })
      .concat(d.client.map(function (o) { return { go: '#commandes/clients', n: o.number, who: o.name || o.email, st: o.status, t: o.total, at: o.created_at }; }))
      .concat(d.resv.map(function (o) { return { go: '#commandes/reservations', n: o.number, who: o.name || o.email, st: 'active', t: o.total, at: o.created_at }; }))
      .sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); }).slice(0, 6);
    ordersEl.innerHTML = card('Commandes à traiter', '#commandes', orders.length ? orders.map(function (o) {
      return '<button type="button" class="td-row" data-go="' + esc(o.go) + '"><span class="td-row-tx"><b>' + esc(o.n) + '</b><small>' + esc(o.who || '') + '</small></span>' +
        '<span class="td-st is-' + esc(o.st) + '">' + esc(ST[o.st] || o.st) + '</span><span class="td-row-end"><b>' + esc(money(o.t)) + '</b>' +
        '<small>' + esc(ago(o.at)) + '</small></span></button>';
    }).join('') : '<p class="td-none">Rien à traiter.</p>');

    invEl.innerHTML = card('Dernières factures', '#historique', d.last.length ? d.last.map(function (f) {
      return '<button type="button" class="td-row" data-inv="' + esc(f.id) + '"><span class="td-row-tx"><b>' + esc(f.number || '—') + '</b>' +
        '<small>' + esc(f.client_type === 'internal' ? 'Usage interne' : (f.client_name || '')) + '</small></span>' +
        (f.status === 'cancelled' ? '<span class="td-st is-cancelled">Annulée</span>' : '') +
        '<span class="td-row-end"><b>' + esc(money(f.total)) + '</b><small>' + esc(dateFr(f.invoice_date)) + '</small></span></button>';
    }).join('') : '<p class="td-none">Aucune facture.</p>');
  }

  panel.addEventListener('click', function (e) {
    var inv = e.target.closest('[data-inv]');
    if (inv) { if (CA.focusInvoice) CA.focusInvoice(inv.getAttribute('data-inv')); location.hash = '#historique'; return; }
    var b = e.target.closest('[data-go]');
    if (b) location.hash = b.getAttribute('data-go');
  });
  var refreshBtn = $('#td-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function () { load(); });

  var prevOnTab = CA.onTab;
  CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    tabOpen = name === 'aujourdhui';
    if (tabOpen) load();
  };
  setInterval(function () { if (tabOpen && document.visibilityState === 'visible') load(); }, 60000);
})();
