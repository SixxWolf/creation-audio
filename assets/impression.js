/* =========================================================
   Création Audio — page IMPRESSION 3D : mouvement + demande de soumission.
   - apparition au défilement (.rv / .en-steps → .is-in) ;
   - héros : le plateau se remplit pièce après pièce (compteur + barre), en boucle, en pause hors écran ;
   - exemples de prix : les montants comptent de 0 à leur valeur à l'apparition ;
   - cartes de service : « Demander » présélectionne le service dans le formulaire ;
   - formulaire : puces (service, matériau), quantité, description, fichiers 3D (STL/3MF/STEP/OBJ, 3 max,
     50 Mo chacun, glisser-déposer). L'envoi compose le message puis ouvre la Messagerie avec les fichiers
     (CA.msg.open({ topic, ref, body, files }) : messagerie.js les téléverse dans le bucket « print-files »).
   Tout mouvement est coupé sous prefers-reduced-motion.
   ========================================================= */
(function () {
  'use strict';
  var CA0 = window.CA || {};
  var _t = CA0.t || function (s) { return s; };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); }
  function priceShort(n) { return CA0.priceShort ? CA0.priceShort(n) : n + ' $'; }

  /* ---------- prix d'exemple : 28 $ en français, $28 en anglais ---------- */
  var prices = all('#im-ex .en-unit[data-price]');
  var countUp = function () {};
  prices.forEach(function (el) { el.textContent = priceShort(+el.getAttribute('data-price')); });
  if (hasIO && !reduce) {
    prices.forEach(function (el) { el.textContent = priceShort(0); });
    countUp = function () {
      prices.forEach(function (el, i) {
        var target = +el.getAttribute('data-price'), t0 = null, delay = 200 + i * 140, dur = 700;
        var step = function (ts) {
          if (t0 == null) t0 = ts;
          var p = Math.max(0, Math.min(1, (ts - t0 - delay) / dur)), e = 1 - Math.pow(1 - p, 3);
          el.textContent = priceShort(Math.round(target * e));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    };
  }

  /* ---------- apparition au défilement ---------- */
  var revealEls = all('.rv, .en-steps');
  if (hasIO && document.documentElement.classList.contains('en-js')) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
        if (e.target.id === 'im-ex') countUp();
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
    countUp();
  }

  /* ---------- héros : le plateau se remplit ---------- */
  var bed = $('im-bed'), plate = $('im-plate');
  if (bed && plate && !reduce) {
    var parts = all('.im-part', plate), nEl = $('im-n'), barEl = $('im-bar-f');
    var setCount = function (k) { nEl.textContent = k; barEl.style.width = (k / parts.length * 100) + '%'; };
    var timers = [], visible = true;
    var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
    var stop = function () { timers.forEach(clearTimeout); timers = []; };
    var reset = function () {
      plate.classList.remove('is-done');
      plate.classList.add('is-prep');
      parts.forEach(function (p) { p.classList.remove('is-on'); });
      setCount(0);
    };
    var cycle = function () {
      stop();
      plate.classList.add('is-reset'); reset();
      var gap = 120, t0 = 700;
      later(function () { plate.classList.remove('is-reset'); }, 260);
      parts.forEach(function (p, i) {
        later(function () { p.classList.add('is-on'); setCount(i + 1); }, t0 + i * gap);
      });
      later(function () { plate.classList.add('is-done'); }, t0 + parts.length * gap + 400);
      later(cycle, t0 + parts.length * gap + 4200);
    };
    reset();
    var sync = function () { if (visible && !document.hidden) cycle(); else stop(); };
    if (hasIO) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; sync(); }, { threshold: 0.25 }).observe(bed);
    } else { sync(); }
    document.addEventListener('visibilitychange', sync);
  }

  /* ---------- formulaire de demande ---------- */
  var form = $('im-form');
  if (!form) return;
  var MAX_FILES = 3, MAX_BYTES = 50 * 1048576, EXT = /\.(stl|3mf|step|stp|obj)$/i;
  var desc = $('im-desc'), qty = $('im-qty'), status = $('im-status'), submit = $('im-submit');
  var drop = $('im-drop'), fileIn = $('im-file'), list = $('im-flist');
  var files = [], handed = false;

  function say(text, cls) { status.textContent = text || ''; status.className = 'en-status' + (cls ? ' ' + cls : ''); }
  function flag(el, bad) { el.classList.toggle('is-bad', bad); el.setAttribute('aria-invalid', bad ? 'true' : 'false'); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtSize(b) {
    return b >= 1048576 ? (b / 1048576).toLocaleString(CA0.locale, { maximumFractionDigits: 1 }) + _t(' Mo') : Math.max(1, Math.round(b / 1024)) + _t(' Ko');
  }
  function paint() {
    list.innerHTML = files.map(function (f, i) {
      return '<li class="im-file"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12 4 7.5"/></svg>' +
        '<span class="im-file-n">' + esc(f.name) + '</span><em>' + esc(fmtSize(f.size)) + '</em>' +
        '<button type="button" class="im-file-x" data-i="' + i + _t('" aria-label="Retirer le fichier ') + esc(f.name) + '">×</button></li>';
    }).join('');
    list.hidden = !files.length;
    drop.classList.toggle('is-full', files.length >= MAX_FILES);
  }
  function add(fl) {
    var bad = '';
    [].slice.call(fl || []).forEach(function (f) {
      if (!EXT.test(f.name)) { bad = _t('Formats acceptés : STL, 3MF, STEP, OBJ.'); return; }
      if (f.size > MAX_BYTES) { bad = _t('Fichier trop lourd (50 Mo maximum).'); return; }
      if (files.some(function (x) { return x.name === f.name && x.size === f.size; })) return;
      if (files.length >= MAX_FILES) { bad = _t('Au plus 3 fichiers 3D par demande.'); return; }
      files.push(f);
    });
    say(bad, bad ? 'is-err' : '');
    if (files.length) flag(desc, false);
    paint();
  }

  fileIn.addEventListener('change', function () { add(fileIn.files); fileIn.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer) add(e.dataTransfer.files); });
  list.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.im-file-x') : null;
    if (!b) return;
    files.splice(+b.getAttribute('data-i'), 1);
    say(''); paint();
  });

  // « Demander » sur une carte de service : présélectionne ce service
  all('.im-svc-go[data-svc]').forEach(function (a) {
    a.addEventListener('click', function () {
      var r = form.querySelector('input[name="im-svc"][value="' + a.getAttribute('data-svc') + '"]');
      if (r) r.checked = true;
    });
  });

  function chosen(name) {
    var r = form.querySelector('input[name="' + name + '"]:checked');
    return r ? r.parentNode.querySelector('span').textContent.trim() : '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = desc.value.trim();
    var bad = !d && !files.length;
    flag(desc, bad);
    if (bad) { say(_t('Ajoute un fichier ou décris ta pièce.'), 'is-err'); desc.focus(); return; }
    var q = Math.max(1, Math.min(10000, parseInt(qty.value, 10) || 1));
    var body = _t('Bonjour, je veux une soumission pour de l\'impression 3D.') + '\n' +
      _t('Service :') + ' ' + chosen('im-svc') + '\n' +
      _t('Matériau :') + ' ' + chosen('im-mat') + '\n' +
      _t('Quantité :') + ' ' + q + (d ? '\n' + _t('Détails :') + ' ' + d : '');
    var CA = window.CA || {};
    if (!CA.loadMsg) { say(_t('La messagerie est indisponible. Écris-nous à contact@creationaudio.ca.'), 'is-err'); return; }
    say(''); submit.disabled = true;
    CA.loadMsg().then(function (m) {
      handed = true;
      m.open({ topic: 'autre', ref: _t('Impression 3D'), body: body, files: files.slice() });
    }, function () {
      say(_t('La messagerie est indisponible. Écris-nous à contact@creationaudio.ca.'), 'is-err');
    }).then(function () { submit.disabled = false; });
  });
  desc.addEventListener('input', function () { flag(desc, false); });

  // la demande est partie (Messagerie) : on vide le formulaire
  document.addEventListener('ca:msg-change', function () {
    if (!handed) return;
    handed = false;
    files = []; paint();
    desc.value = ''; qty.value = 1;
    say(_t('Demande envoyée.'));
  });
})();
