// =========================================================
// Création Audio — Edge Function « autoloop-cli »
// Donne au script du PC de l'atelier (tools/autoloop-cli) ce qu'il faut pour générer
// un batch AutoLoop sans navigateur ni connexion admin :
//   POST { token, action: "list" } -> plateaux (autoloop_plates), spacers, défauts
//        d'AutoLoop (admin_settings « autoloop »), Z par imprimante (« autoloop_ztrim »),
//        état des imprimantes (printers).
//   POST { token, action: "file", id } -> lien signé (2 min) du .gcode.3mf du plateau
//        (bucket privé « autoloop »).
// Sécurité : lecture seule. `token` = le jeton du relais des imprimantes (même table
// printer_tokens, seul son sha-256 est en base) ; la config locale du PC le garde.
// Déployée avec verify_jwt = false (le jeton remplace la session admin).
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST seulement" }, 405);
  let body: { token?: string; action?: string; id?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const hash = await sha256Hex(String(body.token || ""));
  const tok = await sb.from("printer_tokens").select("hash").eq("hash", hash).maybeSingle();
  if (tok.error || !tok.data) return json({ error: "jeton invalide" }, 401);

  if (body.action === "list") {
    const [plates, spacers, defs, zt, printers] = await Promise.all([
      sb.from("autoloop_plates").select("id,name,spacer_id,file_path,file_name,sort,client,settings,created_at"),
      sb.from("products").select("id,name,slug,attrs").eq("type", "spacer"),
      sb.from("admin_settings").select("value").eq("key", "autoloop").maybeSingle(),
      sb.from("admin_settings").select("value").eq("key", "autoloop_ztrim").maybeSingle(),
      sb.from("printers").select("id,name,model,sort,status,seen_at").order("sort"),
    ]);
    const err = [plates, spacers, defs, zt, printers].find((r) => r.error);
    if (err) return json({ error: err.error!.message }, 500);
    return json({
      plates: plates.data,
      spacers: spacers.data,
      defaults: defs.data?.value ?? null,
      ztrim: zt.data?.value?.values ?? {},
      printers: (printers.data || []).map((p) => ({
        id: p.id, name: p.name, model: p.model, sort: p.sort, seen_at: p.seen_at,
        state: p.status?.state ?? null, file: p.status?.file ?? null, online: p.status?.online ?? null,
      })),
    });
  }

  if (body.action === "file") {
    const row = await sb.from("autoloop_plates").select("file_path").eq("id", String(body.id || "")).maybeSingle();
    if (row.error || !row.data) return json({ error: "plateau introuvable" }, 404);
    const url = await sb.storage.from("autoloop").createSignedUrl(row.data.file_path, 120);
    if (url.error) return json({ error: url.error.message }, 500);
    return json({ url: url.data.signedUrl });
  }

  return json({ error: "action inconnue (list | file)" }, 400);
});
