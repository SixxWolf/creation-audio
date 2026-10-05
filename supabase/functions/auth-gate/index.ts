// =========================================================
// Création Audio — Edge Function « auth-gate » (portier de connexion)
// Toutes les connexions par mot de passe (admin + portail dealer) passent ici
// (assets/auth-gate.js -> CA.signIn).
//
//  - Anti force brute PAR COMPTE : 5 mauvais mots de passe en 15 min -> compte
//    bloqué 15 min, même avec le bon mot de passe. Compteur en base
//    (private.login_guard) via les RPC auth_gate_begin / auth_gate_ok
//    (schema-v2.sql, section « ANTI FORCE BRUTE ») ; l'essai est compté AVANT
//    la vérification, une rafale en parallèle ne passe donc pas.
//  - Le mot de passe enregistré dans Supabase Auth est DÉRIVÉ du mot de passe
//    tapé (HMAC-SHA256 avec le secret serveur private.secrets.auth_pepper) :
//    un robot qui attaque l'API Supabase Auth en direct ne peut pas deviner ce
//    mot de passe dérivé ; il est obligé de passer par ce portier et son compteur.
//  - Migration douce : un compte dont le mot de passe est encore « brut » (créé
//    ou réinitialisé dans le tableau de bord Supabase) est accepté puis converti
//    tout de suite en mot de passe dérivé.
//  - La 2FA (TOTP) de l'admin se fait ensuite dans la page, avec la session reçue.
//
// Appel : POST { email, password } — sans JWT (déployée avec verify_jwt = false)
// Réponses : 200 { session: { access_token, refresh_token } }
//            401 { error: 'invalid', left }          mauvais identifiants
//            429 { error: 'locked', retry_after }    trop d'essais (secondes)
//            403 { error: 'revoked' }                compte bloqué (dealer retiré)
//            400 { error: 'bad_request' } · 503 { error: 'unavailable' }
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const enc = new TextEncoder();
// Mot de passe réel côté Supabase Auth : « Ca1! » + HMAC en base64url (47 car.,
// sous la limite bcrypt de 72 octets ; majuscule/minuscule/chiffre/symbole présents).
async function derive(pepper: string, email: string, password: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(email + "\n" + password)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return "Ca1!" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type AuthErr = { code?: string; message?: string } | null;
const isBanned = (e: AuthErr) => !!e && (e.code === "user_banned" || /banned/i.test(e.message || ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);

  let email = "", password = "";
  try {
    const body = await req.json();
    email = String(body?.email ?? "").trim().toLowerCase();
    password = String(body?.password ?? "");
  } catch { /* corps invalide */ }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length > 200) {
    return json({ error: "bad_request" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const db = createClient(url, service, opts);

  // 1) bloqué ? sinon l'essai est compté tout de suite
  const { data: gate, error: gateErr } = await db.rpc("auth_gate_begin", { p_email: email });
  if (gateErr || !gate) return json({ error: "unavailable" }, 503);
  if (!gate.allowed) return json({ error: "locked", retry_after: gate.retry_after }, 429);

  const failed = () => gate.left > 0
    ? json({ error: "invalid", left: gate.left }, 401)
    : json({ error: "locked", retry_after: 900 }, 429);
  const success = async (s: { access_token: string; refresh_token: string }) => {
    await db.rpc("auth_gate_ok", { p_email: email });
    return json({ session: { access_token: s.access_token, refresh_token: s.refresh_token } });
  };

  // Courriel inconnu : même réponse (et à peu près le même délai) qu'un mauvais mot de passe.
  if (!gate.exists) { await sleep(300 + Math.random() * 300); return failed(); }

  const signIn = (pw: string) => createClient(url, anon, opts).auth.signInWithPassword({ email, password: pw });
  const derived = await derive(String(gate.pepper), email, password);

  // 2) mot de passe dérivé (cas normal)
  const r = await signIn(derived);
  if (!r.error && r.data.session) return await success(r.data.session);
  if (isBanned(r.error)) return json({ error: "revoked" }, 403);

  // 3) mot de passe encore « brut » (avant le portier, ou réinitialisé dans Supabase) -> conversion
  const legacy = await signIn(password);
  if (legacy.error || !legacy.data.session || !legacy.data.user) {
    return isBanned(legacy.error) ? json({ error: "revoked" }, 403) : failed();
  }
  const up = await db.auth.admin.updateUserById(legacy.data.user.id, { password: derived });
  if (!up.error) {
    const r2 = await signIn(derived);
    if (!r2.error && r2.data.session) {
      await db.auth.admin.signOut(legacy.data.session.access_token, "local").catch(() => {});
      return await success(r2.data.session);
    }
  } else {
    console.error("auth-gate: conversion du mot de passe impossible", up.error.message);
  }
  return await success(legacy.data.session);   // repli : la session « brute » reste valable
});
