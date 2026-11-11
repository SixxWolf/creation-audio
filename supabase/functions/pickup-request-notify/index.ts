// =========================================================
// Création Audio — Edge Function « pickup-request-notify » (demande d'exception de cueillette)
// Appelée par le client (CA.custOrder.requestPickup) puis par l'admin (réponse) :
//  - event « request » (client, JWT du client) : avis à Création Audio + accusé au client ;
//  - event « approved » / « refused » (admin, double authentification) : courriel au client.
// Appel : POST { kind: 'order' | 'reservation', id, event }
// Tout est relu en base (pickup_req, pickup_date…) : le corps ne sert qu'à choisir l'événement.
// Secrets : RESEND_API_KEY ; MAIL_FROM et ORDER_NOTIFY_TO optionnels.
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import * as M from "../_shared/mail.ts";

const SITE = "https://creationaudio.ca";
const REPLY_TO = "contact@creationaudio.ca";
const ADMIN_EMAIL = "creationaudio.ca@gmail.com";

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
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function hTxt(t: unknown) {
  const p = String(t || "").split(":");
  return Number(p[0]) + " h " + (p[1] || "00");
}
function hTxtEn(t: unknown) {
  const p = String(t || "").split(":"), h = Number(p[0]);
  return ((h % 12) || 12) + ":" + (p[1] || "00") + (h < 12 ? " AM" : " PM");
}
function fmtPickup(d: unknown, s: unknown, en = false) {
  if (!d) return "";
  const p = String(d).split("-").map(Number), x = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (en) return x.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) + (s ? ", " + hTxtEn(s) : "");
  return JOURS[x.getUTCDay()] + " " + x.getUTCDate() + " " + MOIS[x.getUTCMonth()] + (s ? ", " + hTxt(s) : "");
}

async function send(key: string, from: string, msg: Record<string, unknown>) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, ...msg }),
  });
  if (!res.ok) throw new Error("Resend " + res.status + " : " + (await res.text()).slice(0, 200));
}

