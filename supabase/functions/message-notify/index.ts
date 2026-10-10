// =========================================================
// Création Audio — Edge Function « message-notify » (messagerie)
// Appelée juste après l'envoi d'un message :
//  - message du CLIENT (panneau « Écris-nous », assets/messagerie.js) -> avis à
//    Création Audio, UN par conversation tant que l'admin n'a pas répondu
//    (admin_notified_at, remis à null par sa réponse — déclencheur SQL).
//  - message de l'ADMIN (onglet Messages, assets/cms-messages.js) -> avis au
//    client, UN par série de réponses non lues (client_notified_at, remis à null
//    quand il ouvre la conversation — RPC me_messages).
// Appel : POST { message_id } avec le JWT de l'expéditeur.
// Sécurité : JWT vérifié ; client = propriétaire de la conversation ; admin =
// is_admin() (courriel admin + 2FA). Un message de plus d'une heure n'avise plus.
// Photos : liens signés valables 7 jours dans l'avis admin (bucket privé).
// Adresses de test Resend (…@resend.dev) : l'avis admin part aussi au puits de test.
// Secrets : RESEND_API_KEY ; MAIL_FROM et MESSAGE_NOTIFY_TO optionnels.
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://creationaudio.ca";
const REPLY_TO = "contact@creationaudio.ca";
const TOPIC: Record<string, string> = { filaments: "Filaments", spacers: "Spacers", compte: "Mon compte", autre: "Autre" };

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

async function send(key: string, from: string, msg: Record<string, unknown>) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, ...msg }),
  });
  if (!res.ok) throw new Error("Resend " + res.status + " : " + (await res.text()).slice(0, 200));
}

const box = (inner: string) =>
  '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' + inner + "</div>";
const eyebrow = (t: string) =>
  '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">' + esc(t) + "</p>";
const button = (href: string, label: string) =>
  '<p style="margin:22px 0"><a href="' + href + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;' +
  'padding:12px 22px;border-radius:100px;display:inline-block">' + esc(label) + "</a></p>";
