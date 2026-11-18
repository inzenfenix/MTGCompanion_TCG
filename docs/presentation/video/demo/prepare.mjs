// Prepara los datos de prueba para grabar las demos del video (ROADMAP.md O18).
//
// Requiere el entorno local levantado (Postgres + MailHog + MinIO, backend en :3000)
// y la BD recién sembrada (`npm run db:seed` + `npm run db:import-catalog`).
//
//   node docs/presentation/video/demo/prepare.mjs <dir-de-trabajo>
//
// Solo cuentas ficticias @example.com. Escribe <dir>/demo-state.json con ids y
// correos (nunca tokens ni llaves). La contraseña de demo es de desarrollo.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '../../../../apps/backend');
const require = createRequire(join(BACKEND, 'package.json'));
const pg = require('pg');
const bcrypt = require('bcryptjs');
const otplib = require('otplib');

const OUT = resolve(process.argv[2] ?? '.');
mkdirSync(OUT, { recursive: true });
const API = process.env.API ?? 'http://localhost:3000';
const PASS = process.env.DEMO_PASSWORD ?? 'DemoMTG-2026!';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://mtg:mtg@localhost:5432/mtg_companion' });
await db.connect();

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return json;
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: PASS } })).accessToken;

const state = { api: API, users: {}, cards: {}, tx: {} };
const users = state.users;

// 1. Sacar del entorno de demo la cuenta "easter egg" del seed (dominio no @example.com).
await db.query(`DELETE FROM users WHERE email NOT LIKE '%@example.com'`).catch((e) => console.warn('  (no se borró la cuenta extra:', e.message, ')'));

// 2. Mismas credenciales de demo para las cuentas del seed.
const hash = await bcrypt.hash(PASS, 12);
await db.query(`UPDATE users SET "passwordHash" = $1 WHERE email LIKE '%@example.com'`, [hash]);
for (const r of (await db.query(`SELECT id, email, "displayName", role FROM users`)).rows) {
  users[r.email.split('@')[0]] = { id: r.id, email: r.email, name: r.displayName, role: r.role };
}

// 3. Cuentas nuevas del guion.
for (const [key, name] of [['marta', 'Marta'], ['pedro', 'Pedro'], ['dani', 'Dani'], ['bruno', 'Bruno'], ['sofia', 'Sofía'], ['eva', 'Eva']]) {
  const email = `${key}@example.com`;
  const reg = await call('POST', '/users/register', { body: { email, password: PASS, displayName: name, adultConfirmed: true, language: 'es-LA' } });
  users[key] = { id: reg.id, email, name, role: 'USER' };
}
const tok = {};
for (const k of Object.keys(users)) tok[k] = await login(users[k].email);

// 4. Ubicación con consentimiento (Santiago, comunas distintas) para vendedores del Bazar.
const places = { marta: [-33.4372, -70.6506], ana: [-33.4255, -70.6111], carlos: [-33.4569, -70.5980], mateo: [-33.5013, -70.6168], valentina: [-33.4110, -70.5755], lucia: [-33.4489, -70.6693] };
for (const [k, [lat, lng]] of Object.entries(places)) {
  await call('POST', '/consents/me/LOCATION_DISTANCE', { body: { version: '1' }, token: tok[k] });
  await call('PATCH', '/users/me/location', { body: { lat, lng }, token: tok[k] });
}

// 5. Ventas pagadas en una misma celda del reporte (mes × NM × efectivo):
//    6 vendedores distintos → 6 compradores distintos (k = 5 se cumple).
const pairs = [['marta', 'pedro'], ['ana', 'bruno'], ['carlos', 'dani'], ['lucia', 'sofia'], ['mateo', 'test'], ['valentina', 'buyer']];
const soldTitles = ['Lightning Bolt', 'Counterspell', 'Llanowar Elves', 'Swords to Plowshares', 'Dark Ritual', 'Brainstorm'];
for (const [i, [seller, buyer]] of pairs.entries()) {
  const card = await call('POST', '/cards', { body: { title: soldTitles[i], guessedPrice: 4 + i, condition: 'NM' }, token: tok[seller] });
  const tx = (await db.query(
    `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PAID', 'CASH', now(), now()) RETURNING id`,
    [card.id, users[buyer].id, users[seller].id, 4 + i],
  )).rows[0].id;
  state.tx[`${seller}_${buyer}`] = tx;
}

// 6. Subastas: pedro y bruno pujan en dos cartas de marta (alias distinto por subasta).
for (const [key, title] of [['subasta1', 'Ragavan, Nimble Pilferer'], ['subasta2', 'Thoughtseize']]) {
  const card = await call('POST', '/cards', { body: { title, guessedPrice: 20, condition: 'LP' }, token: tok.marta });
  state.cards[key] = card.id;
  await call('POST', `/cards/${card.id}/offers`, { body: { amount: 21 }, token: tok.pedro });
  await call('POST', `/cards/${card.id}/offers`, { body: { amount: 23 }, token: tok.bruno });
  await call('POST', `/cards/${card.id}/offers`, { body: { amount: 25 }, token: tok.pedro });
}

// 7. dani vende con una compra PENDIENTE (supresión denegada: OPEN_TRANSACTIONS).
{
  const card = await call('POST', '/cards', { body: { title: 'Sol Ring', guessedPrice: 3, condition: 'MP' }, token: tok.dani });
  state.cards.daniPendiente = card.id;
  state.tx.dani_pendiente = (await db.query(
    `INSERT INTO transactions (id, "cardId", "buyerId", "sellerId", amount, status, "paymentMethod", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, 3, 'PENDING', 'CASH', now(), now()) RETURNING id`,
    [card.id, users.bruno.id, users.dani.id],
  )).rows[0].id;
}

// 8. eva activa 2FA (su secreto queda cifrado con AES-256-GCM).
{
  const setup = await call('POST', '/auth/2fa/setup', { token: tok.eva });
  const secret = new URL(setup.otpauthUrl).searchParams.get('secret');
  const code = await otplib.generate({ secret });
  await call('POST', '/auth/2fa/enable', { body: { code }, token: tok.eva });
  writeFileSync(join(OUT, 'eva.totp'), secret + '\n', { mode: 0o600 }); // solo para generar códigos en la demo; fuera del repo
}

// 9. Una carta en venta de mateo, para la demo de bloqueo (oferta → 409).
state.cards.mateoVenta = (await call('POST', '/cards', { body: { title: 'Birds of Paradise', guessedPrice: 9, condition: 'NM' }, token: tok.mateo })).id;

writeFileSync(join(OUT, 'demo-state.json'), JSON.stringify(state, null, 2));
console.log(`Listo: ${Object.keys(users).length} cuentas, ${Object.keys(state.tx).length} transacciones → ${join(OUT, 'demo-state.json')}`);
await db.end();
