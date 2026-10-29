// =========================================================
// Création Audio — Edge Function « customer-order-notify » (commandes en ligne)
// Après l'envoi / la modification / l'annulation d'une commande par un client
// connecté (boutique ou page spacers, assets/commande-client.js) :
//  - au CLIENT (new / updated) : confirmation automatique. Tout en stock -> la plage de
//    cueillette choisie (pickup_date/start/end ; sans plage : lien vers #/cueillette/c/<id>) ;
//    sinon la liste des articles à commander et l'annonce d'un délai.
//  - à Création Audio (toujours) : avis avec lignes, stock et lien vers l'admin.
//  - « ready » (admin › Commandes › « Marquer prête ») : au CLIENT seulement, « ta commande est
//    prête » + sa plage de cueillette (ou le lien pour la choisir). Une seule fois (ready_notified_at).
// Bobines vides (accessoire visé par materials.empty_spool_id) : nos propres impressions, pas de
// fournisseur -> « N à compléter · sans garantie » au lieu du délai fournisseur.
// Appel : POST { order_id, event: 'new' | 'updated' | 'cancelled' | 'ready' } avec le JWT du client
// (ready : JWT de l'admin, double authentification aal2).
// Sécurité : JWT vérifié ; la commande doit appartenir au client (customer_id = son id).
// Anti-rafale : « new » une seule fois ; modification / annulation au plus 1 fois / 2 min.
// Adresses de test Resend (…@resend.dev) : l'avis admin part aussi vers le puits de test.
// Secrets : RESEND_API_KEY ; MAIL_FROM et ORDER_NOTIFY_TO optionnels.
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

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
// en = client de la version anglaise (customers.lang) : « $1,049.70 »
function money(n: unknown, en = false) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  if (en) return "$" + v.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toFixed(2).replace(".", ",") + " $";
}
function plural(n: number, one: string, many: string) { return n + " " + (n > 1 ? many : one); }
// plage de cueillette -> « jeudi 23 octobre, 13 h – 17 h » (mêmes mots que commande-client.js)
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
function fmtPickup(d: unknown, s: unknown, e: unknown, en = false) {
  if (!d) return "";
  const p = String(d).split("-").map(Number), x = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  if (en) return x.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) +
    (s ? ", " + hTxtEn(s) + (e ? " – " + hTxtEn(e) : "") : "");
  return JOURS[x.getUTCDay()] + " " + x.getUTCDate() + " " + MOIS[x.getUTCMonth()] + (s ? ", " + hTxt(s) + (e ? " – " + hTxt(e) : "") : "");
}

type Line = { name: string; meta: string | null; qty: number; unit_price: number; line_total: number; qty_to_order: number; product_id: string | null; kind: string | null; ptype: string | null };

// filaments / accessoires à commander chez le fournisseur : délai annoncé (les spacers, imprimés ici, gardent « on te confirme »)
const BO_DELAY = "3 à 14 jours ouvrables";
let emptyIds = new Set<string>();   // bobines vides (rempli par requête)
const isEmpty = (l: Line) => !!l.product_id && emptyIds.has(l.product_id);
const BO_DELAY_EN = "3 to 14 business days";
const boLabel = (l: Line, n: number, en = false) => en
  ? (isEmpty(l) ? n + " to make · not guaranteed" : n + " to order" + (l.ptype === "spacer" ? "" : " · " + BO_DELAY_EN))
  : isEmpty(l) ? n + " à compléter · sans garantie"
  : n + " à commander" + (l.ptype === "spacer" ? "" : " · " + BO_DELAY);
const EMPTY_TXT = "Bobines vides : elles viennent de nos propres impressions, on ne peut pas en commander chez un fournisseur. " +
  "On fera tout notre possible pour compléter ta commande, sans garantie de quantité ni de délai.";
const EMPTY_TXT_EN = "Empty spools: they come from our own prints, we can't order them from a supplier. " +
  "We'll do our best to complete your order, with no guarantee on quantity or lead time.";
// langue des courriels au client : customers.lang (posée par la page utilisée, RPC me_set_lang)
// deno-lint-ignore no-explicit-any
async function clientEn(db: any, customerId: string | null) {
  if (!customerId) return false;
  const { data } = await db.from("customers").select("lang").eq("id", customerId).maybeSingle();
  return data?.lang === "en";
}

