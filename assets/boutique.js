/* =========================================================
   Création Audio — boutique publique (filaments) · v3
   Lecture de la vue Supabase « products_public » (anonyme,
   aucun coût exposé).
   Catalogue (matériaux groupés par marque, filtre marque +
   « en stock seulement ») → fiche couleur (photo, format,
   pastilles dans l'ordre de l'admin, onglets) → panier → commande par
   Messenger ou courriel (aucun paiement en ligne).
   Adresses : #/ · #/m/<marque> · #/m/<marque>/<matériau>[/<couleur>]
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  var FB = 'https://m.me/61591945465745';
  var EMAIL = 'contact@creationaudio.ca';
  var BUCKET = 'products';
  var CART_KEY = 'ca_v2_cart';
  var STOCK_KEY = 'ca_shop_only_stock';
  var BASE_TITLE = 'Création Audio — Filaments';

  // Accessoires « bobine vide réutilisable » (repli si aucun accessoire dans l'admin).
  var ACC = {
    spool:   { id: 'spool',   name: 'Bobine vide réutilisable', price: 10,
               desc: 'En supplément — pour vos recharges · température max 70 °C', img: 'assets/img/spool-reusable.png' },
    spoolht: { id: 'spoolht', name: 'Bobine vide réutilisable — haute température', price: 10,
               desc: 'Pour matériaux techniques (ABS…) · température max 90 °C', img: 'assets/img/spool-reusable-ht.png' }
  };

  var IC = {
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8v6M8 11h6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z"/><path d="M10 19a2 2 0 0 0 4 0"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M4 4l16 16"/></svg>'
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
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

  /* ---------- couleurs ----------
     Pastille : dégradé à parts égales si le filament est multi-colore
     (attrs.colors = 2+ couleurs), sinon couleur pleine (hex). Repli : #ccc. */
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
  function colorsOf(p) {
    var cs = p && p.attrs && Array.isArray(p.attrs.colors) ? p.attrs.colors.filter(isHex) : [];
    if (cs.length) return cs;
    return [p && isHex(p.hex) ? p.hex : '#cccccc'];
  }
  function swatchBg(p) {
    var cs = colorsOf(p);
    if (cs.length < 2) return cs[0];
    var n = cs.length, parts = [];
    for (var i = 0; i < n; i++) parts.push(cs[i] + ' ' + (100 * i / n) + '%', cs[i] + ' ' + (100 * (i + 1) / n) + '%');
    return 'linear-gradient(90deg,' + parts.join(',') + ')';
  }
  function hslOf(h) {
    var c = [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; });
    var max = Math.max.apply(null, c), min = Math.min.apply(null, c), l = (max + min) / 2, d = max - min, hue = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === c[0]) hue = ((c[1] - c[2]) / d) % 6;
      else if (max === c[1]) hue = (c[2] - c[0]) / d + 2;
      else hue = (c[0] - c[1]) / d + 4;
      hue = (hue * 60 + 360) % 360;
    }
    return { h: hue, s: s, l: l };
  }
  // Spectre : couleurs vives par teinte (rouge → violet), puis neutres du clair au foncé.
  function hueSort(a, b) {
    var x = hslOf(colorsOf(a)[0]), y = hslOf(colorsOf(b)[0]);
    var nx = x.s < 0.16 || x.l < 0.1 || x.l > 0.94, ny = y.s < 0.16 || y.l < 0.1 || y.l > 0.94;
    if (nx !== ny) return nx ? 1 : -1;
    if (nx) return y.l - x.l;
    var hx = (x.h + 12) % 360, hy = (y.h + 12) % 360;
    return (hx - hy) || (y.l - x.l);
  }
  function isVivid(p) { var c = hslOf(colorsOf(p)[0]); return c.s >= 0.35 && c.l > 0.2 && c.l < 0.85; }

  /* ---------- stock / prix ---------- */
  function hasSpool(p) { return p.sell_price != null; }
  function hasRefill(p) { return p.sell_price_2 != null; }
  function offered(p, type) { return type === 'refill' ? hasRefill(p) : hasSpool(p); }
  function stockOf(p, type) { return type === 'refill' ? (p.qty_2 | 0) : (p.qty | 0); }
  function baseOf(p, type) { return type === 'refill' ? p.sell_price_2 : p.sell_price; }
  function tiersOf(p, type) { return type === 'refill' ? p.tiers_2 : p.tiers; }
  function inStockAs(p, type) { return offered(p, type) && stockOf(p, type) > 0; }
  function anyStock(p) { return inStockAs(p, 'spool') || inStockAs(p, 'refill'); }
  function fmtName(type) { return type === 'refill' ? 'recharge' : 'avec bobine'; }
  function fmtShort(type) { return type === 'refill' ? 'recharge' : 'bobine'; }

  /* ---------- données ---------- */
  var products = [], byId = {}, brandInfo = {}, brands = [], brandByName = {};
  var accessories = [], accById = {};
  var dataReady = false;
  function normAcc(p) {
    return { id: p.id, name: p.name, desc: (p.attrs && p.attrs.description) || '',
             price: +p.sell_price || 0, img: publicUrl(p.image_path),
             qty: (p.qty == null ? null : (p.qty | 0)) };
  }

  var screenCatalog = $('#screen-catalog'), screenProduct = $('#screen-product'),
      catGroups = $('#cat-groups'), catChips = $('#cat-chips'), catHero = $('.cat-hero'),
      crumbsEl = $('#crumbs'), configEl = $('#config');

  // Préférence « en stock seulement » (confort par visiteur : jamais bloquant si le stockage échoue)
  var onlyStock = false;
  try { onlyStock = localStorage.getItem(STOCK_KEY) === '1'; } catch (e) {}
  function setOnlyStock(v) {
    onlyStock = !!v;
    try { localStorage.setItem(STOCK_KEY, onlyStock ? '1' : '0'); } catch (e) {}
    $$('.js-only-stock').forEach(function (i) { i.checked = onlyStock; });
    if (!screenCatalog.hidden) renderCatalog();
    if (!screenProduct.hidden && curColor) renderConfig();
  }
  document.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('js-only-stock')) setOnlyStock(e.target.checked);
  });
  $$('.js-only-stock').forEach(function (i) { i.checked = onlyStock; });

  /* =========================================================
     Routage : chaque étape a sa propre adresse. #/m/<marque> = catalogue
     filtré ; #/m/<marque>/<matériau>/<couleur> = fiche. Le retour du
     navigateur revient à l'étape (et à la couleur) précédente.
     ========================================================= */
  function slug(s) { return encodeURIComponent(String(s == null ? '' : s)); }
  function unslug(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  // Slug auto : minuscules, accents retirés, tirets. Repli si aucun slug perso dans l'admin.
  function slugify(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  var norm = function (s) { return s || 'Autres'; };       // matériau/marque absent => « Autres »
  function brandSlugName(brand) { var b = brandInfo[brand]; return (b && b.slug) || slugify(brand); }
  function matOf(brand, material) { var B = brandByName[brand]; return B ? B.mats[material] || null : null; }
  function matSlugFor(brand, material) {
    var m = matOf(brand, material);
    return (m && m.first.material_slug) || slugify(material);
  }
  function prodSlugFor(colorId) { var p = byId[colorId]; return p ? (p.slug || slugify(p.name)) : slug(colorId); }
  function routeFor(brand, material, colorId) {
    if (!brand) return '#/';
    var h = '#/m/' + brandSlugName(brand);
    if (material) h += '/' + matSlugFor(brand, material);
    if (material && colorId) h += '/' + prodSlugFor(colorId);
    return h;
  }
  // Segment d'URL -> entité : slug perso, slug auto, ancien nom encodé ou ancien id
  // UUID (couleur) -> les liens déjà partagés continuent de fonctionner.
  function resolveBrand(seg) {
    var dec = unslug(seg);
    var hit = brands.filter(function (b) { return brandSlugName(b.name) === seg || slugify(b.name) === seg || b.name === dec; })[0];
    return hit ? hit.name : null;
  }
  function resolveMaterial(brand, seg) {
    var B = brandByName[brand], dec = unslug(seg);
    if (!B) return null;
    var hit = B.materials.filter(function (m) {
      return (m.first.material_slug || slugify(m.name)) === seg || slugify(m.name) === seg || m.name === dec;
    })[0];
    return hit ? hit.name : null;
  }
  function resolveColor(m, seg) {
    var hit = m.items.filter(function (p) {
      return (p.slug || slugify(p.name)) === seg || slugify(p.name) === seg || p.id === seg;
    })[0];
    return hit ? hit.id : null;
  }
  function currentRoute() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    if (parts[0] !== 'm' || !parts[1]) return { brand: null };
    var brand = resolveBrand(parts[1]);
    if (!brand) return { brand: null, bad: true };
    var material = parts[2] ? resolveMaterial(brand, parts[2]) : null;
    var m = material ? matOf(brand, material) : null;
    return { brand: brand, material: material, badMat: !!parts[2] && !material,
             colorId: (m && parts[3]) ? resolveColor(m, parts[3]) : null };
  }
  function pushRoute(hash) { if (location.hash === hash) applyRoute(); else location.hash = hash; }
  function replaceRoute(hash) { history.replaceState(null, '', hash); applyRoute(); }
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', function () {
    // ancres internes (#main du lien d'évitement…) : ce ne sont pas des étapes de la boutique
    if (location.hash && location.hash.indexOf('#/') !== 0) return;
    applyRoute();
  });

  var catBrand = null, catScrollY = null, lastScreen = null;
  function applyRoute() {
    if (!dataReady) return;                         // rejoué une fois les données chargées
    var r = currentRoute();
    if (r.bad) { replaceRoute('#/'); return; }
    if (r.badMat) { replaceRoute(routeFor(r.brand)); return; }
    if (r.material) { showProduct(matOf(r.brand, r.material), r.colorId); return; }
    showCatalog(r.brand);
  }

  function load() {
    if (!sb) { failCatalog('Boutique momentanément indisponible.'); return; }
    Promise.all([
      sb.from('products_public').select('*').eq('type', 'filament').order('sort_order', { ascending: true }).order('name', { ascending: true }),
      sb.from('brands').select('*'),
      sb.from('products_public').select('*').eq('type', 'accessory').order('sort_order', { ascending: true })
    ]).then(function (res) {
      var pr = res[0], br = res[1], ac = res[2];
      if (pr.error) { failCatalog('Impossible de charger la boutique.'); return; }
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
      buildCatalog();
      dataReady = true;
      applyRoute();          // honore l'URL courante (lien direct / retour navigateur)
      renderCart();
    }, function () { failCatalog('Erreur réseau — recharge la page.'); });
  }
  function failCatalog(msg) {
    catGroups.removeAttribute('aria-busy');
    catGroups.innerHTML = '<p class="empty">' + esc(msg) + '</p>';
  }

  /* ---------- modèle : marques → matériaux → couleurs ---------- */
  function buildCatalog() {
    var map = {}, order = [];
    products.forEach(function (p) {
      var b = norm(p.brand), mn = norm(p.material);
      if (!map[b]) { map[b] = { name: b, items: [], mats: {}, order: [] }; order.push(b); }
      var B = map[b];
      B.items.push(p);
      if (!B.mats[mn]) {
        B.mats[mn] = { brand: b, name: mn, items: [], first: p, sort: (p.material_sort == null ? 9999 : p.material_sort) };
        B.order.push(mn);
      }
      B.mats[mn].items.push(p);
    });
    // ordre des marques et des matériaux = sort_order de l'admin (glisser-déposer) ;
    // tri stable => les égalités gardent l'ordre d'apparition.
    order.sort(function (a, b) {
      var oa = brandInfo[a] && brandInfo[a].sort_order != null ? brandInfo[a].sort_order : 9999;
      var ob = brandInfo[b] && brandInfo[b].sort_order != null ? brandInfo[b].sort_order : 9999;
      return oa - ob;
    });
    brandByName = {};
    brands = order.map(function (k) {
      var B = map[k];
      B.order.sort(function (a, b) { return B.mats[a].sort - B.mats[b].sort; });
      B.materials = B.order.map(function (n) {
        var m = B.mats[n], f = m.first;
        m.desc = f.material_desc; m.longDesc = f.material_long_desc; m.specs = f.material_specs;
        m.gallery = f.material_gallery; m.matImage = f.material_image;
        m.hasTiers = m.items.some(function (p) { return normalizeTiers(p.tiers).length || normalizeTiers(p.tiers_2).length; });
        return m;
      });
      brandByName[k] = B;
      return B;
    });
    pickRepresentatives();
  }

  // Photo « vitrine » par matériau : l'image choisie dans l'admin, sinon une
  // couleur EN STOCK et vive, d'une teinte pas déjà utilisée par un autre matériau
  // (le catalogue reste coloré au lieu d'aligner des bobines noires).
  function pickRepresentatives() {
    var used = {};
    brands.forEach(function (B) {
      B.materials.forEach(function (m) {
        if (m.matImage) { m.repImg = publicUrl(m.matImage); m.rep = m.items[0]; return; }
        var withImg = m.items.filter(function (p) { return p.image_path; });
        if (!withImg.length) { m.repImg = ''; m.rep = m.items.filter(anyStock)[0] || m.items[0]; return; }
        var stocked = withImg.filter(anyStock), pool = stocked.length ? stocked : withImg;
        var bucket = function (p) { return Math.round(hslOf(colorsOf(p)[0]).h / 30) % 12; };
        var pick = pool.filter(function (p) { return isVivid(p) && !used[bucket(p)]; })[0] ||
                   pool.filter(isVivid)[0] || pool[0];
        if (isVivid(pick)) used[bucket(pick)] = true;
        m.rep = pick; m.repImg = publicUrl(pick.image_path);
      });
    });
  }
  function minPrice(m) {
    var v = [];
    m.items.forEach(function (p) {
      if (hasSpool(p)) v.push(+p.sell_price);
      if (hasRefill(p)) v.push(+p.sell_price_2);
    });
    v = v.filter(isFinite);
    return v.length ? Math.min.apply(null, v) : null;
  }

  /* =========================================================
     CATALOGUE
     ========================================================= */
  function showCatalog(brand) {
    var fromProduct = lastScreen === 'product', sameScreen = lastScreen === 'catalog';
    catBrand = brand;
    renderCatalog();
    screenProduct.hidden = true; screenCatalog.hidden = false;
    curMat = null; curColor = null; updateBuybar();
    document.title = brand ? 'Filaments ' + brand + ' — Création Audio' : BASE_TITLE;
    if (fromProduct && catScrollY != null) window.scrollTo(0, catScrollY);
    else if (sameScreen) {
      // changement de marque : ramène le haut des résultats sous la barre si on l'a dépassée
      // (mesuré sous le bandeau de titre : la barre collante n'a pas de position fiable)
      var y = catHero.getBoundingClientRect().bottom + window.pageYOffset - topOffset();
      if (window.pageYOffset > y) window.scrollTo(0, y);
    } else window.scrollTo(0, 0);
    lastScreen = 'catalog';
  }
  function topOffset() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h'));
    return isFinite(v) ? v : 68;
  }

  function renderCatalog() {
    var total = products.length, inStock = products.filter(anyStock).length;
    $('#st-colors').textContent = total;
    $('#st-stock').textContent = inStock;
    $('#st-brands').textContent = brands.length;

    // puces de marque (liens réels : clic milieu / partage OK)
    var count = function (items) { return onlyStock ? items.filter(anyStock).length : items.length; };
    catChips.innerHTML = '<a class="chip" href="#/"' + (!catBrand ? ' aria-current="true"' : '') + '>Toutes <span class="chip-n">' + count(products) + '</span></a>' +
      brands.map(function (B) {
        return '<a class="chip" href="' + esc(routeFor(B.name)) + '"' + (catBrand === B.name ? ' aria-current="true"' : '') + '>' +
          esc(B.name) + ' <span class="chip-n">' + count(B.items) + '</span></a>';
      }).join('');
    if (brands.length < 2) catChips.innerHTML = '';

    var list = catBrand ? brands.filter(function (B) { return B.name === catBrand; }) : brands;
    var html = list.map(function (B) {
      var mats = B.materials.filter(function (m) { return !onlyStock || m.items.some(anyStock); });
      if (!mats.length) return '';
      var nStock = B.items.filter(anyStock).length, id = 'g-' + slugify(B.name);
      return '<section class="cat-group" aria-labelledby="' + id + '">' +
        '<header class="cat-ghead">' +
          '<h2 class="cat-gtitle" id="' + id + '">' + esc(B.name) + '</h2>' +
          '<span class="cat-gmeta">' + plural(B.materials.length, 'matériau', 'matériaux') + ' · ' +
            plural(nStock, 'couleur', 'couleurs') + ' en stock</span>' +
          '<span class="cat-grule" aria-hidden="true"></span>' +
        '</header>' +
        '<div class="cat-grid">' + mats.map(matCard).join('') + '</div>' +
      '</section>';
    }).join('');
    catGroups.removeAttribute('aria-busy');
    if (!html) {
      html = '<p class="empty">' + (onlyStock
        ? 'Rien en stock ' + (catBrand ? 'chez ' + esc(catBrand) + ' ' : '') + 'pour le moment. ' +
          '<button type="button" class="js-show-all">Voir aussi les ruptures</button> — tu pourras demander à être avisé.'
        : 'Aucun filament disponible pour le moment.') + '</p>';
    }
    catGroups.innerHTML = html;
    var sa = $('.js-show-all', catGroups);
    if (sa) sa.addEventListener('click', function () { setOnlyStock(false); });
  }

  function matCard(m) {
    var stock = m.items.filter(anyStock).sort(hueSort);
    var src = stock.length ? stock : m.items.slice().sort(hueSort);
    var MAX = 9, extra = src.length - MAX;
    var dots = src.slice(0, MAX).map(function (p) { return '<i style="--c:' + esc(swatchBg(p)) + '"></i>'; }).join('');
    var min = minPrice(m), out = !stock.length;
    var tag = String(m.desc || '').split(/\r?\n/)[0].trim();
    if (tag.length > 90) tag = tag.slice(0, 88).replace(/\s+\S*$/, '') + '…';
    var media = m.repImg ? '<img src="' + esc(m.repImg) + '" alt="" loading="lazy">'
                         : '<span class="mcard-sw" style="background:' + esc(swatchBg(m.rep)) + '"></span>';
    return '<a class="mcard' + (out ? ' is-out' : '') + '" href="' + esc(routeFor(m.brand, m.name)) + '">' +
      '<span class="mcard-media">' + media + (m.hasTiers ? '<span class="mcard-badge">Rabais quantité</span>' : '') + '</span>' +
      '<span class="mcard-body">' +
        '<span class="mcard-name">' + esc(m.name) + '</span>' +
        (tag ? '<span class="mcard-tag">' + esc(tag) + '</span>' : '') +
        '<span class="mcard-dots" aria-hidden="true">' + dots + (extra > 0 ? '<em>+' + extra + '</em>' : '') + '</span>' +
        '<span class="mcard-foot">' +
          '<span class="mcard-price">' + (min != null ? 'dès <b>' + money(min) + '</b>' : '') + '</span>' +
          '<span class="pill ' + (out ? 'out' : 'ok') + '">' + (out ? 'Rupture' : stock.length + ' en stock') + '</span>' +
        '</span>' +
      '</span>' +
    '</a>';
  }

  /* =========================================================
     FICHE COULEUR
     ========================================================= */
  var curMat = null, curColor = null, curType = 'refill', curQty = 1, curImg = 0, curTab = null, curImgs = [];

  function defaultColorOf(m) { return m.items.filter(anyStock)[0] || m.items[0]; }
  function defaultType(p) {
    if (inStockAs(p, 'refill')) return 'refill';
    if (inStockAs(p, 'spool')) return 'spool';
    return hasRefill(p) ? 'refill' : 'spool';
  }

  function showProduct(m, colorId) {
    if (lastScreen === 'catalog') catScrollY = window.pageYOffset;
    var wanted = colorId ? byId[colorId] : null;
    if (curMat === m && lastScreen === 'product') {
      // même matériau : simple changement de couleur, sans remonter la page
      selectColor((wanted || defaultColorOf(m)).id);
      lastScreen = 'product';
      return;
    }
    curMat = m;
    curColor = (wanted && m.items.indexOf(wanted) >= 0) ? wanted : defaultColorOf(m);
    curType = defaultType(curColor); curQty = 1; curImg = 0; curTab = null;
    renderCrumbs();
    renderConfig();
    screenCatalog.hidden = true; screenProduct.hidden = false;
    window.scrollTo(0, 0);
    lastScreen = 'product';
  }
  // Changement de couleur « léger » : on garde le format s'il reste offert.
  function selectColor(id) {
    var np = byId[id]; if (!np || !curMat) return;
    curColor = np;
    if (!offered(curColor, curType)) curType = curType === 'refill' ? 'spool' : 'refill';
    curQty = 1; curImg = 0;
    renderConfig();
  }

  function renderCrumbs() {
    crumbsEl.innerHTML = '<a href="#/">Filaments</a>' + IC.chev +
      '<a href="' + esc(routeFor(curMat.brand)) + '">' + esc(curMat.brand) + '</a>' + IC.chev +
      '<span aria-current="page">' + esc(curMat.name) + '</span>';
  }

  // Images de la couleur (format choisi d'abord) puis photos d'impressions du matériau.
  function galleryOf(m) {
    return Array.isArray(m.gallery) ? m.gallery.filter(function (x) { return typeof x === 'string' && x; }) : [];
  }
  function imagesFor(p) {
    var list = [], seen = {}, a = p.attrs || {};
    var both = !!(a.img_refill && a.img_spool);
    function add(path, kind, tag) {
      if (!path || seen[path]) return;
      seen[path] = 1;
      var u = publicUrl(path);
      if (u) list.push({ url: u, kind: kind, tag: tag || '' });
    }
    var mine = curType === 'refill' ? 'refill' : 'spool', other = mine === 'refill' ? 'spool' : 'refill';
    add(a['img_' + mine], 'prod', both ? (mine === 'refill' ? 'Recharge' : 'Bobine') : '');
    add(p.image_path, 'prod', '');
    add(a['img_' + other], 'prod', both ? (other === 'refill' ? 'Recharge' : 'Bobine') : '');
    galleryOf(curMat).forEach(function (path) { add(path, 'gal', ''); });
    return list;
  }

  function mediaHtml() {
    var p = curColor, imgs = curImgs, it = imgs[curImg];
    var stage = it
      ? '<button type="button" class="pdp-stage" aria-label="Agrandir la photo"><img src="' + esc(it.url) + '" alt="' + esc(p.name + ' — ' + curMat.name) + '">' +
          '<span class="pdp-zoom" aria-hidden="true">' + IC.zoom + '</span></button>'
      : '<div class="pdp-stage no-zoom"><span class="pdp-bigsw" style="background:' + esc(swatchBg(p)) + '"></span></div>';
    var thumbs = '';
    if (imgs.length > 1) {
      var MAX = 6, shown = imgs.length > MAX ? imgs.slice(0, MAX - 1) : imgs;
      thumbs = '<div class="pdp-thumbs">' + shown.map(function (t, i) {
        return '<button type="button" class="pdp-thumb' + (t.kind === 'gal' ? ' is-gal' : '') + (i === curImg ? ' is-active' : '') + '" data-i="' + i + '"' +
          ' aria-label="Photo ' + (i + 1) + ' sur ' + imgs.length + '"' + (i === curImg ? ' aria-current="true"' : '') + '>' +
          '<img src="' + esc(t.url) + '" alt="" loading="lazy">' + (t.tag ? '<span class="pdp-thumb-tag">' + esc(t.tag) + '</span>' : '') + '</button>';
      }).join('') +
      (imgs.length > MAX ? '<button type="button" class="pdp-thumb more" data-i="' + (MAX - 1) + '" data-lb="1" aria-label="Voir les ' + imgs.length + ' photos">+' + (imgs.length - MAX + 1) + '</button>' : '') +
      '</div>';
    }
    return stage + thumbs;
  }
  function renderMedia() {
    var box = $('.pdp-media', configEl); if (!box) return;
    box.innerHTML = mediaHtml();
    wireMedia();
  }
  function wireMedia() {
    var stage = $('.pdp-stage', configEl);
    if (stage && stage.tagName === 'BUTTON') stage.addEventListener('click', function () {
      openLightbox(curImgs.map(function (x) { return x.url; }), curImg);
    });
    $$('.pdp-thumb', configEl).forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.getAttribute('data-i');
        if (b.getAttribute('data-lb')) { openLightbox(curImgs.map(function (x) { return x.url; }), i); return; }
        curImg = i; renderMedia();
        var t = $('.pdp-thumb[data-i="' + i + '"]', configEl); if (t) t.focus();
      });
    });
  }

  function fmtOpt(type, label) {
    if (!offered(curColor, type)) return '';
    var st = stockOf(curColor, type), out = st <= 0, on = curType === type;
    return '<button type="button" class="fmt-opt' + (on ? ' is-active' : '') + (out ? ' is-out' : '') + '" data-type="' + type + '" aria-pressed="' + on + '">' +
      '<span class="fmt-name">' + label + '</span>' +
      '<span class="fmt-meta">' + money(baseOf(curColor, type)) + ' · ' + (out ? 'rupture' : st + ' en stock') + '</span>' +
    '</button>';
  }
  function swStockText(p) {
    if (!offered(p, curType)) return 'offert ' + (curType === 'refill' ? 'avec bobine seulement' : 'en recharge seulement');
    var st = stockOf(p, curType);
    return st > 0 ? st + ' en stock' : 'rupture en ' + fmtShort(curType);
  }
  function unitNow() { return tierPrice(baseOf(curColor, curType), tiersOf(curColor, curType), curQty); }
  function buySumText() {
    if (curQty < 2) return '';
    var base = +baseOf(curColor, curType) || 0, u = unitNow();
    return curQty + ' × ' + money(u) + ' = <b>' + money(u * curQty) + '</b>' + (u < base ? ' <em>· rabais quantité</em>' : '');
  }

  function renderConfig() {
    var p = curColor, m = curMat;
    var stock = stockOf(p, curType), out = !offered(p, curType) || stock <= 0;
    var price = baseOf(p, curType);
    var tiers = normalizeTiers(tiersOf(p, curType));
    curImgs = imagesFor(p);
    if (curImg >= curImgs.length) curImg = 0;

    var tierHtml = tiers.length ? '<div class="pdp-tiers"><span>Rabais quantité</span>' +
      tiers.map(function (t) { return '<span class="pdp-tier"><b>' + t.min + '+</b> à ' + money(t.price) + '</span>'; }).join('') + '</div>' : '';

    // pastilles dans l'ordre de l'admin (sort_order) ; « en stock seulement » garde toujours la couleur affichée
    var items = m.items.slice();
    var hiddenN = 0;
    if (onlyStock) items = items.filter(function (it) {
      var keep = it === p || inStockAs(it, curType);
      if (!keep) hiddenN++;
      return keep;
    });
    var swatches = items.map(function (it) {
      var on = it === p, o = !inStockAs(it, curType);
      return '<button type="button" class="sw' + (on ? ' is-active' : '') + (o ? ' is-out' : '') + '" data-id="' + esc(it.id) + '"' +
        ' style="--c:' + esc(swatchBg(it)) + '" aria-label="' + esc(it.name + ' — ' + swStockText(it)) + '" aria-pressed="' + on + '"' +
        ' tabindex="' + (on ? '0' : '-1') + '"></button>';
    }).join('');

    var descLines = String(m.desc || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var featHtml = descLines.length ? '<div class="pdp-feats"><h2>En bref</h2><ul>' +
      descLines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div>' : '';

    // accessoires : admin (products type=accessory) si présents, sinon repli codé en dur
    var accDisp = accessories.length ? accessories
      : Object.keys(ACC).map(function (k) { var a = ACC[k]; return { id: a.id, name: a.name, desc: a.desc, price: a.price, img: a.img, qty: null }; });
    var accHtml = accDisp.length ? '<div class="pdp-accs" id="pdp-accs"><h2>Bobines vides réutilisables</h2>' + accDisp.map(function (a) {
      var o = a.qty != null && a.qty <= 0;
      return '<div class="acc">' +
        '<div class="acc-thumb">' + (a.img ? '<img src="' + esc(a.img) + '" alt="" loading="lazy">' : '') + '</div>' +
        '<div class="acc-main"><div class="acc-name">' + esc(a.name) + '</div>' + (a.desc ? '<div class="acc-desc">' + esc(a.desc) + '</div>' : '') + '</div>' +
        '<div class="acc-right"><span class="acc-price">' + money(a.price) + '</span>' +
          '<button type="button" class="acc-add" data-acc="' + esc(a.id) + '"' + (o ? ' disabled' : '') +
            ' aria-label="' + esc((o ? 'Rupture : ' : 'Ajouter au panier : ') + a.name) + '">' + (o ? 'Rupture' : '+ Ajouter') + '</button></div>' +
      '</div>';
    }).join('') + '</div>' : '';

    configEl.innerHTML =
      '<div class="pdp">' +
        '<div class="pdp-media">' + mediaHtml() + '</div>' +
        '<div class="pdp-panel">' +
          '<p class="pdp-eyebrow">' + esc(m.brand) + ' · ' + esc(m.name) + '</p>' +
          '<h1 class="pdp-name">' + esc(p.name) + '</h1>' +
          (p.code ? '<p class="pdp-ref">Réf. ' + esc(p.code) + '</p>' : '') +
          '<div class="pdp-priceline">' +
            '<span class="pdp-price">' + money(price) + '<small>/ ' + fmtShort(curType) + '</small></span>' +
            '<span class="pill ' + (out ? 'bad' : 'ok') + '">' + (out ? 'Rupture' : stock + ' en stock') + '</span>' +
          '</div>' +
          tierHtml +

          '<div class="pdp-sec">' +
            '<p class="pdp-label">Format</p>' +
            '<div class="fmt">' + fmtOpt('refill', 'Recharge') + fmtOpt('spool', 'Avec bobine') + '</div>' +
            (curType === 'refill' && accDisp.length ? '<p class="fmt-note">' + IC.info + '<span>La recharge n\'a pas de bobine : elle s\'installe sur une bobine réutilisable. ' +
              '<a href="#pdp-accs" class="js-to-accs">Ajouter une bobine vide</a></span></p>' : '') +
          '</div>' +

          '<div class="pdp-sec">' +
            '<div class="pdp-label">' +
              '<span>Couleur · <b class="js-sw-name">' + esc(p.name) + '</b> <span class="lbl-sub js-sw-sub">— ' + esc(swStockText(p)) + '</span></span>' +
              '<label class="switch"><input type="checkbox" class="js-only-stock"' + (onlyStock ? ' checked' : '') + '><span class="switch-ui" aria-hidden="true"></span>En stock seulement</label>' +
            '</div>' +
            '<div class="sws" role="group" aria-label="Couleurs ' + esc(m.name) + '">' + swatches + '</div>' +
            (hiddenN ? '<p class="sws-note">' + plural(hiddenN, 'couleur en rupture masquée', 'couleurs en rupture masquées') +
              ' · <button type="button" class="js-show-all">Tout afficher</button></p>' : '') +
          '</div>' +

          '<div class="cfg-buy">' +
            (out ? '' :
            '<div class="qty">' +
              '<button type="button" class="q-minus" aria-label="Diminuer la quantité">&minus;</button>' +
              '<input type="number" class="q-val" aria-label="Quantité" min="1" max="' + stock + '" value="' + curQty + '" inputmode="numeric">' +
              '<button type="button" class="q-plus" aria-label="Augmenter la quantité">+</button>' +
            '</div>') +
            '<button type="button" class="btn-add"' + (out ? ' disabled' : '') + '>' + IC.cart + (out ? 'Rupture de stock' : 'Ajouter au panier') + '</button>' +
          '</div>' +
          '<p class="buy-sum" aria-live="polite">' + buySumText() + '</p>' +
          (out && offered(p, curType) ? notifyHtml(p) : '') +

          '<ul class="pdp-assure">' +
            '<li>' + IC.pin + 'Ramassage local à Québec, sur rendez-vous</li>' +
            '<li>' + IC.chat + 'Commande par Messenger ou courriel — on confirme la dispo</li>' +
            '<li>' + IC.card + 'Aucun paiement en ligne</li>' +
          '</ul>' +
          featHtml +
          accHtml +
        '</div>' +
      '</div>' +
      detailsHtml() +
      relatedHtml();

    document.title = p.name + ' — ' + m.name + ' ' + m.brand + ' · Création Audio';
    wireConfig();
    observeBuy();
    updateBuybar();
  }

  /* ---------- onglets : description · spécifications · galerie ---------- */
  function detailsHtml() {
    var m = curMat, tabs = [];
    var paras = String(m.longDesc || '').split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var specs = Array.isArray(m.specs) ? m.specs.filter(function (s) { return s && (s.k || s.v); }) : [];
    var gal = galleryOf(m);
    if (paras.length) tabs.push({ id: 'desc', label: 'Description',
      html: '<div class="pdp-desc">' + paras.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>' });
    if (specs.length) tabs.push({ id: 'specs', label: 'Spécifications',
      html: '<dl class="specs">' + specs.map(function (s) { return '<div class="spec"><dt>' + esc(s.k) + '</dt><dd>' + esc(s.v) + '</dd></div>'; }).join('') + '</dl>' });
    if (gal.length) tabs.push({ id: 'gal', label: 'Galerie', n: gal.length,
      html: '<div class="gal">' + gal.map(function (path, i) {
        return '<button type="button" class="gal-shot" data-i="' + i + '" aria-label="Agrandir la photo ' + (i + 1) + '">' +
          '<img src="' + esc(publicUrl(path)) + '" alt="" loading="lazy"></button>';
      }).join('') + '</div>' });
    if (!tabs.length) return '';
    if (!curTab || !tabs.some(function (t) { return t.id === curTab; })) curTab = tabs[0].id;
    return '<section class="pdp-details" aria-label="Détails du ' + esc(m.name) + '">' +
      '<div class="tabs" role="tablist" aria-label="Détails du ' + esc(m.name) + '">' + tabs.map(function (t) {
        var on = t.id === curTab;
        return '<button type="button" class="tab" role="tab" id="tab-' + t.id + '" aria-controls="panel-' + t.id + '" aria-selected="' + on + '" tabindex="' + (on ? '0' : '-1') + '">' +
          esc(t.label) + (t.n ? '<span class="tab-n">' + t.n + '</span>' : '') + '</button>';
      }).join('') + '</div>' +
      tabs.map(function (t) {
        return '<div class="tabpanel" role="tabpanel" id="panel-' + t.id + '" aria-labelledby="tab-' + t.id + '" tabindex="0"' + (t.id === curTab ? '' : ' hidden') + '>' + t.html + '</div>';
      }).join('') +
    '</section>';
  }
  function selectTab(id, focus) {
    curTab = id;
    $$('.tab', configEl).forEach(function (t) {
      var on = t.id === 'tab-' + id;
      t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    $$('.tabpanel', configEl).forEach(function (p) { p.hidden = p.id !== 'panel-' + id; });
  }

  /* ---------- autres matériaux (même marque, sinon toutes) ---------- */
  function relatedHtml() {
    var m = curMat, B = brandByName[m.brand];
    var same = B.materials.filter(function (x) { return x !== m; });
    var pool = same.length ? same : [].concat.apply([], brands.map(function (b) { return b.materials; })).filter(function (x) { return x !== m; });
    pool = pool.slice().sort(function (a, b) { return (b.items.some(anyStock) ? 1 : 0) - (a.items.some(anyStock) ? 1 : 0); }).slice(0, 4);
    if (!pool.length) return '';
    return '<section class="pdp-related" aria-labelledby="rel-title">' +
      '<div class="rel-head"><h2 id="rel-title">' + (same.length ? 'Autres matériaux ' + esc(m.brand) : 'Explore aussi') + '</h2>' +
        '<a class="rel-link" href="' + esc(same.length ? routeFor(m.brand) : '#/') + '">Tout voir ' + IC.arrow + '</a></div>' +
      '<div class="cat-grid">' + pool.map(matCard).join('') + '</div>' +
    '</section>';
  }

  /* ---------- « M'aviser quand c'est de retour » (format en rupture) ----------
     Courriel seul, envoyé à la RPC waitlist_subscribe (validation, anti-doublon,
     anti-pourriel côté serveur). Champ piège « website » caché = honeypot.
     Loi 25 : usage annoncé au moment de la collecte + lien vers la politique. */
  var notifyDone = {};   // "id|format" -> message de confirmation (survit aux re-rendus)
  function notifyHtml(p) {
    var key = p.id + '|' + curType, done = notifyDone[key];
    return '<div class="cfg-notify">' +
      '<div class="cfg-notify-title">' + IC.bell + 'M\'aviser quand c\'est de retour</div>' +
      (done ? '<p class="cfg-notify-msg ok">' + esc(done) + '</p>' :
      '<form class="cfg-notify-form" novalidate>' +
        '<label class="sr-only" for="cfg-notify-email">Ton courriel</label>' +
        '<input type="email" id="cfg-notify-email" class="cfg-notify-email" required maxlength="254" autocomplete="email" placeholder="ton@courriel.com">' +
        '<input type="text" name="website" class="cfg-hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<button type="submit" class="cfg-notify-btn">M\'aviser</button>' +
      '</form>' +
      '<p class="cfg-notify-msg" aria-live="polite"></p>' +
      '<p class="cfg-notify-legal">On utilise ton courriel <strong>uniquement</strong> pour t\'aviser de l\'arrivée de ce produit (' +
        esc(p.name) + ', ' + fmtName(curType) + '), puis il est supprimé. ' +
        '<a href="confidentialite.html#liste-attente">Politique de confidentialité</a></p>') +
    '</div>';
  }
  function wireNotify() {
    var form = $('.cfg-notify-form', configEl); if (!form) return;
    var p = curColor, type = curType;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('.cfg-notify-email', form), btn = $('.cfg-notify-btn', form), msg = $('.cfg-notify-msg', configEl);
      var val = (email.value || '').trim();
      function say(t, cls) { msg.textContent = t; msg.className = 'cfg-notify-msg' + (cls ? ' ' + cls : ''); }
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(val)) { say('Entre un courriel valide.', 'bad'); email.focus(); return; }
      if (!sb) { say('Service momentanément indisponible.', 'bad'); return; }
      btn.disabled = true; say('Envoi…');
      sb.rpc('waitlist_subscribe', { p_product: p.id, p_kind: type, p_email: val, p_hp: $('.cfg-hp', form).value || '' })
        .then(function (res) {
          btn.disabled = false;
          var r = res && !res.error ? res.data : null;
          if (r === 'ok' || r === 'exists') {
            notifyDone[p.id + '|' + type] = r === 'ok'
              ? '✓ C\'est noté ! On t\'écrit dès que le ' + p.name + ' (' + fmtName(type) + ') est de retour.'
              : 'Tu es déjà sur la liste pour ce produit — on t\'écrit dès son arrivée.';
            if (curColor === p && curType === type) renderConfig();
            return;
          }
          if (r === 'invalid') say('Ce courriel semble invalide.', 'bad');
          else if (r === 'busy') say('Trop de demandes pour le moment — réessaie un peu plus tard.', 'bad');
          else say('Impossible d\'enregistrer ta demande pour le moment. Écris-nous à ' + EMAIL + '.', 'bad');
        }, function () { btn.disabled = false; say('Erreur réseau — réessaie.', 'bad'); });
    });
  }

  var swFocus = false;
  function wireConfig() {
    wireMedia();
    wireNotify();
    $$('.fmt-opt', configEl).forEach(function (b) {
      b.addEventListener('click', function () {
        curType = b.getAttribute('data-type'); curQty = 1; curImg = 0; renderConfig();
        var nb = $('.fmt-opt[data-type="' + curType + '"]', configEl); if (nb) nb.focus();
      });
    });

    // pastilles : chaque couleur = sa propre entrée d'historique ; flèches du clavier
    // pour se déplacer (un seul arrêt de tabulation) ; survol = aperçu du nom.
    var sws = $$('.sw', configEl), nameEl = $('.js-sw-name', configEl), subEl = $('.js-sw-sub', configEl);
    function preview(p) { nameEl.textContent = p.name; subEl.textContent = '— ' + swStockText(p); }
    sws.forEach(function (b, i) {
      var p = byId[b.getAttribute('data-id')];
      b.addEventListener('click', function () {
        swFocus = document.activeElement === b;
        pushRoute(routeFor(curMat.brand, curMat.name, p.id));
      });
      b.addEventListener('mouseenter', function () { preview(p); });
      b.addEventListener('mouseleave', function () { preview(curColor); });
      b.addEventListener('keydown', function (e) {
        var k = e.key, j = -1;
        if (k === 'ArrowRight' || k === 'ArrowDown') j = (i + 1) % sws.length;
        else if (k === 'ArrowLeft' || k === 'ArrowUp') j = (i - 1 + sws.length) % sws.length;
        else if (k === 'Home') j = 0; else if (k === 'End') j = sws.length - 1;
        if (j < 0) return;
        e.preventDefault();
        b.tabIndex = -1; sws[j].tabIndex = 0; sws[j].focus();
        preview(byId[sws[j].getAttribute('data-id')]);
      });
      b.addEventListener('blur', function () { preview(curColor); });
    });
    if (swFocus) { swFocus = false; var act = $('.sw.is-active', configEl); if (act) act.focus(); }

    var qv = $('.q-val', configEl), sum = $('.buy-sum', configEl);
    var maxStock = stockOf(curColor, curType);
    function setQ(n) {
      if (isNaN(n) || n < 1) n = 1;
      if (maxStock && n > maxStock) { n = maxStock; toast('Maximum ' + maxStock + ' en stock.'); }
      curQty = n; if (qv) qv.value = n; sum.innerHTML = buySumText(); updateBuybar();
    }
    if (qv) {
      $('.q-minus', configEl).addEventListener('click', function () { setQ(curQty - 1); });
      $('.q-plus', configEl).addEventListener('click', function () { setQ(curQty + 1); });
      qv.addEventListener('change', function () { setQ(parseInt(this.value, 10)); });
      qv.addEventListener('focus', function () { this.select(); });
    }
    var add = $('.btn-add', configEl);
    if (add) add.addEventListener('click', function () {
      if (add.disabled) return;
      flyToCart($('.pdp-stage img', configEl) || $('.pdp-bigsw', configEl));
      addToCart(curColor.id, curType, curQty);
    });
    $$('.acc-add', configEl).forEach(function (b) {
      b.addEventListener('click', function () { if (b.disabled) return; addAccessory(b.getAttribute('data-acc')); });
    });
    var toAccs = $('.js-to-accs', configEl);
    if (toAccs) toAccs.addEventListener('click', function (e) {
      e.preventDefault();   // pas de changement d'adresse : on défile vers les bobines vides
      var box = $('#pdp-accs', configEl); if (!box) return;
      box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      box.classList.add('is-flash'); setTimeout(function () { box.classList.remove('is-flash'); }, 1600);
      var first = $('.acc-add:not([disabled])', box); if (first) first.focus({ preventScroll: true });
    });
    var showAll = $('.js-show-all', configEl);
    if (showAll) showAll.addEventListener('click', function () { setOnlyStock(false); });

    // onglets (flèches gauche/droite, Début/Fin)
    var tabs = $$('.tab', configEl);
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { selectTab(t.id.replace('tab-', '')); });
      t.addEventListener('keydown', function (e) {
        var j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = tabs.length - 1;
        if (j < 0) return;
        e.preventDefault(); selectTab(tabs[j].id.replace('tab-', ''), true);
      });
    });
    var galUrls = galleryOf(curMat).map(publicUrl);
    $$('.gal-shot', configEl).forEach(function (b) {
      b.addEventListener('click', function () { openLightbox(galUrls, +b.getAttribute('data-i')); });
    });
  }

  /* ---------- barre d'achat collante (mobile) ---------- */
  var buybar = $('#buybar'), bbSw = $('#buybar-sw'), bbName = $('#buybar-name'), bbMeta = $('#buybar-meta'), bbBtn = $('#buybar-btn');
  var buyObs = null, buyInView = true;
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 900px)') : { matches: false };
  function observeBuy() {
    if (buyObs) buyObs.disconnect();
    var el = $('.cfg-buy', configEl);
    if (!el || !('IntersectionObserver' in window)) { buyInView = true; return; }
    buyObs = new IntersectionObserver(function (en) { buyInView = en[0].isIntersecting; updateBuybar(); },
      { rootMargin: '-' + topOffset() + 'px 0px 0px 0px' });
    buyObs.observe(el);
  }
  function updateBuybar() {
    if (!buybar) return;
    var show = !!curColor && !screenProduct.hidden && narrow.matches && !buyInView;
    if (curColor) {
      var out = !offered(curColor, curType) || stockOf(curColor, curType) <= 0;
      bbSw.style.background = swatchBg(curColor);
      bbName.textContent = curColor.name;
      bbMeta.textContent = money(unitNow()) + (curQty > 1 ? ' × ' + curQty : '') + ' · ' + fmtName(curType) + ' · ' + curMat.name;
      bbBtn.textContent = out ? 'M\'aviser' : 'Ajouter';
      bbBtn.classList.toggle('is-notify', out);
    }
    buybar.hidden = !show;
    document.body.classList.toggle('has-buybar', show);
  }
  if (narrow.addEventListener) narrow.addEventListener('change', updateBuybar);
  else if (narrow.addListener) narrow.addListener(updateBuybar);
  if (bbBtn) bbBtn.addEventListener('click', function () {
    if (!curColor) return;
    if (bbBtn.classList.contains('is-notify')) {
      var box = $('.cfg-notify', configEl) || $('.cfg-buy', configEl); if (!box) return;
      box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      var em = $('.cfg-notify-email', box); if (em) em.focus({ preventScroll: true });
      return;
    }
    flyToCart(bbSw);
    addToCart(curColor.id, curType, curQty);
  });

  /* ---------- visionneuse plein écran (flèches, Échap, clic hors photo) ---------- */
  function openLightbox(urls, idx) {
    urls = (urls || []).filter(Boolean);
    if (!urls.length) return;
    var i = Math.max(0, Math.min(idx || 0, urls.length - 1)), back = document.activeElement;
    var multi = urls.length > 1;
    var ov = document.createElement('div');
    ov.className = 'lb';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Photo agrandie');
    ov.innerHTML = '<img alt="">' +
      '<button type="button" class="lb-btn lb-close" aria-label="Fermer">&times;</button>' +
      (multi ? '<button type="button" class="lb-btn lb-prev" aria-label="Photo précédente">&#8249;</button>' +
               '<button type="button" class="lb-btn lb-next" aria-label="Photo suivante">&#8250;</button>' +
               '<div class="lb-count" aria-live="polite"></div>' : '');
    var img = $('img', ov), cnt = $('.lb-count', ov);
    function show() { img.src = urls[i]; if (cnt) cnt.textContent = (i + 1) + ' / ' + urls.length; }
    function go(d) { i = (i + d + urls.length) % urls.length; show(); }
    function close() {
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('cart-lock');
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      if (back && back.focus) back.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (multi && e.key === 'ArrowLeft') go(-1);
      else if (multi && e.key === 'ArrowRight') go(1);
      else if (e.key === 'Tab') {   // garde le focus dans la visionneuse
        var f = $$('button', ov), a = f.indexOf(document.activeElement);
        e.preventDefault(); f[(a + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    }
    ov.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('.lb-prev')) return go(-1);
      if (t.closest('.lb-next')) return go(1);
      if (t === img && multi) return go(1);
      close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    document.body.classList.add('cart-lock');
    show();
    $('.lb-close', ov).focus();
    requestAnimationFrame(function () { ov.classList.add('show'); });
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
    toast(p.name + ' — ' + fmtShort(type) + ' ajouté au panier.');
  }
  function addAccessory(id) {
    var a = accById[id]; if (!a) return;
    var k = keyOf(id, 'accessory');
    var cur = cart[k] ? cart[k].qty : 0;
    var max = (a.qty == null ? Infinity : a.qty);
    if (cur >= max) { toast('Maximum ' + max + ' en stock.'); return; }
    cart[k] = { id: id, type: 'accessory', qty: cur + 1 };
    saveCart(); renderCart(); pulseCart();
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

  function typeLabel(it) { return it.type === 'accessory' ? 'accessoire' : fmtShort(it.type); }
  function thumbHtml(it) {
    var m = metaOf(it);
    if (it.type === 'accessory') return m && m.img ? '<img src="' + esc(m.img) + '" alt="">' : '<span class="citem-sw" style="background:#ddd"></span>';
    var a = m.attrs || {}, url = publicUrl(a['img_' + it.type] || m.image_path);
    return url ? '<img src="' + esc(url) + '" alt="">' : '<span class="citem-sw" style="background:' + esc(swatchBg(m)) + '"></span>';
  }

  function renderCart() {
    var n = count();
    cartCount.textContent = n;
    cartBtn.classList.toggle('has-items', n > 0);
    cartBtn.setAttribute('aria-label', n ? 'Ouvrir le panier (' + plural(n, 'article', 'articles') + ')' : 'Ouvrir le panier');
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
              '<div class="citem-type">' + (it.type === 'accessory' ? 'Accessoire' : esc((m.brand ? m.brand + ' ' : '') + (m.material || ''))) + ' · ' + typeLabel(it) +
                ' · <span class="citem-unit">' + money(unitOf(it)) + '/u</span></div>' +
              '<div class="citem-qty">' +
                '<button type="button" class="cq-minus" aria-label="Retirer un">&minus;</button>' +
                '<input type="number" class="cq-val" aria-label="Quantité" min="0" ' + (isFinite(max) ? 'max="' + max + '" ' : '') + 'value="' + it.qty + '" inputmode="numeric">' +
                '<button type="button" class="cq-plus" aria-label="Ajouter un"' + (isFinite(max) && it.qty >= max ? ' disabled' : '') + '>+</button>' +
              '</div>' +
            '</div>' +
            '<div class="citem-right">' +
              '<button type="button" class="citem-del" aria-label="Supprimer ' + esc(m.name) + '">&times;</button>' +
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
      'px;z-index:70;pointer-events:none;box-shadow:0 8px 24px rgba(20,22,26,.28);' +
      'transition:transform .8s cubic-bezier(.2,.7,.25,1),opacity .8s ease-in;will-change:transform,opacity;';
    if (el.tagName === 'IMG') {
      fly.style.background = '#fff url("' + el.src + '") center / contain no-repeat';
      fly.style.borderRadius = '14px';
    } else { fly.style.background = el.style.background || getComputedStyle(el).backgroundColor; fly.style.borderRadius = '50%'; }
    document.body.appendChild(fly);
    var dx = (to.left + to.width / 2) - (sx + size / 2), dy = (to.top + to.height / 2) - (sy + size / 2);
    fly.getBoundingClientRect(); // commit l'état initial -> la transition part de façon fiable
    fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.12)';
    fly.style.opacity = '0.2';
    var done = false;
    function fin() { if (done) return; done = true; if (fly.parentNode) fly.parentNode.removeChild(fly); pulseCart(); }
    fly.addEventListener('transitionend', fin); setTimeout(fin, 900);
  }

  function openCart() {
    cartPanel.classList.add('is-open'); cartBackdrop.hidden = false; document.body.classList.add('cart-lock');
    var c = $('#cart-close'); if (c) setTimeout(function () { c.focus(); }, 30);
  }
  function closeCart() {
    cartPanel.classList.remove('is-open'); cartBackdrop.hidden = true; document.body.classList.remove('cart-lock');
    cartBtn.focus();
  }
  cartBtn.addEventListener('click', openCart);
  cartBackdrop.addEventListener('click', closeCart);
  $('#cart-close').addEventListener('click', closeCart);
  $('#cart-clear').addEventListener('click', clearCart);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cartPanel.classList.contains('is-open')) closeCart(); });

  /* ---------- commande Messenger / courriel ---------- */
  function orderText() {
    var groups = {}, order = [], extras = [];
    entries().forEach(function (it) {
      var m = metaOf(it); if (!m) return;
      if (it.type === 'accessory') { extras.push('- ' + m.name + ' ×' + it.qty + ' — ' + money(lineTotal(it))); return; }
      var mat = (m.brand ? m.brand + ' ' : '') + (m.material || 'Autres');
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

  /* ---------- stock toujours à jour ----------
     L'onglet peut rester ouvert pendant que des ventes sont facturées ailleurs :
     on relit SEULEMENT les quantités (requête légère) quand l'onglet redevient
     visible, puis toutes les 60 s tant qu'il l'est. Aucun re-rendu si rien n'a
     bougé ; sinon on rafraîchit l'écran courant et le panier (quantités
     ramenées au stock réel, avec un message) sans toucher au défilement. */
  var REFRESH_MS = 60000, lastRefresh = Date.now(), refreshing = false;
  function focusedIn(el) { var a = document.activeElement; return !!(el && a && a !== document.body && el.contains(a)); }
  function refreshStock() {
    if (!sb || !dataReady || refreshing) return;
    refreshing = true; lastRefresh = Date.now();
    sb.from('products_public').select('id,type,qty,qty_2').in('type', ['filament', 'accessory']).then(function (res) {
      refreshing = false;
      if (!res || res.error || !res.data) return;
      var changed = false;
      res.data.forEach(function (r) {
        if (r.type === 'accessory') {
          var a = accById[r.id], q = (r.qty == null ? null : (r.qty | 0));
          if (a && a.qty !== q) { a.qty = q; changed = true; }
          return;
        }
        var p = byId[r.id]; if (!p) return;
        if ((p.qty | 0) !== (r.qty | 0) || (p.qty_2 | 0) !== (r.qty_2 | 0)) { p.qty = r.qty; p.qty_2 = r.qty_2; changed = true; }
      });
      if (!changed) return;
      // panier : ramène chaque ligne au stock réellement disponible
      var trimmed = [];
      Object.keys(cart).forEach(function (k) {
        var it = cart[k], max = maxOf(it);
        if (it.qty > max) {
          var m = metaOf(it); trimmed.push(m ? m.name : '');
          if (max <= 0) delete cart[k]; else it.qty = max;
        }
      });
      if (trimmed.length) {
        saveCart();
        toast('Stock mis à jour : ' + trimmed.filter(Boolean).join(', ') + ' — quantité ajustée dans ton panier.');
      }
      if (trimmed.length || !focusedIn(cartItems)) renderCart();
      if (!screenCatalog.hidden && !focusedIn(catGroups)) renderCatalog();
      // fiche : rafraîchit stock / ruptures, sans interrompre une saisie
      if (curColor && !screenProduct.hidden && !focusedIn(configEl)) {
        var st = stockOf(curColor, curType);
        if (st > 0 && curQty > st) curQty = st;
        renderConfig();
      }
    }, function () { refreshing = false; });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 5000) refreshStock();
  });
  window.addEventListener('focus', function () { if (Date.now() - lastRefresh > 5000) refreshStock(); });
  setInterval(function () { if (document.visibilityState === 'visible') refreshStock(); }, REFRESH_MS);

  load();
})();
