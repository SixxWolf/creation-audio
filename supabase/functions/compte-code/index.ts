// =========================================================
// Création Audio — Edge Function « compte-code » (comptes clients)
// Connexion SANS mot de passe : un code à 6 chiffres envoyé par courriel.
// Appelée par compte.html (assets/compte.js) — déployée avec verify_jwt = false.
//
//  POST { action: 'send', email, hp }
//     -> 200 { ok }                         code envoyé (hp rempli = robot : rien n'est fait)
//        429 { error: 'wait', retry_after } 1 envoi / 60 s, 5 / h par courriel, 20 / h par IP
//        403 { error: 'reserved' }          courriel de l'admin (il passe par sa propre page)
//        502 { error: 'mail' }              Resend a refusé l'envoi
//  POST { action: 'verify', email, code }
//     -> 200 { session: { access_token, refresh_token }, needs_name }
//        401 { error: 'invalid', left }     mauvais code
//        410 { error: 'expired' }           aucun code valable (expiré, déjà utilisé, 5 essais ratés)
//        403 { error: 'revoked' }           compte bloqué
//  400 { error: 'bad_request' } · 503 { error: 'unavailable' }
//
// Le code n'est jamais stocké en clair (HMAC en base, schéma private, RPC
// compte_code_issue / compte_code_check — schema-v2.sql « COMPTES CLIENTS »).
// L'utilisateur Supabase Auth n'est créé QU'APRÈS un bon code ; la session est
// ouverte côté serveur (lien magique généré puis vérifié ici, jamais envoyé).
// Secrets : RESEND_API_KEY (déjà posé pour waitlist-notify) ; MAIL_FROM optionnel.
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// 6 chiffres uniformes (tirage rejeté au-delà du dernier multiple de 10^6)
function newCode() {
  const buf = new Uint32Array(1);
  const max = Math.floor(0xffffffff / 1e6) * 1e6;
  do crypto.getRandomValues(buf); while (buf[0] >= max);
  return String(buf[0] % 1e6).padStart(6, "0");
}

function mailContent(code: string) {
  const subject = "Ton code de connexion : " + code;
  const text =
    "Bonjour,\n\n" +
    "Voici ton code pour te connecter à ton compte Création Audio :\n\n" +
    "    " + code + "\n\n" +
    "Il expire dans 10 minutes.\n\n" +
    "Si tu n'as pas demandé ce code, ignore simplement ce courriel : personne ne peut se connecter sans lui.\n\n" +
    "Création Audio\n" + SITE;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#181A1F;line-height:1.5">' +
    '<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#FF6A2B;font-weight:700;margin:0 0 12px">Création Audio</p>' +
    '<h1 style="font-size:22px;margin:0 0 14px">Ton code de connexion</h1>' +
    "<p>Bonjour,</p>" +
    "<p>Voici ton code pour te connecter à ton compte&nbsp;:</p>" +
    '<p style="margin:20px 0;font-size:34px;font-weight:700;letter-spacing:.18em;font-family:Consolas,Menlo,monospace;' +
    'background:#F4F3EF;border-radius:12px;padding:14px 20px;display:inline-block">' + code + "</p>" +
    "<p>Il expire dans <strong>10 minutes</strong>.</p>" +
    '<hr style="border:none;border-top:1px solid #E7E7E2;margin:24px 0 12px">' +
    '<p style="font-size:12px;color:#6C727C">Si tu n\'as pas demandé ce code, ignore simplement ce courriel&nbsp;: personne ne peut se connecter sans lui. ' +
    '<a href="' + SITE + '" style="color:#6C727C">creationaudio.ca</a></p>' +
    "</div>";
  return { subject, text, html };
}

type AuthErr = { code?: string; message?: string } | null;
const isBanned = (e: AuthErr) => !!e && (e.code === "user_banned" || /banned/i.test(e.message || ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) || {}; } catch { /* corps invalide */ }
  const action = String(body.action ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "bad_request" }, 400);
  if (email === ADMIN_EMAIL) return json({ error: "reserved" }, 403);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const db = createClient(url, service, opts);

  /* ---------- envoi du code ---------- */
  if (action === "send") {
    if (String(body.hp ?? "") !== "") return json({ ok: true });   // robot : on fait semblant
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "unavailable" }, 503);
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64);
    const code = newCode();
    const { data: gate, error } = await db.rpc("compte_code_issue", { p_email: email, p_ip: ip, p_code: code });
    if (error || !gate) return json({ error: "unavailable" }, 503);
    if (!gate.allowed) return json({ error: "wait", retry_after: gate.retry_after }, 429);
    const mail = mailContent(code);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("MAIL_FROM") || "Création Audio <avis@creationaudio.ca>",
          to: [email], reply_to: REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text,
        }),
      });
      if (!res.ok) {
        console.error("compte-code: Resend " + res.status + " " + (await res.text()).slice(0, 200));
        return json({ error: "mail" }, 502);
      }
    } catch (e) {
      console.error("compte-code: envoi impossible", String((e as Error)?.message || e));
      return json({ error: "mail" }, 502);
    }
    return json({ ok: true });
  }

  /* ---------- vérification + session ---------- */
  if (action === "verify") {
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) return json({ error: "bad_request" }, 400);
    const { data: chk, error } = await db.rpc("compte_code_check", { p_email: email, p_code: code });
    if (error || !chk) return json({ error: "unavailable" }, 503);
    if (!chk.ok) {
      return chk.reason === "invalid"
        ? json({ error: "invalid", left: chk.left }, 401)
        : json({ error: "expired" }, 410);
    }

    // Lien magique généré côté serveur (jamais envoyé) puis vérifié ici -> session.
    let link = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error || !link.data?.properties?.hashed_token) {
      const created = await db.auth.admin.createUser({ email, email_confirm: true });
      if (created.error && !/already|exists|registered/i.test(created.error.message || "")) {
        console.error("compte-code: création du compte impossible", created.error.message);
        return json({ error: "unavailable" }, 503);
      }
      link = await db.auth.admin.generateLink({ type: "magiclink", email });
    }
    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !tokenHash) {
      console.error("compte-code: lien impossible", link.error?.message);
      return json({ error: "unavailable" }, 503);
    }
    const pub = createClient(url, anon, opts);
    let v = await pub.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (v.error && !isBanned(v.error)) v = await pub.auth.verifyOtp({ type: "email", token_hash: tokenHash });
    if (isBanned(v.error)) return json({ error: "revoked" }, 403);
    if (v.error || !v.data.session || !v.data.user) {
      console.error("compte-code: session impossible", v.error?.message);
      return json({ error: "unavailable" }, 503);
    }
    const { data: touch } = await db.rpc("compte_touch", { p_id: v.data.user.id, p_email: email });
    return json({
      session: { access_token: v.data.session.access_token, refresh_token: v.data.session.refresh_token },
      needs_name: !touch || !!touch.needs_name,
    });
  }

  return json({ error: "bad_request" }, 400);
});
