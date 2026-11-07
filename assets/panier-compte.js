/* =========================================================
   Création Audio — panier : « Envoyer ma commande » sans compte
   Partagé par la boutique (boutique.js) et la page spacers (spacers.js).
   Charger APRÈS dialog.js et commande-client.js.
   CA.panierCompte :
     setup({ onSignedIn(send), onMessenger(), onEmail(), client(), words, onCancel() })   branche le (i) + le lien « Déjà un compte ? »
                       Demandes de service (demande.js) : client = leur client Supabase, words = leurs textes (panier : aucun des deux) ;
                       sans onMessenger, pas de « Sans compte » ; onCancel = fenêtre fermée sans connexion.
     open(send)        fenêtre courriel -> code -> nom (nouveau compte) ; même Edge Function que Mon compte
                       (compte-code). send = true : le client veut envoyer sa commande (onSignedIn(true) enchaîne).
     askName(c, acct)  seulement l'étape du nom (compte déjà connecté, sans nom), puis onSignedIn(true).
     resume()          rouvre l'étape du code après un rechargement (passage par l'appli courriel sur mobile)
     messenger(url, text)  copie la liste, puis avis + vrai lien vers Messenger (jamais bloqué comme un popup) ;
                       copie impossible : liste affichée à copier à la main. Promesse : true si copiée.
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';
  var _t = window.CA.t || function (s) { return s; }, EN = window.CA.lang === 'en';
  var cfg = window.CA_SUPABASE || {};
  var PENDING = 'ca_panier_pending', CODE_TTL = 10 * 60 * 1000, RESEND_MS = 60 * 1000, EMAIL = 'contact@creationaudio.ca';
  var IC = {
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'
  };
  var opts = {}, dlg = null, resendT = null, onDismiss = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, one, many) { return n + ' ' + _t((EN ? n !== 1 : n > 1) ? many : one); }
  function word(k, def) { return (opts.words && opts.words[k]) || _t(def); }
  function callFn(body) {
    return fetch(cfg.url + '/functions/v1/compte-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
      body: JSON.stringify(Object.assign({ lang: window.CA.lang || 'fr' }, body))
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (b) { return b || {}; });
  }
  function getPending() {
    try {
      var p = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
      return p && p.email && Date.now() - p.at < CODE_TTL ? p : null;
    } catch (e) { return null; }
  }
  function setPending(p) {
    try { if (p) sessionStorage.setItem(PENDING, JSON.stringify(p)); else sessionStorage.removeItem(PENDING); } catch (e) {}
  }
  function sendErr(b) {
    if (b.error === 'wait') {
      var s = Math.max(1, +b.retry_after || 60);
      return s > 90 ? _t('Trop de demandes. Réessaie dans ') + plural(Math.ceil(s / 60), 'minute', 'minutes') + '.'
                    : _t('Patiente ') + s + _t(' s avant de redemander un code.');
    }
    if (b.error === 'reserved') return _t('Ce courriel a sa propre page de connexion.');
    if (b.error === 'bad_request') return _t('Entre un courriel valide.');
    if (b.error === 'mail') return _t('Envoi impossible pour le moment. Réessaie dans un instant.');
    return _t('Service indisponible. Réessaie plus tard.');
  }

  /* ---------- copie de la liste : résout true seulement si elle a vraiment réussi ---------- */
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea'), ok = false;
    ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, txt.length);
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return !!ok;
  }
  function copyList(txt) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve(fallbackCopy(txt));
    // certains navigateurs intégrés ne répondent jamais : on n'attend pas plus de 1,5 s
    var late = new Promise(function (_, no) { setTimeout(no, 1500); });
    return Promise.race([navigator.clipboard.writeText(txt), late])
      .then(function () { return true; }, function () { return fallbackCopy(txt); });
  }

  /* ---------- fenêtre (style de dialog.css, bouton plein du panier) ---------- */
  function closeDlg() {
    clearTimeout(resendT);
    onDismiss = null;
    if (!dlg) return;
    var d = dlg; dlg = null;
    if (d.open) d.close();
    d.remove();
  }
  function openDlg() {
    closeDlg();
    var d = document.createElement('dialog');
    d.className = 'ca-dlg pc-dlg';
    d.setAttribute('aria-labelledby', 'pc-t');
    // Échap : ferme cette fenêtre seulement, pas le panier derrière
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape') e.stopPropagation(); });
    d.addEventListener('cancel', function (e) { e.preventDefault(); dismiss(); });
    document.body.appendChild(d);
    d.showModal();
    dlg = d;
    return d;
  }
  // × ou Échap ; à l'étape du nom, le compte existe déjà : le panier passe quand même en mode connecté
  function dismiss() {
    var fn = onDismiss;
    setPending(null); closeDlg();
    if (fn) fn();
    else if (opts.onCancel) opts.onCancel();
  }
  // contenu d'une étape : pastille + titre + message + corps + croix
  function paint(icon, title, message, bodyHtml) {
    var d = dlg || openDlg();
    clearTimeout(resendT);
    d.innerHTML =
      '<div class="dlg-in">' +
        '<span class="dlg-ic" aria-hidden="true"><svg viewBox="0 0 24 24">' + IC[icon] + '</svg></span>' +
        '<h2 class="dlg-t pc-t" id="pc-t">' + esc(title) + '</h2>' +
        (message ? '<p class="dlg-m">' + message + '</p>' : '') +
        '<div class="pc-body">' + bodyHtml + '</div>' +
      '</div>' +
      '<button type="button" class="pc-x" aria-label="' + esc(_t('Fermer')) + '">&times;</button>';
    d.querySelector('.pc-x').addEventListener('click', dismiss);
    return d;
  }
  function say(el, text, bad) {
    el.textContent = text || '';
    el.classList.toggle('is-bad', !!bad);
  }

  /* ---------- 1. courriel ---------- */
  function stepEmail(send, email) {
    var saved = window.CA.custOrder && window.CA.custOrder.email ? window.CA.custOrder.email() : '';
    var d = paint('user',
      send ? word('needAccount', 'Il te faut un compte client') : _t('Connecte-toi'),
      esc(send ? _t('Rapide : ton courriel suffit, aucun mot de passe. Déjà client ? Entre le même courriel.')
               : _t('Ton courriel suffit, aucun mot de passe. On t\'envoie un code.')),
      '<form class="pc-form" novalidate>' +
        '<label class="pc-label" for="pc-email">' + esc(_t('Courriel')) + '</label>' +
        '<input class="dlg-field pc-field" type="email" id="pc-email" inputmode="email" autocomplete="email" maxlength="254" spellcheck="false" placeholder="' + esc(_t('ton@courriel.com')) + '" value="' + esc(email || saved) + '">' +
        '<input type="text" class="pc-hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<button type="submit" class="cart-order pc-go">' + esc(_t('Recevoir mon code')) + '</button>' +
        '<p class="pc-status" role="status" aria-live="polite"></p>' +
        (send ? '<p class="pc-note">' + esc(word('sendsAfter', 'Ta commande part dès que c\'est confirmé.')) + '</p>' : '') +
        '<p class="pc-note"><a href="' + (window.CA.siteRoot || '') + 'confidentialite#compte" target="_blank" rel="noopener">' + esc(_t('Confidentialité')) + '</a></p>' +
        (send && opts.onMessenger ? '<p class="pc-alt">' + esc(_t('Sans compte :')) + ' <button type="button" class="pc-link" data-alt="m">Messenger</button> · <button type="button" class="pc-link" data-alt="e">' + esc(_t('courriel')) + '</button></p>' : '') +
      '</form>');
    var form = d.querySelector('form'), input = d.querySelector('#pc-email'), btn = d.querySelector('.pc-go'), st = d.querySelector('.pc-status');
    d.querySelectorAll('[data-alt]').forEach(function (b) {
      b.addEventListener('click', function () {
        dismiss();
        var fn = b.getAttribute('data-alt') === 'm' ? opts.onMessenger : opts.onEmail;
        if (fn) fn();
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = (input.value || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) { say(st, _t('Entre un courriel valide.'), true); input.focus(); return; }
      btn.disabled = true; say(st, _t('Envoi…'));
      callFn({ action: 'send', email: v, hp: d.querySelector('.pc-hp').value || '' }).then(function (b) {
        btn.disabled = false;
        if (!b.ok) { say(st, sendErr(b), true); return; }
        setPending({ email: v, at: Date.now(), sent: Date.now(), send: !!send });
        stepCode();
      }, function () { btn.disabled = false; say(st, _t('Erreur réseau — réessaie.'), true); });
    });
    input.focus();
  }

  /* ---------- 2. code ---------- */
  function stepCode() {
    var p = getPending();
    if (!p) { stepEmail(true); return; }
    var d = paint('mail', _t('Entre ton code'),
      esc(_t('Envoyé à ')) + '<b>' + esc(p.email) + '</b>' + esc(_t('. Il expire dans 10 minutes.')),
      '<form class="pc-form" novalidate>' +
        '<label class="pc-label" for="pc-code">' + esc(_t('Code à 6 chiffres')) + '</label>' +
        '<input class="dlg-field pc-field pc-code" type="text" id="pc-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" spellcheck="false">' +
        '<button type="submit" class="cart-order pc-go">' + esc(p.send ? word('confirmSend', 'Confirmer et envoyer') : _t('Confirmer')) + '</button>' +
        '<p class="pc-status" role="status" aria-live="polite"></p>' +
        '<p class="pc-links"><button type="button" class="pc-link" data-act="resend"></button>' +
        '<button type="button" class="pc-link" data-act="change">' + esc(_t('Changer de courriel')) + '</button></p>' +
      '</form>');
    var form = d.querySelector('form'), input = d.querySelector('#pc-code'), btn = d.querySelector('.pc-go'),
        st = d.querySelector('.pc-status'), resend = d.querySelector('[data-act="resend"]');
    function tick() {
      clearTimeout(resendT);
      var cur = getPending(); if (!cur) return;
      var left = Math.ceil((cur.sent + RESEND_MS - Date.now()) / 1000);
      resend.disabled = left > 0;
      resend.textContent = left > 0 ? _t('Renvoyer dans ') + left + ' s' : _t('Renvoyer le code');
      if (left > 0) resendT = setTimeout(tick, 1000);
    }
    tick();
    resend.addEventListener('click', function () {
      var cur = getPending(); if (!cur) { stepEmail(true); return; }
      resend.disabled = true; say(st, _t('Envoi…'));
      callFn({ action: 'send', email: cur.email, hp: '' }).then(function (b) {
        if (!b.ok) { say(st, sendErr(b), true); tick(); return; }
        cur.at = cur.sent = Date.now(); setPending(cur);
        say(st, _t('Nouveau code envoyé.')); input.value = ''; input.focus(); tick();
      }, function () { say(st, _t('Erreur réseau — réessaie.'), true); tick(); });
    });
    d.querySelector('[data-act="change"]').addEventListener('click', function () {
      var cur = getPending(); setPending(null);
      stepEmail(cur ? cur.send : true, cur && cur.email);
    });
    input.addEventListener('input', function () {
      var v = input.value.replace(/\D/g, '').slice(0, 6);
      if (v !== input.value) input.value = v;
      if (v.length === 6 && !btn.disabled) verify();
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); verify(); });
    function verify() {
      var cur = getPending(); if (!cur) { stepEmail(true); return; }
      var code = input.value.replace(/\D/g, '');
      if (code.length !== 6) { say(st, _t('Entre les 6 chiffres reçus.'), true); input.focus(); return; }
      btn.disabled = true; say(st, _t('Vérification…'));
      callFn({ action: 'verify', email: cur.email, code: code }).then(function (b) {
        if (b.session) return signIn(b.session, cur.send);
        btn.disabled = false;
        if (b.error === 'invalid') { say(st, _t('Code incorrect · ') + plural(b.left, 'essai restant', 'essais restants') + '.', true); input.select(); return; }
        if (b.error === 'expired') { say(st, _t('Ce code n\'est plus valable. Demande un nouveau code.'), true); return; }
        if (b.error === 'revoked') { say(st, _t('Accès retiré. Écris-nous à ') + EMAIL + '.', true); return; }
        say(st, _t('Connexion impossible pour le moment. Réessaie.'), true);
      }).catch(function () { btn.disabled = false; say(st, _t('Connexion impossible pour le moment. Réessaie.'), true); });
    }
    input.focus();
  }

  /* ---------- session -> nom au besoin -> fin ---------- */
  function signIn(session, send) {
    var c = opts.client ? opts.client() : window.CA.custOrder.client();
    if (!c) throw new Error('no client');
    return c.auth.setSession(session).then(function (s) {
      if (s && s.error) throw s.error;
      setPending(null);
      document.querySelectorAll('.home-account').forEach(function (a) { a.classList.add('is-in'); });
      return c.rpc('me_account').then(function (res) {
        var acct = (res && !res.error && res.data) || null;
        if (acct && !String(acct.name || '').trim()) stepName(c, acct, send);
        else finish(send);
      }, function () { finish(send); });
    });
  }
  function stepName(c, acct, send) {
    var d = paint('user', _t('Ton compte est créé ✓'), esc(word('nameWhy', 'Il nous manque ton nom pour préparer ta commande.')),
      '<form class="pc-form" novalidate>' +
        '<label class="pc-label" for="pc-name">' + esc(_t('Ton nom')) + '</label>' +
        '<input class="dlg-field pc-field" type="text" id="pc-name" autocomplete="name" maxlength="80">' +
        '<button type="submit" class="cart-order pc-go">' + esc(send ? word('sendNow', 'Envoyer ma commande') : _t('Enregistrer')) + '</button>' +
        '<p class="pc-status" role="status" aria-live="polite"></p>' +
      '</form>');
    // fermer ici : Mon compte redemandera le nom ; rien n'est envoyé
    onDismiss = function () { finish(false, true); };
    var input = d.querySelector('#pc-name'), btn = d.querySelector('.pc-go'), st = d.querySelector('.pc-status');
    d.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = input.value.trim();
      if (!name) { say(st, _t('Entre ton nom.'), true); input.focus(); return; }
      btn.disabled = true; say(st, _t('Enregistrement…'));
      c.rpc('me_update', { p_name: name, p_phone: acct.phone || '' }).then(function (res) {
        btn.disabled = false;
        if (res.error) { say(st, _t('Enregistrement impossible. Réessaie.'), true); return; }
        finish(send);
      }, function () { btn.disabled = false; say(st, _t('Erreur réseau — réessaie.'), true); });
    });
    input.focus();
  }
  function finish(send, quiet) {
    closeDlg();
    if (window.CA.custLang) window.CA.custLang();
    if (!send && !quiet && window.caDialog) window.caDialog.toast(_t('Te voilà connecté ✓'));
    if (opts.onSignedIn) opts.onSignedIn(!!send);
  }

  /* ---------- le (i) : survol à la souris, toucher sur mobile ---------- */
  function bindInfo() {
    var btn = document.getElementById('cart-info'), tip = document.getElementById('cart-tip');
    if (!btn || !tip) return;
    var pinned = false, hideT = null;
    function setOpen(on) {
      tip.hidden = !on;
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (!on) pinned = false;
    }
    function hover(e) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(hideT);
      setOpen(true);
    }
    function leave(e) {
      if (e.pointerType !== 'mouse' || pinned) return;
      clearTimeout(hideT);
      hideT = setTimeout(function () { setOpen(false); }, 160);
    }
    btn.addEventListener('pointerenter', hover);
    tip.addEventListener('pointerenter', hover);
    btn.addEventListener('pointerleave', leave);
    tip.addEventListener('pointerleave', leave);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!tip.hidden && !pinned && btn.matches(':hover') && window.matchMedia('(hover:hover)').matches) { pinned = true; return; }
      if (tip.hidden) { setOpen(true); pinned = true; } else setOpen(false);
    });
    document.addEventListener('click', function (e) { if (!tip.hidden && !tip.contains(e.target)) setOpen(false); });
    // Échap : referme la bulle, pas le panier
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !tip.hidden) { e.stopPropagation(); setOpen(false); }
    }, true);
  }

  window.CA.panierCompte = {
    setup: function (o) {
      opts = o || {};
      bindInfo();
      var login = document.getElementById('cart-login');
      if (login) login.addEventListener('click', function (e) {
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        window.CA.panierCompte.open(false);
      });
    },
    open: function (send) {
      openDlg();
      stepEmail(!!send);
    },
    askName: function (c, acct) {
      openDlg();
      stepName(c, acct, true);
    },
    // true si une étape de code a été rouverte (le panier doit alors s'ouvrir derrière)
    resume: function () {
      var p = getPending();
      if (!p) return false;
      if (window.CA.custOrder && window.CA.custOrder.signedIn()) { setPending(null); return false; }
      openDlg();
      stepCode();
      return true;
    },
    // Copie d'abord (une fenêtre modale ouverte bloquerait le secours), puis l'avis. Copie impossible : la liste
    // est affichée à copier à la main, on n'annonce jamais « copiée » à tort. Résout true si la copie a réussi.
    messenger: function (url, text) {
      return copyList(text).then(function (ok) {
        var link = '<a class="cart-order pc-go pc-go-link" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(_t('Ouvrir Messenger')) + '</a>';
        var d = ok
          ? paint('copy', _t('Ta liste est copiée ✓'), esc(_t('Dans Messenger, colle-la dans la conversation et envoie.')), link)
          : paint('copy', _t('Copie ta liste'), esc(_t('Copie ce texte, puis colle-le dans Messenger.')),
              '<textarea class="dlg-field pc-list" rows="7" readonly aria-label="' + esc(_t('Copie ta liste')) + '">' + esc(text) + '</textarea>' + link);
        d.querySelector('.pc-go-link').addEventListener('click', function () { setTimeout(closeDlg, 0); });
        var area = d.querySelector('.pc-list');
        if (area) {
          area.addEventListener('focus', function () { area.select(); });
          area.focus();
        } else d.querySelector('.pc-go-link').focus();
        return ok;
      });
    }
  };
})();
