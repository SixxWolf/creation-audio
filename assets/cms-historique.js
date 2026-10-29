/* =========================================================
   Création Audio V2 — Historique des factures (Phase 5)
   - Liste toutes les factures (invoices + invoice_lines).
   - Recherche (n° / client) + filtre Actives / Annulées / Toutes.
   - Détail des lignes, réimpression au format exact.
   - MODIFIER une facture active : elle est rechargée dans l'éditeur de
     Facturation (CA.editInvoice) ; l'enregistrement la remplace (même n°).
   - ANNULER une facture à tout moment : le stock déduit est REMIS
     (receive_stock positif), la facture passe en statut « annulée ».
   - Supprimer définitivement (remet aussi le stock si nécessaire).
   - Courriel de la facture : pastille (envoyé le… / non envoyé / pas de courriel) lue dans invoice_emails
     + bouton Envoyer / Renvoyer (CA.invoiceMail.resend, cms-facturation.js → EF invoice-notify).
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
  function fmtDateFR(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    try { return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return iso; }
  }
  // horodatage (timestamptz) -> date locale (fmtDateFR lirait la date UTC : faux après ~20 h)
  function fmtStampFR(ts) {
    var d = new Date(ts);
    if (isNaN(d)) return fmtDateFR(ts);
    try { return d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return fmtDateFR(ts); }
  }
  var CAT_LABEL = { filament: 'Filament', spacer: 'Spacer', accessory: 'Accessoire', mixte: 'Mixte' };

  var DEFAULT_CO = {
    name: 'Création Audio', tagline: 'Audio automobile & impression 3D — Québec',
    address: '', city: 'Québec, QC', email: 'contact@creationaudio.ca', phone: '', gst: '', qst: '', logo: ''
  };
  function loadCompany() {
    var co = {}; try { co = JSON.parse(localStorage.getItem(LS_CO)) || {}; } catch (e) {}
    var m = {}; for (var k in DEFAULT_CO) m[k] = (co[k] != null && co[k] !== '') ? co[k] : DEFAULT_CO[k];
    return m;
  }

  /* ---------- état ---------- */
  var loaded = false, invoices = [], linesByInv = {}, filter = 'active', catFilter = 'all', query = '';
  var emailsByInv = {}, mailOn = true, mailSince = null;   // journal des courriels de facture (invoice_emails, récents d'abord) + réglage « invoice_email »
  var loadSeq = 0;       // seul le DERNIER chargement lancé s'affiche (évite qu'un vieux résultat écrase un plus récent)
  var focusId = null;    // facture à rouvrir au prochain affichage (retour après une modification)

  var listEl = $('#hist-list'), searchEl = $('#hist-search'), refreshBtn = $('#hist-refresh'), printBox = $('#hist-print');

  // Grand écran (≥ 1600 px, CA.wideLayout) : la facture ouverte s'affiche dans le panneau collé à droite
  // (#hist-preview) au lieu de se déplier dans la liste ; une seule à la fois. Son bloc .hist-detail y est
  // déplacé tel quel (boutons et écouteurs gardés). En dessous : dépliée dans la liste, comme avant.
  var previewEl = $('#hist-preview'), panelEl = listEl && listEl.closest('.tabpanel');
  function isWide() { return !!(previewEl && panelEl && panelEl.classList.contains('is-wide')); }
  if (panelEl) panelEl.addEventListener('ca:wide', function () { if (loaded) render(); });
  if (window.CA.wideLayout && panelEl) window.CA.wideLayout(panelEl);

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'historique') { if (!loaded) { loaded = true; load(); } }
  };
  window.CA.reloadHistorique = function () { if (loaded) load(); };   // appelé après un enregistrement de facture
  window.CA.printInvoice = function (inv, lines) { reprint(inv, lines || []); };   // impression de la facture tout juste enregistrée
  // rouvre (et fait défiler jusqu'à) une facture — rechargée pour montrer la version à jour
  window.CA.focusInvoice = function (id) { focusId = id; loaded = true; load(); };

  if (refreshBtn) refreshBtn.addEventListener('click', load);
  if (searchEl) searchEl.addEventListener('input', function () { query = this.value.trim().toLowerCase(); render(); });
  $$('.hist-fbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      $$('.hist-fbtn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      render();
    });
  });
  $$('.hist-cbtn').forEach(function (b) {
    b.addEventListener('click', function () {
      catFilter = b.getAttribute('data-c');
      $$('.hist-cbtn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      render();
    });
  });

  /* ---------- chargement ---------- */
  // journal des envois + réglage ; jamais bloquant (table absente ou lecture refusée = pas de pastille courriel)
  function loadMail() {
    return Promise.all([
      sb.from('invoice_emails').select('invoice_id,to_email,kind,ok,error,sent_at').order('sent_at', { ascending: false }).limit(2000),
      sb.from('admin_settings').select('value').eq('key', 'invoice_email').maybeSingle()
    ]).then(function (r) {
      var by = {};
      ((r[0] && r[0].data) || []).forEach(function (e) { (by[e.invoice_id] = by[e.invoice_id] || []).push(e); });
      var v = (r[1] && r[1].data && r[1].data.value) || {};
      emailsByInv = by; mailOn = v.enabled !== false; mailSince = v.since || null;
    }, function () {});
  }
  function load() {
    var my = ++loadSeq;
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    var mailP = loadMail();
    var show = function () { mailP.then(function () { if (my === loadSeq) render(); }); };
    sb.from('invoices').select('*').order('created_at', { ascending: false }).then(function (res) {
      if (my !== loadSeq) return;
      if (res.error) { listEl.innerHTML = '<p class="empty">Impossible de charger.<br>As-tu relancé <strong>schema-v2.sql</strong> ?</p>'; return; }
      var invs = res.data || [];
      if (!invs.length) { invoices = invs; linesByInv = {}; show(); return; }
      var ids = invs.map(function (r) { return r.id; });
      sb.from('invoice_lines').select('*').in('invoice_id', ids).order('sort_order', { ascending: true }).then(function (r2) {
        if (my !== loadSeq) return;
        var byInv = {};
        (r2.data || []).forEach(function (l) { (byInv[l.invoice_id] = byInv[l.invoice_id] || []).push(l); });
        invoices = invs; linesByInv = byInv;
        show();
      }, function () { if (my !== loadSeq) return; invoices = invs; linesByInv = {}; show(); });
    }, function () { if (my === loadSeq) listEl.innerHTML = '<p class="empty">Erreur réseau.</p>'; });
  }

  function catOf(inv) { return inv.category || 'mixte'; }
  // articles facturés « À venir », pas encore remis au client (0 pour une facture annulée)
  function pendingOf(inv) {
    if (inv.status === 'cancelled') return 0;
    return (linesByInv[inv.id] || []).reduce(function (s, l) { return s + ((+l.qty_pending) || 0); }, 0);
  }
  // filtre statut + recherche (indépendant de la catégorie -> sert aussi aux compteurs)
  function passStatusQuery(inv) {
    var cancelled = inv.status === 'cancelled';
    if (filter === 'active' && cancelled) return false;
    if (filter === 'cancelled' && !cancelled) return false;
    if (filter === 'pending' && !pendingOf(inv)) return false;
    if (filter === 'internal' && inv.client_type !== 'internal') return false;   // ce que Théo a pris dans son stock
    if (query) {
      if (!window.CA.searchMatch([inv.number, inv.client_name, inv.client_contact].join(' '), query)) return false;
    }
    return true;
  }
  function visible() {
    return invoices.filter(function (inv) {
      if (!passStatusQuery(inv)) return false;
      if (catFilter !== 'all' && catOf(inv) !== catFilter) return false;
      return true;
    });
  }
  function updateCatCounts() {
    var counts = { all: 0, filament: 0, spacer: 0, accessory: 0, mixte: 0 };
    invoices.forEach(function (inv) {
      if (!passStatusQuery(inv)) return;
      counts.all++;
      var c = catOf(inv); if (counts[c] != null) counts[c]++;
    });
    $$('.hist-cnt').forEach(function (el) { el.textContent = counts[el.getAttribute('data-cnt')] || 0; });
    // nombre de factures avec des articles à remettre (bouton « À remettre »)
    var np = invoices.filter(function (inv) { return pendingOf(inv) > 0; }).length;
    var pc = $('#hist-pend-cnt'); if (pc) { pc.textContent = np; pc.hidden = !np; }
  }

  function render() {
    if (previewEl) previewEl.innerHTML = '';   // la liste est refaite : plus de facture ouverte
    updateCatCounts();
    var rows = visible();
    if (!rows.length) {
      listEl.innerHTML = '<p class="empty">' + (invoices.length ? 'Aucune facture pour ce filtre.' : 'Aucune facture enregistrée pour l\'instant.') + '</p>';
      return;
    }
    listEl.innerHTML = rows.map(function (inv) {
      var cancelled = inv.status === 'cancelled';
      var badge = '<span class="hist-cat">' + esc(CAT_LABEL[inv.category] || inv.category || '—') + '</span>';
      var internal = inv.client_type === 'internal';
      var dealer = inv.client_type === 'dealer' ? '<span class="hist-dealer">Dealer</span>'
        : internal ? '<span class="hist-dealer hist-int">Interne</span>' : '';
      var pend = pendingOf(inv);
      // usage interne : 0 $ -> on montre plutôt le nombre d'articles pris
      var nItems = (linesByInv[inv.id] || []).reduce(function (s, l) { return s + ((+l.qty) || 0); }, 0);
      var totalTx = internal ? nItems + ' article' + (nItems > 1 ? 's' : '') : money(inv.total);
      return '<div class="hist-row' + (cancelled ? ' is-cancelled' : '') + '" data-id="' + esc(inv.id) + '">' +
        '<div class="hist-head">' +
          '<span class="hist-id"><span class="hist-num">' + esc(inv.number || '—') + '</span>' + badge +
          (cancelled ? '<span class="hist-annul">Annulée</span>' : '') +
          (pend ? '<span class="hist-pend">' + pend + ' à remettre</span>' : '') + '</span>' +
          '<span class="hist-client">' + esc(inv.client_name || 'Sans client') + ' ' + dealer + '</span>' +
          '<span class="grow"></span>' +
          '<span class="hist-date">' + esc(fmtDateFR(inv.invoice_date)) + '</span>' +
          '<span class="hist-total">' + totalTx + '</span>' +
        '</div>' +
        '<div class="hist-detail"></div>' +
      '</div>';
    }).join('');

    $$('.hist-row', listEl).forEach(function (el) {
      var inv = rows.filter(function (x) { return String(x.id) === el.getAttribute('data-id'); })[0];
      $('.hist-head', el).addEventListener('click', function () { toggleDetail(el, inv); });
    });
    applyFocus(rows);
  }
  // rouvre la facture demandée (après une modification) et la ramène à l'écran
  function applyFocus(rows) {
    if (!focusId) return;
    var id = String(focusId); focusId = null;
    var inv = rows.filter(function (x) { return String(x.id) === id; })[0];
    var el = $$('.hist-row', listEl).filter(function (r) { return r.getAttribute('data-id') === id; })[0];
    if (!inv || !el) return;
    toggleDetail(el, inv);
    el.classList.add('flash');
    setTimeout(function () {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { el.classList.remove('flash'); }, 1400);
    }, 60);
  }

  function toggleDetail(el, inv) {
    var box = el.__box || (el.__box = $('.hist-detail', el));
    if (el.classList.contains('open')) {
      el.classList.remove('open'); box.innerHTML = '';
      if (box.parentNode !== el) { el.appendChild(box); if (previewEl) previewEl.innerHTML = ''; }   // revient du panneau de droite
      return;
    }
    // grand écran : une seule facture ouverte (celle du panneau de droite)
    if (isWide()) $$('.hist-row.open', listEl).forEach(function (r) { if (r !== el) toggleDetail(r); });
    el.classList.add('open');
    var lines = linesByInv[inv.id] || [];
    var cancelled = inv.status === 'cancelled';
    var pend = pendingOf(inv);
    var linesHtml = lines.map(function (l) {
      var lp = cancelled ? 0 : (+l.qty_pending || 0);
      var art = esc(l.label || '(ligne)') + (l.meta ? ' <span class="hd-meta">' + esc(l.meta) + '</span>' : '');
      // ligne « à venir » : pastille + bouton « Remis » dans la cellule (pas de colonne en plus : tient sur téléphone)
      if (lp) art = '<div class="hd-art"><span>' + art + ' <span class="hd-pend">' + (lp < +l.qty ? lp + ' à venir' : 'À venir') + '</span></span>' +
        '<button class="btn btn-ghost btn-sm hd-give" type="button" data-line="' + esc(l.id) + '">Remis</button></div>';
      return '<tr' + (lp ? ' class="is-pending"' : '') + '><td>' + art + '</td>' +
        '<td class="num">' + (+l.qty) + '</td><td class="num">' + money(l.unit_price) + '</td><td class="num">' + money(l.line_total) + '</td>' +
      '</tr>';
    }).join('');
    var stockNote = inv.stock_deducted ? '<span class="hd-stock">stock déduit</span>' : (cancelled ? '<span class="hd-stock ok">stock remis</span>' : '');
    if (inv.updated_at) stockNote += '<span class="hd-stock">modifiée le ' + esc(fmtStampFR(inv.updated_at)) + '</span>';
    var mailable = !cancelled && inv.client_type !== 'internal';
    if (mailable) stockNote += mailChip(inv);
    box.innerHTML =
      '<table class="hist-lines"><thead><tr><th>Article</th><th class="num">Qté</th><th class="num">Prix</th><th class="num">Montant</th></tr></thead>' +
        '<tbody>' + (linesHtml || '<tr><td colspan="4" class="muted">(aucune ligne)</td></tr>') + '</tbody></table>' +
      (inv.note ? '<div class="hd-note">' + esc(inv.note) + '</div>' : '') +
      '<div class="hist-actions">' +
        '<span class="hd-sum">Sous-total ' + money(inv.subtotal) + (inv.tax_enabled ? ' · taxes ' + money((+inv.tax_gst) + (+inv.tax_qst)) : '') + ' · <b>Total ' + money(inv.total) + '</b></span>' +
        stockNote +
        '<span class="grow"></span>' +
        (pend ? '<button class="btn btn-accent btn-sm hd-give-all" type="button" data-ic="check">Tout remis</button>' : '') +
        (cancelled ? '' : '<button class="btn btn-ghost btn-sm hd-edit" type="button">Modifier</button>') +
        (mailable ? '<button class="btn btn-ghost btn-sm hd-mail" type="button" data-ic="mail">' + ((emailsByInv[inv.id] || []).length ? 'Renvoyer' : 'Envoyer') + '</button>' : '') +
        '<button class="btn btn-ghost btn-sm hd-print" type="button">Réimprimer</button>' +
        (cancelled ? '' : '<button class="btn btn-ghost btn-sm hd-cancel" type="button">Annuler</button>') +
        '<button class="btn btn-ghost btn-sm hd-del" type="button">Suppr.</button>' +
      '</div>';
    var eb = $('.hd-edit', box); if (eb) eb.addEventListener('click', function (e) { e.stopPropagation(); editInvoice(inv, lines); });
    var mb = $('.hd-mail', box); if (mb) mb.addEventListener('click', function (e) { e.stopPropagation(); mailInvoice(inv, mb); });
    $('.hd-print', box).addEventListener('click', function (e) { e.stopPropagation(); reprint(inv, lines); });
    var cb = $('.hd-cancel', box); if (cb) cb.addEventListener('click', function (e) { e.stopPropagation(); cancelInvoice(inv, lines); });
    $('.hd-del', box).addEventListener('click', function (e) { e.stopPropagation(); delInvoice(inv, lines); });
    $$('.hd-give', box).forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); deliver(inv, b.getAttribute('data-line'), b); });
    });
    var ga = $('.hd-give-all', box); if (ga) ga.addEventListener('click', function (e) { e.stopPropagation(); deliver(inv, null, ga); });
    // grand écran : la facture s'affiche dans le panneau de droite, sous un rappel de son en-tête (n°, client, date, total)
    if (isWide()) {
      var head = $('.hist-head', el).cloneNode(true);
      head.className = 'hist-head hist-pv-head';
      previewEl.innerHTML = ''; previewEl.appendChild(head); previewEl.appendChild(box); previewEl.scrollTop = 0;
    }
  }

  /* ---------- courriel de la facture (EF invoice-notify, via CA.invoiceMail de cms-facturation.js) ---------- */
  var EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
  // dernière tentative en pastille ; « pas de courriel » seulement pour une facture créée depuis la mise en service
  function mailChip(inv) {
    var last = (emailsByInv[inv.id] || [])[0];
    if (last) return last.ok
      ? '<span class="hd-stock ok">courriel envoyé le ' + esc(fmtStampFR(last.sent_at)) + ' à ' + esc(last.to_email) + '</span>'
      : '<span class="hd-stock bad" title="' + esc(last.error || '') + '">courriel non envoyé</span>';
    if (mailOn && mailSince && String(inv.created_at || '') >= mailSince && !EMAIL_RE.test(inv.client_contact || '')) return '<span class="hd-stock">pas de courriel</span>';
    return '';
  }
  function mailInvoice(inv, btn) {
    if (!window.CA.invoiceMail) { caDialog.error('Le module Facturation n\'est pas chargé. Recharge la page.'); return; }
    btn.disabled = true;
    focusId = inv.id;   // la facture reste ouverte après le rechargement
    window.CA.invoiceMail.resend(inv).then(function (r) { if (!r) focusId = null; btn.disabled = false; });
  }

  /* ---------- remettre les articles « à venir » (stock déduit à ce moment-là si la facture déduit) ---------- */
  function deliver(inv, lineId, btn) {
    if (btn) btn.disabled = true;
    sb.rpc('deliver_invoice', { p_invoice: inv.id, p_line: lineId || null, p_qty: null }).then(function (res) {
      if (res.error) throw res.error;
      focusId = inv.id;   // la facture reste ouverte après le rechargement
      load();
      if (window.CA.reserved) window.CA.reserved.reload();
      if (window.CA.refreshFacturationStock && inv.stock_deducted) window.CA.refreshFacturationStock();
    }).then(null, function (err) {
      if (btn) btn.disabled = false;
      var msg = (err && err.message) ? err.message : String(err);
      if (/PGRST202|could not find the function/i.test(((err && err.code) || '') + ' ' + msg)) msg = 'Fonction deliver_invoice absente : relance schema-v2.sql dans Supabase.';
      caDialog.error(msg);
    });
  }

  /* ---------- modifier : la facture est rechargée dans l'éditeur de Facturation ---------- */
  function editInvoice(inv, lines) {
    if (!window.CA.editInvoice) { caDialog.error('Le module Facturation n\'est pas chargé. Recharge la page.'); return; }
    if (!window.CA.editInvoice(inv, lines)) return;   // l'admin a gardé sa facture en cours
    location.hash = '#facturation';
    window.scrollTo(0, 0);
  }

  /* ---------- remise en stock (inverse de la déduction) ---------- */
  // ne remet que ce qui a RÉELLEMENT été retiré (qty_deducted) : un article vendu à stock 0
  // n'a rien retiré -> rien à remettre. qty_deducted NULL = ancienne facture -> on remet qty.
  function restoreStock(lines) {
    var calls = (lines || []).map(function (l) {
      var back = (l.qty_deducted != null) ? +l.qty_deducted : Math.abs(+l.qty);
      if (!l.product_id || !(back > 0)) return null;
      return sb.rpc('receive_stock', { p_product: l.product_id, p_kind: l.kind === 'refill' ? 'refill' : 'spool', p_qty: back })
        .then(function (res) { if (res && res.error) throw res.error; });
    }).filter(Boolean);
    return Promise.all(calls);
  }

  // facture annulée / supprimée : sa commande (dealer, client) ou réservation d'origine redevient
  // « à facturer » (RPC admin_reopen_invoice_orders) -> « Commande D-0007 → Prête »
  function reopenOrders(inv) {
    return sb.rpc('admin_reopen_invoice_orders', { p_invoice: inv.id }).then(function (res) {
      if (res.error) throw res.error;
      var list = Array.isArray(res.data) ? res.data : [];
      if (!list.length) return '';
      if (window.CA.reloadOrders) window.CA.reloadOrders();
      if (window.CA.reloadCustomerOrders) window.CA.reloadCustomerOrders();
      if (window.CA.reloadReservations) window.CA.reloadReservations();
      if (window.CA.reserved) window.CA.reserved.reload();
      var ST = { ready: 'Prête', active: 'Active', expired: 'Expirée' };
      return list.map(function (o) {
        return (o.kind === 'reservation' ? 'Réservation ' : 'Commande ') + o.number + ' → ' + (ST[o.status] || o.status);
      }).join(' · ');
    });
  }
  function toastDone(what, reopened) {
    if (window.caDialog && caDialog.toast) caDialog.toast(what + (reopened ? ' · ' + reopened : ''));
  }

  function cancelInvoice(inv, lines) {
    if (inv.status === 'cancelled') return;
    caDialog.confirm({ title: 'Annuler la facture ' + (inv.number || '') + ' ?',
      message: (inv.stock_deducted ? 'Le stock déduit sera remis.\n' : '') + 'Elle restera dans l\'historique (« Annulée ») et sortira des statistiques.',
      ok: 'Annuler la facture', danger: true }).then(function (ok) {
      if (!ok) return;
      var chain = inv.stock_deducted ? restoreStock(lines) : Promise.resolve();
      chain.then(function () {
        return sb.from('invoices').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), stock_deducted: false })
          .eq('id', inv.id).select();
      }).then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Annulation refusée (permissions).');
        load();
        return reopenOrders(inv).then(function (msg) { toastDone('Facture ' + (inv.number || '') + ' annulée', msg); }, function (err) {
          caDialog.error(err, 'Facture annulée, mais sa commande d\'origine n\'a pas été remise « à facturer »');
        });
      }, function (err) { caDialog.error(err); });
    });
  }

  function delInvoice(inv, lines) {
    caDialog.confirm({ title: 'Supprimer la facture ' + (inv.number || '') + ' ?',
      message: (inv.stock_deducted ? 'Le stock déduit sera remis avant suppression.\n' : '') + 'Cette action est irréversible.',
      ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
      if (!ok) return;
      var reopened = '';
      // la commande d'origine EN PREMIER : après la suppression, son lien vers la facture est perdu ;
      // si ça échoue, rien n'a encore bougé (ni stock, ni facture)
      reopenOrders(inv)
        .then(function (msg) { reopened = msg; return inv.stock_deducted ? restoreStock(lines) : null; })
        .then(function () { return sb.from('invoices').delete().eq('id', inv.id).select(); })
        .then(function (res) {
          if (res.error) throw res.error;
          if (!res.data || !res.data.length) throw new Error('Suppression refusée (permissions).');
          load();
          toastDone('Facture ' + (inv.number || '') + ' supprimée', reopened);
        }, function (err) { caDialog.error(err); });
    });
  }

  /* ---------- réimpression (format facture) ---------- */
  function publicUrl(path) { if (!path) return ''; try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; } }
  function buildDoc(inv, lines) {
    var co = loadCompany();
    var meta = [];
    if (co.address) meta.push(co.address);
    if (co.city) meta.push(co.city);
    if (co.email) meta.push(co.email);
    if (co.phone) meta.push(co.phone);

    var dealer = inv.client_type === 'dealer' ? ' <span class="inv-cli-tag">Dealer</span>' : '';
    var internal = inv.client_type === 'internal';   // usage interne : pas de « Facturé à », titre propre
    var billto = !internal && (inv.client_name || inv.client_contact || inv.client_address || inv.client_city)
      ? '<div class="inv-billto"><div class="lbl">Facturé à</div>' +
        (inv.client_name ? '<div class="who">' + esc(inv.client_name) + dealer + '</div>' : '') +
        (inv.client_address ? '<div>' + esc(inv.client_address) + '</div>' : '') +
        (inv.client_city ? '<div>' + esc(inv.client_city) + '</div>' : '') +
        (inv.client_contact ? '<div>' + esc(inv.client_contact) + '</div>' : '') + '</div>'
      : '';

    var rows = (lines || []).map(function (l) {
      return '<tr><td>' + esc(l.label || '') + (l.meta ? ' <span class="inv-mat">' + esc(l.meta) + '</span>' : '') + '</td>' +
        '<td class="num">' + (+l.qty) + '</td><td class="num">' + money(l.unit_price) + '</td><td class="num">' + money(l.line_total) + '</td></tr>';
    }).join('');

    var taxLines = inv.tax_enabled
      ? '<div class="line"><span>TPS' + (co.gst ? ' <span class="taxno">' + esc(co.gst) + '</span>' : '') + '</span><span>' + money(inv.tax_gst) + '</span></div>' +
        '<div class="line"><span>TVQ' + (co.qst ? ' <span class="taxno">' + esc(co.qst) + '</span>' : '') + '</span><span>' + money(inv.tax_qst) + '</span></div>'
      : '';

    var cancelled = inv.status === 'cancelled'
      ? '<div class="inv-cancelled">FACTURE ANNULÉE</div>' : '';

    return '<div class="inv-top">' +
        '<div class="inv-co">' + (co.logo ? '<img class="inv-logo" src="' + co.logo + '" alt="">' : '') +
          '<div class="inv-co-name">' + esc(co.name) + '</div>' +
          (co.tagline ? '<div class="inv-co-tag">' + esc(co.tagline) + '</div>' : '') +
          (meta.length ? '<div class="inv-co-meta">' + esc(meta.join('\n')) + '</div>' : '') + '</div>' +
        '<div class="inv-title"><h1>' + (internal ? 'USAGE INTERNE' : 'FACTURE') + '</h1><div class="inv-meta">N° ' + esc(inv.number || '—') + '<br>' + esc(fmtDateFR(inv.invoice_date)) + '</div></div>' +
      '</div>' + cancelled + billto +
      '<table class="inv-table"><thead><tr><th>Description</th><th class="num">Qté</th><th class="num">Prix unit.</th><th class="num">Montant</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' +
      '<div class="inv-tot">' +
        '<div class="line"><span>Sous-total</span><span>' + money(inv.subtotal) + '</span></div>' + taxLines +
        '<div class="line grand"><span>Total</span><span>' + money(inv.total) + '</span></div>' +
      '</div>' +
      (inv.note ? '<div class="inv-pay"><span class="lbl">Note</span>' + esc(inv.note) + '</div>' : '') +
      (internal ? '' : '<div class="inv-foot">Aucun paiement en ligne — ramassage à Québec. Merci de votre confiance&nbsp;!</div>');
  }
  var TITLE = document.title;
  function reprint(inv, lines) {
    if (!printBox) return;
    printBox.innerHTML = buildDoc(inv, lines);
    // le titre = nom proposé par « Enregistrer en PDF »
    document.title = String(inv.number || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || TITLE;
    document.body.classList.add('printing-hist');
    window.print();
    setTimeout(function () { document.body.classList.remove('printing-hist'); printBox.innerHTML = ''; document.title = TITLE; }, 400);
  }
})();
