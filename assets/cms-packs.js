/* =========================================================
   Création Audio — CMS Packs (table « packs », schema-v2.sql § Packs de filament)
   Un pack = prix fixe pour N paires de recharges (ou bobines) parmi des couleurs permises :
   compositions toutes faites (presets) + « Personnaliser » au choix du client.
   Le prix n'a pas de palier ; ses unités comptent pour le palier de la marque (option B, serveur).
   Le serveur (_pack_fill) refuse un prix qui ne se divise pas au cent près et tout ce qui dépasse le stock.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = window.CA.money || function (n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' $'; };
  var fold = window.CA.fold || function (s) { return String(s || '').toLowerCase(); };
  var BUCKET = 'products';
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function slugify(s) {
    return fold(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pack';
  }
  function uid() { return Math.random().toString(36).slice(2, 8); }
  function publicUrl(path) {
    if (!path) return '';
    if (/^assets\//.test(path)) return path;
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }

  var listEl = $('#pk-list'), editor = $('#pk-editor');
  if (!listEl || !editor) return;
  var nameI = $('#pk-name'), nameEnI = $('#pk-name-en'), noteI = $('#pk-note'), noteEnI = $('#pk-note-en'),
      kindSeg = $('#pk-kind'), pairsI = $('#pk-pairs'), priceI = $('#pk-price'), calcEl = $('#pk-calc'),
      customI = $('#pk-custom'), featI = $('#pk-featured'), qI = $('#pk-q'), colorsEl = $('#pk-colors'),
      presetsEl = $('#pk-presets'), photoEl = $('#pk-photo'), fileI = $('#pk-file'),
      saveBtn = $('#pk-save'), statusEl = $('#pk-status');

  var packs = [], fils = [], byId = {}, matOrder = {}, brandOrder = {}, mats = {};
  var loaded = false, editingId = null;
  var st = null;                      // état de l'éditeur
  var imgFile = null, imgBlob = '';

  /* ---------- données ---------- */
  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return Promise.all([
      sb.from('packs').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('products').select('*').eq('type', 'filament').eq('active', true),
      sb.from('materials').select('*'),
      sb.from('brands').select('name,sort_order')
    ]).then(function (r) {
      var bad = r.filter(function (x) { return x.error; })[0];
      if (bad) { listEl.innerHTML = '<p class="empty">Impossible de charger les packs.<br>' + esc(bad.error.message || bad.error) + '</p>'; return; }
      packs = r[0].data || [];
      mats = {}; matOrder = {}; brandOrder = {};
      (r[2].data || []).forEach(function (m, i) { mats[m.brand + '|' + m.name] = m; matOrder[m.brand + '|' + m.name] = m.sort_order != null ? m.sort_order : i; });
      (r[3].data || []).forEach(function (b, i) { brandOrder[b.name] = b.sort_order != null ? b.sort_order : i; });
      fils = (r[1].data || []).slice().sort(filCmp);
      byId = {}; fils.forEach(function (p) { byId[p.id] = p; });
      loaded = true;
      render();
    });
  }
  // ordre de la section Filaments : marque → matériau → couleur
  function filCmp(a, b) {
    function bo(p) { return brandOrder[p.brand] != null ? brandOrder[p.brand] : 999; }
    function mo(p) { var k = p.brand + '|' + p.material; return matOrder[k] != null ? matOrder[k] : 999; }
    return (bo(a) - bo(b)) || (mo(a) - mo(b)) || ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.name).localeCompare(String(b.name));
  }
  function offers(p, kind) { return kind === 'refill' ? p.offer_refill !== false : p.offer_spool !== false; }
  function stockOf(p, kind) { return Math.max(0, (kind === 'refill' ? p.qty_2 : p.qty) || 0); }
  function regPrice(p, kind) {
    var m = mats[p.brand + '|' + p.material];
    return num(kind === 'refill' ? (m ? m.sell_refill : p.sell_price_2) : (m ? m.sell_spool : p.sell_price));
  }
  function costOf(p, kind) {
    var C = window.CA.costing;
    return C && C.costOf ? C.costOf(p, kind, fils) : null;
  }
  function dot(p) { return '<i class="pm-dot" style="background:' + esc(p && p.hex || '#ccc') + '"></i>'; }
  function unitWord(kind, n) { return kind === 'spool' ? (n > 1 ? 'bobines' : 'bobine') : (n > 1 ? 'recharges' : 'recharge'); }

  // packs possibles avec le stock pour une composition { pid: paires }
  function possible(lines, kind) {
    var best = Infinity, any = false;
    Object.keys(lines).forEach(function (pid) {
      var n = lines[pid] * 2; if (!n) return; any = true;
      var p = byId[pid]; best = Math.min(best, p ? Math.floor(stockOf(p, kind) / n) : 0);
    });
    return any ? best : 0;
  }
  function linesObj(pr) {
    var o = {}; (pr.lines || []).forEach(function (l) { if (l && l.p && l.n > 0) o[l.p] = (o[l.p] || 0) + (+l.n); }); return o;
  }

  /* ---------- liste ---------- */
  function render() {
    if (!packs.length) { listEl.innerHTML = '<p class="empty">Aucun pack. Crée le premier avec « Pack ».</p>'; return; }
    listEl.innerHTML = packs.map(function (pk) {
      var units = pk.pairs * 2, unit = r2(pk.price / units);
      var cols = (pk.colors || []).map(function (id) { return byId[id]; }).filter(Boolean).sort(filCmp);
      var pres = (pk.presets || []).map(function (pr) {
        var n = possible(linesObj(pr), pk.kind);
        return '<span class="pk-pre' + (n ? '' : ' is-out') + '">' + esc(pr.name || 'Sans nom') + ' <em>' + (n ? n + ' en stock' : 'Épuisé') + '</em></span>';
      }).join('');
      var img = pk.image_path ? '<img src="' + esc(publicUrl(pk.image_path)) + '" alt="">' : spoolsSvg(cols.slice(0, 4));
      return '<article class="pk-row' + (pk.enabled ? '' : ' is-off') + '" data-id="' + esc(pk.id) + '" draggable="true">' +
        '<div class="pk-thumb">' + img + '</div>' +
        '<div class="pm-main">' +
          '<div class="pm-top"><b class="pm-title">' + esc(pk.name) + '</b>' +
            '<span class="pm-state' + (pk.enabled ? ' s-on' : '') + '">' + (pk.enabled ? 'En ligne' : 'Hors ligne') + '</span>' +
            (pk.featured ? '<span class="pm-tag">En haut de Filaments</span>' : '') + '</div>' +
          '<div class="pm-meta">' + money(+pk.price) + ' · ' + units + ' ' + unitWord(pk.kind, units) + ' · ' + money(unit) + ' l\'unité' +
            (pk.allow_custom ? ' · personnalisable' : '') + '</div>' +
          '<div class="pk-cols">' + cols.map(function (p) { return '<span class="pk-col">' + dot(p) + esc(p.name) + '</span>'; }).join('') + '</div>' +
          (pres ? '<div class="pk-pres">' + pres + '</div>' : '') +
        '</div>' +
        '<div class="pm-acts">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-a="edit">Modifier</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-a="toggle">' + (pk.enabled ? 'Retirer' : 'Mettre en ligne') + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-a="del" data-ic="trash" aria-label="Supprimer"></button>' +
        '</div></article>';
    }).join('');
    $$('.pk-row', listEl).forEach(wireDrag);
  }
  // bobines dessinées (même dessin que la boutique, en petit)
  function spoolsSvg(cols) {
    if (!cols.length) return '';
    var w = 22, out = cols.map(function (p, i) {
      var x = 4 + i * w, c = esc(p.hex || '#ccc');
      return '<g transform="translate(' + x + ',6)"><rect x="0" y="0" width="18" height="36" rx="5" fill="' + c + '" stroke="rgba(0,0,0,.25)"/>' +
        '<rect x="0" y="15" width="18" height="6" fill="rgba(0,0,0,.12)"/></g>';
    }).join('');
    return '<svg viewBox="0 0 ' + (8 + cols.length * w) + ' 48" aria-hidden="true">' + out + '</svg>';
  }

  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var row = b.closest('.pk-row'), pk = packs.filter(function (x) { return x.id === row.getAttribute('data-id'); })[0];
    if (!pk) return;
    var a = b.getAttribute('data-a');
    if (a === 'edit') openEditor(pk);
    else if (a === 'toggle') {
      var on = !pk.enabled;
      var go = on && !(pk.presets || []).some(function (pr) { return possible(linesObj(pr), pk.kind) > 0; }) && !pk.allow_custom
        ? caDialog.confirm({ title: 'Aucune composition en stock', message: 'Le pack s\'affichera « Épuisé ».', ok: 'Mettre en ligne', cancel: 'Annuler' })
        : Promise.resolve(true);
      go.then(function (ok) {
        if (!ok) return;
        sb.from('packs').update({ enabled: on, updated_at: new Date().toISOString() }).eq('id', pk.id).select().then(function (res) {
          if (res.error) { caDialog.error(res.error); return; }
          if (!res.data || !res.data.length) { caDialog.error('Enregistrement refusé (permissions).'); return; }
          pk.enabled = on; render();
        });
      });
    } else if (a === 'del') {
      caDialog.confirm({ title: 'Supprimer ce pack ?', message: pk.name + ' — les commandes passées gardent leurs lignes.', ok: 'Supprimer', cancel: 'Annuler', danger: true }).then(function (ok) {
        if (!ok) return;
        sb.from('packs').delete().eq('id', pk.id).select().then(function (res) {
          if (res.error) { caDialog.error(res.error); return; }
          if (!res.data || !res.data.length) { caDialog.error('Suppression refusée (permissions).'); return; }
          if (pk.image_path && !/^assets\//.test(pk.image_path)) sb.storage.from(BUCKET).remove([pk.image_path]).then(null, function () {});
          if (editingId === pk.id) closeEditor();
          packs = packs.filter(function (x) { return x.id !== pk.id; }); render();
        });
      });
    }
  });

  /* ---------- glisser-déposer (ordre des packs) ---------- */
  var dragRow = null;
  function wireDrag(el) {
    el.addEventListener('dragstart', function (e) {
      if (e.target.closest && e.target.closest('button, input')) { e.preventDefault(); return; }
      dragRow = el; el.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', el.getAttribute('data-id')); } catch (_) {} }
    });
    el.addEventListener('dragend', function () { dragRow = null; el.classList.remove('dragging'); $$('.pk-row', listEl).forEach(function (c) { c.classList.remove('drop-target'); }); });
    el.addEventListener('dragover', function (e) { if (!dragRow) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('dragenter', function () { if (dragRow && dragRow !== el) el.classList.add('drop-target'); });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-target'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!dragRow || dragRow === el) return;
      var ids = packs.map(function (p) { return p.id; });
      var from = ids.indexOf(dragRow.getAttribute('data-id')), to = ids.indexOf(el.getAttribute('data-id'));
      if (from < 0 || to < 0) return;
      packs.splice(to, 0, packs.splice(from, 1)[0]);
      render();
      var ups = packs.map(function (p, i) {
        if (p.sort_order === i) return null; p.sort_order = i;
        return sb.from('packs').update({ sort_order: i }).eq('id', p.id);
      }).filter(Boolean);
      if (ups.length) Promise.all(ups).then(function (all) {
        var bad = all.filter(function (res) { return res && res.error; })[0];
        if (bad) caDialog.error(bad.error);
      }, function () {});
    });
  }

  /* ---------- éditeur ---------- */
  function setKind(k) {
    st.kind = k === 'spool' ? 'spool' : 'refill';
    $$('.fx-seg-btn', kindSeg).forEach(function (b) {
      var on = b.getAttribute('data-kind') === st.kind;
      b.classList.toggle('is-active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  function openEditor(pk) {
    if (!loaded) return;
    editingId = pk ? pk.id : null;
    $('#pk-editor-title').textContent = pk ? 'Modifier le pack' : 'Nouveau pack';
    nameI.value = pk ? pk.name || '' : '';
    nameEnI.value = pk ? pk.name_en || '' : '';
    noteI.value = pk ? pk.note || '' : '';
    noteEnI.value = pk ? pk.note_en || '' : '';
    pairsI.value = pk ? pk.pairs : 2;
    priceI.value = pk ? +pk.price : '';
    customI.checked = pk ? pk.allow_custom : true;
    featI.checked = pk ? pk.featured : true;
    st = {
      kind: 'refill',
      colors: pk ? (pk.colors || []).filter(function (id) { return byId[id]; }) : [],
      presets: pk ? (pk.presets || []).map(function (pr) { return { id: pr.id || uid(), name: pr.name || '', name_en: pr.name_en || '', lines: linesObj(pr) }; }) : [],
      image: pk ? pk.image_path || null : null
    };
    setKind(pk ? pk.kind : 'refill');
    syncCustom();
    imgFile = null; if (imgBlob) { URL.revokeObjectURL(imgBlob); imgBlob = ''; }
    qI.value = ''; statusEl.textContent = '';
    renderColors(); renderPresets(); renderCalc(); renderPhoto();
    var docked = !!(window.CA.dockEditor && window.CA.dockEditor(editor));
    editor.hidden = false;
    if (docked) { nameI.focus({ preventScroll: true }); editor.parentNode.scrollTop = 0; return; }
    nameI.focus();
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() {
    editor.hidden = true; editingId = null; imgFile = null;
    if (imgBlob) { URL.revokeObjectURL(imgBlob); imgBlob = ''; }
  }

  function pairsVal() { var n = parseInt(pairsI.value, 10); return isFinite(n) ? Math.max(1, Math.min(10, n)) : 2; }
  function renderCalc() {
    var price = num(priceI.value), units = pairsVal() * 2;
    if (price == null || price <= 0) { calcEl.innerHTML = '<span class="muted">—</span>'; return; }
    var unit = r2(price / units), exact = Math.abs(unit * units - price) < 0.001;
    var cols = st.colors.map(function (id) { return byId[id]; }).filter(Boolean);
    var costs = cols.map(function (p) { return costOf(p, st.kind); }).filter(function (c) { return c != null; });
    var cost = costs.length ? costs.reduce(function (s, c) { return s + c; }, 0) / costs.length : null;
    var regs = cols.map(function (p) { return regPrice(p, st.kind); }).filter(function (c) { return c != null; });
    var reg = regs.length ? Math.min.apply(null, regs) : null;
    var h = '<b>' + money(unit) + '</b> la ' + (st.kind === 'spool' ? 'bobine' : 'recharge');
    if (!exact) h += ' · <span class="neg">ne tombe pas au cent près</span>';
    if (reg != null && unit < reg) h += ' · −' + Math.round((1 - unit / reg) * 100) + ' %';
    if (cost != null) {
      var m = (unit - cost) / unit * 100;
      h += ' · <span class="' + (m < 0 ? 'neg' : 'pos') + '">Marge ' + Math.round(m) + ' % (' + money(r2((unit - cost) * units)) + ')</span>';
    }
    calcEl.innerHTML = h;
  }

  // « Personnaliser » : noir et blanc seulement (règle de Théo, 2026-11-16) — une couleur => compositions fixes
  function bwOnly() {
    return st.colors.every(function (id) { var p = byId[id]; return !p || /^#(000000|FFFFFF)$/i.test(p.hex || ''); });
  }
  function syncCustom() {
    var ok = bwOnly();
    customI.disabled = !ok;
    if (!ok) customI.checked = false;
    customI.parentNode.title = ok ? '' : 'Noir et blanc seulement';
  }
  function renderColors() {
    var q = fold(qI.value.trim()), sel = {};
    st.colors.forEach(function (id) { sel[id] = true; });
    var list = fils.filter(function (p) { return offers(p, st.kind) || sel[p.id]; })
      .filter(function (p) { return !q || sel[p.id] || fold([p.name, p.brand, p.material].join(' ')).indexOf(q) >= 0; });
    var groups = [], map = {};
    list.forEach(function (p) {
      var k = (p.brand || '') + '|' + (p.material || '');
      if (!map[k]) { map[k] = { label: [p.brand, p.material].filter(Boolean).join(' · '), items: [] }; groups.push(map[k]); }
      map[k].items.push(p);
    });
    colorsEl.innerHTML = groups.map(function (g) {
      return '<div class="pk-cg"><div class="pk-cgl">' + esc(g.label) + '</div><div class="pk-chips">' + g.items.map(function (p) {
        var s = stockOf(p, st.kind);
        return '<button type="button" class="pk-chip' + (sel[p.id] ? ' is-on' : '') + '" data-c="' + esc(p.id) + '" aria-pressed="' + (sel[p.id] ? 'true' : 'false') + '">' +
          dot(p) + '<span>' + esc(p.name) + '</span><em>' + s + '</em></button>';
      }).join('') + '</div></div>';
    }).join('') || '<p class="muted">Aucune couleur.</p>';
  }
  colorsEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-c]'); if (!b) return;
    var id = b.getAttribute('data-c'), i = st.colors.indexOf(id);
    if (i >= 0) {
      st.colors.splice(i, 1);
      st.presets.forEach(function (pr) { delete pr.lines[id]; });
    } else st.colors.push(id);
    st.colors.sort(function (a, b2) { return filCmp(byId[a], byId[b2]); });
    syncCustom(); renderColors(); renderPresets(); renderCalc();
  });
  qI.addEventListener('input', renderColors);

  function renderPresets() {
    var pairs = pairsVal(), cols = st.colors.map(function (id) { return byId[id]; }).filter(Boolean);
    if (!st.presets.length) { presetsEl.innerHTML = '<p class="muted">Aucune composition.</p>'; return; }
    presetsEl.innerHTML = st.presets.map(function (pr, i) {
      var tot = Object.keys(pr.lines).reduce(function (s, k) { return s + (pr.lines[k] || 0); }, 0);
      var n = possible(pr.lines, st.kind);
      return '<div class="pk-pc" data-i="' + i + '" draggable="true">' +
        '<div class="pk-pch">' +
          '<input type="text" data-f="name" value="' + esc(pr.name) + '" placeholder="Nom (ex. 4 noires)" maxlength="40" aria-label="Nom">' +
          '<input type="text" data-f="name_en" value="' + esc(pr.name_en) + '" placeholder="Anglais (ex. 4 black)" maxlength="40" aria-label="Nom en anglais">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-pdel="' + i + '" data-ic="trash" aria-label="Retirer"></button>' +
        '</div>' +
        '<div class="pk-steps">' + (cols.length ? cols.map(function (p) {
          var v = pr.lines[p.id] || 0;
          return '<div class="pk-step' + (v ? ' is-on' : '') + '">' + dot(p) + '<span>' + esc(p.name) + '</span>' +
            '<button type="button" data-st="-1" data-p="' + esc(p.id) + '" aria-label="Moins">−</button>' +
            '<b>' + v * 2 + '</b>' +
            '<button type="button" data-st="1" data-p="' + esc(p.id) + '" aria-label="Plus">+</button></div>';
        }).join('') : '<p class="muted">Choisis d\'abord les couleurs.</p>') + '</div>' +
        '<div class="pk-pcf"><span class="' + (tot === pairs ? 'pos' : 'neg') + '">' + tot * 2 + ' / ' + pairs * 2 + '</span>' +
          (tot === pairs ? ' · ' + (n ? n + ' en stock' : 'Épuisé') : '') + '</div>' +
      '</div>';
    }).join('');
    wirePresetDrag();
  }
  presetsEl.addEventListener('input', function (e) {
    var t = e.target, c = t.closest('.pk-pc'); if (!c || !t.getAttribute('data-f')) return;
    st.presets[+c.getAttribute('data-i')][t.getAttribute('data-f')] = t.value;
  });
  presetsEl.addEventListener('click', function (e) {
    var del = e.target.closest('[data-pdel]'), stp = e.target.closest('[data-st]');
    if (del) { st.presets.splice(+del.getAttribute('data-pdel'), 1); renderPresets(); return; }
    if (stp) {
      var pr = st.presets[+stp.closest('.pk-pc').getAttribute('data-i')], pid = stp.getAttribute('data-p');
      var tot = Object.keys(pr.lines).reduce(function (s, k) { return s + (pr.lines[k] || 0); }, 0);
      var d = +stp.getAttribute('data-st'), v = (pr.lines[pid] || 0) + d;
      if (v < 0 || (d > 0 && tot >= pairsVal())) return;
      if (v) pr.lines[pid] = v; else delete pr.lines[pid];
      renderPresets();
    }
  });
  var dragPc = null;
  function wirePresetDrag() {
    $$('.pk-pc', presetsEl).forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        if (e.target.closest && e.target.closest('input, button')) { e.preventDefault(); return; }
        dragPc = el; el.classList.add('dragging');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'p'); } catch (_) {} }
      });
      el.addEventListener('dragend', function () { dragPc = null; el.classList.remove('dragging'); });
      el.addEventListener('dragover', function (e) { if (dragPc) e.preventDefault(); });
      el.addEventListener('drop', function (e) {
        e.preventDefault(); if (!dragPc || dragPc === el) return;
        var from = +dragPc.getAttribute('data-i'), to = +el.getAttribute('data-i');
        st.presets.splice(to, 0, st.presets.splice(from, 1)[0]);
        renderPresets();
      });
    });
  }
  $('#pk-preset-add').addEventListener('click', function () {
    st.presets.push({ id: uid(), name: '', name_en: '', lines: {} });
    renderPresets();
    var last = presetsEl.lastElementChild, inp = last && $('input', last);
    if (inp) inp.focus();
  });

  /* ---------- photo facultative ---------- */
  function renderPhoto() {
    var src = imgBlob || (st.image ? publicUrl(st.image) : '');
    photoEl.innerHTML = (src ? '<img src="' + esc(src) + '" alt="">' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" data-ph="pick" data-ic="plus">' + (src ? 'Changer' : 'Ajouter') + '</button>' +
      (src ? '<button type="button" class="btn btn-ghost btn-sm" data-ph="del" data-ic="trash">Retirer</button>' : '') +
      (src ? '' : '<span class="muted">Sinon, bobines dessinées.</span>');
  }
  photoEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ph]'); if (!b) return;
    if (b.getAttribute('data-ph') === 'pick') fileI.click();
    else { imgFile = null; if (imgBlob) { URL.revokeObjectURL(imgBlob); imgBlob = ''; } st.image = null; renderPhoto(); }
  });
  fileI.addEventListener('change', function () {
    var f = fileI.files && fileI.files[0]; fileI.value = '';
    if (!f) return;
    imgFile = f; if (imgBlob) URL.revokeObjectURL(imgBlob); imgBlob = URL.createObjectURL(f);
    renderPhoto();
  });
  function uploadImg() {
    if (!imgFile) return Promise.resolve(null);
    var ext = (imgFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = 'packs/' + Date.now() + '-' + uid() + '.' + ext;
    return sb.storage.from(BUCKET).upload(path, imgFile, { cacheControl: '3600', upsert: false, contentType: imgFile.type || undefined })
      .then(function (res) { if (res.error) throw res.error; return path; });
  }

  [pairsI, priceI].forEach(function (el) { el.addEventListener('input', function () { renderCalc(); if (el === pairsI) renderPresets(); }); });
  kindSeg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-kind]'); if (!b) return;
    setKind(b.getAttribute('data-kind')); renderColors(); renderPresets(); renderCalc();
  });

  /* ---------- enregistrement ---------- */
  editor.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = nameI.value.trim(), price = num(priceI.value), pairs = pairsVal(), units = pairs * 2;
    if (!name) { statusEl.textContent = 'Nom requis.'; nameI.focus(); return; }
    if (price == null || price <= 0) { statusEl.textContent = 'Prix requis.'; priceI.focus(); return; }
    price = r2(price);
    if (Math.abs(r2(price / units) * units - price) > 0.001) { statusEl.textContent = 'Le prix doit se diviser au cent près par ' + units + '.'; priceI.focus(); return; }
    if (!st.colors.length) { statusEl.textContent = 'Choisis au moins une couleur.'; return; }
    var presets = st.presets.map(function (pr) {
      return { id: pr.id, name: pr.name.trim(), name_en: pr.name_en.trim() || null,
        lines: st.colors.filter(function (id) { return pr.lines[id] > 0; }).map(function (id) { return { p: id, n: pr.lines[id] }; }) };
    });
    for (var i = 0; i < presets.length; i++) {
      var tot = presets[i].lines.reduce(function (s, l) { return s + l.n; }, 0);
      if (!presets[i].name) { statusEl.textContent = 'Nomme chaque composition.'; return; }
      if (tot !== pairs) { statusEl.textContent = '« ' + presets[i].name + ' » doit compter ' + units + ' unités.'; return; }
    }
    if (!presets.length && !customI.checked) { statusEl.textContent = 'Ajoute une composition ou permets « Personnaliser ».'; return; }
    var cols = st.colors.map(function (id) { return byId[id]; });
    var below = cols.filter(function (p) { var c = costOf(p, st.kind); return c != null && r2(price / units) < c; }).map(function (p) { return p.name; });
    var go = below.length
      ? caDialog.confirm({ title: 'Prix sous le coût', message: below.join(', ') + ' se vendraient sous le coût moyen.', ok: 'Enregistrer quand même', cancel: 'Corriger', danger: true })
      : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      var old = editingId ? packs.filter(function (x) { return x.id === editingId; })[0] : null;
      var row = {
        name: name, name_en: nameEnI.value.trim() || null, note: noteI.value.trim() || null, note_en: noteEnI.value.trim() || null,
        kind: st.kind, pairs: pairs, price: price, colors: st.colors.slice(), presets: presets,
        allow_custom: customI.checked && bwOnly(), featured: featI.checked, updated_at: new Date().toISOString()
      };
      if (!old) {
        var base = slugify(name), slug = base, n = 2, taken = packs.map(function (x) { return x.slug; });
        while (taken.indexOf(slug) >= 0) slug = base + '-' + (n++);
        row.slug = slug; row.enabled = false; row.sort_order = packs.length;
      }
      saveBtn.disabled = true; statusEl.textContent = 'Enregistrement…';
      var oldImg = old ? old.image_path : null;
      uploadImg().then(function (path) {
        row.image_path = path || st.image || null;
        return old
          ? sb.from('packs').update(row).eq('id', old.id).select().then(function (r) { if (r.error) throw r.error; if (!r.data || !r.data.length) throw new Error('Enregistrement refusé (permissions).'); return r.data[0]; })
          : sb.from('packs').insert(row).select().then(function (r) { if (r.error) throw r.error; return r.data[0]; });
      }).then(function (saved) {
        if (oldImg && oldImg !== saved.image_path && !/^assets\//.test(oldImg)) sb.storage.from(BUCKET).remove([oldImg]).then(null, function () {});
        closeEditor(); return load();
      }).catch(function (err) { caDialog.error(err); })
        .then(function () { saveBtn.disabled = false; statusEl.textContent = ''; });
    });
  });

  $('#pk-new').addEventListener('click', function () { openEditor(null); });
  $('#pk-refresh').addEventListener('click', load);
  $('#pk-cancel').addEventListener('click', closeEditor);

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'packs') load();
  };
})();
