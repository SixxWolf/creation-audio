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

  var loginWrap = $('#login'), app = $('#app'),
      loginForm = $('#login-form'), emailI = $('#login-email'), passI = $('#login-pass'),
      loginBtn = $('#login-btn'), loginStatus = $('#login-status'),
      whoEmail = $('#who-email'), logoutBtn = $('#logout-btn');

  var readyCbs = [], isReady = false;
  window.CA.onAdminReady = function (cb) {
    if (isReady) { try { cb(); } catch (e) {} }
    else readyCbs.push(cb);
  };

  function showLogin(msg) {
    app.hidden = true; loginWrap.hidden = false;
    if (msg) loginStatus.textContent = msg;
    isReady = false;
  }

  function fireReady() {
    isReady = true;
    readyCbs.splice(0).forEach(function (cb) { try { cb(); } catch (e) {} });
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

  // --- Onglets (barre du haut + tiroir partagent la classe .tab) ---
  var tabs = $$('.tab'), panels = $$('.tabpanel');
  function activate(name) {
    tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.tab === name)); });
    panels.forEach(function (p) { p.hidden = (p.dataset.panel !== name); });
    document.body.setAttribute('data-tab', name);
    closeDrawer();
    if (window.CA.onTab) try { window.CA.onTab(name); } catch (e) {}
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { activate(t.dataset.tab); });
  });
  document.body.setAttribute('data-tab', 'filaments');
})();
