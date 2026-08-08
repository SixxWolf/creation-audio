/* =========================================================
   Création Audio V2 — menu mobile partagé (en-tête)
   Gère le tiroir de navigation (burger) sur toutes les pages
   publiques. À charger sur accueil / boutique / spacers.
   ========================================================= */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var burger = $('#nav-burger'), drawer = $('#nav-drawer'), backdrop = $('#nav-backdrop'), closeBtn = $('#nav-close');
  if (!burger || !drawer) return;

  function open() { drawer.classList.add('open'); if (backdrop) backdrop.hidden = false; burger.setAttribute('aria-expanded', 'true'); }
  function close() { drawer.classList.remove('open'); if (backdrop) backdrop.hidden = true; burger.setAttribute('aria-expanded', 'false'); }

  burger.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (backdrop) backdrop.addEventListener('click', close);
  Array.prototype.forEach.call(drawer.querySelectorAll('a'), function (a) { a.addEventListener('click', close); });
})();
