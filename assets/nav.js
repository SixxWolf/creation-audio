/* =========================================================
   Création Audio — chrome public partagé (en-tête + pied)
   - Tiroir de navigation mobile (burger) : ouverture/fermeture,
     Échap, focus renvoyé au burger.
   - Ombre de l'en-tête dès qu'on défile (.is-scrolled).
   - Année du pied de page (#year).
   - Point « connecté » sur le bouton Mon compte (.home-account.is-in).
   - Messagerie : tout lien [data-msg] (« Écris-nous », data-msg = sujet,
     data-msg-ref = contexte) ouvre le panneau ; assets/messagerie.(js|css)
     sont chargés au premier clic (CA.loadMsg). Un message en attente de son
     code (sessionStorage ca_msg_pending) rouvre le panneau au chargement.
   Chargé par toutes les pages publiques.
   ========================================================= */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var CA = window.CA = window.CA || {};

  /* ---- messagerie (panneau chargé au besoin) ---- */
  var MSG_V = 3;
  var me = document.currentScript && document.currentScript.src || '';
  var ASSETS = me ? me.replace(/nav\.js(\?.*)?$/, '') : 'assets/';
  CA.siteRoot = ASSETS.replace(/assets\/$/, '');
  function addScript(src, integrity) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej;
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      document.head.appendChild(s);
    });
  }
  // client Supabase : version FIGÉE + empreinte (même valeur que les balises <script> des pages)
  var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.min.js';
  var SUPABASE_SRI = 'sha384-dl/4LkSyQ4uEucc48NM6VDZLAjLLq9yMzZ5JLXumBq7Ld33XBof73hseOqPhO89+';
  var msgP = null;
  CA.loadMsg = function () {
    if (msgP) return msgP;
    if (!document.querySelector('link[data-msg-css]')) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = ASSETS + 'messagerie.css?v=' + MSG_V;
      css.setAttribute('data-msg-css', ''); document.head.appendChild(css);
    }
    var deps = Promise.resolve();
    if (!window.supabase) deps = deps.then(function () { return addScript(SUPABASE_JS, SUPABASE_SRI); });
    if (!window.CA_SUPABASE) deps = deps.then(function () { return addScript(ASSETS + 'supabase-config.js?v=1'); });
    msgP = deps.then(function () { return CA.msg || addScript(ASSETS + 'messagerie.js?v=' + MSG_V); })
      .then(function () { if (!CA.msg) throw new Error('messagerie'); return CA.msg; });
    msgP.catch(function () { msgP = null; });
    return msgP;
  };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-msg]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    var href = a.getAttribute('href');
    CA.loadMsg().then(function (m) {
      m.open({ topic: a.getAttribute('data-msg') || '', ref: a.hasAttribute('data-msg-ref') ? a.getAttribute('data-msg-ref') : undefined,
               body: a.getAttribute('data-msg-body') || '' });
    }, function () { if (href && href !== '#') location.href = href; });
  });
  try {
    var pend = JSON.parse(sessionStorage.getItem('ca_msg_pending') || 'null');
    if (pend && pend.email && Date.now() - pend.at < 10 * 60 * 1000) CA.loadMsg().then(function (m) { m.open({}); }, function () {});
  } catch (e) {}

  /* ---- année du pied de page ---- */
  var yearEl = $('#year'); if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---- ombre de l'en-tête au défilement ---- */
  var top = $('.home-top');
  if (top) {
    var onScroll = function () { top.classList.toggle('is-scrolled', window.scrollY > 4); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---- client connecté (compte.html range sa session sous « ca-compte-auth ») : point sur « Mon compte » ---- */
  var signedIn = false;
  try { signedIn = !!localStorage.getItem('ca-compte-auth'); } catch (e) {}
  Array.prototype.forEach.call(document.querySelectorAll('.home-account'), function (a) { a.classList.toggle('is-in', signedIn); });

  /* ---- tiroir mobile ---- */
  var burger = $('#nav-burger'), drawer = $('#nav-drawer'), backdrop = $('#nav-backdrop'), closeBtn = $('#nav-close');
  if (!burger || !drawer) return;

  function isOpen() { return drawer.classList.contains('open'); }
  function open() {
    drawer.classList.add('open'); if (backdrop) backdrop.hidden = false;
    burger.setAttribute('aria-expanded', 'true');
    if (closeBtn) closeBtn.focus();
  }
  function close(restoreFocus) {
    if (!isOpen()) return;
    drawer.classList.remove('open'); if (backdrop) backdrop.hidden = true;
    burger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) burger.focus();
  }

  burger.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', function () { close(true); });
  if (backdrop) backdrop.addEventListener('click', function () { close(true); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(true); });
  Array.prototype.forEach.call(drawer.querySelectorAll('a'), function (a) { a.addEventListener('click', function () { close(false); }); });
})();

