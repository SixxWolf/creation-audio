// =========================================================
// Création Audio — Edge Function « message-notify » (messagerie)
// Courriels DIFFÉRÉS : appelée chaque minute par le tick pg_cron
// (public.messages_tick, via pg_net, seulement quand un avis est dû) :
//  - série de messages du CLIENT non lue par l'admin depuis 5 min -> UN avis à
//    Création Audio qui regroupe toute la série (photos en liens signés 7 jours).
//  - série de réponses de l'ADMIN non lue par le client depuis 5 min -> UN avis
//    au client (conversation lancée par l'admin : « Message de Création Audio »).
//    Langue de l'avis au client : customers.lang ('en' = version anglaise du site).
// Quelqu'un dans le fil lit en direct (relecture aux 10 s) -> rien n'est dû.
// Lire ou répondre remet *_unread_since / *_notified_at à null (déclencheur
// SQL) : le prochain message réarme l'avis. Chaque avis est réclamé en base
// (*_notified_at) AVANT l'envoi : jamais deux fois, même en cas d'appels croisés.
// Sécurité : en-tête x-cron-key vérifié par reservation_cron_ok (même clé que
// le tick des réservations). Les anciens appels { message_id } du navigateur
// (pages en cache) répondent « deferred » sans rien faire.
// Adresses de test Resend (…@resend.dev) : l'avis admin part aussi au puits de test.
// Secrets : RESEND_API_KEY ; MAIL_FROM et MESSAGE_NOTIFY_TO optionnels.
// =========================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as M from "../_shared/mail.ts";

const SITE = "https://creationaudio.ca";
const REPLY_TO = "contact@creationaudio.ca";
const DELAY_MS = 5 * 60 * 1000;          // non lu depuis 5 min -> courriel
const MAX_AGE_MS = 2 * 86400 * 1000;     // série plus vieille : jamais avisée (ménage)
const TOPIC: Record<string, string> = { filaments: "Filaments", spacers: "Spacers", compte: "Mon compte", autre: "Autre" };
const TOPIC_EN: Record<string, string> = { filaments: "Filaments", spacers: "Spacers", compte: "My account", autre: "Other" };

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
const nl2br = (s: string) => esc(s).replace(/\r?\n/g, "<br>");
const nPhotos = (n: number) => n + " photo" + (n > 1 ? "s" : "");
let HOUR_LOC = "fr-CA";   // en-CA le temps d'un avis à un client de la version anglaise
const hour = (iso: string) =>
  new Date(iso).toLocaleTimeString(HOUR_LOC, { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" });

type Mailer = { key: string; from: string; adminTo: string };
type Conv = { id: string; customer_id: string; topic: string; ref: string | null; page: string | null;
  admin_unread_since: string | null; client_unread_since: string | null };
type Msg = { body: string; photos: string[]; created_at: string };

async function send(m: Mailer, msg: Record<string, unknown>) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + m.key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: m.from, ...msg }),
  });
  if (!res.ok) throw new Error("Resend " + res.status + " : " + (await res.text()).slice(0, 200));
}

// gabarit commun (même look que la facture) : voir ../_shared/mail.ts
const button = (href: string, label: string) => M.button(href, label, 18);
const quote = (body: string, when = "") =>
  M.panel((when ? '<div class="soft" style="font-size:12px;line-height:16px;color:#6C727C;margin:0 0 4px">' + esc(when) + "</div>" : "") +
    (body ? nl2br(body) : '<span class="soft" style="color:#6C727C">(photo)</span>'));
// série de messages : l'heure n'est utile que s'il y en a plusieurs
const quotes = (list: Msg[]) => list.map((x) => quote(String(x.body || "").trim(), list.length > 1 ? hour(x.created_at) : "")).join("");
const asText = (list: Msg[]) => list.map((x) =>
  (list.length > 1 ? "[" + hour(x.created_at) + "] " : "") + (String(x.body || "").trim() || "(photo)")).join("\n\n");
const photosOf = (list: Msg[]) => list.flatMap((x) => Array.isArray(x.photos) ? x.photos : []);

async function series(db: SupabaseClient, convId: string, sender: string, since: string) {
  const { data } = await db.from("messages").select("body, photos, created_at")
    .eq("conversation_id", convId).eq("sender", sender).gte("created_at", since).order("created_at");
  return (data || []) as Msg[];
}