const ADMIN_LABEL: Record<string, string> = {
  new: "Nouvelle commande en ligne",
  updated: "Commande en ligne modifiée",
  cancelled: "Commande en ligne annulée par le client",
};

async function send(key: string, from: string, msg: Record<string, unknown>) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, ...msg }),
  });
  if (!res.ok) throw new Error("Resend " + res.status + " : " + (await res.text()).slice(0, 200));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>";
  let adminTo = Deno.env.get("ORDER_NOTIFY_TO") || "contact@creationaudio.ca";

  // 0) tick pg_cron (reservations_tick, aux 10 min) : rappel « choisis ta cueillette » et avis d'annulation automatique
  if (req.headers.get("x-cron-key")) {
    const body = await req.clone().json().catch(() => ({}));
    if (body?.cron === true) {
      const db0 = createClient(url, service);
      const { data: ok } = await db0.rpc("reservation_cron_ok", { p_key: req.headers.get("x-cron-key") || "" });
      if (ok !== true) return json({ error: "Clé invalide." }, 401);
      if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);
      return json({ result: "done", ...(await runCron(db0, resendKey, from)) });
    }
  }

  // 1) qui appelle ?
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id || "";
  if (!uid) return json({ error: "Connexion requise." }, 401);

  let orderId = "", event = "new";
  try {
    const body = await req.json();
    orderId = typeof body?.order_id === "string" ? body.order_id : "";
    event = ["new", "updated", "cancelled", "ready"].includes(body?.event) ? body.event : "new";
  } catch { /* corps invalide */ }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Commande invalide." }, 400);
  // « prête » : seul l'admin (double authentification, comme is_admin() en base)
  if (event === "ready") {
    if ((u?.user?.email || "").toLowerCase() !== ADMIN_EMAIL) return json({ error: "Réservé à l'administrateur." }, 403);
    if (jwtClaim(authHeader, "aal") !== "aal2") return json({ error: "Double authentification requise." }, 403);
  }

  // 2) la commande doit appartenir au client connecté (ready : n'importe quelle commande, admin)
  const db = createClient(url, service);
  const { data: order, error } = await db.from("customer_orders").select("*").eq("id", orderId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!order || (event !== "ready" && order.customer_id !== uid)) return json({ error: "Commande introuvable." }, 404);
  if (event === "ready") return await notifyReady(db, order, resendKey, from);

  // 3) anti-rafale
  const last = order.notified_at ? Date.parse(order.notified_at) : 0;
  if (event === "new" && last) return json({ result: "skipped", reason: "déjà avisé" });
  if (event !== "new" && last && Date.now() - last < 2 * 60 * 1000) return json({ result: "skipped", reason: "avis récent" });

  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);
  if (/@resend\.dev$/i.test(order.email || "")) adminTo = "delivered@resend.dev";   // tests

  const { data: lines } = await db.from("customer_order_lines")
    .select("name, meta, qty, unit_price, line_total, qty_to_order, product_id, kind, ptype").eq("order_id", orderId).order("sort_order");
  const L = (lines || []) as Line[];
  await loadEmptyIds(db, L);
  const items = L.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const toOrder = L.filter((l) => (Number(l.qty_to_order) || 0) > 0);
  const first = String(order.name || "").trim().split(/\s+/)[0] || "";
  const adminUrl = SITE + "/coulisses-t6avzpe2.html#commandes/clients";
  const results: Record<string, string> = {};
  const pk = fmtPickup(order.pickup_date, order.pickup_start, order.pickup_end);

  // ---- courriel au client (envoi et modification), dans sa langue ----
  if (event !== "cancelled") {
    const en = await clientEn(db, order.customer_id);
    const T = (fr: string, e: string) => (en ? e : fr);
    const m = (n: unknown) => money(n, en);
    const site = SITE + (en ? "/en" : "");
    const accUrl = site + "/compte.html#/commandes", pkUrl = site + "/compte.html#/cueillette/c/" + order.id;
    const pkC = fmtPickup(order.pickup_date, order.pickup_start, order.pickup_end, en);
    const verb = event === "updated" ? T("modifiée", "updated") : T("reçue", "received");
    const subject = T("Commande ", "Order ") + order.number + " " + verb + " — Création Audio";
    const supplierBo = toOrder.some((l) => l.ptype !== "spacer" && !isEmpty(l));
    const emptyBo = toOrder.some(isEmpty);
    const printBo = toOrder.some((l) => l.ptype === "spacer");
    const status = !toOrder.length
      ? (pkC ? T("Tout est en stock : on t'attend " + pkC + ".", "Everything is in stock: see you " + pkC + ".")
             : T("Tout est en stock et gardé pour toi : choisis ton jour et ton heure de cueillette dans ton compte dans les 24 h, sinon la commande sera annulée.", "Everything is in stock and held for you: choose your pickup day and time in your account within 24 hours, or the order will be cancelled."))
      : [supplierBo
        ? T("Certains articles ne sont pas en stock : on les commande chez notre fournisseur. Prévois un délai de " + BO_DELAY +
            " avant la cueillette ; on t'écrit dès leur arrivée pour que tu choisisses ta plage de cueillette.",
            "Some items are not in stock: we order them from our supplier. Allow " + BO_DELAY_EN +
            " before pickup; we'll email you when they arrive so you can choose your pickup time slot.")
        : printBo ? T("Certains articles doivent être imprimés : il y aura donc un délai. On te contacte sous peu pour te le confirmer.",
                      "Some items need to be printed, so there will be a lead time. We'll contact you shortly to confirm it.") : "",
        emptyBo ? T(EMPTY_TXT, EMPTY_TXT_EN) : ""].filter(Boolean).join(" ");
    const pickupLine = T("Cueillette à Québec · aucun paiement en ligne : tu paies à la cueillette.",
                         "Pickup in Québec City (or shipping on request) · no online payment: you pay at pickup.");
    const toOrderTxt = toOrder.map((l) => "- " + l.name + (l.meta ? " (" + l.meta + ")" : "") + T(" : ", ": ") +
      boLabel(l, Number(l.qty_to_order), en)).join("\n");
    const link = toOrder.length || pkC ? accUrl : pkUrl;
    const text =
      T("Bonjour ", "Hello ") + first + ",\n\n" +
      T("Merci ! Ta commande " + order.number + " est bien " + verb + ".", "Thank you! Your order " + order.number + " has been " + verb + ".") + "\n\n" +
      status + "\n\n" +
      (toOrder.length ? T("Articles à commander :", "Items to order:") + "\n" + toOrderTxt + "\n\n" : "") +
      L.map((l) => "- " + l.name + (l.meta ? " (" + l.meta + ")" : "") + " × " + l.qty + " — " + m(l.line_total)).join("\n") +
      "\n\n" + T("Total estimé : ", "Estimated total: ") + m(order.total) + "\n" +
      pickupLine + "\n" +
      (order.note ? "\n" + T("Ta note : ", "Your note: ") + order.note + "\n" : "") +
      "\n" + T("Tu peux suivre, modifier ou annuler ta commande (tant qu'elle n'est pas confirmée) dans ton compte : ",
               "You can track, edit or cancel your order (until it is confirmed) in your account: ") + link + "\n\n" +
      "Création Audio\n" + site + "/";
    const rowsHtml = L.map((l) => {
      const bo = Number(l.qty_to_order) || 0;
      return '<tr>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2"><strong>' + esc(l.name) + '</strong>' +
          (l.meta ? '<br><span style="color:#6C727C;font-size:12px">' + esc(l.meta) + '</span>' : '') +
          (bo ? '<br><span style="color:#B23F12;font-size:12px;font-weight:700">' + esc(boLabel(l, bo, en)) + '</span>' : '') + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + esc(l.qty) + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + m(l.line_total) + '</td>' +
      '</tr>';
    }).join("");
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
      '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Création Audio</p>' +
      '<h1 style="font-size:22px;margin:0 0 10px">' + T("Commande ", "Order ") + esc(order.number) + ' ' + verb + '</h1>' +
      '<p style="margin:0 0 14px">' + T("Bonjour " + esc(first) + ", merci&nbsp;!", "Hello " + esc(first) + ", thank you!") + '</p>' +
      '<p style="margin:0 0 16px;padding:12px 14px;border-radius:10px;' +
        (toOrder.length ? 'background:#FFF3EC;color:#9A4A0E' : 'background:#E7F6EE;color:#16794A') + ';font-weight:700">' + esc(status) + '</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
        '<tr style="background:#F4F3EF"><th style="padding:8px 10px;text-align:left">' + T("Article", "Item") + '</th><th style="padding:8px 10px;text-align:right">' + T("Qté", "Qty") + '</th>' +
        '<th style="padding:8px 10px;text-align:right">Total</th></tr>' + rowsHtml +
      '</table>' +
      '<p style="margin:14px 0 0;text-align:right;font-size:16px"><strong>' + T("Total estimé : ", "Estimated total: ") + m(order.total) + '</strong></p>' +
      '<p style="margin:6px 0 0;text-align:right;color:#6C727C;font-size:13px">' + esc(pickupLine) + '</p>' +
      (order.note ? '<p style="margin:16px 0 0;padding:10px 12px;background:#F4F3EF;border-radius:10px"><strong>' + T("Ta note :", "Your note:") + '</strong> ' + esc(order.note) + '</p>' : "") +
      '<p style="margin:22px 0"><a href="' + link + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">' +
        (toOrder.length || pkC ? T("Suivre ma commande", "Track my order") : T("Choisir ma plage de cueillette", "Choose my pickup time slot")) + '</a></p>' +
      '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
      '<p style="font-size:12px;color:#6C727C">' + T("Tu peux modifier ou annuler ta commande dans ton compte tant qu'elle n'est pas confirmée. Une question&nbsp;? Réponds simplement à ce courriel.",
        "You can edit or cancel your order in your account until it is confirmed. A question? Just reply to this email.") + '</p>' +
      "</div>";
    try {
      await send(resendKey, from, { to: [order.email], reply_to: REPLY_TO, subject, html, text });
      results.client = "sent";
    } catch (e) { results.client = "error: " + String((e as Error).message || e); }
  }

  // ---- avis à Création Audio ----
  const pids = L.map((l) => l.product_id).filter(Boolean) as string[];
  const { data: prods } = pids.length
    ? await db.from("products").select("id, qty, qty_2").in("id", pids)
    : { data: [] as { id: string; qty: number; qty_2: number }[] };
  const stockOf = new Map((prods || []).map((p) => [p.id, p]));
  const label = ADMIN_LABEL[event];
  const who = order.name || order.email;
  const aSubject = label + " " + order.number + " — " + who + (event === "cancelled" ? "" : " (" + plural(items, "article", "articles") +
    (toOrder.length ? ", " + toOrder.length + " à commander" : "") + ")");
  const aRows = L.map((l) => {
    const p = l.product_id ? stockOf.get(l.product_id) : null;
    const st = p ? (l.kind === "refill" ? Number(p.qty_2) || 0 : Number(p.qty) || 0) : 0;
    return { l, miss: Math.max(0, l.qty - st) };
  });
  const aText =
    label + " " + order.number + "\n" + who + " · " + order.email + (order.phone ? " · " + order.phone : "") + "\n\n" +
    aRows.map((r) => "- " + r.l.name + (r.l.meta ? " (" + r.l.meta + ")" : "") + " × " + r.l.qty + " — " + money(r.l.line_total) +
      (r.miss ? "  (" + (isEmpty(r.l) ? "à compléter" : "à commander") + " : " + r.miss + ")" : "  (en stock)")).join("\n") +
    "\n\nTotal : " + money(order.total) + "\n" + (pk ? "Cueillette : " + pk + "\n" : "") +
    (order.note ? "\nNote du client : " + order.note + "\n" : "") +
    "\nOuvrir dans l'admin : " + adminUrl + "\n";
  const aHtml =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
    '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Commande en ligne</p>' +
    '<h1 style="font-size:22px;margin:0 0 6px">' + esc(label) + ' ' + esc(order.number) + '</h1>' +
    '<p style="margin:0 0 16px;color:#3A3D45">' + esc(who) + ' · ' + esc(order.email) + (order.phone ? ' · ' + esc(order.phone) : '') + '</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
      '<tr style="background:#F4F3EF"><th style="padding:8px 10px;text-align:left">Article</th><th style="padding:8px 10px;text-align:right">Qté</th>' +
      '<th style="padding:8px 10px;text-align:right">Stock</th><th style="padding:8px 10px;text-align:right">Total</th></tr>' +
      aRows.map((r) => '<tr>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2"><strong>' + esc(r.l.name) + '</strong>' +
          (r.l.meta ? '<br><span style="color:#6C727C;font-size:12px">' + esc(r.l.meta) + '</span>' : '') + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + esc(r.l.qty) + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right;color:' + (r.miss ? '#B23F12' : '#16794A') + '">' +
          (r.miss ? r.miss + (isEmpty(r.l) ? ' à compléter' : ' à commander') : 'en stock') + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + money(r.l.line_total) + '</td></tr>').join("") +
    '</table>' +
    '<p style="margin:14px 0 0;text-align:right;font-size:16px"><strong>Total : ' + money(order.total) + '</strong></p>' +
    (pk ? '<p style="margin:16px 0 0;padding:10px 12px;background:#E7F6EE;color:#16794A;border-radius:10px"><strong>Cueillette :</strong> ' + esc(pk) + '</p>' : "") +
    (order.note ? '<p style="margin:16px 0 0;padding:10px 12px;background:#F4F3EF;border-radius:10px"><strong>Note :</strong> ' + esc(order.note) + '</p>' : "") +
    '<p style="margin:22px 0"><a href="' + adminUrl + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">Ouvrir dans l\'admin</a></p>' +
    "</div>";
  try {
    await send(resendKey, from, { to: [adminTo], reply_to: order.email, subject: aSubject, html: aHtml, text: aText });
    results.admin = "sent";
  } catch (e) { results.admin = "error: " + String((e as Error).message || e); }

  await db.from("customer_orders").update({ notified_at: new Date().toISOString() }).eq("id", orderId);
  return json({ result: "done", ...results });
});

