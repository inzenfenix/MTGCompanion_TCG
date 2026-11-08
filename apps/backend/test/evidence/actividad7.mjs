// Evidencia de funcionamiento — Actividad N°7 (ROADMAP.md O17, issue #151):
// trazabilidad y plan de respuesta.
//
// Misma base que actividad6.mjs: PostgreSQL 16 desechable + migraciones +
// backend COMPILADO (dist/main.js) + un SMTP mínimo en 127.0.0.1 que recibe
// los avisos de alerta enviados al buzón de seguridad. Escribe en <outDir>:
//   01 catálogo de eventos y campos · 02 registro de accesos · 03 protección
//   04 alertas propias · 05 simulación de un incidente y su reconstrucción
//   (05b/05c: la línea de tiempo por la API y por el script offline)
//   06 correos de alerta.
//
//   cd apps/backend && npm run build
//   node test/evidence/actividad7.mjs ../../docs/security/evidencia/actividad7
//
// Cuentas nuevas en cada corrida; llaves aleatorias; nada sale de la máquina.
import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

pg.types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));

const OUT = resolve(process.argv[2] ?? 'evidencia-actividad7');
const KEEP = process.argv.includes('--keep');
const PG_PORT = 54333;
const API_PORT = 3102;
const SMTP_PORT = 2527;
const API = `http://localhost:${API_PORT}`;
const DB = 'mtg_evidencia7';
const PASS = 'Evidencia-2026!';
const TS = Date.now();

mkdirSync(OUT, { recursive: true });

// ── output helpers ───────────────────────────────────────────────────────
let buf = [];
const out = (s = '') => buf.push(s);
const say = (title) => out(`\n=== ${title} ===`);
function flush(file, title) {
  const header = [
    `# ${title}`,
    `# Generado por apps/backend/test/evidence/actividad7.mjs — ${new Date().toISOString()}`,
    `# Backend compilado (dist/main.js) + PostgreSQL 16 embebido + SMTP local. Tokens truncados; ids y correos reemplazados por etiquetas.`,
  ];
  writeFileSync(join(OUT, file), [...header, ...buf].join('\n') + '\n');
  console.log(`  escrito ${file} (${buf.length} líneas)`);
  buf = [];
}
const short = (t) => (t ? `${String(t).slice(0, 18)}…` : t);
const ids = new Map();
const emails = new Map();
const label = (s) => {
  let text = typeof s === 'string' ? s : JSON.stringify(s, null, 2);
  for (const [id, name] of ids) text = text.split(id).join(`<id:${name}>`);
  for (const [email, name] of emails) text = text.split(email).join(`<correo:${name}>`);
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, (m) => short(m))
    .replace(/\b[A-Za-z0-9_-]{43}\b/g, (m) => `${m.slice(0, 8)}…(código)`);
};

