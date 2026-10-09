/* =========================================================
   Création Audio — Mon compte (compte.html)
   Connexion SANS mot de passe : code à 6 chiffres reçu par courriel
   (Edge Function « compte-code » : envoi, vérification, session).
   Espace client : factures de la fiche reliée par l'admin (RPC me_invoices,
   sans coût ni marge) + réimpression PDF, alertes « M'aviser » (me_waitlist),
   coordonnées (me_update), suppression du compte (me_delete, Loi 25).
   Session rangée sous SA PROPRE clé (ca-compte-auth) : elle ne touche jamais à
   la session admin / dealer du même navigateur. nav.js lit cette clé pour la
   pastille « connecté » de l'en-tête.
   Routes (connecté) : #/commandes · #/alertes · #/infos
   Démo : CA.compte (faux client) et CA.compteFn (fausse Edge Function) peuvent
   être posés avant ce script.
   ========================================================= */
(function () {
  'use strict';

  var cfg = window.CA_SUPABASE || {};
  var CA = window.CA = window.CA || {};
  var KEY = 'ca-compte-auth', PENDING = 'ca_compte_pending';
  var FB = 'https://m.me/61591945465745', EMAIL = 'contact@creationaudio.ca';
  var CODE_TTL = 10 * 60 * 1000, RESEND_MS = 60 * 1000;

  var sb = CA.compte || (cfg.url && cfg.anonKey && window.supabase && window.supabase.createClient
    ? window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { storageKey: KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      })
    : null);
  var callFn = CA.compteFn || function (body) {
    return fetch(cfg.url + '/functions/v1/compte-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { b = b || {}; b._status = r.status; return b; });
    });
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slugify(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function money(n) { return (+n || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function fmtDate(d, withYear) {
    if (!d) return '';
    var x = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
    if (isNaN(x)) return '';
    return x.toLocaleDateString('fr-CA', withYear === false ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  var SPARKLE = /sparkle|galaxy|glitter|paillet/i;
  function swatch(hex, name) {
    if (!hex) return '<span class="sw sw-none" aria-hidden="true"></span>';
    var bg = (SPARKLE.test(name || '') ? 'var(--sparkle), ' : '') + esc(hex);
    return '<span class="sw" style="background:' + bg + '" aria-hidden="true"></span>';
  }
  function askHtml(subject, body) {
    return '<a class="ask" href="' + FB + '" target="_blank" rel="noopener">Écris-nous</a>' +
      '<span class="ask-alt"> ou <a href="mailto:' + EMAIL + '?subject=' + encodeURIComponent(subject) +
      '&amp;body=' + encodeURIComponent(body) + '">par courriel</a></span>';
  }

  /* ---------- écrans ---------- */
  var SCREENS = ['acct-boot', 'acct-login', 'acct-code', 'acct-welcome', 'acct-home'];
  function show(id) {
    SCREENS.forEach(function (s) { var el = document.getElementById(s); if (el) el.hidden = s !== id; });
  }
  function signedIn(on) {
    $$('.home-account').forEach(function (a) { a.classList.toggle('is-in', !!on); });
  }
  function say(el, text, cls) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'acct-status' + (cls ? ' ' + cls : '');
  }

  /* ---------- code en attente (survit au rechargement : passage par l'appli courriel) ---------- */
  function getPending() {
    try {
      var p = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
      return p && p.email && Date.now() - p.at < CODE_TTL ? p : null;
    } catch (e) { return null; }
  }
  function setPending(p) {
    try { if (p) sessionStorage.setItem(PENDING, JSON.stringify(p)); else sessionStorage.removeItem(PENDING); } catch (e) {}
  }

  /* ---------- 1. courriel -> code envoyé ---------- */
  var emailForm = $('#acct-email-form'), emailIn = $('#acct-email'), emailBtn = $('#acct-email-btn'), emailSt = $('#acct-email-status');
  var codeForm = $('#acct-code-form'), codeIn = $('#acct-code-in'), codeBtn = $('#acct-code-btn'), codeSt = $('#acct-code-status');
  var resendBtn = $('#acct-resend'), changeBtn = $('#acct-change');
  var resendTimer = null;

  function sendErr(b) {
    if (b.error === 'wait') {
      var s = Math.max(1, +b.retry_after || 60);
      return s > 90 ? 'Trop de demandes. Réessaie dans ' + plural(Math.ceil(s / 60), 'minute', 'minutes') + '.'
                    : 'Patiente ' + s + ' s avant de redemander un code.';
    }
    if (b.error === 'reserved') return 'Ce courriel a sa propre page de connexion.';
    if (b.error === 'bad_request') return 'Entre un courriel valide.';
    if (b.error === 'mail') return 'Envoi impossible pour le moment. Réessaie dans un instant.';
    return 'Service indisponible. Réessaie plus tard.';
  }
  function sendCode(email, statusEl, btn) {
    btn.disabled = true; say(statusEl, 'Envoi…');
    return callFn({ action: 'send', email: email, hp: ($('#acct-hp') || {}).value || '' }).then(function (b) {
      btn.disabled = false;
      if (!b.ok) { say(statusEl, sendErr(b), 'bad'); return false; }
      setPending({ email: email, at: Date.now(), sent: Date.now() });
      return true;
    }, function () { btn.disabled = false; say(statusEl, 'Erreur réseau — réessaie.', 'bad'); return false; });
  }
  emailForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = (emailIn.value || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { say(emailSt, 'Entre un courriel valide.', 'bad'); emailIn.focus(); return; }
    sendCode(email, emailSt, emailBtn).then(function (ok) { if (ok) { say(emailSt, ''); openCode(); } });
  });

  function openCode() {
    var p = getPending(); if (!p) { openLogin(); return; }
    $('#acct-code-to').textContent = p.email;
    codeIn.value = ''; say(codeSt, ''); codeBtn.disabled = false;
    show('acct-code');
    tickResend();
    codeIn.focus();
  }
  function tickResend() {
    clearTimeout(resendTimer);
    var p = getPending(); if (!p) return;
    var left = Math.ceil((p.sent + RESEND_MS - Date.now()) / 1000);
    resendBtn.disabled = left > 0;
    resendBtn.textContent = left > 0 ? 'Renvoyer dans ' + left + ' s' : 'Renvoyer le code';
    if (left > 0) resendTimer = setTimeout(tickResend, 1000);
  }
  resendBtn.addEventListener('click', function () {
    var p = getPending(); if (!p) { openLogin(); return; }
    sendCode(p.email, codeSt, resendBtn).then(function (ok) {
      if (ok) { say(codeSt, 'Nouveau code envoyé.', 'ok'); codeIn.value = ''; codeIn.focus(); }
      tickResend();
    });
  });
  changeBtn.addEventListener('click', function () {
    var p = getPending(); setPending(null);
    openLogin(p && p.email);
  });

  // chiffres seulement ; 6 chiffres -> envoi automatique
  codeIn.addEventListener('input', function () {
    var v = codeIn.value.replace(/\D/g, '').slice(0, 6);
    if (v !== codeIn.value) codeIn.value = v;
    if (v.length === 6 && !codeBtn.disabled) { if (codeForm.requestSubmit) codeForm.requestSubmit(); else verify(); }
  });
  codeForm.addEventListener('submit', function (e) { e.preventDefault(); verify(); });
  function verify() {
    var p = getPending(); if (!p) { openLogin(); return; }
    var code = codeIn.value.replace(/\D/g, '');
    if (code.length !== 6) { say(codeSt, 'Entre les 6 chiffres reçus.', 'bad'); codeIn.focus(); return; }
    codeBtn.disabled = true; say(codeSt, 'Vérification…');
    callFn({ action: 'verify', email: p.email, code: code }).then(function (b) {
      if (b.session) {
        return sb.auth.setSession(b.session).then(function (s) {
          if (s.error) throw s.error;
          setPending(null);
          signedIn(true);
          boot();
        });
      }
      codeBtn.disabled = false;
      if (b.error === 'invalid') { say(codeSt, 'Code incorrect · ' + plural(b.left, 'essai restant', 'essais restants') + '.', 'bad'); codeIn.select(); return; }
      if (b.error === 'expired') { say(codeSt, 'Ce code n\'est plus valable. Demande un nouveau code.', 'bad'); return; }
      if (b.error === 'revoked') { say(codeSt, 'Accès retiré. Écris-nous à ' + EMAIL + '.', 'bad'); return; }
      say(codeSt, 'Connexion impossible pour le moment. Réessaie.', 'bad');
    }).catch(function () { codeBtn.disabled = false; say(codeSt, 'Connexion impossible pour le moment. Réessaie.', 'bad'); });
  }

  function openLogin(email, msg) {
    clearTimeout(resendTimer);
    if (email) emailIn.value = email;
    say(emailSt, msg || '', msg ? 'ok' : '');
    emailBtn.disabled = false;
    show('acct-login');
  }

  /* ---------- démarrage : session ? ---------- */
  var acct = null, invoices = [], alerts = [], company = null;

  function isAuthError(err) {
    var c = String((err && (err.code || err.status)) || '');
    return /^(401|403|PGRST301|42501|23503)$/.test(c) || /jwt|token|auth/i.test((err && err.message) || '');
  }
  function boot() {
    if (!sb) { show('acct-boot'); $('#acct-boot').textContent = 'Service indisponible pour le moment.'; return; }
    sb.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (!s) {
        signedIn(false);
        if (getPending()) openCode(); else openLogin();
        return;
      }
      signedIn(true);
      return sb.rpc('me_account').then(function (res) {
        if (res.error) {
          if (isAuthError(res.error)) return sb.auth.signOut().then(function () { signedIn(false); openLogin(); });
          show('acct-boot'); $('#acct-boot').textContent = 'Impossible de charger ton compte. Réessaie dans un instant.';
          return;
        }
        acct = res.data || {};
        if (!String(acct.name || '').trim()) { openWelcome(); return; }
        openHome();
      });
    }).catch(function () { show('acct-boot'); $('#acct-boot').textContent = 'Impossible de charger ton compte. Réessaie dans un instant.'; });
  }
  if (sb && sb.auth.onAuthStateChange) {
    sb.auth.onAuthStateChange(function (ev) {
      if (ev === 'SIGNED_OUT' && !$('#acct-home').hidden) { signedIn(false); openLogin(); }
    });
  }

  /* ---------- 3. première connexion : le nom ---------- */
  function openWelcome() {
    $('#acct-w-name').value = ''; $('#acct-w-phone').value = acct.phone || '';
    say($('#acct-w-status'), '');
    show('acct-welcome');
    $('#acct-w-name').focus();
  }
  $('#acct-welcome-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#acct-w-name').value.trim(), st = $('#acct-w-status'), btn = $('#acct-w-btn');
    if (!name) { say(st, 'Entre ton nom.', 'bad'); $('#acct-w-name').focus(); return; }
    btn.disabled = true; say(st, 'Enregistrement…');
    sb.rpc('me_update', { p_name: name, p_phone: $('#acct-w-phone').value.trim() }).then(function (res) {
      btn.disabled = false;
      if (res.error) { say(st, 'Enregistrement impossible. Réessaie.', 'bad'); return; }
      acct = res.data || acct;
      openHome();
    }, function () { btn.disabled = false; say(st, 'Erreur réseau — réessaie.', 'bad'); });
  });

  /* ---------- 4. espace client ---------- */
  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
  function openHome() {
    $('#acct-hello').textContent = 'Bonjour ' + firstName(acct.name);
    $('#acct-sub').textContent = acct.email || '';
    fillInfos();
    show('acct-home');
    if (!/^#\/(commandes|alertes|infos)$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/commandes');
    route();
    loadOrders();
    loadAlerts();
  }
  function route() {
    if ($('#acct-home').hidden) return;
    var m = /^#\/(commandes|alertes|infos)$/.exec(location.hash), tab = m ? m[1] : 'commandes';
    $$('.acct-tabs a').forEach(function (a) {
      if (a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $$('.acct-panel').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab; });
  }
  window.addEventListener('hashchange', route);

  $('#acct-logout').addEventListener('click', function () {
    sb.auth.signOut().then(function () {
      acct = null; signedIn(false);
      history.replaceState(null, '', location.pathname + location.search);
      openLogin();
    });
  });

  /* ---- Mes commandes ---- */
  var ordersEl = $('#acct-orders');
  function loadOrders() {
    ordersEl.innerHTML = '<p class="acct-empty">Chargement…</p>';
    if (!acct.linked) { renderOrders(); return; }
    sb.rpc('me_invoices').then(function (res) {
      if (res.error) { ordersEl.innerHTML = '<p class="acct-empty">Impossible de charger tes factures. Réessaie plus tard.</p>'; return; }
      invoices = res.data || [];
      renderOrders();
    }, function () { ordersEl.innerHTML = '<p class="acct-empty">Erreur réseau — réessaie.</p>'; });
  }
  function pendingOf(inv) {
    return (inv.lines || []).reduce(function (s, l) { return s + (+l.qty_pending || 0); }, 0);
  }
  function itemsOf(inv) {
    return (inv.lines || []).reduce(function (s, l) { return s + (+l.qty || 0); }, 0);
  }
  function renderOrders() {
    if (!acct.linked) {
      ordersEl.innerHTML = '<div class="acct-empty"><p>Tes factures apparaîtront ici dès qu\'on aura relié ton compte. Déjà client&nbsp;? ' +
        askHtml('Relier mon compte', 'Bonjour,\n\nJ\'ai créé mon compte sur creationaudio.ca avec le courriel ' + (acct.email || '') +
          '. Pouvez-vous le relier à mes achats ?\n\nMerci !') + '</p></div>';
      return;
    }
    if (!invoices.length) { ordersEl.innerHTML = '<p class="acct-empty">Aucune facture pour l\'instant.</p>'; return; }
    ordersEl.innerHTML = '<div class="ord-list">' + invoices.map(function (inv) {
      var pend = pendingOf(inv), n = itemsOf(inv), off = inv.status === 'cancelled';
      var pill = off ? '<span class="ord-pill off">Annulée</span>'
        : pend ? '<span class="ord-pill pend">' + pend + ' à venir</span>' : '';
      var lines = (inv.lines || []).map(function (l) {
        var lp = +l.qty_pending || 0;
        return '<li>' + swatch(l.hex, (l.label || '') + ' ' + (l.meta || '')) +
          '<span class="ol-tx"><b>' + esc(l.label || '') + '</b>' + (l.meta ? '<small>' + esc(l.meta) + '</small>' : '') +
            (lp && !off ? '<em class="ol-pend">' + lp + ' à venir</em>' : '') + '</span>' +
          '<span class="ol-q">' + (+l.qty) + ' × ' + money(l.unit_price) + '</span>' +
          '<span class="ol-t">' + money(l.line_total) + '</span></li>';
      }).join('');
      var tax = inv.tax_enabled
        ? '<div><span>TPS</span><span>' + money(inv.tax_gst) + '</span></div><div><span>TVQ</span><span>' + money(inv.tax_qst) + '</span></div>' : '';
      return '<details class="ord' + (off ? ' is-off' : '') + '" data-id="' + esc(inv.id) + '">' +
        '<summary>' +
          '<span class="ord-main"><b class="ord-no">' + esc(inv.number || 'Facture') + '</b>' +
            '<span class="ord-meta">' + esc(fmtDate(inv.invoice_date)) + ' · ' + plural(n, 'article', 'articles') + '</span></span>' +
          pill +
          '<span class="ord-total">' + money(inv.total) + '</span>' +
          '<span class="ord-chev" aria-hidden="true"></span>' +
        '</summary>' +
        '<div class="ord-body">' +
          '<ul class="ord-lines">' + lines + '</ul>' +
          '<div class="ord-tot">' +
            (inv.tax_enabled ? '<div><span>Sous-total</span><span>' + money(inv.subtotal) + '</span></div>' + tax : '') +
            '<div class="grand"><span>Total</span><span>' + money(inv.total) + '</span></div>' +
          '</div>' +
          (inv.note ? '<p class="ord-note"><span>Note</span>' + esc(inv.note) + '</p>' : '') +
          '<button class="acct-btn ord-print" type="button">Imprimer / PDF</button>' +
        '</div>' +
      '</details>';
    }).join('') + '</div>';
    $$('.ord', ordersEl).forEach(function (el) {
      var inv = invoices.filter(function (x) { return String(x.id) === el.getAttribute('data-id'); })[0];
      $('.ord-print', el).addEventListener('click', function () { printInvoice(inv); });
    });
  }

  /* ---- réimpression : même document que l'Historique de l'admin ---- */
  var DEFAULT_CO = { name: 'Création Audio', tagline: 'Audio automobile & impression 3D — Québec', address: '',
    city: 'Québec, QC', email: EMAIL, phone: '', gst: '', qst: '', logo: '' };
  function loadCompany() {
    if (company) return Promise.resolve(company);
    return sb.rpc('company_public').then(function (res) {
      var co = (!res.error && res.data) || {}, m = {};
      for (var k in DEFAULT_CO) m[k] = (co[k] != null && co[k] !== '') ? co[k] : DEFAULT_CO[k];
      company = m; return m;
    }, function () { company = DEFAULT_CO; return DEFAULT_CO; });
  }
  function buildDoc(inv, co) {
    var meta = [co.address, co.city, co.email, co.phone].filter(Boolean);
    var billto = (inv.client_name || inv.client_contact || inv.client_address || inv.client_city)
      ? '<div class="inv-billto"><div class="lbl">Facturé à</div>' +
        (inv.client_name ? '<div class="who">' + esc(inv.client_name) + '</div>' : '') +
        (inv.client_address ? '<div>' + esc(inv.client_address) + '</div>' : '') +
        (inv.client_city ? '<div>' + esc(inv.client_city) + '</div>' : '') +
        (inv.client_contact ? '<div>' + esc(inv.client_contact) + '</div>' : '') + '</div>'
      : '';
    var rows = (inv.lines || []).map(function (l) {
      return '<tr><td>' + esc(l.label || '') + (l.meta ? ' <span class="inv-mat">' + esc(l.meta) + '</span>' : '') + '</td>' +
        '<td class="num">' + (+l.qty) + '</td><td class="num">' + money(l.unit_price) + '</td><td class="num">' + money(l.line_total) + '</td></tr>';
    }).join('');
    var taxLines = inv.tax_enabled
      ? '<div class="line"><span>TPS' + (co.gst ? ' <span class="taxno">' + esc(co.gst) + '</span>' : '') + '</span><span>' + money(inv.tax_gst) + '</span></div>' +
        '<div class="line"><span>TVQ' + (co.qst ? ' <span class="taxno">' + esc(co.qst) + '</span>' : '') + '</span><span>' + money(inv.tax_qst) + '</span></div>'
      : '';
    return '<div class="inv-top">' +
        '<div class="inv-co">' + (co.logo ? '<img class="inv-logo" src="' + esc(co.logo) + '" alt="">' : '') +
          '<div class="inv-co-name">' + esc(co.name) + '</div>' +
          (co.tagline ? '<div class="inv-co-tag">' + esc(co.tagline) + '</div>' : '') +
          (meta.length ? '<div class="inv-co-meta">' + esc(meta.join('\n')) + '</div>' : '') + '</div>' +
        '<div class="inv-title"><h1>FACTURE</h1><div class="inv-meta">N° ' + esc(inv.number || '—') + '<br>' + esc(fmtDate(inv.invoice_date)) + '</div></div>' +
      '</div>' + (inv.status === 'cancelled' ? '<div class="inv-cancelled">FACTURE ANNULÉE</div>' : '') + billto +
      '<table class="inv-table"><thead><tr><th>Description</th><th class="num">Qté</th><th class="num">Prix unit.</th><th class="num">Montant</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
      '<div class="inv-tot">' +
        '<div class="line"><span>Sous-total</span><span>' + money(inv.subtotal) + '</span></div>' + taxLines +
        '<div class="line grand"><span>Total</span><span>' + money(inv.total) + '</span></div>' +
      '</div>' +
      (inv.note ? '<div class="inv-pay"><span class="lbl">Note</span>' + esc(inv.note) + '</div>' : '') +
      '<div class="inv-foot">Aucun paiement en ligne — ramassage à Québec. Merci de votre confiance&nbsp;!</div>';
  }
  var TITLE = document.title;
  function printInvoice(inv) {
    if (!inv) return;
    loadCompany().then(function (co) {
      var box = $('#acct-print');
      box.innerHTML = buildDoc(inv, co);
      document.title = String(inv.number || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || TITLE;   // nom proposé par « Enregistrer en PDF »
      document.body.classList.add('acct-printing');
      window.print();
      setTimeout(function () { document.body.classList.remove('acct-printing'); box.innerHTML = ''; document.title = TITLE; }, 400);
    });
  }

  /* ---- Mes alertes (« M'aviser ») ---- */
  var alertsEl = $('#acct-alerts'), alertsN = $('#acct-n-alerts');
  var KIND = { spool: 'avec bobine', refill: 'recharge' };
  function productHref(a) {
    if (a.type === 'spacer') return 'spacers.html';
    if (a.type === 'accessory') return 'boutique.html#/a/' + encodeURIComponent(a.slug || slugify(a.name));
    return 'boutique.html#/m/' + (a.brand_slug || slugify(a.brand || 'Autres')) + '/' +
      (a.material_slug || slugify(a.material || 'Autres')) + '/' + (a.slug || slugify(a.name));
  }
  function loadAlerts() {
    alertsEl.innerHTML = '<p class="acct-empty">Chargement…</p>';
    sb.rpc('me_waitlist').then(function (res) {
      if (res.error) { alertsEl.innerHTML = '<p class="acct-empty">Impossible de charger tes alertes. Réessaie plus tard.</p>'; return; }
      alerts = res.data || [];
      renderAlerts();
    }, function () { alertsEl.innerHTML = '<p class="acct-empty">Erreur réseau — réessaie.</p>'; });
  }
  function renderAlerts() {
    alertsN.hidden = !alerts.length; alertsN.textContent = alerts.length;
    if (!alerts.length) {
      alertsEl.innerHTML = '<p class="acct-empty">Aucune alerte. Sur une couleur en rupture, «&nbsp;M\'aviser&nbsp;» t\'ajoute ici. ' +
        '<a href="boutique.html">Voir les filaments</a></p>';
      return;
    }
    alertsEl.innerHTML = '<ul class="al-list">' + alerts.map(function (a) {
      var sub = [a.type === 'filament' ? [a.brand, a.material].filter(Boolean).join(' ') : '', KIND[a.kind] || ''].filter(Boolean).join(' · ');
      return '<li class="al" data-id="' + esc(a.id) + '">' + swatch(a.type === 'filament' ? a.hex : '', (a.material || '') + ' ' + (a.name || '')) +
        '<a class="al-tx" href="' + esc(productHref(a)) + '"><b>' + esc(a.name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</a>' +
        '<span class="al-date">Depuis le ' + esc(fmtDate(a.created_at, false)) + '</span>' +
        '<button class="acct-link al-del" type="button">Retirer</button></li>';
    }).join('') + '</ul>';
    $$('.al-del', alertsEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var li = btn.closest('.al'), id = li.getAttribute('data-id');
        btn.disabled = true;
        sb.rpc('me_waitlist_cancel', { p_id: id }).then(function (res) {
          if (res.error) { btn.disabled = false; return; }
          alerts = alerts.filter(function (a) { return String(a.id) !== id; });
          renderAlerts();
        }, function () { btn.disabled = false; });
      });
    });
  }

  /* ---- Mes infos ---- */
  function fillInfos() {
    $('#acct-i-email').value = acct.email || '';
    $('#acct-i-name').value = acct.name || '';
    $('#acct-i-phone').value = acct.phone || '';
    say($('#acct-i-status'), '');
  }
  $('#acct-infos-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var st = $('#acct-i-status'), btn = $('#acct-i-btn'), name = $('#acct-i-name').value.trim();
    if (!name) { say(st, 'Entre ton nom.', 'bad'); $('#acct-i-name').focus(); return; }
    btn.disabled = true; say(st, 'Enregistrement…');
    sb.rpc('me_update', { p_name: name, p_phone: $('#acct-i-phone').value.trim() }).then(function (res) {
      btn.disabled = false;
      if (res.error) { say(st, 'Enregistrement impossible. Réessaie.', 'bad'); return; }
      acct = res.data || acct;
      $('#acct-hello').textContent = 'Bonjour ' + firstName(acct.name);
      say(st, 'Enregistré ✓', 'ok');
    }, function () { btn.disabled = false; say(st, 'Erreur réseau — réessaie.', 'bad'); });
  });
  $('#acct-delete').addEventListener('click', function () {
    if (!window.confirm('Supprimer ton compte ?\n\nTon compte et tes alertes seront effacés. Cette action est définitive.')) return;
    var btn = $('#acct-delete'), st = $('#acct-del-status');
    btn.disabled = true; say(st, 'Suppression…');
    sb.rpc('me_delete').then(function (res) {
      if (res.error) { btn.disabled = false; say(st, 'Suppression impossible. Écris-nous à ' + EMAIL + '.', 'bad'); return; }
      return sb.auth.signOut().catch(function () {}).then(function () {
        try { localStorage.removeItem(KEY); } catch (e) {}
        acct = null; signedIn(false); btn.disabled = false; say(st, '');
        history.replaceState(null, '', location.pathname + location.search);
        openLogin('', 'Ton compte a été supprimé.');
      });
    }, function () { btn.disabled = false; say(st, 'Erreur réseau — réessaie.', 'bad'); });
  });

  boot();
})();
