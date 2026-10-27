/* =========================================================
   Création Audio — couleur du fond du portail dealer (Réglages › Apparence)
   Pastilles + couleur libre ; aperçu = bandeau du portail dans la couleur.
   Stockage : admin_settings clé « dealer_theme » { bg, at }, lu en anon par
   la RPC public_dealer_theme (schema-v2.sql) dans dealer.html, qui passe ses
   textes en foncé quand le fond est clair (même seuil que DT_LIGHT ici).
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'dealer_theme', DEFAULT = '#3A3E45', DT_LIGHT = 0.35;
  var PRESETS = [
    ['#3A3E45', 'Gris (d\'origine)'], ['#2A2E36', 'Ardoise'], ['#14161A', 'Charbon'],
    ['#4A4F57', 'Gris moyen'], ['#E4E6EA', 'Gris clair'], ['#ECE6DE', 'Sable']
  ];
  var $ = function (s) { return document.querySelector(s); };
  var state = DEFAULT, pick, hexIn, resetBtn, msgEl, preview, saveTimer = null;

  function norm(h) {
    h = String(h || '').trim().toUpperCase();
    if (/^[0-9A-F]{6}$/.test(h)) h = '#' + h;
    return /^#[0-9A-F]{6}$/.test(h) ? h : null;
  }
  function lum(h) {
    return [1, 3, 5].map(function (i) {
      var v = parseInt(h.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }).reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function msg(text, tone, detail) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.title = detail || '';
    msgEl.className = 'set-msg' + (tone ? ' is-' + tone : '');
  }
  function syncUi() {
    document.querySelectorAll('.dt-sw').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.hex === state)); });
    if (pick.value.toUpperCase() !== state) pick.value = state.toLowerCase();
    if (document.activeElement !== hexIn) hexIn.value = state;
    resetBtn.disabled = state === DEFAULT;
    preview.style.setProperty('--dt-bg', state);
    preview.classList.toggle('is-light', lum(state) > DT_LIGHT);
  }
  // aperçu immédiat, enregistrement différé (le sélecteur libre envoie des dizaines de valeurs)
  function choose(h) {
    h = norm(h);
    if (!h || h === state) return;
    state = h;
    syncUi();
    msg('');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  function save() {
    var sb = window.CA && window.CA.sb;
    if (!sb) { msg('non enregistré', 'warn'); return; }
    var at = new Date().toISOString();
    msg('enregistrement…');
    sb.from('admin_settings').upsert({ key: KEY, value: { bg: state, at: at }, updated_at: at }).then(function (res) {
      if (res.error) msg('non enregistré', 'warn', res.error.message);
      else msg('enregistré ✓', 'ok');
    }, function (err) {
      msg('non enregistré', 'warn', err && err.message ? err.message : String(err));
    });
  }
  function load() {
    var sb = window.CA && window.CA.sb;
    if (!sb) return;
    sb.from('admin_settings').select('value').eq('key', KEY).maybeSingle().then(function (res) {
      if (res.error) { msg('lecture impossible', 'warn', res.error.message); return; }
      var h = norm(res.data && res.data.value && res.data.value.bg);
      if (h) { state = h; syncUi(); }
    }, function () {});
  }

  function init() {
    var box = $('#dt-swatches');
    if (!box) return;
    pick = $('#dt-pick'); hexIn = $('#dt-hex'); resetBtn = $('#dt-reset'); msgEl = $('#dt-msg'); preview = $('#dt-preview');
    box.innerHTML = PRESETS.map(function (p) {
      return '<button type="button" class="dt-sw" role="radio" data-hex="' + p[0] + '" aria-label="' + p[1] +
             '" title="' + p[1] + '" style="--sw:' + p[0] + '"></button>';
    }).join('');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.dt-sw');
      if (b) choose(b.dataset.hex);
    });
    pick.addEventListener('input', function () { choose(pick.value); });
    hexIn.addEventListener('input', function () { var h = norm(hexIn.value); if (h) choose(h); });
    hexIn.addEventListener('blur', function () { hexIn.value = state; });
    resetBtn.addEventListener('click', function () { choose(DEFAULT); });
    syncUi();
    if (window.CA && window.CA.onAdminReady) window.CA.onAdminReady(load);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
