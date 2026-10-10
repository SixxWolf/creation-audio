// =========================================================
// Création Audio — Edge Function « reservation-notify » (réservations, comptes clients étape 3)
// Deux façons d'être appelée :
//  1) par le CLIENT (JWT), juste après customer_reserve / customer_cancel_reservation
//     (assets/commande-client.js, assets/compte.js) : POST { reservation_id, event: 'new' | 'cancelled' }
//     - new : confirmation au client (gardé jusqu'au …) + avis à Création Audio ;
//     - cancelled : avis à Création Audio (stock libéré).
//     La réservation doit appartenir au client. « new » une seule fois (notified_at).
//  2) par le TICK pg_cron (public.reservations_tick, aux 10 min, via pg_net) :
//     POST { cron: true } + en-tête x-cron-key (private.secrets « cron_key »).
//     - rappel au client ~12 h avant l'échéance (reminded_at) ;
//     - expirée : avis au client (non récupérée, suspension éventuelle) + à Création Audio ;
//     - annulée par l'admin : avis au client.
//     Chaque courriel est « réclamé » en base AVANT l'envoi -> jamais en double.
// Adresses de test Resend (…@resend.dev) : l'avis admin part aussi vers le puits de test.
// Secrets : RESEND_API_KEY ; MAIL_FROM et ORDER_NOTIFY_TO optionnels.
// =========================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://creationaudio.ca";
const REPLY_TO = "contact@creationaudio.ca";
const ACCOUNT_URL = SITE + "/compte.html#/commandes";
const ADMIN_URL = SITE + "/coulisses-t6avzpe2.html#commandes/reservations";

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
function money(n: unknown) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",") + " $";
}
function plural(n: number, one: string, many: string) { return n + " " + (n > 1 ? many : one); }
// « jeudi 12 octobre, 14 h 30 » (heure de Québec)
function when(iso: string) {
  try {
    return new Intl.DateTimeFormat("fr-CA", {
      timeZone: "America/Toronto", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return String(iso).slice(0, 16).replace("T", " "); }
}
function day(iso: string) {
  try {
    return new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Toronto", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
  } catch { return String(iso).slice(0, 10); }
}

type Res = {
  id: string; number: string; customer_id: string | null; email: string; name: string | null; phone: string | null;
  status: string; note: string | null; total: number; expires_at: string; created_at: string; cancelled_by: string | null;
  notified_at: string | null;
};
type Line = { name: string; meta: string | null; qty: number; unit_price: number; line_total: number };

type Mailer = { key: string; from: string; adminTo: string };
async function send(m: Mailer, msg: Record<string, unknown>) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + m.key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: m.from, ...msg }),
  });
  if (!res.ok) throw new Error("Resend " + res.status + " : " + (await res.text()).slice(0, 200));
}
function adminTo(m: Mailer, r: Res) { return /@resend\.dev$/i.test(r.email || "") ? "delivered@resend.dev" : m.adminTo; }

// ---- gabarits ----
function shell(kicker: string, title: string, body: string) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
    '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">' + esc(kicker) + '</p>' +
    '<h1 style="font-size:22px;margin:0 0 10px">' + esc(title) + '</h1>' + body + '</div>';
}
function box(text: string, tone: "ok" | "warn" | "info") {
  const c = tone === "ok" ? "background:#E7F6EE;color:#16794A" : tone === "warn" ? "background:#FFF3EC;color:#9A4A0E" : "background:#F4F3EF;color:#3A3D45";
  return '<p style="margin:0 0 16px;padding:12px 14px;border-radius:10px;' + c + ';font-weight:700">' + esc(text) + '</p>';
}
function table(L: Line[], total: number) {
  return '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '<tr style="background:#F4F3EF"><th style="padding:8px 10px;text-align:left">Article</th><th style="padding:8px 10px;text-align:right">Qté</th>' +
    '<th style="padding:8px 10px;text-align:right">Total</th></tr>' +
    L.map((l) => '<tr>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2"><strong>' + esc(l.name) + '</strong>' +
        (l.meta ? '<br><span style="color:#6C727C;font-size:12px">' + esc(l.meta) + '</span>' : '') + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + esc(l.qty) + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + money(l.line_total) + '</td></tr>').join("") +
    '</table>' +
    '<p style="margin:14px 0 0;text-align:right;font-size:16px"><strong>Total estimé : ' + money(total) + '</strong></p>';
}
function linesText(L: Line[]) {
  return L.map((l) => "- " + l.name + (l.meta ? " (" + l.meta + ")" : "") + " × " + l.qty + " — " + money(l.line_total)).join("\n");
}
function button(href: string, label: string) {
  return '<p style="margin:22px 0"><a href="' + href + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">' + esc(label) + '</a></p>';
}
const FOOT = '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
  '<p style="font-size:12px;color:#6C727C">Une question&nbsp;? Réponds simplement à ce courriel.</p>';
