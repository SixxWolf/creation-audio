/* =========================================================
   Création Audio — onglet Entretien (catalogue d'imprimantes du service d'entretien)
   Table maintenance_printers (nom, marque, photo, prix par mois, minutes estimées, ordre, visible)
   + maintenance_settings.hourly_rate (taux horaire de la 1re visite d'une machine sans prix).
   Lu par entretien.html (formulaire et tarifs), sr_submit (instantané dans la demande) et la facturation d'une demande.
   Photo : chemin du bucket « products » (dossier entretien/) ou chemin du site commençant par « / ».
   Chaque champ s'enregistre en le quittant.
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA, sb = CA && CA.sb;
  if (!sb) return;
  var panel = document.querySelector('.tabpanel[data-panel="entretien"]');
  var listEl = document.getElementById('en-list');
  if (!panel || !listEl) return;

  var BUCKET = 'products', DIR = 'entretien';
  var rows = [], rate = 60, loaded = false;
  var rateEl = document.getElementById('en-rate'), fileEl = document.getElementById('en-file');
  var uploadFor = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
  function byId(id) { return rows.filter(function (r) { return r.id === id; })[0]; }
  function photoUrl(p) {
    if (!p) return '';
    if (p.charAt(0) === '/') return p;
    try { return sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl; } catch (e) { return ''; }
  }

  /* ---- affichage ---- */
  function card(r, i) {
    var url = photoUrl(r.photo);
    return '<article class="en-card' + (r.visible ? '' : ' is-off') + '" data-id="' + esc(r.id) + '">' +
      '<button type="button" class="en-ph" data-act="photo" aria-label="Changer la photo">' +
        (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span>Photo</span>') + '</button>' +
      '<div class="en-fields">' +
        '<label class="field"><span class="lbl">Marque</span><input type="text" data-f="brand" value="' + esc(r.brand || '') + '" maxlength="40" autocomplete="off"></label>' +
        '<label class="field"><span class="lbl">Modèle</span><input type="text" data-f="name" value="' + esc(r.name) + '" maxlength="80" autocomplete="off"></label>' +
        '<label class="field"><span class="lbl">Prix par mois</span><span class="unit" data-unit="$"><input type="number" data-f="price_month" min="0.01" step="0.01" inputmode="decimal" placeholder="Sur évaluation" value="' + esc(r.price_month == null ? '' : r.price_month) + '"></span></label>' +
        '<label class="field"><span class="lbl">Temps estimé</span><span class="unit" data-unit="min"><input type="number" data-f="minutes" min="1" max="600" step="1" inputmode="numeric" value="' + esc(r.minutes == null ? '' : r.minutes) + '"></span></label>' +
      '</div>' +
      '<div class="en-acts">' +
        '<label class="en-vis"><input type="checkbox" data-f="visible"' + (r.visible ? ' checked' : '') + '> Visible</label>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="up" aria-label="Monter"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="down" aria-label="Descendre"' + (i === rows.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="del" data-ic="trash" aria-label="Supprimer"></button>' +
      '</div>' +
    '</article>';
  }
  function paint() {
    listEl.innerHTML = rows.length ? rows.map(card).join('') : '<p class="muted">Aucune imprimante. Ajoutes-en une.</p>';
    if (rateEl) rateEl.value = rate;
  }

  /* ---- données ---- */
  function load() {
    return Promise.all([
      sb.from('maintenance_printers').select('*').order('sort_order').order('created_at'),
      sb.from('maintenance_settings').select('hourly_rate').eq('id', 1).maybeSingle()
    ]).then(function (out) {
      if (out[0].error) throw out[0].error;
      rows = out[0].data || [];
      rate = out[1].data ? +out[1].data.hourly_rate : 60;
      loaded = true;
      paint();
      if (CA.entretienChanged) CA.entretienChanged();
    }, function (err) {
      listEl.innerHTML = '<p class="muted">' + esc((err && err.message) || 'Chargement impossible.') + '</p>';
    });
  }
  CA.loadEntretien = load;

  function save(r, patch, quiet) {
    return sb.from('maintenance_printers').update(patch).eq('id', r.id).select('*').maybeSingle().then(function (res) {
      if (res.error) { window.caDialog.error(res.error); paint(); return false; }
      if (res.data) Object.assign(r, res.data);
      if (!quiet) window.caDialog.toast('Enregistré');
      return true;
    }, function (e) { window.caDialog.error(e); paint(); return false; });
  }

  /* ---- champs ---- */
  listEl.addEventListener('change', function (e) {
    var el = e.target.closest('[data-f]'), art = e.target.closest('.en-card');
    if (!el || !art) return;
    var r = byId(art.getAttribute('data-id')), f = el.getAttribute('data-f');
    if (!r) return;
    var patch = {};
    if (f === 'visible') patch.visible = el.checked;
    else if (f === 'name') {
      var n = el.value.trim();
      if (!n) { el.value = r.name; return; }
      patch.name = n;
    } else if (f === 'brand') patch.brand = el.value.trim() || null;
    else if (f === 'price_month') {
      var p = num(el.value);
      if (el.value.trim() && !(p > 0)) { el.value = r.price_month == null ? '' : r.price_month; return; }
      patch.price_month = el.value.trim() ? Math.round(p * 100) / 100 : null;
    } else if (f === 'minutes') {
      var m = num(el.value);
      if (el.value.trim() && !(m >= 1 && m <= 600)) { el.value = r.minutes == null ? '' : r.minutes; return; }
      patch.minutes = el.value.trim() ? Math.round(m) : null;
    }
    save(r, patch).then(function (ok) {
      if (ok) { if (f === 'visible') paint(); if (CA.entretienChanged) CA.entretienChanged(); }
    });
  });

  /* ---- boutons de carte ---- */
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), art = e.target.closest('.en-card');
    if (!b || !art) return;
    var r = byId(art.getAttribute('data-id')), act = b.getAttribute('data-act');
    if (!r) return;
    if (act === 'photo') { uploadFor = r; fileEl.value = ''; fileEl.click(); return; }
    if (act === 'up' || act === 'down') {
      var i = rows.indexOf(r), j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= rows.length) return;
      rows.splice(j, 0, rows.splice(i, 1)[0]);
      Promise.all(rows.map(function (x, k) {
        x.sort_order = k + 1;
        return sb.from('maintenance_printers').update({ sort_order: k + 1 }).eq('id', x.id);
      })).then(function () { paint(); if (CA.entretienChanged) CA.entretienChanged(); }, function (er) { window.caDialog.error(er); load(); });
      return;
    }
    if (act === 'del') {
      window.caDialog.confirm({ title: 'Supprimer ' + [r.brand, r.name].filter(Boolean).join(' ') + ' ?', message: 'Les demandes déjà reçues gardent son nom.', ok: 'Supprimer', cancel: 'Annuler', danger: true }).then(function (ok) {
        if (!ok) return;
        sb.from('maintenance_printers').delete().eq('id', r.id).then(function (res) {
          if (res.error) { window.caDialog.error(res.error); return; }
          if (r.photo && r.photo.charAt(0) !== '/') sb.storage.from(BUCKET).remove([r.photo]).then(null, function () {});
          rows = rows.filter(function (x) { return x !== r; });
          paint();
          if (CA.entretienChanged) CA.entretienChanged();
        }, function (er) { window.caDialog.error(er); });
      });
    }
  });

  /* ---- photo ---- */
  fileEl.addEventListener('change', function () {
    var r = uploadFor, f = fileEl.files && fileEl.files[0];
    uploadFor = null;
    if (!r || !f) return;
    if (!/^image\//.test(f.type)) { window.caDialog.error('Choisis une image.'); return; }
    if (f.size > 5 * 1024 * 1024) { window.caDialog.error('Image trop lourde (5 Mo max).'); return; }
    var ext = (String(f.name).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = DIR + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext, old = r.photo;
    sb.storage.from(BUCKET).upload(path, f, { cacheControl: '3600', upsert: false, contentType: f.type || undefined }).then(function (res) {
      if (res.error) throw res.error;
      return save(r, { photo: path }, true);
    }).then(function (ok) {
      if (!ok) return;
      if (old && old.charAt(0) !== '/') sb.storage.from(BUCKET).remove([old]).then(null, function () {});
      paint();
      window.caDialog.toast('Photo changée');
      if (CA.entretienChanged) CA.entretienChanged();
    }, function (er) { window.caDialog.error(er); });
  });

  /* ---- ajouter ---- */
  document.getElementById('en-new').addEventListener('click', function () {
    var order = rows.reduce(function (m, x) { return Math.max(m, x.sort_order || 0); }, 0) + 1;
    sb.from('maintenance_printers').insert({ name: 'Nouvelle imprimante', sort_order: order }).select('*').maybeSingle().then(function (res) {
      if (res.error) { window.caDialog.error(res.error); return; }
      rows.push(res.data);
      paint();
      var inp = listEl.querySelector('.en-card:last-child [data-f="name"]');
      if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); inp.select(); }
    }, function (er) { window.caDialog.error(er); });
  });

  /* ---- taux horaire ---- */
  rateEl.addEventListener('change', function () {
    var v = num(rateEl.value);
    if (!(v > 0)) { rateEl.value = rate; return; }
    v = Math.round(v * 100) / 100;
    sb.from('maintenance_settings').update({ hourly_rate: v }).eq('id', 1).then(function (res) {
      if (res.error) { window.caDialog.error(res.error); rateEl.value = rate; return; }
      rate = v;
      window.caDialog.toast('Taux horaire enregistré');
    }, function (er) { window.caDialog.error(er); rateEl.value = rate; });
  });

  var prevOnTab = CA.onTab;
  CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'entretien' && !loaded) load();
  };
  if (CA.onAdminReady) CA.onAdminReady(function () { if (!loaded) load(); });
})();
