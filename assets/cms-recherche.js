/* =========================================================
   Création Audio V2 — Recherche globale (Ctrl+K / Cmd+K)
   Une fenêtre au-dessus de l'admin : tape un mot (n° de facture ou de commande,
   nom de client, couleur, code de spacer, nom d'onglet…) et Entrée pour y aller.
   Cherche dans : onglets, factures, commandes dealers / clients, réservations,
   clients, conversations, produits (filaments, spacers, accessoires).
   L'élément trouvé est ouvert (facture : Historique) ou mis en évidence dans son onglet.
   Raccourci partout ; bouton « Rechercher » dans la barre du haut en grand écran.
   Données relues à l'ouverture si elles datent de plus de 2 min (lecture seule).
   ========================================================= */
(function () {
  'use strict';

  var CA = window.CA = window.CA || {}, sb = CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }

  var GROUPS = [['tab', 'Onglets'], ['inv', 'Factures'], ['order', 'Commandes'], ['client', 'Clients'], ['conv', 'Messages'], ['prod', 'Produits']];
  var items = [], loadedAt = 0, loading = null, ready = false;

  /* ---- fenêtre ---- */
  var box = document.createElement('div');
  box.className = 'ck'; box.hidden = true;
  box.innerHTML =
    '<div class="ck-box" role="dialog" aria-modal="true" aria-label="Recherche">' +
      '<input type="search" class="ck-in" placeholder="Facture, commande, client, produit, onglet…" autocomplete="off" spellcheck="false" aria-label="Rechercher">' +
      '<div class="ck-list" role="listbox"></div>' +
      '<div class="ck-foot"><span><kbd>↑</kbd><kbd>↓</kbd> choisir</span><span><kbd>Entrée</kbd> ouvrir</span><span><kbd>Échap</kbd> fermer</span></div>' +
    '</div>';
  document.body.appendChild(box);
  var input = $('.ck-in', box), list = $('.ck-list', box), hits = [], cur = 0, lastFocus = null;

  // bouton de la barre du haut (visible en grand écran, admin.css)
  var topBtn = document.createElement('button');
  topBtn.type = 'button'; topBtn.className = 'btn btn-ghost btn-sm ck-open'; topBtn.id = 'ck-open';
  topBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg><span>Rechercher</span><kbd>Ctrl K</kbd>';
  var spacer = $('.topbar .topbar-spacer');
  if (spacer && spacer.parentNode) spacer.parentNode.insertBefore(topBtn, spacer.nextSibling);
  topBtn.addEventListener('click', function () { openBox(); });

  function openBox() {
    if (!ready) return;
    lastFocus = document.activeElement;
    box.hidden = false; input.value = ''; cur = 0;
    paint();
    setTimeout(function () { input.focus(); }, 0);
    if (Date.now() - loadedAt > 120000) load().then(function () { if (!box.hidden) paint(); });
  }
  function closeBox() {
    box.hidden = true;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      if (!ready) return;
      e.preventDefault();
      if (box.hidden) openBox(); else closeBox();
    }
  });
  box.addEventListener('mousedown', function (e) { if (e.target === box) closeBox(); });
  input.addEventListener('input', function () { cur = 0; paint(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); closeBox(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      mark(); return;
    }
    if (e.key === 'Enter') { e.preventDefault(); if (hits[cur]) go(hits[cur]); }
  });
  list.addEventListener('click', function (e) {
    var b = e.target.closest('.ck-item'); if (!b) return;
    go(hits[+b.getAttribute('data-i')]);
  });
  list.addEventListener('mousemove', function (e) {
    var b = e.target.closest('.ck-item'); if (!b) return;
    var i = +b.getAttribute('data-i'); if (i !== cur) { cur = i; mark(); }
  });

  /* ---- données ---- */
  function q(make) {
    var p; try { p = make(); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (r) { return r && !r.error ? (r.data || []) : []; }, function () { return []; });
  }
  function load() {
    if (loading) return loading;
    loading = Promise.all([
      q(function () { return sb.from('invoices').select('id,number,client_name,client_type,total,invoice_date,status').order('invoice_date', { ascending: false }).limit(1500); }),
      q(function () { return sb.from('dealer_orders').select('id,number,dealer_name,dealer_email,status').order('created_at', { ascending: false }).limit(400); }),
      q(function () { return sb.from('customer_orders').select('id,number,name,email,status').order('created_at', { ascending: false }).limit(400); }),
      q(function () { return sb.from('customer_reservations').select('id,number,name,email,status').order('created_at', { ascending: false }).limit(400); }),
      q(function () { return sb.from('clients').select('id,name,email,phone').limit(2000); }),
      q(function () { return sb.from('conversations').select('id,status,last_preview,customers(name,email)').order('updated_at', { ascending: false }).limit(300); }),
      q(function () { return sb.from('products').select('id,type,name,code,brand,material').limit(3000); })
    ]).then(function (r) {
      var out = [];
      $$('.tab[data-tab]').forEach(function (t) {
        var lbl = ($('span', t) || t).textContent.trim();
        out.push({ g: 'tab', title: lbl, meta: t.getAttribute('data-group') || '', hay: lbl + ' ' + (t.getAttribute('data-group') || ''), hash: '#' + t.getAttribute('data-tab') });
      });
      r[0].forEach(function (f) {
        var who = f.client_type === 'internal' ? 'Usage interne' : (f.client_name || '');
        out.push({ g: 'inv', title: (f.number || '—') + (who ? ' · ' + who : ''), meta: (f.invoice_date || '') + ' · ' + money(f.total) + (f.status === 'cancelled' ? ' · annulée' : ''),
          hay: (f.number || '') + ' ' + who, num: f.number, inv: f.id });
      });
      r[1].forEach(function (o) { out.push({ g: 'order', title: o.number + ' · ' + (o.dealer_name || o.dealer_email || ''), meta: 'Dealer', hay: o.number + ' ' + (o.dealer_name || '') + ' ' + (o.dealer_email || ''), num: o.number, hash: '#commandes', id: o.id }); });
      r[2].forEach(function (o) { out.push({ g: 'order', title: o.number + ' · ' + (o.name || o.email || ''), meta: 'Client en ligne', hay: o.number + ' ' + (o.name || '') + ' ' + (o.email || ''), num: o.number, hash: '#commandes/clients', id: o.id }); });
      r[3].forEach(function (o) { out.push({ g: 'order', title: o.number + ' · ' + (o.name || o.email || ''), meta: 'Réservation', hay: o.number + ' ' + (o.name || '') + ' ' + (o.email || ''), num: o.number, hash: '#commandes/reservations', id: o.id }); });
      r[4].forEach(function (c) { out.push({ g: 'client', title: c.name || c.email || 'Client', meta: [c.email, c.phone].filter(Boolean).join(' · '), hay: [c.name, c.email, c.phone].join(' '), hash: '#clients', id: c.id }); });
      r[5].forEach(function (c) {
        var k = c.customers || {};
        out.push({ g: 'conv', title: k.name || k.email || 'Client', meta: c.last_preview || '', hay: [k.name, k.email, c.last_preview].join(' '), hash: '#messages/' + c.id });
      });
      var TAB = { filament: '#filaments', spacer: '#spacers', accessory: '#accessoires' };
      r[6].forEach(function (p) {
        if (!TAB[p.type]) return;
        var t = p.type === 'filament' ? [p.brand, p.material, p.name].filter(Boolean).join(' · ') : (p.name || '');
        out.push({ g: 'prod', title: t, meta: p.type === 'filament' ? 'Filament' : p.type === 'spacer' ? 'Spacer' : 'Accessoire',
          hay: [p.brand, p.material, p.name, p.code].join(' '), num: p.code, hash: TAB[p.type], id: p.id });
      });
      out.forEach(function (it) { it.n = norm(it.hay); });
      items = out; loadedAt = Date.now();
    }).then(function () { loading = null; }, function () { loading = null; });
    return loading;
  }

  /* ---- résultats ---- */
  function search(text) {
    var terms = norm(text).split(/\s+/).filter(Boolean);
    if (!terms.length) return items.filter(function (it) { return it.g === 'tab'; });
    var scored = [];
    items.forEach(function (it) {
      if (!terms.every(function (t) { return it.n.indexOf(t) >= 0; })) return;
      var s = 0, num = norm(it.num || '');
      if (num && num === terms.join(' ')) s += 100;            // n° exact
      else if (num && num.indexOf(terms[0]) === 0) s += 50;     // début de n°
      if (norm(it.title).indexOf(terms[0]) === 0) s += 20;
      scored.push({ it: it, s: s });
    });
    var byG = {};
    scored.sort(function (a, b) { return b.s - a.s; }).forEach(function (x) { (byG[x.it.g] = byG[x.it.g] || []).push(x.it); });
    var out = [];
    GROUPS.forEach(function (g) { (byG[g[0]] || []).slice(0, 6).forEach(function (it) { out.push(it); }); });
    return out;
  }
  function paint() {
    hits = search(input.value);
    if (!hits.length) { list.innerHTML = '<p class="ck-none">' + (loading ? 'Chargement…' : 'Aucun résultat.') + '</p>'; return; }
    var html = '', last = null;
    hits.forEach(function (it, i) {
      if (it.g !== last) { last = it.g; html += '<div class="ck-grp">' + esc(GROUPS.filter(function (g) { return g[0] === it.g; })[0][1]) + '</div>'; }
      html += '<button type="button" class="ck-item" role="option" data-i="' + i + '"><span class="ck-t">' + esc(it.title) + '</span>' +
        (it.meta ? '<span class="ck-m">' + esc(it.meta) + '</span>' : '') + '</button>';
    });
    list.innerHTML = html;
    if (cur >= hits.length) cur = 0;
    mark();
  }
  function mark() {
    $$('.ck-item', list).forEach(function (b) {
      var on = +b.getAttribute('data-i') === cur;
      b.classList.toggle('is-cur', on); b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ block: 'nearest' });
    });
  }

  /* ---- aller à l'élément ---- */
  function go(it) {
    closeBox();
    if (it.inv) { if (CA.focusInvoice) CA.focusInvoice(it.inv); location.hash = '#historique'; return; }
    if (location.hash !== it.hash) location.hash = it.hash;
    if (it.id) flash(it.hash.replace(/^#/, '').split('/')[0], it.id);
  }
  // met en évidence la carte / ligne [data-id] dans l'onglet ouvert (attend qu'elle soit rendue)
  function flash(tab, id, tries) {
    tries = tries || 0;
    var panel = $('.tabpanel[data-panel="' + tab + '"]');
    var el = panel && $$('[data-id]', panel).filter(function (x) { return x.getAttribute('data-id') === String(id) && x.offsetParent !== null; })[0];
    if (!el) { if (tries < 25) setTimeout(function () { flash(tab, id, tries + 1); }, 200); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('ck-flash'); void el.offsetWidth; el.classList.add('ck-flash');
    setTimeout(function () { el.classList.remove('ck-flash'); }, 2200);
  }

  if (CA.onAdminReady) CA.onAdminReady(function () { ready = true; load(); });
})();
