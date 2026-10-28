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
  function hexOf(a) { for (var i = 0; i < ACCENTS.length; i++) if (ACCENTS[i][0] === a) return ACCENTS[i][1]; return null; }

  /* ---- état ---- */
  function clean(v) {
    v = v || {};
    return { mode: MODES.indexOf(v.mode) >= 0 ? v.mode : DEF.mode, accent: hexOf(v.accent) ? v.accent : DEF.accent };
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
  function mount(el, opts) {
    opts = opts || {};
    var k = opts.k || 'c', timer = null;
    var l = clean(opts.initial);   // le choix enregistré dans le compte
    var names = { light: _t('Clair'), dark: _t('Sombre'), auto: _t('Auto') };
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
          }).join('') + '</div></div>' +
        '<div class="look-foot"><button type="button" class="look-reset">' + _t('Revenir à l\'origine') + '</button>' +
          '<span class="look-msg" role="status" aria-live="polite"></span></div>' +
      '</div>';
    var msg = el.querySelector('.look-msg'), reset = el.querySelector('.look-reset');
    function sync() {
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
        Promise.resolve(opts.save({ mode: l.mode, accent: l.accent })).then(function (r) {
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
    });
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
