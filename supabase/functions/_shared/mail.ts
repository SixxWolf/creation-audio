// =========================================================
// Création Audio — gabarit commun des courriels (Edge Functions *-notify, dealer-request, compte-code)
// Même langage que le courriel de facture (invoice-notify/email.ts) : carte blanche sur fond crème,
// filet orange, nom de l'entreprise à gauche, étiquette + n° à droite, vignettes 56 px dans un cadre
// fin, bloc total noir avec trait orange, bouton orange arrondi, pied « Une question ? ».
// Mise en page en tableaux + styles en ligne (Gmail, Outlook) ; Inter / Space Grotesk là où le
// client les accepte, repli Segoe UI / Roboto / Arial ailleurs. Mode sombre : prefers-color-scheme
// + [data-ogsc]/[data-ogsb] d'Outlook.com ; ailleurs, le client inverse lui-même.
// Les blocs reçoivent du HTML déjà échappé (esc) : seul `page()` assemble.
// Déploiement : ce fichier est importé par « ../_shared/mail.ts » → l'envoyer avec chaque fonction.
// =========================================================

export const SITE = "https://creationaudio.ca";

const INK = "#181A1F", SOFT = "#6C727C", LINE = "#E7E7E2", BAND = "#F4F3EF", EMBER = "#FF6A2B";
const SANS = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISP = "'Space Grotesk',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TBL = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

export function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}
export const nl2br = (s: unknown) => esc(s).replace(/\r?\n/g, "<br>");
// en = client de la version anglaise : « $1,049.70 » ; sinon « 1049,70 $ »
export function money(n: unknown, en = false) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  if (en) return "$" + v.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toFixed(2).replace(".", ",") + " $";
}

// ---- coordonnées du pied (admin_settings « entreprise », lues une fois par instance) ----
export type Company = { name?: string; city?: string; phone?: string };
let CO: Company = { name: "Création Audio", city: "Québec, QC", phone: "581-446-3858" };
let coLoaded = false;
// deno-lint-ignore no-explicit-any
export async function loadCompany(db: any) {
  if (coLoaded) return;
  try {
    const { data } = await db.from("admin_settings")
      .select("name:value->>name, city:value->>city, phone:value->>phone").eq("key", "entreprise").maybeSingle();
    if (data) CO = { name: data.name || CO.name, city: data.city || CO.city, phone: data.phone || CO.phone };
    coLoaded = true;
  } catch { /* repli : valeurs par défaut */ }
}

// ---- blocs ----
const ink = (size = 15, lh = 23) => 'class="ink" style="margin:0 0 12px;font-family:' + SANS + ';font-size:' + size + 'px;line-height:' + lh + 'px;color:' + INK + '"';

/** Paragraphe (HTML échappé). */
export const text = (html: string) => '<p ' + ink() + '>' + html + '</p>';
/** Petite ligne grise. */
export const small = (html: string, mt = 0) =>
  '<p class="soft" style="margin:' + mt + 'px 0 12px;font-family:' + SANS + ';font-size:13px;line-height:19px;color:' + SOFT + '">' + html + '</p>';
/** Coordonnées d'un client (avis à l'admin) : nom · courriel · téléphone. */
export function who(name: unknown, email: unknown, phone?: unknown, extra?: string) {
  const bits = [name ? '<strong class="ink" style="color:' + INK + '">' + esc(name) + '</strong>' : "",
    email ? '<a href="mailto:' + esc(email) + '" class="soft" style="color:' + SOFT + '">' + esc(email) + '</a>' : "",
    phone ? '<a href="tel:+1' + String(phone).replace(/\D/g, "").slice(-10) + '" class="soft" style="color:' + SOFT + '">' + esc(phone) + '</a>' : ""].filter(Boolean);
  return '<p class="soft" style="margin:0 0 16px;font-family:' + SANS + ';font-size:14px;line-height:21px;color:' + SOFT + '">' +
    bits.join(" · ") + (extra ? "<br>" + extra : "") + '</p>';
}

