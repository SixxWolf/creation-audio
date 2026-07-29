/* =========================================================
   Création Audio — transitions des écrans de choix (splash)
   - Entrée : les panneaux apparaissent en fondu au chargement.
   - Sortie : au clic, le panneau choisi s'agrandit et l'autre
     s'efface avant la navigation (plus de changement brutal).
   Respecte prefers-reduced-motion. Aucune dépendance externe.
   ========================================================= */
(function () {
  'use strict';

  var splash = document.querySelector('.splash');
  if (!splash) return;

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Retour arrière : le navigateur restaure le splash depuis son cache
  // (bfcache) tel qu'il était au départ — c.-à-d. en état « leaving/chosen »
  // (pointer-events:none, un panneau masqué) → on reste coincé. Le script ne
  // se relance pas dans ce cas, donc on réinitialise sur l'événement pageshow.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;               // uniquement les restaurations depuis le cache
    splash.classList.remove('leaving');
    var chosen = splash.querySelector('.panel.chosen');
    if (chosen) chosen.classList.remove('chosen');
    splash.classList.add('is-ready');       // écran de choix visible et cliquable
  });

  // Animation d'entrée : on marque l'écran « prêt » à la première frame.
  // Filet setTimeout : garantit l'affichage même si les rAF sont gelés
  // (onglet ouvert en arrière-plan), pour ne jamais laisser un écran vide.
  var ready = function () { splash.classList.add('is-ready'); };
  requestAnimationFrame(function () { requestAnimationFrame(ready); });
  setTimeout(ready, 200);

  if (reduce) return; // pas d'animation de sortie : navigation normale

  splash.querySelectorAll('.panel[href]').forEach(function (panel) {
    panel.addEventListener('click', function (e) {
      // laisse passer clic-milieu / ouverture dans un nouvel onglet
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
      var href = panel.getAttribute('href');
      if (!href) return;
      e.preventDefault();

      splash.classList.add('leaving');
      panel.classList.add('chosen');

      var navigated = false;
      var go = function () { if (navigated) return; navigated = true; window.location.href = href; };
      panel.addEventListener('transitionend', function (ev) {
        if (ev.propertyName === 'flex-grow' || ev.propertyName === 'opacity') go();
      });
      setTimeout(go, 650); // filet de sécurité
    });
  });
})();