// bobines vides présentes dans ces lignes (accessoires visés par materials.empty_spool_id)
// deno-lint-ignore no-explicit-any
async function loadEmptyIds(db: any, L: Line[]) {
  const pids = L.map((l) => l.product_id).filter(Boolean) as string[];
  const { data } = pids.length
    ? await db.from("materials").select("empty_spool_id").in("empty_spool_id", pids)
    : { data: [] };
  emptyIds = new Set(((data || []) as { empty_spool_id: string }[]).map((m) => m.empty_spool_id));
}

// ---- « Ta commande est prête » (admin › Commandes › Marquer prête) : au client, une seule fois ----
// deno-lint-ignore no-explicit-any
async function notifyReady(db: any, order: any, resendKey: string | undefined, from: string) {
  if (order.status !== "ready") return json({ result: "skipped", reason: "pas prête" });
  if (order.ready_notified_at) return json({ result: "skipped", reason: "déjà avisé" });
  if (!order.email) return json({ result: "skipped", reason: "sans courriel" });
  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);

  const { data: lines } = await db.from("customer_order_lines")
    .select("name, meta, qty, unit_price, line_total, qty_to_order, product_id, kind, ptype").eq("order_id", order.id).order("sort_order");
  const L = (lines || []) as Line[];
  const en = await clientEn(db, order.customer_id);
  const T = (fr: string, e: string) => (en ? e : fr);
  const m = (n: unknown) => money(n, en);
  const site = SITE + (en ? "/en" : "");
  const first = String(order.name || "").trim().split(/\s+/)[0] || "";
  const accountUrl = site + "/compte.html#/cueillette/c/" + order.id;   // écran « Choisis ta cueillette »
  const pk = fmtPickup(order.pickup_date, order.pickup_start, order.pickup_end, en);
  const subject = T("Commande " + order.number + " prête", "Order " + order.number + " ready") + " — Création Audio";
  const status = pk
    ? T("On t'attend " + pk + ". Tu peux changer de plage dans ton compte.", "See you " + pk + ". You can change the time slot in your account.")
    : T("Choisis ta plage de cueillette dans ton compte.", "Choose your pickup time slot in your account.");
  const pickupLine = T("Cueillette à Québec · tu paies à la cueillette.", "Pickup in Québec City · you pay at pickup.");
  const text =
    T("Bonjour ", "Hello ") + first + ",\n\n" +
    T("Ta commande " + order.number + " est prête !", "Your order " + order.number + " is ready!") + "\n\n" + status + "\n\n" +
    L.map((l) => "- " + l.name + (l.meta ? " (" + l.meta + ")" : "") + " × " + l.qty + " — " + m(l.line_total)).join("\n") +
    "\n\nTotal" + T(" : ", ": ") + m(order.total) + "\n" +
    pickupLine + "\n\n" +
    (pk ? T("Mon compte : ", "My account: ") : T("Choisir ma plage de cueillette : ", "Choose my pickup time slot: ")) + accountUrl + "\n\n" +
    "Création Audio\n" + site + "/";
  const rowsHtml = L.map((l) => '<tr>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2"><strong>' + esc(l.name) + '</strong>' +
      (l.meta ? '<br><span style="color:#6C727C;font-size:12px">' + esc(l.meta) + '</span>' : '') + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + esc(l.qty) + '</td>' +
    '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + m(l.line_total) + '</td></tr>').join("");
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
    '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Création Audio</p>' +
    '<h1 style="font-size:22px;margin:0 0 10px">' + T("Ta commande " + esc(order.number) + " est prête", "Your order " + esc(order.number) + " is ready") + '</h1>' +
    '<p style="margin:0 0 14px">' + T("Bonjour ", "Hello ") + esc(first) + ',</p>' +
    '<p style="margin:0 0 16px;padding:12px 14px;border-radius:10px;background:#E7F6EE;color:#16794A;font-weight:700">' + esc(status) + '</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
      '<tr style="background:#F4F3EF"><th style="padding:8px 10px;text-align:left">' + T("Article", "Item") + '</th><th style="padding:8px 10px;text-align:right">' + T("Qté", "Qty") + '</th>' +
      '<th style="padding:8px 10px;text-align:right">Total</th></tr>' + rowsHtml +
    '</table>' +
    '<p style="margin:14px 0 0;text-align:right;font-size:16px"><strong>Total' + T(" : ", ": ") + m(order.total) + '</strong></p>' +
    '<p style="margin:6px 0 0;text-align:right;color:#6C727C;font-size:13px">' + esc(pickupLine) + '</p>' +
    '<p style="margin:22px 0"><a href="' + accountUrl + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">' +
      (pk ? T("Voir ma commande", "See my order") : T("Choisir ma plage de cueillette", "Choose my pickup time slot")) + '</a></p>' +
    '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
    '<p style="font-size:12px;color:#6C727C">' + T("Une question&nbsp;? Réponds simplement à ce courriel.", "A question? Just reply to this email.") + '</p>' +
    "</div>";
  try {
    await send(resendKey, from, { to: [order.email], reply_to: REPLY_TO, subject, html, text });
  } catch (e) { return json({ error: String((e as Error).message || e) }, 502); }
  await db.from("customer_orders").update({ ready_notified_at: new Date().toISOString() }).eq("id", order.id);
  return json({ result: "done", sent: true });
}

