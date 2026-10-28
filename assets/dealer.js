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
  var _t = window.CA.t, EN = window.CA.lang === 'en';
  function plural(n, one, many) { return n + ' ' + _t((EN ? n !== 1 : n > 1) ? many : one); }
  function errMsg(e) { return (e && e.message) ? _t(e.message) : String(e || _t('Erreur inconnue')); }

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
    rootLabel: _t('Catalogue dealer'),
    addLabel: _t('Ajouter à ma commande'),
    maxQty: function () { return MAX_QTY; },
    onAdd: function (p, qty, src) { addToCart(p.id, qty, src); },
    onTitle: function (p) { document.title = p ? p.name + _t(' — Portail dealer · Création Audio') : TITLE; },
    assureHtml: '<li>' + ICON.bolt + _t('Commande enregistrée directement — Création Audio est avisé</li>') +
      '<li>' + ICON.print + _t('Hors stock ? On l\'imprime sur commande</li>') +
      '<li>' + ICON.pin + _t('Ramassage région de Québec · facturé à la préparation</li>'),
    emptyHint: _t('Un véhicule manque ? Écris-le dans la note de ta commande, on s\'en occupe.')
  });

  /* ---------- écrans ---------- */
  var me = '';   // courriel du compte connecté (filtre « Mes commandes » : l'admin voit toutes les commandes en base)
  function show(which, email) {
    loginSec.hidden = which !== 'login';
    gateSec.hidden = which !== 'gate';
    mfaSec.hidden = which !== 'mfa';
    app.hidden = which !== 'app';
    cartBtn.hidden = which !== 'app';
    document.body.classList.toggle('dl-in', which === 'app');
    if (which !== 'app') mbar.hidden = true;
    logoutBtn.hidden = (which === 'login');
    if (which === 'app' && email) {
      me = String(email).toLowerCase();
      var isAdmin = me === String((window.CA && window.CA.adminEmail) || '').toLowerCase();
      hello.innerHTML = _t('Connecté : <b>') + esc(email) + '</b> ' +
        (isAdmin
          ? _t('<span class="dl-badge is-admin">Admin · aperçu</span><span class="dl-admin-note">Tes commandes de test arrivent dans l\'onglet Commandes de l\'admin — annule-les ensuite.</span>')
          : _t('<span class="dl-badge">Dealer</span>'));
    }
  }

  // fond choisi dans l'admin (Réglages › Apparence) ; le cache évite le saut de couleur au prochain chargement
  function loadTheme() {
    sb.rpc('public_dealer_theme').then(function (res) {
      if (res.error) return;
      var h = res.data && res.data.bg;
      if (window.caDealerBg) window.caDealerBg(h);
      saveJSON('ca-dealer-bg', null);
      try { if (h) localStorage.setItem('ca-dealer-bg', h); } catch (e) {}
    }, function () {});
  }

  function boot() {
    if (!sb) { show('login'); loginStatus.textContent = 'Service indisponible.'; return; }
    loadTheme();
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
    loginBtn.disabled = true; loginStatus.textContent = _t('Connexion…');
    // via le portier : 5 essais puis 15 min de blocage ; compte retiré -> refusé
    window.CA.signIn(email, pass).then(function (r) {
      loginBtn.disabled = false;
      if (!r.ok) { loginStatus.textContent = r.message; return; }
      loginStatus.textContent = ''; passI.value = '';
      afterLogin(email);
    }, function (err) { loginBtn.disabled = false; loginStatus.textContent = _t('Erreur : ') + errMsg(err); });
  });

  window.CA.codeInput(mfaCode, mfaForm);
  mfaForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = mfaCode.value.replace(/\D/g, '');
    if (mfaBtn.disabled) return;
    if (code.length !== 6) { mfaStatus.textContent = _t('Le code a 6 chiffres.'); return; }
    mfaBtn.disabled = true; mfaStatus.textContent = _t('Vérification…');
    window.CA.mfa.verify(code).then(function (r) {
      mfaBtn.disabled = false;
      if (!r.ok) { mfaStatus.textContent = r.message; mfaCode.select(); return; }
      mfaStatus.textContent = '';
      sb.auth.getSession().then(function (res) {
        var s = res && res.data && res.data.session;
        checkDealer(s && s.user && s.user.email);
      });
    }, function (err) { mfaBtn.disabled = false; mfaStatus.textContent = _t('Erreur : ') + errMsg(err); });
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
        if (res.error) { $('#dl-list').innerHTML = _t('<p class="empty">Impossible de charger le catalogue dealer.</p>'); return; }
        spacers = res.data || [];
        byId = {}; spacers.forEach(function (p) { byId[p.id] = p; });
        sc.setItems(spacers);
        loaded = true;
        applyRoute(); renderCart();
        if (orders.length) renderOrders();   // liens vers les fiches dans « Mes commandes »
      }, function () { $('#dl-list').innerHTML = _t('<p class="empty">Erreur réseau.</p>'); });
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
      view = 'orders'; document.title = _t('Mes commandes — Portail dealer · Création Audio');
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
  // cible : le panneau collé à droite (grand écran) ou le bouton panier / la barre du bas
  function cartTarget() { return docked() ? $('.cart-phead', cartPanel) : (!mbar.hidden ? mbar : cartBtn); }
  function pulseCart() { var t = cartTarget(); t.classList.remove('pulse'); void t.offsetWidth; t.classList.add('pulse'); }
  function flyToCart(el) {
    if (!el || reduceMotion) { pulseCart(); return; }
    var from = el.getBoundingClientRect(), to = cartTarget().getBoundingClientRect();
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
    toast((qty > 1 ? qty + ' × ' : '') + p.name + _t(' ajouté') + (editing ? _t(' (modification ') + editing.number + ')' : '') + '.');
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
    if (st <= 0) return _t('<span class="citem-made">Sur commande</span>');
    if (it.qty <= st) return _t('<span class="citem-ok">En stock</span>');
    return '<span class="citem-made">' + st + _t(' en stock · ') + (it.qty - st) + _t(' sur commande</span>');
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
    $('#cart-title').textContent = editing ? _t('Modifier ma commande') : _t('Ma commande');
    if (!n) {
      cartItems.innerHTML = '<p class="cart-empty">' + (editing ? _t('La commande est vide.<br>Ajoute des spacers, ou annule-la depuis « Mes commandes ».') : _t('Ta commande est vide.<br>Ajoute un spacer pour commencer.')) + '</p>';
    } else {
      cartItems.innerHTML = '';
      entries().forEach(function (it) {
        var p = byId[it.id];
        var url = publicUrl(p.image_path);
        var base = +p.sell_price || 0, u = unitOf(it);
        var row = document.createElement('div'); row.className = 'citem';
        row.innerHTML =
          '<a class="citem-thumb" href="' + esc(sc.hrefOf(p)) + _t('" aria-label="Voir ') + esc(p.name) + '">' + (url ? '<img src="' + esc(url) + '" alt="">' : '<span class="citem-sw" style="background:var(--wash)"></span>') + '</a>' +
          '<div class="citem-main">' +
            '<div class="citem-name">' + esc(p.name) + '</div>' +
            '<div class="citem-type"><span class="citem-unit">' + money(u) + _t(' / paire') + (u < base ? _t(' · <em>rabais</em>') : '') + '</span></div>' +
            '<div class="citem-stock">' + stockLine(it) + '</div>' +
            '<div class="citem-qty">' +
              _t('<button type="button" class="cq-minus" aria-label="Retirer une paire">&minus;</button>') +
              '<input type="number" class="cq-val" min="0" max="' + MAX_QTY + '" value="' + it.qty + _t('" inputmode="numeric" aria-label="Quantité (paires)">') +
              _t('<button type="button" class="cq-plus" aria-label="Ajouter une paire">+</button>') +
            '</div>' +
          '</div>' +
          '<div class="citem-right">' +
            _t('<button type="button" class="citem-del" aria-label="Retirer ') + esc(p.name) + '">&times;</button>' +
            '<div class="citem-line">' + money(lineTotal(it)) + '</div>' +
          '</div>' + tierBarHtml(p, it.qty);
        row.setAttribute('data-id', it.id);
        var up = $('.tb-up', row);
        if (up) up.addEventListener('click', function () { changeQty(it.id, +up.getAttribute('data-add')); });
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
    animateTiers();
    cartTotal.textContent = money(total());
    sendBtn.textContent = editing ? _t('Enregistrer les modifications') : _t('Envoyer ma commande');
    sendBtn.classList.toggle('is-disabled', n === 0 || sending);
    renderMbar(n);
    if (typeof fitPanel === 'function') fitPanel();
  }

  /* ---- barre de rabais par modèle : jalons = paliers, « +N → −X % » complète le suivant ---- */
  function tierInfo(p, qty) {
    var base = +p.sell_price || 0;
    var tiers = window.CASpacers.normalizeTiers(p.tiers).filter(function (t) { return t.min > 1 && t.price < base; });
    if (!tiers.length || !base) return null;
    var reached = -1;
    tiers.forEach(function (t, i) { if (qty >= t.min) reached = i; });
    var max = tiers[tiers.length - 1].min;
    return { tiers: tiers, reached: reached, next: tiers[reached + 1] || null, max: max,
      fill: Math.min(qty / max, 1) * 100, pct: function (t) { return Math.round((1 - t.price / base) * 100); } };
  }
  function tierBarHtml(p, qty) {
    var ti = tierInfo(p, qty); if (!ti) return '';
    var marks = '', labels = '';
    ti.tiers.forEach(function (t, i) {
      var at = t.min / ti.max * 100, on = i <= ti.reached ? ' is-on' : '';
      marks += '<i class="tb-mark' + on + '" style="left:' + at + '%"></i>';
      labels += '<span class="tb-lbl' + on + '" style="left:' + at + '%"><b>' + t.min + '</b>−' + ti.pct(t) + ' %</span>';
    });
    var foot = ti.next
      ? '<button type="button" class="tb-up" data-add="' + (ti.next.min - qty) + '" aria-label="' +
          esc(_t('Ajouter ') + plural(ti.next.min - qty, 'paire', 'paires') + _t(' pour ') + '−' + ti.pct(ti.next) + ' %') + '">+' +
          (ti.next.min - qty) + ' → −' + ti.pct(ti.next) + ' %</button>'
      : '<span class="tb-max">' + _t('Meilleur prix ✓') + '</span>';
    return '<div class="citem-tiers" data-fill="' + ti.fill + '" data-reached="' + ti.reached + '">' +
      '<div class="tb-track"><span class="tb-fill"></span>' + marks + '</div>' +
      '<div class="tb-lbls">' + labels + '</div>' + foot + '</div>';
  }
  var tierPrev = {};   // id -> { fill, reached } du rendu précédent : la barre glisse, le jalon atteint s'allume
  function animateTiers() {
    var now = {};
    $$('.citem', cartItems).forEach(function (row) {
      var id = row.getAttribute('data-id'), box = $('.citem-tiers', row); if (!box) return;
      var fill = +box.getAttribute('data-fill'), reached = +box.getAttribute('data-reached'), prev = tierPrev[id];
      var bar = $('.tb-fill', box);
      now[id] = { fill: fill, reached: reached };
      if (reduceMotion) { bar.style.width = fill + '%'; return; }
      bar.style.width = (prev ? prev.fill : 0) + '%';
      bar.getBoundingClientRect();
      bar.style.width = fill + '%';
      if (prev && reached > prev.reached) {
        var mk = $$('.tb-mark', box)[reached], lb = $$('.tb-lbl', box)[reached], un = $('.citem-unit', row);
        [mk, lb, un].forEach(function (el) { if (el) el.classList.add('is-pop'); });
      }
    });
    tierPrev = now;
  }

  /* ---- barre du bas (sous 1200 px) : nombre de paires, palier le plus proche, total ---- */
  function renderMbar(n) {
    if (!document.body.classList.contains('dl-in')) return;
    mbar.hidden = !n;
    document.body.classList.toggle('dl-mbar-on', !!n);
    if (!n) return;
    var best = null;
    entries().forEach(function (it) {
      var ti = tierInfo(byId[it.id], it.qty);
      if (ti && ti.next && (!best || ti.next.min - it.qty < best.left)) best = { name: byId[it.id].name, left: ti.next.min - it.qty, pct: ti.pct(ti.next) };
    });
    $('#dl-mbar-n').textContent = plural(n, 'paire', 'paires');
    $('#dl-mbar-hint').textContent = best ? best.name + ' : +' + best.left + ' → −' + best.pct + ' %' : '';
    $('#dl-mbar-total').textContent = money(total());
  }

  var mbar = $('#dl-mbar');
  var dockMQ = window.matchMedia ? window.matchMedia('(min-width:1200px)') : null;
  function docked() { return !!(dockMQ && dockMQ.matches); }
  function onDockChange() { if (docked()) { cartBackdrop.hidden = true; document.body.classList.remove('cart-lock'); cartPanel.classList.remove('is-open'); } }
  if (dockMQ) { if (dockMQ.addEventListener) dockMQ.addEventListener('change', onDockChange); else if (dockMQ.addListener) dockMQ.addListener(onDockChange); }
  mbar.addEventListener('click', function () { openCart(); });

  function openCart() { if (docked()) { pulseCart(); return; } cartPanel.classList.add('is-open'); cartBackdrop.hidden = false; document.body.classList.add('cart-lock'); }
  function closeCart() { cartPanel.classList.remove('is-open'); cartBackdrop.hidden = true; document.body.classList.remove('cart-lock'); }
  cartBtn.addEventListener('click', openCart);
  cartBackdrop.addEventListener('click', closeCart);
  $('#cart-close').addEventListener('click', closeCart);
  $('#cart-clear').addEventListener('click', function () {
    function empty() { clearCart(); cartMsg.textContent = ''; }
    if (!count()) { empty(); return; }
    caDialog.confirm({ title: _t('Vider la commande ?'), message: _t('Les articles ajoutés seront retirés.'), ok: _t('Vider'), danger: true, icon: 'trash' })
      .then(function (ok) { if (ok) empty(); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cartPanel.classList.contains('is-open')) closeCart(); });

  function stopEditing() { editing = null; saveJSON(EDIT_KEY, null); }
  function resetNote() { noteI.value = ''; saveJSON(NOTE_KEY, null); }
  $('#cart-edit-cancel').addEventListener('click', function () {
    caDialog.confirm({ title: _t('Abandonner la modification ?'), message: _t('La commande ') + (editing ? editing.number : '') + _t(' reste telle qu\'envoyée.'),
      ok: _t('Abandonner'), danger: true }).then(function (ok) {
      if (!ok) return;
      stopEditing(); clearCart(); resetNote(); cartMsg.textContent = '';
    });
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
    cartMsg.className = 'cart-msg'; cartMsg.textContent = wasEditing ? _t('Enregistrement…') : _t('Envoi de la commande…');
    var call = wasEditing
      ? sb.rpc('dealer_update_order', { p_id: wasEditing.id, p_lines: lines, p_note: note || null })
      : sb.rpc('dealer_submit_order', { p_lines: lines, p_note: note || null });
    call.then(function (res) {
      if (res.error) throw res.error;
      var o = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!o || !o.id) throw new Error(_t('Réponse inattendue du serveur.'));
      sending = false;
      notify(o.id, wasEditing ? 'updated' : 'new');
      stopEditing(); clearCart(); resetNote(); cartMsg.textContent = '';
      closeCart();
      flash = { id: o.id, text: (wasEditing ? _t('Commande ') + o.number + _t(' mise à jour ✓') : _t('Commande ') + o.number + _t(' envoyée ✓')) +
        _t(' — Création Audio est avisé. Total dealer : ') + money(o.total) + _t(' (hors taxes).') };
      if (/^#\/commandes/.test(location.hash)) loadOrders(); else location.hash = '#/commandes';
    }).then(null, function (err) {
      sending = false;
      var m = errMsg(err);
      if (/PGRST202|could not find the function/i.test(((err && err.code) || '') + ' ' + m)) m = _t('Le système de commande n\'est pas encore activé. Écris-nous en attendant.');
      if (wasEditing && /préparation|annulée|introuvable/i.test(m)) {
        m += _t(' Tes changements restent dans le panier : tu peux les envoyer comme nouvelle commande.');
        stopEditing();
      }
      renderCart();
      cartMsg.className = 'cart-msg is-bad';
      cartMsg.textContent = m;
    });
  });

  /* ---------- mes commandes ---------- */
  var STATUS = {
    'new':       { label: _t('Envoyée'), hint: _t('Reçue par Création Audio — modifiable tant que la préparation n\'a pas commencé.') },
    'preparing': { label: _t('En préparation'), hint: _t('On prépare / imprime ta commande.') },
    'ready':     { label: _t('Prête à ramasser'), hint: _t('Ta commande t\'attend.') },
    'invoiced':  { label: _t('Facturée'), hint: '' },
    'cancelled': { label: _t('Annulée'), hint: '' }
  };
  var orders = [], flash = null, ordersLoading = false;
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString(window.CA.locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(iso || '').slice(0, 10); }
  }
  function loadOrders() {
    if (ordersLoading) return;
    ordersLoading = true;
    sb.from('dealer_orders').select('*, dealer_order_lines(*)').eq('dealer_email', me).order('created_at', { ascending: false }).limit(60)
      .then(function (res) {
        ordersLoading = false;
        if (res.error) {
          ordersList.innerHTML = _t('<p class="empty">Impossible de charger tes commandes.</p>');
          return;
        }
        orders = res.data || [];
        renderOrders();
      }, function () { ordersLoading = false; ordersList.innerHTML = _t('<p class="empty">Erreur réseau.</p>'); });
  }
  function renderOrders() {
    var active = orders.filter(function (o) { return o.status === 'new' || o.status === 'preparing' || o.status === 'ready'; }).length;
    ordersN.textContent = active; ordersN.hidden = !active;
    ordersFlash.innerHTML = flash ? '<div class="dl-flash">' + esc(flash.text) + '</div>' : '';
    if (!orders.length) {
      ordersList.innerHTML = '<div class="dl-empty">' +
        '<span class="dl-empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg></span>' +
        '<h2>' + _t('Aucune commande') + '</h2>' +
        '<p>' + _t('Tes commandes s\'afficheront ici.') + '</p>' +
        '<a class="dl-btn is-primary" href="#/">' + _t('Voir le catalogue') + ' →</a></div>';
      return;
    }
    var live = orders.filter(function (o) { return STEPS.indexOf(o.status) > -1 && o.status !== 'invoiced'; }),
        past = orders.filter(function (o) { return live.indexOf(o) < 0; });
    ordersList.innerHTML =
      (live.length ? '<h2 class="dl-sec">' + _t('En cours') + ' <span>' + live.length + '</span></h2>' +
        '<div class="dl-orders-grp">' + live.map(function (o) { return orderHtml(o, false); }).join('') + '</div>' : '') +
      (past.length ? '<h2 class="dl-sec">' + _t('Historique') + '</h2>' +
        '<div class="dl-orders-grp is-past">' + past.map(function (o) { return orderHtml(o, true); }).join('') + '</div>' : '');
    $$('.dl-order', ordersList).forEach(function (el) {
      var o = orders.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
      var ed = $('.js-edit', el), ca = $('.js-cancel', el);
      if (ed) ed.addEventListener('click', function () { editOrder(o); });
      if (ca) ca.addEventListener('click', function () { cancelOrder(o, ca); });
      $$('.js-doc', el).forEach(function (b) {
        b.addEventListener('click', function () { printDoc(o, b); });
      });
    });
  }
  // suivi Envoyée → Préparation → Prête → Facturée (étape actuelle allumée)
  var STEPS = ['new', 'preparing', 'ready', 'invoiced'];
  function stepsHtml(status) {
    var at = STEPS.indexOf(status),
        names = [_t('Envoyée'), _t('Préparation'), _t('Prête'), _t('Facturée')];
    return '<ol class="dl-steps">' + names.map(function (n, i) {
      return '<li class="' + (i < at ? 'is-done' : i === at ? 'is-on' : '') + '"' + (i === at ? ' aria-current="step"' : '') + '>' + n + '</li>';
    }).join('') + '</ol>';
  }
  // carte d'une commande ; past = ligne compacte dépliable (Historique)
  function orderHtml(o, past) {
      var st = o.status === 'invoiced' && o.paid_at ? { label: _t('Payée') } : (STATUS[o.status] || { label: o.status });
      var lines = (o.dealer_order_lines || []).slice().sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      var pairs = lines.reduce(function (s, l) { return s + (l.qty | 0); }, 0);
      var isNew = o.status === 'new';
      var cls = 'dl-order is-' + esc(o.status) + (flash && flash.id === o.id ? ' is-flash' : '');
      var meta = (o.created_by === 'admin' ? _t(' · ajoutée par Création Audio') : '') + (o.edited_at ? _t(' · modifiée') : '');
      var total = '<span class="dl-order-total"><b>' + money(o.total) + '</b><small>' + plural(pairs, 'paire', 'paires') + _t(' · hors taxes') + '</small></span>';
      var pill = '<span class="dl-status is-' + (o.paid_at && o.status === 'invoiced' ? 'paid' : esc(o.status)) + '">' + esc(st.label) + '</span>';
      var head = past
        ? '<summary class="dl-order-head">' +
            '<span class="dl-order-id"><b>' + esc(o.number) + '</b><span>' + esc(fmtDay(o.created_at)) + '</span></span>' +
            pill + '<span class="dl-order-sum">' + money(o.total) + '</span><span class="dl-chev" aria-hidden="true"></span>' +
          '</summary><div class="dl-order-body">'
        : '<header class="dl-order-head">' +
            '<div class="dl-order-id"><b>' + esc(o.number) + '</b><span>' + esc(fmtDate(o.created_at)) + meta + '</span></div>' + total +
          '</header>' + stepsHtml(o.status);
      return (past ? '<details class="' + cls + '" data-id="' + esc(o.id) + '">' : '<article class="' + cls + '" data-id="' + esc(o.id) + '">') + head +
        '<div class="dl-order-lines">' + lines.map(function (l) {
          var p = l.product_id ? byId[l.product_id] : null;
          var iu = p && p.image_path ? publicUrl(p.image_path) : '';
          return '<div class="dl-ol">' +
            '<span class="dl-ol-img">' + (iu ? '<img src="' + esc(iu) + '" alt="" loading="lazy">' : '') + '</span>' +
            (p ? '<a class="dl-ol-n" href="' + esc(sc.hrefOf(p)) + '">' + esc(l.name) + '</a>' : '<span class="dl-ol-n">' + esc(l.name) + '</span>') +
            '<span class="dl-ol-q">× ' + (l.qty | 0) + '</span>' +
            '<span class="dl-ol-u">' + money(l.unit_price) + '</span>' +
            '<span class="dl-ol-t">' + money(l.line_total) + '</span></div>';
        }).join('') + '</div>' +
        (o.note ? '<p class="dl-order-note"><b>' + (o.created_by === 'admin' ? _t('Note') : _t('Ta note')) + ' :</b> ' + esc(o.note) + '</p>' : '') +
        (past && meta ? '<p class="dl-order-meta">' + esc(fmtDate(o.created_at)) + meta + '</p>' : '') +
        (!past && !isNew ? '' : '<footer class="dl-order-foot">' +
          (past ? total : '<span></span>') +
          (isNew ? '<span class="dl-order-actions">' +
            _t('<button type="button" class="dl-btn js-edit">Modifier</button>') +
            _t('<button type="button" class="dl-btn is-danger js-cancel">Annuler</button></span>') : '') +
          (o.status === 'invoiced' && o.invoice_id ? '<span class="dl-order-actions">' +
            _t('<button type="button" class="dl-btn js-doc" data-kind="invoice">Facture</button>') +
            (o.paid_at ? _t('<button type="button" class="dl-btn js-doc" data-kind="receipt">Reçu</button>') : _t('<span class="dl-order-unpaid">Paiement à venir</span>')) +
            '</span>' : '') +
        '</footer>') +
      (past ? '</div></details>' : '</article>');
  }
  function fmtDay(iso) {
    try { return new Date(iso).toLocaleDateString(window.CA.locale, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return String(iso || '').slice(0, 10); }
  }
  // facture / reçu : relu à chaque clic (le reçu n'existe qu'une fois le virement confirmé)
  function printDoc(o, btn) {
    var kind = btn.getAttribute('data-kind');
    btn.disabled = true;
    sb.rpc('dealer_order_docs', { p_id: o.id }).then(function (res) {
      btn.disabled = false;
      if (res.error || !res.data) throw res.error || new Error(_t('Document introuvable.'));
      if (kind === 'receipt' && !res.data.paid_at) { caDialog.alert({ message: _t('Le reçu sera disponible une fois ton virement confirmé.') }); loadOrders(); return; }
      window.CA.docPrint(kind, res.data);
    }).then(null, function (err) { btn.disabled = false; caDialog.error(errMsg(err), _t('Impression impossible')); });
  }
  function editOrder(o) {
    if (editing && editing.id === o.id) { openCart(); return; }
    if (!count()) { load(); return; }
    caDialog.confirm(editing
      ? { title: _t('Abandonner la modification de ') + editing.number + ' ?', message: _t('Les changements non envoyés seront perdus.'), ok: _t('Abandonner'), danger: true }
      : { title: _t('Remplacer ta commande en cours ?'), message: _t('Ta commande non envoyée sera remplacée par ') + o.number + '.', ok: _t('Remplacer'), icon: 'cart' })
      .then(function (ok) { if (ok) load(); });
    function load() {
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
      cartMsg.textContent = missing.length ? _t('Plus offert, retiré : ') + missing.join(', ') + '.' : '';
      renderCart(); openCart();
    }
  }
  function cancelOrder(o, btn) {
    caDialog.confirm({ title: _t('Annuler la commande ') + o.number + ' ?', ok: _t('Annuler la commande'), danger: true }).then(function (ok) {
      if (!ok) return;
      btn.disabled = true;
      sb.rpc('dealer_cancel_order', { p_id: o.id }).then(function (res) {
        if (res.error) throw res.error;
        if (editing && editing.id === o.id) { stopEditing(); renderCart(); }
        notify(o.id, 'cancelled');
        flash = { id: o.id, text: _t('Commande ') + o.number + _t(' annulée.') };
        loadOrders();
      }).then(null, function (err) { btn.disabled = false; caDialog.error(errMsg(err), _t('Annulation impossible')); loadOrders(); });
    });
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

  // panneau collé : sa hauteur suit la commande mais s'arrête au bas de l'écran, où qu'il soit (bandeau visible ou non)
  function fitPanel() {
    if (!docked() || app.hidden) { cartPanel.style.maxHeight = ''; return; }
    cartPanel.style.maxHeight = Math.max(320, window.innerHeight - cartPanel.getBoundingClientRect().top - 18) + 'px';
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      fitPanel(); ticking = false;
    });
  }, { passive: true });
  window.addEventListener('resize', fitPanel);

  // panneau collé (grand écran) : simple région, pas une fenêtre modale
  function syncDockA11y() {
    if (docked()) { cartPanel.setAttribute('role', 'region'); cartPanel.removeAttribute('aria-modal'); }
    else { cartPanel.setAttribute('role', 'dialog'); cartPanel.setAttribute('aria-modal', 'true'); }
  }
  syncDockA11y();
  if (dockMQ) { if (dockMQ.addEventListener) dockMQ.addEventListener('change', syncDockA11y); else if (dockMQ.addListener) dockMQ.addListener(syncDockA11y); }

  boot();
})();
