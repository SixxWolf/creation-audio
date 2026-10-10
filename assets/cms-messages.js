/* =========================================================
   Création Audio — CMS Messages (messagerie du site public)
   Conversations envoyées par le panneau « Écris-nous » (assets/messagerie.js) :
   tables conversations + messages (RLS admin), photos dans le bucket privé
   « messages » (URL signées).
   - Liste (Ouvertes / Réglées / Toutes) + fil de la conversation (#messages/<id>).
   - Ouvrir une conversation = lue (admin_unread = 0).
   - Répondre (texte + photos, Ctrl+Entrée) -> Edge Function message-notify :
     courriel au client (1 par série de réponses non lues).
   - Marquer réglée / rouvrir ; Supprimer (photos effacées par l'API Storage).
   - Pastille #nav-msgs-n = conversations avec des messages non lus.
   - Loi 25 : conversations sans message depuis 12 mois effacées (photos
     comprises) au premier chargement de l'onglet.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;
  var CA = window.CA;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function ago(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s)) return '';
    if (s < 90) return 'à l\'instant';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 86400) return Math.round(s / 3600) + ' h';
    if (s < 7 * 86400) return plural(Math.round(s / 86400), 'jour', 'jours');
    return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
  }
  function day(iso) {
    var d = new Date(iso), t = new Date();
    if (d.toDateString() === t.toDateString()) return 'Aujourd\'hui';
    var y = new Date(t); y.setDate(t.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Hier';
    return d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function hour(iso) { return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  var TOPIC = { filaments: 'Filaments', spacers: 'Spacers', compte: 'Mon compte', autre: 'Autre' };
  function about(c) { return (TOPIC[c.topic] || 'Question') + (c.ref ? ' · ' + c.ref : ''); }
  function who(c) { var k = c.customers || {}; return k.name || k.email || 'Client'; }
  var MAX_PHOTOS = 4, MAX_SIDE = 1600, KEEP_DAYS = 365;

  var wrap = $('#ms-wrap'), listEl = $('#ms-list'), threadEl = $('#ms-thread'), navN = $('#nav-msgs-n');
  if (!wrap || !listEl || !threadEl) return;
  var convs = [], filter = 'open', curId = null, msgs = [], photos = [], urlCache = {};
  var tabOpen = false, loaded = false, pending = null, purged = false, busy = false;

  /* ---- pastille de la barre latérale ---- */
  function paintBadge(n) {
    if (!navN) return;
    navN.textContent = n; navN.hidden = !n;
    var tab = navN.closest('.tab');
    if (tab) tab.setAttribute('aria-label', 'Messages' + (n ? ' (' + plural(n, 'non lu', 'non lus') + ')' : ''));
  }
  function refreshBadge() {
    sb.from('conversations').select('id', { count: 'exact', head: true }).gt('admin_unread', 0).then(function (res) {
      if (res && !res.error && typeof res.count === 'number') paintBadge(res.count);
    }, function () {});
  }
  if (CA.onAdminReady) CA.onAdminReady(refreshBadge);
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (tabOpen) { load(); if (curId && !busy) loadThread(false); } else refreshBadge();
  }, 20000);

  /* ---- onglet + route #messages/<id> ---- */
  var prevOnTab = CA.onTab;
  CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    tabOpen = name === 'messages';
    if (!tabOpen) return;
    purge();
    load().then(function () { var r = CA.route && CA.route.get(); open(r && r.tab === 'messages' ? r.sub : null); });
  };
  if (CA.route && CA.route.onSub) CA.route.onSub(function (s, tab) { if (tab === 'messages' && loaded) open(s); });
  function go(id) { if (CA.route && CA.route.goSub) CA.route.goSub(id || ''); else open(id); }

  $$('.ms-filter').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      $$('.ms-filter').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      renderList();
    });
  });
  var refreshBtn = $('#ms-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function () { load(); if (curId) loadThread(false); });

  /* ---- chargement de la liste ---- */
  function load() {
    if (pending) return pending;
    if (!loaded) listEl.innerHTML = '<p class="muted">Chargement…</p>';
    pending = sb.from('conversations').select('*, customers(name, email, phone, client_id)')
      .order('updated_at', { ascending: false }).limit(300)
      .then(function (res) {
        if (res.error) { listEl.innerHTML = '<p class="empty">Impossible de charger les messages.<br>' + esc(res.error.message) + '</p>'; return; }
        convs = res.data || []; loaded = true;
        paintBadge(convs.filter(function (c) { return c.admin_unread > 0; }).length);
        renderList();
      }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau — réessaie.</p>'; })
      .then(function () { pending = null; });
    return pending;
  }
  function renderList() {
    var rows = convs.filter(function (c) { return filter === 'all' || c.status === filter || c.id === curId; });
    if (!rows.length) {
      listEl.innerHTML = '<p class="ms-empty">' + (filter === 'open' ? 'Aucune conversation ouverte.' : filter === 'closed' ? 'Aucune conversation réglée.' : 'Aucun message pour l\'instant.') + '</p>';
      return;
    }
    listEl.innerHTML = rows.map(function (c) {
      var un = +c.admin_unread || 0, name = who(c);
      return '<button type="button" class="ms-row' + (un ? ' is-unread' : '') + (c.id === curId ? ' is-current' : '') + '" data-id="' + esc(c.id) + '">' +
        CA.avatar(name) +
        '<span class="ms-row-tx">' +
          '<span class="ms-row-top"><b>' + esc(name) + '</b><time>' + esc(ago(c.updated_at)) + '</time></span>' +
          '<span class="ms-row-about">' + esc(about(c)) + (c.status === 'closed' ? ' · Réglée' : '') + '</span>' +
          '<span class="ms-row-bot"><span class="ms-row-prev">' + (c.last_from === 'admin' ? 'Toi : ' : '') + esc(c.last_preview || '') + '</span>' +
            (un ? '<span class="nav-count">' + un + '</span>' : '') + '</span>' +
        '</span></button>';
    }).join('');
    $$('.ms-row', listEl).forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-id')); }); });
  }

  /* ---- fil d'une conversation ---- */
  function open(id) {
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      curId = null; wrap.classList.remove('has-conv'); clearPhotos();
      threadEl.innerHTML = '<p class="ms-none">Choisis une conversation.</p>';
      renderList(); return;
    }
    if (id === curId && threadEl.querySelector('.ms-msgs')) return;
    curId = id; msgs = []; clearPhotos();
    wrap.classList.add('has-conv');
    renderList();
    var c = conv();
    if (!c) { threadEl.innerHTML = '<p class="ms-none">Conversation introuvable.</p>'; return; }
    var k = c.customers || {};
    threadEl.innerHTML =
      '<header class="ms-head">' +
        '<button type="button" class="btn btn-ghost btn-sm ms-back" aria-label="Retour à la liste">←</button>' +
        CA.avatar(who(c)) +
        '<div class="ms-head-tx"><h2>' + esc(who(c)) + '</h2>' +
          '<p class="person-meta">' + (k.email ? '<a class="pm pm-mail" href="mailto:' + esc(k.email) + '">' + esc(k.email) + '</a>' : '') +
            (k.phone ? '<a class="pm pm-tel" href="tel:' + esc(String(k.phone).replace(/[^\d+]/g, '')) + '">' + esc(k.phone) + '</a>' : '') + '</p>' +
          '<p class="ms-about">' + esc(about(c)) + (c.page ? ' · <a href="' + esc(c.page) + '" target="_blank" rel="noopener">page</a>' : '') + '</p></div>' +
        '<div class="ms-acts">' +
          '<button type="button" class="btn btn-ghost btn-sm ms-close" data-ic="check">' + (c.status === 'closed' ? 'Rouvrir' : 'Réglée') + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm ms-del" data-ic="trash">Supprimer</button>' +
        '</div>' +
      '</header>' +
      '<div class="ms-msgs" id="ms-msgs"><p class="muted">Chargement…</p></div>' +
      '<form class="ms-reply" id="ms-reply" novalidate>' +
        '<div class="ms-thumbs" hidden></div>' +
        '<div class="ms-reply-row">' +
          '<label class="btn btn-ghost ms-attach" title="Joindre des photos"><input type="file" accept="image/*" multiple hidden aria-label="Joindre des photos">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg></label>' +
          '<textarea id="ms-reply-in" rows="2" maxlength="4000" placeholder="Ta réponse…" aria-label="Réponse"></textarea>' +
          '<button type="submit" class="btn btn-accent ms-send" data-ic="mail">Envoyer</button>' +
        '</div>' +
        '<span class="status" id="ms-status"></span>' +
      '</form>';
    $('.ms-back', threadEl).addEventListener('click', function () { go(''); });
    $('.ms-close', threadEl).addEventListener('click', toggleClosed);
    $('.ms-del', threadEl).addEventListener('click', removeConv);
    var form = $('#ms-reply', threadEl), ta = $('#ms-reply-in', form), inp = $('.ms-attach input', form);
    inp.addEventListener('change', function () { addFiles(inp.files); inp.value = ''; });
    $('.ms-thumbs', form).addEventListener('click', function (e) {
      var b = e.target.closest('.ms-thumb-x'); if (!b) return;
      var p = photos.splice(+b.getAttribute('data-i'), 1)[0];
      if (p) try { URL.revokeObjectURL(p.url); } catch (x) {}
      paintThumbs();
    });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
    loadThread(true);
  }
  function conv() { return convs.filter(function (c) { return c.id === curId; })[0]; }
  function loadThread(scroll) {
    var id = curId; if (!id) return Promise.resolve();
    return sb.from('messages').select('*').eq('conversation_id', id).order('created_at').then(function (res) {
      if (curId !== id) return;
      var box = $('#ms-msgs', threadEl); if (!box) return;
      if (res.error) { box.innerHTML = '<p class="empty">Impossible de charger la conversation.<br>' + esc(res.error.message) + '</p>'; return; }
      var list = res.data || [];
      var same = list.length === msgs.length && (!list.length || list[list.length - 1].id === msgs[msgs.length - 1].id);
      var c = conv();
      if (c && c.admin_unread > 0) markRead(c);
      if (same && !scroll) return;
      msgs = list;
      var paths = []; msgs.forEach(function (m) { (m.photos || []).forEach(function (p) { paths.push(p); }); });
      return signedUrls(paths).then(function () { paintThread(scroll); });
    });
  }
  function markRead(c) {
    c.admin_unread = 0; renderList();
    paintBadge(convs.filter(function (x) { return x.admin_unread > 0; }).length);
    sb.from('conversations').update({ admin_unread: 0 }).eq('id', c.id).then(null, function () {});
  }
  function paintThread(scroll) {
    var box = $('#ms-msgs', threadEl); if (!box) return;
    var near = box.scrollHeight - box.scrollTop - box.clientHeight < 80, last = '', html = '';
    msgs.forEach(function (m) {
      var d = day(m.created_at);
      if (d !== last) { html += '<p class="ms-day">' + esc(d) + '</p>'; last = d; }
      var me = m.sender === 'admin';
      html += '<div class="ms-b ' + (me ? 'me' : 'them') + '">' +
        ((m.photos || []).length ? '<div class="ms-b-photos">' + m.photos.map(function (p, i) {
          var u = urlCache[p];
          return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="Photo ' + (i + 1) + '" loading="lazy"></a>'
                   : '<span class="ms-b-ph" title="Photo indisponible"></span>';
        }).join('') + '</div>' : '') +
        (m.body ? '<p>' + esc(m.body) + '</p>' : '') +
        '<time>' + esc(hour(m.created_at)) + '</time></div>';
    });
    box.innerHTML = html || '<p class="muted">Aucun message.</p>';
    if (scroll || near) box.scrollTop = box.scrollHeight;
  }
  function signedUrls(paths) {
    var need = paths.filter(function (p) { return !urlCache[p]; });
    if (!need.length) return Promise.resolve();
    return sb.storage.from('messages').createSignedUrls(need, 3600).then(function (r) {
      (r.data || []).forEach(function (x) { if (x.signedUrl) urlCache[x.path] = x.signedUrl; });
    }, function () {});
  }

  /* ---- répondre ---- */
  function shrink(file) {
    var load = window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : Promise.reject(new Error('photo'));
    return load.then(function (bmp) {
      var k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      var cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('photo')); }, 'image/jpeg', 0.82); });
    });
  }
  function addFiles(files) {
    var st = $('#ms-status', threadEl);
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
    if (list.length > MAX_PHOTOS - photos.length && st) st.textContent = 'Au plus ' + MAX_PHOTOS + ' photos par message.';
    list = list.slice(0, Math.max(0, MAX_PHOTOS - photos.length));
    photoJob = Promise.all([photoJob].concat(list.map(function (f) {
      return shrink(f).then(function (b) { photos.push({ blob: b, url: URL.createObjectURL(b) }); },
        function () { if (st) st.textContent = 'Format de photo non pris en charge.'; });
    }))).then(paintThumbs);
  }
  var photoJob = Promise.resolve();   // réduction des photos en cours : l'envoi l'attend
  function paintThumbs() {
    var box = $('.ms-thumbs', threadEl); if (!box) return;
    box.innerHTML = photos.map(function (p, i) {
      return '<span class="ms-thumb"><img src="' + esc(p.url) + '" alt=""><button type="button" class="ms-thumb-x" data-i="' + i + '" aria-label="Retirer la photo">×</button></span>';
    }).join('');
    box.hidden = !photos.length;
  }
  function clearPhotos() {
    photos.forEach(function (p) { try { URL.revokeObjectURL(p.url); } catch (e) {} });
    photos = []; paintThumbs();
  }
  function send() {
    var c = conv(); if (!c || busy) return;
    var ta = $('#ms-reply-in', threadEl), btn = $('.ms-send', threadEl), st = $('#ms-status', threadEl);
    busy = true; btn.disabled = true;
    photoJob.then(function () {
      var body = ta.value.trim();
      if (!body && !photos.length) { busy = false; btn.disabled = false; ta.focus(); return; }
      st.textContent = 'Envoi…';
      return sendNow(c, body, ta, btn, st);
    });
  }
  function sendNow(c, body, ta, btn, st) {
    return Promise.all(photos.map(function (p) {
      var path = c.customer_id + '/' + uuid() + '.jpg';
      return sb.storage.from('messages').upload(path, p.blob, { contentType: 'image/jpeg', upsert: false }).then(function (r) {
        if (r.error) throw new Error('Photo non envoyée : ' + r.error.message);
        return path;
      });
    })).then(function (paths) {
      return sb.from('messages').insert({ conversation_id: c.id, sender: 'admin', body: body, photos: paths }).select('id').single();
    }).then(function (res) {
      if (res.error) throw new Error(res.error.message);
      busy = false; btn.disabled = false; ta.value = ''; clearPhotos();
      return sb.functions.invoke('message-notify', { body: { message_id: res.data.id } }).then(function (r) {
        var d = (r && r.data) || {};
        st.textContent = d.result === 'sent' ? 'Envoyé · client avisé par courriel' : 'Envoyé';
      }, function () { st.textContent = 'Envoyé · avis courriel non parti'; });
    }).then(function () {
      return load().then(function () { return loadThread(true); });
    }).catch(function (err) {
      busy = false; btn.disabled = false;
      st.textContent = 'Erreur : ' + ((err && err.message) || err);
    });
  }

  /* ---- réglée / rouvrir, supprimer ---- */
  function toggleClosed() {
    var c = conv(); if (!c) return;
    var next = c.status === 'closed' ? 'open' : 'closed';
    sb.from('conversations').update({ status: next }).eq('id', c.id).then(function (res) {
      if (res.error) { caDialog.error(res.error); return; }
      c.status = next;
      var b = $('.ms-close', threadEl); if (b) b.textContent = next === 'closed' ? 'Rouvrir' : 'Réglée';
      renderList();
    });
  }
  function photosOf(list) {
    var out = []; (list || []).forEach(function (m) { (m.photos || []).forEach(function (p) { out.push(p); }); }); return out;
  }
  function removeConv() {
    var c = conv(); if (!c) return;
    caDialog.confirm({ title: 'Supprimer la conversation avec ' + who(c) + ' ?', message: 'Messages et photos effacés. Action définitive.',
      ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
      if (!ok) return;
      erase([c.id], photosOf(msgs)).then(function (err) {
        if (err) { caDialog.error(err); return; }
        convs = convs.filter(function (x) { return x.id !== c.id; });
        go('');
      });
    });
  }
  // photos par l'API Storage (jamais par SQL), puis les lignes
  function erase(ids, paths) {
    var rm = paths.length ? sb.storage.from('messages').remove(paths).then(null, function () {}) : Promise.resolve();
    return rm.then(function () { return sb.from('conversations').delete().in('id', ids); })
      .then(function (res) { return res && res.error ? res.error.message : null; });
  }
  // Loi 25 : 12 mois sans message -> effacée (une fois par session admin)
  function purge() {
    if (purged) return; purged = true;
    var cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
    sb.from('conversations').select('id, messages(photos)').lt('updated_at', cutoff).limit(200).then(function (res) {
      var rows = (!res.error && res.data) || [];
      if (!rows.length) return;
      var paths = []; rows.forEach(function (r) { paths = paths.concat(photosOf(r.messages)); });
      return erase(rows.map(function (r) { return r.id; }), paths).then(function () { load(); });
    }, function () {});
  }
})();