// ---- tick : commandes sans cueillette choisie (24 h) ----
// rappel ~6 h avant l'échéance (pickup_reminded_at) ; avis d'annulation automatique (auto_mailed_at)
// deno-lint-ignore no-explicit-any
async function runCron(db: any, resendKey: string, from: string) {
  const iso = new Date().toISOString();
  const out = { reminded: 0, cancelled: 0, hourly: 0 };
  const mail = async (o: { email: string; number: string; name: string; id: string; customer_id: string | null; pickup_due: string | null }, cancelled: boolean) => {
    const en = await clientEn(db, o.customer_id);
    const T = (fr: string, e: string) => (en ? e : fr);
    const first = String(o.name || "").trim().split(/\s+/)[0] || "";
    const url = SITE + (en ? "/en" : "") + "/compte.html#/cueillette/c/" + o.id;
    const head = cancelled
      ? T("Commande " + o.number + " annulée", "Order " + o.number + " cancelled")
      : T("Choisis ta cueillette — commande " + o.number, "Choose your pickup — order " + o.number);
    const msg = cancelled
      ? T("Sans jour ni heure de cueillette choisis dans les 24 h, ta commande a été annulée et le stock est remis en vente. Tu peux recommander quand tu veux.",
          "Since no pickup day and time was chosen within 24 hours, your order was cancelled and the stock is back on sale. You can reorder any time.")
      : T("Ton stock est gardé, mais il nous faut un jour et une heure de cueillette. Sans ça, ta commande sera annulée bientôt.",
          "Your stock is on hold, but we need a pickup day and time. Without it, your order will be cancelled soon.");
    const label = cancelled ? T("Voir mes commandes", "See my orders") : T("Choisir ma cueillette", "Choose my pickup");
    const link = cancelled ? SITE + (en ? "/en" : "") + "/compte.html#/commandes" : url;
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
      '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Création Audio</p>' +
      '<h1 style="font-size:22px;margin:0 0 10px">' + esc(head) + '</h1>' +
      '<p style="margin:0 0 14px">' + T("Bonjour ", "Hello ") + esc(first) + ',</p><p style="margin:0 0 16px">' + esc(msg) + '</p>' +
      '<p style="margin:22px 0"><a href="' + link + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">' + esc(label) + '</a></p></div>';
    const text = T("Bonjour ", "Hello ") + first + ",\n\n" + msg + "\n\n" + link + "\n\nCréation Audio\n" + SITE + (en ? "/en/" : "/");
    await send(resendKey, from, { to: [o.email], reply_to: REPLY_TO, subject: head + " — Création Audio", html, text });
  };
  const soon = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const { data: rem } = await db.from("customer_orders").update({ pickup_reminded_at: iso })
    .eq("status", "new").is("pickup_date", null).is("pickup_reminded_at", null).not("pickup_due", "is", null).lte("pickup_due", soon).gt("pickup_due", iso).select("*");
  for (const o of rem || []) { try { await mail(o, false); out.reminded++; } catch { /* réessayé jamais : marqué */ } }
  const twoDays = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
  const { data: can } = await db.from("customer_orders").update({ auto_mailed_at: iso })
    .eq("status", "cancelled").eq("cancelled_by", "auto").is("auto_mailed_at", null).gt("updated_at", twoDays).select("*");
  for (const o of can || []) { try { await mail(o, true); out.cancelled++; } catch { /* idem */ } }
  // rappel « ta cueillette est dans 1 h » (par plage : si le client change d'heure, un nouveau rappel part)
  const nowMs = Date.now();
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const { data: soonPk } = await db.from("customer_orders").select("*")
    .in("status", ["new", "preparing", "ready"]).not("pickup_date", "is", null).not("pickup_start", "is", null)
    .gte("pickup_date", day(nowMs - 86400000)).lte("pickup_date", day(nowMs + 86400000));
  for (const o of soonPk || []) {
    const startMs = torontoMs(o.pickup_date, o.pickup_start);
    if (startMs < nowMs || startMs - nowMs > 3600000) continue;
    const startIso = new Date(startMs).toISOString();
    const { data: claim } = await db.from("customer_orders").update({ pickup_hour_reminded_for: startIso })
      .eq("id", o.id).or("pickup_hour_reminded_for.is.null,pickup_hour_reminded_for.neq." + startIso).select("id");
    if (!claim?.length) continue;
    try { await mailHour(db, resendKey, from, o); out.hourly++; } catch { /* marqué : pas de réessai */ }
  }
  return out;
}

