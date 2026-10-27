/* =========================================================
   Création Audio — CMS Messages (messagerie du site public)
   Conversations envoyées par le panneau « Écris-nous » (assets/messagerie.js) :
   tables conversations + messages (RLS admin), photos dans le bucket privé
   « messages » (URL signées).
   - Liste (Ouvertes / Réglées / Toutes) + fil de la conversation (#messages/<id>).
   - Fil ouvert (relu aux 10 s, onglet visible) : RPC admin_msg_seen = lu + présence
     (admin_seen_at) ; renvoie client_seen_at -> « En ligne » / « Vu il y a … » dans
     l'en-tête et point vert sur la ligne du client.
   - Répondre (texte + photos, Ctrl+Entrée). Courriels différés : le tick pg_cron
     (messages_tick -> message-notify) avise le client si la série reste non lue 5 min.
   - Marquer réglée / rouvrir ; Supprimer (photos effacées par l'API Storage).
   - Filtre « Comptes » : tous les comptes clients (customers) + recherche ; un clic
     ouvre sa conversation ouverte, sinon un brouillon (#messages/c-<customer_id>) :
     la conversation (sujet « Mon compte ») n'est créée qu'au premier envoi.
   - Bouton « Modèles » : texte pré-rempli ({prénom}, {dernière commande}…), modèles
     éditables (admin_settings « msg_modeles ») ; un modèle « réservation » coche
     customers.can_reserve à l'envoi.
   - Pastille #nav-msgs-n = conversations avec des messages non lus.
   - Loi 25 : conversations sans message depuis 12 mois effacées (photos
     comprises) au premier chargement de l'onglet.
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
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function ago(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s)) return '';
    if (s < 90) return 'à l\'instant';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 86400) return Math.round(s / 3600) + ' h';
    if (s < 7 * 86400) return plural(Math.round(s / 86400), 'jour', 'jours');
    return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
  }
  function day(iso) {
    var d = new Date(iso), t = new Date();
    if (d.toDateString() === t.toDateString()) return 'Aujourd\'hui';
    var y = new Date(t); y.setDate(t.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Hier';
    return d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function hour(iso) { return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  var TOPIC = { filaments: 'Filaments', spacers: 'Spacers', compte: 'Mon compte', autre: 'Autre' };
  function about(c) { return (TOPIC[c.topic] || 'Question') + (c.ref ? ' · ' + c.ref : ''); }
  function who(c) { var k = c.customers || {}; return k.name || k.email || 'Client'; }
  var MAX_PHOTOS = 4, MAX_SIDE = 1600, KEEP_DAYS = 365;

  var wrap = $('#ms-wrap'), listEl = $('#ms-list'), threadEl = $('#ms-thread'), navN = $('#nav-msgs-n');
  if (!wrap || !listEl || !threadEl) return;
  var convs = [], filter = 'open', curId = null, msgs = [], photos = [], urlCache = {};
  var tabOpen = false, loaded = false, pending = null, purged = false, busy = false;
  var accounts = null, accQ = '', draft = null, flash = '';
  var tplGrant = null;   // modèle choisi qui active la réservation à l'envoi   // filtre Comptes ; brouillon = conversation pas encore créée

  /* ---- pastille de la barre latérale ---- */
  function paintBadge(n) {
    if (!navN) return;
    navN.textContent = n; navN.hidden = !n;
    var tab = navN.closest('.tab');
    if (tab) tab.setAttribute('aria-label', 'Messages' + (n ? ' (' + plural(n, 'non lu', 'non lus') + ')' : ''));
  }
  function refreshBadge() {
    sb.from('conversations').select('id', { count: 'exact', head: true }).gt('admin_unread', 0).then(function (res) {
      if (res && !res.error && typeof res.count === 'number') paintBadge(res.count);
    }, function () {});
  }
  if (CA.onAdminReady) CA.onAdminReady(refreshBadge);
  // fil relu aux 10 s (lecture + présence), liste et pastille aux 20 s
  var tick = 0;
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    var even = ++tick % 2 === 0;
    if (!tabOpen) { if (even) refreshBadge(); return; }
    if (even) load();
    if (curId && !busy) loadThread(false);
  }, 10000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && tabOpen && curId && !busy) loadThread(false);
  });

  /* ---- présence du client (client_seen_at, relu par me_messages aux 10 s) ---- */
  var skew = 0;   // horloge du serveur - horloge locale
  function online(c) {
    var t = c && c.client_seen_at ? Date.parse(c.client_seen_at) : NaN;
    return isFinite(t) && Date.now() + skew - t < 40000;
  }
  function paintSeen(c) {
    var el = $('#ms-seen', threadEl); if (!el) return;
    // ago() : « à l'instant » · « 12 min » · « 3 h » · « 2 jours » · « 21 oct. »
    var on = online(c), a = !on && c.client_seen_at ? ago(c.client_seen_at) : '';
    el.textContent = on ? 'En ligne' : !a ? '' : 'Vu ' + (/^\d/.test(a) ? 'il y a ' + a : /instant/.test(a) ? a : 'le ' + a);
    el.hidden = !el.textContent;
    el.classList.toggle('is-online', on);
  }
  function seen(c) {
    return sb.rpc('admin_msg_seen', { p_conv: c.id }).then(function (res) {
      var d = res && !res.error && res.data; if (!d) return;
      if (d.now) skew = Date.parse(d.now) - Date.now();
      var was = online(c);
      c.client_seen_at = d.client_seen_at;
      if (online(c) !== was) renderList();
      if (curId === c.id) paintSeen(c);
    }, function () {});
  }

  /* ---- onglet + route #messages/<id> ---- */
  var prevOnTab = CA.onTab;
  CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    tabOpen = name === 'messages';
    if (!tabOpen) return;
    purge();
    load().then(function () { var r = CA.route && CA.route.get(); open(r && r.tab === 'messages' ? r.sub : null); });
  };
  if (CA.route && CA.route.onSub) CA.route.onSub(function (s, tab) { if (tab === 'messages' && loaded) open(s); });
  function go(id) { if (CA.route && CA.route.goSub) CA.route.goSub(id || ''); else open(id); }

  $$('.ms-filter').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      $$('.ms-filter').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      if (filter === 'accounts' && !accounts) loadAccounts(); else renderList();
    });
  });
  var refreshBtn = $('#ms-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function () {
    load(); if (curId) loadThread(false); sideFor = null; renderSide();
    if (filter === 'accounts') loadAccounts();
  });

  /* ---- grand écran (≥ 1600 px) : fiche du client à droite du fil ----
     Ses 5 dernières commandes en ligne, réservations (customer_id de la conversation) et factures (fiche reliée,
     customers.client_id) ; un clic mène à l'onglet concerné. Rien n'est chargé sous 1600 px (colonne cachée). */
  var sideEl = $('#ms-side'), panel = wrap.closest('.tabpanel'), sideFor = null;
  var C_ST = { 'new': 'Nouvelle', preparing: 'En préparation', ready: 'Prête', invoiced: 'Facturée', cancelled: 'Annulée' };
  var R_ST = { active: 'Active', invoiced: 'Facturée', cancelled: 'Annulée', expired: 'Expirée' };
  function isWide() { return !!(panel && panel.classList.contains('is-wide')); }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function dateFr(s) {   // 'AAAA-MM-JJ' (date locale, pas UTC) ou horodatage
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')), d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    return isNaN(d) ? '' : d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function sideRows(sel, q, row, none) {
    var token = sideFor;
    q.then(function (res) {
      var box = sideEl && $(sel, sideEl);
      if (!box || sideFor !== token) return;   // autre conversation entre-temps
      if (!res || res.error) { box.innerHTML = '<p class="ms-sd-none">Indisponible.</p>'; return; }
      var list = res.data || [];
      box.innerHTML = list.length ? list.map(row).join('') : '<p class="ms-sd-none">' + none + '</p>';
    }, function () { var box = sideEl && $(sel, sideEl); if (box && sideFor === token) box.innerHTML = '<p class="ms-sd-none">Indisponible.</p>'; });
  }
  function sdRow(attrs, num, st, amt, when) {
    return '<button type="button" class="ms-sd-row" ' + attrs + '><b>' + esc(num || '—') + '</b>' +
      '<span class="ms-sd-st">' + esc(st || '') + '</span><span class="ms-sd-amt">' + esc(amt) + '</span>' +
      (when ? '<small>' + esc(when) + '</small>' : '') + '</button>';
  }
  function renderSide() {
    if (!sideEl) return;
    var c = curId ? conv() : null;
    if (!isWide() || !c) { sideEl.innerHTML = ''; sideFor = null; return; }
    if (sideFor === c.id) return;
    sideFor = c.id;
    var k = c.customers || {};
    sideEl.innerHTML =
      '<div class="ms-sd-who">' + CA.avatar(who(c)) + '<div><b>' + esc(who(c)) + '</b>' +
        (k.phone ? '<small>' + CA.pv(k.phone) + '</small>' : '') + '</div></div>' +
      '<section class="ms-sd"><h3>Commandes en ligne</h3><div id="ms-sd-co"><p class="ms-sd-none">Chargement…</p></div></section>' +
      '<section class="ms-sd"><h3>Réservations</h3><div id="ms-sd-re"><p class="ms-sd-none">Chargement…</p></div></section>' +
      '<section class="ms-sd"><h3>Factures</h3><div id="ms-sd-in"><p class="ms-sd-none">' + (k.client_id ? 'Chargement…' : 'Fiche client pas encore reliée.') + '</p></div></section>';
    sideRows('#ms-sd-co', sb.from('customer_orders').select('id,number,status,total,created_at').eq('customer_id', c.customer_id)
      .order('created_at', { ascending: false }).limit(5),
      function (o) { return sdRow('data-go="#commandes/clients"', o.number, C_ST[o.status] || o.status, money(o.total), dateFr(o.created_at)); }, 'Aucune commande.');
    sideRows('#ms-sd-re', sb.from('customer_reservations').select('id,number,status,total,created_at').eq('customer_id', c.customer_id)
      .order('created_at', { ascending: false }).limit(5),
      function (r) { return sdRow('data-go="#commandes/reservations"', r.number, R_ST[r.status] || r.status, money(r.total), dateFr(r.created_at)); }, 'Aucune réservation.');
    if (k.client_id) sideRows('#ms-sd-in', sb.from('invoices').select('id,number,status,total,invoice_date').eq('client_id', k.client_id)
      .order('invoice_date', { ascending: false }).limit(5),
      function (f) { return sdRow('data-inv="' + esc(f.id) + '"', f.number, f.status === 'cancelled' ? 'Annulée' : '', money(f.total), dateFr(f.invoice_date)); }, 'Aucune facture.');
  }
  if (sideEl) sideEl.addEventListener('click', function (e) {
    var b = e.target.closest('.ms-sd-row'); if (!b) return;
    var inv = b.getAttribute('data-inv');
    if (inv) { if (CA.focusInvoice) CA.focusInvoice(inv); location.hash = '#historique'; return; }
    var to = b.getAttribute('data-go'); if (to) location.hash = to;
  });
  if (panel) panel.addEventListener('ca:wide', function () { sideFor = null; renderSide(); });
  if (CA.wideLayout) CA.wideLayout(panel);

  /* ---- chargement de la liste ---- */
  function load() {
    if (pending) return pending;
    if (!loaded) listEl.innerHTML = '<p class="muted">Chargement…</p>';
    pending = sb.from('conversations').select('*, customers(name, email, phone, client_id, can_reserve)')
      .order('updated_at', { ascending: false }).limit(300)
      .then(function (res) {
        if (res.error) { listEl.innerHTML = '<p class="empty">Impossible de charger les messages.<br>' + esc(res.error.message) + '</p>'; return; }
        convs = res.data || []; loaded = true;
        paintBadge(convs.filter(function (c) { return c.admin_unread > 0; }).length);
        renderList();
      }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau — réessaie.</p>'; })
      .then(function () { pending = null; });
    return pending;
  }
  /* ---- filtre Comptes : tous les comptes clients ---- */
  function loadAccounts() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return sb.from('customers').select('id, name, email, phone, client_id, can_reserve, created_at')
      .order('created_at', { ascending: false }).limit(1000)
      .then(function (res) {
        if (res.error) { listEl.innerHTML = '<p class="empty">Impossible de charger les comptes.<br>' + esc(res.error.message) + '</p>'; return; }
        var list = res.data || [];
        var ids = list.map(function (k) { return k.client_id; }).filter(Boolean);
        if (!ids.length) return list;
        // factures par fiche reliée : nombre + dernière date
        return sb.from('invoices').select('client_id, invoice_date, status').in('client_id', ids).then(function (r) {
          var by = {};
          ((!r.error && r.data) || []).forEach(function (f) {
            if (f.status === 'cancelled') return;
            var s = by[f.client_id] || (by[f.client_id] = { n: 0, last: '' });
            s.n++; if (String(f.invoice_date || '') > s.last) s.last = String(f.invoice_date);
          });
          list.forEach(function (k) { k._inv = by[k.client_id] || null; });
          return list;
        });
      }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau — réessaie.</p>'; })
      .then(function (list) { if (list) { accounts = list; if (filter === 'accounts') renderList(); } });
  }
  function custName(k) { return k.name || k.email || 'Client'; }
  function openConvOf(custId) {
    return convs.filter(function (c) { return c.customer_id === custId && c.status === 'open'; })[0] || null;
  }
  function renderAccounts() {
    if (!$('#ms-acc-q', listEl)) {
      listEl.innerHTML = '<input type="search" id="ms-acc-q" class="ms-acc-q" placeholder="Chercher un compte…" aria-label="Chercher un compte" autocomplete="off">' +
        '<div class="ms-acc-rows" id="ms-acc-rows"></div>';
      var q = $('#ms-acc-q', listEl);
      q.value = accQ;
      q.addEventListener('input', function () { accQ = q.value; renderAccounts(); });
    }
    var box = $('#ms-acc-rows', listEl);
    if (!accounts) { box.innerHTML = '<p class="muted">Chargement…</p>'; return; }
    var rows = accounts.filter(function (k) {
      return window.CA.searchMatch([k.name, k.email, k.phone].join(' '), accQ);
    });
    if (!rows.length) {
      box.innerHTML = '<p class="ms-empty">' + (accounts.length ? 'Aucun compte trouvé.' : 'Aucun compte pour l\'instant.') + '</p>';
      return;
    }
    var curCust = (conv() || {}).customer_id;
    box.innerHTML = rows.map(function (k) {
      var inv = k._inv, oc = openConvOf(k.id);
      var buys = inv ? plural(inv.n, 'facture', 'factures') + ' · dernière ' + dateFr(inv.last) : (k.client_id ? 'Aucune facture' : 'Fiche non reliée');
      return '<button type="button" class="ms-row ms-acc' + (k.id === curCust ? ' is-current' : '') + '" data-cust="' + esc(k.id) + '">' +
        CA.avatar(custName(k)) +
        '<span class="ms-row-tx">' +
          '<span class="ms-row-top"><b>' + esc(custName(k)) + '</b>' + (oc ? '<time>Conversation ouverte</time>' : '') + '</span>' +
          '<span class="ms-row-prev">' + [k.name ? CA.pv(k.email) : '', CA.pv(k.phone)].filter(Boolean).join(' · ') + '</span>' +
          '<span class="ms-row-about">' + esc(buys) + '</span>' +
        '</span></button>';
    }).join('');
    $$('.ms-acc', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-cust'), oc = openConvOf(id);
        go(oc ? oc.id : 'c-' + id);
      });
    });
  }

  function renderList() {
    if (filter === 'accounts') { renderAccounts(); return; }
    var rows = convs.filter(function (c) { return filter === 'all' || c.status === filter || c.id === curId; });
    if (!rows.length) {
      listEl.innerHTML = '<p class="ms-empty">' + (filter === 'open' ? 'Aucune conversation ouverte.' : filter === 'closed' ? 'Aucune conversation réglée.' : 'Aucun message pour l\'instant.') + '</p>';
      return;
    }
    listEl.innerHTML = rows.map(function (c) {
      var un = +c.admin_unread || 0, name = who(c);
      return '<button type="button" class="ms-row' + (un ? ' is-unread' : '') + (c.id === curId ? ' is-current' : '') +
        (online(c) ? ' is-online' : '') + '" data-id="' + esc(c.id) + '">' +
        CA.avatar(name) +
        '<span class="ms-row-tx">' +
          '<span class="ms-row-top"><b>' + esc(name) + '</b><time>' + esc(ago(c.updated_at)) + '</time></span>' +
          '<span class="ms-row-about">' + esc(about(c)) + (c.status === 'closed' ? ' · Réglée' : '') + '</span>' +
          '<span class="ms-row-bot"><span class="ms-row-prev">' + (c.last_from === 'admin' ? 'Toi : ' : '') + esc(c.last_preview || '') + '</span>' +
            (un ? '<span class="nav-count">' + un + '</span>' : '') + '</span>' +
        '</span></button>';
    }).join('');
    $$('.ms-row', listEl).forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-id')); }); });
  }

  /* ---- fil d'une conversation ---- */
  function open(id) {
    var dm = /^c-([0-9a-f-]{36})$/i.exec(id || '');
    if (!id || (!dm && !/^[0-9a-f-]{36}$/i.test(id))) {
      curId = null; draft = null; wrap.classList.remove('has-conv'); clearPhotos();
      threadEl.innerHTML = '<p class="ms-none">Choisis une conversation.</p>';
      renderList(); renderSide(); return;
    }
    if (id === curId && threadEl.querySelector('.ms-msgs')) return;
    if (dm) {   // brouillon : conversation ouverte existante -> on la reprend
      var oc = openConvOf(dm[1]);
      if (oc) { go(oc.id); return; }
      if (!accounts) { loadAccounts().then(function () { if (accounts) open(id); }); return; }
      var k0 = accounts.filter(function (k) { return k.id === dm[1]; })[0];
      draft = k0 ? { id: id, customer_id: k0.id, customers: k0, topic: 'compte', status: 'open', _draft: true } : null;
    } else draft = null;
    curId = id; msgs = []; clearPhotos();
    wrap.classList.add('has-conv');
    renderList();
    var c = conv();
    if (!c) { threadEl.innerHTML = '<p class="ms-none">' + (dm ? 'Compte introuvable.' : 'Conversation introuvable.') + '</p>'; return; }
    var k = c.customers || {};
    threadEl.innerHTML =
      '<header class="ms-head">' +
        '<button type="button" class="btn btn-ghost btn-sm ms-back" aria-label="Retour à la liste">←</button>' +
        CA.avatar(who(c)) +
        '<div class="ms-head-tx"><h2>' + esc(who(c)) + (c._draft ? '' : ' <span class="ms-seen" id="ms-seen" hidden></span>') + '</h2>' +
          '<p class="person-meta">' + (k.email ? '<span class="pm pm-mail">' + CA.pv(k.email) + '</span>' : '') +
            (k.phone ? '<span class="pm pm-tel">' + CA.pv(k.phone) + '</span>' : '') + '</p>' +
          '<p class="ms-about">' + (c._draft ? 'Nouvelle conversation' : esc(about(c)) + (c.page ? ' · <a href="' + esc(c.page) + '" target="_blank" rel="noopener">page</a>' : '')) + '</p></div>' +
        (c._draft ? '' : '<div class="ms-acts">' +
          '<button type="button" class="btn btn-ghost btn-sm ms-close" data-ic="check">' + (c.status === 'closed' ? 'Rouvrir' : 'Réglée') + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm ms-del" data-ic="trash">Supprimer</button>' +
        '</div>') +
      '</header>' +
      '<div class="ms-msgs" id="ms-msgs"><p class="muted">Chargement…</p></div>' +
      '<form class="ms-reply" id="ms-reply" novalidate>' +
        '<div class="ms-thumbs" hidden></div>' +
        '<div class="ms-reply-row">' +
          '<label class="btn btn-ghost ms-attach" title="Joindre des photos"><input type="file" accept="image/*" multiple hidden aria-label="Joindre des photos">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg></label>' +
          '<div class="ms-tpl"><button type="button" class="btn btn-ghost ms-tpl-btn" aria-haspopup="menu" aria-expanded="false" title="Modèles de message">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>' +
            '<span>Modèles</span></button><div class="ms-tpl-menu" role="menu" hidden></div></div>' +
          '<textarea id="ms-reply-in" rows="2" maxlength="4000" placeholder="' + (c._draft ? 'Ton message…' : 'Ta réponse…') + '" aria-label="Réponse"></textarea>' +
          '<button type="submit" class="btn btn-accent ms-send" data-ic="mail">Envoyer</button>' +
        '</div>' +
        '<span class="status" id="ms-status"></span>' +
      '</form>';
    $('.ms-back', threadEl).addEventListener('click', function () { go(''); });
    if (!c._draft) {
      $('.ms-close', threadEl).addEventListener('click', toggleClosed);
      $('.ms-del', threadEl).addEventListener('click', removeConv);
    }
    var form = $('#ms-reply', threadEl), ta = $('#ms-reply-in', form), inp = $('.ms-attach input', form);
    inp.addEventListener('change', function () { addFiles(inp.files); inp.value = ''; });
    $('.ms-thumbs', form).addEventListener('click', function (e) {
      var b = e.target.closest('.ms-thumb-x'); if (!b) return;
      var p = photos.splice(+b.getAttribute('data-i'), 1)[0];
      if (p) try { URL.revokeObjectURL(p.url); } catch (x) {}
      paintThumbs();
    });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    ta.addEventListener('input', function () { if (!ta.value.trim()) tplGrant = null; });
    tplGrant = null;
    mountTpl(form, ta);
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    if (flash) { $('#ms-status', form).textContent = flash; flash = ''; }
    paintSeen(c);
    loadThread(true);
    renderSide();
  }
  function conv() {
    if (draft && draft.id === curId) return draft;
    return convs.filter(function (c) { return c.id === curId; })[0];
  }
  function loadThread(scroll) {
    var id = curId; if (!id) return Promise.resolve();
    if (draft && draft.id === id) {
      var box0 = $('#ms-msgs', threadEl);
      if (box0 && scroll) box0.innerHTML = '<p class="ms-none">Aucun message encore.</p>';
      return Promise.resolve();
    }
    return sb.from('messages').select('*').eq('conversation_id', id).order('created_at').then(function (res) {
      if (curId !== id) return;
      var box = $('#ms-msgs', threadEl); if (!box) return;
      if (res.error) { box.innerHTML = '<p class="empty">Impossible de charger la conversation.<br>' + esc(res.error.message) + '</p>'; return; }
      var list = res.data || [];
      var same = list.length === msgs.length && (!list.length || list[list.length - 1].id === msgs[msgs.length - 1].id);
      var c = conv();
      if (c) { if (c.admin_unread > 0) markRead(c); seen(c); }
      if (same && !scroll) return;
      msgs = list;
      var paths = []; msgs.forEach(function (m) { (m.photos || []).forEach(function (p) { paths.push(p); }); });
      return signedUrls(paths).then(function () { paintThread(scroll); });
    });
  }
  function markRead(c) {   // en base : admin_msg_seen (seen) met admin_unread à 0
    c.admin_unread = 0; renderList();
    paintBadge(convs.filter(function (x) { return x.admin_unread > 0; }).length);
  }
  function paintThread(scroll) {
    var box = $('#ms-msgs', threadEl); if (!box) return;
    var near = box.scrollHeight - box.scrollTop - box.clientHeight < 80, last = '', html = '';
    msgs.forEach(function (m) {
      var d = day(m.created_at);
      if (d !== last) { html += '<p class="ms-day">' + esc(d) + '</p>'; last = d; }
      var me = m.sender === 'admin';
      html += '<div class="ms-b ' + (me ? 'me' : 'them') + '">' +
        ((m.photos || []).length ? '<div class="ms-b-photos">' + m.photos.map(function (p, i) {
          var u = urlCache[p];
          return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="Photo ' + (i + 1) + '" loading="lazy"></a>'
                   : '<span class="ms-b-ph" title="Photo indisponible"></span>';
        }).join('') + '</div>' : '') +
        (m.body ? '<p>' + esc(m.body) + '</p>' : '') +
        '<time>' + esc(hour(m.created_at)) + '</time></div>';
    });
    box.innerHTML = html || '<p class="muted">Aucun message.</p>';
    if (scroll || near) box.scrollTop = box.scrollHeight;
  }
  function signedUrls(paths) {
    var need = paths.filter(function (p) { return !urlCache[p]; });
    if (!need.length) return Promise.resolve();
    return sb.storage.from('messages').createSignedUrls(need, 3600).then(function (r) {
      (r.data || []).forEach(function (x) { if (x.signedUrl) urlCache[x.path] = x.signedUrl; });
    }, function () {});
  }

  /* ---- répondre ---- */
  function shrink(file) {
    var load = window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : Promise.reject(new Error('photo'));
    return load.then(function (bmp) {
      var k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      var cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('photo')); }, 'image/jpeg', 0.82); });
    });
  }
  function addFiles(files) {
    var st = $('#ms-status', threadEl);
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (list.length > MAX_PHOTOS - photos.length && st) st.textContent = 'Au plus ' + MAX_PHOTOS + ' photos par message.';
    list = list.slice(0, Math.max(0, MAX_PHOTOS - photos.length));
    photoJob = Promise.all([photoJob].concat(list.map(function (f) {
      return shrink(f).then(function (b) { photos.push({ blob: b, url: URL.createObjectURL(b) }); },
        function () { if (st) st.textContent = 'Format de photo non pris en charge.'; });
    }))).then(paintThumbs);
  }
  var photoJob = Promise.resolve();   // réduction des photos en cours : l'envoi l'attend
  function paintThumbs() {
    var box = $('.ms-thumbs', threadEl); if (!box) return;
    box.innerHTML = photos.map(function (p, i) {
      return '<span class="ms-thumb"><img src="' + esc(p.url) + '" alt=""><button type="button" class="ms-thumb-x" data-i="' + i + '" aria-label="Retirer la photo">×</button></span>';
    }).join('');
    box.hidden = !photos.length;
  }
  function clearPhotos() {
    photos.forEach(function (p) { try { URL.revokeObjectURL(p.url); } catch (e) {} });
    photos = []; paintThumbs();
  }
  function send() {
    var c = conv(); if (!c || busy) return;
    var ta = $('#ms-reply-in', threadEl), btn = $('.ms-send', threadEl), st = $('#ms-status', threadEl);
    busy = true; btn.disabled = true;
    photoJob.then(function () {
      var body = ta.value.trim();
      if (!body && !photos.length) { busy = false; btn.disabled = false; ta.focus(); return; }
      st.textContent = 'Envoi…';
      return sendNow(c, body, ta, btn, st);
    });
  }
  // brouillon : la conversation n'existe qu'au premier envoi ; ensuite on bascule sur elle
  function sendNow(c, body, ta, btn, st) {
    if (!c._draft) return sendTo(c, body, ta, btn, st);
    return sb.from('conversations').insert({ customer_id: c.customer_id, topic: 'compte', status: 'open' }).select('*').single()
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        var made = res.data; made.customers = c.customers;
        return sendTo(made, body, ta, btn, st).then(function () {
          if (!(draft && draft.id === curId)) return;
          if (!convs.some(function (x) { return x.id === made.id; })) convs.unshift(made);
          flash = st.textContent; draft = null; go(made.id);
        });
      }).catch(function (err) {
        busy = false; btn.disabled = false;
        st.textContent = 'Erreur : ' + ((err && err.message) || err);
      });
  }
  function sendTo(c, body, ta, btn, st) {
    return Promise.all(photos.map(function (p) {
      var path = c.customer_id + '/' + uuid() + '.jpg';
      return sb.storage.from('messages').upload(path, p.blob, { contentType: 'image/jpeg', upsert: false }).then(function (r) {
        if (r.error) throw new Error('Photo non envoyée : ' + r.error.message);
        return path;
      });
    })).then(function (paths) {
      return sb.from('messages').insert({ conversation_id: c.id, sender: 'admin', body: body, photos: paths }).select('id').single();
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      busy = false; btn.disabled = false; ta.value = ''; clearPhotos();
      var grant = tplGrant ? grantReserve(c) : Promise.resolve('');
      tplGrant = null;
      var sent = online(c) ? 'Envoyé · client en ligne' : 'Envoyé · courriel dans 5 min si non lu';
      return grant.then(function (g) { st.textContent = sent + (g ? ' · ' + g : ''); });
    }).then(function () {
      return load().then(function () { return loadThread(true); });
    }).catch(function (err) {
      busy = false; btn.disabled = false;
      st.textContent = 'Erreur : ' + ((err && err.message) || err);
    });
  }

  /* ---- modèles de message ----
     admin_settings « msg_modeles » : { list: [{ id, title, body, grant }], at } (synchro entre appareils).
     Variables remplacées au choix du modèle ; celles sans valeur restent visibles {…} à compléter.
     grant = l'envoi coche aussi « Peut réserver » (customers.can_reserve). */
  var TPL_KEY = 'msg_modeles', tpls = null, tplLoading = null;
  var VARS = ['prénom', 'nom', 'dernière commande', 'nombre de commandes'];
  var TPL_DEFAULT = [
    { id: 'reserver', title: 'Accès aux réservations', grant: true, body:
      'Bonjour {prénom},\n\n' +
      'Vous avez déjà commandé chez nous le {dernière commande}, merci de votre confiance ! ' +
      'Vous avez prouvé que vous étiez fiable : vous pouvez désormais réserver du stock directement sur le site ' +
      '(connecté à votre compte, panier → « Réserver 72 h »).\n\n' +
      'Conditions :\n' +
      '• Articles en stock seulement, gardés 72 h, sans dépôt\n' +
      '• 2 réservations non récupérées = réservations suspendues 60 jours\n\n' +
      'Au plaisir,\nCréation Audio' },
    { id: 'merci', title: 'Merci pour votre commande', grant: false, body:
      'Bonjour {prénom},\n\n' +
      'Merci pour votre commande du {dernière commande} ! Si vous avez la moindre question, écrivez-nous ici.\n\n' +
      'Création Audio' }
  ];
  function loadTpls() {
    if (tpls) return Promise.resolve(tpls);
    if (tplLoading) return tplLoading;
    tplLoading = sb.from('admin_settings').select('value').eq('key', TPL_KEY).maybeSingle().then(function (res) {
      var v = res && !res.error && res.data && res.data.value;
      tpls = v && Array.isArray(v.list) ? v.list : JSON.parse(JSON.stringify(TPL_DEFAULT));
      return tpls;
    }, function () { tpls = JSON.parse(JSON.stringify(TPL_DEFAULT)); return tpls; })
      .then(function (t) { tplLoading = null; return t; });
    return tplLoading;
  }
  function saveTpls(list) {
    var at = new Date().toISOString();
    return sb.from('admin_settings').upsert({ key: TPL_KEY, value: { list: list, at: at }, updated_at: at }).then(function (res) {
      if (res && res.error) throw new Error(res.error.message);
      tpls = list;
    });
  }
  // valeurs du client : prénom/nom + factures (fiche reliée), sans les annulées
  function custVals(c) {
    var k = c.customers || {}, name = String(k.name || '').trim();
    var vals = { 'prénom': name.split(/\s+/)[0] || '', 'nom': name };
    var acc = accounts && accounts.filter(function (a) { return a.id === c.customer_id; })[0];
    var inv = acc && acc._inv !== undefined ? Promise.resolve(acc._inv)
      : !k.client_id ? Promise.resolve(null)
      : sb.from('invoices').select('invoice_date, status').eq('client_id', k.client_id).then(function (r) {
        var list = ((!r.error && r.data) || []).filter(function (f) { return f.status !== 'cancelled'; });
        if (!list.length) return null;
        return { n: list.length, last: list.map(function (f) { return String(f.invoice_date || ''); }).sort().pop() };
      }, function () { return null; });
    return inv.then(function (s) {
      if (s && s.n) { vals['dernière commande'] = dateLong(s.last); vals['nombre de commandes'] = String(s.n); }
      return vals;
    });
  }
  function dateLong(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  }
  function fill(body, vals) {
    return String(body || '').replace(/\{([^{}]+)\}/g, function (all, v) { return vals[v.trim()] ? vals[v.trim()] : all; });
  }
  function mountTpl(form, ta) {
    var btn = $('.ms-tpl-btn', form), menu = $('.ms-tpl-menu', form);
    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); }
    function outside(e) { if (!e.target.closest || !e.target.closest('.ms-tpl')) close(); }
    btn.addEventListener('click', function () {
      if (!menu.hidden) { close(); return; }
      loadTpls().then(function (list) {
        menu.innerHTML = list.map(function (t, i) {
          return '<button type="button" class="ms-tpl-it" role="menuitem" data-i="' + i + '">' + esc(t.title || 'Sans titre') +
            (t.grant ? '<small>+ réservation</small>' : '') + '</button>';
        }).join('') + '<button type="button" class="ms-tpl-it ms-tpl-manage" role="menuitem">Gérer les modèles</button>';
        menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
        var first = $('.ms-tpl-it', menu); if (first) first.focus();
        document.addEventListener('click', outside, true);
      });
    });
    menu.addEventListener('keydown', function (e) {
      var items = $$('.ms-tpl-it', menu), i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { close(); btn.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      }
    });
    menu.addEventListener('click', function (e) {
      var it = e.target.closest('.ms-tpl-it'); if (!it) return;
      close();
      if (it.classList.contains('ms-tpl-manage')) { manageTpls(); return; }
      var t = tpls[+it.getAttribute('data-i')], c = conv(); if (!t || !c) return;
      var st = $('#ms-status', form);
      var ask = ta.value.trim() ? caDialog.confirm({ title: 'Remplacer le texte en cours ?', ok: 'Remplacer', icon: 'edit' }) : Promise.resolve(true);
      ask.then(function (ok) {
        if (!ok) return;
        return custVals(c).then(function (vals) {
          if (conv() !== c) return;
          ta.value = fill(t.body, vals);
          ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 320) + 'px';
          tplGrant = t.grant ? t : null;
          var left = ta.value.match(/\{[^{}]+\}/g);
          st.textContent = left ? 'À compléter : ' + left.join(', ') :
            t.grant ? ((c.customers || {}).can_reserve ? 'Réservation déjà active' : 'L\'envoi active la réservation') : '';
          ta.focus();
          var p = ta.value.search(/\{[^{}]+\}/);
          if (p >= 0) ta.setSelectionRange(p, ta.value.indexOf('}', p) + 1);
        });
      });
    });
  }
  function grantReserve(c) {
    var k = c.customers || {};
    if (k.can_reserve) return Promise.resolve('');
    return sb.from('customers').update({ can_reserve: true }).eq('id', c.customer_id).select('id').then(function (res) {
      if (res.error || !(res.data || []).length) return 'réservation NON activée';
      k.can_reserve = true;
      (accounts || []).forEach(function (a) { if (a.id === c.customer_id) a.can_reserve = true; });
      convs.forEach(function (x) { if (x.customer_id === c.customer_id && x.customers) x.customers.can_reserve = true; });
      return 'réservation activée';
    }, function () { return 'réservation NON activée'; });
  }

  // fenêtre « Gérer les modèles » : liste à gauche, titre + texte à droite ; enregistrée d'un bloc
  function manageTpls() {
    loadTpls().then(function (cur) {
      var list = JSON.parse(JSON.stringify(cur)), sel = list.length ? 0 : -1;
      var d = document.createElement('dialog');
      d.className = 'ca-dlg ms-tpl-dlg';
      d.setAttribute('aria-labelledby', 'ms-tpl-t');
      d.innerHTML =
        '<div class="ms-tpl-in">' +
          '<h2 class="dlg-t" id="ms-tpl-t">Modèles de message</h2>' +
          '<div class="ms-tpl-cols">' +
            '<div class="ms-tpl-side"><div class="ms-tpl-list"></div>' +
              '<button type="button" class="btn btn-ghost btn-sm ms-tpl-add" data-ic="plus">Nouveau</button></div>' +
            '<div class="ms-tpl-ed">' +
              '<label>Titre<input type="text" class="ms-tpl-title" maxlength="60"></label>' +
              '<label>Texte<textarea class="ms-tpl-body" rows="12" maxlength="4000"></textarea></label>' +
              '<div class="ms-tpl-vars">' + VARS.map(function (v) { return '<button type="button" class="ms-tpl-var" data-v="' + esc(v) + '">{' + esc(v) + '}</button>'; }).join('') + '</div>' +
              '<label class="inline ms-tpl-grant"><input type="checkbox"> Active la réservation à l\'envoi</label>' +
              '<button type="button" class="btn btn-ghost btn-sm ms-tpl-del" data-ic="trash">Supprimer ce modèle</button>' +
            '</div>' +
          '</div>' +
          '<div class="dlg-f"><span class="status ms-tpl-st"></span>' +
            '<button type="button" class="btn btn-ghost ms-tpl-cancel">Annuler</button>' +
            '<button type="button" class="btn btn-accent ms-tpl-save" data-ic="save">Enregistrer</button></div>' +
        '</div>';
      document.body.appendChild(d);
      var listBox = $('.ms-tpl-list', d), ed = $('.ms-tpl-ed', d), ti = $('.ms-tpl-title', d), bo = $('.ms-tpl-body', d),
        gr = $('.ms-tpl-grant input', d), st = $('.ms-tpl-st', d);
      function paintList() {
        listBox.innerHTML = list.length ? list.map(function (t, i) {
          return '<button type="button" class="ms-tpl-li' + (i === sel ? ' is-current' : '') + '" data-i="' + i + '">' + esc(t.title || 'Sans titre') + '</button>';
        }).join('') : '<p class="ms-sd-none">Aucun modèle.</p>';
      }
      function paintEd() {
        ed.hidden = sel < 0;
        if (sel < 0) return;
        var t = list[sel]; ti.value = t.title || ''; bo.value = t.body || ''; gr.checked = !!t.grant;
      }
      ti.addEventListener('input', function () { if (sel >= 0) { list[sel].title = ti.value; paintList(); } });
      bo.addEventListener('input', function () { if (sel >= 0) list[sel].body = bo.value; });
      gr.addEventListener('change', function () { if (sel >= 0) list[sel].grant = gr.checked; });
      listBox.addEventListener('click', function (e) { var b = e.target.closest('.ms-tpl-li'); if (!b) return; sel = +b.getAttribute('data-i'); paintList(); paintEd(); });
      $('.ms-tpl-add', d).addEventListener('click', function () {
        list.push({ id: uuid(), title: 'Nouveau modèle', body: 'Bonjour {prénom},\n\n\n\nCréation Audio', grant: false });
        sel = list.length - 1; paintList(); paintEd(); ti.focus(); ti.select();
      });
      $('.ms-tpl-del', d).addEventListener('click', function () {
        if (sel < 0) return;
        list.splice(sel, 1); sel = Math.min(sel, list.length - 1); paintList(); paintEd();
      });
      $('.ms-tpl-vars', d).addEventListener('click', function (e) {
        var b = e.target.closest('.ms-tpl-var'); if (!b || sel < 0) return;
        var tag = '{' + b.getAttribute('data-v') + '}', a = bo.selectionStart, z = bo.selectionEnd;
        bo.setRangeText(tag, a, z, 'end'); bo.focus(); list[sel].body = bo.value;
      });
      function shut() { try { d.close(); } catch (x) {} d.remove(); }
      $('.ms-tpl-cancel', d).addEventListener('click', shut);
      d.addEventListener('cancel', function (e) { e.preventDefault(); shut(); });
      $('.ms-tpl-save', d).addEventListener('click', function () {
        var b = this; b.disabled = true; st.textContent = 'Enregistrement…';
        saveTpls(list.map(function (t) { return { id: t.id || uuid(), title: String(t.title || '').trim() || 'Sans titre', body: t.body || '', grant: !!t.grant }; }))
          .then(shut, function (err) { b.disabled = false; st.textContent = 'Erreur : ' + err.message; });
      });
      paintList(); paintEd();
      d.showModal();
    });
  }

  /* ---- réglée / rouvrir, supprimer ---- */
  function toggleClosed() {
    var c = conv(); if (!c) return;
    var next = c.status === 'closed' ? 'open' : 'closed';
    sb.from('conversations').update({ status: next }).eq('id', c.id).then(function (res) {
      if (res.error) { caDialog.error(res.error); return; }
      c.status = next;
      var b = $('.ms-close', threadEl); if (b) b.textContent = next === 'closed' ? 'Rouvrir' : 'Réglée';
      renderList();
    });
  }
  function photosOf(list) {
    var out = []; (list || []).forEach(function (m) { (m.photos || []).forEach(function (p) { out.push(p); }); }); return out;
  }
  function removeConv() {
    var c = conv(); if (!c) return;
    caDialog.confirm({ title: 'Supprimer la conversation avec ' + who(c) + ' ?', message: 'Messages et photos effacés. Action définitive.',
      ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
      if (!ok) return;
      erase([c.id], photosOf(msgs)).then(function (err) {
        if (err) { caDialog.error(err); return; }
        convs = convs.filter(function (x) { return x.id !== c.id; });
        go('');
      });
    });
  }
  // photos par l'API Storage (jamais par SQL), puis les lignes
  function erase(ids, paths) {
    var rm = paths.length ? sb.storage.from('messages').remove(paths).then(null, function () {}) : Promise.resolve();
    return rm.then(function () { return sb.from('conversations').delete().in('id', ids); })
      .then(function (res) { return res && res.error ? res.error.message : null; });
  }
  // Loi 25 : 12 mois sans message -> effacée (une fois par session admin)
  function purge() {
    if (purged) return; purged = true;
    var cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
    sb.from('conversations').select('id, messages(photos)').lt('updated_at', cutoff).limit(200).then(function (res) {
      var rows = (!res.error && res.data) || [];
      if (!rows.length) return;
      var paths = []; rows.forEach(function (r) { paths = paths.concat(photosOf(r.messages)); });
      return erase(rows.map(function (r) { return r.id; }), paths).then(function () { load(); });
    }, function () {});
  }
})();
