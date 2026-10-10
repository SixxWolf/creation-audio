// =========================================================
// Création Audio — Edge Function « customer-order-notify » (commandes en ligne)
// Après l'envoi / la modification / l'annulation d'une commande par un client
// connecté (boutique ou page spacers, assets/commande-client.js) :
//  - au CLIENT (new / updated) : confirmation automatique. Tout en stock -> « on te
//    contacte sous peu pour la cueillette » ; sinon la liste des articles à commander
//    et l'annonce d'un délai.
//  - à Création Audio (toujours) : avis avec lignes, stock et lien vers l'admin.
// Appel : POST { order_id, event: 'new' | 'updated' | 'cancelled' } avec le JWT du client.
// Sécurité : JWT vérifié ; la commande doit appartenir au client (customer_id = son id).
// Anti-rafale : « new » une seule fois ; modification / annulation au plus 1 fois / 2 min.
// Adresses de test Resend (…@resend.dev) : l'avis admin part aussi vers le puits de test.
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
function money(n: unknown) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",") + " $";
}
function plural(n: number, one: string, many: string) { return n + " " + (n > 1 ? many : one); }

type Line = { name: string; meta: string | null; qty: number; unit_price: number; line_total: number; qty_to_order: number; product_id: string | null; kind: string | null; ptype: string | null };

