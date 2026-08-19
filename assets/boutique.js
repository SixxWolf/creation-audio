/* =========================================================
   Création Audio V2 — boutique publique (filaments)
   Lecture de la vue Supabase « products_public » (anonyme,
   aucun coût exposé). Écran matériaux -> configurateur couleur
   -> panier -> commande par Messenger (aucun paiement en ligne).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  var FB = 'https://m.me/61591945465745';
  var EMAIL = 'contact@creationaudio.ca';
  var BUCKET = 'products';
  var CART_KEY = 'ca_v2_cart';

  // Accessoires « bobine vide réutilisable » (hors catalogue couleurs).
  var ACC = {
    spool:   { id: 'spool',   name: 'Bobine vide réutilisable', price: 10,
               desc: 'En supplément — pour vos recharges · température max 70 °C', img: 'assets/img/spool-reusable.png' },
    spoolht: { id: 'spoolht', name: 'Bobine vide réutilisable — haute température', price: 10,
               desc: 'Pour matériaux techniques (ABS…) · température max 90 °C', img: 'assets/img/spool-reusable-ht.png' }
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function publicUrl(path) {
    if (!path || !sb) return '';
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }
  function normalizeTiers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return { min: parseInt(t.min, 10), price: parseFloat(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; });
  }
  function tierPrice(base, tiers, qty) {
    var p = +base || 0;
    normalizeTiers(tiers).forEach(function (t) { if (qty >= t.min) p = t.price; });
    return p;
  }
  // Pastille couleur : dégradé à parts égales si le filament est multi-colore
  // (attrs.colors = 2+ couleurs), sinon couleur pleine (hex). Repli : #ccc.
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
  function swatchBg(p) {
    var cs = p && p.attrs && Array.isArray(p.attrs.colors) ? p.attrs.colors.filter(isHex) : [];
    if (cs.length >= 2) {
      var n = cs.length, parts = [];
      for (var i = 0; i < n; i++) { parts.push(cs[i] + ' ' + (100 * i / n) + '%', cs[i] + ' ' + (100 * (i + 1) / n) + '%'); }
      return 'linear-gradient(90deg,' + parts.join(',') + ')';
    }
    return cs[0] || (p && isHex(p.hex) ? p.hex : '#ccc');
  }

  /* ---------- données ---------- */
  var products = [], byId = {}, materials = [], brandsData = [], curBrand = null, brandInfo = {};
  // accessoires admin-gérés (products type=accessory) ; repli sur ACC codé en dur
  var accessories = [], accById = {};
  function normAcc(p) {
    return { id: p.id, name: p.name, desc: (p.attrs && p.attrs.description) || '',
             price: +p.sell_price || 0, img: publicUrl(p.image_path),
             qty: (p.qty == null ? null : (p.qty | 0)) };
  }
  var matGrid = $('#materials-grid'), brandGrid = $('#brands-grid'),
      screenBrands = $('#screen-brands'), screenMat = $('#screen-materials'), screenCol = $('#screen-colors'),
      matEyebrow = $('#materials-eyebrow'), matTitle = $('#materials-title'),
      configEl = $('#config'), backBtn = $('#back-materials'), backBrands = $('#back-brands');

  function hasSpool(p) { return p.sell_price != null; }
  function hasRefill(p) { return p.sell_price_2 != null; }
  function stockOf(p, type) { return type === 'refill' ? (p.qty_2 | 0) : (p.qty | 0); }
  function baseOf(p, type) { return type === 'refill' ? p.sell_price_2 : p.sell_price; }
  function tiersOf(p, type) { return type === 'refill' ? p.tiers_2 : p.tiers; }

  /* =========================================================
     Routage : chaque étape (marque -> matériau -> couleur) a sa
     propre adresse (#/m/Marque/Matériau/idCouleur). Le bouton
     « retour » du navigateur revient donc à l'étape précédente
     — et la dernière couleur cliquée — au lieu de la page d'accueil.
     ========================================================= */
  var dataReady = false;
  function slug(s) { return encodeURIComponent(String(s == null ? '' : s)); }
  function unslug(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function routeFor(brand, material, colorId) {
    var h = '#/m/' + slug(brand);
    if (material) h += '/' + slug(material);
    if (material && colorId) h += '/' + slug(colorId);
    return h;
  }
  function currentRoute() {
    var h = location.hash.replace(/^#\/?/, '');
    if (!h) return { screen: 'brands' };
    var parts = h.split('/').map(unslug);
    if (parts[0] !== 'm' || !parts[1]) return { screen: 'brands' };
    return { screen: 'material', brand: parts[1], material: parts[2] || null, colorId: parts[3] || null };
  }
  // Naviguer = changer le hash : le navigateur empile une entrée d'historique,
  // hashchange déclenche applyRoute(). Pousser la même cible => simple re-rendu.
  function pushRoute(hash) { if (location.hash === hash) applyRoute(); else location.hash = hash; }
  function replaceRoute(hash) { history.replaceState(null, '', hash); applyRoute(); }
  window.addEventListener('hashchange', function () { applyRoute(); });

  function defaultColorOf(m) {
    return m.items.filter(function (p) { return stockOf(p, 'spool') > 0 || stockOf(p, 'refill') > 0; })[0] || m.items[0];
  }
  // Changement de couleur « léger » : pas de remontée en haut de page, on garde
  // le format (recharge/bobine) s'il reste offert. Utilisé quand on est déjà
  // sur l'écran couleurs (clic pastille ou retour navigateur entre 2 couleurs).
  function selectColor(id) {
    var np = byId[id]; if (!np || !curMat) return;
    curColor = np;
    if (curType === 'refill' && !hasRefill(curColor)) curType = 'spool';
    if (curType === 'spool' && !hasSpool(curColor)) curType = 'refill';
    curQty = 1; renderConfig();
  }
  function showBrandsScreen() {
    screenMat.hidden = true; screenCol.hidden = true; screenBrands.hidden = false;
    setNavActive(null); setShopScreen('brands');
  }
  function showMaterialsScreen() {
    screenBrands.hidden = true; screenCol.hidden = true; screenMat.hidden = false;
    setNavActive(null); setShopScreen('materials');
  }
  // Rend l'écran correspondant à l'URL courante, sans jamais re-toucher au hash.
  function applyRoute() {
    if (!dataReady) return;                         // rejoué une fois les données chargées
    var r = currentRoute();
    if (r.screen === 'brands') {
      if (brandsData.length === 1) { replaceRoute(routeFor(brandsData[0].name)); return; }
      showBrandsScreen();
      return;
    }
    if (!brandsData.some(function (b) { return b.name === r.brand; })) { replaceRoute('#/'); return; }
    if (curBrand !== r.brand) openBrand(r.brand);   // (re)construit les matériaux de la marque
    if (!r.material) { showMaterialsScreen(); return; }
    var m = materials.filter(function (x) { return x.name === r.material; })[0];
    if (!m) { showMaterialsScreen(); return; }
    var sameMat = curMat && curMat.name === r.material && !screenCol.hidden;
    if (sameMat) selectColor((r.colorId && byId[r.colorId] ? byId[r.colorId] : defaultColorOf(m)).id);
    else openMaterial(r.material, r.colorId);
  }

  function load() {
    if (!sb) { brandGrid.innerHTML = '<p class="empty">Boutique momentanément indisponible.</p>'; return; }
    Promise.all([
      sb.from('products_public').select('*').eq('type', 'filament').order('sort_order', { ascending: true }).order('name', { ascending: true }),
      sb.from('brands').select('*'),
      sb.from('products_public').select('*').eq('type', 'accessory').order('sort_order', { ascending: true })
    ]).then(function (res) {
      var pr = res[0], br = res[1], ac = res[2];
      if (pr.error) { brandGrid.innerHTML = '<p class="empty">Impossible de charger la boutique.</p>'; return; }
      products = pr.data || [];
      byId = {};
      products.forEach(function (p) { byId[p.id] = p; });
      brandInfo = {};
      ((br && br.data) || []).forEach(function (b) { brandInfo[b.name] = b; });
      // accessoires (admin) + repli sur les 2 bobines vides codées en dur
      accessories = (ac && !ac.error && ac.data ? ac.data : []).map(normAcc);
      accById = {};
      accessories.forEach(function (a) { accById[a.id] = a; });
      Object.keys(ACC).forEach(function (k) {
        var a = ACC[k];
        if (!accById[a.id]) accById[a.id] = { id: a.id, name: a.name, desc: a.desc, price: a.price, img: a.img, qty: null };
      });
      buildBrands();
      renderBrands();
      dataReady = true;
      applyRoute();          // honore l'URL courante (lien direct / retour navigateur)
      renderCart();
    }, function () { brandGrid.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  /* ---------- écran marques ---------- */
  function buildBrands() {
    var map = {}, order = [];
    products.forEach(function (p) {
      var key = p.brand || 'Autres';
      if (!map[key]) { map[key] = { name: key, items: [] }; order.push(key); }
      map[key].items.push(p);
    });
    brandsData = order.map(function (k) {
      var items = map[k].items;
      var mats = {}; items.forEach(function (p) { mats[p.material || 'Autres'] = 1; });
      // image vitrine : le LOGO de la marque (défini dans l'admin) si présent,
      // sinon repli sur une couleur qui a une image.
      var rep = items.filter(function (p) { return p.image_path; })[0] || items[0];
      var logo = brandInfo[k] && brandInfo[k].image_path ? brandInfo[k].image_path : '';
      return { name: k, items: items, materialsCount: Object.keys(mats).length, rep: rep, logo: logo };
    });
  }

  function renderBrands() {
    if (!brandsData.length) { brandGrid.innerHTML = '<p class="empty">Aucun filament disponible pour le moment.</p>'; return; }
    brandGrid.innerHTML = brandsData.map(function (b) {
      var url = b.logo ? publicUrl(b.logo) : (b.rep ? publicUrl(b.rep.image_path) : '');
      var media = url ? '<img src="' + esc(url) + '" alt="' + esc(b.name) + '" loading="lazy">'
                      : '<span class="mat-swatch" style="background:' + esc(swatchBg(b.rep)) + '"></span>';
      return '<button class="mat-card' + (b.logo ? ' has-logo' : '') + '" type="button" data-brand="' + esc(b.name) + '">' +
        '<div class="mat-media">' + media + '</div>' +
        '<div class="mat-info">' +
          '<h3>' + esc(b.name) + '</h3>' +
          '<div class="count">' + b.materialsCount + ' matériau' + (b.materialsCount > 1 ? 'x' : '') +
            ' · ' + b.items.length + ' couleur' + (b.items.length > 1 ? 's' : '') + '</div>' +
        '</div>' +
      '</button>';
    }).join('');
    $$('.mat-card', brandGrid).forEach(function (c) {
      c.addEventListener('click', function () { pushRoute(routeFor(c.getAttribute('data-brand'))); });
    });
  }

  function openBrand(name) {
    curBrand = name;
    buildMaterials();
    matEyebrow.textContent = name;
    matTitle.textContent = 'Matériaux ' + name;
    renderMaterials();
    buildShopNav();
    // si une seule marque, pas de retour vers l'écran marques
    if (backBrands) backBrands.style.display = (brandsData.length <= 1) ? 'none' : '';
    screenBrands.hidden = true; screenCol.hidden = true; screenMat.hidden = false;
    setShopScreen('materials');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (backBrands) backBrands.addEventListener('click', function () { pushRoute('#/'); });

  function buildMaterials() {
    var map = {}, order = [];
    products.filter(function (p) { return (p.brand || 'Autres') === curBrand; }).forEach(function (p) {
      var key = p.material || 'Autres';
      if (!map[key]) { map[key] = { name: key, items: [], sort: (p.material_sort == null ? 9999 : p.material_sort) }; order.push(key); }
      map[key].items.push(p);
    });
    // ordre des matériaux = sort_order défini dans l'admin (glisser-déposer) ;
    // tri stable => les égalités conservent l'ordre d'apparition (repli avant migration).
    order.sort(function (a, b) { return map[a].sort - map[b].sort; });
    materials = order.map(function (k) {
      var m = map[k], first = m.items[0];
      return { name: m.name, items: m.items,
        spool: first ? first.sell_price : null, refill: first ? first.sell_price_2 : null,
        desc: first ? first.material_desc : null,
        longDesc: first ? first.material_long_desc : null,
        specs: first ? first.material_specs : null,
        gallery: first ? first.material_gallery : null,
        matImage: first ? first.material_image : null, rep: null };
    });
    pickRepresentatives();
  }

  // Image « vitrine » par matériau, en évitant qu'une même couleur représente
  // deux matériaux différents (ex. PLA Basic noir ≠ PLA Matte noir).
  function pickRepresentatives() {
    var used = {};
    function key(p) { return String(p.hex || p.name || '').toLowerCase(); }
    materials.forEach(function (m) {
      var withImg = m.items.filter(function (p) { return p.image_path; });
      var pool = withImg.length ? withImg : m.items;
      var chosen = pool.filter(function (p) { return !used[key(p)]; })[0] || pool[0] || m.items[0];
      m.rep = chosen;
      if (chosen) used[key(chosen)] = true;
    });
  }

  /* ---------- écran matériaux ---------- */
  function renderMaterials() {
    if (!materials.length) { matGrid.innerHTML = '<p class="empty">Aucun filament disponible pour le moment.</p>'; return; }
    matGrid.innerHTML = materials.map(function (m) {
      var prices = [];
      if (m.spool != null) prices.push(money(m.spool) + ' <small>bobine</small>');
      if (m.refill != null) prices.push(money(m.refill) + ' <small>recharge</small>');
      // image vitrine choisie à la main (E4) ; repli sur la couleur représentative
      var url = m.matImage ? publicUrl(m.matImage) : (m.rep ? publicUrl(m.rep.image_path) : '');
      var media = url ? '<img src="' + esc(url) + '" alt="' + esc(m.name) + '" loading="lazy">'
                      : '<span class="mat-swatch" style="background:' + esc(swatchBg(m.rep)) + '"></span>';
      return '<button class="mat-card" type="button" data-mat="' + esc(m.name) + '">' +
        '<div class="mat-media">' + media + '</div>' +
        '<div class="mat-info">' +
          '<div class="mat-brand">' + esc(curBrand || '') + '</div>' +
          '<h3>' + esc(m.name) + '</h3>' +
          '<div class="price">' + (prices.join(' · ') || '—') + '</div>' +
          '<div class="count">' + m.items.length + ' couleur' + (m.items.length > 1 ? 's' : '') + '</div>' +
        '</div>' +
      '</button>';
    }).join('');
    $$('.mat-card', matGrid).forEach(function (c) {
      c.addEventListener('click', function () { pushRoute(routeFor(curBrand, c.getAttribute('data-mat'))); });
    });
  }

  /* accès rapide latéral (grand écran) — se synchronise avec les matériaux admin */
  function buildShopNav() {
    var nav = document.getElementById('shop-nav');
    if (!nav) return;
    if (!materials.length) { nav.innerHTML = ''; return; }
    nav.innerHTML = '<div class="shop-nav-title">Matériaux</div>' + materials.map(function (m) {
      return '<button type="button" class="shop-nav-link" data-mat="' + esc(m.name) + '">' + esc(m.name) + '</button>';
    }).join('');
    $$('.shop-nav-link', nav).forEach(function (b) {
      b.addEventListener('click', function () { pushRoute(routeFor(curBrand, b.getAttribute('data-mat'))); });
    });
  }
  function setNavActive(name) {
    $$('#shop-nav .shop-nav-link').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-mat') === name); });
  }
  // marque l'écran courant -> l'accès rapide latéral n'apparaît QUE sur les matériaux/couleurs
  function setShopScreen(name) { document.body.setAttribute('data-shop-screen', name); }

  /* ---------- configurateur (écran couleur) ---------- */
  var curMat = null, curColor = null, curType = 'refill', curQty = 1;

  function openMaterial(name, colorId) {
    curMat = materials.filter(function (x) { return x.name === name; })[0];
    if (!curMat) return;
    // couleur ciblée par l'URL si elle appartient à ce matériau ;
    // sinon la 1re avec du stock, sinon la 1re
    var wanted = colorId ? byId[colorId] : null;
    curColor = (wanted && wanted.material === curMat.name) ? wanted : defaultColorOf(curMat);
    curType = defaultType(curColor);
    curQty = 1;
    renderConfig();
    setNavActive(curMat.name);
    screenMat.hidden = true; screenCol.hidden = false;
    setShopScreen('colors');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function defaultType(p) {
    if (hasRefill(p) && stockOf(p, 'refill') > 0) return 'refill';
    if (hasSpool(p) && stockOf(p, 'spool') > 0) return 'spool';
    return hasRefill(p) ? 'refill' : 'spool';
  }
  backBtn.addEventListener('click', function () { pushRoute(routeFor(curBrand)); });

  function typeCard(type, label) {
    var offered = type === 'refill' ? hasRefill(curColor) : hasSpool(curColor);
    if (!offered) return '';
    var price = baseOf(curColor, type);
    var out = stockOf(curColor, type) <= 0;
    return '<button type="button" class="cfg-type' + (curType === type ? ' is-active' : '') + (out ? ' is-out' : '') +
      '" data-type="' + type + '">' +
      '<span class="cfg-type-name">' + label + '</span>' +
      '<span class="cfg-type-price">' + money(price) + (out ? ' · rupture' : '') + '</span>' +
    '</button>';
  }

  /* ---------- fiche détaillée (bas de page) : galerie → description → specs → nuancier ---------- */
  var ICON = {
    cam:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.2"/></svg>',
    doc:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 3h8l4 4v14a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0V3z"/><path d="M14 3v4h4M8 12h8M8 16h6"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    pal:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.9 1.3-1.8-.3-.9.3-1.7 1.2-1.7H16a5 5 0 0 0 5-5c0-5-4-8.5-9-8.5z"/><circle cx="7.5" cy="12" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="14.5" cy="8" r="1"/></svg>'
  };
  function fsHead(icon, title, sub) {
    return '<div class="fs-head"><span class="fs-ic">' + icon + '</span><div>' +
      '<h2>' + esc(title) + '</h2>' + (sub ? '<div class="fs-sub">' + esc(sub) + '</div>' : '') + '</div></div>';
  }
  function filsheetHtml() {
    var m = curMat;
    var gal = Array.isArray(m.gallery) ? m.gallery.filter(function (x) { return typeof x === 'string' && x; }) : [];
    var specs = Array.isArray(m.specs) ? m.specs.filter(function (s) { return s && (s.k || s.v); }) : [];
    var paras = String(m.longDesc || '').split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var colors = (m.items || []).filter(function (it) { return isHex(it.hex) || (it.attrs && Array.isArray(it.attrs.colors)); });

    var blocks = [];

    if (gal.length) {
      var shots = gal.map(function (path, i) {
        var u = publicUrl(path);
        return '<button type="button" class="fs-shot' + (i === 0 ? ' big' : '') + '" data-full="' + esc(u) + '">' +
          '<img src="' + esc(u) + '" alt="" loading="lazy"></button>';
      }).join('');
      blocks.push('<div class="fs-block">' + fsHead(ICON.cam, 'Imprimé avec ce filament', 'Clique pour agrandir') +
        '<div class="fs-gallery">' + shots + '</div></div>');
    }

    if (paras.length) {
      blocks.push('<div class="fs-block">' + fsHead(ICON.doc, 'À propos du ' + m.name) +
        '<div class="fs-desc">' + paras.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div></div>');
    }

    if (specs.length) {
      var cells = specs.map(function (s) {
        return '<div class="fs-spec"><div class="k">' + esc(s.k) + '</div><div class="v">' + esc(s.v) + '</div></div>';
      }).join('');
      blocks.push('<div class="fs-block">' + fsHead(ICON.list, 'Spécifications techniques') +
        '<div class="fs-specs">' + cells + '</div></div>');
    }

    if (colors.length >= 2) {
      var nus = colors.map(function (it) {
        var meta = [it.code, isHex(it.hex) ? it.hex : ''].filter(Boolean).join(' · ');
        return '<div class="fs-nu"><span class="fs-chip" style="background:' + esc(swatchBg(it)) + '"></span>' +
          '<div><div class="nm">' + esc(it.name) + '</div>' + (meta ? '<div class="hx">' + esc(meta) + '</div>' : '') + '</div></div>';
      }).join('');
      blocks.push('<div class="fs-block">' + fsHead(ICON.pal, 'Nuancier ' + m.name, colors.length + ' couleurs') +
        '<div class="fs-nuancier">' + nus + '</div></div>');
    }

    if (!blocks.length) return '';
    return '<section class="filsheet">' + blocks.join('') + '</section>';
  }

  /* visionneuse plein écran (lightbox) — créée à la volée, fermée au clic / Échap */
  function openLightbox(url) {
    var ov = document.createElement('div');
    ov.className = 'fs-lightbox';
    ov.innerHTML = '<button type="button" class="fs-lb-close" aria-label="Fermer">&times;</button><img src="' + esc(url) + '" alt="">';
    function close() { document.removeEventListener('keydown', onKey); if (ov.parentNode) ov.parentNode.removeChild(ov); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
  }

  function renderConfig() {
    var p = curColor;
    // image dynamique selon le format : recharge -> attrs.img_refill, bobine -> attrs.img_spool ;
    // repli sur l'image principale de la couleur.
    var fmtImg = p.attrs && p.attrs['img_' + (curType === 'refill' ? 'refill' : 'spool')];
    var url = publicUrl(fmtImg || p.image_path);
    var stock = stockOf(p, curType), out = stock <= 0;
    var price = baseOf(p, curType);
    var tiers = normalizeTiers(tiersOf(p, curType));
    var tierLine = tiers.length ? '<div class="cfg-tier">Rabais quantité : ' +
      tiers.map(function (t) { return t.min + '+ à ' + money(t.price); }).join(' · ') + '</div>' : '';

    // grisé = indisponible DANS LE FORMAT SÉLECTIONNÉ (bobine ou recharge)
    var swatches = curMat.items.map(function (it) {
      var out = stockOf(it, curType) <= 0;
      return '<button type="button" class="cfg-sw' + (it.id === p.id ? ' is-active' : '') + (out ? ' is-out' : '') + '" ' +
        'data-id="' + esc(it.id) + '" title="' + esc(it.name) + (out ? ' — rupture en ' + (curType === 'refill' ? 'recharge' : 'bobine') : '') +
        '" style="background:' + esc(swatchBg(it)) + '"></button>';
    }).join('');

    var descLines = String(curMat.desc || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var featHtml = descLines.length ? '<div class="cfg-features"><div class="cfg-features-title">Caractéristiques</div><ul>' +
      descLines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div>' : '';

    // liste des accessoires : admin (products type=accessory) si présents, sinon repli codé en dur
    var accDisp = accessories.length ? accessories
      : Object.keys(ACC).map(function (k) { var a = ACC[k]; return { id: a.id, name: a.name, desc: a.desc, price: a.price, img: a.img, qty: null }; });
    var accHtml = accDisp.map(function (a) {
      var out = a.qty != null && a.qty <= 0;
      return '<div class="cfg-acc">' +
        '<div class="cfg-acc-thumb">' + (a.img ? '<img src="' + esc(a.img) + '" alt="" loading="lazy">' : '') + '</div>' +
        '<div class="cfg-acc-main"><div class="cfg-acc-name">' + esc(a.name) + '</div>' +
          (a.desc ? '<div class="cfg-acc-desc">' + esc(a.desc) + '</div>' : '') + '</div>' +
        '<div class="cfg-acc-right"><span class="cfg-acc-price">' + money(a.price) + '</span>' +
          '<button type="button" class="cfg-acc-add' + (out ? ' is-disabled' : '') + '"' + (out ? ' disabled' : '') +
            ' data-acc="' + esc(a.id) + '">' + (out ? 'Rupture' : '+ Ajouter') + '</button></div>' +
      '</div>';
    }).join('');

    configEl.innerHTML =
      '<div class="cfg-grid">' +
        '<div class="cfg-media">' +
          (url ? '<img src="' + esc(url) + '" alt="' + esc(p.name) + '">' : '<span class="cfg-swatch-lg" style="background:' + esc(swatchBg(p)) + '"></span>') +
        '</div>' +
        '<div class="cfg-panel">' +
          '<div class="cfg-eyebrow">' + esc(curBrand || '') + ' · ' + esc(curMat.name) + '</div>' +
          '<h1 class="cfg-name">' + esc(p.name) + '</h1>' +

          '<div class="cfg-label">Type</div>' +
          '<div class="cfg-types">' + typeCard('refill', 'Recharge') + typeCard('spool', 'Avec bobine') + '</div>' +
          (hasRefill(p) ? '<p class="cfg-refill-note">⚠ La recharge doit être utilisée avec une bobine réutilisable.</p>' : '') +

          '<div class="cfg-priceline">' +
            '<span class="cfg-price">' + money(price) + '</span>' +
            '<span class="cfg-stock ' + (out ? 'out' : 'in') + '">' + (out ? 'Rupture' : (stock + ' en stock')) + '</span>' +
          '</div>' +
          tierLine +

          '<div class="cfg-label">Couleur · <b>' + esc(p.name) + (p.code ? ' (' + esc(p.code) + ')' : '') + '</b></div>' +
          '<div class="cfg-colors">' + swatches + '</div>' +

          '<div class="cfg-buy">' +
            '<div class="cfg-qty">' +
              '<button type="button" class="cfg-q-minus" aria-label="Moins">&minus;</button>' +
              '<input type="number" class="cfg-q-val" min="1" ' + (out ? '' : 'max="' + stock + '" ') + 'value="' + curQty + '" inputmode="numeric">' +
              '<button type="button" class="cfg-q-plus" aria-label="Plus">+</button>' +
            '</div>' +
            '<button type="button" class="cfg-add' + (out ? ' is-disabled' : '') + '"' + (out ? ' disabled' : '') + '>' +
              (out ? 'Rupture de stock' : 'Ajouter au panier') + '</button>' +
          '</div>' +

          featHtml +

          '<div class="cfg-accs">' + accHtml + '</div>' +
        '</div>' +
      '</div>' +
      filsheetHtml();

    wireConfig();
  }

  function wireConfig() {
    $$('.cfg-type', configEl).forEach(function (b) {
      b.addEventListener('click', function () { curType = b.getAttribute('data-type'); curQty = 1; renderConfig(); });
    });
    $$('.cfg-sw', configEl).forEach(function (b) {
      // chaque couleur = sa propre entrée d'historique -> le retour navigateur
      // ramène à la couleur précédemment cliquée (comme les gros sites).
      b.addEventListener('click', function () { pushRoute(routeFor(curBrand, curMat.name, b.getAttribute('data-id'))); });
    });
    var qv = $('.cfg-q-val', configEl);
    var maxStock = stockOf(curColor, curType);
    if ($('.cfg-q-minus', configEl)) $('.cfg-q-minus', configEl).addEventListener('click', function () { curQty = Math.max(1, curQty - 1); qv.value = curQty; });
    if ($('.cfg-q-plus', configEl)) $('.cfg-q-plus', configEl).addEventListener('click', function () { curQty = Math.min(maxStock || 1, curQty + 1); qv.value = curQty; });
    if (qv) qv.addEventListener('change', function () {
      var n = parseInt(this.value, 10); if (isNaN(n) || n < 1) n = 1; if (maxStock && n > maxStock) n = maxStock;
      curQty = n; this.value = n;
    });
    var add = $('.cfg-add', configEl);
    if (add) add.addEventListener('click', function () {
      if (add.disabled) return;
      flyToCart($('.cfg-media img', configEl) || $('.cfg-media .cfg-swatch-lg', configEl));
      addToCart(curColor.id, curType, curQty);
    });
    $$('.cfg-acc-add', configEl).forEach(function (b) {
      b.addEventListener('click', function () { if (b.disabled) return; addAccessory(b.getAttribute('data-acc')); });
    });
    $$('.fs-shot', configEl).forEach(function (b) {
      b.addEventListener('click', function () { openLightbox(b.getAttribute('data-full')); });
    });
  }

  /* ---------- panier ---------- */
  var cart = loadCart();
  function loadCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; } }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} }
  function keyOf(id, type) { return id + '|' + type; }

  function metaOf(it) { return it.type === 'accessory' ? accById[it.id] : byId[it.id]; }
  function unitOf(it) {
    if (it.type === 'accessory') return accById[it.id] ? accById[it.id].price : 0;
    var p = byId[it.id]; if (!p) return 0;
    return tierPrice(baseOf(p, it.type), tiersOf(p, it.type), it.qty);
  }
  function maxOf(it) {
    if (it.type === 'accessory') { var a = accById[it.id]; return a && a.qty != null ? a.qty : Infinity; }
    var p = byId[it.id]; return p ? stockOf(p, it.type) : it.qty;
  }

  function addToCart(id, type, qty) {
    var p = byId[id]; if (!p) return;
    var max = stockOf(p, type), k = keyOf(id, type), cur = cart[k] ? cart[k].qty : 0;
    if (cur >= max) { toast('Maximum ' + max + ' en stock.'); return; }
    var next = Math.min(cur + (qty || 1), max);
    cart[k] = { id: id, type: type, qty: next };
    saveCart(); renderCart();
    toast(p.name + ' — ' + (type === 'refill' ? 'recharge' : 'bobine') + ' ajouté au panier.');
  }
  function addAccessory(id) {
    var a = accById[id]; if (!a) return;
    var k = keyOf(id, 'accessory');
    var cur = cart[k] ? cart[k].qty : 0;
    var max = (a.qty == null ? Infinity : a.qty);
    if (cur >= max) { toast('Maximum ' + max + ' en stock.'); return; }
    cart[k] = { id: id, type: 'accessory', qty: cur + 1 };
    saveCart(); renderCart();
    toast(a.name + ' ajouté au panier.');
  }
  function changeQty(k, delta) {
    if (!cart[k]) return;
    var max = maxOf(cart[k]); var next = cart[k].qty + delta;
    if (next > max) { toast('Maximum ' + max + ' en stock.'); next = max; }
    if (next <= 0) delete cart[k]; else cart[k].qty = next;
    saveCart(); renderCart();
  }
  function setQty(k, val) {
    if (!cart[k]) return;
    var n = parseInt(val, 10); if (isNaN(n)) { renderCart(); return; }
    var max = maxOf(cart[k]); if (n > max) { toast('Maximum ' + max + ' en stock.'); n = max; }
    if (n <= 0) delete cart[k]; else cart[k].qty = n;
    saveCart(); renderCart();
  }
  function removeItem(k) { delete cart[k]; saveCart(); renderCart(); }
  function clearCart() { cart = {}; saveCart(); renderCart(); }

  function entries() { return Object.keys(cart).map(function (k) { return cart[k]; }); }
  function count() { return entries().reduce(function (s, it) { return s + it.qty; }, 0); }
  function lineTotal(it) { return it.qty * unitOf(it); }
  function total() { return entries().reduce(function (s, it) { return s + lineTotal(it); }, 0); }

  var cartBtn = $('#cart-btn'), cartCount = $('#cart-count'), cartPanel = $('#cart-panel'),
      cartBackdrop = $('#cart-backdrop'), cartItems = $('#cart-items'), cartTotal = $('#cart-total'),
      cartMsg = $('#cart-msg'), orderBtn = $('#cart-order'), emailBtn = $('#cart-email');

  function typeLabel(it) { return it.type === 'accessory' ? 'accessoire' : (it.type === 'refill' ? 'recharge' : 'bobine'); }
  function thumbHtml(it) {
    var m = metaOf(it);
    if (it.type === 'accessory') return m && m.img ? '<img src="' + esc(m.img) + '" alt="">' : '<span class="citem-sw" style="background:#ddd"></span>';
    var url = publicUrl(m.image_path);
    return url ? '<img src="' + esc(url) + '" alt="">' : '<span class="citem-sw" style="background:' + esc(swatchBg(m)) + '"></span>';
  }

  function renderCart() {
    var n = count();
    cartCount.textContent = n;
    cartBtn.classList.toggle('has-items', n > 0);
    if (!n) {
      cartItems.innerHTML = '<p class="cart-empty">Ton panier est vide.<br>Choisis une couleur, puis « Ajouter au panier ».</p>';
    } else {
      cartItems.innerHTML = '';
      // accessoires en dernier
      entries().slice().sort(function (a, b) { return (a.type === 'accessory' ? 1 : 0) - (b.type === 'accessory' ? 1 : 0); })
        .forEach(function (it) {
          var m = metaOf(it); if (!m) return;
          var max = maxOf(it);
          var row = document.createElement('div'); row.className = 'citem';
          row.innerHTML =
            '<div class="citem-thumb">' + thumbHtml(it) + '</div>' +
            '<div class="citem-main">' +
              '<div class="citem-name">' + esc(m.name) + '</div>' +
              '<div class="citem-type">' + (it.type === 'accessory' ? 'Accessoire' : esc(m.material || '')) + ' · ' + typeLabel(it) +
                ' · <span class="citem-unit">' + money(unitOf(it)) + '/u</span></div>' +
              '<div class="citem-qty">' +
                '<button type="button" class="cq-minus" aria-label="Retirer un">&minus;</button>' +
                '<input type="number" class="cq-val" min="0" ' + (isFinite(max) ? 'max="' + max + '" ' : '') + 'value="' + it.qty + '" inputmode="numeric">' +
                '<button type="button" class="cq-plus" aria-label="Ajouter un"' + (isFinite(max) && it.qty >= max ? ' disabled' : '') + '>+</button>' +
              '</div>' +
            '</div>' +
            '<div class="citem-right">' +
              '<button type="button" class="citem-del" aria-label="Supprimer">&times;</button>' +
              '<div class="citem-line">' + money(lineTotal(it)) + '</div>' +
            '</div>';
          var k = keyOf(it.id, it.type);
          $('.cq-minus', row).addEventListener('click', function () { changeQty(k, -1); });
          $('.cq-plus', row).addEventListener('click', function () { changeQty(k, 1); });
          var inp = $('.cq-val', row);
          inp.addEventListener('change', function () { setQty(k, this.value); });
          inp.addEventListener('focus', function () { this.select(); });
          $('.citem-del', row).addEventListener('click', function () { removeItem(k); });
          cartItems.appendChild(row);
        });
    }
    cartTotal.textContent = money(total());
    orderBtn.classList.toggle('is-disabled', n === 0);
    if (emailBtn) emailBtn.classList.toggle('is-disabled', n === 0);
  }

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
    else { fly.style.background = el.style.background || getComputedStyle(el).backgroundColor; fly.style.borderRadius = '50%'; }
    document.body.appendChild(fly);
    var dx = (to.left + to.width / 2) - (sx + size / 2), dy = (to.top + to.height / 2) - (sy + size / 2);
    fly.getBoundingClientRect(); // commit l'état initial -> la transition part de façon fiable
    fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.12)';
    fly.style.opacity = '0.2';
    var done = false;
    function fin() { if (done) return; done = true; if (fly.parentNode) fly.parentNode.removeChild(fly); pulseCart(); }
    fly.addEventListener('transitionend', fin); setTimeout(fin, 900);
  }

  function openCart() { cartPanel.classList.add('is-open'); cartBackdrop.hidden = false; document.body.classList.add('cart-lock'); }
  function closeCart() { cartPanel.classList.remove('is-open'); cartBackdrop.hidden = true; document.body.classList.remove('cart-lock'); }
  cartBtn.addEventListener('click', openCart);
  cartBackdrop.addEventListener('click', closeCart);
  $('#cart-close').addEventListener('click', closeCart);
  $('#cart-clear').addEventListener('click', clearCart);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cartPanel.classList.contains('is-open')) closeCart(); });

  /* ---------- commande Messenger ---------- */
  function orderText() {
    var groups = {}, order = [], extras = [];
    entries().forEach(function (it) {
      var m = metaOf(it); if (!m) return;
      if (it.type === 'accessory') { extras.push('- ' + m.name + ' ×' + it.qty + ' — ' + money(lineTotal(it))); return; }
      var mat = m.material || 'Autres';
      if (!groups[mat]) { groups[mat] = []; order.push(mat); }
      var label = m.name + (m.code ? ' (' + m.code + ')' : '') + ' — ' + (it.type === 'refill' ? 'Recharge' : 'Avec bobine');
      groups[mat].push('- ' + label + ' ×' + it.qty + ' — ' + money(lineTotal(it)));
    });
    var blocks = order.map(function (mat) { return '*** ' + String(mat).toUpperCase() + ' ***\n' + groups[mat].join('\n'); });
    if (extras.length) blocks.push('*** ACCESSOIRES ***\n' + extras.join('\n'));
    return 'Bonjour,\n\nJe souhaite commander le filament suivant :\n\n' + blocks.join('\n\n') +
      '\n\nTotal estimé : ' + money(total()) + '\nRamassage : région de Québec.\n\nMerci !';
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt).catch(function () { fallbackCopy(txt); });
    fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
  orderBtn.addEventListener('click', function () {
    if (count() === 0) return;
    copyText(orderText());
    cartMsg.textContent = 'Liste copiée ✓ — colle-la dans Messenger et envoie.';
    window.open(FB, '_blank', 'noopener');
  });
  if (emailBtn) emailBtn.addEventListener('click', function () {
    if (count() === 0) return;
    var subject = 'Commande filaments — Création Audio';
    window.location.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(orderText());
    cartMsg.textContent = 'Ton logiciel de courriel s\'ouvre avec ta liste.';
  });

  /* ---------- toast ---------- */
  var toastEl = $('#toast'), toastT;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  load();
})();
