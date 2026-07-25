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
  // accessoires (hors catalogue de couleurs) : un seul stock, colonne « qty ».
  // On les enregistre dans les mêmes tables pour réutiliser l'affichage existant.
  // libellés courts : l'admin affiche une ligne compacte sur mobile
  // (la boutique et les factures gardent les noms complets)
  var ACCESSORY = {
    SPOOL:   { name: 'Bobine standard', hex: '#E7E9EA' },
    SPOOLHT: { name: 'Bobine haute T°', hex: '#3A3D42' }
  };
  Object.keys(ACCESSORY).forEach(function (code, i) {
    HEX[code] = ACCESSORY[code].hex;
    NAME[code] = ACCESSORY[code].name;
    LABEL[code] = 'Accessoire · ' + ACCESSORY[code].name;
    MATERIAL[code] = 'Accessoires';
    RANK[code] = 100000 + i;                      // groupe toujours affiché en dernier
  });
  function isAccessory(code) { return ACCESSORY.hasOwnProperty(code); }

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
  // Seul ce compte a accès à l'administration. Les autres comptes connectés
  // (ex. un dealer comme Olivier) sont refusés et déconnectés d'ici.
  // Le vrai verrou reste la RLS Supabase (supabase/restrict-admin-access.sql) :
  // même en contournant ce JavaScript, un non-admin ne peut ni écrire l'inventaire,
  // ni lire les ventes.
  var ADMIN_EMAIL = 'creationaudio.ca@gmail.com';
  function isAdmin(session) {
    return !!(session && session.user && String(session.user.email || '').toLowerCase() === ADMIN_EMAIL);
  }
  // Aiguillage central : session admin -> panneau ; autre compte -> refus ; rien -> login.
  function gate(session) {
    if (!session) { showLogin(); return; }
    if (isAdmin(session)) { showApp(); return; }
    say('Ce compte n\'a pas accès à l\'administration. Utilise plutôt l\'espace dealer (dealer.html).');
    sb.auth.signOut().then(showLogin);
  }
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
    gate(session);
  });

  sb.auth.getSession().then(function (r) {
    gate(r.data && r.data.session);
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
        // onAuthStateChange s'occupe d'aiguiller ; filet de sécurité :
        gate(res.data.session);
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
      if (t.getAttribute('data-tab') === 'sales') loadSales();  // chargement paresseux
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

  /* --- onglets matériau (utiles sur mobile : évite de scroller jusqu'à l'ABS) ---
     Les groupes sont tous rendus ; sur mobile le CSS n'affiche que l'actif. */
  var invMat = null;
  function buildMatTabs(mats) {
    var box = $('#inv-mat-tabs');
    if (!box) return;
    if (mats.indexOf(invMat) === -1) invMat = mats[0] || null;   // garde l'onglet courant si possible
    box.innerHTML = mats.map(function (m) {
      return '<button type="button" class="mat-tab" role="tab" data-mat="' + esc(m) + '">' + esc(m) + '</button>';
    }).join('');
    $$('.mat-tab', box).forEach(function (b) {
      b.addEventListener('click', function () { invMat = b.getAttribute('data-mat'); markMatTabs(); });
    });
    markMatTabs();
  }
  function markMatTabs() {
    $$('.mat-tab').forEach(function (b) {
      var on = b.getAttribute('data-mat') === invMat;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.inv-group').forEach(function (g) {
      g.classList.toggle('is-off', g.getAttribute('data-mat') !== invMat);
    });
  }
  function qtyOf(r) {
    if (isAccessory(r.code)) return r.qty | 0;    // accessoire : un seul stock, insensible au toggle
    return (invKind === 'spool' ? (r.qty_spool != null ? r.qty_spool : 0) : r.qty) | 0;
  }

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
      return '<section class="inv-group" data-mat="' + esc(g.mat) + '">' +
        '<h3 class="inv-group-title">' + esc(g.mat) + '<span class="muted">' + g.items.length + ' couleur' + (g.items.length > 1 ? 's' : '') + '</span></h3>' +
        '<div class="inv-grid">' + g.items.map(cell).join('') + '</div>' +
      '</section>';
    }).join('') + '</div>';

    buildMatTabs(groups.map(function (g) { return g.mat; }));

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
    // accessoire : toujours la colonne « qty » (pas de distinction recharge/bobine)
    var col = (!isAccessory(code) && invKind === 'spool') ? 'qty_spool' : 'qty';
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

  /* ---------------- VENTES ---------------- */
  var salesDays = 30;
  (function initSalesControls() {
    $$('.sales-range-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        salesDays = parseInt(b.getAttribute('data-days'), 10) || 30;
        $$('.sales-range-btn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        loadSales();
      });
    });
    var r = $('#sales-refresh'); if (r) r.addEventListener('click', loadSales);
  })();

  function loadSales() {
    var box = $('#sales-body'); if (!box) return;
    box.innerHTML = '<p class="muted">Chargement…</p>';
    var since = new Date(Date.now() - salesDays * 864e5).toISOString();
    sb.from('sales').select('code,name,material,type,qty,unit_price,invoice_no,sold_at')
      .gte('sold_at', since).order('sold_at', { ascending: false })
      .then(function (res) {
        if (res.error) {
          box.innerHTML = '<p class="muted">Impossible de charger les ventes. ' +
            'Si c\'est la première fois, exécute <strong>supabase/add-sales.sql</strong> dans Supabase.</p>';
          return;
        }
        renderSales(res.data || []);
      }, function () { box.innerHTML = '<p class="muted">Erreur réseau.</p>'; });
  }

  function salesMoney(n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  var SALES_TYPE = { refill: 'Recharge', spool: 'Avec Bobine', accessory: 'Accessoire' };

  function renderSales(rows) {
    var box = $('#sales-body');
    if (!rows.length) {
      box.innerHTML = '<p class="sales-empty">Aucune vente sur cette période.<br>' +
        'Les ventes s\'enregistrent quand tu cliques «&nbsp;Déduire de l\'inventaire&nbsp;» dans la facturation.</p>';
      return;
    }
    var totalRev = 0, totalUnits = 0, invoices = {}, agg = {}, order = [];
    rows.forEach(function (r) {
      var q = r.qty | 0, rev = q * (parseFloat(r.unit_price) || 0);
      totalRev += rev; totalUnits += q;
      if (r.invoice_no) invoices[r.invoice_no] = 1;
      var k = r.code + '|' + r.type;
      if (!agg[k]) { agg[k] = { code: r.code, name: r.name, material: r.material, type: r.type, qty: 0, rev: 0 }; order.push(k); }
      agg[k].qty += q; agg[k].rev += rev;
    });
    var list = order.map(function (k) { return agg[k]; })
      .sort(function (a, b) { return b.qty - a.qty || b.rev - a.rev; });
    var top = list[0], nInv = Object.keys(invoices).length;

    var stats = '<div class="sales-stats">' +
      '<div class="sales-stat"><div class="num">' + salesMoney(totalRev) + '</div><div class="lbl">Chiffre d\'affaires</div></div>' +
      '<div class="sales-stat"><div class="num">' + totalUnits + '</div><div class="lbl">Articles vendus</div></div>' +
      '<div class="sales-stat"><div class="num">' + nInv + '</div><div class="lbl">Facture' + (nInv > 1 ? 's' : '') + '</div></div>' +
      (top ? '<div class="sales-stat hot"><div class="num">' + esc(colorName(top.code, top.name)) +
        '</div><div class="lbl">Plus populaire · ' + top.qty + ' vendu' + (top.qty > 1 ? 's' : '') + '</div></div>' : '') +
      '</div>';

    var listHtml = '<h3 class="sales-sect-title">Détail par produit (du plus vendu au moins vendu)</h3>' +
      '<div class="sales-list">' + list.map(function (a, i) {
        var mat = a.material || materialOf(a.code);
        return '<div class="sales-row' + (i === 0 ? ' top' : '') + '">' +
          '<span class="sales-rank">' + (i + 1) + '</span>' +
          '<span class="sales-sw" style="background:' + hexFor(a.code) + '"></span>' +
          '<span class="sales-nm">' + esc(colorName(a.code, a.name)) +
            '<span class="sub"> · ' + esc(mat) + ' · ' + esc(a.code) + ' · ' + (SALES_TYPE[a.type] || esc(a.type)) + '</span></span>' +
          '<span class="sales-qty">' + a.qty + '<span class="u">&nbsp;u</span></span>' +
          '<span class="sales-rev">' + salesMoney(a.rev) + '</span>' +
        '</div>';
      }).join('') + '</div>';

    box.innerHTML = stats + listHtml;
  }
})();
