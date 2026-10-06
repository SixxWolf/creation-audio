/* =========================================================
   Création Audio V2 — CMS Spacers
   Pièces imprimées 3D (adaptateurs, entretoises…). Table
   « products » (type = 'spacer'). Prix propre + coût/marge,
   stock, photos (la 1re = principale), paliers de rabais,
   résumé, réordonnancement, et FICHE DÉTAILLÉE (spacers.html +
   portail dealer) : taille du haut-parleur, compatibilité
   véhicules, description, specs.
   attrs : description · speaker_size · fitment [{make, model, from, to, pos}]
           · specs [{k, v}] · long_desc · gallery [photos après la 1re]
           · replaces [{brand, ref}] (pièce d'origine ; vide = conception maison)
   (les autres clés d'attrs — avg_cost, barcodes… — sont conservées)
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var BUCKET = 'products';
  var TYPE = 'spacer';
  var BRAND = 'Création Audio';   // marque interne (les spacers ne sont pas des filaments de marque)
  var SITE = 'https://creationaudio.ca/';
  var PART_BRANDS = ['Metra', 'PAC', 'Scosche'];   // fabricants de pièces d'origine proposés (saisie libre aussi)
  var MAKES = ['Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat', 'Ford', 'GMC', 'Genesis',
    'Honda', 'Hyundai', 'Infiniti', 'Jeep', 'Kia', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan',
    'Pontiac', 'Ram', 'Subaru', 'Toyota', 'Volkswagen', 'Volvo'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function yearOf(v) { var n = parseInt(v, 10); return isFinite(n) && n >= 1900 && n <= 2100 ? n : null; }
  function slugify(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'spacer';
  }
  function publicUrl(path) {
    if (!path) return '';
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }
  function normalizeTiers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return { min: parseInt(t.min, 10), price: parseFloat(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; });
  }
  function marginPill(price, cost) {
    var p = +price || 0, c = +cost || 0, m = p - c, pct = p > 0 ? Math.round(m / p * 100) : 0;
    return '<span class="card-margin ' + (m >= 0 ? 'pos' : 'neg') + '"><span class="cm-w">marge </span>' + money(m) + (p > 0 ? ' · ' + pct + '%' : '') + '</span>';
  }
  // Prix CLIENT (public, à plat) puis prix DEALER (base + rabais quantité),
  // chacun avec sa marge. Les rabais quantité ne concernent que le dealer.
  function priceBlock(r) {
    var c = +r.cost_price || 0;
    var html = '<div class="sp-tierrow"><span class="tp"><b>Client</b> : ' + money(r.sell_price) + '</span>' + marginPill(r.sell_price, c) + '</div>';
    var dealerBase = r.dealer_price != null ? r.dealer_price : r.sell_price;
    var rows = [{ min: 1, price: +dealerBase || 0 }].concat(normalizeTiers(r.tiers).filter(function (t) { return t.min > 1; }));
    html += rows.map(function (t, i) {
      var label = i === 0 ? '<b>Dealer</b>' : (t.min + '+ paires');
      return '<div class="sp-tierrow"><span class="tp">' + label + ' : ' + money(t.price) + '</span>' + marginPill(t.price, c) + '</div>';
    }).join('');
    return html;
  }
  function attrsOf(r) { return r && r.attrs && typeof r.attrs === 'object' ? r.attrs : {}; }
  function photosOf(r) {
    var a = attrsOf(r), seen = {}, out = [];
    [r && r.image_path].concat(Array.isArray(a.gallery) ? a.gallery : []).forEach(function (p) {
      if (typeof p === 'string' && p && !seen[p]) { seen[p] = 1; out.push(p); }
    });
    return out;
  }

  var loaded = false, editingId = null, editingRow = null, cache = [];

  var editor = $('#sp-editor'), editorTitle = $('#sp-editor-title'),
      fileInput = $('#sp-file'), galleryEl = $('#sp-gallery'), galleryAdd = $('#sp-gallery-add'),
      nameI = $('#sp-name'), descI = $('#sp-desc'), priceI = $('#sp-price'), costI = $('#sp-cost'),
      dealerPriceI = $('#sp-dealer-price'), marginEl = $('#sp-margin'), marginDealerEl = $('#sp-margin-dealer'),
      qtyI = $('#sp-qty'), activeI = $('#sp-active'),
      tiersEl = $('#sp-tiers'), tierAdd = $('#sp-tier-add'),
      sizeI = $('#sp-size'), linksEl = $('#sp-fiche-links'), linksField = $('#sp-fiche-field'),
      fitEl = $('#sp-fit'), fitAdd = $('#sp-fit-add'), makeList = $('#sp-make-list'),
      longDescI = $('#sp-long-desc'), specsEl = $('#sp-specs'), specAdd = $('#sp-spec-add'),
      replEl = $('#sp-repl'), replAdd = $('#sp-repl-add'), replOwnEl = $('#sp-repl-own'), brandList = $('#sp-brand-list'),
      statusEl = $('#sp-status'), listEl = $('#sp-list'),
      newBtn = $('#sp-new'), refreshBtn = $('#sp-refresh'),
      saveBtn = $('#sp-save'), cancelBtn = $('#sp-cancel');

  /* ---- activation à l'ouverture de l'onglet ---- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'spacers' && !loaded) { loaded = true; load(); }
  };

  /* ---- interactions ---- */
  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  if (refreshBtn) refreshBtn.addEventListener('click', load);
  if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
  if (editor) editor.addEventListener('submit', onSave);
  [priceI, dealerPriceI, costI].forEach(function (el) { if (el) el.addEventListener('input', updateMargin); });
  if (nameI) nameI.addEventListener('input', renderLinks);
  if (activeI) activeI.addEventListener('change', renderLinks);

  function marginTo(el, sell) {
    var s = num(sell), c = num(costI.value);
    if (s == null && c == null) { el.textContent = '—'; el.className = 'v'; return; }
    s = s || 0; c = c || 0; var m = s - c, pct = s > 0 ? Math.round(m / s * 100) : 0;
    el.textContent = money(m) + (s > 0 ? '  (' + pct + '%)' : '');
    el.className = 'v ' + (m >= 0 ? 'pos' : 'neg');
  }
  function updateMargin() {
    marginTo(marginEl, priceI.value);
    marginTo(marginDealerEl, dealerPriceI.value);
  }

  /* ---- paliers ---- */
  if (tierAdd) tierAdd.addEventListener('click', function () { addTierRow(); });
  function addTierRow(min, price) {
    var row = document.createElement('div');
    row.className = 'tier-row';
    row.innerHTML =
      '<span class="t">À partir de</span>' +
      '<input type="number" class="tier-min" min="1" step="1" placeholder="6" value="' + (min != null ? min : '') + '">' +
      '<span class="t">paires →</span>' +
      '<input type="number" class="tier-price money" min="0" step="0.01" placeholder="13.99" value="' + (price != null ? price : '') + '">' +
      '<span class="t">$ /paire</span>' +
      '<button type="button" class="tier-del" aria-label="Retirer ce palier">✕</button>';
    $('.tier-del', row).addEventListener('click', function () { row.remove(); });
    tiersEl.appendChild(row);
    return row;
  }
  function collectTiers() {
    return $$('.tier-row', tiersEl).map(function (row) {
      return { min: parseInt($('.tier-min', row).value, 10), price: parseFloat($('.tier-price', row).value) };
    }).filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; })
      .map(function (t) { return { min: t.min, price: Math.round(t.price * 100) / 100 }; });
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

  /* ---- compatibilité véhicules ---- */
  if (fitAdd) fitAdd.addEventListener('click', function () {
    var last = $$('.fit-row', fitEl).pop();
    var r = addFitRow(last ? { make: $('.fit-make', last).value } : null);   // même marque que la ligne d'avant : saisie rapide
    $(last ? '.fit-model' : '.fit-make', r).focus();
  });
  function addFitRow(f) {
    f = f || {};
    var row = document.createElement('div');
    row.className = 'fit-row';
    row.innerHTML =
      '<input type="text" class="fit-make" list="sp-make-list" placeholder="Marque" aria-label="Marque" autocomplete="off">' +
      '<input type="text" class="fit-model" placeholder="Modèle" aria-label="Modèle" autocomplete="off">' +
      '<input type="number" class="fit-from" min="1950" max="2100" step="1" placeholder="De" aria-label="Année de début">' +
      '<input type="number" class="fit-to" min="1950" max="2100" step="1" placeholder="À" aria-label="Année de fin">' +
      '<input type="text" class="fit-pos" list="sp-pos-list" placeholder="Emplacement" aria-label="Emplacement (facultatif)" title="Facultatif — ex. Portes avant" autocomplete="off">' +
      '<button type="button" class="spec-del" aria-label="Retirer ce véhicule">✕</button>';
    $('.fit-make', row).value = f.make || '';
    $('.fit-model', row).value = f.model || '';
    $('.fit-from', row).value = f.from != null ? f.from : '';
    $('.fit-to', row).value = f.to != null ? f.to : '';
    $('.fit-pos', row).value = f.pos || '';
    $('.spec-del', row).addEventListener('click', function () { row.remove(); });
    fitEl.appendChild(row);
    return row;
  }
  function collectFitment() {
    return $$('.fit-row', fitEl).map(function (row) {
      var from = yearOf($('.fit-from', row).value), to = yearOf($('.fit-to', row).value);
      if (from && to && from > to) { var t = from; from = to; to = t; }   // années inversées : on remet dans l'ordre
      var f = { make: $('.fit-make', row).value.trim(), model: $('.fit-model', row).value.trim(), from: from, to: to, pos: $('.fit-pos', row).value.trim() };
      if (!f.pos) delete f.pos;
      if (f.from == null) delete f.from;
      if (f.to == null) delete f.to;
      return f;
    }).filter(function (f) { return f.make || f.model; });
  }
  function buildMakeList() {
    if (!makeList) return;
    var seen = {};
    MAKES.forEach(function (m) { seen[m] = 1; });
    cache.forEach(function (r) { (attrsOf(r).fitment || []).forEach(function (f) { if (f && f.make) seen[f.make] = 1; }); });
    makeList.innerHTML = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'fr'); })
      .map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
  }

  /* ---- pièce d'origine remplacée : fabricant + n° (« Remplace PAC HKSB110 ») ---- */
  if (replAdd) replAdd.addEventListener('click', function () { $('.repl-brand', addReplRow()).focus(); });
  function addReplRow(x) {
    x = x || {};
    var row = document.createElement('div');
    row.className = 'spec-row repl-row';
    row.innerHTML =
      '<input type="text" class="spec-k repl-brand" list="sp-brand-list" placeholder="Fabricant" aria-label="Fabricant" autocomplete="off">' +
      '<input type="text" class="spec-v repl-ref" placeholder="N° de pièce" aria-label="Numéro de la pièce remplacée" autocomplete="off">' +
      '<button type="button" class="spec-del" aria-label="Retirer cette pièce">✕</button>';
    $('.repl-brand', row).value = x.brand || '';
    $('.repl-ref', row).value = x.ref || '';
    $('.spec-del', row).addEventListener('click', function () { row.remove(); replOwn(); });
    replEl.appendChild(row);
    replOwn();
    return row;
  }
  function replOwn() { if (replOwnEl) replOwnEl.hidden = !!$('.repl-row', replEl); }
  function collectReplaces() {
    return $$('.repl-row', replEl).map(function (row) {
      return { brand: $('.repl-brand', row).value.trim(), ref: $('.repl-ref', row).value.trim() };
    }).filter(function (x) { return x.ref; });
  }
  function buildBrandList() {
    if (!brandList) return;
    var seen = {}, out = [];
    PART_BRANDS.concat.apply(PART_BRANDS, cache.map(function (r) { return (attrsOf(r).replaces || []).map(function (x) { return x && x.brand; }); }))
      .forEach(function (b) { b = String(b || '').trim(); if (b && !seen[b.toLowerCase()]) { seen[b.toLowerCase()] = 1; out.push(b); } });
    brandList.innerHTML = out.map(function (b) { return '<option value="' + esc(b) + '">'; }).join('');
  }
  function replacesLabel(r) {
    return (attrsOf(r).replaces || []).filter(function (x) { return x && x.ref; })
      .map(function (x) { return (x.brand ? x.brand + ' ' : '') + x.ref; }).join(' · ');
  }

  /* ---- specs libres ---- */
  if (specAdd) specAdd.addEventListener('click', function () { $('.spec-k', addSpecRow()).focus(); });
  function addSpecRow(k, v) {
    var row = document.createElement('div');
    row.className = 'spec-row';
    row.innerHTML =
      '<input type="text" class="spec-k" placeholder="Matériau" autocomplete="off" aria-label="Nom de la spec">' +
      '<input type="text" class="spec-v" placeholder="PETG noir" autocomplete="off" aria-label="Valeur">' +
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

  /* ---- liens vers la fiche (site public + portail dealer) ---- */
  function renderLinks() {
    if (!linksEl) return;
    var name = nameI.value.trim();
    if (linksField) linksField.hidden = !editingId || !name;
    if (!editingId || !name) { linksEl.innerHTML = ''; return; }
    // le slug suit le nom ENREGISTRÉ (un nom modifié non enregistré n'a pas encore de fiche)
    var s = encodeURIComponent((editingRow && editingRow.slug) || slugify(editingRow ? editingRow.name : name));
    linksEl.innerHTML =
      // vraie page (générée aux 6 h) ; pas encore publiée -> la 404 renvoie vers spacers.html#/s/<slug>
      '<a class="btn btn-ghost btn-sm" href="' + SITE + 'spacer/' + s + '.html" target="_blank" rel="noopener">Site public ↗</a>' +
      '<a class="btn btn-ghost btn-sm" href="' + SITE + 'dealer.html#/s/' + s + '" target="_blank" rel="noopener">Portail dealer ↗</a>' +
      (activeI.checked ? '' : '<span class="hint">Masqué en boutique</span>');
  }

  /* ---- éditeur ---- */
  function openEditor(row) {
    editingId = row ? row.id : null;
    editingRow = row || null;
    var a = attrsOf(row);
    editorTitle.textContent = row ? 'Modifier le spacer' : 'Nouveau spacer';
    nameI.value = row ? (row.name || '') : '';
    descI.value = a.description || '';
    priceI.value = row && row.sell_price != null ? row.sell_price : '';
    dealerPriceI.value = row && row.dealer_price != null ? row.dealer_price : '';
    costI.value = row && row.cost_price != null ? row.cost_price : '';
    qtyI.value = row && row.qty != null ? row.qty : 0;
    activeI.checked = row ? !!row.active : true;
    tiersEl.innerHTML = '';
    normalizeTiers(row ? row.tiers : []).forEach(function (t) { addTierRow(t.min, t.price); });
    photos = photosOf(row).map(function (p) { return { path: p }; });
    renderPhotos();
    sizeI.value = a.speaker_size || '';
    fitEl.innerHTML = '';
    (Array.isArray(a.fitment) ? a.fitment : []).forEach(function (f) { addFitRow(f); });
    buildMakeList();
    longDescI.value = a.long_desc || '';
    specsEl.innerHTML = '';
    (Array.isArray(a.specs) ? a.specs : []).forEach(function (s) { if (s && (s.k || s.v)) addSpecRow(s.k, s.v); });
    replEl.innerHTML = '';
    (Array.isArray(a.replaces) ? a.replaces : []).forEach(function (x) { if (x && (x.brand || x.ref)) addReplRow(x); });
    replOwn();
    buildBrandList();
    renderLinks();
    updateMargin();
    statusEl.textContent = '';
    editor.hidden = false;
    nameI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { editor.hidden = true; editingId = null; editingRow = null; photos = []; }

  function onSave(e) {
    e.preventDefault();
    var name = nameI.value.trim();
    if (!name) { nameI.focus(); return; }
    // attrs : on repart des attrs existants (avg_cost, barcodes… sont conservés)
    var attrs = Object.assign({}, attrsOf(editingRow), {
      description: descI.value.trim() || null,
      speaker_size: sizeI.value.trim() || null,
      fitment: collectFitment(),
      specs: collectSpecs(),
      long_desc: longDescI.value.trim() || null,
      replaces: collectReplaces()
    });
    ['description', 'speaker_size', 'long_desc'].forEach(function (k) { if (attrs[k] == null) delete attrs[k]; });
    if (!attrs.fitment.length) delete attrs.fitment;
    if (!attrs.specs.length) delete attrs.specs;
    if (!attrs.replaces.length) delete attrs.replaces;
    var patch = {
      type: TYPE, brand: BRAND, material: null,
      name: name,
      sell_price: Math.max(0, num(priceI.value) || 0),
      dealer_price: dealerPriceI.value !== '' ? Math.max(0, num(dealerPriceI.value) || 0) : null,
      cost_price: Math.max(0, num(costI.value) || 0),
      qty: Math.max(0, parseInt(qtyI.value, 10) || 0),
      qty_2: null,
      tiers: collectTiers(),
      active: !!activeI.checked,
      updated_at: new Date().toISOString()
    };
    var oldPaths = photosOf(editingRow);
    var newCount = photos.filter(function (p) { return !p.path; }).length;

    saveBtn.disabled = true;
    statusEl.textContent = newCount ? 'Téléversement de ' + newCount + ' photo' + (newCount > 1 ? 's' : '') + '…' : 'Enregistrement…';

    Promise.all(photos.map(function (p) { return p.path ? p.path : uploadPhoto(p.file); })).then(function (paths) {
      patch.image_path = paths[0] || null;
      attrs.gallery = paths.slice(1);
      if (!attrs.gallery.length) delete attrs.gallery;
      patch.attrs = attrs;
      if (editingId) return sb.from('products').update(patch).eq('id', editingId).select().then(function (res) { return { res: res, paths: paths }; });
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
      load();
    }, function (err) {
      saveBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }

  /* ---- liste ---- */
  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return sb.from('products').select('*').eq('type', TYPE)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) {
          listEl.innerHTML = '<p class="empty">Impossible de charger.<br>Si c\'est la première fois, exécute ' +
            '<strong>V2/supabase/schema-v2.sql</strong> dans Supabase.</p>';
          return;
        }
        cache = res.data || [];
        render();
      }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  function render() {
    if (!cache.length) {
      listEl.innerHTML = '<p class="empty">Aucun spacer pour l\'instant.<br>' +
        'Clique «&nbsp;+ Nouveau spacer&nbsp;» pour créer le premier.</p>';
      return;
    }
    listEl.innerHTML = cache.map(function (r) {
      var url = publicUrl(r.image_path), out = (r.qty | 0) <= 0, a = attrsOf(r);
      var nPhotos = photosOf(r).length, nFit = Array.isArray(a.fitment) ? a.fitment.length : 0, repl = replacesLabel(r);
      var tags = '<span class="sp-mini">' + (repl ? 'Remplace ' + esc(repl) : 'Création Audio') + '</span>' +
        (a.speaker_size ? '<span class="sp-mini">' + esc(a.speaker_size) + '</span>' : '') +
        (nFit ? '<span class="sp-mini">' + nFit + ' véhicule' + (nFit > 1 ? 's' : '') + '</span>'
              : '<span class="sp-mini is-warn" title="Ajoute la compatibilité pour la recherche « civic 2008 »">Sans compatibilité</span>') +
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
          '<div class="sp-minis">' + tags + '</div>' +
          '<div class="card-stock"><span class="stk' + (out ? ' out' : '') + '">' + (r.qty | 0) + ' paire' + ((r.qty | 0) > 1 ? 's' : '') + ' en stock</span></div>' +
          '<div class="sp-tiers-break">' + priceBlock(r) + '</div>' +
          '<div class="card-actions">' +
            '<button class="btn btn-ghost card-edit" type="button">Modifier</button>' +
            '<button class="btn btn-ghost card-del" type="button">Suppr.</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    $$('.card', listEl).forEach(function (card) {
      var id = card.getAttribute('data-id');
      var row = cache.filter(function (x) { return String(x.id) === id; })[0];
      $('.card-edit', card).addEventListener('click', function () { openEditor(row); });
      $('.card-del', card).addEventListener('click', function () { del(row); });
      wireDrag(card);
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

  /* ---- drag ---- */
  var dragId = null;
  function wireDrag(card) {
    card.addEventListener('dragstart', function (e) {
      dragId = card.getAttribute('data-id'); card.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (_) {} }
    });
    card.addEventListener('dragend', function () { dragId = null; card.classList.remove('dragging'); $$('.card', listEl).forEach(function (c) { c.classList.remove('drop-target'); }); });
    card.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
    card.addEventListener('dragenter', function () { if (card.getAttribute('data-id') !== dragId) card.classList.add('drop-target'); });
    card.addEventListener('dragleave', function () { card.classList.remove('drop-target'); });
    card.addEventListener('drop', function (e) { e.preventDefault(); var t = card.getAttribute('data-id'); if (!dragId || dragId === t) return; reorder(dragId, t); });
  }
  function reorder(fromId, toId) {
    var ids = cache.map(function (x) { return String(x.id); });
    var from = ids.indexOf(fromId), to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    cache.splice(to, 0, cache.splice(from, 1)[0]);
    render(); persistOrder();
  }
  function persistOrder() {
    var updates = cache.map(function (r, i) {
      if (r.sort_order === i) return null; r.sort_order = i;
      return sb.from('products').update({ sort_order: i, updated_at: new Date().toISOString() }).eq('id', r.id);
    }).filter(Boolean);
    if (updates.length) Promise.all(updates).then(null, function () {});
  }
})();