// ---- série du client -> avis à Création Audio ----
async function mailAdmin(db: SupabaseClient, m: Mailer, conv: Conv) {
  const { data: cust } = await db.from("customers").select("email, name, phone").eq("id", conv.customer_id).maybeSingle();
  if (!cust) return;
  const list = await series(db, conv.id, "client", conv.admin_unread_since!);
  if (!list.length) return;
  const about = (TOPIC[conv.topic] || "Question") + (conv.ref ? " · " + conv.ref : "");
  const photos = photosOf(list);
  let shots = "";
  if (photos.length) {
    const { data: signed } = await db.storage.from("messages").createSignedUrls(photos, 7 * 24 * 3600);
    shots = M.photoGrid((signed || []).filter((s) => s.signedUrl).map((s) => s.signedUrl as string));
  }
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
  const isNew = (count || 0) <= list.length;   // toute la conversation est dans la série
  const what = list.length > 1 ? list.length + " nouveaux messages" : isNew ? "Nouveau message" : "Nouvelle réponse";
  const adminUrl = SITE + "/coulisses-t6avzpe2#messages/" + conv.id;
  const who = cust.name || cust.email;
  const to = /@resend\.dev$/i.test(cust.email || "") ? "delivered@resend.dev" : m.adminTo;   // tests
  const text =
    what + " (" + about + ")\n" +
    who + " · " + cust.email + (cust.phone ? " · " + cust.phone : "") + "\n" +
    (conv.page ? "Page : " + SITE + conv.page + "\n" : "") + "\n" +
    asText(list) + "\n" +
    (photos.length ? "\n" + nPhotos(photos.length) + " jointe" + (photos.length > 1 ? "s" : "") + "\n" : "") +
    "\nRépondre dans l'admin : " + adminUrl + "\n";
  const html = M.page({
    lang: "fr", admin: true, tag: "Messagerie", ref: TOPIC[conv.topic] || "Question", refSub: conv.ref || "", title: what,
    preheader: who + " · " + (String(list[0]?.body || "").trim().slice(0, 90) || "photo"),
    body: M.who(cust.name, cust.email, cust.phone, conv.page ? "Depuis " + esc(conv.page) : "") +
      quotes(list) + shots + button(adminUrl, "Répondre") +
      M.small("Un seul avis par série de messages restée non lue 5 min."),
  });
  await send(m, { to: [to], reply_to: cust.email, subject: what + " — " + about + " — " + who, html, text });
}

// ---- série de l'admin -> avis au client ----
async function mailClient(db: SupabaseClient, m: Mailer, conv: Conv) {
  const { data: cust } = await db.from("customers").select("email, name, lang").eq("id", conv.customer_id).maybeSingle();
  if (!cust) return;
  const list = await series(db, conv.id, "admin", conv.client_unread_since!);
  if (!list.length) return;
  if (cust.lang === "en") return await mailClientEn(db, m, conv, cust, list);
  const about = (TOPIC[conv.topic] || "Question") + (conv.ref ? " · " + conv.ref : "");
  const photos = photosOf(list);
  const threadUrl = SITE + "/compte#/messages/" + conv.id;
  const photoNote = photos.length
    ? M.small(nPhotos(photos.length) + " dans la conversation.") : "";
  // conversation lancée par l'admin (aucun message du client) : « message », pas « réponse »
  const { count: fromClient } = await db.from("messages").select("id", { count: "exact", head: true })
    .eq("conversation_id", conv.id).eq("sender", "client");
  if (!fromClient) {
    // le texte (souvent un modèle vouvoyé) porte déjà sa salutation : rien d'ajouté autour
    const text = asText(list) + "\n" +
      (photos.length ? "\n" + nPhotos(photos.length) + " dans la conversation.\n" : "") +
      "\nVoir et répondre : " + threadUrl + "\n\n" + SITE;
    const html = M.page({
      lang: "fr", tag: "Messagerie", title: list.length > 1 ? list.length + " nouveaux messages" : "Nouveau message",
      body: quotes(list) + photoNote + button(threadUrl, "Voir et répondre"),
      foot: "Répondez dans la messagerie pour garder tout le fil au même endroit.",
    });
    await send(m, { to: [cust.email], reply_to: REPLY_TO, subject: "Message de Création Audio", html, text });
    return;
  }
  const first = String(cust.name || "").trim().split(/\s+/)[0] || "";
  const text =
    "Bonjour" + (first ? " " + first : "") + ",\n\n" +
    "On a répondu à ta question (" + about + ") :\n\n" +
    asText(list) + "\n" +
    (photos.length ? "\n" + nPhotos(photos.length) + " dans la conversation.\n" : "") +
    "\nVoir et répondre : " + threadUrl + "\n\nCréation Audio\n" + SITE;
  const html = M.page({
    lang: "fr", tag: "Messagerie", ref: TOPIC[conv.topic] || "Question", refSub: conv.ref || "", title: "On t'a répondu",
    body: M.text("Bonjour" + (first ? " " + esc(first) : "") + ", voici notre réponse à ta question <strong>" + esc(about) + "</strong>&nbsp;:") +
      quotes(list) + photoNote + button(threadUrl, "Voir et répondre"),
    foot: "Réponds dans la messagerie pour garder tout le fil au même endroit.",
  });
  await send(m, { to: [cust.email], reply_to: REPLY_TO, subject: "Création Audio t'a répondu — " + about, html, text });
}

