/* =========================================================
   Création Audio — Atelier › Imprimantes (tableau de bord de la ferme)
   Lit la table `printers` (état poussé toutes les ~3 s par le relais de l'atelier :
   tools/farm-relay/relay.js) et affiche une carte par imprimante : caméra, fichier,
   progression, couche, temps restant, buse, plateau.
   Caméra : flux go2rtc du PC de l'atelier (127.0.0.1:1984), visible seulement depuis ce PC.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var GO2RTC = 'http://127.0.0.1:1984';
  var POLL = 3000;           // ms entre deux lectures
  var RELAY_STALE = 45000;   // ms sans nouvelle du relais = relais éteint

  var panel = $('.tabpanel[data-panel="imprimantes"]');
  var gridEl = $('#fm-grid'), sumEl = $('#fm-summary');
  if (!panel || !gridEl) return;

  var cards = {}, timer = null, camOk = null, busy = false;

  var STATES = {
    RUNNING: { t: 'En impression', k: 'run' },
    PREPARE: { t: 'Préparation', k: 'run' },
    PAUSE:   { t: 'En pause', k: 'warn' },
    FINISH:  { t: 'Terminée', k: 'good' },
    FAILED:  { t: 'Échec', k: 'bad' },
    IDLE:    { t: 'Libre', k: 'idle' }
  };

  function fmtLeft(min) {
    if (min == null || min < 0) return '—';
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? h + ' h ' + (m < 10 ? '0' : '') + m : m + ' min';
  }
  function fmtEnd(min) {
    if (min == null || min <= 0) return '';
    return new Date(Date.now() + min * 60000).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  }
  function deg(v) { return v == null ? '—' : v + '°'; }

  // Disponibilité du flux go2rtc (seulement depuis le PC de l'atelier) — testée une fois, retestée au retour sur l'onglet
  function probeCam() {
    return fetch(GO2RTC + '/api/streams', { mode: 'cors' }).then(function (r) { return r.ok; }, function () { return false; });
  }

  function makeCard(p) {
    var el = document.createElement('article');
    el.className = 'fm-card'; el.setAttribute('data-id', p.id);
    el.innerHTML =
      '<header class="fm-head"><h2 class="fm-name"></h2><span class="fm-chip"></span></header>' +
      '<div class="fm-cam"><span class="fm-cam-off">Caméra non disponible ici</span></div>' +
      '<div class="fm-body">' +
        '<p class="fm-file"></p>' +
        '<div class="fm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>' +
        '<dl class="fm-stats">' +
          '<div><dt>Avancement</dt><dd data-f="pct"></dd></div>' +
          '<div><dt>Couche</dt><dd data-f="layer"></dd></div>' +
          '<div><dt>Reste</dt><dd data-f="left"></dd></div>' +
          '<div><dt>Fin vers</dt><dd data-f="end"></dd></div>' +
          '<div><dt>Buse</dt><dd data-f="nozzle"></dd></div>' +
          '<div><dt>Plateau</dt><dd data-f="bed"></dd></div>' +
        '</dl>' +
      '</div>';
    el._cam = false;
    return el;
  }

  function attachCam(el, p) {
    var box = $('.fm-cam', el);
    if (!p.cam_src) return;
    if (camOk && !el._cam) {
      var f = document.createElement('iframe');
      f.className = 'fm-frame'; f.setAttribute('loading', 'lazy'); f.setAttribute('title', 'Caméra ' + p.name);
      f.setAttribute('allow', 'autoplay; fullscreen');
      f.src = GO2RTC + '/stream.html?src=' + encodeURIComponent(p.cam_src) + '&mode=mse';
      box.appendChild(f); el._cam = true; box.classList.add('is-on');
    } else if (!camOk && el._cam) {
      var old = $('.fm-frame', box); if (old) old.remove();
      el._cam = false; box.classList.remove('is-on');
    }
  }

  function fill(el, p) {
    var s = p.status || {}, age = p.seen_at ? Date.now() - new Date(p.seen_at).getTime() : Infinity;
    var relayOff = age > RELAY_STALE, offline = relayOff || s.online === false;
    var st = offline ? { t: relayOff ? 'Relais éteint' : 'Hors ligne', k: 'off' } : (STATES[s.state] || { t: s.state || '—', k: 'idle' });
    var active = !offline && (s.state === 'RUNNING' || s.state === 'PAUSE' || s.state === 'PREPARE');
    var pct = (!offline && s.pct != null) ? Math.max(0, Math.min(100, s.pct)) : 0;
    if (s.err && !offline && s.state !== 'RUNNING') st = { t: 'Erreur', k: 'bad' };

    $('.fm-name', el).textContent = p.name;
    var chip = $('.fm-chip', el); chip.textContent = st.t; chip.setAttribute('data-k', st.k);
    el.setAttribute('data-k', st.k);
    $('.fm-file', el).textContent = (active || s.state === 'FINISH') && s.file ? s.file : '';
    var bar = $('.fm-bar', el); bar.setAttribute('aria-valuenow', pct); $('i', bar).style.width = pct + '%';
    bar.classList.toggle('is-off', !active);

    var show = active || s.state === 'FINISH';
    var f = {
      pct: show && s.pct != null ? s.pct + ' %' : '—',
      layer: show && s.layer != null ? s.layer + ' / ' + (s.layers != null ? s.layers : '—') : '—',
      left: active ? fmtLeft(s.left) : '—',
      end: active ? (fmtEnd(s.left) || '—') : '—',
      nozzle: offline ? '—' : deg(s.nozzle) + (s.nozzle_t ? ' / ' + s.nozzle_t + '°' : ''),
      bed: offline ? '—' : deg(s.bed) + (s.bed_t ? ' / ' + s.bed_t + '°' : '')
    };
    Object.keys(f).forEach(function (k) { var d = $('[data-f="' + k + '"]', el); if (d) d.textContent = f[k]; });
    attachCam(el, p);
    return st.k;
  }

  function render(rows) {
    if (!rows.length) {
      gridEl.innerHTML = '<p class="muted fm-empty">Aucune imprimante. Lance le relais de l\'atelier.</p>';
      cards = {}; sumEl.textContent = ''; return;
    }
    var empty = $('.fm-empty', gridEl); if (empty) empty.remove();
    var counts = { run: 0, idle: 0, off: 0, other: 0 };
    rows.forEach(function (p) {
      var el = cards[p.id];
      if (!el) { el = cards[p.id] = makeCard(p); gridEl.appendChild(el); }
      var k = fill(el, p);
      if (k === 'run') counts.run++; else if (k === 'idle' || k === 'good') counts.idle++; else if (k === 'off') counts.off++; else counts.other++;
    });
    // ordre = colonne sort puis nom
    rows.forEach(function (p) { gridEl.appendChild(cards[p.id]); });
    Object.keys(cards).forEach(function (id) {
      if (!rows.some(function (p) { return p.id === id; })) { cards[id].remove(); delete cards[id]; }
    });
    var parts = [];
    if (counts.run) parts.push(counts.run + ' en impression');
    if (counts.idle) parts.push(counts.idle + (counts.idle > 1 ? ' libres' : ' libre'));
    if (counts.other) parts.push(counts.other + ' à voir');
    if (counts.off) parts.push(counts.off + ' hors ligne');
    sumEl.textContent = parts.join(' · ');
  }

  function load() {
    if (busy) return; busy = true;
    var cam = camOk === null ? probeCam().then(function (ok) { camOk = ok; }) : Promise.resolve();
    cam.then(function () {
      return sb.from('printers').select('id,name,model,cam_src,sort,status,seen_at').order('sort').order('name');
    }).then(function (res) {
      busy = false;
      if (res.error) { gridEl.innerHTML = '<p class="muted fm-empty">Lecture impossible : ' + esc(res.error.message) + '</p>'; return; }
      render(res.data || []);
    }, function () { busy = false; });
  }

  function start() { stop(); camOk = null; load(); timer = setInterval(function () { if (!document.hidden) load(); }, POLL); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'imprimantes') start(); else stop();
  };
  var refreshBtn = $('#fm-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function () { camOk = null; load(); });
})();
