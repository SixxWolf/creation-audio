/* =========================================================
   Création Audio — chrome public partagé (en-tête + pied)
   - Tiroir de navigation mobile (burger) : ouverture/fermeture,
     Échap, focus renvoyé au burger.
   - Ombre de l'en-tête dès qu'on défile (.is-scrolled).
   - Année du pied de page (#year).
   - Point « connecté » sur le bouton Mon compte (.home-account.is-in).
   Chargé par toutes les pages publiques.
   ========================================================= */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };

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
