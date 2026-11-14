/* =========================================================
   Création Audio — CMS Nouveautés
   Ruban « Nouveau » : products.attrs.new_until (ISO, fin de journée) posé via CA.updateProduct.
   Les vues products_public / products_dealer exposent la clé ; promo.js (CA.promo.isNew)
   l'affiche sur boutique, spacers, dealer et accueil tant que la date n'est pas passée.
   Aucun nettoyage nécessaire : une date passée n'affiche plus rien.
   Groupes du sélecteur : filament = marque · matériau ; spacers ; accessoires.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  if (!sb) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var fold = window.CA.fold || function (s) { return String(s || '').toLowerCase(); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var pickEl = $('#nv-pick'), listEl = $('#nv-list'), qI = $('#nv-q'), daysI = $('#nv-days'),
      applyBtn = $('#nv-apply'), removeBtn = $('#nv-remove'), statusEl = $('#nv-status');
  if (!pickEl || !listEl) return;

  var prods = [], matOrder = {}, brandOrder = {}, loaded = false, busy = false;
  var sel = {}, openG = {};

  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function fmtDay(ts) {
    var d = new Date(ts);
    return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  }
  function untilOf(p) { var u = p.attrs && p.attrs.new_until, t = u ? Date.parse(u) : NaN; return isNaN(t) ? 0 : t; }
  function isOn(p) { return untilOf(p) > Date.now(); }
  function daysLeft(p) { return Math.max(1, Math.ceil((untilOf(p) - Date.now()) / 86400000)); }
  function endIso(days) {
    var d = new Date(); d.setDate(d.getDate() + days); d.setHours(23, 59, 59, 0);
    return d.toISOString();
  }

  function load() {
    listEl.innerHTML = '<p class="muted">Chargement…</p>';
    return Promise.all([
      sb.from('products').select('id,type,name,brand,material,hex,attrs,sort_order').eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true }),
      sb.from('materials').select('brand,name,sort_order'),
      sb.from('brands').select('name,sort_order')
    ]).then(function (r) {
      var bad = r.filter(function (x) { return x.error; })[0];
      if (bad) { listEl.innerHTML = '<p class="empty">Impossible de charger les produits.<br>' + esc(bad.error.message || bad.error) + '</p>'; return; }
      prods = r[0].data || [];
      matOrder = {}; brandOrder = {};
      (r[1].data || []).forEach(function (m, i) { matOrder[m.brand + '|' + m.name] = m.sort_order != null ? m.sort_order : i; });
      (r[2].data || []).forEach(function (b, i) { brandOrder[b.name] = b.sort_order != null ? b.sort_order : i; });
      loaded = true;
      render();
    });
  }

  function gkey(p) { return p.type === 'filament' ? 'f|' + (p.brand || '') + '|' + (p.material || '') : p.type === 'spacer' ? 's' : 'a'; }
  function glabel(p) {
    if (p.type === 'spacer') return 'Spacers';
    if (p.type === 'accessory') return 'Accessoires';
    return [p.brand, p.material].filter(Boolean).join(' · ') || 'Filaments';
  }
  function groupsOf(list) {
    var map = {}, out = [];
    list.forEach(function (p) {
      var k = gkey(p);
      if (!map[k]) { map[k] = { key: k, label: glabel(p), type: p.type, brand: p.brand, material: p.material, items: [] }; out.push(map[k]); }
      map[k].items.push(p);
    });
    var tr = { filament: 0, spacer: 1, accessory: 2 };
    function bo(g) { return brandOrder[g.brand] != null ? brandOrder[g.brand] : 999; }
    function mo(g) { var v = matOrder[g.brand + '|' + g.material]; return v != null ? v : 999; }
    out.sort(function (a, b) { return (tr[a.type] - tr[b.type]) || (bo(a) - bo(b)) || (mo(a) - mo(b)); });
    return out;
  }

  /* ---------- liste « en cours » + sélecteur ---------- */
  function render() { renderList(); renderPick(); }

  function renderList() {
    var on = prods.filter(isOn);
    if (!on.length) { listEl.innerHTML = '<p class="empty">Aucun produit marqué nouveau.</p>'; return; }
    listEl.innerHTML = groupsOf(on).map(function (g) {
      var last = Math.max.apply(null, g.items.map(untilOf));
      var n = g.items.length;
      return '<div class="pm-row is-on" data-k="' + esc(g.key) + '">' +
        '<div class="pm-main">' +
          '<div class="pm-top"><b class="pm-title">' + esc(g.label) + '</b><span class="pm-state s-on">Nouveau</span></div>' +
          '<div class="pm-meta">' + n + ' article' + (n > 1 ? 's' : '') + ' · jusqu\'au ' + esc(fmtDay(last)) + '</div>' +
        '</div>' +
        '<div class="pm-acts"><button type="button" class="btn btn-ghost btn-sm" data-a="off" data-ic="trash">Retirer</button></div>' +
      '</div>';
    }).join('');
  }
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a="off"]'); if (!b) return;
    var k = b.closest('.pm-row').getAttribute('data-k');
    write(prods.filter(function (p) { return isOn(p) && gkey(p) === k; }), null);
  });

  function swDot(p) { return p.hex ? '<i class="pm-dot" style="background:' + esc(p.hex) + '"></i>' : ''; }
  function renderPick() {
    var q = fold(qI.value.trim());
    var list = prods.filter(function (p) {
      return !q || fold([p.name, p.brand, p.material, p.type === 'spacer' ? 'spacer' : ''].join(' ')).indexOf(q) >= 0;
    });
    var gs = groupsOf(list);
    pickEl.innerHTML = gs.map(function (g) {
      var n = g.items.filter(function (p) { return sel[p.id]; }).length;
      var open = openG[g.key] || (q && true);
      return '<details class="pm-g"' + (open ? ' open' : '') + ' data-k="' + esc(g.key) + '">' +
        '<summary><label class="pm-all"><input type="checkbox" data-all="' + esc(g.key) + '"' + (n === g.items.length ? ' checked' : '') + '></label>' +
        '<span class="pm-gname">' + esc(g.label) + '</span><span class="pm-gn">' + n + ' / ' + g.items.length + '</span></summary>' +
        '<div class="pm-chips">' + g.items.map(function (p) {
          return '<label class="pm-chip' + (sel[p.id] ? ' is-on' : '') + '"><input type="checkbox" data-pid="' + esc(p.id) + '"' + (sel[p.id] ? ' checked' : '') + '>' +
            swDot(p) + '<span class="pm-cn">' + esc(p.name) + '</span>' +
            (isOn(p) ? '<small>' + daysLeft(p) + ' j</small>' : '') + '</label>';
        }).join('') + '</div></details>';
    }).join('') || '<p class="muted">Aucun article.</p>';
    $$('.pm-g', pickEl).forEach(function (d) {
      var g = gs.filter(function (x) { return x.key === d.getAttribute('data-k'); })[0]; if (!g) return;
      var n = g.items.filter(function (p) { return sel[p.id]; }).length, cb = $('[data-all]', d);
      cb.indeterminate = n > 0 && n < g.items.length;
    });
  }
  pickEl.addEventListener('toggle', function (e) {
    var d = e.target; if (d && d.classList && d.classList.contains('pm-g')) openG[d.getAttribute('data-k')] = d.open;
  }, true);
  pickEl.addEventListener('click', function (e) { if (e.target.closest('.pm-all')) e.stopPropagation(); });
  pickEl.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-all')) {
      var k = t.getAttribute('data-all'), on = t.checked, q = fold(qI.value.trim());
      prods.forEach(function (p) {
        if (gkey(p) !== k) return;
        if (q && fold([p.name, p.brand, p.material].join(' ')).indexOf(q) < 0) return;
        if (on) sel[p.id] = true; else delete sel[p.id];
      });
    } else if (t.hasAttribute('data-pid')) {
      if (t.checked) sel[t.getAttribute('data-pid')] = true; else delete sel[t.getAttribute('data-pid')];
    } else return;
    renderPick();
  });
  qI.addEventListener('input', renderPick);
  $('#nv-quick').addEventListener('click', function (e) {
    var b = e.target.closest('[data-d]'); if (b) daysI.value = b.getAttribute('data-d');
  });

  /* ---------- écriture : attrs.new_until (null = retirer) ---------- */
  function write(items, iso) {
    if (busy) return Promise.resolve();
    if (!items.length) { statusEl.textContent = 'Choisis au moins un article.'; return Promise.resolve(); }
    busy = true; applyBtn.disabled = removeBtn.disabled = true; statusEl.textContent = 'Enregistrement…';
    return Promise.all(items.map(function (p) {
      return window.CA.updateProduct(p.id, {}, { attrs: { new_until: iso } }).then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) throw new Error('Enregistrement refusé (permissions).');
        var a = Object.assign({}, p.attrs || {});
        if (iso) a.new_until = iso; else delete a.new_until;
        p.attrs = a;
      });
    })).then(function () {
      sel = {};
      statusEl.textContent = iso ? 'Ruban posé sur ' + items.length + ' article' + (items.length > 1 ? 's' : '') + ' ✓' : 'Ruban retiré ✓';
      render();
    }).catch(function (err) { caDialog.error(err); statusEl.textContent = ''; load(); })
      .then(function () { busy = false; applyBtn.disabled = removeBtn.disabled = false; });
  }
  applyBtn.addEventListener('click', function () {
    var days = parseInt(daysI.value, 10);
    if (!(days >= 1 && days <= 365)) { statusEl.textContent = 'Durée entre 1 et 365 jours.'; daysI.focus(); return; }
    write(prods.filter(function (p) { return sel[p.id]; }), endIso(days));
  });
  removeBtn.addEventListener('click', function () {
    write(prods.filter(function (p) { return sel[p.id] && isOn(p); }), null);
  });
  $('#nv-refresh').addEventListener('click', load);

  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'nouveautes') load();
  };
})();
