/* =========================================================
   Création Audio — page d'accueil (v3 · sept. 2026)
   Tout est lu en anonyme dans la vue products_public (aucun coût
   exposé) + brands (slugs/ordre) + product_popularity (qté vendue).
   - Héros : bobine SVG qui prend la couleur choisie dans le nuancier
     (couleurs EN STOCK triées par teinte). Défilement auto doux tant
     que le visiteur n'a pas touché au nuancier (coupé si « réduire
     les animations »).
   - Matériaux en stock (bande de leurs couleurs), top 5 populaires,
     aperçu spacers / accessoires, compteurs du héros.
   Décoratif : si la base est injoignable, la page reste utilisable
   (liens vers la boutique, palette de repli pour la bobine).
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  // « 20 $ » pour un prix rond, « 15,99 $ » sinon (compteurs compacts)
  function priceShort(n) { n = +n || 0; return (n % 1 === 0 ? String(n) : n.toFixed(2).replace('.', ',')) + ' $'; }

  var sb = window.CA && window.CA.sb;
  var BUCKET = 'products';
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function publicUrl(path) {
    if (!path || !sb) return '';
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }
  // Même slugify que boutique.js (minuscules, accents retirés, tirets).
  function slugify(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /* =========================================================
     Couleurs
     ========================================================= */
  function isHex(h) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(h || '')); }
  function hex6(h) {
    h = String(h).toLowerCase();
    return h.length === 4 ? '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] : h;
  }
  function colorsOf(p) {
    var cs = (p.attrs && Array.isArray(p.attrs.colors)) ? p.attrs.colors.filter(isHex) : [];
    if (!cs.length && isHex(p.hex)) cs = [p.hex];
    if (!cs.length) cs = ['#c8c8c8'];
    return cs.slice(0, 3).map(hex6);
  }
  function rgbOf(h) { h = hex6(h); return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function mix(a, b) {
    var x = rgbOf(a), y = rgbOf(b);
    return '#' + [0, 1, 2].map(function (i) { return ('0' + Math.round((x[i] + y[i]) / 2).toString(16)).slice(-2); }).join('');
  }
  function hslOf(h) {
    var c = rgbOf(h).map(function (v) { return v / 255; });
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
  // 3 arrêts de dégradé pour la bobine (1, 2 ou 3 couleurs)
  function stopsOf(cs) {
    if (cs.length === 1) return [cs[0], cs[0], cs[0]];
    if (cs.length === 2) return [cs[0], mix(cs[0], cs[1]), cs[1]];
    return cs;
  }
  // fond d'une pastille : uni, ou moitié/moitié pour les bicolores (Silk)
  function swatchBg(cs) {
    if (cs.length === 1) return cs[0];
    if (cs.length === 2) return 'linear-gradient(135deg,' + cs[0] + ' 50%,' + cs[1] + ' 50%)';
    return 'conic-gradient(' + cs[0] + ' 0 33.3%,' + cs[1] + ' 0 66.6%,' + cs[2] + ' 0)';
  }
  // tri « spectre » : teintes vives d'abord (rouge → violet), puis neutres du clair au foncé
  function hueSort(a, b) {
    var x = hslOf(a._cs[0]), y = hslOf(b._cs[0]);
    var nx = x.s < 0.16 || x.l < 0.1 || x.l > 0.94, ny = y.s < 0.16 || y.l < 0.1 || y.l > 0.94;
    if (nx !== ny) return nx ? 1 : -1;
    if (nx) return y.l - x.l;
    var hx = (x.h + 12) % 360, hy = (y.h + 12) % 360;
    return (hx - hy) || (y.l - x.l);
  }
  function finishOf(material) {
    var m = String(material || '').toLowerCase();
    if (/silk|soie/.test(m)) return 'silk';
    if (/matte|mat\b/.test(m)) return 'matte';
    if (/translucent|transparent|clear/.test(m)) return 'trans';
    return 'basic';
  }

  /* =========================================================
     Stock / prix / liens
     ========================================================= */
  function hasSpool(p) { return p.sell_price != null && (p.qty | 0) > 0; }
  function hasRefill(p) { return p.sell_price_2 != null && (p.qty_2 | 0) > 0; }
  function inStock(p) { return hasSpool(p) || hasRefill(p); }
  // « dès » = le format le moins cher réellement disponible (sinon le moins cher offert)
  function fromPrice(p) {
    var avail = [];
    if (hasSpool(p)) avail.push(+p.sell_price);
    if (hasRefill(p)) avail.push(+p.sell_price_2);
    if (!avail.length) [p.sell_price, p.sell_price_2].forEach(function (v) { if (v != null) avail.push(+v); });
    return avail.length ? Math.min.apply(null, avail) : null;
  }
  function stockText(p) {
    var s = hasSpool(p), r = hasRefill(p);
    return s && r ? 'Bobine + recharge' : s ? 'Bobine en stock' : r ? 'Recharge en stock' : '';
  }

  var brandSlug = {}, brandOrder = {};
  function brandSeg(brand) { return brandSlug[brand] || slugify(brand || 'Autres'); }
  function matUrl(p) { return 'boutique.html#/m/' + brandSeg(p.brand) + '/' + (p.material_slug || slugify(p.material || 'Autres')); }
  function filUrl(p) { return matUrl(p) + '/' + (p.slug || slugify(p.name)); }

  /* =========================================================
     HÉROS — bobine interactive
     ========================================================= */
  var hero = $('#hero'), rail = $('#rail'), card = $('#sw-card'), spin = $('#spin'), live = $('#sw-live');
  var swMeta = $('#sw-meta'), swName = $('#sw-name'), swPrice = $('#sw-price'), swStock = $('#sw-stock');
  var items = [], cur = -1, timer = null, userTook = false, heroVisible = true, hovering = false, spinDeg = 0;
  var CYCLE_MS = 2800;

  // lignes d'enroulement du filament (demi-ellipses visibles du cylindre)
  (function () {
    var d = '', x;
    for (x = 181; x <= 336; x += 5.5) d += 'M' + x.toFixed(1) + ' 73A66.9 152 0 0 0 ' + x.toFixed(1) + ' 377';
    var w = $('#windings'), wl = $('#windings-l');
    if (w) w.setAttribute('d', d);
    if (wl) wl.setAttribute('d', d);
  })();

  function centerInRail(btn) {
    if (!btn || !rail) return;
    var rb = rail.getBoundingClientRect(), bb = btn.getBoundingClientRect();
    rail.scrollTo({ left: rail.scrollLeft + (bb.left - rb.left) - (rb.width - bb.width) / 2 });
  }

  function select(i, fromUser) {
    var p = items[i]; if (!p || !hero) return;
    cur = i;
    var st = stopsOf(p._cs);
    hero.style.setProperty('--c1', st[0]);
    hero.style.setProperty('--c2', st[1]);
    hero.style.setProperty('--c3', st[2]);
    hero.setAttribute('data-finish', finishOf(p.material));
    if (spin && !reduceMotion) { spinDeg += 120; spin.style.transform = 'rotate(' + spinDeg + 'deg)'; }

    swMeta.textContent = [p.brand, p.material].filter(Boolean).join(' · ') || 'Filament';
    swName.textContent = p.name;
    var fp = fromPrice(p);
    swPrice.innerHTML = fp != null ? 'dès <b>' + money(fp) + '</b>' : '';
    swStock.textContent = stockText(p);
    card.href = p._url;
    card.setAttribute('aria-label', 'Voir ' + p.name + (p.material ? ' — ' + p.material : '') + ' dans la boutique');

    $$('.sw', rail).forEach(function (b, j) {
      b.setAttribute('aria-pressed', j === i ? 'true' : 'false');
      b.tabIndex = j === i ? 0 : -1;               // tabulation « itinérante » : 1 seul arrêt
    });
    centerInRail(rail.children[i]);
    if (fromUser && live) live.textContent = p.name + (p.material ? ', ' + p.material : '') + (fp != null ? ', dès ' + money(fp) : '');
  }

  function canPlay() { return !reduceMotion && !userTook && heroVisible && !hovering && !document.hidden && items.length > 1; }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function play() {
    stop();
    if (canPlay()) timer = setInterval(function () { select((cur + 1) % items.length, false); }, CYCLE_MS);
  }
  function takeOver() { userTook = true; stop(); }

  function buildRail(list, startIdx) {
    items = list;
    if (!rail || !items.length) return;
    rail.innerHTML = items.map(function (p) {
      var label = p.name + (p.material ? ' — ' + p.material : '');
      return '<button type="button" class="sw" tabindex="-1" aria-pressed="false" style="--sw:' + esc(swatchBg(p._cs)) +
        '" aria-label="' + esc(label) + '" title="' + esc(label) + '"></button>';
    }).join('');
    select(Math.max(0, Math.min(startIdx || 0, items.length - 1)), false);
    play();
  }

  if (rail) {
    rail.addEventListener('click', function (e) {
      var b = e.target.closest('.sw'); if (!b) return;
      takeOver(); select($$('.sw', rail).indexOf(b), true);
    });
    rail.addEventListener('keydown', function (e) {
      var k = e.key, n = items.length, next = -1;
      if (!n) return;
      if (k === 'ArrowRight' || k === 'ArrowDown') next = (cur + 1) % n;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') next = (cur - 1 + n) % n;
      else if (k === 'Home') next = 0;
      else if (k === 'End') next = n - 1;
      if (next < 0) return;
      e.preventDefault(); takeOver(); select(next, true);
      if (rail.children[next]) rail.children[next].focus({ preventScroll: true });
    });
    var scrollRail = function (dir) { takeOver(); rail.scrollBy({ left: dir * rail.clientWidth * 0.8 }); };
    var prev = $('#rail-prev'), next = $('#rail-next');
    if (prev) prev.addEventListener('click', function () { scrollRail(-1); });
    if (next) next.addEventListener('click', function () { scrollRail(1); });
  }
  var stage = $('.hero-stage');
  if (stage) {
    stage.addEventListener('mouseenter', function () { hovering = true; stop(); });
    stage.addEventListener('mouseleave', function () { hovering = false; play(); });
    stage.addEventListener('focusin', function () { hovering = true; stop(); });
    stage.addEventListener('focusout', function () { hovering = false; play(); });
  }
  document.addEventListener('visibilitychange', play);
  if (hero && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { heroVisible = en[0].isIntersecting; play(); }, { threshold: 0.2 }).observe(hero);
  }

  // Palette de repli (base injoignable) : la bobine reste vivante, liens vers la boutique.
  var FALLBACK = [
    ['Rouge', '#C12E1F'], ['Orange', '#FF6A13'], ['Jaune', '#FCE300'], ['Vert', '#00AE42'], ['Turquoise', '#00B1B7'],
    ['Bleu', '#0056B8'], ['Violet', '#8671CB'], ['Rose', '#F5547C'], ['Blanc', '#FFFFFF'], ['Gris', '#8E9089'], ['Noir', '#1B1B1B']
  ].map(function (c) { return { name: c[0], material: 'PLA', brand: '', hex: c[1], _cs: [c[1]], _url: 'boutique.html' }; });

  /* =========================================================
     Sections alimentées par la base
     ========================================================= */
  var matGrid = $('#mat-grid'), popGrid = $('#pop-grid');
  var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  function setText(sel, v) { var el = $(sel); if (el) el.textContent = v; }
  function done(grid) { if (grid) grid.removeAttribute('aria-busy'); }
  function emptyNote(grid, msg) { if (grid) { grid.innerHTML = '<p class="empty-note">' + msg + '</p>'; done(grid); } }

  function renderMaterials(fils) {
    if (!matGrid) return 0;
    var groups = {}, keys = [];
    fils.forEach(function (p) {
      var k = (p.brand || 'Autres') + '|' + (p.material || 'Autres');
      if (!groups[k]) { groups[k] = { brand: p.brand || 'Autres', material: p.material || 'Autres', first: p, all: [], stock: [] }; keys.push(k); }
      groups[k].all.push(p);
      if (inStock(p)) groups[k].stock.push(p);
    });
    var mats = keys.map(function (k) { return groups[k]; }).filter(function (g) { return g.stock.length; });
    mats.sort(function (a, b) {
      var ba = brandOrder[a.brand] != null ? brandOrder[a.brand] : 99, bb = brandOrder[b.brand] != null ? brandOrder[b.brand] : 99;
      return (ba - bb) || ((a.first.material_sort || 0) - (b.first.material_sort || 0)) || a.material.localeCompare(b.material, 'fr');
    });
    if (!mats.length) { emptyNote(matGrid, 'Le stock se renouvelle — <a href="boutique.html">voir toute la boutique</a>.'); return 0; }

    matGrid.innerHTML = mats.map(function (g) {
      var band = g.stock.slice().sort(hueSort).slice(0, 28).map(function (p, i) {
        return '<i style="--s:' + esc(swatchBg(p._cs)) + ';--i:' + i + '"></i>';
      }).join('');
      var mins = g.stock.map(fromPrice).filter(function (v) { return v != null; });
      var min = mins.length ? Math.min.apply(null, mins) : null;
      var tag = String(g.first.material_desc || '').split(/\r?\n/)[0].trim();
      if (tag.length > 90) tag = tag.slice(0, 88).replace(/\s+\S*$/, '') + '…';
      var n = g.stock.length;
      return '<a class="mat-card" href="' + esc(matUrl(g.first)) + '">' +
        '<span class="mat-band" aria-hidden="true">' + band + '</span>' +
        '<span class="mat-go" aria-hidden="true">' + ARROW + '</span>' +
        '<span class="mat-body">' +
          '<span class="mat-brand">' + esc(g.brand) + '</span>' +
          '<span class="mat-name">' + esc(g.material) + '</span>' +
          (tag ? '<span class="mat-tag">' + esc(tag) + '</span>' : '') +
          '<span class="mat-foot"><span><b>' + n + '</b> couleur' + (n > 1 ? 's' : '') + ' en stock</span>' +
            (min != null ? '<span class="mat-price">dès <b>' + priceShort(min) + '</b></span>' : '') + '</span>' +
        '</span></a>';
    }).join('');
    done(matGrid);
    return mats.length;
  }

  function renderPopular(fils, pop) {
    if (!popGrid) return;
    fils.forEach(function (p) { p._pop = pop[p.id] || 0; });
    var inS = fils.filter(inStock);
    var pool = (inS.length >= 5 ? inS : fils).slice();
    pool.sort(function (a, b) {
      return (b._pop - a._pop) ||
        ((b.image_path ? 1 : 0) - (a.image_path ? 1 : 0)) ||
        ((a.material_sort || 0) - (b.material_sort || 0)) || ((a.sort_order || 0) - (b.sort_order || 0));
    });
    var top = pool.slice(0, 5);
    if (!top.length) { emptyNote(popGrid, 'Aucun filament à afficher pour l\'instant.'); return; }
    var ranked = top.some(function (p) { return p._pop > 0; });
    if (!ranked) {                                  // pas encore de ventes : on ne prétend pas à un classement
      setText('#populaires .eyebrow', 'Sélection');
      setText('#populaires h2', 'À découvrir');
    }
    popGrid.innerHTML = top.map(function (p, i) {
      var url = publicUrl(p.image_path), fp = fromPrice(p), ok = inStock(p);
      var media = url
        ? '<img src="' + esc(url) + '" alt="' + esc(p.name + (p.material ? ' — ' + p.material : '')) + '" loading="lazy">'
        : '<span class="swatch" style="background:' + esc(swatchBg(p._cs)) + '"></span>';
      return '<a class="pop-card" href="' + esc(filUrl(p)) + '">' +
        '<span class="pop-media">' + media + '</span>' +
        '<span class="pop-body">' +
          '<span class="pop-meta"><i class="pop-dot" style="background:' + esc(swatchBg(p._cs)) + '"></i><span>' + esc(p.material || 'Filament') + '</span>' +
            (ranked ? '<b class="pop-rank" aria-label="Rang ' + (i + 1) + '">#' + (i + 1) + '</b>' : '') + '</span>' +
          '<span class="pop-name">' + esc(p.name) + '</span>' +
          '<span class="pop-foot">' + (fp != null ? '<span>dès <b>' + money(fp) + '</b></span>' : '<span></span>') +
            '<span class="pill ' + (ok ? 'ok' : 'out') + '">' + (ok ? 'En stock' : 'Épuisé') + '</span></span>' +
        '</span></a>';
    }).join('');
    done(popGrid);
  }

  function renderExtras(rows) {
    var spa = rows.filter(function (p) { return p.type === 'spacer'; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    var acc = rows.filter(function (p) { return p.type === 'accessory'; });
    var minOf = function (list) {
      var v = list.map(function (p) { return p.sell_price; }).filter(function (x) { return x != null; }).map(Number);
      return v.length ? Math.min.apply(null, v) : null;
    };
    var sMin = minOf(spa), aMin = minOf(acc), thumbs = $('#spa-thumbs');
    if (spa.length) {
      var el = $('#spa-meta');
      if (el) el.innerHTML = (sMin != null ? 'dès <b>' + money(sMin) + '</b> la paire · ' : '') + spa.length + ' modèle' + (spa.length > 1 ? 's' : '');
    }
    if (thumbs) {
      thumbs.innerHTML = spa.filter(function (p) { return p.image_path; }).slice(0, 3).map(function (p) {
        return '<span><img src="' + esc(publicUrl(p.image_path)) + '" alt="" loading="lazy"></span>';
      }).join('');
    }
    if (aMin != null) { var am = $('#acc-meta'); if (am) am.innerHTML = 'dès <b>' + money(aMin) + '</b>'; }
  }

  function renderStats(fils, nMats) {
    var inS = fils.filter(inStock);
    if (inS.length) setText('#k-stock', inS.length);
    var mins = inS.map(fromPrice).filter(function (v) { return v != null; });
    if (mins.length) setText('#f-min', 'dès ' + priceShort(Math.min.apply(null, mins)));
    if (nMats) setText('#f-mats', nMats + ' matériau' + (nMats > 1 ? 'x' : ''));
  }

  function fail() {
    buildRail(FALLBACK, 1);
    emptyNote(matGrid, 'Catalogue momentanément indisponible — <a href="boutique.html">ouvrir la boutique</a> ou <a href="#contact">nous écrire</a>.');
    emptyNote(popGrid, 'Catalogue momentanément indisponible.');
  }

  function load() {
    if (!sb) { fail(); return; }
    var cols = 'id,type,name,brand,material,hex,attrs,image_path,slug,material_slug,material_desc,material_sort,sell_price,sell_price_2,qty,qty_2,sort_order';
    Promise.all([
      sb.from('products_public').select(cols).in('type', ['filament', 'spacer', 'accessory']).limit(2000),
      sb.from('brands').select('name,sort_order,slug'),
      sb.from('product_popularity').select('product_id,qty_sold')
    ]).then(function (res) {
      var pr = res[0], br = res[1], po = res[2];
      if (!pr || pr.error || !pr.data) { fail(); return; }
      ((br && br.data) || []).forEach(function (b) {
        brandOrder[b.name] = b.sort_order || 0;
        brandSlug[b.name] = b.slug || slugify(b.name);
      });
      var pop = {};
      ((po && !po.error && po.data) || []).forEach(function (r) { pop[r.product_id] = +r.qty_sold || 0; });

      var rows = pr.data;
      var fils = rows.filter(function (p) { return p.type === 'filament'; });
      fils.forEach(function (p) { p._cs = colorsOf(p); p._url = filUrl(p); });

      // nuancier du héros : couleurs en stock, en spectre ; départ sur la couleur VIVE
      // la plus vendue (un noir sur la bobine noire ne met rien en valeur)
      var railItems = fils.filter(inStock).sort(hueSort);
      if (!railItems.length) railItems = fils.slice().sort(hueSort).slice(0, 40);
      var vivid = function (p) { var c = hslOf(p._cs[0]); return c.s >= 0.35 && c.l > 0.2 && c.l < 0.85; };
      var best = railItems.reduce(function (bi, p, i) {
        var b = railItems[bi], sp = (vivid(p) ? 1e6 : 0) + (pop[p.id] || 0), sb2 = (vivid(b) ? 1e6 : 0) + (pop[b.id] || 0);
        return sp > sb2 ? i : bi;
      }, 0);
      if (railItems.length) buildRail(railItems, best); else buildRail(FALLBACK, 1);

      var nMats = renderMaterials(fils);
      renderPopular(fils, pop);
      renderExtras(rows);
      renderStats(fils, nMats);
    }, fail);
  }
  load();

  /* =========================================================
     Apparition douce des sections au défilement
     ========================================================= */
  if ('IntersectionObserver' in window && !reduceMotion) {
    var targets = $$('.sec-head, .mat-grid, .pop-grid, .steps, .bento, .box-panel, .contact-card');
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(function (t) { t.classList.add('reveal'); io.observe(t); });
    document.documentElement.classList.add('js-reveal');
  }
})();
