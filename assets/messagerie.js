/* =========================================================
   Création Audio — Messagerie (panneau « Écris-nous » du site public)
   Chargé au premier clic sur un lien [data-msg] par nav.js (CA.loadMsg) :
   panneau qui glisse à droite (plein écran sur mobile).
   - Pas connecté : sujet + message + photos + nom + courriel -> code à 6
     chiffres (Edge Function compte-code, purpose 'message') -> session du compte
     client (clé « ca-compte-auth », la même que compte.html) -> envoi.
     Le brouillon (photos comprises) survit au passage par l'appli courriel.
   - Connecté : envoi direct ; liste de ses conversations ; fil + réponse.
   - Photos : 4 max, réduites à 1600 px (JPEG) dans le navigateur, téléversées
     dans le bucket privé « messages » (<uid>/<uuid>.jpg), lues par URL signée.
   - Après chaque envoi : Edge Function message-notify (avis courriel à l'admin).
   - Fil ouvert : actualisé toutes les 10 s (page visible).
   API : CA.msg.open({ topic, ref, body, conv, list }) · CA.msg.close()
   Événement « ca:msg-change » sur document après un envoi (compte.html s'y abonne).
   Démo : CA.compte (faux client Supabase) / CA.compteFn (fausse Edge Function).
   RPC : msg_start, msg_send, me_conversations, me_messages, me_account, me_update
   (schema-v2.sql « MESSAGERIE »).
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA = window.CA || {};
  if (CA.msg) return;

  var KEY = 'ca-compte-auth', PENDING = 'ca_msg_pending', DRAFT = 'ca_msg_draft';
  var FB = 'https://m.me/61591945465745', EMAIL = 'contact@creationaudio.ca';
  var CODE_TTL = 10 * 60 * 1000, RESEND_MS = 60 * 1000, POLL_MS = 10000;
  var MAX_PHOTOS = 4, MAX_SIDE = 1600;
  var TOPICS = [['filaments', 'Filaments'], ['spacers', 'Spacers'], ['compte', 'Mon compte'], ['autre', 'Autre']];
  var TOPIC_NAME = {}; TOPICS.forEach(function (t) { TOPIC_NAME[t[0]] = t[1]; });
  var HINT = {
    filaments: 'Couleur, matériau, quantité…',
    spacers: 'Véhicule (marque, modèle, année), taille du haut-parleur…',
    compte: 'Ta question sur ton compte…',
    autre: 'Ta question…'
  };
  var ROOT = CA.siteRoot || '';

  /* ---------- outils ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function day(iso) {
    var d = new Date(iso), t = new Date();
    if (d.toDateString() === t.toDateString()) return 'Aujourd\'hui';
    var y = new Date(t); y.setDate(t.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Hier';
    return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  }
  function hour(iso) { return new Date(iso).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }); }
  function shortDate(iso) {
    var d = new Date(iso);
    return d.toDateString() === new Date().toDateString() ? hour(iso) : d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
  }
  function about(c) { return (TOPIC_NAME[c.topic] || 'Question') + (c.ref ? ' · ' + c.ref : ''); }
  function guessTopic() {
    var p = location.pathname;
    if (/spacer/i.test(p)) return 'spacers';
    if (/boutique/i.test(p)) return 'filaments';
    if (/compte/i.test(p)) return 'compte';
    return '';
  }
  function isAuthError(err) {
    var c = String((err && (err.code || err.status)) || '');
    return /^(401|403|PGRST301|42501)$/.test(c) || /jwt|token/i.test((err && err.message) || '');
  }
  function errText(err) { return (err && err.message) || 'Envoi impossible pour le moment. Réessaie.'; }

  /* ---------- Supabase (session du compte client, partagée avec compte.html / commande-client.js) ---------- */
  function sb() {
    if (CA.compteSb) return CA.compteSb;
    if (CA.compte) return (CA.compteSb = CA.compte);        // démo
    var cfg = window.CA_SUPABASE || {};
    if (window.supabase && window.supabase.createClient && cfg.url) {
      CA.compteSb = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { storageKey: KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
    return CA.compteSb || null;
  }
  function callFn(body) {
    if (CA.compteFn) return CA.compteFn(body);
    var cfg = window.CA_SUPABASE || {};
    return fetch(cfg.url + '/functions/v1/compte-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { b = b || {}; b._status = r.status; return b; });
    });
  }
  function rpc(name, args) {
    var c = sb();
    if (!c) return Promise.reject(new Error('Service indisponible pour le moment.'));
    return c.rpc(name, args || {}).then(function (res) {
      if (res.error) { var e = new Error(res.error.message || 'Erreur'); e.code = res.error.code; throw e; }
      return res.data;
    });
  }
  function notify(messageId) {
    var c = sb();
    if (c && c.functions && messageId) c.functions.invoke('message-notify', { body: { message_id: messageId } }).then(null, function () {});
  }
  function markSignedIn(on) { $$('.home-account').forEach(function (a) { a.classList.toggle('is-in', !!on); }); }

  /* ---------- état ---------- */
  var st = { view: null, signed: false, uid: '', acct: null, convs: [], conv: null, msgs: [], ctx: {}, photos: [], busy: false };
  var urlCache = {}, pollT = null, resendT = null, opener = null;

  /* ---------- photos : réduction + vignettes ---------- */
  function shrink(file) {
    var load = window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : new Promise(function (res, rej) {
          var img = new Image(); img.onload = function () { res(img); }; img.onerror = rej; img.src = URL.createObjectURL(file);
        });
    return load.then(function (bmp) {
      var w = bmp.width, h = bmp.height, k = Math.min(1, MAX_SIDE / Math.max(w, h));
      var cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
      var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('photo')); }, 'image/jpeg', 0.82); });
    });
  }
  function addFiles(files, statusEl) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name); });
    var room = MAX_PHOTOS - st.photos.length;
    if (list.length > room) say(statusEl, 'Au plus ' + MAX_PHOTOS + ' photos par message.', 'bad');
    list = list.slice(0, Math.max(0, room));
    if (!list.length) return photoJob;
    photoJob = Promise.all([photoJob].concat(list.map(function (f) {
      return shrink(f).then(function (b) { st.photos.push({ blob: b, url: URL.createObjectURL(b) }); },
        function () { say(statusEl, 'Format de photo non pris en charge : envoie une photo JPEG ou PNG.', 'bad'); });
    }))).then(function () { paintThumbs(); });
    return photoJob;
  }
  var photoJob = Promise.resolve();   // réduction des photos en cours : tout envoi l'attend
  function paintThumbs() {
    if (!panel) return;
    $$('.msg-thumbs', panel).forEach(function (box) {
      box.innerHTML = st.photos.map(function (p, i) {
        return '<span class="msg-thumb"><img src="' + esc(p.url) + '" alt=""><button type="button" class="msg-thumb-x" data-i="' + i +
          '" aria-label="Retirer la photo ' + (i + 1) + '">×</button></span>';
      }).join('');
      box.hidden = !st.photos.length;
    });
    $$('.msg-attach', panel).forEach(function (l) { l.classList.toggle('is-full', st.photos.length >= MAX_PHOTOS); });
  }
  function clearPhotos() {
    st.photos.forEach(function (p) { try { URL.revokeObjectURL(p.url); } catch (e) {} });
    st.photos = []; paintThumbs();
  }
  function upload() {
    var c = sb();
    if (!st.photos.length) return Promise.resolve([]);
    return Promise.all(st.photos.map(function (p) {
      var path = st.uid + '/' + uuid() + '.jpg';
      return c.storage.from('messages').upload(path, p.blob, { contentType: 'image/jpeg', upsert: false }).then(function (r) {
        if (r.error) throw new Error('Une photo n\'a pas pu être envoyée. Réessaie.');
        return path;
      });
    }));
  }
  function signedUrls(paths) {
    var c = sb(), need = paths.filter(function (p) { return !urlCache[p]; });
    if (!need.length || !c || !c.storage) return Promise.resolve();
    return c.storage.from('messages').createSignedUrls(need, 3600).then(function (r) {
      (r.data || []).forEach(function (x) { if (x.signedUrl) urlCache[x.path] = x.signedUrl; });
    }, function () {});
  }

  /* ---------- brouillon en attente du code (survit au rechargement) ---------- */
  function getPending() {
    try {
      var p = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
      return p && p.email && Date.now() - p.at < CODE_TTL ? p : null;
    } catch (e) { return null; }
  }
  function setPending(p) {
    try { if (p) sessionStorage.setItem(PENDING, JSON.stringify(p)); else sessionStorage.removeItem(PENDING); } catch (e) {
      if (p) { p.shots = []; try { sessionStorage.setItem(PENDING, JSON.stringify(p)); } catch (x) {} }   // trop lourd : sans les photos
    }
  }
  function blobToData(b) {
    return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(b); });
  }
  function restoreShots(shots) {
    return Promise.all((shots || []).map(function (d) {
      return fetch(d).then(function (r) { return r.blob(); }).then(function (b) { st.photos.push({ blob: b, url: URL.createObjectURL(b) }); }, function () {});
    }));
  }
  // texte du message en cours : rien n'est perdu en fermant le panneau
  function saveDraft() {
    var ta = panel && $('#msg-body', panel); if (!ta || st.view !== 'compose') return;
    try { sessionStorage.setItem(DRAFT, JSON.stringify({ body: ta.value, topic: currentTopic(), ref: st.ctx.ref || '' })); } catch (e) {}
  }
  function readDraft() { try { return JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); } catch (e) { return null; } }
  function clearDraft() { try { sessionStorage.removeItem(DRAFT); } catch (e) {} }

  /* ---------- panneau ---------- */
  var panel = null, backdrop = null, main = null, titleEl = null, subEl = null, backBtn = null, altEl = null;
  function build() {
    if (panel) return;
    backdrop = document.createElement('div'); backdrop.className = 'msg-backdrop'; backdrop.hidden = true;
    panel = document.createElement('aside');
    panel.className = 'msg-panel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'msg-title');
    panel.innerHTML =
      '<header class="msg-head">' +
        '<button class="msg-ic msg-back" type="button" aria-label="Retour" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
        '<div class="msg-head-tx"><h2 id="msg-title">Écris-nous</h2><p class="msg-sub" id="msg-sub"></p></div>' +
        '<button class="msg-ic msg-x" type="button" aria-label="Fermer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</header>' +
      '<div class="msg-main" id="msg-main"></div>' +
      '<p class="msg-alt">Tu préfères&nbsp;? <a href="' + FB + '" target="_blank" rel="noopener">Messenger</a> · ' +
        '<a href="mailto:' + EMAIL + '">Courriel</a></p>';
    document.body.appendChild(backdrop); document.body.appendChild(panel);
    main = $('#msg-main', panel); titleEl = $('#msg-title', panel); subEl = $('#msg-sub', panel);
    backBtn = $('.msg-back', panel); altEl = $('.msg-alt', panel);
    $('.msg-x', panel).addEventListener('click', close);
    backdrop.addEventListener('click', close);
    backBtn.addEventListener('click', function () { if (st.view === 'thread') loadConvs().then(showList); else showList(); });
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;                          // focus gardé dans le panneau
      var f = $$('button:not([disabled]), a[href], input:not(.msg-hp):not([type="file"]), textarea', panel)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && st.view === 'thread') poll(); });
  }
  function head(title, sub, back) {
    titleEl.textContent = title; subEl.textContent = sub || ''; subEl.hidden = !sub;
    backBtn.hidden = !back;
  }
  function say(el, text, cls) { if (!el) return; el.textContent = text || ''; el.className = 'msg-status' + (cls ? ' ' + cls : ''); }
  function focusFirst(sel) {
    setTimeout(function () { var el = $(sel, panel); if (el) try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }, 60);
  }

  function open(opts) {
    opts = opts || {};
    build();
    opener = document.activeElement;
    var draft = readDraft();
    var sameRef = draft && (opts.ref == null || draft.ref === opts.ref);
    st.ctx = {
      topic: opts.topic || (sameRef && draft.topic) || guessTopic(),
      ref: opts.ref != null ? opts.ref : (draft && draft.ref) || '',
      body: opts.body || (sameRef && draft.body) || ''
    };
    panel.hidden = false; backdrop.hidden = false;
    document.documentElement.classList.add('msg-open');
    void panel.offsetWidth;                                   // reflow : la transition part de translateX(100%)
    panel.classList.add('is-open'); backdrop.classList.add('is-open');
    main.innerHTML = '<p class="msg-empty">Chargement…</p>'; head('Écris-nous', '', false);

    var p = getPending();
    if (p) { restorePending(p); return; }
    session().then(function (on) {
      if (!on) { showCompose(); return; }
      return loadConvs().then(function () {
        if (opts.conv) { showThread(opts.conv); return; }
        if (opts.list || (!opts.topic && !opts.ref && st.convs.length)) showList(); else showCompose();
      });
    }).catch(function () { showCompose(); });
  }
  function close() {
    if (!panel || panel.hidden) return;
    saveDraft();
    stopPoll(); clearTimeout(resendT);
    panel.classList.remove('is-open'); backdrop.classList.remove('is-open');
    document.documentElement.classList.remove('msg-open');
    setTimeout(function () { if (!panel.classList.contains('is-open')) { panel.hidden = true; backdrop.hidden = true; } }, 240);
    if (opener && opener.focus) try { opener.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- session ---------- */
  function session() {
    var c = sb();
    if (!c) return Promise.resolve(false);
    return c.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s) { st.signed = false; return false; }
      st.uid = (s.user && s.user.id) || st.uid || 'demo';
      return rpc('me_account').then(function (a) {
        st.acct = a || {}; st.signed = true; markSignedIn(true); return true;
      }, function (err) {
        if (isAuthError(err)) return c.auth.signOut().then(function () { st.signed = false; markSignedIn(false); return false; });
        throw err;
      });
    });
  }
  function loadConvs() {
    return rpc('me_conversations').then(function (d) { st.convs = d || []; }, function () { st.convs = []; });
  }
  function lostSession() {
    var c = sb();
    return (c ? c.auth.signOut() : Promise.resolve()).catch(function () {}).then(function () {
      st.signed = false; markSignedIn(false);
      showCompose();
      say($('.msg-status', main), 'Ta session a expiré : confirme ton courriel pour envoyer.', 'bad');
    });
  }

  /* ---------- vue : nouveau message ---------- */
  function currentTopic() { var r = panel && $('input[name="msg-topic"]:checked', panel); return r ? r.value : (st.ctx.topic || ''); }
  function showCompose() {
    st.view = 'compose'; stopPoll(); clearTimeout(resendT);
    head('Écris-nous', st.signed ? (st.acct && st.acct.email) || '' : 'On répond ici et par courriel', st.signed && st.convs.length > 0);
    altEl.hidden = false;
    var needName = !st.signed || !String((st.acct && st.acct.name) || '').trim();
    var unread = st.convs.reduce(function (s, c) { return s + (+c.unread || 0); }, 0);
    main.innerHTML =
      '<form class="msg-form" id="msg-compose" novalidate>' +
        (st.signed && st.convs.length ? '<button type="button" class="msg-convs"><span>Mes conversations</span><b>' + st.convs.length + '</b>' +
          (unread ? '<span class="msg-dot" title="' + plural(unread, 'réponse non lue', 'réponses non lues') + '"></span>' : '') + '</button>' : '') +
        '<fieldset class="msg-topics"><legend>Sujet</legend><div class="msg-chips">' + TOPICS.map(function (t) {
          return '<label class="msg-chip"><input type="radio" name="msg-topic" value="' + t[0] + '"' + (st.ctx.topic === t[0] ? ' checked' : '') +
            '><span>' + t[1] + '</span></label>';
        }).join('') + '</div></fieldset>' +
        (st.ctx.ref ? '<p class="msg-ref"><span>À propos de <b>' + esc(st.ctx.ref) + '</b></span>' +
          '<button type="button" class="msg-ref-x" aria-label="Retirer ' + esc(st.ctx.ref) + '">×</button></p>' : '') +
        '<div class="msg-field"><label for="msg-body">Message</label>' +
          '<textarea id="msg-body" rows="5" maxlength="4000" placeholder="' + esc(HINT[st.ctx.topic] || HINT.autre) + '">' + esc(st.ctx.body) + '</textarea></div>' +
        '<div class="msg-photos"><div class="msg-thumbs" hidden></div>' +
          '<label class="msg-attach"><input type="file" accept="image/*" multiple hidden>' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>' +
            '<span>Ajouter des photos</span></label></div>' +
        (needName ? '<div class="msg-grid' + (st.signed ? ' one' : '') + '">' +
          '<div class="msg-field"><label for="msg-name">Nom</label><input type="text" id="msg-name" autocomplete="name" maxlength="80"></div>' +
          (st.signed ? '' : '<div class="msg-field"><label for="msg-email">Courriel</label><input type="email" id="msg-email" inputmode="email" ' +
            'autocomplete="email" maxlength="254" spellcheck="false" placeholder="ton@courriel.com"></div>') +
        '</div>' : '') +
        '<input type="text" class="msg-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<button class="msg-send" type="submit">Envoyer</button>' +
        '<p class="msg-status" role="status" aria-live="polite"></p>' +
        (st.signed ? '' : '<p class="msg-legal">Un code te sera envoyé pour confirmer ton courriel. <a href="' + ROOT + 'confidentialite.html#messagerie">Confidentialité</a></p>') +
      '</form>';
    var form = $('#msg-compose', main), ta = $('#msg-body', main), status = $('.msg-status', form);
    paintThumbs();
    $$('input[name="msg-topic"]', form).forEach(function (r) {
      r.addEventListener('change', function () { st.ctx.topic = r.value; ta.placeholder = HINT[r.value] || HINT.autre; saveDraft(); });
    });
    var rx = $('.msg-ref-x', form);
    if (rx) rx.addEventListener('click', function () { st.ctx.ref = ''; rx.parentNode.remove(); saveDraft(); });
    var cv = $('.msg-convs', form); if (cv) cv.addEventListener('click', showList);
    ta.addEventListener('input', function () { st.ctx.body = ta.value; saveDraft(); });
    wirePhotos(form, status);
    form.addEventListener('submit', function (e) { e.preventDefault(); photoJob.then(function () { submitCompose(form, status); }); });
    focusFirst(st.ctx.topic ? '#msg-body' : 'input[name="msg-topic"]');
  }
  function wirePhotos(scope, status) {
    var inp = $('.msg-attach input', scope);
    inp.addEventListener('change', function () { addFiles(inp.files, status); inp.value = ''; });
    $('.msg-thumbs', scope).addEventListener('click', function (e) {
      var b = e.target.closest('.msg-thumb-x'); if (!b) return;
      var p = st.photos.splice(+b.getAttribute('data-i'), 1)[0];
      if (p) try { URL.revokeObjectURL(p.url); } catch (x) {}
      paintThumbs();
    });
  }
  function submitCompose(form, status) {
    if (st.busy) return;
    var topic = currentTopic(), body = $('#msg-body', form).value.trim();
    var nameIn = $('#msg-name', form), emailIn = $('#msg-email', form);
    var name = nameIn ? nameIn.value.trim() : '', email = emailIn ? emailIn.value.trim().toLowerCase() : '';
    if (!topic) { say(status, 'Choisis un sujet.', 'bad'); var r = $('input[name="msg-topic"]', form); if (r) r.focus(); return; }
    if (!body && !st.photos.length) { say(status, 'Écris ton message.', 'bad'); $('#msg-body', form).focus(); return; }
    if (nameIn && !name) { say(status, 'Entre ton nom.', 'bad'); nameIn.focus(); return; }
    if (emailIn && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { say(status, 'Entre un courriel valide.', 'bad'); emailIn.focus(); return; }
    var draft = { topic: topic, ref: st.ctx.ref || '', body: body, name: name };
    var btn = $('.msg-send', form);
    if (st.signed) { sendNew(draft, status, btn); return; }
    // pas connecté : code par courriel, puis envoi
    btn.disabled = true; st.busy = true; say(status, 'Envoi du code…');
    callFn({ action: 'send', email: email, hp: ($('.msg-hp', form) || {}).value || '', purpose: 'message' }).then(function (b) {
      btn.disabled = false; st.busy = false;
      if (!b.ok) { say(status, sendErr(b), 'bad'); return; }
      return Promise.all(st.photos.map(function (p) { return blobToData(p.blob); })).then(function (shots) {
        draft.email = email; draft.at = Date.now(); draft.sent = Date.now(); draft.shots = shots.filter(Boolean);
        setPending(draft);
        showCode(draft);
      });
    }, function () { btn.disabled = false; st.busy = false; say(status, 'Erreur réseau — réessaie.', 'bad'); });
  }
  function sendErr(b) {
    if (b.error === 'wait') {
      var s = Math.max(1, +b.retry_after || 60);
      return s > 90 ? 'Trop de demandes. Réessaie dans ' + plural(Math.ceil(s / 60), 'minute', 'minutes') + '.' : 'Patiente ' + s + ' s avant de redemander un code.';
    }
    if (b.error === 'reserved') return 'Ce courriel a sa propre page de connexion.';
    if (b.error === 'bad_request') return 'Entre un courriel valide.';
    if (b.error === 'mail') return 'Envoi impossible pour le moment. Réessaie dans un instant.';
    return 'Service indisponible. Réessaie plus tard.';
  }
  function sendNew(d, status, btn) {
    st.busy = true; if (btn) btn.disabled = true; say(status, 'Envoi…');
    var nameStep = d.name && !String((st.acct && st.acct.name) || '').trim()
      ? rpc('me_update', { p_name: d.name, p_phone: (st.acct && st.acct.phone) || '' }).then(function (a) { st.acct = a || st.acct; })
      : Promise.resolve();
    return nameStep.then(upload).then(function (paths) {
      return rpc('msg_start', { p_topic: d.topic, p_ref: d.ref || null, p_page: location.pathname, p_body: d.body, p_photos: paths });
    }).then(function (r) {
      st.busy = false; if (btn) btn.disabled = false;
      notify(r.message_id);
      clearPhotos(); clearDraft(); st.ctx = { topic: '', ref: '', body: '' };
      changed();
      return loadConvs().then(function () { showThread(r.conversation_id, 'Envoyé. On te répond ici et par courriel.'); });
    }).catch(function (err) {
      st.busy = false; if (btn) btn.disabled = false;
      if (isAuthError(err)) return lostSession();
      say(status, errText(err), 'bad');
    });
  }
  function changed() { try { document.dispatchEvent(new CustomEvent('ca:msg-change')); } catch (e) {} }

  /* ---------- vue : code reçu par courriel ---------- */
  function restorePending(p) {
    st.ctx = { topic: p.topic, ref: p.ref, body: p.body };
    clearPhotos();
    restoreShots(p.shots).then(function () { showCode(p); });
  }
  function showCode(p) {
    st.view = 'code'; stopPoll();
    head('Confirme ton courriel', '', false);
    altEl.hidden = false;
    main.innerHTML =
      '<form class="msg-form" id="msg-code" novalidate>' +
        '<p class="msg-lead">Code envoyé à <b>' + esc(p.email) + '</b>. Ton message part dès que c\'est confirmé.</p>' +
        '<div class="msg-field"><label for="msg-code-in">Code à 6 chiffres</label>' +
          '<input type="text" id="msg-code-in" class="msg-code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="6" spellcheck="false"></div>' +
        '<button class="msg-send" type="submit">Confirmer et envoyer</button>' +
        '<p class="msg-status" role="status" aria-live="polite"></p>' +
        '<div class="msg-links"><button type="button" class="msg-link" data-act="resend">Renvoyer le code</button>' +
          '<button type="button" class="msg-link" data-act="edit">Modifier le message</button></div>' +
      '</form>';
    var form = $('#msg-code', main), inp = $('#msg-code-in', form), btn = $('.msg-send', form), status = $('.msg-status', form);
    var resend = $('[data-act="resend"]', form);
    function tick() {
      clearTimeout(resendT);
      var cur = getPending(); if (!cur) return;
      var left = Math.ceil((cur.sent + RESEND_MS - Date.now()) / 1000);
      resend.disabled = left > 0;
      resend.textContent = left > 0 ? 'Renvoyer dans ' + left + ' s' : 'Renvoyer le code';
      if (left > 0) resendT = setTimeout(tick, 1000);
    }
    tick();
    resend.addEventListener('click', function () {
      var cur = getPending(); if (!cur) { backToCompose(); return; }
      resend.disabled = true; say(status, 'Envoi…');
      callFn({ action: 'send', email: cur.email, hp: '', purpose: 'message' }).then(function (b) {
        if (!b.ok) { say(status, sendErr(b), 'bad'); tick(); return; }
        cur.sent = Date.now(); cur.at = Date.now(); setPending(cur);
        say(status, 'Nouveau code envoyé.', 'ok'); inp.value = ''; inp.focus(); tick();
      }, function () { say(status, 'Erreur réseau — réessaie.', 'bad'); tick(); });
    });
    $('[data-act="edit"]', form).addEventListener('click', function () { backToCompose(); });
    inp.addEventListener('input', function () {
      var v = inp.value.replace(/\D/g, '').slice(0, 6);
      if (v !== inp.value) inp.value = v;
      if (v.length === 6 && !btn.disabled) verify();
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); verify(); });
    function verify() {
      var cur = getPending(); if (!cur) { backToCompose('Ce code a expiré : renvoie ton message.'); return; }
      var code = inp.value.replace(/\D/g, '');
      if (code.length !== 6) { say(status, 'Entre les 6 chiffres reçus.', 'bad'); inp.focus(); return; }
      btn.disabled = true; say(status, 'Vérification…');
      callFn({ action: 'verify', email: cur.email, code: code }).then(function (b) {
        if (b.session) {
          return sb().auth.setSession(b.session).then(function (s) {
            if (s && s.error) throw s.error;
            setPending(null); clearTimeout(resendT);
            return session().then(function (on) {
              if (!on) throw new Error('Connexion impossible pour le moment. Réessaie.');
              return sendNew(cur, status, btn);
            });
          });
        }
        btn.disabled = false;
        if (b.error === 'invalid') { say(status, 'Code incorrect · ' + plural(b.left, 'essai restant', 'essais restants') + '.', 'bad'); inp.select(); return; }
        if (b.error === 'expired') { say(status, 'Ce code n\'est plus valable. Demande un nouveau code.', 'bad'); return; }
        if (b.error === 'revoked') { say(status, 'Accès retiré. Écris-nous à ' + EMAIL + '.', 'bad'); return; }
        say(status, 'Vérification impossible pour le moment. Réessaie.', 'bad');
      }).catch(function (err) { btn.disabled = false; say(status, errText(err), 'bad'); });
    }
    focusFirst('#msg-code-in');
  }
  function backToCompose(msg) {
    var p = getPending();
    if (p) st.ctx = { topic: p.topic, ref: p.ref, body: p.body };
    setPending(null); clearTimeout(resendT);
    showCompose();
    if (p) { var n = $('#msg-name', main), e = $('#msg-email', main); if (n) n.value = p.name || ''; if (e) e.value = p.email || ''; }
    if (msg) say($('.msg-status', main), msg, 'bad');
  }

  /* ---------- vue : mes conversations ---------- */
  function showList() {
    st.view = 'list'; stopPoll();
    head('Mes conversations', (st.acct && st.acct.email) || '', false);
    altEl.hidden = false;
    main.innerHTML = '<div class="msg-list-wrap"><button type="button" class="msg-send msg-new">Nouveau message</button>' +
      (st.convs.length ? '<ul class="msg-list">' + st.convs.map(function (c) {
        var un = +c.unread || 0;
        return '<li><button type="button" class="msg-row' + (un ? ' is-unread' : '') + '" data-id="' + esc(c.id) + '">' +
          '<span class="msg-row-top"><b>' + esc(about(c)) + '</b><time>' + esc(shortDate(c.updated_at)) + '</time></span>' +
          '<span class="msg-row-bot"><span class="msg-row-prev">' + (c.last_from === 'client' ? 'Toi : ' : '') + esc(c.last_preview || '') + '</span>' +
          (un ? '<span class="msg-row-n" title="' + plural(un, 'réponse non lue', 'réponses non lues') + '">' + un + '</span>' : '') +
          (c.status === 'closed' && !un ? '<span class="msg-row-st">Réglée</span>' : '') + '</span>' +
        '</button></li>';
      }).join('') + '</ul>' : '<p class="msg-empty">Aucune conversation pour l\'instant.</p>') + '</div>';
    $('.msg-new', main).addEventListener('click', function () { st.ctx = { topic: guessTopic(), ref: '', body: '' }; showCompose(); });
    $$('.msg-row', main).forEach(function (b) { b.addEventListener('click', function () { showThread(b.getAttribute('data-id')); }); });
    focusFirst('.msg-new');
  }

  /* ---------- vue : fil d'une conversation ---------- */
  function showThread(id, notice) {
    st.view = 'thread'; st.conv = { id: id }; st.msgs = [];
    var c0 = st.convs.filter(function (c) { return c.id === id; })[0];
    head(c0 ? about(c0) : 'Conversation', 'Avec Création Audio', true);
    altEl.hidden = true;
    clearPhotos();
    main.innerHTML =
      '<div class="msg-thread" id="msg-thread"><p class="msg-empty">Chargement…</p></div>' +
      '<form class="msg-reply" id="msg-reply" novalidate>' +
        '<div class="msg-thumbs" hidden></div>' +
        '<div class="msg-reply-row">' +
          '<label class="msg-attach msg-attach-ic" title="Ajouter des photos"><input type="file" accept="image/*" multiple hidden aria-label="Ajouter des photos">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg></label>' +
          '<textarea id="msg-reply-in" rows="1" maxlength="4000" placeholder="Ta réponse…" aria-label="Ta réponse"></textarea>' +
          '<button class="msg-send-ic" type="submit" aria-label="Envoyer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg></button>' +
        '</div>' +
        '<p class="msg-status' + (notice ? ' ok' : '') + '" role="status" aria-live="polite">' + esc(notice || '') + '</p>' +
      '</form>';
    var form = $('#msg-reply', main), ta = $('#msg-reply-in', form), status = $('.msg-status', form);
    wirePhotos(form, status);
    ta.addEventListener('input', function () { grow(ta); });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); photoJob.then(reply); } });
    form.addEventListener('submit', function (e) { e.preventDefault(); photoJob.then(reply); });
    function reply() {
      if (st.busy || st.view !== 'thread') return;
      var body = ta.value.trim(), btn = $('.msg-send-ic', form);
      if (!body && !st.photos.length) { ta.focus(); return; }
      st.busy = true; btn.disabled = true; say(status, 'Envoi…');
      upload().then(function (paths) {
        return rpc('msg_send', { p_conv: id, p_body: body, p_photos: paths });
      }).then(function (r) {
        st.busy = false; btn.disabled = false; say(status, '');
        notify(r.message_id); changed();
        ta.value = ''; grow(ta); clearPhotos();
        return refresh(true);
      }).catch(function (err) {
        st.busy = false; btn.disabled = false;
        if (isAuthError(err)) return lostSession();
        say(status, errText(err), 'bad');
      });
    }
    refresh(true).then(function () { focusFirst('#msg-reply-in'); });
    startPoll();
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
  function refresh(scroll) {
    var id = st.conv && st.conv.id; if (!id) return Promise.resolve();
    return rpc('me_messages', { p_conv: id }).then(function (d) {
      if (!st.conv || st.conv.id !== id || st.view !== 'thread') return;
      var msgs = (d && d.messages) || [], conv = (d && d.conversation) || {};
      var hadUnread = st.convs.some(function (c) { return c.id === id && c.unread; });
      st.convs.forEach(function (c) { if (c.id === id) c.unread = 0; });
      if (hadUnread) changed();
      head(about(conv), 'Avec Création Audio', true);
      var same = msgs.length === st.msgs.length && (!msgs.length || msgs[msgs.length - 1].id === st.msgs[st.msgs.length - 1].id);
      if (same && !scroll) return;
      st.msgs = msgs;
      var paths = []; msgs.forEach(function (m) { (m.photos || []).forEach(function (p) { paths.push(p); }); });
      return signedUrls(paths).then(function () { paintThread(scroll, conv); });
    }, function (err) {
      if (isAuthError(err)) return lostSession();
      var box = $('#msg-thread', main);
      if (box && !st.msgs.length) box.innerHTML = '<p class="msg-empty">Impossible de charger la conversation. Réessaie.</p>';
    });
  }
  function paintThread(scroll, conv) {
    var box = $('#msg-thread', main); if (!box) return;
    var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    var lastDay = '', html = '';
    st.msgs.forEach(function (m) {
      var d = day(m.created_at);
      if (d !== lastDay) { html += '<p class="msg-day">' + esc(d) + '</p>'; lastDay = d; }
      var me = m.sender === 'client';
      html += '<div class="msg-b ' + (me ? 'me' : 'them') + '">' +
        ((m.photos || []).length ? '<div class="msg-b-photos">' + m.photos.map(function (p, i) {
          var u = urlCache[p];
          return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="Photo ' + (i + 1) + '" loading="lazy"></a>'
                   : '<span class="msg-b-ph" title="Photo indisponible"></span>';
        }).join('') + '</div>' : '') +
        (m.body ? '<p>' + esc(m.body) + '</p>' : '') +
        '<time>' + (me ? '' : 'Création Audio · ') + esc(hour(m.created_at)) + '</time></div>';
    });
    if (conv && conv.status === 'closed') html += '<p class="msg-day">Conversation réglée · écris pour la rouvrir</p>';
    box.innerHTML = html || '<p class="msg-empty">Aucun message.</p>';
    if (scroll || nearBottom) box.scrollTop = box.scrollHeight;
  }
  function poll() { if (st.view === 'thread' && !st.busy) refresh(false); }
  function startPoll() { stopPoll(); pollT = setInterval(function () { if (document.visibilityState === 'visible') poll(); }, POLL_MS); }
  function stopPoll() { clearInterval(pollT); pollT = null; }

  CA.msg = { open: open, close: close };
})();
