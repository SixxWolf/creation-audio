// =========================================================
// Création Audio — Edge Function « invoice-notify » (facture par courriel)
// Envoie au client le courriel « Ta facture est jointe » : résumé + total, PDF de la facture en pièce
// jointe, lien vers Mon compte. Copie cachée à Création Audio. Chaque envoi est inscrit au journal
// public.invoice_emails.
// Appel : POST { invoice_id, event: 'auto' | 'resend' } avec le JWT de l'admin (double authentification aal2).
//  - auto   : à l'enregistrement de la facture. Respecte le réglage admin_settings « invoice_email »
//             ({ enabled }, absent = activé), une seule fois par facture.
//  - resend : bouton « Renvoyer » de la Facturation. Ignore le réglage ; au plus 1 fois / 30 s.
// Rien n'est envoyé (result: 'skipped') : facture annulée, usage interne, désactivé, déjà envoyée,
// ou aucun courriel (champ Contact de la facture, sinon fiche client reliée).
// Langue : customers.lang du compte relié (fiche ou courriel), sinon français.
// PDF : pdf.ts (pdf-lib). Polices Inter + Space Grotesk téléchargées une fois (cache), repli Helvetica.
// Secrets : RESEND_API_KEY ; MAIL_FROM et ORDER_NOTIFY_TO optionnels (comme customer-order-notify).
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildInvoicePdf, dateTxt, money, type Fonts, type InvoiceLine } from "./pdf.ts";

const SITE = "https://creationaudio.ca";
const REPLY_TO = "contact@creationaudio.ca";
const ADMIN_EMAIL = "creationaudio.ca@gmail.com";

const FONT_BASE = "https://cdn.jsdelivr.net/npm/";
const FONT_URLS = {
  regular: FONT_BASE + "@fontsource/inter@5.3.0/files/inter-latin-400-normal.woff",
  semibold: FONT_BASE + "@fontsource/inter@5.3.0/files/inter-latin-600-normal.woff",
  display: FONT_BASE + "@fontsource/space-grotesk@5.3.0/files/space-grotesk-latin-700-normal.woff",
};

function jwtClaim(authHeader: string, key: string): unknown {
  try {
    const p = authHeader.replace(/^Bearer\s+/i, "").split(".")[1];
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4)))[key];
  } catch { return undefined; }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}

