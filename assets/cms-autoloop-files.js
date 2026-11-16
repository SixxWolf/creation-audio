/* =========================================================
   Création Audio — AutoLoop › Fichiers
   Bibliothèque des plateaux d'UN loop (bucket privé « autoloop » + table autoloop_plates) :
   une carte par spacer (photo), ses versions empilées (vignette du plateau + infos lues
   dans le fichier). Glisser-déposer (souris + tactile) pour l'ordre des cartes et des
   versions ; la version du haut sans étiquette client = celle par défaut.
   Expose window.ALFiles (lu par cms-autoloop.js pour le menu du Générateur).
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var BUCKET = 'autoloop', CARDS_KEY = 'autoloop_cards', META_V = 1;
  var rows = [], spacers = [], dealers = [], customers = [], cardOrder = [], loaded = false, listeners = [];

  function sb() { return window.CA && window.CA.sb; }
  function toast(m, k) { if (window.caDialog) caDialog.toast(m, k); }
  function errMsg(e) { return e && e.message ? e.message : String(e); }

  /* ------------------------------------------------------------------ */
  /*  Lecture du fichier : en-tête + CONFIG_BLOCK du gcode, slice_info,  */
  /*  vignette du plateau (plate_N_small.png)                            */
  /* ------------------------------------------------------------------ */
  var dec = new TextDecoder('utf-8');
  function minOf(s) {   // « 1h 31m 51s » / « 1d 2h 3m » -> minutes
    if (!s) return 0;
    var d = /([\d.]+)\s*d/i.exec(s), h = /([\d.]+)\s*h/i.exec(s), m = /([\d.]+)\s*m(?!s)/i.exec(s), sec = /([\d.]+)\s*s/i.exec(s);
    return (d ? +d[1] * 1440 : 0) + (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (sec ? +sec[1] / 60 : 0);
  }
  function b64(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function parseMeta(u8) {
    var txt, slice = '', png = null, plates = 1, pn = 1;
    if (window.ALProject && ALProject.isZip(u8)) {
      var ents = window.fflate.unzipSync(u8, { filter: function (f) {
        return /^Metadata\/(plate_\d+\.gcode|slice_info\.config|plate_\d+(_small)?\.png)$/.test(f.name);
      } });
      var gs = Object.keys(ents).filter(function (n) { return /\.gcode$/.test(n); })
        .sort(function (a, b) { return +/(\d+)/.exec(a)[1] - +/(\d+)/.exec(b)[1]; });
      if (!gs.length) throw new Error('Ce .3mf ne contient pas de plateau tranché (Bambu Studio › Exporter le fichier tranché du plateau).');
      plates = gs.length; pn = +/plate_(\d+)/.exec(gs[0])[1];
      txt = dec.decode(ents[gs[0]].subarray(0, 700000));
      if (ents['Metadata/slice_info.config']) slice = dec.decode(ents['Metadata/slice_info.config']);
      png = ents['Metadata/plate_' + pn + '_small.png'] || null;
      var big = ents['Metadata/plate_' + pn + '.png'];
      if (!png && big && big.length < 60000) png = big;
    } else {
      txt = dec.decode(u8.subarray(0, 700000));
    }
    if (txt.indexOf('Batch généré par AutoLoop') !== -1) throw new Error('Ce fichier est déjà un batch AutoLoop : envoie le fichier d\'un seul loop.');
    if (!/G1|G0/.test(txt)) throw new Error('Gcode illisible.');

    var cfg = {}, cb = /; CONFIG_BLOCK_START([\s\S]*?); CONFIG_BLOCK_END/.exec(txt);
    (cb ? cb[1] : txt.slice(0, 200000)).replace(/^; ([a-z0-9_]+) = (.*)$/gm, function (m, k, v) { cfg[k] = v.trim(); return m; });
    function c(k) { return cfg[k] != null ? cfg[k] : ''; }
    function c0(k) { return c(k).split(/[;,]/)[0].replace(/^"|"$/g, '').trim(); }
    function cn(k) { var v = parseFloat(c0(k)); return isFinite(v) ? v : null; }
    function hd(re) { var m = re.exec(txt); return m ? m[1].trim() : ''; }

    var m = { v: META_V, plates: plates };
    var st = /^; (BambuStudio|OrcaSlicer)\s+([\d.]+)/m.exec(txt);
    if (st) m.studio = st[1] + ' ' + st[2];
    m.layers = +hd(/total layer number:\s*(\d+)/) || null;
    m.maxz = parseFloat(hd(/max_z_height:\s*([\d.]+)/)) || null;
    m.min = Math.round(minOf(hd(/total estimated time:\s*([^;\r\n]+)/))) || null;
    m.modelMin = Math.round(minOf(hd(/model printing time:\s*([^;\r\n]+)/))) || null;

    // filaments utilisés : slice_info (seulement ceux du plateau), sinon l'en-tête du gcode
    var types = c('filament_type').split(';'), cols = c('filament_colour').split(';'),
        vend = c('filament_vendor').split(';'), prof = c('filament_settings_id').split(';');
    function fil(i, g, type, hex) {
      return { type: (type || types[i] || '').trim(), hex: (hex || cols[i] || '').trim(), g: Math.round(g * 100) / 100,
        vendor: (vend[i] || '').replace(/"/g, '').trim(), profile: (prof[i] || '').replace(/"/g, '').trim() };
    }
    m.fil = [];
    var blk = '';
    slice.replace(/<plate>[\s\S]*?<\/plate>/g, function (b) { var ix = /key="index" value="(\d+)"/.exec(b); if (!blk || (ix && +ix[1] === pn)) blk = b; return b; });
    if (blk) {
      blk.replace(/<filament ([^>]*)\/>/g, function (t, attrs) {
        var a = {}; attrs.replace(/(\w+)="([^"]*)"/g, function (x, k, v) { a[k] = v; return x; });
        var g = parseFloat(a.used_g) || 0;
        if (g > 0) m.fil.push(fil((+a.id || 1) - 1, g, a.type, a.color));
        return t;
      });
      m.pieces = (blk.match(/<object [^>]*skipped="false"/g) || blk.match(/<object /g) || []).length || null;
      var pred = /key="prediction" value="(\d+)"/.exec(blk);
      if (!m.min && pred) m.min = Math.round(+pred[1] / 60);
    }
    if (!m.fil.length) {
      var ws = hd(/total filament weight \[g\]\s*:\s*([\d.,\s]+)/).split(',');
      var slots = hd(/^; filament:\s*([\d,\s]+)$/m).split(',');
      ws.forEach(function (w, i) { var g = parseFloat(w) || 0; if (g > 0) { var s = +slots[i] || i + 1; m.fil.push(fil(s - 1, g)); } });
    }
    m.g = Math.round(m.fil.reduce(function (s, f) { return s + f.g; }, 0) * 100) / 100 || null;

    m.walls = cn('wall_loops');
    m.infill = c0('sparse_infill_density').replace('%', '');
    m.pattern = c0('sparse_infill_pattern');
    m.lh = cn('layer_height'); m.lh0 = cn('initial_layer_print_height');
    m.top = cn('top_shell_layers'); m.bottom = cn('bottom_shell_layers');
    m.nozzle = cn('nozzle_diameter'); m.lineW = cn('line_width');
    m.wallGen = c0('wall_generator'); m.seam = c0('seam_position');
    m.topPat = c0('top_surface_pattern'); m.botPat = c0('bottom_surface_pattern');
    m.support = c0('enable_support') === '1' ? (c0('support_type') || 'oui') : '';
    m.brim = c0('brim_type'); m.brimW = cn('brim_width');
    m.ironing = c0('ironing_type'); m.prime = c0('enable_prime_tower') === '1';
    m.tNoz = cn('nozzle_temperature'); m.tNoz0 = cn('nozzle_temperature_initial_layer');
    m.plate = c0('curr_bed_type');
    var bedKey = { 'Textured PEI Plate': 'textured_plate_temp', 'Cool Plate': 'cool_plate_temp', 'Engineering Plate': 'eng_plate_temp',
      'High Temp Plate': 'hot_plate_temp', 'Smooth PEI Plate': 'hot_plate_temp', 'Supertack Plate': 'supertack_plate_temp' }[m.plate] || 'hot_plate_temp';
    m.tBed = cn(bedKey);
    m.sOuter = cn('outer_wall_speed'); m.sInner = cn('inner_wall_speed'); m.sInfill = cn('sparse_infill_speed');
    m.sFirst = cn('initial_layer_speed'); m.sTravel = cn('travel_speed');
    m.profile = c0('print_settings_id'); m.printer = c0('printer_settings_id');
    if (png) m.thumb = 'data:image/png;base64,' + b64(png);
    return m;
  }

  /* ------------------------------------------------------------------ */
  /*  Données                                                            */
  /* ------------------------------------------------------------------ */
  function spacerById(id) { return spacers.filter(function (s) { return String(s.id) === String(id); })[0] || null; }
  function rowById(id) { return rows.filter(function (r) { return r.id === id; })[0] || null; }
  function refsOf(sp) {
    var a = (sp && sp.attrs) || {};
    return ((a.replaces || []).map(function (r) { return r && r.ref; })).concat(a.aliases || []).filter(Boolean);
  }
  function imgOf(sp) {
    if (!sp || !sp.image_path || !sb()) return '';
    try { return sb().storage.from('products').getPublicUrl(sp.image_path).data.publicUrl; } catch (e) { return ''; }
  }
  function norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  // même règle que Production : code maison, n° remplacés, anciens noms (le plus long qui apparaît dans le nom)
  function detectSpacer(name) {
    var fn = norm(name), best = null, bestLen = 0;
    spacers.forEach(function (sp) {
      [sp.name, sp.slug].concat(refsOf(sp)).forEach(function (cand) {
        var n = norm(cand);
        if (n.length >= 4 && n.length > bestLen && fn.indexOf(n) !== -1) { best = sp; bestLen = n.length; }
      });
    });
    return best;
  }
  // un spacer choisi à la main pour un nom de fichier reste lié aux prochains envois du même nom (sans n° de version)
  function stem(name) { return norm(String(name || '').replace(/(\.gcode)?\.3mf$|\.gcode$/i, '').replace(/\b(v?\d+([.,]\d+)*)\b/gi, '')); }
  function guessFor(fileName) {
    var sp = detectSpacer(fileName);
    if (sp) return sp;
    var st = stem(fileName), hit = st.length >= 3 && rows.filter(function (r) { return r.spacer_id && stem(r.file_name) === st; })[0];
    return hit ? spacerById(hit.spacer_id) : null;
  }
  function versionsOf(spId) {
    return rows.filter(function (r) { return String(r.spacer_id || '') === String(spId || ''); })
      .sort(function (a, b) { return (a.sort - b.sort) || (a.created_at < b.created_at ? 1 : -1); });
  }
  function defaultOf(spId) {
    var v = versionsOf(spId);
    return v.filter(function (r) { return !r.client; })[0] || v[0] || null;
  }
  // spacers qui ont des fichiers, dans l'ordre des cartes (puis l'ordre de l'admin)
  function cards() {
    var ids = [];
    rows.forEach(function (r) { if (r.spacer_id && spacerById(r.spacer_id) && ids.indexOf(String(r.spacer_id)) === -1) ids.push(String(r.spacer_id)); });
    function rank(id) { var i = cardOrder.indexOf(id); return i === -1 ? 1e6 + ((spacerById(id) || {}).sort_order | 0) : i; }
    return ids.sort(function (a, b) { return rank(a) - rank(b); });
  }
  function spLabel(sp) { var r = refsOf(sp); return sp ? sp.name + (r.length ? ' · ' + r.join(', ') : '') : ''; }
  function clientLabel(c) { return c ? c.label : ''; }

  function load() {
    var s = sb(); if (!s) return Promise.resolve();
    return Promise.all([
      s.from('autoloop_plates').select('*'),
      s.from('products').select('id,name,slug,image_path,attrs,sort_order,active').eq('type', 'spacer').order('sort_order'),
      s.from('dealers').select('email,name'),
      s.from('customers').select('id,email,name,first_name,last_name,company'),
      s.from('admin_settings').select('value').eq('key', CARDS_KEY).maybeSingle()
    ]).then(function (res) {
      if (res[0].error) { toast('Fichiers : ' + res[0].error.message, 'bad'); return; }
      rows = res[0].data || [];
      spacers = res[1].data || [];
      dealers = res[2].data || [];
      customers = res[3].data || [];
      cardOrder = (res[4].data && res[4].data.value && res[4].data.value.order || []).map(String);
      loaded = true;
      emit();
      backfill();
    });
  }
  function emit() { render(); listeners.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } }); }

  // anciens plateaux (avant l'onglet) : infos du fichier + spacer devinés une fois, en arrière-plan
  var filling = false;
  function backfill() {
    if (filling) return;
    var todo = rows.filter(function (r) { return !(r.meta && r.meta.v >= META_V); });
    if (!todo.length) return;
    filling = true;
    var s = sb();
    todo.reduce(function (p, r) {
      return p.then(function () {
        return s.storage.from(BUCKET).download(r.file_path).then(function (dl) {
          if (dl.error || !dl.data) return;
          return dl.data.arrayBuffer().then(function (ab) {
            var meta; try { meta = parseMeta(new Uint8Array(ab)); } catch (e) { meta = { v: META_V, error: errMsg(e) }; }
            var patch = { meta: meta };
            if (!r.spacer_id) { var sp = detectSpacer(r.file_name + ' ' + r.name); if (sp) patch.spacer_id = sp.id; }
            return s.from('autoloop_plates').update(patch).eq('id', r.id).then(function (u) {
              if (!u.error) { Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); emit(); }
            });
          });
        });
      });
    }, Promise.resolve()).catch(function (e) { console.warn('AutoLoop › Fichiers', e); }).then(function () { filling = false; });
  }

  /* ------------------------------------------------------------------ */
  /*  Fenêtre « Ajouter / Modifier » : spacer, nom de version, client     */
  /* ------------------------------------------------------------------ */
  function spOptions(selId) {
    return '<option value="">Choisir le spacer</option>' + spacers.map(function (sp) {
      var u = imgOf(sp);
      return '<option value="' + esc(sp.id) + '"' + (String(sp.id) === String(selId || '') ? ' selected' : '') +
        (u ? ' data-sw="#fff url(&quot;' + esc(u) + '&quot;) center/contain no-repeat"' : '') + '>' + esc(spLabel(sp)) + '</option>';
    }).join('');
  }
  function clOptions(cur) {
    var key = cur ? cur.kind + ':' + cur.id : '';
    function opt(kind, id, label) {
      var k = kind + ':' + id;
      return '<option value="' + esc(k) + '" data-label="' + esc(label) + '"' + (k === key ? ' selected' : '') + '>' + esc(label) + '</option>';
    }
    var ds = dealers.map(function (d) { return { id: d.email, label: d.name || d.email }; }).sort(function (a, b) { return a.label.localeCompare(b.label, 'fr'); });
    var cs = customers.map(function (c) {
      var nm = [c.first_name, c.last_name].filter(Boolean).join(' ');
      return { id: c.id, label: c.company || nm || c.name || c.email || '' };
    }).filter(function (c) { return c.label; }).sort(function (a, b) { return a.label.localeCompare(b.label, 'fr'); });
    return '<option value="">Aucun</option>' +
      (ds.length ? '<optgroup label="Revendeurs">' + ds.map(function (d) { return opt('dealer', d.id, d.label); }).join('') + '</optgroup>' : '') +
      (cs.length ? '<optgroup label="Clients">' + cs.map(function (c) { return opt('customer', c.id, c.label); }).join('') + '</optgroup>' : '');
  }
  // -> Promise({ spacer_id, name, client } | null)
  function editDialog(o) {
    var body = document.createElement('div');
    body.className = 'alf-form';
    body.innerHTML =
      '<label class="lbl" for="alf-f-sp">Spacer</label><select id="alf-f-sp" aria-label="Spacer">' + spOptions(o.spacer_id) + '</select>' +
      '<label class="lbl" for="alf-f-name">Version</label><input id="alf-f-name" type="text" autocomplete="off" value="' + esc(o.name) + '">' +
      '<label class="lbl" for="alf-f-cl">Client</label><select id="alf-f-cl" aria-label="Client">' + clOptions(o.client) + '</select>' +
      '<p class="alf-f-err" hidden></p>';
    var p = caDialog.confirm({ title: o.title, message: o.message || '', body: body, ok: o.ok || 'Enregistrer', icon: o.icon || 'plus' });
    setTimeout(function () {
      if (window.CA && CA.pick) { CA.pick($('#alf-f-sp', body)); CA.pick($('#alf-f-cl', body)); }
    }, 0);
    return p.then(function (ok) {
      if (!ok) return null;
      var sp = $('#alf-f-sp', body).value, name = $('#alf-f-name', body).value.trim(), cl = $('#alf-f-cl', body);
      var opt = cl.options[cl.selectedIndex], client = null;
      if (cl.value) { var i = cl.value.indexOf(':'); client = { kind: cl.value.slice(0, i), id: cl.value.slice(i + 1), label: opt.getAttribute('data-label') }; }
      if (!sp || !name) {
        toast(!sp ? 'Choisis le spacer.' : 'Donne un nom à la version.', 'bad');
        return editDialog(Object.assign({}, o, { spacer_id: sp, name: name, client: client }));
      }
      return { spacer_id: sp, name: name, client: client };
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Ajouter des fichiers (un ou plusieurs)                             */
  /* ------------------------------------------------------------------ */
  function baseName(n) { return String(n || '').replace(/(\.gcode)?\.3mf$|\.gcode$/i, '').trim(); }
  function sumLine(m) {
    if (!m || m.error) return m && m.error ? m.error : '';
    var p = [];
    if (m.walls != null) p.push(m.walls + ' mur' + (m.walls > 1 ? 's' : ''));
    if (m.infill !== '' && m.infill != null) p.push(m.infill + ' %');
    if (m.layers) p.push(m.layers + ' couches');
    if (m.g) p.push(fmtG(m.g) + ' g');
    if (m.min) p.push(fmtDur(m.min));
    return p.join(' · ');
  }
  function addFile(file) {
    return file.arrayBuffer().then(function (ab) {
      var meta;
      try { meta = parseMeta(new Uint8Array(ab)); }
      catch (e) { caDialog.error(errMsg(e), file.name); return null; }
      var sp = guessFor(file.name);
      return editDialog({ title: 'Ajouter « ' + file.name + ' »', message: sumLine(meta), spacer_id: sp && sp.id, name: baseName(file.name) })
        .then(function (f) {
          if (!f) return null;
          var s = sb(), zip = window.ALProject && ALProject.isZip(new Uint8Array(ab.slice(0, 4)));
          var path = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + (zip ? '.gcode.3mf' : '.gcode');
          var top = versionsOf(f.spacer_id).reduce(function (mn, r) { return Math.min(mn, r.sort); }, 1);
          toast('Envoi de « ' + f.name + ' »…');
          return s.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: 'application/octet-stream' }).then(function (up) {
            if (up.error) throw up.error;
            return s.from('autoloop_plates').insert({
              name: f.name, spacer_id: f.spacer_id, client: f.client, file_path: path, file_name: file.name,
              size_bytes: file.size, sort: top - 1, meta: meta, settings: {}
            }).select().single();
          }).then(function (res) {
            if (res.error) throw res.error;
            rows.push(res.data); emit();
            toast('« ' + f.name + ' » ajouté.');
            return res.data;
          });
        });
    }).catch(function (e) { caDialog.error(e, 'Envoi du fichier'); return null; });
  }
  // plusieurs fichiers : une fenêtre à la fois -> Promise(dernière ligne ajoutée)
  function addFiles(list) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return /\.(3mf|gcode)$/i.test(f.name); });
    if (!files.length) { toast('Envoie un .gcode.3mf ou un .gcode.', 'bad'); return Promise.resolve(null); }
    var last = null;
    return files.reduce(function (p, f) { return p.then(function () { return addFile(f).then(function (r) { if (r) last = r; }); }); }, Promise.resolve())
      .then(function () { return last; });
  }

  /* ------------------------------------------------------------------ */
  /*  Actions d'une version                                              */
  /* ------------------------------------------------------------------ */
  function editRow(r) {
    editDialog({ title: 'Modifier « ' + r.name + ' »', spacer_id: r.spacer_id, name: r.name, client: r.client, icon: 'edit' }).then(function (f) {
      if (!f) return;
      var patch = { name: f.name, spacer_id: f.spacer_id, client: f.client, updated_at: new Date().toISOString() };
      if (String(f.spacer_id) !== String(r.spacer_id || '')) patch.sort = versionsOf(f.spacer_id).reduce(function (mn, x) { return Math.min(mn, x.sort); }, 1) - 1;
      sb().from('autoloop_plates').update(patch).eq('id', r.id).then(function (res) {
        if (res.error) { caDialog.error(res.error); return; }
        Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); emit();
      });
    });
  }
  function deleteRow(r) {
    caDialog.confirm({ title: 'Supprimer « ' + r.name + ' » ?', message: 'Le fichier est effacé. Action définitive.', ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
      if (!ok) return;
      var s = sb();
      s.storage.from(BUCKET).remove([r.file_path]).then(function (r1) {
        if (r1.error) throw r1.error;
        return s.from('autoloop_plates').delete().eq('id', r.id);
      }).then(function (r2) {
        if (r2.error) throw r2.error;
        rows = rows.filter(function (x) { return x !== r; }); emit(); toast('Version supprimée.');
      }).catch(function (e) { caDialog.error(e, 'Suppression'); });
    });
  }
  function downloadRow(r) {
    sb().storage.from(BUCKET).download(r.file_path).then(function (res) {
      if (res.error || !res.data) { caDialog.error(res.error || 'Fichier introuvable.'); return; }
      var url = URL.createObjectURL(res.data), a = document.createElement('a');
      a.href = url; a.download = r.file_name || (r.name + '.gcode.3mf');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Rendu                                                              */
  /* ------------------------------------------------------------------ */
  function fmtG(g) { return (Math.round(g * 10) / 10).toLocaleString('fr-CA'); }
  function fmtN(n, d) { return n == null || n === '' ? '' : (+n).toLocaleString('fr-CA', { maximumFractionDigits: d == null ? 2 : d }); }
  function fmtDur(min) {
    min = Math.round(min);
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' h ' + (m < 10 ? '0' : '') + m;
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; }
  }
  function fmtSize(b) { return b > 1048576 ? fmtN(b / 1048576, 1) + ' Mo' : Math.max(1, Math.round(b / 1024)) + ' ko'; }
  var FR = {
    gyroid: 'Gyroïde', grid: 'Grille', honeycomb: 'Nid d\'abeille', '3dhoneycomb': 'Nid d\'abeille 3D', rectilinear: 'Rectiligne',
    alignedrectilinear: 'Rectiligne aligné', 'zig-zag': 'Zigzag', line: 'Lignes', cubic: 'Cubique', adaptivecubic: 'Cubique adaptatif',
    triangles: 'Triangles', 'tri-hexagon': 'Tri-hexagone', lightning: 'Éclair', crosshatch: 'Croisé', concentric: 'Concentrique',
    monotonic: 'Monotone', monotonicline: 'Ligne monotone', hilbertcurve: 'Hilbert', archimedeanchords: 'Archimède',
    octagramspiral: 'Spirale', supportcubic: 'Cubique support', quartercubic: 'Quart cubique',
    aligned: 'Alignée', nearest: 'La plus proche', back: 'Arrière', random: 'Aléatoire',
    arachne: 'Arachne', classic: 'Classique',
    auto_brim: 'Auto', no_brim: 'Aucune', outer_only: 'Extérieure', inner_only: 'Intérieure', outer_and_inner: 'Ext. + int.', brim_ears: 'Oreilles',
    'no ironing': 'Non', top: 'Dessus', topmost: 'Dernier dessus', solid: 'Plein',
    'Textured PEI Plate': 'PEI texturé', 'Cool Plate': 'Cool Plate', 'Engineering Plate': 'Engineering', 'High Temp Plate': 'High Temp',
    'Smooth PEI Plate': 'PEI lisse', 'Supertack Plate': 'Supertack',
    'normal(auto)': 'Normal (auto)', 'tree(auto)': 'Arbre (auto)', 'normal(manual)': 'Normal (manuel)', 'tree(manual)': 'Arbre (manuel)'
  };
  function fr(v) { return v == null ? '' : (FR[v] || v); }
  function dl(title, pairs) {
    var items = pairs.filter(function (p) { return p[1] !== '' && p[1] != null; });
    if (!items.length) return '';
    return '<section class="alf-sec"><h4>' + esc(title) + '</h4><dl>' +
      items.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : esc(p[1])) + '</dd>'; }).join('') + '</dl></section>';
  }
  function details(r) {
    var m = r.meta || {}, mm = function (v) { return v == null ? '' : fmtN(v) + ' mm'; }, sp = function (v) { return v == null ? '' : fmtN(v, 0) + ' mm/s'; };
    var fils = (m.fil || []).map(function (f) {
      return '<span class="alf-fil"><span class="alf-sw" style="background:' + esc(/^#[0-9a-f]{3,8}$/i.test(f.hex) ? f.hex : 'transparent') + '"></span>' +
        esc(f.type || '?') + ' · ' + esc(fmtG(f.g)) + ' g</span>';
    }).join('');
    return '<div class="alf-grid">' +
      dl('Impression', [
        ['Buse', mm(m.nozzle)], ['Couche', m.lh != null ? mm(m.lh) + (m.lh0 != null && m.lh0 !== m.lh ? ' · 1re ' + mm(m.lh0) : '') : ''],
        ['Couches', m.layers ? fmtN(m.layers, 0) : ''], ['Murs', m.walls != null ? fmtN(m.walls, 0) : ''],
        ['Dessus / dessous', m.top != null ? fmtN(m.top, 0) + ' / ' + fmtN(m.bottom, 0) : ''],
        ['Remplissage', m.infill !== '' && m.infill != null ? m.infill + ' % · ' + fr(m.pattern) : ''],
        ['Surfaces', m.topPat ? fr(m.topPat) + ' / ' + fr(m.botPat) : ''],
        ['Générateur de murs', fr(m.wallGen)], ['Largeur de ligne', mm(m.lineW)], ['Couture', fr(m.seam)],
        ['Supports', m.support ? fr(m.support) : (m.v ? 'Non' : '')], ['Bordure', m.brim ? fr(m.brim) + (m.brimW && m.brim !== 'no_brim' ? ' · ' + mm(m.brimW) : '') : ''],
        ['Lissage', fr(m.ironing)], ['Tour de purge', m.v ? (m.prime ? 'Oui' : 'Non') : '']
      ]) +
      dl('Filament', [
        ['Utilisé', fils, true], ['Profil', (m.fil || []).map(function (f) { return f.profile; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' · ')],
        ['Buse', m.tNoz != null ? fmtN(m.tNoz, 0) + ' °C' + (m.tNoz0 != null && m.tNoz0 !== m.tNoz ? ' · 1re ' + fmtN(m.tNoz0, 0) + ' °C' : '') : ''],
        ['Plateau', (m.tBed != null ? fmtN(m.tBed, 0) + ' °C' : '') + (m.plate ? ' · ' + fr(m.plate) : '')]
      ]) +
      dl('Vitesses', [
        ['Mur extérieur', sp(m.sOuter)], ['Murs intérieurs', sp(m.sInner)], ['Remplissage', sp(m.sInfill)],
        ['1re couche', sp(m.sFirst)], ['Déplacement', sp(m.sTravel)]
      ]) +
      dl('Fichier', [
        ['Poids', m.g ? fmtG(m.g) + ' g' : ''], ['Temps estimé', m.min ? fmtDur(m.min) : ''], ['Temps d\'impression', m.modelMin && m.modelMin !== m.min ? fmtDur(m.modelMin) : ''],
        ['Pièces par plateau', m.pieces ? fmtN(m.pieces, 0) : ''], ['Hauteur', mm(m.maxz)],
        ['Plateaux', m.plates > 1 ? m.plates + ' (le 1er est bouclé)' : ''],
        ['Profil', m.profile], ['Imprimante', m.printer], ['Trancheur', m.studio],
        ['Fichier', r.file_name], ['Taille', r.size_bytes ? fmtSize(r.size_bytes) : ''], ['Ajouté le', fmtDate(r.created_at)]
      ]) +
      '</div>';
  }
  var GRIP = '<span class="alf-grip" title="Glisser pour réordonner" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>';
  var open = {};   // détails dépliés (gardés entre deux rendus)
  function verHtml(r, isDef, sortable) {
    var m = r.meta || {};
    return '<li class="alf-ver' + (isDef ? ' is-def' : '') + '" data-id="' + esc(r.id) + '">' +
      (sortable ? GRIP : '<span class="alf-grip is-off" aria-hidden="true"></span>') +
      '<span class="alf-thumb">' + (m.thumb ? '<img src="' + esc(m.thumb) + '" alt="">' : '') + '</span>' +
      '<div class="alf-vmain">' +
        '<div class="alf-vtop"><b class="alf-vname">' + esc(r.name) + '</b>' +
          (r.client ? '<span class="alf-tag">' + esc(clientLabel(r.client)) + '</span>' : '') +
          (isDef ? '<span class="alf-def">Par défaut</span>' : '') + '</div>' +
        '<div class="alf-sum' + (m.error ? ' is-bad' : '') + '">' + esc(m.v ? sumLine(m) : 'Lecture du fichier…') + '</div>' +
      '</div>' +
      '<div class="alf-act">' +
        '<button class="btn btn-accent btn-sm" type="button" data-act="use" data-ic="play">Utiliser</button>' +
        '<button class="btn btn-ghost btn-sm alf-ib" type="button" data-act="edit" data-ic="edit" title="Modifier" aria-label="Modifier"></button>' +
        '<button class="btn btn-ghost btn-sm alf-ib" type="button" data-act="dl" data-ic="download" title="Télécharger" aria-label="Télécharger"></button>' +
        '<button class="btn btn-ghost btn-sm alf-ib" type="button" data-act="del" data-ic="trash" title="Supprimer" aria-label="Supprimer"></button>' +
      '</div>' +
      (m.v && !m.error ? '<details class="alf-more"' + (open[r.id] ? ' open' : '') + '><summary>Tous les réglages</summary>' + details(r) + '</details>' : '') +
      '</li>';
  }
  function cardHtml(spId) {
    var sp = spacerById(spId), vs = versionsOf(spId), def = defaultOf(spId), refs = refsOf(sp), u = imgOf(sp);
    return '<article class="al-card alf-card" data-sp="' + esc(spId) + '">' +
      '<div class="alf-head">' + GRIP +
        '<span class="alf-photo">' + (u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '') + '</span>' +
        '<div class="alf-title"><h3>' + esc(refs[0] || sp.name) + '</h3><p>' + esc(refs.length ? sp.name : '') +
          (refs.length > 1 ? ' · ' + esc(refs.slice(1).join(', ')) : '') + '</p>' +
          '<p class="alf-count">' + vs.length + ' version' + (vs.length > 1 ? 's' : '') + '</p></div>' +
      '</div>' +
      '<ol class="alf-vers">' + vs.map(function (r) { return verHtml(r, r === def, vs.length > 1); }).join('') + '</ol>' +
      '</article>';
  }
  function render() {
    var box = $('#alf-list'); if (!box) return;
    var loose = versionsOf(null).concat(rows.filter(function (r) { return r.spacer_id && !spacerById(r.spacer_id); }));
    var ids = cards();
    $('#alf-total').textContent = loaded ? rows.length + ' fichier' + (rows.length > 1 ? 's' : '') + ' · ' + ids.length + ' spacer' + (ids.length > 1 ? 's' : '') : '';
    var html = '';
    if (loose.length) {
      html += '<article class="al-card alf-card alf-loose"><div class="alf-head"><span class="alf-photo is-q">?</span>' +
        '<div class="alf-title"><h3>À rattacher</h3><p>Choisis le spacer avec Modifier</p></div></div>' +
        '<ol class="alf-vers">' + loose.map(function (r) { return verHtml(r, false, false); }).join('') + '</ol></article>';
    }
    html += '<div class="alf-cards">' + ids.map(cardHtml).join('') + '</div>';
    if (loaded && !rows.length) html = '<p class="muted alf-empty">Aucun fichier pour l\'instant.</p>';
    box.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /*  Glisser-déposer (souris + tactile) : poignée ⠿                     */
  /* ------------------------------------------------------------------ */
  function startDrag(e, item, container, itemSel, done) {
    e.preventDefault();
    var grip = e.target.closest('.alf-grip');
    try { grip.setPointerCapture(e.pointerId); } catch (_) {}
    var before = $$(itemSel, container).filter(function (x) { return x.parentNode === container; }).map(function (x) { return x.getAttribute('data-id') || x.getAttribute('data-sp'); }).join('|');
    item.classList.add('is-drag'); document.body.classList.add('alf-dragging');
    var raf = 0, lastX = e.clientX, lastY = e.clientY;
    // l'élément sous le doigt/la souris prend la place (liste ou grille de cartes)
    function place() {
      raf = 0;
      var y = lastY, hit = document.elementFromPoint(lastX, y), t = hit && hit.closest(itemSel);
      while (t && t.parentNode !== container) t = t.parentNode.closest(itemSel);
      if (t && t !== item) {
        var kids = Array.prototype.slice.call(container.children);
        container.insertBefore(item, kids.indexOf(item) < kids.indexOf(t) ? t.nextSibling : t);
      }
      // défilement près des bords
      if (y < 70) window.scrollBy(0, -14); else if (y > window.innerHeight - 70) window.scrollBy(0, 14);
    }
    function move(ev) { lastX = ev.clientX; lastY = ev.clientY; if (!raf) raf = requestAnimationFrame(place); }
    function up() {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      item.classList.remove('is-drag'); document.body.classList.remove('alf-dragging');
      var order = $$(itemSel, container).filter(function (x) { return x.parentNode === container; }).map(function (x) { return x.getAttribute('data-id') || x.getAttribute('data-sp'); });
      if (order.join('|') !== before) done(order);
    }
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  }
  function onPointerDown(e) {
    if (e.button > 0) return;
    var grip = e.target.closest('.alf-grip'); if (!grip || grip.classList.contains('is-off')) return;
    var ver = grip.parentNode.classList.contains('alf-ver') ? grip.parentNode : null;
    if (ver) {
      var list = ver.parentNode;
      startDrag(e, ver, list, '.alf-ver', function (ids) { saveVersionOrder(ids); });
      return;
    }
    var card = grip.closest('.alf-card'), wrap = card && card.parentNode;
    if (card && wrap && wrap.classList.contains('alf-cards')) startDrag(e, card, wrap, '.alf-card', saveCardOrder);
  }
  function saveVersionOrder(ids) {
    var s = sb(), ups = [];
    ids.forEach(function (id, i) {
      var r = rowById(id); if (!r || r.sort === i) return;
      r.sort = i; ups.push(s.from('autoloop_plates').update({ sort: i }).eq('id', id));
    });
    emit();
    Promise.all(ups).then(function (res) {
      var bad = res.filter(function (x) { return x.error; })[0];
      if (bad) { caDialog.error(bad.error); load(); }
    });
  }
  function saveCardOrder(ids) {
    cardOrder = ids.map(String).concat(cardOrder.filter(function (x) { return ids.indexOf(x) === -1; }));
    emit();
    sb().from('admin_settings').upsert({ key: CARDS_KEY, value: { order: cardOrder }, updated_at: new Date().toISOString() }).then(function (res) {
      if (res.error) caDialog.error(res.error);
    });
  }

  /* ------------------------------------------------------------------ */
  function init() {
    var view = $('.al-view[data-view="files"]'); if (!view) return;
    var drop = $('#alf-drop'), input = $('#alf-file');
    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { var f = input.files; addFiles(f).then(function () { input.value = ''; }); });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer) addFiles(e.dataTransfer.files); });
    var list = $('#alf-list');
    list.addEventListener('pointerdown', onPointerDown);
    list.addEventListener('toggle', function (e) {
      var li = e.target.closest && e.target.closest('.alf-ver'); if (li) open[li.getAttribute('data-id')] = e.target.open;
    }, true);
    list.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]'); if (!b) return;
      var r = rowById(b.closest('.alf-ver').getAttribute('data-id')); if (!r) return;
      var a = b.getAttribute('data-act');
      if (a === 'use') { if (window.CA && CA.autoloopUse) CA.autoloopUse(r.id); }
      else if (a === 'edit') editRow(r);
      else if (a === 'dl') downloadRow(r);
      else if (a === 'del') deleteRow(r);
    });
    render();
    if (window.CA && CA.onAdminReady) CA.onAdminReady(load);
  }

  window.ALFiles = {
    load: load, parseMeta: parseMeta, addFiles: addFiles,
    rows: function () { return rows; }, row: rowById, cards: cards, versionsOf: versionsOf, defaultOf: defaultOf,
    spacer: spacerById, spLabel: spLabel, imgOf: imgOf, sumLine: sumLine,
    patch: function (id, p) { var r = rowById(id); if (r) Object.keys(p).forEach(function (k) { r[k] = p[k]; }); },
    onChange: function (cb) { listeners.push(cb); if (loaded) cb(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
