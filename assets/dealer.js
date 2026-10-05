/* =========================================================
   Création Audio V2 — Portail dealer (privé)
   - Login Supabase. Le compte doit être listé dans « dealers »
     (vérifié via l'RPC is_dealer()).
   - Catalogue des spacers au PRIX DEALER + rabais quantité PAR MODÈLE,
     lu depuis la vue products_dealer (invisible aux non-dealers).
     Catalogue + fiche détaillée : spacer-catalog.js.
   - Tout est commandable, même à stock 0 (impression sur commande).
   - Panier -> « Envoyer ma commande » : enregistrée en base (RPC
     dealer_submit_order, prix recalculés côté serveur), Création Audio
     est avisé (onglet admin Commandes + courriel dealer-order-notify).
   - « Mes commandes » : statut ; modifier / annuler tant que « Envoyée ».
   Adresses : #/ catalogue · #/s/<slug> fiche · #/commandes suivi.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  var BUCKET = 'products';
  var CART_KEY = 'ca_v2_cart_dealer';
  var EDIT_KEY = 'ca_v2_dealer_edit';
  var NOTE_KEY = 'ca_v2_dealer_note';
  var MAX_QTY = 999;
  var TITLE = document.title;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = window.CASpacers.esc, money = window.CASpacers.money, tierPrice = window.CASpacers.tierPrice;
  function publicUrl(path) { if (!path || !sb) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function errMsg(e) { return (e && e.message) ? e.message : String(e || 'Erreur inconnue'); }

  var loginSec = $('#dl-login'), gateSec = $('#dl-gate'), mfaSec = $('#dl-mfa'), app = $('#dl-app'),
      mfaForm = $('#dl-mfa-form'), mfaCode = $('#dl-mfa-code'), mfaBtn = $('#dl-mfa-btn'), mfaStatus = $('#dl-mfa-status'),
      loginForm = $('#dl-login-form'), emailI = $('#dl-login-email'), passI = $('#dl-login-pass'),
      loginBtn = $('#dl-login-btn'), loginStatus = $('#dl-login-status'),
      cartBtn = $('#cart-btn'), logoutBtn = $('#logout-btn'), hello = $('#dl-hello'),
      catalogEl = $('#dl-catalog'), productEl = $('#dl-product'), ordersEl = $('#dl-orders'),
      ordersList = $('#dl-orders-list'), ordersFlash = $('#dl-orders-flash'), ordersN = $('#dl-orders-n');

  var ICON = {
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 9V3.5h12V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/></svg>'
  };

  var sc = window.CASpacers.create({
    sb: sb, mode: 'dealer',
    catalogEl: catalogEl, listEl: $('#dl-list'), productEl: productEl,
    rootLabel: 'Catalogue dealer',
    addLabel: 'Ajouter à ma commande',
    maxQty: function () { return MAX_QTY; },
    onAdd: function (p, qty, src) { addToCart(p.id, qty, src); },
    onTitle: function (p) { document.title = p ? p.name + ' — Portail dealer · Création Audio' : TITLE; },
    assureHtml: '<li>' + ICON.bolt + 'Commande enregistrée directement — Création Audio est avisé</li>' +
      '<li>' + ICON.print + 'Hors stock ? On l\'imprime sur commande</li>' +
      '<li>' + ICON.pin + 'Ramassage région de Québec · facturé à la préparation</li>',
    emptyHint: 'Un véhicule manque ? Écris-le dans la note de ta commande, on s\'en occupe.'
  });

  /* ---------- écrans ---------- */
  var me = '';   // courriel du compte connecté (filtre « Mes commandes » : l'admin voit toutes les commandes en base)
  function show(which, email) {
    loginSec.hidden = which !== 'login';
    gateSec.hidden = which !== 'gate';
    mfaSec.hidden = which !== 'mfa';
    app.hidden = which !== 'app';
    cartBtn.hidden = which !== 'app';
    logoutBtn.hidden = (which === 'login');
    if (which === 'app' && email) {
      me = String(email).toLowerCase();
      var isAdmin = me === String((window.CA && window.CA.adminEmail) || '').toLowerCase();
      hello.innerHTML = 'Connecté : <b>' + esc(email) + '</b> ' +
        (isAdmin
          ? '<span class="dl-badge is-admin">Admin · aperçu</span><span class="dl-admin-note">Tes commandes de test arrivent dans l\'onglet Commandes de l\'admin — annule-les ensuite.</span>'
          : '<span class="dl-badge">Dealer</span>');
    }
  }

  function boot() {
    if (!sb) { show('login'); loginStatus.textContent = 'Service indisponible.'; return; }
    sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) { show('login'); return; }
      afterLogin(session.user && session.user.email);
    }, function () { show('login'); });
  }

  // Compte protégé par la double authentification (ex. l'admin en aperçu) : code d'abord.
  function afterLogin(email) {
    window.CA.mfa.state().then(function (st) {
      if (st === 'challenge') { mfaCode.value = ''; mfaStatus.textContent = ''; show('mfa'); mfaCode.focus(); return; }
      checkDealer(email);
    }, function () { checkDealer(email); });
  }

  function checkDealer(email) {
    sb.rpc('is_dealer').then(function (res) {
      if (res.error) { show('gate'); return; }
      if (res.data === true) { show('app', email); load(); loadOrders(); }
      else show('gate');
    }, function () { show('gate'); });
  }

  /* ---------- connexion / déconnexion ---------- */
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = (emailI.value || '').trim(), pass = passI.value || '';
    if (!email || !pass || loginBtn.disabled) return;
    loginBtn.disabled = true; loginStatus.textContent = 'Connexion…';
    // via le portier : 5 essais puis 15 min de blocage ; compte retiré -> refusé
    window.CA.signIn(email, pass).then(function (r) {
      loginBtn.disabled = false;
      if (!r.ok) { loginStatus.textContent = r.message; return; }
      loginStatus.textContent = ''; passI.value = '';
      afterLogin(email);
    }, function (err) { loginBtn.disabled = false; loginStatus.textContent = 'Erreur : ' + errMsg(err); });
  });

  window.CA.codeInput(mfaCode, mfaForm);
  mfaForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = mfaCode.value.replace(/\D/g, '');
    if (mfaBtn.disabled) return;
    if (code.length !== 6) { mfaStatus.textContent = 'Le code a 6 chiffres.'; return; }
    mfaBtn.disabled = true; mfaStatus.textContent = 'Vérification…';
    window.CA.mfa.verify(code).then(function (r) {
      mfaBtn.disabled = false;
      if (!r.ok) { mfaStatus.textContent = r.message; mfaCode.select(); return; }
      mfaStatus.textContent = '';
      sb.auth.getSession().then(function (res) {
        var s = res && res.data && res.data.session;
        checkDealer(s && s.user && s.user.email);
      });
    }, function (err) { mfaBtn.disabled = false; mfaStatus.textContent = 'Erreur : ' + errMsg(err); });
  });

  function doLogout() { sb.auth.signOut().then(function () { passI.value = ''; closeCart(); show('login'); }); }
  logoutBtn.addEventListener('click', doLogout);
  $('#gate-logout').addEventListener('click', doLogout);
  $('#mfa-logout').addEventListener('click', doLogout);

  /* ---------- catalogue (prix dealer) ---------- */
  var spacers = [], byId = {}, loaded = false;
  function load() {
    sb.from('products_dealer').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) {
        if (res.error) { $('#dl-list').innerHTML = '<p class="empty">Impossible de charger le catalogue dealer.</p>'; return; }
        spacers = res.data || [];
        byId = {}; spacers.forEach(function (p) { byId[p.id] = p; });
        sc.setItems(spacers);
        loaded = true;
        applyRoute(); renderCart();
        if (orders.length) renderOrders();   // liens vers les fiches dans « Mes commandes »
      }, function () { $('#dl-list').innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  /* ---------- routage ---------- */
  var view = null;
  function setTab(v) {
    $$('.dl-tab').forEach(function (a) {
      var on = a.getAttribute('data-view') === v;
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function applyRoute() {
    if (!loaded) return;
    var h = location.hash || '';
    if (/^#\/commandes/.test(h)) {
      sc.hide(); ordersEl.hidden = false; setTab('orders');
      if (view !== 'orders') { window.scrollTo(0, 0); loadOrders(); }
      view = 'orders'; document.title = 'Mes commandes — Portail dealer · Création Audio';
      return;
    }
    if (view === 'orders') flash = null;   // le message « envoyée ✓ » ne sert qu'une fois
    ordersEl.hidden = true; setTab('catalog');
    var m = /^#\/s\/([^/?#]+)/.exec(h);
    view = 'catalog';
    if (m && sc.showProduct(m[1])) return;
    if (m) history.replaceState(null, '', '#/');
    sc.showCatalog();
  }
  window.addEventListener('hashchange', applyRoute);

  /* ---------- panier ---------- */
  var cart = loadJSON(CART_KEY) || {};
  var editing = loadJSON(EDIT_KEY);          // { id, number } : commande en cours de modification
  function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function saveJSON(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function saveCart() { saveJSON(CART_KEY, cart); }

  /* ---- animation « vol vers le panier » ---- */
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pulseCart() { cartBtn.classList.remove('pulse'); void cartBtn.offsetWidth; cartBtn.classList.add('pulse'); }
  function flyToCart(el) {
    if (!el || reduceMotion) { pulseCart(); return; }
    var from = el.getBoundingClientRect(), to = cartBtn.getBoundingClientRect();
    var size = Math.max(46, Math.min(110, from.width * 0.5));
    var sx = from.left + from.width / 2 - size / 2, sy = from.top + from.height / 2 - size / 2;
    var fly = document.createElement('div');
    fly.style.cssText = 'position:fixed;left:' + sx + 'px;top:' + sy + 'px;width:' + size + 'px;height:' + size +
      'px;z-index:70;pointer-events:none;box-shadow:0 8px 24px rgba(20,22,26,.28);background-size:cover;background-position:center;' +
      'transition:transform .8s cubic-bezier(.2,.7,.25,1),opacity .8s ease-in;will-change:transform,opacity;';
    if (el.tagName === 'IMG') { fly.style.backgroundImage = 'url("' + el.src + '")'; fly.style.borderRadius = '14px'; }
    else { fly.style.background = 'var(--wash-2)'; fly.style.borderRadius = '14px'; }
    document.body.appendChild(fly);
    var dx = (to.left + to.width / 2) - (sx + size / 2), dy = (to.top + to.height / 2) - (sy + size / 2);
    fly.getBoundingClientRect();
    fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.12)';
    fly.style.opacity = '0.2';
    var done = false;
    function fin() { if (done) return; done = true; if (fly.parentNode) fly.parentNode.removeChild(fly); pulseCart(); }
    fly.addEventListener('transitionend', fin); setTimeout(fin, 900);
  }

  function addToCart(id, qty, srcEl) {
    var p = byId[id]; if (!p) return;
    qty = Math.max(1, qty | 0);
    var cur = cart[id] ? cart[id].qty : 0, n = Math.min(MAX_QTY, cur + qty);
    if (srcEl) flyToCart(srcEl);
    cart[id] = { id: id, qty: n };
    saveCart(); renderCart();
    toast((qty > 1 ? qty + ' × ' : '') + p.name + ' ajouté' + (editing ? ' (modification ' + editing.number + ')' : '') + '.');
  }
  function setQty(id, v) {
    if (!cart[id]) return; var n = parseInt(v, 10); if (isNaN(n)) { renderCart(); return; }
    if (n > MAX_QTY) n = MAX_QTY;
    if (n <= 0) delete cart[id]; else cart[id].qty = n; saveCart(); renderCart();
  }
  function changeQty(id, d) { if (cart[id]) setQty(id, cart[id].qty + d); }
  function removeItem(id) { delete cart[id]; saveCart(); renderCart(); }
  function clearCart() { cart = {}; saveCart(); renderCart(); }

  function entries() { return Object.keys(cart).map(function (k) { return cart[k]; }).filter(function (it) { return byId[it.id]; }); }
  function count() { return entries().reduce(function (s, it) { return s + it.qty; }, 0); }
  function unitOf(it) { var p = byId[it.id]; return p ? tierPrice(p.sell_price, p.tiers, it.qty) : 0; }
  function lineTotal(it) { return it.qty * unitOf(it); }
  function total() { return entries().reduce(function (s, it) { return s + lineTotal(it); }, 0); }
  function stockLine(it) {
    var st = byId[it.id].qty | 0;
    if (st <= 0) return '<span class="citem-made">Sur commande</span>';
    if (it.qty <= st) return '<span class="citem-ok">En stock</span>';
    return '<span class="citem-made">' + st + ' en stock · ' + (it.qty - st) + ' sur commande</span>';
  }

  var cartPanel = $('#cart-panel'), cartBackdrop = $('#cart-backdrop'), cartItems = $('#cart-items'),
      cartCount = $('#cart-count'), cartTotal = $('#cart-total'), cartMsg = $('#cart-msg'),
      sendBtn = $('#cart-send'), noteI = $('#cart-note'), editBar = $('#cart-edit'), editNum = $('#cart-edit-num');
  var sending = false;

  try { noteI.value = localStorage.getItem(NOTE_KEY) || ''; } catch (e) {}
  noteI.addEventListener('input', function () { try { localStorage.setItem(NOTE_KEY, noteI.value); } catch (e) {} });

  function renderCart() {
    var n = count(); cartCount.textContent = n; cartBtn.classList.toggle('has-items', n > 0);
    editBar.hidden = !editing;
    if (editing) editNum.textContent = editing.number || '';
    $('#cart-title').textContent = editing ? 'Modifier ma commande' : 'Ma commande';
    if (!n) {
      cartItems.innerHTML = '<p class="cart-empty">' + (editing ? 'La commande est vide.<br>Ajoute des spacers, ou annule-la depuis « Mes commandes ».' : 'Ta commande est vide.<br>Ajoute un spacer pour commencer.') + '</p>';
    } else {
      cartItems.innerHTML = '';
      entries().forEach(function (it) {
        var p = byId[it.id];
        var url = publicUrl(p.image_path);
        var base = +p.sell_price || 0, u = unitOf(it);
        var row = document.createElement('div'); row.className = 'citem';
        row.innerHTML =
          '<a class="citem-thumb" href="' + esc(sc.hrefOf(p)) + '" aria-label="Voir ' + esc(p.name) + '">' + (url ? '<img src="' + esc(url) + '" alt="">' : '<span class="citem-sw" style="background:var(--wash)"></span>') + '</a>' +
          '<div class="citem-main">' +
            '<div class="citem-name">' + esc(p.name) + '</div>' +
            '<div class="citem-type"><span class="citem-unit">' + money(u) + ' / paire' + (u < base ? ' · <em>rabais</em>' : '') + '</span></div>' +
            '<div class="citem-stock">' + stockLine(it) + '</div>' +
            '<div class="citem-qty">' +
              '<button type="button" class="cq-minus" aria-label="Retirer une paire">&minus;</button>' +
              '<input type="number" class="cq-val" min="0" max="' + MAX_QTY + '" value="' + it.qty + '" inputmode="numeric" aria-label="Quantité (paires)">' +
              '<button type="button" class="cq-plus" aria-label="Ajouter une paire">+</button>' +
            '</div>' +
          '</div>' +
          '<div class="citem-right">' +
            '<button type="button" class="citem-del" aria-label="Retirer ' + esc(p.name) + '">&times;</button>' +
            '<div class="citem-line">' + money(lineTotal(it)) + '</div>' +
          '</div>';
        $('.citem-thumb', row).addEventListener('click', closeCart);
        $('.cq-minus', row).addEventListener('click', function () { changeQty(it.id, -1); });
        $('.cq-plus', row).addEventListener('click', function () { changeQty(it.id, 1); });
        var inp = $('.cq-val', row);
        inp.addEventListener('change', function () { setQty(it.id, this.value); });
        inp.addEventListener('focus', function () { this.select(); });
        $('.citem-del', row).addEventListener('click', function () { removeItem(it.id); });
        cartItems.appendChild(row);
      });
    }
    cartTotal.textContent = money(total());
    sendBtn.textContent = editing ? 'Enregistrer les modifications' : 'Envoyer ma commande';
    sendBtn.classList.toggle('is-disabled', n === 0 || sending);
  }

  function openCart() { cartPanel.classList.add('is-open'); cartBackdrop.hidden = false; document.body.classList.add('cart-lock'); }
  function closeCart() { cartPanel.classList.remove('is-open'); cartBackdrop.hidden = true; document.body.classList.remove('cart-lock'); }
  cartBtn.addEventListener('click', openCart);
  cartBackdrop.addEventListener('click', closeCart);
  $('#cart-close').addEventListener('click', closeCart);
  $('#cart-clear').addEventListener('click', function () {
    if (count() && !window.confirm('Vider la commande ?')) return;
    clearCart(); cartMsg.textContent = '';
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cartPanel.classList.contains('is-open')) closeCart(); });

  function stopEditing() { editing = null; saveJSON(EDIT_KEY, null); }
  function resetNote() { noteI.value = ''; saveJSON(NOTE_KEY, null); }
  $('#cart-edit-cancel').addEventListener('click', function () {
    if (!window.confirm('Abandonner la modification ? La commande ' + (editing ? editing.number : '') + ' reste telle qu\'envoyée.')) return;
    stopEditing(); clearCart(); resetNote(); cartMsg.textContent = '';
  });

  /* ---------- envoi ---------- */
  function notify(orderId, event) {
    if (!sb.functions || !orderId) return;
    try {
      sb.functions.invoke('dealer-order-notify', { body: { order_id: orderId, event: event } })
        .then(function (r) { if (r && r.error) console.warn('[dealer] avis courriel :', r.error.message || r.error); }, function () {});
    } catch (e) {}
  }
  sendBtn.addEventListener('click', function () {
    if (sending || !count()) return;
    var lines = entries().map(function (it) { return { product_id: it.id, qty: it.qty }; });
    var note = (noteI.value || '').trim();
    var wasEditing = editing;
    sending = true; renderCart();
    cartMsg.className = 'cart-msg'; cartMsg.textContent = wasEditing ? 'Enregistrement…' : 'Envoi de la commande…';
    var call = wasEditing
      ? sb.rpc('dealer_update_order', { p_id: wasEditing.id, p_lines: lines, p_note: note || null })
      : sb.rpc('dealer_submit_order', { p_lines: lines, p_note: note || null });
    call.then(function (res) {
      if (res.error) throw res.error;
      var o = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!o || !o.id) throw new Error('Réponse inattendue du serveur.');
      sending = false;
      notify(o.id, wasEditing ? 'updated' : 'new');
      stopEditing(); clearCart(); resetNote(); cartMsg.textContent = '';
      closeCart();
      flash = { id: o.id, text: (wasEditing ? 'Commande ' + o.number + ' mise à jour ✓' : 'Commande ' + o.number + ' envoyée ✓') +
        ' — Création Audio est avisé. Total dealer : ' + money(o.total) + ' (hors taxes).' };
      if (/^#\/commandes/.test(location.hash)) loadOrders(); else location.hash = '#/commandes';
    }).then(null, function (err) {
      sending = false;
      var m = errMsg(err);
      if (/PGRST202|could not find the function/i.test(((err && err.code) || '') + ' ' + m)) m = 'Le système de commande n\'est pas encore activé. Écris-nous en attendant.';
      if (wasEditing && /préparation|annulée|introuvable/i.test(m)) {
        m += ' Tes changements restent dans le panier : tu peux les envoyer comme nouvelle commande.';
        stopEditing();
      }
      renderCart();
      cartMsg.className = 'cart-msg is-bad';
      cartMsg.textContent = m;
    });
  });

  /* ---------- mes commandes ---------- */
  var STATUS = {
    'new':       { label: 'Envoyée', hint: 'Reçue par Création Audio — modifiable tant que la préparation n\'a pas commencé.' },
    'preparing': { label: 'En préparation', hint: 'On prépare / imprime ta commande.' },
    'ready':     { label: 'Prête à ramasser', hint: 'Ta commande t\'attend.' },
    'invoiced':  { label: 'Facturée', hint: '' },
    'cancelled': { label: 'Annulée', hint: '' }
  };
  var orders = [], flash = null, ordersLoading = false;
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(iso || '').slice(0, 10); }
  }
  function loadOrders() {
    if (ordersLoading) return;
    ordersLoading = true;
    sb.from('dealer_orders').select('*, dealer_order_lines(*)').eq('dealer_email', me).order('created_at', { ascending: false }).limit(60)
      .then(function (res) {
        ordersLoading = false;
        if (res.error) {
          ordersList.innerHTML = '<p class="empty">Impossible de charger tes commandes.</p>';
          return;
        }
        orders = res.data || [];
        renderOrders();
      }, function () { ordersLoading = false; ordersList.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }
  function renderOrders() {
    var active = orders.filter(function (o) { return o.status === 'new' || o.status === 'preparing' || o.status === 'ready'; }).length;
    ordersN.textContent = active; ordersN.hidden = !active;
    ordersFlash.innerHTML = flash ? '<div class="dl-flash">' + esc(flash.text) + '</div>' : '';
    if (!orders.length) {
      ordersList.innerHTML = '<p class="empty">Aucune commande pour l\'instant.<br><a href="#/">Parcourir le catalogue</a></p>';
      return;
    }
    ordersList.innerHTML = orders.map(function (o) {
      var st = STATUS[o.status] || { label: o.status, hint: '' };
      var lines = (o.dealer_order_lines || []).slice().sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      var pairs = lines.reduce(function (s, l) { return s + (l.qty | 0); }, 0);
      var isNew = o.status === 'new';
      return '<article class="dl-order is-' + esc(o.status) + (flash && flash.id === o.id ? ' is-flash' : '') + '" data-id="' + esc(o.id) + '">' +
        '<header class="dl-order-head">' +
          '<div class="dl-order-id"><b>' + esc(o.number) + '</b><span>' + esc(fmtDate(o.created_at)) + (o.edited_at ? ' · modifiée' : '') + '</span></div>' +
          '<span class="dl-status is-' + esc(o.status) + '">' + esc(st.label) + '</span>' +
        '</header>' +
        (st.hint ? '<p class="dl-order-hint">' + esc(st.hint) + '</p>' : '') +
        '<div class="dl-order-lines">' + lines.map(function (l) {
          var p = l.product_id ? byId[l.product_id] : null;
          return '<div class="dl-ol">' +
            (p ? '<a class="dl-ol-n" href="' + esc(sc.hrefOf(p)) + '">' + esc(l.name) + '</a>' : '<span class="dl-ol-n">' + esc(l.name) + '</span>') +
            '<span class="dl-ol-q">× ' + (l.qty | 0) + '</span>' +
            '<span class="dl-ol-u">' + money(l.unit_price) + '</span>' +
            '<span class="dl-ol-t">' + money(l.line_total) + '</span></div>';
        }).join('') + '</div>' +
        (o.note ? '<p class="dl-order-note"><b>Ta note :</b> ' + esc(o.note) + '</p>' : '') +
        '<footer class="dl-order-foot">' +
          '<span class="dl-order-total">' + plural(pairs, 'paire', 'paires') + ' · <b>' + money(o.total) + '</b> <small>hors taxes</small></span>' +
          (isNew ? '<span class="dl-order-actions">' +
            '<button type="button" class="dl-btn js-edit">Modifier</button>' +
            '<button type="button" class="dl-btn is-danger js-cancel">Annuler</button></span>' : '') +
        '</footer>' +
      '</article>';
    }).join('');
    $$('.dl-order', ordersList).forEach(function (el) {
      var o = orders.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
      var ed = $('.js-edit', el), ca = $('.js-cancel', el);
      if (ed) ed.addEventListener('click', function () { editOrder(o); });
      if (ca) ca.addEventListener('click', function () { cancelOrder(o, ca); });
    });
  }
  function editOrder(o) {
    if (editing && editing.id === o.id) { openCart(); return; }
    if (count() && !window.confirm(editing ? 'Abandonner la modification de ' + editing.number + ' ?' :
        'Ta commande en cours (non envoyée) sera remplacée par ' + o.number + '. Continuer ?')) return;
    var missing = [];
    cart = {};
    (o.dealer_order_lines || []).forEach(function (l) {
      if (l.product_id && byId[l.product_id]) cart[l.product_id] = { id: l.product_id, qty: (cart[l.product_id] ? cart[l.product_id].qty : 0) + (l.qty | 0) };
      else missing.push(l.name);
    });
    editing = { id: o.id, number: o.number };
    saveJSON(EDIT_KEY, editing); saveCart();
    noteI.value = o.note || ''; try { localStorage.setItem(NOTE_KEY, noteI.value); } catch (e) {}
    cartMsg.className = 'cart-msg';
    cartMsg.textContent = missing.length ? 'Plus offert, retiré : ' + missing.join(', ') + '.' : '';
    renderCart(); openCart();
  }
  function cancelOrder(o, btn) {
    if (!window.confirm('Annuler la commande ' + o.number + ' ?')) return;
    btn.disabled = true;
    sb.rpc('dealer_cancel_order', { p_id: o.id }).then(function (res) {
      if (res.error) throw res.error;
      if (editing && editing.id === o.id) { stopEditing(); renderCart(); }
      notify(o.id, 'cancelled');
      flash = { id: o.id, text: 'Commande ' + o.number + ' annulée.' };
      loadOrders();
    }).then(null, function (err) { btn.disabled = false; window.alert(errMsg(err)); loadOrders(); });
  }

  var toastEl = $('#toast'), toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; requestAnimationFrame(function () { toastEl.classList.add('show'); }); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2400); }

  /* ---------- stock + statuts à jour : au retour sur l'onglet + toutes les 60 s ---------- */
  var lastRefresh = Date.now(), refreshing = false;
  function focusedIn(el) { var a = document.activeElement; return !!(el && a && a !== document.body && el.contains(a)); }
  function refresh() {
    if (!sb || app.hidden || refreshing || !loaded) return;
    refreshing = true; lastRefresh = Date.now();
    sb.from('products_dealer').select('id,qty').then(function (res) {
      refreshing = false;
      if (!res || res.error || !res.data) return;
      var changed = false;
      res.data.forEach(function (r) { var p = byId[r.id]; if (p && (p.qty | 0) !== (r.qty | 0)) { p.qty = r.qty; changed = true; } });
      if (!changed) return;
      if (!focusedIn(catalogEl) && !focusedIn(productEl)) sc.refresh();
      if (!focusedIn(cartItems)) renderCart();
    }, function () { refreshing = false; });
    if (view === 'orders') loadOrders();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 5000) refresh();
  });
  window.addEventListener('focus', function () { if (Date.now() - lastRefresh > 5000) refresh(); });
  setInterval(function () { if (document.visibilityState === 'visible') refresh(); }, 60000);

  boot();
})();
