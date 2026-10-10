/* =========================================================
   Création Audio — Réglages › Sécurité
   Appareils de double authentification (2FA, codes TOTP) du compte admin :
   liste, ajout d'un appareil de secours (code QR + code de confirmation),
   retrait (jamais le dernier : sans appareil, plus d'accès à l'admin).
   S'appuie sur CA.mfa (auth-gate.js).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb || !window.CA.mfa) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var listEl = $('#sec-list'), msg = $('#sec-msg'), addBox = $('#sec-add'), newBtn = $('#sec-new'),
      qr = $('#sec-qr'), secret = $('#sec-secret'), form = $('#sec-form'), codeI = $('#sec-code'),
      okBtn = $('#sec-confirm'), cancelBtn = $('#sec-cancel');
  if (!listEl) return;

  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>';
  var loaded = false, devices = [], pending = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function errMsg(e) { return e && e.message ? e.message : String(e || 'erreur inconnue'); }
  function say(text, kind) { msg.textContent = text || ''; msg.className = 'set-msg' + (kind ? ' is-' + kind : ''); }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'securite' && !loaded) { loaded = true; load(); }
  };

  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return window.CA.mfa.list().then(function (fs) {
      devices = fs.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
      render();
    }, function (e) { listEl.innerHTML = '<p class="empty">Impossible de charger : ' + esc(errMsg(e)) + '</p>'; });
  }

  function render() {
    say(devices.length ? (devices.length > 1 ? devices.length + ' appareils' : '1 appareil') : 'Inactive', devices.length > 1 ? 'ok' : (devices.length ? '' : 'warn'));
    if (!devices.length) { listEl.innerHTML = '<p class="empty">Aucun appareil.</p>'; return; }
    listEl.innerHTML = devices.map(function (f, i) {
      return '<div class="sec-dev" data-id="' + esc(f.id) + '">' +
        '<span class="sec-dev-ic">' + ICON + '</span>' +
        '<span class="sec-dev-tx"><b>Appareil ' + (i + 1) + '</b><small>Ajouté le ' + esc(fmtDate(f.created_at)) + '</small></span>' +
        (devices.length > 1 ? '<button class="btn btn-ghost btn-sm sec-del" type="button" data-ic="trash">Retirer</button>' : '') +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(listEl.querySelectorAll('.sec-del'), function (b) {
      b.addEventListener('click', function () { removeDevice(b.closest('.sec-dev').getAttribute('data-id'), b); });
    });
  }

  function removeDevice(id, btn) {
    if (devices.length < 2) return;
    caDialog.confirm({ title: 'Retirer cet appareil ?', message: 'Ses codes ne fonctionneront plus.', ok: 'Retirer', danger: true }).then(function (ok) {
      if (!ok) return;
      btn.disabled = true;
      window.CA.mfa.remove(id).then(load, function (e) { btn.disabled = false; say('Erreur : ' + errMsg(e), 'warn'); });
    });
  }

  function closeAdd() { pending = null; addBox.hidden = true; newBtn.hidden = false; codeI.value = ''; }
  newBtn.addEventListener('click', function () {
    newBtn.disabled = true; say('Préparation…');
    window.CA.mfa.enroll().then(function (f) {
      newBtn.disabled = false; pending = f;
      qr.src = f.qr; secret.textContent = f.secret; codeI.value = '';
      addBox.hidden = false; newBtn.hidden = true; say('Scanne le code puis entre le code affiché.');
      codeI.focus();
    }, function (e) { newBtn.disabled = false; say('Erreur : ' + errMsg(e), 'warn'); });
  });
  cancelBtn.addEventListener('click', function () {
    var f = pending; closeAdd(); render();
    if (f) window.CA.mfa.remove(f.id).catch(function () {});   // secret non confirmé : effacé
  });
  window.CA.codeInput(codeI, form);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = codeI.value.replace(/\D/g, '');
    if (!pending || okBtn.disabled) return;
    if (code.length !== 6) { say('Le code a 6 chiffres.', 'warn'); return; }
    okBtn.disabled = true; say('Vérification…');
    window.CA.mfa.confirm(pending.id, code).then(function (r) {
      okBtn.disabled = false;
      if (!r.ok) { say(r.message, 'warn'); codeI.select(); return; }
      closeAdd(); load().then(function () { say('Appareil ajouté ✓', 'ok'); });
    }, function (err) { okBtn.disabled = false; say('Erreur : ' + errMsg(err), 'warn'); });
  });
})();
