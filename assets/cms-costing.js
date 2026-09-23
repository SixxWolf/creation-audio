/* =========================================================
   Création Audio V2 — Coût moyen pondéré (CMP)
   Math pure utilisée par l'Inventaire (coût moyen stocké sur
   products.attrs.avg_cost).

   Modèle : « moyenne pondérée périodique ». Le coût moyen d'un
   produit = Σ(qté × prix payé) / Σ(qté) sur ses réceptions.
   Une ligne de réception sans prix saisi retombe sur un coût de
   repli (prix catalogue du matériau) jusqu'à ce qu'on entre le
   vrai prix. Aucune dépendance à Supabase ici — que du calcul.

   Expose window.CA.costing :
     - avg(lines, fallback)  -> moyenne pondérée (ou null)
   « lines » = [{ qty, unit_cost }].
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

  window.CA.costing = { avg: avg, round2: round2 };
})();
