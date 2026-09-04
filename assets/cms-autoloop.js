/* =========================================================
   Création Audio V2 — AutoLoop (intégré à l'admin)
   Outil 100% client-side. Aucune donnée envoyée nulle part.
   1) Traitement Gcode : optimise un fichier multi-loop FarmLoop
      (calibration par intervalle, hauteur de push auto, bending
      motion régénéré, cooldown configurable, strip AMS optionnel).
   2) Calculateur de prix : coût de production / prix de vente,
      profils sauvegardés en localStorage.

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

  var num = function (v, dflt) {
    var n = parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : (dflt == null ? 0 : dflt);
  };
  var intOr = function (v, dflt) {
    var n = parseInt(v, 10);
    return isFinite(n) ? n : dflt;
  };

  // Détecte la fin de ligne dominante du fichier.
  function detectEol(text) { return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n'; }
  // Formate un nombre en gcode : 2 décimales.
  function z(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  /* ---- Ancrages (validés contre de vrais fichiers P2S) ---------------
     Ne PAS modifier sans re-tester contre un vrai gcode brut. Réf : Auto Loop.md.
     - END_ANCHOR : frontière corps→end gcode. On coupe ici et on reconstruit
       la fin. ATTENTION : « ;======== P2S end gcode » apparaît aussi dans le
       commentaire de config (; machine_end_gcode = …) BIEN plus tôt ; on utilise
       donc « ; MACHINE_END_GCODE_START » qui, lui, est unique et exécuté.
     - START_ANCHOR : point d'insertion des flags de calibration.
     - RE_MAXZ : hauteur de la pièce (base du calcul de push).                     */
  var END_ANCHOR = '; MACHINE_END_GCODE_START';
  var RE_START_ANCHOR = /(;======== P2S start gcode==========\r?\n;=====[^\r\n]*\r?\n)/;
  var RE_MAXZ = /;\s*max_z_height:\s*([\d.]+)/;

  // Loop calibré ? Loop 1 toujours ; puis tous les `interval` loops si interval>0.
  function calibrateLoop(i, interval) {
    if (i === 1) return true;
    if (interval > 0) return ((i - 1) % interval) === 0;
    return false;
  }

  // Insère les flags de calibration au bon endroit du start gcode.
  // Loop calibré : on ne touche à rien (la calibration native s'exécute).
  // Loop non calibré : on force extrude_cali_flag=0 / g29_before_print_flag=0.
  function insertFlags(head, calibrate, eol) {
    if (calibrate || !RE_START_ANCHOR.test(head)) return head;
    var ins = 'M1002 set_flag extrude_cali_flag=0' + eol +
              'M1002 set_flag g29_before_print_flag=0' + eol;
    return head.replace(RE_START_ANCHOR, '$1' + ins.replace(/\$/g, '$$$$'));
  }

  /* --- Transition entre deux loops (fin de job + éjection) -------------
     Reconstruite à partir des valeurs PROUVÉES du fichier P2S qui imprime
     déjà (dégagement Z, flexion, push, balayages, parking). Seul le push
     est paramétré (= % de la hauteur de la pièce). On n'invente aucun
     mouvement : on rejoue une séquence validée.                            */
  function buildTransition(opts, pushZ, maxZ, eol) {
    var L = [];
    var pushSpeed = Math.round(opts.pushSpeed);
    L.push(';======== P2S end gcode ==========');
    L.push(';===== AutoLoop — fin de loop / éjection =====');
    L.push('M400 ; wait for buffer to clear');
    L.push('G92 E0 ; zero the extruder');
    L.push('M211 Z1');
    L.push('');
    L.push('G90');
    L.push('G1 Z' + z(maxZ + 0.4) + ' F900 ; lower z a little');
    L.push('M1002 judge_flag timelapse_record_flag');
    L.push('M622 J1');
    L.push('    G150.3');
    L.push('    M400 ; wait all motion done');
    L.push('    M991 S0 P-1 ;end smooth timelapse at safe pos');
    L.push('    M400 S5 ;wait for last picture to be taken');
    L.push('M623  ;end of "timelapse_record_flag');
    L.push('');
    L.push('G90');
    L.push('G1 Z' + z(opts.clearZ) + ' F900 ; dégagement avant éjection');
    L.push('');
    L.push('M140 S0 ; turn off bed');
    L.push('M106 S0 ; turn off fan');
    L.push('M106 P2 S0 ; turn off remote part cooling fan');
    L.push('M106 P3 S0 ; turn off chamber cooling fan');
    L.push('M106 P10 S0 ; turn off left aux fan');
    L.push('');
    L.push('G150.3');
    L.push('M104 S0 ; turn off hotend');
    L.push('M400 ; wait all motion done');
    L.push('M140 S0 ; turn off bed');
    L.push('M104 S0 ; turn off hotend');
    // Cooldown
    if (opts.coolMode !== 'none') {
      L.push('M106 P2 S255 ; turn on remote part cooling fan');
      L.push('');
      L.push(';Cooldown Start');
      L.push(opts.coolMode === 'temp' ? ('M190 S' + Math.round(opts.coolTemp) + ' ; attendre température plateau')
                                       : ('G4 S' + Math.round(opts.coolSec) + ' ; délai fixe'));
      L.push(';Cooldown End');
    }
    // Flexion (bending motion)
    if (opts.bendEnable && opts.bendCycles > 0) {
      L.push('');
      L.push(';============================  BENDING MOTION  ============================');
      for (var c = 1; c <= opts.bendCycles; c++) {
        L.push('G1 Z' + z(opts.bendHigh) + ' F' + Math.round(opts.bendSpeed) + ' ; bend-up #' + c);
        L.push('G1 Z' + z(opts.bendLow) + ' F' + Math.round(opts.bendSpeed) + ' ; bend-down #' + c);
      }
    }
    // Push + balayages centraux (éjection)
    L.push('');
    L.push(';============================= PUSH SECTION =============================');
    L.push('G1 Z' + z(pushZ) + ' F' + pushSpeed + ' ; hauteur de push = ' + opts.pushPct + '% de la hauteur pièce');
    L.push('M400');
    L.push('G1 X125 F3000 ; balayage central');
    L.push('G1 Y250 F3000 ; bord arrière');
    L.push('G1 Y0   F3000 ; bord avant');
    L.push('G1 Y250 F3000 ; bord arrière (2e passe)');
    L.push('G1 Y0   F3000 ; bord avant');
    L.push(';===============================  END SECTION  =============================');
    L.push('G1 X65 Y245 F12000 ; coin sûr avant parking');
    L.push('G1 Y265 F3000 ; parking final (position repos)');
    L.push('M106 S0 ; turn off fan');
    L.push('M106 P2 S0 ; turn off remote part cooling fan');
    L.push('M106 P3 S0 ; turn off chamber cooling fan');
    L.push('M106 P10 S0 ; turn off left aux fan');
    L.push('M400 ; wait all motion done');
    L.push('M17 S');
    L.push('M17 Z0.4 ; lower z motor current');
    L.push('G1 Z20.2 F600');
    L.push('G1 Z20.2');
    L.push('M400 P100');
    L.push('M17 R ; restore z current');
    L.push('M220 S100 ; Reset feedrate magnitude');
    L.push('M201.2 K1.0 ; Reset acc magnitude');
    L.push('M73.2 R1.0 ; Reset left time magnitude');
    L.push('M1002 set_gcode_claim_speed_level : 0');
    L.push('M1015.3 S0 ; disable clog detect');
    L.push('M1015.4 S0 K0 ; disable air printing detect');
    L.push('M400');
    L.push('M104 S0 ; turn off hotend');
    L.push('M140 S0 ; turn off bed');
    L.push('; EXECUTABLE_BLOCK_END');
    return L.join(eol) + eol;
  }

  // Séparateur inséré entre la transition du loop k et le loop k+1.
  function buildSeparator(nextI, N, opts, eol) {
    return eol +
      '; === END OF LOOP ' + (nextI - 1) + ' ===' + eol +
      '; Préparation du loop suivant…' + eol +
      'G4 S' + Math.round(opts.loopPause) + ' ; pause entre loops' + eol + eol +
      '; === LOOP ' + nextI + ' OF ' + N + ' ===' + eol;
  }

  /* --- Génération du batch complet ----------------------------------- */
  function generateBatch(raw, opts) {
    var eol = detectEol(raw);
    var report = {
      ok: false, loops: opts.loops, eol: eol === '\r\n' ? 'CRLF' : 'LF',
      maxZ: null, pushZ: null, calibrated: [], bendsPerLoop: 0, size: 0, error: null
    };
    var idx = raw.indexOf(END_ANCHOR);
    var mz = raw.match(RE_MAXZ);
    if (idx === -1) { report.error = 'Frontière « ' + END_ANCHOR + ' » introuvable — ce n\'est pas un gcode P2S brut exporté du slicer.'; return { text: '', report: report }; }
    if (!mz) { report.error = 'Impossible de lire « max_z_height » dans l\'en-tête du fichier.'; return { text: '', report: report }; }
    if (!RE_START_ANCHOR.test(raw)) { report.error = 'Ancrage du start gcode P2S introuvable.'; return { text: '', report: report }; }

    var maxZ = parseFloat(mz[1]);
    var pushZ = Math.max(maxZ * opts.pushPct / 100, 0);
    report.maxZ = maxZ; report.pushZ = pushZ;
    report.bendsPerLoop = (opts.bendEnable && opts.bendCycles > 0) ? opts.bendCycles * 2 : 0;

    var head = raw.slice(0, idx);   // pièce complète (header + config + start + corps), sans le end gcode natif
    var N = opts.loops;
    var trans = buildTransition(opts, pushZ, maxZ, eol);   // identique pour chaque loop

    var parts = [];
    parts.push('; ===================================================' + eol +
               '; Batch généré par AutoLoop — Création Audio' + eol +
               '; ' + N + ' loops · pièce ' + z(maxZ) + ' mm · push ' + z(pushZ) + ' mm (' + opts.pushPct + '%)' + eol +
               '; Aucune dépendance FarmLoop.' + eol +
               '; ===================================================' + eol + eol);

    for (var i = 1; i <= N; i++) {
      var cal = calibrateLoop(i, opts.calInterval);
      if (cal) report.calibrated.push(i);
      // Le header du loop 1 est écrit ici ; ceux des loops suivants viennent du séparateur.
      if (i === 1) parts.push('; === LOOP 1 OF ' + N + ' ===' + eol);
      parts.push(insertFlags(head, cal, eol));
      parts.push(trans);
      if (i < N) parts.push(buildSeparator(i + 1, N, opts, eol));
    }
    var out = parts.join('');
    report.size = out.length;
    report.ok = true;
    return { text: out, report: report };
  }

  /* --- UI Générateur -------------------------------------------------- */
  function readOpts() {
    return {
      loops: Math.max(1, intOr($('#al-loops').value, 12)),
      calInterval: Math.max(0, intOr($('#al-cal-interval').value, 0)),
      bendEnable: $('#al-bend-enable').checked,
      bendHigh: num($('#al-bend-high').value, 240),
      bendLow: num($('#al-bend-low').value, 205),
      bendSpeed: num($('#al-bend-speed').value, 12000),
      bendCycles: Math.max(0, intOr($('#al-bend-cycles').value, 6)),
      pushPct: num($('#al-push-pct').value, 50),
      pushSpeed: num($('#al-push-speed').value, 10000),
      clearZ: num($('#al-clearz').value, 105),
      coolMode: $('#al-cool-mode').value,
      coolTemp: num($('#al-cool-temp').value, 45),
      coolSec: num($('#al-cool-sec').value, 60),
      loopPause: num($('#al-loop-pause').value, 2)
    };
  }

  function fmtSize(bytes) {
    return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' Mo' : (bytes / 1024).toFixed(0) + ' Ko';
  }

  function renderReport(rep) {
    var box = $('#al-report');
    if (rep.error) { box.innerHTML = '<p class="al-warn">' + rep.error + '</p>'; return; }
    box.innerHTML =
      '<div class="al-stats">' +
        stat(rep.loops, 'loops générés') +
        stat(rep.calibrated.length, 'loops calibrés') +
        stat(rep.bendsPerLoop, 'strokes de flexion / loop') +
        stat(z(rep.pushZ), 'push (mm)') +
      '</div>' +
      '<p class="al-fine">Pièce : ' + z(rep.maxZ) + ' mm · fins de ligne ' + rep.eol +
        ' · fichier ~' + fmtSize(rep.size) +
        '<br>Calibration sur loop(s) : ' + (rep.calibrated.join(', ') || '—') +
        ' · les autres loops sautent extrusion + bed leveling.' +
      '</p>' +
      '<p class="al-fine al-tip">Vérifie toujours le premier loop sur la P2S avant de lancer le batch complet.</p>';
  }
  function stat(v, label) {
    return '<div class="al-stat"><span class="al-stat-v">' + v + '</span><span class="al-stat-l">' + label + '</span></div>';
  }

  function loadFile(file) {
    if (!file) return;
    rawName = file.name;
    var reader = new FileReader();
    reader.onload = function (e) {
      rawText = String(e.target.result || '');
      var mz = rawText.match(RE_MAXZ);
      $('#al-file-name').textContent = rawName + ' · ' + (rawText.length / 1024).toFixed(0) + ' Ko' +
        (mz ? ' · pièce ' + parseFloat(mz[1]).toFixed(2) + ' mm' : '');
      $('#al-process').disabled = false;
      $('#al-download').disabled = true;
      $('#al-report').innerHTML = '';
      outText = '';
    };
    reader.readAsText(file);
  }

  function runGenerate() {
    if (!rawText) return;
    var btn = $('#al-process');
    btn.disabled = true; btn.textContent = 'Génération…';
    // Laisse le navigateur peindre l'état « Génération… » avant le gros travail.
    setTimeout(function () {
      try {
        var res = generateBatch(rawText, readOpts());
        outText = res.text;
        renderReport(res.report);
        if (res.report.ok) {
          outName = rawName.replace(/\.[^.]*$/, '') + '_' + res.report.loops + 'loops.gcode';
          $('#al-download').disabled = false;
        } else {
          $('#al-download').disabled = true;
        }
      } catch (err) {
        $('#al-report').innerHTML = '<p class="al-warn">Erreur de génération : ' + (err && err.message ? err.message : err) + '</p>';
      }
      btn.disabled = false; btn.textContent = 'Générer le batch';
    }, 30);
  }

  function download() {
    if (!outText) return;
    var blob = new Blob([outText], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = outName || 'autoloop.gcode';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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
    }
    coolMode.addEventListener('change', syncCool); syncCool();
    // Flexion : activer/désactiver les champs.
    var bendEnable = $('#al-bend-enable');
    function syncBend() { $('#al-bend-fields').style.opacity = bendEnable.checked ? '1' : '.4'; }
    bendEnable.addEventListener('change', syncBend); syncBend();

    $('#al-process').addEventListener('click', runGenerate);
    $('#al-download').addEventListener('click', download);
  }

  /* ================================================================== */
  /*  2) CALCULATEUR DE PRIX                                              */
  /* ================================================================== */

  var PROFILE_KEY = 'creationaudio_farmloop_pricing_profiles';

  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }

  // Modèle fidèle à FarmLoop : main d'œuvre = taux horaire × minutes,
  // prep amortie sur le nombre de loops, post par pièce.
  var PRICE_MAP = {
    'ap-time-h': 'timeH', 'ap-time-m': 'timeM', 'ap-weight': 'weight',
    'ap-loops': 'loops', 'ap-failure': 'failure',
    'ap-filament-kg': 'filamentKg', 'ap-deprec': 'deprec', 'ap-elec': 'elec',
    'ap-consumables': 'consumables', 'ap-rate': 'rate',
    'ap-prep-model': 'prepModel', 'ap-prep-slice': 'prepSlice', 'ap-prep-transfer': 'prepTransfer',
    'ap-post-removal': 'postRemoval', 'ap-post-support': 'postSupport', 'ap-post-additional': 'postAdditional',
    'ap-margin': 'margin'
  };

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
    var hours = (f.timeH * 60 + f.timeM) / 60;
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
    var price = (f.margin > 0 && f.margin < 100) ? cost / (1 - f.margin / 100) : cost;
    return {
      filamentCost: filamentCost, deprecCost: deprecCost, elecCost: elecCost,
      consumables: consumables, laborPrep: laborPrep, laborPost: laborPost,
      prepMin: prepMin, postMin: postMin,
      subtotal: subtotal, failure: failure, failurePct: f.failure,
      cost: cost, price: price, marginAmt: price - cost, marginPct: f.margin
    };
  }

  function recompute() {
    var r = compute(priceFields());
    var set = function (id, v) { var el = $('#' + id); if (el) el.textContent = v; };
    set('ap-out-filament', money(r.filamentCost));
    set('ap-out-deprec', money(r.deprecCost));
    set('ap-out-elec', money(r.elecCost));
    set('ap-out-consumables', money(r.consumables));
    set('ap-out-prep', money(r.laborPrep));
    set('ap-out-post', money(r.laborPost));
    set('ap-out-failure', '+' + money(r.failure));
    set('ap-out-failure-pct', '(' + (Math.round(r.failurePct * 10) / 10) + ' %)');
    set('ap-out-cost', money(r.cost));
    set('ap-out-price', money(r.price));
    set('ap-out-margin-amt', money(r.marginAmt));
    set('ap-prep-permin', (Math.round(r.prepMin * 100) / 100) + ' min/pièce');
    set('ap-post-permin', (Math.round(r.postMin * 100) / 100) + ' min/pièce');
    drawBreakdown(r);
  }

  // Camembert (conic-gradient, sans dépendance) : répartition du coût.
  function drawBreakdown(r) {
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
    ].filter(function (p) { return p.v > 0.0001; });
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
        '<div class="ap-donut-hole"><span>' + money(r.cost) + '</span></div></div>' +
      '<div class="ap-legend">' + legend + '</div>';
  }

  /* --- Profils (localStorage) ---------------------------------------- */
  function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveProfiles(obj) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function refreshProfileSelect() {
    var sel = $('#ap-profile-select'), profiles = loadProfiles();
    var names = Object.keys(profiles).sort();
    sel.innerHTML = '<option value="">— profils sauvegardés —</option>' +
      names.map(function (n) { return '<option value="' + n.replace(/"/g, '&quot;') + '">' + n + '</option>'; }).join('');
  }
  function applyProfile(data) {
    if (!data) return;
    Object.keys(PRICE_MAP).forEach(function (id) {
      if (data[PRICE_MAP[id]] != null) { var el = $('#' + id); if (el) el.value = data[PRICE_MAP[id]]; }
    });
    recompute();
  }

  function initPricing() {
    var wrap = $('.al-view[data-view="prix"]');
    if (!wrap) return;
    $$('input', wrap).forEach(function (i) { i.addEventListener('input', recompute); });

    refreshProfileSelect();
    $('#ap-profile-save').addEventListener('click', function () {
      var name = ($('#ap-profile-name').value || '').trim();
      if (!name) { $('#ap-profile-status').textContent = 'Donne un nom au profil.'; return; }
      var profiles = loadProfiles();
      profiles[name] = priceFields();
      saveProfiles(profiles);
      refreshProfileSelect();
      $('#ap-profile-select').value = name;
      $('#ap-profile-status').textContent = 'Profil « ' + name + ' » enregistré.';
    });
    $('#ap-profile-select').addEventListener('change', function () {
      var name = $('#ap-profile-select').value;
      if (!name) return;
      applyProfile(loadProfiles()[name]);
      $('#ap-profile-name').value = name;
      $('#ap-profile-status').textContent = 'Profil « ' + name + ' » chargé.';
    });
    $('#ap-profile-delete').addEventListener('click', function () {
      var name = $('#ap-profile-select').value;
      if (!name) return;
      var profiles = loadProfiles();
      delete profiles[name];
      saveProfiles(profiles);
      refreshProfileSelect();
      $('#ap-profile-status').textContent = 'Profil supprimé.';
    });
    // Export / import JSON (portabilité entre appareils)
    $('#ap-export').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(loadProfiles(), null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'autoloop-profils-prix.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    var importInput = $('#ap-import');
    $('#ap-import-btn').addEventListener('click', function () { importInput.click(); });
    importInput.addEventListener('change', function () {
      var file = importInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var incoming = JSON.parse(String(e.target.result));
          var profiles = loadProfiles();
          Object.keys(incoming).forEach(function (k) { profiles[k] = incoming[k]; });
          saveProfiles(profiles);
          refreshProfileSelect();
          $('#ap-profile-status').textContent = Object.keys(incoming).length + ' profil(s) importé(s).';
        } catch (err) {
          $('#ap-profile-status').textContent = 'Fichier JSON invalide.';
        }
        importInput.value = '';
      };
      reader.readAsText(file);
    });

    recompute();
  }

  /* ------------------------------------------------------------------ */
  function init() {
    if ($('#al-subnav')) { initSubtabs(); initGcode(); initPricing(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
