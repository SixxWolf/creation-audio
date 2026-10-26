/* =========================================================
   Création Audio — centre d'aide (moteur partagé)
   Utilisé par aide.html (clients) et l'onglet Aide de l'admin (cms-aide.js).
   CAAide.mount(root, {
     groups: ['Commander', …],          ordre des thèmes
     tutos:  [{ id, group, title, intro?, go?: { href, label }, steps: ['…'], tip?, keys? }],
     get():  id du tuto dans l'URL (ou null)
     set(id): écrit l'id dans l'URL
     placeholder?: texte de la recherche
   }) -> { show(id), filter(texte) }
   Texte des étapes : [Bouton] = libellé d'interface (pastille), **gras**.
   ========================================================= */
(function () {
  'use strict';
  var _t = (window.CA && window.CA.t) || function (s) { return s; };   // partagé avec l'admin (sans i18n.js : français)

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]/g, '<span class="ah-ui">$1</span>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function mount(root, o) {
    var tutos = o.tutos || [], byId = {};
    tutos.forEach(function (t) {
      byId[t.id] = t;
      t._hay = norm([t.title, t.group, t.intro, t.tip, t.keys].concat(t.steps).join(' '));
    });
    var groups = (o.groups || []).filter(function (g) { return tutos.some(function (t) { return t.group === g; }); });

    root.classList.add('ah');
    root.innerHTML =
      '<div class="ah-search"><input type="search" class="ah-q" placeholder="' + esc(o.placeholder || _t('Rechercher un tutoriel…')) +
        _t('" aria-label="Rechercher un tutoriel" autocomplete="off" spellcheck="false"></div>') +
      '<div class="ah-cols">' +
        _t('<nav class="ah-nav" aria-label="Tutoriels"></nav>') +
        '<article class="ah-doc" aria-live="polite"></article>' +
      '</div>';
    var q = root.querySelector('.ah-q'), nav = root.querySelector('.ah-nav'), doc = root.querySelector('.ah-doc');
    var cur = null, term = '';

    function renderNav() {
      var words = norm(term).split(' ').filter(Boolean);
      var hit = function (t) { return words.every(function (w) { return t._hay.indexOf(w) >= 0; }); };
      var html = groups.map(function (g) {
        var list = tutos.filter(function (t) { return t.group === g && hit(t); });
        if (!list.length) return '';
        return '<div class="ah-grp"><p class="ah-grp-t">' + esc(g) + '</p>' + list.map(function (t) {
          return '<a class="ah-link' + (cur && cur.id === t.id ? ' is-on' : '') + '" href="#" data-id="' + esc(t.id) + '"' +
            (cur && cur.id === t.id ? ' aria-current="true"' : '') + '>' + esc(t.title) + '</a>';
        }).join('') + '</div>';
      }).join('');
      nav.innerHTML = html || _t('<p class="ah-none">Aucun tutoriel pour « ') + esc(term) + ' ».</p>';
    }

    function renderDoc() {
      var t = cur;
      root.classList.toggle('has-doc', !!t);
      if (!t) {
        doc.innerHTML = _t('<p class="ah-pick">Choisis un tutoriel.</p>');
        return;
      }
      doc.innerHTML =
        _t('<button type="button" class="ah-back">← Tous les tutoriels</button>') +
        '<header class="ah-head">' +
          '<div><p class="ah-eyebrow">' + esc(t.group) + '</p><h2>' + esc(t.title) + '</h2>' +
          (t.intro ? '<p class="ah-intro">' + fmt(t.intro) + '</p>' : '') + '</div>' +
          (t.go ? '<a class="ah-go" href="' + esc(t.go.href) + '"' + (t.go.blank ? ' target="_blank" rel="noopener"' : '') + '>' +
            esc(t.go.label || _t('Y aller')) + ' <span aria-hidden="true">→</span></a>' : '') +
        '</header>' +
        '<ol class="ah-steps">' + t.steps.map(function (s) { return '<li>' + fmt(s) + '</li>'; }).join('') + '</ol>' +
        (t.tip ? '<p class="ah-tip">' + fmt(t.tip) + '</p>' : '');
    }

    function show(id, push) {
      cur = byId[id] || null;
      renderNav(); renderDoc();
      if (push && o.set) o.set(cur ? cur.id : null);
    }

    nav.addEventListener('click', function (e) {
      var a = e.target.closest('.ah-link'); if (!a) return;
      e.preventDefault();
      show(a.dataset.id, true);
      if (window.matchMedia('(max-width:760px)').matches) root.scrollIntoView({ block: 'start' });
    });
    doc.addEventListener('click', function (e) {
      if (e.target.closest('.ah-back')) { show(null, true); }
    });
    q.addEventListener('input', function () {
      term = q.value;
      renderNav();
      // un seul résultat : on l'ouvre directement
      var links = nav.querySelectorAll('.ah-link');
      if (term && links.length === 1 && (!cur || cur.id !== links[0].dataset.id)) show(links[0].dataset.id, false);
    });
    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = nav.querySelector('.ah-link');
      if (first) { e.preventDefault(); show(first.dataset.id, true); }
    });

    // grand écran : jamais de colonne vide, on ouvre le premier tuto
    function orFirst(id) {
      if (byId[id] || window.matchMedia('(max-width:760px)').matches || !tutos.length) return id;
      return tutos.filter(function (t) { return t.group === groups[0]; })[0].id;
    }
    show(orFirst(o.get && o.get()), false);

    return {
      show: function (id) { show(orFirst(id), false); },
      filter: function (txt) { q.value = term = txt || ''; renderNav(); }
    };
  }

  window.CAAide = { mount: mount };
})();
