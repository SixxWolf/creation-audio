// =========================================================
// Création Audio — HTML du courriel « Ta facture est jointe » (Edge Function invoice-notify).
// Même langage que le PDF (design « A · Accent ») : filet orange, FACTURE à droite, vignettes 56 px
// dans un cadre fin, bloc total noir avec trait orange. Mise en page en tableaux + styles en ligne
// (Gmail, Outlook) ; Inter / Space Grotesk via Google Fonts là où le client les accepte (Apple Mail,
// iOS, Thunderbird…), repli Segoe UI / Roboto / Arial ailleurs. Mode sombre : media query
// prefers-color-scheme + sélecteurs [data-ogsc]/[data-ogsb] d'Outlook.com ; ailleurs, le client inverse.
// Ne reçoit jamais coût ni marge.
// =========================================================
import { dateTxt, money, qtyTxt, type Company, type InvoiceHead } from "./pdf.ts";

// src : adresse publique de la photo ; w/h : taille d'affichage (≤ 52 px, proportions gardées)
export type EmailLine = { label?: string | null; meta?: string | null; qty: number; unit_price: number; line_total: number;
  src?: string | null; w?: number; h?: number };

const INK = "#181A1F", SOFT = "#6C727C", LINE = "#E7E7E2", BAND = "#F4F3EF", EMBER = "#FF6A2B";
const SANS = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISP = "'Space Grotesk',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}

// Taille d'une image PNG / JPEG (octets) → { w, h } ; null si illisible
export function imageSize(b: Uint8Array | null | undefined): { w: number; h: number } | null {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}
export function fitBox(sz: { w: number; h: number } | null, box = 52): { w: number; h: number } {
  if (!sz || !sz.w || !sz.h) return { w: box, h: box };
  const k = box / Math.max(sz.w, sz.h);
  return { w: Math.max(1, Math.round(sz.w * k)), h: Math.max(1, Math.round(sz.h * k)) };
}

