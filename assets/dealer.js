/* =========================================================
   Création Audio — Espace Dealer
   Connexion Supabase + catalogue des spacers disponibles +
   panier avec prix dégressif (paliers) → commande Messenger.
   Nécessite : supabase-config.js, le CDN supabase-js, supabase-client.js.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var FB = 'https://m.me/61591945465745';
  var BUCKET = 'spacers';

  var loginView = $('#dl-login'), appView = $('#dl-app'), loginErr = $('#dl-err');

  if (!sb) {
    loginErr.textContent = 'Configuration Supabase manquante.';
    loginErr.className = 'dl-err show';
    return;
  }
  if (location.protocol === 'file:') {
    loginErr.textContent = 'Ouvre cette page via une adresse http(s) (le site en ligne), pas en double-cliquant le fichier : la connexion ne peut pas se maintenir en « file:// ».';
    loginErr.className = 'dl-err show';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function publicUrl(path) {
    if (!path) return '';
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
    catch (e) { return ''; }
  }
  function tiersOf(sp) {
    return (Array.isArray(sp.tiers) ? sp.tiers : [])
      .map(function (t) { return { min: parseInt(t.min, 10), price: parseFloat(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; });
  }
  // prix unitaire pour une quantité q : dernier palier atteint, sinon prix de base
  function unitPrice(sp, q) {
    var p = +sp.price || 0;
    tiersOf(sp).forEach(function (t) { if (q >= t.min) p = t.price; });
    return p;
  }

  /* ---------------- AUTH ---------------- */
  function say(msg) {
    loginErr.textContent = msg || '';
    loginErr.className = 'dl-err' + (msg ? ' show' : '');
  }
  function showApp() { loginView.hidden = true; appView.hidden = false; boot(); }
  function showLogin() { appView.hidden = true; loginView.hidden = false; }

  sb.auth.onAuthStateChange(function (event, session) { if (session) showApp(); else showLogin(); });
  sb.auth.getSession().then(function (r) { if (r.data && r.data.session) showApp(); else showLogin(); });

  $('#dl-login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    say('');
    var btn = $('#dl-login-btn'); btn.disabled = true; btn.textContent = 'Connexion…';
    sb.auth.signInWithPassword({ email: $('#dl-email').value.trim(), password: $('#dl-pass').value })
      .then(function (res) {
        btn.disabled = false; btn.textContent = 'Se connecter';
        if (res.error) {
          var raw = (res.error.message || '').toLowerCase(), msg;
          if (raw.indexOf('not confirmed') > -1) msg = 'Compte non confirmé. Contacte Création Audio.';
          else if (raw.indexOf('invalid login') > -1 || raw.indexOf('invalid credentials') > -1) msg = 'Courriel ou mot de passe incorrect.';
          else msg = 'Connexion refusée : ' + (res.error.message || 'erreur inconnue');
          say(msg); return;
        }
        if (!(res.data && res.data.session)) { say('Connexion acceptée mais aucune session reçue.'); return; }
        showApp();
      }, function (err) {
        btn.disabled = false; btn.textContent = 'Se connecter';
        say('Erreur réseau : ' + (err && err.message ? err.message : err));
      });
  });

  $('#dl-logout').addEventListener('click', function () { sb.auth.signOut().then(showLogin); });

  /* ---------------- CATALOGUE ---------------- */
  var booted = false, items = [], byId = {}, cart = {};   // cart : { id: qty }

  function boot() {
    if (booted) return; booted = true;
    initCart();
    loadCatalog();
  }

  function loadCatalog() {
    var grid = $('#dl-grid');
    grid.innerHTML = '<p class="dl-empty">Chargement…</p>';
    sb.from('spacers').select('*').eq('active', true).gt('qty', 0).order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) { grid.innerHTML = '<p class="dl-empty">Impossible de charger le catalogue.</p>'; return; }
        items = res.data || [];
        byId = {};
        items.forEach(function (i) { byId[i.id] = i; });
        renderCatalog();
      }, function () { grid.innerHTML = '<p class="dl-empty">Erreur réseau.</p>'; });
  }

  function renderCatalog() {
    var grid = $('#dl-grid');
    if (!items.length) { grid.innerHTML = '<p class="dl-empty">Aucun spacer disponible pour l\'instant.</p>'; return; }
    grid.innerHTML = items.map(function (sp) {
      var url = publicUrl(sp.image_path);
      var tiers = tiersOf(sp);
      var tierHtml = tiers.length ? '<div class="dl-tiers">' + tiers.map(function (t) {
        return '<span class="dl-tier"><span>' + t.min + '+ paires</span><span>' + money(t.price) + ' ch.</span></span>';
      }).join('') + '</div>' : '';
      return '<article class="dl-card" data-id="' + sp.id + '">' +
        '<div class="dl-thumb">' + (url ? '<img src="' + esc(url) + '" alt="' + esc(sp.name) + '">' : '<span class="dl-noimg">Pas de photo</span>') + '</div>' +
        '<div class="dl-body">' +
          '<h3 class="dl-name">' + esc(sp.name) + '</h3>' +
          '<div class="dl-price">' + money(sp.price) + ' <span class="u">/ paire</span></div>' +
          tierHtml +
          '<div class="dl-stock">' + (sp.qty | 0) + ' en stock</div>' +
          '<div class="dl-add">' +
            '<div class="dl-qty">' +
              '<button type="button" class="dl-dec" aria-label="moins">&minus;</button>' +
              '<input type="number" class="dl-q" min="1" step="1" value="1">' +
              '<button type="button" class="dl-inc" aria-label="plus">+</button>' +
            '</div>' +
            '<button type="button" class="dl-add-btn">Ajouter</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    $$('.dl-card', grid).forEach(function (card) {
      var id = +card.getAttribute('data-id'), sp = byId[id];
      var input = $('.dl-q', card);
      function clamp() { input.value = Math.min(sp.qty | 0, Math.max(1, parseInt(input.value, 10) || 1)); }
      $('.dl-dec', card).addEventListener('click', function () { input.value = Math.max(1, (parseInt(input.value, 10) || 1) - 1); });
      $('.dl-inc', card).addEventListener('click', function () { input.value = Math.min(sp.qty | 0, (parseInt(input.value, 10) || 1) + 1); });
      input.addEventListener('change', clamp);
      $('.dl-add-btn', card).addEventListener('click', function () {
        clamp();
        addToCart(id, parseInt(input.value, 10) || 1);
        openCart();
      });
    });
  }

  /* ---------------- PANIER ---------------- */
  function initCart() {
    $('#dl-cart-open').addEventListener('click', openCart);
    $('#dl-cart-close').addEventListener('click', closeCart);
    $('#dl-scrim').addEventListener('click', closeCart);
    $('#dl-messenger').addEventListener('click', messengerFlow);
    $('#dl-copy').addEventListener('click', copyOnly);
  }
  function openCart() { $('#dl-cart').classList.add('open'); $('#dl-scrim').classList.add('open'); }
  function closeCart() { $('#dl-cart').classList.remove('open'); $('#dl-scrim').classList.remove('open'); }

  function addToCart(id, qty) {
    var sp = byId[id]; if (!sp) return;
    var cap = sp.qty | 0;
    cart[id] = Math.min(cap, (cart[id] || 0) + Math.max(1, qty));
    renderCart();
  }
  function setQty(id, qty) {
    var sp = byId[id]; if (!sp) return;
    qty = Math.max(0, Math.min(sp.qty | 0, qty));
    if (qty <= 0) delete cart[id]; else cart[id] = qty;
    renderCart();
  }
  function cartCount() { return Object.keys(cart).reduce(function (n, id) { return n + cart[id]; }, 0); }
  function cartTotal() {
    return Object.keys(cart).reduce(function (s, id) {
      var sp = byId[id]; return s + cart[id] * unitPrice(sp, cart[id]);
    }, 0);
  }

  function renderCart() {
    var box = $('#dl-cart-items'), ids = Object.keys(cart);
    var badge = $('#dl-cart-count'), n = cartCount();
    badge.textContent = n; badge.hidden = n === 0;

    if (!ids.length) {
      box.innerHTML = '<p class="dl-cart-empty">Ton panier est vide.<br>Ajoute des spacers depuis le catalogue.</p>';
    } else {
      box.innerHTML = ids.map(function (id) {
        var sp = byId[id], q = cart[id], u = unitPrice(sp, q), url = publicUrl(sp.image_path);
        return '<div class="dl-citem" data-id="' + id + '">' +
          (url ? '<img class="dl-cthumb" src="' + esc(url) + '" alt="">' : '<span class="dl-cthumb"></span>') +
          '<div class="dl-cinfo">' +
            '<div class="dl-cname">' + esc(sp.name) + '</div>' +
            '<div class="dl-cunit">' + money(u) + ' / paire</div>' +
            '<div class="dl-cqty">' +
              '<button type="button" class="dl-cdec" aria-label="moins">&minus;</button>' +
              '<input type="number" class="dl-cq" min="0" step="1" value="' + q + '">' +
              '<button type="button" class="dl-cinc" aria-label="plus">+</button>' +
            '</div>' +
            '<button type="button" class="dl-crm">Retirer</button>' +
          '</div>' +
          '<div class="dl-cline">' + money(q * u) + '</div>' +
        '</div>';
      }).join('');

      $$('.dl-citem', box).forEach(function (row) {
        var id = +row.getAttribute('data-id'), input = $('.dl-cq', row);
        $('.dl-cdec', row).addEventListener('click', function () { setQty(id, (cart[id] || 0) - 1); });
        $('.dl-cinc', row).addEventListener('click', function () { setQty(id, (cart[id] || 0) + 1); });
        input.addEventListener('change', function () { setQty(id, parseInt(input.value, 10) || 0); });
        $('.dl-crm', row).addEventListener('click', function () { setQty(id, 0); });
      });
    }

    $('#dl-total-val').textContent = money(cartTotal());
    $('#dl-messenger').classList.toggle('is-disabled', n === 0);
  }

  /* ---------------- MESSENGER ---------------- */
  function orderText() {
    var lines = Object.keys(cart).map(function (id) {
      var sp = byId[id], q = cart[id], u = unitPrice(sp, q);
      return '- ' + sp.name + ' ×' + q + ' — ' + money(u) + ' ch. = ' + money(q * u);
    });
    return 'Bonjour,\n\nCommande dealer — spacers :\n\n' + lines.join('\n') +
      '\n\nTotal : ' + money(cartTotal()) +
      '\nRamassage : région de Québec.\n\nMerci !';
  }
  function copyText(txt, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done || function () {}, function () { fallbackCopy(txt, done); });
    else fallbackCopy(txt, done);
  }
  function fallbackCopy(txt, done) {
    var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); if (done) done(); } catch (e) {}
    document.body.removeChild(ta);
  }
  function messengerFlow() {
    if (cartCount() === 0) return;
    copyText(orderText());
    var b = $('#dl-messenger'); if (!b._busy) { b._busy = true; var o = b.textContent; b.textContent = 'Liste copiée ✓'; setTimeout(function () { b.textContent = o; b._busy = false; }, 2400); }
    window.open(FB, '_blank', 'noopener');
  }
  function copyOnly() {
    if (cartCount() === 0) return;
    var b = $('#dl-copy');
    copyText(orderText(), function () { var o = b.textContent; b.textContent = 'Copié ✓'; setTimeout(function () { b.textContent = o; }, 1800); });
  }
})();
