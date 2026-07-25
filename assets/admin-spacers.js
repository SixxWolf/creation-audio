/* =========================================================
   Création Audio — panneau admin : onglet « Spacers »
   Annonces de spacers imprimés 3D (nom, prix, quantité, photo).
   Table Supabase « spacers » + bucket Storage « spacers ».
   Nécessite : supabase-config.js, le CDN supabase-js, supabase-client.js.
   À charger APRÈS assets/admin.js (réutilise le même onglet/tab-panel).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var BUCKET = 'spacers';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function publicUrl(path) {
    if (!path) return '';
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
    catch (e) { return ''; }
  }

  var loaded = false, editingId = null, pendingFile = null, cache = [];

  // chargement paresseux au 1er clic sur l'onglet (l'affichage/masquage est géré par admin.js)
  var tabBtn = $('[data-tab="spacers"]');
  if (tabBtn) tabBtn.addEventListener('click', function () { if (!loaded) load(); });

  var editor = $('#sp-editor'), fileInput = $('#sp-file'), drop = $('#sp-drop'),
      preview = $('#sp-preview'), dropHint = $('#sp-drop-hint'),
      nameI = $('#sp-name'), priceI = $('#sp-price'), qtyI = $('#sp-qty'), activeI = $('#sp-active'),
      statusEl = $('#sp-status'), listEl = $('#sp-list');

  var newBtn = $('#sp-new'), refreshBtn = $('#sp-refresh');
  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  if (refreshBtn) refreshBtn.addEventListener('click', load);
  if (drop) drop.addEventListener('click', function () { fileInput.click(); });
  if (fileInput) fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    if (!f) return;
    pendingFile = f;
    preview.src = URL.createObjectURL(f); preview.hidden = false; dropHint.hidden = true;
  });
  var cancelBtn = $('#sp-cancel'); if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
  if (editor) editor.addEventListener('submit', onSave);

  /* ---- paliers de rabais quantité (illimités) ---- */
  var tiersRows = $('#sp-tiers-rows'), tierAdd = $('#sp-tier-add');
  if (tierAdd) tierAdd.addEventListener('click', function () { addTierRow(); });

  function addTierRow(min, price) {
    var row = document.createElement('div');
    row.className = 'sp-tier-row';
    row.innerHTML =
      '<span class="sp-tier-txt">À partir de</span>' +
      '<input type="number" class="sp-tier-min" min="1" step="1" placeholder="5" value="' + (min != null ? min : '') + '">' +
      '<span class="sp-tier-txt">paires →</span>' +
      '<input type="number" class="sp-tier-price" min="0" step="0.01" placeholder="10.00" value="' + (price != null ? price : '') + '">' +
      '<span class="sp-tier-txt">$ ch.</span>' +
      '<button type="button" class="sp-tier-del sp-btn-ghost" aria-label="Retirer ce palier">✕</button>';
    $('.sp-tier-del', row).addEventListener('click', function () { row.remove(); });
    tiersRows.appendChild(row);
    return row;
  }

  // lit les paliers saisis : nettoyés (min≥1, price≥0), triés par quantité croissante
  function collectTiers() {
    return $$('.sp-tier-row', tiersRows).map(function (row) {
      return { min: parseInt($('.sp-tier-min', row).value, 10), price: parseFloat($('.sp-tier-price', row).value) };
    }).filter(function (t) {
      return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0;
    }).sort(function (a, b) { return a.min - b.min; })
      .map(function (t) { return { min: t.min, price: Math.round(t.price * 100) / 100 }; });
  }

  function normalizeTiers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return { min: parseInt(t.min, 10), price: parseFloat(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; });
  }

  function tiersSummary(tiers) {
    return normalizeTiers(tiers).map(function (t) { return t.min + '+ : ' + money(t.price); }).join(' · ');
  }

  function openEditor(row) {
    editingId = row ? row.id : null;
    pendingFile = null;
    nameI.value = row ? row.name : '';
    priceI.value = row ? row.price : '';
    qtyI.value = row ? row.qty : 0;
    activeI.checked = row ? !!row.active : true;
    editor.dataset.oldPath = row && row.image_path ? row.image_path : '';
    tiersRows.innerHTML = '';
    normalizeTiers(row ? row.tiers : []).forEach(function (t) { addTierRow(t.min, t.price); });
    var url = row && row.image_path ? publicUrl(row.image_path) : '';
    if (url) { preview.src = url; preview.hidden = false; dropHint.hidden = true; }
    else { preview.hidden = true; preview.removeAttribute('src'); dropHint.hidden = false; }
    statusEl.textContent = '';
    editor.hidden = false;
    nameI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { editor.hidden = true; editingId = null; pendingFile = null; }

  function uploadPhoto(file) {
    var ext = (String(file.name).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    return sb.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
      .then(function (res) { if (res.error) throw res.error; return path; });
  }

  function onSave(e) {
    e.preventDefault();
    var name = nameI.value.trim();
    if (!name) { nameI.focus(); return; }
    var price = Math.max(0, parseFloat(priceI.value) || 0);
    var qty = Math.max(0, parseInt(qtyI.value, 10) || 0);
    var active = !!activeI.checked;
    var tiers = collectTiers();
    var oldPath = editor.dataset.oldPath || null;

    var saveBtn = $('#sp-save'); saveBtn.disabled = true;
    statusEl.textContent = pendingFile ? 'Téléversement de la photo…' : 'Enregistrement…';

    var chain = pendingFile ? uploadPhoto(pendingFile) : Promise.resolve(oldPath);
    chain.then(function (imagePath) {
      var patch = { name: name, price: price, qty: qty, active: active, tiers: tiers, image_path: imagePath, updated_at: new Date().toISOString() };
      return editingId
        ? sb.from('spacers').update(patch).eq('id', editingId).select()
        : sb.from('spacers').insert(patch).select();
    }).then(function (res) {
      saveBtn.disabled = false;
      if (res.error) { statusEl.textContent = 'Erreur : ' + res.error.message; return; }
      if (!res.data || !res.data.length) { statusEl.textContent = 'Enregistrement refusé (permissions). Es-tu bien connecté ?'; return; }
      // photo remplacée : on retire l'ancienne (best-effort)
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

  function load() {
    loaded = true;
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    sb.from('spacers').select('*').order('created_at', { ascending: false }).then(function (res) {
      if (res.error) {
        listEl.innerHTML = '<p class="muted">Impossible de charger. Si c\'est la première fois, exécute ' +
          '<strong>supabase/add-spacers.sql</strong> dans Supabase.</p>';
        return;
      }
      cache = res.data || [];
      render();
    }, function () { listEl.innerHTML = '<p class="muted">Erreur réseau.</p>'; });
  }

  function render() {
    if (!cache.length) {
      listEl.innerHTML = '<p class="sales-empty">Aucun spacer pour l\'instant.<br>' +
        'Clique «&nbsp;+ Nouvelle annonce&nbsp;» pour créer ta première.</p>';
      return;
    }
    listEl.innerHTML = cache.map(function (r) {
      var url = publicUrl(r.image_path), out = (r.qty | 0) <= 0;
      return '<article class="sp-card' + (r.active ? '' : ' is-hidden') + '" data-id="' + r.id + '">' +
        '<div class="sp-thumb">' +
          (url ? '<img src="' + esc(url) + '" alt="' + esc(r.name) + '">' : '<span class="sp-noimg">Pas de photo</span>') +
          (out ? '<span class="sp-badge-out">Rupture</span>' : '') +
          (r.active ? '' : '<span class="sp-badge-hidden">Masqué</span>') +
        '</div>' +
        '<div class="sp-body">' +
          '<h3 class="sp-name">' + esc(r.name) + '</h3>' +
          '<div class="sp-meta"><span class="sp-price">' + money(r.price) + '</span>' +
            '<span class="sp-qty' + (out ? ' out' : '') + '">' + (r.qty | 0) + ' dispo</span></div>' +
          (tiersSummary(r.tiers) ? '<div class="sp-tierline">' + esc(tiersSummary(r.tiers)) + '</div>' : '') +
          '<div class="sp-actions">' +
            '<button class="sp-btn-ghost sp-edit" type="button">Modifier</button>' +
            '<button class="sp-btn-ghost sp-del" type="button">Supprimer</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    $$('.sp-card', listEl).forEach(function (card) {
      var id = +card.getAttribute('data-id');
      var row = cache.filter(function (x) { return x.id === id; })[0];
      $('.sp-edit', card).addEventListener('click', function () { openEditor(row); });
      $('.sp-del', card).addEventListener('click', function () { del(row); });
    });
  }

  function del(row) {
    if (!window.confirm('Supprimer « ' + row.name + ' » ? Cette action est définitive.')) return;
    // .select() pour détecter un DELETE bloqué par RLS (renvoie 0 ligne sans erreur)
    sb.from('spacers').delete().eq('id', row.id).select().then(function (res) {
      if (res.error) { window.alert('Erreur : ' + res.error.message); return; }
      if (!res.data || !res.data.length) { window.alert('Suppression refusée (permissions).'); return; }
      if (row.image_path) sb.storage.from(BUCKET).remove([row.image_path]).then(null, function () {});
      load();
    });
  }
})();
