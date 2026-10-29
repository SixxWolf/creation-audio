/* =========================================================
   Création Audio — apparence choisie par le client / le dealer connecté
   (Mon compte › Apparence, Portail dealer › Apparence)
   - Mode Clair / Sombre / Auto (suit l'appareil) + couleur d'accent.
   - Tout le site public quand la personne est connectée ; déconnecté =
     site normal (clair, orange). Le thème des fêtes l'emporte (html.fetes).
   - Enregistré dans le compte (auth user_metadata.look : suit la personne
     d'un appareil à l'autre) + cache localStorage « ca-look » lu ici, dans
     le <head> de chaque page publique, avant le rendu (aucun éclair).
     Le cache ne vaut que si la session de son compte est encore là :
     k = 'c' (client, compte.js) ou 'd' (dealer, client Supabase par défaut).
   - Sombre = palette Ardoise de tokens.css (:root[data-theme="dark"]).
   - Accent : mêmes dérivations que l'admin (admin-accent.js) : --ember,
     --ember-dim, --on-ember (encre ou blanc), --ember-ink (texte AA 4,5:1).
   À charger juste après le script des fêtes, avant le <body>.
   - Arc-en-ciel (accent « arc », 2026-10-29) : se débloque par le bouton « J'aime les
     arcs-en-ciel » (pop-up « Êtes-vous sûr ? ») ; look.rainbow = true le garde dans le
     compte, définitivement (« Revenir à l'origine » ne le reverrouille pas). Ancre de
     couleur fixe pour les jetons + rainbow.css (dégradé qui glisse sur les surfaces
     pleines), chargé seulement quand html[data-rainbow] est posé.
   API : caLook.get() · caLook.set(look, k) · caLook.clear(k) · caLook.mount(el, { save }).
   ========================================================= */
