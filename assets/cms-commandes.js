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
  var orders = [], stock = {}, filter = 'open', loaded = false, loading = false, visible = false;

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
  if (refreshBtn) refreshBtn.addEventListener('click', load);

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
  function load() {
    if (loading) return;
    loading = true;
    if (!loaded) listEl.innerHTML = '<p class="muted">Chargement…</p>';
    Promise.all([
      sb.from('dealer_orders').select('*, dealer_order_lines(*)').order('created_at', { ascending: false }).limit(200),
      sb.from('products').select('id,name,qty,image_path').eq('type', 'spacer')
    ]).then(function (r) {
      loading = false;
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
    }, function () { loading = false; listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
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
        '<div class="co-print-title"><b>À imprimer</b> · ' + plural(total, 'paire', 'paires') +
          ' <span class="hint">commandes « Nouvelle » + « En préparation », moins le stock</span></div>' +
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
        (act === 'invoice' ? ' data-ic="receipt"' : '') + '>' + label + '</button>';
    };
    switch (o.status) {
      case 'new': return b('preparing', 'Commencer la préparation', 'btn-accent') + b('invoice', 'Facturer') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'preparing': return b('ready', 'Marquer prête', 'btn-accent') + b('invoice', 'Facturer') + b('new', '↩ Remettre « Nouvelle »') + b('cancel', 'Annuler', 'btn-ghost co-danger');
      case 'ready': return b('invoice', 'Facturer', 'btn-accent') + b('preparing', '↩ En préparation') + b('cancel', 'Annuler', 'btn-ghost co-danger');
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
    });
  }

  /* ---- actions ---- */
  function act(o, what, btn) {
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
})();
