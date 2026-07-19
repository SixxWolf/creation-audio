/* =========================================================
   Création Audio — panneau admin
   Connexion Supabase + gestion de l'inventaire.
   Nécessite : supabase-config.js, le CDN supabase-js, supabase-client.js.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var loginView = $('#login'), appView = $('#app'), loginErr = $('#login-err');

  if (!sb) {
    loginErr.textContent = 'Configuration Supabase manquante (assets/supabase-config.js).';
    loginErr.className = 'login-err show';
    return;
  }

  // Supabase ne peut pas conserver la session sur file:// — il faut un vrai serveur http(s).
  if (location.protocol === 'file:') {
    loginErr.textContent = 'Ouvre cette page via une adresse http(s) (ton site en ligne ou un serveur local), pas en double-cliquant le fichier : la connexion ne peut pas se maintenir en « file:// ».';
    loginErr.className = 'login-err show';
  }

  // Détecte si le navigateur bloque le stockage de session (localStorage indisponible).
  try {
    var __t = '__ca_test__'; localStorage.setItem(__t, '1'); localStorage.removeItem(__t);
  } catch (e) {
    loginErr.textContent = 'Ton navigateur bloque le stockage local (localStorage) — la session ne peut pas être gardée. Désactive le mode privé/incognito ou autorise les cookies pour ce site.';
    loginErr.className = 'login-err show';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // couleur + libellé complet par code, depuis le catalogue partagé (assets/catalog.js)
  var HEX = {}, LABEL = {}, RANK = {}, NAME = {}, MATERIAL = {};
  (window.CA_CATALOG || []).forEach(function (i, idx) {
    HEX[i.code] = i.hex;
    LABEL[i.code] = i.material + ' · ' + i.name;   // ex. « PLA Basic · Cyan »
    NAME[i.code] = i.name;                          // couleur seule, ex. « Cyan »
    MATERIAL[i.code] = i.material;                  // ex. « PLA Basic »
    RANK[i.code] = idx;                            // ordre spectral du catalogue
  });
  function colorName(code, dbName) { return NAME[code] || dbName || code; }
  function materialOf(code) { return MATERIAL[code] || 'Autres'; }
  // trie l'inventaire comme la boutique (ordre spectral), inconnus à la fin
  function bySpectral(a, b) {
    var ra = RANK.hasOwnProperty(a.code) ? RANK[a.code] : 9999;
    var rb = RANK.hasOwnProperty(b.code) ? RANK[b.code] : 9999;
    return ra - rb || String(a.code).localeCompare(String(b.code));
  }
  function hexFor(code) { return HEX[code] || '#D9D9D9'; }
  // le catalogue prime : les 30 PLA Basic sont nommés « Cyan » en base, on affiche le matériau
  function labelFor(code, dbName) { return LABEL[code] || dbName || code; }

  /* ---------------- AUTH ---------------- */
  function say(msg, kind) {
    loginErr.textContent = msg;
    loginErr.className = 'login-err ' + (msg ? 'show' : '') + (kind === 'ok' ? ' ok' : '');
  }
  function showApp() {
    loginView.hidden = true; appView.hidden = false;
    try { boot(); }
    catch (err) { console.error('boot() a échoué', err); say('Connecté, mais erreur au chargement : ' + (err && err.message ? err.message : err)); }
  }
  function showLogin() { appView.hidden = true; loginView.hidden = false; }

  // Source de vérité : l'état d'auth. Dès qu'une session existe → on ouvre le panneau.
  sb.auth.onAuthStateChange(function (event, session) {
    console.log('[admin] auth event:', event, 'session?', !!session);
    if (session) showApp(); else showLogin();
  });

  sb.auth.getSession().then(function (r) {
    if (r.data && r.data.session) showApp(); else showLogin();
  });

  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    say('');
    var btn = $('#login-btn'); btn.disabled = true; btn.textContent = 'Connexion…';
    sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value })
      .then(function (res) {
        btn.disabled = false; btn.textContent = 'Se connecter';
        console.log('[admin] signIn →', res);
        if (res.error) {
          var raw = (res.error.message || '').toLowerCase(), msg;
          if (raw.indexOf('email not confirmed') > -1 || raw.indexOf('not confirmed') > -1) {
            msg = 'Courriel non confirmé. Dans Supabase → Authentication → Providers → Email, désactive « Confirm email », puis réessaie.';
          } else if (raw.indexOf('invalid login') > -1 || raw.indexOf('invalid credentials') > -1) {
            msg = 'Courriel ou mot de passe incorrect.';
          } else {
            msg = 'Connexion refusée : ' + (res.error.message || 'erreur inconnue');
          }
          say(msg); return;
        }
        if (!(res.data && res.data.session)) {
          say('Connexion acceptée mais aucune session reçue. Vérifie que le compte est confirmé dans Supabase.');
          return;
        }
        // onAuthStateChange s'occupe d'ouvrir le panneau ; filet de sécurité :
        showApp();
      }, function (err) {
        btn.disabled = false; btn.textContent = 'Se connecter';
        console.error('[admin] signIn rejet', err);
        say('Erreur réseau : ' + (err && err.message ? err.message : err));
      });
  });

  $('#logout').addEventListener('click', function () {
    sb.auth.signOut().then(showLogin);
  });

  /* ---------------- ONGLETS ---------------- */
  $$('.admin-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('.admin-tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      $$('.tab-panel').forEach(function (p) { p.hidden = true; });
      $('#tab-' + t.getAttribute('data-tab')).hidden = false;
    });
  });

  var booted = false;
  function boot() {
    if (booted) return; booted = true;
    loadInventory();
  }

  /* ---------------- INVENTAIRE ---------------- */
  // vue courante de l'inventaire : « refill » (recharges) ou « spool » (avec bobine)
  var invKind = 'refill';
  var invData = null;

  function loadInventory() {
    // toggle Refill / Avec Bobine (attaché une fois)
    $$('.inv-toggle-btn').forEach(function (b) {
      b.addEventListener('click', function () { setInvKind(b.getAttribute('data-kind')); });
    });
    markInvToggle();
    // On lit les deux stocks ; si qty_spool n'existe pas encore (migration pas faite),
    // on retombe sur qty seul.
    sb.from('inventory').select('code,name,qty,qty_spool').order('code').then(function (res) {
      if (res.error) { sb.from('inventory').select('code,name,qty').order('code').then(function (r2) { invData = r2; renderInv(); }); }
      else { invData = res; renderInv(); }
    });
  }

  function setInvKind(kind) { invKind = (kind === 'spool') ? 'spool' : 'refill'; markInvToggle(); renderInv(); }
  function markInvToggle() {
    $$('.inv-toggle-btn').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-kind') === invKind); });
  }
  function qtyOf(r) { return (invKind === 'spool' ? (r.qty_spool != null ? r.qty_spool : 0) : r.qty) | 0; }

  function renderInv() {
    var box = $('#inv-list');
    if (!invData || invData.error) { box.innerHTML = '<p class="muted">Erreur de chargement.</p>'; return; }

    function cell(r) {
      var v = qtyOf(r);
      return '<div class="inv-row ' + (v > 0 ? 'in' : 'out') + '" data-code="' + r.code +
          '" title="' + esc(colorName(r.code, r.name)) + ' — ' + r.code + '">' +
        '<span class="inv-name"><span class="inv-sw" style="--c:' + hexFor(r.code) + '"></span>' +
          '<span class="inv-cname">' + esc(colorName(r.code, r.name)) + '</span></span>' +
        '<span class="inv-code">' + r.code + '</span>' +
        '<div class="inv-stepper">' +
          '<button class="q-dec" aria-label="moins">&minus;</button>' +
          '<input type="number" class="inv-qty" min="0" step="1" value="' + v + '">' +
          '<button class="q-inc" aria-label="plus">+</button>' +
        '</div>' +
      '</div>';
    }

    var groups = [], idxByMat = {};
    invData.data.slice().sort(bySpectral).forEach(function (r) {
      var mat = materialOf(r.code);
      if (!idxByMat.hasOwnProperty(mat)) { idxByMat[mat] = groups.length; groups.push({ mat: mat, items: [] }); }
      groups[idxByMat[mat]].items.push(r);
    });

    box.innerHTML = '<div class="inv-board">' + groups.map(function (g) {
      return '<section class="inv-group">' +
        '<h3 class="inv-group-title">' + esc(g.mat) + '<span class="muted">' + g.items.length + ' couleur' + (g.items.length > 1 ? 's' : '') + '</span></h3>' +
        '<div class="inv-grid">' + g.items.map(cell).join('') + '</div>' +
      '</section>';
    }).join('') + '</div>';

    $$('.inv-row', box).forEach(function (row) {
      var code = row.getAttribute('data-code');
      var input = $('.inv-qty', row);
      $('.q-dec', row).addEventListener('click', function () { input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1); saveQty(code, input.value, row); });
      $('.q-inc', row).addEventListener('click', function () { input.value = (parseInt(input.value, 10) || 0) + 1; saveQty(code, input.value, row); });
      input.addEventListener('change', function () { saveQty(code, input.value, row); });
    });
  }

  function saveQty(code, val, row) {
    var qty = Math.max(0, parseInt(val, 10) || 0);
    var col = invKind === 'spool' ? 'qty_spool' : 'qty';
    var patch = { updated_at: new Date().toISOString() };
    patch[col] = qty;
    row.classList.add('saving');
    sb.from('inventory').update(patch).eq('code', code).then(function (res) {
      row.classList.remove('saving');
      if (res.error) { flash(row, 'err'); return; }
      // met à jour le cache pour garder la valeur au changement de vue
      if (invData && invData.data) {
        for (var i = 0; i < invData.data.length; i++) { if (invData.data[i].code === code) { invData.data[i][col] = qty; break; } }
      }
      row.classList.toggle('in', qty > 0);
      row.classList.toggle('out', qty <= 0);
      flash(row, 'ok');
    });
  }
  function flash(row, kind) { row.classList.add('flash-' + kind); setTimeout(function () { row.classList.remove('flash-' + kind); }, 900); }
})();
