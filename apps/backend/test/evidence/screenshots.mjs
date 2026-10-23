// Capturas de la pantalla Privacidad (Actividad N°5, ROADMAP.md O15).
//
// Requiere, en otras terminales:
//   1. cd apps/backend && node test/evidence/actividad5.mjs <tmp> --keep   (API en :3100)
//   2. cd apps/mobile && VITE_API_BASE_URL=http://localhost:3100 npx vite --port 5199
// Luego:
//   node test/evidence/screenshots.mjs ../../docs/security/evidencia/actividad5/capturas
//
// Maneja Microsoft Edge headless por el protocolo DevTools (WebSocket nativo
// de Node), sin dependencias nuevas. Crea una cuenta de demostración propia.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'capturas');
const API = 'http://localhost:3100';
const APP = 'http://localhost:5199';
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const PASS = 'Evidencia-2026!';
mkdirSync(OUT, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── demo account with some history to show ──────────────────────────────
const email = `jugador.demo.${Date.now()}@evidencia.test`;
await api('POST', '/users/register', {
  email,
  password: PASS,
  displayName: 'Jugador Demo',
  adultConfirmed: true,
  language: 'es-LA',
});
let session = await api('POST', '/auth/login', { email, password: PASS });
const token = session.accessToken;
await api('POST', '/consents/me/LOCATION_DISTANCE', { version: '1' }, token);
await api('POST', '/consents/me/EMAIL_NOTIFICATIONS', { version: '1' }, token);
await api('DELETE', '/consents/me/EMAIL_NOTIFICATIONS', undefined, token);
const { stepUpToken } = await api('POST', '/auth/step-up', { password: PASS }, token);
await api('POST', '/data-rights/requests', { type: 'ACCESS', stepUpToken }, token);
await api(
  'POST',
  '/data-rights/requests',
  { type: 'RECTIFICATION', rectification: { displayName: 'Jugadora Demo' } },
  token,
);
await api('POST', '/data-rights/requests', { type: 'ERASURE', confirmErasure: true }, token);
session = { ...session, user: { ...session.user, displayName: 'Jugadora Demo' } };

// ── Edge over the DevTools protocol ──────────────────────────────────────
const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mtg-edge-'))}`,
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
const scrollTo = (y) => evaluate(`${visible}.scrollToPoint(0, ${y}, 0)`);
const clickText = (text) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('ion-button, ion-item')]
      .find((e) => e.offsetParent !== null && e.textContent.includes(${JSON.stringify(text)}));
    if (el) el.click();
    return !!el;
  })()`);

try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: 412,
    height: 915,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp('Page.navigate', { url: `${APP}/` });
  await waitFor('document.readyState === "complete"');
  await evaluate(
    `localStorage.setItem('mtg_companion_session', ${JSON.stringify(JSON.stringify(session))})`,
  );
  await cdp('Page.navigate', { url: `${APP}/privacy` });
  await waitFor(`!!document.querySelector('[data-testid="consent-LOCATION_DISTANCE"]')`, 120000);
  // Spanish UI: the dev server serves the same i18n module instance the app uses.
  await evaluate(`import('/src/i18n.ts').then((m) => m.default.changeLanguage('es-LA'))`);
  await waitFor(`document.body.innerText.includes('Consentimientos')`);

  await shot('01_privacidad_consentimientos.png');
  await scrollTo(620);
  await shot('02_privacidad_finalidades.png');
  await evaluate(`[...document.querySelectorAll('ion-button')].find((b) => b.textContent.includes('Historial'))?.click()`);
  await pause(400);
  await scrollTo(760);
  await shot('03_privacidad_historial.png');
  await scrollTo(1250);
  await shot('04_privacidad_derechos.png');
  await scrollTo(99999);
  await shot('05_privacidad_mis_solicitudes.png');
  await scrollTo(1050);
  await clickText('Descargar mis datos');
  await waitFor(`!!document.querySelector('ion-alert')`);
  await shot('06_stepup_descargar_datos.png');
  await evaluate(`document.querySelector('ion-alert')?.dismiss()`);
  await pause(500);

  await cdp('Page.navigate', { url: `${APP}/tab4` });
  await waitFor(`document.body.innerText.includes('Privacidad')`, 60000).catch(async () => {
    await evaluate(`import('/src/i18n.ts').then((m) => m.default.changeLanguage('es-LA'))`);
  });
  await evaluate(`import('/src/i18n.ts').then((m) => m.default.changeLanguage('es-LA'))`);
  await shot('07_ajustes_acceso_privacidad.png');
} finally {
  ws.close();
  edge.kill();
}
