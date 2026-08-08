/* =========================================================
   Création Audio V2 — CMS Dealers
   Comptes autorisés au portail dealer (table « dealers »).
   L'admin ajoute le courriel du compte Supabase du dealer ;
   ce compte voit alors les prix dealer + rabais sur dealer.html.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var loaded = false, editing = null, cache = [];
  var editor = $('#dl-editor'), editorTitle = $('#dl-editor-title'),
      emailI = $('#dl-email'), nameI = $('#dl-name'),
      statusEl = $('#dl-status'), listEl = $('#dl-list'),
      newBtn = $('#dl-new'), refreshBtn = $('#dl-refresh'),
      saveBtn = $('#dl-save'), cancelBtn = $('#dl-cancel');

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'dealers' && !loaded) { loaded = true; load(); }
  };

  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  if (refreshBtn) refreshBtn.addEventListener('click', load);
  if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
  if (editor) editor.addEventListener('submit', onSave);

  function openEditor(row) {
    editing = row ? row.email : null;
    editorTitle.textContent = row ? ('Modifier « ' + row.email + ' »') : 'Nouveau dealer';
    emailI.value = row ? row.email : '';
    emailI.readOnly = !!row;               // le courriel = clé/identité
    nameI.value = row && row.name ? row.name : '';
    statusEl.textContent = '';
    editor.hidden = false;
    emailI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { editor.hidden = true; editing = null; }

  function onSave(e) {
    e.preventDefault();
    var email = (emailI.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { statusEl.textContent = 'Courriel invalide.'; return; }
    var row = { email: email, name: nameI.value.trim() || null };
    saveBtn.disabled = true; statusEl.textContent = 'Enregistrement…';
    sb.from('dealers').upsert(row, { onConflict: 'email' }).select().then(function (res) {
      saveBtn.disabled = false;
      if (res.error) { statusEl.textContent = 'Erreur : ' + res.error.message; return; }
      if (!res.data || !res.data.length) { statusEl.textContent = 'Refusé (permissions). Es-tu connecté en admin ?'; return; }
      closeEditor(); load();
    }, function (err) { saveBtn.disabled = false; statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err); });
  }

  function del(row) {
    if (!window.confirm('Retirer l\'accès dealer de « ' + row.email + ' » ?')) return;
    sb.from('dealers').delete().eq('email', row.email).select().then(function (res) {
      if (res.error) { window.alert('Erreur : ' + res.error.message); return; }
      if (!res.data || !res.data.length) { window.alert('Suppression refusée (permissions).'); return; }
      load();
    });
  }

  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    sb.from('dealers').select('*').order('created_at', { ascending: true }).then(function (res) {
      if (res.error) { listEl.innerHTML = '<p class="empty">Impossible de charger.<br>As-tu relancé <strong>schema-v2.sql</strong> ?</p>'; return; }
      cache = res.data || [];
      render();
    }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  function render() {
    if (!cache.length) {
      listEl.innerHTML = '<p class="empty">Aucun dealer pour l\'instant.<br>Clique «&nbsp;+ Ajouter un dealer&nbsp;» et saisis le courriel de son compte.</p>';
      return;
    }
    listEl.innerHTML = cache.map(function (d) {
      return '<div class="mat-row" data-email="' + esc(d.email) + '">' +
        '<div class="mat-main">' +
          '<div class="mat-name">' + esc(d.name || d.email) + '</div>' +
          '<div class="mat-prices"><span>' + esc(d.email) + '</span></div>' +
        '</div>' +
        '<div class="mat-actions">' +
          '<button class="btn btn-ghost btn-sm dl-edit" type="button">Modifier</button>' +
          '<button class="btn btn-ghost btn-sm dl-del" type="button">Retirer</button>' +
        '</div>' +
      '</div>';
    }).join('');
    $$('.mat-row', listEl).forEach(function (el) {
      var d = cache.filter(function (x) { return x.email === el.getAttribute('data-email'); })[0];
      $('.dl-edit', el).addEventListener('click', function () { openEditor(d); });
      $('.dl-del', el).addEventListener('click', function () { del(d); });
    });
  }
})();
