/* =========================================================
   Création Audio V2 — CMS Dealers
   Comptes autorisés au portail dealer (table « dealers »).
   Le dealer se connecte sur dealer.html avec un code à 6 chiffres envoyé
   par courriel (Edge Function compte-code, purpose 'dealer') : seul un
   courriel présent dans « dealers » reçoit un code.
   - Demandes d'accès (table dealer_requests, formulaire public revendeur.html) :
     section au-dessus de la liste, Approuver (ajout à dealers + courriel de
     bienvenue) / Refuser (silencieux) -> Edge Function dealer-request (decide).
     Pastille #nav-dealers-n = demandes en attente (relue aux 60 s).
   - Ajout à la main : on propose d'envoyer le courriel de bienvenue
     (dealer-request, invite) ; bouton « Inviter » sur chaque ligne pour le renvoyer.
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

  var loaded = false, editing = null, cache = [], reqs = [];
  var editor = $('#dl-editor'), editorTitle = $('#dl-editor-title'),
      emailI = $('#dl-email'), nameI = $('#dl-name'),
      phoneI = $('#dl-phone'), addressI = $('#dl-address'), cityI = $('#dl-city'),
      statusEl = $('#dl-status'), listEl = $('#dl-list'),
      newBtn = $('#dl-new'), refreshBtn = $('#dl-refresh'),
      saveBtn = $('#dl-save'), cancelBtn = $('#dl-cancel'),
      reqWrap = $('#dl-reqs'), reqList = $('#dl-req-list'), reqN = $('#dl-reqs-n'),
      listTitle = $('#dl-list-title'), navN = $('#nav-dealers-n');

  /* ---- cache partagé (la facturation s'en sert pour son menu dealer) ---- */
  CA.dealers = { list: [], loaded: false };
  var listeners = [];
  CA.onDealersChange = function (cb) { if (typeof cb === 'function') listeners.push(cb); };
  function notify() { listeners.forEach(function (cb) { try { cb(CA.dealers); } catch (e) {} }); }
  CA.loadDealers = function () { return load(); };

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'dealers' && !loaded) { loaded = true; load(); loadReqs(); }
  };

  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  if (refreshBtn) refreshBtn.addEventListener('click', function () { load(); loadReqs(); });
  if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
  if (editor) editor.addEventListener('submit', onSave);

  // Edge Function dealer-request (jeton de session de l'admin joint par supabase-js)
  function callFn(body) {
    return sb.functions.invoke('dealer-request', { body: body }).then(function (res) {
      if (res.error) {
        if (res.error.name === 'FunctionsFetchError') return { error: 'service injoignable' };
        var ctx = res.error.context;
        return (ctx && ctx.json ? ctx.json().catch(function () { return {}; }) : Promise.resolve({}))
          .then(function (b) { return { error: (b && b.error) || res.error.message || 'indisponible' }; });
      }
      return res.data || {};
    }, function (err) { return { error: err && err.message ? err.message : 'réseau' }; });
  }
  function invite(email) {
    return callFn({ action: 'invite', email: email }).then(function (b) {
      if (b.ok) caDialog.toast('Courriel de bienvenue envoyé');
      else caDialog.error(b.error === 'mail' ? 'Le courriel n\'a pas pu partir (Resend).' : 'Envoi impossible : ' + b.error);
    });
  }

  function openEditor(row) {
    editing = row ? row.email : null;
    editorTitle.textContent = row ? ('Modifier « ' + row.email + ' »') : 'Nouveau dealer';
    emailI.value = row ? row.email : '';
    emailI.readOnly = !!row;               // le courriel = clé/identité
    nameI.value = row && row.name ? row.name : '';
    phoneI.value = row && row.phone ? row.phone : '';
    addressI.value = row && row.address ? row.address : '';
    cityI.value = row && row.city ? row.city : '';
    statusEl.textContent = '';
    // grand écran : éditeur collé à droite, la liste reste visible (CA.dockEditor) ; sinon en haut, comme avant
    var docked = !!(window.CA.dockEditor && window.CA.dockEditor(editor));
    editor.hidden = false;
    if (docked) { emailI.focus({ preventScroll: true }); editor.parentNode.scrollTop = 0; return; }
    emailI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { editor.hidden = true; editing = null; }

  function onSave(e) {
    e.preventDefault();
    var email = (emailI.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { statusEl.textContent = 'Courriel invalide.'; return; }
    var isNew = !editing && !cache.some(function (d) { return d.email === email; });
    var row = { email: email, name: nameI.value.trim() || null,
      phone: phoneI.value.trim() || null, address: addressI.value.trim() || null, city: cityI.value.trim() || null };
    saveBtn.disabled = true; statusEl.textContent = 'Enregistrement…';
    sb.from('dealers').upsert(row, { onConflict: 'email' }).select().then(function (res) {
      saveBtn.disabled = false;
      if (res.error) { statusEl.textContent = 'Erreur : ' + res.error.message; return; }
      if (!res.data || !res.data.length) { statusEl.textContent = 'Refusé (permissions). Es-tu connecté en admin ?'; return; }
      closeEditor(); load();
      if (isNew) caDialog.confirm({ title: 'Envoyer le courriel de bienvenue ?', icon: 'plus',
        message: email + ' recevra le lien du portail et la connexion par code.', ok: 'Envoyer', cancel: 'Plus tard' })
        .then(function (ok) { if (ok) invite(email); });
    }, function (err) { saveBtn.disabled = false; statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err); });
  }

  function del(row) {
    // Côté base (trigger dealers_access_sync) : compte bloqué + sessions fermées ; le rajouter le débloque.
    caDialog.confirm({ title: 'Retirer l\'accès dealer ?', message: row.email + ' sera bloqué et déconnecté.', ok: 'Retirer l\'accès', danger: true }).then(function (ok) {
      if (!ok) return;
      sb.from('dealers').delete().eq('email', row.email).select().then(function (res) {
        if (res.error) { caDialog.error(res.error); return; }
        if (!res.data || !res.data.length) { caDialog.error('Suppression refusée (permissions).'); return; }
        load();
      });
    });
  }

  function load() {
    if (loaded) listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return sb.from('dealers').select('*').order('created_at', { ascending: true }).then(function (res) {
      if (res.error) { if (loaded) listEl.innerHTML = '<p class="empty">Impossible de charger.<br>As-tu relancé <strong>schema-v2.sql</strong> ?</p>'; return []; }
      cache = res.data || [];
      CA.dealers = { list: cache, loaded: true };
      notify();
      if (loaded) render();
      return cache;
    }, function () { if (loaded) listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; return []; });
  }

  function render() {
    if (!cache.length) {
      listEl.innerHTML = '<p class="empty">Aucun dealer pour l\'instant.<br>Approuve une demande ou clique «&nbsp;+ Ajouter un dealer&nbsp;».</p>';
      return;
    }
    listEl.innerHTML = cache.map(function (d) {
      var loc = [d.address, d.city].filter(Boolean).join(', ');
      return '<div class="mat-row person" data-email="' + esc(d.email) + '">' +
        CA.avatar(d.name || d.email) +
        '<div class="mat-main">' +
          '<div class="mat-name">' + esc(d.name || d.email) + ' <span class="person-tag">Portail dealer</span></div>' +
          '<div class="person-meta">' +
            '<span class="pm pm-mail">' + CA.pv(d.email) + '</span>' +
            (d.phone ? '<span class="pm pm-tel">' + CA.pv(d.phone) + '</span>' : '') +
            (loc ? '<span class="pm pm-loc">' + esc(loc) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="mat-actions">' +
          '<button class="btn btn-ghost btn-sm dl-invite" type="button" data-ic="mail">Inviter</button>' +
          '<button class="btn btn-ghost btn-sm dl-edit" type="button">Modifier</button>' +
          '<button class="btn btn-ghost btn-sm dl-del" type="button">Retirer</button>' +
        '</div>' +
      '</div>';
    }).join('');
    $$('.mat-row', listEl).forEach(function (el) {
      var d = cache.filter(function (x) { return x.email === el.getAttribute('data-email'); })[0];
      $('.dl-invite', el).addEventListener('click', function () {
        caDialog.confirm({ title: 'Envoyer le courriel de bienvenue ?', icon: 'plus',
          message: d.email + ' recevra le lien du portail et la connexion par code.', ok: 'Envoyer' })
          .then(function (ok) { if (ok) invite(d.email); });
      });
      $('.dl-edit', el).addEventListener('click', function () { openEditor(d); });
      $('.dl-del', el).addEventListener('click', function () { del(d); });
    });
  }

  /* ---- demandes d'accès (revendeur.html) ---- */
  function paintBadge(n) {
    if (!navN) return;
    navN.textContent = n; navN.hidden = !n;
    var tab = navN.closest('.tab');
    if (tab) tab.setAttribute('aria-label', 'Dealers' + (n ? ' (' + n + (n > 1 ? ' demandes' : ' demande') + ')' : ''));
  }
  function refreshBadge() {
    sb.from('dealer_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').then(function (res) {
      if (res && !res.error && typeof res.count === 'number') {
        paintBadge(res.count);
        if (loaded && res.count !== reqs.length) loadReqs();
      }
    }, function () {});
  }
  if (CA.onAdminReady) CA.onAdminReady(refreshBadge);
  setInterval(function () { if (document.visibilityState === 'visible') refreshBadge(); }, 60000);

  function loadReqs() {
    return sb.from('dealer_requests').select('id,business,contact,email,phone,city,website,facebook,lang,created_at')
      .eq('status', 'pending').order('created_at', { ascending: true }).then(function (res) {
        if (res.error) { reqs = []; renderReqs(); return; }
        reqs = res.data || [];
        paintBadge(reqs.length);
        renderReqs();
      }, function () {});
  }
  // lien saisi par le demandeur : http(s) seulement, « monsite.ca » -> https://monsite.ca
  function linkOf(v) {
    v = String(v || '').trim();
    if (!v || /^(?!https?:)[a-z][a-z0-9+.-]*:(?!\d)/i.test(v)) return '';   // javascript:, mailto:… -> pas de lien
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
    return /^https?:\/\/[^\s"<>]+$/i.test(v) ? v : '';
  }
  function when(iso) {
    var t = Date.parse(iso); if (!isFinite(t)) return '';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 60) return 'il y a ' + Math.max(1, m) + ' min';
    if (m < 60 * 24) return 'il y a ' + Math.round(m / 60) + ' h';
    return new Date(t).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
  }
  function renderReqs() {
    if (!reqWrap) return;
    reqWrap.hidden = !reqs.length;
    if (listTitle) listTitle.hidden = !reqs.length;
    reqN.textContent = reqs.length;
    reqList.innerHTML = reqs.map(function (r) {
      var web = linkOf(r.website), fb = linkOf(r.facebook);
      return '<div class="mat-row person" data-id="' + esc(r.id) + '">' +
        CA.avatar(r.business) +
        '<div class="mat-main">' +
          '<div class="mat-name">' + esc(r.business) + ' <span class="person-tag">' + (r.lang === 'en' ? 'Demande · EN' : 'Demande') + '</span></div>' +
          '<div class="person-meta">' +
            '<span class="pm">' + esc(r.contact) + '</span>' +
            '<span class="pm pm-mail">' + CA.pv(r.email) + '</span>' +
            '<span class="pm pm-tel">' + CA.pv(r.phone) + '</span>' +
            '<span class="pm pm-loc">' + esc(r.city) + '</span>' +
            (web ? '<span class="pm pm-link"><a href="' + esc(web) + '" target="_blank" rel="noopener noreferrer">Site web</a></span>' : '') +
            (fb ? '<span class="pm pm-link"><a href="' + esc(fb) + '" target="_blank" rel="noopener noreferrer">Facebook</a></span>' : '') +
            '<span class="pm pm-date">' + esc(when(r.created_at)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="mat-actions">' +
          '<button class="btn btn-accent btn-sm dl-ok" type="button" data-ic="check">Approuver</button>' +
          '<button class="btn btn-ghost btn-sm dl-no" type="button">Refuser</button>' +
        '</div>' +
      '</div>';
    }).join('');
    $$('.mat-row', reqList).forEach(function (el) {
      var r = reqs.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
      $('.dl-ok', el).addEventListener('click', function () { decide(r, true, el); });
      $('.dl-no', el).addEventListener('click', function () { decide(r, false, el); });
    });
  }
  function decide(r, approve, el) {
    caDialog.confirm(approve
      ? { title: 'Approuver ' + r.business + ' ?', icon: 'plus', ok: 'Approuver',
          message: 'Accès au portail ouvert et courriel de bienvenue envoyé à ' + r.email + '.' }
      : { title: 'Refuser la demande ?', danger: true, ok: 'Refuser',
          message: r.business + ' ne recevra aucun courriel.' })
      .then(function (ok) {
        if (!ok) return;
        $$('button', el).forEach(function (b) { b.disabled = true; });
        callFn({ action: 'decide', id: r.id, approve: approve }).then(function (b) {
          if (!b.ok) {
            $$('button', el).forEach(function (x) { x.disabled = false; });
            caDialog.error('Action impossible : ' + b.error);
            return;
          }
          if (approve) caDialog.toast(b.mailed ? r.business + ' approuvé · courriel envoyé' : r.business + ' approuvé · courriel non parti', b.mailed ? '' : 'bad');
          else caDialog.toast('Demande refusée');
          loadReqs();
          if (approve) load();
        });
      });
  }
})();
