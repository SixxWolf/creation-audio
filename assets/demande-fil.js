/* =========================================================
   Création Audio — discussion d'une demande de service (fil dans la fiche).
   Partagé par Mon compte (compte-demandes.js) et l'admin (cms-demandes.js).
   CA.demandeFil.mount(el, { id, owner, admin, sb, root, btn }) -> { refresh(), destroy() }
     admin : lit/écrit service_request_messages (RLS admin) ; un plateau tranché part en aperçu .capv (apercu-3d.js).
     client : RPC me_sr_messages (vaut lecture) et sr_send.
   Relecture aux 10 s tant que le fil est à l'écran. Photos : bucket « messages » ; fichiers 3D : « print-files ».
   Un .capv n'est jamais téléchargeable ; le STEP n'a pas d'aperçu.
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';
  var CA = window.CA, _t = CA.t || function (s) { return s; };
  var MAX_PHOTOS = 4, MAX_FILES = 3, MAX_BYTES = 50 * 1048576, MAX_SIDE = 1600, AP3D_V = 1;
  var EXT = /\.(stl|3mf|step|stp|obj|gcode)$/i, VIEW = /\.(stl|obj|3mf|gcode)$/i, CAPV = /\.capv$/i, SLICED = /\.gcode(\.3mf)?$/i;
  var IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
  }
  function when(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(CA.locale || 'fr-CA', { day: 'numeric', month: 'short' }) + ' · ' +
      d.toLocaleTimeString(CA.locale || 'fr-CA', { hour: '2-digit', minute: '2-digit' });
  }
  function shrink(file) {
    if (!window.createImageBitmap) return Promise.reject(new Error('photo'));
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); }).then(function (bmp) {
      var k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      var cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('photo')); }, 'image/jpeg', 0.82); });
    });
  }
  var ap3dP = null;
  function loadAp3d(root) {
    if (CA.ap3d) return Promise.resolve(CA.ap3d);
    if (!ap3dP) ap3dP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = (root || '') + 'assets/apercu-3d.js?v=' + AP3D_V;
      s.onload = function () { if (CA.ap3d) res(CA.ap3d); else rej(new Error('apercu')); };
      s.onerror = function () { rej(new Error('apercu')); };
      document.head.appendChild(s);
    });
    ap3dP.catch(function () { ap3dP = null; });
    return ap3dP;
  }
  // lien « Voir en 3D » réutilisé pour les fichiers de la demande elle-même
  function view3d(sb, path, name, root) {
    return loadAp3d(root).then(function (A) {
      return sb.storage.from('print-files').createSignedUrl(path, 600).then(function (r) {
        if (r.error || !r.data || !r.data.signedUrl) throw new Error('url');
        A.show({ name: name, url: r.data.signedUrl, ext: path.split('.').pop().toLowerCase() });
      });
    });
  }
  // téléchargement + aperçu d'un fichier joint (lignes partagées par le fil et la fiche)
  function fileRow(f, urls) {
    var u = urls[f.p], data = ' data-v3d="' + esc(f.p) + '" data-n="' + esc(f.n) + '"';
    if (CAPV.test(f.p)) return '<div class="df-frow"><button type="button" class="df-file df-capv"' + data + '>' + IC + '<span>' + esc(f.n) + '</span><b>' + esc(_t('Voir en 3D')) + '</b></button></div>';
    var inner = IC + '<span>' + esc(f.n) + '</span>';
    var link = u ? '<a class="df-file" href="' + esc(u) + '" download="' + esc(f.n) + '" target="_blank" rel="noopener">' + inner + '</a>' : '<span class="df-file is-off">' + inner + '</span>';
    return '<div class="df-frow">' + link + (u && VIEW.test(f.p) ? '<button type="button" class="df-3d"' + data + '>' + esc(_t('Voir en 3D')) + '</button>' : '') + '</div>';
  }

  function mount(el, o) {
    var sb = o.sb, msgs = [], urls = {}, furls = {}, photos = [], files = [], pollT = null, dead = false, busy = false;
    var photoJob = Promise.resolve(), fileJob = Promise.resolve();
    el.innerHTML =
      '<div class="df-list" aria-live="polite"></div>' +
      '<form class="df-form" novalidate>' +
        '<div class="df-thumbs" hidden></div><ul class="df-flist" hidden></ul>' +
        '<label class="df-label" for="df-in-' + esc(o.id) + '">' + esc(_t('Ton message')) + '</label>' +
        '<textarea class="df-in" id="df-in-' + esc(o.id) + '" rows="2" maxlength="4000"></textarea>' +
        '<div class="df-row">' +
          '<label class="df-att">' + esc(_t('Photo')) + '<input type="file" class="df-ph" accept="image/*" multiple hidden></label>' +
          '<label class="df-att">' + esc(_t('Fichier 3D')) + '<input type="file" class="df-3df" multiple hidden></label>' +
          '<button type="submit" class="df-send ' + esc(o.btn || '') + '">' + esc(_t('Envoyer')) + '</button>' +
        '</div>' +
        '<p class="df-status" role="status" aria-live="polite"></p>' +
      '</form>';
    var list = el.querySelector('.df-list'), form = el.querySelector('form'), input = el.querySelector('.df-in'),
        st = el.querySelector('.df-status'), btn = el.querySelector('.df-send'), thumbs = el.querySelector('.df-thumbs'), flist = el.querySelector('.df-flist');
    function say(t, bad) { st.textContent = t || ''; st.classList.toggle('is-bad', !!bad); }

    function load() {
      if (o.admin) {
        return sb.from('service_request_messages').select('*').eq('request_id', o.id).order('created_at').then(function (r) {
          if (r.error) throw r.error;
          return sb.from('service_requests').update({ admin_unread: 0 }).eq('id', o.id).gt('admin_unread', 0).then(function () {
            if (o.onRead) o.onRead();
            return r.data || [];
          });
        });
      }
      return sb.rpc('me_sr_messages', { p_id: o.id }).then(function (r) {
        if (r.error) throw r.error;
        if (o.onRead) o.onRead();
        return r.data || [];
      });
    }
    function sign() {
      var ph = [], fl = [];
      msgs.forEach(function (m) {
        (m.photos || []).forEach(function (p) { if (!urls[p]) ph.push(p); });
        (m.files || []).forEach(function (f) { if (!furls[f.p] && !CAPV.test(f.p)) fl.push(f.p); });
      });
      if (!sb.storage) return Promise.resolve();
      return Promise.all([
        ph.length ? sb.storage.from('messages').createSignedUrls(ph, 3600).then(function (r) { (r.data || []).forEach(function (x) { if (x.signedUrl) urls[x.path] = x.signedUrl; }); }, function () {}) : null,
        fl.length ? sb.storage.from('print-files').createSignedUrls(fl, 3600).then(function (r) { (r.data || []).forEach(function (x) { if (x.signedUrl) furls[x.path] = x.signedUrl; }); }, function () {}) : null
      ]);
    }
    function paint() {
      var near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      list.innerHTML = msgs.length ? msgs.map(function (m) {
        var mine = o.admin ? m.sender === 'admin' : m.sender === 'client';
        return '<div class="df-b' + (mine ? ' is-me' : '') + '">' +
          ((m.photos || []).length ? '<div class="df-b-ph">' + m.photos.map(function (p) {
            return urls[p] ? '<a href="' + esc(urls[p]) + '" target="_blank" rel="noopener"><img src="' + esc(urls[p]) + '" alt="" loading="lazy"></a>' : '';
          }).join('') + '</div>' : '') +
          ((m.files || []).length ? '<div class="df-b-f">' + m.files.map(function (f) { return fileRow(f, furls); }).join('') + '</div>' : '') +
          (m.body ? '<p>' + esc(m.body) + '</p>' : '') +
          '<time>' + esc(when(m.created_at)) + '</time></div>';
      }).join('') : '<p class="df-none">' + esc(_t('Aucun message pour l\'instant.')) + '</p>';
      if (near) list.scrollTop = list.scrollHeight;
    }
    function refresh() {
      return load().then(function (rows) {
        if (dead) return;
        var same = rows.length === msgs.length && (!rows.length || rows[rows.length - 1].id === msgs[msgs.length - 1].id);
        msgs = rows;
        if (same && list.firstChild) return;
        return sign().then(function () { if (!dead) { paint(); list.scrollTop = list.scrollHeight; } });
      }, function () { if (!dead && !list.firstChild) say(_t('Discussion indisponible pour le moment.'), true); });
    }
    function schedule() {
      clearTimeout(pollT);
      if (dead) return;
      pollT = setTimeout(function () {
        if (!el.isConnected) { destroy(); return; }
        (document.hidden || !el.offsetParent ? Promise.resolve() : refresh()).then(schedule, schedule);
      }, 10000);
    }
    function destroy() { dead = true; clearTimeout(pollT); }

    list.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-v3d]');
      if (!b || b.disabled) return;
      b.disabled = true;
      view3d(sb, b.getAttribute('data-v3d'), b.getAttribute('data-n') || '', o.root).catch(function () {
        say(_t('Aperçu indisponible pour ce fichier.'), true);
      }).then(function () { b.disabled = false; });
    });

    /* ---------- pièces jointes ---------- */
    function paintAtt() {
      thumbs.innerHTML = photos.map(function (p, i) {
        return '<span class="df-thumb"><img src="' + esc(p.url) + '" alt=""><button type="button" data-ph="' + i + '" aria-label="' + esc(_t('Retirer')) + '">×</button></span>';
      }).join('');
      thumbs.hidden = !photos.length;
      flist.innerHTML = files.map(function (f, i) {
        return '<li>' + IC + '<span>' + esc(f.name) + '</span><em>' + esc(f.blob ? '' : _t('Préparation…')) + '</em><button type="button" data-fl="' + i + '" aria-label="' + esc(_t('Retirer')) + '">×</button></li>';
      }).join('');
      flist.hidden = !files.length;
    }
    form.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-ph'), b = e.target.getAttribute && e.target.getAttribute('data-fl');
      if (a != null) { photos.splice(+a, 1); paintAtt(); }
      if (b != null) { files.splice(+b, 1); paintAtt(); }
    });
    el.querySelector('.df-ph').addEventListener('change', function (e) {
      var pick = [].slice.call(e.target.files || []);
      e.target.value = '';
      if (pick.length > MAX_PHOTOS - photos.length) say(_t('Au plus 4 photos par message.'), true);
      pick = pick.slice(0, Math.max(0, MAX_PHOTOS - photos.length));
      photoJob = Promise.all([photoJob].concat(pick.map(function (f) {
        return shrink(f).then(function (b) { photos.push({ blob: b, url: URL.createObjectURL(b) }); },
          function () { say(_t('Format de photo non pris en charge : envoie une photo JPEG ou PNG.'), true); });
      }))).then(paintAtt);
    });
    el.querySelector('.df-3df').addEventListener('change', function (e) {
      var pick = [].slice.call(e.target.files || []), bad = '';
      e.target.value = '';
      pick.forEach(function (f) {
        if (!EXT.test(f.name)) { bad = _t('Formats acceptés : STL, 3MF, STEP, OBJ, G-code.'); return; }
        if (files.length >= MAX_FILES) { bad = _t('Au plus 3 fichiers 3D par message.'); return; }
        var sliced = o.admin && SLICED.test(f.name);
        if (!sliced && f.size > MAX_BYTES) { bad = _t('Fichier trop lourd (50 Mo maximum).'); return; }
        var it = { name: f.name, file: f, blob: sliced ? null : f, preview: false };
        files.push(it);
        if (!sliced) return;
        fileJob = Promise.all([fileJob, loadAp3d(o.root).then(function (A) { return A.makePreview(f, function () {}); }).then(function (r) {
          if (r) { it.blob = r.blob; it.preview = true; }
          else if (/\.gcode$/i.test(f.name)) { files.splice(files.indexOf(it), 1); say(_t('Aucun parcours lisible dans ce G-code.'), true); }
          else if (f.size > MAX_BYTES) { files.splice(files.indexOf(it), 1); say(_t('Fichier trop lourd (50 Mo maximum).'), true); }
          else it.blob = f;
          paintAtt();
        }, function () { files.splice(files.indexOf(it), 1); say(_t('Aperçu indisponible pour ce fichier.'), true); paintAtt(); })]);
      });
      say(bad, !!bad);
      paintAtt();
    });
    function up() {
      var c = sb.storage;
      return Promise.all(photos.map(function (p) {
        var path = o.owner + '/' + uuid() + '.jpg';
        return c.from('messages').upload(path, p.blob, { contentType: 'image/jpeg', upsert: false }).then(function (r) {
          if (r.error) throw new Error(_t('Une photo n\'a pas pu être envoyée. Réessaie.'));
          return path;
        });
      })).then(function (ph) {
        return Promise.all(files.map(function (f) {
          var path = o.owner + '/' + uuid() + '.' + (f.preview ? 'capv' : f.name.split('.').pop().toLowerCase());
          var body = f.blob.slice(0, f.blob.size, 'application/octet-stream');
          return c.from('print-files').upload(path, body, { contentType: 'application/octet-stream', upsert: false }).then(function (r) {
            if (r.error) throw new Error(_t('Un fichier 3D n\'a pas pu être envoyé. Réessaie.'));
            return { p: path, n: f.preview ? f.name.replace(/(\.gcode)?(\.3mf)?$/i, '') || f.name : f.name, s: f.blob.size };
          });
        })).then(function (fl) { return { ph: ph, fl: fl }; });
      });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      busy = true; btn.disabled = true; say('');
      Promise.all([photoJob, fileJob]).then(function () {
        var body = input.value.trim();
        if (!body && !photos.length && !files.length) { input.focus(); return; }
        say(_t('Envoi…'));
        return up().then(function (a) {
          if (o.admin) return sb.from('service_request_messages').insert({ request_id: o.id, sender: 'admin', body: body, photos: a.ph, files: a.fl });
          return sb.rpc('sr_send', { p_id: o.id, p_body: body, p_photos: a.ph, p_files: a.fl });
        }).then(function (r) {
          if (r && r.error) throw r.error;
          input.value = ''; photos = []; files = []; paintAtt(); say('');
          return refresh();
        });
      }).catch(function (err) {
        say((err && err.message && _t(err.message)) || _t('Envoi impossible pour le moment. Réessaie.'), true);
      }).then(function () { busy = false; btn.disabled = false; });
    });
    if (o.readOnly) form.hidden = true;
    refresh().then(schedule, schedule);
    return { refresh: refresh, destroy: destroy };
  }

  CA.demandeFil = { mount: mount, fileRow: fileRow, view3d: view3d };
})();
