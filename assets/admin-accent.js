/* =========================================================
   Création Audio — couleur d'accent de l'admin (Réglages › Apparence)
   Théo choisit la couleur des boutons et de tous les accents de l'admin
   (onglet actif, liens, cases, focus…). Le logo, le document facture
   (#fx-invoice, figé dans facture.css) et le site public gardent l'orange
   de la marque.
   À partir d'une couleur on dérive les jetons consommés partout :
     --ember      la couleur (boutons, soulignés, cases…)
     --ember-dim  survol / version foncée
     --on-ember   texte posé sur l'accent : encre ou blanc, le plus contrasté
     --ember-ink  texte / liens de la couleur : assombri en clair, éclairci en
                  sombre, jusqu'au contraste AA (4,5:1) sur les fonds de l'admin
   (--ring, ::selection et les halos des boutons en découlent par color-mix.)
   Stockage : admin_settings clé « apparence » { accent, at } — synchro entre
   appareils — + localStorage (ca-accent, ca-accent-css), appliqué dès le
   <head> de la page admin pour éviter un éclair orange au chargement.
   Orange d'origine = aucune surcharge : les jetons des feuilles s'appliquent.
   ========================================================= */
(function () {
  'use strict';

  var DEFAULT = '#FF6A2B', KEY = 'apparence', LS_HEX = 'ca-accent', LS_CSS = 'ca-accent-css', STYLE_ID = 'ca-accent';
  var PRESETS = [
    ['#FF6A2B', 'Orange (d\'origine)'], ['#E5484D', 'Rouge'], ['#EF3E82', 'Rose'], ['#8B5CF6', 'Violet'],
    ['#3B82F6', 'Bleu'], ['#14B8A6', 'Turquoise'], ['#22C55E', 'Vert'], ['#F59E0B', 'Ambre']
  ];
  var LIGHT_BGS = ['#FFFFFF', '#F6F6F4', '#EFEDE8'];   // --paper, --wash, --wash-2 en clair
  var DARK_BGS = ['#1C1F26', '#141619', '#20242B'];    // --paper, --wash, --wash-2 en sombre
  var INK = '#181A1F';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---- couleurs ---- */
  function norm(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h == null ? '' : h).trim());
    return m ? '#' + m[1].toUpperCase() : null;
  }
  function rgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function toHex(c) {
    return '#' + c.map(function (v) {
      v = Math.round(Math.max(0, Math.min(255, v)));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('').toUpperCase();
  }
  function mix(a, b, t) { return [0, 1, 2].map(function (i) { return a[i] + (b[i] - a[i]) * t; }); }   // t = part de b
  function lum(c) {
    var v = c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(a, b) { var la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  // Variante « texte » : la plus proche de l'accent qui atteint 4,5:1 sur tous les fonds donnés.
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
    return ':root{--ember:' + h + ';--ember-dim:' + toHex(mix(c, [0, 0, 0], 0.12)) + ';--on-ember:' + on +
           ';--ember-ink:' + inkVariant(c, LIGHT_BGS, '#000000') + ';}' +
           ':root[data-theme="dark"]{--ember-ink:' + inkVariant(c, DARK_BGS, '#FFFFFF') + ';}';
  }

  /* ---- application + cache local ---- */
  var state = DEFAULT;
  function apply(h) {
    var el = document.getElementById(STYLE_ID);
    if (h === DEFAULT) {
      if (el) el.parentNode.removeChild(el);
    } else {
      if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
      el.textContent = cssFor(h);
    }
    try {
      if (h === DEFAULT) { localStorage.removeItem(LS_HEX); localStorage.removeItem(LS_CSS); }
      else { localStorage.setItem(LS_HEX, h); localStorage.setItem(LS_CSS, cssFor(h)); }
    } catch (e) {}
  }
  function cached() { try { return norm(localStorage.getItem(LS_HEX)) || DEFAULT; } catch (e) { return DEFAULT; } }

  /* ---- page Réglages › Apparence ---- */
  var pick, hexIn, resetBtn, msgEl, saveTimer = null;
  function msg(text, tone, detail) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.title = detail || '';
    msgEl.className = 'set-msg' + (tone ? ' is-' + tone : '');
  }
  function syncUi() {
    $$('.acc-sw').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.hex === state)); });
    if (pick && pick.value.toUpperCase() !== state) pick.value = state.toLowerCase();
    if (hexIn && document.activeElement !== hexIn) hexIn.value = state;
    if (resetBtn) resetBtn.disabled = state === DEFAULT;
  }
  // Aperçu immédiat sur tout l'admin ; enregistrement différé (le sélecteur libre
  // envoie des dizaines de valeurs pendant qu'on glisse).
  function choose(h) {
    h = norm(h);
    if (!h || h === state) return;
    state = h;
    apply(h);
    syncUi();
    msg('');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  function save() {
    var sb = window.CA && window.CA.sb;
    if (!sb) { msg('cet appareil seulement', 'warn'); return; }
    var at = new Date().toISOString();
    msg('enregistrement…');
    sb.from('admin_settings').upsert({ key: KEY, value: { accent: state, at: at }, updated_at: at }).then(function (res) {
      if (res.error) msg('cet appareil seulement', 'warn', res.error.message);
      else msg('enregistré ✓', 'ok');
    }, function (err) {
      msg('cet appareil seulement', 'warn', err && err.message ? err.message : String(err));
    });
  }
  // Après connexion : la couleur enregistrée en ligne (choisie sur un autre appareil ?) l'emporte.
  function loadRemote() {
    var sb = window.CA && window.CA.sb;
    if (!sb) return;
    sb.from('admin_settings').select('value').eq('key', KEY).maybeSingle().then(function (res) {
      if (res.error || !res.data || !res.data.value) return;
      var h = norm(res.data.value.accent);
      if (!h || h === state) return;
      state = h;
      apply(h);
      syncUi();
    }, function () {});
  }

  function initUi() {
    var box = $('#acc-swatches');
    if (!box) return;
    pick = $('#acc-pick'); hexIn = $('#acc-hex'); resetBtn = $('#acc-reset'); msgEl = $('#acc-msg');
    box.innerHTML = PRESETS.map(function (p) {
      return '<button type="button" class="acc-sw" role="radio" data-hex="' + p[0] + '" aria-label="' + p[1] +
             '" title="' + p[1] + '" style="--sw:' + p[0] + '"></button>';
    }).join('');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.acc-sw');
      if (b) choose(b.dataset.hex);
    });
    if (pick) pick.addEventListener('input', function () { choose(pick.value); });
    if (hexIn) {
      hexIn.addEventListener('input', function () { var h = norm(hexIn.value); if (h) choose(h); });
      hexIn.addEventListener('blur', function () { hexIn.value = state; });
    }
    if (resetBtn) resetBtn.addEventListener('click', function () { choose(DEFAULT); });
    syncUi();
  }

  function init() {
    state = cached();
    apply(state);   // recalcule le cache (au cas où l'algorithme a changé depuis)
    initUi();
    if (window.CA && window.CA.onAdminReady) window.CA.onAdminReady(loadRemote);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
