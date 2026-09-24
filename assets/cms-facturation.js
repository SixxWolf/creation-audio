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
   - Modification d'une facture enregistrée (CA.editInvoice, appelé par
     l'Historique) : rechargée dans l'éditeur, puis RPC update_invoice.
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function norm(s) { return String(s == null ? '' : s).trim(); }
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
  var clientType = 'client';     // 'client' | 'dealer'
  var taxEnabled = false;
  var pickerKind = 'spool';      // filament : bobine | recharge
  var brandFilter = 'all';       // filtre marque (catalogue filament)
  var matFilter = 'all';         // filtre matériau (catalogue filament)
  var lines = [];                // lignes de la facture
  var saved = false;             // verrou anti-double-enregistrement
  var marginShown = false;       // marge/coût masqués par défaut (non mémorisé : re-masqués au rechargement)
  var catalog = { filament: [], spacer: [], accessory: [] };
  var catalogLoaded = { filament: false, spacer: false, accessory: false };
  var lastAutoNumber = '';   // dernier n° auto proposé (E2 : détecte une saisie manuelle)
  var editing = null;        // { id, number } : facture de l'Historique en cours de modification
  var editToken = null;      // chargement en cours d'une facture à modifier (annulé par « Nouvelle facture »)
  var deductBeforeEdit = null;   // état de la case « Déduire le stock » avant la modification

  /* ---------- éléments ---------- */
  var elReset = $('#fx-reset'), elNextHint = $('#fx-nexthint'),
      elTax = $('#fx-tax'),
      elCliName = $('#fx-cli-name'), elCliEmail = $('#fx-cli-email'), elCliPhone = $('#fx-cli-phone'),
      elCliAddress = $('#fx-cli-address'), elCliCity = $('#fx-cli-city'), elCliHint = $('#fx-cli-hint'),
      elDealerField = $('#fx-dealer-field'), elDealerSelect = $('#fx-dealer-select'),
      elClientField = $('#fx-client-field'), elClientSearch = $('#fx-client-search'), elClientResults = $('#fx-client-results'),
      elNumber = $('#fx-number'), elDate = $('#fx-date'), elNote = $('#fx-note'),
      elSearch = $('#fx-search'), elType = $('#fx-type'), elCatalog = $('#fx-catalog'),
      elFilters = $('#fx-filters'), elBrand = $('#fx-brand'), elMaterial = $('#fx-material'),
      elPicker = $('#fx-picker'), elCaisson = $('#fx-caisson'), elFreeBtn = $('#fx-add-free'),
      elInvoice = $('#fx-invoice'), elMargin = $('#fx-margin'),
      elSave = $('#fx-save'), elDeduct = $('#fx-deduct'), elDeductWrap = $('#fx-deduct-wrap'),
      elPrint = $('#fx-print'), elEmail = $('#fx-email'), elCopy = $('#fx-copy'), elStatus = $('#fx-status');
  // specs caisson
  var cxVehicle = $('#cx-vehicle'), cxLitrage = $('#cx-litrage'), cxEvent = $('#cx-event'), cxFinition = $('#cx-finition');
  // bandeau « modification d'une facture enregistrée »
  var elEditBanner = $('#fx-edit-banner'), elEditNum = $('#fx-edit-num'), elEditCancel = $('#fx-edit-cancel');

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
  function filCost(p, kind) {
    // coût moyen réel (CMP, alimenté par les réceptions) prioritaire sur le coût catalogue
    var ac = p && p.attrs && p.attrs.avg_cost;
    if (ac) { var v = kind === 'refill' ? ac.refill : ac.spool; if (v != null && v !== '') return +v; }
    var m = matOf(p); if (m) return (kind === 'refill' ? m.cost_refill : m.cost_spool) || 0;
    return (kind === 'refill' ? p.cost_price_2 : p.cost_price) || 0;
  }
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
    loadCatalog('accessory', true);   // pour le scanner (bobines vides, etc.)
    // carnet clients (autocomplétion) + dealers (menu) — chargés et tenus à jour
    if (window.CA.loadClients) window.CA.loadClients().then(buildClientList, function () {}); else buildClientList();
    if (window.CA.loadDealers) window.CA.loadDealers().then(buildDealerSelect, function () {}); else buildDealerSelect();
    if (window.CA.onClientsChange) window.CA.onClientsChange(buildClientList);
    if (window.CA.onDealersChange) window.CA.onDealersChange(buildDealerSelect);
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
        if (!saved && !editing) elNumber.value = next;   // en modification : on garde le n° de la facture
        elNextHint.textContent = 'Prochaine : ' + next;
      }, function () {});
  }

  // quiet : chargement en arrière-plan (scanner) — ne touche pas au catalogue affiché
  // s'il s'agit d'un autre gabarit que le courant
  function loadCatalog(which, quiet) {
    if (which === 'caisson') return Promise.resolve();
    var shown = !quiet || which === cat;
    if (catalogLoaded[which]) { if (shown) buildPicker(); return Promise.resolve(); }
    if (shown) elCatalog.innerHTML = '<p class="muted">Chargement…</p>';
    return sb.from('products').select('*').eq('type', which)
      .order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) {
        if (res.error) { if (shown) elCatalog.innerHTML = '<p class="empty">Impossible de charger le catalogue.</p>'; return; }
        catalog[which] = res.data || [];
        catalogLoaded[which] = true;
        if (which === cat) buildPicker();
      }, function () { if (shown) elCatalog.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
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

  /* ---------- carnet clients / dealers ---------- */
  function clientFields() {
    return { name: norm(elCliName.value), email: norm(elCliEmail.value), phone: norm(elCliPhone.value),
             address: norm(elCliAddress.value), city: norm(elCliCity.value) };
  }
  function setClientFields(p) {
    p = p || {};
    elCliName.value = p.name || ''; elCliEmail.value = p.email || ''; elCliPhone.value = p.phone || '';
    elCliAddress.value = p.address || ''; elCliCity.value = p.city || '';
  }
  function contactStr() { return [norm(elCliEmail.value), norm(elCliPhone.value)].filter(Boolean).join(' · '); }

  // combobox de recherche client (barre + liste filtrable, comme le catalogue)
  function clientById(id) {
    var list = (window.CA.clients && window.CA.clients.list) || [];
    return list.filter(function (c) { return String(c.id) === String(id); })[0] || null;
  }
  function clientMatches(q) {
    q = norm(q).toLowerCase();
    var list = (window.CA.clients && window.CA.clients.list) || [];
    if (!q) return list.slice(0, 60);
    return list.filter(function (c) {
      return (norm(c.name) + ' ' + norm(c.email) + ' ' + norm(c.phone)).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 60);
  }
  function hideClientResults() { if (elClientResults) elClientResults.hidden = true; }
  function renderClientResults() {
    if (!elClientResults) return;
    var rows = clientMatches(elClientSearch ? elClientSearch.value : '');
    if (!rows.length) {
      elClientResults.innerHTML = '<div class="fx-combo-empty">Aucun client trouvé. Remplis les champs pour en créer un.</div>';
    } else {
      elClientResults.innerHTML = rows.map(function (c) {
        var ct = [c.email, c.phone].filter(Boolean).join(' · ');
        var loc = [c.address, c.city].filter(Boolean).join(', ');
        var sub = [ct, loc].filter(Boolean).join(' — ');
        return '<button type="button" class="fx-combo-item" data-id="' + esc(c.id) + '">' +
          '<span class="nm">' + esc(c.name) + '</span>' +
          (sub ? '<span class="ct">' + esc(sub) + '</span>' : '') + '</button>';
      }).join('');
      $$('.fx-combo-item', elClientResults).forEach(function (b) {
        // mousedown : sélectionne AVANT le blur de la barre de recherche
        b.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var c = clientById(b.getAttribute('data-id'));
          if (c) selectClient(c);
        });
      });
    }
    elClientResults.hidden = false;
  }
  function selectClient(c) {
    setClientFields({ name: c.name || '', email: c.email || '', phone: c.phone || '', address: c.address || '', city: c.city || '' });
    if (elClientSearch) elClientSearch.value = '';
    hideClientResults();
    if (saved) unlock();
    render();
  }
  // rafraîchit la liste ouverte quand le carnet change / se charge
  function buildClientList() { if (elClientResults && !elClientResults.hidden) renderClientResults(); }
  if (elClientSearch) {
    elClientSearch.addEventListener('input', renderClientResults);
    elClientSearch.addEventListener('focus', renderClientResults);
    elClientSearch.addEventListener('blur', function () { setTimeout(hideClientResults, 150); });
    elClientSearch.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideClientResults(); });
  }
  // remplit les coordonnées quand le nom saisi correspond exactement à un client connu
  function autofillClientByName() {
    if (clientType !== 'client') return;
    var name = norm(elCliName.value).toLowerCase();
    if (!name) return;
    var list = (window.CA.clients && window.CA.clients.list) || [];
    var c = list.filter(function (x) { return norm(x.name).toLowerCase() === name; })[0];
    if (!c) return;
    elCliEmail.value = c.email || ''; elCliPhone.value = c.phone || '';
    elCliAddress.value = c.address || ''; elCliCity.value = c.city || '';
    if (saved) unlock();
    render();
  }

  // menu déroulant des dealers (table dealers)
  function buildDealerSelect() {
    if (!elDealerSelect) return;
    var list = (window.CA.dealers && window.CA.dealers.list) || [];
    var cur = elDealerSelect.value;
    elDealerSelect.innerHTML = '<option value="">— choisir un dealer —</option>' +
      list.map(function (d) { return '<option value="' + esc(d.email) + '">' + esc(d.name || d.email) + '</option>'; }).join('');
    if (cur) elDealerSelect.value = cur;
  }
  function dealerByEmail(email) {
    var list = (window.CA.dealers && window.CA.dealers.list) || [];
    return list.filter(function (d) { return d.email === email; })[0] || null;
  }
  if (elDealerSelect) elDealerSelect.addEventListener('change', function () {
    var d = dealerByEmail(this.value);
    if (!d) return;
    setClientFields({ name: d.name || d.email || '', email: d.email || '', phone: d.phone || '', address: d.address || '', city: d.city || '' });
    if (saved) unlock();
    render();
  });

  function setClientType(type, keepFields) {
    clientType = type === 'dealer' ? 'dealer' : 'client';
    $$('.fx-cli-btn').forEach(function (x) {
      var v = x.getAttribute('data-cli');
      x.classList.toggle('is-active', v === clientType);
    });
    var isDlr = clientType === 'dealer';
    if (elDealerField) elDealerField.hidden = !isDlr;
    if (elClientField) elClientField.hidden = isDlr;
    if (elClientSearch) elClientSearch.value = '';
    hideClientResults();
    if (!keepFields) {
      setClientFields({});
      if (elDealerSelect) elDealerSelect.value = '';
      if (elCliHint) elCliHint.textContent = isDlr ? 'Choisis un dealer — ses coordonnées et les prix dealer s\'appliquent.' : '';
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
    var catLabel = { filament: 'filament', spacer: 'spacer', accessory: 'accessoire' }[cat] || cat;
    if (!items.length) { elCatalog.innerHTML = '<p class="empty">Aucun ' + catLabel + ' dans le catalogue.</p>'; return; }

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
    } else if (cat === 'spacer') {
      elCatalog.innerHTML = '<div class="pk-grid pk-grid-cards">' + items.map(function (p) {
        var url = publicUrl(p.image_path);
        return '<button type="button" class="pk-cell pk-card" data-id="' + esc(p.id) + '" data-search="' +
          esc((p.name || '').toLowerCase()) + '">' +
          (url ? '<img class="pk-img" src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="pk-img pk-noimg"></span>') +
          '<span class="pk-name">' + esc(p.name) + '</span>' +
          '<span class="pk-price">' + money(isDealer() ? (p.dealer_price != null ? p.dealer_price : p.sell_price) : p.sell_price) + '</span>' +
          '<span class="pk-badge"></span></button>';
      }).join('') + '</div>';
    } else { // accessory
      elCatalog.innerHTML = '<div class="pk-grid pk-grid-cards">' + items.map(function (p) {
        var url = publicUrl(p.image_path);
        return '<button type="button" class="pk-cell pk-card" data-id="' + esc(p.id) + '" data-search="' +
          esc((p.name || '').toLowerCase()) + '">' +
          (url ? '<img class="pk-img" src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="pk-img pk-noimg"></span>') +
          '<span class="pk-name">' + esc(p.name) + '</span>' +
          '<span class="pk-price">' + money(p.sell_price) + '</span>' +
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

  function isDealer() { return clientType === 'dealer'; }
  // spacer : prix client (à plat) OU prix dealer (+ rabais quantité) selon le type de client
  function spacerDual(p) { return { client: +p.sell_price || 0, dealer: +(p.dealer_price != null ? p.dealer_price : p.sell_price) || 0, tiers: p.tiers || [] }; }

  // c : gabarit du produit (par défaut le gabarit courant ; le scanner le force)
  function addProduct(id, c) {
    c = c || cat;
    var p = c === cat ? prodById(id) : prodInCatalog(c, id);
    if (!p) return 0;
    var kind, label, meta, base, cost, tiers, hex = null, ptype = c, sp = null, matKey = null;
    if (c === 'filament') {
      kind = pickerKind;
      base = filBase(p, kind); cost = filCost(p, kind); tiers = filTiers(p, kind);
      label = p.name; hex = p.hex;
      matKey = (p.brand || '') + '|' + (p.material || '');   // rabais quantité cumulé par matériau+format
      meta = [p.brand, p.material, (kind === 'refill' ? 'Recharge' : 'Avec bobine')].filter(Boolean).join(' · ');
    } else if (c === 'accessory') {
      kind = 'unit';
      base = p.sell_price; tiers = [];
      // coût moyen réel (réceptions) prioritaire sur le coût catalogue
      var acI = p.attrs && p.attrs.avg_cost && p.attrs.avg_cost.item;
      cost = (acI != null && acI !== '') ? +acI : p.cost_price;
      label = p.name; meta = 'Accessoire';
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
        hex: hex, qty: 1, base: +base || 0, tiers: tiers || [], cost: +cost || 0, matKey: matKey,
        price: tierPrice(base, tiers, 1), manual: false, sp: sp });
    }
    afterChange();
    return ex ? ex.qty : 1;
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
  // Rabais quantité : pour les FILAMENTS, le palier se calcule sur le TOTAL des
  // quantités du même matériau + format (toutes couleurs confondues), puis
  // s'applique à chaque ligne. Spacer/accessoire restent tarifés par ligne.
  function repriceLines() {
    var totals = {};
    lines.forEach(function (l) {
      if (l.ptype === 'filament' && l.matKey) {
        var g = l.matKey + '|' + l.kind;
        totals[g] = (totals[g] || 0) + (l.qty | 0);
      }
    });
    lines.forEach(function (l) {
      if (l.manual) return;   // prix forcé à la main : on ne touche pas
      if (l.ptype === 'filament' && l.matKey) {
        l.price = tierPrice(l.base, l.tiers, totals[l.matKey + '|' + l.kind] || (l.qty | 0));
      } else {
        l.price = tierPrice(l.base, l.tiers, l.qty);
      }
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

  // catégorie d'une ligne libre (pour les statistiques « Ventes par gabarit »)
  var PTYPE_OPTS = [['filament', 'Filament'], ['spacer', 'Spacer'], ['accessory', 'Accessoire'], ['caisson', 'Caisson'], ['divers', 'Divers']];
  function catOptions(sel) {
    return PTYPE_OPTS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  }

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
    repriceLines();   // applique le rabais quantité (cumulé par matériau pour les filaments)
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

    var cliName = elCliName.value.trim(), cliContact = contactStr(),
        cliAddress = elCliAddress.value.trim(), cliCity = elCliCity.value.trim();
    var cliTag = clientType === 'dealer' ? ' <span class="inv-cli-tag">Dealer</span>' : '';
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
        ? '<input class="inv-label" type="text" value="' + esc(l.label) + '" data-i="' + i + '" placeholder="Description">' +
          '<select class="inv-cat no-print" data-i="' + i + '" title="Catégorie (pour les statistiques)">' + catOptions(l.ptype || 'divers') + '</select>'
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
        afterChange();   // render() -> repriceLines() applique le palier (cumulé par matériau)
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
    $$('.inv-cat', elInvoice).forEach(function (sel) {
      sel.addEventListener('change', function () { var l = lines[+this.getAttribute('data-i')]; if (l) { l.ptype = this.value; afterChange(); } });
    });
    $$('.inv-del', elInvoice).forEach(function (b) {
      b.addEventListener('click', function () { lines.splice(+this.getAttribute('data-i'), 1); afterChange(); });
    });

    // marge (privé) : masquée par défaut (client devant l'écran), un clic l'affiche / la masque
    var mcls = t.margin >= 0 ? 'pos' : 'neg';
    var pct = t.sub > 0 ? Math.round(t.margin / t.sub * 100) : 0;
    elMargin.hidden = false;
    elMargin.classList.toggle('is-masked', !marginShown);
    elMargin.innerHTML = '<span class="fx-margin-k">Marge (privé)</span>' +
      (marginShown
        ? '<span class="fx-margin-v ' + mcls + '">' + money(t.margin) + (t.sub > 0 ? ' · ' + pct + '%' : '') + '</span>' +
          '<span class="fx-margin-sub">coût ' + money(t.cost) + '</span>'
        : '<span class="fx-margin-v fx-margin-hidden" aria-label="masquée">•••••</span>') +
      '<button type="button" class="btn btn-ghost btn-sm fx-margin-toggle" aria-pressed="' + marginShown + '">' +
        (marginShown ? 'Masquer' : 'Afficher') + '</button>';

    refreshPickerBadges();
  }

  // re-render sur édition des méta-champs
  [elNote, elDate, cxVehicle, cxLitrage, cxEvent, cxFinition].forEach(function (el) {
    if (el) el.addEventListener('input', function () { render(); });
  });
  // champs client : re-render ; le nom déclenche l'autocomplétion depuis le carnet
  [elCliName, elCliEmail, elCliPhone, elCliAddress, elCliCity].forEach(function (el) {
    if (el) el.addEventListener('input', function () { render(); });
  });
  if (elCliName) elCliName.addEventListener('change', autofillClientByName);
  if (elTax) elTax.addEventListener('change', function () { taxEnabled = this.checked; render(); });
  if (elMargin) elMargin.addEventListener('click', function (e) {
    if (!e.target.closest('.fx-margin-toggle')) return;
    marginShown = !marginShown; render();
  });

  /* ---------- enregistrement ---------- */
  function currentCategory() {
    var set = {}; lines.forEach(function (l) { set[l.ptype] = 1; });
    var keys = Object.keys(set);
    return keys.length === 1 ? keys[0] : (keys.length ? 'mixte' : cat);
  }
  function unlock() {
    saved = false; elSave.disabled = false;
    elSave.textContent = editing ? 'Enregistrer les modifications' : 'Enregistrer la facture';
  }

  // en-tête commun (création ET modification) — le n° et le statut sont gérés à part
  function invoiceFields(t) {
    var specs = specsText();
    var note = elNote.value.trim();
    var fullNote = (specs ? ('Caisson — ' + specs) : '') + ((specs && note) ? '\n' : '') + note;
    return {
      client_name: elCliName.value.trim() || null,
      client_contact: contactStr() || null,
      client_address: elCliAddress.value.trim() || null,
      client_city: elCliCity.value.trim() || null,
      client_type: clientType,
      category: currentCategory(),
      invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(elDate.value) ? elDate.value : todayISO(),
      note: fullNote || null,
      tax_enabled: taxEnabled,
      subtotal: round2(t.sub), tax_gst: round2(t.gst), tax_qst: round2(t.qst),
      total: round2(t.total), cost_total: round2(t.cost)
    };
  }
  function lineRow(l, i) {
    return { product_id: l.productId, label: l.label || null, meta: l.meta || null,
      kind: l.kind, ptype: l.ptype || null, qty: l.qty, unit_price: round2(l.price), unit_cost: round2(l.cost),
      line_total: round2(l.qty * l.price), sort_order: i };
  }
  // après un enregistrement : stocks du catalogue, historique et statistiques à jour
  function refreshAfterSave() {
    catalogLoaded.filament = false; catalogLoaded.spacer = false;
    if (cat !== 'caisson') loadCatalog(cat);
    if (window.CA.reloadHistorique) window.CA.reloadHistorique();
    if (window.CA.reloadStatistiques) window.CA.reloadStatistiques();
  }
  function statusButton(label, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost btn-sm';
    b.textContent = label;
    b.addEventListener('click', onClick);
    elStatus.appendChild(b);
  }

  function onSave() {
    if (saved) return;
    if (editing) { onSaveEdit(); return; }
    var valid = lines.filter(function (l) { return l.qty > 0; });
    if (!valid.length) { elStatus.textContent = 'Ajoute au moins une ligne (quantité > 0).'; return; }

    saved = true;   // verrou pendant l'envoi (anti double-clic)
    elSave.disabled = true; elStatus.textContent = 'Attribution du numéro…';
    var t = totals();

    // E2 : n° manuel si l'admin a modifié le champ ; sinon numéro auto atomique.
    var manual = (elNumber.value || '').trim();
    var useManual = manual && manual !== lastAutoNumber;
    var numberP = useManual
      ? Promise.resolve(manual)
      : sb.rpc('next_invoice_number').then(function (res) {
          if (res.error || !res.data) throw (res.error || new Error('Numéro indisponible.'));
          return res.data;
        });

    var savedRows = [];
    numberP.then(function (number) {
      elNumber.value = number;
      var doDeduct = !!elDeduct.checked;
      var invoice = invoiceFields(t);
      invoice.number = number;
      invoice.stock_deducted = false; invoice.status = 'final';
      elStatus.textContent = 'Enregistrement…';
      return sb.from('invoices').insert(invoice).select().then(function (r2) {
        if (r2.error || !r2.data || !r2.data.length) throw (r2.error || new Error('Enregistrement refusé (permissions).'));
        var inv = r2.data[0];
        var lineRows = valid.map(function (l, i) { var r = lineRow(l, i); r.invoice_id = inv.id; return r; });
        savedRows = lineRows;
        return sb.from('invoice_lines').insert(lineRows).select('id,sort_order').then(function (r3) {
          if (r3.error) throw r3.error;
          if (!doDeduct) return inv;
          return deductStock(valid, r3.data || []).then(function () {
            return sb.from('invoices').update({ stock_deducted: true }).eq('id', inv.id).then(function () { return inv; });
          });
        });
      });
    }).then(function (inv) {
      // auto-mémorisation du client (mode client seulement ; les dealers = onglet Dealers)
      if (clientType === 'client' && window.CA.rememberClient && norm(elCliName.value)) {
        window.CA.rememberClient(clientFields());
      }
      var deducted = !!elDeduct.checked;
      // la vente est enregistrée : on repart d'une facture vierge (réimpression possible ci-dessous ou dans l'Historique)
      resetInvoice();
      elStatus.textContent = '✓ Facture ' + inv.number + ' enregistrée' + (deducted ? ', stock déduit' : '') + '. Nouvelle facture prête. ';
      if (window.CA.printInvoice) statusButton('Imprimer ' + inv.number, function () { window.CA.printInvoice(inv, savedRows); });
      refreshAfterSave();
    }, function (err) {
      unlock();
      var msg = (err && err.message) ? err.message : String(err);
      if (/duplicate|unique|23505/i.test(msg)) msg = 'Ce numéro de facture existe déjà. Choisis-en un autre.';
      elStatus.textContent = 'Erreur : ' + msg;
    });
  }

  // Modification d'une facture de l'Historique : tout passe par la RPC update_invoice
  // (une seule transaction) : stock d'origine remis, lignes remplacées, nouveau stock
  // déduit si la case est cochée, en-tête mis à jour. Même id, même n° (modifiable).
  function onSaveEdit() {
    var valid = lines.filter(function (l) { return l.qty > 0; });
    if (!valid.length) { elStatus.textContent = 'Ajoute au moins une ligne (quantité > 0).'; return; }
    var ed = editing;
    saved = true;   // verrou pendant l'envoi (anti double-clic)
    elSave.disabled = true; elStatus.textContent = 'Enregistrement des modifications…';
    var fields = invoiceFields(totals());
    fields.number = norm(elNumber.value) || ed.number;
    var lineRows = valid.map(lineRow);
    var deduct = !!elDeduct.checked;
    sb.rpc('update_invoice', { p_id: ed.id, p_invoice: fields, p_lines: lineRows, p_deduct: deduct }).then(function (res) {
      if (res.error) throw res.error;
      var inv = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!inv || !inv.id) throw new Error('Modification refusée (permissions).');
      return inv;
    }).then(function (inv) {
      if (clientType === 'client' && window.CA.rememberClient && norm(elCliName.value)) {
        window.CA.rememberClient(clientFields());
      }
      resetInvoice();
      elStatus.textContent = '✓ Facture ' + inv.number + ' mise à jour' + (deduct ? ', stock ajusté' : '') + '. ';
      if (window.CA.printInvoice) statusButton('Imprimer ' + inv.number, function () { window.CA.printInvoice(inv, lineRows); });
      statusButton('Voir dans l\'historique', function () {
        if (window.CA.focusInvoice) window.CA.focusInvoice(inv.id);
        location.hash = '#historique';
      });
      refreshAfterSave();
    }, function (err) {
      unlock();
      var msg = (err && err.message) ? err.message : String(err);
      if (/duplicate|unique|23505/i.test(msg)) msg = 'Ce numéro de facture existe déjà. Choisis-en un autre.';
      else if (/PGRST202|could not find the function/i.test(((err && err.code) || '') + ' ' + msg)) msg = 'Fonction update_invoice absente : relance schema-v2.sql dans Supabase.';
      elStatus.textContent = 'Erreur : ' + msg;
    });
  }
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }
  // Déduit le stock ligne par ligne. deduct_stock renvoie la quantité RÉELLEMENT retirée
  // (stock borné à 0) -> mémorisée dans invoice_lines.qty_deducted pour qu'une annulation
  // ne remette que ça (vendre à stock 0 puis annuler ne doit pas créer de stock fantôme).
  // Repli sur receive_stock si schema-v2.sql n'a pas encore été relancé.
  function deductStock(valid, savedLines) {
    var idBySort = {};
    savedLines.forEach(function (r) { idBySort[r.sort_order] = r.id; });
    var calls = valid.map(function (l, i) {
      if (!l.productId || !(l.qty > 0)) return null;
      var args = { p_product: l.productId, p_kind: l.kind === 'refill' ? 'refill' : 'spool', p_qty: Math.abs(l.qty) };
      return sb.rpc('deduct_stock', args).then(function (res) {
        if (res && res.error) {
          if (!/PGRST202|could not find the function/i.test((res.error.code || '') + ' ' + (res.error.message || ''))) throw res.error;
          args.p_qty = -args.p_qty;   // ancienne RPC (pas de suivi de la quantité retirée)
          return sb.rpc('receive_stock', args).then(function (r2) { if (r2 && r2.error) throw r2.error; });   // ne PAS masquer une erreur RPC
        }
        var taken = +res.data || 0;
        if (idBySort[i] == null) return;
        return sb.from('invoice_lines').update({ qty_deducted: taken }).eq('id', idBySort[i])
          .then(function (r3) { if (r3 && r3.error) throw r3.error; });
      });
    }).filter(Boolean);
    return Promise.all(calls);
  }
  if (elSave) elSave.addEventListener('click', onSave);

  /* ---------- réinitialiser ---------- */
  function resetInvoice() {
    if (editing && deductBeforeEdit != null) elDeduct.checked = deductBeforeEdit;   // case « Déduire » d'avant la modification
    deductBeforeEdit = null;
    setEditing(null);
    lines = []; saved = false; unlock();
    elNote.value = '';
    cxVehicle.value = ''; cxLitrage.value = ''; cxEvent.value = ''; cxFinition.value = '';
    elDate.value = todayISO(); elStatus.textContent = '';
    setClientType('client');   // vide les champs client (le profil dealer reste mémorisé)
    loadNextNumberHint();
    render();
  }
  // en modification : quitter = abandonner les changements (la facture enregistrée reste intacte)
  function confirmLeaveEdit() {
    return !editing || !lines.length ||
      window.confirm('Abandonner la modification de la facture ' + (editing.number || '') + ' ?\nLa facture enregistrée reste inchangée.');
  }
  if (elReset) elReset.addEventListener('click', function () { if (confirmLeaveEdit()) resetInvoice(); });
  if (elEditCancel) elEditCancel.addEventListener('click', function () {
    if (!confirmLeaveEdit()) return;
    var id = editing && editing.id;
    resetInvoice();
    if (id && window.CA.focusInvoice) window.CA.focusInvoice(id);
    location.hash = '#historique';
  });

  /* ---------- modifier une facture enregistrée (bouton « Modifier » de l'Historique) ---------- */
  function setEditing(ed) {
    editing = ed;
    if (!ed) editToken = null;
    if (elEditBanner) elEditBanner.hidden = !ed;
    if (elEditNum) elEditNum.textContent = ed ? (ed.number || '') : '';
    if (elNextHint) elNextHint.hidden = !!ed;
    unlock();
  }
  // « Caisson — Véhicule : … · Litrage : …\nnote » -> champs caisson + note (inverse d'invoiceFields).
  // Format inattendu : la note est gardée telle quelle (rien n'est perdu).
  var CX_KEYS = { 'Véhicule': 'vehicle', 'Litrage': 'litrage', 'Évent': 'event', 'Finition': 'finition' };
  function splitNote(s) {
    s = String(s == null ? '' : s);
    var m = /^Caisson — ([^\n]*)(?:\n([\s\S]*))?$/.exec(s);
    if (!m) return { note: s, cx: {} };
    var cx = {}, ok = true;
    m[1].split(' · ').forEach(function (part) {
      var mm = /^(Véhicule|Litrage|Évent|Finition) : (.*)$/.exec(part);
      if (mm && cx[CX_KEYS[mm[1]]] == null) cx[CX_KEYS[mm[1]]] = mm[2]; else ok = false;
    });
    return ok ? { note: m[2] || '', cx: cx } : { note: s, cx: {} };
  }
  // « courriel · téléphone » (contactStr) -> deux champs
  function splitContact(s) {
    var email = '', rest = [];
    String(s || '').split(' · ').forEach(function (p) {
      p = norm(p); if (!p) return;
      if (!email && p.indexOf('@') !== -1) email = p; else rest.push(p);
    });
    return { email: email, phone: rest.join(' · ') };
  }
  function findProduct(id) {
    var kinds = ['filament', 'spacer', 'accessory'];
    for (var k = 0; k < kinds.length; k++) { var p = prodInCatalog(kinds[k], id); if (p) return { p: p, c: kinds[k] }; }
    return null;
  }
  // ligne enregistrée -> ligne éditable. Le prix ET le coût d'origine sont conservés
  // (la marge historique ne bouge pas) ; le tarif catalogue ne sert qu'aux paliers.
  function lineFromSaved(s) {
    var kind = s.kind || 'spool';
    var hit = (s.product_id && kind !== 'free') ? findProduct(s.product_id) : null;
    // ancienne ligne sans catégorie : même repli que les Statistiques (lineCat)
    var ptype = s.ptype || (hit ? hit.c
      : (kind === 'spool' || kind === 'refill') ? 'filament'
      : kind === 'unit' ? (/accessoire/i.test(s.meta || '') ? 'accessory' : 'spacer')
      : 'divers');
    var l = { id: uid(), productId: s.product_id ? String(s.product_id) : null, ptype: ptype, kind: kind,
      label: s.label || '', meta: s.meta || '', hex: null, qty: +s.qty || 0, base: +s.unit_price || 0, tiers: [],
      cost: +s.unit_cost || 0, matKey: null, price: +s.unit_price || 0, manual: true, sp: null, live: false };
    if (hit) {
      var p = hit.p;
      if (hit.c === 'filament') {
        l.base = +filBase(p, kind) || 0; l.tiers = filTiers(p, kind) || []; l.hex = p.hex;
        l.matKey = (p.brand || '') + '|' + (p.material || '');
      } else if (hit.c === 'spacer') {
        l.sp = spacerDual(p); l.base = isDealer() ? l.sp.dealer : l.sp.client; l.tiers = isDealer() ? l.sp.tiers : [];
      } else {
        l.base = +p.sell_price || 0;
      }
      l.live = true;
    }
    return l;
  }
  // Une ligne dont le prix enregistré = le tarif actuel (paliers compris) redevient
  // « vivante » (le palier suit la quantité, comme sur une nouvelle facture). Sinon
  // (prix forcé à la main, tarif changé depuis…) le prix d'origine reste verrouillé.
  function settleLoadedPrices() {
    var keep = lines.map(function (l) { return l.price; });
    lines.forEach(function (l) { if (l.live) l.manual = false; });
    repriceLines();
    lines.forEach(function (l, i) {
      if (!l.manual && Math.abs(l.price - keep[i]) > 0.005) { l.manual = true; l.price = keep[i]; }
      delete l.live;
    });
  }
  function fillFromInvoice(inv, savedLines) {
    var dealer = inv.client_type === 'dealer';
    setClientType(dealer ? 'dealer' : 'client', true);
    var ct = splitContact(inv.client_contact);
    setClientFields({ name: inv.client_name || '', email: ct.email, phone: ct.phone,
      address: inv.client_address || '', city: inv.client_city || '' });
    if (elDealerSelect) { var d = dealer ? dealerByEmail(ct.email) : null; elDealerSelect.value = d ? d.email : ''; }
    if (elCliHint) elCliHint.textContent = '';
    var n = splitNote(inv.note);
    elNote.value = n.note;
    cxVehicle.value = n.cx.vehicle || ''; cxLitrage.value = n.cx.litrage || '';
    cxEvent.value = n.cx.event || ''; cxFinition.value = n.cx.finition || '';
    elNumber.value = inv.number || '';
    elDate.value = inv.invoice_date || todayISO();
    taxEnabled = !!inv.tax_enabled; if (elTax) elTax.checked = taxEnabled;
    elDeduct.checked = !!inv.stock_deducted;
    lines = (savedLines || []).slice()
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
      .map(lineFromSaved);
    settleLoadedPrices();
    var c = inv.category;
    if (['filament', 'spacer', 'accessory', 'caisson'].indexOf(c) === -1) {
      c = (lines[0] && ['filament', 'spacer', 'accessory', 'caisson'].indexOf(lines[0].ptype) !== -1) ? lines[0].ptype : 'filament';
    }
    setCat(c);
    unlock();
    elStatus.textContent = '';
    render();
  }
  // Appelé par l'Historique. Renvoie false si l'admin refuse de remplacer la facture
  // en cours ; sinon charge (catalogues -> tarifs/paliers) puis remplit l'éditeur.
  window.CA.editInvoice = function (inv, savedLines) {
    if (!inv || !inv.id) return false;
    if (inv.status === 'cancelled') { window.alert('Une facture annulée ne peut pas être modifiée.'); return false; }
    if (editing && editing.id === inv.id) return true;   // déjà ouverte
    if (lines.length && !window.confirm(editing
        ? 'Abandonner la modification de la facture ' + (editing.number || '') + ' ?'
        : 'La facture en cours (non enregistrée) sera remplacée. Continuer ?')) return false;
    ensureLoad();
    if (!editing) deductBeforeEdit = elDeduct.checked;
    lines = [];
    setEditing({ id: inv.id, number: inv.number || '' });
    var token = {}; editToken = token;
    elInvoice.innerHTML = '<p class="inv-empty">Chargement de la facture ' + esc(inv.number || '') + '…</p>';
    elMargin.hidden = true; elStatus.textContent = '';
    elSave.disabled = true;   // réactivé une fois la facture chargée
    Promise.resolve(window.CA.loadMaterials ? window.CA.loadMaterials() : null).then(null, function () {})
      .then(function () { return Promise.all([loadCatalog('filament', true), loadCatalog('spacer', true), loadCatalog('accessory', true)]); })
      .then(function () { if (editToken === token) fillFromInvoice(inv, savedLines); });
    return true;
  };

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
    var cli = elCliName.value.trim(); if (cli) L.push('Facturé à : ' + cli + (clientType === 'dealer' ? ' (dealer)' : ''));
    if (elCliAddress.value.trim()) L.push(elCliAddress.value.trim());
    if (elCliCity.value.trim()) L.push(elCliCity.value.trim());
    if (contactStr()) L.push(contactStr());
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
    var email = norm(elCliEmail.value) || extractEmail(contactStr());
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
      : 'Astuce : remplis le champ « Courriel » du client pour l\'adresser automatiquement.';
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

  /* =========================================================
     SCANNER — toujours à l'écoute dans l'onglet Facturation
     - Pas de bouton ni de case : un scanner code-barres (clavier HID)
       tape très vite puis Entrée. On détecte cette rafale au niveau du
       document, même si le curseur est dans un champ (les caractères
       scannés en sont alors retirés). Chaque code ajoute le bon filament
       (bon format). Code inconnu : panneau d'apprentissage
       (products.attrs.barcodes).
     ========================================================= */

  /* ----- éléments ----- */
  var elScanFeedback = $('#fx-scan-feedback'),
      elScanLearn = $('#fx-scan-learn'), elScanLearnCode = $('#fx-scan-learn-code'),
      elScanLearnFil = $('#fx-scan-learn-fil'), elScanLearnKind = $('#fx-scan-learn-kind'),
      elScanLearnSave = $('#fx-scan-learn-save'), elScanLearnCancel = $('#fx-scan-learn-cancel'),
      elPosStation = $('#fx-pos');

  var learnOpen = false, pendingCode = '';
  var SCAN_IDLE = '⌁ Scanner prêt';
  var feedbackTimer = null;

  function scanFeedback(msg, cls) {
    if (!elScanFeedback) return;
    clearTimeout(feedbackTimer);
    elScanFeedback.textContent = msg || SCAN_IDLE;
    elScanFeedback.className = 'fx-scan-feedback no-print' + (cls ? ' ' + cls : '');
    // retour à l'indicateur discret après quelques secondes (sauf pendant une association)
    if (msg && !learnOpen) feedbackTimer = setTimeout(function () { scanFeedback('', ''); }, 6000);
  }
  scanFeedback('', '');

  function facturationVisible() {
    var app = $('#app'), panel = $('[data-panel="facturation"]');
    return !!(app && !app.hidden && panel && !panel.hidden);
  }
  function isEditable(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName;
    return (t === 'INPUT' && !/^(checkbox|radio|button|submit)$/i.test(el.type || '')) || t === 'TEXTAREA';
  }

  // Détection d'une rafale scanner : >= 6 caractères à moins de ~50 ms d'écart, puis Entrée/Tab.
  var SCAN_GAP = 50, SCAN_MIN = 6;
  var buf = '', lastT = 0, bufTarget = null;
  document.addEventListener('keydown', function (e) {
    if (!facturationVisible() || e.ctrlKey || e.metaKey || e.altKey) return;
    var now = Date.now();
    if (e.key === 'Enter' || e.key === 'Tab') {
      var code = buf, target = bufTarget, fresh = (now - lastT) <= SCAN_GAP * 2;
      buf = ''; bufTarget = null;
      if (code.length < SCAN_MIN || !fresh) return;
      e.preventDefault(); e.stopPropagation();
      // les caractères sont déjà tombés dans le champ actif : on les retire
      if (isEditable(target)) {
        var v = target.value || '', i = v.lastIndexOf(code);
        if (i !== -1) {
          target.value = v.slice(0, i) + v.slice(i + code.length);
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      processScan(code.trim());
      return;
    }
    if (e.key.length !== 1) return;              // Maj, flèches, etc.
    if (now - lastT > SCAN_GAP) { buf = ''; bufTarget = e.target; }
    buf += e.key; lastT = now;
  }, true);

  function findByBarcode(code) {
    var fils = catalog.filament || [];
    for (var i = 0; i < fils.length; i++) {
      var b = fils[i].attrs && fils[i].attrs.barcodes;
      if (!b) continue;
      if (b.spool && String(b.spool) === code) return { p: fils[i], kind: 'spool' };
      if (b.refill && String(b.refill) === code) return { p: fils[i], kind: 'refill' };
    }
    // accessoires (bobines vides, etc.) : un seul code par article -> attrs.barcodes.item
    var accs = catalog.accessory || [];
    for (var j = 0; j < accs.length; j++) {
      var a = accs[j].attrs && accs[j].attrs.barcodes;
      if (a && a.item && String(a.item) === code) return { p: accs[j], kind: 'item' };
    }
    return null;
  }

  function scanAdd(hit) {
    if (hit.kind === 'item') {
      var n = addProduct(String(hit.p.id), 'accessory');
      return { qty: n, label: hit.p.name };
    }
    return { qty: scanAddFilament(hit.p, hit.kind), label: hit.p.name + ' · ' + (hit.kind === 'refill' ? 'recharge' : 'bobine') };
  }

  function processScan(code) {
    if (!code) return;
    if (!catalogLoaded.filament || !catalogLoaded.accessory) {
      scanFeedback('Chargement du catalogue… rescanne dans un instant.', 'warn');
      loadCatalog('filament', true); loadCatalog('accessory', true); return;
    }
    var hit = findByBarcode(code);
    if (!hit) { openLearn(code); return; }
    var r = scanAdd(hit);
    scanFeedback('✓ ' + r.label + '  (×' + r.qty + ')', 'ok');
  }

  // ajoute (ou incrémente) une ligne filament pour un format donné — indépendant du gabarit courant
  function scanAddFilament(p, kind) {
    var base = filBase(p, kind), cost = filCost(p, kind), tiers = filTiers(p, kind);
    var meta = [p.brand, p.material, (kind === 'refill' ? 'Recharge' : 'Avec bobine')].filter(Boolean).join(' · ');
    var ex = lines.filter(function (l) { return l.productId === String(p.id) && l.kind === kind && !l.manual; })[0];
    if (ex) { ex.qty += 1; ex.price = tierPrice(ex.base, ex.tiers, ex.qty); }
    else {
      lines.push({ id: uid(), productId: String(p.id), ptype: 'filament', kind: kind, label: p.name,
        meta: meta, hex: p.hex, qty: 1, base: +base || 0, tiers: tiers || [], cost: +cost || 0,
        matKey: (p.brand || '') + '|' + (p.material || ''),
        price: tierPrice(base, tiers, 1), manual: false, sp: null });
    }
    afterChange();
    return (ex ? ex.qty : 1);
  }

  /* ----- apprentissage d'un code inconnu (mémorisé dans attrs.barcodes) ----- */
  // valeurs : "filament:<id>" ou "accessory:<id>"
  function learnOptions() {
    var fils = (catalog.filament || []).slice().sort(function (a, b) {
      return ((a.brand || '') + (a.material || '') + (a.name || '')).localeCompare((b.brand || '') + (b.material || '') + (b.name || ''));
    });
    var accs = (catalog.accessory || []).slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    function accLabel(p) {
      // deux accessoires peuvent porter le même nom : on ajoute la description pour les distinguer
      var d = p.attrs && p.attrs.description;
      var dup = accs.some(function (x) { return x !== p && x.name === p.name; });
      return p.name + (dup && d ? ' — ' + d : '');
    }
    return '<option value="">— choisir l\'article —</option>' +
      (accs.length ? '<optgroup label="Accessoires">' + accs.map(function (p) {
        return '<option value="accessory:' + esc(p.id) + '">' + esc(accLabel(p)) + '</option>';
      }).join('') + '</optgroup>' : '') +
      '<optgroup label="Filaments">' + fils.map(function (p) {
        return '<option value="filament:' + esc(p.id) + '">' + esc([p.brand, p.material, p.name].filter(Boolean).join(' · ')) + '</option>';
      }).join('') + '</optgroup>';
  }
  function learnPick() {
    var v = elScanLearnFil.value || '', i = v.indexOf(':');
    if (i === -1) return null;
    var c = v.slice(0, i), p = prodInCatalog(c, v.slice(i + 1));
    return p ? { c: c, p: p } : null;
  }
  function openLearn(code) {
    if (!elScanLearn) return;
    if (!catalogLoaded.filament) { loadCatalog('filament', true); }
    if (!catalogLoaded.accessory) { loadCatalog('accessory', true); }
    pendingCode = code; learnOpen = true;
    elScanLearnCode.textContent = code;
    elScanLearnFil.innerHTML = learnOptions(); elScanLearnFil.value = '';
    elScanLearnKind.value = 'spool'; elScanLearnKind.hidden = false;
    elScanLearn.hidden = false; if (elPosStation) elPosStation.hidden = false;
    scanFeedback('⚠ Code inconnu — associe-le une fois.', 'warn');
    try { elScanLearnFil.focus(); } catch (e) {}
  }
  function closeLearn() { learnOpen = false; pendingCode = ''; if (elScanLearn) elScanLearn.hidden = true; if (elPosStation) elPosStation.hidden = true; }
  if (elScanLearnFil) elScanLearnFil.addEventListener('change', function () {
    var pick = learnPick();
    elScanLearnKind.hidden = !!(pick && pick.c === 'accessory');   // bobine/recharge : filaments seulement
    if (!pick || pick.c !== 'filament') return;
    var p = pick.p;
    var hasS = filOffers(p, 'spool'), hasR = filOffers(p, 'refill');
    var os = elScanLearnKind.querySelector('option[value="spool"]'), orf = elScanLearnKind.querySelector('option[value="refill"]');
    if (os) os.disabled = !hasS; if (orf) orf.disabled = !hasR;
    if (!hasS && hasR) elScanLearnKind.value = 'refill';
    if (!hasR && hasS) elScanLearnKind.value = 'spool';
  });
  if (elScanLearnCancel) elScanLearnCancel.addEventListener('click', function () { closeLearn(); scanFeedback('Code ignoré.', 'warn'); });
  if (elScanLearnSave) elScanLearnSave.addEventListener('click', function () {
    var pick = learnPick();
    if (!pick) { elScanLearnFil.focus(); return; }
    var p = pick.p;
    var kind = pick.c === 'accessory' ? 'item' : (elScanLearnKind.value === 'refill' ? 'refill' : 'spool');
    var code = pendingCode;
    elScanLearnSave.disabled = true; scanFeedback('Association…', 'warn');
    var attrs = Object.assign({}, p.attrs || {});
    attrs.barcodes = Object.assign({}, attrs.barcodes || {});
    attrs.barcodes[kind] = code;
    sb.from('products').update({ attrs: attrs, updated_at: new Date().toISOString() }).eq('id', p.id).select()
      .then(function (res) {
        elScanLearnSave.disabled = false;
        if (res.error || !res.data || !res.data.length) { scanFeedback('Échec de l\'association (permissions ?).', 'bad'); return; }
        p.attrs = res.data[0].attrs || attrs;   // reconnu immédiatement ensuite
        closeLearn();
        var r = scanAdd({ p: p, kind: kind });
        scanFeedback('✓ Associé & ajouté : ' + r.label + '  (×' + r.qty + ')', 'ok');
          }, function (err) { elScanLearnSave.disabled = false; scanFeedback('Erreur : ' + (err && err.message ? err.message : err), 'bad'); });
  });
  function prodInCatalog(which, id) { return (catalog[which] || []).filter(function (p) { return String(p.id) === String(id); })[0] || null; }


})();