// filaments / accessoires à commander chez le fournisseur : délai annoncé (les spacers, imprimés ici, gardent « on te confirme »)
const BO_DELAY = "3 à 7 jours ouvrables";
const boLabel = (l: Line, n: number) => n + " à commander" + (l.ptype === "spacer" ? "" : " · " + BO_DELAY);

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
    event = ["new", "updated", "cancelled"].includes(body?.event) ? body.event : "new";
  } catch { /* corps invalide */ }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Commande invalide." }, 400);

  // 2) la commande doit appartenir au client connecté
  const db = createClient(url, service);
  const { data: order, error } = await db.from("customer_orders").select("*").eq("id", orderId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!order || order.customer_id !== uid) return json({ error: "Commande introuvable." }, 404);

  // 3) anti-rafale
  const last = order.notified_at ? Date.parse(order.notified_at) : 0;
  if (event === "new" && last) return json({ result: "skipped", reason: "déjà avisé" });
  if (event !== "new" && last && Date.now() - last < 2 * 60 * 1000) return json({ result: "skipped", reason: "avis récent" });

  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant." }, 503);
  if (/@resend\.dev$/i.test(order.email || "")) adminTo = "delivered@resend.dev";   // tests

  const { data: lines } = await db.from("customer_order_lines")
    .select("name, meta, qty, unit_price, line_total, qty_to_order, product_id, kind, ptype").eq("order_id", orderId).order("sort_order");
  const L = (lines || []) as Line[];
  const items = L.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const toOrder = L.filter((l) => (Number(l.qty_to_order) || 0) > 0);
  const first = String(order.name || "").trim().split(/\s+/)[0] || "";
  const accountUrl = SITE + "/compte.html#/commandes";
  const adminUrl = SITE + "/coulisses-t6avzpe2.html#commandes/clients";
  const results: Record<string, string> = {};

  // ---- courriel au client (envoi et modification) ----
  if (event !== "cancelled") {
    const verb = event === "updated" ? "modifiée" : "reçue";
    const subject = "Commande " + order.number + " " + verb + " — Création Audio";
    const supplierBo = toOrder.some((l) => l.ptype !== "spacer");
    const status = !toOrder.length
      ? "Tout est en stock : on te contacte sous peu pour convenir de la cueillette à Québec."
      : supplierBo
      ? "Certains articles ne sont pas en stock : on les commande chez notre fournisseur. Prévois un délai de " + BO_DELAY +
        " avant la cueillette ; on t'écrit dès leur arrivée."
      : "Certains articles doivent être imprimés : il y aura donc un délai. On te contacte sous peu pour te le confirmer.";
    const toOrderTxt = toOrder.map((l) => "- " + l.name + (l.meta ? " (" + l.meta + ")" : "") + " : " +
      boLabel(l, Number(l.qty_to_order))).join("\n");
    const text =
      "Bonjour " + first + ",\n\n" +
      "Merci ! Ta commande " + order.number + " est bien " + verb + ".\n\n" +
      status + "\n\n" +
      (toOrder.length ? "Articles à commander :\n" + toOrderTxt + "\n\n" : "") +
      L.map((l) => "- " + l.name + (l.meta ? " (" + l.meta + ")" : "") + " × " + l.qty + " — " + money(l.line_total)).join("\n") +
      "\n\nTotal estimé : " + money(order.total) + "\n" +
      "Cueillette à Québec · aucun paiement en ligne : tu paies à la cueillette.\n" +
      (order.note ? "\nTa note : " + order.note + "\n" : "") +
      "\nTu peux suivre, modifier ou annuler ta commande (tant qu'on ne l'a pas commencée) dans ton compte : " + accountUrl + "\n\n" +
      "Création Audio\n" + SITE;
    const rowsHtml = L.map((l) => {
      const bo = Number(l.qty_to_order) || 0;
      return '<tr>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2"><strong>' + esc(l.name) + '</strong>' +
          (l.meta ? '<br><span style="color:#6C727C;font-size:12px">' + esc(l.meta) + '</span>' : '') +
          (bo ? '<br><span style="color:#B23F12;font-size:12px;font-weight:700">' + esc(boLabel(l, bo)) + '</span>' : '') + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + esc(l.qty) + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + money(l.line_total) + '</td>' +
      '</tr>';
    }).join("");
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
      '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Création Audio</p>' +
      '<h1 style="font-size:22px;margin:0 0 10px">Commande ' + esc(order.number) + ' ' + verb + '</h1>' +
      '<p style="margin:0 0 14px">Bonjour ' + esc(first) + ', merci&nbsp;!</p>' +
      '<p style="margin:0 0 16px;padding:12px 14px;border-radius:10px;' +
        (toOrder.length ? 'background:#FFF3EC;color:#9A4A0E' : 'background:#E7F6EE;color:#16794A') + ';font-weight:700">' + esc(status) + '</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
        '<tr style="background:#F4F3EF"><th style="padding:8px 10px;text-align:left">Article</th><th style="padding:8px 10px;text-align:right">Qté</th>' +
        '<th style="padding:8px 10px;text-align:right">Total</th></tr>' + rowsHtml +
      '</table>' +
      '<p style="margin:14px 0 0;text-align:right;font-size:16px"><strong>Total estimé : ' + money(order.total) + '</strong></p>' +
      '<p style="margin:6px 0 0;text-align:right;color:#6C727C;font-size:13px">Cueillette à Québec · aucun paiement en ligne : tu paies à la cueillette.</p>' +
      (order.note ? '<p style="margin:16px 0 0;padding:10px 12px;background:#F4F3EF;border-radius:10px"><strong>Ta note :</strong> ' + esc(order.note) + '</p>' : "") +
      '<p style="margin:22px 0"><a href="' + accountUrl + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">Suivre ma commande</a></p>' +
      '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
      '<p style="font-size:12px;color:#6C727C">Tu peux modifier ou annuler ta commande dans ton compte tant qu\'on ne l\'a pas commencée. Une question&nbsp;? Réponds simplement à ce courriel.</p>' +
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
      (r.miss ? "  (à commander : " + r.miss + ")" : "  (en stock)")).join("\n") +
    "\n\nTotal : " + money(order.total) + "\n" + (order.note ? "\nNote du client : " + order.note + "\n" : "") +
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
          (r.miss ? r.miss + ' à commander' : 'en stock') + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + money(r.l.line_total) + '</td></tr>').join("") +
    '</table>' +
    '<p style="margin:14px 0 0;text-align:right;font-size:16px"><strong>Total : ' + money(order.total) + '</strong></p>' +
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
