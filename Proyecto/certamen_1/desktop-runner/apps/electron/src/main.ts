import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const SERVER_PORT = 4550;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const RENDERER_DEV_URL = 'http://localhost:5173';

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * Levanta el server NestJS (apps/server/dist/main.js) como proceso hijo.
 * Usamos el propio binario de Electron con ELECTRON_RUN_AS_NODE=1 para no
 * depender de que el usuario tenga Node instalado por separado
 * (ver https://www.electronjs.org/docs/latest/tutorial/process-model).
 */
function startServer(): ChildProcess {
  const serverEntry = path.join(__dirname, '..', '..', 'server', 'dist', 'main.js');
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MTG_RUNNER_PORT: String(SERVER_PORT) },
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    // eslint-disable-next-line no-console
    console.log(`[server] terminó con código ${code}`);
  });
  return child;
}

async function waitForServer(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${SERVER_URL}/health`);
      if (res.ok) return;
    } catch {
      // todavía no está arriba, reintentar
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('El server NestJS no respondió a tiempo en /health');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererIndex = path.join(__dirname, '..', '..', 'renderer', 'dist', 'index.html');

  if (app.isPackaged || fs.existsSync(rendererIndex)) {
    await mainWindow.loadFile(rendererIndex);
  } else {
    // Sin build del renderer disponible: asumimos que `npm run dev:renderer`
    // está corriendo el servidor de Vite en modo hot-reload.
    await mainWindow.loadURL(RENDERER_DEV_URL);
  }
}

ipcMain.handle('dialog:pickFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:pickFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

app.whenReady().then(async () => {
  serverProcess = startServer();
  try {
    await waitForServer();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
