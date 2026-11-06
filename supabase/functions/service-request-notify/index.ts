// =========================================================
// Création Audio — Edge Function « service-request-notify » (demandes de service)
// Appelée par la base seulement (pg_net, en-tête x-cron-key vérifié par reservation_cron_ok) :
//  - { event:"created", id }  -> confirmation au client (FR/EN) + avis à Création Audio
//  - { event:"quoted", id }   -> soumission au client (FR/EN)
//  - { event:"accepted"|"refused", id } -> avis à Création Audio
//  - { cron:true } (service_requests_tick) -> discussions non lues depuis 5 min, courriels manqués
// Chaque courriel est réclamé en base AVANT l'envoi (jamais deux fois) ; un échec remet la
// réclamation à null et compte un essai (notify_tries, 3 max) pour que le tick le reprenne.
// Secrets : RESEND_API_KEY ; MAIL_FROM et MESSAGE_NOTIFY_TO optionnels.
// =========================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://creationaudio.ca";
const REPLY_TO = "contact@creationaudio.ca";
const ADMIN_URL = SITE + "/coulisses-t6avzpe2.html#commandes/demandes/";
const DELAY_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 2 * 86400 * 1000;
const RETRY_MS = 3 * 60 * 1000;
const RETRY_AGE_MS = 86400 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
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

type Mailer = { key: string; from: string; adminTo: string };
// deno-lint-ignore no-explicit-any
type Req = Record<string, any>;
type Msg = { body: string; photos: string[]; files: { n: string }[]; created_at: string };

async function send(m: Mailer, msg: Record<string, unknown>) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + m.key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: m.from, ...msg }),
  });
  if (!res.ok) throw new Error("Resend " + res.status + " : " + (await res.text()).slice(0, 200));
}

const box = (inner: string) =>
  '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' + inner + "</div>";
const eyebrow = (t: string) =>
  '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">' + esc(t) + "</p>";
const button = (href: string, label: string) =>
  '<p style="margin:22px 0"><a href="' + esc(href) + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;' +
  'padding:12px 22px;border-radius:100px;display:inline-block">' + esc(label) + "</a></p>";
const panel = (inner: string) =>
  '<div style="margin:0 0 8px;padding:14px 16px;background:#F4F3EF;border-radius:12px">' + inner + "</div>";
const foot = (en: boolean) =>
  '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
  '<p style="font-size:12px;color:#6C727C"><a href="' + SITE + (en ? "/en/" : "") + '" style="color:#6C727C">creationaudio.ca</a></p>';

