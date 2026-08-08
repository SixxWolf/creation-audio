/* =========================================================
   Création Audio V2 — page publique Spacers
   Lit products_public (type='spacer'). Grille + panier ->
   commande par Messenger (aucun paiement en ligne).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  var FB = 'https://m.me/61591945465745';
  var EMAIL = 'contact@creationaudio.ca';
  var BUCKET = 'products';
  var CART_KEY = 'ca_v2_cart_spacers';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function publicUrl(path) { if (!path || !sb) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function normalizeTiers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return { min: parseInt(t.min, 10), price: parseFloat(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; });
  }
  function tierPrice(base, tiers, qty) { var p = +base || 0; normalizeTiers(tiers).forEach(function (t) { if (qty >= t.min) p = t.price; }); return p; }
  // « 1 paire » (prix de base) + tous les paliers, même format, exactement comme dans l'admin
  function priceRows(sell, tiers) {
    var rows = [{ min: 1, price: +sell || 0 }].concat(normalizeTiers(tiers).filter(function (t) { return t.min > 1; }));
    return rows.map(function (t, i) {
      var label = t.min === 1 ? '1 paire' : (t.min + '+ paires');
      return '<div class="sp-pr' + (i === 0 ? ' base' : '') + '">' + label + ' : ' + money(t.price) + '</div>';
    }).join('');
  }

  var spacers = [], byId = {};
  var grid = $('#spacers-grid');

  function load() {
    if (!sb) { grid.innerHTML = '<p class="empty">Boutique momentanément indisponible.</p>'; return; }
    sb.from('products_public').select('*').eq('type', 'spacer')
      .order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) {
        if (res.error) { grid.innerHTML = '<p class="empty">Impossible de charger les spacers.</p>'; return; }
        spacers = res.data || [];
        byId = {}; spacers.forEach(function (p) { byId[p.id] = p; });
        render(); renderCart();
      }, function () { grid.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  function render() {
    if (!spacers.length) { grid.innerHTML = '<p class="empty">Aucun spacer disponible pour le moment.</p>'; return; }
    grid.innerHTML = spacers.map(function (p) {
      var url = publicUrl(p.image_path), out = (p.qty | 0) <= 0, q = p.qty | 0;
      var desc = p.attrs && p.attrs.description ? p.attrs.description : '';
      return '<article class="sp-card">' +
        '<div class="mat-media">' +
          (url ? '<img src="' + esc(url) + '" alt="' + esc(p.name) + '" loading="lazy">' : '<span class="mat-swatch" style="background:var(--wash)"></span>') +
          (out ? '<span class="col-badge">Rupture</span>' : '') +
        '</div>' +
        '<div class="sp-body">' +
          '<h3>' + esc(p.name) + '</h3>' +
          '<div class="sp-stock' + (out ? ' out' : '') + '">' + (out ? 'Rupture de stock' : (q + ' paire' + (q > 1 ? 's' : '') + ' en stock')) + '</div>' +
          (desc ? '<p class="sp-desc">' + esc(desc) + '</p>' : '') +
          '<div class="sp-prices">' + priceRows(p.sell_price, p.tiers) + '</div>' +
          '<button class="add-btn sp-add" type="button" data-id="' + esc(p.id) + '"' + (out ? ' disabled' : '') + '>' +
            (out ? 'Rupture de stock' : 'Ajouter au panier') + '</button>' +
        '</div>' +
      '</article>';
    }).join('');
    $$('.sp-add', grid).forEach(function (b) {
      b.addEventListener('click', function () {
        var card = b.closest ? b.closest('.sp-card') : null;
        var src = card ? (card.querySelector('.mat-media img') || card.querySelector('.mat-swatch')) : null;
        addToCart(b.getAttribute('data-id'), src || b);
      });
    });
  }

  /* ---- panier ---- */
  var cart = loadCart();
  function loadCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; } }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} }

  function addToCart(id, srcEl) {
    var p = byId[id]; if (!p) return;
    var max = p.qty | 0, cur = cart[id] ? cart[id].qty : 0;
    if (cur >= max) { toast('Maximum ' + max + ' en stock.'); return; }
    if (srcEl) flyToCart(srcEl);
    cart[id] = { id: id, qty: cur + 1 };
    saveCart(); renderCart(); toast(p.name + ' ajouté au panier.');
  }
  function changeQty(id, d) {
    if (!cart[id]) return; var p = byId[id], max = p ? (p.qty | 0) : cart[id].qty; var n = cart[id].qty + d;
    if (n > max) { toast('Maximum ' + max + ' en stock.'); n = max; }
    if (n <= 0) delete cart[id]; else cart[id].qty = n; saveCart(); renderCart();
  }
  function setQty(id, v) {
    if (!cart[id]) return; var n = parseInt(v, 10); if (isNaN(n)) { renderCart(); return; }
    var p = byId[id], max = p ? (p.qty | 0) : n; if (n > max) { toast('Maximum ' + max + ' en stock.'); n = max; }
    if (n <= 0) delete cart[id]; else cart[id].qty = n; saveCart(); renderCart();
  }
  function removeItem(id) { delete cart[id]; saveCart(); renderCart(); }
  function clearCart() { cart = {}; saveCart(); renderCart(); }

  function entries() { return Object.keys(cart).map(function (k) { return cart[k]; }); }
  function count() { return entries().reduce(function (s, it) { return s + it.qty; }, 0); }
  function unitOf(it) { var p = byId[it.id]; return p ? tierPrice(p.sell_price, p.tiers, it.qty) : 0; }
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
    else { fly.style.background = el.style.background || getComputedStyle(el).backgroundColor; fly.style.borderRadius = '50%'; }
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
        var url = publicUrl(p.image_path), max = p.qty | 0;
        var row = document.createElement('div'); row.className = 'citem';
        row.innerHTML =
          '<div class="citem-thumb">' + (url ? '<img src="' + esc(url) + '" alt="">' : '<span class="citem-sw" style="background:var(--wash)"></span>') + '</div>' +
          '<div class="citem-main">' +
            '<div class="citem-name">' + esc(p.name) + '</div>' +
            '<div class="citem-type"><span class="citem-unit">' + money(unitOf(it)) + ' / paire</span></div>' +
            '<div class="citem-qty">' +
              '<button type="button" class="cq-minus" aria-label="Retirer un">&minus;</button>' +
              '<input type="number" class="cq-val" min="0" max="' + max + '" value="' + it.qty + '" inputmode="numeric">' +
              '<button type="button" class="cq-plus" aria-label="Ajouter un"' + (it.qty >= max ? ' disabled' : '') + '>+</button>' +
            '</div>' +
          '</div>' +
          '<div class="citem-right">' +
            '<button type="button" class="citem-del" aria-label="Supprimer">&times;</button>' +
            '<div class="citem-line">' + money(lineTotal(it)) + '</div>' +
          '</div>';
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

  var toastEl = $('#toast'), toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; requestAnimationFrame(function () { toastEl.classList.add('show'); }); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2400); }

  load();
})();
