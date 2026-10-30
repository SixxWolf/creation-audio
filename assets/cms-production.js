/* =========================================================
   Création Audio V2 — Stock › Production (spacers imprimés)
   1) EN IMPRESSION → PRODUCTION : le batch sorti d'AutoLoop (.gcode.3mf ou .gcode)
      entre dans la file production_queue (AutoLoop › « Envoyer à la production »
      ou glissé ici) ; « Terminé » le charge dans le formulaire.
      Lu dans l'en-tête : loops (« ; === LOOP 1 OF N === »), durée du batch
      (« Durée estimée du batch », cooldown compris), grammes par filament
      (déjà × loops), type + couleur de chaque filament (pré-choix du filament).
      Coût = filament (g × coût moyen CMP du filament / 1 000 g) + électricité et usure
      (durée × taux $/h des défauts du calculateur AutoLoop). Les pièces bonnes
      font des paires ; une pièce seule attend la production suivante.
      Aucune bobine à assigner (retirées le 2026-10-29) : le stock de filament baisse
      par Facturation › Interne › « Production ».
      RPC admin_save_production : stock du spacer + coût moyen (attrs.avg_cost.item,
      lu par Facturation / Spacers) en une transaction ; filaments figés dans productions.fils.
   2) HISTORIQUE : supprimer = la plus récente de chaque spacer seulement
      (RPC admin_delete_production : stock, pièce seule et coût moyen rejoués).
   Tables : productions · production_queue (schema-v2.sql).
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
  var spacers = [], filaments = [], prods = [];
  var rates = { elec: 0.2, deprec: 0.25 };
  var file = null;          // G-code lu : { name, isAuto, loops, minutes, objects, fils: [{ type, hex, perLoop }] }
  var rows = [];            // filament utilisé : [{ fil: id du filament|'', grams, type, hex }]
  var edited = { good: false, perPlate: false };
  var lastLoops = 1;
  var perLoopMin = 0;       // minutes par loop du G-code chargé : la durée suit les loops (0 = saisie à la main)

  var el = {
    drop: $('#pr-drop'), file: $('#pr-file'), fileWarn: $('#pr-file-warn'), queue: $('#pr-queue'), qN: $('#pr-queue-n'),
    spacer: $('#pr-spacer'), loops: $('#pr-loops'), perPlate: $('#pr-per-plate'), good: $('#pr-good'),
    timeH: $('#pr-time-h'), timeM: $('#pr-time-m'), date: $('#pr-date'),
    uses: $('#pr-uses'), useAdd: $('#pr-use-add'),
    save: $('#pr-save'), report: $('#pr-report'), status: $('#pr-status'),
    history: $('#pr-history'), refresh: $('#pr-refresh')
  };
  if (!el.uses) return;

  /* ---- activation à l'ouverture de l'onglet ---- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name !== 'production') return;
    if (!loaded) { loaded = true; el.date.value = todayISO(); }
    loadAll();   // à chaque visite : une réception a pu changer les coûts moyens entre-temps
  };

  function loadAll() {
    return Promise.all([
      window.CA.loadMaterials ? window.CA.loadMaterials() : null,
      loadSpacers(), loadFilaments(), loadProds(), loadRates(), loadBrandOrder(), loadQueue()
    ]).then(function () {
      sortAll();
      renderSpacerOptions(); renderRows(); recalc(); renderHistory(); renderQueue();
    }, function (err) {
      el.history.innerHTML = '<p class="empty">Impossible de charger : ' + esc(errText(err)) + '</p>';
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

  /* ---- Ordre de la section Filaments : marque (brands.sort_order) → matériau
     (materials.sort_order) → couleur (sort_order). ---- */
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
  }

  function spacerById(id) { return spacers.filter(function (s) { return String(s.id) === String(id); })[0] || null; }
  function filById(id) { return filaments.filter(function (f) { return String(f.id) === String(id); })[0] || null; }
  function swatch(hex) { return swatchBg(isHex(hex) ? hex : 'var(--line-2)'); }
  // « Bambu Lab · PETG Basic · Black » -> « PETG Basic · Black » (la marque prend de la place)
  function shortLabel(label) { var p = String(label || '').split(' · '); return p.length > 2 ? p.slice(1).join(' · ') : (label || ''); }
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
      return res.data;
    });
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

  /* ---- Filament utilisé : une rangée par filament du fichier, filament pré-choisi (type + couleur
     du G-code). Coût = grammes × coût moyen (CMP) d'une bobine de ce filament / 1 000 g. ---- */
  function typeMatch(f, type) {
    if (!type) return false;
    var words = ' ' + String(f.material || f.name || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ') + ' ';
    return words.indexOf(' ' + type.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() + ' ') !== -1;
  }
  // coût moyen d'une bobine (1 000 g) du filament ; null = aucun coût connu (ni réception, ni matière, ni catalogue)
  function costKg(f) {
    if (!f || !window.CA.costing) return null;
    return window.CA.costing.costOf(f, 'spool', filaments);
  }
  function rowCost(r) {
    var c = costKg(filById(r.fil));
    return c == null ? 0 : round2((+r.grams || 0) * c / 1000);
  }
  // filaments qui correspondent au G-code : type d'abord, couleur ensuite (ordre des Filaments à score égal)
  function candidates(type, hex) {
    return filaments.map(function (f) {
      var sc = (typeMatch(f, type) ? 2 : 0) + (isHex(hex) && isHex(f.hex) && f.hex.toLowerCase() === hex.toLowerCase() ? 1 : 0);
      return { f: f, sc: sc };
    }).filter(function (c) { return !type || c.sc >= 2; })
      .sort(function (a, z) { return z.sc - a.sc; })
      .map(function (c) { return c.f; });
  }
  function buildRows() {
    rows = [];
    var loops = Math.max(1, num(el.loops.value) | 0);
    (file ? file.fils : []).forEach(function (f) {
      var pick = candidates(f.type, f.hex)[0];
      rows.push({ fil: pick ? pick.id : '', grams: round1(f.perLoop * loops), type: f.type, hex: f.hex });
    });
    return rows;
  }
  // menu d'une rangée : marque · matière, couleur, coût de la bobine
  function filItems() {
    return filaments.map(function (f) {
      var c = costKg(f);
      return { id: f.id, group: (f.brand || '') + ' · ' + (f.material || ''), label: f.name || '(sans nom)',
        btn: (f.material ? f.material + ' · ' : '') + (f.name || ''), meta: c != null ? money(c) : 'coût inconnu',
        bg: filBg(f), dim: c == null, find: f.brand };
    });
  }
  function renderRows() {
    if (!rows.length) {
      el.uses.innerHTML = '<p class="muted pr-empty">' + (file ? 'Ajoute le filament utilisé.' : 'Rempli à partir du G-code.') + '</p>';
      return;
    }
    el.uses.innerHTML = rows.map(function (r, i) {
      return '<div class="pr-use" data-i="' + i + '">' +
        // pastille de gauche = couleur demandée par le G-code (le filament choisi a la sienne dans le menu)
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
        placeholder: 'Choisir le filament', search: true, items: filItems,
        onPick: function (id) { rows[i].fil = id; refreshRows(); recalc(); }
      });
      pk.btn.setAttribute('aria-label', 'Filament');
      pk.set(rows[i].fil);
    });
    refreshRows();
  }
  // coûts et alertes de chaque rangée (sans reconstruire les champs en cours de saisie)
  function refreshRows() {
    $$('.pr-use', el.uses).forEach(function (row) {
      var i = +row.getAttribute('data-i'), r = rows[i], f = filById(r.fil);
      $('.pr-use-cost', row).textContent = f && costKg(f) != null ? money(rowCost(r)) : '—';
      var warn = '';
      if (f && costKg(f) == null) warn = 'Aucun coût connu pour ce filament';
      else if (f && r.type && !typeMatch(f, r.type)) warn = 'Le fichier dit ' + esc(r.type);
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
    if (e.target.closest('.pr-x')) { rows.splice(i, 1); renderRows(); recalc(); }
  });
  el.useAdd.addEventListener('click', function () {
    rows.push({ fil: '', grams: 0, type: '', hex: '' });
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
    var used = rows.filter(function (r) { return r.fil && (+r.grams || 0) > 0; });
    var g = used.reduce(function (s, r) { return s + (+r.grams || 0); }, 0);
    var fil = used.reduce(function (s, r) { return s + rowCost(r); }, 0);
    // filaments envoyés tels quels à admin_save_production (unit_cost = coût moyen d'une bobine de 1 000 g)
    var fils = used.map(function (r) { return { product_id: r.fil, grams: round2(r.grams), unit_cost: costKg(filById(r.fil)) }; });
    var unknown = used.filter(function (r) { return costKg(filById(r.fil)) == null; })
      .map(function (r) { var f = filById(r.fil); return f ? (f.name || f.material || 'filament') : 'filament'; });
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
    return { sp: sp, used: used, fils: fils, unknown: unknown, g: g, fil: round2(fil), minutes: minutes, rate: rate, mach: mach, total: total, good: good,
      lin: lin, lout: lout, pairs: pairs, pairc: pairc, cur: cur, next: next,
      missing: rows.filter(function (r) { return !r.fil && (+r.grams || 0) > 0; }).length };
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
    else if (r.missing) problem = 'Choisis le filament de chaque rangée.';
    else if (!r.used.length) problem = 'Indique le filament utilisé.';
    else if (r.unknown.length) problem = 'Aucun coût connu : ' + r.unknown.join(', ') + '.';
    el.save.disabled = !r.sp || !r.used.length || !!r.missing || !!r.unknown.length || saving;
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
    if (!r.sp || !r.used.length || r.missing || r.unknown.length || saving) return;
    saving = true; el.save.disabled = true; el.status.textContent = 'Enregistrement…';
    var loops = Math.max(1, num(el.loops.value) | 0), per = Math.max(1, num(el.perPlate.value) | 0);
    var payload = {
      spacer_id: r.sp.id, made_at: el.date.value || todayISO(), file_name: file ? file.name : null,
      loops: loops, per_plate: per, pieces: loops * per,
      good: r.good, minutes: Math.round(r.minutes), machine_cost: r.mach,
      rates: { elec: rates.elec, deprec: rates.deprec },
      fils: r.fils
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
     2) HISTORIQUE
     ========================================================= */
  el.refresh.addEventListener('click', loadAll);
  function renderHistory() {
    if (!prods.length) { el.history.innerHTML = '<p class="muted pr-empty">Aucune production pour l\'instant.</p>'; return; }
    var latest = {};   // la plus récente de chaque spacer (seule supprimable)
    prods.forEach(function (p) { var k = String(p.spacer_id); if (!latest[k]) latest[k] = p.id; });
    el.history.innerHTML = '<div class="rcp-table-wrap"><table class="rcp-table pr-table"><thead><tr>' +
      '<th>Date</th><th>Spacer</th><th>Filament</th><th class="num">Pièces</th><th class="num">Paires</th><th class="num">Coût / paire</th><th></th>' +
      '</tr></thead><tbody>' + prods.map(function (p) {
        // filaments figés de la production (productions.fils), puis pastille de leur filament s'il existe encore
        var fil = (Array.isArray(p.fils) ? p.fils : []).map(function (x) {
          return '<span class="pr-hfil">' + swatchBg(filBg(filById(x.product_id), x.hex)) + esc(shortLabel(x.label) || 'Filament') + ' <em>' + grams(x.grams) + '</em></span>';
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
      message: p.spacer_label + ' perd ' + (p.pairs | 0) + ' paire' + ((p.pairs | 0) > 1 ? 's' : '') + ' de stock et son coût moyen est recalculé.',
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
