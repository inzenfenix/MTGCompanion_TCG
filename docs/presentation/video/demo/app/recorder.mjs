// Grabador de la app Ionic (ROADMAP.md O18): Chromium headless por el protocolo
// DevTools, vista de teléfono, toques visibles en pantalla y video a 30 fps.
// Sin dependencias nuevas: los cuadros salen de Page.startScreencast y ffmpeg los
// arma respetando el tiempo real entre cuadros.
//
// La app debe estar corriendo (vite en APP_URL) contra el backend de demo (API).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
export const API = process.env.API ?? 'http://localhost:3000';
export const PASS = process.env.DEMO_PASSWORD ?? 'DemoMTG-2026!';
const BROWSER = process.env.CHROMIUM ?? '/usr/bin/chromium';
const WORK = process.env.DEMO_DIR ?? '/mnt/SSDGames/mtg-video/work';
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Indicador de toque: un círculo que aparece donde se "toca" la pantalla.
const TAP_SCRIPT = `
window.__tap = (x, y) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:44px;height:44px;border-radius:50%;' +
    'background:rgba(255,255,255,.55);box-shadow:0 0 0 3px rgba(124,58,237,.9);left:' + (x - 22) + 'px;top:' + (y - 22) + 'px;' +
    'transform:scale(.6);opacity:1;transition:transform .45s ease-out,opacity .45s ease-out';
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => { d.style.transform = 'scale(1.25)'; d.style.opacity = '0'; });
  setTimeout(() => d.remove(), 600);
};`;

