/* =========================================================
   Création Audio — Catalogue + fiche SPACER (partagé)
   Chargé par spacers.html (public : prix client, à plat) et
   dealer.html (portail : prix dealer + rabais quantité, tout est
   commandable même à stock 0). Rend :
     - le catalogue : recherche « véhicule ou code » + puces de taille + grille
     - la fiche : photos (vignettes + visionneuse), prix, quantité,
       onglets Compatibilité / Spécifications / Description, même taille
   Le panier et l'envoi restent dans la page hôte (callbacks) ; l'hôte
   route aussi l'URL : #/ = catalogue, #/s/<slug> = fiche.
   Données (products_public / products_dealer) : attrs.description (résumé),
   attrs.speaker_size, attrs.fitment [{make, model, from, to, pos}],
   attrs.specs [{k, v}], attrs.long_desc, attrs.gallery [chemins].
   ========================================================= */
(function () {
  'use strict';

  var BUCKET = 'products';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return (Math.round((+n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' $'; }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function slugify(s) {
    return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'spacer';
  }
  function normalizeTiers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (t) { return { min: parseInt(t.min, 10), price: parseFloat(t.price) }; })
      .filter(function (t) { return isFinite(t.min) && t.min >= 1 && isFinite(t.price) && t.price >= 0; })
      .sort(function (a, b) { return a.min - b.min; });
  }
  function tierPrice(base, tiers, qty) {
    var p = +base || 0;
    normalizeTiers(tiers).forEach(function (t) { if (qty >= t.min) p = t.price; });
    return p;
  }
  function yearNum(v) { var n = parseInt(v, 10); return isFinite(n) && n >= 1900 && n <= 2100 ? n : null; }
  function fitmentOf(p) {
    var f = p && p.attrs && Array.isArray(p.attrs.fitment) ? p.attrs.fitment : [];
    return f.map(function (r) {
      return { make: String(r && r.make || '').trim(), model: String(r && r.model || '').trim(),
        from: yearNum(r && r.from), to: yearNum(r && r.to), pos: String(r && r.pos || '').trim() };
    }).filter(function (r) { return r.make || r.model; });
  }
  function yearsText(r) {
    if (r.from && r.to) return r.from === r.to ? String(r.from) : r.from + '–' + r.to;
    if (r.from) return r.from + ' et +';
    if (r.to) return 'jusqu\'à ' + r.to;
    return '';
  }
  function specsOf(p) {
    var s = p && p.attrs && Array.isArray(p.attrs.specs) ? p.attrs.specs : [];
    return s.filter(function (x) { return x && (x.k || x.v); });
  }
  function sizeOf(p) { return String(p && p.attrs && p.attrs.speaker_size || '').trim(); }
  // ordre des puces : 5,25" < 6,5" < 6×9 (moyenne des côtés = 7,5) < 8" ; texte (Tweeter…) à la fin
  function sizeRank(s) {
    var n = function (x) { return parseFloat(x.replace(',', '.')); };
    var m = /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i.exec(s);
    if (m) return (n(m[1]) + n(m[2])) / 2;
    m = /(\d+(?:[.,]\d+)?)/.exec(s);
    return m ? n(m[1]) : 999;
  }

  var IC = {
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8.5v5M8.5 11h5"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>',
    car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 16.5h14M4.5 16.5V12l2-5h11l2 5v4.5"/><path d="M4.5 12h15"/><circle cx="8" cy="16.5" r="1.8"/><circle cx="16" cy="16.5" r="1.8"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8 8"/></svg>'
  };

  function create(o) {
    var sb = o.sb;
    var isDealer = o.mode === 'dealer';
    var catalogEl = o.catalogEl, productEl = o.productEl;
    var listEl = o.listEl || catalogEl;   // où poser recherche + grille (l'en-tête de page peut rester dans le HTML)
    var items = [], byId = {}, bySlug = {}, slugById = {};
    var q = '', size = 'all', catScrollY = 0, screen = null;
    var curP = null, curQty = 1, curImg = 0, curImgs = [], curTab = null;

    function publicUrl(path) {
      if (!path || !sb) return '';
      try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
    }
    function maxQty(p) { return o.maxQty ? o.maxQty(p) : (p.qty | 0); }
    function unit(p, qty) { return isDealer ? tierPrice(p.sell_price, p.tiers, qty) : (+p.sell_price || 0); }
    function tiersFor(p) { return isDealer ? normalizeTiers(p.tiers).filter(function (t) { return t.min > 1; }) : []; }

    // pastille de stock : dealer = tout commandable (« Sur commande ») ; public = rupture
    function stockBadge(p) {
      var st = p.qty | 0;
      if (st > 0) return { cls: 'ok', text: isDealer ? st + ' en stock' : plural(st, 'paire en stock', 'paires en stock') };
      return isDealer ? { cls: 'order', text: 'Sur commande' } : { cls: 'out', text: 'Rupture de stock' };
    }

    /* ---------- données ---------- */
    function setItems(list) {
      items = (list || []).slice();
      byId = {}; bySlug = {}; slugById = {};
      items.forEach(function (p) {
        byId[p.id] = p;
        var s = p.slug || slugify(p.name);
        if (bySlug[s]) s = s + '-' + String(p.id).slice(0, 4);
        bySlug[s] = p; slugById[p.id] = s;
      });
      if (curP) curP = byId[curP.id] || null;
    }
    function slugOf(p) { return slugById[p.id] || slugify(p.name); }
    function hrefOf(p) { return '#/s/' + encodeURIComponent(slugOf(p)); }
    function findBySlug(seg) {
      var s = seg; try { s = decodeURIComponent(seg); } catch (e) {}
      return bySlug[s] || byId[s] || null;
    }

    /* ---------- recherche : « civic 2008 », « hsb524 », « hyundai »… ----------
       Mots : cherchés dans le code, le résumé, la taille et la compatibilité.
       Années (4 chiffres) : doivent tomber dans l'intervalle d'une ligne de
       compatibilité QUI correspond aussi aux mots (« civic 2015 » ne trouve pas
       un spacer Civic 2006–2011 + Accord 2013–2017). Sans compatibilité
       structurée, repli sur les années écrites dans le résumé (« 2006-2021 »). */
    function baseText(p) {
      var a = p.attrs || {};
      return norm([p.name, String(p.name || '').replace(/[^a-z0-9]/gi, ''), a.description, sizeOf(p)].join(' '));
    }
    function rangesIn(txt) {
      var out = [], re = /((?:19|20)\d{2})\s*(?:-|–|à|a|to)\s*((?:19|20)\d{2})|((?:19|20)\d{2})/g, m;
      while ((m = re.exec(txt))) {
        if (m[1]) out.push([+m[1], +m[2]]); else out.push([+m[3], +m[3]]);
      }
      return out;
    }
    function matches(p, query) {
      var toks = norm(query).split(/[\s,;/]+/).filter(Boolean);
      if (!toks.length) return true;
      var words = toks.filter(function (t) { return !/^(19|20)\d{2}$/.test(t); });
      var years = toks.filter(function (t) { return /^(19|20)\d{2}$/.test(t); }).map(Number);
      var base = baseText(p), fit = fitmentOf(p);
      if (fit.length) {
        var hit = fit.some(function (r) {
          var rt = norm([r.make, r.model, r.pos].join(' '));
          var okW = words.every(function (w) { return rt.indexOf(w) !== -1 || base.indexOf(w) !== -1; });
          var okY = years.every(function (y) {
            if (!r.from && !r.to) return true;   // ligne sans années : ne filtre pas
            return (r.from || 0) <= y && y <= (r.to || 9999);
          });
          return okW && okY;
        });
        if (hit) return true;
        if (years.length) return false;          // une année demandée ne tombe dans aucun véhicule
      }
      var all = base + ' ' + norm((p.attrs && p.attrs.long_desc) || '');
      if (!words.every(function (w) { return all.indexOf(w) !== -1; })) return false;
      if (!years.length) return true;
      var ranges = rangesIn(all);
      if (!ranges.length) return false;
      return years.every(function (y) { return ranges.some(function (r) { return r[0] <= y && y <= r[1]; }); });
    }

    /* ---------- catalogue ---------- */
    function sizes() {
      var seen = {};
      items.forEach(function (p) { var s = sizeOf(p); if (s) seen[s] = (seen[s] || 0) + 1; });
      return Object.keys(seen).sort(function (a, b) { return sizeRank(a) - sizeRank(b) || a.localeCompare(b, 'fr'); })
        .map(function (s) { return { size: s, n: seen[s] }; });
    }
    function filtered() {
      return items.filter(function (p) { return (size === 'all' || sizeOf(p) === size) && matches(p, q); });
    }

    function priceRows(p) {
      var rows = [{ min: 1, price: +p.sell_price || 0 }].concat(tiersFor(p));
      return rows.map(function (t, i) {
        var label = t.min === 1 ? '1 paire' : (t.min + '+ paires');
        return '<div class="sp-pr' + (i === 0 ? ' base' : '') + '">' + (i === 0 && !isDealer ? '' : label + ' : ') + money(t.price) +
          (i === 0 && !isDealer ? ' <small>/ paire</small>' : '') + '</div>';
      }).join('');
    }
    function cardHtml(p) {
      var url = publicUrl(p.image_path), sz = sizeOf(p), fit = fitmentOf(p), b = stockBadge(p);
      var desc = p.attrs && p.attrs.description ? String(p.attrs.description) : '';
      var noAdd = !isDealer && (p.qty | 0) <= 0;
      var tags = (sz ? '<span class="sp-tag">' + esc(sz) + '</span>' : '') +
        (fit.length ? '<span class="sp-tag is-fit">' + IC.car + plural(fit.length, 'véhicule', 'véhicules') + '</span>' : '');
      return '<article class="sp-card" data-id="' + esc(p.id) + '">' +
        '<a class="sp-card-link" href="' + esc(hrefOf(p)) + '">' +
          '<div class="mat-media">' +
            (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="sp-noimg">' + IC.photo + '</span>') +
          '</div>' +
          '<div class="sp-body">' +
            (tags ? '<div class="sp-tags">' + tags + '</div>' : '') +
            '<h3>' + esc(p.name) + '</h3>' +
            (desc ? '<p class="sp-desc">' + esc(desc) + '</p>' : '') +
            '<span class="sp-stock ' + b.cls + '">' + esc(b.text) + '</span>' +
          '</div>' +
        '</a>' +
        '<div class="sp-buy">' +
          '<div class="sp-prices">' + priceRows(p) + '</div>' +
          '<button class="add-btn sp-add" type="button" data-id="' + esc(p.id) + '"' + (noAdd ? ' disabled' : '') +
            ' aria-label="' + esc((noAdd ? 'Rupture : ' : (o.addLabel || 'Ajouter') + ' : ') + p.name) + '">' +
            (noAdd ? 'Rupture de stock' : esc(o.addLabel || 'Ajouter')) + '</button>' +
        '</div>' +
      '</article>';
    }
    function wireAdds(root) {
      $$('.sp-add', root).forEach(function (b) {
        b.addEventListener('click', function () {
          var p = byId[b.getAttribute('data-id')]; if (!p) return;
          var card = b.closest('.sp-card');
          var src = card ? (card.querySelector('.mat-media img') || card.querySelector('.mat-media')) : b;
          if (o.onAdd) o.onAdd(p, 1, src);
        });
      });
    }

    function buildCatalogShell() {
      listEl.innerHTML =
        '<div class="spc-bar">' +
          '<div class="spc-search">' + IC.search +
            '<label class="sr-only" for="spc-q">Chercher un véhicule ou un code</label>' +
            '<input type="search" id="spc-q" placeholder="Véhicule ou code — ex. civic 2008" autocomplete="off" enterkeyhint="search">' +
            '<button type="button" class="spc-clear" aria-label="Effacer la recherche" hidden>&times;</button>' +
          '</div>' +
          '<div class="cat-chips spc-chips" role="group" aria-label="Taille du haut-parleur"></div>' +
        '</div>' +
        '<p class="spc-count" aria-live="polite"></p>' +
        '<div class="shop-grid spc-grid"></div>';
      var input = $('#spc-q', catalogEl), clear = $('.spc-clear', catalogEl);
      input.value = q;
      var t;
      input.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () { q = input.value; clear.hidden = !q; renderGrid(); }, 90);
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Escape' && input.value) { input.value = ''; q = ''; clear.hidden = true; renderGrid(); } });
      clear.addEventListener('click', function () { input.value = ''; q = ''; clear.hidden = true; renderGrid(); input.focus(); });
      clear.hidden = !q;
    }
    function renderChips() {
      var box = $('.spc-chips', catalogEl); if (!box) return;
      var list = sizes();
      if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
      if (size !== 'all' && !list.some(function (s) { return s.size === size; })) size = 'all';
      box.hidden = false;
      box.innerHTML = '<button type="button" class="chip" data-size="all" aria-current="' + (size === 'all') + '">Toutes <span class="chip-n">' + items.length + '</span></button>' +
        list.map(function (s) {
          return '<button type="button" class="chip" data-size="' + esc(s.size) + '" aria-current="' + (size === s.size) + '">' +
            esc(s.size) + ' <span class="chip-n">' + s.n + '</span></button>';
        }).join('');
      $$('.chip', box).forEach(function (c) {
        c.addEventListener('click', function () { size = c.getAttribute('data-size'); renderChips(); renderGrid(); });
      });
    }
    function renderGrid() {
      var grid = $('.spc-grid', catalogEl), cnt = $('.spc-count', catalogEl);
      if (!grid) return;
      if (!items.length) { grid.innerHTML = '<p class="empty">Aucun spacer disponible pour le moment.</p>'; if (cnt) cnt.textContent = ''; return; }
      var list = filtered();
      if (cnt) cnt.textContent = (q || size !== 'all')
        ? plural(list.length, 'spacer trouvé', 'spacers trouvés') + ' sur ' + items.length
        : plural(items.length, 'spacer', 'spacers');
      if (!list.length) {
        grid.innerHTML = '<p class="empty">Aucun spacer ne correspond' + (q ? ' à « ' + esc(q) + ' »' : '') + '.<br>' +
          '<button type="button" class="spc-reset">Tout afficher</button>' + (o.emptyHint ? '<br>' + o.emptyHint : '') + '</p>';
        $('.spc-reset', grid).addEventListener('click', function () {
          q = ''; size = 'all';
          var i = $('#spc-q', catalogEl); if (i) i.value = '';
          var c = $('.spc-clear', catalogEl); if (c) c.hidden = true;
          renderChips(); renderGrid();
        });
        return;
      }
      grid.innerHTML = list.map(cardHtml).join('');
      wireAdds(grid);
    }

    function showCatalog() {
      var fresh = screen !== 'catalog';
      if (!$('.spc-grid', catalogEl)) buildCatalogShell();
      renderChips(); renderGrid();
      productEl.hidden = true; catalogEl.hidden = false;
      if (fresh) {
        screen = 'catalog';
        if (o.onTitle) o.onTitle(null);
        requestAnimationFrame(function () { window.scrollTo(0, catScrollY || 0); });
      }
    }

    /* ---------- fiche ---------- */
    function imagesOf(p) {
      var seen = {}, out = [];
      [p.image_path].concat(p.attrs && Array.isArray(p.attrs.gallery) ? p.attrs.gallery : []).forEach(function (path) {
        if (typeof path !== 'string' || !path || seen[path]) return;
        seen[path] = 1; var u = publicUrl(path); if (u) out.push(u);
      });
      return out;
    }
    function mediaHtml() {
      var u = curImgs[curImg];
      var stage = u
        ? '<button type="button" class="pdp-stage" aria-label="Agrandir la photo"><img src="' + esc(u) + '" alt="' + esc(curP.name) + '">' +
            '<span class="pdp-zoom" aria-hidden="true">' + IC.zoom + '</span></button>'
        : '<div class="pdp-stage no-zoom"><span class="sp-noimg big">' + IC.photo + '</span></div>';
      var thumbs = curImgs.length > 1 ? '<div class="pdp-thumbs">' + curImgs.map(function (t, i) {
        return '<button type="button" class="pdp-thumb' + (i === curImg ? ' is-active' : '') + '" data-i="' + i + '"' +
          ' aria-label="Photo ' + (i + 1) + ' sur ' + curImgs.length + '"' + (i === curImg ? ' aria-current="true"' : '') + '>' +
          '<img src="' + esc(t) + '" alt="" loading="lazy"></button>';
      }).join('') + '</div>' : '';
      return stage + thumbs;
    }
    function wireMedia() {
      var stage = $('.pdp-stage', productEl);
      if (stage && stage.tagName === 'BUTTON') stage.addEventListener('click', function () { openLightbox(curImgs, curImg); });
      $$('.pdp-thumb', productEl).forEach(function (b) {
        b.addEventListener('click', function () {
          curImg = +b.getAttribute('data-i');
          var box = $('.pdp-media', productEl); box.innerHTML = mediaHtml(); wireMedia();
          var t = $('.pdp-thumb[data-i="' + curImg + '"]', productEl); if (t) t.focus();
        });
      });
    }

    function tierTableHtml(p) {
      var tiers = tiersFor(p);
      if (!tiers.length) return '';
      var base = +p.sell_price || 0;
      var rows = [{ min: 1, price: base }].concat(tiers);
      var active = 0;
      rows.forEach(function (t, i) { if (curQty >= t.min) active = i; });
      return '<div class="sp-tiertable" role="table" aria-label="Prix selon la quantité">' +
        rows.map(function (t, i) {
          var next = rows[i + 1];
          var lbl = next ? (t.min === next.min - 1 ? plural(t.min, 'paire', 'paires') : t.min + ' à ' + (next.min - 1) + ' paires') : t.min + ' paires et +';
          var pct = base > 0 && t.price < base ? Math.round((1 - t.price / base) * 100) : 0;
          return '<div class="sp-tr' + (i === active ? ' is-active' : '') + '" role="row">' +
            '<span role="cell">' + esc(lbl) + '</span>' +
            '<span role="cell" class="sp-tr-p">' + money(t.price) + (pct ? ' <em>−' + pct + ' %</em>' : '') + '</span></div>';
        }).join('') + '</div>';
    }
    function buySumText(p) {
      var u = unit(p, curQty), base = +p.sell_price || 0;
      if (curQty < 2) return '';
      return curQty + ' × ' + money(u) + ' = <b>' + money(u * curQty) + '</b>' + (u < base ? ' <em>· rabais quantité</em>' : '');
    }
    function madeNote(p) {
      if (!isDealer) return '';
      var st = p.qty | 0, extra = curQty - st;
      if (extra <= 0) return '';
      return st > 0 ? st + ' en stock · ' + plural(extra, 'paire sera imprimée', 'paires seront imprimées') + ' sur commande'
        : 'Imprimé sur commande — on te confirme le délai.';
    }
    function fitSummary(p) {
      var fit = fitmentOf(p);
      if (!fit.length) return '';
      var shown = fit.slice(0, 3).map(function (r) {
        return '<li>' + esc([r.make, r.model].filter(Boolean).join(' ')) + (yearsText(r) ? ' <span>' + esc(yearsText(r)) + '</span>' : '') + '</li>';
      }).join('');
      return '<div class="sp-fitsum"><p class="sp-fitsum-t">' + IC.car + 'Compatible avec</p><ul>' + shown + '</ul>' +
        (fit.length > 3 ? '<button type="button" class="sp-fitmore">Voir les ' + fit.length + ' véhicules</button>' : '') + '</div>';
    }

    function detailsTabs(p) {
      var tabs = [], fit = fitmentOf(p), specs = specsOf(p);
      var paras = String((p.attrs && p.attrs.long_desc) || '').split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (fit.length) {
        var sorted = fit.slice().sort(function (a, b) { return a.make.localeCompare(b.make, 'fr') || a.model.localeCompare(b.model, 'fr') || (a.from || 0) - (b.from || 0); });
        var anyPos = sorted.some(function (r) { return r.pos; });
        tabs.push({ id: 'compat', label: 'Compatibilité', n: fit.length,
          html: '<div class="fit-wrap"><table class="fit-table"><thead><tr><th>Marque</th><th>Modèle</th><th>Années</th>' + (anyPos ? '<th>Emplacement</th>' : '') + '</tr></thead><tbody>' +
            sorted.map(function (r) {
              return '<tr><td>' + esc(r.make) + '</td><td>' + esc(r.model) + '</td><td class="yrs">' + esc(yearsText(r) || '—') + '</td>' +
                (anyPos ? '<td>' + esc(r.pos || '—') + '</td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div>' +
            '<p class="fit-note">Vérifie toujours la taille et la profondeur de ton haut-parleur. Un doute ? Écris-nous avant de commander.</p>' });
      }
      if (specs.length) tabs.push({ id: 'specs', label: 'Spécifications',
        html: '<dl class="specs">' + specs.map(function (s) { return '<div class="spec"><dt>' + esc(s.k) + '</dt><dd>' + esc(s.v) + '</dd></div>'; }).join('') + '</dl>' });
      if (paras.length) tabs.push({ id: 'desc', label: 'Description',
        html: '<div class="pdp-desc">' + paras.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>' });
      if (!tabs.length) return '';
      if (!curTab || !tabs.some(function (t) { return t.id === curTab; })) curTab = tabs[0].id;
      return '<section class="pdp-details" id="sp-details" aria-label="Détails">' +
        '<div class="tabs" role="tablist" aria-label="Détails du spacer">' + tabs.map(function (t) {
          var on = t.id === curTab;
          return '<button type="button" class="tab" role="tab" id="tab-' + t.id + '" aria-controls="panel-' + t.id + '" aria-selected="' + on + '" tabindex="' + (on ? '0' : '-1') + '">' +
            esc(t.label) + (t.n ? '<span class="tab-n">' + t.n + '</span>' : '') + '</button>';
        }).join('') + '</div>' +
        tabs.map(function (t) {
          return '<div class="tabpanel" role="tabpanel" id="panel-' + t.id + '" aria-labelledby="tab-' + t.id + '" tabindex="0"' + (t.id === curTab ? '' : ' hidden') + '>' + t.html + '</div>';
        }).join('') +
      '</section>';
    }
    function selectTab(id, focus) {
      curTab = id;
      $$('.pdp-details .tab', productEl).forEach(function (t) {
        var on = t.id === 'tab-' + id;
        t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      $$('.pdp-details .tabpanel', productEl).forEach(function (pn) { pn.hidden = pn.id !== 'panel-' + id; });
    }
    function relatedHtml(p) {
      var sz = sizeOf(p);
      var pool = items.filter(function (x) { return x !== p && (!sz || sizeOf(x) === sz); });
      if (!pool.length && sz) pool = items.filter(function (x) { return x !== p; });
      pool = pool.slice(0, 4);
      if (!pool.length) return '';
      return '<section class="pdp-related" aria-labelledby="sp-rel-title">' +
        '<div class="rel-head"><h2 id="sp-rel-title">' + (sz && pool.every(function (x) { return sizeOf(x) === sz; }) ? 'Autres spacers ' + esc(sz) : 'Autres spacers') + '</h2>' +
          '<a class="rel-link" href="#/">Tout le catalogue ' + IC.arrow + '</a></div>' +
        '<div class="shop-grid">' + pool.map(cardHtml).join('') + '</div>' +
      '</section>';
    }

    function renderProduct() {
      var p = curP, b = stockBadge(p), max = maxQty(p), blocked = max <= 0;
      if (curQty > max && max > 0) curQty = max;
      if (curQty < 1) curQty = 1;
      curImgs = imagesOf(p);
      if (curImg >= curImgs.length) curImg = 0;
      var sz = sizeOf(p);
      var desc = p.attrs && p.attrs.description ? String(p.attrs.description) : '';
      productEl.innerHTML =
        '<nav class="crumbs" aria-label="Fil d\'Ariane"><a href="#/">' + esc(o.rootLabel || 'Spacers') + '</a>' + IC.chev +
          '<span aria-current="page">' + esc(p.name) + '</span></nav>' +
        '<div class="pdp">' +
          '<div class="pdp-media">' + mediaHtml() + '</div>' +
          '<div class="pdp-panel">' +
            '<p class="pdp-eyebrow">Spacer' + (sz ? ' · ' + esc(sz) : '') + ' · vendu par paire</p>' +
            '<h1 class="pdp-name">' + esc(p.name) + '</h1>' +
            (desc ? '<p class="sp-summary">' + esc(desc) + '</p>' : '') +
            '<div class="pdp-priceline">' +
              '<span class="pdp-price">' + money(p.sell_price) + '<small>/ paire</small></span>' +
              '<span class="pill ' + (b.cls === 'ok' ? 'ok' : b.cls === 'order' ? 'order' : 'bad') + '">' + esc(b.text) + '</span>' +
            '</div>' +
            '<div class="sp-tiers-box">' + tierTableHtml(p) + '</div>' +
            fitSummary(p) +
            '<div class="cfg-buy">' +
              (blocked ? '' :
              '<div class="qty">' +
                '<button type="button" class="q-minus" aria-label="Diminuer la quantité">&minus;</button>' +
                '<input type="number" class="q-val" aria-label="Quantité (paires)" min="1" max="' + max + '" value="' + curQty + '" inputmode="numeric">' +
                '<button type="button" class="q-plus" aria-label="Augmenter la quantité">+</button>' +
              '</div>') +
              '<button type="button" class="btn-add"' + (blocked ? ' disabled' : '') + '>' + IC.cart + (blocked ? 'Rupture de stock' : esc(o.addLabel || 'Ajouter')) + '</button>' +
            '</div>' +
            '<p class="buy-sum" aria-live="polite">' + buySumText(p) + '</p>' +
            '<p class="sp-made" aria-live="polite">' + esc(madeNote(p)) + '</p>' +
            (o.assureHtml ? '<ul class="pdp-assure">' + o.assureHtml + '</ul>' : '') +
          '</div>' +
        '</div>' +
        detailsTabs(p) +
        relatedHtml(p);
      wireProduct();
    }
    function refreshBuy() {
      var p = curP;
      var sum = $('.buy-sum', productEl); if (sum) sum.innerHTML = buySumText(p);
      var made = $('.sp-made', productEl); if (made) made.textContent = madeNote(p);
      var tb = $('.sp-tiers-box', productEl); if (tb) tb.innerHTML = tierTableHtml(p);
      var inp = $('.q-val', productEl); if (inp && +inp.value !== curQty) inp.value = curQty;
      var minus = $('.q-minus', productEl); if (minus) minus.disabled = curQty <= 1;
      var plus = $('.q-plus', productEl); if (plus) plus.disabled = curQty >= maxQty(p);
    }
    function wireProduct() {
      var p = curP;
      wireMedia();
      function setQ(n) {
        var max = maxQty(p);
        n = parseInt(n, 10); if (!isFinite(n) || n < 1) n = 1; if (n > max) n = max;
        curQty = n; refreshBuy();
      }
      var minus = $('.q-minus', productEl), plus = $('.q-plus', productEl), inp = $('.q-val', productEl);
      if (minus) minus.addEventListener('click', function () { setQ(curQty - 1); });
      if (plus) plus.addEventListener('click', function () { setQ(curQty + 1); });
      if (inp) {
        inp.addEventListener('change', function () { setQ(inp.value); });
        inp.addEventListener('focus', function () { inp.select(); });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); setQ(inp.value); } });
      }
      refreshBuy();
      var add = $('.btn-add', productEl);
      if (add) add.addEventListener('click', function () {
        if (inp) setQ(inp.value);
        var src = $('.pdp-stage img', productEl) || $('.pdp-stage', productEl);
        if (o.onAdd) o.onAdd(p, curQty, src);
      });
      var more = $('.sp-fitmore', productEl);
      if (more) more.addEventListener('click', function () {
        selectTab('compat');
        var d = $('#sp-details', productEl); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      var tabs = $$('.pdp-details .tab', productEl);
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { selectTab(t.id.replace('tab-', '')); });
        t.addEventListener('keydown', function (e) {
          var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return; e.preventDefault();
          var n = tabs[(i + d + tabs.length) % tabs.length]; selectTab(n.id.replace('tab-', ''), true);
        });
      });
      var rel = $('.pdp-related', productEl); if (rel) wireAdds(rel);
    }

    function showProduct(seg) {
      var p = findBySlug(seg);
      if (!p) return false;
      if (screen === 'catalog') catScrollY = window.pageYOffset;
      var same = screen === 'product' && curP === p;
      if (!same) { curP = p; curQty = 1; curImg = 0; curTab = null; }
      renderProduct();
      catalogEl.hidden = true; productEl.hidden = false;
      if (!same) window.scrollTo(0, 0);
      screen = 'product';
      if (o.onTitle) o.onTitle(p);
      return true;
    }
    function hide() {
      if (screen === 'catalog') catScrollY = window.pageYOffset;
      catalogEl.hidden = true; productEl.hidden = true; screen = null;
    }
    // re-rendu après un rafraîchissement du stock, sans perdre la recherche ni la quantité choisie
    function refresh() {
      if (screen === 'catalog') { renderChips(); renderGrid(); }
      else if (screen === 'product' && curP) {
        if (!byId[curP.id]) return;
        var y = window.pageYOffset; renderProduct(); window.scrollTo(0, y);
      }
    }

    /* ---------- visionneuse plein écran (flèches, Échap, clic hors photo) ---------- */
    function openLightbox(urls, idx) {
      urls = (urls || []).filter(Boolean);
      if (!urls.length) return;
      var i = Math.max(0, Math.min(idx || 0, urls.length - 1)), back = document.activeElement, multi = urls.length > 1;
      var ov = document.createElement('div');
      ov.className = 'lb';
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Photo agrandie');
      ov.innerHTML = '<img alt="">' +
        '<button type="button" class="lb-btn lb-close" aria-label="Fermer">&times;</button>' +
        (multi ? '<button type="button" class="lb-btn lb-prev" aria-label="Photo précédente">&#8249;</button>' +
                 '<button type="button" class="lb-btn lb-next" aria-label="Photo suivante">&#8250;</button>' +
                 '<div class="lb-count" aria-live="polite"></div>' : '');
      var img = $('img', ov), cnt = $('.lb-count', ov);
      function show() { img.src = urls[i]; if (cnt) cnt.textContent = (i + 1) + ' / ' + urls.length; }
      function go(d) { i = (i + d + urls.length) % urls.length; show(); }
      function close() {
        document.removeEventListener('keydown', onKey, true);
        document.body.classList.remove('cart-lock');
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        if (back && back.focus) back.focus();
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
        else if (multi && e.key === 'ArrowLeft') go(-1);
        else if (multi && e.key === 'ArrowRight') go(1);
        else if (e.key === 'Tab') {
          var f = $$('button', ov), a = f.indexOf(document.activeElement);
          e.preventDefault(); f[(a + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
      }
      ov.addEventListener('click', function (e) {
        var t = e.target;
        if (t.closest('.lb-prev')) return go(-1);
        if (t.closest('.lb-next')) return go(1);
        if (t === img && multi) return go(1);
        close();
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(ov);
      document.body.classList.add('cart-lock');
      show();
      $('.lb-close', ov).focus();
      requestAnimationFrame(function () { ov.classList.add('show'); });
    }

    return {
      setItems: setItems, items: function () { return items; }, byId: function (id) { return byId[id] || null; },
      slugOf: slugOf, hrefOf: hrefOf, findBySlug: findBySlug,
      showCatalog: showCatalog, showProduct: showProduct, hide: hide, refresh: refresh,
      screen: function () { return screen; }, current: function () { return curP; },
      matches: matches
    };
  }

  window.CASpacers = { create: create, slugify: slugify, normalizeTiers: normalizeTiers, tierPrice: tierPrice,
    esc: esc, money: money, fitmentOf: fitmentOf, yearsText: yearsText };
})();
