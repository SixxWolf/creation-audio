/* =========================================================
   Création Audio — thème des fêtes du site public (Réglages › Apparence)
   Interrupteur + dates (bornes incluses) : le skin de Noël (fetes.css /
   fetes.js, chargés par nav.js) ne s'affiche que si « Activé » est coché
   ET que la date du visiteur est dans la fenêtre. Hors des dates : site normal.
   Stockage : admin_settings clé « fetes » { on, from, to, at }, lu en anon par
   la RPC public_fetes (schema-v2.sql). « Aperçu » ouvre le site avec ?fetes=1
   (forcé pour cet onglet seulement, ?fetes=0 l'enlève).
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'fetes';
  var $ = function (s) { return document.querySelector(s); };
  var onEl, fromEl, toEl, stateEl, msgEl, saveTimer = null;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // fenêtre proposée : 1er déc. → 6 janv. qui suit (l'an prochain si les fêtes de cette année sont passées)
  function defaults() {
    var now = new Date(), y = now.getFullYear();
    if (now.getMonth() === 0 && now.getDate() <= 6) y -= 1;
    return { on: false, from: y + '-12-01', to: (y + 1) + '-01-06' };
  }
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function short(s) { var p = String(s || '').split('-'); return p.length === 3 ? (+p[2]) + ' ' + MOIS[+p[1] - 1] : ''; }

  function msg(text, tone, detail) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.title = detail || '';
    msgEl.className = 'set-msg' + (tone ? ' is-' + tone : '');
  }
  function read() { return { on: onEl.checked, from: fromEl.value, to: toEl.value }; }
  function fill(v) {
    onEl.checked = !!v.on;
    fromEl.value = v.from || '';
    toEl.value = v.to || '';
    syncState();
  }
  // état en mots : En ligne / Dès le 1 déc. / Terminé / Éteint
  function syncState() {
    var v = read(), today = iso(new Date()), txt, tone;
    if (!v.on) { txt = 'Éteint'; tone = 'off'; }
    else if (!v.from || !v.to || v.to < v.from) { txt = 'Dates à revoir'; tone = 'warn'; }
    else if (today < v.from) { txt = 'Dès le ' + short(v.from); tone = 'soon'; }
    else if (today > v.to) { txt = 'Terminé'; tone = 'off'; }
    else { txt = 'En ligne'; tone = 'live'; }
    stateEl.textContent = txt;
    stateEl.className = 'fe-state is-' + tone;
  }

  function save() {
    var sb = window.CA && window.CA.sb, v = read();
    if (v.on && (!v.from || !v.to || v.to < v.from)) { msg('fin avant le début', 'warn'); return; }
    if (!sb) { msg('non enregistré', 'warn'); return; }
    var at = new Date().toISOString();
    msg('enregistrement…');
    sb.from('admin_settings').upsert({ key: KEY, value: { on: v.on, from: v.from, to: v.to, at: at }, updated_at: at }).then(function (res) {
      if (res.error) msg('non enregistré', 'warn', res.error.message);
      else msg('enregistré ✓', 'ok');
    }, function (err) {
      msg('non enregistré', 'warn', err && err.message ? err.message : String(err));
    });
  }
  function changed() {
    syncState();
    msg('');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }

  function load() {
    var sb = window.CA && window.CA.sb;
    if (!sb) return;
    sb.from('admin_settings').select('value').eq('key', KEY).maybeSingle().then(function (res) {
      if (res.error) { msg('lecture impossible', 'warn', res.error.message); return; }
      var v = res.data && res.data.value;
      if (v && (v.from || v.to)) fill(v);
    }, function () {});
  }

  function init() {
    onEl = $('#fe-on'); fromEl = $('#fe-from'); toEl = $('#fe-to'); stateEl = $('#fe-state'); msgEl = $('#fe-msg');
    if (!onEl || !fromEl || !toEl || !stateEl) return;
    fill(defaults());
    onEl.addEventListener('change', changed);
    fromEl.addEventListener('change', changed);
    toEl.addEventListener('change', changed);
    if (window.CA && window.CA.onAdminReady) window.CA.onAdminReady(load);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
