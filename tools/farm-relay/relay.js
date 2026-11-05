// Relais de la ferme d'imprimantes : lit chaque Bambu (MQTT local) et pousse l'état vers Supabase (RPC printer_push).
// Lancer : node relay.js   (config : %USERPROFILE%\Documents\Création Audio - Imprimantes\config.json, ou RELAY_CONFIG=chemin)
// La config (IP + code d'accès des imprimantes, jeton Supabase) reste LOCALE : jamais dans le dépôt, jamais dans la base.
const fs = require('fs');
const os = require('os');
const path = require('path');
const mqtt = require('mqtt');

const CONFIG = process.env.RELAY_CONFIG ||
  path.join(os.homedir(), 'Documents', 'Création Audio - Imprimantes', 'config.json');
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const PUSH_EVERY = 3000;      // ms entre deux envois
const HEARTBEAT = 30000;      // ms : renvoyer même sans changement
const STALE = 20000;          // ms sans message = imprimante hors ligne

const log = (...a) => console.log(new Date().toLocaleTimeString('fr-CA'), ...a);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const rnd = (v) => (num(v) === null ? null : Math.round(v));

const printers = cfg.printers.map((p) => ({
  ...p, raw: {}, lastMsg: 0, connected: false, sentKey: '', sentAt: 0, client: null,
}));

function connect(p) {
  const c = mqtt.connect(`mqtts://${p.ip}:8883`, {
    username: 'bblp', password: p.code, rejectUnauthorized: false,
    clientId: `ca-relay-${p.id}-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5000, connectTimeout: 8000,
  });
  p.client = c;
  const ask = () => c.publish(`device/${p.serial}/request`,
    JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }));
  c.on('connect', () => {
    p.connected = true; log(p.name, 'connecté');
    c.subscribe(`device/${p.serial}/report`);
    ask();
  });
  c.on('message', (_t, buf) => {
    let j; try { j = JSON.parse(buf); } catch { return; }
    if (!j.print) return;
    Object.assign(p.raw, j.print);
    p.lastMsg = Date.now();
  });
  c.on('close', () => { if (p.connected) log(p.name, 'déconnecté'); p.connected = false; });
  c.on('error', (e) => log(p.name, 'erreur', e.message));
  setInterval(() => c.connected && ask(), 60000); // état complet de temps en temps
}

function status(p) {
  const r = p.raw;
  const online = p.connected && Date.now() - p.lastMsg < STALE;
  return {
    online,
    state: r.gcode_state || null,                       // IDLE | PREPARE | RUNNING | PAUSE | FINISH | FAILED
    file: r.subtask_name || r.gcode_file || null,
    pct: num(r.mc_percent),
    layer: num(r.layer_num),
    layers: num(r.total_layer_num),
    left: num(r.mc_remaining_time),                      // minutes
    nozzle: rnd(r.nozzle_temper), nozzle_t: rnd(r.nozzle_target_temper),
    bed: rnd(r.bed_temper), bed_t: rnd(r.bed_target_temper),
    chamber: rnd(r.chamber_temper),
    speed: num(r.spd_lvl),                               // 1 silencieux · 2 standard · 3 sport · 4 ludicrous
    err: num(r.print_error) || 0,
    hms: Array.isArray(r.hms) ? r.hms.length : 0,
  };
}

let pushing = false;
async function push() {
  if (pushing) return; pushing = true;
  try {
    const now = Date.now(), rows = [];
    for (const p of printers) {
      const st = status(p), key = JSON.stringify(st);
      if (key === p.sentKey && now - p.sentAt < HEARTBEAT) continue;
      rows.push({ id: p.id, name: p.name, model: p.model || 'P2S', serial: p.serial, cam: p.cam || null, sort: p.sort || 0, status: st });
      p._pending = { key, at: now };
    }
    if (!rows.length) return;
    const res = await fetch(`${cfg.supabase.url}/rest/v1/rpc/printer_push`, {
      method: 'POST',
      headers: { apikey: cfg.supabase.key, Authorization: `Bearer ${cfg.supabase.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: cfg.supabase.token, p_rows: rows }),
    });
    if (!res.ok) { log('Supabase', res.status, (await res.text()).slice(0, 200)); return; }
    for (const p of printers) if (p._pending) { p.sentKey = p._pending.key; p.sentAt = p._pending.at; p._pending = null; }
  } catch (e) { log('envoi raté', e.message); }
  finally { pushing = false; }
}

printers.forEach(connect);
setInterval(push, PUSH_EVERY);
log('relais démarré —', printers.map((p) => p.name).join(', '));
