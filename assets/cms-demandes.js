/* =========================================================
   Création Audio — CMS Commandes › Demandes (#commandes/demandes[/<id>])
   Demandes de service (Impression 3D, Entretien) : liste + fiche côte à côte, fiche plein écran sur mobile.
   Tables service_requests / service_request_events / service_request_messages (schema-v2.sql).
   - Statut : RPC admin_sr_set_status. Soumission : admin_sr_quote (+ courriel). Facture : CA.invoiceFromOrder({kind:'service'})
     puis admin_sr_invoice à l'enregistrement (cms-facturation.js, linkOrder).
   - Discussion : demande-fil.js. Pastille = reçues + non lues (CA.ordersCount.req).
   - Purge 12 mois après la fermeture (closed_at) lancée au chargement : fichiers et photos retirés, la fiche reste.
   Sous-onglet affiché par cms-commandes-clients.js (showSub) -> CA.loadDemandes().
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA, sb = CA && CA.sb;
  if (!sb) return;
  var wrap = document.getElementById('dm-wrap');
  if (!wrap) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var STATUS = { received: 'Reçue', evaluating: 'En évaluation', quoted: 'Soumission envoyée', accepted: 'Acceptée', in_progress: 'En cours',
    done: 'Terminée', invoiced: 'Facturée', refused: 'Refusée', cancelled: 'Annulée' };
  var TONE = { received: 'new', evaluating: 'work', quoted: 'new', accepted: 'work', in_progress: 'work', done: 'ok', invoiced: 'ok', refused: 'off', cancelled: 'off' };
  var SETTABLE = ['received', 'evaluating', 'accepted', 'in_progress', 'done', 'refused', 'cancelled'];
  var SERVICE = { file: 'Mon fichier', batch: 'Une série', design: 'À dessiner', proto: 'Prototype' };
  var MATERIAL = { pla: 'PLA', petg: 'PETG', abs: 'ABS', tpu: 'TPU', any: 'À conseiller' };
  var MACHINE = { a1: 'Bambu Lab A1', xp: 'Bambu Lab série X / P', snap: 'Snapmaker U1' };
  var YEAR = 365 * 864e5, LATE = 10 * 6e4;

  var rows = [], filter = 'all', curId = '', curTab = 'details', fil = null, loading = null;
  var listEl = $('#dm-list'), sheetEl = $('#dm-sheet'), shell = $('#dm-shell');

  function money(n) { return (+n || 0).toFixed(2).replace('.', ',') + ' $'; }
  function day(d) {
    if (!d) return '';
    var x = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
    return x.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function stamp(d) { var x = new Date(d); return day(d) + ' · ' + x.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' }); }
  function kindOf(r) { return r.kind === 'maintenance' ? 'Entretien' : 'Impression 3D'; }
  function pill(st) { return '<span class="dm-pill is-' + (TONE[st] || 'work') + '">' + esc(STATUS[st] || st) + '</span>'; }
  function line(k, v) { return v == null || v === '' ? '' : '<div class="dm-l"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }
  function byId(id) { return rows.filter(function (r) { return r.id === id; })[0]; }
  function lateMail(r) { return r.status === 'quoted' && r.quoted_at && !r.quote_ack_at && Date.now() - new Date(r.quoted_at).getTime() > LATE; }

  /* ---- pastille ---- */
  function setBadge(n) {
    CA.ordersCount = CA.ordersCount || {};
    CA.ordersCount.req = n;
    if (CA.paintOrdersBadge) CA.paintOrdersBadge();
  }
  function refreshBadge() {
    sb.from('service_requests').select('id', { count: 'exact', head: true }).or('status.eq.received,admin_unread.gt.0').then(function (res) {
      if (res && !res.error && typeof res.count === 'number') setBadge(res.count);
    }, function () {});
  }
  function paintBadge() { setBadge(rows.filter(function (r) { return r.status === 'received' || r.admin_unread > 0; }).length); }

  /* ---- chargement ---- */
  function load() {
    if (loading) return loading;
    loading = sb.from('service_requests').select('*').order('created_at', { ascending: false }).limit(500).then(function (res) {
      loading = null;
      if (res.error) throw res.error;
      rows = res.data || [];
      var m = /^#commandes\/demandes\/([0-9a-f-]{36})/.exec(location.hash);
      if (m && byId(m[1])) { if (curId !== m[1]) curTab = 'details'; curId = m[1]; }
      paintBadge();
      paintList();
      paintSheet(true);
      purge();
    }, function (err) {
      loading = null;
      listEl.innerHTML = '<p class="co-empty">' + esc((err && err.message) || 'Chargement impossible.') + '</p>';
    });
    return loading;
  }
  CA.loadDemandes = load;
  CA.reloadDemandes = function () { if (rows.length || !wrap.hidden) load(); else refreshBadge(); };
  if (CA.onAdminReady) CA.onAdminReady(refreshBadge);

  /* ---- purge 12 mois : fichiers + photos, la fiche reste ---- */
  function purge() {
    var old = rows.filter(function (r) { return r.closed_at && !r.files_purged_at && Date.now() - new Date(r.closed_at).getTime() > YEAR; }).slice(0, 20);
    old.reduce(function (p, r) { return p.then(function () { return purgeOne(r); }); }, Promise.resolve()).then(null, function () {});
  }
  function purgeOne(r) {
    return sb.from('service_request_messages').select('id,photos,files').eq('request_id', r.id).then(function (res) {
      if (res.error) throw res.error;
      var msgs = res.data || [], ph = [], fl = (r.files || []).map(function (f) { return f.p; });
      msgs.forEach(function (m) {
        ph = ph.concat(m.photos || []);
        (m.files || []).forEach(function (f) { fl.push(f.p); });
      });
      return Promise.all([
        ph.length ? sb.storage.from('messages').remove(ph) : null,
        fl.length ? sb.storage.from('print-files').remove(fl) : null
      ]).then(function (out) {
        if (out.some(function (x) { return x && x.error; })) throw new Error('storage');
        var withFiles = msgs.filter(function (m) { return (m.photos || []).length || (m.files || []).length; }).map(function (m) { return m.id; });
        return withFiles.length ? sb.from('service_request_messages').update({ photos: [], files: [] }).in('id', withFiles) : null;
      }).then(function () {
        return sb.from('service_requests').update({ files: [], files_purged_at: new Date().toISOString() }).eq('id', r.id);
      }).then(function (u) {
        if (u && !u.error) { r.files = []; r.files_purged_at = new Date().toISOString(); }
      });
    });
  }

  /* ---- liste ---- */
  function paintList() {
    var show = rows.filter(function (r) { return filter === 'all' || r.kind === filter; });
    listEl.innerHTML = show.length ? show.map(function (r) {
      return '<button type="button" class="dm-row' + (r.id === curId ? ' is-on' : '') + '" data-open="' + esc(r.id) + '">' +
        '<span class="dm-row-top"><b>' + esc(r.number) + '</b>' + (r.admin_unread ? '<b class="nav-count">' + esc(r.admin_unread) + '</b>' : '') + pill(r.status) + '</span>' +
        '<span class="dm-row-who">' + esc(r.name || r.email || 'Compte supprimé') + '</span>' +
        '<span class="dm-row-meta">' + esc(kindOf(r)) + ' · ' + esc(day(r.created_at)) + '</span>' +
      '</button>';
    }).join('') : '<p class="co-empty">Aucune demande.</p>';
  }

  /* ---- fiche ---- */
  function detailsHtml(r) {
    var d = r.details || {}, h = '';
    if (r.kind === 'maintenance') {
      var m = d.machines || {};
      h += line('Machines', Object.keys(m).filter(function (k) { return +m[k] > 0; }).map(function (k) { return m[k] + ' × ' + (MACHINE[k] || k); }).join(', ')) +
        line('Ville ou secteur', d.city) + line('Précision', d.other);
    } else {
      h += line('Service', SERVICE[d.service] || d.service) + line('Matériau', MATERIAL[d.material] || d.material) +
        line('Couleur', d.color && [d.color.material, d.color.name].filter(Boolean).join(' · ')) +
        line('Quantité', d.qty) + line('Description', d.desc) + line('Détails du fichier', d.notes);
    }
    var files = '';
    if (r.files_purged_at) files = '<p class="dm-note">Fichiers retirés le ' + esc(day(r.files_purged_at)) + '.</p>';
    else if ((r.files || []).length) files = '<div class="dm-files" id="dm-files"><p class="dm-note">Chargement des fichiers…</p></div>';
    return '<dl class="dm-dl">' + line('Courriel', r.email) + line('Téléphone', r.phone) + line('Langue', r.lang === 'en' ? 'Anglais' : 'Français') + h +
      (r.invoice_id ? '<div class="dm-l"><dt>Facture</dt><dd id="dm-inv">…</dd></div>' : '') + '</dl>' + files;
  }
  function quoteHtml(r) {
    var monthly = r.kind === 'maintenance', locked = r.status === 'invoiced';
    var head = r.quote_price != null ? '<div class="dm-q-sum"><b>' + esc(money(r.quote_price)) + (monthly ? ' par mois' : '') + '</b><span>' +
      esc((monthly ? 'Première visite le ' : 'Prête le ') + day(r.quote_date)) + '</span>' +
      (r.quoted_at ? '<span>Envoyée le ' + esc(stamp(r.quoted_at)) + '</span>' : '') +
      (r.quote_note ? '<span>' + esc(r.quote_note) + '</span>' : '') + '</div>' : '';
    if (lateMail(r)) head += '<p class="dm-warn">Courriel de soumission pas encore parti.</p>';
    if (locked) return head;
    return head + '<form class="dm-q" id="dm-q" novalidate>' +
      '<div class="dm-q-row"><label>' + (monthly ? 'Prix par mois' : 'Prix') + '<input type="number" id="dm-q-p" min="0.01" step="0.01" inputmode="decimal" value="' + esc(r.quote_price == null ? '' : r.quote_price) + '"></label>' +
      '<label>' + (monthly ? 'Première visite' : 'Prête le') + '<input type="date" id="dm-q-d" value="' + esc(r.quote_date || '') + '"></label></div>' +
      '<label>Note<textarea id="dm-q-n" rows="3" maxlength="1000">' + esc(r.quote_note || '') + '</textarea></label>' +
      '<div class="dm-q-foot"><button type="submit" class="btn btn-accent" data-ic="send">' + (r.quote_price != null ? 'Renvoyer la soumission' : 'Envoyer la soumission') + '</button><span class="dm-q-st" role="status"></span></div></form>';
  }
  function statusSelect(r) {
    var keep = SETTABLE.indexOf(r.status) === -1 ? '<option value="' + esc(r.status) + '" selected>' + esc(STATUS[r.status] || r.status) + '</option>' : '';
    return '<select id="dm-st" aria-label="Changer le statut">' + keep + SETTABLE.map(function (s) {
      return '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + esc(STATUS[s]) + '</option>';
    }).join('') + '</select>';
  }
  function paintSheet(keep) {
    if (fil) { fil.destroy(); fil = null; }
    var r = byId(curId);
    shell.classList.toggle('is-open', !!r);
    if (!r) { sheetEl.innerHTML = '<p class="dm-pick">Choisis une demande.</p>'; return; }
    var canBill = ['accepted', 'in_progress', 'done'].indexOf(r.status) !== -1 && !r.invoice_id;
    var locked = r.status === 'invoiced' && r.invoice_id;
    sheetEl.innerHTML =
      '<button type="button" class="dm-back btn btn-ghost btn-sm" id="dm-back">Retour</button>' +
      '<header class="dm-head"><div class="dm-head-t"><h2>' + esc(r.number) + ' · ' + esc(kindOf(r)) + '</h2><p>' + esc(r.name || r.email || 'Compte supprimé') + ' · ' + esc(stamp(r.created_at)) + '</p></div>' + pill(r.status) + '</header>' +
      '<div class="dm-acts">' + (locked ? '' : '<div class="dm-st-w">' + statusSelect(r) + '</div>') +
        (canBill ? '<button type="button" class="btn btn-accent btn-sm" id="dm-bill" data-ic="plus">Facturer</button>' : '') + '</div>' +
      '<div class="inv-subtabs" role="tablist" aria-label="Fiche">' + [['details', 'Détails'], ['quote', 'Soumission'], ['history', 'Historique'], ['chat', 'Discussion']].map(function (t) {
        var on = t[0] === curTab;
        return '<button type="button" class="inv-subtab' + (on ? ' is-active' : '') + '" role="tab" aria-selected="' + on + '" data-dmt="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="dm-pane" id="dm-pane"></div>';
    var sel = $('#dm-st');
    if (sel) {
      if (CA.pick) CA.pick(sel);
      sel.addEventListener('change', function () { setStatus(r, sel.value); });
    }
    paintPane(r);
    if (!keep && window.matchMedia('(max-width:900px)').matches) sheetEl.scrollTop = 0;
  }
  function paintPane(r) {
    var pane = $('#dm-pane');
    if (fil) { fil.destroy(); fil = null; }
    if (curTab === 'details') {
      pane.innerHTML = detailsHtml(r);
      paintFiles(r); paintInvoice(r);
    } else if (curTab === 'quote') {
      pane.innerHTML = quoteHtml(r);
      var f = $('#dm-q');
      if (f) f.addEventListener('submit', function (e) { e.preventDefault(); sendQuote(r, f); });
    } else if (curTab === 'history') {
      pane.innerHTML = '<ol class="dm-ev" id="dm-ev"><li>Chargement…</li></ol>';
      sb.from('service_request_events').select('status,actor,created_at').eq('request_id', r.id).order('created_at').then(function (res) {
        var el = $('#dm-ev');
        if (!el) return;
        el.innerHTML = res.error ? '<li>Chargement impossible.</li>' : (res.data || []).map(function (e) {
          return '<li><b>' + esc(STATUS[e.status] || e.status) + '</b><time>' + esc(stamp(e.created_at)) + '</time></li>';
        }).join('');
      }, function () {});
    } else {
      pane.innerHTML = '<div id="dm-fil"></div>';
      fil = CA.demandeFil.mount($('#dm-fil'), {
        id: r.id, admin: true, sb: sb, owner: r.customer_id, readOnly: !r.customer_id, btn: 'btn btn-accent btn-sm', root: '',
        onRead: function () { if (r.admin_unread) { r.admin_unread = 0; paintBadge(); paintList(); } }
      });
    }
  }
  function paintFiles(r) {
    var el = $('#dm-files');
    if (!el) return;
    var paths = r.files.map(function (f) { return f.p; });
    sb.storage.from('print-files').createSignedUrls(paths, 3600).then(function (res) {
      var map = {};
      (res.data || []).forEach(function (u) { if (u.signedUrl) map[u.path] = u.signedUrl; });
      if ($('#dm-files') === el) el.innerHTML = r.files.map(function (f) { return CA.demandeFil.fileRow(f, map); }).join('');
    }, function () { el.innerHTML = '<p class="dm-warn">Fichiers indisponibles.</p>'; });
  }
  function paintInvoice(r) {
    if (!r.invoice_id) return;
    sb.from('invoices').select('number').eq('id', r.invoice_id).maybeSingle().then(function (res) {
      var el = $('#dm-inv');
      if (el) el.textContent = (res.data && res.data.number) || '—';
    }, function () {});
  }

  /* ---- actions ---- */
  function setStatus(r, s) {
    if (s === r.status) return;
    var ask = s === 'refused' || s === 'cancelled'
      ? window.caDialog.confirm({ title: (s === 'refused' ? 'Marquer ' : 'Annuler ') + r.number + (s === 'refused' ? ' comme refusée ?' : ' ?'), ok: STATUS[s], danger: true })
      : Promise.resolve(true);
    ask.then(function (ok) {
      if (!ok) { paintSheet(true); return; }
      sb.rpc('admin_sr_set_status', { p_id: r.id, p_status: s }).then(function (res) {
        if (res.error) { window.caDialog.error(res.error); paintSheet(true); return; }
        window.caDialog.toast(r.number + ' → ' + STATUS[s]);
        load();
      }, function (e) { window.caDialog.error(e); paintSheet(true); });
    });
  }
  function sendQuote(r, form) {
    var price = parseFloat($('#dm-q-p', form).value), date = $('#dm-q-d', form).value, st = $('.dm-q-st', form), btn = $('button[type=submit]', form);
    if (!(price > 0)) { st.textContent = 'Entre un prix.'; $('#dm-q-p', form).focus(); return; }
    if (!date) { st.textContent = 'Entre une date.'; $('#dm-q-d', form).focus(); return; }
    btn.disabled = true; st.textContent = 'Envoi…';
    sb.rpc('admin_sr_quote', { p_id: r.id, p_price: price, p_date: date, p_note: $('#dm-q-n', form).value }).then(function (res) {
      if (res.error) { btn.disabled = false; st.textContent = res.error.message || 'Envoi impossible.'; return; }
      window.caDialog.toast('Soumission envoyée');
      load();
    }, function () { btn.disabled = false; st.textContent = 'Erreur réseau — réessaie.'; });
  }
  function bill(r) {
    if (!CA.invoiceFromOrder) { window.caDialog.error('Facturation indisponible.'); return; }
    var d = r.details || {}, what = r.kind === 'maintenance' ? 'Entretien d\'imprimantes' : 'Impression 3D' + (d.desc ? ' — ' + String(d.desc).slice(0, 80) : '');
    var ord = { id: r.id, number: r.number, kind: 'service', name: r.name, email: r.email, phone: r.phone, label: what, price: +r.quote_price || 0 };
    if (CA.invoiceFromOrder(ord, []) !== false) location.hash = '#facturation';
  }

  /* ---- événements ---- */
  $$('.dm-f', wrap).forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      $$('.dm-f', wrap).forEach(function (x) { var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on); });
      paintList();
    });
  });
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-open]');
    if (!b) return;
    curId = b.getAttribute('data-open'); curTab = 'details';
    history.replaceState(null, '', '#commandes/demandes/' + curId);
    paintList(); paintSheet();
  });
  sheetEl.addEventListener('click', function (e) {
    var t = e.target.closest('[data-dmt]'), r = byId(curId), v = e.target.closest('#dm-files [data-v3d]');
    if (t && r) {
      curTab = t.getAttribute('data-dmt');
      $$('[data-dmt]', sheetEl).forEach(function (x) { var on = x === t; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', on); });
      paintPane(r);
      return;
    }
    if (e.target.closest('#dm-back')) {
      curId = '';
      history.replaceState(null, '', '#commandes/demandes');
      paintList(); paintSheet();
      return;
    }
    if (e.target.closest('#dm-bill') && r) { bill(r); return; }
    if (v && !v.disabled) {
      v.disabled = true;
      CA.demandeFil.view3d(sb, v.getAttribute('data-v3d'), v.getAttribute('data-n') || '', '').catch(function () {
        window.caDialog.toast('Aperçu indisponible pour ce fichier.', 'bad');
      }).then(function () { v.disabled = false; });
    }
  });
})();
