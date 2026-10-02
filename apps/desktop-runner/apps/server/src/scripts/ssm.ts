import { spawn } from 'child_process';
import { probeCommand } from './tf-docker';
import { pathEnvWithToolBin } from './tool-install';

/**
 * Acceso a las instancias EC2 vía AWS Systems Manager Session Manager —
 * ningún security group tiene puertos administrativos abiertos (ver
 * ../../../infra/terraform/security_groups.tf), todo pasa por acá.
 * Complementa terraform.ts, no lo reemplaza: esto es para conectarse a lo
 * que terraform ya creó, no para crear/destruir infra.
 */

export type SsmInstanceKey = 'backend' | 'postgres' | 'mailhog' | 'minio';

export interface SsmInstanceDef {
  key: SsmInstanceKey;
  label: string;
  /** Nombre del output de terraform (outputs.tf) que trae el instance id real. */
  outputKey: string;
  /** Puerto a tunelear con "Abrir túnel" — solo mailhog/minio lo tienen (backend/postgres no exponen ninguna UI admin). */
  webPort?: number;
}

export const SSM_INSTANCES: SsmInstanceDef[] = [
  { key: 'backend', label: 'Backend', outputKey: 'backend_instance_id' },
  { key: 'postgres', label: 'Postgres', outputKey: 'postgres_instance_id' },
  { key: 'mailhog', label: 'MailHog', outputKey: 'mailhog_instance_id', webPort: 8025 },
  { key: 'minio', label: 'MinIO', outputKey: 'minio_instance_id', webPort: 9001 },
];

export function isSessionManagerPluginInstalled(): Promise<boolean> {
  return probeCommand('session-manager-plugin', ['--version'], pathEnvWithToolBin());
}

export function buildStartSessionArgs(instanceId: string, region: string): string[] {
  return ['ssm', 'start-session', '--target', instanceId, '--region', region];
}

/**
 * `aws ssm send-command` (Run Command) + poll hasta que termine — misma
 * lógica que `scripts/deploy-backend.sh` ya usa en bash, portada acá para
 * "Importar catálogo" (un solo comando `docker exec`, no necesita todo el
 * armado de S3+.env que sí tiene el deploy). No pasa por
 * session-manager-plugin — Run Command es un mecanismo aparte de
 * start-session, no lo necesita.
 */
export async function runSsmCommand(
  instanceId: string,
  commands: string[],
  region: string,
  env: NodeJS.ProcessEnv,
  onLog: (message: string) => void,
): Promise<string> {
  const paramsJson = JSON.stringify({ commands });
  onLog(`Enviando comando a ${instanceId} (Run Command) ...`);
  const commandId = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'aws',
      ['ssm', 'send-command', '--instance-ids', instanceId, '--document-name', 'AWS-RunShellScript', '--parameters', paramsJson, '--region', region, '--query', 'Command.CommandId', '--output', 'text'],
      { env },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `send-command terminó con código ${code}`))));
  });

  onLog(`Comando ${commandId} enviado, esperando a que termine ...`);
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await new Promise<string>((resolve) => {
      const child = spawn('aws', ['ssm', 'get-command-invocation', '--command-id', commandId, '--instance-id', instanceId, '--region', region, '--query', 'Status', '--output', 'text'], { env });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.on('error', () => resolve('Pending'));
      child.on('close', () => resolve(out.trim() || 'Pending'));
    });
    if (status === 'Success' || status === 'Failed' || status === 'Cancelled' || status === 'TimedOut') {
      const output = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
        const child = spawn(
          'aws',
          ['ssm', 'get-command-invocation', '--command-id', commandId, '--instance-id', instanceId, '--region', region, '--query', '{stdout:StandardOutputContent,stderr:StandardErrorContent}', '--output', 'json'],
          { env },
        );
        let out = '';
        child.stdout.on('data', (d) => (out += d.toString()));
        child.on('close', () => {
          try {
            resolve(JSON.parse(out));
          } catch {
            resolve({ stdout: out, stderr: '' });
          }
        });
      });
      if (output.stdout) onLog(output.stdout);
      if (output.stderr) onLog(output.stderr);
      if (status !== 'Success') throw new Error(`Comando remoto terminó en estado ${status}`);
      return commandId;
    }
  }
}

export function buildPortForwardArgs(instanceId: string, port: number, region: string): string[] {
  return [
    'ssm',
    'start-session',
    '--target',
    instanceId,
    '--document-name',
    'AWS-StartPortForwardingSession',
    '--parameters',
    JSON.stringify({ portNumber: [String(port)], localPortNumber: [String(port)] }),
    '--region',
    region,
  ];
}

/** `which <cmd>` — a diferencia de correr el comando con `--version`, nunca arriesga abrir una ventana/colgarse por accidente (algunos emuladores de terminal no salen solos con esa flag). Solo POSIX — en Windows no se usa (siempre se abre vía cmd.exe, ver abajo). */
function commandOnPath(cmd: string): Promise<boolean> {
  return probeCommand('which', [cmd]);
}

/**
 * Lanza una terminal NATIVA del SO corriendo `aws ssm start-session ...` —
 * sesión interactiva real (pty completo, funciona Ctrl+C, flechas, etc.),
 * a propósito distinto del mecanismo de streaming de logs que usa el resto
 * de la app (ese solo manda datos server->cliente, no hay forma de escribir
 * de vuelta) — construir una terminal in-app (xterm.js + pty) sería mucho
 * más trabajo para el mismo resultado que ya da una terminal real del SO.
 * Linux: prueba emuladores comunes en orden, el primero que exista gana.
 * Windows: abre una consola cmd nueva.
 */
export async function launchNativeTerminal(command: string[], env: NodeJS.ProcessEnv): Promise<void> {
  if (process.platform === 'win32') {
    // `start` es un builtin de cmd, no un .exe — hay que invocarlo vía
    // `cmd /c`. El primer argumento de `start` after el flag es el título
    // de ventana (obligatorio si el comando en sí lleva espacios/comillas).
    // `/k` deja la ventana abierta después de que el comando termina, para
    // poder leer un error si `aws` falla en vez de que la ventana se cierre sola.
    const child = spawn('cmd.exe', ['/c', 'start', '"SSM"', 'cmd.exe', '/k', 'aws', ...command], {
      env,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  const candidates: { cmd: string; args: string[] }[] = [
    { cmd: 'konsole', args: ['-e', 'aws', ...command] },
    { cmd: 'gnome-terminal', args: ['--', 'aws', ...command] },
    { cmd: 'x-terminal-emulator', args: ['-e', `aws ${command.join(' ')}`] },
    { cmd: 'xterm', args: ['-e', 'aws', ...command] },
  ];
  for (const { cmd, args } of candidates) {
    if (await commandOnPath(cmd)) {
      const child = spawn(cmd, args, { env, detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
  }
  throw new Error(
    `No se encontró una terminal conocida (konsole/gnome-terminal/x-terminal-emulator/xterm) — corré esto a mano: aws ${command.join(' ')}`,
  );
}
