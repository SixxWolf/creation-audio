/* =========================================================
   Création Audio V2 — Écran client (caisse en direct)
   Lit la ligne pos_display (clé anonyme) et affiche le panier
   en cours poussé par l'admin (facturation). Realtime Supabase
   avec repli par sondage. Aucune donnée sensible (ni coût, ni
   coordonnées client) n'est exposée ici.
   ========================================================= */
(function () {
  'use strict';

  var sb = window.CA && window.CA.sb;
  var root = document.getElementById('caisse');
  var POS_ID = (function () {
    try { return new URLSearchParams(location.search).get('reg') || 'main'; } catch (e) { return 'main'; }
  })();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Number(n) || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' }); }
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }

  var lastTs = 0, everRendered = false;

  function header(co) {
    return '<header class="ca-head">' +
      (co && co.logo ? '<img class="ca-logo" src="' + esc(co.logo) + '" alt="">' : '') +
      '<div class="ca-brand">' +
        '<div class="ca-name">' + esc((co && co.name) || 'Création Audio') + '</div>' +
        (co && co.tagline ? '<div class="ca-tag">' + esc(co.tagline) + '</div>' : '') +
      '</div>' +
    '</header>';
  }

  function renderIdle(p) {
    var co = (p && p.co) || {};
    root.className = 'caisse is-idle';
    root.innerHTML = header(co) +
      '<div class="ca-center">' +
        (co.logo ? '<img class="ca-idle-logo" src="' + esc(co.logo) + '" alt="">' : '') +
        '<h1 class="ca-idle-title">Bienvenue&nbsp;!</h1>' +
        '<p class="ca-idle-sub">En attente de votre commande…</p>' +
      '</div>';
  }

  function renderThanks(p) {
    var co = (p && p.co) || {};
    root.className = 'caisse is-thanks';
    root.innerHTML = header(co) +
      '<div class="ca-center">' +
        '<div class="ca-check">✓</div>' +
        '<h1 class="ca-idle-title">Merci&nbsp;!</h1>' +
        '<p class="ca-thanks-total">' + money(p && p.total) + '</p>' +
        '<p class="ca-idle-sub">Au plaisir de vous revoir.</p>' +
      '</div>';
  }

  function renderActive(p) {
    var co = p.co || {};
    var items = (p.items || []);
    var rows = items.map(function (it) {
      return '<li class="ca-item">' +
        '<span class="ca-sw"' + (isHex(it.hex) ? ' style="background:' + esc(it.hex) + '"' : ' data-empty="1"') + '></span>' +
        '<span class="ca-it-main">' +
          '<span class="ca-it-name">' + esc(it.label || '(article)') + '</span>' +
          (it.meta ? '<span class="ca-it-meta">' + esc(it.meta) + '</span>' : '') +
        '</span>' +
        '<span class="ca-it-qty">' + (it.qty || 0) + ' ×</span>' +
        '<span class="ca-it-price">' + money(it.price) + '</span>' +
        '<span class="ca-it-total">' + money(it.total) + '</span>' +
      '</li>';
    }).join('');

    var taxes = '';
    if (p.tax_enabled) {
      taxes =
        '<div class="ca-line"><span>TPS (' + (p.gst_rate || 0) + ' %)</span><span>' + money(p.gst) + '</span></div>' +
        '<div class="ca-line"><span>TVQ (' + (p.qst_rate || 0) + ' %)</span><span>' + money(p.qst) + '</span></div>';
    }
    var count = items.reduce(function (s, it) { return s + (it.qty || 0); }, 0);

    root.className = 'caisse is-active';
    root.innerHTML = header(co) +
      '<div class="ca-cart">' +
        '<div class="ca-cart-head"><span>Votre commande</span>' +
          '<span class="ca-count">' + count + ' article' + (count > 1 ? 's' : '') + '</span></div>' +
        '<ul class="ca-items">' + rows + '</ul>' +
      '</div>' +
      '<footer class="ca-foot">' +
        '<div class="ca-line"><span>Sous-total</span><span>' + money(p.subtotal) + '</span></div>' +
        taxes +
        '<div class="ca-line ca-grand"><span>Total</span><span>' + money(p.total) + '</span></div>' +
      '</footer>';

    // garde la dernière ligne visible quand la liste déborde
    var ul = root.querySelector('.ca-items');
    if (ul) ul.scrollTop = ul.scrollHeight;
  }

  function render(payload) {
    var p = payload || {};
    if (p.ts && p.ts < lastTs) return;         // ignore un message plus vieux
    if (p.ts) lastTs = p.ts;
    everRendered = true;
    var status = p.status || (p.items && p.items.length ? 'active' : 'idle');
    if (status === 'thanks') return renderThanks(p);
    if (status === 'active' && p.items && p.items.length) return renderActive(p);
    return renderIdle(p);
  }

  function fetchOnce() {
    if (!sb) return;
    sb.from('pos_display').select('payload').eq('id', POS_ID).maybeSingle()
      .then(function (res) {
        if (res && res.error) { if (!everRendered) renderIdle({}); return; }   // table absente → accueil
        render((res && res.data && res.data.payload) || { status: 'idle' });
      }, function () { if (!everRendered) renderIdle({}); });
  }

  if (!sb) {
    root.className = 'caisse is-idle';
    root.innerHTML = '<div class="ca-center"><h1 class="ca-idle-title">Caisse hors ligne</h1>' +
      '<p class="ca-idle-sub">Configuration Supabase manquante.</p></div>';
    return;
  }

  fetchOnce();
  // Realtime (si la table est dans la publication supabase_realtime)
  try {
    sb.channel('pos_' + POS_ID)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_display', filter: 'id=eq.' + POS_ID },
        function (msg) { render((msg && msg.new && msg.new.payload) || {}); })
      .subscribe();
  } catch (e) {}
  // Repli : sondage régulier (au cas où le realtime n'est pas activé)
  setInterval(fetchOnce, 2500);
})();