export async function openApp({ width = 412, height = 915, scale = 2, port = 9340, extraArgs = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'mtg-rec-'));
  const browser = spawn(BROWSER, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--force-color-profile=srgb', '--lang=es-CL', ...extraArgs, 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch { /* aún no */ }
    await pause(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method && listeners.has(msg.method)) listeners.get(msg.method)(msg.params);
  });
  const cdp = (method, params = {}) => new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) =>
    (await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: TAP_SCRIPT });

  const app = {
    cdp, evaluate,
    async waitFor(expression, ms = 60000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await evaluate(expression).catch(() => false)) return;
        await pause(250);
      }
      throw new Error(`timeout: ${expression}`);
    },
    async spanish() {
      await evaluate(`import('/src/i18n.ts').then((m) => m.default.language === 'es-LA' || m.default.changeLanguage('es-LA'))`).catch(() => {});
    },
    async waitText(text, ms = 60000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        await app.spanish();
        if (await evaluate(`document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`)) return;
        await pause(300);
      }
      throw new Error(`timeout esperando el texto: ${text}`);
    },
    async goto(path) {
      await cdp('Page.navigate', { url: `${APP_URL}${path}` });
      await app.waitFor('document.readyState === "complete"');
      await app.spanish();
    },
    // Navegación dentro de la app (sin recargar), como lo haría un toque en un enlace.
    async route(path) {
      await evaluate(`(() => { window.history.pushState({}, '', ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent('popstate')); })()`);
      await pause(400);
    },
    async login(email) {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASS }),
      });
      const session = await res.json();
      if (!session.accessToken) throw new Error(`login ${email}: ${JSON.stringify(session)}`);
      if (!(await evaluate('location.origin === ' + JSON.stringify(APP_URL)))) await app.goto('/onboarding');
      await evaluate(`localStorage.setItem('mtg_companion_session', ${JSON.stringify(JSON.stringify(session))})`);
      return session;
    },
    async logout() { await evaluate('localStorage.clear()'); },
    // Busca un elemento visible por data-testid, selector CSS o texto (se prefiere el más interno).
    async locate(target) {
      return evaluate(`(() => {
        const t = ${JSON.stringify(target)};
        const page = [...document.querySelectorAll('.ion-page:not(.ion-page-hidden)')].at(-1) || document;
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        let els = [];
        const roots = [document, ...[...document.querySelectorAll('ion-alert, ion-modal, ion-action-sheet, ion-popover, ion-select-popover')]];
        if (t.testid) els = [...document.querySelectorAll('[data-testid="' + t.testid + '"]')];
        else if (t.css) els = [...document.querySelectorAll(t.css)];
        else {
          const sel = t.sel || 'ion-button, button, ion-item, ion-tab-button, ion-segment-button, ion-toggle, ion-checkbox, a, ion-label, h1, h2, h3, h4, p, span, ion-card, ion-chip, ion-input, ion-textarea, ion-select';
          const want = t.text.toLowerCase();
          els = [...document.querySelectorAll(sel)].filter((e) => (e.innerText || e.textContent || '').toLowerCase().includes(want));
          els = els.filter((e) => !els.some((o) => o !== e && e.contains(o)));
        }
        const overlay = document.querySelector('ion-alert, ion-modal.show-modal, ion-action-sheet, ion-popover');
        els = els.filter(vis);
        if (overlay) { const inside = els.filter((e) => overlay.contains(e)); if (inside.length) els = inside; }
        else els = els.filter((e) => page.contains(e) || !e.closest('.ion-page-hidden'));
        const e = els[t.nth || 0];
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, h: innerHeight };
      })()`);
    },
    async scrollTo(target, offset = 140) {
      const el = await app.locate(target);
      if (!el) throw new Error(`no encontrado: ${JSON.stringify(target)}`);
      if (el.top >= 70 && el.bottom <= el.h - 90) return;
      await evaluate(`(async () => {
        const c = [...document.querySelectorAll('.ion-page:not(.ion-page-hidden) ion-content')].at(-1);
        if (c) await c.scrollByPoint(0, ${el.top - offset}, 700);
      })()`);
      await pause(800);
    },
    async scroll(dy, ms = 800) {
      await evaluate(`(async () => {
        const c = [...document.querySelectorAll('.ion-page:not(.ion-page-hidden) ion-content')].at(-1);
        if (c) await c.scrollByPoint(0, ${dy}, ${ms});
      })()`);
      await pause(ms + 200);
    },
    async tap(target, { scroll = true } = {}) {
      let el = await app.locate(target);
      for (let i = 0; !el && i < 40; i++) { await pause(250); el = await app.locate(target); }
      if (!el) throw new Error(`no encontrado: ${JSON.stringify(target)}`);
      if (scroll && (el.top < 60 || el.bottom > el.h - 80)) { await app.scrollTo(target); el = await app.locate(target); }
      await evaluate(`window.__tap && window.__tap(${el.x}, ${el.y})`);
      await pause(180);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp('Input.dispatchMouseEvent', { type, x: el.x, y: el.y, button: 'left', clickCount: 1 });
      }
      await pause(500);
    },
    async type(text, perChar = 55) {
      for (const ch of text) { await cdp('Input.insertText', { text: ch }); await pause(perChar); }
      await pause(300);
    },
    async record(outFile) {
      const dir = mkdtempSync(join(WORK, 'frames-'));
      const frames = [];
      listeners.set('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
        const f = join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
        writeFileSync(f, Buffer.from(data, 'base64'));
        frames.push({ f, t: metadata.timestamp });
        cdp('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      await cdp('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width * scale, maxHeight: height * scale, everyNthFrame: 1 });
      return async function stop() {
        const end = Date.now() / 1000;
        await cdp('Page.stopScreencast');
        listeners.delete('Page.screencastFrame');
        if (frames.length === 0) throw new Error('no se grabó ningún cuadro');
        const lines = [];
        frames.forEach((fr, i) => {
          const next = i + 1 < frames.length ? frames[i + 1].t : end;
          lines.push(`file '${fr.f}'`, `duration ${Math.max(next - fr.t, 0.001).toFixed(4)}`);
        });
        lines.push(`file '${frames.at(-1).f}'`);
        const list = join(dir, 'list.txt');
        writeFileSync(list, lines.join('\n'));
        mkdirSync(resolve(outFile, '..'), { recursive: true });
        const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
          '-vf', `fps=30,scale=${width * scale}:${height * scale}:flags=lanczos,format=yuv420p`,
          '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', outFile]);
        if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
        rmSync(dir, { recursive: true, force: true });
        console.log(`  ✔ ${outFile} (${frames.length} cuadros)`);
      };
    },
    async shot(file) {
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },
    async close() {
      ws.close();
      const exited = new Promise((r) => browser.once('exit', r));
      browser.kill();
      await Promise.race([exited, pause(5000)]);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
  return app;
}
