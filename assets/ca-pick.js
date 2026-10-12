/* =========================================================
   Création Audio — menu maison « pastilles » (CA.pick)
   Remplace l'affichage d'un <select> natif par un bouton champ « Creusé »
   + une liste en popover (recherche, groupes = <optgroup>, pastille de couleur).
   Le <select> reste dans le DOM (caché) : sa valeur et son événement « change »
   sont la source de vérité -> le code existant n'a rien à changer.
   Pastille d'une option : <option data-sw="(fond CSS)">.
   Usage : CA.pick(select) — rappeler après avoir changé ses options.
   ========================================================= */
(function () {
  'use strict';
  var CA = window.CA = window.CA || {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function swHtml(sw) { return sw ? '<span class="cpk-sw" style="background:' + esc(sw) + '"></span>' : ''; }

  var openPk = null;   // un seul menu ouvert à la fois

  function items(sel) {
    var out = [];
    Array.prototype.forEach.call(sel.options, function (o) {
      var g = o.parentNode && o.parentNode.tagName === 'OPTGROUP' ? o.parentNode.label : '';
      out.push({ value: o.value, text: o.textContent, sw: o.getAttribute('data-sw') || '', group: g, disabled: o.disabled });
    });
    return out;
  }

  function enhance(sel) {
    if (!sel) return null;
    if (sel._pk) { sel._pk.refresh(); return sel._pk; }
    var wrap = document.createElement('div');
    wrap.className = 'cpk';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cpk-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    var lbl = sel.getAttribute('aria-label');
    if (lbl) btn.setAttribute('aria-label', lbl);
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(btn);
    wrap.appendChild(sel);
    sel.hidden = true;
    sel.tabIndex = -1;

    var pop = null, list = null, search = null, active = -1, shown = [];

    function refresh() {
      var o = sel.options[sel.selectedIndex];
      var empty = !o || o.value === '';
      btn.innerHTML = swHtml(o && o.getAttribute('data-sw')) +
        '<span class="cpk-txt' + (empty ? ' is-ph' : '') + '">' + esc(o ? o.textContent : '—') + '</span>';
      btn.disabled = sel.disabled;
      btn.classList.toggle('is-empty', empty);
    }

    function renderList() {
      var q = search ? norm(search.value).trim() : '';
      var words = q ? q.split(/\s+/) : [];
      shown = items(sel).filter(function (it) {
        if (it.value === '') return !q;   // « — choisir — » : seulement sans recherche
        if (!words.length) return true;
        var hay = norm(it.group + ' ' + it.text);
        return words.every(function (w) { return hay.indexOf(w) > -1; });
      });
      var html = '', g = null;
      shown.forEach(function (it, i) {
        if (it.group !== g) { g = it.group; if (g) html += '<div class="cpk-grp">' + esc(g) + '</div>'; }
        var on = it.value === sel.value;
        html += '<button type="button" class="cpk-item' + (on ? ' is-sel' : '') + (i === active ? ' is-active' : '') +
          (it.value === '' ? ' is-ph' : '') + '" role="option" aria-selected="' + on + '" data-i="' + i + '"' +
          (it.disabled ? ' disabled' : '') + '>' + swHtml(it.sw) + '<span>' + esc(it.text) + '</span></button>';
      });
      list.innerHTML = html || '<div class="cpk-none">Aucun résultat</div>';
    }

    function place() {
      if (!pop) return;
      var r = btn.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
      var w = Math.min(Math.max(r.width, 280), vw - 16);
      var below = vh - r.bottom - 12, above = r.top - 12;
      var up = below < 240 && above > below;
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
      pop.style.maxHeight = Math.max(160, Math.min(380, up ? above : below)) + 'px';
      if (up) { pop.style.top = ''; pop.style.bottom = (vh - r.top + 6) + 'px'; }
      else { pop.style.bottom = ''; pop.style.top = (r.bottom + 6) + 'px'; }
    }

    function open() {
      if (btn.disabled) return;
      if (openPk && openPk !== api) openPk.close(false);
      if (pop) return;
      openPk = api;
      pop = document.createElement('div');
      pop.className = 'cpk-pop';
      pop.innerHTML = (sel.options.length > 10 ? '<input type="search" class="cpk-search" placeholder="Rechercher…" autocomplete="off" spellcheck="false" aria-label="Rechercher">' : '') +
        '<div class="cpk-list" role="listbox"></div>';
      document.body.appendChild(pop);
      list = pop.querySelector('.cpk-list');
      search = pop.querySelector('.cpk-search');
      active = -1;
      renderList();
      active = shown.findIndex(function (it) { return it.value === sel.value && it.value !== ''; });
      renderList();
      place();
      btn.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
      var cur = list.querySelector('.is-sel');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
      list.addEventListener('mousedown', function (e) { e.preventDefault(); });   // garde le focus sur la recherche
      list.addEventListener('click', function (e) {
        var b = e.target.closest('.cpk-item');
        if (b && !b.disabled) choose(shown[+b.getAttribute('data-i')]);
      });
      if (search) {
        search.addEventListener('input', function () { active = search.value ? firstEnabled(0, 1) : -1; renderList(); });
        search.addEventListener('keydown', onKey);
        search.focus();
      }
    }

    function close(refocus) {
      if (!pop) return;
      pop.remove(); pop = null; list = null; search = null;
      if (openPk === api) openPk = null;
      btn.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
      if (refocus) btn.focus();
    }

    function choose(it) {
      if (!it) return;
      var changed = sel.value !== it.value;
      sel.value = it.value;
      refresh();
      close(true);
      if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function firstEnabled(from, dir) {
      for (var i = from; i >= 0 && i < shown.length; i += dir) { if (!shown[i].disabled) return i; }
      return active;
    }
    function onKey(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var d = e.key === 'ArrowDown' ? 1 : -1;
        active = firstEnabled(active < 0 ? (d > 0 ? 0 : shown.length - 1) : active + d, d);
        renderList();
        var a = list.querySelector('.is-active'); if (a) a.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (active > -1) choose(shown[active]);
      } else if (e.key === 'Escape') {
        e.preventDefault(); close(true);
      } else if (e.key === 'Tab') {
        close(false);
      }
    }

    btn.addEventListener('click', function () { if (pop) close(true); else open(); });
    btn.addEventListener('keydown', function (e) {
      if (!pop && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); }
      else if (pop) onKey(e);
    });
    sel.addEventListener('change', refresh);

    var api = { refresh: refresh, open: open, close: close, place: place, focus: function () { btn.focus(); }, btn: btn };
    sel._pk = api;
    refresh();
    return api;
  }

  // ferme au clic ailleurs, au défilement de la page (pas de la liste) ; suit le redimensionnement
  document.addEventListener('mousedown', function (e) {
    if (!openPk || !e.target.closest) return;
    if (e.target.closest('.cpk-pop') || e.target.closest('.cpk.is-open')) return;
    openPk.close(false);
  }, true);
  window.addEventListener('scroll', function (e) {
    if (!openPk) return;
    if (e.target && e.target.closest && e.target.closest('.cpk-pop')) return;
    openPk.close(false);
  }, true);
  window.addEventListener('resize', function () { if (openPk) openPk.place(); });

  CA.pick = enhance;
})();
