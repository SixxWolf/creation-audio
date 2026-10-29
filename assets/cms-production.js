/* =========================================================
   Création Audio V2 — Stock › Production (spacers imprimés)
   1) BOBINES EN PRODUCTION : une bobine (ou recharge) du stock de vente est
      « sortie » pour imprimer (RPC admin_take_spool : −1 au stock, prix payé
      figé, 1000 g par défaut). Grammes restants = poids − Σ productions.
      Retirer (jamais utilisée) la remet au stock ; Terminer la range.
   2) EN IMPRESSION → PRODUCTION : le batch sorti d'AutoLoop (.gcode.3mf ou .gcode)
      entre dans la file production_queue (AutoLoop › « Envoyer à la production »
      ou glissé ici) ; « Terminé » le charge dans le formulaire.
      Lu dans l'en-tête : loops (« ; === LOOP 1 OF N === »), durée du batch
      (« Durée estimée du batch », cooldown compris), grammes par filament
      (déjà × loops), type + couleur de chaque filament (pré-choix des bobines).
      Coût = filament (g × prix / poids de la bobine) + électricité et usure
      (durée × taux $/h des défauts du calculateur AutoLoop). Les pièces bonnes
      font des paires ; une pièce seule attend la production suivante.
      RPC admin_save_production : stock du spacer + coût moyen (attrs.avg_cost.item,
      lu par Facturation / Spacers) en une transaction.
   3) HISTORIQUE : supprimer = la plus récente de chaque spacer seulement
      (RPC admin_delete_production : stock, pièce seule et coût moyen rejoués).
   Tables : production_spools · productions · production_uses (schema-v2.sql).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { if (v == null || v === '') return null; var n = +v; return isFinite(n) ? n : null; }
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }
  function round1(n) { return Math.round((+n || 0) * 10) / 10; }   // grammes : au dixième
  function money(n) { return round2(n).toFixed(2).replace('.', ',') + ' $'; }
  // « 11 420 g », « 588,5 g » (espace des milliers : les blocs dépassent souvent 10 000 g)
  function grams(n) {
    var v = Math.round((+n || 0) * 10) / 10, neg = v < 0, a = Math.abs(v);
    var int = String(Math.floor(a)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '), dec = Math.round((a % 1) * 10);
    return (neg ? '−' : '') + int + (dec ? ',' + dec : '') + ' g';
  }
  function fmtHm(min) {
    min = Math.max(0, Math.round(+min || 0));
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + (m < 10 ? '0' : '') + m;
  }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function shortDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    try { return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }); } catch (e) { return iso; }
  }
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
  function errText(e) { return e && e.message ? e.message : String(e || 'erreur inconnue'); }
  function toast(t, k) { if (window.caDialog && caDialog.toast) caDialog.toast(t, k); }
  function normTxt(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  /* ---- Pastille d'un filament : sa couleur (dégradé si multicolore) + paillettes Sparkle / Galaxy ---- */
  function filBg(f, hex) {
    var cs = (f && f.attrs && Array.isArray(f.attrs.colors) ? f.attrs.colors : []).filter(isHex), bg;
    if (cs.length >= 2) {
      var n = cs.length, parts = [];
      for (var i = 0; i < n; i++) parts.push(cs[i] + ' ' + (100 * i / n) + '%', cs[i] + ' ' + (100 * (i + 1) / n) + '%');
      bg = 'linear-gradient(90deg,' + parts.join(',') + ')';
    } else bg = cs[0] || (isHex(f && f.hex) ? f.hex : isHex(hex) ? hex : 'var(--line-2)');
    return f && /sparkle|galaxy|glitter|paillet/i.test(f.material || '') ? 'var(--sparkle), ' + bg : bg;
  }
  function swatchBg(bg) { return '<span class="pr-sw" style="background:' + esc(bg) + '"></span>'; }

  /* =========================================================
     MENU MAISON (remplace <select> : pastille + nom + détail, recherche, groupes)
     new Picker(hôte, { placeholder, search, items() -> [{ id, group, label, btn, meta, bg, dim }], onPick(id) })
     ========================================================= */
  var openPk = null;
  document.addEventListener('mousedown', function (e) { if (openPk && !openPk.root.contains(e.target)) openPk.close(); });
  function Picker(root, o) {
    var self = this;
    this.root = root; this.o = o; this.value = '';
    root.classList.add('pr-pk');
    root.innerHTML = '<button type="button" class="pr-pk-btn" aria-haspopup="listbox" aria-expanded="false"></button>' +
      '<div class="pr-pk-pop" hidden>' + (o.search ? '<input type="search" class="pr-pk-q" placeholder="Rechercher…" autocomplete="off" aria-label="Rechercher">' : '') +
      '<div class="pr-pk-list" role="listbox"></div></div>';
    this.btn = $('.pr-pk-btn', root); this.pop = $('.pr-pk-pop', root); this.list = $('.pr-pk-list', root); this.q = $('.pr-pk-q', root);
    if (root.getAttribute('aria-labelledby')) this.btn.setAttribute('aria-labelledby', root.getAttribute('aria-labelledby'));
    this.btn.addEventListener('click', function () { if (self.pop.hidden) self.open(); else self.close(); });
    this.btn.addEventListener('keydown', function (e) {
      if (self.pop.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); self.open(); }
    });
    root.addEventListener('keydown', function (e) {
      if (self.pop.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); self.close(); self.btn.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); self.move(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter') { var a = $('.pr-pk-it.is-active', self.list); if (a) { e.preventDefault(); self.pick(a.getAttribute('data-id')); } }
      else if (e.key === 'Tab') self.close();
    });
    if (this.q) this.q.addEventListener('input', function () { self.renderList(); });
    this.list.addEventListener('click', function (e) { var it = e.target.closest('.pr-pk-it'); if (it) self.pick(it.getAttribute('data-id')); });
    this.list.addEventListener('mousemove', function (e) {
      var it = e.target.closest('.pr-pk-it');
      if (it && !it.classList.contains('is-active')) { $$('.pr-pk-it.is-active', self.list).forEach(function (x) { x.classList.remove('is-active'); }); it.classList.add('is-active'); }
    });
    this.render();
  }
  Picker.prototype.items = function () { return this.o.items() || []; };
  Picker.prototype.find = function (id) { return this.items().filter(function (x) { return String(x.id) === String(id); })[0] || null; };
  Picker.prototype.set = function (id) { this.value = id ? String(id) : ''; this.render(); };
  Picker.prototype.render = function () {
    var it = this.value ? this.find(this.value) : null;
    if (this.value && !it) this.value = '';
    this.btn.innerHTML = it
      ? (it.bg ? swatchBg(it.bg) : '') + '<span class="pr-pk-l">' + esc(it.btn || it.label) + '</span>' + (it.meta ? '<span class="pr-pk-m">' + esc(it.meta) + '</span>' : '')
      : '<span class="pr-pk-l pr-pk-ph">' + esc(this.o.placeholder || 'Choisir…') + '</span>';
    if (!this.pop.hidden) this.renderList();
  };
  Picker.prototype.renderList = function () {
    var qv = this.q ? normTxt(this.q.value).trim() : '', self = this, last = null, html = '';
    var list = this.items().filter(function (x) { return !qv || normTxt([x.group, x.label, x.meta, x.find].join(' ')).indexOf(qv) !== -1; });
    list.forEach(function (x) {
      if (x.group && x.group !== last) { html += '<div class="pr-pk-g">' + esc(x.group) + '</div>'; last = x.group; }
      var sel = String(x.id) === self.value;
      html += '<button type="button" tabindex="-1" role="option" aria-selected="' + sel + '" class="pr-pk-it' + (x.dim ? ' is-dim' : '') + (sel ? ' is-sel is-active' : '') +
        '" data-id="' + esc(x.id) + '">' + (x.bg ? swatchBg(x.bg) : '') + '<span class="pr-pk-l">' + esc(x.label) + '</span>' +
        (x.meta ? '<span class="pr-pk-m">' + esc(x.meta) + '</span>' : '') + '</button>';
    });
    this.list.innerHTML = html || '<p class="pr-pk-empty">Aucun résultat.</p>';
    if (!$('.pr-pk-it.is-active', this.list)) { var f = $('.pr-pk-it', this.list); if (f) f.classList.add('is-active'); }
  };
  Picker.prototype.open = function () {
    if (openPk && openPk !== this) openPk.close();
    openPk = this;
    if (this.q) this.q.value = '';
    this.pop.hidden = false; this.btn.setAttribute('aria-expanded', 'true');
    this.renderList();
    var a = $('.pr-pk-it.is-active', this.list); if (a) a.scrollIntoView({ block: 'nearest' });
    (this.q || this.btn).focus();
  };
  Picker.prototype.close = function () {
    this.pop.hidden = true; this.btn.setAttribute('aria-expanded', 'false');
    if (openPk === this) openPk = null;
  };
  Picker.prototype.move = function (d) {
    var its = $$('.pr-pk-it', this.list); if (!its.length) return;
    var i = its.indexOf($('.pr-pk-it.is-active', this.list));
    if (i >= 0) its[i].classList.remove('is-active');
    i = Math.max(0, Math.min(its.length - 1, i + d));
    its[i].classList.add('is-active'); its[i].scrollIntoView({ block: 'nearest' });
  };
  Picker.prototype.pick = function (id) {
    this.value = String(id); this.close(); this.render(); this.btn.focus();
    if (this.o.onPick) this.o.onPick(this.value);
  };

  var loaded = false, saving = false;
  var spacers = [], filaments = [], spools = [], uses = [], removals = [], prods = [];
  var rates = { elec: 0.2, deprec: 0.25 };
  var file = null;          // G-code lu : { name, isAuto, loops, minutes, objects, fils: [{ type, hex, perLoop }] }
  var rows = [];            // filament utilisé : [{ block: clé du bloc|'', grams, type, hex }]
  var edited = { good: false, perPlate: false };
  var lastLoops = 1;
  var perLoopMin = 0;       // minutes par loop du G-code chargé : la durée suit les loops (0 = saisie à la main)

  var el = {
    takeOpen: $('#pr-take-open'), take: $('#pr-take'), takeFil: $('#pr-take-fil'), takeKind: $('#pr-take-kind'), takeQty: $('#pr-take-qty'),
    takeCost: $('#pr-take-cost'), takeWeight: $('#pr-take-weight'), takeSave: $('#pr-take-save'),
    takeCancel: $('#pr-take-cancel'), takeStatus: $('#pr-take-status'),
    spools: $('#pr-spools'), doneWrap: $('#pr-done-wrap'), doneN: $('#pr-done-n'), done: $('#pr-done'),
    drop: $('#pr-drop'), file: $('#pr-file'), fileWarn: $('#pr-file-warn'), queue: $('#pr-queue'), qN: $('#pr-queue-n'),
    spacer: $('#pr-spacer'), loops: $('#pr-loops'), perPlate: $('#pr-per-plate'), good: $('#pr-good'),
    timeH: $('#pr-time-h'), timeM: $('#pr-time-m'), date: $('#pr-date'),
    uses: $('#pr-uses'), useAdd: $('#pr-use-add'),
    save: $('#pr-save'), report: $('#pr-report'), status: $('#pr-status'),
    history: $('#pr-history'), refresh: $('#pr-refresh'),
    emptiesCard: $('#pr-empties-card'), empties: $('#pr-empties')
  };
  var empties = [];         // bobines vides (admin_empty_spools) : à libérer, en cours, dernier lot
  if (!el.spools) return;

  /* ---- activation à l'ouverture de l'onglet ---- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name !== 'production') return;
    if (!loaded) { loaded = true; el.date.value = todayISO(); }
    loadAll();   // à chaque visite : une vente / réception a pu changer les stocks entre-temps
  };

  function loadAll() {
    return Promise.all([
      window.CA.loadMaterials ? window.CA.loadMaterials() : null,
      loadSpacers(), loadFilaments(), loadSpools(), loadProds(), loadRates(), loadBrandOrder(), loadEmpties(), loadQueue()
    ]).then(function () {
      sortAll();
      renderSpools(); renderEmpties(); renderTakeOptions(); renderSpacerOptions(); renderRows(); recalc(); renderHistory(); renderQueue();
    }, function (err) {
      el.spools.innerHTML = '<p class="empty">Impossible de charger : ' + esc(errText(err)) + '</p>';
    });
  }
  function q(res) { if (res.error) throw res.error; return res.data || []; }
  function loadSpacers() {
    return sb.from('products').select('id,name,slug,qty,cost_price,sell_price,dealer_price,attrs,sort_order')
      .eq('type', 'spacer').order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) { spacers = q(res); });
  }
  function loadFilaments() {
    return sb.from('products').select('id,name,brand,material,hex,qty,qty_2,attrs,offer_spool,offer_refill')
      .eq('type', 'filament').order('brand', { ascending: true }).order('material', { ascending: true })
      .order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) { filaments = q(res); });
  }
  function loadSpools() {
    return Promise.all([
      sb.from('production_spools').select('*').order('taken_at', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('production_uses').select('production_id,spool_id,grams,cost'),
      sb.from('production_removals').select('*').order('created_at', { ascending: true })
    ]).then(function (r) { spools = q(r[0]); uses = q(r[1]); removals = r[2].error ? [] : (r[2].data || []); });
  }
  function loadEmpties() {
    var costs = window.CA.costing && window.CA.costing.loadEmptyCosts ? window.CA.costing.loadEmptyCosts(true) : null;
    return Promise.all([sb.rpc('admin_empty_spools'), costs]).then(function (all) { var res = all[0]; empties = res.error ? [] : (res.data || []); }, function () { empties = []; });
  }
  function loadProds() {
    return sb.from('productions').select('*').order('created_at', { ascending: false })
      .then(function (res) { prods = q(res); });
  }
  // Taux $/h : défauts enregistrés du calculateur AutoLoop (admin_settings « autoloop »)
  function loadRates() {
    function apply(prix) {
      if (!prix) return;
      var e = num(prix['ap-elec']), d = num(prix['ap-deprec']);
      if (e != null) rates.elec = e;
      if (d != null) rates.deprec = d;
    }
    try { var loc = JSON.parse(localStorage.getItem('al-defaults') || 'null'); apply(loc && loc.prix); } catch (e) {}
    return sb.from('admin_settings').select('value').eq('key', 'autoloop').maybeSingle().then(function (res) {
      if (!res.error && res.data && res.data.value) apply(res.data.value.prix);
    }, function () {});
  }

  /* ---- Ordre de la section Filaments (peu importe quand la bobine a été sortie) :
     marque (brands.sort_order) → matériau (materials.sort_order) → couleur (sort_order) ;
     bobine avant recharge ; à filament égal, la plus vieille d'abord (consommée en premier). ---- */
  var brandOrder = [];
  function loadBrandOrder() {
    return sb.from('brands').select('name,sort_order').order('sort_order', { ascending: true }).order('name', { ascending: true })
      .then(function (res) { if (!res.error) brandOrder = (res.data || []).map(function (b) { return b.name; }); }, function () {});
  }
  function brandIdx(name) { var i = brandOrder.indexOf(name); return i < 0 ? 9999 : i; }
  function matIdx(brand, mat) {
    var list = (window.CA.materials && window.CA.materials.list) || [];
    for (var i = 0; i < list.length; i++) { if (list[i].brand === brand && list[i].name === mat) return i; }
    return 9999;
  }
  function stableSort(arr, cmp) {
    return arr.map(function (x, i) { return { x: x, i: i }; })
      .sort(function (a, z) { return cmp(a.x, z.x) || (a.i - z.i); }).map(function (d) { return d.x; });
  }
  function sortAll() {
    // filaments : chargés par marque/matériau alphabétiques puis sort_order -> réordonnés marque/matériau seulement
    filaments = stableSort(filaments, function (a, z) {
      return (brandIdx(a.brand) - brandIdx(z.brand)) || (matIdx(a.brand, a.material) - matIdx(z.brand, z.material));
    });
    var rank = {};
    filaments.forEach(function (f, i) { rank[f.id] = i; });
    var rk = function (s) { return rank[s.product_id] != null ? rank[s.product_id] : 1e6; };
    // bobines : chargées par date de sortie -> l'ordre d'origine départage les bobines du même filament
    spools = stableSort(spools, function (a, z) {
      return (rk(a) - rk(z)) || ((a.kind === 'refill' ? 1 : 0) - (z.kind === 'refill' ? 1 : 0)) ||
        (rk(a) === 1e6 ? String(a.label).localeCompare(String(z.label), 'fr') : 0);
    });
  }

  function spoolById(id) { return spools.filter(function (s) { return String(s.id) === String(id); })[0] || null; }
  function spacerById(id) { return spacers.filter(function (s) { return String(s.id) === String(id); })[0] || null; }
  function filById(id) { return filaments.filter(function (f) { return String(f.id) === String(id); })[0] || null; }
  // grammes sortis d'une bobine : productions + retraits (filament pris pour autre chose)
  function usedOf(id) {
    var sum = function (t, u) { return t + (String(u.spool_id) === String(id) ? (+u.grams || 0) : 0); };
    return uses.reduce(sum, 0) + removals.reduce(sum, 0);
  }
  // retraits d'un bloc, regroupés par action (un retrait peut toucher plusieurs bobines)
  function removalsOf(b) {
    var ids = {}, out = [], map = {};
    b.spools.forEach(function (s) { ids[s.id] = 1; });
    removals.forEach(function (r) {
      if (!ids[r.spool_id]) return;
      var g = map[r.batch];
      if (!g) { g = map[r.batch] = { batch: r.batch, grams: 0, note: r.note || '', at: r.removed_at }; out.push(g); }
      g.grams += +r.grams || 0;
    });
    return out;
  }
  function leftOf(s) { return (+s.weight_g || 0) - usedOf(s.id); }
  function activeSpools() { return spools.filter(function (s) { return s.status === 'active'; }); }
  function kindTxt(k) { return k === 'refill' ? 'Recharge' : 'Bobine'; }
  function swatch(hex) { return swatchBg(isHex(hex) ? hex : 'var(--line-2)'); }
  // pastille d'une bobine de production : celle de son filament (multicolore, paillettes), sinon sa couleur figée
  function spoolBg(s) { return s ? filBg(filById(s.product_id), s.hex) : 'var(--line-2)'; }
  // « Bambu Lab · PETG Basic · Black » -> « PETG Basic · Black » (la marque prend de la place)
  function shortLabel(s) { var p = String(s.label || '').split(' · '); return p.length > 2 ? p.slice(1).join(' · ') : (s.label || ''); }

  /* =========================================================
     1) BOBINES EN PRODUCTION — regroupées en BLOCS (2026-10-11) :
     un bloc = même filament + même format (« Black ×10 »), une jauge pour le total ;
     dans le bloc, des LOTS = même date de sortie + même prix + même poids. On déplie
     (chevron) pour voir les lots et chaque bobine. En base, une ligne par bobine.
     ========================================================= */
  function blockKey(s) { return (s.product_id ? String(s.product_id) : 'x:' + s.label) + '|' + (s.kind === 'refill' ? 'refill' : 'spool'); }
  function lotKey(s) { return s.taken_at + '|' + (+s.unit_cost || 0).toFixed(2) + '|' + s.weight_g; }
  // blocs dans l'ordre de `spools` (déjà trié : ordre des Filaments, puis la plus vieille d'abord)
  function blocksOf(list) {
    var map = {}, out = [];
    list.forEach(function (s) {
      var k = blockKey(s), b = map[k];
      if (!b) { b = map[k] = { key: k, spools: [], lots: [], lotMap: {} }; out.push(b); }
      b.spools.push(s);
      var lk = lotKey(s), l = b.lotMap[lk];
      if (!l) { l = b.lotMap[lk] = { key: lk, spools: [] }; b.lots.push(l); }
      l.spools.push(s);
    });
    return out;
  }
  var openBlocks = {};   // blocs dépliés (clé -> true), gardés d'un rendu à l'autre
  function isUsed(s) { return usedOf(s.id) > 0.05; }
  function priceRange(b) {
    var ps = b.lots.map(function (l) { return +l.spools[0].unit_cost || 0; });
    var lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
    return lo === hi ? money(lo) : money(lo).replace(' $', '') + '–' + money(hi);
  }
  function blockMeta(b, done) {
    var s = b.spools[0], m = [kindTxt(s.kind)];
    if (b.lots.length === 1) m.push(money(s.unit_cost), 'sortie' + (b.spools.length > 1 ? 's' : '') + ' le ' + shortDay(s.taken_at));
    else m.push(b.lots.length + ' lots', priceRange(b));
    if (!done) {
      var ent = b.spools.filter(isUsed).length;
      if (ent && b.spools.length > 1) m.push(ent + ' entamée' + (ent > 1 ? 's' : ''));
    }
    var hs = b.spools.filter(function (x) { return !x.stock_taken; }).length;
    if (hs) m.push(b.spools.length > 1 ? hs + ' hors stock' : 'hors stock');
    if (!done && isLow(b)) m.push('presque vide');
    return m.join(' · ');
  }
  // bloc actif dont il reste moins de LOW_G grammes en tout : à remplacer avant le prochain batch
  var LOW_G = 150;
  function isLow(b) { return b.spools.reduce(function (t, x) { return t + Math.max(0, leftOf(x)); }, 0) < LOW_G; }
  // détail à déplier : plusieurs bobines, ou des retraits à voir / annuler
  function expandable(b) { return b.spools.length > 1 || removalsOf(b).length > 0; }
  function chevron(b) {
    return expandable(b)
      ? '<button class="pr-chev" type="button" data-act="toggle" aria-expanded="' + (!!openBlocks[b.key]) + '" aria-label="Voir les bobines"></button>' : '';
  }
  // une bobine (dans le détail d'un bloc déplié)
  function spoolLine(s, i, done) {
    var used = usedOf(s.id), w = +s.weight_g || 1000, left = w - used;
    var st = done ? grams(used) + ' utilisés' + (left > 0.5 ? ' · perte ' + grams(left) : '') + (s.closed_auto ? ' · vidée' : '')
      : used > 0.05 ? grams(left) + ' <em>/ ' + grams(w) + '</em> · entamée' : 'pleine';
    var act = done ? '<button class="btn btn-ghost btn-sm" type="button" data-act="reopen">Rouvrir</button>'
      : used > 0.05 ? '<button class="btn btn-ghost btn-sm" type="button" data-act="close">Terminer</button>'
      : '<button class="btn btn-ghost btn-sm" type="button" data-act="remove" title="Remettre au stock de vente">Retirer</button>';
    return '<div class="pr-sline" data-id="' + esc(s.id) + '"><span class="pr-sline-n">' + kindTxt(s.kind) + ' ' + (i + 1) + '</span>' +
      '<span class="pr-sline-st">' + st + (s.stock_taken ? '' : ' · hors stock') + '</span>' + act + '</div>';
  }
  // détail d'un bloc déplié : par lot, chaque bobine entamée (ou terminée) + UNE ligne pour les pleines
  function blockDetail(b, done) {
    if (!expandable(b) || !openBlocks[b.key]) return '';
    var rem = removalsOf(b), remHtml = rem.length
      ? '<div class="pr-lot"><div class="pr-lot-h">Retraits</div>' + rem.map(function (r) {
          return '<div class="pr-sline" data-batch="' + esc(r.batch) + '"><span class="pr-sline-n">Retrait</span>' +
            '<span class="pr-sline-st">' + grams(r.grams) + ' · ' + esc(shortDay(r.at)) + (r.note ? ' · ' + esc(r.note) : '') + '</span>' +
            '<button class="btn btn-ghost btn-sm" type="button" data-act="undo-removal">Annuler</button></div>';
        }).join('') + '</div>' : '';
    if (b.spools.length < 2) return '<div class="pr-detail">' + remHtml + '</div>';
    return '<div class="pr-detail">' + b.lots.map(function (l) {
      var s = l.spools[0], full = done ? [] : l.spools.filter(function (x) { return !isUsed(x); });
      var lines = l.spools.filter(function (x) { return done || isUsed(x); }).map(function (x, i) { return spoolLine(x, i, done); }).join('');
      if (full.length) {
        lines += '<div class="pr-sline" data-lot="' + esc(l.key) + '"><span class="pr-sline-n">' + full.length + ' pleine' + (full.length > 1 ? 's' : '') + '</span>' +
          '<span class="pr-sline-st">' + grams(full.length * (+s.weight_g || 1000)) + '</span>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-act="remove-lot" title="Remettre au stock de vente">Retirer</button></div>';
      }
      return '<div class="pr-lot"><div class="pr-lot-h">' + esc(shortDay(s.taken_at)) + ' · ' + money(s.unit_cost) + ' · ×' + l.spools.length +
        (+s.weight_g !== 1000 ? ' · ' + grams(s.weight_g) : '') + '</div>' + lines + '</div>';
    }).join('') + remHtml + '</div>';
  }
  function blockRow(b, done) {
    var s = b.spools[0], n = b.spools.length;
    var W = b.spools.reduce(function (t, x) { return t + (+x.weight_g || 1000); }, 0);
    var U = b.spools.reduce(function (t, x) { return t + usedOf(x.id); }, 0), L = W - U;
    var pct = Math.max(0, Math.min(100, L / W * 100));
    var act = '';
    if (done) {
      if (n === 1) act = '<button class="btn btn-ghost btn-sm" type="button" data-act="reopen">Rouvrir</button>';
    } else {
      var ent = b.spools.filter(isUsed).length, full = n - ent;
      act += '<button class="btn btn-ghost btn-sm" type="button" data-act="take-g">Retirer des g</button>';
      if (ent) act += '<button class="btn btn-ghost btn-sm" type="button" data-act="close-block">Terminer</button>';
      if (full) act += '<button class="btn btn-ghost btn-sm" type="button" data-act="remove-block" title="Remettre au stock de vente">Retirer</button>';
    }
    var nprod = Object.keys(uses.filter(function (u) { return b.spools.some(function (x) { return String(x.id) === String(u.spool_id); }); })
      .reduce(function (acc, u) { acc[u.production_id] = 1; return acc; }, {})).length;
    return '<div class="pr-spool' + (done ? ' is-done' : '') + (!done && isLow(b) ? ' is-low' : '') + (openBlocks[b.key] && expandable(b) ? ' is-open' : '') + '" data-block="' + esc(b.key) + '">' +
      swatchBg(spoolBg(s)) +
      '<div class="pr-sp-main"><b>' + esc(s.label) + (n > 1 ? ' <span class="pr-n">×' + n + '</span>' : '') + '</b>' +
        '<span class="pr-sp-meta">' + esc(blockMeta(b, done)) + '</span></div>' +
      (done
        ? '<span class="pr-sp-left">' + grams(U) + ' · ' + nprod + ' prod.' + (L > 0.5 ? ' · perte ' + grams(L) : '') + '</span>'
        : '<div class="pr-sp-gauge"><div class="pr-bar"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
          '<span class="pr-sp-left' + (L < 0 ? ' is-neg' : '') + '">' + grams(L) + ' <em>/ ' + grams(W) + '</em></span></div>') +
      '<div class="pr-sp-act">' + act + chevron(b) + '</div>' +
      blockDetail(b, done) +
    '</div>';
  }
  function renderSpools() {
    var act = blocksOf(activeSpools()), doneSp = spools.filter(function (s) { return s.status === 'done'; }), done = blocksOf(doneSp);
    el.spools.innerHTML = act.length ? act.map(function (b) { return blockRow(b, false); }).join('')
      : '<p class="muted pr-empty">Aucune bobine en production.</p>';
    el.doneWrap.hidden = !doneSp.length;
    el.doneN.textContent = doneSp.length ? '(' + doneSp.length + ')' : '';
    el.done.innerHTML = done.map(function (b) { return blockRow(b, true); }).join('');
  }
  function blockOf(key, done) {
    return blocksOf(spools.filter(function (s) { return done ? s.status === 'done' : s.status === 'active'; }))
      .filter(function (b) { return b.key === key; })[0] || null;
  }
  [el.spools, el.done].forEach(function (box) {
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act'), row = btn.closest('.pr-spool'), done = box === el.done;
      var b = row ? blockOf(row.getAttribute('data-block'), done) : null;
      if (act === 'toggle' && b) { openBlocks[b.key] = !openBlocks[b.key]; renderSpools(); return; }
      if (act === 'close-block' && b) { closeBlock(b, btn); return; }
      if (act === 'take-g' && b) { takeGrams(b, btn); return; }
      if (act === 'undo-removal') { undoRemoval(btn); return; }
      if (act === 'remove-block' && b) { removeBlock(b.spools); return; }
      if (act === 'remove-lot' && b) {
        var lk = btn.closest('.pr-sline').getAttribute('data-lot'), lot = b.lotMap[lk];
        if (lot) removeBlock(lot.spools);
        return;
      }
      // action sur une bobine : ligne du détail, ou bloc d'une seule bobine
      var line = btn.closest('.pr-sline');
      var s = line ? spoolById(line.getAttribute('data-id')) : (b && b.spools.length === 1 ? b.spools[0] : null);
      if (s) spoolAction(s, act, btn);
    });
  });
  // Retirer des g : filament pris pour autre chose que des spacers, sans raison ni coût.
  // Pris sur les bobines du bloc dans l'ordre (la plus vieille d'abord, comme l'imprimante).
  function takeGrams(b, btn) {
    var left = b.spools.reduce(function (t, x) { return t + Math.max(0, leftOf(x)); }, 0);
    var body = document.createElement('div');
    body.innerHTML = '<input type="number" class="dlg-field" min="0" step="0.1" inputmode="decimal" placeholder="Grammes" aria-label="Grammes">' +
      '<input type="text" class="dlg-field" placeholder="Note (facultatif)" aria-label="Note" maxlength="80">';
    var gIn = body.querySelector('input[type=number]'), nIn = body.querySelector('input[type=text]');
    caDialog.confirm({ title: 'Retirer des grammes', message: shortLabel(b.spools[0]) + ' : il reste ' + grams(left) + '.',
      body: body, ok: 'Retirer', icon: 'edit' }).then(function (ok) {
      if (!ok) return;
      var g = round1(num(gIn.value) || 0);
      if (g <= 0) return;
      if (g > left + 0.05) { toast('Il ne reste que ' + grams(left) + ' dans ce bloc.', 'bad'); return; }
      var need = g, parts = [];
      b.spools.forEach(function (s) {
        var take = round2(Math.min(need, Math.max(0, leftOf(s))));
        if (take > 0) { parts.push({ spool_id: s.id, grams: take }); need = round2(need - take); }
      });
      btn.disabled = true;
      sb.rpc('admin_take_grams', { p: { parts: parts, note: nIn.value, date: todayISO() } }).then(function (res) {
        btn.disabled = false;
        if (res.error) { caDialog.error(res.error); return; }
        toast(grams(g) + ' retirés');
        openBlocks[b.key] = true;
        reloadAfterChange();
      });
    });
    gIn.focus();
  }
  function undoRemoval(btn) {
    var line = btn.closest('[data-batch]'); if (!line) return;
    btn.disabled = true;
    sb.rpc('admin_removal_undo', { p_batch: line.getAttribute('data-batch') }).then(function (res) {
      btn.disabled = false;
      if (res.error) { caDialog.error(res.error); return; }
      toast('Retrait annulé');
      reloadAfterChange();
    });
  }
  // Terminer : la bobine entamée du bloc (le reste éventuel compte comme perte)
  function closeBlock(b, btn) {
    var ent = b.spools.filter(isUsed);
    if (!ent.length) return;
    var left = ent.reduce(function (t, s) { return t + Math.max(0, leftOf(s)); }, 0);
    caDialog.confirm({ title: ent.length > 1 ? 'Terminer les ' + ent.length + ' bobines entamées ?' : 'Terminer la bobine entamée ?',
      message: shortLabel(b.spools[0]) + (left > 0.5 ? ' — il reste ' + grams(left) + ', compté comme perte.' : '.'), ok: 'Terminer' }).then(function (ok) {
      if (!ok) return;
      btn.disabled = true;
      var ids = ent.map(function (s) { return s.id; });
      sb.from('production_spools').update({ status: 'done', closed_at: new Date().toISOString(), closed_auto: false }).in('id', ids).select().then(function (res) {
        btn.disabled = false;
        if (res.error) { caDialog.error(res.error); return; }
        toast(ent.length > 1 ? ent.length + ' bobines terminées' : 'Bobine terminée');
        reloadAfterChange();
      });
    });
  }
  // Retirer : n bobines pleines d'un bloc ou d'un lot (les plus récentes) retournent au stock de vente
  function removeBlock(list) {
    var full = list.filter(function (s) { return !isUsed(s); });
    if (!full.length) return;
    var ask = full.length === 1
      ? caDialog.confirm({ title: 'Retirer cette bobine ?', message: shortLabel(full[0]) + (full[0].stock_taken ? ' retourne au stock de vente.' : ' est retirée de la production.'),
          ok: 'Retirer', danger: true, icon: 'trash' }).then(function (ok) { return ok ? 1 : 0; })
      : caDialog.prompt({ title: 'Retirer combien de bobines ?', message: shortLabel(full[0]) + ' : ' + full.length + ' pleines. Elles retournent au stock de vente.',
          value: String(full.length), ok: 'Retirer', icon: 'trash' }).then(function (v) {
          var n = parseInt(v, 10);
          return isFinite(n) ? Math.max(0, Math.min(full.length, n)) : 0;
        });
    ask.then(function (n) {
      if (!n) return;
      var pick = full.slice(-n);
      Promise.all(pick.map(function (s) { return sb.rpc('admin_spool_delete', { p_id: s.id }); })).then(function (res) {
        var err = res.filter(function (r) { return r.error; })[0];
        if (err) caDialog.error(err.error);
        else toast(n > 1 ? n + ' bobines remises au stock' : 'Bobine remise au stock');
        reloadAfterChange();
      });
    });
  }
  function spoolAction(s, act, btn) {
    if (act === 'remove') {
      caDialog.confirm({ title: 'Retirer cette bobine ?', message: s.label + (s.stock_taken ? ' retourne au stock de vente.' : ' est retirée de la production.'),
        ok: 'Retirer', danger: true, icon: 'trash' }).then(function (ok) {
        if (!ok) return;
        sb.rpc('admin_spool_delete', { p_id: s.id }).then(function (res) {
          if (res.error) { caDialog.error(res.error); return; }
          toast(s.stock_taken ? 'Bobine remise au stock' : 'Bobine retirée');
          reloadAfterChange();
        });
      });
      return;
    }
    btn.disabled = true;
    var patch = act === 'close' ? { status: 'done', closed_at: new Date().toISOString(), closed_auto: false }
                                : { status: 'active', closed_at: null, closed_auto: false };
    sb.from('production_spools').update(patch).eq('id', s.id).select().then(function (res) {
      btn.disabled = false;
      if (res.error) { caDialog.error(res.error); return; }
      toast(act === 'close' ? 'Bobine terminée' : 'Bobine rouverte');
      Object.assign(s, patch);
      renderSpools(); renderRows(); recalc();
      loadEmpties().then(renderEmpties);   // terminée / rouverte : compte « à libérer »
    });
  }

  /* =========================================================
     BOBINES VIDES (2026-10-12) — une bobine terminée (format bobine) laisse une bobine
     vide réutilisable, vendue en accessoire ; aussi les bobines sorties en usage interne.
     Rien n'entre au stock sans confirmation : Libérer (vente) / Garder (sorties du compte).
     Lien filament -> bobine vide : fiche du matériau (materials.empty_spool_id).
     ========================================================= */
  // Depuis le 2026-10-19 : la production paie la bobine au complet ; la bobine vide n'a de coût
  // qu'à la vente (bobine − recharge aux prix du jour, cms-costing.js) -> affiché ici à titre indicatif.
  function emptyCostOf(e) {
    var v = window.CA.costing && window.CA.costing.emptySpoolCost ? window.CA.costing.emptySpoolCost(e) : null;
    return v != null ? v : (+e.cost_price || 0);
  }
  function emptyImg(e) {
    if (!e.image_path) return '<span class="pr-e-img is-none" aria-hidden="true"></span>';
    var url = sb.storage.from('products').getPublicUrl(e.image_path).data.publicUrl;
    return '<span class="pr-e-img"><img src="' + esc(url) + '" alt="" loading="lazy"></span>';
  }
  function emptyRow(e) {
    var prod = +e.prod || 0, intl = +e.internal || 0, pend = prod + intl, act = +e.active || 0;
    var cost = emptyCostOf(e);
    var mats = (e.materials || []).map(function (x) { var p = String(x).split(' · '); return p[p.length - 1]; });
    var meta = ['Stock ' + (e.qty | 0), money(cost)];
    if (act) meta.push(act + ' en cours');
    var metaHtml = esc(meta.join(' · ')) + ' · ' + (mats.length ? esc(mats.join(', ')) : '<span class="is-warn">aucun matériau lié</span>');
    var src = [];
    if (prod) src.push(prod + ' production');
    if (intl) src.push(intl + ' interne');
    var last = '';
    if (e.last && e.last.batch) {
      var bits = [];
      if (+e.last.released) bits.push('+' + e.last.released + ' en vente');
      if (+e.last.kept) bits.push(e.last.kept + ' gardée' + (e.last.kept > 1 ? 's' : ''));
      last = '<span class="pr-e-last">' + esc(shortDay(String(e.last.at).slice(0, 10))) + ' · ' + esc(bits.join(' · ')) +
        ' <button class="pr-e-undo" type="button" data-act="undo">Annuler</button></span>';
    }
    return '<div class="pr-e" data-id="' + esc(e.id) + '">' + emptyImg(e) +
      '<div class="pr-sp-main"><b>' + esc(e.name) + '</b><span class="pr-sp-meta">' + metaHtml + '</span>' + last + '</div>' +
      '<div class="pr-e-n"><b class="' + (pend ? 'is-on' : '') + '">' + pend + ' à libérer</b>' +
        (src.length ? '<span>' + esc(src.join(' · ')) + '</span>' : '') + '</div>' +
      '<div class="pr-sp-act">' +
        (pend ? '<button class="btn btn-accent btn-sm" type="button" data-act="release" data-ic="check">Libérer</button>' +
                '<button class="btn btn-ghost btn-sm" type="button" data-act="keep">Garder</button>' : '') +
      '</div></div>';
  }
  function renderEmpties() {
    if (!el.empties) return;
    el.emptiesCard.hidden = !empties.length;
    el.empties.innerHTML = empties.map(emptyRow).join('');
  }
  function emptyById(id) { return empties.filter(function (e) { return String(e.id) === String(id); })[0] || null; }
  if (el.empties) el.empties.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]'); if (!btn) return;
    var e = emptyById(btn.closest('.pr-e').getAttribute('data-id')); if (!e) return;
    var act = btn.getAttribute('data-act'), pend = (+e.prod || 0) + (+e.internal || 0);
    if (act === 'undo') { undoEmpty(e, btn); return; }
    var rel = act === 'release';
    caDialog.prompt({
      title: rel ? 'Combien en vente ?' : 'Combien en garder ?',
      message: e.name + ' : ' + pend + ' à libérer.' + (rel ? ' Elles entrent au stock de la boutique.' : ' Elles sortent du compte, sans stock.'),
      value: String(pend), ok: rel ? 'Libérer' : 'Garder', icon: rel ? 'plus' : 'info'
    }).then(function (v) {
      if (v == null) return;
      var n = parseInt(v, 10);
      if (!isFinite(n) || n <= 0) return;
      n = Math.min(n, pend);
      btn.disabled = true;
      sb.rpc('admin_release_empty', { p_acc: e.id, p_release: rel ? n : 0, p_keep: rel ? 0 : n }).then(function (res) {
        btn.disabled = false;
        if (res.error) { caDialog.error(res.error); return; }
        toast(rel ? n + ' bobine' + (n > 1 ? 's' : '') + ' vide' + (n > 1 ? 's' : '') + ' en vente' : n + ' gardée' + (n > 1 ? 's' : ''));
        if (rel) waitlistCheck(e);
        loadEmpties().then(renderEmpties);
      });
    });
  });
  // le stock remonte : quelqu'un attendait cette bobine vide ? (alerte de la liste d'attente)
  function waitlistCheck(e) {
    var wl = window.CA.waitlist;
    if (!wl) return;
    wl.reload().then(function () {
      var n = wl.count(e.id, 'item');
      if (!n) return;
      wl.onScan(e.id, 'item');
      caDialog.alert({ title: n > 1 ? n + ' personnes l\'attendent' : 'Quelqu\'un l\'attend',
        message: e.name + ' — Inventaire › Liste d\'attente pour aviser.', icon: 'info' });
    }, function () {});
  }
  function undoEmpty(e, btn) {
    var l = e.last || {};
    caDialog.confirm({ title: 'Annuler ce lot ?',
      message: e.name + (+l.released ? ' perd ' + l.released + ' de stock ; ' : ' : ') + 'les bobines redeviennent à libérer.',
      ok: 'Annuler le lot', cancel: 'Retour', danger: !!+l.released, icon: 'warn' }).then(function (ok) {
      if (!ok) return;
      btn.disabled = true;
      sb.rpc('admin_empty_undo', { p_batch: l.batch }).then(function (res) {
        if (res.error) { btn.disabled = false; caDialog.error(res.error); return; }
        toast('Lot annulé');
        loadEmpties().then(renderEmpties);
      });
    });
  }

  // --- Sortir des bobines du stock de vente (une ou plusieurs d'un coup) ---
  function stockOf(f, kind) { return Math.max(0, (kind === 'refill' ? f.qty_2 : f.qty) | 0); }
  // en stock d'abord dans chaque marque · matière ; rupture grisée (reste choisissable)
  var takePk = new Picker(el.takeFil, {
    placeholder: 'Choisir le filament', search: true,
    items: function () {
      return filaments.map(function (f) {
        var st = [];
        if ((f.qty | 0) > 0) st.push((f.qty | 0) + ' bob.');
        if ((f.qty_2 | 0) > 0) st.push((f.qty_2 | 0) + ' rech.');
        return { id: f.id, group: (f.brand || '') + ' · ' + (f.material || ''), label: f.name || '(sans nom)',
          btn: (f.material ? f.material + ' · ' : '') + (f.name || ''), meta: st.length ? st.join(' · ') : 'rupture',
          bg: filBg(f), dim: !st.length, find: f.brand };
      });
    },
    onPick: function () { takeDefaults(true); }
  });
  function takeKind() { var b = $('.fx-seg-btn.is-active', el.takeKind); return b ? b.getAttribute('data-kind') : 'spool'; }
  function setTakeKind(k) {
    $$('.fx-seg-btn', el.takeKind).forEach(function (b) {
      var on = b.getAttribute('data-kind') === k;
      b.classList.toggle('is-active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  // libellés du format avec le stock (« Bobine · 3 ») + bouton « Sortir 4 bobines »
  function takeLabels() {
    var f = filById(takePk.value), n = Math.max(1, num(el.takeQty.value) | 0), k = takeKind();
    $$('.fx-seg-btn', el.takeKind).forEach(function (b) {
      var kk = b.getAttribute('data-kind');
      b.innerHTML = kindTxt(kk) + (f ? ' <em>' + stockOf(f, kk) + '</em>' : '');
    });
    var word = k === 'refill' ? 'recharge' : 'bobine';
    el.takeSave.textContent = 'Sortir ' + (n > 1 ? n + ' ' + word + 's' : '1 ' + word);
    var over = f ? n - stockOf(f, k) : 0;
    el.takeStatus.textContent = over > 0 ? over + ' hors stock' : '';
  }
  function takeDefaults(kindToo) {
    var f = filById(takePk.value);
    if (f && kindToo) setTakeKind(stockOf(f, 'spool') > 0 ? 'spool' : stockOf(f, 'refill') > 0 ? 'refill' : 'spool');
    var c = f && window.CA.costing ? window.CA.costing.costOf(f, takeKind(), filaments) : null;
    el.takeCost.value = c != null ? (+c).toFixed(2) : '';
    takeLabels();
  }
  function renderTakeOptions() { takePk.render(); takeLabels(); }
  el.takeKind.addEventListener('click', function (e) {
    var b = e.target.closest('.fx-seg-btn'); if (!b) return;
    setTakeKind(b.getAttribute('data-kind')); takeDefaults(false);
  });
  el.takeQty.addEventListener('input', takeLabels);
  el.takeOpen.addEventListener('click', function () {
    el.take.hidden = !el.take.hidden;
    if (!el.take.hidden) {
      var last = null;
      try { last = localStorage.getItem('pr-last-fil'); } catch (e) {}
      if (!takePk.value && last && filById(last)) takePk.set(last);
      el.takeQty.value = 1;
      takeDefaults(true);
      takePk.btn.focus();
    }
  });
  el.takeCancel.addEventListener('click', function () { el.take.hidden = true; });
  el.take.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = filById(takePk.value);
    if (!f) { el.takeStatus.textContent = 'Choisis le filament.'; return; }
    var cost = num(el.takeCost.value), w = Math.round(num(el.takeWeight.value) || 0), n = Math.max(1, Math.min(50, num(el.takeQty.value) | 0));
    if (cost == null || cost < 0) { el.takeStatus.textContent = 'Indique le prix payé.'; return; }
    if (w < 1) { el.takeStatus.textContent = 'Indique le poids.'; return; }
    el.takeSave.disabled = true; el.takeStatus.textContent = 'Enregistrement…';
    sb.rpc('admin_take_spool', { p_product: f.id, p_kind: takeKind(), p_cost: round2(cost), p_weight: w, p_count: n, p_date: todayISO() }).then(function (res) {
      el.takeSave.disabled = false;
      if (res.error) { el.takeStatus.textContent = 'Erreur : ' + res.error.message; return; }
      try { localStorage.setItem('pr-last-fil', f.id); } catch (e) {}
      el.take.hidden = true; el.takeStatus.textContent = '';
      var taken = (res.data && res.data.taken) | 0, word = takeKind() === 'refill' ? 'recharge' : 'bobine';
      toast(n + ' ' + word + (n > 1 ? 's' : '') + ' en production' + (taken < n ? ' · ' + (n - taken) + ' hors stock' : ''));
      reloadAfterChange();
    }, function (err) { el.takeSave.disabled = false; el.takeStatus.textContent = 'Erreur : ' + errText(err); });
  });

  /* =========================================================
     2) EN IMPRESSION — file des batchs lancés : AutoLoop › « Envoyer à la
        production » (CA.prodQueue) ou glissés ici, plusieurs d'un coup.
        Seulement les infos de l'en-tête (aucun fichier stocké) ; progression
        = temps écoulé depuis l'envoi / durée du batch. « Terminé » charge le
        batch dans le formulaire ; l'enregistrement le retire de la file.
     ========================================================= */
  var queue = [];           // production_queue, plus ancien d'abord
  var fromQueue = null;     // id de la ligne chargée dans le formulaire
  function pickFiles(list) { Array.prototype.slice.call(list || []).forEach(readFile); }
  el.drop.addEventListener('click', function () { el.file.click(); });
  el.drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); } });
  el.file.addEventListener('change', function () { pickFiles(el.file.files); el.file.value = ''; });
  el.drop.addEventListener('dragover', function (e) { e.preventDefault(); el.drop.classList.add('drag'); });
  el.drop.addEventListener('dragleave', function () { el.drop.classList.remove('drag'); });
  el.drop.addEventListener('drop', function (e) {
    e.preventDefault(); el.drop.classList.remove('drag');
    pickFiles(e.dataTransfer && e.dataTransfer.files);
  });

  var HEAD_BYTES = 3 * 1024 * 1024;   // en-tête + bloc de config : largement dans les 3 premiers Mo
  function decodeHead(u8) { return new TextDecoder('utf-8').decode(u8.subarray(0, Math.min(u8.length, HEAD_BYTES))); }
  function readFile(f) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var r;
      try { r = parseBytes(new Uint8Array(e.target.result)); }
      catch (err) { toast(f.name + ' : ' + errText(err), 'bad'); return; }
      enqueue(f.name, r.info, r.objects).catch(function (err) { toast('Erreur : ' + errText(err), 'bad'); });
    };
    reader.onerror = function () { toast(f.name + ' : impossible de lire ce fichier.', 'bad'); };
    reader.readAsArrayBuffer(f);
  }
  function parseBytes(u8) {
    var head, objects = 0;
    if (window.ALProject && window.ALProject.isZip(u8)) {
      var proj = window.ALProject.read(u8);
      if (!proj.plates.length) throw new Error('ce .3mf ne contient pas de plateau tranché.');
      // le plateau bouclé par AutoLoop (sinon le premier)
      var plate = proj.plates.filter(function (p) {
        return decodeHead(proj.entries[p.name].subarray(0, 2048)).indexOf('Batch généré par AutoLoop') !== -1;
      })[0] || proj.plates[0];
      head = decodeHead(proj.entries[plate.name]);
      objects = countObjects(proj.entries['Metadata/slice_info.config'], plate.n);
    } else head = decodeHead(u8);
    return { info: parseGcode(head), objects: objects };
  }

  // Spacers + productions requis pour deviner le spacer (envoi depuis AutoLoop avant d'ouvrir l'onglet)
  var baseP = null;
  function ensureBase() {
    if (spacers.length) return Promise.resolve();
    return baseP || (baseP = Promise.all([loadSpacers(), loadProds()]).then(function () { baseP = null; }, function (e) { baseP = null; throw e; }));
  }
  function perPlateOf(sp, objects) {
    var last = sp ? prods.filter(function (p) { return String(p.spacer_id) === String(sp.id); })[0] : null;
    return Math.max(1, (last ? last.per_plate : (objects > 0 ? objects : 1)) | 0);
  }
  function enqueue(name, info, objects) {
    return ensureBase().then(function () {
      var sp = detectSpacer(name), per = perPlateOf(sp, objects);
      return sb.from('production_queue').insert({
        file_name: name, spacer_id: sp ? sp.id : null, loops: info.loops, per_plate: per,
        pieces: info.loops * per, minutes: info.minutes,
        info: { isAuto: info.isAuto, loops: info.loops, minutes: info.minutes, objects: objects || 0, fils: info.fils }
      }).select().single();
    }).then(function (res) {
      if (res.error) throw res.error;
      queue.push(res.data); renderQueue();
      toast('En impression · ' + name);
      stockWarn(info);   // avertit, sans bloquer l'envoi
      return res.data;
    });
  }
  // Les bobines en production suffisent-elles pour ce batch ? (par filament : bobines du même type, couleur d'abord)
  function stockWarn(info) {
    loadSpools().then(function () {
      sortAll(); if (loaded) renderSpools();
      var miss = [];
      (info.fils || []).forEach(function (f) {
        var need = (+f.perLoop || 0) * (info.loops || 1);
        if (!(need > 0)) return;
        var cands = candidates(f.type, f.hex);
        var pool = cands.filter(function (b) { return isHex(f.hex) && isHex(b.spools[0].hex) && b.spools[0].hex.toLowerCase() === f.hex.toLowerCase(); });
        if (!pool.length) pool = cands;
        var have = pool.reduce(function (t, b) { return t + blockLeft(b); }, 0);
        if (need > have + 0.5) miss.push((f.type || 'Filament') + ' : il manque ' + grams(need - have) + (have > 0.5 ? ' (reste ' + grams(have) + ')' : ' (aucune bobine)'));
      });
      if (miss.length) caDialog.alert({ title: 'Pas assez de filament', message: miss.join(' · '), icon: 'warn' });
    }, function () {});
  }
  // Envoi direct depuis AutoLoop : texte du batch (+ projet .3mf pour compter les objets du plateau)
  window.CA.prodQueue = {
    addText: function (name, text, proj, plateName) {
      var objects = 0;
      if (proj && proj.plates) {
        var pl = proj.plates.filter(function (p) { return p.name === plateName; })[0];
        if (pl) objects = countObjects(proj.entries['Metadata/slice_info.config'], pl.n);
      }
      return enqueue(name, parseGcode(String(text).slice(0, HEAD_BYTES)), objects);
    }
  };

  function loadQueue() {
    return sb.from('production_queue').select('*').order('started_at', { ascending: true })
      .then(function (res) { queue = res.error ? [] : (res.data || []); }, function () { queue = []; });
  }
  function qProgress(j) {
    var tot = (+j.minutes || 0) * 60000;
    if (!tot) return { pct: null, txt: 'Durée inconnue' };
    var done = Date.now() - new Date(j.started_at).getTime(), pct = Math.max(0, Math.min(1, done / tot));
    if (pct >= 1) return { pct: 1, txt: 'Fini', end: true };
    return { pct: pct, txt: Math.floor(pct * 100) + ' % · reste ' + fmtHm(Math.ceil((tot - done) / 60000)) };
  }
  function queueItem(j) {
    var sp = spacerById(j.spacer_id), fils = (j.info && j.info.fils) || [], pr = qProgress(j);
    var g = fils.reduce(function (s, f) { return s + (+f.perLoop || 0) * (j.loops || 1); }, 0);
    var sub = [sp ? sp.name : 'Spacer à choisir', j.loops + ' loop' + (j.loops > 1 ? 's' : ''), grams(g)];
    var sw = fils.map(function (f) { return swatch(f.hex); }).join('');
    var on = String(fromQueue) === String(j.id);
    return '<div class="pr-q' + (pr.end ? ' is-end' : '') + (on ? ' is-on' : '') + '" data-id="' + esc(j.id) + '">' +
      '<div class="pr-q-top"><b class="pr-q-name" title="' + esc(j.file_name) + '">' + esc(j.file_name) + '</b>' +
        '<span class="pr-q-n">' + (j.pieces | 0) + ' adaptateur' + ((j.pieces | 0) > 1 ? 's' : '') + '</span></div>' +
      '<div class="pr-q-sub">' + sw + '<span>' + esc(sub.join(' · ')) + '</span></div>' +
      '<div class="pr-q-bar"' + (pr.pct == null ? ' hidden' : '') + '><i style="width:' + ((pr.pct || 0) * 100).toFixed(1) + '%"></i></div>' +
      '<div class="pr-q-foot"><span class="pr-q-t">' + esc(pr.txt) + '</span><span class="grow"></span>' +
        (on ? '<span class="pr-q-on">Dans le formulaire</span>'
            : (j.loops > 1 ? '<button class="btn btn-ghost btn-sm" type="button" data-act="stop">Arrêter à…</button>' : '') +
              '<button class="btn btn-ghost btn-sm" type="button" data-act="done" data-ic="check">Terminé</button>') +
        '<button class="pr-q-x" type="button" data-act="del" title="Retirer de la file" aria-label="Retirer de la file">✕</button></div>' +
    '</div>';
  }
  function renderQueue() {
    el.qN.textContent = queue.length ? '(' + queue.length + ')' : '';
    el.queue.innerHTML = queue.map(queueItem).join('');
    el.queue.hidden = !queue.length;
    paintBadge();
  }
  // pastille de la barre latérale : impressions finies, pas encore enregistrées
  function paintBadge() {
    var navN = $('#nav-prod-n'); if (!navN) return;
    var n = queue.filter(function (j) { return qProgress(j).end; }).length;
    navN.textContent = n; navN.hidden = !n;
    var tab = navN.closest('.tab');
    if (tab) tab.setAttribute('aria-label', 'Production' + (n ? ' (' + n + (n > 1 ? ' finies' : ' finie') + ')' : ''));
  }
  if (window.CA.onAdminReady) window.CA.onAdminReady(function () { loadQueue().then(paintBadge); });
  // barres : rafraîchies chaque minute ; pastille aussi quand l'onglet est caché
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (!el.queue.offsetParent) { loadQueue().then(paintBadge); return; }
    if (!queue.length) return;
    paintBadge();
    queue.forEach(function (j) {
      var it = el.queue.querySelector('.pr-q[data-id="' + j.id + '"]'); if (!it) return;
      var pr = qProgress(j), bar = it.querySelector('.pr-q-bar i');
      if (bar) bar.style.width = ((pr.pct || 0) * 100).toFixed(1) + '%';
      it.querySelector('.pr-q-t').textContent = pr.txt;
      it.classList.toggle('is-end', !!pr.end);
    });
  }, 60000);
  el.queue.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var it = b.closest('.pr-q'), id = it && it.getAttribute('data-id');
    var j = queue.filter(function (x) { return String(x.id) === String(id); })[0]; if (!j) return;
    if (b.getAttribute('data-act') === 'done') { loadJob(j); return; }
    if (b.getAttribute('data-act') === 'stop') { stopJob(j); return; }
    caDialog.confirm({ title: 'Retirer de la file ?', message: j.file_name + ' — rien n\'est ajouté au stock.', ok: 'Retirer' }).then(function (ok) {
      if (!ok) return;
      sb.from('production_queue').delete().eq('id', j.id).then(function (res) {
        if (res.error) { caDialog.error(res.error); return; }
        queue = queue.filter(function (x) { return x !== j; });
        if (String(fromQueue) === String(j.id)) fromQueue = null;
        renderQueue();
      });
    });
  });
  // « Terminé » : le batch passe dans le formulaire (pièces bonnes, bobines) avant l'enregistrement
  // « Arrêter à… » : batch coupé avant la fin -> n loops faits, durée et grammes au prorata
  function stopJob(j) {
    var per = j.loops > 0 && j.minutes > 0 ? j.minutes / j.loops : 0;
    var spent = per ? Math.floor((Date.now() - new Date(j.started_at).getTime()) / 60000 / per) : j.loops - 1;
    var guess = Math.max(1, Math.min(j.loops - 1, spent));
    caDialog.prompt({ title: 'Arrêté à combien de loops ?', message: j.file_name + ' : ' + j.loops + ' prévus.',
      value: String(guess), ok: 'Continuer', icon: 'clock' }).then(function (v) {
      if (v == null) return;
      var n = parseInt(v, 10);
      if (!isFinite(n) || n < 1) return;
      loadJob(j, Math.min(n, j.loops));
    });
  }
  function loadJob(j, stopAt) {
    var info = j.info || {}, n = stopAt && stopAt < j.loops ? stopAt : j.loops;
    var per = j.loops > 0 && j.minutes > 0 ? j.minutes / j.loops : 0;
    fromQueue = j.id;
    useFile(j.file_name, { isAuto: info.isAuto !== false, loops: n, minutes: per ? Math.round(per * n) : j.minutes, perLoopMin: per, fils: info.fils || [] }, info.objects || 0);
    if (j.spacer_id && spacerById(j.spacer_id)) spacerPk.set(j.spacer_id);
    el.perPlate.value = Math.max(1, j.per_plate | 0);
    syncGood(); recalc(); renderQueue();   // pièces bonnes = loops × pièces par plateau
    var form = el.spacer.closest('.al-card'); if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Nombre d'objets du plateau (slice_info.config) : pièces par plateau à défaut d'historique
  function countObjects(u8, plateN) {
    if (!u8) return 0;
    var xml = new TextDecoder('utf-8').decode(u8), n = 0;
    xml.replace(/<plate>[\s\S]*?<\/plate>/g, function (blk) {
      var idx = /<metadata key="index" value="(\d+)"/.exec(blk);
      if (idx && +idx[1] === plateN) n = (blk.match(/<object /g) || []).length;
      return blk;
    });
    return n;
  }
  // « 1 j 13h40 » / « 3h54 » / « 45 min » -> minutes
  function parseDur(s) {
    var d = /(\d+)\s*j/.exec(s), hm = /(\d+)\s*h\s*(\d+)?/.exec(s), mm = /(\d+)\s*min/.exec(s);
    return (d ? +d[1] * 1440 : 0) + (hm ? +hm[1] * 60 + (+hm[2] || 0) : mm ? +mm[1] : 0);
  }
  // « 1h 53m 44s » -> minutes
  function parseHms(s) {
    var h = /([\d.]+)\s*h/i.exec(s), m = /([\d.]+)\s*m(?!s)/i.exec(s), sec = /([\d.]+)\s*s/i.exec(s);
    return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) + (sec ? +sec[1] / 60 : 0);
  }
  function listOf(re, text, sep) { var m = re.exec(text); return m ? m[1].trim().split(sep) : []; }
  function parseGcode(head) {
    var isAuto = head.indexOf('Batch généré par AutoLoop') !== -1;
    var lm = /; === LOOP 1 OF (\d+) ===/.exec(head) || /^; (\d+) loops · /m.exec(head);
    var loops = isAuto && lm ? Math.max(1, +lm[1]) : 1;
    var dm = /Durée estimée du batch : ([^(\r\n]+)/.exec(head);
    var minutes = dm ? parseDur(dm[1]) : 0;
    if (!minutes) {
      var tm = /;\s*total estimated time:\s*([0-9hms .]+)/i.exec(head) || /;\s*model printing time:\s*([0-9hms .]+)/i.exec(head);
      minutes = tm ? parseHms(tm[1]) * loops : 0;
    }
    // poids : une valeur par filament utilisé (déjà × loops dans un batch AutoLoop)
    var w = listOf(/^;\s*total filament weight \[g\]\s*:\s*([\d.,\s]+)$/m, head, ',').map(function (v) { return +v || 0; });
    var slots = listOf(/^;\s*filament:\s*([\d,\s]+)$/m, head, ',').map(function (v) { return +v || 0; });
    var types = listOf(/^;\s*filament_type\s*=\s*(.+)$/m, head, ';');
    var cols = listOf(/^;\s*filament_colour\s*=\s*(.+)$/m, head, ';');
    var fils = [];
    w.forEach(function (g, i) {
      if (!(g > 0)) return;
      var slot = slots.length === w.length && slots[i] > 0 ? slots[i] : i + 1;
      fils.push({ type: (types[slot - 1] || '').trim(), hex: (cols[slot - 1] || '').trim(), perLoop: g / loops });
    });
    return { isAuto: isAuto, loops: loops, minutes: Math.round(minutes), fils: fils };
  }

  function useFile(name, info, objects) {
    file = { name: name, isAuto: info.isAuto, loops: info.loops, minutes: info.minutes, objects: objects, fils: info.fils };
    edited = { good: false, perPlate: false };
    var warn = [];
    if (!info.isAuto) warn.push('Ce fichier ne sort pas d\'AutoLoop : vérifie les loops et la durée.');
    if (!info.fils.length) warn.push('Poids de filament introuvable dans l\'en-tête.');
    el.fileWarn.textContent = warn.join(' ');
    el.fileWarn.hidden = !warn.length;
    el.loops.value = info.loops; lastLoops = info.loops;
    perLoopMin = info.minutes > 0 ? (info.perLoopMin || info.minutes / Math.max(1, info.loops)) : 0;
    el.timeH.value = Math.floor(info.minutes / 60); el.timeM.value = info.minutes % 60;
    var guess = detectSpacer(name);
    if (guess) spacerPk.set(guess.id);
    applyPerPlate();
    rows = buildRows();
    renderRows(); recalc();
  }

  // Spacer deviné d'après le nom du fichier (code maison, slug, n° remplacé, anciens noms)
  function norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function detectSpacer(name) {
    var fn = norm(name), best = null, bestLen = 0;
    spacers.forEach(function (sp) {
      var a = sp.attrs || {};
      var cands = [sp.name, sp.slug].concat((a.replaces || []).map(function (r) { return r && r.ref; }), a.aliases || []);
      cands.forEach(function (c) {
        var n = norm(c);
        if (n.length >= 4 && n.length > bestLen && fn.indexOf(n) !== -1) { best = sp; bestLen = n.length; }
      });
    });
    return best;
  }
  // Pièces par plateau : dernière production de ce spacer, sinon les objets du plateau
  function applyPerPlate() {
    if (edited.perPlate) return;
    var sp = spacerById(spacerPk.value);
    var last = sp ? prods.filter(function (p) { return String(p.spacer_id) === String(sp.id); })[0] : null;
    var v = last ? last.per_plate : (file && file.objects > 0 ? file.objects : (num(el.perPlate.value) || 1));
    el.perPlate.value = Math.max(1, v | 0);
    syncGood();
  }
  function syncGood() {
    if (edited.good) return;
    el.good.value = Math.max(1, num(el.loops.value) | 0) * Math.max(1, num(el.perPlate.value) | 0);
  }

  /* ---- Bobines utilisées : une rangée par filament du fichier, BLOC pré-choisi.
     On choisit un bloc (ex. PETG Basic · Black ×10) ; les grammes sont répartis sur ses
     bobines, la plus vieille d'abord (comme l'imprimante les vide) : allocate(). ---- */
  function typeMatch(s, type) {
    if (!type) return false;
    var words = ' ' + String(s.material || s.label || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ') + ' ';
    return words.indexOf(' ' + type.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() + ' ') !== -1;
  }
  function activeBlocks() { return blocksOf(activeSpools()); }
  function blockByKey(k) { return activeBlocks().filter(function (b) { return b.key === k; })[0] || null; }
  function blockLeft(b) { return b.spools.reduce(function (s, x) { return s + Math.max(0, leftOf(x)); }, 0); }
  // grammes encore libres dans un bloc, sans compter la rangée `skip`
  function availOfBlock(b, skip) {
    return blockLeft(b) - rows.reduce(function (sum, r, i) { return sum + (i !== skip && r.block === b.key ? (+r.grams || 0) : 0); }, 0);
  }
  function candidates(type, hex) {
    return activeBlocks().map(function (b) {
      var s = b.spools[0];
      var sc = (typeMatch(s, type) ? 2 : 0) + (isHex(hex) && isHex(s.hex) && s.hex.toLowerCase() === hex.toLowerCase() ? 1 : 0);
      return { b: b, sc: sc };
    }).filter(function (c) { return !type || c.sc >= 2; })
      .sort(function (a, z) { return z.sc - a.sc; })   // tri stable : ordre des Filaments à score égal
      .map(function (c) { return c.b; });
  }
  function buildRows() {
    rows = [];
    var loops = Math.max(1, num(el.loops.value) | 0);
    (file ? file.fils : []).forEach(function (f) {
      var need = round1(f.perLoop * loops), cands = candidates(f.type, f.hex);
      // remplit le meilleur bloc, la suite sur le suivant s'il ne suffit pas
      while (need > 0) {
        var free = cands.filter(function (b) { return availOfBlock(b, -1) > 0.05; });
        if (!free.length) { rows.push({ block: '', grams: need, type: f.type, hex: f.hex }); break; }
        var pick = free[0], g = free.length === 1 ? need : Math.min(need, round1(availOfBlock(pick, -1)));
        rows.push({ block: pick.key, grams: g, type: f.type, hex: f.hex });
        need = round1(need - g);
      }
    });
    return rows;
  }
  // Répartition réelle : chaque rangée sur les bobines de son bloc, dans l'ordre (plus vieille d'abord).
  // -> [{ parts: [{ s, g }], over }] (over = grammes qui ne tiennent pas dans le bloc, mis sur sa dernière bobine)
  function allocate() {
    var free = {}, bmap = {};
    activeSpools().forEach(function (s) { free[s.id] = Math.max(0, leftOf(s)); });
    activeBlocks().forEach(function (b) { bmap[b.key] = b; });
    return rows.map(function (r) {
      var b = bmap[r.block], need = round2(+r.grams || 0), parts = [];
      if (!b || need <= 0) return { parts: parts, over: 0 };
      b.spools.forEach(function (s) {
        if (need <= 0) return;
        var g = round2(Math.min(need, free[s.id]));
        if (g <= 0) return;
        parts.push({ s: s, g: g }); free[s.id] = round2(free[s.id] - g); need = round2(need - g);
      });
      if (need > 0) {
        var last = b.spools[b.spools.length - 1], p = parts.filter(function (x) { return x.s === last; })[0];
        if (p) p.g = round2(p.g + need); else parts.push({ s: last, g: need });
      }
      return { parts: parts, over: need };
    });
  }
  // prix payé complet de la bobine (la bobine vide ne réduit plus le coût — comme admin_save_production)
  function partsCost(parts) {
    return parts.reduce(function (sum, p) {
      return sum + round2(p.g * (+p.s.unit_cost || 0) / (+p.s.weight_g || 1000));
    }, 0);
  }
  // blocs en production pour le menu d'une rangée : marque · matière, couleur ×N, grammes restants
  function blockItems() {
    return activeBlocks().map(function (b) {
      var s = b.spools[0], p = String(s.label || '').split(' · '), left = blockLeft(b), n = b.spools.length;
      var nm = (p.length > 2 ? p.slice(2).join(' · ') : s.label) + (s.kind === 'refill' ? ' · recharge' : '');
      return { id: b.key, group: p.length > 2 ? p.slice(0, 2).join(' · ') : '', label: nm + (n > 1 ? ' ×' + n : ''),
        btn: shortLabel(s) + (n > 1 ? ' ×' + n : ''), meta: grams(left), bg: spoolBg(s), dim: left <= 0.05, find: s.label };
    });
  }
  function renderRows() {
    if (!rows.length) {
      el.uses.innerHTML = '<p class="muted pr-empty">' + (file ? 'Ajoute la bobine utilisée.' : 'Rempli à partir du G-code.') + '</p>';
      return;
    }
    el.uses.innerHTML = rows.map(function (r, i) {
      return '<div class="pr-use" data-i="' + i + '">' +
        // pastille de gauche = couleur demandée par le G-code (le bloc choisi a la sienne dans le menu)
        '<span class="pr-use-sw" title="' + esc(r.type ? 'G-code : ' + r.type : '') + '"' + (r.hex ? '' : ' style="visibility:hidden"') + '>' + swatch(r.hex) + '</span>' +
        '<div class="pr-use-spool"></div>' +
        '<span class="unit unit-sm" data-unit="g"><input type="number" class="pr-use-g num" min="0" step="0.1" value="' + esc(r.grams) + '" aria-label="Grammes"></span>' +
        '<span class="pr-use-cost"></span>' +
        '<button class="pr-x" type="button" aria-label="Retirer cette rangée"' + (rows.length > 1 ? '' : ' hidden') + '>×</button>' +
        '<p class="pr-use-warn" hidden></p>' +
      '</div>';
    }).join('');
    $$('.pr-use', el.uses).forEach(function (row) {
      var i = +row.getAttribute('data-i');
      var pk = new Picker($('.pr-use-spool', row), {
        placeholder: 'Choisir la bobine', search: activeBlocks().length > 6, items: blockItems,
        onPick: function (k) { rows[i].block = k; refreshRows(); recalc(); }
      });
      pk.btn.setAttribute('aria-label', 'Bobine');
      pk.set(rows[i].block);
    });
    refreshRows();
  }
  // coûts et alertes de chaque rangée (sans reconstruire les champs en cours de saisie)
  function refreshRows() {
    var al = allocate();
    $$('.pr-use', el.uses).forEach(function (row) {
      var i = +row.getAttribute('data-i'), r = rows[i], b = blockByKey(r.block);
      $('.pr-use-cost', row).textContent = b ? money(partsCost(al[i].parts)) : '—';
      var warn = '';
      if (b) {
        if (al[i].over > 0.05) {
          var other = candidates(r.type, b.spools[0].hex).some(function (x) { return x !== b && availOfBlock(x, -1) > 0.05; });
          warn = 'Il manque ' + grams(al[i].over) + (other ? ' · <button type="button" class="al-link" data-split>Répartir</button>' : '');
        }
        if (r.type && !typeMatch(b.spools[0], r.type)) warn = (warn ? warn + ' · ' : '') + 'Le fichier dit ' + esc(r.type);
      }
      var w = $('.pr-use-warn', row);
      w.innerHTML = warn; w.hidden = !warn;
    });
  }
  el.uses.addEventListener('input', function (e) {
    var row = e.target.closest('.pr-use'); if (!row) return;
    if (e.target.classList.contains('pr-use-g')) { rows[+row.getAttribute('data-i')].grams = num(e.target.value) || 0; refreshRows(); recalc(); }
  });
  el.uses.addEventListener('click', function (e) {
    var row = e.target.closest('.pr-use'); if (!row) return;
    var i = +row.getAttribute('data-i');
    if (e.target.closest('.pr-x')) { rows.splice(i, 1); renderRows(); recalc(); return; }
    if (e.target.closest('[data-split]')) {
      var r = rows[i], b = blockByKey(r.block);
      if (!b) return;
      var free = Math.max(0, round1(availOfBlock(b, i))), over = round1(r.grams - free);
      r.grams = free;
      var next = candidates(r.type, b.spools[0].hex).filter(function (x) { return x !== b && availOfBlock(x, -1) > 0.05; })[0];
      // le bloc suivant a déjà sa rangée : le surplus s'y ajoute
      var same = next ? rows.filter(function (x) { return x.block === next.key; })[0] : null;
      if (same) same.grams = round1((+same.grams || 0) + over);
      else rows.splice(i + 1, 0, { block: next ? next.key : '', grams: over, type: r.type, hex: r.hex });
      renderRows(); recalc();
    }
  });
  el.useAdd.addEventListener('click', function () {
    rows.push({ block: '', grams: 0, type: '', hex: '' });
    renderRows(); recalc();
    var last = $$('.pr-use-spool .pr-pk-btn', el.uses).pop(); if (last) last.focus();
  });

  /* ---- champs ---- */
  // spacer : code maison + n° remplacés + stock ; recherche aussi par anciens noms
  function refsOf(sp) { return ((sp.attrs && sp.attrs.replaces) || []).map(function (r) { return r && r.ref; }).filter(Boolean); }
  var spacerPk = new Picker(el.spacer, {
    placeholder: 'Choisir le spacer', search: true,
    items: function () {
      return spacers.map(function (sp) {
        var refs = refsOf(sp), n = sp.qty | 0;
        return { id: sp.id, label: sp.name, meta: (refs.length ? refs.join(', ') + ' · ' : '') + n + ' paire' + (n > 1 ? 's' : ''),
          find: ((sp.attrs && sp.attrs.aliases) || []).join(' ') + ' ' + (sp.slug || '') };
      });
    },
    onPick: function () { applyPerPlate(); recalc(); }
  });
  el.loops.addEventListener('input', function () {
    var n = Math.max(1, num(el.loops.value) | 0);
    // les grammes suivent le nombre de loops
    if (lastLoops && n !== lastLoops) rows.forEach(function (r) { r.grams = round1((+r.grams || 0) * n / lastLoops); });
    lastLoops = n;
    // la durée suit aussi : loops × (loop + cooldown) du batch chargé ; modifiable ensuite
    if (perLoopMin > 0) { var mins = Math.round(perLoopMin * n); el.timeH.value = Math.floor(mins / 60); el.timeM.value = mins % 60; }
    syncGood(); renderRows(); recalc();
  });
  el.perPlate.addEventListener('input', function () { edited.perPlate = true; syncGood(); recalc(); });
  el.good.addEventListener('input', function () { edited.good = true; recalc(); });
  [el.timeH, el.timeM, el.date].forEach(function (x) { x.addEventListener('input', recalc); });

  function renderSpacerOptions() { spacerPk.render(); }

  /* ---- calcul (même règle que admin_save_production) ---- */
  function minutesOf() { return Math.max(0, (num(el.timeH.value) || 0) * 60 + (num(el.timeM.value) || 0)); }
  function avgOf(sp) {
    var ac = sp && sp.attrs && sp.attrs.avg_cost && sp.attrs.avg_cost.item;
    return (ac != null && ac !== '' && isFinite(+ac)) ? +ac : (+(sp && sp.cost_price) || 0);
  }
  function calc() {
    var sp = spacerById(spacerPk.value);
    var al = allocate(), used = rows.filter(function (r) { return r.block && (+r.grams || 0) > 0; });
    var g = used.reduce(function (s, r) { return s + (+r.grams || 0); }, 0);
    var fil = al.reduce(function (s, a) { return s + partsCost(a.parts); }, 0);
    // grammes par bobine (rangées fusionnées) -> envoyés tels quels à admin_save_production
    var bySpool = {}, spoolUses = [];
    al.forEach(function (a) {
      a.parts.forEach(function (p) {
        if (!bySpool[p.s.id]) { bySpool[p.s.id] = { spool_id: p.s.id, grams: 0 }; spoolUses.push(bySpool[p.s.id]); }
        bySpool[p.s.id].grams = round2(bySpool[p.s.id].grams + p.g);
      });
    });
    var minutes = minutesOf(), rate = rates.elec + rates.deprec;
    var mach = round2(minutes / 60 * rate);
    var total = round2(fil + mach), good = Math.max(0, num(el.good.value) | 0);
    var piece = good > 0 ? total / good : null;
    var loose = sp && sp.attrs && sp.attrs.loose && sp.attrs.loose.n > 0 ? sp.attrs.loose : null;
    var lin = loose ? 1 : 0, linc = loose ? (+loose.cost || 0) : 0;
    var all = good + lin, pairs = Math.floor(all / 2), lout = all % 2;
    var loutc = lout ? (good > 0 ? piece : linc) : 0;
    var pairc = pairs > 0 ? (total + linc - loutc) / pairs : null;
    var cur = sp ? avgOf(sp) : null, next = cur;
    if (sp && pairs > 0) {
      var seed = (sp.attrs || {}).prod_seed;
      var sq = seed ? (+seed.qty || 0) : ((+sp.cost_price || 0) > 0 ? Math.max(0, sp.qty | 0) : 0);
      var scost = seed ? (+seed.cost || 0) : (+sp.cost_price || 0);
      var Q = sq, C = sq * scost;
      prods.forEach(function (p) {
        if (String(p.spacer_id) === String(sp.id) && p.pairs > 0 && p.pair_cost != null) { Q += p.pairs; C += p.pairs * (+p.pair_cost); }
      });
      Q += pairs; C += pairs * pairc;
      next = round2(C / Q);
    }
    return { sp: sp, used: used, spoolUses: spoolUses, g: g, fil: round2(fil), minutes: minutes, rate: rate, mach: mach, total: total, good: good,
      lin: lin, lout: lout, pairs: pairs, pairc: pairc, cur: cur, next: next,
      missing: rows.filter(function (r) { return !r.block && (+r.grams || 0) > 0; }).length };
  }
  function srow(k, v, cls) { return '<div class="al-srow"><span>' + k + '</span><span' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</span></div>'; }
  function marginTxt(price, cost) {
    var p = +price || 0, m = p - cost;
    return money(m) + (p > 0 ? ' · ' + Math.round(m / p * 100) + ' %' : '');
  }
  function recalc() {
    var r = calc(), problem = '';
    if (!file && !rows.length) problem = '';
    else if (!r.sp) problem = 'Choisis le spacer.';
    else if (r.missing) problem = 'Choisis la bobine de chaque filament.';
    else if (!r.used.length) problem = 'Indique la bobine utilisée.';
    el.save.disabled = !r.sp || !r.used.length || !!r.missing || saving;
    el.status.textContent = problem;
    if (!file && !rows.length) { el.report.innerHTML = '<p class="muted">« Terminé » sur un batch en impression pour commencer.</p>'; return; }
    var html = '';
    html += srow('Filament <em>' + grams(r.g) + '</em>', money(r.fil));
    html += srow('Électricité + usure <em>' + fmtHm(r.minutes) + ' × ' + money(r.rate) + '/h</em>', money(r.mach));
    html += srow('Total', money(r.total));
    html += '<div class="al-cost"><span>COÛT / PAIRE</span><b>' + (r.pairc != null ? money(r.pairc) : '—') + '</b></div>';
    html += srow('Paires ajoutées', String(r.pairs) + (r.lin && !r.lout ? ' <em>réserve complétée</em>' : ''));
    if (r.lout) html += srow('Pièce seule', '1 en réserve');
    if (r.good === 0) html += srow('Pièces bonnes', 'aucune', 'al-bad');
    if (r.sp) {
      html += srow('Coût moyen', money(r.cur) + (round2(r.next) !== round2(r.cur) ? ' → <b>' + money(r.next) + '</b>' : ''));
      html += srow('Marge client', marginTxt(r.sp.sell_price, r.next));
      html += srow('Marge dealer', marginTxt(r.sp.dealer_price != null ? r.sp.dealer_price : r.sp.sell_price, r.next));
    }
    el.report.innerHTML = html;
  }

  /* ---- enregistrement ---- */
  el.save.addEventListener('click', function () {
    var r = calc();
    if (!r.sp || !r.used.length || r.missing || saving) return;
    saving = true; el.save.disabled = true; el.status.textContent = 'Enregistrement…';
    var loops = Math.max(1, num(el.loops.value) | 0), per = Math.max(1, num(el.perPlate.value) | 0);
    var payload = {
      spacer_id: r.sp.id, made_at: el.date.value || todayISO(), file_name: file ? file.name : null,
      loops: loops, per_plate: per, pieces: loops * per,
      good: r.good, minutes: Math.round(r.minutes), machine_cost: r.mach,
      rates: { elec: rates.elec, deprec: rates.deprec },
      uses: r.spoolUses
    };
    sb.rpc('admin_save_production', { p: payload }).then(function (res) {
      saving = false;
      if (res.error) { el.status.textContent = 'Erreur : ' + res.error.message; el.save.disabled = false; return; }
      var d = res.data || {};
      toast('Production enregistrée · ' + (d.pairs | 0) + ' paire' + ((d.pairs | 0) > 1 ? 's' : ''));
      file = null; rows = []; edited = { good: false, perPlate: false };
      el.fileWarn.hidden = true;
      // batch confirmé : sort de la file « En impression »
      if (fromQueue) {
        var qid = fromQueue; fromQueue = null;
        queue = queue.filter(function (x) { return String(x.id) !== String(qid); }); renderQueue();
        sb.from('production_queue').delete().eq('id', qid).then(function (r2) { if (r2.error) toast('File : ' + r2.error.message, 'bad'); });
      }
      el.timeH.value = 0; el.timeM.value = 0; el.loops.value = 1; lastLoops = 1; perLoopMin = 0;
      reloadAfterChange();
    }, function (err) { saving = false; el.save.disabled = false; el.status.textContent = 'Erreur : ' + errText(err); });
  });

  function reloadAfterChange() {
    loadAll().then(function () { if (window.CA.reloadSpacers) window.CA.reloadSpacers(); });
  }

  /* =========================================================
     3) HISTORIQUE
     ========================================================= */
  el.refresh.addEventListener('click', loadAll);
  function renderHistory() {
    if (!prods.length && !removals.length) { el.history.innerHTML = '<p class="muted pr-empty">Aucune production pour l\'instant.</p>'; return; }
    var latest = {};   // la plus récente de chaque spacer (seule supprimable)
    prods.forEach(function (p) { var k = String(p.spacer_id); if (!latest[k]) latest[k] = p.id; });
    var byProd = {};
    uses.forEach(function (u) { (byProd[u.production_id] = byProd[u.production_id] || []).push(u); });
    // productions + retraits de grammes (un retrait = un batch), du plus récent au plus ancien
    var entries = prods.map(function (p) { return { p: p, d: p.made_at, c: p.created_at }; }), remMap = {};
    removals.forEach(function (r) {
      var g = remMap[r.batch];
      if (!g) { g = remMap[r.batch] = { rem: true, batch: r.batch, d: r.removed_at, c: r.created_at, note: r.note || '', rows: [] }; entries.push(g); }
      g.rows.push(r);
    });
    entries.sort(function (a, z) { return String(z.d).localeCompare(String(a.d)) || String(z.c).localeCompare(String(a.c)); });
    function remRow(en) {
      var grp = {}, order = [], tot = 0;
      en.rows.forEach(function (r) {
        var s = spoolById(r.spool_id), k = s ? blockKey(s) : '?';
        if (!grp[k]) { grp[k] = { s: s, g: 0 }; order.push(k); }
        grp[k].g += +r.grams || 0; tot += +r.grams || 0;
      });
      var fil = order.map(function (k) {
        var x = grp[k];
        return '<span class="pr-hfil">' + swatchBg(spoolBg(x.s)) + esc(x.s ? shortLabel(x.s) : 'Bobine retirée') + ' <em>' + grams(x.g) + '</em></span>';
      }).join('');
      return '<tr data-batch="' + esc(en.batch) + '">' +
        '<td class="pr-nowrap">' + esc(shortDay(en.d)) + '</td>' +
        '<td><b>Retrait</b>' + (en.note ? '<span class="pr-file" title="' + esc(en.note) + '">' + esc(en.note) + '</span>' : '') + '</td>' +
        '<td>' + (fil || '—') + '</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>' +
        '<td class="pr-nowrap pr-act"><button class="btn btn-ghost btn-sm" type="button" data-undo-rem>Annuler</button></td>' +
      '</tr>';
    }
    el.history.innerHTML = '<div class="rcp-table-wrap"><table class="rcp-table pr-table"><thead><tr>' +
      '<th>Date</th><th>Spacer</th><th>Filament</th><th class="num">Pièces</th><th class="num">Paires</th><th class="num">Coût / paire</th><th></th>' +
      '</tr></thead><tbody>' + entries.map(function (en) {
        if (en.rem) return remRow(en);
        var p = en.p;
        // filaments de la production, regroupés par bloc (même filament + format), dans l'ordre des Filaments
        var grp = {}, order = [];
        (byProd[p.id] || []).slice().sort(function (a, z) { return spools.indexOf(spoolById(a.spool_id)) - spools.indexOf(spoolById(z.spool_id)); })
          .forEach(function (u) {
            var s = spoolById(u.spool_id), k = s ? blockKey(s) : '?';
            if (!grp[k]) { grp[k] = { s: s, g: 0, n: 0 }; order.push(k); }
            grp[k].g += +u.grams || 0; grp[k].n++;
          });
        var fil = order.map(function (k) {
          var x = grp[k];
          return '<span class="pr-hfil">' + swatchBg(spoolBg(x.s)) + esc(x.s ? shortLabel(x.s) : 'Bobine retirée') +
            (x.n > 1 ? ' ×' + x.n : '') + ' <em>' + grams(x.g) + '</em></span>';
        }).join('');
        var canDel = latest[String(p.spacer_id)] === p.id;
        return '<tr data-id="' + esc(p.id) + '">' +
          '<td class="pr-nowrap">' + esc(shortDay(p.made_at)) + '</td>' +
          '<td><b>' + esc(p.spacer_label) + '</b>' + (p.file_name ? '<span class="pr-file" title="' + esc(p.file_name) + '">' + esc(p.file_name) + '</span>' : '') + '</td>' +
          '<td>' + (fil || '—') + '</td>' +
          '<td class="num pr-nowrap" title="Bonnes / lancées">' + (p.good | 0) + ' / ' + (p.pieces | 0) + '</td>' +
          '<td class="num pr-nowrap">' + (p.pairs | 0) + (p.loose_out ? ' <em>+1</em>' : '') + '</td>' +
          '<td class="num pr-nowrap" title="Total ' + esc(money(p.total_cost)) + '">' + (p.pair_cost != null ? money(p.pair_cost) : '—') + '</td>' +
          '<td class="pr-nowrap pr-act">' + (canDel ? '<button class="btn btn-ghost btn-sm" type="button" data-del data-ic="trash">Supprimer</button>' : '') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  el.history.addEventListener('click', function (e) {
    var u = e.target.closest('[data-undo-rem]');
    if (u) { undoRemoval(u.closest('tr')); return; }
    var b = e.target.closest('[data-del]'); if (!b) return;
    var id = b.closest('tr').getAttribute('data-id');
    var p = prods.filter(function (x) { return String(x.id) === id; })[0];
    if (!p) return;
    caDialog.confirm({ title: 'Supprimer cette production ?',
      message: p.spacer_label + ' perd ' + (p.pairs | 0) + ' paire' + ((p.pairs | 0) > 1 ? 's' : '') + ' de stock ; les grammes reviennent aux bobines.',
      ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
      if (!ok) return;
      b.disabled = true;
      sb.rpc('admin_delete_production', { p_id: p.id }).then(function (res) {
        if (res.error) { b.disabled = false; caDialog.error(res.error); return; }
        toast('Production supprimée');
        reloadAfterChange();
      });
    });
  });
})();
