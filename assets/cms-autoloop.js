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
  /* - RE_LOAD_LINE : bloc « nozzle load line » du start gcode P2S (la petite
       ligne de purge tracée devant le plateau via G130). En boucle, ce fil peut
       rester accroché au bord et être ramassé au push suivant ; on le remplace
       donc, comme FarmLoop le faisait, par une purge dans la goulotte à déchets
       (la buse y est déjà parquée par le G150.3 précédent). Bambu écrit
       « noozle » dans la balise de fin → orthographe tolérante.                */
  var RE_LOAD_LINE = /^;=+ no+z+le load line =+[^\r\n]*\r?\n([\s\S]*?)^;=+ no+z+le load line end =+[^\r\n]*\r?\n/m;
  /* - RE_AMS_PULLBACK : retrait du filament vers l'AMS, lu dans le end gcode
       natif (exécuté buse encore chaude, avant M104 S0). AutoLoop reconstruit la
       fin de chaque loop, ce bloc était donc perdu et le filament restait dans la
       tête : on le remet au DERNIER loop seulement. Cherché après END_ANCHOR ; la
       copie du commentaire de config (\n échappés, une seule ligne) ne matche pas. */
  var RE_AMS_PULLBACK = /; pull back filament to AMS\r?\n(M620 S65535\r?\n[\s\S]*?M621 S65535)\r?\n/;
  /* - RE_M73 : progression lue par l'imprimante (« M73 P<%> R<min restantes> »)
       et couche courante (« M73 L<n> »). Chaque loop étant une copie de la pièce,
       elle repartait à 0 % / 1h53 à chaque loop, et le firmware restait bloqué
       sur « couche 70/70 » dès la fin du loop 1 (il ignore un L qui redescend) :
       on réécrit les deux pour tout le batch (cf. progressSegments). « M73.2 » ne
       matche pas. M991 S0 P (notification de couche) reste par pièce.
     - RE_TOTAL_LAYERS : total de couches de l'en-tête, lu par l'imprimante pour
       afficher « couche x / total » → multiplié par le nombre de loops.       */
  var RE_M73 = /^M73 (?:P(\d+) R(\d+)|L(\d+))[^\r\n]*/gm;
  var RE_TOTAL_LAYERS = /^(; total layer number: )(\d+)/m;
  var EJECT_MIN = 1;   // flexion + push + balayages + parking ≈ 1 min (hors cooldown)

  // Remplace la ligne de purge native par une purge en goulotte. Séquence reprise
  // du fichier FarmLoop qui imprimait déjà ; la température M109 est celle du bloc
  // d'origine (temp. buse du profil). Bloc absent → gcode inchangé (signalé au rapport).
  // Après la purge, la buse suinte encore : sans essuyage, ce filet (couleur du 1er
  // filament de la pièce, pur) partait avec la tête et se collait au premier point
  // imprimé. On le fige (ventilo, comme après le M983.3 natif) puis on essuie avec la
  // séquence native du start gcode (G150.2 / G150.1, même nombre de passes qu'après
  // un changement) et on s'éloigne de la poubelle comme le start gcode.
  function replaceLoadLine(head, eol, purgeLen, passes) {
    var m = RE_LOAD_LINE.exec(head);
    if (!m) return { text: head, replaced: false };
    var t = /M109 S(\d+)/.exec(m[1]);
    var wipe = ['  M106 P1 S255 ; fige le filet de purge', '  M400 S5', '  M106 P1 S0'];
    if (passes > 0) {
      wipe.push('  G150.3 ; poubelle');
      for (var k = 0; k < passes; k++) wipe.push('  G150.2', '  G150.1 F8000');
      wipe.push('  G91', '  G1 Y-16 F12000 ; move away from the trash bin', '  G90', '  M400');
    }
    var L = [
      ';===== nozzle load line (AutoLoop : purge en goulotte, pas de ligne sur le plateau) =====',
      'M1002 gcode_claim_action : 51',
      '  G29.2 S1 ; ensure z comp turn on',
      t ? '  M109 S' + t[1] : '  ; (température buse introuvable dans le bloc natif — déjà chauffée par M104 A)',
      '  M975 S1',
      '  G90',
      '  M83',
      '  T1000',
      '  G92 E0',
      '  G1 E' + z(purgeLen) + ' F200 ; purge dans la goulotte à déchets',
      '  M400'
    ].concat(wipe, [
      '  G1 X100 F21000',
      '  M400',
      ';===== nozzle load line end ====='
    ]);
    return { text: head.slice(0, m.index) + L.join(eol) + eol + head.slice(m.index + m[0].length), replaced: true };
  }

  /* - RE_FIL_TOTALS : totaux de filament de l'en-tête (longueur, volume, poids ;
       une valeur par filament, « 38.87,0.17 ») → multipliés par le nombre de
       loops, comme le total de couches. Bambu Studio, lui, affiche le total lu
       dans slice_info.config du projet (pas recalculé depuis le gcode,
       contrairement au temps) : réécrit à part, cf. autoloop-3mf.js.          */
  var RE_FIL_TOTALS = /^(; total filament (?:length \[mm\]|volume \[cm\^3\]|weight \[g\]) : )([\d.,]+)/gm;
  function scaleFilTotals(head, N) {
    return head.replace(RE_FIL_TOTALS, function (m, label, list) {
      return label + list.split(',').map(function (v) { return z(parseFloat(v) * N); }).join(',');
    });
  }
  // Poids d'une pièce (somme des filaments), lu dans l'en-tête — pour le rapport.
  function pieceWeight(head) {
    var m = /^; total filament weight \[g\] : ([\d.,]+)/m.exec(head);
    return m ? m[1].split(',').reduce(function (s, v) { return s + (parseFloat(v) || 0); }, 0) : 0;
  }

  /* - Nettoyage de la buse après changement de filament. Après sa purge, le gcode
       de changement P2S fait « M983.3 … » (calibration dynamique) puis s'éloigne
       de la poubelle (« G1 Y247 ») sans essuyer la buse. Le start gcode P2S, lui,
       après le même M983.3 : G150.3 (poubelle), puis G150.2 + G150.1 F8000 deux
       fois, puis s'éloigne. On insère cette séquence native (sans sa rétraction
       E-3 : le M983.3 … R<n> recule déjà) juste avant le « G1 Y » qui suit le
       M983.3, dans le chemin normal seulement (avant M621 ; la branche reprise
       après coupure de courant reste telle quelle). passes = paires G150.2/G150.1. */
  function addChangeWipe(head, passes, eol) {
    var res = { text: head, changes: 0, done: 0, passes: passes };
    var re = /^;=+ P2S filament_change gcode =+/gm, out = '', last = 0, m;
    var blk = [';===== AutoLoop : nettoyage de la buse après changement de filament (séquence du start gcode P2S) =====',
               'G150.3 ; poubelle'];
    for (var k = 0; k < passes; k++) blk.push('G150.2', 'G150.1 F8000');
    blk.push(';===== AutoLoop : fin du nettoyage =====');
    while ((m = re.exec(head))) {
      res.changes++;
      var end = head.indexOf('\nM621 S', m.index);            // fin du bloc AMS (chemin normal)
      if (end === -1) continue;
      var cal = head.indexOf('\nM983.3 ', m.index);
      if (cal === -1 || cal > end) continue;
      // Après le M983.3, seules des lignes M400 / vides sont tolérées jusqu'au « G1 Y ».
      var reY = /^([^\r\n]*)\r?\n/gm, y, at = -1;
      reY.lastIndex = head.indexOf('\n', cal + 1) + 1;
      while ((y = reY.exec(head)) && y.index < end) {
        if (/^G1 Y/.test(y[1])) { at = y.index; break; }
        if (!/^(M400\b.*|\s*)$/.test(y[1])) break;
      }
      if (at === -1) continue;
      res.done++;
      if (passes > 0) {
        out += head.slice(last, at) + blk.join(eol) + eol;
        last = at;
      }
      re.lastIndex = Math.max(re.lastIndex, end);
    }
    res.text = last ? out + head.slice(last) : head;
    return res;
  }

  // Motif « tous les N loops » (champ de chaque ligne de la grille) : loop 1, puis 1+N, 1+2N…
  // interval 0 = loop 1 seulement.
  function calibrateLoop(i, interval) {
    if (i === 1) return true;
    if (interval > 0) return ((i - 1) % interval) === 0;
    return false;
  }

  // Insère les flags de calibration du loop au début du start gcode.
  // Toujours écrits (0 ou 1) : la grille a le dernier mot sur la fenêtre d'envoi
  // de Bambu Studio. Le start gcode P2S lit ces flags à 3 états (M622 J0/J1/J2 :
  // off / on / auto) ; 1 = branche complète (M983.3 flow, G29 A1 bed leveling).
  function insertFlags(head, i, flow, bed, eol) {
    if (!RE_START_ANCHOR.test(head)) return head;
    var ins = '; AutoLoop — loop ' + i + ' : flow ' + (flow ? 'ON' : 'OFF') + ', bed leveling ' + (bed ? 'ON' : 'OFF') + eol +
              'M1002 set_flag extrude_cali_flag=' + (flow ? 1 : 0) + eol +
              'M1002 set_flag g29_before_print_flag=' + (bed ? 1 : 0) + eol;
    return head.replace(RE_START_ANCHOR, '$1' + ins.replace(/\$/g, '$$$$'));
  }

  /* --- Progression du batch complet -----------------------------------
     On découpe la pièce une fois autour de ses lignes M73 P/R, puis chaque
     loop recolle les morceaux avec des valeurs globales :
       cycle    = durée d'un loop (1er R du slicer) + transition estimée
       restant  = R du loop + transition de ce loop + loops suivants × cycle
       %        = part du batch écoulée (99 max ; 100 posé à la toute fin).
     Le restant ne dépend que de ce qui reste à faire : un cooldown plus long
     que prévu ne s'accumule pas, l'estimation se recale au loop suivant.   */
  // Couches : loop i, couche n → (i − 1) × couches par pièce + n (toujours croissant).
  function progressSegments(head, layersPer) {
    var chunks = [], toks = [], rs = [], maxL = 0, last = 0, m;
    RE_M73.lastIndex = 0;
    while ((m = RE_M73.exec(head))) {
      chunks.push(head.slice(last, m.index));
      if (m[3] != null) {
        var l = parseInt(m[3], 10);
        toks.push({ l: l });
        if (l > maxL) maxL = l;
      } else {
        var r = parseInt(m[2], 10);
        toks.push({ r: r });
        rs.push(r);
      }
      last = m.index + m[0].length;
    }
    chunks.push(head.slice(last));
    return { chunks: chunks, toks: toks, rs: rs, loopMin: rs.length ? Math.max.apply(null, rs) : 0,
             layers: layersPer || maxL };
  }
  function progressHead(seg, i, N, transMin) {
    var cycle = seg.loopMin + transMin, total = N * cycle, out = seg.chunks[0];
    var off = (i - 1) * seg.layers;
    for (var k = 0; k < seg.toks.length; k++) {
      var t = seg.toks[k];
      if (t.l != null) {
        out += 'M73 L' + (off + t.l) + seg.chunks[k + 1];
        continue;
      }
      var rem = t.r + transMin + (N - i) * cycle;
      var pct = total > 0 ? Math.min(99, Math.max(0, Math.floor(100 * (total - rem) / total))) : 0;
      out += 'M73 P' + pct + ' R' + Math.round(rem) + seg.chunks[k + 1];
    }
    return out;
  }
  // Transition estimée (min) : cooldown selon le mode + éjection.
  function transitionMin(opts) {
    if (opts.coolMode === 'temp') return Math.max(0, opts.coolEst);
    if (opts.coolMode === 'delay') return opts.coolSec / 60 + EJECT_MIN;
    return EJECT_MIN;
  }

  // [1,2,3,5,9] -> « 1–3, 5, 9 » (liste compacte pour le rapport et l'en-tête).
  function loopRanges(list) {
    var out = [], a = null, b = null;
    list.concat([null]).forEach(function (n) {
      if (n !== null && b !== null && n === b + 1) { b = n; return; }
      if (a !== null) out.push(a === b ? String(a) : a + (b === a + 1 ? ', ' : '–') + b);
      a = b = n;
    });
    return out.join(', ');
  }

  /* --- Hauteur de push ------------------------------------------------
     Normalement hauteur max − retrait. Pièce de 10 mm ou moins : ce calcul
     tombait à 0 (borné) → la tête descendait au ras du plateau. Juste
     au-dessus (10,5 mm → 0,5 mm), le push restait presque au ras aussi.
     Règles de Théo : mi-hauteur de la pièce si elle fait ≤ 10 mm (low) OU si
     le push calculé ferait moins de 2 mm (couvre aussi un retrait plus grand
     que la pièce) ; un avertissement s'affiche. Arrondi au centième avant de
     comparer : 12,2 − 10,2 ne doit pas donner 1,9999… et basculer.          */
  var PUSH_LOW_MAX = 10, PUSH_MIN = 2;
  function pushHeight(maxZ, offset) {
    var std = Math.round((maxZ - offset) * 100) / 100;
    var low = maxZ <= PUSH_LOW_MAX;
    var half = low || std < PUSH_MIN;
    return { z: half ? maxZ / 2 : std, half: half, low: low };
  }

  /* --- Transition entre deux loops (fin de job + éjection) -------------
     Reconstruite à partir des valeurs PROUVÉES du fichier P2S qui imprime
     déjà (dégagement Z, flexion, push, balayages, parking). Seul le push
     est paramétré (hauteur : cf. pushHeight). On n'invente aucun
     mouvement : on rejoue une séquence validée.
     `push` = { z, half } (pushHeight).
     `last` (dernier loop seulement) : { unload } = lignes natives du retrait
     AMS (ou null), placées comme dans le end gcode natif, avant l'extinction
     de la buse ; puis progression posée à 100 % tout à la fin.             */
  function buildTransition(opts, push, maxZ, eol, last) {
    var unload = last && last.unload;
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
    if (unload) {
      L.push('; pull back filament to AMS (AutoLoop : dernier loop seulement)');
      unload.forEach(function (l) { L.push(l); });
      L.push('');
    }
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
    L.push('G1 Z' + z(push.z) + ' F' + pushSpeed + ' ; hauteur de push = ' +
           (push.half ? 'mi-hauteur (pièce de ' + z(maxZ) + ' mm)' : 'hauteur max − ' + opts.pushOffset + ' mm'));
    L.push('M400');
    // La tête arrive du fond (G150.3, goulotte) : on la place au centre, derrière la pièce,
    // puis poussée vers l'avant (fait tomber la pièce) et recul vers l'arrière (à vide).
    // Nombre et vitesses réglables ; avant, le recul passait en premier et ne bougeait
    // presque pas (tête déjà au fond), le retour se faisait à la vitesse de fin de job.
    L.push('G1 X125 Y250 F3000 ; centre, derrière la pièce');
    for (var p = 1; p <= opts.pushPasses; p++) {
      var pass = opts.pushPasses > 1 ? ' (passe ' + p + ')' : '';
      L.push('G1 Y0 F' + Math.round(opts.pushFrontF) + ' ; poussée vers l\'avant : éjecte la pièce' + pass);
      L.push('G1 Y250 F' + Math.round(opts.pushBackF) + ' ; recul vers l\'arrière' + pass);
    }
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
    if (last) L.push('M73 P100 R0 ; AutoLoop : batch terminé');
    L.push('; EXECUTABLE_BLOCK_END');
    return L.join(eol) + eol;
  }

  // Séparateur inséré entre la transition du loop k et le loop k+1 (repères
  // seulement). Pas de pause : la transition finit déjà par M400 (mouvements
  // terminés) et le loop suivant commence par chauffer le plateau.
  function buildSeparator(nextI, N, eol) {
    return eol +
      '; === END OF LOOP ' + (nextI - 1) + ' ===' + eol + eol +
      '; === LOOP ' + nextI + ' OF ' + N + ' ===' + eol;
  }

  /* --- Génération du batch complet ----------------------------------- */
  function generateBatch(raw, opts) {
    var eol = detectEol(raw);
    var report = {
      ok: false, loops: opts.loops, eol: eol === '\r\n' ? 'CRLF' : 'LF',
      maxZ: null, pushZ: null, pushHalf: false, flow: [], bed: [], bendsPerLoop: 0, size: 0, error: null,
      loadLineReplaced: false, amsUnload: false, layersPer: 0, wipe: null, weightPer: 0,
      progress: false, loopMin: 0, transMin: 0, totalMin: 0
    };
    var idx = raw.indexOf(END_ANCHOR);
    var mz = raw.match(RE_MAXZ);
    // Déjà un batch (AutoLoop ou FarmLoop) : le re-traiter empilerait des loops dans chaque loop.
    if (raw.indexOf('Batch généré par AutoLoop') !== -1) { report.error = 'Ce fichier a déjà été traité par AutoLoop. Repars de l\'export brut de Bambu Studio (une pièce).'; return { text: '', report: report }; }
    if (idx !== -1 && raw.indexOf(END_ANCHOR, idx + END_ANCHOR.length) !== -1) { report.error = 'Ce gcode contient déjà plusieurs pièces enchaînées (fichier FarmLoop ?). Repars de l\'export brut de Bambu Studio (une pièce).'; return { text: '', report: report }; }
    if (idx === -1) { report.error = 'Frontière « ' + END_ANCHOR + ' » introuvable — ce n\'est pas un gcode P2S brut exporté du slicer.'; return { text: '', report: report }; }
    if (!mz) { report.error = 'Impossible de lire « max_z_height » dans l\'en-tête du fichier.'; return { text: '', report: report }; }
    if (!RE_START_ANCHOR.test(raw)) { report.error = 'Ancrage du start gcode P2S introuvable.'; return { text: '', report: report }; }

    var maxZ = parseFloat(mz[1]);
    var push = pushHeight(maxZ, opts.pushOffset);
    report.maxZ = maxZ; report.pushZ = push.z; report.pushHalf = push.half;
    report.bendsPerLoop = (opts.bendEnable && opts.bendCycles > 0) ? opts.bendCycles * 2 : 0;

    var head = raw.slice(0, idx);   // pièce complète (header + config + start + corps), sans le end gcode natif
    var ll = replaceLoadLine(head, eol, opts.purgeLen, opts.wipePasses);   // purge en goulotte à la place de la ligne G130, sur tous les loops
    head = ll.text; report.loadLineReplaced = ll.replaced;
    var wp = addChangeWipe(head, opts.wipePasses, eol);   // nettoyage de la buse après chaque changement de filament
    head = wp.text;
    report.wipe = { changes: wp.changes, done: wp.done, passes: opts.wipePasses };
    var N = opts.loops;
    var trans = buildTransition(opts, push, maxZ, eol);   // identique pour chaque loop…
    var pb = RE_AMS_PULLBACK.exec(raw.slice(idx));
    var unload = pb ? pb[1].split(/\r?\n/) : null;
    var transLast = buildTransition(opts, push, maxZ, eol, { unload: unload });   // …sauf le dernier : retrait AMS + 100 %
    report.amsUnload = !!unload;

    // Total de couches annoncé à l'imprimante = couches par pièce × loops.
    var tl = RE_TOTAL_LAYERS.exec(head);
    var layersPer = tl ? parseInt(tl[2], 10) : 0;
    if (tl) head = head.replace(RE_TOTAL_LAYERS, '$1' + (N * layersPer));
    report.layersPer = layersPer;
    report.weightPer = pieceWeight(head);
    head = scaleFilTotals(head, N);   // filament de l'en-tête : total du batch
    var seg = progressSegments(head, layersPer);   // progression + couches réécrites pour le batch complet
    var transMin = transitionMin(opts);
    report.progress = seg.rs.length > 0;
    report.loopMin = seg.loopMin; report.transMin = transMin;
    report.totalMin = N * (seg.loopMin + transMin);

    for (var k = 1; k <= N; k++) {
      if (opts.cal.flow[k - 1]) report.flow.push(k);
      if (opts.cal.bed[k - 1]) report.bed.push(k);
    }

    var parts = [];
    parts.push('; ===================================================' + eol +
               '; Batch généré par AutoLoop — Création Audio' + eol +
               '; ' + N + ' loops · pièce ' + z(maxZ) + ' mm · push ' + z(push.z) + ' mm (' +
                 (push.half ? 'mi-hauteur : ' + (push.low ? 'pièce ≤ ' + PUSH_LOW_MAX + ' mm' : 'max − retrait < ' + PUSH_MIN + ' mm')
                            : 'max − ' + opts.pushOffset + ' mm') + ')' + eol +
               '; Flow : ' + (loopRanges(report.flow) || 'aucun loop') + ' · bed leveling : ' + (loopRanges(report.bed) || 'aucun loop') + eol +
               (report.progress ? '; Durée estimée du batch : ' + fmtDur(report.totalMin) + ' (' + N + ' × ' + seg.loopMin +
                 ' min + ' + Math.round(transMin) + ' min de cooldown/éjection) — progression M73 réécrite pour le batch' + eol : '') +
               '; Aucune dépendance FarmLoop.' + eol +
               '; ===================================================' + eol + eol);

    for (var i = 1; i <= N; i++) {
      // Le header du loop 1 est écrit ici ; ceux des loops suivants viennent du séparateur.
      if (i === 1) parts.push('; === LOOP 1 OF ' + N + ' ===' + eol);
      parts.push(insertFlags(progressHead(seg, i, N, transMin), i, !!opts.cal.flow[i - 1], !!opts.cal.bed[i - 1], eol));
      parts.push(i === N ? transLast : trans);
      if (i < N) parts.push(buildSeparator(i + 1, N, eol));
    }
    var out = parts.join('');
    report.size = out.length;
    report.ok = true;
    return { text: out, report: report };
  }

  /* --- Grille de calibration par loop ----------------------------------
     Une colonne par loop, deux cases : flow (extrude_cali_flag) et bed
     leveling (g29_before_print_flag). Coché = forcé à 1, décoché = forcé à 0.
     Chaque ligne a son champ « tous les X loops » qui la re-remplit selon le
     motif (défaut flow 2 / bed leveling 4). Changer le nombre de loops garde les
     cases déjà réglées ; les nouveaux loops suivent le motif de leur ligne.  */
  var CAL_CHUNK = 12;                 // loops par rangée de grille
  var cal = { flow: [], bed: [] };    // index 0 = loop 1

  function loopCount() { return Math.max(1, intOr($('#al-loops').value, 12)); }
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
  function readOpts() {
    var N = loopCount();
    fitCal(N);
    return {
      loops: N,
      cal: { flow: cal.flow.slice(0, N), bed: cal.bed.slice(0, N) },
      bendEnable: $('#al-bend-enable').checked,
      bendHigh: num($('#al-bend-high').value, 240),
      bendLow: num($('#al-bend-low').value, 205),
      bendSpeed: num($('#al-bend-speed').value, 12000),
      bendCycles: Math.max(0, intOr($('#al-bend-cycles').value, 6)),
      pushOffset: num($('#al-push-offset').value, 10),
      pushSpeed: num($('#al-push-speed').value, 10000),
      pushPasses: Math.min(5, Math.max(1, intOr($('#al-push-passes').value, 1))),
      pushBackF: Math.max(1, num($('#al-push-back').value, 3000)),
      pushFrontF: Math.max(1, num($('#al-push-front').value, 3000)),
      clearZ: num($('#al-clearz').value, 105),
      purgeLen: Math.max(0, num($('#al-purge-len').value, 50)),
      wipePasses: Math.min(10, Math.max(0, intOr($('#al-wipe-passes').value, 2))),
      coolMode: $('#al-cool-mode').value,
      coolTemp: num($('#al-cool-temp').value, 45),
      coolSec: num($('#al-cool-sec').value, 60),
      coolEst: num($('#al-cool-est').value, 5)
    };
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
     puis le coût et le profit de ce batch (calculateur synchronisé à la génération,
     cf. runGenerate ; re-rendu à chaque changement du calculateur), puis les détails
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
        rrow('Profit ' + unit, money(r.marginAmt * k), r.marginAmt < 0 ? 'al-bad' : 'al-good') +
        '<button type="button" class="al-link al-rlink" data-goto="prix">Détail du prix →</button>' +
      '</div>' +
      '<details class="al-rmore"' + (reportMoreOpen ? ' open' : '') + '>' +
        '<summary>Détails du batch' + (issues ? ' <span class="al-bad">· ' + issues + ' à vérifier</span>' : '') + '</summary>' +
      '<div class="al-rsec">' +
        rrow('Flow', rep.flow.length + ' loop' + (rep.flow.length > 1 ? 's' : '')) +
        rrow('Bed leveling', rep.bed.length + ' loop' + (rep.bed.length > 1 ? 's' : '')) +
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
    priceFromFileName(name);
  }

  // Accepte un .gcode brut OU le projet tranché exporté par Bambu Studio (.gcode.3mf,
  // une archive ZIP : on y lit Metadata/plate_N.gcode). Détection par signature « PK ».
  function loadFile(file) {
    if (!file) return;
    rawName = file.name;
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
    applyGcodeToPricing(rawText, rawName);
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
    renderReport(null);
    syncDownloadLabel();
  }
  function fileError(msg) {
    rawText = '';
    $('#al-file-name').textContent = rawName;
    $('#al-drop').classList.remove('has-file');
    syncPushWarn();
    $('#al-process').disabled = true;
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
        } else {
          lastRep = null;
          renderReport(res.report);
          $('#al-download').disabled = true;
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
    }
    coolMode.addEventListener('change', syncCool); syncCool();
    // Flexion : activer/désactiver les champs.
    var bendEnable = $('#al-bend-enable');
    function syncBend() { $('#al-bend-fields').style.opacity = bendEnable.checked ? '1' : '.4'; }
    bendEnable.addEventListener('change', syncBend); syncBend();
    initCalGrid();
    // Résumé de l'en-tête des réglages machine, tenu à jour (saisie ou défauts appliqués).
    var machine = $('#al-machine');
    if (machine) { machine.addEventListener('input', syncMachineSum); machine.addEventListener('change', syncMachineSum); }
    syncMachineSum();
    $('#al-push-offset').addEventListener('input', syncPushWarn);

    $('#al-process').addEventListener('click', runGenerate);
    $('#al-download').addEventListener('click', download);
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
    // Tarif de spacer choisi : repris tel quel (pas d'arrondi qui dérive à chaque bascule).
    var pe = $('#ap-price'), lvl = spacer && spacer.levels[spacerLvl];
    if (pe && lvl) pe.value = (Math.round(lvl.p * k / 2 * 100) / 100).toFixed(2);
    else if (pe && pe.value !== '') pe.value = (Math.round(num(pe.value, 0) * k / unitK * 100) / 100).toFixed(2);
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

  // « 1h05 » à partir de minutes.
  function fmtHm(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    if (m === 60) { h++; m = 0; }
    return h + 'h' + (m < 10 ? '0' : '') + m;
  }
  // « 1 j 13h40 » au-delà de 24 h (durée d'un batch).
  function fmtDur(min) {
    var d = Math.floor(min / 1440);
    return d > 0 ? d + ' j ' + fmtHm(min - d * 1440) : fmtHm(min);
  }

  /* Prix du spacer d'après le nom du fichier ----------------------------- */
  // Théo nomme ses fichiers comme le spacer (« HKSB110 1.1.gcode.3mf ») : on retrouve
  // le spacer par son nom exact en début de fichier — casse, accents, espaces, tirets,
  // version et « AutoLoop xN » ignorés ; « AP 5 / SRX52V » répond aussi à « AP 5 » ou
  // « SRX52V » (un « / » est interdit dans un nom de fichier), et un spacer renommé
  // (CA-ADP-HYKIA-001) répond encore au n° de la pièce qu'il remplace (attrs.replaces :
  // « HKSB110 1.1.gcode.3mf ») et à ses anciens noms (attrs.aliases). Son prix client remplace
  // le prix de vente ; le menu « Tarif » passe au prix dealer ou à un palier.
  // Prix des spacers = par paire (cf. cms-spacers.js).
  var spacer = null, spacerLvl = -1, spacerFile = '', spacerReq = 0;

  function nameTokens(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .split(/[^a-z0-9]+/).filter(Boolean);
  }
  // Le nom du spacer doit couvrir des mots ENTIERS du début du fichier :
  // « HSB524 1.4 » ne répond pas à un spacer « HSB52 ». Le plus long gagne.
  function matchSpacer(fileName, rows) {
    var base = String(fileName || '').replace(/(\.gcode)?\.3mf$|\.gcode$/i, '').replace(/^FL_S\d+_/i, '')   // préfixe FarmLoop
      .replace(/\bautoloop\b(\s*x\s*\d+)?/ig, ' ');
    var toks = nameTokens(base), flat = toks.join(''), ends = {}, n = 0;
    toks.forEach(function (t) { n += t.length; ends[n] = true; });
    var best = null, bestLen = 0;
    (rows || []).forEach(function (r) {
      var name = String(r.name || '');
      var refs = (r.attrs && Array.isArray(r.attrs.replaces) ? r.attrs.replaces : []).map(function (x) { return x && x.ref; });
      // anciens noms (« AP 5 / SRX52V » avant CA-ADP-525-001) : les fichiers gardent souvent l'ancien nom
      var olds = [];
      (r.attrs && Array.isArray(r.attrs.aliases) ? r.attrs.aliases : []).forEach(function (a) {
        a = String(a || ''); olds.push(a); if (a.indexOf('/') !== -1) olds = olds.concat(a.split('/'));
      });
      [name].concat(name.indexOf('/') !== -1 ? name.split('/') : [], refs, olds).forEach(function (alias) {
        var key = nameTokens(alias).join('');
        if (!key || !ends[key.length] || flat.lastIndexOf(key, 0) !== 0) return;
        if (key.length > bestLen || (key.length === bestLen && r.active && !best.active)) { best = r; bestLen = key.length; }
      });
    });
    return best;
  }
  // Client, Dealer, puis les paliers dealer (« Dealer 6+ » = 6 paires et plus).
  function spacerLevels(r) {
    var L = [{ k: 'Client', p: parseFloat(r.sell_price) }];
    if (r.dealer_price != null) L.push({ k: 'Dealer', p: parseFloat(r.dealer_price) });
    (Array.isArray(r.tiers) ? r.tiers : [])
      .map(function (t) { return { min: parseInt(t.min, 10), p: parseFloat(t.price) }; })
      .filter(function (t) { return t.min > 1; })
      .sort(function (a, b) { return a.min - b.min; })
      .forEach(function (t) { L.push({ k: 'Dealer ' + t.min + '+', p: t.p }); });
    return L.filter(function (l) { return isFinite(l.p) && l.p > 0; });
  }
  function priceFromFileName(name) {
    var sb = window.CA && window.CA.sb;
    if (!sb || (spacer && name === spacerFile)) return;   // autre plateau du même fichier : on garde le tarif choisi
    var req = ++spacerReq;
    sb.from('products').select('name,sell_price,dealer_price,tiers,active,attrs').eq('type', 'spacer').then(function (res) {
      if (req !== spacerReq || res.error) return;
      var r = matchSpacer(name, res.data), had = !!spacer;
      spacer = r ? { name: r.name, levels: spacerLevels(r) } : null;
      if (spacer && !spacer.levels.length) spacer = null;
      spacerFile = spacer ? name : '';
      if (spacer) { setSpacerLevel(0); return; }
      spacerLvl = -1;
      if (had) autoPrice();   // le prix du spacer précédent ne vaut pas pour ce fichier
      recompute();
    }, function () {});
  }
  function setSpacerLevel(i) {
    spacerLvl = i;
    var lvl = spacer && spacer.levels[i], pe = $('#ap-price');
    if (lvl && pe) pe.value = (Math.round(lvl.p * unitK / 2 * 100) / 100).toFixed(2);
    recompute();
  }
  function renderSpacer() {
    var wrap = $('#ap-spacer'), sel = $('#ap-spacer-lvl');
    if (!wrap || !sel) return;
    wrap.hidden = !spacer;
    if (!spacer) return;
    $('#ap-spacer-name').textContent = spacer.name;
    sel.innerHTML = spacer.levels.map(function (l, i) {
      return '<option value="' + i + '">' + esc(l.k) + ' — ' + money(l.p * unitK / 2) + '</option>';
    }).join('') + (spacerLvl < 0 ? '<option value="-1">Autre prix</option>' : '');
    sel.value = String(spacerLvl);
  }
  // Prix de départ sans spacer reconnu : ~33 % de marge sur le coût (de l'unité choisie), arrondi à 0,05 $.
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
    renderSpacer();
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

    // Tarif du spacer reconnu ; un prix tapé à la main passe le menu à « Autre prix ».
    var lvlSel = $('#ap-spacer-lvl'), pe = $('#ap-price');
    if (lvlSel) lvlSel.addEventListener('change', function () { setSpacerLevel(+this.value); });
    if (pe) pe.addEventListener('input', function () { if (spacer && spacerLvl >= 0) { spacerLvl = -1; renderSpacer(); } });

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
            'al-bend-speed', 'al-bend-cycles', 'al-push-offset', 'al-push-speed', 'al-clearz',
            'al-push-passes', 'al-push-back', 'al-push-front', 'al-purge-len',
            'al-wipe-passes', 'al-cool-mode', 'al-cool-temp', 'al-cool-sec', 'al-cool-est'],
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
