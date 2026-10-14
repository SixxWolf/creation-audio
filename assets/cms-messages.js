/* =========================================================
   Création Audio — CMS Messages (messagerie du site public)
   Conversations envoyées par le panneau « Écris-nous » (assets/messagerie.js) :
   tables conversations + messages (RLS admin), photos dans le bucket privé
   « messages » (URL signées).
   - Liste (Ouvertes / Réglées / Toutes) + fil de la conversation (#messages/<id>).
   - Ouvrir une conversation = lue (admin_unread = 0).
   - Répondre (texte + photos, Ctrl+Entrée) -> Edge Function message-notify :
     courriel au client (1 par série de réponses non lues).
   - Marquer réglée / rouvrir ; Supprimer (photos effacées par l'API Storage).
   - Filtre « Comptes » : tous les comptes clients (customers) + recherche ; un clic
     ouvre sa conversation ouverte, sinon un brouillon (#messages/c-<customer_id>) :
     la conversation (sujet « Mon compte ») n'est créée qu'au premier envoi.
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
  var accounts = null, accQ = '', draft = null, flash = '';   // filtre Comptes ; brouillon = conversation pas encore créée

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
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (tabOpen) { load(); if (curId && !busy) loadThread(false); } else refreshBadge();
  }, 20000);

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
        (k.phone ? '<small>' + esc(k.phone) + '</small>' : '') + '</div></div>' +
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
    pending = sb.from('conversations').select('*, customers(name, email, phone, client_id)')
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
    return sb.from('customers').select('id, name, email, phone, client_id, created_at')
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
    var needle = accQ.trim().toLowerCase(), digits = needle.replace(/\D/g, '');
    var rows = accounts.filter(function (k) {
      if (!needle) return true;
      return [k.name, k.email].join(' ').toLowerCase().indexOf(needle) !== -1 ||
        (digits.length >= 3 && String(k.phone || '').replace(/\D/g, '').indexOf(digits) !== -1);
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
          '<span class="ms-row-prev">' + esc([k.name ? k.email : '', k.phone].filter(Boolean).join(' · ')) + '</span>' +
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
      return '<button type="button" class="ms-row' + (un ? ' is-unread' : '') + (c.id === curId ? ' is-current' : '') + '" data-id="' + esc(c.id) + '">' +
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
        '<div class="ms-head-tx"><h2>' + esc(who(c)) + '</h2>' +
          '<p class="person-meta">' + (k.email ? '<a class="pm pm-mail" href="mailto:' + esc(k.email) + '">' + esc(k.email) + '</a>' : '') +
            (k.phone ? '<a class="pm pm-tel" href="tel:' + esc(String(k.phone).replace(/[^\d+]/g, '')) + '">' + esc(k.phone) + '</a>' : '') + '</p>' +
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
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    if (flash) { $('#ms-status', form).textContent = flash; flash = ''; }
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
      if (c && c.admin_unread > 0) markRead(c);
      if (same && !scroll) return;
      msgs = list;
      var paths = []; msgs.forEach(function (m) { (m.photos || []).forEach(function (p) { paths.push(p); }); });
      return signedUrls(paths).then(function () { paintThread(scroll); });
    });
  }
  function markRead(c) {
    c.admin_unread = 0; renderList();
    paintBadge(convs.filter(function (x) { return x.admin_unread > 0; }).length);
    sb.from('conversations').update({ admin_unread: 0 }).eq('id', c.id).then(null, function () {});
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
      return sb.functions.invoke('message-notify', { body: { message_id: res.data.id } }).then(function (r) {
        var d = (r && r.data) || {};
        st.textContent = d.result === 'sent' ? 'Envoyé · client avisé par courriel' : 'Envoyé';
      }, function () { st.textContent = 'Envoyé · avis courriel non parti'; });
    }).then(function () {
      return load().then(function () { return loadThread(true); });
    }).catch(function (err) {
      busy = false; btn.disabled = false;
      st.textContent = 'Erreur : ' + ((err && err.message) || err);
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
