/* =========================================================
   Création Audio — Boîtes (onglet admin, groupe Atelier)
   Calculateur de boîtes de sub : ① sub + ampli (bibliothèque Sundown,
   Mes subs, éditeur T/S vérifié, véhicule), ② boîte (scellée, évent fente,
   évent rond ; cotes ou volume visé), ③ évent, ④ construction, ⑤ coupes. Centre : aperçu 3D
   (WebGL, sans bibliothèque) ou plan coté (SVG) ; droite : courbes à la
   WinISD (superposition de projets) et feuilles de coupe imprimables.
   Calculs : box-engine.js (sans DOM). Bibliothèque : box-subs.js.
   Données : box_subs (Mes subs), box_projects (projets). Brouillon local
   « bx-draft » ; préférences d'affichage « bx-prefs ».
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var app = $('#bx-app'), E = window.BoxEngine, LIB = window.BoxSubs || [];
  if (!app || !E) return;
  var panel = app.closest('.tabpanel') || document;
  var IN = E.IN, FT3 = E.FT3, LITRE = 0.001, TAU = 2 * Math.PI;

  var el = {
    sub: $('#bx-sub'), subRep: $('#bx-sub-rep'), subSum: $('#bx-sub-sum'), wiring: $('#bx-wiring'), watts: $('#bx-watts'), volts: $('#bx-volts'),
    tsBox: $('#bx-ts-box'), ts: $('#bx-ts'), tsN: $('#bx-ts-n'), tsNotes: $('#bx-ts-notes'),
    subSave: $('#bx-sub-save'), subNew: $('#bx-sub-new'), subDel: $('#bx-sub-del'),
    ref: $('#bx-ref'), veh: $('#bx-veh'), fcF: $('#bx-fc-f'), fc: $('#bx-fc'),
    type: $('#bx-type'), vtF: $('#bx-vt-f'), vt: $('#bx-vt'), w: $('#bx-w'), h: $('#bx-h'), d: $('#bx-d'),
    mw: $('#bx-mw'), mh: $('#bx-mh'), md: $('#bx-md'), maxRep: $('#bx-max-rep'), ratio: $('#bx-ratio'),
    boxRep: $('#bx-box-rep'), boxWarn: $('#bx-box-warn'), boxSum: $('#bx-box-sum'),
    portStep: $('#bx-port-step'), portSum: $('#bx-port-sum'), fb: $('#bx-fb'), pw: $('#bx-pw'), dp: $('#bx-dp'), wall: $('#bx-wall'), k: $('#bx-k'),
    flare: $('#bx-flare'), portRep: $('#bx-port-rep'),
    buildSum: $('#bx-build-sum'), mat: $('#bx-mat'), finish: $('#bx-finish'), brace: $('#bx-brace'), stuffF: $('#bx-stuff-f'), stuff: $('#bx-stuff'),
    stuffV: $('#bx-stuff-v'), ql: $('#bx-ql'),
    cutNote: $('#bx-cut-note'), sheetDims: $('#bx-sheet-dims'), sheetL: $('#bx-sheet-l'), sheetW: $('#bx-sheet-w'), kerf: $('#bx-kerf'), trim: $('#bx-trim'),
    grain: $('#bx-grain'), denF: $('#bx-den').closest('.bx-f'),
    name: $('#bx-name'), projSt: $('#bx-proj-st'), save: $('#bx-save'), projects: $('#bx-projects'), menu: $('#bx-menu'),
    newP: $('#bx-new'), dup: $('#bx-dup'), del: $('#bx-del'), plist: $('#bx-plist'),
    stage: $('#bx-stage'), gl: $('#bx-gl'), ov: $('#bx-ov'), plan: $('#bx-plan'), cams: $('#bx-cams'), bar3d: $('#bx-3dbar'),
    explode: $('#bx-explode'), xray: $('#bx-xray'), dims: $('#bx-dims'), stageMsg: $('#bx-stage-msg'), sum: $('#bx-sum'),
    metric: $('#bx-metric'), cabin: $('#bx-cabin'), cabinC: $('#bx-cabin-c'), freeze: $('#bx-freeze'), overlay: $('#bx-overlay'),
    chart: $('#bx-chart'), legend: $('#bx-legend'),
    cutSum: $('#bx-cut-sum'), print: $('#bx-print'), cutMsg: $('#bx-cut-msg'), sheets: $('#bx-sheets'), pieces: $('#bx-pieces tbody'), order: $('#bx-order')
  };

  /* ------------------------------------------------------------------ */
  /*  Outils                                                             */
  /* ------------------------------------------------------------------ */
  function fmt(n, d) { return (+n).toLocaleString('fr-CA', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function merge(a, b) {
    Object.keys(b || {}).forEach(function (k) {
      var v = b[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') merge(a[k], v); else a[k] = v;
    });
    return a;
  }
  function toast(msg, kind) { if (window.caDialog && caDialog.toast) caDialog.toast(msg, kind); else if (window.console) console.warn(msg); }
  function errMsg(err) { return err && err.message ? err.message : String(err); }
  function ask(o) { return window.caDialog && caDialog.confirm ? caDialog.confirm(o) : Promise.resolve(true); }
  function pick(sel) { if (window.CA && CA.pick) CA.pick(sel); }
  function sbc() { return window.CA && window.CA.sb; }
  function shortDay(iso) { try { return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function maxOf(a) { var m = -Infinity; for (var i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }
  // boutons segmentés : état = aria-checked (la classe .is-active est partagée avec d'autres onglets)
  function segVal(id) { var b = $('#' + id + ' .fx-seg-btn[aria-checked="true"]'); return b ? b.getAttribute('data-v') : null; }
  function setSeg(id, v) {
    $$('#' + id + ' .fx-seg-btn').forEach(function (b) {
      var on = b.getAttribute('data-v') === v;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  function onSeg(id, cb) {
    var box = $('#' + id);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.fx-seg-btn');
      if (!b || !box.contains(b) || b.disabled || b.getAttribute('aria-checked') === 'true') return;
      var v = b.getAttribute('data-v');
      setSeg(id, v);
      cb(v);
    });
  }
  var cssProbe = document.createElement('canvas').getContext('2d');
  function css(name, d) { return (getComputedStyle(app).getPropertyValue(name) || '').trim() || d; }
  function rgb(c) {            // couleur CSS -> [r, g, b] (0..1)
    cssProbe.fillStyle = '#000'; cssProbe.fillStyle = c;
    var v = cssProbe.fillStyle, m;
    if (v.charAt(0) === '#') return [parseInt(v.substr(1, 2), 16) / 255, parseInt(v.substr(3, 2), 16) / 255, parseInt(v.substr(5, 2), 16) / 255];
    m = /(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/.exec(v);
    return m ? [m[1] / 255, m[2] / 255, m[3] / 255] : [0, 0, 0];
  }

  /* ------------------------------------------------------------------ */
  /*  Préférences d'affichage, unités                                    */
  /* ------------------------------------------------------------------ */
  var PREF_LS = 'bx-prefs', DRAFT_LS = 'bx-draft';
  var UI = { units: 'in', den: 8, view: '3d', metric: 'spl', cabin: false, xray: false, dims: true };
  try { merge(UI, JSON.parse(localStorage.getItem(PREF_LS) || '{}')); } catch (e) {}
  if (UI.den !== 0) UI.den = 8;
  function savePrefs() { try { localStorage.setItem(PREF_LS, JSON.stringify(UI)); } catch (e) {} }

  function mm() { return UI.units === 'mm'; }
  function inch(x) { return UI.den ? E.frac(x, UI.den) : fmt(x, 2); }
  function lenBare(m) { return mm() ? fmt(m * 1000, Math.abs(m) < 0.1 ? 1 : 0) : inch(m / IN); }
  function lenTxt(m) { return m == null || !isFinite(m) ? '—' : lenBare(m) + (mm() ? ' mm' : ' in'); }
  function dims3(a, b, c) { return [a, b, c].map(lenBare).join(' × ') + (mm() ? ' mm' : ' in'); }
  function volTxt(m3) { return m3 == null || !isFinite(m3) ? '—' : mm() ? fmt(m3 / LITRE, 1) + ' L' : fmt(m3 / FT3, 2) + ' ft³'; }
  function ratioTxt(r) { return mm() ? fmt(r * RATIO_MM, 1) + ' cm²/L' : fmt(r, 1) + ' in²/ft³'; }
  function areaTxt(m2) { return mm() ? fmt(m2 / 1e-4, 0) + ' cm²' : fmt(m2 / (IN * IN), 1) + ' in²'; }
  function hz(f, d) { return fmt(f, d == null ? (f < 100 ? 1 : 0) : d) + ' Hz'; }
  function ohm(z) {
    var v = +(+z).toFixed(z < 1 ? 2 : 1), d = Math.abs(v - Math.round(v)) < 1e-9 ? 0 : Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2;
    return fmt(v, d) + ' Ω';
  }
  // valeurs des champs (sans unité : elle est dans la case)
  function lenField(m) {
    if (m == null || !isFinite(m)) return '';
    if (mm()) return String(+(m * 1000).toFixed(1)).replace('.', ',');
    return UI.den ? E.frac(m / IN, UI.den) : String(+(m / IN).toFixed(3)).replace('.', ',');
  }
  function volField(m3) { return m3 == null || !isFinite(m3) ? '' : String(+(mm() ? m3 / LITRE : m3 / FT3).toFixed(mm() ? 1 : 3)).replace('.', ','); }
  function numField(v, d) { return v == null || !isFinite(v) ? '' : String(+(+v).toFixed(d == null ? 3 : d)).replace('.', ','); }
  function parseNum(s) {
    s = String(s == null ? '' : s).trim().replace(/\s+/g, '').replace(',', '.');
    if (!s) return null;
    var v = +s;
    return isFinite(v) ? v : NaN;
  }
  // pouces : « 14 3/4 », « 14-3/4 », « 3/4 », « 14,75 », « 14 3/4" »
  function parseIn(s) {
    s = String(s == null ? '' : s).trim().replace(/,/g, '.').replace(/(["″]|po|in)$/, '').trim();
    if (!s) return null;
    var m = /^(\d+(?:\.\d+)?|\.\d+)?\s*(?:-?\s*(\d+)\s*\/\s*(\d+))?$/.exec(s);
    if (!m || (m[1] == null && m[2] == null)) return NaN;
    var v = (m[1] != null ? +m[1] : 0) + (m[2] != null ? +m[2] / +m[3] : 0);
    return isFinite(v) ? v : NaN;
  }
  function parseLen(s) {
    var v = mm() ? parseNum(s) : parseIn(s);
    return v == null || isNaN(v) ? v : v * (mm() ? 0.001 : IN);
  }
  function parseVolF(s) { var v = parseNum(s); return v == null || isNaN(v) ? v : v * (mm() ? LITRE : FT3); }

  /* ------------------------------------------------------------------ */
  /*  Projet (document) et état                                          */
  /* ------------------------------------------------------------------ */
  var SHEETS = { '4x8': [96, 48], '5x5': [60, 60], '4x4': [48, 48] };
  var RATIO_MM = (IN * IN / 1e-4) / (FT3 / 0.001);   // in²/ft³ → cm²/L
  var THICK = [0.5, 0.625, 0.75, 1];
  var TYPE_NAMES = { sealed: 'Scellée', slot: 'Évent fente', round: 'Évent rond' };
  var DEF_SUB = 'sd-sa12v3-d2';
  var FQ = E.freqs(10, 200, 220);
  function defaults() {
    return {
      sub: 'lib:' + DEF_SUB, rec: null,
      n: 1, coil: null, link: 'parallel', watts: null,
      goal: 'daily', atype: 'auto', max: { w: null, h: null, d: null }, vehicle: 'sedan', fc: 50,
      P: { type: 'slot', w: 30 * IN, h: 15 * IN, d: 18 * IN, t: 0.75 * IN, layers: 1, n: 1, fb: 34, brace: false, stuff: 0, ql: null,
        port: { side: 'left', pw: 2.5 * IN, dp: 4 * IN, np: 1, wall: 0.25 * IN, flare: true, k: 0.732 } },
      mode: 'dims', vt: null, ratio: null, mat: 'mdf', finish: 'raw',
      sheet: { id: '4x8', L: 96 * IN, W: 48 * IN, kerf: 0.125 * IN, trim: 0, grain: false }
    };
  }
  function libRec(id) { for (var i = 0; i < LIB.length; i++) if (LIB[i].id === id) return clone(LIB[i]); return null; }
  function subName(r) { return r ? (r.model || 'Sub sans nom') + (r.coil ? ' · ' + r.coil : '') : 'Sub'; }

  var D, S = {
    tsc: null, recDirty: false, res: null, overlays: [], explode: 0,
    proj: { id: null, name: '' }, dirty: false, saved: [], my: [], volOk: true
  };
  var draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_LS) || 'null'); } catch (e) { draft = null; }
  if (draft && draft.D && draft.D.P && draft.D.rec) {
    D = merge(defaults(), draft.D);
    S.proj = draft.proj || S.proj; S.dirty = !!draft.dirty; S.recDirty = !!draft.recDirty;
  } else {
    draft = null;
    D = defaults(); D.rec = libRec(DEF_SUB) || clone(LIB[0]) || {};
  }
  S.tsc = E.completeTS(D.rec);

  var draftT = 0;
  function saveDraft() {
    clearTimeout(draftT);
    draftT = setTimeout(function () {
      try { localStorage.setItem(DRAFT_LS, JSON.stringify({ D: D, proj: S.proj, dirty: S.dirty, recDirty: S.recDirty })); } catch (e) {}
    }, 250);
  }
  function markDirty() { S.dirty = true; projStatus(); saveDraft(); }
  function fcNow() {
    if (D.vehicle === 'custom') return D.fc || 0;
    var v = E.VEHICLES.filter(function (x) { return x.id === D.vehicle; })[0];
    return v ? v.fc : 0;
  }
  function wattsNow() { return D.watts > 0 ? D.watts : ((D.rec && D.rec.rms) || 500) * D.n; }
  function runInput(P) { return Object.assign({}, P, { n: D.n, coil: D.coil, link: D.link, watts: wattsNow(), vehicle: D.vehicle, fc: D.fc }); }

  /* ------------------------------------------------------------------ */
  /*  Calcul + rendu (une fois par image)                                */
  /* ------------------------------------------------------------------ */
  var raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = 0; compute(); render(); saveDraft(); });
  }
  // calcul en attente → tout de suite (avant de figer, imprimer ou enregistrer)
  function flush() { if (raf) { cancelAnimationFrame(raf); raf = 0; compute(); render(); saveDraft(); } }
  function compute() {
    var tsc = S.tsc, ts = tsc.ts, P = D.P;
    P.n = D.n;
    S.volOk = true;
    capDims();
    var fit = function () {
      if (D.mode === 'vol' && D.vt > 0) {
        var sol = E.solveDim(P, ts, 'w', D.vt, 3 * IN, D.max.w || 160 * IN);
        P.w = sol.x; S.volOk = sol.ok;
      }
    };
    fit();
    // surface visée : l'évent suit le volume net (quelques passes, le volume dépend de l'évent)
    if (ratioOn()) for (var i = 0; i < (D.mode === 'vol' ? 4 : 1); i++) { if (!portToRatio(P, ts)) break; fit(); }
    var r = E.run(runInput(P), ts, { f: FQ });
    var pcs = E.pieces(r.g);
    var cut = pcs.length ? E.cutlist(pcs, { L: D.sheet.L, W: D.sheet.W, kerf: D.sheet.kerf, trim: D.sheet.trim, grain: D.sheet.grain }) : { ok: false, sheets: [], bad: [] };
    S.res = { g: r.g, sim: tsc.ok ? r.sim : null, pcs: pcs, cut: cut, ts: ts };
    S.max = maxCalc(ts);
  }
  // l'espace max n'est jamais dépassé
  function capDims() {
    var P = D.P, m = D.max;
    if (m.w && P.w > m.w) P.w = m.w;
    if (m.h && P.h > m.h) P.h = m.h;
    if (m.d && P.d > m.d) P.d = m.d;
  }
  function ratioOn() { return D.ratio > 0 && D.P.type !== 'sealed'; }
  // un évent plus large s'allonge et mange du volume → bissection (surface − ratio × net croît avec la largeur)
  function portToRatio(P, ts) {
    var slot = P.type === 'slot', np = P.port.np || 1;
    var g0 = E.geometry(P, ts);
    if (!(g0.iw > 0) || !(g0.ih > 0)) return false;
    var setX = function (x) { if (slot) P.port.pw = x; else P.port.dp = x; };
    var over = function (x) {
      setX(x);
      var g = E.geometry(P, ts);
      if (!(g.net > 0)) return true;
      var A = slot ? x * g.ih : np * Math.PI * x * x / 4;
      return A >= D.ratio * (g.net / FT3) * IN * IN;
    };
    var lo = slot ? 0.25 * IN : 1 * IN, hi = Math.max(lo, slot ? g0.iw / 2 : Math.min(g0.iw, g0.ih));
    if (over(lo)) hi = lo;
    else if (!over(hi)) lo = hi;
    else for (var k = 0; k < 30 && hi - lo > 1e-5; k++) { var mid = (lo + hi) / 2; if (over(mid)) hi = mid; else lo = mid; }
    setX(hi);
    return true;
  }
  // espace max : volume net et accord le plus bas qui tiennent dedans
  function maxCalc(ts) {
    var m = D.max;
    if (!(m.w && m.h && m.d)) return null;
    var Q = clone(D.P); Q.n = D.n; Q.w = m.w; Q.h = m.h; Q.d = m.d;
    var at = function (fb) {
      Q.fb = fb;
      if (ratioOn()) portToRatio(Q, ts);
      return E.geometry(Q, ts);
    };
    var g = at(D.P.fb || 34), out = { net: g.net, fb: null };
    if (D.P.type === 'sealed') return out;
    var fits = function (fb) { var x = at(fb); return x.net > 0 && !x.errK.port && !x.errK.depth; };
    if (!fits(150)) return out;
    var lo = 10, hi = 150;
    if (fits(lo)) hi = lo;
    else for (var k = 0; k < 24 && hi - lo > 0.05; k++) { var mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    out.fb = Math.ceil(hi * 10) / 10;
    return out;
  }
  function render() {
    if (!S.res) return;
    renderSubInfo(); renderBox(); renderPort(); renderBuild(); renderSummary();
    build3d(); draw3d();
    if (UI.view === 'plan') renderPlan();
    renderChart(); renderCuts(); projStatus();
    syncFields();
  }
  function rep(rows) {
    return rows.filter(Boolean).map(function (r) {
      return '<div><span>' + esc(r[0]) + '</span><b' + (r[2] ? ' class="is-' + r[2] + '"' : '') + '>' + esc(r[1]) + '</b></div>';
    }).join('');
  }

  /* ------------------------------------------------------------------ */
  /*  ① Sub & ampli                                                      */
  /* ------------------------------------------------------------------ */
  function fillSubs() {
    var html = '', cur = D.sub, has = false;
    if (S.my.length) {
      html += '<optgroup label="Mes subs">' + S.my.map(function (m) {
        if ('my:' + m.id === cur) has = true;
        return '<option value="my:' + esc(m.id) + '">' + esc(subName(m.data)) + '</option>';
      }).join('') + '</optgroup>';
    }
    var groups = [], by = {};
    LIB.forEach(function (r) {
      if (!by[r.series]) { by[r.series] = []; groups.push(r.series); }
      by[r.series].push(r);
      if ('lib:' + r.id === cur) has = true;
    });
    groups.forEach(function (g) {
      html += '<optgroup label="Sundown · ' + esc(g) + '">' + by[g].map(function (r) {
        return '<option value="lib:' + esc(r.id) + '">' + esc(r.model + ' · ' + r.coil) + '</option>';
      }).join('') + '</optgroup>';
    });
    if (!has) html = '<option value="' + esc(cur) + '">' + esc(subName(D.rec)) + '</option>' + html;
    el.sub.innerHTML = html;
    el.sub.value = cur;
    pick(el.sub);
  }
  function setRec(key, rec) {
    D.sub = key; D.rec = rec || {}; S.recDirty = false;
    S.tsc = E.completeTS(D.rec);
    fillWiring(true); buildTS(); markDirty(); schedule();
  }
  el.sub.addEventListener('change', function () {
    var v = el.sub.value;
    var go = function () {
      if (/^lib:/.test(v)) setRec(v, libRec(v.slice(4)));
      else if (/^my:/.test(v)) {
        var m = S.my.filter(function (x) { return 'my:' + x.id === v; })[0];
        if (m) setRec(v, clone(m.data));
      }
      fillSubs();
    };
    if (!S.recDirty) { go(); return; }
    ask({ title: 'Changer de sub ?', message: 'Les paramètres T/S modifiés seront perdus.', ok: 'Changer' }).then(function (ok) {
      if (ok) go(); else { el.sub.value = D.sub; pick(el.sub); }
    });
  });

  function wireTxt(w, ts) {
    // bobines doubles + plusieurs subs : forme courte (∥ = parallèle) pour tenir dans la colonne
    var both = ts.coils !== 1 && D.n > 1, word = function (v) { return (both ? '' : 'en ') + (v === 'series' ? 'série' : both ? '∥' : 'parallèle'); };
    var c = ts.coils === 1 ? '' : 'bobines ' + word(w.coil);
    var l = D.n > 1 ? 'subs ' + word(w.link) : '';
    return [c, l].filter(Boolean).join(' · ') || 'bobine simple';
  }
  function fillWiring(reset) {
    var ts = S.tsc.ts, list = E.wirings(ts, D.n).sort(function (a, b) { return a.z - b.z; }), cur = D.coil + '|' + D.link;
    var ok = list.some(function (w) { return w.coil + '|' + w.link === cur; });
    if (reset || !ok) {
      var best = null;   // charge la plus basse sans descendre sous 1 Ω
      list.forEach(function (w) { if (w.z >= 0.9 && (!best || w.z < best.z)) best = w; });
      best = best || list[0];
      D.coil = best.coil; D.link = best.link;
    }
    el.wiring.innerHTML = list.map(function (w) {
      return '<option value="' + w.coil + '|' + w.link + '">' + esc(ohm(w.z) + ' · ' + wireTxt(w, ts)) + '</option>';
    }).join('');
    el.wiring.value = D.coil + '|' + D.link;
    pick(el.wiring);
  }
  el.wiring.addEventListener('change', function () {
    var p = el.wiring.value.split('|');
    D.coil = p[0]; D.link = p[1];
    markDirty(); schedule();
  });

  // Éditeur T/S : valeurs telles que publiées (unités de fiche), dimensions dans l'unité choisie.
  var TSF = [
    { k: 'brand', l: 'Marque', t: 'text' }, { k: 'model', l: 'Modèle', t: 'text' },
    { k: 'coil', l: 'Version', t: 'text' }, { k: 'zc', l: 'Ω par bobine', u: 'Ω' },
    { k: 'coils', l: 'Bobines', t: 'seg' },
    { k: 'Re', l: 'Re', u: 'Ω' }, { k: 'Le', l: 'Le', u: 'mH' },
    { k: 'Fs', l: 'Fs', u: 'Hz' }, { k: 'Qts', l: 'Qts' },
    { k: 'Qes', l: 'Qes' }, { k: 'Qms', l: 'Qms' },
    { k: 'Vas', l: 'Vas', u: 'L' }, { k: 'Sd', l: 'Sd', u: 'cm²' },
    { k: 'Mms', l: 'Mms', u: 'g' }, { k: 'Cms', l: 'Cms', u: 'mm/N' },
    { k: 'Bl', l: 'Bl', u: 'T·m' }, { k: 'Xmax', l: 'Xmax', u: 'mm' },
    { k: 'spl', l: 'Sensibilité', u: 'dB' }, { k: 'rms', l: 'Puissance RMS', u: 'W' },
    { k: 'cutout', l: 'Découpe', t: 'len' }, { k: 'od', l: 'Collerette', t: 'len' },
    { k: 'depth', l: 'Profondeur', t: 'len' }, { k: 'motor', l: 'Ø moteur', t: 'len' },
    { k: 'disp', l: 'Déplacement', t: 'vol' }
  ];
  function tsInput(k) { return $('#bx-ts-' + k); }   // champs créés par buildTS
  function tsDef(k) { for (var i = 0; i < TSF.length; i++) if (TSF[i].k === k) return TSF[i]; return null; }
  function buildTS() {
    el.ts.innerHTML = TSF.map(function (f) {
      var id = 'bx-ts-' + f.k;
      if (f.t === 'seg') {
        return '<div class="field col-2"><span class="lbl">' + f.l + '</span><div class="fx-seg bx-seg" id="' + id + '" role="radiogroup" aria-label="' + f.l + '">' +
          '<button class="fx-seg-btn" type="button" data-v="1" role="radio" aria-checked="false">Simple</button>' +
          '<button class="fx-seg-btn" type="button" data-v="2" role="radio" aria-checked="false">Double</button></div></div>';
      }
      var input = '<input type="text" ' + (f.t === 'text' ? '' : 'inputmode="decimal" class="num" ') + 'id="' + id + '" data-k="' + f.k + '" autocomplete="off">';
      var unit = f.t === 'len' ? (mm() ? 'mm' : 'in') : f.t === 'vol' ? (mm() ? 'L' : 'ft³') : f.u;
      return '<div class="field"><label class="lbl" for="' + id + '">' + esc(f.l) + '</label>' +
        (unit ? '<span class="unit" data-unit="' + esc(unit) + '"' + (f.t === 'len' ? ' data-len' : f.t === 'vol' ? ' data-vol' : '') + '>' + input + '</span>' : input) + '</div>';
    }).join('');
    syncTS();
  }
  function tsShow(f, r) {
    var v = r[f.k];
    if (v == null || v === '') return '';
    if (f.t === 'text') return String(v);
    if (f.t === 'len') return lenField(v * IN);
    if (f.t === 'vol') return volField(v * FT3);
    return numField(v, 4);
  }
  function syncTS() {
    var r = D.rec || {};
    TSF.forEach(function (f) {
      if (f.t === 'seg') { setSeg('bx-ts-' + f.k, String(r.coils === 1 ? 1 : 2)); return; }
      var inp = tsInput(f.k);
      if (inp && inp !== document.activeElement) inp.value = tsShow(f, r);
    });
  }
  function tsChanged() {
    S.recDirty = true;
    S.tsc = E.completeTS(D.rec);
    fillWiring(false); markDirty(); schedule();
  }
  el.ts.addEventListener('input', function (e) {
    var inp = e.target.closest('input[data-k]');
    if (!inp) return;
    var f = tsDef(inp.getAttribute('data-k')), v;
    if (f.t === 'text') v = inp.value.trim();
    else {
      v = f.t === 'len' ? parseLen(inp.value) : f.t === 'vol' ? parseVolF(inp.value) : parseNum(inp.value);
      if (v != null && (isNaN(v) || v < 0)) return;              // saisie en cours
      if (v != null && f.t === 'len') v /= IN;
      if (v != null && f.t === 'vol') v /= FT3;
    }
    D.rec[f.k] = v === '' ? null : v;
    tsChanged();
  });
  el.ts.addEventListener('change', function (e) {
    var inp = e.target.closest('input[data-k]');
    if (!inp) return;
    inp.value = tsShow(tsDef(inp.getAttribute('data-k')), D.rec);
    if (D.sub === 'new' && /^(model|coil)$/.test(inp.getAttribute('data-k'))) fillSubs();
  });
  el.ts.addEventListener('click', function (e) {
    var b = e.target.closest('#bx-ts-coils .fx-seg-btn');
    if (!b || b.getAttribute('aria-checked') === 'true') return;
    setSeg('bx-ts-coils', b.getAttribute('data-v'));
    D.rec.coils = +b.getAttribute('data-v');
    tsChanged();
  });

  function renderSubInfo() {
    var tsc = S.tsc, ts = tsc.ts, r = D.rec || {};
    el.subRep.innerHTML = [['Fs', ts.Fs ? hz(ts.Fs, 1) : '—'], ['Qts', ts.Qts ? fmt(ts.Qts, 3) : '—'],
      ['Vas', ts.Vas ? fmt(ts.Vas / LITRE, 1) + ' L' : '—'], ['Xmax', ts.Xmax ? fmt(ts.Xmax * 1000, 1) + ' mm' : '—']]
      .map(function (x) { return '<div><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('');
    var items = [];
    if (tsc.missing.length) items.push('<li class="is-bad">Manque : ' + esc(tsc.missing.join(', ')) + '</li>');
    tsc.notes.forEach(function (n) { items.push('<li>' + esc(n.t) + '</li>'); });
    (r.fix || []).forEach(function (t) { items.push('<li>Corrigé : ' + esc(t) + '</li>'); });
    el.tsNotes.innerHTML = items.join('');
    el.tsN.textContent = tsc.missing.length ? 'incomplets' : '';
    if (tsc.missing.length) el.tsBox.open = true;
    el.subDel.hidden = !/^my:/.test(D.sub);
    el.subSum.textContent = (r && r.model || 'Sub') + (D.n > 1 ? ' × ' + D.n : '') + ' · ' + fmt(wattsNow()) + ' W';
    var e = tsc.ok ? E.electrical(ts, D.n, D.coil, D.link, wattsNow()) : null;
    el.volts.value = e ? fmt(e.vAmp, 1) : '';
    el.watts.placeholder = fmt(((r.rms) || 500) * D.n);
    renderRef();
  }
  function renderRef() {
    var r = D.rec || {}, parts = [];
    if (r.recSealed != null) { var s = E.parseVol(r.recSealed); parts.push(s ? 'scellée ' + volTxt(s * FT3) : 'scellée déconseillée'); }
    if (r.recPorted != null) {
      var p = E.parseVol(r.recPorted);
      parts.push(p ? 'évent ' + volTxt(p * FT3) + (r.recTune ? ' à ' + r.recTune + ' Hz' : '') : 'évent déconseillé');
    }
    el.ref.innerHTML = parts.length ? '<b>' + esc((r.brand || 'Fabricant').replace(/ Audio$/, '')) + '</b> · ' + esc(parts.join(' · ')) : '';
  }

  // Mes subs (box_subs)
  function loadSubs() {
    var sb = sbc();
    if (!sb) return;
    sb.from('box_subs').select('id,brand,model,data').order('model').then(function (res) {
      if (res.error) { toast('Mes subs : ' + res.error.message, 'bad'); return; }
      S.my = res.data || [];
      fillSubs();
    }, function (err) { toast('Mes subs : ' + errMsg(err), 'bad'); });
  }
  el.subSave.addEventListener('click', function () {
    var sb = sbc();
    if (!sb) { toast('Connexion requise pour enregistrer', 'bad'); return; }
    var data = clone(D.rec), mine = /^my:/.test(D.sub);
    delete data.id; delete data.url;
    var row = { brand: data.brand || '', model: data.model || 'Sub sans nom', data: data, updated_at: new Date().toISOString() };
    var q = mine ? sb.from('box_subs').update(row).eq('id', D.sub.slice(3)) : sb.from('box_subs').insert(row);
    el.subSave.disabled = true;
    q.select('id,brand,model,data').single().then(function (res) {
      el.subSave.disabled = false;
      if (res.error) { toast('Sub non enregistré : ' + res.error.message, 'bad'); return; }
      S.my = S.my.filter(function (m) { return m.id !== res.data.id; }).concat([res.data])
        .sort(function (a, b) { return String(a.model).localeCompare(b.model, 'fr'); });
      D.sub = 'my:' + res.data.id; S.recDirty = false;
      fillSubs(); renderSubInfo(); markDirty();
      toast('Sub enregistré dans Mes subs');
    }, function (err) { el.subSave.disabled = false; toast('Sub non enregistré : ' + errMsg(err), 'bad'); });
  });
  el.subNew.addEventListener('click', function () {
    var go = function () {
      setRec('new', { brand: '', model: 'Nouveau sub', coil: '', coils: 2, zc: 4, wiring: 'series' });
      S.recDirty = true;
      fillSubs(); el.tsBox.open = true;
      var f = tsInput('model'); if (f) { f.focus(); f.select(); }
    };
    if (!S.recDirty) { go(); return; }
    ask({ title: 'Nouveau sub ?', message: 'Les paramètres T/S modifiés seront perdus.', ok: 'Continuer' }).then(function (ok) { if (ok) go(); });
  });
  el.subDel.addEventListener('click', function () {
    var sb = sbc(), id = D.sub.slice(3);
    if (!sb || !/^my:/.test(D.sub)) return;
    ask({ title: 'Supprimer ce sub ?', message: subName(D.rec) + ' sera retiré de Mes subs. Les projets gardent leur copie.', ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
      if (!ok) return;
      sb.from('box_subs').delete().eq('id', id).then(function (res) {
        if (res.error) { toast('Suppression impossible : ' + res.error.message, 'bad'); return; }
        S.my = S.my.filter(function (m) { return m.id !== id; });
        D.sub = 'new'; S.recDirty = true;
        fillSubs(); renderSubInfo(); markDirty();
        toast('Sub supprimé');
      }, function (err) { toast('Suppression impossible : ' + errMsg(err), 'bad'); });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Champs des étapes                                                  */
  /* ------------------------------------------------------------------ */
  var FIELDS = [
    { el: el.watts, k: 'num', get: function () { return D.watts; }, set: function (v) { D.watts = v; }, empty: true, min: 1, d: 0 },
    { el: el.fc, k: 'num', get: function () { return D.fc; }, set: function (v) { D.fc = v; }, min: 10, max: 200, d: 0 },
    { el: el.vt, k: 'vol', get: function () { return D.vt; }, set: function (v) { D.vt = v; }, min: 0.05 * FT3 },
    { el: el.mw, k: 'len', get: function () { return D.max.w; }, set: function (v) { D.max.w = v; }, empty: true, lazy: true, min: 3 * IN },
    { el: el.mh, k: 'len', get: function () { return D.max.h; }, set: function (v) { D.max.h = v; }, empty: true, lazy: true, min: 3 * IN },
    { el: el.md, k: 'len', get: function () { return D.max.d; }, set: function (v) { D.max.d = v; }, empty: true, lazy: true, min: 3 * IN },
    { el: el.w, k: 'len', get: function () { return D.P.w; }, set: function (v) { D.P.w = v; }, min: 3 * IN, cap: 'w' },
    { el: el.h, k: 'len', get: function () { return D.P.h; }, set: function (v) { D.P.h = v; }, min: 3 * IN, cap: 'h' },
    { el: el.d, k: 'len', get: function () { return D.P.d; }, set: function (v) { D.P.d = v; }, min: 3 * IN, cap: 'd' },
    { el: el.fb, k: 'num', get: function () { return D.P.fb; }, set: function (v) { D.P.fb = v; }, min: 10, max: 150, d: 1 },
    { el: el.ratio, k: 'ratio', get: function () { return D.ratio; }, set: function (v) { D.ratio = v; portUI(); }, empty: true, min: 1, max: 60 },
    { el: el.pw, k: 'len', get: function () { return D.P.port.pw; }, set: function (v) { D.P.port.pw = v; }, min: 0.25 * IN },
    { el: el.dp, k: 'len', get: function () { return D.P.port.dp; }, set: function (v) { D.P.port.dp = v; }, min: 1 * IN },
    { el: el.wall, k: 'len', get: function () { return D.P.port.wall; }, set: function (v) { D.P.port.wall = v; }, min: 0 },
    { el: el.k, k: 'num', get: function () { return D.P.port.k; }, set: function (v) { D.P.port.k = v; }, min: 0, max: 2, d: 3 },
    { el: el.ql, k: 'num', get: function () { return D.P.ql; }, set: function (v) { D.P.ql = v; }, empty: true, min: 1, d: 1 },
    { el: el.sheetL, k: 'len', get: function () { return D.sheet.L; }, set: function (v) { D.sheet.L = v; }, min: 12 * IN },
    { el: el.sheetW, k: 'len', get: function () { return D.sheet.W; }, set: function (v) { D.sheet.W = v; }, min: 12 * IN },
    { el: el.kerf, k: 'len', get: function () { return D.sheet.kerf; }, set: function (v) { D.sheet.kerf = v; }, min: 0 },
    { el: el.trim, k: 'len', get: function () { return D.sheet.trim; }, set: function (v) { D.sheet.trim = v; }, min: 0 }
  ];
  function showField(f) {
    var v = f.get();
    f.el.value = f.k === 'len' ? lenField(v) : f.k === 'vol' ? volField(v) : f.k === 'ratio' ? numField(v == null ? v : mm() ? v * RATIO_MM : v, 1) : numField(v, f.d);
  }
  FIELDS.forEach(function (f) {
    var take = function () {
      if (f.el.readOnly) return;
      var v = f.k === 'len' ? parseLen(f.el.value) : f.k === 'vol' ? parseVolF(f.el.value) : parseNum(f.el.value);
      if (f.k === 'ratio' && v != null && mm()) v /= RATIO_MM;
      if (f.cap && v != null && D.max[f.cap] && v > D.max[f.cap]) v = D.max[f.cap];
      if (v == null) { if (!f.empty) return; f.set(null); }
      else {
        if (isNaN(v) || (f.min != null && v < f.min) || (f.max != null && v > f.max)) return;
        f.set(v);
      }
      markDirty();
      if (!f.prop) schedule();
    };
    // espace max : appliqué à la validation seulement (taper « 30 » ne doit pas plafonner à 3 in en passant)
    f.el.addEventListener('input', function () { if (!f.lazy) take(); });
    f.el.addEventListener('change', function () { if (f.lazy) take(); showField(f); });
  });
  function placeholders() {
    el.ql.placeholder = D.P.type === 'sealed' ? '100' : '10';
    el.watts.placeholder = fmt(((D.rec && D.rec.rms) || 500) * D.n);
    el.k.placeholder = '0,732';
  }
  function syncFields() {
    FIELDS.forEach(function (f) { if (f.el !== document.activeElement) showField(f); });
    placeholders();
  }

  onSeg('bx-units', function (v) { UI.units = v; savePrefs(); unitsUI(); syncFields(); syncTS(); render(); });
  onSeg('bx-n', function (v) { D.n = +v; fillWiring(false); markDirty(); schedule(); });
  onSeg('bx-mode', function (v) {
    if (v === 'vol' && S.res && S.res.g.net > 0) D.vt = S.res.g.net;
    D.mode = v; modeUI(); syncFields(); markDirty(); schedule();
  });
  onSeg('bx-side', function (v) { D.P.port.side = v; markDirty(); schedule(); });
  onSeg('bx-np', function (v) { D.P.port.np = +v; markDirty(); schedule(); });
  onSeg('bx-t', function (v) { D.P.t = +v * IN; markDirty(); schedule(); });
  onSeg('bx-layers', function (v) { D.P.layers = +v; markDirty(); schedule(); });
  onSeg('bx-sheet', function (v) {
    D.sheet.id = v;
    if (SHEETS[v]) { D.sheet.L = SHEETS[v][0] * IN; D.sheet.W = SHEETS[v][1] * IN; }
    sheetUI(); syncFields(); markDirty(); schedule();
  });
  onSeg('bx-den', function (v) { UI.den = +v; savePrefs(); syncFields(); syncTS(); render(); });
  onSeg('bx-view', function (v) { UI.view = v; savePrefs(); viewUI(); });

  el.type.addEventListener('change', function () {
    var v = el.type.value;
    if (!TYPE_NAMES[v]) return;
    D.P.type = v;
    if (v !== 'sealed' && !(D.P.fb > 0)) D.P.fb = 34;
    typeUI(); syncFields(); markDirty(); schedule();
  });
  el.veh.addEventListener('change', function () { D.vehicle = el.veh.value; vehUI(); markDirty(); schedule(); });
  el.mat.addEventListener('change', function () { D.mat = el.mat.value; markDirty(); build3d(); draw3d(); });
  el.finish.addEventListener('change', function () { D.finish = el.finish.value; markDirty(); build3d(); draw3d(); });
  el.brace.addEventListener('change', function () { D.P.brace = el.brace.checked; markDirty(); schedule(); });
  el.flare.addEventListener('change', function () { D.P.port.flare = el.flare.checked; markDirty(); schedule(); });
  el.grain.addEventListener('change', function () { D.sheet.grain = el.grain.checked; markDirty(); schedule(); });
  el.stuff.addEventListener('input', function () { D.P.stuff = +el.stuff.value / 100; el.stuffV.textContent = el.stuff.value + ' %'; markDirty(); schedule(); });

  function typeUI() {
    var t = D.P.type, vented = t !== 'sealed';
    el.portStep.hidden = !vented;
    $$('[data-port]', el.portStep).forEach(function (x) { x.hidden = x.getAttribute('data-port') !== t; });
    el.stuffF.hidden = vented;
    el.type.value = t; pick(el.type);
    portUI();
  }
  // surface visée → largeur de fente / diamètre calculés
  function portUI() {
    var on = ratioOn();
    [el.pw, el.dp].forEach(function (x) { x.readOnly = on; x.tabIndex = on ? -1 : 0; });
  }
  function modeUI() {
    var vol = D.mode === 'vol';
    el.vtF.hidden = !vol; el.w.readOnly = vol; el.w.tabIndex = vol ? -1 : 0;
  }
  function fillVehicles() {
    el.veh.innerHTML = E.VEHICLES.map(function (v) {
      return '<option value="' + v.id + '">' + esc(v.name + (v.fc ? ' · ' + v.fc + ' Hz' : '')) + '</option>';
    }).join('') + '<option value="custom">Personnalisé</option>';
  }
  function vehUI() { el.fcF.hidden = D.vehicle !== 'custom'; el.veh.value = D.vehicle; pick(el.veh); cabinUI(); }
  function cabinUI() {
    var on = !!fcNow();
    el.cabin.disabled = !on; el.cabinC.classList.toggle('is-off', !on);
    el.cabin.checked = UI.cabin && on;
  }
  function sheetUI() { el.sheetDims.hidden = D.sheet.id !== 'custom'; }
  function unitsUI() {
    $$('[data-len]', panel).forEach(function (s) { s.setAttribute('data-unit', mm() ? 'mm' : 'in'); });
    $$('[data-vol]', panel).forEach(function (s) { s.setAttribute('data-unit', mm() ? 'L' : 'ft³'); });
    $$('[data-ratio]', panel).forEach(function (s) { s.setAttribute('data-unit', mm() ? 'cm²/L' : 'in²/ft³'); });
    el.denF.hidden = mm();
  }
  function nearT() {
    var t = D.P.t / IN, best = null;
    THICK.forEach(function (x) { if (Math.abs(x - t) < 0.01) best = x; });
    return best == null ? '' : String(best);
  }
  function syncAll() {
    setSeg('bx-units', UI.units); setSeg('bx-n', String(D.n));
    setSeg('bx-mode', D.mode); setSeg('bx-side', D.P.port.side); setSeg('bx-np', String(D.P.port.np)); setSeg('bx-t', nearT());
    setSeg('bx-layers', String(D.P.layers)); setSeg('bx-sheet', D.sheet.id); setSeg('bx-den', String(UI.den)); setSeg('bx-view', UI.view);
    el.brace.checked = !!D.P.brace; el.flare.checked = !!D.P.port.flare; el.grain.checked = !!D.sheet.grain;
    el.xray.checked = !!UI.xray; el.dims.checked = !!UI.dims;
    el.stuff.value = Math.round((D.P.stuff || 0) * 100); el.stuffV.textContent = el.stuff.value + ' %';
    el.mat.value = D.mat; pick(el.mat); el.finish.value = D.finish; pick(el.finish);
    el.metric.value = UI.metric; pick(el.metric);
    if (document.activeElement !== el.name) el.name.value = S.proj.name || '';
    unitsUI(); typeUI(); modeUI(); vehUI(); sheetUI(); syncFields(); syncTS(); viewUI();
  }

  /* ------------------------------------------------------------------ */
  /*  Boîte de départ (proposée pour le sub)                             */
  /* ------------------------------------------------------------------ */
  function proposeNow() {
    return E.propose({
      ts: S.tsc.ts, rec: D.rec, n: D.n, coil: D.coil, link: D.link, watts: wattsNow(), goal: D.goal, type: D.atype,
      max: { w: D.max.w, h: D.max.h, d: D.max.d }, area: D.ratio, vehicle: D.vehicle, fc: D.fc,
      t: D.P.t, layers: D.P.layers, side: D.P.port.side, brace: D.P.brace
    });
  }
  function applyProp(r) {
    var P = D.P, Q = r.P;
    P.type = Q.type; P.w = Q.w; P.h = Q.h; P.d = Q.d;
    if (Q.type !== 'sealed') P.fb = Q.fb;
    if (Q.type === 'slot') P.port.pw = Q.port.pw;
    if (Q.type === 'round') { P.port.dp = Q.port.dp; P.port.np = Q.port.np; P.port.flare = Q.port.flare; }
    D.mode = 'dims';
  }

  /* ------------------------------------------------------------------ */
  /*  Rapports                                                           */
  /* ------------------------------------------------------------------ */
  function renderBox() {
    var g = S.res.g;
    el.boxRep.innerHTML = g.iw > 0 ? rep([
      ['Intérieur', dims3(g.iw, g.ih, g.id)],
      ['Brut', volTxt(g.gross)],
      g.dispSubs ? ['Subs', '− ' + volTxt(g.dispSubs)] : null,
      g.dispPort ? ['Évent', '− ' + volTxt(g.dispPort)] : null,
      g.dispBrace ? ['Renfort', '− ' + volTxt(g.dispBrace)] : null,
      ['Net', volTxt(g.net), g.net > 0 ? '' : 'bad']
    ]) : '';
    var w = g.err.map(function (t) { return '<li class="is-bad">' + esc(t) + '</li>'; })
      .concat(g.warn.map(function (t) { return '<li>' + esc(t) + '</li>'; }));
    if (D.mode === 'vol' && !S.volOk) w.unshift('<li class="is-bad">' + esc('Volume visé hors d\'atteinte : ' + volTxt(g.net) + ' net au plus') + '</li>');
    var M = S.max;
    el.maxRep.innerHTML = M ? rep([
      ['Net max', M.net > 0 ? volTxt(M.net) : '—', M.net > 0 ? '' : 'bad'],
      D.P.type !== 'sealed' ? ['Accord min', M.fb != null ? hz(M.fb, 1) : 'évent impossible', M.fb != null ? '' : 'bad'] : null
    ]) : '';
    el.maxRep.hidden = !M;
    el.boxWarn.innerHTML = w.join('');
    el.boxSum.textContent = g.net > 0 ? volTxt(g.net) + ' net' : '';
  }
  function renderPort() {
    var g = S.res.g, p = g.port, sim = S.res.sim;
    if (D.P.type === 'sealed') { el.portRep.innerHTML = ''; el.portSum.textContent = ''; return; }
    if (!p) { el.portRep.innerHTML = ''; el.portSum.textContent = ''; return; }
    var vmax = sim ? maxOf(sim.vp) : null, ratio = g.net > 0 ? (p.Sp / (IN * IN)) / (g.net / FT3) : 0;
    el.portRep.innerHTML = rep([
      ['Surface', areaTxt(p.Sp)],
      ['Ratio', ratioTxt(ratio)],
      ['Longueur', lenTxt(p.L)],
      p.shape === 'L' ? ['Forme', 'en L · retour ' + lenTxt(p.wall2)] : p.shape === 'straight' ? ['Forme', 'droit'] :
        ['Forme', p.np + ' × Ø ' + lenTxt(p.dp)],
      ['Accord réel', g.net > 0 ? hz(p.fb) : '—'],
      vmax != null ? ['Air max', fmt(vmax, 1) + ' m/s', vmax > 26 ? 'bad' : ''] : null
    ]);
    el.portSum.textContent = g.net > 0 ? hz(p.fb, 1) + ' · ' + ratioTxt(ratio) : '';
  }
  function renderBuild() {
    el.buildSum.textContent = lenTxt(D.P.t) + ' · façade ' + (D.P.layers === 2 ? 'double' : 'simple');
    placeholders();
  }
  function sheetName() { return SHEETS[D.sheet.id] ? D.sheet.id.replace('x', ' × ') : lenBare(D.sheet.L) + ' × ' + lenBare(D.sheet.W); }
  function sheetsTxt(cut, short) {
    var n = cut.sheets.length, half = n && cut.sheets[n - 1].half, whole = n - (half ? 1 : 0), c = (whole || '') + (half ? '½' : '');
    if (short && !SHEETS[D.sheet.id]) return c + (whole >= 2 ? ' feuilles' : ' feuille');   // tuile : format perso trop long
    return c + ' × ' + sheetName();
  }
  function xmaxAt(sim, ts) {
    if (!ts.Xmax) return null;
    for (var i = sim.f.length - 1; i >= 0; i--) if (sim.x[i] > ts.Xmax) return sim.f[i];
    return null;
  }
  function tile(l, v, bad, wide) { return '<div class="bx-tile' + (wide ? ' is-wide' : '') + '"><span>' + esc(l) + '</span><b' + (bad ? ' class="is-bad"' : '') + ' title="' + esc(v) + '">' + esc(v) + '</b></div>'; }
  function renderSummary() {
    var g = S.res.g, sim = S.res.sim, ts = S.res.ts, cut = S.res.cut, vented = D.P.type !== 'sealed';
    var t = [tile('Dimensions', dims3(g.W, g.H, g.D), false, true), tile('Volume net', g.net > 0 ? volTxt(g.net) : '—', !(g.net > 0))];
    if (vented && g.port) { t.push(tile('Accord', g.net > 0 ? hz(g.port.fb, 1) : '—')); t.push(tile('Évent', areaTxt(g.port.Sp))); }
    else if (sim && sim.fc) t.push(tile('Fc · Qtc', hz(sim.fc, 0) + ' · ' + fmt(sim.qtc, 2)));
    if (sim) {
      t.push(tile('F3', sim.f3 ? hz(sim.f3, 0) : '—'));
      var xm = xmaxAt(sim, ts);
      t.push(tile('Xmax atteint', xm == null ? 'jamais' : 'sous ' + hz(xm, 0), xm != null && xm > 25));
      if (vented) { var vp = maxOf(sim.vp); t.push(tile('Air max', fmt(vp, 0) + ' m/s', vp > 26)); }
      t.push(tile('Charge', ohm(sim.zLoad) + ' · ' + fmt(sim.vAmp, 0) + ' V'));
    }
    t.push(tile('Feuilles', cut.ok ? sheetsTxt(cut, true) : '—', !cut.ok));
    el.sum.innerHTML = t.join('');
  }

  /* ------------------------------------------------------------------ */
  /*  Aperçu 3D (WebGL)                                                  */
  /* ------------------------------------------------------------------ */
  var GL = null, MESH = null, cam = { yaw: 0.62, pitch: 0.36, zoom: 1 }, FOV = 32 * Math.PI / 180, vw = 0, vh = 0, dpr = 1;
  var VS = 'attribute vec3 aP;attribute vec3 aN;attribute float aE;uniform mat4 uVP;uniform vec3 uOff;' +
    'varying vec3 vN;varying vec3 vP;varying float vE;' +
    'void main(){vN=aN;vP=aP;vE=aE;gl_Position=uVP*vec4(aP+uOff,1.0);}';
  var FS = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'varying vec3 vN;varying vec3 vP;varying float vE;' +
    'uniform vec3 uCol;uniform float uA;uniform float uTex;uniform vec3 uL1;uniform vec3 uL2;' +
    'uniform vec3 uH[8];uniform int uNH;uniform vec4 uWin;uniform float uWinR;uniform float uHasWin;' +
    'float hash(vec3 p){p=fract(p*0.3183099+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}' +
    'float noise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);' +
    'return mix(mix(mix(hash(i),hash(i+vec3(1.0,0.0,0.0)),f.x),mix(hash(i+vec3(0.0,1.0,0.0)),hash(i+vec3(1.0,1.0,0.0)),f.x),f.y),' +
    'mix(mix(hash(i+vec3(0.0,0.0,1.0)),hash(i+vec3(1.0,0.0,1.0)),f.x),mix(hash(i+vec3(0.0,1.0,1.0)),hash(i+vec3(1.0,1.0,1.0)),f.x),f.y),f.z);}' +
    'void main(){vec3 n=normalize(vN);' +
    'if(abs(n.z)>0.5){for(int i=0;i<8;i++){if(i>=uNH)break;vec2 d=vP.xy-uH[i].xy;if(dot(d,d)<uH[i].z*uH[i].z)discard;}' +
    'if(uHasWin>0.5){vec2 c=(uWin.xy+uWin.zw)*0.5;vec2 hs=(uWin.zw-uWin.xy)*0.5-vec2(uWinR);vec2 q=abs(vP.xy-c)-hs;' +
    'float dd=length(max(q,0.0))+min(max(q.x,q.y),0.0)-uWinR;if(dd<0.0)discard;}}' +
    'vec3 col=uCol;' +
    'if(uTex>0.5&&uTex<1.5){float g=noise(vP*900.0)*0.55+noise(vP*240.0)*0.45;col*=0.9+0.17*g;col*=mix(1.0,0.8,vE);}' +
    'if(uTex>1.5){float g=noise(vP*2600.0);col*=0.82+0.3*g;}' +
    'float l=0.36+0.56*max(dot(n,uL1),0.0)+0.2*max(dot(n,uL2),0.0);' +
    'gl_FragColor=vec4(col*l,uA);}';
  function glInit() {
    if (GL) return GL;
    var gl = el.gl.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) return null;
    var sh = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { if (window.console) console.warn(gl.getProgramInfoLog(prog)); return null; }
    var u = function (n) { return gl.getUniformLocation(prog, n); };
    GL = {
      gl: gl, prog: prog, buf: gl.createBuffer(),
      aP: gl.getAttribLocation(prog, 'aP'), aN: gl.getAttribLocation(prog, 'aN'), aE: gl.getAttribLocation(prog, 'aE'),
      u: { vp: u('uVP'), off: u('uOff'), col: u('uCol'), a: u('uA'), tex: u('uTex'), l1: u('uL1'), l2: u('uL2'),
        h: u('uH[0]'), nh: u('uNH'), win: u('uWin'), winR: u('uWinR'), hasWin: u('uHasWin') }
    };
    return GL;
  }
  // géométrie : 7 flottants par sommet (position, normale, arête MDF 0|1)
  function push(B, p, n, e) { B.push(p[0], p[1], p[2], n[0], n[1], n[2], e); }
  function quad(B, a, b, c, d, n, e) { push(B, a, n, e); push(B, b, n, e); push(B, c, n, e); push(B, a, n, e); push(B, c, n, e); push(B, d, n, e); }
  function box(B, a, b) {
    var x0 = a[0], y0 = a[1], z0 = a[2], x1 = b[0], y1 = b[1], z1 = b[2], dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    var thin = dx <= dy && dx <= dz ? 0 : dy <= dz ? 1 : 2;
    quad(B, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], thin === 0 ? 0 : 1);
    quad(B, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], thin === 0 ? 0 : 1);
    quad(B, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], thin === 1 ? 0 : 1);
    quad(B, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], thin === 1 ? 0 : 1);
    quad(B, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], thin === 2 ? 0 : 1);
    quad(B, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], thin === 2 ? 0 : 1);
  }
  // révolution autour de l'axe z (profil [r, z] relatif à z0) ; pref = sens voulu des normales [r, z]
  function revolve(B, cx, cy, z0, pts, pref, seg) {
    seg = seg || 48;
    for (var i = 0; i < pts.length - 1; i++) {
      var p = pts[i], q = pts[i + 1], dr = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dr, dz) || 1;
      var nr = dz / L, nz = -dr / L, pf = Array.isArray(pref[0]) ? pref[i] : pref;
      if (nr * pf[0] + nz * pf[1] < 0) { nr = -nr; nz = -nz; }
      for (var k = 0; k < seg; k++) {
        var a0 = k / seg * TAU, a1 = (k + 1) / seg * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        var A = [cx + p[0] * c0, cy + p[0] * s0, z0 + p[1]], Bb = [cx + p[0] * c1, cy + p[0] * s1, z0 + p[1]];
        var Cc = [cx + q[0] * c1, cy + q[0] * s1, z0 + q[1]], Dd = [cx + q[0] * c0, cy + q[0] * s0, z0 + q[1]];
        var n0 = [nr * c0, nr * s0, nz], n1 = [nr * c1, nr * s1, nz];
        push(B, A, n0, 0); push(B, Bb, n1, 0); push(B, Cc, n1, 0);
        push(B, A, n0, 0); push(B, Cc, n1, 0); push(B, Dd, n0, 0);
      }
    }
  }
  function rrPts(x0, y0, x1, y1, r) {
    var out = [], cs = [[x1 - r, y1 - r, 0], [x0 + r, y1 - r, 1], [x0 + r, y0 + r, 2], [x1 - r, y0 + r, 3]];
    cs.forEach(function (c) { for (var i = 0; i <= 6; i++) { var a = (c[2] + i / 6) * Math.PI / 2; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } });
    return out;
  }
  function loopWall(B, pts, zA, zB) {     // paroi d'une ouverture : normales vers l'intérieur de la boucle
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      var n = [-dy / L, dx / L, 0];
      quad(B, [p[0], p[1], zA], [q[0], q[1], zA], [q[0], q[1], zB], [p[0], p[1], zB], n, 0);
    }
  }
  var WOOD = { mdf: '#b99a6c', birch: '#dcc39a', ply: '#c9a46e' };
  function woodCol() { return D.finish === 'carpet' ? rgb('#2c2e33') : D.finish === 'paint' ? rgb('#25272b') : rgb(WOOD[D.mat] || WOOD.mdf); }
  function woodTex() { return D.finish === 'carpet' ? 2 : D.finish === 'paint' ? 0 : 1; }
  function build3d() {
    if (!S.res || !glInit()) return;
    var g = S.res.g;
    if (!g.panels || !g.panels.length) { MESH = null; return; }
    var W = g.W, H = g.H, Dp = g.D, B = [], parts = [], outerEx = [0, 0, 1], col = woodCol(), tex = woodTex();
    var sc = function (x, y, z) { return [x - W / 2, y - H / 2, Dp / 2 - z]; };
    var begin = function () { return B.length / 7; };
    var end = function (p, f) { p.first = f; p.count = B.length / 7 - f; parts.push(p); };
    g.panels.forEach(function (p) {
      var f = begin(), a = sc(p.x0, p.y0, p.z1), b = sc(p.x1, p.y1, p.z0);
      box(B, a, b);
      var part = { kind: 'panel', outer: p.role !== 'port' && p.role !== 'brace', glass: p.role === 'top', col: col, tex: tex,
        ex: [p.ex[0], p.ex[1], -p.ex[2]], c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] };
      if (p.holes && p.holes.length) {
        part.holes = p.holes.map(function (h) { return [h.x - W / 2, h.y - H / 2, h.r]; });
        part.holes.forEach(function (h) { revolve(B, h[0], h[1], 0, [[h[2], a[2]], [h[2], b[2]]], [-1, 0], 40); });
      }
      if (p.win) {
        var m = p.win.m, wr = p.win.r, w0 = a[0] + m, h0 = a[1] + m, w1 = b[0] - m, h1 = b[1] - m;
        part.win = [w0, h0, w1, h1, wr];
        loopWall(B, rrPts(w0, h0, w1, h1, wr), a[2], b[2]);
      }
      end(part, f);
      if (p.role === 'baffle' && p.layer === 0) outerEx = part.ex;
    });
    // subs : collerette, suspension, cône, cache-noyau ; panier + moteur derrière la façade
    var cut = g.cut || 0;
    if (cut) (g.subs || []).forEach(function (s) {
      var cx = s.x - W / 2, cy = s.y - H / 2, z0 = Dp / 2, R = (g.od || cut * 1.1) / 2, rc = cut / 2;
      var mr = (g.motor || cut * 0.6) / 2, dep = g.depthSub || rc * 0.8;
      var hf = Math.min(0.016, R * 0.08), sOut = rc * 0.97, sw = R * 0.12, sIn = sOut - sw, zs = hf * 0.55;
      var cone = R * 0.3, rCap = R * 0.3, capH = rCap * 0.42, zc = zs - cone;
      var sur = [], capP = [], i;
      for (i = 0; i <= 10; i++) { var a = i / 10 * Math.PI; sur.push([(sOut + sIn) / 2 + sw / 2 * Math.cos(a), zs + sw * 0.42 * Math.sin(a)]); }
      for (i = 0; i <= 8; i++) { var b2 = i / 8 * Math.PI / 2; capP.push([rCap * Math.cos(b2), zc + capH * Math.sin(b2)]); }
      var add = function (pts, pref, hex, seg) { var f = begin(); revolve(B, cx, cy, z0, pts, pref, seg); end({ kind: 'driver', col: rgb(hex), tex: 0, ex: outerEx }, f); };
      add([[R, 0], [R, hf], [sOut, hf], [sOut, zs]], [[1, 0], [0, 1], [-1, 0]], '#2e3035');
      add(sur, [0, 1], '#17181a');
      add([[sIn, zs], [(sIn + rCap) / 2, zs - cone * 0.58], [rCap, zc]], [0, 1], '#222327');
      add(capP, [0, 1], '#2c2e33', 40);
      add([[rc * 0.95, -0.004], [mr * 1.08, -dep * 0.62]], [1, -0.3], '#474a51', 32);
      add([[mr, -dep * 0.62], [mr, -dep], [0, -dep]], [[1, 0], [0, -1]], '#1b1c1f', 40);
    });
    // évents ronds : tubes (paroi intérieure, extérieure, bout), bouts évasés
    var pt = g.port;
    if (pt && pt.shape === 'round') pt.ys.forEach(function (y) {
      var cx = pt.x - W / 2, cy = y - H / 2, ri = pt.dp / 2, ro = ri + pt.wall, Lp = pt.L, zf = Dp / 2, lip = pt.flare ? 0.6 * IN : 0, f = begin();
      revolve(B, cx, cy, zf, [[ri, -lip], [ri, -Lp]], [-1, 0], 40);
      revolve(B, cx, cy, zf, [[ro, -g.tf], [ro, -Lp]], [1, 0], 40);
      revolve(B, cx, cy, zf, [[ri, -Lp], [ro, -Lp]], [0, -1], 40);
      if (lip) {
        var fl = [];
        for (var i = 0; i <= 8; i++) { var a = i / 8 * Math.PI / 2; fl.push([ri + lip - lip * Math.cos(a), -lip + lip * Math.sin(a) + 0.0008]); }
        revolve(B, cx, cy, zf, fl, [-1, 1], 40);
      }
      revolve(B, cx, cy, zf, [[ri + lip, 0.0008], [ro + lip + 0.12 * IN, 0.0008]], [0, 1], 40);
      end({ kind: 'tube', col: rgb('#202124'), tex: 0, ex: outerEx }, f);
    });
    var gl = GL.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, GL.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(B), gl.STATIC_DRAW);
    MESH = { parts: parts, W: W, H: H, D: Dp, R: 0.5 * Math.sqrt(W * W + H * H + Dp * Dp) };
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
  function sizeCanvas() {
    var r = el.stage.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2); vw = r.width; vh = r.height;
    [el.gl, el.ov].forEach(function (c) {
      var w = Math.max(1, Math.round(vw * dpr)), h = Math.max(1, Math.round(vh * dpr));
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
    });
    return true;
  }
  function explodeAmt() { return MESH ? S.explode * 0.5 * Math.max(MESH.W, MESH.H, MESH.D) : 0; }
  function camera() {
    var aspect = vw / Math.max(1, vh), R = MESH.R * (1 + S.explode * 0.85);
    var dist = R / Math.tan(FOV / 2) / Math.min(1, aspect) * 1.16 * cam.zoom;
    var cp = Math.cos(cam.pitch), dir = [cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)];
    var eye = [dir[0] * dist, dir[1] * dist, dir[2] * dist];
    return { eye: eye, dir: dir, VP: mMul(mPersp(FOV, aspect, dist / 50, dist * 10), mLook(eye, [0, 0, 0], [0, 1, 0])) };
  }
  function draw3d() {
    if (UI.view !== '3d' || !app.offsetParent || !glInit() || !sizeCanvas()) return;
    var gl = GL.gl, bg = rgb(css('--wash', '#f6f6f4'));
    gl.viewport(0, 0, el.gl.width, el.gl.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    el.stageMsg.hidden = !!MESH;
    if (!MESH) { el.stageMsg.textContent = 'Boîte trop petite pour l\'épaisseur du bois'; drawDims(null); return; }
    var C = camera(), amt = explodeAmt();
    gl.useProgram(GL.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, GL.buf);
    gl.enableVertexAttribArray(GL.aP); gl.vertexAttribPointer(GL.aP, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(GL.aN); gl.vertexAttribPointer(GL.aN, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(GL.aE); gl.vertexAttribPointer(GL.aE, 1, gl.FLOAT, false, 28, 24);
    gl.uniformMatrix4fv(GL.u.vp, false, C.VP);
    var right = v3norm(v3cross([0, 1, 0], C.dir));
    gl.uniform3fv(GL.u.l1, v3norm([C.dir[0] - right[0] * 0.55, C.dir[1] + 0.7, C.dir[2] - right[2] * 0.55]));
    gl.uniform3fv(GL.u.l2, v3norm([-C.dir[0] + right[0], -0.25, -C.dir[2] + right[2]]));
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
    var hbuf = new Float32Array(24), trans = [];
    var drawPart = function (p, alpha) {
      gl.uniform3fv(GL.u.off, [p.ex[0] * amt, p.ex[1] * amt, p.ex[2] * amt]);
      gl.uniform3fv(GL.u.col, p.col); gl.uniform1f(GL.u.a, alpha); gl.uniform1f(GL.u.tex, p.tex || 0);
      hbuf.fill(0);
      var nh = p.holes ? Math.min(8, p.holes.length) : 0;
      for (var i = 0; i < nh; i++) hbuf.set(p.holes[i], i * 3);
      gl.uniform3fv(GL.u.h, hbuf); gl.uniform1i(GL.u.nh, nh);
      gl.uniform4fv(GL.u.win, p.win ? p.win.slice(0, 4) : [0, 0, 0, 0]);
      gl.uniform1f(GL.u.winR, p.win ? p.win[4] : 0); gl.uniform1f(GL.u.hasWin, p.win ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, p.first, p.count);
    };
    MESH.parts.forEach(function (p) { if (p.kind === 'panel' && (p.glass || (UI.xray && p.outer))) trans.push(p); else drawPart(p, 1); });
    if (trans.length) {
      trans.forEach(function (p) { var c = [p.c[0] + p.ex[0] * amt, p.c[1] + p.ex[1] * amt, p.c[2] + p.ex[2] * amt], d = v3sub(c, C.eye); p.dist = v3dot(d, d); });
      trans.sort(function (a, b) { return b.dist - a.dist; });
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      trans.forEach(function (p) { drawPart(p, 0.2); });
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    drawDims(C.VP);
  }
  // cotes posées sur l'aperçu (L × H × P), seulement boîte fermée
  function drawDims(VP) {
    var c = el.ov, ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    if (!VP || !UI.dims || !MESH || S.explode > 0.02) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var hx = MESH.W / 2, hy = MESH.H / 2, hz = MESH.D / 2, sx = Math.sin(cam.yaw) >= 0 ? 1 : -1;
    var proj = function (p) {
      var x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13];
      var w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
      return [(x / w * 0.5 + 0.5) * vw, (0.5 - y / w * 0.5) * vh, w];
    };
    var ink = css('--ink', '#181a1f'), paper = css('--paper', '#fff'), muted = css('--muted', '#6c727c'), ctr = proj([0, 0, 0]);
    ctx.font = '600 12px ' + css('--font', 'sans-serif');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [[[-hx, -hy, hz], [hx, -hy, hz], MESH.W], [[-sx * hx, -hy, hz], [-sx * hx, hy, hz], MESH.H], [[sx * hx, -hy, hz], [sx * hx, -hy, -hz], MESH.D]].forEach(function (e) {
      var A = proj(e[0]), Bp = proj(e[1]);
      if (A[2] <= 0 || Bp[2] <= 0) return;
      var dx = Bp[0] - A[0], dy = Bp[1] - A[1], L = Math.hypot(dx, dy);
      if (L < 48) return;
      var nx = -dy / L, ny = dx / L, mx = (A[0] + Bp[0]) / 2, my = (A[1] + Bp[1]) / 2;
      if ((mx - ctr[0]) * nx + (my - ctr[1]) * ny < 0) { nx = -nx; ny = -ny; }
      var off = 20, a = [A[0] + nx * off, A[1] + ny * off], b = [Bp[0] + nx * off, Bp[1] + ny * off];
      ctx.strokeStyle = muted; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(A[0] + nx * 5, A[1] + ny * 5); ctx.lineTo(A[0] + nx * (off + 5), A[1] + ny * (off + 5));
      ctx.moveTo(Bp[0] + nx * 5, Bp[1] + ny * 5); ctx.lineTo(Bp[0] + nx * (off + 5), Bp[1] + ny * (off + 5));
      ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      var ux = dx / L, uy = dy / L, ah = 7, aw = 3.2;
      ctx.fillStyle = ink;
      [[a, 1], [b, -1]].forEach(function (q) {
        var p = q[0], s = q[1];
        ctx.beginPath(); ctx.moveTo(p[0], p[1]);
        ctx.lineTo(p[0] + s * ux * ah - uy * aw, p[1] + s * uy * ah + ux * aw);
        ctx.lineTo(p[0] + s * ux * ah + uy * aw, p[1] + s * uy * ah - ux * aw);
        ctx.closePath(); ctx.fill();
      });
      var t = lenTxt(e[2]), tw = ctx.measureText(t).width + 12, tx = (a[0] + b[0]) / 2 + nx * 4, ty = (a[1] + b[1]) / 2 + ny * 4;
      ctx.fillStyle = paper;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(tx - tw / 2, ty - 10, tw, 20, 6); ctx.fill(); } else ctx.fillRect(tx - tw / 2, ty - 10, tw, 20);
      ctx.fillStyle = ink; ctx.fillText(t, tx, ty + 0.5);
    });
  }
  var orbit = null;
  el.gl.addEventListener('pointerdown', function (e) {
    if (!MESH || e.button !== 0) return;
    orbit = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
    try { el.gl.setPointerCapture(e.pointerId); } catch (err) {}
    el.gl.classList.add('is-pan');
  });
  el.gl.addEventListener('pointermove', function (e) {
    if (!orbit) return;
    cam.yaw = orbit.yaw - (e.clientX - orbit.x) * 0.008;
    cam.pitch = Math.max(-1.45, Math.min(1.48, orbit.pitch + (e.clientY - orbit.y) * 0.008));
    draw3d();
  });
  ['pointerup', 'pointercancel'].forEach(function (t) { el.gl.addEventListener(t, function () { orbit = null; el.gl.classList.remove('is-pan'); }); });
  el.gl.addEventListener('wheel', function (e) {
    if (!MESH) return;
    e.preventDefault();
    cam.zoom = Math.max(0.3, Math.min(4, cam.zoom * Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.04 : 0.0012))));
    draw3d();
  }, { passive: false });
  el.gl.addEventListener('dblclick', function () { cam.yaw = 0.62; cam.pitch = 0.36; cam.zoom = 1; draw3d(); });
  var CAMS = { iso: [0.62, 0.36], front: [0, 0.02], side: [Math.PI / 2, 0.02], top: [0, 1.48] };
  el.cams.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cam]');
    if (!b) return;
    var c = CAMS[b.getAttribute('data-cam')];
    cam.yaw = c[0]; cam.pitch = c[1]; cam.zoom = 1;
    if (UI.view === '3d') draw3d();
  });
  el.explode.addEventListener('input', function () { S.explode = +el.explode.value / 100; draw3d(); });
  el.xray.addEventListener('change', function () { UI.xray = el.xray.checked; savePrefs(); draw3d(); });
  el.dims.addEventListener('change', function () { UI.dims = el.dims.checked; savePrefs(); draw3d(); });

  function viewUI() {
    var is3d = UI.view === '3d';
    el.gl.hidden = !is3d; el.ov.hidden = !is3d; el.plan.hidden = is3d;
    el.cams.hidden = !is3d; el.bar3d.hidden = !is3d;
    if (!S.res) return;
    if (is3d) { el.stageMsg.hidden = true; draw3d(); } else { el.stageMsg.hidden = true; renderPlan(); }
  }

  /* ------------------------------------------------------------------ */
  /*  Plan coté (SVG) : face, côté, dessus en coupe                       */
  /* ------------------------------------------------------------------ */
  function planSvg(g, PW, PH) {
    var W = g.W, H = g.H, Dp = g.D, t = g.t, mx = Math.max(W, H, Dp);
    var gap = 0.2 * mx, s = 1, fs = 0;
    for (var it = 0; it < 2; it++) {
      var totW = W + gap + Dp, totH = H + gap + Dp;
      s = Math.min((PW - 40) / (totW + 0.3 * mx), (PH - 80) / (totH + 0.36 * mx));
      fs = 12 / s;
      gap = Math.max(0.2 * mx, fs * 7);
    }
    var off = fs * 2, out = [], side = g.side === 'right';
    var X = function (x) { return side ? W - x : x; };          // repère gauche du moteur -> dessin
    var R = function (x0, y0, w, h, cls) { return '<rect class="' + cls + '" x="' + x0 + '" y="' + y0 + '" width="' + Math.max(w, 0) + '" height="' + Math.max(h, 0) + '"/>'; };
    var arrow = function (x, y, ux, uy) {
      var a = fs * 0.55, b = fs * 0.22;
      return '<path class="pl-arrow" d="M' + x + ' ' + y + 'L' + (x + ux * a - uy * b) + ' ' + (y + uy * a + ux * b) + 'L' + (x + ux * a + uy * b) + ' ' + (y + uy * a - ux * b) + 'Z"/>';
    };
    var dimH = function (x1, x2, y, yRef, txt) {
      var sgn = y > yRef ? 1 : -1, o = '';
      o += '<path class="pl-ext" d="M' + x1 + ' ' + (yRef + sgn * fs * 0.3) + 'V' + (y + sgn * fs * 0.4) + 'M' + x2 + ' ' + (yRef + sgn * fs * 0.3) + 'V' + (y + sgn * fs * 0.4) + '"/>';
      o += '<path class="pl-dim" d="M' + x1 + ' ' + y + 'H' + x2 + '"/>' + arrow(x1, y, 1, 0) + arrow(x2, y, -1, 0);
      o += '<text x="' + (x1 + x2) / 2 + '" y="' + (y - fs * 0.4) + '" font-size="' + fs + '" text-anchor="middle">' + esc(txt) + '</text>';
      return o;
    };
    var dimV = function (y1, y2, x, xRef, txt) {
      var sgn = x > xRef ? 1 : -1, o = '', cy = (y1 + y2) / 2, tx = x - fs * 0.4;
      o += '<path class="pl-ext" d="M' + (xRef + sgn * fs * 0.3) + ' ' + y1 + 'H' + (x + sgn * fs * 0.4) + 'M' + (xRef + sgn * fs * 0.3) + ' ' + y2 + 'H' + (x + sgn * fs * 0.4) + '"/>';
      o += '<path class="pl-dim" d="M' + x + ' ' + y1 + 'V' + y2 + '"/>' + arrow(x, y1, 0, 1) + arrow(x, y2, 0, -1);
      o += '<text x="' + tx + '" y="' + cy + '" font-size="' + fs + '" text-anchor="middle" transform="rotate(-90 ' + tx + ' ' + cy + ')">' + esc(txt) + '</text>';
      return o;
    };
    var title = function (x, y, txt) { return '<text class="pl-title" x="' + x + '" y="' + y + '" font-size="' + fs * 0.85 + '">' + esc(txt) + '</text>'; };
    var p = g.port, slot = p && p.shape !== 'round', pw = slot ? p.pw : 0;

    // --- Face (repère : x, H − y)
    out.push(title(0, -fs * 0.9, 'Face'));
    out.push(R(0, 0, W, H, 'pl-out'));
    out.push('<path class="pl-ext" d="M0 ' + t + 'H' + W + 'M0 ' + (H - t) + 'H' + W + 'M' + t + ' ' + t + 'V' + (H - t) + 'M' + (W - t) + ' ' + t + 'V' + (H - t) + '"/>');
    if (slot) {
      var sx0 = Math.min(X(t), X(t + pw));
      out.push(R(sx0, t, pw, H - 2 * t, 'pl-port'));
      out.push(R(Math.min(X(t + pw), X(2 * t + pw)), t, t, H - 2 * t, 'pl-wall'));
    }
    (g.subs || []).forEach(function (sb) {
      if (g.od) out.push('<circle class="pl-flange" cx="' + sb.x + '" cy="' + (H - sb.y) + '" r="' + g.od / 2 + '"/>');
      if (g.cut) out.push('<circle class="pl-hole" cx="' + sb.x + '" cy="' + (H - sb.y) + '" r="' + g.cut / 2 + '"/>');
    });
    if (p && p.shape === 'round') p.ys.forEach(function (y) {
      out.push('<circle class="pl-hole" cx="' + p.x + '" cy="' + (H - y) + '" r="' + (p.dp / 2 + p.wall) + '"/>');
      out.push('<circle class="pl-port" cx="' + p.x + '" cy="' + (H - y) + '" r="' + p.dp / 2 + '"/>');
    });
    out.push(dimH(0, W, H + off, H, lenTxt(W)));
    out.push(dimV(0, H, -off, 0, lenTxt(H)));

    // --- Côté droit (repère : z, H − y), avant à gauche
    var ox = W + gap;
    out.push(title(ox, -fs * 0.9, 'Côté'));
    out.push(R(ox, 0, Dp, H, 'pl-out'));
    out.push('<path class="pl-ext" d="M' + ox + ' ' + t + 'H' + (ox + Dp) + 'M' + ox + ' ' + (H - t) + 'H' + (ox + Dp) +
      'M' + (ox + g.tf) + ' ' + t + 'V' + (H - t) + 'M' + (ox + Dp - t) + ' ' + t + 'V' + (H - t) + '"/>');
    var mr = (g.motor || g.cut * 0.6) / 2, dep = g.depthSub || 0, ys = [];
    (g.subs || []).forEach(function (sb) { if (ys.indexOf(sb.y) < 0) ys.push(sb.y); });
    var subPath = function (u0, v, flipV, map) {      // panier + moteur en pointillé (vue de côté ou de dessus)
      var c = g.cut / 2;
      return '<path class="pl-hid" d="M' + map(g.tf, v - c) + 'L' + map(dep * 0.62, v - mr) + 'L' + map(dep, v - mr) + 'L' + map(dep, v + mr) + 'L' + map(dep * 0.62, v + mr) + 'L' + map(g.tf, v + c) + '"/>';
    };
    if (dep && g.cut) ys.forEach(function (y) { out.push(subPath(0, H - y, false, function (z, v) { return (ox + z) + ' ' + v; })); });
    out.push(dimH(ox, ox + Dp, H + off, H, lenTxt(Dp)));

    // --- Dessus en coupe à mi-hauteur (repère : x, z), avant en haut
    var oy = H + gap;
    out.push(title(0, oy - fs * 0.9, 'Dessus · coupe'));
    out.push(R(0, oy, W, Dp, 'pl-out'));
    out.push(R(t, oy + g.tf, W - 2 * t, Dp - g.tf - t, 'pl-air'));
    (g.panels || []).forEach(function (q) {
      if (q.role === 'top' || q.role === 'bottom') return;
      if (q.role === 'brace' && q.win) {
        var m = q.win.m;
        out.push(R(q.x0, oy + q.z0, m, q.z1 - q.z0, 'pl-wall'));
        out.push(R(q.x1 - m, oy + q.z0, m, q.z1 - q.z0, 'pl-wall'));
        return;
      }
      out.push(R(q.x0, oy + q.z0, q.x1 - q.x0, q.z1 - q.z0, 'pl-wall'));
    });
    if (dep && g.cut) (g.subs || []).forEach(function (sb) { out.push(subPath(0, sb.x, false, function (z, v) { return v + ' ' + (oy + z); })); });
    if (p && p.shape === 'round') p.ys.forEach(function () {
      var ro = p.dp / 2 + p.wall;
      out.push(R(p.x - ro, oy, 2 * ro, p.L, 'pl-hid'));
    });
    if (slot) {
      var cxs = t + pw / 2, zr = g.zb - pw / 2;
      var pts = p.shape === 'L' ? [[cxs, 0], [cxs, zr], [p.xe, zr]] : [[cxs, 0], [cxs, p.L]];
      out.push('<path class="pl-flow" d="M' + pts.map(function (q) { return X(q[0]) + ' ' + (oy + q[1]); }).join('L') + '"/>');
      out.push(dimH(Math.min(X(t), X(t + pw)), Math.max(X(t), X(t + pw)), oy + Dp + off, oy + Dp, lenTxt(pw)));
    }
    out.push(dimV(oy, oy + Dp, -off, 0, lenTxt(Dp)));

    var x0 = -off - fs * 1.6, y0 = -fs * 2.4 - 54 / s, x1 = W + gap + Dp + fs, y1 = oy + Dp + off + fs * 1.2;
    return { vb: [x0, y0, x1 - x0, y1 - y0], body: out.join('') };
  }
  function renderPlan() {
    if (UI.view !== 'plan' || !S.res) return;
    var g = S.res.g;
    if (!g.panels || !g.panels.length) { el.plan.innerHTML = ''; return; }
    var r = el.stage.getBoundingClientRect();
    if (!r.width) return;
    var pl = planSvg(g, r.width, r.height);
    el.plan.setAttribute('viewBox', pl.vb.join(' '));
    el.plan.innerHTML = pl.body;
  }

  /* ------------------------------------------------------------------ */
  /*  Courbes (SVG) : courant + projets superposés                       */
  /* ------------------------------------------------------------------ */
  var METRICS = {
    spl: { u: 'dB', d: 1, v: function (s, i, c) { return s.spl[i] + (c ? c[i] : 0); }, span: 42 },
    splmax: { u: 'dB', d: 1, v: function (s, i, c) { return s.splMax[i] + (c ? c[i] : 0); }, span: 42 },
    x: { u: 'mm', d: 1, v: function (s, i) { return s.x[i] * 1000; }, zero: true },
    vp: { u: 'm/s', d: 1, v: function (s, i) { return s.vp[i]; }, zero: true, vent: true },
    z: { u: 'Ω', d: 2, v: function (s, i) { return s.z[i]; }, zero: true },
    phase: { u: '°', d: 0, v: function (s, i) { return s.phaseDeg[i]; }, fixed: [-180, 180] },
    gd: { u: 'ms', d: 1, v: function (s, i) { return s.gd[i]; }, zero: true },
    pmax: { u: 'W', d: 0, v: function (s, i) { return s.pmax[i]; }, zero: true }
  };
  var SER = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
  function seriesList() {
    var out = [];
    if (S.res && S.res.sim) out.push({ key: 'cur', name: S.proj.name || 'Projet courant', sim: S.res.sim, slot: 0, dash: '', vented: D.P.type !== 'sealed' });
    return out.concat(S.overlays);
  }
  function addOverlay(o) {
    if (S.overlays.length >= 3) { if (!o.quiet) toast('3 courbes superposées au plus', 'bad'); return false; }
    var used = S.overlays.map(function (x) { return x.slot; });
    o.slot = [1, 2, 3].filter(function (s) { return used.indexOf(s) < 0; })[0];
    S.overlays.push(o);
    renderChart();
    return true;
  }
  function removeOverlay(key) {
    var n = S.overlays.length;
    S.overlays = S.overlays.filter(function (o) { return o.key !== key; });
    if (S.overlays.length !== n) renderChart();
  }
  function ticks(lo, hi, n) {
    var span = hi - lo || 1, raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    var step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p, out = [];
    for (var v = Math.floor(lo / step) * step; v <= hi + step * 0.5; v += step) { out.push(+v.toFixed(6)); if (v >= hi) break; }
    return out;
  }
  var CH = null;   // géométrie du graphique courant (survol)
  function renderChart() {
    var box = el.chart, m = METRICS[UI.metric] || METRICS.spl, list = seriesList();
    cabinUI();
    el.freeze.disabled = !(S.res && S.res.sim);
    var Wc = Math.max(280, Math.round(box.clientWidth || 480)), Hc = Math.round(Math.max(240, Math.min(380, Wc * 0.6)));
    var msg = !list.length ? (S.tsc.ok ? 'Boîte trop petite' : 'Paramètres T/S incomplets') :
      (m.vent && !list.some(function (s) { return s.vented; })) ? 'Pas d\'évent sur une boîte scellée' : '';
    if (msg) { box.innerHTML = '<p class="bx-chart-msg">' + esc(msg) + '</p>'; el.legend.innerHTML = ''; CH = null; return; }
    var fc = fcNow(), cab = UI.cabin && fc ? FQ.map(function (f) { return E.cabinGain(f, fc); }) : null;
    var data = list.map(function (s) { return m.vent && !s.vented ? null : s.sim.f.map(function (f, i) { return m.v(s.sim, i, cab); }); });
    var lo = Infinity, hi = -Infinity;
    data.forEach(function (a) { if (a) a.forEach(function (v) { if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }); });
    var refs = [], ts = S.res && S.res.ts;
    if (UI.metric === 'x' && ts && ts.Xmax) { refs.push({ v: ts.Xmax * 1000, t: 'Xmax' }); hi = Math.min(hi, ts.Xmax * 1000 * 3); hi = Math.max(hi, ts.Xmax * 1000 * 1.15); }
    if (UI.metric === 'vp') { refs.push({ v: 17, t: '17 m/s' }, { v: 26, t: '26 m/s' }); hi = Math.max(hi, 28); }
    if (UI.metric === 'pmax') { var wn = wattsNow(); refs.push({ v: wn, t: 'Ampli' }); hi = Math.min(Math.max(hi, wn * 1.2), wn * 3); }
    if (m.span) lo = Math.max(lo, hi - m.span);
    if (m.zero) lo = Math.min(0, lo);
    if (m.fixed) { lo = m.fixed[0]; hi = m.fixed[1]; }
    if (!(hi > lo)) hi = lo + 1;
    var tk = m.fixed ? [-180, -90, 0, 90, 180] : ticks(lo, hi, 5);
    lo = tk[0]; hi = tk[tk.length - 1];
    var pad = { l: 44, r: 16, t: 22, b: 30 }, f0 = FQ[0], f1 = FQ[FQ.length - 1];
    var X = function (f) { return pad.l + Math.log(f / f0) / Math.log(f1 / f0) * (Wc - pad.l - pad.r); };
    var Y = function (v) { return pad.t + (1 - (v - lo) / (hi - lo)) * (Hc - pad.t - pad.b); };
    var o = '<svg viewBox="0 0 ' + Wc + ' ' + Hc + '" role="img" aria-label="' + esc(el.metric.options[el.metric.selectedIndex].text) + '">';
    o += '<defs><clipPath id="bx-clip"><rect x="' + pad.l + '" y="' + (pad.t - 1) + '" width="' + (Wc - pad.l - pad.r) + '" height="' + (Hc - pad.t - pad.b + 2) + '"/></clipPath></defs>';
    tk.forEach(function (v) {
      var y = Y(v).toFixed(1);
      o += '<line class="' + (v === lo ? 'ax-base' : 'ax-grid') + '" x1="' + pad.l + '" x2="' + (Wc - pad.r) + '" y1="' + y + '" y2="' + y + '"/>';
      o += '<text class="ax-t" x="' + (pad.l - 6) + '" y="' + y + '" dy="0.32em" text-anchor="end">' + fmt(v, Math.abs(v) < 10 && v % 1 ? 1 : 0) + '</text>';
    });
    o += '<text class="ax-u" x="' + (pad.l - 6) + '" y="12" text-anchor="end">' + esc(m.u) + '</text>';
    [10, 20, 30, 40, 50, 60, 80, 100, 150, 200].forEach(function (f) {
      var x = X(f).toFixed(1);
      o += '<line class="ax-grid" x1="' + x + '" x2="' + x + '" y1="' + pad.t + '" y2="' + (Hc - pad.b) + '"/>';
      o += '<text class="ax-t" x="' + x + '" y="' + (Hc - pad.b + 16) + '" text-anchor="' + (f === 200 ? 'end' : 'middle') + '">' + f + (f === 200 ? ' Hz' : '') + '</text>';
    });
    refs.forEach(function (r) {
      if (r.v < lo || r.v > hi) return;
      var y = Y(r.v).toFixed(1);
      o += '<line class="ref" x1="' + pad.l + '" x2="' + (Wc - pad.r) + '" y1="' + y + '" y2="' + y + '"/>';
      o += '<text class="ref-t" x="' + (Wc - pad.r - 4) + '" y="' + (Y(r.v) - 5).toFixed(1) + '" text-anchor="end">' + esc(r.t) + '</text>';
    });
    o += '<g clip-path="url(#bx-clip)">';
    for (var si = list.length - 1; si >= 0; si--) {
      var a = data[si];
      if (!a) continue;
      var d = '';
      for (var i = 0; i < a.length; i++) {
        var v = isFinite(a[i]) ? Math.max(lo - (hi - lo), Math.min(hi + (hi - lo), a[i])) : hi + (hi - lo);
        d += (i ? 'L' : 'M') + X(FQ[i]).toFixed(1) + ' ' + Y(v).toFixed(1);
      }
      o += '<path class="sr" d="' + d + '" style="stroke:' + SER[list[si].slot] + '"' + (list[si].dash ? ' stroke-dasharray="' + list[si].dash + '"' : '') + '/>';
    }
    o += '</g><g class="bx-xh" visibility="hidden"><line class="xh" y1="' + pad.t + '" y2="' + (Hc - pad.b) + '"/>' +
      list.map(function (s, k) { return data[k] ? '<circle class="dot" r="4" style="fill:' + SER[s.slot] + '" data-k="' + k + '"/>' : ''; }).join('') + '</g>';
    o += '<rect class="bx-hit" x="' + pad.l + '" y="0" width="' + (Wc - pad.l - pad.r) + '" height="' + Hc + '" fill="transparent"/></svg>';
    o += '<div class="bx-tip" hidden></div>';
    box.innerHTML = o;
    CH = { W: Wc, H: Hc, pad: pad, X: X, Y: Y, lo: lo, hi: hi, list: list, data: data, m: m };
    el.legend.innerHTML = list.length < 2 ? '' : list.map(function (s) {
      return '<span class="bx-lg"><svg viewBox="0 0 22 8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" style="stroke:' + SER[s.slot] + '" stroke-width="2.5"' +
        (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + ' stroke-linecap="round"/></svg><span>' + esc(s.name) + '</span>' +
        (s.key !== 'cur' ? '<button type="button" data-rm="' + esc(s.key) + '" aria-label="Retirer ' + esc(s.name) + '">×</button>' : '') + '</span>';
    }).join('');
  }
  function chartHover(e) {
    if (!CH) return;
    var svg = $('svg', el.chart), tip = $('.bx-tip', el.chart), xh = $('.bx-xh', el.chart);
    if (!svg || !tip) return;
    var r = svg.getBoundingClientRect(), k = CH.W / r.width, px = (e.clientX - r.left) * k, pad = CH.pad;
    if (px < pad.l || px > CH.W - pad.r) { chartLeave(); return; }
    var u = (px - pad.l) / (CH.W - pad.l - pad.r), i = Math.max(0, Math.min(FQ.length - 1, Math.round(u * (FQ.length - 1))));
    var x = CH.X(FQ[i]);
    xh.setAttribute('visibility', 'visible');
    $('line', xh).setAttribute('x1', x); $('line', xh).setAttribute('x2', x);
    $$('circle', xh).forEach(function (c) {
      var v = CH.data[+c.getAttribute('data-k')][i], ok = isFinite(v) && v >= CH.lo && v <= CH.hi;
      c.setAttribute('visibility', ok ? 'visible' : 'hidden');
      if (ok) { c.setAttribute('cx', x); c.setAttribute('cy', CH.Y(v)); }
    });
    tip.textContent = '';
    var h = document.createElement('p'); h.className = 'bx-tip-h'; h.textContent = hz(FQ[i], FQ[i] < 100 ? 1 : 0); tip.appendChild(h);
    CH.list.forEach(function (s, kk) {
      var v = CH.data[kk] ? CH.data[kk][i] : null;
      if (v == null || !isFinite(v)) return;
      var row = document.createElement('div'), sw = document.createElement('i'), nm = document.createElement('span'), val = document.createElement('b');
      row.className = 'bx-tip-r'; sw.style.background = SER[s.slot]; nm.textContent = s.name;
      val.textContent = fmt(v, CH.m.d) + ' ' + CH.m.u;
      row.appendChild(sw); row.appendChild(nm); row.appendChild(val); tip.appendChild(row);
    });
    tip.hidden = false;
    var bw = el.chart.clientWidth, tw = tip.offsetWidth, sx = x / k, left = sx + 14;
    if (left + tw > bw) left = sx - tw - 14;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, (e.clientY - r.top) - tip.offsetHeight / 2) + 'px';
  }
  function chartLeave() {
    var tip = $('.bx-tip', el.chart), xh = $('.bx-xh', el.chart);
    if (tip) tip.hidden = true;
    if (xh) xh.setAttribute('visibility', 'hidden');
  }
  el.chart.addEventListener('pointermove', chartHover);
  el.chart.addEventListener('pointerdown', chartHover);
  el.chart.addEventListener('pointerleave', chartLeave);
  el.legend.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]');
    if (!b) return;
    var key = b.getAttribute('data-rm');
    removeOverlay(key);
  });
  el.metric.addEventListener('change', function () { UI.metric = el.metric.value; savePrefs(); renderChart(); });
  el.cabin.addEventListener('change', function () { UI.cabin = el.cabin.checked; savePrefs(); renderChart(); });
  el.freeze.addEventListener('click', function () {
    flush();
    if (!S.res || !S.res.sim) return;
    var g = S.res.g, vented = D.P.type !== 'sealed';
    addOverlay({ key: 'fz' + Date.now(), name: volTxt(g.net) + ' · ' + (vented && g.port ? hz(g.port.fb, 1) : 'scellée'), sim: S.res.sim, dash: '6 4', vented: vented });
  });
  el.overlay.addEventListener('change', function () {
    var id = el.overlay.value, sb = sbc();
    el.overlay.value = ''; pick(el.overlay);
    if (!id || !sb) return;
    if (S.overlays.some(function (o) { return o.key === 'p:' + id; })) return;
    sb.from('box_projects').select('id,name,params').eq('id', id).maybeSingle().then(function (res) {
      if (res.error || !res.data) { toast('Projet illisible' + (res.error ? ' : ' + res.error.message : ''), 'bad'); return; }
      var pr = res.data.params || {}, rec = pr.sub && pr.sub.data, tsc = E.completeTS(rec || {});
      if (!tsc.ok || !pr.D) { toast('Ce projet n\'a pas de T/S complets', 'bad'); return; }
      var d = merge(defaults(), pr.D), P = Object.assign({}, d.P, { n: d.n, coil: d.coil, link: d.link,
        watts: d.watts > 0 ? d.watts : (rec.rms || 500) * d.n, vehicle: d.vehicle, fc: d.fc });
      if (d.mode === 'vol' && d.vt > 0) P.w = E.solveDim(P, tsc.ts, 'w', d.vt, 3 * IN, 160 * IN).x;
      var sim = E.run(P, tsc.ts, { f: FQ }).sim;
      if (!sim) { toast('Ce projet ne se simule pas', 'bad'); return; }
      addOverlay({ key: 'p:' + id, name: res.data.name || 'Projet', sim: sim, dash: '6 4', vented: d.P.type !== 'sealed' });
    }, function (err) { toast('Projet illisible : ' + errMsg(err), 'bad'); });
  });

  /* ------------------------------------------------------------------ */
  /*  ⑥ Coupes                                                           */
  /* ------------------------------------------------------------------ */
  function pieceNotes(p) {
    return p.notes.map(function (n) {
      if (n.k === 'hole') return n.n + ' trou' + (n.n > 1 ? 's' : '') + ' Ø ' + lenTxt(n.d);
      if (n.k === 'win') return 'fenêtre ' + lenBare(n.w) + ' × ' + lenTxt(n.h);
      return '';
    }).filter(Boolean).join(' · ');
  }
  function sheetFig(s, i, uid) {
    var L = D.sheet.L * 1000, Wd = D.sheet.W * 1000, id = 'bx-hatch-' + uid + i, k = Math.min(L, Wd);
    var o = '<figure class="bx-sheet"><figcaption>Feuille ' + (i + 1) + ' <small>' + esc(sheetName() + ' · ' + fmt(s.use * 100, 0) + ' % utilisé') + '</small>' +
      (s.half ? '<span class="bx-pill">4 × 4 suffit</span>' : '') + '</figcaption>';
    o += '<svg viewBox="0 0 ' + L + ' ' + Wd + '" role="img" aria-label="Feuille ' + (i + 1) + '"><defs><pattern id="' + id +
      '" patternUnits="userSpaceOnUse" width="40" height="40" patternTransform="rotate(45)"><line class="sh-hl" x1="0" y1="0" x2="0" y2="40" stroke-width="5"/></pattern></defs>';
    o += '<rect class="sh-bg" x="0" y="0" width="' + L + '" height="' + Wd + '"/>';
    s.offcuts.forEach(function (q) {
      o += '<rect class="sh-off" style="fill:url(#' + id + ')" x="' + q.x * 1000 + '" y="' + q.y * 1000 + '" width="' + q.w * 1000 + '" height="' + q.h * 1000 + '"/>';
    });
    s.pieces.forEach(function (q) {
      var x = q.x * 1000, y = q.y * 1000, w = q.w * 1000, h = q.h * 1000, m = Math.min(w, h), fs = Math.max(30, Math.min(k * 0.09, m * 0.42));
      o += '<g data-l="' + esc(q.label) + '"><rect class="sh-pc" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>';
      var big = m > fs * 2.2 && w > fs * 4.5, cx = x + w / 2, cy = y + h / 2;
      o += '<text class="sh-l" x="' + cx + '" y="' + (big ? cy - fs * 0.15 : cy) + '" font-size="' + fs + '" text-anchor="middle" dominant-baseline="central">' + esc(q.label) + '</text>';
      if (big) o += '<text class="sh-d" x="' + cx + '" y="' + (cy + fs * 0.85) + '" font-size="' + fs * 0.46 + '" text-anchor="middle" dominant-baseline="central">' +
        esc(lenBare(q.w) + ' × ' + lenBare(q.h)) + '</text>';
      o += '</g>';
    });
    return o + '</svg></figure>';
  }
  function orderHtml(cut) {
    return cut.sheets.map(function (s, i) {
      return '<li><b>Feuille ' + (i + 1) + '</b><ol>' + s.steps.map(function (st) {
        var segs = st.segs.map(function (sg) {
          var stacked = sg.parts.length > 1 || sg.parts[0].acr < st.ws - 1e-6;
          var parts = sg.parts.map(function (pp) { return '<b>' + esc(pp.label) + '</b>' + (stacked ? ' ' + esc(lenTxt(pp.acr)) : ''); }).join(' + ');
          return 'tronçonner ' + esc(lenTxt(sg.len)) + ' → ' + parts;
        });
        return '<li>Bande de <b>' + esc(lenTxt(st.ws)) + '</b> : ' + segs.join(' ; ') + '</li>';
      }).join('') + '</ol></li>';
    }).join('');
  }
  function renderCuts() {
    var cut = S.res.cut, pcs = S.res.pcs;
    el.cutNote.textContent = sheetName() + ' · trait ' + lenTxt(D.sheet.kerf);
    el.cutMsg.hidden = cut.ok || !pcs.length;
    if (!cut.ok && pcs.length) el.cutMsg.textContent = 'Plus grand que la feuille : ' + cut.bad.join(', ');
    el.sheets.innerHTML = cut.ok ? cut.sheets.map(function (s, i) { return sheetFig(s, i, 'v'); }).join('') : '';
    el.cutSum.textContent = cut.ok ? sheetsTxt(cut) + ' · ' + fmt(cut.use * 100, 0) + ' %' : '';
    el.pieces.innerHTML = pcs.map(function (p) {
      return '<tr data-l="' + esc(p.label) + '"><td class="bx-pn"><span class="bx-lt">' + esc(p.label) + '</span>' + esc(p.name) + '</td><td class="num">' + p.qty +
        '</td><td class="num">' + esc(lenTxt(p.a)) + '</td><td class="num">' + esc(lenTxt(p.b)) + '</td><td class="bx-tnote">' + esc(pieceNotes(p)) + '</td></tr>';
    }).join('');
    el.order.innerHTML = cut.ok ? orderHtml(cut) : '';
    el.print.disabled = !cut.ok;
  }
  function hot(label) {
    $$('.bx-sheet g[data-l] .sh-pc', el.sheets).forEach(function (r) { r.classList.toggle('is-hot', !!label && r.parentNode.getAttribute('data-l') === label); });
  }
  el.pieces.addEventListener('pointerover', function (e) { var tr = e.target.closest('tr[data-l]'); hot(tr ? tr.getAttribute('data-l') : null); });
  el.pieces.addEventListener('pointerleave', function () { hot(null); });
  el.sheets.addEventListener('pointerover', function (e) { var gp = e.target.closest('g[data-l]'); hot(gp ? gp.getAttribute('data-l') : null); });
  el.sheets.addEventListener('pointerleave', function () { hot(null); });

  // Impression : feuille d'atelier (résumé, plan, pièces, feuilles, ordre des coupes)
  el.print.addEventListener('click', function () {
    flush();
    if (!S.res || !S.res.cut.ok) return;
    var host = $('#bx-printout');
    if (!host) { host = document.createElement('div'); host.id = 'bx-printout'; document.body.appendChild(host); }
    var g = S.res.g, cut = S.res.cut, vented = D.P.type !== 'sealed', pl = planSvg(g, 1000, 640);
    var items = [['Sub', subName(D.rec) + (D.n > 1 ? ' × ' + D.n : '')], ['Type', TYPE_NAMES[D.P.type]], ['Dimensions', dims3(g.W, g.H, g.D)],
      ['Volume net', volTxt(g.net)], vented && g.port ? ['Accord', hz(g.port.fb, 1)] : null, vented && g.port ? ['Évent', areaTxt(g.port.Sp) + ' · ' + lenTxt(g.port.L)] : null,
      ['Bois', lenTxt(D.P.t) + ' · façade ' + (D.P.layers === 2 ? 'double' : 'simple')], ['Trait de scie', lenTxt(D.sheet.kerf)]].filter(Boolean);
    host.innerHTML = '<h1>' + esc(S.proj.name || subName(D.rec)) + '</h1><div class="bx-print-sum">' +
      items.map(function (x) { return '<div><span>' + esc(x[0]) + '</span>' + esc(x[1]) + '</div>'; }).join('') + '</div>' +
      '<h2>Plan</h2><svg class="bx-plan" viewBox="' + pl.vb.join(' ') + '">' + pl.body + '</svg>' +
      '<h2>Pièces</h2><table><thead><tr><th>Pièce</th><th>Qté</th><th>Longueur</th><th>Largeur</th><th>Détail</th></tr></thead><tbody>' +
      S.res.pcs.map(function (p) { return '<tr><td>' + esc(p.label + ' · ' + p.name) + '</td><td>' + p.qty + '</td><td>' + esc(lenTxt(p.a)) + '</td><td>' + esc(lenTxt(p.b)) + '</td><td>' + esc(pieceNotes(p)) + '</td></tr>'; }).join('') +
      '</tbody></table><h2>Feuilles</h2>' + cut.sheets.map(function (s, i) { return sheetFig(s, i, 'p'); }).join('') +
      '<h2>Ordre des coupes</h2><ol class="bx-order">' + orderHtml(cut) + '</ol>';
    document.body.classList.add('bx-printing');
    var done = function () { document.body.classList.remove('bx-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 30);
  });

  /* ------------------------------------------------------------------ */
  /*  Projets (box_projects)                                             */
  /* ------------------------------------------------------------------ */
  function params() {
    var d = clone(D);
    delete d.rec;
    return { v: 1, D: d, sub: { ref: D.sub, data: clone(D.rec), dirty: S.recDirty } };
  }
  function projStatus(text) {
    var t = text || (S.proj.id ? (S.dirty ? 'modifié' : 'enregistré ✓') : (S.dirty ? 'non enregistré' : ''));
    el.projSt.textContent = t;
    el.projSt.className = 'bx-proj-st' + (!text && S.proj.id && !S.dirty ? ' is-ok' : '');
  }
  function loadProjects() {
    var sb = sbc();
    if (!sb) { fillProjects(); return; }
    sb.from('box_projects').select('id,name,updated_at').order('updated_at', { ascending: false }).then(function (res) {
      if (res.error) { toast('Projets : ' + res.error.message, 'bad'); return; }
      S.saved = res.data || [];
      fillProjects();
    }, function (err) { toast('Projets : ' + errMsg(err), 'bad'); });
  }
  function fillProjects() {
    el.plist.innerHTML = S.saved.length ? S.saved.map(function (p) {
      return '<li><button type="button" data-id="' + esc(p.id) + '"' + (p.id === S.proj.id ? ' aria-current="true"' : '') + '><span>' + esc(p.name || 'Sans nom') +
        '</span><small>' + esc(shortDay(p.updated_at)) + '</small></button></li>';
    }).join('') : '<li class="bx-menu-empty">Aucun projet enregistré.</li>';
    var others = S.saved.filter(function (p) { return p.id !== S.proj.id; });
    el.overlay.innerHTML = '<option value="">Superposer un projet</option>' + others.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name || 'Sans nom') + '</option>'; }).join('');
    el.overlay.disabled = !others.length;
    el.overlay.value = ''; pick(el.overlay);
    el.del.disabled = !S.proj.id;
  }
  function closeMenu() { el.menu.hidden = true; el.projects.setAttribute('aria-expanded', 'false'); }
  el.projects.addEventListener('click', function () {
    var open = el.menu.hidden;
    el.menu.hidden = !open; el.projects.setAttribute('aria-expanded', String(open));
    if (open) { fillProjects(); loadProjects(); }
  });
  document.addEventListener('pointerdown', function (e) { if (!el.menu.hidden && !e.target.closest('.bx-menu-wrap')) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !el.menu.hidden) { closeMenu(); el.projects.focus(); } });
  function guard(title, ok) {
    return S.dirty ? ask({ title: title, message: 'Les changements du projet courant ne sont pas enregistrés.', ok: ok }) : Promise.resolve(true);
  }
  function afterLoad() {
    S.tsc = E.completeTS(D.rec);
    S.overlays = S.overlays.filter(function (o) { return o.key !== 'prop'; });
    fillSubs(); fillWiring(false); buildTS(); syncAll(); fillProjects(); schedule();
  }
  el.plist.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-id]'), sb = sbc();
    if (!b || !sb) return;
    var id = b.getAttribute('data-id');
    closeMenu();
    guard('Ouvrir sans enregistrer ?', 'Ouvrir').then(function (ok) {
      if (!ok) return;
      sb.from('box_projects').select('id,name,params').eq('id', id).maybeSingle().then(function (res) {
        if (res.error || !res.data) { toast('Projet illisible' + (res.error ? ' : ' + res.error.message : ''), 'bad'); return; }
        var p = res.data.params || {};
        D = merge(defaults(), p.D || {});
        D.sub = (p.sub && p.sub.ref) || 'new';
        D.rec = (p.sub && p.sub.data) || libRec(DEF_SUB);
        S.proj = { id: res.data.id, name: res.data.name || '' }; S.dirty = false; S.recDirty = !!(p.sub && p.sub.dirty);
        removeOverlay('p:' + id);
        afterLoad();
      }, function (err) { toast('Projet illisible : ' + errMsg(err), 'bad'); });
    });
  });
  function saveProject() {
    flush();
    var sb = sbc();
    if (!sb) { toast('Connexion requise pour enregistrer', 'bad'); return; }
    var g = S.res && S.res.g, name = el.name.value.trim() || (subName(D.rec) + (g && g.net > 0 ? ' · ' + volTxt(g.net) : ''));
    S.proj.name = name; el.name.value = name;
    var row = { name: name, params: params(), updated_at: new Date().toISOString() };
    var q = S.proj.id ? sb.from('box_projects').update(row).eq('id', S.proj.id) : sb.from('box_projects').insert(row);
    el.save.disabled = true; projStatus('enregistrement…');
    q.select('id').single().then(function (res) {
      el.save.disabled = false;
      if (res.error) { projStatus(); toast('Projet non enregistré : ' + res.error.message, 'bad'); return; }
      S.proj.id = res.data.id; S.dirty = false;
      projStatus(); saveDraft(); loadProjects(); renderChart();
      toast('Projet enregistré');
    }, function (err) { el.save.disabled = false; projStatus(); toast('Projet non enregistré : ' + errMsg(err), 'bad'); });
  }
  el.save.addEventListener('click', saveProject);
  el.name.addEventListener('input', function () { S.proj.name = el.name.value.trim(); markDirty(); renderChart(); });
  el.newP.addEventListener('click', function () {
    closeMenu();
    guard('Nouveau projet sans enregistrer ?', 'Nouveau').then(function (ok) {
      if (!ok) return;
      var keep = { sub: D.sub, rec: D.rec, n: D.n, coil: D.coil, link: D.link, watts: D.watts, vehicle: D.vehicle, fc: D.fc };
      D = merge(defaults(), keep);
      S.proj = { id: null, name: '' }; S.dirty = false;
      S.tsc = E.completeTS(D.rec);
      if (S.tsc.ok) { try { applyProp(proposeNow()); } catch (e) {} }
      afterLoad();
    });
  });
  el.dup.addEventListener('click', function () {
    closeMenu();
    S.proj = { id: null, name: (S.proj.name || subName(D.rec)) + ' · copie' };
    el.name.value = S.proj.name;
    markDirty(); saveProject();
  });
  el.del.addEventListener('click', function () {
    var sb = sbc(), id = S.proj.id;
    closeMenu();
    if (!sb || !id) return;
    ask({ title: 'Supprimer ce projet ?', message: S.proj.name || 'Sans nom', ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
      if (!ok) return;
      sb.from('box_projects').delete().eq('id', id).then(function (res) {
        if (res.error) { toast('Suppression impossible : ' + res.error.message, 'bad'); return; }
        S.proj.id = null; S.dirty = true;
        projStatus(); saveDraft(); loadProjects();
        toast('Projet supprimé');
      }, function (err) { toast('Suppression impossible : ' + errMsg(err), 'bad'); });
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Mise en page, thème, démarrage                                     */
  /* ------------------------------------------------------------------ */
  function fitHeight() {
    if (!app.offsetParent) return;
    if (app.parentNode.clientWidth < 1500) { app.style.removeProperty('--bx-h'); return; }
    var top = app.getBoundingClientRect().top + window.scrollY, h = Math.max(640, Math.round(window.innerHeight - top - 24)) + 'px';
    if (app.style.getPropertyValue('--bx-h') !== h) app.style.setProperty('--bx-h', h);
  }
  function relayout() {
    if (!app.offsetParent) return;
    fitHeight();
    if (UI.view === '3d') draw3d(); else renderPlan();
  }
  var lastS = '', lastC = 0;
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      var r = el.stage.getBoundingClientRect(), key = Math.round(r.width) + 'x' + Math.round(r.height);
      if (!r.width || key === lastS) return;
      lastS = key; relayout();
    }).observe(el.stage);
    new ResizeObserver(function () {
      var w = Math.round(el.chart.clientWidth);
      if (!w || Math.abs(w - lastC) < 2) return;
      lastC = w; renderChart();
    }).observe(el.chart);
  }
  window.addEventListener('resize', function () { if (app.offsetParent) fitHeight(); });
  var prevOnTab = window.CA && window.CA.onTab;
  window.CA = window.CA || {};
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'boites') setTimeout(function () { fitHeight(); relayout(); renderChart(); }, 0);
  };
  new MutationObserver(function () { if (app.offsetParent) { draw3d(); renderChart(); } })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });

  // Premier passage : sans brouillon, on part d'une boîte proposée pour le sub par défaut.
  if (!draft && S.tsc.ok) { try { applyProp(proposeNow()); } catch (e) {} S.dirty = false; }
  fillVehicles(); fillSubs(); fillWiring(false); buildTS(); syncAll(); fillProjects();
  compute(); render();
  if (window.CA.onAdminReady) window.CA.onAdminReady(function () { loadSubs(); loadProjects(); });

  // Accès console / tests
  window.CA.boites = {
    state: S, prefs: UI, doc: function () { return D; },
    refresh: function () { compute(); render(); }
  };
})();