/* =========================================================
   Nouvelles (table « news », admin cms-nouvelles.js)
   - CA.loadNews() : nouvelles en ligne (la RLS filtre déjà actif + dates),
     lues une seule fois en REST anon ; accueil.js s'en sert pour #nouvelles.
   - Barre du haut (.promo-bar) : les nouvelles « in_bar » défilent à la place du
     texte habituel ; ✕ les cache jusqu'à la prochaine nouvelle (empreinte
     ids + dates de maj en localStorage), le texte habituel revient.
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA = window.CA || {};
  var _t = CA.t || function (s) { return s; };
  var KINDS = { promo: _t('Promo'), event: _t('Événement'), 'new': _t('Nouveauté'), update: _t('Mise à jour') };
  // en:i18n = textes anglais (fonction translate) — CA.tr(n, 'title')
  var COLS = 'id,kind,title,body,image_path,cta_label,cta_url,promo_code,event_at,starts_at,ends_at,featured,in_bar,sort_order,updated_at,en:i18n';
  var KEY = 'ca-news-closed';

  function cfg() { return window.CA_SUPABASE || null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  CA.newsKinds = KINDS;
  CA.newsImg = function (path) {
    var c = cfg();
    if (/^assets\//.test(path || '')) return (CA.siteRoot || '') + path;   // visuel hébergé dans le dépôt
    return c && path ? c.url + '/storage/v1/object/public/products/' + String(path).split('/').map(encodeURIComponent).join('/') : '';
  };
  // lien saisi dans l'admin : http(s), mailto, ancre ou chemin du site (relatif à la racine, même depuis spacer/)
  CA.newsHref = function (u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:)/i.test(u) || u.charAt(0) === '#') return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '';          // javascript:, data:… refusés
    if (u.charAt(0) === '/') return u;
    return (CA.siteRoot || '') + u.replace(/^\.\//, '');
  };

  // pages sans supabase-config.js (aide, conditions…) : on le charge au besoin
  function cfgP() {
    if (cfg()) return Promise.resolve(cfg());
    return new Promise(function (res) {
      var s = document.createElement('script');
      s.src = (CA.siteRoot || '') + 'assets/supabase-config.js?v=1';
      s.onload = s.onerror = function () { res(cfg()); };
      document.head.appendChild(s);
    });
  }
  CA.supaCfg = cfgP;
  var newsP = null;
  CA.loadNews = function () {
    if (newsP) return newsP;
    if (!window.fetch) return (newsP = Promise.resolve([]));
    newsP = cfgP().then(function (c) {
      if (!c) return [];
      return fetch(c.url + '/rest/v1/news?select=' + COLS + '&order=sort_order.asc,created_at.desc', {
      headers: { apikey: c.anonKey, Authorization: 'Bearer ' + c.anonKey }
    }).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { return Array.isArray(rows) ? rows : []; }, function () { return []; });
    });
    return newsP;
  };

  var bar = document.querySelector('.promo-bar');
  if (!bar) return;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  CA.loadNews().then(function (rows) {
    var items = rows.filter(function (n) { return n.in_bar && n.title; });
    if (!items.length) return;
    var sig = items.map(function (n) { return n.id + '@' + (n.updated_at || ''); }).join('|');
    var closed = '';
    try { closed = localStorage.getItem(KEY) || ''; } catch (e) {}
    if (closed === sig) return;

    var original = bar.innerHTML, i = 0, timer = null, paused = false;
    bar.classList.add('is-news');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', _t('Nouvelles'));
    bar.innerHTML =
      (items.length > 1 ? '<button class="pb-nav pb-prev" type="button" aria-label="' + _t('Nouvelle précédente') + '">‹</button>' : '') +
      '<div class="pb-item" aria-live="polite"></div>' +
      (items.length > 1 ? '<button class="pb-nav pb-next" type="button" aria-label="' + _t('Nouvelle suivante') + '">›</button>' : '') +
      '<button class="pb-close" type="button" aria-label="' + _t('Fermer les nouvelles') + '">×</button>';
    var slot = bar.querySelector('.pb-item');

    function show(k) {
      i = (k + items.length) % items.length;
      var n = items[i], href = CA.newsHref(n.cta_url) || (CA.siteRoot || '') + '#nouvelles';
      slot.innerHTML = '<span class="pb-tag k-' + esc(n.kind) + '">' + esc(KINDS[n.kind] || '') + '</span>' +
        '<a class="pb-link" href="' + esc(href) + '">' + esc(CA.tr(n, 'title')) +
          (n.promo_code ? ' <span class="pb-code">' + _t('Code') + ' ' + esc(n.promo_code) + '</span>' : '') +
          (n.cta_label ? ' <span class="pb-cta">' + esc(CA.tr(n, 'cta_label')) + ' →</span>' : '') +
        '</a>';
    }
    function tick() {
      clearInterval(timer);
      if (items.length > 1 && !reduceMotion) timer = setInterval(function () { if (!paused) show(i + 1); }, 6000);
    }
    show(0); tick();
    bar.addEventListener('mouseenter', function () { paused = true; });
    bar.addEventListener('mouseleave', function () { paused = false; });
    bar.addEventListener('focusin', function () { paused = true; });
    bar.addEventListener('focusout', function () { paused = false; });
    var prev = bar.querySelector('.pb-prev'), next = bar.querySelector('.pb-next');
    if (prev) prev.addEventListener('click', function () { show(i - 1); tick(); });
    if (next) next.addEventListener('click', function () { show(i + 1); tick(); });
    bar.querySelector('.pb-close').addEventListener('click', function () {
      clearInterval(timer);
      try { localStorage.setItem(KEY, sig); } catch (e) {}
      bar.classList.remove('is-news');
      bar.removeAttribute('role'); bar.removeAttribute('aria-label');
      bar.innerHTML = original;
    });
  });
})();

/* =========================================================
   Thème des fêtes (fetes.css + fetes.js, skin de Noël éphémère)
   Réglé dans l'admin : Réglages › Apparence → admin_settings « fetes »
   { on, from, to }, lu ici par la RPC public_fetes.
   - Le <head> de chaque page publique pose html.fetes AVANT le rendu d'après
     le cache local « ca-fetes » ({a, b} : fenêtre en ms, heure du visiteur)
     ou l'aperçu « ?fetes=1 » (cet onglet seulement : sessionStorage
     « ca-fetes-voir » ; ?fetes=0 force le site normal).
   - Ici : on relit le réglage en ligne, on met le cache à jour, on corrige
     la classe et on charge les décors (fetes.js) quand le thème est actif.
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA = window.CA || {};
  var FETES_V = 2, KEY = 'ca-fetes', PREV = 'ca-fetes-voir', root = document.documentElement;
  var q = /[?&]fetes=([01])/.exec(location.search), preview = q ? q[1] : null;
  try {
    if (q) sessionStorage.setItem(PREV, q[1]);
    else preview = sessionStorage.getItem(PREV);
  } catch (e) {}

  var loading = false;
  function decor() {
    if (CA.fetes) { CA.fetes.start(); return; }
    if (loading) return;
    loading = true;
    var s = document.createElement('script');
    s.src = (CA.siteRoot || '') + 'assets/fetes.js?v=' + FETES_V;
    document.body.appendChild(s);
  }
  function set(on) {
    root.classList.toggle('fetes', on);
    if (on) decor();
  }
  // { on, from: "AAAA-MM-JJ", to } → fenêtre { a, b } en ms (minuit local, fin incluse), ou null
  function windowOf(f) {
    if (!f || !f.on || !f.from || !f.to) return null;
    var a = new Date(f.from + 'T00:00:00').getTime(), b = new Date(f.to + 'T00:00:00').getTime();
    if (!isFinite(a) || !isFinite(b) || b < a) return null;
    b = new Date(b); b.setDate(b.getDate() + 1);
    return { a: a, b: b.getTime() };
  }

  if (preview) set(preview === '1');
  else if (root.classList.contains('fetes')) decor();

  if (!window.fetch || !CA.supaCfg) return;
  CA.supaCfg().then(function (c) {
    if (!c) return;
    return fetch(c.url + '/rest/v1/rpc/public_fetes', {
      method: 'POST', body: '{}',
      headers: { apikey: c.anonKey, Authorization: 'Bearer ' + c.anonKey, 'Content-Type': 'application/json' }
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (f) {
      if (!f || typeof f !== 'object') return;
      var w = windowOf(f), t = Date.now();
      try { if (w) localStorage.setItem(KEY, JSON.stringify(w)); else localStorage.removeItem(KEY); } catch (e) {}
      if (!preview) set(!!w && t >= w.a && t < w.b);
    });
  }).then(null, function () {});
})();
