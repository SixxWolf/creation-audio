/* =========================================================
   Création Audio — générateur de factures
   Colle le message du client -> détecte les filaments via le
   catalogue -> facture propre, imprimable (PDF). 100 % local.
   ========================================================= */
(function () {
  'use strict';

  var CAT = window.CA_CATALOG || [];
  var byCode = {};
  CAT.forEach(function (i) { byCode[i.code] = i; });

  var $ = function (s) { return document.querySelector(s); };
  var LS_CO = 'ca_facture_company';
  var LS_SEQ = 'ca_facture_seq';
  var LS_NOTE = 'ca_facture_note';
  var logoData = '';   // dataURL du logo (mémorisé dans la config entreprise)

  var DEFAULT_CO = {
    name: 'Création Audio',
    tagline: 'Audio automobile & impression 3D — Québec',
    address: '',
    city: 'Québec, QC',
    postal: '',
    email: 'contact@creationaudio.ca',
    phone: '',
    neq: '',
    gst: '',
    qst: '',
    gstRate: 5,
    qstRate: 9.975,
    logo: ''
  };

  var items = [];        // { code, name, material, hex, price, qty, type }
  var taxEnabled = false;

  // prix par type + accessoire « bobine vide réutilisable »
  var PRICES_T = { refill: 20, spool: 25 };   // repli seulement
  var TYPE_LABEL_T = { refill: 'Recharge', spool: 'Avec Bobine', accessory: 'Accessoire' };
  // prix par défaut selon le matériau (assets/pricing.js) ; repli 20/25
  function fxPrice(material, code, type) {
    var P = window.CA_PRICE;
    if (!P) return PRICES_T[type] || PRICES_T.refill;
    var p = P.priceOf(material, code, type);
    return p != null ? p : P.spoolPrice(material);
  }
  // type effectif : « recharge » demandée mais indispo pour ce matériau/couleur
  // (bobine-seule ou couleur non éligible) -> bascule sur « bobine ».
  function fxTypeFor(material, code, type) {
    if (type !== 'refill') return type;
    var P = window.CA_PRICE;
    return (P && !P.refillAvailable(material, code)) ? 'spool' : 'refill';
  }
  var SPOOLS = {
    SPOOL:   { code: 'SPOOL',   name: 'Bobine vide réutilisable', material: 'Accessoire', hex: '#D7D9DB', price: 10 },
    SPOOLHT: { code: 'SPOOLHT', name: 'Bobine vide réutilisable — haute température', material: 'Accessoire', hex: '#3A3D42', price: 10 }
  };
  var SPOOL = SPOOLS.SPOOL;
  var fxType = 'refill';   // type courant du sélecteur

  /* ---------- utilitaires ---------- */
  function money(n) {
    return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Pastille en SVG (et non en fond CSS) : les fonds ne s'impriment pas
  // par défaut, alors qu'un SVG est du contenu et sort toujours au PDF.
  function swatchSVG(hex) {
    return '<svg class="inv-sw" width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">' +
      '<circle cx="6" cy="6" r="5.4" fill="' + esc(hex) + '" stroke="rgba(0,0,0,.28)" stroke-width="0.7"/></svg>';
  }

  function todayISO() {
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtDateFR(iso) {
    if (!iso) return '';
    var parts = iso.split('-');
    try { return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return iso; }
  }

  /* ---------- entreprise (localStorage) ---------- */
  function loadCompany() {
    var co = {};
    try { co = JSON.parse(localStorage.getItem(LS_CO)) || {}; } catch (e) {}
    var m = {};
    for (var k in DEFAULT_CO) m[k] = (co[k] != null && co[k] !== '') ? co[k] : DEFAULT_CO[k];
    return m;
  }
  function fillCompanyForm(co) {
    $('#co-name').value = co.name; $('#co-tagline').value = co.tagline;
    $('#co-address').value = co.address; $('#co-city').value = co.city; $('#co-postal').value = co.postal;
    $('#co-email').value = co.email; $('#co-phone').value = co.phone; $('#co-neq').value = co.neq;
    $('#co-gst').value = co.gst; $('#co-qst').value = co.qst;
    $('#gst-rate').value = co.gstRate; $('#qst-rate').value = co.qstRate;
    logoData = co.logo || '';
    showLogoPreview();
  }
  function readCompanyForm() {
    return {
      name: $('#co-name').value.trim(), tagline: $('#co-tagline').value.trim(),
      address: $('#co-address').value.trim(), city: $('#co-city').value.trim(), postal: $('#co-postal').value.trim(),
      email: $('#co-email').value.trim(), phone: $('#co-phone').value.trim(), neq: $('#co-neq').value.trim(),
      gst: $('#co-gst').value.trim(), qst: $('#co-qst').value.trim(),
      gstRate: parseFloat($('#gst-rate').value) || 0, qstRate: parseFloat($('#qst-rate').value) || 0,
      logo: logoData
    };
  }

  /* ---------- logo ---------- */
  function showLogoPreview() {
    var wrap = $('#co-logo-preview');
    if (logoData) { $('#co-logo-img').src = logoData; wrap.hidden = false; }
    else { wrap.hidden = true; }
  }
  function writeCompany() { try { localStorage.setItem(LS_CO, JSON.stringify(readCompanyForm())); } catch (e) {} }
  function handleLogoFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var max = 340, w = img.width, h = img.height;
        if (w > max) { h = Math.round(h * max / w); w = max; }
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        try { logoData = c.toDataURL('image/png'); }
        catch (err) { logoData = e.target.result; } // repli : image telle quelle
        showLogoPreview(); writeCompany(); render();
      };
      img.onerror = function () {};
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
  function saveCompany() {
    var co = readCompanyForm();
    try { localStorage.setItem(LS_CO, JSON.stringify(co)); } catch (e) {}
    var msg = $('#co-msg'); msg.textContent = 'Informations enregistrées ✓'; msg.className = 'fx-msg ok show';
    setTimeout(function () { msg.className = 'fx-msg'; }, 2200);
    render();
  }

  /* ---------- numéro de facture ---------- */
  function nextSeq() { var n = parseInt(localStorage.getItem(LS_SEQ), 10); return isNaN(n) ? 1 : n; }
  function fmtNumber(seq) { return 'F-' + new Date().getFullYear() + '-' + ('000' + seq).slice(-3); }
  function bumpSeq() {
    var n = nextSeq() + 1;
    try { localStorage.setItem(LS_SEQ, String(n)); } catch (e) {}
    $('#inv-number').value = fmtNumber(n);
    if (typeof updateDeductBtn === 'function') updateDeductBtn();
  }

  /* ---------- parseur de commande ---------- */
  function extractQty(line) {
    var m = line.match(/(?:x|×)\s*(\d{1,3})(?!\d)/i);
    if (m) return parseInt(m[1], 10);
    m = line.match(/(\d{1,3})\s*(?:x|×|bobines?|unit[eé]s?|pcs?|pi[eè]ces?)\b/i);
    if (m) return parseInt(m[1], 10);
    m = line.match(/(?:qt[eé]|quantit[eé])\s*[:=]?\s*(\d{1,3})/i);
    if (m) return parseInt(m[1], 10);
    return 1;
  }
  function parseOrder(text) {
    var order = [], found = {}, unmatched = [];
    function key(code, type) { return code + '|' + type; }
    function addF(item, qty, type) {
      type = fxTypeFor(item.material, item.code, type || 'refill');
      var k = key(item.code, type);
      if (!found[k]) { found[k] = { code: item.code, name: item.name, material: item.material, hex: item.hex, price: fxPrice(item.material, item.code, type), qty: 0, type: type }; order.push(k); }
      found[k].qty += qty;
    }
    function addSpoolLine(qty, code) {
      var sp = SPOOLS[code] || SPOOLS.SPOOL;
      var k = key(sp.code, 'accessory');
      if (!found[k]) { found[k] = { code: sp.code, name: sp.name, material: 'Accessoire', hex: sp.hex, price: sp.price, qty: 0, type: 'accessory' }; order.push(k); }
      found[k].qty += qty;
    }
    text.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var low = line.toLowerCase();
      var qty = extractQty(line);
      // bobine vide réutilisable (accessoire)
      if (/bobine\s*vide|r[ée]utilis|reusable\s*spool|empty\s*spool/.test(low)) {
        var ht = /haute\s*temp|high\s*temp|\bht\b/.test(low);
        addSpoolLine(qty, ht ? 'SPOOLHT' : 'SPOOL');
        return;
      }
      // type détecté sur la ligne
      var type = /avec\s*bobine|with\s*spool/.test(low) ? 'spool' : 'refill';
      // 1) code entre parenthèses
      var cm = line.match(/\((\d{4,6})\)/);
      var code = (cm && byCode[cm[1]]) ? cm[1] : null;
      // 2) code "nu"
      if (!code) {
        var toks = line.match(/\d{4,6}/g) || [];
        for (var i = 0; i < toks.length; i++) { if (byCode[toks[i]]) { code = toks[i]; break; } }
      }
      if (code) { addF(byCode[code], qty, type); return; }
      // 3) correspondance par nom (le plus long gagne)
      var best = null, bestLen = 0;
      CAT.forEach(function (it) {
        var jn = it.name.toLowerCase();
        if (low.indexOf(jn) !== -1 && jn.length > bestLen) { best = it; bestLen = jn.length; }
      });
      if (best) { addF(best, qty, type); return; }
      // 4) ligne non reconnue mais qui ressemble à un item
      if (/\d/.test(line) && line.length < 70 && !/total|ramassage|merci|bonjour|commande/i.test(line)) unmatched.push(line);
    });
    return { items: order.map(function (k) { return found[k]; }), unmatched: unmatched };
  }

  /* ---------- catalogue cliquable ---------- */
  function addOne(code) {
    var it = byCode[code];
    if (!it) return;
    var type = fxTypeFor(it.material, it.code, fxType), ex = null;
    for (var i = 0; i < items.length; i++) { if (items[i].code === code && items[i].type === type) { ex = items[i]; break; } }
    if (ex) ex.qty += 1;
    else items.push({ code: it.code, name: it.name, material: it.material, hex: it.hex, price: fxPrice(it.material, it.code, type), qty: 1, type: type });
    render();
  }
  function addSpool(code) {
    var sp = SPOOLS[code] || SPOOLS.SPOOL;
    var ex = null;
    for (var i = 0; i < items.length; i++) { if (items[i].code === sp.code) { ex = items[i]; break; } }
    if (ex) ex.qty += 1;
    else items.push({ code: sp.code, name: sp.name, material: 'Accessoire', hex: sp.hex, price: sp.price, qty: 1, type: 'accessory' });
    render();
  }
  function setFxType(type) {
    fxType = (type === 'spool') ? 'spool' : 'refill';
    var host = document; Array.prototype.forEach.call(host.querySelectorAll('.pk-type-btn'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-type') === fxType);
    });
  }
  function buildPicker() {
    var host = $('#pk-catalog');
    if (!host) return;
    var groups = [], idx = {};
    CAT.forEach(function (it) {
      if (!idx.hasOwnProperty(it.material)) { idx[it.material] = groups.length; groups.push({ mat: it.material, items: [] }); }
      groups[idx[it.material]].items.push(it);
    });
    host.innerHTML = groups.map(function (g) {
      return '<div class="pk-group">' +
        '<div class="pk-group-title">' + esc(g.mat) + '</div>' +
        '<div class="pk-grid">' + g.items.map(function (it) {
          return '<button type="button" class="pk-cell" data-code="' + it.code +
            '" data-search="' + esc((it.name + ' ' + it.code + ' ' + it.material).toLowerCase()) + '">' +
            '<span class="pk-sw" style="background:' + esc(it.hex) + '"></span>' +
            '<span class="pk-name">' + esc(it.name) + '</span>' +
            '<span class="pk-code">' + it.code + '</span>' +
            '<span class="pk-badge"></span></button>';
        }).join('') + '</div></div>';
    }).join('');
    host.querySelectorAll('.pk-cell').forEach(function (b) {
      b.addEventListener('click', function () { addOne(this.getAttribute('data-code')); });
    });
  }
  function refreshPicker() {
    var host = $('#pk-catalog');
    if (!host) return;
    var q = {};
    items.forEach(function (it) { q[it.code] = (q[it.code] || 0) + it.qty; });
    host.querySelectorAll('.pk-cell').forEach(function (b) {
      var n = q[b.getAttribute('data-code')] || 0, badge = b.querySelector('.pk-badge');
      if (n > 0) { b.classList.add('sel'); badge.textContent = n; }
      else { b.classList.remove('sel'); badge.textContent = ''; }
    });
    var total = items.reduce(function (s, it) { return s + it.qty; }, 0);
    var txt = $('#pk-count-txt'), clr = $('#pk-clear');
    if (txt) txt.textContent = items.length
      ? items.length + ' filament' + (items.length > 1 ? 's' : '') + ' · ' + total + ' bobine' + (total > 1 ? 's' : '')
      : 'Facture vide';
    if (clr) clr.hidden = !items.length;
  }
  function filterPicker(query) {
    var q = (query || '').trim().toLowerCase(), host = $('#pk-catalog');
    if (!host) return;
    host.querySelectorAll('.pk-group').forEach(function (g) {
      var any = false;
      g.querySelectorAll('.pk-cell').forEach(function (b) {
        var show = !q || b.getAttribute('data-search').indexOf(q) !== -1;
        b.style.display = show ? '' : 'none';
        if (show) any = true;
      });
      g.style.display = any ? '' : 'none';
    });
  }
  function clearAll() { items = []; render(); }

  function generate() {
    var res = parseOrder($('#order-input').value);
    items = res.items;
    var msg = $('#parse-msg');
    if (!items.length) {
      msg.textContent = 'Aucun filament reconnu. Colle la liste copiée depuis le panier (avec les codes).';
      msg.className = 'fx-msg warn show';
    } else {
      var n = items.reduce(function (s, it) { return s + it.qty; }, 0);
      var t = items.length + ' filament' + (items.length > 1 ? 's' : '') + ' · ' + n + ' bobine' + (n > 1 ? 's' : '') + ' reconnus ✓';
      if (res.unmatched.length) t += ' — ' + res.unmatched.length + ' ligne(s) ignorée(s).';
      msg.textContent = t; msg.className = 'fx-msg ok show';
    }
    render();
  }

  /* ---------- calcul + rendu ---------- */
  function totals() {
    var sub = items.reduce(function (s, it) { return s + it.qty * it.price; }, 0);
    var co = readCompanyForm();
    var tps = taxEnabled ? sub * (co.gstRate || 0) / 100 : 0;
    var tvq = taxEnabled ? sub * (co.qstRate || 0) / 100 : 0;
    return { sub: sub, tps: tps, tvq: tvq, total: sub + tps + tvq, co: co };
  }

  function render() {
    var box = $('#invoice');
    if (!items.length) { box.innerHTML = '<p class="inv-empty">Choisis des filaments dans le catalogue à gauche (ou colle une commande).</p>'; refreshPicker(); return; }
    var co = readCompanyForm();
    var t = totals();

    var meta = [];
    if (co.address) meta.push(co.address);
    var cityLine = [co.city, co.postal].filter(Boolean).join('  ');
    if (cityLine) meta.push(cityLine);
    if (co.email) meta.push(co.email);
    if (co.phone) meta.push(co.phone);
    if (co.neq) meta.push('NEQ : ' + co.neq);

    var cliName = $('#cli-name').value.trim(), cliContact = $('#cli-contact').value.trim();
    var billto = (cliName || cliContact)
      ? '<div class="inv-billto"><div class="lbl">Facturé à</div>' +
        (cliName ? '<div class="who">' + esc(cliName) + '</div>' : '') +
        (cliContact ? '<div>' + esc(cliContact) + '</div>' : '') + '</div>'
      : '';

    var rows = items.map(function (it, i) {
      var metaTxt = (it.type === 'accessory')
        ? 'Accessoire'
        : it.material + ' · ' + it.code + ' · ' + (TYPE_LABEL_T[it.type] || 'Recharge');
      return '<tr data-i="' + i + '">' +
        '<td>' + swatchSVG(it.hex) + esc(it.name) +
          ' <span class="inv-mat">' + esc(metaTxt) + '</span></td>' +
        '<td class="num"><input class="inv-qty" type="number" min="1" step="1" value="' + it.qty + '" data-i="' + i + '"></td>' +
        '<td class="num"><input class="inv-price" type="number" min="0" step="0.01" value="' + it.price + '" data-i="' + i + '"></td>' +
        '<td class="num">' + money(it.qty * it.price) + '</td>' +
        '<td class="num"><button class="inv-del no-print" data-i="' + i + '" title="Retirer">&times;</button></td>' +
      '</tr>';
    }).join('');

    var taxLines = '';
    if (taxEnabled) {
      taxLines =
        '<div class="line"><span>TPS (' + co.gstRate + ' %)' + (co.gst ? ' <span class="taxno">' + esc(co.gst) + '</span>' : '') + '</span><span>' + money(t.tps) + '</span></div>' +
        '<div class="line"><span>TVQ (' + co.qstRate + ' %)' + (co.qst ? ' <span class="taxno">' + esc(co.qst) + '</span>' : '') + '</span><span>' + money(t.tvq) + '</span></div>';
    }

    box.innerHTML =
      '<div class="inv-top">' +
        '<div>' + (co.logo ? '<img class="inv-logo" src="' + co.logo + '" alt="' + esc(co.name) + '">' : '') +
          '<div class="inv-co-name">' + esc(co.name || 'Entreprise') + '</div>' +
          (co.tagline ? '<div class="inv-co-tag">' + esc(co.tagline) + '</div>' : '') +
          (meta.length ? '<div class="inv-co-meta">' + esc(meta.join('\n')) + '</div>' : '') + '</div>' +
        '<div class="inv-title"><h1>FACTURE</h1><div class="meta">' +
          'N° ' + esc($('#inv-number').value || fmtNumber(nextSeq())) + '<br>' +
          fmtDateFR($('#inv-date').value || todayISO()) + '</div></div>' +
      '</div>' +
      billto +
      '<table class="inv-table"><thead><tr>' +
        '<th>Description</th><th class="num">Qté</th><th class="num">Prix unit.</th><th class="num">Montant</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="inv-tot">' +
        '<div class="line"><span>Sous-total</span><span>' + money(t.sub) + '</span></div>' +
        taxLines +
        '<div class="line grand"><span>Total</span><span>' + money(t.total) + '</span></div>' +
      '</div>' +
      (($('#inv-note').value.trim()) ? '<div class="inv-pay"><span class="lbl">Paiement</span>' + esc($('#inv-note').value.trim()) + '</div>' : '') +
      '<div class="inv-foot">Filament PLA / PETG / ABS — recharge 1&nbsp;kg (Ø&nbsp;1,75&nbsp;mm). ' +
        'Aucun paiement en ligne&nbsp;; ramassage à Québec. Merci de votre confiance&nbsp;!</div>';

    // écouteurs des champs éditables
    box.querySelectorAll('.inv-qty').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var it = items[+this.getAttribute('data-i')]; if (!it) return;
        it.qty = Math.max(1, parseInt(this.value, 10) || 1); render();
      });
    });
    box.querySelectorAll('.inv-price').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var it = items[+this.getAttribute('data-i')]; if (!it) return;
        it.price = Math.max(0, parseFloat(this.value) || 0); render();
      });
    });
    box.querySelectorAll('.inv-del').forEach(function (b) {
      b.addEventListener('click', function () {
        items.splice(+this.getAttribute('data-i'), 1); render();
      });
    });

    refreshPicker();
    updateDeductBtn();
  }

  /* ---------- texte (copier) ---------- */
  function invoiceText() {
    var co = readCompanyForm(), t = totals();
    var L = [];
    L.push(co.name); if (co.tagline) L.push(co.tagline);
    if (co.address) L.push(co.address);
    var city = [co.city, co.postal].filter(Boolean).join(' '); if (city) L.push(city);
    if (co.email) L.push(co.email); if (co.phone) L.push(co.phone);
    L.push('');
    L.push('FACTURE  ' + ($('#inv-number').value || '') + '   ' + fmtDateFR($('#inv-date').value || todayISO()));
    var cli = $('#cli-name').value.trim(); if (cli) L.push('Facturé à : ' + cli);
    L.push('');
    items.forEach(function (it) {
      L.push(it.qty + ' x ' + it.name + ' (' + it.material + ' · ' + it.code + ')  —  ' + money(it.qty * it.price));
    });
    L.push('');
    L.push('Sous-total : ' + money(t.sub));
    if (taxEnabled) { L.push('TPS (' + co.gstRate + '%) : ' + money(t.tps)); L.push('TVQ (' + co.qstRate + '%) : ' + money(t.tvq)); }
    L.push('TOTAL : ' + money(t.total));
    var note = $('#inv-note').value.trim();
    if (note) { L.push(''); L.push('Paiement : ' + note); }
    return L.join('\n');
  }
  function copyInvoice() {
    if (!items.length) return;
    var txt = invoiceText(), btn = $('#btn-copy');
    var done = function () { var o = btn.textContent; btn.textContent = 'Copié ✓'; setTimeout(function () { btn.textContent = o; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done);
    else done();
  }

  /* ---------- déduction de l'inventaire (Supabase, admin connecté) ----------
     Déclenchée par un bouton explicite. Verrou anti-double-déduction par
     numéro de facture (localStorage). Plafonne à 0 (jamais de négatif). */
  var LS_DEDUCTED = 'ca_fx_deducted_v1';
  function deductedList() { try { return JSON.parse(localStorage.getItem(LS_DEDUCTED) || '[]'); } catch (e) { return []; } }
  function isDeducted(num) { return deductedList().indexOf(String(num)) !== -1; }
  function markDeducted(num) {
    var s = deductedList(); if (s.indexOf(String(num)) === -1) s.push(String(num));
    try { localStorage.setItem(LS_DEDUCTED, JSON.stringify(s)); } catch (e) {}
  }
  function currentInvNum() { return ($('#inv-number').value || '').trim(); }
  function deductMsg(kind, html) {
    var m = $('#deduct-msg'); if (!m) return;
    m.innerHTML = html; m.className = 'fx-msg no-print show ' + (kind || ''); m.style.margin = '-6px 0 12px';
  }
  function updateDeductBtn() {
    var b = $('#btn-deduct'); if (!b) return;
    if (!items.length) { b.disabled = true; b.textContent = 'Déduire de l\'inventaire'; return; }
    if (isDeducted(currentInvNum())) { b.disabled = true; b.textContent = '✓ Stock déduit'; }
    else { b.disabled = false; b.textContent = 'Déduire de l\'inventaire'; }
  }
  function labelOf(code) {
    var m = byCode[code] || SPOOLS[code];
    return (m ? (m.material ? m.material + ' · ' + m.name : m.name) : code) + ' (' + code + ')';
  }
  // besoins par code : recharge + accessoire -> colonne qty ; avec bobine -> qty_spool
  function deductionNeeds() {
    var need = {};
    items.forEach(function (it) {
      var col = (it.type === 'spool') ? 'qty_spool' : 'qty';
      var n = need[it.code] || (need[it.code] = { qty: 0, qty_spool: 0 });
      n[col] += Math.max(0, parseInt(it.qty, 10) || 0);
    });
    return need;
  }
  function deductInventory() {
    if (!items.length) return;
    var sb = window.CA && window.CA.sb;
    if (!sb) { deductMsg('warn', 'Connexion à la base indisponible (hors ligne&nbsp;?).'); return; }
    var num = currentInvNum();
    if (isDeducted(num)) { deductMsg('warn', 'Le stock de la facture ' + esc(num) + ' a déjà été déduit.'); return; }
    var b = $('#btn-deduct'); b.disabled = true; b.textContent = 'Vérification…';
    sb.auth.getSession().then(function (r) {
      var session = r && r.data && r.data.session;
      if (!session) {
        deductMsg('warn', 'Tu dois être connecté en admin pour déduire le stock. <a href="admin.html" target="_blank">Ouvrir l\'admin</a>, connecte-toi, puis reviens et réessaie.');
        updateDeductBtn(); return;
      }
      var need = deductionNeeds(), codes = Object.keys(need);
      sb.from('inventory').select('code,qty,qty_spool').in('code', codes).then(function (res) {
        if (res.error || !res.data) {
          sb.from('inventory').select('code,qty').in('code', codes).then(function (r2) {
            if (r2.error || !r2.data) { deductMsg('warn', 'Lecture du stock impossible.'); updateDeductBtn(); return; }
            finalizeDeduction(sb, need, codes, r2.data, true);
          });
          return;
        }
        finalizeDeduction(sb, need, codes, res.data, false);
      });
    }, function () { deductMsg('warn', 'Impossible de vérifier la session.'); updateDeductBtn(); });
  }
  function finalizeDeduction(sb, need, codes, rows, noSpool) {
    var cur = {}; rows.forEach(function (r) { cur[r.code] = r; });
    var plans = [], lines = [], oversell = [], missing = [];
    codes.forEach(function (code) {
      var n = need[code], c = cur[code];
      if (!c) { missing.push(code); return; }
      var patch = { updated_at: new Date().toISOString() }, changed = false;
      if (n.qty > 0) {
        var q0 = parseInt(c.qty, 10) || 0, q1 = q0 - n.qty;
        if (q1 < 0) { oversell.push(labelOf(code) + ' — recharge/accessoire'); q1 = 0; }
        patch.qty = q1; changed = true;
        lines.push(labelOf(code) + ' · recharge/access. : ' + q0 + ' → ' + q1);
      }
      if (n.qty_spool > 0) {
        if (noSpool) { oversell.push(labelOf(code) + ' — avec bobine (colonne absente)'); }
        else {
          var s0 = (c.qty_spool != null) ? (parseInt(c.qty_spool, 10) || 0) : 0, s1 = s0 - n.qty_spool;
          if (s1 < 0) { oversell.push(labelOf(code) + ' — avec bobine'); s1 = 0; }
          patch.qty_spool = s1; changed = true;
          lines.push(labelOf(code) + ' · avec bobine : ' + s0 + ' → ' + s1);
        }
      }
      if (changed) plans.push({ code: code, patch: patch });
    });
    var txt = 'Déduire de l\'inventaire — facture ' + currentInvNum() + '\n\n' + lines.join('\n');
    if (oversell.length) txt += '\n\n⚠ Stock insuffisant (sera mis à 0) :\n- ' + oversell.join('\n- ');
    if (missing.length) txt += '\n\n⚠ Absents de l\'inventaire (ignorés) : ' + missing.join(', ');
    txt += '\n\nConfirmer la déduction ?';
    if (!window.confirm(txt)) { deductMsg('', 'Déduction annulée.'); updateDeductBtn(); return; }
    if (!plans.length) { deductMsg('warn', 'Rien à déduire (articles absents de l\'inventaire).'); updateDeductBtn(); return; }
    $('#btn-deduct').textContent = 'Déduction…';
    Promise.all(plans.map(function (p) { return sb.from('inventory').update(p.patch).eq('code', p.code); }))
      .then(function (results) {
        var errs = results.filter(function (x) { return x && x.error; });
        if (errs.length) { deductMsg('warn', 'Erreur sur ' + errs.length + ' article(s). Vérifie l\'inventaire dans l\'admin.'); updateDeductBtn(); return; }
        markDeducted(currentInvNum());
        logSale(sb);   // journalise la vente (suivi dans l'admin) — best effort
        deductMsg('ok', '✓ Stock déduit pour la facture ' + esc(currentInvNum()) +
          (oversell.length ? ' — ' + oversell.length + ' article(s) mis à 0 faute de stock' : '') + '.');
        updateDeductBtn();
      }, function () { deductMsg('warn', 'Échec réseau pendant la déduction.'); updateDeductBtn(); });
  }
  // enregistre chaque ligne de la facture dans le journal des ventes.
  // Best effort : si ça échoue, le stock est déjà déduit — on prévient sans bloquer.
  function logSale(sb) {
    var num = currentInvNum();
    var rows = items.map(function (it) {
      return { invoice_no: num, code: it.code, name: it.name, material: it.material || '',
        type: it.type || 'refill', qty: Math.max(0, parseInt(it.qty, 10) || 0),
        unit_price: (parseFloat(it.price) || 0) };
    }).filter(function (r) { return r.qty > 0; });
    if (!rows.length) return;
    sb.from('sales').insert(rows).then(function (res) {
      if (res && res.error) {
        deductMsg('warn', 'Stock déduit ✓, mais l\'enregistrement de la vente a échoué (table « sales » créée&nbsp;?). Le stock est bon.');
      }
    }, function () {});
  }

  /* ---------- init ---------- */
  fillCompanyForm(loadCompany());
  $('#inv-number').value = fmtNumber(nextSeq());
  $('#inv-date').value = todayISO();
  try { $('#inv-note').value = localStorage.getItem(LS_NOTE) || ''; } catch (e) {}

  buildPicker();
  refreshPicker();
  $('#pk-search').addEventListener('input', function () { filterPicker(this.value); });
  $('#pk-clear').addEventListener('click', clearAll);
  Array.prototype.forEach.call(document.querySelectorAll('.pk-type-btn'), function (b) {
    b.addEventListener('click', function () { setFxType(b.getAttribute('data-type')); });
  });
  if ($('#pk-spool')) $('#pk-spool').addEventListener('click', function () { addSpool('SPOOL'); });
  if ($('#pk-spool-ht')) $('#pk-spool-ht').addEventListener('click', function () { addSpool('SPOOLHT'); });

  $('#btn-generate').addEventListener('click', generate);
  $('#co-save').addEventListener('click', saveCompany);
  $('#btn-print').addEventListener('click', function () { if (items.length) window.print(); });
  $('#btn-copy').addEventListener('click', copyInvoice);
  $('#btn-next').addEventListener('click', bumpSeq);
  $('#btn-deduct').addEventListener('click', deductInventory);
  updateDeductBtn();
  $('#tax-enabled').addEventListener('change', function () { taxEnabled = this.checked; render(); });
  $('#co-logo-file').addEventListener('change', function () { handleLogoFile(this.files && this.files[0]); });
  $('#co-logo-remove').addEventListener('click', function () { logoData = ''; $('#co-logo-file').value = ''; showLogoPreview(); writeCompany(); render(); });
  $('#inv-note').addEventListener('input', function () { try { localStorage.setItem(LS_NOTE, this.value); } catch (e) {} if (items.length) render(); });
  ['#inv-number', '#inv-date', '#cli-name', '#cli-contact'].forEach(function (s) {
    $(s).addEventListener('input', function () { if (items.length) render(); });
  });
})();
