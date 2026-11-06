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

  /* ---------- calculateur et demande : un seul bloc ----------
     Les machines viennent du catalogue de l'admin (table maintenance_printers, onglet Entretien) ;
     une machine sans prix est « sur évaluation » : 1re visite au taux horaire (maintenance_settings). */
  var form = $('demande');
  if (!form) return;
  var listEl = $('et-models'), totalEl = $('et-total'), extraEl = $('et-extra'), warnEl = $('et-warn');
  var items = [], qty = {}, rate = 60, shown = 0, raf = 0;
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var photo = function (p) {
    if (!p) return '';
    if (p.charAt(0) === '/') return p;
    var c = window.CA_SUPABASE || {};
    return c.url ? c.url + '/storage/v1/object/public/products/' + p.split('/').map(encodeURIComponent).join('/') : '';
  };
  var label = function (it) { return [it.brand, it.name].filter(Boolean).join(' '); };

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
  var monthly = function () {
    var t = 0, un = [], n = 0;
    items.forEach(function (it) {
      var q = qty[it.id] || 0;
      if (!q) return;
      if (it.price_month != null) t += q * +it.price_month; else { n += q; un.push(it); }
    });
    return { total: t, unpriced: n, models: un };
  };
  var render = function (animate) {
    all('.et-model', form).forEach(function (r) {
      var q = qty[r.getAttribute('data-id')] || 0;
      r.querySelector('.et-qty').textContent = q;
      r.querySelector('.et-minus').disabled = q <= 0;
      r.querySelector('.et-plus').disabled = q >= 99;
    });
    var m = monthly(), onlyOthers = !m.total && m.unpriced > 0;
    totalEl.classList.toggle('is-text', onlyOthers);
    extraEl.hidden = !m.unpriced || onlyOthers;
    if (m.unpriced && !onlyOthers) extraEl.textContent = tn(m.unpriced, '+ {n} machine sur évaluation', '+ {n} machines sur évaluation');
    if (warnEl) {
      warnEl.hidden = !m.unpriced;
      if (m.unpriced) warnEl.textContent = _t("Première fois qu'on entretient {models} : on ne sait pas combien de temps ça prendra. La première visite est facturée {rate} de l'heure, puis on fixe un prix par mois pour ce modèle.",
        { models: m.models.map(label).join(', '), rate: priceShort(rate) });
    }
    if (onlyOthers) {
      cancelAnimationFrame(raf);
      shown = 0;
      totalEl.textContent = _t('Sur évaluation');
    } else if (animate) {
      countTo(m.total);
    } else {
      shown = m.total;
      totalEl.textContent = priceShort(m.total);
    }
  };
  var defaults = function () {
    qty = {};
    var first = items.filter(function (it) { return it.price_month != null; })[0];
    if (first) qty[first.id] = 1;
  };
  var paintList = function () {
    listEl.innerHTML = items.map(function (it) {
      var src = photo(it.photo);
      return '<li class="et-model" data-id="' + esc(it.id) + '">' +
        '<span class="et-th">' + (src ? '<img src="' + esc(src) + '" alt="" width="56" height="56" loading="lazy" decoding="async">' : '') + '</span>' +
        '<span class="et-pm"><b>' + esc(label(it)) + '</b><small>' + (it.price_month != null
          ? '<b class="et-unit">' + esc(priceShort(+it.price_month)) + '</b> ' + esc(_t('par machine'))
          : esc(_t('Sur évaluation'))) + '</small></span>' +
        '<span class="et-stepper" role="group" aria-label="' + esc(_t('Nombre de machines')) + '">' +
          '<button type="button" class="et-minus" aria-label="' + esc(_t('Moins')) + '">−</button><output class="et-qty">0</output>' +
          '<button type="button" class="et-plus" aria-label="' + esc(_t('Plus')) + '">+</button></span></li>';
    }).join('');
    all('.et-th img', listEl).forEach(function (im) {
      im.addEventListener('load', function () { if (im.naturalWidth > im.naturalHeight * 1.2) im.classList.add('et-th-wide'); });
    });
  };
  var unavailable = function () {
    listEl.innerHTML = '<li class="et-model-err">' + esc(_t('Liste des machines indisponible. Décris-les dans « Autre modèle ou précision ».')) + '</li>';
  };

  var sb = window.CA && window.CA.sb;
  if (sb) {
    Promise.all([
      sb.from('maintenance_printers').select('id,name,brand,photo,price_month,minutes,sort_order').order('sort_order').order('created_at'),
      sb.from('maintenance_settings').select('hourly_rate').eq('id', 1).maybeSingle()
    ]).then(function (out) {
      if (out[0].error) throw out[0].error;
      items = out[0].data || [];
      if (out[1].data) rate = +out[1].data.hourly_rate || 60;
      var a1 = items.filter(function (it) { return /^A1$/i.test(it.name) && it.price_month != null; })[0], hero = document.querySelector('.et-price .et-unit');
      if (a1 && hero) hero.textContent = priceShort(+a1.price_month);   // le prix du héros suit le catalogue
      if (!Object.keys(qty).length) defaults();
      paintList();
      render(false);
    }, unavailable);
  } else unavailable();
  render(false);

  form.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.et-minus, .et-plus') : null;
    if (!b || b.disabled) return;
    var row = b.closest('.et-model'), id = row.getAttribute('data-id');
    qty[id] = Math.max(0, Math.min(99, (qty[id] || 0) + (b.classList.contains('et-plus') ? 1 : -1)));
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
    var picked = Object.keys(qty).filter(function (id) { return qty[id] > 0; });
    flag(city, !c);
    status.className = 'et-status';
    if (!c || (!picked.length && !o)) {
      status.className = 'et-status is-err';
      status.textContent = _t('Indique ta ville et au moins une machine.');
      if (!c) city.focus(); else other.focus();
      return;
    }
    status.textContent = '';
    window.CA.demande.submit({
      details: { machines: picked.map(function (id) { return { id: id, qty: qty[id] }; }), city: c, other: o },
      files: []
    });
  });
  city.addEventListener('input', function () { flag(city, false); });

  window.CA.demande.init({
    kind: 'maintenance', form: form, status: status,
    onBusy: function (on) { submit.disabled = on; },
    onReset: function () {
      defaults();
      city.value = ''; other.value = '';
      render(false);
    },
    onRestore: function (d) {
      qty = {};
      (Array.isArray(d.machines) ? d.machines : []).forEach(function (m) { if (m && m.id) qty[m.id] = +m.qty || 0; });
      city.value = d.city || ''; other.value = d.other || '';
      render(false);
    }
  });
})();