function first(r: Res) { return String(r.name || "").trim().split(/\s+/)[0] || ""; }

async function linesOf(db: SupabaseClient, id: string) {
  const { data } = await db.from("customer_reservation_lines")
    .select("name, meta, qty, unit_price, line_total").eq("reservation_id", id).order("sort_order");
  return (data || []) as Line[];
}

// ---- courriels ----
async function mailNew(m: Mailer, r: Res, L: Line[]) {
  const until = when(r.expires_at);
  const subject = "Réservation " + r.number + " confirmée — Création Audio";
  const text = "Bonjour " + first(r) + ",\n\nTa réservation " + r.number + " est confirmée : on garde tes articles jusqu'au " + until + ".\n\n" +
    linesText(L) + "\n\nTotal estimé : " + money(r.total) + "\nCueillette à Québec · tu paies à la cueillette.\n" +
    (r.note ? "\nTa note : " + r.note + "\n" : "") +
    "\nPasse avant l'échéance : après, les articles sont remis en vente et la réservation compte comme non récupérée " +
    "(2 non récupérées = réservations suspendues 60 jours). Un empêchement ? Annule-la dans ton compte : " + ACCOUNT_URL + "\n\nCréation Audio\n" + SITE;
  const html = shell("Création Audio", "Réservation " + r.number + " confirmée",
    '<p style="margin:0 0 14px">Bonjour ' + esc(first(r)) + ', c\'est réservé&nbsp;!</p>' +
    box("On garde tes articles jusqu'au " + until + ".", "ok") + table(L, r.total) +
    '<p style="margin:6px 0 0;text-align:right;color:#6C727C;font-size:13px">Cueillette à Québec · tu paies à la cueillette.</p>' +
    (r.note ? '<p style="margin:16px 0 0;padding:10px 12px;background:#F4F3EF;border-radius:10px"><strong>Ta note :</strong> ' + esc(r.note) + '</p>' : "") +
    button(ACCOUNT_URL, "Voir ma réservation") +
    '<p style="font-size:13px;color:#3A3D45">Passe avant l\'échéance : après, les articles sont remis en vente et la réservation compte comme non récupérée ' +
    '(2 non récupérées = réservations suspendues 60 jours). Un empêchement&nbsp;? Annule-la dans ton compte.</p>' + FOOT);
  await send(m, { to: [r.email], reply_to: REPLY_TO, subject, html, text });
}
async function mailReminder(m: Mailer, r: Res, L: Line[]) {
  const until = when(r.expires_at);
  const subject = "Rappel : ta réservation " + r.number + " se termine bientôt";
  const text = "Bonjour " + first(r) + ",\n\nPetit rappel : on garde ta réservation " + r.number + " jusqu'au " + until + ".\n\n" +
    linesText(L) + "\n\nTotal estimé : " + money(r.total) + "\n\nTu ne pourras pas passer ? Annule-la dans ton compte (" + ACCOUNT_URL +
    ") : elle ne comptera pas comme non récupérée.\n\nCréation Audio\n" + SITE;
  const html = shell("Création Audio", "Ta réservation " + r.number + " se termine bientôt",
    '<p style="margin:0 0 14px">Bonjour ' + esc(first(r)) + ',</p>' +
    box("On la garde jusqu'au " + until + ".", "warn") + table(L, r.total) + button(ACCOUNT_URL, "Voir ma réservation") +
    '<p style="font-size:13px;color:#3A3D45">Tu ne pourras pas passer&nbsp;? Annule-la dans ton compte : elle ne comptera pas comme non récupérée.</p>' + FOOT);
  await send(m, { to: [r.email], reply_to: REPLY_TO, subject, html, text });
}
async function mailExpired(m: Mailer, r: Res, L: Line[], cust: { no_shows: number; reserve_suspended_until: string | null } | null) {
  const susp = cust?.reserve_suspended_until && Date.parse(cust.reserve_suspended_until) > Date.now() ? cust.reserve_suspended_until : null;
  const status = susp
    ? "C'est ta 2e réservation non récupérée : les réservations sont suspendues jusqu'au " + day(susp) + ". Tu peux toujours commander en ligne."
    : "Elle compte comme non récupérée (1 sur 2). À 2, les réservations sont suspendues 60 jours.";
  const subject = "Réservation " + r.number + " expirée — Création Audio";
  const text = "Bonjour " + first(r) + ",\n\nTa réservation " + r.number + " a expiré : les articles sont remis en vente.\n\n" + status +
    "\n\n" + linesText(L) + "\n\nUn imprévu ? Réponds à ce courriel.\n\nCréation Audio\n" + SITE;
  const html = shell("Création Audio", "Réservation " + r.number + " expirée",
    '<p style="margin:0 0 14px">Bonjour ' + esc(first(r)) + ', ta réservation a expiré : les articles sont remis en vente.</p>' +
    box(status, "warn") + table(L, r.total) + FOOT.replace("Une question&nbsp;?", "Un imprévu&nbsp;?"));
  await send(m, { to: [r.email], reply_to: REPLY_TO, subject, html, text });
  // avis à Création Audio : le sac préparé peut retourner en tablette
  const aSubject = "Réservation " + r.number + " expirée — " + (r.name || r.email) + (susp ? " (suspendu 60 j)" : "");
  const aText = "Réservation " + r.number + " expirée (non récupérée)" + (susp ? " — réservations suspendues jusqu'au " + day(susp) : "") +
    "\n" + (r.name || "") + " · " + r.email + (r.phone ? " · " + r.phone : "") + "\n\n" + linesText(L) + "\n\nStock libéré. Admin : " + ADMIN_URL + "\n";
  const aHtml = shell("Réservation", "Réservation " + r.number + " expirée",
    '<p style="margin:0 0 16px;color:#3A3D45">' + esc(r.name || "") + ' · ' + esc(r.email) + (r.phone ? ' · ' + esc(r.phone) : '') + '</p>' +
    box("Non récupérée — stock libéré" + (susp ? " · réservations suspendues jusqu'au " + day(susp) : "") + ".", "warn") +
    table(L, r.total) + button(ADMIN_URL, "Ouvrir dans l'admin"));
  await send(m, { to: [adminTo(m, r)], reply_to: r.email, subject: aSubject, html: aHtml, text: aText });
}
async function mailAdminCancelled(m: Mailer, r: Res, L: Line[]) {
  const subject = "Réservation " + r.number + " annulée — Création Audio";
  const text = "Bonjour " + first(r) + ",\n\nTa réservation " + r.number + " a été annulée par Création Audio. Elle ne compte pas comme non récupérée.\n\n" +
    linesText(L) + "\n\nUne question ? Réponds à ce courriel.\n\nCréation Audio\n" + SITE;
  const html = shell("Création Audio", "Réservation " + r.number + " annulée",
    '<p style="margin:0 0 14px">Bonjour ' + esc(first(r)) + ',</p>' +
    box("Ta réservation a été annulée par Création Audio. Elle ne compte pas comme non récupérée.", "info") + table(L, r.total) + FOOT);
  await send(m, { to: [r.email], reply_to: REPLY_TO, subject, html, text });
}
async function mailAdmin(m: Mailer, r: Res, L: Line[], event: "new" | "cancelled") {
  const items = L.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const label = event === "new" ? "Nouvelle réservation" : "Réservation annulée par le client";
  const who = r.name || r.email;
  const subject = label + " " + r.number + " — " + who + (event === "new" ? " (" + plural(items, "article", "articles") + ", jusqu'au " + when(r.expires_at) + ")" : "");
  const text = label + " " + r.number + "\n" + who + " · " + r.email + (r.phone ? " · " + r.phone : "") + "\n" +
    (event === "new" ? "Gardée jusqu'au " + when(r.expires_at) + "\n" : "Stock libéré.\n") + "\n" + linesText(L) +
    "\n\nTotal : " + money(r.total) + "\n" + (r.note ? "\nNote du client : " + r.note + "\n" : "") + "\nOuvrir dans l'admin : " + ADMIN_URL + "\n";
  const html = shell("Réservation", label + " " + r.number,
    '<p style="margin:0 0 16px;color:#3A3D45">' + esc(who) + ' · ' + esc(r.email) + (r.phone ? ' · ' + esc(r.phone) : '') + '</p>' +
    box(event === "new" ? "Gardée jusqu'au " + when(r.expires_at) + "." : "Stock libéré.", event === "new" ? "ok" : "info") +
    table(L, r.total) +
    (r.note ? '<p style="margin:16px 0 0;padding:10px 12px;background:#F4F3EF;border-radius:10px"><strong>Note :</strong> ' + esc(r.note) + '</p>' : "") +
    button(ADMIN_URL, "Ouvrir dans l'admin"));
  await send(m, { to: [adminTo(m, r)], reply_to: r.email, subject, html, text });
}

