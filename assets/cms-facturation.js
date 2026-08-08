/* =========================================================
   Création Audio V2 — Facturation (Phase 4)
   Trois gabarits : Filament · Spacer · Caisson (sur-mesure).
   - Catalogue cliquable lu depuis Supabase (products + materials).
   - Prix hérité du matériau (filament) ou du produit (spacer),
     paliers de rabais appliqués selon la quantité.
   - Lignes libres (caisson : matériaux + main-d'œuvre + specs).
   - Marge privée (coût) calculée pour l'admin — jamais imprimée.
   - Enregistrement : numéro atomique (RPC), persistance
     (invoices / invoice_lines), déduction de stock (receive_stock).
   - Impression PDF + copie texte.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var BUCKET = 'products';
  var LS_CO = 'ca_v2_facture_company';
  var LS_OLIVIER = 'ca_v2_facture_client_olivier';   // coordonnées mémorisées du dealer

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function todayISO() { var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function fmtDateFR(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    try { return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return iso; }
  }
  function publicUrl(path) { if (!path) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function swatchSVG(hex) {
    if (!hex) return '';
    return '<svg class="inv-sw" width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">' +
      '<circle cx="6" cy="6" r="5.4" fill="' + esc(hex) + '" stroke="rgba(0,0,0,.28)" stroke-width="0.7"/></svg>';
  }
  function normalizeTiers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return { min: parseInt(t.min, 10), price: parseFloat(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; });
  }
  function tierPrice(base, tiers, qty) {
    var p = +base || 0;
    normalizeTiers(tiers).forEach(function (t) { if (qty >= t.min) p = t.price; });
    return p;
  }
  var uid = (function () { var i = 0; return function () { return 'l' + (++i) + Date.now().toString(36); }; })();

  /* ---------- état ---------- */
  var loaded = false;
  var cat = 'filament';          // gabarit courant (pilote la colonne gauche)
  var clientType = 'client';     // 'client' | 'olivier'
  var taxEnabled = false;
  var pickerKind = 'spool';      // filament : bobine | recharge
  var brandFilter = 'all';       // filtre marque (catalogue filament)
  var matFilter = 'all';         // filtre matériau (catalogue filament)
  var lines = [];                // lignes de la facture
  var saved = false;             // verrou anti-double-enregistrement
  var catalog = { filament: [], spacer: [] };
  var catalogLoaded = { filament: false, spacer: false };
  var lastAutoNumber = '';   // dernier n° auto proposé (E2 : détecte une saisie manuelle)

  /* ---------- éléments ---------- */
  var elReset = $('#fx-reset'), elNextHint = $('#fx-nexthint'),
      elTax = $('#fx-tax'),
      elCliName = $('#fx-cli-name'), elCliContact = $('#fx-cli-contact'),
      elCliAddress = $('#fx-cli-address'), elCliCity = $('#fx-cli-city'), elCliHint = $('#fx-cli-hint'),
      elNumber = $('#fx-number'), elDate = $('#fx-date'), elNote = $('#fx-note'),
      elSearch = $('#fx-search'), elType = $('#fx-type'), elCatalog = $('#fx-catalog'),
      elFilters = $('#fx-filters'), elBrand = $('#fx-brand'), elMaterial = $('#fx-material'),
      elPicker = $('#fx-picker'), elCaisson = $('#fx-caisson'), elFreeBtn = $('#fx-add-free'),
      elInvoice = $('#fx-invoice'), elMargin = $('#fx-margin'),
      elSave = $('#fx-save'), elDeduct = $('#fx-deduct'), elDeductWrap = $('#fx-deduct-wrap'),
      elPrint = $('#fx-print'), elEmail = $('#fx-email'), elCopy = $('#fx-copy'), elStatus = $('#fx-status');
  // specs caisson
  var cxVehicle = $('#cx-vehicle'), cxLitrage = $('#cx-litrage'), cxEvent = $('#cx-event'), cxFinition = $('#cx-finition');

  /* ---------- entreprise (localStorage) ---------- */
  var DEFAULT_CO = {
    name: 'Création Audio', tagline: 'Audio automobile & impression 3D — Québec',
    address: '', city: 'Québec, QC', email: 'contact@creationaudio.ca', phone: '',
    gst: '', qst: '', gstRate: 5, qstRate: 9.975, logo: ''
  };
  var logoData = '';
  function loadCompany() {
    var co = {}; try { co = JSON.parse(localStorage.getItem(LS_CO)) || {}; } catch (e) {}
    var m = {}; for (var k in DEFAULT_CO) m[k] = (co[k] != null && co[k] !== '') ? co[k] : DEFAULT_CO[k];
    return m;
  }
  function fillCompanyForm(co) {
    $('#co-name').value = co.name; $('#co-tagline').value = co.tagline;
    $('#co-address').value = co.address; $('#co-city').value = co.city;
    $('#co-email').value = co.email; $('#co-phone').value = co.phone;
    $('#co-gst').value = co.gst; $('#co-qst').value = co.qst;
    $('#gst-rate').value = co.gstRate; $('#qst-rate').value = co.qstRate;
    logoData = co.logo || ''; showLogoPreview();
  }
  function readCompanyForm() {
    return {
      name: $('#co-name').value.trim(), tagline: $('#co-tagline').value.trim(),
      address: $('#co-address').value.trim(), city: $('#co-city').value.trim(),
      email: $('#co-email').value.trim(), phone: $('#co-phone').value.trim(),
      gst: $('#co-gst').value.trim(), qst: $('#co-qst').value.trim(),
      gstRate: parseFloat($('#gst-rate').value) || 0, qstRate: parseFloat($('#qst-rate').value) || 0,
      logo: logoData
    };
  }
  function showLogoPreview() {
    var wrap = $('#co-logo-preview');
    if (logoData) { $('#co-logo-img').src = logoData; wrap.hidden = false; } else { wrap.hidden = true; }
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
        try { logoData = c.toDataURL('image/png'); } catch (err) { logoData = e.target.result; }
        showLogoPreview(); writeCompany(); render();
      };
      img.onerror = function () {};
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- prix / coût / paliers par type de produit ---------- */
  function matOf(p) { return (window.CA.materialOf ? window.CA.materialOf(p.brand, p.material) : null) || null; }
  function filOffers(p, kind) {
    var m = matOf(p);
    if (kind === 'refill') return !!p.offer_refill && (m ? m.sell_refill != null : p.sell_price_2 != null);
    return !!p.offer_spool && (m ? m.sell_spool != null : p.sell_price != null);
  }
  function filBase(p, kind) { var m = matOf(p); if (m) return kind === 'refill' ? m.sell_refill : m.sell_spool; return kind === 'refill' ? p.sell_price_2 : p.sell_price; }
  function filCost(p, kind) { var m = matOf(p); if (m) return (kind === 'refill' ? m.cost_refill : m.cost_spool) || 0; return (kind === 'refill' ? p.cost_price_2 : p.cost_price) || 0; }
  function filTiers(p, kind) { var m = matOf(p); if (m) return kind === 'refill' ? m.tiers_refill : m.tiers_spool; return kind === 'refill' ? p.tiers_2 : p.tiers; }

  /* ---------- chargement ---------- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'facturation') ensureLoad();
  };
  function ensureLoad() {
    if (loaded) return;
    loaded = true;
    fillCompanyForm(loadCompany());
    if (!elDate.value) elDate.value = todayISO();
    setCat('filament');
    loadNextNumberHint();
    Promise.resolve(window.CA.loadMaterials ? window.CA.loadMaterials() : null)
      .then(function () { loadCatalog('filament'); }, function () { loadCatalog('filament'); });
    render();
  }

  function loadNextNumberHint() {
    var year = new Date().getFullYear();
    sb.from('invoices').select('number').like('number', 'F-' + year + '-%')
      .order('number', { ascending: false }).limit(1)
      .then(function (res) {
        var seq = 1;
        if (!res.error && res.data && res.data.length) {
          var m = /-(\d+)$/.exec(res.data[0].number || '');
          if (m) seq = parseInt(m[1], 10) + 1;
        }
        var next = 'F-' + year + '-' + ('000' + seq).slice(-3);
        lastAutoNumber = next;
        if (!saved) elNumber.value = next;
        elNextHint.textContent = 'Prochaine : ' + next;
      }, function () {});
  }

  function loadCatalog(which) {
    if (which === 'caisson') return;
    if (catalogLoaded[which]) { buildPicker(); return; }
    elCatalog.innerHTML = '<p class="muted">Chargement…</p>';
    sb.from('products').select('*').eq('type', which)
      .order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) {
        if (res.error) { elCatalog.innerHTML = '<p class="empty">Impossible de charger le catalogue.</p>'; return; }
        catalog[which] = res.data || [];
        catalogLoaded[which] = true;
        buildPicker();
      }, function () { elCatalog.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  /* ---------- gabarit (segmented) ---------- */
  function setCat(c) {
    cat = c;
    $$('.fx-seg-btn').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-cat') === c); });
    var isCaisson = (c === 'caisson');
    elPicker.hidden = isCaisson;
    elCaisson.hidden = !isCaisson;
    elFreeBtn.hidden = isCaisson;                 // le panneau caisson a ses propres boutons
    elType.hidden = (c !== 'filament');
    if (elFilters) elFilters.hidden = (c !== 'filament');
    if (!isCaisson) loadCatalog(c);
  }
  $$('.fx-seg-btn').forEach(function (b) {
    b.addEventListener('click', function () { setCat(b.getAttribute('data-cat')); });
  });
  $$('.fx-cli-btn').forEach(function (b) {
    b.addEventListener('click', function () { setClientType(b.getAttribute('data-cli')); });
  });

  /* ---------- profil client (Olivier mémorisé) ---------- */
  function clientFields() { return { name: elCliName.value, contact: elCliContact.value, address: elCliAddress.value, city: elCliCity.value }; }
  function setClientFields(p) {
    p = p || {};
    elCliName.value = p.name || ''; elCliContact.value = p.contact || '';
    elCliAddress.value = p.address || ''; elCliCity.value = p.city || '';
  }
  function loadOlivierProfile() { try { return JSON.parse(localStorage.getItem(LS_OLIVIER)) || {}; } catch (e) { return {}; } }
  function saveOlivierProfile() { try { localStorage.setItem(LS_OLIVIER, JSON.stringify(clientFields())); } catch (e) {} }
  function setClientType(type, keepFields) {
    clientType = (type === 'olivier') ? 'olivier' : 'client';
    $$('.fx-cli-btn').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-cli') === clientType); });
    if (!keepFields) {
      if (clientType === 'olivier') { setClientFields(loadOlivierProfile()); elCliHint.textContent = 'Coordonnées mémorisées pour Olivier — modifie-les, c\'est retenu.'; }
      else { setClientFields({}); elCliHint.textContent = ''; }
    }
    repriceSpacers();                       // bascule prix client <-> dealer sur les lignes spacer
    if (cat === 'spacer') buildPicker();    // rafraîchit les prix affichés dans le catalogue
    if (saved) unlock();
    render();
  }
  $$('.fx-type-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      pickerKind = b.getAttribute('data-kind');
      $$('.fx-type-btn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      buildPicker();
    });
  });
  if (elBrand) elBrand.addEventListener('change', function () {
    brandFilter = this.value; matFilter = 'all';       // la marque change -> matériau remis à « tous »
    refreshFilterOptions(); buildPicker();
  });
  if (elMaterial) elMaterial.addEventListener('change', function () { matFilter = this.value; buildPicker(); });

  // remplit les menus Marque / Matériau à partir du catalogue filament
  function refreshFilterOptions() {
    if (!elBrand || !elMaterial) return;
    var fils = catalog.filament || [];
    var brands = [];
    fils.forEach(function (p) { var b = p.brand || 'Autres'; if (brands.indexOf(b) === -1) brands.push(b); });
    brands.sort();
    if (brandFilter !== 'all' && brands.indexOf(brandFilter) === -1) brandFilter = 'all';
    elBrand.innerHTML = '<option value="all">Toutes les marques</option>' +
      brands.map(function (b) { return '<option value="' + esc(b) + '"' + (b === brandFilter ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('');
    // matériaux (scopés à la marque choisie)
    var mats = [];
    fils.forEach(function (p) {
      if (brandFilter !== 'all' && (p.brand || 'Autres') !== brandFilter) return;
      var m = p.material || 'Autres'; if (mats.indexOf(m) === -1) mats.push(m);
    });
    mats.sort();
    if (matFilter !== 'all' && mats.indexOf(matFilter) === -1) matFilter = 'all';
    elMaterial.innerHTML = '<option value="all">Tous les matériaux</option>' +
      mats.map(function (m) { return '<option value="' + esc(m) + '"' + (m === matFilter ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
  }

  /* ---------- catalogue cliquable ---------- */
  function buildPicker() {
    if (cat === 'caisson') return;
    var items = catalog[cat] || [];
    if (!items.length) { elCatalog.innerHTML = '<p class="empty">Aucun ' + cat + ' dans le catalogue.</p>'; return; }

    if (cat === 'filament') {
      refreshFilterOptions();
      // ne montrer que les couleurs offrant le format + les filtres marque/matériau, groupées par (marque · matériau)
      var groups = [], idx = {};
      items.forEach(function (p) {
        if (!filOffers(p, pickerKind)) return;
        if (brandFilter !== 'all' && (p.brand || 'Autres') !== brandFilter) return;
        if (matFilter !== 'all' && (p.material || 'Autres') !== matFilter) return;
        var key = (p.brand || 'Autres') + ' · ' + (p.material || 'Autres');
        if (!(key in idx)) { idx[key] = groups.length; groups.push({ title: key, items: [] }); }
        groups[idx[key]].items.push(p);
      });
      if (!groups.length) { elCatalog.innerHTML = '<p class="empty">Aucune couleur pour ces filtres.</p>'; return; }
      elCatalog.innerHTML = groups.map(function (g) {
        return '<div class="pk-group"><div class="pk-group-title">' + esc(g.title) + '</div><div class="pk-grid">' +
          g.items.map(function (p) {
            return '<button type="button" class="pk-cell" data-id="' + esc(p.id) + '" data-search="' +
              esc(((p.name || '') + ' ' + (p.material || '') + ' ' + (p.code || '')).toLowerCase()) + '">' +
              '<span class="pk-sw" style="background:' + esc(p.hex || '#ccc') + '"></span>' +
              '<span class="pk-name">' + esc(p.name) + '</span>' +
              '<span class="pk-badge"></span></button>';
          }).join('') + '</div></div>';
      }).join('');
    } else { // spacer
      elCatalog.innerHTML = '<div class="pk-grid pk-grid-cards">' + items.map(function (p) {
        var url = publicUrl(p.image_path);
        return '<button type="button" class="pk-cell pk-card" data-id="' + esc(p.id) + '" data-search="' +
          esc((p.name || '').toLowerCase()) + '">' +
          (url ? '<img class="pk-img" src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="pk-img pk-noimg"></span>') +
          '<span class="pk-name">' + esc(p.name) + '</span>' +
          '<span class="pk-price">' + money(isDealer() ? (p.dealer_price != null ? p.dealer_price : p.sell_price) : p.sell_price) + '</span>' +
          '<span class="pk-badge"></span></button>';
      }).join('') + '</div>';
    }

    $$('.pk-cell', elCatalog).forEach(function (b) {
      b.addEventListener('click', function () { addProduct(b.getAttribute('data-id')); });
    });
    applyFilter(elSearch.value);
    refreshPickerBadges();
  }
  function applyFilter(q) {
    q = (q || '').trim().toLowerCase();
    $$('.pk-group', elCatalog).forEach(function (g) {
      var any = false;
      $$('.pk-cell', g).forEach(function (b) {
        var show = !q || b.getAttribute('data-search').indexOf(q) !== -1;
        b.style.display = show ? '' : 'none'; if (show) any = true;
      });
      g.style.display = any ? '' : 'none';
    });
    // spacers : pas de .pk-group wrapper
    if (!$$('.pk-group', elCatalog).length) {
      $$('.pk-cell', elCatalog).forEach(function (b) {
        b.style.display = (!q || b.getAttribute('data-search').indexOf(q) !== -1) ? '' : 'none';
      });
    }
  }
  function refreshPickerBadges() {
    var counts = {};
    lines.forEach(function (l) { if (l.productId) counts[l.productId] = (counts[l.productId] || 0) + l.qty; });
    $$('.pk-cell', elCatalog).forEach(function (b) {
      var n = counts[b.getAttribute('data-id')] || 0, badge = $('.pk-badge', b);
      if (n > 0) { b.classList.add('sel'); if (badge) badge.textContent = n; }
      else { b.classList.remove('sel'); if (badge) badge.textContent = ''; }
    });
  }
  if (elSearch) elSearch.addEventListener('input', function () { applyFilter(this.value); });

  /* ---------- ajout de lignes ---------- */
  function prodById(id) { var arr = catalog[cat] || []; return arr.filter(function (p) { return String(p.id) === String(id); })[0] || null; }

  function isDealer() { return clientType === 'olivier'; }
  // spacer : prix client (à plat) OU prix dealer (+ rabais quantité) selon le type de client
  function spacerDual(p) { return { client: +p.sell_price || 0, dealer: +(p.dealer_price != null ? p.dealer_price : p.sell_price) || 0, tiers: p.tiers || [] }; }

  function addProduct(id) {
    var p = prodById(id);
    if (!p) return;
    var kind, label, meta, base, cost, tiers, hex = null, ptype = cat, sp = null;
    if (cat === 'filament') {
      kind = pickerKind;
      base = filBase(p, kind); cost = filCost(p, kind); tiers = filTiers(p, kind);
      label = p.name; hex = p.hex;
      meta = [p.brand, p.material, (kind === 'refill' ? 'Recharge' : 'Avec bobine')].filter(Boolean).join(' · ');
    } else { // spacer : deux tarifs (client / dealer)
      kind = 'unit';
      sp = spacerDual(p);
      base = isDealer() ? sp.dealer : sp.client;
      tiers = isDealer() ? sp.tiers : [];
      cost = p.cost_price; label = p.name; meta = 'Spacer · paire';
    }
    // fusion si même produit + même format et prix non modifié à la main
    var ex = lines.filter(function (l) { return l.productId === String(id) && l.kind === kind && !l.manual; })[0];
    if (ex) { ex.qty += 1; ex.price = tierPrice(ex.base, ex.tiers, ex.qty); }
    else {
      lines.push({ id: uid(), productId: String(id), ptype: ptype, kind: kind, label: label, meta: meta,
        hex: hex, qty: 1, base: +base || 0, tiers: tiers || [], cost: +cost || 0,
        price: tierPrice(base, tiers, 1), manual: false, sp: sp });
    }
    afterChange();
  }
  // re-tarife les lignes spacer quand on bascule client <-> dealer
  function repriceSpacers() {
    lines.forEach(function (l) {
      if (l.ptype !== 'spacer' || !l.sp) return;
      l.base = isDealer() ? l.sp.dealer : l.sp.client;
      l.tiers = isDealer() ? l.sp.tiers : [];
      if (!l.manual) l.price = tierPrice(l.base, l.tiers, l.qty);
    });
  }
  function addFreeLine(preset) {
    preset = preset || {};
    lines.push({ id: uid(), productId: null, ptype: (cat === 'caisson' ? 'caisson' : cat), kind: 'free',
      label: preset.label || '', meta: preset.meta || '', hex: null,
      qty: preset.qty != null ? preset.qty : 1, base: 0, tiers: [], cost: preset.cost != null ? preset.cost : 0,
      price: preset.price != null ? preset.price : 0, manual: true });
    afterChange();
  }
  if (elFreeBtn) elFreeBtn.addEventListener('click', function () { addFreeLine(); });
  if ($('#cx-add-line')) $('#cx-add-line').addEventListener('click', function () { addFreeLine({ label: '' }); });
  if ($('#cx-add-labor')) $('#cx-add-labor').addEventListener('click', function () { addFreeLine({ label: "Main-d'œuvre" }); });

  function afterChange() { if (saved) unlock(); render(); }

  /* ---------- totaux ---------- */
  function totals() {
    var co = readCompanyForm();
    var sub = 0, costTotal = 0;
    lines.forEach(function (l) { sub += l.qty * l.price; costTotal += l.qty * l.cost; });
    var gst = taxEnabled ? sub * (co.gstRate || 0) / 100 : 0;
    var qst = taxEnabled ? sub * (co.qstRate || 0) / 100 : 0;
    return { sub: sub, gst: gst, qst: qst, total: sub + gst + qst, cost: costTotal, margin: sub - costTotal, co: co };
  }
  function specsText() {
    var parts = [];
    if (cxVehicle.value.trim()) parts.push('Véhicule : ' + cxVehicle.value.trim());
    if (cxLitrage.value.trim()) parts.push('Litrage : ' + cxLitrage.value.trim());
    if (cxEvent.value.trim()) parts.push('Évent : ' + cxEvent.value.trim());
    if (cxFinition.value.trim()) parts.push('Finition : ' + cxFinition.value.trim());
    return parts.join(' · ');
  }

  /* ---------- rendu de la facture ---------- */
  function render() {
    if (!lines.length) {
      elInvoice.innerHTML = '<p class="inv-empty">Ajoute des articles depuis le catalogue (ou une ligne libre).</p>';
      elMargin.hidden = true;
      refreshPickerBadges();
      return;
    }
    var co = readCompanyForm(), t = totals();

    var meta = [];
    if (co.address) meta.push(co.address);
    if (co.city) meta.push(co.city);
    if (co.email) meta.push(co.email);
    if (co.phone) meta.push(co.phone);

    var cliName = elCliName.value.trim(), cliContact = elCliContact.value.trim(),
        cliAddress = elCliAddress.value.trim(), cliCity = elCliCity.value.trim();
    var cliTag = clientType === 'olivier' ? ' <span class="inv-cli-tag">Dealer</span>' : '';
    var billto = (cliName || cliContact || cliAddress || cliCity)
      ? '<div class="inv-billto"><div class="lbl">Facturé à</div>' +
        (cliName ? '<div class="who">' + esc(cliName) + cliTag + '</div>' : '') +
        (cliAddress ? '<div>' + esc(cliAddress) + '</div>' : '') +
        (cliCity ? '<div>' + esc(cliCity) + '</div>' : '') +
        (cliContact ? '<div>' + esc(cliContact) + '</div>' : '') + '</div>'
      : '';

    var specs = specsText();
    var specsBlock = specs ? '<div class="inv-specs"><span class="lbl">Caisson</span>' + esc(specs) + '</div>' : '';

    var rows = lines.map(function (l, i) {
      var descCell = (l.kind === 'free')
        ? '<input class="inv-label" type="text" value="' + esc(l.label) + '" data-i="' + i + '" placeholder="Description">'
        : swatchSVG(l.hex) + esc(l.label) + (l.meta ? ' <span class="inv-mat">' + esc(l.meta) + '</span>' : '');
      return '<tr data-i="' + i + '">' +
        '<td>' + descCell + '</td>' +
        '<td class="num"><input class="inv-qty" type="number" min="0" step="1" value="' + l.qty + '" data-i="' + i + '"></td>' +
        '<td class="num"><input class="inv-price" type="number" min="0" step="0.01" value="' + l.price + '" data-i="' + i + '"></td>' +
        '<td class="num">' + money(l.qty * l.price) + '</td>' +
        '<td class="num no-print"><button class="inv-del" data-i="' + i + '" title="Retirer">&times;</button></td>' +
      '</tr>';
    }).join('');

    var taxLines = '';
    if (taxEnabled) {
      taxLines =
        '<div class="line"><span>TPS (' + co.gstRate + ' %)' + (co.gst ? ' <span class="taxno">' + esc(co.gst) + '</span>' : '') + '</span><span>' + money(t.gst) + '</span></div>' +
        '<div class="line"><span>TVQ (' + co.qstRate + ' %)' + (co.qst ? ' <span class="taxno">' + esc(co.qst) + '</span>' : '') + '</span><span>' + money(t.qst) + '</span></div>';
    }

    var noteVal = elNote.value.trim();
    elInvoice.innerHTML =
      '<div class="inv-top">' +
        '<div class="inv-co">' + (co.logo ? '<img class="inv-logo" src="' + co.logo + '" alt="' + esc(co.name) + '">' : '') +
          '<div class="inv-co-name">' + esc(co.name || 'Entreprise') + '</div>' +
          (co.tagline ? '<div class="inv-co-tag">' + esc(co.tagline) + '</div>' : '') +
          (meta.length ? '<div class="inv-co-meta">' + esc(meta.join('\n')) + '</div>' : '') + '</div>' +
        '<div class="inv-title"><h1>FACTURE</h1><div class="inv-meta">' +
          'N° ' + esc(elNumber.value || '—') + '<br>' + fmtDateFR(elDate.value || todayISO()) + '</div></div>' +
      '</div>' +
      billto + specsBlock +
      '<table class="inv-table"><thead><tr>' +
        '<th>Description</th><th class="num">Qté</th><th class="num">Prix unit.</th><th class="num">Montant</th><th class="no-print"></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="inv-tot">' +
        '<div class="line"><span>Sous-total</span><span>' + money(t.sub) + '</span></div>' +
        taxLines +
        '<div class="line grand"><span>Total</span><span>' + money(t.total) + '</span></div>' +
      '</div>' +
      (noteVal ? '<div class="inv-pay"><span class="lbl">Note</span>' + esc(noteVal) + '</div>' : '') +
      '<div class="inv-foot">Aucun paiement en ligne — ramassage à Québec. Merci de votre confiance&nbsp;!</div>';

    // écouteurs des champs éditables
    $$('.inv-qty', elInvoice).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var l = lines[+this.getAttribute('data-i')]; if (!l) return;
        l.qty = Math.max(0, parseInt(this.value, 10) || 0);
        if (!l.manual) l.price = tierPrice(l.base, l.tiers, l.qty);
        afterChange();
      });
    });
    $$('.inv-price', elInvoice).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var l = lines[+this.getAttribute('data-i')]; if (!l) return;
        l.price = Math.max(0, num(this.value) || 0); l.manual = true;
        afterChange();
      });
    });
    $$('.inv-label', elInvoice).forEach(function (inp) {
      inp.addEventListener('input', function () { var l = lines[+this.getAttribute('data-i')]; if (l) l.label = this.value; });
    });
    $$('.inv-del', elInvoice).forEach(function (b) {
      b.addEventListener('click', function () { lines.splice(+this.getAttribute('data-i'), 1); afterChange(); });
    });

    // marge (privé)
    var mcls = t.margin >= 0 ? 'pos' : 'neg';
    var pct = t.sub > 0 ? Math.round(t.margin / t.sub * 100) : 0;
    elMargin.hidden = false;
    elMargin.innerHTML = '<span class="fx-margin-k">Marge (privé)</span>' +
      '<span class="fx-margin-v ' + mcls + '">' + money(t.margin) + (t.sub > 0 ? ' · ' + pct + '%' : '') + '</span>' +
      '<span class="fx-margin-sub">coût ' + money(t.cost) + '</span>';

    refreshPickerBadges();
  }

  // re-render sur édition des méta-champs
  [elNote, elDate, cxVehicle, cxLitrage, cxEvent, cxFinition].forEach(function (el) {
    if (el) el.addEventListener('input', function () { render(); });
  });
  // champs client : re-render + mémorisation auto du profil Olivier
  [elCliName, elCliContact, elCliAddress, elCliCity].forEach(function (el) {
    if (el) el.addEventListener('input', function () { if (clientType === 'olivier') saveOlivierProfile(); render(); });
  });
  if (elTax) elTax.addEventListener('change', function () { taxEnabled = this.checked; render(); });

  /* ---------- enregistrement ---------- */
  function currentCategory() {
    var set = {}; lines.forEach(function (l) { set[l.ptype] = 1; });
    var keys = Object.keys(set);
    return keys.length === 1 ? keys[0] : (keys.length ? 'mixte' : cat);
  }
  function lock() { saved = true; elSave.disabled = true; elSave.textContent = '✓ Enregistrée'; }
  function unlock() { saved = false; elSave.disabled = false; elSave.textContent = 'Enregistrer la facture'; }

  function onSave() {
    if (saved) return;
    var valid = lines.filter(function (l) { return l.qty > 0; });
    if (!valid.length) { elStatus.textContent = 'Ajoute au moins une ligne (quantité > 0).'; return; }

    elSave.disabled = true; elStatus.textContent = 'Attribution du numéro…';
    var t = totals();
    var specs = specsText();
    var note = elNote.value.trim();
    var fullNote = (specs ? ('Caisson — ' + specs) : '') + ((specs && note) ? '\n' : '') + note;

    // E2 : n° manuel si l'admin a modifié le champ ; sinon numéro auto atomique.
    var manual = (elNumber.value || '').trim();
    var useManual = manual && manual !== lastAutoNumber;
    var numberP = useManual
      ? Promise.resolve(manual)
      : sb.rpc('next_invoice_number').then(function (res) {
          if (res.error || !res.data) throw (res.error || new Error('Numéro indisponible.'));
          return res.data;
        });

    numberP.then(function (number) {
      elNumber.value = number;
      var doDeduct = !!elDeduct.checked;
      var invoice = {
        number: number,
        client_name: elCliName.value.trim() || null,
        client_contact: elCliContact.value.trim() || null,
        client_address: elCliAddress.value.trim() || null,
        client_city: elCliCity.value.trim() || null,
        client_type: clientType,
        category: currentCategory(),
        invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(elDate.value) ? elDate.value : todayISO(),
        note: fullNote || null,
        tax_enabled: taxEnabled,
        subtotal: round2(t.sub), tax_gst: round2(t.gst), tax_qst: round2(t.qst),
        total: round2(t.total), cost_total: round2(t.cost),
        stock_deducted: false, status: 'final'
      };
      elStatus.textContent = 'Enregistrement…';
      return sb.from('invoices').insert(invoice).select().then(function (r2) {
        if (r2.error || !r2.data || !r2.data.length) throw (r2.error || new Error('Enregistrement refusé (permissions).'));
        var inv = r2.data[0];
        var lineRows = valid.map(function (l, i) {
          return { invoice_id: inv.id, product_id: l.productId, label: l.label || null, meta: l.meta || null,
            kind: l.kind, qty: l.qty, unit_price: round2(l.price), unit_cost: round2(l.cost),
            line_total: round2(l.qty * l.price), sort_order: i };
        });
        return sb.from('invoice_lines').insert(lineRows).then(function (r3) {
          if (r3.error) throw r3.error;
          if (!doDeduct) return inv;
          return deductStock(valid).then(function () {
            return sb.from('invoices').update({ stock_deducted: true }).eq('id', inv.id).then(function () { return inv; });
          });
        });
      });
    }).then(function (inv) {
      lock();
      render();
      elStatus.textContent = '✓ Facture ' + inv.number + ' enregistrée' + (elDeduct.checked ? ', stock déduit.' : '.');
      loadNextNumberHint();
      // recharge les stocks du catalogue (badges/plafonds à jour)
      catalogLoaded.filament = false; catalogLoaded.spacer = false;
      if (cat !== 'caisson') loadCatalog(cat);
      if (window.CA.reloadHistorique) window.CA.reloadHistorique();
      if (window.CA.reloadStatistiques) window.CA.reloadStatistiques();
    }, function (err) {
      unlock();
      var msg = (err && err.message) ? err.message : String(err);
      if (/duplicate|unique|23505/i.test(msg)) msg = 'Ce numéro de facture existe déjà. Choisis-en un autre.';
      elStatus.textContent = 'Erreur : ' + msg;
    });
  }
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }
  function deductStock(valid) {
    var calls = valid.filter(function (l) { return l.productId && l.qty > 0; }).map(function (l) {
      return sb.rpc('receive_stock', { p_product: l.productId, p_kind: l.kind === 'refill' ? 'refill' : 'spool', p_qty: -Math.abs(l.qty) });
    });
    return Promise.all(calls);
  }
  if (elSave) elSave.addEventListener('click', onSave);

  /* ---------- réinitialiser ---------- */
  function resetInvoice() {
    lines = []; saved = false; unlock();
    elNote.value = '';
    cxVehicle.value = ''; cxLitrage.value = ''; cxEvent.value = ''; cxFinition.value = '';
    elDate.value = todayISO(); elStatus.textContent = '';
    setClientType('client');   // vide les champs client (le profil Olivier reste mémorisé)
    loadNextNumberHint();
    render();
  }
  if (elReset) elReset.addEventListener('click', resetInvoice);

  /* ---------- impression / copie ---------- */
  if (elPrint) elPrint.addEventListener('click', function () {
    if (!lines.length) return;
    document.body.classList.add('fx-printing');
    window.print();
    setTimeout(function () { document.body.classList.remove('fx-printing'); }, 300);
  });
  function invoiceText() {
    var co = readCompanyForm(), t = totals();
    var L = [];
    L.push(co.name); if (co.tagline) L.push(co.tagline);
    L.push('FACTURE ' + (elNumber.value || '') + '   ' + fmtDateFR(elDate.value || todayISO()));
    var cli = elCliName.value.trim(); if (cli) L.push('Facturé à : ' + cli + (clientType === 'olivier' ? ' (dealer)' : ''));
    if (elCliAddress.value.trim()) L.push(elCliAddress.value.trim());
    if (elCliCity.value.trim()) L.push(elCliCity.value.trim());
    if (elCliContact.value.trim()) L.push(elCliContact.value.trim());
    var specs = specsText(); if (specs) L.push('Caisson — ' + specs);
    L.push('');
    lines.forEach(function (l) { L.push(l.qty + ' × ' + (l.label || '(article)') + (l.meta ? ' (' + l.meta + ')' : '') + '  —  ' + money(l.qty * l.price)); });
    L.push('');
    L.push('Sous-total : ' + money(t.sub));
    if (taxEnabled) { L.push('TPS : ' + money(t.gst)); L.push('TVQ : ' + money(t.qst)); }
    L.push('TOTAL : ' + money(t.total));
    var note = elNote.value.trim(); if (note) { L.push(''); L.push('Note : ' + note); }
    return L.join('\n');
  }
  if (elCopy) elCopy.addEventListener('click', function () {
    if (!lines.length) return;
    var txt = invoiceText(), self = this, old = this.textContent;
    var done = function () { self.textContent = 'Copié ✓'; setTimeout(function () { self.textContent = old; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done); else done();
  });

  /* ---------- envoyer par courriel (mailto pré-rempli) ----------
     Un site statique ne peut pas joindre le PDF automatiquement : on
     ouvre le brouillon (destinataire + objet + résumé texte) ; pour la
     version mise en forme, faire « Imprimer / PDF » puis joindre le fichier. */
  function extractEmail(s) { var m = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(s || ''); return m ? m[0] : ''; }
  if (elEmail) elEmail.addEventListener('click', function () {
    if (!lines.length) { elStatus.textContent = 'Ajoute d\'abord des articles à la facture.'; return; }
    var co = readCompanyForm();
    var email = extractEmail(elCliContact.value);
    var subject = 'Facture ' + (elNumber.value || '') + ' — ' + (co.name || 'Création Audio');
    var body = 'Bonjour' + (elCliName.value.trim() ? ' ' + elCliName.value.trim() : '') + ',\n\n' +
      'Voici votre facture. La version PDF mise en forme est jointe à ce courriel.\n\n' +
      '----------------------------------------\n' + invoiceText() + '\n----------------------------------------\n\n' +
      'Merci !' + (co.name ? '\n' + co.name : '');
    var href = 'mailto:' + encodeURIComponent(email) +
      '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    window.location.href = href;
    elStatus.textContent = email
      ? 'Brouillon ouvert. Pense à joindre le PDF (bouton « Imprimer / PDF ») pour le format exact.'
      : 'Astuce : mets le courriel du client dans « Contact » pour l\'adresser automatiquement.';
  });

  /* ---------- entreprise : sauver / logo ---------- */
  if ($('#co-save')) $('#co-save').addEventListener('click', function () {
    writeCompany();
    var m = $('#co-msg'); m.textContent = 'Enregistré ✓';
    setTimeout(function () { m.textContent = ''; }, 2000);
    render();
  });
  if ($('#co-logo-file')) $('#co-logo-file').addEventListener('change', function () { handleLogoFile(this.files && this.files[0]); });
  if ($('#co-logo-remove')) $('#co-logo-remove').addEventListener('click', function () { logoData = ''; $('#co-logo-file').value = ''; showLogoPreview(); writeCompany(); render(); });

})();
