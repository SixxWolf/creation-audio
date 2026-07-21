/* =========================================================
   Création Audio — panier « bundle » (filament.html)
   - Article = code + type (refill|spool). Prix 20 / 25 $.
   - Bouton panier dans le header (haut à droite) + panneau
     latéral style « bundle » (comme Bambu Store).
   - Validation = copie de la liste + Messenger (aucun paiement
     en ligne). 100 % côté navigateur (localStorage).
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'ca_cart_v2';
  var FB = 'https://m.me/61591945465745';
  var PRICES = { refill: 20, spool: 25 };
  var TYPE_LABEL = { refill: 'Recharge', spool: 'Avec Bobine', accessory: 'Accessoire' };
  // produits « extra » (accessoires) hors catalogue de couleurs
  var EXTRAS = {
    SPOOL:   { name: 'Bobine vide réutilisable', material: 'Accessoire', price: 10,
               img: 'assets/img/spool-reusable.png' },
    SPOOLHT: { name: 'Bobine vide réutilisable haute température', material: 'Accessoire', price: 10,
               img: 'assets/img/spool-reusable-ht.png' }
  };

  var CAT = window.CA_CATALOG || [];
  var IMG = window.CA_FIL_IMG || {};
  var byCode = {};
  CAT.forEach(function (i) { byCode[i.code] = i; });

  function isExtra(code) { return !!EXTRAS[code]; }
  function meta(code) { return byCode[code] || EXTRAS[code] || { name: code, material: '' }; }
  function priceOf(code, type) { if (EXTRAS[code]) return EXTRAS[code].price; return PRICES[type] || PRICES.refill; }
  function keyOf(code, type) { return code + '|' + type; }
  function imgSrc(code) { if (EXTRAS[code]) return EXTRAS[code].img; var f = IMG[code]; return f ? 'assets/img/filament/' + f : ''; }

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) {} }
  var cart = load(); // { key: {code, type, qty} }

  function count() { var n = 0; for (var k in cart) if (cart.hasOwnProperty(k)) n += cart[k].qty; return n; }
  function subtotal() {
    var s = 0;
    for (var k in cart) if (cart.hasOwnProperty(k)) s += cart[k].qty * priceOf(cart[k].code, cart[k].type);
    return s;
  }
  function entries() {
    return Object.keys(cart).map(function (k) { return cart[k]; });
  }

  /* ---------- plafond selon l'inventaire (par type) ---------- */
  function stockFor(code, type) {
    if (EXTRAS[code]) {                 // accessoire : un seul stock (colonne qty)
      var t = window.CA && window.CA.stock;
      if (!t || t[code] == null) return Infinity;   // non géré / pas encore chargé
      var q = parseInt(t[code], 10);
      return isNaN(q) ? Infinity : q;
    }
    var s = window.CA && window.CA.stockDetail;
    if (!s || !s[code]) return Infinity;
    var v = type === 'spool' ? s[code].spool : s[code].refill;
    v = parseInt(v, 10);
    return isNaN(v) ? Infinity : v;
  }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  var toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = el('div', 'cart-toast'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------- interface ---------- */
  var btn, badge, backdrop, panel, itemsBox, subEl, totEl;

  function buildUI() {
    btn = el('button', 'cart-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Ouvrir le panier');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
      '<path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/>' +
      '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>' +
      '<span class="cart-count">0</span>';
    badge = btn.querySelector('.cart-count');

    var slot = document.getElementById('cartSlot');
    if (slot) slot.appendChild(btn); else { btn.classList.add('cart-btn-float'); document.body.appendChild(btn); }

    backdrop = el('div', 'cart-backdrop');
    panel = el('aside', 'cart-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Ma sélection');
    panel.innerHTML =
      '<div class="cart-phead"><h2>Ma sélection</h2>' +
        '<button type="button" class="cart-close" aria-label="Fermer">&times;</button></div>' +
      '<div class="cart-pitems"></div>' +
      '<div class="cart-pfoot">' +
        '<div class="cart-line"><span>Sous-total</span><span class="cart-subval"></span></div>' +
        '<div class="cart-line cart-line-total"><span>Total estimé</span><span class="cart-totval"></span></div>' +
        '<button type="button" class="cart-messenger">' +
          '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="18" height="18" style="vertical-align:-3px;margin-right:7px">' +
          '<path d="M12 2C6.5 2 2 6.14 2 11.25c0 2.88 1.42 5.45 3.65 7.14V22l3.34-1.83c.89.25 1.83.38 2.81.38 5.5 0 10-4.14 10-9.25S17.5 2 12 2Zm1.03 12.13-2.56-2.73-5 2.73 5.5-5.83 2.62 2.73 4.94-2.73-5.5 5.83Z"/></svg>' +
          'Copier ma liste &amp; écrire sur Messenger</button>' +
        '<p class="cart-msg" role="status"></p>' +
        '<div class="cart-alt">' +
          '<button type="button" class="cart-copy">Copier seulement</button>' +
          '<a class="cart-fb" href="' + FB + '" target="_blank" rel="noopener">Ouvrir Messenger</a>' +
        '</div>' +
        '<button type="button" class="cart-clear">Vider le panier</button>' +
        '<p class="cart-note">Aucun paiement en ligne — je confirme la dispo et un ramassage à Québec.</p>' +
      '</div>';

    itemsBox = panel.querySelector('.cart-pitems');
    subEl = panel.querySelector('.cart-subval');
    totEl = panel.querySelector('.cart-totval');

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    btn.addEventListener('click', open);
    backdrop.addEventListener('click', close);
    panel.querySelector('.cart-close').addEventListener('click', close);
    panel.querySelector('.cart-clear').addEventListener('click', clearCart);
    panel.querySelector('.cart-messenger').addEventListener('click', function () { messengerFlow(this); });
    panel.querySelector('.cart-copy').addEventListener('click', copyList);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('is-open')) close(); });
  }

  /* ---------- rendu ---------- */
  function render() {
    var n = count();
    badge.textContent = n;
    btn.classList.toggle('has-items', n > 0);

    // les accessoires (bobine vide) passent toujours en dernier, quel que soit
    // le moment de l'ajout ; le tri est stable donc le reste garde son ordre
    var list = entries().slice().sort(function (a, b) {
      return (isExtra(a.code) ? 1 : 0) - (isExtra(b.code) ? 1 : 0);
    });
    if (!list.length) {
      itemsBox.innerHTML = '<p class="cart-empty">Ton panier est vide.<br>Choisis une couleur et un type, puis « Ajouter au panier ».</p>';
    } else {
      itemsBox.innerHTML = '';
      list.forEach(function (it) {
        var m = meta(it.code);
        var ex = isExtra(it.code);
        var mx = stockFor(it.code, it.type);
        var lineTotal = it.qty * priceOf(it.code, it.type);
        var row = el('div', 'citem');
        row.setAttribute('data-key', keyOf(it.code, it.type));
        row.innerHTML =
          '<div class="citem-thumb"><img src="' + imgSrc(it.code) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'assets/img/spool-reusable.svg\'"></div>' +
          '<div class="citem-main">' +
            '<div class="citem-name">' + esc(m.name) + '</div>' +
            '<div class="citem-sub">' + esc(m.material) + (ex ? '' : ' · ' + it.code) + '</div>' +
            '<div class="citem-type"><span class="citem-badge ' + (ex ? 'extra' : (it.type === 'spool' ? 'is-spool' : 'refill')) + '">' + TYPE_LABEL[it.type] + '</span>' +
              '<span class="citem-unit">' + priceOf(it.code, it.type) + '&nbsp;$/u</span></div>' +
            '<div class="citem-qty">' +
              '<button type="button" class="cq-minus" aria-label="Retirer un">&minus;</button>' +
              '<input type="number" class="cq-val" min="0" ' + (isFinite(mx) ? 'max="' + mx + '" ' : '') + 'step="1" inputmode="numeric" value="' + it.qty + '">' +
              '<button type="button" class="cq-plus"' + (isFinite(mx) && it.qty >= mx ? ' disabled' : '') + ' aria-label="Ajouter un">+</button>' +
            '</div>' +
          '</div>' +
          '<div class="citem-right">' +
            '<button type="button" class="citem-del" aria-label="Supprimer">&times;</button>' +
            '<div class="citem-line">' + lineTotal + '&nbsp;$</div>' +
          '</div>';
        var k = keyOf(it.code, it.type);
        row.querySelector('.cq-minus').addEventListener('click', function () { changeQty(k, -1); });
        row.querySelector('.cq-plus').addEventListener('click', function () { changeQty(k, 1); });
        var input = row.querySelector('.cq-val');
        input.addEventListener('change', function () { setQty(k, this.value); });
        input.addEventListener('focus', function () { this.select(); });
        row.querySelector('.citem-del').addEventListener('click', function () { removeItem(k); });
        itemsBox.appendChild(row);
      });
    }

    var sub = subtotal();
    subEl.innerHTML = sub + '&nbsp;$';
    totEl.innerHTML = sub + '&nbsp;$';
    panel.querySelector('.cart-messenger').classList.toggle('is-disabled', n === 0);
    panel.querySelector('.cart-copy').classList.toggle('is-disabled', n === 0);
    panel.querySelector('.cart-fb').classList.toggle('is-disabled', n === 0);
  }

  /* ---------- mutations ---------- */
  function add(code, type, qty) {
    if (!byCode[code] && !EXTRAS[code]) return;
    type = EXTRAS[code] ? 'accessory' : ((type === 'spool') ? 'spool' : 'refill');
    qty = Math.max(1, qty | 0);
    var k = keyOf(code, type);
    var max = stockFor(code, type);
    var cur = cart[k] ? cart[k].qty : 0;
    if (cur >= max) { toast(meta(code).name + ' — maximum ' + max + ' en stock.'); pulse(); render(); return; }
    var next = Math.min(cur + qty, max);
    cart[k] = { code: code, type: type, qty: next };
    save(); render(); // le « pulse » du badge est déclenché à l'arrivée du vol (flyTo)
    toast(next + '× ' + meta(code).name + (isExtra(code) ? '' : ' — ' + TYPE_LABEL[type]) + ' ajouté.');
  }
  function changeQty(k, delta) {
    if (!cart[k]) return;
    var max = stockFor(cart[k].code, cart[k].type);
    var next = cart[k].qty + delta;
    if (next > max) { toast('Maximum ' + max + ' en stock.'); next = max; }
    cart[k].qty = next;
    if (cart[k].qty <= 0) delete cart[k];
    save(); render();
  }
  function setQty(k, val) {
    if (!cart[k]) return;
    var n = parseInt(val, 10);
    if (isNaN(n)) { render(); return; }
    var max = stockFor(cart[k].code, cart[k].type);
    if (n > max) { toast('Maximum ' + max + ' en stock.'); n = max; }
    if (n <= 0) delete cart[k]; else cart[k].qty = n;
    save(); render();
  }
  function removeItem(k) { delete cart[k]; save(); render(); }
  function clearCart() { cart = {}; save(); render(); }

  /* ---------- ouverture ---------- */
  function open() { panel.classList.add('is-open'); backdrop.classList.add('is-open'); document.body.classList.add('cart-lock'); }
  function close() { panel.classList.remove('is-open'); backdrop.classList.remove('is-open'); document.body.classList.remove('cart-lock'); }
  var pulseT;
  function pulse() { if (!btn) return; btn.classList.add('pulse'); clearTimeout(pulseT); pulseT = setTimeout(function () { btn.classList.remove('pulse'); }, 500); }

  /* ---------- animation « vol vers le panier » ---------- */
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function flyTo(src, fromRect) {
    if (!btn || !src || !fromRect) { pulse(); return; }
    if (reduceMotion) { pulse(); return; }
    var to = btn.getBoundingClientRect();
    var size = Math.max(56, Math.min(120, fromRect.width * 0.55));
    var sx = fromRect.left + fromRect.width / 2 - size / 2;
    var sy = fromRect.top + fromRect.height / 2 - size / 2;
    var fly = document.createElement('img');
    fly.className = 'cart-fly';
    fly.src = src;
    fly.alt = '';
    fly.style.width = size + 'px';
    fly.style.height = size + 'px';
    fly.style.left = sx + 'px';
    fly.style.top = sy + 'px';
    fly.style.transform = 'translate(0,0) scale(1)';
    fly.style.opacity = '1';
    document.body.appendChild(fly);
    // repli si l'image ne charge pas
    fly.onerror = function () { fly.onerror = null; fly.src = 'assets/img/spool-reusable.svg'; };
    var dx = (to.left + to.width / 2) - (sx + size / 2);
    var dy = (to.top + to.height / 2) - (sy + size / 2);
    // reflow puis lancement de la transition
    fly.getBoundingClientRect();
    requestAnimationFrame(function () {
      fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.12)';
      fly.style.opacity = '0.25';
    });
    var done = false;
    function finish() { if (done) return; done = true; if (fly.parentNode) fly.parentNode.removeChild(fly); pulse(); }
    fly.addEventListener('transitionend', finish);
    setTimeout(finish, 900);
  }

  /* ---------- stock chargé/changé : on réaligne ---------- */
  document.addEventListener('inventory-ready', function () {
    var changed = false;
    Object.keys(cart).forEach(function (k) {
      var it = cart[k]; var max = stockFor(it.code, it.type);
      if (!isFinite(max) || it.qty <= max) return;
      if (max <= 0) delete cart[k]; else cart[k].qty = max;
      changed = true;
    });
    if (changed) { save(); toast('Ton panier a été ajusté selon le stock disponible.'); }
    render();
  });

  /* ---------- sortie texte / Messenger ---------- */
  function orderText() {
    // Regroupé par matériau (ordre du catalogue) pour éviter les erreurs de bobine.
    // Les en-têtes « *** … *** » sont sans chiffre : l'analyseur de facture les ignore.
    var matOrder = [];
    CAT.forEach(function (i) { if (matOrder.indexOf(i.material) === -1) matOrder.push(i.material); });

    var groups = {}, extras = [];
    entries().forEach(function (it) {
      var m = meta(it.code);
      var label = isExtra(it.code) ? m.name : m.name + ' (' + it.code + ') — ' + TYPE_LABEL[it.type];
      var line = '- ' + label + ' ×' + it.qty + ' — ' + (it.qty * priceOf(it.code, it.type)) + ' $';
      if (isExtra(it.code)) { extras.push(line); return; }
      (groups[m.material] = groups[m.material] || []).push(line);
    });

    var blocks = [];
    function pushGroup(mat) {
      if (groups[mat] && groups[mat].length) {
        blocks.push('*** ' + String(mat).toUpperCase() + ' ***\n' + groups[mat].join('\n'));
        delete groups[mat];
      }
    }
    matOrder.forEach(pushGroup);
    Object.keys(groups).forEach(pushGroup);          // filet de sécurité
    if (extras.length) blocks.push('*** ACCESSOIRES ***\n' + extras.join('\n'));

    return 'Bonjour,\n\nJe souhaite commander le filament suivant :\n\n' +
      blocks.join('\n\n') +
      '\n\nTotal : ' + subtotal() + ' $' +
      '\nRamassage : région de Québec.\n\nMerci !';
  }
  function showMsg(kind, text) { var m = panel.querySelector('.cart-msg'); m.textContent = text; m.className = 'cart-msg show ' + (kind || ''); }

  function messengerFlow(b) {
    if (count() === 0) return;
    copyText(orderText());
    if (b && !b._busy) { b._busy = true; var orig = b.innerHTML; b.textContent = 'Liste copiée ✓'; setTimeout(function () { b.innerHTML = orig; b._busy = false; }, 2400); }
    showMsg('ok', 'Liste copiée ✓ — colle-la dans Messenger et envoie, on continue là-bas.');
    window.open(FB, '_blank', 'noopener');
  }
  function copyList() {
    if (count() === 0) return;
    var self = this;
    copyText(orderText(), function () { var o = self.textContent; self.textContent = 'Copié ✓'; setTimeout(function () { self.textContent = o; }, 1800); });
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

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- API publique + init ---------- */
  buildUI();
  render();
  window.CA = window.CA || {};
  window.CA.cart = { add: add, open: open, close: close, refresh: render, flyTo: flyTo };
})();
