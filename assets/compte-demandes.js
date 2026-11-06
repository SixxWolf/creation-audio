/* =========================================================
   Création Audio — Mon compte, onglet Demandes (#/demandes, #/demandes/<id>).
   Lecture : RPC me_service_requests. Soumission : RPC sr_decide. Discussion : demande-fil.js.
   L'onglet reste caché tant que le client n'a aucune demande. Chargé par compte.html AVANT compte.js.
   ========================================================= */
window.CA = window.CA || {};
(function () {
  'use strict';
  var CA = window.CA, _t = CA.t || function (s) { return s; };
  var LABEL = { received: 'Reçue', evaluating: 'En évaluation', quoted: 'Soumission envoyée', accepted: 'Acceptée', in_progress: 'En cours',
    done: 'Terminée', invoiced: 'Facturée', refused: 'Refusée', cancelled: 'Annulée' };
  var PILL = { received: 'st-new', evaluating: 'st-preparing', quoted: 'st-new', accepted: 'st-preparing', in_progress: 'st-preparing',
    done: 'st-ready', invoiced: 'st-invoiced', refused: 'st-cancelled', cancelled: 'st-cancelled' };
  var SERVICE = { file: 'Mon fichier', batch: 'Une série', design: 'À dessiner', proto: 'Prototype' };
  var MATERIAL = { pla: 'PLA', petg: 'PETG', abs: 'ABS', tpu: 'TPU', any: 'À conseiller' };
  var MACHINE = { a1: 'Bambu Lab A1', xp: 'Bambu Lab série X / P', snap: 'Snapmaker U1' };
  var sb = null, list = [], loaded = false, wantId = '', threads = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function day(d) {
    if (!d) return '';
    var x = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
    return x.toLocaleDateString(CA.locale || 'fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function stamp(d) {
    var x = new Date(d);
    return x.toLocaleDateString(CA.locale || 'fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' +
      x.toLocaleTimeString(CA.locale || 'fr-CA', { hour: '2-digit', minute: '2-digit' });
  }
  function kindOf(r) { return r.kind === 'maintenance' ? _t('Entretien d\'imprimantes') : _t('Impression 3D'); }
  function line(k, v) { return v == null || v === '' ? '' : '<div class="dq-l"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }
  function lines(r) {
    var d = r.details || {}, h = '';
    if (r.kind === 'maintenance') {
      var m = d.machines || {};
      var mach = Object.keys(m).filter(function (k) { return +m[k] > 0; }).map(function (k) { return m[k] + ' × ' + _t(MACHINE[k] || k); }).join(', ');
      h += line(_t('Machines'), mach) + line(_t('Ville ou secteur'), d.city) + line(_t('Précision'), d.other);
    } else {
      h += line(_t('Service'), SERVICE[d.service] ? _t(SERVICE[d.service]) : '') +
        line(_t('Matériau'), MATERIAL[d.material] ? _t(MATERIAL[d.material]) : '') +
        line(_t('Couleur'), d.color && d.color.name) + line(_t('Quantité'), d.qty) + line(_t('Ta pièce'), d.desc);
    }
    return h;
  }
  function quoteHtml(r) {
    if (r.quote_price == null) return '';
    var monthly = r.kind === 'maintenance', price = CA.money ? CA.money(r.quote_price) : r.quote_price;
    return '<div class="dq-quote"><h3 class="dq-h">' + esc(_t('Soumission')) + '</h3>' +
      '<p class="dq-price">' + esc(price) + (monthly ? ' <small>' + esc(_t('par mois')) + '</small>' : '') + '</p>' +
      '<p class="dq-date">' + esc(monthly ? _t('Première visite le ') : _t('Prête le ')) + esc(day(r.quote_date)) + '</p>' +
      (r.quote_note ? '<p class="dq-note">' + esc(r.quote_note) + '</p>' : '') +
      (r.status === 'quoted' ? '<div class="ord-acts"><button type="button" class="acct-btn acct-btn-go" data-acc="' + esc(r.id) + '">' + esc(_t('Accepter')) + '</button>' +
        '<button type="button" class="acct-btn acct-btn-danger" data-ref="' + esc(r.id) + '">' + esc(_t('Refuser')) + '</button></div>' : '') +
      '</div>';
  }
  function filesHtml(r) {
    if (r.files_purged_at) return '<p class="dq-note">' + esc(_t('Fichiers retirés après 12 mois.')) + '</p>';
    if (!(r.files || []).length) return '';
    var urls = {};
    (r.files || []).forEach(function (f) { urls[f.p] = r._urls && r._urls[f.p]; });
    return '<h3 class="dq-h">' + esc(_t('Fichiers')) + '</h3><div class="dq-files">' + r.files.map(function (f) { return CA.demandeFil.fileRow(f, urls); }).join('') + '</div>';
  }
  function card(r) {
    var open = wantId === r.id;
    return '<details class="ord dq" data-id="' + esc(r.id) + '"' + (open ? ' open' : '') + '>' +
      '<summary><span class="ord-main"><span class="ord-no">' + esc(r.number) + ' · ' + esc(kindOf(r)) + '</span>' +
        '<span class="ord-meta">' + esc(day(r.created_at)) + '</span></span>' +
        (r.unread ? '<b class="acct-n">' + esc(r.unread) + '</b>' : '') +
        '<span class="ord-pill ' + (PILL[r.status] || '') + '">' + esc(_t(LABEL[r.status] || r.status)) + '</span></summary>' +
      '<div class="ord-body dq-body">' +
        quoteHtml(r) +
        '<h3 class="dq-h">' + esc(_t('Ta demande')) + '</h3><dl class="dq-dl">' + lines(r) + '</dl>' +
        filesHtml(r) +
        '<h3 class="dq-h">' + esc(_t('Suivi')) + '</h3><ol class="dq-ev">' + (r.events || []).map(function (e) {
          return '<li><b>' + esc(_t(LABEL[e.status] || e.status)) + '</b><time>' + esc(stamp(e.at)) + '</time></li>';
        }).join('') + '</ol>' +
        '<h3 class="dq-h">' + esc(_t('Discussion')) + '</h3><div class="dq-fil"></div>' +
      '</div></details>';
  }
  function badge() {
    var tab = document.querySelector('.acct-tabs a[data-tab="demandes"]'), n = $('acct-n-dem');
    if (tab) tab.hidden = !list.length && location.hash.indexOf('#/demandes') !== 0;
    var unread = list.reduce(function (s, r) { return s + (r.unread || 0) + (r.status === 'quoted' ? 1 : 0); }, 0);
    if (n) { n.textContent = unread; n.hidden = !unread; }
  }
  function sign() {
    var paths = [];
    list.forEach(function (r) { (r.files || []).forEach(function (f) { paths.push(f.p); }); });
    if (!paths.length || !sb.storage) return Promise.resolve();
    return sb.storage.from('print-files').createSignedUrls(paths, 3600).then(function (x) {
      var map = {};
      (x.data || []).forEach(function (u) { if (u.signedUrl) map[u.path] = u.signedUrl; });
      list.forEach(function (r) { r._urls = map; });
    }, function () {});
  }
  function mountFil(det) {
    var id = det.getAttribute('data-id'), box = det.querySelector('.dq-fil'), r = list.filter(function (x) { return x.id === id; })[0];
    if (!box || !r || threads[id]) return;
    threads[id] = CA.demandeFil.mount(box, {
      id: id, sb: sb, noFiles: r.kind === 'maintenance', owner: CA.compteDemandes.uid, btn: 'acct-btn acct-btn-go', root: CA.lang === 'en' ? '../' : '',
      onRead: function () { if (r.unread) { r.unread = 0; badge(); var b = det.querySelector('summary .acct-n'); if (b) b.remove(); } }
    });
  }
  function paint() {
    var el = $('acct-dem');
    if (!el) return;
    Object.keys(threads).forEach(function (k) { threads[k].destroy(); });
    threads = {};
    el.innerHTML = list.length ? '<div class="ord-list">' + list.map(card).join('') + '</div>'
      : '<p class="acct-empty">' + esc(_t('Aucune demande pour l\'instant.')) + '</p>';
    [].slice.call(el.querySelectorAll('details.dq')).forEach(function (det) {
      if (det.open) mountFil(det);
      det.addEventListener('toggle', function () { if (det.open) mountFil(det); });
    });
    if (wantId) {
      var t = el.querySelector('details.dq[open]');
      if (t) t.scrollIntoView({ block: 'start' });
      wantId = '';
    }
    badge();
  }
  function load() {
    if (!sb) return Promise.resolve();
    return sb.rpc('me_service_requests').then(function (res) {
      if (res.error) throw res.error;
      list = res.data || [];
      loaded = true;
      return sign();
    }).then(paint, function () {
      var el = $('acct-dem');
      if (el && !loaded) el.innerHTML = '<p class="acct-empty">' + esc(_t('Impossible de charger tes demandes. Réessaie plus tard.')) + '</p>';
    });
  }
  function decide(id, accept) {
    var r = list.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    window.caDialog.confirm({
      title: accept ? _t('Accepter la soumission ?') : _t('Refuser la soumission ?'),
      message: r.number + ' · ' + (CA.money ? CA.money(r.quote_price) : r.quote_price),
      ok: accept ? _t('Accepter') : _t('Refuser'), danger: !accept
    }).then(function (ok) {
      if (!ok) return;
      wantId = id;
      sb.rpc('sr_decide', { p_id: id, p_accept: accept, p_note: null }).then(function (res) {
        if (res.error) { window.caDialog.toast((res.error.message && _t(res.error.message)) || _t('Envoi impossible pour le moment. Réessaie.'), 'bad'); return; }
        window.caDialog.toast(accept ? _t('Soumission acceptée') : _t('Soumission refusée'));
        return load();
      }, function () { window.caDialog.toast(_t('Erreur réseau — réessaie.'), 'bad'); });
    });
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var a = e.target.closest('[data-acc]'), n = e.target.closest('[data-ref]'), v = e.target.closest('#acct-dem .dq-files [data-v3d]');
    if (a) decide(a.getAttribute('data-acc'), true);
    if (n) decide(n.getAttribute('data-ref'), false);
    if (v && !v.disabled) {
      v.disabled = true;
      CA.demandeFil.view3d(sb, v.getAttribute('data-v3d'), v.getAttribute('data-n') || '', CA.lang === 'en' ? '../' : '').catch(function () {
        window.caDialog.toast(_t('Aperçu indisponible pour ce fichier.'), 'bad');
      }).then(function () { v.disabled = false; });
    }
  });

  CA.compteDemandes = {
    uid: '',
    // appelé à l'ouverture de l'espace client
    start: function (client) {
      sb = client;
      loaded = false;
      if (!sb) return Promise.resolve();
      return sb.auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        CA.compteDemandes.uid = (s && s.user && s.user.id) || '';
        return load();
      });
    },
    // #/demandes ou #/demandes/<id> (lien des courriels)
    open: function (id) {
      if (id) wantId = id;
      badge();
      if (!loaded) return;
      if (!id) { load(); return; }
      var el = $('acct-dem'), det = el && el.querySelector('details.dq[data-id="' + id + '"]');
      if (det) { det.open = true; det.scrollIntoView({ block: 'start' }); wantId = ''; } else load();
    }
  };
})();