// ---- version anglaise (client de /en/, customers.lang) ----
async function mailClientEn(db: SupabaseClient, m: Mailer, conv: Conv, cust: { email: string; name: string | null }, list: Msg[]) {
  HOUR_LOC = "en-CA";
  try {
    const about = (TOPIC_EN[conv.topic] || "Question") + (conv.ref ? " · " + conv.ref : "");
    const photos = photosOf(list);
    const nPh = (n: number) => n + " photo" + (n > 1 ? "s" : "");
    const threadUrl = SITE + "/en/compte#/messages/" + conv.id;
    const photoNote = photos.length
      ? M.small(nPh(photos.length) + " in the conversation.") : "";
    const foot = "Reply in the messages to keep the whole thread in one place.";
    const { count: fromClient } = await db.from("messages").select("id", { count: "exact", head: true })
      .eq("conversation_id", conv.id).eq("sender", "client");
    if (!fromClient) {
      const text = asText(list) + "\n" + (photos.length ? "\n" + nPh(photos.length) + " in the conversation.\n" : "") +
        "\nSee and reply: " + threadUrl + "\n\n" + SITE + "/en/";
      const html = M.page({ lang: "en", tag: "Messages", title: list.length > 1 ? list.length + " new messages" : "New message",
        body: quotes(list) + photoNote + button(threadUrl, "See and reply"), foot });
      await send(m, { to: [cust.email], reply_to: REPLY_TO, subject: "Message from Création Audio", html, text });
      return;
    }
    const first = String(cust.name || "").trim().split(/\s+/)[0] || "";
    const text =
      "Hello" + (first ? " " + first : "") + ",\n\n" +
      "We replied to your question (" + about + "):\n\n" +
      asText(list) + "\n" +
      (photos.length ? "\n" + nPh(photos.length) + " in the conversation.\n" : "") +
      "\nSee and reply: " + threadUrl + "\n\nCréation Audio\n" + SITE + "/en/";
    const html = M.page({ lang: "en", tag: "Messages", ref: TOPIC_EN[conv.topic] || "Question", refSub: conv.ref || "", title: "We replied",
      body: M.text("Hello" + (first ? " " + esc(first) : "") + ", here is our reply to your question <strong>" + esc(about) + "</strong>:") +
        quotes(list) + photoNote + button(threadUrl, "See and reply"), foot });
    await send(m, { to: [cust.email], reply_to: REPLY_TO, subject: "Création Audio replied — " + about, html, text });
  } finally { HOUR_LOC = "fr-CA"; }
}

// ---- tick : séries dues, chacune réclamée en base avant l'envoi ----
async function runCron(db: SupabaseClient, m: Mailer) {
  const now = Date.now(), iso = new Date(now).toISOString();
  const due = new Date(now - DELAY_MS).toISOString(), oldest = new Date(now - MAX_AGE_MS).toISOString();
  const out = { admin: 0, client: 0, errors: [] as string[] };
  const cols = "id, customer_id, topic, ref, page, admin_unread_since, client_unread_since";

  const { data: forAdmin } = await db.from("conversations").update({ admin_notified_at: iso })
    .gt("admin_unread", 0).is("admin_notified_at", null).lte("admin_unread_since", due).gt("admin_unread_since", oldest)
    .select(cols);
  for (const c of (forAdmin || []) as Conv[]) {
    try { await mailAdmin(db, m, c); out.admin++; } catch (e) { out.errors.push(c.id + " : " + (e as Error).message); }
  }
  const { data: forClient } = await db.from("conversations").update({ client_notified_at: iso })
    .gt("client_unread", 0).is("client_notified_at", null).lte("client_unread_since", due).gt("client_unread_since", oldest)
    .select(cols);
  for (const c of (forClient || []) as Conv[]) {
    try { await mailClient(db, m, c); out.client++; } catch (e) { out.errors.push(c.id + " : " + (e as Error).message); }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps invalide */ }
  if (body?.cron !== true) return json({ result: "deferred" });   // ancien appel du navigateur : le tick s'en charge

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("reservation_cron_ok", { p_key: req.headers.get("x-cron-key") || "" });
  if (ok !== true) return json({ error: "Clé invalide." }, 401);
  await M.loadCompany(db);
  const key = Deno.env.get("RESEND_API_KEY") || "";
  if (!key) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);
  const m: Mailer = {
    key,
    from: Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>",
    adminTo: Deno.env.get("MESSAGE_NOTIFY_TO") || "contact@creationaudio.ca",
  };
  return json({ result: "done", ...(await runCron(db, m)) });
});