const accountUrl = (r: Req) => SITE + (r.lang === "en" ? "/en" : "") + "/compte.html#/demandes/" + r.id;
const first = (r: Req) => String(r.name || "").trim().split(/\s+/)[0] || "";
const kindFr = (r: Req) => r.kind === "maintenance" ? "Entretien d'imprimantes" : "Impression 3D";
const kindEn = (r: Req) => r.kind === "maintenance" ? "Printer maintenance" : "3D printing";
const money = (n: unknown, en: boolean) => {
  const s = Number(n).toFixed(2);
  return en ? "$" + s : s.replace(".", ",") + " $";
};
const day = (d: string, en: boolean) =>
  new Date(d + "T12:00:00Z").toLocaleDateString(en ? "en-CA" : "fr-CA", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

const SERVICE: Record<string, string> = { file: "Mon fichier", batch: "Une série", design: "À dessiner", proto: "Prototype" };
const MATERIAL: Record<string, string> = { any: "À conseiller", pla: "PLA", petg: "PETG", abs: "ABS", tpu: "TPU" };
const MACHINE: Record<string, string> = { a1: "Bambu Lab A1", xp: "Bambu Lab série X / P", snap: "Snapmaker U1" };

// Résumé de la demande pour l'admin : lignes libellé -> valeur
function detailLines(r: Req): [string, string][] {
  const d = r.details || {};
  const out: [string, string][] = [];
  if (r.kind === "maintenance") {
    const mach = d.machines || [];
    const list = Array.isArray(mach)
      ? mach.filter((m: { qty?: number }) => Number(m.qty) > 0).map((m: { qty: number; brand?: string; name?: string; price?: number | null }) =>
          m.qty + " × " + [m.brand, m.name].filter(Boolean).join(" ") + (m.price == null ? " (à évaluer)" : ""))
      : Object.keys(mach).filter((k) => Number(mach[k]) > 0).map((k) => mach[k] + " × " + (MACHINE[k] || k));
    if (list.length) out.push(["Machines", list.join(", ")]);
    if (d.city) out.push(["Ville", String(d.city)]);
    if (d.other) out.push(["Autres machines", String(d.other)]);
  } else {
    if (d.service) out.push(["Service", SERVICE[d.service] || String(d.service)]);
    if (d.material) out.push(["Matériau", MATERIAL[d.material] || String(d.material)]);
    if (d.color?.name) out.push(["Couleur", String(d.color.name)]);
    if (d.qty) out.push(["Quantité", String(d.qty)]);
    if (d.desc) out.push(["Description", String(d.desc)]);
    if (d.notes) out.push(["Détails du fichier", String(d.notes)]);
  }
  const files = Array.isArray(r.files) ? r.files : [];
  if (files.length) out.push(["Fichiers", files.map((f: { n: string }) => f.n).join(", ")]);
  return out;
}

async function mailCreatedClient(m: Mailer, r: Req) {
  const en = r.lang === "en", url = accountUrl(r), f = first(r);
  if (en) {
    const text = "Hello" + (f ? " " + f : "") + ",\n\nWe received your request " + r.number + " (" + kindEn(r) + ").\n" +
      "We'll get back to you as soon as possible.\n\nFollow your request: " + url + "\n\nCréation Audio\n" + SITE + "/en/";
    const html = box(eyebrow("Création Audio") +
      '<h1 style="font-size:22px;margin:0 0 10px">Request received · ' + esc(r.number) + "</h1>" +
      '<p style="margin:0 0 14px">Hello' + (f ? " " + esc(f) : "") + ", we received your <strong>" + esc(kindEn(r)) +
      "</strong> request. We'll get back to you as soon as possible.</p>" +
      button(url, "Follow my request") + foot(true));
    await send(m, { to: [r.email], reply_to: REPLY_TO, subject: "Request received — " + r.number, html, text });
    return;
  }
  const text = "Bonjour" + (f ? " " + f : "") + ",\n\nOn a bien reçu ta demande " + r.number + " (" + kindFr(r) + ").\n" +
    "On te revient dans les plus brefs délais.\n\nSuivre ma demande : " + url + "\n\nCréation Audio\n" + SITE;
  const html = box(eyebrow("Création Audio") +
    '<h1 style="font-size:22px;margin:0 0 10px">Demande reçue · ' + esc(r.number) + "</h1>" +
    '<p style="margin:0 0 14px">Bonjour' + (f ? " " + esc(f) : "") + ", on a bien reçu ta demande <strong>" + esc(kindFr(r)) +
    "</strong>. On te revient dans les plus brefs délais.</p>" +
    button(url, "Suivre ma demande") + foot(false));
  await send(m, { to: [r.email], reply_to: REPLY_TO, subject: "Demande reçue — " + r.number, html, text });
}

const adminTo = (m: Mailer, r: Req) => /@resend\.dev$/i.test(r.email || "") ? "delivered@resend.dev" : m.adminTo;

async function mailCreatedAdmin(m: Mailer, r: Req) {
  const lines = detailLines(r), url = ADMIN_URL + r.id, who = r.name || r.email;
  const text = "Nouvelle demande " + r.number + " (" + kindFr(r) + ")\n" + who + " · " + r.email + (r.phone ? " · " + r.phone : "") + "\n\n" +
    lines.map(([k, v]) => k + " : " + v).join("\n") + "\n\nOuvrir la fiche : " + url + "\n";
  const html = box(eyebrow("Demande · " + kindFr(r)) +
    '<h1 style="font-size:22px;margin:0 0 6px">' + esc(r.number) + " · " + esc(who) + "</h1>" +
    '<p style="margin:0 0 16px;color:#3A3D45">' + esc(r.email) + (r.phone ? " · " + esc(r.phone) : "") + "</p>" +
    panel(lines.map(([k, v]) => "<strong>" + esc(k) + "</strong>&nbsp;: " + nl2br(v)).join("<br>")) +
    button(url, "Ouvrir la fiche"));
  await send(m, { to: [adminTo(m, r)], reply_to: r.email, subject: "Nouvelle demande " + r.number + " — " + kindFr(r) + " — " + who, html, text });
}

async function mailQuote(m: Mailer, r: Req) {
  const en = r.lang === "en", url = accountUrl(r), f = first(r), monthly = r.kind === "maintenance";
  const price = money(r.quote_price, en), date = day(r.quote_date, en);
  if (en) {
    const pl = price + (monthly ? " per month" : ""), dl = (monthly ? "First visit on " : "Ready on ") + date;
    const text = "Hello" + (f ? " " + f : "") + ",\n\nHere is our quote for your request " + r.number + ":\n" + pl + "\n" + dl + "\n" +
      (r.quote_note ? "\n" + r.quote_note + "\n" : "") + "\nAccept or decline: " + url + "\n\nCréation Audio\n" + SITE + "/en/";
    const html = box(eyebrow("Création Audio · " + kindEn(r)) +
      '<h1 style="font-size:22px;margin:0 0 10px">Your quote · ' + esc(r.number) + "</h1>" +
      '<p style="margin:0 0 14px">Hello' + (f ? " " + esc(f) : "") + ", here is our quote.</p>" +
      panel("<strong>" + esc(pl) + "</strong><br>" + esc(dl) + (r.quote_note ? "<br><br>" + nl2br(r.quote_note) : "")) +
      button(url, "Accept or decline") + foot(true));
    await send(m, { to: [r.email], reply_to: REPLY_TO, subject: "Your quote — " + r.number, html, text });
    return;
  }
  const pl = price + (monthly ? " par mois" : ""), dl = (monthly ? "Première visite le " : "Prête le ") + date;
  const text = "Bonjour" + (f ? " " + f : "") + ",\n\nVoici notre soumission pour ta demande " + r.number + " :\n" + pl + "\n" + dl + "\n" +
    (r.quote_note ? "\n" + r.quote_note + "\n" : "") + "\nAccepter ou refuser : " + url + "\n\nCréation Audio\n" + SITE;
  const html = box(eyebrow("Création Audio · " + kindFr(r)) +
    '<h1 style="font-size:22px;margin:0 0 10px">Ta soumission · ' + esc(r.number) + "</h1>" +
    '<p style="margin:0 0 14px">Bonjour' + (f ? " " + esc(f) : "") + ", voici notre soumission.</p>" +
    panel("<strong>" + esc(pl) + "</strong><br>" + esc(dl) + (r.quote_note ? "<br><br>" + nl2br(r.quote_note) : "")) +
    button(url, "Accepter ou refuser") + foot(false));
  await send(m, { to: [r.email], reply_to: REPLY_TO, subject: "Ta soumission — " + r.number, html, text });
}

async function mailDecision(m: Mailer, r: Req, accepted: boolean) {
  const what = accepted ? "Soumission acceptée" : "Soumission refusée", url = ADMIN_URL + r.id, who = r.name || r.email;
  const text = what + " — " + r.number + " (" + kindFr(r) + ")\n" + who + " · " + r.email + "\n\nOuvrir la fiche : " + url + "\n";
  const html = box(eyebrow("Demande · " + kindFr(r)) +
    '<h1 style="font-size:22px;margin:0 0 6px">' + esc(what) + " · " + esc(r.number) + "</h1>" +
    '<p style="margin:0 0 16px;color:#3A3D45">' + esc(who) + " · " + esc(r.email) + "</p>" + button(url, "Ouvrir la fiche"));
  await send(m, { to: [adminTo(m, r)], reply_to: r.email, subject: what + " — " + r.number + " — " + who, html, text });
}

const msgText = (x: Msg, en = false) => {
  const b = String(x.body || "").trim();
  if (b) return b;
  return Array.isArray(x.files) && x.files.length ? "(" + (en ? "file" : "fichier") + ")" : "(photo)";
};

async function series(db: SupabaseClient, id: string, sender: string, since: string) {
  const { data } = await db.from("service_request_messages").select("body, photos, files, created_at")
    .eq("request_id", id).eq("sender", sender).gte("created_at", since).order("created_at");
  return (data || []) as Msg[];
}

async function mailThreadAdmin(db: SupabaseClient, m: Mailer, r: Req) {
  const list = await series(db, r.id, "client", r.admin_unread_since);
  if (!list.length) return;
  const url = ADMIN_URL + r.id, who = r.name || r.email;
  const text = "Nouveau message — " + r.number + "\n" + who + " · " + r.email + "\n\n" + list.map((x) => msgText(x)).join("\n\n") +
    "\n\nRépondre : " + url + "\n";
  const html = box(eyebrow("Demande " + r.number) + '<h1 style="font-size:22px;margin:0 0 6px">' + esc(who) + "</h1>" +
    '<p style="margin:0 0 16px;color:#3A3D45">' + esc(r.email) + "</p>" +
    list.map((x) => panel(nl2br(msgText(x)))).join("") + button(url, "Répondre"));
  await send(m, { to: [adminTo(m, r)], reply_to: r.email, subject: "Nouveau message — " + r.number + " — " + who, html, text });
}

async function mailThreadClient(db: SupabaseClient, m: Mailer, r: Req) {
  const list = await series(db, r.id, "admin", r.client_unread_since);
  if (!list.length) return;
  const en = r.lang === "en", url = accountUrl(r), f = first(r);
  const hello = (en ? "Hello" : "Bonjour") + (f ? " " + f : "");
  const lead = en ? "We wrote to you about your request " + r.number + ":" : "On t'a écrit à propos de ta demande " + r.number + " :";
  const cta = en ? "See and reply" : "Voir et répondre";
  const text = hello + ",\n\n" + lead + "\n\n" + list.map((x) => msgText(x, en)).join("\n\n") + "\n\n" + cta + " : " + url + "\n\nCréation Audio\n" + SITE;
  const html = box(eyebrow("Création Audio · " + r.number) +
    '<h1 style="font-size:22px;margin:0 0 10px">' + (en ? "New message" : "Nouveau message") + "</h1>" +
    '<p style="margin:0 0 14px">' + esc(hello) + ", " + esc(lead) + "</p>" +
    list.map((x) => panel(nl2br(msgText(x, en)))).join("") + button(url, cta) + foot(en));
  await send(m, { to: [r.email], reply_to: REPLY_TO, subject: (en ? "New message — " : "Nouveau message — ") + r.number, html, text });
}

// Réclamation : la colonne n'est prise qu'une fois ; en cas d'échec, relâchée et un essai compté
async function claim(db: SupabaseClient, id: string, col: string) {
  const { data } = await db.from("service_requests").update({ [col]: new Date().toISOString() })
    .eq("id", id).is(col, null).select("id");
  return !!(data && data.length);
}
async function attempt(db: SupabaseClient, r: Req, col: string, fn: () => Promise<void>, errors: string[]) {
  if (!(await claim(db, r.id, col))) return false;
  try { await fn(); return true; } catch (e) {
    errors.push(r.number + " " + col + " : " + (e as Error).message);
    await db.from("service_requests").update({ [col]: null, notify_tries: (r.notify_tries || 0) + 1 }).eq("id", r.id);
    return false;
  }
}

async function handleEvent(db: SupabaseClient, m: Mailer, event: string, id: string) {
  const { data: r } = await db.from("service_requests").select("*").eq("id", id).maybeSingle();
  if (!r) return { error: "Demande introuvable." };
  const errors: string[] = [];
  if (event === "created") {
    await attempt(db, r, "client_ack_at", () => mailCreatedClient(m, r), errors);
    await attempt(db, r, "admin_ack_at", () => mailCreatedAdmin(m, r), errors);
  } else if (event === "quoted") {
    await attempt(db, r, "quote_ack_at", () => mailQuote(m, r), errors);
  } else if (event === "accepted" || event === "refused") {
    try { await mailDecision(m, r, event === "accepted"); } catch (e) {
      errors.push(r.number + " : " + (e as Error).message);
      // l'avis manqué retombe sur la reprise des discussions non lues
      await db.from("service_requests").update({ admin_notified_at: null }).eq("id", r.id);
    }
  }
  return { errors };
}

async function runCron(db: SupabaseClient, m: Mailer) {
  const now = Date.now(), iso = new Date(now).toISOString();
  const due = new Date(now - DELAY_MS).toISOString(), oldest = new Date(now - MAX_AGE_MS).toISOString();
  const retry = new Date(now - RETRY_MS).toISOString(), retryOld = new Date(now - RETRY_AGE_MS).toISOString();
  const out = { admin: 0, client: 0, retried: 0, errors: [] as string[] };

  const { data: forAdmin } = await db.from("service_requests").update({ admin_notified_at: iso })
    .gt("admin_unread", 0).is("admin_notified_at", null).lte("admin_unread_since", due).gt("admin_unread_since", oldest).select("*");
  for (const r of (forAdmin || []) as Req[]) {
    try { await mailThreadAdmin(db, m, r); out.admin++; } catch (e) { out.errors.push(r.number + " : " + (e as Error).message); }
  }
  const { data: forClient } = await db.from("service_requests").update({ client_notified_at: iso })
    .gt("client_unread", 0).is("client_notified_at", null).lte("client_unread_since", due).gt("client_unread_since", oldest).select("*");
  for (const r of (forClient || []) as Req[]) {
    try { await mailThreadClient(db, m, r); out.client++; } catch (e) { out.errors.push(r.number + " : " + (e as Error).message); }
  }

  // Courriels de confirmation ou de soumission manqués
  const { data: missed } = await db.from("service_requests").select("*").lt("notify_tries", 3)
    .lte("created_at", retry).gt("created_at", retryOld).or("client_ack_at.is.null,admin_ack_at.is.null");
  for (const r of (missed || []) as Req[]) {
    if (!r.client_ack_at && await attempt(db, r, "client_ack_at", () => mailCreatedClient(m, r), out.errors)) out.retried++;
    if (!r.admin_ack_at && await attempt(db, r, "admin_ack_at", () => mailCreatedAdmin(m, r), out.errors)) out.retried++;
  }
  const { data: quotes } = await db.from("service_requests").select("*").lt("notify_tries", 3)
    .is("quote_ack_at", null).lte("quoted_at", retry).gt("quoted_at", retryOld);
  for (const r of (quotes || []) as Req[]) {
    if (await attempt(db, r, "quote_ack_at", () => mailQuote(m, r), out.errors)) out.retried++;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps invalide */ }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await db.rpc("reservation_cron_ok", { p_key: req.headers.get("x-cron-key") || "" });
  if (ok !== true) return json({ error: "Clé invalide." }, 401);
  const key = Deno.env.get("RESEND_API_KEY") || "";
  if (!key) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);
  const m: Mailer = {
    key,
    from: Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>",
    adminTo: Deno.env.get("MESSAGE_NOTIFY_TO") || "contact@creationaudio.ca",
  };
  if (body?.cron === true) return json({ result: "done", ...(await runCron(db, m)) });
  if (typeof body?.event === "string" && typeof body?.id === "string") {
    return json({ result: "done", ...(await handleEvent(db, m, body.event, body.id)) });
  }
  return json({ error: "Requête invalide." }, 400);
});
