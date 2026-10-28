/* =========================================================
   Création Audio — page publique « Devenir revendeur » (revendeur.html)
   - Gamme : products_public (type spacer) -> cartes photo + nom + mention
     rabais quantité, AUCUN prix (ni $ ni %). La rangée défile seule,
     lentement vers la droite, en boucle sans couture (jeu de cartes
     recopié) ; on la saisit à la souris ou au doigt, survol = pause,
     flèches du clavier quand elle a le focus. « Réduire les animations »
     = pas de défilement automatique.
   - Héros : photo d'un spacer qui change toutes les 4,5 s + compteurs
     (modèles, véhicules couverts).
   - Formulaire -> Edge Function « dealer-request » (action submit) :
     champ piège hp, réponses new | pending | dealer, 429 = trop de demandes.
     Approbation dans l'admin (Dealers › Demandes, cms-dealers.js).
   - Apparitions .rv-reveal (glissent de gauche à droite) + ombre de l'en-tête.
   Dépend de : i18n.js (CA.t), supabase-client.js (CA.sb), spacer-catalog.js
   (CASpacers : fitmentOf, sizeOf, speakersOf, esc), nav.js (« Écris-nous »).
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA = window.CA || {};
  var _t = CA.t || function (s, v) { return v ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] == null ? m : v[k]; }) : s; };
  var EN = CA.lang === 'en';
  var SC = window.CASpacers || {};
  var esc = SC.esc || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var sb = CA.sb;

  var LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  var NOIMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8 8"/></svg>';
  // phrases d'accroche (ton direct et pro) — une par carte, en rotation
  var TEASERS = [
    _t('Des prix de gros qui t\'attendent.'),
    _t('Plus tu en commandes, moins tu paies.'),
    _t('Des marges qui font sourire.'),
    _t('Ton prix baisse à chaque palier.')
  ];

  function plural(n, one, many) { return n + ' ' + _t((EN ? n !== 1 : n > 1) ? many : one); }
  function imgUrl(path) {
    if (!path || !sb) return '';
    if (/^https?:/i.test(path)) return path;
    return sb.storage.from('products').getPublicUrl(path).data.publicUrl;
  }
  function fitOf(p) { return SC.fitmentOf ? SC.fitmentOf(p) : []; }
  function sizeOf(p) { return SC.sizeOf ? SC.sizeOf(p) : String(p.attrs && p.attrs.speaker_size || ''); }
  function speakersOf(p) { return SC.speakersOf ? SC.speakersOf(p) : []; }
  function makesOf(p) {
    var seen = {}, out = [];
    fitOf(p).forEach(function (r) { var k = r.make.toLowerCase(); if (r.make && !seen[k]) { seen[k] = 1; out.push(r.make); } });
    return out;
  }

  /* ---------- en-tête : filet au défilement ---------- */
  var top = $('.rv-top');
  if (top) {
    var onScroll = function () { top.classList.toggle('is-scrolled', window.scrollY > 4); };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  /* ---------- apparitions ---------- */
  var reveals = $$('.rv-reveal');
  if (!('IntersectionObserver' in window) || reduce) reveals.forEach(function (el) { el.classList.add('is-in'); });
  else {
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- gamme ---------- */
  function cardHtml(p, i) {
    var url = imgUrl(p.image_path), sz = sizeOf(p), fit = fitOf(p), mk = makesOf(p), spk = speakersOf(p);
    var veh = {}; fit.forEach(function (r) { veh[(r.make + '|' + r.model).toLowerCase()] = 1; });
    var nVeh = Object.keys(veh).length;
    var tags = (sz ? '<span class="rv-tag">' + esc(sz) + '</span>' : '') +
      (nVeh ? '<span class="rv-tag">' + esc(plural(nVeh, 'véhicule', 'véhicules')) + '</span>'
            : spk.length ? '<span class="rv-tag">' + esc(plural(spk.length, 'haut-parleur', 'haut-parleurs')) + '</span>' : '');
    var makes = mk.length ? mk.slice(0, 3).join(' · ') + (mk.length > 3 ? ' +' + (mk.length - 3) : '') : _t('Adaptateur de haut-parleur');
    return '<article class="rv-card">' +
      '<div class="rv-card-media">' + (url ? '<img src="' + esc(url) + '" alt="' + esc(p.name) + '" loading="lazy" draggable="false">' : NOIMG) + '</div>' +
      '<div class="rv-card-body">' +
        (tags ? '<div class="rv-tags">' + tags + '</div>' : '') +
        '<h3>' + esc(p.name) + '</h3>' +
        '<p class="rv-makes">' + esc(makes) + '</p>' +
        '<p class="rv-teaser">' + esc(TEASERS[i % TEASERS.length]) + '</p>' +
        '<p class="rv-perk">' + LOCK + esc(_t('Rabais dès 6, 12 et 18 paires')) + '</p>' +
      '</div></article>';
  }
  function endCardHtml() {
    return '<article class="rv-card rv-card-end">' +
      '<h3>' + esc(_t('Pas dans la liste ? On le conçoit.')) + '</h3>' +
      '<p>' + esc(_t('Donne-nous le véhicule, on dessine la pièce.')) + '</p>' +
      '<a class="rv-btn rv-btn-accent" href="#demande">' + esc(_t('Demander l\'accès')) + '</a>' +
      '</article>';
  }

  var marquee = $('#rv-marquee'), track = $('#rv-track');
  var setW = 0, x = 0, setHtml = '', running = false, visible = true, hover = false, holdUntil = 0, last = 0;
  var SPEED = 26;   // px / s, vers la droite

  // nombre de copies du jeu pour couvrir l'écran pendant toute la boucle
  function layout() {
    if (!setHtml) return;
    var vw = marquee.clientWidth || window.innerWidth;
    track.innerHTML = setHtml;
    setW = track.scrollWidth + parseFloat(getComputedStyle(track).columnGap || 20);
    var copies = Math.max(2, Math.ceil(vw / setW) + 1), html = setHtml;
    for (var c = 1; c < copies; c++) html += setHtml;
    track.innerHTML = html;
    // les copies : décoratives (lecteurs d'écran et tabulation ne voient que le 1er jeu)
    var n = $$('.rv-card', track).length / copies;
    $$('.rv-card', track).forEach(function (el, i) {
      if (i < n) return;
      el.setAttribute('aria-hidden', 'true');
      $$('a', el).forEach(function (a) { a.tabIndex = -1; });
    });
    x = ((x % setW) + setW) % setW;
    paint();
  }
  function paint() { track.style.transform = 'translate3d(' + (x - setW).toFixed(2) + 'px,0,0)'; }
  function frame(t) {
    if (!running) return;
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
    if (!drag && !hover && visible && !reduce && t > holdUntil) { x = (x + SPEED * dt) % setW; paint(); }
    requestAnimationFrame(frame);
  }
  function start() { if (running) return; running = true; last = 0; requestAnimationFrame(frame); }

  // saisie souris / doigt : la rangée suit le pointeur ; un vrai glissé n'ouvre pas le lien sous le doigt
  var drag = null, moved = false;
  marquee.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, base: x }; moved = false;
  });
  marquee.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0;
    if (!moved && Math.abs(dx) > 6) {
      moved = true; marquee.classList.add('is-drag');
      try { marquee.setPointerCapture(e.pointerId); } catch (err) {}
    }
    if (moved) { x = (((drag.base + dx) % setW) + setW) % setW; paint(); }
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null; marquee.classList.remove('is-drag');
    holdUntil = performance.now() + 1200;
  }
  marquee.addEventListener('pointerup', endDrag);
  marquee.addEventListener('pointercancel', endDrag);
  marquee.addEventListener('lostpointercapture', endDrag);
  marquee.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  marquee.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hover = true; });
  marquee.addEventListener('pointerleave', function () { hover = false; });
  marquee.addEventListener('focusin', function () { hover = true; });
  marquee.addEventListener('focusout', function () { hover = false; });
  marquee.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' || !setW) return;
    e.preventDefault();
    x = (((x + (e.key === 'ArrowRight' ? 1 : -1) * 292) % setW) + setW) % setW; paint();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (ents) { visible = ents[0].isIntersecting; }).observe(marquee);
  }
  var rsz = 0;
  window.addEventListener('resize', function () { clearTimeout(rsz); rsz = setTimeout(layout, 150); });

  /* ---------- héros : photo qui change + compteurs ---------- */
  function hero(list) {
    var img = $('#rv-hero-img'), nameEl = $('#rv-hero-name'), sizeEl = $('#rv-hero-size');
    var pics = list.filter(function (p) { return p.image_path; })
      .sort(function (a, b) { return fitOf(b).length - fitOf(a).length; });
    if (!pics.length) return;
    var i = 0;
    function show(k, instant) {
      var p = pics[k % pics.length];
      var put = function () {
        img.src = imgUrl(p.image_path); img.alt = p.name;
        nameEl.textContent = p.name; sizeEl.textContent = sizeOf(p);
        img.classList.remove('is-out');
      };
      if (instant) { put(); return; }
      img.classList.add('is-out');
      setTimeout(put, 350);
      var next = new Image(); next.src = imgUrl(pics[(k + 1) % pics.length].image_path);   // préchargement
    }
    show(0, true);
    if (pics.length > 1 && !reduce) setInterval(function () { if (!document.hidden) show(++i); }, 4500);
  }
  function stats(list) {
    var veh = {};
    list.forEach(function (p) { fitOf(p).forEach(function (r) { veh[(r.make + '|' + r.model).toLowerCase()] = 1; }); });
    var nv = Object.keys(veh).length;
    $('#rv-n-models').textContent = list.length;
    $('#rv-n-veh').textContent = nv > 10 ? Math.floor(nv / 10) * 10 + '+' : nv;
    $('#rv-stats').hidden = !list.length;
  }

  function load() {
    if (!sb) { track.innerHTML = '<p class="rv-loading">' + esc(_t('Gamme momentanément indisponible.')) + '</p>'; return; }
    sb.from('products_public').select('name,image_path,attrs,sort_order').eq('type', 'spacer')
      .order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) {
        var list = res.error ? [] : (res.data || []);
        if (!list.length) { track.innerHTML = '<p class="rv-loading">' + esc(_t('Gamme momentanément indisponible.')) + '</p>'; return; }
        setHtml = list.map(cardHtml).join('') + endCardHtml();
        layout(); start();
        hero(list); stats(list);
      }, function () { track.innerHTML = '<p class="rv-loading">' + esc(_t('Gamme momentanément indisponible.')) + '</p>'; });
  }
  load();

  /* ---------- formulaire de demande ---------- */
  var form = $('#rv-form'), status = $('#rv-status'), btn = $('#rv-submit');
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  var REQUIRED = ['business', 'contact', 'email', 'phone', 'city'];
  function say(msg, bad) { status.textContent = msg || ''; status.classList.toggle('is-bad', !!bad); }
  function field(n) { return form.elements[n]; }
  function check() {
    var first = null;
    REQUIRED.forEach(function (n) {
      var el = field(n), v = el.value.trim();
      var bad = !v || (n === 'email' && !EMAIL_RE.test(v));
      el.setAttribute('aria-invalid', bad ? 'true' : 'false');
      if (bad && !first) first = el;
    });
    return first;
  }
  REQUIRED.forEach(function (n) {
    field(n).addEventListener('input', function () { if (this.getAttribute('aria-invalid') === 'true') this.setAttribute('aria-invalid', 'false'); });
  });
  function done(kind, email) {
    var t = $('#rv-done-t'), p = $('#rv-done-p'), portal = $('#rv-done-portal');
    if (kind === 'dealer') {
      t.textContent = _t('Tu as déjà accès');
      p.textContent = _t('Ce courriel a déjà un accès revendeur. Connecte-toi au portail avec un code par courriel.');
    } else if (kind === 'pending') {
      t.textContent = _t('Demande déjà en attente');
      p.textContent = _t('On a déjà ta demande. On te répond sous 24 h ouvrables.');
    } else {
      t.textContent = _t('Demande reçue');
      p.innerHTML = esc(_t('On te répond sous 24 h ouvrables. Un courriel de confirmation est en route vers')) + ' <b>' + esc(email) + '</b>.';
    }
    portal.hidden = kind !== 'dealer';
    form.hidden = true;
    var box = $('#rv-done'); box.hidden = false; box.focus();
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var bad = check();
    if (bad) {
      var onlyEmail = bad.name === 'email' && REQUIRED.every(function (n) { return n === 'email' || field(n).getAttribute('aria-invalid') !== 'true'; });
      say(onlyEmail ? _t('Entre un courriel valide.') : _t('Remplis les champs requis.'), true); bad.focus(); return;
    }
    var cfg = window.CA_SUPABASE || {};
    if (!cfg.url || !window.fetch) { say(_t('Envoi impossible pour l\'instant. Écris-nous à contact@creationaudio.ca.'), true); return; }
    var body = { action: 'submit', lang: EN ? 'en' : 'fr', hp: field('hp').value };
    ['business', 'contact', 'email', 'phone', 'city', 'website', 'facebook'].forEach(function (n) { body[n] = field(n).value.trim(); });
    btn.disabled = true; say(_t('Envoi…'));
    fetch(cfg.url + '/functions/v1/dealer-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (b) { b = b || {}; b._status = r.status; return b; }, function () { return { _status: r.status }; });
    }).then(function (b) {
      btn.disabled = false;
      if (b.ok) { say(''); done(b.status, body.email); return; }
      if (b.error === 'wait') say(_t('Trop de demandes d\'un coup. Réessaie dans une heure.'), true);
      else if (b.error === 'bad_request') { check(); say(_t('Vérifie ton courriel et les champs requis.'), true); }
      else say(_t('Envoi impossible pour l\'instant. Écris-nous à contact@creationaudio.ca.'), true);
    }, function () {
      btn.disabled = false;
      say(_t('Erreur réseau. Vérifie ta connexion et réessaie.'), true);
    });
  });
})();
