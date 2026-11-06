/* =========================================================
   Création Audio — page ENTRETIEN : machine à points + calculateur + demande.
   - héros : chaque point (pastille ou repère sur la machine) déplace le projecteur et change la légende ;
   - bloc unique : 25 $ × nombre de A1, les autres modèles « sur évaluation », puis la ville ;
   - envoi : compose le message puis ouvre la Messagerie
     (lien #et-ask [data-msg], géré par nav.js) : la demande arrive dans l'onglet Messages de l'admin.
   Rien ne boucle ; tout mouvement est coupé sous prefers-reduced-motion.
   ========================================================= */
(function () {
  'use strict';
  var CA0 = window.CA || {};
  var _t = CA0.t || function (s) { return s; };
  var tn = CA0.tn || function (n, one, many) { return (n >= 2 ? many : one).replace('{n}', n); };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  function $(id) { return document.getElementById(id); }
  function all(sel, el) { return [].slice.call((el || document).querySelectorAll(sel)); }
  function priceShort(n) { return CA0.priceShort ? CA0.priceShort(n) : n + ' $'; }

  // prix affichés : 25 $ en français, $25 en anglais
  all('.et-unit[data-price]').forEach(function (el) { el.textContent = priceShort(+el.getAttribute('data-price')); });

  /* ---------- apparition au défilement (une seule fois) ---------- */
  var revealEls = all('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    root.classList.add('et-anim');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -4% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---------- héros : la machine expliquée ---------- */
  var stage = $('et-stage'), view = $('et-view'), points = all('#et-points > li');
  if (stage && view && points.length) {
    var capN = $('et-cap-n'), capTx = $('et-cap-tx'), cap = $('et-cap'), current = -1;
    var pins = points.map(function (li, i) {
      var pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'et-pin';
      pin.textContent = i + 1;
      pin.tabIndex = -1;                        // les pastilles sont les contrôles au clavier
      pin.setAttribute('aria-hidden', 'true');
      pin.style.setProperty('--x', li.getAttribute('data-x') + '%');
      pin.style.setProperty('--y', li.getAttribute('data-y') + '%');
      pin.style.setProperty('--i', i);
      view.appendChild(pin);
      return pin;
    });

    var select = function (i) {
      if (i === current) return;
      current = i;
      var li = points[i];
      points.forEach(function (p, k) { p.querySelector('.et-chip').setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
      pins.forEach(function (p, k) { p.classList.toggle('is-on', k === i); });
      stage.style.setProperty('--ax', li.getAttribute('data-x') + '%');
      stage.style.setProperty('--ay', li.getAttribute('data-y') + '%');

      capN.textContent = i + 1;
      capTx.textContent = '';
      var title = document.createElement('b');
      title.textContent = li.querySelector('.et-chip-l').textContent;
      capTx.appendChild(title);
      var txt = document.createElement('p');
      txt.textContent = li.querySelector('.et-point-tx p').textContent;
      capTx.appendChild(txt);
      var noteEl = li.querySelector('.et-point-tx small');
      if (noteEl) {
        var note = document.createElement('p');
        note.className = 'et-cap-note';
        note.textContent = noteEl.textContent;
        capTx.appendChild(note);
      }
      // photo réelle d'un point : <li data-photo="assets/entretien/galerie/xxx.webp">
      var old = cap.querySelector('.et-cap-ph');
      if (old) old.remove();
      var photo = li.getAttribute('data-photo');
      if (photo) {
        var img = document.createElement('img');
        img.className = 'et-cap-ph';
        img.src = photo;
        img.alt = '';
        cap.appendChild(img);
      }
      if (!reduce) {
        capTx.classList.remove('is-swap');
        void capTx.offsetWidth;
        capTx.classList.add('is-swap');
      }
    };

    var wire = function (el, i) {
      el.addEventListener('click', function () { select(i); });
      el.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') select(i); });
    };
    points.forEach(function (li, i) {
      wire(li.querySelector('.et-chip'), i);
      wire(pins[i], i);
    });

    root.classList.add('et-ready');
    select(0);
  }

  /* ---------- calculateur et demande : un seul bloc ---------- */
  var form = $('demande');
  if (!form) return;
  var rows = all('.et-model', form), totalEl = $('et-total'), extraEl = $('et-extra');
  var unit = +form.querySelector('[data-model="a1"]').getAttribute('data-price') || 25;
  var qty = {};
  rows.forEach(function (r) { qty[r.getAttribute('data-model')] = +r.getAttribute('data-qty') || 0; });
  var shown = unit * qty.a1, raf = 0;

  var bump = function (el) {
    if (reduce) return;
    el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump');
  };
  var countTo = function (target) {
    cancelAnimationFrame(raf);
    if (reduce || document.hidden) { shown = target; totalEl.textContent = priceShort(target); return; }
    var from = shown, t0 = null, dur = 320;
    var step = function (ts) {
      if (t0 == null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      shown = Math.round(from + (target - from) * e);
      totalEl.textContent = priceShort(shown);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  var render = function (animate) {
    rows.forEach(function (r) {
      var m = r.getAttribute('data-model'), q = qty[m];
      r.querySelector('.et-qty').textContent = q;
      r.querySelector('.et-minus').disabled = q <= 0;
      r.querySelector('.et-plus').disabled = q >= 99;
    });
    var others = qty.xp + qty.snap;
    var onlyOthers = !qty.a1 && others > 0;
    totalEl.classList.toggle('is-text', onlyOthers);
    extraEl.hidden = !others || onlyOthers;
    if (others && !onlyOthers) extraEl.textContent = tn(others, '+ {n} machine sur évaluation', '+ {n} machines sur évaluation');
    if (onlyOthers) {
      cancelAnimationFrame(raf);
      shown = 0;
      totalEl.textContent = _t('Sur évaluation');
    } else if (animate) {
      countTo(unit * qty.a1);
    } else {
      totalEl.textContent = priceShort(unit * qty.a1);
    }
  };
  render(false);

  form.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.et-minus, .et-plus') : null;
    if (!b || b.disabled) return;
    var row = b.closest('.et-model'), m = row.getAttribute('data-model');
    qty[m] = Math.max(0, Math.min(99, qty[m] + (b.classList.contains('et-plus') ? 1 : -1)));
    bump(row.querySelector('.et-qty'));
    render(true);
    status.className = 'et-status';
    status.textContent = '';
  });

  var city = $('et-city'), other = $('et-other'), status = $('et-status'), submit = $('et-submit');

  function flag(el, bad) { el.classList.toggle('is-bad', bad); el.setAttribute('aria-invalid', bad ? 'true' : 'false'); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var c = city.value.trim(), o = other.value.trim();
    var noMachine = !qty.a1 && !qty.xp && !qty.snap && !o;
    flag(city, !c);
    status.className = 'et-status';
    if (!c || noMachine) {
      status.className = 'et-status is-err';
      status.textContent = _t('Indique ta ville et au moins une machine.');
      if (!c) city.focus(); else other.focus();
      return;
    }
    status.textContent = '';
    window.CA.demande.submit({
      details: { machines: { a1: qty.a1, xp: qty.xp, snap: qty.snap }, city: c, other: o, monthly: unit * qty.a1 },
      files: []
    });
  });
  city.addEventListener('input', function () { flag(city, false); });

  window.CA.demande.init({
    kind: 'maintenance', form: form, status: status,
    onBusy: function (on) { submit.disabled = on; },
    onReset: function () {
      qty.a1 = 1; qty.xp = 0; qty.snap = 0;
      city.value = ''; other.value = '';
      render(false);
    },
    onRestore: function (d) {
      var m = d.machines || {};
      qty.a1 = +m.a1 || 0; qty.xp = +m.xp || 0; qty.snap = +m.snap || 0;
      city.value = d.city || ''; other.value = d.other || '';
      render(false);
    }
  });
})();
