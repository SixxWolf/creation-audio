// =========================================================
// Création Audio — Edge Function « translate »
// Traduit en anglais (site /en/) les textes affichés venant de la base :
// produits (accessoires, spacers : description, texte long, specs,
// positions de montage), matériaux (description, texte long, specs) et
// nouvelles (titre, texte, bouton). Écrit products/materials/news.i18n :
//   { h, name?, description?, long_desc?, category?, title?, body?, cta_label?,
//     s: { "texte court FR": "EN" } }   (s = specs k/v + positions)
// Les lignes à faire sont marquées « stale » par un déclencheur dès que le
// français change (schema-v2.sql, section LANGUE ANGLAISE) ; i18n_tick
// (pg_cron, aux 5 min) appelle cette fonction quand il y a du travail.
//
// Appel : POST { cron: true } + en-tête x-cron-key (private.secrets « cron_key »).
// Secrets : ANTHROPIC_API_KEY ; SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fournis.
// =========================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const MODEL = "claude-haiku-5-5";
const BATCH = 6;          // éléments par appel au modèle
const MAX_ITEMS = 60;     // par passage (le prochain tick reprend le reste)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SYSTEM = `You translate a small Québec business's website content from Québec French to Canadian English.
The business (Création Audio, Québec City) sells 3D printing filament and 3D-printed car audio speaker spacers/adapters.
Rules:
- Natural, concise Canadian English (colour, centre). Friendly tone; French "tu"/"vous" both become "you".
- Glossary: spacer = spacer; adaptateur = adapter; bobine = spool; recharge = refill (filament without spool);
  bobine vide = empty spool; ramassage / cueillette = pickup; plage de cueillette = pickup time slot;
  portes avant / arrière = front / rear doors; haut-parleur = speaker; habitacle = cabin; impression 3D = 3D printing;
  Québec (the city) = Québec City; « Écris-nous » = Write to us.
- Sizes: "6,5 po" -> 6.5"; decimal commas become points; "°C" stays; "12 h" times -> 12:00.
- Never translate brand names, product codes (CA-ADP-…), material names (PLA Basic, PETG HF, Silk…), colour names, model names.
- Keep line breaks (\\n) and paragraphs exactly; keep any URLs, codes and numbers.
- Return ONLY JSON: {"items":[{"i":<index>, ...same keys as the input "src", translated}]}.
  Strings stay strings; "specs" stays an array of {"k","v"} of the same length and order; "pos" stays an array of the same length and order.`;

type Pending = { tbl: string; key: Record<string, string>; src: Record<string, unknown>; h: string };
type Spec = { k?: string; v?: string };

function toI18n(src: Record<string, unknown>, out: Record<string, unknown>) {
  const en: Record<string, unknown> = {};
  const s: Record<string, string> = {};
  for (const f of ["name", "description", "long_desc", "category", "title", "body", "cta_label"]) {
    if (typeof src[f] === "string" && typeof out[f] === "string" && (out[f] as string).trim()) en[f] = out[f];
  }
  const add = (fr: unknown, tx: unknown) => {
    if (typeof fr === "string" && fr.trim() && typeof tx === "string" && tx.trim() && fr !== tx) s[fr] = tx;
  };
  if (Array.isArray(src.specs) && Array.isArray(out.specs)) {
    (src.specs as Spec[]).forEach((x, i) => {
      const y = (out.specs as Spec[])[i] || {};
      add(x && x.k, y.k); add(x && x.v, y.v);
    });
  }
  if (Array.isArray(src.pos) && Array.isArray(out.pos)) (src.pos as string[]).forEach((x, i) => add(x, (out.pos as string[])[i]));
  if (Object.keys(s).length) en.s = s;
  return en;
}

async function translateBatch(client: Anthropic, batch: Pending[]) {
  const input = { items: batch.map((p, i) => ({ i, kind: p.tbl, src: p.src })) };
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(input) }],
  });
  const out = msg.content.find((b) => b.type === "text");
  const txt = out && out.type === "text" ? out.text : "";
  const m = /\{[\s\S]*\}/.exec(txt);
  if (!m) throw new Error("réponse illisible");
  const parsed = JSON.parse(m[0]) as { items?: Record<string, unknown>[] };
  const byI = new Map<number, Record<string, unknown>>();
  (parsed.items || []).forEach((x) => { if (typeof x.i === "number") byI.set(x.i, x); });
  return batch.map((p, i) => byI.get(i) || null);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST seulement." }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps invalide */ }
  if (body?.cron !== true) return json({ error: "Appel non reconnu." }, 400);
  const { data: ok } = await db.rpc("reservation_cron_ok", { p_key: req.headers.get("x-cron-key") || "" });
  if (ok !== true) return json({ error: "Clé invalide." }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "no_key" }, 503);
  const client = new Anthropic({ apiKey });

  const { data, error } = await db.rpc("i18n_pending", { p_limit: MAX_ITEMS });
  if (error) return json({ error: error.message }, 500);
  const todo = (data || []) as Pending[];
  let saved = 0, failed = 0;
  for (let k = 0; k < todo.length; k += BATCH) {
    const batch = todo.slice(k, k + BATCH);
    let res: (Record<string, unknown> | null)[];
    try { res = await translateBatch(client, batch); }
    catch (e) { console.error("translate", e instanceof Error ? e.message : e); failed += batch.length; continue; }
    for (let i = 0; i < batch.length; i++) {
      const p = batch[i], out = res[i];
      if (!out) { failed++; continue; }
      const { data: w, error: we } = await db.rpc("i18n_save", { p_tbl: p.tbl, p_key: p.key, p_h: p.h, p_en: toI18n(p.src, out) });
      if (we) { console.error("save", we.message); failed++; } else if (w) saved++;
    }
  }
  return json({ result: "done", pending: todo.length, saved, failed });
});
