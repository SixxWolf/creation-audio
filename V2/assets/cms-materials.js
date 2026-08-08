/* =========================================================
   Création Audio V2 — CMS Matériaux (prix par matériau)
   Table « materials » : prix, coûts et paliers PAR MATÉRIAU.
   Toutes les couleurs d'un matériau héritent de ces valeurs.
   Expose sur window.CA :
     - CA.materials = { list, byName, loaded }
     - CA.loadMaterials()      -> Promise(list)   (recharge + notifie)
     - CA.onMaterialsChange(cb) -> abonnement
   À charger AVANT cms-filaments.js.
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';

  var sb = window.CA.sb;
  if (!sb) return;

  var BUCKET = 'products';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function publicUrl(path) {
    if (!path) return '';
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }
  function uploadImage(file) {
    var ext = (String(file.name).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = 'material/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    return sb.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
      .then(function (res) { if (res.error) throw res.error; return path; });
  }

  /* ---- cache partagé + abonnements (toutes marques confondues) ---- */
  CA.materials = { list: [], loaded: false };
  // recherche d'un matériau par (marque, nom)
  CA.materialOf = function (brand, name) {
    return CA.materials.list.filter(function (m) { return m.brand === brand && m.name === name; })[0] || null;
  };
  var listeners = [];
  CA.onMaterialsChange = function (cb) { if (typeof cb === 'function') listeners.push(cb); };
  function notify() { listeners.forEach(function (cb) { try { cb(CA.materials); } catch (e) {} }); }

  CA.loadMaterials = function () {
    return sb.from('materials').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        CA.materials = { list: res.data || [], loaded: true };
        notify();
        return CA.materials.list;
      });
  };
  // matériaux de la marque courante uniquement
  function brandMaterials() {
    return CA.materials.list.filter(function (m) { return m.brand === CA.currentBrand; });
  }

  /* ---- éléments ---- */
  var editor = $('#m-editor'), editorTitle = $('#m-editor-title'),
      nameI = $('#m-name'), hasSpoolI = $('#m-has-spool'), hasRefillI = $('#m-has-refill'),
      sellSpoolI = $('#m-sell-spool'), sellRefillI = $('#m-sell-refill'),
      costSpoolI = $('#m-cost-spool'), costRefillI = $('#m-cost-refill'),
      marginSpoolEl = $('#m-margin-spool'), marginRefillEl = $('#m-margin-refill'),
      tiersSpoolEl = $('#m-tiers-spool'), tierAddSpool = $('#m-tier-add-spool'),
      tiersRefillEl = $('#m-tiers-refill'), tierAddRefill = $('#m-tier-add-refill'),
      descI = $('#m-desc'),
      dropEl = $('#m-drop'), fileEl = $('#m-file'), previewEl = $('#m-preview'), dropHintEl = $('#m-drop-hint'),
      statusEl = $('#m-status'), listEl = $('#m-list'),
      newBtn = $('#m-new'), toggleBtn = $('#m-toggle'), section = $('#m-section'),
      saveBtn = $('#m-save'), cancelBtn = $('#m-cancel');

  var editingName = null, pendingFile = null;

  /* ---- chargement quand l'admin est prêt ---- */
  // se réaffiche (liste + nav latérale) à chaque changement de matériaux,
  // même si le rechargement vient d'un autre module (ex. onglet Filaments).
  if (CA.onMaterialsChange) CA.onMaterialsChange(function () { render(); });
  // (re)charge/rend quand la marque change
  if (CA.onBrandChange) CA.onBrandChange(function () { if (!CA.materials.loaded) CA.loadMaterials().then(null, renderError); else render(); });

  /* ---- interactions ---- */
  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
  if (editor) editor.addEventListener('submit', onSave);
  if (dropEl) dropEl.addEventListener('click', function () { fileEl.click(); });
  if (fileEl) fileEl.addEventListener('change', function () {
    var f = fileEl.files && fileEl.files[0];
    if (!f) return;
    pendingFile = f;
    previewEl.src = URL.createObjectURL(f); previewEl.hidden = false; dropHintEl.hidden = true;
  });
  if (toggleBtn) toggleBtn.addEventListener('click', function () {
    var hide = section.hidden = !section.hidden;
    toggleBtn.textContent = hide ? 'Afficher' : 'Masquer';
    toggleBtn.setAttribute('aria-expanded', String(!hide));
  });
  if (hasRefillI) hasRefillI.addEventListener('change', syncFormatUI);
  if (hasSpoolI) hasSpoolI.addEventListener('change', syncFormatUI);

  [sellSpoolI, sellRefillI, costSpoolI, costRefillI].forEach(function (el) {
    if (el) el.addEventListener('input', updateMargins);
  });

  function syncFormatUI() {
    $$('.spool-only', editor).forEach(function (el) { el.style.display = hasSpoolI.checked ? '' : 'none'; });
    $$('.refill-only', editor).forEach(function (el) { el.style.display = hasRefillI.checked ? '' : 'none'; });
    updateMargins();
  }
  function marginText(sell, cost) {
    var s = num(sell), c = num(cost);
    if (s == null && c == null) return { txt: '—', cls: '' };
    s = s || 0; c = c || 0;
    var m = s - c, pct = s > 0 ? Math.round(m / s * 100) : 0;
    return { txt: money(m) + (s > 0 ? '  (' + pct + '%)' : ''), cls: m >= 0 ? 'pos' : 'neg' };
  }
  function updateMargins() {
    if (hasSpoolI.checked) { var a = marginText(sellSpoolI.value, costSpoolI.value); marginSpoolEl.textContent = a.txt; marginSpoolEl.className = 'v ' + a.cls; }
    else { marginSpoolEl.textContent = '—'; marginSpoolEl.className = 'v'; }
    if (hasRefillI.checked) { var b = marginText(sellRefillI.value, costRefillI.value); marginRefillEl.textContent = b.txt; marginRefillEl.className = 'v ' + b.cls; }
    else { marginRefillEl.textContent = '—'; marginRefillEl.className = 'v'; }
  }

  /* ---- paliers ---- */
  if (tierAddSpool) tierAddSpool.addEventListener('click', function () { addTierRow(tiersSpoolEl, 'bobines'); });
  if (tierAddRefill) tierAddRefill.addEventListener('click', function () { addTierRow(tiersRefillEl, 'recharges'); });
  function addTierRow(container, unit, min, price) {
    var row = document.createElement('div');
    row.className = 'tier-row';
    row.innerHTML =
      '<span class="t">À partir de</span>' +
      '<input type="number" class="tier-min" min="1" step="1" placeholder="5" value="' + (min != null ? min : '') + '">' +
      '<span class="t">' + (unit || 'unités') + ' →</span>' +
      '<input type="number" class="tier-price money" min="0" step="0.01" placeholder="18.00" value="' + (price != null ? price : '') + '">' +
      '<span class="t">$ ch.</span>' +
      '<button type="button" class="tier-del" aria-label="Retirer ce palier">✕</button>';
    $('.tier-del', row).addEventListener('click', function () { row.remove(); });
    container.appendChild(row);
    return row;
  }
  function collectTiers(container) {
    return $$('.tier-row', container).map(function (row) {
      return { min: parseInt($('.tier-min', row).value, 10), price: parseFloat($('.tier-price', row).value) };
    }).filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; })
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

  /* ---- éditeur ---- */
  function openEditor(row) {
    editingName = row ? row.name : null;
    pendingFile = null;
    editorTitle.textContent = row ? ('Modifier « ' + row.name + ' »') : 'Nouveau matériau';
    nameI.value = row ? row.name : '';
    nameI.readOnly = !!row;                 // le nom = identité ; pas de renommage (les filaments y sont liés)
    hasSpoolI.checked = row ? (row.sell_spool != null) : true;
    hasRefillI.checked = row ? (row.sell_refill != null) : false;
    descI.value = row && row.description ? row.description : '';
    sellSpoolI.value = row && row.sell_spool != null ? row.sell_spool : '';
    sellRefillI.value = row && row.sell_refill != null ? row.sell_refill : '';
    costSpoolI.value = row && row.cost_spool != null ? row.cost_spool : '';
    costRefillI.value = row && row.cost_refill != null ? row.cost_refill : '';
    tiersSpoolEl.innerHTML = '';
    normalizeTiers(row ? row.tiers_spool : []).forEach(function (t) { addTierRow(tiersSpoolEl, 'bobines', t.min, t.price); });
    tiersRefillEl.innerHTML = '';
    normalizeTiers(row ? row.tiers_refill : []).forEach(function (t) { addTierRow(tiersRefillEl, 'recharges', t.min, t.price); });
    // image vitrine (E4)
    if (editor) editor.dataset.oldPath = row && row.image_path ? row.image_path : '';
    if (dropEl) {
      var url = row && row.image_path ? publicUrl(row.image_path) : '';
      if (url) { previewEl.src = url; previewEl.hidden = false; dropHintEl.hidden = true; }
      else { previewEl.hidden = true; previewEl.removeAttribute('src'); dropHintEl.hidden = false; }
    }
    syncFormatUI();
    statusEl.textContent = '';
    editor.hidden = false;
    section.hidden = false; if (toggleBtn) { toggleBtn.textContent = 'Masquer'; toggleBtn.setAttribute('aria-expanded', 'true'); }
    nameI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { editor.hidden = true; editingName = null; }

  function onSave(e) {
    e.preventDefault();
    var name = nameI.value.trim();
    if (!name) { nameI.focus(); return; }
    var hasS = hasSpoolI.checked, hasR = hasRefillI.checked;
    if (!hasS && !hasR) { statusEl.textContent = 'Coche au moins un format (bobine ou recharge).'; return; }
    var patch = {
      name: name,
      sell_spool: hasS ? Math.max(0, num(sellSpoolI.value) || 0) : null,
      sell_refill: hasR ? Math.max(0, num(sellRefillI.value) || 0) : null,
      cost_spool: hasS ? Math.max(0, num(costSpoolI.value) || 0) : null,
      cost_refill: hasR ? Math.max(0, num(costRefillI.value) || 0) : null,
      tiers_spool: hasS ? collectTiers(tiersSpoolEl) : [],
      tiers_refill: hasR ? collectTiers(tiersRefillEl) : [],
      description: descI.value.trim() || null,
      updated_at: new Date().toISOString()
    };

    patch.brand = CA.currentBrand;
    if (!patch.brand) { statusEl.textContent = 'Sélectionne d\'abord une marque.'; return; }

    var oldPath = (editor && editor.dataset.oldPath) || null;

    saveBtn.disabled = true;
    statusEl.textContent = pendingFile ? 'Téléversement de l\'image…' : 'Enregistrement…';

    var chain = pendingFile ? uploadImage(pendingFile) : Promise.resolve(oldPath);
    chain.then(function (imagePath) {
      patch.image_path = imagePath || null;
      statusEl.textContent = 'Enregistrement…';
      // upsert sur la clé primaire composite (brand, name)
      return sb.from('materials').upsert(patch, { onConflict: 'brand,name' }).select();
    }).then(function (res) {
      saveBtn.disabled = false;
      if (res.error) { statusEl.textContent = 'Erreur : ' + res.error.message; return; }
      if (!res.data || !res.data.length) { statusEl.textContent = 'Refusé (permissions). Es-tu connecté en admin ?'; return; }
      // supprime l'ancienne image si elle a été remplacée
      if (pendingFile && oldPath && res.data[0].image_path !== oldPath) {
        sb.storage.from(BUCKET).remove([oldPath]).then(null, function () {});
      }
      closeEditor();
      var savedSlug = slug(name);
      CA.loadMaterials().then(function () { jumpTo(savedSlug); }, renderError);
    }, function (err) {
      saveBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }

  function del(row) {
    if (!window.confirm('Supprimer le matériau « ' + row.name + ' » ? Les filaments qui l\'utilisent perdront leur prix.')) return;
    sb.from('materials').delete().eq('brand', row.brand).eq('name', row.name).select().then(function (res) {
      if (res.error) { window.alert('Erreur : ' + res.error.message); return; }
      if (!res.data || !res.data.length) { window.alert('Suppression refusée (permissions).'); return; }
      CA.loadMaterials().then(null, renderError);
    });
  }

  /* ---- rendu liste ---- */
  function renderError() {
    listEl.innerHTML = '<p class="empty">Impossible de charger les matériaux.<br>Si c\'est la première fois, exécute ' +
      '<strong>V2/supabase/schema-v2.sql</strong> dans Supabase.</p>';
  }
  function marginPill(label, sell, cost) {
    var s = +sell || 0, c = +cost || 0, m = s - c;
    if (!s && !c) return '';
    var pct = s > 0 ? Math.round(m / s * 100) : 0;
    return '<span class="card-margin ' + (m >= 0 ? 'pos' : 'neg') + '">' + label + ' ' + money(m) + (s > 0 ? ' · ' + pct + '%' : '') + '</span>';
  }
  function render() {
    var list = brandMaterials();
    if (!list.length) {
      listEl.innerHTML = '<p class="empty">Aucun matériau pour <b>' + esc(CA.currentBrand || '—') + '</b>.<br>' +
        'Clique «&nbsp;+ Nouveau matériau&nbsp;» pour fixer le prix d\'un type (ex. PLA Basic).</p>';
      buildNav();
      return;
    }
    listEl.innerHTML = list.map(function (m) {
      var hasS = m.sell_spool != null, hasR = m.sell_refill != null;
      var tag = hasS && hasR ? '' : (hasS ? ' <span class="hint">(bobine seulement)</span>' : ' <span class="hint">(recharge seulement)</span>');
      var ts = tiersSummary(m.tiers_spool), tr = tiersSummary(m.tiers_refill);
      return '<article class="mat-row" id="mat-' + slug(m.name) + '" data-name="' + esc(m.name) + '">' +
        '<div class="mat-main">' +
          '<div class="mat-name">' + esc(m.name) + tag + '</div>' +
          '<div class="mat-prices money">' +
            (hasS ? '<span>Bobine : <b>' + money(m.sell_spool) + '</b></span>' : '') +
            (hasR ? '<span>Recharge : <b>' + money(m.sell_refill) + '</b></span>' : '') +
          '</div>' +
          '<div class="card-margins">' +
            (hasS ? marginPill('Bobine', m.sell_spool, m.cost_spool) : '') +
            (hasR ? marginPill('Recharge', m.sell_refill, m.cost_refill) : '') +
          '</div>' +
          (ts ? '<div class="card-tierline">Bobine · ' + esc(ts) + '</div>' : '') +
          (tr ? '<div class="card-tierline">Recharge · ' + esc(tr) + '</div>' : '') +
        '</div>' +
        '<div class="mat-actions">' +
          '<button class="btn btn-ghost btn-sm mat-edit" type="button">Modifier</button>' +
          '<button class="btn btn-ghost btn-sm mat-del" type="button">Suppr.</button>' +
        '</div>' +
      '</article>';
    }).join('');

    $$('.mat-row', listEl).forEach(function (el) {
      var name = el.getAttribute('data-name');
      var row = CA.materialOf(CA.currentBrand, name);
      $('.mat-edit', el).addEventListener('click', function () { openEditor(row); });
      $('.mat-del', el).addEventListener('click', function () { del(row); });
    });
    buildNav();
  }

  /* ---- liste latérale « Aller au matériau » ---- */
  function buildNav() {
    var nav = document.getElementById('mat-nav');
    if (!nav) return;
    var list = brandMaterials();
    if (!list.length) { nav.innerHTML = ''; return; }
    nav.innerHTML = '<div class="mat-nav-title">Matériaux</div>' + list.map(function (m) {
      return '<a href="#mat-' + slug(m.name) + '" class="mat-nav-link" data-slug="' + slug(m.name) + '">' + esc(m.name) + '</a>';
    }).join('');
    $$('.mat-nav-link', nav).forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); jumpTo(a.getAttribute('data-slug')); });
    });
  }
  function jumpTo(sl) {
    // cible en priorité l'en-tête des couleurs (section Filaments) ;
    // repli sur la ligne matériau si aucune couleur pour ce matériau.
    var target = document.getElementById('fil-' + sl);
    if (!target) {
      if (section.hidden) { section.hidden = false; if (toggleBtn) { toggleBtn.textContent = 'Masquer'; toggleBtn.setAttribute('aria-expanded', 'true'); } }
      target = document.getElementById('mat-' + sl);
    }
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('flash');
    setTimeout(function () { target.classList.remove('flash'); }, 1200);
  }
})();
