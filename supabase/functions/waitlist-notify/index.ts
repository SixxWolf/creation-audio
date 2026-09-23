// =========================================================
// Création Audio — Edge Function « waitlist-notify »
// Envoie le courriel « ton produit est de retour » aux personnes
// inscrites sur la liste d'attente (source 'site'), puis marque la
// demande « avisée » et EFFACE le courriel (Loi 25 : l'adresse ne sert
// qu'à cet avis).
//
// Appel (admin seulement) : POST { ids: ["uuid", …] }
// Réponse : { results: [{ id, result: 'sent'|'skipped'|'error', error? }] }
//
// Secrets requis (Supabase -> Edge Functions -> Secrets) :
//   RESEND_API_KEY   clé API Resend (domaine creationaudio.ca vérifié)
//   MAIL_FROM        optionnel, défaut « Création Audio <avis@creationaudio.ca> »
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY sont fournis
// automatiquement par Supabase.
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = "creationaudio.ca@gmail.com";
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

function slugify(s: string | null | undefined) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
}
const KIND_LABEL: Record<string, string> = { spool: "avec bobine", refill: "recharge" };

type Product = { id: string; type: string; name: string; brand: string | null; material: string | null; slug: string | null };

function productUrl(p: Product, brandSlug: string | null, matSlug: string | null) {
  if (p.type === "spacer") return SITE + "/spacers.html";
  if (p.type !== "filament") return SITE + "/boutique.html";
  const b = brandSlug || slugify(p.brand || "Autres");
  const m = matSlug || slugify(p.material || "Autres");
  return SITE + "/boutique.html#/m/" + b + "/" + m + "/" + (p.slug || slugify(p.name));
}

function emailContent(p: Product, kind: string | null, url: string) {
  const what = [p.material, p.name].filter(Boolean).join(" ") + (kind && KIND_LABEL[kind] ? " (" + KIND_LABEL[kind] + ")" : "");
  const subject = "C'est arrivé : " + what + " est de retour en stock";
  const text =
    "Bonjour,\n\n" +
    "Bonne nouvelle : le " + what + " que tu attendais est de nouveau en stock chez Création Audio.\n\n" +
    "Voir le produit : " + url + "\n\n" +
    "Les quantités sont limitées. Pour le réserver, ajoute-le à ton panier sur le site (la commande se confirme par Messenger) " +
    "ou réponds simplement à ce courriel.\n\n" +
    "Merci et à bientôt !\nThéo — Création Audio\n\n" +
    "—\nTu reçois ce courriel une seule fois parce que tu as demandé à être avisé(e) du retour de ce produit sur creationaudio.ca. " +
    "Ton adresse a maintenant été supprimée de notre liste d'attente.";
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#181A1F;line-height:1.5">' +
    '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Création Audio</p>' +
    '<h1 style="font-size:22px;margin:0 0 14px">C\'est de retour en stock&nbsp;!</h1>' +
    "<p>Bonjour,</p>" +
    "<p>Bonne nouvelle&nbsp;: le <strong>" + esc(what) + "</strong> que tu attendais est de nouveau en stock.</p>" +
    '<p style="margin:22px 0"><a href="' + esc(url) + '" style="background:#FF6A2B;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px;display:inline-block">Voir le produit</a></p>' +
    "<p>Les quantités sont limitées. Pour le réserver, ajoute-le à ton panier sur le site (la commande se confirme par Messenger) ou réponds simplement à ce courriel.</p>" +
    "<p>Merci et à bientôt&nbsp;!<br>Théo — Création Audio</p>" +
    '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
    '<p style="font-size:12px;color:#6C727C">Tu reçois ce courriel une seule fois parce que tu as demandé à être avisé(e) du retour de ce produit sur ' +
    '<a href="' + SITE + '" style="color:#6C727C">creationaudio.ca</a>. Ton adresse a maintenant été supprimée de notre liste d\'attente.</p>' +
    "</div>";
  return { subject, text, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non permise." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>";

  // 1) seul l'admin peut déclencher un envoi
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user || (u.user.email || "").toLowerCase() !== ADMIN_EMAIL) return json({ error: "Réservé à l'administrateur." }, 403);

  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant dans Supabase." }, 503);

  let ids: string[] = [];
  try { ids = ((await req.json())?.ids || []).filter((x: unknown) => typeof x === "string").slice(0, 50); } catch { /* corps invalide */ }
  if (!ids.length) return json({ error: "Aucune demande à aviser." }, 400);

  const db = createClient(url, service);
  const { data: rows, error } = await db.from("waitlist")
    .select("id, product_id, kind, contact, source, status").in("id", ids);
  if (error) return json({ error: error.message }, 500);

  const pids = [...new Set((rows || []).map((r) => r.product_id))];
  const { data: prods } = await db.from("products").select("id, type, name, brand, material, slug").in("id", pids.length ? pids : ["00000000-0000-0000-0000-000000000000"]);
  const { data: brands } = await db.from("brands").select("name, slug");
  const { data: mats } = await db.from("materials").select("brand, name, slug");
  const prodById = new Map((prods || []).map((p) => [p.id, p as Product]));
  const brandSlug = new Map((brands || []).map((b) => [b.name, b.slug]));
  const matSlug = new Map((mats || []).map((m) => [m.brand + "|" + m.name, m.slug]));

  const results: { id: string; result: string; error?: string }[] = [];
  for (const id of ids) {
    const r = (rows || []).find((x) => x.id === id);
    if (!r || r.status !== "open" || r.source !== "site" || !r.contact) { results.push({ id, result: "skipped" }); continue; }
    const p = prodById.get(r.product_id);
    if (!p) { results.push({ id, result: "error", error: "Produit introuvable." }); continue; }
    const link = productUrl(p, brandSlug.get(p.brand || "") ?? null, matSlug.get((p.brand || "") + "|" + (p.material || "")) ?? null);
    const mail = emailContent(p, r.kind, link);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [r.contact], reply_to: REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text }),
      });
      if (!res.ok) {
        const t = await res.text();
        results.push({ id, result: "error", error: "Resend " + res.status + " : " + t.slice(0, 200) });
        continue;
      }
      // avisé -> on efface le courriel (Loi 25), on garde la trace anonyme
      await db.from("waitlist").update({ status: "notified", notified_at: new Date().toISOString(), contact: null, name: null }).eq("id", id);
      results.push({ id, result: "sent" });
    } catch (e) {
      results.push({ id, result: "error", error: String((e as Error)?.message || e) });
    }
  }
  return json({ results });
});