// début de plage (date + heure locales du Québec) -> millisecondes UTC
function torontoMs(d: string, t: string) {
  const [y, mo, da] = String(d).split("-").map(Number), [h, mi] = String(t).split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi || 0);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return guess - (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - guess);
}

// deno-lint-ignore no-explicit-any
async function mailHour(db: any, resendKey: string, from: string, o: any) {
  const en = await clientEn(db, o.customer_id);
  const T = (fr: string, e: string) => (en ? e : fr);
  const first = String(o.name || "").trim().split(/\s+/)[0] || "";
  const when = fmtPickup(o.pickup_date, o.pickup_start, o.pickup_end, en);
  const link = SITE + (en ? "/en" : "") + "/compte.html#/cueillette/c/" + o.id;
  const head = T("Ta cueillette est dans environ 1 h — commande " + o.number, "Your pickup is in about 1 hour — order " + o.number);
  const msg = T("Petit rappel : ta commande " + o.number + " t'attend, cueillette prévue " + when + ".",
    "Friendly reminder: your order " + o.number + " is waiting for you, pickup scheduled " + when + ".");
  const alt = T("Un empêchement ? Réponds à ce courriel ou change ta cueillette dans ton compte.",
    "Can't make it? Reply to this email or change your pickup in your account.");
  const label = T("Voir ma commande", "See my order");
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
    '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Création Audio</p>' +
    '<h1 style="font-size:22px;margin:0 0 10px">' + esc(head) + '</h1>' +
    '<p style="margin:0 0 14px">' + T("Bonjour ", "Hello ") + esc(first) + ',</p><p style="margin:0 0 16px">' + esc(msg) + '</p>' +
    '<p style="margin:0 0 16px;color:#6C727C;font-size:13px">' + esc(alt) + '</p>' +
    '<p style="margin:22px 0"><a href="' + link + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">' + esc(label) + '</a></p></div>';
  const text = T("Bonjour ", "Hello ") + first + ",\n\n" + msg + "\n" + alt + "\n\n" + link + "\n\nCréation Audio\n" + SITE + (en ? "/en/" : "/");
  await send(resendKey, from, { to: [o.email], reply_to: REPLY_TO, subject: head + " — Création Audio", html, text });
}
