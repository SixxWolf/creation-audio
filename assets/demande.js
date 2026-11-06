/* =========================================================
   Création Audio — envoi d'une demande de service (Impression 3D, Entretien).
   Partagé par impression.js et entretien.js. Charger APRÈS dialog.js et panier-compte.js.
   CA.demande.init({ kind, form, status, onBusy(on), onReset(), onRestore(draft, files) })
   CA.demande.submit({ details, files:[File] })
     - sans session : fenêtre centrée du panier (courriel -> code -> nom), puis envoi automatique ;
     - fichiers dans le bucket privé « print-files », puis RPC sr_submit -> fiche D-0001 ;
     - un fichier refuse de partir : aucune fiche, formulaire intact, invitation à nous écrire ;
     - brouillon en sessionStorage + IndexedDB : survit au passage par l'appli courriel.
   Le courriel de confirmation part de la base (service-request-notify), jamais du navigateur.
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';
  var CA = window.CA, _t = CA.t || function (s) { return s; };
  var KEY = 'ca-compte-auth', DRAFT = 'ca_demande_draft', EMAIL = 'contact@creationaudio.ca', DB = 'ca-demande';
  var cfg = {}, job = null, sending = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
  }
  function client() {
    if (CA.compteSb) return CA.compteSb;
    var c = window.CA_SUPABASE || {};
    if (window.supabase && window.supabase.createClient && c.url) {
      CA.compteSb = window.supabase.createClient(c.url, c.anonKey, {
        auth: { storageKey: KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
    return CA.compteSb || null;
  }

  /* ---------- brouillon ---------- */
  function idb(mode, fn) {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('files'); };
        rq.onerror = function () { res(null); };
        rq.onsuccess = function () {
          var db = rq.result, tx, out;
          try { tx = db.transaction('files', mode); out = fn(tx.objectStore('files')); } catch (e) { db.close(); res(null); return; }
          tx.oncomplete = function () { db.close(); res(out && out.result !== undefined ? out.result : null); };
          tx.onerror = tx.onabort = function () { db.close(); res(null); };
        };
      } catch (e) { res(null); }
    });
  }
  function saveDraft(j) {
    try { sessionStorage.setItem(DRAFT, JSON.stringify({ kind: cfg.kind, details: j.details, at: Date.now() })); } catch (e) {}
    return idb('readwrite', function (s) {
      s.clear();
      (j.files || []).forEach(function (f, i) { s.put({ name: f.name, blob: f }, 'f' + i); });
    });
  }
  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT); } catch (e) {}
    return idb('readwrite', function (s) { s.clear(); });
  }
  function readDraft() {
    var d = null;
    try { d = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); } catch (e) {}
    if (!d || d.kind !== cfg.kind || Date.now() - d.at > 3600 * 1000) { return clearDraft().then(function () { return null; }); }
    return idb('readonly', function (s) { return s.getAll(); }).then(function (rows) {
      var files = (rows || []).filter(function (r) { return r && r.blob && r.name; }).map(function (r) {
        return r.blob instanceof File ? r.blob : new File([r.blob], r.name);
      });
      return { details: d.details, files: files };
    });
  }

  /* ---------- messages ---------- */
  function busy(on) { sending = on; if (cfg.onBusy) cfg.onBusy(on); }
  function say(text, cls) {
    if (!cfg.status) return;
    cfg.status.className = cfg.statusBase + (cls ? ' ' + cls : '');
    cfg.status.textContent = text || '';
  }
  function kindLabel() { return cfg.kind === 'maintenance' ? _t('Entretien d\'imprimantes') : _t('Impression 3D'); }
  // lien « Écris-nous » (Messagerie préremplie) + courriel de repli : il y a toujours un moyen de nous joindre
  function fail(text, fileName) {
    busy(false);
    if (!cfg.status) return;
    var body = kindLabel() + (fileName ? ' : ' + fileName : '');
    cfg.status.className = cfg.statusBase + ' is-err';
    cfg.status.innerHTML = esc(text) + ' <a class="ask" href="compte#/messages" data-msg="autre" data-msg-ref="' + esc(kindLabel()) +
      '" data-msg-body="' + esc(body) + '">' + esc(_t('Écris-nous')) + '</a><span class="ask-alt"> ' + esc(_t('ou par')) +
      ' <a href="mailto:' + EMAIL + '">' + EMAIL + '</a></span>';
  }

  /* ---------- envoi ---------- */
  function upload(c, uid, files) {
    var done = [];
    function remove() {
      if (!done.length) return Promise.resolve();
      return c.storage.from('print-files').remove(done.map(function (x) { return x.p; })).then(null, function () {});
    }
    return files.reduce(function (p, f) {
      return p.then(function () {
        var path = uid + '/' + uuid() + '.' + f.name.split('.').pop().toLowerCase();
        // le bucket n'accepte que octet-stream ; Safari et Firefox donnent un autre type au fichier
        var body = f.slice(0, f.size, 'application/octet-stream');
        return c.storage.from('print-files').upload(path, body, { contentType: 'application/octet-stream', upsert: false }).then(function (r) {
          if (r.error) { var e = new Error('upload'); e.fileName = f.name; throw e; }
          done.push({ p: path, n: f.name });
        }, function () { var e = new Error('upload'); e.fileName = f.name; throw e; });
      });
    }, Promise.resolve()).then(function () { return { list: done, remove: remove }; }, function (e) {
      return remove().then(function () { throw e; });
    });
  }
  function isAuth(err) {
    var c = String((err && (err.code || err.status)) || '');
    return /^(401|403|42501|PGRST301)$/.test(c) || /jwt|token/i.test((err && err.message) || '');
  }
  function ask() {
    busy(false);
    say('');
    if (CA.panierCompte) CA.panierCompte.open(true);
    else fail(_t('Service indisponible pour le moment.'));
  }
  function go() {
    var c = client(), j = job;
    if (!j) return;
    if (!c) { fail(_t('Service indisponible pour le moment.')); return; }
    busy(true);
    say(_t('Envoi…'));
    c.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s) { ask(); return null; }
      return c.rpc('me_account').then(function (res) {
        var acct = res && !res.error && res.data;
        if (res && res.error && isAuth(res.error)) { ask(); return null; }
        if (acct && !String(acct.name || '').trim()) {
          busy(false); say('');
          CA.panierCompte.askName(c, acct);
          return null;
        }
        return c.rpc('me_set_lang', { p_lang: CA.lang || 'fr' }).then(null, function () {}).then(function () {
          if ((j.files || []).length) say(_t('Envoi des fichiers…'));
          return upload(c, s.user.id, j.files || []);
        }).then(function (up) {
          return c.rpc('sr_submit', {
            p_kind: cfg.kind, p_details: j.details, p_files: up.list,
            p_page: location.pathname.slice(0, 200), p_lang: CA.lang === 'en' ? 'en' : 'fr'
          }).then(function (res2) {
            if (res2.error) return up.remove().then(function () { throw res2.error; });
            return res2.data;
          }, function (e) { return up.remove().then(function () { throw e; }); });
        }).then(function (data) {
          job = null;
          return clearDraft().then(function () { busy(false); say(''); showDone(data); });
        });
      });
    }).catch(function (err) {
      if (err && err.fileName) { fail(_t('Ton fichier n\'a pas pu être envoyé. Écris-nous, on va t\'aider.'), err.fileName); return; }
      if (isAuth(err)) { ask(); return; }
      fail((err && err.message && _t(err.message)) || _t('Envoi impossible pour le moment. Réessaie.'));
    });
  }

  /* ---------- confirmation : remplace le formulaire ---------- */
  var okEl = null;
  function showDone(d) {
    var form = cfg.form;
    if (okEl) okEl.remove();
    okEl = document.createElement('div');
    okEl.className = 'dm-ok';
    okEl.setAttribute('role', 'status');
    okEl.innerHTML =
      '<span class="dm-ok-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>' +
      '<h2 class="dm-ok-t" tabindex="-1">' + esc(_t('Ta demande a bien été envoyée')) + '</h2>' +
      '<p class="dm-ok-n">' + esc(d.number) + '</p>' +
      '<p class="dm-ok-m">' + esc(_t('On te revient dans les plus brefs délais.')) + '</p>' +
      '<p class="dm-ok-m">' + esc(_t('Une confirmation t\'est envoyée par courriel.')) + '</p>' +
      '<div class="dm-ok-acts">' +
        '<a class="btn btn-ember btn-lg" href="compte#/demandes/' + esc(d.id) + '">' + esc(_t('Suivre ma demande')) + '</a>' +
        '<button type="button" class="btn btn-ghost btn-lg dm-ok-new">' + esc(_t('Nouvelle demande')) + '</button>' +
      '</div>';
    form.hidden = true;
    form.parentNode.insertBefore(okEl, form.nextSibling);
    okEl.querySelector('.dm-ok-new').addEventListener('click', function () {
      okEl.remove(); okEl = null;
      form.hidden = false;
      if (cfg.onReset) cfg.onReset();
    });
    if (cfg.onDone) cfg.onDone(d);
    var title = okEl.querySelector('.dm-ok-t');
    title.focus({ preventScroll: true });
    okEl.scrollIntoView({ behavior: 'auto', block: 'center' });
  }

  CA.demande = {
    client: client,
    init: function (o) {
      cfg = o || {};
      cfg.statusBase = cfg.status ? cfg.status.className.split(' ')[0] : '';
      if (CA.panierCompte) CA.panierCompte.setup({
        client: client,
        words: {
          needAccount: _t('Connecte-toi pour envoyer ta demande'),
          sendsAfter: _t('Ta demande part dès que c\'est confirmé.'),
          confirmSend: _t('Confirmer et envoyer'),
          nameWhy: _t('Il nous manque ton nom pour préparer ta demande.'),
          sendNow: _t('Envoyer ma demande')
        },
        onSignedIn: function (send) {
          if (send && job) go();
          else if (!send) { busy(false); }
        },
        onCancel: function () { job = null; busy(false); clearDraft(); }
      });
      // retour de l'appli courriel : le formulaire revient, et la fenêtre du code si elle était ouverte
      readDraft().then(function (d) {
        if (!d) return;
        job = { details: d.details, files: d.files };
        if (cfg.onRestore) cfg.onRestore(d.details, d.files);
        if (CA.panierCompte && CA.panierCompte.resume()) return;
        job = null;
      });
    },
    submit: function (j) {
      if (sending) return;
      job = j;
      busy(true);
      saveDraft(j).then(go, go);
    }
  };
})();
