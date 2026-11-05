/* =========================================================
   Création Audio — page ENTRETIEN : formulaire de demande.
   Compose le message (ville + machines) puis ouvre la Messagerie
   (lien #en-ask [data-msg], géré par nav.js) : la demande arrive dans
   l'onglet Messages de l'admin.
   ========================================================= */
(function () {
  'use strict';
  var CA0 = window.CA || {};
  var _t = CA0.t || function (s) { return s; };
  // prix affichés : 25 $ en français, $25 en anglais
  if (CA0.priceShort) [].forEach.call(document.querySelectorAll('[data-price]'), function (el) { el.textContent = CA0.priceShort(+el.getAttribute('data-price')); });
  var form = document.getElementById('en-form');
  if (!form) return;
  var city = document.getElementById('en-city');
  var machines = document.getElementById('en-machines');
  var status = document.getElementById('en-status');
  var ask = document.getElementById('en-ask');

  function flag(el, bad) { el.classList.toggle('is-bad', bad); el.setAttribute('aria-invalid', bad ? 'true' : 'false'); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var c = city.value.trim(), m = machines.value.trim();
    flag(city, !c); flag(machines, !m);
    status.className = 'en-status';
    if (!c || !m) {
      status.className = 'en-status is-err';
      status.textContent = _t('Remplis la ville et tes machines.');
      (c ? machines : city).focus();
      return;
    }
    var body = _t('Bonjour, je veux un entretien mensuel de mes imprimantes.') + '\n' +
      _t('Ville ou secteur :') + ' ' + c + '\n' +
      _t('Machines :') + ' ' + m;
    ask.setAttribute('data-msg-body', body);
    status.textContent = '';
    ask.click();
  });
  [city, machines].forEach(function (el) { el.addEventListener('input', function () { flag(el, false); }); });
})();