// gabarit commun (même look que la facture). wrap : lang / n° posés par la requête (LANG, REF)
let LANG: "fr" | "en" = "fr", REF = "", TAG = "Cueillette";
function wrap(kicker: string, title: string, body: string) {
  const admin = kicker !== "Création Audio";
  return M.page({ lang: admin ? "fr" : LANG, admin, tag: admin ? kicker : TAG, ref: REF, title, body });
}
const box = (t: string, ok = true) => M.notice(esc(t), ok ? "ok" : "info");
const btn = (href: string, t: string) => M.button(href, t);
const quote = (t: string) => M.quote(t);
const p = (h: string) => M.text(h);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>";
  let adminTo = Deno.env.get("ORDER_NOTIFY_TO") || "contact@creationaudio.ca";

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id || "";
  if (!uid) return json({ error: "Connexion requise." }, 401);

  let kind = "order", id = "", event = "request";
  try {
    const body = await req.json();
    kind = body?.kind === "reservation" ? "reservation" : body?.kind === "invoice" ? "invoice" : "order";
    id = typeof body?.id === "string" ? body.id : "";
    event = ["request", "approved", "refused", "confirmed", "ready"].includes(body?.event) ? body.event : "request";
  } catch { /* corps invalide */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Identifiant invalide." }, 400);
  if (event !== "request") {
    if ((u?.user?.email || "").toLowerCase() !== ADMIN_EMAIL) return json({ error: "Réservé à l'administrateur." }, 403);
    if (jwtClaim(authHeader, "aal") !== "aal2") return json({ error: "Double authentification requise." }, 403);
  }

  const table = kind === "reservation" ? "customer_reservations" : kind === "invoice" ? "invoices" : "customer_orders";
  const db = createClient(url, service);
  let { data: x, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!x || (event === "request" && x.customer_id !== uid)) return json({ error: "Introuvable." }, 404);
  if (kind === "invoice") {
    // facture « À venir » : le client est le compte lié à la fiche (customers.client_id), jamais d'exception ni de demande
    if (event === "request" || event === "approved" || event === "refused") return json({ error: "Événement non permis pour une facture." }, 400);
    const { data: c } = x.client_id ? await db.from("customers").select("id,email,name,phone").eq("client_id", x.client_id).maybeSingle() : { data: null };
    if (!c?.email) return json({ result: "skipped", reason: "aucun compte lié" });
    x = { ...x, customer_id: c.id, email: c.email, name: c.name || x.client_name, phone: c.phone };
  }
  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);
  if (/@resend\.dev$/i.test(x.email || "")) adminTo = "delivered@resend.dev";   // tests

  const rq = x.pickup_req as { d?: string; s?: string; note?: string; state?: string; reply?: string } | null;
  const what = (kind === "reservation" ? "Réservation " : kind === "invoice" ? "Facture " : "Commande ") + x.number;
  const first = String(x.name || "").trim().split(/\s+/)[0] || "";
  const who = x.name || x.email;
  const slug = (kind === "reservation" ? "r/" : kind === "invoice" ? "f/" : "c/") + id;
  const adminUrl = SITE + "/coulisses-t6avzpe2#" + (kind === "invoice" ? "historique" : "commandes/" + (kind === "reservation" ? "reservations" : "clients"));
  const { data: cust } = x.customer_id ? await db.from("customers").select("lang").eq("id", x.customer_id).maybeSingle() : { data: null };
  const en = cust?.lang === "en";
  const accountUrl = SITE + (en ? "/en" : "") + "/compte#/cueillette/" + slug;
  const results: Record<string, string> = {};
  LANG = en ? "en" : "fr"; REF = String(x.number || "");
  TAG = kind === "invoice" ? (en ? "Invoice" : "Facture") : kind === "reservation" ? (en ? "Reservation" : "Réservation") : (en ? "Order" : "Commande");
  await M.loadCompany(db);

  if (event === "request") {
    if (!rq || rq.state !== "pending") return json({ result: "skipped", reason: "aucune demande" });
    const pk = fmtPickup(rq.d, rq.s), pkE = fmtPickup(rq.d, rq.s, true);
    // à Création Audio
    const aText = "Demande d'exception de cueillette — " + what + "\n" + who + " · " + x.email + (x.phone ? " · " + x.phone : "") +
      "\n\nDemande : " + pk + (rq.note ? "\nMot : " + rq.note : "") + "\n\nRépondre dans l'admin : " + adminUrl + "\n";
    const aHtml = wrap("Cueillette", "Demande d'exception — " + what,
      M.who(who, x.email, x.phone) +
      box("Demande : " + pk) + quote(rq.note || "") + btn(adminUrl, "Approuver ou refuser"));
    try {
      await send(resendKey, from, { to: [adminTo], reply_to: x.email, subject: "Exception cueillette " + what + " — " + who + " · " + pk, html: aHtml, text: aText });
      results.admin = "sent";
    } catch (e) { results.admin = "error: " + String((e as Error).message || e); }
    // accusé au client
    const cSubject = en ? "Pickup request received — Création Audio" : "Demande de cueillette reçue — Création Audio";
    const cText = en
      ? "Hello " + first + ",\n\nWe got your request for " + pkE + ". We'll confirm by email.\n\n" + accountUrl + "\n\nCréation Audio\n" + SITE + "/en/"
      : "Bonjour " + first + ",\n\nC'est reçu : ta demande pour " + pk + ". On te confirme par courriel.\n\n" + accountUrl + "\n\nCréation Audio\n" + SITE;
    const cHtml = en
      ? wrap("Création Audio", "Request received", p('Hello ' + esc(first) + ', we got your request.') + box("Requested: " + pkE, false) + btn(accountUrl, "See my order"))
      : wrap("Création Audio", "Demande reçue", p('Bonjour ' + esc(first) + ', c\'est reçu.') + box("Demande : " + pk, false) + btn(accountUrl, "Voir ma commande"));
    try {
      await send(resendKey, from, { to: [x.email], reply_to: REPLY_TO, subject: cSubject, html: cHtml, text: cText });
      results.client = "sent";
    } catch (e) { results.client = "error: " + String((e as Error).message || e); }
    return json({ result: "done", ...results });
  }

  // réponse de l'admin -> client
  let cSubject: string, cText: string, cHtml: string;
  if (event === "ready") {
    // « tes articles sont arrivés » : le client choisit sa cueillette dans Mon compte
    if (kind !== "invoice" || !x.pickup_ready_at) return json({ result: "skipped", reason: "facture non prévenue" });
    const { data: pl } = await db.from("invoice_lines").select("label,meta,qty_pending,product_id,kind").eq("invoice_id", id).gt("qty_pending", 0).order("sort_order");
    const items = (pl || []) as { label: string; meta: string | null; qty_pending: number; product_id: string | null; kind: string | null }[];
    const li = items.map((l) => l.qty_pending + " × " + l.label + (l.meta ? " — " + l.meta : ""));
    const pics = await M.thumbs(db, items);
    const listHtml = M.items(items.map((l, i) => ({ label: l.label, meta: l.meta, thumb: pics[i], right: "× " + l.qty_pending }))) +
      '<div style="height:18px;line-height:18px;font-size:0">&nbsp;</div>';
    const listTxt = li.map((t) => "- " + t).join("\n");
    const nTxt = (items.reduce((s, l) => s + l.qty_pending, 0) > 1) ? true : false;
    cSubject = en ? "Your items have arrived — Création Audio" : (nTxt ? "Tes articles sont arrivés" : "Ton article est arrivé") + " — Création Audio";
    cText = en
      ? "Hello " + first + ",\n\nYour items for invoice " + x.number + " have arrived:\n" + listTxt + "\n\nPick a time to come get them: " + accountUrl + "\n\nCréation Audio\n" + SITE + "/en/"
      : "Bonjour " + first + ",\n\n" + (nTxt ? "Tes articles de la facture " : "Ton article de la facture ") + x.number + (nTxt ? " sont arrivés :\n" : " est arrivé :\n") + listTxt +
        "\n\nChoisis ton heure de cueillette : " + accountUrl + "\n\nCréation Audio\n" + SITE;
    cHtml = en
      ? wrap("Création Audio", "Your items have arrived", p('Hello ' + esc(first) + ', your items for invoice ' + esc(x.number) + ' are here.') + listHtml + btn(accountUrl, "Pick my pickup time"))
      : wrap("Création Audio", nTxt ? "Tes articles sont arrivés" : "Ton article est arrivé", p('Bonjour ' + esc(first) + ', c\'est arrivé pour la facture ' + esc(x.number) + '.') + listHtml + btn(accountUrl, "Choisir ma cueillette"));
  } else if (event === "approved" || event === "confirmed") {
    if (!x.pickup_date) return json({ result: "skipped", reason: "aucune cueillette" });
    const pk = fmtPickup(x.pickup_date, x.pickup_start), pkE = fmtPickup(x.pickup_date, x.pickup_start, true);
    const { data: cfg } = await db.from("admin_settings").select("value").eq("key", "cueillette").maybeSingle();
    const addr = String(cfg?.value?.address || "").trim();
    // téléphone + modes de paiement sous l'adresse (Commandes › Cueillettes, 2026-11-11)
    const tel = String(cfg?.value?.phone || "").trim() || "581 446-3858";
    const iac = String(cfg?.value?.interac || "").trim() || "contact@creationaudio.ca";
    const payTxt = en ? "Cash or Interac e-Transfer to " + iac : "Comptant ou virement Interac à " + iac;
    const addrBox = M.kv([
      [en ? "Address" : "Adresse", addr ? esc(addr) : ""],
      [en ? "Phone" : "Téléphone", '<a href="tel:+1' + tel.replace(/\D/g, "").slice(-10) + '" style="color:inherit">' + esc(tel) + '</a>'],
      [en ? "Payment" : "Paiement", esc(payTxt)]]);
    const addrTxt = (addr ? (en ? "\nAddress: " : "\nAdresse : ") + addr : "") +
      (en ? "\nPhone: " : "\nTéléphone : ") + tel + (en ? "\nPayment: " : "\nPaiement : ") + payTxt + "\n";
    const ok = event === "confirmed";
    cSubject = en ? "Pickup confirmed " + pkE + " — Création Audio" : "Cueillette confirmée " + pk + " — Création Audio";
    cText = en ? "Hello " + first + ",\n\n" + (ok ? "Your pickup is confirmed" : "Good news: your request is approved") + ". See you " + pkE + "." + addrTxt + "\n" + accountUrl + "\n\nCréation Audio\n" + SITE + "/en/"
      : "Bonjour " + first + ",\n\n" + (ok ? "Ta cueillette est confirmée" : "Bonne nouvelle : ta demande est approuvée") + ". On t'attend " + pk + "." + addrTxt + "\n" + accountUrl + "\n\nCréation Audio\n" + SITE;
    cHtml = en
      ? wrap("Création Audio", ok ? "Pickup confirmed" : "Request approved", p('Hello ' + esc(first) + ', for ' + esc(what.toLowerCase().replace("commande", "order").replace("réservation", "reservation").replace("facture", "invoice")) + '.') + box("See you " + pkE + ".") + addrBox + btn(accountUrl, "See my order"))
      : wrap("Création Audio", ok ? "Cueillette confirmée" : "Demande approuvée", p('Bonjour ' + esc(first) + ', pour ' + esc(what.toLowerCase()) + '.') + box("On t'attend " + pk + ".") + addrBox + btn(accountUrl, "Voir ma commande"));
  } else {
    if (!rq || rq.state !== "refused") return json({ result: "skipped", reason: "aucun refus" });
    const pk = fmtPickup(rq.d, rq.s), pkE = fmtPickup(rq.d, rq.s, true), cur = fmtPickup(x.pickup_date, x.pickup_start), curE = fmtPickup(x.pickup_date, x.pickup_start, true);
    cSubject = en ? "About your pickup request — Création Audio" : "À propos de ta demande de cueillette — Création Audio";
    cText = en
      ? "Hello " + first + ",\n\nWe can't do " + pkE + "." + (rq.reply ? "\n\n" + rq.reply : "") + "\n\nPick another time slot: " + accountUrl + "\n\nCréation Audio\n" + SITE + "/en/"
      : "Bonjour " + first + ",\n\nOn ne peut pas pour " + pk + "." + (rq.reply ? "\n\n" + rq.reply : "") + "\n\nChoisis une autre plage : " + accountUrl + "\n\nCréation Audio\n" + SITE;
    cHtml = en
      ? wrap("Création Audio", "Request declined", p('Hello ' + esc(first) + ', we can\'t do ' + esc(pkE) + '.') + quote(rq.reply || "") + (curE ? box("Your pickup stays " + curE + ".", false) : "") + btn(accountUrl, "Pick another time"))
      : wrap("Création Audio", "Demande refusée", p('Bonjour ' + esc(first) + ', on ne peut pas pour ' + esc(pk) + '.') + quote(rq.reply || "") + (cur ? box("Ta cueillette reste " + cur + ".", false) : "") + btn(accountUrl, "Choisir une autre plage"));
  }
  try {
    await send(resendKey, from, { to: [x.email], reply_to: REPLY_TO, subject: cSubject, html: cHtml, text: cText });
    results.client = "sent";
  } catch (e) { results.client = "error: " + String((e as Error).message || e); }
  return json({ result: "done", ...results });
});
