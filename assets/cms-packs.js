/* =========================================================
   Création Audio — CMS Packs (table « packs », schema-v2.sql § Packs de filament)
   Un pack = prix fixe pour N recharges (ou bobines) parmi des couleurs permises :
   compositions toutes faites (presets) + « Personnaliser » au choix du client.
   Le prix n'a pas de palier ; ses unités comptent pour le palier de la marque (option B, serveur).
   Le serveur (_pack_fill) refuse un prix qui ne se divise pas au cent près et tout ce qui dépasse le stock.
   Refonte 2026-11-20 (choix de Théo) : rangées larges (grande photo à gauche, en haut sur mobile),
   une mini-carte par composition avec « Packs prêts » − n + bloqué au stock, interrupteur En ligne,
   éditeur en fenêtre plein écran (Infos · Prix · Couleurs · Compositions · Photo).
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var money = window.CA.money || function (n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' $'; };
  var fold = window.CA.fold || function (s) { return String(s || '').toLowerCase(); };
  var BUCKET = 'products';
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : null; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function slugify(s) {
    return fold(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pack';
  }
  function uid() { return Math.random().toString(36).slice(2, 8); }
  function publicUrl(path) {
    if (!path) return '';
    if (/^assets\//.test(path)) return path;
    try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
  }

  var listEl = $('#pk-list'), editor = $('#pk-editor'), modal = $('#pk-modal');
  if (!listEl || !editor || !modal) return;
  var codeI = $('#pk-code');
  var nameI = $('#pk-name'), nameEnI = $('#pk-name-en'), noteI = $('#pk-note'), noteEnI = $('#pk-note-en'),
      kindSeg = $('#pk-kind'), unitsI = $('#pk-units'), priceI = $('#pk-price'), calcEl = $('#pk-calc'),
      customI = $('#pk-custom'), featI = $('#pk-featured'), qI = $('#pk-q'), colorsEl = $('#pk-colors'),
      presetsEl = $('#pk-presets'), photoEl = $('#pk-photo'), delBtn = $('#pk-del'),
      saveBtn = $('#pk-save'), statusEl = $('#pk-status'),
      spoolF = $('#pk-spool-f'), spoolOnI = $('#pk-spool-on'), spoolPriceI = $('#pk-spool-price'), photoSpoolEl = $('#pk-photo-spool');

  var packs = [], fils = [], byId = {}, matOrder = {}, brandOrder = {}, mats = {};
  var loaded = false, editingId = null;
  var st = null;                      // état de l'éditeur

  /* ---------- données ---------- */
  function load() {
    if (!packs.length) listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return Promise.all([
      sb.from('packs').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('products').select('*').eq('type', 'filament').eq('active', true),
      sb.from('materials').select('*'),
      sb.from('brands').select('name,sort_order'),
      // stock offert (réel − réservations en cours − recharges des packs prêts), comme la boutique
      sb.from('products_public').select('id,qty,qty_2').eq('type', 'filament'),
      // packs prêts restants par composition suivie (préparés − vendus − gardés)
      sb.rpc('pack_ready')
    ]).then(function (r) {
      var bad = r.filter(function (x) { return x.error; })[0];
      if (bad) { listEl.innerHTML = '<p class="empty">Impossible de charger les packs.<br>' + esc(bad.error.message || bad.error) + '</p>'; return; }
      packs = r[0].data || [];
      mats = {}; matOrder = {}; brandOrder = {};
      (r[2].data || []).forEach(function (m, i) { mats[m.brand + '|' + m.name] = m; matOrder[m.brand + '|' + m.name] = m.sort_order != null ? m.sort_order : i; });
      (r[3].data || []).forEach(function (b, i) { brandOrder[b.name] = b.sort_order != null ? b.sort_order : i; });
      fils = (r[1].data || []).slice().sort(filCmp);
      byId = {}; fils.forEach(function (p) { byId[p.id] = p; });
      setAvail(r[4].data);
      setReady(r[5].data);
      loaded = true;
      render();
    });
  }
  function setAvail(rows) { (rows || []).forEach(function (v) { var p = byId[v.id]; if (p) { p.avail = v.qty; p.avail_2 = v.qty_2; } }); }
  // ordre de la section Filaments : marque → matériau → couleur
  function filCmp(a, b) {
    function bo(p) { return brandOrder[p.brand] != null ? brandOrder[p.brand] : 999; }
    function mo(p) { var k = p.brand + '|' + p.material; return matOrder[k] != null ? matOrder[k] : 999; }
    return (bo(a) - bo(b)) || (mo(a) - mo(b)) || ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.name).localeCompare(String(b.name));
  }
  function offers(p, kind) { return kind === 'refill' ? p.offer_refill !== false : p.offer_spool !== false; }
  // stock offert : la vue publique soustrait les réservations en cours et les packs prêts ; repli sur le stock brut
  function stockOf(p, kind) {
    var v = kind === 'refill' ? (p.avail_2 !== undefined ? p.avail_2 : p.qty_2) : (p.avail !== undefined ? p.avail : p.qty);
    return Math.max(0, v || 0);
  }
  function regPrice(p, kind) {
    var m = mats[p.brand + '|' + p.material];
    return num(kind === 'refill' ? (m ? m.sell_refill : p.sell_price_2) : (m ? m.sell_spool : p.sell_price));
  }
  function costOf(p, kind) {
    var C = window.CA.costing;
    return C && C.costOf ? C.costOf(p, kind, fils) : null;
  }
  function dot(p) { return '<i class="pm-dot" style="background:' + esc(p && p.hex || '#ccc') + '"></i>'; }
  function unitWord(kind, n) { return kind === 'spool' ? (n > 1 ? 'bobines' : 'bobine') : (n > 1 ? 'recharges' : 'recharge'); }

  // packs possibles avec le stock offert pour une composition { pid: unités }
  function possible(lines, kind) {
    var best = Infinity, any = false;
    Object.keys(lines).forEach(function (pid) {
      var n = lines[pid]; if (!n) return; any = true;
      var p = byId[pid]; best = Math.min(best, p ? Math.floor(stockOf(p, kind) / n) : 0);
    });
    return any ? best : 0;
  }
  function linesObj(pr) {
    var o = {}; (pr.lines || []).forEach(function (l) { if (l && l.p && l.n > 0) o[l.p] = (o[l.p] || 0) + (+l.n); }); return o;
  }
  // pastilles : une par unité (règle de Théo : jamais de bobines dessinées)
  function dotsHtml(lines, cls) {
    var out = [];
    Object.keys(lines).map(function (id) { return byId[id]; }).filter(Boolean).sort(filCmp).forEach(function (p) {
      for (var i = 0; i < lines[p.id]; i++) out.push('<i style="background:' + esc(p.hex || '#ccc') + '"></i>');
    });
    return out.length ? '<span class="pk-pills ' + (cls || '') + '">' + out.join('') + '</span>' : '';
  }
  function colorLines(ids) { var o = {}; ids.forEach(function (id) { if (byId[id]) o[id] = 1; }); return o; }

  /* ---------- packs prêts (2026-11-20) ----------
     packs.ready = { "<pid:n,…>": { n, at } } par composition toute faite (clé = _pack_ckey en SQL).
     Absent = pas suivi (le pack puise dans le stock à l'unité). Suivi : ses recharges sont retirées du stock
     à l'unité ; au-delà des packs restants, le pack part « à commander ». On affiche les RESTANTS (RPC pack_ready) ;
     changer le compte pose n = restants voulus + packs gardés, at = maintenant (les ventes d'avant ne comptent plus).
     Plafond : restants + packs encore possibles avec le stock offert (qui exclut déjà les packs prêts). */
  var readyLeft = {};   // 'packId|ckey' -> { left, held }
  function setReady(rows) {
    readyLeft = {};
    (rows || []).forEach(function (x) { readyLeft[x.pack_id + '|' + x.ckey] = { left: x.left_n | 0, held: x.held | 0 }; });
  }
  function ckeyOf(pr) {
    var o = linesObj(pr);
    return Object.keys(o).map(function (p) { return { p: String(p).toLowerCase(), n: o[p] | 0 }; })
      .sort(function (a, b) { return a.p < b.p ? -1 : a.p > b.p ? 1 : 0; })
      .map(function (l) { return l.p + ':' + l.n; }).join(',');
  }
  function readyOf(pk, pr) { return readyLeft[pk.id + '|' + ckeyOf(pr)] || null; }
  function readyMax(pk, pr) { var rd = readyOf(pk, pr); return (rd ? rd.left : 0) + possible(linesObj(pr), pk.kind); }
  function setPackReady(pk, pr, left) {   // left = null -> plus suivi
    var key = ckeyOf(pr), cur = readyOf(pk, pr), next = {};
    var src = pk.ready && typeof pk.ready === 'object' ? pk.ready : {};
    Object.keys(src).forEach(function (k) { if (k !== key) next[k] = src[k]; });
    if (left != null) next[key] = { n: Math.max(0, left) + (cur ? cur.held : 0), at: new Date().toISOString() };
    return sb.from('packs').update({ ready: next, updated_at: new Date().toISOString() }).eq('id', pk.id).select().then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('Enregistrement refusé (permissions).');
      pk.ready = res.data[0].ready;
      return Promise.all([sb.rpc('pack_ready'), sb.from('products_public').select('id,qty,qty_2').eq('type', 'filament')]);
    }).then(function (r) {
      if (r[0].error) throw r[0].error;
      setReady(r[0].data);
      setAvail(r[1].data);
      render();
    });
  }

  /* ---------- liste : une rangée large par pack ---------- */
  function render() {
    if (!packs.length) { listEl.innerHTML = '<p class="empty">Aucun pack. Crée le premier avec « Pack ».</p>'; return; }
    listEl.innerHTML = packs.map(rowHtml).join('');
    $$('.pk-row', listEl).forEach(wireDrag);
  }
  function rowHtml(pk) {
    var units = pk.units || 4, unit = r2(pk.price / units);
    // photo du pack, sinon celle de la 1re composition qui en a une, sinon pastilles
    var main = pk.image_path || ((pk.presets || []).filter(function (pr) { return pr.img; })[0] || {}).img;
    var img = main
      ? '<img src="' + esc(publicUrl(main)) + '" alt="">'
      : (dotsHtml((pk.presets && pk.presets[0]) ? linesObj(pk.presets[0]) : colorLines(pk.colors || []), 'is-lg') || '<span class="pk-nophoto">Aucune photo</span>');
    var meta = [];
    if (pk.code) meta.push('<span class="pk-code">' + esc(pk.code) + '</span>');
    meta.push('<b>' + money(+pk.price) + '</b>');
    meta.push(units + ' ' + unitWord(pk.kind, units));
    meta.push(money(unit) + ' l\'unité');
    if (pk.kind === 'refill' && pk.spool_price != null) meta.push('avec bobine ' + money(+pk.spool_price));
    var tags = (pk.featured ? '<span class="pk-tag">En haut de Filaments</span>' : '') +
               (pk.allow_custom ? '<span class="pk-tag">Personnalisable</span>' : '');
    var comps = (pk.presets || []).map(function (pr, i) { return compHtml(pk, pr, i); }).join('');
    return '<article class="pk-row' + (pk.enabled ? '' : ' is-off') + '" data-id="' + esc(pk.id) + '" draggable="true">' +
      '<div class="pk-media">' + img + '</div>' +
      '<div class="pk-body">' +
        '<div class="pk-head">' +
          '<h3 class="pk-title">' + esc(pk.name) + '</h3>' +
          '<label class="pk-tg-l pk-online"><span class="pk-tg"><input type="checkbox" data-a="toggle"' + (pk.enabled ? ' checked' : '') + '><span></span></span>' +
            '<span class="pk-online-t">' + (pk.enabled ? 'En ligne' : 'Hors ligne') + '</span></label>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-a="edit" data-ic="edit">Modifier</button>' +
        '</div>' +
        '<div class="pk-meta">' + meta.join('<span class="pk-sep">·</span>') + '</div>' +
        (tags ? '<div class="pk-tags">' + tags + '</div>' : '') +
        (comps ? '<div class="pk-comps-l">Packs prêts</div><div class="pk-comps">' + comps + '</div>' : '') +
      '</div></article>';
  }
  function compHtml(pk, pr, i) {
    var rd = readyOf(pk, pr), max = readyMax(pk, pr), left = rd ? rd.left : null;
    // une seule composition sans photo à elle = la photo du pack
    var im = pr.img || ((pk.presets || []).length === 1 ? pk.image_path : null);
    var src = im ? publicUrl(im) : '';
    var out = rd ? left === 0 : max === 0;
    var state = rd ? (left === 0 ? 'À commander' : 'max ' + max) : (max ? 'max ' + max : 'Aucun stock');
    return '<div class="pk-mc' + (rd ? ' is-ready' : '') + (out ? ' is-out' : '') + '">' +
      '<div class="pk-mc-img">' + (src ? '<img src="' + esc(src) + '" alt="">' : dotsHtml(linesObj(pr))) + '</div>' +
      '<div class="pk-mc-name">' + esc(pr.name || 'Sans nom') + '</div>' +
      '<div class="pk-stp">' +
        '<button type="button" class="pk-sb" data-a="rdy" data-d="-1" data-i="' + i + '"' + (rd ? '' : ' disabled') + ' aria-label="Un pack prêt de moins">−</button>' +
        '<b>' + (rd ? left : '—') + '</b>' +
        '<button type="button" class="pk-sb" data-a="rdy" data-d="1" data-i="' + i + '"' + ((left || 0) < max ? '' : ' disabled') + ' aria-label="Un pack prêt de plus">+</button>' +
      '</div>' +
      '<div class="pk-mc-st">' + state + '</div>' +
    '</div>';
  }

  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var row = b.closest('.pk-row'), pk = row && packs.filter(function (x) { return x.id === row.getAttribute('data-id'); })[0];
    if (!pk) return;
    var a = b.getAttribute('data-a');
    if (a === 'rdy') {   // packs prêts : + depuis « — » = 1 ; − à 0 = plus suivi (« — ») ; + bloqué au stock
      var pr = (pk.presets || [])[+b.getAttribute('data-i')]; if (!pr || b.disabled) return;
      var rd = readyOf(pk, pr), d = +b.getAttribute('data-d'), max = readyMax(pk, pr);
      var left = rd ? (d < 0 && rd.left === 0 ? null : rd.left + d) : (d > 0 ? 1 : null);
      if (!rd && left == null) return;
      if (left != null && d > 0 && left > max) return;   // plafond : stock offert
      $$('[data-a="rdy"]', row).forEach(function (x) { x.disabled = true; });
      setPackReady(pk, pr, left).then(null, function (err) { caDialog.error(err); render(); });
    } else if (a === 'edit') openEditor(pk);
  });
  listEl.addEventListener('change', function (e) {
    var t = e.target; if (t.getAttribute('data-a') !== 'toggle') return;
    var row = t.closest('.pk-row'), pk = packs.filter(function (x) { return x.id === row.getAttribute('data-id'); })[0];
    if (!pk) return;
    var on = t.checked;
    var empty = on && !pk.allow_custom && !(pk.presets || []).some(function (pr) { return readyMax(pk, pr) > 0; });
    var go = empty
      ? caDialog.confirm({ title: 'Aucune composition en stock', message: 'Il se commandera « Réservé à la prochaine réception ».', ok: 'Mettre en ligne', cancel: 'Annuler' })
      : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) { t.checked = !on; return; }
      t.disabled = true;
      sb.from('packs').update({ enabled: on, updated_at: new Date().toISOString() }).eq('id', pk.id).select().then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Enregistrement refusé (permissions).');
        pk.enabled = on; render();
      }).then(null, function (err) { caDialog.error(err); render(); });
    });
  });

  /* ---------- glisser-déposer (ordre des packs) ---------- */
  var dragRow = null;
  function wireDrag(el) {
    el.addEventListener('dragstart', function (e) {
      if (e.target.closest && e.target.closest('button, input, label')) { e.preventDefault(); return; }
      dragRow = el; el.classList.add('dragging');
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', el.getAttribute('data-id')); } catch (_) {} }
    });
    el.addEventListener('dragend', function () { dragRow = null; el.classList.remove('dragging'); $$('.pk-row', listEl).forEach(function (c) { c.classList.remove('drop-target'); }); });
    el.addEventListener('dragover', function (e) { if (!dragRow) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('dragenter', function () { if (dragRow && dragRow !== el) el.classList.add('drop-target'); });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-target'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!dragRow || dragRow === el) return;
      var ids = packs.map(function (p) { return p.id; });
      var from = ids.indexOf(dragRow.getAttribute('data-id')), to = ids.indexOf(el.getAttribute('data-id'));
      if (from < 0 || to < 0) return;
      packs.splice(to, 0, packs.splice(from, 1)[0]);
      render();
      var ups = packs.map(function (p, i) {
        if (p.sort_order === i) return null; p.sort_order = i;
        return sb.from('packs').update({ sort_order: i }).eq('id', p.id);
      }).filter(Boolean);
      if (ups.length) Promise.all(ups).then(function (all) {
        var bad = all.filter(function (res) { return res && res.error; })[0];
        if (bad) caDialog.error(bad.error);
      }, function () {});
    });
  }

  /* ---------- éditeur (fenêtre plein écran) ---------- */
  function setKind(k) {
    st.kind = k === 'spool' ? 'spool' : 'refill';
    $$('.fx-seg-btn', kindSeg).forEach(function (b) {
      var on = b.getAttribute('data-kind') === st.kind;
      b.classList.toggle('is-active', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    syncSpool();
  }
  // « Avec bobine » d'un pack recharge (2026-11-19) : prix à part, vide = pas offert
  function spoolOn() { return !!st && st.kind === 'refill' && spoolOnI.checked; }
  function syncSpool() {
    spoolF.hidden = !(st && st.kind === 'refill');
    spoolPriceI.disabled = !spoolOnI.checked;
    photoSpoolEl.hidden = !spoolOn();
  }
  function openEditor(pk) {
    if (!loaded) return;
    editingId = pk ? pk.id : null;
    $('#pk-editor-title').textContent = pk ? pk.name : 'Nouveau pack';
    nameI.value = pk ? pk.name || '' : '';
    nameEnI.value = pk ? pk.name_en || '' : '';
    codeI.value = pk ? pk.code || '' : '';
    noteI.value = pk ? pk.note || '' : '';
    noteEnI.value = pk ? pk.note_en || '' : '';
    unitsI.value = pk ? pk.units : 4;
    priceI.value = pk ? +pk.price : '';
    customI.checked = pk ? pk.allow_custom : true;
    featI.checked = pk ? pk.featured : true;
    spoolOnI.checked = !!(pk && pk.spool_price != null);
    spoolPriceI.value = pk && pk.spool_price != null ? +pk.spool_price : '';
    st = {
      kind: 'refill',
      colors: pk ? (pk.colors || []).filter(function (id) { return byId[id]; }) : [],
      presets: pk ? (pk.presets || []).map(function (pr) { return { id: pr.id || uid(), name: pr.name || '', name_en: pr.name_en || '', img: pr.img || null, img_spool: pr.img_spool || null, lines: linesObj(pr) }; }) : [],
      image: pk ? pk.image_path || null : null,
      spoolImage: pk ? pk.spool_image_path || null : null
    };
    setKind(pk ? pk.kind : 'refill');
    syncCustom();
    delBtn.hidden = !pk;
    qI.value = ''; statusEl.textContent = '';
    renderColors(); renderPresets(); renderCalc(); renderPhotos();
    modal.hidden = false;
    document.documentElement.classList.add('pk-lock');
    $('.pk-sh-body', editor).scrollTop = 0;
    nameI.focus({ preventScroll: true });
  }
  function closeEditor() {
    modal.hidden = true; editingId = null;
    document.documentElement.classList.remove('pk-lock');
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden && !e.defaultPrevented) closeEditor(); });

  function unitsVal() { var n = parseInt(unitsI.value, 10); return isFinite(n) ? Math.max(1, Math.min(20, n)) : 4; }
  editor.addEventListener('click', function (e) {
    var u = e.target.closest('[data-u]'); if (!u) return;
    unitsI.value = Math.max(1, Math.min(20, unitsVal() + (+u.getAttribute('data-u'))));
    renderCalc(); renderPresets();
  });
  function renderCalc() {
    var a = '<span class="pk-calc-row">' + calcLine(num(priceI.value), st.kind) + '</span>';
    if (spoolOn()) a += '<span class="pk-calc-row"><span class="pk-calc-k">Avec bobine</span> ' + calcLine(num(spoolPriceI.value), 'spool') + '</span>';
    calcEl.innerHTML = a;
  }
  function calcLine(price, kind) {
    var units = unitsVal();
    if (price == null || price <= 0) return '<span class="muted">—</span>';
    var unit = r2(price / units), exact = Math.abs(unit * units - price) < 0.001;
    var cols = st.colors.map(function (id) { return byId[id]; }).filter(Boolean);
    var costs = cols.map(function (p) { return costOf(p, kind); }).filter(function (c) { return c != null; });
    var cost = costs.length ? costs.reduce(function (s, c) { return s + c; }, 0) / costs.length : null;
    var regs = cols.map(function (p) { return regPrice(p, kind); }).filter(function (c) { return c != null; });
    var reg = regs.length ? Math.min.apply(null, regs) : null;
    var h = '<b>' + money(unit) + '</b> la ' + (kind === 'spool' ? 'bobine' : 'recharge');
    if (!exact) h += ' · <span class="neg">ne tombe pas au cent près</span>';
    if (reg != null && unit < reg) h += ' · −' + Math.round((1 - unit / reg) * 100) + ' %';
    if (cost != null) {
      var m = (unit - cost) / unit * 100;
      h += ' · <span class="' + (m < 0 ? 'neg' : 'pos') + '">Marge ' + Math.round(m) + ' % (' + money(r2((unit - cost) * units)) + ')</span>';
    }
    return h;
  }

  // « Personnaliser » : noir et blanc seulement (règle de Théo, 2026-11-16) — une couleur => compositions fixes
  function bwOnly() {
    return st.colors.every(function (id) { var p = byId[id]; return !p || /^#(000000|FFFFFF)$/i.test(p.hex || ''); });
  }
  function syncCustom() {
    var ok = bwOnly();
    customI.disabled = !ok;
    if (!ok) customI.checked = false;
    customI.closest('.pk-tg-l').title = ok ? '' : 'Noir et blanc seulement';
    customI.closest('.pk-tg-l').classList.toggle('is-dis', !ok);
  }

  /* couleurs permises : grosses pastilles par matériau, nom + stock dessous */
  function renderColors() {
    var q = fold(qI.value.trim()), sel = {};
    st.colors.forEach(function (id) { sel[id] = true; });
    var list = fils.filter(function (p) { return offers(p, st.kind) || sel[p.id]; })
      .filter(function (p) { return !q || sel[p.id] || fold([p.name, p.brand, p.material].join(' ')).indexOf(q) >= 0; });
    var groups = [], map = {};
    list.forEach(function (p) {
      var k = (p.brand || '') + '|' + (p.material || '');
      if (!map[k]) { map[k] = { label: [p.brand, p.material].filter(Boolean).join(' · '), items: [] }; groups.push(map[k]); }
      map[k].items.push(p);
    });
    colorsEl.innerHTML = groups.map(function (g) {
      return '<div class="pk-cg"><div class="pk-cgl">' + esc(g.label) + '</div><div class="pk-sws">' + g.items.map(function (p) {
        var s = stockOf(p, st.kind);
        return '<button type="button" class="pk-cs' + (sel[p.id] ? ' is-on' : '') + (s ? '' : ' is-zero') + '" data-c="' + esc(p.id) + '" aria-pressed="' + (sel[p.id] ? 'true' : 'false') + '" title="' + esc(p.name) + '">' +
          '<i style="background:' + esc(p.hex || '#ccc') + '"></i><span>' + esc(p.name) + '</span><em>' + s + '</em></button>';
      }).join('') + '</div></div>';
    }).join('') || '<p class="muted">Aucune couleur.</p>';
  }
  colorsEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-c]'); if (!b) return;
    var id = b.getAttribute('data-c'), i = st.colors.indexOf(id);
    if (i >= 0) {
      st.colors.splice(i, 1);
      st.presets.forEach(function (pr) { delete pr.lines[id]; });
    } else st.colors.push(id);
    st.colors.sort(function (a, b2) { return filCmp(byId[a], byId[b2]); });
    syncCustom(); renderColors(); renderPresets(); renderCalc();
  });
  qI.addEventListener('input', renderColors);

  /* tuile photo : image entière centrée, ou bouton « + Photo » ; t = cible (main, spool, p:i, ps:i) */
  function phTile(src, t, label) {
    return '<div class="pk-ph' + (src ? ' has-img' : '') + '">' +
      (label ? '<span class="pk-ph-l">' + esc(label) + '</span>' : '') +
      (src
        ? '<img src="' + esc(src) + '" alt="">' +
          '<div class="pk-ph-acts">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-ph="pick" data-t="' + t + '" data-ic="refresh">Changer</button>' +
            '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-ph="del" data-t="' + t + '" data-ic="trash" aria-label="Retirer la photo"></button>' +
          '</div>'
        : '<button type="button" class="pk-ph-add" data-ph="pick" data-t="' + t + '"><b>+</b>Photo</button>') +
    '</div>';
  }

  /* compositions : une tuile chacune — photo, noms, − n + par couleur, total et stock */
  function renderPresets() {
    var units = unitsVal(), cols = st.colors.map(function (id) { return byId[id]; }).filter(Boolean);
    presetsEl.innerHTML = st.presets.map(function (pr, i) {
      var tot = Object.keys(pr.lines).reduce(function (s, k) { return s + (pr.lines[k] || 0); }, 0);
      var n = possible(pr.lines, st.kind);
      return '<div class="pk-pc" data-i="' + i + '" draggable="true">' +
        phTile(pr.img ? publicUrl(pr.img) : '', 'p:' + i) +
        (spoolOn() ? '<div class="pk-pc-sp">' + phTile(pr.img_spool ? publicUrl(pr.img_spool) : '', 'ps:' + i, 'Avec bobine') + '</div>' : '') +
        '<div class="pk-pc-names">' +
          '<input type="text" data-f="name" value="' + esc(pr.name) + '" placeholder="Nom (ex. 4 noires)" maxlength="40" aria-label="Nom">' +
          '<input type="text" data-f="name_en" value="' + esc(pr.name_en) + '" placeholder="Anglais (ex. 4 black)" maxlength="40" aria-label="Nom en anglais">' +
        '</div>' +
        '<div class="pk-steps">' + (cols.length ? cols.map(function (p) {
          var v = pr.lines[p.id] || 0;
          return '<div class="pk-step' + (v ? ' is-on' : '') + '">' + dot(p) + '<span class="pk-step-n">' + esc(p.name) + '</span>' +
            '<span class="pk-stp">' +
              '<button type="button" class="pk-sb" data-st="-1" data-p="' + esc(p.id) + '"' + (v ? '' : ' disabled') + ' aria-label="Moins">−</button>' +
              '<b>' + v + '</b>' +
              '<button type="button" class="pk-sb" data-st="1" data-p="' + esc(p.id) + '"' + (tot < units ? '' : ' disabled') + ' aria-label="Plus">+</button>' +
            '</span></div>';
        }).join('') : '<p class="muted">Choisis d\'abord les couleurs.</p>') + '</div>' +
        '<div class="pk-pcf">' +
          '<span class="' + (tot === units ? 'pos' : 'neg') + '">' + tot + ' / ' + units + '</span>' +
          (tot === units ? '<span class="pk-sep">·</span><span>' + (n ? n + ' en stock' : 'Aucun stock') + '</span>' : '') +
          '<span class="grow"></span>' +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon pk-del" data-pdel="' + i + '" data-ic="trash" aria-label="Retirer la composition"></button>' +
        '</div>' +
      '</div>';
    }).join('') +
    '<button type="button" class="pk-pc pk-pc-add" id="pk-preset-add"><b>+</b>Composition</button>';
    wirePresetDrag();
  }
  presetsEl.addEventListener('input', function (e) {
    var t = e.target, c = t.closest('.pk-pc'); if (!c || !t.getAttribute('data-f')) return;
    st.presets[+c.getAttribute('data-i')][t.getAttribute('data-f')] = t.value;
  });
  presetsEl.addEventListener('click', function (e) {
    if (e.target.closest('#pk-preset-add')) {
      st.presets.push({ id: uid(), name: '', name_en: '', img: null, img_spool: null, lines: {} });
      renderPresets();
      var c = presetsEl.querySelector('.pk-pc[data-i="' + (st.presets.length - 1) + '"] input');
      if (c) c.focus();
      return;
    }
    var del = e.target.closest('[data-pdel]'), stp = e.target.closest('[data-st]');
    if (del) {
      var k = +del.getAttribute('data-pdel'), pr0 = st.presets[k];
      caDialog.confirm({ title: 'Retirer cette composition ?', message: (pr0.name || 'Sans nom'), ok: 'Retirer', cancel: 'Annuler', danger: true }).then(function (ok) {
        if (ok) { st.presets.splice(k, 1); renderPresets(); }
      });
      return;
    }
    if (stp && !stp.disabled) {
      var pr = st.presets[+stp.closest('.pk-pc').getAttribute('data-i')], pid = stp.getAttribute('data-p');
      var tot = Object.keys(pr.lines).reduce(function (s, k2) { return s + (pr.lines[k2] || 0); }, 0);
      var d = +stp.getAttribute('data-st'), v = (pr.lines[pid] || 0) + d;
      if (v < 0 || (d > 0 && tot >= unitsVal())) return;
      if (v) pr.lines[pid] = v; else delete pr.lines[pid];
      renderPresets();
    }
  });
  var dragPc = null;
  function wirePresetDrag() {
    $$('.pk-pc[data-i]', presetsEl).forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        if (e.target.closest && e.target.closest('input, button')) { e.preventDefault(); return; }
        dragPc = el; el.classList.add('dragging');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'p'); } catch (_) {} }
      });
      el.addEventListener('dragend', function () { dragPc = null; el.classList.remove('dragging'); });
      el.addEventListener('dragover', function (e) { if (dragPc) e.preventDefault(); });
      el.addEventListener('drop', function (e) {
        e.preventDefault(); if (!dragPc || dragPc === el) return;
        var from = +dragPc.getAttribute('data-i'), to = +el.getAttribute('data-i');
        st.presets.splice(to, 0, st.presets.splice(from, 1)[0]);
        renderPresets();
      });
    });
  }

  /* ---------- photos : envoyées tout de suite au bucket products/packs/ ---------- */
  function renderPhotos() {
    photoEl.innerHTML = phTile(st.image ? publicUrl(st.image) : '', 'main', spoolOn() ? 'Recharges' : '');
    photoSpoolEl.innerHTML = phTile(st.spoolImage ? publicUrl(st.spoolImage) : '', 'spool', 'Avec bobine');
  }
  function photoSet(t, path) {
    if (t === 'main') st.image = path;
    else if (t === 'spool') st.spoolImage = path;
    else { var m = /^(p|ps):(\d+)$/.exec(t); if (m && st.presets[+m[2]]) st.presets[+m[2]][m[1] === 'p' ? 'img' : 'img_spool'] = path; }
  }
  function photoRedraw(t) { if (t === 'main' || t === 'spool') renderPhotos(); else renderPresets(); }
  editor.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ph]'); if (!b) return;
    var t = b.getAttribute('data-t');
    if (b.getAttribute('data-ph') === 'del') { photoSet(t, null); photoRedraw(t); return; }
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      var path = 'packs/' + Date.now() + '-' + uid() + '.' + ext;
      b.disabled = true; statusEl.textContent = 'Envoi de la photo…';
      sb.storage.from(BUCKET).upload(path, f, { cacheControl: '3600', upsert: false, contentType: f.type || undefined })
        .then(function (res) { if (res.error) throw res.error; photoSet(t, path); statusEl.textContent = ''; photoRedraw(t); })
        .catch(function (err) { statusEl.textContent = ''; b.disabled = false; caDialog.error(err); });
    });
    inp.click();
  });

  [unitsI, priceI, spoolPriceI].forEach(function (el) { el.addEventListener('input', function () { renderCalc(); if (el === unitsI) renderPresets(); }); });
  spoolOnI.addEventListener('change', function () {
    if (spoolOnI.checked && !spoolPriceI.value) { var p = num(priceI.value); if (p) spoolPriceI.value = r2(p + 10); }
    syncSpool(); renderCalc(); renderPresets(); renderPhotos();
    if (spoolOnI.checked) spoolPriceI.focus();
  });
  kindSeg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-kind]'); if (!b) return;
    setKind(b.getAttribute('data-kind')); renderColors(); renderPresets(); renderCalc(); renderPhotos();
  });

  /* ---------- enregistrement ---------- */
  function fail(msg, el) { statusEl.textContent = msg; statusEl.classList.add('is-bad'); if (el) el.focus(); }
  editor.addEventListener('submit', function (e) {
    e.preventDefault();
    statusEl.classList.remove('is-bad');
    var name = nameI.value.trim(), price = num(priceI.value), units = unitsVal();
    if (!name) return fail('Nom requis.', nameI);
    if (price == null || price <= 0) return fail('Prix requis.', priceI);
    price = r2(price);
    if (Math.abs(r2(price / units) * units - price) > 0.001) return fail('Le prix doit se diviser au cent près par ' + units + '.', priceI);
    var spoolPrice = null;
    if (spoolOn()) {
      spoolPrice = num(spoolPriceI.value);
      if (spoolPrice == null || spoolPrice <= 0) return fail('Prix avec bobine requis.', spoolPriceI);
      spoolPrice = r2(spoolPrice);
      if (Math.abs(r2(spoolPrice / units) * units - spoolPrice) > 0.001) return fail('Le prix avec bobine doit se diviser au cent près par ' + units + '.', spoolPriceI);
    }
    if (!st.colors.length) return fail('Choisis au moins une couleur.');
    var presets = st.presets.map(function (pr) {
      return { id: pr.id, name: pr.name.trim(), name_en: pr.name_en.trim() || null, img: pr.img || null, img_spool: pr.img_spool || null,
        lines: st.colors.filter(function (id) { return pr.lines[id] > 0; }).map(function (id) { return { p: id, n: pr.lines[id] }; }) };
    });
    for (var i = 0; i < presets.length; i++) {
      var tot = presets[i].lines.reduce(function (s, l) { return s + l.n; }, 0);
      if (!presets[i].name) return fail('Nomme chaque composition.');
      if (tot !== units) return fail('« ' + presets[i].name + ' » doit compter ' + units + ' unités.');
    }
    if (!presets.length && !customI.checked) return fail('Ajoute une composition ou permets « Personnaliser ».');
    var cols = st.colors.map(function (id) { return byId[id]; });
    var below = cols.filter(function (p) { var c = costOf(p, st.kind); return c != null && r2(price / units) < c; }).map(function (p) { return p.name; });
    if (spoolPrice != null) cols.forEach(function (p) { var c = costOf(p, 'spool'); if (c != null && r2(spoolPrice / units) < c) below.push(p.name + ' (bobine)'); });
    var go = below.length
      ? caDialog.confirm({ title: 'Prix sous le coût', message: below.join(', ') + ' se vendraient sous le coût moyen.', ok: 'Enregistrer quand même', cancel: 'Corriger', danger: true })
      : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      var old = editingId ? packs.filter(function (x) { return x.id === editingId; })[0] : null;
      var row = {
        name: name, name_en: nameEnI.value.trim() || null, code: codeI.value.trim().toUpperCase() || null, note: noteI.value.trim() || null, note_en: noteEnI.value.trim() || null,
        kind: st.kind, units: units, price: price, colors: st.colors.slice(), presets: presets,
        allow_custom: customI.checked && bwOnly(), featured: featI.checked, updated_at: new Date().toISOString(),
        spool_price: st.kind === 'refill' ? spoolPrice : null,
        spool_image_path: st.kind === 'refill' && spoolPrice != null ? st.spoolImage || null : null,
        image_path: st.image || null
      };
      if (!old) {
        var base = slugify(name), slug = base, n = 2, taken = packs.map(function (x) { return x.slug; });
        while (taken.indexOf(slug) >= 0) slug = base + '-' + (n++);
        row.slug = slug; row.enabled = false; row.sort_order = packs.length;
      }
      saveBtn.disabled = true; statusEl.textContent = 'Enregistrement…';
      var oldImg = old ? old.image_path : null;
      (old
        ? sb.from('packs').update(row).eq('id', old.id).select().then(function (r) { if (r.error) throw r.error; if (!r.data || !r.data.length) throw new Error('Enregistrement refusé (permissions).'); return r.data[0]; })
        : sb.from('packs').insert(row).select().then(function (r) { if (r.error) throw r.error; return r.data[0]; })
      ).then(function (saved) {
        if (oldImg && oldImg !== saved.image_path && !/^assets\//.test(oldImg)) sb.storage.from(BUCKET).remove([oldImg]).then(null, function () {});
        closeEditor(); return load();
      }).catch(function (err) { caDialog.error(err); })
        .then(function () { saveBtn.disabled = false; statusEl.textContent = ''; });
    });
  });

  delBtn.addEventListener('click', function () {
    var pk = packs.filter(function (x) { return x.id === editingId; })[0]; if (!pk) return;
    caDialog.confirm({ title: 'Supprimer ce pack ?', message: pk.name + ' — les commandes passées gardent leurs lignes.', ok: 'Supprimer', cancel: 'Annuler', danger: true }).then(function (ok) {
      if (!ok) return;
      sb.from('packs').delete().eq('id', pk.id).select().then(function (res) {
        if (res.error) { caDialog.error(res.error); return; }
        if (!res.data || !res.data.length) { caDialog.error('Suppression refusée (permissions).'); return; }
        if (pk.image_path && !/^assets\//.test(pk.image_path)) sb.storage.from(BUCKET).remove([pk.image_path]).then(null, function () {});
        closeEditor();
        packs = packs.filter(function (x) { return x.id !== pk.id; }); render();
      });
    });
  });

  $('#pk-new').addEventListener('click', function () { openEditor(null); });
  $('#pk-refresh').addEventListener('click', load);
  $('#pk-cancel').addEventListener('click', closeEditor);
  $('#pk-close').addEventListener('click', closeEditor);

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'packs') load();
    else if (!modal.hidden) closeEditor();
  };
})();