// polices : chargées au premier envoi, gardées en mémoire ; null = repli Helvetica
let fontsP: Promise<Fonts> | null = null;
function loadFonts(): Promise<Fonts> {
  if (!fontsP) {
    fontsP = (async () => {
      try {
        const get = async (u: string) => {
          const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) throw new Error("police " + r.status);
          return new Uint8Array(await r.arrayBuffer());
        };
        const [regular, semibold, display] = await Promise.all([get(FONT_URLS.regular), get(FONT_URLS.semibold), get(FONT_URLS.display)]);
        return { regular, semibold, display };
      } catch { fontsP = null; return null; }   // réessaie au prochain envoi
    })();
  }
  return fontsP;
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const EMAIL_RE = /[^\s<>,;()"'[\]]+@[^\s<>,;()"'[\]]+\.[^\s<>,;()"'[\]]+/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>";
  const bccTo = Deno.env.get("ORDER_NOTIFY_TO") || REPLY_TO;

  // 1) seul l'admin (double authentification, comme is_admin() en base)
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return json({ error: "Connexion requise." }, 401);
  if ((u.user.email || "").toLowerCase() !== ADMIN_EMAIL) return json({ error: "Réservé à l'administrateur." }, 403);
  if (jwtClaim(authHeader, "aal") !== "aal2") return json({ error: "Double authentification requise." }, 403);

  let invoiceId = "", kind: "auto" | "resend" = "auto";
  try {
    const body = await req.json();
    invoiceId = typeof body?.invoice_id === "string" ? body.invoice_id : "";
    kind = body?.event === "resend" ? "resend" : "auto";
  } catch { /* corps invalide */ }
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return json({ error: "Facture invalide." }, 400);

  const db = createClient(url, service);
  const { data: inv, error } = await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!inv) return json({ error: "Facture introuvable." }, 404);

  // 2) cas où rien ne part
  if (inv.status === "cancelled") return json({ result: "skipped", reason: "cancelled" });
  if (inv.client_type === "internal") return json({ result: "skipped", reason: "internal" });
  if (kind === "auto") {
    const { data: set } = await db.from("admin_settings").select("value").eq("key", "invoice_email").maybeSingle();
    if (set?.value?.enabled === false) return json({ result: "skipped", reason: "disabled" });
    const { data: done } = await db.from("invoice_emails").select("id").eq("invoice_id", invoiceId).eq("kind", "auto").eq("ok", true).limit(1);
    if (done?.length) return json({ result: "skipped", reason: "already_sent" });
  } else {
    const { data: last } = await db.from("invoice_emails").select("sent_at").eq("invoice_id", invoiceId).order("sent_at", { ascending: false }).limit(1);
    if (last?.length && Date.now() - Date.parse(last[0].sent_at) < 30 * 1000) return json({ result: "skipped", reason: "recent" });
  }

  // 3) destinataire : courriel dans le champ Contact, sinon la fiche client reliée
  let to = EMAIL_RE.exec(String(inv.client_contact || ""))?.[0] || "";
  if (!to && inv.client_id) {
    const { data: cl } = await db.from("clients").select("email").eq("id", inv.client_id).maybeSingle();
    to = EMAIL_RE.exec(String(cl?.email || ""))?.[0] || "";
  }
  if (!to) return json({ result: "skipped", reason: "no_email" });
  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);

  // 4) langue du client (compte relié par la fiche, sinon par le courriel)
  let langRow = null;
  if (inv.client_id) {
    const { data } = await db.from("customers").select("lang").eq("client_id", inv.client_id).limit(1);
    langRow = data?.[0] || null;
  }
  if (!langRow) {
    const { data } = await db.from("customers").select("lang").ilike("email", to).limit(1);
    langRow = data?.[0] || null;
  }
  const lang: "fr" | "en" = langRow?.lang === "en" ? "en" : "fr";
  const en = lang === "en";
  const T = (fr: string, e: string) => (en ? e : fr);

  // 5) données de la facture + coordonnées de l'entreprise
  const { data: lines } = await db.from("invoice_lines")
    .select("label, meta, qty, unit_price, line_total").eq("invoice_id", invoiceId).order("sort_order");
  const L = (lines || []) as InvoiceLine[];
  const { data: coRow } = await db.from("admin_settings").select("value").eq("key", "entreprise").maybeSingle();
  const company = (coRow?.value || {}) as Record<string, unknown>;

  const result: Record<string, unknown> = { to, kind, lang };
  let sendErr = "";
  try {
    const pdf = await buildInvoicePdf({ company, invoice: inv, lines: L, lang, fonts: await loadFonts() });
    const first = String(inv.client_name || "").trim().split(/\s+/)[0] || "";
    const m = (n: unknown) => money(n, en);
    const dateStr = dateTxt(inv.invoice_date, en);
    const payTxt = inv.pay_method === "cash" ? T("Comptant", "Cash") : inv.pay_method === "interac" ? T("Virement Interac", "Interac e-Transfer") : "";
    const accUrl = SITE + (en ? "/en" : "") + "/compte.html#/commandes";
    const subject = T("Ta facture ", "Your invoice ") + inv.number + " — Création Audio";
    const text =
      T("Bonjour ", "Hello ") + first + ",\n\n" +
      T("Ta facture " + inv.number + " (" + dateStr + ") est jointe à ce courriel, en PDF.", "Your invoice " + inv.number + " (" + dateStr + ") is attached to this email as a PDF.") + "\n\n" +
      L.map((l) => "- " + (l.label || "") + (l.meta ? " (" + l.meta + ")" : "") + " × " + l.qty + " — " + m(l.line_total)).join("\n") + "\n\n" +
      (inv.tax_enabled ? T("Sous-total : ", "Subtotal: ") + m(inv.subtotal) + "\n" + T("TPS : ", "GST: ") + m(inv.tax_gst) + "\n" + T("TVQ : ", "QST: ") + m(inv.tax_qst) + "\n" : "") +
      "Total" + T(" : ", ": ") + m(inv.total) + "\n" +
      (payTxt ? T("Paiement : ", "Payment: ") + payTxt + "\n" : "") + "\n" +
      T("Tu retrouves aussi tes factures dans ton compte : ", "You can also find your invoices in your account: ") + accUrl + "\n\n" +
      "Création Audio\n" + SITE + (en ? "/en/" : "/");
    const rowsHtml = L.map((l) => '<tr>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2"><strong>' + esc(l.label) + '</strong>' +
        (l.meta ? '<br><span style="color:#6C727C;font-size:12px">' + esc(l.meta) + '</span>' : '') + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + esc(l.qty) + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + m(l.line_total) + '</td></tr>').join("");
    const taxHtml = inv.tax_enabled
      ? '<p style="margin:12px 0 0;text-align:right;color:#6C727C;font-size:13px">' + T("Sous-total : ", "Subtotal: ") + m(inv.subtotal) + '<br>' +
        T("TPS : ", "GST: ") + m(inv.tax_gst) + '<br>' + T("TVQ : ", "QST: ") + m(inv.tax_qst) + '</p>' : '';
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
      '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Création Audio</p>' +
      '<h1 style="font-size:22px;margin:0 0 10px">' + T("Ta facture est jointe", "Your invoice is attached") + '</h1>' +
      '<p style="margin:0 0 6px">' + T("Bonjour ", "Hello ") + esc(first) + ',</p>' +
      '<p style="margin:0 0 16px">' + T("Voici ta facture <strong>" + esc(inv.number) + "</strong> du " + esc(dateStr) + ", en PDF.",
        "Here is your invoice <strong>" + esc(inv.number) + "</strong> from " + esc(dateStr) + ", as a PDF.") + '</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
        '<tr style="background:#F4F3EF"><th style="padding:8px 10px;text-align:left">' + T("Article", "Item") + '</th><th style="padding:8px 10px;text-align:right">' + T("Qté", "Qty") + '</th>' +
        '<th style="padding:8px 10px;text-align:right">Total</th></tr>' + rowsHtml +
      '</table>' + taxHtml +
      '<p style="margin:10px 0 0;text-align:right;font-size:16px"><strong>Total' + T(" : ", ": ") + m(inv.total) + '</strong></p>' +
      (payTxt ? '<p style="margin:2px 0 0;text-align:right;color:#6C727C;font-size:13px">' + T("Paiement : ", "Payment: ") + esc(payTxt) + '</p>' : '') +
      '<p style="margin:22px 0"><a href="' + accUrl + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">' +
        T("Voir mon compte", "Open my account") + '</a></p>' +
      '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
      '<p style="font-size:12px;color:#6C727C">' + T("Une question&nbsp;? Réponds simplement à ce courriel.", "A question? Just reply to this email.") + '</p>' +
      '</div>';
    const msg: Record<string, unknown> = {
      from, to: [to], reply_to: REPLY_TO, subject, html, text,
      attachments: [{ filename: (en ? "Invoice-" : "Facture-") + inv.number + ".pdf", content: b64(pdf) }],
    };
    if (!/@resend\.dev$/i.test(to)) msg.bcc = [bccTo];   // adresses de test : pas de copie
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" }, body: JSON.stringify(msg),
    });
    if (!res.ok) throw new Error("Resend " + res.status + " : " + (await res.text()).slice(0, 200));
    result.pdf_bytes = pdf.length;
  } catch (e) { sendErr = String((e as Error).message || e); }

  // 6) journal (succès et échec)
  await db.from("invoice_emails").insert({ invoice_id: invoiceId, to_email: to, kind, lang, ok: !sendErr, error: sendErr || null });
  if (sendErr) return json({ error: sendErr, ...result }, 502);
  return json({ result: "sent", ...result });
}
);
