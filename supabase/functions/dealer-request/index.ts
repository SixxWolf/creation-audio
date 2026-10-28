// =========================================================
// Création Audio — Edge Function « dealer-request » (accès revendeur)
// Déployée avec verify_jwt = false (le formulaire public est anonyme).
//
//  POST { action: 'submit', business, contact, email, phone, city, website?, facebook?, lang?, hp }
//     page revendeur.html (anonyme). hp = champ piège : rempli -> on fait semblant.
//     -> 200 { ok, status: 'new' | 'pending' | 'dealer' }   (new = courriel de réception envoyé)
//        429 { error: 'wait' }   trop de demandes depuis cette adresse IP
//        400 { error: 'bad_request' } · 503 { error: 'unavailable' }
//  POST { action: 'decide', id, approve }   ADMIN (jeton de session) — onglet Dealers
//     approuver = ajout à « dealers » + courriel de bienvenue ; refuser = silencieux
//     -> 200 { ok, mailed }
//  POST { action: 'invite', email }         ADMIN — dealer ajouté à la main : courriel de bienvenue (FR + EN)
//     -> 200 { ok }
// SQL : schema-v2.sql « DEMANDES D'ACCÈS REVENDEUR ». Secrets : RESEND_API_KEY ; MAIL_FROM optionnel.
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);
const str = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/* ---------- courriels ---------- */
function frame(title: string, inner: string) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:540px;margin:0 auto;color:#181A1F;line-height:1.55">' +
    '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Création Audio</p>' +
    '<h1 style="font-size:22px;margin:0 0 14px">' + title + "</h1>" + inner +
    '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
    '<p style="font-size:12px;color:#6C727C">Création Audio · <a href="' + SITE + '" style="color:#6C727C">creationaudio.ca</a></p>' +
    "</div>";
}
const button = (href: string, label: string) =>
  '<p style="margin:22px 0"><a href="' + href + '" style="display:inline-block;background:#FF6A2B;color:#fff;' +
  'text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px">' + label + "</a></p>";

function receivedMail(business: string, contact: string, en: boolean) {
  const L = (fr: string, eng: string) => (en ? eng : fr);
  const first = contact.split(" ")[0] || contact;
  const subject = L("Demande d'accès revendeur reçue", "Dealer access request received");
  const p1 = L("On a bien reçu ta demande d'accès revendeur pour ", "We received your dealer access request for ");
  const p2 = L("On te répond sous 24 h ouvrables. Dès que ton accès est ouvert, tu reçois un courriel avec le lien du portail.",
               "We'll get back to you within 1 business day. As soon as your access is open, you'll get an email with the portal link.");
  const p3 = L("Une question d'ici là ? Réponds simplement à ce courriel.", "Any question in the meantime? Just reply to this email.");
  const text = L("Bonjour ", "Hi ") + first + ",\n\n" + p1 + business + ".\n\n" + p2 + "\n\n" + p3 + "\n\n" +
    L("L'équipe Création Audio", "The Création Audio team") + "\n" + SITE + (en ? "/en/" : "");
  const html = frame(L("Demande reçue", "Request received"),
    "<p>" + L("Bonjour ", "Hi ") + esc(first) + ",</p><p>" + p1 + "<strong>" + esc(business) + "</strong>.</p>" +
    "<p>" + p2 + "</p><p>" + p3 + "</p>");
  return { subject, text, html };
}

