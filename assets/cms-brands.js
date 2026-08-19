/* =========================================================
   Création Audio V2 — CMS Marques
   Couche « Marque » au-dessus des matériaux (Bambu Lab, Elegoo…).
   Barre de marques en haut de l'onglet Filaments ; scope la marque
   courante pour les matériaux et les filaments.
   Expose sur window.CA :
     - CA.brands = { list, loaded }
     - CA.currentBrand           (nom de la marque sélectionnée)
     - CA.setBrand(name)
     - CA.onBrandChange(cb)
     - CA.loadBrands()           -> Promise(list)
   À charger AVANT cms-materials.js.
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';

  var sb = window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var BUCKET = 'products';
  function publicUrl(path) { if (!path) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function curBrandObj() { return CA.brands.list.filter(function (b) { return b.name === CA.currentBrand; })[0] || null; }

  // input fichier caché, réutilisé pour le logo de marque
  var fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', function () { var f = fileInput.files && fileInput.files[0]; fileInput.value = ''; if (f) uploadLogo(f); });

  CA.brands = { list: [], loaded: false };
  CA.currentBrand = null;
  var listeners = [];
  CA.onBrandChange = function (cb) { if (typeof cb === 'function') listeners.push(cb); };
  function notify() { listeners.forEach(function (cb) { try { cb(CA.currentBrand); } catch (e) {} }); }

  var LAST_KEY = 'ca_admin_brand';
  function remember(b) { try { localStorage.setItem(LAST_KEY, b); } catch (e) {} }
  function recalled() { try { return localStorage.getItem(LAST_KEY); } catch (e) { return null; } }

  CA.setBrand = function (name) {
    if (!name || name === CA.currentBrand) { renderBar(); return; }
    CA.currentBrand = name; remember(name);
    renderBar(); notify();
  };

  CA.loadBrands = function () {
    return sb.from('brands').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        CA.brands = { list: res.data || [], loaded: true };
        if (!CA.brands.list.length) { renderBar(); return CA.brands.list; }
        // choisir la marque courante : mémorisée si encore valide, sinon la première
        var names = CA.brands.list.map(function (b) { return b.name; });
        var want = (CA.currentBrand && names.indexOf(CA.currentBrand) > -1) ? CA.currentBrand
                 : (recalled() && names.indexOf(recalled()) > -1 ? recalled() : names[0]);
        CA.currentBrand = want;
        renderBar(); notify();
        return CA.brands.list;
      });
  };

  var bar = $('#brand-bar');

  if (CA.onAdminReady) CA.onAdminReady(function () { CA.loadBrands().then(null, function () { if (bar) bar.innerHTML = '<span class="muted">Impossible de charger les marques (exécute schema-v2.sql).</span>'; }); });

  function renderBar() {
    if (!bar) return;
    var chips = CA.brands.list.map(function (b) {
      return '<button type="button" class="brand-chip' + (b.name === CA.currentBrand ? ' is-active' : '') + '" draggable="true" title="Glisser pour réordonner" data-brand="' + esc(b.name) + '">' + esc(b.name) + '</button>';
    }).join('');
    bar.innerHTML =
      '<span class="brand-bar-label">Marque</span>' +
      '<div class="brand-chips">' + chips + '</div>' +
      '<div class="brand-bar-actions">' +
        (CA.currentBrand ?
          (curBrandObj() && curBrandObj().image_path ? '<img class="brand-logo-thumb" src="' + esc(publicUrl(curBrandObj().image_path)) + '" alt="logo ' + esc(CA.currentBrand) + '">' : '') +
          '<button type="button" class="btn btn-ghost btn-sm" id="brand-image">' + (curBrandObj() && curBrandObj().image_path ? 'Changer l\'image' : '+ Image de marque') + '</button>' +
          (curBrandObj() && curBrandObj().image_path ? '<button type="button" class="btn btn-ghost btn-sm" id="brand-image-rm">Retirer l\'image</button>' : '') +
          '<button type="button" class="btn btn-ghost btn-sm" id="brand-rename">Renommer</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" id="brand-del">Supprimer</button>' : '') +
        '<button type="button" class="btn btn-accent btn-sm" id="brand-new">+ Nouvelle marque</button>' +
      '</div>';

    $$('.brand-chip', bar).forEach(function (c) {
      c.addEventListener('click', function () { CA.setBrand(c.getAttribute('data-brand')); });
      wireBrandDrag(c);
    });
    var nb = $('#brand-new'); if (nb) nb.addEventListener('click', addBrand);
    var rb = $('#brand-rename'); if (rb) rb.addEventListener('click', renameBrand);
    var db = $('#brand-del'); if (db) db.addEventListener('click', deleteBrand);
    var ib = $('#brand-image'); if (ib) ib.addEventListener('click', function () { fileInput.click(); });
    var ir = $('#brand-image-rm'); if (ir) ir.addEventListener('click', removeLogo);
  }

  /* ---- glisser-déposer : réordonner les marques (pilote l'ordre en boutique) ---- */
  var bDrag = null;
  function wireBrandDrag(el) {
    el.addEventListener('dragstart', function (e) {
      bDrag = el.getAttribute('data-brand'); el.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', bDrag); } catch (_) {} }
    });
    el.addEventListener('dragend', function () {
      bDrag = null; el.classList.remove('dragging');
      $$('.brand-chip', bar).forEach(function (c) { c.classList.remove('drop-target'); });
    });
    el.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('dragenter', function () { if (el.getAttribute('data-brand') !== bDrag) el.classList.add('drop-target'); });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-target'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      var target = el.getAttribute('data-brand');
      if (!bDrag || bDrag === target) return;
      reorderBrands(bDrag, target);
    });
  }
  function reorderBrands(fromName, toName) {
    var seq = CA.brands.list.slice();
    var names = seq.map(function (b) { return b.name; });
    var from = names.indexOf(fromName), to = names.indexOf(toName);
    if (from < 0 || to < 0) return;
    var moved = seq.splice(from, 1)[0];
    seq.splice(to, 0, moved);
    CA.brands.list = seq;
    renderBar();
    persistBrandOrder(seq);
  }
  function persistBrandOrder(seq) {
    var updates = seq.map(function (b, i) {
      if (b.sort_order === i) return null;
      b.sort_order = i;
      return sb.from('brands').update({ sort_order: i }).eq('name', b.name);
    }).filter(Boolean);
    if (!updates.length) return;
    Promise.all(updates).then(null, function () {});
  }

  function uploadLogo(file) {
    var brand = CA.currentBrand; if (!brand) return;
    var ext = (String(file.name).split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    var path = 'brands/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var oldPath = (curBrandObj() || {}).image_path || null;
    sb.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
      .then(function (res) { if (res.error) throw res.error; return sb.from('brands').update({ image_path: path }).eq('name', brand).select(); })
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Refusé (permissions). Es-tu connecté en admin ?');
        if (oldPath) sb.storage.from(BUCKET).remove([oldPath]).then(null, function () {});
        CA.loadBrands();
      }, function (err) { window.alert('Erreur image : ' + (err && err.message ? err.message : err)); });
  }
  function removeLogo() {
    var brand = CA.currentBrand, oldPath = (curBrandObj() || {}).image_path;
    if (!brand || !oldPath) return;
    if (!window.confirm('Retirer l\'image de la marque « ' + brand + ' » ?')) return;
    sb.from('brands').update({ image_path: null }).eq('name', brand).select().then(function (res) {
      if (res.error) { window.alert('Erreur : ' + res.error.message); return; }
      sb.storage.from(BUCKET).remove([oldPath]).then(null, function () {});
      CA.loadBrands();
    });
  }

  function addBrand() {
    var name = (window.prompt('Nom de la nouvelle marque (ex. Elegoo, Anycubic) :') || '').trim();
    if (!name) return;
    if (CA.brands.list.some(function (b) { return b.name.toLowerCase() === name.toLowerCase(); })) { window.alert('Cette marque existe déjà.'); return; }
    var order = CA.brands.list.length ? Math.max.apply(null, CA.brands.list.map(function (b) { return b.sort_order || 0; })) + 1 : 0;
    sb.from('brands').insert({ name: name, sort_order: order }).select().then(function (res) {
      if (res.error) { window.alert('Erreur : ' + res.error.message); return; }
      if (!res.data || !res.data.length) { window.alert('Ajout refusé (permissions).'); return; }
      CA.currentBrand = name; remember(name);
      CA.loadBrands();
    });
  }

  function renameBrand() {
    var old = CA.currentBrand; if (!old) return;
    var name = (window.prompt('Renommer la marque « ' + old +' » en :', old) || '').trim();
    if (!name || name === old) return;
    if (CA.brands.list.some(function (b) { return b.name.toLowerCase() === name.toLowerCase(); })) { window.alert('Ce nom est déjà pris.'); return; }
    // cascade : matériaux + produits de cette marque suivent
    sb.from('brands').insert({ name: name, sort_order: 0 }).select()
      .then(function (r) { if (r.error) throw r.error; return sb.from('materials').update({ brand: name }).eq('brand', old); })
      .then(function (r) { if (r.error) throw r.error; return sb.from('products').update({ brand: name }).eq('brand', old); })
      .then(function (r) { if (r.error) throw r.error; return sb.from('brands').delete().eq('name', old); })
      .then(function () {
        CA.currentBrand = name; remember(name);
        return CA.loadBrands();
      }).then(function () {
        if (CA.loadMaterials) CA.loadMaterials();
        notify(); // recharge filaments de la marque
      }, function (err) { window.alert('Erreur : ' + (err && err.message ? err.message : err)); });
  }

  function deleteBrand() {
    var name = CA.currentBrand; if (!name) return;
    if (CA.brands.list.length <= 1) { window.alert('Impossible de supprimer la dernière marque.'); return; }
    var mats = ((CA.materials && CA.materials.list) || []).filter(function (m) { return m.brand === name; }).length;
    if (mats) { window.alert('Cette marque a encore ' + mats + ' matériau(x). Supprime-les d\'abord.'); return; }
    if (!window.confirm('Supprimer la marque « ' + name + ' » ?')) return;
    sb.from('brands').delete().eq('name', name).select().then(function (res) {
      if (res.error) { window.alert('Erreur : ' + res.error.message); return; }
      CA.currentBrand = null;
      CA.loadBrands();
    });
  }
})();
