// Evidencia de funcionamiento — Actividad N°5 (ROADMAP.md O15, issue #149).
//
// Levanta un PostgreSQL 16 desechable (embedded-postgres, igual que
// `npm run test:e2e:embedded`), aplica las migraciones, arranca el backend
// COMPILADO (dist/main.js) y recorre por HTTP los flujos reales de la
// actividad, escribiendo en <outDir> una transcripción por tema: cada
// petición, la respuesta, y lo que quedó en la base de datos.
//
//   cd apps/backend && npm run build
//   node test/evidence/actividad5.mjs ../../docs/security/evidencia/actividad5 [--keep]
//
// --keep deja backend (puerto 3100) y Postgres corriendo para tomar capturas
// de la app (test/evidence/screenshots.mjs) y los detiene con Ctrl+C.
// Cuentas nuevas en cada corrida; llaves aleatorias; nada sale de la máquina.
// Los tokens se truncan al imprimirlos y los ids de usuario se acortan.
import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

// Prisma stores TIMESTAMP(3) without time zone, in UTC: read it back as UTC
// (pg would otherwise apply this machine's local offset).
pg.types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));

const OUT = resolve(process.argv[2] ?? 'evidencia-actividad5');
const KEEP = process.argv.includes('--keep');
const PG_PORT = 54331;
const API_PORT = 3100;
const API = `http://localhost:${API_PORT}`;
const DB = 'mtg_evidencia';
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
    `# Generado por apps/backend/test/evidence/actividad5.mjs — ${new Date().toISOString()}`,
    `# Backend compilado (dist/main.js) + PostgreSQL 16 embebido. Tokens truncados.`,
  ];
  writeFileSync(join(OUT, file), [...header, ...buf].join('\n') + '\n');
  console.log(`  escrito ${file} (${buf.length} líneas)`);
  buf = [];
}
const short = (t) => (t ? `${String(t).slice(0, 18)}…` : t);
const ids = new Map(); // raw user id -> label, so transcripts show "ana" instead of a UUID
const label = (s) => {
  let text = typeof s === 'string' ? s : JSON.stringify(s, null, 2);
  for (const [id, name] of ids) text = text.split(id).join(`<id:${name}>`);
  return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, (m) => short(m));
};

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
  out(`→ ${method} ${label(path)}${token ? '  [Bearer ' + short(token) + ']' : ''}`);
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
async function sqlError(q, title) {
  out(`SQL> ${title ?? q}`);
  try {
    await db.query(q);
    out('  (sin error — inesperado)');
  } catch (e) {
    out(`  ERROR: ${e.message}`);
  }
}

async function account(name, display) {
  const email = `${name}.${TS}@evidencia.test`;
  const reg = await call('POST', '/users/register', {
    body: { email, password: PASS, displayName: display, adultConfirmed: true, language: 'es-LA' },
    quiet: true,
  });
  ids.set(reg.body.id, name);
  const login = await call('POST', '/auth/login', { body: { email, password: PASS }, quiet: true });
  return { id: reg.body.id, email, token: login.body.accessToken, user: login.body.user };
}
const stepUp = async (acc, password = PASS) =>
  (await call('POST', '/auth/step-up', { body: { password }, token: acc.token })).body.stepUpToken;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ── infra ────────────────────────────────────────────────────────────────
