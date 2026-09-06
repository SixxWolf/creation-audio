/* =========================================================
   Création Audio V2 — Coût moyen pondéré (CMP)
   Math pure, partagée par l'Inventaire (coût moyen stocké sur
   products.attrs.avg_cost) et les Statistiques (recalcul
   rétroactif des marges à la date de la vente).

   Modèle : « moyenne pondérée périodique ». Le coût moyen d'un
   produit = Σ(qté × prix payé) / Σ(qté) sur ses réceptions.
   Une ligne de réception sans prix saisi retombe sur un coût de
   repli (prix catalogue du matériau) jusqu'à ce qu'on entre le
   vrai prix. Aucune dépendance à Supabase ici — que du calcul.

   Expose window.CA.costing :
     - avg(lines, fallback)         -> moyenne pondérée (ou null)
     - avgUpTo(lines, dateISO, fb)  -> idem, réceptions <= date
   « lines » = [{ qty, unit_cost, received_at? }].
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';

  function num(v) {
    if (v == null || v === '') return null;
    var n = +v; return isFinite(n) ? n : null;
  }
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }

  // Moyenne pondérée des unités reçues.
  //   lines    : [{ qty, unit_cost }]
  //   fallback : coût utilisé quand unit_cost est absent (ou null)
  // Renvoie un nombre, ou null si aucune donnée de coût exploitable.
  function avg(lines, fallback) {
    var totQ = 0, totC = 0, any = false;
    var fb = num(fallback);
    (lines || []).forEach(function (l) {
      var q = +l.qty || 0;
      if (q <= 0) return;
      var c = num(l.unit_cost);
      if (c == null) c = fb;
      if (c == null) return;            // aucun coût connu pour cette ligne -> ignorée
      totQ += q; totC += q * c; any = true;
    });
    if (!any || totQ <= 0) return null;
    return round2(totC / totQ);
  }

  // Moyenne pondérée en ne gardant que les réceptions à la date <= dateISO
  // (voyage dans le temps : « coût moyen tel qu'il était ce jour-là »).
  function avgUpTo(lines, dateISO, fallback) {
    var d = dateISO || '9999-12-31';
    var kept = (lines || []).filter(function (l) {
      return String(l.received_at || '') <= d;
    });
    return avg(kept, fallback);
  }

  window.CA.costing = { avg: avg, avgUpTo: avgUpTo, round2: round2 };
})();