const quote = (body: string) => body
  ? '<div style="margin:0 0 6px;padding:14px 16px;background:#F4F3EF;border-radius:12px">' + nl2br(body) + "</div>"
  : "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>";
  let adminTo = Deno.env.get("MESSAGE_NOTIFY_TO") || "contact@creationaudio.ca";

  // 1) qui appelle ?
  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id || "";
  if (!uid) return json({ error: "Connexion requise." }, 401);

  let messageId = "";
  try { const b = await req.json(); messageId = typeof b?.message_id === "string" ? b.message_id : ""; } catch { /* corps invalide */ }
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return json({ error: "Message invalide." }, 400);

  // 2) le message, sa conversation, le client
  const db = createClient(url, service);
  const { data: msg, error } = await db.from("messages").select("*").eq("id", messageId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!msg) return json({ error: "Message introuvable." }, 404);
  const { data: conv } = await db.from("conversations").select("*").eq("id", msg.conversation_id).maybeSingle();
  if (!conv) return json({ error: "Conversation introuvable." }, 404);
  const { data: cust } = await db.from("customers").select("email, name, phone").eq("id", conv.customer_id).maybeSingle();
  if (!cust) return json({ error: "Client introuvable." }, 404);

  if (msg.sender === "client") {
    if (conv.customer_id !== uid) return json({ error: "Message introuvable." }, 404);
  } else {
    const { data: isAdmin } = await userClient.rpc("is_admin");
    if (isAdmin !== true) return json({ error: "Réservé à l'administrateur." }, 403);
  }
  if (Date.now() - Date.parse(msg.created_at) > 3600 * 1000) return json({ result: "skipped", reason: "message ancien" });
  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);

  const about = (TOPIC[conv.topic] || "Question") + (conv.ref ? " · " + conv.ref : "");
  const photos: string[] = Array.isArray(msg.photos) ? msg.photos : [];
  const body = String(msg.body || "").trim();
  const first = String(cust.name || "").trim().split(/\s+/)[0] || "";

  // ---- message du client -> avis à Création Audio ----
  if (msg.sender === "client") {
    if (conv.admin_notified_at) return json({ result: "skipped", reason: "déjà avisé" });
    if (/@resend\.dev$/i.test(cust.email || "")) adminTo = "delivered@resend.dev";   // tests
    let shots = "";
    if (photos.length) {
      const { data: signed } = await db.storage.from("messages").createSignedUrls(photos, 7 * 24 * 3600);
      shots = '<p style="margin:10px 0 0">' + (signed || []).filter((s) => s.signedUrl).map((s, i) =>
        '<a href="' + esc(s.signedUrl) + '" style="display:inline-block;margin:0 6px 6px 0">' +
        '<img src="' + esc(s.signedUrl) + '" alt="Photo ' + (i + 1) + '" width="120" height="120" ' +
        'style="width:120px;height:120px;object-fit:cover;border-radius:10px;border:1px solid #E7E7E2"></a>').join("") + "</p>";
    }
    const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv.id);
    const isNew = (count || 0) <= 1;
    const adminUrl = SITE + "/coulisses-t6avzpe2.html#messages/" + conv.id;
    const who = cust.name || cust.email;
    const subject = (isNew ? "Nouveau message" : "Nouvelle réponse") + " — " + about + " — " + who;
    const text =
      (isNew ? "Nouveau message" : "Nouvelle réponse") + " (" + about + ")\n" +
      who + " · " + cust.email + (cust.phone ? " · " + cust.phone : "") + "\n" +
      (conv.page ? "Page : " + SITE + conv.page + "\n" : "") + "\n" +
      (body || "(photo seulement)") + "\n" +
      (photos.length ? "\n" + nPhotos(photos.length) + " jointe" + (photos.length > 1 ? "s" : "") + "\n" : "") +
      "\nRépondre dans l'admin : " + adminUrl + "\n";
    const html = box(
      eyebrow("Messagerie · " + about) +
      '<h1 style="font-size:22px;margin:0 0 6px">' + esc(who) + "</h1>" +
      '<p style="margin:0 0 16px;color:#3A3D45">' + esc(cust.email) + (cust.phone ? " · " + esc(cust.phone) : "") +
        (conv.page ? '<br><span style="font-size:12px;color:#6C727C">Depuis ' + esc(conv.page) + "</span>" : "") + "</p>" +
      quote(body) + shots +
      button(adminUrl, "Répondre") +
      '<p style="font-size:12px;color:#6C727C">Un seul avis par conversation tant que tu n\'as pas répondu.</p>');
    try {
      await send(resendKey, from, { to: [adminTo], reply_to: cust.email, subject, html, text });
    } catch (e) { return json({ error: String((e as Error).message || e) }, 502); }
    await db.from("conversations").update({ admin_notified_at: new Date().toISOString() }).eq("id", conv.id);
    return json({ result: "sent", to: "admin" });
  }

  // ---- réponse de l'admin -> avis au client ----
  if (conv.client_notified_at) return json({ result: "skipped", reason: "client déjà avisé" });
  const threadUrl = SITE + "/compte.html#/messages/" + conv.id;
  const subject = "Création Audio t'a répondu — " + about;
  const text =
    "Bonjour" + (first ? " " + first : "") + ",\n\n" +
    "On a répondu à ta question (" + about + ") :\n\n" +
    (body || "(photo)") + "\n" +
    (photos.length ? "\n" + nPhotos(photos.length) + " dans la conversation.\n" : "") +
    "\nVoir et répondre : " + threadUrl + "\n\nCréation Audio\n" + SITE;
  const html = box(
    eyebrow("Création Audio") +
    '<h1 style="font-size:22px;margin:0 0 10px">On t\'a répondu</h1>' +
    '<p style="margin:0 0 14px">Bonjour' + (first ? " " + esc(first) : "") + ", voici notre réponse à ta question <strong>" +
      esc(about) + "</strong>&nbsp;:</p>" +
    quote(body) +
    (photos.length ? '<p style="margin:8px 0 0;color:#6C727C;font-size:13px">' + nPhotos(photos.length) + " dans la conversation.</p>" : "") +
    button(threadUrl, "Voir et répondre") +
    '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
    '<p style="font-size:12px;color:#6C727C">Réponds dans la messagerie pour garder tout le fil au même endroit. ' +
    '<a href="' + SITE + '" style="color:#6C727C">creationaudio.ca</a></p>');
  try {
    await send(resendKey, from, { to: [cust.email], reply_to: REPLY_TO, subject, html, text });
  } catch (e) { return json({ error: String((e as Error).message || e) }, 502); }
  await db.from("conversations").update({ client_notified_at: new Date().toISOString() }).eq("id", conv.id);
  return json({ result: "sent", to: "client" });
});
