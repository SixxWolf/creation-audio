// =========================================================
// Création Audio — Edge Function « pickup-notify » (plage de cueillette changée)
// Appelée par CA.custOrder.setPickup (commande-client.js) après la RPC customer_set_pickup,
// quand le client choisit ou change sa plage dans Mon compte :
//  - au CLIENT : confirmation de la nouvelle plage ;
//  - à Création Audio : avis avec le n° et la plage.
// Appel : POST { kind: 'order' | 'reservation', id } avec le JWT du client.
// Sécurité : JWT vérifié ; la commande / réservation doit appartenir au client.
// Anti-rafale : au plus 1 avis / 2 min (pickup_notified_at).
// Secrets : RESEND_API_KEY ; MAIL_FROM et ORDER_NOTIFY_TO optionnels.
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://creationaudio.ca";
const REPLY_TO = "contact@creationaudio.ca";

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
// plage de cueillette -> « jeudi 23 octobre, 13 h – 17 h » (mêmes mots que commande-client.js)
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function hTxt(t: unknown) {
  const p = String(t || "").split(":");
  return Number(p[0]) + " h" + (p[1] && p[1] !== "00" ? " " + p[1] : "");
}
function fmtPickup(d: unknown, s: unknown, e: unknown) {
  if (!d) return "";
  const p = String(d).split("-").map(Number), x = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return JOURS[x.getUTCDay()] + " " + x.getUTCDate() + " " + MOIS[x.getUTCMonth()] + (s ? ", " + hTxt(s) + (e ? " – " + hTxt(e) : "") : "");
}

async function send(key: string, from: string, msg: Record<string, unknown>) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, ...msg }),
  });
  if (!res.ok) throw new Error("Resend " + res.status + " : " + (await res.text()).slice(0, 200));
}

function wrap(kicker: string, title: string, body: string) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
    '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">' + esc(kicker) + '</p>' +
    '<h1 style="font-size:22px;margin:0 0 10px">' + esc(title) + '</h1>' + body + "</div>";
}
const box = (t: string) =>
  '<p style="margin:0 0 16px;padding:12px 14px;border-radius:10px;background:#E7F6EE;color:#16794A;font-weight:700">' + esc(t) + '</p>';
const btn = (href: string, t: string) =>
  '<p style="margin:22px 0"><a href="' + href + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">' + esc(t) + '</a></p>';

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>";
  let adminTo = Deno.env.get("ORDER_NOTIFY_TO") || "contact@creationaudio.ca";

  // 1) qui appelle ?
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id || "";
  if (!uid) return json({ error: "Connexion requise." }, 401);

  let kind = "order", id = "";
  try {
    const body = await req.json();
    kind = body?.kind === "reservation" ? "reservation" : "order";
    id = typeof body?.id === "string" ? body.id : "";
  } catch { /* corps invalide */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Identifiant invalide." }, 400);

  // 2) doit appartenir au client connecté
  const table = kind === "reservation" ? "customer_reservations" : "customer_orders";
  const db = createClient(url, service);
  const { data: x, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!x || x.customer_id !== uid) return json({ error: "Introuvable." }, 404);
  const pk = fmtPickup(x.pickup_date, x.pickup_start, x.pickup_end);
  if (!pk) return json({ result: "skipped", reason: "aucune plage" });

  // 3) anti-rafale : réservé atomiquement
  const cut = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: claim } = await db.from(table).update({ pickup_notified_at: new Date().toISOString() })
    .eq("id", id).or("pickup_notified_at.is.null,pickup_notified_at.lt." + cut).select("id");
  if (!claim || !claim.length) return json({ result: "skipped", reason: "avis récent" });

  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);
  if (/@resend\.dev$/i.test(x.email || "")) adminTo = "delivered@resend.dev";   // tests

  const what = (kind === "reservation" ? "Réservation " : "Commande ") + x.number;
  const first = String(x.name || "").trim().split(/\s+/)[0] || "";
  const accountUrl = SITE + "/compte.html#/cueillette/" + (kind === "reservation" ? "r/" : "c/") + id;
  const adminUrl = SITE + "/coulisses-t6avzpe2.html#commandes/" + (kind === "reservation" ? "reservations" : "clients");
  const results: Record<string, string> = {};

  // ---- au client ----
  const cText =
    "Bonjour " + first + ",\n\n" +
    "C'est noté : ta cueillette pour " + what.toLowerCase() + " est " + pk + ".\n\n" +
    "Tu peux la changer dans ton compte : " + accountUrl + "\n\n" +
    "Création Audio\n" + SITE;
  const cHtml = wrap("Création Audio", "Cueillette confirmée",
    '<p style="margin:0 0 14px">Bonjour ' + esc(first) + ', c\'est noté pour ' + esc(what.toLowerCase()) + '.</p>' +
    box("On t'attend " + pk + ".") + btn(accountUrl, "Voir ma commande") +
    '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
    '<p style="font-size:12px;color:#6C727C">Tu peux changer ta plage dans ton compte. Une question&nbsp;? Réponds simplement à ce courriel.</p>');
  try {
    await send(resendKey, from, { to: [x.email], reply_to: REPLY_TO, subject: "Cueillette " + pk + " — Création Audio", html: cHtml, text: cText });
    results.client = "sent";
  } catch (e) { results.client = "error: " + String((e as Error).message || e); }

  // ---- à Création Audio ----
  const who = x.name || x.email;
  const aText = "Plage de cueillette choisie — " + what + "\n" + who + " · " + x.email + (x.phone ? " · " + x.phone : "") +
    "\n\nCueillette : " + pk + "\n\nOuvrir dans l'admin : " + adminUrl + "\n";
  const aHtml = wrap("Cueillette", "Plage choisie — " + what,
    '<p style="margin:0 0 16px;color:#3A3D45">' + esc(who) + ' · ' + esc(x.email) + (x.phone ? ' · ' + esc(x.phone) : '') + '</p>' +
    box("Cueillette : " + pk) + btn(adminUrl, "Ouvrir dans l'admin"));
  try {
    await send(resendKey, from, { to: [adminTo], reply_to: x.email, subject: "Cueillette " + what + " — " + who + " · " + pk, html: aHtml, text: aText });
    results.admin = "sent";
  } catch (e) { results.admin = "error: " + String((e as Error).message || e); }

  return json({ result: "done", ...results });
});