// ── SMTP sink (127.0.0.1 only) ───────────────────────────────────────────
const inbox = [];
function decodeWords(s) {
  s = s.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return s.replace(/=\?utf-8\?([BQ])\?([^?]*)\?=/gi, (_, enc, data) =>
    enc.toUpperCase() === 'B'
      ? Buffer.from(data, 'base64').toString('utf8')
      : Buffer.from(
          data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))),
          'latin1',
        ).toString('utf8'),
  );
}
function decodeQP(s) {
  const bytes = s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, 'latin1').toString('utf8');
}
function parseMail(raw) {
  const [head] = raw.split(/\r?\n\r?\n/);
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  const header = (name) => (unfolded.match(new RegExp(`^${name}:\\s*(.*)$`, 'mi')) ?? [])[1] ?? '';
  // text/plain part (nodemailer sends multipart/alternative with text + html)
  const part = raw.match(/Content-Type: text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|$)/i);
  const enc = (raw.match(/Content-Type: text\/plain[^]*?Content-Transfer-Encoding:\s*(\S+)/i) ?? [])[1] ?? '';
  let text = part ? part[1] : '';
  if (/quoted-printable/i.test(enc)) text = decodeQP(text);
  else if (/base64/i.test(enc)) text = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
  return { to: header('To'), subject: decodeWords(header('Subject')), text: text.trim() };
}
const smtp = createServer((sock) => {
  let data = '';
  let inData = false;
  sock.write('220 evidencia ESMTP\r\n');
  sock.on('data', (chunk) => {
    data += chunk.toString('latin1');
    let idx;
    while (true) {
      if (inData) {
        idx = data.indexOf('\r\n.\r\n');
        if (idx < 0) return;
        inbox.push(parseMail(Buffer.from(data.slice(0, idx), 'latin1').toString('latin1')));
        data = data.slice(idx + 5);
        inData = false;
        sock.write('250 OK\r\n');
        continue;
      }
      idx = data.indexOf('\r\n');
      if (idx < 0) return;
      const line = data.slice(0, idx);
      data = data.slice(idx + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-evidencia\r\n250 8BITMIME\r\n');
      else if (cmd === 'DATA') {
        inData = true;
        sock.write('354 go\r\n');
      } else if (cmd === 'QUIT') {
        sock.write('221 bye\r\n');
        sock.end();
      } else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function mailFor(email, subjectRe, after = 0) {
  for (let i = 0; i < 100; i++) {
    const m = inbox.slice(after).find((x) => x.to.includes(email) && subjectRe.test(x.subject));
    if (m) return m;
    await pause(50);
  }
  throw new Error(`no llegó correo a ${email} (${subjectRe})`);
}
const codeIn = (m) => m.text.match(/^[A-Za-z0-9_-]{43}$/m)[0];

// ── HTTP + SQL helpers ───────────────────────────────────────────────────
async function call(method, path, { body, token, quiet } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  out(`→ ${method} ${label(path)}${token ? '  [Bearer ' + short(token) + ']' : '  [sin sesión]'}`);
  if (body) {
    const shown = { ...body };
    if ('password' in shown) shown.password = '********';
    out(`  body: ${label(JSON.stringify(shown))}`);
  }
  if (!quiet) out(`← ${res.status} ${label(json)}`);
  else out(`← ${res.status}`);
  return { status: res.status, body: json };
}

let db;
async function sql(q, params = [], title) {
  const r = await db.query(q, params);
  out(`SQL> ${title ?? q.replace(/\s+/g, ' ').trim()}`);
  if (r.rows.length === 0) out('  (0 filas)');
  for (const row of r.rows) out('  ' + label(JSON.stringify(row)));
  return r.rows;
}
async function sqlError(q, params, title) {
  out(`SQL> ${title ?? q}`);
  try {
    await db.query(q, params);
    out('  (sin error — inesperado)');
  } catch (e) {
    out(`  ERROR: ${e.message}`);
  }
}

async function account(name, display) {
  const email = `${name}.${TS}@evidencia.test`;
  emails.set(email, name);
  const reg = await call('POST', '/users/register', {
    body: { email, password: PASS, displayName: display, adultConfirmed: true, language: 'es-LA' },
    quiet: true,
  });
  ids.set(reg.body.id, name);
  const login = await call('POST', '/auth/login', { body: { email, password: PASS }, quiet: true });
  return { id: reg.body.id, email, token: login.body.accessToken, name };
}
const relogin = async (acc) => {
  acc.token = (await call('POST', '/auth/login', { body: { email: acc.email, password: PASS }, quiet: true })).body.accessToken;
};
const stepUp = async (acc, password = PASS) =>
  (await call('POST', '/auth/step-up', { body: { password }, token: acc.token })).body?.stepUpToken;
const lifecycle = (id) =>
  sql(
    `SELECT type, channel, status, outcome, scope, "verificationMethod",
            "receivedAt", "verifiedAt", "evaluatedAt", "executedAt", "closedAt", "dueAt", "expiresAt",
            details->>'reason' AS reason
       FROM data_rights_requests WHERE id = $1`,
    [id],
    'ciclo de vida registrado de la solicitud',
  );
const auditFor = (ref) =>
  sql(
    `SELECT seq, action, "actorRole", left("actorPseudonym", 12) || '…' AS actor, "resourceType", reason, outcome
       FROM audit_logs WHERE "resourceRef" = $1 ORDER BY seq`,
    [ref],
    'auditoría (seudonimizada) de esa solicitud',
  );

// ── infra ────────────────────────────────────────────────────────────────
const pgServer = new EmbeddedPostgres({
  databaseDir: mkdtempSync(join(tmpdir(), 'mtg-evidence7-pg-')),
  user: 'mtg',
  password: 'mtg',
  port: PG_PORT,
  persistent: false,
  onLog: () => {},
});
await pgServer.initialise();
await pgServer.start();
await pgServer.createDatabase(DB);
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  DATABASE_URL: `postgresql://mtg:mtg@localhost:${PG_PORT}/${DB}?schema=public`,
  JWT_SECRET: randomBytes(32).toString('base64'),
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  PSEUDONYM_KEY: randomBytes(32).toString('base64'),
  EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(SMTP_PORT),
  SECURITY_ALERT_EMAIL: 'seguridad@evidencia.test',
};
execSync('npx prisma migrate deploy --config prisma.config.ts', { stdio: 'ignore', env });
const api = spawn(process.execPath, ['dist/main.js'], { env, stdio: 'ignore' });
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${API}/consents/purposes`)).ok) break;
  } catch {
    /* not up yet */
  }
  await pause(500);
}
db = new pg.Client({ connectionString: env.DATABASE_URL.replace('?schema=public', '') });
await db.connect();

// ── O17 helpers ─────────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
const { AUDIT_EVENTS, isCatalogued } = require('../../dist/common/audit/audit-events.js');
const { PseudonymService } = require('../../dist/common/privacy/pseudonym.service.js');
const ps = new PseudonymService(env.PSEUDONYM_KEY);
const pseuds = new Map(); // pseudonym -> label (added by this script for reading; NOT stored anywhere)
const tagP = (p) => (p ? (pseuds.has(p) ? `${p.slice(0, 10)}…(${pseuds.get(p)})` : p.startsWith('u_') ? `${p.slice(0, 10)}…` : p) : '—');
const track = (acc) => pseuds.set(ps.pseudonymize(acc.id), acc.name);
async function auditRows(where, params, title) {
  const r = await db.query(
    `SELECT seq, to_char("createdAt", 'HH24:MI:SS.MS') AS hora, "actorPseudonym" AS actor, "actorRole" AS rol, action,
            "targetPseudonym" AS target, "resourceType" AS rtype, "resourceRef" AS ref, reason, outcome, hash IS NOT NULL AS encadenada
       FROM audit_logs WHERE ${where} ORDER BY seq`,
    params,
  );
  out(`SQL> ${title}`);
  if (r.rows.length === 0) out('  (0 filas)');
  out('  seq  hora          actor                  rol    acción                         afectado               recurso                 motivo                     resultado');
  for (const x of r.rows) {
    out(
      `  ${String(x.seq).padStart(3)}  ${x.hora}  ${tagP(x.actor).padEnd(22)} ${String(x.rol ?? '—').padEnd(6)} ${x.action.padEnd(30)} ${tagP(x.target).padEnd(22)} ${`${x.rtype ?? ''} ${x.ref ? label(x.ref).slice(0, 13) : ''}`.trim().padEnd(23)} ${label(x.reason ?? '').slice(0, 26).padEnd(26)} ${x.outcome}`,
    );
  }
  return r.rows;
}
const alertsOf = (acc) =>
  db.query(`SELECT id, rule, severity, status, details FROM security_alerts WHERE "subjectPseudonym" = $1 ORDER BY "createdAt"`, [ps.pseudonymize(acc.id)]).then((r) => r.rows);
const uuid = () => crypto.randomUUID();
// Adds "(name)" after each known pseudonym (full or shortened) in a markdown report.
const tagMd = (text) => {
  let t = text;
  for (const [p, n] of pseuds) t = t.replace(new RegExp(`${p.slice(0, 14)}[0-9a-f]*`, 'g'), (m) => `${m} (${n})`);
  return t;
};
const runScript = (script, args) =>
  execSync(`${process.execPath} dist/scripts/${script}.js ${args}`, { env, encoding: 'utf8' });

try {
  const admin = await account('admin', 'Admin Siete'); track(admin);
  const soporte = await account('soporte', 'Soporte Siete'); track(soporte);
  await db.query(`UPDATE users SET role = 'ADMIN' WHERE id = $1`, [admin.id]);
  await db.query(`UPDATE users SET role = 'SUPPORT' WHERE id = $1`, [soporte.id]);

  // ══ 01 — catálogo ═══════════════════════════════════════════════════
  say('1. Campos de cada registro (tabla audit_logs)');
  await sql(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'audit_logs' ORDER BY ordinal_position`, [], 'columnas');
  out('  Qué NO se guarda en ninguna columna: valores de datos personales (correo, alias, ubicación, montos de terceros),');
  out('  contraseñas, tokens, IP. El actor y el afectado son seudónimos HMAC; resourceRef es un id interno; reason es un código.');

  say(`2. Catálogo de eventos auditados (apps/backend/src/common/audit/audit-events.ts) — ${Object.keys(AUDIT_EVENTS).length} acciones + la familia "denied <MÉTODO> <ruta>"`);
  const byCat = {};
  for (const [a, d] of Object.entries(AUDIT_EVENTS)) (byCat[d.category] ??= []).push([a, d]);
  for (const [cat, list] of Object.entries(byCat)) {
    out(`\n  [${cat}]`);
    for (const [a, d] of list) {
      out(`  ${a.padEnd(38)} ${d.kind.padEnd(7)} datos: ${(d.personalData.join(', ') || '—').padEnd(40)} ${d.description}`);
      out(`  ${''.padEnd(38)}         campos variables: ${d.fields}`);
    }
  }
  flush('01_catalogo_eventos.txt', 'Actividad N°7 — 1. Eventos auditados y campos de cada registro');

  // ══ 02 — registro de accesos ═════════════════════════════════════════
  say('0. Preparación: vale vende una carta a bruno (PAID); ambos se registran');
  const vale = await account('vale', 'Vale Vendedora'); track(vale);
  const bruno = await account('bruno', 'Bruno Comprador'); track(bruno);
  const card = await call('POST', '/cards', { body: { title: `Carta Vale ${TS}`, guessedPrice: 15 }, token: vale.token, quiet: true });
  const tx = (await db.query(
    `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 15, 'PAID', 'CASH', now(), now()) RETURNING id`,
    [card.body.id, bruno.id, vale.id],
  )).rows[0].id;
  await call('POST', '/consents/me/LOCATION_DISTANCE', { body: { version: '1' }, token: vale.token, quiet: true });

  say('1. Operaciones concretas sobre datos personales');
  await call('PATCH', '/users/me/location', { body: { lat: -33.4372, lng: -70.6506 }, token: vale.token, quiet: true });
  await call('GET', `/transactions/${tx}`, { token: bruno.token, quiet: true });
  await call('GET', `/transactions/${tx}/receipt`, { token: vale.token, quiet: true });
  await call('GET', '/transactions', { token: vale.token, quiet: true });
  await call('GET', `/users/${vale.id}`, { token: bruno.token, quiet: true });
  await call('GET', `/cards?q=${encodeURIComponent(`Carta Vale ${TS}`)}&lat=-33.45&lng=-70.66`, { token: bruno.token, quiet: true });
  await call('GET', `/cards?q=${encodeURIComponent(`Carta Vale ${TS}`)}&lat=-33.45&lng=-70.66`, { quiet: true });
  out('  (la misma búsqueda SIN sesión no calcula distancias ni deja registro: distanceKm = null)');
  await call('GET', '/admin/users', { token: admin.token, quiet: true });
  await call('GET', `/admin/users/${vale.id}/transactions?reason=${encodeURIComponent('Reclamo de pago del caso SOP-12')}`, { token: soporte.token, quiet: true });

  say('2. Intentos sobre datos ajenos: también quedan, como DENIED');
  const intruso = await account('intruso', 'Intruso'); track(intruso);
  await call('GET', `/transactions/${tx}`, { token: intruso.token });
  await call('GET', `/transactions/${uuid()}/receipt`, { token: intruso.token });

  say('3. Lo que quedó en el registro (quién, qué recurso, de quién — nunca el dato)');
  await auditRows(
    `"actorPseudonym" = ANY($1) AND action NOT LIKE 'auth.%' AND action NOT LIKE 'consent.%'`,
    [[vale, bruno, intruso, admin, soporte].map((a) => ps.pseudonymize(a.id))],
    'filas de esta sección',
  );

  say('4. Comprobación: ningún dato personal en las filas');
  const dump = JSON.stringify((await db.query(`SELECT * FROM audit_logs`)).rows);
  for (const [k, v] of [
    ['correos', [vale, bruno, intruso].map((a) => a.email)],
    ['ids reales de usuario', [vale, bruno, intruso].map((a) => a.id)],
    ['alias', ['Vale Vendedora', 'Bruno Comprador']],
    ['coordenadas', ['-33.43', '-70.65', '-33.45']],
  ]) out(`  ¿aparecen ${k}? ${v.some((x) => dump.includes(x))}`);
  out(`  ¿todas las filas encadenadas (hash)? ${(await db.query(`SELECT bool_and(hash IS NOT NULL) ok FROM audit_logs`)).rows[0].ok}`);
  const actions = (await db.query(`SELECT DISTINCT action FROM audit_logs`)).rows.map((r) => r.action);
  out(`  ¿todas las acciones registradas están en el catálogo? ${actions.every(isCatalogued)} (${actions.length} acciones distintas)`);
  flush('02_registro_accesos.txt', 'Actividad N°7 — 2. Registro de accesos y operaciones sobre datos personales');

  // ══ 03 — protección ══════════════════════════════════════════════════
  say('1. Acceso restringido: solo ADMIN lee el registro y reconstruye incidentes (y leerlo también se audita)');
  await call('GET', '/admin/audit-logs?limit=1', { token: vale.token });
  await call('GET', '/admin/audit-logs?limit=1', { token: soporte.token });
  await call('GET', '/admin/audit-logs?limit=1', { token: admin.token, quiet: true });
  await call('GET', '/admin/security/audit/verify', { token: admin.token });

  say('2. Solo agregar: ni el dueño de la tabla puede editar o borrar (trigger)');
  await sqlError(`UPDATE audit_logs SET reason = 'x' WHERE seq = 1`, [], 'UPDATE');
  await sqlError(`DELETE FROM audit_logs WHERE seq = 1`, [], 'DELETE');
  await sqlError(`TRUNCATE audit_logs`, [], 'TRUNCATE');

  say('3. Plazo de conservación: 730 días por defecto (AUDIT_RETENTION_DAYS), mínimo 365 impuesto por la BD');
  await sqlError(
    `BEGIN; SELECT set_config('app.audit_retention_purge','on',true); SELECT set_config('app.audit_retention_days','730',true); DELETE FROM audit_logs WHERE seq = 1; COMMIT;`,
    [],
    'purga con la marca de retención, pero sobre una fila de hoy → rechazada',
  );
  await db.query('ROLLBACK').catch(() => {});
  out('  Para probar el plazo se insertan 2 filas sintéticas antiguas (100 y 400 días), FUERA de la cadena (hash NULL),');
  out('  marcadas como evidencia de prueba: insertar sí está permitido (solo agregar); lo que se prueba es quién puede borrar.');
  await db.query(
    `INSERT INTO audit_logs (id, "createdAt", "actorPseudonym", action, reason, outcome)
     VALUES (gen_random_uuid(), now() - interval '100 days', 'system', 'incident.snapshot', 'fila sintética de prueba (100 días)', 'ALLOWED'),
            (gen_random_uuid(), now() - interval '400 days', 'system', 'incident.snapshot', 'fila sintética de prueba (400 días)', 'ALLOWED')`,
  );
  await sqlError(
    `BEGIN; SELECT set_config('app.audit_retention_purge','on',true); SELECT set_config('app.audit_retention_days','30',true); DELETE FROM audit_logs WHERE reason = 'fila sintética de prueba (100 días)'; COMMIT;`,
    [],
    'purga pidiendo un plazo de 30 días sobre la fila de 100 días → rechazada (el piso es 365)',
  );
  await db.query('ROLLBACK').catch(() => {});
  await db.query(
    `BEGIN; SELECT set_config('app.audit_retention_purge','on',true); SELECT set_config('app.audit_retention_days','365',true); DELETE FROM audit_logs WHERE reason LIKE 'fila sintética de prueba%' AND "createdAt" < now() - interval '365 days'; COMMIT;`,
  );
  out('SQL> purga con plazo 365 sobre la fila de 400 días → permitida');
  await sql(`SELECT reason, "createdAt" FROM audit_logs WHERE reason LIKE 'fila sintética de prueba%'`, [], 'lo que queda: solo la de 100 días (no venció)');
  out('  En producción la purga la hace únicamente src/scripts/purge-expired-data.ts (al arrancar el contenedor) con AUDIT_RETENTION_DAYS=730,');
  out('  y deja constancia en la propia cadena (audit.retention.purge).');
  await sql(
    `SELECT tgname AS trigger, pg_get_triggerdef(t.oid) AS definicion FROM pg_trigger t WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal`,
    [],
    'triggers de audit_logs',
  );
  out('  Las acciones de seguridad (alertas, contención) y la reconstrucción de incidentes quedan en la misma cadena.');
  flush('03_proteccion.txt', 'Actividad N°7 — 3. Protección de los registros: acceso restringido y conservación');

  // ══ 04 — alertas ═════════════════════════════════════════════════════
  say('1. bazaar.location.triangulation — búsquedas con distancia desde 5 celdas de ~1 km distintas en 10 min');
  const curioso = await account('curioso', 'Curioso'); track(curioso);
  for (const [lat, lng] of [[-33.40, -70.60], [-33.50, -70.60], [-33.45, -70.70], [-33.38, -70.52], [-33.47, -70.55]]) {
    await call('GET', `/cards?q=${encodeURIComponent(`Carta Vale ${TS}`)}&lat=${lat}&lng=${lng}`, { token: curioso.token, quiet: true });
  }
  await auditRows(`"actorPseudonym" = $1 AND action = 'access.location.distance'`, [ps.pseudonymize(curioso.id)], 'lo que registró cada búsqueda (sin coordenadas)');
  out(`  alertas de curioso: ${JSON.stringify((await alertsOf(curioso)).map((a) => [a.rule, a.severity]))}`);
  out('  contención automática: sus sesiones quedaron revocadas →');
  await call('GET', '/transactions', { token: curioso.token });

  say('1b. Control: bruno busca 6 veces desde su casa (misma celda) → sin alerta');
  for (let i = 0; i < 6; i++) await call('GET', `/cards?q=${encodeURIComponent(`Carta Vale ${TS}`)}&lat=${-33.4489 + i * 0.0002}&lng=-70.6693`, { token: bruno.token, quiet: true });
  out(`  alertas de triangulación para bruno: ${(await alertsOf(bruno)).filter((a) => a.rule === 'bazaar.location.triangulation').length}`);

  say('2. transactions.enumeration — 5 lecturas denegadas de transacciones/comprobantes ajenos o inexistentes en 10 min');
  for (let i = 0; i < 3; i++) await call('GET', `/transactions/${uuid()}`, { token: intruso.token, quiet: true });
  out(`  alertas de intruso: ${JSON.stringify((await alertsOf(intruso)).map((a) => [a.rule, a.severity, a.details.events]))}`);

  say('3. admin.reidentification.burst — un ADMIN re-identifica 5 seudónimos en 1 h');
  for (const a of [vale, bruno, intruso, curioso, soporte]) {
    await call('POST', '/admin/pseudonyms/resolve', { body: { pseudonym: ps.pseudonymize(a.id), reason: 'Revisión general sin caso asociado' }, token: admin.token, quiet: true });
  }
  out(`  alertas del admin: ${JSON.stringify((await alertsOf(admin)).map((a) => [a.rule, a.severity]))}`);
  out('  sin contención automática (es personal): decide otro ADMIN; su sesión sigue activa →');
  await call('GET', '/admin/users?limit=1', { token: admin.token, quiet: true });

  say('4. account.takeover.sequence — se demuestra en la simulación (05)');
  out('  Cambio del correo seguido de exportación o supresión en < 1 h. Control: una exportación sin cambio de correo no alerta:');
  const st = await stepUp(bruno);
  await call('POST', '/data-rights/requests', { body: { type: 'ACCESS', stepUpToken: st }, token: bruno.token, quiet: true });
  out(`  alertas de toma de cuenta para bruno: ${(await alertsOf(bruno)).filter((a) => a.rule === 'account.takeover.sequence').length}`);

  say('5. Todas las alertas levantadas en esta sección');
  await sql(`SELECT rule, severity, status, left("subjectPseudonym", 10) || '…' AS sujeto, details FROM security_alerts ORDER BY "createdAt"`, []);
  flush('04_alertas.txt', 'Actividad N°7 — 4. Alertas de acceso anómalo propias del sistema');

  // ══ 05 — simulación ══════════════════════════════════════════════════
  const truth = []; // guion del atacante: lo que realmente pasó, para comparar
  const step = (desc, action, outcome, n = 1) => {
    truth.push({ desc, action, outcome, n, at: new Date().toISOString().slice(11, 23) });
    out(`  [guion ${truth.length}] ${desc}`);
  };
  say('ESCENARIO: toma de la cuenta de "marta" (vendedora) con una contraseña filtrada en otro sitio');
  const marta = await account('marta', 'Marta Vendedora'); track(marta);
  const pedro = await account('pedro', 'Pedro Comprador'); track(pedro);
  const lucia = await account('lucia', 'Lucía'); track(lucia);
  const mcard = await call('POST', '/cards', { body: { title: `Carta Marta ${TS}`, guessedPrice: 30 }, token: marta.token, quiet: true });
  const mtx = (await db.query(
    `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 30, 'PAID', 'CASH', now(), now()) RETURNING id`,
    [mcard.body.id, pedro.id, marta.id],
  )).rows[0].id;
  const lcard = await call('POST', '/cards', { body: { title: `Carta Lucía ${TS}`, guessedPrice: 8 }, token: lucia.token, quiet: true });
  const ltx = (await db.query(
    `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 8, 'PAID', 'CASH', now(), now()) RETURNING id`,
    [lcard.body.id, pedro.id, lucia.id],
  )).rows[0].id;
  await pause(1200);
  const tStart = new Date();
  out(`  (preparación lista; el ataque empieza ${tStart.toISOString()})`);

  say('Fase 1 — el atacante entra');
  await call('POST', '/auth/login', { body: { email: marta.email, password: 'Primavera2025!' }, quiet: true });
  await call('POST', '/auth/login', { body: { email: marta.email, password: 'Primavera2026!' }, quiet: true });
  step('2 contraseñas incorrectas', 'auth.login', 'FAILED', 2);
  const atk = { ...marta };
  atk.token = (await call('POST', '/auth/login', { body: { email: marta.email, password: PASS }, quiet: true })).body.accessToken;
  step('login correcto con la contraseña filtrada', 'auth.login', 'ALLOWED');

  say('Fase 2 — mira las ventas de marta y los datos de sus compradores');
  await call('GET', '/transactions', { token: atk.token, quiet: true });
  step('lista las transacciones de marta', 'access.transaction.list', 'ALLOWED');
  await call('GET', `/transactions/${mtx}`, { token: atk.token, quiet: true });
  step('abre la venta a pedro (ve su alias y el monto)', 'access.transaction.read', 'ALLOWED');
  await call('GET', `/users/${pedro.id}`, { token: atk.token, quiet: true });
  step('mira el perfil de pedro', 'access.profile.read', 'ALLOWED');

  say('Fase 3 — sondea ids para leer compras ajenas (IDOR)');
  await call('GET', `/transactions/${ltx}`, { token: atk.token, quiet: true });
  await call('GET', `/transactions/${ltx}/receipt`, { token: atk.token, quiet: true });
  for (let i = 0; i < 3; i++) await call('GET', `/transactions/${uuid()}`, { token: atk.token, quiet: true });
  step('5 intentos sobre transacciones ajenas o inexistentes (403/404)', 'access.', 'DENIED', 5);

  say('Fase 4 — se queda con la cuenta: cambia el correo');
  const atkEmail = `atacante.${TS}@evidencia.test`;
  emails.set(atkEmail, 'correo-del-atacante');
  let su = await stepUp(atk);
  step('reautenticación (step-up) con la contraseña filtrada', 'auth.step-up', 'ALLOWED');
  await call('POST', '/data-rights/requests', { body: { type: 'RECTIFICATION', rectification: { email: atkEmail }, stepUpToken: su }, token: atk.token, quiet: true });
  step('cambia el correo de la cuenta al suyo', 'data.rectify', 'ALLOWED');
  atk.email = atkEmail;
  atk.token = (await call('POST', '/auth/login', { body: { email: atkEmail, password: PASS }, quiet: true })).body.accessToken;
  step('vuelve a entrar con el correo nuevo', 'auth.login', 'ALLOWED');

  say('Fase 5 — se lleva los datos');
  su = await stepUp(atk);
  const ex = await call('POST', '/data-rights/requests', { body: { type: 'ACCESS', stepUpToken: su }, token: atk.token, quiet: true });
  step('exportación completa de la cuenta', 'data.export', 'ALLOWED');
  out(`  (la exportación salió: ${Object.keys(ex.body.export ?? {}).length} secciones)`);

  say('Fase 6 — el sistema reacciona solo');
  const salerts = await alertsOf(marta);
  out(`  alertas sobre la cuenta de marta: ${JSON.stringify(salerts.map((a) => [a.rule, a.severity, a.status]))}`);
  out('  el token del atacante dejó de servir (revocación automática, en milisegundos):');
  await call('GET', '/data-rights/requests', { token: atk.token });
  step('intento siguiente del atacante', '(401 en el guard: no llega al registro)', '—', 0);
  const takeover = salerts.find((a) => a.rule === 'account.takeover.sequence');
  const avisos = inbox.filter((m) => /seguridad@/.test(m.to)).length;
  out(`  avisos al buzón de seguridad hasta ahora: ${avisos}`);
  const viejo = inbox.find((m) => m.to.includes(marta.email) && /correo de tu cuenta/.test(m.subject));
  out(`  aviso a la dirección ANTERIOR de marta ("${viejo?.subject}"): así se entera la titular real`);

  say('RESPUESTA (plan §5) — ADMIN de turno');
  out('  Paso 1 · triage');
  await call('PATCH', `/admin/security/alerts/${takeover.id}`, { body: { status: 'INVESTIGATING', reason: 'Cambio de correo + exportación; la titular respondió que no fue ella' }, token: admin.token, quiet: true });
  out('  Paso 2 · preservar evidencia ANTES de tocar nada');
  const snap = runScript('incident-snapshot', `--out ${mkdtempSync(join(tmpdir(), 'mtg-incident-'))}`);
  out('  ' + label(snap.trim().split('\n').at(-1)));
  out('  Paso 3 · reconstruir desde el registro (API) — guardado en 05b_linea_de_tiempo_api.md');
  const mdRes = await fetch(`${API}/admin/security/incidents/${takeover.id}/timeline?format=md&hoursBefore=1&hoursAfter=1`, { headers: { Authorization: `Bearer ${admin.token}` } });
  let md = await mdRes.text();
  md = tagMd(md);
  writeFileSync(join(OUT, '05b_linea_de_tiempo_api.md'), label(md));
  const tl = await (await fetch(`${API}/admin/security/incidents/${takeover.id}/timeline?hoursBefore=1&hoursAfter=1`, { headers: { Authorization: `Bearer ${admin.token}` } })).json();
  out(`  HTTP ${mdRes.status} · cadena ${tl.chain.ok ? 'OK' : 'ROTA'} · ${tl.summary.events} eventos · fases ${JSON.stringify(tl.summary.byPhase)}`);
  out(`  categorías de datos tocadas: ${tl.summary.dataCategories.join(', ')}`);
  out(`  otras cuentas afectadas: ${tl.summary.affectedSubjects.map((a) => `${tagP(a.pseudonym)} [${a.actions.join(', ')}]`).join('; ') || 'ninguna'}`);
  out('  Paso 4 · confirmar y contener');
  await call('PATCH', `/admin/security/alerts/${takeover.id}`, { body: { status: 'CONFIRMED', reason: 'Toma de cuenta confirmada: exportación de datos de marta y de sus compradores' }, token: admin.token, quiet: true });
  await call('POST', `/admin/security/users/${marta.id}/disable`, { body: { reason: 'INC-1: cuenta tomada; se deshabilita mientras se devuelve a la titular' }, token: admin.token, quiet: true });
  out('  Paso 5 · identificar a quién notificar (auditado, con motivo)');
  await call('POST', '/admin/pseudonyms/resolve', { body: { pseudonym: ps.pseudonymize(pedro.id), reason: 'INC-1: notificar al comprador afectado (art. 14 sexies)' }, token: admin.token, quiet: true });
  out('  Paso 6 · reconstrucción OFFLINE (sin la API), ya con la contención — guardada en 05c_linea_de_tiempo_offline.md');
  runScript('incident-timeline', `--alert ${takeover.id} --before 1 --after 1 --out ${join(OUT, '05c_linea_de_tiempo_offline.md')}`);
  {
    const p = join(OUT, '05c_linea_de_tiempo_offline.md');
    let t = (await import('node:fs')).readFileSync(p, 'utf8');
    t = tagMd(t);
    writeFileSync(p, label(t));
  }

  say('COMPROBACIÓN — ¿el registro permite reconstruir lo ocurrido? (guion del atacante vs. reconstrucción)');
  const tl2 = await (await fetch(`${API}/admin/security/incidents/${takeover.id}/timeline?hoursBefore=1&hoursAfter=1`, { headers: { Authorization: `Bearer ${admin.token}` } })).json();
  const ev = tl2.events.filter((e) => e.actorPseudonym === ps.pseudonymize(marta.id) && new Date(e.createdAt) >= tStart);
  out('  #  paso del guion                                              acción esperada            resultado  esperado  encontrado  seq');
  let ok = 0;
  let checkable = 0;
  const used = new Set();
  for (const [i, s] of truth.entries()) {
    if (s.n === 0) {
      out(`  ${String(i + 1).padStart(2)} ${s.desc.padEnd(58)} ${s.action}`);
      continue;
    }
    checkable++;
    const hits = ev.filter((e) => !used.has(e.seq) && (s.action.endsWith('.') ? e.action.startsWith(s.action) : e.action === s.action) && e.outcome === s.outcome).slice(0, s.n);
    hits.forEach((h) => used.add(h.seq));
    const good = hits.length === s.n;
    if (good) ok++;
    out(`  ${String(i + 1).padStart(2)} ${s.desc.padEnd(58)} ${s.action.padEnd(26)} ${s.outcome.padEnd(9)}  ${String(s.n).padEnd(8)}  ${String(hits.length).padEnd(10)}  ${hits.map((h) => h.seq).join(',')} ${good ? '✔' : '✘'}`);
  }
  out(`\n  ${ok}/${checkable} pasos del guion reconstruidos desde el registro, en el mismo orden (seq creciente): ${ok === checkable}`);
  const phasesSeen = Object.keys(tl2.summary.byPhase);
  out(`  fases presentes en la reconstrucción: ${phasesSeen.join(', ')}`);
  out(`  acciones fuera del catálogo: ${tl2.summary.uncatalogued.length === 0 ? 'ninguna' : tl2.summary.uncatalogued.join(', ')}`);
  out(`  ¿la reconstrucción por API y la offline coinciden en el número de eventos del ataque? ${tl2.summary.events >= tl.summary.events}`);
  out('\n  Lo que el registro NO puede decir (y por qué): la contraseña usada, el correo del atacante, la IP y el contenido');
  out('  exportado — no se guardan por minimización. El correo nuevo se obtiene de la cuenta (dato vigente), no del registro.');
  flush('05_simulacion_incidente.txt', 'Actividad N°7 — 6. Simulación de un incidente y reconstrucción desde los registros');

  // ══ 06 — correos ═════════════════════════════════════════════════════
  const mails = inbox.filter((m) => !/^Welcome/.test(m.subject));
  say(`Correos de seguridad y avisos recibidos por el SMTP local: ${mails.length} (se omiten los de bienvenida)`);
  for (const m of mails) {
    out(`\n--- Para: ${label(m.to)}\n    Asunto: ${label(m.subject)}`);
    for (const l of m.text.split(/\r?\n/)) if (l.trim()) out(`    ${label(l)}`);
  }
  flush('06_correos_alertas.txt', 'Actividad N°7 — Avisos de alerta al buzón de seguridad y al titular');
} finally {
  await db.end();
  api.kill();
  await pgServer.stop();
  smtp.close();
}