export function buildInvoiceEmail(o: { company: Company; invoice: InvoiceHead; lines: EmailLine[]; lang: "fr" | "en"; accUrl: string; site: string }): string {
  const en = o.lang === "en";
  const T = (fr: string, e: string) => (en ? e : fr);
  const inv = o.invoice, co = o.company || {};
  const m = (n: unknown) => esc(money(n, en));
  const first = String(inv.client_name || "").trim().split(/\s+/)[0] || "";
  const dateStr = dateTxt(inv.invoice_date, en);
  const payTxt = inv.pay_method === "cash" ? T("Comptant", "Cash") : inv.pay_method === "interac" ? T("Virement Interac", "Interac e-Transfer") : "";
  const coName = String(co.name || "Création Audio");
  const siteLabel = o.site.replace(/^https?:\/\//, "");

  const rows = o.lines.map((l, i) => {
    const last = i === o.lines.length - 1;
    const bd = last ? "" : "border-bottom:1px solid " + LINE + ";";
    const img = l.src
      ? '<img src="' + esc(l.src) + '" width="' + (l.w || 52) + '" height="' + (l.h || 52) + '" alt="" style="display:block;border:0;outline:none;width:' + (l.w || 52) + 'px;height:' + (l.h || 52) + 'px">'
      : "&nbsp;";
    const sub = [l.meta ? esc(l.meta) : "", esc(qtyTxt(l.qty, en)) + " × " + m(l.unit_price)];
    return '<tr>' +
      '<td valign="top" width="56" class="ln" style="padding:14px 0;' + bd + 'width:56px">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="56"><tr>' +
        '<td class="thumb" width="56" height="56" align="center" valign="middle" style="width:56px;height:56px;background:#FFFFFF;border:1px solid ' + LINE + ';border-radius:8px;mso-line-height-rule:exactly;line-height:0;font-size:0">' + img + '</td>' +
        '</tr></table></td>' +
      '<td valign="top" class="tx ln" style="padding:14px 12px 14px 14px;' + bd + 'font-family:' + SANS + '">' +
        '<div class="ink" style="font-size:15px;line-height:20px;font-weight:600;color:' + INK + '">' + esc(l.label) + '</div>' +
        sub.filter(Boolean).map((s) => '<div class="soft" style="font-size:13px;line-height:18px;color:' + SOFT + '">' + s + '</div>').join("") +
      '</td>' +
      '<td valign="top" align="right" class="ink ln" style="padding:14px 0;' + bd + 'font-family:' + SANS + ';font-size:15px;line-height:20px;font-weight:600;color:' + INK + ';white-space:nowrap">' + m(l.line_total) + '</td>' +
      '</tr>';
  }).join("");

  const sumRow = (lab: string, val: string) =>
    '<tr><td class="soft" style="padding:3px 0;font-family:' + SANS + ';font-size:14px;color:' + SOFT + '">' + lab + '</td>' +
    '<td align="right" class="ink" style="padding:3px 0;font-family:' + SANS + ';font-size:14px;color:' + INK + ';white-space:nowrap">' + val + '</td></tr>';
  const taxes = inv.tax_enabled
    ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 10px">' +
      sumRow(T("Sous-total", "Subtotal"), m(inv.subtotal)) + sumRow(T("TPS", "GST"), m(inv.tax_gst)) + sumRow(T("TVQ", "QST"), m(inv.tax_qst)) + '</table>'
    : "";

  const footBits = [esc(coName), co.city ? esc(co.city) : "", '<a href="' + esc(o.site + (en ? "/en/" : "/")) + '" class="soft" style="color:' + SOFT + ';text-decoration:underline">' + esc(siteLabel) + '</a>'].filter(Boolean);
  const footBits2 = [co.phone ? esc(co.phone) : ""].filter(Boolean);

  const preheader = T("Facture ", "Invoice ") + inv.number + " · " + money(inv.total, en) + (payTxt ? " · " + payTxt : "");
  const pad = "padding-left:32px;padding-right:32px";

  return '<!doctype html><html lang="' + o.lang + '"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">' +
    '<title>' + esc(T("Facture ", "Invoice ") + inv.number) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">' +
    '<style>' +
      ':root{color-scheme:light dark;supported-color-schemes:light dark}' +
      'body{margin:0;padding:0;-webkit-text-size-adjust:100%}' +
      'a{color:inherit}' +
      '@media (max-width:520px){.pad{padding-left:20px!important;padding-right:20px!important}.h1{font-size:22px!important;line-height:28px!important}' +
        '.tot{width:100%!important}.outer{padding:0!important}.card{border-radius:0!important}}' +
      '@media (prefers-color-scheme:dark){' +
        '.bg{background:#111316!important}.card{background:#1C1F24!important}' +
        '.ink{color:#EEEFF1!important}.soft{color:#A2A8B0!important}' +
        '.rule td,.ln{border-color:#30343B!important}' +
        '.totbox{background:#000000!important}.btn{color:#181A1F!important}}' +
      '[data-ogsb] .bg{background:#111316!important}[data-ogsb] .card{background:#1C1F24!important}' +
      '[data-ogsc] .ink{color:#EEEFF1!important}[data-ogsc] .soft{color:#A2A8B0!important}' +
    '</style></head>' +
    '<body class="bg" style="margin:0;padding:0;background:' + BAND + '">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">' + esc(preheader) + '&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>' +
    '<table role="presentation" class="bg" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:' + BAND + '"><tr>' +
    '<td align="center" class="outer" style="padding:28px 12px">' +
    '<table role="presentation" class="card" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden">' +
      // filet d'accent
      '<tr><td style="height:6px;background:' + EMBER + ';font-size:0;line-height:0">&nbsp;</td></tr>' +
      // en-tête : nom à gauche, FACTURE / n° / date à droite
      '<tr><td class="pad" style="padding-top:28px;' + pad + '">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
        '<td valign="top" class="ink" style="font-family:' + DISP + ';font-size:22px;line-height:28px;font-weight:700;color:' + INK + '">' + esc(coName) + '</td>' +
        '<td valign="top" align="right" style="font-family:' + SANS + '">' +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr><td style="width:28px;height:3px;background:' + EMBER + ';font-size:0;line-height:0">&nbsp;</td></tr></table>' +
          '<div class="soft" style="clear:both;padding-top:8px;font-size:11px;line-height:14px;letter-spacing:.12em;font-weight:600;color:' + SOFT + '">' + T("FACTURE", "INVOICE") + '</div>' +
          '<div class="ink" style="font-family:' + DISP + ';font-size:17px;line-height:22px;font-weight:700;color:' + INK + ';white-space:nowrap">' + esc(inv.number) + '</div>' +
          '<div class="soft" style="font-size:13px;line-height:18px;color:' + SOFT + ';white-space:nowrap">' + esc(dateStr) + '</div>' +
        '</td></tr></table>' +
      '</td></tr>' +
      // titre + mot
      '<tr><td class="pad" style="padding-top:26px;' + pad + ';font-family:' + SANS + '">' +
        '<h1 class="ink h1" style="margin:0 0 12px;font-family:' + DISP + ';font-size:26px;line-height:32px;font-weight:700;color:' + INK + '">' + T("Ta facture est jointe", "Your invoice is attached") + '</h1>' +
        '<p class="ink" style="margin:0 0 4px;font-size:15px;line-height:23px;color:' + INK + '">' + T("Bonjour ", "Hello ") + esc(first) + ',</p>' +
        '<p class="ink" style="margin:0;font-size:15px;line-height:23px;color:' + INK + '">' +
          T("Voici ta facture <strong>" + esc(inv.number) + "</strong> du " + esc(dateStr) + ", en PDF. Merci pour ta commande&nbsp;!",
            "Here is your invoice <strong>" + esc(inv.number) + "</strong> from " + esc(dateStr) + ", as a PDF. Thank you for your order!") + '</p>' +
      '</td></tr>' +
      // articles
      '<tr><td class="pad" style="padding-top:22px;' + pad + '">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="ln" style="border-top:2px solid ' + INK + '">' + rows + '</table>' +
      '</td></tr>' +
      // totaux
      '<tr><td class="pad" style="padding-top:8px;' + pad + '">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" class="tot" width="280" style="width:280px">' +
          '<tr><td style="padding-top:10px">' + taxes +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
            '<td width="4" style="width:4px;background:' + EMBER + ';font-size:0;line-height:0">&nbsp;</td>' +
            '<td class="totbox" style="background:' + INK + ';padding:14px 18px;font-family:' + SANS + '">' +
              '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
              '<td style="font-size:14px;font-weight:600;color:#FFFFFF;font-family:' + SANS + '">Total</td>' +
              '<td align="right" style="font-family:' + DISP + ';font-size:22px;line-height:26px;font-weight:700;color:#FFFFFF;white-space:nowrap">' + m(inv.total) + '</td>' +
              '</tr></table></td>' +
          '</tr></table>' +
          (payTxt ? '<div class="soft" style="padding-top:8px;text-align:right;font-family:' + SANS + ';font-size:13px;line-height:18px;color:' + SOFT + '">' + T("Paiement : ", "Payment: ") + esc(payTxt) + '</div>' : '') +
          '</td></tr></table>' +
      '</td></tr>' +
      // bouton
      '<tr><td class="pad" style="padding-top:30px;' + pad + '">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
        '<td style="background:' + EMBER + ';border-radius:100px">' +
          '<a href="' + esc(o.accUrl) + '" class="btn" style="display:inline-block;padding:13px 26px;font-family:' + SANS + ';font-size:15px;font-weight:600;line-height:20px;color:' + INK + ';text-decoration:none;border-radius:100px">' +
          T("Voir mon compte", "Open my account") + '</a></td>' +
        '</tr></table>' +
        '<p class="soft" style="margin:12px 0 0;font-family:' + SANS + ';font-size:13px;line-height:19px;color:' + SOFT + '">' +
          T("Toutes tes factures restent dans ton compte.", "All your invoices stay in your account.") + '</p>' +
      '</td></tr>' +
      // pied
      '<tr><td class="pad" style="padding-top:28px;padding-bottom:28px;' + pad + '">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr class="rule"><td style="border-top:1px solid ' + LINE + ';font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>' +
        '<p class="ink" style="margin:18px 0 6px;font-family:' + SANS + ';font-size:14px;line-height:20px;color:' + INK + '">' +
          T("Une question&nbsp;? Réponds simplement à ce courriel.", "A question? Just reply to this email.") + '</p>' +
        '<p class="soft" style="margin:0;font-family:' + SANS + ';font-size:12px;line-height:18px;color:' + SOFT + '">' +
          footBits.join(" · ") + (footBits2.length ? '<br>' + footBits2.join(" · ") : '') + '</p>' +
      '</td></tr>' +
    '</table>' +
    '</td></tr></table>' +
    '</body></html>';
}
