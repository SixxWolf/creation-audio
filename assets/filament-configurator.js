/* =========================================================
   Création Audio — configurateur filament (filament.html)
   Sélection par pastilles rondes + grande image + type
   (Refill 20 $ / Avec Bobine 25 $) + dispo par type.
   Données : window.CA_CATALOG, window.CA_FIL_IMG,
             window.CA.stockDetail (alimenté par inventory.js).
   ========================================================= */
(function () {
  'use strict';

  var CAT = window.CA_CATALOG || [];
  var IMG = window.CA_FIL_IMG || {};
  var PRICES = { refill: 20, spool: 25 };
  var TYPE_LABEL = { refill: 'Recharge', spool: 'Avec Bobine' };

  var byCode = {};
  CAT.forEach(function (i) { byCode[i.code] = i; });

  var $ = function (s, r) { return (r || document).querySelector(s); };

  // éléments
  var tabsEl = $('#matTabs');
  var swatchesEl = $('#cfgSwatches');
  var imgEl = $('#cfgImg');
  var matEl = $('#cfgMat');
  var nameEl = $('#cfgName');
  var colorNameEl = $('#cfgColorName');
  var priceEl = $('#cfgPrice');
  var availEl = $('#cfgAvail');
  var addBtn = $('#cfgAdd');
  var qtyInput = $('#cfgQty');
  var noteEl = $('#cfgNote');
  if (!tabsEl || !swatchesEl) return;

  // texte descriptif selon le type choisi
  var NOTE = {
    refill: 'Ø&nbsp;1,75&nbsp;mm · Recharge 1&nbsp;kg, <strong>sans bobine</strong> · Codes hex officiels Bambu&nbsp;Lab.<br>' +
            'À insérer sur une bobine vide réutilisable. Aucun paiement en ligne — on confirme la dispo et un ramassage à Québec.',
    spool:  'Ø&nbsp;1,75&nbsp;mm · 1&nbsp;kg <strong>livré sur bobine</strong> · Codes hex officiels Bambu&nbsp;Lab.<br>' +
            'Prêt à imprimer, aucune bobine à fournir. Aucun paiement en ligne — on confirme la dispo et un ramassage à Québec.'
  };

  // matériaux dans l'ordre du catalogue
  var materials = [];
  CAT.forEach(function (i) { if (materials.indexOf(i.material) === -1) materials.push(i.material); });

  var state = { mat: materials[0] || null, code: null, type: 'refill' };

  /* ---------- stock par type ---------- */
  function detail(code) {
    var s = window.CA && window.CA.stockDetail;
    return s && s[code] ? s[code] : null;
  }
  function stockFor(code, type) {
    var d = detail(code);
    if (!d) return null; // inconnu (pas encore chargé)
    return type === 'spool' ? (d.spool | 0) : (d.refill | 0);
  }
  function available(code, type) {
    var n = stockFor(code, type);
    return n === null ? true : n > 0; // optimiste tant que le stock n'est pas chargé
  }
  function imgSrc(code) {
    var f = IMG[code];
    return f ? 'assets/img/filament/' + f : '';
  }

  /* ---------- onglets matériau ---------- */
  function buildTabs() {
    tabsEl.innerHTML = materials.map(function (m) {
      return '<button type="button" class="mat-tab" role="tab" data-mat="' + escAttr(m) + '">' + escHtml(m) + '</button>';
    }).join('');
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.mat-tab'), function (b) {
      b.addEventListener('click', function () { selectMaterial(b.getAttribute('data-mat')); });
    });
  }
  function markActiveTab() {
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.mat-tab'), function (b) {
      var on = b.getAttribute('data-mat') === state.mat;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  /* ---------- pastilles ---------- */
  function colorsOf(mat) { return CAT.filter(function (i) { return i.material === mat; }); }

  function buildSwatches() {
    var list = colorsOf(state.mat);
    swatchesEl.innerHTML = list.map(function (i) {
      return '<button type="button" class="swatch" data-code="' + i.code +
        '" style="--c:' + i.hex + '" title="' + escAttr(i.name) + '" aria-label="' + escAttr(i.name) + '">' +
        '<span class="swatch-bar" aria-hidden="true"></span></button>';
    }).join('');
    Array.prototype.forEach.call(swatchesEl.querySelectorAll('.swatch'), function (b) {
      b.addEventListener('click', function () { selectColor(b.getAttribute('data-code')); });
    });
  }
  function refreshSwatchStates() {
    Array.prototype.forEach.call(swatchesEl.querySelectorAll('.swatch'), function (b) {
      var code = b.getAttribute('data-code');
      b.classList.toggle('is-oos', !available(code, state.type));
      b.classList.toggle('is-active', code === state.code);
    });
  }

  /* ---------- sélection ---------- */
  function selectMaterial(mat) {
    if (materials.indexOf(mat) === -1) return;
    state.mat = mat;
    markActiveTab();
    buildSwatches();
    // couleur par défaut : la 1re disponible dans le type courant, sinon la 1re
    var list = colorsOf(mat);
    var first = null;
    for (var i = 0; i < list.length; i++) { if (available(list[i].code, state.type)) { first = list[i].code; break; } }
    if (!first && list.length) first = list[0].code;
    selectColor(first, true);
  }

  function selectColor(code, silent) {
    if (!byCode[code]) return;
    state.code = code;
    refreshSwatchStates();
    render();
  }

  /* Si la couleur courante est en rupture pour le type choisi, bascule sur la
     1re couleur disponible du matériau. Si aucune ne l'est, on garde la
     sélection (l'écran affichera « Rupture de stock »). */
  function ensureAvailableColor() {
    if (state.code && available(state.code, state.type)) return;
    var list = colorsOf(state.mat);
    for (var i = 0; i < list.length; i++) {
      if (available(list[i].code, state.type)) { state.code = list[i].code; return; }
    }
  }

  function setType(type) {
    if (type !== 'refill' && type !== 'spool') return;
    state.type = type;
    Array.prototype.forEach.call(document.querySelectorAll('.cfg-type-btn'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-type') === type);
    });
    ensureAvailableColor();
    refreshSwatchStates();
    render();
  }

  /* ---------- rendu du panneau ---------- */
  function render() {
    var it = byCode[state.code];
    if (!it) return;
    matEl.textContent = it.material;
    nameEl.textContent = it.name;
    if (colorNameEl) colorNameEl.textContent = '· ' + it.name + ' (' + it.code + ')';

    var src = imgSrc(it.code);
    if (src && imgEl.getAttribute('src') !== src) imgEl.setAttribute('src', src);
    imgEl.alt = 'Filament ' + it.material + ' ' + it.name;

    priceEl.innerHTML = PRICES[state.type] + '&nbsp;$';
    if (noteEl) noteEl.innerHTML = NOTE[state.type] || NOTE.refill;

    var n = stockFor(it.code, state.type);
    var inStock = available(it.code, state.type);
    availEl.className = 'cfg-avail ' + (inStock ? 'in' : 'out');
    if (n === null) availEl.innerHTML = '<span class="dot"></span>Disponible';
    else if (n > 0) availEl.innerHTML = '<span class="dot"></span>' + n + ' en stock';
    else availEl.innerHTML = '<span class="dot"></span>Rupture de stock';

    if (inStock) {
      addBtn.disabled = false;
      addBtn.classList.remove('is-oos');
      addBtn.textContent = 'Ajouter au panier';
    } else {
      addBtn.disabled = true;
      addBtn.classList.add('is-oos');
      addBtn.textContent = 'Rupture de stock';
    }
  }

  /* ---------- quantité ---------- */
  function getQty() { return Math.max(1, parseInt(qtyInput.value, 10) || 1); }
  function setQty(n) { qtyInput.value = Math.max(1, n | 0); }

  /* ---------- ajout au panier ---------- */
  function add() {
    var it = byCode[state.code];
    if (!it || addBtn.disabled) return;
    if (window.CA && window.CA.cart && window.CA.cart.add) {
      window.CA.cart.add(it.code, state.type, getQty());
      if (window.CA.cart.flyTo) window.CA.cart.flyTo(imgSrc(it.code), addBtn.getBoundingClientRect());
      setQty(1);
    }
  }

  /* ---------- écouteurs ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.cfg-type-btn'), function (b) {
    b.addEventListener('click', function () { setType(b.getAttribute('data-type')); });
  });
  $('.cfg-qminus').addEventListener('click', function () { setQty(getQty() - 1); });
  $('.cfg-qplus').addEventListener('click', function () { setQty(getQty() + 1); });
  qtyInput.addEventListener('change', function () { setQty(getQty()); });
  addBtn.addEventListener('click', add);

  /* ---------- accessoires : bobines vides réutilisables ----------
     Stock géré dans Supabase comme les filaments (colonne qty). */
  var ACCESSORIES = [
    { btn: 'addSpool',   code: 'SPOOL',   pill: 'spoolAvail',   img: 'assets/img/spool-reusable.png' },
    { btn: 'addSpoolHt', code: 'SPOOLHT', pill: 'spoolHtAvail', img: 'assets/img/spool-reusable-ht.png' }
  ];
  function accStock(code) {
    var t = window.CA && window.CA.stock;
    if (!t || t[code] == null) return null;      // non géré / pas encore chargé
    var n = parseInt(t[code], 10);
    return isNaN(n) ? null : n;
  }
  function renderAccessories() {
    ACCESSORIES.forEach(function (a) {
      var btn = document.getElementById(a.btn), pill = document.getElementById(a.pill);
      if (!btn || !pill) return;
      var n = accStock(a.code);
      if (n === null) {                          // stock inconnu : on n'affiche rien
        pill.className = 'addon-stock'; pill.innerHTML = '';
        btn.classList.remove('is-oos'); btn.disabled = false;
        return;
      }
      var ok = n > 0;
      pill.className = 'addon-stock show ' + (ok ? 'in' : 'out');
      pill.innerHTML = '<span class="dot" aria-hidden="true"></span>' +
        (ok ? n + ' en stock' : 'Rupture de stock');
      btn.classList.toggle('is-oos', !ok);
      btn.disabled = !ok;
    });
  }
  ACCESSORIES.forEach(function (a) {
    var btn = document.getElementById(a.btn);
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      if (window.CA && window.CA.cart && window.CA.cart.add) {
        window.CA.cart.add(a.code, 'accessory', 1);
        if (window.CA.cart.flyTo) {
          var thumb = btn.querySelector('.addon-thumb') || btn;
          window.CA.cart.flyTo(a.img, thumb.getBoundingClientRect());
        }
      }
    });
  });

  // le stock arrive (ou change) → on rafraîchit dispo + pastilles
  document.addEventListener('inventory-ready', function () { ensureAvailableColor(); refreshSwatchStates(); render(); renderAccessories(); });

  /* ---------- utilitaires ---------- */
  function escHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function escAttr(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- init ---------- */
  buildTabs();
  if (state.mat) selectMaterial(state.mat);
  renderAccessories();
})();
