// =========================================================
// Création Audio — PDF de la facture (pdf-lib), utilisé par l'Edge Function « invoice-notify ».
// Design « A · Accent » : filet orange en haut, FACTURE à droite, tableau sobre, total en bloc noir.
// Polices : Inter + Space Grotesk (chargées par index.ts) ; sans elles, repli sur Helvetica.
// Ne reçoit jamais coût ni marge : seulement label, meta, qty, unit_price, line_total.
// =========================================================
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

export type Fonts = { regular: Uint8Array; semibold: Uint8Array; display: Uint8Array } | null;

const C = {
  ink: rgb(0.094, 0.102, 0.122),      // #181A1F
  soft: rgb(0.424, 0.447, 0.486),     // #6C727C
  line: rgb(0.906, 0.906, 0.886),     // #E7E7E2
  band: rgb(0.957, 0.953, 0.937),     // #F4F3EF
  ember: rgb(1, 0.416, 0.169),        // #FF6A2B
};
const WHITE = rgb(1, 1, 1);
const W = 612, H = 792, M = 48, BOTTOM = 70;

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const STR = {
  fr: { invoice: "FACTURE", no: "N°", from: "De", to: "Facturé à", desc: "Description", qty: "Qté", unit: "Prix unitaire", total: "Total",
        sub: "Sous-total", gst: "TPS", qst: "TVQ", note: "Note", thanks: "Merci pour ta commande !", page: "Page", of: "sur", cont: "suite" },
  en: { invoice: "INVOICE", no: "No.", from: "From", to: "Billed to", desc: "Description", qty: "Qty", unit: "Unit price", total: "Total",
        sub: "Subtotal", gst: "GST", qst: "QST", note: "Note", thanks: "Thank you for your order!", page: "Page", of: "of", cont: "continued" },
};

export type Company = Record<string, unknown>;
export type InvoiceHead = {
  number: string; invoice_date: string; client_name?: string | null; client_address?: string | null; client_city?: string | null;
  client_contact?: string | null; tax_enabled: boolean; subtotal: number; tax_gst: number; tax_qst: number; total: number; note?: string | null;
};
export type InvoiceLine = { label?: string | null; meta?: string | null; qty: number; unit_price: number; line_total: number };

// espaces fines / insécables et caractères invisibles : absents des polices
const clean = (s: unknown) => String(s ?? "").replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "").replace(/\r/g, "");
// Helvetica (WinAnsi) refuse tout ce qui n'est pas du Latin-1 + quelques signes : on les remplace
const winSafe = (s: string) => s.replace(/[^ -~ -ÿŒœ–—‘’“”•…€]/g, "?");

export function money(n: unknown, en: boolean) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  if (en) return "$" + v.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return clean(v.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + " $";
}
function qtyTxt(q: unknown, en: boolean) {
  const v = Number(q) || 0;
  return Number.isInteger(v) ? String(v) : v.toLocaleString(en ? "en-CA" : "fr-CA", { maximumFractionDigits: 2 });
}
export function dateTxt(iso: string, en: boolean) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return en ? MONTHS[m - 1] + " " + d + ", " + y : d + " " + MOIS[m - 1] + " " + y;
}

// « data:image/png;base64,… » -> octets (PNG ou JPEG seulement ; sinon null)
function logoBytes(dataUrl: unknown): { bytes: Uint8Array; png: boolean } | null {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ""));
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, png: m[1].toLowerCase() === "png" };
  } catch { return null; }
}

