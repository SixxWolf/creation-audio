/* =========================================================
   Création Audio — modèle de prix par matériau + dispo recharge
   Source de vérité des prix (recharge / avec bobine) et de la
   disponibilité de la recharge (refill) par matériau/couleur.
   À charger APRÈS assets/catalog.js.
   ========================================================= */
window.CA_PRICING = {
  // Recharge (refill) + Avec Bobine (spool). refillAll:true = toutes les
  // couleurs en recharge ; refillCodes = seules ces couleurs le sont ;
  // pas de champ refill = matériau « avec bobine seulement ».
  'PLA Basic':            { spool: 25, refill: 20, refillAll: true },
  'PLA Matte':            { spool: 25, refill: 20, refillAll: true },
  'PETG Basic':           { spool: 25, refill: 20, refillAll: true },
  'ABS':                  { spool: 25, refill: 20, refillAll: true },
  'PLA Silk+':            { spool: 25, refill: 20, refillCodes: ['13405', '13108', '13109', '13110'] },
  'PLA Tough+':           { spool: 40, refill: 35, refillCodes: ['12107', '12105', '12104'] },
  'PLA-CF':               { spool: 55, refill: 50, refillCodes: ['14100', '14101'] },
  'PETG Translucent':     { spool: 25, refill: 20, refillCodes: ['32600', '32501', '32101'] },
  'PLA Translucent':      { spool: 25 },
  'PLA Silk Multi-Color': { spool: 40 },
  'PLA Wood':             { spool: 40 },
  'PLA Galaxy':           { spool: 40 },
  'PLA Glow':             { spool: 40 },
  'PLA Sparkle':          { spool: 40 },
  'PLA Basic Gradient':   { spool: 40 },
  'PLA Marble':           { spool: 40 },
  'PLA Metal':            { spool: 40 }
};

window.CA_PRICE = {
  cfg: function (mat) { return window.CA_PRICING[mat] || null; },
  spoolPrice: function (mat) { var p = this.cfg(mat); return p ? p.spool : 25; },
  refillPrice: function (mat) { var p = this.cfg(mat); return p && p.refill != null ? p.refill : null; },
  // le matériau propose-t-il la recharge pour au moins une couleur ?
  hasRefill: function (mat) { var p = this.cfg(mat); return !!(p && p.refill != null); },
  // cette couleur précise est-elle dispo en recharge ?
  refillAvailable: function (mat, code) {
    var p = this.cfg(mat);
    if (!p || p.refill == null) return false;
    if (p.refillAll) return true;
    return !!(p.refillCodes && p.refillCodes.indexOf(String(code)) > -1);
  },
  // prix pour un (matériau, code, type) ; null si recharge non dispo pour cette couleur
  priceOf: function (mat, code, type) {
    if (type === 'spool') return this.spoolPrice(mat);
    return this.refillAvailable(mat, code) ? this.refillPrice(mat) : null;
  }
};
