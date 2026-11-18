/* =========================================================
   Création Audio — AutoLoop : cœur de la génération des batchs
   Partagé par la page admin (cms-autoloop.js, window.ALCore) ET le script
   du PC de l'atelier (tools/autoloop-cli, require). Un seul code : changer
   la génération ici la change pour les deux.
   - Aucun accès au DOM ni au réseau : texte gcode + options -> texte du batch.
   - optsFrom(valeurs, loops, cal, ztrim) : construit les options à partir des
     valeurs des champs de la page (mêmes clés que admin_settings « autoloop ».gcode
     et autoloop_plates.settings.gcode : 'al-bend-high'…), avec les mêmes défauts.
   - calFor(enregistré, N, flowEvery, bedEvery) : cases de calibration d'un batch
     (cases enregistrées avec le plateau, complétées par le motif « tous les X »).
   ========================================================= */
(function (root) {
  'use strict';

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
  var COOL_WAITS = 6;      // M190 répétés au cooldown (voir buildTransition)
  var COOL_TOLERANCE = 5;  // le M190 Bambu relâche à cible + 5 °C
  var LOOPS_MIN = 2;        // batch d'au moins 2 loops (règle atelier 2026-11-18)
  var CLEAR_MARGIN = 10;   // dégagement = hauteur de la pièce + 10 mm (calculé, plus réglable : un Z 0 a détruit un spacer le 2026-11-18)
  var EJECT_MIN = 1;  // flexion + push + balayages + parking ≈ 1 min (hors cooldown)

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

  /* - RE_SWEEP : calibration des vibrations du start gcode P2S (« mech mode sweep » :
       M970.x / M974 sur X et Y). Faite au loop 1 ; la machine ne change pas entre deux
       loops, on la retire donc des suivants (M975 S1 gardé : suppression active). */
  var RE_SWEEP = /^;=+ mech mode sweep start =+[^\r\n]*\r?\n[\s\S]*?^;=+ mech mode sweep end =+[^\r\n]*\r?\n/m;
  function dropSweep(head, eol) {
    return head.replace(RE_SWEEP, ';===== mech mode sweep (AutoLoop : faite au loop 1 seulement) =====' + eol +
                                  '  M975 S1' + eol + ';===== mech mode sweep end =====' + eol);
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
    L.push('G1 Z' + z(maxZ + CLEAR_MARGIN) + ' F900 ; dégagement : pièce + ' + CLEAR_MARGIN + ' mm');
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
      if (opts.coolFresh) {
        // P2S : en mode chauffage (ABS/ASA, chambre ≥ 40 °C) le volet recycle l'air chaud de la chambre.
        // M145 P0 = mode ventilation (comme le start gcode PLA) : l'auxiliaire tire l'air frais du dehors.
        // Le start gcode du loop suivant remet lui-même son mode (M145 P1 pour l'ABS).
        L.push('M145 P0 ; AutoLoop : volet en mode ventilation (air frais du dehors)');
        L.push('M106 P2 S255 ; turn on auxiliary fan for cooling');
        L.push('M106 P3 S255 ; turn on chamber fan for cooling');
        // Buse déjà en goulotte (G150.3 plus haut) : le plateau remonte à la hauteur réglée, face à l'auxiliaire.
        if (opts.coolZ != null) { L.push('M400'); L.push('G1 Z' + z(opts.coolZ) + ' F900 ; AutoLoop : plateau au refroidissement (buse en goulotte)'); }
      } else {
        L.push('M106 P2 S255 ; turn on remote part cooling fan');
      }
      L.push('');
      L.push(';Cooldown Start');
      if (opts.coolMode === 'temp') {
        // Le M190 du firmware Bambu relâche à cible + 5 °C (constaté : 45 → 50, 50 → 55)
        // et abandonne au bout d'un délai près de l'ambiante (35 → 45). On vise donc
        // cible − 5 et on le répète — un M190 atteint passe aussitôt, sinon il relance l'attente.
        var coolT = Math.round(opts.coolTemp), coolS = coolT - COOL_TOLERANCE;
        for (var w = 0; w < COOL_WAITS; w++) {
          L.push('M190 S' + coolS + ' ; plateau à ' + coolT + ' °C (firmware relâche à +' + COOL_TOLERANCE + ') ' + (w + 1) + '/' + COOL_WAITS);
        }
      } else {
        L.push('G4 S' + Math.round(opts.coolSec) + ' ; délai fixe');
      }
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
      progress: false, loopMin: 0, transMin: 0, totalMin: 0, ztrim: null
    };
    // Z de la 1re couche (G29.1 Z du start gcode) : réécrit avant tout le reste → vaut pour chaque loop
    if (opts.ztrim != null) { var zr = ztApply(raw, opts.ztrim); raw = zr.text; report.ztrim = { to: opts.ztrim, count: zr.count }; }
    var idx = raw.indexOf(END_ANCHOR);
    var mz = raw.match(RE_MAXZ);
    // Déjà un batch (AutoLoop ou FarmLoop) : le re-traiter empilerait des loops dans chaque loop.
    if (raw.indexOf('Batch généré par AutoLoop') !== -1) { report.error = 'Ce fichier a déjà été traité par AutoLoop. Repars de l\'export brut de Bambu Studio (une pièce).'; return { text: '', report: report }; }
    if (idx !== -1 && raw.indexOf(END_ANCHOR, idx + END_ANCHOR.length) !== -1) { report.error = 'Ce gcode contient déjà plusieurs pièces enchaînées (fichier FarmLoop ?). Repars de l\'export brut de Bambu Studio (une pièce).'; return { text: '', report: report }; }
    if (idx === -1) { report.error = 'Frontière « ' + END_ANCHOR + ' » introuvable — ce n\'est pas un gcode P2S brut exporté du slicer.'; return { text: '', report: report }; }
    if (!mz) { report.error = 'Impossible de lire « max_z_height » dans l\'en-tête du fichier.'; return { text: '', report: report }; }
    if (!RE_START_ANCHOR.test(raw)) { report.error = 'Ancrage du start gcode P2S introuvable.'; return { text: '', report: report }; }

    var maxZ = parseFloat(mz[1]);
    // Règle atelier (2026-11-18) : un batch compte au moins 2 loops.
    if (!(opts.loops >= LOOPS_MIN)) { report.error = 'Un batch AutoLoop compte au moins ' + LOOPS_MIN + ' loops.'; return { text: '', report: report }; }
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
    report.sweep = RE_SWEEP.test(head);

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
      var ph = progressHead(seg, i, N, transMin);
      if (i > 1) ph = dropSweep(ph, eol);
      parts.push(insertFlags(ph, i,!!opts.cal.flow[i - 1], !!opts.cal.bed[i - 1], eol));
      parts.push(i === N ? transLast : trans);
      if (i < N) parts.push(buildSeparator(i + 1, N, eol));
    }
    var out = parts.join('');
    report.size = out.length;
    report.ok = true;
    return { text: out, report: report };
  }

  // Z de la 1re couche (G29.1 Z…) — voir cms-autoloop.js pour les pastilles par imprimante.
  var RE_ZT = /^([ \t]*G29\.1 Z)(-?\d*\.?\d+)([ \t]*;[^\r\n]*)?$/gm;
  function ztNum(v) { return (Math.round(v * 1000) / 1000).toFixed(3).replace(/0$/, ''); }
  function ztFind(text) {
    var v = null;
    text.replace(RE_ZT, function (m, a, n, c) { if (v === null && !/clear/i.test(c || '')) v = +n; return m; });
    return v;
  }
  function ztApply(text, val) {
    var n = 0;
    var out = text.replace(RE_ZT, function (m, a, v, c) { if (/clear/i.test(c || '')) return m; n++; return a + ztNum(val) + (c || ''); });
    return { text: out, count: n };
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

  /* --- Valeurs d'origine des champs du Générateur (attributs value / checked de
     coulisses-t6avzpe2.html). Le script part de celles-ci, puis applique les défauts
     enregistrés (admin_settings « autoloop ».gcode), puis les réglages du plateau —
     comme la page. Changer un champ dans le HTML = le changer ici aussi. */
  var FIELD_DEFAULTS = {
    'al-loops': '12', 'al-cal-flow-every': '2', 'al-cal-bed-every': '4',
    'al-bend-enable': true, 'al-bend-high': '240', 'al-bend-low': '205', 'al-bend-speed': '12000', 'al-bend-cycles': '6',
    'al-push-offset': '10', 'al-push-speed': '10000', 'al-push-passes': '1',
    'al-push-back': '3000', 'al-push-front': '3000', 'al-purge-len': '50', 'al-wipe-passes': '2',
    'al-cool-mode': 'temp', 'al-cool-fresh': true, 'al-cool-z': '', 'al-cool-temp': '45', 'al-cool-sec': '60', 'al-cool-est': '5'
  };

  /* --- Options du batch à partir des valeurs des champs (même défauts que la page). */
  function optsFrom(v, loops, cal, ztrim) {
    v = v || {};
    return {
      loops: loops,
      cal: cal,
      bendEnable: !!v['al-bend-enable'],
      bendHigh: num(v['al-bend-high'], 240),
      bendLow: num(v['al-bend-low'], 205),
      bendSpeed: num(v['al-bend-speed'], 12000),
      bendCycles: Math.max(0, intOr(v['al-bend-cycles'], 6)),
      pushOffset: num(v['al-push-offset'], 10),
      pushSpeed: num(v['al-push-speed'], 10000),
      pushPasses: Math.min(5, Math.max(1, intOr(v['al-push-passes'], 1))),
      pushBackF: Math.max(1, num(v['al-push-back'], 3000)),
      pushFrontF: Math.max(1, num(v['al-push-front'], 3000)),
      purgeLen: Math.max(0, num(v['al-purge-len'], 50)),
      wipePasses: Math.min(10, Math.max(0, intOr(v['al-wipe-passes'], 2))),
      coolMode: v['al-cool-mode'],
      coolFresh: !!v['al-cool-fresh'],
      coolZ: String(v['al-cool-z'] == null ? '' : v['al-cool-z']).trim() === '' ? null : num(v['al-cool-z'], 0),
      coolTemp: num(v['al-cool-temp'], 45),
      coolSec: num(v['al-cool-sec'], 60),
      coolEst: num(v['al-cool-est'], 5),
      ztrim: ztrim == null ? null : ztrim
    };
  }
  // Cases flow / bed leveling pour N loops : celles enregistrées d'abord, puis le motif (comme fitCal de la page).
  function calFor(saved, N, flowEvery, bedEvery) {
    var out = { flow: [], bed: [] }, every = { flow: flowEvery, bed: bedEvery };
    ['flow', 'bed'].forEach(function (row) {
      var s = (saved && saved[row]) || [];
      for (var i = 0; i < N; i++) out[row].push(i < s.length ? !!s[i] : calibrateLoop(i + 1, Math.max(0, every[row] | 0)));
    });
    return out;
  }

  root.ALCore = {
    num: num, intOr: intOr, z: z, RE_MAXZ: RE_MAXZ, PUSH_LOW_MAX: PUSH_LOW_MAX, PUSH_MIN: PUSH_MIN,
    pushHeight: pushHeight, calibrateLoop: calibrateLoop, generateBatch: generateBatch,
    RE_ZT: RE_ZT, ztNum: ztNum, ztFind: ztFind, ztApply: ztApply, fmtHm: fmtHm, fmtDur: fmtDur,
    optsFrom: optsFrom, calFor: calFor, FIELD_DEFAULTS: FIELD_DEFAULTS, LOOPS_MIN: LOOPS_MIN
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ALCore;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
