/* =========================================================
   Création Audio — Catalogue + fiche SPACER (partagé)
   Chargé par spacers.html (public : prix client, à plat) et
   dealer.html (portail : prix dealer + rabais quantité, tout est
   commandable même à stock 0). Rend :
     - le catalogue : recherche « véhicule ou code » + puces de taille + grille
     - la fiche : photos (vignettes + visionneuse), prix, quantité, spécifications,
       puis sections Description / Compatibilité / Haut-parleurs (sans onglets), même taille
   Le panier et l'envoi restent dans la page hôte (callbacks) ; l'hôte
   route aussi l'URL : #/ = catalogue, #/s/<slug> = fiche — ou, en public,
   les vraies pages spacer/<slug>.html (o.pageHref / o.rootHref) générées
   par tools/build-spacer-pages.js, qui réutilise staticCatalog/staticProduct.
   Données (products_public / products_dealer) : attrs.description (résumé),
   attrs.speaker_size, attrs.fitment [{make, model, from, to, pos}],
   attrs.specs [{k, v}], attrs.long_desc, attrs.gallery [chemins],
   attrs.replaces [{brand, ref}] (pièces d'origine remplacées),
   attrs.speakers [{model, fit}] (haut-parleurs testés : 'ok' Confirmé / 'partial' Compatible*),
   attrs.aliases [anciens noms] (mémorisés au renommage : anciens liens, recherche).
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
  // pièces d'origine remplacées [{brand, ref}] (« Remplace PAC HKSB110 ») ; vide = conception Création Audio
  function replacesOf(p) {
    var r = p && p.attrs && Array.isArray(p.attrs.replaces) ? p.attrs.replaces : [];
    return r.map(function (x) { return { brand: String(x && x.brand || '').trim(), ref: String(x && x.ref || '').trim() }; })
      .filter(function (x) { return x.ref; });
  }
  function refLabel(x) { return (x.brand ? x.brand + ' ' : '') + x.ref; }
  // anciens noms (« AP 5 / SRX52V » avant CA-ADP-525-001) : anciens liens + recherche ; « A / B » compte pour A et B
  function aliasesOf(p) {
    var a = p && p.attrs && Array.isArray(p.attrs.aliases) ? p.attrs.aliases : [], out = [];
    a.forEach(function (s) {
      s = String(s || '').trim(); if (!s) return;
      out.push(s);
      if (s.indexOf('/') !== -1) s.split('/').forEach(function (x) { x = x.trim(); if (x) out.push(x); });
    });
    return out;
  }
  // haut-parleurs testés [{model, fit}] : fit 'ok' = Confirmé (100 % compatible, à fleur) ;
  // 'partial' = Compatible* (s'installe et fonctionne, ajustement imparfait)
  function speakersOf(p) {
    var s = p && p.attrs && Array.isArray(p.attrs.speakers) ? p.attrs.speakers : [];
    return s.map(function (x) {
      return { model: String(x && x.model || '').trim(), fit: x && (x.fit === 'partial' || x.ok === false) ? 'partial' : 'ok' };
    }).filter(function (x) { return x.model; })
      .sort(function (a, b) { return ((a.fit === 'ok' ? 0 : 1) - (b.fit === 'ok' ? 0 : 1)) || a.model.localeCompare(b.model, 'fr'); });
  }
  // marques citées (Metra, PAC…) : mention « marques de leurs propriétaires » sous la fiche / le catalogue
  function refBrands(list) {
    var seen = {}, out = [];
    list.forEach(function (p) {
      replacesOf(p).forEach(function (x) { var k = x.brand.toLowerCase(); if (x.brand && !seen[k]) { seen[k] = 1; out.push(x.brand); } });
    });
    return out.sort(function (a, b) { return a.localeCompare(b, 'fr'); });
  }
  // spk = des marques de haut-parleurs sont aussi citées (liste « Haut-parleurs »)
  function legalHtml(brands, spk) {
    if (!brands.length && !spk) return '';
    var names = brands.length > 1 ? brands.slice(0, -1).join(', ') + ' et ' + brands[brands.length - 1] : brands[0];
    var txt = !brands.length
      ? 'Les marques de haut-parleurs citées appartiennent à leurs propriétaires respectifs. Création Audio n\'est affiliée à aucun de ces fabricants ; elles indiquent seulement la compatibilité.'
      : brands.length > 1 || spk
        ? (spk ? brands.join(', ') + ' et les marques de haut-parleurs citées' : names) +
          ' sont des marques de leurs propriétaires respectifs. Création Audio n\'est affiliée à aucun de ces fabricants ; les références indiquent seulement la compatibilité.'
        : names + ' est une marque de son propriétaire. Création Audio n\'est pas affiliée à ce fabricant ; la référence indique seulement la compatibilité.';
    return '<p class="sp-legal">' + esc(txt) + '</p>';
  }
  function hasSpeakers(list) { return list.some(function (p) { return speakersOf(p).length > 0; }); }
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
    spk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8 8"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 5.5h16v10H9l-5 4z"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg>'
  };

  // nous joindre en un clic depuis la fiche (« Écris-nous… ») : Messenger, ou courriel pré-rempli
  var CONTACT = { messenger: 'https://m.me/61591945465745', email: 'contact@creationaudio.ca' };
  // lien « Écris-nous… » (classe .ask de site.css) -> Messenger, + « ou par courriel » pré-rempli
  function askLink(label, subject, body) {
    var mail = 'mailto:' + CONTACT.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    return '<a class="ask" href="' + esc(CONTACT.messenger) + '" target="_blank" rel="noopener">' + esc(label) + '</a>' +
      '<span class="ask-alt"> ou <a href="' + esc(mail) + '">par courriel</a></span>';
  }

  // options de la boutique publique : spacers.html ET pages générées (même rendu à l'octet près)
  var PUBLIC = {
    addLabel: 'Ajouter au panier',
    assureHtml: '<li>' + IC.pin + 'Ramassage local à Québec, sur rendez-vous</li>' +
      '<li>' + IC.chat + 'Commande par Messenger ou courriel — on confirme la dispo</li>' +
      '<li>' + IC.card + 'Aucun paiement en ligne</li>',
    emptyHint: 'Ton véhicule n\'y est pas ? On en imprime sur mesure : ' +
      askLink('écris-nous', 'Spacer sur mesure', 'Bonjour,\n\nJe cherche un spacer pour mon véhicule.\nVéhicule (marque, modèle, année) : \nTaille du haut-parleur : \n\nMerci !') + '.'
  };

  function create(o) {
    var sb = o.sb;
    var isDealer = o.mode === 'dealer';
    var catalogEl = o.catalogEl, productEl = o.productEl;
    var listEl = o.listEl || catalogEl;   // où poser recherche + grille (l'en-tête de page peut rester dans le HTML)
    var items = [], byId = {}, bySlug = {}, slugById = {}, byRef = {};
    var q = '', size = 'all', catScrollY = 0, screen = null, shellBuilt = false, firstShow = true;
    var curP = null, curQty = 1, curImg = 0, curImgs = [], fitOpen = false;
    var rootHref = o.rootHref || '#/';

    function publicUrl(path) {
      if (!path || !sb) return '';
      try { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return ''; }
    }
    function maxQty(p) { return o.maxQty ? o.maxQty(p) : (p.qty | 0); }
    // public + client connecté (o.backorder) : rupture commandable, comme le portail dealer
    function bo() { return !isDealer && !!(o.backorder && o.backorder()); }
    function unit(p, qty) { return isDealer ? tierPrice(p.sell_price, p.tiers, qty) : (+p.sell_price || 0); }
    function tiersFor(p) { return isDealer ? normalizeTiers(p.tiers).filter(function (t) { return t.min > 1; }) : []; }

    // pastille de stock : dealer = tout commandable (« Sur commande ») ; public = rupture
    // (rendu statique des pages générées : sans le nombre, qui bouge à chaque vente — le JS le remet)
    function stockBadge(p) {
      var st = p.qty | 0;
      if (st > 0 && o.staticRender) return { cls: 'ok', text: 'En stock' };
      if (st > 0) return { cls: 'ok', text: isDealer ? st + ' en stock' : plural(st, 'paire en stock', 'paires en stock') };
      return isDealer || bo() ? { cls: 'order', text: 'Sur commande' } : { cls: 'out', text: 'Rupture de stock' };
    }

    /* ---------- données ---------- */
    function setItems(list) {
      items = (list || []).slice();
      byId = {}; bySlug = {}; slugById = {}; byRef = {};
      items.forEach(function (p) {
        byId[p.id] = p;
        var s = p.slug || slugify(p.name);
        if (bySlug[s]) s = s + '-' + String(p.id).slice(0, 4);
        bySlug[s] = p; slugById[p.id] = s;
        // ancien lien « #/s/hksb110 » (pièce d'origine) ou « #/s/ap-5-srx52v » (ancien nom) -> même fiche
        replacesOf(p).forEach(function (x) { var k = slugify(x.ref); if (!byRef[k]) byRef[k] = p; });
        aliasesOf(p).forEach(function (x) { var k = slugify(x); if (!byRef[k]) byRef[k] = p; });
      });
      if (curP) curP = byId[curP.id] || null;
    }
    function slugOf(p) { return slugById[p.id] || slugify(p.name); }
    function hrefOf(p) {
      var s = slugOf(p), page = o.pageHref ? o.pageHref(s) : null;
      return page || '#/s/' + encodeURIComponent(s);
    }
    function findBySlug(seg) {
      var s = seg; try { s = decodeURIComponent(seg); } catch (e) {}
      return bySlug[s] || byId[s] || byRef[s] || null;
    }

    /* ---------- recherche : « civic 2008 », « hsb524 », « hyundai »… ----------
       Mots : cherchés dans le code, le résumé, la taille et la compatibilité.
       Années (4 chiffres) : doivent tomber dans l'intervalle d'une ligne de
       compatibilité QUI correspond aussi aux mots (« civic 2015 » ne trouve pas
       un spacer Civic 2006–2011 + Accord 2013–2017). Sans compatibilité
       structurée, repli sur les années écrites dans le résumé (« 2006-2021 »). */
    function baseText(p) {
      var a = p.attrs || {};
      var refs = replacesOf(p).map(function (x) { return x.brand + ' ' + x.ref + ' ' + x.ref.replace(/[^a-z0-9]/gi, ''); });
      var spk = speakersOf(p).map(function (x) { return x.model + ' ' + x.model.replace(/[^a-z0-9]/gi, ''); });
      var old = aliasesOf(p).map(function (x) { return x + ' ' + x.replace(/[^a-z0-9]/gi, ''); });
      return norm([p.name, String(p.name || '').replace(/[^a-z0-9]/gi, ''), a.description, sizeOf(p)].concat(refs, spk, old).join(' '));
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
      var noAdd = !isDealer && !bo() && (p.qty | 0) <= 0, refs = replacesOf(p), spk = speakersOf(p);
      var tags = (sz ? '<span class="sp-tag">' + esc(sz) + '</span>' : '') +
        (fit.length ? '<span class="sp-tag is-fit">' + IC.car + plural(fit.length, 'véhicule', 'véhicules') + '</span>' : '') +
        (spk.length ? '<span class="sp-tag is-fit">' + IC.spk + plural(spk.length, 'haut-parleur', 'haut-parleurs') + '</span>' : '');
      return '<article class="sp-card" data-id="' + esc(p.id) + '">' +
        '<a class="sp-card-link" href="' + esc(hrefOf(p)) + '">' +
          '<div class="mat-media">' +
            (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="sp-noimg">' + IC.photo + '</span>') +
          '</div>' +
          '<div class="sp-body">' +
            (tags ? '<div class="sp-tags">' + tags + '</div>' : '') +
            '<h3>' + esc(p.name) + '</h3>' +
            (refs.length ? '<p class="sp-repl">Remplace ' + esc(refs.map(refLabel).join(' · ')) + '</p>' : '') +
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

    // coquille du catalogue (aussi écrite telle quelle dans spacers.html par le générateur de pages)
    function shellHtml(chips, count, grid, legal) {
      return '<div class="spc-bar">' +
          '<div class="spc-search">' + IC.search +
            '<label class="sr-only" for="spc-q">Chercher un véhicule ou un code</label>' +
            '<input type="search" id="spc-q" placeholder="Véhicule ou code — ex. civic 2008" autocomplete="off" enterkeyhint="search">' +
            '<button type="button" class="spc-clear" aria-label="Effacer la recherche" hidden>&times;</button>' +
          '</div>' +
          '<div class="cat-chips spc-chips" role="group" aria-label="Taille du haut-parleur"' + (chips ? '' : ' hidden') + '>' + (chips || '') + '</div>' +
        '</div>' +
        '<p class="spc-count" aria-live="polite">' + (count || '') + '</p>' +
        '<div class="shop-grid spc-grid">' + (grid || '') + '</div>' +
        '<div class="spc-legal">' + (legal || '') + '</div>';
    }
    function buildCatalogShell() {
      shellBuilt = true;
      listEl.innerHTML = shellHtml();
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
    function chipsHtml() {
      var list = sizes();
      if (!list.length) return '';
      if (size !== 'all' && !list.some(function (s) { return s.size === size; })) size = 'all';
      return '<button type="button" class="chip" data-size="all" aria-current="' + (size === 'all') + '">Toutes <span class="chip-n">' + items.length + '</span></button>' +
        list.map(function (s) {
          return '<button type="button" class="chip" data-size="' + esc(s.size) + '" aria-current="' + (size === s.size) + '">' +
            esc(s.size) + ' <span class="chip-n">' + s.n + '</span></button>';
        }).join('');
    }
    function renderChips() {
      var box = $('.spc-chips', catalogEl); if (!box) return;
      var html = chipsHtml();
      box.hidden = !html; box.innerHTML = html;
      $$('.chip', box).forEach(function (c) {
        c.addEventListener('click', function () { size = c.getAttribute('data-size'); renderChips(); renderGrid(); });
      });
    }
    function countText(n) {
      return (q || size !== 'all')
        ? plural(n, 'spacer trouvé', 'spacers trouvés') + ' sur ' + items.length
        : plural(items.length, 'spacer', 'spacers');
    }
    function renderGrid() {
      var grid = $('.spc-grid', catalogEl), cnt = $('.spc-count', catalogEl), legal = $('.spc-legal', catalogEl);
      if (!grid) return;
      if (legal) legal.innerHTML = legalHtml(refBrands(items), hasSpeakers(items));
      if (!items.length) { grid.innerHTML = '<p class="empty">Aucun spacer disponible pour le moment.</p>'; if (cnt) cnt.textContent = ''; return; }
      var list = filtered();
      if (cnt) cnt.textContent = countText(list.length);
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
      if (!shellBuilt) buildCatalogShell();   // remplace aussi le catalogue pré-rendu (pages générées)
      renderChips(); renderGrid();
      productEl.hidden = true; catalogEl.hidden = false;
      if (fresh) {
        screen = 'catalog';
        if (o.onTitle) o.onTitle(null);
        // 1er affichage : on laisse le navigateur restaurer le défilement (retour depuis une fiche)
        if (!firstShow) requestAnimationFrame(function () { window.scrollTo(0, catScrollY || 0); });
      }
      firstShow = false;
    }
    // catalogue complet en HTML, sans câblage (spacers.html pré-rendu par le générateur de pages)
    function staticCatalog() {
      q = ''; size = 'all';
      return shellHtml(chipsHtml(), countText(items.length), items.map(cardHtml).join(''), legalHtml(refBrands(items), hasSpeakers(items)));
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
      if (!isDealer && !bo()) return '';
      var st = p.qty | 0, extra = curQty - st;
      if (extra <= 0) return '';
      return st > 0 ? st + ' en stock · ' + plural(extra, 'paire sera imprimée', 'paires seront imprimées') + ' sur commande'
        : 'Imprimé sur commande — on te confirme le délai.';
    }
    // spécifications à droite, sous le bouton d'achat (plus d'onglet : visibles d'un coup d'œil)
    function specsPanel(p) {
      var specs = specsOf(p);
      if (!specs.length) return '';
      return '<section class="sp-specs" aria-label="Spécifications"><p class="sp-specs-t">Spécifications</p><dl>' +
        specs.map(function (s) { return '<div><dt>' + esc(s.k) + '</dt><dd>' + esc(s.v) + '</dd></div>'; }).join('') + '</dl></section>';
    }

    var SPK = { ok: { cls: 'ok', label: 'Confirmé' }, partial: { cls: 'order', label: 'Compatible*' } };
    function spkPill(fit) { var s = SPK[fit] || SPK.ok; return '<span class="pill ' + s.cls + '">' + s.label + '</span>'; }
    // « Écris-nous… » de la fiche : courriel pré-rempli avec le nom du spacer
    function askHtml(p, label, question, field) {
      return askLink(label, 'Compatibilité — ' + p.name,
        'Bonjour,\n\nEst-ce que le spacer ' + p.name + ' ' + question + ' ?\n' + field + ' : \n\nMerci !');
    }
    // ce que veut dire chaque ajustement (sous le tableau de la section Haut-parleurs)
    function spkLegend(p) {
      return '<div class="spk-legend">' +
        '<p>' + spkPill('ok') + '<span>Testé par Création Audio : le haut-parleur s\'installe parfaitement et arrive au même niveau que l\'adaptateur. 100 % compatible.</span></p>' +
        '<p>' + spkPill('partial') + '<span>Testé : le haut-parleur s\'installe et fonctionne bien, mais l\'ajustement n\'est pas parfait. Par exemple, il n\'arrive pas tout à fait au même niveau que l\'adaptateur.</span></p>' +
        '<p class="spk-legend-more">Ton haut-parleur n\'est pas dans la liste ? ' +
          askHtml(p, 'Écris-nous le modèle avant de commander', 'convient à mon haut-parleur', 'Marque et modèle du haut-parleur') + '</p>' +
      '</div>';
    }

    // Bas de fiche en une seule page qui défile (plus d'onglets) : Description, puis Compatibilité
    // (FIT_SHOW premiers véhicules + « Voir les N véhicules »), puis Haut-parleurs.
    var FIT_SHOW = 10;
    function secHtml(id, title, n, html) {
      return '<section class="sp-sec" aria-labelledby="sp-sec-' + id + '">' +
        '<h2 class="sp-sec-t" id="sp-sec-' + id + '">' + esc(title) + (n ? '<span class="sp-sec-n">' + n + '</span>' : '') + '</h2>' +
        html + '</section>';
    }
    function detailsHtml(p) {
      var secs = [], fit = fitmentOf(p), spk = speakersOf(p);
      var paras = String((p.attrs && p.attrs.long_desc) || '').split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (paras.length) secs.push(secHtml('desc', 'Description', 0,
        '<div class="pdp-desc">' + paras.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>'));
      if (fit.length) {
        var sorted = fit.slice().sort(function (a, b) { return a.make.localeCompare(b.make, 'fr') || a.model.localeCompare(b.model, 'fr') || (a.from || 0) - (b.from || 0); });
        var anyPos = sorted.some(function (r) { return r.pos; }), more = sorted.length > FIT_SHOW;
        secs.push(secHtml('compat', 'Compatibilité', fit.length,
          '<div class="fit-wrap' + (more && !fitOpen ? ' is-collapsed' : '') + '"><table class="fit-table"><thead><tr><th>Marque</th><th>Modèle</th><th>Années</th>' + (anyPos ? '<th>Emplacement</th>' : '') + '</tr></thead><tbody>' +
            sorted.map(function (r, i) {
              var cls = i >= FIT_SHOW ? ' class="fit-x"' : (i === FIT_SHOW - 1 && more ? ' class="fit-cut"' : '');
              return '<tr' + cls + '><td>' + esc(r.make) + '</td><td>' + esc(r.model) + '</td><td class="yrs">' + esc(yearsText(r) || '—') + '</td>' +
                (anyPos ? '<td>' + esc(r.pos || '—') + '</td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div>' +
          (more ? '<button type="button" class="fit-more" data-n="' + sorted.length + '" aria-expanded="' + !!fitOpen + '">' +
            (fitOpen ? 'Voir moins' : 'Voir les ' + sorted.length + ' véhicules') + '</button>' : '') +
          '<p class="fit-note">Vérifie toujours la taille et la profondeur de ton haut-parleur. Un doute ? ' +
            askHtml(p, 'Écris-nous avant de commander', 'convient à mon véhicule', 'Véhicule (marque, modèle, année)') + '</p>'));
      }
      if (spk.length) secs.push(secHtml('spk', 'Haut-parleurs', spk.length,
        '<div class="fit-wrap"><table class="fit-table spk-table"><thead><tr><th>Haut-parleur</th><th>Ajustement</th></tr></thead><tbody>' +
          spk.map(function (x) { return '<tr><td>' + esc(x.model) + '</td><td>' + spkPill(x.fit) + '</td></tr>'; }).join('') +
          '</tbody></table></div>' + spkLegend(p)));
      return secs.length ? '<div class="pdp-details sp-details" id="sp-details">' + secs.join('') + '</div>' : '';
    }
    function relatedHtml(p) {
      var sz = sizeOf(p);
      var pool = items.filter(function (x) { return x !== p && (!sz || sizeOf(x) === sz); });
      if (!pool.length && sz) pool = items.filter(function (x) { return x !== p; });
      pool = pool.slice(0, 4);
      if (!pool.length) return '';
      return '<section class="pdp-related" aria-labelledby="sp-rel-title">' +
        '<div class="rel-head"><h2 id="sp-rel-title">' + (sz && pool.every(function (x) { return sizeOf(x) === sz; }) ? 'Autres spacers ' + esc(sz) : 'Autres spacers') + '</h2>' +
          '<a class="rel-link" href="' + esc(rootHref) + '">Tout le catalogue ' + IC.arrow + '</a></div>' +
        '<div class="shop-grid">' + pool.map(cardHtml).join('') + '</div>' +
      '</section>';
    }

    // pièce d'origine remplacée (« Remplace PAC HKSB110 ») ou conception maison
    function replHtml(p) {
      var refs = replacesOf(p);
      if (!refs.length) return '<p class="sp-repl is-own">Conception Création Audio</p>';
      return '<p class="sp-repl">Remplace ' + refs.map(function (x) { return '<b>' + esc(refLabel(x)) + '</b>'; }).join(' · ') + '</p>';
    }
    function productHtml() {
      var p = curP, b = stockBadge(p), max = maxQty(p), blocked = max <= 0;
      if (curQty > max && max > 0) curQty = max;
      if (curQty < 1) curQty = 1;
      curImgs = imagesOf(p);
      if (curImg >= curImgs.length) curImg = 0;
      var sz = sizeOf(p);
      var desc = p.attrs && p.attrs.description ? String(p.attrs.description) : '';
      return '<nav class="crumbs" aria-label="Fil d\'Ariane"><a href="' + esc(rootHref) + '">' + esc(o.rootLabel || 'Spacers') + '</a>' + IC.chev +
          '<span aria-current="page">' + esc(p.name) + '</span></nav>' +
        '<div class="pdp">' +
          '<div class="pdp-media">' + mediaHtml() + '</div>' +
          '<div class="pdp-panel">' +
            '<p class="pdp-eyebrow">Spacer' + (sz ? ' · ' + esc(sz) : '') + ' · vendu par paire</p>' +
            '<h1 class="pdp-name">' + esc(p.name) + '</h1>' +
            replHtml(p) +
            (desc ? '<p class="sp-summary">' + esc(desc) + '</p>' : '') +
            '<div class="pdp-priceline">' +
              '<span class="pdp-price">' + money(p.sell_price) + '<small>/ paire</small></span>' +
              '<span class="pill ' + (b.cls === 'ok' ? 'ok' : b.cls === 'order' ? 'order' : 'bad') + '">' + esc(b.text) + '</span>' +
            '</div>' +
            '<div class="sp-tiers-box">' + tierTableHtml(p) + '</div>' +
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
            specsPanel(p) +
          '</div>' +
        '</div>' +
        detailsHtml(p) +
        legalHtml(refBrands([p]), speakersOf(p).length > 0) +
        relatedHtml(p);
    }
    function renderProduct() {
      productEl.innerHTML = productHtml();
      wireProduct();
    }
    // fiche en HTML, sans câblage (pages spacer/<slug>.html du générateur) ; null si introuvable
    function staticProduct(seg) {
      var p = findBySlug(seg);
      if (!p) return null;
      curP = p; curQty = 1; curImg = 0; fitOpen = false;
      return productHtml();
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
      // « Voir les N véhicules » / « Voir moins » (l'état survit au rafraîchissement du stock)
      var fm = $('.fit-more', productEl);
      if (fm) fm.addEventListener('click', function () {
        fitOpen = !fitOpen;
        var wrap = fm.previousElementSibling;
        if (wrap) wrap.classList.toggle('is-collapsed', !fitOpen);
        fm.setAttribute('aria-expanded', String(fitOpen));
        fm.textContent = fitOpen ? 'Voir moins' : 'Voir les ' + fm.getAttribute('data-n') + ' véhicules';
        if (!fitOpen && wrap && wrap.getBoundingClientRect().top < 0) wrap.scrollIntoView({ block: 'start' });
      });
      var rel = $('.pdp-related', productEl); if (rel) wireAdds(rel);
    }

    function showProduct(seg) {
      var p = findBySlug(seg);
      if (!p) return false;
      var first = firstShow;   // 1er affichage (page générée, lien direct) : défilement laissé au navigateur
      firstShow = false;
      if (screen === 'catalog') catScrollY = window.pageYOffset;
      var same = screen === 'product' && curP === p;
      if (!same) { curP = p; curQty = 1; curImg = 0; fitOpen = false; }
      renderProduct();
      catalogEl.hidden = true; productEl.hidden = false;
      if (!same && !first) window.scrollTo(0, 0);
      screen = 'product';
      if (o.onTitle) o.onTitle(p);
      return true;
    }
    function hide() {
      firstShow = false;
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
      matches: matches, staticCatalog: staticCatalog, staticProduct: staticProduct
    };
  }

  window.CASpacers = { create: create, slugify: slugify, normalizeTiers: normalizeTiers, tierPrice: tierPrice,
    esc: esc, money: money, fitmentOf: fitmentOf, yearsText: yearsText,
    sizeOf: sizeOf, replacesOf: replacesOf, refLabel: refLabel, speakersOf: speakersOf, PUBLIC: PUBLIC, CONTACT: CONTACT };
})();
