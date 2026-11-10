/* =========================================================
   Création Audio — page publique « Imprimantes 3D » (boutique/imprimantes.html) ; ≠ imprimantes.css (admin)
   Section en préparation : « M'avertir quand c'est prêt » envoie le
   courriel à la RPC waitlist_topic_subscribe (sujet 'printers').
   Même table que la liste d'attente (Loi 25 : 60 jours, effacé à l'avis).
   Admin : Inventaire › Liste d'attente (cms-attente.js).
   ========================================================= */
(function () {
  'use strict';
  var _t = window.CA.t, sb = window.CA.sb, EMAIL = 'contact@creationaudio.ca';
  var form = document.getElementById('ip3-form'); if (!form) return;
  var email = document.getElementById('ip3-email'), btn = document.getElementById('ip3-btn'),
      msg = document.getElementById('ip3-msg');

  // client connecté : courriel pré-rempli
  try { var s = JSON.parse(localStorage.getItem('ca-compte-auth') || 'null'); if (s && s.user && s.user.email) email.value = s.user.email; } catch (e) {}

  function say(t, cls) { msg.textContent = t; msg.className = 'ip3-msg' + (cls ? ' ' + cls : ''); }
  function done(t) { form.hidden = true; say(t, 'ok'); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var val = (email.value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(val)) { say(_t('Entre un courriel valide.'), 'bad'); email.focus(); return; }
    if (!sb) { say(_t('Service momentanément indisponible.'), 'bad'); return; }
    btn.disabled = true; say(_t('Envoi…'));
    sb.rpc('waitlist_topic_subscribe', { p_topic: 'printers', p_email: val, p_hp: form.website.value || '', p_lang: window.CA.lang || 'fr' })
      .then(function (res) {
        btn.disabled = false;
        var r = res && !res.error ? res.data : null;
        if (r === 'ok') return done(_t('✓ C\'est noté ! On t\'écrit dès que les imprimantes 3D arrivent.'));
        if (r === 'exists') return done(_t('Tu es déjà sur la liste — on t\'écrit dès que les imprimantes 3D arrivent.'));
        if (r === 'invalid') say(_t('Ce courriel semble invalide.'), 'bad');
        else if (r === 'busy') say(_t('Trop de demandes pour le moment — réessaie un peu plus tard.'), 'bad');
        else say(_t('Impossible d\'enregistrer ta demande pour le moment. Écris-nous à ') + EMAIL + '.', 'bad');
      }, function () { btn.disabled = false; say(_t('Erreur réseau — réessaie.'), 'bad'); });
  });
})();
