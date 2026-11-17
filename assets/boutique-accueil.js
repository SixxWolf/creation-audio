/* =========================================================
   Création Audio — accueil de la boutique (boutique.html, 2026-11-14)
   « Que cherchez-vous aujourd'hui ? » : une tuile par rayon (photo +
   chiffre lus dans products_public), puis « En promotion » et
   « Nouveautés » tous rayons confondus (cartes .mcard de boutique.css).
   Liens relatifs à la page (boutique/…) : la version /en/ garde sa langue.
   Rayons : boutique/filaments#/m/<marque>/<matériau> ·
            boutique/accessoires#/a/<slug> · boutique/spacers#/s/<slug>
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA || {}, sb = CA.sb, PR = CA.promo;
  var _t = CA.t, tn = CA.tn, money = CA.money;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function publicUrl(path) {
    if (!path || !sb) return '';
    try { return sb.storage.from('products').getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }
  // même slugify que boutique.js (minuscules, accents retirés, tirets)
  function slugify(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  var brandSlug = {}, brandImg = {}, brandOrder = {};
  function brandSeg(b) { return brandSlug[b] || slugify(b || 'Autres'); }
  function matHref(p) { return 'boutique/filaments#/m/' + brandSeg(p.brand) + '/' + (p.material_slug || slugify(p.material || 'Autres')); }
  function hrefOf(p) {
    if (p.type === 'filament') return matHref(p);
    if (p.type === 'spacer') return 'boutique/spacers#/s/' + encodeURIComponent(p.slug || p.id);
    return 'boutique/accessoires#/a/' + encodeURIComponent(p.slug || slugify(p.name) || p.id);
  }
  function brandBadge(b) {
    var u = brandImg[b] ? publicUrl(brandImg[b]) : '';
    return u ? '<span class="mcard-brand"><img src="' + esc(u) + '" alt="' + esc(b) + '" loading="lazy"></span>' : '';
  }
  function hasSpool(p) { return p.sell_price != null && (p.qty | 0) > 0; }
  function hasRefill(p) { return p.sell_price_2 != null && (p.qty_2 | 0) > 0; }
  function inStock(p) { return p.type === 'filament' ? hasSpool(p) || hasRefill(p) : p.qty == null || (p.qty | 0) > 0; }
  function fromPrice(p) {
    if (p.type !== 'filament') return p.sell_price != null ? +p.sell_price : null;
    var v = [];
    if (hasSpool(p)) v.push(+p.sell_price);
    if (hasRefill(p)) v.push(+p.sell_price_2);
    if (!v.length) [p.sell_price, p.sell_price_2].forEach(function (x) { if (x != null) v.push(+x); });
    return v.length ? Math.min.apply(null, v) : null;
  }
  function media(p) {
    var u = publicUrl((p.type === 'filament' && p.material_image) || p.image_path);
    return u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '<span class="mcard-sw" style="background:' + esc(p.hex || '#ddd') + '"></span>';
  }

  /* ---------- tuiles : photo + chiffre de chaque rayon ---------- */
  function setTile(k, img, meta) {
    var m = $('#bq-img-' + k), t = $('#bq-n-' + k);
    if (m && img) m.innerHTML = '<img src="' + esc(img) + '" alt="" loading="lazy">';
    if (t && meta) t.innerHTML = meta;
  }
  function renderTiles(rows) {
    var fils = rows.filter(function (p) { return p.type === 'filament'; });
    var spa = rows.filter(function (p) { return p.type === 'spacer'; });
    var acc = rows.filter(function (p) { return p.type === 'accessory'; });
    // filaments : la photo de matériau du matériau qui a le plus de couleurs en stock
    var byMat = {};
    fils.forEach(function (p) {
      if (!p.material_image) return;
      var k = p.brand + '|' + p.material, g = byMat[k] || (byMat[k] = { img: p.material_image, n: 0, o: brandOrder[p.brand] || 0 });
      if (inStock(p)) g.n++;
    });
    var best = Object.keys(byMat).map(function (k) { return byMat[k]; }).sort(function (a, b) { return b.n - a.n || a.o - b.o; })[0];
    var filImg = best ? publicUrl(best.img) : (fils.filter(function (p) { return p.image_path; })[0] ? publicUrl(fils.filter(function (p) { return p.image_path; })[0].image_path) : '');
    var nFil = fils.filter(inStock).length;
    setTile('fil', filImg, fils.length ? tn(fils.length, '{n} couleur', '{n} couleurs') + (nFil ? ' · ' + tn(nFil, '{n} en stock', '{n} en stock') : '') : '');
    var sImg = spa.filter(function (p) { return p.image_path; })[0];
    setTile('spa', sImg ? publicUrl(sImg.image_path) : '', spa.length ? tn(spa.length, '{n} modèle', '{n} modèles') : '');
    var aImg = acc.filter(function (p) { return p.image_path; })[0];
    setTile('acc', aImg ? publicUrl(aImg.image_path) : (CA.siteRoot || '') + 'assets/img/spool-reusable.png',
      acc.length ? tn(acc.length, '{n} article', '{n} articles') : '');
  }

  /* ---------- cartes : filaments groupés par marque + matériau, le reste un par un ---------- */
  function groups(rows, keep) {
    var map = {}, order = [];
    rows.forEach(function (p) {
      var info = keep(p); if (!info) return;
      var key = p.type === 'filament' ? 'f|' + (p.brand || '') + '|' + (p.material || '') : 'i|' + p.id;
      var g = map[key];
      if (!g) { g = map[key] = { p: p, n: 0, pc: 0, min: null, reg: null }; order.push(key); }
      g.n++;
      if (info.pc > g.pc) g.pc = info.pc;
      if (info.now != null && (g.min == null || info.now < g.min)) { g.min = info.now; g.reg = info.reg; }
      if (!g.p.material_image && !g.p.image_path && (p.material_image || p.image_path)) g.p = p;
    });
    return order.map(function (k) { return map[k]; });
  }
  function card(g, kind) {
    var p = g.p, isF = p.type === 'filament';
    var name = isF ? (p.material || _t('Filament')) : p.name;
    var sub = isF ? (kind === 'promo' ? tn(g.n, '{n} couleur en promo', '{n} couleurs en promo') : tn(g.n, '{n} couleur', '{n} couleurs'))
      : p.type === 'spacer' ? _t('Spacer') : _t('Accessoire');
    return '<a class="mcard' + (kind === 'promo' ? ' is-promo' : '') + '" href="' + esc(hrefOf(p)) + '">' +
      '<span class="mcard-media">' + media(p) + (kind === 'promo' ? PR.ribbon(g.pc) : PR.newTag()) + (isF ? brandBadge(p.brand) : '') + '</span>' +
      '<span class="mcard-body">' +
        '<span class="mcard-name">' + esc(name) + '</span>' +
        '<span class="' + (kind === 'promo' && isF ? 'mcard-promo' : 'mcard-tag') + '">' + esc(sub) + '</span>' +
        '<span class="mcard-foot"><span class="mcard-price">' + (g.min != null
          ? (isF ? _t('dès') + ' ' : '') + (kind === 'promo' && g.reg != null ? '<s>' + money(g.reg) + '</s> ' : '') + '<b>' + money(g.min) + '</b>' : '') +
        '</span></span>' +
      '</span>' +
    '</a>';
  }
  function renderPromos(rows) {
    var sec = $('#bq-promos'), grid = $('#bq-promos-grid');
    if (!sec || !grid || !PR) return;
    var list = groups(rows, function (p) {
      if (!p.promo_id) return null;
      var on1 = p.promo_on && p.reg_price != null, on2 = p.promo_on_2 && p.reg_price_2 != null;
      if (!on1 && !on2) return null;
      var reg = on1 ? +p.reg_price : +p.reg_price_2, now = on1 ? +p.sell_price : +p.sell_price_2;
      var pc = PR.pct(reg, now);
      return pc ? { pc: pc, now: now, reg: reg } : null;
    }).sort(function (a, b) { return b.pc - a.pc; });
    if (!list.length) { sec.hidden = true; return; }
    var ends = null;
    list.forEach(function (g) { var e = g.p.promo_ends; if (e && (!ends || e < ends)) ends = e; });
    $('#bq-promos-meta').textContent = ends ? PR.endText(ends) : '';
    grid.innerHTML = list.slice(0, 8).map(function (g) { return card(g, 'promo'); }).join('');
    sec.hidden = false;
  }
  function renderNew(rows) {
    var sec = $('#bq-new'), grid = $('#bq-new-grid');
    if (!sec || !grid || !PR) return;
    var list = groups(rows, function (p) { return PR.isNew(p) ? { pc: 0, now: fromPrice(p), reg: null } : null; });
    if (!list.length) { sec.hidden = true; return; }
    grid.innerHTML = list.slice(0, 8).map(function (g) { return card(g, 'new'); }).join('');
    sec.hidden = false;
  }

  /* ---------- pack mis en avant (table packs, 2026-11-16) : bandeau sous les tuiles ---------- */
  function renderPack(pks, rows) {
    var el = $('#bq-pack'), en = CA.lang === 'en';
    var byId = {}; rows.forEach(function (p) { byId[p.id] = p; });
    var pk = (pks || []).filter(function (x) { return x.featured && (x.colors || []).some(function (id) { return byId[id]; }); })[0];
    if (!el || !pk) return;
    var units = (pk.units | 0) || 4, unit = Math.round(+pk.price / Math.max(1, units) * 100) / 100, spool = pk.kind === 'spool';
    var hexes = (pk.colors || []).map(function (id) { var p = byId[id]; var c = p && p.attrs && Array.isArray(p.attrs.colors) && p.attrs.colors[0]; return c || (p && p.hex) || null; })
      .filter(function (h) { return /^#[0-9a-fA-F]{6}$/.test(h || ''); });
    var art = '';
    for (var i = 0; i < units && hexes.length; i++) {
      var h = hexes[i % hexes.length];
      art += '<i style="background:' + (spool ? 'radial-gradient(circle, #f3f3f0 0 17%, ' + h + ' 18% 70%, #2b2f36 71%)' : 'radial-gradient(circle, #f3f3f0 0 22%, ' + h + ' 23%)') + '"></i>';
    }
    $('#bq-pack-art').innerHTML = art;
    $('#bq-pack-name').textContent = (en && pk.name_en) || pk.name;
    $('#bq-pack-meta').innerHTML = tn(units, spool ? '{n} bobine' : '{n} recharge', spool ? '{n} bobines' : '{n} recharges') + ' · <b>' + money(+pk.price) + '</b> · ' +
      money(unit) + ' ' + (spool ? _t('la bobine') : _t('la recharge'));
    if (pk.slug) el.href = 'boutique/packs#/p/' + encodeURIComponent(pk.slug);
    el.hidden = false;
  }

  function load() {
    if (!sb) return;
    var cols = 'id,type,name,brand,material,hex,attrs,image_path,material_image,slug,material_slug,sell_price,sell_price_2,qty,qty_2,sort_order,' +
      'promo_id,promo_ends,promo_on,promo_on_2,reg_price,reg_price_2';
    Promise.all([
      sb.from('products_public').select(cols).in('type', ['filament', 'spacer', 'accessory']).order('sort_order', { ascending: true }).limit(2000),
      sb.from('brands').select('name,sort_order,slug,image_path'),
      sb.from('packs').select('*').order('sort_order', { ascending: true })
    ]).then(function (res) {
      var pr = res[0], br = res[1];
      if (!pr || pr.error || !pr.data) return;
      ((br && br.data) || []).forEach(function (b) {
        brandOrder[b.name] = b.sort_order || 0;
        brandSlug[b.name] = b.slug || slugify(b.name);
        if (b.image_path) brandImg[b.name] = b.image_path;
      });
      var rows = pr.data;
      renderTiles(rows);
      renderPromos(rows);
      renderNew(rows);
      if (res[2] && !res[2].error) renderPack(res[2].data, rows);
      if (res[2] && res[2].data && res[2].data.length) { var tp = $('a[data-tab="packs"]'); if (tp) tp.hidden = false; }
    }, function () {});
  }
  load();
})();
