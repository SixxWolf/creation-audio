/* =========================================================
   Création Audio — page IMPRESSION 3D (v2).
   - Aperçu 3D (apercu-3d.js) : lit un STL ou un OBJ DANS le navigateur (rien n'est envoyé avant la demande) :
     dimensions, poids estimé, couleur choisie ; la pièce tourne au toucher, ne boucle jamais.
     Sans fichier : un adaptateur d'exemple, construit par calcul. STEP : simplement joint.
   - 3MF et G-code : lus par le Worker impression-3mf.js. Plateaux en vignettes à cocher, couleurs du fichier, vrai plateau
     sous les pièces ; tranché : trajets en cordons, curseur de couches, Lecture ; téléphone : version allégée.
     Sans dessin possible (pas d'instanciation WebGL) : image du plateau + vrais chiffres.
   - Formulaire : se déplie sous la zone de dépôt. Fichiers STL/3MF/STEP/OBJ/G-code, 3 max, 50 Mo chacun.
     L'envoi crée une fiche de demande D-0001 (CA.demande, demande.js : connexion si besoin, fichiers
     dans le bucket « print-files », confirmation qui remplace le formulaire). Plus rien ne passe par la Messagerie.
   - Couleurs : stock réel lu dans products_public (qty ou qty_2 > 0). Toucher une pastille recolore la pièce
     et remplit la demande.
   - Vraies pièces : adaptateurs lus dans products_public ; la section reste masquée sans données.
   ========================================================= */