export type Tone = "ok" | "warn" | "bad" | "info";
const TONE: Record<Tone, [string, string, string]> = {   // [bande, fond, texte]
  ok: ["#1E9E5E", "#E9F6EF", "#16794A"],
  warn: [EMBER, "#FFF3EC", "#9A4A0E"],
  bad: ["#D2402B", "#FDECEA", "#B42A19"],
  info: ["#B9BBB5", BAND, INK],
};
/** Encadré d'état (HTML échappé), trait de couleur à gauche. */
export function notice(html: string, tone: Tone = "info") {
  const [bar, bg, fg] = TONE[tone];
  return '<table ' + TBL + ' width="100%" style="margin:0 0 18px"><tr>' +
    '<td width="4" style="width:4px;background:' + bar + ';font-size:0;line-height:0;border-radius:4px 0 0 4px">&nbsp;</td>' +
    '<td class="nt-' + tone + '" style="background:' + bg + ';padding:13px 16px;border-radius:0 8px 8px 0;font-family:' + SANS +
    ';font-size:15px;line-height:22px;font-weight:600;color:' + fg + '">' + html + '</td></tr></table>';
}
/** Panneau crème (note, citation, message, détails). */
export const panel = (html: string, mb = 10) =>
  '<table ' + TBL + ' width="100%" style="margin:0 0 ' + mb + 'px"><tr><td class="panel ink" style="background:' + BAND +
  ';border-radius:10px;padding:14px 16px;font-family:' + SANS + ';font-size:15px;line-height:22px;color:' + INK + '">' + html + '</td></tr></table>';
/** Lignes libellé → valeur dans un panneau (valeurs en HTML échappé). */
export function kv(rows: [string, string][], mb = 18) {
  const r = rows.filter(([, v]) => v);
  if (!r.length) return "";
  return panel(r.map(([k, v]) =>
    '<div class="soft" style="font-size:11px;line-height:14px;letter-spacing:.1em;font-weight:600;text-transform:uppercase;color:' + SOFT + '">' + esc(k) + '</div>' +
    '<div class="ink" style="font-size:15px;line-height:22px;color:' + INK + '">' + v + '</div>').join('<div style="height:10px;line-height:10px;font-size:0">&nbsp;</div>'), mb);
}
/** Mot du client / de Création Audio (citation). */
export const quote = (t: unknown, label?: string) => {
  const s = String(t ?? "").trim();
  return s ? panel((label ? '<strong>' + esc(label) + '</strong> ' : "") + nl2br(s), 18) : "";
};
/** Bouton principal. */
export function button(url: string, label: string, mt = 8) {
  return '<table ' + TBL + ' style="margin:' + mt + 'px 0 14px"><tr><td style="background:' + EMBER + ';border-radius:100px">' +
    '<a href="' + esc(url) + '" class="btn" style="display:inline-block;padding:13px 26px;font-family:' + SANS +
    ';font-size:15px;font-weight:600;line-height:20px;color:' + INK + ';text-decoration:none;border-radius:100px">' + esc(label) + '</a></td></tr></table>';
}
/** Gros code à 6 chiffres. */
export const codeBox = (code: string) =>
  '<table ' + TBL + ' style="margin:6px 0 18px"><tr><td class="panel ink" style="background:' + BAND + ';border-radius:12px;padding:16px 24px;' +
  'font-family:' + DISP + ';font-size:34px;line-height:40px;font-weight:700;letter-spacing:.18em;color:' + INK + '">' + esc(code) + '</td></tr></table>';
/** Photos (messagerie) : vignettes 120 px cliquables. */
export function photoGrid(urls: string[]) {
  if (!urls.length) return "";
  return '<div style="margin:0 0 12px">' + urls.map((u, i) =>
    '<a href="' + esc(u) + '" style="display:inline-block;margin:0 6px 6px 0"><img src="' + esc(u) + '" alt="Photo ' + (i + 1) +
    '" width="120" height="120" style="display:block;width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid ' + LINE + '"></a>').join("") + '</div>';
}

