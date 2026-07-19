/* =========================================================
   Création Audio — inventaire filament
   =========================================================
   Source du stock (par ordre de priorité) :
     1) Supabase (table « inventory ») — modifiable dans le
        panneau admin du site, visible en direct par tous.
     2) Fichier local « assets/inventory.csv » (repli).
     3) Repli intégré ci-dessous (si tout le reste échoue).

   Deux stocks par filament : qty (recharges/refills) et
   qty_spool (avec bobine). Affichage sur la carte :
     total > 0 → point VERT + « N disponibles (refills) »
                 et, si bobine > 0, « M disponibles (avec bobine) »
     total = 0 → point ROUGE + « Rupture de stock » (bouton désactivé)
   ========================================================= */
(function () {
  'use strict';

  var LOCAL_CSV = 'assets/inventory.csv';

  /* Repli intégré (si aucun CSV n'est joignable, ex. ouverture en file://) */
  var FALLBACK = {
    "10100": 6, "10101": 12, "10102": 0, "10103": 8, "10104": 5, "10105": 3,
    "10200": 10, "10201": 0, "10202": 4, "10203": 7, "10204": 2, "10205": 1,
    "10300": 9, "10301": 0, "10400": 6, "10401": 3, "10402": 5,
    "10501": 8, "10502": 4, "10503": 0, "10601": 7, "10602": 2, "10603": 5,
    "10604": 1, "10605": 6, "10700": 4, "10701": 0, "10800": 3, "10801": 2, "10802": 5
  };

  /* ---- CSV → lignes/colonnes (gère les guillemets et virgules internes) ---- */
  function parseRows(text) {
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') { inQ = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') { field += c; }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function norm(s) {
    return (s == null ? '' : String(s)).trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /* ---- lignes → { code: quantité } ---- */
  function rowsToMap(rows) {
    var map = {};
    if (!rows.length) return map;

    var header = rows[0].map(norm);
    var codeIdx = header.indexOf('code');
    var qtyIdx = header.findIndex(function (h) {
      return /(^|_| )(qty|quantite|stock|dispo|disponible|inventaire)/.test(h);
    });
    var hasHeader = codeIdx > -1 || qtyIdx > -1;
    var start = hasHeader ? 1 : 0;
    if (codeIdx < 0) codeIdx = 0;                    // repli positionnel
    if (qtyIdx < 0) qtyIdx = rows[0].length > 2 ? 2 : 1;

    for (var r = start; r < rows.length; r++) {
      var cols = rows[r]; if (!cols) continue;
      var code = (cols[codeIdx] || '').trim();
      if (!/^\d+$/.test(code)) continue;
      var q = parseInt(String(cols[qtyIdx] || '').replace(/[^\d-]/g, ''), 10);
      map[code] = isNaN(q) ? 0 : q;
    }
    return map;
  }

  /* ---- normalise une valeur de stock en { refill, spool } ----
     Supabase renvoie déjà un objet ; le CSV / le repli renvoient un
     nombre simple → interprété comme des recharges (bobine = 0). */
  function toDetail(v) {
    if (v && typeof v === 'object') return { refill: v.refill | 0, spool: v.spool | 0 };
    var n = parseInt(v, 10); return { refill: isNaN(n) ? 0 : n, spool: 0 };
  }

  /* ---- application au catalogue ---- */
  function applyStock(rawMap) {
    var detail = {}, totalMap = {};
    Object.keys(rawMap || {}).forEach(function (code) {
      var d = toDetail(rawMap[code]);
      detail[code] = d;
      totalMap[code] = d.refill + d.spool;
    });

    // partagé pour le panier : plafond = total disponible (refills + avec bobine)
    window.CA = window.CA || {};
    window.CA.stock = totalMap;        // { code: nombre } — utilisé par cart.js
    window.CA.stockDetail = detail;    // { code: {refill, spool} } — pour l'affichage

    document.querySelectorAll('.add-cart').forEach(function (btn) {
      var code = btn.getAttribute('data-code');
      var row = btn.closest('.fila-row');
      var body = btn.closest('.fila-body');
      if (!row || !body) return;

      var d = detail.hasOwnProperty(code) ? detail[code] : null;
      var total = d ? d.refill + d.spool : null;
      var inStock = total === null ? true : total > 0;

      var ind = body.querySelector('.fila-stock');
      if (!ind) { ind = document.createElement('div'); ind.className = 'fila-stock'; }
      body.appendChild(ind); // placé en BAS de la carte (sous « Ajouter »)

      var lines;
      if (d === null) lines = ['Disponible'];
      else if (total <= 0) lines = ['Rupture de stock'];
      else {
        lines = [];
        if (d.refill > 0) lines.push(d.refill + ' disponible' + (d.refill > 1 ? 's' : '') + ' <span class="stk-kind">(refills)</span>');
        if (d.spool > 0) lines.push(d.spool + ' disponible' + (d.spool > 1 ? 's' : '') + ' <span class="stk-kind">(avec bobine)</span>');
      }
      ind.className = 'fila-stock ' + (inStock ? 'in' : 'out');
      ind.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="stk-txt">' + lines.join('<br>') + '</span>';

      if (inStock) {
        btn.disabled = false; btn.classList.remove('is-oos'); btn.removeAttribute('aria-disabled');
      } else {
        btn.disabled = true; btn.classList.add('is-oos'); btn.setAttribute('aria-disabled', 'true');
      }
    });
    document.dispatchEvent(new CustomEvent('inventory-ready'));
  }

  /* ---- chargement : Supabase → CSV local → repli intégré ---- */
  function fetchCsv(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) { return rowsToMap(parseRows(t)); });
  }

  function fromSupabase() {
    var sb = window.CA && window.CA.sb;
    if (!sb) return Promise.reject(new Error('no-supabase'));
    // On tente d'abord de lire les deux stocks (recharges + avec bobine).
    // Si la colonne qty_spool n'existe pas encore (migration pas faite),
    // on retombe proprement sur qty seul.
    return sb.from('inventory').select('code,qty,qty_spool').then(function (res) {
      if (res.error) {
        return sb.from('inventory').select('code,qty').then(function (r2) {
          if (r2.error || !r2.data) throw (r2.error || new Error('no-data'));
          var m = {};
          r2.data.forEach(function (r) { m[String(r.code)] = { refill: r.qty | 0, spool: 0 }; });
          return m;
        });
      }
      if (!res.data) throw new Error('no-data');
      var map = {};
      res.data.forEach(function (r) { map[String(r.code)] = { refill: r.qty | 0, spool: r.qty_spool | 0 }; });
      return map;
    });
  }

  fromSupabase()
    .catch(function () { return fetchCsv(LOCAL_CSV); })
    .then(function (map) { applyStock(map); })
    .catch(function () { applyStock(FALLBACK); });

  // rafraîchit le stock en direct si l'admin le modifie (Realtime)
  document.addEventListener('inventory-refresh', function () {
    fromSupabase().then(applyStock).catch(function () {});
  });
})();
