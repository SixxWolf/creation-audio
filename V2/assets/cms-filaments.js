/* =========================================================
   Création Audio V2 — CMS Filaments (couleurs)
   Un filament = une COULEUR : identité (nom, matériau, hex, image,
   taille) + STOCK par couleur (bobines / recharges). Le PRIX, le
   COÛT et les PALIERS proviennent du MATÉRIAU (voir cms-materials.js).
   Table « products » (type = 'filament').
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var BUCKET = 'products';
  var TYPE = 'filament';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function publicUrl(path) {
    if (!path) return '';
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
    catch (e) { return ''; }
  }
  function matOf(brand, name) { return window.CA.materialOf ? window.CA.materialOf(brand, name) : null; }
  function brandMaterials() { return ((window.CA.materials && window.CA.materials.list) || []).filter(function (m) { return m.brand === window.CA.currentBrand; }); }
  function matHasSpool(mat) { return !!(mat && mat.sell_spool != null); }
  function matHasRefillM(mat) { return !!(mat && mat.sell_refill != null); }
  function normalizeTiers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return { min: parseInt(t.min, 10), price: parseFloat(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; });
  }
  function tiersSummary(tiers) {
    return normalizeTiers(tiers).map(function (t) { return t.min + '+ : ' + money(t.price); }).join(' · ');
  }

  var loaded = false, editingId = null, pendingFile = null, cache = [];

  /* ---- éléments ---- */
  var editor = $('#f-editor'), editorTitle = $('#f-editor-title'),
      fileInput = $('#f-file'), drop = $('#f-drop'), preview = $('#f-preview'), dropHint = $('#f-drop-hint'),
      nameI = $('#f-name'), materialSel = $('#f-material'), codeI = $('#f-code'), hexI = $('#f-hex'), hexPick = $('#f-hex-picker'),
      sizeI = $('#f-size'),
      qtyI = $('#f-qty'), qty2I = $('#f-qty2'), qtyWrap = $('#f-qty-wrap'), qty2Wrap = $('#f-qty2-wrap'), activeI = $('#f-active'),
      offerSpoolI = $('#f-offer-spool'), offerRefillI = $('#f-offer-refill'),
      pricePreview = $('#f-price-preview'),
      statusEl = $('#f-status'), listEl = $('#f-list'),
      newBtn = $('#f-new'), refreshBtn = $('#f-refresh'),
      saveBtn = $('#f-save'), cancelBtn = $('#f-cancel');

  /* ---- chargement : piloté par la marque courante ---- */
  function ensureMaterials() { return (window.CA.materials && window.CA.materials.loaded) ? Promise.resolve() : (window.CA.loadMaterials ? window.CA.loadMaterials() : Promise.resolve()); }
  // (re)charge les filaments de la marque courante quand elle change
  if (window.CA.onBrandChange) window.CA.onBrandChange(function () { loaded = true; ensureMaterials().then(load, load); });
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'filaments' && window.CA.currentBrand) { loaded = true; ensureMaterials().then(load, load); }
  };
  // si les matériaux changent (créés/édités ailleurs), rafraîchir la liste + le sélecteur
  if (window.CA.onMaterialsChange) window.CA.onMaterialsChange(function () {
    populateMaterialSelect(materialSel.value);
    if (loaded) render();
  });

  /* ---- interactions ---- */
  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  if (refreshBtn) refreshBtn.addEventListener('click', function () {
    (window.CA.loadMaterials ? window.CA.loadMaterials() : Promise.resolve()).then(load, load);
  });
  function resetOffersToMaterial() {
    var mat = matOf(window.CA.currentBrand, materialSel.value);
    offerSpoolI.checked = matHasSpool(mat);
    offerRefillI.checked = matHasRefillM(mat);
  }
  if (drop) drop.addEventListener('click', function () { fileInput.click(); });
  if (fileInput) fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    if (!f) return;
    pendingFile = f;
    preview.src = URL.createObjectURL(f); preview.hidden = false; dropHint.hidden = true;
  });
  if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
  if (editor) editor.addEventListener('submit', onSave);
  // changer de matériau : réinitialise les formats aux formats offerts par ce matériau
  if (materialSel) materialSel.addEventListener('change', function () { resetOffersToMaterial(); syncMaterialUI(); });
  if (offerSpoolI) offerSpoolI.addEventListener('change', syncMaterialUI);
  if (offerRefillI) offerRefillI.addEventListener('change', syncMaterialUI);

  if (hexPick) hexPick.addEventListener('input', function () { hexI.value = hexPick.value; });
  if (hexI) hexI.addEventListener('input', function () {
    var v = hexI.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) hexPick.value = v[0] === '#' ? v : '#' + v;
  });

  /* ---- sélecteur de matériau (marque courante) ---- */
  function populateMaterialSelect(selected) {
    var list = brandMaterials();
    if (!materialSel) return;
    if (!list.length) {
      materialSel.innerHTML = '<option value="">(crée d\'abord un matériau ci-dessus)</option>';
      materialSel.value = ''; return;
    }
    var opts = ['<option value="">— choisir un matériau —</option>'];
    var have = false;
    list.forEach(function (m) {
      opts.push('<option value="' + esc(m.name) + '">' + esc(m.name) + '</option>');
      if (m.name === selected) have = true;
    });
    // matériau enregistré mais supprimé depuis : on le garde visible
    if (selected && !have) opts.push('<option value="' + esc(selected) + '">' + esc(selected) + ' (introuvable)</option>');
    materialSel.innerHTML = opts.join('');
    materialSel.value = selected || '';
  }

  function syncMaterialUI() {
    var mat = matOf(window.CA.currentBrand, materialSel.value);
    var matHasS = matHasSpool(mat), matHasR = matHasRefillM(mat);
    // les cases ne sont activables que pour les formats offerts par le matériau
    offerSpoolI.disabled = !matHasS; if (!matHasS) offerSpoolI.checked = false;
    offerRefillI.disabled = !matHasR; if (!matHasR) offerRefillI.checked = false;
    // format effectif pour cette couleur = matériau l'offre ET la case est cochée
    var hasS = matHasS && offerSpoolI.checked;
    var hasR = matHasR && offerRefillI.checked;
    if (qtyWrap) qtyWrap.style.display = hasS ? '' : 'none';
    if (qty2Wrap) qty2Wrap.style.display = hasR ? '' : 'none';
    if (!hasS && qtyI) qtyI.value = 0;
    if (!hasR && qty2I) qty2I.value = '';
    if (!mat) { pricePreview.textContent = materialSel.value ? 'matériau introuvable' : 'choisis un matériau'; return; }
    var parts = [];
    if (hasS) parts.push(money(mat.sell_spool) + ' bobine');
    if (hasR) parts.push(money(mat.sell_refill) + ' recharge');
    pricePreview.textContent = parts.join(' · ') || 'aucun format sélectionné';
  }

  /* ---- éditeur ---- */
  function openEditor(row) {
    editingId = row ? row.id : null;
    pendingFile = null;
    editorTitle.textContent = row ? 'Modifier le filament' : 'Nouveau filament';
    nameI.value = row ? (row.name || '') : '';
    populateMaterialSelect(row ? (row.material || '') : '');
    codeI.value = row && row.code ? row.code : '';
    var hex = row && row.hex ? row.hex : '#888888';
    hexI.value = hex; hexPick.value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#888888';
    sizeI.value = row && row.size ? row.size : '1x1';
    qtyI.value = row && row.qty != null ? row.qty : 0;
    qty2I.value = row && row.qty_2 != null ? row.qty_2 : '';
    // formats vendus pour cette couleur (défaut : tout ce que le matériau offre)
    offerSpoolI.checked = row ? (row.offer_spool !== false) : true;
    offerRefillI.checked = row ? (row.offer_refill !== false) : true;
    activeI.checked = row ? !!row.active : true;
    editor.dataset.oldPath = row && row.image_path ? row.image_path : '';
    var url = row && row.image_path ? publicUrl(row.image_path) : '';
    if (url) { preview.src = url; preview.hidden = false; dropHint.hidden = true; }
    else { preview.hidden = true; preview.removeAttribute('src'); dropHint.hidden = false; }
    syncMaterialUI();
    statusEl.textContent = '';
    editor.hidden = false;
    nameI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { editor.hidden = true; editingId = null; pendingFile = null; }

  function uploadPhoto(file) {
    var ext = (String(file.name).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = TYPE + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    return sb.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
      .then(function (res) { if (res.error) throw res.error; return path; });
  }

  function onSave(e) {
    e.preventDefault();
    var name = nameI.value.trim();
    if (!name) { nameI.focus(); return; }
    var hex = hexI.value.trim(); if (hex && hex[0] !== '#') hex = '#' + hex;
    if (hex && !/^#[0-9a-fA-F]{6}$/.test(hex)) hex = null;
    var mat = matOf(window.CA.currentBrand, materialSel.value);
    // format effectif = matériau l'offre ET la case couleur est cochée
    var hasS = matHasSpool(mat) && offerSpoolI.checked;
    var hasR = matHasRefillM(mat) && offerRefillI.checked;
    if (mat && !hasS && !hasR) { statusEl.textContent = 'Coche au moins un format vendu pour cette couleur.'; return; }

    var patch = {
      type: TYPE,
      brand: window.CA.currentBrand,
      name: name,
      material: materialSel.value || null,
      code: codeI.value.trim() || null,
      hex: hex,
      size: sizeI.value || '1x1',
      offer_spool: !!offerSpoolI.checked,
      offer_refill: !!offerRefillI.checked,
      qty: hasS ? Math.max(0, parseInt(qtyI.value, 10) || 0) : 0,
      qty_2: hasR ? (qty2I.value === '' ? 0 : Math.max(0, parseInt(qty2I.value, 10) || 0)) : null,
      active: !!activeI.checked,
      updated_at: new Date().toISOString()
    };
    var oldPath = editor.dataset.oldPath || null;

    saveBtn.disabled = true;
    statusEl.textContent = pendingFile ? 'Téléversement de l\'image…' : 'Enregistrement…';

    var chain = pendingFile ? uploadPhoto(pendingFile) : Promise.resolve(oldPath);
    chain.then(function (imagePath) {
      patch.image_path = imagePath;
      if (editingId) return sb.from('products').update(patch).eq('id', editingId).select();
      patch.sort_order = cache.length ? (Math.max.apply(null, cache.map(function (x) { return x.sort_order || 0; })) + 1) : 0;
      return sb.from('products').insert(patch).select();
    }).then(function (res) {
      saveBtn.disabled = false;
      if (res.error) { statusEl.textContent = 'Erreur : ' + res.error.message; return; }
      if (!res.data || !res.data.length) { statusEl.textContent = 'Refusé (permissions). Es-tu connecté en admin ?'; return; }
      if (pendingFile && oldPath && res.data[0].image_path !== oldPath) {
        sb.storage.from(BUCKET).remove([oldPath]).then(null, function () {});
      }
      closeEditor();
      load();
      if (listEl) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, function (err) {
      saveBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }

  /* ---- chargement liste (marque courante) ---- */
  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return sb.from('products').select('*').eq('type', TYPE).eq('brand', window.CA.currentBrand || '')
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

  function cardHtml(r) {
    var url = publicUrl(r.image_path);
    var mat = matOf(r.brand, r.material);
    // format effectif = matériau l'offre ET la couleur ne l'a pas désactivé
    var hasS = mat ? (matHasSpool(mat) && r.offer_spool !== false) : true;
    var hasR = mat ? (matHasRefillM(mat) && r.offer_refill !== false) : (r.qty_2 != null);
    var qb = r.qty | 0, qr = r.qty_2 | 0;
    var outB = hasS && qb <= 0, outR = hasR && qr <= 0;
    var outAll = (hasS || hasR) && !((hasS && qb > 0) || (hasR && qr > 0));

    var priceHtml;
    if (mat) {
      var pp = [];
      if (hasS) pp.push(money(mat.sell_spool));
      if (hasR) pp.push(money(mat.sell_refill));
      priceHtml = '<span class="card-price money">' + pp.join(' / ') + '</span>';
    } else {
      priceHtml = '<span class="card-price is-warn">Matériau non défini</span>';
    }
    var ts = hasS && mat ? tiersSummary(mat.tiers_spool) : '', tr = hasR && mat ? tiersSummary(mat.tiers_refill) : '';

    return '<article class="card' + (r.active ? '' : ' is-hidden') + '" data-id="' + esc(r.id) + '" draggable="true">' +
      '<div class="card-thumb">' +
        (url ? '<img src="' + esc(url) + '" alt="' + esc(r.name) + '" loading="lazy">' : '<span class="card-noimg">Pas d\'image</span>') +
        (r.hex ? '<span class="card-pastille" style="background:' + esc(r.hex) + '"></span>' : '') +
        (outAll ? '<span class="badge badge-out">Rupture</span>' : '') +
        (r.active ? '' : '<span class="badge badge-hidden">Masqué</span>') +
        '<span class="drag-handle" title="Glisser pour réordonner (même matériau)">⠿</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="card-name">' + esc(r.name) + '</div>' +
        (r.code ? '<div class="card-material">code ' + esc(r.code) + '</div>' : '') +
        '<div class="card-meta">' + priceHtml + '</div>' +
        '<div class="card-stock">' +
          (hasS ? '<span class="stk' + (outB ? ' out' : '') + '">Bobine&nbsp;: ' + qb + '</span>' : '') +
          (hasR ? '<span class="stk' + (outR ? ' out' : '') + '">Recharge&nbsp;: ' + qr + '</span>' : '') +
        '</div>' +
        (ts ? '<div class="card-tierline">Bobine · ' + esc(ts) + '</div>' : '') +
        (tr ? '<div class="card-tierline">Recharge · ' + esc(tr) + '</div>' : '') +
        '<div class="card-actions">' +
          '<button class="btn btn-ghost card-edit" type="button">Modifier</button>' +
          '<button class="btn btn-ghost card-del" type="button">Suppr.</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  // Regroupe les filaments par matériau (ordre = liste des matériaux, puis « autres »).
  function displayGroups() {
    var groups = [], seen = {};
    brandMaterials().forEach(function (m) {
      var cards = cache.filter(function (c) { return c.material === m.name; });
      if (cards.length) { groups.push({ key: m.name, name: m.name, cards: cards }); seen[m.name] = true; }
    });
    var otherMats = {};
    cache.forEach(function (c) {
      if (c.material && seen[c.material]) return;
      var k = c.material || '(sans matériau)';
      (otherMats[k] = otherMats[k] || []).push(c);
    });
    Object.keys(otherMats).forEach(function (k) { groups.push({ key: k, name: k, cards: otherMats[k] }); });
    return groups;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  function render() {
    if (!cache.length) {
      listEl.innerHTML = '<p class="empty">Aucun filament pour l\'instant.<br>' +
        'Clique «&nbsp;+ Nouveau filament&nbsp;» pour créer le premier.</p>';
      return;
    }
    listEl.innerHTML = displayGroups().map(function (g) {
      return '<section class="fil-group">' +
        '<h3 class="fil-group-title" id="fil-' + slug(g.key) + '">' + esc(g.name) +
          ' <span class="fil-count">' + g.cards.length + '</span></h3>' +
        '<div class="cards">' + g.cards.map(cardHtml).join('') + '</div>' +
      '</section>';
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
      if (row.image_path) sb.storage.from(BUCKET).remove([row.image_path]).then(null, function () {});
      load();
    });
  }

  /* ---- glisser-déposer ---- */
  var dragId = null;
  function wireDrag(card) {
    card.addEventListener('dragstart', function (e) {
      dragId = card.getAttribute('data-id');
      card.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (_) {} }
    });
    card.addEventListener('dragend', function () {
      dragId = null; card.classList.remove('dragging');
      $$('.card', listEl).forEach(function (c) { c.classList.remove('drop-target'); });
    });
    card.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
    card.addEventListener('dragenter', function () { if (card.getAttribute('data-id') !== dragId) card.classList.add('drop-target'); });
    card.addEventListener('dragleave', function () { card.classList.remove('drop-target'); });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      var targetId = card.getAttribute('data-id');
      if (!dragId || dragId === targetId) return;
      reorder(dragId, targetId);
    });
  }
  function reorder(fromId, toId) {
    // on travaille sur la séquence AFFICHÉE (groupée par matériau)
    var seq = [];
    displayGroups().forEach(function (g) { g.cards.forEach(function (c) { seq.push(c); }); });
    var ids = seq.map(function (x) { return String(x.id); });
    var from = ids.indexOf(fromId), to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    if (seq[from].material !== seq[to].material) return;   // réordonnancement dans le même matériau uniquement
    var moved = seq.splice(from, 1)[0];
    seq.splice(to, 0, moved);
    cache = seq;                 // le cache prend l'ordre groupé affiché
    render();
    persistOrder();
  }
  function persistOrder() {
    var updates = cache.map(function (r, i) {
      if (r.sort_order === i) return null;
      r.sort_order = i;
      return sb.from('products').update({ sort_order: i, updated_at: new Date().toISOString() }).eq('id', r.id);
    }).filter(Boolean);
    if (!updates.length) return;
    Promise.all(updates).then(function (results) {
      var bad = results.filter(function (x) { return x && x.error; });
      if (bad.length && statusEl) statusEl.textContent = 'Ordre partiellement sauvegardé.';
    }, function () {});
  }
})();
