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
     send(lines, note, pickup) -> Promise({ id, number, has_backorder, total, updated })
                     pickup = { d:'AAAA-MM-JJ', s:'HH:MM' } | null (null en modification = inchangée)
                     lignes = [{ product_id, kind ('spool'|'refill'|'unit'), qty }] ; prix recalculés par le serveur
     reserveInfo()     -> Promise({ can, suspendedUntil } | null)  (réservations, étape 3 ; lu une fois par page)
     reserve(lines, note, pickup) -> Promise({ id, number, total, expires_at })  (72 h, articles en stock seulement)
   Cueillette (plages réglées dans l'admin, Commandes › Cueillettes — RPC pickup_slots) :
     slots(until, self) -> Promise([{ d, s, e, full }])  (until : échéance ISO ; self : sa commande/réservation)
     setPickup(kind 'order'|'reservation', id, pickup) -> Promise({ d, s, e })  (+ avis par courriel, EF pickup-notify)
     picker(host, { onChange }) -> { load(slots, cur), value(), has(), clear(), el }  jours + plages (cueillette.css)
     fmtPickup(d, s, e [, short]) -> « jeudi 23 octobre, 13 h – 17 h »
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';
  var KEY = 'ca-compte-auth', EDIT = 'ca_v2_order_edit', EDIT_TTL = 6 * 3600 * 1000;
  var cfg = window.CA_SUPABASE || {}, client = null;

  function session() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function email() { var s = session(); return (s && s.user && s.user.email) || ''; }
  // client partagé avec le panneau Messagerie (CA.compteSb) : un seul client par clé de session
  function cli() {
    if (!client) client = window.CA.compteSb || null;
    if (!client && window.supabase && window.supabase.createClient && cfg.url) {
      client = window.CA.compteSb = window.supabase.createClient(cfg.url, cfg.anonKey, {
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

  function send(lines, note, pickup) {
    var c = cli();
    if (!c) return Promise.reject(new Error('Service indisponible pour le moment.'));
    var ed = editing();
    var call = ed
      ? c.rpc('customer_update_order', { p_id: ed.id, p_lines: lines, p_note: note || null, p_pickup: pickup || null })
      : c.rpc('customer_submit_order', { p_lines: lines, p_note: note || null, p_pickup: pickup || null });
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
  function reserve(lines, note, pickup) {
    var c = cli();
    if (!c) return Promise.reject(new Error('Service indisponible pour le moment.'));
    return c.rpc('customer_reserve', { p_lines: lines, p_note: note || null, p_pickup: pickup || null }).then(function (res) {
      if (res.error) throw new Error(errMsg(res.error));
      var r = res.data || {};
      // confirmation au client + avis à Création Audio : sans bloquer l'écran
      c.functions.invoke('reservation-notify', { body: { reservation_id: r.id, event: 'new' } }).then(null, function () {});
      return r;
    });
  }

  // ---- cueillette ----
  function slots(until, self) {
    var c = cli();
    if (!c || !email()) return Promise.resolve([]);
    return c.rpc('pickup_slots', { p_until: until || null, p_self: self || null })
      .then(function (res) { return (!res.error && res.data) || []; }, function () { return []; });
  }
  function setPickup(kind, id, pickup) {
    var c = cli();
    if (!c) return Promise.reject(new Error('Service indisponible pour le moment.'));
    return c.rpc('customer_set_pickup', { p_kind: kind, p_id: id, p_pickup: pickup }).then(function (res) {
      if (res.error) throw new Error(errMsg(res.error));
      // avis à Création Audio : sans bloquer l'écran
      c.functions.invoke('pickup-notify', { body: { kind: kind, id: id } }).then(null, function () {});
      return res.data || {};
    });
  }
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var MOIS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  function dOf(d) { var p = String(d || '').split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function hTxt(t) { var p = String(t || '').split(':'); return (+p[0]) + ' h' + (p[1] && p[1] !== '00' ? ' ' + p[1] : ''); }
  function fmtPickup(d, s, e, short) {
    if (!d) return '';
    var x = dOf(d);
    var day = short ? JOURS[x.getDay()].slice(0, 3) + '. ' + x.getDate() + ' ' + MOIS[x.getMonth()]
      : JOURS[x.getDay()] + ' ' + x.getDate() + ' ' + MOIS_L[x.getMonth()];
    return day + (s ? (short ? ' · ' : ', ') + hTxt(s) + (e ? ' – ' + hTxt(e) : '') : '');
  }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // Sélecteur : une bande de jours (pastilles défilantes ‹ ›), puis les plages du jour choisi.
  // opts.big : grandes pastilles sur plusieurs rangées (écran « Ma cueillette » de Mon compte)
  function picker(host, opts) {
    opts = opts || {};
    var list = [], day = null, sel = null;
    var el = document.createElement('div');
    el.className = 'pk' + (opts.big ? ' pk-lg' : '');
    el.innerHTML = '<div class="pk-days"><button type="button" class="pk-nav pk-prev" aria-label="Jours précédents">‹</button>' +
      '<div class="pk-strip" role="listbox" aria-label="Jour de cueillette"></div>' +
      '<button type="button" class="pk-nav pk-next" aria-label="Jours suivants">›</button></div>' +
      (opts.big ? '<p class="pk-dayname"></p>' : '') +
      '<div class="pk-slots" role="listbox" aria-label="Plage horaire"></div>';
    if (host) host.appendChild(el);
    var strip = el.querySelector('.pk-strip'), slotsEl = el.querySelector('.pk-slots');
    var prev = el.querySelector('.pk-prev'), next = el.querySelector('.pk-next');
    function navState() {
      prev.disabled = strip.scrollLeft <= 2;
      next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
    }
    prev.addEventListener('click', function () { strip.scrollBy({ left: -strip.clientWidth * .8, behavior: 'smooth' }); });
    next.addEventListener('click', function () { strip.scrollBy({ left: strip.clientWidth * .8, behavior: 'smooth' }); });
    strip.addEventListener('scroll', navState, { passive: true });
    function days() {
      var out = [], seen = {};
      list.forEach(function (x) {
        if (!seen[x.d]) { seen[x.d] = { d: x.d, open: 0 }; out.push(seen[x.d]); }
        if (!x.full) seen[x.d].open++;
      });
      return out;
    }
    function render() {
      strip.innerHTML = days().map(function (g) {
        var x = dOf(g.d);
        return '<button type="button" role="option" class="pk-day' + (g.d === day ? ' is-on' : '') + (g.open ? '' : ' is-full') +
          '" data-d="' + esc(g.d) + '" aria-selected="' + (g.d === day) + '"' + (g.open ? '' : ' aria-disabled="true"') + '>' +
          '<small>' + JOURS[x.getDay()].slice(0, 3) + '</small><b>' + x.getDate() + '</b><small>' + MOIS[x.getMonth()] + '</small></button>';
      }).join('');
      slotsEl.innerHTML = list.filter(function (x) { return x.d === day; }).map(function (x) {
        var on = !!(sel && sel.d === x.d && sel.s === x.s);
        return '<button type="button" role="option" class="pk-slot' + (on ? ' is-on' : '') + (x.full ? ' is-full' : '') +
          '" data-s="' + esc(x.s) + '" aria-selected="' + on + '"' + (x.full ? ' disabled' : '') + '>' +
          hTxt(x.s) + ' – ' + hTxt(x.e) + (x.full ? ' <small>complet</small>' : '') + '</button>';
      }).join('');
      var dn = el.querySelector('.pk-dayname');
      if (dn) dn.textContent = day ? fmtPickup(day) : '';
      setTimeout(navState, 0);
    }
    strip.addEventListener('click', function (e) {
      var b = e.target.closest('.pk-day');
      if (!b || b.classList.contains('is-full')) return;
      day = b.getAttribute('data-d'); render();
    });
    slotsEl.addEventListener('click', function (e) {
      var b = e.target.closest('.pk-slot');
      if (!b || b.disabled) return;
      var x = list.filter(function (y) { return y.d === day && y.s === b.getAttribute('data-s'); })[0];
      sel = x ? { d: x.d, s: x.s, e: x.e } : null; render();
      if (opts.onChange) opts.onChange(sel);
    });
    return {
      el: el,
      // cur : plage déjà choisie (présélectionnée si encore offerte)
      load: function (slotList, cur) {
        list = slotList || [];
        var hit = cur && list.filter(function (x) { return x.d === cur.d && x.s === cur.s && !x.full; })[0];
        sel = hit ? { d: hit.d, s: hit.s, e: hit.e } : (sel && list.some(function (x) { return x.d === sel.d && x.s === sel.s && !x.full; }) ? sel : null);
        var open = days().filter(function (g) { return g.open; });
        if (sel) day = sel.d;
        else if (!open.some(function (g) { return g.d === day; })) day = open[0] ? open[0].d : (list[0] ? list[0].d : null);
        render();
        var on = strip.querySelector('.is-on');
        if (on) strip.scrollLeft = Math.max(0, on.offsetLeft - strip.offsetLeft - 8);
      },
      value: function () { return sel; },
      has: function () { return list.length > 0; },
      clear: function () { sel = null; render(); }
    };
  }

  window.CA.custOrder = {
    signedIn: function () { return !!email(); },
    email: email, editing: editing, cancelEdit: cancelEdit, send: send,
    reserveInfo: reserveInfo, reserve: reserve,
    slots: slots, setPickup: setPickup, picker: picker, fmtPickup: fmtPickup
  };
})();
