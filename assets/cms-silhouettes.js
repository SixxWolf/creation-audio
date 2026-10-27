/* =========================================================
   Création Audio — Silhouettes (onglet admin, groupe Atelier)
   Une image devient une pièce murale : aperçu Plan (grille mm, cotes,
   plateau, coupes déplaçables) · Mur · 3D (WebGL), réglages en 5 étapes (5 = fond + couleurs des filaments),
   contrôles de fabrication (morceaux détachés, passages minces, petits
   trous), export 3MF (segments mi-bois) / SVG / DXF.
   Calculs : silhouette-engine.js dans silhouette-worker.js (même ?v=,
   lu sur la balise du moteur) ; repli sur la page si le worker échoue.
   Défauts : admin_settings « silhouettes » + copie localStorage « sil-defaults ».
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var app = $('#sil-app'), E = window.SilEngine;
  if (!app || !E) return;

  var el = {
    stage: $('#sil-stage'), cv: $('#sil-cv'), gl: $('#sil-gl'), empty: $('#sil-empty'), busy: $('#sil-busy'),
    layers: $('#sil-layers'), bar3d: $('#sil-3dbar'), cropbar: $('#sil-cropbar'), zoom: $('#sil-zoom'), view: $('#sil-view'),
    drop: $('#sil-drop'), file: $('#sil-file'), fileName: $('#sil-file-name'), imgSum: $('#sil-img-sum'),
    crop: $('#sil-crop'), cropSum: $('#sil-crop-sum'),
    aiBtn: $('#sil-ai-btn'), ai: $('#sil-ai'), aiSubj: $('#sil-ai-subj'), aiOut: $('#sil-ai-out'), aiCopy: $('#sil-ai-copy'), aiMsg: $('#sil-ai-msg'),
    thr: $('#sil-thr'), thrV: $('#sil-thr-v'), thrAuto: $('#sil-thr-auto'), inv: $('#sil-inv'),
    smooth: $('#sil-smooth'), smoothV: $('#sil-smooth-v'), simp: $('#sil-simp'), simpV: $('#sil-simp-v'),
    speck: $('#sil-speck'), stroke: $('#sil-stroke'), strokeMin: $('#sil-stroke-min'), margin: $('#sil-margin'),
    bridge: $('#sil-bridge'), holeMin: $('#sil-hole-min'),
    sw: $('#sil-w'), sh: $('#sil-h'), adapt: $('#sil-adapt'), adaptV: $('#sil-adapt-v'),
    thick: $('#sil-thick'), min: $('#sil-min'), ov: $('#sil-ov'),
    backT: $('#sil-back-t'), backM: $('#sil-back-m'), backDims: $('#sil-back-dims'), colPiece: $('#sil-col-piece'), colBack: $('#sil-col-back'), colBackF: $('#sil-col-back-f'),
    defsSave: $('#sil-defs-save'), defsMsg: $('#sil-defs-msg'),
    nIsl: $('#sil-n-isl'), nThin: $('#sil-n-thin'), nHoles: $('#sil-n-holes'), nSeg: $('#sil-n-seg'),
    cutsAuto: $('#sil-cuts-auto'), warn: $('#sil-warn'),
    edit: $('#sil-edit'), editbar: $('#sil-editbar'), edTools: $('#sil-ed-tools'), edUndo: $('#sil-ed-undo'), edClear: $('#sil-ed-clear'), edSt: $('#sil-ed-st'),
    edSize: $('#sil-ed-size'), edRange: $('#sil-ed-range'), edSz: $('#sil-ed-sz'),
    b3mf: $('#sil-3mf'), bsvg: $('#sil-svg'), bdxf: $('#sil-dxf'), report: $('#sil-report'), explode: $('#sil-explode')
  };

  var S = {
    img: null,            // { cv (canvas), w, h, w0, h0, name, gray }
    ready: false,         // image reçue par le worker
    res: null, paths: null,
    view: 'plan', layers: { image: false, checks: true, segments: true },
    sizeAxis: 'w',        // case de taille qui commande (largeur ou hauteur), l'autre suit
    cuts: null,           // coupes manuelles (fractions de la longueur), null = auto
    islands: [],          // choix par morceau [{ fx, fy, act }]
    edits: [],            // retouches [{ t: fill|empty, p } | { t: line, pts } | { t: paint|erase, pts, s (mm) }], points [u, v] en px de l'image
    crop: null,           // [x0, y0, x1, y1] en px de l'image de travail, null = toute
    cropping: false, fitPending: true, dragCuts: null, hoverSeg: -1, hoverIsl: null, exporting: 0
  };

  /* ------------------------------------------------------------------ */
  /*  Outils                                                             */
  /* ------------------------------------------------------------------ */
  function fmt(n, d) { return (+n).toLocaleString('fr-CA', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mmTxt(n) { return fmt(n, n < 100 ? 1 : 0) + ' mm'; }
  function numv(input, d) { var v = parseFloat(String(input.value).replace(',', '.')); return isFinite(v) ? v : d; }
  function toastErr(msg) {
    if (window.caDialog && caDialog.toast) caDialog.toast(msg, 'bad');
    else if (window.console) console.warn(msg);
  }
  // État des boutons segmentés = aria-checked (la classe .is-active est partagée avec d'autres onglets)
  function segVal(id) { var b = $('#' + id + ' .fx-seg-btn[aria-checked="true"]'); return b ? b.getAttribute('data-v') : null; }
  function setSeg(id, v) {
    $$('#' + id + ' .fx-seg-btn').forEach(function (b) {
      var on = b.getAttribute('data-v') === v;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  function onSeg(id, cb) {
    $('#' + id).addEventListener('click', function (e) {
      var b = e.target.closest('.fx-seg-btn');
      if (!b || b.getAttribute('aria-checked') === 'true') return;
      setSeg(id, b.getAttribute('data-v'));
      cb(b.getAttribute('data-v'));
    });
  }
  function params(draft) {
    return {
      threshold: +el.thr.value, invert: el.inv.checked, smooth: +el.smooth.value, simplify: +el.simp.value,
      speck: numv(el.speck, 4), crop: S.crop,
      mode: segVal('sil-mode'), stroke: numv(el.stroke, 4), strokeMin: numv(el.strokeMin, 2), margin: numv(el.margin, 15),
      bridge: numv(el.bridge, 3), holeMin: numv(el.holeMin, 1.5),
      sizeAxis: S.sizeAxis, size: numv(S.sizeAxis === 'h' ? el.sh : el.sw, 600), adapt: +el.adapt.value,
      printer: segVal('sil-printer'), thickness: numv(el.thick, 4), minStroke: numv(el.min, 3), overlap: numv(el.ov, 12),
      islandMode: segVal('sil-isl'), islands: S.islands, thinMode: segVal('sil-thin'), holeMode: segVal('sil-holes'),
      back: segVal('sil-back'), backT: numv(el.backT, 2), backM: numv(el.backM, 5), colPiece: colHex(el.colPiece), colBack: colHex(el.colBack),
      cuts: S.cuts, edits: S.edits, draft: !!draft
    };
  }
  var cssProbe = document.createElement('canvas').getContext('2d');
  function rgb(css) {            // couleur CSS -> [r, g, b] (0..1)
    cssProbe.fillStyle = '#000'; cssProbe.fillStyle = css;
    var v = cssProbe.fillStyle, m;
    if (v.charAt(0) === '#') return [parseInt(v.substr(1, 2), 16) / 255, parseInt(v.substr(3, 2), 16) / 255, parseInt(v.substr(5, 2), 16) / 255];
    m = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(v);
    return m ? [m[1] / 255, m[2] / 255, m[3] / 255] : [0, 0, 0];
  }
  function colors() {
    var cs = getComputedStyle(app), g = function (n, d) { return (cs.getPropertyValue(n) || '').trim() || d; };
    return {
      paper: g('--paper', '#fff'), wash: g('--wash', '#f4f3ef'), line: g('--line', '#e2e0da'), line2: g('--line-2', '#d0cdc4'),
      ink: g('--ink', '#16171a'), ink2: g('--ink-2', '#3a3d45'), muted: g('--muted', '#767a82'), ember: g('--ember', '#ff6a2b'),
      bad: g('--bad', '#d64545'), good: g('--good', '#2f9e5b'), display: g('--display', 'sans-serif')
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Worker (calculs en arrière-plan) ; repli sur la page                */
  /* ------------------------------------------------------------------ */
  var engTag = $('script[src*="silhouette-engine.js"]');
  var VER = (/[?&]v=([\w.-]+)/.exec(engTag ? engTag.getAttribute('src') : '') || [])[1] || '1';
  var WURL = engTag ? engTag.src.replace(/silhouette-engine\.js[^\/]*$/, 'silhouette-worker.js?v=' + VER) : 'assets/silhouette-worker.js?v=' + VER;
  var worker = null, jobN = 0, waits = {}, sent = {};

  function onMsg(e) {
    var m = e.data || {}, k = m.job != null ? 'j' + m.job : 'i' + m.id, cb = waits[k];
    delete sent[k];
    if (cb) { delete waits[k]; cb(m); }
  }
  function makeLocal() {
    var ctx = null;
    return {
      local: true,
      postMessage: function (m) {
        setTimeout(function () {
          var out;
          try {
            if (m.type === 'image') { ctx = E.context(m.gray, m.w, m.h); out = { type: 'image', id: m.id, otsu: E.otsu(m.gray) }; }
            else if (!ctx) throw new Error('Aucune image chargée.');
            else if (m.type === 'compute') out = { type: 'result', job: m.job, res: E.compute(ctx, m.params) };
            else if (m.type === 'mesh') out = { type: 'mesh', job: m.job, mesh: E.preview3d(ctx, m.params) };
            else if (m.type === 'export') out = { type: 'file', job: m.job, file: E.exportFile(ctx, m.params, m.format, m.name) };
          } catch (err) { out = { type: 'error', job: m.job, id: m.id, message: String(err && err.message || err) }; }
          onMsg({ data: out });
        }, 0);
      }
    };
  }
  // Worker introuvable (fichier absent, réseau) : on bascule sur la page et on renvoie ce qui attendait.
  function switchLocal() {
    if (worker && worker.local) return;
    try { if (worker && worker.terminate) worker.terminate(); } catch (e) {}
    worker = makeLocal();
    var keys = Object.keys(sent).sort(function (a, b) {
      if (a.charAt(0) !== b.charAt(0)) return a.charAt(0) === 'i' ? -1 : 1;
      return +a.slice(1) - +b.slice(1);
    });
    if (S.img && !keys.some(function (k) { return k.charAt(0) === 'i'; })) worker.postMessage({ type: 'image', id: 0, gray: S.img.gray, w: S.img.w, h: S.img.h });
    keys.forEach(function (k) { worker.postMessage(sent[k]); });
  }
  function getWorker() {
    if (worker) return worker;
    try {
      worker = new Worker(WURL);
      worker.onmessage = onMsg;
      worker.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); switchLocal(); };
    } catch (e) { worker = makeLocal(); }
    return worker;
  }
  function post(msg) {
    return new Promise(function (resolve) {
      var w = getWorker(), k;
      if (msg.type === 'image') { msg.id = ++jobN; k = 'i' + msg.id; } else { msg.job = ++jobN; k = 'j' + msg.job; }
      waits[k] = resolve; sent[k] = msg;
      w.postMessage(msg);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Calcul : le plus récent gagne (brouillon pendant qu'on glisse)      */
  /* ------------------------------------------------------------------ */
  var cBusy = false, cNext = null, cTimer = 0, busyN = 0;
  function setBusy(on) { busyN = Math.max(0, busyN + (on ? 1 : -1)); el.busy.hidden = busyN === 0; }
  function schedule(draft, delay) {
    clearTimeout(cTimer);
    if (!S.img || !S.ready) return;
    if (delay) { cTimer = setTimeout(function () { schedule(draft, 0); }, delay); return; }
    cNext = params(draft);
    if (!cBusy) runNext();
  }
  function runNext() {
    var p = cNext;
    cNext = null; cBusy = true; setBusy(true);
    post({ type: 'compute', params: p }).then(function (m) {
      cBusy = false; setBusy(false);
      if (m.type === 'result') onResult(m.res, p);
      else if (m.type === 'error') toastErr('Calcul impossible : ' + m.message);
      if (cNext) runNext();
    });
  }
  function onResult(res, p) {
    var prev = S.res;
    if (!res || !res.ok) { S.res = null; S.paths = null; renderPanel(); draw(); return; }
    S.res = res; S.paths = buildPaths(res); S.dragCuts = null;
    if (ED.on) edStatus();
    var e0 = prev && extent(prev), e1 = extent(res);
    if (S.fitPending || !prev || Math.abs(e0[2] - e0[0] - e1[2] + e1[0]) > (e0[2] - e0[0]) * 0.02 || Math.abs(e0[3] - e0[1] - e1[3] + e1[1]) > (e0[3] - e0[1]) * 0.02) {
      fit(); S.fitPending = false;
    }
    renderPanel(); draw();
    if (S.view === '3d' && !p.draft) request3d();
  }
  // boîte à cadrer en mm : la pièce, élargie au fond s'il y en a un
  function extent(R) {
    var b = R.back && R.back.box;
    return b ? [Math.min(0, b[0]), Math.min(0, b[1]), Math.max(R.w, b[2]), Math.max(R.h, b[3])] : [0, 0, R.w, R.h];
  }
  function toPath(pk) {
    if (!pk || !pk.starts || pk.starts.length < 2) return null;
    var p = new Path2D(), pts = pk.pts, st = pk.starts;
    for (var k = 0; k < st.length - 1; k++) {
      var a = st[k] * 2, b = st[k + 1] * 2;
      p.moveTo(pts[a], pts[a + 1]);
      for (var i = a + 2; i < b; i += 2) p.lineTo(pts[i], pts[i + 1]);
      p.closePath();
    }
    return p;
  }
  function buildPaths(res) {
    var o = res.over || {};
    return { piece: toPath(res.piece) || new Path2D(), added: toPath(o.added), thin: toPath(o.thin), holes: toPath(o.holes), drop: toPath(o.drop), apart: toPath(o.apart), back: res.back ? toPath(res.back.rings) : null };
  }

  /* ------------------------------------------------------------------ */
  /*  Image : fichier, glisser-déposer, coller                            */
  /* ------------------------------------------------------------------ */
  function loadFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '') && !/\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file.name || '')) { toastErr('Ce fichier n\'est pas une image.'); return; }
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () { useImage(img, file.name || 'image'); URL.revokeObjectURL(url); };
    img.onerror = function () { URL.revokeObjectURL(url); toastErr('Image illisible.'); };
    img.src = url;
  }
  function useImage(img, name) {
    var w0 = img.naturalWidth || 1200, h0 = img.naturalHeight || 1200, k = Math.min(1, 2400 / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var c = cv.getContext('2d', { willReadFrequently: true });
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0, 0, w, h);
    var gray;
    try { gray = E.grayFromRGBA(c.getImageData(0, 0, w, h).data, w, h); }
    catch (e) { toastErr('Image illisible.'); return; }
    // fond foncé (bordure sombre) : on part en « sujet clair »
    var sum = 0, cnt = 0, x, y;
    for (x = 0; x < w; x++) { sum += gray[x] + gray[(h - 1) * w + x]; cnt += 2; }
    for (y = 0; y < h; y++) { sum += gray[y * w] + gray[y * w + w - 1]; cnt += 2; }
    el.inv.checked = sum / cnt < 100;
    S.img = { cv: cv, w: w, h: h, w0: w0, h0: h0, name: name, gray: gray };
    S.ready = false; S.res = null; S.paths = null; S.crop = null; S.cuts = null; S.islands = []; S.fitPending = true;
    S.edits = []; ED.draft = null; ED.sel = -1;
    setImageUI(); renderPanel(); draw();
    setBusy(true);
    post({ type: 'image', gray: gray, w: w, h: h }).then(function (m) {
      setBusy(false);
      if (m.type !== 'image') { toastErr('Image refusée : ' + (m.message || '')); return; }
      el.thr.value = m.otsu; updateOutputs();
      S.ready = true;
      schedule(false);
    });
  }
  function setImageUI() {
    var has = !!S.img;
    el.empty.hidden = has;
    el.drop.classList.toggle('has-file', has);
    el.fileName.textContent = has ? S.img.name : 'PNG, JPG, WebP, SVG';
    el.crop.disabled = !has;
    el.imgSum.textContent = has ? fmt(S.img.w0) + ' × ' + fmt(S.img.h0) + ' px' : '';
    el.cropSum.textContent = S.crop ? 'Recadrée' : '';
  }
  function pickFile() { el.file.value = ''; el.file.click(); }
  el.file.addEventListener('change', function () { if (el.file.files && el.file.files[0]) loadFile(el.file.files[0]); });
  el.empty.addEventListener('click', pickFile);
  el.drop.addEventListener('click', pickFile);
  el.drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); } });
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') !== -1; }
  [[el.stage, el.stage], [el.drop, el.drop]].forEach(function (z) {
    var zone = z[0], hl = z[1];
    zone.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); hl.classList.add('drag'); });
    zone.addEventListener('dragleave', function (e) { if (!zone.contains(e.relatedTarget)) hl.classList.remove('drag'); });
    zone.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); hl.classList.remove('drag');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
  });
  document.addEventListener('paste', function (e) {
    if (document.body.getAttribute('data-tab') !== 'silhouettes') return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { e.preventDefault(); loadFile(items[i].getAsFile()); return; }
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Prompt IA à copier (Gemini, en anglais) : reprend la taille, le     */
  /*  trait et le plus petit détail réglés pour que l'image revienne      */
  /*  prête à tracer (noir pur, tout relié, rien de flottant)             */
  /* ------------------------------------------------------------------ */
  var AI_PX = 2048;   // largeur d'image demandée à l'IA
  function aiPrompt() {
    var src = segVal('sil-ai-src'), style = segVal('sil-ai-style'), subj = el.aiSubj.value.trim();
    var W = numv(el.sw, 600), H = numv(el.sh, 0), minS = numv(el.min, 3);
    var gap = Math.max(minS, numv(el.holeMin, 1.5)), line = style === 'trait' ? Math.max(minS, numv(el.stroke, 4)) : minS;
    var pct = function (mm) { var v = mm / W * 100; return (v < 1 ? v.toFixed(2) : v.toFixed(1)) + '%'; };
    var px = function (mm) { return Math.max(1, Math.round(mm / W * AI_PX)) + ' px'; };
    var kind = style === 'trait' ? 'continuous line art' : 'a solid stencil silhouette';
    var what = subj || (src === 'image' ? 'the subject of the attached image' : '[subject]');
    var L = [];
    if (src === 'image') L.push('Redraw the attached image as ' + kind + ' of ' + what + '. Keep the exact pose, proportions and outline of the original.');
    else L.push('Create ' + kind + ' of ' + what + ', seen from its most recognizable angle.');
    L.push('It will become a wall decoration cut or 3D-printed at ' + Math.round(W) + ' mm wide' + (H ? ' by ' + Math.round(H) + ' mm tall' : '') + ', so it must hold together as one physical piece.');
    L.push('', 'Rules:');
    L.push('- Pure black (#000000) on pure white (#FFFFFF). No gray, shading, gradient, texture, shadow, text, signature or frame.');
    if (style === 'trait') {
      L.push('- Every shape is drawn with one uniform black line, like a neon sign or a laser-cut metal outline. Line width about ' + pct(line) + ' of the image width (' + px(line) + ' on a ' + AI_PX + ' px wide image), the same everywhere.');
      L.push('- No filled areas: only the lines are black.');
    } else {
      L.push('- The subject is solid black; inner details are white cut-outs (negative space), like a stencil.');
      L.push('- Thinnest black part at least ' + pct(line) + ' of the image width (' + px(line) + ' on a ' + AI_PX + ' px wide image).');
    }
    L.push('- All black parts connect into a single piece: nothing floating, no loose dots or islands.');
    L.push('- Lines meet cleanly at junctions; closed shapes stay fully closed, with no small gaps.');
    L.push('- Keep at least ' + pct(gap) + ' of the width (' + px(gap) + ') of white between black parts; leave out any detail smaller than that.');
    L.push('- Simplify: keep only what defines the silhouette and its key features.');
    L.push('- Subject centered, filling the frame with a small white margin' + (H ? ', aspect ratio about ' + (W / H).toFixed(2).replace(/\.?0+$/, '') + ':1' : '') + '. Flat 2D image, ' + AI_PX + ' px wide.');
    return L.join('\n');
  }
  function aiRender() { if (!el.ai.hidden) el.aiOut.value = aiPrompt(); }
  var aiOpened = false;
  el.aiBtn.addEventListener('click', function () {
    var open = el.ai.hidden;
    el.ai.hidden = !open;
    el.aiBtn.setAttribute('aria-expanded', String(open));
    if (open && !aiOpened) {
      // premier affichage : style du rendu choisi, départ « de zéro » sans image
      aiOpened = true;
      setSeg('sil-ai-style', segVal('sil-mode') === 'contour' ? 'trait' : 'pochoir');
      if (!S.img) setSeg('sil-ai-src', 'zero');
    }
    aiRender();
  });
  onSeg('sil-ai-src', aiRender);
  onSeg('sil-ai-style', aiRender);
  el.aiSubj.addEventListener('input', aiRender);
  // tout réglage du panneau (taille, trait, contrôles) met le prompt à jour
  ['input', 'change', 'click'].forEach(function (t) {
    $('#sil-panel').addEventListener(t, function () { if (!el.ai.hidden) setTimeout(aiRender, 0); });
  });
  var aiMsgT = 0;
  el.aiCopy.addEventListener('click', function () {
    var txt = aiPrompt(), done = function (ok) {
      el.aiMsg.textContent = ok ? 'Copié' : 'Copie refusée';
      clearTimeout(aiMsgT); aiMsgT = setTimeout(function () { el.aiMsg.textContent = ''; }, 2500);
    };
    el.aiOut.value = txt;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(fallback()); });
    else done(fallback());
    function fallback() {
      el.aiOut.focus(); el.aiOut.select();
      try { return document.execCommand('copy'); } catch (err) { return false; }
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Réglages                                                           */
  /* ------------------------------------------------------------------ */
  function updateOutputs() {
    el.thrV.textContent = el.thr.value;
    el.smoothV.textContent = el.smooth.value;
    el.adaptV.textContent = el.adapt.value + ' %';
    el.simpV.textContent = fmt(+el.simp.value, +el.simp.value % 0.1 ? 2 : 1) + ' mm';
    var mode = segVal('sil-mode');
    $$('#sil-app [data-only]').forEach(function (f) { f.hidden = f.getAttribute('data-only') !== mode; });
  }
  [el.thr, el.smooth, el.simp].forEach(function (r) {
    r.addEventListener('input', function () { updateOutputs(); schedule(true); });
    r.addEventListener('change', function () { updateOutputs(); schedule(false); });
  });
  el.thrAuto.addEventListener('click', function () {
    if (!S.img) return;
    el.thr.value = E.otsu(S.img.gray); updateOutputs(); schedule(false);
  });
  el.inv.addEventListener('change', function () { S.islands = []; schedule(false); });
  // champs numériques : recalcul après une courte pause de frappe
  [el.speck, el.stroke, el.strokeMin, el.margin, el.thick, el.min, el.ov, el.bridge, el.holeMin].forEach(function (f) {
    f.addEventListener('input', function () { schedule(false, 450); });
    f.addEventListener('change', function () { schedule(false); });
  });
  // Largeur et hauteur liées : la case tapée commande (S.sizeAxis), l'autre suit la proportion.
  function ratio() { return S.res ? S.res.h / S.res.w : S.img ? S.img.h / S.img.w : 1; }
  [[el.sw, 'w'], [el.sh, 'h']].forEach(function (z) {
    var f = z[0], axis = z[1];
    var sync = function () {
      S.sizeAxis = axis; S.cuts = null;
      var v = numv(f, 0), other = axis === 'w' ? el.sh : el.sw;
      if (v > 0) other.value = Math.round(axis === 'w' ? v * ratio() : v / ratio());
    };
    f.addEventListener('input', function () { sync(); schedule(false, 450); });
    f.addEventListener('change', function () { sync(); schedule(false); });
  });
  function syncSizeFields() {        // après un calcul : la case qui ne commande pas montre la cote obtenue
    if (!S.res) return;
    var other = S.sizeAxis === 'h' ? el.sw : el.sh;
    if (document.activeElement !== other) other.value = Math.round(S.sizeAxis === 'h' ? S.res.w : S.res.h);
  }
  el.adapt.addEventListener('input', function () { updateOutputs(); schedule(true); });
  el.adapt.addEventListener('change', function () { updateOutputs(); schedule(false); });
  onSeg('sil-mode', function () { updateOutputs(); S.islands = []; S.cuts = null; schedule(false); });
  onSeg('sil-printer', function () { S.cuts = null; schedule(false); });
  onSeg('sil-isl', function () { S.islands = []; schedule(false); });
  onSeg('sil-thin', function () { schedule(false); });
  onSeg('sil-holes', function () { schedule(false); });
  el.cutsAuto.addEventListener('click', function () { S.cuts = null; schedule(false); });
  [el.backT, el.backM].forEach(function (f) {
    f.addEventListener('input', function () { schedule(false, 450); });
    f.addEventListener('change', function () { schedule(false); });
  });
  function backUI() { var on = segVal('sil-back') !== 'none'; el.backDims.hidden = !on; el.colBackF.hidden = !on; }
  onSeg('sil-back', function () { backUI(); schedule(false); });

  /* ------------------------------------------------------------------ */
  /*  Couleurs : filaments Bambu Lab (products.hex), ordre de l'admin     */
  /* ------------------------------------------------------------------ */
  // Option = un filament (valeur = son id, data-hex = sa couleur) ; la couleur ne change que le rendu.
  var colPending = {};
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
  function colHex(sel) { var o = sel.options[sel.selectedIndex]; return (o && o.getAttribute('data-hex')) || (sel === el.colBack ? '#FFFFFF' : '#000000'); }
  function swOf(f) {
    var cs = (f.attrs && Array.isArray(f.attrs.colors) ? f.attrs.colors : []).filter(isHex), bg;
    if (cs.length >= 2) bg = 'linear-gradient(90deg,' + cs.map(function (c, i) { return c + ' ' + (100 * i / cs.length) + '%,' + c + ' ' + (100 * (i + 1) / cs.length) + '%'; }).join(',') + ')';
    else bg = cs[0] || f.hex;
    return /sparkle|galaxy|glitter|paillet/i.test(f.material || '') ? 'var(--sparkle), ' + bg : bg;
  }
  function setCol(sel, v) {
    if (!v) return;
    if ($('option[value="' + v + '"]', sel)) { sel.value = v; delete colPending[sel.id]; } else colPending[sel.id] = v;
    if (window.CA && CA.pick) CA.pick(sel);
  }
  function fillColors(list) {
    var mats = (window.CA && CA.materials && CA.materials.list) || [];
    var mi = function (m) { for (var i = 0; i < mats.length; i++) if (mats[i].brand === 'Bambu Lab' && mats[i].name === m) return i; return 9999; };
    list = list.filter(function (f) { return isHex(f.hex); }).sort(function (a, b) {
      return mi(a.material) - mi(b.material) || (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(b.name, 'fr');
    });
    if (!list.length) return;
    var html = '', mat = null;
    list.forEach(function (f) {
      if (f.material !== mat) { html += (mat !== null ? '</optgroup>' : '') + '<optgroup label="' + esc(f.material || '—') + '">'; mat = f.material; }
      html += '<option value="' + esc(f.id) + '" data-hex="' + f.hex.toUpperCase() + '" data-sw="' + esc(swOf(f)) + '">' + esc(f.name) + '</option>';
    });
    html += '</optgroup>';
    [[el.colPiece, '#000000'], [el.colBack, '#FFFFFF']].forEach(function (z) {
      var sel = z[0], cur = colHex(sel).toUpperCase(), want = colPending[sel.id];
      sel.innerHTML = html;
      // défaut : PLA Basic Black / Jade White
      var o = (want && $('option[value="' + want + '"]', sel)) || $('optgroup[label="PLA Basic"] option[data-hex="' + cur + '"]', sel) ||
        $('option[data-hex="' + cur + '"]', sel) || $('option[data-hex="' + z[1] + '"]', sel);
      if (o) sel.value = o.value;
      delete colPending[sel.id];
      if (window.CA && CA.pick) CA.pick(sel);
    });
    recolor();
  }
  function recolor() { if (S.view === '3d') render3d(); else draw(); }
  [el.colPiece, el.colBack].forEach(function (sel) {
    if (window.CA && CA.pick) CA.pick(sel);
    sel.addEventListener('change', recolor);
  });
  if (window.CA && window.CA.onAdminReady) window.CA.onAdminReady(function () {
    var sb = window.CA.sb;
    if (!sb) return;
    Promise.all([
      window.CA.loadMaterials ? window.CA.loadMaterials() : null,
      sb.from('products').select('id,name,material,hex,attrs,sort_order').eq('type', 'filament').eq('brand', 'Bambu Lab')
        .order('sort_order', { ascending: true })
    ]).then(function (r) { if (!r[1].error) fillColors(r[1].data || []); }, function () {});
  });

  /* ------------------------------------------------------------------ */
  /*  Panneau : contrôles, alertes, rapport                               */
  /* ------------------------------------------------------------------ */
  function setN(node, text, tone) { node.textContent = text; node.className = 'sil-ck-n' + (tone ? ' is-' + tone : ''); }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  // Pièces de la grille affichées (aussi pendant le glissement d'une coupe). Chaque coupe est une couture
  // (polyligne [x, y, …] en mm : x selon y pour une verticale, y selon x pour une horizontale) ; pendant le
  // glissement, elle suit la poignée en bloc. Joint à tenon caché : la pièce va de la couture précédente (au plus
  // loin) au bout du tenon de la suivante (couture + longueur du tenon) — même règle que le moteur.
  function segView() {
    var sg = S.res.seg, dc = S.dragCuts, cx = dc ? dc.x : sg.x.cuts, cy = dc ? dc.y : sg.y.cuts, ov = sg.ov, list = [];
    var seams = function (ax, cs) {
      return (sg[ax].seams || []).map(function (pl, k) {
        var d = cs[k] - sg[ax].cuts[k], o = pl.slice();
        for (var i = ax === 'x' ? 0 : 1; i < o.length; i += 2) o[i] += d;
        return o;
      });
    };
    var sx2 = seams('x', cx), sy2 = seams('y', cy), nX = sx2.length + 1, nY = sy2.length + 1;
    var span = function (pl, ax) {
      var a = Infinity, b = -Infinity;
      for (var i = ax === 'x' ? 0 : 1; i < pl.length; i += 2) { if (pl[i] < a) a = pl[i]; if (pl[i] > b) b = pl[i]; }
      return [a, b];
    };
    var ext = function (Ss, ax, k, L) { return [k ? span(Ss[k - 1], ax)[0] : 0, k < Ss.length ? span(Ss[k], ax)[1] + ov : L]; };
    for (var j = 0; j < nY; j++) {
      for (var k = 0; k < nX; k++) {
        var ex = ext(sx2, 'x', k, sg.w), ey = ext(sy2, 'y', j, sg.h), w = ex[1] - ex[0], h = ey[1] - ey[0], base = sg.list[j * nX + k] || {};
        list.push({ i: list.length, col: k, row: j, name: base.name || String(list.length + 1), x0: ex[0], x1: ex[1], y0: ey[0], y1: ey[1], w: w, h: h,
          fits: w <= sg.U + 1e-6 && h <= sg.U + 1e-6, frags: dc ? 0 : base.frags || 0 });
      }
    }
    return { cx: cx, cy: cy, sx: sx2, sy: sy2, cols: nX, rows: nY, ov: ov, U: sg.U, bed: sg.bed, list: list };
  }
  // Position d'une couture (mm) à la coordonnée u de l'autre axe (y pour une verticale, x pour une horizontale).
  function seamV(pl, ax, u) {
    var ui = ax === 'x' ? 1 : 0, vi = 1 - ui, n = pl.length;
    if (u <= pl[ui]) return pl[vi];
    for (var i = 2; i < n; i += 2) {
      if (u <= pl[i + ui]) { var t = (u - pl[i - 2 + ui]) / ((pl[i + ui] - pl[i - 2 + ui]) || 1); return pl[i - 2 + vi] + (pl[i + vi] - pl[i - 2 + vi]) * t; }
    }
    return pl[n - 2 + vi];
  }
  // Contour (mm) d'une couture prolongée de pad aux deux bouts, décalée de d : [[x, y], …]
  function seamPts(pl, ax, d, pad) {
    var R = S.res, ui = ax === 'x' ? 1 : 0, vi = 1 - ui, Lu = ax === 'x' ? R.h : R.w, o = [], i;
    var xy = function (u, v) { return ax === 'x' ? [v + d, u] : [u, v + d]; };
    o.push(xy(-pad, pl[vi]));
    for (i = 0; i < pl.length; i += 2) o.push(xy(pl[i + ui], pl[i + vi]));
    o.push(xy(Lu + pad, pl[pl.length - 2 + vi]));
    return o;
  }
  function polyPath(pts) {
    var p = new Path2D();
    pts.forEach(function (q, i) { if (i) p.lineTo(q[0], q[1]); else p.moveTo(q[0], q[1]); });
    p.closePath();
    return p;
  }
  // Bande d'une pièce dans un sens : de la couture k − 1 à la couture k (bord + débord à défaut).
  function bandPath(Ss, ax, k, pad) {
    var R = S.res, L = ax === 'x' ? R.w : R.h, Lu = ax === 'x' ? R.h : R.w;
    var edge = function (v) { return [[-pad, v], [Lu + pad, v]].map(function (q) { return ax === 'x' ? [q[1], q[0]] : q; }); };
    var a = k ? seamPts(Ss[k - 1], ax, 0, pad) : edge(-pad), b = (k < Ss.length ? seamPts(Ss[k], ax, 0, pad) : edge(L + pad)).reverse();
    return polyPath(a.concat(b));
  }
  // Libellé d'une coupe : « verticale » / « horizontale » seulement quand il y en a dans les deux sens.
  function cutName(G, ax, k) {
    return 'Coupe ' + (G.cx.length && G.cy.length ? (ax === 'x' ? 'verticale ' : 'horizontale ') : '') + (k + 1);
  }
  function renderPanel() {
    var R = S.res, has = !!(S.img && R);
    [el.b3mf, el.bsvg, el.bdxf].forEach(function (b) { b.disabled = !has || S.exporting > 0; });
    setImageUI();
    syncSizeFields();
    var warns = [];
    if (!R) {
      [el.nIsl, el.nThin, el.nHoles, el.nSeg].forEach(function (n) { setN(n, '—'); });
      el.cutsAuto.hidden = true;
      el.report.innerHTML = '<p class="muted">' + (S.img && S.ready && !cBusy ? 'Rien de détecté : ajuste le seuil.' : 'Aucune image.') + '</p>';
      el.warn.hidden = true;
      return;
    }
    var c = R.counts, parts = [];
    if (c.link) parts.push(plural(c.link, 'relié', 'reliés'));
    if (c.drop) parts.push(plural(c.drop, 'supprimé', 'supprimés'));
    if (c.apart) parts.push(c.apart + ' à part');
    setN(el.nIsl, c.islands ? parts.join(' · ') : 'Aucun', c.islands ? 'note' : 'ok');
    var fix = segVal('sil-thin') === 'fix', fill = segVal('sil-holes') === 'fill';
    setN(el.nThin, c.thin ? plural(c.thin, fix ? 'zone épaissie' : 'zone', fix ? 'zones épaissies' : 'zones') : 'Aucun', c.thin ? (fix ? 'note' : 'warn') : 'ok');
    setN(el.nHoles, c.holes ? plural(c.holes, fill ? 'bouché' : 'trou', fill ? 'bouchés' : 'trous') : 'Aucun', c.holes ? (fill ? 'note' : 'warn') : 'ok');
    var G = segView(), bad = G.list.filter(function (s) { return !s.fits; }), n = G.list.length;
    var grid = G.cols > 1 && G.rows > 1 ? G.cols + ' × ' + G.rows : String(n);
    setN(el.nSeg, R.seg.impossible ? 'Hors plateau' : grid + ' · plateau ' + G.bed, R.seg.impossible || bad.length ? 'warn' : '');
    el.cutsAuto.hidden = R.seg.auto;
    if (R.seg.impossible) warns.push('Découpe impossible avec ce tenon.');
    bad.forEach(function (s) { warns.push('Pièce ' + s.name + ' trop grande : ' + fmt(s.w) + ' × ' + fmt(s.h) + ' mm (max ' + G.U + ' mm).'); });
    G.list.forEach(function (s) { if (s.frags > 1) warns.push('Pièce ' + s.name + ' : ' + s.frags + ' morceaux séparés, déplace une coupe.'); });
    if (!S.dragCuts) ['x', 'y'].forEach(function (ax) {
      (R.seg[ax].joints || []).forEach(function (j, k) {
        var miss = j.strokes - j.tenons;
        if (miss > 0) warns.push(cutName(G, ax, k) + ' : ' + plural(miss, 'trait trop mince', 'traits trop minces') + ' pour un tenon, collage bout à bout.');
      });
    });
    if (R.back && !S.dragCuts) {
      var bx = R.back.box;
      G.list.forEach(function (s) {
        var bw = s.w + (s.col === 0 ? -bx[0] : 0) + (s.col === G.cols - 1 ? bx[2] - R.w : 0), bh = s.h + (s.row === 0 ? -bx[1] : 0) + (s.row === G.rows - 1 ? bx[3] - R.h : 0);
        if (s.frags !== 0 && Math.max(bw, bh) > G.U) warns.push('Fond' + (n > 1 ? ' ' + s.name : '') + ' trop grand : ' + fmt(bw) + ' × ' + fmt(bh) + ' mm (max ' + G.U + ' mm).');
      });
    }
    (R.edits || []).forEach(function (e) { if (!e.ok && ED_WHY[e.why]) warns.push(ED_WHY[e.why]); });
    el.warn.innerHTML = warns.map(function (t) { return '<p>' + t + '</p>'; }).join('');
    el.warn.hidden = !warns.length;
    // rapport : lignes libellé -> valeur
    function row(r) { return '<div class="al-srow"><span>' + r[0] + '</span><span' + (r[2] ? ' class="is-bad"' : '') + '>' + r[1] + '</span></div>'; }
    var html = row(['Dimensions', fmt(R.w) + ' × ' + fmt(R.h) + ' mm']);
    if (n > 1) {
      // case de la grille sans matière : rien à imprimer (absente du 3MF)
      var empty = function (s) { return !S.dragCuts && s.frags === 0; };
      var nBad = G.list.filter(function (s) { return s.frags !== 0 && !s.fits; }).length;
      var nPrint = G.list.filter(function (s) { return !empty(s); }).length;
      html += '<details class="sil-pieces"' + (piecesOpen ? ' open' : '') + '><summary class="al-srow"><span>Pièces</span><span' + (nBad ? ' class="is-bad"' : '') + '>'
        + (nBad ? plural(nBad, 'trop grande', 'trop grandes') + ' · ' : '') + plural(nPrint, 'à imprimer', 'à imprimer') + '</span></summary>'
        + G.list.map(function (s) { return row(['Pièce ' + s.name, empty(s) ? 'vide' : fmt(s.w) + ' × ' + fmt(s.h) + ' mm', s.frags !== 0 && !s.fits]); }).join('')
        + '</details>';
      html += row(['Impression', R.back ? 'fond au plateau · pièces collées dessus' : 'dos au plateau · tenons cachés']);
    } else html += row(['Impression', bad.length ? 'hors plateau' : '1 pièce · face au plateau', bad.length]);
    if (R.back) html += row(['Fond', fmt(R.back.box[2] - R.back.box[0]) + ' × ' + fmt(R.back.box[3] - R.back.box[1]) + ' × ' + fmt(R.back.T, 1) + ' mm']);
    html += row(['Volume', fmt((R.volume + (R.back ? R.back.volume : 0)) / 1000) + ' cm³']);
    el.report.innerHTML = html;
  }
  // liste des pièces repliée par défaut ; l'état survit aux re-rendus du rapport
  var piecesOpen = false;
  el.report.addEventListener('toggle', function (e) { if (e.target.classList.contains('sil-pieces')) piecesOpen = e.target.open; }, true);

  /* ------------------------------------------------------------------ */
  /*  Aperçu 2D (plan, mur, recadrage)                                    */
  /* ------------------------------------------------------------------ */
  var g = el.cv.getContext('2d'), dpr = 1, vw = 0, vh = 0, cam = { s: 1, tx: 0, ty: 0 };
  function sizeCanvas() {
    var r = el.stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5); vw = r.width; vh = r.height;
    [el.cv, el.gl].forEach(function (c) {
      var W = Math.max(1, Math.round(vw * dpr)), H = Math.max(1, Math.round(vh * dpr));
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
    });
  }
  // Les deux colonnes tiennent dans la fenêtre (le panneau défile seul).
  function fitHeight() {
    if (!app.offsetParent) return;
    if (window.matchMedia('(max-width:900px)').matches) { app.style.removeProperty('--sil-h'); return; }
    var top = app.getBoundingClientRect().top + window.scrollY, h = Math.max(480, Math.round(window.innerHeight - top - 16)) + 'px';
    if (app.style.getPropertyValue('--sil-h') !== h) app.style.setProperty('--sil-h', h);
  }
  var MARG = { l: 72, r: 70, t: 70, b: 86 };   // place des barres d'outils et des cotes
  // Cadrage automatique tant que Théo n'a ni zoomé ni déplacé la vue (S.userView).
  function fit() {
    var R = S.res;
    S.userView = false;
    if (!R || !vw) return;
    var X = extent(R), W = X[2] - X[0], H = X[3] - X[1];
    var s = Math.min((vw - MARG.l - MARG.r) / W, (vh - MARG.t - MARG.b) / H);
    cam.s = Math.max(0.01, s);
    cam.tx = MARG.l + (vw - MARG.l - MARG.r - W * cam.s) / 2 - X[0] * cam.s;
    cam.ty = MARG.t + (vh - MARG.t - MARG.b - H * cam.s) / 2 - X[1] * cam.s;
  }
  function zoomAt(f, px, py) {
    S.userView = true;
    var s = Math.min(400, Math.max(0.01, cam.s * f));
    f = s / cam.s;
    cam.tx = px - (px - cam.tx) * f; cam.ty = py - (py - cam.ty) * f; cam.s = s;
  }
  function toMm() { g.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.tx, dpr * cam.ty); }
  function toScreen() { g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function sx(x) { return cam.tx + x * cam.s; }
  function sy(y) { return cam.ty + y * cam.s; }

  var rafId = 0;
  function draw() { if (!rafId) rafId = requestAnimationFrame(function () { rafId = 0; paint(); }); }
  function paint() {
    if (!vw || !vh || el.cv.hidden) return;
    var col = colors();
    toScreen();
    g.clearRect(0, 0, vw, vh);
    if (S.cropping) { paintCrop(col); return; }
    if (S.view === 'mur') { paintWall(); return; }
    g.fillStyle = col.wash; g.fillRect(0, 0, vw, vh);
    if (!S.res || !S.paths) return;
    paintGrid(col);
    if (S.layers.segments) paintSegBack(col);
    if (S.layers.image && S.img) {
      var I = S.res.image;
      toMm(); g.globalAlpha = 0.35; g.imageSmoothingQuality = 'high';
      g.drawImage(S.img.cv, I.x, I.y, I.w, I.h);
      g.globalAlpha = 1;
    }
    if (S.paths.back) {
      toMm(); g.globalAlpha = 0.16; g.fillStyle = col.ink; g.fill(S.paths.back, 'evenodd'); g.globalAlpha = 1;
      g.strokeStyle = col.muted; g.lineWidth = 1 / cam.s; g.setLineDash([4 / cam.s, 3 / cam.s]); g.stroke(S.paths.back); g.setLineDash([]);
    }
    toMm(); g.fillStyle = col.ink; g.fill(S.paths.piece, 'evenodd');
    if (S.layers.checks) paintChecks(col);
    toScreen();
    if (S.layers.segments) paintCuts(col);
    if (ED.on) paintEdits(col);
    paintDims(col);
  }
  function paintGrid(col) {
    var s = cam.s, steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000], minor = 5000, major = 5000, i;
    for (i = 0; i < steps.length; i++) if (steps[i] * s >= 10) { minor = steps[i]; break; }
    for (i = 0; i < steps.length; i++) if (steps[i] >= minor * 5) { major = steps[i]; break; }
    var x0 = Math.floor(-cam.tx / s / minor) * minor, x1 = (vw - cam.tx) / s, y0 = Math.floor(-cam.ty / s / minor) * minor, y1 = (vh - cam.ty) / s;
    g.lineWidth = 1;
    [false, true].forEach(function (maj) {
      g.beginPath();
      var n, v, P;
      for (n = 0, v = x0; v <= x1 && n < 2000; n++, v = x0 + n * minor) {
        if ((Math.abs(v / major - Math.round(v / major)) < 1e-6) !== maj) continue;
        P = Math.round(sx(v)) + 0.5; g.moveTo(P, 0); g.lineTo(P, vh);
      }
      for (n = 0, v = y0; v <= y1 && n < 2000; n++, v = y0 + n * minor) {
        if ((Math.abs(v / major - Math.round(v / major)) < 1e-6) !== maj) continue;
        P = Math.round(sy(v)) + 0.5; g.moveTo(0, P); g.lineTo(vw, P);
      }
      g.strokeStyle = maj ? col.line2 : col.line;
      g.globalAlpha = maj ? 0.95 : 0.6;
      g.stroke();
    });
    g.globalAlpha = 1;
  }
  function paintSegBack(col) {
    var G = segView(), pad = 10 / cam.s;
    toMm();
    if (G.list.length > 1) {
      // damier : une pièce sur deux teintée, celles qui débordent du plateau en rouge
      G.list.forEach(function (s) {
        var a = !s.fits ? 0.12 : (s.col + s.row) % 2 ? 0.07 : 0;
        if (!a) return;
        g.save(); g.clip(bandPath(G.sx, 'x', s.col, pad));
        g.globalAlpha = a; g.fillStyle = !s.fits ? col.bad : col.ink; g.fill(bandPath(G.sy, 'y', s.row, pad));
        g.restore();
      });
      g.globalAlpha = 1;
    }
    // plateau : celui de la pièce survolée (ou de la pièce entière s'il n'y en a qu'une)
    var k = G.list.length === 1 ? 0 : S.hoverSeg;
    if (k >= 0 && G.list[k]) {
      var s = G.list[k], U = G.U, x = (s.x0 + s.x1) / 2 - U / 2, y = (s.y0 + s.y1) / 2 - U / 2;
      g.setLineDash([6 / cam.s, 5 / cam.s]); g.lineWidth = 1.5 / cam.s;
      g.strokeStyle = s.fits ? col.muted : col.bad; g.strokeRect(x, y, U, U);
      g.setLineDash([]);
      toScreen();
      g.font = '600 11px ' + col.display; g.fillStyle = s.fits ? col.muted : col.bad; g.textBaseline = 'top';
      g.fillText((G.list.length > 1 ? 'Pièce ' + s.name + ' · ' : '') + 'Plateau ' + G.bed + ' mm', sx(x) + 6, sy(y) + 5);
      g.textBaseline = 'alphabetic';
    }
    toScreen();
  }
  function paintChecks(col) {
    var P = S.paths, lw = 1 / cam.s;
    toMm();
    if (P.added) { g.fillStyle = col.ember; g.globalAlpha = 0.9; g.fill(P.added, 'evenodd'); }
    if (P.thin) { g.fillStyle = col.bad; g.globalAlpha = 0.9; g.fill(P.thin, 'evenodd'); }
    g.globalAlpha = 1;
    if (P.holes) { g.lineWidth = 2 * lw; g.strokeStyle = col.bad; g.stroke(P.holes); }
    if (P.drop) {
      g.fillStyle = col.bad; g.globalAlpha = 0.12; g.fill(P.drop, 'evenodd'); g.globalAlpha = 1;
      g.setLineDash([5 * lw, 4 * lw]); g.lineWidth = 1.5 * lw; g.strokeStyle = col.bad; g.stroke(P.drop); g.setLineDash([]);
    }
    if (P.apart) { g.setLineDash([5 * lw, 4 * lw]); g.lineWidth = 2 * lw; g.strokeStyle = col.good; g.stroke(P.apart); g.setLineDash([]); }
    var h = S.hoverIsl;
    if (h) {
      var m = 3 * lw;
      g.lineWidth = 2 * lw; g.strokeStyle = col.ember;
      g.strokeRect(h.x - m, h.y - m, h.w + 2 * m, h.h + 2 * m);
    }
    toScreen();
  }
  // Coutures : zone du tenon (elle suit le chemin), pointillé le long du chemin et poignée à glisser au bout
  // (verticales en haut, horizontales à gauche).
  function cutHandle(ax, pl) {
    return ax === 'x' ? { x: sx(pl[0]), y: sy(0) - 26 } : { x: sx(0) - 26, y: sy(pl[1]) };
  }
  function paintCuts(col) {
    var G = segView(), R = S.res, axes = [['x', G.sx], ['y', G.sy]], pad = 6 / cam.s;
    toMm();
    axes.forEach(function (a) {
      a[1].forEach(function (pl) {
        var A = seamPts(pl, a[0], 0, pad), B = seamPts(pl, a[0], G.ov, pad).reverse();   // zone du tenon (rainure dans la pièce suivante)
        g.fillStyle = col.ember; g.globalAlpha = 0.2; g.fill(polyPath(A.concat(B)));
      });
    });
    g.globalAlpha = 1;
    toScreen();
    axes.forEach(function (a) {
      var ax = a[0];
      a[1].forEach(function (pl, k) {
        var h = cutHandle(ax, pl), pts = seamPts(pl, ax, 0, 8 / cam.s);
        g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeStyle = col.ember;
        g.beginPath(); g.moveTo(h.x, h.y);
        pts.forEach(function (q) { g.lineTo(sx(q[0]), sy(q[1])); });
        g.stroke(); g.setLineDash([]);
        g.beginPath(); g.arc(h.x, h.y, 8, 0, Math.PI * 2);
        g.fillStyle = col.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = col.ember; g.stroke();
        g.fillStyle = col.ember; g.font = '700 10px ' + col.display; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(k + 1), h.x, h.y + 0.5);
      });
    });
    // étiquettes : colonnes sous la pièce, rangées à gauche (lettre en grille, numéro sinon)
    g.font = '600 11px ' + col.display; g.textBaseline = 'middle'; g.textAlign = 'center';
    var label = function (ax, k, a, b) {
      var t = (ax === 'y' && G.cols > 1 ? String.fromCharCode(65 + k) : String(k + 1)) + ' · ' + fmt(b - a) + ' mm';
      var ok = b - a <= G.U + 1e-6, c = (a + b) / 2;
      g.fillStyle = ok ? col.muted : col.bad;
      if (ax === 'x') g.fillText(t, sx(c), sy(R.h) + 48);
      else { g.save(); g.translate(sx(0) - 50, sy(c)); g.rotate(-Math.PI / 2); g.fillText(t, 0, 0); g.restore(); }
    };
    if (G.cols > 1) for (var i = 0; i < G.cols; i++) label('x', i, G.list[i].x0, G.list[i].x1);
    if (G.rows > 1) for (var j = 0; j < G.rows; j++) label('y', j, G.list[j * G.cols].y0, G.list[j * G.cols].y1);
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
  }
  function paintDims(col) {
    var R = S.res, x0 = sx(0), x1 = sx(R.w), y0 = sy(0), y1 = sy(R.h);
    g.strokeStyle = col.muted; g.fillStyle = col.ink2; g.lineWidth = 1; g.font = '600 12px ' + col.display;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var yy = Math.round(y1 + 24) + 0.5, xx = Math.round(x1 + 24) + 0.5;
    g.beginPath();
    g.moveTo(x0, yy); g.lineTo(x1, yy); g.moveTo(x0, yy - 5); g.lineTo(x0, yy + 5); g.moveTo(x1, yy - 5); g.lineTo(x1, yy + 5);
    g.moveTo(xx, y0); g.lineTo(xx, y1); g.moveTo(xx - 5, y0); g.lineTo(xx + 5, y0); g.moveTo(xx - 5, y1); g.lineTo(xx + 5, y1);
    g.stroke();
    var tw = fmt(R.w) + ' mm', th = fmt(R.h) + ' mm', mw = g.measureText(tw).width + 12, mh = g.measureText(th).width + 12;
    g.fillStyle = col.wash; g.fillRect((x0 + x1) / 2 - mw / 2, yy - 9, mw, 18);
    g.fillStyle = col.ink2; g.fillText(tw, (x0 + x1) / 2, yy);
    g.save(); g.translate(xx, (y0 + y1) / 2); g.rotate(-Math.PI / 2);
    g.fillStyle = col.wash; g.fillRect(-mh / 2, -9, mh, 18);
    g.fillStyle = col.ink2; g.fillText(th, 0, 0);
    g.restore();
    g.textAlign = 'start'; g.textBaseline = 'alphabetic';
  }
  // Mur : rendu « photo » aux couleurs des filaments choisis, ombre portée (entretoises), fond de mur clair.
  function paintWall() {
    var grd = g.createLinearGradient(0, 0, 0, vh);
    grd.addColorStop(0, '#efeee9'); grd.addColorStop(1, '#dcd9d2');
    g.fillStyle = grd; g.fillRect(0, 0, vw, vh);
    if (!S.res || !S.paths) return;
    toMm();
    g.save();
    g.shadowColor = 'rgba(0,0,0,.34)'; g.shadowBlur = 12 * dpr; g.shadowOffsetX = 4 * dpr; g.shadowOffsetY = 8 * dpr;
    g.fillStyle = S.paths.back ? colHex(el.colBack) : colHex(el.colPiece); g.fill(S.paths.back || S.paths.piece, 'evenodd');
    g.restore();
    if (S.paths.back) {
      g.save();
      g.shadowColor = 'rgba(0,0,0,.22)'; g.shadowBlur = 3 * dpr; g.shadowOffsetX = 1 * dpr; g.shadowOffsetY = 2 * dpr;
      g.fillStyle = colHex(el.colPiece); g.fill(S.paths.piece, 'evenodd');
      g.restore();
    }
    toScreen();
  }

  /* --- Recadrage --------------------------------------------------- */
  var CR = null;     // { r: [x0, y0, x1, y1] px image, f: { s, tx, ty } }
  function cropFit() {
    var I = S.img, s = Math.min((vw - 80) / I.w, (vh - 150) / I.h);
    return { s: s, tx: (vw - I.w * s) / 2, ty: (vh - I.h * s) / 2 };
  }
  function startCrop() {
    if (!S.img) return;
    if (S.view === '3d') { setSeg('sil-view', 'plan'); setView('plan'); }
    setEdit(false);
    S.cropping = true;
    CR = { r: S.crop ? S.crop.slice() : [0, 0, S.img.w, S.img.h], f: cropFit() };
    el.cropbar.hidden = false; el.layers.hidden = true; el.zoom.hidden = true; el.view.hidden = true;
    el.cv.classList.add('is-crop');
    draw();
  }
  function endCrop(apply) {
    if (!S.cropping) return;
    if (apply) {
      var r = CR.r.map(Math.round), full = r[0] <= 0 && r[1] <= 0 && r[2] >= S.img.w && r[3] >= S.img.h;
      S.crop = full ? null : r; S.cuts = null; S.islands = []; S.fitPending = true;
      schedule(false);
    }
    S.cropping = false; CR = null;
    el.cropbar.hidden = true; el.layers.hidden = S.view !== 'plan'; el.zoom.hidden = false; el.view.hidden = false;
    el.cv.classList.remove('is-crop');
    setImageUI(); draw();
  }
  function paintCrop(col) {
    var I = S.img, f = CR.f, r = CR.r;
    g.fillStyle = col.wash; g.fillRect(0, 0, vw, vh);
    g.imageSmoothingQuality = 'high';
    g.drawImage(I.cv, f.tx, f.ty, I.w * f.s, I.h * f.s);
    var X0 = f.tx + r[0] * f.s, Y0 = f.ty + r[1] * f.s, X1 = f.tx + r[2] * f.s, Y1 = f.ty + r[3] * f.s;
    g.fillStyle = 'rgba(15,17,20,.55)';
    g.beginPath(); g.rect(f.tx, f.ty, I.w * f.s, I.h * f.s); g.rect(X0, Y0, X1 - X0, Y1 - Y0); g.fill('evenodd');
    g.lineWidth = 2; g.strokeStyle = col.ember; g.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    cropHandles(X0, Y0, X1, Y1).forEach(function (h) {
      g.fillStyle = col.paper; g.fillRect(h.x - 5, h.y - 5, 10, 10);
      g.strokeStyle = col.ember; g.lineWidth = 2; g.strokeRect(h.x - 5, h.y - 5, 10, 10);
    });
  }
  function cropHandles(X0, Y0, X1, Y1) {
    var mx = (X0 + X1) / 2, my = (Y0 + Y1) / 2;
    return [{ k: 'nw', x: X0, y: Y0 }, { k: 'n', x: mx, y: Y0 }, { k: 'ne', x: X1, y: Y0 }, { k: 'e', x: X1, y: my },
      { k: 'se', x: X1, y: Y1 }, { k: 's', x: mx, y: Y1 }, { k: 'sw', x: X0, y: Y1 }, { k: 'w', x: X0, y: my }];
  }
  function cropHit(p) {
    var f = CR.f, r = CR.r, X0 = f.tx + r[0] * f.s, Y0 = f.ty + r[1] * f.s, X1 = f.tx + r[2] * f.s, Y1 = f.ty + r[3] * f.s;
    var hs = cropHandles(X0, Y0, X1, Y1);
    for (var i = 0; i < hs.length; i++) if (Math.abs(p.x - hs[i].x) <= 9 && Math.abs(p.y - hs[i].y) <= 9) return hs[i].k;
    if (p.x > X0 && p.x < X1 && p.y > Y0 && p.y < Y1) return 'move';
    return 'new';
  }
  function cropDrag(d, p) {
    var f = CR.f, I = S.img, ix = (p.x - f.tx) / f.s, iy = (p.y - f.ty) / f.s, r = d.r0.slice(), MIN = 8;
    var cx = function (v) { return Math.max(0, Math.min(I.w, v)); }, cy = function (v) { return Math.max(0, Math.min(I.h, v)); };
    if (d.mode === 'move') {
      var dx = ix - d.ix, dy = iy - d.iy, w = r[2] - r[0], h = r[3] - r[1];
      r[0] = Math.max(0, Math.min(I.w - w, r[0] + dx)); r[1] = Math.max(0, Math.min(I.h - h, r[1] + dy));
      r[2] = r[0] + w; r[3] = r[1] + h;
    } else if (d.mode === 'new') {
      r = [cx(Math.min(d.ix, ix)), cy(Math.min(d.iy, iy)), cx(Math.max(d.ix, ix)), cy(Math.max(d.iy, iy))];
    } else {
      if (d.mode.indexOf('w') !== -1) r[0] = Math.min(cx(ix), r[2] - MIN);
      if (d.mode.indexOf('e') !== -1) r[2] = Math.max(cx(ix), r[0] + MIN);
      if (d.mode.indexOf('n') !== -1) r[1] = Math.min(cy(iy), r[3] - MIN);
      if (d.mode.indexOf('s') !== -1) r[3] = Math.max(cy(iy), r[1] + MIN);
    }
    if (r[2] - r[0] >= MIN && r[3] - r[1] >= MIN) CR.r = r;
    draw();
  }
  el.crop.addEventListener('click', startCrop);
  $('#sil-crop-ok').addEventListener('click', function () { endCrop(true); });
  $('#sil-crop-cancel').addEventListener('click', function () { endCrop(false); });
  $('#sil-crop-all').addEventListener('click', function () { if (CR) { CR.r = [0, 0, S.img.w, S.img.h]; draw(); } });

  /* --- Souris / doigt sur l'aperçu 2D ------------------------------- */
  function local(e) { var r = el.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function cutAt(p) {
    if (!S.res || S.view !== 'plan' || !S.layers.segments) return null;
    var G = segView(), R = S.res, axes = [['x', G.sx], ['y', G.sy]], xm = (p.x - cam.tx) / cam.s, ym = (p.y - cam.ty) / cam.s;
    for (var a = 0; a < 2; a++) {
      var ax = axes[a][0], ss = axes[a][1];
      for (var k = 0; k < ss.length; k++) {
        var h = cutHandle(ax, ss[k]);
        if (Math.hypot(p.x - h.x, p.y - h.y) <= 12) return { ax: ax, k: k };
        if (ax === 'x' && Math.abs(p.x - sx(seamV(ss[k], 'x', ym))) <= 6 && p.y >= sy(0) - 8 && p.y <= sy(R.h) + 8) return { ax: ax, k: k };
        if (ax === 'y' && Math.abs(p.y - sy(seamV(ss[k], 'y', xm))) <= 6 && p.x >= sx(0) - 8 && p.x <= sx(R.w) + 8) return { ax: ax, k: k };
      }
    }
    return null;
  }
  function islandAt(p) {
    if (!S.res || S.view !== 'plan' || !S.layers.checks) return null;
    var x = (p.x - cam.tx) / cam.s, y = (p.y - cam.ty) / cam.s, tol = 2 + 4 / cam.s, best = null;
    S.res.islands.forEach(function (o) {
      if (x < o.x - tol || x > o.x + o.w + tol || y < o.y - tol || y > o.y + o.h + tol) return;
      if (!best || o.w * o.h < best.w * best.h) best = o;
    });
    return best;
  }
  function segAt(p) {
    if (!S.res) return -1;
    var G = segView(), x = (p.x - cam.tx) / cam.s, y = (p.y - cam.ty) / cam.s;
    if (x < 0 || y < 0 || x > S.res.w || y > S.res.h) return -1;
    var i = 0, j = 0;
    while (i < G.sx.length && x > seamV(G.sx[i], 'x', y)) i++;
    while (j < G.sy.length && y > seamV(G.sy[j], 'y', x)) j++;
    return j * G.cols + i;
  }
  var drag = null;
  el.cv.addEventListener('pointerdown', function (e) {
    var mid = e.button === 1 && !!S.res && !S.cropping;
    if (e.button !== 0 && !mid) return;
    if (mid) e.preventDefault();
    var p = local(e);
    if (S.cropping) {
      var mode = cropHit(p), f = CR.f;
      drag = { kind: 'crop', mode: mode, r0: CR.r.slice(), ix: (p.x - f.tx) / f.s, iy: (p.y - f.ty) / f.s };
    } else if (!S.res) return;
    else {
      var ct = ED.on || mid ? null : cutAt(p);
      if (!mid && ED.on && BRUSH[ED.tool]) {
        var q0 = edPoint(p);
        drag = { kind: 'brush', pts: [mmToImg(q0.mm[0], q0.mm[1])], last: p };
        ED.cur = p; draw();
      } else if (ct) {
        var c0 = S.res.seg[ct.ax].cuts[ct.k];
        drag = { kind: 'cut', ax: ct.ax, k: ct.k, c0: c0, v0: ct.ax === 'x' ? (p.x - cam.tx) / cam.s : (p.y - cam.ty) / cam.s, cuts: { x: S.res.seg.x.cuts.slice(), y: S.res.seg.y.cuts.slice() } };
      }
      else { drag = { kind: 'pan', p0: p, tx: cam.tx, ty: cam.ty, moved: mid }; el.cv.classList.add('is-pan'); }
    }
    try { el.cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  el.cv.addEventListener('pointermove', function (e) {
    var p = local(e);
    if (drag) {
      if (drag.kind === 'crop') { cropDrag(drag, p); return; }
      if (drag.kind === 'brush') {
        ED.cur = p;
        if (Math.hypot(p.x - drag.last.x, p.y - drag.last.y) >= 3) {
          var qb = edPoint(p);
          drag.pts.push(mmToImg(qb.mm[0], qb.mm[1])); drag.last = p;
        }
        draw();
        return;
      }
      if (drag.kind === 'pan') {
        var dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; S.userView = true; }
        cam.tx = drag.tx + dx; cam.ty = drag.ty + dy; draw();
        return;
      }
      if (drag.kind === 'cut') {
        var ax = drag.ax, v = drag.c0 + (ax === 'x' ? (p.x - cam.tx) / cam.s : (p.y - cam.ty) / cam.s) - drag.v0, cuts = drag.cuts[ax], k = drag.k;
        var L = ax === 'x' ? S.res.w : S.res.h, gap = S.res.seg.ov + 10;
        var lo = k ? cuts[k - 1] + gap : 15, hi = k < cuts.length - 1 ? cuts[k + 1] - gap : L - S.res.seg.ov - 15;
        cuts[k] = Math.max(lo, Math.min(hi, v));
        S.dragCuts = drag.cuts; renderPanel(); draw();
        return;
      }
    }
    if (S.cropping || !S.res) return;
    if (ED.on) { edHover(p); return; }
    // survol : poignée de coupe, morceau, segment
    var cut = cutAt(p), isl = !cut ? islandAt(p) : null, sg = S.layers.segments && S.view === 'plan' ? segAt(p) : -1;
    el.cv.classList.toggle('is-cut', !!cut && cut.ax === 'x');
    el.cv.classList.toggle('is-cut-y', !!cut && cut.ax === 'y');
    el.cv.classList.toggle('is-pick', !!isl);
    if (isl !== S.hoverIsl || sg !== S.hoverSeg) { S.hoverIsl = isl; S.hoverSeg = sg; draw(); }
  });
  function endDrag(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    el.cv.classList.remove('is-pan');
    if (d.kind === 'cut' && S.dragCuts) {
      // seule la coupe glissée devient manuelle dans son sens ; l'autre sens garde son réglage
      var L = d.ax === 'x' ? S.res.w : S.res.h, nc = { x: S.cuts && S.cuts.x || null, y: S.cuts && S.cuts.y || null };
      nc[d.ax] = S.dragCuts[d.ax].map(function (c) { return c / L; });
      S.cuts = nc;
      schedule(false);
    } else if (d.kind === 'brush') {
      if (e && e.type === 'pointerup') addEdit({ t: ED.tool, pts: d.pts, s: ED.size });
      else draw();
    } else if (d.kind === 'pan' && !d.moved && e && e.type === 'pointerup' && ED.on) {
      editClick(local(e));
    } else if (d.kind === 'pan' && !d.moved && e && e.type === 'pointerup') {
      var isl = islandAt(local(e));
      if (isl) cycleIsland(isl);
    }
  }
  el.cv.addEventListener('pointerup', endDrag);
  el.cv.addEventListener('pointercancel', endDrag);
  el.cv.addEventListener('pointerleave', function () {
    if (ED.hover || ED.cur) { ED.hover = null; ED.snap = null; ED.cur = null; draw(); }
    if (!drag && (S.hoverIsl || S.hoverSeg >= 0)) { S.hoverIsl = null; S.hoverSeg = -1; draw(); }
  });
  el.cv.addEventListener('wheel', function (e) {
    if (!S.res || S.cropping) return;
    e.preventDefault();
    var p = local(e);
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), p.x, p.y);
    draw();
  }, { passive: false });
  el.cv.addEventListener('dblclick', function () {
    if (ED.on) { if (ED.draft) finishDraft(); return; }
    if (!S.cropping) { fit(); draw(); }
  });
  // Clic sur un morceau détaché : relier -> supprimer -> à part -> relier.
  function cycleIsland(o) {
    var order = ['link', 'drop', 'apart'], next = order[(order.indexOf(o.act) + 1) % 3], found = false;
    S.islands = S.islands.map(function (x) {
      var dx = x.fx - o.fx, dy = x.fy - o.fy;
      if (dx * dx + dy * dy <= 0.012 * 0.012) { found = true; return { fx: o.fx, fy: o.fy, act: next }; }
      return x;
    });
    if (!found) S.islands.push({ fx: o.fx, fy: o.fy, act: next });
    schedule(false);
  }
  el.zoom.addEventListener('click', function (e) {
    var b = e.target.closest('[data-zoom]');
    if (!b) return;
    var z = b.getAttribute('data-zoom');
    if (S.view === '3d') { if (GL) { GL.dist *= z === 'in' ? 0.8 : z === 'out' ? 1.25 : 1; if (z === 'fit') fit3d(); render3d(); } return; }
    if (z === 'fit') fit(); else zoomAt(z === 'in' ? 1.25 : 0.8, vw / 2, vh / 2);
    draw();
  });
  el.layers.addEventListener('change', function (e) {
    var k = e.target.getAttribute('data-layer');
    if (k) { S.layers[k] = e.target.checked; draw(); }
  });

  /* ------------------------------------------------------------------ */
  /*  Mode Édition : Sélection, Remplir, Vider, Ligne, Gomme               */
  /* ------------------------------------------------------------------ */
  // Retouches en px de l'image de travail (stables au recadrage et à la taille), appliquées par le moteur au
  // tracé avant les contrôles. Ligne : points cliqués, double-clic (ou Entrée) pour finir ; elle s'accroche aux
  // bouts de traits (res.tips), le moteur en fait une arête et remplit le côté qu'elle ferme. Pinceau et Gomme :
  // ronds, à main levée, taille réglable (curseur ou [ ]).
  var ED = { on: false, tool: 'select', draft: null, sel: -1, hover: null, snap: null, cur: null, size: 6 };
  var BRUSH = { paint: 1, erase: 1 };   // outils à main levée (rond de diamètre ED.size mm)
  try { var sz0 = +localStorage.getItem('sil-brush'); if (sz0 >= 1 && sz0 <= 40) ED.size = sz0; } catch (err) {}
  var SNAP = 14;    // rayon de l'aimant (px écran)
  var ED_WHY = {
    ouvert: 'Remplir : zone ouverte, ferme-la d\'abord avec une ligne.',
    plein: 'Remplir : clique dans un vide.',
    vide: 'Vider : clique dans une zone pleine.',
    mince: 'Vider : zone trop mince.',
    ferme: 'Ligne : elle ne ferme aucune zone.'
  };
  function mmToImg(x, y) { var I = S.res.image; return [(x - I.x) / I.w * S.img.w, (y - I.y) / I.h * S.img.h]; }
  function imgToMm(q) { var I = S.res.image; return [I.x + q[0] / S.img.w * I.w, I.y + q[1] / S.img.h * I.h]; }
  function snapAt(p) {
    var T = S.res && S.res.tips, best = null, bd = SNAP * SNAP;
    if (!T) return null;
    for (var k = 0; k < T.length; k += 2) {
      var dx = sx(T[k]) - p.x, dy = sy(T[k + 1]) - p.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = [T[k], T[k + 1]]; }
    }
    return best;
  }
  // point visé (mm), accroché à un bout de trait pour la Ligne
  function edPoint(p) {
    var sn = ED.tool === 'line' ? snapAt(p) : null;
    return { mm: sn || [(p.x - cam.tx) / cam.s, (p.y - cam.ty) / cam.s], snap: !!sn };
  }
  function setEdit(on) {
    on = !!on && !!S.res;
    if (!on && !ED.on) return;
    ED.on = on; ED.draft = null; ED.sel = -1; ED.hover = null; ED.snap = null; ED.cur = null;
    el.editbar.hidden = !on;
    placeEditbar();
    el.edit.setAttribute('aria-pressed', on ? 'true' : 'false');
    toolCursor();
    edStatus(); draw();
  }
  function toolCursor() {
    el.cv.classList.toggle('is-draw', ED.on && ED.tool !== 'select' && !BRUSH[ED.tool]);
    el.cv.classList.toggle('is-brush', ED.on && !!BRUSH[ED.tool]);
  }
  function setSize(v) {
    ED.size = Math.max(1, Math.min(40, Math.round(v * 2) / 2));
    el.edRange.value = ED.size;
    el.edSz.textContent = String(ED.size).replace('.', ',') + ' mm';
    try { localStorage.setItem('sil-brush', ED.size); } catch (err) {}
    draw();
  }
  // sous la barre du haut, qui passe sur deux lignes dans un aperçu étroit
  function placeEditbar() {
    if (el.editbar.hidden) return;
    var st = el.stage.getBoundingClientRect(), tb = $('.sil-bar-top', el.stage).getBoundingClientRect();
    el.editbar.style.top = Math.round(tb.bottom - st.top) + 'px';
  }
  function setTool(t) {
    if (ED.draft && ED.draft.length >= 2) finishDraft();
    ED.tool = t; ED.draft = null; ED.sel = -1;
    $$('.sil-ed', el.edTools).forEach(function (b) { b.setAttribute('aria-checked', b.getAttribute('data-tool') === t ? 'true' : 'false'); });
    el.edSize.hidden = !BRUSH[t];
    toolCursor();
    edStatus(); draw();
  }
  function edStatus() {
    var t = '';
    if (ED.draft) t = ED.draft.length < 2 ? 'Clique le point suivant' : 'Double-clic pour finir';
    else if (ED.tool === 'select' && ED.sel >= 0) t = 'Suppr pour retirer';
    el.edSt.textContent = t; el.edSt.hidden = !t;
    el.edUndo.disabled = !ED.draft && !S.edits.length;
    el.edClear.disabled = !S.edits.length;
  }
  function addEdit(e) { S.edits.push(e); ED.sel = -1; edStatus(); schedule(false); }
  function finishDraft() {
    var d = ED.draft;
    ED.draft = null;
    if (d && d.length >= 2) addEdit({ t: ED.tool, pts: d });
    else { edStatus(); draw(); }
  }
  function edUndo() {
    if (ED.draft) { ED.draft.pop(); if (!ED.draft.length) ED.draft = null; edStatus(); draw(); return; }
    if (!S.edits.length) return;
    S.edits.pop(); ED.sel = -1; edStatus(); schedule(false);
  }
  function edRemoveSel() {
    if (ED.sel < 0 || ED.sel >= S.edits.length) return;
    S.edits.splice(ED.sel, 1); ED.sel = -1; edStatus(); schedule(false);
  }
  // tracé affiché d'une retouche (mm) : celui du moteur s'il est à jour, sinon les points bruts
  function edGeom(i) {
    var info = S.res.edits && S.res.edits[i], e = S.edits[i];
    if (info && info.pts.length) return { pts: info.pts, ok: info.ok };
    var raw = e.p ? [e.p] : e.pts, out = [];
    raw.forEach(function (q) { var m = imgToMm(q); out.push(m[0], m[1]); });
    return { pts: out, ok: true };
  }
  function editAt(p) {
    var best = -1, bd = 10;
    S.edits.forEach(function (e, i) {
      var P = edGeom(i).pts, d = Infinity, k;
      if (e.p || P.length === 2) d = Math.hypot(sx(P[0]) - p.x, sy(P[1]) - p.y) - (e.s ? e.s / 2 * cam.s : 0);
      else for (k = 2; k < P.length; k += 2) {
        var ax = sx(P[k - 2]), ay = sy(P[k - 1]), bx = sx(P[k]), by = sy(P[k + 1]), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        var t = L2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / L2)) : 0;
        d = Math.min(d, Math.hypot(ax + t * dx - p.x, ay + t * dy - p.y));
      }
      if (d <= bd) { bd = d; best = i; }
    });
    return best;
  }
  function editClick(p) {
    if (!S.res || !S.img) return;
    if (ED.tool === 'select') { ED.sel = editAt(p); edStatus(); draw(); return; }
    var q = edPoint(p), u = mmToImg(q.mm[0], q.mm[1]);
    if (ED.tool === 'fill' || ED.tool === 'empty') { addEdit({ t: ED.tool, p: u }); return; }
    if (!ED.draft) ED.draft = [];
    var last = ED.draft[ED.draft.length - 1];
    if (last) { var lm = imgToMm(last); if (Math.hypot(sx(lm[0]) - p.x, sy(lm[1]) - p.y) < 4) return; }   // 2e clic d'un double-clic
    ED.draft.push(u); edStatus(); draw();
  }
  function edHover(p) {
    el.cv.classList.remove('is-cut', 'is-cut-y', 'is-pick');
    if (ED.tool === 'select') {
      var k = editAt(p);
      el.cv.classList.toggle('is-pick', k >= 0);
      return;
    }
    if (BRUSH[ED.tool]) { ED.cur = p; draw(); return; }
    var q = edPoint(p);
    ED.hover = q.mm; ED.snap = q.snap;
    draw();
  }
  function paintEdits(col) {
    var lw = 1 / cam.s;
    var curve = function (P, color, width, dash) {
      if (P.length < 4) return;
      g.beginPath(); g.moveTo(sx(P[0]), sy(P[1]));
      for (var k = 2; k < P.length; k += 2) g.lineTo(sx(P[k]), sy(P[k + 1]));
      g.setLineDash(dash || []); g.lineWidth = width; g.strokeStyle = color; g.stroke(); g.setLineDash([]);
    };
    var band = function (P, color, width) {
      g.beginPath(); g.moveTo(sx(P[0]), sy(P[1]));
      for (var k = 2; k < P.length; k += 2) g.lineTo(sx(P[k]), sy(P[k + 1]));
      if (P.length === 2) g.lineTo(sx(P[0]) + 0.01, sy(P[1]));
      g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = Math.max(1, width); g.strokeStyle = color; g.stroke();
      g.lineCap = 'butt'; g.lineJoin = 'miter';
    };
    var pin = function (x, y, sign, color, sel) {
      g.beginPath(); g.arc(x, y, sel ? 10 : 8, 0, Math.PI * 2);
      g.fillStyle = col.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = color; g.stroke();
      g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + 4, y); if (sign === '+') { g.moveTo(x, y - 4); g.lineTo(x, y + 4); }
      g.stroke();
    };
    toScreen();
    S.edits.forEach(function (e, i) {
      var G = edGeom(i), c = !G.ok || e.t === 'erase' ? col.bad : col.ember, sel = i === ED.sel;
      if (e.p) pin(sx(G.pts[0]), sy(G.pts[1]), e.t === 'fill' ? '+' : '−', c, sel);
      else if (e.s) {
        // coup de pinceau : axe en pointillé, bande à la vraie largeur une fois choisi
        if (sel) { g.globalAlpha = 0.3; band(G.pts, c, e.s * cam.s); g.globalAlpha = 1; }
        if (G.pts.length === 2) { g.beginPath(); g.arc(sx(G.pts[0]), sy(G.pts[1]), 3, 0, Math.PI * 2); g.fillStyle = c; g.fill(); }
        else curve(G.pts, c, 1.5, [4, 4]);
      } else {
        if (sel) { g.globalAlpha = 0.3; curve(G.pts, c, 9, null); g.globalAlpha = 1; }
        curve(G.pts, c, 2, [6, 4]);
      }
    });
    // coup de pinceau en cours, puis rond de la taille réelle sous le curseur
    if (drag && drag.kind === 'brush') {
      var bp = [];
      drag.pts.forEach(function (q) { var m = imgToMm(q); bp.push(m[0], m[1]); });
      g.globalAlpha = 0.45; band(bp, ED.tool === 'erase' ? col.paper : col.ember, ED.size * cam.s); g.globalAlpha = 1;
    }
    if (BRUSH[ED.tool] && ED.cur) {
      g.beginPath(); g.arc(ED.cur.x, ED.cur.y, Math.max(2, ED.size / 2 * cam.s), 0, Math.PI * 2);
      g.lineWidth = 3; g.strokeStyle = col.paper; g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = ED.tool === 'erase' ? col.bad : col.ember; g.stroke();
    }
    // ligne ou gomme en cours : courbe douce jusqu'au curseur
    if (ED.draft) {
      var pts = ED.draft.map(imgToMm);
      if (ED.hover) pts.push(ED.hover);
      if (pts.length >= 2) curve(E.spline(pts, Math.max(0.2, 2 * lw)), ED.tool === 'erase' ? col.bad : col.ember, 2.5, null);
      ED.draft.forEach(function (q) {
        var m = imgToMm(q);
        g.beginPath(); g.arc(sx(m[0]), sy(m[1]), 4, 0, Math.PI * 2);
        g.fillStyle = col.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = col.ember; g.stroke();
      });
    }
    // aimant : bouts de traits proches du curseur, anneau sur celui qui accroche
    if (ED.tool === 'line' && ED.hover && S.res.tips) {
      var T = S.res.tips, hx = sx(ED.hover[0]), hy = sy(ED.hover[1]);
      g.fillStyle = col.ember; g.globalAlpha = 0.55;
      for (var k = 0; k < T.length; k += 2) {
        var x = sx(T[k]), y = sy(T[k + 1]);
        if (Math.abs(x - hx) < 90 && Math.abs(y - hy) < 90) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
      }
      g.globalAlpha = 1;
      if (ED.snap) { g.beginPath(); g.arc(hx, hy, 9, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = col.ember; g.stroke(); }
    }
  }
  el.edit.addEventListener('click', function () { setEdit(!ED.on); });
  el.edTools.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tool]');
    if (b) setTool(b.getAttribute('data-tool'));
  });
  el.edUndo.addEventListener('click', edUndo);
  el.edRange.addEventListener('input', function () { setSize(+el.edRange.value); });
  setSize(ED.size);
  el.edClear.addEventListener('click', function () {
    if (!S.edits.length) return;
    var go = function () { S.edits = []; ED.draft = null; ED.sel = -1; edStatus(); schedule(false); };
    if (window.caDialog && caDialog.confirm) {
      caDialog.confirm({ title: 'Effacer toutes les retouches ?', ok: 'Effacer', danger: true, icon: 'trash' }).then(function (ok) { if (ok) go(); });
    } else go();
  });
  document.addEventListener('keydown', function (e) {
    if (!ED.on || !app.offsetParent) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    var k = e.key, done = true;
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) edUndo();
    else if (k === 'Enter' && ED.draft) finishDraft();
    else if (k === 'Escape') { if (ED.draft) { ED.draft = null; edStatus(); draw(); } else if (ED.sel >= 0) { ED.sel = -1; edStatus(); draw(); } else setEdit(false); }
    else if ((k === 'Backspace' || k === 'Delete') && ED.draft) edUndo();
    else if ((k === 'Backspace' || k === 'Delete') && ED.sel >= 0) edRemoveSel();
    else if ((k === '[' || k === ']') && BRUSH[ED.tool]) setSize(k === ']' ? Math.max(ED.size + 0.5, ED.size * 1.2) : Math.min(ED.size - 0.5, ED.size / 1.2));
    else done = false;
    if (done) e.preventDefault();
  });

  /* ------------------------------------------------------------------ */
  /*  Aperçu 3D (WebGL, sans bibliothèque)                                */
  /* ------------------------------------------------------------------ */
  var GL = null, mJob = 0;
  function gl3dInit() {
    if (GL) return GL;
    var gl = el.gl.getContext('webgl', { antialias: true });
    if (!gl) return null;
    var vs = 'attribute vec3 aP;attribute vec3 aN;uniform mat4 uVP;uniform vec3 uOff;varying vec3 vN;' +
      'void main(){vN=aN;gl_Position=uVP*vec4(aP+uOff,1.0);}';
    var fs = 'precision mediump float;varying vec3 vN;uniform vec3 uCol;uniform vec3 uL1;uniform vec3 uL2;' +
      'void main(){vec3 n=normalize(vN);float d=0.34+0.6*max(dot(n,uL1),0.0)+0.2*max(dot(n,uL2),0.0);gl_FragColor=vec4(uCol*d,1.0);}';
    var sh = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    GL = {
      gl: gl, prog: prog, buf: gl.createBuffer(), mesh: null,
      aP: gl.getAttribLocation(prog, 'aP'), aN: gl.getAttribLocation(prog, 'aN'),
      uVP: gl.getUniformLocation(prog, 'uVP'), uOff: gl.getUniformLocation(prog, 'uOff'), uCol: gl.getUniformLocation(prog, 'uCol'),
      uL1: gl.getUniformLocation(prog, 'uL1'), uL2: gl.getUniformLocation(prog, 'uL2'),
      yaw: -0.5, pitch: 0.3, dist: 1, tgt: [0, 0, 0]
    };
    return GL;
  }
  var FOV = 35 * Math.PI / 180;
  function fit3d() {
    var m = GL && GL.mesh;
    if (!m) return;
    var ex = el.explode.checked ? 14 : 0, w = m.w + (m.cols - 1) * ex, h = m.h + (m.rows - 1) * ex;
    var zt = m.T + (m.Tb || 0), rad = 0.5 * Math.sqrt(w * w + h * h + zt * zt), aspect = vw / Math.max(1, vh);
    GL.dist = rad / Math.tan(FOV / 2) / Math.min(1, aspect) * 1.08;
    GL.tgt = [m.w / 2, m.h / 2, m.T / 2];
  }
  function request3d() {
    if (!S.img || !S.ready || !S.res) return;
    var my = ++mJob;
    setBusy(true);
    post({ type: 'mesh', params: params(false) }).then(function (m) {
      setBusy(false);
      if (my !== mJob) return;
      if (m.type === 'error') { toastErr('3D impossible : ' + m.message); return; }
      if (!m.mesh || !m.mesh.ok) return;
      if (!gl3dInit()) { toastErr('3D indisponible sur ce navigateur.'); return; }
      var first = !GL.mesh;
      GL.mesh = m.mesh;
      var gl = GL.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, GL.buf);
      gl.bufferData(gl.ARRAY_BUFFER, m.mesh.data, gl.STATIC_DRAW);
      if (first) fit3d();
      else GL.tgt = [m.mesh.w / 2, m.mesh.h / 2, m.mesh.T / 2];
      render3d();
    });
  }
  function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function v3norm(a) { var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function v3cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function mPersp(fy, a, n, f) { var t = 1 / Math.tan(fy / 2), nf = 1 / (n - f); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]; }
  function mLook(e, c, u) {
    var z = v3norm(v3sub(e, c)), x = v3norm(v3cross(u, z)), y = v3cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3dot(x, e), -v3dot(y, e), -v3dot(z, e), 1];
  }
  function mMul(a, b) {
    var o = new Float32Array(16);
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
    return o;
  }
  function render3d() {
    if (!GL || S.view !== '3d') return;
    sizeCanvas();
    var gl = GL.gl, m = GL.mesh, col = colors(), bg = rgb(col.wash);
    gl.viewport(0, 0, el.gl.width, el.gl.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!m) return;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(GL.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, GL.buf);
    gl.enableVertexAttribArray(GL.aP); gl.vertexAttribPointer(GL.aP, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(GL.aN); gl.vertexAttribPointer(GL.aN, 3, gl.FLOAT, false, 24, 12);
    var cp = Math.cos(GL.pitch), dir = [cp * Math.sin(GL.yaw), Math.sin(GL.pitch), cp * Math.cos(GL.yaw)];
    var eye = [GL.tgt[0] + dir[0] * GL.dist, GL.tgt[1] + dir[1] * GL.dist, GL.tgt[2] + dir[2] * GL.dist];
    var VP = mMul(mPersp(FOV, vw / Math.max(1, vh), GL.dist / 200, GL.dist * 20), mLook(eye, GL.tgt, [0, 1, 0]));
    gl.uniformMatrix4fv(GL.uVP, false, VP);
    var right = v3norm(v3cross([0, 1, 0], dir));
    gl.uniform3fv(GL.uL1, v3norm([dir[0] - right[0] * 0.5, dir[1] + 0.6, dir[2] - right[2] * 0.5]));
    gl.uniform3fv(GL.uL2, v3norm([-dir[0] + right[0], -0.2, -dir[2] + right[2]]));
    var ex = el.explode.checked ? 14 : 0, shX = (m.cols - 1) * ex / 2, shY = (m.rows - 1) * ex / 2, ac = rgb(col.ember);
    // couleurs des filaments (relevées un peu : un noir pur n'aurait plus de relief) ; pièces voisines en léger contraste
    var lift = function (c, k) { return c.map(function (v) { return Math.min(1, (0.08 + 0.92 * v) * k); }); };
    var cP = rgb(colHex(el.colPiece)), cB = lift(rgb(colHex(el.colBack)), 1), multi = m.cols * m.rows > 1;
    m.parts.forEach(function (p) {
      var back = p.kind === 'back', o = [p.col * ex - shX, shY - p.row * ex, back && ex ? -10 : 0];
      var c = p.kind === 'tenon' ? ac : back ? cB : lift(cP, multi && (p.col + p.row) % 2 ? 0.86 : 1);
      gl.uniform3fv(GL.uOff, o); gl.uniform3fv(GL.uCol, c);
      gl.drawArrays(gl.TRIANGLES, p.first, p.count);
    });
  }
  var orbit = null;
  el.gl.addEventListener('pointerdown', function (e) {
    if (!GL || e.button !== 0) return;
    orbit = { x: e.clientX, y: e.clientY, yaw: GL.yaw, pitch: GL.pitch };
    try { el.gl.setPointerCapture(e.pointerId); } catch (err) {}
    el.gl.classList.add('is-pan');
  });
  el.gl.addEventListener('pointermove', function (e) {
    if (!orbit) return;
    GL.yaw = orbit.yaw - (e.clientX - orbit.x) * 0.008;
    GL.pitch = Math.max(-1.45, Math.min(1.45, orbit.pitch + (e.clientY - orbit.y) * 0.008));
    render3d();
  });
  ['pointerup', 'pointercancel'].forEach(function (t) { el.gl.addEventListener(t, function () { orbit = null; el.gl.classList.remove('is-pan'); }); });
  el.gl.addEventListener('wheel', function (e) {
    if (!GL) return;
    e.preventDefault();
    GL.dist *= Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.04 : 0.0012));
    render3d();
  }, { passive: false });
  el.gl.addEventListener('dblclick', function () { if (GL) { GL.yaw = -0.5; GL.pitch = 0.3; fit3d(); render3d(); } });
  el.bar3d.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cam]');
    if (!b || !GL) return;
    GL.yaw = b.getAttribute('data-cam') === 'back' ? Math.PI : 0; GL.pitch = 0.08;
    render3d();
  });
  el.explode.addEventListener('change', function () { fit3d(); render3d(); });

  /* --- Vues ---------------------------------------------------------- */
  function setView(v) {
    S.view = v;
    var is3d = v === '3d';
    if (v !== 'plan') setEdit(false);
    el.edit.hidden = v !== 'plan';
    el.gl.hidden = !is3d; el.cv.hidden = is3d;
    el.layers.hidden = v !== 'plan'; el.bar3d.hidden = !is3d;
    if (is3d) {
      sizeCanvas();
      if (!gl3dInit()) { toastErr('3D indisponible sur ce navigateur.'); setSeg('sil-view', 'plan'); setView('plan'); return; }
      render3d(); request3d();
    } else draw();
  }
  onSeg('sil-view', setView);

  /* ------------------------------------------------------------------ */
  /*  Exports                                                            */
  /* ------------------------------------------------------------------ */
  function baseName() {
    var b = (S.img && S.img.name || 'silhouette').replace(/\.[a-z0-9]+$/i, '');
    var slug = window.CA && CA.slugify ? CA.slugify(b) : b.replace(/[^\w-]+/g, '-');
    return (slug || 'silhouette') + '-' + Math.round(S.res.w) + 'x' + Math.round(S.res.h) + 'mm';
  }
  function doExport(kind, btn) {
    if (!S.img || !S.res) return;
    S.exporting++; renderPanel(); setBusy(true);
    post({ type: 'export', format: kind, name: baseName(), params: params(false) }).then(function (m) {
      S.exporting--; setBusy(false); renderPanel();
      if (m.type !== 'file') { toastErr('Export impossible : ' + (m.message || '')); return; }
      var f = m.file, blob = new Blob([f.bytes || f.text], { type: f.mime });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = f.name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      if (btn) btn.focus();
    });
  }
  el.b3mf.addEventListener('click', function () { doExport('3mf', el.b3mf); });
  el.bsvg.addEventListener('click', function () { doExport('svg', el.bsvg); });
  el.bdxf.addEventListener('click', function () { doExport('dxf', el.bdxf); });

  /* ------------------------------------------------------------------ */
  /*  Valeurs par défaut (réglées par Théo, synchro entre appareils)      */
  /* ------------------------------------------------------------------ */
  var DEF_KEY = 'silhouettes', DEF_LS = 'sil-defaults';
  // taille : enregistrée comme « sil-axis » (case qui commande) + « sil-size » (sa valeur)
  var DEF_IDS = ['sil-speck', 'sil-stroke', 'sil-stroke-min', 'sil-adapt', 'sil-bridge', 'sil-hole-min', 'sil-margin', 'sil-smooth', 'sil-simp', 'sil-thick', 'sil-min', 'sil-ov', 'sil-back-t', 'sil-back-m'];
  var DEF_SEGS = ['sil-printer', 'sil-isl', 'sil-thin', 'sil-holes', 'sil-back'];
  var DEF_COLS = ['sil-col-piece', 'sil-col-back'];   // id du filament ; options chargées plus tard -> setCol
  var DEF_CHECKS = [];
  var saved = null, touched = false;
  function snapshot() {
    var o = {};
    DEF_IDS.forEach(function (id) { o[id] = $('#' + id).value; });
    DEF_SEGS.forEach(function (id) { o[id] = segVal(id); });
    DEF_CHECKS.forEach(function (id) { o[id] = $('#' + id).checked; });
    DEF_COLS.forEach(function (id) { o[id] = $('#' + id).value; });
    o['sil-axis'] = S.sizeAxis;
    o['sil-size'] = (S.sizeAxis === 'h' ? el.sh : el.sw).value;
    return o;
  }
  function applyDefs(vals) {
    if (!vals) return;
    DEF_IDS.forEach(function (id) { if (vals[id] != null && vals[id] !== '') $('#' + id).value = vals[id]; });
    DEF_SEGS.forEach(function (id) { if (vals[id] && $('#' + id + ' [data-v="' + vals[id] + '"]')) setSeg(id, vals[id]); });
    DEF_CHECKS.forEach(function (id) { if (typeof vals[id] === 'boolean') $('#' + id).checked = vals[id]; });
    DEF_COLS.forEach(function (id) { setCol($('#' + id), vals[id]); });
    backUI();
    if (vals['sil-size']) {
      S.sizeAxis = vals['sil-axis'] === 'h' ? 'h' : 'w';
      (S.sizeAxis === 'h' ? el.sh : el.sw).value = vals['sil-size'];
      (S.sizeAxis === 'h' ? el.sw : el.sh).value = '';
    }
    updateOutputs();
  }
  function shortDay(iso) { try { return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function defsMsg(text, tone, detail) { el.defsMsg.textContent = text; el.defsMsg.title = detail || ''; el.defsMsg.className = 'sil-defs-msg' + (tone ? ' is-' + tone : ''); }
  function defsStatus() { defsMsg(saved && saved.vals ? 'enregistrées' + (saved.at ? ' le ' + shortDay(saved.at) : '') : ''); }
  try { saved = JSON.parse(localStorage.getItem(DEF_LS) || 'null'); } catch (e) { saved = null; }
  if (saved) applyDefs(saved.vals);
  defsStatus();
  $('#sil-panel').addEventListener('input', function (e) { if (e.isTrusted) touched = true; }, true);
  $('#sil-panel').addEventListener('click', function (e) { if (e.isTrusted && e.target.closest('.fx-seg-btn')) touched = true; }, true);
  el.defsSave.addEventListener('click', function () {
    var next = { vals: snapshot(), at: new Date().toISOString() }, sb = window.CA && window.CA.sb;
    saved = next;
    try { localStorage.setItem(DEF_LS, JSON.stringify(next)); } catch (e) {}
    if (!sb) { defsMsg('cet appareil seulement', 'warn'); return; }
    el.defsSave.disabled = true; defsMsg('enregistrement…');
    sb.from('admin_settings').upsert({ key: DEF_KEY, value: next, updated_at: next.at }).then(function (res) {
      el.defsSave.disabled = false;
      if (res.error) defsMsg('cet appareil seulement', 'warn', res.error.message); else defsMsg('enregistré ✓', 'ok');
    }, function (err) { el.defsSave.disabled = false; defsMsg('cet appareil seulement', 'warn', err && err.message ? err.message : String(err)); });
  });
  if (window.CA && window.CA.onAdminReady) window.CA.onAdminReady(function () {
    var sb = window.CA.sb;
    if (!sb) return;
    sb.from('admin_settings').select('value').eq('key', DEF_KEY).maybeSingle().then(function (res) {
      var v = res && !res.error && res.data && res.data.value;
      if (!v || !v.vals || (saved && saved.at && v.at && v.at <= saved.at)) return;
      saved = v;
      try { localStorage.setItem(DEF_LS, JSON.stringify(v)); } catch (e) {}
      if (!touched) { applyDefs(v.vals); schedule(false); }
      defsStatus();
    }, function () {});
  });

  /* ------------------------------------------------------------------ */
  /*  Taille de l'aperçu, thème                                          */
  /* ------------------------------------------------------------------ */
  function relayout() {
    fitHeight(); sizeCanvas(); placeEditbar();
    if (S.cropping && CR) CR.f = cropFit();
    if (S.res && !S.userView) fit();
    if (S.view === '3d') render3d(); else draw();
  }
  var lastW = 0, lastH = 0;
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      var r = el.stage.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var first = !lastW;
      if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
      lastW = r.width; lastH = r.height;
      relayout();
      if (first && S.res) { fit(); draw(); }
    }).observe(el.stage);
  }
  window.addEventListener('resize', function () { if (app.offsetParent) relayout(); });
  window.addEventListener('hashchange', function () { setTimeout(function () { if (app.offsetParent) relayout(); }, 0); });
  // thème clair/sombre ou accent changé : on repeint
  new MutationObserver(function () { if (S.view === '3d') render3d(); else draw(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });

  updateOutputs();
  renderPanel();
  setTimeout(relayout, 0);

  // Accès console / tests : état et chargement d'une image par URL.
  window.CA = window.CA || {};
  window.CA.silhouettes = {
    state: S,
    setFilaments: fillColors,
    loadUrl: function (url, name) {
      return fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
        loadFile(new File([b], name || url.split('/').pop(), { type: b.type || 'image/png' }));
      });
    }
  };
})();
