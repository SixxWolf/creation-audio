/* =========================================================
   Création Audio — configurateur filament (filament.html)
   Barre de filtres (matériaux + familles de couleurs) qui pilote
   une grille de pastilles + grande image + type (Recharge 20 $ /
   Avec Bobine 25 $) + dispo par type.
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
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // éléments configurateur
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
  // éléments filtres + écran matériaux
  var colBox = $('#filterColors');
  var appliedBox = $('#appliedFilters');
  var countEl = $('#filterCount');
  var pickerEl = $('#matPicker');
  var layoutEl = $('.shop-layout');
  var backBtn = $('#matBack');
  var toggleBtn = $('#filterToggle');
  var leadEl = $('#shopLead');
  if (!swatchesEl) return;

  var NOTE = {
    refill: 'Ø&nbsp;1,75&nbsp;mm · Recharge 1&nbsp;kg, <strong>sans bobine</strong> · Codes hex officiels Bambu&nbsp;Lab.<br>' +
            'À insérer sur une bobine vide réutilisable. Aucun paiement en ligne — on confirme la dispo et un ramassage à Québec.',
    spool:  'Ø&nbsp;1,75&nbsp;mm · 1&nbsp;kg <strong>livré sur bobine</strong> · Codes hex officiels Bambu&nbsp;Lab.<br>' +
            'Prêt à imprimer, aucune bobine à fournir. Aucun paiement en ligne — on confirme la dispo et un ramassage à Québec.'
  };

  // matériaux dans l'ordre du catalogue
  var materials = [];
  CAT.forEach(function (i) { if (materials.indexOf(i.material) === -1) materials.push(i.material); });

  /* ---------- familles de couleurs (buckets depuis le hex) ---------- */
  var FAMILY_ORDER = ['Noir', 'Gris', 'Blanc', 'Beige', 'Brun', 'Rouge', 'Rose', 'Orange', 'Jaune', 'Vert', 'Cyan', 'Bleu', 'Violet', 'Or / Métal'];
  var FAMILY_HEX = { // pastille repère par famille
    'Noir': '#1a1a1a', 'Gris': '#8b8e91', 'Blanc': '#f3f1ea', 'Beige': '#e5d6bd', 'Brun': '#7d5236',
    'Rouge': '#c9302c', 'Rose': '#ef5a8a', 'Orange': '#ff6a13', 'Jaune': '#f4d525', 'Vert': '#3fa64b',
    'Cyan': '#00a5c4', 'Bleu': '#1f5fd0', 'Violet': '#7a4fbf', 'Or / Métal': '#c9a24b'
  };
  function hexRGB(hex) {
    var m = String(hex || '').replace('#', '');
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    var n = parseInt(m, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0, s = 0, l = (mx + mn) / 2;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s, l: l };
  }
  function familyOf(it) {
    var n = String(it.name || '').toLowerCase();
    if (/gold|silver|bronze|champagne|titan|metal|métal/.test(n)) return 'Or / Métal';
    var hsl = rgbToHsl(hexRGB(it.hex)), h = hsl.h, s = hsl.s, l = hsl.l;
    if (l >= 0.85 && s <= 0.20) return 'Blanc';
    if (l <= 0.14) return 'Noir';
    if (s <= 0.12) return 'Gris';
    if (h >= 20 && h < 50) {           // zone orange/brun/beige
      if (l >= 0.72) return 'Beige';
      if (l <= 0.45 || s <= 0.5) return 'Brun';
      return 'Orange';
    }
    if (h < 20 || h >= 345) return 'Rouge';
    if (h >= 50 && h < 70) return 'Jaune';
    if (h >= 70 && h < 165) return 'Vert';
    if (h >= 165 && h < 200) return 'Cyan';
    if (h >= 200 && h < 258) return 'Bleu';
    if (h >= 258 && h < 300) return 'Violet';
    return 'Rose';                      // 300–345
  }
  // famille de chaque produit (calculée une fois)
  var familyCache = {};
  CAT.forEach(function (i) { familyCache[i.code] = familyOf(i); });
  // familles présentes dans un matériau donné (pour scoper le filtre couleur)
  function familiesIn(mat) {
    return FAMILY_ORDER.filter(function (f) {
      return CAT.some(function (i) { return i.material === mat && familyCache[i.code] === f; });
    });
  }

  /* ---------- état ---------- */
  var state = { code: null, type: 'refill', mats: [], fams: [] };
  function currentMat() { var it = byCode[state.code]; return it ? it.material : null; }

  /* ---------- stock par type ---------- */
  function detail(code) { var s = window.CA && window.CA.stockDetail; return s && s[code] ? s[code] : null; }
  function stockFor(code, type) { var d = detail(code); if (!d) return null; return type === 'spool' ? (d.spool | 0) : (d.refill | 0); }
  function available(code, type) { var n = stockFor(code, type); return n === null ? true : n > 0; }
  function imgSrc(code) { var f = IMG[code]; return f ? 'assets/img/filament/' + f : ''; }

  /* ---------- produits visibles selon les filtres ---------- */
  function visible() {
    return CAT.filter(function (i) {
      if (state.mats.length && state.mats.indexOf(i.material) === -1) return false;
      if (state.fams.length && state.fams.indexOf(familyCache[i.code]) === -1) return false;
      return true;
    });
  }

  /* ---------- écran de sélection du matériau (cartes) ---------- */
  // image « vitrine » par matériau : couleur vive, familles distinctes entre
  // cartes (pas deux fois la même couleur), overrides possibles.
  var HERO_OVERRIDE = { 'PLA Glow': '15500' };   // PLA Glow -> Glow Green
  function buildPicker() {
    if (!pickerEl) return;
    var usedFam = {};
    function chooseHero(mat, cols) {
      if (HERO_OVERRIDE[mat] && byCode[HERO_OVERRIDE[mat]]) return HERO_OVERRIDE[mat];
      var cand = cols.map(function (i) {
        return { code: i.code, fam: familyCache[i.code], sat: rgbToHsl(hexRGB(i.hex)).s };
      }).sort(function (a, b) { return b.sat - a.sat; });   // couleurs vives d'abord
      var i;
      for (i = 0; i < cand.length; i++) { if (cand[i].sat > 0.18 && !usedFam[cand[i].fam]) return cand[i].code; }
      for (i = 0; i < cand.length; i++) { if (!usedFam[cand[i].fam]) return cand[i].code; }
      return cand.length ? cand[0].code : cols[0].code;
    }
    pickerEl.innerHTML = materials.map(function (m) {
      var cols = CAT.filter(function (i) { return i.material === m; });
      var heroCode = chooseHero(m, cols);
      if (heroCode) usedFam[familyCache[heroCode]] = true;
      var hero = imgSrc(heroCode);
      var DOTS = 22;
      var dots = cols.slice(0, DOTS).map(function (i) { return '<span class="mat-card-dot" style="--c:' + i.hex + '"></span>'; }).join('');
      var more = cols.length > DOTS ? '<span class="mat-card-more">+' + (cols.length - DOTS) + '</span>' : '';
      return '<button type="button" class="mat-card" data-mat="' + escAttr(m) + '">' +
        '<div class="mat-card-media">' +
          '<span class="mat-card-rfid" aria-hidden="true"><svg viewBox="0 0 24 18" width="30" height="22"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 14a10 10 0 0 1 16 0"/><path d="M7 14a6.5 6.5 0 0 1 10 0"/><path d="M10 14a3 3 0 0 1 4 0"/></g></svg></span>' +
          (hero ? '<img src="' + hero + '" alt="Filament ' + escAttr(m) + '" loading="lazy">' : '') +
        '</div>' +
        '<div class="mat-card-body">' +
          '<span class="mat-card-name">' + escHtml(m) + '</span>' +
          '<span class="mat-card-count">' + cols.length + ' couleur' + (cols.length > 1 ? 's' : '') + '</span>' +
          '<div class="mat-card-dots">' + dots + more + '</div>' +
          '<span class="mat-card-cta">Voir les couleurs →</span>' +
        '</div>' +
      '</button>';
    }).join('');
    $$('.mat-card', pickerEl).forEach(function (b) {
      b.addEventListener('click', function () { openMaterial(b.getAttribute('data-mat')); });
    });
  }
  function openMaterial(mat) {
    if (materials.indexOf(mat) === -1) return;
    state.mats = [mat];
    state.fams = [];
    state.type = 'refill';   // défaut ; rabattu sur « bobine » si la couleur n'a pas de recharge
    state.typeUser = false;  // l'utilisateur n'a pas encore choisi le type manuellement
    buildColorFilter(mat);
    syncFilterInputs();
    renderApplied();
    buildSwatches();
    selectFirstVisible();
    if (pickerEl) pickerEl.hidden = true;
    if (layoutEl) layoutEl.hidden = false;
    if (leadEl) leadEl.textContent = 'Choisissez une couleur, un type (recharge ou avec bobine), et hop au panier.';
    if (toggleBtn) toggleBtn.style.display = '';            // hamburger (mobile) dispo
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function showPicker() {
    state.mats = []; state.fams = [];
    if (layoutEl) layoutEl.hidden = true;
    if (pickerEl) pickerEl.hidden = false;
    if (leadEl) leadEl.textContent = 'Sélectionnez un matériau pour voir les couleurs disponibles — ramassage à Québec.';
    if (toggleBtn) toggleBtn.style.display = 'none';        // pas de filtre à ouvrir ici
    if (window.CA && window.CA.filterDrawer) window.CA.filterDrawer.close();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- filtre couleur (scopé au matériau courant) ---------- */
  function buildColorFilter(mat) {
    if (!colBox) return;
    colBox.innerHTML = familiesIn(mat).map(function (f) {
      return '<label class="filter-opt filter-opt-color"><input type="checkbox" data-fam="' + escAttr(f) + '">' +
        '<span class="filter-dot" style="--c:' + (FAMILY_HEX[f] || '#ccc') + '"></span>' +
        '<span class="filter-opt-txt">' + escHtml(f) + '</span></label>';
    }).join('');
    $$('input[data-fam]', colBox).forEach(function (cb) {
      cb.addEventListener('change', function () { toggleArr(state.fams, cb.getAttribute('data-fam'), cb.checked); onFiltersChanged(); });
    });
  }
  function toggleArr(arr, val, on) {
    var i = arr.indexOf(val);
    if (on && i === -1) arr.push(val);
    else if (!on && i > -1) arr.splice(i, 1);
  }
  function syncFilterInputs() {
    $$('input[data-fam]', colBox).forEach(function (cb) { cb.checked = state.fams.indexOf(cb.getAttribute('data-fam')) > -1; });
  }

  /* ---------- puces « filtres appliqués » (couleurs) ---------- */
  function renderApplied() {
    var total = state.fams.length;
    if (countEl) { countEl.textContent = total; countEl.hidden = total === 0; }
    if (!appliedBox) return;
    if (!total) { appliedBox.innerHTML = ''; appliedBox.classList.remove('show'); return; }
    var chips = state.fams.map(function (f) {
      return '<button type="button" class="chip" data-kind="fam" data-val="' + escAttr(f) + '"><span class="chip-dot" style="--c:' + (FAMILY_HEX[f] || '#ccc') + '"></span>' + escHtml(f) + ' <span class="chip-x" aria-hidden="true">×</span></button>';
    });
    appliedBox.innerHTML = '<span class="applied-label">Filtres appliqués</span>' + chips.join('') +
      '<button type="button" class="chip chip-clear" id="chipClear">Tout effacer</button>';
    appliedBox.classList.add('show');
    $$('.chip[data-kind]', appliedBox).forEach(function (b) {
      b.addEventListener('click', function () { toggleArr(state.fams, b.getAttribute('data-val'), false); onFiltersChanged(); });
    });
    var clr = $('#chipClear', appliedBox);
    if (clr) clr.addEventListener('click', clearFilters);
  }
  function clearFilters() { state.fams = []; onFiltersChanged(); }

  function onFiltersChanged() {
    syncFilterInputs();
    renderApplied();
    buildSwatches();
    // garde la couleur courante si toujours visible, sinon 1re visible (dispo de préférence)
    var vis = visible();
    var stillThere = vis.some(function (i) { return i.code === state.code; });
    if (!stillThere) selectFirstVisible(vis);
    else { refreshSwatchStates(); render(); }
  }
  function selectFirstVisible(vis) {
    vis = vis || visible();
    var first = null;
    for (var i = 0; i < vis.length; i++) { if (available(vis[i].code, state.type)) { first = vis[i].code; break; } }
    if (!first && vis.length) first = vis[0].code;
    state.code = first;
    refreshSwatchStates();
    render();
  }

  /* ---------- pastilles (grille filtrée, groupée par matériau) ---------- */
  function buildSwatches() {
    var vis = visible();
    if (!vis.length) { swatchesEl.innerHTML = '<p class="cfg-empty">Aucun filament ne correspond à ces filtres.</p>'; return; }
    // regroupe par matériau (dans l'ordre du catalogue) ; en-tête seulement si plusieurs matériaux
    var groups = [], idx = {};
    vis.forEach(function (i) {
      if (!idx.hasOwnProperty(i.material)) { idx[i.material] = groups.length; groups.push({ mat: i.material, items: [] }); }
      groups[idx[i.material]].items.push(i);
    });
    var multi = groups.length > 1;
    swatchesEl.innerHTML = groups.map(function (g) {
      var head = multi ? '<div class="swatch-group-title">' + escHtml(g.mat) + '</div>' : '';
      return head + '<div class="swatch-group">' + g.items.map(function (i) {
        return '<button type="button" class="swatch" data-code="' + i.code +
          '" style="--c:' + i.hex + '" title="' + escAttr(i.name) + '" aria-label="' + escAttr(i.material + ' ' + i.name) + '">' +
          '<span class="swatch-bar" aria-hidden="true"></span></button>';
      }).join('') + '</div>';
    }).join('');
    $$('.swatch', swatchesEl).forEach(function (b) {
      b.addEventListener('click', function () { selectColor(b.getAttribute('data-code')); });
    });
  }
  function refreshSwatchStates() {
    $$('.swatch', swatchesEl).forEach(function (b) {
      var code = b.getAttribute('data-code');
      b.classList.toggle('is-oos', !available(code, state.type));
      b.classList.toggle('is-active', code === state.code);
    });
  }

  /* ---------- sélection ---------- */
  function selectColor(code) {
    if (!byCode[code]) return;
    state.code = code;
    // tant que l'utilisateur n'a pas fixé le type à la main, on préfère la
    // recharge (updateTypeOptions rabat sur bobine si la couleur n'y est pas dispo)
    if (!state.typeUser) state.type = 'refill';
    refreshSwatchStates();
    render();
  }

  function ensureAvailableColor() {
    if (state.code && available(state.code, state.type)) return;
    var vis = visible();
    for (var i = 0; i < vis.length; i++) { if (available(vis[i].code, state.type)) { state.code = vis[i].code; return; } }
  }

  /* ---------- prix + options de type (recharge / bobine) ---------- */
  function priceFor(mat, code, type) {
    var P = window.CA_PRICE;
    if (!P) return PRICES[type] || PRICES.refill;
    var p = P.priceOf(mat, code, type);
    return p != null ? p : P.spoolPrice(mat);
  }
  // Adapte les boutons Recharge/Avec Bobine au matériau + à la couleur :
  //  - matériau sans recharge  -> bouton « Recharge » caché, type forcé bobine
  //  - couleur non dispo en recharge -> bouton « Recharge » désactivé
  function updateTypeOptions(it) {
    var P = window.CA_PRICE; if (!P || !it) return;
    var mat = it.material;
    var refillBtn = document.querySelector('.cfg-type-btn[data-type="refill"]');
    var spoolBtn = document.querySelector('.cfg-type-btn[data-type="spool"]');
    var hint = document.querySelector('.cfg-typehint');
    var hasRefillMat = P.hasRefill(mat);
    var colorRefill = P.refillAvailable(mat, it.code);

    if (spoolBtn) { var sp = spoolBtn.querySelector('.ctb-price'); if (sp) sp.innerHTML = P.spoolPrice(mat) + '&nbsp;$'; }
    if (refillBtn) {
      if (!hasRefillMat) {
        refillBtn.hidden = true;
        state.type = 'spool';
      } else {
        refillBtn.hidden = false;
        var rp = refillBtn.querySelector('.ctb-price'); if (rp) rp.innerHTML = P.refillPrice(mat) + '&nbsp;$';
        refillBtn.disabled = !colorRefill;
        refillBtn.classList.toggle('is-disabled', !colorRefill);
        if (!colorRefill && state.type === 'refill') state.type = 'spool';
      }
    }
    $$('.cfg-type-btn').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-type') === state.type); });
    if (hint) {
      hint.textContent = !hasRefillMat ? 'Disponible avec bobine.'
        : (!colorRefill ? 'Cette couleur est disponible avec bobine seulement.'
        : 'La recharge nécessite une bobine réutilisable.');
    }
  }

  function setType(type) {
    if (type !== 'refill' && type !== 'spool') return;
    var it = byCode[state.code];
    // interdit la recharge si la couleur n'y est pas dispo
    if (type === 'refill' && it && window.CA_PRICE && !window.CA_PRICE.refillAvailable(it.material, it.code)) return;
    state.type = type;
    state.typeUser = true;   // choix manuel : on le conserve d'une couleur à l'autre
    $$('.cfg-type-btn').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-type') === type); });
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

    updateTypeOptions(it);
    var price = priceFor(it.material, it.code, state.type);
    priceEl.innerHTML = price + '&nbsp;$';
    if (noteEl) noteEl.innerHTML = NOTE[state.type] || NOTE.refill;

    var n = stockFor(it.code, state.type);
    var inStock = available(it.code, state.type);
    availEl.className = 'cfg-avail ' + (inStock ? 'in' : 'out');
    if (n === null) availEl.innerHTML = '<span class="dot"></span>Disponible';
    else if (n > 0) availEl.innerHTML = '<span class="dot"></span>' + n + ' en stock';
    else availEl.innerHTML = '<span class="dot"></span>Rupture de stock';

    if (inStock) { addBtn.disabled = false; addBtn.classList.remove('is-oos'); addBtn.textContent = 'Ajouter au panier'; }
    else { addBtn.disabled = true; addBtn.classList.add('is-oos'); addBtn.textContent = 'Rupture de stock'; }
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

  /* ---------- tiroir de filtres (mobile) ---------- */
  (function drawer() {
    var rail = $('#filterRail'), scrim = $('#filterScrim'),
        openBtn = $('#filterToggle'), closeBtn = $('#filterClose');
    function open() { if (rail) rail.classList.add('open'); if (scrim) scrim.classList.add('open'); document.body.classList.add('no-scroll'); }
    function close() { if (rail) rail.classList.remove('open'); if (scrim) scrim.classList.remove('open'); document.body.classList.remove('no-scroll'); }
    if (openBtn) openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (scrim) scrim.addEventListener('click', close);
    // exposé pour « voir les résultats » et Échap
    window.CA = window.CA || {}; window.CA.filterDrawer = { open: open, close: close };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  })();

  /* ---------- écouteurs configurateur ---------- */
  $$('.cfg-type-btn').forEach(function (b) { b.addEventListener('click', function () { setType(b.getAttribute('data-type')); }); });
  $('.cfg-qminus').addEventListener('click', function () { setQty(getQty() - 1); });
  $('.cfg-qplus').addEventListener('click', function () { setQty(getQty() + 1); });
  qtyInput.addEventListener('change', function () { setQty(getQty()); });
  addBtn.addEventListener('click', add);

  /* ---------- accessoires : bobines vides réutilisables ---------- */
  var ACCESSORIES = [
    { btn: 'addSpool',   code: 'SPOOL',   pill: 'spoolAvail',   img: 'assets/img/spool-reusable.png' },
    { btn: 'addSpoolHt', code: 'SPOOLHT', pill: 'spoolHtAvail', img: 'assets/img/spool-reusable-ht.png' }
  ];
  function accStock(code) {
    var t = window.CA && window.CA.stock;
    if (!t || t[code] == null) return null;
    var n = parseInt(t[code], 10);
    return isNaN(n) ? null : n;
  }
  function renderAccessories() {
    ACCESSORIES.forEach(function (a) {
      var btn = document.getElementById(a.btn), pill = document.getElementById(a.pill);
      if (!btn || !pill) return;
      var n = accStock(a.code);
      if (n === null) { pill.className = 'addon-stock'; pill.innerHTML = ''; btn.classList.remove('is-oos'); btn.disabled = false; return; }
      var ok = n > 0;
      pill.className = 'addon-stock show ' + (ok ? 'in' : 'out');
      pill.innerHTML = '<span class="dot" aria-hidden="true"></span>' + (ok ? n + ' en stock' : 'Rupture de stock');
      btn.classList.toggle('is-oos', !ok); btn.disabled = !ok;
    });
  }
  ACCESSORIES.forEach(function (a) {
    var btn = document.getElementById(a.btn);
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      if (window.CA && window.CA.cart && window.CA.cart.add) {
        window.CA.cart.add(a.code, 'accessory', 1);
        if (window.CA.cart.flyTo) { var thumb = btn.querySelector('.addon-thumb') || btn; window.CA.cart.flyTo(a.img, thumb.getBoundingClientRect()); }
      }
    });
  });

  document.addEventListener('inventory-ready', function () {
    renderAccessories();
    if (!state.mats.length) return;   // encore sur l'écran matériaux : rien à rafraîchir
    ensureAvailableColor(); refreshSwatchStates(); render();
  });

  /* ---------- utilitaires ---------- */
  function escHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function escAttr(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- init ---------- */
  if (backBtn) backBtn.addEventListener('click', showPicker);
  buildPicker();
  renderAccessories();
  showPicker();   // écran de sélection du matériau par défaut
})();
