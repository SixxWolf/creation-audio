/* =========================================================
   Création Audio — CMS Commandes › Cueillettes (#commandes/cueillettes)
   - Horaire des plages offertes aux clients : admin_settings clé « cueillette »
     { week: { "1": [{ s, e }] … "7" } (jour ISO, lundi = 1), closed: [{ from, to }],
       extra: [{ d, s, e }], cap (clients par plage, 0 = illimité), notice (h), days }.
     Lu par les RPC pickup_slots / customer_* (schema-v2.sql) -> sélecteur du panier
     et de Mon compte (CA.custOrder.picker, commande-client.js).
   - À venir : commandes en cours (Nouvelle → Prête) et réservations actives avec
     une plage, groupées par jour puis par plage ; + commandes Prêtes sans plage.
   - Sous-onglet affiché par cms-commandes-clients.js (showSub) -> CA.loadPickups().
   ========================================================= */
(function () {
  'use strict';

  var CA = window.CA, sb = CA && CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function hTxt(t) { return CA.hourTxt ? CA.hourTxt(t) : String(t || '').slice(0, 5); }
  function hm(t) { return String(t || '').slice(0, 5); }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function today() { return ymd(new Date()); }
  function dayLabel(iso) {
    var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    var t = d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  var form = $('#cq-setup'), weekEl = $('#cq-week'), closedEl = $('#cq-closed'), extraEl = $('#cq-extra');
  var listEl = $('#cq-list'), statusEl = $('#cq-status'), saveBtn = $('#cq-save');
  if (!form || !weekEl || !listEl) return;

  var KEY = 'cueillette';
  var DAYS = [['1', 'Lundi'], ['2', 'Mardi'], ['3', 'Mercredi'], ['4', 'Jeudi'], ['5', 'Vendredi'], ['6', 'Samedi'], ['7', 'Dimanche']];
  var STATUS = { 'new': 'Nouvelle', preparing: 'En préparation', ready: 'Prête' };
  var cfg = null, cfgLoading = null, listLoading = null;

  function blank() { return { week: {}, closed: [], extra: [], cap: 0, notice: 24, days: 14 }; }

  /* ---- horaire : lecture ---- */
  function loadCfg() {
    if (cfgLoading) return cfgLoading;
    cfgLoading = sb.from('admin_settings').select('value').eq('key', KEY).maybeSingle().then(function (res) {
      if (res.error) throw res.error;
      var v = (res.data && res.data.value) || {};
      cfg = blank();
      Object.keys(cfg).forEach(function (k) { if (v[k] != null) cfg[k] = v[k]; });
      cfg.week = JSON.parse(JSON.stringify(cfg.week || {}));
      cfg.closed = (cfg.closed || []).slice(); cfg.extra = (cfg.extra || []).slice();
      paint();
    }).then(function () { cfgLoading = null; }, function (err) {
      cfgLoading = null;
      weekEl.innerHTML = '<p class="empty">Impossible de lire l\'horaire.<br>' + esc(err && err.message || err) + '</p>';
    });
    return cfgLoading;
  }

  /* ---- horaire : affichage ---- */
  function x(list, i, d) {
    return '<button type="button" class="cq-x" data-rm="' + list + '" data-i="' + i + '"' + (d ? ' data-d="' + d + '"' : '') +
      ' aria-label="Retirer">×</button>';
  }
  function inp(type, list, i, k, val, d) {
    return '<input type="' + type + '"' + (type === 'time' ? ' step="900"' : '') + ' data-list="' + list + '" data-i="' + i + '" data-k="' + k + '"' +
      (d ? ' data-d="' + d + '"' : '') + ' value="' + esc(val || '') + '">';
  }
  function paint() {
    weekEl.innerHTML = DAYS.map(function (dd) {
      var d = dd[0], slots = cfg.week[d] || [];
      return '<div class="cq-day' + (slots.length ? '' : ' is-off') + '">' +
        '<span class="cq-dname">' + dd[1] + '</span>' +
        '<div class="cq-slots">' + (slots.length ? slots.map(function (s, i) {
          return '<span class="cq-slot">' + inp('time', 'week', i, 's', s.s, d) + '<span class="cq-dash">–</span>' +
            inp('time', 'week', i, 'e', s.e, d) + x('week', i, d) + '</span>';
        }).join('') : '<span class="cq-off">Fermé</span>') + '</div>' +
        '<button type="button" class="cq-add" data-add="week" data-d="' + d + '" aria-label="Ajouter une plage le ' + dd[1].toLowerCase() + '">+</button>' +
      '</div>';
    }).join('');
    closedEl.innerHTML = cfg.closed.length ? cfg.closed.map(function (c, i) {
      return '<div class="cq-row">' + inp('date', 'closed', i, 'from', c.from) + '<span class="cq-dash">au</span>' +
        inp('date', 'closed', i, 'to', c.to || c.from) + x('closed', i) + '</div>';
    }).join('') : '<p class="cq-none">Aucune</p>';
    extraEl.innerHTML = cfg.extra.length ? cfg.extra.map(function (c, i) {
      return '<div class="cq-row">' + inp('date', 'extra', i, 'd', c.d) + inp('time', 'extra', i, 's', c.s) +
        '<span class="cq-dash">–</span>' + inp('time', 'extra', i, 'e', c.e) + x('extra', i) + '</div>';
    }).join('') : '<p class="cq-none">Aucune</p>';
    $('#cq-cap').value = cfg.cap > 0 ? cfg.cap : '';
    $('#cq-notice').value = cfg.notice != null ? cfg.notice : 24;
    $('#cq-days').value = cfg.days || 14;
  }
  function arr(list, d) {
    if (list === 'week') return (cfg.week[d] = cfg.week[d] || []);
    return cfg[list];
  }
  function addHours(t, h) {
    var p = hm(t).split(':'), m = Math.min(23 * 60 + 45, (+p[0] || 0) * 60 + (+p[1] || 0) + h * 60);
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function touched() { if (statusEl) statusEl.textContent = 'Modifications non enregistrées'; }

  form.addEventListener('input', function (e) {
    var t = e.target, list = t.getAttribute('data-list');
    if (!cfg || !list) { if (cfg) touched(); return; }
    var row = arr(list, t.getAttribute('data-d'))[+t.getAttribute('data-i')];
    if (row) row[t.getAttribute('data-k')] = t.value;
    touched();
  });
  form.addEventListener('click', function (e) {
    if (!cfg) return;
    var rm = e.target.closest('[data-rm]'), add = e.target.closest('[data-add]');
    if (rm) {
      var list = rm.getAttribute('data-rm'), d = rm.getAttribute('data-d'), a = arr(list, d);
      a.splice(+rm.getAttribute('data-i'), 1);
      if (list === 'week' && !a.length) delete cfg.week[d];
      paint(); touched();
    } else if (add) {
      var day = add.getAttribute('data-d'), slots = arr('week', day), last = slots[slots.length - 1];
      if (!last) {   // reprend la dernière plage d'un autre jour
        DAYS.forEach(function (dd) { var s = cfg.week[dd[0]]; if (s && s.length && dd[0] !== day) last = last || s[s.length - 1]; });
        slots.push(last ? { s: last.s, e: last.e } : { s: '13:00', e: '17:00' });
      } else slots.push({ s: hm(last.e), e: addHours(last.e, 2) });
      paint(); touched();
    }
  });
  $('#cq-add-closed').addEventListener('click', function () {
    if (!cfg) return;
    cfg.closed.push({ from: today(), to: today() }); paint(); touched();
  });
  $('#cq-add-extra').addEventListener('click', function () {
    if (!cfg) return;
    cfg.extra.push({ d: today(), s: '13:00', e: '17:00' }); paint(); touched();
  });

  /* ---- horaire : enregistrement ---- */
  function intOf(id, dflt, min, max) {
    var n = parseInt($(id).value, 10);
    if (!isFinite(n)) n = dflt;
    return Math.min(max, Math.max(min, n));
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!cfg) return;
    var t = today(), bad = '', week = {};
    DAYS.forEach(function (dd) {
      var s = (cfg.week[dd[0]] || []).map(function (p) { return { s: hm(p.s), e: hm(p.e) }; });
      s.forEach(function (p) { if (!bad && (!p.s || !p.e || p.e <= p.s)) bad = dd[1] + ' : ' + (p.s || '?') + ' – ' + (p.e || '?'); });
      s.sort(function (a, b) { return a.s < b.s ? -1 : 1; });
      if (s.length) week[dd[0]] = s;
    });
    var closed = cfg.closed.filter(function (c) { return c.from; }).map(function (c) {
      var a = c.from, b = c.to || c.from;
      return a <= b ? { from: a, to: b } : { from: b, to: a };
    }).filter(function (c) { return c.to >= t; }).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    var extra = cfg.extra.filter(function (c) { return c.d && c.d >= t; }).map(function (c) { return { d: c.d, s: hm(c.s), e: hm(c.e) }; });
    extra.forEach(function (p) { if (!bad && (!p.s || !p.e || p.e <= p.s)) bad = dayLabel(p.d) + ' : ' + (p.s || '?') + ' – ' + (p.e || '?'); });
    extra.sort(function (a, b) { return (a.d + a.s) < (b.d + b.s) ? -1 : 1; });
    if (bad) { caDialog.error(bad + ' — la fin doit suivre le début.', 'Plage invalide'); return; }
    var at = new Date().toISOString();
    var value = { week: week, closed: closed, extra: extra, cap: intOf('#cq-cap', 0, 0, 99),
                  notice: intOf('#cq-notice', 24, 0, 336), days: intOf('#cq-days', 14, 1, 60), at: at };
    saveBtn.disabled = true; if (statusEl) statusEl.textContent = 'Enregistrement…';
    sb.from('admin_settings').upsert({ key: KEY, value: value, updated_at: at }).then(function (res) {
      saveBtn.disabled = false;
      if (res.error) throw res.error;
      cfg = Object.assign(blank(), JSON.parse(JSON.stringify(value)));
      paint();
      if (statusEl) statusEl.textContent = 'Enregistré';
      loadList();
    }).then(null, function (err) {
      saveBtn.disabled = false; if (statusEl) statusEl.textContent = '';
      caDialog.error(err);
    });
  });

  /* ---- à venir ---- */
  function loadList() {
    if (listLoading) return listLoading;
    var t = today(), now = Date.now();
    listLoading = Promise.all([
      sb.from('customer_orders').select('id,number,name,email,phone,status,pickup_date,pickup_start,pickup_end')
        .in('status', ['new', 'preparing', 'ready']).or('pickup_date.gte.' + t + ',and(status.eq.ready,pickup_date.is.null)')
        .order('pickup_date', { ascending: true }).limit(300),
      sb.from('customer_reservations').select('id,number,name,email,status,expires_at,pickup_date,pickup_start,pickup_end')
        .eq('status', 'active').gte('pickup_date', t).limit(300)
    ]).then(function (rs) {
      var err = rs[0].error || rs[1].error;
      if (err) { listEl.innerHTML = '<p class="empty">Impossible de charger les cueillettes.<br>' + esc(err.message) + '</p>'; return; }
      var items = [], todo = [];
      (rs[0].data || []).forEach(function (o) { (o.pickup_date ? items : todo).push(Object.assign({ kind: 'order' }, o)); });
      (rs[1].data || []).forEach(function (r) { if (Date.parse(r.expires_at) > now) items.push(Object.assign({ kind: 'resv' }, r)); });
      render(items, todo);
    }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; })
      .then(function () { listLoading = null; }, function () { listLoading = null; });
    return listLoading;
  }
  function itemHtml(it) {
    var who = it.name || it.email;
    return '<button type="button" class="cq-item" data-go="' + (it.kind === 'resv' ? 'reservations' : 'clients') + '" data-id="' + esc(it.id) + '">' +
      (CA.avatar ? CA.avatar(who) : '') +
      '<span class="cq-who"><b>' + esc(who) + '</b><small>' + esc(it.number) + (it.phone ? ' · ' + esc(it.phone) : '') + '</small></span>' +
      '<span class="co-status is-' + (it.kind === 'resv' ? 'ready' : esc(it.status)) + '">' +
        (it.kind === 'resv' ? 'Réservation' : esc(STATUS[it.status] || it.status)) + '</span>' +
    '</button>';
  }
  function render(items, todo) {
    var t = today(), tm = new Date(); tm.setDate(tm.getDate() + 1); tm = ymd(tm);
    var nToday = items.filter(function (it) { return it.pickup_date === t; }).length;
    var badge = $('#cq-n'); if (badge) { badge.textContent = nToday; badge.hidden = !nToday; }
    items.sort(function (a, b) {
      var ka = a.pickup_date + hm(a.pickup_start), kb = b.pickup_date + hm(b.pickup_start);
      return ka < kb ? -1 : ka > kb ? 1 : String(a.number).localeCompare(String(b.number));
    });
    var cap = cfg && cfg.cap > 0 ? cfg.cap : 0, html = '', day = null, slot = null;
    items.forEach(function (it) {
      if (it.pickup_date !== day) {
        if (day) html += '</div></div></section>';
        day = it.pickup_date; slot = null;
        var n = items.filter(function (x) { return x.pickup_date === day; }).length;
        html += '<section class="cq-dayblk"><h3 class="cq-dayh">' + esc(dayLabel(day)) +
          (day === t ? '<span class="cq-tag">Aujourd\'hui</span>' : day === tm ? '<span class="cq-tag is-soft">Demain</span>' : '') +
          '<small>' + plural(n, 'cueillette', 'cueillettes') + '</small></h3><div>';
      }
      var k = hm(it.pickup_start) + '|' + hm(it.pickup_end);
      if (k !== slot) {
        if (slot) html += '</div>';
        slot = k;
        var inSlot = items.filter(function (x) { return x.pickup_date === day && hm(x.pickup_start) + '|' + hm(x.pickup_end) === k; }).length;
        html += '<div class="cq-slotblk"><div class="cq-sloth"><b>' + esc(hTxt(it.pickup_start)) + (it.pickup_end ? ' – ' + esc(hTxt(it.pickup_end)) : '') + '</b>' +
          (cap ? '<span class="cq-cap' + (inSlot >= cap ? ' is-full' : '') + '">' + inSlot + ' / ' + cap + '</span>' : '') + '</div>';
      }
      html += itemHtml(it);
    });
    if (day) html += '</div></div></section>';
    if (todo.length) {
      html += '<section class="cq-dayblk is-todo"><h3 class="cq-dayh">Prêtes, plage à choisir<small>' + plural(todo.length, 'commande', 'commandes') + '</small></h3>' +
        '<div class="cq-slotblk">' + todo.map(itemHtml).join('') + '</div></section>';
    }
    listEl.innerHTML = html || '<p class="empty">Aucune cueillette à venir.</p>';
    $$('.cq-item', listEl).forEach(function (b) {
      b.addEventListener('click', function () { openItem(b.getAttribute('data-go'), b.getAttribute('data-id')); });
    });
  }
  // ouvre la carte de la commande / réservation (sous-onglet Clients en ligne / Réservations) et la fait clignoter
  function openItem(sub, id) {
    if (CA.route && CA.route.goSub) CA.route.goSub(sub); else location.hash = '#commandes/' + sub;
    var tries = 0;
    (function seek() {
      var card = $('#' + (sub === 'reservations' ? 'cr-list' : 'cc-list') + ' .co-card[data-id="' + id + '"]');
      if (!card) { if (++tries < 20) setTimeout(seek, 150); return; }
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.classList.remove('is-flash'); void card.offsetWidth; card.classList.add('is-flash');
    })();
  }

  CA.loadPickups = function () {
    if (!cfg) loadCfg().then(loadList); else loadList();
  };
  if (CA.onAdminReady) CA.onAdminReady(function () { loadList(); });
})();
