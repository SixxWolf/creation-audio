// =========================================================
// Création Audio — Edge Function « dealer-order-notify »
// Avise Création Audio par courriel quand un dealer envoie, modifie ou
// annule une commande sur le portail (dealer.html). L'admin la voit aussi
// dans l'onglet Commandes (pastille) : le courriel n'est qu'un avis.
//
// Appel (dealer connecté, depuis dealer.js) : POST { order_id, event }
//   event = 'new' | 'updated' | 'cancelled'
// Réponse : { result: 'sent' | 'skipped', reason? } ou { error }
//
// Sécurité : le JWT du dealer est vérifié ; la commande doit lui appartenir.
// Anti-rafale : un courriel « new » par commande ; modification/annulation
// au plus une fois par 2 minutes (colonne dealer_orders.notified_at).
//
// Secrets (Supabase -> Edge Functions -> Secrets) :
//   RESEND_API_KEY    clé API Resend (domaine creationaudio.ca vérifié) — la même que waitlist-notify
//   MAIL_FROM         optionnel, défaut « Création Audio <avis@creationaudio.ca> »
//   ORDER_NOTIFY_TO   optionnel, défaut « contact@creationaudio.ca »
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://creationaudio.ca";

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

type Line = { name: string; qty: number; unit_price: number; line_total: number; product_id: string | null };

const EVENT_LABEL: Record<string, string> = {
  new: "Nouvelle commande dealer",
  updated: "Commande dealer modifiée",
  cancelled: "Commande dealer annulée",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>";
  const to = Deno.env.get("ORDER_NOTIFY_TO") || "contact@creationaudio.ca";

  // 1) qui appelle ?
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  const email = (u?.user?.email || "").toLowerCase();
  if (!email) return json({ error: "Connexion requise." }, 401);

  let orderId = "", event = "new";
  try {
    const body = await req.json();
    orderId = typeof body?.order_id === "string" ? body.order_id : "";
    event = ["new", "updated", "cancelled"].includes(body?.event) ? body.event : "new";
  } catch { /* corps invalide */ }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Commande invalide." }, 400);

  // 2) la commande doit appartenir au dealer connecté
  const db = createClient(url, service);
  const { data: order, error } = await db.from("dealer_orders").select("*").eq("id", orderId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!order || String(order.dealer_email || "").toLowerCase() !== email) return json({ error: "Commande introuvable." }, 404);

  // 3) anti-rafale
  const last = order.notified_at ? Date.parse(order.notified_at) : 0;
  if (event === "new" && last) return json({ result: "skipped", reason: "déjà avisé" });
  if (event !== "new" && last && Date.now() - last < 2 * 60 * 1000) return json({ result: "skipped", reason: "avis récent" });

  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant dans Supabase." }, 503);

  const { data: lines } = await db.from("dealer_order_lines")
    .select("name, qty, unit_price, line_total, product_id").eq("order_id", orderId).order("sort_order");
  const L = (lines || []) as Line[];
  const pids = L.map((l) => l.product_id).filter(Boolean) as string[];
  const { data: prods } = pids.length
    ? await db.from("products").select("id, qty").in("id", pids)
    : { data: [] as { id: string; qty: number }[] };
  const stock = new Map((prods || []).map((p) => [p.id, Number(p.qty) || 0]));

  const who = order.dealer_name || order.dealer_email;
  const pairs = L.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const label = EVENT_LABEL[event];
  const subject = label + " " + order.number + " — " + who + (event === "cancelled" ? "" : " (" + pairs + " paire" + (pairs > 1 ? "s" : "") + ")");
  const adminUrl = SITE + "/coulisses-t6avzpe2.html#commandes";

  const rowsTxt = L.map((l) => {
    const st = l.product_id ? (stock.get(l.product_id) ?? 0) : 0;
    const toPrint = Math.max(0, l.qty - st);
    return "- " + l.name + " × " + l.qty + " @ " + money(l.unit_price) + " = " + money(l.line_total) +
      (toPrint ? "  (à imprimer : " + toPrint + ")" : "");
  }).join("\n");
  const text =
    label + " " + order.number + "\n" +
    "Dealer : " + who + "\n\n" +
    (event === "cancelled" ? "Le dealer a annulé cette commande.\n\n" : "") +
    rowsTxt + "\n\nTotal dealer : " + money(order.total) + " (hors taxes)\n" +
    (order.note ? "\nNote du dealer : " + order.note + "\n" : "") +
    "\nOuvrir dans l'admin : " + adminUrl + "\n";

  const rowsHtml = L.map((l) => {
    const st = l.product_id ? (stock.get(l.product_id) ?? 0) : 0;
    const toPrint = Math.max(0, l.qty - st);
    return '<tr>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;font-weight:700">' + esc(l.name) + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + esc(l.qty) + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right;color:' + (toPrint ? '#B23F12' : '#16794A') + '">' +
        (toPrint ? toPrint + " à imprimer" : "en stock") + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #E7E7E2;text-align:right">' + money(l.line_total) + '</td>' +
    '</tr>';
  }).join("");
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#181A1F;line-height:1.5">' +
    '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Portail dealer</p>' +
    '<h1 style="font-size:22px;margin:0 0 6px">' + esc(label) + ' ' + esc(order.number) + '</h1>' +
    '<p style="margin:0 0 16px;color:#3A3D45">' + esc(who) + '</p>' +
    (event === "cancelled" ? '<p style="padding:10px 12px;background:#FDECEA;border-radius:10px;color:#B42A19;font-weight:700">Le dealer a annulé cette commande.</p>' : "") +
    '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
      '<tr style="background:#F4F3EF"><th style="padding:8px 10px;text-align:left">Spacer</th><th style="padding:8px 10px;text-align:right">Qté</th>' +
      '<th style="padding:8px 10px;text-align:right">Stock</th><th style="padding:8px 10px;text-align:right">Total</th></tr>' +
      rowsHtml +
    '</table>' +
    '<p style="margin:14px 0 0;text-align:right;font-size:16px"><strong>Total dealer : ' + money(order.total) + '</strong> <span style="color:#6C727C;font-size:13px">(hors taxes)</span></p>' +
    (order.note ? '<p style="margin:16px 0 0;padding:10px 12px;background:#F4F3EF;border-radius:10px"><strong>Note :</strong> ' + esc(order.note) + '</p>' : "") +
    '<p style="margin:22px 0"><a href="' + adminUrl + '" style="background:#FF6A2B;color:#181A1F;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">Ouvrir dans l\'admin</a></p>' +
    "</div>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], reply_to: order.dealer_email, subject, html, text }),
  });
  if (!res.ok) {
    const t = await res.text();
    return json({ error: "Resend " + res.status + " : " + t.slice(0, 200) }, 502);
  }
  await db.from("dealer_orders").update({ notified_at: new Date().toISOString() }).eq("id", orderId);
  return json({ result: "sent" });
});
