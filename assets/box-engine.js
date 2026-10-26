/* =========================================================
   Création Audio — moteur du calculateur de boîtes (Atelier › Boîtes)
   Sans DOM (testable sous node) :
   · T/S complétés et vérifiés (Sd effectif, Bl, Qts, sensibilité) ;
   · géométrie d'une boîte rectangulaire : scellée, évent fente (droit ou
     en L, le long d'un côté) ou évent rond, façade simple ou double,
     renfort ajouré, déplacements → volume net ;
   · simulation électro-mécanique (modèle à constantes localisées) : SPL,
     SPL max, excursion, vitesse d'évent, impédance, phase, retard de groupe,
     puissance max ; gain de cabine du véhicule ;
   · assistant : objectif d'écoute + espace max → volume, accord, évent, cotes ;
   · feuilles de coupe (guillotine 3 étapes : refendre, tronçonner, refendre).
   Unités internes SI (m, m², m³, kg, s) ; air : ρ 1,18 kg/m³, c 344 m/s.
   Repère de la boîte : x = largeur (gauche → droite), y = hauteur (bas → haut),
   z = profondeur (z = 0 sur la face avant, z = D au dos).
   ========================================================= */
(function (root) {
  'use strict';

  var RHO = 1.18, C = 344, RC2 = RHO * C * C, TAU = 2 * Math.PI;
  var IN = 0.0254, FT3 = Math.pow(0.3048, 3), L = 0.001, CM2 = 1e-4;

  function num(v) {
    if (typeof v === 'string') v = parseFloat(v.replace(',', '.'));
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  function pos(v) { v = num(v); return v != null && v > 0 ? v : null; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function round(v, d) { var m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
  // nombre affiché à la québécoise (virgule décimale)
  function fr(x, d) { return String(round(x, d == null ? 2 : d)).replace('.', ','); }

  /* ------------------------------------------------------------------ */
  /*  Paramètres T/S                                                     */
  /* ------------------------------------------------------------------ */
  // Fiche (unités de saisie) : Re Ω, Le mH, Fs Hz, Vas L, Sd cm², Mms g, Cms mm/N,
  // Bl T·m, Xmax mm, spl dB 1 W/1 m, rms W ; coils 1|2, zc Ω/bobine, wiring = câblage
  // des T/S publiés (series | parallel) ; dimensions en pouces, disp en pi³.
  // Retour : ts en SI (valeurs « par sub tel que publié ») + notes { k, t } + ok.
  function completeTS(raw) {
    var r = raw || {}, notes = [], d = {};
    var Re = pos(r.Re), Fs = pos(r.Fs), Qms = pos(r.Qms), Qes = pos(r.Qes), Qts = pos(r.Qts);
    var Vas = pos(r.Vas), Sd = pos(r.Sd), Mms = pos(r.Mms), Cms = pos(r.Cms), Bl = pos(r.Bl), Le = pos(r.Le), spl = pos(r.spl);
    if (Vas) Vas *= L; if (Sd) Sd *= CM2; if (Mms) Mms *= 1e-3; if (Cms) Cms *= 1e-3; if (Le) Le *= 1e-3;
    var note = function (k, t) { notes.push({ k: k, t: t }); };

    if (!Qes && Qts && Qms && Qms > Qts) { Qes = Qts * Qms / (Qms - Qts); note('qes', 'Qes déduit de Qts et Qms'); }
    if (!Qms && Qts && Qes && Qes > Qts) { Qms = Qts * Qes / (Qes - Qts); note('qms', 'Qms déduit de Qts et Qes'); }
    var w = Fs ? TAU * Fs : 0;

    // masse et compliance : Mms (mesurée) fait foi, Cms publiée est souvent arrondie
    if (w && Mms) Cms = 1 / (w * w * Mms);
    else if (w && Cms) Mms = 1 / (w * w * Cms);
    else if (w && Vas && Sd) { Cms = Vas / (RC2 * Sd * Sd); Mms = 1 / (w * w * Cms); }

    // Vas absent : déduit de la sensibilité (η0 = 4π²/c³ · Fs³ · Vas / Qes)
    if (!Vas && spl && Fs && Qes && !Cms) {
      var eta = Math.pow(10, (spl - 112.1) / 10);
      Vas = eta * C * C * C * Qes / (4 * Math.PI * Math.PI * Fs * Fs * Fs);
      note('vas', 'Vas déduit de la sensibilité (non publié)');
      if (Sd) { Cms = Vas / (RC2 * Sd * Sd); Mms = 1 / (w * w * Cms); }
    }

    // Sd effectif : Vas = ρc²·Sd²·Cms. Beaucoup de fiches donnent la surface nominale.
    if (Vas && Cms) {
      var sdv = Math.sqrt(Vas / (RC2 * Cms));
      if (!Sd) { Sd = sdv; note('sd', 'Sd déduit de Vas et Mms'); }
      else if (Math.abs(sdv / Sd - 1) > 0.1) {
        note('sd', 'Sd publié ' + round(Sd / CM2, 1) + ' cm² ≠ effectif ' + round(sdv / CM2, 0) + ' cm² (d\'après Vas et Mms) : effectif utilisé');
        d.sdPub = Sd; Sd = sdv;
      }
    } else if (!Vas && Cms && Sd) Vas = RC2 * Sd * Sd * Cms;

    // force motrice : cohérente avec Qes (Qes = ω·Mms·Re / Bl²)
    if (w && Mms && Re && Qes) {
      var blq = Math.sqrt(w * Mms * Re / Qes);
      if (Bl && Math.abs(blq / Bl - 1) > 0.12) note('bl', 'Bl publié ' + round(Bl, 2) + ' ≠ ' + round(blq, 2) + ' (d\'après Qes, Mms, Re)');
      d.blPub = Bl; Bl = blq;
    } else if (w && Mms && Re && Bl && !Qes) { Qes = w * Mms * Re / (Bl * Bl); note('qes', 'Qes déduit de Bl, Mms et Re'); }

    var Rms = w && Mms && Qms ? w * Mms / Qms : null;
    var qts = Qes && Qms ? Qes * Qms / (Qes + Qms) : Qts;
    if (Qts && qts && Math.abs(qts / Qts - 1) > 0.06) note('qts', 'Qts publié ' + Qts + ' ≠ ' + round(qts, 3) + ' (d\'après Qes et Qms)');

    var ts = {
      Re: Re, Le: Le || 0, Fs: Fs, Qms: Qms, Qes: Qes, Qts: qts, Vas: Vas, Sd: Sd, Mms: Mms, Cms: Cms, Bl: Bl, Rms: Rms,
      Xmax: pos(r.Xmax) ? r.Xmax * 1e-3 : null, Xmech: pos(r.Xmech) ? r.Xmech * 1e-3 : null,
      rms: pos(r.rms), coils: +r.coils === 1 ? 1 : 2, zc: pos(r.zc) || 4, wiring: r.wiring === 'parallel' ? 'parallel' : 'series',
      cutout: pos(r.cutout) ? r.cutout * IN : null, od: pos(r.od) ? r.od * IN : null, depth: pos(r.depth) ? r.depth * IN : null,
      motor: pos(r.motor) ? r.motor * IN : null, disp: num(r.disp) != null && r.disp >= 0 ? r.disp * FT3 : null,
      sdPub: d.sdPub || null, blPub: d.blPub || null
    };
    if (!Le) note('le', 'Le inconnue : 0 mH');
    if (ts.Re && ts.Fs && ts.Qes && ts.Vas && ts.Sd && ts.Bl) {
      var eta0 = 4 * Math.PI * Math.PI / (C * C * C) * Fs * Fs * Fs * Vas / Qes;
      ts.splCalc = 112.1 + 10 * Math.log10(eta0);
      var at283 = ts.splCalc + 10 * Math.log10(8 / ts.Re);
      if (spl && Math.abs(ts.splCalc - spl) > 1.5) {
        if (Math.abs(at283 - spl) <= 1.5) note('spl283', 'Sensibilité publiée à 2,83 V (' + round(ts.splCalc, 1) + ' dB à 1 W)');
        else note('spl', 'Sensibilité publiée ' + spl + ' dB ≠ calculée ' + round(ts.splCalc, 1) + ' dB');
      }
    }
    ts.ebp = ts.Fs && ts.Qes ? ts.Fs / ts.Qes : null;
    var missing = [];
    ['Re', 'Fs', 'Qes', 'Qms', 'Vas', 'Sd', 'Mms', 'Bl'].forEach(function (k) { if (!ts[k]) missing.push(k); });
    return { ts: ts, notes: notes, ok: !missing.length, missing: missing };
  }

  // Câblage des bobines d'un sub (les T/S publiés sont ramenés à une bobine).
  function wired(ts, coil) {
    var o = Object.assign({}, ts), k = ts.coils === 1 ? 1 : 2;
    if (k === 1) { o.zNom = ts.zc; return o; }
    var re1, bl1, le1;
    if (ts.wiring === 'parallel') { re1 = ts.Re * 2; bl1 = ts.Bl; le1 = ts.Le * 2; }
    else { re1 = ts.Re / 2; bl1 = ts.Bl / 2; le1 = ts.Le / 2; }
    if (coil === 'parallel') { o.Re = re1 / 2; o.Bl = bl1; o.Le = le1 / 2; o.zNom = ts.zc / 2; }
    else { o.Re = re1 * 2; o.Bl = bl1 * 2; o.Le = le1 * 2; o.zNom = ts.zc * 2; }
    return o;
  }

  // Charge vue par l'ampli + tension par sub. link = câblage des subs entre eux.
  function electrical(ts, n, coil, link, watts) {
    var w = wired(ts, coil), zs = w.zNom;
    var z = link === 'series' ? zs * n : zs / n;
    var v = Math.sqrt(Math.max(watts, 0) * z);
    return { ts: w, zSub: zs, zLoad: z, vAmp: v, vSub: link === 'series' ? v / n : v };
  }

  // Toutes les combinaisons de câblage pour n subs (charge finale en Ω).
  function wirings(ts, n) {
    var out = [], coils = ts.coils === 1 ? ['series'] : ['series', 'parallel'], links = n > 1 ? ['parallel', 'series'] : ['parallel'];
    coils.forEach(function (c) { links.forEach(function (l) { out.push({ coil: c, link: l, z: electrical(ts, n, c, l, 1).zLoad }); }); });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  Géométrie                                                          */
  /* ------------------------------------------------------------------ */
  var M_EDGE = 0.25 * IN;      // bois laissé autour d'une découpe
  var CLEAR = 0.5 * IN;        // jeu derrière un moteur / bout d'évent minimal

  // P : { type: sealed|slot|round, w, h, d, t, layers 1|2, n, fb, brace, stuff 0..1,
  //       port: { side: left|right, pw (fente), dp (rond, Ø int.), np, wall, flare, k } }
  // sub : ts complétés (cutout, od, depth, motor, disp en SI).
  function geometry(P, sub) {
    var W = P.w, H = P.h, D = P.d, t = P.t, layers = P.layers === 2 ? 2 : 1, tf = layers * t, n = P.n || 1;
    var g = { W: W, H: H, D: D, t: t, tf: tf, layers: layers, n: n, type: P.type, warn: [], err: [], errK: {} };
    g.iw = W - 2 * t; g.ih = H - 2 * t; g.id = D - tf - t; g.zb = D - t;
    if (!(g.iw > 0 && g.ih > 0 && g.id > 0)) { fail(g, 'size', 'Boîte trop petite pour l\'épaisseur du bois'); g.ok = false; g.net = 0; g.panels = []; return g; }
    g.gross = g.iw * g.ih * g.id;
    var vented = P.type === 'slot' || P.type === 'round';
    var pp = P.port || {}, side = pp.side === 'right' ? 'right' : 'left';
    var pw = P.type === 'slot' ? Math.max(pos(pp.pw) || IN, 0.25 * IN) : 0;
    g.side = side;

    // façade : entre les côtés (et le mur d'évent pour une fente)
    var bx0 = t, bx1 = W - t;
    if (P.type === 'slot') bx0 = 2 * t + pw;
    g.baffle = { x0: bx0, x1: bx1, w: bx1 - bx0 };

    // ---- subs sur la façade (repère gauche ; la fente est à gauche)
    var cut = sub.cutout || 0, od = sub.od || cut * 1.1, depth = sub.depth || 0, motor = sub.motor || cut * 0.6;
    var flL = P.type === 'slot' ? t + pw : 0, flR = W;             // bord de collerette permis
    var cuL = bx0 + M_EDGE, cuR = bx1 - M_EDGE;                     // bord de découpe permis
    var rp = null;
    if (P.type === 'round') {
      var dp = pos(pp.dp) || 4 * IN, np = clamp(Math.round(pp.np || 1), 1, 4), wall = num(pp.wall) != null ? pp.wall : 0.25 * IN;
      var ro = dp / 2 + wall + (pp.flare ? 0.75 * IN : 0);           // rayon extérieur (lèvre comprise)
      var colX = W - t - M_EDGE - ro;
      rp = { dp: dp, np: np, wall: wall, ro: ro, flare: !!pp.flare, x: colX, ys: [] };
      for (var i = 0; i < np; i++) rp.ys.push(H / 2 + (i - (np - 1) / 2) * (2 * ro + 0.5 * IN));
      if (np * 2 * ro + (np - 1) * 0.5 * IN > g.ih) fail(g, 'height', 'Évents ronds trop nombreux pour la hauteur');
      flR = colX - ro - 0.25 * IN; cuR = Math.min(cuR, flR);
    }
    var rows = 1;
    if (n === 4 && (n * od > flR - flL) && 2 * od + 0.25 * IN <= H) rows = 2;
    var perRow = Math.ceil(n / rows), span = flR - flL, pitch = span / perRow;
    g.subs = [];
    for (var s = 0; s < n; s++) {
      var row = Math.floor(s / perRow), col = s % perRow;
      g.subs.push({ x: flL + pitch * (col + 0.5), y: rows === 1 ? H / 2 : (row === 0 ? H / 2 + (od / 2 + 0.125 * IN) : H / 2 - (od / 2 + 0.125 * IN)) });
    }
    g.rows = rows; g.od = od; g.cut = cut; g.depthSub = depth; g.motor = motor;
    if (cut) {
      if (pitch < od + 0.125 * IN) fail(g, 'width', (n > 1 ? 'Les subs ne tiennent pas côte à côte' : rp ? 'Le sub et l\'évent ne tiennent pas sur la façade' : 'Façade trop étroite pour le sub') + ' : élargis la boîte');
      else if (g.subs.length && (g.subs[0].x - cut / 2 < cuL || g.subs[perRow - 1].x + cut / 2 > cuR)) fail(g, 'width', 'Découpe trop près du bord de la façade');
      if (rows === 1 && cut > g.ih - 2 * M_EDGE) fail(g, 'height', 'Découpe plus haute que la façade : hausse la boîte');
      if (rows === 1 && od > H) fail(g, 'height', 'Collerette plus haute que la boîte');
    }

    // ---- déplacements
    g.dispSubs = n * (sub.disp || 0);
    g.brace = null;
    var brace0 = 0;
    if (P.brace && depth) {
      var zr = depth + CLEAR, bt = t;
      var winM = Math.max(1.5 * IN, 0.15 * Math.min(g.baffle.w, g.ih));
      var ww = g.baffle.w - 2 * winM, wh = g.ih - 2 * winM, rr = Math.min(IN, ww / 2, wh / 2);
      if (ww > 0 && wh > 0) {
        g.brace = { z0: zr, z1: zr + bt, x0: bx0, x1: bx1, win: { w: ww, h: wh, r: rr, m: winM } };
        brace0 = bt * (g.baffle.w * g.ih - (ww * wh - (4 - Math.PI) * rr * rr));
      }
    }
    g.dispBrace = brace0;

    // ---- évent
    var Vn = g.gross - g.dispSubs - brace0;
    g.port = null; g.dispPort = 0;
    if (vented && P.fb > 0) {
      var k = num(pp.k) != null ? pp.k : 0.732, port, Lp = 0, it;
      var Sp, Deq;
      if (P.type === 'slot') { Sp = pw * g.ih; Deq = 2 * Math.sqrt(Sp / Math.PI); }
      else { Sp = rp.np * Math.PI * rp.dp * rp.dp / 4; Deq = rp.dp; }
      var lenFor = function (V) { return C * C * Sp / (Math.pow(TAU * P.fb, 2) * V) - k * Deq; };
      for (it = 0; it < 40; it++) {
        var Lnew = Math.min(Math.max(lenFor(Math.max(Vn, 1e-5)), tf), g.zb + W + H);   // bornée : sans volume, la longueur théorique explose
        port = P.type === 'slot' ? slotLayout(g, pw, Lnew) : roundLayout(g, rp, Lnew);
        var Vnew = g.gross - g.dispSubs - brace0 - port.disp;
        if (Math.abs(Lnew - Lp) < 1e-5 && Math.abs(Vnew - Vn) < 1e-7) { Vn = Vnew; Lp = Lnew; break; }
        Lp = Lnew; Vn = Vnew;
      }
      port.Sp = Sp; port.Deq = Deq; port.k = k; port.Leff = Lp + k * Deq; port.L = Lp;
      port.fb = C / TAU * Math.sqrt(Sp / (Math.max(Vn, 1e-6) * port.Leff));
      if (lenFor(Math.max(Vn, 1e-5)) < tf) g.warn.push('Évent plus court que la façade : accord réel ' + fr(port.fb, 1) + ' Hz');
      if (!port.ok) fail(g, 'port', port.msg);
      g.port = port; g.dispPort = port.disp;
      // l'évent en L longe le dos : le renfort et les moteurs doivent rester devant
      var zLimit = port.shape === 'L' ? g.zb - pw - t : g.zb;
      if (P.type === 'round') zLimit = g.zb;
      if (depth && depth + CLEAR > zLimit) fail(g, 'depth', port.shape === 'L' ? 'Le moteur touche le retour de l\'évent : approfondis la boîte' : 'Boîte trop peu profonde pour le sub');
      if (g.brace && g.brace.z1 + CLEAR > zLimit) { g.warn.push('Pas de place pour le renfort derrière les moteurs'); Vn += brace0; g.dispBrace = 0; g.brace = null; }
    } else if (depth && depth + CLEAR > g.zb) fail(g, 'depth', 'Boîte trop peu profonde pour le sub');
    if (!vented && g.brace && g.brace.z1 + CLEAR > g.zb) { g.warn.push('Pas de place pour le renfort derrière les moteurs'); Vn += brace0; g.dispBrace = 0; g.brace = null; }

    g.net = Vn;
    if (Vn <= 0) fail(g, 'net', 'Volume net nul : la boîte est trop petite');
    g.ok = !g.err.length;
    g.panels = panels(g, P);
    return g;
  }

  // erreur bloquante + son code (size | width | height | depth | port | net) pour l'assistant
  function fail(g, k, msg) { g.err.push(msg); g.errK[k] = true; }

  // Fente le long du côté gauche, pleine hauteur intérieure. Longueur = axe central.
  function slotLayout(g, pw, Lc) {
    var t = g.t, ih = g.ih, zb = g.zb, tf = g.tf, o = { shape: 'straight', pw: pw, ok: true };
    var straightMax = zb - pw;                         // garde un jeu = largeur de fente au fond
    if (Lc <= straightMax) {
      o.wall1 = Lc; o.wall2 = 0; o.legs = [Lc];
      o.disp = (pw + t) * ih * Math.max(Lc - tf, 0);
      return o;
    }
    o.shape = 'L';
    var L1 = zb - pw / 2, L2 = Math.max(Lc - L1, 0);
    var xe = t + pw / 2 + L2;
    o.xe = xe; o.legs = [L1, L2];
    o.wall1 = zb - pw - t;                             // mur parallèle au côté
    o.wall2 = Math.max(xe - (t + pw), t);              // retour parallèle au dos
    var xMax = g.W - t - pw;
    if (t + pw + o.wall2 > xMax) { o.ok = false; o.msg = 'Évent trop long pour la boîte : élargis-la, monte l\'accord ou réduis la fente'; }
    var air = pw * ih * Math.max((zb - pw) - tf, 0) + pw * ih * Math.max(t + pw + o.wall2 - t, 0);
    var wall = t * ih * Math.max(o.wall1 - tf, 0) + t * ih * o.wall2;
    o.disp = air + wall;
    return o;
  }

  function roundLayout(g, rp, Lp) {
    var o = { shape: 'round', ok: true, np: rp.np, dp: rp.dp, wall: rp.wall, flare: rp.flare, x: rp.x, ys: rp.ys, ro: rp.ro };
    var dOut = rp.dp + 2 * rp.wall;
    o.disp = rp.np * Math.PI * dOut * dOut / 4 * Math.max(Lp - g.tf, 0);
    if (Lp > g.zb - 0.5 * rp.dp) { o.ok = false; o.msg = 'Évent rond trop long pour la profondeur : passe en fente ou monte l\'accord'; }
    o.legs = [Lp];
    return o;
  }

  // Panneaux (repère gauche, puis miroir si la fente est à droite).
  function panels(g, P) {
    var W = g.W, H = g.H, D = g.D, t = g.t, out = [];
    var add = function (o) { out.push(o); };
    add({ role: 'bottom', name: 'Dessous', x0: 0, x1: W, y0: 0, y1: t, z0: 0, z1: D, cut: [W, D], ex: [0, -1, 0] });
    add({ role: 'top', name: 'Dessus', x0: 0, x1: W, y0: H - t, y1: H, z0: 0, z1: D, cut: [W, D], ex: [0, 1, 0] });
    add({ role: 'side', name: 'Côté gauche', x0: 0, x1: t, y0: t, y1: H - t, z0: 0, z1: D, cut: [D, H - 2 * t], ex: [-1, 0, 0] });
    add({ role: 'side', name: 'Côté droit', x0: W - t, x1: W, y0: t, y1: H - t, z0: 0, z1: D, cut: [D, H - 2 * t], ex: [1, 0, 0] });
    add({ role: 'back', name: 'Arrière', x0: t, x1: W - t, y0: t, y1: H - t, z0: D - t, z1: D, cut: [W - 2 * t, H - 2 * t], ex: [0, 0, 1] });
    var holes = (g.subs || []).map(function (s) { return { x: s.x, y: s.y, r: g.cut / 2 }; });
    if (g.port && g.port.shape === 'round') g.port.ys.forEach(function (y) { holes.push({ x: g.port.x, y: y, r: g.port.dp / 2 + g.port.wall }); });
    for (var i = 0; i < g.layers; i++) {
      add({ role: 'baffle', name: g.layers > 1 ? 'Façade ' + (i + 1) : 'Façade', layer: i, x0: g.baffle.x0, x1: g.baffle.x1, y0: t, y1: H - t,
        z0: i * t, z1: (i + 1) * t, cut: [g.baffle.w, H - 2 * t], holes: holes, ex: [0, 0, -1 - (g.layers - 1 - i) * 0.6] });
    }
    var p = g.port;
    if (p && p.shape !== 'round') {
      add({ role: 'port', name: 'Mur d\'évent', x0: t + p.pw, x1: 2 * t + p.pw, y0: t, y1: H - t, z0: 0, z1: p.wall1, cut: [p.wall1, H - 2 * t], ex: [0.25, 0, -0.2] });
      if (p.shape === 'L') add({ role: 'port', name: 'Retour d\'évent', x0: t + p.pw, x1: t + p.pw + p.wall2, y0: t, y1: H - t,
        z0: g.zb - p.pw - t, z1: g.zb - p.pw, cut: [p.wall2, H - 2 * t], ex: [0.2, 0, 0.35] });
    }
    if (g.brace) {
      var b = g.brace;
      add({ role: 'brace', name: 'Renfort', x0: b.x0, x1: b.x1, y0: t, y1: H - t, z0: b.z0, z1: b.z1, cut: [b.x1 - b.x0, H - 2 * t], win: b.win, ex: [0, 0, 0.15] });
    }
    if (g.side === 'right') out.forEach(function (q) {
      var a = W - q.x1, b2 = W - q.x0; q.x0 = a; q.x1 = b2; q.ex = [-q.ex[0], q.ex[1], q.ex[2]];
      if (q.name === 'Côté gauche') q.name = 'Côté droit'; else if (q.name === 'Côté droit') q.name = 'Côté gauche';
      if (q.holes) q.holes = q.holes.map(function (h) { return { x: W - h.x, y: h.y, r: h.r }; });
    });
    if (g.side === 'right') {
      (g.subs || []).forEach(function (s) { s.x = W - s.x; });
      if (g.port && g.port.shape === 'round') g.port.x = W - g.port.x;
      g.baffle = { x0: W - g.baffle.x1, x1: W - g.baffle.x0, w: g.baffle.w };
    }
    return out;
  }

  // Pièces à couper (regroupées), lettre A, B, C…
  function pieces(g) {
    var groups = [], key = function (p) { return p.role + ':' + round(Math.max(p.cut[0], p.cut[1]) * 1e4) + 'x' + round(Math.min(p.cut[0], p.cut[1]) * 1e4); };
    var names = { bottom: 'Dessus / dessous', top: 'Dessus / dessous', side: 'Côtés', back: 'Arrière', baffle: 'Façade', port: null, brace: 'Renfort' };
    (g.panels || []).forEach(function (p) {
      var role = p.role === 'top' ? 'bottom' : p.role, k = key({ role: role, cut: p.cut });
      var grp = groups.filter(function (x) { return x.k === k; })[0];
      if (!grp) {
        grp = { k: k, role: role, name: names[p.role] || p.name, a: Math.max(p.cut[0], p.cut[1]), b: Math.min(p.cut[0], p.cut[1]), qty: 0, notes: [] };
        if (p.role === 'baffle' && p.holes && p.holes.length) {
          var subH = (g.subs || []).length, ports = p.holes.length - subH;
          if (subH) grp.notes.push({ k: 'hole', n: subH, d: g.cut });
          if (ports > 0) grp.notes.push({ k: 'hole', n: ports, d: p.holes[p.holes.length - 1].r * 2 });
        }
        if (p.role === 'brace') grp.notes.push({ k: 'win', w: p.win.w, h: p.win.h });
        groups.push(grp);
      }
      grp.qty++;
    });
    groups.forEach(function (x, i) { x.label = String.fromCharCode(65 + i); });
    return groups;
  }

  // Résout une cote (w | h | d) pour atteindre un volume net visé (bissection).
  function solveDim(P, sub, dim, vTarget, lo, hi) {
    lo = lo || 4 * IN; hi = hi || 120 * IN;
    var f = function (x) { var Q = Object.assign({}, P); Q[dim] = x; var g = geometry(Q, sub); return (g.net || 0) - vTarget; };
    if (f(hi) < 0) return { ok: false, x: hi };
    if (f(lo) > 0) return { ok: true, x: lo };
    for (var i = 0; i < 60; i++) { var m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
    return { ok: true, x: (lo + hi) / 2 };
  }

  /* ------------------------------------------------------------------ */
  /*  Gain de cabine                                                     */
  /* ------------------------------------------------------------------ */
  var VEHICLES = [
    { id: 'none', name: 'Aucun', fc: 0 },
    { id: 'compact', name: 'Compacte', fc: 65 },
    { id: 'sedan', name: 'Berline', fc: 55 },
    { id: 'suv', name: 'VUS', fc: 45 },
    { id: 'pickup', name: 'Pick-up', fc: 70 },
    { id: 'van', name: 'Fourgonnette', fc: 40 }
  ];
  // +12 dB/octave sous fc, plafonné (cap dB) ; 0 dB au-dessus.
  function cabinGain(f, fc, cap) {
    if (!fc) return 0;
    cap = cap == null ? 20 : cap;
    var fl = fc / Math.pow(10, cap / 40);
    return 10 * Math.log10((1 + Math.pow(fc / f, 4)) / (1 + Math.pow(fl / f, 4)));
  }

  /* ------------------------------------------------------------------ */
  /*  Simulation                                                         */
  /* ------------------------------------------------------------------ */
  function freqs(fmin, fmax, n) {
    var out = [], a = Math.log(fmin), b = Math.log(fmax);
    for (var i = 0; i < n; i++) out.push(Math.exp(a + (b - a) * i / (n - 1)));
    return out;
  }

  // S : { ts (complétés), n, coil, link, watts, type, vb (net total m³), fb, Sp, Leff,
  //       ql, qa, qp, stuff, fc (cabine), cap, f: [Hz] }
  function simulate(S) {
    var e = electrical(S.ts, S.n, S.coil, S.link, S.watts), ts = e.ts, n = S.n;
    var Re = ts.Re, Le = ts.Le || 0, Bl = ts.Bl, Mms = ts.Mms, Cms = ts.Cms, Rms = ts.Rms, Sd = ts.Sd, V = e.vSub;
    var vented = S.type === 'slot' || S.type === 'round';
    var vb = S.vb / n;                                         // une boîte par sub (équivalent exact)
    if (!vented && S.stuff) vb *= 1 + 0.2 * S.stuff;           // rembourrage : volume apparent +20 % à 100 %
    var Cab = vb / RC2;
    var Sp = vented ? S.Sp / n : 0, Map = vented ? RHO * S.Leff / Sp : 0;
    var fb = vented ? 1 / (TAU * Math.sqrt(Map * Cab)) : (ts.Fs * Math.sqrt(1 + ts.Vas / vb));
    var wb = TAU * fb;
    var qa = S.qa || 100, ql = S.ql || (vented ? 10 : 100), qp = S.qp || 100;
    if (!vented && S.stuff) qa = Math.exp(Math.log(qa) + (Math.log(10) - Math.log(qa)) * S.stuff);
    var Rab = 1 / (wb * Cab * qa), Ral = ql / (wb * Cab), Rap = vented ? wb * Map / qp : 0;
    var f = S.f || freqs(10, 200, 240), N = f.length;
    var out = { f: f, spl: [], phase: [], x: [], vp: [], z: [], zph: [], pmax: [], splMax: [], gd: [], fb: fb,
      vAmp: e.vAmp, vSub: V, zLoad: e.zLoad, zSub: e.zSub, Re: Re };
    var pTh = n * (S.ts.rms || 1e9), P = Math.max(S.watts, 1e-9);
    for (var i = 0; i < N; i++) {
      var w = TAU * f[i];
      // impédances (paires [re, im])
      var zeR = Re, zeI = w * Le;
      var zmR = Rms, zmI = w * Mms - 1 / (w * Cms);
      // charge acoustique arrière
      var zcR = Rab, zcI = -1 / (w * Cab);                   // compliance + amortissement
      var yR, yI, den;
      den = zcR * zcR + zcI * zcI; yR = zcR / den; yI = -zcI / den;
      yR += 1 / Ral;
      var zpR = 0, zpI = 0;
      if (vented) { zpR = Rap; zpI = w * Map; den = zpR * zpR + zpI * zpI; yR += zpR / den; yI += -zpI / den; }
      den = yR * yR + yI * yI;
      var zaR = yR / den, zaI = -yI / den;
      // mécanique totale
      var s2 = Sd * Sd, zmtR = zmR + s2 * zaR, zmtI = zmI + s2 * zaI;
      // D = Ze·Zmt + Bl²
      var dR = zeR * zmtR - zeI * zmtI + Bl * Bl, dI = zeR * zmtI + zeI * zmtR;
      den = dR * dR + dI * dI;
      var uR = Bl * V * dR / den, uI = -Bl * V * dI / den;    // vitesse du cône
      var udR = Sd * uR, udI = Sd * uI;
      // pression dans la boîte pb = −Ud·Za
      var pbR = -(udR * zaR - udI * zaI), pbI = -(udR * zaI + udI * zaR);
      var ulR = pbR / Ral, ulI = pbI / Ral, upR = 0, upI = 0;
      if (vented) { den = zpR * zpR + zpI * zpI; upR = (pbR * zpR + pbI * zpI) / den; upI = (pbI * zpR - pbR * zpI) / den; }
      var urR = n * (udR + upR + ulR), urI = n * (udI + upI + ulI);
      var pm = w * RHO * Math.sqrt(urR * urR + urI * urI) / TAU;   // |p| à 1 m, demi-espace
      var spl = 20 * Math.log10(Math.max(pm, 1e-12) / 2e-5);
      var ph = Math.atan2(urR, -urI);                             // arg(j·Ur)
      var xp = Math.SQRT2 * Math.sqrt(uR * uR + uI * uI) / w;
      var vp = vented ? Math.SQRT2 * Math.sqrt(upR * upR + upI * upI) / Sp : 0;
      // impédance d'un sub : Ze + Bl²/Zmt
      den = zmtR * zmtR + zmtI * zmtI;
      var zR = zeR + Bl * Bl * zmtR / den, zI = zeI - Bl * Bl * zmtI / den;
      var zl = S.link === 'series' ? n : 1 / n;
      out.spl.push(spl); out.phase.push(ph); out.x.push(xp); out.vp.push(vp);
      out.z.push(Math.sqrt(zR * zR + zI * zI) * zl); out.zph.push(Math.atan2(zI, zR) * 180 / Math.PI);
      var px = ts.Xmax ? P * Math.pow(ts.Xmax / xp, 2) : Infinity;
      var pl = Math.min(px, pTh);
      out.pmax.push(pl);
      out.splMax.push(spl + 10 * Math.log10(Math.min(P, pl) / P));
    }
    // phase déroulée + retard de groupe
    var un = out.phase.slice();
    for (i = 1; i < N; i++) { var dd = un[i] - un[i - 1]; while (dd > Math.PI) { un[i] -= TAU; dd -= TAU; } while (dd < -Math.PI) { un[i] += TAU; dd += TAU; } }
    for (i = 0; i < N; i++) {
      var a = Math.max(i - 1, 0), b = Math.min(i + 1, N - 1);
      out.gd.push(-(un[b] - un[a]) / (TAU * (f[b] - f[a])) * 1000);
    }
    out.phaseDeg = un.map(function (p) { var d = p * 180 / Math.PI; while (d > 180) d -= 360; while (d < -180) d += 360; return d; });
    // cabine
    out.cabin = f.map(function (x) { return cabinGain(x, S.fc || 0, S.cap); });
    // niveau de bande passante (Le = 0) et F3
    var eta0 = 4 * Math.PI * Math.PI / (C * C * C) * ts.Fs * ts.Fs * ts.Fs * ts.Vas / ts.Qes;
    out.splPass = 112.1 + 10 * Math.log10(eta0 * V * V / Re) + 20 * Math.log10(n);
    out.f3 = null;
    for (i = 0; i < N; i++) if (out.spl[i] >= out.splPass - 3) { out.f3 = i ? f[i - 1] + (f[i] - f[i - 1]) * (out.splPass - 3 - out.spl[i - 1]) / (out.spl[i] - out.spl[i - 1]) : f[0]; break; }
    if (!vented) { out.fc = fb; out.qtc = ts.Qts * Math.sqrt(1 + ts.Vas / vb); }
    return out;
  }

  // Simulation directe d'un projet (P + sub complété) : géométrie + courbes.
  function run(P, sub, opt) {
    opt = opt || {};
    var g = geometry(P, sub);
    var veh = VEHICLES.filter(function (v) { return v.id === P.vehicle; })[0];
    var fc = P.vehicle === 'custom' ? (P.fc || 0) : (veh ? veh.fc : 0);
    var res = { g: g, sim: null };
    if (!(g.net > 0) || !sub.Re) return res;
    var vented = P.type === 'slot' || P.type === 'round';
    res.sim = simulate({
      ts: sub, n: P.n || 1, coil: P.coil, link: P.link, watts: P.watts || 0, type: P.type,
      vb: g.net, Sp: vented && g.port ? g.port.Sp : 0, Leff: vented && g.port ? g.port.Leff : 0,
      ql: P.ql, qa: P.qa, qp: P.qp, stuff: P.type === 'sealed' ? (P.stuff || 0) : 0, fc: fc, cap: P.cap,
      f: opt.f || freqs(opt.fmin || 10, opt.fmax || 200, opt.n || 240)
    });
    return res;
  }

  /* ------------------------------------------------------------------ */
  /*  Assistant                                                          */
  /* ------------------------------------------------------------------ */
  // Repères d'écoute (auto) : accord, surface d'évent par pi³ net, vitesse max, Qtc scellée.
  // vol = plage de volume autour de la recommandation, area / areaMax = in² par pi³ net,
  // vmax = vitesse d'évent visée à pleine puissance (m/s), w = poids de la régularité.
  var GOALS = {
    sq:    { name: 'SQ', fb: [26, 34], vol: [0.85, 1.2], area: 12, areaMax: 18, vmax: 17, qtc: 0.707, sealed: 1.2, band: [22, 80], w: 2.0, mid: [25, 60] },
    daily: { name: 'Polyvalent', fb: [29, 37], vol: [0.9, 1.25], area: 14, areaMax: 18, vmax: 22, qtc: 0.8, sealed: 1.0, band: [25, 80], w: 1.0, mid: [28, 60] },
    sql:   { name: 'SQL', fb: [32, 40], vol: [1.0, 1.4], area: 16, areaMax: 20, vmax: 26, qtc: 0.9, sealed: 0.85, band: [28, 70], w: 0.5, mid: [32, 55] },
    spl:   { name: 'SPL', fb: [36, 48], vol: [1.1, 1.6], area: 20, areaMax: 26, vmax: 32, qtc: 1.0, sealed: 0.75, band: [35, 60], w: 0.15, mid: [38, 55] }
  };
  var SIZE_DB = 1;   // pénalité de taille : 1 dB par doublement de volume
  var AREA_IN2_FT3 = (IN * IN) / FT3;    // in²/pi³ → m²/m³

  function parseVol(s) {
    // « 1.75cu ft », « 0.75–1.0 cu ft », « 5-6 CU FT » → pi³ (milieu d'une plage) ; texte = null
    if (s == null) return null;
    var m = String(s).replace(/,/g, '.').match(/(\d*\.?\d+)\s*(?:[-–]\s*(\d*\.?\d+))?/);
    if (!m || /not|n\/a/i.test(s)) return null;
    var a = +m[1], b = m[2] ? +m[2] : a;
    if (b < a * 0.5) b = a;                          // « 0.3-.04cuft » : faute de frappe
    return (a + b) / 2;
  }

  // inp : { ts (complété), rec (fiche : recSealed, recPorted, recTune, recArea), n, coil, link, watts,
  //         goal, type: auto|sealed|slot|round, max: { w, h, d }, vehicle, fc, t, layers, side, brace }
  function propose(inp) {
    var ts = inp.ts, rec = inp.rec || {}, n = inp.n || 1, G = GOALS[inp.goal] || GOALS.daily;
    var why = [], watts = inp.watts || (ts.rms || 500) * n;
    var fc = inp.vehicle === 'custom' ? (inp.fc || 0) : ((VEHICLES.filter(function (v) { return v.id === inp.vehicle; })[0] || {}).fc || 0);
    var sealedRec = parseVol(rec.recSealed), portedRec = parseVol(rec.recPorted);
    var sealedNo = rec.recSealed != null && /not/i.test(rec.recSealed);
    var portedNo = rec.recPorted != null && /not|n\/a/i.test(rec.recPorted);
    var type = inp.type || 'auto';
    if (type === 'auto') {
      if (portedNo) type = 'sealed';
      else if (sealedNo) type = 'slot';
      else if (inp.goal === 'sq' && ts.ebp && ts.ebp < 70) type = 'sealed';
      else type = 'slot';
      why.push(type === 'sealed' ? (portedNo ? 'Sundown ne recommande pas d\'évent' : 'EBP ' + Math.round(ts.ebp) + ' : bon candidat scellé') : (sealedNo ? 'Scellée non recommandée par le fabricant' : 'Évent fente : le plus efficace en auto'));
    }
    var t = inp.t || 0.75 * IN, layers = inp.layers || 1, max = inp.max || {};
    var od = ts.od || (ts.cutout || 0.28) * 1.1, depth = ts.depth || 0.15;
    var base = { type: type, t: t, layers: layers, n: n, brace: !!inp.brace, port: { side: inp.side || 'left', pw: 2 * IN, dp: 4 * IN, np: 1, flare: type === 'round' } };

    // volume de référence (fabricant, sinon formule)
    var vRef;
    if (type === 'sealed') {
      var vPhys = ts.Qts < G.qtc ? ts.Vas / (Math.pow(G.qtc / ts.Qts, 2) - 1) : null;
      vRef = sealedRec ? sealedRec * FT3 * G.sealed : (vPhys || 1 * FT3);
      if (sealedRec) why.push('Sundown : ' + fr(sealedRec) + ' ft³ scellée');
    } else {
      vRef = portedRec ? portedRec * FT3 : 15 * ts.Vas * Math.pow(ts.Qts, 2.87);
      if (portedRec) why.push('Sundown : ' + fr(portedRec) + ' ft³ à ' + (rec.recTune || 35) + ' Hz');
    }
    vRef *= n;

    // espace max → volume net max (approx., sans évent)
    var vMaxSpace = null;
    if (max.w && max.h && max.d) {
      var gm = geometry(Object.assign({}, base, { type: 'sealed', w: max.w, h: max.h, d: max.d }), ts);
      vMaxSpace = gm.net > 0 ? gm.net * (type === 'sealed' ? 1 : 0.88) : null;
    }

    var fq = freqs(15, 120, 70);
    var areaFor = function (vb, ratio) { return ratio * vb / FT3 * IN * IN; };
    // surface visée imposée (in²/ft³) : remplace celle de l'objectif
    var aR = inp.area > 0 ? inp.area : G.area, aRMax = inp.area > 0 ? inp.area : G.areaMax;
    function score(vb, fb, area) {
      var s = simulate({ ts: ts, n: n, coil: inp.coil, link: inp.link, watts: watts, type: type, vb: vb,
        Sp: area, Leff: type === 'sealed' ? 0 : C * C * area / (Math.pow(TAU * fb, 2) * vb), fc: fc, f: fq });
      var a = [], b = [], gd = 0, ng = 0;
      for (var i = 0; i < fq.length; i++) {
        var v = s.splMax[i] + s.cabin[i];
        if (fq[i] >= G.band[0] && fq[i] <= G.band[1]) a.push(v);
        if (fq[i] >= G.mid[0] && fq[i] <= G.mid[1]) b.push(v);
        if (fq[i] >= 25 && fq[i] <= 45) { gd += s.gd[i]; ng++; }
      }
      var mean = b.reduce(function (x, y) { return x + y; }, 0) / b.length;
      var mA = a.reduce(function (x, y) { return x + y; }, 0) / a.length;
      var sd = Math.sqrt(a.reduce(function (x, y) { return x + (y - mA) * (y - mA); }, 0) / a.length);
      var pen = (inp.goal === 'sq' ? Math.max(0, gd / ng - 18) * 0.15 : 0) + SIZE_DB * Math.log(vb / vRef) / Math.LN2;
      return { v: mean - G.w * sd - pen, sim: s };
    }

    var best;
    var vLo = vRef * G.vol[0], vHi = vRef * G.vol[1];
    if (vMaxSpace && vHi > vMaxSpace) { vHi = vMaxSpace; vLo = Math.min(vLo, vHi * 0.85); why.push('Espace limité : ' + fr(vMaxSpace / FT3) + ' ft³ net au plus'); }
    if (type === 'sealed') best = { vb: Math.min(vRef, vHi), fb: 0, area: 0 };
    else {
      for (var vi = 0; vi <= 8; vi++) {
        var vb = vLo + (vHi - vLo) * vi / 8;
        for (var fb = G.fb[0]; fb <= G.fb[1]; fb += 1) {
          var ar = areaFor(vb, aR), sc = score(vb, fb, ar);
          if (!best || sc.v > best.s.v) best = { vb: vb, fb: fb, area: ar, s: sc };
        }
      }
      // surface : monte jusqu'au plafond de l'objectif si l'air va trop vite à pleine puissance
      var aMax = areaFor(best.vb, aRMax);
      for (var k = 0; k < 10 && best.area < aMax; k++) {
        if (Math.max.apply(null, score(best.vb, best.fb, best.area).sim.vp) <= G.vmax) break;
        best.area = Math.min(best.area * 1.1, aMax);
      }
    }

    // cotes : hauteur ≈ collerette, profondeur ≈ moteur + jeu ; la largeur est résolue
    var hMin = Math.max(od + 0.25 * IN, (ts.cutout || 0) + 2 * t + 2 * M_EDGE);
    var dMin = depth + t * layers + t + CLEAR + (type === 'slot' ? 2 * IN : 0);
    var cap = function (v, m) { return m ? Math.min(v, m) : v; };
    var P = Object.assign({}, base, { fb: best.fb });
    // sans limite : proportions proches d'un cube (≈ 0,75 × 0,87 × arête) plutôt qu'une boîte très large
    var edge = Math.cbrt(best.vb * 1.35);
    P.h = cap(Math.max(hMin, od + 2 * t + 1 * IN, max.h ? 0 : Math.min(edge * 0.75, od * 1.6)), max.h);
    P.d = cap(Math.max(dMin, od * 1.2, max.d ? 0 : Math.min(edge * 0.87, P.h * 1.2)), max.d);
    var setPort = function () {
      if (inp.area > 0) best.area = areaFor(target, inp.area);
      if (type === 'slot') P.port.pw = Math.max(best.area / (P.h - 2 * t), 1 * IN);
      if (type === 'round') {
        var dp = 3 * IN, np = 1;
        [3, 4, 5, 6, 8].some(function (d) { dp = d * IN; np = Math.ceil(best.area / (Math.PI * dp * dp / 4)); return np <= 2; });
        P.port.dp = dp; P.port.np = Math.min(np, 4);
      }
    };
    var wMinSubs = function () {
      var extra = 0;
      if (type === 'slot') extra = t + P.port.pw;
      if (type === 'round') {
        var perCol = Math.max(1, Math.floor((P.h - 2 * t) / (P.port.dp + 2 * IN)));
        extra = (P.port.dp + 2 * IN) * Math.ceil(P.port.np / perCol);
      }
      return n * (od + 0.25 * IN) + extra + t;
    };
    var target = best.vb, g = null, it = 0, shrunk = false, wAdd = 0;
    var roomD = function () { return !max.d || P.d < max.d - 1e-4; }, roomH = function () { return !max.h || P.h < max.h - 1e-4; };
    while (it++ < 60) {
      setPort();
      var wLo = wMinSubs() + wAdd, sol = solveDim(P, ts, 'w', target, wLo, max.w || 160 * IN);
      P.w = Math.max(sol.x, wLo);
      g = geometry(P, ts);
      var K = g.errK, tooWide = !sol.ok || (max.w && P.w > max.w + 1e-4);
      if (g.ok && !tooWide) break;
      if (K.height && roomH()) { P.h = cap(P.h + 0.5 * IN, max.h); continue; }
      if (K.depth) {
        // moteur contre le dos ou le retour de l'évent : plus profond, sinon plus large (évent plus court)
        if (roomD()) { P.d = cap(P.d + 1 * IN, max.d); continue; }
        if (!max.w || P.w < max.w - 1e-4) { wAdd += 1 * IN; continue; }
      }
      if (K.width && !tooWide) {
        // les subs ne tiennent pas côte à côte : moins profond, la largeur grandit
        if (P.d > dMin + 1e-4) { P.d = Math.max(dMin, P.d - 1 * IN); continue; }
        wAdd += 0.5 * IN; continue;
      }
      if (K.port || tooWide || K.net || K.depth) {
        // plus d'espace d'abord, puis évent plus petit / accord plus haut, puis moins de volume
        if (roomD() && !K.width) { P.d = cap(P.d + 1 * IN, max.d); continue; }
        if (roomH()) { P.h = cap(P.h + 1 * IN, max.h); continue; }
        if (K.port && !(inp.area > 0) && best.area > areaFor(target, 9)) { best.area *= 0.92; continue; }
        if ((K.port || K.depth) && best.fb < G.fb[1] + 6) { best.fb += 1; P.fb = best.fb; continue; }
        target *= 0.94; shrunk = true; continue;
      }
      break;
    }
    // l'espace max n'est jamais dépassé
    if (max.w && P.w > max.w) { P.w = max.w; g = geometry(P, ts); }
    if (shrunk) why.push('Volume réduit à ' + fr(g.net / FT3) + ' ft³ pour tenir dans l\'espace');
    if (type === 'round' && !g.ok) why.push('Évent rond impossible dans cet espace : prends une fente');
    if (type !== 'sealed') why.push('Accord ' + best.fb + ' Hz · ' + G.name);
    var simFinal = run(Object.assign({}, P, { coil: inp.coil, link: inp.link, watts: watts, vehicle: inp.vehicle, fc: inp.fc }), ts).sim;
    if (simFinal && type !== 'sealed') {
      var vpk = Math.max.apply(null, simFinal.vp);
      if (vpk > G.vmax) why.push('Air de l\'évent à ' + Math.round(vpk) + ' m/s à ' + Math.round(watts) + ' W');
    }
    return { type: type, P: P, g: g, vb: g.net, fb: best.fb, area: g.port ? g.port.Sp : 0, why: why, sim: simFinal, ok: g.ok };
  }

  /* ------------------------------------------------------------------ */
  /*  Feuilles de coupe                                                  */
  /* ------------------------------------------------------------------ */
  // pcs : [{ label, name, a, b, qty }] (m) ; o : { L (long), W (large), kerf, trim, grain }
  // Guillotine en 3 étapes : bandes sur toute la feuille, tronçons dans la bande,
  // refente d'un tronçon pour empiler les pièces étroites.
  function cutlist(pcs, o) {
    var items = [], k = o.kerf || 0, trim = o.trim || 0, bad = [];
    pcs.forEach(function (p) { for (var i = 0; i < p.qty; i++) items.push({ p: p, a: Math.max(p.a, p.b), b: Math.min(p.a, p.b), i: i }); });
    var best = null;
    ['long', 'cross'].forEach(function (dir) {
      ['narrow', 'wide'].forEach(function (orient) {
        ['acr', 'area'].forEach(function (sort) {
          var r = pack(items, dir, orient, sort, o.L - 2 * trim, o.W - 2 * trim, k, !!o.grain);
          if (!r) return;
          if (!best || better(r, best)) best = r;
        });
      });
    });
    if (!best) {
      items.forEach(function (it) { if (!fits(it, o.L - 2 * trim, o.W - 2 * trim)) bad.push(it.p.label); });
      return { ok: false, sheets: [], bad: bad.filter(function (x, i, a) { return a.indexOf(x) === i; }) };
    }
    best.ok = true;
    best.sheets.forEach(function (s) {
      s.pieces.forEach(function (q) { q.x += trim; q.y += trim; });
      s.offcuts.forEach(function (q) { q.x += trim; q.y += trim; });
      var used = s.pieces.reduce(function (t, q) { return t + q.w * q.h; }, 0);
      s.use = used / (o.L * o.W);
      var ext = s.pieces.reduce(function (m, q) { return Math.max(m, q.x + q.w); }, 0) + trim;
      s.half = o.L >= o.W * 1.9 && ext <= o.L / 2 + 1e-6;   // une demi-feuille (4×4) suffit
    });
    best.use = best.sheets.reduce(function (t, s) { return t + s.use; }, 0) / best.sheets.length;
    return best;
  }
  function fits(it, Ls, Ws) { return (it.a <= Ls + 1e-9 && it.b <= Ws + 1e-9) || (it.a <= Ws + 1e-9 && it.b <= Ls + 1e-9); }
  function better(a, b) {
    if (a.sheets.length !== b.sheets.length) return a.sheets.length < b.sheets.length;
    var la = a.lastUse, lb = b.lastUse;
    if (Math.abs(la - lb) > 1e-6) return la < lb;
    return a.cuts < b.cuts;
  }

  function pack(items, dir, orient, sort, Ls, Ws, k, grain) {
    // SL = longueur d'une bande, SW = largeur où l'on empile les bandes
    var SL = dir === 'long' ? Ls : Ws, SW = dir === 'long' ? Ws : Ls;
    var opts = function (it) {
      // (len le long de la bande, acr en travers) ; fil = long côté dans le sens de la feuille
      var o = [];
      if (grain) { o.push(dir === 'long' ? [it.a, it.b] : [it.b, it.a]); }
      else { o.push(orient === 'narrow' ? [it.a, it.b] : [it.b, it.a]); o.push(orient === 'narrow' ? [it.b, it.a] : [it.a, it.b]); }
      return o.filter(function (x) { return x[0] <= SL + 1e-9 && x[1] <= SW + 1e-9; });
    };
    var list = items.slice();
    for (var i = 0; i < list.length; i++) if (!opts(list[i]).length) return null;
    list.sort(function (x, y) {
      var ox = opts(x)[0], oy = opts(y)[0];
      if (sort === 'acr') return (oy[1] - ox[1]) || (oy[0] - ox[0]);
      return (y.a * y.b - x.a * x.b) || (oy[1] - ox[1]);
    });
    var sheets = [];
    var newSheet = function () { var s = { strips: [], used: 0 }; sheets.push(s); return s; };
    list.forEach(function (it) {
      var cand = null;
      var consider = function (c) { if (!cand || c.loss < cand.loss - 1e-12) cand = c; };
      opts(it).forEach(function (o) {
        var len = o[0], acr = o[1];
        sheets.forEach(function (s, si) {
          s.strips.forEach(function (st) {
            st.segs.forEach(function (sg) {
              if (len <= sg.len + 1e-9 && sg.used + k + acr <= st.ws + 1e-9)
                consider({ t: 'stack', s: s, st: st, sg: sg, len: len, acr: acr, loss: (sg.len - len) * acr + si * 1e-3 });
            });
            var x = st.x + (st.segs.length ? k : 0);
            if (acr <= st.ws + 1e-9 && x + len <= SL + 1e-9)
              consider({ t: 'seg', s: s, st: st, len: len, acr: acr, loss: (st.ws - acr) * len + si * 1e-3 });
          });
        });
      });
      if (!cand) {
        opts(it).some(function (o) {
          var len = o[0], acr = o[1];
          return sheets.some(function (s) {
            var y = s.used + (s.strips.length ? k : 0);
            if (y + acr <= SW + 1e-9) { cand = { t: 'strip', s: s, len: len, acr: acr }; return true; }
            return false;
          });
        });
      }
      if (!cand) { var o0 = opts(it)[0]; cand = { t: 'strip', s: newSheet(), len: o0[0], acr: o0[1] }; }
      var s = cand.s, st = cand.st, sg = cand.sg;
      if (cand.t === 'strip') {
        var y0 = s.used + (s.strips.length ? k : 0);
        st = { y: y0, ws: cand.acr, x: 0, segs: [] }; s.strips.push(st); s.used = y0 + cand.acr;
      }
      if (cand.t !== 'stack') {
        var x0 = st.x + (st.segs.length ? k : 0);
        sg = { x: x0, len: cand.len, used: -k, stack: [] }; st.segs.push(sg); st.x = x0 + cand.len;
      }
      var off = sg.used + k;
      sg.stack.push({ it: it, off: off, len: cand.len, acr: cand.acr });
      sg.used = off + cand.acr;
    });
    // géométrie finale + coupes + retailles
    var cuts = 0, res = { dir: dir, sheets: [] };
    sheets.forEach(function (s) {
      var out = { pieces: [], offcuts: [], steps: [] };
      var put = function (along, across, len, acr) {   // repère feuille : x le long de L, y le long de W
        return dir === 'long' ? { x: along, y: across, w: len, h: acr } : { x: across, y: along, w: acr, h: len };
      };
      s.strips.forEach(function (st, bi) {
        var step = { strip: bi + 1, ws: st.ws, segs: [] };
        cuts++;
        st.segs.forEach(function (sg) {
          cuts++;
          var seg = { len: sg.len, parts: [] };
          sg.stack.forEach(function (q, qi) {
            var r = put(sg.x, st.y + q.off, q.len, q.acr);
            r.label = q.it.p.label; r.name = q.it.p.name; r.a = q.it.a; r.b = q.it.b; r.rot = q.len !== q.it.a;
            out.pieces.push(r);
            seg.parts.push({ label: q.it.p.label, len: q.len, acr: q.acr });
            if (q.len < sg.len - 1e-9) { cuts++; addOff(out, put(sg.x + q.len + k, st.y + q.off, sg.len - q.len - k, q.acr)); }
            if (qi || q.acr < st.ws - 1e-9) cuts++;
          });
          var rest = st.ws - sg.used - k;
          if (rest > 0) addOff(out, put(sg.x, st.y + sg.used + k, sg.len, rest));
          step.segs.push(seg);
        });
        var restL = SL - st.x - k;
        if (restL > 0) addOff(out, put(st.x + k, st.y, restL, st.ws));
        out.steps.push(step);
      });
      var restW = SW - s.used - k;
      if (restW > 0) addOff(out, put(0, s.used + k, SL, restW));
      res.sheets.push(out);
    });
    var last = sheets[sheets.length - 1];
    res.lastUse = last ? last.used / SW : 0;
    res.cuts = cuts;
    return res;
  }
  function addOff(out, r) { if (r.w >= 2 * IN && r.h >= 2 * IN) out.offcuts.push(r); }

  /* ------------------------------------------------------------------ */
  /*  Unités et formats                                                  */
  /* ------------------------------------------------------------------ */
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  // pouces avec fraction au 1/8 : 14 3/4
  function frac(inches, den) {
    den = den || 8;
    var neg = inches < 0; inches = Math.abs(inches);
    var whole = Math.floor(inches + 1e-9), nn = Math.round((inches - whole) * den);
    if (nn === den) { whole++; nn = 0; }
    var s = nn ? (nn / gcd(nn, den)) + '/' + (den / gcd(nn, den)) : '';
    return (neg ? '−' : '') + (whole ? whole + (s ? ' ' + s : '') : (s || '0'));
  }

  root.BoxEngine = {
    RHO: RHO, C: C, IN: IN, FT3: FT3, L: L, CM2: CM2, AREA_IN2_FT3: AREA_IN2_FT3,
    VEHICLES: VEHICLES, GOALS: GOALS,
    completeTS: completeTS, wired: wired, electrical: electrical, wirings: wirings,
    geometry: geometry, pieces: pieces, solveDim: solveDim,
    cabinGain: cabinGain, freqs: freqs, simulate: simulate, run: run,
    propose: propose, parseVol: parseVol, cutlist: cutlist, frac: frac
  };
})(typeof window !== 'undefined' ? window : globalThis);
