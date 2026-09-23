/* =========================================================
   Création Audio V2 — Liste d'attente (« M'aviser quand disponible »)
   - Sous-onglet Inventaire > Liste d'attente : demandes ouvertes
     groupées par produit, ajout manuel (Marketplace…), stats anonymes.
   - Alerte BIEN VISIBLE au poste de scan quand un article scanné /
     reçu est attendu par quelqu'un (CA.waitlist.onScan / onReceived).
   - « Aviser » : source site -> courriel automatique (Edge Function
     waitlist-notify, Resend) ; Marketplace / autre -> message prêt à
     copier, puis « Marquer avisé ».
   Loi 25 : à l'avis, nom + contact sont effacés (trace anonyme gardée).
   Table : public.waitlist (voir supabase/schema-v2.sql).
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
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
  function swatchBg(p) {
    var cs = p && p.attrs && Array.isArray(p.attrs.colors) ? p.attrs.colors.filter(isHex) : [];
    if (cs.length >= 2) {
      var n = cs.length, parts = [];
      for (var i = 0; i < n; i++) { parts.push(cs[i] + ' ' + (100 * i / n) + '%', cs[i] + ' ' + (100 * (i + 1) / n) + '%'); }
      return 'linear-gradient(90deg,' + parts.join(',') + ')';
    }
    return cs[0] || (p && isHex(p.hex) ? p.hex : '#c9c9c4');
  }
  var SOURCE_LABEL = { site: 'Site (courriel)', marketplace: 'Marketplace', autre: 'Autre' };
  function kindLabel(k) { return k === 'refill' ? 'Recharge' : k === 'spool' ? 'Avec bobine' : k === 'item' ? 'Article' : 'Peu importe'; }
  function shortDate(iso) {
    try { return new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  }
  function isEmail(s) { return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(s || '').trim()); }

  /* ---------- données ---------- */
  var loaded = false, loading = null;
  var products = [], prodById = {};
  var open = [];            // demandes ouvertes
  var history = [];         // demandes closes (anonymes) — stats
  var alerted = [];         // produits signalés au poste de scan (ordre d'arrivée)
  var copied = {};          // id -> message copié (attend « Marquer avisé »)

  function load() {
    loading = Promise.all([
      sb.from('products').select('id,type,name,brand,material,hex,attrs,qty,qty_2,active')
        .in('type', ['filament', 'accessory', 'spacer'])
        .order('type', { ascending: true }).order('brand', { ascending: true })
        .order('material', { ascending: true }).order('name', { ascending: true }),
      sb.from('waitlist').select('*').order('created_at', { ascending: true })
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      if (r[1].error) throw r[1].error;
      products = r[0].data || [];
      prodById = {}; products.forEach(function (p) { prodById[p.id] = p; });
      var rows = r[1].data || [];
      open = rows.filter(function (x) { return x.status === 'open'; });
      history = rows.filter(function (x) { return x.status !== 'open'; });
      loaded = true;
      renderAll();
    }, function (err) {
      var el = $('#wl-list');
      if (el) el.innerHTML = '<p class="empty">Impossible de charger la liste d\'attente' +
        (err && err.message ? ' : ' + esc(err.message) : '') + '.</p>';
    });
    return loading;
  }
  function ensure() { return loaded ? Promise.resolve() : (loading || load()); }

  function prodLabel(p) {
    if (!p) return '(produit supprimé)';
    if (p.type === 'filament') return [p.material, p.name].filter(Boolean).join(' · ');
    return p.name || '(sans nom)';
  }
  function stockOf(p, kind) {
    if (!p) return 0;
    if (p.type !== 'filament') return p.qty | 0;
    if (kind === 'refill') return p.qty_2 | 0;
    if (kind === 'spool') return p.qty | 0;
    return (p.qty | 0) + (p.qty_2 | 0);
  }
  function openFor(pid, kind) {
    return open.filter(function (w) {
      if (String(w.product_id) !== String(pid)) return false;
      // format scanné connu : on montre les demandes de CE format + « peu importe »
      return !kind || kind === 'item' || !w.kind || w.kind === kind;
    });
  }

  /* ---------- rendu ---------- */
  function renderAll() {
    renderCount();
    renderList();
    renderStats();
    renderAlert();
    // pastilles « en attente » de la liste À commander (cms-inventory.js)
    try { document.dispatchEvent(new CustomEvent('ca:waitlist')); } catch (e) {}
  }
  function renderCount() {
    var el = $('#wl-tab-count'); if (!el) return;
    el.textContent = open.length;
    el.hidden = !open.length;
  }

  function reqRow(w) {
    var who = w.name || (w.source === 'site' ? (w.contact || '') : '') || 'Anonyme';
    var bits = [shortDate(w.created_at), SOURCE_LABEL[w.source] || w.source, kindLabel(w.kind)];
    if (w.source !== 'site' && w.contact) bits.push(w.contact);
    if (w.source === 'site' && w.name && w.contact) bits.push(w.contact);
    var act;
    if (w.source === 'site') {
      act = '<button type="button" class="btn btn-accent btn-sm wl-notify" data-id="' + esc(w.id) + '">✉ Envoyer le courriel</button>';
    } else if (copied[w.id]) {
      act = '<button type="button" class="btn btn-accent btn-sm wl-done" data-id="' + esc(w.id) + '">✓ Marquer avisé</button>' +
            '<button type="button" class="btn btn-ghost btn-sm wl-copy" data-id="' + esc(w.id) + '">Recopier</button>';
    } else {
      act = '<button type="button" class="btn btn-accent btn-sm wl-copy" data-id="' + esc(w.id) + '">⧉ Copier le message</button>';
    }
    return '<div class="wl-req" data-id="' + esc(w.id) + '">' +
      '<div class="wl-req-main"><span class="wl-req-who">' + esc(who) + '</span>' +
        '<span class="wl-req-meta">' + bits.filter(Boolean).map(esc).join(' · ') + '</span></div>' +
      '<div class="wl-req-act">' + act +
        '<button type="button" class="wl-del" data-id="' + esc(w.id) + '" aria-label="Supprimer la demande" title="Supprimer la demande">✕</button></div>' +
    '</div>';
  }

  function stockBadge(p, kinds) {
    if (!p) return '';
    if (p.type !== 'filament') { var q = p.qty | 0; return '<span class="wl-stock' + (q > 0 ? ' in' : '') + '">' + (q > 0 ? q + ' en stock' : 'Rupture') + '</span>'; }
    var parts = [];
    if (kinds.indexOf('refill') >= 0 || kinds.indexOf(null) >= 0) parts.push('Rech. ' + (p.qty_2 | 0));
    if (kinds.indexOf('spool') >= 0 || kinds.indexOf(null) >= 0) parts.push('Bob. ' + (p.qty | 0));
    var any = kinds.some(function (k) { return stockOf(p, k) > 0; });
    return '<span class="wl-stock' + (any ? ' in' : '') + '">' + (any ? 'En stock · ' : 'Stock : ') + parts.join(' · ') + '</span>';
  }

  function groupHtml(pid, reqs, opts) {
    var p = prodById[pid];
    var kinds = reqs.map(function (w) { return w.kind || null; });
    var sites = reqs.filter(function (w) { return w.source === 'site'; });
    var all = (opts && opts.bulk && sites.length > 1)
      ? '<button type="button" class="btn btn-accent btn-sm wl-notify-all" data-ids="' + esc(sites.map(function (w) { return w.id; }).join(',')) + '">✉ Aviser les ' + sites.length + ' courriels</button>' : '';
    return '<div class="wl-group" data-pid="' + esc(pid) + '">' +
      '<div class="wl-group-head">' +
        (p && p.type === 'filament' ? '<span class="wl-sw" style="background:' + esc(swatchBg(p)) + '"></span>' : '') +
        '<span class="wl-group-name">' + esc(prodLabel(p)) + '</span>' +
        '<span class="wl-group-n">' + reqs.length + ' en attente</span>' +
        stockBadge(p, kinds) + '<span class="grow"></span>' + all +
      '</div>' +
      reqs.map(reqRow).join('') +
    '</div>';
  }

  function renderList() {
    var el = $('#wl-list'); if (!el) return;
    if (!open.length) { el.innerHTML = '<p class="empty">Personne n\'attend de produit pour le moment.</p>'; return; }
    var by = {}, order = [];
    open.forEach(function (w) { if (!by[w.product_id]) { by[w.product_id] = []; order.push(w.product_id); } by[w.product_id].push(w); });
    // produits de retour en stock d'abord (à aviser), puis les plus demandés
    order.sort(function (a, b) {
      var pa = prodById[a], pb = prodById[b];
      var ia = by[a].some(function (w) { return stockOf(pa, w.kind) > 0; }) ? 1 : 0;
      var ib = by[b].some(function (w) { return stockOf(pb, w.kind) > 0; }) ? 1 : 0;
      return (ib - ia) || (by[b].length - by[a].length);
    });
    el.innerHTML = order.map(function (pid) { return groupHtml(pid, by[pid], { bulk: true }); }).join('');
    wire(el);
  }

  function renderStats() {
    var el = $('#wl-stats'); if (!el) return;
    var all = open.concat(history);
    if (!all.length) { el.innerHTML = ''; return; }
    var cnt = {};
    all.forEach(function (w) { cnt[w.product_id] = (cnt[w.product_id] || 0) + 1; });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 8);
    var notified = history.filter(function (w) { return w.status === 'notified'; }).length;
    var expired = history.filter(function (w) { return w.status === 'expired'; }).length;
    el.innerHTML = '<div class="wl-stats">' +
      '<h2>Les plus demandés <span class="wl-h-note">toutes demandes confondues (anonyme)</span></h2>' +
      '<div class="wl-stats-sum">' + all.length + ' demande' + (all.length > 1 ? 's' : '') + ' · ' +
        open.length + ' ouverte' + (open.length > 1 ? 's' : '') + ' · ' + notified + ' avisée' + (notified > 1 ? 's' : '') +
        ' · ' + expired + ' expirée' + (expired > 1 ? 's' : '') + '</div>' +
      top.map(function (pid) {
        var p = prodById[pid];
        return '<div class="wl-stat-row">' +
          (p && p.type === 'filament' ? '<span class="wl-sw" style="background:' + esc(swatchBg(p)) + '"></span>' : '<span class="wl-sw wl-sw-none"></span>') +
          '<span class="wl-stat-name">' + esc(prodLabel(p)) + '</span><span class="wl-stat-n">' + cnt[pid] + '</span></div>';
      }).join('') +
    '</div>';
  }

  /* ---------- alerte au poste de scan ---------- */
  function renderAlert() {
    var el = $('#wl-alert'); if (!el) return;
    var groups = alerted.map(function (a) { return { pid: a.pid, reqs: openFor(a.pid, a.kind) }; })
      .filter(function (g) { return g.reqs.length; });
    if (!groups.length) { el.hidden = true; el.innerHTML = ''; return; }
    var n = groups.reduce(function (s, g) { return s + g.reqs.length; }, 0);
    el.innerHTML =
      '<div class="wl-alert-head"><span class="wl-alert-ic" aria-hidden="true">🔔</span>' +
        '<strong>' + (n > 1 ? n + ' personnes attendent' : '1 personne attend') + ' ce que tu reçois</strong>' +
        '<span class="grow"></span>' +
        '<button type="button" class="wl-alert-close" aria-label="Masquer l\'alerte">✕</button></div>' +
      groups.map(function (g) { return groupHtml(g.pid, g.reqs, { bulk: true }); }).join('');
    el.hidden = false;
    wire(el);
    var close = $('.wl-alert-close', el);
    if (close) close.addEventListener('click', function () { alerted = []; renderAlert(); });
  }
  function flag(pid, kind) {
    if (!pid) return;
    alerted = alerted.filter(function (a) { return !(String(a.pid) === String(pid) && a.kind === kind); });
    alerted.unshift({ pid: pid, kind: kind });
  }

  /* ---------- actions ---------- */
  function wire(root) {
    $$('.wl-notify', root).forEach(function (b) { b.addEventListener('click', function () { notify([b.getAttribute('data-id')], b); }); });
    $$('.wl-notify-all', root).forEach(function (b) { b.addEventListener('click', function () { notify(b.getAttribute('data-ids').split(','), b); }); });
    $$('.wl-copy', root).forEach(function (b) { b.addEventListener('click', function () { copyMsg(b.getAttribute('data-id')); }); });
    $$('.wl-done', root).forEach(function (b) { b.addEventListener('click', function () { markDone(b.getAttribute('data-id'), b); }); });
    $$('.wl-del', root).forEach(function (b) { b.addEventListener('click', function () { removeReq(b.getAttribute('data-id')); }); });
  }

  function toast(msg, bad) {
    var t = $('#wl-toast');
    if (!t) { t = document.createElement('div'); t.id = 'wl-toast'; t.className = 'wl-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, bad ? 7000 : 3200);
  }

  // courriel automatique via l'Edge Function (admin seulement, vérifié côté serveur)
  function notify(ids, btn) {
    ids = ids.filter(Boolean); if (!ids.length) return;
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
    sb.functions.invoke('waitlist-notify', { body: { ids: ids } }).then(function (res) {
      if (res.error) {
        // FunctionsHttpError : le message utile est dans le corps de la réponse
        var ctx = res.error.context;
        var p = ctx && typeof ctx.json === 'function' ? ctx.json().catch(function () { return null; }) : Promise.resolve(null);
        return p.then(function (body) { throw new Error((body && body.error) || res.error.message || 'Échec de l\'envoi'); });
      }
      var results = (res.data && res.data.results) || [];
      var sent = results.filter(function (r) { return r.result === 'sent'; }).map(function (r) { return r.id; });
      var errs = results.filter(function (r) { return r.result === 'error'; });
      moveToHistory(sent);
      renderAll();
      if (errs.length) toast('Envoyé : ' + sent.length + ' · Échec : ' + errs.length + ' — ' + (errs[0].error || ''), true);
      else if (sent.length) toast(sent.length > 1 ? '✓ ' + sent.length + ' courriels envoyés.' : '✓ Courriel envoyé.');
      else toast('Rien à envoyer (demande déjà traitée ?).', true);
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      toast('Courriel non envoyé : ' + (err && err.message ? err.message : err), true);
    });
  }
  function moveToHistory(ids) {
    var now = new Date().toISOString();
    open = open.filter(function (w) {
      if (ids.indexOf(w.id) < 0) return true;
      history.push({ id: w.id, product_id: w.product_id, kind: w.kind, source: w.source, status: 'notified', created_at: w.created_at, notified_at: now });
      return false;
    });
  }

  function messageFor(w) {
    var p = prodById[w.product_id];
    var what = prodLabel(p).replace(' · ', ' ') + (w.kind === 'refill' ? ' (recharge)' : w.kind === 'spool' ? ' (avec bobine)' : '');
    return 'Salut' + (w.name ? ' ' + w.name : '') + ' ! Bonne nouvelle : le ' + what +
      ' que tu attendais vient d\'arriver. Je peux te le garder — dis-moi quand tu veux passer le chercher. ' +
      '— Création Audio';
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
    return new Promise(function (ok, ko) {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand('copy')) ok(); else ko(); } catch (e) { ko(e); }
      document.body.removeChild(ta);
    });
  }
  function copyMsg(id) {
    var w = open.filter(function (x) { return x.id === id; })[0]; if (!w) return;
    var txt = messageFor(w);
    copyText(txt).then(function () {
      copied[id] = true; renderAll();
      toast('Message copié — colle-le dans Messenger, puis « Marquer avisé ».');
    }, function () { window.prompt('Copie ce message :', txt); copied[id] = true; renderAll(); });
  }
  // avisé à la main -> on efface nom + contact (Loi 25), trace anonyme conservée
  function markDone(id, btn) {
    if (btn) btn.disabled = true;
    sb.from('waitlist').update({ status: 'notified', notified_at: new Date().toISOString(), name: null, contact: null })
      .eq('id', id).select().then(function (res) {
        if (res.error || !res.data || !res.data.length) { if (btn) btn.disabled = false; toast('Mise à jour refusée' + (res.error ? ' : ' + res.error.message : '.'), true); return; }
        delete copied[id]; moveToHistory([id]); renderAll(); toast('✓ Marqué comme avisé.');
      });
  }
  function removeReq(id) {
    var w = open.filter(function (x) { return x.id === id; })[0]; if (!w) return;
    if (!window.confirm('Supprimer cette demande (' + (w.name || w.contact || 'anonyme') + ') ?')) return;
    sb.from('waitlist').delete().eq('id', id).select().then(function (res) {
      if (res.error || !res.data || !res.data.length) { toast('Suppression refusée' + (res.error ? ' : ' + res.error.message : '.'), true); return; }
      open = open.filter(function (x) { return x.id !== id; }); delete copied[id]; renderAll();
    });
  }

  /* ---------- ajout manuel ---------- */
  var addForm = $('#wl-add-form'), addProd = $('#wl-add-prod'), addKind = $('#wl-add-kind'),
      addName = $('#wl-add-name'), addSource = $('#wl-add-source'), addContact = $('#wl-add-contact'),
      addSave = $('#wl-add-save'), addStatus = $('#wl-add-status'), addHint = $('#wl-add-contact-hint');
  function fillProdSelect() {
    if (!addProd) return;
    var cur = addProd.value;
    var groups = [['filament', 'Filaments'], ['accessory', 'Accessoires'], ['spacer', 'Spacers']];
    addProd.innerHTML = '<option value="">— choisir —</option>' + groups.map(function (g) {
      var list = products.filter(function (p) { return p.type === g[0] && p.active !== false; });
      if (!list.length) return '';
      return '<optgroup label="' + g[1] + '">' + list.map(function (p) {
        var lbl = p.type === 'filament' ? [p.brand, p.material, p.name].filter(Boolean).join(' · ') : p.name;
        return '<option value="' + esc(p.id) + '">' + esc(lbl) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    addProd.value = cur;
    syncAddForm();
  }
  function syncAddForm() {
    var p = addProd && prodById[addProd.value];
    if (addKind) addKind.disabled = !!(p && p.type !== 'filament');
    var site = addSource && addSource.value === 'site';
    if (addContact) { addContact.type = site ? 'email' : 'text'; addContact.placeholder = site ? 'courriel@exemple.com' : 'Messenger, téléphone…'; addContact.required = site; }
    if (addHint) addHint.textContent = site ? '(courriel requis)' : '(facultatif)';
  }
  if (addProd) addProd.addEventListener('change', syncAddForm);
  if (addSource) addSource.addEventListener('change', syncAddForm);
  if (addForm) addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var p = prodById[addProd.value];
    if (!p) { addStatus.textContent = 'Choisis un produit.'; return; }
    var source = addSource.value, contact = addContact.value.trim();
    if (source === 'site' && !isEmail(contact)) { addStatus.textContent = 'Courriel invalide.'; return; }
    var row = {
      product_id: p.id,
      kind: p.type === 'filament' ? (addKind.value || null) : null,
      name: addName.value.trim() || null,
      contact: source === 'site' ? contact.toLowerCase() : (contact || null),
      source: source
    };
    addSave.disabled = true; addStatus.textContent = 'Ajout…';
    sb.from('waitlist').insert(row).select().then(function (res) {
      addSave.disabled = false;
      if (res.error || !res.data || !res.data.length) {
        addStatus.textContent = res.error && /duplicate|unique/i.test(res.error.message) ? 'Ce courriel attend déjà ce produit.' : 'Ajout refusé' + (res.error ? ' : ' + res.error.message : '.');
        return;
      }
      open.push(res.data[0]); renderAll();
      addStatus.textContent = '✓ Demande ajoutée.';
      addName.value = ''; addContact.value = '';
    });
  });

  var refreshBtn = $('#wl-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', function () { load().then(fillProdSelect); });

  /* ---------- chargement : à chaque ouverture de l'Inventaire ---------- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'inventaire') load().then(fillProdSelect);
  };

  /* ---------- API pour cms-inventory.js ---------- */
  window.CA.waitlist = {
    // un article vient d'être scanné -> alerte s'il est attendu
    onScan: function (pid, kind) { ensure().then(function () { flag(pid, kind); renderAlert(); }); },
    // réception confirmée -> stock relu, alerte pour tous les articles reçus attendus
    onReceived: function (lines) {
      load().then(function () {
        (lines || []).forEach(function (l) { flag(l.productId || l.product_id, l.kind); });
        renderAlert();
      });
    },
    // nombre de demandes ouvertes (pastille dans « À commander »)
    count: function (pid, kind) { return openFor(pid, kind).length; },
    reload: load
  };
})();