// ---- tick : courriels dus, chacun réclamé en base avant l'envoi ----
async function runCron(db: SupabaseClient, m: Mailer) {
  const now = new Date(), iso = now.toISOString();
  const out = { reminders: 0, expired: 0, cancelled: 0, errors: [] as string[] };
  const soon = new Date(now.getTime() + 12 * 3600 * 1000).toISOString();
  const hourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
  const twoDays = new Date(now.getTime() - 2 * 86400 * 1000).toISOString();

  const { data: rem } = await db.from("customer_reservations").update({ reminded_at: iso })
    .eq("status", "active").is("reminded_at", null).lte("expires_at", soon).gt("expires_at", iso).lte("created_at", hourAgo)
    .select("*");
  for (const r of (rem || []) as Res[]) {
    try { await mailReminder(m, r, await linesOf(db, r.id)); out.reminders++; } catch (e) { out.errors.push(r.number + " : " + (e as Error).message); }
  }
  const { data: exp } = await db.from("customer_reservations").update({ closed_mailed_at: iso })
    .eq("status", "expired").is("closed_mailed_at", null).gt("updated_at", twoDays).select("*");
  for (const r of (exp || []) as Res[]) {
    try {
      const { data: c } = r.customer_id
        ? await db.from("customers").select("no_shows, reserve_suspended_until").eq("id", r.customer_id).maybeSingle()
        : { data: null };
      await mailExpired(m, r, await linesOf(db, r.id), c as { no_shows: number; reserve_suspended_until: string | null } | null);
      out.expired++;
    } catch (e) { out.errors.push(r.number + " : " + (e as Error).message); }
  }
  const { data: can } = await db.from("customer_reservations").update({ closed_mailed_at: iso })
    .eq("status", "cancelled").eq("cancelled_by", "admin").is("closed_mailed_at", null).gt("updated_at", twoDays).select("*");
  for (const r of (can || []) as Res[]) {
    try { await mailAdminCancelled(m, r, await linesOf(db, r.id)); out.cancelled++; } catch (e) { out.errors.push(r.number + " : " + (e as Error).message); }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const key = Deno.env.get("RESEND_API_KEY") || "";
  const m: Mailer = {
    key,
    from: Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>",
    adminTo: Deno.env.get("ORDER_NOTIFY_TO") || "contact@creationaudio.ca",
  };
  const db = createClient(url, service);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps invalide */ }

  // ---- 2) tick pg_cron ----
  if (body?.cron === true) {
    const ck = req.headers.get("x-cron-key") || "";
    const { data: ok } = await db.rpc("reservation_cron_ok", { p_key: ck });
    if (ok !== true) return json({ error: "Clé invalide." }, 401);
    if (!key) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);
    return json({ result: "done", ...(await runCron(db, m)) });
  }

  // ---- 1) appel du client ----
  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id || "";
  if (!uid) return json({ error: "Connexion requise." }, 401);
  const resId = typeof body?.reservation_id === "string" ? body.reservation_id : "";
  const event = body?.event === "cancelled" ? "cancelled" : "new";
  if (!/^[0-9a-f-]{36}$/i.test(resId)) return json({ error: "Réservation invalide." }, 400);

  const { data: r0, error } = await db.from("customer_reservations").select("*").eq("id", resId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  const r = r0 as Res | null;
  if (!r || r.customer_id !== uid) return json({ error: "Réservation introuvable." }, 404);
  if (!key) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);

  const results: Record<string, string> = {};
  if (event === "new") {
    // une seule fois : réclamé avant l'envoi
    const { data: claim } = await db.from("customer_reservations").update({ notified_at: new Date().toISOString() })
      .eq("id", resId).is("notified_at", null).select("id");
    if (!claim || !claim.length) return json({ result: "skipped", reason: "déjà avisé" });
    const L = await linesOf(db, resId);
    try { await mailNew(m, r, L); results.client = "sent"; } catch (e) { results.client = "error: " + (e as Error).message; }
    try { await mailAdmin(m, r, L, "new"); results.admin = "sent"; } catch (e) { results.admin = "error: " + (e as Error).message; }
  } else {
    if (r.status !== "cancelled" || r.cancelled_by !== "client") return json({ result: "skipped", reason: "pas annulée par le client" });
    const { data: claim } = await db.from("customer_reservations").update({ closed_mailed_at: new Date().toISOString() })
      .eq("id", resId).is("closed_mailed_at", null).select("id");
    if (!claim || !claim.length) return json({ result: "skipped", reason: "déjà avisé" });
    try { await mailAdmin(m, r, await linesOf(db, resId), "cancelled"); results.admin = "sent"; } catch (e) { results.admin = "error: " + (e as Error).message; }
  }
  return json({ result: "done", ...results });
});
