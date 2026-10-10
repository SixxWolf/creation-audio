/* =========================================================
   Fenêtres du site — remplacent confirm / alert / prompt du navigateur.
   Style : dialog.css (carte centrée, pastille d'icône, rouge si irréversible).

   caDialog.confirm({ title, message, ok, cancel, danger, icon, alt })  → Promise<boolean | 'alt'>
   (alt : texte d'un 3e bouton, ex. « Retirer de la commande » → la promesse rend 'alt')
   caDialog.alert({ title, message, ok, icon, danger })            → Promise<void>
   caDialog.prompt({ title, message, value, placeholder, readonly, ok, cancel, icon }) → Promise<string|null>
   (cancel: false = pas de bouton « Retour »)
   caDialog.error(err [, title])   fenêtre « Compris » avec le message d'erreur
   caDialog.toast(text [, 'bad'])  court message en bas de l'écran

   icon : warn | trash | cart | info | edit | plus | link | copy | clock (défaut : warn si danger, sinon info)
   ========================================================= */
(function () {
  'use strict';
  var IC = {
    warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'
  };
  var native = typeof HTMLDialogElement === 'function';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var seq = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function norm(o) { return typeof o === 'string' ? { title: o } : (o || {}); }

  // kind : 'confirm' | 'alert' | 'prompt'
  function open(kind, o) {
    o = norm(o);
    if (!native) {   // très vieux navigateur : on retombe sur les boîtes natives
      var txt = (o.title || '') + (o.message ? '\n\n' + o.message : '');
      if (kind === 'confirm') return Promise.resolve(window.confirm(txt));
      if (kind === 'prompt') return Promise.resolve(window.prompt(txt, o.value || ''));
      window.alert(txt); return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var id = 'ca-dlg-' + (++seq);
      var d = el('dialog', 'ca-dlg');
      d.setAttribute('aria-labelledby', id + '-t');
      if (o.message) d.setAttribute('aria-describedby', id + '-m');
      if (kind !== 'prompt' && o.danger) d.setAttribute('role', 'alertdialog');
      var box = el('div', 'dlg-in');
      var ic = el('span', 'dlg-ic' + (o.danger ? ' is-danger' : ''));
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = '<svg viewBox="0 0 24 24">' + (IC[o.icon] || IC[o.danger ? 'warn' : 'info']) + '</svg>';
      var t = el('h2', 'dlg-t', o.title || ''); t.id = id + '-t';
      box.appendChild(ic); box.appendChild(t);
      if (o.message) { var m = el('p', 'dlg-m', o.message); m.id = id + '-m'; box.appendChild(m); }
      var field = null;
      if (kind === 'prompt') {
        field = el('input', 'dlg-field');
        field.type = 'text'; field.value = o.value == null ? '' : String(o.value);
        if (o.placeholder) field.placeholder = o.placeholder;
        field.setAttribute('aria-labelledby', id + '-t');
        if (o.readonly) field.readOnly = true;
        box.appendChild(field);
      }
      var foot = el('div', 'dlg-f'), back = null;
      if (kind !== 'alert' && o.cancel !== false) {
        back = el('button', 'dlg-b dlg-back', o.cancel || 'Retour'); back.type = 'button';
        foot.appendChild(back);
      }
      var alt = null;
      if (kind === 'confirm' && o.alt) {
        alt = el('button', 'dlg-b dlg-back dlg-alt', o.alt); alt.type = 'button';
        foot.appendChild(alt);
      }
      var go = el('button', 'dlg-b dlg-go' + (o.danger && kind !== 'alert' ? ' is-danger' : ''),
        o.ok || (kind === 'alert' ? 'Compris' : 'Confirmer'));
      go.type = 'button';
      foot.appendChild(go);
      box.appendChild(foot);
      d.appendChild(box);

      var nope = kind === 'confirm' ? false : kind === 'prompt' ? null : undefined;
      var done = false;
      function finish(val) {
        if (done) return; done = true;
        function end() { if (d.open) d.close(); d.remove(); resolve(val); }
        if (reduced || !d.open) { end(); return; }
        d.classList.add('is-closing');
        setTimeout(end, 120);
      }
      go.addEventListener('click', function () { finish(kind === 'confirm' ? true : kind === 'prompt' ? field.value : undefined); });
      if (back) back.addEventListener('click', function () { finish(nope); });
      if (alt) alt.addEventListener('click', function () { finish('alt'); });
      if (field) field.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
      // Échap = Retour ; on bloque la propagation pour ne pas fermer aussi un panneau de la page
      d.addEventListener('keydown', function (e) { if (e.key === 'Escape') e.stopPropagation(); });
      d.addEventListener('cancel', function (e) { e.preventDefault(); finish(nope); });
      d.addEventListener('close', function () { finish(nope); });
      // clic sur le fond (pressé ET relâché hors de la carte) = Retour
      var downOut = false;
      d.addEventListener('pointerdown', function (e) { downOut = e.target === d; });
      d.addEventListener('click', function (e) { if (downOut && e.target === d) finish(nope); downOut = false; });

      document.body.appendChild(d);
      d.showModal();
      // focus : le champ, sinon « Retour » quand c'est irréversible, sinon l'action
      if (field) { field.focus(); field.select(); }
      else (o.danger && back ? back : go).focus();
    });
  }

  var toastEl = null, toastT = null;
  function toast(text, kind) {
    if (!toastEl) {
      toastEl = el('div', 'ca-toast is-hidden');
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      toastEl.appendChild(el('i')); toastEl.appendChild(el('span'));
      document.body.appendChild(toastEl);
    }
    var bad = kind === 'bad';
    toastEl.classList.toggle('is-bad', bad);
    toastEl.firstChild.textContent = bad ? '!' : '✓';
    toastEl.lastChild.textContent = text;
    void toastEl.offsetWidth;
    toastEl.classList.remove('is-hidden');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.add('is-hidden'); }, bad ? 4000 : 2600);
  }

  function errText(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    return err.message || err.error_description || String(err);
  }

  window.caDialog = {
    confirm: function (o) { return open('confirm', o); },
    alert: function (o) { return open('alert', o); },
    prompt: function (o) { return open('prompt', o); },
    error: function (err, title) {
      return open('alert', { title: title || 'Action impossible', message: errText(err), icon: 'warn', danger: true });
    },
    toast: toast
  };
})();
