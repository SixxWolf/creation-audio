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
import * as M from "../_shared/mail.ts";

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
// Lit une revendication du JWT « Bearer … » (à n'utiliser qu'après getUser(), qui le valide).
function jwtClaim(authHeader: string, key: string): unknown {
  try {
    const p = authHeader.replace(/^Bearer\s+/i, "").split(".")[1];
    return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4)))[key];
  } catch { return undefined; }
}

function slugify(s: string | null | undefined) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const KIND_LABEL: Record<string, string> = { spool: "avec bobine", refill: "recharge" };
const KIND_LABEL_EN: Record<string, string> = { spool: "with spool", refill: "refill" };

type Product = { id: string; type: string; name: string; brand: string | null; material: string | null; slug: string | null;
  i18n?: { name?: string } | null };

// en = avis demandé depuis la version anglaise (waitlist.lang) -> pages /en/
function productUrl(p: Product, brandSlug: string | null, matSlug: string | null, en = false) {
  const base = SITE + (en ? "/en" : "");
  if (p.type === "spacer") return base + "/boutique/spacers";
  if (p.type !== "filament") return base + "/boutique";
  const b = brandSlug || slugify(p.brand || "Autres");
  const m = matSlug || slugify(p.material || "Autres");
  return base + "/boutique#/m/" + b + "/" + m + "/" + (p.slug || slugify(p.name));
}

function emailContent(p: Product, kind: string | null, url: string, en = false, thumb: M.Thumb = null) {
  if (en) return emailContentEn(p, kind, url, thumb);
  const what = [p.material, p.name].filter(Boolean).join(" ") + (kind && KIND_LABEL[kind] ? " (" + KIND_LABEL[kind] + ")" : "");
  const subject = "C'est arrivé : " + what + " est de retour en stock";
  const text =
    "Bonjour,\n\n" +
    "Bonne nouvelle : le " + what + " que tu attendais est de nouveau en stock chez Création Audio.\n\n" +
    "Voir le produit : " + url + "\n\n" +
    "Les quantités sont limitées. Pour le réserver, ajoute-le à ton panier sur le site ou réponds simplement à ce courriel.\n\n" +
    "Merci et à bientôt !\nCréation Audio\n\n" +
    "—\nTu reçois ce courriel une seule fois parce que tu as demandé à être avisé(e) du retour de ce produit sur creationaudio.ca. " +
    "Ton adresse a maintenant été supprimée de notre liste d'attente.";
  const html = M.page({
    lang: "fr", tag: "Liste d'attente", title: "C'est de retour en stock !", preheader: what + " est de nouveau en stock.",
    body: M.text("Bonjour,") + M.text("Bonne nouvelle&nbsp;: le produit que tu attendais est de nouveau en stock.") +
      M.items([{ label: [p.material, p.name].filter(Boolean).join(" "), meta: [p.brand, kind && KIND_LABEL[kind] ? KIND_LABEL[kind] : ""].filter(Boolean).join(" · "),
        thumb, flag: { text: "en stock", tone: "ok" } }]) + '<div style="height:18px;line-height:18px;font-size:0">&nbsp;</div>' +
      M.button(url, "Voir le produit") +
      M.text("Les quantités sont limitées. Pour le réserver, ajoute-le à ton panier sur le site ou réponds simplement à ce courriel."),
    foot: "Merci et à bientôt&nbsp;!",
    after: "Tu reçois ce courriel une seule fois parce que tu as demandé à être avisé(e) du retour de ce produit. " +
      "Ton adresse a maintenant été supprimée de notre liste d'attente.",
  });
  return { subject, text, html };
}

function emailContentEn(p: Product, kind: string | null, url: string, thumb: M.Thumb = null) {
  const name = (p.type === "accessory" && p.i18n?.name) || p.name;
  const what = [p.material, name].filter(Boolean).join(" ") + (kind && KIND_LABEL_EN[kind] ? " (" + KIND_LABEL_EN[kind] + ")" : "");
  const subject = "It's here: " + what + " is back in stock";
  const text =
    "Hello,\n\n" +
    "Good news: the " + what + " you were waiting for is back in stock at Création Audio.\n\n" +
    "See the product: " + url + "\n\n" +
    "Quantities are limited. To get it, add it to your cart on the site or simply reply to this email.\n\n" +
    "Thanks and see you soon!\nCréation Audio\n\n" +
    "—\nYou're getting this email only once because you asked to be notified when this product is back on creationaudio.ca. " +
    "Your address has now been deleted from our waitlist.";
  const html = M.page({
    lang: "en", tag: "Waitlist", title: "It's back in stock!", preheader: what + " is back in stock.",
    body: M.text("Hello,") + M.text("Good news: the product you were waiting for is back in stock.") +
      M.items([{ label: [p.material, name].filter(Boolean).join(" "), meta: [p.brand, kind && KIND_LABEL_EN[kind] ? KIND_LABEL_EN[kind] : ""].filter(Boolean).join(" · "),
        thumb, flag: { text: "in stock", tone: "ok" } }]) + '<div style="height:18px;line-height:18px;font-size:0">&nbsp;</div>' +
      M.button(url, "See the product") +
      M.text("Quantities are limited. To get it, add it to your cart on the site or simply reply to this email."),
    foot: "Thanks and see you soon!",
    after: "You're getting this email only once because you asked to be notified when this product is back. " +
      "Your address has now been deleted from our waitlist.",
  });
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
  // + double authentification validée (aal2), comme is_admin() en base (jeton vérifié par getUser ci-dessus)
  if (jwtClaim(authHeader, "aal") !== "aal2") return json({ error: "Double authentification requise." }, 403);

  if (!resendKey) return json({ error: "Envoi non configuré : secret RESEND_API_KEY manquant dans Supabase." }, 503);

  let ids: string[] = [];
  try { ids = ((await req.json())?.ids || []).filter((x: unknown) => typeof x === "string").slice(0, 50); } catch { /* corps invalide */ }
  if (!ids.length) return json({ error: "Aucune demande à aviser." }, 400);

  const db = createClient(url, service);
  await M.loadCompany(db);
  const { data: rows, error } = await db.from("waitlist")
    .select("id, product_id, kind, contact, source, status, lang").in("id", ids);
  if (error) return json({ error: error.message }, 500);

  const pids = [...new Set((rows || []).map((r) => r.product_id))];
  const { data: prods } = await db.from("products").select("id, type, name, brand, material, slug, i18n").in("id", pids.length ? pids : ["00000000-0000-0000-0000-000000000000"]);
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
    const link = productUrl(p, brandSlug.get(p.brand || "") ?? null, matSlug.get((p.brand || "") + "|" + (p.material || "")) ?? null, r.lang === "en");
    const [thumb] = await M.thumbs(db, [{ product_id: p.id, kind: r.kind }]);
    const mail = emailContent(p, r.kind, link, r.lang === "en", thumb);
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