(function () {
  'use strict';
  var CA0 = window.CA || {};
  var A = CA0.ap3d;
  var _t = CA0.t || function (s) { return s; };
  var tn = CA0.tn || function (n, one, many) { return (n >= 2 ? many : one).replace('{n}', n); };
  var EN = CA0.lang === 'en';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function all(sel, el) { return [].slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n, d) { return n.toLocaleString(CA0.locale || 'fr-CA', { maximumFractionDigits: d || 0 }); }

  /* ---------- apparition au défilement (une seule fois) ---------- */
  var io = null;
  if ('IntersectionObserver' in window && !reduce) {
    root.classList.add('ip-anim');
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -4% 0px' });
    all('.rv').forEach(function (el) { io.observe(el); });
  }

  /* Exemple : un adaptateur de haut-parleur (bride à 4 oreilles percées + collet). */
  function exampleMesh() {
    var out = [];
    function tri(a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
    function quad(a, b, c, d) { tri(a, b, c); tri(a, c, d); }
    var RI = 62, RF = 80, RC = 73, HF = 6, HC = 21, LUG = 10, HOLE = 2.5, HOLE_AT = 85, EAR = 20 * Math.PI / 180, SEG = 180;
    var ears = [45, 135, 225, 315].map(function (d) { return d * Math.PI / 180; });
    function lug(a) {
      var best = 0;
      ears.forEach(function (e) {
        var d = Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e)));
        var w = Math.max(0, 1 - d / EAR);
        best = Math.max(best, w * w * (3 - 2 * w));
      });
      return RF + LUG * best;
    }
    function pol(r, a, z) { return [r * Math.cos(a), r * Math.sin(a), z]; }
    var i, a0, a1, step = 2 * Math.PI / SEG;

    // parois de la bride + du trou central + du collet
    for (i = 0; i < SEG; i++) {
      a0 = i * step; a1 = (i + 1) * step;
      var r0 = lug(a0), r1 = lug(a1);
      quad(pol(r0, a0, 0), pol(r1, a1, 0), pol(r1, a1, HF), pol(r0, a0, HF));   // extérieur bride
      quad(pol(RC, a0, HF), pol(RC, a1, HF), pol(RC, a1, HC), pol(RC, a0, HC)); // extérieur collet
      quad(pol(RI, a1, 0), pol(RI, a0, 0), pol(RI, a0, HC), pol(RI, a1, HC));   // trou central
      quad(pol(RC, a0, HC), pol(RC, a1, HC), pol(RI, a1, HC), pol(RI, a0, HC)); // dessus du collet
    }

    // faces de la bride : anneau simple entre les oreilles, éventail autour de chaque trou dans les oreilles
    function inEar(a) {
      return ears.some(function (e) { return Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e))) < EAR - 1e-6; });
    }
    function face(z, up) {
      var order = up ? function (a, b, c, d) { quad(a, b, c, d); } : function (a, b, c, d) { quad(d, c, b, a); };
      for (i = 0; i < SEG; i++) {
        a0 = i * step; a1 = (i + 1) * step;
        if (inEar((a0 + a1) / 2)) continue;
        order(pol(RI, a0, z), pol(lug(a0), a0, z), pol(lug(a1), a1, z), pol(RI, a1, z));
      }
      ears.forEach(function (e) {
        var c = pol(HOLE_AT, e, z), n = Math.round(2 * EAR / step), pts = [], k;
        for (k = 0; k <= n; k++) { var a = e - EAR + k * step; pts.push(pol(lug(a), a, z)); }
        for (k = n; k >= 0; k--) { var b = e - EAR + k * step; pts.push(pol(RI, b, z)); }
        var m = pts.length;
        for (k = 0; k < m; k++) {
          var p = pts[k], q = pts[(k + 1) % m];
          var ap = Math.atan2(p[1] - c[1], p[0] - c[0]), aq = Math.atan2(q[1] - c[1], q[0] - c[0]);
          var hp = [c[0] + HOLE * Math.cos(ap), c[1] + HOLE * Math.sin(ap), z], hq = [c[0] + HOLE * Math.cos(aq), c[1] + HOLE * Math.sin(aq), z];
          order(hp, p, q, hq);
          if (up) quad([hq[0], hq[1], 0], [hp[0], hp[1], 0], hp, hq);   // paroi du trou de vis
        }
      });
    }
    face(HF, true);
    face(0, false);
    return A.fromTris(new Float32Array(out), Math.floor(out.length / 9));
  }

  /* Poids estimé : parois + dessus/dessous (≈ 1,2 mm) en plein, 15 % de remplissage pour le reste. */
  var DENS = { pla: 1.24, petg: 1.27, abs: 1.04, tpu: 1.21 };
  function grams(mesh, mat) {
    if (!mesh || mesh.volume < 1) return null;
    var shell = Math.min(mesh.volume, mesh.area * 1.2);
    return (shell + (mesh.volume - shell) * 0.15) / 1000 * (DENS[mat] || DENS.pla);
  }
  var fmtDim = A.fmtDim, fmtWeight = A.fmtWeight, fmtTime = A.fmtTime;
  function fmtGrams(g) { return g == null ? '—' : '≈ ' + fmtWeight(g); }

  /* =========================================================
     Aperçu : apercu-3d.js dessine ; la page garde la demande, le mini-aperçu de la section Matériaux suit.
     ========================================================= */
  var canvas = $('ip-gl'), viewEl = $('ip-view'), mini = $('ip-mini');
  var mesh = null, color = [1, 0.416, 0.075];
  var miniCtx = mini && mini.getContext ? mini.getContext('2d') : null;
  var view = A.viewer(canvas, {
    box: viewEl, tint: color,
    onDraw: function (W, H) {
      if (!miniCtx) return;
      var mw = mini.width, mh = mini.height, k = Math.min(mw / W, mh / H) * 1.02, dw = W * k, dh = H * k;
      miniCtx.clearRect(0, 0, mw, mh);
      miniCtx.drawImage(canvas, (mw - dw) / 2, (mh - dh) / 2, dw, dh);
    }
  });
  var glOK = view.ok;
  if (glOK) root.classList.add('ip-gl');
  var ctl = A.controls($('ip-ctl'), view, { box: viewEl });

  /* =========================================================
     État de la demande + lecture du fichier
     ========================================================= */
  var form = $('demande'), more = $('ip-more');
  var desc = $('ip-desc'), qty = $('ip-qty'), status = $('ip-status'), submit = $('ip-submit');
  var drop = $('ip-drop'), fileIn = $('ip-file'), list = $('ip-flist');
  var fname = $('ip-fname'), fsize = $('ip-fsize'), noPrev = $('ip-nopreview'), warnEl = $('ip-warn');
  var rDim = $('ip-r-dim'), rDim2 = $('ip-r-dim2'), rG = $('ip-r-g'), rMat = $('ip-r-mat');
  var lDim = $('ip-l-dim'), lG = $('ip-l-g'), totalEl = $('ip-total'), shot = $('ip-shot'), strip = $('ip-plates');
  var DEF = { name: fname.textContent, size: fsize.textContent, mat: rMat.textContent, lDim: lDim.textContent, lG: lG.textContent };
  var DEF_RGB = color.slice();
  var MAX_FILES = 3, MAX_BYTES = 50 * 1048576, EXT = /\.(stl|3mf|step|stp|obj|gcode)$/i, READ = /\.(stl|obj)$/i, READ3 = /\.(3mf|gcode)$/i;
  var FAM_OF = { pla: 'PLA', petg: 'PETG', abs: 'ABS', tpu: 'TPU' };
  var example = exampleMesh();
  var files = [], current = -1;
  var state = { mat: 'any', color: null };

  function say(text, cls) { status.textContent = text || ''; status.className = 'ip-status' + (cls ? ' ' + cls : ''); }
  function flag(el, bad) { el.classList.toggle('is-bad', bad); el.setAttribute('aria-invalid', bad ? 'true' : 'false'); }
  function fmtSize(b) {
    return b >= 1048576 ? num(b / 1048576, 1) + _t(' Mo') : Math.max(1, Math.round(b / 1024)) + _t(' Ko');
  }
  function rgb(hex) { return [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16) / 255; }); }
  function matCalc() { return state.mat !== 'any' ? state.mat : (current >= 0 ? 'pla' : 'abs'); }

  function sizeText(f) {
    if (f.reading) return _t('Lecture du fichier…') + (f.pct ? ' ' + f.pct + ' %' : '');
    return fmtSize(f.file.size) + (f.three && f.three.lightened ? ' · ' + _t('aperçu allégé') : '');
  }
  /* Plateaux cochés : poids réel si le fichier est tranché, sinon estimé ; temps seulement si tous l'ont. */
  function checkedTotal(t, mat) {
    var out = { n: 0, g: 0, est: false, time: 0 }, allTimes = true;
    t.plates.forEach(function (p) {
      if (!p.on) return;
      out.n++;
      var g = p.weight > 0 ? p.weight : grams(p, mat);
      if (!(p.weight > 0)) out.est = true;
      if (g) out.g += g;
      if (p.time > 0) out.time += p.time; else allTimes = false;
    });
    if (!allTimes) out.time = 0;
    return out;
  }
  function readout() {
    var f = current >= 0 ? files[current] : null;
    var t = f && f.three, pl = t ? t.plates[t.pi] : null, has = pl && (pl.hasMesh || pl.drawn);
    var m = pl ? (has ? pl : null) : (f ? f.mesh : example);
    if (f) {
      fname.textContent = f.file.name;
      fsize.textContent = sizeText(f);
    } else {
      fname.textContent = DEF.name;
      fsize.textContent = DEF.size;
    }
    // image du plateau : rien à dessiner, ou navigateur sans WebGL
    var img = pl && pl.url && (!has || !glOK);
    shot.hidden = !img;
    if (img && shot.getAttribute('src') !== pl.url) { shot.src = pl.url; shot.alt = _t('Plateau') + ' ' + pl.id; }
    noPrev.hidden = !(f && !f.reading && !m && !img);
    canvas.style.visibility = noPrev.hidden && !img ? '' : 'hidden';

    // sans pièce, le temps réel remplace les dimensions ; poids réel : plus de « estimé »
    var noMeshTime = pl && !has && pl.time > 0;
    lDim.textContent = noMeshTime ? _t('Temps d\'impression') : DEF.lDim;
    rDim.textContent = noMeshTime ? fmtTime(pl.time) : (m ? fmtDim(m) : '—');
    rDim2.hidden = !(has && pl.time > 0);
    rDim2.textContent = rDim2.hidden ? '' : _t('{t} d\'impression').replace('{t}', fmtTime(pl.time));
    var real = pl && pl.weight > 0;
    lG.textContent = real ? _t('Poids') : DEF.lG;
    rG.textContent = real ? fmtWeight(pl.weight) : (m ? fmtGrams(grams(m, matCalc())) : '—');
    var sum = t && t.plates.length > 1 ? checkedTotal(t, matCalc()) : null;
    totalEl.hidden = !sum;
    if (sum) {
      totalEl.innerHTML = '<span>' + esc(tn(sum.n, '{n} plateau', '{n} plateaux')) + '</span>' +
        '<b>' + esc(sum.g ? (sum.est ? fmtGrams(sum.g) : fmtWeight(sum.g)) : '—') + (sum.time ? ' · ' + esc(fmtTime(sum.time)) : '') + '</b>';
    }
    var label = state.mat === 'any'
      ? (f ? _t('À conseiller') : DEF.mat)
      : FAM_OF[state.mat];
    if (state.color) label += ' · ' + state.color.name;
    rMat.textContent = label;

    var w = '';
    if (m && f) {
      var big = Math.max(m.size[0], m.size[1], m.size[2]);
      if (big > 256) w = _t('Plus grand que nos plateaux (256 mm) : on en reparle dans la soumission.');
      else if (big < 3) w = _t('Très petit : ton fichier est-il bien en millimètres ?');
    }
    warnEl.textContent = w;
    warnEl.hidden = !w;
  }

  function show(i, still) {
    current = i;
    var f = i >= 0 ? files[i] : null;
    var m = f ? f.mesh : example;
    var changed = m !== mesh;
    if (m) {
      mesh = m;
      if (changed) {
        view.set(m);
        view.tint(color, !!state.color);
        view.build(!still && (!!f || !booted));
        ctl.sync();
      } else view.draw();
    } else if (view.paths()) { view.set(null); ctl.sync(); }
    readout();
    paintList();
    paintPlates();
  }

  /* ---------- 3MF : le Worker lit le fichier, la page ne garde que le plateau affiché ---------- */
  var stripFor = null;
  function paintPlates() {
    var f = current >= 0 ? files[current] : null, t = f && f.three, many = t && t.plates.length > 1;
    strip.hidden = !many;
    if (!many) { stripFor = null; strip.innerHTML = ''; return; }
    if (stripFor !== f) {
      stripFor = f;
      strip.innerHTML = t.plates.map(function (p, i) {
        return '<li class="ip-plate' + (p.url ? '' : ' no-img') + '" data-i="' + i + '">' +
          '<button type="button" class="ip-plate-b" aria-label="' + esc(_t('Voir le plateau') + ' ' + p.id) + '">' +
          (p.url ? '<img src="' + esc(p.url) + '" alt="" width="78" height="78">' : '') + '<span>' + p.id + '</span></button>' +
          '<label class="ip-plate-c"><input type="checkbox" aria-label="' + esc(_t('Imprimer le plateau') + ' ' + p.id) + '"' + (p.on ? ' checked' : '') + '>' +
          '<i aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg></i></label></li>';
      }).join('');
      strip.scrollLeft = 0;
    }
    all('.ip-plate', strip).forEach(function (li, i) {
      var on = i === t.pi;
      li.classList.toggle('is-on', on);
      li.classList.toggle('is-off', !t.plates[i].on);
      li.querySelector('.ip-plate-b').setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function askPlate(f, i) {
    var t = f.three, p = t.plates[i];
    t.pi = i;
    if (!glOK) return false;
    if (!p.hasMesh && !(p.gcode && view.canPaths)) { f.mesh = null; return false; }
    t.rd.ask(i);
    return true;
  }
  function read3mf(f) {
    return new Promise(function (resolve) {
      function end() { f.reading = false; resolve(); }
      var rd = A.reader(f.file, {
        paths: view.canPaths,
        progress: function (v) {
          f.pct = Math.round(v * 100);
          if (files[current] === f) fsize.textContent = sizeText(f);
        },
        fail: function () {
          var late = !f.reading;
          dropFile(f);
          f.mesh = null;
          end();
          if (late && files[current] === f) { mesh = null; show(current, true); }   // plateau suivant impossible à lire
        },
        meta: function (m) {
          m.plates.forEach(function (p) {
            p.on = true;
            p.url = p.thumb ? URL.createObjectURL(p.thumb) : '';
          });
          f.three = { rd: rd, plates: m.plates, pi: 0, lightened: m.lightened };
          if (!askPlate(f, 0)) end();
        },
        plate: function (m) {
          var t = f.three;
          if (!t) return;
          var p = t.plates[m.i], P = m.paths;
          if (P) {                                 // G-code : les trajets, les vraies dimensions, les chiffres du fichier
            p.size = P.size;
            p.drawn = true;
            if (!p.time) p.time = P.time;
            if (!p.weight) p.weight = P.weight;
            if (P.light) t.lightened = true;
            f.mesh = P;
          } else {
            p.drawn = false;
            f.mesh = m.pos ? { pos: m.pos, count: m.pos.length / 3, size: p.size, volume: p.volume, area: p.area, groups: m.groups, rect: m.rect } : null;
          }
          if (f.reading) end();
          else if (files[current] === f) { mesh = null; show(current, true); }
        }
      });
      if (!rd) { end(); return; }
      f.stop = rd.stop;
    });
  }
  function dropFile(f) {
    if (f.stop) f.stop();
    if (f.three) f.three.plates.forEach(function (p) { if (p.url) URL.revokeObjectURL(p.url); });
    f.three = null;
    if (stripFor === f) stripFor = null;
  }
  strip.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.ip-plate-b') : null, f = files[current];
    if (!b || !f || !f.three) return;
    var i = +b.parentNode.getAttribute('data-i');
    if (i === f.three.pi) return;
    if (!askPlate(f, i)) { mesh = null; show(current, true); } else { readout(); paintPlates(); }
    var li = b.parentNode, l = li.offsetLeft, r = l + li.offsetWidth;
    if (l < strip.scrollLeft + 12) strip.scrollLeft = Math.max(0, l - 12);
    else if (r > strip.scrollLeft + strip.clientWidth - 12) strip.scrollLeft = r - strip.clientWidth + 12;
  });
  strip.addEventListener('change', function (e) {
    var f = files[current], li = e.target.closest ? e.target.closest('.ip-plate') : null;
    if (!li || !f || !f.three) return;
    var plates = f.three.plates, p = plates[+li.getAttribute('data-i')];
    if (!e.target.checked && plates.filter(function (x) { return x.on; }).length === 1) {
      e.target.checked = true;
      say(_t('Garde au moins un plateau.'), 'is-err');
      return;
    }
    p.on = e.target.checked;
    say('');
    readout();
    paintPlates();
  });
  shot.addEventListener('load', function () {        // la pièce de la section Matériaux suit
    if (!miniCtx || shot.hidden) return;
    var mw = mini.width, mh = mini.height, k = Math.min(mw / shot.naturalWidth, mh / shot.naturalHeight);
    miniCtx.clearRect(0, 0, mw, mh);
    miniCtx.drawImage(shot, (mw - shot.naturalWidth * k) / 2, (mh - shot.naturalHeight * k) / 2, shot.naturalWidth * k, shot.naturalHeight * k);
  });

  function paintList() {
    list.innerHTML = files.map(function (f, i) {
      return '<li class="ip-file' + (i === current ? ' is-on' : '') + '">' +
        '<button type="button" class="ip-file-b" data-i="' + i + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12 4 7.5"/></svg>' +
        '<span class="ip-file-n">' + esc(f.file.name) + '</span><em>' + esc(fmtSize(f.file.size)) + '</em></button>' +
        '<button type="button" class="ip-file-x" data-i="' + i + _t('" aria-label="Retirer le fichier ') + esc(f.file.name) + '">×</button></li>';
    }).join('');
    list.hidden = !files.length;
    drop.classList.toggle('is-full', files.length >= MAX_FILES);
  }

  function readFile(f) {
    if (READ3.test(f.file.name)) return read3mf(f);
    if (!READ.test(f.file.name)) { f.reading = false; return Promise.resolve(); }
    f.reading = true;
    return f.file.arrayBuffer().then(function (buf) {
      f.mesh = /\.stl$/i.test(f.file.name) ? A.parseSTL(buf) : A.parseOBJ(buf);
    }).catch(function () { f.mesh = null; }).then(function () { f.reading = false; });
  }

  function add(fl) {
    var bad = '', fresh = null;
    [].slice.call(fl || []).forEach(function (f) {
      if (!EXT.test(f.name)) { bad = _t('Formats acceptés : STL, 3MF, STEP, OBJ, G-code.'); return; }
      if (f.size > MAX_BYTES) { bad = _t('Fichier trop lourd (50 Mo maximum).'); return; }
      if (files.some(function (x) { return x.file.name === f.name && x.file.size === f.size; })) return;
      if (files.length >= MAX_FILES) { bad = _t('Au plus 3 fichiers 3D par demande.'); return; }
      var row = { file: f, mesh: null, reading: true };
      files.push(row);
      fresh = fresh || row;
      readFile(row).then(function () { if (files[current] === row) { mesh = null; show(current); } else paintList(); });
    });
    say(bad, bad ? 'is-err' : '');
    if (fresh) {
      flag(desc, false);
      openForm();
      show(files.indexOf(fresh));
    }
  }

  function openForm(noScroll) {
    var was = more.classList.contains('is-open');
    more.classList.add('is-open');
    root.classList.add('ip-form-open');
    if (!was && noScroll !== true) goForm();
  }
  function goForm() {
    var target = window.innerWidth <= 900 ? $('ip-hero') : form;
    var r = target.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.6) {
      (window.innerWidth <= 900 ? drop : $('ip-hero')).scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }

  fileIn.addEventListener('change', function () { add(fileIn.files); fileIn.value = ''; });
  list.addEventListener('click', function (e) {
    var x = e.target.closest ? e.target.closest('.ip-file-x') : null;
    if (x) {
      var i = +x.getAttribute('data-i');
      dropFile(files[i]);
      files.splice(i, 1);
      say('');
      var next = files.length ? Math.min(i, files.length - 1) : -1;
      mesh = null;
      show(next);
      return;
    }
    var b = e.target.closest ? e.target.closest('.ip-file-b') : null;
    if (b) { mesh = null; show(+b.getAttribute('data-i')); }
  });

  /* glisser un fichier n'importe où sur la page (et jamais quitter la page par erreur) */
  var dragT = 0;
  function hasFiles(e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
  function inPanel(e) { return e.target && e.target.closest && e.target.closest('.msg-panel'); }
  function dragOff() { clearTimeout(dragT); root.classList.remove('ip-dragging'); }
  // dragover se répète tant que le fichier survole la page : quand il cesse (Échap, sortie de la fenêtre), le voile part
  function dragOn(e) {
    if (!hasFiles(e) || inPanel(e)) return false;
    root.classList.add('ip-dragging');
    clearTimeout(dragT);
    dragT = setTimeout(dragOff, 700);
    return true;
  }
  document.addEventListener('dragenter', dragOn);
  document.addEventListener('dragover', function (e) { if (dragOn(e)) e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    dragOff();
    if (!hasFiles(e) || inPanel(e)) return;
    e.preventDefault();
    add(e.dataTransfer.files);
    goForm();
  });

  /* pas de fichier : on dessine */
  function checkSvc(v) {
    var r = form.querySelector('input[name="ip-svc"][value="' + v + '"]');
    if (r) r.checked = true;
  }
  $('ip-nofile').addEventListener('click', function () {
    checkSvc('design');
    openForm(true);
    setTimeout(function () { desc.focus({ preventScroll: true }); }, reduce ? 0 : 200);
  });

  /* lignes de service + liens vers la demande */
  all('a[href="#demande"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var svc = a.getAttribute('data-svc');
      if (svc) checkSvc(svc);
      e.preventDefault();
      openForm(true);
      (window.innerWidth <= 900 ? drop : $('ip-hero')).scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  });
  if (location.hash === '#demande') openForm(true);
  window.addEventListener('hashchange', function () { if (location.hash === '#demande') openForm(true); });

  /* =========================================================
     Couleurs en stock
     ========================================================= */
  var stock = {};                 // famille → [{ line, items:[{ name, hex, bg, material, fam }] }]
  var cName = $('ip-color-name'), cWrap = $('ip-colors'), cBox = $('ip-color-sw');
  var CDEF = cName.textContent;
  var pickN = $('ip-pick-n'), pickM = $('ip-pick-m'), pickGo = $('ip-pick-go');
  var PDEF = { n: pickN.textContent, m: pickM.textContent, go: pickGo.textContent };

  function famOf(material) {
    var m = /^(PLA|PETG|ABS|TPU)\b/i.exec(material || '');
    return m ? m[1].toUpperCase() : '';
  }
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
  function swatchBg(p) {
    var cs = p.attrs && Array.isArray(p.attrs.colors) ? p.attrs.colors.filter(isHex) : [];
    if (!cs.length) cs = [p.hex];
    var bg = cs[0];
    if (cs.length > 1) {
      var n = cs.length, parts = [];
      for (var i = 0; i < n; i++) parts.push(cs[i] + ' ' + (100 * i / n) + '%', cs[i] + ' ' + (100 * (i + 1) / n) + '%');
      bg = 'linear-gradient(90deg,' + parts.join(',') + ')';
    }
    return /sparkle|galaxy|glitter/i.test(p.material || '') ? 'var(--sparkle), ' + bg : bg;
  }
  function dotsHTML(fam) {
    var groups = stock[fam] || [];
    return groups.map(function (g, gi) {
      return '<div class="ip-swg' + (groups.length === 1 ? ' is-solo' : '') + '"><span>' + esc(g.line) + '</span><div class="ip-dots">' +
        g.items.map(function (c, ci) {
          return '<button type="button" class="ip-dot" data-fam="' + fam + '" data-g="' + gi + '" data-c="' + ci + '" style="--c:' + esc(c.bg) + ';background:' + esc(c.bg) + '"' +
            ' title="' + esc(c.name) + '" aria-label="' + esc(c.name + ', ' + c.material) + '" aria-pressed="false"></button>';
        }).join('') + '</div></div>';
    }).join('');
  }
  function syncDots() {
    all('.ip-dot').forEach(function (b) {
      var c = (stock[b.getAttribute('data-fam')] || [])[+b.getAttribute('data-g')];
      c = c && c.items[+b.getAttribute('data-c')];
      b.setAttribute('aria-pressed', c && c === state.color ? 'true' : 'false');
    });
  }
  function paintColors() {
    var fam = FAM_OF[state.mat];
    var has = fam && stock[fam] && stock[fam].length;
    cWrap.hidden = !has;
    if (has && cBox.getAttribute('data-fam') !== fam) {
      cBox.innerHTML = dotsHTML(fam);
      cBox.setAttribute('data-fam', fam);
    }
    cName.textContent = state.color ? state.color.name : CDEF;
    if (state.color) {
      pickN.textContent = state.color.name;
      pickM.textContent = state.color.material;
      pickGo.textContent = _t('Demander dans cette couleur');
    } else {
      pickN.textContent = PDEF.n;
      pickM.textContent = PDEF.m;
      pickGo.textContent = PDEF.go;
    }
    syncDots();
  }
  function setColor(c) {
    state.color = c;
    color = c ? rgb(c.hex) : DEF_RGB.slice();
    if (c) {
      var key = Object.keys(FAM_OF).filter(function (k) { return FAM_OF[k] === c.fam; })[0];
      state.mat = key;
      var r = form.querySelector('input[name="ip-mat"][value="' + key + '"]');
      if (r) r.checked = true;
    }
    paintColors();
    readout();
    view.setColor(color, !!state.color);
    ctl.sync();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.ip-dot') : null;
    if (!b) return;
    var g = (stock[b.getAttribute('data-fam')] || [])[+b.getAttribute('data-g')];
    var c = g && g.items[+b.getAttribute('data-c')];
    if (!c) return;
    setColor(c === state.color ? null : c);
  });
  all('input[name="ip-mat"]', form).forEach(function (r) {
    r.addEventListener('change', function () {
      if (!r.checked) return;
      state.mat = r.value;
      // la couleur choisie n'existe pas dans l'autre matériau : on la retire
      if (state.color && FAM_OF[state.mat] !== state.color.fam) { state.color = null; color = DEF_RGB.slice(); view.setColor(color, false); ctl.sync(); }
      paintColors();
      readout();
    });
  });

  var sb = (window.CA || {}).sb;
  if (sb) {
    sb.from('products_public').select('name,material,hex,attrs,qty,qty_2,material_sort,sort_order')
      .eq('type', 'filament').order('material_sort', { ascending: true }).order('sort_order', { ascending: true })
      .then(function (res) {
        if (res.error || !res.data) return;
        var seen = {};
        res.data.forEach(function (p) {
          if (!(p.qty > 0 || p.qty_2 > 0) || !isHex(p.hex)) return;
          var fam = famOf(p.material);
          if (!fam) return;
          var key = p.material + '|' + p.name;
          if (seen[key]) return;
          seen[key] = 1;
          var line = String(p.material).slice(fam.length).trim();
          var groups = stock[fam] = stock[fam] || [];
          var g = groups.filter(function (x) { return x.line === line; })[0];
          if (!g) { g = { line: line, items: [] }; groups.push(g); }
          g.items.push({ name: p.name, hex: p.hex, bg: swatchBg(p), material: p.material, fam: fam });
        });
        all('.ip-mat').forEach(function (li) {
          var fam = li.getAttribute('data-fam');
          var n = (stock[fam] || []).reduce(function (s, g) { return s + g.items.length; }, 0);
          li.querySelector('.ip-sw').innerHTML = dotsHTML(fam);
          li.querySelector('.ip-count').textContent = n ? tn(n, '{n} couleur en stock', '{n} couleurs en stock') : '';
        });
        paintColors();
      }, function () { /* sans données : les matériaux restent, sans pastilles */ });

    /* ---------- vraies pièces ---------- */
    sb.from('products_public').select('name,image_path,attrs').eq('type', 'spacer').not('image_path', 'is', null)
      .order('sort_order', { ascending: true }).limit(4)
      .then(function (res) {
        var rows = res && !res.error ? res.data || [] : [];
        var ul = $('ip-parts'), sec = $('pieces');
        if (!rows.length || !CA0.newsImg) return;
        ul.innerHTML = rows.map(function (p) {
          var a = p.attrs || {};
          var size = String(a.speaker_size || '').replace(/"$/, '');
          size = size ? (EN ? size.replace(',', '.') + '"' : size + ' po') : '';
          var makes = [];
          (a.fitment || []).forEach(function (f) { if (f.make && makes.indexOf(f.make) < 0) makes.push(f.make); });
          var sub = makes.length ? makes.slice(0, 3).join(' · ') : _t('Conception maison');
          // la route marche toujours ; une page boutique/spacers/<slug>.html n'existe qu'après le passage du robot
          var slug = String(p.name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          return '<li><a class="ip-part" href="boutique/spacers#/s/' + esc(slug) + '"><img src="' + esc(CA0.newsImg(p.image_path)) + '" alt="' +
            esc(_t('Adaptateur') + ' ' + size) + '" loading="lazy" width="480" height="360"><p><b>' + esc(_t('Adaptateur') + ' ' + size) + '</b><small>' + esc(sub) + '</small></p></a></li>';
        }).join('');
        sec.hidden = false;
      }, function () { /* la section reste masquée */ });
  }

  /* =========================================================
     Envoi de la demande
     ========================================================= */
  function chosen(name) {
    var r = form.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : '';
  }
  function fileLines(f) {
    var mat = state.mat !== 'any' ? state.mat : 'pla', t = f.three;
    if (!t) return [_t('Fichier :') + ' ' + f.file.name + (f.mesh ? ', ' + fmtDim(f.mesh) + ', ' + fmtGrams(grams(f.mesh, mat)) : '')];
    var sum = checkedTotal(t, mat), bits = [f.file.name], n = t.plates.length;
    if (n === 1 && (t.plates[0].hasMesh || t.plates[0].drawn)) bits.push(fmtDim(t.plates[0]));
    if (sum.g) bits.push(sum.est ? fmtGrams(sum.g) : fmtWeight(sum.g));
    if (sum.time) bits.push(fmtTime(sum.time));
    var out = [_t('Fichier :') + ' ' + bits.join(', ')];
    if (n > 1) {
      var on = t.plates.filter(function (p) { return p.on; });
      out.push(_t('Plateaux :') + ' ' + (on.length === n
        ? _t('tous') + ' (' + n + ')'
        : on.map(function (p) { return p.id; }).join(', ') + ' ' + _t('sur') + ' ' + n));
    }
    return out;
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = desc.value.trim();
    var bad = !d && !files.length;
    flag(desc, bad);
    if (bad) { say(_t('Ajoute un fichier ou décris ta pièce.'), 'is-err'); desc.focus(); return; }
    var q = Math.max(1, Math.min(10000, parseInt(qty.value, 10) || 1));
    var notes = [];
    files.forEach(function (f) { notes = notes.concat(fileLines(f)); });
    say('');
    window.CA.demande.submit({
      details: {
        service: chosen('ip-svc'), material: chosen('ip-mat'), qty: q, desc: d, notes: notes.join('\n'),
        color: state.color ? { name: state.color.name, material: state.color.material } : null
      },
      files: files.map(function (f) { return f.file; })
    });
  });
  desc.addEventListener('input', function () { flag(desc, false); });

  function resetForm() {
    files.forEach(dropFile);
    files = []; mesh = null;
    desc.value = ''; qty.value = 1;
    checkSvc('file');
    var anyR = form.querySelector('input[name="ip-mat"][value="any"]');
    if (anyR) anyR.checked = true;
    state.mat = 'any'; state.color = null; color = DEF_RGB.slice();
    paintColors();
    show(-1);
    say('');
  }
  window.CA.demande.init({
    kind: 'print', form: form, status: status,
    onBusy: function (on) { submit.disabled = on; },
    onDone: function () { files.forEach(dropFile); },
    onReset: resetForm,
    // retour de l'appli courriel pendant la connexion : tout revient, sauf la couleur si le stock n'est pas encore lu
    onRestore: function (d, saved) {
      checkSvc(d.service || 'file');
      var m = form.querySelector('input[name="ip-mat"][value="' + (d.material || 'any') + '"]');
      if (m) { m.checked = true; m.dispatchEvent(new Event('change', { bubbles: true })); }
      qty.value = d.qty || 1;
      desc.value = d.desc || '';
      openForm(true);
      if (saved && saved.length) add(saved);
    }
  });

  /* ---------- départ : l'exemple se construit une fois, quand il entre à l'écran ---------- */
  var booted = false;
  mesh = example;
  view.set(example);
  readout();
  if (glOK) {
    var start = function () { booted = true; view.build(true); };
    view.setClip(0);
    if ('IntersectionObserver' in window && !reduce) {
      var seen = new IntersectionObserver(function (en) {
        if (!en[0].isIntersecting) return;
        seen.disconnect();
        setTimeout(start, 260);
      }, { threshold: 0.3 });
      seen.observe(viewEl);
      setTimeout(function () { if (!booted) { view.setClip(1); view.draw(); } }, 2500);
    } else { booted = true; view.setClip(1); view.draw(); }
  } else booted = true;
})();
