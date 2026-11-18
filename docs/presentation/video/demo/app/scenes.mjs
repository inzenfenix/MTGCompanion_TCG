// Tomas de la app Ionic para el video (ROADMAP.md O18).
//
//   node scenes.mjs <escena> [--as <cuenta>] [--dry]
//
// --dry no graba: saca una captura por paso en <DEMO_DIR>/dry/ (para ensayar con
// otra cuenta sin gastar el estado de la cuenta de la toma real).
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, pause, PASS } from './recorder.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIPS = resolve(HERE, '../../assets/clips');
const WORK = process.env.DEMO_DIR ?? '/mnt/SSDGames/mtg-video/work';
const args = process.argv.slice(2);
const scene = args[0];
const dry = args.includes('--dry');
const asIdx = args.indexOf('--as');
const who = asIdx !== -1 ? args[asIdx + 1] : null;
const email = (name) => `${name}@example.com`;

const app = await openApp({ port: 9360 + Math.floor(Math.random() * 30) });
let stop = null;
let step = 0;
const DRY_DIR = join(WORK, 'dry', scene);
if (dry) mkdirSync(DRY_DIR, { recursive: true });
const snap = async (label) => {
  if (dry) await app.shot(join(DRY_DIR, `${String(++step).padStart(2, '0')}_${label}.png`));
};
const rec = async (name) => { if (!dry) stop = await app.record(join(CLIPS, `${name}.mp4`)); await pause(800); };
const done = async () => { await pause(1200); if (stop) await stop(); stop = null; };
const alertButton = (text) => app.tap({ text, sel: 'ion-alert:not(.overlay-hidden) button' }, { scroll: false });
const VIS = 'ion-alert:not(.overlay-hidden)';
async function fillAlert(field, text, perChar) {
  const css = `${VIS} ${field}`;
  await app.waitFor(`!!document.querySelector('${VIS}') && !!document.querySelector('${css.replace(/'/g, "\\'")}')`);
  await pause(1100); // que termine la animación de apertura
  for (let attempt = 0; attempt < 3; attempt++) {
    await app.tap({ css }, { scroll: false });
    await clearField(); // Ionic reutiliza el valor del diálogo anterior
    await pause(150);
    await app.type(text, perChar);
    const len = await app.evaluate(`document.querySelector('${css.replace(/'/g, "\\'")}')?.value.length ?? -1`);
    if (len === [...text].length) break;
    await app.evaluate(`(() => { const i = document.querySelector('${css.replace(/'/g, "\\'")}'); if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  }
  await app.tap({ text: 'Confirmar', sel: `${VIS} button` }, { scroll: false });
}
const stepUp = () => fillAlert('input[type="password"]', PASS, 70);
const statement = (text) => fillAlert('textarea', text, 40);
async function clearField() {
  for (const [key, mod] of [['a', 2], ['Backspace', 0]]) {
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === 'a' ? 'KeyA' : 'Backspace', modifiers: mod, windowsVirtualKeyCode: key === 'a' ? 65 : 8 });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === 'a' ? 'KeyA' : 'Backspace', modifiers: mod, windowsVirtualKeyCode: key === 'a' ? 65 : 8 });
  }
}
async function openPrivacy(user) {
  await app.goto('/onboarding');
  await app.login(email(user));
  await app.goto('/tab4');
  await app.waitText('Privacidad y mis datos');
  await pause(1500);
}

try {
  if (scene === 's08') {
    // Consentimiento por finalidad: revocar la ubicación y ver el historial.
    await openPrivacy(who ?? 'ana');
    await rec('s08_consentimiento');
    await app.tap({ text: 'Privacidad y mis datos', sel: 'ion-item' });
    await app.waitText('Consentimientos');
    await pause(3000); await snap('consentimientos');
    await app.tap({ css: '[data-testid="consent-LOCATION_DISTANCE"] ion-toggle' }, { scroll: false });
    await pause(2500); await snap('ubicacion_revocada');
    await app.tap({ text: 'Historial de consentimientos', sel: 'ion-button' });
    await pause(900);
    { const h = await app.locate({ text: 'Historial de consentimientos', sel: 'ion-button' }); await app.scroll(h.top - 110); }
    await pause(3500); await snap('historial');
    await done();
  } else if (scene === 's09') {
    // Derechos: acceso (descarga), supresión denegada con motivo, rectificación del correo.
    const user = who ?? 'dani';
    await openPrivacy(user);
    await app.cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(WORK, 'descargas') }).catch(() => {});
    await app.tap({ text: 'Privacidad y mis datos', sel: 'ion-item' });
    await app.waitText('Mis derechos');
    await app.scrollTo({ text: 'Mis derechos', sel: 'h2, h3, ion-list-header, ion-label, ion-card-title, h1' }, 90);
    await pause(800);
    await rec('s09_derechos');
    await pause(1500);
    await app.tap({ text: 'Descargar mis datos', sel: 'ion-button' });
    await stepUp();
    await app.waitText('tu copia se descargó');
    await app.scrollTo({ css: 'p[role="status"]' }, 160);
    await pause(3000); await snap('acceso_descargado');
    await app.scrollTo({ text: 'Eliminar mi cuenta', sel: 'ion-button' }, 260);
    await pause(1000);
    await app.tap({ text: 'Eliminar mi cuenta', sel: 'ion-button' });
    await pause(1200); await snap('confirmar_supresion');
    await alertButton('Eliminar mi cuenta');
    await stepUp();
    await app.waitFor(`!!document.querySelector('p[role="status"]') && !document.querySelector('ion-alert:not(.overlay-hidden)')`);
    await pause(600);
    await app.scrollTo({ css: 'p[role="status"]' }, 160);
    await pause(4000); await snap('supresion_denegada');
    await app.scrollTo({ text: 'Mis solicitudes', sel: 'h2, h3, ion-list-header, ion-label, ion-card-title, h1' }, 90);
    await pause(3500); await snap('mis_solicitudes');
    await app.scrollTo({ text: 'Guardar corrección', sel: 'ion-button' }, 430);
    await pause(1000);
    await app.tap({ css: 'ion-input[type="email"] input' });
    await clearField();
    await app.type(`${user}.nuevo@example.com`, 60);
    await app.tap({ text: 'Guardar corrección', sel: 'ion-button' });
    await stepUp();
    await pause(3500); await snap('correo_corregido');
    await done();
  } else if (scene === 's10a') {
    // Canal público, sin sesión.
    await app.goto('/onboarding');
    await app.logout();
    await app.goto('/onboarding');
    await app.waitText('Ejerce tus derechos');
    await pause(1000);
    await rec('s10a_formulario_publico');
    await pause(1200);
    await app.tap({ text: 'ejerce tus derechos' });
    await app.waitText('Envía tu solicitud');
    await pause(2000); await snap('formulario');
    await app.tap({ css: 'ion-input[type="email"] input' });
    await app.type(email(who ?? 'sofia'), 60);
    await pause(600);
    await app.tap({ text: 'Enviar solicitud', sel: 'ion-button' });
    await app.waitText('Recibimos tu solicitud');
    await pause(4000); await snap('acuse_neutro');
    await done();
  } else if (scene === 's10b') {
    // Oposición (acogida y denegada) y bloqueo, desde Privacidad.
    await openPrivacy(who ?? 'sofia');
    await app.tap({ text: 'Privacidad y mis datos', sel: 'ion-item' });
    await app.waitText('Oposición');
    await app.scrollTo({ testid: 'objection-SALES_STATISTICS' }, 90);
    await pause(800);
    await rec('s10b_oposicion_bloqueo');
    await pause(1500);
    await app.tap({ css: '[data-testid="objection-SALES_STATISTICS"] ion-button' }, { scroll: false });
    await statement('No quiero que mis compras se usen en estadísticas.');
    await pause(2500); await snap('oposicion_acogida');
    await app.scrollTo({ testid: 'objection-SECURITY_MONITORING' }, 90);
    await app.tap({ css: '[data-testid="objection-SECURITY_MONITORING"] ion-button' });
    await statement('No quiero que se registre mi actividad.');
    await app.waitFor(`!document.querySelector('ion-alert:not(.overlay-hidden)')`);
    await pause(800);
    await app.scrollTo({ css: 'p[role="status"]' }, 160);
    await pause(4500); await snap('oposicion_denegada');
    await app.scrollTo({ testid: 'blocking' }, 90);
    await pause(2500);
    await app.tap({ text: 'Bloquear el uso de mis datos', sel: 'ion-button' });
    await statement('Prefiero pausar mis datos en vez de borrar la cuenta.');
    await pause(1500);
    await app.scrollTo({ testid: 'blocking' }, 90);
    await pause(4000); await snap('bloqueo_vigente');
    await done();
  } else {
    throw new Error(`escena desconocida: ${scene}`);
  }
} finally {
  if (stop) await stop().catch(() => {});
  await app.close();
}
