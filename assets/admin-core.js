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

  // Pastille à initiales (listes Clients / Dealers) : teinte stable dérivée du nom.
  window.CA.avatar = function (name) {
    var s = String(name == null ? '' : name).trim();
    var words = s.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    var ini = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return '<span class="person-av" style="--h:' + h + '" aria-hidden="true">' + ini.toUpperCase().replace(/[<>&"']/g, '') + '</span>';
  };

  var loginWrap = $('#login'), app = $('#app'),
      loginForm = $('#login-form'), emailI = $('#login-email'), passI = $('#login-pass'),
      loginBtn = $('#login-btn'), loginStatus = $('#login-status'),
      mfaForm = $('#mfa-form'), mfaCode = $('#mfa-code'), mfaBtn = $('#mfa-btn'), mfaStatus = $('#mfa-status'),
      enrollForm = $('#mfa-enroll-form'), enrollQr = $('#mfa-qr'), enrollSecret = $('#mfa-secret'),
      enrollCode = $('#mfa-enroll-code'), enrollBtn = $('#mfa-enroll-btn'), enrollStatus = $('#mfa-enroll-status'),
      whoEmail = $('#who-email'), logoutBtn = $('#logout-btn');

  var readyCbs = [], isReady = false;
  var DEFAULT_TAB = 'filaments', curTab = null;   // onglet courant (routing par hash)
  window.CA.onAdminReady = function (cb) {
    if (isReady) { try { cb(); } catch (e) {} }
    else readyCbs.push(cb);
  };

  // Écran de connexion en 3 étapes : 'login' (mot de passe) · 'mfa' (code) · 'enroll' (activer la 2FA)
  function step(which) {
    app.hidden = true; loginWrap.hidden = false; isReady = false;
    loginForm.hidden = which !== 'login';
    mfaForm.hidden = which !== 'mfa';
    enrollForm.hidden = which !== 'enroll';
    var f = which === 'mfa' ? mfaCode : which === 'enroll' ? enrollCode : (emailI.value ? passI : emailI);
    setTimeout(function () { try { f.focus(); } catch (e) {} }, 0);
  }
  function showLogin(msg) {
    step('login');
    loginStatus.textContent = msg || '';
  }
  function errMsg(e) { return e && e.message ? e.message : String(e || 'erreur inconnue'); }

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
    // Verrou côté client (le vrai verrou = RLS is_admin() dans schema-v2.sql : e-mail + 2FA).
    if (email.toLowerCase() !== String(window.CA.adminEmail).toLowerCase()) {
      sb.auth.signOut();
      showLogin('Ce compte n\'est pas administrateur.');
      return;
    }
    // 2e facteur : l'admin n'entre qu'avec une session validée par le code (aal2).
    window.CA.mfa.state().then(function (st) {
      if (st === 'ok') {
        loginWrap.hidden = true; app.hidden = false;
        whoEmail.textContent = email;
        fireReady();
      } else if (st === 'challenge') {
        mfaCode.value = ''; mfaStatus.textContent = '';
        step('mfa');
      } else startEnroll();
    }, function (err) { showLogin('Erreur : ' + errMsg(err)); });
  }
  function afterSignIn() {
    sb.auth.getSession().then(function (res) { showApp(res && res.data && res.data.session); });
  }

  if (!sb) { showLogin('Configuration Supabase manquante.'); return; }

  // --- 1) Connexion (mot de passe via le portier : 5 essais puis 15 min) ---
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = (emailI.value || '').trim(), pass = passI.value || '';
    if (!email || !pass || loginBtn.disabled) return;
    loginBtn.disabled = true; loginStatus.textContent = 'Connexion…';
    window.CA.signIn(email, pass).then(function (r) {
      loginBtn.disabled = false;
      if (!r.ok) { loginStatus.textContent = r.message; return; }
      loginStatus.textContent = ''; passI.value = '';
      afterSignIn();
    }, function (err) {
      loginBtn.disabled = false;
      loginStatus.textContent = 'Erreur : ' + errMsg(err);
    });
  });

  // --- 2) Code de l'application d'authentification ---
  window.CA.codeInput(mfaCode, mfaForm);
  mfaForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = mfaCode.value.replace(/\D/g, '');
    if (mfaBtn.disabled) return;
    if (code.length !== 6) { mfaStatus.textContent = 'Le code a 6 chiffres.'; return; }
    mfaBtn.disabled = true; mfaStatus.textContent = 'Vérification…';
    window.CA.mfa.verify(code).then(function (r) {
      mfaBtn.disabled = false;
      if (!r.ok) { mfaStatus.textContent = r.message; mfaCode.select(); return; }
      mfaStatus.textContent = '';
      afterSignIn();
    }, function (err) { mfaBtn.disabled = false; mfaStatus.textContent = 'Erreur : ' + errMsg(err); });
  });

  // --- 2 bis) Première connexion : activer la 2FA ---
  var enrolling = null;
  function startEnroll() {
    enrolling = null; enrollCode.value = ''; enrollSecret.textContent = '';
    enrollQr.removeAttribute('src'); enrollStatus.textContent = 'Préparation…';
    step('enroll');
    window.CA.mfa.enroll().then(function (f) {
      enrolling = f;
      enrollQr.src = f.qr;
      enrollSecret.textContent = f.secret;
      enrollStatus.textContent = '';
    }, function (err) { enrollStatus.textContent = 'Erreur : ' + errMsg(err); });
  }
  window.CA.codeInput(enrollCode, enrollForm);
  enrollForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = enrollCode.value.replace(/\D/g, '');
    if (!enrolling || enrollBtn.disabled) return;
    if (code.length !== 6) { enrollStatus.textContent = 'Le code a 6 chiffres.'; return; }
    enrollBtn.disabled = true; enrollStatus.textContent = 'Vérification…';
    window.CA.mfa.confirm(enrolling.id, code).then(function (r) {
      enrollBtn.disabled = false;
      if (!r.ok) { enrollStatus.textContent = r.message; enrollCode.select(); return; }
      enrollStatus.textContent = '';
      afterSignIn();
    }, function (err) { enrollBtn.disabled = false; enrollStatus.textContent = 'Erreur : ' + errMsg(err); });
  });

  $$('[data-login-cancel]').forEach(function (b) {
    b.addEventListener('click', function () { sb.auth.signOut().then(function () { showLogin(''); }); });
  });

  logoutBtn.addEventListener('click', function () {
    sb.auth.signOut().then(function () { showLogin(''); passI.value = ''; });
  });

  // --- Session au chargement ---
  sb.auth.getSession().then(function (res) {
    var session = res && res.data && res.data.session;
    if (session) showApp(session); else showLogin('');
  });

  // --- Barre latérale : tiroir sur mobile (hamburger, ✕, Échap, fond) ---
  var navToggle = $('#nav-toggle'), navDrawer = $('#nav-drawer'), navBackdrop = $('#nav-backdrop'), navClose = $('#nav-close');
  function openDrawer() {
    if (!navDrawer) return;
    navDrawer.classList.add('open'); if (navBackdrop) navBackdrop.hidden = false;
    if (navToggle) navToggle.setAttribute('aria-expanded', 'true');
    var cur = $('.tab[aria-current="page"]', navDrawer); if (cur) cur.focus();
  }
  function closeDrawer() {
    if (!navDrawer || !navDrawer.classList.contains('open')) return;
    navDrawer.classList.remove('open'); if (navBackdrop) navBackdrop.hidden = true;
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
  }
  if (navToggle) navToggle.addEventListener('click', function () { navDrawer.classList.contains('open') ? closeDrawer() : openDrawer(); });
  if (navBackdrop) navBackdrop.addEventListener('click', closeDrawer);
  if (navClose) navClose.addEventListener('click', function () { closeDrawer(); if (navToggle) navToggle.focus(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && navDrawer && navDrawer.classList.contains('open')) { closeDrawer(); if (navToggle) navToggle.focus(); }
  });
  // « Aller au matériau » (sous-liste de Filaments) : referme le tiroir après le saut
  if (navDrawer) navDrawer.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.mat-nav-link')) closeDrawer();
  });

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

  var topGroup = $('#topbar-group'), topTab = $('#topbar-tab');
  function activate(name) {                 // bascule le DOM uniquement (pas l'URL)
    tabs.forEach(function (t) {
      var on = t.dataset.tab === name;
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
      if (on) {                             // titre de la barre du haut : « Groupe › Onglet »
        var lbl = $('span', t);
        if (topTab) topTab.textContent = lbl ? lbl.textContent : t.textContent;
        if (topGroup) topGroup.textContent = t.dataset.group || '';
      }
    });
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
