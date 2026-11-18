/* =========================================================
   Création Audio — Inventaire › Historique (2026-11-16)
   - Journal du stock (table stock_moves, écrite par un trigger SQL sur
     products.qty / qty_2) : entrées / sorties par filament entre deux dates.
   - Photo du jour (stock_snapshots, pg_cron chaque nuit) : contre-vérification.
   - Comptage complet : on scanne tout ce qui est sur les tablettes, puis on
     revoit les écarts et on coche ceux à corriger (RPC admin_set_stock,
     raison « count »). Les filaments non scannés sont montrés à part, sans
     être touchés tant qu'on ne les coche pas.
   Dépend de cms-inventory.js (window.CA.inv) — chargé après lui.
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});
  var sb = CA.sb;
  function $(s, r) { return (r || document).querySelector(s); }
  var panel = $('#inv-sub-historique');
  if (!panel || !sb) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(s) { var p = String(s || '').split('-'); return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null; }
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function dayLabel(d) { return d.getDate() + ' ' + MOIS[d.getMonth()]; }
  function timeLabel(t) { var d = new Date(t); return dayLabel(d) + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function signed(n) { return n > 0 ? '+' + n : (n < 0 ? '−' + (-n) : '0'); }
  function inv() { return CA.inv || {}; }

  // raison (stock_moves.reason) -> libellé + colonne du tableau
  var REASONS = {
    reception: ['Réception', 'in'], reception_edit: ['Réception modifiée', 'in'],
    invoice: ['Facture', 'out'], invoice_cancel: ['Facture annulée', 'out'], invoice_edit: ['Facture modifiée', 'out'], deliver: ['Remise « à venir »', 'out'],
    internal: ['Usage interne', 'int'], amazon: ['Envoi Amazon', 'int'], production: ['Production', 'int'], production_delete: ['Production supprimée', 'int'],
    count: ['Comptage', 'cor'], manual: ['Modifié à la main', 'cor'], created: ['Création', 'cor']
  };
  function reasonOf(r) { return REASONS[r] || [r || '—', 'cor']; }

  var fromI = $('#sj-from'), toI = $('#sj-to'), movedI = $('#sj-moved'), bodyEl = $('#sj-body'),
      snapEl = $('#sj-snap'), noteEl = $('#sj-note'), refreshBtn = $('#sj-refresh'), countBtn = $('#sj-count-btn'),
      viewEl = $('#sj-view'), countEl = $('#sj-count');

  var data = null;          // { rows: [...], moves: {key: [moves]} }
  var openKey = null;       // ligne dépliée (journal d'un filament)
  var shown = false;

  function key(pid, kind) { return pid + '|' + kind; }

  function show() {
    if (!fromI.value || !toI.value) {
      var t = new Date(), f = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6);
      toI.value = iso(t); fromI.value = iso(f);
    }
    if (count.active) { renderCount(); return; }
    if (!shown) { shown = true; load(); }
  }

  /* ---------------- chargement ---------------- */
  function load() {
    var from = parseDay(fromI.value), to = parseDay(toI.value);
    if (!from || !to) return;
    if (to < from) { var x = from; from = to; to = x; fromI.value = iso(from); toI.value = iso(to); }
    var start = from.toISOString(), end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).toISOString();
    bodyEl.innerHTML = '<p class="muted sj-empty">Chargement…</p>';
    var ready = inv().ready ? inv().ready() : Promise.resolve();
    Promise.all([
      ready.then(function () { return inv().reload ? inv().reload() : null; }),
      sb.from('stock_moves').select('product_id,kind,delta,reason,ref,at,qty_before,qty_after,by_email')
        .gte('at', start).lt('at', end).order('at', { ascending: true }).limit(10000),
      sb.from('stock_moves').select('product_id,kind,delta,at').gte('at', end).limit(20000),
      sb.from('stock_moves').select('at').order('at', { ascending: true }).limit(1),
      sb.from('stock_snapshots').select('day,taken_at').lte('day', iso(to)).order('day', { ascending: false }).limit(1)
    ]).then(function (r) {
      for (var i = 1; i < r.length; i++) if (r[i] && r[i].error) throw r[i].error;
      var snapHead = (r[4].data || [])[0] || null;
      var snapQ = snapHead ? sb.from('stock_snapshots').select('product_id,qty,qty_2').eq('day', snapHead.day).limit(5000) : Promise.resolve({ data: [] });
      return snapQ.then(function (s) {
        if (s.error) throw s.error;
        build(r[1].data || [], r[2].data || [], (r[3].data || [])[0], snapHead, s.data || [], to);
      });
    }).then(null, function (err) {
      bodyEl.innerHTML = '<p class="sj-empty bad">Erreur : ' + esc(err && err.message || err) + '</p>';
    });
  }

  function build(moves, after, first, snapHead, snapRows, to) {
    var fils = (inv().filaments ? inv().filaments() : []);
    var byKey = {}, aft = {}, rows = [];
    moves.forEach(function (m) { (byKey[key(m.product_id, m.kind)] = byKey[key(m.product_id, m.kind)] || []).push(m); });
    after.forEach(function (m) { var k = key(m.product_id, m.kind); (aft[k] = aft[k] || []).push(m); });
    var snap = {};
    snapRows.forEach(function (s) { snap[key(s.product_id, 'spool')] = s.qty; snap[key(s.product_id, 'refill')] = s.qty_2; });
    var snapIsTo = snapHead && snapHead.day === iso(to);
    var tot = { spool: 0, refill: 0, fils: 0 };

    fils.forEach(function (f) {
      var any = false;
      ['spool', 'refill'].forEach(function (kind) {
        var k = key(f.id, kind), cur = (kind === 'refill' ? f.qty_2 : f.qty);
        var list = byKey[k] || [], later = aft[k] || [];
        var offered = kind === 'refill' ? (inv().offersRefill ? inv().offersRefill(f) : true) : (inv().offersSpool ? inv().offersSpool(f) : true);
        if (!offered && !list.length && !(cur > 0)) return;
        var sumAfter = later.reduce(function (s, m) { return s + m.delta; }, 0);
        var fin = (cur | 0) - sumAfter;
        var c = { in: 0, out: 0, int: 0, cor: 0 };
        list.forEach(function (m) { c[reasonOf(m.reason)[1]] += m.delta; });
        var debut = fin - c.in - c.out - c.int - c.cor;
        // contre-vérification avec la photo du dernier jour : stock calculé au moment de la photo
        var snapGap = null;
        if (snapIsTo && snap[k] != null) {
          var t = new Date(snapHead.taken_at).getTime();
          var atSnap = (cur | 0) - later.filter(function (m) { return new Date(m.at).getTime() > t; }).reduce(function (s, m) { return s + m.delta; }, 0);
          if (atSnap !== (snap[k] | 0)) snapGap = (snap[k] | 0) - atSnap;
        }
        rows.push({ f: f, kind: kind, k: k, debut: debut, fin: fin, c: c, n: list.length, snapGap: snapGap });
        if (snapHead && snap[k] != null) { tot[kind] += snap[k] | 0; any = any || (snap[k] | 0) > 0; }
      });
      if (any) tot.fils++;
    });
    data = { rows: rows, moves: byKey };

    if (noteEl) noteEl.textContent = first ? 'Journal depuis le ' + dayLabel(new Date(first.at)) + ' · photo chaque nuit' : 'Le journal commence au prochain mouvement · photo chaque nuit';
    if (snapEl) {
      if (snapHead) {
        var sd = parseDay(snapHead.day);
        snapEl.innerHTML = '<span class="sj-snap-ic" aria-hidden="true"></span><b>Photo du ' + esc(dayLabel(sd)) + '</b>' +
          '<span>' + tot.fils + ' filaments · ' + tot.spool + ' bobines · ' + tot.refill + ' recharges</span>';
        snapEl.hidden = false;
      } else snapEl.hidden = true;
    }
    render();
  }

  /* ---------------- tableau ---------------- */
  function cell(n, cls) { return '<span class="sj-n' + (n ? (n > 0 ? ' up' : ' down') : ' zero') + (cls ? ' ' + cls : '') + '">' + (n ? signed(n) : '·') + '</span>'; }
  function render() {
    if (!data) return;
    var onlyMoved = movedI ? movedI.checked : true;
    var list = data.rows.filter(function (r) { return !onlyMoved || r.n > 0 || r.snapGap != null; });
    if (inv().sortLines) list = inv().sortLines(list, function (r) { return r.f.id; }, function (r) { return r.kind; });
    if (!list.length) {
      bodyEl.innerHTML = '<p class="muted sj-empty">' + (onlyMoved ? 'Aucun mouvement de filament sur cette période.' : 'Aucun filament.') + '</p>';
      return;
    }
    var h = '<div class="sj-grid" role="table">' +
      '<div class="sj-row sj-head" role="row"><span class="sj-fil">Filament</span><span>Début</span><span>Reçu</span><span>Vendu</span><span>Interne</span><span>Corr.</span><span>Fin</span></div>';
    list.forEach(function (r) {
      var warn = r.c.cor !== 0 || r.snapGap != null;
      var sw = inv().swatch ? inv().swatch(r.f) : '#ccc';
      h += '<div class="sj-row' + (warn ? ' is-warn' : '') + (openKey === r.k ? ' is-open' : '') + '" role="row" data-k="' + esc(r.k) + '" tabindex="0">' +
        '<span class="sj-fil"><i class="sj-sw" style="background:' + esc(sw) + '"></i><span class="sj-lbl">' + esc(inv().label ? inv().label(r.f) : r.f.name) +
        ' <em>' + (r.kind === 'refill' ? 'Recharge' : 'Bobine') + '</em></span>' + (warn ? '<b class="sj-flag" title="Correction ou écart">⚠</b>' : '') + '</span>' +
        '<span class="sj-n sj-stock" data-l="Début">' + r.debut + '</span>' +
        cell(r.c.in, '" data-l="Reçu') + cell(r.c.out, '" data-l="Vendu') + cell(r.c.int, '" data-l="Interne') + cell(r.c.cor, '" data-l="Corr.') +
        '<span class="sj-n sj-stock sj-fin" data-l="Fin">' + r.fin + '</span>' +
        '</div>';
      if (openKey === r.k) h += detailHtml(r);
    });
    bodyEl.innerHTML = h + '</div>';
  }
  function detailHtml(r) {
    var list = (data.moves[r.k] || []).slice().reverse();
    var h = '<div class="sj-detail" role="row">';
    if (r.snapGap != null) h += '<p class="sj-gap">⚠ La photo de la nuit diffère de ' + signed(r.snapGap) + '.</p>';
    if (!list.length) h += '<p class="muted">Aucun mouvement sur cette période.</p>';
    list.forEach(function (m) {
      var rs = reasonOf(m.reason);
      h += '<div class="sj-mv"><span class="sj-mv-t">' + esc(timeLabel(m.at)) + '</span>' +
        '<span class="sj-mv-r sj-r-' + rs[1] + '">' + (m.ref && m.ref.indexOf(rs[0]) === 0 ? '<b>' + esc(m.ref) + '</b>' : esc(rs[0]) + (m.ref ? ' <b>' + esc(m.ref) + '</b>' : '')) + '</span>' +
        '<span class="sj-n ' + (m.delta > 0 ? 'up' : 'down') + '">' + signed(m.delta) + '</span>' +
        '<span class="sj-mv-ba">' + (m.qty_before == null ? '—' : m.qty_before) + ' → ' + (m.qty_after == null ? '—' : m.qty_after) + '</span></div>';
    });
    return h + '</div>';
  }
  function toggleRow(el) {
    var k = el.getAttribute('data-k');
    openKey = openKey === k ? null : k;
    render();
  }
  bodyEl.addEventListener('click', function (e) { var r = e.target.closest('.sj-row[data-k]'); if (r) toggleRow(r); });
  bodyEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var r = e.target.closest('.sj-row[data-k]'); if (r) { e.preventDefault(); toggleRow(r); }
  });
  [fromI, toI].forEach(function (i) { if (i) i.addEventListener('change', function () { openKey = null; load(); }); });
  if (movedI) movedI.addEventListener('change', render);
  if (refreshBtn) refreshBtn.addEventListener('click', function () { load(); });
  $$('.sj-quick button').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = new Date(), n = +b.getAttribute('data-days');
      toI.value = iso(t);
      fromI.value = iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - (n - 1)));
      openKey = null; load();
    });
  });
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* =========================================================
     COMPTAGE COMPLET
     ========================================================= */
  var DRAFT = 'ca_stock_count';
  var count = { active: false, items: {}, order: [], undo: [], last: { code: '', t: 0 }, held: '', review: false };
  try {
    var saved = JSON.parse(localStorage.getItem(DRAFT) || 'null');
    if (saved && saved.items) { count.items = saved.items; count.order = saved.order || Object.keys(saved.items); count.active = true; }
  } catch (e) {}
  function saveDraft() {
    try {
      if (count.active) localStorage.setItem(DRAFT, JSON.stringify({ items: count.items, order: count.order }));
      else localStorage.removeItem(DRAFT);
    } catch (e) {}
  }
  function beep(kind) { var b = CA.invBeep; if (!b) return; if (kind === 'bad') b.bad(); else if (kind === 'refill') b.refill(); else b.ok(); }
  function totalCounted() { var n = 0; Object.keys(count.items).forEach(function (k) { n += count.items[k]; }); return n; }

  function startCount() {
    count.active = true; count.review = false; count.items = {}; count.order = []; count.undo = [];
    saveDraft(); renderCount();
  }
  function stopCount() { count.active = false; count.review = false; count.items = {}; count.order = []; count.undo = []; saveDraft(); renderCount(); }

  if (countBtn) countBtn.addEventListener('click', function () {
    var go = function () { (inv().ready ? inv().ready() : Promise.resolve()).then(startCount); };
    if (count.active) { renderCount(); return; }
    go();
  });

  function renderCount() {
    viewEl.hidden = count.active;
    countEl.hidden = !count.active;
    if (countBtn) countBtn.hidden = count.active;
    if (!count.active) { if (!shown) { shown = true; load(); } return; }
    if (count.review) { renderReview(); return; }
    var n = totalCounted();
    countEl.innerHTML =
      '<div class="scan-station is-armed sj-cstation">' +
        '<div class="scan-head"><b class="sj-ctitle">Comptage en cours</b><span class="grow"></span>' +
        '<div class="scan-count"><span class="scan-count-num">' + n + '</span><span class="scan-count-lbl">' + (n > 1 ? 'comptés' : 'compté') + '</span></div></div>' +
        '<div class="scan-banner" id="sjc-banner" hidden><div class="scan-banner-name"></div><div class="scan-banner-sub"><b></b><span></span></div>' +
          '<button type="button" class="btn btn-sm scan-banner-again" hidden>Compter quand même</button></div>' +
        '<div class="scan-inputwrap"><input type="text" id="sjc-input" class="scan-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Scanne chaque bobine et recharge…"></div>' +
        '<div class="scan-feedback" id="sjc-fb" aria-live="polite"></div>' +
        '<div class="scan-tools"><button type="button" class="btn btn-ghost btn-sm" id="sjc-undo" data-ic="undo"' + (count.undo.length ? '' : ' disabled') + ' title="Échap">Annuler le dernier</button></div>' +
      '</div>' +
      '<div class="sj-clist" id="sjc-list"></div>' +
      '<div class="sj-cactions">' +
        '<button type="button" class="btn btn-ghost" id="sjc-stop">Abandonner</button><span class="grow"></span>' +
        '<button type="button" class="btn btn-accent" id="sjc-review" data-ic="check"' + (n ? '' : ' disabled') + '>Voir les écarts</button>' +
      '</div>';
    renderCountList();
    var input = $('#sjc-input');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); undoCount(); return; }
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      e.preventDefault();
      var code = (input.value || '').trim(); input.value = '';
      if (code) countScan(code);
    });
    $('#sjc-undo').addEventListener('click', function () { undoCount(); input.focus(); });
    $('#sjc-stop').addEventListener('click', function () {
      caDialog.confirm({ title: 'Abandonner le comptage ?', message: 'Rien ne sera changé dans le stock.', ok: 'Abandonner' })
        .then(function (ok) { if (ok) stopCount(); });
    });
    $('#sjc-review').addEventListener('click', openReview);
    $('#sjc-banner .scan-banner-again').addEventListener('click', function () {
      var code = count.held; count.held = ''; this.hidden = true;
      if (code) addCount(code); input.focus();
    });
    try { input.focus(); } catch (e) {}
  }
  function fb(msg, cls) { var el = $('#sjc-fb'); if (el) { el.textContent = msg; el.className = 'scan-feedback' + (cls ? ' ' + cls : ''); } }
  function cBanner(f, kind, n, warn) {
    var b = $('#sjc-banner'); if (!b || !f) return;
    b.hidden = false;
    b.className = 'scan-banner' + (warn ? ' is-warn' : '') + (kind === 'refill' ? ' is-refill' : '');
    b.style.background = inv().swatch ? inv().swatch(f) : '';
    b.style.color = inkOn(f.attrs && Array.isArray(f.attrs.colors) && f.attrs.colors[0] || f.hex);
    b.querySelector('.scan-banner-name').textContent = (f.material ? f.material + ' · ' : '') + (f.name || '');
    b.querySelector('.scan-banner-sub b').textContent = kind === 'refill' ? 'RECHARGE' : 'BOBINE';
    b.querySelector('.scan-banner-sub span').textContent = n == null ? '' : '× ' + n;
    b.querySelector('.scan-banner-again').hidden = true;
  }
  function inkOn(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return '#111';
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111' : '#fff';
  }
  function countScan(code) {
    var hit = inv().find ? inv().find(code) : null;
    if (!hit) { beep('bad'); fb('⚠ Code inconnu (' + code + ') — associe-le dans Codes-barres, puis rescanne.', 'warn'); return; }
    if (hit.kind === 'item') { beep('bad'); fb('⚠ Accessoire : pas compté ici.', 'warn'); return; }
    var now = Date.now();
    if (code === count.last.code && now - count.last.t < 1000) {
      count.last.t = now; count.held = code;
      beep('bad');
      cBanner(hit.f, hit.kind, null, true);
      $('#sjc-banner .scan-banner-sub span').textContent = 'Lu 2 fois · compté 1 fois';
      $('#sjc-banner .scan-banner-again').hidden = false;
      fb('⚠ Double lecture ignorée.', 'warn');
      return;
    }
    count.last = { code: code, t: now };
    addCount(code, hit);
  }
  function addCount(code, hit) {
    hit = hit || (inv().find ? inv().find(code) : null);
    if (!hit) return;
    var k = key(hit.f.id, hit.kind);
    if (!count.items[k]) { count.items[k] = 0; count.order.push(k); }
    count.items[k]++;
    count.undo.push(k); if (count.undo.length > 100) count.undo.shift();
    saveDraft();
    beep(hit.kind === 'refill' ? 'refill' : 'ok');
    cBanner(hit.f, hit.kind, count.items[k]);
    fb('✓ ' + (inv().label ? inv().label(hit.f) : '') + ' · ' + (hit.kind === 'refill' ? 'recharge' : 'bobine') + '  (×' + count.items[k] + ')', 'ok');
    refreshCountHead(k);
  }
  function undoCount() {
    var k = count.undo.pop();
    if (!k) return;
    count.items[k] = Math.max(0, (count.items[k] || 0) - 1);
    if (!count.items[k]) { delete count.items[k]; count.order = count.order.filter(function (x) { return x !== k; }); }
    count.last = { code: '', t: 0 };
    saveDraft();
    beep('bad');
    var p = k.split('|'), f = inv().prod ? inv().prod(p[0]) : null;
    fb('↶ Retiré : ' + (f && inv().label ? inv().label(f) : 'article') + ' · ' + (p[1] === 'refill' ? 'recharge' : 'bobine'), 'warn');
    var prev = count.undo[count.undo.length - 1];
    if (prev && count.items[prev]) { var q = prev.split('|'); cBanner(inv().prod(q[0]), q[1], count.items[prev]); }
    else { var b = $('#sjc-banner'); if (b) b.hidden = true; }
    refreshCountHead(k);
  }
  function refreshCountHead(flashKey) {
    var n = totalCounted();
    var num = countEl.querySelector('.scan-count-num'), lbl = countEl.querySelector('.scan-count-lbl');
    if (num) { num.textContent = n; num.classList.remove('scan-bump'); void num.offsetWidth; num.classList.add('scan-bump'); }
    if (lbl) lbl.textContent = n > 1 ? 'comptés' : 'compté';
    var u = $('#sjc-undo'); if (u) u.disabled = !count.undo.length;
    var rv = $('#sjc-review'); if (rv) rv.disabled = !n;
    renderCountList(flashKey);
  }
  function renderCountList(flashKey) {
    var el = $('#sjc-list'); if (!el) return;
    var keys = count.order.filter(function (k) { return count.items[k]; });
    if (!keys.length) { el.innerHTML = '<p class="muted sj-empty">Rien de compté pour l\'instant.</p>'; return; }
    if (inv().sortLines) keys = inv().sortLines(keys, function (k) { return k.split('|')[0]; }, function (k) { return k.split('|')[1]; });
    el.innerHTML = keys.map(function (k) {
      var p = k.split('|'), f = inv().prod ? inv().prod(p[0]) : null;
      if (!f) return '';
      return '<div class="sj-crow' + (k === flashKey ? ' rv-flash' : '') + '" data-k="' + esc(k) + '"><i class="sj-sw" style="background:' + esc(inv().swatch(f)) + '"></i>' +
        '<span class="sj-lbl">' + esc(inv().label(f)) + ' <em>' + (p[1] === 'refill' ? 'Recharge' : 'Bobine') + '</em></span>' +
        '<span class="sj-cqty"><button type="button" class="btn btn-ghost btn-sm sjc-m" aria-label="Retirer un">−</button><b>' + count.items[k] + '</b>' +
        '<button type="button" class="btn btn-ghost btn-sm sjc-p" aria-label="Ajouter un">+</button></span></div>';
    }).join('');
  }
  countEl.addEventListener('click', function (e) {
    var b = e.target.closest('.sjc-m, .sjc-p'); if (!b) return;
    var k = b.closest('.sj-crow').getAttribute('data-k');
    count.items[k] = Math.max(0, (count.items[k] || 0) + (b.classList.contains('sjc-p') ? 1 : -1));
    if (!count.items[k]) { delete count.items[k]; count.order = count.order.filter(function (x) { return x !== k; }); }
    count.undo = count.undo.filter(function (x) { return count.items[x]; });
    saveDraft(); refreshCountHead();
  });

  /* ---- revue des écarts ---- */
  var review = [];
  function openReview() {
    var rv = $('#sjc-review'); if (rv) { rv.disabled = true; rv.textContent = 'Lecture du stock…'; }
    (inv().reload ? inv().reload() : Promise.resolve()).then(function () {
      var fils = inv().filaments ? inv().filaments() : [];
      review = [];
      fils.forEach(function (f) {
        ['spool', 'refill'].forEach(function (kind) {
          var k = key(f.id, kind), base = (kind === 'refill' ? f.qty_2 : f.qty) | 0;
          var counted = count.items[k];
          if (counted != null) { if (counted !== base) review.push({ f: f, kind: kind, k: k, base: base, to: counted, seen: true, on: true }); }
          else if (base > 0) review.push({ f: f, kind: kind, k: k, base: base, to: 0, seen: false, on: false });
        });
      });
      if (inv().sortLines) review = inv().sortLines(review, function (r) { return r.f.id; }, function (r) { return r.kind; });
      count.review = true;
      renderReview();
    }, function (err) { caDialog.error(err); renderCount(); });
  }
  function rowRev(r, i) {
    return '<label class="sj-rrow' + (r.seen ? '' : ' is-unseen') + '"><input type="checkbox" data-i="' + i + '"' + (r.on ? ' checked' : '') + '>' +
      '<i class="sj-sw" style="background:' + esc(inv().swatch(r.f)) + '"></i>' +
      '<span class="sj-lbl">' + esc(inv().label(r.f)) + ' <em>' + (r.kind === 'refill' ? 'Recharge' : 'Bobine') + '</em></span>' +
      '<span class="sj-rnum"><span class="sj-rbase">' + r.base + '</span> → <b>' + r.to + '</b> <span class="sj-n ' + (r.to - r.base > 0 ? 'up' : 'down') + '">' + signed(r.to - r.base) + '</span></span></label>';
  }
  function renderReview() {
    var diff = review.filter(function (r) { return r.seen; }), unseen = review.filter(function (r) { return !r.seen; });
    var h = '<div class="sj-review">';
    h += '<div class="sj-rhead"><h2>Écarts trouvés</h2><span class="muted">' + totalCounted() + ' comptés</span></div>';
    if (!diff.length) h += '<p class="muted sj-empty">✓ Tout ce qui a été scanné correspond au stock.</p>';
    diff.forEach(function (r) { h += rowRev(r, review.indexOf(r)); });
    if (unseen.length) {
      h += '<div class="sj-rhead sj-runseen"><h2>Pas vus</h2><span class="muted">En stock, mais pas scannés</span></div>';
      unseen.forEach(function (r) { h += rowRev(r, review.indexOf(r)); });
    }
    h += '</div><div class="sj-cactions">' +
      '<button type="button" class="btn btn-ghost" id="sjr-back">Continuer à compter</button><span class="grow"></span>' +
      '<button type="button" class="btn btn-accent" id="sjr-apply" data-ic="check">Corriger le stock</button></div>';
    countEl.innerHTML = h;
    syncApply();
    countEl.querySelectorAll('.sj-review input[type=checkbox]').forEach(function (c) {
      c.addEventListener('change', function () { review[+c.getAttribute('data-i')].on = c.checked; syncApply(); });
    });
    $('#sjr-back').addEventListener('click', function () { count.review = false; renderCount(); });
    $('#sjr-apply').addEventListener('click', applyReview);
  }
  function syncApply() {
    var n = review.filter(function (r) { return r.on; }).length, b = $('#sjr-apply');
    if (!b) return;
    b.textContent = n ? 'Corriger ' + n + ' ligne' + (n > 1 ? 's' : '') : 'Terminer sans corriger';
  }
  function applyReview() {
    var todo = review.filter(function (r) { return r.on; });
    var finish = function (msg) {
      stopCount();
      openKey = null; shown = true; load();
      if (caDialog.toast) caDialog.toast(msg);
    };
    if (!todo.length) { finish('Comptage terminé · stock inchangé'); return; }
    caDialog.confirm({ title: 'Corriger ' + todo.length + ' ligne' + (todo.length > 1 ? 's' : '') + ' ?',
      message: 'Le stock prend la valeur comptée. Chaque correction est notée au journal (« Comptage »).', ok: 'Corriger' })
      .then(function (ok) {
        if (!ok) return;
        var b = $('#sjr-apply'); if (b) { b.disabled = true; b.textContent = 'Correction…'; }
        var ref = 'Comptage ' + iso(new Date());
        var chain = Promise.resolve(), done = 0;
        todo.forEach(function (r) {
          chain = chain.then(function () {
            return sb.rpc('admin_set_stock', { p_product: r.f.id, p_kind: r.kind, p_qty: r.to, p_reason: 'count', p_ref: ref })
              .then(function (res) { if (res && res.error) throw res.error; done++; });
          });
        });
        chain.then(function () { finish(done + ' correction' + (done > 1 ? 's' : '') + ' notée' + (done > 1 ? 's' : '') + ' au journal'); },
          function (err) { caDialog.error(err, done + ' ligne(s) corrigée(s) avant l\'erreur'); if (b) { b.disabled = false; syncApply(); } });
      });
  }

  CA.stockJournal = { show: show, reload: load };
  if (count.active) { viewEl.hidden = true; countEl.hidden = false; }
})();
