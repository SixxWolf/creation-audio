/* =========================================================
   Création Audio V2 — CMS Accessoires
   Extras vendus en boutique (bobines vides, outils…). Table
   « products » (type = 'accessory'). Prix public + coût/marge,
   stock, photos (la 1re = principale), RABAIS QUANTITÉ (cumulé
   sur la catégorie en boutique et en facturation), catégorie,
   affichage sur la fiche filament (marques visées), fiche
   détaillée (boutique.html#/a/<slug>) : description, specs.
   attrs : category · on_filament · fil_brands [noms ; vide = toutes]
           · description · long_desc · specs [{k, v}] · gallery
   (les autres clés d'attrs — avg_cost, barcodes… — sont conservées)
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var BUCKET = 'products';
  var TYPE = 'accessory';
  var BRAND = 'Création Audio';   // marque interne (comme les spacers)
  var SITE = 'https://creationaudio.ca/';
  var NO_CAT = 'Sans catégorie';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function slugify(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'accessoire';
  }
  function publicUrl(path) {
    if (!path) return '';
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }
  function normalizeTiers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return { min: parseInt(t.min, 10), price: parseFloat(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 2 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; });
  }
  function marginPill(price, cost) {
    var p = +price || 0, c = +cost || 0, m = p - c, pct = p > 0 ? Math.round(m / p * 100) : 0;
    return '<span class="card-margin ' + (m >= 0 ? 'pos' : 'neg') + '">marge ' + money(m) + (p > 0 ? ' · ' + pct + '%' : '') + '</span>';
  }
  function attrsOf(r) { return r && r.attrs && typeof r.attrs === 'object' ? r.attrs : {}; }
  function catOf(r) { return String(attrsOf(r).category || '').trim(); }
  function photosOf(r) {
    var a = attrsOf(r), seen = {}, out = [];
    [r && r.image_path].concat(Array.isArray(a.gallery) ? a.gallery : []).forEach(function (p) {
      if (typeof p === 'string' && p && !seen[p]) { seen[p] = 1; out.push(p); }
    });
    return out;
  }
  // coût réel : coût moyen pondéré des réceptions (attrs.avg_cost.item), sinon coût saisi
  function costOf(r) {
    var ac = attrsOf(r).avg_cost, v = ac && ac.item;
    return (v != null && v !== '') ? +v : (+r.cost_price || 0);
  }

  var loaded = false, editingId = null, editingRow = null, cache = [], selBrands = [];

  var editor = $('#ac-editor'), editorTitle = $('#ac-editor-title'),
      fileInput = $('#ac-file'), galleryEl = $('#ac-gallery'), galleryAdd = $('#ac-gallery-add'),
      nameI = $('#ac-name'), catI = $('#ac-cat'), catList = $('#ac-cat-list'), descI = $('#ac-desc'),
      priceI = $('#ac-price'), costI = $('#ac-cost'), marginEl = $('#ac-margin'), qtyI = $('#ac-qty'),
      tiersEl = $('#ac-tiers'), tierAdd = $('#ac-tier-add'),
      activeI = $('#ac-active'), onFilI = $('#ac-onfil'), brandsEl = $('#ac-brands'),
      linksEl = $('#ac-fiche-links'), longDescI = $('#ac-long-desc'), specsEl = $('#ac-specs'), specAdd = $('#ac-spec-add'),
      statusEl = $('#ac-status'), listEl = $('#ac-list'),
      newBtn = $('#ac-new'), refreshBtn = $('#ac-refresh'),
      saveBtn = $('#ac-save'), cancelBtn = $('#ac-cancel');

  /* ---- activation à l'ouverture de l'onglet ---- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'accessoires' && !loaded) { loaded = true; load(); }
  };

  /* ---- interactions ---- */
  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  if (refreshBtn) refreshBtn.addEventListener('click', load);
  if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
  if (editor) editor.addEventListener('submit', onSave);
  [priceI, costI].forEach(function (el) { if (el) el.addEventListener('input', updateMargin); });
  if (activeI) activeI.addEventListener('change', renderLinks);
  if (onFilI) onFilI.addEventListener('change', function () { brandsEl.hidden = !onFilI.checked; });

  function marginText(el, sell) {
    var s = num(sell), c = num(costI.value);
    el.classList.remove('pos', 'neg');
    if (s == null && c == null) { el.textContent = '—'; return; }
    s = s || 0; c = c || 0; var m = s - c, pct = s > 0 ? Math.round(m / s * 100) : 0;
    el.textContent = money(m) + (s > 0 ? '  (' + pct + '%)' : '');
    el.classList.add(m >= 0 ? 'pos' : 'neg');
  }
  function updateMargin() {
    marginText(marginEl, priceI.value);
    $$('.tier-row', tiersEl).forEach(function (row) { marginText($('.tier-m', row), $('.tier-price', row).value); });
  }

  /* ---- paliers (« à partir de N → prix ») ---- */
  if (tierAdd) tierAdd.addEventListener('click', function () { $('.tier-min', addTierRow()).focus(); });
  function addTierRow(min, price) {
    var row = document.createElement('div');
    row.className = 'tier-row';
    row.innerHTML =
      '<span class="t">À partir de</span>' +
      '<input type="number" class="tier-min" min="2" step="1" placeholder="3" aria-label="Quantité minimum" value="' + (min != null ? min : '') + '">' +
      '<span class="t">→</span>' +
      '<input type="number" class="tier-price money" min="0" step="0.01" placeholder="9.00" aria-label="Prix unitaire" value="' + (price != null ? price : '') + '">' +
      '<span class="t">$</span>' +
      '<span class="tier-m v"></span>' +
      '<button type="button" class="tier-del" aria-label="Retirer ce palier">✕</button>';
    $('.tier-del', row).addEventListener('click', function () { row.remove(); });
    $('.tier-price', row).addEventListener('input', updateMargin);
    tiersEl.appendChild(row);
    marginText($('.tier-m', row), price != null ? price : '');
    return row;
  }
  function collectTiers() {
    return normalizeTiers($$('.tier-row', tiersEl).map(function (row) {
      return { min: $('.tier-min', row).value, price: $('.tier-price', row).value };
    })).map(function (t) { return { min: t.min, price: Math.round(t.price * 100) / 100 }; });
  }

  /* ---- marques visées sur la fiche filament (aucune = toutes) ---- */
  function brandNames() {
    var names = ((window.CA.brands && window.CA.brands.list) || []).map(function (b) { return b.name; });
    selBrands.forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });   // marque renommée/retirée : reste visible
    return names;
  }
  function renderBrands(focusName) {
    if (!brandsEl) return;
    var all = !selBrands.length;
    brandsEl.innerHTML = '<button type="button" class="brand-chip' + (all ? ' is-active' : '') + '" data-b="" aria-pressed="' + all + '">Toutes</button>' +
      brandNames().map(function (n) {
        var on = selBrands.indexOf(n) !== -1;
        return '<button type="button" class="brand-chip' + (on ? ' is-active' : '') + '" data-b="' + esc(n) + '" aria-pressed="' + on + '">' + esc(n) + '</button>';
      }).join('');
    $$('.brand-chip', brandsEl).forEach(function (b) {
      var n = b.getAttribute('data-b');
      if (focusName != null && n === focusName) b.focus();
      b.addEventListener('click', function () {
        if (!n) selBrands = [];
        else if (selBrands.indexOf(n) === -1) selBrands.push(n);
        else selBrands.splice(selBrands.indexOf(n), 1);
        renderBrands(n);
      });
    });
  }

  /* ---- photos (la 1re = photo principale) : ajout multiple, glisser pour réordonner ---- */
  var photos = [];   // [{ path }] (déjà en ligne) ou [{ file, url }] (à téléverser)
  if (galleryAdd) galleryAdd.addEventListener('click', function () { fileInput.click(); });
  if (fileInput) fileInput.addEventListener('change', function () {
    Array.prototype.slice.call(fileInput.files || []).forEach(function (f) { photos.push({ file: f, url: URL.createObjectURL(f) }); });
    fileInput.value = '';
    renderPhotos();
  });
  var gDragI = null;
  function renderPhotos() {
    if (!galleryEl) return;
    galleryEl.innerHTML = '';
    if (!photos.length) {
      var e = document.createElement('button');
      e.type = 'button'; e.className = 'gthumb gthumb-empty'; e.textContent = '+ Photo';
      e.addEventListener('click', function () { fileInput.click(); });
      galleryEl.appendChild(e);
      return;
    }
    photos.forEach(function (it, i) {
      var d = document.createElement('div');
      d.className = 'gthumb'; d.setAttribute('draggable', 'true'); d.dataset.i = i;
      d.innerHTML = '<img src="' + esc(it.url || publicUrl(it.path)) + '" alt="">' +
        '<button type="button" class="gdel" aria-label="Retirer cette photo">✕</button>' +
        (i === 0 ? '<span class="gtag">Principale</span>' : '');
      $('.gdel', d).addEventListener('click', function () { photos.splice(i, 1); renderPhotos(); });
      d.addEventListener('dragstart', function (ev) {
        gDragI = i; d.classList.add('dragging');
        if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', ''); } catch (_) {} }
      });
      d.addEventListener('dragend', function () { gDragI = null; d.classList.remove('dragging'); $$('.gthumb', galleryEl).forEach(function (c) { c.classList.remove('drop-target'); }); });
      d.addEventListener('dragover', function (ev) { ev.preventDefault(); });
      d.addEventListener('dragenter', function () { if (gDragI !== i) d.classList.add('drop-target'); });
      d.addEventListener('dragleave', function () { d.classList.remove('drop-target'); });
      d.addEventListener('drop', function (ev) {
        ev.preventDefault();
        if (gDragI == null || gDragI === i) return;
        photos.splice(i, 0, photos.splice(gDragI, 1)[0]);
        renderPhotos();
      });
      galleryEl.appendChild(d);
    });
  }
  function uploadPhoto(file) {
    var ext = (String(file.name).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = TYPE + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    return sb.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
      .then(function (res) { if (res.error) throw res.error; return path; });
  }

  /* ---- specs libres ---- */
  if (specAdd) specAdd.addEventListener('click', function () { $('.spec-k', addSpecRow()).focus(); });
  function addSpecRow(k, v) {
    var row = document.createElement('div');
    row.className = 'spec-row';
    row.innerHTML =
      '<input type="text" class="spec-k" placeholder="Température max" autocomplete="off" aria-label="Nom de la spec">' +
      '<input type="text" class="spec-v" placeholder="70 °C" autocomplete="off" aria-label="Valeur">' +
      '<button type="button" class="spec-del" aria-label="Retirer cette spec">✕</button>';
    $('.spec-k', row).value = k || '';
    $('.spec-v', row).value = v || '';
    $('.spec-del', row).addEventListener('click', function () { row.remove(); });
    specsEl.appendChild(row);
    return row;
  }
  function collectSpecs() {
    return $$('.spec-row', specsEl).map(function (row) {
      return { k: $('.spec-k', row).value.trim(), v: $('.spec-v', row).value.trim() };
    }).filter(function (s) { return s.k || s.v; });
  }

  /* ---- lien vers la fiche (le slug suit le nom ENREGISTRÉ) ---- */
  function renderLinks() {
    if (!linksEl) return;
    if (!editingRow) { linksEl.innerHTML = ''; return; }
    var s = encodeURIComponent(editingRow.slug || slugify(editingRow.name));
    linksEl.innerHTML = activeI.checked
      ? '<a class="btn btn-ghost btn-sm" href="' + SITE + 'boutique.html#/a/' + s + '" target="_blank" rel="noopener">Voir en boutique ↗</a>'
      : '<span class="hint">Masqué en boutique</span>';
  }

  /* ---- catégories connues (suggestions) ---- */
  function categories() {
    var seen = {}, out = [];
    cache.forEach(function (r) { var c = catOf(r); if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; out.push(c); } });
    return out;
  }

  /* ---- éditeur ---- */
  function openEditor(row) {
    editingId = row ? row.id : null;
    editingRow = row || null;
    var a = attrsOf(row);
    editorTitle.textContent = row ? 'Modifier l\'accessoire' : 'Nouvel accessoire';
    nameI.value = row ? (row.name || '') : '';
    catList.innerHTML = categories().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    catI.value = row ? catOf(row) : '';
    descI.value = a.description || '';
    priceI.value = row && row.sell_price != null ? row.sell_price : '';
    costI.value = row && row.cost_price != null ? row.cost_price : '';
    qtyI.value = row && row.qty != null ? row.qty : 0;
    tiersEl.innerHTML = '';
    normalizeTiers(row ? row.tiers : []).forEach(function (t) { addTierRow(t.min, t.price); });
    activeI.checked = row ? !!row.active : true;
    onFilI.checked = row ? !!a.on_filament : false;
    brandsEl.hidden = !onFilI.checked;
    selBrands = Array.isArray(a.fil_brands) ? a.fil_brands.filter(function (n) { return typeof n === 'string' && n; }) : [];
    renderBrands();
    if (!(window.CA.brands && window.CA.brands.loaded) && window.CA.loadBrands) {
      window.CA.loadBrands().then(function () { renderBrands(); }, function () {});
    }
    photos = photosOf(row).map(function (p) { return { path: p }; });
    renderPhotos();
    longDescI.value = a.long_desc || '';
    specsEl.innerHTML = '';
    (Array.isArray(a.specs) ? a.specs : []).forEach(function (s) { if (s && (s.k || s.v)) addSpecRow(s.k, s.v); });
    renderLinks();
    updateMargin();
    statusEl.textContent = '';
    editor.hidden = false;
    nameI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { editor.hidden = true; editingId = null; editingRow = null; photos = []; selBrands = []; }

  function onSave(e) {
    e.preventDefault();
    var name = nameI.value.trim();
    if (!name) { nameI.focus(); return; }
    // catégorie existante écrite autrement (« bobines vides ») -> on garde l'écriture déjà en place
    var cat = catI.value.trim().replace(/\s+/g, ' ');
    var known = categories().filter(function (c) { return c.toLowerCase() === cat.toLowerCase(); })[0];
    if (known) cat = known;
    // attrs : on repart des attrs existants (avg_cost, barcodes… sont conservés)
    var attrs = Object.assign({}, attrsOf(editingRow), {
      category: cat,                       // toujours écrites (même vides) : le SQL d'amorçage n'y retouche plus
      on_filament: !!onFilI.checked,
      fil_brands: selBrands.slice(),
      description: descI.value.trim() || null,
      specs: collectSpecs(),
      long_desc: longDescI.value.trim() || null
    });
    ['description', 'long_desc'].forEach(function (k) { if (attrs[k] == null) delete attrs[k]; });
    if (!attrs.specs.length) delete attrs.specs;
    var patch = {
      type: TYPE, brand: BRAND, material: null,
      name: name,
      sell_price: Math.max(0, num(priceI.value) || 0),
      dealer_price: null,
      cost_price: Math.max(0, num(costI.value) || 0),
      qty: Math.max(0, parseInt(qtyI.value, 10) || 0),
      qty_2: null,
      tiers: collectTiers(),
      active: !!activeI.checked,
      updated_at: new Date().toISOString()
    };
    var isNew = !editingId;
    var oldPaths = photosOf(editingRow);
    var newCount = photos.filter(function (p) { return !p.path; }).length;

    saveBtn.disabled = true;
    statusEl.textContent = newCount ? 'Téléversement de ' + newCount + ' photo' + (newCount > 1 ? 's' : '') + '…' : 'Enregistrement…';

    Promise.all(photos.map(function (p) { return p.path ? p.path : uploadPhoto(p.file); })).then(function (paths) {
      patch.image_path = paths[0] || null;
      attrs.gallery = paths.slice(1);
      if (!attrs.gallery.length) delete attrs.gallery;
      patch.attrs = attrs;
      if (!isNew) return sb.from('products').update(patch).eq('id', editingId).select().then(function (res) { return { res: res, paths: paths }; });
      patch.sort_order = cache.length ? (Math.max.apply(null, cache.map(function (x) { return x.sort_order || 0; })) + 1) : 0;
      return sb.from('products').insert(patch).select().then(function (res) { return { res: res, paths: paths }; });
    }).then(function (out) {
      var res = out.res;
      saveBtn.disabled = false;
      if (res.error) { statusEl.textContent = 'Erreur : ' + res.error.message; return; }
      if (!res.data || !res.data.length) { statusEl.textContent = 'Refusé (permissions). Es-tu connecté en admin ?'; return; }
      // photos retirées : supprimées du stockage une fois l'enregistrement confirmé
      var gone = oldPaths.filter(function (p) { return out.paths.indexOf(p) === -1; });
      if (gone.length) sb.storage.from(BUCKET).remove(gone).then(null, function () {});
      closeEditor();
      // catégorie changée / nouvel accessoire : on regroupe l'ordre enregistré par catégorie
      load().then(function () { persistOrder(); });
    }, function (err) {
      saveBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }

  /* ---- liste (groupée par catégorie) ---- */
  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return sb.from('products').select('*').eq('type', TYPE)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) {
          listEl.innerHTML = '<p class="empty">Impossible de charger.<br>Si c\'est la première fois, exécute ' +
            '<strong>supabase/schema-v2.sql</strong> dans Supabase.</p>';
          return;
        }
        cache = res.data || [];
        render();
      }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  // catégories dans l'ordre de leur 1er accessoire ; « Sans catégorie » en dernier
  function groups() {
    var map = {}, order = [], none = NO_CAT.toLowerCase();
    cache.forEach(function (r) {
      var c = catOf(r) || NO_CAT, k = c.toLowerCase();
      if (!map[k]) { map[k] = { name: c, items: [] }; order.push(k); }
      map[k].items.push(r);
    });
    order.sort(function (a, b) { return (a === none ? 1 : 0) - (b === none ? 1 : 0); });
    return order.map(function (k) { return map[k]; });
  }

  function priceBlock(r) {
    var c = costOf(r);
    var rows = [{ min: 1, price: +r.sell_price || 0 }].concat(normalizeTiers(r.tiers));
    return rows.map(function (t, i) {
      return '<div class="sp-tierrow"><span class="tp">' + (i === 0 ? '<b>Prix</b>' : t.min + '+') + ' : ' + money(t.price) + '</span>' +
        marginPill(t.price, c) + '</div>';
    }).join('');
  }

  function cardHtml(r) {
    var url = publicUrl(r.image_path), out = (r.qty | 0) <= 0, a = attrsOf(r), nPhotos = photosOf(r).length;
    var fb = Array.isArray(a.fil_brands) ? a.fil_brands : [];
    var tags = (a.on_filament ? '<span class="sp-mini is-feat">★ Fiche filament · ' + esc(fb.length ? fb.join(', ') : 'toutes marques') + '</span>' : '') +
      (nPhotos > 1 ? '<span class="sp-mini">' + nPhotos + ' photos</span>' : '');
    return '<article class="card' + (r.active ? '' : ' is-hidden') + '" data-id="' + esc(r.id) + '" draggable="true">' +
      '<div class="card-thumb">' +
        (url ? '<img src="' + esc(url) + '" alt="' + esc(r.name) + '" loading="lazy">' : '<span class="card-noimg">Pas de photo</span>') +
        (out ? '<span class="badge badge-out">Rupture</span>' : '') +
        (r.active ? '' : '<span class="badge badge-hidden">Masqué</span>') +
        '<span class="drag-handle" title="Glisser pour réordonner">⠿</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="card-name">' + esc(r.name) + '</div>' +
        (tags ? '<div class="sp-minis">' + tags + '</div>' : '') +
        (a.description ? '<p class="card-desc">' + esc(a.description) + '</p>' : '') +
        '<div class="card-stock"><span class="stk' + (out ? ' out' : '') + '">' + (r.qty | 0) + ' en stock</span></div>' +
        '<div class="sp-tiers-break">' + priceBlock(r) + '</div>' +
        '<div class="card-actions">' +
          '<button class="btn btn-ghost card-edit" type="button">Modifier</button>' +
          '<button class="btn btn-ghost card-del" type="button">Suppr.</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function render() {
    if (!cache.length) {
      listEl.innerHTML = '<p class="empty">Aucun accessoire pour l\'instant.<br>' +
        'Clique «&nbsp;Nouvel accessoire&nbsp;» pour créer le premier.</p>';
      return;
    }
    listEl.innerHTML = groups().map(function (g, gi) {
      return '<section class="ac-group" aria-labelledby="ac-g' + gi + '">' +
        '<h2 class="ac-ghead" id="ac-g' + gi + '">' + esc(g.name) + ' <span>' + g.items.length + '</span></h2>' +
        '<div class="cards ac-cards">' + g.items.map(cardHtml).join('') + '</div>' +
      '</section>';
    }).join('');

    $$('.card', listEl).forEach(function (card) {
      var id = card.getAttribute('data-id');
      var row = cache.filter(function (x) { return String(x.id) === id; })[0];
      $('.card-edit', card).addEventListener('click', function () { openEditor(row); });
      $('.card-del', card).addEventListener('click', function () { del(row); });
      wireDrag(card, row);
    });
  }

  function del(row) {
    if (!window.confirm('Supprimer « ' + row.name + ' » ? Action définitive.')) return;
    sb.from('products').delete().eq('id', row.id).select().then(function (res) {
      if (res.error) { window.alert('Erreur : ' + res.error.message); return; }
      if (!res.data || !res.data.length) { window.alert('Suppression refusée (permissions).'); return; }
      var paths = photosOf(row);
      if (paths.length) sb.storage.from(BUCKET).remove(paths).then(null, function () {});
      load();
    });
  }

  /* ---- glisser-déposer : réordonne DANS une catégorie ---- */
  var dragRow = null;
  function sameCat(a, b) { return !!(a && b) && catOf(a).toLowerCase() === catOf(b).toLowerCase(); }
  function wireDrag(card, row) {
    card.addEventListener('dragstart', function (e) {
      dragRow = row; card.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', row.id); } catch (_) {} }
    });
    card.addEventListener('dragend', function () { dragRow = null; card.classList.remove('dragging'); $$('.card', listEl).forEach(function (c) { c.classList.remove('drop-target'); }); });
    card.addEventListener('dragover', function (e) { if (!sameCat(dragRow, row)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
    card.addEventListener('dragenter', function () { if (dragRow !== row && sameCat(dragRow, row)) card.classList.add('drop-target'); });
    card.addEventListener('dragleave', function () { card.classList.remove('drop-target'); });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!dragRow || dragRow === row || !sameCat(dragRow, row)) return;
      var from = cache.indexOf(dragRow), to = cache.indexOf(row);
      if (from < 0 || to < 0) return;
      cache.splice(to, 0, cache.splice(from, 1)[0]);
      render(); persistOrder();
    });
  }
  // ordre enregistré = catégories à la suite (ordre de la liste), puis ordre dans chaque catégorie
  function persistOrder() {
    cache = [].concat.apply([], groups().map(function (g) { return g.items; }));
    var updates = cache.map(function (r, i) {
      if (r.sort_order === i) return null; r.sort_order = i;
      return sb.from('products').update({ sort_order: i, updated_at: new Date().toISOString() }).eq('id', r.id);
    }).filter(Boolean);
    if (updates.length) Promise.all(updates).then(null, function () {});
  }
})();