const pgServer = new EmbeddedPostgres({
  databaseDir: mkdtempSync(join(tmpdir(), 'mtg-evidence-pg-')),
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
  SMTP_PORT: '1', // no mail server here: emails fail fast and are only logged (masked)
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
  // ══ 03 — consentimiento ═══════════════════════════════════════════════
  say('1. Registro: una cuenta nueva no tiene ningún consentimiento (nada pre-marcado)');
  const ana = await account('ana', 'Ana Evidencia');
  await call('GET', '/consents/me', { token: ana.token });
  await sql(
    `SELECT "notifyByEmail", "shareLocation", "lastLat" FROM user_settings WHERE "userId" = $1`,
    [ana.id],
    'user_settings de ana (correos opcionales y ubicación apagados por defecto)',
  );

  say('2. Finalidades: el texto exacto, su versión y su hash son públicos (informado antes de decidir)');
  const purposes = (await call('GET', '/consents/purposes', { quiet: true })).body;
  for (const p of purposes) {
    out(`  ${p.code} v${p.version} selfService=${p.selfService} sha256=${p.textHash.slice(0, 16)}…`);
    out(`    "${p.text}"`);
  }

  say('3. Sin consentimiento, guardar la ubicación se rechaza (403) y no se guarda nada');
  await call('PATCH', '/users/me/location', { body: { lat: -33.4489, lng: -70.6693 }, token: ana.token });

  say('4. Aceptar un texto desactualizado se rechaza (409)');
  await call('POST', '/consents/me/LOCATION_DISTANCE', { body: { version: '7' }, token: ana.token });

  say('5. Otorgar LOCATION_DISTANCE (versión vigente) — EMAIL_NOTIFICATIONS sigue sin otorgar');
  await call('POST', '/consents/me/LOCATION_DISTANCE', { body: { version: '1' }, token: ana.token });
  const mine = (await call('GET', '/consents/me', { token: ana.token, quiet: true })).body;
  for (const c of mine) out(`  ${c.purpose}: status=${c.status} effective=${c.effective}`);

  say('6. Con consentimiento, la ubicación se acepta (redondeada y cifrada en la BD)');
  await call('PATCH', '/users/me/location', { body: { lat: -33.4489, lng: -70.6693 }, token: ana.token, quiet: true });
  await sql(
    `SELECT "shareLocation", left("lastLat", 28) || '…' AS "lastLat_cifrado", "locationUpdatedAt" FROM user_settings WHERE "userId" = $1`,
    [ana.id],
  );

  say('7. Otorgar EMAIL_NOTIFICATIONS: refleja notifyByEmail = true');
  await call('POST', '/consents/me/EMAIL_NOTIFICATIONS', { body: { version: '1' }, token: ana.token, quiet: true });
  await sql(`SELECT "notifyByEmail" FROM user_settings WHERE "userId" = $1`, [ana.id]);

  say('8. Revocar LOCATION_DISTANCE: se registra la fecha y las coordenadas se borran en la misma transacción');
  await call('DELETE', '/consents/me/LOCATION_DISTANCE', { token: ana.token });
  await sql(
    `SELECT "shareLocation", "lastLat", "lastLng", "locationUpdatedAt" FROM user_settings WHERE "userId" = $1`,
    [ana.id],
  );
  say('9. Tras revocar, el proceso dependiente vuelve a quedar bloqueado');
  await call('PATCH', '/users/me/location', { body: { lat: 1, lng: 1 }, token: ana.token });

  say('10. TWO_FACTOR no se puede alternar con una sesión: tiene su propio flujo (exige código TOTP)');
  await call('DELETE', '/consents/me/TWO_FACTOR', { token: ana.token });

  say('11. Historial de cambios (GET /consents/me/history)');
  await call('GET', '/consents/me/history', { token: ana.token });

  say('12. Lo que guarda la BD: estado actual + historial; sin IP ni huella del dispositivo');
  await sql(
    `SELECT purpose, version, status, "grantedAt", "revokedAt" FROM consents WHERE "userId" = $1 ORDER BY purpose`,
    [ana.id],
  );
  await sql(
    `SELECT c.purpose, e.action, e.version, left(e."textHash", 16) || '…' AS "textHash", e.source, e."createdAt"
       FROM consent_events e JOIN consents c ON c.id = e."consentId" WHERE c."userId" = $1 ORDER BY e."createdAt"`,
    [ana.id],
  );
  say('13. El historial no se puede reescribir, ni siquiera directo en la BD (trigger)');
  await sqlError(`UPDATE consent_events SET action = 'GRANTED'`);
  flush('03_flujo_consentimiento.txt', 'Actividad N°5 — Registro, consulta y revocación del consentimiento');

  // ══ 04 — derechos ═════════════════════════════════════════════════════
  say('0. Preparación: ana compró una carta a bruno (transacción PAID)');
  const bruno = await account('bruno', 'Bruno Vendedor');
  const card = await call('POST', '/cards', {
    body: { title: `Carta Evidencia ${TS}`, guessedPrice: 12, description: 'notas privadas de bruno' },
    token: bruno.token,
    quiet: true,
  });
  await db.query(
    `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, 12, 'PAID', 'CASH', now())`,
    [card.body.id, ana.id, bruno.id],
  );

  say('1. ACCESO sin verificar identidad: se recibe, se registra y se cierra DENEGADA (no entrega datos)');
  await call('POST', '/data-rights/requests', { body: { type: 'ACCESS' }, token: ana.token });

  say('2. Step-up con contraseña incorrecta → 401 (y queda auditado)');
  await call('POST', '/auth/step-up', { body: { password: 'no-es-la-clave' }, token: ana.token });

  say('3. Step-up correcto → token de 5 minutos, de un solo uso');
  const tok = await stepUp(ana);

  say('4. ACCESO con step-up: recorre todas las etapas y entrega un JSON estructurado');
  const access = await call('POST', '/data-rights/requests', {
    body: { type: 'ACCESS', stepUpToken: tok },
    token: ana.token,
    quiet: true,
  });
  out(`  request: ${label(access.body.request)}`);
  const exp = access.body.export;
  out(`  export.format=${exp.format} version=${exp.version}; secciones: ${Object.keys(exp).join(', ')}`);
  out(`  export.account: ${label(exp.account)}`);
  out(`  export.transactions: ${label(exp.transactions)}`);
  out(`  export.notIncluded: ${label(exp.notIncluded.map((n) => n.what))}`);
  const dump = JSON.stringify({ ...exp, notIncluded: undefined, processing: undefined });
  out(
    `  Verificación — el export NO contiene: passwordHash=${dump.includes('passwordHash')}, twoFactorSecret=${dump.includes('twoFactorSecret')}, ` +
      `correo de bruno=${dump.includes(bruno.email)}, id de bruno=${dump.includes(bruno.id)}, notas de bruno=${dump.includes('notas privadas')}`,
  );
  await sql(
    `SELECT type, status, outcome, "verificationMethod", details FROM data_rights_requests WHERE id = $1`,
    [access.body.request.id],
    'la solicitud guarda solo los nombres de las secciones, nunca la exportación',
  );

  say('5. Reutilizar el mismo step-up → DENEGADA (STEP_UP_REUSED, restricción UNIQUE en la BD)');
  await call('POST', '/data-rights/requests', { body: { type: 'ACCESS', stepUpToken: tok }, token: ana.token });

  say('6. RECTIFICACIÓN del nombre visible: basta la sesión (bajo riesgo)');
  await call('POST', '/data-rights/requests', {
    body: { type: 'RECTIFICATION', rectification: { displayName: 'Ana Corregida' } },
    token: ana.token,
  });
  say('7. RECTIFICACIÓN con datos inválidos → 400 (mismas reglas que el registro)');
  await call('POST', '/data-rights/requests', {
    body: { type: 'RECTIFICATION', rectification: { displayName: 'escríbeme a ana@gmail.com' } },
    token: ana.token,
  });
  await call('POST', '/data-rights/requests', {
    body: { type: 'RECTIFICATION', rectification: { role: 'ADMIN' } },
    token: ana.token,
  });
  say('8. RECTIFICACIÓN del correo sin step-up → DENEGADA; con step-up → aplicada y sesiones revocadas');
  const newEmail = `ana.nueva.${TS}@evidencia.test`;
  await call('POST', '/data-rights/requests', {
    body: { type: 'RECTIFICATION', rectification: { email: newEmail } },
    token: ana.token,
  });
  await call('POST', '/data-rights/requests', {
    body: { type: 'RECTIFICATION', stepUpToken: await stepUp(ana), rectification: { email: newEmail } },
    token: ana.token,
  });
  await pause(1100);
  out('  (el access token anterior de ana, emitido antes del cambio:)');
  await call('GET', '/consents/me', { token: ana.token });
  await sql(`SELECT email, "displayName", "emailVerifiedAt", "sessionsRevokedAt" FROM users WHERE id = $1`, [ana.id]);
  ana.email = newEmail;
  ana.token = (await call('POST', '/auth/login', { body: { email: newEmail, password: PASS }, quiet: true })).body.accessToken;
  say('9. La corrección se propaga: bruno ve el nuevo nombre en la transacción compartida');
  await sql(
    `SELECT t.status, b."displayName" AS comprador FROM transactions t JOIN users b ON b.id = t."buyerId" WHERE t."sellerId" = $1`,
    [bruno.id],
  );

  say('10. SUPRESIÓN con una compra PENDIENTE → DENEGADA con motivo (art. 7 ii: ejecución de un contrato)');
  const carla = await account('carla', 'Carla Pendiente');
  const card2 = await call('POST', '/cards', { body: { title: `Pendiente ${TS}`, guessedPrice: 3 }, token: bruno.token, quiet: true });
  await db.query(
    `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, 3, 'PENDING', 'CASH', now())`,
    [card2.body.id, carla.id, bruno.id],
  );
  await call('POST', '/data-rights/requests', {
    body: { type: 'ERASURE', confirmErasure: true, stepUpToken: await stepUp(carla) },
    token: carla.token,
  });

  say('11. SUPRESIÓN sin transacciones → la cuenta desaparece; la solicitud (prueba de respuesta) queda');
  const diego = await account('diego', 'Diego SinCompras');
  await call('POST', '/cards', { body: { title: `Diego ${TS}`, guessedPrice: 1 }, token: diego.token, quiet: true });
  const delReq = await call('POST', '/data-rights/requests', {
    body: { type: 'ERASURE', confirmErasure: true, stepUpToken: await stepUp(diego) },
    token: diego.token,
  });
  await sql(`SELECT count(*) AS filas_usuario FROM users WHERE id = $1`, [diego.id]);
  await sql(`SELECT count(*) AS cartas FROM cards WHERE "ownerId" = $1`, [diego.id]);
  await sql(`SELECT type, status, outcome, "closedAt" FROM data_rights_requests WHERE id = $1`, [delReq.body.request.id]);
  await call('GET', '/consents/me', { token: diego.token });

  say('12. SUPRESIÓN con compras cerradas → "lápida" anónima (las transacciones se conservan 6 años, DL 830)');
  await call('POST', '/data-rights/requests', {
    body: { type: 'ERASURE', confirmErasure: true, stepUpToken: await stepUp(ana) },
    token: ana.token,
  });
  await sql(
    `SELECT email, "displayName", left("passwordHash", 8) AS "passwordHash", "deletedAt" IS NOT NULL AS borrada,
            (SELECT count(*) FROM user_settings s WHERE s."userId" = u.id) AS settings,
            (SELECT count(*) FROM consents c WHERE c."userId" = u.id) AS consentimientos,
            (SELECT count(*) FROM transactions t WHERE t."buyerId" = u.id) AS transacciones
       FROM users u WHERE id = $1`,
    [ana.id],
  );
  await call('POST', '/auth/login', { body: { email: newEmail, password: PASS } });

  say('13. Seguimiento: el titular ve sus solicitudes; SUPPORT ve plazos con seudónimos (USER → 403)');
  await call('GET', '/data-rights/requests', { token: bruno.token });
  const sofia = await account('sofia', 'Sofía Soporte');
  await db.query(`UPDATE users SET role = 'SUPPORT' WHERE id = $1`, [sofia.id]);
  await call('GET', '/admin/data-rights/requests', { token: bruno.token });
  const staff = await call('GET', '/admin/data-rights/requests', { token: sofia.token, quiet: true });
  for (const r of staff.body.slice(0, 8)) {
    out(`  ${r.type.padEnd(13)} ${r.status} ${String(r.outcome).padEnd(9)} ${String(r.reason ?? '').padEnd(22)} sujeto=${r.subjectPseudonym} plazo=${r.dueAt} vencida=${r.overdue}`);
  }

  say('14. Todas las solicitudes de la corrida: estado y fecha de cada etapa');
  await sql(
    `SELECT type, outcome, details->>'reason' AS motivo, "verificationMethod" AS verif,
            to_char("receivedAt",'HH24:MI:SS.MS') rec, to_char("verifiedAt",'HH24:MI:SS.MS') ver,
            to_char("evaluatedAt",'HH24:MI:SS.MS') eval, to_char("executedAt",'HH24:MI:SS.MS') ejec,
            to_char("closedAt",'HH24:MI:SS.MS') cierre, ("dueAt" - "receivedAt") AS plazo
       FROM data_rights_requests ORDER BY "receivedAt"`,
  );
  flush('04_flujo_derechos.txt', 'Actividad N°5 — Acceso/portabilidad, rectificación y supresión');

  // ══ 06 — detección y contención (antes de 05, para que el log lo incluya) ═
  const admin = await account('admin', 'Admin Seguridad');
  await db.query(`UPDATE users SET role = 'ADMIN' WHERE id = $1`, [admin.id]);
  const eva = await account('eva', 'Eva Atacada');

  say('1. Fuerza bruta: 5 contraseñas incorrectas contra la cuenta de eva');
  for (let i = 1; i <= 5; i++) {
    const r = await call('POST', '/auth/login', { body: { email: eva.email, password: `intento-${i}` }, quiet: true });
    out(`  intento ${i}: ${r.status}`);
  }
  say('2. Alerta automática + bloqueo de 15 min: ni la contraseña correcta entra (mismo 401 genérico)');
  await call('POST', '/auth/login', { body: { email: eva.email, password: PASS } });
  await sql(`SELECT rule, severity, status, "subjectPseudonym", details FROM security_alerts ORDER BY "createdAt"`);
  await sql(`SELECT "lockedUntil" > now() AS bloqueada FROM users WHERE id = $1`, [eva.id]);

  say('3. Login con un correo que no existe: se audita como "anonymous", sin guardar el correo');
  await call('POST', '/auth/login', { body: { email: `no.existe.${TS}@evidencia.test`, password: 'x12345678' } });

  say('4. Sondeo de rutas de administración por un USER → 403 auditados → alerta access.denied.burst');
  for (let i = 0; i < 5; i++) await call('GET', '/admin/audit-logs', { token: bruno.token, quiet: true });

  say('5. Sesión robada: 3 step-up fallidos → alerta + todas las sesiones revocadas');
  const franco = await account('franco', 'Franco Robado');
  for (let i = 0; i < 3; i++) await call('POST', '/auth/step-up', { body: { password: `adivina-${i}` }, token: franco.token, quiet: true });
  await pause(1100);
  await call('GET', '/consents/me', { token: franco.token });

  say('6. Triage del ADMIN: alerta → evento sospechoso → incidente confirmado');
  const alerts = (await call('GET', '/admin/security/alerts', { token: admin.token, quiet: true })).body;
  for (const a of alerts) out(`  ${a.id.slice(0, 8)} ${a.rule.padEnd(24)} ${a.severity.padEnd(6)} ${a.status}`);
  const brute = alerts.find((a) => a.rule === 'auth.bruteforce');
  await call('PATCH', `/admin/security/alerts/${brute.id}`, {
    body: { status: 'CLOSED', reason: 'intento de saltarse el análisis' },
    token: admin.token,
  });
  await call('PATCH', `/admin/security/alerts/${brute.id}`, {
    body: { status: 'INVESTIGATING', reason: 'revisando intentos contra la cuenta' },
    token: admin.token,
  });
  await call('PATCH', `/admin/security/alerts/${brute.id}`, {
    body: { status: 'CONFIRMED', reason: 'patrón de diccionario confirmado, ticket INC-1' },
    token: admin.token,
  });

  say('7. Contención manual (solo ADMIN, con motivo): SUPPORT → 403; sin motivo → 400');
  await call('POST', `/admin/security/users/${eva.id}/disable`, { body: { reason: 'intento sin permiso' }, token: sofia.token });
  await call('POST', `/admin/security/users/${eva.id}/disable`, { body: {}, token: admin.token });
  await call('POST', `/admin/security/users/${eva.id}/disable`, { body: { reason: 'INC-1: cuenta bajo ataque' }, token: admin.token });
  await call('POST', `/admin/security/users/${eva.id}/revoke-sessions`, { body: { reason: 'INC-1: cerrar sesiones abiertas' }, token: admin.token });
  await pause(1100);
  out('  (token de eva emitido antes de la contención:)');
  await call('GET', '/consents/me', { token: eva.token });
  say('8. Recuperación: el ADMIN rehabilita (levanta también el bloqueo) y eva vuelve a entrar');
  await call('POST', `/admin/security/users/${eva.id}/enable`, { body: { reason: 'INC-1: titular verificado, clave cambiada' }, token: admin.token });
  await call('POST', '/auth/login', { body: { email: eva.email, password: PASS }, quiet: true });
  await call('POST', `/admin/security/users/${admin.id}/disable`, { body: { reason: 'auto-contención de prueba' }, token: admin.token });

  say('9. Preservación de evidencia ANTES de contener: snapshot con manifiesto SHA-256');
  const snapDir = mkdtempSync(join(tmpdir(), 'mtg-incident-'));
  out(execSync(`node dist/scripts/incident-snapshot.js --out "${snapDir}"`, { env, encoding: 'utf8' }).replace(snapDir, '<tmp>'));
  say('10. Contención global (JWT_SECRET filtrado): revocar TODAS las sesiones');
  out(execSync('node dist/scripts/revoke-all-sessions.js --confirm', { env, encoding: 'utf8' }));
  await pause(1100);
  await call('GET', '/consents/me', { token: bruno.token });
  admin.token = (await call('POST', '/auth/login', { body: { email: admin.email, password: PASS }, quiet: true })).body.accessToken;
  sofia.token = (await call('POST', '/auth/login', { body: { email: sofia.email, password: PASS }, quiet: true })).body.accessToken;
  flush('06_deteccion_contencion.txt', 'Actividad N°5 — Detección de eventos sospechosos, contención y recuperación');

  // ══ 05 — auditoría ════════════════════════════════════════════════════
  say('1. Eventos generados durante las corridas anteriores (registro completo, en orden)');
  await sql(
    `SELECT seq, to_char("createdAt",'HH24:MI:SS.MS') hora, "actorPseudonym" actor, "actorRole" rol, action,
            "targetPseudonym" objetivo, "resourceType" recurso, left("resourceRef", 18) ref, reason, outcome,
            left("prevHash", 10) prev, left(hash, 10) hash
       FROM audit_logs ORDER BY seq`,
    [],
    'audit_logs (seudonimizado, encadenado)',
  );
  say('2. Lo que NO está en el log: correos, ids de usuario, tokens, contraseñas');
  const all = JSON.stringify((await db.query('SELECT * FROM audit_logs')).rows);
  const users = (await db.query('SELECT id, email FROM users')).rows;
  out(`  filas revisadas: ${(await db.query('SELECT count(*) FROM audit_logs')).rows[0].count}`);
  out(`  contiene algún correo (@): ${/@/.test(all)}`);
  out(`  contiene algún id de usuario real: ${users.some((u) => all.includes(u.id))}`);
  out(`  contiene algún JWT (eyJ…): ${/eyJ[\w-]+\./.test(all)}`);
  out(`  contiene "${PASS}": ${all.includes(PASS)}`);
  say('3. Verificación de integridad de la cadena (GET /admin/security/audit/verify)');
  await call('GET', '/admin/security/audit/verify', { token: admin.token });
  say('4. Manipulación detectada: alguien con acceso de dueño desactiva el trigger y edita una fila');
  const victim = (await db.query(`SELECT id, seq, reason FROM audit_logs WHERE action = 'auth.login' AND outcome = 'FAILED' ORDER BY seq LIMIT 1`)).rows[0];
  await db.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update_delete');
  await db.query(`UPDATE audit_logs SET outcome = 'ALLOWED' WHERE id = $1`, [victim.id]);
  await db.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update_delete');
  out(`  (fila seq=${victim.seq}: outcome FAILED → ALLOWED, "borrando" un intento fallido)`);
  await call('GET', '/admin/security/audit/verify', { token: admin.token });
  await sql(`SELECT rule, severity, status, details FROM security_alerts WHERE rule = 'audit.chain.broken'`);
  await db.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update_delete');
  await db.query(`UPDATE audit_logs SET outcome = 'FAILED' WHERE id = $1`, [victim.id]);
  await db.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update_delete');
  out('  (restaurado el valor original)');
  await call('GET', '/admin/security/audit/verify', { token: admin.token });
  say('5. Protección en la BD: UPDATE/DELETE/TRUNCATE rechazados para cualquier conexión');
  await sqlError(`UPDATE audit_logs SET reason = 'x'`);
  await sqlError(`DELETE FROM audit_logs`);
  await sqlError(`TRUNCATE audit_logs`);
  say('6. Retención: solo la tarea de purga borra, y solo filas más antiguas que el plazo');
  await db.query(
    `INSERT INTO audit_logs (id, "actorPseudonym", "actorRole", action, outcome, "createdAt")
     VALUES (gen_random_uuid()::text, 'u_0000000000000000', 'USER', 'evidencia.fila-antigua', 'ALLOWED', now() - interval '800 days')`,
  );
  await sqlError(`DELETE FROM audit_logs WHERE action = 'evidencia.fila-antigua'`, 'DELETE directo de una fila de 800 días (sin la marca de la tarea)');
  await sqlError(
    `BEGIN; SELECT set_config('app.audit_retention_purge','on',true); DELETE FROM audit_logs WHERE action = 'auth.login'; COMMIT;`,
    'con la marca de la tarea, pero filas de hoy',
  );
  await db.query('ROLLBACK').catch(() => {});
  out(execSync('node dist/scripts/purge-expired-data.js', { env, encoding: 'utf8' }));
  await sql(`SELECT count(*) AS antiguas FROM audit_logs WHERE action = 'evidencia.fila-antigua'`);
  await sql(`SELECT action, reason FROM audit_logs WHERE action = 'audit.retention.purge'`);
  await call('GET', '/admin/security/audit/verify', { token: admin.token });
  say('7. Quién puede leer el log: solo ADMIN (SUPPORT y USER → 403, y el intento queda auditado)');
  await call('GET', '/admin/audit-logs?limit=3', { token: sofia.token });
  await call('GET', '/admin/audit-logs?limit=3', { token: admin.token });
  flush('05_eventos_auditoria.txt', 'Actividad N°5 — Registro de auditoría: eventos reales, integridad y retención');

  // ══ 07 — esquema ══════════════════════════════════════════════════════
  for (const t of ['consents', 'consent_events', 'data_rights_requests', 'security_alerts', 'audit_logs']) {
    await sql(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [t],
      `columnas de ${t}`,
    );
  }
  await sql(
    `SELECT event_object_table AS tabla, trigger_name, string_agg(event_manipulation, ',') AS eventos
       FROM information_schema.triggers WHERE event_object_table IN ('audit_logs','consent_events')
      GROUP BY 1,2 ORDER BY 1,2`,
    [],
    'triggers de protección',
  );
  await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('deletedAt','disabledAt','sessionsRevokedAt','lockedUntil')`, [], 'estado de cuenta (users)');
  flush('07_modelo_datos.txt', 'Actividad N°5 — Modelo de datos (tablas nuevas, columnas y triggers)');

  if (KEEP) {
    console.log(`\nBackend en ${API} y Postgres en ${PG_PORT} siguen corriendo (Ctrl+C para terminar).`);
    console.log(`Cuenta para capturas: ${bruno.email} / ${PASS}`);
    writeFileSync(
      join(tmpdir(), 'mtg-screens-account.json'),
      JSON.stringify({ email: bruno.email, password: PASS, api: API }),
    );
    await new Promise(() => {});
  }
} finally {
  if (!KEEP) {
    await db.end();
    api.kill();
    await pgServer.stop();
  }
}