// ---- articles ----
export type Thumb = { src: string; w: number; h: number } | null;
export type ItemLine = {
  label: unknown;            // nom de l'article
  meta?: unknown;            // marque · matériau · format
  sub?: string;              // ligne grise de plus (HTML échappé), ex. « 2 × 15,00 $ »
  flag?: { text: string; tone: Tone };   // ex. « 2 à commander · 3 à 14 jours »
  right?: string;            // montant de droite (texte, échappé ici)
  thumb?: Thumb;
};
const FLAG: Record<Tone, string> = { ok: "#16794A", warn: "#B23F12", bad: "#B42A19", info: SOFT };
/** Liste des articles avec vignettes (colonne photo seulement si au moins une photo). */
export function items(lines: ItemLine[]) {
  if (!lines.length) return "";
  const pics = lines.some((l) => l.thumb);
  const rows = lines.map((l, i) => {
    const bd = i === lines.length - 1 ? "" : "border-bottom:1px solid " + LINE + ";";
    const t = l.thumb;
    const img = t ? '<img src="' + esc(t.src) + '" width="' + t.w + '" height="' + t.h + '" alt="" style="display:block;border:0;outline:none;width:' + t.w + 'px;height:' + t.h + 'px">' : "&nbsp;";
    const subs = [l.meta ? esc(l.meta) : "", l.sub || ""].filter(Boolean)
      .map((s) => '<div class="soft" style="font-size:13px;line-height:18px;color:' + SOFT + '">' + s + '</div>').join("") +
      (l.flag ? '<div class="fl-' + l.flag.tone + '" style="padding-top:3px;font-size:13px;line-height:18px;font-weight:600;color:' + FLAG[l.flag.tone] + '">' + esc(l.flag.text) + '</div>' : "");
    return '<tr>' +
      (pics ? '<td valign="top" width="56" class="ln" style="padding:14px 0;' + bd + 'width:56px">' +
        '<table ' + TBL + ' width="56"><tr><td class="thumb" width="56" height="56" align="center" valign="middle" style="width:56px;height:56px;background:#FFFFFF;border:1px solid ' + LINE +
        ';border-radius:8px;mso-line-height-rule:exactly;line-height:0;font-size:0">' + img + '</td></tr></table></td>' : "") +
      '<td valign="top" class="ln" style="padding:14px 12px 14px ' + (pics ? 14 : 0) + 'px;' + bd + 'font-family:' + SANS + '">' +
        '<div class="ink" style="font-size:15px;line-height:20px;font-weight:600;color:' + INK + '">' + esc(l.label) + '</div>' + subs + '</td>' +
      '<td valign="top" align="right" class="ink ln" style="padding:14px 0;' + bd + 'font-family:' + SANS + ';font-size:15px;line-height:20px;font-weight:600;color:' + INK + ';white-space:nowrap">' + esc(l.right ?? "") + '</td>' +
      '</tr>';
  }).join("");
  return '<table ' + TBL + ' width="100%" class="ln" style="border-top:2px solid ' + INK + ';margin:4px 0 0">' + rows + '</table>';
}
/** Bloc total noir (trait orange), aligné à droite ; lignes grises en dessous. */
export function totalBox(label: string, value: string, notes: string[] = [], pre: [string, string][] = []) {
  const preRows = pre.length
    ? '<table ' + TBL + ' width="100%" style="margin:0 0 8px">' + pre.map(([k, v]) =>
      '<tr><td class="soft" style="padding:3px 0;font-family:' + SANS + ';font-size:14px;color:' + SOFT + '">' + esc(k) + '</td>' +
      '<td align="right" class="ink" style="padding:3px 0;font-family:' + SANS + ';font-size:14px;color:' + INK + ';white-space:nowrap">' + esc(v) + '</td></tr>').join("") + '</table>'
    : "";
  return '<table ' + TBL + ' width="100%" style="margin:8px 0 6px"><tr><td>' +
    '<table ' + TBL + ' align="right" class="tot" width="280" style="width:280px"><tr><td style="padding-top:10px">' + preRows +
      '<table ' + TBL + ' width="100%"><tr>' +
        '<td width="4" style="width:4px;background:' + EMBER + ';font-size:0;line-height:0">&nbsp;</td>' +
        '<td class="totbox" style="background:' + INK + ';padding:14px 18px;font-family:' + SANS + '">' +
          '<table ' + TBL + ' width="100%"><tr>' +
          '<td style="font-size:14px;font-weight:600;color:#FFFFFF;font-family:' + SANS + '">' + esc(label) + '</td>' +
          '<td align="right" style="font-family:' + DISP + ';font-size:22px;line-height:26px;font-weight:700;color:#FFFFFF;white-space:nowrap">' + esc(value) + '</td>' +
          '</tr></table></td></tr></table>' +
      notes.filter(Boolean).map((n) => '<div class="soft" style="padding-top:8px;text-align:right;font-family:' + SANS + ';font-size:13px;line-height:18px;color:' + SOFT + '">' + n + '</div>').join("") +
    '</td></tr></table></td></tr></table>';
}

