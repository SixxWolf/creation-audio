/* =========================================================
   Création Audio V2 — CMS Accessoires
   Extras vendus en boutique (bobines vides réutilisables…).
   Table « products » (type = 'accessory'). Prix public +
   coût/marge, stock, photo, réordonnancement. Pas de rabais
   quantité ni de prix dealer (contrairement aux spacers).
   Remplace les accessoires jadis codés en dur dans boutique.js.
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function publicUrl(path) {
    if (!path) return '';
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }
  function marginPill(price, cost) {
    var p = +price || 0, c = +cost || 0, m = p - c, pct = p > 0 ? Math.round(m / p * 100) : 0;
    return '<span class="card-margin ' + (m >= 0 ? 'pos' : 'neg') + '">marge ' + money(m) + (p > 0 ? ' · ' + pct + '%' : '') + '</span>';
  }

  var loaded = false, editingId = null, pendingFile = null, cache = [];

  var editor = $('#ac-editor'), editorTitle = $('#ac-editor-title'),
      fileInput = $('#ac-file'), drop = $('#ac-drop'), preview = $('#ac-preview'), dropHint = $('#ac-drop-hint'),
      nameI = $('#ac-name'), descI = $('#ac-desc'), priceI = $('#ac-price'), costI = $('#ac-cost'),
      marginEl = $('#ac-margin'), qtyI = $('#ac-qty'), activeI = $('#ac-active'),
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
  if (drop) drop.addEventListener('click', function () { fileInput.click(); });
  if (fileInput) fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    if (!f) return;
    pendingFile = f;
    preview.src = URL.createObjectURL(f); preview.hidden = false; dropHint.hidden = true;
  });
  if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
  if (editor) editor.addEventListener('submit', onSave);
  [priceI, costI].forEach(function (el) { if (el) el.addEventListener('input', updateMargin); });

  function updateMargin() {
    var s = num(priceI.value), c = num(costI.value);
    if (s == null && c == null) { marginEl.textContent = '—'; marginEl.className = 'v'; return; }
    s = s || 0; c = c || 0; var m = s - c, pct = s > 0 ? Math.round(m / s * 100) : 0;
    marginEl.textContent = money(m) + (s > 0 ? '  (' + pct + '%)' : '');
    marginEl.className = 'v ' + (m >= 0 ? 'pos' : 'neg');
  }

  /* ---- éditeur ---- */
  function openEditor(row) {
    editingId = row ? row.id : null;
    pendingFile = null;
    editorTitle.textContent = row ? 'Modifier l\'accessoire' : 'Nouvel accessoire';
    nameI.value = row ? (row.name || '') : '';
    descI.value = row && row.attrs && row.attrs.description ? row.attrs.description : '';
    priceI.value = row && row.sell_price != null ? row.sell_price : '';
    costI.value = row && row.cost_price != null ? row.cost_price : '';
    qtyI.value = row && row.qty != null ? row.qty : 0;
    activeI.checked = row ? !!row.active : true;
    editor.dataset.oldPath = row && row.image_path ? row.image_path : '';
    var url = row && row.image_path ? publicUrl(row.image_path) : '';
    if (url) { preview.src = url; preview.hidden = false; dropHint.hidden = true; }
    else { preview.hidden = true; preview.removeAttribute('src'); dropHint.hidden = false; }
    updateMargin();
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
    var patch = {
      type: TYPE, brand: BRAND, material: null,
      name: name,
      attrs: { description: descI.value.trim() || null },
      sell_price: Math.max(0, num(priceI.value) || 0),
      dealer_price: null,
      cost_price: Math.max(0, num(costI.value) || 0),
      qty: Math.max(0, parseInt(qtyI.value, 10) || 0),
      qty_2: null,
      tiers: [],
      active: !!activeI.checked,
      updated_at: new Date().toISOString()
    };
    var oldPath = editor.dataset.oldPath || null;

    saveBtn.disabled = true;
    statusEl.textContent = pendingFile ? 'Téléversement de la photo…' : 'Enregistrement…';

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
      listEl.innerHTML = '<p class="empty">Aucun accessoire pour l\'instant.<br>' +
        'Clique «&nbsp;+ Nouvel accessoire&nbsp;» pour créer le premier (ex. bobine vide réutilisable).</p>';
      return;
    }
    listEl.innerHTML = cache.map(function (r) {
      var url = publicUrl(r.image_path), out = (r.qty | 0) <= 0;
      var desc = r.attrs && r.attrs.description ? r.attrs.description : '';
      return '<article class="card' + (r.active ? '' : ' is-hidden') + '" data-id="' + esc(r.id) + '" draggable="true">' +
        '<div class="card-thumb">' +
          (url ? '<img src="' + esc(url) + '" alt="' + esc(r.name) + '" loading="lazy">' : '<span class="card-noimg">Pas de photo</span>') +
          (out ? '<span class="badge badge-out">Rupture</span>' : '') +
          (r.active ? '' : '<span class="badge badge-hidden">Masqué</span>') +
          '<span class="drag-handle" title="Glisser pour réordonner">⠿</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-name">' + esc(r.name) + '</div>' +
          (desc ? '<div class="card-stock"><span class="stk">' + esc(desc) + '</span></div>' : '') +
          '<div class="card-stock"><span class="stk' + (out ? ' out' : '') + '">' + (r.qty | 0) + ' en stock</span></div>' +
          '<div class="sp-tiers-break">' +
            '<div class="sp-tierrow"><span class="tp"><b>Prix</b> : ' + money(r.sell_price) + '</span>' + marginPill(r.sell_price, r.cost_price) + '</div>' +
          '</div>' +
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
      if (row.image_path) sb.storage.from(BUCKET).remove([row.image_path]).then(null, function () {});
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
