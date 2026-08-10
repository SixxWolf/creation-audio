/* =========================================================
   Création Audio V2 — CMS Clients (carnet de facturation)
   Table « clients » : nom, courriel, téléphone, adresse, ville.
   Sert à resuggérer un client sur une facture (autocomplétion) ;
   chaque facture enregistrée mémorise aussi son client ici.
   Expose sur window.CA :
     - CA.clients = { list, loaded }
     - CA.loadClients()          -> Promise(list)  (recharge + notifie)
     - CA.onClientsChange(cb)     -> abonnement
     - CA.rememberClient(fields)  -> upsert depuis une facture (auto-mémo)
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
  function norm(s) { return String(s == null ? '' : s).trim(); }
  function lc(s) { return norm(s).toLowerCase(); }

  /* ---- cache partagé + abonnements ---- */
  CA.clients = { list: [], loaded: false };
  var listeners = [];
  CA.onClientsChange = function (cb) { if (typeof cb === 'function') listeners.push(cb); };
  function notify() { listeners.forEach(function (cb) { try { cb(CA.clients); } catch (e) {} }); }

  CA.loadClients = function () {
    return sb.from('clients').select('*').order('name', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        CA.clients = { list: res.data || [], loaded: true };
        notify();
        return CA.clients.list;
      });
  };

  // retrouve un client déjà connu (par courriel puis par nom, insensible à la casse)
  function findClient(fields) {
    var list = CA.clients.list || [];
    var email = lc(fields.email);
    if (email) { var byMail = list.filter(function (c) { return lc(c.email) === email; })[0]; if (byMail) return byMail; }
    var name = lc(fields.name);
    if (name) { var byName = list.filter(function (c) { return lc(c.name) === name; })[0]; if (byName) return byName; }
    return null;
  }

  // Auto-mémorisation depuis une facture : crée ou met à jour le client.
  // Ne conserve que des valeurs non vides ; renvoie une promesse (silencieuse).
  CA.rememberClient = function (fields) {
    fields = fields || {};
    var name = norm(fields.name);
    if (!name) return Promise.resolve(null);
    var ensure = CA.clients.loaded ? Promise.resolve() : CA.loadClients().then(null, function () {});
    return ensure.then(function () {
      var existing = findClient(fields);
      var patch = {
        name: name,
        email: norm(fields.email) || (existing && existing.email) || null,
        phone: norm(fields.phone) || (existing && existing.phone) || null,
        address: norm(fields.address) || (existing && existing.address) || null,
        city: norm(fields.city) || (existing && existing.city) || null,
        updated_at: new Date().toISOString()
      };
      var q = existing
        ? sb.from('clients').update(patch).eq('id', existing.id).select()
        : sb.from('clients').insert(patch).select();
      return q.then(function (res) {
        if (res.error) return null;                 // best-effort : n'interrompt jamais la facture
        return CA.loadClients().then(function () { return (res.data && res.data[0]) || null; }, function () { return null; });
      }, function () { return null; });
    });
  };

  /* ---- éléments (onglet Clients) ---- */
  var loaded = false, editingId = null;
  var editor = $('#cl-editor'), editorTitle = $('#cl-editor-title'),
      nameI = $('#cl-name'), emailI = $('#cl-email'), phoneI = $('#cl-phone'),
      addressI = $('#cl-address'), cityI = $('#cl-city'),
      statusEl = $('#cl-status'), listEl = $('#cl-list'),
      newBtn = $('#cl-new'), refreshBtn = $('#cl-refresh'),
      saveBtn = $('#cl-save'), cancelBtn = $('#cl-cancel');

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'clients' && !loaded) { loaded = true; CA.loadClients().then(render, renderError); }
  };
  // se réaffiche si le cache change (ex. mémorisation depuis une facture)
  CA.onClientsChange(function () { if (loaded) render(); });

  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  if (refreshBtn) refreshBtn.addEventListener('click', function () { CA.loadClients().then(render, renderError); });
  if (cancelBtn) cancelBtn.addEventListener('click', function () { var id = editingId; closeEditor(); focusRow(id, true); });
  if (editor) editor.addEventListener('submit', onSave);

  /* ---- éditeur ---- */
  function moveEditorHome() {
    if (listEl && listEl.parentNode && editor.nextSibling !== listEl) listEl.parentNode.insertBefore(editor, listEl);
    editor.classList.remove('is-inline');
  }
  function focusRow(id, gentle) {
    if (!id) return;
    var el = $$('.mat-row', listEl).filter(function (r) { return r.getAttribute('data-id') === String(id); })[0];
    if (!el) return;
    el.scrollIntoView(gentle ? { block: 'nearest' } : { behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1200);
  }
  function openEditor(row, rowEl) {
    editingId = row ? row.id : null;
    editorTitle.textContent = row ? 'Modifier le client' : 'Nouveau client';
    nameI.value = row ? (row.name || '') : '';
    emailI.value = row && row.email ? row.email : '';
    phoneI.value = row && row.phone ? row.phone : '';
    addressI.value = row && row.address ? row.address : '';
    cityI.value = row && row.city ? row.city : '';
    statusEl.textContent = '';
    if (rowEl && rowEl.parentNode) { rowEl.insertAdjacentElement('afterend', editor); editor.classList.add('is-inline'); }
    else moveEditorHome();
    editor.hidden = false;
    nameI.focus({ preventScroll: true });
    editor.scrollIntoView({ behavior: 'smooth', block: rowEl ? 'nearest' : 'start' });
  }
  function closeEditor() { moveEditorHome(); editor.hidden = true; editingId = null; }

  function onSave(e) {
    e.preventDefault();
    var name = norm(nameI.value);
    if (!name) { nameI.focus(); return; }
    var patch = {
      name: name,
      email: norm(emailI.value) || null,
      phone: norm(phoneI.value) || null,
      address: norm(addressI.value) || null,
      city: norm(cityI.value) || null,
      updated_at: new Date().toISOString()
    };
    saveBtn.disabled = true; statusEl.textContent = 'Enregistrement…';
    var q = editingId
      ? sb.from('clients').update(patch).eq('id', editingId).select()
      : sb.from('clients').insert(patch).select();
    q.then(function (res) {
      saveBtn.disabled = false;
      if (res.error) {
        statusEl.textContent = /clients_email_uidx|duplicate|unique|23505/i.test(res.error.message || '')
          ? 'Un client avec ce courriel existe déjà.' : 'Erreur : ' + res.error.message;
        return;
      }
      if (!res.data || !res.data.length) { statusEl.textContent = 'Refusé (permissions). Es-tu connecté en admin ?'; return; }
      var savedId = res.data[0].id;
      closeEditor();
      CA.loadClients().then(function () { focusRow(savedId, true); }, renderError);
    }, function (err) { saveBtn.disabled = false; statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err); });
  }

  function del(row) {
    if (!window.confirm('Supprimer le client « ' + row.name + ' » ? (n\'affecte pas les factures déjà enregistrées)')) return;
    sb.from('clients').delete().eq('id', row.id).select().then(function (res) {
      if (res.error) { window.alert('Erreur : ' + res.error.message); return; }
      if (!res.data || !res.data.length) { window.alert('Suppression refusée (permissions).'); return; }
      CA.loadClients().then(render, renderError);
    });
  }

  /* ---- rendu liste ---- */
  function renderError() { listEl.innerHTML = '<p class="empty">Impossible de charger les clients.<br>As-tu relancé <strong>schema-v2.sql</strong> dans Supabase ?</p>'; }
  function render() {
    moveEditorHome();
    var list = CA.clients.list || [];
    if (!list.length) {
      listEl.innerHTML = '<p class="empty">Aucun client pour l\'instant.<br>Clique «&nbsp;+ Ajouter un client&nbsp;», ou enregistre une facture : le client sera mémorisé ici.</p>';
      return;
    }
    listEl.innerHTML = list.map(function (c) {
      var contact = [c.email, c.phone].filter(Boolean).join(' · ');
      var loc = [c.address, c.city].filter(Boolean).join(', ');
      return '<article class="mat-row" data-id="' + esc(c.id) + '">' +
        '<div class="mat-main">' +
          '<div class="mat-name">' + esc(c.name) + '</div>' +
          (contact ? '<div class="mat-prices"><span>' + esc(contact) + '</span></div>' : '') +
          (loc ? '<div class="mat-prices"><span>' + esc(loc) + '</span></div>' : '') +
        '</div>' +
        '<div class="mat-actions">' +
          '<button class="btn btn-ghost btn-sm cl-edit" type="button">Modifier</button>' +
          '<button class="btn btn-ghost btn-sm cl-del" type="button">Suppr.</button>' +
        '</div>' +
      '</article>';
    }).join('');
    $$('.mat-row', listEl).forEach(function (el) {
      var c = list.filter(function (x) { return String(x.id) === el.getAttribute('data-id'); })[0];
      $('.cl-edit', el).addEventListener('click', function () { openEditor(c, el); });
      $('.cl-del', el).addEventListener('click', function () { del(c); });
    });
  }
})();