function welcomeBlock(en: boolean, name: string) {
  const L = (fr: string, eng: string) => (en ? eng : fr);
  const portal = SITE + (en ? "/en/" : "/") + "dealer.html";
  const hello = L("Bonjour", "Hi") + (name ? " " + name : "") + ",";
  const p1 = L("Ton accès revendeur Création Audio est ouvert. Tu vois maintenant tes prix de gros et tes rabais quantité, et tu commandes directement en ligne.",
               "Your Création Audio dealer access is open. You can now see your wholesale prices and volume discounts, and order directly online.");
  const p2 = L("Pour te connecter, entre ton courriel sur le portail : on t'envoie un code à 6 chiffres. Aucun mot de passe à retenir.",
               "To sign in, enter your email on the portal: we'll send you a 6-digit code. No password to remember.");
  const btn = L("Ouvrir le portail revendeur", "Open the dealer portal");
  return {
    text: hello + "\n\n" + p1 + "\n\n" + p2 + "\n\n" + btn + " : " + portal,
    html: "<p>" + esc(hello) + "</p><p>" + p1 + "</p><p>" + p2 + "</p>" + button(portal, btn),
  };
}
function welcomeMail(name: string, lang: "fr" | "en" | "both") {
  const first = name.split(" ")[0] || "";
  if (lang !== "both") {
    const en = lang === "en";
    const b = welcomeBlock(en, first);
    return {
      subject: en ? "Your dealer access is open" : "Ton accès revendeur est ouvert",
      text: b.text + "\n\n" + (en ? "The Création Audio team" : "L'équipe Création Audio"),
      html: frame(en ? "Welcome aboard" : "Bienvenue parmi nos revendeurs", b.html),
    };
  }
  const fr = welcomeBlock(false, ""), en = welcomeBlock(true, "");
  return {
    subject: "Ton accès revendeur est ouvert · Your dealer access is open",
    text: fr.text + "\n\n— English —\n\n" + en.text + "\n\nL'équipe Création Audio",
    html: frame("Bienvenue parmi nos revendeurs", fr.html +
      '<hr style="border:none;border-top:1px solid #E7E7E2;margin:22px 0">' +
      '<h2 style="font-size:18px;margin:0 0 12px">Welcome aboard</h2>' + en.html),
  };
}

async function sendMail(to: string, mail: { subject: string; text: string; html: string }) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>",
        to: [to], reply_to: REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text,
      }),
    });
    if (!res.ok) console.error("dealer-request: Resend " + res.status + " " + (await res.text()).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error("dealer-request: envoi impossible", String((e as Error)?.message || e));
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) || {}; } catch { /* corps invalide */ }
  const action = String(body.action ?? "");

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };

  /* ---------- formulaire public ---------- */
  if (action === "submit") {
    if (String(body.hp ?? "") !== "") return json({ ok: true, status: "new" });   // robot : on fait semblant
    const p = {
      business: str(body.business, 120), contact: str(body.contact, 120),
      email: str(body.email, 254).toLowerCase(), phone: str(body.phone, 40), city: str(body.city, 120),
      website: str(body.website, 300), facebook: str(body.facebook, 300),
      lang: body.lang === "en" ? "en" : "fr",
    };
    if (!p.business || !p.contact || !p.phone || !p.city || !EMAIL_RE.test(p.email)) return json({ error: "bad_request" }, 400);
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64);
    const db = createClient(url, service, opts);
    const { data, error } = await db.rpc("dealer_request_submit", { p, p_ip: ip });
    if (error || !data) {
      console.error("dealer-request: submit", error?.message);
      return json({ error: error?.code === "22023" ? "bad_request" : "unavailable" }, error?.code === "22023" ? 400 : 503);
    }
    if (data.status === "wait") return json({ error: "wait" }, 429);
    if (data.status === "new" && data.id) await sendMail(p.email, receivedMail(p.business, p.contact, p.lang === "en"));
    return json({ ok: true, status: data.status });
  }

  /* ---------- actions de l'admin (jeton de session de l'admin) ---------- */
  const user = createClient(url, anon, { ...opts, global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });

  if (action === "decide") {
    const id = String(body.id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad_request" }, 400);
    const approve = body.approve === true;
    const { data: r, error } = await user.rpc("admin_dealer_request_decide", { p_id: id, p_approve: approve });
    if (error || !r) return json({ error: error?.message || "unavailable" }, error?.code === "42501" ? 403 : 400);
    const mailed = approve ? await sendMail(r.email, welcomeMail(r.contact || "", r.lang === "en" ? "en" : "fr")) : false;
    return json({ ok: true, mailed });
  }

  if (action === "invite") {
    const email = str(body.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ error: "bad_request" }, 400);
    // RLS : seule l'admin lit « dealers » -> ligne trouvée = appel de l'admin ET dealer existant
    const { data: d, error } = await user.from("dealers").select("email").eq("email", email).maybeSingle();
    if (error || !d) return json({ error: "forbidden" }, 403);
    const ok = await sendMail(email, welcomeMail("", "both"));
    return ok ? json({ ok: true }) : json({ error: "mail" }, 502);
  }

  return json({ error: "bad_request" }, 400);
});
