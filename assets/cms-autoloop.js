/* =========================================================
   Création Audio V2 — AutoLoop (intégré à l'admin)
   Outil 100% client-side. Aucune donnée envoyée nulle part.
   1) Traitement Gcode : optimise un fichier multi-loop FarmLoop
      (flow / bed leveling choisis loop par loop, hauteur de push auto, bending
      motion régénéré, cooldown configurable, strip AMS optionnel).
   2) Calculateur de prix : coût de production / prix de vente,
      lecture auto du gcode (poids, temps), totaux du batch.
   Entrée : .gcode brut OU projet tranché Bambu Studio (.gcode.3mf) ;
   dans ce cas la sortie est le projet complet, gcode du plateau remplacé
   (autoloop-3mf.js : lecture/écriture ZIP + MD5).

   Réf. ancrages gcode : « Auto Loop.md ». Ne PAS modifier les
   regex sans re-tester contre un vrai fichier gcode multi-loop.
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------------ */
  /*  Sous-onglets (Traitement / Calculateur)                            */
  /* ------------------------------------------------------------------ */
  function initSubtabs() {
    var segs = $$('#al-subnav .al-seg');
    var views = $$('.al-view');
    segs.forEach(function (b) {
      b.addEventListener('click', function () {
        var name = b.dataset.view;
        segs.forEach(function (s) { s.setAttribute('aria-selected', String(s === b)); });
        views.forEach(function (v) { v.hidden = (v.dataset.view !== name); });
      });
    });
  }

  /* ================================================================== */
  /*  1) TRAITEMENT GCODE                                                */
  /* ================================================================== */

  var rawText = '', rawName = '', outText = '', outName = '';
  // Résumé du batch pour slice_info.config du projet : { loops, predictionSec }.
  var outBatch = null;
  // Projet Bambu Studio (.gcode.3mf) : archive d'origine + plateau traité.
  // null = on a reçu un simple .gcode (sortie = .gcode, comme avant).
  var project = null, plateName = '';

  // Cœur de la génération : assets/autoloop-core.js (window.ALCore), partagé avec le script tools/autoloop-cli.
  var C = window.ALCore;
  var num = C.num, intOr = C.intOr, z = C.z, RE_MAXZ = C.RE_MAXZ, PUSH_LOW_MAX = C.PUSH_LOW_MAX, PUSH_MIN = C.PUSH_MIN;
  var pushHeight = C.pushHeight, calibrateLoop = C.calibrateLoop, generateBatch = C.generateBatch;
  var ztNum = C.ztNum, ztFind = C.ztFind, ztApply = C.ztApply, fmtHm = C.fmtHm, fmtDur = C.fmtDur;

  /* --- Grille de calibration par loop ----------------------------------
     Une colonne par loop, deux cases : flow (extrude_cali_flag) et bed
     leveling (g29_before_print_flag). Coché = forcé à 1, décoché = forcé à 0.
     Chaque ligne a son champ « tous les X loops » qui la re-remplit selon le
     motif (défaut flow 2 / bed leveling 4). Changer le nombre de loops garde les
     cases déjà réglées ; les nouveaux loops suivent le motif de leur ligne.  */
  var CAL_CHUNK = 12;                 // loops par rangée de grille
  var cal = { flow: [], bed: [] };    // index 0 = loop 1

  function loopCount() { return Math.max(1, intOr($('#al-loops').value, 12)); }   // < 2 : refusé par generateBatch (règle atelier)
  function calInterval(row) { return Math.max(0, intOr($('#al-cal-' + row + '-every').value, 0)); }
  function fitCal(N) {
    ['flow', 'bed'].forEach(function (row) {
      var k = calInterval(row);
      for (var i = cal[row].length; i < N; i++) cal[row].push(calibrateLoop(i + 1, k));
    });
  }
  function calCell(row, i) {
    var name = row === 'flow' ? 'Calibration du flow' : 'Bed leveling';
    return '<td><input type="checkbox" data-row="' + row + '" data-i="' + i + '"' + (cal[row][i] ? ' checked' : '') +
      ' aria-label="' + name + ', loop ' + (i + 1) + '"></td>';
  }
  function renderCalGrid() {
    var box = $('#al-cal-grid');
    if (!box) return;
    var N = loopCount(), html = '';
    fitCal(N);
    for (var s = 0; s < N; s += CAL_CHUNK) {
      var e = Math.min(N, s + CAL_CHUNK), th = '', rf = '', rb = '';
      for (var i = s; i < e; i++) {
        th += '<th scope="col">' + (i + 1) + '</th>';
        rf += calCell('flow', i);
        rb += calCell('bed', i);
      }
      html += '<div class="al-calg-wrap"><table class="al-calg">' +
        '<thead><tr><th scope="row" class="al-calg-l">Loop</th>' + th + '</tr></thead><tbody>' +
        '<tr><th scope="row" class="al-calg-l">Flow</th>' + rf + '</tr>' +
        '<tr><th scope="row" class="al-calg-l">Bed leveling</th>' + rb + '</tr>' +
        '</tbody></table></div>';
    }
    box.innerHTML = html;
    syncCalCounts();
  }
  // « 36 loops » à côté de chaque « tous les X » (suit aussi les cases cochées à la main).
  function syncCalCounts() {
    var N = loopCount();
    ['flow', 'bed'].forEach(function (row) {
      var el = $('#al-cal-' + row + '-n');
      if (!el) return;
      var n = 0;
      for (var i = 0; i < N; i++) if (cal[row][i]) n++;
      el.textContent = n + ' loop' + (n > 1 ? 's' : '');
    });
  }
  function initCalGrid() {
    var box = $('#al-cal-grid');
    if (!box) return;
    box.addEventListener('change', function (e) {
      var cb = e.target;
      if (!cb.dataset || !cb.dataset.row) return;
      cal[cb.dataset.row][+cb.dataset.i] = cb.checked;
      syncCalCounts();
    });
    ['flow', 'bed'].forEach(function (row) {
      $('#al-cal-' + row + '-every').addEventListener('input', function () {
        cal[row] = [];   // le motif remplace les réglages manuels de CETTE ligne
        renderCalGrid();
      });
    });
    $('#al-loops').addEventListener('input', renderCalGrid);
    renderCalGrid();
  }

  /* --- UI Générateur -------------------------------------------------- */
  // Options du batch = valeurs des champs (snapshot) passées au cœur partagé (mêmes défauts que le script).
  function readOpts() {
    var N = loopCount();
    fitCal(N);
    return C.optsFrom(snapshot('gcode'), N, { flow: cal.flow.slice(0, N), bed: cal.bed.slice(0, N) }, ztValue());
  }

  // « 2810.74 » → « 2 810,74 » (poids du rapport)
  function grams(n) {
    var p = (Math.round(n * 100) / 100).toFixed(2).split('.');
    return p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + p[1];
  }

  // Ligne du rapport, libellé → valeur (comme le résumé des coûts). cls : 'al-bad' (bloc
  // introuvable dans le gcode, profit négatif) ou 'al-good'.
  function rrow(label, val, cls) {
    return '<div class="al-srow"><span>' + label + '</span><span' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</span></div>';
  }

  /* Rapport : filament + temps (batch | par paire ou pièce, l'unité du calculateur),
     puis le coût de l'unité — le profit reste dans le résumé des coûts (calculateur
     synchronisé à la génération, cf. runGenerate ; re-rendu à chaque changement du
     calculateur), puis les détails
     (flow → retrait AMS) dans un repliable FERMÉ par défaut (demande de Théo) ; un
     bloc introuvable dedans est signalé en rouge dans son en-tête, pour ne pas
     passer inaperçu. L'état ouvert/fermé survit aux re-rendus (reportMoreOpen).
     null = rien de généré. */
  var lastRep = null, reportMoreOpen = false;
  function renderReport(rep) {
    var box = $('#al-report');
    if (!rep) { box.innerHTML = '<p class="muted">Aucun batch généré.</p>'; return; }
    if (rep.error) { box.innerHTML = '<p class="al-warn">' + rep.error + '</p>'; return; }
    var N = rep.loops, k = unitK, unit = k === 2 ? '/ paire' : '/ pièce';
    var w = rep.wipe, wipeOk = w && w.done === w.changes;
    var r = pricePerPiece().r;
    var issues = (rep.loadLineReplaced ? 0 : 1) + (w && w.changes && !wipeOk ? 1 : 0) +
                 (rep.layersPer ? 0 : 1) + (rep.amsUnload ? 0 : 1);
    var bad = function (t) { return '<td colspan="2" class="al-bad">' + t + '</td>'; };
    box.innerHTML =
      '<table class="al-rtab"><thead><tr><th></th><th>Batch</th><th>' + unit + '</th></tr></thead><tbody>' +
        '<tr><td>Filament</td>' + (rep.weightPer > 0
          ? '<td>' + grams(rep.weightPer * N) + ' g</td><td>' + grams(rep.weightPer * k) + ' g</td>'
          : bad('introuvable')) + '</tr>' +
        '<tr><td>Temps</td>' + (rep.progress
          ? '<td>' + fmtDur(rep.totalMin) + '</td><td>' + fmtHm((rep.loopMin + rep.transMin) * k) + '</td>'
          : bad('M73 introuvables')) + '</tr>' +
      '</tbody></table>' +
      '<div class="al-rsec">' +
        rrow('Coût ' + unit, money(r.cost * k)) +
        '<button type="button" class="al-link al-rlink" data-goto="prix">Détail du prix →</button>' +
      '</div>' +
      '<details class="al-rmore"' + (reportMoreOpen ? ' open' : '') + '>' +
        '<summary>Détails du batch' + (issues ? ' <span class="al-bad">· ' + issues + ' à vérifier</span>' : '') + '</summary>' +
      '<div class="al-rsec">' +
        rrow('Flow', rep.flow.length + ' loop' + (rep.flow.length > 1 ? 's' : '')) +
        rrow('Bed leveling', rep.bed.length + ' loop' + (rep.bed.length > 1 ? 's' : '')) +
        rrow('Vibrations', rep.sweep ? 'loop 1 seulement' : 'introuvable') +
        (ztFile !== null ? rrow('Z 1re couche', rep.ztrim ? ztFr(rep.ztrim.to) + ' · fichier ' + ztFr(ztFile) : ztFr(ztFile) + ' · du fichier') : '') +
        rrow('Push', z(rep.pushZ) + ' mm' + (rep.pushHalf ? ' · mi-hauteur' : ''), rep.pushHalf ? 'al-caution-t' : '') +
        rrow('Purge', rep.loadLineReplaced ? 'en goulotte' : 'introuvable', rep.loadLineReplaced ? '' : 'al-bad') +
        (w && w.changes
          ? rrow('Nettoyage de buse', wipeOk ? (w.passes > 0 ? w.passes + ' passages' : 'aucun') : w.done + ' / ' + w.changes + ' changements', wipeOk ? '' : 'al-bad')
          : '') +
        rrow('Couches', rep.layersPer ? String(rep.layersPer * N) : 'introuvable', rep.layersPer ? '' : 'al-bad') +
        rrow('Retrait AMS', rep.amsUnload ? 'au loop ' + N : 'introuvable', rep.amsUnload ? '' : 'al-bad') +
      '</div>' +
      '</details>' +
      (project
        ? '<p class="al-fine al-proj">Projet Bambu (' + esc(plateLabel()) + ') · ' +
          '<button type="button" class="al-link" id="al-download-gcode">gcode seul</button></p>'
        : '');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plateLabel() { var m = /plate_(\d+)/.exec(plateName); return 'plateau ' + (m ? m[1] : '1'); }

  // Résumé d'une ligne dans l'en-tête du panneau replié « Réglages machine ».
  function syncMachineSum() {
    var el = $('#al-machine-sum');
    if (!el) return;
    var o = readOpts();
    var cool = o.coolMode === 'temp' ? Math.round(o.coolTemp) + ' °C'
             : o.coolMode === 'delay' ? Math.round(o.coolSec) + ' s' : 'sans cooldown';
    if (o.coolMode !== 'none' && o.coolFresh) cool += ' air frais' + (o.coolZ != null ? ' (plateau ' + o.coolZ + ' mm)' : '');
    el.textContent = [o.bendEnable ? 'flexion ×' + o.bendCycles : 'sans flexion',
                      'push −' + o.pushOffset + ' mm', 'purge ' + o.purgeLen + ' mm', cool].join(' · ');
  }

  /* --- Extraction des données du gcode → calculateur de prix ----------
     Le header Bambu Studio (bloc « ; HEADER_BLOCK_START ») contient le poids
     de filament et le temps d'impression PAR PIÈCE. On les lit ici pour
     alimenter automatiquement le calculateur. Patterns tolérants (Bambu /
     Orca / Prusa) car l'étiquette exacte varie selon le slicer/version.
     Poids : Bambu liste UNE valeur PAR FILAMENT (« 110.47,0.70 » = pièce + purge
     de l'AMS) → on capture la liste complète et on l'additionne, sinon le total
     du slicer n'est jamais atteint.
     Temps : on prend « total estimated time » et PAS « model printing time ».
     Le premier inclut la phase de préparation (start gcode : chauffe, homing,
     bed leveling, purge ≈ 7 min) — et dans un batch AutoLoop cette phase est
     rejouée à CHAQUE loop, contrairement à un plateau multi-copies du slicer
     où elle n'est payée qu'une fois.                                          */
  var RE_WEIGHT = [
    /;\s*total\s+filament\s+weight\s*\[g\]\s*[:=]\s*([\d.,\s]+)/i,
    /;\s*total\s+filament\s+used\s*\[g\]\s*[:=]\s*([\d.,\s]+)/i,
    /;\s*filament\s+used\s*\[g\]\s*[:=]\s*([\d.,\s]+)/i,
    /;\s*total\s+filament\s+weight\s*[:=]\s*([\d.,\s]+)/i
  ];
  var RE_TIME = [
    /;\s*total\s+estimated\s+time:\s*([0-9hms .\t]+)/i,
    /;\s*model\s+printing\s+time:\s*([0-9hms .\t]+)/i,
    /;\s*estimated\s+printing\s+time\s*\(normal\s+mode\)\s*=\s*([0-9hms .\t]+)/i
  ];
  // « 110.47,0.70 » → 111.17 (somme de tous les filaments du job).
  function sumWeights(str) {
    return String(str).split(',').reduce(function (acc, p) {
      var n = parseFloat(p);
      return acc + (isFinite(n) ? n : 0);
    }, 0);
  }
  function firstCapture(text, res) {
    for (var i = 0; i < res.length; i++) { var m = res[i].exec(text); if (m) return m[1]; }
    return null;
  }
  // « 1h 21m 5s » → minutes totales (fractionnaires).
  function parseGcodeTime(str) {
    var h = /([\d.]+)\s*h/i.exec(str), m = /([\d.]+)\s*m/i.exec(str), s = /([\d.]+)\s*s/i.exec(str);
    return (h ? parseFloat(h[1]) : 0) * 60 + (m ? parseFloat(m[1]) : 0) + (s ? parseFloat(s[1]) : 0) / 60;
  }
  // Alimente le calculateur (poids, temps par pièce, loops) depuis le gcode chargé.
  function applyGcodeToPricing(text, name) {
    var applied = [];
    var wStr = firstCapture(text, RE_WEIGHT);
    if (wStr != null) {
      var w = Math.round(sumWeights(wStr) * 100) / 100;
      if (isFinite(w) && w > 0) { var we = $('#ap-weight'); if (we) { we.value = w; applied.push(w.toFixed(2) + ' g'); } }
    }
    var tStr = firstCapture(text, RE_TIME);
    if (tStr != null) {
      var tot = parseGcodeTime(tStr);
      if (tot > 0) {
        var hh = Math.floor(tot / 60), mm = Math.round(tot % 60);
        if (mm === 60) { hh++; mm = 0; }
        var eh = $('#ap-time-h'), em = $('#ap-time-m');
        if (eh) eh.value = hh; if (em) em.value = mm;
        applied.push(hh + 'h' + (mm < 10 ? '0' : '') + mm);
      }
    }
    // Le gcode importé décrit UNE pièce : temps et poids sont par pièce, on ne
    // touche pas au nombre de loops du calculateur (défaut 1 ; le batch se
    // déduit en multipliant, cf. recompute).
    var src = $('#ap-gcode-src');
    if (src) src.textContent = applied.length ? ('↺ ' + name + ' · ' + applied.join(' · ')) : '';
    recompute();  // rafraîchit le résumé (les .value posés en JS ne déclenchent pas « input »)
  }

  // Accepte un .gcode brut OU le projet tranché exporté par Bambu Studio (.gcode.3mf,
  // une archive ZIP : on y lit Metadata/plate_N.gcode). Détection par signature « PK ».
  function loadFile(file, libId) {
    if (!file) return;
    rawName = file.name;
    lastFile = file; libCur = libId || null;
    libPending = libId && libRow(libId) ? libRow(libId).settings : null;   // appliqués une fois le fichier lu (useGcode)
    syncLib();
    project = null; plateName = ''; showPlatePicker();   // repart de zéro (projet précédent oublié)
    resetOutput();
    $('#al-file-name').textContent = 'Lecture de ' + rawName + '…';
    var reader = new FileReader();
    reader.onload = function (e) {
      var u8 = new Uint8Array(e.target.result);
      if (window.ALProject && window.ALProject.isZip(u8)) { loadProject(u8); return; }
      useGcode(new TextDecoder('utf-8').decode(u8));
    };
    reader.onerror = function () { fileError('Impossible de lire ce fichier.'); };
    reader.readAsArrayBuffer(file);
  }
  /* ---- Bibliothèque de plateaux (bucket privé « autoloop » + table autoloop_plates) ----
     Les fichiers vivent dans l'onglet Fichiers (cms-autoloop-files.js, window.ALFiles) : on choisit spacer + version au lieu de
     chercher le .gcode.3mf. Les réglages du batch (loops…) restent ceux de la page. */
  var libCur = null, lastFile = null, libPending = null;
  var STUDIO_MAX = 50 * 1024 * 1024 - 65536;   // limite de fichier du stockage Supabase (marge pour l'envoi)
  var PRESETS = [6, 12, 18];   // lignes « Batchs prêts » (loops)
  function libSb() { return window.CA && window.CA.sb; }
  function libToast(msg, kind) { if (window.caDialog && caDialog.toast) caDialog.toast(msg, kind); }
  function libRow(id) { return id && window.ALFiles ? ALFiles.row(id) : null; }
  // Menu du Générateur : spacer (cartes de l'onglet Fichiers, même ordre) puis version (celle par défaut d'office)
  function renderLib() {
    var sp = $("#al-lib-sp"), ver = $("#al-lib-ver"), F = window.ALFiles;
    if (!sp || !ver || !F) return;
    var ids = F.cards(), cur = libRow(libCur), curSp = cur && cur.spacer_id ? String(cur.spacer_id) : "";
    sp.innerHTML = "<option value=\"\">" + (ids.length ? "Fichiers : choisir un spacer" : "Aucun fichier") + "</option>" + ids.map(function (id) {
      var s = F.spacer(id), u = F.imgOf(s);
      return "<option value=\"" + esc(id) + "\"" + (u ? " data-sw=\"#fff url(&quot;" + esc(u) + "&quot;) center/contain no-repeat\"" : "") + ">" + esc(F.spLabel(s)) + "</option>";
    }).join("");
    sp.value = ids.indexOf(curSp) !== -1 ? curSp : "";
    var vs = sp.value ? F.versionsOf(sp.value) : [], def = sp.value ? F.defaultOf(sp.value) : null, has = cur && vs.indexOf(cur) !== -1;
    ver.innerHTML = (has ? "" : "<option value=\"\">Version</option>") + vs.map(function (r) {
      return "<option value=\"" + esc(r.id) + "\">" + esc(r.name + (r.client ? " · " + r.client.label : "") + (r === def ? " · défaut" : "")) + "</option>";
    }).join("");
    ver.value = has ? cur.id : "";
    ver.disabled = !vs.length;
    if (window.CA && CA.pick) { CA.pick(sp); CA.pick(ver); }
  }
  function syncLib() {
    var save = $("#al-lib-save"), set = $("#al-lib-set");
    if (!save) return;
    save.hidden = !(lastFile && !libCur);
    set.hidden = !libCur;
    renderLib();
  }
  function libPick(id) {
    var sb = libSb(), row = libRow(id);
    if (!row) { libCur = null; syncLib(); return; }
    $("#al-file-name").textContent = "Chargement de " + row.name + "…";
    sb.storage.from("autoloop").download(row.file_path).then(function (res) {
      if (res.error || !res.data) {
        libToast("Fichier introuvable : " + (res.error ? res.error.message : row.name), "bad");
        libCur = null; syncLib(); return;
      }
      loadFile(new File([res.data], row.file_name || (row.name + ".gcode.3mf")), row.id);
    });
  }
  // fichier glissé ici : on l'ajoute à l'onglet Fichiers (même fenêtre), avec les réglages de la page
  function libSave() {
    if (!lastFile || !window.ALFiles) return;
    var btn = $("#al-lib-save"); btn.disabled = true;
    ALFiles.addFiles([lastFile]).then(function (row) {
      if (!row) return;
      libCur = row.id;
      var st = libSettings();
      return libSb().from("autoloop_plates").update({ settings: st }).eq("id", row.id).then(function (res) {
        if (!res.error) ALFiles.patch(row.id, { settings: st });
      });
    }).then(function () { btn.disabled = false; syncLib(); });
  }
  // « Utiliser » dans l'onglet Fichiers : retour au Générateur avec ce fichier
  if (window.CA) window.CA.autoloopUse = function (id) {
    var seg = $("#al-subnav .al-seg[data-view=\"gcode\"]"); if (seg) seg.click();
    var top = $("#al-subnav"); if (top && top.scrollIntoView) top.scrollIntoView({ behavior: "smooth", block: "start" });
    libPick(id);
  };
  // Tout ce que la page règle (batch, calculateur de prix, cases de calibration) suit le plateau.
  function libSettings() {
    var N = loopCount(); fitCal(N);
    return { gcode: snapshot('gcode'), prix: snapshot('prix'), cal: { flow: cal.flow.slice(0, N), bed: cal.bed.slice(0, N) } };
  }
  function libApply(s) {
    if (!s || !s.gcode) return;   // plateau sans réglages enregistrés : la page reste comme elle est
    applyValues(s.gcode, true); applyValues(s.prix, true);
    if (s.cal && s.cal.flow) { cal.flow = s.cal.flow.slice(); cal.bed = (s.cal.bed || []).slice(); renderCalGrid(); }
  }
  function libSet() {
    var sb = libSb(), row = libRow(libCur); if (!sb || !row) return;
    var btn = $('#al-lib-set'); btn.disabled = true;
    sb.from('autoloop_plates').update({ settings: libSettings(), updated_at: new Date().toISOString() }).eq('id', row.id).select().single().then(function (res) {
      if (res.error) throw res.error;
      ALFiles.patch(row.id, { settings: res.data.settings }); libToast('Réglages de « ' + row.name + ' » enregistrés.');
    }).catch(function (err) { libToast('Réglages : ' + (err && err.message ? err.message : err), 'bad'); })
      .then(function () { btn.disabled = false; });
  }

  /* ---- Batchs prêts : 6 / 12 / 18 / 24 loops, durée et filament calculés d'après UN loop
     (temps = loops × (loop + cooldown/éjection), filament = loops × poids du loop : même
     calcul que generateBatch) ; le projet n'est généré qu'au clic. ---- */
  function presetOpts(n) {
    var o = readOpts(), fk = calInterval('flow'), bk = calInterval('bed');
    o.loops = n; o.cal = { flow: [], bed: [] };
    for (var i = 1; i <= n; i++) { o.cal.flow.push(calibrateLoop(i, fk)); o.cal.bed.push(calibrateLoop(i, bk)); }
    return o;
  }
  function renderPresets() {
    var card = $('#al-pre-card'), box = $('#al-pre'); if (!card) return;
    card.hidden = !rawText;
    if (!rawText) return;
    var rep = null;
    try { rep = generateBatch(rawText, presetOpts(1)).report; } catch (e) { rep = null; }
    if (!rep || !rep.ok) { box.innerHTML = '<p class="al-warn">' + esc(rep && rep.error ? rep.error : 'Fichier illisible.') + '</p>'; return; }
    var perMin = rep.progress ? rep.loopMin + rep.transMin : 0;
    box.innerHTML = PRESETS.map(function (n) {
      return '<div class="al-pre-row"><b class="al-pre-n">' + n + ' loops</b>' +
        '<span class="al-pre-v">' + (perMin ? fmtDur(Math.round(n * perMin)) : '—') + '</span>' +
        '<span class="al-pre-v">' + (rep.weightPer > 0 ? grams(n * rep.weightPer) + ' g' : '—') + '</span>' +
        '<span class="al-pre-b"><button class="btn btn-accent btn-sm" type="button" data-pre="' + n + '" data-act="open" data-ic="print"' + (project ? '' : ' disabled') + '>Ouvrir dans Bambu Studio</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-pre="' + n + '" data-act="dl" data-ic="download">Télécharger</button></span></div>';
    }).join('');
  }
  var preTimer = null;
  function schedulePresets() { clearTimeout(preTimer); preTimer = setTimeout(renderPresets, 250); }
  function presetBuild(n) {
    var res = generateBatch(rawText, presetOpts(n));
    if (!res.report.ok) return Promise.reject(new Error(res.report.error || 'Génération impossible.'));
    var bytes = new TextEncoder().encode(res.text);
    if (!project) return Promise.resolve({ bytes: bytes, name: rawName.replace(/\.gcode$/i, '') + ' AutoLoop x' + n + '.gcode' });
    return window.ALProject.build(project, plateName, bytes, { loops: n, predictionSec: res.report.progress ? res.report.totalMin * 60 : 0 })
      .then(function (zip) { return { bytes: zip, name: projectOutName(n) }; });
  }
  function busy(btn, text, work) {
    var old = btn.textContent; btn.disabled = true; btn.textContent = text;
    return new Promise(function (r) { setTimeout(r, 30); }).then(work)   // laisse peindre l'état avant le gros travail
      .catch(function (err) { libToast((err && err.message ? err.message : err), 'bad'); })
      .then(function () { btn.disabled = false; btn.textContent = old; });
  }
  // Le fichier part dans le bucket privé (dossier tmp/, vidé après 24 h), puis Bambu Studio l'ouvre
  // par lien signé (15 min) : bambustudio://open?file=…
  function openInStudio(bytes, name) {
    var sb = libSb(); if (!sb) return Promise.reject(new Error('Non connecté.'));
    // Supabase (forfait gratuit) refuse tout fichier de plus de 50 Mo : on le dit avant d'envoyer
    if (bytes.length > STUDIO_MAX) {
      return Promise.reject(new Error('Fichier de ' + Math.round(bytes.length / 1048576) + ' Mo : trop gros pour l\'ouverture directe (max 50 Mo). Utilise « Télécharger ».'));
    }
    var bucket = sb.storage.from('autoloop');
    var safe = name.replace(/[^A-Za-z0-9._-]+/g, '_');
    var path = 'tmp/' + Date.now() + '/' + safe;
    cleanTmp(bucket);
    return bucket.upload(path, new Blob([bytes], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream' }).then(function (up) {
      if (up.error) throw up.error;
      return bucket.createSignedUrl(path, 900);
    }).then(function (r) {
      if (r.error) throw r.error;
      libToast('Ouverture dans Bambu Studio…');
      // Studio lit le nom du fichier au bout du lien : on le répète après le jeton (paramètre ignoré par Supabase)
      window.location.href = 'bambustudio://open?file=' + encodeURIComponent(r.data.signedUrl + '&x=/' + safe);
    });
  }
  function cleanTmp(bucket) {
    bucket.list('tmp', { limit: 100 }).then(function (r) {
      if (r.error || !r.data) return;
      r.data.filter(function (f) { return +f.name < Date.now() - 864e5; }).forEach(function (f) {
        bucket.list('tmp/' + f.name).then(function (x) {
          if (x.data && x.data.length) bucket.remove(x.data.map(function (y) { return 'tmp/' + f.name + '/' + y.name; }));
        });
      });
    });
  }
  function onPresetClick(e) {
    var b = e.target.closest ? e.target.closest('button[data-pre]') : null;
    if (!b || !rawText) return;
    var n = +b.dataset.pre, open = b.dataset.act === 'open';
    busy(b, 'Préparation…', function () {
      return presetBuild(n).then(function (p) {
        if (open) return openInStudio(p.bytes, p.name);
        saveBlob(new Blob([p.bytes], { type: 'application/octet-stream' }), p.name);
      });
    });
  }
  function openCustom() {
    if (!outText || !project) return;
    busy($('#al-open-studio'), 'Préparation…', function () {
      return window.ALProject.build(project, plateName, new TextEncoder().encode(outText), outBatch).then(function (zip) {
        return openInStudio(zip, outName);
      });
    });
  }

  function initLib() {
    var sp = $('#al-lib-sp'), ver = $('#al-lib-ver'); if (!sp) return;
    sp.addEventListener('change', function () { var d = sp.value && ALFiles.defaultOf(sp.value); if (d) libPick(d.id); });
    ver.addEventListener('change', function () { if (ver.value) libPick(ver.value); });
    $('#al-lib-save').addEventListener('click', libSave);
    $('#al-lib-set').addEventListener('click', libSet);
    $('#al-pre').addEventListener('click', onPresetClick);
    $('#al-open-studio').addEventListener('click', openCustom);
    // durée / filament des lignes suivent les réglages (cooldown, purge…)
    var main = $('.al-main');
    if (main) { main.addEventListener('input', schedulePresets); main.addEventListener('change', schedulePresets); }
    if (window.ALFiles) ALFiles.onChange(renderLib);
  }

  function loadProject(u8) {
    try { project = window.ALProject.read(u8); }
    catch (err) { project = null; syncDownloadLabel(); fileError('Archive illisible : ' + (err && err.message ? err.message : err)); return; }
    if (!project.plates.length) {
      project = null; showPlatePicker(); syncDownloadLabel();
      fileError('Ce .3mf ne contient pas de plateau tranché. Dans Bambu Studio, tranche le plateau puis « Exporter le fichier tranché du plateau » (.gcode.3mf) — pas « Enregistrer le projet ».');
      return;
    }
    showPlatePicker();
    selectPlate(project.plates[0].name);
  }
  function selectPlate(name) {
    plateName = name;
    resetOutput();
    useGcode(new TextDecoder('utf-8').decode(project.entries[name]));
  }
  // plusieurs plateaux dans le projet : menu pour choisir lequel boucler
  function showPlatePicker() {
    var wrap = $('#al-plate-wrap'), sel = $('#al-plate');
    if (!wrap || !sel) return;
    var plates = project ? project.plates : [];
    wrap.hidden = plates.length < 2;
    sel.innerHTML = plates.map(function (p) { return '<option value="' + esc(p.name) + '">Plateau ' + p.n + '</option>'; }).join('');
  }
  function useGcode(text) {
    rawText = text;
    var mz = rawText.match(RE_MAXZ);
    $('#al-file-name').textContent = rawName + (project && project.plates.length > 1 ? ' · ' + plateLabel() : '') +
      (mz ? ' · pièce ' + parseFloat(mz[1]).toFixed(2) + ' mm' : '');
    $('#al-drop').classList.add('has-file');   // zone compacte : une ligne avec le fichier
    $('#al-process').disabled = false;
    syncPushWarn();
    ztLoad(rawText);
    applyGcodeToPricing(rawText, rawName);
    libApply(libPending); libPending = null;
    renderPresets();
  }
  /* ---- Z de la 1re couche : « G29.1 Z… ; for Textured PEI Plate » du start gcode P2S (décalage
     du plateau). Valeur plus haute = buse plus haute = moins écrasé (profil « Less Squish » = 0,06,
     Bambu d'origine ≈ 0,02). Réécrite dans chaque loop ; « G29.1 Z0 ; clear z-trim » jamais touché.
     Une valeur par imprimante : admin_settings « autoloop_ztrim » = { values: { printer_id: z } } ;
     l'imprimante choisie reste choisie (localStorage) et sa valeur s'applique à chaque fichier. ---- */
  var ZT_KEY = 'autoloop_ztrim', ZT_LS = 'al-zt-printer';
  var ztFile = null, ztModel = '', ztPrinters = [], ztVals = {}, ztCur = null;
  try { ztCur = localStorage.getItem(ZT_LS) || null; } catch (e) { ztCur = null; }
  function ztFr(v) { return (Math.round(v * 1000) / 1000).toFixed(3).replace('.', ',') + ' mm'; }
  function ztValue() {
    var r = $('#al-ztrim');
    if (!r || ztFile === null) return null;
    var v = +r.value;
    return Math.abs(v - ztFile) < 1e-6 ? null : v;
  }
  function ztPrintersShown() {
    return ztPrinters.filter(function (p) { return !ztModel || ztModel.indexOf(p.model) !== -1; });
  }
  function ztLoad(text) {
    ztFile = text ? ztFind(text) : null;
    var m = /^; printer_model = (.+)$/m.exec(text || '');
    ztModel = m ? m[1].trim() : '';
    var box = $('#al-zt'), r = $('#al-ztrim');
    if (!box) return;
    box.hidden = ztFile === null;
    if (ztFile === null) return;
    r.min = Math.min(-0.05, ztFile - 0.05).toFixed(3);
    r.max = Math.max(0.15, ztFile + 0.05).toFixed(3);
    var mine = ztCur && ztVals[ztCur] != null && ztPrintersShown().some(function (p) { return p.id === ztCur; });
    r.value = mine ? ztVals[ztCur] : ztFile;
    ztRender();
  }
  function ztRender() {
    var r = $('#al-ztrim'); if (!r || ztFile === null) return;
    var v = +r.value, min = +r.min, max = +r.max;
    $('#al-zt-v').textContent = ztFr(v);
    var p = (ztFile - min) / (max - min) * 100, mk = $('#al-zt-file');
    mk.style.left = 'calc(' + p + '% + ' + ((0.5 - p / 100) * 18) + 'px)';
    mk.title = 'Fichier : ' + ztFr(ztFile);
    var cur = ztPrintersShown().filter(function (x) { return x.id === ztCur; })[0] || null;
    var saved = cur ? ztVals[cur.id] : null;
    $('#al-zt-pr').innerHTML = ztPrintersShown().map(function (x) {
      var on = cur && x.id === cur.id;
      return '<button type="button" class="al-zt-p" data-p="' + esc(x.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(x.name) +
        '<span>' + (ztVals[x.id] != null ? ztFr(ztVals[x.id]).replace(' mm', '') : '—') + '</span></button>';
    }).join('') +
      (cur && (saved == null || Math.abs(saved - v) > 1e-6) ? '<button type="button" class="btn btn-ghost btn-sm" data-zt="save" data-ic="save">Enregistrer pour ' + esc(cur.name) + '</button>' : '') +
      (Math.abs(v - ztFile) > 1e-6 ? '<button type="button" class="al-link" data-zt="reset">Rétablir celle du fichier</button>' : '');
  }
  function ztChanged() { ztRender(); if (outText) resetOutput(); schedulePresets(); }
  function ztLoadPrinters() {
    var sb = libSb(); if (!sb) return;
    Promise.all([
      sb.from('printers').select('id,name,model,sort').order('sort'),
      sb.from('admin_settings').select('value').eq('key', ZT_KEY).maybeSingle()
    ]).then(function (res) {
      ztPrinters = (res[0] && !res[0].error && res[0].data) || [];
      ztVals = (res[1] && res[1].data && res[1].data.value && res[1].data.value.values) || {};
      if (rawText) ztLoad(rawText);
    });
  }
  function initZtrim() {
    var r = $('#al-ztrim'); if (!r) return;
    r.addEventListener('input', ztChanged);
    $('#al-zt-pr').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.zt === 'reset') { r.value = ztFile; ztChanged(); return; }
      if (b.dataset.zt === 'save') {
        var id = ztCur, v = Math.round(+r.value * 1000) / 1000, next = Object.assign({}, ztVals);
        next[id] = v; b.disabled = true;
        libSb().from('admin_settings').upsert({ key: ZT_KEY, value: { values: next }, updated_at: new Date().toISOString() }).then(function (res) {
          if (res.error) { b.disabled = false; libToast('Z : ' + res.error.message, 'bad'); return; }
          ztVals = next; ztRender();
          var p = ztPrinters.filter(function (x) { return x.id === id; })[0];
          libToast('Z de ' + (p ? p.name : id) + ' : ' + ztFr(v));
        });
        return;
      }
      var pid = b.dataset.p; if (!pid) return;
      ztCur = ztCur === pid ? null : pid;   // re-clic = aucune imprimante
      try { if (ztCur) localStorage.setItem(ZT_LS, ztCur); else localStorage.removeItem(ZT_LS); } catch (err) { /* stockage indisponible */ }
      if (ztCur && ztVals[ztCur] != null) r.value = ztVals[ztCur];
      ztChanged();
    });
    if (window.CA) window.CA.autoloopZtReload = ztLoadPrinters;   // relire imprimantes + valeurs
    if (window.CA && window.CA.onAdminReady) window.CA.onAdminReady(ztLoadPrinters);
  }

  // Avertissement sous le fichier dès qu'il est chargé : pièce ≤ 10 mm ou push calculé < 2 mm
  // → push à mi-hauteur (cf. pushHeight). Suit aussi le champ Retrait.
  function syncPushWarn() {
    var el = $('#al-push-warn');
    if (!el) return;
    var mz = rawText ? RE_MAXZ.exec(rawText) : null;
    var maxZ = mz ? parseFloat(mz[1]) : 0;
    var p = mz ? pushHeight(maxZ, num($('#al-push-offset').value, 10)) : null;
    el.hidden = !(p && p.half);
    if (p && p.half) {
      el.textContent = 'Pièce de ' + z(maxZ) + ' mm (' + (p.low ? '≤ ' + PUSH_LOW_MAX + ' mm' : 'push < ' + PUSH_MIN + ' mm') + ')' +
        ' : push à mi-hauteur, ' + z(p.z) + ' mm. Vérifie l\'éjection au 1er loop.';
    }
  }
  function resetOutput() {
    outText = ''; outBatch = null; lastRep = null;
    $('#al-download').disabled = true;
    if ($('#al-open-studio')) $('#al-open-studio').disabled = true;
    syncSend(false);
    renderReport(null);
    syncDownloadLabel();
  }
  function fileError(msg) {
    rawText = '';
    $('#al-file-name').textContent = rawName;
    $('#al-drop').classList.remove('has-file');
    syncPushWarn(); ztLoad('');
    $('#al-process').disabled = true;
    renderPresets();
    $('#al-report').innerHTML = '<p class="al-warn">' + esc(msg) + '</p>';
  }
  function syncDownloadLabel() {
    var b = $('#al-download');
    if (b) b.textContent = project ? 'Télécharger le projet' : 'Télécharger le gcode';   // icône : data-ic="download"
  }
  // « HSB524 1.4.gcode.3mf » -> « HSB524 1.4 AutoLoop x12.gcode.3mf »
  function projectOutName(loops) {
    var base = rawName.replace(/(\.gcode)?\.3mf$/i, '') || 'plateau';
    return base + ' AutoLoop x' + loops + '.gcode.3mf';
  }

  function runGenerate() {
    if (!rawText) return;
    var btn = $('#al-process');
    btn.disabled = true; btn.textContent = 'Génération…';
    // Laisse le navigateur peindre l'état « Génération… » avant le gros travail.
    setTimeout(function () {
      try {
        var opts = readOpts();
        var res = generateBatch(rawText, opts);
        outText = res.text;
        if (res.report.ok) {
          lastRep = res.report;
          // Le calculateur décrit maintenant CE batch : loops (prep amortie) et
          // refroidissement = cooldown + éjection estimés par loop.
          $('#ap-loops').value = opts.loops;
          $('#ap-cooldown').value = Math.round(res.report.transMin);
          recompute();   // → renderReport(lastRep) avec le prix à jour
          outName = project ? projectOutName(opts.loops) : 'plate_1.gcode';
          outBatch = { loops: opts.loops, predictionSec: res.report.progress ? res.report.totalMin * 60 : 0 };
          $('#al-download').disabled = false;
          $('#al-open-studio').disabled = !project;
          syncSend(true);
        } else {
          lastRep = null;
          renderReport(res.report);
          $('#al-download').disabled = true;
          syncSend(false);
        }
      } catch (err) {
        $('#al-report').innerHTML = '<p class="al-warn">Erreur de génération : ' + (err && err.message ? err.message : err) + '</p>';
      }
      btn.disabled = false; btn.textContent = 'Générer le batch';
    }, 30);
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function downloadGcode() {
    if (!outText) return;
    saveBlob(new Blob([outText], { type: 'text/plain' }), 'plate_1.gcode');
  }
  // Projet : on remet le gcode du batch dans l'archive d'origine (MD5 recalculé)
  function download() {
    if (!outText) return;
    if (!project) { saveBlob(new Blob([outText], { type: 'text/plain' }), outName || 'autoloop.gcode'); return; }
    var btn = $('#al-download'), name = outName;
    btn.disabled = true; btn.textContent = 'Préparation du projet…';
    setTimeout(function () {   // laisse peindre l'état avant l'encodage
      var bytes = new TextEncoder().encode(outText);
      window.ALProject.build(project, plateName, bytes, outBatch).then(function (zip) {
        saveBlob(new Blob([zip], { type: 'application/octet-stream' }), name);
        btn.disabled = false; syncDownloadLabel();
      }, function (err) {
        btn.disabled = false; syncDownloadLabel();
        $('#al-report').insertAdjacentHTML('afterbegin', '<p class="al-warn">Création du projet impossible : ' +
          esc(err && err.message ? err.message : err) + '. Utilise « gcode seul ».</p>');
      });
    }, 30);
  }

  // « Envoyer à la production » : le batch entre dans Stock › Production › En impression
  // (infos de l'en-tête seulement, via CA.prodQueue de cms-production.js). Un envoi par batch généré.
  function syncSend(on) {
    var b = $('#al-send-prod'); if (!b) return;
    b.disabled = !on || !(window.CA && window.CA.prodQueue);
    b.textContent = 'Envoyer à la production';   // icône : data-ic="send"
  }
  function sendToProd() {
    if (!outText || !outBatch || !(window.CA && window.CA.prodQueue)) return;
    var btn = $('#al-send-prod');
    var name = project ? outName : (rawName.replace(/\.gcode$/i, '') || 'plateau') + ' AutoLoop x' + outBatch.loops + '.gcode';
    btn.disabled = true; btn.textContent = 'Envoi…';
    window.CA.prodQueue.addText(name, outText, project, plateName).then(function () {
      btn.textContent = 'Envoyé à la production';
    }, function (err) {
      syncSend(true);
      $('#al-report').insertAdjacentHTML('afterbegin', '<p class="al-warn">Envoi impossible : ' +
        esc(err && err.message ? err.message : err) + '</p>');
    });
  }

  function initGcode() {
    var drop = $('#al-drop'), fileInput = $('#al-file');
    if (!drop) return;
    drop.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () { loadFile(fileInput.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
    // Cooldown : masquer les champs non pertinents.
    var coolMode = $('#al-cool-mode');
    function syncCool() {
      $('#al-cool-temp-wrap').hidden = coolMode.value !== 'temp';
      $('#al-cool-sec-wrap').hidden = coolMode.value !== 'delay';
      $('#al-cool-est-wrap').hidden = coolMode.value !== 'temp';   // délai / aucun : durée calculée
      $('#al-cool-fresh-wrap').hidden = coolMode.value === 'none';
      $('#al-cool-z-wrap').hidden = coolMode.value === 'none' || !$('#al-cool-fresh').checked;
    }
    coolMode.addEventListener('change', syncCool); $('#al-cool-fresh').addEventListener('change', syncCool); syncCool();
    // Flexion : activer/désactiver les champs.
    var bendEnable = $('#al-bend-enable');
    function syncBend() { $('#al-bend-fields').style.opacity = bendEnable.checked ? '1' : '.4'; }
    bendEnable.addEventListener('change', syncBend); syncBend();
    initCalGrid();
    initLib();
    // Résumé de l'en-tête des réglages machine, tenu à jour (saisie ou défauts appliqués).
    var machine = $('#al-machine');
    if (machine) { machine.addEventListener('input', syncMachineSum); machine.addEventListener('change', syncMachineSum); }
    syncMachineSum();
    $('#al-push-offset').addEventListener('input', syncPushWarn);
    initZtrim();

    $('#al-process').addEventListener('click', runGenerate);
    $('#al-download').addEventListener('click', download);
    if ($('#al-send-prod')) $('#al-send-prod').addEventListener('click', sendToProd);
    // Rapport (re-rendu à chaque fois) : « gcode seul » et « Détail du prix → ».
    $('#al-report').addEventListener('click', function (e) {
      var t = e.target;
      if (t.id === 'al-download-gcode') downloadGcode();
      else if (t.dataset && t.dataset.goto) { var seg = $('.al-seg[data-view="' + t.dataset.goto + '"]'); if (seg) seg.click(); }
    });
    // « Détails du batch » : on retient ouvert/fermé pour les re-rendus (« toggle » ne
    // remonte pas → écouté en capture).
    $('#al-report').addEventListener('toggle', function (e) {
      if (e.target.classList && e.target.classList.contains('al-rmore')) reportMoreOpen = e.target.open;
    }, true);
    var plateSel = $('#al-plate');
    if (plateSel) plateSel.addEventListener('change', function () { if (project) selectPlate(this.value); });
  }

  /* ================================================================== */
  /*  2) CALCULATEUR DE PRIX                                              */
  /* ================================================================== */

  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }

  // Modèle fidèle à FarmLoop : main d'œuvre = taux horaire × minutes,
  // prep amortie sur le nombre de loops, post par pièce.
  var PRICE_MAP = {
    'ap-time-h': 'timeH', 'ap-time-m': 'timeM', 'ap-weight': 'weight',
    'ap-loops': 'loops', 'ap-cooldown': 'cooldown', 'ap-failure': 'failure',
    'ap-filament-kg': 'filamentKg', 'ap-deprec': 'deprec', 'ap-elec': 'elec',
    'ap-consumables': 'consumables', 'ap-rate': 'rate',
    'ap-prep-model': 'prepModel', 'ap-prep-slice': 'prepSlice', 'ap-prep-transfer': 'prepTransfer',
    'ap-post-removal': 'postRemoval', 'ap-post-support': 'postSupport', 'ap-post-additional': 'postAdditional',
    'ap-price': 'salePrice'
  };

  // Unité du résumé : 1 = à la pièce, 2 = à la paire (les spacers se vendent
  // par paire). Les entrées restent PAR PIÈCE (le gcode décrit une pièce) : seul
  // le résumé est multiplié, et le prix de vente saisi vaut pour l'unité choisie.
  var UNIT_KEY = 'al-price-unit';
  var unitK = 2;   // paire par défaut, dernier choix mémorisé
  try { if (localStorage.getItem(UNIT_KEY) === '1') unitK = 1; } catch (e) {}

  function setUnit(k) {
    if (k === unitK) return;
    // Le prix suit l'unité (6,94 $/pièce ⇄ 13,88 $/paire) : la marge ne bouge pas.
    var pe = $('#ap-price');
    if (pe && pe.value !== '') pe.value = (Math.round(num(pe.value, 0) * k / unitK * 100) / 100).toFixed(2);
    unitK = k;
    try { localStorage.setItem(UNIT_KEY, String(k)); } catch (e) {}
    recompute();
  }

  function priceFields() {
    var f = {};
    Object.keys(PRICE_MAP).forEach(function (id) {
      var el = $('#' + id);
      f[PRICE_MAP[id]] = el ? num(el.value, 0) : 0;
    });
    f.loops = Math.max(1, Math.round(f.loops) || 1);
    return f;
  }

  function compute(f) {
    // Temps machine par pièce = impression + refroidissement/éjection entre loops.
    // La P2S est occupée pendant le cooldown → il compte dans la dépréciation et
    // l'électricité, mais évidemment pas dans le filament.
    var hours = (f.timeH * 60 + f.timeM + f.cooldown) / 60;
    var filamentCost = f.weight * f.filamentKg / 1000;
    var deprecCost = hours * f.deprec;
    var elecCost = hours * f.elec;
    // prep : tâches faites une fois par batch, amorties sur les loops
    var prepMin = (f.prepModel + f.prepSlice + f.prepTransfer) / f.loops;
    // post : par pièce
    var postMin = f.postRemoval + f.postSupport + f.postAdditional;
    var laborPrep = prepMin / 60 * f.rate;
    var laborPost = postMin / 60 * f.rate;
    var consumables = f.consumables;
    var subtotal = filamentCost + deprecCost + elecCost + consumables + laborPrep + laborPost;
    var failure = subtotal * f.failure / 100;
    var cost = subtotal + failure;
    // On fixe le prix de vente ; la marge (% du prix de vente) est déduite.
    var price = f.salePrice > 0 ? f.salePrice : cost;
    var marginAmt = price - cost;
    var marginPct = price > 0 ? marginAmt / price * 100 : 0;
    return {
      filamentCost: filamentCost, deprecCost: deprecCost, elecCost: elecCost,
      consumables: consumables, laborPrep: laborPrep, laborPost: laborPost,
      prepMin: prepMin, postMin: postMin,
      subtotal: subtotal, failure: failure, failurePct: f.failure,
      cost: cost, price: price, marginAmt: marginAmt, marginPct: marginPct
    };
  }


  // Prix de départ : ~33 % de marge sur le coût (de l'unité choisie), arrondi à 0,05 $.
  function autoPrice() {
    var pe = $('#ap-price');
    if (!pe) return;
    var c = compute(priceFields()).cost * unitK;
    if (c > 0) pe.value = (Math.round(c / (1 - 0.33) * 20) / 20).toFixed(2);
  }

  // Prix saisi pour l'unité → prix par pièce ; tout est calculé par pièce, puis × k à l'affichage.
  function pricePerPiece() {
    var f = priceFields();
    f.salePrice = f.salePrice / unitK;
    return { f: f, r: compute(f) };
  }

  function recompute() {
    var p = pricePerPiece(), f = p.f, r = p.r;
    var k = unitK;
    var set = function (id, v) { var el = $('#' + id); if (el) el.textContent = v; };
    // Batch = valeurs par pièce × loops (temps, filament, coût, profit).
    // Les loops restent des pièces (c'est ce que fait l'imprimante) ; en mode
    // paire on précise juste combien de paires ça donne.
    var n = f.loops, pairs = n / 2;
    var pieces = n + ' pièce' + (n > 1 ? 's' : '');
    var pairsTxt = k === 2 ? String(pairs).replace('.', ',') + ' paire' + (pairs >= 2 ? 's' : '') : '';
    // Libellés du batch dans le résumé : l'unité choisie seulement (« (36 paires) ») —
    // le nombre de pièces est déjà sur la ligne Batch ; « 72 pièces · 36 paires »
    // passait sur 2 lignes sur téléphone.
    var nLabel = '(' + (pairsTxt || pieces) + ')';
    var printMin = (f.timeH * 60 + f.timeM) * n, coolMin = f.cooldown * n;
    set('ap-batch', 'Batch de ' + pieces + (pairsTxt ? ' (' + pairsTxt + ')' : '') + ' : ' + fmtHm(printMin + coolMin) +
        (coolMin > 0 ? ' (dont ' + fmtHm(coolMin) + ' de refroidissement)' : '') +
        ' · ' + (Math.round(f.weight * n * 100) / 100).toString().replace('.', ',') + ' g de filament');
    set('ap-out-batch-n', nLabel);
    set('ap-out-batch-n2', nLabel);
    set('ap-out-batch-cost', money(r.cost * n));
    set('ap-out-batch-profit', money(r.marginAmt * n));
    set('ap-out-filament', money(r.filamentCost * k));
    set('ap-out-deprec', money(r.deprecCost * k));
    set('ap-out-elec', money(r.elecCost * k));
    set('ap-out-consumables', money(r.consumables * k));
    set('ap-out-prep', money(r.laborPrep * k));
    set('ap-out-post', money(r.laborPost * k));
    set('ap-out-failure', '+' + money(r.failure * k));
    set('ap-out-failure-pct', '(' + (Math.round(r.failurePct * 10) / 10) + ' %)');
    set('ap-out-cost', money(r.cost * k));
    set('ap-out-margin-pct', (Math.round(r.marginPct * 10) / 10).toString().replace('.', ',') + ' %');
    set('ap-out-margin-amt', money(r.marginAmt * k));
    var profit = $('#ap-out-margin-amt');
    if (profit) profit.style.color = r.marginAmt < 0 ? 'var(--bad)' : '';
    set('ap-prep-permin', (Math.round(r.prepMin * 100) / 100) + ' min');
    set('ap-post-permin', (Math.round(r.postMin * 100) / 100) + ' min');
    $$('.ap-unit-lbl').forEach(function (el) { el.textContent = k === 2 ? '/ paire' : '/ pièce'; });
    $$('#ap-unit .al-unit-b').forEach(function (b) { b.setAttribute('aria-checked', String(+b.dataset.unit === k)); });
    drawBreakdown(r, k);
    if (lastRep) renderReport(lastRep);   // l'aperçu du prix dans le rapport suit le calculateur
  }

  // Camembert (conic-gradient, sans dépendance) : répartition du coût.
  function drawBreakdown(r, mult) {
    var wrap = $('#ap-breakdown');
    if (!wrap) return;
    var parts = [
      { k: 'Filament', v: r.filamentCost, c: '#FF6A2B' },
      { k: 'Dépréciation', v: r.deprecCost, c: '#E24E15' },
      { k: 'Électricité', v: r.elecCost, c: '#F0A02B' },
      { k: 'Consommables', v: r.consumables, c: '#EF3E82' },
      { k: 'M.O. prep', v: r.laborPrep, c: '#B7472A' },
      { k: 'M.O. post', v: r.laborPost, c: '#8A5A3B' },
      { k: 'Échec', v: r.failure, c: '#C9A227' }
    ].map(function (p) { p.v *= mult || 1; return p; })
     .filter(function (p) { return p.v > 0.0001; });
    var total = parts.reduce(function (s, p) { return s + p.v; }, 0) || 1;
    var acc = 0, stops = parts.map(function (p) {
      var from = acc / total * 360, to = (acc + p.v) / total * 360; acc += p.v;
      return p.c + ' ' + from.toFixed(1) + 'deg ' + to.toFixed(1) + 'deg';
    }).join(', ');
    var legend = parts.map(function (p) {
      return '<div class="ap-leg"><span class="ap-dot" style="background:' + p.c + '"></span>' +
        p.k + '<span class="ap-leg-v">' + money(p.v) + ' · ' + Math.round(p.v / total * 100) + '%</span></div>';
    }).join('');
    wrap.innerHTML =
      '<div class="ap-donut" style="background:conic-gradient(' + (stops || '#E7E7E2 0deg 360deg') + ')">' +
        '<div class="ap-donut-hole"><span>' + money(r.cost * (mult || 1)) + '</span></div></div>' +
      '<div class="ap-legend">' + legend + '</div>';
  }

  function initPricing() {
    var wrap = $('.al-view[data-view="prix"]');
    if (!wrap) return;
    $$('input', wrap).forEach(function (i) { i.addEventListener('input', recompute); });

    $$('#ap-unit .al-unit-b').forEach(function (b) {
      b.addEventListener('click', function () { setUnit(+b.dataset.unit); });
    });

    autoPrice();
    recompute();
  }

  /* ================================================================== */
  /*  3) VALEURS PAR DÉFAUT (réglées par Théo, sans toucher au code)      */
  /* ================================================================== */
  /* Sans défauts enregistrés : les value="" du HTML. « Enregistrer comme défauts »
     mémorise les champs d'une vue — générateur : réglages du batch (pas la
     grille case par case, qui suit les « tous les X ») ; calculateur : les
     coûts (pas le temps / poids / loops / prix de la pièce chargée) — dans
     admin_settings (clé « autoloop », synchro entre appareils) + une copie
     locale appliquée dès l'ouverture, avant la réponse du serveur.        */
  var DEF_FIELDS = {
    gcode: ['al-loops', 'al-cal-flow-every', 'al-cal-bed-every', 'al-bend-enable', 'al-bend-high', 'al-bend-low',
            'al-bend-speed', 'al-bend-cycles', 'al-push-offset', 'al-push-speed',
            'al-push-passes', 'al-push-back', 'al-push-front', 'al-purge-len',
            'al-wipe-passes', 'al-cool-mode', 'al-cool-fresh', 'al-cool-z', 'al-cool-temp', 'al-cool-sec', 'al-cool-est'],
    prix: ['ap-cooldown', 'ap-failure', 'ap-filament-kg', 'ap-consumables', 'ap-deprec', 'ap-elec', 'ap-rate',
           'ap-prep-model', 'ap-prep-slice', 'ap-prep-transfer', 'ap-post-removal', 'ap-post-support', 'ap-post-additional']
  };
  var DEF_KEY = 'autoloop', DEF_LS = 'al-defaults';
  var saved = null;                        // saved = { gcode: {id: valeur}, prix: {…}, at: { gcode: iso, prix: iso } }
  var touched = { gcode: false, prix: false };   // champs modifiés à la main depuis l'ouverture

  function readLocal() {
    try { var v = JSON.parse(localStorage.getItem(DEF_LS) || 'null'); return v && typeof v === 'object' ? v : null; }
    catch (e) { return null; }
  }
  function writeLocal(v) { try { localStorage.setItem(DEF_LS, JSON.stringify(v)); } catch (e) {} }

  function snapshot(view) {
    var o = {};
    DEF_FIELDS[view].forEach(function (id) {
      var el = $('#' + id);
      if (el) o[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return o;
  }
  // Pose les valeurs ; `notify` relance les écouteurs (grille, cooldown, flexion, résumé des prix).
  function applyValues(vals, notify) {
    Object.keys(vals || {}).forEach(function (id) {
      var el = $('#' + id), v = vals[id];
      if (!el || DEF_FIELDS.gcode.concat(DEF_FIELDS.prix).indexOf(id) === -1) return;
      if (el.type === 'checkbox') {
        if (el.checked === !!v) return;
        el.checked = !!v;
      } else {
        v = String(v);
        if (el.value === v) return;
        if (el.tagName === 'SELECT' && !$$('option', el).some(function (o) { return o.value === v; })) return;
        el.value = v;
      }
      if (notify) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }
  function shortDay(iso) {
    try { return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; }
  }
  // Statut court à côté de « Valeurs par défaut » ; le détail d'une erreur va dans l'infobulle.
  function defsMsg(view, text, tone, detail) {
    var el = $('.al-defs[data-defs="' + view + '"] .al-defs-msg');
    if (!el) return;
    el.textContent = text;
    el.title = detail || '';
    el.className = 'al-defs-msg' + (tone ? ' is-' + tone : '');
  }
  function defsStatus(view) {
    var at = saved && saved.at && saved.at[view];
    defsMsg(view, saved && saved[view] ? 'enregistrées' + (at ? ' le ' + shortDay(at) : '') : '');
  }

  // Avant initGcode / initPricing : leur premier rendu part des défauts locaux.
  function loadLocalDefaults() {
    saved = readLocal();
    if (saved) { applyValues(saved.gcode, false); applyValues(saved.prix, false); }
  }

  // Après connexion : la version serveur (enregistrée sur un autre appareil ?) remplace
  // la copie locale ; une vue déjà modifiée à la main n'est pas écrasée.
  function loadRemoteDefaults() {
    var sb = window.CA && window.CA.sb;
    if (!sb) return;
    sb.from('admin_settings').select('value').eq('key', DEF_KEY).maybeSingle().then(function (res) {
      if (res.error || !res.data || !res.data.value) return;   // rien en ligne : on garde le local
      // Vue par vue, la version la plus récente gagne (un enregistrement resté
      // local faute de réseau n'est pas écrasé par une version serveur plus vieille).
      var remote = res.data.value, cur = saved || {}, merged = { at: {} };
      ['gcode', 'prix'].forEach(function (view) {
        var ra = (remote.at && remote.at[view]) || '', la = (cur.at && cur.at[view]) || '';
        var src = remote[view] && (!cur[view] || ra >= la) ? remote : cur;
        if (src[view]) { merged[view] = src[view]; merged.at[view] = src.at && src.at[view]; }
      });
      if (JSON.stringify(merged) === JSON.stringify(cur)) return;
      saved = merged; writeLocal(merged);
      ['gcode', 'prix'].forEach(function (view) {
        if (!touched[view] && merged[view]) applyValues(merged[view], true);
        defsStatus(view);
      });
    }, function () {});
  }

  function saveDefaults(view, btn) {
    var next = JSON.parse(JSON.stringify(saved || {}));
    next[view] = snapshot(view);
    next.at = next.at || {};
    next.at[view] = new Date().toISOString();
    saved = next; writeLocal(next);
    var sb = window.CA && window.CA.sb;
    if (!sb) { defsMsg(view, 'cet appareil seulement', 'warn'); return; }
    btn.disabled = true;
    defsMsg(view, 'enregistrement…');
    sb.from('admin_settings').upsert({ key: DEF_KEY, value: next, updated_at: next.at[view] }).then(function (res) {
      btn.disabled = false;
      if (res.error) defsMsg(view, 'cet appareil seulement', 'warn', res.error.message);
      else defsMsg(view, 'enregistré ✓', 'ok');
    }, function (err) {
      btn.disabled = false;
      defsMsg(view, 'cet appareil seulement', 'warn', err && err.message ? err.message : String(err));
    });
  }

  function initDefaults() {
    $$('.al-defs').forEach(function (bar) {
      var view = bar.dataset.defs;
      $('[data-defs-save]', bar).addEventListener('click', function () { saveDefaults(view, this); });
      defsStatus(view);
    });
    $$('.al-view').forEach(function (v) {
      var view = v.dataset.view;
      var mark = function (e) { if (e.isTrusted && DEF_FIELDS[view].indexOf(e.target.id) !== -1) touched[view] = true; };
      v.addEventListener('input', mark, true);
      v.addEventListener('change', mark, true);
    });
    if (window.CA && window.CA.onAdminReady) window.CA.onAdminReady(loadRemoteDefaults);
  }

  /* ------------------------------------------------------------------ */
  function init() {
    if ($('#al-subnav')) { loadLocalDefaults(); initSubtabs(); initGcode(); initPricing(); initDefaults(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
