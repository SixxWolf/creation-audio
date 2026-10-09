/* =========================================================
   Création Audio V2 — page publique Spacers
   Lit products_public (type='spacer'). Catalogue (recherche véhicule +
   puces de taille) et fiche détaillée : voir spacer-catalog.js.
   Adresses : spacers.html (catalogue) · spacer/<slug>.html (vraie page par
   spacer, générée par tools/build-spacer-pages.js : <body data-spacer>,
   window.CA_SPACER_PAGES = slugs publiés) · repli spacers.html#/s/<slug>
   pour un spacer dont la page n'est pas encore générée.
   Panier -> commande par Messenger / courriel (aucun paiement en ligne),
   plafonné au stock (le public ne commande pas sur demande).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  var FB = window.CASpacers.CONTACT.messenger;
  var EMAIL = window.CASpacers.CONTACT.email;
  var BUCKET = 'products';
  var CART_KEY = 'ca_v2_cart_spacers';
  var TITLE = document.title;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = window.CASpacers.esc, money = window.CASpacers.money;
  function publicUrl(path) { if (!path || !sb) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }

  // page générée d'un spacer (spacer/<slug>.html) ou catalogue (spacers.html)
  var PAGE = document.body.getAttribute('data-spacer') || '';
  var PAGES = {};
  (window.CA_SPACER_PAGES || []).forEach(function (s) { PAGES[s] = 1; });
  var JUMP = 'ca_sp_jump';   // anti-boucle : page annoncée mais absente (404 -> spacers.html#/s/…)
  if (PAGE) { try { sessionStorage.removeItem(JUMP); } catch (e) {} }
  // lien d'une fiche : sa vraie page si publiée ; sinon la fiche du catalogue (même règle dans le générateur)
  function pageHref(s) {
    if (PAGES[s]) return (PAGE ? '' : 'spacer/') + s + '.html';
    return PAGE ? '../spacers.html#/s/' + encodeURIComponent(s) : null;
  }

  var catalogEl = $('#sp-catalog'), productEl = $('#sp-product'), PUB = window.CASpacers.PUBLIC;
  var sc = window.CASpacers.create({
    sb: sb, mode: 'public',
    catalogEl: catalogEl, listEl: $('#sp-list'), productEl: productEl,
    pageHref: pageHref, rootHref: PAGE ? '../spacers.html' : '#/',
    addLabel: PUB.addLabel, assureHtml: PUB.assureHtml, emptyHint: PUB.emptyHint,
    maxQty: function (p) { return canBackorder() ? BO_MAX : (p.qty | 0); },
    backorder: canBackorder,
    onAdd: function (p, qty, src) { addToCart(p.id, qty, src); },
    // page générée : on garde son titre (référencement) ; catalogue : titre de la fiche ouverte
    onTitle: function (p) { if (!PAGE) document.title = p ? p.name + ' — Spacers · Création Audio' : TITLE; }
  });

  var spacers = [], byId = {}, loaded = false;
  function load() {
    if (!sb) { $('#sp-list').innerHTML = '<p class="empty">Boutique momentanément indisponible.</p>'; return; }
    sb.from('products_public').select('*').eq('type', 'spacer')
      .order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) {
        if (res.error) { $('#sp-list').innerHTML = '<p class="empty">Impossible de charger les spacers.</p>'; return; }
        spacers = res.data || [];
        byId = {}; spacers.forEach(function (p) { byId[p.id] = p; });
        sc.setItems(spacers);
        loaded = true;
        applyRoute(); renderCart();
        if (canBackorder() && window.CA.custOrder.editing()) openCart();
      }, function () { $('#sp-list').innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  /* ---- routage : #/ catalogue · #/s/<slug> fiche (ou sa vraie page) ---- */
  function applyRoute() {
    if (!loaded) return;
    if (PAGE) {
      if (!sc.showProduct(PAGE)) location.replace('../spacers.html');   // spacer retiré ou masqué depuis
      return;
    }
    var m = /^#\/s\/([^/?#]+)/.exec(location.hash || '');
    var p = m ? sc.findBySlug(m[1]) : null;
    if (p && jumpToPage(sc.slugOf(p))) return;
    if (m && sc.showProduct(m[1])) return;
    if (m) history.replaceState(null, '', '#/');   // fiche introuvable (retiré, renommé) -> catalogue
    sc.showCatalog();
  }
  // ancien lien #/s/<slug> (ou n° de la pièce d'origine) -> vraie page, une seule fois par slug
  function jumpToPage(s) {
    if (!PAGES[s]) return false;
    var href = 'spacer/' + s + '.html';
    try {
      if (sessionStorage.getItem(JUMP) === s) { sessionStorage.removeItem(JUMP); return false; }
      sessionStorage.setItem(JUMP, s);
    } catch (e) {}
    location.replace(href);
    return true;
  }
  if (!PAGE) window.addEventListener('hashchange', applyRoute);

  /* ---- client connecté (Mon compte, commande-client.js) : commande au-delà du stock ---- */
  var BO_MAX = 99;
  function canBackorder() { return !!(window.CA && window.CA.custOrder && window.CA.custOrder.signedIn()); }
  function maxFor(p) { return canBackorder() ? BO_MAX : (p ? (p.qty | 0) : 0); }

  /* ---- panier ---- */
  var cart = loadCart();
  function loadCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; } }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} }

  function addToCart(id, qty, srcEl) {
    var p = byId[id]; if (!p) return;
    var max = maxFor(p), cur = cart[id] ? cart[id].qty : 0;
    qty = Math.max(1, qty | 0);
    if (cur >= max) { toast('Maximum ' + max + ' en stock.'); return; }
    var n = Math.min(max, cur + qty);
    if (srcEl) flyToCart(srcEl);
    cart[id] = { id: id, qty: n };
    saveCart(); renderCart();
    toast(n - cur < qty ? 'Quantité limitée au stock (' + max + ').' : (qty > 1 ? qty + ' × ' : '') + p.name + ' ajouté au panier.');
  }
  function changeQty(id, d) {
    if (!cart[id]) return; var p = byId[id], max = p ? maxFor(p) : cart[id].qty; var n = cart[id].qty + d;
    if (n > max) { toast('Maximum ' + max + ' en stock.'); n = max; }
    if (n <= 0) delete cart[id]; else cart[id].qty = n; saveCart(); renderCart();
  }
  function setQty(id, v) {
    if (!cart[id]) return; var n = parseInt(v, 10); if (isNaN(n)) { renderCart(); return; }
    var p = byId[id], max = p ? maxFor(p) : n; if (n > max) { toast('Maximum ' + max + ' en stock.'); n = max; }
    if (n <= 0) delete cart[id]; else cart[id].qty = n; saveCart(); renderCart();
  }
  function removeItem(id) { delete cart[id]; saveCart(); renderCart(); }
  function clearCart() { cart = {}; saveCart(); renderCart(); }

  function entries() { return Object.keys(cart).map(function (k) { return cart[k]; }); }
  function count() { return entries().reduce(function (s, it) { return s + it.qty; }, 0); }
  function unitOf(it) { var p = byId[it.id]; return p ? (+p.sell_price || 0) : 0; }
  function lineTotal(it) { return it.qty * unitOf(it); }
  function total() { return entries().reduce(function (s, it) { return s + lineTotal(it); }, 0); }

  var cartBtn = $('#cart-btn'), cartCount = $('#cart-count'), cartPanel = $('#cart-panel'),
      cartBackdrop = $('#cart-backdrop'), cartItems = $('#cart-items'), cartTotal = $('#cart-total'),
      cartMsg = $('#cart-msg'), orderBtn = $('#cart-order'), emailBtn = $('#cart-email');

  /* ---- animation « vol vers le panier » (comme la page filaments) ---- */
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

  function renderCart() {
    var n = count(); cartCount.textContent = n; cartBtn.classList.toggle('has-items', n > 0);
    if (!n) { cartItems.innerHTML = '<p class="cart-empty">Ton panier est vide.<br>Ajoute un spacer pour commencer.</p>'; }
    else {
      cartItems.innerHTML = '';
      entries().forEach(function (it) {
        var p = byId[it.id]; if (!p) return;
        var url = publicUrl(p.image_path), max = maxFor(p), boN = canBackorder() ? it.qty - Math.max(0, p.qty | 0) : 0;
        var row = document.createElement('div'); row.className = 'citem';
        row.innerHTML =
          '<a class="citem-thumb" href="' + esc(sc.hrefOf(p)) + '" aria-label="Voir ' + esc(p.name) + '">' + (url ? '<img src="' + esc(url) + '" alt="">' : '<span class="citem-sw" style="background:var(--wash)"></span>') + '</a>' +
          '<div class="citem-main">' +
            '<div class="citem-name">' + esc(p.name) + '</div>' +
            '<div class="citem-type"><span class="citem-unit">' + money(unitOf(it)) + ' / paire</span>' +
              (boN > 0 ? ' · <span class="citem-bo">' + boN + ' à commander</span>' : '') + '</div>' +
            '<div class="citem-qty">' +
              '<button type="button" class="cq-minus" aria-label="Retirer un">&minus;</button>' +
              '<input type="number" class="cq-val" min="0" max="' + max + '" value="' + it.qty + '" inputmode="numeric" aria-label="Quantité">' +
              '<button type="button" class="cq-plus" aria-label="Ajouter un"' + (it.qty >= max ? ' disabled' : '') + '>+</button>' +
            '</div>' +
          '</div>' +
          '<div class="citem-right">' +
            '<button type="button" class="citem-del" aria-label="Supprimer">&times;</button>' +
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
    orderBtn.classList.toggle('is-disabled', n === 0);
    if (emailBtn) emailBtn.classList.toggle('is-disabled', n === 0);
    refreshAcctUi();
  }

  function openCart() { cartPanel.classList.add('is-open'); cartBackdrop.hidden = false; document.body.classList.add('cart-lock'); }
  function closeCart() { cartPanel.classList.remove('is-open'); cartBackdrop.hidden = true; document.body.classList.remove('cart-lock'); }
  cartBtn.addEventListener('click', openCart);
  cartBackdrop.addEventListener('click', closeCart);
  $('#cart-close').addEventListener('click', closeCart);
  $('#cart-clear').addEventListener('click', clearCart);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cartPanel.classList.contains('is-open')) closeCart(); });

  function orderText() {
    var lines = entries().map(function (it) { var p = byId[it.id]; return '- ' + (p ? p.name : it.id) + ' ×' + it.qty + ' paire' + (it.qty > 1 ? 's' : '') + ' — ' + money(lineTotal(it)); });
    return 'Bonjour,\n\nJe souhaite commander les spacers suivants :\n\n' + lines.join('\n') +
      '\n\nTotal estimé : ' + money(total()) + '\nRamassage : région de Québec.\n\nMerci !';
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt).catch(function () { fallbackCopy(txt); });
    fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
  }
  orderBtn.addEventListener('click', function () {
    if (count() === 0) return;
    copyText(orderText());
    cartMsg.textContent = 'Liste copiée ✓ — colle-la dans Messenger et envoie.';
    window.open(FB, '_blank', 'noopener');
  });
  if (emailBtn) emailBtn.addEventListener('click', function () {
    if (count() === 0) return;
    var subject = 'Commande spacers — Création Audio';
    window.location.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(orderText());
    cartMsg.textContent = 'Ton logiciel de courriel s\'ouvre avec ta liste.';
  });

  /* ---- commande en ligne (client connecté) : même logique que la boutique ---- */
  var acctBox = $('#cart-acct'), sendBtn = $('#cart-send'), noteIn = $('#cart-note-in'),
      editBar = $('#cart-editbar'), editNum = $('#cart-edit-num'), editCancel = $('#cart-edit-cancel'), loginP = $('#cart-login');
  function refreshAcctUi() {
    var on = canBackorder(), ed = on ? window.CA.custOrder.editing() : null;
    if (acctBox) acctBox.hidden = !on;
    if (loginP) loginP.hidden = on;
    orderBtn.classList.toggle('cart-email', on);
    if (editBar) { editBar.hidden = !ed; if (ed && editNum) editNum.textContent = ed.number; }
    if (sendBtn) {
      sendBtn.textContent = ed ? 'Enregistrer les modifications' : 'Envoyer ma commande';
      sendBtn.classList.toggle('is-disabled', count() === 0);
    }
  }
  if (sendBtn) sendBtn.addEventListener('click', function () {
    if (!count() || sendBtn.disabled) return;
    var lines = entries().map(function (it) { return { product_id: it.id, kind: 'unit', qty: it.qty }; });
    sendBtn.disabled = true; cartMsg.textContent = 'Envoi…';
    window.CA.custOrder.send(lines, noteIn ? noteIn.value.trim() : '').then(function (r) {
      sendBtn.disabled = false;
      cart = {}; saveCart(); if (noteIn) noteIn.value = '';
      renderCart();
      cartMsg.innerHTML = '✓ Commande <b>' + esc(r.number) + '</b> ' + (r.updated ? 'modifiée' : 'envoyée') +
        (r.has_backorder ? ' · certains spacers sont à commander (délai).' : '.') +
        ' Confirmation par courriel. <a href="' + (PAGE ? '../' : '') + 'compte.html#/commandes">Mes commandes</a>';
    }, function (err) { sendBtn.disabled = false; cartMsg.textContent = (err && err.message) || 'Envoi impossible. Réessaie.'; });
  });
  if (editCancel) editCancel.addEventListener('click', function () {
    window.CA.custOrder.cancelEdit();
    cart = {}; saveCart(); renderCart();
    cartMsg.textContent = 'Modification annulée : ta commande reste telle quelle.';
  });

  var toastEl = $('#toast'), toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; requestAnimationFrame(function () { toastEl.classList.add('show'); }); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2400); }

  /* ---- stock toujours à jour (même logique que la page filaments) :
     relecture légère des quantités au retour sur l'onglet + toutes les 60 s ---- */
  var lastRefresh = Date.now(), refreshing = false;
  function focusedIn(el) { var a = document.activeElement; return !!(el && a && a !== document.body && el.contains(a)); }
  function refreshStock() {
    if (!sb || refreshing || !spacers.length) return;
    refreshing = true; lastRefresh = Date.now();
    sb.from('products_public').select('id,qty').eq('type', 'spacer').then(function (res) {
      refreshing = false;
      if (!res || res.error || !res.data) return;
      var changed = false;
      res.data.forEach(function (r) {
        var p = byId[r.id];
        if (p && (p.qty | 0) !== (r.qty | 0)) { p.qty = r.qty; changed = true; }
      });
      if (!changed) return;
      var trimmed = [];
      if (!canBackorder()) Object.keys(cart).forEach(function (id) {
        var p = byId[id], max = p ? (p.qty | 0) : 0;
        if (p && cart[id].qty > max) { trimmed.push(p.name); if (max <= 0) delete cart[id]; else cart[id].qty = max; }
      });
      if (trimmed.length) { saveCart(); toast('Stock mis à jour : ' + trimmed.join(', ') + ' — quantité ajustée dans ton panier.'); }
      if (!focusedIn(catalogEl) && !focusedIn(productEl)) sc.refresh();
      if (trimmed.length || !focusedIn(cartItems)) renderCart();
    }, function () { refreshing = false; });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 5000) refreshStock();
  });
  window.addEventListener('focus', function () { if (Date.now() - lastRefresh > 5000) refreshStock(); });
  setInterval(function () { if (document.visibilityState === 'visible') refreshStock(); }, 60000);

  load();
})();
