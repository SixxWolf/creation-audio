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

// Caméra des A1/P1 : flux JPEG propriétaire (TLS, port 6000), converti en MJPEG pour un <img> du navigateur.
// Serveur lié à 127.0.0.1 seulement (jamais au réseau), sans en-tête CORS ; connexion à l'imprimante ouverte
// seulement tant qu'un navigateur regarde (elle n'accepte que peu de clients à la fois).
const CAM_PORT = 1985;
function camAuth(code) {
  const h = Buffer.alloc(80);
  h.writeUInt32LE(0x40, 0); h.writeUInt32LE(0x3000, 4);
  h.write('bblp', 16); h.write(code, 48);
  return h;
}
const camPrinters = printers.filter((p) => /^mjpeg:/.test(p.cam || ''));
if (camPrinters.length) {
  require('http').createServer((req, res) => {
    const m = /^\/cam\/([\w-]+)\.mjpg$/.exec(req.url.split('?')[0]);
    const p = m && camPrinters.find((x) => x.cam === 'mjpeg:' + m[1]);
    if (!p) { res.writeHead(404); return res.end(); }
    const s = require('tls').connect({ host: p.ip, port: 6000, rejectUnauthorized: false }, () => s.write(camAuth(p.code)));
    let buf = Buffer.alloc(0), started = false;
    const end = () => { s.destroy(); res.end(); };
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 16) {
        const size = buf.readUInt32LE(0);
        if (size > 4 * 1024 * 1024) return end();             // flux incohérent
        if (buf.length < 16 + size) break;
        const jpg = buf.subarray(16, 16 + size); buf = buf.subarray(16 + size);
        if (jpg[0] !== 0xff || jpg[1] !== 0xd8) continue;      // pas une image (réponse d'erreur)
        if (!started) { started = true; res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store' }); }
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`); res.write(jpg); res.write('\r\n');
      }
    });
    s.on('error', end); s.on('close', () => res.end()); s.setTimeout(15000, end);
    res.on('close', () => s.destroy());
  }).listen(CAM_PORT, '127.0.0.1', () => log('caméras JPEG sur 127.0.0.1:' + CAM_PORT));
}

printers.forEach(connect);
setInterval(push, PUSH_EVERY);
log('relais démarré —', printers.map((p) => p.name).join(', '));
