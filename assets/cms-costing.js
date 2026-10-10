/* =========================================================
   Création Audio V2 — Coût moyen pondéré (CMP)
   Math pure utilisée par l'Inventaire (coût moyen stocké sur
   products.attrs.avg_cost).

   Modèle : « moyenne pondérée périodique ». Le coût moyen d'un
   produit = Σ(qté × prix payé) / Σ(qté) sur ses réceptions.
   Chaque réception porte le prix réellement payé (taxes incluses,
   repris de la commande en route) : plus de prix catalogue éditable.
   Aucune dépendance à Supabase ici — que du calcul.

   Expose window.CA.costing :
     - avg(lines, fallback)  -> moyenne pondérée (ou null)
     - costOf(p, kind, list) -> coût d'un filament (CMP, sinon moyenne de la matière)
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

  // Moyenne (simple) des coûts moyens des autres couleurs de la même marque + matière :
  // sert pour une couleur jamais reçue (ex. nouvelle couleur Elegoo PLA Basic).
  function materialAvg(list, brand, material, kind) {
    var vals = (list || []).map(function (p) {
      if (p.brand !== brand || p.material !== material) return null;
      var ac = p.attrs && p.attrs.avg_cost;
      return ac ? num(kind === 'refill' ? ac.refill : ac.spool) : null;
    }).filter(function (v) { return v != null; });
    if (!vals.length) return null;
    return round2(vals.reduce(function (s, v) { return s + v; }, 0) / vals.length);
  }

  // Coût d'un filament pour un format : coût moyen de SES réceptions, sinon moyenne de la même
  // matière, sinon l'ancien prix catalogue du matériau (figé, plus éditable), sinon null.
  function costOf(p, kind, list) {
    if (!p) return null;
    var ac = p.attrs && p.attrs.avg_cost;
    var own = ac ? num(kind === 'refill' ? ac.refill : ac.spool) : null;
    if (own != null) return own;
    var mat = materialAvg(list, p.brand, p.material, kind);
    if (mat != null) return mat;
    var m = window.CA.materialOf ? window.CA.materialOf(p.brand, p.material) : null;
    return m ? num(kind === 'refill' ? m.cost_refill : m.cost_spool) : null;
  }

  window.CA.costing = { avg: avg, round2: round2, costOf: costOf, materialAvg: materialAvg };
})();
