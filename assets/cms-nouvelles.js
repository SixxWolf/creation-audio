/* =========================================================
   Création Audio — CMS Nouvelles
   Promotions, événements, nouveautés, mises à jour du site.
   Table « news » (schema-v2.sql § NOUVELLES) : kind (promo | event | new | update),
   title, body, image_path (bucket products, dossier news/), cta_label/cta_url,
   promo_code, event_at, starts_at/ends_at (apparaît / disparaît tout seul),
   featured (carte vedette de l'accueil), in_bar (barre du haut de tout le site),
   active, sort_order, proposed (rédigée par Claude, en attente : groupe Propositions).
   Public : nav.js (barre, in_bar) + accueil.js (section #nouvelles) lisent la
   même table en anon — la RLS ne rend que les nouvelles en ligne et dans leurs dates.
   Rien n'est effacé tout seul : terminées / hors ligne = Historique.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var BUCKET = 'products';
  var KINDS = { promo: 'Promotion', event: 'Événement', 'new': 'Nouveauté', update: 'Mise à jour' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // visuels générés par Claude : fichiers du dépôt (assets/news/…), pas du stockage
  function isRepoImg(path) { return /^assets\//.test(path || ''); }
  function removeImg(path) {
    if (path && !isRepoImg(path)) sb.storage.from(BUCKET).remove([path]).then(null, function () {});
  }
  function publicUrl(path) {
    if (!path) return '';
    if (isRepoImg(path)) return path;
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // timestamptz → valeur d'un <input type=date> (jour local)
  function toDay(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  // jour local → début (00:00) ou fin (23:59:59) en ISO
  function fromDay(v, end) {
    if (!v) return null;
    var p = v.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2], end ? 23 : 0, end ? 59 : 0, end ? 59 : 0);
    return isNaN(d) ? null : d.toISOString();
  }
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function fmtDay(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  }
  // event_at est une date (sans heure) : la lire en jour local
  function fmtDate(v) { return v ? fmtDay(fromDay(String(v).slice(0, 10))) : ''; }

  function stateOf(r, now) {
    now = now || Date.now();
    if (r.proposed) return 'prop';
    if (!r.active) return 'off';
    if (r.ends_at && new Date(r.ends_at).getTime() <= now) return 'done';
    if (r.starts_at && new Date(r.starts_at).getTime() > now) return 'soon';
    return 'live';
  }

  var panel = $('.tabpanel[data-panel="nouvelles"]');
  if (!panel) return;
  var listEl = $('#nw-list'), editor = $('#nw-editor'), statusEl = $('#nw-status'),
      titleI = $('#nw-title'), bodyI = $('#nw-body'), ctaLI = $('#nw-cta-label'), ctaUI = $('#nw-cta-url'),
      codeI = $('#nw-code'), eventI = $('#nw-event'), eventF = $('#nw-event-f'), startI = $('#nw-start'), endI = $('#nw-end'),
      activeI = $('#nw-active'), featI = $('#nw-featured'), barI = $('#nw-bar'),
      kindSeg = $('#nw-kind'), fileI = $('#nw-file'), imgPrev = $('#nw-img-prev'), imgEl = $('#nw-img'),
      imgAdd = $('#nw-img-add'), imgRm = $('#nw-img-rm'), saveBtn = $('#nw-save');

  var cache = [], loaded = false, editingId = null, kind = 'new',
      imgPath = null,      // image enregistrée de la nouvelle ouverte
      imgFile = null,      // nouvelle image choisie (envoyée à l'enregistrement)
      imgDrop = false,     // « Retirer » cliqué
      imgBlob = '';

  /* ---- activation à l'ouverture de l'onglet ---- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'nouvelles' && !loaded) { loaded = true; load(); }
  };

  /* ---- interactions ---- */
  $('#nw-new').addEventListener('click', function () { openEditor(null); });
  $('#nw-refresh').addEventListener('click', load);
  $('#nw-cancel').addEventListener('click', closeEditor);
  editor.addEventListener('submit', onSave);
  $$('.fx-seg-btn', kindSeg).forEach(function (b) {
    b.addEventListener('click', function () { setKind(b.getAttribute('data-kind')); });
  });
  imgAdd.addEventListener('click', function () { fileI.click(); });
  fileI.addEventListener('change', function () {
    var f = fileI.files && fileI.files[0];
    fileI.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { caDialog.alert('Choisis une image (JPG, PNG, WebP…).'); return; }
    imgFile = f; imgDrop = false;
    showImg();
  });
  imgRm.addEventListener('click', function () { imgFile = null; imgDrop = true; showImg(); });

  function setKind(k) {
    kind = KINDS[k] ? k : 'new';
    $$('.fx-seg-btn', kindSeg).forEach(function (b) {
      var on = b.getAttribute('data-kind') === kind;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    eventF.hidden = kind !== 'event';
  }
  function showImg() {
    if (imgBlob) { URL.revokeObjectURL(imgBlob); imgBlob = ''; }
    var src = '';
    if (imgFile) src = imgBlob = URL.createObjectURL(imgFile);
    else if (imgPath && !imgDrop) src = publicUrl(imgPath);
    imgPrev.hidden = !src;
    if (src) imgEl.src = src; else imgEl.removeAttribute('src');
    imgRm.hidden = !src;
    imgAdd.textContent = src ? 'Changer l\'image' : 'Ajouter une image';
  }

  /* ---- chargement ---- */
  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    sb.from('news').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false }).then(function (res) {
      if (res.error) { listEl.innerHTML = '<p class="empty">Impossible de charger les nouvelles.<br>' + esc(res.error.message || res.error) + '</p>'; return; }
      cache = res.data || [];
      render();
    });
  }

  /* ---- éditeur ---- */
  function openEditor(row, copy) {
    editingId = row && !copy ? row.id : null;
    $('#nw-editor-title').textContent = editingId ? 'Modifier la nouvelle' : (copy ? 'Copie de la nouvelle' : 'Nouvelle');
    setKind(row ? row.kind : 'new');
    titleI.value = row ? (row.title || '') + (copy ? ' (copie)' : '') : '';
    bodyI.value = row ? row.body || '' : '';
    ctaLI.value = row ? row.cta_label || '' : '';
    ctaUI.value = row ? row.cta_url || '' : '';
    codeI.value = row ? row.promo_code || '' : '';
    eventI.value = row && row.event_at ? String(row.event_at).slice(0, 10) : '';
    startI.value = row && !copy ? toDay(row.starts_at) : '';
    endI.value = row && !copy ? toDay(row.ends_at) : '';
    // une proposition ouverte : « En ligne » coché, enregistrer = publier
    activeI.checked = row ? (copy ? false : !!row.active || !!row.proposed) : true;
    featI.checked = row ? !!row.featured : false;
    barI.checked = row ? row.in_bar !== false : true;
    // une copie ne partage pas le fichier : elle repart sans image (sinon supprimer l'une effacerait l'autre)
    imgPath = row && !copy ? row.image_path || null : null;
    imgFile = null; imgDrop = false;
    showImg();
    statusEl.textContent = '';
    var docked = !!(window.CA.dockEditor && window.CA.dockEditor(editor));
    editor.hidden = false;
    if (docked) { titleI.focus({ preventScroll: true }); editor.parentNode.scrollTop = 0; return; }
    titleI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() {
    editor.hidden = true; editingId = null; imgFile = null; imgDrop = false;
    if (imgBlob) { URL.revokeObjectURL(imgBlob); imgBlob = ''; }
  }

  function uploadImg() {
    if (!imgFile) return Promise.resolve(null);
    var ext = (imgFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = 'news/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    return sb.storage.from(BUCKET).upload(path, imgFile, { cacheControl: '3600', upsert: false, contentType: imgFile.type || undefined })
      .then(function (res) { if (res.error) throw res.error; return path; });
  }

  function onSave(e) {
    e.preventDefault();
    var title = titleI.value.trim();
    if (!title) { statusEl.textContent = 'Titre requis.'; titleI.focus(); return; }
    var starts = fromDay(startI.value, false), ends = fromDay(endI.value, true);
    if (starts && ends && ends <= starts) { statusEl.textContent = 'La fin doit suivre le début.'; endI.focus(); return; }
    var oldPath = imgPath;
    saveBtn.disabled = true; statusEl.textContent = 'Enregistrement…';
    uploadImg().then(function (newPath) {
      var patch = {
        kind: kind, title: title, body: bodyI.value.trim(),
        cta_label: ctaLI.value.trim() || null, cta_url: ctaUI.value.trim() || null,
        promo_code: codeI.value.trim().toUpperCase() || null,
        event_at: kind === 'event' && eventI.value ? eventI.value : null,
        starts_at: starts, ends_at: ends,
        active: activeI.checked, featured: featI.checked, in_bar: barI.checked, proposed: false,
        image_path: newPath || (imgDrop ? null : oldPath),
        updated_at: new Date().toISOString()
      };
      // nouvelle : en tête de liste
      if (!editingId) patch.sort_order = cache.reduce(function (m, r) { return Math.min(m, r.sort_order | 0); }, 1) - 1;
      var q = editingId ? sb.from('news').update(patch).eq('id', editingId).select() : sb.from('news').insert(patch).select();
      return q.then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Enregistrement refusé (permissions).');
        var saved = res.data[0];
        // une seule vedette : les autres perdent l'étoile
        var unfeat = saved.featured ? sb.from('news').update({ featured: false }).neq('id', saved.id).eq('featured', true) : null;
        if (oldPath !== saved.image_path) removeImg(oldPath);
        return Promise.resolve(unfeat).then(function () { closeEditor(); load(); });
      }, function (err) {
        if (newPath) sb.storage.from(BUCKET).remove([newPath]).then(null, function () {});
        throw err;
      });
    }).then(null, function (err) {
      statusEl.textContent = '';
      caDialog.error(err);
    }).then(function () { saveBtn.disabled = false; });
  }

  /* ---- liste : Propositions · En ligne · Programmées · Historique ----
     Propositions = rédigées par Claude (proposed, hors ligne) : Publier / Modifier / Rejeter. */
  var GROUPS = [
    { key: 'prop', name: 'Propositions' },
    { key: 'live', name: 'En ligne' },
    { key: 'soon', name: 'Programmées' },
    { key: 'past', name: 'Historique' }
  ];
  function groupOf(r) { var s = stateOf(r); return s === 'live' || s === 'soon' || s === 'prop' ? s : 'past'; }

  function whenText(r) {
    var s = stateOf(r), a = fmtDay(r.starts_at), b = fmtDay(r.ends_at);
    if (s === 'prop') return 'Proposée par Claude · ' + fmtDay(r.created_at);
    if (s === 'soon') return 'Dès le ' + a + (b ? ' · jusqu\'au ' + b : '');
    if (s === 'done') return 'Terminée le ' + b;
    if (s === 'off') return 'Hors ligne' + (b ? ' · fin ' + b : '');
    return b ? 'Jusqu\'au ' + b : 'Sans fin';
  }

  function rowHtml(r) {
    var url = publicUrl(r.image_path), g = groupOf(r), past = g === 'past', prop = g === 'prop', fixed = past || prop;
    var tags = (r.featured ? '<span class="sp-mini is-feat">★ Vedette</span>' : '') +
      (r.in_bar ? '<span class="sp-mini">Barre du haut</span>' : '') +
      (r.promo_code ? '<span class="sp-mini nw-code">' + esc(r.promo_code) + '</span>' : '') +
      (r.kind === 'event' && r.event_at ? '<span class="sp-mini">Le ' + esc(fmtDate(r.event_at)) + '</span>' : '');
    return '<article class="nw-row' + (past ? ' is-past' : '') + (prop ? ' is-prop' : '') + '" data-id="' + esc(r.id) + '"' + (fixed ? '' : ' draggable="true"') + '>' +
      (fixed ? '' : '<span class="drag-handle" title="Glisser pour réordonner">⠿</span>') +
      '<span class="nw-thumb">' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '') + '</span>' +
      '<div class="nw-main">' +
        '<div class="nw-top"><span class="nw-kind k-' + esc(r.kind) + '">' + esc(KINDS[r.kind] || r.kind) + '</span>' +
          '<span class="nw-when">' + esc(whenText(r)) + '</span></div>' +
        '<div class="nw-title">' + esc(r.title || 'Sans titre') + '</div>' +
        (prop && r.body ? '<div class="nw-body">' + esc(r.body) + '</div>' : '') +
        (tags ? '<div class="sp-minis">' + tags + '</div>' : '') +
      '</div>' +
      '<div class="nw-actions">' + (prop ?
        '<button class="btn btn-accent btn-sm nw-pub" type="button" data-ic="check">Publier</button>' +
        '<button class="btn btn-ghost btn-sm nw-edit" type="button" data-ic="edit">Modifier</button>' +
        '<button class="btn btn-ghost btn-sm nw-del" type="button" data-ic="trash">Rejeter</button>' :
        '<button class="btn btn-ghost btn-sm nw-edit" type="button" data-ic="edit">Modifier</button>' +
        '<button class="btn btn-ghost btn-sm nw-dup" type="button" data-ic="copy">Dupliquer</button>' +
        '<button class="btn btn-ghost btn-sm nw-del" type="button" data-ic="trash">Suppr.</button>') +
      '</div>' +
    '</article>';
  }

  function render() {
    if (!cache.length) {
      listEl.innerHTML = '<p class="empty">Aucune nouvelle pour l\'instant.<br>Clique «&nbsp;Nouvelle&nbsp;» pour annoncer une promo, un événement ou une nouveauté.</p>';
      return;
    }
    listEl.innerHTML = GROUPS.map(function (g) {
      var items = cache.filter(function (r) { return groupOf(r) === g.key; });
      if (!items.length) return '';
      return '<section class="nw-group" data-g="' + g.key + '">' +
        '<h2 class="ac-ghead">' + g.name + ' <span>' + items.length + '</span></h2>' +
        '<div class="nw-rows">' + items.map(rowHtml).join('') + '</div>' +
      '</section>';
    }).join('');

    $$('.nw-row', listEl).forEach(function (el) {
      var id = el.getAttribute('data-id');
      var row = cache.filter(function (x) { return String(x.id) === id; })[0];
      $('.nw-edit', el).addEventListener('click', function () { openEditor(row); });
      var dup = $('.nw-dup', el), pub = $('.nw-pub', el);
      if (dup) dup.addEventListener('click', function () { openEditor(row, true); });
      if (pub) pub.addEventListener('click', function () { publish(row, pub); });
      $('.nw-del', el).addEventListener('click', function () { del(row); });
      if (el.hasAttribute('draggable')) wireDrag(el, row);
    });
  }

  // proposition acceptée telle quelle : en ligne (ou Programmées si sa date de début est à venir)
  function publish(row, btn) {
    btn.disabled = true;
    sb.from('news').update({ proposed: false, active: true, updated_at: new Date().toISOString() }).eq('id', row.id).select().then(function (res) {
      if (res.error) { caDialog.error(res.error); btn.disabled = false; return; }
      if (!res.data || !res.data.length) { caDialog.error('Publication refusée (permissions).'); btn.disabled = false; return; }
      if (editingId === row.id) closeEditor();
      load();
    });
  }

  function del(row) {
    var opts = row.proposed
      ? { title: 'Rejeter « ' + (row.title || 'cette proposition') + ' » ?', message: 'La proposition est supprimée.', ok: 'Rejeter', danger: true, icon: 'trash' }
      : { title: 'Supprimer « ' + (row.title || 'cette nouvelle') + ' » ?', message: 'Elle disparaît aussi de l\'historique.', ok: 'Supprimer', danger: true, icon: 'trash' };
    caDialog.confirm(opts).then(function (ok) {
      if (!ok) return;
      sb.from('news').delete().eq('id', row.id).select().then(function (res) {
        if (res.error) { caDialog.error(res.error); return; }
        if (!res.data || !res.data.length) { caDialog.error('Suppression refusée (permissions).'); return; }
        removeImg(row.image_path);
        if (editingId === row.id) closeEditor();
        load();
      });
    });
  }

  /* ---- glisser-déposer : réordonne dans En ligne / Programmées ---- */
  var dragRow = null;
  function sameGroup(a, b) { return !!(a && b) && groupOf(a) === groupOf(b); }
  function wireDrag(el, row) {
    el.addEventListener('dragstart', function (e) {
      dragRow = row; el.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', row.id); } catch (_) {} }
    });
    el.addEventListener('dragend', function () { dragRow = null; el.classList.remove('dragging'); $$('.nw-row', listEl).forEach(function (c) { c.classList.remove('drop-target'); }); });
    el.addEventListener('dragover', function (e) { if (!sameGroup(dragRow, row)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('dragenter', function () { if (dragRow !== row && sameGroup(dragRow, row)) el.classList.add('drop-target'); });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-target'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!dragRow || dragRow === row || !sameGroup(dragRow, row)) return;
      var from = cache.indexOf(dragRow), to = cache.indexOf(row);
      if (from < 0 || to < 0) return;
      cache.splice(to, 0, cache.splice(from, 1)[0]);
      render(); persistOrder();
    });
  }
  function persistOrder() {
    var updates = cache.map(function (r, i) {
      if (r.sort_order === i) return null; r.sort_order = i;
      return sb.from('news').update({ sort_order: i }).eq('id', r.id);
    }).filter(Boolean);
    if (updates.length) Promise.all(updates).then(function (all) {
      var bad = all.filter(function (res) { return res && res.error; })[0];
      if (bad) caDialog.error(bad.error);
    }, function () {});
  }
})();
