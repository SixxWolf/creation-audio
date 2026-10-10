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
     - CA.loadAccounts()          -> comptes en ligne (customers), voir plus bas
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
    if (name === 'clients' && !loaded) { loaded = true; reloadAll(); }
  };
  function reloadAll() {
    return Promise.all([CA.loadClients(), CA.loadAccounts().then(null, function () { return []; })]).then(render, renderError);
  }
  // se réaffiche si le cache change (ex. mémorisation depuis une facture)
  CA.onClientsChange(function () { if (loaded) render(); });

  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  if (refreshBtn) refreshBtn.addEventListener('click', function () { clientInvs = null; reloadAll(); });
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
    if (!window.confirm('Supprimer le client « ' + row.name + ' » ? (n\'affecte pas les factures déjà enregistrées)' +
      (accOf(row.id) ? '\nSon compte en ligne sera délié.' : ''))) return;
    sb.from('clients').delete().eq('id', row.id).select().then(function (res) {
      if (res.error) { window.alert('Erreur : ' + res.error.message); return; }
      if (!res.data || !res.data.length) { window.alert('Suppression refusée (permissions).'); return; }
      reloadAll();   // le compte relié à cette fiche est délié par la base (on delete set null)
    });
  }

  /* ---- rendu liste ---- */
  function renderError() { listEl.innerHTML = '<p class="empty">Impossible de charger les clients.<br>As-tu relancé <strong>schema-v2.sql</strong> dans Supabase ?</p>'; }
  function render() {
    moveEditorHome();
    renderAccounts();
    var list = CA.clients.list || [];
    if (!list.length) {
      listEl.innerHTML = '<p class="empty">Aucun client pour l\'instant.<br>Clique «&nbsp;+ Ajouter un client&nbsp;», ou enregistre une facture : le client sera mémorisé ici.</p>';
      return;
    }
    listEl.innerHTML = list.map(function (c) {
      var loc = [c.address, c.city].filter(Boolean).join(', ');
      var meta = (c.email ? '<span class="pm pm-mail">' + esc(c.email) + '</span>' : '') +
        (c.phone ? '<span class="pm pm-tel">' + esc(c.phone) + '</span>' : '') +
        (loc ? '<span class="pm pm-loc">' + esc(loc) + '</span>' : '');
      return '<article class="mat-row person" data-id="' + esc(c.id) + '">' +
        CA.avatar(c.name) +
        '<div class="mat-main">' +
          '<div class="mat-name">' + esc(c.name) + (accOf(c.id) ? '<span class="person-tag">Compte</span>' : '') + '</div>' +
          '<div class="person-meta">' + (meta || '<span class="pm pm-none">Aucune coordonnée</span>') + '</div>' +
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

  /* =========================================================
     COMPTES EN LIGNE (compte.html) — table customers.
     Un compte se crée seul (connexion par code courriel) ; l'admin le RELIE à
     une fiche : le client voit alors les factures de cette fiche
     (invoices.client_id, RPC me_invoices sans coûts). Les nouvelles factures
     d'une fiche s'y relient d'office (trigger invoices_link_client).
     Pastille « à relier » sur l'onglet Clients (#nav-clients-n).
     « Peut réserver » = customers.can_reserve (réservations, étape 3).
     ========================================================= */
  var accWrap = $('#cl-accounts'), accList = $('#cl-acc-list'), accN = $('#cl-acc-n'),
      navN = $('#nav-clients-n'), cardsTitle = $('#cl-cards-title');
  var accounts = [], clientInvs = null;

  // comparaison de noms tolérante (casse, accents, espaces)
  function nk(s) { return lc(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' '); }
  function money(n) { return (+n || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function fmtD(d) {
    if (!d) return '';
    var x = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
    return isNaN(x) ? '' : x.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function accOf(clientId) {
    return accounts.filter(function (a) { return a.client_id && String(a.client_id) === String(clientId); })[0] || null;
  }
  function clientOf(id) {
    return (CA.clients.list || []).filter(function (c) { return String(c.id) === String(id); })[0] || null;
  }

  CA.loadAccounts = function () {
    return sb.from('customers').select('id, email, name, phone, client_id, can_reserve, no_shows, reserve_suspended_until, created_at, last_seen_at, linked_at')
      .order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        accounts = res.data || [];
        badge();
        return accounts;
      });
  };
  function badge() {
    var n = accounts.filter(function (a) { return !a.client_id; }).length;
    [navN, accN].forEach(function (el) { if (el) { el.hidden = !n; el.textContent = n; } });
  }
  if (CA.onAdminReady) CA.onAdminReady(function () { CA.loadAccounts().then(function () { if (loaded) render(); }, function () {}); });

  function renderAccounts() {
    if (!accWrap) return;
    closeLinker();
    accWrap.hidden = !accounts.length;
    if (cardsTitle) cardsTitle.hidden = !accounts.length;
    if (!accounts.length) { accList.innerHTML = ''; return; }
    var list = accounts.slice().sort(function (a, b) { return (a.client_id ? 1 : 0) - (b.client_id ? 1 : 0); });   // à relier d'abord
    accList.innerHTML = list.map(function (a) {
      var c = a.client_id ? clientOf(a.client_id) : null, susp = suspended(a);
      // réservations : 2 non récupérées = suspendu 60 jours (compteur remis à 0 à la suspension)
      var resTag = susp ? '<span class="pm cpt-strike">Suspendu jusqu\'au ' +
          esc(new Date(a.reserve_suspended_until).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })) + '</span>'
        : a.no_shows ? '<span class="pm cpt-strike">' + a.no_shows + ' réservation non récupérée</span>' : '';
      return '<article class="mat-row person cpt-row" data-cpt="' + esc(a.id) + '">' + CA.avatar(a.name || a.email) +
        '<div class="mat-main">' +
          '<div class="mat-name">' + esc(a.name || 'Sans nom') + (a.client_id ? '' : '<span class="person-tag">À relier</span>') + '</div>' +
          '<div class="person-meta">' + resTag + '<span class="pm pm-mail">' + esc(a.email) + '</span>' +
            (a.phone ? '<span class="pm pm-tel">' + esc(a.phone) + '</span>' : '') +
            (c ? '<span class="pm pm-link">' + esc(c.name) + '</span>' : '') +
            '<span class="pm pm-date">' + esc(fmtD(a.created_at)) + '</span></div>' +
        '</div>' +
        '<div class="mat-actions">' +
          (a.client_id
            ? '<label class="inline cpt-res"><input type="checkbox" class="cpt-res-cb"' + (a.can_reserve ? ' checked' : '') + '> Peut réserver</label>' +
              (susp ? '<button class="btn btn-ghost btn-sm cpt-lift" type="button">Lever</button>' : '') +
              '<button class="btn btn-ghost btn-sm cpt-unlink" type="button">Délier</button>'
            : '<button class="btn btn-accent btn-sm cpt-link" type="button" data-ic="check">Relier</button>') +
        '</div>' +
      '</article>';
    }).join('');
    $$('.cpt-row', accList).forEach(function (el) {
      var a = accounts.filter(function (x) { return String(x.id) === el.getAttribute('data-cpt'); })[0];
      var linkBtn = $('.cpt-link', el), unlinkBtn = $('.cpt-unlink', el), cb = $('.cpt-res-cb', el), lift = $('.cpt-lift', el);
      if (lift) lift.addEventListener('click', function () { liftReserve(a, lift); });
      if (linkBtn) linkBtn.addEventListener('click', function () { openLinker(a, el); });
      if (unlinkBtn) unlinkBtn.addEventListener('click', function () { unlink(a); });
      if (cb) cb.addEventListener('change', function () { setReserve(a, cb); });
    });
  }

  /* ---- relier : choix de la fiche + factures qui deviendront visibles ---- */
  function loadClientInvoices() {
    if (clientInvs) return Promise.resolve(clientInvs);
    return sb.from('invoices').select('id, number, invoice_date, total, client_name, client_id, status')
      .eq('client_type', 'client').order('invoice_date', { ascending: false })
      .then(function (res) { if (res.error) throw res.error; clientInvs = res.data || []; return clientInvs; });
  }
  function closeLinker() {
    $$('.cpt-linker').forEach(function (f) { if (f.parentNode) f.parentNode.removeChild(f); });
  }
  function openLinker(a, rowEl) {
    closeLinker();
    var clients = CA.clients.list || [], taken = {};
    accounts.forEach(function (x) { if (x.client_id && x.id !== a.id) taken[x.client_id] = true; });
    var same = clients.filter(function (c) { return !taken[c.id] && a.name && nk(c.name) === nk(a.name); });
    var pre = same.length === 1 ? String(same[0].id) : '__new';
    var form = document.createElement('form');
    form.className = 'editor is-inline cpt-linker';
    form.innerHTML = '<h2>Relier le compte de ' + esc(a.name || a.email) + '</h2>' +
      '<div class="field cpt-fiche-f"><label class="lbl" for="cpt-fiche">Fiche client</label>' +
        '<select id="cpt-fiche">' +
          '<option value="__new"' + (pre === '__new' ? ' selected' : '') + '>+ Nouvelle fiche « ' + esc(a.name || a.email) + ' »</option>' +
          clients.map(function (c) {
            return '<option value="' + esc(c.id) + '"' + (taken[c.id] ? ' disabled' : '') + (String(c.id) === pre ? ' selected' : '') + '>' +
              esc(c.name) + (taken[c.id] ? ' — déjà reliée' : '') + '</option>';
          }).join('') +
        '</select></div>' +
      '<div class="cpt-invs"><p class="muted">Chargement des factures…</p></div>' +
      '<div class="editor-actions">' +
        '<button class="btn btn-accent" type="submit" data-ic="check">Relier</button>' +
        '<button class="btn btn-ghost cpt-cancel" type="button">Annuler</button>' +
        '<span class="status cpt-st"></span>' +
      '</div>';
    rowEl.insertAdjacentElement('afterend', form);
    var sel = $('#cpt-fiche', form);
    function fill() {
      loadClientInvoices().then(function (invs) { renderCandidates(form, a, sel.value, invs); },
        function () { $('.cpt-invs', form).innerHTML = '<p class="muted">Factures introuvables.</p>'; });
    }
    sel.addEventListener('change', fill);
    fill();
    $('.cpt-cancel', form).addEventListener('click', closeLinker);
    form.addEventListener('submit', function (e) { e.preventDefault(); doLink(form, a, sel.value); });
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    sel.focus({ preventScroll: true });
  }
  // factures déjà sur la fiche + factures sans fiche au même nom (cochées par défaut)
  function candidates(a, fid, invs) {
    var c = fid === '__new' ? null : clientOf(fid), name = nk(c ? c.name : a.name);
    return invs.filter(function (i) {
      if (c && String(i.client_id) === String(c.id)) return true;
      return !i.client_id && !!name && nk(i.client_name) === name;
    });
  }
  function renderCandidates(form, a, fid, invs) {
    var box = $('.cpt-invs', form), list = candidates(a, fid, invs);
    if (!list.length) { box.innerHTML = '<p class="muted">Aucune facture à ce nom.</p>'; return; }
    box.innerHTML = '<div class="cpt-invs-h">Factures visibles par le client</div>' +
      '<div class="cpt-inv-list">' + list.map(function (i) {
        return '<label class="cpt-inv"><input type="checkbox" value="' + esc(i.id) + '" checked>' +
          '<b>' + esc(i.number || '—') + '</b>' +
          '<span class="cpt-inv-date">' + esc(fmtD(i.invoice_date)) + '</span>' +
          '<span class="cpt-inv-who">' + esc(i.client_name || '') + '</span>' +
          (i.status === 'cancelled' ? '<span class="cpt-inv-off">Annulée</span>' : '') +
          '<span class="cpt-inv-tot">' + money(i.total) + '</span></label>';
      }).join('') + '</div>';
  }
  function doLink(form, a, fid) {
    var st = $('.cpt-st', form), btn = $('button[type=submit]', form);
    var boxes = $$('.cpt-invs input[type=checkbox]', form);
    var on = boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    var off = boxes.filter(function (b) { return !b.checked; }).map(function (b) { return b.value; });
    btn.disabled = true; st.textContent = 'Enregistrement…';
    var ensure = fid === '__new'
      ? sb.from('clients').insert({ name: a.name || a.email, email: a.email, phone: a.phone || null }).select().then(function (r) {
          if (r.error) throw r.error;
          if (!r.data || !r.data.length) throw new Error('Refusé (permissions).');
          return r.data[0].id;
        })
      : Promise.resolve(fid);
    ensure.then(function (cid) {
      var c = clientOf(cid);
      var steps = [sb.from('customers').update({ client_id: cid, linked_at: new Date().toISOString() }).eq('id', a.id).select('id')];
      if (on.length) steps.push(sb.from('invoices').update({ client_id: cid }).in('id', on).select('id'));
      if (off.length) steps.push(sb.from('invoices').update({ client_id: null }).in('id', off).eq('client_id', cid).select('id'));
      return Promise.all(steps).then(function (rs) {
        var bad = rs.filter(function (r) { return r.error; })[0];
        if (bad) throw bad.error;
        if (!rs[0].data || !rs[0].data.length) throw new Error('Refusé (permissions).');
        // fiche sans courriel : on y recopie celui du compte (au mieux, n'échoue jamais)
        if (c && !c.email) {
          return sb.from('clients').update({ email: a.email, phone: c.phone || a.phone || null, updated_at: new Date().toISOString() })
            .eq('id', cid).then(function () {}, function () {});
        }
      });
    }).then(function () {
      clientInvs = null;
      return reloadAll();
    }, function (err) {
      btn.disabled = false;
      st.textContent = /clients_email_uidx|duplicate|unique|23505/i.test((err && err.message) || '')
        ? 'Une fiche a déjà ce courriel : choisis-la dans la liste.'
        : 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }
  function unlink(a) {
    var c = clientOf(a.client_id);
    if (!window.confirm('Délier le compte ' + a.email + (c ? ' de la fiche « ' + c.name + ' »' : '') + ' ?\nLe client ne verra plus ses factures.')) return;
    sb.from('customers').update({ client_id: null, linked_at: null }).eq('id', a.id).select('id').then(function (res) {
      if (res.error || !res.data || !res.data.length) { window.alert('Erreur : ' + (res.error ? res.error.message : 'refusé (permissions).')); return; }
      reloadAll();
    });
  }
  function setReserve(a, cb) {
    var want = cb.checked;
    cb.disabled = true;
    sb.from('customers').update({ can_reserve: want }).eq('id', a.id).select('id').then(function (res) {
      cb.disabled = false;
      if (res.error || !res.data || !res.data.length) { cb.checked = !want; window.alert('Erreur : ' + (res.error ? res.error.message : 'refusé (permissions).')); return; }
      a.can_reserve = want;
    }, function () { cb.disabled = false; cb.checked = !want; });
  }
  function suspended(a) { return !!(a.reserve_suspended_until && Date.parse(a.reserve_suspended_until) > Date.now()); }
  // « Lever » : suspension des réservations levée, compteur de non récupérées remis à 0
  function liftReserve(a, btn) {
    if (!window.confirm('Lever la suspension des réservations de ' + (a.name || a.email) + ' ?')) return;
    btn.disabled = true;
    sb.from('customers').update({ no_shows: 0, reserve_suspended_until: null }).eq('id', a.id).select('id').then(function (res) {
      if (res.error || !res.data || !res.data.length) { btn.disabled = false; window.alert('Erreur : ' + (res.error ? res.error.message : 'refusé (permissions).')); return; }
      a.no_shows = 0; a.reserve_suspended_until = null;
      renderAccounts();
    }, function () { btn.disabled = false; });
  }
})();