export async function buildInvoicePdf(o: { company: Company; invoice: InvoiceHead; lines: InvoiceLine[]; lang: "fr" | "en"; fonts: Fonts }): Promise<Uint8Array> {
  const { company: co, invoice: inv, lines, fonts: F } = o;
  const en = o.lang === "en", T = STR[o.lang];
  const doc = await PDFDocument.create();
  doc.setTitle((en ? "Invoice " : "Facture ") + inv.number);
  doc.setAuthor(String(co.name || "Création Audio"));
  let reg, semi, disp;
  if (F) {
    doc.registerFontkit(fontkit);
    reg = await doc.embedFont(F.regular, { subset: true });
    semi = await doc.embedFont(F.semibold, { subset: true });
    disp = await doc.embedFont(F.display, { subset: true });
  } else {
    reg = await doc.embedFont(StandardFonts.Helvetica);
    semi = await doc.embedFont(StandardFonts.HelveticaBold);
    disp = semi;
  }
  // caractère absent d'une police (→, ✓, emoji…) : remplacé par « ? » plutôt qu'un carré vide
  let fix = (s: unknown) => winSafe(clean(s));
  if (F) {
    const ok = new Set<number>(reg.getCharacterSet());
    for (const f of [semi, disp]) { const cs = new Set<number>(f.getCharacterSet()); for (const c of [...ok]) if (!cs.has(c)) ok.delete(c); }
    fix = (s: unknown) => clean(s).replace(/[^\n]/gu, (c) => (c.codePointAt(0)! < 32 || ok.has(c.codePointAt(0)!) ? c : "?"));
  }

  let logo = null;
  const lb = logoBytes(co.logo);
  if (lb) { try { logo = lb.png ? await doc.embedPng(lb.bytes) : await doc.embedJpg(lb.bytes); } catch { logo = null; } }

  // deno-lint-ignore no-explicit-any
  const wrap = (text: string, font: any, size: number, maxW: number) => {
    const out: string[] = [];
    for (const para of fix(text).split("\n")) {
      let cur = "";
      for (const word of para.split(" ")) {
        const test = cur ? cur + " " + word : word;
        if (font.widthOfTextAtSize(test, size) <= maxW) { cur = test; continue; }
        if (cur) out.push(cur);
        let w = word;   // mot plus long que la ligne : coupe dur
        while (font.widthOfTextAtSize(w, size) > maxW) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > maxW) i--;
          out.push(w.slice(0, i)); w = w.slice(i);
        }
        cur = w;
      }
      out.push(cur);
    }
    return out;
  };

  // deno-lint-ignore no-explicit-any
  let page: any, y = 0;
  // deno-lint-ignore no-explicit-any
  const pages: any[] = [];
  // deno-lint-ignore no-explicit-any
  const text = (s: unknown, x: number, yy: number, p: { font?: any; size?: number; color?: any; align?: string } = {}) => {
    const font = p.font || reg, size = p.size || 9, str = fix(s);
    const xx = p.align === "right" ? x - font.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: xx, y: yy, font, size, color: p.color || C.ink });
  };
  // deno-lint-ignore no-explicit-any
  const hline = (yy: number, color: any = C.line, th = 0.7) => page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: th, color });

  // colonnes du tableau (bords droits)
  const colQty = W - M - 150, colUnit = W - M - 78, colTot = W - M;
  const descW = colQty - 40 - M - 10;

  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: C.band });
    text(T.desc.toUpperCase(), M + 8, y, { font: semi, size: 7, color: C.soft });
    text(T.qty.toUpperCase(), colQty, y, { font: semi, size: 7, color: C.soft, align: "right" });
    text(T.unit.toUpperCase(), colUnit, y, { font: semi, size: 7, color: C.soft, align: "right" });
    text(T.total.toUpperCase(), colTot - 8, y, { font: semi, size: 7, color: C.soft, align: "right" });
    y -= 22;
  };

  const newPage = (first: boolean) => {
    page = doc.addPage([W, H]); pages.push(page);
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: C.ember });   // filet d'accent en haut
    y = H - 54;
    if (first) return;
    text(co.name || "Création Audio", M, y, { font: disp, size: 12 });
    text(T.invoice + " " + inv.number + " · " + T.cont, W - M, y, { font: semi, size: 8.5, color: C.soft, align: "right" });
    y -= 30;
    tableHead();
  };

  newPage(true);

  // ---- en-tête : logo / nom à gauche, FACTURE + n° + date à droite ----
  const hy = y;
  let hasLogo = false;
  if (logo) {
    const lh = 34, lw = Math.min(150, logo.width * lh / logo.height);
    page.drawImage(logo, { x: M, y: hy - lh + 10, width: lw, height: lh });
    hasLogo = true;
  } else {
    text(co.name || "Création Audio", M, hy, { font: disp, size: 21 });
  }
  page.drawRectangle({ x: W - M - 28, y: hy + 20, width: 28, height: 3, color: C.ember });
  text(T.invoice, W - M, hy - 4, { font: disp, size: 24, align: "right" });
  text(T.no + " " + inv.number, W - M, hy - 22, { font: semi, size: 10, align: "right" });
  text(dateTxt(inv.invoice_date, en), W - M, hy - 36, { size: 9, color: C.soft, align: "right" });
  if (co.tagline) text(co.tagline, M, hy - (hasLogo ? 36 : 22), { size: 8.5, color: C.soft });
  y = hy - 66;

  // ---- De / Facturé à ----
  const colW = (W - 2 * M - 30) / 2;
  const block = (label: string, x: number, rows: unknown[]) => {
    text(label.toUpperCase(), x, y, { font: semi, size: 7, color: C.soft });
    let yy = y - 15;
    rows.forEach((r, i) => {
      if (!r) return;
      const f = i === 0 ? semi : reg, sz = i === 0 ? 10 : 9, col = i === 0 ? C.ink : C.soft;
      for (const ln of wrap(String(r), f, sz, colW)) { text(ln, x, yy, { font: f, size: sz, color: col }); yy -= sz + 4; }
    });
    return yy;
  };
  const fromRows = [co.name, co.address, co.city, co.email, co.phone,
    co.neq && "NEQ " + co.neq, co.gst && T.gst + " " + co.gst, co.qst && T.qst + " " + co.qst].filter(Boolean);
  const toRows = [inv.client_name, inv.client_address, inv.client_city, inv.client_contact].filter(Boolean);
  const y1 = block(T.from, M, fromRows);
  const y2 = block(T.to, M + colW + 30, toRows);
  y = Math.min(y1, y2) - 18;

  // ---- tableau ----
  tableHead();
  for (const l of lines) {
    const labelLines = wrap(l.label || "", semi, 9.5, descW);
    const metaLines = l.meta ? wrap(l.meta, reg, 8, descW) : [];
    const rowH = labelLines.length * 13 + metaLines.length * 11 + 12;
    if (y - rowH < BOTTOM + 24) newPage(false);
    let yy = y;
    labelLines.forEach((s) => { text(s, M + 8, yy, { font: semi, size: 9.5 }); yy -= 13; });
    metaLines.forEach((s) => { text(s, M + 8, yy + 1, { size: 8, color: C.soft }); yy -= 11; });
    text(qtyTxt(l.qty, en), colQty, y, { size: 9.5, align: "right" });
    text(money(l.unit_price, en), colUnit, y, { size: 9.5, align: "right" });
    text(money(l.line_total, en), colTot - 8, y, { font: semi, size: 9.5, align: "right" });
    y -= rowH - 4;
    hline(y + 4);
    y -= 8;
  }

  // ---- totaux (bloc réservé : jamais coupé de la dernière ligne) ----
  const rows: [string, number][] = inv.tax_enabled ? [[T.sub, inv.subtotal], [T.gst, inv.tax_gst], [T.qst, inv.tax_qst]] : [];
  const noteLines = inv.note ? wrap(inv.note, reg, 9, 250) : [];
  const need = rows.length * 17 + 70 + Math.max(0, noteLines.length - 2) * 13 + 40;
  if (y - need < BOTTOM) newPage(false);
  y -= 10;
  const tx = W - M - 190;
  rows.forEach(([lab, v]) => {
    text(lab, tx, y, { size: 9.5, color: C.soft });
    text(money(v, en), W - M - 8, y, { size: 9.5, align: "right" });
    y -= 17;
  });
  if (rows.length) y -= 8;
  page.drawRectangle({ x: tx - 10, y: y - 10, width: 200, height: 32, color: C.ink });
  text(T.total, tx, y, { font: semi, size: 10.5, color: WHITE });
  text(money(inv.total, en), W - M - 8, y - 1, { font: disp, size: 15, color: WHITE, align: "right" });
  page.drawRectangle({ x: tx - 10, y: y - 10, width: 3, height: 32, color: C.ember });
  let after = y - 40;
  if (noteLines.length) {
    let ny = y + 6 + rows.length * 17;
    text(T.note.toUpperCase(), M, ny, { font: semi, size: 7, color: C.soft });
    ny -= 14;
    noteLines.forEach((s) => { text(s, M, ny, { size: 9 }); ny -= 13; });
    after = Math.min(after, ny - 18);
  }
  y = after;
  text(T.thanks, M, y, { font: semi, size: 10 });

  // ---- pied de page sur chaque page ----
  const foot = [co.name, co.email, co.phone].filter(Boolean).join("  ·  ");
  pages.forEach((p, i) => {
    page = p;
    hline(46);
    text(foot, M, 32, { size: 7.5, color: C.soft });
    text(T.page + " " + (i + 1) + " " + T.of + " " + pages.length, W - M, 32, { size: 7.5, color: C.soft, align: "right" });
  });
  return await doc.save();
}
