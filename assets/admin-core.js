/* =========================================================
   Création Audio V2 — noyau admin
   - Gate de connexion Supabase (réservé au compte admin).
   - Gestion des onglets.
   Expose window.CA.onAdminReady(cb) : appelé quand l'admin est
   authentifié (les modules CMS s'y accrochent pour charger).
   À charger APRÈS supabase-client.js, AVANT les modules CMS.
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';

  var sb = window.CA.sb;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // Slug d'URL partagé par tous les modules CMS (marques, matériaux, couleurs) et
  // aligné sur celui de la boutique : minuscules, accents retirés, tirets.
  window.CA.slugify = function (s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };

  var loginWrap = $('#login'), app = $('#app'),
      loginForm = $('#login-form'), emailI = $('#login-email'), passI = $('#login-pass'),
      loginBtn = $('#login-btn'), loginStatus = $('#login-status'),
      whoEmail = $('#who-email'), logoutBtn = $('#logout-btn');

  var readyCbs = [], isReady = false;
  var DEFAULT_TAB = 'filaments', curTab = null;   // onglet courant (routing par hash)
  window.CA.onAdminReady = function (cb) {
    if (isReady) { try { cb(); } catch (e) {} }
    else readyCbs.push(cb);
  };

  function showLogin(msg) {
    app.hidden = true; loginWrap.hidden = false;
    if (msg) loginStatus.textContent = msg;
    isReady = false;
  }

  // La session peut revenir AVANT que tous les modules cms-*.js soient chargés
  // (getSession résout pendant que le navigateur télécharge encore les scripts
  // suivants). On attend la fin du parsing (tous les <script> exécutés) : sinon
  // l'onglet ouvert par rechargement/lien direct (ex. #facturation) n'est jamais
  // initialisé -> « Chargement… » infini.
  function fireReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fireReady, { once: true });
      return;
    }
    isReady = true;
    readyCbs.splice(0).forEach(function (cb) { try { cb(); } catch (e) {} });
    // Lien direct vers un onglet autre que le défaut (ex. #historique) : on déclenche
    // son chargement paresseux maintenant que l'admin est authentifié. Le défaut
    // ('filaments') se charge déjà via onAdminReady — on ne le rejoue pas.
    if (curTab && curTab !== DEFAULT_TAB && window.CA.onTab) {
      try { window.CA.onTab(curTab); } catch (e) {}
    }
  }

  function showApp(session) {
    var email = session && session.user && session.user.email || '';
    // Verrou côté client (le vrai verrou = RLS par e-mail dans schema-v2.sql).
    if (email.toLowerCase() !== String(window.CA.adminEmail).toLowerCase()) {
      sb.auth.signOut();
      showLogin('Ce compte n\'est pas administrateur.');
      return;
    }
    loginWrap.hidden = true; app.hidden = false;
    whoEmail.textContent = email;
    fireReady();
  }

  if (!sb) { showLogin('Configuration Supabase manquante.'); return; }

  // --- Connexion ---
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = (emailI.value || '').trim(), pass = passI.value || '';
    if (!email || !pass) return;
    loginBtn.disabled = true; loginStatus.textContent = 'Connexion…';
    sb.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
      loginBtn.disabled = false;
      if (res.error) { loginStatus.textContent = 'Échec : ' + res.error.message; return; }
      loginStatus.textContent = '';
      showApp(res.data.session);
    }, function (err) {
      loginBtn.disabled = false;
      loginStatus.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  });

  logoutBtn.addEventListener('click', function () {
    sb.auth.signOut().then(function () { showLogin(''); passI.value = ''; });
  });

  // --- Session au chargement ---
  sb.auth.getSession().then(function (res) {
    var session = res && res.data && res.data.session;
    if (session) showApp(session); else showLogin('');
  });

  // --- Menu latéral mobile (tiroir) ---
  var navToggle = $('#nav-toggle'), navDrawer = $('#nav-drawer'), navBackdrop = $('#nav-backdrop');
  function openDrawer() { if (!navDrawer) return; navDrawer.classList.add('open'); if (navBackdrop) navBackdrop.hidden = false; if (navToggle) navToggle.setAttribute('aria-expanded', 'true'); }
  function closeDrawer() { if (!navDrawer) return; navDrawer.classList.remove('open'); if (navBackdrop) navBackdrop.hidden = true; if (navToggle) navToggle.setAttribute('aria-expanded', 'false'); }
  if (navToggle) navToggle.addEventListener('click', function () { navDrawer.classList.contains('open') ? closeDrawer() : openDrawer(); });
  if (navBackdrop) navBackdrop.addEventListener('click', closeDrawer);

  // --- Onglets + routing par hash (#onglet ou #onglet/sous-onglet) --------------
  // Chaque onglet (et sous-onglet) porte son URL : le bouton « retour » du
  // navigateur revient au dernier onglet consulté et un rechargement garde la
  // position — au lieu de toujours retomber sur l'onglet par défaut.
  var tabs = $$('.tab'), panels = $$('.tabpanel');
  var TAB_NAMES = {};
  tabs.forEach(function (t) { TAB_NAMES[t.dataset.tab] = true; });
  var subCbs = [];

  function parseHash() {
    var parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    var tab = (parts[0] && TAB_NAMES[parts[0]]) ? parts[0] : DEFAULT_TAB;
    return { tab: tab, sub: parts[1] || null };
  }
  function hashFor(tab, sub) { return '#' + tab + (sub ? '/' + sub : ''); }

  function activate(name) {                 // bascule le DOM uniquement (pas l'URL)
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tab === name)); });
    panels.forEach(function (p) { p.hidden = (p.dataset.panel !== name); });
    document.body.setAttribute('data-tab', name);
    closeDrawer();
  }
  // Applique l'URL courante à l'écran (au chargement + à chaque hashchange).
  function applyRoute() {
    var r = parseHash();
    if (r.tab !== curTab) {
      curTab = r.tab;
      activate(r.tab);
      // lazy-load : seulement une fois authentifié (au 1er chargement, isReady=false
      // et fireReady() rejouera l'onglet ciblé par un lien direct).
      if (isReady && window.CA.onTab) try { window.CA.onTab(r.tab); } catch (e) {}
    }
    subCbs.forEach(function (cb) { try { cb(r.sub, r.tab); } catch (e) {} });
  }
  // Naviguer = changer le hash (empile une entrée d'historique) -> applyRoute.
  function go(tab, sub) {
    var h = hashFor(tab, sub);
    if (location.hash === h) applyRoute(); else location.hash = h;
  }
  window.addEventListener('hashchange', applyRoute);
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { go(t.dataset.tab, null); });
  });

  // API pour les sous-onglets d'un module (ex. Inventaire : réception / à commander).
  window.CA.route = {
    get: parseHash,
    goSub: function (sub) { go(parseHash().tab, sub); },   // change l'URL du sous-onglet
    onSub: function (cb) { subCbs.push(cb); }               // cb(sub, tab) à chaque changement d'URL
  };

  // Position initiale : honore un lien direct (#onglet/sous-onglet) ou un rechargement.
  applyRoute();
})();
