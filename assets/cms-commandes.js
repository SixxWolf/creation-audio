/* =========================================================
   Création Audio — CMS Commandes dealer
   Commandes envoyées depuis le portail dealer (dealer.html) :
   tables dealer_orders + dealer_order_lines (schema-v2.sql).
   - Pastille « Commandes (n) » dans la barre latérale = commandes
     « Nouvelle » (rafraîchie toutes les 60 s + au retour sur la page).
   - Chaque commande : lignes, stock actuel, « à imprimer » (qté − stock),
     note du dealer, statut. Bloc « À imprimer » cumulé pour toutes
     les commandes en cours (Nouvelle + En préparation).
   - Statuts : new → preparing → ready → invoiced (+ cancelled).
     Dès « En préparation », le dealer ne peut plus modifier/annuler.
   - « Facturer » : CA.invoiceFromOrder() (cms-facturation.js) ouvre
     la facture pré-remplie ; à l'enregistrement, la commande passe
     « Facturée » (invoice_id) et CA.reloadOrders() est rappelé.
   - « Nouvelle commande » (demande reçue par message) et « Modifier » :
     RPC admin_save_dealer_order — même n° D-…, prix dealer + palier
     recalculés côté serveur ; la commande apparaît dans « Mes
     commandes » du dealer (created_by = 'admin').
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var BUCKET = 'products';
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function publicUrl(path) { if (!path) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return String(iso || '').slice(0, 16); }
  }
  function ago(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (!isFinite(s)) return '';
    if (s < 90) return 'à l\'instant';
    if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
    return 'il y a ' + plural(Math.round(s / 86400), 'jour', 'jours');
  }

  var STATUS = {
    'new':       { label: 'Nouvelle' },
    'preparing': { label: 'En préparation' },
    'ready':     { label: 'Prête' },
    'invoiced':  { label: 'Facturée' },
    'cancelled': { label: 'Annulée' }
  };
  var OPEN = { 'new': 1, 'preparing': 1, 'ready': 1 };

  var listEl = $('#co-list'), printEl = $('#co-print'), navN = $('#nav-orders-n'), openN = $('#co-open-n');
  if (!listEl) return;
  var orders = [], stock = {}, filter = 'open', loaded = false, pending = null, visible = false, flashId = null;

  /* ---- ouverture de l'onglet ---- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    visible = name === 'commandes';
    if (visible) load();
  };
  if (window.CA.onAdminReady) window.CA.onAdminReady(function () { refreshBadge(); });
  window.CA.reloadOrders = function () { if (loaded) load(); else refreshBadge(); };

  $$('.co-filter').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      $$('.co-filter').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      render();
    });
  });
  var refreshBtn = $('#co-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function () { load(); });

  /* ---- pastille « Nouvelle » (barre latérale) ---- */
  function setBadge(n) {
    if (!navN) return;
    navN.textContent = n; navN.hidden = !n;
    var tab = navN.closest('.tab');
    if (tab) tab.setAttribute('aria-label', 'Commandes' + (n ? ' (' + plural(n, 'nouvelle', 'nouvelles') + ')' : ''));
  }
  function refreshBadge() {
    sb.from('dealer_orders').select('id', { count: 'exact', head: true }).eq('status', 'new').then(function (res) {
      if (res && !res.error && typeof res.count === 'number') setBadge(res.count);
    }, function () {});
  }
  var lastPoll = Date.now();
  function poll() {
    if (document.visibilityState !== 'visible') return;
    lastPoll = Date.now();
    if (visible) load(); else refreshBadge();
  }
  setInterval(poll, 60000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && Date.now() - lastPoll > 10000) poll(); });

  /* ---- chargement ---- */
  // renvoie une promesse (le formulaire de saisie attend le catalogue) ; un seul chargement à la fois
  function load() {
    if (pending) return pending;
    if (!loaded) listEl.innerHTML = '<p class="muted">Chargement…</p>';
    pending = Promise.all([
      sb.from('dealer_orders').select('*, dealer_order_lines(*)').order('created_at', { ascending: false }).limit(200),
      sb.from('products').select('id,name,qty,image_path,active,sort_order,slug,dealer_price,sell_price,tiers,fitment:attrs->fitment').eq('type', 'spacer')
    ]).then(function (r) {
      var ro = r[0], rp = r[1];
      if (ro.error) {
        listEl.innerHTML = '<p class="empty">Impossible de charger les commandes.<br>' +
          (/relation|does not exist|schema cache/i.test(ro.error.message || '') ? 'Relance <strong>schema-v2.sql</strong> (section « Commandes dealer »).' : esc(ro.error.message)) + '</p>';
        return;
      }
      orders = ro.data || [];
      stock = {};
      ((rp && rp.data) || []).forEach(function (p) { stock[p.id] = p; });
      loaded = true;
      setBadge(orders.filter(function (o) { return o.status === 'new'; }).length);
      render();
    }, function () { listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; })
      .then(function () { pending = null; });
    return pending;
  }

  function linesOf(o) {
    return (o.dealer_order_lines || []).slice().sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  }

  /* ---- « À imprimer » : toutes les commandes Nouvelle + En préparation ---- */
  function renderPrint() {
    if (!printEl) return;
    var need = {}, names = {};
    orders.forEach(function (o) {
      if (o.status !== 'new' && o.status !== 'preparing') return;
      linesOf(o).forEach(function (l) {
        var k = l.product_id || ('?' + l.name);
        need[k] = (need[k] || 0) + (l.qty | 0);
        names[k] = l.name;
      });
    });
    var rows = Object.keys(need).map(function (k) {
      var st = stock[k] ? (stock[k].qty | 0) : 0;
      return { name: (stock[k] && stock[k].name) || names[k], need: need[k], stock: st, print: Math.max(0, need[k] - st) };
    }).filter(function (r) { return r.print > 0; })
      .sort(function (a, b) { return b.print - a.print || a.name.localeCompare(b.name, 'fr'); });
    if (!rows.length) { printEl.innerHTML = ''; return; }
    var total = rows.reduce(function (s, r) { return s + r.print; }, 0);
    printEl.innerHTML = '<section class="co-print" aria-label="À imprimer">' +
      '<div class="co-print-head">' +
        '<div class="co-print-title"><b>À imprimer</b> · ' + plural(total, 'paire', 'paires') + '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="co-print-copy" data-ic="copy">Copier la liste</button>' +
      '</div>' +
      '<div class="co-print-items">' + rows.map(function (r) {
        return '<span class="co-print-item"><b>' + esc(r.name) + '</b> × ' + r.print +
          '<small>' + r.need + ' demandée' + (r.need > 1 ? 's' : '') + ' · ' + r.stock + ' en stock</small></span>';
      }).join('') + '</div>' +
    '</section>';
    $('#co-print-copy').addEventListener('click', function () {
      var txt = 'À imprimer :\n' + rows.map(function (r) { return '- ' + r.name + ' × ' + r.print + ' paire' + (r.print > 1 ? 's' : ''); }).join('\n');
      var done = function () {
        var b = $('#co-print-copy');
        if (!b) return;
        b.textContent = 'Copié'; b.dataset.ic = 'check';
        setTimeout(function () { if (b) { b.textContent = 'Copier la liste'; b.dataset.ic = 'copy'; } }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () {}); else done();
    });
  }

  /* ---- liste ---- */
  function actionsFor(o) {
    var b = function (act, label, cls) {
      return '<button type="button" class="btn ' + (cls || 'btn-ghost') + ' btn-sm" data-act="' + act + '"' +
        (act === 'invoice' ? ' data-ic="receipt"' : act === 'edit' ? ' data-ic="edit"' : '') + '>' + label + '</button>';
    };
    switch (o.status) {
      case 'new': return b('preparing', 'Commencer la préparation', 'btn-accent') + b('invoice', 'Facturer') + b('edit', 'Modifier') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'preparing': return b('ready', 'Marquer prête', 'btn-accent') + b('invoice', 'Facturer') + b('edit', 'Modifier') + b('new', '↩ Remettre « Nouvelle »') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'ready': return b('invoice', 'Facturer', 'btn-accent') + b('edit', 'Modifier') + b('preparing', '↩ En préparation') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'invoiced': return o.invoice_id ? b('see-invoice', 'Voir la facture') : '';
      case 'cancelled': return b('new', 'Rouvrir');
    }
    return '';
  }
  function render() {
    var open = orders.filter(function (o) { return OPEN[o.status]; });
    if (openN) openN.textContent = open.length ? open.length : '';
    renderPrint();
    var list = filter === 'open' ? open : orders;
    if (!list.length) {
      listEl.innerHTML = '<p class="empty">' + (filter === 'open'
        ? 'Aucune commande en cours.' + (orders.length ? '<br>Les commandes facturées ou annulées sont sous « Toutes ».' : '<br>Les commandes envoyées depuis le portail dealer arriveront ici.')
        : 'Aucune commande dealer pour l\'instant.') + '</p>';
      return;
    }
    listEl.innerHTML = list.map(function (o) {
      var st = STATUS[o.status] || { label: o.status };
      var lines = linesOf(o), pairs = 0, toPrint = 0;
      var rows = lines.map(function (l) {
        var p = l.product_id ? stock[l.product_id] : null, s = p ? (p.qty | 0) : 0;
        var inSt = Math.min(l.qty | 0, s), pr = (l.qty | 0) - inSt;
        pairs += l.qty | 0; toPrint += pr;
        var url = p ? publicUrl(p.image_path) : '';
        return '<tr>' +
          '<td class="l"><span class="co-prod">' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="co-noimg"></span>') +
            '<b>' + esc(l.name) + '</b></span></td>' +
          '<td class="n"><b>' + (l.qty | 0) + '</b></td>' +
          '<td class="n">' + (p ? s : '—') + '</td>' +
          '<td class="n">' + (!OPEN[o.status] ? '—' : pr ? '<span class="co-print-n">' + pr + '</span>' : '<span class="co-ok">en stock</span>') + '</td>' +
          '<td class="n">' + money(l.unit_price) + '</td>' +
          '<td class="n"><b>' + money(l.line_total) + '</b></td>' +
        '</tr>';
      }).join('');
      var who = o.dealer_name || o.dealer_email;
      return '<article class="co-card is-' + esc(o.status) + '" data-id="' + esc(o.id) + '">' +
        '<header class="co-head">' +
          '<div class="co-id"><b>' + esc(o.number) + '</b><span class="co-status is-' + esc(o.status) + '">' + esc(st.label) + '</span>' +
            (o.created_by === 'admin' ? '<span class="co-src">ajoutée par toi</span>' : '') +
            (o.edited_at && OPEN[o.status] ? '<span class="co-edited">modifiée par le dealer ' + esc(ago(o.edited_at)) + '</span>' : '') +
            (o.status === 'cancelled' ? '<span class="co-edited">' + (o.cancelled_by === 'dealer' ? 'par le dealer' : 'par toi') + '</span>' : '') +
          '</div>' +
          '<div class="co-who">' + (window.CA.avatar ? window.CA.avatar(who) : '') +
            '<span><b>' + esc(who) + '</b><small>' + esc(fmtDate(o.created_at)) + ' · ' + esc(ago(o.created_at)) + '</small></span></div>' +
        '</header>' +
        (o.note ? '<p class="co-note"><b>Note :</b> ' + esc(o.note) + '</p>' : '') +
        '<div class="co-table-wrap"><table class="co-table">' +
          '<thead><tr><th class="l">Spacer</th><th class="n">Qté</th><th class="n">Stock</th><th class="n">À imprimer</th><th class="n">Prix</th><th class="n">Total</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div>' +
        '<footer class="co-foot">' +
          '<span class="co-total">' + plural(pairs, 'paire', 'paires') + (OPEN[o.status] && toPrint ? ' · <span class="co-print-n">' + toPrint + ' à imprimer</span>' : '') +
            ' · <b>' + money(o.total) + '</b> <small>hors taxes</small></span>' +
          '<div class="co-actions">' + actionsFor(o) + '</div>' +
        '</footer>' +
      '</article>';
    }).join('');
    $$('.co-card', listEl).forEach(function (card) {
      var o = orders.filter(function (x) { return x.id === card.getAttribute('data-id'); })[0];
      $$('[data-act]', card).forEach(function (btn) {
        btn.addEventListener('click', function () { act(o, btn.getAttribute('data-act'), btn); });
      });
      if (flashId && o && o.id === flashId) {
        card.classList.add('is-flash');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    flashId = null;
  }

  /* ---- actions ---- */
  function act(o, what, btn) {
    if (what === 'edit') { if (fEd) openEditor(o); return; }
    if (what === 'invoice') {
      if (!window.CA.invoiceFromOrder) { window.alert('Facturation indisponible.'); return; }
      if (window.CA.invoiceFromOrder(o, linesOf(o)) !== false) location.hash = '#facturation';
      return;
    }
    if (what === 'see-invoice') {
      if (window.CA.focusInvoice) window.CA.focusInvoice(o.invoice_id);
      location.hash = '#historique';
      return;
    }
    if (what === 'cancel' && !window.confirm('Annuler la commande ' + o.number + ' de ' + (o.dealer_name || o.dealer_email) + ' ?\nPense à prévenir le dealer.')) return;
    var patch = { status: what === 'cancel' ? 'cancelled' : what, updated_at: new Date().toISOString() };
    patch.cancelled_by = what === 'cancel' ? 'admin' : null;
    btn.disabled = true;
    sb.from('dealer_orders').update(patch).eq('id', o.id).select('id').then(function (res) {
      if (res.error) throw res.error;
      if (!res.data || !res.data.length) throw new Error('Refusé (permissions). Es-tu connecté en admin ?');
      load();
    }).then(null, function (err) { btn.disabled = false; window.alert('Erreur : ' + (err && err.message ? err.message : err)); });
  }

  /* ---- saisie manuelle : Nouvelle commande / Modifier ----
     Les prix affichés sont un aperçu (même règle que le serveur :
     prix dealer, sinon prix client, puis dernier palier atteint). */
  var fEd = $('#cof-editor'), fTitle = $('#cof-title'), fDealer = $('#cof-dealer'), fSearch = $('#cof-search'),
      fResults = $('#cof-results'), fLines = $('#cof-lines'), fNote = $('#cof-note'), fSave = $('#cof-save'),
      fStatus = $('#cof-status'), newBtn = $('#co-new');
  if (!fEd) return;
  var fOrder = null, fItems = [], fMatches = [], fActive = -1, fDirty = false, fToken = null;

  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }
  function baseOf(p) { return p.dealer_price != null ? +p.dealer_price : (+p.sell_price || 0); }
  function unitOf(p, qty) {
    var u = baseOf(p), best = 0;
    (Array.isArray(p.tiers) ? p.tiers : []).forEach(function (t) {
      var m = parseInt(t && t.min, 10), pr = parseFloat(t && t.price);
      if (isFinite(m) && m >= 1 && m <= qty && m > best && isFinite(pr) && pr >= 0) { best = m; u = pr; }
    });
    return round2(u);
  }
  function fitOf(p) { return Array.isArray(p.fitment) ? p.fitment.filter(function (r) { return r && (r.make || r.model); }) : []; }
  function fitSummary(p) {
    var seen = {}, out = [];
    fitOf(p).forEach(function (r) {
      var k = String((r.make || '') + ' ' + (r.model || '')).trim();
      if (k && !seen[k]) { seen[k] = 1; out.push(k); }
    });
    return out.length > 2 ? out.slice(0, 2).join(', ') + ' +' + (out.length - 2) : out.join(', ');
  }
  function catalog() {
    return Object.keys(stock).map(function (k) { return stock[k]; })
      .filter(function (p) { return p.active !== false; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name), 'fr'); });
  }
  // « civic 2008 » : chaque mot doit se trouver ; une année tombe dans une plage de compatibilité
  function spacerMatches(q) {
    var toks = norm(q).split(/\s+/).filter(Boolean);
    return catalog().filter(function (p) {
      if (!toks.length) return true;
      var fit = fitOf(p);
      var hay = norm([p.name, p.slug].concat(fit.map(function (r) { return [r.make, r.model, r.pos].join(' '); })).join(' '));
      return toks.every(function (t) {
        if (hay.indexOf(t) !== -1) return true;
        if (!/^(19|20)\d\d$/.test(t)) return false;
        var y = +t;
        return fit.some(function (r) {
          var a = parseInt(r.from, 10), b = parseInt(r.to, 10);
          return (isFinite(a) || isFinite(b)) && (!isFinite(a) || y >= a) && (!isFinite(b) || y <= b);
        });
      });
    }).slice(0, 40);
  }

  function hideResults() { fResults.hidden = true; fActive = -1; }
  function renderResults() {
    fMatches = spacerMatches(fSearch.value);
    fActive = fMatches.length ? 0 : -1;
    fResults.innerHTML = !fMatches.length ? '<div class="fx-combo-empty">Aucun spacer trouvé.</div>' :
      fMatches.map(function (p, i) {
        var st = p.qty | 0;
        var sub = [st > 0 ? st + ' en stock' : 'Sur commande', money(baseOf(p)), fitSummary(p)].filter(Boolean).join(' · ');
        return '<button type="button" class="fx-combo-item' + (i === fActive ? ' is-active' : '') + '" data-id="' + esc(p.id) + '">' +
          '<span class="nm">' + esc(p.name) + '</span><span class="ct">' + esc(sub) + '</span></button>';
      }).join('');
    $$('.fx-combo-item', fResults).forEach(function (b) {
      // mousedown : ajoute AVANT le blur du champ de recherche
      b.addEventListener('mousedown', function (e) { e.preventDefault(); addItem(b.getAttribute('data-id')); });
    });
    fResults.hidden = false;
  }
  function moveActive(d) {
    if (fResults.hidden || !fMatches.length) return;
    fActive = (fActive + d + fMatches.length) % fMatches.length;
    $$('.fx-combo-item', fResults).forEach(function (b, i) {
      b.classList.toggle('is-active', i === fActive);
      if (i === fActive) b.scrollIntoView({ block: 'nearest' });
    });
  }
  fSearch.addEventListener('input', renderResults);
  fSearch.addEventListener('click', function () { if (fResults.hidden) renderResults(); });   // pas au focus programmé (ouverture, Entrée)
  fSearch.addEventListener('blur', hideResults);
  fSearch.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (fResults.hidden) renderResults(); else moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Escape') { if (!fResults.hidden) { e.preventDefault(); hideResults(); } }
    else if (e.key === 'Enter') {
      e.preventDefault();   // jamais d'envoi du formulaire depuis la recherche
      if (!fResults.hidden && fActive >= 0 && fMatches[fActive]) addItem(fMatches[fActive].id);
    }
  });

  // ajout : +1 si déjà dans la commande ; focus sur sa quantité (Entrée → retour à la recherche)
  function addItem(id) {
    var it = fItems.filter(function (x) { return x.id === id; })[0];
    if (it) it.qty = Math.min(999, it.qty + 1); else fItems.push({ id: id, qty: 1 });
    fDirty = true;
    fSearch.value = '';
    hideResults();
    fStatus.textContent = '';
    renderLines();
    var q = $('tr[data-id="' + id + '"] .cof-qty', fLines);
    if (q) { q.focus(); q.select(); }
  }

  function renderSum() {
    var pairs = 0, total = 0;
    fItems.forEach(function (it) {
      var p = stock[it.id]; if (!p) return;
      pairs += it.qty; total += round2(unitOf(p, it.qty) * it.qty);
    });
    var sum = $('.cof-sum', fLines);
    if (sum) sum.innerHTML = '<span class="co-total">' + plural(pairs, 'paire', 'paires') + ' · <b>' + money(total) + '</b> <small>hors taxes</small></span>';
  }
  function renderLines() {
    fItems = fItems.filter(function (it) { return stock[it.id]; });
    if (!fItems.length) { fLines.innerHTML = '<p class="cof-empty">Aucun spacer.</p>'; return; }
    fLines.innerHTML = '<div class="co-table-wrap"><table class="co-table cof-table">' +
      '<thead><tr><th class="l">Spacer</th><th class="n">Qté</th><th class="n cof-opt">Stock</th><th class="n cof-opt">Prix</th><th class="n">Total</th><th class="n" aria-label="Retirer"></th></tr></thead>' +
      '<tbody>' + fItems.map(function (it) {
        var p = stock[it.id], u = unitOf(p, it.qty), url = publicUrl(p.image_path);
        return '<tr data-id="' + esc(it.id) + '">' +
          '<td class="l"><span class="co-prod">' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="co-noimg"></span>') +
            '<b>' + esc(p.name) + '</b></span></td>' +
          '<td class="n"><input type="number" class="cof-qty" min="1" max="999" step="1" inputmode="numeric" value="' + it.qty + '" aria-label="Quantité ' + esc(p.name) + '"></td>' +
          '<td class="n cof-opt">' + (p.qty | 0) + '</td>' +
          '<td class="n cof-opt cof-unit">' + money(u) + '</td>' +
          '<td class="n"><b class="cof-line">' + money(round2(u * it.qty)) + '</b></td>' +
          '<td class="n"><button type="button" class="btn btn-ghost btn-sm btn-icon cof-del" data-ic="trash" aria-label="Retirer ' + esc(p.name) + '"></button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="cof-sum"></div>';
    renderSum();
    $$('tbody tr', fLines).forEach(function (tr) {
      var id = tr.getAttribute('data-id'), it = fItems.filter(function (x) { return x.id === id; })[0];
      var q = $('.cof-qty', tr);
      q.addEventListener('input', function () {
        var n = parseInt(q.value, 10);
        if (!(n >= 1)) return;   // champ vidé en cours de frappe : on attend
        it.qty = Math.min(999, n); fDirty = true;
        var u = unitOf(stock[id], it.qty);
        $('.cof-unit', tr).textContent = money(u);
        $('.cof-line', tr).textContent = money(round2(u * it.qty));
        renderSum();
      });
      q.addEventListener('change', function () { q.value = it.qty; });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); q.value = it.qty; fSearch.focus(); }
      });
      $('.cof-del', tr).addEventListener('click', function () {
        fItems = fItems.filter(function (x) { return x !== it; });
        fDirty = true;
        renderLines();
      });
    });
  }

  function buildDealerSelect() {
    var list = ((window.CA.dealers && window.CA.dealers.list) || []).slice();
    var cur = fOrder ? String(fOrder.dealer_email || '') : '';
    if (cur && !list.some(function (d) { return String(d.email).toLowerCase() === cur.toLowerCase(); })) {
      list.push({ email: cur, name: fOrder.dealer_name });   // ex. commande de test admin : hors table dealers
    }
    if (!list.length) {
      fDealer.innerHTML = '<option value="">Aucun dealer (onglet Dealers)</option>';
    } else {
      fDealer.innerHTML = (list.length > 1 && !cur ? '<option value="">— choisir un dealer —</option>' : '') +
        list.map(function (d) { return '<option value="' + esc(d.email) + '">' + esc(d.name || d.email) + '</option>'; }).join('');
    }
    var match = list.filter(function (d) { return cur && String(d.email).toLowerCase() === cur.toLowerCase(); })[0];
    fDealer.value = match ? match.email : (list.length === 1 ? list[0].email : '');
    fDealer.disabled = !!fOrder;   // le dealer d'une commande existante ne change pas
  }

  function openEditor(o) {
    if (!fEd.hidden && fDirty && !window.confirm('Abandonner la saisie en cours ?')) return;
    fOrder = o || null;
    fItems = []; fDirty = false;
    fTitle.textContent = o ? 'Modifier ' + o.number : 'Nouvelle commande';
    fSave.textContent = o ? 'Enregistrer les changements' : 'Enregistrer la commande';
    fNote.value = o && o.note ? o.note : '';
    fSearch.value = ''; hideResults();
    fStatus.textContent = '';
    fLines.innerHTML = '<p class="muted">Chargement…</p>';
    fSave.disabled = true;
    fEd.hidden = false;
    fEd.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var token = {}; fToken = token;
    Promise.all([load(), window.CA.loadDealers ? window.CA.loadDealers() : null]).then(null, function () {}).then(function () {
      if (fToken !== token || fEd.hidden) return;   // fermé / rouvert entre-temps
      if (o) {
        o = orders.filter(function (x) { return x.id === o.id; })[0] || o;   // version fraîche
        fOrder = o;
        if (!OPEN[o.status]) { fLines.innerHTML = ''; fStatus.textContent = 'Commande facturée ou annulée : plus modifiable.'; return; }
        var dropped = 0;
        linesOf(o).forEach(function (l) {
          var p = l.product_id && stock[l.product_id];
          if (p && p.active !== false) fItems.push({ id: p.id, qty: l.qty | 0 }); else dropped++;
        });
        if (dropped) fStatus.textContent = plural(dropped, 'ligne retirée', 'lignes retirées') + ' : spacer inactif.';
      }
      buildDealerSelect();
      renderLines();
      fSave.disabled = false;
      (o || fDealer.value ? fSearch : fDealer).focus({ preventScroll: true });
    });
  }
  function closeEditor() {
    if (fDirty && !window.confirm('Abandonner la saisie en cours ?')) return;
    fEd.hidden = true; fOrder = null; fItems = []; fDirty = false; fToken = null;
    hideResults();
  }

  if (newBtn) newBtn.addEventListener('click', function () { openEditor(null); });
  $('#cof-cancel').addEventListener('click', closeEditor);
  fNote.addEventListener('input', function () { fDirty = true; });
  fDealer.addEventListener('change', function () { fDirty = true; fStatus.textContent = ''; });

  fEd.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = fOrder ? fOrder.dealer_email : fDealer.value;
    if (!email) { fStatus.textContent = 'Choisis un dealer.'; fDealer.focus(); return; }
    if (!fItems.length) { fStatus.textContent = 'Ajoute au moins un spacer.'; fSearch.focus(); return; }
    fSave.disabled = true; fStatus.textContent = 'Enregistrement…';
    sb.rpc('admin_save_dealer_order', {
      p_id: fOrder ? fOrder.id : null,
      p_email: email,
      p_lines: fItems.map(function (it) { return { product_id: it.id, qty: it.qty }; }),
      p_note: fNote.value.trim() || null
    }).then(function (res) {
      if (res.error) throw res.error;
      var saved = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!saved || !saved.id) throw new Error('Refusé (permissions). Es-tu connecté en admin ?');
      fDirty = false;
      closeEditor();
      flashId = saved.id;
      load();
    }).then(null, function (err) {
      fSave.disabled = false;
      var m = err && err.message ? err.message : String(err);
      if (/admin_save_dealer_order|schema cache/i.test(m)) m = 'relance schema-v2.sql (commandes saisies par l\'admin).';
      fStatus.textContent = 'Erreur : ' + m;
    });
  });
})();
