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
  var calc = { travel_minutes: 60, machines_per_visit: 1, margin_pct: 40 }, mats = [];
  var matsEl = document.getElementById('ec-mats'), resEl = document.getElementById('ec-res');
  var CFG = { 'ec-tmin': 'travel_minutes', 'ec-mpv': 'machines_per_visit', 'ec-margin': 'margin_pct' };
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
      '<span class="drag-handle" title="Glisser pour réordonner">⠿</span>' +
      '<button type="button" class="en-ph" data-act="photo" aria-label="Changer la photo">' +
        (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span>Photo</span>') + '</button>' +
      '<div class="en-fields">' +
        '<label class="field"><span class="lbl">Marque</span><input type="text" data-f="brand" value="' + esc(r.brand || '') + '" maxlength="40" autocomplete="off"></label>' +
        '<label class="field"><span class="lbl">Modèle</span><input type="text" data-f="name" value="' + esc(r.name) + '" maxlength="80" autocomplete="off"></label>' +
        '<label class="field"><span class="lbl">Prix/mois</span><span class="unit" data-unit="$"><input type="number" data-f="price_month" min="0.01" step="0.01" inputmode="decimal" placeholder="À évaluer" value="' + esc(r.price_month == null ? '' : r.price_month) + '"></span></label>' +
        '<label class="field"><span class="lbl">Minutes</span><span class="unit" data-unit="min"><input type="number" data-f="minutes" min="1" max="600" step="1" inputmode="numeric" value="' + esc(r.minutes == null ? '' : r.minutes) + '"></span></label>' +
      '</div>' +
      '<div class="en-acts">' +
        '<label class="en-vis"><input type="checkbox" data-f="visible"' + (r.visible ? ' checked' : '') + '> Visible</label>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="del" data-ic="trash" aria-label="Supprimer"></button>' +
      '</div>' +
    '</article>';
  }
  function paint() {
    listEl.innerHTML = rows.length ? rows.map(card).join('') : '<p class="muted">Aucune imprimante. Ajoutes-en une.</p>';
    if (rateEl) rateEl.value = rate;
    paintRes();
  }

  /* ---- calculateur de prix : temps × taux + matériaux + part du déplacement, puis marge visée ---- */
  function money(n) { return CA.money ? CA.money(n) : (Math.round(n * 100) / 100).toFixed(2) + ' $'; }
  function matCost() { return mats.reduce(function (t, m) { return t + (+m.cost || 0) * (+m.qty || 0); }, 0); }
  function travelShare() { return (rate * calc.travel_minutes / 60) / Math.max(1, calc.machines_per_visit); }
  function figures(r) {
    var min = r.minutes || 0, labor = rate * min / 60, mat = matCost(), trav = travelShare(), cost = labor + mat + trav;
    var sug = min ? Math.ceil(cost / (1 - calc.margin_pct / 100)) : null;
    var cur = r.price_month == null ? null : +r.price_month;
    return { labor: labor, mat: mat, trav: trav, cost: cost, sug: sug, cur: cur, profit: cur == null ? null : cur - cost, pct: cur ? (cur - cost) / cur * 100 : null };
  }
  function paintCfg() {
    Object.keys(CFG).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = calc[CFG[id]]; });
  }
  function paintMats() {
    if (!matsEl) return;
    matsEl.innerHTML = mats.length ? mats.map(function (m) {
      return '<div class="en-mat" data-id="' + esc(m.id) + '">' +
        '<label class="field"><span class="lbl">Matériau</span><input type="text" data-m="name" value="' + esc(m.name) + '" maxlength="80" autocomplete="off"></label>' +
        '<label class="field"><span class="lbl">Coût</span><span class="unit" data-unit="$"><input type="number" data-m="cost" min="0" step="0.01" inputmode="decimal" value="' + esc(m.cost) + '"></span></label>' +
        '<label class="field"><span class="lbl">Quantité</span><input type="number" data-m="qty" min="0" step="0.1" inputmode="decimal" value="' + esc(m.qty) + '"></label>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-mdel data-ic="trash" aria-label="Supprimer"></button></div>';
    }).join('') : '<p class="muted">Aucun matériau.</p>';
  }
  function paintRes() {
    if (!resEl) return;
    if (!rows.length) { resEl.innerHTML = ''; return; }
    var miss = false;
    var body = rows.map(function (r) {
      var x = figures(r);
      if (!x.sug) miss = true;
      return '<tr data-id="' + esc(r.id) + '"><td>' + esc([r.brand, r.name].filter(Boolean).join(' ')) + '<small>' + esc(money(x.labor) + ' + ' + money(x.mat) + ' + ' + money(x.trav)) + '</small></td>' +
        '<td><input type="number" data-cm min="1" max="600" step="1" inputmode="numeric" value="' + esc(r.minutes == null ? '' : r.minutes) + '" aria-label="Minutes"></td>' +
        '<td>' + money(x.cost) + '</td>' +
        '<td><b>' + (x.sug ? money(x.sug) : '—') + '</b><small>' + (x.cur == null ? 'Sur évaluation' : 'Actuel ' + money(x.cur)) + '</small></td>' +
        '<td class="' + (x.pct == null ? '' : x.pct >= calc.margin_pct ? 'is-good' : x.pct >= 0 ? '' : 'is-bad') + '">' + (x.pct == null ? '—' : money(x.profit) + ' (' + Math.round(x.pct) + ' %)') + '</td>' +
        '<td>' + (x.sug && x.sug !== x.cur ? '<button type="button" class="btn btn-ghost btn-sm" data-apply>Appliquer</button>' : '') + '</td></tr>';
    }).join('');
    resEl.innerHTML = '<table><thead><tr><th>Machine</th><th>Minutes</th><th>Coût</th><th>Prix suggéré</th><th>Profit</th><th></th></tr></thead><tbody>' + body + '</tbody></table>' +
      '<p class="muted en-note">Sous chaque machine : main-d’œuvre + matériaux + déplacement.' + (miss ? ' Entre les minutes d’une machine pour obtenir son prix suggéré.' : '') + '</p>';
  }

  /* ---- données ---- */
  function load() {
    return Promise.all([
      sb.from('maintenance_printers').select('*').order('sort_order').order('created_at'),
      sb.from('maintenance_settings').select('hourly_rate').eq('id', 1).maybeSingle(),
      sb.from('maintenance_calc').select('*').eq('id', 1).maybeSingle(),
      sb.from('maintenance_materials').select('*').order('sort_order').order('created_at')
    ]).then(function (out) {
      if (out[0].error) throw out[0].error;
      rows = out[0].data || [];
      rate = out[1].data ? +out[1].data.hourly_rate : 60;
      if (out[2] && out[2].data) calc = out[2].data;
      mats = (out[3] && out[3].data) || [];
      loaded = true;
      paintCfg();
      paintMats();
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
      if (ok) { if (f === 'visible') paint(); else paintRes(); if (CA.entretienChanged) CA.entretienChanged(); }
    });
  });

  /* ---- boutons de carte ---- */
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), art = e.target.closest('.en-card');
    if (!b || !art) return;
    var r = byId(art.getAttribute('data-id')), act = b.getAttribute('data-act');
    if (!r) return;
    if (act === 'photo') { uploadFor = r; fileEl.value = ''; fileEl.click(); return; }
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

  /* ---- glisser-déposer (comme l'onglet Filaments) : seule façon de réordonner ---- */
  var dragRow = null;
  function persistOrder() {
    var ups = rows.map(function (x, k) {
      if (x.sort_order === k + 1) return null;
      x.sort_order = k + 1;
      return sb.from('maintenance_printers').update({ sort_order: k + 1 }).eq('id', x.id);
    }).filter(Boolean);
    if (!ups.length) return;
    Promise.all(ups).then(function () { if (CA.entretienChanged) CA.entretienChanged(); }, function (er) { window.caDialog.error(er); load(); });
  }
  // la carte n'est glissable que si on la saisit ailleurs que dans un champ (le texte reste sélectionnable)
  listEl.addEventListener('mousedown', function (e) {
    var art = e.target.closest('.en-card');
    if (art) art.draggable = !e.target.closest('input, textarea, select');
  });
  listEl.addEventListener('dragstart', function (e) {
    var art = e.target.closest && e.target.closest('.en-card');
    if (!art) return;
    dragRow = byId(art.getAttribute('data-id'));
    art.classList.add('dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', art.getAttribute('data-id')); } catch (_) {} }
  });
  listEl.addEventListener('dragend', function () {
    dragRow = null;
    Array.prototype.forEach.call(listEl.querySelectorAll('.en-card'), function (c) { c.classList.remove('dragging', 'drop-target'); c.draggable = false; });
  });
  listEl.addEventListener('dragover', function (e) {
    if (!dragRow || !e.target.closest('.en-card')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });
  listEl.addEventListener('dragenter', function (e) {
    var art = e.target.closest('.en-card');
    Array.prototype.forEach.call(listEl.querySelectorAll('.drop-target'), function (c) { c.classList.remove('drop-target'); });
    if (dragRow && art && art.getAttribute('data-id') !== dragRow.id) art.classList.add('drop-target');
  });
  listEl.addEventListener('drop', function (e) {
    var art = e.target.closest('.en-card');
    if (!dragRow || !art) return;
    e.preventDefault();
    var to = byId(art.getAttribute('data-id')), from = dragRow;
    dragRow = null;
    if (!to || to === from) { paint(); return; }
    var i = rows.indexOf(from), j = rows.indexOf(to);
    rows.splice(j, 0, rows.splice(i, 1)[0]);
    paint();
    persistOrder();
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
      paintRes();
      window.caDialog.toast('Taux horaire enregistré');
    }, function (er) { window.caDialog.error(er); rateEl.value = rate; });
  });

  /* ---- calculateur : réglages, matériaux, minutes, appliquer ---- */
  var cfgEl = document.getElementById('en-calc');
  if (cfgEl) {
    cfgEl.addEventListener('change', function (e) {
      var el = e.target, id = el.id;
      if (CFG[id]) {
        var k = CFG[id], v = num(el.value), max = k === 'margin_pct' ? 94 : k === 'travel_minutes' ? 600 : 100;
        if (v == null || v < 0 || (k === 'machines_per_visit' && v < 1) || v > max) { el.value = calc[k]; return; }
        v = k === 'margin_pct' ? Math.round(v * 100) / 100 : Math.round(v);
        var patch = {}; patch[k] = v;
        sb.from('maintenance_calc').update(patch).eq('id', 1).then(function (res) {
          if (res.error) { window.caDialog.error(res.error); el.value = calc[k]; return; }
          calc[k] = v; el.value = v; paintRes();
        }, function (er) { window.caDialog.error(er); el.value = calc[k]; });
        return;
      }
      var mrow = el.closest('.en-mat'), f = el.getAttribute('data-m');
      if (mrow && f) {
        var m = mats.filter(function (x) { return x.id === mrow.getAttribute('data-id'); })[0];
        if (!m) return;
        var val = f === 'name' ? el.value.trim() : num(el.value);
        if (f === 'name' ? !val : (val == null || val < 0)) { el.value = m[f]; return; }
        var p = {}; p[f] = f === 'name' ? val : f === 'cost' ? Math.round(val * 100) / 100 : Math.round(val * 1000) / 1000;
        sb.from('maintenance_materials').update(p).eq('id', m.id).then(function (res) {
          if (res.error) { window.caDialog.error(res.error); el.value = m[f]; return; }
          m[f] = p[f]; paintRes();
        }, function (er) { window.caDialog.error(er); el.value = m[f]; });
        return;
      }
      var tr = el.closest('tr[data-id]');
      if (tr && el.hasAttribute('data-cm')) {
        var r = byId(tr.getAttribute('data-id')), mn = num(el.value);
        if (!r) return;
        if (!(mn >= 1 && mn <= 600)) { el.value = r.minutes == null ? '' : r.minutes; return; }
        save(r, { minutes: Math.round(mn) }).then(function (ok) { if (ok) { paint(); if (CA.entretienChanged) CA.entretienChanged(); } });
      }
    });
    cfgEl.addEventListener('click', function (e) {
      var d = e.target.closest('[data-mdel]');
      if (d) {
        var id = d.closest('.en-mat').getAttribute('data-id');
        sb.from('maintenance_materials').delete().eq('id', id).then(function (res) {
          if (res.error) { window.caDialog.error(res.error); return; }
          mats = mats.filter(function (x) { return x.id !== id; }); paintMats(); paintRes();
        }, function (er) { window.caDialog.error(er); });
        return;
      }
      var ap = e.target.closest('[data-apply]');
      if (ap) {
        var r = byId(ap.closest('tr').getAttribute('data-id')), x = r && figures(r);
        if (!r || !x.sug) return;
        window.caDialog.confirm({ title: 'Fixer ' + money(x.sug) + ' par mois pour ' + [r.brand, r.name].filter(Boolean).join(' ') + ' ?', message: 'Le prix du catalogue change aussi sur le site.', ok: 'Appliquer', cancel: 'Annuler' }).then(function (ok) {
          if (!ok) return;
          save(r, { price_month: x.sug }).then(function (done) { if (done) { paint(); if (CA.entretienChanged) CA.entretienChanged(); } });
        });
      }
    });
    document.getElementById('ec-addmat').addEventListener('click', function () {
      var order = mats.reduce(function (t, x) { return Math.max(t, x.sort_order || 0); }, 0) + 1;
      sb.from('maintenance_materials').insert({ name: 'Nouveau matériau', cost: 0, qty: 1, sort_order: order }).select('*').maybeSingle().then(function (res) {
        if (res.error) { window.caDialog.error(res.error); return; }
        mats.push(res.data); paintMats(); paintRes();
        var inp = matsEl.querySelector('.en-mat:last-child [data-m="name"]');
        if (inp) { inp.focus(); inp.select(); }
      }, function (er) { window.caDialog.error(er); });
    });
  }

  var prevOnTab = CA.onTab;
  CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'entretien' && !loaded) load();
  };
  if (CA.onAdminReady) CA.onAdminReady(function () { if (!loaded) load(); });
})();