// ---- page ----
export type PageOpts = {
  lang: "fr" | "en";
  title: string;             // grand titre (texte)
  tag?: string;              // étiquette en haut à droite (« COMMANDE », « RÉSERVATION »…)
  ref?: string;              // n° sous l'étiquette (C-0026)
  refSub?: string;           // date ou autre sous le n°
  preheader?: string;        // aperçu dans la boîte de réception
  body: string;              // blocs ci-dessus
  foot?: string | null;      // première ligne du pied (HTML) ; null = aucune ; défaut = « Une question ? … »
  admin?: boolean;           // avis à Création Audio : pas de ligne « Une question ? »
  after?: string;            // petite mention grise sous la carte (HTML échappé)
};
export function page(o: PageOpts) {
  const en = o.lang === "en";
  const T = (fr: string, e: string) => (en ? e : fr);
  const site = SITE + (en ? "/en/" : "/");
  const footLead = o.foot === undefined ? (o.admin ? null : T("Une question&nbsp;? Réponds simplement à ce courriel.", "A question? Just reply to this email.")) : o.foot;
  const footBits = [esc(CO.name || "Création Audio"), CO.city ? esc(CO.city) : "",
    '<a href="' + esc(site) + '" class="soft" style="color:' + SOFT + ';text-decoration:underline">' + esc(SITE.replace(/^https?:\/\//, "")) + '</a>'].filter(Boolean);
  const pad = "padding-left:32px;padding-right:32px";
  const right = o.tag || o.ref
    ? '<td valign="top" align="right" style="font-family:' + SANS + '">' +
        '<table ' + TBL + ' align="right"><tr><td style="width:28px;height:3px;background:' + EMBER + ';font-size:0;line-height:0">&nbsp;</td></tr></table>' +
        (o.tag ? '<div class="soft" style="clear:both;padding-top:8px;font-size:11px;line-height:14px;letter-spacing:.12em;font-weight:600;color:' + SOFT + '">' + esc(o.tag.toUpperCase()) + '</div>' : "") +
        (o.ref ? '<div class="ink" style="clear:both;' + (o.tag ? "" : "padding-top:8px;") + 'font-family:' + DISP + ';font-size:17px;line-height:22px;font-weight:700;color:' + INK + ';white-space:nowrap">' + esc(o.ref) + '</div>' : "") +
        (o.refSub ? '<div class="soft" style="font-size:13px;line-height:18px;color:' + SOFT + ';white-space:nowrap">' + esc(o.refSub) + '</div>' : "") +
      '</td>'
    : "";
  return '<!doctype html><html lang="' + o.lang + '"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">' +
    '<title>' + esc(o.title) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">' +
    '<style>' +
      ':root{color-scheme:light dark;supported-color-schemes:light dark}' +
      'body{margin:0;padding:0;-webkit-text-size-adjust:100%}a{color:inherit}' +
      '@media (max-width:520px){.pad{padding-left:20px!important;padding-right:20px!important}.h1{font-size:22px!important;line-height:28px!important}' +
        '.tot{width:100%!important}.outer{padding:0!important}.card{border-radius:0!important}}' +
      '@media (prefers-color-scheme:dark){' +
        '.bg{background:#111316!important}.card{background:#1C1F24!important}.panel{background:#262A30!important}' +
        '.ink{color:#EEEFF1!important}.soft{color:#A2A8B0!important}' +
        '.rule td,.ln{border-color:#30343B!important}' +
        '.totbox{background:#000000!important}.btn{color:#181A1F!important}' +
        '.nt-ok{background:#16301F!important;color:#7FD9A4!important}.nt-warn{background:#3A2416!important;color:#FFB48A!important}' +
        '.nt-bad{background:#3A1A16!important;color:#FF9B8A!important}.nt-info{background:#262A30!important;color:#EEEFF1!important}' +
        '.fl-ok{color:#7FD9A4!important}.fl-warn{color:#FFB48A!important}.fl-bad{color:#FF9B8A!important}}' +
      '[data-ogsb] .bg{background:#111316!important}[data-ogsb] .card{background:#1C1F24!important}[data-ogsb] .panel{background:#262A30!important}' +
      '[data-ogsc] .ink{color:#EEEFF1!important}[data-ogsc] .soft{color:#A2A8B0!important}' +
    '</style></head>' +
    '<body class="bg" style="margin:0;padding:0;background:' + BAND + '">' +
    (o.preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">' + esc(o.preheader) + '&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>' : "") +
    '<table ' + TBL + ' class="bg" width="100%" style="background:' + BAND + '"><tr>' +
    '<td align="center" class="outer" style="padding:28px 12px">' +
    '<table ' + TBL + ' class="card" width="100%" style="max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden">' +
      '<tr><td style="height:6px;background:' + EMBER + ';font-size:0;line-height:0">&nbsp;</td></tr>' +
      '<tr><td class="pad" style="padding-top:28px;' + pad + '">' +
        '<table ' + TBL + ' width="100%"><tr>' +
        '<td valign="top" class="ink" style="font-family:' + DISP + ';font-size:22px;line-height:28px;font-weight:700;color:' + INK + '">' + esc(CO.name || "Création Audio") + '</td>' +
        right + '</tr></table>' +
      '</td></tr>' +
      '<tr><td class="pad" style="padding-top:26px;' + pad + ';font-family:' + SANS + '">' +
        '<h1 class="ink h1" style="margin:0 0 14px;font-family:' + DISP + ';font-size:26px;line-height:32px;font-weight:700;color:' + INK + '">' + esc(o.title) + '</h1>' +
        o.body +
      '</td></tr>' +
      '<tr><td class="pad" style="padding-top:14px;padding-bottom:28px;' + pad + '">' +
        '<table ' + TBL + ' width="100%"><tr class="rule"><td style="border-top:1px solid ' + LINE + ';font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>' +
        (footLead ? '<p class="ink" style="margin:18px 0 6px;font-family:' + SANS + ';font-size:14px;line-height:20px;color:' + INK + '">' + footLead + '</p>' : '<div style="height:14px;line-height:14px;font-size:0">&nbsp;</div>') +
        '<p class="soft" style="margin:0;font-family:' + SANS + ';font-size:12px;line-height:18px;color:' + SOFT + '">' +
          footBits.join(" · ") + (CO.phone ? '<br>' + esc(CO.phone) : '') + '</p>' +
      '</td></tr>' +
    '</table>' +
    (o.after ? '<p class="soft" style="max-width:560px;margin:14px auto 0;padding:0 8px;font-family:' + SANS + ';font-size:12px;line-height:17px;color:' + SOFT + '">' + o.after + '</p>' : '') +
    '</td></tr></table></body></html>';
}

// ---- photos des articles ----
// Produit relié : filament = photo du format (attrs.img_spool / img_refill, sinon image_path),
// spacer / accessoire = image_path. Storage : réduite par /render/image (200 px, entière) ; taille
// lue dans les octets pour garder les proportions dans la case de 52 px. Photo introuvable = case
// vide, jamais d'échec de l'envoi. Outlook Windows ne lit pas le WebP → &format=origin.
function imageSize(b: Uint8Array | null): { w: number; h: number } | null {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}
function fit(sz: { w: number; h: number } | null, box = 52) {
  if (!sz || !sz.w || !sz.h) return { w: box, h: box };
  const k = box / Math.max(sz.w, sz.h);
  return { w: Math.max(1, Math.round(sz.w * k)), h: Math.max(1, Math.round(sz.h * k)) };
}
// deno-lint-ignore no-explicit-any
export async function thumbs(db: any, rows: { product_id?: string | null; kind?: string | null }[]): Promise<Thumb[]> {
  try {
    const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const ids = [...new Set(rows.map((r) => r.product_id).filter(Boolean))] as string[];
    if (!ids.length) return rows.map(() => null);
    // deno-lint-ignore no-explicit-any
    const prods: Record<string, any> = {};
    const { data } = await db.from("products").select("id, type, image_path, attrs").in("id", ids);
    for (const p of data || []) prods[p.id] = p;
    const urlOf = (r: { product_id?: string | null; kind?: string | null }) => {
      const p = r.product_id ? prods[r.product_id] : null;
      if (!p) return "";
      const a = p.attrs || {};
      const path = String((p.type === "filament" && (r.kind === "refill" ? a.img_refill : a.img_spool)) || p.image_path || "");
      if (!path) return "";
      if (/^https?:\/\//i.test(path)) return path;
      if (path.startsWith("/")) return SITE + path.replace(/\.webp$/i, ".png");
      if (!base) return "";
      return base + "/storage/v1/render/image/public/products/" + path.split("/").map(encodeURIComponent).join("/") +
        "?width=200&height=200&resize=contain&quality=80";
    };
    const cache: Record<string, Promise<Thumb>> = {};
    const get = (u: string) => cache[u] ??= (async () => {
      try {
        const r = await fetch(u, { headers: { Accept: "image/png,image/jpeg" }, signal: AbortSignal.timeout(6000) });
        if (!r.ok) return null;
        const b = new Uint8Array(await r.arrayBuffer());
        if (!b.length) return null;
        const sz = fit(imageSize(b));
        const src = u.includes("/render/image/") && !/\.webp\?/i.test(u) ? u + "&format=origin" : u;
        return { src, w: sz.w, h: sz.h };
      } catch { return null; }
    })();
    return await Promise.all(rows.map((r) => { const u = urlOf(r); return u ? get(u) : Promise.resolve(null); }));
  } catch { return rows.map(() => null); }
}
