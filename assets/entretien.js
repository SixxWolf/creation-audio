/* =========================================================
   Création Audio — page ENTRETIEN : mouvement + calculateur + demande.
   - apparition au défilement (.rv / .en-steps → .is-in), parc qui « s'allume » (héros), parallaxe douce ;
   - calculateur : 25 $ × nombre de A1, les autres modèles « sur évaluation » ;
   - formulaire : compose le message (ville + machines) puis ouvre la Messagerie
     (lien #en-ask [data-msg], géré par nav.js) : la demande arrive dans l'onglet Messages de l'admin.
   Tout mouvement est coupé sous prefers-reduced-motion.
   ========================================================= */
(function () {
  'use strict';
  var CA0 = window.CA || {};
  var _t = CA0.t || function (s) { return s; };
  var tn = CA0.tn || function (n, one, many) { return (n >= 2 ? many : one).replace('{n}', n); };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); }
  function priceShort(n) { return CA0.priceShort ? CA0.priceShort(n) : n + ' $'; }

  // prix affichés : 25 $ en français, $25 en anglais
  all('.en-unit[data-price]').forEach(function (el) { el.textContent = priceShort(+el.getAttribute('data-price')); });

  /* ---------- apparition au défilement ---------- */
  var revealEls = all('.rv, .en-steps');
  if (hasIO && document.documentElement.classList.contains('en-js')) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
        if (e.target.id === 'en-calc') calcIntro();
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- héros : le parc s'allume, machine après machine ---------- */
  var park = $('en-park');
  if (park) {
    var tiles = all('.en-tile', park), nEl = $('en-n'), barEl = $('en-bar-f');
    var setCount = function (k) { nEl.textContent = k; barEl.style.width = (k / tiles.length * 100) + '%'; };
    if (!reduce) {
      var timers = [], visible = true;
      var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
      var stop = function () { timers.forEach(clearTimeout); timers = []; };
      var reset = function () {
        tiles.forEach(function (t) { t.classList.remove('is-clean', 'is-sweep', 'is-pop'); });
        setCount(0);
      };
      var cycle = function () {
        stop(); reset();
        var done = 0, gap = 1500, t0 = 900;
        tiles.forEach(function (t, i) {
          var at = t0 + i * gap;
          later(function () { t.classList.add('is-sweep'); }, at);
          later(function () { t.classList.add('is-clean', 'is-pop'); setCount(++done); }, at + 480);
          later(function () { t.classList.remove('is-sweep'); }, at + 950);
          later(function () { t.classList.remove('is-pop'); }, at + 1700);
        });
        later(cycle, t0 + tiles.length * gap + 4200);
      };
      reset();
      var sync = function () {
        if (visible && !document.hidden) cycle(); else stop();
      };
      if (hasIO) {
        new IntersectionObserver(function (en) { visible = en[0].isIntersecting; sync(); }, { threshold: 0.25 }).observe(park);
      } else { sync(); }
      document.addEventListener('visibilitychange', sync);

      // parallaxe douce : les machines montent à des vitesses différentes au défilement
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          park.style.setProperty('--sy', Math.max(0, Math.min(window.scrollY, 700)));
          ticking = false;
        });
      }, { passive: true });
    }
  }

  /* ---------- calculateur ---------- */
  var calc = $('en-calc');
  var calcIntro = function () {};
  if (calc) {
    var rows = all('.en-model', calc), totalEl = $('en-total'), extraEl = $('en-extra'), goBtn = $('en-calc-go');
    var unit = +calc.querySelector('[data-model="a1"]').getAttribute('data-price') || 25;
    var qty = {};
    rows.forEach(function (r) { qty[r.getAttribute('data-model')] = +r.getAttribute('data-qty') || 0; });
    var shown = unit * qty.a1, raf = 0, introduced = !hasIO || reduce;

    var bump = function (el) {
      el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump');
      el.addEventListener('animationend', function f() { el.classList.remove('is-bump'); el.removeEventListener('animationend', f); });
    };
    var countTo = function (target) {
      cancelAnimationFrame(raf);
      if (reduce) { shown = target; totalEl.textContent = priceShort(target); return; }
      var from = shown, t0 = null, dur = 520;
      var step = function (ts) {
        if (t0 == null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        shown = Math.round(from + (target - from) * e);
        totalEl.textContent = priceShort(shown);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    var render = function (changed) {
      rows.forEach(function (r) {
        var m = r.getAttribute('data-model'), q = qty[m];
        r.querySelector('.en-qty').textContent = q;
        r.querySelector('.en-minus').disabled = q <= 0;
        r.querySelector('.en-plus').disabled = q >= 99;
      });
      var others = qty.xp + qty.snap;
      extraEl.hidden = !others;
      if (others) extraEl.textContent = tn(others, '+ {n} machine sur évaluation', '+ {n} machines sur évaluation');
      if (introduced) { countTo(unit * qty.a1); if (changed) bump(totalEl); }
    };
    calcIntro = function () {      // le total compte de 0 jusqu'à sa valeur quand le calculateur apparaît
      if (introduced) return;
      introduced = true; shown = 0; totalEl.textContent = priceShort(0); countTo(unit * qty.a1);
    };
    if (!introduced) { shown = 0; totalEl.textContent = priceShort(0); }
    render(false);

    calc.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.en-minus, .en-plus') : null;
      if (!b || b.disabled) return;
      var row = b.closest('.en-model'), m = row.getAttribute('data-model');
      qty[m] = Math.max(0, Math.min(99, qty[m] + (b.classList.contains('en-plus') ? 1 : -1)));
      bump(row.querySelector('.en-qty'));
      render(true);
    });

    // « Demander cet entretien » : recopie le parc dans le formulaire puis y descend
    goBtn.addEventListener('click', function () {
      var ta = $('en-machines'), parts = [];
      if (qty.a1) parts.push(qty.a1 + ' ' + _t('Bambu Lab A1'));
      if (qty.xp) parts.push(qty.xp + ' ' + _t('Bambu Lab série X / P'));
      if (qty.snap) parts.push(qty.snap + ' ' + _t('Snapmaker U1'));
      if (ta && parts.length && (!ta.value.trim() || ta.getAttribute('data-auto') === '1')) {
        ta.value = parts.join(', '); ta.setAttribute('data-auto', '1');
      }
      var sec = $('demande');
      if (sec) sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      var city = $('en-city');
      if (city) setTimeout(function () { try { city.focus({ preventScroll: true }); } catch (x) { city.focus(); } }, reduce ? 0 : 650);
    });
  }

  /* ---------- formulaire de demande ---------- */
  var form = $('en-form');
  if (!form) return;
  var city = $('en-city');
  var machines = $('en-machines');
  var status = $('en-status');
  var ask = $('en-ask');

  function flag(el, bad) { el.classList.toggle('is-bad', bad); el.setAttribute('aria-invalid', bad ? 'true' : 'false'); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var c = city.value.trim(), m = machines.value.trim();
    flag(city, !c); flag(machines, !m);
    status.className = 'en-status';
    if (!c || !m) {
      status.className = 'en-status is-err';
      status.textContent = _t('Remplis la ville et tes machines.');
      (c ? machines : city).focus();
      return;
    }
    var body = _t('Bonjour, je veux un entretien mensuel de mes imprimantes.') + '\n' +
      _t('Ville ou secteur :') + ' ' + c + '\n' +
      _t('Machines :') + ' ' + m;
    ask.setAttribute('data-msg-body', body);
    status.textContent = '';
    ask.click();
  });
  [city, machines].forEach(function (el) { el.addEventListener('input', function () { flag(el, false); }); });
  machines.addEventListener('input', function () { machines.removeAttribute('data-auto'); });
})();
