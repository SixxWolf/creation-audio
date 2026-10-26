/* =========================================================
   Création Audio — THÈME DES FÊTES : décors (fetes.css pour le style)
   Chargé par nav.js seulement quand html.fetes est posée (réglage admin
   Réglages › Apparence, ou aperçu ?fetes=1). Ajoute :
   - la neige qui tombe (canvas .xm-snow, sous l'en-tête, jamais cliquable) +
     bouton ❄ dans l'en-tête et dans le menu mobile (choix mémorisé
     « ca-fetes-neige » ; coupée d'office si « réduire les animations ») ;
   - la guirlande lumineuse sous l'en-tête (.xm-garland) ;
   - la tuque sur le loup du logo (.xm-hat) ;
   - accueil : collines enneigées au bas du héros (.xm-hills) et sapin à côté
     de la bobine (.xm-tree) dont les boules prennent les couleurs du nuancier
     (#rail, accueil.js) — cliquer une boule choisit sa couleur ;
   - sapins et cadeaux au-dessus du pied de page (.xm-village).
   Si la classe disparaît (thème éteint en ligne), fetes.css cache tout et la
   neige s'arrête.
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA = window.CA || {};
  var _t = CA.t || function (s) { return s; };
  if (CA.fetes) return;

  var root = document.documentElement;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var LS_SNOW = 'ca-fetes-neige';
  var FLAKE_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M12 6l-2.5-2.5M12 6l2.5-2.5M12 18l-2.5 2.5M12 18l2.5 2.5"/></svg>';
  function on() { return root.classList.contains('fetes'); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }

  /* =========================================================
     NEIGE
     ========================================================= */
  var cv = null, ctx = null, flakes = [], raf = 0, W = 0, H = 0, DPR = 1, sprites = [], last = 0;

  function snowWanted() {
    var v = null;
    try { v = localStorage.getItem(LS_SNOW); } catch (e) {}
    return v ? v === '1' : !reduce;
  }
  // flocons pré-dessinés (blanc + liseré bleuté : visibles sur fond blanc comme sur la bobine noire)
  function makeSprite(r, crystal) {
    var s = Math.ceil((r + 3) * 2 * DPR), c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = c.height = s;
    g.translate(s / 2, s / 2); g.scale(DPR, DPR);
    if (crystal) {
      for (var pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass ? '#fff' : 'rgba(110,138,170,.45)';
        g.lineWidth = pass ? 1.3 : 2.8; g.lineCap = 'round';
        for (var k = 0; k < 6; k++) {
          g.save(); g.rotate(k * Math.PI / 3);
          g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -r);
          g.moveTo(0, -r * .6); g.lineTo(-r * .28, -r * .86); g.moveTo(0, -r * .6); g.lineTo(r * .28, -r * .86);
          g.stroke(); g.restore();
        }
      }
    } else {
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,.95)'; g.fill();
      g.lineWidth = 1; g.strokeStyle = 'rgba(120,145,175,.42)'; g.stroke();
    }
    return { c: c, r: r + 3 };
  }
  function sizeSnow() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    sprites = [makeSprite(1.6), makeSprite(2.3), makeSprite(3.1), makeSprite(5.5, true), makeSprite(7.5, true)];
    var want = Math.max(18, Math.min(60, Math.round(W * H / 28000)));
    while (flakes.length < want) flakes.push(newFlake(true));
    flakes.length = want;
  }
  function newFlake(anywhere) {
    var crystal = Math.random() < 0.22, sp = crystal ? 3 + (Math.random() < .5 ? 0 : 1) : Math.floor(Math.random() * 3);
    return {
      x: Math.random() * W, y: anywhere ? Math.random() * H : -12,
      sp: sp, vy: (crystal ? 22 : 16) + Math.random() * 26,         // px/s
      amp: 10 + Math.random() * 22, fr: .3 + Math.random() * .5, ph: Math.random() * 6.3,
      rot: Math.random() * 6.3, vr: (Math.random() - .5) * .8, a: .55 + Math.random() * .45
    };
  }
  function frame(t) {
    raf = 0;
    if (!on() || !cv) return;
    var dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016); last = t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    var s = t / 1000;
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i], sp = sprites[f.sp];
      f.y += f.vy * dt; f.rot += f.vr * dt;
      var x = f.x + Math.sin(s * f.fr + f.ph) * f.amp;
      if (f.y - sp.r > H) { flakes[i] = newFlake(false); continue; }
      ctx.globalAlpha = f.a;
      ctx.setTransform(DPR, 0, 0, DPR, x * DPR, f.y * DPR);
      if (f.sp > 2) ctx.rotate(f.rot);
      ctx.drawImage(sp.c, -sp.r, -sp.r, sp.r * 2, sp.r * 2);
    }
    raf = requestAnimationFrame(frame);
  }
  function startSnow() {
    if (!cv) {
      cv = el('canvas', 'xm-snow'); cv.setAttribute('aria-hidden', 'true');
      ctx = cv.getContext('2d');
      document.body.appendChild(cv);
      var rt = null;
      window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { if (cv) sizeSnow(); }, 150); });
    }
    cv.hidden = false;
    sizeSnow();
    last = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stopSnow() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (cv) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; }
  }

  /* ---- bouton ❄ : en-tête (≥ 560 px) + menu mobile ---- */
  var snowBtns = [];
  function syncSnowBtns() {
    var w = snowWanted();
    snowBtns.forEach(function (b) {
      b.setAttribute('aria-pressed', String(w));
      b.title = w ? _t('Couper la neige') : _t('Faire neiger');
      if (b.classList.contains('xm-drawer-snow')) b.lastChild.textContent = w ? _t('Couper la neige') : _t('Faire neiger');
    });
  }
  function toggleSnow() {
    var w = !snowWanted();
    try { localStorage.setItem(LS_SNOW, w ? '1' : '0'); } catch (e) {}
    if (w) startSnow(); else stopSnow();
    syncSnowBtns();
  }
  function snowButtons() {
    var top = $('.home-top');
    if (top && !$('.xm-snow-btn', top)) {
      var b = el('button', 'xm-snow-btn', FLAKE_IC);
      b.type = 'button'; b.setAttribute('aria-label', _t('Neige'));
      var before = $('.home-account', top) || $('.cart-btn', top) || $('.nav-burger', top);
      if (before) top.insertBefore(b, before); else top.appendChild(b);
      b.addEventListener('click', toggleSnow);
      snowBtns.push(b);
    }
    var cta = $('.drawer-cta');
    if (cta && !$('.xm-drawer-snow')) {
      var d = el('button', 'xm-drawer-snow', FLAKE_IC + '<span></span>');
      d.type = 'button';
      cta.appendChild(d);
      d.addEventListener('click', toggleSnow);
      snowBtns.push(d);
    }
    syncSnowBtns();
  }

  /* =========================================================
     GUIRLANDE — une ampoule au creux de chaque festons (période P px)
     ========================================================= */
  var BULBS = ['#E0283C', '#2FA35A', '#F2B33D', '#3C7DDB', '#FFF1C9'];
  function garland() {
    var top = $('.home-top');
    if (!top) return;
    var g = $('.xm-garland', top);
    if (!g) { g = el('div', 'xm-garland'); g.setAttribute('aria-hidden', 'true'); top.appendChild(g); }
    var w = top.clientWidth, P = w < 600 ? 52 : 64, n = Math.ceil(w / P) + 1, wire = 'M0 2', bulbs = '', defs = '';
    BULBS.forEach(function (c, k) {
      defs += '<radialGradient id="xm-gl' + k + '"><stop offset="0" stop-color="' + c + '" stop-opacity=".9"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient>';
    });
    for (var i = 0; i < n; i++) {
      var x0 = i * P, xm = x0 + P / 2, k2 = i % BULBS.length, d = (-Math.random() * 2.6).toFixed(2) + 's';
      wire += 'Q' + xm + ' 14 ' + (x0 + P) + ' 2';
      bulbs += '<g class="bulb">' +
        '<circle class="glow" cx="' + xm + '" cy="15" r="8" fill="url(#xm-gl' + k2 + ')" style="animation-delay:' + d + '"/>' +
        '<rect x="' + (xm - 2) + '" y="7" width="4" height="3.4" rx=".8" fill="#3B4238"/>' +
        '<ellipse class="glass" cx="' + xm + '" cy="14.6" rx="3.3" ry="4.6" fill="' + BULBS[k2] + '" style="animation-delay:' + d + '"/>' +
        '<ellipse cx="' + (xm - 1) + '" cy="13" rx=".9" ry="1.6" fill="#fff" opacity=".7"/></g>';
    }
    g.innerHTML = '<svg width="' + n * P + '" viewBox="0 0 ' + n * P + ' 22"><defs>' + defs + '</defs>' +
      '<path class="wire" d="' + wire + '"/>' + bulbs + '</svg>';
  }

  /* =========================================================
     TUQUE sur le loup (en-tête + menu mobile)
     ========================================================= */
  var HAT = '<svg class="xm-hat" viewBox="0 0 40 34" aria-hidden="true">' +
    '<path fill="#C8102E" d="M8 27C10 17 16 8 25 4.2 29.5 2.4 33.4 4.6 34.4 9.4 35.5 15 36 21 36.4 27Z"/>' +
    '<path fill="#A00D25" d="M8 27C10 17 16 8 25 4.2 21 9 18.4 17 18 27Z" opacity=".55"/>' +
    '<path fill="#C8102E" d="M26 4.4C19.5 3.4 12 6.6 7.4 12.6 12.4 10 18.6 8.8 24.8 9.6Z"/>' +
    '<circle cx="7.2" cy="12.8" r="4.2" fill="#fff" stroke="#D9E2EA" stroke-width=".8"/>' +
    '<rect x="5.6" y="23.6" width="33" height="8.4" rx="4.2" fill="#fff" stroke="#D9E2EA" stroke-width=".8"/></svg>';
  function hats() {
    $$('.brand, .drawer-head').forEach(function (b) {
      if ($('.xm-hat', b) || !$('.brand-mark', b)) return;
      b.insertAdjacentHTML('afterbegin', HAT);
    });
  }

  /* =========================================================
     ACCUEIL — collines + sapin du héros
     ========================================================= */
  function hills() {
    var hero = $('#hero');
    if (!hero || $('.xm-hills', hero)) return;
    var front = 'M0 112C240 82 420 94 640 110S1040 72 1240 98 1400 106 1440 94';
    var h = el('div', 'xm-hills',
      '<svg viewBox="0 0 1440 150" preserveAspectRatio="none"><path class="h-back" d="M0 72C180 32 360 42 540 68S900 32 1080 54 1320 72 1440 46V150H0Z"/></svg>' +
      '<div class="h-trees"></div>' +
      '<svg viewBox="0 0 1440 150" preserveAspectRatio="none"><path class="h-front" d="' + front + 'V150H0Z"/><path class="h-sheen" d="' + front + '"/></svg>');
    h.setAttribute('aria-hidden', 'true');
    hero.appendChild(h);
  }

  // positions des boules (repère du sapin 200 × 290) ; « big » = boules plus grosses
  var ORN = [[88, 70], [114, 82, 1], [76, 118], [103, 128], [128, 112], [64, 166], [93, 174, 1], [122, 160], [146, 176],
             [54, 216], [84, 224], [114, 214], [141, 228, 1], [164, 210]];
  var FALLBACK_ORN = ['#C8102E', '#D4A24C', '#2F6FB0', '#E8E8EA', '#7C2A8A', '#C8102E', '#D4A24C', '#1F9D57'];
  var TREE = '<svg viewBox="0 0 200 290" aria-hidden="true"><defs>' +
      '<linearGradient id="xm-star" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE59A"/><stop offset="1" stop-color="#D4A24C"/></linearGradient>' +
      '<radialGradient id="xm-ground"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>' +
    '<ellipse cx="100" cy="280" rx="96" ry="9" fill="url(#xm-ground)"/>' +
    '<rect x="91" y="232" width="18" height="30" rx="2" fill="#6B4A2E"/>' +
    '<path fill="#174A2F" d="M100 140 6 244Q100 262 194 244Z"/><path fill="#fff" d="M6 244Q100 262 194 244" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' +
    '<path fill="#1B5536" d="M100 100 24 190Q100 206 176 190Z"/><path fill="none" d="M24 190Q100 206 176 190" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>' +
    '<path fill="#1F5E3B" d="M100 60 42 140Q100 154 158 140Z"/><path fill="none" d="M42 140Q100 154 158 140" stroke="#fff" stroke-width="4" stroke-linecap="round"/>' +
    '<path fill="#246A43" d="M100 22 60 92Q100 104 140 92Z"/><path fill="none" d="M60 92Q100 104 140 92" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>' +
    '<path fill="#fff" d="M100 22 108 36Q104 33.5 100 36.5 96 33.5 92 36Z"/>' +
    '<g fill="none" stroke="#E8C05C" stroke-width="1.4" opacity=".9"><path d="M74 72Q102 92 128 70"/><path d="M58 124Q98 150 142 118"/><path d="M40 176Q100 204 160 168"/></g>' +
    '<g class="lights">' +
      [[80, 77], [100, 84], [120, 76], [66, 130], [86, 139], [110, 138], [132, 127], [50, 183], [74, 191], [100, 194], [126, 189], [150, 177]]
        .map(function (p, i) { return '<circle class="light" cx="' + p[0] + '" cy="' + p[1] + '" r="2.2" fill="' + (i % 2 ? '#FFF1C9' : '#FFD36B') +
          '" style="animation-delay:' + (-(i * 0.37) % 1.9).toFixed(2) + 's"/>'; }).join('') +
    '</g>' +
    '<g class="gifts">' +
      '<rect x="26" y="240" width="48" height="38" rx="3" fill="#C8102E"/><rect x="45" y="240" width="9" height="38" fill="#E8C05C"/><rect x="24" y="234" width="52" height="10" rx="3" fill="#B00E28"/><rect x="45" y="234" width="9" height="10" fill="#D9B04A"/>' +
      '<path fill="none" stroke="#E8C05C" stroke-width="3.2" d="M49.5 234C43 222 33 225 37 231 39 234 49.5 234 49.5 234 56 222 66 225 62 231 60 234 49.5 234 49.5 234Z"/>' +
      '<rect x="128" y="248" width="44" height="31" rx="3" fill="#1F5E3B"/><rect x="145" y="248" width="9" height="31" fill="#C8102E"/><rect x="126" y="243" width="48" height="9" rx="3" fill="#174A2F"/><rect x="145" y="243" width="9" height="9" fill="#A00D25"/>' +
      '<rect x="80" y="256" width="36" height="24" rx="3" fill="#D4A24C"/><rect x="94" y="256" width="8" height="24" fill="#C8102E"/><rect x="78" y="252" width="40" height="8" rx="3" fill="#C29240"/>' +
      '<path fill="#fff" d="M24 236Q50 229 76 236V238H24ZM126 245Q150 239 174 245V247H126ZM78 254Q98 249 118 254V256H78Z"/>' +
    '</g>' +
    '<path class="star" fill="url(#xm-star)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" d="M100 1 104.7 12.5 117 13.4 107.6 21.3 110.6 33.4 100 26.8 89.4 33.4 92.4 21.3 83 13.4 95.3 12.5Z"/>' +
    '</svg>';

  function tree() {
    var svg = $('#spool'), rail = $('#rail');
    if (!svg || $('.xm-tree')) return;
    // la bobine est enveloppée pour que le sapin se cale sur elle (et non sur la fiche couleur, dessous en mobile)
    var wrap = el('div', 'xm-spool-wrap');
    wrap.style.position = 'relative';
    svg.parentNode.insertBefore(wrap, svg);
    wrap.appendChild(svg);
    var box = el('div', 'xm-tree', TREE);
    var orns = ORN.map(function (p) {
      var o = el('span', 'xm-orn' + (p[2] ? ' is-big' : ''));
      o.style.left = (p[0] / 2) + '%'; o.style.top = (p[1] / 2.9) + '%';
      box.appendChild(o);
      return o;
    });
    wrap.appendChild(box);

    var ptr = 0;
    function swOf(b) { return b && b.style.getPropertyValue('--sw'); }
    function paint() {
      var sws = rail ? $$('.sw', rail) : [];
      orns.forEach(function (o, i) {
        if (sws.length) {
          var j = Math.floor((i * 7919) % ORN.length / ORN.length * sws.length);   // réparties dans tout le spectre, dans le désordre
          o.style.setProperty('--sw', swOf(sws[j]) || FALLBACK_ORN[i % FALLBACK_ORN.length]);
          o.dataset.i = j;
        } else {
          o.style.setProperty('--sw', FALLBACK_ORN[i % FALLBACK_ORN.length]);
        }
      });
    }
    // la couleur choisie dans le nuancier vient s'accrocher au sapin, une boule après l'autre
    function hang(btn) {
      var v = swOf(btn), sws = $$('.sw', rail);
      if (!v) return;
      var o = orns[ptr]; ptr = (ptr + 5) % orns.length;
      o.style.setProperty('--sw', v);
      o.dataset.i = sws.indexOf(btn);
      if (!reduce) { o.classList.remove('is-pop'); void o.offsetWidth; o.classList.add('is-pop'); }
    }
    box.addEventListener('click', function (e) {
      var o = e.target.closest('.xm-orn');
      if (!o || !rail || o.dataset.i == null) return;
      var b = $$('.sw', rail)[+o.dataset.i];
      if (b) b.click();
    });
    paint();
    if (rail && 'MutationObserver' in window) {
      new MutationObserver(function (list) {
        var rebuilt = false, picked = null;
        list.forEach(function (m) {
          if (m.type === 'childList') rebuilt = true;
          else if (m.target.getAttribute('aria-pressed') === 'true') picked = m.target;
        });
        if (rebuilt) paint();
        else if (picked) hang(picked);
      }).observe(rail, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    }
  }

  /* =========================================================
     PIED DE PAGE — village
     ========================================================= */
  function village() {
    var foot = $('.site-foot');
    if (!foot || $('.xm-village')) return;
    var v = el('div', 'xm-village');
    v.setAttribute('aria-hidden', 'true');
    foot.parentNode.insertBefore(v, foot);
  }

  /* =========================================================
     DÉMARRAGE / ARRÊT
     ========================================================= */
  var built = false;
  function start() {
    if (!on()) return;
    if (!built) {
      built = true;
      hats(); garland(); hills(); tree(); village(); snowButtons();
      var rg = null, lastW = window.innerWidth;
      window.addEventListener('resize', function () {
        if (window.innerWidth === lastW) return;           // mobile : la barre d'adresse qui bouge ne compte pas
        lastW = window.innerWidth;
        clearTimeout(rg); rg = setTimeout(garland, 150);
      });
      // thème éteint/rallumé pendant la visite (réglage en ligne relu par nav.js)
      if ('MutationObserver' in window) {
        new MutationObserver(function () { if (on()) { if (snowWanted()) startSnow(); } else stopSnow(); })
          .observe(root, { attributes: true, attributeFilter: ['class'] });
      }
    }
    if (snowWanted()) startSnow();
  }
  CA.fetes = { start: start };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
