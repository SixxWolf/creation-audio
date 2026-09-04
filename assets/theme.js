/* =========================================================
   Création Audio V2 — bascule clair / sombre
   - Par défaut, suit le réglage système (prefers-color-scheme).
   - Un clic sur un bouton [data-theme-toggle] fixe et mémorise le choix.
   - Tant que l'utilisateur n'a pas choisi, on réagit aux changements système.
   L'application initiale du thème (anti-flash) est faite par un petit
   script inline dans le <head> de chaque page ; ce fichier ne gère que
   le bouton et l'écoute des changements système.
   ========================================================= */
(function () {
  var KEY = 'ca-theme';
  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  function systemTheme() { return mq.matches ? 'dark' : 'light'; }
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function current() { return document.documentElement.getAttribute('data-theme') || systemTheme(); }

  function updateButtons(theme) {
    var dark = theme === 'dark';
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.textContent = dark ? '☀️' : '🌙';
      b.setAttribute('title', dark ? 'Passer en mode clair' : 'Passer en mode sombre');
      b.setAttribute('aria-label', dark ? 'Passer en mode clair' : 'Passer en mode sombre');
      b.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateButtons(theme);
  }

  function choose(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    apply(theme);
  }

  // Le système change (ex. bascule auto nuit) : on suit seulement si aucun choix manuel.
  function onSystemChange() { if (!stored()) apply(systemTheme()); }
  if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
  else if (mq.addListener) mq.addListener(onSystemChange);

  function init() {
    updateButtons(current());
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].__themeWired) continue;
      btns[i].__themeWired = true;
      btns[i].addEventListener('click', function () {
        choose(current() === 'dark' ? 'light' : 'dark');
      });
    }
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
