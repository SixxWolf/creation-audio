/* =========================================================
   Création Audio V2 — Stock › Production (spacers imprimés)
   1) BOBINES EN PRODUCTION : une bobine (ou recharge) du stock de vente est
      « sortie » pour imprimer (RPC admin_take_spool : −1 au stock, prix payé
      figé, 1000 g par défaut). Grammes restants = poids − Σ productions.
      Retirer (jamais utilisée) la remet au stock ; Terminer la range.
   2) PRODUCTION : on glisse le batch sorti d'AutoLoop (.gcode.3mf ou .gcode).
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
  function grams(n) { var v = Math.round((+n || 0) * 10) / 10; return String(v).replace('.', ',') + ' g'; }
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
  var spacers = [], filaments = [], spools = [], uses = [], prods = [];
  var rates = { elec: 0.2, deprec: 0.25 };
  var file = null;          // G-code lu : { name, isAuto, loops, minutes, objects, fils: [{ type, hex, perLoop }] }
  var rows = [];            // filament utilisé : [{ spool: id|'', grams, type, hex }]
  var edited = { good: false, perPlate: false };
  var lastLoops = 1;

  var el = {
    takeOpen: $('#pr-take-open'), take: $('#pr-take'), takeFil: $('#pr-take-fil'), takeKind: $('#pr-take-kind'), takeQty: $('#pr-take-qty'),
    takeCost: $('#pr-take-cost'), takeWeight: $('#pr-take-weight'), takeSave: $('#pr-take-save'),
    takeCancel: $('#pr-take-cancel'), takeStatus: $('#pr-take-status'),
    spools: $('#pr-spools'), doneWrap: $('#pr-done-wrap'), doneN: $('#pr-done-n'), done: $('#pr-done'),
    drop: $('#pr-drop'), file: $('#pr-file'), fileName: $('#pr-file-name'), fileWarn: $('#pr-file-warn'),
    spacer: $('#pr-spacer'), loops: $('#pr-loops'), perPlate: $('#pr-per-plate'), good: $('#pr-good'),
    timeH: $('#pr-time-h'), timeM: $('#pr-time-m'), date: $('#pr-date'),
    uses: $('#pr-uses'), useAdd: $('#pr-use-add'),
    save: $('#pr-save'), report: $('#pr-report'), status: $('#pr-status'),
    history: $('#pr-history'), refresh: $('#pr-refresh')
  };
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
      loadSpacers(), loadFilaments(), loadSpools(), loadProds(), loadRates(), loadBrandOrder()
    ]).then(function () {
      sortAll();
      renderSpools(); renderTakeOptions(); renderSpacerOptions(); renderRows(); recalc(); renderHistory();
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
      sb.from('production_uses').select('production_id,spool_id,grams,cost')
    ]).then(function (r) { spools = q(r[0]); uses = q(r[1]); });
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
  function usedOf(id) { return uses.reduce(function (s, u) { return s + (String(u.spool_id) === String(id) ? (+u.grams || 0) : 0); }, 0); }
  function leftOf(s) { return (+s.weight_g || 0) - usedOf(s.id); }
  function activeSpools() { return spools.filter(function (s) { return s.status === 'active'; }); }
  function kindTxt(k) { return k === 'refill' ? 'Recharge' : 'Bobine'; }
  function swatch(hex) { return swatchBg(isHex(hex) ? hex : 'var(--line-2)'); }
  // pastille d'une bobine de production : celle de son filament (multicolore, paillettes), sinon sa couleur figée
  function spoolBg(s) { return s ? filBg(filById(s.product_id), s.hex) : 'var(--line-2)'; }
  // « Bambu Lab · PETG Basic · Black » -> « PETG Basic · Black » (la marque prend de la place)
  function shortLabel(s) { var p = String(s.label || '').split(' · '); return p.length > 2 ? p.slice(1).join(' · ') : (s.label || ''); }

  /* =========================================================
     1) BOBINES EN PRODUCTION
     ========================================================= */
  function spoolRow(s, done) {
    var used = usedOf(s.id), w = +s.weight_g || 1000, left = w - used;
    var pct = Math.max(0, Math.min(100, left / w * 100));
    var n = Object.keys(uses.filter(function (u) { return String(u.spool_id) === String(s.id); })
      .reduce(function (acc, u) { acc[u.production_id] = 1; return acc; }, {})).length;
    var meta = [kindTxt(s.kind), money(s.unit_cost), 'sortie le ' + shortDay(s.taken_at)];
    if (!s.stock_taken) meta.push('hors stock');
    var act = done
      ? '<button class="btn btn-ghost btn-sm" type="button" data-act="reopen">Rouvrir</button>'
      : used > 0
        ? '<button class="btn btn-ghost btn-sm" type="button" data-act="close">Terminer</button>'
        : '<button class="btn btn-ghost btn-sm" type="button" data-act="remove" title="Remettre au stock de vente">Retirer</button>';
    return '<div class="pr-spool' + (done ? ' is-done' : '') + '" data-id="' + esc(s.id) + '">' +
      swatchBg(spoolBg(s)) +
      '<div class="pr-sp-main"><b>' + esc(s.label) + '</b><span class="pr-sp-meta">' + esc(meta.join(' · ')) + '</span></div>' +
      (done
        ? '<span class="pr-sp-left">' + grams(used) + ' · ' + n + ' prod.' + (left > 0.5 ? ' · perte ' + grams(left) : '') + '</span>'
        : '<div class="pr-sp-gauge"><div class="pr-bar"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
          '<span class="pr-sp-left' + (left < 0 ? ' is-neg' : '') + '">' + grams(left) + ' <em>/ ' + grams(w) + '</em></span></div>') +
      '<div class="pr-sp-act">' + act + '</div>' +
    '</div>';
  }
  function renderSpools() {
    var act = activeSpools(), done = spools.filter(function (s) { return s.status === 'done'; });
    el.spools.innerHTML = act.length ? act.map(function (s) { return spoolRow(s, false); }).join('')
      : '<p class="muted pr-empty">Aucune bobine en production.</p>';
    el.doneWrap.hidden = !done.length;
    el.doneN.textContent = done.length ? '(' + done.length + ')' : '';
    el.done.innerHTML = done.map(function (s) { return spoolRow(s, true); }).join('');
  }
  [el.spools, el.done].forEach(function (box) {
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var s = spoolById(b.closest('.pr-spool').getAttribute('data-id'));
      if (s) spoolAction(s, b.getAttribute('data-act'), b);
    });
  });
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
    var patch = act === 'close' ? { status: 'done', closed_at: new Date().toISOString() } : { status: 'active', closed_at: null };
    sb.from('production_spools').update(patch).eq('id', s.id).select().then(function (res) {
      btn.disabled = false;
      if (res.error) { caDialog.error(res.error); return; }
      toast(act === 'close' ? 'Bobine terminée' : 'Bobine rouverte');
      Object.assign(s, patch);
      renderSpools(); renderRows(); recalc();
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
     2) PRODUCTION — lecture du G-code
     ========================================================= */
  el.drop.addEventListener('click', function () { el.file.click(); });
  el.drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); } });
  el.file.addEventListener('change', function () { if (el.file.files[0]) readFile(el.file.files[0]); el.file.value = ''; });
  el.drop.addEventListener('dragover', function (e) { e.preventDefault(); el.drop.classList.add('drag'); });
  el.drop.addEventListener('dragleave', function () { el.drop.classList.remove('drag'); });
  el.drop.addEventListener('drop', function (e) {
    e.preventDefault(); el.drop.classList.remove('drag');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  var HEAD_BYTES = 3 * 1024 * 1024;   // en-tête + bloc de config : largement dans les 3 premiers Mo
  function decodeHead(u8) { return new TextDecoder('utf-8').decode(u8.subarray(0, Math.min(u8.length, HEAD_BYTES))); }
  function readFile(f) {
    el.fileName.textContent = 'Lecture de ' + f.name + '…';
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var u8 = new Uint8Array(e.target.result), head, objects = 0;
        if (window.ALProject && window.ALProject.isZip(u8)) {
          var proj = window.ALProject.read(u8);
          if (!proj.plates.length) throw new Error('Ce .3mf ne contient pas de plateau tranché.');
          // le plateau bouclé par AutoLoop (sinon le premier)
          var plate = proj.plates.filter(function (p) {
            return decodeHead(proj.entries[p.name].subarray(0, 2048)).indexOf('Batch généré par AutoLoop') !== -1;
          })[0] || proj.plates[0];
          head = decodeHead(proj.entries[plate.name]);
          objects = countObjects(proj.entries['Metadata/slice_info.config'], plate.n);
        } else head = decodeHead(u8);
        useFile(f.name, parseGcode(head), objects);
      } catch (err) {
        fileError(errText(err));
      }
    };
    reader.onerror = function () { fileError('Impossible de lire ce fichier.'); };
    reader.readAsArrayBuffer(f);
  }
  function fileError(msg) {
    el.drop.classList.remove('has-file');
    el.fileName.textContent = 'AutoLoop › Télécharger le gcode';
    el.fileWarn.textContent = msg; el.fileWarn.hidden = false;
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
    var tot = info.fils.reduce(function (s, f) { return s + f.perLoop * info.loops; }, 0);
    el.drop.classList.add('has-file');
    el.fileName.textContent = name + ' · ' + info.loops + ' loop' + (info.loops > 1 ? 's' : '') + ' · ' + grams(tot) +
      (info.minutes ? ' · ' + fmtHm(info.minutes) : '');
    el.loops.value = info.loops; lastLoops = info.loops;
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

  /* ---- Bobines utilisées : une rangée par filament du fichier, bobine pré-choisie ---- */
  function typeMatch(s, type) {
    if (!type) return false;
    var words = ' ' + String(s.material || s.label || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ') + ' ';
    return words.indexOf(' ' + type.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() + ' ') !== -1;
  }
  // grammes encore libres sur une bobine, sans compter la rangée `skip`
  function availOf(s, skip) {
    return leftOf(s) - rows.reduce(function (sum, r, i) { return sum + (i !== skip && String(r.spool) === String(s.id) ? (+r.grams || 0) : 0); }, 0);
  }
  function candidates(type, hex) {
    return activeSpools().map(function (s) {
      var sc = (typeMatch(s, type) ? 2 : 0) + (isHex(hex) && isHex(s.hex) && s.hex.toLowerCase() === hex.toLowerCase() ? 1 : 0);
      return { s: s, sc: sc };
    }).filter(function (c) { return !type || c.sc >= 2; })
      .sort(function (a, b) { return b.sc - a.sc; })   // tri stable : les plus vieilles bobines d'abord
      .map(function (c) { return c.s; });
  }
  function buildRows() {
    rows = [];
    var loops = Math.max(1, num(el.loops.value) | 0);
    (file ? file.fils : []).forEach(function (f) {
      var need = round1(f.perLoop * loops), cands = candidates(f.type, f.hex);
      // remplit la meilleure bobine, la suite sur la suivante si elle ne suffit pas
      while (need > 0) {
        var free = cands.filter(function (s) { return availOf(s, -1) > 0.05; });
        if (!free.length) { rows.push({ spool: '', grams: need, type: f.type, hex: f.hex }); break; }
        var pick = free[0], g = free.length === 1 ? need : Math.min(need, round1(availOf(pick, -1)));
        rows.push({ spool: pick.id, grams: g, type: f.type, hex: f.hex });
        need = round1(need - g);
      }
    });
    return rows;
  }
  // bobines en production pour le menu d'une rangée : marque · matière, couleur, grammes restants
  function spoolItems() {
    return activeSpools().map(function (s) {
      var p = String(s.label || '').split(' · '), left = leftOf(s);
      return { id: s.id, group: p.length > 2 ? p.slice(0, 2).join(' · ') : '', label: (p.length > 2 ? p.slice(2).join(' · ') : s.label) + (s.kind === 'refill' ? ' · recharge' : ''),
        btn: shortLabel(s), meta: grams(left), bg: spoolBg(s), dim: left <= 0.05, find: s.label };
    });
  }
  function renderRows() {
    if (!rows.length) {
      el.uses.innerHTML = '<p class="muted pr-empty">' + (file ? 'Ajoute la bobine utilisée.' : 'Rempli à partir du G-code.') + '</p>';
      return;
    }
    el.uses.innerHTML = rows.map(function (r, i) {
      return '<div class="pr-use" data-i="' + i + '">' +
        // pastille de gauche = couleur demandée par le G-code (la bobine choisie a la sienne dans le menu)
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
        placeholder: 'Choisir la bobine', search: activeSpools().length > 6, items: spoolItems,
        onPick: function (id) { rows[i].spool = id; refreshRows(); recalc(); }
      });
      pk.btn.setAttribute('aria-label', 'Bobine');
      pk.set(rows[i].spool);
    });
    refreshRows();
  }
  // coûts et alertes de chaque rangée (sans reconstruire les champs en cours de saisie)
  function refreshRows() {
    $$('.pr-use', el.uses).forEach(function (row) {
      var i = +row.getAttribute('data-i'), r = rows[i], s = spoolById(r.spool);
      $('.pr-use-cost', row).textContent = s ? money(rowCost(r)) : '—';
      var warn = '';
      if (s) {
        var over = round2((+r.grams || 0) - availOf(s, i));
        if (over > 0.05) warn = 'Dépasse la bobine de ' + grams(over) + (activeSpools().length > 1 ? ' · <button type="button" class="al-link" data-split>Répartir</button>' : '');
        if (r.type && !typeMatch(s, r.type)) warn = (warn ? warn + ' · ' : '') + 'Le fichier dit ' + esc(r.type);
      }
      var w = $('.pr-use-warn', row);
      w.innerHTML = warn; w.hidden = !warn;
    });
  }
  function rowCost(r) {
    var s = spoolById(r.spool);
    return s ? round2((+r.grams || 0) * (+s.unit_cost || 0) / (+s.weight_g || 1000)) : 0;
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
      var r = rows[i], s = spoolById(r.spool);
      if (!s) return;
      var free = Math.max(0, round1(availOf(s, i))), over = round1(r.grams - free);
      r.grams = free;
      var next = candidates(r.type, s.hex).filter(function (x) { return x !== s && availOf(x, -1) > 0.05; })[0];
      // la bobine suivante a déjà sa rangée : le surplus s'y ajoute
      var same = next ? rows.filter(function (x) { return String(x.spool) === String(next.id); })[0] : null;
      if (same) same.grams = round1((+same.grams || 0) + over);
      else rows.splice(i + 1, 0, { spool: next ? next.id : '', grams: over, type: r.type, hex: r.hex });
      renderRows(); recalc();
    }
  });
  el.useAdd.addEventListener('click', function () {
    rows.push({ spool: '', grams: 0, type: '', hex: '' });
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
    var used = rows.filter(function (r) { return r.spool && (+r.grams || 0) > 0; });
    var g = used.reduce(function (s, r) { return s + (+r.grams || 0); }, 0);
    var fil = used.reduce(function (s, r) { return s + rowCost(r); }, 0);
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
    return { sp: sp, used: used, g: g, fil: round2(fil), minutes: minutes, rate: rate, mach: mach, total: total, good: good,
      lin: lin, lout: lout, pairs: pairs, pairc: pairc, cur: cur, next: next,
      missing: rows.filter(function (r) { return !r.spool && (+r.grams || 0) > 0; }).length };
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
    if (!file && !rows.length) { el.report.innerHTML = '<p class="muted">Glisse un G-code pour commencer.</p>'; return; }
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
      uses: r.used.map(function (u) { return { spool_id: u.spool, grams: round2(u.grams) }; })
    };
    sb.rpc('admin_save_production', { p: payload }).then(function (res) {
      saving = false;
      if (res.error) { el.status.textContent = 'Erreur : ' + res.error.message; el.save.disabled = false; return; }
      var d = res.data || {};
      toast('Production enregistrée · ' + (d.pairs | 0) + ' paire' + ((d.pairs | 0) > 1 ? 's' : ''));
      file = null; rows = []; edited = { good: false, perPlate: false };
      el.drop.classList.remove('has-file');
      el.fileName.textContent = 'AutoLoop › Télécharger le gcode';
      el.fileWarn.hidden = true;
      el.timeH.value = 0; el.timeM.value = 0; el.loops.value = 1; lastLoops = 1;
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
    if (!prods.length) { el.history.innerHTML = '<p class="muted pr-empty">Aucune production pour l\'instant.</p>'; return; }
    var latest = {};   // la plus récente de chaque spacer (seule supprimable)
    prods.forEach(function (p) { var k = String(p.spacer_id); if (!latest[k]) latest[k] = p.id; });
    var byProd = {};
    uses.forEach(function (u) { (byProd[u.production_id] = byProd[u.production_id] || []).push(u); });
    el.history.innerHTML = '<div class="rcp-table-wrap"><table class="rcp-table pr-table"><thead><tr>' +
      '<th>Date</th><th>Spacer</th><th>Filament</th><th class="num">Pièces</th><th class="num">Paires</th><th class="num">Coût / paire</th><th></th>' +
      '</tr></thead><tbody>' + prods.map(function (p) {
        var fil = (byProd[p.id] || []).slice().sort(function (a, z) { return spools.indexOf(spoolById(a.spool_id)) - spools.indexOf(spoolById(z.spool_id)); }).map(function (u) {
          var s = spoolById(u.spool_id);
          return '<span class="pr-hfil">' + swatchBg(spoolBg(s)) + esc(s ? shortLabel(s) : 'Bobine retirée') + ' <em>' + grams(u.grams) + '</em></span>';
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
