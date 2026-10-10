/* =========================================================
   Création Audio V2 — Commandes fournisseur « en route »
   Inventaire › À commander › carte « En route ».
   Théo colle sa commande (courriel / page Bambu, Elegoo…) :
   1) lecteur à règles fixes (format Bambu « Couleur (code) / Refill / 1kg ») ;
   2) ce qui n'est pas reconnu part à la lecture IA (Edge Function order-parse) ;
   3) écran de vérification (menus corrigeables) -> enregistrement.
   Les corrections sont retenues (admin_settings « commande_alias »).
   Les articles « en route » sont retirés du Manque (cms-inventory.js) sans
   toucher au stock ; la Réception les consomme (allocate) et la commande se
   ferme toute seule quand tout est reçu.
   Tables : supplier_orders / supplier_order_lines (schema-v2.sql).
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
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }
  function money(n) { return round2(n).toFixed(2).replace('.', ',') + ' $'; }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function normOrder(s) { return String(s || '').trim().replace(/^#/, '').toLowerCase(); }
  function kindOf(k) { return k === 'refill' ? 'refill' : (k === 'item' ? 'item' : 'spool'); }
  function inv() { return window.CA.inv; }

  /* =========================================================
     DONNÉES — commandes ouvertes (+ leurs lignes)
     ========================================================= */
  var orders = [];          // [{ id, order_number, supplier, ordered_at, status, lines: [...] }]
  var loading = null;

  function load() {
    loading = sb.from('supplier_orders').select('*').eq('status', 'open')
      .order('ordered_at', { ascending: true }).order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        var list = res.data || [];
        if (!list.length) return [list, []];
        return sb.from('supplier_order_lines').select('*').in('order_id', list.map(function (o) { return o.id; }))
          .then(function (r2) { if (r2.error) throw r2.error; return [list, r2.data || []]; });
      })
      .then(function (r) {
        var by = {};
        r[1].forEach(function (l) { (by[l.order_id] = by[l.order_id] || []).push(l); });
        orders = r[0].map(function (o) { o.lines = by[o.id] || []; return o; });
        loading = null;
        renderList();
        try { document.dispatchEvent(new CustomEvent('ca:enroute')); } catch (e) {}
      }, function (err) { loading = null; orders = []; renderList(err); });
    return loading;
  }

  function remaining(l) { return Math.max(0, (l.qty | 0) - (l.qty_received | 0)); }
  function count(pid, kind) {
    var n = 0;
    orders.forEach(function (o) {
      o.lines.forEach(function (l) {
        if (String(l.product_id) !== String(pid)) return;
        if (kind && kindOf(l.kind) !== kind) return;
        n += remaining(l);
      });
    });
    return n;
  }

  /* ---- la Réception consomme (sign +1) ou rend (sign −1) les quantités en route ----
     ref = { id } (commande pointée dans Réception) ou un ancien n° de commande (texte) :
     seulement cette commande. Sans commande (null) : rien n'est consommé (achat à part). */
  function allocate(lines, ref, sign) {
    if (!ref) return Promise.resolve();
    var byId = typeof ref === 'object' && ref.id;
    var orderNumber = byId ? null : normOrder(ref);
    lines = (lines || []).map(function (l) {
      return { pid: l.product_id || l.productId, kind: kindOf(l.kind), qty: (l.qty | 0) };
    }).filter(function (l) { return l.pid && l.qty > 0; });
    if (!lines.length) return Promise.resolve();
    var pids = lines.map(function (l) { return l.pid; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var oLines, oById = {};
    return sb.from('supplier_order_lines').select('id,order_id,product_id,kind,qty,qty_received').in('product_id', pids)
      .then(function (res) {
        if (res.error) throw res.error;
        oLines = res.data || [];
        var q = sb.from('supplier_orders').select('id,order_number,ordered_at,created_at,status').neq('status', 'cancelled');
        return byId ? q.eq('id', byId) : q.ilike('order_number', orderNumber);
      })
      .then(function (res) {
        if (res.error) throw res.error;
        (res.data || []).forEach(function (o) { oById[o.id] = o; });
        var pool = oLines.filter(function (l) { return oById[l.order_id]; });
        if (!pool.length) return null;
        var when = function (l) { var o = oById[l.order_id]; return (o.ordered_at || '') + (o.created_at || ''); };
        pool.sort(function (a, z) { return sign > 0 ? (when(a) < when(z) ? -1 : 1) : (when(a) > when(z) ? -1 : 1); });

        var changed = {};
        lines.forEach(function (rl) {
          var left = rl.qty;
          pool.forEach(function (l) {
            if (!left || String(l.product_id) !== String(rl.pid) || kindOf(l.kind) !== rl.kind) return;
            var room = sign > 0 ? remaining(l) : (l.qty_received | 0);
            var take = Math.min(room, left);
            if (take <= 0) return;
            l.qty_received = (l.qty_received | 0) + sign * take;
            left -= take; changed[l.id] = l;
          });
        });
        var ids = Object.keys(changed);
        if (!ids.length) return null;
        var touched = ids.map(function (id) { return changed[id].order_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        return Promise.all(ids.map(function (id) {
          return sb.from('supplier_order_lines').update({ qty_received: changed[id].qty_received }).eq('id', id)
            .then(function (r) { if (r.error) throw r.error; });
        })).then(function () { return syncStatus(touched); });
      })
      .then(function () { return load(); });
  }
  // commande entièrement reçue -> fermée ; rouverte si une réception est retirée
  function syncStatus(orderIds) {
    return sb.from('supplier_order_lines').select('order_id,qty,qty_received').in('order_id', orderIds).then(function (res) {
      if (res.error) throw res.error;
      var left = {};
      orderIds.forEach(function (id) { left[id] = 0; });
      (res.data || []).forEach(function (l) { left[l.order_id] += remaining(l); });
      return Promise.all(orderIds.map(function (id) {
        return sb.from('supplier_orders').update({ status: left[id] > 0 ? 'open' : 'closed' }).eq('id', id).neq('status', 'cancelled')
          .then(function (r) { if (r.error) throw r.error; });
      }));
    });
  }

  function dropRemaining(orderId) {
    return sb.from('supplier_order_lines').select('id,qty,qty_received').eq('order_id', orderId).then(function (res) {
      if (res.error) throw res.error;
      return Promise.all((res.data || []).filter(function (l) { return remaining(l) > 0; }).map(function (l) {
        return sb.from('supplier_order_lines').update({ qty: l.qty_received | 0 }).eq('id', l.id)
          .then(function (r) { if (r.error) throw r.error; });
      }));
    }).then(function () { return syncStatus([orderId]); }).then(function () { return load(); });
  }

  window.CA.enRoute = {
    count: count, allocate: allocate, reload: load, dropRemaining: dropRemaining,
    list: function () { return orders; }
  };

  /* =========================================================
     LECTURE DU TEXTE COLLÉ
     ========================================================= */
  var aliases = {};            // libellé normalisé -> { pid }  (admin_settings « commande_alias »)
  var aliasesLoaded = null;
  function loadAliases() {
    if (aliasesLoaded) return aliasesLoaded;
    aliasesLoaded = sb.from('admin_settings').select('value').eq('key', 'commande_alias').maybeSingle()
      .then(function (res) { aliases = (res.data && res.data.value) || {}; }, function () { aliases = {}; });
    return aliasesLoaded;
  }
  function saveAliases(newOnes) {
    var keys = Object.keys(newOnes);
    if (!keys.length) return Promise.resolve();
    keys.forEach(function (k) { aliases[k] = newOnes[k]; });
    return sb.from('admin_settings').upsert({ key: 'commande_alias', value: aliases, updated_at: new Date().toISOString() })
      .then(function () {}, function () {});
  }

  // n° de commande : « ca785184293604298752 » (Bambu), « Order #ECA55314 » (Elegoo), « Commande n° … »
  function findOrderNumbers(text) {
    var out = [], m, re = /(?:order|commande)\s*(?:no\.?|number|num[ée]ro|n°|#)\s*:?\s*([A-Z0-9][A-Z0-9-]{4,})/gi;
    var bambu = text.match(/\b([a-z]{2}\d{12,})\b/gi) || [];
    while ((m = re.exec(text))) out.push(m[1]);
    return bambu.concat(out).filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  var PRICE = /^(?:CA)?\$\s*([\d,]*\d(?:\.\d{1,2})?)\s*$|^([\d,]*\d\.\d{2})\s*\$?$/;
  function priceOf(line) {
    var m = line.match(PRICE); if (!m) return null;
    return parseFloat(String(m[1] || m[2]).replace(/,/g, ''));
  }
  // prix payé de la ligne = le plus petit des montants du bloc (prix d'origine / total après rabais),
  // quel que soit l'ordre (Bambu : payé puis origine ; Elegoo : origine puis payé)
  function paidOf(lines, from, to) {
    var prices = [];
    for (var j = from; j < to; j++) { var p = priceOf(lines[j]); if (p != null) prices.push(p); }
    return prices.length ? Math.min.apply(null, prices) : null;
  }

  // Bambu : « Matériau » puis « Couleur (code) / Refill|Spool|Filament with spool / 1kg », « x N », prix.
  var BAMBU = /^(.+?)\s*\((\d{4,6})\)\s*\/\s*([^/]+?)\s*\/\s*[\d.,]+\s*k?g\b/i;
  function parseBambu(lines) {
    var anchors = [];
    lines.forEach(function (l, i) { if (BAMBU.test(l)) anchors.push(i); });
    return anchors.map(function (i, n) {
      var m = lines[i].match(BAMBU);
      var color = m[1].trim(), code = m[2], typeStr = m[3];
      var material = '';
      for (var k = i - 1; k >= 0 && k >= i - 4; k--) {
        var t = lines[k];
        if (!t || /^x\s*\d+$/i.test(t) || /^\d+$/.test(t) || /\$/.test(t)) continue;
        material = t; break;
      }
      var end = n + 1 < anchors.length ? anchors[n + 1] : lines.length;
      var qty = null;
      for (var j = i + 1; j < end; j++) {
        var q = lines[j].match(/^(?:x|qt[ée]?\.?|quantit[ée]\s*:?)\s*(\d+)$/i);
        if (q) { qty = parseInt(q[1], 10); break; }
      }
      if (qty == null) {   // ancien format : quantité seule sur une ligne au-dessus
        for (var b = i - 1; b >= 0 && b >= i - 3; b--) { if (/^\d+$/.test(lines[b])) { qty = parseInt(lines[b], 10); break; } }
      }
      qty = qty || 1;
      var paid = paidOf(lines, i + 1, end);
      return { at: i, brand: 'bambu', label: (material ? material + ' · ' : '') + color + ' (' + code + ')',
        material: material, color: color, code: code, kind: /refill|recharge/i.test(typeStr) ? 'refill' : 'spool', qty: qty,
        unitCost: paid != null ? round2(paid / qty) : null };
    });
  }

  // Elegoo (boutique Shopify) : « Produit », « Quantity2 », « Produit » répété, puis la variante :
  // « Filament with spool / Black », « Refill / Beige », « PETG / Black » ou juste « Silk Blue Purple » ;
  // ensuite « $24.99/ea », rabais « (-$5.99) », prix d'origine, total payé.
  var QTY = /^quantit(?:y|é|e)\s*:?\s*(\d+)$/i;
  function parseShop(lines) {
    var anchors = [];
    lines.forEach(function (l, i) { if (QTY.test(l)) anchors.push(i); });
    var titleAt = function (i) { for (var k = i - 1; k >= 0; k--) { if (lines[k]) return k; } return -1; };
    return anchors.map(function (i, n) {
      var ti = titleAt(i), title = ti > -1 ? lines[ti] : '';
      var qty = parseInt(lines[i].match(QTY)[1], 10) || 1;
      var j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      if (j < lines.length && norm(lines[j]) === norm(title)) j++;
      while (j < lines.length && !lines[j]) j++;
      var variant = j < lines.length && priceOf(lines[j]) == null && !/^\(/.test(lines[j]) ? lines[j] : '';
      var end = n + 1 < anchors.length ? titleAt(anchors[n + 1]) : lines.length;
      var parts = variant.split('/').map(function (s) { return s.trim(); }).filter(Boolean);
      var kind = 'spool', material = title, color = parts.length ? parts[parts.length - 1] : '';
      if (parts.length > 1) {
        var first = parts[0];
        if (/refill|recharge/i.test(first)) kind = 'refill';
        else if (!/spool|bobine/i.test(first)) material = first;      // « 3 kg Filament Spool » / « PETG / Black »
      }
      var paid = paidOf(lines, j + 1, end);
      return { at: i, brand: 'elegoo', label: title + (variant ? ' · ' + variant : ''),
        material: material, color: color, code: '', kind: kind, qty: qty,
        unitCost: paid != null ? round2(paid / qty) : null };
    });
  }

  function parseRules(text) {
    var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); });
    return parseBambu(lines).concat(parseShop(lines)).sort(function (a, z) { return a.at - z.at; });
  }

  // distance d'édition (fautes de frappe : Magenta / Megenta, Grey / Gray)
  function lev(a, b) {
    if (a === b) return 0;
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }

  // rattache une ligne lue à un produit : correction retenue > code > marque + matériau + couleur
  // (exacte, puis sans le mot du matériau — « Silk Blue Purple » = « Blue Purple » —, puis à une faute près)
  function match(r) {
    var fils = inv().filaments();
    var a = aliases[norm(r.label)];
    if (a && inv().prod(a.pid)) return { pid: a.pid, kind: r.kind, how: 'appris' };   // le format vient toujours du texte
    if (r.code) {
      var byCode = fils.filter(function (f) { return f.code && String(f.code).trim() === String(r.code).trim(); });
      if (byCode.length === 1) return { pid: byCode[0].id, kind: r.kind, how: 'code' };
    }
    var pool = fils;
    if (r.brand) {
      var ofBrand = fils.filter(function (f) { return norm(f.brand).indexOf(r.brand) > -1; });
      if (ofBrand.length) pool = ofBrand;
    }
    var nm = norm(r.material);
    var mats = pool.filter(function (f) { return norm(f.material) === nm; });
    // matériau absent du catalogue de cette marque (ex. PETG 3 kg pour l'atelier) : hors catalogue
    if (!mats.length) return pool !== fils ? { pid: null, how: 'hors' } : null;
    var drop = nm.split(' ');
    var key = function (s) { return norm(s).split(' ').filter(function (w) { return drop.indexOf(w) < 0; }).join(' '); };
    var nc = norm(r.color), kc = key(r.color);
    var one = function (list, how) { return list.length === 1 ? { pid: list[0].id, kind: r.kind, how: how } : null; };
    var hit = one(mats.filter(function (f) { return norm(f.name) === nc; }), 'nom') ||
              one(mats.filter(function (f) { return key(f.name) === kc; }), 'nom');
    if (hit || !kc) return hit;
    var scored = mats.map(function (f) { return { f: f, d: lev(key(f.name), kc) }; }).sort(function (x, y) { return x.d - y.d; });
    if (scored.length && scored[0].d <= Math.min(2, Math.floor(kc.length / 4)) && (scored.length === 1 || scored[1].d > scored[0].d)) {
      return { pid: scored[0].f.id, kind: r.kind, how: 'proche' };
    }
    return null;
  }

  /* =========================================================
     ÉDITEUR — coller / analyser / vérifier / enregistrer
     ========================================================= */
  var card = $('#po-card'), newBtn = $('#po-new'), editorEl = $('#po-editor'), pasteI = $('#po-paste'),
      numberI = $('#po-number'), dateI = $('#po-date'), parseBtn = $('#po-parse'), statusEl = $('#po-status'),
      reviewEl = $('#po-review'), rowsEl = $('#po-rows'), saveBtn = $('#po-save'), addBtn = $('#po-add'),
      cancelBtn = $('#po-cancel'), sumEl = $('#po-sum'), listEl = $('#po-list'), totalEl = $('#po-total');
  if (!card) return;

  var taxI = $('#po-tax');
  var taxes = null;          // admin_settings « taxes_fournisseur » : { marque: % }
  function loadTaxes() {
    if (taxes) return Promise.resolve(taxes);
    return sb.from('admin_settings').select('value').eq('key', 'taxes_fournisseur').maybeSingle()
      .then(function (res) { taxes = (res.data && res.data.value) || {}; return taxes; }, function () { taxes = {}; return taxes; });
  }
  function taxDefault(supplier) {
    if (!supplier) return 0;
    if (taxes && taxes[supplier] != null) return +taxes[supplier];
    return /bambu/i.test(supplier) ? 14.975 : 0;   // TPS 5 % + TVQ 9,975 %
  }
  function taxVal() { var v = parseFloat(String(taxI && taxI.value || '').replace(',', '.')); return isFinite(v) && v > 0 ? v : 0; }
  function fmtTax(v) { return String(+(+v || 0).toFixed(3)).replace('.', ','); }
  function supplierOf(list) {
    var brands = {};
    list.forEach(function (r) { var pr = r.productId && inv().prod(r.productId); var b = pr && pr.brand; if (b) brands[b] = (brands[b] || 0) + (r.qty || 0); });
    return Object.keys(brands).sort(function (a, z) { return brands[z] - brands[a]; })[0] || null;
  }
  if (taxI) taxI.addEventListener('input', function () { taxI.dataset.touched = '1'; renderSum(); });

  var rows = [];             // { label, productId, kind, qty, unitCost, how, picked }
  var editingId = null;      // commande en cours de modification
  var editingReceived = {};  // pid|kind -> qté déjà reçue (gardée à la modification)

  function openEditor(order) {
    editorEl.hidden = false; newBtn.hidden = true;
    editingId = order ? order.id : null;
    editingReceived = {};
    statusEl.textContent = '';
    if (order) {
      pasteI.value = '';
      numberI.value = order.order_number || '';
      dateI.value = order.ordered_at || todayISO();
      if (taxI) { taxI.value = fmtTax(order.tax_rate); taxI.dataset.touched = '1'; }
      rows = order.lines.map(function (l) {
        var k = (l.product_id || '') + '|' + kindOf(l.kind);
        editingReceived[k] = (editingReceived[k] || 0) + (l.qty_received | 0);
        return { label: l.label || '', productId: l.product_id ? String(l.product_id) : '', kind: kindOf(l.kind), qty: l.qty | 0,
          unitCost: l.unit_cost != null ? +l.unit_cost : null, how: 'saisi', picked: false };
      });
      renderRows();
    } else {
      pasteI.value = ''; numberI.value = ''; dateI.value = todayISO();
      if (taxI) { taxI.value = ''; delete taxI.dataset.touched; }
      rows = []; reviewEl.hidden = true;
      setTimeout(function () { pasteI.focus(); }, 30);
    }
    saveBtn.textContent = order ? 'Enregistrer les modifications' : 'Enregistrer la commande';
    inv().ready();
    loadAliases(); loadTaxes();
  }
  function closeEditor() {
    editorEl.hidden = true; newBtn.hidden = false;
    rows = []; editingId = null; reviewEl.hidden = true; statusEl.textContent = '';
  }
  newBtn.addEventListener('click', function () { openEditor(null); });
  cancelBtn.addEventListener('click', closeEditor);
  addBtn.addEventListener('click', function () {
    rows.push({ label: '', productId: '', kind: 'refill', qty: 1, unitCost: null, how: 'saisi', picked: true });
    renderRows();
  });

  // coller = analyser tout de suite
  pasteI.addEventListener('paste', function () { setTimeout(analyse, 0); });
  parseBtn.addEventListener('click', analyse);

  function analyse() {
    var text = pasteI.value || '';
    if (!text.trim()) { statusEl.textContent = 'Colle d\'abord ta commande.'; return; }
    // une commande à la fois : la réception retrouve ensuite la bonne commande par son n°
    var nums = findOrderNumbers(text);
    if (nums.length > 1) { statusEl.textContent = nums.length + ' commandes dans le texte : colle-les une à la fois.'; return; }
    if (!numberI.value.trim() && nums.length) numberI.value = nums[0];
    statusEl.textContent = 'Analyse…';
    parseBtn.disabled = true;
    Promise.all([inv().ready(), loadAliases()]).then(function () {
      var found = parseRules(text).map(function (r) {
        var m = match(r);
        var p = m && m.pid ? inv().prod(m.pid) : null;
        return { label: r.label, productId: p ? String(p.id) : '', kind: p ? inv().fitKind(p, m.kind) : r.kind,
          qty: r.qty, unitCost: r.unitCost, how: m ? m.how : 'aucun', picked: false };
      });
      var unknown = found.filter(function (r) { return r.how === 'aucun'; });   // « hors catalogue » : pas la peine de demander à l'IA
      // tout reconnu par les règles fixes : pas besoin de l'IA
      if (found.length && !unknown.length) return { rows: found, ai: null };
      if (!found.length) statusEl.textContent = 'Lecture IA…';
      return askAI(text, found.length ? unknown.map(function (r) { return r.label; }) : null).then(function (ai) {
        if (ai.error) return { rows: found, ai: ai };
        if (!found.length) {
          if (!numberI.value.trim() && ai.order_number) numberI.value = ai.order_number;
          return { rows: ai.lines.map(function (l) {
            var p = l.product_id ? inv().prod(l.product_id) : null;
            return { label: l.label, productId: p ? String(p.id) : '', kind: p ? inv().fitKind(p, l.kind) : kindOf(l.kind),
              qty: l.qty, unitCost: l.unit_cost, how: p ? 'ia' : 'aucun', picked: false };
          }), ai: ai };
        }
        // lignes non reconnues : une réponse IA par ligne, dans le même ordre
        unknown.forEach(function (r, i) {
          var l = ai.lines[i], p = l && l.product_id ? inv().prod(l.product_id) : null;
          if (p) { r.productId = String(p.id); r.kind = inv().fitKind(p, r.kind); r.how = 'ia'; }
        });
        return { rows: found, ai: ai };
      });
    }).then(function (res) {
      parseBtn.disabled = false;
      // garde les lignes ajoutées à la main, remplace ce qui avait été lu
      rows = rows.filter(function (r) { return r.how === 'saisi'; }).concat(res.rows);
      if (taxI && !taxI.dataset.touched) taxI.value = fmtTax(taxDefault(supplierOf(rows)));
      renderRows();
      var miss = rows.filter(function (r) { return !r.productId && r.how !== 'hors'; }).length;
      var off = rows.filter(function (r) { return !r.productId && r.how === 'hors'; }).length;
      var aiMsg = !res.ai ? '' : (res.ai.error === 'no_key' ? ' · lecture IA pas encore activée'
        : res.ai.error ? ' · lecture IA indisponible' : '');
      statusEl.textContent = !rows.length ? 'Rien reconnu' + aiMsg + '.'
        : rows.length + ' ligne' + (rows.length > 1 ? 's' : '') + (miss ? ' · ' + miss + ' à choisir' : ' · tout reconnu') +
          (off ? ' · ' + off + ' hors catalogue' : '') + aiMsg;
    }, function (err) {
      parseBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }

  function askAI(text, onlyLines) {
    if (!sb.functions || !sb.functions.invoke) return Promise.resolve({ error: 'indisponible' });
    var body = { text: text };
    if (onlyLines) body.lines = onlyLines;
    return sb.functions.invoke('order-parse', { body: body }).then(function (res) {
      if (res.error) {
        var ctx = res.error.context;
        if (ctx && typeof ctx.json === 'function') {
          return ctx.json().then(function (j) { return { error: (j && j.error) || 'erreur' }; }, function () { return { error: 'erreur' }; });
        }
        return { error: 'erreur' };
      }
      var d = res.data || {};
      return { lines: Array.isArray(d.lines) ? d.lines : [], order_number: d.order_number || null };
    }, function () { return { error: 'erreur' }; });
  }

  // menu Article groupé par marque : la valeur affichée reste courte (« PLA Basic · Black »)
  function options(selected) {
    function opt(p, txt) { return '<option value="' + esc(p.id) + '"' + (String(p.id) === String(selected) ? ' selected' : '') + '>' + esc(txt) + '</option>'; }
    var groups = [], by = {};
    inv().filaments().forEach(function (f) {
      var b = f.brand || 'Autres';
      if (!by[b]) { by[b] = []; groups.push(b); }
      by[b].push(opt(f, (f.material ? f.material + ' · ' : '') + (f.name || '(sans nom)')));
    });
    var acc = inv().accessories();
    return '<option value="">— choisir —</option>' +
      groups.map(function (b) { return '<optgroup label="' + esc(b) + '">' + by[b].join('') + '</optgroup>'; }).join('') +
      (acc.length ? '<optgroup label="Accessoires">' + acc.map(function (a) { return opt(a, inv().label(a)); }).join('') + '</optgroup>' : '');
  }

  var HOW = { code: ['ok', 'Reconnu'], nom: ['ok', 'Reconnu'], appris: ['ok', 'Appris'], proche: ['ia', 'Nom proche'], ia: ['ia', 'IA'],
    aucun: ['miss', 'À choisir'], hors: ['off', 'Hors catalogue'] };
  function renderRows() {
    reviewEl.hidden = false;
    if (!rows.length) { rowsEl.innerHTML = '<tr><td colspan="6" class="po-empty">Aucune ligne.</td></tr>'; renderSum(); return; }
    rowsEl.innerHTML = rows.map(function (r, i) {
      var p = r.productId ? inv().prod(r.productId) : null, acc = p && inv().isAcc(p);
      var hasS = !p || acc || inv().offersSpool(p), hasR = !p || acc || inv().offersRefill(p);
      var how = r.picked ? null : HOW[r.how];
      var ref = p ? inv().cost(p, r.kind) : null;
      return '<tr class="po-row' + (r.productId ? '' : ' unmatched') + (how ? ' is-' + how[0] : '') + '" data-i="' + i + '">' +
        '<td class="po-read"><div class="po-read-in">' +
          (r.label ? '<span class="po-lbl">' + esc(r.label) + '</span>' : '<span class="muted">—</span>') +
          (how ? '<span class="po-how">' + how[1] + '</span>' : '') + '</div></td>' +
        '<td class="rcp-fil"><select class="po-fil" aria-label="Article">' + options(r.productId) + '</select></td>' +
        '<td>' + (acc ? '<span class="rcp-kind-item">Article</span>'
          : '<select class="rcp-kind po-kind" aria-label="Format">' +
            '<option value="spool"' + (r.kind !== 'refill' ? ' selected' : '') + (hasS ? '' : ' disabled') + '>Avec bobine</option>' +
            '<option value="refill"' + (r.kind === 'refill' ? ' selected' : '') + (hasR ? '' : ' disabled') + '>Recharge</option>' +
          '</select>') + '</td>' +
        '<td class="num"><input type="number" class="rcp-qty num po-qty" min="0" step="1" value="' + (r.qty || 0) + '" aria-label="Quantité"></td>' +
        '<td class="num"><input type="number" class="rcp-price num po-price" min="0" step="0.01" value="' + (r.unitCost != null ? (+r.unitCost).toFixed(2) : '') + '"' +
          ' placeholder="' + (ref != null ? ref.toFixed(2) : '') + '" aria-label="Prix payé par unité"></td>' +
        '<td><button type="button" class="rcp-row-del po-del" aria-label="Retirer">✕</button></td>' +
      '</tr>';
    }).join('');
    $$('.po-row', rowsEl).forEach(function (tr) {
      var i = +tr.getAttribute('data-i'), r = rows[i];
      $('.po-fil', tr).addEventListener('change', function () {
        r.productId = this.value; r.picked = true;
        var p = inv().prod(this.value);
        if (p) r.kind = inv().fitKind(p, r.kind);
        renderRows();
      });
      var k = $('.po-kind', tr);
      if (k) k.addEventListener('change', function () { r.kind = this.value; renderRows(); });
      $('.po-qty', tr).addEventListener('input', function () { r.qty = Math.max(0, parseInt(this.value, 10) || 0); renderSum(); });
      $('.po-price', tr).addEventListener('input', function () { r.unitCost = this.value === '' ? null : Math.max(0, parseFloat(this.value) || 0); renderSum(); });
      $('.po-del', tr).addEventListener('click', function () { rows.splice(i, 1); renderRows(); });
    });
    renderSum();
  }
  function renderSum() {
    var n = 0, tot = 0, priced = false;
    rows.forEach(function (r) { if (r.productId && r.qty > 0) { n += r.qty; if (r.unitCost != null) { tot += r.unitCost * r.qty; priced = true; } } });
    var tx = taxVal();
    sumEl.innerHTML = n ? n + ' article' + (n > 1 ? 's' : '') +
      (priced ? ' · <b>' + money(tot * (1 + tx / 100)) + '</b>' + (tx ? ' taxes incl.' : '') : '') : '';
  }

  saveBtn.addEventListener('click', function () { save(false); });
  function save(skipAsk) {
    var valid = rows.filter(function (r) { return r.productId && r.qty > 0; });
    if (!valid.length) { statusEl.textContent = 'Choisis au moins un article.'; return; }
    var num = numberI.value.trim().replace(/^#/, '') || null;
    if (!skipAsk) {
      var orphan = rows.filter(function (r) { return !r.productId && r.qty > 0 && r.how !== 'hors'; }).length;   // hors catalogue : ignoré sans demander
      var dupCheck = (num && !editingId)
        ? Promise.all([
            sb.from('supplier_orders').select('id').ilike('order_number', num),
            sb.from('receipts').select('id').ilike('order_number', num)
          ]).then(function (r) { return { po: (r[0].data || []).length, rc: (r[1].data || []).length }; }, function () { return { po: 0, rc: 0 }; })
        : Promise.resolve({ po: 0, rc: 0 });
      dupCheck.then(function (d) {
        var msgs = [];
        if (d.po) msgs.push('Cette commande est déjà enregistrée.');
        if (d.rc) msgs.push('Une réception porte déjà ce n° : elle est peut-être déjà arrivée.');
        if (orphan) msgs.push(orphan + ' ligne' + (orphan > 1 ? 's' : '') + ' sans article ' + (orphan > 1 ? 'seront ignorées' : 'sera ignorée') + '.');
        if (!msgs.length) return save(true);
        caDialog.confirm({ title: 'Enregistrer quand même ?', message: msgs.join(' '), ok: 'Enregistrer' })
          .then(function (ok) { if (ok) save(true); });
      });
      return;
    }

    var date = /^\d{4}-\d{2}-\d{2}$/.test(dateI.value.trim()) ? dateI.value.trim() : todayISO();
    // fournisseur = marque la plus présente parmi les articles
    var brands = {};
    valid.forEach(function (r) { var p = inv().prod(r.productId); var b = p && p.brand; if (b) brands[b] = (brands[b] || 0) + r.qty; });
    var supplier = Object.keys(brands).sort(function (a, z) { return brands[z] - brands[a]; })[0] || null;
    var received = Object.assign({}, editingReceived);
    var linesFor = function (orderId) {
      return valid.map(function (r) {
        var p = inv().prod(r.productId), kind = inv().fitKind(p, r.kind), k = r.productId + '|' + kind;
        var got = Math.min(received[k] || 0, r.qty); received[k] = (received[k] || 0) - got;   // reçu conservé à la modification
        return { order_id: orderId, product_id: r.productId, label: r.label || (p ? inv().label(p) : null), kind: kind,
          qty: r.qty, qty_received: got, unit_cost: r.unitCost != null ? round2(r.unitCost) : null };
      });
    };
    // corrections retenues pour la prochaine fois (choix à la main ou lecture IA validée)
    var learn = {};
    valid.forEach(function (r) {
      if (r.label && (r.picked || r.how === 'ia')) learn[norm(r.label)] = { pid: r.productId };
    });

    saveBtn.disabled = true; statusEl.textContent = 'Enregistrement…';
    var tax = taxVal();
    if (supplier && Math.abs(tax - taxDefault(supplier)) > 0.0005) {   // nouvelle taxe pour ce fournisseur : retenue
      taxes = Object.assign({}, taxes || {}); taxes[supplier] = tax;
      sb.from('admin_settings').upsert({ key: 'taxes_fournisseur', value: taxes, updated_at: new Date().toISOString() }).then(function () {}, function () {});
    }
    var head = { order_number: num, supplier: supplier, ordered_at: date, tax_rate: tax };
    var chain = editingId
      ? sb.from('supplier_orders').update(head).eq('id', editingId).select().then(function (res) {
          if (res.error || !res.data || !res.data.length) throw (res.error || new Error('Modification refusée (permissions).'));
          return sb.from('supplier_order_lines').delete().eq('order_id', editingId).then(function (r) { if (r.error) throw r.error; return editingId; });
        })
      : sb.from('supplier_orders').insert(Object.assign({ status: 'open' }, head)).select().then(function (res) {
          if (res.error || !res.data || !res.data.length) throw (res.error || new Error('Enregistrement refusé (permissions).'));
          return res.data[0].id;
        });
    chain.then(function (id) {
      return sb.from('supplier_order_lines').insert(linesFor(id)).then(function (r) { if (r.error) throw r.error; return syncStatus([id]); });
    }).then(function () { return saveAliases(learn); }).then(function () {
      saveBtn.disabled = false;
      closeEditor();
      return load();
    }, function (err) {
      saveBtn.disabled = false;
      statusEl.textContent = 'Erreur : ' + (err && err.message ? err.message : err);
    });
  }

  /* =========================================================
     LISTE DES COMMANDES EN ROUTE
     ========================================================= */
  function kindTxt(k) { return k === 'refill' ? 'recharge' : (k === 'item' ? 'article' : 'bobine'); }
  function renderList(err) {
    if (!listEl) return;
    var units = 0;
    orders.forEach(function (o) { o.lines.forEach(function (l) { units += remaining(l); }); });
    totalEl.textContent = units ? units + ' article' + (units > 1 ? 's' : '') : '';
    totalEl.hidden = !units;
    if (err) { listEl.innerHTML = '<p class="empty">Impossible de charger les commandes.</p>'; return; }
    if (!orders.length) { listEl.innerHTML = '<p class="po-none">Aucune commande en route.</p>'; return; }
    listEl.innerHTML = orders.map(function (o) {
      var tot = 0, got = 0;
      o.lines.forEach(function (l) { tot += l.qty | 0; got += Math.min(l.qty | 0, l.qty_received | 0); });
      var lis = o.lines.filter(remaining).map(function (l) {
        var p = l.product_id && inv() ? inv().prod(l.product_id) : null;
        var name = p ? ((p.material ? p.material + ' · ' : '') + (p.name || '')) : (l.label || '(article retiré)');
        return '<li><span>' + esc(name) + ' <span class="ro-code">' + kindTxt(kindOf(l.kind)) + '</span></span>' +
          '<span class="ro-q">×' + remaining(l) + '</span></li>';
      }).join('');
      return '<div class="po-order" data-id="' + esc(o.id) + '">' +
        '<div class="po-order-head">' +
          '<button type="button" class="po-toggle" aria-expanded="false">' +
            '<span class="po-num">' + esc(o.order_number || 'Sans n°') + '</span>' +
            '<span class="po-meta">' + esc([o.supplier, o.ordered_at].filter(Boolean).join(' · ')) + '</span>' +
            '<span class="po-prog">' + (got ? got + ' / ' + tot + ' reçus' : tot + ' article' + (tot > 1 ? 's' : '')) + '</span>' +
          '</button>' +
          '<span class="po-acts">' +
            '<button class="btn btn-ghost btn-sm po-recv" type="button" data-ic="receipt">Recevoir</button>' +
            '<button class="btn btn-ghost btn-sm po-edit" type="button" data-ic="edit">Modifier</button>' +
            '<button class="btn btn-ghost btn-sm po-rm" type="button" data-ic="trash" aria-label="Supprimer la commande" title="Supprimer"></button>' +
          '</span>' +
        '</div>' +
        '<ul class="reorder-list po-lines" hidden>' + lis + '</ul>' +
      '</div>';
    }).join('');
    $$('.po-order', listEl).forEach(function (el) {
      var o = orders.filter(function (x) { return String(x.id) === el.getAttribute('data-id'); })[0];
      var tg = $('.po-toggle', el), ul = $('.po-lines', el);
      tg.addEventListener('click', function () {
        ul.hidden = !ul.hidden; tg.setAttribute('aria-expanded', String(!ul.hidden)); el.classList.toggle('open', !ul.hidden);
      });
      $('.po-recv', el).addEventListener('click', function () {
        inv().receiveOrder(o.id);
      });
      $('.po-edit', el).addEventListener('click', function () {
        inv().ready().then(function () { openEditor(o); card.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      });
      $('.po-rm', el).addEventListener('click', function () {
        caDialog.confirm({ title: 'Supprimer la commande ' + (o.order_number || 'sans n°') + ' ?',
          message: 'Ses articles ne seront plus comptés en route.', ok: 'Supprimer', danger: true, icon: 'trash' }).then(function (ok) {
          if (!ok) return;
          sb.from('supplier_orders').delete().eq('id', o.id).select().then(function (res) {
            if (res.error || !res.data || !res.data.length) { caDialog.error(res.error || 'Suppression refusée (permissions).'); return; }
            load();
          });
        });
      });
    });
  }

  /* ---- chargement : à chaque ouverture de l'Inventaire (une réception a pu fermer une commande) ---- */
  var prevOnTab = window.CA.onTab;
  window.CA.onTab = function (name) {
    if (typeof prevOnTab === 'function') prevOnTab(name);
    if (name === 'inventaire' && !loading) load();
  };
})();
