// Capturas de Privacidad (oposición, bloqueo, "Completar") y del formulario
// público de derechos — Actividad N°6 (ROADMAP.md O16).
//
// Requiere, en otras terminales:
//   1. cd apps/backend && npm run build && node test/evidence/actividad6.mjs <tmp> --keep   (API en :3101)
//   2. cd apps/mobile && VITE_API_BASE_URL=http://localhost:3101 npx vite --port 5199
// Luego:
//   EDGE_PATH=/usr/bin/chromium node test/evidence/screenshots6.mjs ../../docs/security/evidencia/actividad6/capturas
//
// Mismo enfoque que screenshots.mjs (Actividad 5): un Chromium/Edge headless
// por el protocolo DevTools, sin dependencias nuevas. Usa la cuenta de
// demostración que actividad6.mjs --keep deja preparada.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'capturas');
const demo = JSON.parse(readFileSync(join(tmpdir(), 'mtg-screens6-account.json'), 'utf8'));
const API = demo.api;
const APP = 'http://localhost:5199';
const BROWSER = process.env.EDGE_PATH ?? '/usr/bin/chromium';
const PORT = 9334;
mkdirSync(OUT, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const session = await (
  await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: demo.email, password: demo.password }),
  })
).json();

const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mtg-chromium-'))}`,
    '--hide-scrollbars',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
let targets;
for (let i = 0; i < 50; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    if (targets.some((t) => t.type === 'page')) break;
  } catch {
    /* not up yet */
  }
  await pause(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))
    .result.value;
async function waitFor(expression, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await pause(300);
  }
  throw new Error(`timeout waiting for: ${expression}`);
}
async function shot(name) {
  await pause(700);
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  console.log(`  ${name}`);
}
const visible = `document.querySelector('.ion-page:not(.ion-page-hidden) ion-content')`;
const scrollToTestId = (id) =>
  evaluate(`(async () => {
    const c = ${visible};
    const el = document.querySelector('[data-testid="${id}"]');
    if (!c || !el) return false;
    const top = el.getBoundingClientRect().top - (await c.getScrollElement()).getBoundingClientRect().top;
    await c.scrollByPoint(0, top - 70, 0);
    return true;
  })()`);
const scrollToText = (text) =>
  evaluate(`(async () => {
    const c = ${visible};
    const el = [...document.querySelectorAll('h3, h4, p, ion-button')].find((e) => e.textContent.includes(${JSON.stringify(text)}));
    if (!c || !el) return false;
    const top = el.getBoundingClientRect().top - (await c.getScrollElement()).getBoundingClientRect().top;
    await c.scrollByPoint(0, top - 70, 0);
    return true;
  })()`);
const spanish = () => evaluate(`import('/src/i18n.ts').then((m) => m.default.changeLanguage('es-LA'))`);
// innerText follows CSS text-transform (titles are uppercase): compare lowercased,
// and keep switching to Spanish until the page shows it.
async function waitText(text, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await spanish();
    if (await evaluate(`document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`)) return;
    await pause(400);
  }
  throw new Error(`timeout waiting for text: ${text}`);
}

try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });

  // ── logged in: Privacy ────────────────────────────────────────────────
  await cdp('Page.navigate', { url: `${APP}/` });
  await waitFor('document.readyState === "complete"');
  await evaluate(`localStorage.setItem('mtg_companion_session', ${JSON.stringify(JSON.stringify(session))})`);
  await cdp('Page.navigate', { url: `${APP}/privacy` });
  await waitFor(`!!document.querySelector('[data-testid="objection-SALES_STATISTICS"]')`, 120000);
  await waitText('Oposición');

  await scrollToTestId('objection-SALES_STATISTICS');
  await shot('01_oposicion_tratamientos.png');
  await scrollToTestId('blocking');
  await shot('02_bloqueo_vigente.png');
  await scrollToText('Bloqueo vigente');
  await shot('03_bloqueo_alcance.png');
  await scrollToText('Completar');
  await shot('04_solicitud_formulario_completar.png');
  await evaluate(`[...document.querySelectorAll('ion-button')].find((b) => b.textContent.includes('Completar'))?.click()`);
  await waitFor(`!!document.querySelector('ion-alert')`);
  await shot('05_completar_stepup.png');
  await evaluate(`document.querySelector('ion-alert')?.dismiss()`);
  await pause(400);
  await scrollToText('Rechazada');
  await shot('06_oposicion_denegada_fundada.png');

  // ── no session: public form ───────────────────────────────────────────
  await evaluate(`localStorage.clear()`);
  await cdp('Page.navigate', { url: `${APP}/onboarding` });
  await waitFor(`!!document.querySelector('ion-segment')`, 60000);
  await waitText('No puedes entrar');
  await shot('07_onboarding_enlace_derechos.png');

  await cdp('Page.navigate', { url: `${APP}/derechos` });
  await waitFor(`!!document.querySelector('ion-textarea')`, 60000);
  await waitText('Envía tu solicitud');
  await evaluate(`(() => {
    const s = document.querySelector('ion-select');
    s.value = 'OBJECTION';
    s.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'OBJECTION' } }));
  })()`);
  await pause(400);
  await evaluate(`(() => {
    const i = document.querySelector('ion-input[type="email"]');
    i.value = 'jugador@ejemplo.cl';
    i.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'jugador@ejemplo.cl' } }));
    const t = document.querySelector('ion-textarea');
    t.value = 'Ya no uso la app y no quiero estar en estadísticas.';
    t.dispatchEvent(new CustomEvent('ionInput', { detail: { value: t.value } }));
  })()`);
  await pause(400);
  await shot('08_formulario_publico.png');
  await evaluate(`[...document.querySelectorAll('ion-button')].find((b) => b.textContent.includes('Enviar solicitud'))?.click()`);
  await waitText('Recibimos tu solicitud');
  await shot('09_formulario_acuse_neutro.png');

  await cdp('Page.navigate', { url: `${APP}/derechos/confirmar?code=${demo.code}` });
  await waitFor(`!!document.querySelector('ion-textarea')`, 60000);
  await waitText('Envía tu solicitud');
  // ion-select keeps the label it rendered with: re-select so it's redrawn in Spanish.
  for (const v of ['ERASURE', 'ACCESS']) {
    await evaluate(`(() => {
      const s = document.querySelector('ion-select');
      s.value = '${v}';
      s.dispatchEvent(new CustomEvent('ionChange', { detail: { value: '${v}' } }));
    })()`);
    await pause(300);
  }
  await evaluate(`[...document.querySelectorAll('ion-button')].find((b) => b.textContent.trim() === 'Confirmar')?.click()`);
  await waitText('Listo');
  await shot('10_confirmacion_por_codigo.png');
} finally {
  ws.close();
  browser.kill();
}
