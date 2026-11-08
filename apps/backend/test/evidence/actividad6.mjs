// Evidencia de funcionamiento — Actividad N°6 (ROADMAP.md O16, issue #150).
//
// Igual que actividad5.mjs: levanta un PostgreSQL 16 desechable, aplica las
// migraciones, arranca el backend COMPILADO (dist/main.js) y recorre por HTTP
// cada mecanismo de derechos con solicitudes concretas, escribiendo en
// <outDir> una transcripción por punto de la actividad: cada petición, la
// respuesta y lo que quedó en la base de datos.
//
// Además levanta un servidor SMTP mínimo (solo escucha en 127.0.0.1) que
// recibe los correos reales que envía el backend — los códigos de
// confirmación del formulario público y las respuestas escritas del art. 11
// — y los transcribe en 08_correos.txt.
//
//   cd apps/backend && npm run build
//   node test/evidence/actividad6.mjs ../../docs/security/evidencia/actividad6 [--keep]
//
// Cuentas nuevas en cada corrida; llaves aleatorias; nada sale de la máquina.
// Los tokens y códigos se truncan al imprimirlos y los ids de usuario se acortan.
import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

pg.types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));

const OUT = resolve(process.argv[2] ?? 'evidencia-actividad6');
const KEEP = process.argv.includes('--keep');
const PG_PORT = 54332;
const API_PORT = 3101;
const SMTP_PORT = 2526;
const API = `http://localhost:${API_PORT}`;
const DB = 'mtg_evidencia6';
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
    `# Generado por apps/backend/test/evidence/actividad6.mjs — ${new Date().toISOString()}`,
    `# Backend compilado (dist/main.js) + PostgreSQL 16 embebido + SMTP local. Tokens y códigos truncados.`,
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
  databaseDir: mkdtempSync(join(tmpdir(), 'mtg-evidence6-pg-')),
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
  PUBLIC_APP_URL: 'http://localhost:5199',
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

