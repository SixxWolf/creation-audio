/* =========================================================
   Création Audio — commande en ligne d'un client connecté
   Partagé par la boutique (boutique.js) et la page spacers (spacers.js).
   La session du client vit sous « ca-compte-auth » (posée par compte.html) :
   ce module crée, seulement au besoin, un client Supabase sur cette clé.
   CA.custOrder :
     signedIn() · email()
     editing()    -> { id, number, at } | null  (commande en modification, posée par compte.html ;
                     oubliée après 6 h pour ne jamais modifier une vieille commande par erreur)
     cancelEdit()
     send(lines, note) -> Promise({ id, number, has_backorder, total, updated })
                     lignes = [{ product_id, kind ('spool'|'refill'|'unit'), qty }] ; prix recalculés par le serveur
     reserveInfo()     -> Promise({ can, suspendedUntil } | null)  (réservations, étape 3 ; lu une fois par page)
     reserve(lines, note) -> Promise({ id, number, total, expires_at })  (72 h, articles en stock seulement)
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';
  var KEY = 'ca-compte-auth', EDIT = 'ca_v2_order_edit', EDIT_TTL = 6 * 3600 * 1000;
  var cfg = window.CA_SUPABASE || {}, client = null;

  function session() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function email() { var s = session(); return (s && s.user && s.user.email) || ''; }
  function cli() {
    if (!client && window.supabase && window.supabase.createClient && cfg.url) {
      client = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { storageKey: KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
    return client;
  }
  function cancelEdit() { try { localStorage.removeItem(EDIT); } catch (e) {} }
  function editing() {
    var e = null;
    try { e = JSON.parse(localStorage.getItem(EDIT) || 'null'); } catch (x) {}
    if (!e || !e.id) return null;
    if (!e.at || Date.now() - e.at > EDIT_TTL || !email()) { cancelEdit(); return null; }
    return e;
  }
  function errMsg(err) {
    var m = (err && err.message) || '', c = String((err && (err.code || err.status)) || '');
    if (/^(401|403|42501|PGRST301)$/.test(c) || /jwt|token/i.test(m)) return 'Ta session a expiré : reconnecte-toi dans Mon compte.';
    return m || 'Envoi impossible pour le moment. Réessaie.';
  }

  function send(lines, note) {
    var c = cli();
    if (!c) return Promise.reject(new Error('Service indisponible pour le moment.'));
    var ed = editing();
    var call = ed
      ? c.rpc('customer_update_order', { p_id: ed.id, p_lines: lines, p_note: note || null })
      : c.rpc('customer_submit_order', { p_lines: lines, p_note: note || null });
    return call.then(function (res) {
      if (res.error) throw new Error(errMsg(res.error));
      var r = res.data || {};
      if (ed) cancelEdit();
      // courriels (confirmation au client + avis à Création Audio) : sans bloquer l'écran
      c.functions.invoke('customer-order-notify', { body: { order_id: r.id, event: ed ? 'updated' : 'new' } })
        .then(null, function () {});
      return { id: r.id, number: r.number, has_backorder: !!r.has_backorder, total: r.total, updated: !!ed };
    });
  }

  // ---- réservations (client approuvé : customers.can_reserve) ----
  var resvInfo = null;
  function reserveInfo() {
    var c = cli();
    if (!c || !email()) return Promise.resolve(null);
    if (!resvInfo) resvInfo = c.rpc('me_reservations').then(function (res) {
      if (res.error) return null;
      var d = res.data || {};
      return { can: !!d.can_reserve, suspendedUntil: d.suspended_until || null };
    }, function () { return null; });
    return resvInfo;
  }
  function reserve(lines, note) {
    var c = cli();
    if (!c) return Promise.reject(new Error('Service indisponible pour le moment.'));
    return c.rpc('customer_reserve', { p_lines: lines, p_note: note || null }).then(function (res) {
      if (res.error) throw new Error(errMsg(res.error));
      var r = res.data || {};
      // confirmation au client + avis à Création Audio : sans bloquer l'écran
      c.functions.invoke('reservation-notify', { body: { reservation_id: r.id, event: 'new' } }).then(null, function () {});
      return r;
    });
  }

  window.CA.custOrder = {
    signedIn: function () { return !!email(); },
    email: email, editing: editing, cancelEdit: cancelEdit, send: send,
    reserveInfo: reserveInfo, reserve: reserve
  };
})();
