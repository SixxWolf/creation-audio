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
  var MSG_V = 1;
  var me = document.currentScript && document.currentScript.src || '';
  var ASSETS = me ? me.replace(/nav\.js(\?.*)?$/, '') : 'assets/';
  CA.siteRoot = ASSETS.replace(/assets\/$/, '');
  function addScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  var msgP = null;
  CA.loadMsg = function () {
    if (msgP) return msgP;
    if (!document.querySelector('link[data-msg-css]')) {
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = ASSETS + 'messagerie.css?v=' + MSG_V;
      css.setAttribute('data-msg-css', ''); document.head.appendChild(css);
    }
    var deps = Promise.resolve();
    if (!window.supabase) deps = deps.then(function () { return addScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'); });
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