(function () {
  'use strict';
  var LS = 'ca-look', STYLE_ID = 'ca-look-accent';
  var KEYS = { c: 'ca-compte-auth', d: 'sb-cqfmvdknppscazfynoiy-auth-token' };
  var MODES = ['light', 'dark', 'auto'];
  var ACCENTS = [
    ['orange', '#FF6A2B', 'Orange'], ['bleu', '#3B82F6', 'Bleu'], ['vert', '#22C55E', 'Vert'],
    ['violet', '#8B5CF6', 'Violet'], ['rose', '#EF3E82', 'Rose'], ['rouge', '#E5484D', 'Rouge']
  ];
  var ARC = 'arc', ARC_HEX = '#4C9AFF', RB_ID = 'ca-rainbow-css';
  var RB_SRC = document.currentScript && document.currentScript.src;   // rainbow.css est à côté (même ?v=)
  var DEF = { mode: 'light', accent: 'orange' };
  var LIGHT_BGS = ['#FFFFFF', '#F6F6F4', '#EFEDE8'], DARK_BGS = ['#1C1F26', '#141619', '#20242B'], INK = '#181A1F';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var cur = null;   // { mode, accent, k } ou null (déconnecté)

  /* ---- couleurs (copie de admin-accent.js) ---- */
  function rgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function toHex(c) {
    return '#' + c.map(function (v) {
      v = Math.round(Math.max(0, Math.min(255, v)));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('').toUpperCase();
  }
  function mix(a, b, t) { return [0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; }); }
  function lum(c) {
    var v = c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(a, b) { var la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function inkVariant(c, bgs, toward) {
    var t0 = rgb(toward), backs = bgs.map(rgb);
    for (var t = 0; t <= 1.0001; t += 0.02) {
      var v = mix(c, t0, t);
      if (backs.every(function (b) { return contrast(v, b) >= 4.5; })) return toHex(v);
    }
    return toward;
  }
  function cssFor(h) {
    var c = rgb(h);
    var on = contrast(c, rgb(INK)) >= contrast(c, [255, 255, 255]) ? INK : '#FFFFFF';
    return ':root:root{--ember:' + h + ';--ember-dim:' + toHex(mix(c, [0, 0, 0], 0.12)) + ';--on-ember:' + on +
           ';--ember-ink:' + inkVariant(c, LIGHT_BGS, '#000000') + ';}' +
           ':root:root[data-theme="dark"]{--ember-ink:' + inkVariant(c, DARK_BGS, '#FFFFFF') + ';}';
  }
  function hexOf(a) {
    if (a === ARC) return ARC_HEX;
    for (var i = 0; i < ACCENTS.length; i++) if (ACCENTS[i][0] === a) return ACCENTS[i][1];
    return null;
  }
  // feuille du dégradé : bloquante pendant l'analyse du <head> (aucun éclair), ajoutée à la volée ensuite
  function rainbowCss() {
    if (document.getElementById(RB_ID) || !RB_SRC) return;
    var href = RB_SRC.replace(/look\.js/, 'rainbow.css');
    if (document.readyState === 'loading') { document.write('<link rel="stylesheet" id="' + RB_ID + '" href="' + href + '">'); return; }
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.id = RB_ID; l.href = href;
    document.head.appendChild(l);
  }

  /* ---- état ---- */
  function clean(v) {
    v = v || {};
    var rb = v.rainbow === true;   // débloqué : « arc » n'est valable que dans ce cas
    return { mode: MODES.indexOf(v.mode) >= 0 ? v.mode : DEF.mode,
             accent: hexOf(v.accent) && (rb || v.accent !== ARC) ? v.accent : DEF.accent, rainbow: rb };
  }
  function has(k) { try { return !!(KEYS[k] && localStorage.getItem(KEYS[k])); } catch (e) { return false; } }
  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(LS));
      if (v && has(v.k)) { var c = clean(v); c.k = v.k; return c; }
      if (v) localStorage.removeItem(LS);
    } catch (e) {}
    return null;
  }
  function fetes() { return root.classList.contains('fetes'); }
  function apply() {
    var l = cur && !fetes() ? cur : DEF;
    var dark = l.mode === 'dark' || (l.mode === 'auto' && mq && mq.matches);
    if (dark) root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
    if (l.accent === ARC) { root.setAttribute('data-rainbow', ''); rainbowCss(); } else root.removeAttribute('data-rainbow');
    var el = document.getElementById(STYLE_ID), h = hexOf(l.accent);
    if (l.accent === DEF.accent) { if (el) el.parentNode.removeChild(el); }
    else {
      if (!el) { el = document.createElement('style'); el.id = STYLE_ID; (document.head || root).appendChild(el); }
      el.textContent = cssFor(h);
    }
  }
  function store() {
    try { if (cur) localStorage.setItem(LS, JSON.stringify(cur)); else localStorage.removeItem(LS); } catch (e) {}
  }

  cur = read();
  apply();
  if (mq) {
    var onSys = function () { if (cur && cur.mode === 'auto') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
  }
  // le thème des fêtes peut s'allumer / s'éteindre après le chargement (fetes.js, bouton Aperçu)
  if (window.MutationObserver) {
    var was = fetes();
    new MutationObserver(function () { if (fetes() !== was) { was = fetes(); apply(); } })
      .observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---- onglet Apparence ---- */
  function _t(s) { return (window.CA && window.CA.t) ? window.CA.t(s) : s; }
  var ICON = {
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
  };
  // confettis arc-en-ciel au déblocage : deux canons au bas de l'écran, ~2,5 s (rien si « réduire les animations »)
  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cv = document.createElement('canvas'), ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    var dpr = window.devicePixelRatio || 1, w = window.innerWidth, h = window.innerHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
    cv.setAttribute('aria-hidden', 'true');
    ctx.scale(dpr, dpr);
    document.body.appendChild(cv);
    var cols = ['#FF5C5C', '#FF9F43', '#FFD93D', '#4ADE80', '#38BDF8', '#7C8CFF', '#C084FC'], ps = [], i;
    for (i = 0; i < 150; i++) {
      var left = i % 2 === 0, a = (left ? -1 : 1) * (0.25 + Math.random() * 0.55), sp = (0.9 + Math.random() * 0.7) * Math.min(18, Math.max(11, h / 45));
      ps.push({ x: left ? w * 0.08 : w * 0.92, y: h + 6, vx: -Math.sin(a) * sp * 0.9, vy: -Math.cos(a) * sp * 1.15,
        s: 6 + Math.random() * 6, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length] });
    }
    var t0 = Date.now();
    (function frame() {
      var age = Date.now() - t0;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = age > 1800 ? Math.max(0, 1 - (age - 1800) / 700) : 1;
      ps.forEach(function (p) {
        p.vy += 0.34; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6); ctx.restore();
      });
      if (age < 2500) requestAnimationFrame(frame); else if (cv.parentNode) cv.parentNode.removeChild(cv);
    })();
  }
  function mount(el, opts) {
    opts = opts || {};
    var k = opts.k || 'c', timer = null;
    var l = clean(opts.initial);   // le choix enregistré dans le compte
    var names = { light: _t('Clair'), dark: _t('Sombre'), auto: _t('Auto') };
    function arcDot() {
      return '<button type="button" role="radio" class="look-dot look-dot-arc" data-accent="' + ARC + '" title="' + _t('Arc-en-ciel') + '" aria-label="' + _t('Arc-en-ciel') + '"></button>';
    }
    el.innerHTML =
      '<div class="look-card">' +
        '<h2>' + _t('Apparence') + '</h2>' +
        '<p class="look-note">' + _t('S\'applique à tout le site quand tu es connecté, sur tous tes appareils.') + '</p>' +
        '<p class="look-fetes" hidden>' + _t('Le thème des fêtes est affiché en ce moment ; ton choix reprend après.') + '</p>' +
        '<div class="look-row"><span class="look-lbl" id="look-mode-lbl">' + _t('Mode') + '</span>' +
          '<div class="look-seg" role="radiogroup" aria-labelledby="look-mode-lbl">' +
          MODES.map(function (m) {
            return '<button type="button" role="radio" class="look-mode" data-mode="' + m + '">' +
              '<span class="look-mock look-mock-' + m + '" aria-hidden="true"><i></i><i></i></span>' +
              '<span class="look-mode-tx">' + ICON[m] + names[m] + '</span></button>';
          }).join('') + '</div></div>' +
        '<div class="look-row"><span class="look-lbl" id="look-acc-lbl">' + _t('Accent') + '</span>' +
          '<div class="look-sw" role="radiogroup" aria-labelledby="look-acc-lbl">' +
          ACCENTS.map(function (a) {
            return '<button type="button" role="radio" class="look-dot" data-accent="' + a[0] + '" style="--c:' + a[1] + '" title="' + _t(a[2]) + '" aria-label="' + _t(a[2]) + '"></button>';
          }).join('') + (l.rainbow ? arcDot() : '') + '</div></div>' +
        '<div class="look-foot"><button type="button" class="look-reset">' + _t('Revenir à l\'origine') + '</button>' +
          '<button type="button" class="look-reset look-love">' + _t('J\'aime les arcs-en-ciel') + '</button>' +
          '<span class="look-msg" role="status" aria-live="polite"></span></div>' +
      '</div>';
    var msg = el.querySelector('.look-msg'), reset = el.querySelector('.look-reset'), love = el.querySelector('.look-love');
    function sync() {
      if (l.rainbow && !el.querySelector('.look-dot-arc')) el.querySelector('.look-sw').insertAdjacentHTML('beforeend', arcDot());
      love.hidden = l.rainbow;
      el.querySelectorAll('.look-mode').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-mode') === l.mode)); });
      el.querySelectorAll('.look-dot').forEach(function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-accent') === l.accent)); });
      reset.disabled = l.mode === DEF.mode && l.accent === DEF.accent;
      el.querySelector('.look-fetes').hidden = !fetes();
    }
    function say(s, tone) { msg.textContent = s; msg.className = 'look-msg' + (tone ? ' is-' + tone : ''); }
    function choose(patch) {
      l = clean(Object.assign({}, l, patch));
      set(l, k);
      sync();
      say('');
      clearTimeout(timer);
      if (!opts.save) return;
      timer = setTimeout(function () {
        say(_t('Enregistrement…'));
        var out = { mode: l.mode, accent: l.accent };
        if (l.rainbow) out.rainbow = true;
        Promise.resolve(opts.save(out)).then(function (r) {
          if (r && r.error) say(_t('Non enregistré — réessaie.'), 'bad'); else say(_t('Enregistré ✓'), 'ok');
        }, function () { say(_t('Non enregistré — réessaie.'), 'bad'); });
      }, 500);
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !el.contains(b)) return;
      if (b.hasAttribute('data-mode')) choose({ mode: b.getAttribute('data-mode') });
      else if (b.hasAttribute('data-accent')) choose({ accent: b.getAttribute('data-accent') });
      else if (b === reset) choose(DEF);
      else if (b === love) unlock();
    });
    // « J'aime les arcs-en-ciel » → pop-up → Oui : débloqué pour de bon, appliqué tout de suite
    function unlock() {
      if (!window.caDialog) return;
      window.caDialog.confirm({ title: _t('Êtes-vous sûr ?'), message: _t('Il n\'y aura pas de retour en arrière.'),
        cancel: _t('Non'), ok: _t('Oui'), icon: 'warn' }).then(function (yes) {
        if (yes !== true) return;
        choose({ rainbow: true, accent: ARC });
        var d = el.querySelector('.look-dot-arc');
        if (d) d.focus();
        confetti();
      });
    }
    // flèches au clavier dans chaque groupe (radiogroup)
    el.addEventListener('keydown', function (e) {
      var b = e.target.closest('[role="radio"]');
      if (!b || !/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/.test(e.key)) return;
      var all = Array.prototype.slice.call(b.parentNode.children), i = all.indexOf(b);
      var n = all[(i + (/Right|Down/.test(e.key) ? 1 : all.length - 1)) % all.length];
      e.preventDefault(); n.focus(); n.click();
    });
    sync();
  }

  /* ---- API ---- */
  function set(v, k) {
    if (!v) { cur = null; } else { cur = clean(v); cur.k = KEYS[k] ? k : 'c'; }
    store(); apply();
  }
  window.caLook = {
    get: function () { return cur ? clean(cur) : null; },
    set: set,
    // k donné : n'efface que si le choix en cache vient de ce compte (client 'c' / dealer 'd')
    clear: function (k) { if (!k || (cur && cur.k === k)) set(null); },
    mount: mount,
    accents: ACCENTS
  };
})();