try {
  const ana = await account('ana', 'Ana Seis');
  const beto = await account('beto', 'Beto Seis');
  const carla = await account('carla', 'Carla Seis');
  const admin = await account('admin', 'Admin Seis');
  await db.query(`UPDATE users SET role = 'ADMIN' WHERE id = $1`, [admin.id]);

  // ══ 01 — canal y modelo de datos ════════════════════════════════════
  say('1. Canales: dentro de la app (con sesión) y formulario público (sin sesión, art. 11)');
  out('  APP         POST /data-rights/requests               {type, …}  — sesión + step-up según riesgo');
  out('  APP         POST /data-rights/requests/:id/complete  — termina con step-up una solicitud del formulario');
  out('  EMAIL_FORM  POST /data-rights/public-requests        {email, type, purpose?, statement?, requestBlocking?}');
  out('  EMAIL_FORM  POST /data-rights/public-requests/confirm {code}  — código de un solo uso enviado al correo');
  out('  Seguimiento: GET /data-rights/requests (titular) · GET /admin/data-rights/requests (SUPPORT/ADMIN, seudónimos)');
  out('  Controles:   GET /data-rights/controls · DELETE …/objections/:purpose · DELETE …/blocking');

  say('2. Modelo de datos: data_rights_requests (columnas nuevas de O16 marcadas)');
  await sql(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'data_rights_requests' ORDER BY ordinal_position`,
    [],
    'columnas de data_rights_requests',
  );
  await sql(
    `SELECT t.typname AS enum, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS valores
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('data_rights_type','data_rights_status','data_rights_outcome','data_rights_channel',
                          'processing_control_kind','processing_control_status')
      GROUP BY t.typname ORDER BY t.typname`,
    [],
    'tipos, estados, canales',
  );
  await sql(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'processing_controls' ORDER BY ordinal_position`,
    [],
    'columnas de processing_controls (oposiciones y bloqueos vigentes y levantados)',
  );
  await sql(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename IN ('data_rights_requests','processing_controls') ORDER BY tablename, indexname`,
    [],
    'índices (incluye UNIQUE parcial: un control ACTIVO por titular/tipo/alcance)',
  );

  say('3. Una solicitud en la app recorre todas las etapas, cada una con su fecha; plazo legal 30 días');
  const r1 = await call('POST', '/data-rights/requests', {
    body: { type: 'RECTIFICATION', rectification: { language: 'fr' } },
    token: ana.token,
  });
  await lifecycle(r1.body.request.id);

  say('4. Una solicitud del formulario: AWAITING_CONFIRMATION → PENDING_STEP_UP → CLOSED');
  let mark = inbox.length;
  await call('POST', '/data-rights/public-requests', { body: { email: carla.email, type: 'ACCESS' } });
  const rowC = (await db.query(`SELECT id FROM data_rights_requests WHERE "userId" = $1 ORDER BY "receivedAt" DESC LIMIT 1`, [carla.id])).rows[0];
  await lifecycle(rowC.id);
  const code1 = codeIn(await mailFor(carla.email, /Confirma tu solicitud/, mark));
  await call('POST', '/data-rights/public-requests/confirm', { body: { code: code1 } });
  await lifecycle(rowC.id);
  const sc = await stepUp(carla);
  const done = await call('POST', `/data-rights/requests/${rowC.id}/complete`, { body: { stepUpToken: sc }, token: carla.token, quiet: true });
  out(`  (exportación entregada: ${Object.keys(done.body.export ?? {}).length} secciones — ver 03)`);
  await lifecycle(rowC.id);
  await auditFor(rowC.id);

  say('5. Seguimiento del titular y del personal (SUPPORT/ADMIN ven plazos y canal, no identidades)');
  await call('GET', '/data-rights/requests', { token: carla.token, quiet: true });
  const staff = await call('GET', '/admin/data-rights/requests', { token: admin.token, quiet: true });
  for (const r of staff.body.slice(0, 6)) {
    out(`  ${r.type.padEnd(13)} ${r.channel.padEnd(10)} ${r.status.padEnd(15)} ${String(r.outcome).padEnd(9)} sujeto=${String(r.subjectPseudonym).slice(0, 12)}… vence=${r.dueAt} atrasada=${r.overdue}`);
  }
  await call('GET', '/admin/data-rights/requests', { token: ana.token });
  flush('01_canal_y_modelo.txt', 'Actividad N°6 — 1. Canal de solicitudes y modelo de datos de seguimiento');

  // ══ 02 — verificación de identidad / solicitantes no verificados ═════
  say('1. Sin sesión, el canal de la app no recibe nada (401)');
  await call('POST', '/data-rights/requests', { body: { type: 'ACCESS' } });

  say('2. ACCESO con sesión pero sin step-up: se recibe, se registra y se cierra DENEGADA (no entrega datos)');
  const d1 = await call('POST', '/data-rights/requests', { body: { type: 'ACCESS' }, token: beto.token });
  await lifecycle(d1.body.request.id);

  say('3. Step-up con contraseña incorrecta → 401');
  await stepUp(beto, 'no-es-la-clave');

  say('4. El step-up de OTRA cuenta no verifica a beto → DENEGADA');
  const anaToken = await stepUp(ana);
  await call('POST', '/data-rights/requests', { body: { type: 'ACCESS', stepUpToken: anaToken }, token: beto.token });

  say('5. Reutilizar un step-up ya consumido → DENEGADA (UNIQUE en la BD)');
  const bt = await stepUp(beto);
  await call('POST', '/data-rights/requests', { body: { type: 'ACCESS', stepUpToken: bt }, token: beto.token, quiet: true });
  await call('POST', '/data-rights/requests', { body: { type: 'ACCESS', stepUpToken: bt }, token: beto.token });

  say('6. Formulario público: misma respuesta exista o no la cuenta (no permite enumerar correos)');
  mark = inbox.length;
  const ghost = `nadie.${TS}@evidencia.test`;
  emails.set(ghost, 'sin-cuenta');
  const g = await call('POST', '/data-rights/public-requests', { body: { email: ghost, type: 'ERASURE' } });
  const k = await call('POST', '/data-rights/public-requests', { body: { email: beto.email, type: 'ERASURE' } });
  out(`  ¿respuestas idénticas? ${JSON.stringify(g.body) === JSON.stringify(k.body)}`);
  const ghostMail = await mailFor(ghost, /Respuesta/, mark);
  out(`  correo a <correo:sin-cuenta>: "${ghostMail.subject}" — ${label(ghostMail.text.split('\n').find((l) => /No encontramos/.test(l)))}`);
  await sql(
    `SELECT "userId", channel, status, outcome, details->>'reason' AS reason, left("contactPseudonym", 16) || '…' AS "contactPseudonym"
       FROM data_rights_requests WHERE "userId" IS NULL`,
    [],
    'la fila sin cuenta: sin userId y sin el correo, solo un seudónimo HMAC',
  );

  say('7. Solicitud del formulario SIN confirmar: no se ejecuta nada; código falso → 400');
  const bRow = (await db.query(`SELECT id FROM data_rights_requests WHERE "userId" = $1 AND channel = 'EMAIL_FORM'`, [beto.id])).rows[0];
  await lifecycle(bRow.id);
  await call('POST', '/data-rights/public-requests/confirm', { body: { code: 'x'.repeat(43) } });
  await sql(`SELECT count(*)::int AS cuentas_de_beto FROM users WHERE id = $1`, [beto.id], 'beto sigue existiendo');

  say('8. Solo el hash del código se guarda; tras confirmarlo, el código ya no sirve (un solo uso)');
  await sql(`SELECT left("confirmTokenHash", 16) || '…' AS sha256 FROM data_rights_requests WHERE id = $1`, [bRow.id]);
  const code2 = codeIn(await mailFor(beto.email, /Confirma tu solicitud/, mark));
  await call('POST', '/data-rights/public-requests/confirm', { body: { code: code2 } });
  await call('POST', '/data-rights/public-requests/confirm', { body: { code: code2 } });

  say('9. Confirmado el correo, la SUPRESIÓN aún exige la contraseña: completar sin step-up → DENEGADA');
  await call('POST', `/data-rights/requests/${bRow.id}/complete`, { body: { confirmErasure: true }, token: beto.token });
  await lifecycle(bRow.id);
  await sql(`SELECT count(*)::int AS cuentas_de_beto FROM users WHERE id = $1`, [beto.id], 'beto sigue existiendo');

  say('10. Otra cuenta no puede completar la solicitud ajena (404, como si no existiera)');
  await call('POST', '/data-rights/public-requests', { body: { email: ana.email, type: 'ACCESS' } });
  const aRow = (await db.query(`SELECT id FROM data_rights_requests WHERE "userId" = $1 AND channel = 'EMAIL_FORM' ORDER BY "receivedAt" DESC LIMIT 1`, [ana.id])).rows[0];
  await call('POST', '/data-rights/public-requests/confirm', { body: { code: codeIn(await mailFor(ana.email, /Confirma tu solicitud/, mark)) }, quiet: true });
  await call('POST', `/data-rights/requests/${aRow.id}/complete`, { body: {}, token: beto.token });

  say('11. Código vencido (24 h): la solicitud se cierra sin hacer nada');
  mark = inbox.length;
  await call('POST', '/data-rights/public-requests', { body: { email: ana.email, type: 'ERASURE' } });
  const code3 = codeIn(await mailFor(ana.email, /Confirma tu solicitud/, mark));
  await db.query(`UPDATE data_rights_requests SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1 AND status = 'AWAITING_CONFIRMATION'`, [ana.id]);
  out('  (se adelanta "expiresAt" en la BD para simular que pasaron 24 h)');
  await call('POST', '/data-rights/public-requests/confirm', { body: { code: code3 } });

  say('12. Tope por dirección: el 4.º envío en 24 h no crea fila ni envía correo');
  await call('POST', '/data-rights/public-requests', { body: { email: ana.email, type: 'ACCESS' }, quiet: true });
  out('  (3.er envío de ana en 24 h: aceptado)');
  const before = (await db.query(`SELECT count(*)::int n FROM data_rights_requests WHERE "userId" = $1 AND channel = 'EMAIL_FORM'`, [ana.id])).rows[0].n;
  mark = inbox.length;
  await call('POST', '/data-rights/public-requests', { body: { email: ana.email, type: 'ACCESS' } });
  await pause(300);
  const after = (await db.query(`SELECT count(*)::int n FROM data_rights_requests WHERE "userId" = $1 AND channel = 'EMAIL_FORM'`, [ana.id])).rows[0].n;
  out(`  filas EMAIL_FORM de ana: antes=${before} después=${after} · correos nuevos: ${inbox.slice(mark).length}`);
  await sql(`SELECT action, reason, outcome FROM audit_logs WHERE action = 'data.public-request' AND reason = 'throttled'`, [], 'queda auditado (sin el correo)');
  flush('02_verificacion_identidad.txt', 'Actividad N°6 — 2 y 7. Verificación de identidad y solicitantes no verificados');

  // ══ 03 — acceso y portabilidad ══════════════════════════════════════
  say('0. Preparación: beto vende una carta a ana (PAID) y ana publica una carta propia');
  const card = await call('POST', '/cards', { body: { title: `Carta Beto ${TS}`, guessedPrice: 9, description: 'nota privada de beto' }, token: beto.token, quiet: true });
  await db.query(
    `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 9, 'PAID', 'CASH', now(), now())`,
    [card.body.id, ana.id, beto.id],
  );
  await call('POST', '/cards', { body: { title: `Carta Ana ${TS}`, guessedPrice: 4 }, token: ana.token, quiet: true });

  say('1. ACCESO con step-up: JSON estructurado, se entrega una vez y no se guarda');
  const at = await stepUp(ana);
  const exp = await call('POST', '/data-rights/requests', { body: { type: 'ACCESS', stepUpToken: at }, token: ana.token, quiet: true });
  const e = exp.body.export;
  out(`  format=${e.format} version=${e.version}`);
  out(`  secciones: ${Object.keys(e).join(', ')}`);
  writeFileSync(join(OUT, '03_export_ejemplo.json'), label(JSON.stringify(e, null, 2)) + '\n');
  out('  (exportación completa, con ids y correos sustituidos por etiquetas: 03_export_ejemplo.json)');

  say('2. Solo datos de ana: ningún id ni correo de beto; de la contraparte, solo su nombre visible');
  const dump = JSON.stringify({ ...e, notIncluded: undefined, processing: undefined });
  out(`  ¿contiene el id de beto?      ${dump.includes(beto.id)}`);
  out(`  ¿contiene el correo de beto?  ${dump.includes(beto.email)}`);
  out(`  ¿contiene la nota de beto?    ${dump.includes('nota privada de beto')}`);
  out(`  ¿secretos (hash, 2FA, tokens)? ${/passwordHash|twoFactorSecret|tokenHash|paymentRef/.test(dump)}`);
  out(`  contraparte en la transacción: "${e.transactions[0].counterparty}"`);

  say('3. Lo que se excluye a propósito (notIncluded) y la información de tratamiento (processing)');
  for (const n of e.notIncluded) out(`  - ${n.what}: ${n.why}`);
  for (const p of e.processing) out(`  · ${p.purpose} — ${p.legalBasis}`);

  say('4. La solicitud registra solo los nombres de las secciones, no los datos');
  await sql(`SELECT details FROM data_rights_requests WHERE id = $1`, [exp.body.request.id]);
  flush('03_acceso_portabilidad.txt', 'Actividad N°6 — 3. Acceso y portabilidad');

  // ══ 04 — rectificación ══════════════════════════════════════════════
  say('1. Rectificación del nombre visible (basta la sesión): se aplica y queda registrada');
  const rn = await call('POST', '/data-rights/requests', { body: { type: 'RECTIFICATION', rectification: { displayName: 'Ana Corregida' } }, token: ana.token });
  await lifecycle(rn.body.request.id);

  say('2. Registro del cambio: la auditoría guarda QUÉ campo cambió, nunca el valor antiguo ni el nuevo');
  await auditFor(rn.body.request.id);
  await sql(`SELECT count(*)::int AS filas_con_valor FROM audit_logs WHERE reason ILIKE '%Corregida%' OR reason ILIKE '%Ana Seis%'`, [], 'ningún valor en el registro');

  say('3. Propagación: beto ve el nombre corregido en la transacción compartida');
  await sql(
    `SELECT t.status, b."displayName" AS comprador FROM transactions t JOIN users b ON b.id = t."buyerId" WHERE t."sellerId" = $1`,
    [beto.id],
    'el alias se lee por relación en cada consulta: no hay copias que actualizar',
  );

  say('4. Validaciones del registro: un campo no permitido (role) → 400; nada que cambiar → DENEGADA');
  await call('POST', '/data-rights/requests', { body: { type: 'RECTIFICATION', rectification: { role: 'ADMIN' } }, token: ana.token });
  await call('POST', '/data-rights/requests', { body: { type: 'RECTIFICATION', rectification: { displayName: 'Ana Corregida' } }, token: ana.token });

  say('5. Rectificación del correo: exige step-up; se revocan las sesiones y se avisa a la dirección anterior');
  mark = inbox.length;
  const newEmail = `ana.nueva.${TS}@evidencia.test`;
  emails.set(newEmail, 'ana-nuevo');
  const et = await stepUp(ana);
  const re = await call('POST', '/data-rights/requests', { body: { type: 'RECTIFICATION', rectification: { email: newEmail }, stepUpToken: et }, token: ana.token });
  await call('GET', '/data-rights/requests', { token: ana.token });
  const oldMail = await mailFor(ana.email, /correo de tu cuenta/, mark);
  out(`  aviso a la dirección anterior: "${oldMail.subject}"`);
  await auditFor(re.body.request.id);
  ana.email = newEmail;
  await relogin(ana);
  flush('04_rectificacion.txt', 'Actividad N°6 — 4. Rectificación con registro del cambio');

  // ══ 05 — supresión ══════════════════════════════════════════════════
  say('1. Supresión con una compra PENDIENTE → DENEGADA con motivo (art. 7: ejecución de un contrato)');
  const dani = await account('dani', 'Dani Seis');
  const dcard = await call('POST', '/cards', { body: { title: `Carta Dani ${TS}`, guessedPrice: 5 }, token: dani.token, quiet: true });
  const pend = await db.query(
    `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 5, 'PENDING', 'CASH', now(), now()) RETURNING id`,
    [dcard.body.id, carla.id, dani.id],
  );
  let dt = await stepUp(dani);
  await call('POST', '/data-rights/requests', { body: { type: 'ERASURE', confirmErasure: true, stepUpToken: dt }, token: dani.token });

  say('2. Alternativa del art. 8 ter: mientras tanto, dani pide el BLOQUEO en vez de la supresión');
  await call('POST', '/data-rights/requests', {
    body: { type: 'BLOCKING', blocking: { basis: 'ALTERNATIVE_TO_ERASURE' }, statement: 'No puedo borrar la cuenta aún; quiero que dejen de usar mis datos.' },
    token: dani.token,
  });
  await call('DELETE', '/data-rights/controls/blocking', { token: dani.token, quiet: true });
  out('  (dani levanta el bloqueo para seguir con el ejemplo)');

  say('3. Cerrada la compra, la supresión procede: cuenta con transacciones → "lápida" anónima');
  await db.query(`UPDATE transactions SET status = 'PAID' WHERE id = $1`, [pend.rows[0].id]);
  await db.query(`INSERT INTO card_photos (id, "cardId", "storageKey", "createdAt") VALUES (gen_random_uuid(), $1, 'cards/evidencia/foto.jpg', now())`, [dcard.body.id]).catch(() => {});
  dt = await stepUp(dani);
  const er = await call('POST', '/data-rights/requests', { body: { type: 'ERASURE', confirmErasure: true, stepUpToken: dt, statement: 'Ya no uso la aplicación.' }, token: dani.token });
  await lifecycle(er.body.request.id);

  say('4. QUÉ SE ELIMINA: cuenta, ajustes, sesiones, consentimientos, controles, mazos, ofertas, cartas sin venta, fotos');
  await sql(
    `SELECT u.email, u."displayName", u."passwordHash", u."deletedAt" IS NOT NULL AS tombstone,
            (SELECT count(*) FROM user_settings s WHERE s."userId" = u.id)::int AS ajustes,
            (SELECT count(*) FROM refresh_tokens r WHERE r."userId" = u.id)::int AS sesiones,
            (SELECT count(*) FROM consents c WHERE c."userId" = u.id)::int AS consentimientos,
            (SELECT count(*) FROM processing_controls p WHERE p."userId" = u.id)::int AS controles
       FROM users u WHERE u.id = $1`,
    [dani.id],
    'la cuenta de dani después de la supresión',
  );
  await sql(`SELECT title, description, "deckId" FROM cards WHERE "ownerId" = $1`, [dani.id], 'cartas que quedan (solo la vendida, sin la descripción libre)');
  await sql(`SELECT count(*)::int AS fotos FROM card_photos WHERE "cardId" = $1`, [dcard.body.id], 'fotos en la BD (los objetos del bucket se borran tras el commit)');

  say('5. QUÉ SE BLOQUEA POR OBLIGACIÓN LEGAL: la transacción se conserva 6 años (Código Tributario arts. 17 y 200)');
  await sql(`SELECT t.status, t.amount, s."displayName" AS vendedor FROM transactions t JOIN users s ON s.id = t."sellerId" WHERE t."sellerId" = $1`, [dani.id], 'la transacción, apuntando a la lápida');
  await sql(`SELECT type, statement, outcome FROM data_rights_requests WHERE "userId" = $1 ORDER BY "receivedAt"`, [dani.id], 'las solicitudes quedan como prueba de respuesta, sin el texto libre (statement)');

  say('6. CÓMO SE PROPAGA');
  out('  - Misma transacción de BD: cuenta, ajustes, sesiones, consentimientos (+historial), oposiciones/bloqueos, mazos, ofertas, cupones no usados, cartas sin venta.');
  out('  - Sesiones vivas: users.sessionsRevokedAt = now() → todo access token anterior se rechaza:');
  await call('GET', '/data-rights/requests', { token: dani.token });
  out('  - Bucket de fotos (S3/MinIO): se borra después del commit; si falla se cuenta en storageObjectsPendingDeletion:');
  out(`      ${label(JSON.stringify(er.body.request.details))}`);
  out('  - Contrapartes: ven "Cuenta eliminada" en la transacción (lectura por relación, sin copias).');
  out('  - Respaldos: no se editan; al restaurar uno se reaplican las supresiones registradas (plan de incidentes, §4.d de la Actividad 5).');
  out('  - Terceros: el único destinatario es el proveedor de correo, que no conserva perfil; no hay a quién comunicar la supresión (art. 11 inciso final).');
  await auditFor(er.body.request.id);
  flush('05_supresion.txt', 'Actividad N°6 — 5. Supresión: qué se elimina, qué se bloquea por obligación legal y cómo se propaga');

  // ══ 06 — oposición y bloqueo ═════════════════════════════════════════
  say('0. Preparación: 6 ventas pagadas, 6 vendedores y 6 compradores distintos, mismo mes/condición/medio');
  out('  (el informe solo publica una celda con ≥ 5 compradores Y ≥ 5 vendedores distintos — k-anonimato, Actividad 4)');
  const sellers = [];
  const buyers = [];
  for (let i = 1; i <= 6; i++) sellers.push(await account(`vend${i}`, `Vendedor ${i}`));
  for (let i = 1; i <= 6; i++) buyers.push(await account(`comp${i}`, `Comprador ${i}`));
  for (const [i, s] of sellers.entries()) {
    const c = await call('POST', '/cards', { body: { title: `Lote ${s.name} ${TS}`, guessedPrice: 10 }, token: s.token, quiet: true });
    await db.query(
      `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, 10, 'PAID', 'CASH', '2001-01-15', now())`,
      [c.body.id, buyers[i].id, s.id],
    );
  }
  const report = async (title) => {
    const r = await call('GET', '/admin/reports/sales', { token: admin.token, quiet: true });
    const cell = r.body.cells.find((x) => x.month === '2001-01');
    out(`  ${title}: celda 2001-01 → ${cell ? `ventas=${cell.sales} total=${cell.total}` : 'suprimida (menos de 5 vendedores)'} · celdas suprimidas=${r.body.suppressedCells}`);
  };
  await report('informe ANTES');

  say('1. OPOSICIÓN a SALES_STATISTICS (interés legítimo, art. 8 a): sin motivo → 400; con motivo → ATENDIDA');
  const v1 = sellers[0];
  await call('POST', '/data-rights/requests', { body: { type: 'OBJECTION', purpose: 'SALES_STATISTICS' }, token: v1.token });
  const ob = await call('POST', '/data-rights/requests', {
    body: { type: 'OBJECTION', purpose: 'SALES_STATISTICS', statement: 'No quiero que mis ventas se usen en informes.' },
    token: v1.token,
  });
  await lifecycle(ob.body.request.id);
  await report('informe DESPUÉS de la oposición');
  await sql(`SELECT kind, scope, status, "createdAt" FROM processing_controls WHERE "userId" = $1`, [v1.id], 'el control que deja la oposición');

  say('2. Oposición a un tratamiento que no es de interés legítimo → 400 (el consentimiento se revoca, no se "opone")');
  await call('POST', '/data-rights/requests', { body: { type: 'OBJECTION', purpose: 'LOCATION_DISTANCE', statement: 'No quiero compartir ubicación.' }, token: v1.token });

  say('3. OPOSICIÓN a SECURITY_MONITORING → DENEGADA y fundada (motivos legítimos imperiosos, art. 8 a)');
  const od = await call('POST', '/data-rights/requests', {
    body: { type: 'OBJECTION', purpose: 'SECURITY_MONITORING', statement: 'No quiero que registren mis inicios de sesión.' },
    token: v1.token,
  });
  await lifecycle(od.body.request.id);

  say('4. Retirar la oposición: la venta vuelve a contar desde el informe siguiente');
  await call('DELETE', '/data-rights/controls/objections/SALES_STATISTICS', { token: v1.token });
  await report('informe tras retirar');

  say('5. BLOQUEO como alternativa a la supresión (art. 8 ter): sin motivo → 400; con motivo → ATENDIDO en ≤ 2 días hábiles');
  const v2 = sellers[1];
  const v2card = (await call('POST', '/cards', { body: { title: `Vitrina ${TS}`, guessedPrice: 12 }, token: v2.token, quiet: true })).body;
  await call('GET', `/cards?q=${encodeURIComponent(`Vitrina ${TS}`)}`, { quiet: true });
  out(`  antes: la carta aparece en el Bazar (${(await (await fetch(`${API}/cards?q=${encodeURIComponent(`Vitrina ${TS}`)}`)).json()).length} resultado)`);
  await call('POST', '/data-rights/requests', { body: { type: 'BLOCKING', blocking: { basis: 'ALTERNATIVE_TO_ERASURE' } }, token: v2.token });
  const bl = await call('POST', '/data-rights/requests', {
    body: { type: 'BLOCKING', blocking: { basis: 'ALTERNATIVE_TO_ERASURE' }, statement: 'Quiero pausar el uso de mis datos sin borrar la cuenta.' },
    token: v2.token,
  });
  await lifecycle(bl.body.request.id);

  say('6. Efecto del bloqueo en cada tratamiento');
  await call('GET', `/cards?q=${encodeURIComponent(`Vitrina ${TS}`)}`);
  await call('POST', `/cards/${v2card.id}/offers`, { body: { amount: 15 }, token: carla.token });
  await call('POST', '/transactions', { body: { cardId: v2card.id, paymentMethod: 'CASH' }, token: carla.token });
  await call('POST', '/consents/me/LOCATION_DISTANCE', { body: { version: '1' }, token: v2.token, quiet: true });
  await call('PATCH', '/users/me/location', { body: { lat: -33.45, lng: -70.66 }, token: v2.token });
  await report('informe con el vendedor bloqueado');
  await call('GET', `/cards/${v2card.id}`, { quiet: true });
  out('  (la carta sigue almacenada y legible por su id: el bloqueo no afecta el almacenamiento)');
  const ctl = await call('GET', '/data-rights/controls', { token: v2.token, quiet: true });
  out('  lo que cubre / no cubre (mostrado al titular):');
  for (const c of ctl.body.blocking.covers) out(`    + ${c.what} — ${c.how}`);
  for (const c of ctl.body.blocking.notCovered) out(`    − ${c.what} — ${c.why}`);

  say('7. Levantar el bloqueo: todo vuelve a funcionar');
  await call('DELETE', '/data-rights/controls/blocking', { token: v2.token });
  await call('GET', `/cards?q=${encodeURIComponent(`Vitrina ${TS}`)}`, { quiet: true });
  out(`  la carta vuelve al Bazar: ${(await (await fetch(`${API}/cards?q=${encodeURIComponent(`Vitrina ${TS}`)}`)).json()).length} resultado`);
  await call('POST', `/cards/${v2card.id}/offers`, { body: { amount: 15 }, token: carla.token, quiet: true });

  say('8. BLOQUEO mientras se resuelve una solicitud (art. 11): formulario con requestBlocking → se levanta al cerrarla');
  const v3 = sellers[2];
  mark = inbox.length;
  await call('POST', '/data-rights/public-requests', {
    body: { email: v3.email, type: 'RECTIFICATION', statement: 'Mi nombre visible está mal escrito.', requestBlocking: true },
  });
  const cf = await call('POST', '/data-rights/public-requests/confirm', { body: { code: codeIn(await mailFor(v3.email, /Confirma tu solicitud/, mark)) } });
  await sql(`SELECT kind, basis, status, "relatedRequestId" = $2 AS "ligado_a_la_solicitud" FROM processing_controls WHERE "userId" = $1`, [v3.id, cf.body.request.id]);
  await call('POST', `/data-rights/requests/${cf.body.request.id}/complete`, { body: { rectification: { displayName: 'Vendedor Tres' } }, token: v3.token });
  await sql(`SELECT kind, basis, status, "liftReason" FROM processing_controls WHERE "userId" = $1`, [v3.id], 'resuelta la rectificación, el bloqueo se levantó solo');

  say('9. Bloqueo "mientras se resuelve" con una solicitud ya cerrada o ajena → DENEGADO');
  await call('POST', '/data-rights/requests', {
    body: { type: 'BLOCKING', blocking: { basis: 'PENDING_REQUEST', relatedRequestId: cf.body.request.id }, statement: 'Mientras resuelven mi solicitud.' },
    token: v3.token,
  });
  await call('POST', '/data-rights/requests', {
    body: { type: 'BLOCKING', blocking: { basis: 'PENDING_REQUEST', relatedRequestId: rowC.id }, statement: 'Mientras resuelven mi solicitud.' },
    token: v3.token,
  });

  say('10. Integridad en la BD: un control levantado no se reactiva; no puede haber dos activos iguales');
  await sqlError(`UPDATE processing_controls SET status = 'ACTIVE' WHERE "userId" = $1`, [v3.id], 'UPDATE de un control LIFTED → ACTIVE');
  await call('POST', '/data-rights/requests', { body: { type: 'OBJECTION', purpose: 'SALES_STATISTICS', statement: 'Me opongo a las estadísticas.' }, token: v1.token, quiet: true });
  await sqlError(
    `INSERT INTO processing_controls (id, "userId", kind, scope, status, "requestId") VALUES (gen_random_uuid(), $1, 'OBJECTION', 'SALES_STATISTICS', 'ACTIVE', gen_random_uuid())`,
    [v1.id],
    'INSERT de un segundo control ACTIVO igual',
  );

  say('11. Auditoría de oposición y bloqueo (seudonimizada)');
  await sql(
    `SELECT seq, action, reason, outcome FROM audit_logs
      WHERE action IN ('data.object','data.block','data.objection.withdraw','data.blocking.lift') ORDER BY seq`,
    [],
  );
  flush('06_oposicion_bloqueo.txt', 'Actividad N°6 — 6. Oposición y bloqueo');

  // ══ 08 — correos ═════════════════════════════════════════════════════
  const privacy = inbox.filter((m) => !/^Welcome/.test(m.subject));
  say(`Correos de privacidad recibidos por el SMTP local: ${privacy.length} (se omiten ${inbox.length - privacy.length} de bienvenida)`);
  for (const m of privacy) {
    out(`\n--- Para: ${label(m.to)}\n    Asunto: ${label(m.subject)}`);
    for (const l of m.text.split(/\r?\n/)) if (l.trim()) out(`    ${label(l)}`);
  }
  flush('08_correos.txt', 'Actividad N°6 — Respuestas escritas y códigos de confirmación (art. 11)');

  if (KEEP) {
    // Cuenta de demostración para test/evidence/screenshots6.mjs: una
    // oposición vigente, un bloqueo vigente y una solicitud del formulario
    // confirmada que espera el step-up ("Completar").
    const demo = sellers[3];
    await call('POST', '/data-rights/requests', { body: { type: 'OBJECTION', purpose: 'SALES_STATISTICS', statement: 'No quiero aparecer en estadísticas.' }, token: demo.token, quiet: true });
    await call('POST', '/data-rights/requests', { body: { type: 'OBJECTION', purpose: 'SECURITY_MONITORING', statement: 'No quiero que registren mis accesos.' }, token: demo.token, quiet: true });
    await call('POST', '/data-rights/requests', { body: { type: 'BLOCKING', blocking: { basis: 'ALTERNATIVE_TO_ERASURE' }, statement: 'Prefiero pausar mis datos en vez de borrar la cuenta.' }, token: demo.token, quiet: true });
    const m0 = inbox.length;
    await call('POST', '/data-rights/public-requests', { body: { email: demo.email, type: 'ACCESS' }, quiet: true });
    await call('POST', '/data-rights/public-requests/confirm', { body: { code: codeIn(await mailFor(demo.email, /Confirma tu solicitud/, m0)) }, quiet: true });
    const m1 = inbox.length;
    await call('POST', '/data-rights/public-requests', { body: { email: sellers[4].email, type: 'OBJECTION', purpose: 'SALES_STATISTICS', statement: 'No uso la app y no quiero estar en estadísticas.' }, quiet: true });
    const demoCode = codeIn(await mailFor(sellers[4].email, /Confirma tu solicitud/, m1));
    console.log(`\nBackend en ${API} y Postgres en ${PG_PORT} siguen corriendo (Ctrl+C para terminar).`);
    console.log(`Cuenta para capturas: ${demo.email} / ${PASS}`);
    writeFileSync(
      join(tmpdir(), 'mtg-screens6-account.json'),
      JSON.stringify({ email: demo.email, password: PASS, api: API, code: demoCode }),
    );
    await new Promise(() => {});
  }
} finally {
  if (!KEEP) {
    await db.end();
    api.kill();
    await pgServer.stop();
    smtp.close();
  }
}
