// Escena 11 — incidente simulado (mismo guion que la evidencia de la Actividad N°7):
// toma de la cuenta de marta con una contraseña filtrada en otro sitio.
// Solo cuentas de prueba @example.com contra el backend local de demo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DIR = process.env.DEMO_DIR ?? '/mnt/SSDGames/mtg-video/work';
const API = process.env.API ?? 'http://localhost:3000';
const PASS = process.env.DEMO_PASSWORD ?? 'DemoMTG-2026!';
const state = JSON.parse(readFileSync(join(DIR, 'demo-state.json'), 'utf8'));
const marta = state.users.marta;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const c = (code) => `\x1b[1;${code >= 400 ? 31 : 32}m${code}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
async function line(label, steps) {
  process.stdout.write(`\x1b[1;33m${label}\x1b[0m`);
  for (const [desc, fn] of steps) {
    await pause(650);
    const r = await fn();
    process.stdout.write(`  ${dim(desc)} ${c(r.status)}`);
  }
  process.stdout.write('\n');
  await pause(900);
}

console.log('\x1b[1mATACANTE\x1b[0m · tiene la contraseña de marta (filtrada en otro sitio)\n');
let token;
const atacante = 'atacante@example.com';
await line('[1] Entrar    ', [
  ['clave incorrecta', () => call('POST', '/auth/login', { body: { email: marta.email, password: 'Primavera2025!' } })],
  ['clave incorrecta', () => call('POST', '/auth/login', { body: { email: marta.email, password: 'Primavera2026!' } })],
  ['clave filtrada', async () => { const r = await call('POST', '/auth/login', { body: { email: marta.email, password: PASS } }); token = r.body?.accessToken; return r; }],
]);
const myTx = state.tx.marta_pedro;
await line('[2] Mirar     ', [
  ['sus ventas', () => call('GET', '/transactions', { token })],
  ['la venta a pedro', () => call('GET', `/transactions/${myTx}`, { token })],
  ['perfil de pedro', () => call('GET', `/users/${state.users.pedro.id}`, { token })],
]);
const ajena = state.tx.lucia_sofia;
await line('[3] Sondear   ', [
  ['compra ajena', () => call('GET', `/transactions/${ajena}`, { token })],
  ['comprobante ajeno', () => call('GET', `/transactions/${ajena}/receipt`, { token })],
  ['id inventado', () => call('GET', `/transactions/${randomUUID()}`, { token })],
  ['id inventado', () => call('GET', `/transactions/${randomUUID()}`, { token })],
  ['id inventado', () => call('GET', `/transactions/${randomUUID()}`, { token })],
]);
let stepUp;
await line('[4] Quedarse  ', [
  ['reautentica', async () => { const r = await call('POST', '/auth/step-up', { body: { password: PASS }, token }); stepUp = r.body?.stepUpToken; return r; }],
  ['cambia el correo al suyo', () => call('POST', '/data-rights/requests', { body: { type: 'RECTIFICATION', rectification: { email: atacante }, stepUpToken: stepUp }, token })],
  ['entra con el correo nuevo', async () => { const r = await call('POST', '/auth/login', { body: { email: atacante, password: PASS } }); token = r.body?.accessToken; return r; }],
]);
await line('[5] Llevarse  ', [
  ['reautentica', async () => { const r = await call('POST', '/auth/step-up', { body: { password: PASS }, token }); stepUp = r.body?.stepUpToken; return r; }],
  ['exporta TODOS los datos', () => call('POST', '/data-rights/requests', { body: { type: 'ACCESS', stepUpToken: stepUp }, token })],
]);
await pause(600);
await line('[6] Reintentar', [
  ['su sesión', () => call('GET', '/data-rights/requests', { token })],
]);
console.log(`\n${dim('El sistema revocó su sesión de forma automática: ya no puede seguir.')}`);
