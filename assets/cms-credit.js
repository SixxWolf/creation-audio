/* =========================================================
   Création Audio — CMS Crédit dealer (2026-11-13)
   « Carte-cadeau » des dealers : n'expire jamais, ni remboursable ni échangeable,
   valable sur tout article (promo comprise). Registre public.dealer_credit en
   AJOUT SEULEMENT (schema-v2.sql « CRÉDIT DEALER ») : le solde = somme des lignes.
   - Onglet Dealers : pastille du solde + bouton « Crédit » -> panneau (solde,
     historique, Ajouter du crédit, Corriger, reçu imprimable C-0001).
   - Ajout / correction : RPC admin_credit_add, qui exige le NIP admin (vérifié
     par le serveur, 5 essais puis 15 min de blocage) ; courriel au dealer par
     l'Edge Function dealer-request { action:'credit', id }.
   - Réglages › Sécurité : carte « NIP du crédit » (admin_pin_status / admin_pin_set).
   - Facturation : CA.credit.balance(email) ; l'utilisation passe par
     invoices.credit_used / credit_email (trigger invoices_credit_sync).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function r2(n) { return Math.round((+n || 0) * 100) / 100; }
  function fmtDay(iso) {
    try { return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return String(iso || '').slice(0, 10); }
  }

  var REASON = { debt: 'Règlement de dette', gesture: 'Geste commercial', refund: 'Remboursement', correction: 'Correction' };
  var rows = [], loaded = false, listeners = [];

  CA.credit = {
    rows: function (email) { email = String(email || '').toLowerCase(); return rows.filter(function (r) { return r.dealer_email === email; }); },
    balance: function (email) { return r2(CA.credit.rows(email).reduce(function (s, r) { return s + (+r.amount || 0); }, 0)); },
    reload: load,
    loaded: function () { return loaded; },
    onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); },
    open: togglePanel
  };

  function load() {
    return sb.from('dealer_credit').select('*').order('created_at', { ascending: false }).limit(5000).then(function (res) {
      if (res.error) { console.warn('[crédit]', res.error.message); return rows; }
      rows = res.data || []; loaded = true;
      listeners.forEach(function (cb) { try { cb(); } catch (e) {} });
      refreshOpenPanels();
      return rows;
    }, function () { return rows; });
  }
  if (CA.onAdminReady) CA.onAdminReady(load); else load();

  /* ---------- panneau d'un dealer (onglet Dealers) ---------- */
  function rowLabel(r) {
    if (r.kind === 'grant') return 'Ajout · ' + (REASON[r.reason] || '');
    if (r.kind === 'adjust') return 'Correction';
    if (r.kind === 'use') return 'Utilisé · facture ' + (r.invoice_number || '');
    return 'Rendu · facture ' + (r.invoice_number || '') + (r.invoice_id ? '' : ' supprimée');
  }
  function panelHtml(d) {
    var list = CA.credit.rows(d.email), bal = CA.credit.balance(d.email);
    return '<div class="cr-head">' +
        '<div class="cr-bal"><span>Solde</span><b>' + money(bal) + '</b></div>' +
        '<span class="grow"></span>' +
        '<button type="button" class="btn btn-ghost btn-sm cr-fix"' + (bal > 0 ? '' : ' hidden') + '>Corriger</button>' +
        '<button type="button" class="btn btn-accent btn-sm cr-add" data-ic="plus">Ajouter du crédit</button>' +
      '</div>' +
      (list.length
        ? '<div class="cr-list">' + list.map(function (r) {
            var amt = +r.amount || 0;
            return '<div class="cr-row">' +
              '<span class="cr-date">' + esc(fmtDay(r.created_at)) + '</span>' +
              '<span class="cr-what"><b>' + esc(rowLabel(r)) + '</b>' + (r.note ? '<small>' + esc(r.note) + '</small>' : '') + '</span>' +
              (r.receipt_no ? '<button type="button" class="btn btn-ghost btn-sm cr-print" data-id="' + esc(r.id) + '" data-ic="print">' + esc(r.receipt_no) + '</button>' : '<span></span>') +
              '<span class="cr-amt ' + (amt > 0 ? 'is-plus' : 'is-minus') + '">' + (amt > 0 ? '+' : '−') + money(Math.abs(amt)) + '</span>' +
            '</div>';
          }).join('') + '</div>'
        : '<p class="muted cr-empty">Aucun crédit pour l\'instant.</p>');
  }
  var open = {};   // courriel -> dealer (panneaux ouverts)
  function dealerOf(email) {
    var list = (CA.dealers && CA.dealers.list) || [];
    return list.filter(function (x) { return x.email === email; })[0] || null;
  }
  function panelEl(email) { return document.querySelector('.cr-panel[data-email="' + CSS.escape(email) + '"]'); }
  function paintPanel(el, d) {
    el.innerHTML = panelHtml(d);
    $('.cr-add', el).addEventListener('click', function () { addFlow(d, false); });
    $('.cr-fix', el).addEventListener('click', function () { addFlow(d, true); });
    Array.prototype.forEach.call(el.querySelectorAll('.cr-print'), function (b) {
      b.addEventListener('click', function () { printReceipt(b.getAttribute('data-id')); });
    });
  }
  function togglePanel(d, rowEl) {
    var el = panelEl(d.email);
    if (el) { el.remove(); delete open[d.email]; return; }
    el = document.createElement('div');
    el.className = 'cr-panel'; el.setAttribute('data-email', d.email);
    rowEl.insertAdjacentElement('afterend', el);
    open[d.email] = d;
    paintPanel(el, d);
  }
  function refreshOpenPanels() {
    Object.keys(open).forEach(function (email) {
      var el = panelEl(email);
      if (el) paintPanel(el, dealerOf(email) || open[email]); else delete open[email];
    });
  }
  // la liste des dealers vient d'être redessinée : rouvre les panneaux qui l'étaient
  CA.credit.afterDealersRender = function (listEl) {
    Object.keys(open).forEach(function (email) {
      var row = listEl.querySelector('.mat-row[data-email="' + CSS.escape(email) + '"]');
      if (!row) { delete open[email]; return; }
      var el = document.createElement('div');
      el.className = 'cr-panel'; el.setAttribute('data-email', email);
      row.insertAdjacentElement('afterend', el);
      paintPanel(el, dealerOf(email) || open[email]);
    });
  };
  CA.credit.chip = function (email) {
    var b = CA.credit.balance(email);
    return b > 0 ? ' <span class="person-tag cr-tag">Crédit ' + money(b) + '</span>' : '';
  };

  /* ---------- ajout / correction ---------- */
  function seg(name, opts, val) {
    return '<div class="fx-seg cr-seg" role="group">' + opts.map(function (o) {
      return '<button type="button" class="fx-pay-btn' + (o[0] === val ? ' is-active' : '') + '" data-v="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function addFlow(d, isFix, prev) {
    prev = prev || {};
    var bal = CA.credit.balance(d.email);
    var body = document.createElement('div');
    body.className = 'cr-form';
    body.innerHTML =
      '<label class="cr-f"><span>Montant</span><span class="unit" data-unit="$"><input type="number" class="cr-amt-in" min="0.01" step="0.01" inputmode="decimal" value="' + esc(prev.amount || '') + '"></span></label>' +
      (isFix ? '' : '<div class="cr-f"><span>Motif</span>' + seg('reason', [['debt', 'Dette'], ['gesture', 'Geste'], ['refund', 'Remboursement']], prev.reason || 'debt') + '</div>') +
      '<label class="cr-f"><span>Note</span><input type="text" class="cr-note-in" maxlength="300" value="' + esc(prev.note || '') + '" placeholder="' +
        (isFix ? 'Raison de la correction' : 'Ex. remboursement du prêt d\'octobre') + '"></label>' +
      (prev.err ? '<p class="cr-err">' + esc(prev.err) + '</p>' : '');
    var reason = prev.reason || 'debt';
    Array.prototype.forEach.call(body.querySelectorAll('.cr-seg .fx-pay-btn'), function (b) {
      b.addEventListener('click', function () {
        reason = b.getAttribute('data-v');
        Array.prototype.forEach.call(body.querySelectorAll('.cr-seg .fx-pay-btn'), function (x) { x.classList.toggle('is-active', x === b); });
      });
    });
    setTimeout(function () { var i = body.querySelector('.cr-amt-in'); if (i) i.focus(); }, 30);
    caDialog.confirm({
      title: (isFix ? 'Corriger le crédit de ' : 'Ajouter du crédit à ') + (d.name || d.email),
      message: isFix ? 'Retire un montant ajouté par erreur. Solde actuel : ' + money(bal) + '.' : 'Solde actuel : ' + money(bal) + '.',
      icon: isFix ? 'edit' : 'plus', ok: 'Continuer', body: body
    }).then(function (ok) {
      if (!ok) return;
      var amount = r2(body.querySelector('.cr-amt-in').value), note = body.querySelector('.cr-note-in').value.trim();
      var next = { amount: amount || '', note: note, reason: reason };
      if (!(amount > 0)) { next.err = 'Entre un montant.'; return addFlow(d, isFix, next); }
      if (isFix && amount > bal) { next.err = 'Le solde est de ' + money(bal) + '.'; return addFlow(d, isFix, next); }
      if ((isFix || reason === 'debt') && !note) { next.err = isFix ? 'Écris la raison de la correction.' : 'Écris à quelle dette ça correspond.'; return addFlow(d, isFix, next); }
      pinStep(d, { amount: isFix ? -amount : amount, reason: isFix ? 'correction' : reason, note: note }, '', function () { addFlow(d, isFix, next); });
    });
  }

  function pinInput() {
    var i = document.createElement('input');
    i.type = 'password'; i.className = 'dlg-field cr-pin'; i.inputMode = 'numeric'; i.autocomplete = 'off';
    i.maxLength = 8; i.setAttribute('aria-label', 'NIP'); i.placeholder = 'NIP';
    return i;
  }
  function pinErr(b) {
    if (b.error === 'pin') return 'NIP incorrect · ' + b.left + (b.left > 1 ? ' essais restants.' : ' essai restant.');
    if (b.error === 'locked') return 'Trop d\'essais. Réessaie après ' + new Date(b.until).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }) + '.';
    if (b.error === 'no_pin') return 'Choisis d\'abord ton NIP dans Réglages › Sécurité.';
    if (b.error === 'format') return 'Le NIP a de 4 à 8 chiffres.';
    return '';
  }
  function pinStep(d, op, err, back) {
    var body = document.createElement('div'); body.className = 'cr-form';
    var inp = pinInput(); body.appendChild(inp);
    if (err) { var p = document.createElement('p'); p.className = 'cr-err'; p.textContent = err; body.appendChild(p); }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var go = inp.closest('.ca-dlg').querySelector('.dlg-go'); if (go) go.click(); } });
    setTimeout(function () { inp.focus(); }, 30);
    var plus = op.amount > 0;
    caDialog.confirm({
      title: (plus ? 'Ajouter ' : 'Retirer ') + money(Math.abs(op.amount)) + (plus ? ' à ' : ' à ') + (d.name || d.email) + ' ?',
      message: (plus ? REASON[op.reason] : 'Correction') + (op.note ? ' — ' + op.note : '') + '. Entre ton NIP pour confirmer.',
      icon: plus ? 'plus' : 'edit', ok: plus ? 'Ajouter le crédit' : 'Corriger', alt: 'Modifier', body: body
    }).then(function (ok) {
      if (ok === 'alt') { back(); return; }
      if (!ok) return;
      var pin = inp.value.trim();
      if (!/^\d{4,8}$/.test(pin)) { pinStep(d, op, 'Le NIP a de 4 à 8 chiffres.', back); return; }
      sb.rpc('admin_credit_add', { p_email: d.email, p_amount: op.amount, p_reason: op.reason, p_note: op.note || null, p_pin: pin }).then(function (res) {
        if (res.error) { caDialog.error(res.error); return; }
        var b = res.data || {};
        if (!b.ok) {
          if (b.error === 'pin') { pinStep(d, op, pinErr(b), back); return; }
          if (b.error === 'locked' || b.error === 'no_pin') { caDialog.error(pinErr(b), 'Crédit non ajouté'); return; }
          caDialog.error({ balance: 'Le solde ne peut pas devenir négatif.', note: 'Une note est obligatoire.', amount: 'Montant invalide.',
            reason: 'Motif invalide.', not_dealer: 'Ce courriel n\'est plus un dealer.' }[b.error] || b.error, 'Crédit non ajouté');
          return;
        }
        load().then(function () {
          mail(b.id).then(function (sent) {
            caDialog.toast((plus ? 'Crédit ajouté' : 'Crédit corrigé') + ' · solde ' + money(b.balance) + (sent ? ' · courriel envoyé' : ' · courriel non parti'), sent ? '' : 'bad');
          });
          caDialog.confirm({ title: 'Reçu ' + b.receipt_no, message: 'Nouveau solde : ' + money(b.balance) + '.', icon: 'info', ok: 'Imprimer le reçu', cancel: 'Fermer' })
            .then(function (p) { if (p) printReceipt(b.id); });
        });
      }, function (err) { caDialog.error(err); });
    });
  }
  function mail(id) {
    return sb.functions.invoke('dealer-request', { body: { action: 'credit', id: id } }).then(function (res) {
      return !res.error && res.data && res.data.ok;
    }, function () { return false; });
  }

  /* ---------- reçu imprimable ---------- */
  var company = null;
  function printReceipt(id) {
    var r = rows.filter(function (x) { return x.id === id; })[0];
    if (!r || !window.CA.creditPrint) { caDialog.error('Impression indisponible.'); return; }
    var d = dealerOf(r.dealer_email) || { email: r.dealer_email };
    // solde juste après cette ligne (registre trié du plus récent au plus ancien)
    var after = r2(CA.credit.rows(r.dealer_email).filter(function (x) { return x.created_at <= r.created_at; })
      .reduce(function (s, x) { return s + (+x.amount || 0); }, 0));
    var go = function () { window.CA.creditPrint({ row: r, balance: after, dealer: { name: d.name, email: d.email, address: d.address, city: d.city }, company: company || {} }); };
    if (company) { go(); return; }
    sb.rpc('company_public').then(function (res) { company = (res && res.data) || {}; go(); }, go);
  }

  /* ---------- Réglages › Sécurité : NIP du crédit ---------- */
  var pinMsg = $('#pin-msg'), pinBtn = $('#pin-set');
  function pinState() {
    if (!pinBtn) return;
    sb.rpc('admin_pin_status').then(function (res) {
      if (res.error) { pinMsg.textContent = 'Indisponible'; return; }
      var s = res.data || {};
      pinBtn.hidden = false;
      pinBtn.textContent = s.set ? 'Changer le NIP' : 'Choisir un NIP';
      pinMsg.className = 'set-msg ' + (s.set ? 'is-ok' : 'is-warn');
      pinMsg.textContent = s.locked_until ? 'Bloqué jusqu\'à ' + new Date(s.locked_until).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
        : s.set ? 'Actif' : 'Aucun NIP : ajout de crédit impossible';
      pinBtn.setAttribute('data-set', s.set ? '1' : '');
    }, function () {});
  }
  function pinDialog(hasPin, err) {
    var body = document.createElement('div'); body.className = 'cr-form';
    var old = hasPin ? pinInput() : null, n1 = pinInput(), n2 = pinInput();
    if (old) { old.placeholder = 'NIP actuel'; old.setAttribute('aria-label', 'NIP actuel'); body.appendChild(old); }
    n1.placeholder = 'Nouveau NIP (4 à 8 chiffres)'; n1.setAttribute('aria-label', 'Nouveau NIP');
    n2.placeholder = 'Confirmer le nouveau NIP'; n2.setAttribute('aria-label', 'Confirmer le nouveau NIP');
    body.appendChild(n1); body.appendChild(n2);
    if (err) { var p = document.createElement('p'); p.className = 'cr-err'; p.textContent = err; body.appendChild(p); }
    setTimeout(function () { (old || n1).focus(); }, 30);
    caDialog.confirm({ title: hasPin ? 'Changer le NIP du crédit' : 'Choisir le NIP du crédit',
      message: 'Demandé à chaque ajout de crédit. Garde-le pour toi : il n\'est affiché nulle part.', icon: 'edit', ok: 'Enregistrer', body: body })
      .then(function (ok) {
        if (!ok) return;
        var a = n1.value.trim(), b = n2.value.trim();
        if (!/^\d{4,8}$/.test(a)) { pinDialog(hasPin, 'Le NIP a de 4 à 8 chiffres.'); return; }
        if (a !== b) { pinDialog(hasPin, 'Les deux NIP ne sont pas pareils.'); return; }
        sb.rpc('admin_pin_set', { p_new: a, p_old: old ? old.value.trim() : null }).then(function (res) {
          if (res.error) { caDialog.error(res.error); return; }
          var r = res.data || {};
          if (!r.ok) { if (r.error === 'locked') caDialog.error(pinErr(r)); else pinDialog(hasPin, pinErr(r)); pinState(); return; }
          caDialog.toast(hasPin ? 'NIP changé' : 'NIP enregistré');
          pinState();
        }, function (e) { caDialog.error(e); });
      });
  }
  if (pinBtn) pinBtn.addEventListener('click', function () { pinDialog(!!pinBtn.getAttribute('data-set')); });
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'securite') pinState();
    if (name === 'dealers') load();
  };
})();
