/* =========================================================
   Création Audio — scroll-reveal partagé (écrit à neuf)
   Ajoute la classe .is-in aux éléments .reveal quand ils
   entrent dans le viewport. Respecte prefers-reduced-motion.
   Aucune dépendance externe.
   ========================================================= */
(function () {
  'use strict';

  var els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Pas d'IntersectionObserver (ou motion réduit) : tout afficher direct.
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('is-in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  els.forEach(function (el) { io.observe(el); });
})();
